// 能力核 · 「已接入」到底通不通 —— 真起一次配置里那条命令，走完 initialize + tools/list 握手。
//
// 为什么必须真跑：此前「已接入」只判「配置文件里有没有 nomi 这行字」（jsonInstalled/codexInstalled），
// 命令还在不在、跑不跑得起来、协议对不对一概不问。于是三类「绿灯但实际断了」长期查不出来：
//   ① 老版本写的 `node <repo>/scripts/nomi-mcp.mjs` —— 该脚本已随 5a40acbc 从仓库删除；
//   ② 从 dev 构建点的接入，args 钉在一条随时会被删的 git worktree 上；
//   ③ 用户手改/迁移目录后命令失效。
// 三者在 UI 上都长成「已接入」，用户在助手里发消息却石沉大海。故验证只认**读回来的那条命令**
// （configuredMcpEntry），不认「我们现在会写什么」。
//
// 与 mcpVerifyHttp.ts 共用官方 @modelcontextprotocol/client（Client + StdioClientTransport），按需加载不进冷启动路径。
import { MCP_VERIFY_PROBE_NAME } from './mcpHttpEndpoint'
import fs from 'node:fs'
import path from 'node:path'
import {
  MCP_CONFIG_VERSION,
  MCP_CONFIG_KIND_ENV,
  MCP_CONFIG_VERSION_ENV,
  configuredMcpEntry,
  listCustomMcpProfiles,
  mcpServerEntry,
  sameProfile,
  type McpClientKey,
} from './mcpConfig'
import { MCP_CLIENT_ENV, MCP_CLIENT_PROOF_ENV, isBuiltinMcpClient, verifyMcpClient } from './security'
import { configuredMcpHttpEntry, forwarderTarget, isOwnedForwarderEntry } from './mcpHostEntries'
import { verifyHttpEntry } from './mcpVerifyHttp'
import type { McpVerifyReason } from '../shared/mcpConnectionContract'

/** 失败原因：中立契约层 electron/shared/mcpConnectionContract.ts 的唯一 owner，这里只 derive。 */
export type { McpVerifyReason }

export type McpVerifyResult = {
  ok: boolean
  reason: McpVerifyReason
  /** 握手往返耗时（毫秒），失败为 null。UI 拿它显示「已接入 · 0.5s」当证据。 */
  latencyMs: number | null
  toolCount: number | null
  /** 配置里那条命令 ≠ 现在应该写的那条 → 陈旧配置，「重新接入」能直接治好。 */
  stale: boolean
  /** 原始错误（截断），只进日志/排查，不直接展示给用户。 */
  detail: string
}

const HANDSHAKE_TIMEOUT_MS = 15_000

const SPAWN_ERRNO_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'E2BIG'])

function fail(reason: McpVerifyReason, stale: boolean, detail = ''): McpVerifyResult {
  return { ok: false, reason, latencyMs: null, toolCount: null, stale, detail: detail.slice(0, 400) }
}

function buildSpawnEnv(entryEnv?: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...process.env, ...(entryEnv || {}) })) {
    if (value !== undefined) merged[key] = value
  }
  return merged
}

function isSpawnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as NodeJS.ErrnoException
  if (typeof err.syscall === 'string' && err.syscall.startsWith('spawn')) return true
  return typeof err.code === 'string' && SPAWN_ERRNO_CODES.has(err.code)
}

/**
 * 真起一次配置里那条 MCP server 并握手。**只读、无副作用**：不写任何配置，子进程握完即杀。
 * 用户点开接入面板就跑（打包版实测 ~0.5s），失败时 UI 直接给「配置已失效 · 重新接入」。
 */
