// 付费走查的出网名单与「被挡即失败」，唯一一份（2026-10-09）。
//
// 为什么存在：走查网络闸（scripts/walkthrough-network-guard.cjs）默认只放本机，付费走查要真的出门，
// 以前靠跑的人手设 NOMI_WALK_ALLOW_ORIGINS——没人设就静默挂：Agent 面板 4 次「连不上服务商」，干等 600 多秒才超时。
// 现在名单由 openPaidWalk 按**本场授权的供应商**自动算出来传给闸，调用方什么都不做；
// 万一仍有请求被挡，账本（NOMI_WALK_NET_LOG 的 blocked 行）一出现就让走查当场失败，说出被挡的 host 和哪一层拦的。
//
// 名单两部分：
//   · 供应商自己的 API 地址——从隔离副本要装进去的那份真实目录里读（vendor.baseUrlHint + 映射里写死的绝对地址），不手抄第二份；
//   · 结果下载域名——供应商把成品放在另一个域名上，目录里没有，只能这里放一张「供应商 → 域名」小表（只放域名）。
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'

// 判定函数与走查闸四层共用同一份（electron/shared/walkAllowlist.cjs），诊断不再自己写一套匹配。
const { listsHost, parseAllowlist } = createRequire(import.meta.url)('../../electron/shared/walkAllowlist.cjs')
// 请求体脱敏与闸同一份（不记请求头；Key 形状的串、签名查询串打码）。
const { scrubText: scrubUrlText } = createRequire(import.meta.url)('../../scripts/walkthrough-url-shape.cjs')

/** 供应商 key → 它的成品下载域名。写法同闸：精确 origin，或 `*.域名`（含子域）。只放域名。 */
export const VENDOR_RESULT_DOMAINS = Object.freeze({
  apimart: ['*.getapib.org'],
  kie: ['https://tempfile.aiquickdraw.com'],
})

function originsIn(text) {
  const origins = []
  for (const match of String(text).matchAll(/https?:\/\/[^"\s\,]+/g)) {
    try { origins.push(new URL(match[0]).origin) } catch { /* not a URL */ }
  }
  return origins
}

/**
 * 纯函数：真实目录 + 授权的供应商 → 放行名单（去重、有序）。
 * 授权的供应商在目录里找不到、或读不出任何 API 地址，直接抛——静默漏配正是要消灭的事。
 */
export function paidWalkAllowlist(catalog, vendorKeys) {
  const allow = []
  for (const key of [...new Set(vendorKeys)]) {
    const vendor = (catalog.vendors ?? []).find((entry) => entry.key === key)
    if (!vendor) throw new Error(`付费走查算不出放行名单：真实目录里没有供应商 ${key}`)
    const apiOrigins = [
      ...originsIn(vendor.baseUrlHint ?? vendor.baseUrl ?? ''),
      ...originsIn(JSON.stringify((catalog.mappings ?? []).filter((mapping) => mapping.vendorKey === key))),
    ]
    if (apiOrigins.length === 0) throw new Error(`付费走查算不出放行名单：供应商 ${key} 在真实目录里没有 API 地址`)
    allow.push(...apiOrigins, ...(VENDOR_RESULT_DOMAINS[key] ?? []))
  }
  return [...new Set(allow)]
}

/**
 * 放行名单是逗号拼起来、再按逗号切开的，而 URL 解析允许主机名里带 `,` 和 `*`（`https://a.example,*.evil.test/v1`、`%2C` 同理）。
 * 所以取到的源必须恰好是**一个精确源**：scheme + 主机（字母数字 . -）+ 可选端口；没有逗号、通配符、空白、百分号编码。花钱之前就抛。
 */
export function assertExactOrigin(origin) {
  let decoded = origin
  try { decoded = decodeURIComponent(origin) } catch { /* 解不开本身就不合格，下面的正则会拒 */ }
  if (decoded !== origin || !/^https?:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/.test(origin)) {
    throw new Error(`托管上传中转源不是一个精确源（只许 scheme + 主机 + 可选端口，不许逗号 / 通配符 / 空白 / 百分号编码）：${JSON.stringify(origin)}（一分钱没花）`)
  }
  return origin
}

/**
 * 带本地参考素材（如 3D 预演 mp4）的生成，要先经应用自己的托管上传中转把素材传出去（产品里唯一出处 electron/catalog/assetRelayRuntimeConfig.ts：
 * 环境变量 NOMI_ASSET_RELAY_URL 优先，否则默认中转）。按需打开（openPaidWalk 的 hostedUploads）：返回这**一个**中转的 origin，不在脚本里写死地址。
 */
export function hostedUploadRelayOrigin(env = process.env) {
  const { readAssetRelayRuntimeConfig } = tsxRequire('../../electron/catalog/assetRelayRuntimeConfig.ts', import.meta.url)
  const saved = process.env.NOMI_ASSET_RELAY_URL
  if (env.NOMI_ASSET_RELAY_URL === undefined) delete process.env.NOMI_ASSET_RELAY_URL
  else process.env.NOMI_ASSET_RELAY_URL = env.NOMI_ASSET_RELAY_URL
  try { return assertExactOrigin(new URL(readAssetRelayRuntimeConfig().endpoint).origin) }
  finally { if (saved === undefined) delete process.env.NOMI_ASSET_RELAY_URL; else process.env.NOMI_ASSET_RELAY_URL = saved }
}

/** 账本里的被挡行 → 一句人话（host + 哪一层拦的 + 是不是授权供应商自己）。 */
export function describeBlocked(entry, allow) {
  const host = String(entry.host ?? '')
  const ownHost = listsHost(parseAllowlist(allow.join(',')), host)
  const who = ownHost ? '授权供应商的主机也被挡（端口或协议与放行名单不符，或名单与闸对不上）' : '授权供应商之外的出网'
  const layer = {
    fetch: '走查闸 · fetch 层', 'http.request': '走查闸 · http 层', 'http.get': '走查闸 · http 层',
    'https.request': '走查闸 · https 层', 'https.get': '走查闸 · https 层', socket: '走查闸 · 连接层',
    chromium: '走查闸 · Chromium 层', 'product-guard': '产品自带测试网闸（electron/testNetworkGuard.ts）',
  }[entry.via] ?? `层 ${entry.via}`
  return `${entry.url ?? host}（${layer}；${who}）`
}

export function blockedEntries(entries) {
  return entries.filter((entry) => entry?.kind === 'blocked')
}

export function readNetLog(file) {
  if (!file || !fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line) } catch { return { kind: 'unparsable' } }
  })
}

