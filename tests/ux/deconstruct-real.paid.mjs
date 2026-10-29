#!/usr/bin/env node
// 真付费走查 · 拆解「点取消 + 整片拆完」（设计卡 docs/plan/2026-10-27-deconstruct-cancel.md ★9 D2；取代原先那条付费拆解 e2e，旧脚本已删）。
//
//   pnpm build && NOMI_SPEND_OK=1 node tests/ux/deconstruct-real.paid.mjs
//
// 先跑零花费演练 deconstruct-real.rehearsal.walk.mjs（同一份步骤与判分，夹具读图模型），过了再跑这条。
// 为什么要它：拆解点了「取消拆解」，主进程要真的不再发新的付费调用（电脑上的单测用替身证了编排与付费闸，证不了真供应商一侧的账）。
// 这条走查让 App 里接好的真读图模型真拆一条 8 镜的片子：读图并发 4，**第一镜读完那一刻点取消**，然后量三件事——
//   ① 主进程日志出现 deconstruct.cancelled（修前不存在：构建标记，产物里找不到就拒跑，一分钱不花）；
//   ② 取消收尾之后再等满 60 秒，出站付费调用数一次不再涨；
//   ③ 出站收据（App 真正发出的付费请求数）= 日志里「已过付费闸」的行数（sentOrUnknown）。
// 再在同一张表上点「拆解」整片拆完，判旧付费 e2e 那一套质量（镜号连续、区间首尾相接盖到片尾、每镜有画面描述与景别与原片帧、失败镜诚实回报）。
//
// 片子：从登记的真素材（video-canvas-follow-hand-1080p15）里切 8 段、首尾相接，无音轨（不碰转写，也就不碰本机转写）；为什么不直接用整条 15 秒写在 _deconstructRealScore.mjs 的「场景定义」。
// 授权：只授权一个读图模型（APIMart 的 gemini-3.5-flash），不授权任何生成模型，不起草、不生成、不改别的画布内容。
// 凭据与原库保护见 _paidRun.mjs / _realProfile.mjs：缺省从真实资料目录拷密文进隔离副本、不读 key、跑完删凭据副本、原库指纹跑前跑后比对；
// 设了 APIMART_API_KEY 则走可见接入页装 key、跑完整个隔离副本删除（_paidEnvKey.mjs）。出网只放行被授权的那一家，被挡当场失败。
//
// 预计花费（只记次数）：场景 1 读图 4–6 次（取消那一刻已发出去的照常回来、照常结算；没发的不发），场景 2 读图 8 次，合计 ≤ 16 次，每次 3 帧同一次请求；
// 出站计数每个场景都盯着，越过「一镜一次」的上限当场停。
// 证据：.tmp/pi-deconstruct-real-*/（report.json 里的 deconstructReal 字段 = 量具读数与逐条判据；app-logs/ 里是主进程日志副本，key 已打码；截图）。
import { openPaidWalk } from './_paidRun.mjs'
import { deconstructEvidence, runDeconstructJourney } from './_deconstructRealSteps.mjs'
import { describeVerdict } from './_deconstructRealScore.mjs'

const SCRIPT = 'deconstruct-real.paid.mjs'
// 付费走查要验的修复在产物里的字面量：主进程日志事件名（修前不存在，会原样进产物；函数名会被压缩，不能当标记）。
const CANCEL_BUILD_MARKER = 'deconstruct.cancelled'
// 被授权的读图模型：APIMart 上「看得见的那个」（electron/catalog/apimartTexts.ts，R5 实测活着、认 image_url 多模态 part）。
const VISION_MODEL = { vendorKey: 'apimart', modelKey: 'gemini-3.5-flash' }

const startedAt = new Date().toISOString()
const paid = await openPaidWalk(SCRIPT, 'deconstruct-real', [VISION_MODEL], { buildMarkers: [CANCEL_BUILD_MARKER] })
const { walk } = paid
const journey = {}
let failure
try {
  await runDeconstructJourney(journey, { walk, modelLabel: () => paid.label(VISION_MODEL.vendorKey, VISION_MODEL.modelKey) })
  walk.report.numbers = journey.receipt
  console.log(`[deconstruct-real] 出站收据 ${JSON.stringify(journey.receipt)}（只记次数）`)
  // 量具问题 = 这一场没证明任何事（取消来得太晚、镜数不够……）：不是产品红，但数不能用，要明着说；两样都有就两样都说。
  const problems = [
    ...(journey.gaugeProblems.length ? [`量具有问题，这一场的数不能用：\n  ${journey.gaugeProblems.join('\n  ')}`] : []),
    ...(journey.productFailures.length ? [`产品判据没过：\n  ${journey.productFailures.join('\n  ')}`] : []),
  ]
  if (problems.length) throw new Error(`${problems.join('\n')}\n${Object.entries(journey.scenarios).map(([name, scenario]) => describeVerdict(name, scenario.verdict)).join('\n')}`)
} catch (error) {
  failure = error
  process.exitCode = 1
  console.error('[deconstruct-real] 走查失败：', error instanceof Error ? error.message : String(error))
} finally {
  walk.report.deconstructReal = deconstructEvidence({ script: SCRIPT, mode: `paid（真读图模型，开始于 ${startedAt}）`, journey, failure })
  await paid.finish(failure)
}
