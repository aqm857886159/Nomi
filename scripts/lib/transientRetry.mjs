// 脚本调 GitHub / Cloudflare 控制面的「网络瞬断重试」唯一边界（2026-10-10，#1155 合入后 main 上 Quality Gate 因
// ci-annotation-hygiene 的一次 `fetch failed` 判红，合并线被卡约一小时）。
//
// 只重试**瞬断**：连接重置 / 超时 / DNS 抖动 / 5xx / gh、git 的网络错误。
// 4xx、权限错误、数据形状不对一律立刻失败——重试只会把真问题藏起来。
// 只给**只读**调用：fetchWithRetry 只认 GET / HEAD；execGhReadSync 只认 gh 的只读子命令。
// 会写、会花钱的调用（POST、gh pr create / merge / issue create 等）结构上进不来，重试一次可能就是写两次。
//
// 有限次数 + 退避；最后一次失败的错误信息写明「重试 N 次后仍失败」。
import { execFileSync } from 'node:child_process'

export const DEFAULT_ATTEMPTS = 3
export const DEFAULT_BASE_DELAY_MS = 1000

const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'EPIPE', 'ENETUNREACH', 'ENETDOWN', 'EHOSTUNREACH',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
])
// 这些原因下的 `fetch failed` 不是瞬断：域名不存在、网址本身写错。
const PERMANENT_CODES = new Set(['ENOTFOUND', 'ERR_INVALID_URL', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE'])
const TRANSIENT_TEXT = new RegExp([
  'fetch failed', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'socket hang up', 'connection reset', 'network is unreachable',
  'TLS handshake timeout', 'temporary failure in name resolution',
  'error connecting to api\\.github\\.com', 'dial tcp .*(timeout|reset|refused)',
  'HTTP 5\\d\\d', 'could not resolve host', 'RPC failed', 'the remote end hung up unexpectedly', 'early EOF',
  'unable to access .*(timed out|reset|could not resolve)',
].join('|'), 'iu')

function text(value) {
  if (value == null) return ''
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value)
}

/** 超时：execFileSync 的 timeout 杀进程（ETIMEDOUT + 信号）、git-delivery 的 transport_timeout、fetch 的 AbortSignal.timeout（TimeoutError）。 */
export function isTimeoutError(error) {
  if (!error || typeof error !== 'object') return false
  return error.code === 'transport_timeout' || error.name === 'TimeoutError' || (error.code === 'ETIMEDOUT' && Boolean(error.killed || error.signal))
}

/**
 * 抛出来的这个错误是不是网络瞬断。无法识别的一律当「不是」——宁可立刻失败，也不重试掩盖。
 * 超时默认**不算**：卡死的 TLS 连接对只读调用是最典型的瞬断，由只读调用方显式 retryTimeouts: true 打开
 * （fetchWithRetry / execGhReadSync / 只读的 retryTransient 包装）；写调用超时后到底成没成功不确定，永远只试一次。
 * 被别的原因杀掉的子进程（有信号、不是超时）也不重试。
 */
export function isTransientError(error, { retryTimeouts = false } = {}) {
  if (!error || typeof error !== 'object') return false
  if (isTimeoutError(error)) return retryTimeouts
  if (error.killed || error.signal) return false
  const status = error.status ?? error.httpStatus
  if (typeof status === 'number' && status >= 400 && status < 500) return false
  if (typeof status === 'number' && status >= 500) return true
  const codes = [error.code, error.cause?.code, error.cause?.cause?.code].filter(Boolean)
  if (codes.some((code) => PERMANENT_CODES.has(code))) return false
  if (codes.some((code) => TRANSIENT_CODES.has(code))) return true
  const details = error.details && typeof error.details === 'object' ? error.details : {}
  const haystack = [error.message, error.cause?.message, text(error.stderr), text(details.stderr)].join('\n')
  return TRANSIENT_TEXT.test(haystack)
}

function annotateExhausted(error, attempts, timeoutMs) {
  const perAttempt = timeoutMs ?? error.details?.timeoutMs
  const note = isTimeoutError(error)
    ? `（每次超时 ${perAttempt ?? '未知'} 毫秒，共尝试 ${attempts} 次，重试 ${attempts - 1} 次后仍失败）`
    : `（重试 ${attempts - 1} 次后仍失败，共尝试 ${attempts} 次）`
  try {
    error.message = `${error.message}${note}`
    error.retryAttempts = attempts
  } catch { /* 冻结的错误对象：保持原样抛出 */ }
  return error
}

function backoffMs(baseDelayMs, attempt) {
  return baseDelayMs * 2 ** (attempt - 1)
}

/**
 * 异步重试。fn 抛出瞬断错误才重试；非瞬断立刻原样抛出；次数用完抛出最后那个错误（message 末尾写明重试了几次）。
 * sleep 可注入（测试不等真时间）。
 */
export async function retryTransient(fn, {
  attempts = DEFAULT_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  retryTimeouts = false,
  timeoutMs,
  isTransient = (error) => isTransientError(error, { retryTimeouts }),
  onRetry = () => {},
} = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt)
    } catch (error) {
      if (!isTransient(error)) throw error
      if (attempt >= attempts) throw annotateExhausted(error, attempts, timeoutMs)
      onRetry({ attempt, error })
      await sleep(backoffMs(baseDelayMs, attempt))
    }
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** 同步版（给 execFileSync 的调用点）。语义同 retryTransient。 */
export function retryTransientSync(fn, {
  attempts = DEFAULT_ATTEMPTS,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  sleep = sleepSync,
  retryTimeouts = false,
  timeoutMs,
  isTransient = (error) => isTransientError(error, { retryTimeouts }),
  onRetry = () => {},
} = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return fn(attempt)
    } catch (error) {
      if (!isTransient(error)) throw error
      if (attempt >= attempts) throw annotateExhausted(error, attempts, timeoutMs)
      onRetry({ attempt, error })
      sleep(backoffMs(baseDelayMs, attempt))
    }
  }
}

