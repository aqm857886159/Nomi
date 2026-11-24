// 内置 MCP 客户端注册表 —— **全仓唯一 owner**（2026-09-14，根因合同
// docs/fixes/2026-09-14-mcp-connection-truthfulness.root-cause.json）。
//
// 此前同一份名单在仓库里手抄了 5 份（security.ts / mcpConfig.ts / assistantActivationState.ts /
// settingsAutomationView.ts / productionRunView.ts）+ 2 份漏抄（handoffQueue / integrationSessionRecord
// 白名单少了 pi、workbuddy）。漂移的后果是「连上 WorkBuddy 显示绿灯，但请求被 Invalid handoff owner 拒」。
// 现在：配置路径、安装痕迹、显示名、默认信任、宿主自身审批——每个客户端的每个事实都只写在这里，
// 主进程（security / mcpConfig / mcpDetectedClients / automationPolicyContract）与渲染层
// （assistantActivationState / productionRunView）全部 derive；编译器负责拦漂移（key 是字面量联合类型）。
//
// 本文件是**中立契约层**：不引 node 内置、不引 electron——渲染层 bundle 也要 import 它。
// 路径只给「相对哪个根 + 段」，真正 join / existsSync 住在 electron/capabilityCore/mcpDetectedClients.ts。
//
// 规范链接（R31：每家一条，偏差理由见 docs/plan/2026-09-14-mcp-connection-truthfulness.md）：
//   Claude Code    https://code.claude.com/docs/en/mcp        user scope = ~/.claude.json 顶层 mcpServers
//   Claude Desktop https://modelcontextprotocol.io/quickstart/user
//                    macOS ~/Library/Application Support/Claude/claude_desktop_config.json；Windows %APPDATA%\Claude\…
//   Codex CLI      https://learn.chatgpt.com/docs/extend/mcp?surface=cli   ~/.codex/config.toml [mcp_servers.<name>]
//   Cursor         https://cursor.com/docs/context/mcp        ~/.cursor/mcp.json
//   WorkBuddy      https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide
//                    ~/.workbuddy/mcp.json
// pi 已从名单删除：pi 官方 usage 明写 "intentionally does not include built-in MCP"，此前那一项
// 写的是第三方 pi-mcp-adapter 才读的 ~/.config/mcp/mcp.json，且没装 pi 也会凭空建目录——是假项。
// 用 pi-mcp-adapter 的人走「其他客户端 · 复制通用配置」。
//
// 宿主自己的「配置位置」变量（R5.5，2026-10-24）：用户设了它，宿主就读写那个位置，Nomi 必须读写同一处。
// 此前这里只认主目录，设了变量的用户点「接入」写进的是宿主根本不读的文件；隔离起的走查也因此读到真机配置。
//   Claude Code  CLAUDE_CONFIG_DIR  https://code.claude.com/docs/en/env-vars（配置目录，默认 ~/.claude）
//                .claude.json 落在 (CLAUDE_CONFIG_DIR || HOME)/.claude.json：
//                https://github.com/anthropics/claude-code/blob/main/mods/telemetry/hooks/context/identity/global-config-path/global-config-path.ts
//   Codex        CODEX_HOME  https://github.com/openai/codex/blob/main/codex-rs/utils/home-dir/src/lib.rs（非空才算设了，默认 ~/.codex）
//                用户层配置 ${CODEX_HOME}/config.toml：https://github.com/openai/codex/blob/main/codex-rs/config/src/loader/mod.rs
//   Claude Desktop / Cursor / WorkBuddy 的官方文档只给固定位置，没有改位置的变量（见上面各自的规范链接）。
// 「设了」的判据跟宿主一样：值非空。两家宿主都不展开 `~`、相对路径各自按自己的 cwd 解释，这里原样使用。

/** 路径根：`home` = 用户主目录；`appData` = macOS ~/Library/Application Support、Windows %APPDATA%、Linux ~/.config。 */
export type McpClientPathRoot = 'home' | 'appData'
/** 宿主自己的配置位置变量：设了（非空）就是 `<变量值>/<segments>`，没设才用外层的 root + segments。 */
export type McpClientHostEnv = { name: string; segments: readonly string[] }
export type McpClientPath = { root: McpClientPathRoot; segments: readonly string[]; hostEnv?: McpClientHostEnv }
export type McpClientPlatform = 'darwin' | 'win32' | 'linux'

