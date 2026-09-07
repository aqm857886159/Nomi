#!/usr/bin/env node
// 框架接触面门岗（R29 第三份必交物，2026-09-07）。
//
// 守的不变量：**登记框架公开的每一个字段，我们都对它下过一条裁决。**
// 五种裁决，没有第六种：derived（派生点 file:line）/ constant（值 + 领域约束理由）/
// unused（为什么不用）/ upstream-default（默认值是什么）/ debt（带 owner 与到期日，黄；过期红）。
//
// 起因是一条真 bug：`electron/agentLane/laneTools.mts:175` 给**所有** lane 工具硬写
// `executionMode: 'sequential'`，而 pi 的 `AgentHarnessTool.executionMode` 逐工具可选
// （node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:351-359）。同一个对象字面量里
// `replay` 已经改成从 `mutates` 派生了——**做对的和做错的写在相邻两行**。当天早上刚交的
// 「参考实现逐层对照」（docs/research/2026-09-07-pi-reference-implementation-conformance.md）
// 一个字都没拦住：文档级对照看的是**层**，看不见**字段**。这道门看的就是字段。
//
// **框架无关**（2026-09-07 用户原话：「我们之后可能不是 pi，那之后是其他怎么办？」）：
// 本文件与判据里没有一个 pi 的符号。要对照谁，全在登记表 docs/engineering/framework-boundaries.json
// 的 `surface` 一格里；今天登记两条（pi / @xyflow/react）正是为了证明这一点。
// 换框架 = 加一条登记，不改一行判据。
//
// 用法：
//   node scripts/check-framework-surface.mjs           跑门岗
//   node scripts/check-framework-surface.mjs --seed    按代码事实生成裁决草稿（理由仍需人写）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateSurface, validateSurfaceRegistry } from './framework-surface-lib.mjs'
import { declaredFields, scanAssignments } from './framework-surface-extract.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY_FILE = path.join(repoRoot, 'docs/engineering/framework-boundaries.json')
const today = new Date().toISOString().slice(0, 10)

const registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'))

const registryErrors = validateSurfaceRegistry(registry)
if (registryErrors.length > 0) {
  console.error('✖ framework-boundaries.json 的 surface 登记不合法：')
  for (const error of registryErrors) console.error(`  - ${error}`)
  process.exit(1)
}

const declared = new Map()
const assignments = new Map()
const extractionErrors = []

for (const framework of registry.frameworks) {
  const surface = framework.surface
  if (!surface) continue
  for (const source of surface.sources) {
    for (const type of source.types) {
      const typeKey = `${framework.id}/${type.name}`
      try {
        declared.set(typeKey, declaredFields({ repoRoot, source, type }))
      } catch (error) {
        extractionErrors.push(`${typeKey}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      const sites = scanAssignments({
        repoRoot, frameworkId: framework.id, typeName: type.name,
        scope: surface.scope, anchors: type.anchors,
      })
      for (const [key, value] of sites) assignments.set(key, value)
    }
  }
}

if (extractionErrors.length > 0) {
  console.error('✖ 抽取失败（抽空了却放行 = 门岗静默失效，所以这里必须红）：')
  for (const error of extractionErrors) console.error(`  - ${error}`)
  process.exit(1)
}

if (process.argv.includes('--seed')) {
  seed()
  process.exit(0)
}

const { errors, warnings, stats } = evaluateSurface({
  registry, declared, assignments, today,
  fileExists: (relative) => fs.existsSync(path.join(repoRoot, relative)),
  readFile: (relative) => {
    const absolute = path.join(repoRoot, relative)
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null
  },
})

for (const warning of warnings) console.warn(`⚠️ [待裁] ${warning}`)

if (errors.length > 0) {
  console.error('✖ 框架接触面门岗失败（R29：框架公开的每个字段都要有一条裁决）：')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

const perFramework = registry.frameworks
  .filter((framework) => framework.surface)
  .map((framework) => {
    const count = framework.surface.sources
      .flatMap((source) => source.types)
      .reduce((sum, type) => sum + Object.keys(type.fields ?? {}).length, 0)
    return `${framework.id} ${count}`
  })
  .join(' / ')
const distribution = Object.entries(stats.byVerdict).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join('，')
console.log(`✅ 框架接触面门岗：${stats.fields} 个字段逐条有裁决（${perFramework}）；${distribution}`)

/**
 * 草稿模式。只按**代码事实**给出裁决骨架：找到动态赋值 → derived；只有字面量 → constant；
 * 一处都没有 → unused。理由（reason / why）一律留 TODO——机器判得了「有没有赋值」，
 * 判不了「为什么不用」。把理由也自动填上，登记表就退化成一份自动生成的读后感。
 */
function seed() {
  const draft = {}
  for (const framework of registry.frameworks) {
    if (!framework.surface) continue
    for (const source of framework.surface.sources) {
      for (const type of source.types) {
        const typeKey = `${framework.id}/${type.name}`
        const fields = {}
        for (const name of declared.get(typeKey) ?? []) {
          const sites = assignments.get(`${typeKey}::${name}`) ?? []
          const dynamic = sites.find((site) => !site.literal)
          const literal = sites.find((site) => site.literal)
          if (dynamic) fields[name] = { verdict: 'derived', at: `${dynamic.file}:${dynamic.line}` }
          else if (literal) fields[name] = { verdict: 'constant', value: literal.text, reason: 'TODO' }
          else fields[name] = { verdict: 'unused', why: 'TODO' }
        }
        draft[typeKey] = fields
      }
    }
  }
  console.log(JSON.stringify(draft, null, 2))
}
