# 画布三个顺手功能

状态：已实现，本地验收通过，待 PR 评审。范围：多选连线、Alt 拖复制、添加菜单偏好；一个 PR。不改 agentLane、AI lane，不引入依赖。

## 用户任务与边界

- 选中多个参考节点拉到一个目标，或一个来源拉到多个选中目标：按现役槽位判定逐条建边，显示 ×N，跳过计数复用编组提示。一手势一个 barrier，连线后的自动模式切换跟随撤销。
- Alt 起拖：复用现役剪贴板克隆与粘贴写口，React Flow 仍计算位移，adapter 将位置变更映射到副本，不另写指针内核。副本沿用粘贴的组归属规则，复制和位移一个撤销。
- 添加菜单：默认表保持不变；隐藏和顺序经 settingsBridge 的 schemaVersion 1 契约落盘。右键菜单项提供隐藏、上移；同菜单恢复默认，不增加面板。排序保留命名分组。

## 先查别人

- 官方 React Flow API：https://reactflow.dev/api-reference/react-flow ，现役 @xyflow/react 12.11.5 的 onNodeDragStart / onNodesChange，未提供 alt-drag-duplicate 属性。已通过 Context7 HTTP API `/api/v2/context` 查询 `/xyflow/xyflow` 的拖拽/复制与交集 API；其来源 https://github.com/xyflow/xyflow/blob/main/_autodocs/examples-and-patterns.md 将复制作为应用动作，https://github.com/xyflow/xyflow/blob/main/_autodocs/types.md 定义 OnNodeDrag。并核对已安装 XYDrag 源码：dragItems 在 onNodeDragStart 前捕获，因此 adapter 映射副本 ID，保留官方位移计算。
- 现役参考：src/workbench/generationCanvas/store/canvasConnectionMaterialization.ts:26 的 materializeGroupLink / materializeGroupOutputLink（从 canvasGraphActions.ts 原实现提取）；components/useCanvasGroupActions.ts 的计数反馈；generationCanvasStore.ts 的 pasteNodes；electron/shared/contracts/vendorPreference.ts 的设置规范。
- src/workbench/generationCanvas/components/CanvasToolbar.tsx:93：真实菜单已用 design-lab:walk:canvas-add-menu 跑完 3 态并读图。§1.5：个性化属于 L4，菜单项右键就近操作；恢复默认同家。常驻位不增加。

## 验收与回滚

每项 store 回归测试，验证反向连线、容量、重复与单次撤销；真实画布走查三个用户任务和截图。gates、focused unit、画布风险验证通过后 hooks review、提交、推送、PR，不合并。回滚整条任务提交即可；缺失偏好使用默认表。

## 对账与评审

- 产品 / 真实用户：三个动作都直接作用于画布；隐藏可恢复，单次撤销回到手势前。
- 设计：沿用真实菜单命名分段；个性化用菜单项右键，L4 不占常驻位；×N 在线上。
- 前端 / 架构：只用 React Flow onNodeDragStart、onNodesChange、connectionLineComponent 扩展点，未增加指针内核。Alt 位移映射在 reactFlow/ 内。
- 后端：settingsBridge → trusted sender → normalize → atomic JSON；schemaVersion 1，未引入依赖。
- 验证：旧实现下三项 store 回归均红；禁用共享容量校验时跨字段预算测试红（12 条被错误接受），恢复后绿。真实 Electron 的菜单、Alt、×2 连线及撤销均通过。已有画布关键四场景通过。

已逐张看过以下真实截图：

![菜单隐藏与排序](canvas-three-gestures-evidence/01-menu-customization.png)
![Alt 拖复制](canvas-three-gestures-evidence/02-alt-drag-copy.png)
![多选拉线 ×2](canvas-three-gestures-evidence/03-multi-connect-preview.png)

## 最终验证记录

- `pnpm run gates`：全部 74 contracts 通过；1,289 个测试文件通过，11,981 条通过、2 条跳过；构建通过。词表、i18n、heavy-path 棘轮未增长。
- focused：8 个文件 / 108 条，加 related 264 个文件 / 3,055 条通过；新增相关单测 16/16。
- 真实 Electron：菜单隐藏/排序/持久化/恢复、Alt 复制/位移/撤销、多→一和一→多正文落点/×2/撤销通过；既有画布 critical 4/4。
- 性能初跑被同期构建替换静态文件中断（pan-zoom-mix 读取已删除的旧哈希模块）；冻结构建后重测，预算不修改。
- 冻结产物性能重测：`pnpm run test:canvas:performance` PASS (1/1)，M / 96 节点 / 192 边，17 场景，各 1 warmup + 1 sample，无预算/可靠性失败。
