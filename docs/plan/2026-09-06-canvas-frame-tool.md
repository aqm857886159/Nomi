# 画布框工具（Frame）第一档：现役 Group 进化成 Frame

> 日期：2026-09-06 · 状态：🚧 实现中 · 独立实现轨：`feat/canvas-frame-tool-20260906`
> 来源：2026-09-06 用户在设计画布 B5 板拍板的「框工具第一档」样张。
> 现役取证（真机实拍 + 交互清单）：`tests/ux/shots/group-frame-now/README.md`（另一棵树 `Nomi-group-shots`，未入库）。
> 相关在途：PR #541 已修「框选后右键落在选中罩子上」，落点判定收在 `canvasPointerGestureModel.ts` 的正向三分表——本轨的拖入/拖出与框边右键判定**扩在同一处**，不另造第二张表。

---

## 先查别人

> 本节 2026-09-07 随 `check:prior-art` 门岗补入（R27 §16）。**内容不是新查的**——PR #555 的
> R29 边界检查就是这份检索本身，报告在
> [`docs/research/2026-09-07-react-flow-subflows-vs-frame.md`](../research/2026-09-07-react-flow-subflows-vs-frame.md)（已在 main）；
> 这里按四问归拢，每格给出可复核的出处。

| 问 | 答 | 出处 |
|---|---|---|
| 依赖里已有？ | **一半有、一半必须自己写。** React Flow 12 自带 sub-flows：`parentId`（父子）、`extent:'parent'`（成员不许出框）、`expandParent`（父追着子长大）。前一件我们不需要，**后两件与本轨的产品语义正面相反**——`extent:'parent'` 会 clamp 住成员，「拖出框 = 退组」根本发生不了；`expandParent` 逐字就是我们要修的那条 bug。这不是重造轮子，是这个轮子朝相反方向转 | `@xyflow/system@0.0.81` `dist/esm/types/nodes.d.ts:49-61`（parentId / extent / expandParent）、`:156`（ParentLookup）；官方文档 https://reactflow.dev/learn/layouting/sub-flows |
| 依赖里已有（第二问，**这一问查出了返工**）？ | **有，而且我们第一版绕开了它。** 「拖进拖出认父」官方没有内建，给的是配方：`onNodeDrag` 里用 `getIntersectingNodes` / `getInternalNode` 读内核的 `positionAbsolute` + `measured`。第一版自己从 Zustand 用**声明**尺寸算了一份矩形——判定线与用户看到的边会分叉。已按 #555 返工改回内核公共 API | `@xyflow/react@12.11.5` `dist/esm/types/instance.d.ts:113`（getIntersectingNodes）、`:55`（getInternalNode）；`@xyflow/system` `types/nodes.d.ts:83-99`（InternalNodeBase.measured / internals.positionAbsolute）；返工后的读口 `src/workbench/generationCanvas/reactFlow/canvasMeasuredNodeRect.ts:25` |
| 依赖里已有（第三问，同上）？ | **有。** 「这次拖动归谁」React Flow 有声明式开关 `panOnDrag` / `nodesDraggable`。第一版在 capture 阶段截 pointerdown + `stopPropagation` 把手势偷过来——内核不知道自己被停用，框架哪天改事件绑定阶段就**静默**失效。已改成声明式停用（R28：能让框架自己拦的别留给偷袭） | `@xyflow/react@12.11.5` `dist/esm/types/component-props.d.ts:399`（panOnDrag）、`:338`（nodesDraggable）；接线处 `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowViewport.tsx:163,167` |
| 仓库里已有？ | **有，而且本轨就是「让它进化」而不是「另起一个」。** 成员名单 `NodeGroup.nodeIds`、写口 `moveNodeToGroup` / `removeNodeFromGroup`、折叠卡 `CollapsedGroupCard`、批量生产路径 `resolveCanvasGenerationScope → buildDependencyWaves → confirmAndRunPlan` 全部照原样复用——「生成整框」不是第二套生成，只是把 scope 换成框内成员 | `src/workbench/generationCanvas/model/generationCanvasTypes.ts:192`（nodeIds）、`src/workbench/generationCanvas/store/canvasGraphActions.ts:397`（moveGroupNodes）、`src/workbench/generationCanvas/components/CollapsedGroupCard.tsx`；本文 §4 的改动清单逐行对应 |
| 生态里已有？ | 「中心点进框即入组」是画布类产品的通行判据（Figma / Miro 同款），本轨照抄这条判据，只把矩形换成内核测量值；而「框追着成员长大」不是任何一家的行为——它是我们独有的 bug | 判据与代价逐格对照见 [`docs/research/2026-09-07-react-flow-subflows-vs-frame.md`](../research/2026-09-07-react-flow-subflows-vs-frame.md) §1.3–§1.5、§4 |
| TikHub 自媒体里怎么说？ | 本轮未查。这一层是画布内的交互边界（手势归属、相交判定），不是面向用户的产品选型，自媒体侧没有可比的一手经验——**明着标出来，不冒充覆盖** | 无 |

