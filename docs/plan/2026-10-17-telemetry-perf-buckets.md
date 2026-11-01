# 设计卡：遥测告知口径 + 界面流畅度分档

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 用户 2026-10-16 拍板「按推荐走」（选项 A）：先把告知文字写准、改了范围就再确认一次，再加性能分档事件；反馈附带卡顿数字；官网和 README 里「no telemetry」的说法改准。

```
改动名：遥测告知口径 + 界面流畅度分档    线/负责人：W-perftel    类别：[新界面]（再确认卡、设置页一块、反馈卡一行）
```

## 问题

线上收到的遥测里没有任何性能数字。群友说卡，只能靠截图和聊天描述猜。要加数字，就得动「用户同意过什么」：现有告知只覆盖功能使用、耗时区间、成败、失败类别、Agent 工具轨迹，没有覆盖交互延迟、掉帧、画布规模、设备档位。

## 设计卡

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我已经开着「帮助改进 Nomi」，更新后第一次打开 Agent 面板，我在原来那张询问卡的位置看到「Nomi 想多看一项：界面流畅度」，说清多了什么、不含什么，两个同尺寸的钮「同意新增 / 保持原样」。我也可以在设置 → 隐私与诊断里点「确认新范围」。没确认前，新字段一条都不发，原来的统计照旧。新用户首次询问卡的文字直接是新范围。点反馈时，卡上写着会附带「卡顿数字」，点发送就是同意。不做：不弹第二个对话框、不做「稍后再说」、不收原始毫秒 / 内容 / 路径 / 显卡型号。已知坑：从没打开过 Agent 面板的老用户要到设置里才看到确认入口（再确认卡只在 Agent 空态出现，与首次询问同位置）。 | 截图 7 张（见 PR） |
| ★1b 连带界面 | 设置页「隐私与诊断」说明文字、Agent 同意卡、反馈卡附带行、官网首页与功能页、README 中英。 | `docs/plan` 本文 + `marketing/*.html` 重新生成 |
| ★2 谁说了算 | 「用户同意的告知范围版本」→ 主进程 `telemetrySettings.scopeVersion`（唯一 owner），当前版本常量 `TELEMETRY_SCOPE_VERSION`；每个事件需要的最低版本在 `TELEMETRY_EVENT_MIN_SCOPE`（穷举 Record，新增事件不标版本编译不过）；入队门在 `enqueueTelemetryEvent`。「分档字段取值表」→ `electron/shared/contracts/perfTelemetry.ts` 的 `PERF_FIELD_VALUES`。渲染层只读，不自报同意。 | `pnpm exec vitest run electron/telemetry electron/shared/contracts` |
| ★3 一致与复用 | 采集：浏览器标准 Event Timing（与 INP 同口径）+ Long Animation Frames，不自写剖析器（P0）。再确认：复用首次询问卡组件和位置（`V4ConsentCard`，加 `scope` 形态），不新造界面；设置页复用 `DesignButton`。传输：沿用 `telemetry.track` → outbox → 自建接收端，一行没重写。反馈：沿用 `buildFeedbackReport` 的清单机制，新增一个附件项。旧的 `forceVisible` 参数换成 `force`（同提交删旧）。 | 代码 |
| ★4 全状态 | 遥测关：不发、不入队（测试）。开着且同意旧范围：旧事件照发，新事件不入队；确认后才入队。关掉再打开：范围回到 1 再升回 2（每次打开都是看着当前文案打开）。接口不支持（缺 Event Timing 或 LoAF）：不出汇总，反馈里写 `perf-unavailable`。窗口不足 1 分钟：不发。「取消中 / 过期」不适用。 | 测试表 |
| ★7 性能（遥测自身开销） | ①新增的操作：观察者回调（每个交互 / 长帧一次）、会话边界汇总一次。②最坏规模：一个窗口 1000 个不同交互（超出丢最老的）；重度使用下 Event Timing 条目数以万计，但只有带 interactionId 的才入表。③预算：回调 O(1)（Map 写一次）；汇总在空闲回调里做（隐藏 / 关闭时直接做，对几百个数排序）；一个窗口只发一条（每 30 分钟或每次隐藏，窗口不足 1 分钟不发）。④确定性计数（不靠毫秒）：观察者注册 2 个、页面切换 0 新增；内存上限 1000 条目；每窗口 1 次发送——都在 `perfCollector.test.ts`。毫秒数：采集永远在跑，所以现有画布场景自带它的开销，量法见 PR 正文 `perf-scenario` 一行（对比 main 与本分支的 `canvas-drag-single-node`，待安静窗口）。 | `pnpm exec vitest run src/workbench/observability/perfCollector.test.ts` |
| ★9 验收与回滚 | 验收：另一条线用设计实验室走查 `design-lab:walk:v4`、`design-lab:walk:settings` 看 7 张图，并在真 App（屏外）里把遥测打开后查本机待发摘要出现 `perf.session.summary`。回滚：把 `TELEMETRY_EVENT_MIN_SCOPE['perf.session.summary']` 之外的东西都不动，直接删事件名与 `startPerfCollector()` 一行即可，旧范围用户不受影响（`scopeVersion` 多出的一格读时被忽略）。 | 人工 + 测试 |

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [x] 新增功能 / 性能

## 事件字段表（`perf.session.summary`，全部是分档标签，没有原始数）

