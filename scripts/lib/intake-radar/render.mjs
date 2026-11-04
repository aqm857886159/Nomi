import { renderVersionHealth } from './health.mjs'

// Intake Radar —— 渲染层。把 aggregate.mjs 吐出的报告数据变成 Markdown 全文和终端短摘要。
// 纯字符串拼接，不做任何判断——这里只管「数字怎么排版」，不管「这个数字要不要紧」。

function pct(n) {
  return `${n}%`
}

function feedbackItemMarkdown(item) {
  if (item.unreadable) return `- **${item.date} · ${item.key}** 这份文件读不出来（内容见「数据质量」）`
  const providerModel = [item.provider, item.model].filter(Boolean).join('/') || '（未记录）'
  const note = item.note ? `\n  留言：${item.note}` : ''
  return (
    `- **${item.date} · ${item.id}** [${item.system}/${item.version} · ${item.surface}]` +
    ` 错误码:${item.errorCode ?? '（无）'} 供应商/模型:${providerModel}\n` +
    `  摘要：${item.summary || '（无）'}${note}${item.perf ? `\n  卡顿档位：点击响应 p75 ${item.perf.interactionP75} / p95 ${item.perf.interactionP95}，长帧 ${item.perf.longFramesPerMin}/分钟，节点 ${item.perf.nodes}，所在页 ${item.perf.page}` : ''}`
  )
}

function generationResultsMarkdown(gr) {
  const overall = `总计 ${gr.overall.total}，成功 ${gr.overall.success}（${pct(gr.overall.successRate)}）、失败 ${gr.overall.failure}（${pct(gr.overall.failureRate)}）、取消 ${gr.overall.cancel}（${pct(gr.overall.cancelRate)}）`
  const byCap = gr.byCapabilityOverall
    .map((c) => `  - ${c.capability}：总计 ${c.total}，成功 ${c.success}（${pct(c.successRate)}）、失败 ${c.failure}（${pct(c.failureRate)}）、取消 ${c.cancel}（${pct(c.cancelRate)}）`)
    .join('\n')
  const detailRows = gr.byGroup
    .map((g) => `| ${g.capability} | ${g.appVersion} | ${g.osFamily} | ${g.date} | ${g.success} | ${g.failure} | ${g.cancel} | ${g.total} |`)
    .join('\n')
  const detailTable = gr.byGroup.length
    ? `\n\n| 能力 | 版本 | 系统 | 日期 | 成功 | 失败 | 取消 | 总计 |\n|---|---|---|---|---|---|---|---|\n${detailRows}`
    : '\n\n（本轮缓存里没有 generation.completed 事件）'
  return `### 总体\n${overall}\n\n### 按能力\n${byCap || '（无）'}\n\n### 明细（按能力 × 版本 × 系统 × 日期，${gr.versionGranularityNote}）${detailTable}`
}

function excludedMarkdown(ex) {
  if (ex.count === 0) return '自动化（测试 / 走查）事件：0 条被排除。'
  const parts = ex.byEvent.map((e) => `${e.eventName} × ${e.count}`).join('、')
  return `自动化（测试 / 走查）事件：已排除 ${ex.count} 条，不计入下面任何统计（${parts}）。`
}

function failureReasonsMarkdown(fr) {
  if (fr.total === 0) return '（没有失败的生成事件）'
  return fr.ranking.map((r, i) => `${i + 1}. \`${r.reason}\` × ${r.count}（${pct(r.share)}）`).join('\n')
}

function spikesMarkdown(spikes, window) {
  if (!window.latestDate || !window.previousDate) return '（数据不足两天，暂时比不出突增）'
  if (spikes.length === 0) return `${window.previousDate} → ${window.latestDate}：无明显突增`
  return spikes
    .map((s) => `- ⚠️ ${s.dimension}：${s.previousDate} 的 ${s.previousCount} → ${s.currentDate} 的 ${s.currentCount}`)
    .join('\n')
}

function launchesMarkdown(launches) {
  const byDate = launches.byDate.map((d) => `${d.date} × ${d.count}`).join('、') || '（无）'
  return `启动事件共 ${launches.total} 条。按日期：${byDate}`
}

function updateActionsMarkdown(actions) {
  if (actions.length === 0) return '（本轮缓存里没有 update.action 事件）'
  return actions.map((a) => `- ${a.action} · ${a.result}${a.reason ? ` · ${a.reason}` : ''} × ${a.count}`).join('\n')
}

function errorCodeMarkdown(ranking) {
  if (ranking.length === 0) return '（本轮缓存里没有带错误码的反馈）'
  return ranking.map((r, i) => `${i + 1}. \`${r.errorCode}\` × ${r.count}`).join('\n')
}

const PERF_DIM_LABELS = { osFamily: '系统', appVersion: '版本', cpuCores: 'CPU 核数', memoryGb: '内存', nodes: '画布节点数', imageNodes: '图片节点数', generating: '是否在生成', page: '所在页' }

