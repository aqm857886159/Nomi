// 能力核 · 安全门（见 docs/plan/2026-06-20-capability-core-headless-exposure.md §S6）。
//
// 外部 agent（Claude Code / Codex）经 CLI / MCP 调能力核 = 能触发生成（花用户额度）+ 改工程文件。
// 必须有门：① 本地 token 鉴权（任意进程想调先证明它拿到了用户机器上的 token 文件）；
// ② RPC server 只监听 127.0.0.1（不开公网，见 rpcServer）。这是「别让任意 agent 静默烧钱」的地基。
//
// token / 实例广告落**确定路径** `~/.nomi/capability-core/`（可被 NOMI_CAPABILITY_DIR 覆盖）。
// 为什么不用 electron userData：getName() 在 dev("nomi")/打包("Nomi") 不一致 → 纯 node 的 CLI 算不准；
// 用 home 下固定路径，app 侧与 CLI 端算同一处，探测才可靠（隔离实例可设 NOMI_CAPABILITY_DIR 各自隔离）。
// 首次需要时惰性生成 token；权限尽量收紧（0600）。
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const CAPABILITY_DIR_ENV = 'NOMI_CAPABILITY_DIR'
export const MCP_CLIENT_ENV = 'NOMI_MCP_CLIENT'
export const MCP_CLIENT_PROOF_ENV = 'NOMI_MCP_CLIENT_PROOF'
const TOKEN_FILE = 'token'
const MCP_CLIENT_PROOF_CONTEXT = 'nomi-mcp-client:v1'

export type AuthenticatedMcpClient = 'claude' | 'codex' | 'cursor'
export type CapabilityOriginHost = 'external' | 'nomi' | AuthenticatedMcpClient

const MCP_CLIENTS = new Set<AuthenticatedMcpClient>(['claude', 'codex', 'cursor'])

export function capabilityCoreDir(): string {
  const configured = String(process.env[CAPABILITY_DIR_ENV] || '').trim()
  return configured || path.join(os.homedir(), '.nomi', 'capability-core')
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function tokenPath(): string {
  return path.join(capabilityCoreDir(), TOKEN_FILE)
}

/** 读取已存在的 token（无则 null，不自动生成——读路径不该有副作用）。 */
export function readToken(): string | null {
  try {
    const value = fs.readFileSync(tokenPath(), 'utf8').trim()
    return value || null
  } catch {
    return null
  }
}

/** 确保 token 存在并返回它（幂等：已存在直接返回，缺失才生成）。app 启动时调一次。 */
export function ensureToken(): string {
  const existing = readToken()
  if (existing) return existing
  const token = crypto.randomBytes(24).toString('hex')
  const dir = capabilityCoreDir()
  ensureDir(dir)
  fs.writeFileSync(tokenPath(), token, { encoding: 'utf8', mode: 0o600 })
  try {
    fs.chmodSync(tokenPath(), 0o600)
  } catch {
    /* Windows 等无 POSIX 权限：忽略，token 仍只在 userData 内 */
  }
  return token
}

/**
 * 恒定时间比较，防 token 鉴权被时序侧信道试探。长度不等直接 false（timingSafeEqual 要求等长）。
 */
export function verifyToken(provided: unknown): boolean {
  const expected = readToken()
  if (!expected || typeof provided !== 'string' || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function mcpClient(value: unknown): AuthenticatedMcpClient | null {
  return typeof value === 'string' && MCP_CLIENTS.has(value as AuthenticatedMcpClient)
    ? value as AuthenticatedMcpClient
    : null
}

/**
 * A scoped capability written by Nomi into one client's MCP config. It proves that Nomi installed
 * that client entry without exposing the capability-core bearer token itself.
 */
export function signMcpClient(client: AuthenticatedMcpClient): string | null {
  const token = readToken()
  if (!token) return null
  return crypto
    .createHmac('sha256', token)
    .update(`${MCP_CLIENT_PROOF_CONTEXT}:${client}`)
    .digest('base64url')
}

export function verifyMcpClient(clientValue: unknown, proofValue: unknown): AuthenticatedMcpClient | null {
  const client = mcpClient(clientValue)
  if (!client || typeof proofValue !== 'string' || !proofValue) return null
  const expected = signMcpClient(client)
  if (!expected) return null
  const actualBytes = Buffer.from(proofValue)
  const expectedBytes = Buffer.from(expected)
  if (actualBytes.length !== expectedBytes.length) return null
  return crypto.timingSafeEqual(actualBytes, expectedBytes) ? client : null
}

/** Self-declared or invalid client labels remain external and never gain trusted-host authority. */
export function resolveMcpOrigin(clientValue: unknown, proofValue: unknown): CapabilityOriginHost {
  return verifyMcpClient(clientValue, proofValue) ?? 'external'
}
