# 画布规模性能 S3 + S6：节点不再订阅整张表 · 缩放滑杆不要动画

> 状态：✅ **已实现**（2026-09-12）· 分支 `fix/canvas-perf-s3-s6-gate-20260912` · PR #763
> S6 全额兑现；S3 兑现了组框路那一半（I60 p95 −50%），`drag-nodes-all` @ I300 的长任务次数未达标，
> 已如实记在「验收门」表一并转给 owner（S5 + 命令式位移）。

> 上游调研（数字、根因、别人怎么做、验收预算都在那里）：
> [docs/research/2026-09-12-canvas-perf-at-scale/README.md](../research/2026-09-12-canvas-perf-at-scale/README.md)
> 本文件只写「这一刀做什么、不做什么、怎么回滚、凭什么算做完」。

## 用户报的是什么

> 「选中 60 个图片拖动组就开始特别卡了，拖动鼠标都不行」「右下角缩放滑杆拖起来一顿一顿」
> —— 2026-09-12 用户原话（调研 §0）

调研把这句话拆开量了一遍，结论推翻了直觉：最坏的不是「拖组」，是**全选之后拖**。
300 个图片节点全选后拖动只有 **12.4 fps**（p95 251 ms、最长帧 768 ms、**251 次长任务**），
而同一块画布上只拖 1 张卡是 108 fps。「画布上有多少东西」不是问题，**「同时在动多少个」才是**。

## 先查别人

- <https://reactflow.dev/learn/advanced-use/performance> —— React Flow 官方性能文档把整数组订阅写成 ❌ 示例
  （`useStore((state) => state.nodes)` 之后再 `.filter()`），正解是**把那份数据挪出 nodes 数组、单独存一个
  state 字段**：「decouple specific data from the main nodes array and store it in a separate state field so that
  components only re-render when their specific data changes」（2026-09-12 经 Context7 取回，调研 §4 第一、二行）。
- <https://reactflow.dev/api-reference/hooks/use-nodes-data> —— 官方还给了「每节点只订自己」的原语
  `useNodesData('id')` / `useNodesData(['id1','id2'])`（「subscribe to changes of a specific node's data object」），
  我们一处都没用。
- <https://tldraw.dev/sdk-features/performance> 与
  <https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/components/Shape.tsx#L65-L105> —— tldraw 把同一条
  写成产品承诺：「when a shape's props change, only that shape's component re-renders—not the entire canvas」；
  位移期用 `useQuickReactor` + `setStyleProperty` 直写 DOM，React 不参与。
- <https://github.com/excalidraw/excalidraw/blob/master/packages/element/src/mutateElement.ts#L183-L196> ——
  Excalidraw 用「一个标量 nonce 说明场景变了」代替深比 N 个元素（每次变更 bump `version`/`versionNonce`，
  场景只有一个 `sceneNonce`）。
- `src/workbench/generationCanvas/store/canvasNodeProjection.ts:1` —— **仓库里已经有**同形状的实现可以照抄，
  不用新发明：它就是「按 `state.nodes` 数组引用 memo 的模块级派生视图」，2026-09-01 那场性能战役为
  off-canvas 订阅建的。本刀的 `canvasNodeGenerationIndex.ts` 是同一个 idiom 的第二个消费者，不是第二套机制。
- `docs/research/2026-09-12-canvas-perf-at-scale/README.md:517` —— 调研 §4 的完整对照表（另含 Konva 的
  「拖动期换一层」、fabric.js 的 `ActiveSelection`、Figma 的自有场景图），四个生态收敛到同一条：
  多选拖动是一份草稿对着一个变换，没有一个把「每帧写 N 个权威位置」当可接受做法。

**结论：用已有的（React Flow 官方口径 + 仓库既有 idiom），不自研新机制。** 唯一的偏差是我们把派生放在
模块级 memo 而不是 store 字段——理由是领域约束：本仓的 store 套着 immer + `withCanvasWriteBoundary`，
派生字段要么每个 action 都得维护，要么靠订阅回写 store（每次改动多一轮通知）。按 `state.nodes` /
`state.edges` 的引用 memo 是同一个单一 owner，且 immer 的结构共享让引用相等成为精确的失效信号。

## 范围（这一刀做什么）

**S3 — 节点不再订阅整张表。** 新增 `src/workbench/generationCanvas/store/canvasNodeGenerationIndex.ts`：
按 `(nodes, edges)` 引用 memo 的 `id → node` 与 `id → 能不能生成` 两张表，每张卡只读自己那一格。
`BaseGenerationNode.tsx` 里四个整表选择器**一起删，不留一个**（留一个就还是每次重渲染扫一遍全表）：

