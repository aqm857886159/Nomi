// 能力核 · 接入 MCP 客户端的配置读写（见 docs/plan/2026-06-22-multi-client-mcp-connect.md
// + docs/plan/2026-06-24-packaged-mcp-stdio-server.md）。
//
// 「一键接入」就靠这一层：算出 nomi MCP server 启动条目 → 把 nomi 条目合并进各客户端的配置文件。
// 启动条目 = **包内 Helper 的 Node 模式 + mcpNodeLauncher.js**。Helper 本身就是 Nomi 随包携带的
// Node runtime，不依赖用户装 node；它不注册第二个 NSApplication，而是连接已开的 Nomi RPC，必要时
// 先启动唯一的 Nomi GUI。这样 GUI 已开时 Claude/Codex/Cursor 不会在 AppKit 注册阶段直接 SIGABRT。
// 支持 Claude Code / Codex / Cursor 三个一键，其余助手走 UI 的「复制配置」。
// 安全口径（三客户端一致）：**只写各自固定文件**（非任意路径写）；写前自动备份；**合并而非覆盖**
// （保留用户已有的其它 MCP server）；原子写（tmp→rename）。
// Codex 是 TOML，用块级文本合并（按 [表头] 边界只换我们自己的 [mcp_servers.nomi] 块），不引 TOML 依赖（P1）。
import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJsonFile, renameSyncWithRetry, writeJsonFileAtomic } from '../jsonFile'
import { profilesPath } from './mcpDetectedClients'
import {
  MCP_CLIENT_ENV,
  MCP_CLIENT_PROOF_ENV,
  isValidMcpClientKey,
  readToken,
  signMcpClient,
  verifyMcpClient,
  type AuthenticatedMcpClient,
} from './security'
import { readAutomationPolicySettings } from '../settings/automationPolicySettings'

const SERVER_NAME = 'nomi'
export const MCP_CONFIG_VERSION_ENV = 'NOMI_MCP_CONFIG_VERSION'
export const MCP_CONFIG_KIND_ENV = 'NOMI_MCP_CONFIG_KIND'
export const MCP_CONFIG_VERSION = '3'

export type McpLauncherKind = 'packaged' | 'development'
export type McpConfigState =
  | 'absent'
  | 'current'
  | 'development'
  | 'legacy-launcher'
  | 'stale-development'
  | 'auth-stale'
  | 'launcher-stale'
  | 'custom'

export type McpClientKey = AuthenticatedMcpClient

type ClientSpec = {
  label: string
  format: 'json' | 'toml'
  /** 配置文件绝对路径。 */
  configPath: () => string
}

const CLIENTS: Record<string, ClientSpec> = {
  claude: { label: 'Claude Code', format: 'json', configPath: () => path.join(os.homedir(), '.claude.json') },
  cursor: { label: 'Cursor', format: 'json', configPath: () => path.join(os.homedir(), '.cursor', 'mcp.json') },
  codex: { label: 'Codex', format: 'toml', configPath: () => path.join(os.homedir(), '.codex', 'config.toml') },
}

// ── 自定义 MCP 客户端 profile（方案 A：把客户端身份从三值泛化成可注册）──────────
// 内置三客户端是注册表的种子；其余任意支持 MCP stdio 的工具按「名字 + 配置路径 + 格式」注册。
// 持久化到 capabilityCoreDir()（~/.nomi/capability-core，见 mcpDetectedClients.ts）——app 侧与 bare-Node
// CLI 端算同一处，检测（mcpNodeLauncher）与注册（GUI）共用单一真相源。
// 安全口径与内置一致：只写用户显式指定的固定文件；写前备份；合并而非覆盖；原子写。

export type McpClientProfile = {
  key: string
  label: string
  format: 'json' | 'toml'
  configPath: string
  isBuiltin: boolean
  /** true = 自动检测到的客户端（自报名字，尚未配置路径）；false = 用户手动注册（有 configPath）。 */
  detected: boolean
  /** 检测时的原始自报名字（detected 改名后保留，用于检测去重）。 */
  sourceName?: string
}

