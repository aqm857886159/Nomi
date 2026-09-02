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

import { fsyncIfDurable } from '../durability'

export const CAPABILITY_DIR_ENV = 'NOMI_CAPABILITY_DIR'
export const MCP_CLIENT_ENV = 'NOMI_MCP_CLIENT'
export const MCP_CLIENT_PROOF_ENV = 'NOMI_MCP_CLIENT_PROOF'
const TOKEN_FILE = 'token'
const KEY_DIR = 'keys'
const MCP_CLIENT_PROOF_CONTEXT = 'nomi-mcp-client:v1'

// 客户端身份 key 的合法形状（复用 signingKeyPath 的命名校验，保持单一规则）。
const MCP_CLIENT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

/** 内置种子客户端（默认信任，配置文件路径由 Nomi 内置）。 */
export const BUILTIN_MCP_CLIENTS = ['claude', 'codex', 'cursor'] as const
export type BuiltinMcpClient = (typeof BUILTIN_MCP_CLIENTS)[number]

/** 任意 Nomi 签名过的 MCP 客户端身份（内置 + 用户自定义）。语义 = 过 isValidMcpClientKey 校验的 key 字符串。 */
export type AuthenticatedMcpClient = string

export type CapabilityOriginHost = 'external' | 'nomi' | AuthenticatedMcpClient

export function isValidMcpClientKey(value: unknown): value is AuthenticatedMcpClient {
  return typeof value === 'string' && MCP_CLIENT_KEY_PATTERN.test(value)
}

export function isBuiltinMcpClient(value: unknown): value is BuiltinMcpClient {
  return typeof value === 'string' && (BUILTIN_MCP_CLIENTS as readonly string[]).includes(value)
}

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

function signingKeyPath(name: string): string {
  const normalized = String(name || '').trim()
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(normalized)) throw new Error('Capability signing key name is invalid')
  return path.join(capabilityCoreDir(), KEY_DIR, `${normalized}.key`)
}

function invalidSigningKey(): never {
  throw new Error('Capability signing key has invalid length')
}

/**
 * App-owned HMAC material for durable authorities. This is deliberately a
 * different file from the bearer token: a local client proof must not also be
 * able to mint project leases or approval receipts.
 */
export function ensureCapabilitySigningKey(name: string): Buffer {
  const filePath = signingKeyPath(name)
  try {
    const existing = fs.readFileSync(filePath)
    if (existing.length !== 32) invalidSigningKey()
    return existing
  } catch (error) {
    if (error instanceof Error && error.message.includes('invalid length')) throw error
  }
  const dir = path.dirname(filePath)
  ensureDir(dir)
  const key = crypto.randomBytes(32)
  let fd: number
  try {
    fd = fs.openSync(filePath, 'wx', 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      const raced = fs.readFileSync(filePath)
      if (raced.length !== 32) invalidSigningKey()
      return raced
    }
    throw error
  }
  try {
    fs.writeSync(fd, key)
    try { fsyncIfDurable(fd) } catch { /* best effort on filesystems without fsync */ }
  } finally {
    fs.closeSync(fd)
  }
  try { fs.chmodSync(filePath, 0o600) } catch { /* Windows has no POSIX mode */ }
  return key
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
  return isValidMcpClientKey(value) ? value : null
}

/**
 * A scoped capability written by Nomi into one client's MCP config. It proves that Nomi installed
 * that client entry without exposing the capability-core bearer token itself.
 */
export function signMcpClient(client: AuthenticatedMcpClient): string | null {
  if (!isValidMcpClientKey(client)) return null
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
