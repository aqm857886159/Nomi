// 走查专用的主进程网络模拟（只给 APIMart 线路走查用，从不进产品构建）。
//
// 为什么要它：要在本机复现「主域被墙、国内线路能通」，还要证明「生成请求真的发往用户填的新地址」，
// 而且一分钱不花、一个真 key 不用。所以在进程入口（launchNomiApp 的 mainRequire，`-r`）换掉主进程的
// globalThis.fetch（appFetch 在模块加载时绑定它）与 http(s).request：
//   · NOMI_NETSIM_BLOCKED 里的主机：像被墙一样连接超时（UND_ERR_CONNECT_TIMEOUT，请求从未离开本机）；
//   · NOMI_NETSIM_MOCK 里的主机：由本文件里一个 APIMart 形状的假服务应答（验 key / 提交 / 轮询 / 取图）；
//   · 其余主机：按 DNS 查不到处理（ENOTFOUND）——等价于用户把域名写错；
//   · 回环 / file / data 照常放行。
// 每一次出站尝试都记进 NOMI_NETSIM_LOG（JSONL：方法 + origin + path + 是否带了密钥），走查据此核对目标主机。
// 只记「带没带」，从不记密钥本身。
//
// NOMI_NETSIM_RECORD_ONLY=1：只记账、不拦截——真实付费走查（scripts/apimart-domestic-line-paid.mjs）用它核对
// 真请求发去了哪台主机：请求原样交给真的 fetch（带着 App 自己的代理 dispatcher），http(s)/DNS 一概不碰；
// 另外只从任务查询的应答里摘状态、结果图的主机和带 cost/credit/price 字样的字段（应答里本来就没有密钥）。
'use strict'
const fs = require('node:fs')
const dns = require('node:dns')
const net = require('node:net')

const LOG = process.env.NOMI_NETSIM_LOG || ''
const RECORD_ONLY = process.env.NOMI_NETSIM_RECORD_ONLY === '1'
const hosts = (value, fallback) => String(value ?? fallback).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
const BLOCKED = hosts(process.env.NOMI_NETSIM_BLOCKED, 'api.apimart.ai')
const MOCKED = hosts(process.env.NOMI_NETSIM_MOCK, 'api.apib.ai,apib.ai')
const PUBLIC_ADDRESS = '104.18.32.7'
const IMAGE = RECORD_ONLY ? null : fs.readFileSync(process.env.NOMI_NETSIM_IMAGE)

