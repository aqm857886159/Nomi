# 诊断包里的卡顿时间线（设计卡）

状态：🚧 进行中（实现与自验已做，待独立验收）。

改动名：诊断包记录卡顿（本机时间线 + 显卡屏幕 + 工程体量数字）　线/负责人：I-diagnostics-jank　类别：[其他]（新增功能 `feat`，非四类；不花钱、不加界面、不改遥测告知范围）

## 为什么

用户说「卡」时我们只能猜：主进程堵了还是渲染层堵了、哪一刻、工程多大、什么显卡，诊断包里都没有。用户通常卡完、重启了才想起导出，所以记录必须活过重启。这条线让下一位用户导出的诊断包直接写明这些。数据只留本机，用户自己导出才给我们；不往 `perf.session.summary` 加字段，不改它的 `generating` 口径。

## ★0 先查别人

1. Electron 性能指南 <https://www.electronjs.org/docs/latest/tutorial/performance> · 别堵主进程，核心模块优先异步版，测量靠 DevTools / Tracing · **确认**主进程停顿是要量的一类；**改了**：只留本机时间线，不开 tracing、不做 CPU profile（范围外）。
2. Node `perf_hooks` <https://nodejs.org/api/perf_hooks.html> · `monitorEventLoopDelay` 返回纳秒直方图，`resolution` 是采样间隔；`samplePerIteration` 到 v26.5.0 才有，本仓 Electron 43.4.1 内置 Node 24.18.1 没有 · **改了**：用标准直方图 + 间隔采样，不自写剖析器；实测（见 ★7）记录值含采样间隔本身，且 20ms 间隔的开销超预算，采样间隔改 80ms。
3. VS Code 扩展宿主高 CPU 排查 <https://github.com/microsoft/vscode/wiki/Explain-extension-causes-high-cpu-load>、<https://github.com/microsoft/vscode/issues/16381> · 发现无响应就留一份证据让用户随报告带上；主进程里的同步 fs 是看证据一个个拔掉的 · **确认**「现场留一份用户自己交的证据」比让他重现好；**没采纳** profile（本卡不开 tracing，等看到第一批停顿记录再定）。
4. Chromium 性能体系 <https://chromium.googlesource.com/chromium/src/+/main/docs/speed/how_does_chrome_measure_performance.md> · 实验室答「哪个提交」，现场答「影响了谁」 · **确认**本卡只做「本机留证」，不扩遥测（遥测范围三另议）。
5. web.dev INP <https://web.dev/articles/inp>、实验室与现场数据差异 <https://web.dev/articles/lab-and-field-data-differences> · 200ms 是「良好」的边界；现场数据只含能用上的人 · **确认**渲染层长帧进时间线的门槛取 200ms；**确认**现场汇总看不见最卡的那批人，所以要让用户自己导出。
6. 仓内先例 `docs/evidence/2026-10-21-text-tasks-pi-ai/c6-prewarm-trigger.txt:6` 写「Electron 主进程里 `monitorEventLoopDelay` 采不到样」（Windows、1ms 间隔）· **改了**：把「量得到」做成阳性对照（★9-1，真 Electron 注入 1200ms 同步睡眠）；macOS 本机实测读到约 1224ms（原始读数含一个采样间隔）；Windows 未核（记「没核的」）。
证据命令：`pnpm run check:prior-art`。

## ★1 用户怎么用

当用户报「卡」并导出诊断包，我想直接看到：主进程那一刻停了多久、渲染层有没有长帧、窗口有没有被判无响应、当时在哪一页、有没有生成在跑、工程多大、什么显卡什么屏；以便不再靠猜。

步骤：① 应用运行时，主进程监视器（`electron/diagnostics/stallMonitor.ts`）每 80ms 采样事件循环，每 10 秒读一次最大值；② ≥100ms 记一行 `main-stall`，≥1000ms 标冻结；③ 主窗口 `unresponsive` / `responsive` 各记一行；④ 渲染层现成的长帧观察者把 ≥200ms 的帧批量（≥30 秒一批）单向发给主进程，带页面 / 生成中 / 节点数档位；⑤ 全部落在本机一份滚动文件（活过重启）；⑥ 用户「导出诊断包」，清单写明时间线三态、显卡与屏幕、工程体量数字；⑦ 我们读包定位。

**不做什么**：不改遥测告知范围，不往 `perf.session.summary` 加字段；不加界面，导出入口和反馈面板不动；不做 CPU profile，不开 `contentTracing`；不改保存路径、不改 `Atomics.wait`。**已知坑**：启动期的卡顿（模块装载、界面首次渲染）不算「用着卡」：监视器启动后 20 秒内，主进程读数和界面长帧都不记；睡眠 / 唤醒会让一个采样间隔跨过整段睡眠，`suspend` / `resume` 时丢弃当前窗口；主进程那一行的时间精确到 10 秒窗口末尾，时长是「最长一次采样间隔 − 半个间隔」的无偏估计（误差约 ±40ms）。

