# Lane G5 收据撤销接线补记（2026-09-08）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 先查别人

本节补记实施前已读的内部 owner 与母方案参考，行号按当前工作树复核；不把补记时间冒充检索发生时间。本次恢复已批准的 G5 撤销入口，没有新增通用能力、框架层或持久化格式。

| 四问 | 证据与适用结论 |
|---|---|
| 依赖里已有？ | pi 已提供 `appendCustomEntry` 和 `watch`，分别见锁定依赖 `node_modules/@earendil-works/pi-agent-core/dist/harness/agent-harness.d.ts:642`、`:674`；领域收据关联继续骑在同一转录，主进程读取 owner 是 `electron/agentLane/laneReceiptAuthority.mts:6`。不另建授权缓存或会话存储。 |
| 仓库里已有？ | 有。`src/workbench/generationCanvas/agent/proposalUndo.ts:145` 已做精确 binding 水合，`:462` 的 `runProposalUndo` 已有补偿与持久化 CAS；`src/workbench/ai/v4/AgentPanelV4Receipt.tsx:20`、`:124` 是原收据与折叠组。此次只把原按钮和这笔真实记录重新接通。 |
| 生态里已有？ | 沿用[阶段 4 母方案“先查别人”](./2026-09-08-agent-lane-stage4-switch.md#先查别人)已记录的[官方 pi harness 源码](https://github.com/earendil-works/pi/tree/main/packages/agent-core/src/harness)与锁定版本 API 裁决。本补线未新增生态检索，也未引入外部撤销系统；Nomi 的画布补偿事务已有唯一领域 owner。 |
| TikHub 自媒体里怎么说？ | 本补线未查询，不声称覆盖。问题是已批准组件与内部 G5 关联断开，社媒经验不能裁决 CAS、项目 binding 或具体补偿操作；产品形态依据 `docs/plan/2026-09-06-agent-panel-v4-wiring.md:111` 的 `undoable → useCommittedProposal + runProposalUndo` 原映射和实际原组件，不新增设计。 |

**结论：用已有。** 只派生精确 `toolCallId` 给原收据按钮，点击重读现有 owner 并走原 CAS；不把显示数据当授权。适用边界是 Nomi 内部恢复接线，生态和 TikHub 未作新增查询有上述具体理由；本节仍完整回答四问并给出处，不申请门岗格式豁免。

## 证据与范围

真实零额度 editing 走查已持久写入两节点一边且 G5 committed，截图 `.tmp/pi-editing-development-1788847579895/04-canvas-committed.png` 中原收据行没有撤销。`/tmp/nomi-stage4-editing-display.log` 在原按钮探针报红。获批形态为 v4 一行收据的行尾撤销，不新增控件形态。

先查现有实现：`proposalUndo.ts` 的 prepare/commit/hydrate/runProposalUndo 已拥有持久化收据和补偿 CAS；`laneReceiptAuthority.mts` 已解析唯一四字段关联；原 `agentPanelV4Projection` 曾通过精确 approval 关联决定 undoable。新 `laneViewModel` 未承接此关联，V4ToolGroup 也没有下传按钮。属于 recurring 的领域事实到 UI 引用遗漏。

## 实施

共享原 receipt note 常量及解析器；不改变原格式或审批规则。Data 订阅既有 committed proposal owner，按当前 lane note 的三字段与记录匹配出 toolCallId；只为对应成功工具行派生撤销。点击按当前 lane 和现有 owner 重查，再走原 runProposalUndo 的主进程 CAS。无 UI 授权缓存。折叠组复用原按钮。冷启动继续使用 NomiStudioApp 既有 hydrate 和 recovery。

## 验收与回滚

已有投影和实际 V4FlowRow 单测修前红（2 failed /75 passed），补跨 lane、拒绝、失败、陈旧/重复关联、点击重查与冷重启 owner 水合覆盖。定向单测、类型、lint；runner 独立真实 Electron 点撤销并检查两节点一边回退、G5 undone。62 基线不改。不调用模型。撤销本补记对应改动即可回到切换前缺入口状态，不触及项目数据。
