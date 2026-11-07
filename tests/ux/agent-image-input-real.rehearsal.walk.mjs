#!/usr/bin/env node
// 「Agent 附图交给自配、没声明读图能力的模型」付费走查（agent-image-input-real.paid.mjs）的零额度演练：
// 真 Electron、真 IPC、真接入页、真 Agent lane；模型和供应商都是本机夹具（放行名单清空，真请求会被走查闸当场挡下），一分钱不花。
// 与真付费走查共用同一份步骤（_agentImageInputSteps.mjs）和判分（_agentImageInputScore.mjs），不抄第二份；差别只在三处：
//   ① 凭据是一把假 key，APIMart 的地址被重定向到本机夹具，接入页真的走（手填 id 也在夹具的目录里走完自检）；
//   ② 大脑不是剧本，它**读请求体里的图**作答：第 1 轮把图片部件的字节解成 PNG、读出点阵里的暗号原样回，请求体里没有图就答「没看到图片」——
//      所以只有像素真的完整到了夹具手里，演练才答得对；第 2 轮回收到的图片字节数；
//   ③ 「发出去的请求体」读夹具收到的完整请求（真付费读网络闸账本里的前 64 KiB）。
// 它证的是「走查脚本走得通、读数读得出、判分判得对、请求体里图真的发出去了」，不证真模型自己读不读得准（那只有真付费能证）。
// 演练要求：手填的行落在「不知道」档；两轮的请求体里都有图片部件（openai-compatible 是 image_url）、都没有「图片未发送」那句注；
// 第 1 轮认出暗号，第 2 轮没走错误面；第 2 轮请求体里的图字节数 = 登记真素材抽出来的那张 PNG（没截断、没改写）。
import { BRAIN } from './_agentVideoPaid.mjs'
import {
  ASK_CODE, ASK_SCENE, MODEL_ID, fixtureWireProbe, imageBuffersOf, imageInputEvidence, journeyFailures, readCodeWordFromPng, userTurnWith,
} from './_agentImageInputScore.mjs'
import { prepareImages, runImageInputJourney, writeImageInputEvidence } from './_agentImageInputSteps.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'

const SCRIPT = 'agent-image-input-real.rehearsal.walk.mjs'
const FAKE_KEY = 'rehearsal-fake-key-0123456789abcdef'
const BUILD_MARKER = 'Model does not accept image input:'
const NO_IMAGE = '我这边没有看到图片。'
const startedAt = new Date().toISOString()

// ── 夹具大脑：按请求体里的图作答 ──────────────────────────────────────────────────
function installImageBrain(fixture) {
  fixture.respond({
    label: 'rehearsal brain · reads the code word out of the attached pixels',
    match: (body) => userTurnWith(body, ASK_CODE) !== null,
    reply: (body) => {
      const [image] = imageBuffersOf(userTurnWith(body, ASK_CODE).content)
      if (!image) return { type: 'text', text: NO_IMAGE }
      try { return { type: 'text', text: readCodeWordFromPng(image) } } catch (error) { return { type: 'text', text: `图片收到了，但读不出暗号：${String(error?.message ?? error)}` } }
    },
  })
  fixture.respond({
    label: 'rehearsal brain · reports the size of the attached image',
    match: (body) => userTurnWith(body, ASK_SCENE) !== null,
    reply: (body) => {
      const [image] = imageBuffersOf(userTurnWith(body, ASK_SCENE).content)
      return { type: 'text', text: image ? `一张真实拍摄的画面，收到的图片是 ${image.length} 字节。` : NO_IMAGE }
    },
  })
  fixture.respond({ label: 'rehearsal fallback · non-brain text call', match: () => true, reply: { type: 'text', text: '好的。' } })
}

// 备料先于一切：缺 NOMI_REAL_MEDIA_DIR / 缺素材就在起 App 之前红。
const images = prepareImages()
const paid = await openPaidWalk(SCRIPT, 'agent-image-input-rehearsal', [BRAIN], {
  env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: FAKE_KEY },
  buildMarkers: [BUILD_MARKER],
  createWalk: (name, options) => createRuntimeWalk(name, {
    ...options, generationProvider: 'apimart', seedApimartKey: false, env: { ...options.env, NOMI_WALK_ALLOW_ORIGINS: '' },
  }),
})
const { walk } = paid
installImageBrain(walk.fixture)
const journey = { rounds: [] }
let failure
try {
  await runImageInputJourney(journey, { walk, paid, images, modelId: MODEL_ID, wireProbe: fixtureWireProbe(walk.fixture) })
  console.log(`[image-input] ${JSON.stringify(journey.numbers)}`)
  const failures = journeyFailures(journey, { requireWire: true })
  const [code, size] = journey.rounds
  if (size?.wire?.images?.[0]?.bytes !== images.real.bytes) failures.push(`第 2 轮请求体里的图 ${size?.wire?.images?.[0]?.bytes ?? '没有'} 字节，登记真素材抽出来的那张是 ${images.real.bytes} 字节（被截断或改写了）`)
  if (code?.wire?.images?.[0]?.mime !== 'image/png') failures.push(`第 1 轮请求体里的图 mime 是 ${code?.wire?.images?.[0]?.mime ?? '没有'}，发出去的是 PNG`)
  if (journey.numbers?.realSizeDeniesImage) failures.push('第 2 轮回答像是没收到图')
  if (journey.numbers?.errorSurfaceRounds !== 0 || journey.numbers?.harnessErrors !== 0) failures.push(`有 ${journey.numbers?.errorSurfaceRounds} 轮走了错误面、${journey.numbers?.harnessErrors} 轮量具出错`)
  if (failures.length) throw new Error(`演练有红：\n  ${failures.join('\n  ')}`)
  walk.report.paidCalls = 0
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
  const written = writeImageInputEvidence('rehearsal/report.json', imageInputEvidence({
    script: SCRIPT, mode: 'rehearsal（夹具大脑按请求体里的像素作答，不是模型分数）', startedAt, journey, walk, failure, images, buildMarker: BUILD_MARKER,
    model: `apimart/${MODEL_ID}（地址重定向到本机夹具）`, requireWire: true,
  }), { secrets: [FAKE_KEY] })
  console.log(`[image-input] 演练摘要：${written}`)
}
