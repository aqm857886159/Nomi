// 付费确认的**纯投影**（D2 第③步起；2026-11-15 拆开）：宿主给的那一次出价 + 每一镜节点此刻的事实 → 两处要画的一切。
//
// 确认只问一件事：花不花。2026-11-15 起拆成两处（设计卡 docs/plan/2026-11-15-spend-ask-split.md）：
//   · 对话里那一组（`pointers`）：这一批镜头一行一个，挂在 Agent 那一条生成记录下面，点了去节点；哪一镜有话要说
//     （参数和这一批的共同值不同、已去掉、失败原因、状态）就写在它自己那一行第二行；
//   · 输入框上方那一条确认（`slot` + `summary` + `notices`）：这一批的共同参数一行 + 「取消」/「生成 N 段」，不画标题问话、不画镜头。
// 参数、提示词、参考只住在画布节点上，每一个字都读节点此刻的样子（`SpendCardShotFacts` 由宿主钩子从节点现读）；想改点那一行去节点里改（设计系统 §1.0）。
//
// 为什么单独一层：这是**钱**的确认，每一句话（几段、哪一镜没发出去、为什么、下一步）都必须能追到产地。住在组件里只能靠
// 截图证明，住在这里能逐条单测。三种样子只由事实决定：
//   · 有镜正在交给画布（`handing_over`）→ 「正在发出 k/N 段」，动作行只说怎么停；
//   · 有镜没发出去 / 结果不确定，或者一段能发的都没有、却有本机判得出发不出去的 → 确认条说「镜 N 没有发出去」+「先不发了 / 再试一次」，原因只写在那一镜自己那一行（2026-11-16 起条上不重复）；
//   · 其余 → 等人决定：「生成」/「生成 N 段」/「生成剩下 N 段」。
// 钱：这一刀不印合计——确认条按钮那一行左侧留给预估花费（按 11-07 模型面板板 cost.batch-card 印积分，下一刀做）；
// 只有各镜价格不同时折叠明细里印每镜价（板 D5，照旧）。
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
  /** 失败态里还未发出的那一镜，本次出价的状态词。 */
  hostStatus?: string
  /** 这一镜为什么没发出去 / 发不出去 / 待核对（那一行第二行印它，读屏也念）。 */
  outcome?: string
  /** 行尾那颗小钮：「不生成 ×」（还没决定的，悬停 / 聚焦才露）/「恢复」（去掉了的，常驻）/ 没有。 */
  exclusion: 'exclude' | 'restore' | null
  /** 这一镜和这一批共同值不一样的那几项（「9:16 · 5s」）；都一样时缺席——每行都一样的事只在确认条上说一次。 */
  note?: string
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
  /** 对话里那一组：这一次出价的每一镜，一行一个（按计划顺序）。 */
  pointers: readonly SpendCardPointer[]
  /** 确认条第一行：这一批要交的那几镜都一样的参数（模型 · 比例 · 清晰度 · 时长）。只在等人决定时有。 */
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

/**
 * 参数那一行的拼法（SpendAskSplit 板 ask.params「Seedance 2（Nomi 选的）· 16:9」）：前一段以全角右括号收尾时，
 * 括号自带的留白已经够了，分隔点前不再加空格，否则读成「）  · 」一段空隙。
 */
const joinParams = (parts: ReadonlyArray<string | null | undefined | false>): string =>
  parts.filter((part): part is string => Boolean(part)).reduce((line, part) => (line ? `${line}${line.endsWith('）') ? '· ' : ' · '}${part}` : part), '')

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)]
}

type Dimension = 'model' | 'aspect' | 'resolution' | 'duration'
const DIMENSIONS: readonly Dimension[] = ['model', 'aspect', 'resolution', 'duration']

const dimensionValue = (fact: SpendCardShotFacts, dimension: Dimension): string =>
  dimension === 'duration' ? (fact.durationSec ? String(fact.durationSec) : '') : (fact[dimension] ?? '')

/** 这一批里哪几项逐镜不同（只看要交的那几镜）。 */
function differingDimensions(facts: readonly SpendCardShotFacts[]): ReadonlySet<Dimension> {
  return new Set(DIMENSIONS.filter((dimension) => distinct(facts.map((fact) => dimensionValue(fact, dimension))).length > 1))
}

const modelText = (model: string, pickedByNomi: boolean, t: Translate): string => (model && pickedByNomi
  ? t('agentPanelV4.spendCard.summaryPickedModel', { model, picked: t('agentPanelV4.spendParamsModelPicked') })
  : model)