const CUSTOM_PROFILE_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/

function normalizeCustomProfile(value: unknown): McpClientProfile | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.key !== 'string' || !CUSTOM_PROFILE_KEY.test(raw.key)) return null
  if (typeof raw.label !== 'string' || !raw.label.trim()) return null
  if (raw.format !== 'json' && raw.format !== 'toml') return null
  if (typeof raw.configPath !== 'string') return null
  const detected = raw.detected === true
  // detected 客户端还没配路径（configPath 可为空）；手动注册必须有绝对路径。
  if (!detected && !path.isAbsolute(raw.configPath)) return null
  return {
    key: raw.key,
    label: raw.label.trim(),
    format: raw.format,
    configPath: raw.configPath,
    isBuiltin: false,
    detected,
    sourceName: typeof raw.sourceName === 'string' ? raw.sourceName : undefined,
  }
}

/** 读自定义 profile 列表（内置三客户端不在此，它们是 CLIENTS 种子）。 */
export function listCustomMcpProfiles(): McpClientProfile[] {
  try {
    const raw = readJsonFile(profilesPath())
    if (!Array.isArray(raw)) return []
    return raw.map(normalizeCustomProfile).filter((p): p is McpClientProfile => p !== null)
  } catch {
    return []
  }
}

/** 注册/更新一个自定义 profile；key 与内置三客户端冲突或非法则拒绝。 */
export function registerCustomMcpProfile(profile: unknown): McpClientProfile | null {
  const normalized = normalizeCustomProfile(profile)
  if (!normalized) return null
  if (normalized.key in CLIENTS) return null // 内置 key 不可覆盖
  const next = listCustomMcpProfiles().filter((p) => p.key !== normalized.key)
  next.push(normalized)
  writeJsonFileAtomic(profilesPath(), next)
  return normalized
}

/** 移除一个自定义 profile（内置不可删）。返回是否真的删了。 */
export function removeCustomMcpProfile(key: string): boolean {
  if (!CUSTOM_PROFILE_KEY.test(key) || key in CLIENTS) return false
  const current = listCustomMcpProfiles()
  const next = current.filter((p) => p.key !== key)
  if (next.length === current.length) return false
  writeJsonFileAtomic(profilesPath(), next)
  return true
}

/** 内置 + 自定义的合并 spec。内置优先；查不到返回 null。 */
function resolveClientSpec(key: string): ClientSpec | null {
  if (key in CLIENTS) return CLIENTS[key]
  const custom = listCustomMcpProfiles().find((p) => p.key === key)
  if (!custom) return null
  return { label: custom.label, format: custom.format, configPath: () => custom.configPath }
}

function resolveClient(client?: string): McpClientKey {
  if (client && isValidMcpClientKey(client) && resolveClientSpec(client)) return client
  return 'claude'
}

/** MCP server 启动条目（command/args/env），三客户端共用。 */
export type McpServerEntry = { command: string; args: string[]; env?: Record<string, string> }

type LauncherEntry = {
  command: string
  args: string[]
  kind: McpLauncherKind
  env: Record<string, string>
}

function packagedNodeLauncherPaths(appCommand: string): Pick<LauncherEntry, 'command' | 'args'> {
  const joinPortable = (...parts: string[]): string => {
    const first = String(parts[0] || '')
    return (path.win32.isAbsolute(first) && !path.posix.isAbsolute(first) ? path.win32 : path.posix).join(...parts)
  }
  if (process.platform === 'darwin') {
    const contentsDir = path.resolve(path.dirname(appCommand), '..')
    return {
      command: path.join(contentsDir, 'Frameworks', 'Nomi Helper.app', 'Contents', 'MacOS', 'Nomi Helper'),
      args: [path.join(contentsDir, 'Resources', 'app.asar', 'dist-electron', 'capabilityCore', 'mcpNodeLauncher.js')],
    }
  }
  return {
    command: appCommand,
    args: [joinPortable(path.dirname(appCommand), 'resources', 'app.asar', 'dist-electron', 'capabilityCore', 'mcpNodeLauncher.js')],
  }
}

