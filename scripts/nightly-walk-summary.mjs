import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execGhReadSync, execGhWriteSync } from './lib/transientRetry.mjs'

export function readRows(root) {
  const rows = []
  if (!fs.existsSync(root)) return rows
  for (const file of fs.readdirSync(root, { recursive: true })) {
    if (!String(file).endsWith('.tsv')) continue
    for (const line of fs.readFileSync(path.join(root, file), 'utf8').split('\n').filter(Boolean)) {
      const [walk, status, seconds, log] = line.split('\t')
      rows.push({ walk, status: Number(status), seconds: Number(seconds), log })
    }
  }
  return rows.sort((a, b) => a.walk.localeCompare(b.walk))
}

export function summarizeRows(rows) {
  const failed = rows.filter((row) => row.status !== 0 && row.status !== 125)
  const skipped = rows.filter((row) => row.status === 125)
  const lines = [
    `Nightly walkthroughs: ${rows.length - failed.length}/${rows.length} passed; ${failed.length} failed; ${skipped.length} skipped.`,
    '', '| Walkthrough | Result | Seconds |', '|---|---:|---:|',
    ...rows.map((row) => `| ${row.walk} | ${row.status === 0 ? 'passed' : row.status === 125 ? 'skipped' : `failed (${row.status})`} | ${row.seconds} |`),
  ]
  return { failed, skipped, markdown: `${lines.join('\n')}\n` }
}

function gh(args) {
  // 只有 issue list 是读：读走带重试的共用边界，评论 / 编辑 / 新建是写，只试一次。
  return args[0] === 'issue' && args[1] === 'list' ? execGhReadSync(args) : execGhWriteSync(args)
}

export function updateIssue({ failed, repo, summary }) {
  const title = '夜跑走查失败'
  const existing = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'open', '--search', `${title} in:title`, '--json', 'number,title']))
  if (!failed.length) {
    if (existing.length) gh(['issue', 'comment', String(existing[0].number), '--repo', repo, '--body', `夜跑 ${new Date().toISOString()} 已恢复：${summary.rows} 条全部通过（跳过 ${summary.skipped} 条）。`])
    return
  }
  const body = [
    `夜跑时间：${new Date().toISOString()}`,
    `失败 ${failed.length} 条，共 ${summary.rows} 条；跳过 ${summary.skipped} 条。`, '',
    ...failed.map((row) => `- ${row.walk}（exit ${row.status}，${row.seconds}s；日志：${row.log}）`),
    '', '完整结果见本次 workflow 的 nightly-walks-* artifacts。',
  ].join('\n')
  if (existing.length) gh(['issue', 'edit', String(existing[0].number), '--repo', repo, '--body', body])
  else gh(['issue', 'create', '--repo', repo, '--title', title, '--body', body])
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] || 'nightly-results'
  const output = process.argv[3] || 'nightly-summary.md'
  const rows = readRows(root)
  const result = summarizeRows(rows)
  fs.writeFileSync(output, result.markdown)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.markdown)
  if (process.env.GH_REPO) updateIssue({ failed: result.failed, repo: process.env.GH_REPO, summary: { rows: rows.length, skipped: result.skipped.length } })
}
