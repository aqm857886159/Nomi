import fs from 'node:fs'
import path from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { makeTempDir, cleanupTestTemp } from './_test-temp.mjs'
import { BUILD_GATE_STATUS, BUILD_GATE_WALK } from './nightly-build-gate.mjs'
import { nightlyWalkInventory } from './nightly-walk-selection.mjs'
import { execGhReadSync, execGhWriteSync } from './lib/transientRetry.mjs'

export const WAKE_FAIL_RATE = 0.2
export const WAKE_FAIL_COUNT = 30
export const ISSUE_TITLE = '夜跑走查失败'
export const ISSUE_TITLE_RED = '【夜跑整体红】夜跑走查失败'
const START = '<!-- nightly-state:start -->'
const END = '<!-- nightly-state:end -->'
const REPORT_START = '<!-- nightly-report:start -->'
const REPORT_END = '<!-- nightly-report:end -->'
const PACKAGED = 'tests/ux/packaged-mcp-smoke.e2e.mjs'
const BATCHES = ['0', '1', '2', '3', 'packaged-mac']
const titles = { gate: '构建 / 门岗', env: '环境', unknown: '未定' }
const cell = (value) => String(value ?? 'unknown').replaceAll('@', '＠').replaceAll('|', '∣').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/[\r\n]/g, ' ')

export const ENV_SIGNATURES = [
  { id: 'local-server-refused', pattern: /ECONNREFUSED|ERR_CONNECTION_REFUSED/, note: '本地服务（Vite 等）连接被拒' },
  { id: 'hardcoded-mac-path', pattern: /ENOENT[^\n]*\/Users\//, note: '写死的 macOS 项目路径不存在' },
  { id: 'module-not-found', pattern: /ERR_MODULE_NOT_FOUND/, note: 'TS / 模块解析失败' },
  { id: 'real-config-missing', pattern: /model-catalog[^\n]*(ENOENT|not found|missing|缺失)/i, note: '测试依赖真实模型配置，CI 上没有' },
  { id: 'real-media-missing', pattern: /ENOENT[^\n]*(Movies|Pictures|real-media)/i, note: '真实媒体目录不存在' },
]


export function readRows(root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { recursive: true }).filter((f) => String(f).endsWith('.tsv')).flatMap((file) =>
    fs.readFileSync(path.join(root, file), 'utf8').split('\n').filter(Boolean).map((line) => {
      const [walk, status, seconds, log] = line.split('\t')
      return { walk, batch: path.basename(String(file)).match(/^results-(.+)\.tsv$/)?.[1], status: /^\d+$/.test(status ?? '') ? Number(status) : NaN, seconds: seconds?.trim() ? Number(seconds) : NaN, log }
    })).sort((a, b) => a.walk.localeCompare(b.walk))
}

export function classifyRow(row, logText) {
  if (row.walk === BUILD_GATE_WALK || row.status === BUILD_GATE_STATUS) return { kind: 'gate', reason: '构建自检未过' }
  if (logText == null) return { kind: 'unknown', reason: '无日志' }
  if (/构建产物比源码旧/.test(logText)) return { kind: 'gate', reason: '构建产物比源码旧（assertFreshBuild）' }
  const hit = ENV_SIGNATURES.find((entry) => entry.pattern.test(logText))
  if (hit) return { kind: 'env', reason: hit.note }
  return { kind: 'unknown', reason: row.status === 124 ? '超时，未定责' : '未定责' }
}

export function wakeVerdict({ failed, total, gate }) {
  const reasons = []
  if (gate > 0) reasons.push(`${gate} 个 job 构建门失败（没启动走查）`)
  if (total > 0 && failed / total > WAKE_FAIL_RATE) reasons.push(`失败率 ${(failed / total * 100).toFixed(1)}% > ${WAKE_FAIL_RATE * 100}%`)
  if (failed > WAKE_FAIL_COUNT) reasons.push(`失败 ${failed} 条 > ${WAKE_FAIL_COUNT}`)
  return { red: reasons.length > 0, reasons }
}