**结论**：**用已有 + 自研，边界画在语义上。** 内核已提供且语义一致的两件（相交判定的矩形来源、手势归属）全部改用公共 API；语义相反的三件（`parentId` 父子、`extent:'parent'`、`expandParent`）刻意不用，并连同理由、替代实现和复评日期登记进
[`docs/engineering/framework-boundaries.json`](../engineering/framework-boundaries.json)（`xyflow-react` 一节，4 项能力 + 5 条 forbidden 规则），`check:framework-boundary` 保证它长不回来。

---

## 1. 先说用户要解决的摩擦（D6）

**背后逻辑。** 今天画布上的「组」不是一个用户能画出来的东西，是一层**自动包围盒**：位置和大小完全由成员算出来（`generationCanvasGeometry.ts:65`，`minXY - 24`，顶部再留 28px 给标签），用户既画不了它、拖不动它的边、也定不了它多大。`NodeGroup.frameBounds` 这个字段在类型里躺了很久，**画布一行都不读**。

于是最伤的那一下是：**你把一个节点从组里拖出去，框会追着长大、把它重新包住**（实测：框从 1065×604 长到 1139×730，标签仍写「组 1 · 5」）。用户的动作是「我要把这张图移出这一组」，画布的回应是「我把这一组变大了」——两件完全相反的事。拖动过程中也没有任何「你正在离开这个组」的提示，松手才知道白干。

**具体例子。** 用户想把 5 个镜头里的第 3 个挪去另一段戏：拖出去 → 框跟着长 → 只能去左侧栏的分组树里拖一次才真的改成员关系。画布上做不到的事，要跑去另一个界面做。

**用户要权衡的那一件事：** 框到底是「**空间**」还是「**名单**」。空间语义（框住谁就管谁）符合直觉、拖进拖出即入组退组；名单语义（成员是一份显式清单）才能表达「这几个属于一组，但我把它们摆散了」。第一档的取舍是：**边界由用户画（空间），成员关系仍是名单，两者用「拖进拖出」这一个手势对齐**——框只在内容溢出时长大，不再追着跑掉的成员跑。

---

## 2. 范围（做什么）

### 2.1 不新造节点种类

数据模型沿用 `NodeGroup`（`src/workbench/generationCanvas/model/generationCanvasTypes.ts:188`）。变化只有两条：

- `frameBounds` 从「有字段没人读」变成**真相之一**：框的渲染边界 = `union(用户画的矩形, 成员外接矩形+padding)`。内容超出时框只长不缩，永远不小于用户画的那个矩形。
- 新增 `description?: string`（头部那一句灰字说明）。`color` 仍 `@deprecated`、仍不读，`groupVisualContract.ts` 的中性写死不动。

**框是画布工具，不是节点**——不进 `canvasToolbarModel.ts` 的加号意图表。

### 2.2 入口

- 左下画布工具簇（`CanvasNavigationStack.tsx` 那条 `zoom-bar`）加一颗「框」钮，`aria-pressed` 表达是否已就绪。
- 快捷键 **F**（无修饰键；`useCanvasShortcuts.ts` 现有的快捷键全带 `mod`，F 与它们零冲突）。
- 按下后在空白处拖出矩形 → 得到**空框**（虚线边、自动名「未命名框」、计数 0）。放进第一个东西变实线。
- **先选后组（⌘G）仍可用**，得到的是同一种框——`groupSelectedNodes` 顺手把当时的成员包围盒写进 `frameBounds`。

### 2.3 头部

