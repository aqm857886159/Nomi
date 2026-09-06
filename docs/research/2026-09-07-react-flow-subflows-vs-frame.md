# R29 框架边界检查：React Flow 12 的子流 vs 我们的「框工具」

> 日期：2026-09-07 · 类型：只审不改的框架边界检查（R29）· 审的对象：PR #550（`feat/canvas-frame-tool-20260906`）+ 现役 Group 一族
> 依据：R29（接框架先出四列表）· R23（React Flow 单内核 / Zustand 是业务真相源）· R20（build-vs-buy）· P1（加新必删旧）
> 版本：`@xyflow/react` 12.11.5（`package.json`），传递依赖 `@xyflow/system` 0.0.81
> 结论先说：**推荐 B（保留自研投影层），但 #550 必须补三件**，见 §5、§6。

---

## 0. 一句话的问题

React Flow 12 自带 sub-flows（`parentId` + `extent:'parent'` + `expandParent` + `type:'group'`）。PR #550 又写了一套「框」。
**这是不是在重造它？** —— 答案是「重造了一部分，但重造的那一部分**必须**重造」，理由不是口味，是原生父子的两条核心语义与 Nomi 的产品语义**正面相反**（§4）。

---

## 1. 四列表

### 1.1 成员关系（谁属于这个框）

| | 出处 |
|---|---|
| **React Flow 提供** | `NodeBase.parentId?: string`「Parent node id, used for creating sub-flows」— `node_modules/.pnpm/@xyflow+system@0.0.81/node_modules/@xyflow/system/dist/esm/types/nodes.d.ts:49-50`；内核维护 `ParentLookup = Map<string, Map<string, NodeType>>`（同包 `types/nodes.d.ts:156`），由 `adoptUserNodes` 建立（`utils/store.d.ts:18`）。文档：https://reactflow.dev/learn/layouting/sub-flows |
| **我们用了** | **零**。节点投影不写 `parentId`：`src/workbench/generationCanvas/reactFlow/generationCanvasReactFlowAdapter.ts:60-79`（`id/type/position/data/selected/draggable/…`，无 `parentId`、无 `extent`）。全仓 `src/` 里唯一出现 `parentId` 的 React Flow 语境是 §1.9 那条债。 |
| **我们另写了** | `NodeGroup.nodeIds: string[]` —— 成员是一份**显式名单**，住在 Zustand 的 `groups[]` 里，与 `nodes[]` 平级：`src/workbench/generationCanvas/model/generationCanvasTypes.ts:188-217`（`nodeIds` 在 :192）。写口 `moveNodeToGroup` / `removeNodeFromGroup`（`src/workbench/generationCanvas/store/canvasGraphActions.ts`，经 `src/workbench/generationCanvas/events/canvasWriteBoundary.ts:29-30` 分类为 document write）。 |
| **我们拆散或绕开了** | 整个 sub-flow 能力我们**一层都没接**：group 不进 `flowNodes`，改由 `ViewportPortal` 叠一层绝对定位 div（`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowViewport.tsx:198-212` → `src/workbench/generationCanvas/components/CanvasGroupProjectionLayer.tsx:39-66`）。代价：React Flow 关于父子的一切（拖动联动、`extent` 约束、z-index 分层、minimap、`onlyRenderVisibleElements` 的父子剔除）对框全部失效，得各补一份。 |

### 1.2 拖父动子

| | 出处 |
|---|---|
| **React Flow 提供** | 「When a node is assigned a `parentId`, it moves automatically whenever the parent node is moved」——https://reactflow.dev/learn/layouting/sub-flows（Using child specific options）。绝对坐标由 `updateAbsolutePositions(nodeLookup, parentLookup)` 维护（`@xyflow/system` `utils/store.d.ts:4`）。 |
| **我们用了** | 零。 |
| **我们另写了** | `moveGroupNodes(groupId, delta)`：遍历 `state.nodes`，把名单内**且同分类**的成员各加一个 delta（`src/workbench/generationCanvas/store/canvasGraphActions.ts:392-419`，分类过滤在 :407）。手势层是自建的 window pointer 监听 + rAF 节流：`src/workbench/generationCanvas/components/useCanvasSelectionDrag.ts:51-63、118-189、191-209`。 |
| **我们拆散或绕开了** | React Flow 的拖动内核（`nodeDragThreshold`、`onNodeDragStart/Drag/Stop`、拖动期的 `dragging` 标志）我们对**节点**用、对**框**不用——框的拖动完全走 DOM pointer 事件。代价：框拖动不进 React Flow 的 change 流，`canvasDragDraft.ts` 那套草稿层对它无效，两条拖动路径的节流/历史/事件语义各写一遍。 |