/** A previous installed Nomi is reusable only if it already contains the v3 Helper bridge. */
export function packagedMcpLauncherAvailable(appCommand: string): boolean {
  const launcher = packagedNodeLauncherPaths(appCommand)
  return fs.existsSync(appCommand) && fs.existsSync(launcher.command) && launcher.args.every((arg) => fs.existsSync(arg))
}

function installedMacLauncher(): string | null {
  if (process.platform !== 'darwin' || process.env.NODE_ENV === 'test' || process.env.NOMI_MCP_FORCE_DEV_LAUNCHER === '1') return null
  const candidate = '/Applications/Nomi.app/Contents/MacOS/Nomi'
  return packagedMcpLauncherAvailable(candidate) ? candidate : null
}

function nodeLauncherEntry(appCommand: string, appArgs: string[], kind: McpLauncherKind): LauncherEntry {
  const packaged = kind === 'packaged'
  const packagedLauncher = packaged ? packagedNodeLauncherPaths(appCommand) : null
  const command = packagedLauncher?.command ?? appCommand
  const appPath = app.getAppPath()
  const joinPortable = (...parts: string[]): string => {
    const first = String(parts[0] || '')
    return (path.win32.isAbsolute(first) && !path.posix.isAbsolute(first) ? path.win32 : path.posix).join(...parts)
  }
  const launcherScript = packagedLauncher?.args[0]
    ?? joinPortable(appPath, 'dist-electron', 'capabilityCore', 'mcpNodeLauncher.js')
  return {
    command,
    args: [launcherScript],
    kind,
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      NOMI_MCP_APP_COMMAND: appCommand,
      NOMI_MCP_APP_ARGS: JSON.stringify(appArgs),
    },
  }
}

function launcherEntry(): LauncherEntry {
  if (app.isPackaged) return nodeLauncherEntry(process.execPath, [], 'packaged')
  const installed = installedMacLauncher()
  if (installed) return nodeLauncherEntry(installed, [], 'packaged')
  return nodeLauncherEntry(process.execPath, [app.getAppPath()], 'development')
}

/**
 * nomi MCP server 条目：用包内 Node helper 跑 stdio 桥；桥只在需要时启动 GUI 主进程。
 * 三个客户端拿到同一个启动器，但各自有独立签名 proof，GUI RPC 仍负责最终鉴权和付费硬闸。
 */
export function mcpServerEntry(client?: McpClientKey): McpServerEntry {
  const launcher = launcherEntry()
  const env: Record<string, string> = {
    ...launcher.env,
    NOMI_MCP_STDIO: '1',
    [MCP_CONFIG_VERSION_ENV]: MCP_CONFIG_VERSION,
    [MCP_CONFIG_KIND_ENV]: launcher.kind,
  }
  const proof = client ? signMcpClient(client) : null
  if (client && proof) {
    env[MCP_CLIENT_ENV] = client
    env[MCP_CLIENT_PROOF_ENV] = proof
  }
  return {
    command: launcher.command,
    args: launcher.args,
    env,
  }
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function atomicWrite(target: string, content: string): string | null {
  ensureDir(target)
  let backupPath: string | null = null
  if (fs.existsSync(target)) {
    backupPath = `${target}.nomi-backup`
    fs.copyFileSync(target, backupPath)
  }
  const tmp = `${target}.nomi-tmp`
  fs.writeFileSync(tmp, content, 'utf8')
  // Windows：目标（如 Claude/Cursor 配置）被杀毒/编辑器短暂持有会 EPERM，共享重试收口（P2）。
  renameSyncWithRetry(tmp, target)
  return backupPath
}

// ── JSON 客户端（Claude Code / Cursor）：root.mcpServers.nomi ─────────────

function readJsonConfig(target: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function jsonInstalled(target: string): boolean {
  const servers = readJsonConfig(target).mcpServers
  return Boolean(servers && typeof servers === 'object' && (servers as Record<string, unknown>)[SERVER_NAME])
}

function jsonSnippet(server: McpServerEntry): string {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: server } }, null, 2)
}

