#!/usr/bin/env node
// 框架边界门岗（R29，2026-09-07）。守一条不变量：**框架已经提供的能力，仓库里不许再长一份自研版本**。
//
// 起因（2026-09-06 深夜 #546 架构评审）：接 pi SDK 时只接了最底层的 agent loop，
// pi 已经提供的会话持久化、有序转录、重试、价格、steer/followUp，我们各自又写了一套，而且更差。
// 研究是做过的——结论只落在文档里，没有进任何门岗，于是每个实施 agent 只看自己那一块，
// 谁都不知道「这块框架已经有了」。**没进门岗的研究结论，在下一个 agent 眼里等于不存在。**
//
// 判据住在 scripts/framework-boundary-lib.mjs（可被 node-test 喂假仓库）；本文件只负责
// 读登记表、扫盘、比基线、报红。登记表 = docs/engineering/framework-boundaries.json。
//
// 用法：
//   node scripts/check-framework-boundary.mjs                  跑门岗
//   node scripts/check-framework-boundary.mjs --update-baseline 重写债基线（只在登记新框架时用，且必须人工复核 diff）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, scanSources, validateRegistry } from './framework-boundary-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY_FILE = path.join(repoRoot, 'docs/engineering/framework-boundaries.json')
const BASELINE_FILE = path.join(repoRoot, 'scripts/framework-boundary-baseline.json')
const SOURCE_EXTENSIONS = /\.(tsx?|mts|cts)$/
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-electron', '.tmp', '.git'])
const TEST_FILE = /\.(test|spec|node-test)\.[cm]?[jt]sx?$/

const rel = (file) => path.relative(repoRoot, file).split(path.sep).join('/')

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    console.error(`✖ 无法解析 ${rel(file)}：${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

/** 只读登记表里声明过的 scope，不做全仓扫描——噪音是门岗的死因（heavy-path 教训）。 */
function collectSources(registry) {
  const prefixes = new Set()
  for (const framework of registry.frameworks) {
    for (const capability of framework.capabilities) {
      for (const prefix of capability.scope) prefixes.add(prefix)
    }
  }
  const sources = new Map()
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (SOURCE_EXTENSIONS.test(entry.name) && !TEST_FILE.test(entry.name)) {
        sources.set(rel(full), fs.readFileSync(full, 'utf8'))
      }
    }
  }
  for (const prefix of prefixes) walk(path.join(repoRoot, prefix))
  return sources
}

const registry = readJson(REGISTRY_FILE)
const registryErrors = validateRegistry(registry)
if (registryErrors.length > 0) {
  console.error(`✖ ${rel(REGISTRY_FILE)} 登记表不合法：`)
  for (const error of registryErrors) console.error(`  - ${error}`)
  process.exit(1)
}

const hits = scanSources(collectSources(registry), registry)

if (process.argv.includes('--update-baseline')) {
  const debt = [...hits.values()]
    .sort((a, b) => a.identity.localeCompare(b.identity))
    .map((hit) => ({
      identity: hit.identity,
      hits: hit.hits,
      note: `${hit.file}:${hit.line} — ${hit.why}`,
      plan: 'docs/plan/2026-09-07-agent-runtime-rebuild.md',
      due: '2026-11-07',
    }))
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify({
    _comment: [
      '框架边界棘轮基线（R29）：登记的是**债**，不是豁免。只减不增。',
      '每条债必须绑一份收敛方案文档（plan）和一个到期日（due）——到期不清零就报红。',
      '身份 = 框架/能力/规则::文件路径；带命中数，挡住「删一处、同 commit 加一处」。',
      '新增命中不许追加到这里：先按 R29 出四列表，证明框架真的不提供这个能力。',
    ],
    debt,
  }, null, 2)}\n`)
  console.log(`✅ 已重写 ${rel(BASELINE_FILE)}：${debt.length} 条债（请人工复核 diff 再提交）`)
  process.exit(0)
}

const baseline = readJson(BASELINE_FILE)
const today = new Date().toISOString().slice(0, 10)
const errors = evaluate({ hits, baseline, today })

// 方案文档缺失只出提醒不阻断：收敛方案常常还在在途分支上，而门岗拦不住的东西不该假装拦得住。
const missingPlans = new Map()
for (const entry of Array.isArray(baseline.debt) ? baseline.debt : []) {
  if (typeof entry?.plan !== 'string' || !entry.plan) continue
  if (fs.existsSync(path.join(repoRoot, entry.plan))) continue
  missingPlans.set(entry.plan, (missingPlans.get(entry.plan) ?? 0) + 1)
}
for (const [plan, count] of missingPlans) {
  console.warn(`⚠️ ${count} 条债的收敛方案尚未落到本分支：${plan}`)
}

if (errors.length > 0) {
  console.error('✖ 框架边界门岗失败（R29：框架已提供的能力不许再长一份自研版本）：')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

const frameworks = registry.frameworks.length
const capabilities = registry.frameworks.reduce((sum, framework) => sum + framework.capabilities.length, 0)
console.log(`✅ 框架边界门岗：${frameworks} 个框架 / ${capabilities} 项能力，${baseline.debt.length} 条债在册且未过期`)
