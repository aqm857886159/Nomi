// 走查专用的主进程网络闸：只放行本机（loopback / file / data / nomi-local），其余一律拦下并记账。
//
// 为什么要它：走查要证明「零供应商调用」，而 App 启动时自己就会出门——catalogReconcile 会对每个
// 有钥匙、有文本模型的供应商做一次健康探测（vendorHealth.startCatalogReconciliation）。夹具里的钥匙
// 是占位串，探测本身免费，但「免费」不等于「没有调用」。所以不靠推理，而是在进程入口把门关上：
// 本文件由启动器的 mainRequire 作为 `-r` 放在 App 入口之前加载，在 App 代码加载之前把门换掉，
// 并把每一次被拦下的尝试写进 NOMI_WALK_NET_LOG，走查结束时逐条列出。
//
// 门有四层（后两层是全功能走查补的，同一个闸，不另起一份）：
//   · globalThis.fetch 与 http(s).request / get：App 自己的 HTTP 都从这里出（appFetch 在模块加载时绑定 globalThis.fetch），
//     在这一层拦，记下的调用栈里就有「是谁发的」；
//   · net.Socket#connect：绕过上面两层的客户端（直接用 undici / tls / ws 的 SDK）最终都走它，目标不是本机就拒；
//   · Chromium（每个 session 的 webRequest.onBeforeRequest）：渲染层与 Electron net 模块的请求不经过 Node，只能在这里拦。
//     产品代码没有注册 onBeforeRequest（一个 session 只认最后一个监听），不会互相覆盖。
// 记账格式：`{ kind: 'guard-loaded', layers }` 一行，之后每次拦下一行 `{ kind: 'blocked', via, url, host, stack? }`；
// 装某一层失败记 `{ kind: 'guard-error', layer, message }`。读的一方要求哪几层必须在，自己看 layers。
//
// 只给走查用：它从不进产品构建（只有走查脚本经 launchNomiApp({ mainRequire }) 把它挂上）。
'use strict'
const fs = require('node:fs')
const net = require('node:net')
const { scrubText: scrubUrlText } = module.require('./walkthrough-url-shape.cjs')
const { allowsHostPort, allowsUrl, parseAllowlist } = require('../electron/shared/walkAllowlist.cjs')

const LOG = process.env.NOMI_WALK_NET_LOG || ''

