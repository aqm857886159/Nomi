import type { McpInfo } from '../../desktop/mcpBridgeTypes'

/**
 * 「其他客户端」要粘的通用 MCP 配置片段 —— **不带客户端身份**（无 NOMI_MCP_CLIENT / _PROOF）。
 *
 * 唯一 owner：设置 → 自动化与权限 → AI 助手连接的「其他客户端 · 复制通用配置」，与设置 → 模型 →
 * 「用 AI 帮我接入 → 其它」两处复制的都是它。此前前者复制的是当前选中客户端的**已签名**片段
 * （含 Claude Code 的 HMAC proof）——照提示粘进 Cline，Cline 就冒充成默认可信的 Claude Code。
 *
 * 形状 owner 是主进程的 `mcpConfig.jsonSnippet`（`{ mcpServers: { nomi: … } }`）——那也是
 * Claude Code / Cursor 等家的事实标准形状（<https://code.claude.com/docs/en/mcp>，
 * 夹具 tests/fixtures/standard-formats/mcp/.mcp.json）。**内容必须现算**：command/args 逐台机器不同。
 *
 * `info.server` 是 `mcpServerEntry()` 无参形态，里面没有任何密钥；未签名连接在能力核里的身份是
 * `external`：不在可信发起方之列，走得完 integration.* 全程，但不能替用户自动花钱。
 */
export function genericMcpSnippet(server: McpInfo['server']): string {
  return JSON.stringify({ mcpServers: { nomi: server } }, null, 2)
}
