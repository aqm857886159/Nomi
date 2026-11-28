# 设计卡：视频比例默认值只在「铺默认值」那一处算（F-landing-defaults PR-b）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：删掉「点开节点就改比例」的挂载 effect，16:9 / 全竖 9:16 收进铺默认值那一族   线：F-landing-defaults   类别：[花钱][其他]
```

背景：核查报告 R-d2-defaults #1。Agent 写 9:16，节点一点开，`NodeParameterControls` 的挂载 effect 把它改成 16:9，之后在节点上点生成就发 16:9（真组件挂载 + 真请求体复现过：Kling / Veo 9:16→16:9、Seedance 2.5 21:9→16:9）。前一刀 PR-a（#1288，落地带变体）的设计卡：`docs/plan/2026-10-22-landing-defaults.md`；本 PR 的复盘（概念「视频比例默认值的唯一出处」）：`docs/audit/2026-10-22-video-ratio-owner-direction-check.md`，引用 PR-a 那份 `docs/audit/2026-10-22-landing-projection-direction-check.md`。

用户拍板（2026-10-22「按推荐」）：
- **规则不变**（用户 2026-07-17）：视频首选 16:9，已连输入全竖才 9:16。
- **Q1**：Agent 没写比例时，落地节点用**档案默认**（= 卡上显示 = Agent 路实际发出，三处一致）。
- **Q2 = A**：连线那一刻算（连线手势的共用派生口，与连线自动切模式同一处；**组连线算连线**，粘贴 / 模板不算），只改**没被明确选过比例**的视频节点；Agent / 分镜写过的合法比例落地时记为明确选过（沿用 `aspect_ratio_user_set`）；断线、删上游不回头改。

### 功能分类
- [x] 花钱（比例决定出片规格，部分模型按规格计价）
- [x] Agent 行为（Agent 落地的节点）
- [x] 大数据量 / 画布 / 长列表（路径推出：画布节点与连线）
- [x] 新增功能 / 性能（路径推出；不新增交互）
- [ ] 新界面 / 改交互
- [ ] 长跑 / 可打断
- [ ] 生成效果
- [ ] 数据格式

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当 Agent 起草了一个竖屏镜头，我想点开节点看到的还是 9:16，在节点上点生成发出的也是 9:16；当我自己在画布上新建视频节点，默认仍是 16:9，把竖图连进来它变 9:16。步骤：①Agent 起草 9:16 ②落地 ③点开节点 ④节点上点生成；另一条：①手建视频节点 ②连一张竖图 ③点生成。**不做**：报告 #7「比例由图决定、不发」的模型（Kling 图生、Veo 参考 / 首尾帧）界面说明；重绑定冲掉用户改动（#4，归 D2）。真实任务：Kling 3.0 Agent 起草 9:16；Seedance 2.5 Agent 不写比例（档案默认 adaptive）；手建 Seedance 2.0 视频节点 + 连竖图。主指标：「打开节点后 meta 不变」的格子比例（量具：真组件挂载测试，基线 = 报告 probe-render 的 3/3 被改，目标 0）；护栏：手建节点 16:9、连竖图 9:16（量具：同一挂载测试 + store 单测）。 | 测试路径见下表 |
| ★1b 连带界面 | 节点生成框的比例 chip、批量估价读节点 meta：打开 Agent 落地的节点不再跳成 16:9。没有新文案。 | 挂载测试 |
| ★2 谁说了算 | 视频比例的产品默认只有一个 owner：`videoAspectSeedPatch`（新，住 `nodes/aspectRatio.ts` 旁，读 `preferredVideoAspect`），只在三个手势调：选模型（`buildNodeModelChangePatch`）、新卡自动选模型（`useNodeModelAutoSelect`）、连线（`store/canvasConnectDerivations.deriveTargetAfterConnect`——单连、多选成组连、组连线、节点进组物化组连线、Agent 计划 / 3D 站位 `connectNodes`、派生节点、**外部 MCP 连线**（项目开着时经 `canvas.apply → applyExternalGraph`，过连线总闸收下的新边；协调 10-23 裁定算连线手势，口径同进程内 Agent 连线），边建上之后都只调它，且只在新边属于首帧 / 尾帧 / 参考这三种比例规则会数的输入时才重算；粘贴 / 模板 / 恢复 / 撤销 / 放回不调）。挂载 effect 删除。「明确选过」只有一个标记 `aspect_ratio_user_set`：用户在比例控件上选（现有）、落地时 Agent / 分镜写了合法比例（新，`buildPlannedNodeMeta`）。不靠「打开节点」推断任何事。 | `node scripts/door-map.mjs videoAspectDefaultPatch / preferredVideoAspect`：改前 2 扇（含挂载 effect），改后只剩 owner 一扇 |
| ★3 一致与复用 | 复用 `preferredVideoAspect` / `collectInputAspectRatios` / `videoAspectDefaultPatch`；连线后的派生写与「连线自动切模式」收进同一个函数 `deriveTargetAfterConnect`（原 `autoPromoteTargetModeForEdge` 从 `canvasGraphActions.ts` 搬出、同提交删除旧处；`history: false`，同一个撤销步）。不新造比例判据：连线派生口查模型目录用**生成框同一个取法**（`modelOptionsAdapter.peekGenerationNodeModelOptions`，按节点当前生成方式取清单，不另取一份）；「哪种边会被比例规则数到」只有 `aspectRatio.isAspectInputEdgeMode` 一个判据（采集上游比例和连线时要不要重算都问它）。 | `git grep` |
| ★4 全状态 | 模型清单没载入：新卡自动选模型本来就等清单，比例随模型一起写（一次写）。连线的上游没有可读比例（还没出图）：不改（`preferredVideoAspect` 只看可读的）。节点比例明确选过：连线不改。旧项目存量节点：打开不改。只发布「图生视频」的模型（Vidu Q3）：按节点当前生成方式取清单，找得到，连竖图 → 9:16。比例档是像素串的模型（Runway Gen-4 Turbo，只发布图生视频）：清单查得到，但 07-17 规则的等价档判据（W:H 字符串相等）对不上 `720:1280`，比例不动——改前挂载 effect 同样如此，不是本 PR 引入，是否让规则认像素串档另议。连的是角色参考这类不被比例规则数的边：不重算（Seedance 2.5 的 adaptive 不被改成 16:9）。外部 MCP 写盘（项目没打开）那条路不重算：打开项目后生成框显示的就是会发的比例。 | 测试 |
| 5 中途表 | 不新增异步步骤、不改派发 / 扣费时序；连线写与连线自动切模式同在一个同步手势里，撤销一次连同撤回。 | 不适用：无新状态 |
| 6 外部数据与失败 | 外部来源只有供应商请求体，本机假上游抓；付费核对脚本由协调跑（见下）。 | parity 测试 |
| ★7 性能 | 不新增交互：连线时多一次 O(入边数) 的比例计算 + 至多一次 meta 写；挂载少一个 effect（挂载写次数只会变少）。 | `composerMountBudget.test.tsx` 现有预算不变 |
| 8 真实条件 | Windows：是；真付费：协调跑 `tests/ux/agent-ratio-variant-landing.paid.mjs`（本 PR 只写脚本，PR-a + PR-b 整条「Agent 落地 → 画布生成」一次覆盖）；截图：挂载测试代替（界面测试会打扰用户）。 | — |
| 拍板图清单 | 不适用：不改界面布局 | — |
| ★9 验收与回滚 | 按下表逐条；回滚：revert 本 PR 提交（挂载 effect 回来，行为回到现状；`aspect_ratio_user_set` 多写的那些节点只会「连线时不再被自动改」，无数据损坏）。独立验收：协调指派。 | `## 独立验收` |

