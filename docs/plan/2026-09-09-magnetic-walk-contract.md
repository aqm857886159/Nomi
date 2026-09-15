# 磁吸走查消费契约同步

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

范围：扫描 tests/ux 的 magnetic、handle-hit、29px 与 source handle 消费者，修正选中前提与全局定位。共享命中助手按节点、侧别定位，在外侧热区真实 hover 并验证 29px、加号与可见性；各走查保留自身用户任务断言。card-stack 当前版本已无报告中的全局点击，补未选中图片/视频双侧验证。

根因：可连节点均挂载把手后，DOM 存在不等于显示；选中也不再触发显示。旧走查未同步消费此合同，属于 recurring。

不动生产代码、依赖和性能结果；不跳过或放宽断言。回滚本次 scoped commit 即恢复走查。验收：critical 4/4、magnetic、gestures、S5、截图人眼查看、gates，正常 hooks commit/push，PR 转 ready 不合并。

## 走查揭示的生产 bug

card-stack 真实点击/hover 被视频 source 热区拦截（/tmp/mh-card.log、/tmp/mh-critical-after2.log）。BaseGenerationNode 的 isolate 使托盘局部 z-14 无法越过外层 z-8 source。共享节点壳让空闲 source 先绘制且 z-0，卡片本体及版本控件绘制在其上；连接中的 target 保留 z-8。覆盖图片和视频版本控件，不加 kind 特例、不强制点击。生产范围仅 GenerationCanvasReactFlowNodes.tsx 与 generationCanvasReactFlow.css，既有磁吸样张外观不变。

## 验证

四份走查同步：canvas-drag-pan-gestures、canvas-card-stack、canvas-s5-walkthrough、group-ports，共享 _canvasHit 按节点/侧别确认真实命中。S5 只数 RF edge 容器，删除将容器与 path 重复计数的旧查询，严格新增一条，不再点击兜底。

本地 critical 4/4；magnetic 3/3；单独 gestures 通过；S5 通过。人工查看 green-01-hover 与版本托盘截图，未选中外侧加号可见、托盘正常操作。未放宽/跳过走查，未安装依赖。原 Linux 失败 run：https://github.com/aqm857886159/Nomi/actions/runs/34248853729 。

## 先查别人

- 仓库已有：`tests/ux/_canvasHit.mjs:71` 的 findCanvasBlankPoint 和 `tests/ux/_canvasHit.mjs:236` 的 findNodeHitPoint 都以 elementFromPoint 确认命中归属。本次沿用该 owner，新增节点/侧别限定的外侧热区命中，不抄另一套几何助手。
- 卡片层叠已有：`src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:278` 的 isolate 与 `src/workbench/generationCanvas/nodes/NodeResultStack.tsx:342` 的局部 z-14 说明托盘不能跨越外层 source 的 z-8。修复放在共享 RF 节点壳的绘制顺序，不逐个 kind 补特例。
- 依赖已有：`node_modules/@xyflow/react/dist/style.css:247` 的原生 Handle 样式与仓库 `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowNodes.tsx:89` 的 isConnectableStart/isConnectableEnd 继续拥有连接手势；官方契约 https://reactflow.dev/api-reference/components/handle 已在原根因合同核查。本次仅调整本地绘制层级，不新增框架 API 或替代连接内核。
- 本次没用 TikHub，因为这是已复现的本地 DOM 命中与旧走查消费契约问题，仓库真实 Electron 证据能直接证明因果；不编造自媒体来源。
- 结论：用已有 RF Handle 与 _canvasHit 共享命中方式，保留全部用户任务断言。此节是在门岗提示后补齐的既有调查记录，不声称此前文档已完整。

## 2026-09-11 并线补记：CI 两片红的真根因是「吸附不可观测」

并线最新 main 后在本机真实 Electron 复现了 Canvas Acceptance 两片的同一处红：
`expectSnapped` 里「拖线离开目标热区后 `data-active` 应清掉」恒不成立。