export function blockedError(entries, allow) {
  const blocked = blockedEntries(entries)
  if (blocked.length === 0) return null
  const hosts = [...new Set(blocked.map((entry) => describeBlocked(entry, allow)))]
  return new Error(`付费走查出网被挡（立即失败，没有干等）：\n  ${hosts.join('\n  ')}\n放行名单：${allow.join('、')}`)
}

/** 被挡的那一行 → 报告里记的那条请求：层、方法（闸的 fetch 层不记方法，就是 null）、主机、路径。不带查询串（签名、key 参数都在那里）。 */
export function blockedRequestOf(entry) {
  let pathname = null
  try { pathname = new URL(String(entry?.url ?? '')).pathname || null } catch { /* 读不出 URL：没有路径 */ } // 连接层是 tcp://host:port，路径是空的
  return { via: entry?.via ?? null, method: entry?.method ?? null, host: String(entry?.host ?? ''), path: pathname }
}

/** 演练档的站（由浅到深）：点生成之前就停了 / 走到 App 的上传（中转或供应商自己的上传口）/ 供应商只收到读请求 / 供应商收到会花钱的那条请求。 */
export const REHEARSAL_STATIONS = Object.freeze(['before-click', 'upload-relay', 'vendor-read', 'vendor-create'])
const STATION_RANK = Object.fromEntries(REHEARSAL_STATIONS.map((station, index) => [station, index]))
const READ_METHODS = new Set(['GET', 'HEAD'])
const isStandInRow = (entry) => entry?.via === 'rehearsal-vendor' || entry?.via === 'rehearsal-relay'
const isVendorRequestRow = (entry, vendorAllow) => entry?.kind === 'blocked' && entry?.role !== 'relay' && listsHost(vendorAllow, String(entry?.host ?? ''))
const isSpendingRow = (entry) => Boolean(entry?.method) && !READ_METHODS.has(String(entry.method).toUpperCase())

/**
 * 这一场演练走到了哪一站（纯函数）：只看收窄花钱面之后（`lockedAtEntry` 起）的账本行。
 *   vendor-create = 供应商（替身）收到了一条不是 GET / HEAD 的请求——创建、对话这类会花钱的那条；
 *   vendor-read   = 只有 GET / HEAD（查列表、查余额、探链接），或闸挡下了授权供应商的请求但不知道方法（fetch 层不记方法：宁低不高）；
 *   upload-relay  = 只走到了上传（替身答过上传，或中转的请求被挡）；
 *   before-click  = 收窄之后什么请求都没有。
 */
