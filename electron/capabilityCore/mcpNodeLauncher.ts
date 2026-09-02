// MCP stdio entry that runs under Electron's bundled Node runtime. It never creates an
// NSApplication: an existing Nomi is reached over loopback RPC, and a missing Nomi is started once.
//
// **库指纹握手**（2026-08-18 §P3-F）：发现实例后不再「谁写了就连谁」。读广告（instanceAdvert 校验）后按 verdict
// 分诊：库匹配 + 活 + 心跳新鲜 → 连（happy path）；库不匹配/心跳陈旧/旧版 v1 → **快速失败**（≤10s，给人话，绝不
// 静默串到别人的库）；进程死/没广告 → 冷启（唯一还走满 60s 的路）。这台机器上真有并发会话依赖 ~/.nomi 里的活
// 广告，本模块的隔离与快速失败就是为了杜绝 2026-08-17 那次「我的项目连进走查库」。
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

import { createMcpProtocol, MCP_REQUEST_SIGNAL, type McpInvokeOptions } from './mcpProtocol'
import { recordDetectedMcpClient } from './mcpDetectedClients'
import { MAX_MCP_LINE_BYTES, parseMcpStdioLine } from './mcpStdioLine'
// 直接吃纯 locale 模块，不经 i18n.ts——后者顶层 `import { app } from 'electron'`，本 launcher 打包后跑在
// 无 electron 的裸 Node 里，引 i18n 会 MODULE_NOT_FOUND。这条 electron-free 由 mcpLauncherClosure.test.ts 钉死。
import { normalizeDesktopLocale, type DesktopLocale } from '../desktopLocale'
import {
  instanceAdvertFileName,
  parseAdvert,
  validateAdvert,
  type AdvertVerdict,
  type InstanceAdvertisement,
} from './instanceAdvert'
import {
  createMcpConnectionContext,
  type McpConnectionContext,
} from './mcpConnectionContext'
import { rpcErrorFromPayload } from './mcpRpcError'
import { createMcpLoopbackRpcRequest } from './mcpLoopbackRpcRequest'

const CAPABILITY_DIR_ENV = 'NOMI_CAPABILITY_DIR'
const PROJECTS_DIR_ENV = 'NOMI_PROJECTS_DIR'
const SETTINGS_DIR_ENV = 'NOMI_SETTINGS_DIR'
const CLIENT_ENV = 'NOMI_MCP_CLIENT'
const CLIENT_PROOF_ENV = 'NOMI_MCP_CLIENT_PROOF'
const APP_COMMAND_ENV = 'NOMI_MCP_APP_COMMAND'
const APP_ARGS_ENV = 'NOMI_MCP_APP_ARGS'
const BOOT_TIMEOUT_MS = 60_000
// 快速失败预算（§P3-F 承诺）：库不匹配/陈旧/旧版这类「已知连不上」必须在此预算内报人话，绝不拖到 60s 盲等。
// 实现上在**冷启前**同步命中即抛（毫秒级 ≪ 预算），远快于它；此常量既是文档也是并发用例断言的上界。
export const FAST_FAIL_BUDGET_MS = 10_000

