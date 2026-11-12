#!/usr/bin/env node
// composer-b3-reference.paid.mjs 的 loopback 演练：**零额度、不出网**（协调真付费之前先跑它，P3「免费演练先过」）。
//   node tests/ux/composer-b3-reference-paid.rehearsal.walk.mjs
// 与真付费共用同一份步骤本体（_composerB3ReferenceSteps.mjs：布场景 → 花钱前核对（方式格 = owner、参考行 1 张在用）→ 点 ↑ →
// 确认框 → 等提交 → 等结局 → 量成片），不抄第二份；差别只在三处：
//   ① 凭据是一把假 key，APIMart 的地址被重定向到本机夹具，接入页真的走；
//   ② 供应商是夹具：假 Seedance 的上传 / 提交 / 查询 / 出片（片子先压着，提交之后放行）；
//   ③ 请求体按夹具收到的那一笔核（夹具的上传都回同一个本机地址、对不回文件名，所以按上传记录里的文件名核「只上传过那 1 张」），
//      判据是同一个纯函数 judgeModeWire；夹具收到的请求体原样打印出来——这就是真付费时将要发的那一份（地址换成了真上传的）。
// 它证的是「真付费脚本走得通、读数读得出、方式格 = owner 在真界面上判得对、请求体走 owner 那一族键」；
// 不证 APIMart 真收到了什么（那只有真付费的账本证得了）。放行名单清空：哪一层没重定向，真请求也会被走查闸当场挡下。
import { expect } from './_assert.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { COMPOSER_B3_PAID_MODELS, COMPOSER_B3_PAID_OPTIONS, judgeModeWire, runComposerB3ReferenceJourney } from './_composerB3ReferenceSteps.mjs'

const SCRIPT = 'composer-b3-reference-paid.rehearsal.walk.mjs'
const FAKE_KEY = 'rehearsal-fake-key-0123456789abcdef'

const paid = await openPaidWalk(SCRIPT, 'composer-b3-reference-rehearsal', COMPOSER_B3_PAID_MODELS, {
  ...COMPOSER_B3_PAID_OPTIONS,
  env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: FAKE_KEY },
  // trustFixtureOrigin：画布直生成要从本机夹具取回成片，产品出站策略默认拒 127.0.0.1（未打包构建里按精确 origin 放行）。
  createWalk: (name, options) => createRuntimeWalk(name, {
    ...options, generationProvider: 'apimart', seedApimartKey: false, trustFixtureOrigin: true, env: { ...options.env, NOMI_WALK_ALLOW_ORIGINS: '' },
  }),
})
const { walk } = paid
const evidence = { script: SCRIPT, mode: 'rehearsal' }
let failure
try {
  await runComposerB3ReferenceJourney({
    paid, evidence,
    onSubmitted: () => walk.fixture.releaseVideos(),
    judgeWire: ({ owner }) => judgeFixtureWire(walk.fixture, owner),
  })
  expect(evidence.verified, '花钱前核对、请求体、落地全过').toEqual(expect.arrayContaining([
    'mode-cell-equals-owner-mode', 'composer-shows-one-image-in-use-before-spend',
    'request-uses-owner-mode-family', 'one-provider-task', 'result-landed-and-probed',
  ]))
  expect(walk.fixture.videos, '整条路上供应商只收到一笔提交').toHaveLength(1)
  walk.report.paidCalls = 0
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  walk.report.journey = evidence
  await paid.finish(failure)
}

/** 夹具收到的那一笔：交给和真付费同一个判据（judgeModeWire），并把请求体原样打印出来（真付费将要发的就是这一份）。 */
function judgeFixtureWire(fixture, owner) {
  const creates = fixture.videos
  const body = creates[0]?.body ?? null
  if (!judgeFixtureWire.printed && body) {
    judgeFixtureWire.printed = true
    console.log(`[rehearsal] 将要发的请求体（夹具收到的那一笔；owner 算的方式 ${owner.modeId}）：\n${JSON.stringify(body, null, 2)}`)
  }
  const uploadedUrls = new Set(fixture.uploads.map((record) => record.uploadUrl).filter(Boolean))
  const uploadedFiles = fixture.uploads.flatMap((record) => record.uploadFileNames ?? [])
  const names = [...new Set(uploadedFiles)]
  // 夹具的上传都回同一个地址：只有恰好上传过一个文件时，「来自上传的地址」才对得回文件名。
  const fileOfSent = (url) => (uploadedUrls.has(url) && names.length === 1 ? names[0] : null)
  const verdict = judgeModeWire(body, { owner, uploadedFiles, fileOfSent })
  if (creates.length !== 1) verdict.problems.unshift(`夹具收到的视频创建请求有 ${creates.length} 次（应恰好 1 次）`)
  return { problems: verdict.problems, summary: { ...verdict.summary, createRequests: creates.length, problems: verdict.problems } }
}
