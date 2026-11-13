#!/usr/bin/env node
// 门岗（PR 正文判据族，CI 与 push 前都跑；档位见用法）：设计卡 / 独立验收 / 逃逸合同 + 功能分类决定的测试路由 + 规则与门岗的改动范围。
// 判据全在 scripts/pr-body-criteria.mjs（与 scripts/pr-judgement-lib.mjs），合并前扫描（scripts/merge-preflight.mjs）调同一份，
// 所以推送时判什么、合并前就判什么（#1094：两边口径不一，推送放行、合并才红）；这里只负责从本地 git 取数：
//   · PR 正文：scripts/lib/prBody.mjs 的唯一取法（pull_request 事件里必查、取不到 = 红；本地没有 PR 就跳过）；
//   · 改动文件 / 状态 / package.json 被删行 / 逃逸账本被删条目（条目文件被删）：对 merge-base(HEAD, origin/main) 做 git diff
//     （scripts/lib/prChanges.mjs，和合并前扫描同一个函数；输出格式钉死，本机的 color.ui / diff.noprefix 等配置改不了）；
//   · PR 创建时间（决定路由规则是否已生效）：gh pr view；取不到按已生效处理（fail-closed）。
//
// 用法：
//   node scripts/check-pr-judgement.mjs --stage=push    Quality Gate 的 Contracts（package.json 的 check:pr-judgement）：推送档
//   node scripts/check-pr-judgement.mjs --stage=merge   「PR Body」检查（.github/workflows/pr-body.yml）：合并档，正文一改就重判
//   node scripts/check-pr-judgement.mjs                 没写档位：CI 里按合并档；本机看 NOMI_PR_JUDGEMENT_STAGE（推送前钩子写 push）；本地无 PR 正文时跳过
//   node scripts/check-pr-judgement.mjs --gaps          体检：列出路由表里所有「工具还没建」的缺口
//
// 环境变量（给测试用）：PR_JUDGEMENT_BASE_REF 可信 base；PR_JUDGEMENT_REPO_ROOT 覆盖仓库根；PR_JUDGEMENT_CREATED_AT 覆盖 PR 创建时间；NOMI_PR_BODY 指定正文（见 prBody.mjs）。
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ESCAPE_LEDGER_DIR, escapeIdOfPath, loadEscapeLedger } from './escape-ledger-lib.mjs'
import { gitPaths } from './lib/gitPaths.mjs'
import { execGhReadSync } from './lib/transientRetry.mjs'
import { resolvePullRequestBody } from './lib/prBody.mjs'
import { evaluatePrBody, ledgerChanges, resolveJudgementStage, reviewedContracts, settledContracts } from './pr-body-criteria.mjs'
import { knownScenarios, scenarioEntriesFromReader } from './perf-scenarios-lib.mjs'
import { ROUTING_FILE } from './pr-judgement-lib.mjs'
import { loadRoutingTable, toolGaps } from './pr-judgement-lib.mjs'
import { prChanges } from './lib/prChanges.mjs'

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
  // 档位先定（写错的 --stage 当场报错，不等取到正文才发现）
  const stage = resolveJudgementStage(process.env, process.argv.slice(2))
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
  // 新增行按文件取（AbortController 只在非测试文件里认，#1038）；文件表 / 新增行 / package.json 被删行和合并前扫描同一个函数
  const { files, addedByFile, packageRemovedLines } = prChanges({ git, base, head: 'HEAD' })
  const show = (ref, file) => { try { return git(['show', `${ref}:${file}`]) } catch { return null } }
  // 逃逸账本一条一个文件：条目被删 = 条目文件在 base 有、HEAD 没有；转 fixed 看两版（同一份 ledgerChanges）。
  const ledger = { transitions: [], ids: [], removed: [], settledContracts: [], preparedContracts: [] }
  if (files.some((file) => escapeIdOfPath(file.path))) {
    const changes = ledgerChanges(files, (file, side) => show(side === 'base' ? base : 'HEAD', file))
    ledger.transitions = changes.transitions
    ledger.removed = changes.removed
    ledger.ids = gitPaths(['ls-tree', '--name-only', 'HEAD', `${ESCAPE_LEDGER_DIR}/`], { cwd: repoRoot }).map((name) => escapeIdOfPath(name)).filter(Boolean)
    if (stage === 'push') ledger.preparedContracts = reviewedContracts(files, (file) => show('HEAD', file), {
      hasCommit: (commit) => { try { git(['cat-file', '-e', `${commit}^{commit}`]); git(['merge-base', '--is-ancestor', commit, 'HEAD']); return true } catch { return false } },
    })
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
  // 性能场景 id：基线登记表（base 版本）∪ 本 PR 新增 / 改动的场景文件（HEAD 版本）；与合并前扫描同一个 knownScenarios（G-perfreg）
  const scenarioRe = /^tests\/perf\/scenarios\/[^/]+\.json$/
  const baseScenarioNames = gitPaths(['ls-tree', '--name-only', base, 'tests/perf/scenarios/'], { cwd: repoRoot }).filter((file) => scenarioRe.test(file)).map((file) => file.split('/').pop())
  const scenarios = knownScenarios({
    baseEntries: scenarioEntriesFromReader(baseScenarioNames, (name) => show(base, `tests/perf/scenarios/${name}`)),
    prFiles: files.filter((file) => file.status !== 'D' && scenarioRe.test(file.path)).map((file) => ({ file: file.path, content: show('HEAD', file.path) })),
    removedFiles: files.filter((file) => file.status === 'D' && scenarioRe.test(file.path)).map((file) => file.path),
  })
  // 政策表（路由表）取 base 版本：PR 不能放宽自己的路由要求（G-perfreg 分工：政策取 main，可扩充数据取 PR 头）
  const policyTable = JSON.parse(show(base, ROUTING_FILE) ?? 'null')
  if (!policyTable) {
    console.error(`✖ 拿不到 base 上的路由政策表（${ROUTING_FILE}），无法判——不拿 PR 头上的版本顶替`)
    return 1
  }
  const result = evaluatePrBody({ body: pr.body, files, addedByFile, packageRemovedLines, contracts, ledger, createdAt: prCreatedAt(), stage, scenarios, table: policyTable })
  const categories = result.judgement.inferred.categories.map((category) => category.label)
  console.log(`PR 正文判据（${stage === 'merge' ? '合并档' : '推送档'}，正文取自 ${pr.source}）：路径推出的类别 = ${categories.length ? categories.join('、') : '（无）'}`)
  for (const line of result.lines) console.log(line)
  if (result.blocked) {
    // 合并档跑在「PR Body」检查里，正文一改（edited）它自动重判；推送档跑在 Contracts 里，Quality Gate 只在推送时触发。
    console.error(stage === 'merge'
      ? '✖ PR 正文判据（合并档）没过：在 GitHub 上把 PR 正文改好即可，「PR Body」检查会自动重判，不必重推、不必点重跑。'
      : '✖ PR 正文判据（推送档）没过：这几项推送时就该写好。改好 PR 正文后重跑这个 job 即可，不必重推。')
    return 1
  }
  console.log(`✅ PR 正文判据通过（${stage === 'merge' ? '合并档' : '推送档：独立验收报告、账本 fixed 这类推送后才有的项只提醒，由「PR Body」检查判合并档'}）`)
  return 0
}

process.exitCode = main()
