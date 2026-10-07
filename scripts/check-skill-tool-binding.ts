#!/usr/bin/env tsx
/**
 * 技能↔工具绑定门岗：**我们自己仓库里**的技能，正文不许复述注册表已经拥有的「工具性质」。
 *
 * 两个理由：技能要拿得出去（焊死工具性质 = 只能在 Nomi 里用），以及防 2026-09-18 那次复发。
 * **只管 `skills/`——用户从外面装进来的技能一律不扫、不拦**，那一半在运行时解决。
 *
 * 判据本体与它为什么这么判，见 `scripts/skill-tool-binding-lib.mjs`。
 * 这里只做两件事：从注册表派生真相视图、把 `skills/` 喂给判据。
 *
 * 2026-09-18 补第五类：**字段该填什么值**也是注册表事实。技能写「`durationSec` 一律填 `0`」，
 * 而动词 schema 是 `z.number().positive()`——模型照技能填、被 ajv 当场拒，当天 5 次失败全是这一条。
 * 这一条的判据刻意不问「有没有复述」，只问「复述的**值**过不过得了那个字段的 schema」：
 * 过得了就一声不吭，所以举例子、写示例参数都不会被误伤，零误报是结构保证的。
 *
 * 与 `check:mcp-tool-references` 的分工（两个门岗，一条边的两半）：
 *   · 那个管**名字**——技能提到的工具名必须存在 / 不是已退役的。
 *   · 这个管**性质**——名字对了、工具也在，但正文说它是只读的而它其实会写，一样出事。
 *     2026-09-18 那次 4/5 轮不干活就是后者，名字全程正确。
 */
// 3D-BOX 开关引导模块必须第一个导入：工具注册表在导入期按它装配（CI 的开关开 job 用 NOMI_DESKTOP_DEV=1 NOMI_DIRECTOR_3DBOX=true 跑同一份门岗）。
import "../electron/shared/featureFlags/director3dbox";
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAPABILITY_ALIAS_ENTRIES } from '../electron/shared/agentCapabilities/registry'
import { VERB_DECLARATIONS } from '../electron/shared/agentCapabilities/verbDeclarations'
import { findEffectRestatements, findFalseFieldValues, declaredToolsOf, objectShapeOf } from './skill-tool-binding-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 唯一真相源：注册表。别名与 effect 都现查，本文件不写死任何工具名或 effect 值。
// `pi` 面是模型在技能里会提到的那一面（`capabilityContract.ts:16-22`）。
const effectByAlias = new Map<string, string>(
  CAPABILITY_ALIAS_ENTRIES.filter((entry) => entry.surface === 'pi').map((entry) => [entry.alias, entry.contract.effect]),
)

// 每个动词模型可见 schema 的字段 → 那个字段自己的校验器。同样现取，不在本文件写死任何字段名或取值。
const fieldSchemasByTool = new Map<string, Map<string, { safeParse(value: unknown): { success: boolean } }>>()
for (const verb of VERB_DECLARATIONS) {
  const fields = new Map<string, { safeParse(value: unknown): { success: boolean } }>()
  const collect = (node: unknown, depth: number): void => {
    // `.shape` 要剥壳才拿得到：superRefine/optional/default 包一层就没有 `.shape` 了。
    const own = objectShapeOf(node) as Record<string, unknown> | undefined
    if (!own || depth > 2) return
    for (const [name, child] of Object.entries(own)) {
      if (!fields.has(name)) fields.set(name, child as { safeParse(value: unknown): { success: boolean } })
      // 数组元素的形状（`shots[]` 里那一层）——技能规定的字段几乎都住在这一层。
      const element = (child as { element?: unknown; _def?: { type?: unknown; innerType?: unknown } })
      collect(element.element ?? element._def?.innerType ?? element._def?.type, depth + 1)
      collect(child, depth + 1)
    }
  }
  collect(verb.schema, 0)
  fieldSchemasByTool.set(verb.name, fields)
}

// 判据不许空转：一个收参数的动词若派生出 0 个字段，说明取字段那段读不动它的 schema，
// 判据对它什么都没查却仍会报绿。名单存**身份**不存数字，只减不增（R17 棘轮）。
const VERBS_TAKING_NO_PARAMETERS = new Set(['look_at_canvas'])
const vacuous = [...fieldSchemasByTool]
  .filter(([name, fields]) => fields.size === 0 && !VERBS_TAKING_NO_PARAMETERS.has(name))
  .map(([name]) => name)
if (vacuous.length > 0) {
  console.error(`❌ 判据空转：${vacuous.join(', ')} 派生出 0 个字段。`)
  console.error('   这些动词的 schema 读不出 `.shape`（多半又被包了一层），判据查不到它们却会报绿。')
  console.error('   修 scripts/skill-tool-binding-lib.mjs 的 objectShapeOf，别把动词加进 VERBS_TAKING_NO_PARAMETERS。')
  process.exit(1)
}

const skillsDir = path.join(repoRoot, 'skills')
const skillFiles = fs.existsSync(skillsDir)
  ? fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(skillsDir, entry.name, 'SKILL.md'))
      .filter((file) => fs.existsSync(file))
  : []

const offenders: string[] = []
let scanned = 0
for (const file of skillFiles) {
  const relative = path.relative(repoRoot, file).split(path.sep).join('/')
  const source = fs.readFileSync(file, 'utf8')
  const declared = declaredToolsOf(source)
  if (declared.length > 0) scanned += 1
  for (const finding of findEffectRestatements(source, declared, effectByAlias)) {
    const subject = finding.tools.length > 0 ? finding.tools.join(', ') : '（泛指工具）'
    offenders.push(`${relative}:${finding.line} [${finding.kind}] ${subject} —— ${finding.text}`)
  }
  for (const finding of findFalseFieldValues(source, declared, fieldSchemasByTool)) {
    offenders.push(`${relative}:${finding.line} [field_value] ${finding.tool}.${finding.field} 收不下 `
      + `${JSON.stringify(finding.value)} —— ${finding.text}`)
  }
}

if (offenders.length > 0) {
  console.error(`✖ ${offenders.length} 处技能正文复述了「工具性质」这类注册表事实：`)
  for (const offender of offenders) console.error(`  ${offender}`)
  console.error('')
  console.error('  读/写、要不要先问用户、花不花钱、可不可逆——这四件事住在 CapabilityContract 上，')
  console.error('  并且已经由 verbConsequence(effect, nextAction) 派生成模型读到的后果句')
  console.error('  （electron/shared/agentCapabilities/verbDeclaration.ts:140，全仓只此一份）。')
  console.error('  正文里再写一遍，就是第二份不会随注册表更新的副本——2026-09-18 那次 Agent 4/5 轮')
  console.error('  不调工具，就是一句为上一代工具写的性质描述压过了真相。')
  console.error('')
  console.error('  怎么改：把那句性质描述删掉。技能该写的是「做什么」，不是「这个工具是什么」。')
  console.error('  工作流意图（先审再生成、分阶段停下）留着——那是技能自己的内容，注册表里没有。')
  process.exit(1)
}

console.log(`✅ 技能↔工具绑定：${skillFiles.length} 个技能（其中 ${scanned} 个声明了工具）正文均未复述 ${effectByAlias.size} 个已注册工具的性质`)
