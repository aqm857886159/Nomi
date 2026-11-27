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
// 上游错误归类的唯一主人（electron/shared/generationFailure.ts）：付费总闸直接调它，不另写第二份认字规则。
const { decideGenerationFailure, formatTaskFailureMessage } = tsxRequire('../../electron/shared/generationFailure.ts', import.meta.url)
const { categorizeVendorFailure, encodeStructuredErrorMessage } = tsxRequire('../../electron/shared/vendorFailure.ts', import.meta.url)
const { modelCallFailure } = tsxRequire('../../electron/ai/runtimeVendorError.ts', import.meta.url)
const { describeAgentError } = tsxRequire('../../electron/ai/agentError.ts', import.meta.url)
const { looksLikeLogicalError } = tsxRequire('../../electron/ai/requestPipeline.ts', import.meta.url)
const { isJsonRecord, pickUpstreamCode, pickUpstreamMessage, pickUpstreamType } = tsxRequire('../../electron/jsonUtils.ts', import.meta.url)

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
 * 演练档的站（由浅到深）：点生成之前就停了 / 走到 App 的上传（中转或供应商自己的上传口）/ 供应商只收到读请求 /
 * 只到大脑请求（Agent 开了口：对话类请求，替身答不了，走不到它后面的媒体创建）/ 供应商收到会花媒体钱的那条创建请求。
 * 「只到大脑」排在「创建」之下：本意花媒体钱的脚本只走到大脑，不算走到创建请求（2026-11-15 独立验收真问题 3）。
 */
export const REHEARSAL_STATIONS = Object.freeze(['before-click', 'upload-relay', 'vendor-read', 'brain', 'vendor-create'])
const STATION_RANK = Object.fromEntries(REHEARSAL_STATIONS.map((station, index) => [station, index]))
const READ_METHODS = new Set(['GET', 'HEAD'])
/** 大脑请求：通用文本协议的对话口（OpenAI chat/completions、responses，Anthropic messages），按路径认，不分供应商。 */
const BRAIN_PATH = /\/(?:chat\/completions|responses|messages)$/
/**
 * 没记方法的行（产品闸、走查闸 fetch 层不记方法）按路径推：查列表 / 查余额 / 查任务是读；路径是个文件（下载成片）、
 * 或主机是供应商的成片下载域，也是读；连接层没有路径（推不出来），宁低不高按读；其余按创建算。
 */
const READ_PATH = /\/(?:models|balance|pricing)(?:\/[^/]+)*$|\/tasks?\/[^/]+$|\.[a-z0-9]{2,5}$/i
const RESULT_HOSTS = parseAllowlist(Object.values(VENDOR_RESULT_DOMAINS).flat().join(','))
const isStandInRow = (entry) => entry?.via === 'rehearsal-vendor' || entry?.via === 'rehearsal-relay'
const isVendorRequestRow = (entry, vendorAllow) => entry?.kind === 'blocked' && entry?.role !== 'relay' && listsHost(vendorAllow, String(entry?.host ?? ''))
function rowPath(entry) {
  try { return new URL(String(entry?.url ?? '')).pathname } catch { return '' }
}

/**
 * 一条供应商请求行是哪一类（纯函数）：'vendor-read' | 'brain' | 'vendor-create'，外加方法是不是推出来的。
 * 方法有记就按方法（GET / HEAD = 读）；没记（有钥匙那档主进程的请求被产品闸或 fetch 层挡下）按路径推（2026-11-15 独立验收真问题 4：
 * 以前一律当读，主进程发出的创建请求永远判不到创建）。大脑按路径认，和方法无关。
 */
export function vendorRowClass(entry) {
  const pathname = rowPath(entry)
  const method = entry?.method ? String(entry.method).toUpperCase() : null
  if (method && READ_METHODS.has(method)) return { station: 'vendor-read', methodInferred: false }
  if (BRAIN_PATH.test(pathname)) return { station: 'brain', methodInferred: !method }
  if (!method) {
    const read = !pathname || pathname === '/' || READ_PATH.test(pathname) || listsHost(RESULT_HOSTS, String(entry?.host ?? ''))
    return { station: read ? 'vendor-read' : 'vendor-create', methodInferred: true }
  }
  return { station: 'vendor-create', methodInferred: false }
}

