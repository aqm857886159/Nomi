# 性能场景：新功能必带性能分析和可重跑的脚本

> 用户 2026-10-11：「新增功能都要考虑性能分析，防止以后出现大量的性能问题、卡顿问题；每一个新功能都得做，而且自己弄好测试脚本，以后用来测试性能。」
> 病因：新功能不量性能，卡顿到用户手里才发现（2026-10-10 用户反馈：选中节点卡、拖组卡）。
> 规矩正本 `rules.json` 的 `P5`；设计卡 ★7（`design-card.md`）；登记表 `tests/perf/scenarios/`；跑法 `pnpm run perf:scenarios`。

## 谁要做

新增功能（`feat` 前缀的 PR，或功能分类里有「新增功能 / 性能」）：

1. 设计卡填 ★7：新增了哪些用户操作、最坏规模、每个操作的预算、覆盖它的场景 id + 基线数。
2. 每个新增操作登记成一个性能场景（下面的流程），跑出基线。
3. PR 正文 `## 验收证据` 交一行：`- perf-scenario：<场景 id> 中位数 X / p95 Y / 预算 Z / 原始结果 <路径>`（原始结果一项自 2026-10-22 起要求，见文末「证据判对不对」）。

路径会自动推出这一类：改 `src/**/*.tsx`（设计实验室除外）、画布 / 时间轴目录、任务 / 队列 / 取消类文件、新增 `AbortController`。推出了而这个改动确实碰不到交互、规模、长任务（例如只改一行文案）：证据行写 `- perf-scenario：不适用：<具体理由>`。**「未验证」不算通过**——没有量具就先写量具。

纯文档 / 测试 / 门岗 / 根因明确的小修不要求。

## 主进程与出错路径

改 `electron/jsonFile.ts`、`electron/{workspace,assets,events,logging,productionRun}/` 或 `src/workbench/project/` 的生产文件，路径路由会推出 `perf`，PR 要交 `perf-scenario` 证据。确实没有性能影响时写具体的不适用理由；新增路由不会把这些路径塞进 Linux 画布专用的 CI 性能车道。

`pnpm exec vitest run electron/workspace/saveFaultSweep.test.ts` 真跑 `saveWorkspaceProject`，按项目/隔离 settings 路径前缀（包含目录本身及子路径，排除同名前缀兄弟目录）和 open/write/fsync/rename/remove/mkdir/read 类别扫描第 N 次失败，覆盖 EBUSY、EPERM、EACCES、ENOSPC、EEXIST 的一次和持续模式。fd 操作在保存窗内全部归因计数，不能拿 fd 当路径过滤。`Atomics.wait` 只累计请求毫秒并推进假时钟；不睡、不拿墙钟判红。物理 fsync 在夹具里替换为可注入桩，不能把它当掉电持久性验证。

测试里的 `SAVE_DEBT_JSON` 记录精确来源路径、请求睡眠上限和大 JSON 次数。2026-10-30 合成工程的初始读数：

| 已知超标 | 测得的精确工作量 | 计量边界 |
|---|---|---|
| `electron/jsonFile.ts` 同步重试 | 单次重试 400ms；整条保存扫描最大 5200ms | project/read 持续共享冲突触发多轮 owner 读取；不是一个连续 5200ms 的事件循环停顿 |
| `electron/workspace/workspaceRegistry.ts` 自旋 | 3010ms | settings/mkdir 持续 EEXIST；每次 10ms，严格大于 3000ms 截止条件 |
| ≥1MB JSON stringify / parse | 12 / 14 次每保存 | 1MiB 合成文本；只数保存窗，排除造夹具和事后验完整性 |

这些请求毫秒与真实 I/O 墙钟分开：约 420ms 的孤立 rename 墙钟还含文件操作与调度，不应要求桩凑成 420。旧债上限与次数只许降，抬高表但不改工作量会被实测相等断言拦住；后续还与可信 merge-base 的表比较。新睡眠来源直接红。已登记的工作量不单独拦无关 PR，完整性失败仍然红，不能往睡眠豁免里塞清理问题。

当前扫描还检出了**未豁免的完整性失败**：一次 ENOSPC 注入到项目的第 3 次 open（`.nomi` 目录）后，旧 JSON 完整，但 manifest 锁残留。该测试目前为红，须由保存修复线处理，不能把本量具或保存链报为已验收。主进程禁止新增同步等待交给已有 ESLint `no-restricted-syntax`；六处存量在 `eslint-suppressions.json` 按文件 × 规则计数。新增报错，删掉却不收紧会报 unused suppressions；不使用忽略 unused 的参数。

