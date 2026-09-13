#!/usr/bin/env node
// 工具面门岗（2026-09-11）。守的是**接模型这条路的工具面**，规则来自
// docs/design/2026-09-11-mcp-onboarding-tool-face.md §6（O1–O7），外加用户 09-11 22:10 拍板的
// 形态规则两条：
//
//     一个工具 = 一种后果 = 动哪个状态 × 效果类别；同格合并用 action，跨格必拆。
//
// 为什么这些要做成门岗而不是评审意见：这一族问题的特征是「加一个字段就悄悄回来了」——
// 有人给 check_connection 标个 spend、给 connect_provider 加回 expectedRevision、
// 让 show_models 先查一下自检通没通，代码看着都很合理，而用户那头就是「接模型又开始扣钱/
// 又要我自己算版本号/自检没过模型就从画布上消失了」。规则住在这里，改的人当场看见红。
//
// 每条规则**加之前先验它会红**（R17）：`node scripts/check-tool-face.mjs --selftest` 会把每条
// 规则各违反一次，逐条确认它真的报错——规则清单以本文件的 RULES 为准，别在文档里数条数。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DECLARATIONS = path.join(ROOT, 'electron/capabilityCore/modelOnboarding/declarations.ts')
const TOOLS = path.join(ROOT, 'electron/capabilityCore/modelOnboarding/tools.ts')
const DISPATCH = path.join(ROOT, 'electron/capabilityCore/modelOnboarding/dispatch.ts')
const BANK = path.join(ROOT, 'tests/fixtures/tool-selection/2026-09-11-onboarding-bank.json')

const read = (file) => fs.readFileSync(file, 'utf8')

