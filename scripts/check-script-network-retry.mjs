#!/usr/bin/env node
// scripts/ 里的网络调用必须走共用「瞬断重试」边界（scripts/lib/transientRetry.mjs）的门岗。硬零，无基线。
//
// 起因（2026-10）：#1155 合入后 main 上 Quality Gate 因 ci-annotation-hygiene 取 GitHub API 时的一次 `fetch failed` 判红，
// 合并循环看到红收据整体停住约一小时；rerun 一次就绿。类根因不是那一个脚本，而是 CI / 交付脚本各自直接调 GitHub / gh，
// 没有共用的重试边界，新写的调用天然就是「一次瞬断 = 红」。
//
// 判据（语法树，注释和字符串里的样本不误伤）：
//   gh-raw     子进程调用的第一个参数是 'gh'（或 `gh ` 开头的命令串），且不在 retryTransient / retryTransientSync 的参数里：
//              读走 execGhReadSync（带重试），写走 execGhWriteSync（只试一次，重试会把写做两次）。
//   git-net    同上，针对 git fetch / ls-remote / pull / clone。
//   fetch-bare 文件里出现 GitHub / Cloudflare / npm 控制面 API 域名字面量，却直接用 `fetch` / `globalThis.fetch` / `fetchImpl(`：
//              改用 fetchWithRetry(url, init, { fetchImpl })。
// 范围只有「控制面」：模型厂商 / 中转站的探测与花钱调用不在此列——它们会写、会扣费，自动重试可能做两次。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_FILE = /\.(?:mjs|cjs|js|ts|mts|cts)$/
const SKIP_FILE = /(?:\.node-test\.|\.test\.|\.spec\.)/
const OWNER_FILES = new Set(['scripts/lib/transientRetry.mjs', 'scripts/check-script-network-retry.mjs'])
const CONTROL_PLANE_HOST = /(?:api\.github\.com|uploads\.github\.com|api\.cloudflare\.com|registry\.npmjs\.org)/u
const RETRY_WRAPPERS = new Set(['retryTransient', 'retryTransientSync'])
const GIT_NETWORK = new Set(['fetch', 'ls-remote', 'pull', 'clone'])

export const FIX_HINT = '读：execGhReadSync / fetchWithRetry / retryTransient 包住；写：execGhWriteSync（只试一次）。见 scripts/lib/transientRetry.mjs'

function scriptKindOf(file) {
  return /\.(?:js|mjs|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
}

const stringText = (node) => (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) ? node.text : null)

function insideRetryWrapper(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent)) {
      const callee = parent.expression
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
      if (RETRY_WRAPPERS.has(name)) return true
    }
  }
  return false
}

/** 一个文件的违规列表：[{ file, line, rule, message }]。 */
export function scanSource(file, source) {
  if (OWNER_FILES.has(file) || SKIP_FILE.test(file)) return []
  if (!/\bgh\b|\bgit\b|fetch/u.test(source)) return []
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindOf(file))
  const hits = []
  const record = (node, rule, message) => {
    const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast))
    hits.push({ file, line: line + 1, rule, message })
  }
  let controlPlane = false
  const visitLiterals = (node) => {
    const text = stringText(node)
    if (text !== null && CONTROL_PLANE_HOST.test(text)) controlPlane = true
    ts.forEachChild(node, visitLiterals)
  }
  visitLiterals(ast)

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const first = node.arguments[0]
      // `opts.bin ?? 'gh'` / `bin || 'gh'` 这种带默认值的写法同样算
      const command = stringText(first) ?? (first && ts.isBinaryExpression(first) ? stringText(first.right) : null)
      if (command !== null && !insideRetryWrapper(node)) {
        const second = node.arguments[1]
        const words = command.trim().split(/\s+/u)
        const gitSub = command === 'git' && second && ts.isArrayLiteralExpression(second) ? stringText(second.elements[0]) : words[0] === 'git' ? words[1] : null
        if (command === 'gh' || words[0] === 'gh') record(node, 'gh-raw', `gh 调用没有走共用边界：${FIX_HINT}`)
        else if (gitSub && GIT_NETWORK.has(gitSub)) record(node, 'git-net', `git ${gitSub} 是网络调用，没有走共用重试：${FIX_HINT}`)
      }
      if (controlPlane && ts.isIdentifier(node.expression) && (node.expression.text === 'fetch' || node.expression.text === 'fetchImpl')) {
        record(node, 'fetch-bare', `控制面 API 调用直接用 ${node.expression.text}(...)：改用 fetchWithRetry(url, init, { fetchImpl })`)
      }
    }
    if (controlPlane) {
      // 把裸 fetch 当默认值 / 别名 / globalThis.fetch 传递，同样绕过边界（被调用的情形上面已报）
      const parent = node.parent
      if (ts.isIdentifier(node) && node.text === 'fetch') {
        const isName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
          || (ts.isPropertyAssignment(parent) && parent.name === node)
          || (ts.isMethodDeclaration(parent) && parent.name === node)
          || ts.isTypeReferenceNode(parent) || ts.isTypeQueryNode(parent)
        const isCallee = ts.isCallExpression(parent) && parent.expression === node
        if (!isName && !isCallee) record(node, 'fetch-bare', '控制面 API 文件里出现裸 fetch 引用：改用 fetchWithRetry')
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'fetch' && ts.isIdentifier(node.expression) && node.expression.text === 'globalThis') {
        record(node, 'fetch-bare', 'globalThis.fetch 绕过共用重试边界：改用 fetchWithRetry')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return hits
}

function listSourceFiles(dir) {
  const out = []
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (SOURCE_FILE.test(entry.name)) out.push(full)
    }
  }
  walk(dir)
  return out
}

export function scanTree(root = repoRoot) {
  const files = listSourceFiles(path.join(root, 'scripts'))
  const hits = []
  for (const full of files) {
    const rel = path.relative(root, full).split(path.sep).join('/')
    hits.push(...scanSource(rel, fs.readFileSync(full, 'utf8')))
  }
  return { fileCount: files.length, hits }
}

export function main(root = repoRoot, log = console.log) {
  const { fileCount, hits } = scanTree(root)
  if (fileCount === 0) {
    log('✖ check:script-network-retry 一个源文件都没扫到——遍历失效，不能当作通过')
    return 1
  }
  if (hits.length > 0) {
    log(`✖ check:script-network-retry：${hits.length} 处脚本网络调用没有走共用重试边界（一次瞬断 = 一次红，#1155 事故同类）：`)
    for (const hit of hits) log(`  ${hit.file}:${hit.line} [${hit.rule}] ${hit.message}`)
    return 1
  }
  log(`✅ check:script-network-retry：${fileCount} 个脚本文件，gh / git 网络 / 控制面 fetch 调用全部走共用重试边界`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