**尚无对应真实 Electron 性能场景的入口**：生成结果完成后下载/落盘/缩略图/自动保存；1/10/25MB 工程编辑触发保存；连续失败 60 秒的自动保存次数与恢复；旧工程迁移写回；保存链以外的资产/上传/配置共享重试；真实 Windows 文件句柄、同步盘、网络盘和低配档。本 Node 扫描不证明这些路径的事件循环停顿、renderer 帧间隔、主线程忙碌或掉电安全。现有“生成中”场景的供应商一直返回生成中，也不等于覆盖了结果落地。

后续实验室场景拟量 `mainLoopMax`、`mainSyncSleepMs`、`autosaveCount`，与已有 `mainRoundTripMax`、`frameGapP95`、`longTasks` 对照；100ms 主进程响应、33ms 帧间隔及 0 长任务的依据沿用既有预算，新增预算、场景和健康基线仍须独立登记与实测。本改动没有新增这些指标或场景，没有现场监测、遥测或 Windows 夜跑。

## 默认预算（功能有理由偏离就在 ★7 写理由）

| 指标 | 默认预算 |
|---|---|
| 操作到可见反馈（response） | ≤100ms，p95 ≤150ms |
| 拖动 / 平移 / 缩放的帧间隔（frameGapP95） | p95 ≤2 帧（33ms） |
| 交互期间 >50ms 的长任务（longTasks） | 0 个 |
| 打开到能操作（openToInteractive） | ≤1s @100 节点 |
| 面板 / 浮层开着不动时的主线程忙碌占比（idleBusyPct） | ≤1%（同一编辑器不开面板的对照约 0.4–0.6%）；每秒读矩形次数（idleRectReadsPerSec）、布局 + 样式重算次数（idleLayoutsPerSec）只打印，空闲应接近 0 |

登记表里的 `budget` 对应 `metrics[0]`（主指标）；其余指标只在表里打印。

## 登记一个新场景

1. 找现有量具，把新操作写成它的**新场景或新参数**，不自写剖析器（P0：Playwright + CDP + `PerformanceObserver`）：
   - `tests/perf/canvas-scale-bench.mjs`：画布手势的帧间隔 / 长任务（拖动、框选、缩放、平移），可选规模 `--scales`、场景 `--scenarios`；
     工作台场景（`tests/perf/canvas-scale/workbenchScenarios.mjs`，点名才跑）：点一下到界面到位的 `response`（选中出生成框、连续新建、切阶段、画布 ⇄ 列表、长文打字）、时间轴播放 / 拖动、后台在忙时平移（生成中 / Agent 流式，另记主进程往返 `mainRoundTripMax`）。「操作 → 界面到位」的计时器只有一个：`tests/perf/canvas-scale/responseTimer.mjs`；
   - `tests/ux/project-open-stages.e2e.mjs`：打开项目分阶段计时；`--library-projects N` 另量「回项目库 → N+1 张卡到位」；
   - 其余量具（`tests/ux/windows-freeze-sweep.walk.mjs`、`tests/ux/canvas-real-suite.mjs`）要用时，先在 `scripts/perf-scenarios-lib.mjs` 的 `DRIVERS` 里补它的参数拼法和读结果（几行），再登记场景。
2. 新建 `tests/perf/scenarios/<id>.json`（id 小写字母数字加连字符，文件名同 id）：

```json
{
  "id": "canvas-drag-20-nodes",
  "feature": "画布多选 20 个节点一起拖动",
  "script": "tests/perf/canvas-scale-bench.mjs",
  "args": ["--scales", "I150", "--scenarios", "drag-nodes-20"],
  "scale": "150 个图片节点",
  "metrics": ["frameGapP95", "longTasks"],
  "budget": 33,
  "budgetStatus": "proposed",
  "budgetBasis": "60Hz 下 p95 帧间隔不超过 2 帧（33ms）；同类场景基线 …",
  "baseline": { "median": 0, "p95": 0, "runs": 0, "machine": "", "date": "", "commit": "" }
}
```

`budgetStatus`：`proposed` = 实现线提议的预算（必须在 `budgetBasis` 写依据：人的感知阈值、现有同类场景的数字），安静窗口量完基线后由协调改成 `approved`；不写 = 已定。