### 1.3 拖入拖出认父（dynamic grouping）

| | 出处 |
|---|---|
| **React Flow 提供** | **没有内建的自动认父。** 官方给的是配方：在 `onNodeDrag` 里自己用 `getIntersectingNodes(node \| rect, partially?, nodes?)`（`node_modules/@xyflow/react/dist/esm/types/instance.d.ts:113-115`）或 `isNodeIntersecting(node, area, partially?)`（同文件 :126-128）算出候选父，`onNodeDragStop` 时写 `parentId`。`onNodeDrag` 回调在 `types/component-props.d.ts:65`。 |
| **我们用了** | **`onNodeDrag` 用了**（PR #550 新接：`GenerationCanvasReactFlowViewport.tsx` props :38 + 传给 `<ReactFlow onNodeDrag={onNodeDrag}>` :171）——这一半接对了。 |
| **我们另写了** | 相交判定整条自算：`frameContainsNodeCenter(frame, node)` 与 `resolveCanvasFrameMembership({inside, isMember})` —— PR #550 `src/workbench/generationCanvas/components/canvasPointerGestureModel.ts`（新增段，见 diff 尾部）；调用与提交在 `src/workbench/generationCanvas/components/useCanvasFrameMembership.ts:52-97`（`planMembership`）与 :128-138（`commitMembership`）。矩形从 Zustand 现算：`state.nodes.find(...)` + `getCanvasNodeVisualSize(node)`（:61-66）。 |
| **我们拆散或绕开了** | `getIntersectingNodes` / `isNodeIntersecting` / 内核已维护的 `nodeLookup`（绝对坐标、含 measured 尺寸）一个都没用。代价两条：① `planMembership` 对每个拖动节点做一次 `state.nodes.find` 线性扫，再对每个框做一次判定 —— O(拖动数 × 节点数 + 拖动数 × 框数)，逐帧跑；② 尺寸来自 `resolveNodeVisualSize`（声明尺寸）而不是内核 `measured`，节点实际渲染尺寸与声明不一致时，判定线和用户看到的边不是同一条。 |

### 1.4 extent 约束（成员能不能出框）

| | 出处 |
|---|---|
| **React Flow 提供** | `extent?: 'parent' \| CoordinateExtent \| null`「Boundary a node can be moved in」——`@xyflow/system` `types/nodes.d.ts:52-56`；clamp 由 `calculateNodePosition`（`utils/graph.d.ts:160`）执行。 |
| **我们用了** | 零。 |
| **我们另写了** | **什么都没写，而且是对的**——见 §4.1：`extent:'parent'` 与「拖出去 = 退组」正面冲突。 |
| **我们拆散或绕开了** | 不适用（这一格是「刻意不用」，不是「拆散」）。**但它必须进登记表**，否则下一个 agent 会以为是漏了。 |

### 1.5 只长不缩 vs expandParent

| | 出处 |
|---|---|
| **React Flow 提供** | `expandParent?: boolean`「When `true`, the parent node will automatically expand if this node is dragged to the edge of the parent node's bounds」——`@xyflow/system` `types/nodes.d.ts:57-61`；实现 `handleExpandParent(children, nodeLookup, parentLookup, nodeOrigin)`（同包 `utils/store.d.ts:19`）。 |
| **我们用了** | 零。 |
| **我们另写了** | `unionFrameBounds(drawn, content)` = 画的矩形 ∪ 成员矩形，**只长不缩**：PR #550 `src/workbench/generationCanvas/model/canvasFrameBounds.ts:68-81`；成员外接盒 `frameBoundsFromMembers` :47-60；消费点 `src/workbench/generationCanvas/components/generationCanvasGeometry.ts:63-97`（PR 版）。现役 main 上是内联的同一算式：`generationCanvasGeometry.ts:65-87`。 |
| **我们拆散或绕开了** | `expandParent` **不能用**，见 §4.2：它就是实拍里那条 bug 的行为（框追着跑掉的成员长大）。我们的版本关键差别是「只对**仍是成员**的节点长」——退组发生在长大之前。 |

### 1.6 父先于子的数组顺序