type McpClientSpec = {
  /** 产品专名，不进 i18n。 */
  label: string
  format: 'json' | 'toml'
  /** 该客户端**用户级** MCP 配置文件；按平台给，缺的平台 = 该平台没有这个客户端。 */
  configPath: Partial<Record<McpClientPlatform, McpClientPath>>
  /** 宿主自己的位置变量所代表的根目录；没有宿主根目录概念的客户端不填写。 */
  hostRoot?: Partial<Record<McpClientPlatform, McpClientPath>>
  /** 安装痕迹：任一存在即判「已安装」。只读官方用户目录，不 spawn、不建目录。 */
  installMarkers: Partial<Record<McpClientPlatform, readonly McpClientPath[]>>
  /** 写完档默认就是可信发起方（automationPolicy.trustedHosts 的默认值由此 derive）。 */
  defaultTrusted: boolean
  /** 宿主自己还有一道 MCP server 审批门（Nomi 握手成功不代表宿主已放行），UI 据此不把徽章判绿。 */
  requiresHostApproval: boolean
  /** 官方规范链接（R31）。 */
  spec: string
}

const home = (...segments: string[]): McpClientPath => ({ root: 'home', segments })
const appData = (...segments: string[]): McpClientPath => ({ root: 'appData', segments })
/** 宿主配置目录里的一条路径：设了 `env` 就在它下面；没设就在主目录下的 `fallback` 下面。 */
const hostDir = (env: string, fallback: readonly string[], ...segments: string[]): McpClientPath => ({
  root: 'home',
  segments: [...fallback, ...segments],
  hostEnv: { name: env, segments },
})
const everywhere = <T>(value: T): Record<McpClientPlatform, T> => ({ darwin: value, win32: value, linux: value })

export const MCP_CLIENT_REGISTRY = {
  claude: {
    label: 'Claude Code',
    format: 'json',
    // `.claude.json` 没设变量时在主目录（不在 ~/.claude 里），设了就在变量目录里——两条规则都照宿主源码。
    configPath: everywhere(hostDir('CLAUDE_CONFIG_DIR', [], '.claude.json')),
    installMarkers: everywhere([hostDir('CLAUDE_CONFIG_DIR', ['.claude']), hostDir('CLAUDE_CONFIG_DIR', [], '.claude.json')]),
    defaultTrusted: true,
    requiresHostApproval: false,
    spec: 'https://code.claude.com/docs/en/mcp',
  },
  'claude-desktop': {
    label: 'Claude Desktop',
    format: 'json',
    configPath: {
      darwin: appData('Claude', 'claude_desktop_config.json'),
      win32: appData('Claude', 'claude_desktop_config.json'),
    },
    installMarkers: {
      darwin: [appData('Claude')],
      win32: [appData('Claude')],
    },
    defaultTrusted: false,
    requiresHostApproval: false,
    spec: 'https://modelcontextprotocol.io/quickstart/user',
  },
  codex: {
    label: 'Codex',
    format: 'toml',
    hostRoot: everywhere(hostDir('CODEX_HOME', ['.codex'])),
    configPath: everywhere(hostDir('CODEX_HOME', ['.codex'], 'config.toml')),
    installMarkers: everywhere([hostDir('CODEX_HOME', ['.codex'])]),
    defaultTrusted: true,
    requiresHostApproval: false,
    spec: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
  },
  cursor: {
    label: 'Cursor',
    format: 'json',
    configPath: everywhere(home('.cursor', 'mcp.json')),
    installMarkers: everywhere([home('.cursor')]),
    defaultTrusted: false,
    requiresHostApproval: true,
    spec: 'https://cursor.com/docs/context/mcp',
  },
  workbuddy: {
    label: 'WorkBuddy',
    format: 'json',
    configPath: everywhere(home('.workbuddy', 'mcp.json')),
    installMarkers: everywhere([home('.workbuddy')]),
    defaultTrusted: false,
    requiresHostApproval: false,
    spec: 'https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide',
  },
} as const satisfies Record<string, McpClientSpec>

export type BuiltinMcpClient = keyof typeof MCP_CLIENT_REGISTRY

/** 展示顺序 = 注册表键序（一键接入分段控件、发起方标签都按这个序）。 */
export const BUILTIN_MCP_CLIENTS = Object.keys(MCP_CLIENT_REGISTRY) as readonly BuiltinMcpClient[]

export function isBuiltinMcpClient(value: unknown): value is BuiltinMcpClient {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MCP_CLIENT_REGISTRY, value)
}