function jsonInstall(target: string, client: McpClientKey): string | null {
  const backupPath = fs.existsSync(target) ? `${target}.nomi-backup` : null
  const config = readJsonConfig(target)
  const servers = (config.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)
    ? (config.mcpServers as Record<string, unknown>)
    : {}) as Record<string, unknown>
  servers[SERVER_NAME] = mcpServerEntry(client)
  config.mcpServers = servers
  atomicWrite(target, JSON.stringify(config, null, 2))
  return backupPath
}

function jsonUninstall(target: string): void {
  if (!fs.existsSync(target)) return
  const config = readJsonConfig(target)
  const servers = config.mcpServers as Record<string, unknown> | undefined
  if (servers && typeof servers === 'object' && servers[SERVER_NAME]) {
    delete servers[SERVER_NAME]
    config.mcpServers = servers
    atomicWrite(target, JSON.stringify(config, null, 2))
  }
}

// ── TOML 客户端（Codex）：[mcp_servers.nomi]，块级合并不引依赖 ──────────────

const CODEX_HEADER_RE = /^\s*\[\s*mcp_servers\s*\.\s*(?:nomi|"nomi"|'nomi')\s*\]\s*(?:#.*)?$/
const CODEX_TABLE_HEADER_RE = /^\s*(?:\[[^\]]+\]|\[\[[^\]]+\]\])\s*(?:#.*)?$/
const CODEX_FAMILY_HEADER_RE = /^\s*\[\s*mcp_servers\s*\.\s*(?:nomi|"nomi"|'nomi')\s*(?:\.\s*[^\]]+)?\]\s*(?:#.*)?$/

function tomlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Codex 的三个默认值对 Nomi 全都不成立，不显式写就是三种「看着接上了其实用不了」（官方文档核实：
 * developers.openai.com/codex/mcp）：
 * ① startup_timeout_sec 默认 **10s**，而我们的 MCP server 是**整个 Electron app**（实测打包版 0.5s、
 *    dev 并发 6.5–7.6s，冷启更久）。超时 Codex 会**静默丢掉这个 server** → 工具直接不存在 = 用户看到的
 *    「Codex 说不能用」。对照：Codex 自家 node_repl（一个 node 二进制）写的是 120。
 * ② tool_timeout_sec 默认 **60s**，而 ProductionRun 的创建/观察工具可能跨越较长的本地处理 → 可能中途断
 *    = 用户看到的「发消息之后没反应」。
 * ③ default_tools_approval_mode 不写 = 每个工具调用都要人点一次同意，连「列一下项目」都要点。
 *    设 "writes" = 只对**没标 readOnlyHint** 的工具弹确认（标注在 mcpProtocol 的 READ_ONLY_TOOLS）：
 *    查询类静默通过，写入与生成门仍由各自权限边界确认——不拿用户的钱换顺滑。
 */
const CODEX_STARTUP_TIMEOUT_SEC = 60
const CODEX_TOOL_TIMEOUT_SEC = 600

function codexBlock(server: McpServerEntry): string {
  const args = server.args.map((arg) => `"${tomlEscape(arg)}"`).join(', ')
  let block = `[mcp_servers.${SERVER_NAME}]\ncommand = "${tomlEscape(server.command)}"\nargs = [${args}]\n`
  block += `startup_timeout_sec = ${CODEX_STARTUP_TIMEOUT_SEC}\n`
  block += `tool_timeout_sec = ${CODEX_TOOL_TIMEOUT_SEC}\n`
  block += `default_tools_approval_mode = "writes"\n`
  const envKeys = server.env ? Object.keys(server.env) : []
  if (envKeys.length) {
    const env = envKeys.map((key) => `${key} = "${tomlEscape(server.env![key])}"`).join(', ')
    block += `env = { ${env} }\n`
  }
  return block
}

function readText(target: string): string {
  try {
    return fs.readFileSync(target, 'utf8')
  } catch {
    return ''
  }
}

function codexInstalled(target: string): boolean {
  return readText(target).split('\n').some((line) => CODEX_HEADER_RE.test(line))
}

/**
 * 删掉现有 [mcp_servers.nomi] 及其子表块，其他内容原样保留。
 *
 * Codex 也接受 `[mcp_servers.nomi.env]`。如果只删父表、留下 env 子表，再写
 * `env = { ... }`，整个 config.toml 会因重复 env 键而无法解析。
 */
function removeCodexBlock(text: string): string {
  const out: string[] = []
  let skipping = false
  for (const line of text.split('\n')) {
    if (CODEX_FAMILY_HEADER_RE.test(line)) {
      skipping = true
      continue
    }
    if (skipping && CODEX_TABLE_HEADER_RE.test(line)) skipping = false
    if (!skipping) out.push(line)
  }
  return out.join('\n')
}

function codexInstall(target: string, client: McpClientKey): string | null {
  const backupPath = fs.existsSync(target) ? `${target}.nomi-backup` : null
  const base = removeCodexBlock(readText(target)).replace(/\s*$/, '')
  const next = (base ? `${base}\n\n` : '') + codexBlock(mcpServerEntry(client))
  atomicWrite(target, next)
  return backupPath
}

function codexUninstall(target: string): void {
  if (!fs.existsSync(target)) return
  if (!codexInstalled(target)) return
  const next = removeCodexBlock(readText(target)).replace(/\s*$/, '') + '\n'
  atomicWrite(target, next)
}

// ── 对外 API ───────────────────────────────────────────────────────────

export type McpClientInfo = {
  installed: boolean
  configPath: string
  snippet: string
  configState: McpConfigState
  launcherKind: McpLauncherKind
  migration: 'none' | 'upgraded'
  backupPath: string | null
}

export type McpInfo = {
  tokenReady: boolean
  rpcRunning: boolean
  server: McpServerEntry
  trustedHosts: string[]
  /** 每个可一键接入的客户端的状态 + 可复制片段（卡片据此显示 + 默认选已接入的）。 */
  clients: Record<McpClientKey, McpClientInfo>
}

function clientInfo(client: McpClientKey): McpClientInfo {
  const spec = resolveClientSpec(client)
  if (!spec) throw new Error(`Unknown MCP client: ${client}`)
  const target = spec.configPath()
  const server = mcpServerEntry(client)
  const launcherKind = server.env?.[MCP_CONFIG_KIND_ENV] === 'development' ? 'development' : 'packaged'
  let configured = configuredMcpEntry(client)
  let configState = classifyMcpEntry(client, configured, server)
  let migration: McpClientInfo['migration'] = 'none'
  let backupPath: string | null = null

  // Only deterministic Nomi-owned historical shapes migrate without a click. Unknown/custom
  // entries stay untouched. A dev launcher is not a durable migration target, so wait until a
  // packaged launcher exists or the user explicitly chooses the development connection.
  if (launcherKind === 'packaged' && shouldAutoMigrate(configState)) {
    backupPath = spec.format === 'toml' ? codexInstall(target, client) : jsonInstall(target, client)
    configured = configuredMcpEntry(client)
    configState = classifyMcpEntry(client, configured, server)
    migration = 'upgraded'
  }

  const installed = configured !== null || (spec.format === 'toml' ? codexInstalled(target) : jsonInstalled(target))
  const snippet = spec.format === 'toml' ? codexBlock(server) : jsonSnippet(server)
  return { installed, configPath: target, snippet, configState, launcherKind, migration, backupPath }
}

/** 读接入状态 + 各客户端配置片段。rpcPort 由调用方（appIntegration）传入。 */
export function readMcpInfo(rpcPort: number | null): McpInfo {
  const server = mcpServerEntry()
  const trustedHosts = readAutomationPolicySettings().trustedHosts
  const clients: Record<McpClientKey, McpClientInfo> = {
    claude: clientInfo('claude'),
    codex: clientInfo('codex'),
    cursor: clientInfo('cursor'),
  }
  // 自定义 profile 与内置三客户端同权：同样经 clientInfo 拿 installed / snippet（签名条目）。
  for (const profile of listCustomMcpProfiles()) {
    clients[profile.key] = clientInfo(profile.key)
  }
  return {
    tokenReady: readToken() !== null,
    rpcRunning: typeof rpcPort === 'number' && rpcPort > 0,
    server,
    trustedHosts,
    clients,
  }
}

function tomlUnescape(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}

/** 取 [mcp_servers.nomi] 块的正文（到下一个 [表头] 或 EOF）；没这块回 null。 */
function codexBlockBody(text: string): string | null {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => CODEX_HEADER_RE.test(line))
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^\s*\[/.test(line))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

function codexConfiguredEntry(target: string): McpServerEntry | null {
  const body = codexBlockBody(readText(target))
  if (body === null) return null
  const command = body.match(/^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/m)?.[1]
  if (!command) return null
  const argsRaw = body.match(/^\s*args\s*=\s*\[(.*)\]\s*$/m)?.[1] ?? ''
  const args = [...argsRaw.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => tomlUnescape(m[1]))
  const env: Record<string, string> = {}
  // 只认我们写的行内表；用户手改成 [mcp_servers.nomi.env] 子表时 env 留空（不影响 command 可执行性判断）。
  const envRaw = body.match(/^\s*env\s*=\s*\{(.*)\}\s*$/m)?.[1] ?? ''
  for (const m of envRaw.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g)) env[m[1]] = tomlUnescape(m[2])
  return { command: tomlUnescape(command), args, env }
}