真实任务：① 真 Electron（隔离目录）给主进程注入一次 1200ms 同步睡眠，导出包里有一行 `main-stall` 标冻结；② 记录后退出、重开、再导出，上一次的行还在；③ 没开项目导出，体量数字写原因、不崩。

指标（每个点名量具）：
- 主指标：监视器空闲开销，60 秒主进程 CPU 增量（单核；登记表里写成每秒毫秒，1 个百分点 = 每秒 10ms，因为统计函数只留一位小数）。量具：性能场景 `main-stall-monitor-overhead`（新登记）。预算 ≤0.2 个百分点（= ≤2.0ms/s）；基线见报告（本卡写量具与实测读数，批准由协调做）。
- 质量指标：1200ms 注入的读数落在 1100–1400ms 且标冻结。量具：`tests/perf/canvas-scale/stallProbe.mjs`（真 Electron 阳性对照）。
- 护栏指标：无停顿时写盘次数 0；每秒唤醒增量 ≤50。量具：同一场景的计数断言（窗内计数防空断言）。
- 现场占比（出现 ≥1s 停顿的会话占比）：**未验证：缺量具**（需要上传，属遥测范围三，本卡不做）。
- 缺块次数（瓦片内存超限）：**未验证：缺量具**，不为它开 tracing、不加启动参数，所以不加类型。查了三处现成口子（真 Electron 43、渲染层与主进程各取一次，`stallProbe.mjs` 的 `missingTileSignals` 留了原始读数）：① 渲染层 `PerformanceObserver.supportedEntryTypes` 只有 `element, event, first-input, largest-contentful-paint, layout-shift, long-animation-frame, longtask, mark, measure, navigation, paint, resource, visibility-state`，没有瓦片 / 棋盘格 / 光栅类；② `app.getAppMetrics()` 每个进程只有 CPU（累计、百分比、空闲唤醒）和内存（工作集、峰值工作集），GPU 进程那一行也一样，读不出瓦片被丢；③ 仓内没有任何现成读数（`git grep -i checkerboard` 只命中 CSS 透明底图）。更深一层（Chromium 合成器的 tracing 分类和内部指标）按我的理解要开 tracing 或没有对外口子，这条没有逐页去读它的文档核实，也在范围外（不开 tracing），所以只记「缺量具」。

### ★1b 连带界面

不加界面。诊断包清单（`manifest.json`，给收包的人读）新增三块：`stallTimeline`（三态 + 行数）、`hardware`（显卡 / 屏幕 / 窗口）、`projectSize`（字节与节点数）。清单文字沿用现有写法（`what` 中文、`why` / 状态英文码），不进 i18n；因此不动 `check:i18n`。

## ★2 谁说了算

- 「卡顿时间线」→ 唯一 owner `electron/diagnostics/stallTimeline.ts`（行形状、限频、落盘、读回、三态）。契约 `electron/shared/contracts/stallTimeline.ts`。允许的消费者：监视器（写）、诊断包（读）。
- 「主进程停顿读数」→ 唯一 owner `electron/diagnostics/stallMonitor.ts`（生产直方图读法）。`tests/perf/canvas-scale/mainProbe.cjs` 不在 main 上，没有实验室那份直方图读法可删；`workbenchScenarios.mjs` 与 `windows-freeze-sweep.walk.mjs` 的往返采样器量的是 IPC 往返，不是事件循环直方图，不属本卡。
- 「场景档位（页面 / 生成中 / 节点数）」→ 口径沿用 `src/workbench/observability/perfScene.ts` 的 `readPerfScene()`；主进程只存渲染层最近报来的一份，不自己推。
- 状态默认归主进程（时间线文件、限频计数）；渲染层只报「看见了什么」。同一份事实一份：长帧由已有的 Long Animation Frames 观察者提供，不加 rAF、不加新观察者。碰 3 个概念（卡顿时间线、主进程停顿读数、诊断包清单）。没有靠「东西不见了」猜意图。
- 数门：`node scripts/door-map.mjs buildDiagnosticsBundle`（诊断包只有 `diagnosticsIpc.ts` 一个调用者）。

## ★3 一致与复用

复用：`electron/logging/logFiles.ts` 的 `createLogFileSink`（滚动、表头、吞异常）；`perfCollector.ts` 现成的 LoAF 观察者与 `setScene`；`electron/shared/contracts/perfTelemetry.ts` 的 `PERF_FIELD_VALUES`（页面 / 节点档位取值表）与 `countBucket`；`rendererLog.ts` 的单向 IPC + `assertTrustedFireAndForget` + 限流写法；`redact.ts` 的 `redactLogValue` 当敏感信息扫描。不自写：直方图（Node 标准）、滚动。自写登记 `stallMonitor.ts` 进 `docs/engineering/self-written.json`，理由是领域约束：把停顿归因到 Nomi 的页面和生成状态；直方图本身不自写。证据：`pnpm run check:self-written`。