/**
 * 带重试的 fetch：只认 GET / HEAD。网络层抛错和 5xx 重试；2xx / 3xx / 4xx 原样返回给调用方自己判。
 * 5xx 用完次数后抛错（message 含状态码与重试次数）。
 */
export async function fetchWithRetry(url, init = {}, { fetchImpl = globalThis.fetch, ...retryOptions } = {}) {
  const method = String(init.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error(`fetchWithRetry 只给只读请求（GET / HEAD），收到 ${method}：重试可能把写操作做两次`)
  }
  return retryTransient(async () => {
    const response = await fetchImpl(url, init)
    if (response.status >= 500) {
      const error = new Error(`HTTP ${response.status}: ${url}`)
      error.httpStatus = response.status
      throw error
    }
    return response
  }, { retryTimeouts: true, ...retryOptions })
}

const GH_READ_SUBCOMMANDS = new Set(['pr view', 'pr list', 'pr diff', 'pr checks', 'run view', 'run list', 'run download', 'issue view', 'issue list', 'release view', 'release list', 'api'])

/** gh 参数是不是只读。不是只读 = 抛错，调用方不该把它交给重试助手。 */
export function assertGhReadOnly(args) {
  const key = args[0] === 'api' ? 'api' : `${args[0]} ${args[1]}`
  if (!GH_READ_SUBCOMMANDS.has(key)) throw new Error(`execGhReadSync 只给 gh 的只读命令，收到：gh ${args.slice(0, 2).join(' ')}`)
  if (args[0] !== 'api') return
  const methodArg = args.findIndex((arg) => arg === '--method' || arg === '-X')
  const inline = args.find((arg) => /^--method=/iu.test(arg))
  const method = String(methodArg >= 0 ? args[methodArg + 1] : inline ? inline.split('=')[1] : 'GET').toUpperCase()
  if (method !== 'GET') throw new Error(`execGhReadSync 只给 GET，收到 gh api --method ${method}`)
  const isGraphql = args[1] === 'graphql'
  if (!isGraphql && args.some((arg) => arg === '-f' || arg === '-F' || arg === '--field' || arg === '--raw-field' || arg === '--input')) {
    throw new Error('execGhReadSync：gh api 带 -f / -F / --input 会隐式变成 POST')
  }
  if (isGraphql && args.some((arg) => /\bmutation\b/u.test(arg))) throw new Error('execGhReadSync：graphql mutation 不是只读')
}

/**
 * 带重试的 `gh` 只读调用（同步）。stdio 默认 [ignore, pipe, pipe]：stderr 必须能被读到，才分得出网络错误和权限错误。
 * bin 只给测试换成假的子进程。
 */
export function execGhReadSync(args, { bin = 'gh', ...execOptions } = {}, retryOptions = {}) {
  if (bin === 'gh') assertGhReadOnly(args)
  return retryTransientSync(
    () => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...execOptions }),
    { retryTimeouts: true, timeoutMs: execOptions.timeout, ...retryOptions },
  )
}

/**
 * `gh` 的**写**调用（建 / 改 issue、评论、发布……）：只试一次、不重试——重试可能把写操作做两次。
 * 存在的理由是让 scripts/ 里所有 gh 调用都从本模块过（check:network-entry 的判据），读写要在调用点显式二选一。
 */
export function execGhWriteSync(args, execOptions = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...execOptions })
}
