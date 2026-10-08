// 全功能走查的出网观察：主进程里的走查网络闸（scripts/walkthrough-network-guard.cjs，全仓唯一一份）
// + 公网出口的黑洞代理，两处都往同一个 JSONL（NOMI_WALK_NET_LOG）里记，格式同闸：`{ kind, via, url, host, stack? }`。
//
// 为什么还要黑洞代理：闸在 fetch / http / 连接三层按「目标是不是本机」拦，而 App 的「跟随系统代理」档会把公网流量
// 交给本机代理（Clash 之类就在 127.0.0.1）——绕过 fetch 的客户端走这条路时，闸在连接层只看得见回环，
// 真实目标藏在 CONNECT 里。所以再把 HTTPS_PROXY 指到这里这个**只记账、一律拒绝**的代理：App 的代理解析
// env 优先（`electron/systemProxy.ts resolveProxy`），公网流量就只会来到这里，不会到用户真正的代理。
// 判「漏到真供应商」的依据是目录里每一家供应商的主机名（同 `agent-spend-long-output-name.walk.mjs` 的 vendorHostsOf）。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const GUARD_MODULE = path.join(repoRoot, 'scripts', 'walkthrough-network-guard.cjs')
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
/** 全功能走查要求闸的这几层都装上了（少一层 = 这一场的「没漏」不作数）。 */
export const REQUIRED_GUARD_LAYERS = Object.freeze(['fetch', 'http', 'https', 'socket', 'chromium'])

export async function startEgressWatch({ logFile }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true })
  fs.writeFileSync(logFile, '')
  const append = (entry) => fs.appendFileSync(logFile, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`)
  const server = http.createServer((request, response) => {
    append({ kind: 'blocked', via: 'proxy-sink', method: request.method, url: String(request.url).slice(0, 300), host: hostOfTarget(request.url) })
    response.writeHead(403).end('full-walk: public egress is not allowed')
  })
  server.on('connect', (request, socket) => {
    append({ kind: 'blocked', via: 'proxy-sink', method: 'CONNECT', url: `tcp://${request.url}`, host: hostOfTarget(request.url) })
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    logFile,
    mainRequire: [GUARD_MODULE],
    env: {
      NOMI_WALK_NET_LOG: logFile,
      NOMI_TEST_NETWORK_GUARD: '1',
      HTTPS_PROXY: url, HTTP_PROXY: url, ALL_PROXY: url,
      https_proxy: url, http_proxy: url, all_proxy: url,
      NO_PROXY: '127.0.0.1,localhost,::1', no_proxy: '127.0.0.1,localhost,::1',
    },
    read: () => readEgressLog(logFile),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

export function hostOfTarget(target) {
  const value = String(target || '')
  if (/^[a-z]+:\/\//i.test(value)) {
    try { return new URL(value).hostname } catch { return value }
  }
  return value.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
}

export function readEgressLog(logFile) {
  if (!fs.existsSync(logFile)) return []
  return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line) } catch { return { kind: 'unparsable', raw: line.slice(0, 200) } }
  })
}

/** 目录里每一家供应商的主机名（baseUrlHint + mapping 里写死的绝对地址）。回环地址不算。 */
export function vendorHostsOf(catalogPath) {
  const hosts = new Map()
  if (!fs.existsSync(catalogPath)) return hosts
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  const add = (value, vendorKey) => {
    try {
      const host = new URL(String(value)).hostname
      if (host && !LOOPBACK.has(host)) hosts.set(host, vendorKey)
    } catch { /* not a URL */ }
  }
  for (const vendor of catalog.vendors ?? []) add(vendor.baseUrlHint, vendor.key)
  for (const mapping of catalog.mappings ?? []) {
    for (const match of JSON.stringify(mapping).matchAll(/https?:\/\/[^"\s\\]+/g)) add(match[0], mapping.vendorKey)
  }
  return hosts
}

const timeOf = (entry) => (typeof entry.at === 'number' ? entry.at : Date.parse(String(entry.at ?? '')) || 0)

/**
 * 把出网记录分成两类：打向供应商的（违反铁律 1 的网络闸那一条）、打向别的公网的（如实记下，不判违反）。
 * 闸没报到、或 REQUIRED_GUARD_LAYERS 里有一层没装上 = 这一场的「没漏」不作数，调用方要把它当成走查故障。
 * 代理黑洞那一行没有调用栈：同一主机 5 秒内闸那边若有带栈的记录，挂上去当「是谁发的」。
 */
export function classifyEgress(entries, vendorHosts) {
  const loaded = entries.filter((entry) => entry.kind === 'guard-loaded')
  const layers = [...new Set(loaded.flatMap((entry) => entry.layers ?? []))]
  const attempts = entries.filter((entry) => entry.kind === 'blocked')
    .map((entry) => ({ ...entry, host: entry.host || hostOfTarget(entry.url), at: timeOf(entry) }))
  const withStack = attempts.filter((entry) => entry.stack)
  const callersOf = (attempt) => (attempt.stack ? [] : withStack.filter((caller) => caller.host === attempt.host && Math.abs(caller.at - attempt.at) <= 5_000))
  return {
    guardReady: loaded.length > 0 && REQUIRED_GUARD_LAYERS.every((layer) => layers.includes(layer)),
    guardLayers: layers,
    guardErrors: entries.filter((entry) => entry.kind === 'guard-error'),
    vendor: attempts.filter((entry) => vendorHosts.has(entry.host)).map((entry) => ({ ...entry, vendorKey: vendorHosts.get(entry.host), callers: callersOf(entry) })),
    other: attempts.filter((entry) => !vendorHosts.has(entry.host)).map((entry) => ({ ...entry, callers: callersOf(entry) })),
  }
}

/** 从调用栈里挑出 App 自己的那几帧（dist-electron 下的文件），给违反记录定位模块用。 */
export function appFramesOf(stack) {
  // 构建产物是逐文件编译的（dist-electron/x/y.js ↔ electron/x/y.ts），换回源码路径好让人直接去看；
  // 共用的出口（appFetch）不算「是谁发的」，跳过它往上找调用方。
  return String(stack ?? '').split(' | ')
    .filter((frame) => /dist-electron[\\/]/.test(frame) && !/walkthrough-network-guard|node_modules|appFetch\.js/.test(frame))
    .map((frame) => frame.replace(/^at\s+/, '').replace(/.*dist-electron[\\/]/, 'electron/').replace(/\\/g, '/').replace(/\.js:(\d+):\d+\)?$/, '.ts（编译后第 $1 行）'))
    .slice(0, 4)
}