`● 标题 · 一句灰字说明 · 计数 · 折叠钮 · ⋯`

- 标题双击进编辑态（作用域限在标题 `<span>`，`stopPropagation`）。
- 说明可空；空态显示一句极淡的占位，双击进编辑态。
- ⋯ 菜单（**右键框边同一份**）：改名/说明 · 生成整框 · 整框进时间轴 · 折叠成卡 · 解散。

### 2.4 拖进 = 入组，拖出 = 退组

- 拖动**过程中**就给反馈：进框时框边亮 accent、计数预览「2 → 3」；出框时框边变虚线、计数「3 → 2」。
- **松手才生效**（`moveNodeToGroup` / `removeNodeFromGroup`，已有 action，边的物化/撤销语义照旧）。
- 判定：拖动节点的**中心点**落在框的渲染矩形内 = 属于该框。中心点制是最可预测的（Figma / Miro 同款），比「任意重叠」宽容、比「完全包含」不苛刻。

### 2.5 折叠、整框生成、整框进时间轴

- **折叠态沿用现役**（`CollapsedGroupCard`，一张卡 + 左右锚点），一行不改。
- **生成整框**：走现役那一条批量生产路径（`resolveCanvasGenerationScope` → `eligibleGenerationNodeIds` → `buildDependencyWaves` → `confirmAndRunPlan`），只是把 scope 从「选中集」换成「框内成员」。**不是**第二套生成实现，也**不**在标签上加第二颗 ▶（2026-08-02 那次并行版的防复发断言仍然成立）。
- **整框进时间轴**：按框内**从左到右、从上到下**（阅读序）排一段；**只收视频 / 剪辑节点**，图和文字不进。落轴走已有的采纳桥 `adoptStoryboardBatch`（整批一次落定、一层撤销栈），本轨只提供「排哪些、什么顺序」这一层纯函数。

### 2.6 颜色

保持中性（`groupVisualContract.ts` 写死不动）。accent 只做拖入/拖出的**临时**反馈——这正是那份合同注释里写的用法。

---

## 3. 不动项（明确不做）

| 不做 | 为什么 |
|---|---|
| 框的颜色 / 取色器 | `color` 已 deprecated，视觉合同写死中性；第一档不翻案 |
| 嵌套框（框里画框） | 在已有框内起画 → 提示「先解散外层」，不建。嵌套会让成员归属、拖入拖出、整框生成三处各多一层递归，收益未验证 |
| 框内自由绘画 | 那是画板（whiteboard）节点的活 |
| 框边可拖拽缩放 | 第一档只做「画一次」。改大小 = 重画（成本低于引入 8 个 resize 把手 + 它们与节点选择的命中冲突） |
| 折叠态改版 | 现役 `CollapsedGroupCard` 一行不改 |
| 左侧栏分组树 | `CategoryTree` 的改名/拖动入口原样保留，本轨不碰 |
| `GroupFrame` 标签上第二颗 ▶ | P1 并行版，2026-08-02 已删并有防复发断言 |

---

## 4. 改动清单（按文件）

### 4.1 模型层（纯函数，先落）

| 文件 | 改什么 |
|---|---|
| `model/canvasFrameBounds.ts` **新增** | 框几何的**唯一 owner**：padding/label 常量、`frameBoundsFromRects`（成员矩形 → 框矩形）、`unionFrameBox`（画的矩形 ∪ 成员矩形，只长不缩）、`backfillGroupFrameBounds`（旧组原地升级，幂等）、`resolveFrameMembership`（中心点判定 → `'join' \| 'leave' \| 'none'`） |
| `model/frameTimelinePlan.ts` **新增** | `planFrameTimelineUnits`：过滤（只留视频/剪辑执行种类且有可用产物）+ 阅读序排序（行带按成员高度中位数派生，**不 hardcode**） |
| `model/generationCanvasTypes.ts` | `NodeGroup.description?`；`frameBounds` 的 JSDoc 从「画布不读」翻成真相源 |
| `model/generationCanvasSchema.ts` | `nodeGroupSchema` 加 `description` |
| `store/canvasSnapshotNormalizer.ts` | 载入时调 `backfillGroupFrameBounds`：**没有 frameBounds 的组按成员包围盒补一次**；已有的原样不动（幂等）。补完的值随下一次持久化落盘 |
| `components/generationCanvasGeometry.ts` | `getCanvasGroupBoxes` 改为读 `frameBounds` 并与成员外接矩形合并；空成员但有 `frameBounds` 的组**照样出框**（今天是 `return []`）；`CanvasGroupBox` 加 `empty` 标志 |

