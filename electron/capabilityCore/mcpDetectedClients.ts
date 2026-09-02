// 检测到的外部 MCP 客户端登记（bare-Node 可 import，**不引 electron**）。
//
// 为什么放这里而不是 mcpConfig：检测发生在 mcpNodeLauncher.js——它是 ELECTRON_RUN_AS_NODE=1 的纯 Node
// 进程，没有 electron 的 app.getPath。而 mcpConfig 顶部 import electron，纯 Node 引它会 MODULE_NOT_FOUND
//（同 mcpNodeLauncher 注释里 i18n.ts 那条教训）。
//
// 持久化到 capabilityCoreDir()（~/.nomi/capability-core，可被 NOMI_CAPABILITY_DIR 覆盖）——这是 security.ts
// 注释里写明的「app 侧与 CLI 端算同一处」的目录，GUI 与 bare-Node 都够得着。手动注册的 profile 也迁到同一文件，
// 单一真相源。
import fs from 'node:fs'
import path from 'node:path'
import { capabilityCoreDir } from './security'

const PROFILES_FILE = 'mcp-client-profiles.json'

export function profilesPath(): string {
  return path.join(capabilityCoreDir(), PROFILES_FILE)
}

/** 从自报名字派生稳定 key（小写字母数字横杠，≤63 字符）。 */
export function deriveClientKeyFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '')
  return slug || 'external-client'
}

/**
 * 自动登记一个「检测到的」外部客户端：MCP stdio server / launcher 收到自报名字的未签名连接时调用。
 * 幂等——同 key 已存在（内置/已注册/已检测）则跳过，不覆盖用户手动注册的 profile。
 * 检测到的客户端 configPath 为空、detected=true，UI 据此显示「已连通」而非「待接入」。
 */
export function recordDetectedMcpClient(name: string): void {
  const label = name.trim()
  if (!label) return
  let key = deriveClientKeyFromName(label)
  if (key === 'nomi-verify') return
  // 避开保留 key：claude/codex/cursor 是内置客户端；nomi 是本机工作台的 trusted host（默认信任、不可取消）。
  // 外部工具常自报 server 名 'nomi'，直接当 key 会撞上 trustedHosts 的 'nomi'，导致信任开关「默认信任且改不了」。
  if (key === 'claude' || key === 'codex' || key === 'cursor' || key === 'nomi') key = `${key}-client`
  let current: unknown[] = []
  try {
    const raw = JSON.parse(fs.readFileSync(profilesPath(), 'utf8'))
    if (Array.isArray(raw)) current = raw
  } catch {
    /* 文件不存在或坏 → 从空开始 */
  }
  // 幂等去重：同 key 已存在，或某个 profile 的 sourceName 就是这个自报名字——后者覆盖「用户已把这条
  // 检测连接改名成产品名」的场景，否则 WorkBuddy 持续自报 nomi 时，改名后又冒出重复的 nomi 连接。
  const seen = current.some((p) => {
    if (!p || typeof p !== 'object') return false
    const rec = p as Record<string, unknown>
    return rec.key === key || rec.sourceName === label
  })
  if (seen) return
  current.push({ key, label, sourceName: label, format: 'json', configPath: '', isBuiltin: false, detected: true })
  fs.mkdirSync(path.dirname(profilesPath()), { recursive: true })
  fs.writeFileSync(profilesPath(), JSON.stringify(current, null, 2))
}
