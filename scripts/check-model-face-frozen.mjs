#!/usr/bin/env node
/**
 * 门岗 · **模型看到的工具面，改了就得有人说一声。**
 *
 * ── 它在治哪一类真实故障 ──
 *
 * 2026-09-18 把 12 个动词的模型面从「手写一份」换成「宿主契约 schema 的投影 / 有损投影」。好处是两份
 * schema 不可能再漂开；代价是**宿主那一侧的任何改动都会自动流到模型脸上**——上游给某个契约加一个
 * 必填字段，模型面就多一个模型可能根本填不出来的必填字段，而没有任何一层会说话。原型那次变异
 * （给 `cancel_job` 的宿主分支加一个必填 `requestedBy`）**全绿**，记在
 * `docs/plan/2026-09-18-tool-projection-cancel-job-prototype.md` 的那张表里；这道门就是补那一条。
 *
 * 它同时是那一刀的**验收尺**：换真相源不许改模型看到的任何一个字。
 *
 * ── 与 `check:tool-face` 不重叠 ──
 *
 * 那道门量的是语义与一致性（描述只有一个 owner、同效果组互相点名、字段都有描述…），它**允许**字段
 * 与文案在满足那些规则的前提下变化。这道门量的是「变了没有」：快照进仓库，改了要显式
 * `--update-baseline` 并在 PR 里说清为什么。两件事不是同一件。
 *
 * 用法：
 *   pnpm run check:model-face-frozen                     校验
 *   pnpm run check:model-face-frozen -- --update-baseline 改基线（要在 PR 里逐条说明模型看到的什么变了）
 */
// 3D-BOX 开关引导模块必须第一个导入（工具注册表在导入期按它装配）；开关开时比第二份基线。
import '../electron/shared/featureFlags/director3dbox.ts'
import { director3dBoxFaceEnabled } from '../electron/shared/featureFlags/director3dboxFace.ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { captureModelFace, serializeModelFace } from './model-face-snapshot.mjs'
import { onboardingVerbs } from '../electron/shared/agentCapabilities/verbs/onboardingVerbs.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = path.join(repoRoot, 'scripts', director3dBoxFaceEnabled() ? 'model-face-baseline.director3dbox.json' : 'model-face-baseline.json')

/**
 * 内部面冻结为 21 个；对外专属数量从声明源派生，独立于装配结果，漏装配仍 fail-closed。
 *
 * 20 → 21（2026-09-21）：新增 `ask_user`。这个数是**手写的**而不是从装配结果数出来的，
 * 理由正是「漏装配仍要红」——所以每次动它都等于一次「我知道模型面多了/少了一个工具」的签名。
 */
const EXPECTED_INTERNAL_VERB_COUNT = 21
const isMcpOnly = (verb) => verb.profiles?.length === 1 && verb.profiles[0] === 'mcp'
const expectedMcpOnlyCount = onboardingVerbs().filter(isMcpOnly).length

const face = await captureModelFace()
const internalVerbCount = face.tools.filter((verb) => !isMcpOnly(verb)).length
if (internalVerbCount !== EXPECTED_INTERNAL_VERB_COUNT) {
  console.error(`✖ 内部面只扫到 ${internalVerbCount} 个动词，设计正本说是 ${EXPECTED_INTERNAL_VERB_COUNT} 个——门岗等于没跑（fail-closed）`)
  process.exit(1)
}
if (face.verbCount !== internalVerbCount + expectedMcpOnlyCount) {
  console.error(`✖ 只扫到 ${face.verbCount} 个动词，应为内部面 ${internalVerbCount} + 声明中的对外专属 ${expectedMcpOnlyCount} 个——模块没加载全（fail-closed）`)
  process.exit(1)
}
const current = serializeModelFace(face)

if (process.argv.includes('--update-baseline')) {
  fs.writeFileSync(baselinePath, current)
  console.log(`✅ 已重算模型面基线（${face.verbCount} 个动词）。PR 正文里逐条写清模型看到的什么变了、为什么。`)
  process.exit(0)
}

if (!fs.existsSync(baselinePath)) {
  console.error('✖ 没有模型面基线文件——先跑一次 --update-baseline 并把它提交上去')
  process.exit(1)
}

const baseline = fs.readFileSync(baselinePath, 'utf8')
if (baseline === current) {
  console.log(`scanned=${face.verbCount}`)
  console.log(`✅ ${face.verbCount} 个动词的模型面与基线逐字节相同。`)
  process.exit(0)
}

// 逐动词报差异：整份 JSON 的 diff 对人没用，「哪个工具的哪一面变了」才有用。
const byName = (text) => new Map(JSON.parse(text).tools.map((tool) => [tool.name, JSON.stringify(tool, null, 2)]))
const before = byName(baseline)
const after = byName(current)
const changed = []
for (const [name, body] of after) {
  if (!before.has(name)) { changed.push(`+ ${name}（新工具）`); continue }
  if (before.get(name) !== body) changed.push(`~ ${name}`)
}
for (const name of before.keys()) if (!after.has(name)) changed.push(`- ${name}（工具没了）`)

if (changed.length === 0) {
  // 每个工具逐字节相同，整份快照却不同 ⇒ **顺序变了**。目录顺序是合同不是审美：它进系统提示词与
  // `tools/list`，是 prompt/KV-cache 的前缀（`verbDeclarations.ts` 文件头）。漏报这一种等于这道门
  // 在「模型看到的东西」上留了一个洞。
  console.error('✖ 每个工具都没变，但目录**顺序**变了。')
  console.error(`  基线顺序：${[...before.keys()].join(' → ')}`)
  console.error(`  现在顺序：${[...after.keys()].join(' → ')}`)
  console.error('\n  → 顺序是合同：它是提示词与 tools/list 的前缀，上游靠稳定前缀保住 KV-cache。')
  console.error('    确认是有意的之后跑 `pnpm run check:model-face-frozen -- --update-baseline`，并在 PR 正文里说明。')
  process.exit(1)
}

console.error(`✖ 模型看到的工具面变了（${changed.length} 个工具）：`)
for (const line of changed) console.error(`  · ${line}`)
console.error('\n  → 这不是自动就该放行的事：模型面上多一个必填字段，就是多一个模型可能根本填不出来的值。')
console.error('    确认是有意的之后跑 `pnpm run check:model-face-frozen -- --update-baseline`，并在 PR 正文里逐条说明。')
process.exit(1)