### 4.2 Store

| 文件 | 改什么 |
|---|---|
| `store/canvasGraphActions.ts` | `createFrame(categoryId, bounds)`（建空框，名字「未命名框」）；`setGroupDescription`；`groupSelectedNodes` / `createGroup` 顺手写 `frameBounds` |
| `store/canvasStoreTypes.ts` | 三个新 action 的签名 |

### 4.3 交互

| 文件 | 改什么 |
|---|---|
| `components/canvasPointerGestureModel.ts` | ① `resolveCanvasPointerDownAction` 增 `frameToolArmed` → 新动作 `'frame'`（优先级在 pan/marquee 之前，只读态忽略）；② `resolveCanvasContextMenuTarget` 正向三分表**扩成四分**：`'node' \| 'selection' \| 'frame' \| 'blank'`——框边右键弹框菜单，不再落进「添加节点」 |
| `components/useCanvasFrameTool.ts` **新增** | 就绪状态 + F 快捷键 + 画框手势（capture 阶段抢在 React Flow 的左键平移之前）+ 落笔建框；正在画的矩形用一个 overlay 渲染 |
| `components/useCanvasFrameMembership.ts` **新增** | `onNodeDrag` 时算 join/leave 预览；`onNodeDragStop` 提交 `moveNodeToGroup` / `removeNodeFromGroup` |
| `components/GroupFrame.tsx` | 空框虚线、说明行、标题/说明双击编辑、⋯ 钮、计数预览「2 → 3」、join/leave 边框反馈 |
| `components/GroupFrameMenu.tsx` **新增** | ⋯ 与框边右键共用的那一份菜单 |
| `components/CanvasNavigationStack.tsx` | 加「框」钮 |
| `components/useCanvasGroupActions.ts` | 挂 `handleGenerateFrame` / `handleSendFrameToTimeline` / `handleDissolveFrame` |
| `reactFlow/GenerationCanvasReactFlow.tsx` | 只加**两个 hook 调用 + 若干 props 转发**。现在 663 行，`check:filesize` 门岗 800 行——净增控制在 40 行内，超了就把 props 收进一个对象 |
| `reactFlow/GenerationCanvasReactFlowViewport.tsx` / `components/CanvasGroupProjectionLayer.tsx` | 转发新 props |

### 4.4 时间轴

| 文件 | 改什么 |
|---|---|
| `generationCanvas/agent/sendFrameToTimeline.ts` **新增** | 薄适配器：`planFrameTimelineUnits` → `adoptStoryboardBatch`（贴尾）。落轴机制全归采纳桥，本文件不写轴 |

### 4.5 i18n

`src/i18n/locales/generationCommon.ts` 的 `canvas.group.*` 加：`frameTool` / `frameToolHint` / `untitledFrame` / `descriptionPlaceholder` / `menuRename` / `menuGenerate` / `menuToTimeline` / `menuCollapse` / `menuDissolve` / `countPreview` / `nestedNotSupported` / `timelineEmpty` 等。**zh + en 双写**（`check:i18n` 的 key parity 是硬门）。

### 4.6 设计实验室

| 文件 | 改什么 |
|---|---|
| `src/devlab/designLab/canvasFrame/canvasFrameLabKit.tsx` **新增** | 取景台（真实组件渲染，不画样张） |
| `src/devlab/designLab/canvasFrame/states/01-frame.tsx` **新增** | 六态：空框 / 有内容 / 拖入反馈 / 拖出反馈 / 折叠 / ⋯ 菜单 |
| `src/devlab/designLab/canvasFrame/canvasFrameStates.tsx` **新增** | 汇总口 |
| `src/devlab/designLab/labScreens.ts` | 注册 `canvas-frame` 屏 |
| `tests/ux/design-lab/labStates.mjs` | 登记注册表目录 + 基线目录（与上一条**必须同时改**） |
| `tests/ux/design-lab/labServer.mjs` | `LAB_ROLES` 加 `walk-canvas-frame` |
| `tests/ux/design-lab/calibration.json` | `screens.canvas-frame` 容差；六态基线已录在 `tests/ux/design-lab/__baselines__/canvas-frame/`，不在 `pendingApprovalScreens` 里 |
| `tests/ux/design-lab-canvas-frame.walk.mjs` **新增** + `package.json` 脚本 | 出接触表给用户拍板 |

