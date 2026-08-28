// 能力核 · 传输客户端（CLI 与 MCP server 共用，单一真相源 P1）。
// 纯 node：探测运行中的 Nomi（~/.nomi/capability-core/instance.json，pid 存活）→ 走 RPC（A 模式）；
// 没开 → spawn 无窗口 Electron host（B 模式）。鉴权：每次带 ~/.nomi/capability-core/token。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { unwrapNomiTransportResponse } from './nomiTransportError.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// 传输层兜底超时（堵无界阻塞：即便主进程/host 某处 hang 死，外部 agent 也等够即拿到错误，不永久转圈）。
// 必须 ≥ 服务端最长合法耗时（core.ts 视频轮询 300s）才不误杀真生成；默认 360s，可经 env 调。
function transportTimeoutMs() {
  const raw = Number(process.env.NOMI_RPC_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 360_000
}

export function capabilityCoreDir() {
  const configured = String(process.env.NOMI_CAPABILITY_DIR || '').trim()
  return configured || path.join(os.homedir(), '.nomi', 'capability-core')
}

export function readToken() {
  try {
    return fs.readFileSync(path.join(capabilityCoreDir(), 'token'), 'utf8').trim()
  } catch {
    return ''
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

export function readLiveInstance() {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(capabilityCoreDir(), 'instance.json'), 'utf8'))
  } catch {
    return null
  }
  if (!parsed || typeof parsed.pid !== 'number' || typeof parsed.port !== 'number') return null
  if (!isAlive(parsed.pid)) return null
  return parsed
}

async function callViaRpc(instance, token, method, params) {
  const timeoutMs = transportTimeoutMs()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(`http://127.0.0.1:${instance.port}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ method, params }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`Nomi 无响应（${Math.round(timeoutMs / 1000)}s 超时）——生成可能仍在后台跑，或主进程卡住；可稍后用 nomi_read_canvas 查结果。`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
  const body = await res.json()
  return unwrapNomiTransportResponse(body, `RPC ${res.status}`)
}

/** Pure headless stdout decoder, exported so the CLI transport contract is testable without Electron. */
export function parseHeadlessHostResponse(stdout, stderr = '') {
  let body
  try {
    const match = stdout.trim().match(/\{[\s\S]*\}$/)
    body = JSON.parse(match ? match[0] : stdout)
  } catch {
    throw new Error(`host 无有效响应。stdout=${stdout.slice(0, 400)} stderr=${stderr.slice(0, 400)}`)
  }
  return unwrapNomiTransportResponse(body, 'host 失败')
}

function callViaHost(token, method, params, spawnEnv) {
  return new Promise((resolve, reject) => {
    let electronBinary
    try {
      electronBinary = require('electron')
    } catch {
      reject(new Error('找不到 electron 可执行文件（dev 用；打包版 CLI 走应用内置 Electron，后续切片）'))
      return
    }
    const hostScript = path.join(repoRoot, 'dist-electron', 'capabilityCore', 'host.js')
    if (!fs.existsSync(hostScript)) {
      reject(new Error(`headless host 未构建：${hostScript}（先 pnpm run build:electron）`))
      return
    }
    // 把主 app 身份（package.json name）传给 host：dev spawn 的 electron 默认叫 "Electron"，safeStorage
    // 解不开主 app 加密的 vendor key（身份不符）。host 收 NOMI_APP_NAME 后 setName 对齐 + 默认 userData 指向真数据。
    let appName = ''
    try {
      appName = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).name || ''
    } catch {
      /* 读不到就不传，host 用继承身份 */
    }
    const child = spawn(electronBinary, [hostScript, '--cmd', JSON.stringify({ token, method, params })], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // spawnEnv：调用方按本次调用注入的环境（如付费确认通过后传 NOMI_LOOP_SPEND_OK=1 给本次 host），
      // per-call 注入避免改 process.env 全局态在并发调用间串台。
      env: { ...process.env, ...(process.env.NOMI_APP_NAME || appName ? { NOMI_APP_NAME: process.env.NOMI_APP_NAME || appName } : {}), ...(spawnEnv || {}) },
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    // 兜底超时：host 若 hang 死（vendor 卡住等）就 kill 它并报错，不让外部 agent 永久等子进程。
    const timeoutMs = transportTimeoutMs()
    const killTimer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill('SIGKILL')
      } catch {
        /* 已退出 */
      }
      reject(new Error(`Nomi headless 进程无响应（${Math.round(timeoutMs / 1000)}s 超时），已终止。`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      reject(error)
    })
    child.on('exit', () => {
      if (settled) return
      settled = true
      clearTimeout(killTimer)
      try { resolve(parseHeadlessHostResponse(stdout, stderr)) }
      catch (error) { reject(error) }
    })
  })
}

/**
 * 调一次能力核方法：app 开着→RPC，关着→headless host。无 token 抛清晰错误。
 * options.spawnEnv：仅 B 模式（host）生效，按本次调用注入环境（如付费确认通过后授权本次生成）。
 */
export async function invoke(method, params, options = {}) {
  const token = readToken()
  if (!token) throw new Error('未找到 token（先启动一次 Nomi 生成 token，路径 ~/.nomi/capability-core/token）')
  const instance = readLiveInstance()
  if (instance) return callViaRpc(instance, token, method, params)
  return callViaHost(token, method, params, options.spawnEnv)
}
