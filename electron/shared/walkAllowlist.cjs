// 走查出网放行名单的判定，**唯一一份正本**：走查网络闸（scripts/walkthrough-network-guard.cjs 的 fetch / http(s) / 连接 /
// Chromium 四层）与产品自带测试网闸（electron/testNetworkGuard.ts）都 require 本文件，谁也不留拷贝。
// 纯 JS、零依赖：tsc 不产出 .cjs，所以由 scripts/build-electron.mjs 原样拷到 dist-electron/shared/，并由构建产物检查把关。
//
// 名单（逗号分隔）每项：
//   · 精确 origin：协议 + 主机 + 端口三者都要对（https 缺省 443，http 缺省 80，wss 443，ws 80）；
//   · `*.域名`：该域名本身及全部子域，**只放缺省端口 443 / 80**（成品下载走标准端口；别的端口要放就写精确 origin）。
// CI 里一律为空名单：CI 从来没有真钱，继承来的环境变量不能在那里打开公网。
/* global URL, module */
'use strict'

const DEFAULT_PORTS = { 'https:': 443, 'http:': 80, 'wss:': 443, 'ws:': 80 }
const WILDCARD_PORTS = new Set([443, 80])

function effectivePort(url) {
  return url.port ? Number(url.port) : DEFAULT_PORTS[url.protocol] ?? 0
}

function parseAllowlist(raw, { ci = false } = {}) {
  const exact = [] // { protocol, hostname, port }
  const suffixes = []
  if (ci) return { exact, suffixes }
  for (const part of String(raw || '').split(',')) {
    const value = part.trim()
    if (!value) continue
    if (value.startsWith('*.')) {
      const suffix = value.slice(2).toLowerCase()
      if (/^[a-z0-9.-]+$/.test(suffix)) suffixes.push(suffix)
      continue
    }
    try {
      const url = new URL(value)
      exact.push({ protocol: url.protocol, hostname: url.hostname.toLowerCase(), port: effectivePort(url) })
    } catch { /* 不是 origin：忽略，照样被拦 */ }
  }
  return { exact, suffixes }
}

function suffixMatches(suffixes, host) {
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

/** 按完整 URL 判（fetch / http(s) / Chromium / 产品闸）。 */
function allowsUrl(list, url) {
  const host = url.hostname.toLowerCase()
  const port = effectivePort(url)
  if (list.exact.some((entry) => entry.protocol === url.protocol && entry.hostname === host && entry.port === port)) return true
  return WILDCARD_PORTS.has(port) && suffixMatches(list.suffixes, host)
}

/** 连接层只看得到主机和端口，不知道协议：主机 + 端口与某个精确项一致、或通配域名的 443 / 80。 */
function allowsHostPort(list, host, port) {
  const value = String(host || '').toLowerCase()
  const number = Number(port)
  if (list.exact.some((entry) => entry.hostname === value && entry.port === number)) return true
  return WILDCARD_PORTS.has(number) && suffixMatches(list.suffixes, value)
}

/** 主机在名单里（不管端口 / 协议）：诊断用，区分「端口协议不对」和「根本不是授权的主机」。 */
function listsHost(list, host) {
  const value = String(host || '').toLowerCase()
  return list.exact.some((entry) => entry.hostname === value) || suffixMatches(list.suffixes, value)
}

module.exports = { parseAllowlist, allowsUrl, allowsHostPort, listsHost }