### 4.7 测试

**单测（vitest）**
1. `canvasFrameBounds.test.ts`：`frameBounds` 与成员外接矩形合并（只长不缩、成员回到框内不塌陷）；空框有 bounds 照样出框。
2. `canvasFrameBounds.test.ts`：`resolveFrameMembership` 拖入/拖出/无变化真值表 + 边界（中心点正好在边上）。
3. `canvasFrameBounds.test.ts`：`backfillGroupFrameBounds` **幂等**（跑两次结果相同；已有 bounds 的组不被覆盖；空成员组不硬造 bounds）。
4. `frameTimelinePlan.test.ts`：排序（阅读序、同行按 x）与过滤（图/文字不进、无产物不进）。
5. `generationCanvasStore.test.ts`：解散框**不撤边**（沿用 `groupInputLinks` 语义）；`createFrame` 建出的空框可用。
6. `canvasPointerGestureModel.test.ts`：`'frame'` 动作真值表 + 四分落点表（框边右键 ≠ blank）。

**走查（R13）** 两条，走的是**相反的两半**，不是一条抄两遍：

1. `tests/ux/canvas-frame.walk.mjs` —— **先画空框、再往里丢东西**：按 F 画框 → 拖 3 个节点进去 → 改名 → 拖 1 个出去（断言计数与虚线反馈）→ 折叠 → 展开 → 整框生成（loopback）→ 整框进时间轴 → 解散。
2. `tests/ux/canvas-frame-real-task.walk.mjs`（2026-09-07 新增）—— **东西先在，再把它们圈起来，然后整块搬家**：摆下文字 + 图 + 视频三张卡 → 在它们外面拖一圈圈住 → 起名 → 补一个镜头进来 → 把参考图挪出去 → **把整框挪到别处** → **⌘Z 撤销一次** → 光暗双模式各一张。

断言一律走 `tests/ux/_assert.mjs`，落点取用 `tests/ux/_canvasHit.mjs`（不复活 `_canvasPoints`），截图人眼判断。

第 2 条一跑就逼出三条第一档漏掉的（都已在本轨修掉，见 §4.8）——**它们全在「画框」和「搬框」这两个动作上，而第 1 条一个都碰不到**：
第 1 条永远在空地上画框（所以不会问「圈住的东西算不算成员」），也从不拖框体（所以不会问「框自己跟不跟着走」）。

### 4.8 第二条走查逼出来的三个修（2026-09-07）

| 现象（用户会怎么说） | 根因 | 修在哪 |
|---|---|---|
| 「我明明把三样东西圈起来了，框却写着 0，还是虚线的空框」 | 「中心点在框里 = 属于这个框」这条语义**只有拖动那条入口实现了**，画框那条入口压根没问过——`createFrame` 只存矩形，成员名单恒为空 | `useCanvasFrameTool.finishDraw` 用**同一个**判据（`frameContainsNodeCenter`）和**同一个**矩形探针（内核测量值）算出圈住了谁，交给 `createFrame`；`createGroup` 的 `nodeIds` 语义原样复用（一个节点只属一个框、旧组交人） |
| 「框怎么越拖越大」/「刚画的空框拖不动」 | 框的位置有**两份真相**（用户画的 `frameBounds` + 成员位置），渲染是两者并集且只长不缩，而 `moveGroupNodes` 只搬了成员那一份；空框那一半的守卫直接写在 `nodeIds.length` 上 | `moveGroupNodes` 同步平移 `group.frameBounds`（**不取整**，见下条），守卫从「有成员」改成「有东西可动」 |
| 「框跟不上手，越拖差得越远」 | 下游写口是 `Math.round(position + delta)`，每帧那点小数被**就地丢掉**；匀速拖动里每帧小数几乎是同一个值，于是不是抖动而是**系统性缺斤少两**（实测拖 150px 只走 144）。更坏的是框（小数矩形）和成员（整数位置）被截掉的量不同，两者会慢慢错位 | `useCanvasSelectionDrag.flushPendingDragMove` 每帧只下发**整数**位移，余数留在待发账上给下一帧 |