function currentReceipt(env = process.env) {
  const run = env.GITHUB_RUN_ID || 'unknown'
  return { run, sha: env.GITHUB_SHA || 'unknown', attempt: env.GITHUB_RUN_ATTEMPT || '1', time: new Date().toISOString(), url: `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY || 'unknown'}/actions/runs/${run}` }
}

export function expectedBatches() {
  const walks = nightlyWalkInventory()
  return BATCHES.map((batch) => ({ batch, walks: batch === 'packaged-mac' ? [PACKAGED] : walks.filter((_, i) => i % 4 === Number(batch)) }))
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function readEvidence(root) {
  let needs = null
  try { needs = JSON.parse(process.env.NIGHTLY_NEEDS) } catch { /* Missing context remains unknown. */ }
  return { receipt: currentReceipt(), expectedBatches: expectedBatches(), manifests: BATCHES.map((id) => readJson(path.join(root, `selected-${id}.json`))), sentinels: BATCHES.map((id) => readJson(path.join(root, `batch-${id}.json`))), needs }
}

export function summarizeRows(rows, readLog = () => null, options = {}) {
  const { receipt = currentReceipt(), expectedBatches: batches = expectedBatches(), manifests = [], sentinels = [], needs } = options
  const expected = batches.flatMap((b) => b.walks)
  const expectedSet = new Set(expected)
  const issues = []
  const sameRun = (value) => value && ['sha', 'run', 'attempt'].every((key) => value[key] === receipt[key] && receipt[key] !== 'unknown')
  const batchResults = batches.map((batch) => {
    const selected = manifests.filter((m) => m?.batch === batch.batch)
    const finished = sentinels.filter((s) => s?.batch === batch.batch)
    const manifest = selected[0]; const sentinel = finished[0]
    const valid = selected.length === 1 && sameRun(manifest) && Array.isArray(manifest.walks) && JSON.stringify(manifest.walks) === JSON.stringify(batch.walks)
    const ended = finished.length === 1 && sameRun(sentinel) && ['success', 'failure'].includes(sentinel.result)
    if (!valid || !ended) issues.push(`批次 ${batch.batch} manifest/哨兵缺失、未完成或身份无效`)
    return { batch: batch.batch, result: ended ? sentinel.result : 'unknown', expected: batch.walks.length, manifestValid: valid }
  })
  for (const job of ['walks', 'packaged-mac']) {
    if (!['success', 'failure'].includes(needs?.[job]?.result)) issues.push(`${job}: ${needs?.[job]?.result ?? 'unknown'}（job 批次失败或未完成）`)
  }
  if (expectedSet.size !== expected.length || !expected.length) issues.push('应跑清单为空或重复')
  const groups = new Map()
  for (const r of rows) {
    if (!expectedSet.has(r.walk) && r.walk !== BUILD_GATE_WALK) issues.push(`未选入的结果：${r.walk}`)
    const list = groups.get(r.walk) ?? []; list.push(r); groups.set(r.walk, list)
  }
  const validRows = rows.filter((r) => {
    const valid = (!r.batch || batches.some((b) => b.batch === r.batch && b.walks.includes(r.walk)) || r.walk === BUILD_GATE_WALK) && (expectedSet.has(r.walk) || r.walk === BUILD_GATE_WALK) && (r.walk === BUILD_GATE_WALK || groups.get(r.walk).length === 1) && Number.isInteger(r.status) && r.status >= 0 && r.status <= 255 && Number.isFinite(r.seconds) && r.seconds >= 0
    if (!valid) issues.push(`结果无效或重复：${r.walk}`)
    return valid
  })
  const observed = new Set(validRows.map((r) => r.walk))
  const missing = expected.filter((walk) => !observed.has(walk))
  if (missing.length) issues.push(`缺失 ${missing.length} 条结果`)
  const passed = validRows.filter((r) => r.status === 0)
  const skipped = validRows.filter((r) => r.status === 125)
  const failed = validRows.filter((r) => r.status !== 0 && r.status !== 125)
  const columns = { gate: [], env: [], unknown: [] }
  const evidence = new Map()
  for (const r of failed) {
    const log = readLog(r)
    const verdict = classifyRow(r, log)
    columns[verdict.kind].push({ row: r, reason: verdict.reason })
    const failureLine = log?.split('\n').find((line) => /error|fail|✗|✖|失败|不通过|超时/i.test(line)) ?? log?.split('\n').find(Boolean) ?? '无日志'
    evidence.set(r.walk, { failureLine: cell(failureLine).slice(0, 400), log: path.basename(r.log || 'unknown'), logUrl: `${receipt.url}#artifacts` })
  }
  const stateRows = validRows.filter((r) => batches.some((b) => b.walks.includes(r.walk) && batchResults.find((x) => x.batch === b.batch).manifestValid && sentinels.some((entry) => entry?.batch === b.batch && sameRun(entry) && ['success', 'failure'].includes(entry.result))))
  const jobsSuccessful = ['walks', 'packaged-mac'].every((job) => needs?.[job]?.result === 'success') && batchResults.every((b) => b.result === 'success')
  const integrity = { complete: issues.length === 0, jobsSuccessful, issues: [...new Set(issues)], batches: batchResults }
  const total = passed.length + failed.length
  const wake = wakeVerdict({ failed: failed.length, total, gate: columns.gate.length })
  if (!jobsSuccessful && integrity.complete) { wake.red = true; wake.reasons.unshift('批次已完成，job 有失败') }
  if (!integrity.complete) { wake.red = true; wake.reasons.unshift('本夜未完整完成（infrastructure failed/unknown）') }
  const markdown = [
    ...(wake.red ? [`## 【夜跑整体红】：${wake.reasons.join('；')}`, ''] : []),
    `本夜：[run ${receipt.run}](${receipt.url})；SHA ${receipt.sha}；${receipt.time}`,
    `Nightly walkthroughs: ${passed.length}/${expected.length} passed; ${failed.length} failed; ${skipped.length} skipped.`,
    `应跑 ${expected.length}，实收有效 ${validRows.filter((r) => expectedSet.has(r.walk)).length}；绿 ${passed.length}，跳过 ${skipped.length}，缺失 ${missing.length}。`,
    '完整性不足时不可与其它夜跑原始红数比较；跳过与缺失均不算通过。',
    `完整性：${integrity.complete ? 'complete' : 'infrastructure failed/unknown'}`,
    ...['walks', 'packaged-mac'].map((job) => `- ${job}: ${needs?.[job]?.result ?? 'unknown'}`),
    ...integrity.issues.map((message) => `- ${cell(message)}`),
    '', '| 批次 | Job 结果 | 应跑 | 实收 |', '|---|---|---:|---:|',
    ...batchResults.map((b) => `| ${b.batch} | ${b.result} | ${b.expected} | ${batches.find((x) => x.batch === b.batch).walks.filter((w) => observed.has(w)).length} |`),
    ...Object.keys(titles).flatMap((kind) => ['', `### ${titles[kind]}（${columns[kind].length}）`, '| Walkthrough | Exit | Seconds | 判定 / 日志 |', '|---|---:|---:|---|', ...columns[kind].map(({ row: r, reason }) => `| ${cell(r.walk)} | ${r.status} | ${r.seconds} | ${reason}；[${cell(path.basename(r.log || 'unknown'))}][nightly-logs] |`)]),
    ...(skipped.length ? ['', `### 跳过（${skipped.length}）`, ...skipped.map((r) => `- ${cell(r.walk)} | skipped`)] : []),
    ...(missing.length ? ['', `### 缺失（${missing.length}）`, ...missing.map((w) => `- ${cell(w)}`)] : []),
    '', '通过的不逐行列出；逐条日志见本次 run 的 nightly-walks-* artifacts。', `[nightly-logs]: ${receipt.url}#artifacts`,
  ].join('\n') + '\n'
  return { passed, failed, skipped, missing, stateRows, expected,  columns, wake, total, integrity, receipt, evidence, markdown }
}

export function makeLogReader(root) {
  const byName = new Map()
  if (fs.existsSync(root)) for (const file of fs.readdirSync(root, { recursive: true })) byName.set(path.basename(String(file)), path.join(root, String(file)))
  return (row) => {
    const found = byName.get(path.basename(row.log ?? ''))
    try { return found && fs.statSync(found).isFile() ? fs.readFileSync(found, 'utf8') : null } catch { return null }
  }
}

function validReceipt(value) {
  return value && ['run', 'sha', 'attempt', 'time', 'url'].every((key) => typeof value[key] === 'string' && value[key].length > 0)
}

export function readState(body) {
  const begin = body.indexOf(START); const end = body.indexOf(END)
  if (begin < 0 || end < begin || body.indexOf(START, begin + START.length) >= 0 || body.indexOf(END, end + END.length) >= 0) return { status: 'unknown', state: null }
  try {
    const envelope = JSON.parse(body.slice(begin + START.length, end).trim())
    if (envelope.version !== 1 || envelope.encoding !== 'gzip-base64' || typeof envelope.data !== 'string') throw new Error('invalid envelope')
    const state = JSON.parse(gunzipSync(Buffer.from(envelope.data, 'base64'), { maxOutputLength: 8 * 1024 * 1024 }).toString('utf8'))
    if (state.version !== 1 || !state.walks || typeof state.walks !== 'object' || Array.isArray(state.walks) || typeof state.integrityComplete !== 'boolean' || typeof state.recovered !== 'boolean' || !validReceipt(state.latestRun)) throw new Error('invalid state')
    for (const entry of Object.values(state.walks)) {
      if (!entry || !['red', 'green', 'unknown'].includes(entry.lastKnownStatus) || !(entry.firstObservedRed === null || validReceipt(entry.firstObservedRed)) || !(entry.lastGreen === null || validReceipt(entry.lastGreen)) || !Array.isArray(entry.episodes) || typeof entry.latestEvidenceRun !== 'string' || typeof entry.proposedOwner !== 'string' || !['green', 'red', 'skipped', 'missing'].includes(entry.lastObservedStatus)) throw new Error('invalid walk state')
      if (entry.episodes.some((episode) => !(episode.firstObservedRed === null || validReceipt(episode.firstObservedRed)) || !validReceipt(episode.resolved))) throw new Error('invalid episode')
    }
    return { status: 'ok', state }
  } catch { return { status: 'unknown', state: null } }
}

function stateBlock(state) {
  // Standard gzip keeps hundreds of per-walk receipts within GitHub's issue body limit.
  return `${START}\n${JSON.stringify({ version: 1, encoding: 'gzip-base64', data: gzipSync(JSON.stringify(state)).toString('base64') })}\n${END}`
}

function mergeState(result, prior) {
  const state = prior.state ? structuredClone(prior.state) : { version: 1, walks: {}, integrityComplete: false, recovered: false }
  const newRed = []
  for (const walk of result.expected) {
    state.walks[walk] ??= { lastKnownStatus: 'unknown', firstObservedRed: null, lastGreen: null, latestEvidenceRun: 'unknown', proposedOwner: '协调分诊', episodes: [] }
    state.walks[walk].lastObservedStatus = 'missing'
  }
  for (const r of result.stateRows) {
    const previous = state.walks[r.walk]
    const entry = previous
    entry.lastObservedStatus = r.status === 125 ? 'skipped' : r.status === 0 ? 'green' : 'red'
    if (r.status === 125) continue
    if (r.status === 0) {
      if (entry.lastKnownStatus === 'red') entry.episodes.push({ firstObservedRed: entry.firstObservedRed, resolved: result.receipt })
      entry.lastKnownStatus = 'green'; entry.lastGreen = result.receipt
      entry.firstObservedRed = null
    } else {
      const changed = entry.lastKnownStatus !== 'red'
      if (changed) entry.firstObservedRed = prior.status === 'ok' ? result.receipt : null
      entry.lastKnownStatus = 'red'
      if (changed && prior.status === 'ok') newRed.push({ walk: r.walk, baselineUnknown: previous?.lastKnownStatus !== 'green', firstObservedRed: entry.firstObservedRed, lastGreen: entry.lastGreen, proposedOwner: entry.proposedOwner, ...result.evidence.get(r.walk) })
    }
    entry.latestEvidenceRun = result.receipt.run
    state.walks[r.walk] = entry
  }
  const recovered = prior.status === 'ok' && result.integrity.complete && result.integrity.jobsSuccessful && result.failed.length === 0 && result.skipped.length === 0 && Object.values(state.walks).every((w) => w.lastKnownStatus === 'green')
  const integrityRegressed = prior.status === 'ok' && prior.state.integrityComplete && !result.integrity.complete
  const justRecovered = recovered && !prior.state?.recovered
  state.latestRun = result.receipt
  state.integrityComplete = result.integrity.complete
  state.recovered = recovered
  return { state, newRed, integrityRegressed, justRecovered }
}

function gh(args) {
  return ['list', 'view'].includes(args[1]) ? execGhReadSync(args) : execGhWriteSync(args)
}

export function updateIssue({ result, repo, run = gh }) {
  const existing = JSON.parse(run(['issue', 'list', '--repo', repo, '--state', 'open', '--search', `${ISSUE_TITLE} in:title`, '--json', 'number,title']))
  if (existing.length > 1) throw new Error('Multiple nightly issues; refusing to overwrite an ambiguous ledger')
  const issue = existing[0]
  const oldBody = issue ? JSON.parse(run(['issue', 'view', String(issue.number), '--repo', repo, '--json', 'body'])).body : ''
  if (typeof oldBody !== 'string') throw new Error('Unable to read nightly issue body')
  const prior = readState(oldBody)
  const { state, newRed, integrityRegressed, justRecovered } = mergeState(result, prior)
  const title = result.wake.red ? ISSUE_TITLE_RED : ISSUE_TITLE
  const report = [REPORT_START, result.markdown, `状态账读取：${prior.status}；首次红 SHA 只表示首次观测，不表示致因提交。`,
    `本次新红 ${newRed.length}；仍记红 ${Object.values(state.walks).filter((w) => w.lastKnownStatus === 'red').length}。`,
    '| 走查 | 已知状态 | 首次观测红 SHA / run | 上次绿 SHA | 最近证据 run | 建议主人 |', '|---|---|---|---|---|---|',
    ...Object.entries(state.walks).filter(([, e]) => e.lastKnownStatus === 'red').map(([w, e]) => `| ${cell(w)} | red | ${e.firstObservedRed ? `${e.firstObservedRed.sha} / ${e.firstObservedRed.run}` : 'unknown（存量）'} | ${e.lastGreen?.sha ?? 'unknown'} | ${e.latestEvidenceRun} | ${cell(e.proposedOwner)} |`), REPORT_END].join('\n')
  let preserved = oldBody
  if (oldBody.trim() && !oldBody.includes(REPORT_START)) preserved = `<details><summary>历史正文 / 人工备注（非本夜结论）</summary>\n\n${oldBody}\n\n</details>`
  if (prior.status === 'ok') preserved = preserved.slice(0, preserved.indexOf(START)) + preserved.slice(preserved.indexOf(END) + END.length)
  const reportStart = preserved.indexOf(REPORT_START); const reportEnd = preserved.indexOf(REPORT_END)
  if (reportStart >= 0 && reportEnd > reportStart) preserved = preserved.slice(0, reportStart) + preserved.slice(reportEnd + REPORT_END.length)
  // Keep malformed original state as evidence outside the active block, without leaving duplicate markers.
  preserved = preserved.replaceAll(START, '<!-- invalid-nightly-state:start -->').replaceAll(END, '<!-- invalid-nightly-state:end -->')
  const body = [report, stateBlock(state), preserved.trim()].filter(Boolean).join('\n\n')
  if (body.length > 65000) throw new Error('Nightly issue body exceeds safe size; existing ledger left untouched')
  const comment = [
    ...(newRed.length ? ['新增红项（首次观测点，不声明致因提交）：', ...newRed.map((e) => `- ${cell(e.walk)}：${e.baselineUnknown ? '首次观测红、基线未知；' : ''}${e.failureLine}；[日志 ${cell(e.log)}][logs]；首红 SHA ${e.firstObservedRed.sha} / [run ${e.firstObservedRed.run}][run] / ${e.firstObservedRed.time}；上次绿 SHA ${e.lastGreen?.sha ?? 'unknown'}；建议主人：${cell(e.proposedOwner)}`)] : []),
    ...(integrityRegressed ? [`完整性由 complete 变为 infrastructure failed/unknown：[run](${result.receipt.url})；${result.integrity.issues.map(cell).join('；')}`] : []),
    ...(justRecovered ? [`夜跑已恢复：${result.passed.length} 条明确通过，0 跳过，0 缺失，全部批次成功。[run](${result.receipt.url})`] : []),
  ]
  if (newRed.length) comment.push(`\n[logs]: ${result.receipt.url}#artifacts`, `[run]: ${result.receipt.url}`)
  const commentBody = comment.join('\n').replaceAll('@', '＠')
  if (commentBody.length > 65000) throw new Error('Nightly comment exceeds safe size; existing ledger left untouched')
  const temp = makeTempDir('nomi-nightly-body-')
  try {
    const bodyFile = path.join(temp, 'body.md'); fs.writeFileSync(bodyFile, body)
    if (issue) run(['issue', 'edit', String(issue.number), '--repo', repo, '--title', title, '--body-file', bodyFile])
    else run(['issue', 'create', '--repo', repo, '--title', title, '--body-file', bodyFile])
    if (issue && commentBody) {
      const commentFile = path.join(temp, 'comment.md'); fs.writeFileSync(commentFile, commentBody)
      run(['issue', 'comment', String(issue.number), '--repo', repo, '--body-file', commentFile])
    }
  } finally { cleanupTestTemp(temp) }
  return { state, newRed }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, target, batch] = process.argv.slice(2)
  if (mode === '--read-state') {
    let result
    try { result = readState(fs.readFileSync(target, 'utf8')) } catch { result = { status: 'unknown', state: null } }
    console.log(JSON.stringify(result)); process.exitCode = result.status === 'ok' ? 0 : 1
  } else if (mode === '--manifest' || mode === '--finish') {
    if (!BATCHES.includes(batch)) throw new Error('Invalid nightly batch')
    fs.mkdirSync(target, { recursive: true })
    const receipt = currentReceipt()
    if (mode === '--manifest') fs.writeFileSync(path.join(target, `selected-${batch}.json`), JSON.stringify({ ...receipt, ...expectedBatches().find((b) => b.batch === batch) }))
    fs.writeFileSync(path.join(target, `batch-${batch}.json`), JSON.stringify({ ...receipt, batch, result: mode === '--manifest' ? 'running' : process.env.BATCH_RESULT }))
  } else {
    const root = mode || 'nightly-results'; const output = target || 'nightly-summary.md'
    const result = summarizeRows(readRows(root), makeLogReader(root), readEvidence(root))
    fs.writeFileSync(output, result.markdown)
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.markdown)
    if (process.env.GH_REPO) updateIssue({ result, repo: process.env.GH_REPO })
  }
}
