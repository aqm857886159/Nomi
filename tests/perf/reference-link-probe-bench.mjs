#!/usr/bin/env node
// 参考素材临时链接「发之前先试一下」的等待量具（设计卡 docs/plan/2026-11-01-reference-link-delivery.md ★7）。
// 真函数：唯一决定点 electron/catalog/assetLocalization.ts#localizeAssetsForVendor + 真试探
// electron/assets/providerMediaFetch.ts#probeProviderLink（走 hardenedFetch 的 GET + Range）+ 本机假服务。
// 量的是**用户等的那一段**（决定点一次处理一个请求的全部参考），不是试探函数自己的并发——逐张串行的改法只有从决定点量才看得出来。
// 假服务对每个试探固定延迟 200ms（一次往返），回 206 和 1024 字节。零花费、零外网：只连 127.0.0.1，没有任何上传发生（链接都活着）。
//
// 量什么：
//   · probeOverheadMs（主指标）：一个请求带 14 张新参考图（最坏规模），试探一起发，总耗时**超出一次往返**多少毫秒。
//     串行的话是 14 × 200ms，并发应该只多出一点点（预算 100ms）；
//   · batchOverheadMs：批量 26 个请求同时发、共 30 张不同的图，总耗时超出一次往返多少毫秒。同一时刻 26 个请求共用 30 张图，
//     假服务只许收到 30 次 GET（去重是硬断言，不是指标）；
//   · probeBytesPerLink：每条链接下载了多少字节（约 1KB）。
// 接口同 tests/perf/node-json-bench.mjs 的约定：--runs N --out 文件 → { runs, noisy, metrics: { 名字: number[] } }。
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { require as tsxRequire } from 'tsx/cjs/api'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
const runs = Number(arg('--runs', 5))
const output = arg('--out', '')
if (!output || !Number.isInteger(runs) || runs < 1) throw new Error('Use --out <result.json> and a positive --runs')

const ROUND_TRIP_MS = 200
const LINKS_PER_REQUEST = 14
const BATCH_REQUESTS = 26
const BATCH_DISTINCT_IMAGES = 30
const RANGE_BODY = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1016, 1)])

// 假服务：每个 /probe/ 请求固定等一个往返再答。
const served = { gets: 0, bytes: 0, inFlight: 0, maxInFlight: 0 }
const server = http.createServer((req, res) => {
  served.gets += 1
  served.inFlight += 1
  served.maxInFlight = Math.max(served.maxInFlight, served.inFlight)
  res.once('close', () => { served.inFlight -= 1 })
  setTimeout(() => {
    served.bytes += RANGE_BODY.length
    res.writeHead(206, { 'Content-Type': 'image/png', 'Content-Range': `bytes 0-${RANGE_BODY.length - 1}/65536`, 'Content-Length': RANGE_BODY.length })
    res.end(RANGE_BODY)
  }, ROUND_TRIP_MS)
})
server.keepAliveTimeout = 0
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

// 隔离：试探和主进程日志都不碰真实资料。
const root = makeTempDir('nomi-reference-link-probe-bench-')
process.env.NOMI_SETTINGS_DIR = path.join(root, 'settings')
process.env.NOMI_ELECTRON_USER_DATA_DIR = path.join(root, 'user-data')

const { setLabTrustedPrivateOrigins } = tsxRequire('../../electron/networkOutboundPolicy.ts', import.meta.url)
const { probeProviderLink, resetProviderLinkProbes } = tsxRequire('../../electron/assets/providerMediaFetch.ts', import.meta.url)
const { localizeAssetsForVendor } = tsxRequire('../../electron/catalog/assetLocalization.ts', import.meta.url)
// 出站策略默认拒绝回环（那正是它该做的）：夹具用实验室例外开这一个精确 origin，主进程只在未打包构建上调这个口。
setLabTrustedPrivateOrigins([origin])

const link = (label) => `${origin}/probe/${label}.png`
const load = () => os.loadavg()[1]