export function rehearsalStation(entries, { lockedAtEntry = null, vendorAllow = [], relayAllow = [] } = {}) {
  if (lockedAtEntry === null) return 'before-click'
  const vendor = parseAllowlist(vendorAllow.join(','))
  const relay = parseAllowlist(relayAllow.join(','))
  const after = entries.slice(lockedAtEntry)
  const vendorRows = after.filter((entry) => isVendorRequestRow(entry, vendor))
  if (vendorRows.some(isSpendingRow)) return 'vendor-create'
  if (vendorRows.length) return 'vendor-read'
  const uploaded = after.some((entry) => (entry?.kind === 'rehearsal-answered' && entry.answer === 'upload')
    || (entry?.kind === 'blocked' && listsHost(relay, String(entry?.host ?? ''))))
  return uploaded ? 'upload-relay' : 'before-click'
}

/** 走到的站够不够这份脚本的终点。 */
export function stationReaches(station, endsAt) {
  return (STATION_RANK[station] ?? -1) >= (STATION_RANK[endsAt] ?? Number.POSITIVE_INFINITY)
}

/**
 * 演练判据（纯函数，2026-11-15；r2 加了「走到哪一站」与上传中转）：付费走查带演练开关跑时，传给闸的放行名单是空的，
 * 供应商与中转的源改道到本机替身（不转发），一个请求都出不去；这里只回答「这一场走到了花钱前的最后一步没有」。通过要同时满足：
 *   ① 任何时候都没有挡下授权源之外的请求（`judgedAllow` = 不演练时本来会放行的供应商名单，`relayAllow` = 托管上传中转）；
 *   ② 走到了收窄花钱面（`lockedAtEntry` = 收窄完成那一刻账本有几行；没收窄过 = null）；
 *   ③ 脚本没有先于闸报错（`scriptError` 且闸还没让 App 停下——`stoppedByGuard` 为假）。要判请求体的脚本在替身记下之后
 *      自己读账本判，判据不过就是这里的 scriptError，原因原样进报告（点名哪个键）；
 *   ④ 收窄之后走到的站 ≥ 这份脚本的终点 `endsAt`（缺省 vendor-create）。
 * 收窄之前挡下的授权供应商请求照记不判。宁可错判不过，不错判通过。
 */
export function rehearsalVerdict({ entries, lockedAtEntry = null, judgedAllow = [], relayAllow = [], scriptError = null, stoppedByGuard = false, endsAt = 'vendor-create' }) {
  const said = (error) => String(error?.message ?? error).split('\n')[0].slice(0, 300)
  const shown = (request) => `${request.via} ${request.method ?? '-'} ${request.host}${request.path ?? ''}`
  const allow = parseAllowlist([...judgedAllow, ...relayAllow].join(','))
  const relay = parseAllowlist(relayAllow.join(','))
  const vendor = parseAllowlist(judgedAllow.join(','))
  const station = rehearsalStation(entries, { lockedAtEntry, vendorAllow: judgedAllow, relayAllow })
  const blocked = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry?.kind === 'blocked')
  const preLock = blocked.filter(({ index }) => lockedAtEntry === null || index < lockedAtEntry).map(({ entry }) => blockedRequestOf(entry))
  const foreign = blocked.find(({ entry }) => !listsHost(allow, String(entry.host ?? '')))
  const base = { station, endsAt, preLock }
  if (foreign) {
    const request = blockedRequestOf(foreign.entry)
    return { ...base, passed: false, request, reason: `挡下的是授权供应商之外的源 ${request.host}（${shown(request)}）` }
  }
  if (lockedAtEntry === null) {
    return { ...base, passed: false, request: null, reason: `没走到收窄花钱面${scriptError ? `——${said(scriptError)}` : ''}${preLock.length ? `（之前挡下过 ${preLock.map(shown).join('、')}）` : ''}` }
  }
  const after = blocked.filter(({ index }) => index >= lockedAtEntry)
  const shownRow = after.find(({ entry }) => isVendorRequestRow(entry, vendor) && isSpendingRow(entry))
    ?? after.find(({ entry }) => isVendorRequestRow(entry, vendor))
    ?? after.find(({ entry }) => listsHost(relay, String(entry.host ?? '')))
  const request = shownRow ? blockedRequestOf(shownRow.entry) : null
  const where = request ? `（替身记下的是 ${shown(request)}）` : ''
  if (scriptError && !stoppedByGuard) {
    return { ...base, passed: false, request, reason: station === 'before-click'
      ? `脚本在向供应商发第一条请求之前就失败——${said(scriptError)}`
      : `走到了「${station}」，但脚本自己的核对没过——${said(scriptError)}${where}` }
  }
  if (!stationReaches(station, endsAt)) {
    return { ...base, passed: false, request, reason: station === 'before-click'
      ? '脚本跑完也没有向供应商发出请求——证明不了走到了发请求这一步'
      : `只走到了「${station}」，这份脚本的终点是「${endsAt}」${where}` }
  }
  return { ...base, passed: true, request, reason: `走到了「${station}」：${shown(request)}` }
}

