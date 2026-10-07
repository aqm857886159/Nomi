// Intake Radar —— 渲染层。把 aggregate.mjs 吐出的报告数据变成 Markdown 全文和终端短摘要。
// 纯字符串拼接，不做任何判断——这里只管「数字怎么排版」，不管「这个数字要不要紧」。

function pct(n) {
  return `${n}%`
}

function feedbackItemMarkdown(item) {
  const providerModel = [item.provider, item.model].filter(Boolean).join('/') || '（未记录）'
  const note = item.note ? `\n  留言：${item.note}` : ''
  return (
    `- **${item.date} · ${item.id}** [${item.system}/${item.version} · ${item.surface}]` +
    ` 错误码:${item.errorCode ?? '（无）'} 供应商/模型:${providerModel}\n` +
    `  摘要：${item.summary || '（无）'}${note}`
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

function dataQualityMarkdown(dq) {
  if (dq.corruptFileCount === 0) return '本地缓存文件全部可解析。'
  const lines = dq.corruptFiles.map((f) => `- ${f.key}：${f.error}`).join('\n')
  return `本地缓存里有 ${dq.corruptFileCount} 个文件解析失败（不影响其余记录的统计）：\n${lines}`
}

export function renderMarkdown(report) {
  const newFeedbackSection = report.newFeedback.length
    ? report.newFeedback.map(feedbackItemMarkdown).join('\n\n')
    : '（本轮没有新反馈）'
  return `# Nomi 用户反馈雷达 · ${report.generatedAt.slice(0, 10)}

生成于 ${report.generatedAt}。累计缓存：反馈 ${report.totals.feedbackCount} 条 / 事件 ${report.totals.eventsCount} 条 / 轨迹 ${report.totals.trajectoriesCount} 条。

## 本次新增反馈（${report.totals.newFeedbackCount} 条）

${newFeedbackSection}

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

## 数据质量

${dataQualityMarkdown(report.dataQuality)}
`
}

/** 终端打印的短摘要——给人在命令行里扫一眼用，细节看同名 .md。 */
export function renderTerminalSummary(report, { mdPath, jsonPath } = {}) {
  const lines = []
  lines.push(`Intake Radar · ${report.generatedAt}`)
  lines.push(`  新增反馈 ${report.totals.newFeedbackCount} 条 · 累计反馈 ${report.totals.feedbackCount} / 事件 ${report.totals.eventsCount} / 轨迹 ${report.totals.trajectoriesCount}`)
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
  if (report.dataQuality.corruptFileCount) lines.push(`  ⚠️ ${report.dataQuality.corruptFileCount} 个本地缓存文件解析失败`)
  if (mdPath) lines.push(`  报告 → ${mdPath}`)
  if (jsonPath) lines.push(`  报告 → ${jsonPath}`)
  return lines.join('\n')
}