function note(entry) {
  if (!LOG) return
  try { fs.appendFileSync(LOG, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`) } catch { /* 记账失败不能拖垮被测 App */ }
}

function isLocal(url) {
  if (['file:', 'data:', 'blob:', 'nomi-local:'].includes(url.protocol)) return true
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
}

function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

// 连接体检拉的模型清单：照真实 APIMart 的应答回（2026-09-29 真实调用实测，主域与国内线路一样）——
// `/models` 回 404，`/v1/models` 带合法 key 回 200 + 清单。体检只拿文本模型对账，所以清单里放齐 APIMart 的几款对话模型。
const LISTED_MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v3.2', 'deepseek-v3.1-terminus', 'gemini-3.5-flash', 'MiniMax-H3-Context-IR', 'gpt-image-2', 'z-image-turbo']

// ── 脚本化的 Agent 大脑（NOMI_NETSIM_AGENT=1）──────────────────────────────────────────
// 不花钱、不接真模型：国内线路上的 /v1/chat/completions 由这里按对话进度照剧本回。
// 用户消息带 WALK_AGENT → 调 draft_shots（APIMart 的 GPT Image 2）；拿到草稿的 operationId → 调 generate；
// 生成那一步有了结果 → 一句收尾。其余请求（起标题之类）一律回一句短话。
// 进度只看**最后一条用户消息之后**的那一段：同一段对话里再说一次，就是新的一轮（工具调用 id 也按轮区分）。
const AGENT_ON = process.env.NOMI_NETSIM_AGENT === '1'

function messageText(message) {
  if (typeof message?.content === 'string') return message.content
  return (Array.isArray(message?.content) ? message.content : []).map((part) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
}

function agentReply(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const lastUserAt = messages.map((message) => message?.role).lastIndexOf('user')
  const turn = messages.slice(lastUserAt + 1)
  const DRAFT_CALL = `walk-draft-${lastUserAt}`
  const GENERATE_CALL = `walk-generate-${lastUserAt}`
  const toolResult = (id) => turn.find((message) => message?.role === 'tool' && message.tool_call_id === id)
  const generated = toolResult(GENERATE_CALL)
  if (generated) return { kind: 'text', text: 'WALK_AGENT_DONE', detail: messageText(generated).slice(0, 400) }
  const drafted = toolResult(DRAFT_CALL)
  if (drafted) {
    const operationId = /"operationId":"([^"]+)"/.exec(messageText(drafted))?.[1]
    if (!operationId) return { kind: 'text', text: 'WALK_AGENT_DRAFT_FAILED', detail: messageText(drafted).slice(0, 400) }
    return { kind: 'tool', id: GENERATE_CALL, name: 'generate', args: { operationId } }
  }
  if (lastUserAt >= 0 && messageText(messages[lastUserAt]).includes('WALK_AGENT')) {
    return { kind: 'tool', id: DRAFT_CALL, name: 'draft_shots', args: { shots: [{
      prompt: '一只橘猫坐在窗台上，水彩风格', taskKind: 'text_to_image',
      model: 'gpt-image-2@apimart', parameters: { aspect_ratio: '1:1' },
    }] } }
  }
  return { kind: 'text', text: '好的。' }
}

function chatCompletion(body) {
  const reply = agentReply(body)
  note({ kind: 'agent-brain', reply: reply.kind === 'tool' ? reply.name : reply.text, detail: reply.detail })
  const id = `chatcmpl-walk-${Date.now()}`
  const model = String(body?.model || 'walk')
  const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
  const toolCall = reply.kind === 'tool'
    ? { id: reply.id, type: 'function', function: { name: reply.name, arguments: JSON.stringify(reply.args) } }
    : null
  if (body?.stream !== true) {
    return json(200, {
      id, object: 'chat.completion', created: 1, model,
      choices: [{ index: 0, message: { role: 'assistant', content: reply.kind === 'text' ? reply.text : '', ...(toolCall ? { tool_calls: [toolCall] } : {}) }, finish_reason: toolCall ? 'tool_calls' : 'stop' }],
      usage,
    })
  }
  const frame = (delta, finish = null, withUsage = false) => `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created: 1, model,
    choices: withUsage ? [] : [{ index: 0, delta, finish_reason: finish }], ...(withUsage ? { usage } : {}),
  })}\n\n`
  let wire = frame({ role: 'assistant', content: '' })
  wire += toolCall ? frame({ tool_calls: [{ index: 0, ...toolCall }] }) : frame({ content: reply.text })
  wire += frame({}, toolCall ? 'tool_calls' : 'stop') + frame({}, null, true) + 'data: [DONE]\n\n'
  return new Response(wire, { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}

let taskCounter = 0
/** APIMart 形状的假服务：只认本走查会走到的那几条路由。 */
function apimartMock(method, url, carriesKey, body) {
  const route = url.pathname
  if (!carriesKey) return json(401, { error: { message: 'invalid API key', type: 'apimart_error' } })
  if (method === 'GET' && route === '/models') return json(404, { error: { message: 'not found', type: 'apimart_error' } })
  if (method === 'GET' && route === '/v1/models') {
    return json(200, { object: 'list', data: LISTED_MODELS.map((id) => ({ id, object: 'model', owned_by: 'apimart' })) })
  }
  if (AGENT_ON && method === 'POST' && route === '/v1/chat/completions') return chatCompletion(body)
  if (method === 'GET' && route === '/v1/balance') return json(200, { remain_balance: 88.8, used_balance: 1.2 })
  if (method === 'POST' && route === '/v1/images/generations') {
    taskCounter += 1
    return json(200, { code: 200, data: [{ status: 'submitted', task_id: `task_netsim_${taskCounter}` }] })
  }
  const task = route.match(/^\/v1\/tasks\/([^/]+)$/)
  if (method === 'GET' && task) {
    return json(200, { code: 200, data: { id: task[1], status: 'completed', progress: 100, result: { images: [{ url: [`${url.origin}/netsim-assets/${task[1]}.png`] }] } } })
  }
  return json(404, { error: { message: `netsim has no route for ${method} ${route}`, type: 'apimart_error' } })
}

function connectTimeout(host) {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(`Connect Timeout Error (attempted address: ${host}:443)`), { code: 'UND_ERR_CONNECT_TIMEOUT' }) })
}
function nameNotFound(host) {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND', hostname: host }) })
}

const realFetch = globalThis.fetch

/** 真实应答里值得记的那几样：任务状态、结果图的主机、带 cost/credit/price 字样的字段。别的一概不留。 */
function summarizeReply(value) {
  const found = {}
  const visit = (node, trail) => {
    if (!node || typeof node !== 'object' || trail.length > 6) return
    for (const [key, child] of Object.entries(node)) {
      const at = [...trail, key].join('.')
      if (/cost|credit|price|quota|consum/i.test(key) && (typeof child === 'number' || typeof child === 'string')) found[at] = child
      if (key === 'status' && typeof child === 'string') found[at] = child
      if (key === 'url') {
        for (const item of [].concat(child)) { try { found[`${at}.host`] = new URL(String(item)).host } catch { /* 不是地址就不记 */ } }
      }
      visit(child, [...trail, key])
    }
  }
  visit(value, [])
  return found
}

/** 只记账：请求原样交给真的 fetch（init 里带着 App 自己的代理 dispatcher），应答原样交回。 */
async function recordOnly(input, init, url, method, carriesKey) {
  const where = `${url.origin}${url.pathname}`
  const startedAt = Date.now()
  try {
    const response = await realFetch.call(globalThis, input, init)
    const entry = { kind: 'real', method, url: where, credential: carriesKey, status: response.status, ms: Date.now() - startedAt }
    if (/\/v1\/(tasks\/|images\/generations$)/.test(url.pathname)) {
      try { entry.reply = summarizeReply(await response.clone().json()) } catch { /* 不是 JSON 就不摘 */ }
    }
    note(entry)
    return response
  } catch (error) {
    note({ kind: 'real-failed', method, url: where, credential: carriesKey, error: String(error?.cause?.code || error?.message || error).slice(0, 200) })
    throw error
  }
}

globalThis.fetch = async function netsimFetch(input, init) {
  const isRequest = typeof Request !== 'undefined' && input instanceof Request
  let url
  try { url = new URL(isRequest ? input.url : String(input)) } catch { return realFetch.call(this, input, init) }
  if (isLocal(url)) return realFetch.call(this, input, init)
  const method = String((init && init.method) || (isRequest ? input.method : 'GET')).toUpperCase()
  const headers = new Headers((init && init.headers) || (isRequest ? input.headers : undefined))
  const carriesKey = headers.has('authorization') || headers.has('x-api-key')
  if (RECORD_ONLY) return recordOnly(input, init, url, method, carriesKey)
  const host = url.hostname.toLowerCase()
  const where = `${url.origin}${url.pathname}`
  if (BLOCKED.includes(host)) {
    note({ kind: 'blocked', method, url: where, credential: carriesKey })
    await new Promise((resolve) => setTimeout(resolve, 150))
    throw connectTimeout(host)
  }
  if (MOCKED.includes(host)) {
    note({ kind: 'served', method, url: where, credential: carriesKey })
    if (method === 'GET' && url.pathname.startsWith('/netsim-assets/')) {
      return new Response(IMAGE, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(IMAGE.length) } })
    }
    let body
    const rawBody = isRequest ? await input.clone().text() : init && init.body
    if (typeof rawBody === 'string') { try { body = JSON.parse(rawBody) } catch { body = undefined } }
    return apimartMock(method, url, carriesKey, body)
  }
  note({ kind: 'not-found', method, url: where, credential: carriesKey })
  throw nameNotFound(host)
}

// 只记账的那一档不碰 http(s) 与 DNS：真实走查要的是 App 原样的网络行为。
if (!RECORD_ONLY) {
  for (const moduleName of ['http', 'https']) {
    const mod = require(moduleName)
    for (const fn of ['request', 'get']) {
      const original = mod[fn]
      mod[fn] = function netsimNodeRequest(...args) {
        const first = args[0]
        const target = typeof first === 'string'
          ? first
          : first instanceof URL ? first.href : `${moduleName}://${(first && (first.hostname || first.host)) || 'localhost'}${(first && first.path) || '/'}`
        let url
        try { url = new URL(target) } catch { return original.apply(this, args) }
        if (!isLocal(url)) {
          note({ kind: 'refused-node-http', via: `${moduleName}.${fn}`, url: `${url.origin}${url.pathname}` })
          throw new Error('network request refused by the walkthrough network simulator')
        }
        return original.apply(this, args)
      }
    }
  }

  // DNS 也钉死：假服务的主机解析成一个公网地址，其余一律 NXDOMAIN（出站策略的合成解析器探测看到的是正常解析器）。
  const originalLookup = dns.promises.lookup
  dns.promises.lookup = async function netsimLookup(hostname, options) {
    const host = String(hostname || '').toLowerCase()
    if (net.isIP(host)) return originalLookup.call(this, hostname, options)
    const found = MOCKED.includes(host) ? [{ address: PUBLIC_ADDRESS, family: 4 }] : host === 'localhost' ? [{ address: '127.0.0.1', family: 4 }] : null
    if (!found) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', hostname })
    return typeof options === 'object' && options && options.all ? found : found[0]
  }
}
note({ kind: 'netsim-loaded', mode: RECORD_ONLY ? 'record-only' : 'simulate', blocked: RECORD_ONLY ? [] : BLOCKED, mocked: RECORD_ONLY ? [] : MOCKED })