function note(entry) {
  if (!LOG) return
  try {
    fs.appendFileSync(LOG, `${JSON.stringify({ ...entry, pid: process.pid, at: new Date().toISOString() })}\n`)
  } catch {
    // 记账失败不能影响被测 App；走查末尾会因为缺 guard-loaded 记录而判「未证明零调用」。
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1'])

function isLocalHost(host) {
  if (host === undefined || host === null || host === '') return true // net.connect(port) = localhost
  const value = String(host).trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  return LOCAL_HOSTS.has(value) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
}

/**
 * 付费真跑走查专用：NOMI_WALK_ALLOW_ORIGINS = 逗号分隔的放行名单，只放行被授权的那几家供应商
 * （tests/ux/_paidRun 类走查要真的出门；其余公网照旧一律拦）。没设 = 一家都不放，老走查一个字不变。
 * 写法与端口语义见 walkthrough-allowlist.cjs（四层共用同一个判定；CI 下名单恒空）。
 * 名单由 tests/ux/_paidRun.mjs 按授权的供应商自动算出，走查作者不手配。
 */
const ALLOWLIST = parseAllowlist(process.env.NOMI_WALK_ALLOW_ORIGINS, { ci: Boolean(process.env.CI) })

function isLocal(rawUrl) {
  let url
  try {
    url = new URL(String(rawUrl))
  } catch {
    return true
  }
  if (['file:', 'data:', 'blob:', 'nomi-local:'].includes(url.protocol)) return true
  if (allowsUrl(ALLOWLIST, url)) return true
  return isLocalHost(url.hostname)
}

/**
 * 走查把「公网上的静态文件」换成本机缓存（只给 Chromium 这一层用）：NOMI_WALK_URL_REDIRECTS = [{ from, to }]，
 * 请求地址以 from 开头就改投 to（必须是本机地址）。例：抠图模型镜像——App 照常请求镜像地址（产品代码一行不改），
 * 这里把它转给剧本起在 127.0.0.1 上的缓存，公网照样零出站；每一次改投都记一笔 redirected。
 */
const REDIRECTS = (() => {
  try {
    const parsed = JSON.parse(process.env.NOMI_WALK_URL_REDIRECTS || '[]')
    return Array.isArray(parsed) ? parsed.filter((rule) => rule && typeof rule.from === 'string' && typeof rule.to === 'string' && isLocal(rule.to)) : []
  } catch {
    return []
  }
})()

function redirectOf(rawUrl) {
  const value = String(rawUrl)
  const rule = REDIRECTS.find((entry) => value.startsWith(entry.from))
  return rule ? rule.to + value.slice(rule.from.length) : null
}

function hostOf(rawUrl) {
  try {
    return new URL(String(rawUrl)).hostname
  } catch {
    return ''
  }
}

/** 记账只留 origin + path：query 里可能有别的东西，走查报告不需要它。 */
function redact(rawUrl) {
  try {
    const url = new URL(String(rawUrl))
    return `${url.origin}${url.pathname}`
  } catch {
    return String(rawUrl).slice(0, 200)
  }
}

/** 是谁发的：拦下那一刻的调用栈（去掉本文件自己的帧）。挑 App 自己的哪几帧由读的一方决定。 */
function callerStack() {
  return String(new Error().stack || '').split('\n').slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.includes(__filename))
    .slice(0, 12)
    .join(' | ')
}

/**
 * 付费走查要核「App 真正发给供应商的是什么」（2026-10-22 参考图错发热修的真付费样本）：设 NOMI_WALK_NET_BODIES=1，
 * fetch 层对**放行名单上的公网请求**（本机回环不记）把请求体记一笔 `allowed-request`，multipart 上传的响应文本也记一笔
 * `allowed-response`（托管中转回的公网地址，用来把请求体里的地址对回本地文件名）。只记账、不改请求。
 * 先脱敏再落盘：不记请求头（key 在头里）；正文里形如 Bearer / sk- 的串打码；URL 的查询串（签名参数）整段换成 `?<redacted>`。
 * 没设 = 一个字不记，别的走查行为不变。
 */
const RECORD_BODIES = process.env.NOMI_WALK_NET_BODIES === '1'
const BODY_LIMIT = 64 * 1024
let recordSeq = 0

function describeBody(body) {
  if (body === undefined || body === null) return null
  if (typeof body === 'string') {
    const scrubbed = scrubUrlText(body)
    return { text: scrubbed.slice(0, BODY_LIMIT), truncated: scrubbed.length > BODY_LIMIT }
  }
  if (typeof FormData === 'function' && body instanceof FormData) {
    const form = []
    for (const [field, value] of body.entries()) {
      const scrubbed = typeof value === 'string' ? scrubUrlText(value) : null
      form.push(typeof value === 'string'
        ? { field, value: scrubbed.slice(0, 200) }
        : { field, fileName: value && value.name ? String(value.name) : null, size: value && value.size, type: value && value.type })
    }
    return { form }
  }
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return { bytes: body.byteLength }
  return { type: Object.prototype.toString.call(body) }
}

function recordAllowed(target, init, responsePromise) {
  if (!RECORD_BODIES || !/^https?:/i.test(String(target)) || isLocalHost(hostOf(target))) return responsePromise
  recordSeq += 1
  const seq = recordSeq
  const body = describeBody(init && init.body)
  note({ kind: 'allowed-request', via: 'fetch', seq, method: String((init && init.method) || 'GET').toUpperCase(), url: redact(target), host: hostOf(target), body })
  if (!body || !body.form) return responsePromise
  return responsePromise.then((response) => {
    try {
      response.clone().text().then((text) => {
        const scrubbed = scrubUrlText(text)
        note({ kind: 'allowed-response', via: 'fetch', seq, status: response.status, text: scrubbed.slice(0, 4096) })
      }, () => {})
    } catch {
      // 读不了响应不影响被测 App。
    }
    return response
  })
}

/**
 * 走查要让「请求已经写出去、回执还没回来」这个窗口真实出现，并且真付费和零费演练走同一段（夹具里压着只有演练有）：
 * NOMI_WALK_HOLD_RESPONSE = { method, pathSuffix, releaseFile }，命中的请求照常发出、供应商照常收到，只是回执压在这里，
 * 直到 releaseFile 出现才交给 App。不改请求、不丢回执、不多发；每压一次记一笔 response-held。没设 = 一个字不变。
 */
const HOLD_RESPONSE = (() => {
  try {
    const parsed = JSON.parse(process.env.NOMI_WALK_HOLD_RESPONSE || 'null')
    return parsed && parsed.method && parsed.pathSuffix && parsed.releaseFile ? parsed : null
  } catch {
    return null
  }
})()

function holdResponse(target, init, responsePromise) {
  if (!HOLD_RESPONSE || String((init && init.method) || 'GET').toUpperCase() !== HOLD_RESPONSE.method) return responsePromise
  let pathname
  try {
    pathname = new URL(String(target)).pathname
  } catch {
    return responsePromise
  }
  if (!pathname.endsWith(HOLD_RESPONSE.pathSuffix) || fs.existsSync(HOLD_RESPONSE.releaseFile)) return responsePromise
  note({ kind: 'response-held', via: 'fetch', url: redact(target), host: hostOf(target) })
  return responsePromise.then((response) => new Promise((resolve) => {
    const waitForRelease = () => {
      if (fs.existsSync(HOLD_RESPONSE.releaseFile)) resolve(response)
      else setTimeout(waitForRelease, 50)
    }
    waitForRelease()
  }))
}

const layers = []

const realFetch = globalThis.fetch
if (typeof realFetch === 'function') {
  globalThis.fetch = function walkthroughGuardedFetch(input, init) {
    const target = typeof input === 'string' ? input : (input && input.url) || String(input)
    if (!isLocal(target)) {
      note({ kind: 'blocked', via: 'fetch', url: redact(target), host: hostOf(target), stack: callerStack() })
      // 形状照真实 undici 拒连：外壳 `fetch failed`，cause 是 connect 阶段的 ECONNREFUSED。闸确实在连上之前就拦了，
      // 所以 App 的出站证据（electron/outboundDispatchEvidence.ts）该读到的就是「没写出去」——以前这里只抛一个
      // 不带 cause 的 TypeError，真实网络里不存在这种形状，App 只能按「结果未知」处理（V-1042 第 22 张截图）。
      const host = hostOf(target)
      const cause = Object.assign(
        new Error(`connect ECONNREFUSED ${host} (blocked by walkthrough network guard)`),
        { code: 'ECONNREFUSED', syscall: 'connect', address: host, port: 0 },
      )
      return Promise.reject(Object.assign(new TypeError('fetch failed (blocked by walkthrough network guard)'), { cause }))
    }
    return holdResponse(target, init, recordAllowed(target, init, realFetch.call(this, input, init)))
  }
  layers.push('fetch')
}

/** options 形式的 http(s).request：主机 + 端口（端口单给时拼上，别丢——名单按端口判）。 */
function requestAuthority(options) {
  const host = (options && (options.hostname || options.host)) || 'localhost'
  return options && options.port && !/:\d+$/.test(String(host)) && !String(host).includes(']:') ? `${host}:${options.port}` : host
}

for (const moduleName of ['http', 'https']) {
  const mod = require(moduleName)
  for (const fn of ['request', 'get']) {
    const original = mod[fn]
    mod[fn] = function walkthroughGuardedRequest(...args) {
      const first = args[0]
      const target = typeof first === 'string'
        ? first
        : first instanceof URL
          ? first.href
          : `${moduleName}://${requestAuthority(first)}${(first && first.path) || '/'}`
      if (!isLocal(target)) {
        note({ kind: 'blocked', via: `${moduleName}.${fn}`, url: redact(target), host: hostOf(target), stack: callerStack() })
        throw new Error('network request blocked by walkthrough network guard')
      }
      return original.apply(this, args)
    }
  }
  layers.push(moduleName)
}

function describeConnectArgs(args) {
  let options = args[0]
  // net.connect() 先规范化成 [options, callback] 再交给 socket.connect。
  if (Array.isArray(options)) options = options[0]
  if (options && typeof options === 'object') return { host: options.host, port: options.port, path: options.path }
  if (typeof options === 'string' && Number.isNaN(Number(options))) return { path: options }
  return { port: options, host: typeof args[1] === 'string' ? args[1] : undefined }
}

const originalConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function walkthroughGuardedConnect(...args) {
  const target = describeConnectArgs(args)
  if (target.path || isLocalHost(target.host) || allowsHostPort(ALLOWLIST, target.host, target.port)) return originalConnect.apply(this, args)
  note({ kind: 'blocked', via: 'socket', url: `tcp://${target.host}:${target.port ?? ''}`, host: String(target.host), stack: callerStack() })
  const error = Object.assign(
    new Error(`connect ECONNREFUSED ${target.host}:${target.port} (blocked by walkthrough network guard)`),
    { code: 'ECONNREFUSED', syscall: 'connect', address: String(target.host), port: Number(target.port) || 0 },
  )
  process.nextTick(() => this.destroy(error))
  return this
}
layers.push('socket')

// Chromium：只有 Electron 主进程里有 app / session。
let electronApp = null
try {
  electronApp = require('electron').app ?? null
} catch {
  electronApp = null
}
if (electronApp && typeof electronApp.on === 'function') {
  const guarded = new WeakSet()
  electronApp.on('session-created', (session) => {
    if (!session || guarded.has(session)) return
    guarded.add(session)
    try {
      session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
        if (isLocal(details.url)) {
          callback({})
          return
        }
        const redirectURL = redirectOf(details.url)
        if (redirectURL) {
          note({ kind: 'redirected', via: 'chromium', url: redact(details.url), to: redact(redirectURL), host: hostOf(details.url) })
          callback({ redirectURL })
          return
        }
        note({ kind: 'blocked', via: 'chromium', url: redact(details.url), host: hostOf(details.url), method: details.method, resourceType: details.resourceType })
        callback({ cancel: true })
      })
    } catch (error) {
      note({ kind: 'guard-error', layer: 'chromium', message: String(error && error.message) })
    }
  })
  layers.push('chromium')
}

note({ kind: 'guard-loaded', processType: process.type || 'node', layers })
