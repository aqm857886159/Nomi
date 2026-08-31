# Nomi 画布分组与工作流库代码盘点（2026-08-30）

## 0. 研究范围与基线

- 研究工作树：`/Users/aoqimin/Desktop/Nomi-canvas-plugin-system-20260830`
- 当前分支：`codex/canvas-plugin-system-20260830`
- 当前提交：`05e05d2f07b815bcff7b940f091006efc39d1343`
- 当前提交的 `origin/main` 基线：`62361d966950892463d2db2804a8437469282243`
- 本文只盘点当前代码，不修改生产源码。
- 重点问题：真实的画布分组是什么、当前“保存为流程”实际保存了什么、跨项目流程库需要补哪些合同、原型里的“概览”是否有真实产品语义。

## 1. 结论先行

### 1.1 “概览”没有对应的生产入口，应从方案中删除

生产侧左栏只有素材库、分组、提示词库和技能库四个 tab；`ProjectSidebarTab` 没有 `overview`，面板渲染也只分派这四种内容（`src/workbench/explorer/ProjectExplorerSidebar.tsx:42-46`, `src/workbench/explorer/ProjectExplorerSidebar.tsx:124-158`, `src/workbench/explorer/ProjectExplorerSidebar.tsx:316-331`）。

独立项目库是 App 的顶层 `library` view，用来新建、打开、搜索和筛选项目，不是一个聚合提示词、Skill、素材和流程的“总览页”（`src/workbench/NomiStudioApp.tsx:48`, `src/workbench/NomiStudioApp.tsx:705-713`, `src/workbench/library/ProjectLibraryPage.tsx:241-269`, `src/workbench/library/ProjectLibraryPage.tsx:301-334`）。

原型中的“概览”只存在于 `docs/prototypes/library-discovery.html:72,80`，而且原型逻辑会把 `overview` 强制改回 `workflow`（`docs/prototypes/library-discovery.html:117`）。它既不是现有功能，也没有独立用户任务。最终方案应直接删除，不为它创造新信息架构。

### 1.2 画布分组不是装饰框，而是持久化的图语义

当前 `NodeGroup` 同时包含成员、分类、收起状态、输入/输出关系声明和时间戳；节点另有 `groupId`，边另有 `viaGroupId`，因此分组是三处关联的数据合同，不只是 UI 包围框（`src/workbench/generationCanvas/model/generationCanvasTypes.ts:127-153`, `src/workbench/generationCanvas/model/generationCanvasTypes.ts:186-213`, `src/workbench/generationCanvas/model/generationCanvasTypes.ts:215-235`）。

组连接仍物化成真实 node-to-node 边；`inputLinks` / `outputLinks` 只是让新增成员自动继承连接的声明，`viaGroupId` 用于成员离组或整组断连时精确撤边（`src/workbench/generationCanvas/model/generationCanvasTypes.ts:195-204`, `src/workbench/generationCanvas/model/generationCanvasTypes.ts:230-235`, `src/workbench/generationCanvas/model/groupInputLinks.test.ts:134-149`, `src/workbench/generationCanvas/model/groupInputLinks.test.ts:263-298`）。

因此，“流程原样复制”若不复制和重映射 groups，就不是完整复制。

### 1.3 当前 `workflowTemplates` 只是项目内的节点片段，不是跨项目流程库

当前模板合同只有 `id/name/timestamps/nodes/edges`，没有描述、标签、封面、合同版本、组、资产清单、插件依赖或迁移信息（`src/workbench/generationCanvas/plugins/canvasWorkflowTemplates.ts:3-16`）。

捕获只克隆选中节点和两端都在选区内的边（`src/workbench/generationCanvas/plugins/canvasWorkflowTemplates.ts:36-62`）；实例化只重映射节点 ID 和边 ID（`src/workbench/generationCanvas/plugins/canvasWorkflowTemplates.ts:65-87`）。它不会重映射 `groupId`、`viaGroupId`、组连接声明、项目素材 URL 或自定义分类。

模板保存在当前项目的 `generationCanvas.workflowTemplates` 中，随项目快照关闭重开，但不是用户级全局存储（`src/workbench/generationCanvas/store/generationCanvasStore.ts:200-223`, `src/workbench/project/workbenchProjectSession.ts:10-25`, `src/workbench/project/workbenchProjectSession.ts:28-43`）。