function perfMarkdown(perf) {
  const fb = perf.feedbackWithPerf.count ? `带卡顿档位的反馈 ${perf.feedbackWithPerf.count} 条，其中偏慢 ${perf.feedbackWithPerf.slow} 条。` : ''
  if (perf.total === 0) return `（本轮缓存里没有 perf.session.summary 事件）${fb ? '\n' + fb : ''}`
  const dist = Object.entries(perf.distributions)
    .map(([field, rows]) => `- ${field}：${rows.map((r) => `${r.value}×${r.count}`).join(' · ')}`)
    .join('\n')
  const table = (rows) => rows.map((r) => `| ${r.value}${r.lowSample ? '（样本少）' : ''} | ${r.total} | ${r.slow} | ${pct(r.slowShare)} |`).join('\n')
  const dims = Object.entries(perf.byDimension)
    .map(([dim, rows]) => `**${PERF_DIM_LABELS[dim] ?? dim}**\n\n| 取值 | 会话数 | 偏慢 | 偏慢占比 |\n|---|---|---|---|\n${table(rows)}`)
    .join('\n\n')
  return `共 ${perf.total} 份会话汇总，偏慢 ${perf.slow}（${pct(perf.slowShare)}）。偏慢 = ${perf.slowDefinition}。\n${fb}\n\n各档分布：\n${dist}\n\n${dims}`
}

function dataQualityMarkdown(dq) {
  if (dq.corruptFileCount === 0) return '本地缓存文件全部可解析。'
  const lines = dq.corruptFiles.map((f) => `- ${f.key}：${f.error}`).join('\n')
  return `本地缓存里有 ${dq.corruptFileCount} 个文件解析失败（不影响其余记录的统计）：\n${lines}`
}

const TRIAGE_COMMAND = 'pnpm run intake:radar -- --triaged <编号…> --todo <待办号或说明>'

function triageMarkdown(triage) {
  const rebuilt = triage.rebuilt ? '⚠️ 账文件坏了，已从缓存重建：已经出过账的也回到了这里，要再出一次。\n\n' : ''
  if (triage.count === 0) return `${rebuilt}（账上没有未分诊的反馈）`
  return `${rebuilt}这些反馈还没有人记进待办，雷达再跑多少轮都还在这里。分诊完用 \`${TRIAGE_COMMAND}\` 出账。\n\n${triage.items.map(feedbackItemMarkdown).join('\n\n')}`
}

function deliveryMarkdown(delivery) {
  if (delivery.byVersion.length === 0) return '（本轮缓存里没有反馈）'
  const rows = delivery.byVersion
    .map((row) => `| ${row.version} | ${row.total} | ${row.direct} | ${row.late} | ${row.unknown} | ${row.directShare === null ? '—' : pct(row.directShare)} | ${row.slowestSeconds ? `${Math.round(row.slowestSeconds / 60)} 分钟` : '—'} |`)
    .join('\n')
  return `点发送后 ${delivery.directSeconds} 秒内到的算直达，更晚到的是第一次没发成、排队重发的。重复送达 ${delivery.duplicateDeliveries} 次（客户端没等到回答又发了一遍，已折叠，不进任何统计）。\n\n| 版本 | 反馈 | 直达 | 晚到 | 没有时间 | 直达率 | 最晚 |\n|---|---|---|---|---|---|---|\n${rows}`
}

function logTailMarkdown(logTail) {
  if (logTail.byVersion.length === 0) return '（本轮缓存里没有反馈）'
  const rows = logTail.byVersion
    .map((row) => `| ${row.version} | ${row.total} | ${row.attached} | ${Object.entries(row.missing).map(([why, count]) => `${why}×${count}`).join(' · ') || '—'} |`)
    .join('\n')
  const alarms = logTail.alarms.map((row) => `- ⚠️ ${row.version}：${row.total - row.attached}/${row.total} 份没带日志尾巴。这个版本应当带得上，先查这个`).join('\n')
  return `${alarms ? `${alarms}\n\n` : ''}| 版本 | 反馈 | 带上日志 | 没带的原因 |\n|---|---|---|---|\n${rows}`
}