| 字段 | 取值 | 含义 |
|---|---|---|
| interactionP75 / interactionP95 | none · lt-100 · 100-200 · 200-500 · gt-500（ms） | 会话内「点击 / 按键到下一帧」耗时分位，同 INP 口径 |
| longFramesPerMin | 0 · 1-3 · 4-10 · gt-10 | 超过 50ms 的长帧，每分钟次数 |
| longestFrame | none · 50-100 · 100-250 · 250-1000 · gt-1000（ms） | 最长一帧 |
| observedMinutes | lt-5 · 5-30 · gt-30 | 这份汇总覆盖了多久 |
| page | library · creation · storyboard · generation · preview | 汇总时所在页 |
| nodes / imageNodes | 0 · 1-20 · 21-100 · 101-300 · gt-300 | 画布节点数 / 图片节点数 |
| generating | true / false | 汇总时是否有生成在跑 |
| cpuCores | le4 · 5-8 · 9-16 · gt16 · unknown | 逻辑核数 |
| memoryGb | le2 · 4 · 8plus · unknown | 浏览器粗化过的设备内存 |

平台、系统语言、版本（主次号）、UTC 日期仍由信封里已有的 `systemProps` 给。不报：显卡型号、内容、路径、模型名、连接名。主进程卡顿没有现成往返口径，本期只报渲染侧。

## 官网与 README 的改法

「No account, no telemetry」改成「No account. 默认什么都不发；匿名使用统计需要你自愿开启，随时能关」（中文同义）。改动处：`README.md`、`README.zh-CN.md`、`scripts/marketing/content.mjs`、`scripts/marketing/features.mjs`，并用 `build-marketing-site.mjs` 重新生成 `marketing/*.html` 四个页面。

## 补、换、删

补。理由：遥测传输、同意合同、白名单、本地摘要、删除都已存在，缺的只是一类新数据和它的告知；新增一个事件名、一个范围版本号、一个采集模块，没有可以替换或删除的旧实现（旧的 `forceVisible` 同提交换成 `force`）。

## 按钮普查（本 PR 新增 / 改动的可点目标）

| 目标 | 设计来源 / 组件 | 状态 | 可访问名（词典键） | 用户动作 | 界面状态与副作用 | 测试 / 证据 |
|---|---|---|---|---|---|---|
| 再确认卡「同意新增」（主） | 首次询问卡同一组件 `V4ConsentCard`，`scope` 形态，`DecisionBar` 最右 | 仅在遥测开着、范围版本 < 2、这台机器没问过时出现 | `agentPanelV4.consent.scopeAccept` | 点击 | 写 `enabled:true` → 主进程范围版本升到 2；卡收起；新事件开始入队 | `telemetry-scope-reconfirm.walk.mjs`；设计实验室 `v4-consent-scope-reask`（zh 亮 / en 暗） |
| 再确认卡「保持原样」（拒绝） | 同上，与主动作同尺寸 | 同上 | `agentPanelV4.consent.scopeDecline` | 点击 | 只记「问过了」；范围保持 1，新事件不入队，原统计照旧 | `perfCollector` 不受影响；`telemetryOutbox.test.ts` 旧范围用例 |
| 设置「同意新增」 | `TelemetrySection` 内一块，`DesignButton` | 遥测开着且范围版本 < 2 时出现；确认后消失 | `settings.general.telemetry.scopeConfirm` | 点击 | 同上，并记「问过了」让 Agent 面板的卡不再弹 | 设计实验室 `privacy-05-scope-reask-en-dark` |
| 反馈卡「附带」行 | 现有 `FeedbackReportCard`，只改文字 | 常驻 | `feedbackReport.attaches` | 无（「查看」沿用现有） | 清单里多一项 `perf/summary.json` 或写明 `perf-unavailable` | `feedbackReport.test.ts` |

## 先查别人

问题：线上的「界面流畅度」怎么采、怎么汇总。我们自己写的只有分档表和告知范围版本（领域约束：用户同意了什么）；采集和分位不自写剖析器。

1. 依赖里已有？没有 INP / 长帧采集库。`package.json` 里没有 `web-vitals`。
2. 仓库里已有？量具侧已经只用浏览器标准：`tests/perf/canvas-scale-bench.mjs:226`（`PerformanceObserver` 记长任务）、`tests/perf/canvas-scale/responseTimer.mjs:5`（「不自写剖析器」）。线上侧没有。传输、同意合同、白名单、发件箱沿用 `electron/telemetry/intakeClient.ts:1` 起的整条管线，一行没重写。
3. 生态里已有？
   - Google `web-vitals`（Context7 `/googlechrome/web-vitals`，<https://github.com/googlechrome/web-vitals/blob/main/README.md>）：`onINP` 每个页面只回**一个** INP 值，并带事件目标等归因；不给分位分布，也不数长帧。我们要的是会话内 p75 / p95 的分档和每分钟长帧次数。它和我们用的是同一个底层标准接口，多一层依赖换不来我们要的统计，还会带出交互目标选择器这类我们明确不收的内容。不接的理由是它的统计口径不是我们要的那一个，不是「不想接」。
   - MDN Event Timing：<https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEventTiming>（`interactionId`、`durationThreshold` 最小 16ms，与 INP 同口径）；web.dev INP：<https://web.dev/articles/inp>（良好 ≤200ms、较差 >500ms，分档边界取自这里）。
   - Long Animation Frames：<https://developer.chrome.com/docs/web-platform/long-animation-frames>（>50ms 的长帧，Chromium 123 起；Electron 43 内置 Chromium 远高于此，且代码里先问 `supportedEntryTypes`，缺一个就不出汇总）。
4. TikHub 自媒体里怎么说？不适用：这是浏览器性能接口的用法，不是创作者生态里的问题。
5. 结论：用已有标准接口 + 自研分档；`web-vitals` 不接（口径不对，见上）。登记：`docs/engineering/self-written.json` 的 `telemetry-pipeline` 条已补 `perfTelemetry.ts` 和上述标准。
