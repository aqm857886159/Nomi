#!/usr/bin/env node
// 「先查别人」门岗（R27，2026-09-07）。判据住在 scripts/prior-art-lib.mjs；本文件只负责
// 扫盘、取 PR 正文、算 diff 行数、报红。
//
// 两条判据（详见 lib 头部）：
//   ① docs/plan/<日期>-*.md（日期 >= 2026-09-07）必须有「## 先查别人」节，节内 ≥3 条带出处的条目；
//   ② PR 改 src/ 或 electron/ 超过 300 行，正文必须引用一份合格的方案文档。
//   ③ 分层表（2026-09-17 起的方案必须带；PR 侧新增模块 >300 行或新增运行时依赖时，引用的方案必须带表，
//      豁免不算）。判据本体在 scripts/prior-art-layers-lib.mjs。
//
// PR 侧什么时候生效（fail-closed 的边界写死在这里，别靠猜）：
//   · CI 的 pull_request 事件：GITHUB_EVENT_NAME=pull_request 时**必查**，正文从 PRIOR_ART_PR_BODY
//     读（工作流在 contracts job 的 env 里注入）。正文为空 = 没引用 = 红。
//   · 本地：默认跳过（本地没有 PR 这个东西）；显式加 --pr 时用 `gh pr view --json body` 取当前
//     分支的 PR 正文，取不到就明说「今天没查成」并跳过，不假装通过。
//
// 用法：
//   node scripts/check-prior-art.mjs          计划文档侧 + （CI 里）PR 侧
//   node scripts/check-prior-art.mjs --pr     本地也走 PR 侧（用 gh 取正文）
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LAYER_NEW_MODULE_BUDGET, addedRuntimeDependencies, isTestPath } from './prior-art-layers-lib.mjs'
import {
  PRIOR_ART_DIFF_BUDGET,
  PRIOR_ART_THRESHOLD_DATE,
  evaluatePlans,
  evaluatePullRequest,
  evaluatePullRequestLayers,
  inspectPlan,
} from './prior-art-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLAN_DIR = path.join(repoRoot, 'docs', 'plan')
const DIFF_PATHS = ['src', 'electron']

const rel = (file) => path.relative(repoRoot, file).split(path.sep).join('/')

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function collectPlans() {
  const plans = new Map()
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.md')) plans.set(rel(full), fs.readFileSync(full, 'utf8'))
    }
  }
  walk(PLAN_DIR)
  return plans
}

/** 可信 base：显式 env（CI 注入）优先，否则 merge-base origin/main；都拿不到返回 null。 */
function resolveBase() {
  const explicit = process.env.PRIOR_ART_BASE_REF?.trim() || process.env.ROOT_CAUSE_BASE_REF?.trim()
  let base = null
  if (explicit && !/^0+$/.test(explicit)) {
    try {
      git(['rev-parse', '--verify', `${explicit}^{commit}`])
      base = explicit
    } catch {
      base = null
    }
  }
  if (!base) {
    try {
      base = git(['merge-base', 'HEAD', 'origin/main'])
    } catch {
      return null
    }
  }
  return base
}

/** src/ 与 electron/ 的增删行合计（相对可信 base）。取不到 base 就返回 null = 不判 PR 侧。 */
function changedProductionLines(base) {
  let numstat
  try {
    numstat = git(['diff', '--numstat', base, '--', ...DIFF_PATHS])
  } catch {
    return null
  }
  let total = 0
  for (const line of numstat.split('\n')) {
    const [added, removed] = line.split('\t')
    if (added === undefined) continue
    total += (Number.parseInt(added, 10) || 0) + (Number.parseInt(removed, 10) || 0)
  }
  return total
}

/**
 * 分层反查的两个 diff 信号：新增文件（-M 识别改名，改名不算新增；测试不算）的行数，
 * 与 package.json 新增的运行时依赖。取不到就返回 null = 不判，不拿算不出来当通过。
 */