### 1.4 现有代码已证明正确的底座应复用，不应另造旁路

- React Flow 是渲染投影层，真实图状态仍在 Zustand store；React Flow 的 selection/position change 被翻译回 store 动作（`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx:447-476`）。
- 所有画布文档写动作经过统一 `withCanvasWriteBoundary`，其中已经列入分组、流程捕获和流程实例化（`src/workbench/generationCanvas/events/canvasWriteBoundary.ts:12-31`, `src/workbench/generationCanvas/events/canvasWriteBoundary.ts:78-87`）。
- 项目保存监听 `persistRevision`，700ms 防抖并在卸载/关闭前补刷（`src/workbench/project/workbenchProjectSession.ts:146-147`, `src/workbench/project/workbenchProjectSession.ts:185-220`, `src/workbench/project/workbenchProjectSession.ts:229-255`）。
- 节点、边、组已有事件重放和会话内 Undo/Redo；不应在流程库实现第二套画布写入器（`src/workbench/generationCanvas/events/canvasUndoJournal.ts:1-18`, `src/workbench/generationCanvas/events/canvasEventReducer.ts:24-203`）。

最终实现应只新增“捕获/存储/导入流程包”的合同与窄桥，最后仍调用一个统一的 store 批量写动作落画布。

## 2. 现有画布数据链路

### 2.1 节点、边和组的真实模型

`GenerationCanvasNode` 保存节点身份、语义 `kind`、可选插件 `typeId/pluginState`、位置/大小、提示词、引用、结果/历史、状态、元数据、分类和 `groupId`（`src/workbench/generationCanvas/model/generationCanvasTypes.ts:127-184`）。

`NodeGroup` 的关键字段：

- `categoryId`：组只属于一个画布分类。
- `nodeIds`：组成员主清单。
- `collapsed`：收起状态。
- `inputLinks`：外部来源连入组时的声明。
- `outputLinks`：组作为来源连到外部目标时的声明。
- `createdAt/updatedAt`：持久化元数据。

证据：`src/workbench/generationCanvas/model/generationCanvasTypes.ts:186-213`。

`GenerationCanvasEdge` 仍然只连节点；`viaGroupId` 标记该边由哪个组声明物化，保证成员离组或断开聚合关系时不会误删手工边（`src/workbench/generationCanvas/model/generationCanvasTypes.ts:215-235`）。

成员关系当前是“双向冗余”：`group.nodeIds` 与 `node.groupId` 都存在。测试夹具也明确要求两边同时成立（`src/workbench/generationCanvas/model/groupInputLinks.test.ts:37-47`）。流程捕获/迁移必须维护这个不变量。

### 2.2 分类与分组是两层不同概念

项目分类 `ProjectCategory` 决定当前看哪一张分类画布，以及该分类节点的默认渲染样式；内置分类是分镜、角色、场景、道具和声音（`src/workbench/project/projectCategories.ts:25-39`, `src/workbench/project/projectCategories.ts:41-91`）。所有分类共用一套画布底座（`src/workbench/project/projectCategories.ts:4-10`）。

`NodeGroup` 是某个分类画布内部的一组节点。`CategoryTree` 先按 `categoryId` 分节点和组，再显示组下成员（`src/workbench/sidebar/CategoryTree.tsx:119-152`）。跨分类把节点拖进组时，现有行为是先创建独立副本，再加入目标组，不是把同一个节点跨分类共享（`src/workbench/sidebar/CategoryTree.tsx:189-227`）。

左栏把 `categories` tab 对用户命名为“分组”，但它实际同时承载顶层分类和分类内 `NodeGroup`（`src/workbench/explorer/ProjectExplorerSidebar.tsx:72-80`, `src/workbench/explorer/ProjectExplorerSidebar.tsx:124-138`, `src/workbench/sidebar/CategoryTree.tsx:30-34`）。方案文档必须明确这两层，不能把“流程分类”“画布分类”“节点分组”混成一个 category 字段。

### 2.3 选中、框选与建组入口

React Flow 仍使用 `@xyflow/react`，配置为：

- 节点/边由受控 `nodes/edges` 输入；
- 主键拖动画布，Shift 是框选与多选键；
- 只渲染可视元素；
- 删除键由 Nomi 自己接管。

