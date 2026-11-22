// 付费卡上说「没成」的那几句（2026-09-30 付费卡① 第 11 条：失败只给存在的出路；D2 第③步：卡上没有参数了）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 用户点了「生成」，卡上弹一句「这一步没成……可以改一下再按一次」，可卡上什么都改不了。那句话许诺了一条不存在的出路。
// D2 之后卡上本来就没有参数——想改去节点里改——所以这里只剩两类句子，各自只看事实：
//   ① 卡上那一下动作（交给画布 / 取消 / 不生成 / 恢复）本身没做成：宿主回的结果说「可能已经发出去」（结果未知，先去核对）
//      还是「没发起」，没发起的话是哪一种（卡刚变了、项目不在前台、生成功能还没起来……）；
//   ② 交给画布的某一镜没发出去 / 发不出去：主进程与渲染层回的语义码（`GenerationHandOverFailure`）→ 卡上那一行原因。
// 码只认 Nomi 自己的；没登记的码按种类说（没发出去 = 可以再试；参数被拒 = 去节点里改）。界面不谈钱（#957）：只说发没发出去和下一步。
import type { TranslationKey } from '../../../i18n/translationKey'
import type { ProductionActionResult } from '../../production/productionRunApi'
import type { GenerationHandOverFailure } from '../../../desktop/productionRunBridgeTypes'
import { SHOT_ACTION_FAILURE_COPY } from '../../production/productionShotActions'

/** 宿主回的那一下（IPC 抛出来的那一种没有结果，传 `undefined`）。 */
export type SpendActionOutcome = Partial<Pick<ProductionActionResult, 'ok' | 'code' | 'message' | 'failure' | 'reason' | 'field'>>

const CARD_CHANGED = new Set(['generation_quote_changed'])
const SHOT_GONE = new Set(['generation_scope_invalid', 'generation_shot_not_found'])

/**
 * 卡上一下动作没做成时弹的那一句。
 *
 * 判序是有意的：先认「可能已经发出去」（这个事实压过一切，说成「没发出去、再按一次」是最贵的一种错），再认宿主点名的那几种，
 * 最后才是「没成，再按一次」。
 */
export function spendActionFailureCopy(outcome: SpendActionOutcome | undefined): TranslationKey {
  // 调用本身抛了（桥断了 / 主进程回了个拒绝）：不知道走到了哪一步，按「结果未知」说，让他先去核对再按。
  if (!outcome) return 'agentPanelV4.spendActionFailed'
  const message = outcome.message ?? ''
  if (message === 'generation_execution_failed') return 'agentPanelV4.spendActionFailed'
  if (CARD_CHANGED.has(message)) return 'agentPanelV4.spendActionCardChanged'
  // 主进程把「这一镜不在卡上」记成没发起的原因（`reason`），通道守卫直接回在 `message` 上：两处都认。
  if (SHOT_GONE.has(message) || SHOT_GONE.has(outcome.reason ?? '') || message.startsWith('no pending generation')) return 'agentPanelV4.spendActionShotGone'
  if (outcome.code === 'run_not_open' || message === 'run_not_open') return SHOT_ACTION_FAILURE_COPY.run_not_open
  if (outcome.code === 'unavailable') return SHOT_ACTION_FAILURE_COPY.core_starting
  if (outcome.failure && outcome.failure !== 'internal_error') return SHOT_ACTION_FAILURE_COPY[outcome.failure]
  return 'agentPanelV4.spendActionNotStarted'
}

/** 登记过的交接失败码 → 卡上那一行原因。没登记的按种类说（见 `handOverFailureCopy`）。 */
export const HAND_OVER_FAILURE_COPY = {
  provider_not_reached: 'agentPanelV4.spendCard.failure.provider_not_reached',
  project_not_open: 'agentPanelV4.spendCard.failure.project_not_open',
  canvas_node_missing: 'agentPanelV4.spendCard.failure.canvas_node_missing',
  node_generation_in_flight: 'agentPanelV4.spendCard.failure.node_generation_in_flight',
  node_needs_reconcile: 'agentPanelV4.spendCard.failure.node_needs_reconcile',
  asset_hosting_denied: 'agentPanelV4.spendCard.failure.asset_hosting_denied',
  asset_hosting_consent_required: 'generationCommon.hostingDisabled',
  renderer_unavailable: 'agentPanelV4.spendCard.failure.renderer_unavailable',
  canvas_landing_failed: 'agentPanelV4.spendCard.failure.canvas_landing_failed',
  canvas_consent_failed: 'agentPanelV4.spendCard.failure.canvas_consent_failed',
  canvas_consent_withdrawn: 'agentPanelV4.spendCard.failure.canvas_consent_withdrawn',
  canvas_not_consented: 'agentPanelV4.spendCard.failure.canvas_not_consented',
  canvas_hand_over_failed: 'agentPanelV4.spendCard.failure.canvas_hand_over_failed',
  provider_rejected: 'agentPanelV4.spendCard.failure.provider_rejected',
  director_preview_blocked: 'agentPanelV4.spendCard.failure.director_preview_blocked',
  model_not_selected: 'agentPanelV4.spendCard.failure.model_not_selected',
  local_model_on_card: 'agentPanelV4.spendCard.failure.local_model_on_card',
  reference_required: 'agentPanelV4.spendCard.failure.reference_required',
  reference_combination_invalid: 'agentPanelV4.spendCard.failure.reference_combination_invalid',
  prompt_required: 'agentPanelV4.spendCard.failure.prompt_required',
  anchor_not_frozen: 'agentPanelV4.spendCard.failure.anchor_not_frozen',
  upstream_not_ready: 'agentPanelV4.spendCard.failure.upstream_not_ready',
  reference_cycle: 'agentPanelV4.spendCard.failure.reference_cycle',
} as const satisfies Readonly<Record<string, TranslationKey>>

/** 卡上那一行原因用的键：表里那几条，或者按种类说的那两条（整键字面量，纯投影的 `t` 收得下）。 */
export type HandOverFailureCopyKey =
  | (typeof HAND_OVER_FAILURE_COPY)[keyof typeof HAND_OVER_FAILURE_COPY]
  | 'agentPanelV4.spendCard.failure.rejectedFallback'
  | 'agentPanelV4.spendCard.failure.notSentFallback'

/** 交给画布的一镜为什么没发出去 / 发不出去 → 卡上那一行原因。 */
export function handOverFailureCopy(failure: GenerationHandOverFailure): HandOverFailureCopyKey {
  const known = (HAND_OVER_FAILURE_COPY as Readonly<Record<string, HandOverFailureCopyKey | undefined>>)[failure.code]
  if (known) return known
  return failure.kind === 'parameter_rejected' ? 'agentPanelV4.spendCard.failure.rejectedFallback' : 'agentPanelV4.spendCard.failure.notSentFallback'
}
