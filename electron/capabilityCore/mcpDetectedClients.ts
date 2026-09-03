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

  const filePath = profilesPath()
  // 读现有列表（文件不存在当 []）。
  let current: unknown[] = []
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (Array.isArray(raw)) current = raw
  } catch {
    /* 不存在或格式异常 → 当 [] */
  }
  // 幂等：同 key 已有记录则跳过（无论是 detected 还是已注册）。
  const alreadyKnown = current.some(
    (item) => item && typeof item === 'object' && (item as Record<string, unknown>).key === key,
  )
  if (alreadyKnown) return

  // sourceName 保留原始自报名字，用于检测去重展示。
  current.push({ key, label, format: 'json', configPath: '', isBuiltin: false, detected: true, sourceName: label })
  try {
    const dir = path.dirname(filePath)
    fs.mkdirSync(dir, { recursive: true })
    // 原子写（tmp→rename）避免检测并发时写半截文件。
    const tmp = `${filePath}.tmp.${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(current, null, 2))
    fs.renameSync(tmp, filePath)
  } catch {
    /* 写失败不致命——检测是尽力而为 */
  }
}
