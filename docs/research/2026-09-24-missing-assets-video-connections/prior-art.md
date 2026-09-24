# 先查别人：项目可恢复入口与画布空白处建连（2026-09-24）

> 对应方案：[`docs/plan/2026-09-24-missing-assets-and-video-connections.md`](../../../plan/2026-09-24-missing-assets-and-video-connections.md)
> 目的：确认这次修复应复用的边界，以及 React Flow 对“从把手拖到空白处创建节点”的既有契约。

## 依赖里已有？

- `@xyflow/react` 已提供 `onConnectStart` / `onConnectEnd` 的连接生命周期。仓库当前的 `useGenerationCanvasReactFlowMenus.ts` 已经使用这条生命周期，只缺少把视频源纳入共享的媒体资格判断；不新增连接库。
- React Flow 的 `<Handle />` API 已提供 `isConnectable`、`isConnectableStart`、`isConnectableEnd` 和 `isValidConnection`，说明“能否从把手开始/结束”应由 React Flow 把手与连接回调共同裁决，而不是另造鼠标拖拽系统（官方 API：[Handle](https://reactflow.dev/api-reference/components/handle)）。
- 项目同步状态与入口已在仓库中存在：`src/workbench/library/ProjectLibraryPage.tsx` 读取 `syncInspectionByProject`，`src/workbench/NomiStudioApp.tsx` 负责同步检查。缺口是入口把所有非 `ready` 状态都当成不可读，没有新增同步实现。

## 仓库里已有？

- 空白处建连的菜单已有宿主：`src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowMenus.ts::handleConnectEnd` 负责判断 pane drop 并打开创建菜单；`GenerationCanvasReactFlowOverlays.tsx` 已声明图片与视频菜单项。本轮把“源节点能否创建媒体”与菜单目标列表抽到 `model/connectionCreationPolicy.ts`，避免普通卡、多结果卡再各写一份。
- 把手显示与选中态已有单一视觉合同：`src/workbench/generationCanvas/reactFlow/generationCanvasReactFlowVisualContract.test.ts` 遍历 `GENERATION_NODE_KINDS`，验证单选磁吸加号、多选/未选圆点。本轮不改这份视觉规则，只修视频源在 `onConnectEnd` 被提前取消的问题。
- 缺失素材浮层已有恢复动作与告警：`ProjectSyncBadge` 和 `ProjectLibraryPage` 仍显示缺失素材提示；本轮只放开可读取的 `missing-assets` 入口，外部变更、冲突、损坏清单继续阻断。

## 生态里已有？

- React Flow 官方“Add Node On Edge Drop”示例明确建议用 `onConnectStart` 记录源节点、用 `onConnectEnd` 判断是否落在 pane，再创建新节点：[Add Node On Edge Drop](https://reactflow.dev/examples/nodes/add-node-on-edge-drop)。本轮沿用这个边界，没有在节点卡片上另造 pointer 事件链。
- 官方“Connection Events”说明 `onConnectEnd` 在连接成功与否都会触发，因此源资格必须在共享回调中明确判断：[Connection Events](https://reactflow.dev/examples/interaction/connection-events)。这支持把视频纳入同一个 `canCreateConnectedMedia` 判断，而不是依赖某一种卡片外观。
- 官方 React Flow API 仍将 `connectionDragThreshold`、`connectOnClick`、`connectionMode` 作为内核能力；本轮没有改这些全局参数（[ReactFlow API](https://reactflow.dev/api-reference/react-flow)）。

## TikHub 自媒体怎么说？

本轮没有使用 TikHub：这是 React Flow 内核连接生命周期与本仓项目同步状态边界的工程修复，TikHub 的自媒体内容不能提供可验证的 API 或数据一致性契约。生态证据采用上游 React Flow 官方文档，并在真实 Electron 走查中验证用户动作。

## 结论：用已有 / 自研

| 面 | 结论 | 理由 |
|---|---|---|
| 连接生命周期 | 用已有 | React Flow 已提供 `onConnectStart` / `onConnectEnd`；只修共享资格判断。 |
| 节点目标类型 | 自研一个模型层策略 | React Flow 不知道 Nomi 的普通卡、多结果卡和媒体类型；策略读取既有节点类型注册表，避免调用方分叉。 |
| 把手视觉 | 用已有 | 现有视觉合同覆盖所有节点类型；本轮不另造视频把手。 |
| 缺失素材入口 | 用已有同步状态 | 只调整入口可读性策略，保留同步扫描、告警和不可读状态阻断。 |

## 诚实记分

- 真查并使用：仓库入口/把手/连接回调、React Flow 官方 API 与空白建节点示例。
- 未使用：TikHub 自媒体内容；没有把自媒体观点冒充 API 契约。
