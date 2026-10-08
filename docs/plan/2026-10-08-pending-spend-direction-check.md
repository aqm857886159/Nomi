---
type: direction-check
units: [production-pending-spend]
decision: approved
approved_on: 2026-10-07
approved_in: 协调会话转达用户「按推荐」
---

# 待支付确认卡的类根因方向检查

## 0. 一句话根因

待支付确认卡把持久的 presentation、当前策略和内存中的策略判定拼成了一个可变投影，切换策略后旧卡被重新解释，投影异常又被压成“没有卡”。

## 1. 归类表：bug → 直接原因 → 类根因

| 提交 / bug | 直接原因 | 类根因 |
|---|---|---|
| agent 面板切换策略后卡片消失 | `spendAnsweredByPolicy` 以当前策略重新解释旧 presentation；投影失败被 resident 映射为 unreadable，renderer 再映射为空 | presentation 没有绑定持久的策略快照、epoch 和版本条件，读写边界没有共享不变量 |

## 2. 为什么这一类会一直出现？

事实分散在 `generationPlan.presentations`、pending-spend projection、live approval policy、`policySpendDecision` 和 resident/renderer 五处。现有 `planVersion`、`candidateRevision`、`quoteId` 只能绑定计划与报价，不能绑定“这张卡对应哪个策略 epoch”。因此切换策略、重启或并发动作都会让同一张卡读到另一套事实。

| 铁律 | 类根因要回答的问题 | 最小证据 |
|---|---|---|
| ① 说的=摆的 | 样张要求“同一张卡保持可见并可继续操作”；旧实现把已显示卡重新按新策略隐藏 | 两条真实 walk 的基线红灯与 `policySpendDecision.ts` 的 in-memory map |
| ② 能选到 | 策略切换入口、MCP transport、Electron transport 是否都落到同一 Run command/reducer？ | `generationTransportAdapters.ts`、`mcpStdioServer.ts`、`productionGenerationOperationStore.ts` 的入口扫描 |
| ③ 点了=以为的 | 用户 approve/reject/reprice 后，展示卡、动作和持久 Run 是否仍是同一 presentation？ | `appIntegrationSpendConfirm.ts`、`productionPendingSpend.ts`、`residentSurfaceLifecycle.ts` 的动作/投影路径 |

## 3. 不改结构会冒出什么？

| 预测 | 验证 |
|---|---|
| 策略切换后旧卡继续消失或被新策略误自动通过 | agent-panel missing-card walk：切换 safe-auto/full-auto/step-auto 后检查同一 presentationId/quoteId 与可见卡 |
| 重启后卡片出现但 approve/reject 操作打到另一张卡 | production run 单测：序列化、重读、条件写入 expected epoch/version |
| projection 异常继续把面板画成空白 | resident/renderer 单测：错误卡保留同一 presentation identity，不返回 undefined |

## 4. 影子独立性检查

- 单测与真实 walk 分属不同执行面；walk 只验用户可见闭环，单测验 Run projection/conditional write。
- 真实 walk 的既有失败是本次问题的输入证据，修复后必须重新运行；不会用 renderer 单测代替真实任务闭环。
- 如果 walk 自身 selector 失效，保留为独立的 walk 维护项，不能把 selector 绿灯当成数据不变量成立。

## 5. P0：这些是我们独有的吗？

“哪张待支付卡对应哪一次生成 presentation、哪个策略 epoch、哪个报价”是 Nomi 的按镜头花钱语义，属于 `self-written.json` 的领域边界。通用状态机、事件总线或 XState 不能替代 durable Run 作为事实源；本次只补领域约束，不引入通用状态机。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 引入通用状态机承载卡片生命周期 | 迁移大，仍需把 Run 同步回去 | 双事实源、重启语义不一致 |  |
| 补 | 在旧 `policySpendDecision` 上继续加分支 | 短期改动小 | 旧卡仍会被当前策略重新解释 |  |
| 重写（限一个模块） | 把 presentation identity、policy snapshot、epoch 写进 Run，所有动作做 expected epoch/version 条件写 | 需要改 projection、动作和两个 transport 适配层 | 旧数据需 defaults 迁移 | ✅ |
| 删 | 删除待支付卡 | 改动最小 | 丢失用户对花费的控制 |  |

推荐“重写”这一条边界：删除旧卡的 in-memory policy reinterpretation，换成 durable epoch + conditional writes；不引入 XState。

## 7. 用户要权衡的核心

我们用一次持久化身份换取“策略切换、重启和并发动作都不会让用户丢卡”，代价是旧 Run 需要补默认字段且陈旧动作会失败关闭。

## 特征测试清单（动结构前先锁住）

- `electron/productionRun/productionPendingSpend.test.ts`
- `electron/shared/productionGenerationPresentation.test.ts`
- `electron/capabilityCore/appIntegrationSpendConfirmInstall.test.ts`
- `electron/capabilityCore/agentPanelSpendConfirm.e2e.test.ts`
- `electron/productionRun/productionActionIpcPendingSpend.test.ts`
- `tests/ux/agent-panel-missing-card.walk.mjs`
- `tests/ux/agent-spend-card.walk.mjs`
