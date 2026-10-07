// Intake Radar —— 汇总算法层。纯函数，不摸网络、不摸文件系统、不调 LLM。
//
// 分工边界（与 feedback-radar.mjs / model-radar.ts 同一条线）：这里只做「数得清楚的事」——
// 分组、计数、比例、与上一窗口比大小。「这个突增值不值得告诉用户」「这条反馈该归成真 bug
// 还是配置问题」是 `agent-skills/nomi-intake-radar/SKILL.md` 里 agent 的活，不在这层判断。

/** 取 ISO 时间戳的日期部分。事件的 timestamp 本来就只有日粒度（反指纹设计，
 *  见 electron/telemetry/telemetryEvents.ts 的 buildTelemetryEnvelope），反馈的 receivedAt
 *  有完整精度，这里统一截到「日」，保证两种记录能在同一张按日分组的表里对齐。 */
export function dayOf(isoString) {
  return String(isoString || '').slice(0, 10)
}

// ---------------------------------------------------------------------------
// 反馈：逐条列出
// ---------------------------------------------------------------------------

/**
 * 一条 R2 反馈记录（`{receivedAt, receipt, ref, payload:{manifest,context}}`）→
 * 报告要的那几格：日期、编号、版本、系统、界面、错误码、供应商/模型、摘要、用户留言。
 * 字段任何一个缺失都不抛——反馈的 schema 会随版本演进，读不到就给 'unknown'/null，
 * 由 dataQuality 那条线索另外记一笔「这条对不上预期形状」，不是让整条雷达崩掉。
 */
export function extractFeedbackItem(key, wrapped) {
  const payload = wrapped?.payload ?? {}
  const manifest = payload.manifest ?? {}
  const context = payload.context ?? {}
  return {
    key,
    date: dayOf(wrapped?.receivedAt),
    id: wrapped?.receipt || wrapped?.ref || key,
    version: manifest.app?.version ?? 'unknown',
    system: manifest.system?.platform ?? 'unknown',
    locale: manifest.system?.locale ?? 'unknown',
    surface: context.surface ?? 'unknown',
    errorCode: typeof context.errorCode === 'string' ? context.errorCode : null,
    provider: context.provider ?? null,
    model: context.model ?? null,
    summary: typeof context.summary === 'string' ? context.summary : '',
    note: typeof context.note === 'string' ? context.note : null,
  }
}

/** 一批反馈记录 → 逐条提取，按日期新到旧排（同日按 key 稳定排序，保证输出确定性可测）。 */
export function buildFeedbackItems(feedbackRecords) {
  return feedbackRecords
    .map(({ key, record }) => extractFeedbackItem(key, record))
    .sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : b.date.localeCompare(a.date)))
}

// ---------------------------------------------------------------------------
// 事件：拍平
// ---------------------------------------------------------------------------

/** R2 上 `/v1/events` 记录的 payload 是 `{events: TelemetryEnvelope[]}`（一次上报可能攒了
 *  好几条）——拍平成一条条独立事件，贴上来源 key 方便追查。跳过形状不对的条目而不是抛，
 *  一条坏事件不该拖垮整批事件的聚合。 */
