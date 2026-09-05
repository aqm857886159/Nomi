#!/usr/bin/env tsx
/**
 * MCP 工具名引用门岗：**测试里 tools/call 的每个工具名，必须在目录里真的存在。**
 *
 * 治的是这一类：**门岗断言手抄了真相源的派生值，而守它的 job 与真相源不在同一个触发面上。**
 *
 * 2026-09-02 实测（docs/fixes/2026-09-02-stale-hand-copied-surface-baseline.root-cause.json）：
 * PR #359 有意把 MCP 工具面收束到 19 个并换掉全套命名，但 tests/ux/packaged-mcp-smoke.e2e.mjs
 * 里 5 个工具名一个都没跟着改。它没被立刻发现，是因为跑它的 Mac Package job 只在**打包路径**变动时
 * 触发——改 MCP 源码根本跑不到，落后于是潜伏了整整一天，直到一个无关 PR 碰了 package.json 才炸，
 * 看起来还像是那个无关 PR 的锅。
 *
 * 更坏的是它**两头骗人**：调用一个不存在的工具同样返回 isError:true，所以那三条
 * 「未签名 host 的写操作必须被拒绝」的断言一直是绿的——它们守的其实是「工具不存在」，
 * 而不是写边界。死名字既能造假红，也能造假绿。
 *
 * 因此本门岗刻意放进 **Contracts**（gates:contracts，每次都跑），而不是打包链：
 * 真相源（工具目录）一变，引用它的测试立刻红，不必等到有人改打包路径。
 * 目录从 TS 源码直接读（tsx），不依赖 dist-electron，所以免构建、可在 Contracts 里跑。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MCP_TOOL_RESOLVER } from '../electron/capabilityCore/mcpToolCatalog'
import { agentToolNames } from '../electron/harness/tools/agentToolCatalog'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 只扫 tests/ux——这里的 e2e 是真的把 tools/call 打进 MCP 服务的那一层，工具名写错就等于测了个空。
// 刻意**不**扫 tests/agent-runtime：那套用 nomi_echo / nomi_frames 之类**合成工具名**喂假 LLM 的 HTTP
// fixture，验的是 Pi 运行时的工具管道，与 MCP 目录无关；把它算进来只会产生 25 条噪音并逼人放宽门岗。
const SCAN_ROOTS = ['tests/ux']
const SCAN_EXTENSIONS = new Set(['.mjs', '.js', '.ts', '.mts', '.tsx'])
// 只认 tools/call 的调用点形状 `name: 'nomi_xxx'`，不去扫散文与注释里提到的工具名
// （历史记录、迁移说明里本来就会提到已删除的旧名字，扫它们只会制造噪音）。
const CALL_SITE = /\bname:\s*['"](nomi_[a-z0-9_]+)['"]/g
// tests/ux 里还有一类 `name: 'nomi_…'` **不是 MCP tools/call**：走查用假 LLM 回放一次工具调用时写的
// `reply: { type: 'tool', id: …, name: 'nomi_…' }`。它走的是应用内 Agent（Pi/Host）那张目录
// modelToolSurfaceManifest —— 与 MCP 目录本来就不是同一份名单（画布语义写在 MCP 上收敛成一个名字后，
// 应用内仍是 plan/edit 两个工具）。拿 MCP 目录去判它们只会制造假红并逼人放宽门岗。
// 判据刻意按**调用点**而不是文件名：同一个走查文件里两种调用都可能出现，而 `type: 'tool'` 紧邻
// `name:` 正是「这是一次模型工具调用回放」的字面证据。两边都 fail-closed，谁都不是豁免。
const HOST_FIXTURE_CALL = /type:\s*['"]tool['"][^}]{0,120}$/
// 故意调用不存在的工具（验 -32602 这类协议错）是合法的，但必须在同行或上一行显式声明，
// 免得「忘了迁移」和「故意写假名」长得一模一样。
const INTENTIONAL_UNKNOWN = 'unknown-tool-probe'

function collectFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(full))
    else if (SCAN_EXTENSIONS.has(path.extname(entry.name))) files.push(full)
  }
  return files
}

const declared = new Set(MCP_TOOL_RESOLVER.list().map((tool) => tool.name))
const hostDeclared = new Set(Object.values(agentToolNames).flatMap((names) => [...names]))
const offenders: string[] = []
let referenceCount = 0

for (const file of SCAN_ROOTS.flatMap((root) => collectFiles(path.join(repoRoot, root)))) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(repoRoot, file).split(path.sep).join('/')
  const lines = source.split('\n')
  for (const match of source.matchAll(CALL_SITE)) {
    referenceCount += 1
    const before = source.slice(Math.max(0, (match.index ?? 0) - 160), match.index ?? 0)
    const catalog = HOST_FIXTURE_CALL.test(before) ? hostDeclared : declared
    if (catalog.has(match[1])) continue
    const line = source.slice(0, match.index ?? 0).split('\n').length
    const context = `${lines[line - 2] ?? ''}\n${lines[line - 1] ?? ''}`
    if (context.includes(INTENTIONAL_UNKNOWN)) continue
    offenders.push(`${relative}:${line} → ${match[1]}（按${catalog === declared ? ' MCP ' : '应用内 Agent '}目录判定）`)
  }
}

if (offenders.length > 0) {
  console.error(`✖ ${offenders.length} 处测试引用了目录里不存在的 MCP 工具名：`)
  for (const offender of offenders) console.error(`  ${offender}`)
  console.error('')
  console.error('  工具面变了就要同步改这些调用点。别只把断言改绿——调用不存在的工具同样返回')
  console.error('  isError:true，会让「必须被拒绝」这类断言假绿，看起来在守边界，其实什么也没守。')
  console.error(`  当前目录（${declared.size} 个）：${[...declared].sort().join(', ')}`)
  process.exit(1)
}

console.log(`✅ MCP 工具名引用一致：${referenceCount} 处调用点全部命中目录里的 ${declared.size} 个工具`)