**已知超预算（欠账）**：基线量出来就比预算慢、修复线还没修完的，登记 `budgetDebt`：

```json
"budgetDebt": { "owner": "P-plan", "state": "assigned", "note": "为什么慢、修什么（一句话）", "since": "2026-10-16" }
```

`state`：`assigned`（已派）/ `unassigned`（待派）/ `needs-measurement`（根因还要量）。规矩是一把棘轮：

- 门岗不因为它超预算而拦无关的 PR（统一跑法判 `known-debt`，不算失败）；
- 但它不许再变差：中位数比欠账基线差超过 20% 照样红（统一跑法 `regression`、PR 证据行红）；
- 超预算的基线不登记欠账，结构门岗红；修好了（基线回到预算内）还挂着欠账，也红——修复线量完新基线顺手删掉欠账。

**待测场景**：登记了、还差一步才能量（量具或夹具没备好）的，写 `"measurement": { "state": "pending", "reason": "还差哪一步" }`。只许 `proposed` 预算、不许有基线和欠账；整表跑时跳过，点名 `--id` 量完写基线时自动去掉 `measurement`。

**预算比哪个统计层级**（2026-10-21）：`budget` 默认比「跨轮中位数」；场景写 `"budgetStatistic": "p95"` 就比「跨轮 p95」（按键到上屏这类本身是每轮 p95 的指标，要声明按哪层比，别靠猜）。`response` 类另有 p95 尾部预算：显式 `"p95Budget": N`，不写 = 预算 × 1.5（即默认预算表的「≤100ms，p95 ≤150ms」）；登记了欠账的存量场景不判尾部预算。不要把所有场景机械改成「p95 的 p95」。

3. `pnpm run perf:scenarios -- --smoke --id <id>`（1 次冒烟，确认脚本跑得通），再 `pnpm run perf:scenarios -- --id <id> --update-baseline` 写基线（≥5 次；跑的时候别的线在忙就加 `--noisy`，基线标 `noisy: true`，退化只提示）。写基线只许协调会话或验收线做，实现线把冒烟和 5 次的数字贴进 PR 即可。
4. `pnpm run check:perf-scenarios` 通过（登记表结构门岗）。

## 统一跑法

```
pnpm run build                                      # 量具跑的是构建产物
pnpm run perf:scenarios                             # 登记表全部，每个 ≥5 次，出对照预算和基线的表
pnpm run perf:scenarios -- --id <id> --runs 7
pnpm run perf:scenarios -- --list
pnpm run perf:scenarios -- --out report.json        # 另存 JSON（夜跑用）
pnpm run perf:scenarios -- --measure-only --out perf-<机器>.json   # 只量不写：不要求已有基线、也不写基线（另一台机器交数字用）
```

Windows 上 `pnpm run perf:scenarios` 外面那层 `python3 scripts/with-gates-lock.py` 可能撞上应用商店的 `python3` 别名（退出 49、一行输出都没有，见 `docs/lessons/windows-agent-toolchain-traps.md` 第 4 条）；直接用 `node scripts/perf-scenarios.mjs <同样的参数>`。

窗口在屏幕外、只用临时目录、不连真实资料（量具自己保证）。判定：中位数 > 预算 = `over-budget`（登记了欠账、且没比欠账基线差 >20% 的判 `known-debt`，不算失败）；中位数比基线差 >20% = `regression`（基线标了 `noisy` 只提示）；没采到数据 = `no-data`；待测场景 = `pending`（跳过）。`over-budget` / `regression` / `no-data` 让命令退出码为 1。

诊断腿（定根因用，数字不进基线）：`--diag-out <目录>`（canvas-scale-bench、project-open-stages、document-switch-bench 都认）在第一个计数样本的窗口里抓 CDP trace、渲染 / 主进程 CPU profile、IPC 计时、store 写、合成层（`tests/perf/canvas-scale/diagnostics.mjs`）；读法 `node tests/perf/canvas-scale/profileReport.mjs <x.cpuprofile|x.trace.json>`（渲染层先 `npx vite build --mode production --sourcemap` 才能还原到源文件）。trace 一次几十 MB，目录放在空间够的盘上。

## 门岗