## 验收清单（实现前写）

入口（door-map 数的）：比例默认值的写口改前 2 扇——`buildNodeModelChangePatch`（选模型）、`NodeParameterControls` 挂载 effect（挂载 + 换模型 + 输入边变化三合一）。改后：owner `videoAspectSeedPatch` 一扇，调用方三个手势；挂载 effect 删除。「明确选过」标记的写口：比例控件两处（现有）+ `buildPlannedNodeMeta`（新）。

| # | 入口 / 场景 | 反例 → 期望 | 量具 |
|---|---|---|---|
| b1 | 挂载：Agent 落地的节点（真 `NodeGenerationComposer` 挂载） | Kling 3.0 9:16、Veo 3.1 9:16、Seedance 2.5 21:9（APIMart 真档案）挂载 → meta 一个字不变、0 次比例写（改前：被改成 16:9） | 真组件挂载测试（`composerMountBudget` 同一套 react-reconciler 渲染器） |
| b2 | 挂载：Agent 没写比例（Q1） | Seedance 2.5 文生落地 = 档案默认（adaptive）→ 打开不改 | 同上 |
| b3 | 挂载：旧项目存量节点 | 没标记、比例不是 16:9 的旧节点 → 打开不改 | 同上 |
| b4 | 新卡自动选模型（`useNodeModelAutoSelect`） | 用户手建视频节点、没有输入 → 挂载后 16:9；新建时已有竖图输入边（从竖图拖出新节点）→ 9:16；仍然最多 1 次 store 写（现有预算） | 挂载测试 |
| b5 | 选模型（`buildNodeModelChangePatch`） | 现状不变：换模型按「首选 16:9、输入全竖 9:16」重铺 | 现有测试 + 一条回归 |
| b6 | 连线入口（每一扇各有一条测试，删掉对应的 `deriveTargetAfterConnect` 调用必红）：单连 `connectToNode`（自己的路，**不在** `writeCanvasEdge` 下）、多选成组连（`connectToNode` 的多选分支）、组连线 `connectToGroup`、节点进组物化 `moveNodeToGroup`、`writeCanvasEdge`（只有进程内 Agent 计划 / 3D 站位 / @提及 / 自动引用 / 派生节点走它） | 没明确选过比例的视频节点连进全竖图 → 9:16；连进横图 / 混合 → 16:9；除 `writeCanvasEdge` 外同一手势一次 ⌘Z 连线与比例一起撤（`writeCanvasEdge` 本身没有撤销栏，由外层提案事务管撤销，派生写 `history:false` 跟着走） | store 单测 |
| b7 | 连线：明确选过 | 用户在比例控件选过 → 连竖图不改；Agent 落地写了 9:16（b9 标记）→ 连横图不改 | store 单测 |
| b8 | 断线 / 删上游 | 断掉那张竖图、删掉上游节点 → 比例不回头改 | store 单测 |
| b9 | 落地标记（`buildPlannedNodeMeta`） | Agent / 分镜写了合法比例 → meta 带 `aspect_ratio_user_set: true`；没写或写了非法值 → 不带（档案默认，连线可改） | 单测 |
| b10 | 组连线（协调 10-22 拍板：算连线） | 一组竖图连到没明确选过比例的视频节点 → 9:16；一次 ⌘Z 连同比例一起撤 | store 单测 |
| b10b | 粘贴 / 模板 / 恢复快照 | 不算连线手势（带着自己的状态进来），不重算：这几扇不调 `deriveTargetAfterConnect` | 读码 |
| b11 | 13 模型格子 | APIMart 视频模型 × Agent 写 9:16：落地节点 = 节点路请求体 = 宿主路请求体由 PR-a 的 `landingProjectionParity`（11 格）钉；本 PR 钉「挂载后 meta 一个字不变」（Kling / Veo / Seedance 2.5 真挂载）——两段相接即「挂载后再发 = 宿主路」。付费脚本在真上游上把整条再走一遍 | parity + 挂载测试 + 付费脚本 |
| b12 | 结构 | 全仓只有 `videoAspectSeedPatch` 调 `videoAspectDefaultPatch` / `preferredVideoAspect`；组件文件里不再有写比例默认的 effect | door-map 写进合同 |
| b13 | 外部 MCP 连线（项目开着；协调 10-23 裁定算连线） | 外部写入一条竖图边 → 没明确选过比例的视频节点 9:16（也跟着切生成方式），一次 ⌘Z 边和比例一起回去；明确选过的不变；放回（`restoredEdgeIds`）的边不算连线 | store 单测 + `mergeExternalCanvasWrite` 的 `onAdmittedEdges` 单测 |
| b14 | 连线时查模型目录的取法 | 只发布「图生视频」的模型（Vidu Q3，目录种子里只有一条 `image_to_video` 映射）连竖图 → 9:16；Runway Gen-4 Turbo 查得到、比例档是像素串 → 不动 | store 单测 |
| b15 | 新边种类 | 没写比例的 Seedance 2.5（adaptive）连角色参考边 → 仍是 adaptive；连首帧边 → 照算 | store 单测 + `isAspectInputEdgeMode` 与 `collectInputAspectRatios` 同源 |
| b16 | 「明确选过」标记的写口（每个各一条） | 用户在比例控件上选（档案控件 / 目录控件）、Agent 落地、分镜写回：写口删掉必红；标记按控件语义判（Agnes Video 2.5 的 `size` 是清晰度，只写 `size: 960P` 不记） | 挂载测试 + 单测 |