| | 出处 |
|---|---|
| **React Flow 提供** | 「it is critical that parent nodes appear before their children in the nodes array for correct processing」——https://reactflow.dev/llms-medium.txt（Sub Flows 段）；`adoptUserNodes` 按数组序建 `nodeLookup`/`parentLookup`（`@xyflow/system` `utils/store.d.ts:18`）。 |
| **我们用了** | 不适用（没有父节点）。 |
| **我们另写了** | 无。**但正因为没有这条约束，我们的 `nodes[]` 才可以自由排序**——例如 `shotIndex` 按 `position.y` 重算（`generationCanvasTypes.ts` shotIndex 注释）、`tidyCanvasLayout.ts` 重排、MCP 整张快照替换（`applyExternalGraph`）。 |
| **我们拆散或绕开了** | 不适用。**这是 A 方案的隐性成本**：改成原生父子后，`nodes[]` 的顺序从「随便」变成**持久化不变量**，每个写口（store actions / 主进程快照 / 事件重放 / 工作流模板实例化 `canvasWorkflowTemplates.ts:179-205`）都得保证它。 |

### 1.7 相对坐标

| | 出处 |
|---|---|
| **React Flow 提供** | 「Child nodes are positioned relative to the top-left corner of their parent」——https://reactflow.dev/llms-medium.txt；绝对值由内核在 `internals.positionAbsolute` 维护（见 `canvasDragDraft.ts:80,88-91` 我们自己读写的那个字段）。 |
| **我们用了** | 零——`GenerationCanvasNode.position` 恒为绝对画布坐标。 |
| **我们另写了** | 全链路绝对坐标：投影 `generationCanvasReactFlowAdapter.ts:63`；几何 `generationCanvasGeometry.ts:35-63`；**主进程**布局与碰撞避让 `electron/capabilityCore/canvasNodeLayout.ts:37、94-116、131-146`；节点工厂 `electron/capabilityCore/canvasNodeFactory.ts:114-117`（`x/y` 直接落在记录上）。 |
| **我们拆散或绕开了** | 不适用。**这是 A 方案最贵的一格**，见 §4.3。 |

### 1.8 折叠 / 整组选中 / 组作为连线端点

| | 出处 |
|---|---|
| **React Flow 提供** | **都没有。** 没有折叠语义；父节点被选中**不会**自动选中子节点（`elevateNodesOnSelect` 只管 z-index，`types/component-props.d.ts:559`）；边端点必须是带 handle 的节点。 |
| **我们用了** | 不适用。 |
| **我们另写了** | 折叠：`NodeGroup.collapsed` + `CollapsedGroupCard`（`CanvasGroupProjectionLayer.tsx:49-64`）。整组选中：`useCanvasSelectionDrag.ts:199-207`（按名单 + 分类过滤 `selectNodes(memberIds)`）。组作连线端点：`connectToGroup` 给**每个成员各物化一条真边**，组本身不是边端点（`NodeGroup.inputLinks/outputLinks` 注释 `generationCanvasTypes.ts:196-206`：「组入参：**只是声明**——真边仍是普通 node→node 边」）。 |
| **我们拆散或绕开了** | 不适用（框架没有可拆的）。**这三条是 R20 意义上的「在护城河上」自研**，A/B 两案都得保留。 |

### 1.9 组的持久化 + MCP/Agent 写路径（跨进程）

| | 出处 |
|---|---|
| **React Flow 提供** | 无持久化。`parentId` 是节点上的一个字段，序列化由宿主负责。 |
| **我们用了** | 不适用。 |
| **我们另写了** | `NodeGroup` 是与 `nodes` **平级的独立投影**：类型 `generationCanvasTypes.ts:188`；schema `generationCanvasSchema.ts` 的 `nodeGroupSchema`；载入归一 `src/workbench/generationCanvas/store/canvasSnapshotNormalizer.ts:100-121`（PR #550 在 :112-121 加了 `backfillGroupFrameBounds` 回填）。**跨进程**：主进程把 `groups` 当与 `nodes` 平级的 `unknown[]` 透传（`electron/capabilityCore/canvasGraph.ts:30、111、118、140`），整张快照经 `applyExternalGraph` 落回渲染层（`src/workbench/generationCanvas/store/generationCanvasStore.ts:293-312`，其中 :297 `pushUndoSnapshot` 保证外部改动可 Ctrl+Z）。事件重放 `applyEventTail`（同文件 :284-292）同样按 `{nodes, edges, groups}` 三元组走。 |
| **我们拆散或绕开了** | **既有债，与本轨同一处**：`src/workbench/generationCanvas/reactFlow/canvasDragDraft.ts:74-106` 直接 `store.getState()` 拿 React Flow **内部** `nodeLookup` / `parentLookup` 并 `store.setState({nodeLookup, parentLookup, hasDefaultNodes:false})` 手改。也就是说——我们不用它的父子**语义**，却在写它的父子**索引**。这是全仓唯一碰 `parentLookup` 的地方（:101-103），且走的是私有面而非公共 API。**建议单列一条债登记**（§6.5）。 |

