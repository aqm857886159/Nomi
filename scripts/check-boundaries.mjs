#!/usr/bin/env node
// 分层边界门岗（R21）—— 落实 CLAUDE.md 规则 21（禁反向/循环，边界只减不增）。
//
// 抓的是一类**当场编译还过、但把架构越拆越糊**的退化：
//   · 渲染层（src/）直接 import 主进程（electron/）——把主进程常量/函数打进渲染 bundle，
//     或伸手进 electron/ 拿本该住中立契约层的类型；
//   · 主进程反向 import 渲染层（当前 0，硬零）；
//   · 新增「完全静态」循环依赖——真·加载顺序炸弹（软的懒加载 import() 环不算，见下）。
//
// 机制（棘轮，只减不增，与 filesize / archetype-sources / heavy-path 同款纪律）：
//   1. 规则住 .dependency-cruiser.mjs（forbidden 数组，方向禁令）。
//   2. 存量违规的具体身份冻结在 scripts/boundaries-baseline.json——**存身份不存裸数字**：
//      裸数字会放过「修一条旧的、同 commit 新增一条」蒙混，身份差集才拦得住。
//   3. 本脚本跑 depcruise → 拿违规 → 与 baseline 求差集：
//        · 新增违规（不在 baseline）→ 红牌，当场拦。
//        · baseline 里已消失的违规 → 红牌，要求同步删 baseline 那行（否则成永久豁免）。
//
// 为什么用 dependency-cruiser：唯一一个「能出循环 + fan-in/out 且能把分层规则写成
// forbidden 规则、导出机读 JSON」的现役工具，一把兼「审计」和「门岗」。见审计分析二。
//
// 循环的软/硬之分（R17 教训：被忽略的门岗等于不存在）：
//   全仓约 495 个 distinct 循环，其中绝大多数经由**故意的懒加载 import()** 边
//   （registry.ts 把节点类型 lazy-map 到 BaseGenerationNode），运行期不是硬环。
//   把这些也拦 = 门岗永红被无视。所以规则用 viaOnly dependencyTypesNot=[dynamic-import,
//   type-only] 只认「每条环边都非懒加载、非纯类型」的静态硬环——当前 6 个，进 baseline 冻结。
//
// 用法：
//   node ./scripts/check-boundaries.mjs                    校验（棘轮）
//   node ./scripts/check-boundaries.mjs --update-baseline  重算冻结基线（只在真降/初始化时用）

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cruise } from 'dependency-cruiser'
import extractTSConfig from 'dependency-cruiser/config-utl/extract-ts-config'
import ruleConfig from '../.dependency-cruiser.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = path.join(repoRoot, 'scripts', 'boundaries-baseline.json')
const CRUISE_TARGETS = ['src', 'electron', 'workers']

// 循环违规的规则名（其余方向违规用 from->to 直接当身份）。
const CIRCULAR_RULE = 'no-new-static-circular'

/**
 * 循环的稳定身份 = 成员模块名去重后排序、竖线连接。
 *
 * 为什么不用 depcruise 报的 (from,to) 入口边：同一个逻辑环，depcruise 可能因图的
 * 细微变化从不同入口边报出来，用入口边当身份会造成假 churn。成员集合在旋转/方向上
 * 都不变，是这个环的唯一指纹。
 */
function circularIdentity(violation) {
  const members = [violation.from, ...(violation.cycle ?? []).map((c) => c.name)]
  return [...new Set(members)].sort().join(' | ')
}

/** 方向违规（src→electron 等）的身份 = from -> to（已解析的模块路径，稳定）。 */
function directionalIdentity(violation) {
  return `${violation.from} -> ${violation.to}`
}

/** 一条违规的身份：循环用成员集合，其余用 from->to。 */
function identityOf(violation) {
  return violation.rule.name === CIRCULAR_RULE
    ? circularIdentity(violation)
    : directionalIdentity(violation)
}

/** 循环违规附带人可读的环路径，方便 baseline 里一眼看出是哪个环。 */
function readableCycle(violation) {
  const path0 = [violation.from, ...(violation.cycle ?? []).map((c) => c.name)]
  return path0.join(' -> ')
}