export function flattenEvents(eventRecords) {
  const out = []
  for (const { key, record } of eventRecords) {
    const events = record?.payload?.events
    if (!Array.isArray(events)) continue
    for (const evt of events) {
      if (!evt || typeof evt !== 'object' || typeof evt.eventName !== 'string') continue
      out.push({ sourceKey: key, ...evt, date: dayOf(evt.timestamp) })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 自动化事件：默认不进任何统计
// ---------------------------------------------------------------------------

/** 事件的 systemProps.automated === true 表示它来自测试 / 走查启动的进程
 *  （electron/telemetry/telemetryEvents.ts 的 isAutomatedLaunch，以「谁启动的」为准）。 */
export function isAutomatedEvent(evt) {
  return evt?.systemProps?.automated === true
}

/** 拆成「真实用户事件」与「被排除的自动化事件」，并单独数出被排除了多少、都是什么事件。 */
export function splitAutomatedEvents(events) {
  const real = []
  const automated = []
  for (const evt of events) (isAutomatedEvent(evt) ? automated : real).push(evt)
  const byEvent = new Map()
  for (const evt of automated) byEvent.set(evt.eventName, (byEvent.get(evt.eventName) ?? 0) + 1)
  return {
    real,
    excluded: {
      count: automated.length,
      byEvent: [...byEvent.entries()].map(([eventName, count]) => ({ eventName, count })).sort((a, b) => b.count - a.count || a.eventName.localeCompare(b.eventName)),
    },
  }
}

// ---------------------------------------------------------------------------
// 生成失败原因排行（props.errorType 是类别码；老版本的失败事件没有这一格，单独记一类）
// ---------------------------------------------------------------------------

export const UNREPORTED_FAILURE_REASON = '（旧版本未上报）'

export function rankFailureReasons(events) {
  const counts = new Map()
  let total = 0
  for (const evt of events) {
    if (evt.eventName !== 'generation.completed' || evt.props?.result !== 'failure') continue
    const reason = typeof evt.props?.errorType === 'string' && evt.props.errorType ? evt.props.errorType : UNREPORTED_FAILURE_REASON
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
    total += 1
  }
  return {
    total,
    ranking: [...counts.entries()]
      .map(([reason, count]) => ({ reason, count, share: total > 0 ? Math.round((count / total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.count - a.count || (a.reason === UNREPORTED_FAILURE_REASON) - (b.reason === UNREPORTED_FAILURE_REASON) || a.reason.localeCompare(b.reason)),
  }
}

// ---------------------------------------------------------------------------
// 生成结果：按能力 / 版本 / 系统 / 日期
// ---------------------------------------------------------------------------

const RESULT_KEYS = ['success', 'failure', 'cancel']

function emptyCounts() {
  return { success: 0, failure: 0, cancel: 0, total: 0 }
}

function addResult(counts, result) {
  if (RESULT_KEYS.includes(result)) counts[result] += 1
  counts.total += 1
}

function withRates(counts) {
  const rate = (n) => (counts.total > 0 ? Math.round((n / counts.total) * 1000) / 10 : 0) // 一位小数的百分比
  return { ...counts, successRate: rate(counts.success), failureRate: rate(counts.failure), cancelRate: rate(counts.cancel) }
}

/**
 * 生成结果按能力 × 版本 × 系统 × 日期分组统计。
 *
 * 「版本」只能是 `appMajor.appMinor`——事件的 systemProps 里没有补丁号（telemetryEvents.ts
 * 就没收这一格），报告里必须诚实标出这一点粒度限制，不能默默当成完整 semver。
 */
export function groupGenerationResults(events) {
  const groups = new Map()
  for (const evt of events) {
    if (evt.eventName !== 'generation.completed') continue
    const capability = evt.props?.capability ?? 'unknown'
    const result = evt.props?.result ?? 'unknown'
    const osFamily = evt.systemProps?.osFamily ?? 'unknown'
    const appVersion = Number.isInteger(evt.systemProps?.appMajor) && Number.isInteger(evt.systemProps?.appMinor)
      ? `${evt.systemProps.appMajor}.${evt.systemProps.appMinor}`
      : 'unknown'
    const date = evt.date
    const key = `${capability}|${appVersion}|${osFamily}|${date}`
    if (!groups.has(key)) groups.set(key, { capability, appVersion, osFamily, date, ...emptyCounts() })
    addResult(groups.get(key), result)
  }
  const byGroup = [...groups.values()]
    .map(withRates)
    .sort((a, b) => (a.date === b.date ? a.capability.localeCompare(b.capability) : b.date.localeCompare(a.date)))

  const overall = emptyCounts()
  const byCapability = new Map()
  for (const g of groups.values()) {
    for (const k of ['success', 'failure', 'cancel', 'total']) overall[k] += g[k]
    if (!byCapability.has(g.capability)) byCapability.set(g.capability, { capability: g.capability, ...emptyCounts() })
    const cap = byCapability.get(g.capability)
    for (const k of ['success', 'failure', 'cancel', 'total']) cap[k] += g[k]
  }
  return {
    byGroup,
    overall: withRates(overall),
    byCapabilityOverall: [...byCapability.values()].map(withRates).sort((a, b) => b.total - a.total),
    versionGranularityNote: 'version 只到 major.minor——事件上报不带补丁号',
  }
}

// ---------------------------------------------------------------------------
// 错误码排行（来自反馈；事件的 props 里没有 errorCode 这一格）
// ---------------------------------------------------------------------------

export function rankErrorCodes(feedbackItems) {
  const counts = new Map()
  for (const item of feedbackItems) {
    if (!item.errorCode) continue
    counts.set(item.errorCode, (counts.get(item.errorCode) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([errorCode, count]) => ({ errorCode, count }))
    .sort((a, b) => (b.count - a.count) || a.errorCode.localeCompare(b.errorCode))
}

// ---------------------------------------------------------------------------
// 突增：最近有数据的一天 vs 再往前一天有数据的那天
// ---------------------------------------------------------------------------

const SPIKE_MIN_COUNT = 3 // 新窗口至少要有这么多条，太小的绝对数不值得说「突增」
const SPIKE_RELATIVE_INCREASE = 0.5 // 相对上一窗口至少涨 50%

/** 从一批（带 date 字段的）事件里找「最近有数据的一天」与「再往前一天有数据的那天」。
 *  中间可能有空档（某天完全没有事件）——找的是"有数据的两天"而不是"日历相邻的两天"，
 *  不然一天没数据就会把整条比较判成"从 0 到 X"的假突增。 */
export function latestTwoDatesWithData(events) {
  const dates = [...new Set(events.map((e) => e.date).filter(Boolean))].sort()
  if (dates.length === 0) return { latestDate: null, previousDate: null }
  const latestDate = dates[dates.length - 1]
  const previousDate = dates.length > 1 ? dates[dates.length - 2] : null
  return { latestDate, previousDate }
}

function countBy(events, predicate) {
  return events.filter(predicate).length
}

/**
 * 拿「最近一天」与「再前一天」比，看生成结果有没有突增。
 * 判据固定、可测（SPIKE_MIN_COUNT / SPIKE_RELATIVE_INCREASE），不掺判断——
 * 「这个突增值不值得告诉用户」留给 skill 层。
 */
export function detectGenerationSpikes(events, { latestDate, previousDate } = latestTwoDatesWithData(events)) {
  if (!latestDate || !previousDate) return []
  const spikes = []
  const dims = [
    { label: '生成总量', match: (e) => e.eventName === 'generation.completed' },
    { label: '生成失败', match: (e) => e.eventName === 'generation.completed' && e.props?.result === 'failure' },
    { label: '生成取消', match: (e) => e.eventName === 'generation.completed' && e.props?.result === 'cancel' },
  ]
  const capabilities = [...new Set(events.filter((e) => e.eventName === 'generation.completed').map((e) => e.props?.capability).filter(Boolean))]
  for (const cap of capabilities) {
    dims.push({ label: `${cap} 失败`, match: (e) => e.eventName === 'generation.completed' && e.props?.capability === cap && e.props?.result === 'failure' })
  }
  for (const dim of dims) {
    const currentCount = countBy(events, (e) => e.date === latestDate && dim.match(e))
    const previousCount = countBy(events, (e) => e.date === previousDate && dim.match(e))
    const isSpike = currentCount >= SPIKE_MIN_COUNT && (previousCount === 0 ? true : currentCount >= previousCount * (1 + SPIKE_RELATIVE_INCREASE)) && currentCount > previousCount
    if (isSpike) spikes.push({ dimension: dim.label, previousDate, currentDate: latestDate, previousCount, currentCount })
  }
  return spikes
}

// ---------------------------------------------------------------------------
// 启动次数 / 更新动作
// ---------------------------------------------------------------------------

export function tallyLaunches(events) {
  const starts = events.filter((e) => e.eventName === 'app.started')
  const byDate = new Map()
  for (const e of starts) byDate.set(e.date, (byDate.get(e.date) ?? 0) + 1)
  return {
    total: starts.length,
    byDate: [...byDate.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => b.date.localeCompare(a.date)),
  }
}

export function tallyUpdateActions(events) {
  const actions = events.filter((e) => e.eventName === 'update.action')
  const counts = new Map()
  for (const e of actions) {
    const key = `${e.props?.action ?? 'unknown'}|${e.props?.result ?? 'unknown'}|${e.props?.reason ?? ''}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => { const [action, result, reason] = key.split('|'); return reason ? { action, result, reason, count } : { action, result, count } })
    .sort((a, b) => b.count - a.count)
}

// ---------------------------------------------------------------------------
// 顶层组装
// ---------------------------------------------------------------------------

/**
 * 拼出完整报告数据。`newFeedbackKeys`/`newEventKeys` 是本轮 state.json 里新登记的键
 * （不是"文件是不是刚下载的"——已经在磁盘上但 state 里没见过的键同样算"新"，
 * 见 store.mjs 与 intake-radar.mjs 的增量设计）。
 */
export function buildIntakeReport({
  feedbackRecords,
  eventRecords,
  trajectoriesCount,
  newFeedbackKeys,
  newEventKeys,
  corruptFiles = [],
  generatedAt = new Date().toISOString(),
}) {
  const feedbackItems = buildFeedbackItems(feedbackRecords)
  const allEvents = flattenEvents(eventRecords)
  // 自动化事件默认排除：下面所有统计只看真实用户事件，被排除的条数单独报。
  const { real: events, excluded: excludedAutomated } = splitAutomatedEvents(allEvents)
  const newKeySet = new Set(newFeedbackKeys)
  const newFeedback = feedbackItems.filter((item) => newKeySet.has(item.key))
  const { latestDate, previousDate } = latestTwoDatesWithData(events)

  return {
    generatedAt,
    window: { latestDate, previousDate },
    totals: {
      feedbackCount: feedbackItems.length,
      eventsCount: events.length,
      excludedAutomatedCount: excludedAutomated.count,
      trajectoriesCount,
      newFeedbackCount: newFeedback.length,
      newEventKeysCount: newEventKeys.length,
    },
    newFeedback,
    excludedAutomated,
    generationResults: groupGenerationResults(events),
    failureReasons: rankFailureReasons(events),
    errorCodeRanking: rankErrorCodes(feedbackItems),
    spikes: detectGenerationSpikes(events, { latestDate, previousDate }),
    launches: tallyLaunches(events),
    updateActions: tallyUpdateActions(events),
    dataQuality: { corruptFileCount: corruptFiles.length, corruptFiles },
  }
}