/**
 * 确认条第一行（板 2026-11-15 ask.params）：这一批都一样的那几项——模型（Nomi 选的）· 比例 · 清晰度 · 时长；
 * 逐镜不同的那一项不写在这里（它回到各自那一行第二行，见 `spendCardShotNote`），不拆成「×2 · ×1」。
 * 时长说的是每一段多长（多段时「每段 8s」），不加总：加总不是哪一镜的参数。
 */
export function spendCardCommonParams(facts: readonly SpendCardShotFacts[], t: Translate, pickedByNomi = false): string | undefined {
  const first = facts[0]
  if (!first) return undefined
  const differing = differingDimensions(facts)
  const keep = (dimension: Dimension): boolean => !differing.has(dimension)
  const seconds = keep('duration') && first.durationSec ? formatSeconds(first.durationSec) : null
  const line = joinParams([
    keep('model') ? modelText(first.model, pickedByNomi, t) : null,
    keep('aspect') ? first.aspect : null,
    keep('resolution') ? first.resolution : null,
    seconds ? (facts.length > 1 ? t('agentPanelV4.spendCard.perShotSeconds', { value: seconds }) : seconds) : null,
  ])
  return line || undefined
}

/** 这一镜那一行第二行：和这一批共同值不一样的那几项（只写这一镜自己的值）；都一样就没有。 */
function spendCardShotNote(fact: SpendCardShotFacts, differing: ReadonlySet<Dimension>, t: Translate, pickedByNomi = false): string | undefined {
  const line = joinParams([
    differing.has('model') ? modelText(fact.model, pickedByNomi, t) : null,
    differing.has('aspect') ? (fact.aspect ?? t('agentPanelV4.spendCard.summaryAuto')) : null,
    differing.has('resolution') ? fact.resolution : null,
    differing.has('duration') && fact.durationSec ? formatSeconds(fact.durationSec) : null,
  ])
  return line || undefined
}