/**
 * 读回该客户端**实际会启动的那条命令**——注意不是 mcpServerEntry()（那是「我们现在会写什么」）。
 * 两者可能天差地别：老版本 Nomi 写过 `node <repo>/scripts/nomi-mcp.mjs`（该脚本已随 5a40acbc 删除）、
 * 从 dev 构建点接入会把 args 钉在一条随时会消失的 git worktree 上。「已接入」若只看配置里有没有这行字，
 * 这些全都显示绿灯而实际早断了——验证必须拿这条读回来的命令去真跑（见 mcpVerify）。
 */
export function configuredMcpEntry(client?: string): McpServerEntry | null {
  const key = resolveClient(client)
  const spec = resolveClientSpec(key)
  if (!spec) return null
  const target = spec.configPath()
  if (spec.format === 'toml') return codexConfiguredEntry(target)
  const servers = readJsonConfig(target).mcpServers as Record<string, unknown> | undefined
  const entry = servers && typeof servers === 'object' ? servers[SERVER_NAME] : undefined
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const command = typeof record.command === 'string' ? record.command : ''
  if (!command) return null
  const args = Array.isArray(record.args) ? record.args.filter((a): a is string => typeof a === 'string') : []
  const env: Record<string, string> = {}
  if (record.env && typeof record.env === 'object') {
    for (const [k, v] of Object.entries(record.env as Record<string, unknown>)) if (typeof v === 'string') env[k] = v
  }
  return { command, args, env }
}