### 1.10 画框手势本身（新工具与内核的手势争夺）

| | 出处 |
|---|---|
| **React Flow 提供** | `panOnDrag?: boolean \| number[]`（`types/component-props.d.ts:399`）、`selectionOnDrag?: boolean`（:289）、`selectionMode`（:295）、`panActivationKeyCode`（:303）、`nodesDraggable`（:338）、`nodeDragThreshold`（:620）——一整套「这次拖动归谁」的声明式开关。 |
| **我们用了** | 部分：`selectionKeyCode="Shift"`、`multiSelectionKeyCode="Shift"`、`noPanClassName`、`deleteKeyCode={null}`（`GenerationCanvasReactFlowViewport.tsx:155-160`）。`panOnDrag` / `selectionOnDrag` / `nodesDraggable` / `nodeDragThreshold` **一个都没传**（全走默认）。 |
| **我们另写了** | PR #550 在 **capture 阶段抢 pointerdown**：`src/workbench/generationCanvas/components/useCanvasFrameTool.ts:141-157`（`handlePointerDownCapture` → `preventDefault()` + `stopPropagation()`），配合 `canvasPointerGestureModel.ts` 新增的 `'frame'` 动作优先级（排在 pan 之前）。文件头注释自陈动机：「空白左键默认归平移（React Flow 自己的 panOnDrag），等到 bubble 阶段它已经开始拖画布了」。 |
| **我们拆散或绕开了** | 这正是「绕开」的典型：内核提供了声明式的 `panOnDrag={false}`，我们改用**在它背后偷事件**。代价：内核不知道自己被停用，`onMoveStart/onMove/onMoveEnd` 那套 dragging 标志（:173-194）与画框手势各活各的；将来 React Flow 改事件绑定阶段，这里会静默失效（而且是「框画不出来」这种没有报错的失效）。 |

---

## 2. 数一下

- **「我们另写了」共 8 条**（§1.1 成员名单、§1.2 拖父动子、§1.3 相交判定、§1.5 只长不缩、§1.7 绝对坐标、§1.8 折叠/整组选中/组连线端点、§1.9 组的独立持久化、§1.10 画框手势）。其中 PR #550 新增 4 条（§1.3、§1.5、§1.10，加 §1.9 的回填）。
- **「我们拆散或绕开了」共 4 条**（§1.1 整个 sub-flow 不接、§1.2 框拖动不走内核、§1.3 相交 API 不用、§1.10 手势开关不用），外加 §1.9 一条**既有债**（写内核私有 `parentLookup`）。

---

## 3. 岔路对比表（R3）

| | **A｜改造成 React Flow 原生父子** | **B｜保留自研投影层**（推荐） |
|---|---|---|
| **做什么** | 组变成真节点（`type:'group'`），成员写 `parentId`；`nodes[]` 保证父先于子；成员 `position` 改存相对坐标 | 组仍是 `groups[]` 里的独立投影；框仍由 `ViewportPortal` 画；把 §1.3/§1.10 两条改成**复用内核的公共 API**（见 §6） |
| **用户看到** | 短期看不到差别；中期能白拿 React Flow 后续的父子改进（minimap 分层、剔除、拖动性能） | 立刻能用；框的语义（拖出=退组、只长不缩、折叠、整组选中）与拍板样张一致 |
| **持久化模型** | `NodeGroup.nodeIds` 与 `node.parentId` 两份真相源必须二选一；选后者要改 schema、归一、事件重放、工作流模板、主进程 `canvasGraph.ts` 的 groups 透传 | 零改动 |
| **相对坐标** | `GenerationCanvasNode.position` 语义分叉：有父的是相对、无父的是绝对。**主进程** `canvasNodeLayout.ts` 的碰撞避让、`canvasNodeFactory.ts:114-117` 的落位、`tidyCanvasLayout.ts` 的整理全部要学会父的存在，或每次读写做绝对↔相对转换 | 零改动 |
| **MCP / Agent 写路径** | `applyExternalGraph`（`generationCanvasStore.ts:293`）收到的是主进程算好的整张快照——主进程要么学会 parentId + 相对坐标，要么在边界做双向转换。转换写错 = 节点跑到别的地方，且**只在有组的项目里**出现 | 零改动 |
| **undo** | `pushUndoSnapshot` 是整快照，本身不受影响；但父子写入若拆成两步（改 parentId + 改 position），中间态会进历史 | 零改动（`moveNodeToGroup`/`removeNodeFromGroup` 已是一步一层） |
| **旧项目迁移** | **实测 13 个项目共 13 个组、`frameBounds` 全为 0**（扫 `~/Documents/Nomi Projects/*/.nomi/project.json`）。A 要给这 13 个组各造一个 group 节点、把成员坐标换算成相对、并保证 `nodes[]` 顺序——写坏一次就是用户项目里节点位移，不可逆 | 只需 `backfillGroupFrameBounds` 幂等回填（PR 已做，`canvasFrameBounds.ts:137-149`），且回滚安全（旧代码不读该字段） |
| **R23「Zustand 是业务真相源」** | 需要额外一层纪律：group 节点只能存在于 `flowNodes` 投影里、绝不能倒灌进 `state.nodes`（否则 `dependencyWaves.ts:47-52` 会把框当生成对象）。可做，但多一条永远要守的规矩 | 天然满足：框根本不在 React Flow 的 nodes 数组里 |
| **代价** | 大且集中在**最不能出错的地方**（用户项目坐标 + 跨进程契约） | 继续维护 8 条自研；必须登记进 `framework-boundaries.json` 并绑到期日复核 |