// 一个请求的全部参考交给决定点：每张图是一个本机素材，带着服务商的临时链接（窗内）。活着，所以不应有任何上传。
const linkPolicy = { refused: false, probe: (url) => probeProviderLink(url) }
const uploadChannel = [{ vendorKey: 'bench', uploadApiKey: '', ingestion: { strategy: 'upload-url', endpoint: 'https://upload.invalid/x', base64Field: 'b', urlPath: 'url', accepts: ['image'] } }]
const neverUpload = async () => { throw new Error('A live link must never be uploaded') }
async function sendRequest(links) {
  const sources = new Map(links.map((url, index) => [`nomi-local://asset/p/ref-${index}-${url.slice(-12)}`, url]))
  const read = (local) => ({ bytes: RANGE_BODY, contentType: 'image/png', fileName: 'ref.png', originalUrl: sources.get(local), ageMs: 60_000 })
  const out = await localizeAssetsForVendor({ input_urls: [...sources.keys()] }, () => uploadChannel, read, neverUpload, neverUpload, { linkPolicy })
  const sent = out.value.input_urls
  if (sent.length !== links.length || sent.some((url, index) => url !== links[index])) throw new Error('The decision point did not send the live links as they were')
}
const metrics = { probeOverheadMs: [], batchOverheadMs: [], probeBytesPerLink: [] }
let noisy = load() >= 10
let failure

try {
  // 预热：第一次连接 / 模块初始化不算进数字里。
  resetProviderLinkProbes()
  await sendRequest([link('warmup')])

  for (let run = 0; run < runs; run += 1) {
    // 一个请求 14 张新图：一起发。
    resetProviderLinkProbes()
    Object.assign(served, { gets: 0, bytes: 0, maxInFlight: 0 })
    const links = Array.from({ length: LINKS_PER_REQUEST }, (_unused, index) => link(`request-${run}-${index}`))
    let startedAt = performance.now()
    await sendRequest(links)
    const requestMs = performance.now() - startedAt
    if (served.gets !== LINKS_PER_REQUEST) throw new Error(`Expected ${LINKS_PER_REQUEST} GETs, the fake server saw ${served.gets}`)
    if (served.maxInFlight !== LINKS_PER_REQUEST) throw new Error(`Probes were not concurrent: at most ${served.maxInFlight} in flight`)
    metrics.probeOverheadMs.push(Math.max(0, requestMs - ROUND_TRIP_MS))
    metrics.probeBytesPerLink.push(served.bytes / served.gets)

    // 批量：26 个请求同时发，共用 30 张图，同一张图只许试一次。
    resetProviderLinkProbes()
    Object.assign(served, { gets: 0, bytes: 0, maxInFlight: 0 })
    const images = Array.from({ length: BATCH_DISTINCT_IMAGES }, (_unused, index) => link(`batch-${run}-${index}`))
    startedAt = performance.now()
    await Promise.all(Array.from({ length: BATCH_REQUESTS }, (_unused, request) =>
      sendRequest(Array.from({ length: LINKS_PER_REQUEST }, (_inner, slot) => images[(request * 7 + slot * 3) % BATCH_DISTINCT_IMAGES]))))
    const batchMs = performance.now() - startedAt
    if (served.gets !== BATCH_DISTINCT_IMAGES) throw new Error(`Expected ${BATCH_DISTINCT_IMAGES} GETs for the shared images, the fake server saw ${served.gets}`)
    metrics.batchOverheadMs.push(Math.max(0, batchMs - ROUND_TRIP_MS))
  }
} catch (error) {
  failure = error
} finally {
  noisy = noisy || load() >= 10
  setLabTrustedPrivateOrigins([])
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(() => resolve()))
  cleanupTestTemp(root)
}

const report = {
  scope: `${LINKS_PER_REQUEST} new links in one request, then ${BATCH_REQUESTS} concurrent requests sharing ${BATCH_DISTINCT_IMAGES} images; real probeProviderLink against a loopback server that answers after ${ROUND_TRIP_MS}ms`,
  date: new Date().toISOString(),
  machine: `${process.platform} ${process.arch} ${os.cpus()[0]?.model}`,
  node: process.version,
  roundTripMs: ROUND_TRIP_MS,
  noisy,
  runs,
  metrics,
  ...(failure ? { failure: failure.message } : {}),
}
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
fs.writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ probeOverheadMs: metrics.probeOverheadMs, batchOverheadMs: metrics.batchOverheadMs, probeBytesPerLink: metrics.probeBytesPerLink, noisy }))
if (failure) { console.error(failure.message); process.exit(1) }
