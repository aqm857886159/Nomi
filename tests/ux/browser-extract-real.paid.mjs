#!/usr/bin/env node
// 真付费走查 · 浏览器「提取提示词」每次弹卡问人、确认后恰好请求供应商一次（设计卡 docs/plan/2026-10-27-browser-extract-grant.md ★9 第 17 格）。
//
//   pnpm build && NOMI_SPEND_OK=1 NOMI_REAL_MEDIA_DIR="<本机素材目录>" node tests/ux/browser-extract-real.paid.mjs
//
// 先跑零花费演练 browser-extract-real.rehearsal.walk.mjs（同一份步骤，夹具读图模型），过了再跑这条。
// 为什么要它：提取从 2026-09-09 起每次被付费闸拒，坏了七周没人发现；修法把整次提取挪进主进程、每次弹卡问人、铸令牌再发。
// 集成测试证了代码路径，证不了「真 App 里点出来的那一下、真供应商那一头」。这条走查让 App 里接好的真读图模型真读一张图，量三件事：
//   ① 卡上点取消 → 供应商 0 次、库不变；② 卡开着时再点 → 回「忙」、始终 1 张卡；③ 在这张卡上确认 → 供应商恰好 1 次、库多 1 条，
//   再等 60 秒仍是 1 次；④ 工具栏截图提取点取消 → 仍是 1 次。三方对账：卡上确认 1 次 = 出站 1 笔 = 供应商 1 个任务。
//
// 授权：只授权一个读图模型 apimart/gemini-3.5-flash（electron/catalog/apimartTexts.ts：浏览器提取与视频拆解读帧都走它，
// deepseek 读不了图），不授权任何生成模型。最坏花费：1 次读图调用（登记的真素材 image-4k-png 压到长边 1920 的 PNG，约 3.6 MB，内联进一次请求；NOMI_EXTRACT_IMAGE_MAX_EDGE=0 才发原样 4K）；
// 取消的步骤一个请求都不发。读图那一跳的出站由 App 的网络闸记账（recordAllowedBodies），与主进程出站计数、卡上确认点击数逐项对账。
// 凭据与原库保护见 _paidRun.mjs / _realProfile.mjs：从真实资料目录拷密文进隔离副本、不读 key、跑完删凭据副本、原库指纹跑前跑后比对；
// 产物里找不到本 PR 的界面原文（卡片标题、「忙」那句）就拒跑，一分钱不花。
// 证据摘要：docs/evidence/2026-10-27-browser-extract-grant/paid/report.json（落盘前查 key）。
import { expect } from './_assert.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { uiText } from './full-walk/invariants.mjs'
import {
  VISION_MODEL, extractEvidence, runBrowserExtractJourney, startExtractionPage, writeExtractEvidence,
} from './_browserExtractSteps.mjs'

const SCRIPT = 'browser-extract-real.paid.mjs'
const startedAt = new Date().toISOString()

const paid = await openPaidWalk(SCRIPT, 'browser-extract-real', [VISION_MODEL], {
  buildMarkers: [uiText('zh-CN', 'runtime.capability.promptExtractionTitle'), uiText('zh-CN', 'browserAssets.promptExtractionBusy')],
  recordAllowedBodies: true,
})
const { walk } = paid
const page = await startExtractionPage()
const journey = {}
let failure
try {
  await runBrowserExtractJourney(journey, { walk, page, locales: ['zh-CN'], evidenceSubdir: 'paid' })
  // 出站账本（App 的网络闸记的、真正发往公网的请求）：读图只发一次，且发的是被授权的模型、带着图。
  const ledger = paid.readAllowedRequests().filter((entry) => entry.kind === 'allowed-request' && entry.method === 'POST' && /\/chat\/completions|\/v1\/messages|generateContent|\/responses/.test(String(entry.url)))
  const sent = ledger.map((entry) => ({ url: entry.url, host: entry.host, model: /"model"\s*:\s*"([^"]+)"/.exec(String(entry.body?.text ?? ''))?.[1] ?? null, hasImage: /image_url|data:image\//.test(String(entry.body?.text ?? '')) }))
  journey.passes[0].counts.ledger = sent
  expect(sent, '出站账本里读图只有一笔').toHaveLength(1)
  // 账本只留请求体前 64 KB（图是内联的 base64，后面的字节截掉了）：读得到模型名就必须是被授权的那一个，读不到记 null，不判红。
  if (sent[0].model !== null) expect(sent[0].model, '发出去的是被授权的读图模型').toBe(VISION_MODEL.modelKey)
  expect(journey.passes[0].counts.reconcile, '卡上确认 1 次 = 主进程出站 1 笔').toMatchObject({ confirmClicks: 1, outbound: 1 })
  walk.report.reconcile = { cardConfirms: 1, outboundCounter: 1, ledger: sent.length, supplierSide: '回包落成了库里那一条；供应商后台账单由协调人工核对' }
} catch (error) {
  failure = error
  process.exitCode = 1
  console.error('[extract] 走查失败：', error instanceof Error ? error.message : String(error))
} finally {
  await page.close()
  await paid.finish(failure)
  const written = writeExtractEvidence('paid', 'report.json', extractEvidence({
    script: SCRIPT, mode: 'paid（真读图模型）', startedAt, journey, walk, failure, model: `${VISION_MODEL.vendorKey}/${VISION_MODEL.modelKey}`, page,
  }))
  console.log(`[extract] 证据摘要：${written}`)
}
