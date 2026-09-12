// 「本该出现一张确认卡，但它没有渲染」——这一族失败的**唯一出口**（2026-09-12）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 2026-09-11 的真实会话里，用户让 Agent 把一段素材劈成两半。模型照做了，回了一句
// 「已生成剪辑预览，请在确认卡中批准后写入时间线」——**而面板上一张卡都没有**。
// 用户等了一会儿，以为卡在加载；再等一会儿，以为 Nomi 坏了。真相是：宿主这一侧确实
// announce 了「有一条在等你」（dock 上还写着「等你确认 1 条」），但把它画成卡的那一步
// 在某个分支上 `return undefined` 了，而那个 `undefined` 和「现在真的没有要确认的东西」
// 长得一模一样。
//
// ── 这一族的共同根因 ──
//
// announce 与 render 之间那几段链路，把**三件不同的事**塌缩成了同一个返回值：
//
//   ① 真的没有要确认的东西        → 不该出卡（对）
//   ② 我不知道（通道没起来 / 抛了）  → 被写成了 ①
//   ③ 我知道有，但我画不出来（认不出 kind / 缺字段） → 也被写成了 ①
//
// ②③ 是失败，①不是。把失败写成空，用户那头就只剩沉默——而沉默是最贵的一种回答：
// 他不知道该等、该重试，还是该去别处找。所以这个模块规定：**② ③ 一律出一张会说话的卡。**
//
// ── 为什么是一张卡而不是 toast ──
//
// 出事的位置就是介入槽；卡出现在用户正盯着的那个位置，说的是「这里本来该有东西」。
// toast 会飘走，而这条信息要一直在，直到那张真卡来了或者用户去处理。
import type { TFunction } from 'i18next'
import type { InterventionData } from './agentPanelV4Types'

/**
 * 断在哪一环。每个值对应一条**具体**的链路，不是笼统的「出错了」——
 * 用户看到的那句话里带着它，排查的人一眼知道该看哪。
 */
export const MISSING_CARD_REASONS = [
  /** 宿主那条读通道抛了（IPC 拒绝 / 主进程没准备好）。 */
  'host-unreachable',
  /** 付费确认这条能力在主进程里根本没装起来（能力核装配失败）。 */
  'spend-surface-unavailable',
  /** 宿主说有一条在等，但这份载荷认不出是哪一种卡。 */
  'unknown-kind',
] as const

export type MissingCardReason = (typeof MISSING_CARD_REASONS)[number]

/** 事故现场的一行（英文、给排查用，不进界面）。 */
export type MissingCardTrace = Readonly<{
  reason: MissingCardReason
  /** 哪个 announce 面声称有卡（`spend-confirm` / `lane-approval` …）。 */
  announcer: string
  /** 原始错误 / 载荷摘要。 */
  detail: string
}>

/**
 * 主进程拒绝一次「有没有待确认」的读取时，断在哪一环。
 *
 * 判据只有这一个 owner：读通道（`useAgentPanelSpendConfirm`）只负责把错交过来。
 * `spend_confirm_surface_unavailable` 是能力核压根没装起来（`appIntegrationSpendConfirm.ts`
 * 的 `PendingSpendSurfaceUnavailableError`），其余归到「读不到主进程那份清单」。
 *
 * 认不出的错**不回 `undefined`**：那会把「读不到」又变回一种空。最笼统的那条也是一句话。
 */
export function missingCardReasonOfReadFailure(error: unknown): MissingCardReason {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes('spend_confirm_surface_unavailable') || text.includes('capability core')
    ? 'spend-surface-unavailable'
    : 'host-unreachable';
}

/**
 * 开发/测试才抛，打包版不抛。判据只有这一行：打包版里用户正在用 Nomi，抛异常等于白屏——
 * 那时该出的是那张会说话的卡。CI 与开发机上则必须当场炸，好让新长出来的静默分支走不出去。
 */
const ASSERT_ANNOUNCED_CARDS: boolean =
  typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'

/**
 * 写一条排查痕迹。**每一次**渲染这张卡都要先走它——卡告诉用户「这里断了」，
 * 这一行告诉我们「断在哪、原话是什么」。两者缺一，下一次复现还是只能靠猜。
 */
export function traceMissingInterventionCard(trace: MissingCardTrace): void {
  // eslint-disable-next-line no-console
  console.error('[missing-intervention-card]', trace.announcer, trace.reason, trace.detail)
}

/**
 * 那张会说话的卡。文案走 i18n（R15），reason 作为插值——**不是**把英文原因直接印出去。
 */
export function missingInterventionCard(trace: MissingCardTrace, t: TFunction): InterventionData {
  traceMissingInterventionCard(trace)
  return Object.freeze({
    kind: 'missing-card' as const,
    title: t('agentPanelV4.missingCard.title'),
    summary: t('agentPanelV4.missingCard.body', { reason: t(`agentPanelV4.missingCard.reason.${trace.reason}`) }),
  })
}

/**
 * 开发/测试期的硬断言：**声称有卡 ⇒ 必须画出点什么**。
 *
 * 生产里我们出那张会说话的卡（用户还能继续用 Nomi）；测试里直接抛——
 * 一条新的静默分支要在 CI 里当场红，而不是等某个用户再对着空面板等十分钟。
 * 判据只有一个 owner：这里。别处不许再写一遍「是不是该有卡」。
 */
export function assertAnnouncedCardRendered(input: Readonly<{
  announcer: string
  announced: boolean
  rendered: InterventionData | undefined
}>): void {
  if (!ASSERT_ANNOUNCED_CARDS) return
  if (!input.announced || input.rendered) return
  throw new Error(
    `[missing-intervention-card] ${input.announcer} announced a pending confirmation but the host rendered no card. `
    + 'Every announce→render link must resolve to a card or to a loud missing-card notice; it may never resolve to nothing.',
  )
}
