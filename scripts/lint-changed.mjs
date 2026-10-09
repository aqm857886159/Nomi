#!/usr/bin/env node
// 推送前的 lint：只量**本分支改动的文件**，且只拦「比 origin/main 更糟」的部分（2026-10-08，#1129 多 1 条警告在 CI 才红）。
//
// 为什么不直接跑 `pnpm run lint:ci`：它扫全仓、要几十秒到分钟级，而 CI 的判据（--max-warnings=79）本质是「总警告数不许涨」。
// 总数 = 各文件警告数之和，所以「改动文件的警告数不比 base 版多」就推出「总数不涨」，用 ESLint 自己的 API 逐个比较即可：
//   · head 版：lintFiles(改动文件)；base 版：lintText(git show base:文件)，同一份配置、同一个解析器；
//   · 错误（error）一律拦，不看 base；警告只在「该文件比 base 多」时拦，并逐条列出新增的。
// 全仓总警告数这一项仍由 CI 的 lint:ci 兜底（它是整库类门岗，不放进推送前）。
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LINTABLE = /\.(?:tsx?|jsx?|[cm]js)$/

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

/** 纯函数：每个文件的 head / base 结果 → 拦截项文字。 */
export function judgeLint(entries) {
  const problems = []
  for (const { file, head, base } of entries) {
    const errors = head.filter((message) => message.severity === 2)
    if (errors.length) problems.push(`✖ ${file}：${errors.length} 个错误\n${errors.slice(0, 8).map((message) => `    ${describe(message)}`).join('\n')}`)
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
  const files = changedLintableFiles(base)
  if (files.length === 0) {
    console.log('✅ lint:changed：没有可 lint 的改动文件')
    return 0
  }
  const { ESLint } = await import('eslint')
  const eslint = new ESLint({ cwd: repoRoot })
  const lintable = []
  for (const file of files) if (!(await eslint.isPathIgnored(path.join(repoRoot, file.path)))) lintable.push(file)
  if (lintable.length === 0) {
    console.log('✅ lint:changed：改动文件都在 eslint 的忽略范围里')
    return 0
  }
  const headResults = await eslint.lintFiles(lintable.map((file) => file.path))
  const byFile = new Map(headResults.map((result) => [path.relative(repoRoot, result.filePath).split(path.sep).join('/'), result.messages]))
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
  const problems = judgeLint(entries)
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
