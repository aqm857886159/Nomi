// MCP 接入状态的中立契约层 —— 主进程（mcpConfig / mcpVerify）、preload、渲染层（mcpBridgeTypes）
// 三边此前各抄一份字面量联合，check:vocabularies 把它们登记成 4 条 debt，收敛办法写在 debt 自己的
// reason 里：「在中立模块导出 as const tuple，再让各侧 derive」。2026-09-14 收敛于此。
// 本文件不引 node 内置、不引 electron。
//
// 损坏的启动器可自愈；仍然有效的另一份 Nomi / profile 只显示归属，由用户主动切换。

/** 客户端配置里那条 nomi 条目相对当前 Nomi 的兼容性判定（mcpConfig.classifyMcpEntry 的唯一产出）。 */
export const MCP_CONFIG_STATES = [
  'absent',
  'current',
  'development',
  'legacy-launcher',
  'stale-development',
  'auth-stale',
  'launcher-broken',
  'launcher-elsewhere',
  'migrated-http',
  'migrated-forwarder',
  'custom',
] as const
export type McpConfigState = (typeof MCP_CONFIG_STATES)[number]

/** 实连验证（mcpVerify.verifyMcp）的诊断结论；UI 文案按它走 i18n，主进程不回中文（R15）。 */
export const MCP_VERIFY_REASONS = [
  'ok',
  'not-installed',
  'command-missing',
  'argument-missing',
  'spawn-failed',
  'timeout',
  'handshake-failed',
  'client-auth-missing',
] as const
export type McpVerifyReason = (typeof MCP_VERIFY_REASONS)[number]