证据：`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowViewport.tsx:121-151`。

React Flow 结束框选后，Nomi 才把内部选区一次性提交到 Zustand，避免 selection 反馈循环（`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx:447-476`）。

当选中两个以上节点时，选区浮条显示批量生成、联系表、创建/解除分组、保存为流程和清除选择（`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowViewport.tsx:184-203`, `src/workbench/generationCanvas/components/CanvasSelectionToolbar.tsx:60-114`）。

建组还有两条现役入口：

- `Cmd/Ctrl+G` 建组，`Shift+Cmd/Ctrl+G` 解组（`src/workbench/generationCanvas/components/useCanvasShortcuts.ts:151-161`）。
- 节点右键菜单中的“建组”，少于两个节点时禁用并解释（`src/workbench/generationCanvas/components/NodeContextMenu.tsx:25-34`, `src/workbench/generationCanvas/components/NodeContextMenu.tsx:60-78`）。

这意味着“框选 → 保存为流程”已经有真实入口；不需要另做一套选择器。要做的是把现有按钮从“保存项目内模板”升级为“保存全局流程包”。

### 2.4 分组创建、移动、收起和连线语义

`groupSelectedNodes` 只收当前 category 中的选中节点，少于两个直接返回；被重新分组的节点会从旧组移出，保证一个节点只属于一个组（`src/workbench/generationCanvas/store/canvasGraphActions.ts:466-506`）。

点击或拖动组框会先选中组内全部成员；首次真实移动前才打 Undo barrier，拖动过程不逐帧持久化，松手后统一发节点移动/组更新事件并提交持久化（`src/workbench/generationCanvas/components/useCanvasSelectionDrag.ts:118-169`, `src/workbench/generationCanvas/components/useCanvasSelectionDrag.ts:191-209`）。

展开组的框由成员真实尺寸计算，自动加 padding 和标签空间，不依赖保存的 `frameBounds`（`src/workbench/generationCanvas/components/generationCanvasGeometry.ts:65-86`）。组框本身也能成为连线落点，但不会新增一种“组边”数据模型（`src/workbench/generationCanvas/components/GroupFrame.tsx:25-42`, `src/workbench/generationCanvas/components/GroupFrame.tsx:94-108`）。

收起时，成员节点和组内边只从投影中隐藏；真实节点/边仍留在 store。收起卡位置取成员左上角，封面优先用最后一个带图/视频结果的成员，组间关系只在显示层聚合（`src/workbench/generationCanvas/model/canvasCardStackModel.ts:33-39`, `src/workbench/generationCanvas/model/canvasCardStackModel.ts:41-103`, `src/workbench/generationCanvas/model/canvasCardStackModel.ts:106-147`）。

收起卡保留左右连接把手，可整组移动和重新展开（`src/workbench/generationCanvas/components/CollapsedGroupCard.tsx:46-84`, `src/workbench/generationCanvas/components/CollapsedGroupCard.tsx:85-114`）。

### 2.5 撤销、重做、保存、关闭与重开

组的创建、重命名、收起、解组、删除等动作都在写前 `pushUndoSnapshot`，写后 bump `persistRevision` 并发画布事件；例如建组（`src/workbench/generationCanvas/store/canvasGraphActions.ts:466-505`）、收起（`src/workbench/generationCanvas/store/canvasGraphActions.ts:544-562`）、解组（`src/workbench/generationCanvas/store/canvasGraphActions.ts:564-602`）。

Undo/Redo 使用事件日志前缀重放，保留 80 个手势 barrier；切项目/重开会清会话历史，并以恢复出的画布作为新基线（`src/workbench/generationCanvas/events/canvasUndoJournal.ts:13-18`, `src/workbench/generationCanvas/events/canvasUndoJournal.ts:38-74`, `src/workbench/generationCanvas/events/canvasUndoJournal.ts:97-115`）。

项目持久化读取 document snapshot，故保存 `nodes/edges/groups/workflowTemplates`，但不保存 `selectedNodeIds`；重开项目也明确清空选区（`src/workbench/generationCanvas/store/generationCanvasStore.ts:190-223`）。