---

## 4. 为什么 B 的理由是**结构性**的（逐条验，不成立的我直说）

> 派工 brief 里列了四条候选理由。我逐条验，**两条不成立、两条成立**，另有一条 brief 没提但更硬的。

### 4.1 ✅ 成立（最硬）：`extent:'parent'` 与产品语义**正面相反**

原生父子里，把子约束在父内的开关是 `extent:'parent'`（`@xyflow/system types/nodes.d.ts:52-56`）——它 **clamp 位置**，成员**拖不出去**。
而 #550 这一档要修的 bug，修法恰恰是「**拖出去 = 退组**」（`useCanvasFrameMembership.ts` 头注释、`docs/plan/2026-09-06-canvas-frame-tool.md` §2.4）。
不开 `extent` 呢？那 React Flow 只剩「拖父动子」一条能力，而那条我们已有更贴合的实现（`moveGroupNodes` 带**分类过滤**，`canvasGraphActions.ts:407`——原生父子不认识 Nomi 的分类）。

### 4.2 ✅ 成立：`expandParent` **就是**那条 bug

`expandParent` 的定义是「子被拖到父边界时父自动扩张」（`types/nodes.d.ts:57-61`）。这**逐字**是实拍里那条最伤的行为：「你把一个节点从组里拖出去，框会追着长大、把它重新包住」（plan §1）。
所以原生父子给的三件（`parentId` / `extent` / `expandParent`）里，**两件必须关掉，第三件我们已有更好的**。这不是「重造轮子」，是**轮子的转向和我们要去的方向相反**。

### 4.3 ✅ 成立（成本论，不是不可能论）：相对坐标会穿透到主进程

MCP/Agent 的写路径整条建立在**绝对坐标**上：主进程 `canvasNodeLayout.ts:37/94-116` 用绝对矩形做碰撞避让，`canvasNodeFactory.ts:114-117` 直接把 `x/y` 落进记录，结果经 `applyExternalGraph`（`generationCanvasStore.ts:293`）整张快照替换。
A 方案下，「成员节点的 `position`」会**改变含义**——同一个字段，有父时相对、无父时绝对。这个歧义要么进主进程（主进程从此要认识 group），要么在边界做双向转换（每次快照进出各一次）。两条都不是不能做，但都把**最贵的错误**（用户项目里节点位移）放到了最难测的地方。

### 4.4 ❌ **不成立**：「组不是节点」

`dependencyWaves.ts:47-52` 只接 `{nodes, edges}`，组若进 `nodes` 确实会被当生成对象——**但 R23 已经写明「React Flow state 只是一层可丢弃的渲染投影」**（`docs/engineering-rules.md:550`）。adapter 完全可以在 `flowNodes` 里额外造一个 group 节点，而 Zustand 的 `state.nodes` 一个都不加。所以这条是**纪律成本**，不是结构障碍。别拿它当 B 的理由。

### 4.5 ❌ **不成立**：「成员关系要跨面被 Agent/MCP 写」

