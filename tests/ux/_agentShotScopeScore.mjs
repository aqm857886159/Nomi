// 「Agent 接着说下一句时，付费卡只摆还没定的镜」的真模型量具：场景（8 个回合）、转录读法、硬断言判据与打分。
// 真付费走查（agent-shot-scope-real.paid.mjs）与零花费演练（agent-shot-scope-real.rehearsal.walk.mjs）共用这份；
// 本文件不起 App、不碰 Playwright、不花钱，单测（_agentShotScopeScore.test.mjs）直接喂它合成的转录和账本事实。
//
// 两类判据，分开放：
//   · 硬断言（judgeGenerateCall / judgeCardAgreement / judgeSpend）——判的是宿主和钱：不点名的卡只摆最近一张卡上还没定的镜、
//     绝不含已经送出的镜；点名的卡 = 点名的那几镜；卡上批了几镜 = 收据几笔 = 供应商几个任务。红了整条走查红。
//   · 打分（scoreTurn / summarizeTurns）——判的是模型：每回合「工具写对」「回合成功」，只记数、不判红。
// 两者读同一份观察，但互不依赖：模型点名 [镜1, 镜2, 镜3]，卡上确实摆了这三镜（硬断言绿），而打分记「工具写错」。
import { laneMessages } from './agent-lane-observer.mjs'

export const GENERATE = 'generate'
export const DRAFT_SHOTS = 'draft_shots'
/** 宿主在「不点名、卡上又没剩还没定的镜」时的拒绝正文里的固定句（electron/shared/agentCapabilities/generationShotScope.ts）。 */
export const SHOT_SCOPE_MARKER = 'call generate again with shotIds naming them'

/** 8 个回合，一场对话。ask 是用户逐字说的话（真模型和演练的夹具大脑看到的是同一句）。 */
export const TURNS = Object.freeze([
  Object.freeze({ id: 'T1', ask: '画三张图：雨后水洼里漂着的红色纸船、窗台上晒太阳的橘猫、黄昏海边的灯塔，都是 1:1。起草好就出卡，我在卡上决定生成哪张。' }),
  Object.freeze({ id: 'T2', ask: '先别管第二张，生成第三张' }),
  Object.freeze({ id: 'T3', ask: '算了先不生成' }),
  Object.freeze({ id: 'T4', ask: '先生成第一张看看' }),
  Object.freeze({ id: 'T5', ask: '剩下的也生成吧' }),
  Object.freeze({ id: 'T6', ask: '生成吧' }),
  Object.freeze({ id: 'T7', ask: '第二张改成夜景再生成' }),
  Object.freeze({ id: 'T8', ask: '加一个结尾镜头然后生成它' }),
])

/** 量具数字的定义（写进证据）。 */
export const SHOT_SCOPE_METRICS = Object.freeze({
  toolWriteCorrect: '工具写对率 = 每回合模型发出的 draft_shots / generate 调用，和该回合期望的写法一致的回合数 / 8',
  turnSuccess: '回合成功率 = 每回合最后摆在用户面前的那张卡（或没有卡），和该回合期望的结果一致的回合数 / 8',
})

// ── 小工具 ─────────────────────────────────────────────────────────────────────

