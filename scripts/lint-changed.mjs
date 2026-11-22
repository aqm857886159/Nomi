#!/usr/bin/env node
// 推送前的 lint：只量**本分支改动的文件**，且只拦「比 origin/main 更糟」的部分（2026-10-08，#1129 多 1 条警告在 CI 才红）。
//
// 为什么不直接跑 `pnpm run lint:ci`：它扫全仓、要几十秒到分钟级，而 CI 的判据（--max-warnings=79）本质是「总警告数不许涨」。
// 总数 = 各文件警告数之和，所以「改动文件的警告数不比 base 版多」就推出「总数不涨」，用 ESLint 自己的 API 逐个比较即可：
//   · head 版：lintFiles(改动文件)；base 版：lintText(git show base:文件)，同一份配置、同一个解析器；
//   · 错误（error）一律拦，不看 base；警告只在「该文件比 base 多」时拦，并逐条列出新增的。
// 全仓总警告数这一项仍由 CI 的 lint:ci 兜底（它是整库类门岗，不放进推送前）。
//
// 批量抑制（eslint-suppressions.json；2026-10-22 起 scripts / tests/ux / evals 进 ESLint，存量错误冻结在这里）：
//   · 和 CLI 一样应用抑制（applySuppressions），否则推送前把存量当新错、CI 却放行；
//   · 改动文件里冻结的存量变少了却没收紧 → CI 的 lint:ci 以「unused suppressions」退出码 2 判红，推送前同样拦，并给出收紧命令；
//   · 抑制只许减少：eslint-suppressions.json 里任一文件 × 规则的冻结数比 base 多就拦（改名 / 搬家也算，要确认）；
//     新开规则 / 扩大覆盖面确需冻进存量的，由协调确认（coord-approve --suppressions，哈希绑上涨那部分 diff），
//     推送前读本机确认记录；CI 读不到记录，只在 PR 正文判据里提示「待协调确认」，合并前扫描没记录就红。
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { approvalCommand, localApprovals, suppressionApprovalSubject, SUPPRESSIONS_FILE } from './lib/coordApprovals.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LINTABLE = /\.(?:tsx?|jsx?|[cm]js)$/
const PRUNE_COMMAND = 'pnpm exec eslint --prune-suppressions'

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** 改动文件（A / M；删除的没有可 lint 的内容），带状态。 */
export function changedLintableFiles(base) {
  const parts = git(['diff', '-z', '--name-status', '--no-renames', base, 'HEAD']).split('\0').filter(Boolean)
  const files = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i][0]
    if (status !== 'D' && LINTABLE.test(parts[i + 1])) files.push({ path: parts[i + 1], status })
  }
  return files
}

const count = (messages, severity) => messages.filter((message) => message.severity === severity).length
const describe = (message) => `${message.line ?? 0}:${message.column ?? 0} ${message.ruleId ?? '(parse)'} ${message.message}`

/**
 * 纯函数：抑制只许减少——任一规则的冻结总数比 base 多，又没有协调确认记录（哈希绑上涨那部分 diff），就拦。
 * 新开规则 / 扩大覆盖面把存量冻进来是正当的，但由协调看过 diff 后确认（同 board / perf），不由 PR 自己决定。
 * approvals = scripts/lib/coordApprovals.mjs 的 localApprovals（推送前读本机 NOMI_COORD_APPROVALS）。
 */
export function judgeSuppressionGrowth(baseSuppressions, headSuppressions, approvals = null) {
  const subject = suppressionApprovalSubject(baseSuppressions, headSuppressions)
  if (!subject.needsApproval) return []
  if (approvals?.lookup?.('eslint-suppressions', SUPPRESSIONS_FILE, subject.fingerprint) === true) return []
  const shown = subject.grownEntries.slice(0, 20).map(({ file, rule, base, head }) => `    ${file} ${rule}：${base} → ${head}`)
  if (subject.grownEntries.length > 20) shown.push(`    …共 ${subject.grownEntries.length} 处`)
  const rules = shown.join('\n')
  const why = approvals?.unavailable ? `（${approvals.unavailable}）` : ''
  return [`✖ ${SUPPRESSIONS_FILE}：冻结的存量只许减少（按文件 × 规则），这些涨了，没有协调确认记录${why}\n${rules}\n  → 只改代码时：新违规请修掉，不要用 --suppress-all / --suppress-rule 把它也冻进去\n  → 新开规则 / 扩大覆盖面、确需冻进存量：交协调看 diff，协调确认后跑 ${approvalCommand(null, 'eslint-suppressions')}`]
}

/** 纯函数：文件里实际被抑制的条数 < 冻结条数 = 存量变少了但没收紧（CLI 判 unused suppressions，退出码 2）。 */
export function judgeUnprunedSuppressions(entries, suppressions) {
  const stale = []
  for (const { file, suppressedByRule, head = [] } of entries) {
    for (const [rule, entry] of Object.entries(suppressions?.[file] ?? {})) {
      // 超出冻结数时 ESLint 一条都不抑制、全部报成错误——那是 judgeLint 的事，这里不重复报。
      if (head.some((message) => message.severity === 2 && message.ruleId === rule)) continue
      const actual = suppressedByRule?.[rule] ?? 0
      if (actual < entry.count) stale.push(`    ${file} ${rule}：冻结 ${entry.count}，实际 ${actual}`)
    }
  }
  if (stale.length === 0) return []
  return [`✖ ${SUPPRESSIONS_FILE}：存量变少了（好事），但冻结数没收紧——CI 的 lint:ci 会判红\n${stale.join('\n')}\n  → 跑 ${PRUNE_COMMAND}，把收紧后的 ${SUPPRESSIONS_FILE} 一起提交`]
}