function builtinMcpClientSpec(client: BuiltinMcpClient): McpClientSpec {
  return MCP_CLIENT_REGISTRY[client]
}

/** 默认可信发起方（不含本机 `nomi`，那是 automationPolicyContract 固定加的）。 */
export const DEFAULT_TRUSTED_MCP_CLIENTS: readonly BuiltinMcpClient[] = BUILTIN_MCP_CLIENTS.filter(
  (key) => MCP_CLIENT_REGISTRY[key].defaultTrusted,
)

// ── 路径解析：全仓唯一一份规则（主进程、走查启动器、测试都调它，不各写一份）─────────────────────────
// 纯函数：平台 / 环境 / 主目录 / join 都由调用方给，本文件仍不引 node 内置。

export type McpClientPathContext = Readonly<{
  platform: McpClientPlatform
  env: Readonly<Record<string, string | undefined>>
  /** 用户主目录（Node 的 os.homedir()：POSIX 先看 HOME、Windows 看 USERPROFILE）。 */
  homedir: string
  join: (...parts: string[]) => string
}>

export function mcpClientPlatform(platform: string): McpClientPlatform {
  return platform === 'darwin' || platform === 'win32' ? platform : 'linux'
}

/** 宿主变量「设了」= 值非空（Codex `filter(|v| !v.is_empty())`、Claude Code `configDir || home` 都是这个判据）。 */
function hostEnvValue(context: McpClientPathContext, name: string): string | null {
  const value = context.env[name]
  return typeof value === 'string' && value !== '' ? value : null
}

function appDataDir(context: McpClientPathContext): string {
  const trimmed = (value: string | undefined) => String(value || '').trim()
  if (context.platform === 'darwin') return context.join(context.homedir, 'Library', 'Application Support')
  if (context.platform === 'win32') return trimmed(context.env.APPDATA) || context.join(context.homedir, 'AppData', 'Roaming')
  return trimmed(context.env.XDG_CONFIG_HOME) || context.join(context.homedir, '.config')
}

export function resolveMcpClientPath(location: McpClientPath, context: McpClientPathContext): string {
  const hostRoot = location.hostEnv ? hostEnvValue(context, location.hostEnv.name) : null
  if (hostRoot !== null && location.hostEnv) return context.join(hostRoot, ...location.hostEnv.segments)
  return context.join(location.root === 'home' ? context.homedir : appDataDir(context), ...location.segments)
}

/** 某个内置客户端的宿主根目录；根目录的变量判定与所有注册表路径完全相同。 */
export function resolveMcpClientHostRoot(client: BuiltinMcpClient, context: McpClientPathContext): string {
  const location = builtinMcpClientSpec(client).hostRoot?.[context.platform]
  if (!location) throw new Error(`MCP client ${client} has no host root`)
  return resolveMcpClientPath(location, context)
}

/** 某个内置客户端在这个环境下的用户级配置文件；该平台没有这个客户端时为 null。 */
export function mcpClientConfigFile(client: BuiltinMcpClient, context: McpClientPathContext): string | null {
  const location = builtinMcpClientSpec(client).configPath[context.platform]
  return location ? resolveMcpClientPath(location, context) : null
}

/** 某个内置客户端在这个环境下的全部安装痕迹路径。 */
export function mcpClientInstallTraces(client: BuiltinMcpClient, context: McpClientPathContext): string[] {
  return (builtinMcpClientSpec(client).installMarkers[context.platform] ?? []).map((marker) => resolveMcpClientPath(marker, context))
}

/** 注册表里每一条路径（配置文件 + 安装痕迹，三平台）—— 隔离检查与门岗按它逐条核，不手抄。 */
export function mcpClientLocations(): Array<{ client: BuiltinMcpClient; platform: McpClientPlatform; location: McpClientPath }> {
  return BUILTIN_MCP_CLIENTS.flatMap((client) => {
    const spec = builtinMcpClientSpec(client)
    return (['darwin', 'win32', 'linux'] as const).flatMap((platform) => {
      const configPath = spec.configPath[platform]
      return [...(configPath ? [configPath] : []), ...(spec.installMarkers[platform] ?? [])].map((location) => ({ client, platform, location }))
    })
  })
}

/** 宿主自己的配置位置变量（去重）。隔离起 App 时每一个都要指到临时目录。 */
export const MCP_CLIENT_HOST_ENV_VARS: readonly string[] = [
  ...new Set(mcpClientLocations().flatMap(({ location }) => (location.hostEnv ? [location.hostEnv.name] : []))),
]