查下去发现红的那句和它的正向孪生句挂在同一个错锚点上。目标把手的 `data-active`
取的是 `active || highlighted`，而 `active` = `isPendingConnectionTarget`——只要有连线
在进行、这张卡不是起点，它就为真，整段拖拽里每个候选都为真（CSS 里它开的正是
`pointer-events: auto`）。走查真正想验的是另一个事实：**此刻端点吸在我身上**。
两个事实共用一个属性，于是吸附变得不可观测：

- 正向 `toHaveAttribute('data-active','true')` 对任意候选都通过 → **假绿**，哪怕吸附从没发生；
- 反向 `not.toHaveAttribute(...)` 永远清不掉 → **真红**，但红在错的地方。

同一个锚点两头说谎（`docs/lessons/dead-selector-lies-both-ways.md` 的同一族）。
放宽这句断言会把假绿一起留下，所以修在生产侧：给第二个事实起名字。
`GenerationCanvasReactFlowNodes.tsx` 的把手新增 `data-snapped`，同一时刻只属于一个把手，
与「强调把手挂不挂载」同条件；`data-active` 保留原义（候选 + pointer-events）。
走查三处断言改指 `data-snapped`，并补图标 count 断言（离开收回、回来浮出）。

顺带补两处防线：`tests/ux/canvas-magnetic-handle.walk.mjs` 此前**没有登记进
`tests/ux/canvas-real-suite.mjs`**，这条验收走查在 CI 里一次都没跑过，等于功能没有回归保护；
现登记进 `FULL_CANVAS_SCENARIOS` 与 shard 1，并加进 `scripts/validation-policy.mjs` 的
`FULL_CANVAS_PATTERNS`，改这条走查会重跑它自己。

### 一条本机噪音，不是回归

`canvas-drag-pan-gestures.walk.mjs:295` 的 `verificationPending === true` 在这台 macOS 上恒为
false（`origin/main` 上逐字相同，且近 main 分支的 Linux CI 该场景连续 success），是本机
环境差异不是本 PR 引入。已如实记录，未改动该断言。

## 2026-09-11 未解决：常驻热区把卡片旁边的连线吞掉了（阻塞合并）

并线后 `canvas-card-stack.walk.mjs` 稳定红在「聚合编组输入线上存在真的点得到的点」。
**已用对照证明是本 PR 引入的**：同一台机器、同一条断言，`origin/main` 全绿（exit 0），
本分支整条线 99 个采样点没有一个可达。

机制：磁吸热区从「选中才出现的 ~28px 圆点」变成「常驻的 112px×168px 带子」，
每张卡左右各多出一大片捕获指针的画布；热区挂在 `.react-flow__node` 下，而 React Flow 把边
画在 `.react-flow__edges`——整层都在节点之下。连线正是从卡片侧边进出的，两个端点必然落在
带子里。实测命中归属（探针沿边取样）：靠近卡片的一段是 `__handle-hit`，中段是卡片本体，
末端是 GroupFrame 新增的 `__magnetic-handle`。

**可感知后果**：两张卡挨得近（间距 < ~224px）的连线整条点不到——点它改生成方式、断开连接
都做不了；长连线只有中段还点得到。

试过并否掉的一版：「底下压着线就让给线」（事件层裁决，热区收到 pointerdown 先查
`elementsFromPoint`）。card-stack 换了个红法——挂在这张卡上的线**本来就穿过这张卡自己的带子**，
于是加号在最该出现的地方被藏掉（`toHaveCSS opacity 1 → 0`）。所以「线总是赢」不成立，
这不是实现细节，是**两个合理解之间的取舍**，需要用户拍板：