function sameLauncher(left: McpServerEntry, right: McpServerEntry): boolean {
  return left.command === right.command && left.args.length === right.args.length
    && left.args.every((arg, index) => arg === right.args[index])
}

function isLegacyScriptEntry(entry: McpServerEntry): boolean {
  return entry.args.some((arg) => /(?:^|[\\/])scripts[\\/]nomi-mcp\.mjs$/i.test(arg))
}

function isNomiRuntimeCommand(command: string): boolean {
  const normalized = command.replaceAll('\\', '/')
  return /(?:^|\/)(?:Nomi Helper|Nomi|Electron)(?:\.exe)?$/i.test(normalized)
}

function isDirectNomiAppEntry(entry: McpServerEntry): boolean {
  return /(?:^|[\\/])Nomi(?:\.app[\\/]Contents[\\/]MacOS[\\/]Nomi|\.exe)?$/i.test(entry.command)
}

function isNodeLauncherEntry(entry: McpServerEntry): boolean {
  return entry.env?.NOMI_MCP_STDIO === '1'
    && entry.env?.ELECTRON_RUN_AS_NODE === '1'
    && typeof entry.env?.NOMI_MCP_APP_COMMAND === 'string'
    && isNomiRuntimeCommand(entry.command)
    && entry.args.some((arg) => /(?:^|[\\/])dist-electron[\\/]capabilityCore[\\/]mcpNodeLauncher\.js$/i.test(arg))
}

