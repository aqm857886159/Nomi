// 付费确认卡的**本地重算**：用户改一个 chip，价格行当场跟着动。
//
// ── 为什么可以在渲染层算，而这不违反「价格必须由宿主算」 ──
//
// 那条纪律真正要守的是**算式和价目不能是渲染层编的**。这里两样都不是自己的：
//   · 算式 = `electron/shared/contracts/shotPricingRule.ts` 的 `deriveShotPrice`，
//     主进程封印合同时用的就是它（2026-09-11 从主进程搬进中立契约层，两端唯一一份）；
//   · 价目 = 目录里那一行的 `model.pricing`，经 `ModelOption.pricing` 过来的同一份数据。
//
// 所以本地这个数不是「猜」，是**同一条算式对同一份价目跑一遍**。它的作用是把「改完到看见价格」
// 这一个来回抹掉——上一轮的已知缺口就是这个来回（用户改完参数，按钮上还印着旧的数）。
//
// ── 本地估算与正式报价的关系 ──
//
// 按下主按钮时主进程会 `generation.revise` + 重新封印，出**正式报价**。两者理应逐分相同
// （同算式同价目），真不同只可能是目录快照一边新一边旧——那时**以主进程为准**，卡上原地
// 把数字换掉，不弹第二张卡、不打断（2026-09-11 用户拍板）。`priceDisagreement` 就是给
// 那一刻用的：它说得出「差在哪一镜、差多少」，好让这件事可测、也能写进日志。
//
// 「算不出绝不落成 0」这条由算式本身守（`{ known:false }` 一路带到卡上）。
import { createModelPricingResolver, deriveShotPrice, type PricingResolver } from '../../../../electron/shared/contracts/shotPricingRule'
import type { ModelOption } from '../../../config/models'
import type { PendingSpendConfirm, PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import { effectiveCandidate, effectivePatchForShot, type SpendDraft } from './spendCardDraft'

/**
 * 模型下拉里的那些行 → 报价 resolver。身份匹配规则住在契约层，和主进程认同一行
 * （vendorKey + modelKey/modelAlias，大小写不敏感）——差一点，卡上的数和真正要扣的数就会岔开。
 */
export function pricingResolverFromModelOptions(options: readonly ModelOption[]): PricingResolver {
  return createModelPricingResolver(options.map((option) => ({
    vendorKey: option.vendor ?? '',
    modelKey: option.modelKey ?? option.value,
    modelAlias: option.modelAlias ?? null,
    ...(option.pricing ? { pricing: option.pricing } : {}),
  })))
}

/**
 * 按当前这份覆写账本把整笔待确认**重算一遍**，回一份同形状的 `PendingSpendConfirm`。
 *
 * 回同一个形状是有意的：卡的投影（`projectSpendCard`）从此只认识一种输入，
 * 「本地重算过的」和「宿主刚送来的」在它眼里没有区别——不需要第二条渲染分支。
 *
 * 本地解不出价格时回落到宿主那个数，**但只对没被改过的镜**。目录还没加载完是常态，
 * 那时显示宿主上一刻算过的数是对的；可一旦用户在这一镜上改了什么（尤其换成一个没配价目的模型），
 * 继续印旧数就成了谎——它会被读成「改完还是这个价」。改过的镜解不出，就诚实地印「算不出」。
 */
export function repricePendingSpend(
  pending: PendingSpendConfirm,
  draft: SpendDraft,
  resolvePricing: PricingResolver | undefined,
): PendingSpendConfirm {
  if (!resolvePricing) return pending
  const shots: PendingSpendShot[] = pending.shots.map((shot) => {
    const patch = effectivePatchForShot(draft, shot.shotId)
    const untouched = Object.keys(patch).length === 0
    const candidate = effectiveCandidate(shot, patch)
    const price = deriveShotPrice({ candidate, resolvePricing })
    // 没被改过的镜：本地解不出就用宿主那个数（目录还没加载完不该把已知价抹成未知）。
    // 被改过的镜：解不出就是解不出——继续印旧数会被读成「改完还是这个价」。
    const nextPrice = price.known || !untouched ? price : shot.price
    return Object.freeze({
      ...shot,
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      parameters: Object.freeze({ ...candidate.parameters }),
      price: nextPrice,
    })
  })
  return Object.freeze({
    ...pending,
    shots: Object.freeze(shots),
    knownSubtotal: shots.reduce((sum, shot) => (shot.price.known ? sum + shot.price.amount : sum), 0),
    unknownShotCount: shots.filter((shot) => !shot.price.known).length,
  })
}

export type SpendPriceDisagreement = Readonly<{
  shotId: string
  /** 卡上此刻印的那个数（本地算的）。`undefined` = 本地报「算不出」。 */
  local?: number
  /** 主进程重新封印后回来的那个数。`undefined` = 宿主报「算不出」。 */
  authoritative?: number
}>

/**
 * 本地估算 ↔ 正式报价的逐镜对账。空数组 = 一分不差（正常情况）。
 * 有差 → 调用方以 `authoritative` 为准原地改价格行，并把这份清单记下来。
 */
export function priceDisagreements(
  local: PendingSpendConfirm,
  authoritative: PendingSpendConfirm,
): readonly SpendPriceDisagreement[] {
  const byId = new Map(local.shots.map((shot) => [shot.shotId, shot]))
  const out: SpendPriceDisagreement[] = []
  for (const shot of authoritative.shots) {
    const mine = byId.get(shot.shotId)
    if (!mine) continue
    const localAmount = mine.price.known ? mine.price.amount : undefined
    const hostAmount = shot.price.known ? shot.price.amount : undefined
    if (localAmount === hostAmount) continue
    out.push(Object.freeze({
      shotId: shot.shotId,
      ...(localAmount === undefined ? {} : { local: localAmount }),
      ...(hostAmount === undefined ? {} : { authoritative: hostAmount }),
    }))
  }
  return Object.freeze(out)
}