## 付费核对脚本（只写，协调跑）

`tests/ux/agent-ratio-variant-landing.paid.mjs`：照 `tests/ux/_paidRun.mjs` 的 `openPaidWalk`（隔离资料、出网只放行授权供应商、先零花费探测、key 只从环境变量读）。
- 起草不调真文本模型：文本模型用仓库的 loopback 夹具（`agent-runtime-fixture.mjs`）按脚本回一次 `draft_shots` 工具调用（Seedance 2.0 带变体那档里**最便宜的一个变体** + 9:16，1 镜，最短时长），媒体走真 APIMart。
- 核对：落地后打开节点，节点显示的变体 / 比例 = 起草的；从画布点生成，网络日志里真请求体的 `model` = 该变体的发出型号、`size` = 9:16；只发 1 次媒体请求。
- 「最便宜」按档案的变体顺序 / 规格写死在脚本里（不读价格表、不写金额）；脚本开头写清这一点，由协调核对。

## 修前 / 修后（本 PR）

- 真组件挂载 `composerKeepsAspect.test.tsx`：修前（base 代码）5 / 7 格红（Agent 落地的 Kling 9:16、Veo 9:16、Seedance 2.5 21:9 被改成 16:9；Agent 没写比例的 Seedance 2.5、旧节点同样被改），修后 7 / 7 绿；手建新卡 16:9、已连竖图 9:16 两格修前修后都绿（护栏）。第 2 轮再加 2 格（用户在比例控件上选的两个写口），共 9 格。
- 连线 `canvasConnectVideoAspect.test.ts`：修前 4 / 8 格红（连竖图不变 9:16、组连线不变、落地不记明确选过、断线删上游那格的前提不成立），修后 8 / 8 绿。第 2 轮再加 12 格，共 20 格（见下一节）。
- 付费判定 `tests/ux/_ratioVariantWire.test.mjs`：真 runTask 渲染这一档，型号 `seedance-2.0-mini`、比例 9:16，4 格绿（含两种修前形状判红）。
- door-map：`videoAspectDefaultPatch` / `preferredVideoAspect` 改前各 2 扇（`buildNodeModelChangePatch` + `NodeParameterControls` 挂载 effect），改后各 1 扇（`nodes/videoAspectSeed.ts`）。