/**
 * 这一场演练走到了哪一站（纯函数）：只看收窄花钱面之后（`lockedAtEntry` 起）的账本行，取供应商请求里最深的那一类；
 * 一条供应商请求都没有时：替身答过上传或中转被挡 = upload-relay，否则 before-click。
 */
export function rehearsalStation(entries, { lockedAtEntry = null, vendorAllow = [], relayAllow = [] } = {}) {
  if (lockedAtEntry === null) return 'before-click'
  const vendor = parseAllowlist(vendorAllow.join(','))
  const relay = parseAllowlist(relayAllow.join(','))
  const after = entries.slice(lockedAtEntry)
  const vendorRows = after.filter((entry) => isVendorRequestRow(entry, vendor))
  if (vendorRows.length) return vendorRows.map((entry) => vendorRowClass(entry).station).sort((a, b) => STATION_RANK[b] - STATION_RANK[a])[0]
  const uploaded = after.some((entry) => (entry?.kind === 'rehearsal-answered' && entry.answer === 'upload')
    || (entry?.kind === 'blocked' && listsHost(relay, String(entry?.host ?? ''))))
  return uploaded ? 'upload-relay' : 'before-click'
}

/** 收窄之后走到这份脚本终点那一类的供应商请求有几条（= 走到了几发）。 */
export function rehearsalShotsReached(entries, { lockedAtEntry = null, vendorAllow = [], endsAt = 'vendor-create' } = {}) {
  if (lockedAtEntry === null) return 0
  const vendor = parseAllowlist(vendorAllow.join(','))
  return entries.slice(lockedAtEntry).filter((entry) => isVendorRequestRow(entry, vendor) && vendorRowClass(entry).station === endsAt).length
}

/** 走到的站够不够这份脚本的终点。 */
export function stationReaches(station, endsAt) {
  return (STATION_RANK[station] ?? -1) >= (STATION_RANK[endsAt] ?? Number.POSITIVE_INFINITY)
}

/** 错误 → 结果里的原文：去掉栈帧，多行接成一行（「花钱前核对没过：」后面那几条在第二行起，以前只取第一行就成了空的）。 */
export function scriptErrorText(error, limit = 600) {
  if (error === null || error === undefined) return null
  const lines = String(error?.message ?? error).split('\n').map((line) => line.trim()).filter((line) => line && !/^at\s/.test(line))
  return lines.join(' ⏎ ').slice(0, limit)
}

/** App 是被谁、为什么停下的（rehearsalShouldStop 的回答，也是 rehearsalVerdict 的输入）。 */
export const REHEARSAL_STOPS = Object.freeze({
  foreign: '挡下了授权源之外的请求',
  'guard-block': '收窄之后闸（不是替身）挡下了请求，App 那一步已经失败',
  endpoint: '替身记下了这份脚本终点那一类的请求（脚本声明了「走到这里就结束」）',
  brain: '只到大脑请求：替身答不了对话，Agent 走不到后面的媒体创建',
  idle: '兜底超时：替身最后一条记录之后脚本迟迟没有收尾',
})
/** 这几种停法之后脚本报的错是「App 被关」的后果，不判；兜底超时不在里面（它意味着脚本没走完）。 */
const EXPECTED_STOPS = new Set(['guard-block', 'endpoint', 'brain'])

/**
 * 演练判据（纯函数，2026-11-15；r2 加了「走到哪一站」与上传中转；第三版加了「几发走到几发」「只到大脑」「脚本的错不许吞」）：
 * 付费走查带演练开关跑时，传给闸的放行名单是空的，供应商与中转的源改道到本机替身（不转发），一个请求都出不去；
 * 这里如实回答「这一场走到了哪一站、几发里走到几发、脚本自己报没报错」。`status`：
 *   · 'passed'     = ① 没挡下授权源之外的请求 ② 走到了收窄花钱面 ③ 脚本自己没报错（见下）④ 走到的站 ≥ 终点 `endsAt`
 *                    ⑤ 终点那一类的请求有 ≥ `shots` 条（脚本声明的发数，缺省 1）；
 *   · 'brain-only' = 本意要走到媒体创建，只走到了大脑请求（Agent 开了口）——不算过，也不算走到创建请求，单列；
 *   · 'failed'     = 其余。
 * ③ 的口径：脚本抛的错一律算数，原文进结果（`scriptError`）；只有不自己判请求体的脚本（`hold` 为假）在 App 被
 * 「终点 / 闸挡 / 只到大脑」停下之后报的错不判（那是关窗的后果）。兜底超时（`stoppedBy: 'idle'`）本身就是不过：脚本没走完。
 * 收窄之前挡下的授权供应商请求照记不判。宁可错判不过，不错判通过。
 */