/** 两组镜 id 是不是同一组（不看顺序，重复算不同）。打分里所有「写对没有」的比对都走它。 */
export function sameShots(left, right) {
  const a = [...(left ?? [])].sort()
  const b = [...(right ?? [])].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/** `shotIds` 的写法：undefined = 没点名；数组 / 单个字符串 = 点名。null 按没点名。 */
export function namedShotIds(args) {
  const raw = args?.shotIds
  if (raw === undefined || raw === null) return undefined
  return (Array.isArray(raw) ? raw : [raw]).map((value) => String(value))
}

const accepted = (call) => call.isError !== true
const refused = (call) => call.isError === true
const generatesOf = (calls) => calls.filter((call) => call.name === GENERATE)

/** 镜在整场里的身份：不同草稿（operationId）里的镜号会重复（每份草稿都有自己的 shot-1）。 */
export const shotKey = (operationId, shotId) => `${operationId}/${shotId}`

// ── 转录读法 ───────────────────────────────────────────────────────────────────

const textOf = (content) => (Array.isArray(content) ? content : [])
  .filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n')

/**
 * 盘上的 lane 转录 → 整场的工具调用序列（按出现先后）、助手落地了几次、答话的是哪个模型。
 * 一次调用在盘上有两处：助手消息里的 toolCall（模型写的原样参数）和后来的 toolResult（宿主回的话、有没有被退回）；
 * 还在等人的调用（卡开着）没有 toolResult，resultText / isError 都是 null。
 */
export function transcriptFacts(sessions) {
  const calls = []
  const byId = new Map()
  const models = new Set()
  const texts = []
  let finals = 0
  let last = null
  for (const session of sessions) {
    for (const message of laneMessages(session)) {
      if (message.role === 'assistant') {
        last = message
        models.add(`${message.provider ?? '?'}/${message.model ?? '?'}`)
        const parts = Array.isArray(message.content) ? message.content : []
        for (const part of parts) {
          if (part?.type !== 'toolCall') continue
          const call = { id: part.id, name: part.name, args: part.arguments ?? {}, resultText: null, isError: null }
          calls.push(call)
          byId.set(part.id, call)
        }
        const said = textOf(parts).trim()
        if (said) texts.push(said)
        if (!parts.some((part) => part?.type === 'toolCall') && message.stopReason && message.stopReason !== 'toolUse') finals += 1
      } else if (message.role === 'toolResult') {
        const call = byId.get(message.toolCallId)
        if (call) { call.resultText = textOf(message.content); call.isError = message.isError === true }
      }
    }
  }
  const lastHasCall = Array.isArray(last?.content) && last.content.some((part) => part?.type === 'toolCall')
  return {
    calls, finals, models: [...models],
    /** 模型说过的话（带文字的助手消息，按先后）：证据里记下每个回合它说了什么，回合没达标时看得出它在问什么 / 在拒绝里说了什么。 */
    texts,
    /** 最后一条助手消息不是停在工具调用上：这一轮说完了。 */
    settled: Boolean(last && !lastHasCall && last.stopReason && last.stopReason !== 'toolUse'),
  }
}

/** 证据里的一次调用：工具名、模型写的原样参数、有没有被退回；被退回的带宿主那句话的开头，收下的带结果的开头。 */
export function callEvidence(call) {
  return {
    id: call.id, name: call.name, args: call.args, isError: call.isError,
    ...(call.isError ? { refusalText: String(call.resultText ?? '').slice(0, 600) } : {}),
    ...(call.isError === false && call.resultText ? { resultHead: String(call.resultText).slice(0, 240) } : {}),
  }
}

/**
 * 不点名的卡上又摆了已经送出去的镜时，给协调归因用（不参与判红）：这些镜是被哪几个更早的 generate 点名重新摆上卡的。
 * 点名没有堵（设计卡的残余风险）：点名重摆一镜后，那一镜在新那张卡上又成了「还没定」，之后不点名的再出价照宿主的规则也会带上它。
 * @param {Array<{ turn: string, calls?: Array<{ id?: string, name: string, args?: any, isError?: boolean | null }> }>} turns 送出那一镜之后的各回合记录
 */
export function namedAgainBy(turns, leaked) {
  return turns.flatMap((record) => (record.calls ?? [])
    .filter((call) => call.name === GENERATE && call.isError !== true && (namedShotIds(call.args) ?? []).some((shotId) => leaked.includes(shotId)))
    .map((call) => `${record.turn}/${call.id ?? '?'}`))
}

// ── 硬断言：宿主摆什么 ─────────────────────────────────────────────────────────

/**
 * 不点名的 generate 应该摆哪几镜（按计划顺序）——宿主的规则（electron/shared/agentCapabilities/generationShotScope.ts）在量具这边的
 * 独立复述，输入是出价账的事实（走产品自己的读口 productionGenerationPresentation 算出来）：
 *   · 有最近一次出价：那一次出价上还没定、又还勾在这一批里的镜；
 *   · 从没出过价：勾着、没送过、没去掉过的镜。
 * 空数组 = 一镜不剩，宿主该拒。
 */
export function expectedUnnamedScope({ planShotIds, includedShotIds, hasOffer, undecided, standing, sent }) {
  return hasOffer
    ? planShotIds.filter((shotId) => includedShotIds.includes(shotId) && undecided.includes(shotId))
    : planShotIds.filter((shotId) => standing.includes(shotId) && !sent.includes(shotId))
}

const listOf = (shotIds) => (shotIds.length ? shotIds.join(', ') : '（空）')

/**
 * 一次 generate 的宿主表现（硬断言）。每条返回 { id, ok, detail }。
 * @param {{ call: { args?: any }, outcome: { kind: 'refused', text: string } | { kind: 'card', ledgerShotIds: string[], pointerShotIds?: string[], projectionShotIds?: string[] },
 *   expected?: string[], sent?: string[] }} input
 *   expected = 不点名时宿主该摆的镜（expectedUnnamedScope）；sent = 这份草稿里已经送出去的镜。
 */
export function judgeGenerateCall({ call, outcome, expected = [], sent = [] }) {
  const named = namedShotIds(call.args)
  const checks = []
  const shown = outcome.kind === 'card'
    ? [['账上', outcome.ledgerShotIds], ['界面', outcome.pointerShotIds], ['卡的投影', outcome.projectionShotIds]].filter(([, ids]) => Array.isArray(ids))
    : []
  if (named === undefined) {
    if (expected.length === 0) {
      const marked = outcome.kind === 'refused' && outcome.text.includes(SHOT_SCOPE_MARKER)
      checks.push({
        id: 'unnamed-nothing-left-is-refused-with-marker', ok: marked,
        detail: marked ? '一镜不剩，宿主拒了，正文带着本次的产物标记'
          : outcome.kind === 'card' ? `一镜不剩，宿主却摆了一张卡：${shown.map(([name, ids]) => `${name} ${listOf(ids)}`).join('；')}`
            : `一镜不剩，宿主拒了但正文里没有产物标记「${SHOT_SCOPE_MARKER}」：${outcome.text.slice(0, 200)}`,
      })
    } else {
      const wrong = outcome.kind !== 'card' ? [] : shown.filter(([, ids]) => !sameShots(ids, expected))
      const onlyUndecided = outcome.kind === 'card' && wrong.length === 0
      checks.push({
        id: 'unnamed-only-undecided', ok: onlyUndecided,
        detail: onlyUndecided ? `卡上只摆了最近一张卡上还没定的镜：${listOf(expected)}`
          : outcome.kind === 'refused' ? `该摆 ${listOf(expected)}，宿主却拒了：${outcome.text.slice(0, 200)}`
            : `该摆 ${listOf(expected)}，实际${wrong.map(([name, ids]) => `${name} ${listOf(ids)}`).join('；')}`,
      })
      const leaked = outcome.kind === 'card' ? [...new Set(shown.flatMap(([, ids]) => ids.filter((shotId) => sent.includes(shotId))))] : []
      checks.push({
        id: 'unnamed-never-offers-a-sent-shot', ok: leaked.length === 0, leaked,
        detail: leaked.length === 0 ? '卡上没有已经送出去的镜' : `不点名的卡上又摆了已经送出去的镜：${listOf(leaked)}（再点生成就是同一镜花第二次钱）`,
      })
    }
    return checks
  }
  if (outcome.kind === 'card') {
    const wrong = shown.filter(([, ids]) => !sameShots(ids, named))
    checks.push({
      id: 'named-equals-shown', ok: wrong.length === 0,
      detail: wrong.length === 0 ? `点名 ${listOf(named)} = 卡上摆的` : `点名 ${listOf(named)}，实际${wrong.map(([name, ids]) => `${name} ${listOf(ids)}`).join('；')}`,
    })
  }
  return checks
}

/**
 * 一张卡上读到的镜要一致：界面上指着的节点、卡的投影（宿主推给面板的那一份）、出价账；
 * 给了 pointerNodeIds / storeNodeIds 时再对一遍节点本身：界面指向的节点 = 画布上这几镜自己的节点（读画布 store，不经卡的投影）。
 */
export function judgeCardAgreement({ ledgerShotIds, pointerShotIds, projectionShotIds, pointerNodeIds, storeNodeIds }) {
  const shotsOk = sameShots(ledgerShotIds, projectionShotIds) && sameShots(ledgerShotIds, pointerShotIds)
  const nodesChecked = Array.isArray(pointerNodeIds) && Array.isArray(storeNodeIds)
  const nodesOk = !nodesChecked || sameShots(pointerNodeIds, storeNodeIds)
  const ok = shotsOk && nodesOk
  return {
    id: 'card-ui-equals-host', ok,
    detail: ok ? `界面 = 投影 = 账${nodesChecked ? ' = 画布上这几镜的节点' : ''}：${listOf(ledgerShotIds)}`
      : `账 ${listOf(ledgerShotIds)}；卡的投影 ${listOf(projectionShotIds)}；界面指着 ${listOf(pointerShotIds)}`
        + `${nodesChecked ? `；界面指向的节点 ${listOf(pointerNodeIds)}，画布上这几镜自己的节点 ${listOf(storeNodeIds)}` : ''}`,
  }
}

// ── 硬断言：钱 ─────────────────────────────────────────────────────────────────

/**
 * 网络闸账本（NOMI_WALK_NET_BODIES=1 时写的 allowed-request）→ 发往供应商的图片创建请求数。
 * recorderAlive：这个 host 上有没有记到过任何放行请求——一条都没有，说明记录器没生效，创建数 0 不能当「没发」。
 */
export function countVendorImageCreates(entries, { host }) {
  const toThisHost = entries.filter((entry) => entry?.kind === 'allowed-request' && entry.host === host)
  const creates = toThisHost.filter((entry) => entry.method === 'POST' && /\/images\/generations$/.test(pathOf(entry.url)))
  return { creates: creates.length, recorderAlive: toThisHost.length > 0 }
}

function pathOf(url) {
  try { return new URL(url).pathname } catch { return String(url ?? '') }
}

/**
 * 「供应商几个任务」：网络闸 / 夹具里记到的图片创建请求数，和供应商给的任务号数，取大的。
 * 记录器漏记创建请求时任务号兜底（不会少数）；多发的创建请求即便被供应商拒了也算（没有任务号，但那是又发了一次）。
 */
export function vendorTaskCount({ wireCreates, providerTaskIds }) {
  return Math.max(wireCreates, providerTaskIds.length)
}

/**
 * 花钱对账（硬断言）：卡上批了几镜 = 收据几笔 = 供应商几个任务 = expected；之后一直不再涨。
 * hold = { seconds, vendor: number[], receipt: number[] }：T8 之后等的那一段里，每次取样看到的数。
 */
export function judgeSpend({ approved, receiptMedia, vendorTasks, providerTaskIds, hold, expected = 1 }) {
  const equals = (id, label, actual) => ({ id, ok: actual === expected, detail: `${label} ${actual}（应为 ${expected}）` })
  const steady = (series) => series.every((value) => value === expected)
  return [
    equals('spend-card-approved', '卡上批了', approved),
    equals('spend-receipt', '收据', receiptMedia),
    equals('spend-vendor-tasks', '供应商任务', vendorTasks),
    equals('spend-provider-task-ids', '供应商给的任务号', providerTaskIds.length),
    {
      id: 'spend-hold-stays-flat', ok: hold.vendor.length > 0 && steady(hold.vendor) && steady(hold.receipt),
      detail: `之后又等了 ${hold.seconds} 秒、取样 ${hold.vendor.length} 次：供应商任务 ${listOf([...new Set(hold.vendor)].map(String))}，收据 ${listOf([...new Set(hold.receipt)].map(String))}（应一直是 ${expected}）`,
    },
  ]
}

const IMAGE_COUNT_KEYS = ['n', 'num_images', 'numImages', 'batch_size', 'image_count', 'imageCount']

/**
 * 点那一下真花钱的按钮之前的核对（一分钱没花前拦住）：卡上要生效的只有一镜；那一镜是被授权的那个图片模型，
 * 不要多张出图、不要 1K 以上的清晰度。
 * effectiveShotIds = 去掉「不生成 ×」之后卡上还剩的镜；candidate = 草稿里那一镜的候选（宿主会派发的那份）的 { providerId, modelId }；
 * meta = 那个节点此刻的参数（卡读节点，派发也按节点）；authorized = 被授权的 { vendorKey, modelKey }（不给就不核模型）。
 */
export function spendGateProblems({ effectiveShotIds, candidate = {}, candidateParams = {}, meta = {}, authorized }) {
  const problems = []
  if (effectiveShotIds.length !== 1) problems.push(`卡上要生效的是 ${effectiveShotIds.length} 镜（${listOf(effectiveShotIds)}），只许一镜`)
  if (authorized) {
    if (candidate.providerId !== authorized.vendorKey || candidate.modelId !== authorized.modelKey) {
      problems.push(`草稿里那一镜的模型是 ${candidate.providerId}/${candidate.modelId}，只授权 ${authorized.vendorKey}/${authorized.modelKey}`)
    }
    if (meta.modelKey !== undefined && (meta.modelKey !== authorized.modelKey || (meta.modelVendor !== undefined && meta.modelVendor !== authorized.vendorKey))) {
      problems.push(`节点上那一镜的模型是 ${meta.modelVendor}/${meta.modelKey}，只授权 ${authorized.vendorKey}/${authorized.modelKey}`)
    }
  }
  for (const source of [candidateParams, meta]) {
    for (const key of IMAGE_COUNT_KEYS) {
      const value = Number(source?.[key])
      if (Number.isFinite(value) && value > 1) problems.push(`参数 ${key}=${source[key]}，一镜不止出一张`)
    }
    const resolution = source?.resolution
    if (typeof resolution === 'string' && resolution.trim() && !/^1k$/i.test(resolution.trim())) problems.push(`清晰度 ${resolution}，只授权 1K`)
  }
  return problems
}

// ── 打分：模型写得对不对 ────────────────────────────────────────────────────────

/**
 * 每回合的期望（量具表）和打分。observed 由走查从盘上转录和界面读出来：
 *   calls            这一回合新出现的工具调用（按先后，含被退回的）
 *   card             回合停下时摆在用户面前的那张卡 { operationId, shotIds }（没有 = null）
 *   primary          { operationId, shotIds }——T1 起草的那份草稿和它的三镜
 *   prompts          { 'operationId/shotId': 节点上此刻的提示词 }
 *   newShots         这一回合新出现的镜 [{ operationId, shotId }]（T8 用）
 * 返回 { toolWriteCorrect, turnSuccess, route, why }；why 是没达标的原因，写进证据。
 */
export function scoreTurn(turnId, observed) {
  const judge = JUDGES[turnId]
  if (!judge) throw new Error(`没有这个回合：${turnId}`)
  const why = []
  const result = judge(observed, why)
  return { toolWriteCorrect: result.toolWriteCorrect, turnSuccess: result.turnSuccess, route: result.route ?? null, why }
}

const ordinal = (observed, index) => observed.primary.shotIds[index]
const onPrimary = (observed, call) => call.args?.operationId === observed.primary.operationId
const cardIs = (observed, operationId, shotIds) => Boolean(observed.card) && observed.card.operationId === operationId && sameShots(observed.card.shotIds, shotIds)

/** 只有一次 generate、点名恰好是 shotIds、且这份草稿就是 T1 起草的那份。 */
function onlyGenerateNamed(observed, shotIds, why) {
  const calls = generatesOf(observed.calls)
  if (calls.length !== 1) { why.push(`generate 调了 ${calls.length} 次（应 1 次）`); return false }
  const [call] = calls
  const named = namedShotIds(call.args)
  if (!accepted(call)) { why.push('generate 被宿主退回'); return false }
  if (!onPrimary(observed, call)) { why.push('generate 指的不是 T1 起草的那份草稿'); return false }
  if (named === undefined) { why.push('没点名（应点名）'); return false }
  if (!sameShots(named, shotIds)) { why.push(`点名 ${listOf(named)}（应为 ${listOf(shotIds)}）`); return false }
  return true
}

const JUDGES = {
  T1(observed, why) {
    const drafts = observed.calls.filter((call) => call.name === DRAFT_SHOTS && accepted(call) && call.args?.operationId === undefined)
    const draftedThree = drafts.length === 1 && Array.isArray(drafts[0].args?.shots) && drafts[0].args.shots.length === 3
    if (!draftedThree) why.push(`起草了 ${drafts.length} 份、第一份 ${drafts[0]?.args?.shots?.length ?? 0} 镜（应 1 份 3 镜）`)
    const calls = generatesOf(observed.calls)
    const [call] = calls
    const named = call ? namedShotIds(call.args) : undefined
    const generated = calls.length === 1 && accepted(call) && observed.calls.indexOf(call) > observed.calls.indexOf(drafts[0])
      && (named === undefined || sameShots(named, observed.primary.shotIds))
    if (!generated) why.push(`generate 调了 ${calls.length} 次、点名 ${named ? listOf(named) : '无'}（应在起草之后调 1 次，不点名或点名这三镜）`)
    const success = Boolean(observed.card) && observed.card.shotIds.length === 3 && cardIs(observed, observed.primary.operationId, observed.primary.shotIds)
    if (!success) why.push(`卡上摆了 ${observed.card ? listOf(observed.card.shotIds) : '无'}（应为这三镜）`)
    return { toolWriteCorrect: draftedThree && generated, turnSuccess: success }
  },
  T2(observed, why) {
    const wanted = [ordinal(observed, 2)]
    const success = cardIs(observed, observed.primary.operationId, wanted)
    if (!success) why.push(`卡上摆了 ${observed.card ? listOf(observed.card.shotIds) : '无'}（应只有 ${listOf(wanted)}）`)
    return { toolWriteCorrect: onlyGenerateNamed(observed, wanted, why), turnSuccess: success }
  },
  T3(observed, why) {
    const calls = generatesOf(observed.calls)
    if (calls.length) why.push(`调了 ${calls.length} 次 generate（应不调）`)
    if (observed.card) why.push(`出了一张新卡：${listOf(observed.card.shotIds)}`)
    return { toolWriteCorrect: calls.length === 0, turnSuccess: !observed.card }
  },
  T4(observed, why) {
    const wanted = [ordinal(observed, 0)]
    const success = cardIs(observed, observed.primary.operationId, wanted)
    if (!success) why.push(`卡上摆了 ${observed.card ? listOf(observed.card.shotIds) : '无'}（应只有 ${listOf(wanted)}）`)
    return { toolWriteCorrect: onlyGenerateNamed(observed, wanted, why), turnSuccess: success }
  },
  T5(observed, why) {
    const wanted = [ordinal(observed, 1), ordinal(observed, 2)]
    const calls = generatesOf(observed.calls)
    const namedOf = (call) => namedShotIds(call.args)
    const right = (call) => accepted(call) && onPrimary(observed, call) && namedOf(call) !== undefined && sameShots(namedOf(call), wanted)
    let route = 'other'
    if (calls.length === 1 && right(calls[0])) route = 'direct-named'
    else if (calls.length === 2 && refused(calls[0]) && namedOf(calls[0]) === undefined && right(calls[1])) route = 'refused-then-named'
    if (route === 'other') why.push(`generate 的写法不是「直接点名 ${listOf(wanted)}」或「先不点名被拒、再点名 ${listOf(wanted)}」：${calls.map((call) => `${accepted(call) ? '收下' : '被拒'}·${namedOf(call) ? listOf(namedOf(call)) : '不点名'}`).join(' → ') || '没调'}`)
    const success = cardIs(observed, observed.primary.operationId, wanted)
    if (!success) why.push(`卡上摆了 ${observed.card ? listOf(observed.card.shotIds) : '无'}（应为 ${listOf(wanted)}，不含 ${ordinal(observed, 0)}）`)
    return { toolWriteCorrect: route !== 'other', turnSuccess: success, route }
  },
  T6(observed, why) {
    const wanted = [ordinal(observed, 1), ordinal(observed, 2)]
    const calls = generatesOf(observed.calls)
    const [call] = calls
    const named = call ? namedShotIds(call.args) : undefined
    const right = calls.length === 1 && accepted(call) && onPrimary(observed, call) && (named === undefined || sameShots(named, wanted))
    if (!right) why.push(`generate 调了 ${calls.length} 次、点名 ${named ? listOf(named) : '无'}（应 1 次，不点名或点名 ${listOf(wanted)}）`)
    const success = cardIs(observed, observed.primary.operationId, wanted)
    if (!success) why.push(`卡上摆了 ${observed.card ? listOf(observed.card.shotIds) : '无'}（应为 ${listOf(wanted)}，不含 ${ordinal(observed, 0)}）`)
    return { toolWriteCorrect: right, turnSuccess: success }
  },
  T7(observed, why) {
    const second = ordinal(observed, 1)
    const revise = observed.calls.find((call) => call.name === DRAFT_SHOTS && accepted(call) && onPrimary(observed, call)
      && Array.isArray(call.args?.shots) && call.args.shots.length === 1 && call.args.shots[0]?.shotId === second
      && typeof call.args.shots[0]?.prompt === 'string' && call.args.shots[0].prompt.trim())
    if (!revise) why.push(`没有对 ${second} 做「改提示词」的 draft_shots（operationId + shotId + prompt）`)
    const calls = generatesOf(observed.calls)
    const generated = onlyGenerateNamed(observed, [second], why)
    const order = Boolean(revise) && calls.length === 1 && observed.calls.indexOf(revise) < observed.calls.indexOf(calls[0])
    if (revise && generated && !order) why.push('generate 在改提示词之前')
    const prompt = observed.prompts?.[shotKey(observed.primary.operationId, second)] ?? ''
    const night = /夜|night/i.test(prompt)
    if (!night) why.push(`${second} 节点上的提示词里没有「夜」或 night：${prompt.slice(0, 80)}`)
    const success = cardIs(observed, observed.primary.operationId, [second]) && night
    if (!cardIs(observed, observed.primary.operationId, [second])) why.push(`卡上摆了 ${observed.card ? listOf(observed.card.shotIds) : '无'}（应只有 ${second}）`)
    return { toolWriteCorrect: Boolean(revise) && generated && order, turnSuccess: success }
  },
  T8(observed, why) {
    // 画布草稿没有「往同一份里补镜头」这条路（宿主拒：start a new draft without operationId），所以「新的一镜」通常是另一份草稿里的 shot-1。
    const fresh = observed.newShots ?? []
    const only = fresh.length === 1 ? fresh[0] : null
    if (!only) why.push(`这一回合新出现的镜有 ${fresh.length} 个（应恰好 1 个）`)
    const drafted = observed.calls.filter((call) => call.name === DRAFT_SHOTS && accepted(call))
    const draftedOne = drafted.length === 1 && Array.isArray(drafted[0].args?.shots) && drafted[0].args.shots.length === 1
      && typeof drafted[0].args.shots[0]?.prompt === 'string' && drafted[0].args.shots[0].prompt.trim() !== ''
    if (!draftedOne) why.push(`成功的 draft_shots 有 ${drafted.length} 次（应 1 次、1 镜、带提示词）`)
    const calls = generatesOf(observed.calls)
    const [call] = calls
    const named = call ? namedShotIds(call.args) : undefined
    const targetsNew = Boolean(only) && calls.length === 1 && accepted(call) && call.args?.operationId === only.operationId
      && (named === undefined ? only.operationId !== observed.primary.operationId : sameShots(named, [only.shotId]))
    if (!targetsNew) why.push(`generate 调了 ${calls.length} 次、点名 ${named ? listOf(named) : '无'}（应在新那一镜上调 1 次，点名它）`)
    const order = draftedOne && calls.length === 1 && observed.calls.indexOf(drafted[0]) < observed.calls.indexOf(calls[0])
    if (draftedOne && targetsNew && !order) why.push('generate 在起草之前')
    const success = Boolean(only) && cardIs(observed, only.operationId, [only.shotId])
    if (!success) why.push(`卡上摆了 ${observed.card ? `${observed.card.operationId}/${listOf(observed.card.shotIds)}` : '无'}（应只有新那一镜）`)
    return { toolWriteCorrect: draftedOne && targetsNew && order, turnSuccess: success }
  },
}

/** 汇总：x/8、y/8，和 T5 走的是哪条路。 */
export function summarizeTurns(records) {
  const total = records.length
  const count = (predicate) => records.filter(predicate).length
  return {
    turns: total,
    toolWriteCorrect: `${count((record) => record.score?.toolWriteCorrect)}/${total}`,
    turnSuccess: `${count((record) => record.score?.turnSuccess)}/${total}`,
    t5Route: records.find((record) => record.turn === 'T5')?.score?.route ?? null,
    harnessErrors: count((record) => record.harnessError),
  }
}

/** 量具自己的问题（不是模型的）：哪一回合量具出了错 / 没落地、答话的不是被授权的模型。空 = 这一场的数可以用。 */
export function gaugeProblems(records, { models, expectedModelKey }) {
  const problems = []
  for (const record of records) {
    if (record.harnessError) problems.push(`${record.turn} 量具出错：${record.harnessError}`)
    if (record.settle === 'timeout') problems.push(`${record.turn} 超时没落地（已按停止）`)
    if (record.settle === 'error' || record.settle === 'intervention') problems.push(`${record.turn} 面板报错或冒出了要人答的卡（没替用户答）`)
  }
  const foreign = models.filter((model) => !model.endsWith(`/${expectedModelKey}`))
  if (foreign.length) problems.push(`答话的模型不是 ${expectedModelKey}：${foreign.join('、')}`)
  return problems
}