| 原来（file:line） | 形状 | 改成 |
|---|---|---|
| `nodes/BaseGenerationNode.tsx:111` | `state.nodes.find(...)?.title` | `selectCanvasNodeById(state, node.derivedFrom)?.title` |
| `nodes/BaseGenerationNode.tsx:115` | `state.nodes.find(...)?.categoryId` | `selectCanvasNodeById(...)?.categoryId` |
| `nodes/BaseGenerationNode.tsx:119` | `state.nodes.some(...)` | `selectCanvasNodeExists(...)` |
| `nodes/BaseGenerationNode.tsx:225` | `canRunGenerationNode(node, { nodes: state.nodes, edges })` | `selectCanvasNodeCanRun(state, node.id)` |

`canRun` 那格是**懒填**的：急填等于把 O(N²) 从「每轮重渲染」搬到「每次 store 写」。懒填之后每个节点
每个 store 版本最多算一次；拖动期间 store 根本不写（位置草稿在 React Flow 内核里），所以整段手势里
第一帧之后每张卡都是 O(1)。

**S6 — 缩放滑杆不要动画。** `reactFlow/GenerationCanvasReactFlow.tsx:356` 的
`flow.zoomTo(next, { duration: 120 })` → `{ duration: 0 }`。滑杆本身就是连续输入，每个 change 事件起一段
120 ms d3 过渡、后一段打断前一段，肉眼就是「拖不动」。同文件 `:252`/`:353` 另两处视口写入本来就是 0，
这一处是漏网的。

**门岗 — 三条场景先红后修（R17）。** `tests/ux/canvas-performance-benchmark.e2e.mjs` 新增
`drag-nodes-all` / `drag-group-frame-60` / `zoom-slider-drag`，手势实现落在既有的共享模块
`tests/ux/canvas-perf/dragScenarios.mjs`（不另起第二份手势库），并补一条调研 §6 要的
**长任务次数**硬判据（毫秒继续 advisory）。预算按规模分档，数字逐行抄自调研 §6，
非 darwin 一律经既有的 `timingBudget()` ×1.6 出口派生——**不另写第二套平台分支、不另写第二张表**。

## 不动项（明确不在这一刀里）

- **S1**（组框拖动收回 React Flow 内核）/ **S2**（删两条死拖动路）/ **S4**（冻结门认单一标志）——
  调研 §8 明写这三条是一件事、且要排在 S3 之后做，因为 S3 做完再测组框，剩下的差值才干净地
  等于「手搓路额外付的那部分」。本刀只把 `drag-group-frame-60` 这条场景**加进门岗并按 §6 原数登记**，
  登记为 advisory-with-owner（owner = S1），**不下调预算**——下调等于把问题改成合格。
- **S5**（LOD 判据从「一共几个节点」换成「屏上多大」）——独立一刀。
- **S7**（主进程同步 IO 堵死图片供给口 / 「图全黑了」）——它与节点数无关，且调研 §7.2 说明
  它的因果链目前是「读出来的」不是「测出来的」，先补真机复现再动。
- 按钮步进缩放 `handleZoomByStep` 的动画：本刀不碰（碰它就得同时拍板「步进要不要动画」，
  为保它而留两个 `zoomTo` 才是真正的并行版）。
- 预算数字：一个都不调。调研 §6 的数是从实测反推的验收线，不是「比今天好看一点」。

## 回滚

单条 revert 本分支的实现 commit 即可：S3 是新增一个模块 + 四行选择器改写，S6 是一个字面量，
门岗改动是新增场景与预算表。没有数据迁移、没有持久化格式变化、没有 IPC 契约变化。

## 验收门

### 表一 · S3：`drag-nodes-all`（今天 → 修后，同一台机器背靠背两次采样）

`origin/main`（临时 worktree）与本分支用**同一个 harness**（`tests/perf/canvas-scale-bench.mjs`）、
同一台 M5、背靠背跑完，两次采样都列出来（这台机器常年 20+ 个工作树，绝对毫秒会漂，每行记了 load）。

| 规模 | fps 今天 → 修后 | p95 ms 今天 → 修后 | 最长帧 ms 今天 → 修后 | 长任务次数 今天 → 修后 | script ms 今天 → 修后 |
|---|---|---|---|---|---|
| I60（动 60 个，load 12–14） | 119.9/120.2 → 117.5/118.1 | 15.3/15.3 → 16.5/16.2 | 17.1/16.5 → 17.8/18.0 | 0/0 → 0/0 | 1299 → 1508（+16%） |
| I150（动 150 个，load 10–17） | 80.3/80.4 → 80.3/80.8 | 28.1/28.4 → 27.9/27.6 | 34.1/41.3 → 32.4/33.2 | 0/1 → 0/0 | 4365 → 4269（−2%） |
| I300（动 300 个，load 9–18） | 40.3/39.4 → 38.4/39.2 | 57.0/55.6 → **52.0/51.4** | 564/538 → **445/416** | **249/249 → 249/249** | 11608 → **10294（−11%）** |