export function rehearsalVerdict({ entries, lockedAtEntry = null, judgedAllow = [], relayAllow = [], scriptError = null, stoppedBy = null, hold = false, endsAt = 'vendor-create', shots = 1 }) {
  const shown = (request) => `${request.via} ${request.method ?? '-'} ${request.host}${request.path ?? ''}`
  const allow = parseAllowlist([...judgedAllow, ...relayAllow].join(','))
  const relay = parseAllowlist(relayAllow.join(','))
  const vendor = parseAllowlist(judgedAllow.join(','))
  const station = rehearsalStation(entries, { lockedAtEntry, vendorAllow: judgedAllow, relayAllow })
  const reached = rehearsalShotsReached(entries, { lockedAtEntry, vendorAllow: judgedAllow, endsAt })
  const said = scriptErrorText(scriptError)
  const blocked = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry?.kind === 'blocked')
  const preLock = blocked.filter(({ index }) => lockedAtEntry === null || index < lockedAtEntry).map(({ entry }) => blockedRequestOf(entry))
  const foreign = blocked.find(({ entry }) => !listsHost(allow, String(entry.host ?? '')))
  const counted = said !== null && !(!hold && EXPECTED_STOPS.has(stoppedBy))
  const base = { station, endsAt, shots: { declared: shots, reached }, stoppedBy, preLock, scriptError: said, scriptErrorCounted: counted }
  const failed = (request, reason) => ({ ...base, status: 'failed', passed: false, request, reason })
  if (foreign) {
    const request = blockedRequestOf(foreign.entry)
    return failed(request, `挡下的是授权供应商之外的源 ${request.host}（${shown(request)}）`)
  }
  if (lockedAtEntry === null) return failed(null, `没走到收窄花钱面${said ? `——${said}` : ''}${preLock.length ? `（之前挡下过 ${preLock.map(shown).join('、')}）` : ''}`)
  const after = blocked.filter(({ index }) => index >= lockedAtEntry)
  const rank = ({ entry }) => (isVendorRequestRow(entry, vendor) ? STATION_RANK[vendorRowClass(entry).station] : -1)
  const deepest = after.filter((row) => rank(row) >= 0).sort((a, b) => rank(b) - rank(a))[0]
  const shownRow = deepest ?? after.find(({ entry }) => listsHost(relay, String(entry.host ?? '')))
  const request = shownRow ? { ...blockedRequestOf(shownRow.entry), ...(deepest && vendorRowClass(deepest.entry).methodInferred ? { methodInferred: true } : {}) } : null
  const where = request ? `（替身记下的是 ${shown(request)}${request.methodInferred ? '，方法没记、按路径推' : ''}）` : ''
  const progress = `走到「${station}」，${shots} 发里走到 ${reached} 发`
  if (stoppedBy === 'idle') return failed(request, `${REHEARSAL_STOPS.idle}——脚本没走完；${progress}${where}${said ? `；脚本报：${said}` : ''}`)
  if (counted) {
    return failed(request, station === 'before-click'
      ? `脚本在向供应商发第一条请求之前就失败——${said}`
      : `${progress}，但脚本自己报了错——${said}${where}`)
  }
  if (station === 'brain' && !stationReaches('brain', endsAt)) {
    return { ...base, status: 'brain-only', passed: false, request, reason: `只到大脑请求（Agent 开了口）：替身答不了对话，没走到这份脚本本意的「${endsAt}」${where}` }
  }
  if (!stationReaches(station, endsAt)) {
    return failed(request, station === 'before-click'
      ? '脚本跑完也没有向供应商发出请求——证明不了走到了发请求这一步'
      : `只走到了「${station}」，这份脚本的终点是「${endsAt}」${where}`)
  }
  if (reached < shots) return failed(request, `${shots} 发里只走到 ${reached} 发「${endsAt}」——后面几发没走到${where}`)
  return { ...base, status: 'passed', passed: true, request, reason: `走到了「${station}」，${shots} 发里走到 ${reached} 发：${shown(request)}${request?.methodInferred ? '（方法没记、按路径推）' : ''}` }
}