项目会按 `persistRevision` 700ms 防抖保存，页面关闭和订阅释放前尝试补刷最后一次快照（`src/workbench/project/workbenchProjectSession.ts:146-147`, `src/workbench/project/workbenchProjectSession.ts:185-220`, `src/workbench/project/workbenchProjectSession.ts:229-255`）。

现有真实走查脚本验证了：组收起后成员隐藏、真实成员边聚合、收起状态写入 `.nomi/project.json`、返回项目库再打开仍保持收起、展开后恢复真实成员边（`tests/ux/canvas-card-stack.walk.mjs:272-327`, `tests/ux/canvas-card-stack.walk.mjs:342-349`）。本文没有重新跑 Electron 走查，只把它记为“仓内已有验收覆盖”；本轮实际运行结果见第 7 节。

## 3. 当前 `workflowTemplates` 的真实能力和缺口

### 3.1 已有能力

1. 多选节点后可从选择浮条保存模板（`src/workbench/generationCanvas/components/CanvasSelectionToolbar.tsx:101-107`）。
2. 保存动作捕获节点与内部边，写入当前项目 store，并 bump 持久化 revision（`src/workbench/generationCanvas/store/canvasNodeActions.ts:492-506`）。
3. 画布左侧工具栏在当前项目存在模板时显示一个原生 `<select>`，选择后插入到当前画布位置（`src/workbench/generationCanvas/components/CanvasToolbar.tsx:166-185`）。
4. 实例化会创建新节点/边 ID、选中新节点、清待连态、写入一个 Undo barrier并发节点/边 added 事件（`src/workbench/generationCanvas/store/canvasNodeActions.ts:508-528`）。
5. 单测覆盖项目内保存、插入、Undo/Redo和手工快照关闭重开（`src/workbench/generationCanvas/store/canvasWorkflowStore.test.ts:16-43`）。

### 3.2 确认缺口：分组无法原样复制

模板类型没有 `groups`（`src/workbench/generationCanvas/plugins/canvasWorkflowTemplates.ts:9-16`）。捕获会深拷贝节点，因此节点原有 `groupId` 被原样带入（`src/workbench/generationCanvas/plugins/canvasWorkflowTemplates.ts:56-60`）；实例化只替换节点自己的 `id`，不会替换 `groupId`（`src/workbench/generationCanvas/plugins/canvasWorkflowTemplates.ts:72-79`）。

本轮使用当前代码执行了一个最小复现：两个 `groupId='g-source'` 的节点捕获、实例化后，输出模板 key 只有 `id/name/createdAt/updatedAt/nodes/edges`，两个新节点仍然都是 `groupId='g-source'`。也就是说：复制后没有组记录，节点却引用旧组 ID。

这不是 UI 问题，是模板合同缺字段。完整方案必须把 `NodeGroup[]` 纳入流程快照，并在导入时同时重映射：

- `group.id`
- `group.nodeIds[]`
- `node.groupId`
- `edge.viaGroupId`
- `group.inputLinks[].sourceNodeId`
- `group.outputLinks[].targetNodeId`

### 3.3 确认缺口：不是跨项目、也不拥有素材

`workflowTemplates` 位于 `GenerationCanvasSnapshot`，由当前项目 snapshot 保存（`src/workbench/generationCanvas/model/generationCanvasTypes.ts:246-254`, `src/workbench/generationCanvas/store/generationCanvasStore.ts:200-208`）。另一个项目不会读取它。

节点结果/历史中保存的是 URL；Nomi 本地素材 URL 带项目 ID（`src/workbench/generationCanvas/model/generationCanvasTypes.ts:71-88`, `electron/assets/assetPaths.ts:44-45`）。当前模板只是 JSON 深拷贝节点，不复制对应文件，所以“跨项目复制”仍然引用源项目文件。

当前素材库从“所有项目”拖到画布也是直接把 `renderUrl` 写进新节点，并没有把文件复制进目标项目（`src/workbench/generationCanvas/components/canvasStageDrop.ts:278-318`）。底层为了兼容这种引用，已有按 URL 自带 projectId 解析源文件的能力（`electron/assets/localAssetFile.ts:36-55`），但源项目被删除、移动或解绑后，流程里的媒体仍会失效。它不满足“流程自己带着图片/视频跨项目复用”的产品承诺。

因此，全局流程库不能只保存源项目 ID + 节点 JSON；保存流程时必须把已声明的本地媒体复制到流程包自己的受管目录，导入目标项目时再经现有资产写入能力复制到目标项目并重写 URL。

