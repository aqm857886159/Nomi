// 能力核 · Desktop 兼容转发口（入口）：stdio 进、本机 HTTP 出。给只会 stdio 的宿主（Claude Desktop）用；
// 会说 HTTP 的宿主直连 Nomi，不经这里。设计卡 docs/plan/2026-10-05-mcp-official-sdk.md 第 2 段。
//
// 打包后以 ELECTRON_RUN_AS_NODE=1 跑在 app.asar 里的裸 Node 上（与 mcpNodeLauncher 同样的跑法），所以
// 闭包里不许有 electron 值导入。这里只读身份（宿主配置里的两个环境变量，与旧启动器同名）、定地址、接桥；
// 不冷启动 Nomi——Nomi 没开时宿主那边直接看到「连不上，请先打开 Nomi」（与连接卡上那句常驻提示一致）。
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'

import { bridgeStdioToHttp } from './mcpHttpBridge'
import { MCP_HTTP_DEFAULT_PORT, forwarderFetch, liveForwarderUrl, mcpHttpUrl } from './mcpHttpEndpoint'
import { MCP_TRANSPORT_ERROR_EVENT } from './mcpStdioDiagnostics'
import { MCP_CLIENT_ENV, MCP_CLIENT_PROOF_ENV } from './security'

const client = String(process.env[MCP_CLIENT_ENV] || '').trim()
const proof = String(process.env[MCP_CLIENT_PROOF_ENV] || '').trim()
// 身份只发往「本机此刻活着的那个 Nomi 的稳定地址」：每个出站请求都在 forwarderFetch 里重核（端口 = 稳定端口、
// 端点文件记的就是它、写端点文件的进程还活着），对不上就一个字节都不发，桥给宿主回「请先打开 Nomi」。
const upstream = new StreamableHTTPClientTransport(new URL(liveForwarderUrl() ?? mcpHttpUrl(MCP_HTTP_DEFAULT_PORT)), {
  fetch: forwarderFetch(client, proof),
  requestInit: { redirect: 'error' },
})

// stdout 整条给 JSON-RPC；诊断只走 stderr（事件名与两条启动器共用一个常量）。
void bridgeStdioToHttp(new StdioServerTransport(), upstream, {
  onError: (error) => process.stderr.write(`[nomi-mcp] ${MCP_TRANSPORT_ERROR_EVENT} message=${JSON.stringify(error.message)}\n`),
}).then(() => process.exit(0))
