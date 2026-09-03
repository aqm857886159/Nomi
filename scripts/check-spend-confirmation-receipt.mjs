#!/usr/bin/env node
// 花钱确认收据门岗：确认面**声称**放行的每一条出口，必须同时交出收据。
//
// 为什么存在（2026-09-03 编排者亲自栽的跟头）：`mcpGateConfirmation.ts` 决定「这次花钱的确认弹在哪、
// 算不算数」，但**它并不是最终放行者**——真正放行要过下游两道硬约束：
//   · electron/capabilityCore/mcpSemanticGenerationFlow.ts —— `!receiptId && !receiptToken` 即回 human_approval_required
//   · electron/capabilityCore/generationDispatcher.ts —— 原话「Approval booleans cannot replace a Nomi human approval receipt」
//
// 这两处离得远，改确认面时看不见。当天就因此判断错：把签发点的 `clientAttestation:true` 读成「要求一种
// 没人能提供的凭证 = 半成品开关」，删掉它让「光秃秃的同意就地算数」这条分支可达。单测全绿、门禁全绿，
// 但真机走查（打包版 + 真 Codex 客户端）显示净效果更糟——elicitation 帧确实弹到客户端、用户也点了同意，
// 然后 gate 回 human_approval_required，生成压根没开始；而改动前用户至少还能去 Nomi 点一下把它跑完。
//
// 判据（结构性，不看名字）：扫 `mcpGateConfirmation.ts` 里所有 `confirmed: true` 的返回对象字面量，
// 每一个都必须在同一个对象里出现 receiptId 或 receiptToken（可以是条件展开）。唯一豁免是 'nomi' 兜底面
// ——它把下游铸出的收据原样透传，形状由 confirmGenerationInNomi 决定，本门岗管不到也不该管。
//
// 这道门拦不住什么，要说清楚：它只保证「声称放行 ⇒ 带收据」，**不保证收据是真的**（真伪由主进程铸造与
// 校验负责），也不保证下游一定接受。它防的是本次这一族：在确认层擅自放宽，而放行条件在别处。

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const TARGET = 'electron/capabilityCore/mcpGateConfirmation.ts'
// 下游真正的放行者：它们的存在就是本门岗的理由，路径变了要同步（找不到即报红，不静默通过）。
const DOWNSTREAM = [
  'electron/capabilityCore/mcpSemanticGenerationFlow.ts',
  'electron/capabilityCore/generationDispatcher.ts',
]

function read(relative) {
  const absolute = path.join(repoRoot, relative)
  if (!fs.existsSync(absolute)) {
    console.error(`✗ 花钱确认收据门岗：受检文件不存在：${relative}`)
    console.error('  → 文件被挪走或改名了。同步本门岗的路径，别让它静默失效。')
    process.exit(1)
  }
  return fs.readFileSync(absolute, 'utf8')
}

// 下游约束还在不在——它不在了，本门岗就没有存在理由，应当一起复审而不是继续空转。
for (const relative of DOWNSTREAM) {
  const source = read(relative)
  if (!/receiptId|receiptToken/.test(source)) {
    console.error(`✗ 花钱确认收据门岗：${relative} 里已经找不到收据约束了`)
    console.error('  → 下游若真的不再要求收据，本门岗和它的合同要一起复审后再删，不许只删门岗。')
    process.exit(1)
  }
}

const source = read(TARGET)