## ★4 全状态

时间线三态（清单 `stallTimeline.state`）：
- `recorded` 有记录：文件里有通过白名单校验的行，清单写行数与「本次启动 N 行」（用户重启后导出时本次可以是 0，上次的行仍在）；
- `none-this-session` 本次没记到：监视器在跑，文件里没有可用行，清单写「本次没记到 ≥100ms 的主进程停顿」；文件不存在也写这句并标 `file: absent`；
- `monitor-not-running` 监视器没运行：清单写「停顿监视器未运行」和原因码（`not-installed` / `install-failed`）；旧行（若有）照常带上。
坏数据：整行不合白名单 / 半行 / 空文件 → 丢弃并计入 `droppedLines`，导出不崩；旧版升级上来没有文件 → `absent`。显卡信息取不到 → `unavailable` + 原因；没开项目 → 体量数字写 `no-active-project`。取消中 / 过期 / 能力不可用：不适用（本机文件，无外部依赖、不涉及模型）。

## ★7 性能（新增的运行时操作 = 事件循环监视器）

① 新增操作：主进程一个 80ms 间隔的直方图采样 + 每 10 秒读一次 + 有停顿才写一行本机文件；渲染层每 5 秒读一次场景（只在变化时发）、长帧每 30 秒最多一批。② 最坏规模：持续停顿风暴（每秒一次 ≥1 秒停顿，连续 1 小时）→ 每种类型每 10 秒最多一行，另每分钟一行汇总，文件总量有上限（见实现，单文件 192KiB，留一代）。③ 预算：空闲 60 秒主进程 CPU 增量 ≤0.2 个百分点（单核）；每秒唤醒增量 ≤50；无停顿时 0 次写盘。④ 场景 id：`main-stall-monitor-overhead`（`pnpm run perf:scenarios -- --id main-stall-monitor-overhead`）。

预算超了先调采样：实测（macOS M5、Electron 43.4.1、60 秒空闲、隐藏窗口，同一进程里监视器关 / 开对照）——20ms 间隔 CPU +0.43 个百分点、系统空闲唤醒每秒 +94（超预算）；50ms +0.19 / +39；64ms 两批十次中位约 0.16、最大 0.205（每秒 +31 次唤醒），贴着预算；100ms +0.08 / +19。取 80ms（预期约 0.12 / +25，实测见报告）：采样的固定开销约每次 90µs，反比于间隔。代价是时长读数有 ±半个间隔（±40ms）的无偏误差：≥140ms 的停顿必记，100ms 左右约一半，所以文案一律写「约 100ms 以上」。

## ★9 验收与回滚

验收清单（动手前写全；实现线逐条自验并附「反例 → 结果 → 证据」表，验收线只核这份）：
1. 阳性对照：真 Electron 里给主进程注入一次 1200ms 同步睡眠（`ipcProbe.cjs` 的 `mainRequire` 注入法，产品代码里不留测试入口），导出的包里有一行 `main-stall`、时长在 1100–1400ms、标冻结。量不到就停下报告。
2. ≥200ms 渲染层长帧进时间线，带页面和 `scene`（页面 / 生成中 / 节点数档位）。
3. `unresponsive` / `responsive` 两行都写得进去。
4. 记录后退出应用、重开、再导出：上一次的记录还在。
5. 三态都有测试：有记录 / 本次没记到 / 监视器没运行。
6. 隐私矩阵：遍历所有行类型，字段集合等于白名单；反例：往一行塞路径或提示词，测试要红；真实生成的时间线文件和显卡信息过现有敏感信息扫描（`redactLogValue` 不改一个字）。
7. 上限：模拟风暴（每秒一次 ≥1 秒停顿，1 小时量），文件总量不超过上限，行数符合限频。
8. 坏数据：文件写坏 / 半行 / 空文件，导出不崩、清单照实说；旧版升级没有这个文件，同样不崩。
9. 没开项目导出：不崩，体量数字写原因。
10. 反例：把 ≥100ms 门槛改成永不触发，第 1 条要红；按字节还原，写清红了几项。
11. 性能：★7 的数字；无停顿时 0 次写盘有计数断言，窗内计数防空断言（`docs/lessons/complexity-invariants-need-counters-not-wall-clock.md`）。

这一类还会从哪回来：别的平台（Windows 的 `monitorEventLoopDelay` 与路径行为、睡眠唤醒语义）——**没核，记入 Windows 验证任务**；别的入口（辅助窗口卡死不记，只记主窗口）；旧数据（旧版没有文件）已测；更大体量工程（节点数在 worker 里解析，不堵主进程）。

回滚：`installStallMonitor()` 在 `mainProcessLifecycle.ts` 里一行装入，回滚 = 删这一行（时间线文件留着无害，清单会写「监视器未运行」）。

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能
