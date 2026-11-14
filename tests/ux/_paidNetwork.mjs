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

/**
 * 演练判据（纯函数，2026-11-15）：付费走查带演练开关跑时，传给闸的放行名单是空的，供应商一个请求都出不去；
 * 这里只回答「这一场走到了花钱前的最后一步没有」。通过只有一种：
 *   收窄花钱面之后（`lockedAtEntry` = 收窄完成那一刻账本有几行；没收窄过 = null）网络闸挡下的**第一条**请求，
 *   主机是这份脚本授权的供应商（`judgedAllow` = 不演练时本来会放行的名单）。
 * 收窄之前挡下的授权供应商请求（接入页存 key 之后查余额、验证）照记不判：真付费时它们本来就放行、不花钱，演练里被挡也出不了门。
 * 其余全是不过：任何时候挡下别的源、没走到收窄、收窄后没发请求、脚本先失败（`scriptError` 且闸还没让 App 停下——`stoppedByGuard` 为假）。
 * 宁可错判不过，不错判通过：分不清先后的（脚本报错时闸还没来得及停 App）一律判不过。
 */
export function rehearsalVerdict({ entries, lockedAtEntry = null, judgedAllow = [], scriptError = null, stoppedByGuard = false }) {
  const said = (error) => String(error?.message ?? error).split('\n')[0].slice(0, 300)
  const shown = (request) => `${request.via} ${request.method ?? '-'} ${request.host}${request.path ?? ''}`
  const allow = parseAllowlist(judgedAllow.join(','))
  const blocked = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry?.kind === 'blocked')
  const preLock = blocked.filter(({ index }) => lockedAtEntry === null || index < lockedAtEntry).map(({ entry }) => blockedRequestOf(entry))
  const foreign = blocked.find(({ entry }) => !listsHost(allow, String(entry.host ?? '')))
  if (foreign) {
    const request = blockedRequestOf(foreign.entry)
    return { passed: false, request, preLock, reason: `挡下的是授权供应商之外的源 ${request.host}（${shown(request)}）` }
  }
  if (lockedAtEntry === null) {
    return { passed: false, request: null, preLock, reason: `没走到收窄花钱面${scriptError ? `——${said(scriptError)}` : ''}${preLock.length ? `（之前挡下过 ${preLock.map(shown).join('、')}）` : ''}` }
  }
  const first = blocked.find(({ index }) => index >= lockedAtEntry)
  if (!first) {
    return { passed: false, request: null, preLock, reason: scriptError
      ? `脚本在向供应商发第一条请求之前就失败——${said(scriptError)}`
      : '脚本跑完也没有向供应商发出请求——证明不了走到了发请求这一步' }
  }
  const request = blockedRequestOf(first.entry)
  if (scriptError && !stoppedByGuard) return { passed: false, request, preLock, reason: `脚本在网络闸挡下之前（或同时）就失败——${said(scriptError)}（之后挡下的是 ${shown(request)}）` }
  return { passed: true, request, preLock, reason: `走到了第一条供应商请求：${shown(request)}` }
}

/** 演练时什么时候让 App 停下：收窄之后的第一条被挡请求，或任何时候挡下别的源（这两种都已经能下结论）。 */
export function rehearsalShouldStop(entries, { lockedAtEntry = null, judgedAllow = [] }) {
  const allow = parseAllowlist(judgedAllow.join(','))
  return entries.some((entry, index) => entry?.kind === 'blocked' && ((lockedAtEntry !== null && index >= lockedAtEntry) || !listsHost(allow, String(entry.host ?? ''))))
}

/**
 * 不要 Key 那一档演练的「本机替身供应商」：被测 App 经产品闸已有的测试改道（NOMI_TEST_NETWORK_REDIRECTS）把供应商的源指到这里。
 * 为什么要它：产品存 key 后用供应商的免费探测（APIMart 是 GET /v1/balance）确认 key 能用，网络被挡就诚实地记「待定」、模型不放出来，
 * 假钥匙的演练于是卡在接入页。替身只答登记过的免费探测（`freeAnswers`：'GET /path' → JSON），别的请求一律记成账本里的被挡行
 * （带方法与路径，判据照旧）并回 503——**从不转发**，结构上到不了真供应商。不读、不记请求头和请求体（里面有钥匙）。
 */
export async function startRehearsalVendor({ origin, netLog, freeAnswers = {} }) {
  const { default: http } = await import('node:http')
  const host = new URL(origin).hostname
  const append = (row) => fs.appendFileSync(netLog, `${JSON.stringify({ ...row, host, pid: process.pid, at: new Date().toISOString() })}\n`)
  const server = http.createServer((req, res) => {
    req.resume()
    const method = String(req.method ?? 'GET').toUpperCase()
    const pathname = new URL(req.url ?? '/', 'http://stand-in').pathname
    const answer = freeAnswers[`${method} ${pathname}`]
    if (answer !== undefined) {
      append({ kind: 'rehearsal-answered', via: 'rehearsal-vendor', method, url: `${origin}${pathname}` })
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer))
      return
    }
    append({ kind: 'blocked', via: 'rehearsal-vendor', method, url: `${origin}${pathname}` })
    res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Nomi paid-walk rehearsal: request stopped before reaching the vendor' } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const standIn = `http://127.0.0.1:${server.address().port}`
  return {
    origin: standIn,
    env: { NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from: origin, to: standIn }]), NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: standIn },
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()) }),
  }
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
