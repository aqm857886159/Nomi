#!/usr/bin/env node
// 「Agent 接着说下一句时，付费卡只摆还没定的镜」付费走查（agent-shot-scope-real.paid.mjs）的零额度演练：
// 真 Electron、真 IPC、真 Agent lane、真付费卡；模型和供应商都是本机夹具（放行名单清空，真请求会被走查闸当场挡下），一分钱不花。
// 与真付费走查共用同一份步骤（_agentShotScopeSteps.mjs）和判分（_agentShotScopeScore.mjs），不抄第二份；差别只在三处：
//   ① 凭据是一把假 key，APIMart 的地址被重定向到本机夹具，接入页真的走；
//   ② 大脑是夹具里写好剧本的那个：按 8 个回合的量具表出工具调用。T5 走「先不点名 → 被拒 → 再点名」那条路，把拒绝分支真跑一遍；
//      T8 先试「往同一份草稿里补一镜」（画布草稿没有这条路，宿主拒），再按拒绝正文另起一份新草稿；
//   ③ 供应商是夹具：「供应商几个任务」读夹具里收到的图片创建请求数。
// 它证的是「真付费走查的脚本走得通、读数读得出、硬断言判得对、打分打得对」，不证真模型自己会不会写对（那只有真付费能证）。
// 演练要求：硬断言全过，打分 8/8，T5 走拒绝那条路，整场供应商只收到一次。
import { expect } from './_assert.mjs'
import { BRAIN } from './_agentVideoPaid.mjs'
import { GENERATE, TURNS } from './_agentShotScopeScore.mjs'
import { runShotScopeJourney, shotScopeEvidence, writeShotScopeEvidence } from './_agentShotScopeSteps.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import { createRuntimeWalk, toolNames } from './agent-runtime-walk-support.mjs'

// 干净装机那一档（内置目录没有价目）：付费卡照样能确认，花费由供应商结算——夹具出站只认回环，一分钱不花。
process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const SCRIPT = 'agent-shot-scope-real.rehearsal.walk.mjs'
const FAKE_KEY = 'rehearsal-fake-key-0123456789abcdef'
const IMAGE = { vendorKey: 'apimart', modelKey: 'gemini-3.1-flash-image-preview' }
const SHOT_SCOPE_BUILD_MARKER = 'call generate again with shotIds naming them'
const CANDIDATE = { providerId: IMAGE.vendorKey, modelId: IMAGE.modelKey }
const startedAt = new Date().toISOString()

// ── 剧本大脑 ───────────────────────────────────────────────────────────────────
// 只看请求里的对话（每次请求都带着整段历史），不存状态：当前是哪个回合 = 最近一次「用户说的话」；那一回合的剧本走到哪一步 =
// 它的每个调用 id 有没有已经出现在历史里。卡待决时用户打的字不是新的 user 消息，而是 generate 的工具结果里那句 `the user wrote: "…"`。

/** 最长的先匹配：「生成吧」是「剩下的也生成吧」的后缀，不能让短的抢先。 */
const BY_LENGTH = [...TURNS].sort((left, right) => right.ask.length - left.ask.length)
const turnOfText = (text) => BY_LENGTH.find((turn) => text.includes(turn.ask))?.id
const QUOTED = /the user wrote: \\?"([\s\S]*?)\\?"\. That is his answer/
const SAID_JSON = /"userSaid":("(?:[^"\\]|\\.)*")/

function currentTurn(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user') {
      const turn = turnOfText(flattenRequestText({ messages: [message] }))
      if (turn) return turn
    }
    if (message.role === 'tool') {
      const content = String(message.content ?? '')
      const said = QUOTED.exec(content)?.[1] ?? (SAID_JSON.test(content) ? JSON.parse(SAID_JSON.exec(content)[1]) : undefined)
      const turn = said === undefined ? undefined : turnOfText(said)
      if (turn) return turn
    }
  }
  return null
}

