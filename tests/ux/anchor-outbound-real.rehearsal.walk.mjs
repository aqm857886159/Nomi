#!/usr/bin/env node
// anchor-outbound-real.paid.mjs 的 loopback 演练：**零额度、不出网**（协调真付费之前先跑它，P3「免费演练先过」）。
//   pnpm build
//   node tests/ux/anchor-outbound-real.rehearsal.walk.mjs
// 与真付费共用同一份步骤本体（_anchorOutboundSteps.mjs：开项目 → 创作区打开分镜方案 → 点参考卡「生成」→ 核请求，用户 10-29 那条路）；
// 差别只在：凭据是假 key、APIMart 地址被重定向到本机夹具、请求按夹具收到的那笔核。
// 它证的是「真付费脚本走得通、读数读得出、判据在真界面上判得对」；不证真供应商收到了什么。
import { expect } from './_assert.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import {
  ANCHOR_OUTBOUND_BUILD_OPTIONS, ANCHOR_OUTBOUND_PAID_MODELS, ANCHOR_OUTBOUND_PAID_OPTIONS, observeFixturePrompts, runAnchorOutboundJourney,
} from './_anchorOutboundSteps.mjs'

const SCRIPT = 'anchor-outbound-real.rehearsal.walk.mjs'
const FAKE_KEY = 'rehearsal-fake-key-0123456789abcdef'

const paid = await openPaidWalk(SCRIPT, 'anchor-outbound-rehearsal', ANCHOR_OUTBOUND_PAID_MODELS, {
  ...ANCHOR_OUTBOUND_PAID_OPTIONS,
  ...ANCHOR_OUTBOUND_BUILD_OPTIONS,
  env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: FAKE_KEY },
  createWalk: (name, options) => createRuntimeWalk(name, {
    ...options, generationProvider: 'apimart', seedApimartKey: false, trustFixtureOrigin: true, env: { ...options.env, NOMI_WALK_ALLOW_ORIGINS: '' },
  }),
})
const { walk } = paid
const evidence = { script: SCRIPT, mode: 'rehearsal' }
let failure
try {
  await runAnchorOutboundJourney({ paid, evidence, observe: () => observeFixturePrompts(walk.fixture) })
  expect(evidence.verified, '描述原样到了供应商、没有追加结构化特征').toEqual(expect.arrayContaining(['anchor-description-reaches-provider', 'no-structured-suffix']))
  expect(walk.fixture.images, '整条路上供应商只收到一笔创建请求').toHaveLength(1)
  walk.report.paidCalls = 0
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  walk.report.journey = evidence
  await paid.finish(failure)
}
