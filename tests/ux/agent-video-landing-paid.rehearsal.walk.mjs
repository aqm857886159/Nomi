#!/usr/bin/env node
// 视频付费走查（agent-video-landing.paid.mjs）的 loopback 演练：**零额度、不出网**。
// 与真付费走查共用同一份步骤本体（_agentVideoLandingSteps.mjs：接入 → 开项目 → Agent 出卡 → 核草稿是最便宜那一档 →
// 点生成 → 片子落节点 → 任务面板 → 英文 + 重开），不抄第二份；差别只在三处：
//   ① 凭据是一把假 key，APIMart 的地址被重定向到本机夹具，接入页真的走（含项目库页上接入那一步——2026-10-18 真走查就死在这一步）；
//   ② 大脑是夹具里写好的剧本（起草一镜 Seedance 2.0 fast · 480p · 4 秒 · 无音频，再调 generate）；
//   ③ 供应商是夹具：假 Seedance 的提交 / 查询 / 出片，片子压在门口，先证「观察窗过了 Nomi 还在问、没有再交一次」，再放行。
// 它证的是「真付费走查的脚本走得通、读数读得出、判据判得对」，不证模型自己会不会写对那一档（那只有真付费能证）。
// 放行名单清空：就算哪一层没重定向，真请求也会被走查闸当场挡下（不是悄悄出网）。
import { expect } from './_assert.mjs'
import { BRAIN, VIDEO } from './_agentVideoPaid.mjs'
import { OBSERVATION_WINDOW_MS, runAgentVideoLanding } from './_agentVideoLandingSteps.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import { createRuntimeWalk, hasToolResult } from './agent-runtime-walk-support.mjs'

// 干净装机那一档（内置目录没有价目）：付费卡照样能确认，花费由供应商结算——夹具出站只认回环，一分钱不花。
process.env.NOMI_WALK_UNPRICED_MODEL = '1'
process.env.NOMI_POLL_TIMEOUT_MS = String(OBSERVATION_WINDOW_MS)

const FAKE_KEY = 'rehearsal-fake-key-0123456789abcdef'
const DRAFT_CALL = 'rh-video-1'
const GENERATE_CALL = `${DRAFT_CALL}-generate`
const lastUserText = (body) => flattenRequestText({ messages: (body.messages ?? []).filter((message) => message.role === 'user').slice(-1) })

const REVISED_CALL = `${DRAFT_CALL}-revised`
const toolResultText = (body, callId) => String((body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === callId)?.content ?? '')
const operationIdOf = (text) => /"operationId":"([^"]+)"/.exec(text)?.[1]

/**
 * 剧本大脑：起草一镜被授权的那一档 → 调 generate（等人在付费卡上点确认）→ 收尾。
 *
 * 它演的是**模型的坏习惯 + 收到拒绝后的反应**（2026-10-18 两次真走查）：
 *  · 第一回合把可选参数写成 null（`seed: null`），还把变体塞进 parameters（`variant: 'fast'`）；
 *  · 起草校验会拒掉 `variant`。大脑**只读工具结果的文本**：文本里指了路（「放到 draft 的 variantId 字段」）它就改成
 *    `variantId` 再交；文本里没指路它就停下、不再调用——和真 Agent 一样（修前通用的那句「Do not repeat an unknown paid
 *    submission」正是让它停在报错卡上）。夹具大脑以前从不对报错做反应，所以这一类缺陷免费演练永远抓不到。
 */