| 门岗 | 管什么 |
|---|---|
| `check:perf-scenarios`（结构，进 `gates:contracts` 和推送前总跑集） | 登记表每条：id 唯一且同文件名、script 存在且是 `DRIVERS` 里有适配的现有量具、metrics 合法且量具量得出、budget 是正数、`budgetStatus` 只能是 proposed / approved 且提议的预算要写 `budgetBasis`、baseline 的 median / p95 / runs(≥5) 是数字、machine / date / commit 不空；超预算的基线必须登记 `budgetDebt`、达标了必须删掉；待测场景（`measurement`）只许 proposed、不许有基线 |
| `check:pr-judgement` | 路径推出「新增功能 / 性能」类的 PR，`## 验收证据` 必须有 `perf-scenario` 行：格式对、id 在登记表里、写的预算等于登记的预算、中位数不超预算（欠账场景：不比欠账基线差 >20%）、「未验证」红、「不适用」要有具体理由；2026-10-11 之前开的 PR 不要求 |

已知缺口：`feat` 前缀本身不是路径，纯后端新增（路径没命中上面几类）的新功能靠设计卡 ★7 自己勾「新增功能 / 性能」，门岗拦不到；合并前扫描 / 独立验收线核设计卡时看这一项。

## 夜跑（只设计，本 PR 不加工作流）

目标：老功能不因后续改动悄悄变慢。做法：

- 每晚在一台**固定的安静机器**上 `pnpm run build && pnpm run perf:scenarios -- --out perf-nightly.json`；
- 退化（中位数比基线差 >20%）或超预算：输出报告并开一条待办，不自动改任何东西；
- 基线只在安静窗口里更新（`--update-baseline`，不加 `--noisy`），由协调会话或验收线做；
- 2026-10-06 用户定过「不设定时触发、全量由用户手动触发」（`experience-system.md`）：夜跑要不要上，需要用户点头；在那之前，同一条命令就是 `Full Experience Run` 全量跑里的 `perf-real-scale` 层。

## 内联画板场景（2026-10-17，#1189 审查 F7）

量具 `tests/ux/whiteboard-perf.probe.mjs`（`--scene` 选场景；CDP `Performance.getMetrics` + 页内 rAF / PerformanceObserver + 共用 response 计时器），素材固定用仓库自带的真实镜头抽帧（`--repo-media`，640×360），不冒充 4K 结论；默认模式要用素材库里的 4K 片，库缺了就红。

| 场景 id | 量什么 | 主指标 |
|---|---|---|
| `inline-whiteboard-idle-panel` | 面板开着、什么都不动：主线程忙碌占比、每秒读矩形、布局 + 样式重算 | idleBusyPct（另两项只看） |
| `inline-whiteboard-open` | 点「画板」到能操作（画布起来、原图导入完） | openToInteractive |
| `inline-whiteboard-type` | 在文字对象里逐键输入 12 个字，每键到画面重排的 p95 | response |
| `inline-whiteboard-many-images` | 画布上 25 张可见图片（6 张不同真实帧）时在画板里拖图 | frameGapP95（长任务只看） |
| `inline-whiteboard-moving-panel` | 面板开着、画布滚轮缩放，面板偏离锚点的帧数 | panelFramesOff |

`inline-whiteboard-drag`（整条走查里的拖动）是更早登记的，量的是另一件事，不并入。

## 种子场景

`canvas-drag-20-nodes`（拖动帧间隔）、`project-open-100-nodes`（打开到能操作）：先登记这两条做样例，基线是本机有其它线在跑时量的（`noisy: true`）。

## 卡顿场景表（2026-10-15，用户 10-10「卡顿的场景需要多个场景测试」）

十类场景全部登记在 `tests/perf/scenarios/`（共 24 条新场景，连同原有的共 28 条已测、1 条待测）。基线 2026-10-16 在安静窗口量（每条 1 次预热 + 5 次），预算由协调定为 approved；超预算的 7 条登记了欠账（`--list` 里标「欠账：负责线」）。

