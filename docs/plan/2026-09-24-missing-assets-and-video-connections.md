# 2026-09-24 项目缺素材与视频连线修复

## 用户摩擦

- 项目库检测到可恢复的缺失素材时，入口被同步告警状态拦住，用户无法进入项目处理现有内容。
- 画布视频节点从源把手拖到空白处时，连接结束逻辑只允许文本、图片和图片类节点创建下一个媒体节点，视频源被静默取消；这同时影响普通视频卡和多结果视频卡。

## 范围

- 允许 `missing-assets` 项目继续进入工作台，保留角标和浮层告警；仍阻止外部变更、冲突和损坏清单。
- 把“可从源创建媒体连线”的能力集中到一个模型层判断，纳入视频类节点，并让连线创建菜单复用同一组目标类型。
- 增加纯单元回归测试与结构合同。

## 先查别人

完整检索报告见 [`docs/research/2026-09-24-missing-assets-video-connections/prior-art.md`](../research/2026-09-24-missing-assets-video-connections/prior-art.md)。

- 依赖/仓库：`src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowMenus.ts:120` 已有 pane drop 宿主；`src/workbench/generationCanvas/reactFlow/generationCanvasReactFlowVisualContract.test.ts:80` 已覆盖全部节点类型。
- 生态：React Flow 官方 [Add Node On Edge Drop](https://reactflow.dev/examples/nodes/add-node-on-edge-drop) 要求用 `onConnectStart` / `onConnectEnd` 在 pane drop 创建节点；官方 [Handle API](https://reactflow.dev/api-reference/components/handle) 提供 `isConnectableStart` / `isConnectableEnd`。
- 结论：`docs/research/2026-09-24-missing-assets-video-connections/prior-art.md:48` 记录了复用 React Flow 生命周期与现有同步状态的判断；只在 Nomi 模型层新增一个共享媒体来源策略，避免普通卡、多结果卡和菜单目标各自判断。TikHub 本轮未使用，原因见报告。

## 不动项

- 不改变缺失素材扫描、同步、采用基线或素材恢复行为。
- 不改变现有 React Flow 把手的选中态视觉契约，不凭视频反馈另造一套把手。
- 不改变已有节点之间的有效连线和分组连线路径。

## 回滚

回滚本分支提交即可恢复原来的入口阻断和视频来源判定；无数据迁移。

## 验收

1. `missing-assets` 项目可进入工作台，其他不可读同步状态仍打开详情浮层。
2. 文本、图片、图片类、视频、视频类源节点拖到空白处都出现创建菜单；无媒体来源仍取消连接。
3. 多结果与普通视频节点共享同一判断；现有把手视觉合同测试保持通过。
4. 运行相关 Vitest、typecheck/build、根因合同检查，并做一次真实画布拖线走查。