/**
 * 演练时什么时候让 App 停下（纯函数）：返回停的理由（REHEARSAL_STOPS 的键），不停返回 null。
 *   · 任何时候挡下授权源之外的请求 → 'foreign'；
 *   · 收窄之后闸（不是替身）挡下了请求 → 'guard-block'（App 那一步已经失败，等也没用）；
 *   · 收窄之后替身记下了大脑请求、而终点在它之后 → 'brain'（替身答不了对话，Agent 停在那里，等也没用）；
 *   · 收窄之后替身记下了终点那一类的请求 → 不自己判请求体的脚本 'endpoint'；自己判的（`holdForScript`）不停，让它走完全部几发；
 *   · 收窄之后最后一条记录过了 `graceMs` 还没收尾 → 'idle'（兜底，判不过）。
 */
export function rehearsalShouldStop(entries, { lockedAtEntry = null, judgedAllow = [], relayAllow = [], holdForScript = false, graceMs = 20_000, endsAt = 'vendor-create', now = Date.now() } = {}) {
  const allow = parseAllowlist([...judgedAllow, ...relayAllow].join(','))
  if (entries.some((entry) => entry?.kind === 'blocked' && !listsHost(allow, String(entry.host ?? '')))) return 'foreign'
  if (lockedAtEntry === null) return null
  const vendor = parseAllowlist(judgedAllow.join(','))
  const after = entries.slice(lockedAtEntry).filter((entry) => entry?.kind === 'blocked' || entry?.kind === 'rehearsal-answered')
  const guardBlocked = after.filter((entry) => entry.kind === 'blocked' && !isStandInRow(entry))
  if (guardBlocked.some((entry) => !isVendorRequestRow(entry, vendor))) return 'guard-block'
  const classes = after.filter((entry) => isVendorRequestRow(entry, vendor)).map((entry) => vendorRowClass(entry).station)
  if (!stationReaches('brain', endsAt) && classes.includes('brain') && !classes.includes('vendor-create')) return 'brain'
  if (!holdForScript && guardBlocked.some((entry) => isVendorRequestRow(entry, vendor) && stationReaches(vendorRowClass(entry).station, endsAt))) return 'guard-block'
  if (!holdForScript && classes.some((station) => stationReaches(station, endsAt))) return 'endpoint'
  const last = after.at(-1)
  return last && now - Date.parse(last.at ?? '') >= graceMs ? 'idle' : null
}

/**
 * 演练时 `readAllowedRequests()` 读回的东西：替身记下的供应商请求，换成真付费时闸记的 `allowed-request` 同一个形状
 * （主机是供应商本来的主机、URL 是本来的 URL、请求体已脱敏），脚本里读账本判请求体的那段不用为演练改一个字。
 */
export function rehearsalLedgerRequests(entries) {
  return entries.filter((entry) => entry?.kind === 'blocked' && entry.via === 'rehearsal-vendor')
    .map(({ method, url, host, body, at }) => ({ kind: 'allowed-request', via: 'rehearsal-vendor', method, url, host, body: body ?? null, at }))
}

/** 真付费走查因上游余额 / 额度耗尽记为「未验证」时的退出码（与 agent-gpt6-responses-real.paid.mjs 的 partial 一致：既不是 0 通过，也不是 1 产品不过）。 */
export const PAID_UNVERIFIED_EXIT_CODE = 3

/** 产品上游错误类别（GenerationErrorKind）里属于「服务商余额 / 额度」的两类 → 付费总闸结论词。 */
const UPSTREAM_UNVERIFIED_VERDICTS = Object.freeze({
  balance: '未验证：服务商余额不足',
  quota: '未验证：服务商额度不足',
})

function entryHost(entry) {
  if (typeof entry?.host === 'string' && entry.host) return entry.host
  try { return new URL(String(entry?.url ?? '')).hostname } catch { return '' }
}

function responseSummaryOf(entry) {
  let pathname = null
  try { pathname = new URL(String(entry?.url ?? '')).pathname || null } catch { /* ignore */ }
  return {
    via: entry?.via ?? 'fetch',
    method: entry?.method ? String(entry.method).toUpperCase() : null,
    host: entryHost(entry),
    path: pathname,
    status: typeof entry?.status === 'number' ? entry.status : null,
  }
}