| # | 场景 | 场景 id | 主指标 |
|---|---|---|---|
| ① | 选中节点 → 生成框出现（空 / 有图 / 视频 × 10 / 100 / 200；库里项目多） | `canvas-select-composer-{empty,image,video}-{10,100,200}`、`canvas-select-composer-image-100-many-projects` | response |
| ② | 拖单卡 / 拖组框 / 多选拖 | `canvas-drag-single-node`、`canvas-drag-group-frame`、`canvas-drag-20-nodes` | frameGapP95 |
| ③ | 有大图、有视频的画布上平移 / 缩放 | `canvas-pan-mixed-media`、`canvas-wheel-zoom-mixed-media` | frameGapP95 |
| ④ | 连续新建节点 | `canvas-create-node-burst` | response |
| ⑤ | 切创作 / 生成 / 预览；画布 ⇄ 列表 | `workbench-switch-stages`、`workbench-switch-canvas-list` | response |
| ⑥ | 打开项目到能操作；项目库列表；旧项目第一次打开（待测） | `project-open-100-nodes`、`project-library-list`、`project-open-legacy-first-open` | openToInteractive / response |
| ⑦ | 文稿里长文打字 | `document-long-typing` | response（按键到上屏 p95） |
| ⑧ | 多个节点同时在生成时操作画布 | `canvas-pan-while-generating`、`main-process-while-generating` | frameGapP95 / mainRoundTripMax |
| ⑨ | Agent 流式输出时操作画布 | `canvas-pan-while-agent-streaming` | frameGapP95 |
| ⑩ | 预览播放、时间轴拖动 | `timeline-preview-play`、`timeline-scrub` | frameGapP95 |

⑧ ⑨ 的后台负载是本机假供应商（`tests/ux/process-feedback-real-fixture.mjs` 一直回「生成中」；`tests/ux/agent-runtime-fixture.mjs` 的 `stream` 应答一字一字吐正文），主进程挂走查网络闸（只放行本机）：零花费、零外网。

一键跑（Mac / Windows 同一条；先关掉别的 Nomi / Electron，别的活停下再跑，数字才有意义）：

```
pnpm install && pnpm run build
node scripts/perf-scenarios.mjs --measure-only --out perf-$(node -p "process.platform")-$(git rev-parse --short HEAD).json
```

只跑一类：加 `--id <场景 id>`（一次一个）。看「随 N 怎么长」的整条曲线：`node tests/perf/canvas-scale-bench.mjs --scales E10,E100,E200,I10,I100,I200,V10,V100,V200 --scenarios select-composer --runs 5 --label select-curve`。

## 证据判「对不对」（2026-10-22 起开的 PR 生效，不追溯）

`## 验收证据` 的 `perf-scenario` 行，旧口径只看「有一行、预算对得上、中位数不超」。新口径（生效日在 `test-routing.json` 的 `evidenceJudgement.effectiveFrom`，CI 取 base 版本；此日期前开的 PR 照旧；创建时间未知按已生效）：

`- perf-scenario：<id> 中位数 X / p95 Y / 预算 Z / 原始结果 <仓库内路径>`

- **pending 不能算达标**：场景是待测（`measurement.state = pending`），或原始结果里这一轮是 pending，一律红。先量出基线再交证据。
- **原始结果要能读到**：`pnpm run perf:scenarios --id <id> --measure-only --out <文件>` 的 JSON，随 PR 提交（CI 从 PR 头读）；读不到、不是 JSON、里面没有这个场景的运行记录，红。
- **样本数够、数字有限**：主指标 `runs` ≥ 5；median / p95 必须是有限数（null / NaN / Infinity 红）。
- **正文数字要和原始结果对上**（误差 0.1）：正文自己写一行数字不算数。
- **按声明的层级和适用的预算判**：见上面「预算比哪个统计层级」；p95 声明的场景比 p95，response 类另判 p95 尾部预算。
- **旧欠账**只对登记了 `budgetDebt` 的存量场景放行（棘轮照旧）；待测（pending）不是欠账，不放行。
- 「不适用：理由」照旧，不要求原始结果。

- **场景文件默认全拦、白名单放行**（2026-10-22）：场景文件按 base 与 head 的整份规范化内容对比；白名单（PR 可以自己改）只有 `feature` / `scale` / `group` 描述字段和 `baseline` 的 `machine` / `date` / `commit`，**其余任何差异**（预算、统计层级、尾部预算、主指标、预算状态、欠账 / 噪声、基线的 median / p95 / runs、待测状态、量具与参数、`budgetBasis`、以后新加的字段、整个文件被删、PR 新增的场景）判定一律用 base 的值，要用 PR 自己的值得协调确认（`node scripts/coord-approve.mjs --pr <号> --perf <场景 id>`，哈希绑整份规范化内容）。`merge-preflight` 没有记录红，CI 只提示「待协调确认」。机制见 `delivery-and-review.md` 的「协调确认记录」。基线刷新的批量确认是后续跟进。

回滚：删掉 `test-routing.json` 里的 `evidenceJudgement` 一节，三处新口径同时退回旧判据。