| 方案 | 用户看到 | 代价 |
|---|---|---|
| A 带子总是赢（当前 PR） | 加号随处可得 | 卡片附近的连线点不到（CI 红，已证 main 不红）|
| B 线总是赢 | 线随处可点 | 连着线的卡片，加号在那条线经过处消失 |
| C 带子内半 / 线外半（推荐） | 贴着卡片出加号，往外走点得到线 | 需要一个分界（可取带宽一半，非凭空常数）；是新交互，须先出样张拍板 |
| D 收窄带子 | 两边都还在 | 「拉手不方便」的原始诉求被削弱 |

推荐 C，但它是用户可见的新交互，按 P5/R8 要先出样张、用户拍板再实现。
在拍板前本 PR 不应转正——CI 也会因这条断言持续红。

## 2026-09-11 拍板：恢复旧设计

用户裁决：**恢复迁移前那版磁吸把手**。上一节那张「A/B/C/D 四选一」不用选了——旧设计本身就是 C 的答案，
只是它把分界画在了另一个维度上：**不是按空间切一条带子，而是按「这张卡是不是被选中」**。

### 背后逻辑（为什么旧设计不会把连线吞掉）

旧设计里带子不是常驻的：**只有当前选中的那张图片类卡片**才有左右两条 112×168 的带子，其余卡片是
28px 的小圆点。于是任何时刻**至多一张卡**在卡片外侧捕获指针，卡片之间的连线自然点得到——
`interactionWidth=30` 的命中笔画一直在，从来没人跟它抢。

上一版把这道门当成「迁移时可以省掉的实现细节」删了（那份 plan 原话：把旧代码当成不是规格），
热区随之变成每张卡常驻，两张卡挨得近时它们之间的整条线被两边的带子盖满——这才是
`canvas-card-stack` 那条真回归的机制。所以这道门不是实现细节，**它就是「连线永远点得到」这条保证本身**。

### 迁移前 ↔ 恢复后 逐项对照

基线 = `8f9365aeb9dacc91153b186178eaf9184eeac639`（`74346baca` 换 React Flow 渲染器的父提交）的
`nodes/BaseGenerationNode.tsx:262-380`、`nodes/NodeConnectionHandles.tsx`、`styles/generationCanvas.css:330-362`。
「实测」= `tests/ux/canvas-magnetic-handle.walk.mjs` 在真实 Electron 里量到的数。

| 项 | 迁移前 | 恢复后 | 结论 |
|---|---|---|---|
| 带子挂载条件 | `selected && (image/asset/图片类) && !isPendingConnectionSource`，panorama 除外 | `primarySelection && 同一组 kind && pendingConnectionSourceId !== node.id`，panorama/折叠组代理除外 | 一致；唯一差别见下「多选」一行 |
| 多选时 | 用 `selected`：每张选中的卡都出带子 | 用 `primarySelection`（`selected && 选中数 === 1`）：只有单选那张出带子 | **迁移时就有的差异**，本次未改（改它等于新交互，须另行拍板） |
| 未选中把手 | `left-[-14px]` / `right-[-14px]`，28×28，`z-[7]`，opacity .8 → hover 1 | RF `Handle --source` 28×28，锚点在卡片该侧中点 | 一致；实测 28×28、圆心距卡片边 < 2px |
| 圆点本体 | `__handle-dot` 14×14，2px 描边，hover/active 转 accent + `scale(1.08)` | `--dot .__handle-icon` 14×14，同描边、同 accent、同 1.08 | 一致 |
| 带子尺寸/位置 | `w-28 h-[min(168px,calc(100%+28px))]`，`left-[-112px]`/`right-[-112px]`，`z-[4]` | `.__handle-hit` 112px × `min(168px, 卡高+28px)`，贴该侧边外挂 | 一致；实测 112 × 168 |
| 加号 | `size-[29px]`，2px 描边，随 `--connection-handle-x/y` 走，clamp 半径 14.5 | 同 29px、同 `MAGNETIC_HANDLE_ICON_RADIUS = 14.5` | 一致；实测 29×29，加号中心追到指针 < 2px |
| 静止位 | `homeX = left ? calc(100% - 28px) : 28px` → 距卡片边 28px | 同 | 一致；实测 \|中心 − 卡片边\| − 28 < 2px |
| 未露出时 | `--connection-handle-reveal-x: ±28px`，opacity 0，`scale(.86)` | 同 | 一致 |
| 露出链 | 节点 hover / focus-within → .82；带子 hover / active / following → 1 | `__node-shell:hover` / `:focus-within` → .82；`--magnetic:hover` / `[data-active]` / `[data-following]` → 1 | 一致；实测 hover 卡片 0.82、指针进带内 1 |
| 动效 | 180ms `cubic-bezier(.16,1,.3,1)`；**跟随时收敛到 120ms** | 180ms 同曲线；没有 120ms 那一档 | **迁移时就丢的差异**，本次未补，记在根因合同 `residual_risks` |
| 把手层级 | 圆点 `z-[7]`、带子 `z-[4]` 两档 | RF 把手统一 `z-index: 8` | 迁移时就有的差异；`canvas-card-stack` 在这版上绿，不再另加 z 序 |
| 卡片之间的连线 | 至多一张卡有带子 → 随处可点 | 同 | **恢复**；实测间距 150px 的两卡之间点开了连线模式药丸 |

