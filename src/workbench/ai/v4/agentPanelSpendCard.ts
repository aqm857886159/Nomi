// 付费确认卡的**纯投影**：宿主给的那笔待确认生成 → 介入槽的 `InterventionData`。
//
// 为什么单独一层：这张卡上每一个数都必须能追到产地。住在组件里就只能靠截图证明「印对了没有」，
// 住在这里能逐条单测——而这是**钱**的卡，印错一个数的代价不是难看。
//
// 三条印数纪律（`docs/research/2026-09-10-permission-rework-prior-art/prior-art.md` 1-4/1-5）：
//   ① 价格来自宿主投影（目录里的 `model.pricing`），渲染层不从参数反推；
//   ② 算不出就印「暂时算不出价格」，**绝不落成 ¥0**——三种可能里只有它会被读成「这次免费」；
//   ③ 算式只印我们真的算过的东西。目录的价目是「基价 + 命中的规格加价」，**不是**「每秒单价 × 时长」，
//      所以这里印的是「N 镜」而不是「N 镜 × 3s · ¥0.10/秒」。后者要等目录长出按秒计价才成立，
//      在那之前印它就是编一个不存在的算法（样张上那句是报价桩，不是我们的价目模型）。
import type { PendingSpendConfirm, PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import type { InterventionData } from './agentPanelV4Types'

type Translate = (key: string, options?: Record<string, unknown>) => string

export type SpendCardView = Readonly<{
  page: number
  scope: 'each' | 'all'
}>

/** 这一镜的价格文本；算不出 → `undefined`（调用方据此走「算不出」那一档）。 */
function money(t: Translate, currency: string, amount: number): string {
  return t('agentPanelV4.money', { currency, amount: amount.toFixed(2) })
}

/**
 * 这一单是视频还是图片。判据是候选自己的 `mode`（`text_to_image` / `image_to_video` …），
 * 不是猜的：agent 建的草稿两种都有，标题一律写「视频」会让用户在**付钱前那一刻**怀疑它搞错了。
 */
function isVideoOrder(shots: readonly PendingSpendShot[]): boolean {
  return shots.some((shot) => /video/i.test(shot.mode ?? ''))
}

/** 每一镜都有价、且都是同一个数 = 「整齐」。不整齐时算式退成「逐镜不同」。 */
function isUniform(shots: readonly PendingSpendShot[]): boolean {
  const first = shots[0]?.price
  if (!first?.known) return false
  return shots.every((shot) => shot.price.known && shot.price.amount === first.amount)
}

export function spendCardPage(pending: PendingSpendConfirm, page: number): number {
  if (pending.shots.length === 0) return 0
  return ((page % pending.shots.length) + pending.shots.length) % pending.shots.length
}

/**
 * 卡上要印的一切。`undefined` = 这笔待确认里一镜都没有（不该出卡）。
 *
 * 「Nomi 选的」是**现算**的：这些候选本来就是 agent 挑的模型，用户一旦在卡上换了模型，
 * 下一次投影里的 `modelId` 就变了，那句话跟着消失——不会留在卡上变成一句假话。
 */
export function projectSpendCard(
  pending: PendingSpendConfirm,
  view: SpendCardView,
  t: Translate,
  options: Readonly<{ agentPickedModelIds?: readonly string[] }> = {},
): InterventionData | undefined {
  const shots = pending.shots
  if (shots.length === 0) return undefined
  const index = spendCardPage(pending, view.page)
  const current = shots[index]
  const total = pending.unknownShotCount === 0 ? pending.knownSubtotal : undefined
  const uniform = isUniform(shots)
  const picked = options.agentPickedModelIds
  const pickedByAgent = picked ? picked.includes(current.modelId) : true
  const badge = pickedByAgent
    ? `${t('agentPanelV4.slotSpendBadge')} · ${t('agentPanelV4.spendParamsModelPicked')}`
    : t('agentPanelV4.slotSpendBadge')
  const price: NonNullable<InterventionData['price']> = {
    breakdown: total === undefined || uniform
      ? t('agentPanelV4.spendParamsBreakdownNoUnit', { count: shots.length })
      : t('agentPanelV4.spendParamsBreakdownMixed', { count: shots.length }),
    ...(total === undefined
      ? { unavailable: t('agentPanelV4.spendParamsUnavailable') }
      : { totalLabel: t('agentPanelV4.spendParamsTotalLabel'), total: money(t, pending.currency, total) }),
    // 逐镜摊开只在「不整齐」时才有信息量：整齐时每一行都是同一个数，摊开等于把同一句话抄 N 遍。
    ...(total !== undefined && shots.length > 1 && !uniform
      ? {
          perItemLabel: t('agentPanelV4.spendParamsPerItem', { count: shots.length }),
          perItem: shots.map((shot) => ({
            label: t('agentPanelV4.spendParamsShot', { number: shot.index }),
            amount: shot.price.known
              ? money(t, pending.currency, shot.price.amount)
              : t('agentPanelV4.spendParamsUnavailable'),
          })),
        }
      : {}),
  }
  // 报不出合计就没有「全部」可言：那一档没有能落到主按钮上的数，所以范围切换整个不渲染。
  const batch = view.scope === 'all' && shots.length > 1 && total !== undefined
  return Object.freeze({
    kind: 'spend' as const,
    // 标题里**不印金额**：金额随参数变，两个地方印同一个数就一定有一个先漂。
    title: t(isVideoOrder(shots) ? 'agentPanelV4.spendParamsTitle' : 'agentPanelV4.spendParamsTitleImage', { count: shots.length }),
    badge,
    ...(shots.length > 1
      ? {
          pager: {
            index,
            total: shots.length,
            keyHint: t('agentPanelV4.pagerKeyHint'),
            ...(total !== undefined
              ? {
                  scope: {
                    value: batch ? ('all' as const) : ('each' as const),
                    eachLabel: t('agentPanelV4.spendParamsScopeEach'),
                    allLabel: t('agentPanelV4.spendParamsScopeAll'),
                    ariaLabel: t('agentPanelV4.spendParamsScopeAria'),
                  },
                }
              : {}),
          },
        }
      : {}),
    price,
    // 正常那两档一句话都不多说：卡上每一样东西都能改、改完价格就变，这件事**看得见**。
    // 只有报不出价那一档必须说话——那是用户在按下去之前唯一没法自己看出来的事。
    ...(total === undefined ? { scope: t('agentPanelV4.spendParamsScopeUnknown') } : {}),
    confirmLabel: batch && total !== undefined
      ? t('agentPanelV4.spendParamsConfirmAll', { count: shots.length, amount: money(t, pending.currency, total) })
      : current.price.known
        ? t('agentPanelV4.spendParamsConfirm', { amount: money(t, pending.currency, current.price.amount) })
        : t('agentPanelV4.spendParamsConfirmUnknown'),
  })
}