function rpcTimeoutMs(): number {
  const configured = Number(process.env.NOMI_RPC_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0 ? configured : 360_000
}

function capabilityDir(): string {
  return String(process.env[CAPABILITY_DIR_ENV] || '').trim()
    || path.join(os.homedir(), '.nomi', 'capability-core')
}

/**
 * 这个 launcher 期望连的项目库根，尽 bare-Node 所能与 runtimePaths.getProjectLocationState 同序推导：
 *   · NOMI_PROJECTS_DIR（环境覆盖）→ 确切期望库，返回 { root, isDefault:false }，读命名空间文件、做库全等校验；
 *   · 否则 NOMI_SETTINGS_DIR 下 project-location.json 的自定义根（若该 env 在）→ 同上；
 *   · 都没有 → 默认库：bare-Node 算不出 documents 下的默认绝对路径，返回 { root:null, isDefault:true }，读默认
 *     instance.json，靠命名空间隔离（只有 default-source app 会写它）兜底，跳过库全等。
 * 返回 root=null 表示「默认库、无法算出确切绝对路径」（交给 validateAdvert 的 null 语义）。
 */
function expectedLibrary(): { root: string | null; isDefault: boolean } {
  const envRoot = String(process.env[PROJECTS_DIR_ENV] || '').trim()
  if (envRoot) return { root: envRoot, isDefault: false }
  const settingsDir = String(process.env[SETTINGS_DIR_ENV] || '').trim()
  if (settingsDir) {
    try {
      const stored = JSON.parse(fs.readFileSync(path.join(settingsDir, 'project-location.json'), 'utf8')) as {
        projectsRoot?: unknown
      }
      const custom = typeof stored.projectsRoot === 'string' ? stored.projectsRoot.trim() : ''
      if (custom) return { root: custom, isDefault: false }
    } catch {
      /* 无自定义根设置 → 落默认 */
    }
  }
  return { root: null, isDefault: true }
}

/** 期望库对应的广告文件绝对路径（默认库 → instance.json；自定义库 → instance-<hash>.json）。 */
function advertPath(library: { root: string | null; isDefault: boolean }): string {
  return path.join(capabilityDir(), instanceAdvertFileName(library.root ?? '', library.isDefault))
}

/** 读并校验广告 → verdict（happy path=match）。文件缺失/坏 → malformed。 */
function readAdvertVerdict(library: { root: string | null; isDefault: boolean }): AdvertVerdict {
  let raw: string
  try {
    raw = fs.readFileSync(advertPath(library), 'utf8')
  } catch {
    return { kind: 'malformed' }
  }
  let parsed: Partial<InstanceAdvertisement> | null
  try {
    parsed = parseAdvert(JSON.parse(raw))
  } catch {
    return { kind: 'malformed' }
  }
  return validateAdvert(parsed, library.root)
}

/** happy-path 探测：仅当 verdict=match 时返回可连实例，否则 null（分诊/快速失败交给 ensureLiveInstance）。 */
function readLiveInstance(): InstanceAdvertisement | null {
  const verdict = readAdvertVerdict(expectedLibrary())
  return verdict.kind === 'match' ? verdict.instance : null
}

/**
 * 把「连不上」的 verdict 翻成给人看的中文错误（bare-Node，无 Electron app.getLocale()；launcher 现有错误就是纯
 * 中文串，保持一致——locale plumbing 见 resolveLauncherLocale，此处快速失败文案缺省 zh-CN）。mismatch 同时点名
 * 两个库（连到的 vs 你要的）+ 两条出路。返回 null = 该 verdict 不是「连不上」（match/dead/malformed 不在此列）。
 */
function fastFailMessage(verdict: AdvertVerdict, expectedRoot: string | null): string | null {
  switch (verdict.kind) {
    case 'mismatch':
      return [
        'Nomi 连到的不是你的项目库。',
        `这个 Nomi 实例服务的库：${verdict.instance.projectsRoot}`,
        `你这个客户端要用的库：${expectedRoot ?? '（默认库）'}`,
        '两条出路：① 重启 Nomi（让它挂回你的库）；② 关掉正占用它的另一个会话/走查窗口，再重试。',
      ].join('\n')
    case 'stale':
      return [
        'Nomi 实例失联了（进程还在但已停止心跳，可能卡死或挂起）。',
        '请重启 Nomi 后重试。',
      ].join('\n')
    case 'legacy':
      return 'Nomi 实例信息是旧版格式，重启 Nomi 后重试。'
    default:
      return null
  }
}

function appArgs(): string[] {
  try {
    const value = JSON.parse(String(process.env[APP_ARGS_ENV] || '[]'))
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

let bootedApp: ChildProcess | null = null
let bootFailure = ''
let bootExitDetail = ''

function startNomi(): void {
  if (bootedApp && bootedApp.exitCode === null && bootedApp.signalCode === null) return
  const command = String(process.env[APP_COMMAND_ENV] || '').trim()
  if (!command) throw new Error('Nomi MCP launcher is missing its app command. Reconnect this client in Nomi settings.')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NOMI_MCP_STDIO
  delete env[APP_COMMAND_ENV]
  delete env[APP_ARGS_ENV]
  delete env[CLIENT_ENV]
  delete env[CLIENT_PROOF_ENV]
  bootFailure = ''
  bootExitDetail = ''
  bootedApp = spawn(command, appArgs(), { env, stdio: 'ignore' })
  bootedApp.on('error', (error) => {
    bootFailure = error.message
  })
  bootedApp.on('exit', (code, signal) => {
    // Another MCP helper may have won Nomi's single-instance race. Its sibling exits normally
    // before the winning process advertises RPC, so keep polling instead of failing this client.
    bootExitDetail = `Nomi launcher exited before MCP was ready (code=${code} signal=${signal})`
  })
}

// 结果/进度文案 locale：bare-Node launcher 没有 Electron 的 app.getLocale()，改读**同一份 OS locale**——
// Intl.DateTimeFormat().resolvedOptions().locale 就是 Electron app.getLocale() 底下那个系统区域信号（同源、非
// 凭空发明的通道），经 normalizeDesktopLocale 归成 en / zh-CN，取不到/异常时缺省 zh-CN。provider 可注入（单测）。
export function resolveLauncherLocale(readSystemLocale: () => string = () => Intl.DateTimeFormat().resolvedOptions().locale): DesktopLocale {
  try {
    return normalizeDesktopLocale(readSystemLocale())
  } catch {
    return 'zh-CN'
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 找到可连实例，或按 verdict 快速失败/冷启：
 *   · match → 直接连。
 *   · mismatch / stale / legacy → 立刻抛人话（同步命中，远快于 FAST_FAIL_MS），绝不盲等、绝不串库。
 *   · dead / malformed → 没有活实例，走冷启（spawn + 满 BOOT_TIMEOUT_MS 轮询）；轮询期间若冒出 mismatch/stale/
 *     legacy（并发会话抢注）也即时快速失败。
 */
async function ensureLiveInstance(signal?: AbortSignal): Promise<InstanceAdvertisement> {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('MCP request cancelled')
  const library = expectedLibrary()
  const initial = readAdvertVerdict(library)
  if (initial.kind === 'match') return initial.instance
  const initialFastFail = fastFailMessage(initial, library.root)
  if (initialFastFail) throw new Error(initialFastFail)

  // 到这里只剩 dead/malformed = 确实没活实例 → 冷启。这是唯一还会走满 60s 的路（真正的冷启动）。
  startNomi()
  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('MCP request cancelled')
    const verdict = readAdvertVerdict(library)
    if (verdict.kind === 'match') return verdict.instance
    const fastFail = fastFailMessage(verdict, library.root)
    if (fastFail) throw new Error(fastFail) // 并发会话在冷启途中抢注了别的库/陈旧广告 → 立即人话失败
    if (bootFailure) throw new Error(bootFailure)
    await delay(200)
  }
  // 冷启超时：区分「兄弟进程输掉单实例竞争正常退出」（code=0，honest 保留）与纯冷启超时。
  throw new Error(
    `Nomi 冷启动 60 秒内未就绪。请先手动打开一次 Nomi，再重试该 MCP 操作。${bootExitDetail ? ` ${bootExitDetail}` : ''}`,
  )
}

async function callViaRpc(
  instance: InstanceAdvertisement,
  method: string,
  params: Record<string, unknown>,
  options?: McpInvokeOptions,
): Promise<unknown> {
  const connection = launcherConnection()
  const proof = String(process.env[CLIENT_PROOF_ENV] || '').trim()
  const timeoutMs = rpcTimeoutMs()
  const controller = new AbortController()
  const relayAbort = () => controller.abort(options?.signal?.reason)
  if (options?.signal?.aborted) relayAbort()
  else options?.signal?.addEventListener('abort', relayAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${instance.port}/rpc`, {
      ...createMcpLoopbackRpcRequest({
        token: instance.token,
        clientProof: proof,
        connection,
        method,
        params,
        planConfirmed: options?.planConfirmed,
        spendConfirmed: options?.spendConfirmed,
        signal: controller.signal,
      }),
    })
  } catch (error) {
    if (options?.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new Error('MCP request cancelled')
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Nomi did not respond within ${Math.round(timeoutMs / 1000)} seconds. The task may still be running; check Nomi before retrying.`, { cause: error })
    }
    throw error
  } finally {
    clearTimeout(timer)
    options?.signal?.removeEventListener('abort', relayAbort)
  }
  const body = await response.json() as { ok?: boolean; error?: unknown; result?: unknown }
  if (!body.ok) throw rpcErrorFromPayload(body, response.status)
  return body.result
}

// OS locale 解析一次（进程生命周期内 UI 语言不变，同 mcpStdioServer 的 setDesktopLocale(app.getLocale())）。
const launcherLocale = resolveLauncherLocale()
let connection: McpConnectionContext | null = null
// Mint lazily but at most once for this stdio transport. Lazy construction
// keeps pure helper imports side-effect free; the first real RPC still fails
// closed when the installed client proof is absent or invalid.
function launcherConnection(): McpConnectionContext {
  connection ??= createMcpConnectionContext({
    client: process.env[CLIENT_ENV],
    proof: process.env[CLIENT_PROOF_ENV],
  })
  return connection
}

const protocol = createMcpProtocol({
  send: (message) => process.stdout.write(`${JSON.stringify(message)}\n`),
  invoke: async (method, params, options) => {
    const requestSignal = (params as Record<PropertyKey, unknown>)[MCP_REQUEST_SIGNAL] as AbortSignal | undefined
    return callViaRpc(await ensureLiveInstance(requestSignal), method, params, requestSignal ? { ...options, signal: requestSignal } : options)
  },
  isAppOpen: () => Boolean(readLiveInstance()),
  getAuthenticatedClient: () => launcherConnection().authenticatedClient,
  getLocale: () => launcherLocale,
  onClientDetected: (name) => {
    recordDetectedMcpClient(name)
  },
})

const input = readline.createInterface({ input: process.stdin })
input.on('line', (line) => {
  const parsed = parseMcpStdioLine(line)
  if (parsed.kind === 'blank') return
  if (parsed.kind === 'oversized') {
    process.stderr.write(`[nomi-mcp] dropped an oversized stdin line (> ${MAX_MCP_LINE_BYTES} bytes)\n`)
    return
  }
  if (parsed.kind === 'parse-error') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`)
    return
  }
  protocol.handleIncoming(parsed.value as Parameters<typeof protocol.handleIncoming>[0])
})

let closing = false
function close(): void {
  if (closing) return
  closing = true
  protocol.cancelAllInFlight('stdio disconnected')
  if (process.env.NOMI_MCP_EXIT_BOOTSTRAPPED_APP === '1' && bootedApp?.pid) {
    try { bootedApp.kill('SIGTERM') } catch { /* best effort test cleanup */ }
  }
  process.exit(0)
}

input.on('close', close)
process.stdin.on('end', close)