## 第 2 轮：补独立验收（V-ratio）的条件（I-ratio-fix，2026-10-24）

V-ratio 第 1 轮结论「有条件通过」：三条阻断 + 若干建议。协调裁定「补，不换」，在 #1291 分支上续做（方向检查见 `docs/audit/2026-10-22-video-ratio-owner-direction-check.md` 第 2 轮一节）。

| 条件 | 怎么补 | 测试（都在原有测试文件里加格） |
|---|---|---|
| 阻断 1：连线查目录只认文生视频那份清单，只发布图生视频的模型不铺 9:16 | 连线派生口改用生成框同一个取法 `peekGenerationNodeModelOptions`（按节点当前生成方式取清单），删掉自己的 `peekCatalogModelOptions(种类默认)`；不另写第二份 | `canvasConnectVideoAspect`：Vidu Q3 连竖图 → 9:16；Runway Gen-4 Turbo 查得到但像素串比例档对不上 → 不动 |
| 阻断 2：3 个 derive 调用、3 个标记写口没被测试钉住 | 各补一条，删掉对应调用必红（变异红格见下表） | `canvasConnectVideoAspect`（writeCanvasEdge / 多选成组连 / 进组物化）、`composerKeepsAspect`（档案控件 / 目录控件）、`storyboardProjection.test`（分镜写回） |
| 阻断 3：外部 MCP 连线入口没被数到（协调裁定算连线，口径同进程内 Agent） | `mergeExternalCanvasWrite` 新增 `onAdmittedEdges`（过总闸收下的新边，放回的 / 没动过的 / 被拒的不算）→ `applyExternalGraph` 对这些边各调一次 `deriveTargetAfterConnect`；撤销沿用 `applyExternalGraph` 现有口径（一次写入一个撤销步，派生写 `history:false` 跟着走） | `canvasConnectVideoAspect`（外部写入竖图边 → 9:16、撤销 / 重做、明确选过不变、放回不算）、`externalCanvasWrite.test`（`onAdmittedEdges` 4 格） |
| 建议 1：标记按键名判，不按控件语义判 | `buildPlannedNodeMeta` 与分镜写回都改用 `aspectRatioControlKey(aspectRatioControlsOf(...))`（`placeAspectRatio` 同一个判据），两处 `ASPECT_RATIO_KEY_SET` 删除 | `plannedNodeMeta.test`（Agnes Video 2.5 只写 `size: 960P` 不记）、`storyboardProjection.test`（同） |
| 建议 2：任何一条边都重算 | 新边不属于 `collectInputAspectRatios` 会数的种类（首帧 / 尾帧 / 参考）就不重算；判据收成 `isAspectInputEdgeMode`，采集和连线共用 | `canvasConnectVideoAspect`（Seedance 2.5 连角色参考边 → 仍 adaptive；连首帧边照算）、`aspectRatio.test`（与采集同源） |
| 建议 4：b6 把单连归在 `writeCanvasEdge` 下是错的 | 上面 b6 已改准 | — |

