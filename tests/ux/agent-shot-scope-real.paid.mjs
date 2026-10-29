#!/usr/bin/env node
// 真付费 + 真模型数字 · 「Agent 接着说下一句时，付费卡只摆还没定的镜」（不点名的 generate 只重摆最近一张卡上还没定的镜）。
//
//   pnpm build && NOMI_SPEND_OK=1 node tests/ux/agent-shot-scope-real.paid.mjs
//
// 先跑零花费演练 agent-shot-scope-real.rehearsal.walk.mjs（同一份步骤，夹具大脑），过了再跑这条。
// 为什么要它：这次改的是 Agent 不点名再调 `generate` 时摆哪几镜；花钱对不对由宿主的确定性规则管（回环测试已钉），
// 但「宿主在真链路上照规则摆卡」「真模型读了新说明和拒绝正文之后接得住下一句、不在拒绝里打转」只有真 App + 真模型才量得到。
// 它一次做两件事：
//   ① 最小真付费抽检（三方对账）：整场对话只在第 4 回合按一次「生成」，只花 1 张图——卡上批了几镜 = 收据几笔 = 供应商几个任务，
//      都等于 1；第 8 回合之后取消卡、再等 60 秒，供应商任务数仍是 1；
//   ② 真模型数字：8 个回合各算「工具写对」「回合成功」，汇总 x/8、y/8（模型没照期望做只记分、不判红）。
// 硬断言（红了整条走查红）判的是宿主和钱：不点名的 generate 出的卡只含最近一张卡上还没定的镜、绝不含已经送出的镜；
// 一镜不剩时宿主的拒绝正文里有本次的产物标记；点名的卡 = 点名的那几镜；上面那三方对账。
//
// 场景与判分见 _agentShotScopeScore.mjs，步骤本体见 _agentShotScopeSteps.mjs（与演练同一份）。
// 授权：大脑 = App 里配好的 BRAIN（APIMart 的 DeepSeek V4 Pro）+ 图片 = APIMart 的 gemini-3.1-flash-image-preview，只授权这两个
// （与 agent-spend-per-shot-real.paid.mjs 同一张图片模型）；别的生成模型一律停用。花钱前核对要保留的那一镜：不要多张出图、只授权 1K。
// 凭据与原库保护见 _paidRun.mjs / _realProfile.mjs：从真实资料目录拷密文进隔离副本、不读 key、跑完删凭据副本、
// 原库指纹跑前跑后比对；产物里找不到本次修复的标记字面量就拒跑，一分钱不花。
// 证据摘要：docs/evidence/2026-10-27-shot-scope-undecided/paid/report.json（落盘前查 key）；
// 截图与完整走查报告在 .tmp/pi-agent-shot-scope-real-*/。
import { BRAIN } from './_agentVideoPaid.mjs'
import { countVendorImageCreates } from './_agentShotScopeScore.mjs'
import { runShotScopeJourney, shotScopeEvidence, writeShotScopeEvidence } from './_agentShotScopeSteps.mjs'
import { openPaidWalk } from './_paidRun.mjs'

const SCRIPT = 'agent-shot-scope-real.paid.mjs'
const IMAGE = { vendorKey: 'apimart', modelKey: 'gemini-3.1-flash-image-preview' }
// 本次改动新加的拒绝正文里的固定句（electron/shared/agentCapabilities/generationShotScope.ts），origin/main 上没有。
const SHOT_SCOPE_BUILD_MARKER = 'call generate again with shotIds naming them'
const APIMART_HOST = 'api.apimart.ai'
const startedAt = new Date().toISOString()

const paid = await openPaidWalk(SCRIPT, 'agent-shot-scope-real', [BRAIN, IMAGE], { buildMarkers: [SHOT_SCOPE_BUILD_MARKER], recordAllowedBodies: true })
const { walk } = paid
const journey = { turns: [] }
let failure
try {
  await runShotScopeJourney(journey, {
    walk, paid, image: IMAGE, expectedModelKey: BRAIN.modelKey,
    brainLabel: () => paid.label(BRAIN.vendorKey, BRAIN.modelKey),
    // 供应商那边收到几个图片创建请求：读网络闸账本里发往 APIMart 的 POST（recordAllowedBodies 才有；env-key 路收尾会删账本，所以要在 finish 之前读完）。
    vendorTasks: () => countVendorImageCreates(paid.readAllowedRequests(), { host: APIMART_HOST }),
  })
  walk.report.numbers = journey.numbers
  console.log(`[shot-scope] ${JSON.stringify(journey.numbers)}`)
  // 模型没照期望做是量到的数，不是走查失败；量具自己出了错（某个回合没落地、答话的不是被授权的模型）才判红，那时的数不能用。
  if (journey.gaugeProblems.length) throw new Error(`量具有问题，这一场的数不能用：\n  ${journey.gaugeProblems.join('\n  ')}`)
  if (journey.hardFailures.length) throw new Error(`硬断言红了（宿主或钱的事）：\n  ${journey.hardFailures.join('\n  ')}`)
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
  const written = writeShotScopeEvidence('paid/report.json', shotScopeEvidence({
    script: SCRIPT, mode: 'paid', startedAt, journey, walk, failure,
    model: `${BRAIN.vendorKey}/${BRAIN.modelKey}`, image: `${IMAGE.vendorKey}/${IMAGE.modelKey}`, buildMarker: SHOT_SCOPE_BUILD_MARKER,
  }))
  console.log(`[shot-scope] 证据摘要：${written}`)
}