function parseSseErrorPayload(rawText) {
  for (const line of String(rawText ?? '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const jsonPart = trimmed.slice(5).trim()
    if (!jsonPart || jsonPart === '[DONE]') continue
    try {
      const parsed = JSON.parse(jsonPart)
      if (!isJsonRecord(parsed)) continue
      if (isJsonRecord(parsed.response) && isJsonRecord(parsed.response.error)) return { error: parsed.response.error }
      if (parsed.type === 'error' || isJsonRecord(parsed.error) || typeof parsed.error === 'string') return parsed
    } catch { /* ignore non-JSON frame */ }
  }
  return null
}

/**
 * 单条供应商出网响应行 → 产品唯一错误分类器（decideGenerationFailure）的类别；正常成功响应返回 null。
 *   · HTTP ≥400：走文本 / Agent 调用同一套 modelCallFailure → describeAgentError → decideGenerationFailure；
 *   · HTTP 2xx 业务错误信封（{ code: 402/1620/429, msg }）：走 vendorHttp 同一套 looksLikeLogicalError → categorizeVendorFailure → decideGenerationFailure；
 *   · HTTP 2xx 异步任务轮询失败（{ data: { status: 'failed', error } }）：走 formatTaskFailureMessage → decideGenerationFailure；
 *   · HTTP 2xx SSE 流内错误帧（event: error / response.failed）：提取上游错误对象后走结构化载荷 → decideGenerationFailure。
 */
export function classifyAllowedVendorResponse(entry) {
  const status = typeof entry?.status === 'number' ? entry.status : null
  const rawText = typeof entry?.text === 'string' ? entry.text : typeof entry?.body?.text === 'string' ? entry.body.text : ''
  const url = typeof entry?.url === 'string' ? entry.url : ''
  const vendorKey = String(entry?.vendorKey || entryHost(entry) || 'vendor')
  const method = entry?.method ? String(entry.method).toUpperCase() : 'POST'
  if (status !== null && status >= 400) {
    const wire = describeAgentError(modelCallFailure({ vendorKey, attempt: { kind: 'http', status, url, body: rawText } }))
    const decision = decideGenerationFailure({ message: wire, locale: 'zh-CN' })
    return { kind: decision.kind, vendorSide: decision.vendorSide, providerMessage: decision.providerMessage ?? null }
  }
  if (status !== null && status >= 200 && status < 400 && rawText.trim()) {
    let parsed
    try { parsed = JSON.parse(rawText.trim()) } catch { parsed = null }
    if (isJsonRecord(parsed)) {
      const logicalCode = looksLikeLogicalError(parsed)
      if (logicalCode != null) {
        const detail = pickUpstreamMessage(parsed, String) || '(no detail from provider)'
        const upstreamCode = pickUpstreamCode(parsed)
        const wire = encodeStructuredErrorMessage({
          vendorKey, method, url, logicalCode, upstreamMsg: detail.slice(0, 256),
          ...(upstreamCode ? { upstreamCode } : {}),
          ...categorizeVendorFailure(undefined, logicalCode, { code: upstreamCode, type: pickUpstreamType(parsed) }),
        }, `Provider request failed (code ${logicalCode}) at ${vendorKey} ${method} ${url}: ${detail}`)
        const decision = decideGenerationFailure({ message: wire, locale: 'zh-CN' })
        return { kind: decision.kind, vendorSide: decision.vendorSide, providerMessage: decision.providerMessage ?? null }
      }
      if (isJsonRecord(parsed.data) && (parsed.data.status === 'failed' || parsed.data.status === 'error')) {
        const detail = pickUpstreamMessage(parsed.data, String) || pickUpstreamMessage(parsed, String)
        if (detail) {
          const taskId = typeof parsed.data.id === 'string' && parsed.data.id ? parsed.data.id : 'task'
          const wire = formatTaskFailureMessage(detail, { taskId }, 'zh-CN')
          const decision = decideGenerationFailure({ message: wire, locale: 'zh-CN' })
          return { kind: decision.kind, vendorSide: decision.vendorSide, providerMessage: decision.providerMessage ?? null }
        }
      }
      return null
    }
    const sseError = parseSseErrorPayload(rawText)
    if (sseError) {
      const detail = pickUpstreamMessage(sseError, String)
      const upstreamCode = pickUpstreamCode(sseError)
      if (detail || upstreamCode) {
        const text = detail || upstreamCode
        const wire = encodeStructuredErrorMessage({
          vendorKey, method, url, logicalCode: upstreamCode || 'stream_error',
          upstreamMsg: text.slice(0, 256),
          ...(upstreamCode ? { upstreamCode } : {}),
          category: 'unknown', retryable: false,
        }, text)
        const decision = decideGenerationFailure({ message: wire, locale: 'zh-CN' })
        return { kind: decision.kind, vendorSide: decision.vendorSide, providerMessage: decision.providerMessage ?? null }
      }
    }
  }
  return null
}

/**
 * 真付费走查的总闸判据（纯函数）：
 *   · 出网有 blocked 行 → '不过'（未授权出网被拦）；
 *   · 收窄花钱面之后的授权供应商响应里若有非 balance/quota 的错误（如 400 参数或回放被拒、404 模型不存在、401 密钥错、500 服务端错）且脚本失败 → '不过'；
 *   · 授权供应商响应里全是 balance/quota（且后面没有重试恢复成功并让整场无错跑通）→ 按产品归类判「未验证：服务商余额不足」或「未验证：服务商额度不足」；
 *   · 其余有脚本错误 → '不过'；无错 → '通过'。
 */
export function paidRunVerdict({ entries = [], lockedAtEntry = 0, allow = [], vendorAllow = null, scriptError = null } = {}) {
  const said = scriptErrorText(scriptError)
  const blocked = blockedError(entries, allow)
  if (blocked) {
    return {
      status: 'failed', passed: false, verdict: '不过', reason: scriptErrorText(blocked),
      upstreamErrorKind: null, request: blockedRequestOf(blockedEntries(entries)[0]), scriptError: said,
    }
  }
  const vendorMatcher = vendorAllow === null ? null : parseAllowlist(vendorAllow.join(','))
  const after = entries.slice(lockedAtEntry ?? 0).filter((entry) => entry?.kind === 'allowed-response'
    && (vendorMatcher === null || listsHost(vendorMatcher, entryHost(entry))))
  const evaluated = after.map((entry, index) => ({ entry, index, classified: classifyAllowedVendorResponse(entry) }))
  const otherVendorError = evaluated.find(({ classified }) => classified && !Object.hasOwn(UPSTREAM_UNVERIFIED_VERDICTS, classified.kind))
  const quotaErrors = evaluated.filter(({ classified }) => classified && Object.hasOwn(UPSTREAM_UNVERIFIED_VERDICTS, classified.kind))
  if (otherVendorError && said !== null) {
    return {
      status: 'failed', passed: false, verdict: '不过', reason: said,
      upstreamErrorKind: null, request: responseSummaryOf(otherVendorError.entry), scriptError: said,
    }
  }
  if (quotaErrors.length > 0 && !otherVendorError) {
    const lastQuotaIndex = quotaErrors.at(-1).index
    const recoveredLater = said === null && evaluated.slice(lastQuotaIndex + 1).some(({ classified }) => classified === null)
    if (!recoveredLater) {
      const chosen = quotaErrors.find(({ classified }) => classified.kind === 'balance') ?? quotaErrors[0]
      const kind = chosen.classified.kind
      const verdict = UPSTREAM_UNVERIFIED_VERDICTS[kind]
      const request = responseSummaryOf(chosen.entry)
      const where = [
        `${request.method ?? 'POST'} ${request.host}${request.path ?? ''}`,
        request.status !== null ? `HTTP ${request.status}` : null,
      ].filter(Boolean).join(' → ')
      const detail = [where, chosen.classified.providerMessage].filter(Boolean).join('：')
      return {
        status: 'unverified', passed: false, verdict,
        reason: detail ? `${verdict}（${detail}）` : verdict,
        upstreamErrorKind: kind, request, scriptError: said,
      }
    }
  }
  if (said !== null) {
    return { status: 'failed', passed: false, verdict: '不过', reason: said, upstreamErrorKind: null, request: null, scriptError: said }
  }
  return { status: 'passed', passed: true, verdict: '通过', reason: '通过', upstreamErrorKind: null, request: null, scriptError: null }
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