function installBrain(fixture) {
  const shot = (extra, parameters) => ({
    title: '纸船', prompt: '一只纸船在雨后的水洼里慢慢漂，清晨的光', taskKind: 'text_to_video',
    // 模型名只点到目录里的 `doubao-seedance-2.0`（Fast 变体由宿主认）。
    model: `${VIDEO.modelKey}@${VIDEO.vendorKey}`, ...extra, parameters,
  })
  const base = { duration: 4, resolution: '480p', size: '16:9', generate_audio: false, seed: null }
  fixture.respond({
    label: 'rehearsal brain · bad habits (seed:null, variant in parameters), self-corrects from the tool result, then generate',
    match: (body) => lastUserText(body).includes('纸船在雨后的水洼里'),
    reply: (body) => {
      if (!hasToolResult(body, DRAFT_CALL)) {
        return { type: 'tool', id: DRAFT_CALL, name: 'draft_shots', args: { shots: [shot({}, { ...base, /* walkthrough-tool-args: intentional-bad-key variant — 故意交一份坏草稿：真模型就把变体写进 parameters，这里演它收到拒绝后能不能自纠 */ variant: 'fast' })] } }
      }
      let drafted = toolResultText(body, DRAFT_CALL)
      if (!operationIdOf(drafted)) {
        // 被拒了：只凭工具结果里写的话改。结果里写着「别重复提交」（修前通用的那句 Next）、或没指路，就停下——真 Agent 就是这样停在报错卡上的。
        if (/Do not repeat/.test(drafted) || !/variantId/.test(drafted)) return { type: 'text', text: '这一步我做不下去了。' }
        if (!hasToolResult(body, REVISED_CALL)) {
          return { type: 'tool', id: REVISED_CALL, name: 'draft_shots', args: { shots: [shot({ variantId: 'fast' }, base)] } }
        }
        drafted = toolResultText(body, REVISED_CALL)
      }
      if (!hasToolResult(body, GENERATE_CALL)) {
        return { type: 'tool', id: GENERATE_CALL, name: 'generate', args: { operationId: operationIdOf(drafted) } }
      }
      return { type: 'text', text: '已经开始生成。' }
    },
  })
}

const paid = await openPaidWalk('agent-video-landing-paid.rehearsal.walk.mjs', 'agent-video-landing-rehearsal', [BRAIN, VIDEO], {
  env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: FAKE_KEY },
  // trustFixtureOrigin：卡上「生成」交给画布那一台，画布要从本机夹具取回成片，产品出站策略默认拒 127.0.0.1（未打包构建里按精确 origin 放行）。
  createWalk: (name, options) => createRuntimeWalk(name, {
    ...options, generationProvider: 'apimart', seedApimartKey: false, trustFixtureOrigin: true, env: { ...options.env, NOMI_WALK_ALLOW_ORIGINS: '' },
  }),
})
const { walk } = paid
let failure
try {
  installBrain(walk.fixture)
  const { win } = await walk.start({ first: true })
  await runAgentVideoLanding({
    paid, win, realMedia: false,
    duringObservation: async () => {
      const { fixture } = walk
      // 供应商收到了这一笔，而且只收到一笔；片子压在门口，观察窗（OBSERVATION_WINDOW_MS）过了 Nomi 还在查、没有再交一次。
      await expect.poll(() => fixture.videos.length, { message: '确认之后供应商真的收到了视频生成请求', timeout: stationTimeout({ operations: 4 }) }).toBe(1)
      const pollsFirst = await expect.poll(() => fixture.videoTaskPolls()[0] ?? 0, { timeout: stationTimeout({ operations: 4 }) }).toBeGreaterThan(0).then(() => fixture.videoTaskPolls()[0])
      await expect.poll(() => fixture.videoTaskPolls()[0] ?? 0, {
        message: `观察窗（${OBSERVATION_WINDOW_MS}ms）过了之后 Nomi 还在查询这笔任务`, timeout: stationTimeout({ operations: 4 }),
      }).toBeGreaterThan(pollsFirst + 2)
      expect(fixture.videos, '只查不交：同一笔钱没有被再提交一次').toHaveLength(1)
      fixture.releaseVideos()
    },
  })
  expect(walk.report.observationWindowExercised, '演练里压着出片，观察窗必然过过').toBe(true)
  expect(walk.fixture.videos, '整条路上供应商只收到一笔提交').toHaveLength(1)
  walk.report.paidCalls = 0
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