### 3.4 确认缺口：没有版本合同和迁移入口

`isCanvasWorkflowTemplate` 只浅检 id/name/nodes/edges 及节点条目的少数字段；它不验证节点 schema、边 schema，也没有 `formatVersion/schemaVersion`（`src/workbench/generationCanvas/plugins/canvasWorkflowTemplates.ts:23-30`）。

当前模板也没有：

- 描述、标签、收藏、最近使用、封面策略；
- Nomi 最低/最高兼容版本；
- 所需插件与插件版本；
- 节点/插件状态迁移记录；
- 资产清单、hash、媒体类型、文件大小；
- 缺失插件时的预检摘要。

所以当前合同只能称为项目内原型，不应直接演进成全局持久格式而不先加版本层。

### 3.5 确认缺口：自定义分类与组 schema 不一致

业务类型 `CategoryId` 已放宽为任意 string，store 的 `isCategoryId` 也接受任意非空字符串（`src/workbench/generationCanvas/model/generationCanvasTypes.ts:16-21`, `src/workbench/generationCanvas/store/canvasGuards.ts:18-22`）。

但 `nodeGroupSchema.categoryId` 仍使用内置五分类 enum（`src/workbench/generationCanvas/model/generationCanvasSchema.ts:10`, `src/workbench/generationCanvas/model/generationCanvasSchema.ts:121-145`），而 restore normalizer 会直接丢掉无法通过该 schema 的组（`src/workbench/generationCanvas/store/canvasSnapshotNormalizer.ts:100-109`）。

本轮最小复现：`cat-6` 节点和 `cat-6` 组恢复后，节点仍保留 `categoryId='cat-6'` 与 `groupId='g'`，但 `groups.length` 变成 0。现有 schema 测试甚至明确断言非内置 category 的 group 应抛错（`src/workbench/generationCanvas/model/generationCanvasSchema.test.ts:29-49`）。

这是现存数据一致性问题，也会直接破坏带自定义分类的工作流。流程库实现前必须先统一 category 合同，不能在新包里绕过 normalizer。

### 3.6 需明确但不能擅自猜的产品边界

当前画布一次只显示一个 `activeCategoryId`；节点、边和组都按当前分类过滤（`src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx:99-105`, `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx:140-151`）。因此用户在画布上框选保存的流程天然是“当前分类内”的流程。

第一阶段建议把合同明确为：

- 只保存当前分类中框选的流程；
- 导入时把包内所有节点和组 remap 到目标当前分类；
- 保留节点相对位置、大小、内容、结果、历史、插件状态和组结构；
- 不复制源项目的顶层分类定义。

如果未来要支持跨分类流程，必须显式加入 `categories[]` 及多分类导入体验；不能悄悄把源项目的自定义分类塞进目标项目。这是后续能力，不应堵住第一阶段。

## 4. 现有库入口与“概览”的关系

### 4.1 顶层项目库

App 只有 `library | studio` 两个顶层 view（`src/workbench/NomiStudioApp.tsx:48`）。项目库负责：

- 新建空白项目、打开文件夹、打开引导（`src/workbench/library/ProjectLibraryPage.tsx:241-269`）；
- 按全部/本地/文件夹筛选（`src/workbench/library/ProjectLibraryPage.tsx:132-153`, `src/workbench/library/ProjectLibraryPage.tsx:301-325`）；
- 按项目名搜索（`src/workbench/library/ProjectLibraryPage.tsx:132-135`, `src/workbench/library/ProjectLibraryPage.tsx:327-333`）。

它不是编辑中插入资源的地方。把工作流库塞进这个顶层项目库会打断“在当前画布插入”的任务上下文。

### 4.2 Studio 左侧栏

现有可用的库都在 `ProjectExplorerSidebar`：素材库和“分组”在主 rail，提示词与 Skill 在库分隔线下（`src/workbench/explorer/ProjectExplorerSidebar.tsx:124-158`, `src/workbench/explorer/ProjectExplorerSidebar.tsx:220-256`）。库 tab 默认展开宽度 500px，分组 tab 默认 300px，且用户可拖拽调宽（`src/workbench/explorer/ProjectExplorerSidebar.tsx:44-47`, `src/workbench/explorer/ProjectExplorerSidebar.tsx:160-168`）。

