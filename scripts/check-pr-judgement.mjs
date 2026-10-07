#!/usr/bin/env node
// 门岗（PR 正文判据族，CI 与 push 前都跑）：按功能分类决定测试路由 + 规则与门岗的改动范围。
// 判据全在 scripts/pr-judgement-lib.mjs，合并前扫描（scripts/merge-preflight.mjs）调同一份；这里只负责取数：
//   · PR 正文：scripts/lib/prBody.mjs 的唯一取法（pull_request 事件里必查、取不到 = 红；本地没有 PR 就跳过）；
//   · 改动文件 / 状态 / package.json 被删行 / 逃逸账本被删条目（条目文件被删）：对 merge-base(HEAD, origin/main) 做 git diff；
//   · PR 创建时间（决定路由规则是否已生效）：gh pr view；取不到按已生效处理（fail-closed）。
//
// 用法：
//   node scripts/check-pr-judgement.mjs           CI / push 前（本地无 PR 正文时跳过）
//   node scripts/check-pr-judgement.mjs --gaps    体检：列出路由表里所有「工具还没建」的缺口
//
// 环境变量（给测试用）：PR_JUDGEMENT_BASE_REF 可信 base；PR_JUDGEMENT_REPO_ROOT 覆盖仓库根；PR_JUDGEMENT_CREATED_AT 覆盖 PR 创建时间；NOMI_PR_BODY 指定正文（见 prBody.mjs）。
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { escapeIdOfPath } from './escape-ledger-lib.mjs'
import { resolvePullRequestBody } from './lib/prBody.mjs'
import { addedLinesByFile, evaluatePrJudgement, loadRoutingTable, toolGaps } from './pr-judgement-lib.mjs'

const repoRoot = process.env.PR_JUDGEMENT_REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

function resolveBase() {
  const explicit = process.env.PR_JUDGEMENT_BASE_REF?.trim()
  if (explicit && !/^0+$/.test(explicit)) {
    try { git(['rev-parse', '--verify', `${explicit}^{commit}`]); return explicit } catch { /* 往下找 */ }
  }
  try { return git(['merge-base', 'HEAD', 'origin/main']).trim() } catch { return null }
}

function prCreatedAt() {
  if (process.env.PR_JUDGEMENT_CREATED_AT) return process.env.PR_JUDGEMENT_CREATED_AT // 测试用：不去问 gh（CI 里 gh 会取到真 PR 的创建时间）
  const number = String(process.env.NOMI_PR_NUMBER ?? '').trim()
  try {
    return JSON.parse(execFileSync('gh', ['pr', 'view', ...(number ? [number] : []), '--json', 'createdAt'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).createdAt || null
  } catch { return null }
}

function main() {
  if (process.argv.includes('--gaps')) {
    const gaps = toolGaps(loadRoutingTable(repoRoot))
    console.log(`测试路由体检：${gaps.length} 个工具缺口（tool: missing；PR 可写「未验证：工具未建」，但缺口在这里一直挂着）：`)
    for (const gap of gaps) console.log(`  · [${gap.category}] ${gap.id}：${gap.label}\n      ${gap.toolRef}`)
    return 0
  }
  const pr = resolvePullRequestBody({ cwd: repoRoot })
  if (!pr.available) {
    if (pr.required) {
      console.error(`✖ PR 正文取不到，无法判功能分类 / 验收证据 / 规则与门岗范围：${pr.reason}`)
      return 1
    }
    console.log(`⏭️ PR 正文判据跳过（${pr.reason}）`)
    return 0
  }
  const base = resolveBase()
  if (!base) {
    console.error('✖ 拿不到可信 base（merge-base(HEAD, origin/main)），无法判改动范围——不拿算不出来当通过')
    return 1
  }
  const nameStatus = git(['diff', '--name-status', '--no-renames', '-z', base, 'HEAD']).split('\0').filter(Boolean)
  const files = []
  for (let i = 0; i + 1 < nameStatus.length; i += 2) files.push({ path: nameStatus[i + 1], status: nameStatus[i][0] })
  // 新增行按文件取（AbortController 只在非测试文件里认，#1038）
  const addedByFile = addedLinesByFile(git(['diff', '-U0', '--no-renames', base, 'HEAD', '--', 'src', 'electron']))
  let packageRemovedLines = []
  if (files.some((file) => file.path === 'package.json')) {
    packageRemovedLines = git(['diff', '-U0', base, 'HEAD', '--', 'package.json']).split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).map((line) => line.slice(1))
  }
  // 逃逸账本一条一个文件：条目被删 = 条目文件在 base 有、HEAD 没有（name-status 的 D）。文件名就是 id，
  // 文件名和内容里的 id 对不上由 check:escape-ledger 报红，所以这里按文件名认 id 不会被改名绕过。
  const ledgerRemovedIds = files.filter((file) => file.status === 'D').map((file) => escapeIdOfPath(file.path)).filter(Boolean)
  const result = evaluatePrJudgement({ body: pr.body, files, addedByFile, packageRemovedLines, ledgerRemovedIds, createdAt: prCreatedAt() })
  const categories = result.inferred.categories.map((category) => category.label)
  console.log(`PR 正文判据（正文取自 ${pr.source}）：路径推出的类别 = ${categories.length ? categories.join('、') : '（无）'}`)
  for (const line of [...result.routing.lines, ...result.scope.lines]) console.log(line)
  if (result.blocked) {
    console.error('✖ PR 正文判据没过：先把 PR 正文改好（十秒），改完重跑这个 job 即可，不必重推。')
    return 1
  }
  console.log('✅ PR 正文判据通过')
  return 0
}

process.exitCode = main()