async function runCruise() {
  const tsConfig = extractTSConfig(path.join(repoRoot, 'tsconfig.base.json'))
  const cruiseOptions = {
    ...ruleConfig.options,
    validate: true,
    ruleSet: { forbidden: ruleConfig.forbidden },
    outputType: 'json',
  }
  const targets = CRUISE_TARGETS.map((t) => path.join(repoRoot, t))
  const result = await cruise(targets, cruiseOptions, undefined, { tsConfig })
  const output = typeof result.output === 'string' ? JSON.parse(result.output) : result.output
  return output
}

/**
 * depcruise 返回的模块路径是绝对路径（因为我们传的是绝对 target）。归一成仓库相对，
 * 让 baseline 身份在不同机器/worktree 上一致。
 */
function toRepoRelative(p) {
  if (!p) return p
  const abs = path.isAbsolute(p) ? p : path.join(repoRoot, p)
  return path.relative(repoRoot, abs).split(path.sep).join('/')
}

function normalizeViolation(v) {
  return {
    ...v,
    from: toRepoRelative(v.from),
    to: toRepoRelative(v.to),
    cycle: (v.cycle ?? []).map((c) => ({ ...c, name: toRepoRelative(c.name) })),
  }
}

/** 收集违规，按规则名分桶，每桶是 { identity: readable } 映射（readable 供 baseline 展示）。 */
function collectViolations(output) {
  const buckets = {}
  for (const raw of output.summary.violations) {
    const v = normalizeViolation(raw)
    const rule = v.rule.name
    const id = identityOf(v)
    const readable = rule === CIRCULAR_RULE ? readableCycle(v) : id
    buckets[rule] ??= new Map()
    // 同一身份可能被 depcruise 从多入口重复报（尤其循环）；Map 天然去重。
    if (!buckets[rule].has(id)) buckets[rule].set(id, readable)
  }
  return buckets
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return null
  const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  for (const [rule, entry] of Object.entries(parsed)) {
    if (rule.startsWith('_')) continue
    // 循环规则存 { canonicalKey: readablePath } 对象；其余规则存字符串数组。
    if (rule === CIRCULAR_RULE) {
      const ok = entry && typeof entry === 'object' && !Array.isArray(entry) &&
        Object.values(entry).every((v) => typeof v === 'string')
      if (!ok) {
        console.error(`✖ ${rel(baselinePath)} 的 "${rule}" 必须是 { 身份: 环路径 } 对象`)
        process.exit(1)
      }
    } else if (!Array.isArray(entry) || entry.some((v) => typeof v !== 'string')) {
      console.error(`✖ ${rel(baselinePath)} 的 "${rule}" 必须是字符串数组`)
      process.exit(1)
    }
  }
  return parsed
}

function writeBaseline(buckets) {
  const out = {
    _comment: [
      '分层边界棘轮基线（R21）：只减不增。',
      '规则住 .dependency-cruiser.mjs；本文件冻结存量违规的具体身份（非裸数字）。',
      'src-no-import-electron / electron-no-import-src / src-no-import-scripts 身份 = "from -> to"。',
      'no-new-static-circular 身份 = 成员模块去重排序（前缀），值是人可读的环路径。',
      '修掉一条违规必须同步删这里对应一行；新增违规当场报红，不许追加到本文件。',
    ],
  }
  // 循环存 { canonicalKey: readablePath }；其余存字符串数组（身份即可读）。
  for (const rule of RULE_ORDER) {
    const bucket = buckets[rule]
    if (!bucket || bucket.size === 0) continue
    if (rule === CIRCULAR_RULE) {
      out[rule] = Object.fromEntries([...bucket.entries()].sort(([a], [b]) => a.localeCompare(b)))
    } else {
      out[rule] = [...bucket.keys()].sort()
    }
  }
  fs.writeFileSync(baselinePath, `${JSON.stringify(out, null, 2)}\n`)
}

