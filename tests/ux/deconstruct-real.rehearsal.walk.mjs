#!/usr/bin/env node
// 拆解「点取消 + 整片拆完」的零花费演练（设计卡 docs/plan/2026-10-27-deconstruct-cancel.md ★9 D1）：
// 真 Electron、真 IPC、真拆解编排、真 ffmpeg、真主进程日志；只有读图那个「远端模型」是本机回环夹具（零额度、不出网）。
//
//   pnpm build && node tests/ux/deconstruct-real.rehearsal.walk.mjs
//
// 与真付费走查 deconstruct-real.paid.mjs 跑同一份步骤（_deconstructRealSteps.mjs）、同一份判分（_deconstructRealScore.mjs）；
// 开头同样走 openPaidWalk（假 key 经可见接入页装进去、目录里的 apimart 读图模型地址指到本机夹具），连「产物里有被验修复的标记」那道拒跑闸也一并演练。
// 夹具照剧本回话（演练独有的是**节奏**，判分不因此放宽）：
//   场景 1 · 读图并发起跑后，每个读图的应答都先压住；走查拍完「点取消前」那张图，才放第一个回来 → 点取消 → 拍「点取消后」那张图 →
//          再放开压着的几个（取消那一刻已发出去的照常回来）；
//   场景 2 · 压着的应答全部放开后，剩下的读图一律立刻回。
import { expect } from './_assert.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { FASTCUT_PIECES, describeVerdict } from './_deconstructRealScore.mjs'
import { deconstructEvidence, runDeconstructJourney } from './_deconstructRealSteps.mjs'

const SCRIPT = 'deconstruct-real.rehearsal.walk.mjs'
const FAKE_KEY = 'rehearsal-fake-key-0123456789abcdef'
// 付费走查要验的修复在产物里的字面量：主进程日志事件名（修前不存在，会原样进产物；函数名会被压缩，不能当标记）。
const CANCEL_BUILD_MARKER = 'deconstruct.cancelled'
// 被授权的读图模型：APIMart 上「看得见的那个」（electron/catalog/apimartTexts.ts）；演练里它的地址指到本机夹具。
const VISION_MODEL = { vendorKey: 'apimart', modelKey: 'gemini-3.5-flash' }
const READ_JSON = JSON.stringify({ shotSize: '中景', mood: '紧张', visual: '店员站在货架前低头看着手里的东西', onScreenText: '', imagePrompt: 'a clerk in a convenience store', motionPrompt: 'slow push in' })
const READ_REPLY = { type: 'text', text: READ_JSON }

/** 夹具的应答节奏（见文件头）：返回给步骤的四个钩子。 */
function installReads(fixture) {
  const isRead = (body) => flattenRequestText(body).includes('shotSize')
  const held = []
  fixture.respond({ label: 'deconstruct read · answers at once', match: isRead, reply: READ_REPLY })
  return {
    beforeCancelRun() {
      for (let n = 1; n <= FASTCUT_PIECES.length; n += 1) held.push(fixture.expectText({ label: `deconstruct read #${n} · held`, match: isRead, reply: { type: 'hold' } }))
    },
    async firstReadMayComplete() {
      await held[0].received
      held[0].release(READ_REPLY)
    },
    afterCancel() {
      // 包括还没到的：场景 2 起头的读图撞上它们时立刻有回话，不会被压住。
      for (const entry of held.slice(1)) entry.release(READ_REPLY)
    },
  }
}

const startedAt = new Date().toISOString()
const paid = await openPaidWalk(SCRIPT, 'deconstruct-real-rehearsal', [VISION_MODEL], {
  env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: FAKE_KEY },
  buildMarkers: [CANCEL_BUILD_MARKER],
  createWalk: (name, options) => createRuntimeWalk(name, {
    ...options, generationProvider: 'apimart', seedApimartKey: false, env: { ...options.env, NOMI_WALK_ALLOW_ORIGINS: '' },
  }),
})
const { walk } = paid
const control = installReads(walk.fixture)
const journey = {}
let failure
try {
  await runDeconstructJourney(journey, {
    walk, control, fixture: walk.fixture, modelLabel: () => paid.label(VISION_MODEL.vendorKey, VISION_MODEL.modelKey),
  })
  expect(journey.gaugeProblems, '量具本身没出问题（取消来得及拦下东西、计数器看得见请求）').toEqual([])
  expect(journey.productFailures, '两个场景的判据逐条都过').toEqual([])
  console.log(`\n[deconstruct-real] 演练通过：${describeVerdict('场景 1 · 取消', journey.scenarios.cancel.verdict).split('\n')[0]}；${describeVerdict('场景 2 · 整片拆完', journey.scenarios.full.verdict).split('\n')[0]}`)
} catch (error) {
  failure = error
  process.exitCode = 1
  console.error('[deconstruct-real] 演练失败：', error instanceof Error ? error.message : String(error))
} finally {
  walk.report.deconstructReal = deconstructEvidence({ script: SCRIPT, mode: `rehearsal（回环夹具，开始于 ${startedAt}）`, journey, failure })
  await paid.finish(failure)
}
