// MCP 接入状态的中立契约层 —— 主进程（mcpConfig / mcpVerify）、preload、渲染层（mcpBridgeTypes）
// 三边此前各抄一份字面量联合，check:vocabularies 把它们登记成 4 条 debt，收敛办法写在 debt 自己的
// reason 里：「在中立模块导出 as const tuple，再让各侧 derive」。2026-09-14 收敛于此。
// 本文件不引 node 内置、不引 electron。
//
// 成员集与收敛前逐字相同（词表门岗要求收敛记录的成员与被退役的 debt 完全一致，才能证明它解释的是同一份
// 词表；成员的增删是收敛落地之后的另一件事）。「配置指向别的 / 已删除 profile」归 launcher-stale：
// launcher = Nomi 写下的那条**能启动这一个 Nomi 的**条目（command + args + NOMI_SETTINGS_DIR），三者任一
// 对不上，这条启动的就不是当前这个 Nomi。

/** 客户端配置里那条 nomi 条目相对当前 Nomi 的兼容性判定（mcpConfig.classifyMcpEntry 的唯一产出）。 */
export const MCP_CONFIG_STATES = [
  'absent',
  'current',
  'development',
  'legacy-launcher',
  'stale-development',
  'auth-stale',
  'launcher-stale',
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