### 本 PR 相对主线只剩两处净增量（都在 `GenerationCanvasReactFlowNodes.tsx`）

1. **`data-snapped`**：给「端点此刻吸在我身上」这个事实一个自己的名字。`data-active` 保留原义
   （合法候选 + 开 pointer-events），两者曾共用一个属性，导致吸附不可观测（详见上一节）。纯属性，无视觉变化。
2. **目标侧外侧热区**：目标 `Handle` 的 `::after` 铺 112×168，**只在连线进行时** `pointer-events: auto`，
   空闲时 `none`。所以它既让「拖到卡片外侧就吸上」成立，又不会在空闲时挡住任何一条连线。
   同时连线进行时源把手 `pointer-events: none`，不跟目标热区抢同一条卡片边。

其余全部退回 `origin/main`：`GroupFrame` / `CanvasGroupProjectionLayer` 上新加的那份常驻磁吸把手、
`NodeConnectionHandles` 的 `stopPropagation`、为让开常驻带子加的 `isolation`/z 序/CSS、
以及四份被改去消费常驻带子的走查（`canvas-card-stack`、`canvas-drag-pan-gestures`、`canvas-s5-walkthrough`、
`group-ports`、共享的 `_canvasHit.mjs`）。不留并行版、不留开关（P1）。

### 验证（真实 Electron，隔离 profile）

`tests/ux/canvas-magnetic-handle.walk.mjs` 重写成恢复后的语义，四条任务全绿；
并在**被否掉的常驻带子版**上先验证会红（改 affordance 恒 `magnetic` 后重跑）：

| 任务 | 恢复后 | 常驻带子版 |
|---|---|---|
| 01 未选中卡片 = 圆点、外侧 56px 仍归画布 | ✅ | ❌ 未选中卡片有 2 条带子 |
| 02 选中卡片出带子、加号跟指针、离开回静止位 | ✅ | ✅（这条本来就不该变） |
| 03 拖进目标外侧热区吸边、离开放开、回来再吸 | ✅ | ✅ |
| 04 间距 150px 的两卡之间点得到那条连线 | ✅ | ❌ `findEdgeHitPoint` 返回 null（整条线无一采样点可达） |

证据：`canvas-magnetic-handle-evidence/restored-0{1..4}-*.png`、`restored-results.json`、`red-results.json`。
未改动的三条走查同机复跑证明没有连带回归：`canvas-card-stack` 退出码 0（就是被本 PR 弄红的那条）、
`canvas-drag-pan-gestures` 51 项全绿、`group-ports` 全绿。
（`canvas-drag-pan-gestures.walk.mjs:295` 上一轮记录的那条本机噪音本次没有复现，未改动该断言。）