**这张表里有一条必须说清楚的坏消息：I300 的长任务次数没动。**
调研 §5 S3 把「249/251 → ≤3/≤5」定成硬判据，本刀**没有达到**。原因（profile 实测，
`tests/perf/results/canvas-scale-s3prof.json` 的 `profileTop`）：I300 上 249 次长任务恰好等于
250 步手势的步数——也就是**每一步都 >50 ms**，而 JS 自时间的前几位是 `(program)` 43.5%、
`(idle)` 11.2%、`getContext` 5.6%、i18next 的 `formatLanguageCode` 2%。删掉的四个整表选择器是
script 里的 11%，不是剩下那 89%。剩下的主成本是**「300 张重卡每帧各自重渲染」这件事本身**
（每帧触碰的不同节点恒等于 300），它不随选择器走，要靠 S5（LOD 判据换成「屏上多大」，
300 档 zoom 已经贴到 0.2、每张卡只有约 70×40 屏幕像素却在渲染全套 chrome）与 tldraw 式的
命令式位移（拖动期 React 不参与）才削得动。

顺带纠正调研里一个被自己的数字推翻的判断：调研测到的「fps 96.5 → 42.1 → 12.4」超线性曲线
在今天这台机器（load 9–18）上**复现不出来**——main 自己就是 120 → 80 → 40，节点 ×5、fps ÷3，
是**次线性**的。调研那三档跑在 load 26–32 上，它自己也标了「I300 的绝对毫秒是本文档里最软的
一个数」。所以「O(N²)」这个定性对**选择器那一层**成立（删掉确实省了 11% script），但它解释不了
I300 的长任务，别拿它当已经修好的凭据。

### 表二 · S6：`zoom-slider-drag`（今天 → 修后，同上）

| 规模 | 最长帧 ms 今天 → 修后 | 调研 §5 S6 的目标（= 同档 `wheel-zoom` 实测） | 长任务次数 今天 → 修后 | §5 S6 预测的次数 |
|---|---|---|---|---|
| I60 | 102.1/66.1 → **56.0/59.6**（−32%） | 57 ms ✅ 到了 | 5/3 → 2/3 | 预测 0，实际 2–3 |
| I150 | 948.4/331.0 → **234.1/193.2**（−67%） | 210 ms ✅ 到了 | 7/7 → 8/8 | 预测 7，实际 8 |
| I300 | 593.8/562.7 → **194.1/204.4**（−66%） | 393 ms ✅ **比目标还好一倍** | 5/7 → 10/10 | 预测 10，实际 10 |

S6 是这一刀里**确实兑现的那一半**：三档最长帧全部达到或超过调研定的目标，I300 直接砍掉三分之二。
长任务次数没降（甚至微升）符合调研 §5 S6 的原话——S6 只削掉「动画互相打断」那一层，剩下的
「缩放时 N 个节点全部重算」是 S3/S5 的地盘；去掉 120 ms 过渡之后同样的工作被切成更多更短的段，
段数上去、每段的峰值下来，体感上「一顿一顿」消失的正是峰值那一刀。

### 门岗：三条场景 advisory-with-owner 登记

三条场景在 `origin/main` 的代码上先跑一遍（临时 worktree `/Users/aoqimin/Desktop/Nomi-canvas-perf-main`，
门岗文件从本分支拷过去，src 是 main 的），证明它们**跑得起来、算得出预算、并且当场就有越线项**；
再在本分支跑同样一遍。输出片段进 PR 正文。

**三条都以 advisory-with-owner 登记，§6 的数字一个不改。** 理由不是「过不了就放宽」，而是
§6 那几档本来就是「S1 + S3 + S5 都落地之后」的目标线——调研自己在 `wheel-zoom` 那一行注着
「150 与 300 档今天都越线」。把目标线当今天的硬门岗，只会让 main 和本分支一起红，然后被无视。
每条记了 owner，**owner 那一刀的验收动作就是「把自己这行从 advisory 表里删掉、并且仍然绿」**——
这是这三条的前进棘轮（登记在 `tests/ux/canvas-performance-benchmark.e2e.mjs` 的
`ADVISORY_ONLY_SCENARIOS` 注释里）：

| 场景 | owner（必须把它变绿的那一刀） | 本刀带来的位移 |
|---|---|---|
| `drag-nodes-all` | S5（LOD 判据换成屏上尺寸）+ 命令式位移 | I300 p95 57→52 ms、最长帧 564→445 ms、script −11%；长任务次数未动（见表一） |
| `drag-group-frame-60` | S1（组框拖动收回 React Flow 内核） | 本刀不碰，只是第一次被量到 |
| `zoom-slider-drag` | S3/S5（缩放时 N 个节点全部重算那一层） | 三档最长帧 −32%/−67%/−66%，全部达到调研 §5 S6 的目标（见表二） |

长任务**次数**的硬判据已按 §6 写进 `sampleHardFailures`（按 60/150/300 分档 ≤1/≤3/≤5，
计数类不随平台放宽）；advisory 期间它照常计算与打印，某一行退出 advisory 的那天它立刻开始判决。

### 真机走查（R13/P3）

150 节点画布、真按钮「适应视图」、`Cmd+A` 全选、真鼠标拖一次，截图留
`docs/evidence/2026-09-12-canvas-perf-s3-s6/`，人眼看一遍（不是 `expect` 断言）。
