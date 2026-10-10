#!/usr/bin/env node
// 门岗（PR 正文判据族，CI 与 push 前都跑）：设计卡 / 独立验收 / 逃逸合同 + 功能分类决定的测试路由 + 规则与门岗的改动范围。
// 判据全在 scripts/pr-body-criteria.mjs（与 scripts/pr-judgement-lib.mjs），合并前扫描（scripts/merge-preflight.mjs）调同一份，
// 所以推送时判什么、合并前就判什么（#1094：两边口径不一，推送放行、合并才红）；这里只负责从本地 git 取数：
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

import { ESCAPE_LEDGER_DIR, escapeIdOfPath, loadEscapeLedger } from './escape-ledger-lib.mjs'
import { gitPaths } from './lib/gitPaths.mjs'
import { execGhReadSync } from './lib/transientRetry.mjs'
import { resolvePullRequestBody } from './lib/prBody.mjs'
import { evaluatePrBody, ledgerChanges, resolveJudgementStage, settledContracts } from './pr-body-criteria.mjs'
import { addedLinesByFile, loadRoutingTable, toolGaps } from './pr-judgement-lib.mjs'

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
    return JSON.parse(execGhReadSync(['pr', 'view', ...(number ? [number] : []), '--json', 'createdAt'], { cwd: repoRoot })).createdAt || null
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
  // 新增行按文件取（AbortController 只在非测试文件里认，#1038）；全量 diff，与合并前扫描同一口径
  const addedByFile = addedLinesByFile(git(['diff', '-U0', '--no-renames', base, 'HEAD']))
  let packageRemovedLines = []
  if (files.some((file) => file.path === 'package.json')) {
    packageRemovedLines = git(['diff', '-U0', base, 'HEAD', '--', 'package.json']).split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).map((line) => line.slice(1))
  }
  const show = (ref, file) => { try { return git(['show', `${ref}:${file}`]) } catch { return null } }
  // 逃逸账本一条一个文件：条目被删 = 条目文件在 base 有、HEAD 没有；转 fixed 看两版（同一份 ledgerChanges）。
  const ledger = { transitions: [], ids: [], removed: [], settledContracts: [] }
  if (files.some((file) => escapeIdOfPath(file.path))) {
    const changes = ledgerChanges(files, (file, side) => show(side === 'base' ? base : 'HEAD', file))
    ledger.transitions = changes.transitions
    ledger.removed = changes.removed
    ledger.ids = gitPaths(['ls-tree', '--name-only', 'HEAD', `${ESCAPE_LEDGER_DIR}/`], { cwd: repoRoot }).map((name) => escapeIdOfPath(name)).filter(Boolean)
  }
  const contracts = files
    .filter((file) => file.status !== 'D' && /^docs\/fixes\/.+\.root-cause\.json$/.test(file.path))
    .map((file) => {
      let detectedBy
      try { detectedBy = JSON.parse(show('HEAD', file.path)).detected_by } catch { detectedBy = undefined }
      return { file: file.path, added: file.status === 'A', detected_by: detectedBy }
    })
  // 「修订已结账的合同」才需要知道 base 上哪些合同已结账
  if (contracts.some((contract) => !contract.added && ['user', 'post-release'].includes(contract.detected_by)) && ledger.transitions.length === 0) {
    try { ledger.settledContracts = settledContracts(loadEscapeLedger(repoRoot, { ref: base })) } catch { /* 取不到 = 不当已结账（fail-closed） */ }
  }
  const result = evaluatePrBody({ body: pr.body, files, addedByFile, packageRemovedLines, contracts, ledger, createdAt: prCreatedAt(), stage: resolveJudgementStage() })
  const categories = result.judgement.inferred.categories.map((category) => category.label)
  console.log(`PR 正文判据（正文取自 ${pr.source}）：路径推出的类别 = ${categories.length ? categories.join('、') : '（无）'}`)
  for (const line of result.lines) console.log(line)
  if (result.blocked) {
    console.error('✖ PR 正文判据没过：先把 PR 正文改好（十秒），改完重跑这个 job 即可，不必重推。')
    return 1
  }
  console.log('✅ PR 正文判据通过')
  return 0
}

process.exitCode = main()