跨进程写的是 `groups[]` 这份名单没错（`canvasGraph.ts:111/140`）——但那是**我们选的持久化模型**，不是 React Flow 逼的。B 案下 `parentId` 也可以由 adapter 从 `groups[].nodeIds` **派生**，持久化仍存名单。所以这条同样是「不想改持久化」，不是「不能用父子」。真正的结构性理由是 §4.1/§4.2。

### 4.6 ⚠️ 半条成立：折叠态当连线目标

`CollapsedGroupCard` 是连线端点，而 `connectToGroup` 的语义是「给每个成员各物化一条**真边**」，组本身**不进图**（`generationCanvasTypes.ts:196-206`）。原生父子里组是节点，边自然会连到组本身——语义要额外拦。但折叠卡今天已经是 overlay，A 案下它也可以继续是 overlay。**算迁移成本，不算结构障碍。**

---

## 5. 判定

**推荐 B（保留自研投影层）。**

一句话理由：**React Flow 的父子给的三件里，两件（`extent:'parent'`、`expandParent`）与「拖出去=退组、框只长不缩」正面相反，第三件（拖父动子）我们已有认识 Nomi 分类的更贴合版本——所以这不是重造轮子，是这个轮子朝相反方向转。**

但 B **不等于**现状可以照原样合。§1.3 与 §1.10 两条是**真·重造**：相交计算和手势归属，React Flow 都有公共 API，我们绕开它们没有语义上的理由，只有「顺手就写了」。这两条必须补（§6）。

---

## 6. 若选 B，PR #550 需要补什么

> 按「必须 / 应该」分。必须的三条不补，这次登记就等于把「顺手自研」写成了「有理由的自研」——R29 §3 明说存量按**债**登记不按**豁免**登记。

### 6.1 【必须】相交判定复用内核，别从 Zustand 重算矩形

现状：`useCanvasFrameMembership.ts:56-75` 每帧 `useGenerationCanvasStore.getState()` → `state.nodes.find(...)` 线性扫 → `getCanvasNodeVisualSize(node)` 拿**声明**尺寸 → 自算中心点。
应改：用 `useReactFlow()` 拿 `getIntersectingNodes(rect, partially)`（`@xyflow/react types/instance.d.ts:113-115`）或至少 `getInternalNode(id)`（:55）读内核已维护的 `internals.positionAbsolute` + `measured` 尺寸做粗筛，再用中心点做细判。
理由不是性能洁癖：**尺寸真相源分裂**——判定用声明尺寸、用户看到的是 measured 尺寸，两者不一致时判定线和视觉边不是同一条（R14.1「同一语义有几份定义」）。中心点细判仍可保留，那是我们的产品判据（Figma/Miro 同款），保留有理由。

### 6.2 【必须】画框手势改用声明式开关，别在 capture 阶段偷事件

现状：`useCanvasFrameTool.ts:141-157` capture 阶段 `stopPropagation()`。
应改：`panOnDrag={frameToolArmed ? false : undefined}`（`types/component-props.d.ts:399`）+ `nodesDraggable={!frameToolArmed}`（:338），让内核**知道**这次拖动不归它。
理由：现在内核以为自己还在管平移，`onMoveStart/onMove/onMoveEnd`（`GenerationCanvasReactFlowViewport.tsx:173-194`）与画框各活各的；React Flow 将来改事件绑定阶段，这里会**静默**失效（画不出框、没有报错）——正是 R28「能让框架拦的别留给偷袭」那一类。

### 6.3 【必须】登记进 `docs/engineering/framework-boundaries.json`

`docs/rules-r29-r30-framework-boundary-20260907` 分支尚未合入 `origin`（`git fetch origin <branch>` → `couldn't find remote ref`；本地分支存在，`dd9a2f307`）。所以这里给**登记草案**，等那条分支合入后原样并进去：