const issuedCalls = (messages) => new Set(messages.flatMap((message) => (message.tool_calls ?? []).map((call) => call.id)))
const resultText = (messages, callId) => String(messages.find((message) => message.role === 'tool' && message.tool_call_id === callId)?.content ?? '')
const operationOf = (text) => /"operationId":"([^"]+)"/.exec(text)?.[1]
const shotsOf = (text) => [...new Set([...text.matchAll(/"shotId":"([^"]+)"/g)].map((match) => match[1]))]
const FINAL_WORDS = { T3: '好的，先不生成，卡我收起来了。', T4: '第一张已经在生成了。' }

function brainMove(body) {
  const messages = body.messages ?? []
  const turn = currentTurn(messages)
  const done = issuedCalls(messages)
  const drafted = resultText(messages, 'ss-t1-draft')
  const operationId = operationOf(drafted)
  const [first = 'shot-1', second = 'shot-2', third = 'shot-3'] = shotsOf(drafted)
  switch (turn) {
    case 'T1':
      if (!done.has('ss-t1-draft')) {
        return { type: 'tool', id: 'ss-t1-draft', name: 'draft_shots', args: { shots: [
          { title: '红纸船', prompt: '雨后水洼里漂着的红色纸船', taskKind: 'text_to_image', candidate: CANDIDATE, aspectRatio: '1:1' },
          { title: '橘猫', prompt: '窗台上晒太阳的橘猫', taskKind: 'text_to_image', candidate: CANDIDATE, aspectRatio: '1:1' },
          { title: '灯塔', prompt: '黄昏海边的灯塔', taskKind: 'text_to_image', candidate: CANDIDATE, aspectRatio: '1:1' },
        ] } }
      }
      if (!done.has('ss-t1-gen')) return { type: 'tool', id: 'ss-t1-gen', name: 'generate', args: { operationId } }
      break
    case 'T2':
      if (!done.has('ss-t2-gen')) return { type: 'tool', id: 'ss-t2-gen', name: 'generate', args: { operationId, shotIds: [third] } }
      break
    case 'T4':
      if (!done.has('ss-t4-gen')) return { type: 'tool', id: 'ss-t4-gen', name: 'generate', args: { operationId, shotIds: [first] } }
      break
    case 'T5':
      // 先不点名：这一刻卡上没剩还没定的镜（第 1 镜在生成），宿主该拒；按拒绝正文的指路，再点名剩下两镜。
      if (!done.has('ss-t5-unnamed')) return { type: 'tool', id: 'ss-t5-unnamed', name: 'generate', args: { operationId } }
      if (!done.has('ss-t5-named')) return { type: 'tool', id: 'ss-t5-named', name: 'generate', args: { operationId, shotIds: [second, third] } }
      break
    case 'T6':
      if (!done.has('ss-t6-gen')) return { type: 'tool', id: 'ss-t6-gen', name: 'generate', args: { operationId } }
      break
    case 'T7':
      if (!done.has('ss-t7-revise')) {
        return { type: 'tool', id: 'ss-t7-revise', name: 'draft_shots', args: { operationId, shots: [{ shotId: second, prompt: '窗台上晒太阳的橘猫，改成夜景：月光洒在窗台上，橘猫蜷着睡觉' }] } }
      }
      if (!done.has('ss-t7-gen')) return { type: 'tool', id: 'ss-t7-gen', name: 'generate', args: { operationId, shotIds: [second] } }
      break
    case 'T8': {
      // 先试「往同一份草稿里补一镜」（draft_shots 的说明就是这么写的）；画布草稿没有这条路，宿主拒并指路「另起一份草稿」，再照做。
      if (!done.has('ss-t8-append')) {
        return { type: 'tool', id: 'ss-t8-append', name: 'draft_shots', args: { operationId, shots: [
          { title: '结尾镜头', prompt: '黄昏海边的灯塔慢慢暗下来，海面归于平静', taskKind: 'text_to_image', candidate: CANDIDATE, aspectRatio: '1:1' },
        ] } }
      }
      const appended = resultText(messages, 'ss-t8-append')
      if (operationOf(appended)) {
        if (!done.has('ss-t8-gen')) return { type: 'tool', id: 'ss-t8-gen', name: 'generate', args: { operationId, shotIds: [shotsOf(appended).at(-1)] } }
        break
      }
      if (!done.has('ss-t8-draft')) {
        return { type: 'tool', id: 'ss-t8-draft', name: 'draft_shots', args: { shots: [
          { title: '结尾镜头', prompt: '黄昏海边的灯塔慢慢暗下来，海面归于平静', taskKind: 'text_to_image', candidate: CANDIDATE, aspectRatio: '1:1' },
        ] } }
      }
      const fresh = resultText(messages, 'ss-t8-draft')
      if (!done.has('ss-t8-gen')) return { type: 'tool', id: 'ss-t8-gen', name: 'generate', args: { operationId: operationOf(fresh), shotIds: [shotsOf(fresh)[0] ?? 'shot-1'] } }
      break
    }
    default:
      break
  }
  return { type: 'text', text: FINAL_WORDS[turn] ?? '好的。' }
}

function installShotScopeBrain(fixture) {
  fixture.respond({
    label: 'rehearsal brain · shot scope script (8 turns)',
    match: (body) => toolNames(body).includes(GENERATE) && currentTurn(body.messages ?? []) !== null,
    reply: (body) => brainMove(body),
  })
  fixture.respond({ label: 'rehearsal fallback · non-brain text call', match: () => true, reply: { type: 'text', text: '好的。' } })
}

const paid = await openPaidWalk(SCRIPT, 'agent-shot-scope-rehearsal', [BRAIN, IMAGE], {
  env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: FAKE_KEY },
  buildMarkers: [SHOT_SCOPE_BUILD_MARKER],
  // trustFixtureOrigin：卡上「生成」交给画布那一台，画布要从本机夹具取回成图，产品出站策略默认拒 127.0.0.1（未打包构建里按精确 origin 放行）。
  createWalk: (name, options) => createRuntimeWalk(name, {
    ...options, generationProvider: 'apimart', seedApimartKey: false, trustFixtureOrigin: true, env: { ...options.env, NOMI_WALK_ALLOW_ORIGINS: '' },
  }),
})
const { walk } = paid
installShotScopeBrain(walk.fixture)
const journey = { turns: [] }
let failure
try {
  await runShotScopeJourney(journey, {
    walk, paid, image: IMAGE, expectedModelKey: BRAIN.modelKey,
    brainLabel: () => paid.label(BRAIN.vendorKey, BRAIN.modelKey),
    vendorTasks: () => ({ creates: walk.fixture.images.length, recorderAlive: true }),
  })
  console.log(`[shot-scope] ${JSON.stringify(journey.numbers)}`)
  expect(journey.gaugeProblems, '量具本身没出错').toEqual([])
  expect(journey.hardFailures, '硬断言全过').toEqual([])
  expect(journey.numbers, '演练：打分 8/8，T5 走的是「先不点名被拒、再点名」，量具没出错').toMatchObject({
    turns: 8, toolWriteCorrect: '8/8', turnSuccess: '8/8', t5Route: 'refused-then-named', harnessErrors: 0,
  })
  expect(journey.spend, '演练：卡上批了 1 镜 = 收据 1 笔 = 供应商 1 个任务').toMatchObject({ cardApproved: 1, receiptMedia: 1, vendorTasks: 1 })
  expect(walk.fixture.images, '整场供应商只收到一次图片创建请求').toHaveLength(1)
  walk.report.paidCalls = 0
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
  const written = writeShotScopeEvidence('rehearsal/report.json', shotScopeEvidence({
    script: SCRIPT, mode: 'rehearsal（夹具剧本大脑，不是模型分数）', startedAt, journey, walk, failure,
    model: `${BRAIN.vendorKey}/${BRAIN.modelKey}（地址重定向到本机夹具）`, image: `${IMAGE.vendorKey}/${IMAGE.modelKey}（地址重定向到本机夹具）`, buildMarker: SHOT_SCOPE_BUILD_MARKER,
  }), { secrets: [FAKE_KEY] })
  console.log(`[shot-scope] 演练摘要：${written}`)
}