/** 失败时条上那一段：标题、主按钮（原因写在没成的那一行，条上不重复）。 */
function attentionView(attention: Entry, entries: readonly Entry[], view: SpendCardView, t: Translate): Readonly<{ title: string; primary: SpendCardPrimary; confirmLabel: string }> {
  const shot = attention.facts.shotRef
  const locate = (label: string): SpendCardPrimary => ({ kind: 'locate', nodeId: attention.shot.nodeId ?? '', label })
  if (attention.role === 'unclear') {
    // 结果未知：可能已经扣费，不说没花钱；下一步是去节点上核对，不是再发一次（钱可能已经花了）。
    return { title: t('agentPanelV4.spendCard.failedTitle.unclear', { shot }), primary: locate(shot), confirmLabel: t('agentPanelV4.spendCard.goCheck', { shot }) }
  }
  const failure: GenerationHandOverFailure = (attention.role === 'blocked' ? attention.facts.blocked : attention.shot.failure) ?? { kind: 'not_sent', code: 'not_sent' }
  if (attention.role === 'blocked') {
    // 还没按就判得出发不出去：参数那一类去节点里改，节点在忙 / 要核对那一类去节点上看。
    const label = failure.kind === 'parameter_rejected' ? t('agentPanelV4.spendCard.goEdit', { shot }) : t('agentPanelV4.spendCard.goCheck', { shot })
    return { title: t('agentPanelV4.spendCard.failedTitle.blocked', { shot }), primary: locate(shot), confirmLabel: label }
  }
  if (failure.kind === 'parameter_rejected') {
    return { title: t('agentPanelV4.spendCard.failedTitle.rejected', { shot }), primary: locate(shot), confirmLabel: t('agentPanelV4.spendCard.goEdit', { shot }) }
  }
  // 没发出去（没花钱）：「再试一次」只重发没发出去的那几镜（不连带还没决定的）。
  const retry = entries.filter((entry) => entry.role === 'notSent' && entry.shot.failure?.kind !== 'parameter_rejected')
  return {
    title: t('agentPanelV4.spendCard.failedTitle.notSent', { shot }),
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
  // 逐镜不同的那几项只看主按钮这一下要交的那几镜（和确认条上的共同参数同一个集合）。
  const differing = differingDimensions(sendable.map((entry) => entry.facts))
  // 失败时的确认条：没发出去 / 结果不确定的那一镜；一段能发的都没有时，本机判得出发不出去的那一镜也是（有能发的时它只占一行说明）。
  const attention = sending ? undefined : entries.find((entry) => entry.role === 'notSent' || entry.role === 'unclear' || (entry.role === 'blocked' && sendable.length === 0))
  const saysVideo = spendCardSaysVideo(sendable.length ? sendable.map((entry) => entry.shot) : entries.map((entry) => entry.shot))
  const brake = pending.brake ? { summary: t(BRAKE_COPY[pending.brake.reason]) } : {}
  // 那一行第二行的原因（和确认条上那一句同一个产地）：没发出去 / 参数被拒 / 现在发不出去 / 待核对。
  const outcomeOf = (entry: Entry): string | undefined => {
    if (entry.role === 'unclear') return t('agentPanelV4.spendCard.failure.unclear')
    if (entry.role === 'notSent') return t(handOverFailureCopy(entry.shot.failure ?? { kind: 'not_sent', code: 'not_sent' }))
    if (entry.role === 'blocked' && entry.facts.blocked) return t(handOverFailureCopy(entry.facts.blocked))
    return undefined
  }

  const pointers: SpendCardPointer[] = entries.map((entry) => {
    const outcome = outcomeOf(entry)
    const note = differing.size && entry.role === 'sendable' ? spendCardShotNote(entry.facts, differing, t, pickedByNomi) : undefined
    return {
      shotId: entry.shot.shotId,
      nodeId: entry.shot.nodeId ?? '',
      shotRef: entry.facts.shotRef,
      removed: entry.role === 'deleted',
      ...(entry.role === 'blocked' ? { hostFailure: t('agentPanelV4.spendCard.pointerCannotSend') }
        : entry.role === 'notSent' ? { hostFailure: t('agentPanelV4.spendCard.pointerFailed') }
          : entry.role === 'unclear' ? { hostFailure: t('agentPanelV4.spendCard.pointerUnclear') } : {}),
      ...(outcome ? { outcome } : {}),
      ...(attention && (entry.role === 'sendable' || entry.role === 'blocked') ? { hostStatus: t('agentPanelV4.spendCard.pointerNotSentYet') } : {}),
      // 「不生成 ×」只在多段、还没在交的时候（只有一段时「不生成」就是「取消」）；去掉了的那一镜常驻「恢复」。
      exclusion: single || sending ? null
        : entry.role === 'sendable' || entry.role === 'blocked' ? 'exclude'
          : entry.role === 'excluded' ? 'restore' : null,
      ...(note ? { note } : {}),
    }
  })

  if (sending) {
    // 交给画布之后还有镜在交：确认条只剩一行「正在发出 k/N 段」+「取消」（板 2026-11-15 ask.sending），不画标题。
    // k = 已经落定的 + 正在交的这一段。
    const inFlight = pick('sending', 'sent', 'unclear', 'notSent')
    const settled = inFlight.filter((entry) => entry.role !== 'sending').length
    const total = inFlight.length
    const progressKey = saysVideo ? 'agentPanelV4.spendBatchProgressVideo' : 'agentPanelV4.spendBatchProgressImage'
    return {
      slot: Object.freeze({
        kind: 'spend' as const,
        title: '',
        ...brake,
        progress: { hint: view.stopping ? t('agentPanelV4.spendBatchStopping') : t(progressKey, { current: Math.min(total, settled + 1), total }) },
      }),
      pointers, notices: [], primary: { kind: 'none' },
    }
  }

  if (attention) {
    const shown = attentionView(attention, entries, view, t)
    const retryEmpty = shown.primary.kind === 'retry' && shown.primary.shotIds.length === 0
    // 原因只说一遍（用户 2026-11-16）：写在没成的那一行第二行（`outcome`），条上只留标题和两颗按钮，不再摆一行红字原因。
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
      pointers,
      notices: [],
      primary: shown.primary,
    }
  }

  // 等人决定。N = 主按钮这一下会交出去的段数（去掉的、被删的、节点上已经点过 ↑ 的、本机判得出发不出去的都不算）。
  const count = sendable.length
  const asked = count + pick('blocked', 'absent').filter((entry) => entry.shot.offer === 'undecided').length
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
  const summary = spendCardCommonParams(sendable.map((entry) => entry.facts), t, pickedByNomi)
  return {
    slot: Object.freeze({
      kind: 'spend' as const,
      spendConfirmationId: pending.quoteId,
      // 等人决定时不画标题问话（板 2026-11-15 ask.title）：按钮已经说了要做什么、几段。一段都不剩要交的才说那一句（现行「没有要生成的了」）。
      title: asked > 0 ? '' : t('agentPanelV4.spendCard.titleNothing'),
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
    pointers, ...(summary ? { summary } : {}), notices,
    primary: { kind: 'generate', shotIds: sendable.map((entry) => entry.shot.shotId) },
  }
}
