// 「接入 AI 编程助手」桥接口的类型（从 bridge.ts 抽出：R9 防巨壳 + 与卡片共用同一份定义，
// 免得渲染层再手抄一遍枚举——那正是「两处定义各自漂移」的老坑）。
// 主进程侧的实现见 electron/capabilityCore/mcpConfig.ts 与 mcpVerify.ts。

export type McpClientKey = string
export type McpLauncherKind = 'packaged' | 'development'

/** 自定义 MCP 客户端 profile（方案 A：任意支持 MCP stdio 的工具接入）。 */
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
export type McpConfigState =
  | 'absent'
  | 'current'
  | 'development'
  | 'legacy-launcher'
  | 'stale-development'
  | 'auth-stale'
  | 'launcher-stale'
  | 'custom'

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
  server: { command: string; args: string[]; env?: Record<string, string> }
  trustedHosts: string[]
  clients: Record<McpClientKey, McpClientInfo>
}

/** 实连验证的失败原因。UI 文案按它走 i18n（主进程不回中文——R15）。 */
export type McpVerifyReason =
  | 'ok'
  | 'not-installed'
  | 'command-missing'
  | 'argument-missing'
  | 'spawn-failed'
  | 'timeout'
  | 'handshake-failed'
  | 'client-auth-missing'

export type McpVerifyResult = {
  ok: boolean
  reason: McpVerifyReason
  /** 握手往返毫秒；失败为 null。UI 拿它显示「已接入 · 0.5s」当证据。 */
  latencyMs: number | null
  toolCount: number | null
  /** 配置里那条命令 ≠ 现在应该写的那条 → 陈旧配置，「重新接入」能直接治好。 */
  stale: boolean
  /** 原始错误（截断），只进日志/排查，不直接展示。 */
  detail: string
}
