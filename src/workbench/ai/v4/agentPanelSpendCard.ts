// 付费卡的**纯投影**（D2 第③步，SpendCardQ1 板）：宿主给的那一次出价 + 每一镜节点此刻的事实 → 介入槽要画的一切。
//
// 卡只问一件事：花不花。卡 = 指向元素 + 一句话 + 一行只读摘要 + 「生成」。参数、提示词、参考只住在画布节点上，
// 卡上的每一个字都读节点此刻的样子（`SpendCardShotFacts` 由宿主钩子从节点现读）；想改点指向去节点里改（设计系统 §1.0）。
//
// 为什么单独一层：这是**钱**的卡，每一句话（几段、哪一镜没发出去、为什么、下一步）都必须能追到产地。住在组件里只能靠
// 截图证明，住在这里能逐条单测。三种样子只由事实决定：
//   · 有镜正在交给画布（`handing_over`）→ 「正在发出 k/N 段」，动作行只说怎么停；
//   · 有镜没发出去 / 结果不确定，或者一段能发的都没有、却有本机判得出发不出去的 → 失败留在卡里（板 ⑤⑥）；
//   · 其余 → 等人决定：「生成」/「全部生成（N）」/「生成剩下 N 段」。
// 钱照 10-08「界面不谈钱」：方案一不渲染页脚数量；只有各镜价格不同时折叠明细里印每镜价（板 D5）。
import { formatMoney } from './formatMoney'
import type { GenerationHandOverFailure, PendingSpendConfirm, PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import type { ShotPrice } from '../../../../electron/shared/contracts/shotPricingRule'
import type { InterventionData } from './agentPanelV4Types'
import { formatSeconds } from '../../generation/list/generationListMediaFacts'
import { handOverFailureCopy } from './spendCardFailure'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** 一镜此刻在节点上的样子（宿主钩子从画布节点现读，卡不存副本）。 */
export type SpendCardShotFacts = Readonly<{
  /** 节点在画布上（画布还没载入完时按「在」算：不知道就不说已删除）。 */
  present: boolean
  /** 卡上怎么称呼这一镜：和指向元素标题行同一个名字（分镜号「镜 02」；没有分镜号就是「镜头 N」）。 */
  shotRef: string
  /** 摘要那几样（`nodePointerSummaryFacts`：模型显示名、比例、时长秒、清晰度）。 */
  model: string
  aspect: string | null
  durationSec: number | null
  resolution: string | null
  /** 节点此刻选的模型身份（「Nomi 选的」判据：它就是 Agent 起草时选的那个）。 */
  selected: Readonly<{ providerId: string; modelId: string }> | null
  /** 节点按画布批量估价同一个函数算出的价（`estimateNodePrice`）。 */
  price: ShotPrice
  /** 本机预检（`handOverPrecheck`）判得出这一镜此刻交不出去：原因。只对还没决定的镜有意义。 */
  blocked?: GenerationHandOverFailure
}>

export type SpendCardView = Readonly<{
  /** 卡上一下动作在路上（按下即置灰，第二下不进）。 */
  busy: boolean
  /** 点了「取消」、宿主还没停稳。 */
  stopping: boolean
  /** 要交的这几镜得先把本机参考图传到公共临时托管：卡上摆一行披露，按「生成」就是同意这一次（画布批量确认框同一句）。 */
}>

export type SpendCardPointer = Readonly<{
  shotId: string
  /** 还没落到画布上的那一镜是空串（指向元素画中性占位、不可点）。 */
  nodeId: string
  shotRef: string
  /** 宿主说了删（制作脱离记录）、节点也不在画布上了：指向元素「已删除」。 */
  removed: boolean
  /** 指向元素状态条上那一个词：这一镜这一次没成 / 现在交不出去。 */
  hostFailure?: string
  /** 失败卡上还未发出的那一格，本次出价的状态词。 */
  hostStatus?: string
  /** 多段卡格子右上那颗小钮：「不生成 ×」（还没决定的）/「恢复」（去掉了的）/ 没有。 */
  exclusion: 'exclude' | 'restore' | null
  /** 逐镜摘要；参数逐镜不同时给悬停行使用。 */
  hoverSummary?: string
}>

export type SpendCardNotice = Readonly<{ tone: 'danger' | 'neutral'; text: string; detail?: string }>

/** 主按钮那一下做什么（宿主照它接线；卡上那颗按钮的字也是它定的）。 */
export type SpendCardPrimary =
  | Readonly<{ kind: 'generate'; shotIds: readonly string[] }>
  | Readonly<{ kind: 'retry'; shotIds: readonly string[] }>
  | Readonly<{ kind: 'locate'; nodeId: string; label: string }>
  | Readonly<{ kind: 'none' }>

export type SpendCardModel = Readonly<{
  slot: InterventionData
  pointers: readonly SpendCardPointer[]
  /** 卡上只有一段：单张指向元素（画面左、摘要右，板 ①）。 */
  single: boolean
  /** 多段卡组指向下方那一行（没有悬停时）：这几段合起来的只读摘要。只在等人决定时有。 */
  summary?: string
  notices: readonly SpendCardNotice[]
  primary: SpendCardPrimary
}>

type Role = 'sendable' | 'blocked' | 'absent' | 'excluded' | 'deleted' | 'taken' | 'sending' | 'sent' | 'unclear' | 'notSent'

type Entry = Readonly<{ shot: PendingSpendShot; facts: SpendCardShotFacts; role: Role }>

/** 这一镜在这一次出价里此刻是哪一种（只看宿主的结局 + 节点在不在 + 本机预检）。 */
function roleOf(shot: PendingSpendShot, facts: SpendCardShotFacts): Role {
  switch (shot.offer) {
    case 'removed': return facts.present ? 'excluded' : 'deleted'
    case 'taken_by_canvas': return 'taken'
    case 'handing_over': return 'sending'
    case 'sent': return 'sent'
    case 'unknown': return 'unclear'
    // 节点已经不在画布上：再试也交不出去，不当成要处理的那一镜（宿主随后记成脱离）。
    case 'not_sent': return facts.present && shot.nodeId ? 'notSent' : 'absent'
    case 'undecided': return !shot.nodeId || !facts.present ? 'absent' : facts.blocked ? 'blocked' : 'sendable'
  }
}

const BRAKE_COPY = {
  'retry-limit': 'agentPanelV4.brakeRetry.title',
  'out-of-plan': 'agentPanelV4.brakeOutOfPlan.title',
  stopped: 'agentPanelV4.brakeStopped.title',
} as const

/** 这一叠说「视频 · 段」还是「图片 · 张」：有视频就说视频（标题、页脚、「生成剩下」、停下那一句都读它）。 */
export function spendCardSaysVideo(shots: readonly Pick<PendingSpendShot, 'kind'>[]): boolean {
  return shots.some((shot) => shot.kind === 'video')
}

/**
 * 点了「取消」之后那一句（卡这时已经关了，它是唯一说这件事的地方）：宿主数着交出去几段、没发几段，只说事实。
 * 一段都没剩（取消落在最后一段交出去之后）就照实说它们都已经发出去、会照常生成——不说「已停下」。
 */
export function spendCardStoppedMessage(
  shots: readonly Pick<PendingSpendShot, 'kind'>[],
  stopped: Readonly<{ sent: number; notSent: number }>,
  t: Translate,
): string {
  const video = spendCardSaysVideo(shots)
  // 一段都还没交出去（按了「生成」立刻「取消」，取消先到）：「发出了 0 段」是一句没有信息的话，照实说没发出去。
  if (stopped.sent === 0 && stopped.notSent > 0) {
    return t(video ? 'agentPanelV4.spendBatchNoneSentVideo' : 'agentPanelV4.spendBatchNoneSentImage', { count: stopped.notSent })
  }
  if (stopped.notSent > 0) {
    return t(video ? 'agentPanelV4.spendBatchStoppedVideo' : 'agentPanelV4.spendBatchStoppedImage', { sent: stopped.sent, count: stopped.notSent, total: stopped.sent + stopped.notSent })
  }
  return t(video ? 'agentPanelV4.spendBatchAllSentVideo' : 'agentPanelV4.spendBatchAllSentImage', { sent: stopped.sent, count: stopped.sent })
}

const join = (parts: ReadonlyArray<string | null | undefined | false>, separator = ' · '): string =>
  parts.filter((part): part is string => Boolean(part)).join(separator)

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

/** 单格摘要；整行摘要和悬停摘要都从这一份格式化函数取参数。 */
export function spendCardShotSummary(fact: SpendCardShotFacts, t: Translate, pickedByNomi = false): string | undefined {
  const model = fact.model && pickedByNomi
    ? t('agentPanelV4.spendCard.summaryPickedModel', { model: fact.model, picked: t('agentPanelV4.spendParamsModelPicked') })
    : fact.model
  const line = join([
    model,
    fact.aspect,
    fact.resolution,
    // This is a single shot's readout. The aggregate row owns the `共 / total`
    // wording; repeating it on hover makes one shot sound like the whole batch.
    fact.durationSec ? formatSeconds(fact.durationSec) : null,
  ])
  return line || undefined
}

/**
 * 多段卡组指向下方那一行（板 card.summary）：整齐时保留共同参数；有哪一样逐镜不同时
 * 列不同组「16:9 ×1 · 9:16 ×2」。逐镜悬停摘要由 spendCardShotSummary 共用同一格式。
 */
export function spendCardSummary(facts: readonly SpendCardShotFacts[], t: Translate, pickedByNomi = false): string | undefined {
  if (facts.length === 0) return undefined
  const dimensions: ReadonlyArray<readonly string[]> = [
    facts.map((fact) => fact.aspect ?? ''),
    facts.map((fact) => fact.model),
    facts.map((fact) => fact.resolution ?? ''),
  ]
  const differing = dimensions.filter((values) => distinct(values).length > 1)
  const modelLabel = (value: string): string => value && pickedByNomi ? t('agentPanelV4.spendCard.summaryPickedModel', { model: value, picked: t('agentPanelV4.spendParamsModelPicked') }) : value
  if (differing.length === 0) {
    const seconds = facts.every((fact) => fact.durationSec) ? facts.reduce((total, fact) => total + (fact.durationSec ?? 0), 0) : 0
    const line = join([modelLabel(facts[0]!.model), facts[0]!.aspect, facts[0]!.resolution, seconds ? t('agentPanelV4.spendCard.summarySeconds', { value: formatSeconds(seconds) }) : null])
    return line || undefined
  }
  const common = dimensions.map((values, dimensionIndex) => {
    if (distinct(values).length !== 1) return null
    const value = values[0]!
    if (!value) return null
    return dimensionIndex === 1 ? modelLabel(value) : value
  }).filter((value): value is string => Boolean(value))
  const groups = differing.flatMap((values, dimensionIndex) => distinct(values)
    .map((value) => t('agentPanelV4.spendCard.summaryGroup', {
      value: dimensionIndex === 0 && value === '' ? t('agentPanelV4.spendCard.summaryAuto') : dimensionIndex === 1 ? modelLabel(value) : value,
      count: values.filter((candidate) => candidate === value).length,
    })))
  const groupText = groups.join(' · ')
  return common.length ? t('agentPanelV4.spendCard.summaryMixed', { prefix: common.join(' · '), groups: groupText }) : groupText
}

/** 失败留在卡里时，卡上那一段（板 ⑤⑥）：标题、原因、主按钮。 */
function attentionView(attention: Entry, entries: readonly Entry[], view: SpendCardView, t: Translate): Readonly<{ title: string; reason: string; primary: SpendCardPrimary; confirmLabel: string }> {
  const shot = attention.facts.shotRef
  const locate = (label: string): SpendCardPrimary => ({ kind: 'locate', nodeId: attention.shot.nodeId ?? '', label })
  if (attention.role === 'unclear') {
    // 结果未知：可能已经扣费，不说没花钱；下一步是去节点上核对，不是再发一次（钱可能已经花了）。
    return { title: t('agentPanelV4.spendCard.failedTitle.unclear', { shot }), reason: t('agentPanelV4.spendCard.failure.unclear'), primary: locate(shot), confirmLabel: t('agentPanelV4.spendCard.goCheck', { shot }) }
  }
  const failure: GenerationHandOverFailure = (attention.role === 'blocked' ? attention.facts.blocked : attention.shot.failure) ?? { kind: 'not_sent', code: 'not_sent' }
  const reason = t(handOverFailureCopy(failure))
  if (attention.role === 'blocked') {
    // 还没按就判得出发不出去：参数那一类去节点里改，节点在忙 / 要核对那一类去节点上看。
    const label = failure.kind === 'parameter_rejected' ? t('agentPanelV4.spendCard.goEdit', { shot }) : t('agentPanelV4.spendCard.goCheck', { shot })
    return { title: t('agentPanelV4.spendCard.failedTitle.blocked', { shot }), reason, primary: locate(shot), confirmLabel: label }
  }
  if (failure.kind === 'parameter_rejected') {
    return { title: t('agentPanelV4.spendCard.failedTitle.rejected', { shot }), reason, primary: locate(shot), confirmLabel: t('agentPanelV4.spendCard.goEdit', { shot }) }
  }
  // 没发出去（没花钱）：「再试一次」只重发没发出去的那几镜（不连带还没决定的）。要问托管同意的那一种，卡上的原因行就是披露原文，
  // 这一下点的「再试一次」就是同意这一次。
  const retry = entries.filter((entry) => entry.role === 'notSent' && entry.shot.failure?.kind !== 'parameter_rejected')
  return {
    title: t('agentPanelV4.spendCard.failedTitle.notSent', { shot }),
    reason,
    primary: { kind: 'retry', shotIds: retry.map((entry) => entry.shot.shotId) },
    confirmLabel: t('agentPanelV4.spendCard.retry'),
  }
}

/**
 * 卡上要画的一切。`facts` 与 `pending.shots` 一一对应（宿主钩子从节点现读）。`undefined` = 这一次出价没有能摆的镜。
 */
export function projectSpendCard(
  pending: PendingSpendConfirm,
  facts: readonly SpendCardShotFacts[],
  view: SpendCardView,
  t: Translate,
  /** 金额怎么印跟着界面语言走（`formatMoney`）；必填：漏传不会报错，只会悄悄按某个默认语言印。 */
  options: Readonly<{ locale: string }>,
): SpendCardModel | undefined {
  const entries: Entry[] = pending.shots
    .map((shot, index) => ({ shot, facts: facts[index]!, role: roleOf(shot, facts[index]!) }))
    .filter((entry) => Boolean(entry.facts))
    .sort((a, b) => a.shot.index - b.shot.index)
  if (entries.length === 0) return undefined
  const single = entries.length === 1
  const has = (role: Role) => entries.some((entry) => entry.role === role)
  const pick = (...roles: Role[]) => entries.filter((entry) => roles.includes(entry.role))
  const sendable = pick('sendable')
  const sending = has('sending')
  // 「Nomi 选的」只说这一下要交的那几镜（还没决定、节点在画布上）。
  const about = pick('sendable', 'blocked')
  const pickedByNomi = about.length > 0 && about.every((entry) => entry.facts.selected
    && entry.facts.selected.providerId === entry.shot.draftedModel.providerId
    && entry.facts.selected.modelId === entry.shot.draftedModel.modelId)
  const summaryVaries = [
    sendable.map((entry) => entry.facts.model),
    sendable.map((entry) => entry.facts.aspect ?? ''),
    sendable.map((entry) => entry.facts.resolution ?? ''),
    sendable.map((entry) => String(entry.facts.durationSec ?? '')),
  ].some((values) => distinct(values).length > 1)
  // 失败留在卡里：没发出去 / 结果不确定的那一镜；一段能发的都没有时，本机判得出发不出去的那一镜也是（有能发的时它只占一行说明）。
  const attention = sending ? undefined : entries.find((entry) => entry.role === 'notSent' || entry.role === 'unclear' || (entry.role === 'blocked' && sendable.length === 0))
  const saysVideo = spendCardSaysVideo(sendable.length ? sendable.map((entry) => entry.shot) : entries.map((entry) => entry.shot))
  const brake = pending.brake ? { summary: t(BRAKE_COPY[pending.brake.reason]) } : {}

  const pointers: SpendCardPointer[] = entries.map((entry) => ({
    shotId: entry.shot.shotId,
    nodeId: entry.shot.nodeId ?? '',
    shotRef: entry.facts.shotRef,
    removed: entry.role === 'deleted',
    ...(entry.role === 'blocked' ? { hostFailure: t('agentPanelV4.spendCard.pointerCannotSend') }
      : entry.role === 'notSent' ? { hostFailure: t('agentPanelV4.spendCard.pointerFailed') }
        : entry.role === 'unclear' ? { hostFailure: t('agentPanelV4.spendCard.pointerUnclear') } : {}),
    ...(attention && (entry.role === 'sendable' || entry.role === 'blocked') ? { hostStatus: t('agentPanelV4.spendCard.pointerNotSentYet') } : {}),
    // 「不生成 ×」只在多段卡、还没在交的时候（单段卡的「不生成」就是「取消」）；去掉了的那一镜常驻「恢复」。
    exclusion: single || sending ? null
      : entry.role === 'sendable' || entry.role === 'blocked' ? 'exclude'
        : entry.role === 'excluded' ? 'restore' : null,
    ...(summaryVaries && (entry.role === 'sendable' || entry.role === 'blocked')
      ? { hoverSummary: spendCardShotSummary(entry.facts, t, pickedByNomi) }
      : {}),
  }))

  if (sending) {
    // 交给画布之后还有镜在交：标题说到第几段，动作行只说怎么停（板 ③）。k = 已经落定的 + 正在交的这一段。
    const inFlight = pick('sending', 'sent', 'unclear', 'notSent')
    const settled = inFlight.filter((entry) => entry.role !== 'sending').length
    const total = inFlight.length
    const progressKey = saysVideo ? 'agentPanelV4.spendBatchProgressVideo' : 'agentPanelV4.spendBatchProgressImage'
    return {
      slot: Object.freeze({
        kind: 'spend' as const,
        title: view.stopping ? t('agentPanelV4.spendBatchStopping') : t(progressKey, { current: Math.min(total, settled + 1), total }),
        ...brake,
        progress: { hint: t(view.stopping ? 'agentPanelV4.spendBatchStoppingHint' : 'agentPanelV4.spendBatchStopHint') },
      }),
      pointers, single, notices: [], primary: { kind: 'none' },
    }
  }

  if (attention) {
    const shown = attentionView(attention, entries, view, t)
    const retryEmpty = shown.primary.kind === 'retry' && shown.primary.shotIds.length === 0
    return {
      slot: Object.freeze({
        kind: 'spend' as const,
        title: shown.title,
        ...brake,
        failed: true as const,
        dismissLabel: t('agentPanelV4.spendCard.decline'),
        confirmLabel: shown.confirmLabel,
        ...(shown.primary.kind === 'locate' ? { confirmIcon: 'locate' as const } : {}),
        ...(view.busy || retryEmpty ? { actionsDisabled: true as const } : {}),
      }),
      pointers, single,
      notices: [
        { tone: 'danger', text: shown.reason },
      ],
      primary: shown.primary,
    }
  }

  // 等人决定。N = 主按钮这一下会交出去的段数（去掉的、被删的、节点上已经点过 ↑ 的、本机判得出发不出去的都不算）。
  const count = sendable.length
  const asked = count + pick('blocked', 'absent').filter((entry) => entry.shot.offer === 'undecided').length
  const titleKey = saysVideo ? 'agentPanelV4.spendParamsTitle' : 'agentPanelV4.spendParamsTitleImage'
  const singleTitleKey = saysVideo ? 'agentPanelV4.spendParamsTitleSingle' : 'agentPanelV4.spendParamsTitleImageSingle'
  const remainingTitleKey = saysVideo ? 'agentPanelV4.spendParamsTitleRemainingVideo' : 'agentPanelV4.spendParamsTitleRemainingImage'
  // 节点上点过 ↑ 的（画布接走了）或早先交出去的：卡上剩下的就说「生成剩下 N 段」（板 card.generate）。
  const remaining = has('taken') || has('sent') || has('unclear')
  // 一段都交不出去（全去掉了 / 还在落到画布上）：按钮置灰、只说「生成」，不印「全部生成（0）」。
  const confirmLabel = single || count === 0 ? t('agentPanelV4.spendCard.generate')
    : remaining ? t(saysVideo ? 'agentPanelV4.spendConfirmRemainingVideo' : 'agentPanelV4.spendConfirmRemainingImage', { count })
      : t(saysVideo ? 'agentPanelV4.spendCard.generateAll' : 'agentPanelV4.spendCard.generateAllImage', { count })
  // 钱（D5）：各段价格不同时折叠明细印每镜价；算不出整行不印。数量只在主按钮。
  const prices = sendable.map((entry) => entry.facts.price)
  const allKnown = count >= 1 && prices.every((price) => price.known)
  const amounts = prices.map((price) => (price.known ? price.amount : Number.NaN))
  const uniform = allKnown && amounts.every((amount) => amount === amounts[0])
  const money = (amount: number): string => formatMoney(options.locale, pending.currency, amount)
  const notices: SpendCardNotice[] = []
  for (const entry of pick('blocked')) {
    notices.push({ tone: 'danger', text: t('agentPanelV4.spendCard.blockedNotice', { shot: entry.facts.shotRef, reason: t(handOverFailureCopy(entry.facts.blocked!)) }) })
  }
  const summary = single ? undefined : spendCardSummary(sendable.map((entry) => entry.facts), t, pickedByNomi)
  return {
    slot: Object.freeze({
      kind: 'spend' as const,
      title: asked > 0 ? t(remaining ? remainingTitleKey : asked === 1 ? singleTitleKey : titleKey, { count: asked }) : t('agentPanelV4.spendCard.titleNothing'),
      ...brake,
      ...(allKnown && !uniform
        ? {
          price: {
            perItemLabel: t('agentPanelV4.spendParamsPerItem'),
            perItem: sendable.map((entry) => ({
              label: join([entry.facts.shotRef, entry.facts.model, entry.facts.aspect, entry.facts.durationSec ? formatSeconds(entry.facts.durationSec) : null]),
              amount: entry.facts.price.known ? money(entry.facts.price.amount) : '',
            })),
          },
        }
        : {}),
      confirmLabel,
      ...(view.busy || count === 0 ? { actionsDisabled: true as const } : {}),
    }),
    pointers, single, ...(summary ? { summary } : {}), notices,
    primary: { kind: 'generate', shotIds: sendable.map((entry) => entry.shot.shotId) },
  }
}