工作流库的最自然真实入口是：在 `libraryRailItems` 中新增“流程”，与提示词/Skill 同级；不要新增“概览”。保存入口仍留在选区浮条，找/复制入口在左侧流程库。

### 4.3 可复用的现有库做法

提示词“我的库”已是用户级跨项目存储：renderer 通过窄 `promptLibrary.userList/userAdd/userUpdate/userDelete` 桥调用主进程（`src/desktop/bridge.ts:594-613`, `electron/preload.ts:394-427`）；主进程每个 IPC 都先做 trusted sender 校验（`electron/promptLibrary/promptLibraryIpc.ts:8-17`, `electron/promptLibrary/promptLibraryIpc.ts:20-55`）；数据落在 settings root 的原子 JSON，而不是某个项目目录（`electron/promptLibrary/userPromptStore.ts:1-10`, `electron/promptLibrary/userPromptStore.ts:38-60`）。

这是全局流程库元数据存储可复用的安全模式，但流程包还含二进制，不能照抄“单 JSON 文件”。建议仍用窄域 API，但存储为：

```text
<settingsRoot>/workflows/
  index.json
  <workflowId>/
    manifest.json
    assets/<content-hash>.<ext>
```

renderer 只传结构化捕获请求/接收结构化 DTO；不获得任意路径读写能力。主进程负责路径解析、schema 校验、原子落盘和素材复制。

### 4.4 当前各库的检索现实

- 项目库仅搜项目名，按来源筛选（`src/workbench/library/ProjectLibraryPage.tsx:132-153`）。
- 提示词库已有“我的/Nomi + 全部/图片/视频 + 搜索”，但搜索只覆盖标题、正文和来源，已有 tags 尚未进入搜索（`src/workbench/promptLibrary/PromptLibraryPanel.tsx:59-71`, `src/workbench/promptLibrary/PromptLibraryPanel.tsx:239-249`, `src/workbench/api/promptLibraryApi.ts:117-126`）。
- Skill 库只有“我的/内置 + 名称/描述搜索”，没有分类筛选（`src/workbench/skillLibrary/SkillLibraryPanel.tsx:44-59`, `src/workbench/skillLibrary/SkillLibraryPanel.tsx:235-255`）。
- 素材库已有所有项目/当前项目、类型筛选、搜索和项目内文件夹；“所有项目”通过遍历每个项目的分页资产列表得到（`src/workbench/assets/AssetLibraryPanel.tsx:156-205`, `src/workbench/assets/AssetLibraryPanel.tsx:526-600`, `src/workbench/assets/AssetLibraryPanel.tsx:639-668`, `src/workbench/assets/useAllProjectAssets.ts:89-140`）。

这些可以统一视觉部件和过滤心智，但不应合并成一个“概览”或一张混合资源表。每个库保留自己的主动作和所有权边界。

## 5. 对完整方案的实现约束

### 5.1 流程包 V1 必须包含的最小合同

建议合同名为 `CanvasWorkflowPackageV1`，至少分四层：

1. `manifest`
   - `formatVersion`
   - `id/name/description/tags/createdAt/updatedAt`
   - `minNomiVersion`
   - `pluginRequirements[{pluginId, versionRange, typeIds}]`
   - `cover`
   - `sourceSummary`（仅展示，不作为读取源项目的依赖）
2. `graph`
   - `nodes[]`
   - `edges[]`
   - `groups[]`
   - `origin` 与相对位置
   - 第一阶段 `categoryPolicy: 'target-current-category'`
3. `assets`
   - 逻辑 asset ID、相对包路径、hash、size、media type
   - 所有节点字段对这些逻辑 asset ID 的映射
4. `migration`
   - package format migration
   - plugin state migration 结果/错误

描述、标签和封面是可编辑 metadata；`graph/assets/plugin state` 是不可变内容 snapshot。用户修改画布后只能“更新流程内容”或“另存为新流程”，不能因为改描述就重拍整个快照。

### 5.2 分组捕获规则

建议使用以下确定规则：

