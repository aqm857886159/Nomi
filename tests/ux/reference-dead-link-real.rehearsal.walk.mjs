#!/usr/bin/env node
// reference-dead-link-real.paid.mjs 的 loopback 演练：**零额度、不出网**（协调真付费之前先跑它，P3「免费演练先过」）。
//   pnpm build
//   node tests/ux/reference-dead-link-real.rehearsal.walk.mjs
// 与真付费共用同一份步骤本体（_referenceDeadLinkSteps.mjs：布参考图 → 改它旁边的 .meta 成一条失效的服务商临时链接 → 点生成 →
// 等结局 → 核请求），不抄第二份；差别只在三处：
//   ① 凭据是一把假 key，APIMart 的地址被重定向到本机夹具，接入页真的走；
//   ② 供应商是夹具：假的出图 / 上传 / 查询；那条"失效链接"是夹具上的 /fixture/dead-reference.png（回 410）；
//   ③ 请求按夹具收到的那几笔核（真付费按网络闸账本核）。
// 它证的是「真付费脚本走得通、读数读得出、界面核对在真界面上判得对」；不证 APIMart 真收到了什么（那只有真付费的账本证得了）。
// 真付费那一档不包含"模型拒绝 → 新卡 → 重试"（真供应商不会按我们的意愿拒绝）——那一段在 reference-dead-link.walk.mjs 里。
import { expect } from './_assert.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import {
  REFERENCE_DEAD_LINK_PAID_MODELS, REFERENCE_DEAD_LINK_PAID_OPTIONS, observeFixture, runReferenceDeadLinkJourney,
} from './_referenceDeadLinkSteps.mjs'

const SCRIPT = 'reference-dead-link-real.rehearsal.walk.mjs'
const FAKE_KEY = 'rehearsal-fake-key-0123456789abcdef'

const paid = await openPaidWalk(SCRIPT, 'reference-dead-link-rehearsal', REFERENCE_DEAD_LINK_PAID_MODELS, {
  ...REFERENCE_DEAD_LINK_PAID_OPTIONS,
  env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: FAKE_KEY },
  createWalk: (name, options) => createRuntimeWalk(name, {
    ...options, generationProvider: 'apimart', seedApimartKey: false, trustFixtureOrigin: true, env: { ...options.env, NOMI_WALK_ALLOW_ORIGINS: '' },
  }),
})
const { walk } = paid
const evidence = { script: SCRIPT, mode: 'rehearsal' }
let failure
try {
  await runReferenceDeadLinkJourney({
    paid, evidence, locales: ['zh-CN'],
    links: { dead: `${walk.fixture.baseURL}/fixture/dead-reference.png` },
    observe: () => observeFixture(walk.fixture),
  })
  expect(evidence.verified, '失效链接换成上传后的新链接、直接出结果').toEqual(expect.arrayContaining(['dead-link-sends-uploaded-link', 'dead-link-lands-with-no-new-element']))
  expect(walk.fixture.images, '整条路上供应商只收到一笔创建请求').toHaveLength(1)
  expect(walk.fixture.uploads, '整条路上只上传过一次').toHaveLength(1)
  walk.report.paidCalls = 0
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  walk.report.journey = evidence
  await paid.finish(failure)
}
