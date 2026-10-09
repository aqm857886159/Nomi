// 能力核 · 本机 HTTP 直连的「地址与身份」——服务端、Desktop 转发口、（第 3 段的）宿主配置写入共用这一份。
// 设计卡 docs/plan/2026-10-05-mcp-official-sdk.md 第 2 段。
//
// 只放名字、地址、身份头的形状和那份端点文件的读写；不放协议，也不放领域。
// 必须保持 electron-free：转发口跑在裸 Node 上（同 mcpNodeLauncher 的约束）。
import fs from 'node:fs'
import path from 'node:path'

import { capabilityCoreDir, signMcpClient, type AuthenticatedMcpClient } from './security'

/** MCP 端点路径（宿主配置里的 url 就是 http://127.0.0.1:<端口>/mcp）。 */
export const MCP_HTTP_PATH = '/mcp'
/**
 * 默认端口：写进宿主配置的地址要稳定，所以不能每次启动随机。被占用时本次不开 HTTP（记日志），
 * 旧的 stdio 启动器照常能用；隔离实例（走查 / 自定义 capability 目录）不抢默认端口，见 resolveMcpHttpPort。
 */
export const MCP_HTTP_DEFAULT_PORT = 47173
/** 显式指定端口（0 = 随机，走查用）。 */
export const MCP_HTTP_PORT_ENV = 'NOMI_MCP_HTTP_PORT'
/** 转发口要连的地址（缺省读端点文件，再缺省用默认端口）。 */
export const MCP_HTTP_URL_ENV = 'NOMI_MCP_HTTP_URL'
/**
 * 身份头：与回环 RPC 同一对名字、同一种签名（Nomi 用本机 capability token 给客户端名签的 proof）。
 * 不用 Authorization：宿主看到 401 / Bearer 会去走 OAuth 发现，把用户带进一个根本不存在的登录流程。
 */
export const MCP_HTTP_CLIENT_HEADER = 'x-nomi-mcp-client'
export const MCP_HTTP_CLIENT_PROOF_HEADER = 'x-nomi-mcp-client-proof'
const ENDPOINT_FILE = 'mcp-http.json'

export type McpHttpEndpoint = Readonly<{ url: string; port: number; pid: number }>

export function mcpHttpUrl(port: number): string {
  return `http://127.0.0.1:${port}${MCP_HTTP_PATH}`
}

/**
 * 这一次该监听哪个端口；null = 不开。显式环境变量优先；否则只有「用默认 capability 目录的正常实例」
 * 才占默认端口——走查与隔离实例不许把用户真 Nomi 的地址抢走。
 */
export function resolveMcpHttpPort(env: NodeJS.ProcessEnv = process.env): number | null {
  const explicit = String(env[MCP_HTTP_PORT_ENV] ?? '').trim()
  if (explicit) {
    const port = Number(explicit)
    return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : null
  }
  if (env.NOMI_E2E === '1' || String(env.NOMI_CAPABILITY_DIR ?? '').trim()) return null
  return MCP_HTTP_DEFAULT_PORT
}

function endpointPath(): string {
  return path.join(capabilityCoreDir(), ENDPOINT_FILE)
}

/** 本实例实际监听的地址写进 capability 目录（转发口与走查读它；和 token 同目录、同一个隔离边界）。 */
export function writeMcpHttpEndpoint(port: number): McpHttpEndpoint {
  const endpoint = { url: mcpHttpUrl(port), port, pid: process.pid }
  fs.mkdirSync(capabilityCoreDir(), { recursive: true })
  fs.writeFileSync(endpointPath(), JSON.stringify(endpoint, null, 2), 'utf8')
  return endpoint
}

/** 只清自己写的那份（别的进程已经接手就不动）。 */
export function clearMcpHttpEndpoint(): void {
  try {
    const current = readMcpHttpEndpoint()
    if (current && current.pid !== process.pid) return
    fs.rmSync(endpointPath(), { force: true })
  } catch {
    /* 退出路径不抛 */
  }
}

export function readMcpHttpEndpoint(): McpHttpEndpoint | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(endpointPath(), 'utf8')) as Partial<McpHttpEndpoint>
    if (typeof parsed.url !== 'string' || !Number.isInteger(parsed.port) || !Number.isInteger(parsed.pid)) return null
    return { url: parsed.url, port: parsed.port as number, pid: parsed.pid as number }
  } catch {
    return null
  }
}

/** 转发口连哪里：显式地址 > 端点文件 > 默认端口。 */
export function resolveForwarderUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = String(env[MCP_HTTP_URL_ENV] ?? '').trim()
  if (explicit) return explicit
  return readMcpHttpEndpoint()?.url ?? mcpHttpUrl(MCP_HTTP_DEFAULT_PORT)
}

export function mcpHttpIdentityHeaders(client: string, proof: string): Record<string, string> {
  return { [MCP_HTTP_CLIENT_HEADER]: client, [MCP_HTTP_CLIENT_PROOF_HEADER]: proof }
}

/**
 * 第 3 段「宿主配置新写法」要写进宿主的那一条：直连地址 + 身份头。这里只算，不写盘——写哪个文件、
 * 什么时候写、写前备份、用户点没点同意，都归第 3 段的迁移流程（mcpConfig）。
 */
export function buildMcpHttpHostEntry(client: AuthenticatedMcpClient, port: number = MCP_HTTP_DEFAULT_PORT): { url: string; headers: Record<string, string> } | null {
  const proof = signMcpClient(client)
  if (!proof) return null
  return { url: mcpHttpUrl(port), headers: mcpHttpIdentityHeaders(client, proof) }
}

/**
 * 稳定地址（宿主配置里写的那个）此刻是不是**本进程**在听：端点文件记的端口、地址、进程号都和本进程一致。
 * 别的 Nomi 实例占着这个端口、服务没起来（端口被占）、端点文件陈旧（进程已死）→ false，迁移据此拒绝（宿主保持 stdio）。
 */
export function isMcpHttpLiveAt(port: number): boolean {
  const endpoint = readMcpHttpEndpoint()
  return Boolean(endpoint && endpoint.port === port && endpoint.url === mcpHttpUrl(port) && endpoint.pid === process.pid)
}

/**
 * 转发口只许连本机回环的 MCP 端点（端口不限：转发口跑在宿主的进程环境里，不知道 Nomi 选了哪个端口）。
 * 地址来自宿主配置的环境变量，被改成外部地址时身份头不能跟着发出去 → 不连、直接退出。
 */
export function isLoopbackMcpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === MCP_HTTP_PATH
      && !url.username && !url.password && !url.search && !url.hash
  } catch {
    return false
  }
}