export async function verifyMcp(client?: string, options?: { timeoutMs?: number }): Promise<McpVerifyResult> {
  // 不传 = Claude Code（老 preload 默认）；传了但不认识 = 没这个客户端，如实报 not-installed，
  // 不回落成 claude（回落会验错对象：看起来「没接入」，其实验的是别人）。内置名单读注册表。
  const key: McpClientKey | null = client === undefined || client === ''
    ? 'claude'
    : (isBuiltinMcpClient(client) || listCustomMcpProfiles().some((p) => p.key === client)) ? client : null
  if (!key) return fail('not-installed', false)
  const entry = configuredMcpEntry(key)
  // 迁移后的转发口（Claude Desktop）：它只是 stdio→HTTP 的桥，验证握的是它要连的那个本机地址、带它配置里的身份。
  const forwarder = entry !== null && isOwnedForwarderEntry(key, entry)
  const bridged = forwarder ? forwarderTarget(entry) : null
  if (forwarder) {
    if (!bridged) return fail('client-auth-missing', true)
    const outcome = await verifyHttpEntry(key, bridged)
    return outcome.ok
      ? { ok: true, reason: 'ok', latencyMs: outcome.latencyMs, toolCount: outcome.toolCount, stale: false, detail: '' }
      : fail(outcome.reason, false, outcome.detail)
  }
  if (!entry) {
    // 迁移后的 HTTP 条目：同样只认读回来的那一条，真握手一次（不 spawn，直连本机地址）。
    const http = configuredMcpHttpEntry(key)
    if (!http) return fail('not-installed', false)
    const outcome = await verifyHttpEntry(key, http)
    return outcome.ok
      ? { ok: true, reason: 'ok', latencyMs: outcome.latencyMs, toolCount: outcome.toolCount, stale: false, detail: '' }
      : fail(outcome.reason, false, outcome.detail)
  }

  const expected = mcpServerEntry(key)
  const stale = entry.command !== expected.command || JSON.stringify(entry.args) !== JSON.stringify(expected.args)

  // Check the real historical shape before auth: `command:"node"` exists, while args[0] is the
  // deleted Nomi script. Reporting only "auth missing" hides the actionable root cause.
  const executableName = path.basename(entry.command).toLowerCase()
  const scriptArg = ['node', 'node.exe', 'bun', 'bun.exe'].includes(executableName)
    ? entry.args.find((arg) => !arg.startsWith('-') && /\.(?:mjs|cjs|js)$/i.test(arg))
    : undefined
  const developmentArg = entry.env?.[MCP_CONFIG_KIND_ENV] === 'development'
    ? entry.args.find((arg) => path.isAbsolute(arg) || arg.startsWith('.'))
    : undefined
  const missingArg = [scriptArg, developmentArg].find((arg): arg is string => Boolean(arg && !fs.existsSync(arg)))
  if (missingArg) return fail('argument-missing', true, missingArg)

  // Path-like commands can be diagnosed before authentication. Bare command names stay delegated
  // to PATH resolution in spawn, otherwise every valid `node`/`npx` entry would look absent.
  const looksLikePath = entry.command.includes(path.sep) || entry.command.startsWith('.')
  if (looksLikePath && !fs.existsSync(entry.command)) return fail('command-missing', stale, entry.command)

  const clientIdentityValid = verifyMcpClient(
    entry.env?.[MCP_CLIENT_ENV],
    entry.env?.[MCP_CLIENT_PROOF_ENV],
  ) === key && entry.env?.[MCP_CONFIG_VERSION_ENV] === MCP_CONFIG_VERSION
  // Current Nomi launcher + no signed capability is an old configuration that can list tools but
  // remains untrusted for a budgeted Production Run. Reconnect upgrades that configuration.
  if (!clientIdentityValid) return fail('client-auth-missing', true)

  // 配置里的 NOMI_SETTINGS_DIR 指向别的（或已删除的）profile：命令照样能起、握手照样能过——起的却是一个
  // 空白 Nomi。这是「真·假绿」，必须在 spawn 之前按读回来的值判死：那条配置里装的不是**这一个** Nomi
  // （not-installed），且重新接入能治好（stale）。UI 对 launcher-stale 形状不再 spawn，按 configState 直说。
  if (!sameProfile(entry, expected)) return fail('not-installed', true, `NOMI_SETTINGS_DIR=${entry.env?.NOMI_SETTINGS_DIR ?? ''}`)

  // 命令文件都不在就别 spawn 了：ENOENT 的报错对用户没信息量，这一步能直接说清「指向的程序没了」。
  // 但**只对看起来像路径的 command 这么判**：配置里也可能是裸命令名（node / npx / uvx…，靠 PATH 解析），
  // 对它 existsSync 恒 false → 会把每一份走 PATH 的配置都误报成「程序不在了」。
  // （真机走查实测抓到：用户的 Claude Code 配置正是 command:"node"，被误判成失效——单测全用绝对路径，
  //  五门全绿也照样放过去了。）裸命令名交给 StdioClientTransport 去试，真找不到会走 ENOENT → spawn-failed。
  const timeoutMs = options?.timeoutMs ?? HANDSHAKE_TIMEOUT_MS
  const started = Date.now()
  let stderr = ''
  const [{ Client, SdkError, SdkErrorCode }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/client'),
    import('@modelcontextprotocol/client/stdio'),
  ])
  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args,
    env: buildSpawnEnv(entry.env),
    stderr: 'pipe',
  })
  transport.stderr?.on('data', (chunk: Buffer | string) => {
    if (stderr.length < 1024) stderr += String(chunk)
  })
  const probe = new Client({ name: MCP_VERIFY_PROBE_NAME, version: '1.0' })
  // StdioClientTransport 把 stdin 异步 EPIPE 与 stdout 非 JSON 噪声经 onerror 转交客户端；
  // 这里静默接住防止升级为未捕获异常，真实握手故障由 connect / listTools 抛出并分类（见 mcpVerify.stdinError.test.ts）。
  probe.onerror = () => {}
  try {
    await probe.connect(transport, { timeout: timeoutMs })
    const remainingMs = Math.max(1, timeoutMs - (Date.now() - started))
    const tools = await probe.listTools(undefined, { timeout: remainingMs })
    return {
      ok: true,
      reason: 'ok',
      latencyMs: Date.now() - started,
      toolCount: Array.isArray(tools.tools) ? tools.tools.length : null,
      stale,
      detail: '',
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) {
      return fail('timeout', stale, stderr || message)
    }
    if (isSpawnError(error)) {
      return fail('spawn-failed', stale, message)
    }
    return fail('handshake-failed', stale, stderr ? `${message} ${stderr}`.trim() : message)
  } finally {
    try { await probe.close() } catch { /* 子进程可能已自行退出，关不掉不影响结论 */ }
  }
}

export type { McpClientKey }