/** baseline 里某规则的身份集合（循环是对象的 key，其余是数组元素）。 */
function baselineIdentities(baseline, rule) {
  const entry = baseline[rule]
  if (!entry) return new Set()
  return new Set(Array.isArray(entry) ? entry : Object.keys(entry))
}

const RULE_ORDER = [
  'src-no-import-electron',
  // 设计实验室那条（R-B5）没有 baseline 条目：它当前零违规，是硬零规则。
  // 但**必须列在这里**——本脚本只统计 RULE_ORDER 里的规则名，漏列 = 规则写了没人看。
  'devlab-no-import-electron-impl',
  'electron-no-import-src',
  'src-no-import-scripts',
  CIRCULAR_RULE,
]

function rel(p) {
  return path.relative(repoRoot, p).split(path.sep).join('/')
}

async function main() {
  const output = await runCruise()
  const buckets = collectViolations(output)
  const updateBaseline = process.argv.includes('--update-baseline')

  if (updateBaseline) {
    writeBaseline(buckets)
    const counts = RULE_ORDER.map((r) => `${r}=${buckets[r]?.size ?? 0}`).join(', ')
    console.log(`✅ 已重算分层边界基线：${counts}`)
    console.log(`   → ${rel(baselinePath)}`)
    process.exit(0)
  }

  const baseline = readBaseline()
  if (baseline === null) {
    console.error(`✖ 缺少 ${rel(baselinePath)}；先核对实扫结果，再用 --update-baseline 初始化存量`)
    process.exit(1)
  }

  const added = [] // 新增违规（不在 baseline）
  const removed = [] // baseline 里已消失的（要求删行）

  for (const rule of RULE_ORDER) {
    const current = buckets[rule] ?? new Map()
    const frozen = baselineIdentities(baseline, rule)

    for (const [id, readable] of current) {
      if (!frozen.has(id)) added.push({ rule, id, readable })
    }
    for (const id of frozen) {
      if (!current.has(id)) removed.push({ rule, id })
    }
  }

  const totalCurrent = RULE_ORDER.reduce((n, r) => n + (buckets[r]?.size ?? 0), 0)
  const totalFrozen = RULE_ORDER.reduce((n, r) => n + baselineIdentities(baseline, r).size, 0)
  console.log(`scanned=${output.summary.totalCruised}`)
  console.log(
    `分层边界：${output.summary.totalCruised} 模块；当前 ${totalCurrent} 处越界/硬环；基线冻结 ${totalFrozen} 处（棘轮只减不增）`,
  )

  if (added.length > 0) {
    console.error(`\n✖ 分层边界回归：${added.length} 处**新增**违规（不在基线里）：`)
    for (const { rule, readable } of added) console.error(`   · [${rule}] ${readable}`)
    console.error('')
    console.error('  这类越界当场能编译、却把架构越拆越糊（渲染 bundle 打进主进程码 / 加载顺序炸弹）。')
    console.error('  修法：渲染层走 desktop bridge 或中立契约层 electron/shared/contracts/；')
    console.error('        循环用依赖反转（引契约/事件）打断。参见 docs/architecture/module-ownership-map.md。')
    console.error('  绝不允许把新违规追加进 boundaries-baseline.json 抬高基线。')
    process.exit(1)
  }

  if (removed.length > 0) {
    console.error(`\n✖ 基线过期：${removed.length} 处违规已消失，但仍留在基线里（成了永久豁免）：`)
    for (const { rule, id } of removed) console.error(`   · [${rule}] ${id}`)
    console.error('')
    console.error(`  你修好了一处边界——请从 ${rel(baselinePath)} 删掉对应行以锁定战果（棘轮只减不增）。`)
    console.error('  或直接跑：node ./scripts/check-boundaries.mjs --update-baseline')
    process.exit(1)
  }

  console.log('✅ 分层边界棘轮通过（无新增越界/硬环；基线只减不增）。')
}

main().catch((err) => {
  console.error('✖ check:boundaries 运行失败：', err?.stack || err)
  process.exit(1)
})
