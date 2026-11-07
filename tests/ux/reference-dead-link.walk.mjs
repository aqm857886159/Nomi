#!/usr/bin/env node
// 参考素材的临时链接失效后改用本机文件 · **零花费走查**（中英两轨，本机夹具，不出网、不要 key）。
//   pnpm build
//   node tests/ux/reference-dead-link.walk.mjs
// 设计卡 docs/plan/2026-11-01-reference-link-delivery.md ★9「走查（中英）」。协调亲眼看截图（输出目录在 .tmp/pi-reference-dead-link-*/）。
// 步骤本体在 _referenceDeadLinkSteps.mjs（真付费脚本和它的演练用的是同一份），差别只在：这里中英各走一遍，并且夹具被安排成会拒绝一次。
//   A. 参考图的 .meta 里存着一条已经失效的服务商临时链接（夹具回 410）→ 点生成 → 供应商恰收一笔创建请求、恰收一次上传，
//      请求里是上传后的新链接，出结果，界面上没有任何新元素（没有错误卡）；
//   B. 另一张参考图的 .meta 里是一条还活着的链接 → 第一次照发，夹具回「An input media URL could not be fetched (403/404/410).」→
//      看到新卡「模型取不到参考图」（中 / 英标题与说明逐字来自词典），主按钮「重试」、没有"换个模型" → 点重试 →
//      第二笔创建请求带的是上传后的新链接 → 出结果。两笔创建请求、一次上传。
// 凭据是一把假 key，APIMart 的地址被重定向到本机夹具，接入页真的走（同 composer-b3-reference-paid.rehearsal.walk.mjs）。放行名单清空：哪一层没重定向，真请求也会被走查闸当场挡下。
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import {
  REFERENCE_DEAD_LINK_PAID_MODELS, REFERENCE_DEAD_LINK_PAID_OPTIONS, REFUSAL_TEXT, observeFixture, runReferenceDeadLinkJourney,
} from './_referenceDeadLinkSteps.mjs'

const SCRIPT = 'reference-dead-link.walk.mjs'
const FAKE_KEY = 'reference-dead-link-fake-key-0123456789'

const paid = await openPaidWalk(SCRIPT, 'reference-dead-link', REFERENCE_DEAD_LINK_PAID_MODELS, {
  ...REFERENCE_DEAD_LINK_PAID_OPTIONS,
  env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: FAKE_KEY },
  // trustFixtureOrigin：发之前的试探和画布取回成片都要访问本机夹具，产品出站策略默认拒 127.0.0.1（未打包构建里按精确 origin 放行）。
  createWalk: (name, options) => createRuntimeWalk(name, {
    ...options, generationProvider: 'apimart', seedApimartKey: false, trustFixtureOrigin: true, env: { ...options.env, NOMI_WALK_ALLOW_ORIGINS: '' },
  }),
})
const { walk } = paid
const evidence = { script: SCRIPT, mode: 'free-walk' }
let failure
try {
  const base = walk.fixture.baseURL
  let armed = false
  // 夹具只在被点名的那一次拒绝：拒绝文字是用户反馈的原话；之后的创建请求照常受理。
  walk.fixture.setMediaBehavior(({ kind }) => {
    if (kind !== 'image' || !armed) return undefined
    armed = false
    return { reject: { status: 400, json: { error: { message: REFUSAL_TEXT } } } }
  })
  await runReferenceDeadLinkJourney({
    paid, evidence, locales: ['zh-CN', 'en'],
    links: { dead: `${base}/fixture/dead-reference.png`, alive: `${base}/fixture/image.jpg` },
    observe: () => observeFixture(walk.fixture),
    refusal: { arm: () => { armed = true } },
  })
  walk.report.paidCalls = 0
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  walk.report.journey = evidence
  await paid.finish(failure)
}