- 组的全部有效成员都在选区内：复制该组，并重映射全部组相关 ID。
- 只选中组的一部分：不复制该组，选中节点的 `groupId` 必须清除；保存面板用一句摘要说明“有 1 个分组未完整选中，将按普通节点保存”。不能留下孤儿 `groupId`。
- 只复制两端都在选区内的普通边。
- `inputLinks/outputLinks` 只有在其外部端点也在选区内时才复制，并连同物化的 `viaGroupId` 边一起重映射；否则删除声明，避免导入后引用源项目节点。
- `collapsed` 状态可以保留，因为它是用户组织意图；导入后首屏仍看到同一张收起组卡。
- `frameBounds` 不作为真相，现有 UI 会按成员真实几何重新派生组框（`src/workbench/generationCanvas/components/generationCanvasGeometry.ts:65-86`）。

### 5.3 资产可移植规则

保存流程时应扫描 host 已知的持久资产字段，至少包括：

- `node.references[]`
- `node.result.url/thumbnailUrl`
- `node.history[].url/thumbnailUrl`
- host 已知的 `meta` 资产字段
- 插件 manifest 显式声明的 plugin-state asset references

任意插件 `state: Record<string, unknown>` 不能靠递归猜 URL。可信插件注册时必须声明 `collectAssetRefs` 与 `rewriteAssetRefs`（或等价 schema 映射），否则它只能保存纯 JSON 状态，不能声称媒体完全可移植。

保存成功后，全局流程包必须拥有自己的素材副本；导入目标项目时必须经受管资产写入落成目标项目资产，再把 graph 中所有逻辑引用重写为目标 `nomi-local://asset/<targetProjectId>/...`。不能把源项目路径、任意绝对路径或 renderer 提交的目的路径直接交给 preload。

### 5.4 单一写入与原子性

建议导入流程分两阶段：

1. 主进程预检 manifest、插件/版本、hash 和包内文件；将资产复制到目标项目的 staging/受管资产路径，返回 host 生成的目标 asset 映射。
2. renderer 使用映射构建完整新 graph，调用一个 `instantiateWorkflowPackage` store action，一次写入 nodes/edges/groups，一次 Undo barrier，一次事件批次，一次 `persistRevision`。

若第一阶段失败，不改画布；若第二阶段前校验失败，清理 staging。不要逐节点调用 `addNode`，否则用户会得到 N 次 Undo、半套流程和中途持久化状态。

这个批量 action 必须加入现有 `documentActions`；Agent、UI和未来 MCP 都只能调用同一语义入口（`src/workbench/generationCanvas/events/canvasWriteBoundary.ts:12-31`）。

### 5.5 缺失插件与插件迁移

当前节点已经有 host-owned `kind`、插件 `typeId/pluginState` 包络（`src/workbench/generationCanvas/model/generationCanvasTypes.ts:127-133`）。工作流包必须原样保留它们；导入前报告缺失/不兼容插件，但不能删除节点。

插件不可用时，仍把原始节点、边和组写入项目，由 renderer 的缺失插件占位节点显示。重新启用插件后，根据保留的 `pluginId/pluginVersion/typeId/schemaVersion/state` 恢复。插件状态迁移必须在注册合同中执行，不在通用流程库里猜字段。

### 5.6 与 Agent/MCP/Skill 的边界

- 流程库拥有：捕获、元数据 CRUD、搜索、预检、复制到画布。
- 画布 store 拥有：节点/边/组的实际写入、Undo/Redo、事件日志和项目保存。
- 插件 registry 拥有：节点 renderer、manifest、状态迁移、插件资产字段声明。
- Agent/MCP/Skill 只拥有“提出使用某个 workflowId”的意图；最终写入必须通过现有提议/批准与统一画布 action。

在 #223 的能力合同稳定前，不新增 Agent 专用 workflow IPC、工具名或旁路 store action。

## 6. 建议实施顺序

### 阶段 A：先修合同，不做新 UI

1. 修正自定义 category 与 `nodeGroupSchema` 的不一致，并加恢复测试。
2. 定义 `CanvasWorkflowPackageV1`、严格 schema、版本迁移器。
3. 抽出纯函数：完整组捕获、ID 映射、部分组选区规则、资产引用清单。
4. 用单测证明 groups/inputLinks/outputLinks/viaGroupId/collapsed 全量 round-trip。

### 阶段 B：全局受管存储

