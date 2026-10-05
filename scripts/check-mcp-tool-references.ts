#!/usr/bin/env tsx
/**
 * MCP 工具名引用门岗：可执行测试与文档示例中的每个工具名必须在真实目录里存在。
 *
 * 目录从 MCP_TOOL_RESOLVER 派生，扫描覆盖位置参数 callTool(...)、tools/call
 * payload 的 name 属性和无插值模板字面量。宿主回复/manifest 按对象结构选 Agent 目录，
 * 与字段顺序、长度无关；调用始终按 MCP 目录。故意的未知工具探针仍须显式标记。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MCP_TOOL_RESOLVER } from '../electron/capabilityCore/mcpToolCatalog'
import { LANE_MODEL_TOOL_CATALOG, LANE_DEFERRED_TOOL_CATALOG } from '../electron/agentLane/laneToolCatalog'
import { LANE_NATIVE_TOOL_CATALOG } from '../electron/agentLane/laneToolCatalog'
import { LANE_CODING_TOOL_NAMES } from '../electron/agentLane/laneCodingTools.mts'
import { LANE_TOOL_REQUEST_TOOL_NAME } from '../electron/agentLane/laneToolGroups.mts'
import { collectFiles, scanCallArgumentKeys, scanFile } from './check-mcp-tool-references-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INTENTIONAL_UNKNOWN = 'unknown-tool-probe'
const declared = new Set(MCP_TOOL_RESOLVER.list().map((tool) => tool.name))
// 每个工具已发布的入参属性名。名字对得上不等于入参对得上——#797 改了三个工具的入参形状，
// 单测都改了、四个 e2e 调用点漏了，而名字门岗当时全绿（详见 lib 里 scanCallArgumentKeys 的注释）。
const declaredArgs = new Map<string, Set<string>>(
  MCP_TOOL_RESOLVER.list().map((tool) => {
    const schema = tool.inputSchema as { properties?: Record<string, unknown> } | undefined
    return [tool.name, new Set(Object.keys(schema?.properties ?? {}))] as const
  }),
)
const hostDeclared = new Set([
  ...LANE_MODEL_TOOL_CATALOG.map(tool => tool.name),
  ...LANE_DEFERRED_TOOL_CATALOG.map(tool => tool.name),
  LANE_TOOL_REQUEST_TOOL_NAME,
])
const offenders: string[] = []
let referenceCount = 0

// tests/agent-runtime contains synthetic Pi/HTTP fixture tools and is deliberately
// outside this MCP gate. All real MCP tests and executable docs examples remain in.
const scanTargets = [
  ...collectFiles(path.join(repoRoot, 'tests')).filter(
    (file: string) => !file.includes(`${path.sep}tests${path.sep}agent-runtime${path.sep}`),
  ),
  ...collectFiles(path.join(repoRoot, 'docs'), { includeMarkdown: true }),
]

const argOffenders: string[] = []
let argCallCount = 0

for (const file of scanTargets) {
  const relative = path.relative(repoRoot, file).split(path.sep).join('/')
  const source = fs.readFileSync(file, 'utf8')
  const lines = source.split('\n')
  if (!file.endsWith('.md')) {
    for (const call of scanCallArgumentKeys(source)) {
      const properties = declaredArgs.get(call.name)
      if (!properties || properties.size === 0) continue
      const line = source.slice(0, call.index).split('\n').length
      const context = `${lines[line - 2] ?? ''}\n${lines[line - 1] ?? ''}`
      if (context.includes(INTENTIONAL_UNKNOWN)) continue
      argCallCount += 1
      const unknown = (call.keys as Array<{ key: string }>).map((entry) => entry.key).filter((key) => !properties.has(key))
      if (unknown.length > 0) argOffenders.push(`${relative}:${line} → ${call.name} 收不到入参 ${unknown.join(', ')}（已发布：${[...properties].sort().join(', ')}）`)
    }
  }
  for (const match of scanFile(file, { declared, hostDeclared })) {
    referenceCount += 1
    if (match.catalog.has(match.name)) continue
    const context = `${lines[match.line - 2] ?? ''}\n${lines[match.line - 1] ?? ''}`
    if (context.includes(INTENTIONAL_UNKNOWN)) continue
    offenders.push(
      `${relative}:${match.line} → ${match.name}（按${match.catalog === declared ? ' MCP ' : '应用内 Agent '}目录判定）`,
    )
  }
}

if (argOffenders.length > 0) {
  console.error(`✖ ${argOffenders.length} 处调用点给 MCP 工具传了它已发布 schema 里没有的入参：`)
  for (const offender of argOffenders) console.error(`  ${offender}`)
  console.error('')
  console.error('  工具面改了入参形状，调用点要跟着改。传多余字段的调用被 strict schema 拒成')
  console.error('  isError:true / capability_input_invalid，跑到才红、跑不到就一直埋着（#797 埋了四处）。')
  process.exit(1)
}

if (offenders.length > 0) {
  console.error(`✖ ${offenders.length} 处可执行示例引用了目录里不存在的 MCP 工具名：`)
  for (const offender of offenders) console.error(`  ${offender}`)
  console.error('')
  console.error(
    '  工具面变了就要同步改这些调用点。别只把断言改绿——调用不存在的工具同样返回 isError:true，会让边界断言假绿。',
  )
  console.error(`  当前目录（${declared.size} 个）：${[...declared].sort().join(', ')}`)
  process.exit(1)
}


// ── 技能里的工具名（2026-09-18 加）────────────────────────────────────────────
//
// 为什么这一段必须在这个门岗里、而不是另起一个：技能是**纯文本**引用代码里的名字，
// 编译器看不见。2026-09-14 那次「37 个内部名 → 20 个动词」的破坏性改名（afe85411d，
// 提交里明写「不留任何旧别名」）**一个技能文件都没改**，四天后由一次真实用户场景暴露：
// 分镜规划师照着 `propose_storyboard_plan` 这类旧名字调，调不到，于是只写文字不落表。
// 判据与上面同源（同一份目录），所以放在同一个门岗里——两份判据必然各漂各的。
const laneToolNames = new Set<string>([
  ...LANE_MODEL_TOOL_CATALOG.map(tool => tool.name),
  ...LANE_DEFERRED_TOOL_CATALOG.map(tool => tool.name),
  ...LANE_NATIVE_TOOL_CATALOG.map(tool => tool.name),
  ...LANE_CODING_TOOL_NAMES,
  LANE_TOOL_REQUEST_TOOL_NAME,
  'read',
])
const everyToolName = new Set<string>([...laneToolNames, ...declared])
const retiredToolNames: readonly string[] = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'scripts/retired-tool-names.json'), 'utf8'),
).retired
const skillOffenders: string[] = []
let skillDeclarationCount = 0
const skillsDir = path.join(repoRoot, 'skills')
const skillFiles = fs.existsSync(skillsDir)
  ? fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(skillsDir, entry.name, 'SKILL.md'))
      .filter(file => fs.existsSync(file))
  : []
for (const file of skillFiles) {
  const relative = path.relative(repoRoot, file).split(path.sep).join('/')
  const source = fs.readFileSync(file, 'utf8')
  // ①「声明」：frontmatter 的 `tools:` 列表——技能自己说它要用哪些工具，必须真实存在。
  const declaredBlock = /^\s*tools:\s*$((?:\s*-\s*\S+\s*$)+)/m.exec(source)
  for (const name of declaredBlock ? [...declaredBlock[1].matchAll(/-\s*(\S+)/g)].map(match => match[1]) : []) {
    skillDeclarationCount += 1
    if (everyToolName.has(name)) continue
    const line = source.slice(0, declaredBlock!.index).split('\n').length
    skillOffenders.push(`${relative}:${line} 声明了不存在的工具 ${name}`)
  }
  // ②「正文」：退役名单里的名字出现在哪儿都是错的（判据来自 git 证据，不是形状猜测，
  //    所以不会把 `prompt` / `first_frame` 这类字段名误伤成工具名）。
  for (const [index, text] of source.split('\n').entries()) {
    for (const retired of retiredToolNames) {
      if (!new RegExp(`\\b${retired}\\b`).test(text)) continue
      skillOffenders.push(`${relative}:${index + 1} 正文写着已退役的工具 ${retired}`)
    }
  }
}

if (skillOffenders.length > 0) {
  console.error(`✖ ${skillOffenders.length} 处技能引用了不存在或已退役的工具名：`)
  for (const offender of skillOffenders) console.error(`  ${offender}`)
  console.error('')
  console.error('  技能是纯文本，改工具名时编译器拦不住它——模型照着旧名字调，调不到就只写文字不干活，')
  console.error('  症状要等真实用户撞上才出现（2026-09-18：Agent 出不来分镜表，0/5 轮可用）。')
  console.error('  退役一个工具就往 scripts/retired-tool-names.json 里加一个名字。')
  console.error(`  当前模型可见工具（${everyToolName.size} 个）：${[...everyToolName].sort().join(', ')}`)
  process.exit(1)
}

console.log(`✅ 工具名引用一致：${referenceCount} 处调用点命中目录里的 ${declared.size} 个 MCP 工具；${argCallCount} 处字面量调用的顶层键都在已发布 schema 里；${skillFiles.length} 个技能的 ${skillDeclarationCount} 条工具声明与正文均无已退役/不存在的名字`)
