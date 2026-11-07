#!/usr/bin/env node
// 浏览器「提取提示词」的零额度演练：真 Electron、真浏览器面板、真 IPC、真付费卡，读图模型由本机夹具按剧本回答。
//
//   NOMI_REAL_MEDIA_DIR="<本机素材目录>" node tests/ux/browser-extract-real.rehearsal.walk.mjs     （先 pnpm build）
//
// 与真付费走查 browser-extract-real.paid.mjs 跑**同一份**步骤（_browserExtractSteps.mjs）：悬停图片点提取 → 出卡 → 取消；
// 卡开着时再点回「忙」；在这张卡上确认；工具栏「截图提取」→ 出卡 → 取消。差别只在读图模型：这里是夹具（假钥匙、
// 出网名单为空、公网请求在进程入口就被闸拦下，结构上花不了钱），那边是 App 里接好的真模型。
// 中、英界面各走一遍，每遍拍三张图（出卡、卡开着时再点出的「忙」、确认后提示词库里新的那一条）。
// 证据：docs/evidence/2026-10-27-browser-extract-grant/rehearsal/（report.json 与六张截图；落盘前查 key）。
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { uiText } from './full-walk/invariants.mjs'
import {
  VISION_MODEL, extractEvidence, isVisionBody, runBrowserExtractJourney, startExtractionPage, writeExtractEvidence,
} from './_browserExtractSteps.mjs'

const SCRIPT = 'browser-extract-real.rehearsal.walk.mjs'
const FAKE_KEY = 'rehearsal-fake-key-0123456789abcdef'
/** 夹具回给读图请求的那句话（形状 = parseBrowserPromptExtraction 认的 JSON）。 */
const SCRIPTED_REPLY = { title: 'Rehearsal harbor at dawn', prompt: 'A quiet harbor at dawn, soft fog over still water, 35mm film still' }
/** 反例演练要把证据写到别处（不覆盖通过的那份）：只给人工做反例时用。 */
const EVIDENCE_SUBDIR = process.env.NOMI_EXTRACT_EVIDENCE_SUBDIR || 'rehearsal'
const startedAt = new Date().toISOString()

const paid = await openPaidWalk(SCRIPT, 'browser-extract-rehearsal', [VISION_MODEL], {
  env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: FAKE_KEY },
  buildMarkers: [uiText('zh-CN', 'runtime.capability.promptExtractionTitle'), uiText('zh-CN', 'browserAssets.promptExtractionBusy')],
  createWalk: (name, options) => createRuntimeWalk(name, {
    ...options, generationProvider: 'apimart', seedApimartKey: false, env: { ...options.env, NOMI_WALK_ALLOW_ORIGINS: '' },
  }),
})
const { walk } = paid
// 读图请求（请求体里带图）回剧本里的那句话；引导时的连通性验证等别的文本调用回一句「好的」。
// 每次读图回的标题带上序号：中、英两遍各存一条，库里（和截图里）分得清是哪一遍存进去的。
let visionReplies = 0
walk.fixture.respond({
  label: 'rehearsal vision · browser prompt extraction',
  match: (body) => isVisionBody(body),
  reply: () => {
    visionReplies += 1
    return { type: 'text', text: JSON.stringify({ ...SCRIPTED_REPLY, title: `${SCRIPTED_REPLY.title} #${visionReplies}` }) }
  },
})
walk.fixture.respond({ label: 'rehearsal fallback · non-vision text call', match: () => true, reply: { type: 'text', text: '好的。' } })

const page = await startExtractionPage()
const journey = {}
let failure
try {
  await runBrowserExtractJourney(journey, { walk, page, locales: ['zh-CN', 'en'], evidenceSubdir: EVIDENCE_SUBDIR, fixture: walk.fixture })
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await page.close()
  await paid.finish(failure)
  const written = writeExtractEvidence(EVIDENCE_SUBDIR, 'report.json', extractEvidence({
    script: SCRIPT, mode: 'rehearsal（夹具剧本读图，不是模型分数）', startedAt, journey, walk, failure,
    model: `${VISION_MODEL.vendorKey}/${VISION_MODEL.modelKey}（地址重定向到本机夹具）`, page,
  }), { secrets: [FAKE_KEY] })
  console.log(`[extract] 演练摘要：${written}`)
}