```json
{
  "id": "xyflow-react",
  "packages": ["@xyflow/react"],
  "version": "12.11.5",
  "fourColumnTable": "docs/research/2026-09-07-react-flow-subflows-vs-frame.md",
  "why": "2026-09-07 R29 边界检查：React Flow 12 的 sub-flows 我们一层都没接。两件核心语义（extent:'parent' 禁止成员出框、expandParent 父追着子长大）与 Nomi 的框语义正面相反，故不是重造而是刻意不用；但相交计算与手势归属两处绕开了内核公共 API，属真·自研债。",
  "capabilities": [
    {
      "id": "subflow-parenting",
      "provides": "parentId + extent:'parent' + expandParent + ParentLookup：节点父子、拖父动子、边界约束、父自动扩张",
      "evidence": "@xyflow/system@0.0.81 dist/esm/types/nodes.d.ts:49-61（parentId/extent/expandParent）、:156（ParentLookup）；https://reactflow.dev/learn/layouting/sub-flows",
      "scope": ["src/workbench/generationCanvas/"],
      "justifiedOwnImplementation": {
        "reason": "extent:'parent' 与「拖出框=退组」正面冲突；expandParent 逐字就是 2026-09-06 实拍里那条 bug（框追着跑掉的成员长大）。拖父动子我们的 moveGroupNodes 额外带 categoryId 过滤，原生父子不认识 Nomi 分类。",
        "ours": [
          "src/workbench/generationCanvas/model/generationCanvasTypes.ts:188 NodeGroup.nodeIds（成员名单）",
          "src/workbench/generationCanvas/store/canvasGraphActions.ts:392 moveGroupNodes（拖父动子 + 分类过滤）",
          "src/workbench/generationCanvas/model/canvasFrameBounds.ts:68 unionFrameBounds（只长不缩，替 expandParent）"
        ],
        "reviewBy": "2026-12-07"
      },
      "forbidden": [
        {
          "id": "half-migrated-native-parenting",
          "pattern": "parentId:\\s*(group|frame)",
          "why": "框一旦改用原生 parentId，成员 position 就变成相对坐标，会穿透到主进程 canvasNodeLayout/canvasNodeFactory 的绝对坐标契约。要迁必须整条迁并改本登记，不许半迁。"
        }
      ]
    },
    {
      "id": "node-intersection",
      "provides": "getIntersectingNodes / isNodeIntersecting：基于内核 nodeLookup 的绝对坐标 + measured 尺寸做相交计算",
      "evidence": "@xyflow/react@12.11.5 dist/esm/types/instance.d.ts:113-115、:126-128",
      "scope": ["src/workbench/generationCanvas/components/"],
      "forbidden": [
        {
          "id": "hand-rolled-node-rect-for-hit-testing",
          "pattern": "getCanvasNodeVisualSize\\([^)]*\\)[\\s\\S]{0,200}?(contains|intersect|Overlap)",
          "why": "从 Zustand 重算节点矩形做命中判定，用的是声明尺寸而非内核 measured 尺寸——判定线与用户看到的边会分叉（R14.1 同一语义两份定义）。"
        }
      ],
      "debt": ["src/workbench/generationCanvas/components/useCanvasFrameMembership.ts:56-75"]
    },
    {
      "id": "gesture-ownership",
      "provides": "panOnDrag / selectionOnDrag / nodesDraggable / nodeDragThreshold：声明式地把一次拖动判给谁",
      "evidence": "@xyflow/react@12.11.5 dist/esm/types/component-props.d.ts:399、:289、:338、:620",
      "scope": ["src/workbench/generationCanvas/"],
      "forbidden": [
        {
          "id": "capture-phase-gesture-theft",
          "pattern": "onPointerDownCapture[\\s\\S]{0,400}?stopPropagation",
          "why": "在 capture 阶段抢 React Flow 的 pointerdown，内核不知道自己被停用；框架改事件绑定阶段时会静默失效（没有报错的那种）。用 panOnDrag={false} 明说。"
        }
      ],
      "debt": ["src/workbench/generationCanvas/components/useCanvasFrameTool.ts:141-157"]
    },
    {
      "id": "internal-store-lookups",
      "provides": "nodeLookup / parentLookup 由 adoptUserNodes + updateAbsolutePositions 维护，是内核私有面",
      "evidence": "@xyflow/system@0.0.81 dist/esm/utils/store.d.ts:4、:18",
      "scope": ["src/workbench/generationCanvas/reactFlow/"],
      "forbidden": [
        {
          "id": "write-internal-parent-lookup",
          "pattern": "setState\\(\\{[^}]*parentLookup",
          "why": "直接手改内核的 parentLookup/nodeLookup 走的是私有面，升版无兼容承诺；而且我们并不使用它的父子语义，只是在写它的索引。"
        }
      ],
      "debt": ["src/workbench/generationCanvas/reactFlow/canvasDragDraft.ts:74-106"]
    }
  ]
}
```

> 三条 `debt` 均为**既有/本轨引入的债**，按 R29 §3 绑到期日（建议 `2026-12-07`）与收敛方案（本文 §6.1/§6.2/§6.5），不按豁免登记。

### 6.4 【应该】加一条结构断言：框永不进 `flowNodes`