// 扫所有 `confirmed: true` 出现处，取其所在的返回对象字面量（从最近的 `{` 起做括号配对）。
const offenders = []
let checked = 0
for (const match of source.matchAll(/confirmed:\s*true/g)) {
  // 往回找这个对象字面量的开括号
  let start = -1
  let depth = 0
  for (let i = match.index; i >= 0; i -= 1) {
    if (source[i] === '}') depth += 1
    else if (source[i] === '{') {
      if (depth === 0) { start = i; break }
      depth -= 1
    }
  }
  if (start < 0) continue
  // 往后配对到闭括号
  let end = -1
  depth = 0
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') { depth -= 1; if (depth === 0) { end = i; break } }
  }
  if (end < 0) continue
  const objectText = source.slice(start, end + 1)
  checked += 1
  if (/surface:\s*'nomi'/.test(objectText)) continue // 兜底面透传下游收据，豁免（理由见文件头）
  if (/receiptId|receiptToken/.test(objectText)) continue
  const line = source.slice(0, start).split('\n').length
  offenders.push({ line, snippet: objectText.replace(/\s+/g, ' ').slice(0, 110) })
}

if (checked === 0) {
  console.error(`✗ 花钱确认收据门岗：在 ${TARGET} 里一个 \`confirmed: true\` 都没扫到——形状变了，门岗已失效`)
  process.exit(1)
}

console.log(`花钱确认收据门岗：扫 ${TARGET} 的 ${checked} 处 confirmed:true 出口`)

// 棘轮 + **守卫核验**（后者才是本门岗的要害）。
//
// 只数「无收据出口有几条」是不够的——2026-09-03 那次错误改动并没有新增出口，它只是把一条既有出口
// 从「够不着」变成了「每次都走」（删掉 `clientAttestation !== true` 这个守卫）。计数不变，棘轮看不见。
// 所以基线每条必须登记它赖以「够不着」的**守卫表达式**，门岗逐字核验守卫还在不在：守卫被删或被改写
// = 该出口变得可达 = 当场报红。
const baselinePath = path.join(repoRoot, 'scripts', 'spend-confirmation-receipt-baseline.json')
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const allowedList = Array.isArray(baseline.allowed) ? baseline.allowed : []
const allowedCount = allowedList.length

// 守卫核验：基线里每条登记的守卫表达式必须仍然逐字存在于源码中。
const brokenGuards = allowedList.filter((entry) => !source.includes(String(entry.condition || '')))
if (brokenGuards.length) {
  console.error(`✗ 花钱确认收据门岗失败：${brokenGuards.length} 条无收据出口的守卫不见了 —— 它们现在可达`)
  for (const entry of brokenGuards) {
    console.error(`  守卫表达式已失配：${entry.condition}`)
    console.error(`    为什么它重要：${entry.why}`)
  }
  console.error('  → 删掉这个守卫 = 用户在客户端点完同意后撞 human_approval_required，生成压根不开始。')
  console.error('  → 2026-09-03 真机走查复现过这个净效果：比让用户多点一次更糟。')
  console.error('  → 要让该出口真正算数，去补「铸收据」那一环；确要改守卫，同步改基线并说明为什么仍然安全。')
  process.exit(1)
}

if (offenders.length > allowedCount) {
  console.error(`✗ 花钱确认收据门岗失败：${offenders.length} 处出口声称放行却不带收据（基线 ${allowedCount}）`)
  for (const o of offenders) console.error(`  ${TARGET}:${o.line}  ${o.snippet}`)
  console.error('  → 下游（mcpSemanticGenerationFlow / generationDispatcher）没有收据一律拒，')
  console.error('    所以这样的「确认」只会让用户点完同意后看到 human_approval_required——比多点一次更糟。')
  console.error('  → 要让某个确认面真正算数，去补「铸收据」那一环，而不是在这里放宽。')
  process.exit(1)
}

if (offenders.length < allowedCount) {
  console.log(`↓ 存量减少：实测 ${offenders.length} < 基线 ${allowedCount}，请同步收紧 ${path.basename(baselinePath)}`)
  process.exit(1)
}
if (offenders.length > 0) {
  console.log(`↳ 存量欠账 ${offenders.length} 条（在基线内，非豁免）：`)
  for (const o of offenders) console.log(`   ${TARGET}:${o.line}`)
}
console.log('✓ 花钱确认收据门岗通过：无新增的「声称放行却不带收据」出口')
