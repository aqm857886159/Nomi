# shot_table 契约与注册

> 🚧 状态：已实施，最终验证与 PR 交付进行中（2026-09-10）。
> 状态：已实现，待总任务验收 · 2026-09-10
> 范围：09-08 已拍板 B 组第一项的共享契约、节点注册与快照校验。

## 先查别人

- React Flow utility classes：既定方案 [2026-09-07 §2.1](2026-09-07-storyboard-table-node.md) 实核 `nodrag` / `nowheel`；本层只注册节点，不新增交互内核。
- Krita 稳定 columnId：既定方案 [2026-09-07 §2.2](2026-09-07-storyboard-table-node.md) 的源码对账；事实单元格以 columnId 稀疏存储，禁止数组位置映射。
- Storyboarder 稳定 rowId：既定方案 [2026-09-07 §2.3](2026-09-07-storyboard-table-node.md) 的源码对账；行身份与排序分离。
- 仓内 owner：[shot-table-is-a-projection-of-canvas-nodes](../lessons/shot-table-is-a-projection-of-canvas-nodes.md)，生产表只存来源与视图，rows 在类型和解析边界都拒绝。

## 实施与验收

共享 Zod schema 声明两个来源；生产禁止 rows，事实允许自持。注册默认 960×420，宽 560–1400、高 160–900。恢复快照校验新 kind 的元数据，未知版本不静默丢失。单测覆盖生产零复制、序列化往返、损坏/未来版本拒绝、尺寸镜像。事实桥扩入本子任务：复用现有视频引擎与项目帧资产，真实阶段 IPC 反馈、旧缓存一次性可撤销迁移；删除右槽五旧组件及互斥 store。React 表格与生产投影由总任务分配。

验证：共享契约/快照/镜像与引擎、事实桥首轮合计 30 条通过；随后单镜限定重拆、稳定事实采纳、批次编组与单步撤销 3 条新增测试通过。新增与受影响文件 ESLint 通过。完整 typecheck 交总任务收尾复核。

生成选中使用现有 runStoryboardBatch/confirmAndRunPlan；仅新增可选 landing 配置，经已有 applyCanvasToolCall gesture 参数串联同步写入。事实采用时以源节点与稳定 rowId 编成生产 shotId，重复采用复用原 design 并保留用户对生产行的改动。单镜重拆通过引擎 shotIndexes 仅分析目标镜头，保留已测时间和原关键帧证据。旧右栏走查包含“抢占右槽”的旧规格断言，不能改断言伪装新表验收，由总任务以新表真实旅程验收。

## 回滚

撤销本次 scoped diff；含 shot_table 的项目须保留原始快照，不能把未知节点降级为媒体节点。