顺带修掉的第四条（同一条走查的 `expectOverlayReachable` 钉住）：点一下框会选中框里全部成员，选择浮条随即出现在成员外接盒上方 16px，而框的名字/说明/计数写在比它还高 52px 的标签带上——**浮条正好把你刚抓住的那个框的身份牌盖掉**。修在 `selectionToolbarPlacement.expandSelectionBoundsToOwningFrame`：浮条要让开的是「你选中的那个**东西**」的上沿，选中的卡全在一个框里时那就是框的上沿。只往上让、不动左右，没有框的选中一个像素都不变。

### 4.9 用户看样张期间定下的两条必修（2026-09-07，不改外观）

两条都是**同一族**问题：某个浮层按「另一个东西的盒子」定位，却没问过「这块地方是不是已经有人了」。

| 现象（用户会怎么说） | 根因 | 修在哪 |
|---|---|---|
| 「『生成选中 3 个』被时间轴挡掉半截，点不准」（实拍 `10-frame-moved.png`） | 选择浮条的定位只按 `stage.height` 算「下面还剩多少地方」，把**底部那排常驻控件**（左下画布工具簇 / 批量生成停靠条 / 底部居中的时间轴胶囊 / 右下时间轴迷你画面窗）占着的地方当成空地。§4.8 那条修让浮条从框的标签带上挪开、落到选区下方，正好落进这块没人声明过的地盘 | `selectionToolbarPlacement.resolveSelectionToolbarPlacement` 多收一份**底部停靠区矩形**，判据是最朴素的那条：**浮条矩形不许和任何一块停靠区矩形相交**（横向压不上的不算——左下角的缩略图不该把一个靠右的浮条往上顶）。上下都塞不下时贴视口内侧上边，不叠在别人身上。矩形**现量**（`useCanvasBottomDockRects`）而不是写常数：这排东西的高度由 CSS 决定，抄一份数字进 TS 就是「尺寸双真相源」。名单由**停靠区自己**用 `data-canvas-bottom-dock` 声明，不在别处另抄一张会烂的黑名单。**对所有选中类型生效**，不只框 |
| 「适应视图之后，框的名字被顶上去切掉一条」 | fit 按**节点**外接盒算，而框的上沿比成员外接盒高 52px（留白 24 + 标签带 28），名字/说明/计数就写在那条带上 | `fitView` 的外接盒改成 **节点 ∪ 每个框的渲染矩形**（`model/canvasFitBounds.unionCanvasFitBounds`；框的矩形已含标签带，不另补第二份高度）。缩放上下限 0.2/3 与留白 0.12 逐字沿用旧那版，只换了外接盒；落地走 `#503` 定下的 `animateViewportTo` / 零时长直写，不用 React Flow 的 `setViewport({duration})` |

**第二条是我替用户定的（原来挂在这里等拍板），理由写在这儿**：算进去的代价是「一个画得很大的空框会把整屏挤小」——但那是**用户自己画的那一下**，他知道自己画了多大；标签带被切掉他既没要求也看不懂，而「适应视图」这个按钮的全部意义就是「让我看全」。所以**框算进去；挤小是用户自己的选择，切掉不是**（D1 从用户摩擦出发 / D4 诚实交付）。

**这两条的量具与阳性对照**（缺了对照，绿灯说明不了任何事）：

- 单测 `selectionToolbarPlacement.test.ts`：用真机那一屏的数复刻——**不传停靠区**（＝把避让关掉）时浮条**必须**判成与时间轴胶囊相交（阳性对照必红），传了之后翻到选区上方且不相交；外加「横向压不上的不参与」「上下都塞不下时贴视口内侧」「被顶出这一屏的停靠区不参与」三条边界。
- 单测 `canvasFitBounds.test.ts`：只按节点算的那一版，上沿正好比含框的那版低 `24 + 28`——把被切掉的那 52px 量出来当对照。
- 走查 `canvas-frame-real-task.walk.mjs`：抓完框之后量**真实 DOM**——浮条 bounding box 与 `[data-canvas-bottom-dock]` 每一块都不相交，且这一屏里必须真的有时间轴胶囊（否则 fail-closed，不把「没量到」说成「没叠压」）；相交判据本身先拿浮条和它自己比过一次（`selfCheck`），坏尺子量出来的「没相交」是空话。适应视图之后另量框的标签带四边有没有被舞台切掉。


