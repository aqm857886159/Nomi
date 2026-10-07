#!/usr/bin/env node
// 「先查别人」门岗（R27，2026-09-07；2026-10-01 P0 改判）。判据住在 scripts/prior-art-lib.mjs；本文件只负责
// 扫盘、取 PR 正文、对比自写登记表的 base / head、报红。
//
// 两条判据（详见 lib 头部）：
//   ① docs/plan/<日期>-*.md（日期 >= 2026-09-07）**如果写了**「## 先查别人」一节，节内 ≥3 条带出处的条目
//      （没写不红：领域方案没有现成的可查）；
//   ② PR 新增 / 修改了自写登记表（docs/engineering/self-written.json 的 entries 或 domainRoots，
//      也就是引入了通用能力）时，正文必须引用一份合格的方案、或自己带一节合格的「先查别人」。
//      （旧的「src/ + electron/ 改动超过 300 行」那一条已删：按行数计费，领域工作被逼着写「查过了，没有」。）
//
// PR 正文怎么取、什么时候必查，只有一个 owner：scripts/lib/prBody.mjs（抬头写清了为什么
// 不再读事件负载——那份正文是 push 那一刻的快照，push 后补正文会被判成没写，白烧一轮 CI）。
//
// 用法：
//   node scripts/check-prior-art.mjs          计划文档侧 + （CI 里）PR 侧
//   node scripts/check-prior-art.mjs --pr     本地也走 PR 侧（用 gh 取正文）
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitPaths } from './lib/gitPaths.mjs'
import { resolvePullRequestBody } from './lib/prBody.mjs'
import {
  PRIOR_ART_THRESHOLD_DATE,
  evaluatePlans,
  evaluatePullRequest,
  scopePlansToChanged,
} from './prior-art-lib.mjs'
import { SELF_WRITTEN_FILE, registryChanges } from './self-written-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLAN_DIR = path.join(repoRoot, 'docs', 'plan')

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

/** 可信 base：显式给的优先，否则 merge-base(HEAD, origin/main)；拿不到返回 null = 不判 PR 侧。 */
function resolveBase() {
  const explicit = process.env.PRIOR_ART_BASE_REF?.trim() || process.env.ROOT_CAUSE_BASE_REF?.trim()
  if (explicit && !/^0+$/.test(explicit)) {
    try {
      git(['rev-parse', '--verify', `${explicit}^{commit}`])
      return explicit
    } catch { /* 往下找 */ }
  }
  try {
    return git(['merge-base', 'HEAD', 'origin/main'])
  } catch {
    return null
  }
}

/** 这个 diff 有没有新增 / 修改自写登记表的 entry 或 domainRoots。null = 算不出来（不拿算不出来当通过）。 */
function registryChangedInDiff() {
  const base = resolveBase()
  if (!base) return null
  let baseRegistry = {}
  try {
    baseRegistry = JSON.parse(git(['show', `${base}:${SELF_WRITTEN_FILE}`]))
  } catch { /* base 上还没有登记表：整份都算新增 */ }
  let headRegistry
  try {
    headRegistry = JSON.parse(fs.readFileSync(path.join(repoRoot, SELF_WRITTEN_FILE), 'utf8'))
  } catch {
    return null
  }
  return registryChanges(baseRegistry, headRegistry)
}

const plans = collectPlans()
/** 第三种出处（链接指向仓库里真实存在的文件）要真去看一眼——指不到的链接不算出处。 */
const fileExists = (candidate) => fs.existsSync(path.join(repoRoot, candidate))
/** 本次改动动过的 docs/plan/*.md（含未跟踪）；算不出 base 返回 null。 */
function changedPlanFiles() {
  const base = resolveBase()
  if (!base) return null
  try {
    const names = new Set(gitPaths(['diff', '--no-renames', '--name-only', base, '--', 'docs/plan'], { cwd: repoRoot }))
    for (const name of gitPaths(['ls-files', '--others', '--exclude-standard', '--', 'docs/plan'], { cwd: repoRoot })) names.add(name)
    return new Set([...names].map((name) => name.trim()).filter((name) => name.endsWith('.md')))
  } catch {
    return null
  }
}
const errors = evaluatePlans({ plans: scopePlansToChanged(plans, changedPlanFiles()), threshold: PRIOR_ART_THRESHOLD_DATE, fileExists })
const governed = [...plans.keys()].filter((file) => {
  const match = /(?:^|\/)(\d{4}-\d{2}-\d{2})-/.exec(file)
  return match && match[1] >= PRIOR_ART_THRESHOLD_DATE
})

const pr = resolvePullRequestBody({ cwd: repoRoot })
let prNote
if (!pr.available) {
  // 取不到正文而本来必查（pull_request 事件）→ 红。拿不到证据就说拿不到，不假装通过。
  if (pr.required) errors.push(`PR 正文取不到，无法判「登记表变了有没有查证」：${pr.reason}`)
  prNote = `⏭️ PR 侧跳过（${pr.reason}）`
} else {
  const changes = registryChangedInDiff()
  if (changes === null) {
    prNote = '⚠️ PR 侧无法对比自写登记表（拿不到可信 base 或登记表读不出），本次不判 —— 不拿算不出来当通过'
  } else if (!changes.changed) {
    prNote = 'PR 侧：没有新增通用能力（自写登记表未变），不要求查证'
  } else {
    prNote = `PR 侧：自写登记表有变化（entries：${changes.changedEntries.join('、') || '无'}；新增领域目录：${changes.addedRoots.join('、') || '无'}），要求查证`
    errors.push(...evaluatePullRequest({ body: pr.body, registryChanged: true, plans, fileExists }))
  }
}

if (errors.length > 0) {
  console.error('✖ 先查别人门岗失败（P0：自写通用能力必须有可复核的「别人有没有现成的」查证）：')
  for (const error of errors) console.error(`  - ${error}`)
  console.error('\n  → 查证写成「## 先查别人」一节（≥3 条带 URL 或 file:line 的出处），放在方案里并在 PR 正文引用，或直接写在 PR 正文里；')
  console.error('  → 详见 docs/engineering/agent-orchestration-playbook.md §16、docs/engineering-rules.md R5。')
  process.exit(1)
}

console.log(`scanned=${governed.length}`)
console.log(`✅ 先查别人门岗：${governed.length} 份受管方案（阈值 ${PRIOR_ART_THRESHOLD_DATE}，共 ${plans.size} 份；方案里写了这一节的必须像样）；${prNote}`)