/**
 * 演练时什么时候让 App 停下（纯函数）：
 *   · 任何时候挡下授权源之外的请求 → 立刻停（已经能下结论：不过）；
 *   · 收窄之后闸（不是替身）挡下了请求 → 立刻停（App 那一步已经失败，等也没用）；
 *   · 收窄之后替身记下供应商会花钱的那条请求 → 不判请求体的脚本立刻停；要判请求体的脚本（`holdForScript`）先不停，让它自己读账本判完；
 *   · 其余（只记下了读请求、只走到上传、或要判请求体的脚本迟迟不收尾）→ 收窄后第一条记录之后 `graceMs` 兜底停。
 */
export function rehearsalShouldStop(entries, { lockedAtEntry = null, judgedAllow = [], relayAllow = [], holdForScript = false, graceMs = 20_000, now = Date.now() } = {}) {
  const allow = parseAllowlist([...judgedAllow, ...relayAllow].join(','))
  if (entries.some((entry) => entry?.kind === 'blocked' && !listsHost(allow, String(entry.host ?? '')))) return true
  if (lockedAtEntry === null) return false
  const vendor = parseAllowlist(judgedAllow.join(','))
  const after = entries.slice(lockedAtEntry).filter((entry) => entry?.kind === 'blocked' || entry?.kind === 'rehearsal-answered')
  if (after.some((entry) => entry.kind === 'blocked' && !isStandInRow(entry))) return true
  if (!holdForScript && after.some((entry) => isVendorRequestRow(entry, vendor) && isSpendingRow(entry))) return true
  const first = after[0]
  return Boolean(first) && now - Date.parse(first.at ?? '') >= graceMs
}

/**
 * 演练时 `readAllowedRequests()` 读回的东西：替身记下的供应商请求，换成真付费时闸记的 `allowed-request` 同一个形状
 * （主机是供应商本来的主机、URL 是本来的 URL、请求体已脱敏），脚本里读账本判请求体的那段不用为演练改一个字。
 */
export function rehearsalLedgerRequests(entries) {
  return entries.filter((entry) => entry?.kind === 'blocked' && entry.via === 'rehearsal-vendor')
    .map(({ method, url, host, body, at }) => ({ kind: 'allowed-request', via: 'rehearsal-vendor', method, url, host, body: body ?? null, at }))
}

function nestedAnswer(fieldPath, value) {
  const body = {}
  let node = body
  const keys = String(fieldPath).split('.')
  keys.forEach((key, index) => { node[key] = index === keys.length - 1 ? value : {}; node = node[key] })
  return body
}