/** 纯函数：每个文件的 head / base 结果 → 拦截项文字。suppressions 只用来提示「冻结的存量被超过」。 */
export function judgeLint(entries, suppressions = {}) {
  const problems = []
  for (const { file, head, base } of entries) {
    const errors = head.filter((message) => message.severity === 2)
    if (errors.length) {
      const frozen = [...new Set(errors.map((message) => message.ruleId))].filter((rule) => suppressions[file]?.[rule])
      const hint = frozen.length
        ? `\n  （${frozen.map((rule) => `${rule} 冻结了 ${suppressions[file][rule].count} 处存量`).join('、')}；ESLint 按个数冻结，超出一处就把这条规则的全部列出——修掉新加的那处即可）`
        : ''
      problems.push(`✖ ${file}：${errors.length} 个错误\n${errors.slice(0, 8).map((message) => `    ${describe(message)}`).join('\n')}${hint}`)
    }
    const headWarnings = head.filter((message) => message.severity === 1)
    if (count(head, 1) > count(base, 1)) {
      const baseKeys = new Map()
      for (const message of base.filter((item) => item.severity === 1)) baseKeys.set(`${message.ruleId}|${message.message}`, (baseKeys.get(`${message.ruleId}|${message.message}`) ?? 0) + 1)
      const added = headWarnings.filter((message) => {
        const key = `${message.ruleId}|${message.message}`
        const left = baseKeys.get(key) ?? 0
        if (left > 0) { baseKeys.set(key, left - 1); return false }
        return true
      })
      problems.push(`✖ ${file}：警告 ${count(base, 1)} → ${count(head, 1)}（CI 的 lint:ci 对全仓警告总数设了上限，不许涨）\n${added.slice(0, 8).map((message) => `    新增 ${describe(message)}`).join('\n')}`)
    }
  }
  return problems
}

export async function main() {
  let base
  try { base = git(['merge-base', 'HEAD', 'origin/main']).trim() } catch {
    console.error('✖ lint:changed：拿不到 merge-base(HEAD, origin/main)，算不出改动范围——不拿算不出来当通过')
    return 1
  }
  // 冻结数和确认哈希都按提交里的版本算（推送的是提交，不是工作树）
  const suppressionsAt = (rev) => { try { return JSON.parse(git(['show', `${rev}:${SUPPRESSIONS_FILE}`])) } catch { return {} } }
  const headSuppressions = suppressionsAt('HEAD')
  const growth = judgeSuppressionGrowth(suppressionsAt(base), headSuppressions, localApprovals({ pr: null }))
  const files = changedLintableFiles(base)
  if (files.length === 0) {
    if (growth.length) { console.error(growth.join('\n')); return 1 }
    console.log('✅ lint:changed：没有可 lint 的改动文件')
    return 0
  }
  const { ESLint } = await import('eslint')
  const eslint = new ESLint({ cwd: repoRoot, applySuppressions: true })
  const lintable = []
  for (const file of files) if (!(await eslint.isPathIgnored(path.join(repoRoot, file.path)))) lintable.push(file)
  if (lintable.length === 0) {
    if (growth.length) { console.error(growth.join('\n')); return 1 }
    console.log('✅ lint:changed：改动文件都在 eslint 的忽略范围里')
    return 0
  }
  const headResults = await eslint.lintFiles(lintable.map((file) => file.path))
  const relative = (result) => path.relative(repoRoot, result.filePath).split(path.sep).join('/')
  const byFile = new Map(headResults.map((result) => [relative(result), result.messages]))
  // 被批量抑制的条数（suppressions 里 kind === 'file'；行内 eslint-disable 是 'directive'，不算）。
  const suppressedByFile = new Map(headResults.map((result) => {
    const counts = {}
    for (const message of result.suppressedMessages ?? []) {
      if (message.severity === 2 && message.suppressions?.some((item) => item.kind === 'file')) counts[message.ruleId] = (counts[message.ruleId] ?? 0) + 1
    }
    return [relative(result), counts]
  }))
  const entries = []
  for (const file of lintable) {
    const head = byFile.get(file.path) ?? []
    let base_ = []
    if (file.status !== 'A') {
      let text = null
      try { text = git(['show', `${base}:${file.path}`]) } catch { text = null }
      if (text !== null) {
        const [result] = await eslint.lintText(text, { filePath: path.join(repoRoot, file.path) })
        base_ = result?.messages ?? []
      }
    }
    entries.push({ file: file.path, head, base: base_ })
  }
  const problems = [
    ...judgeLint(entries, headSuppressions),
    ...judgeUnprunedSuppressions(lintable.map((file) => ({ file: file.path, suppressedByRule: suppressedByFile.get(file.path), head: byFile.get(file.path) ?? [] })), headSuppressions),
    ...growth,
  ]
  if (problems.length) {
    console.error(problems.join('\n'))
    return 1
  }
  console.log(`✅ lint:changed：${lintable.length} 个改动文件，错误 0，警告不比 origin/main 多`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code }, (error) => { console.error(error); process.exitCode = 1 })
}
