// 只消费现有雷达已经拉取、拍平、排除自动化的事件。无第二条拉数管线。
import policy from './health-policy.json' with { type: 'json' }
const versionKey = version => /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(version ?? '')?.slice(1, 3).map(Number).join('.') ?? null
const eventVersion = e => Number.isInteger(e.systemProps?.appMajor) && Number.isInteger(e.systemProps?.appMinor) ? `${e.systemProps.appMajor}.${e.systemProps.appMinor}` : null
const validDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day ?? '') && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day
const pct = value => value === null ? '无分母' : `${(100 * value).toFixed(1)}%`
const points = value => `${value >= 0 ? '+' : ''}${(100 * value).toFixed(1)} 点`
function counts(events) {
  const success = events.filter(e => e.props?.result === 'success').length
  const failures = events.filter(e => e.props?.result === 'failure')
  const failure = failures.length
  const cancel = events.filter(e => e.props?.result === 'cancel').length
  const unknown = events.length - success - failure - cancel
  const n = success + failure
  const identified = failures.filter(e => typeof e.sessionId === 'string' && e.sessionId.trim())
  return { success, failure, cancel, unknown, n, total: events.length, rate: n ? failure / n : null,
    failureSessions: new Set(identified.map(e => e.sessionId)).size, failureSessionUnknown: failure - identified.length }
}
function wilson(failure, n, z) {
  const p = failure / n, z2 = z * z, denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const radius = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denominator
  return { lower: Math.max(0, center - radius), upper: Math.min(1, center + radius) }
}
// Newcombe (1998), pp.876–877, method 10: combine directional Wilson distances.
export function newcombeDifference(newFailures, newN, oldFailures, oldN, z = policy.z) {
  for (const [failures, n] of [[newFailures, newN], [oldFailures, oldN]]) {
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(failures) || n < 0 || failures < 0 || failures > n) throw new Error('失败与样本计数无效')
  }
  if (!Number.isFinite(z) || z <= 0) throw new Error('区间分位数无效')
  if (!newN || !oldN) return null
  const a = wilson(newFailures, newN, z), b = wilson(oldFailures, oldN, z)
  const p = newFailures / newN, q = oldFailures / oldN, difference = p - q
  return { difference, lower: Math.max(-1, difference - Math.hypot(p - a.lower, b.upper - q)),
    upper: Math.min(1, difference + Math.hypot(a.upper - p, q - b.lower)) }
}
function validatePolicy(thresholds) {
  for (const key of ['windowDays', 'minLaunches', 'primaryMinSamples', 'stopMinSamples', 'stopMinFailureSessions']) {
    if (!Number.isSafeInteger(thresholds[key]) || thresholds[key] < 1) throw new Error(`健康政策${key}必须为正整数`)
  }
  if (!Number.isFinite(thresholds.stopMinIncrease) || thresholds.stopMinIncrease < 0 || thresholds.stopMinIncrease > 1 || !Number.isFinite(thresholds.z) || thresholds.z <= 0) throw new Error('健康政策区间或增加阈值无效')
}
export function buildVersionHealth(events, { generatedAt, newVersion, oldVersion, thresholds = policy, corruptFileCount = 0 } = {}) {
  validatePolicy(thresholds)
  if (!Number.isSafeInteger(corruptFileCount) || corruptFileCount < 0) throw new Error('损坏缓存计数无效')
  const end = String(generatedAt).slice(0, 10)
  if (!validDay(end)) throw new Error('健康窗口日期无效')
  const start = new Date(Date.parse(end) - (thresholds.windowDays - 1) * 86400000).toISOString().slice(0, 10)
  const current = versionKey(newVersion)
  if (!current) throw new Error('需要有效的新版本号')
  const versions = [...new Set(events.map(eventVersion).filter(Boolean))].sort((a, b) => {
    const av = a.split('.').map(Number), bv = b.split('.').map(Number)
    return av[0] - bv[0] || av[1] - bv[1]
  })
  const older = versions.filter(v => {
    const [a, b] = v.split('.').map(Number), [x, y] = current.split('.').map(Number)
    return a < x || (a === x && b < y)
  })
  const previous = oldVersion ? versionKey(oldVersion) : older.at(-1)
  if (oldVersion && (!previous || previous === current || !older.includes(previous))) {
    // 指定的旧版本可没有事件，但不能把同minor两个补丁冒充可分辨的两组。
    const before = previous && previous.split('.').map(Number), after = current.split('.').map(Number)
    if (!before || previous === current || before[0] > after[0] || (before[0] === after[0] && before[1] > after[1])) throw new Error('新旧版本必须是可区分的 major.minor，且旧版更低')
  }
  const select = version => events.filter(e => eventVersion(e) === version && e.systemProps?.automated !== true && validDay(e.date) && e.date >= start && e.date <= end)
  const fresh = select(current), old = select(previous)
  const rows = [], missing = [], regressions = [], uncovered = [], concentrated = [], sessionGaps = []
  const observedDays = { newer: new Set(fresh.map(e => e.date)).size, older: new Set(old.map(e => e.date)).size }
  if (observedDays.newer < thresholds.windowDays) missing.push(`观察日期还差${thresholds.windowDays - observedDays.newer}天（${observedDays.newer}/${thresholds.windowDays}）`)
  const compare = (key, label, newer, olderCounts) => {
    const interval = newcombeDifference(newer.failure, newer.n, olderCounts.failure, olderCounts.n, thresholds.z)
    const credible = newer.n >= thresholds.stopMinSamples && interval?.lower > 0 && interval.difference >= thresholds.stopMinIncrease
    const stop = Boolean(credible && newer.failureSessions >= thresholds.stopMinFailureSessions)
    rows.push({ key, label, newer, older: olderCounts, interval, stop })
    if (newer.n < thresholds.stopMinSamples) uncovered.push(`${label}（新版n=${newer.n}<${thresholds.stopMinSamples}）`)
    else if (!interval) uncovered.push(`${label}（旧版无可比较分母）`)
    if (newer.unknown && key !== 'generation.image') uncovered.push(`${label}（未知结果${newer.unknown}个）`)
    if (newer.failureSessionUnknown) sessionGaps.push(`${label}失败${newer.failureSessionUnknown}个缺sessionId，不能确认跨会话`)
    if (credible && newer.failureSessions === 1) concentrated.push(`${label}（新版失败${newer.failure}次）`)
    if (stop) regressions.push(`${label}、新版 ${pct(newer.rate)} / 旧版 ${pct(olderCounts.rate)}、差${points(interval.difference)}、95%区间[${points(interval.lower)}, ${points(interval.upper)}]、样本 n=${newer.n}/${olderCounts.n}、失败会话${newer.failureSessions}`)
  }
  const capabilities = ['image', 'image-edit', 'video']
  for (const capability of capabilities) {
    const gen = list => list.filter(e => e.eventName === 'generation.completed' && e.props?.capability === capability)
    const a = gen(fresh), b = gen(old)
    compare(`generation.${capability}`, `${capability}失败率`, counts(a), counts(b))
    const local = list => counts(list.filter(e => e.props?.result === 'failure').map(e => {
      const known = typeof e.props.errorType === 'string' && e.props.errorType.length > 0 && ['<1s', '1-5s', '>5s'].includes(e.props.durationBucket)
      return { ...e, props: { result: !known ? 'unknown' : e.props.errorType === 'unknown' && e.props.durationBucket === '<1s' ? 'failure' : 'success' } }
    }))
    compare(`local.${capability}`, `${capability}疑似本地拒绝占失败`, local(a), local(b))
  }

  const launches = { newer: fresh.filter(e => e.eventName === 'app.started').length, older: old.filter(e => e.eventName === 'app.started').length }
  if (launches.newer < thresholds.minLaunches) missing.push(`启动还差${thresholds.minLaunches - launches.newer}次（${launches.newer}/${thresholds.minLaunches}）`)
  const primary = rows.find(row => row.key === 'generation.image')
  if (primary.newer.n < thresholds.primaryMinSamples) missing.push(`image主指标样本还差${thresholds.primaryMinSamples - primary.newer.n}次（${primary.newer.n}/${thresholds.primaryMinSamples}）`)
  if (primary.newer.unknown || corruptFileCount) missing.push(`image主指标未知结果${primary.newer.unknown}个${corruptFileCount ? `，缓存损坏${corruptFileCount}个，主指标缺失量未知` : '，还需明确这些结果'}`)
  for (const action of ['download', 'install']) {
    const pick = list => list.filter(e => e.eventName === 'update.action' && e.props?.action === action)
    compare(`update.${action}`, `更新${action}动作失败率`, counts(pick(fresh)), counts(pick(old)))
  }
  const agent = list => list.filter(e => e.eventName === 'agent.turn.completed')
  if (!agent(fresh).length && !agent(old).length) uncovered.push('Agent 回合（遥测没有这一项）')
  else compare('agent', 'Agent回合失败率', counts(agent(fresh)), counts(agent(old)))
  uncovered.push('更新安装完成（遥测没有这一项，install success仅表示动作受理）')
  const decision = regressions.length ? `停止放量：${regressions.join('；')}` : missing.length ? `样本不够：${missing.join('；')}`
    : `可以全量：image 失败率最多变差 ${points(primary.interval?.upper ?? 1)}（95% 上界，n=${primary.newer.n}/${primary.older.n}）；未覆盖：${uncovered.join('；') || '无'}`
  const conclusion = `${decision}${concentrated.length ? `；集中在一个会话：${concentrated.join('；')}，不判停` : ''}`
  return { requested: { newVersion, oldVersion: oldVersion ?? null }, current, previous: previous ?? null, window: { start, end }, observedDays, launches, rows, missing, regressions, uncovered, concentrated, conclusion, stop: regressions.length > 0,
    notes: ['仅major.minor，不能精确比较补丁版；UTC日粒度，同窗不等于同模型/同用户的因果实验。',
      '<1s且unknown仅为疑似本地拒绝。取消和未知不计失败率分母；仅新版image未知（含坏缓存缺失量未知）阻止全量。',
      'update.install success表示安装动作受理，不证明安装完成；下载/安装事件版本是发起动作的当前版。',
      '事件不等于独立用户；单项95%区间不是多项同时检查的总体95%保证。',
      ...(!primary.interval ? ['image缺可比较分母，+100.0点为无信息的保守上界，不能排除任何变差。'] : []),
      ...sessionGaps, ...(concentrated.length ? [`集中在一个会话：${concentrated.join('；')}；不判停`] : [])] }
}

export function renderVersionHealth(health) {
  if (!health) return '样本不够：版本健康未配置'
  const show = c => `${c.failure}/${c.n} (${pct(c.rate)})，取消${c.cancel}，未知${c.unknown}`
  return [`版本健康：${health.current} vs ${health.previous ?? '缺失'}；${health.window.start}..${health.window.end}（UTC日）`,
    `启动 n=${health.launches.newer}/${health.launches.older}；有事件日期 n=${health.observedDays.newer}/${health.observedDays.older}`,
    ...health.notes,
    ...health.rows.map(r => `${r.label}：新版 ${show(r.newer)} / 旧版 ${show(r.older)}；差值95%区间${r.interval ? `[${points(r.interval.lower)}, ${points(r.interval.upper)}]` : '无可比较分母'}；新版失败会话${r.newer.failureSessions}`),
    health.conclusion].join('\n')
}