const STAND_IN_BODY_LIMIT = 64 * 1024
/** 替身记请求体：JSON / 文本按闸的同一套脱敏（scrubText：Key 形状的串、签名查询串打码）；multipart 与二进制只记字节数（里面是素材本身）。 */
export function describeStandInBody(bytes, contentType = '') {
  if (!bytes?.length) return null
  if (/multipart|octet-stream|image\/|video\/|audio\//i.test(String(contentType))) return { bytes: bytes.length }
  const scrubbed = scrubUrlText(bytes.toString('utf8'))
  return { text: scrubbed.slice(0, STAND_IN_BODY_LIMIT), truncated: scrubbed.length > STAND_IN_BODY_LIMIT }
}

/**
 * 演练档的本机替身（2026-11-15；r2 加了上传中转与请求体）：被测 App 经产品闸已有的测试改道（NOMI_TEST_NETWORK_REDIRECTS）把**一个**源指到这里。
 * `role`：'vendor' = 供应商，'relay' = App 的托管上传中转。**从不转发**，结构上到不了真供应商 / 真中转。
 *   · `freeAnswers`（'GET /path' → JSON）：登记过的免费探测，照答（存 key 后的余额查询）。
 *   · `uploadAnswers`（'POST /path' → 回链字段路径，如 'url'）：上传，回一个本机的假地址（指回替身自己），流程接着走到下一站。
 *   · 其余请求：记一行 `blocked`（方法、路径、脱敏后的请求体），GET / HEAD 回 503，别的回 400（不可重试：App 当场把这一发判失败，不重试、不干等）。
 * 不记请求头（钥匙在头里）。
 */
export async function startRehearsalStandIn({ origin, netLog, role = 'vendor', freeAnswers = {}, uploadAnswers = {} }) {
  const { default: http } = await import('node:http')
  const host = new URL(origin).hostname
  const via = role === 'relay' ? 'rehearsal-relay' : 'rehearsal-vendor'
  const append = (row) => fs.appendFileSync(netLog, `${JSON.stringify({ ...row, via, role, host, pid: process.pid, at: new Date().toISOString() })}\n`)
  let assets = 0
  let standIn = ''
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const method = String(req.method ?? 'GET').toUpperCase()
    const pathname = new URL(req.url ?? '/', 'http://stand-in').pathname
    const url = `${origin}${pathname}`
    const reply = (status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    const free = freeAnswers[`${method} ${pathname}`]
    if (free !== undefined) { append({ kind: 'rehearsal-answered', answer: 'free-probe', method, url }); reply(200, free); return }
    const upload = uploadAnswers[`${method} ${pathname}`]
    if (upload !== undefined) {
      assets += 1
      const fakeUrl = `${standIn}/rehearsal-asset/${assets}`
      append({ kind: 'rehearsal-answered', answer: 'upload', method, url, bytes: Buffer.concat(chunks).length, fakeUrl })
      reply(200, nestedAnswer(upload, fakeUrl))
      return
    }
    append({ kind: 'blocked', method, url, body: describeStandInBody(Buffer.concat(chunks), req.headers['content-type']) })
    reply(READ_METHODS.has(method) ? 503 : 400, { error: { message: 'Nomi paid-walk rehearsal: request stopped before reaching the vendor' } })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  standIn = `http://127.0.0.1:${server.address().port}`
  return {
    origin: standIn,
    redirect: { from: origin, to: standIn },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()) }),
  }
}

/** 几个替身 → 交给被测 App 的环境：一张改道表（每个源一条）+ 本机源进可信名单。 */
export function standInLaunchEnv(standIns) {
  const live = standIns.filter(Boolean)
  if (!live.length) return {}
  return { NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify(live.map((item) => item.redirect)), NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: live.map((item) => item.origin).join(',') }
}

/** 建一份本场的账本文件路径（放系统临时目录，不进仓库）。 */
export function newNetLogFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-paid-net-'))
  return path.join(dir, 'net.jsonl')
}

/**
 * 盯账本：一出现被挡行就回调一次（只回调第一次；演练传 `shouldFire` 换判据，见 rehearsalShouldStop）。返回 `stop()`（同时给出最终读到的账本）。
 * 轮询而不是 fs.watch：Windows 上追加写的通知不可靠。
 */
export function watchNetLog(file, onBlocked, { intervalMs = 300, shouldFire = (entries) => blockedEntries(entries).length > 0 } = {}) {
  let fired = false
  const check = () => {
    const entries = readNetLog(file)
    if (!fired && shouldFire(entries)) { fired = true; onBlocked(entries) }
    return entries
  }
  const timer = setInterval(check, intervalMs)
  return { stop: () => { clearInterval(timer); return check() } }
}

/** 闸真的装上了、账本真的写得进：账本里要有 guard-loaded 行且几层齐全。缺了就当场判红，别等超时（产品闸写账本失败是静默的，靠这条发现）。 */
export const REQUIRED_PAID_GUARD_LAYERS = Object.freeze(['fetch', 'socket', 'chromium'])
export function guardLoadedError(entries) {
  const loaded = entries.filter((entry) => entry?.kind === 'guard-loaded')
  const layers = new Set(loaded.flatMap((entry) => entry.layers ?? []))
  const missing = REQUIRED_PAID_GUARD_LAYERS.filter((layer) => !layers.has(layer))
  if (loaded.length > 0 && missing.length === 0) return null
  return new Error(loaded.length === 0
    ? '付费走查的网络闸账本里没有 guard-loaded：闸没装上，或账本文件写不进——不能证明出网受控，一分钱没花前就停'
    : `付费走查的网络闸缺这几层：${missing.join('、')}`)
}