function layerSignals(base) {
  try {
    let newModuleLines = 0
    const numstat = git(['diff', '--numstat', '-M', '--diff-filter=A', base, '--', ...DIFF_PATHS])
    for (const line of numstat.split('\n')) {
      const [added, , file] = line.split('\t')
      if (file === undefined || isTestPath(file)) continue
      newModuleLines += Number.parseInt(added, 10) || 0
    }
    let baseJson = ''
    try {
      baseJson = git(['show', `${base}:package.json`])
    } catch {
      baseJson = ''
    }
    const headJson = fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    return { newModuleLines, addedDependencies: addedRuntimeDependencies(baseJson, headJson) }
  } catch {
    return null
  }
}

function pullRequestBody() {
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    return { available: true, body: process.env.PRIOR_ART_PR_BODY ?? '' }
  }
  if (!process.argv.includes('--pr')) return { available: false, reason: '不在 pull_request 事件里，且未加 --pr' }
  try {
    const body = execFileSync('gh', ['pr', 'view', '--json', 'body', '--jq', '.body'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { available: true, body }
  } catch (error) {
    return { available: false, reason: `gh pr view 取不到正文：${error instanceof Error ? error.message.split('\n')[0] : String(error)}` }
  }
}

const plans = collectPlans()
/** 第三种出处（链接指向仓库里真实存在的文件）要真去看一眼——指不到的链接不算出处。 */
const fileExists = (candidate) => fs.existsSync(path.join(repoRoot, candidate))
const errors = evaluatePlans({ plans, threshold: PRIOR_ART_THRESHOLD_DATE, fileExists })
const optedOut = [...plans].filter(([file, markdown]) => inspectPlan(file, markdown, { fileExists }).layer === 'opted-out').map(([file]) => file)
const governed = [...plans.keys()].filter((file) => {
  const match = /(?:^|\/)(\d{4}-\d{2}-\d{2})-/.exec(file)
  return match && match[1] >= PRIOR_ART_THRESHOLD_DATE
})

const pr = pullRequestBody()
let prNote
if (!pr.available) {
  prNote = `⏭️ PR 侧跳过（${pr.reason}）`
} else {
  const base = resolveBase()
  const changedLines = base === null ? null : changedProductionLines(base)
  if (changedLines === null) {
    prNote = '⚠️ PR 侧无法计算改动行数（拿不到可信 base），本次不判 —— 不拿算不出来当通过'
  } else {
    prNote = `PR 侧：src/ + electron/ 改动 ${changedLines} 行（预算 ${PRIOR_ART_DIFF_BUDGET}）`
    errors.push(...evaluatePullRequest({ body: pr.body, changedLines, plans, fileExists }))
    const signals = layerSignals(base)
    if (signals === null) {
      prNote += '；⚠️ 分层反查拿不到新增文件/依赖信号，本次不判'
    } else {
      prNote += `；新增模块 ${signals.newModuleLines} 行（预算 ${LAYER_NEW_MODULE_BUDGET}）、新增运行时依赖 ${signals.addedDependencies.length} 个`
      errors.push(...evaluatePullRequestLayers({ body: pr.body, plans, fileExists, ...signals }))
    }
  }
}

if (errors.length > 0) {
  console.error('✖ 先查别人门岗失败（R27：实施之前必须有一份可复核的「别人做过没有」报告）：')
  for (const error of errors) console.error(`  - ${error}`)
  console.error('\n  → 报告落 docs/research/<日期>-<主题>/prior-art.md，结论抄进方案的「## 先查别人」节；')
  console.error('  → 派工 brief 必须引用那份方案的路径（详见 docs/engineering/agent-orchestration-playbook.md §16）。')
  process.exit(1)
}

console.log(`✅ 先查别人门岗：${governed.length} 份受管方案（阈值 ${PRIOR_ART_THRESHOLD_DATE}，共 ${plans.size} 份）；${prNote}`)
// 豁免不是静默的：每次都点名，漂移看得见（分层表判据，2026-09-17）
if (optedOut.length > 0) console.log(`   分层查豁免 ${optedOut.length} 份：${optedOut.join('、')}`)
