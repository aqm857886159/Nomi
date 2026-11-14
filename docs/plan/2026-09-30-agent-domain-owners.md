# Agent 领域三件事各回到自己的主人那一层（附件 / 默认模型 / 分镜表自开）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实现（PR #937）。来源：铁律走查的三条规则 `attachment-gone-after-send`、`agent-ignores-declared-default`、`surface-creationSelection`；Agent 消息层对照报告 §5 判定这三条换框架消不掉（[`docs/research/2026-09-29-agent-message-layer-conformance/report.md`](../research/2026-09-29-agent-message-layer-conformance/report.md)）。

## 改动说明

| | 内容 |
|---|---|
| 新增 | 用户消息上的附件签在发出后与重开项目后都在（`projectLaneSnapshot` 带上消息自己的附件 claim，主进程现查文件名）；Agent 被告知用户的「图片默认 / 视频默认」，偏离时收到事实并要说清；Agent 新建分镜后回话告诉用户去哪点开；用户点「拆成镜头」发起的方案照常打开 |
| 改变 | Agent 自己决定新建的分镜方案不再替用户打开（含 `propose_storyboard_plan` 之后不再强制切回创作页）；用户亲手点「拆成镜头」发起的方案仍然打开 |
| 去掉 | 无 |

## 三个概念的唯一主人

| 概念 | 主人 | 登记 |
|---|---|---|
| 一条用户消息在对话记录里的形状（含附件） | `electron/shared/agentLane/laneProjection.ts` `projectLaneSnapshot` | `agent-lane.user-message-shape` |
| 用户按任务声明的默认模型 | `electron/capabilityCore/generationDefaultModelResolver.ts` `createGenerationDefaultModelResolver` | `generation.declared-default-model`（渲染层两处匹配登记为 pending 迁移） |
| 新建的分镜方案要不要替用户打开（谁发起的） | `src/workbench/workbenchDocumentSlice.ts` `activationAfterCreate` | `workbench.storyboard-activation` |

「谁发起的」是显式输入：`addStoryboardDesign` / `setStoryboardPlan` 的新建分支必填；Agent 工具落地时由用户那句话的目标（`storyboardTarget.openResult`，只有「拆成镜头」按钮会带）决定，工具内部不猜。

## 先查别人

- 消息模型（附件是消息的一部分、按 part 投影）：Vercel AI SDK 的 `UIMessage.parts` 把附件放进消息本身，而不是另存——对照报告 R1/R6 行已逐层核对 [Agent 消息层对照报告 §2](../research/2026-09-29-agent-message-layer-conformance/report.md)；官方文档 https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence 。结论：照做（claim 随消息落盘，投影时按消息自己的 claim 取），不引入 `useChat`。
- 「谁发起」决定 UI 是否被程序改变：我们自己的「程序不挪画布」同一条（`src/workbench/generationCanvas/store/canvasVisibleArea.ts:77` 的 `visibleInsertionPoint` 与 #889 的做法）；结论：沿用同一条纪律，用显式输入而不是调用方记得。
- 默认值由谁解释：用户设置只存 (vendor, model)，「此刻能不能用」只有目录 + 可用性闸答得出——`electron/capabilityCore/generationDefaultModelResolver.ts:43`；同仓另有渲染层两处按同一设置匹配（`src/workbench/generationCanvas/nodes/defaultNodeModelSelection.ts:55`、`src/workbench/generationCanvas/agent/availableModels.ts:140`），这次不并，登记为 pending 迁移。
- 生态里类似问题：Cherry Studio 把主进程的流经 IPC 投给渲染层、渲染层不另存一份（对照报告 §3.2 表）https://github.com/CherryHQ/cherry-studio/pull/18743 ；结论：我们已经是这个形状（主进程投影、渲染层只读），不需要新机制。

## 测试表

见 PR #937 正文与本地验收页；走查脚本 `tests/ux/agent-domain-owners.walk.mjs`（行 1–11，新装机 / 用过的项目 × 中 / 英）、`tests/ux/agent-default-model-real.paid.mjs`（真模型数字）。

## 回滚

三件事互相独立，可分别回退：附件（`laneProjection` + `laneViewModel` 两处 + `laneDesktopAttachments.ts`）、默认模型（`laneModelContext` + `semanticGenerationCandidate.declaredDefaultDeviations`）、分镜打开（`workbenchDocumentSlice` 的 `StoryboardInitiator`）。
