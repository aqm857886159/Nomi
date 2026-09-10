# src/devlab 同日三份合同的结构评审

状态：已评审。范围为 skill-ui-b 整合最新 main 后触发的 src/devlab 聚类，不修改实验室基线或生产交互。

## 结论与证据

三份合同都触及实验室，但不变量分别归属于菜单坐标、通知策略、分镜字段所有权。src/devlab 是这些生产组件的共同观察面，不应在这里新增一个统一业务控制器。

| 合同 | 实际所有者 | 实验室职责 | 结构裁决 |
|---|---|---|---|
| menu-viewport-anchor | src/design/menu.tsx:296 的 viewport Portal | src/devlab/designLab/editing/states/03-context-menu.tsx 展示真实菜单坐标 | 坐标防线留在共享菜单；测试额外 transformed ancestry |
| notification-policy | src/ui/notificationPolicy.ts 的 notify 与 src/ui/toast.tsx 的队列 | editing/videoDepth 状态注入反馈情境 | 实验室不复制通知队列；宿主提供 identity/context |
| storyboard-anchor-policy | src/config/modelArchetypes/anchorPolicy.ts 与 shotRowModel.ts | src/devlab/designLab/storyboard/storyboardFixtures.ts:90 提供真实 referenceBindings | 图像消费规则从生产槽契约派生；夹具只提供输入 |

复核三份 schema-v3 的 shared_boundaries 与 invariant_owner_layer：分别为 src/design、src/ui、src/workbench/generationCanvas/model，均有生产边界测试；没有把业务不变量交给 src/devlab 管理。聚类来自 scope_paths 的共同展示目录，仍按门岗要求完成结构复核，不删除合同路径或提高阈值。

## 防止再次只修样张

本次 library-category-collapse 使用生产 V4 popover 的12项夹具，并用真实 Electron 的25项内置表情验证；封面墙逐条打开真实包媒体。实验室基线未更新。保留现有单菜单内核、单通知策略、单字段归属层；本次无需新增生产抽象。

验收：完整 gates 中设计实验室视觉检查通过；skill-library-cards 的真实菜单变换祖先走查通过。后续若同一个生产所有者再次出现聚类，应在该层做结构评审，而不能用本报告作为永久豁免。
