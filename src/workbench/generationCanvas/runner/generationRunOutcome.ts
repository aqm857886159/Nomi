import type { GenerationNodeResult } from '../model/generationCanvasTypes'
// 「用户在那张花钱确认框上到底做了什么」——**渲染层这一侧的那一格**。
//
// ── 它为什么必须存在 ──
//
// `confirmAndRunPlan` / `regenerateNodeInPlace` 原来都是 `Promise<void>`，取消那一支写作
// `if (!grantId) return`。对**用户自己点按钮**的那些入口这没问题：他刚点的取消，他自己知道。
// 但同一条链还有第二个调用方——Agent 的 `generate` 对文稿方案走
// `presentStoryboardAuthoring` → 渲染层 `storyboard.present` → 这里。那一侧的
// `return` 把结局吞掉了，于是：
//
//   用户在全屏 `SpendConfirmDialog` 上点了取消（或确认）→ 渲染层照样回
//   `{status:'presented'}` → 主进程读不到任何结论 → `generate` 以
//   `generation_approval_unavailable`「this host did not wait for his answer」
//   **错误形状**回给模型，并进熔断计数。
//
// run5 实测：A1 一次、A3 两次，与各自答框的次数**一一对应**（`docs/evidence/2026-09-22-askback-real-model-run5`）。
// 与 2026-09-22 修掉的「答上了的 `ask_user` 被标成错误」是同一族——用户确实答了，只是
// 他答的那张卡的结局没有人往回送。
//
// ── 为什么不是「再登记一个 waiter」──
//
// 报价卡那条路需要 `registerSpendWaiter`，是因为那张卡由**另一条 IPC**（`confirmSpend` / `discardSpend`）
// 回答，结论不在工具调用的回包里。这条路不一样：`storyboard.present` 是一次
// `requestRendererDecision`，它**本来就一直等到用户答完**（那个通道刻意没有墙钟，
// 见 `rendererBridge.requestRendererDecision`），结局天然在回包里。再架一个 waiter
// 就是同一件事的第二套机制（P1）。所以这里做的只有一件事：**别把结局扔掉**。
import type { GenerateUserDecision } from '../../../../electron/shared/agentLane/generateUserDecision'

export type GenerationRunOutcome =
  /** 用户同意了，至少一次提交真的发出去了。 */
  | 'started'
  /** 用户没同意这次（点了取消 / 关掉 / 点遮罩）。**不是错误**：没有任何东西坏了。 */
  | 'declined'
  /** 压根没有要跑的东西，所以一张卡都没弹过（都已经有结果了 / 范围里没有可跑的行）。 */
  | 'nothing-to-run'
  /** 拿不到执行上下文（没有打开的项目 / 项目在中途被换掉）。这是真错误。 */
  | 'unavailable'

/**
 * 一次 present 里可能问好几次（每个锚卡一次、批量一次）。合成一个结局的规则，按**用户看到的**排：
 * 只要他对其中任何一次说了「不」，这一次 `generate` 对他而言就是「我没同意」；
 * 一次都没问过才是 `nothing-to-run`；上下文没了压过其余（那是真错误，不能说成「他拒绝了」）。
 */
export function mergeRunOutcomes(outcomes: readonly GenerationRunOutcome[]): GenerationRunOutcome {
  if (outcomes.includes('unavailable')) return 'unavailable'
  if (outcomes.includes('declined')) return 'declined'
  return outcomes.includes('started') ? 'started' : 'nothing-to-run'
}

/** 渲染层的结局 → 模型面那一格（`GENERATE_USER_DECISION_KEY` 读的就是它）。 */
export function generateUserDecisionOfRunOutcome(outcome: GenerationRunOutcome): GenerateUserDecision | undefined {
  if (outcome === 'started') return { outcome: 'approved' }
  if (outcome === 'declined') return { outcome: 'declined' }
  return undefined
}

export type RunGenerationNodesBatchResult = {
  totalCount: number
  skipped: string[]
  successes: Array<{ nodeId: string; result: GenerationNodeResult }>
  failures: Array<{ nodeId: string; error: Error }>
}
