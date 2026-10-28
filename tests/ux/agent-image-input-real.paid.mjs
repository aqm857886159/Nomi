#!/usr/bin/env node
// 真付费 + 真模型 · Agent 附图交给「自配、没声明读图能力」的模型（PR #1346 的真实核对）：图真的到了真后端，模型按图作答。
//
//   pnpm build && NOMI_REAL_MEDIA_DIR="/Users/aoqimin/Desktop/视频/" NOMI_SPEND_OK=1 node tests/ux/agent-image-input-real.paid.mjs
//
// 先跑零花费演练 agent-image-input-real.rehearsal.walk.mjs（同一份步骤，夹具大脑），过了再跑这条。
// 为什么要它：#1346 把「这个文本模型能不能读图」改成只认声明——自配、没声明的行是「不知道」，Agent 照发图，让真后端说话。
// 本机回环测试证了请求体里有图；但「真后端收得下、真模型按图作答、真实大小的图不被拒不被截断」只有真 App + 真模型才量得到。
// 两轮，每轮新对话、各一句：
//   ① 看得见：附一张每次现生成、带随机暗号的点阵图，问「图里写的暗号是什么？只回暗号」。回答里有这次的暗号 = 像素到了模型手里。
//   ② 真尺寸：附登记真素材 image-4k-png（4K 视频抽一帧），问「用一句话说这张图里有什么」。没走错误面、有非空回答 = 没被后端拒、没被截断。
//      这一帧是登记表取法的原样产物：16 位 PNG、约 29.7 MB（比同尺寸的 8 位图大一倍），整份 base64 内联进那一次请求（约 40 MB）。
//      产品的 Agent 附件上限（mediaImportPolicy 的 agent-composer 面，30 MiB）放得下它，供应商的单图 / 单请求体积上限未必——被拒就是这一轮要量到的东西，不是走查坏了。
// 模型是走真接入页手填的：给 APIMart 手填一个模型 id（MODEL_ID，见 _agentImageInputScore.mjs 里选它的理由）。这一行自配、
// 没声明能力、不是内置种子，用产品自己的判据当场核对落在「不知道」档；不在这一档就停，不换成别的档硬跑。
// 只花这一个文本模型的 token：不授权任何生成模型（openPaidWalk 把别的生成模型一律停用），权限档钉在「请求批准」，走查看到任何卡只按停止。
// BRAIN 这一行只是把 APIMart 供应商与它的密文从真实目录带进隔离副本（真实目录里没有的行点不了名），整场不对它发请求；真正答话的是手填的那一行。
// 凭据与原库保护见 _paidRun.mjs / _realProfile.mjs：从真实资料目录拷密文进隔离副本、不读 key、跑完删凭据副本、
// 原库指纹跑前跑后比对；产物里找不到本次修复的标记字面量就拒跑，一分钱不花。
// 红的判据：量具出问题 / 手填的行不在「不知道」档 / 请求体里读到图被丢的确凿证据 / 第 1 轮没认出暗号 / 第 2 轮走了错误面或空回答。
// 第 1 轮没认出暗号有两种可能（图没到，或模型读不准点阵字）——证据里有请求体前缀、回答原文与用量，由人判。
// 证据摘要：docs/evidence/2026-10-27-vision-capability-declared/paid/report.json（落盘前查 key）；
// 截图与完整走查报告在 .tmp/pi-agent-image-input-real-*/。
import { BRAIN } from './_agentVideoPaid.mjs'
import { MODEL_ID, imageInputEvidence, journeyFailures, netLogWireProbe } from './_agentImageInputScore.mjs'
import { prepareImages, runImageInputJourney, writeImageInputEvidence } from './_agentImageInputSteps.mjs'
import { openPaidWalk } from './_paidRun.mjs'

const SCRIPT = 'agent-image-input-real.paid.mjs'
// 本次改动在同一提交里新加的拒绝签名（electron/video/deconstructVisionLeg.ts），origin/main 上没有。Agent 这条路上本次没有新增任何运行时字面量。
const BUILD_MARKER = 'Model does not accept image input:'
// 备用：默认那一行在 APIMart 上 404 时换一个同样不撞旧正则、也不是种子行的 id（如 gpt-5.1）重跑。换了 id 也要过「不知道」档核对。
const MODEL = process.env.NOMI_IMAGE_INPUT_MODEL || MODEL_ID
if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(MODEL)) throw new Error(`NOMI_IMAGE_INPUT_MODEL 形状不对：${JSON.stringify(MODEL)}`)
const startedAt = new Date().toISOString()

// 备料先于一切：缺 NOMI_REAL_MEDIA_DIR / 缺素材 / 缺 ffmpeg 就在拷任何凭据之前红。
const images = prepareImages()
const paid = await openPaidWalk(SCRIPT, 'agent-image-input-real', [BRAIN], { buildMarkers: [BUILD_MARKER], recordAllowedBodies: true })
const { walk } = paid
const journey = { rounds: [] }
let failure
try {
  await runImageInputJourney(journey, { walk, paid, images, modelId: MODEL, wireProbe: netLogWireProbe(paid) })
  walk.report.numbers = journey.numbers
  console.log(`[image-input] ${JSON.stringify(journey.numbers)}`)
  const failures = journeyFailures(journey)
  if (failures.length) throw new Error(`这一场有红：\n  ${failures.join('\n  ')}`)
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
  const written = writeImageInputEvidence('paid/report.json', imageInputEvidence({
    script: SCRIPT, mode: 'paid', startedAt, journey, walk, failure, images, buildMarker: BUILD_MARKER, model: `apimart/${MODEL}`,
  }))
  console.log(`[image-input] 证据摘要：${written}`)
}