/** 从声明源文件里抽出每个动词的 tool / action / effect / states / required / fields 名 / 描述块。 */
function parseVerbs(source) {
  const verbs = []
  // 每个声明以 `    tool: '...'` 开头，到下一个 `    tool:` 或数组结尾为止。
  const starts = [...source.matchAll(/^ {4}tool: '([a-z_]+)',$/gm)]
  for (let index = 0; index < starts.length; index += 1) {
    const from = starts[index].index
    const to = index + 1 < starts.length ? starts[index + 1].index : source.length
    const block = source.slice(from, to)
    const pick = (name) => (block.match(new RegExp(`^ {4}${name}: (.+?),?$`, 'm')) || [])[1] || ''
    const fieldsBlock = (block.match(/^ {4}fields: \{([\s\S]*?)^ {4}\},$/m) || block.match(/^ {4}fields: \{(.*?)\},$/m) || [])[1] || ''
    verbs.push({
      tool: starts[index][1],
      action: (pick('action').match(/'([^']+)'/) || [, null])[1],
      effect: (pick('effect').match(/'([^']+)'/) || [, ''])[1],
      states: [...pick('states').matchAll(/'(S11\.\d)'/g)].map((m) => m[1]),
      required: [...(block.match(/^ {4}required: \[(.*?)\],$/m) || [, ''])[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
      fieldNames: [...fieldsBlock.matchAll(/^ {6}([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]),
      block,
    })
  }
  return verbs
}

/** 效果类别的「格」：一个工具只能占一格。 */
const cellOf = (verb) => verb.effect

const RULES = [
  {
    id: 'O1',
    what: '无 spend：接模型这条路上一个花钱的动作都没有（09-11 拍板：自检免费）',
    run: ({ verbs }) => verbs.filter((verb) => verb.effect === 'spend')
      .map((verb) => `${verb.tool}${verb.action ? `:${verb.action}` : ''} 的 effect 是 spend`),
  },
  {
    id: 'O2',
    what: '无密钥承载字段：任何**字符串类**字段名不得像在装 key（modelKey/vendorKey/modelKeys/authHeader/authQueryParam 是白名单，它们装的是名字不是值）',
    run: ({ verbs, declarationSource }) => {
      const allow = new Set(['modelKey', 'vendorKey', 'modelKeys', 'authHeader', 'authQueryParam'])
      const out = []
      for (const verb of verbs) {
        for (const field of verb.fieldNames) {
          if (allow.has(field)) continue
          if (!/key|token|secret|password|credential|authorization/i.test(field)) continue
          // 布尔开关承载不了一个 key 的值；只有字符串/数组类字段才算承载面。
          const typed = new RegExp(`${field}: \\{[^}]*type: '(string|array)'`).test(verb.block)
            || new RegExp(`${field}: [A-Z_]+`).test(verb.block)
          if (typed) out.push(`${verb.tool}${verb.action ? `:${verb.action}` : ''} 的字段 ${field} 像在承载 key 的值`)
        }
      }
      if (/apiKey|api_key/.test(declarationSource)) out.push('声明里出现了 apiKey —— key 永远由 Nomi 自己向用户要，不进任何工具参数')
      return out
    },
  },
  {
    id: 'O3',
    what: '无模型自算的锁：schema 里不得有 expectedRevision / idempotencyKey / revision；ifUnchanged 必须是不透明 string 且描述里写明 verbatim',
    run: ({ verbs, declarationSource }) => {
      const out = []
      for (const verb of verbs) {
        for (const field of verb.fieldNames) {
          if (/^(expectedRevision|idempotencyKey|revision)$/.test(field)) {
            out.push(`${verb.tool}${verb.action ? `:${verb.action}` : ''} 把 ${field} 放回了模型面上——这是宿主该自己算的东西`)
          }
        }
      }
      if (declarationSource.includes('ifUnchanged')) {
        const block = (declarationSource.match(/ifUnchanged: \{[\s\S]*?\},/) || [''])[0]
        if (!/type: 'string'/.test(block)) out.push('ifUnchanged 不是不透明 string（整数会诱导模型自己 +1）')
        if (!/verbatim/i.test(block)) out.push('ifUnchanged 的描述里没写 verbatim（不写 = 模型会去构造它）')
      }
      return out
    },
  },
  {
    id: 'O4',
    what: '必填集 = 广播集：运行时必填只能从声明的 required 派生，不许存在第二张表',
    run: ({ toolsSource }) => {
      const out = []
      // 运行时校验只有 requiredFor 一个来源；它只读 verb.required + conditionalRequired。
      const fn = (toolsSource.match(/export function requiredFor\([\s\S]*?\n\}/) || [''])[0]
      if (!fn) out.push('tools.ts 里找不到 requiredFor —— 必填集的唯一 owner 不见了')
      else if (!/verb\.required/.test(fn)) out.push('requiredFor 不再从声明的 required 派生')
      // 除 requiredFor 外不许再出现第二份硬编码必填清单。
      const suspicious = [...toolsSource.matchAll(/const [A-Z_]*REQUIRED[A-Z_]* *[:=]/g)].map((m) => m[0])
      out.push(...suspicious.map((hit) => `tools.ts 里出现了第二张必填表：${hit.trim()}`))
      return out
    },
  },
  {
    id: 'O5',
    what: '未验证不得说成功：unverified 可能含 model_produces_output 的动作，其文案不得出现 connected / verified / ready to use / 接好了 / 已接入',
    run: ({ declarationSource, dispatchSource }) => {
      const out = []
      const banned = /\b(is connected|is verified|ready to use|successfully connected)\b|接好了|已接入/i
      // 派生 consequence 的那张表 + 每个动作的五槽 + nextAction.userSees 全扫。
      for (const [label, source] of [['declarations.ts', declarationSource], ['dispatch.ts', dispatchSource]]) {
        for (const line of source.split('\n')) {
          // 只看会进到模型眼前的文案行（描述槽与 userSees），不看中文注释。
          if (!/(does|useWhen|notWhen|params|doesNot|userSees):/.test(line)) continue
          if (banned.test(line)) out.push(`${label} 里有一句会让模型说「接好了」的文案：${line.trim().slice(0, 120)}`)
        }
      }
      return out
    },
  },
  {
    id: 'O6',
    what: '发布不依赖自检：show_models 的实现路径不得读 selfCheck / adapter.state / activeRevision（守的是「自检失败不下架」这个拍板）',
    run: ({ dispatchSource }) => {
      const fn = (dispatchSource.match(/async function showModels\([\s\S]*?\n\}/) || [''])[0]
      if (!fn) return ['dispatch.ts 里找不到 showModels']
      return [...fn.matchAll(/\b(selfCheck|activeRevision|adapterState|adapter\.state)\b/g)]
        .filter((hit) => !fn.slice(0, hit.index).split('\n').pop().trim().startsWith('//'))
        .map((hit) => `show_models 读了 ${hit[1]} —— 自检不许决定一个模型出不出现在画布模型框里`)
    },
  },
  {
    id: 'O7',
    what: '题库覆盖：每个动作至少被一条 expectedFirstCall/expectedCallSequence 命中；题库里出现的动作必须真的存在',
    run: ({ verbs, bank }) => {
      const declared = new Set(verbs.map((verb) => (verb.action ? `${verb.tool}:${verb.action}` : verb.tool)))
      const used = new Set()
      const out = []
      for (const testCase of bank.cases) {
        for (const call of [testCase.expectedFirstCall, ...(testCase.expectedCallSequence || [])]) {
          if (!call) continue
          used.add(call)
          if (!declared.has(call)) out.push(`题库 ${testCase.id} 期望调用 ${call}，但声明里没有这个动作`)
        }
      }
      for (const call of declared) if (!used.has(call)) out.push(`动作 ${call} 没有任何一句用户的话会用到它——它是我们想出来的，不是用户要的`)
      return out
    },
  },
  {
    id: 'C1',
    what: '同格多工具：同一个（效果类别）格里不许有两个工具名——同格要合并成一个工具的 action 枚举',
    run: ({ verbs }) => {
      const byCell = new Map()
      for (const verb of verbs) {
        const cell = cellOf(verb)
        if (!byCell.has(cell)) byCell.set(cell, new Set())
        byCell.get(cell).add(verb.tool)
      }
      const out = []
      for (const [cell, tools] of byCell) {
        // read 是唯一允许两个工具名的格：「查一眼」与「等到好」是两件事（先例库结论），
        // 且这一条本身是设计稿逐字裁过的例外，写死在这里而不是留给判断。
        const allowed = cell === 'read' ? 2 : 1
        if (tools.size > allowed) out.push(`效果类别 ${cell} 这一格里有 ${tools.size} 个工具（${[...tools].join(', ')}）——同格应当合并成一个工具的 action 枚举`)
      }
      return out
    },
  },
  {
    id: 'C2',
    what: '跨格合并：一个工具里的所有 action 必须同一个效果类别——把不可逆的动作混进可撤销的枚举里，会让审批注解塌到整组',
    run: ({ verbs }) => {
      const byTool = new Map()
      for (const verb of verbs) {
        if (!byTool.has(verb.tool)) byTool.set(verb.tool, new Set())
        byTool.get(verb.tool).add(verb.effect)
      }
      return [...byTool].filter(([, effects]) => effects.size > 1)
        .map(([tool, effects]) => `${tool} 的 action 横跨了 ${[...effects].join(' / ')} 两格——宿主只能按整个工具的最坏后果去问用户，可撤销的那几步会被一起拖进确认卡`)
    },
  },
]

function loadContext(overrides = {}) {
  const declarationSource = overrides.declarationSource ?? read(DECLARATIONS)
  return {
    declarationSource,
    toolsSource: overrides.toolsSource ?? read(TOOLS),
    dispatchSource: overrides.dispatchSource ?? read(DISPATCH),
    bank: overrides.bank ?? JSON.parse(read(BANK)),
    verbs: parseVerbs(declarationSource),
  }
}

function runAll(context) {
  const failures = []
  for (const rule of RULES) {
    for (const message of rule.run(context)) failures.push(`${rule.id} · ${rule.what}\n     ${message}`)
  }
  return failures
}

// ── 自检：每条规则各违反一次，确认它真的会红（R17：加规则先验它会红） ─────────────────
const SELFTEST = [
  { id: 'O1', mutate: (c) => ({ ...c, declarationSource: c.declarationSource.replace("effect: 'reversible_local',\n    states: ['S11.5']", "effect: 'spend',\n    states: ['S11.5']") }) },
  { id: 'O2', mutate: (c) => ({ ...c, declarationSource: c.declarationSource.replace("      reissueKey: { type: 'boolean'", "      apiKey: { type: 'string', maxLength: 200 },\n      reissueKey: { type: 'boolean'") }) },
  { id: 'O3', mutate: (c) => ({ ...c, declarationSource: c.declarationSource.replace("      reissueKey: { type: 'boolean'", "      expectedRevision: { type: 'integer', minimum: 1 },\n      reissueKey: { type: 'boolean'") }) },
  { id: 'O4', mutate: (c) => ({ ...c, toolsSource: `${c.toolsSource}\nconst EXTRA_REQUIRED_BY_ACTION = { connect_provider: ['kind'] }\n` }) },
  { id: 'O5', mutate: (c) => ({ ...c, declarationSource: c.declarationSource.replace(/^ {6}does: 'Run Nomi/m, "      userSees: 'The provider is connected and ready to use.',\n      does: 'Run Nomi") }) },
  { id: 'O6', mutate: (c) => ({ ...c, dispatchSource: c.dispatchSource.replace('  const visible = params.visible === true', '  const visible = params.visible === true && selfCheck.accepted') }) },
  { id: 'O7', mutate: (c) => ({ ...c, bank: { ...c.bank, cases: [...c.bank.cases, { id: 'invented', expectedFirstCall: 'nomi_model_setup:teleport', expectedCallSequence: [] }] } }) },
  { id: 'C1', mutate: (c) => ({ ...c, declarationSource: c.declarationSource.replace("    tool: 'nomi_model_setup',\n    action: 'show_models',", "    tool: 'nomi_show_models',\n    action: 'show_models',") }) },
  { id: 'C2', mutate: (c) => ({ ...c, declarationSource: c.declarationSource.replace("    tool: 'nomi_remove_provider',\n    action: null,", "    tool: 'nomi_model_setup',\n    action: 'remove_provider',") }) },
]

function selftest() {
  const base = loadContext()
  let bad = 0
  for (const probe of SELFTEST) {
    const rule = RULES.find((entry) => entry.id === probe.id)
    const mutated = probe.mutate(base)
    const context = { ...mutated, verbs: parseVerbs(mutated.declarationSource) }
    const hits = rule.run(context)
    if (hits.length === 0) {
      console.error(`✗ ${probe.id} 的自检违例**没有**让它变红——这条规则拦不住它要拦的东西`)
      bad += 1
    } else {
      console.log(`✓ ${probe.id} 先验会红：${hits[0].slice(0, 110)}`)
    }
  }
  if (bad) process.exit(1)
  console.log(`\n${SELFTEST.length} 条规则逐条验过会红。`)
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  const failures = runAll(loadContext())
  if (failures.length) {
    console.error('接模型工具面门岗失败：\n')
    for (const failure of failures) console.error(`  ✗ ${failure}\n`)
    console.error('规则详解：docs/design/2026-09-11-mcp-onboarding-tool-face.md §6 与 docs/plan/2026-09-11-mcp-onboarding-tool-face-impl.md')
    process.exit(1)
  }
  console.log(`接模型工具面门岗通过（${RULES.length} 条规则）。`)
}