export function renderMarkdown(report) {
  const newFeedbackSection = report.newFeedback.length
    ? report.newFeedback.map(feedbackItemMarkdown).join('\n\n')
    : '（本轮没有新反馈）'
  return `# Nomi 用户反馈雷达 · ${report.generatedAt.slice(0, 10)}

生成于 ${report.generatedAt}。累计缓存：反馈 ${report.totals.feedbackCount} 条 / 事件 ${report.totals.eventsCount} 条 / 轨迹 ${report.totals.trajectoriesCount} 条。

## 待分诊（${report.triage.count} 条）

${triageMarkdown(report.triage)}

## 本次新增反馈（${report.totals.newFeedbackCount} 条）

${newFeedbackSection}

## 送达

${deliveryMarkdown(report.delivery)}

## 日志尾巴

${logTailMarkdown(report.logTail)}

## 生成结果（成功 / 失败 / 取消）

${excludedMarkdown(report.excludedAutomated)}

${generationResultsMarkdown(report.generationResults)}

### 失败原因排行（共 ${report.failureReasons.total} 次失败）
${failureReasonsMarkdown(report.failureReasons)}

## 错误码排行

${errorCodeMarkdown(report.errorCodeRanking)}

## 与上一窗口比

${spikesMarkdown(report.spikes, report.window)}

## 启动 / 更新

${launchesMarkdown(report.launches)}

更新动作：
${updateActionsMarkdown(report.updateActions)}

## 卡不卡（界面流畅度分档）

${perfMarkdown(report.perf)}

## 数据质量

${dataQualityMarkdown(report.dataQuality)}

## 版本健康

${renderVersionHealth(report.versionHealth)}
`
}

/** 终端里最多列几个待分诊编号，其余去报告里看：这一段要留在摘要的尾部，不能长。 */
const TERMINAL_TRIAGE_IDS = 5

/**
 * 终端打印的短摘要——给人在命令行里扫一眼用，细节看同名 .md。
 *
 * **顺序有意义**：每日雷达 hook 只留输出的最后几行（`daily-radar-session.mjs` 的 `tail`），
 * 所以「新增」「待分诊」和报告路径必须排在尾部、版本健康的判定最后。它们排在开头时，
 * 版本健康块一长就把它们挤没了，会话里再也看不到新反馈的数（线上这样过了几天没人发现）。
 */
export function renderTerminalSummary(report, { mdPath, jsonPath } = {}) {
  const lines = []
  lines.push(`Intake Radar · ${report.generatedAt}`)
  const gr = report.generationResults.overall
  lines.push(`  生成结果：总计 ${gr.total}，成功 ${gr.success}（${pct(gr.successRate)}）、失败 ${gr.failure}（${pct(gr.failureRate)}）、取消 ${gr.cancel}（${pct(gr.cancelRate)}）`)
  if (report.excludedAutomated.count) lines.push(`  已排除自动化事件 ${report.excludedAutomated.count} 条（测试 / 走查），不计入上面的数`)
  if (report.failureReasons.total) {
    lines.push(`  失败原因前三：${report.failureReasons.ranking.slice(0, 3).map((r) => `${r.reason}×${r.count}`).join(' · ')}`)
  }
  if (report.errorCodeRanking.length) {
    lines.push(`  错误码排行前三：${report.errorCodeRanking.slice(0, 3).map((r) => `${r.errorCode}×${r.count}`).join(' · ')}`)
  }
  if (report.spikes.length) {
    lines.push(`  ⚠️ 突增：${report.spikes.map((s) => `${s.dimension} ${s.previousCount}→${s.currentCount}`).join(' · ')}`)
  } else if (report.window.latestDate && report.window.previousDate) {
    lines.push('  无明显突增')
  }
  if (report.perf.total) lines.push(`  卡不卡：${report.perf.total} 份会话汇总，偏慢 ${report.perf.slow}（${pct(report.perf.slowShare)}）`)
  if (report.dataQuality.corruptFileCount) lines.push(`  ⚠️ ${report.dataQuality.corruptFileCount} 个本地缓存文件解析失败`)
  const healthLines = renderVersionHealth(report.versionHealth).split('\n')
  const decision = healthLines.pop()
  lines.push(...healthLines)
  lines.push(`  新增反馈 ${report.totals.newFeedbackCount} 条 · 累计反馈 ${report.totals.feedbackCount} / 事件 ${report.totals.eventsCount} / 轨迹 ${report.totals.trajectoriesCount}`)
  const shownIds = report.triage.items.slice(0, TERMINAL_TRIAGE_IDS).map((item) => item.id)
  lines.push(report.triage.count
    ? `  待分诊 ${report.triage.count} 条：${shownIds.join(' ')}${report.triage.count > shownIds.length ? ' …' : ''}`
    : '  待分诊 0 条')
  if (report.triage.rebuilt) lines.push('  ⚠️ 待分诊账坏了，已从缓存重建：已经出过账的要再出一次')
  for (const row of report.logTail.alarms) lines.push(`  ⚠️ ${row.version} 有 ${row.total - row.attached}/${row.total} 份反馈没带日志尾巴`)
  if (report.totals.duplicateDeliveries) lines.push(`  重复送达 ${report.totals.duplicateDeliveries} 次（已折叠）`)
  if (mdPath) lines.push(`  报告 → ${mdPath}`)
  if (jsonPath) lines.push(`  报告 → ${jsonPath}`)
  lines.push(decision)
  return lines.join('\n')
}