`dependencyWaves.ts:47-52` 只认 nodes/edges；今天框不在 nodes 里是「碰巧」，没有断言钉住。建议在 `generationCanvasReactFlowAdapter` 的既有 adapter 测试里加一条：给定 N 个节点 + M 个组，`toFlowNodes(...)` 长度恒为 N。这一条同时把 A 案未来若要迁移的那条纪律先立在那里。

### 6.5 【应该】把 `canvasDragDraft.ts:74-106` 单列一条债

它是全仓唯一写内核 `parentLookup` 的地方（:101-103），且与本轨讨论的是同一个索引。收敛方向：既然我们没有父子，`parentLookup` 那三行其实是**死路径**（`node.parentId` 恒 undefined）——先加断言证明恒 false，再删（P1）。**这条我只做了静态判断，没跑证明，交给实施轨去验。**

### 6.6 【应该】`empty` 框与 `onlyRenderVisibleElements`

`GenerationCanvasReactFlowViewport.tsx:158` 开了 `onlyRenderVisibleElements`——它只剔除**节点**。空框走 `ViewportPortal` 的 overlay，不受剔除管；一个 5000×5000 的空框在缩到很小的视口里仍会整块渲染。第一档量级下不是问题，写进登记表的复核项即可。

---

## 7. 六角色评审（R7）

**CTO。** B 是对的，但理由必须写成 §4.1/§4.2 那两句，不能写成「我们已经有一套了」——后者是沉没成本，前者是结构判断，两者在文档里长得很像，半年后接手的人只能看见文字。另外 §6.3 的登记必须落，否则这次审计的结论会和 #546 那次一样只活在文档里。

**设计。** 框的语义是「空间」，成员是「名单」，两者用一个手势对齐——这个取舍是清楚的，原生 `extent` 会把它退化成「牢笼」。唯一要盯的是 §6.1 那条尺寸分裂：用户拖动时看到的是渲染出来的边，判定却用声明尺寸，一旦某类节点的实际高度和声明不符，就会出现「明明拖进去了却没入组」——这是最难解释的一类 bug。

**PM。** 13 个真实项目共 13 个组、`frameBounds` 全空——A 案的迁移面比听起来小，但风险不在数量在**性质**（坐标写坏不可逆）。B 案能立刻交付用户拍板过的语义，A 案的收益（白拿框架后续改进）在没有嵌套框需求之前兑现不了。同意 B，且建议把「嵌套框」明确写成未来重新评估 A 的触发条件。

**前端。** §6.2 是我最在意的：capture 阶段 `stopPropagation` 属于「和框架抢方向盘」，React Flow 12 的事件绑定层这两年动过不止一次。`panOnDrag={false}` 一行就能表达同一件事且内核自洽，改动量比现在这套小。§6.1 顺带解决逐帧 `state.nodes.find` 的线性扫，画布性能战役刚把拖动从 49.3ms 压到 12.9ms，别在这里加回来。

**后端 / 主进程。** §4.3 是我唯一坚持的一票：`canvasNodeLayout.ts` 的碰撞避让和 `canvasNodeFactory.ts:114-117` 的落位都建立在「position 就是绝对坐标」这个不需要说明的前提上。A 案会让这个前提变成「取决于有没有父」，而主进程根本看不见 React Flow。要迁必须整条迁（含 `applyExternalGraph` 边界的双向转换 + 契约测试），半迁比不迁危险得多——所以 §6.3 里那条 `half-migrated-native-parenting` 的 forbidden 规则请务必保留。

**真实用户。** 我不知道什么是 parentId。我要的是：把这张图拖出框，它就不属于这一组了，而且我松手之前就知道会这样。这一档做到了。剩下的建议我只关心一件：别让「框工具就绪」变成一个出不去的模式——`useCanvasFrameTool.ts:92-95` 画一次收一次工具、Esc 可退，这个是对的，别在后续版本里改成「连续画」。

---

## 8. 这次检查本身的边界

- 只审不改代码；`docs/plan/2026-09-06-canvas-frame-tool.md` 与 PR #550 的实现均通过 `git show origin/feat/canvas-frame-tool-20260906:<path>` 读取（merge-base `1365441db`）。
- React Flow 事实全部取自本仓装的 `@xyflow/react@12.11.5` / `@xyflow/system@0.0.81` 的 `.d.ts`，以及 Context7 拉到的 reactflow.dev 文档；**没有凭记忆**。
- 未做：真机走查、性能实测、§6.5 那条死路径的运行时证明。这三件属于实施轨。
