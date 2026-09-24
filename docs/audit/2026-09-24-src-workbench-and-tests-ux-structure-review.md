# `src/workbench` 与 `tests/ux` 结构评审（2026-09-24）

> 状态：✅ 结构评审已交付
> 触发：`check:symptom-cluster` 发现 2026-09-18 至 2026-09-24 的 `src/workbench` 合同集中，以及 2026-09-21 至 2026-09-24 的 `tests/ux` 合同集中。

## 触发证据

本窗口的合同数量已经超过“同层第三份合同”的阈值。它们不能简单视为同一个 bug：`src/workbench` 同时承载项目入口、画布节点、连接手势与素材状态；`tests/ux` 同时承载真实 Electron 走查、夹具预算和 CI 编排。结构审计的目的，是确认本次修复是否又增加了第二个 owner。

## 本轮涉及的合同

- `docs/fixes/2026-09-24-project-missing-assets-open.root-cause.json`
- `docs/fixes/2026-09-24-video-connection-source.root-cause.json`

近邻历史合同包括 `src/workbench` 的拖拽租约、连接把手、节点几何与项目状态修复，以及 `tests/ux` 的画布拖拽与核心走查合同。它们共同暴露“用户可见画布入口必须经过共享边界”的压力，但没有证据表明应再建一套画布内核或第二套同步状态。

## 结构判断

### 1. `src/workbench` 的 owner 边界

- 项目是否能进入工作台由 `src/workbench/library/projectSyncOpenPolicy.ts::canOpenProjectWithSyncStatus` 唯一裁决；页面只消费它，`NomiStudioApp` 继续负责同步检查与状态产生。
- 画布“从源拖到空白处能否创建媒体”由 `src/workbench/generationCanvas/model/connectionCreationPolicy.ts::canCreateConnectedMedia` 唯一裁决；React Flow hook 只消费源资格，overlay 只消费同一目标类型常量。
- 普通节点、多结果节点和视频节点都通过既有 `generationNodeKinds` 注册表进入策略。没有按卡片外观新增条件，也没有把视频特例写回组件层。

### 2. `tests/ux` 的证据边界

- `tests/ux/canvas-s5-walkthrough.walk.mjs` 保留真实 Electron 连接走查，新增的是视频源拖到空白 pane 的菜单断言；它不复制生产策略。
- `tests/ux/canvas-handles-alt-drag.walk.mjs` 继续验证把手视觉与 Alt 拖动，不把“菜单能打开”冒充“把手视觉正确”。
- 核心 smoke 的 empty/used fixture 仍由既有 `test:core-smoke` owner 运行；本轮没有新建第三个走查入口。

## 复发防线

1. 纯策略测试钉住 `missing-assets` 可进入、冲突/损坏阻断，以及 video/image/keyframe 的连接资格。
2. 视觉合同继续遍历完整节点类型注册表，防止视频或多结果卡失去磁吸加号/圆点契约。
3. 真实 S5 走查拖动视频源到空白处并验证菜单目标；真实 handles 走查验证所有类型的把手反馈。
4. 两份 schema-v3 合同保留 `door-map` 生成的入口，新增调用方必须经过共享 owner。

## 结论与后续

本轮没有发现第二个项目同步 owner、第二个连接资格 owner 或第二套真实走查编排。修复落在最早共享边界，结构上不需要扩大重构。若下一窗口仍在 `src/workbench` 出现第三类入口合同，应先扩展 owner 层不变量与结构评审，再改宿主组件；`tests/ux` 新增场景必须并入现有 journey owner，不得按单一反馈另起走查脚本。
