// 只消费现有雷达已经拉取、拍平、排除自动化的事件。无第二条拉数管线。
import policy from './health-policy.json' with { type: 'json' }
const versionKey = version => /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(version ?? '')?.slice(1, 3).map(Number).join('.') ?? null
const eventVersion = e => Number.isInteger(e.systemProps?.appMajor) && Number.isInteger(e.systemProps?.appMinor) ? `${e.systemProps.appMajor}.${e.systemProps.appMinor}` : null
function counts(events) {
  const success = events.filter(e => e.props?.result === 'success').length
  const failure = events.filter(e => e.props?.result === 'failure').length
  const cancel = events.filter(e => e.props?.result === 'cancel').length
  const unknown = events.length - success - failure - cancel
  const n = success + failure
  return { success, failure, cancel, unknown, n, total: events.length, rate: n ? failure / n : null }
}
const pct = value => value === null ? '无分母' : `${(100 * value).toFixed(1)}%`
export function buildVersionHealth(events, { generatedAt, newVersion, oldVersion, thresholds = policy, corruptFileCount = 0 } = {}) {
  if (!Number.isInteger(thresholds.windowDays) || thresholds.windowDays < 1) throw new Error('健康窗口必须为正整数天')
  const end = String(generatedAt).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(Date.parse(end))) throw new Error('健康窗口日期无效')
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
  const select = version => events.filter(e => eventVersion(e) === version && e.systemProps?.automated !== true && /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '') && e.date >= start && e.date <= end)
  const fresh = select(current), old = select(previous)
  const rows = [], missing = [], regressions = []
  const observedDays = { newer: new Set(fresh.map(e => e.date)).size, older: new Set(old.map(e => e.date)).size }
  if (observedDays.newer < thresholds.windowDays || observedDays.older < thresholds.windowDays) missing.push(`观察日期缺新版${thresholds.windowDays - observedDays.newer} / 旧版${thresholds.windowDays - observedDays.older}天`)
  const pending = [...(thresholds.approvalPending ?? [])]
  if (corruptFileCount) missing.push(`缓存损坏 ${corruptFileCount} 个，缺失量未知`)
  if (!previous) missing.push('上一版事件缺失，缺失量未知')
  const compare = (key, label, newer, olderCounts, conditional = false) => {
    const rule = thresholds.metrics[key]
    if (!rule || !Number.isInteger(rule.minSamples) || rule.minSamples < 1 || typeof rule.maxIncrease !== 'number' || !Number.isFinite(rule.maxIncrease) || rule.maxIncrease < 0 || rule.maxIncrease > 1) pending.push(`${label}阈值待协调定`)
    const min = rule?.minSamples
    const gaps = [newer, olderCounts].map(c => conditional && c.n === 0 && c.total === 0 ? 0 : Number.isInteger(min) ? Math.max(0, min - c.n) : null)
    const enough = gaps.every(gap => gap === 0)
    const invalid = newer.unknown + olderCounts.unknown
    rows.push({ key, label, newer, older: olderCounts, minSamples: min, maxIncrease: rule?.maxIncrease, gaps })
    if (!enough) missing.push(`${label}缺新版${gaps[0] ?? '未知'} / 旧版${gaps[1] ?? '未知'}，n=${newer.n}/${olderCounts.n}`)
    if (invalid) missing.push(`${label}未知结果${invalid}，缺失量未知`)
    if (enough && !invalid && typeof rule?.maxIncrease === 'number' && newer.rate !== null && (olderCounts.rate !== null || conditional)) {
      if (newer.rate - (olderCounts.rate ?? 0) > rule.maxIncrease) regressions.push(`${label}、新版 ${pct(newer.rate)} / 旧版 ${pct(olderCounts.rate ?? 0)}、样本 n=${newer.n}/${olderCounts.n}`)
    }
  }
  const capabilities = [...new Set(['image', 'video', ...[...fresh, ...old].filter(e => e.eventName === 'generation.completed' && ['image', 'image-edit', 'video'].includes(e.props?.capability)).map(e => e.props.capability)])]
  for (const capability of capabilities) {
    const gen = list => list.filter(e => e.eventName === 'generation.completed' && e.props?.capability === capability)
    const a = gen(fresh), b = gen(old)
    compare(`generation.${capability}`, `${capability}失败率`, counts(a), counts(b))
    const local = list => {
      const failures = list.filter(e => e.props?.result === 'failure')
      const unknown = failures.filter(e => typeof e.props?.errorType !== 'string' || !['<1s', '1-5s', '>5s'].includes(e.props?.durationBucket)).length
      const failure = failures.filter(e => e.props.errorType === 'unknown' && e.props.durationBucket === '<1s').length
      return { n: failures.length, total: failures.length, failure, success: failures.length - failure, cancel: 0, unknown, rate: failures.length ? failure / failures.length : null }
    }
    compare(`local.${capability}`, `${capability}疑似本地拒绝占失败`, local(a), local(b), true)
  }
  const launches = { newer: fresh.filter(e => e.eventName === 'app.started').length, older: old.filter(e => e.eventName === 'app.started').length }
  if (!Number.isInteger(thresholds.minLaunches) || thresholds.minLaunches < 1) pending.push('启动样本门槛待协调定')
  else if (launches.newer < thresholds.minLaunches || launches.older < thresholds.minLaunches) missing.push(`启动缺新版${Math.max(0, thresholds.minLaunches - launches.newer)} / 旧版${Math.max(0, thresholds.minLaunches - launches.older)}`)
  for (const action of ['download', 'install']) {
    const pick = list => list.filter(e => e.eventName === 'update.action' && e.props?.action === action)
    compare(`update.${action}`, `更新${action}动作失败率`, counts(pick(fresh)), counts(pick(old)))
  }
  const agent = list => list.filter(e => e.eventName === 'agent.turn.completed')
  if (!agent(fresh).length || !agent(old).length) missing.push('Agent：遥测缺这一项，缺失量未知')
  compare('agent', 'Agent回合失败率', counts(agent(fresh)), counts(agent(old)))
  const conclusion = regressions.length ? `停止放量：${regressions.join('；')}` : missing.length || pending.length ? `样本不够：${[...missing, ...pending].join('；')}` : '可以全量'
  return { requested: { newVersion, oldVersion: oldVersion ?? null }, current, previous: previous ?? null, window: { start, end }, observedDays, launches, rows, missing, pending, regressions, conclusion, stop: regressions.length > 0,
    notes: ['仅major.minor，不能精确比较补丁版；UTC日粒度，同窗不等于同模型/同用户的因果实验。', '<1s且unknown仅为疑似本地拒绝。取消不计失败率分母，未知结果阻止放行。', 'update.install success表示安装动作受理，不证明安装完成；下载/安装事件版本是发起动作的当前版。'] }
}
export function renderVersionHealth(health) {
  if (!health) return '样本不够：版本健康未配置'
  const show = c => `${c.failure}/${c.n} (${pct(c.rate)})，取消${c.cancel}，未知${c.unknown}`
  return [`版本健康：${health.current} vs ${health.previous ?? '缺失'}；${health.window.start}..${health.window.end}（UTC日）`,
    `启动 n=${health.launches.newer}/${health.launches.older}；有事件日期 n=${health.observedDays.newer}/${health.observedDays.older}`,
    ...health.notes,
    ...health.rows.map(r => `${r.label}：新版 ${show(r.newer)} / 旧版 ${show(r.older)}；最低n=${r.minSamples ?? '待协调定'}`),
    health.conclusion].join('\n')
}
