#!/usr/bin/env node
/**
 * 旧 MCP 入口的**迁移墓碑**（不是旧实现的回归，见 P1）。
 *
 * 根因：MCP 入口从 `node scripts/nomi-mcp.mjs` 换成「Nomi 自身二进制 + NOMI_MCP_STDIO=1」时，
 * 旧文件被同 commit 删净（P1 加新必删旧做对了），但**已经装在用户机器上的宿主配置**
 * （`~/.claude.json`、Codex 的 `config.toml`、Cursor 的 `mcp.json`）仍指着这个路径。
 * node 找不到模块就立刻退出，宿主侧只看得到一句 `CONNECTION_CLOSED` —— 错误里没有一个字提到 Nomi，
 * 用户无从知道该做什么。删旧实现是对的，**没留迁移路标**是漏的。
 *
 * 这个文件唯一的作用就是当路标：向 stderr 打一行中英双语的人话，然后以退出码 2 结束。
 *
 * 为什么不直接 exec 到新入口（转发）：新入口需要每客户端、每机器签名的
 * `NOMI_MCP_CLIENT` / `NOMI_MCP_CLIENT_PROOF`（见 electron/capabilityCore/mcpConfig.ts:mcpServerEntry）。
 * 这份证明只有 Nomi 应用自己签得出，一个 node 脚本既拿不到、也不该去伪造 —— 伪造等于绕过
 * 可信宿主门。而且这个脚本连 Nomi 装在哪都不知道（旧配置里只有仓库路径）。
 * 所以这里**明确失败并说清下一步**，而不是猜一条可能把人带进更难懂的错误里的路。
 *
 * 退出码 2 = 「配置过期，需要人来重新接入」，与 node 的 1（未捕获异常）区分开，便于宿主/脚本分诊。
 */

const MIGRATION_NOTICE = [
  'Nomi MCP 入口已迁移：这个 scripts/nomi-mcp.mjs 只是一块路标，已不再是 MCP server。',
  '请在 Nomi →「模型接入」→「接入 AI 编程助手」里对你的客户端重新接一次，然后重启该客户端。',
  '（新入口是 Nomi 应用自身二进制 + NOMI_MCP_STDIO=1，并带每客户端签名的证明；不要手抄配置。）',
  'The Nomi MCP entry point has moved: scripts/nomi-mcp.mjs is only a signpost and is no longer an MCP server.',
  'Re-connect your client in Nomi > "Model access" > "Connect an AI coding assistant", then restart that client.',
  '(The new entry point is the Nomi app binary itself with NOMI_MCP_STDIO=1 plus a per-client signed proof; do not hand-copy a config.)',
].join('\n')

/** 退出码：2 = 陈旧宿主配置指到了已迁移的入口（可被宿主/脚本按码分诊）。 */
export const STALE_ENTRY_EXIT_CODE = 2

export function migrationNotice() {
  return MIGRATION_NOTICE
}

// 直接被当成 MCP server 启动时才打印并退出；被测试 import 时只暴露上面两个纯函数。
if (process.argv[1] && process.argv[1].endsWith('nomi-mcp.mjs')) {
  process.stderr.write(`${MIGRATION_NOTICE}\n`)
  process.exit(STALE_ENTRY_EXIT_CODE)
}