---

## 5. 样张没定、我按 D1–D6 自己定的岔路

| 岔路 | 定法 | 依据 |
|---|---|---|
| **框的最小尺寸** | 拖出的矩形短边 < 一个节点宽（`160px` 画布单位）时，按 `160×120` 补齐；短边 < 24px 视为「误点」，不建框 | D1：用户不该因为手抖多出一个删不掉的针尖框；下限从节点尺寸 derive，不凭空写数 |
| **双击改名 vs 双击进节点/开加号菜单** | 双击**只在标题/说明这两个 span 上**进编辑态并 `stopPropagation`；框体空白双击照旧弹「添加节点」 | D1：两个动作的目标物不同（文字 vs 空白），用命中区分而不是用修饰键——不用教 |
| **计数预览的写法** | 头部计数徽章从 `3` 变成 `3 → 2`（出）/ `2 → 3`（入），松手复原 | D1 effect-first：直接把结果写出来，不用箭头图标让人猜 |
| **在已有框内起画（嵌套）** | 不建框，弹一条 toast「框里不能再画框——先解散外层」 | D4 诚实：明着说限制，不静默吞掉手势 |
| **空框的计数** | 显示 `0` 而不是隐藏 | D4：`0` 是真话；藏起来会让人以为框坏了 |
| **拖出去的节点落在另一个框里** | 直接改投那个框（`moveNodeToGroup` 已经会撤旧组的边、补新组的边） | 复用既有语义，不新增第三种状态 |
| **整框进时间轴一个都不合格时** | toast 说清「框里没有可进时间轴的视频/剪辑」，不静默 | D4 |

---

## 6. 回滚

单分支单 PR，回滚 = revert 整个 PR。三条需要单独交代的：

1. **`frameBounds` 回填会落盘。** 回滚代码后，旧项目里多出来的 `frameBounds` 字段仍在磁盘上——但那正是回填前**画布本来就在渲染的**那个矩形，且旧代码根本不读这个字段，所以视觉与行为零变化。**不需要反向迁移。**
2. **`description` 同理**：旧代码不读，schema 上是 optional，多一个字段不会让旧版本 parse 失败（`nodeGroupSchema` 用的是 zod object，非 strict）。
3. **设计实验室基线**：六态基线图随本轨一起进仓（`tests/ux/design-lab/__baselines__/canvas-frame/`），revert 整个 PR 会连同 `labStates.mjs` 的登记一起撤掉，不留孤儿基线。

---

## 7. 验收门

| 门 | 判据 |
|---|---|
| `pnpm run gates` | 全绿。`check:filesize`（画布壳 663 → 不得越 800）、`check:tokens`、`check:i18n`（zh/en parity）、`check:walkthroughs`、`check:design-lab`（`canvas-frame` 六态逐格比对基线）、`lint:ci`、`typecheck`、`check:test-types` |
| 单测 | 上面 §4.7 的 6 组全绿 |
| 走查 | `node tests/ux/canvas-frame.walk.mjs` 全部断言通过；截图自己 Read 过一遍（P3：expect 绿 ≠ 体验对） |
| 实验室 | `pnpm run design-lab:walk:canvas-frame` 出六态 + 接触表；拍板后六态基线已录，`check:design-lab` 逐格比对 |
| P1 | 无并行版：框只有一种（画的和 ⌘G 建的是同一个 `NodeGroup`）；生成整框复用现役批量路径；标签上无第二颗 ▶ |
| P3 / R16 | 走查跑的是「真实用户任务」串（画框 → 装东西 → 改名 → 挪出去 → 折叠 → 生成 → 进轴 → 解散），不是功能点探索 |

---

## 8. 分 commit

1. `docs(plan)`：本文档
2. `feat(canvas)`：模型 + 几何 + store（含旧组回填）
3. `feat(canvas)`：交互（工具、拖入拖出、头部、菜单）+ i18n
4. `feat(devlab)`：设计实验室 `canvas-frame` 六态
5. `test(ux)`：走查
