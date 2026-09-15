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
    (file) => !file.includes(`${path.sep}tests${path.sep}agent-runtime${path.sep}`),
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
      const unknown = call.keys.map((entry) => entry.key).filter((key) => !properties.has(key))
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

console.log(`✅ MCP 工具名引用一致：${referenceCount} 处调用点全部命中目录里的 ${declared.size} 个工具；入参形状：${argCallCount} 处字面量调用的顶层键全部在已发布 schema 里`)
