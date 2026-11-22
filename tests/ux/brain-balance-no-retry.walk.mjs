#!/usr/bin/env node
// S4 ★9 第 16 行的真窗口回放（docs/plan/2026-11-22-gen-chain-s4.md）：大脑被上游回「余额不足」时，只发一次、面板说余额不足。
//
// 形状照 new-api 的预扣模板（`i18n/locales/en.yaml:30`）：403 + `error.code: insufficient_user_quota`，正文带两个数，
// 「需要」那个数里碰巧有子串 `500`——pi 的重试判据（`pi-ai/dist/utils/retry.js`）按文字认 `500`、没有词边界，
// 于是改之前它被当成「服务器出错、可重试」，同一句话再发 3 次；面板按 403 说成「API Key 无效」。
//
// 真 Electron、真主进程大脑路（lane），对话模型是内置 APIMart 的 DeepSeek V4 Flash：APIMart 的地址经产品闸的测试改道
// （NOMI_TEST_NETWORK_REDIRECTS）指到本机夹具，不出网、不花钱，夹具的请求日志就是证据。
// 先跑金丝雀：同一条路正常回一句话，夹具收到 1 次、面板出现那句话——证明改道、计数、面板三样都是真的，再看余额那一轮。
//
// 用法：node tests/ux/brain-balance-no-retry.walk.mjs（先 `pnpm run build`）。改之前跑 = 红（4 次 / 说成 Key 无效），证据在报告里。
import { expect } from './_assert.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CREATION_PANEL, ERROR_BAR, chooseAssistantModel, createRuntimeWalk, recorded, sendCreation, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'
import { switchAppLocale } from './_permissionTiersPaidSteps.mjs'
import { uiText } from './full-walk/invariants.mjs'

const BRAIN_MODEL = 'deepseek-v4-flash'
const BRAIN_LABEL = 'DeepSeek V4 Flash'
const CANARY = 'S4_CANARY：只回一句话。'
const CANARY_REPLY = 'S4_CANARY_OK'
const ASK = 'S4_BALANCE：再回一句话。'
// new-api 预扣模板原样（金额符是 new-api 自己的全角符，单位随站点设置）；「需要」0.015000 里有子串 500。
const NEW_API_PRE_CONSUME = {
  error: {
    message: 'Not enough quota to pre-consume for this request: ＄0.004000 remaining, ＄0.015000 required',
    type: 'new_api_error', param: '', code: 'insufficient_user_quota',
  },
}

/** 这一次请求是在答哪一句：只看**最后一条**用户消息（第二轮的请求体里带着第一轮的历史，按全文认会被金丝雀那条先接走）。 */
function lastUserText(body) {
  const users = (body?.messages ?? []).filter((message) => message?.role === 'user')
  return users.length ? flattenRequestText({ messages: users.slice(-1) }) : ''
}

const walk = await createRuntimeWalk('brain-balance-no-retry', { generationProvider: 'apimart' })
let failure
try {
  const asked = (marker) => walk.fixture.requests.filter((record) => lastUserText(record.body).includes(marker))
  walk.fixture.respond({ label: 'canary: one plain reply', match: (body) => lastUserText(body).includes(CANARY),
    reply: { type: 'text', text: CANARY_REPLY } })
  const balance = walk.fixture.respond({ label: 'row 16: new-api 403 balance answer', match: (body) => lastUserText(body).includes(ASK),
    reply: { type: 'http-error', status: 403, json: NEW_API_PRE_CONSUME } })

  const { win } = await walk.start({ first: true })
  await walk.newProject()
  await chooseAssistantModel(win, BRAIN_LABEL, CREATION_PANEL)
  const panel = win.locator(CREATION_PANEL)

  // ── 金丝雀 ──
  await sendCreation(win, CANARY)
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: panel.getByText(CANARY_REPLY, { exact: false }).last() })
  const canary = asked(CANARY)
  walk.report.canary = { requests: canary.length, models: canary.map((record) => record.body?.model) }
  expect(canary.map((record) => record.body?.model), '金丝雀：改道到夹具的请求只有 1 次，模型是点名的那个').toEqual([BRAIN_MODEL])
  await walk.snap('01-canary')

  // ── 第 16 行 ──
  await sendCreation(win, ASK)
  let tick
  try {
    await recorded(new Promise((resolve) => {
      tick = setInterval(() => { if (balance.hits > 0) resolve() }, 100)
    }), 'row 16 request')
  } finally {
    clearInterval(tick) // 超时也要清：留着它，进程在报告写完后不退出
  }
  const errorBar = panel.locator(ERROR_BAR).last()
  await waitForV4TurnIdle(win, { panel: CREATION_PANEL, settledBy: errorBar })
  const sent = asked(ASK)
  const barText = (await errorBar.innerText()).trim()
  walk.report.row16 = { requests: sent.length, standingHits: balance.hits, errorBar: barText }
  await walk.snap('02-balance-answer')

  expect(sent.length, '余额不足只发一次：不重试').toBe(1)
  expect(barText, '面板那一行说余额不足').toContain(uiText('zh-CN', 'generationCommon.observability.error.balance.reason'))
  expect(barText, '不说成 Key 无效').not.toContain(uiText('zh-CN', 'generationCommon.observability.error.auth.reason'))

  // 英文同一态：从设置里切语言，像真人那样；同一行按英文词条重读，请求数不能因为切语言再涨。
  await switchAppLocale(win, 'en')
  const enBar = panel.locator(ERROR_BAR).last()
  await expect(enBar, '英文：面板那一行说余额不足').toContainText(uiText('en', 'generationCommon.observability.error.balance.reason'))
  const enText = (await enBar.innerText()).trim()
  walk.report.row16.errorBarEn = enText
  walk.report.row16.requestsAfterLocale = asked(ASK).length
  await walk.snap('03-balance-answer-en')
  expect(enText, '英文：不说成 Key 无效').not.toContain(uiText('en', 'generationCommon.observability.error.auth.reason'))
  expect(asked(ASK).length, '切语言后仍只有 1 次').toBe(1)
} catch (error) {
  failure = error
}
await walk.finish(failure)
