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

/** 路径根：`home` = 用户主目录；`appData` = macOS ~/Library/Application Support、Windows %APPDATA%、Linux ~/.config。 */
export type McpClientPathRoot = 'home' | 'appData'
export type McpClientPath = { root: McpClientPathRoot; segments: readonly string[] }

export type McpClientSpec = {
  /** 产品专名，不进 i18n。 */
  label: string
  format: 'json' | 'toml'
  /** 该客户端**用户级** MCP 配置文件；按平台给，缺的平台 = 该平台没有这个客户端。 */
  configPath: Partial<Record<'darwin' | 'win32' | 'linux', McpClientPath>>
  /** 安装痕迹：任一存在即判「已安装」。只读官方用户目录，不 spawn、不建目录。 */
  installMarkers: Partial<Record<'darwin' | 'win32' | 'linux', readonly McpClientPath[]>>
  /** 写完档默认就是可信发起方（automationPolicy.trustedHosts 的默认值由此 derive）。 */
  defaultTrusted: boolean
  /** 宿主自己还有一道 MCP server 审批门（Nomi 握手成功不代表宿主已放行），UI 据此不把徽章判绿。 */
  requiresHostApproval: boolean
  /** 官方规范链接（R31）。 */
  spec: string
}

const home = (...segments: string[]): McpClientPath => ({ root: 'home', segments })
const appData = (...segments: string[]): McpClientPath => ({ root: 'appData', segments })
const everywhere = <T>(value: T): Record<'darwin' | 'win32' | 'linux', T> => ({ darwin: value, win32: value, linux: value })

export const MCP_CLIENT_REGISTRY = {
  claude: {
    label: 'Claude Code',
    format: 'json',
    configPath: everywhere(home('.claude.json')),
    installMarkers: everywhere([home('.claude'), home('.claude.json')]),
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
    configPath: everywhere(home('.codex', 'config.toml')),
    installMarkers: everywhere([home('.codex')]),
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

export function builtinMcpClientSpec(client: BuiltinMcpClient): McpClientSpec {
  return MCP_CLIENT_REGISTRY[client]
}

/** 默认可信发起方（不含本机 `nomi`，那是 automationPolicyContract 固定加的）。 */
export const DEFAULT_TRUSTED_MCP_CLIENTS: readonly BuiltinMcpClient[] = BUILTIN_MCP_CLIENTS.filter(
  (key) => MCP_CLIENT_REGISTRY[key].defaultTrusted,
)
