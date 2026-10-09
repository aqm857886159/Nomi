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

/** 建一份本场的账本文件路径（放系统临时目录，不进仓库）。 */
export function newNetLogFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-paid-net-'))
  return path.join(dir, 'net.jsonl')
}

/**
 * 盯账本：一出现被挡行就回调一次（只回调第一次）。返回 `stop()`（同时给出最终读到的账本）。
 * 轮询而不是 fs.watch：Windows 上追加写的通知不可靠。
 */
export function watchNetLog(file, onBlocked, { intervalMs = 300 } = {}) {
  let fired = false
  const check = () => {
    const entries = readNetLog(file)
    if (!fired && blockedEntries(entries).length > 0) { fired = true; onBlocked(entries) }
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