1. 新增窄 `workflowLibrary.list/create/updateMetadata/delete/readPackage/importIntoProject` 桥。
2. 主进程 trusted-sender 校验、路径固定在 settings root、manifest 原子写。
3. 流程包资产按 hash 去重；删除流程时只删该包拥有的引用/文件，不碰项目源文件。
4. 源项目删除后仍可从流程包导入并播放素材。

### 阶段 C：复用真实 UI 入口

1. 删除原型“概览”。
2. 在 `ProjectExplorerSidebar.libraryRailItems` 增加“流程”。
3. 复用左栏 500px 可调宽外壳、DesignSearchInput、空态和卡片 token。
4. 保存入口继续复用现有选区浮条“保存为流程”；保存后打开/定位新条目。
5. 卡片主动作只有“复制到画布”；编辑描述/标签/收藏/删除进入 `...`。

### 阶段 D：统一画布落地与真实任务验收

必须验证：

1. 框选普通节点，保存并在另一个项目复制，位置/边/参数一致。
2. 框选完整展开组，复制后组框、名称、成员和真实边一致。
3. 保存收起组，复制后仍是一张收起卡；展开恢复全部成员和边。
4. 部分选择一个组，不产生孤儿 `groupId`。
5. 组入参/出参两端都在选区时完整复制；外部端点不在选区时不留悬空声明。
6. 源项目删除后，流程包中的图片/视频仍能复制到新项目并播放。
7. 插入整套流程一次 Undo 全撤、一次 Redo 全恢复。
8. 保存、关闭、重开目标项目后节点/边/组/素材仍在。
9. 缺失或不兼容插件显示占位，原始状态、边和组不丢。
10. 非法 manifest、版本过新、hash 不符在改画布前失败。
11. UI 与 Agent 最终走同一个 store action，不存在绕过 proposal/write boundary 的入口。

## 7. 本轮验证结果

实际运行：

```text
pnpm exec vitest run \
  src/workbench/generationCanvas/store/canvasWorkflowStore.test.ts \
  src/workbench/generationCanvas/model/groupInputLinks.test.ts \
  src/workbench/generationCanvas/model/canvasCardStackModel.test.ts \
  src/workbench/generationCanvas/model/generationCanvasSchema.test.ts \
  src/workbench/generationCanvas/events/canvasWriteBoundary.test.ts
```

结果：5 个测试文件通过，57 个测试通过，0 失败。

另做两个只读最小复现：

1. grouped workflow capture/instantiate：模板无 `groups`，新节点保留旧 `groupId`。
2. custom-category group restore：`cat-6` 节点保留，但对应 group 被 normalizer 丢弃。

这些复现没有修改源码或测试文件。

## 8. 已确认与待核实

### 已确认

- 生产代码无“概览”入口；原型“概览”应删。
- Canvas NodeGroup 是持久图语义，不是封面装饰。
- 现有工作流模板项目内可保存、插入、Undo/Redo、快照恢复。
- 现有模板不含 groups，无法原样复制画布分组。
- 现有模板不拥有媒体文件，不满足源项目独立的跨项目复用。
- 自定义 category group 在 restore schema 中存在丢组问题。
- 现有左侧栏是工作流库最符合真实产品结构的入口。

### 待核实（进入实施前）

- #223 最终能力合同与可调用 action 名称；本研究不猜接口。
- 现有资产写入 API 是否应扩展一个“从受管 workflow bundle 复制到目标项目”的专用窄操作，还是复用内部 `writeAsset` 服务并只新增 IPC 编排。
- 插件 registry 最终采用何种 asset-ref 声明接口；第一阶段内置插件可以先落实接口，但不能给任意第三方脚本开放。
- Electron 真机下大视频流程包的复制耗时、磁盘占用和取消/失败清理，需要独立基线；这是真正触及性能路径的部分。

## 9. 最终建议

这项功能不应继续被描述为“插件库里多一张工作流卡”。真实实现是：

> 用户框选当前分类画布里已经调好的节点与分组，Nomi 把完整图结构、可信插件状态和所需本地素材封成一个用户级流程包；用户在任意项目的左侧流程库中找到它，一次复制到当前画布，仍由原有 store 完成一次可撤销、可持久化的写入。

“概览”没有任务价值，删除即可；“分组”则是必须进入 V1 合同的核心结构，不能再当作后续补充。
