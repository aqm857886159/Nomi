#!/usr/bin/env tsx
/**
 * MCP 工具名引用门岗：可执行测试与文档示例中的每个工具名必须在真实目录里存在。
 *
 * 目录从 MCP_TOOL_RESOLVER 派生，扫描覆盖位置参数 callTool(...)、tools/call
 * payload 的 name 属性和无插值模板字面量。故意的未知工具探针仍须显式标记。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MCP_TOOL_RESOLVER } from '../electron/capabilityCore/mcpToolCatalog'
import { agentToolNames } from '../electron/harness/tools/agentToolCatalog'
import { collectFiles, scanFile } from './check-mcp-tool-references-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INTENTIONAL_UNKNOWN = 'unknown-tool-probe'
const declared = new Set(MCP_TOOL_RESOLVER.list().map((tool) => tool.name))
const hostDeclared = new Set(Object.values(agentToolNames).flatMap((names) => [...names]))
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

for (const file of scanTargets) {
  const relative = path.relative(repoRoot, file).split(path.sep).join('/')
  const source = fs.readFileSync(file, 'utf8')
  const lines = source.split('\n')
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

console.log(`✅ MCP 工具名引用一致：${referenceCount} 处调用点全部命中目录里的 ${declared.size} 个工具`)
