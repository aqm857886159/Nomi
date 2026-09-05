#!/usr/bin/env node
// 门岗：**公开出去的 MCP 工具，它要的 scope 必须真有代码路径发得出来。**
//
// 为什么需要这道门（2026-09-06 真宿主走查抓出来的）：`nomi_timeline_edit` / `nomi_layout_read` /
// `nomi_layout_write` 三个工具在 `tools/list` 里公开、schema 完整、preview 还能跑，但它们要的
// `timeline:write` / `layout:read` / `layout:write` **没有任何代码路径会发放**——`deriveProjectSessionScopes`
// 里压根没有这几行。于是任何客户端调到写那一步都撞 `Project lease scope is insufficient`，
// 而这在进程内部完全看不出来：两边各自都长得很对，只是从来没人把它们对过一次。
//
// 这是本仓反复出现的一族（见 docs/fixes/2026-09-05-mcp-host-holes.root-cause.json：
// 「公开的契约有两份定义——给宿主看的那份，和代码真正执行的那份」）。MCP 面上它是致命的而不是瑕疵：
// **宿主看到的就是全部的可用面**，一个发不出来的 scope 等于这个工具结构上不存在。
//
// 判据（两个真相源都从代码读，不手抄；手抄基线撞红三次的教训见 R17 / gate-assertions-must-not-copy-derived-values）：
//   · 需求侧 = 每个 `authority.kind === 'project_session'` 的 MCP adapter 的 `requiredScope`
//   · 供给侧 = `deriveProjectSessionScopes` 在生成能力全开时的返回
// 差集必须为空，除非那个 scope 明确登记在 DELIBERATELY_OUT_OF_SESSION 里并写清理由。
//
// fail-closed：读到 0 个 project_session adapter 就直接红（导入坏掉不许读成通过）。
//
// 直接读 TypeScript 真相源（经 tsx），不读 dist-electron —— 门岗不该依赖「先跑过一次 build」。
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const load = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href)

/**
 * 故意不发给 bootstrap 会话的 scope。**登记在这里 = 一个产品决定，不是欠账**：
 * 每条都必须说清「为什么一个外部客户端不该凭一次 session 就拿到它」。
 * 目前为空——付费提交与导出写入根本没有对应的 project_session adapter，所以它们不会走到这道门。
 */
const DELIBERATELY_OUT_OF_SESSION = new Map([
  // 例：['generation:submit', '花钱边界：必须逐次经付费确认门，不能由一次 session 批发。'],
])

async function loadAdapterScopes() {
  const projection = await load('electron/capabilityCore/mcpCapabilityProjection.ts')
  const found = []
  for (const [exportName, adapter] of Object.entries(projection)) {
    if (!adapter || typeof adapter !== 'object') continue
    const authority = adapter.authority
    if (!authority || authority.kind !== 'project_session') continue
    const requiredScope = authority.requiredScope
    if (typeof requiredScope !== 'string' || requiredScope.length === 0) {
      throw new Error(`${exportName}: project_session adapter has no requiredScope`)
    }
    found.push({ exportName, requiredScope, capability: adapter.contract?.id ?? '(unknown)' })
  }
  return found
}

async function loadGrantedScopes() {
  const authority = await load('electron/capabilityCore/projectSessionAuthority.ts')
  // 生成能力全开时的最大授予面——门岗要问的是「有没有任何路径发得出来」，不是「默认发不发」。
  const everyGenerationCapability = [
    'context', 'read', 'events', 'create', 'plan', 'preview',
    'gate_request', 'gate_decide', 'start', 'cancel', 'steer', 'reconcile',
  ]
  return new Set(authority.deriveProjectSessionScopes({
    snapshot: () => ({ flagEnabled: true, effectiveScope: everyGenerationCapability }),
  }))
}

const adapters = await loadAdapterScopes()
if (adapters.length === 0) {
  console.error('✗ MCP scope 可达性门岗：一个 project_session adapter 都没读到 —— 导入坏了，不许当成通过。')
  process.exit(1)
}

const granted = await loadGrantedScopes()
const unreachable = adapters.filter((entry) => !granted.has(entry.requiredScope) && !DELIBERATELY_OUT_OF_SESSION.has(entry.requiredScope))
const registeredButGranted = [...DELIBERATELY_OUT_OF_SESSION.keys()].filter((scope) => granted.has(scope))

const errors = []
for (const entry of unreachable) {
  errors.push(
    `✗ ${entry.exportName}（${entry.capability}）要 scope「${entry.requiredScope}」，` +
    'deriveProjectSessionScopes 从不发放 —— 这个工具在 tools/list 里公开着，但任何客户端都用不了。\n' +
    '  → 要么在 projectSessionAuthority.deriveProjectSessionScopes 里发放它（并在更靠里的一层放真人确认门），\n' +
    '  → 要么把它登记进本脚本的 DELIBERATELY_OUT_OF_SESSION 并写清为什么外部客户端不该拿到它。',
  )
}
for (const scope of registeredButGranted) {
  errors.push(`✗ 「${scope}」登记为「故意不发」却又被 deriveProjectSessionScopes 发出来了 —— 登记过期了，改一处。`)
}

if (errors.length > 0) {
  console.error(`\nMCP scope 可达性门岗未通过：\n${errors.join('\n')}\n`)
  process.exit(1)
}

console.log(`✓ MCP scope 可达性门岗通过：${adapters.length} 个 project_session 工具要的 scope 全部发得出来（故意不发的 ${DELIBERATELY_OUT_OF_SESSION.size} 个已登记）。`)
