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
// 纯 stdio + JSON-RPC，不引 MCP SDK（server 侧本就是手写协议，见 mcpProtocol.ts）。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  MCP_CONFIG_VERSION,
  MCP_CONFIG_KIND_ENV,
  MCP_CONFIG_VERSION_ENV,
  configuredMcpEntry,
  listCustomMcpProfiles,
  mcpServerEntry,
  type McpClientKey,
} from './mcpConfig'
import { MCP_CLIENT_ENV, MCP_CLIENT_PROOF_ENV, verifyMcpClient } from './security'

/** 失败原因（UI 文案按它走 i18n，不从主进程回中文——R15）。 */
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
  /** 握手往返耗时（毫秒），失败为 null。UI 拿它显示「已接入 · 0.5s」当证据。 */
  latencyMs: number | null
  toolCount: number | null
  /** 配置里那条命令 ≠ 现在应该写的那条 → 陈旧配置，「重新接入」能直接治好。 */
  stale: boolean
  /** 原始错误（截断），只进日志/排查，不直接展示给用户。 */
  detail: string
}

const HANDSHAKE_TIMEOUT_MS = 15_000
const PROBE_PROTOCOL_VERSION = '2025-06-18'

function fail(reason: McpVerifyReason, stale: boolean, detail = ''): McpVerifyResult {
  return { ok: false, reason, latencyMs: null, toolCount: null, stale, detail: detail.slice(0, 400) }
}

/**
 * 真起一次配置里那条 MCP server 并握手。**只读、无副作用**：不写任何配置，子进程握完即杀。
 * 用户点开接入面板就跑（打包版实测 ~0.5s），失败时 UI 直接给「配置已失效 · 重新接入」。
 */
export async function verifyMcp(client?: string): Promise<McpVerifyResult> {
  const key: McpClientKey = client && (client === 'codex' || client === 'cursor' || listCustomMcpProfiles().some((p) => p.key === client))
    ? client
    : 'claude'
  const entry = configuredMcpEntry(key)
  if (!entry) return fail('not-installed', false)

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

  // 命令文件都不在就别 spawn 了：ENOENT 的报错对用户没信息量，这一步能直接说清「指向的程序没了」。
  // 但**只对看起来像路径的 command 这么判**：配置里也可能是裸命令名（node / npx / uvx…，靠 PATH 解析），
  // 对它 existsSync 恒 false → 会把每一份走 PATH 的配置都误报成「程序不在了」。
  // （真机走查实测抓到：用户的 Claude Code 配置正是 command:"node"，被误判成失效——单测全用绝对路径，
  //  五门全绿也照样放过去了。）裸命令名交给 spawn 去试，真找不到会走 error→spawn-failed。
  return await new Promise<McpVerifyResult>((resolve) => {
    const started = Date.now()
    let settled = false
    let stdout = ''
    let stderr = ''
    let child: ReturnType<typeof spawn>

    const done = (result: McpVerifyResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child?.kill()
      } catch {
        // 子进程可能已自行退出，杀不到无所谓。
      }
      resolve(result)
    }
    const timer = setTimeout(() => done(fail('timeout', stale, stderr)), HANDSHAKE_TIMEOUT_MS)

    try {
      child = spawn(entry.command, entry.args, {
        env: { ...process.env, ...(entry.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      done(fail('spawn-failed', stale, error instanceof Error ? error.message : String(error)))
      return
    }

    const send = (message: unknown): void => {
      try {
        child.stdin?.write(`${JSON.stringify(message)}\n`)
      } catch {
        done(fail('spawn-failed', stale, stderr))
      }
    }

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    // send() 的 try/catch 只接得住同步抛错。小包写平时走同步快路（对端刚死也静默成功），但并行
    // 负载下写入会落进 libuv 异步队列——完成时子进程若已被收尸，EPIPE 在 stdin 流上**异步**
    // emit 'error'：没挂监听就升级成进程级 unhandled（真机=主进程 uncaughtException；CI=测试
    // 全过仍 exit 1，2026-08-25 现场，复现钉在 mcpVerify.stdinError.test.ts）。真实故障由下面
    // 'error'（spawn-failed）/'exit'（handshake-failed）如实上报，这里只消掉流级回声、不改判定。
    child.stdin?.on('error', () => { /* 见上：判定权在 child 的 error/exit */ })
    child.on('error', (error) => done(fail('spawn-failed', stale, error.message)))
    // 没握完手就退出 = 起不来（老配置指向的脚本报错、二进制被系统拦掉等）。
    child.on('exit', (code, signal) => done(fail('handshake-failed', stale, `exit=${code} signal=${signal} ${stderr}`)))

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let message: { id?: unknown; result?: Record<string, unknown>; error?: { message?: string } }
        try {
          message = JSON.parse(line)
        } catch {
          continue // server 可能往 stdout 漏非 JSON 噪声，跳过而不是判失败。
        }
        if (message.error) {
          done(fail('handshake-failed', stale, message.error.message || ''))
          return
        }
        if (message.id === 1) {
          if (!message.result?.serverInfo) {
            done(fail('handshake-failed', stale, JSON.stringify(message.result).slice(0, 200)))
            return
          }
          send({ jsonrpc: '2.0', method: 'notifications/initialized' })
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
        } else if (message.id === 2) {
          const tools = message.result?.tools
          done({
            ok: true,
            reason: 'ok',
            latencyMs: Date.now() - started,
            toolCount: Array.isArray(tools) ? tools.length : null,
            stale,
            detail: '',
          })
          return
        }
      }
    })

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: PROBE_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'nomi-verify', version: '1.0' } },
    })
  })
}

export type { McpClientKey }