function looksLikeNomiLauncher(entry: McpServerEntry): boolean {
  if (isLegacyScriptEntry(entry)) return true
  return isDirectNomiAppEntry(entry) || isNodeLauncherEntry(entry)
}

function missingDevelopmentPath(entry: McpServerEntry): boolean {
  if (entry.env?.[MCP_CONFIG_KIND_ENV] !== 'development' && !/(?:^|[\\/])Electron(?:\.app[\\/].*)?$/i.test(entry.command)) return false
  return entry.args.some((arg) => (path.isAbsolute(arg) || arg.startsWith('.')) && !fs.existsSync(arg))
}

export function classifyMcpEntry(
  client: McpClientKey,
  entry: McpServerEntry | null,
  expected = mcpServerEntry(client),
): McpConfigState {
  if (!entry) return 'absent'
  // Exact equality with Nomi's current launcher is authoritative even in test/dev runtimes whose
  // executable basename is `node` rather than Nomi/Electron. Historical shapes still use the
  // narrower recognizers below so an unrelated custom proxy is never claimed or migrated.
  if (!sameLauncher(entry, expected) && !looksLikeNomiLauncher(entry)) return 'custom'
  if (isLegacyScriptEntry(entry)) return 'legacy-launcher'
  if (missingDevelopmentPath(entry)) return 'stale-development'
  if (verifyMcpClient(entry.env?.[MCP_CLIENT_ENV], entry.env?.[MCP_CLIENT_PROOF_ENV]) !== client
      || entry.env?.[MCP_CONFIG_VERSION_ENV] !== MCP_CONFIG_VERSION) return 'auth-stale'
  if (!sameLauncher(entry, expected)) return 'launcher-stale'
  return entry.env?.[MCP_CONFIG_KIND_ENV] === 'development' ? 'development' : 'current'
}

function shouldAutoMigrate(state: McpConfigState): boolean {
  return state === 'legacy-launcher'
    || state === 'stale-development'
    || state === 'auth-stale'
    || state === 'launcher-stale'
}

/** 一键写入指定客户端：备份 → 合并 nomi 条目（保留其它）→ 原子写回。默认 Claude Code。 */
export function installMcp(client?: string): { ok: boolean; client: McpClientKey; configPath: string; backupPath: string | null } {
  const key = resolveClient(client)
  const spec = resolveClientSpec(key)
  if (!spec) return { ok: false, client: key, configPath: '', backupPath: null }
  const target = spec.configPath()
  const backupPath = spec.format === 'toml' ? codexInstall(target, key) : jsonInstall(target, key)
  return { ok: true, client: key, configPath: target, backupPath }
}

/** 撤销接入指定客户端：删 nomi 条目（不碰其它）。文件不存在/没装就当成功。默认 Claude Code。 */
export function uninstallMcp(client?: string): { ok: boolean; client: McpClientKey } {
  const key = resolveClient(client)
  const spec = resolveClientSpec(key)
  if (!spec) return { ok: false, client: key }
  const target = spec.configPath()
  if (spec.format === 'toml') codexUninstall(target)
  else jsonUninstall(target)
  return { ok: true, client: key }
}
