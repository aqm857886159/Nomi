# 方向检查：全自动决门失败后的待决卡

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 0. 一句话根因

付费卡的唯一读口把“项目档决门正在进行”和“项目档决门已失败”都表示成 `draft + project`，所以失败没有持久状态，卡被永久隐藏。

## 1. 归类表：bug → 直接原因 → 类根因

| 提交 / bug | 直接原因 | 类根因 |
|---|---|---|
| PR #1093 `agent-spend-full-auto` | `awaitingSpendDecision` 对项目档草稿无条件返回空 | presentation owner 没有表达决门生命周期，异步失败没有回写同一 Run |

## 2. 为什么这类会反复出现？

卡、adapter 和走查各自知道“正在决门”的瞬间，却没有一个 durable owner 保存失败事实；因此任何新的读取者、重载或宿主异常都会把失败误判成“仍在进行”。本次把生命周期状态放进 `GenerationPresentation`，由 adapter 失败路径通过 Run command 写回，读口只隐藏明确的 `pending`，失败复查点是同一个 presentation。

| 铁律 | 类根因要回答的问题？ | 最小证据 |
|---|---|---|
| ① 说的=摆的 | 决门失败后卡是否仍代表同一 presentation、epoch 和报价？ | `productionPendingSpend.test.ts` 保留同一 `presentationId`/epoch 并恢复投影；真实 walk 第 4 步可见 |
| ② 能选到 | 失败状态是否沿所有 Run command / reducer 入口持久化？ | `generation.policy_decision_failed` 经过 `productionRunReducer` 写入 Run；walk 产出的 `run.json` 有 `policyDecisionState: "failed"` |
| ③ 点了=以为的 | 走查点击失败后是否观察到“卡还在”，而非只看返回码？ | `tests/ux/agent-spend-full-auto.walk.mjs` 的 `toBeVisible` 断言 |

## 3. 不改结构会冒出什么

| 预咀 | 怎么验证 |
|---|---|
| 任何决门异常都会继续吞掉待决卡 | 让 `requestGenerationGate` 抛错后冷读 Run，断言 pending spend 仍有同一 presentation |
| 重启/重载把失败重新当成进行中 | 读取持久化 `run.json`，断言 `policyDecisionState` 保留为 `failed` |
| 新的 adapter 调用者绕过失败回写 | adapter 回归测试要求失败 marker callback 被调用，门禁 scope 覆盖 adapter 与 Run owner |

## 4. 验收独立性

- 生产回归由 `electron/productionRun/productionPendingSpend.test.ts` 和 `electron/capabilityCore/agentPanelSpendConfirm.e2e.test.ts` 覆盖；真实 walkthrough `agent-spend-full-auto` 是独立验收线。
- 走查断言不被放宽；它仍要求卡可见。未改动 main 上的尺寸/清晰度 chip 与 stop-midway 走查。

## 5. P0：领域独有部分与现成方案

付费卡的 presentation、epoch、Run journal 和“决门失败仍待决”语义是 Nomi 领域约束；通用的 Playwright/Vitest 只负责验证。无需引入第二套状态库或 renderer fallback。

## 6. 方案比较与推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 只在 renderer 根据错误重显卡 | 无 durable 状态，重载丢失 | 重新出现静默吞卡 |  |
| 补丁 | 在走查失败时强制刷新 | 测试专用，产品仍错误 | CI 绿但用户仍丢卡 |  |
| 重写（限一个模块） | 新建第二套 pending store | 迁移/双 owner 成本 | 状态分叉、重复扣费 |  |
| **共享 Run owner 状态** | presentation 写 `pending/failed`，失败 command 回写同一 Run | 增加一个领域字段和 command | 需保持旧 Run 兼容 | **✓** |

## 7. 用户要权衡的核心

宁可在决门失败后让用户重新确认同一笔报价，也不能为了界面暂时安静而丢掉付费决定。

## 特征测试清单

- `electron/productionRun/productionPendingSpend.test.ts`
- `electron/capabilityCore/agentPanelSpendConfirm.e2e.test.ts`
- `tests/ux/agent-spend-full-auto.walk.mjs`
- `electron/productionRun/productionRunRepository.test.ts`

## 8. Read-side recovery for a failed marker write

The follow-up acceptance found the remaining class of failure: the policy owner can
throw while writing `generation.policy_decision_failed` (including a revision
conflict). The direct cause is then a best-effort marker write; the class root cause
is that card visibility depended on that write succeeding.

The durable owner now records `policyDecisionDeadlineAt` when a project policy
presentation opens, using the existing `PROJECT_AGENT_PREPARING_DEADLINE_MS`
contract. The read owner shows a project pending card once that deadline has passed,
or whenever the durable state is `failed`, and marks the projected card
`manualDecisionRequired`. This is deliberately a read-side deadline rather than a
second retry protocol: a retry can still lose to process death or another revision,
while the deadline is deterministic and survives restart. Startup stale cleanup also
leaves project policy-pending presentations in place so the safety card can be read.

Regression evidence is split by boundary: the transport test covers a marker
revision conflict; `productionPendingSpend.test.ts` covers expired pending data and
the manual-decision contract; `normalizeLegacyPresentation` covers restart/backfill;
and the future-deadline case proves successful full-auto decisions do not add a card.