### 变异复核（在源码导出副本里改，改完即还原；红 = 测试检测到）

基线：canvas + storyboard + shared/canvas 共 511 个文件 5644 格全绿；定向 6 个文件 109 格全绿。

| 变异 | 范围 | 红了几格 |
|---|---|---|
| 删 `writeCanvasEdge` 的 derive 调用 | 511 文件 | 1 |
| 删多选成组连的 derive 调用 | 511 文件 | 1 |
| 删 `moveNodeToGroup` 的 derive 调用 | 511 文件 | 1 |
| 删用户在档案控件上选比例时写标记 | 511 文件 | 1 |
| 删用户在目录控件上选比例时写标记 | 511 文件 | 1 |
| 删分镜写回的标记 | 511 文件 | 2 |
| 连线查目录退回按种类默认方式 | 6 个文件 | 2 |
| 删 `applyExternalGraph` 的 derive 循环 | 6 个文件 | 1 |
| `onAdmittedEdges` 把放回 / 没动过的边也报出来 | 6 个文件 | 4 |
| 落地标记退回按键名判 / 分镜写回标记退回按键名判 | 6 个文件 | 各 1 |
| 去掉「新边属于会数的输入才重算」 | 6 个文件 | 1 |
| `isAspectInputEdgeMode` 与采集不同源 | 6 个文件 | 2 |
| `writeCanvasEdge` 传请求 mode（缺省）而不是落库后的 mode | 6 个文件 | 1 |
| （对照）删单连的 derive 调用 / 删组连线的 derive 调用 / 删落地写标记 | 6 个文件 | 4 / 1 / 4 |

