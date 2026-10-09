#!/usr/bin/env node
// 真实用户任务（R13）：**目录里填了价**的那一档——我让 Agent 生成一张图，卡上问我「生成这张」，
// 我按下去，账本按目录那一行的价记下，图真的落回我刚才那个节点。
// 合同 contract-moneycopy（#1099，提交 184ea8997）：界面不出 Nomi 按价目表算的金额——卡上原先印的 ¥0.30 / 合计已删，
// 这条走查只把「卡上印着金额」那几条断言换成「卡上不出金额」；有价 / 无价两档的区分、账本、出站、落图照旧断言。
//
// ── 这条走查此前为什么不存在 ────────────────────────────────────────────────────
// 夹具模式（`NOMI_E2E_PRODUCTION_FIXTURE=1`）此前把 Run 的 `policy.maxSpend` 钉成 0
// （`productionRunRuntime.ts`），于是**任何有已知价的作业都提交不了**（policy-budget-exceeded）。
// 真机上能走完整条链的只剩「算不出价」那一档。2026-09-21 用户拍板把那颗钉子拔掉
// （「规则哪里来的去哪里改，最小必要生成是允许的」）：夹具模式真正的保险是**出站只认回环**，
// 钱本来就花不出去；上限改成一个小的正数，于是「卡上显示价 → 确认 → 账本记同一价」
// 这条链第一次能在真实界面上被断言。
//
// 四条（全部是真人视角看得见的事）：
//   ① 有价这一档（data-v4-price="total"，不是「算不出」那一档）；主按钮是「生成这张」，卡上不出金额；
//   ② 按下去：供应商真的收到一次生成请求，送的就是卡上那一镜；
//   ③ **账本记的是同一个数**：盘上那份 Run 的授权信封里 `price.maximum === 0.3`，
//      `budget.unknownJobCount` 是 0（这一镜的价是知道的），预留额度也是同一个数；
//   ④ 产物真的落回草稿那一刻建的那个节点，卡收起来；一分钱没花（供应商是本机 loopback）。
//   ⑤ 英文一样（EN 串长 1.5-2 倍，截断只有眼睛看得出）。
//   ⑥ 两张一起摆（2026-10-01）：这一叠的「2 张 · 已选」印在**翻页那一行的右端**、一行放得下（金额已随合同删除）
//      （以前在动作行左边，英文挤成三行）；单位跟标题同一条规则（图片说张、英文与标题同词「2 images」）；
//      「生成剩下 2 张」在动作行最左，按钮上不再印合计；中英各拍一张。
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM,
  createRuntimeWalk, openCanvas, readProject, recorded, sendCanvas, closeSpendCard,
} from './agent-runtime-walk-support.mjs'
import { uiText } from './full-walk/invariants.mjs'

// 这条走查的前提正好与 unknown-price 那条相反：目录里**有**价目那一行。
// 在这里硬设（而不是靠调用方记得不传），免得哪天默认值翻了面，这条走查悄悄变成另一个世界。
delete process.env.NOMI_WALK_UNPRICED_MODEL

const ASK = 'S_PRICED：帮我生成一张青瓷茶杯的图。'
const PLAN_CALL = 's-priced-1'
const GENERATE_CALL = `${PLAN_CALL}-generate`
const EN_PLAN_CALL = 's-priced-en-1'
const EN_GENERATE_CALL = `${EN_PLAN_CALL}-generate`
const PRICE_TOTAL = '[data-v4-price="total"]'
const PRICE_UNAVAILABLE = '[data-v4-price="unavailable"]'
/** 目录里那一行价目的基价（`agent-runtime-fixture.mjs` 的 `APIMART_FIXTURE_PRICING`）。 */
const BASE_PRICE = 0.3

/** 盘上那份 Run 的授权信封 —— 「账本记的是同一个数」的唯一硬证据。 */
function readRunEnvelope(projectRoot, runId) {
  const snapshot = path.join(projectRoot, '.nomi', 'runs', runId, 'run.json')
  if (!fs.existsSync(snapshot)) return null
  const run = JSON.parse(fs.readFileSync(snapshot, 'utf8')).run
  return {
    state: run?.generationPlan?.state, envelope: run?.gates?.filter((gate) => gate.scope === 'budget_envelope' && gate.authorizationEnvelope).at(-1)?.authorizationEnvelope,
    budget: run?.budget, policy: run?.policy,
    artifacts: Array.isArray(run?.artifacts) ? run.artifacts : [],
  }
}

async function draft(walk, win, { ask, planCall, generateCall, prompt, prompts = [prompt], done }) {
  const planner = walk.fixture.expectText({
    label: `the agent drafts a generation on a priced model (${planCall})`,
    match: (body) => flattenRequestText(body).includes(ask.split('：')[0].split(':')[0]),
    reply: { type: 'tool', id: planCall, name: 'draft_shots', args: {
      shots: prompts.map((text) => ({ prompt: text, taskKind: 'text_to_image', candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: FIXTURE_APIMART_MODEL }, parameters: {} })),
    } },
  })
  let operationId
  const draftResult = walk.fixture.expectText({
    label: `the draft result carries the host-generated operationId (${planCall})`,
    match: (body) => {
      const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === planCall)
      if (!result) return false
      operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
      return true
    },
    reply: { type: 'hold' },
  })
  const turnDone = walk.fixture.expectText({
    label: `the drafting turn completes through the same SDK turn (${planCall})`,
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === generateCall),
    reply: { type: 'text', text: done },
  })
  await sendCanvas(win, ask)
  await recorded(planner.received, 'generation draft request')
  await recorded(draftResult.received, 'generation draft result')
  draftResult.release({ type: 'tool', id: generateCall, name: 'generate', args: { operationId } })
  // 2026-09-22 裁决 A：`generate` **等**用户答完那张卡才返回——这一轮的收尾交给调用方在答完卡之后等。
  return { operationId, turnDone }
}

/**
 * ⑥ 两张一起摆、报得出价：合计在翻页那一行的右端、一行放得下；「生成剩下 2 张」在动作行最左、不带合计。
 * 看完就关（×），让等这张卡的那个回合收尾。
 */
async function twoShotPricedCard(walk, win, { locale, ask, planCall, done, prompts }) {
  const two = await draft(walk, win, { ask, planCall, generateCall: `${planCall}-generate`, prompts, done })
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  const total = card.locator(`[data-v4-block="pager-row"] ${PRICE_TOTAL}`)
  await proveProbe(total, `${locale}：两张的卡上有这一叠的合计`)
  await expect(total, `${locale}：这一叠那一格不出金额`).not.toHaveText(/[¥￥$€£]|\d+\.\d{2}/)
  // 单位跟标题同一条规则（2026-10-01 用户拍板）：图片说「张」，英文与标题同词。按键取值，不抄字面。
  await expect(total, `${locale}：合计的单位和标题一样`)
    .toContainText(uiText(locale === 'zh' ? 'zh-CN' : 'en', 'agentPanelV4.spendTotalLeadImage_other').replace('{{count}}', '2'))
  const totalBox = await total.boundingBox()
  const pagerBox = await card.locator('[data-v4-block="pager"]').boundingBox()
  expect(Math.abs((totalBox?.y ?? 0) + (totalBox?.height ?? 0) / 2 - ((pagerBox?.y ?? 0) + (pagerBox?.height ?? 0) / 2)),
    `${locale}：合计和翻页器在同一行`).toBeLessThan(6)
  expect(totalBox?.height ?? 99, `${locale}：合计一行放得下，不折行`).toBeLessThan(24)
  const batch = card.locator('[data-v4-control="batch"]')
  await expect(batch, `${locale}：「生成剩下 2 张」在`).toContainText(locale === 'zh' ? '生成剩下 2 张' : 'Generate remaining 2')
  await expect(batch, `${locale}：批量按钮上不印合计（合计已在翻页那一行）`).not.toContainText('¥')
  await expect(card.locator(INTERVENTION_CONFIRM), `${locale}：主按钮不出金额`).not.toHaveText(/[¥￥$€£]|\d+\.\d{2}/)
  const file = await walk.snap(`priced-two-shots-${locale}`)
  await card.screenshot({ path: file.replace(/\.png$/, '-card.png') })
  await closeSpendCard(card, `${locale}：看完关掉两张的卡`)
  await recorded(two.turnDone.received, `${locale}: the two-shot generate returns once its card was closed`)
}

const walk = await createRuntimeWalk('spend-priced-card', { generationProvider: 'apimart' })
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  const projectRoot = walk.report.projectRoot
  await openCanvas(win)

  const { operationId, turnDone } = await draft(walk, win, {
    ask: ASK, planCall: PLAN_CALL, generateCall: GENERATE_CALL,
    prompt: '一只青瓷茶杯，晨光斜照', done: 'S_PRICED_DONE：草稿已就绪，等你确认。',
  })

  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length,
    { timeout: DEFAULT_TIMEOUT_MS }).toBe(1)

  // ── ① 有价这一档（不是「算不出」那一档），卡上不出金额 ──
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  const cardProbe = await proveProbe(card, 'The priced paid confirmation reaches the intervention slot')
  const totalProbe = await proveProbe(card.locator(PRICE_TOTAL), 'the card renders a data-v4-price="total" slot')
  await expect(card.locator(PRICE_TOTAL), '有价这一档的锚点在，但卡上不出金额').not.toHaveText(/[¥￥$€£]|\d+\.\d{2}/)
  // 基线由上面那条证过：同一个 `data-v4-price` 属性**测得到东西**，所以这里的「没看到」不是探针失灵。
  await expectAbsent(card.locator(PRICE_UNAVAILABLE), { provenBy: totalProbe, message: '有价这一档不该出现「暂时算不出价格」' })
  // 付费卡逐镜（第 1、7 条）：主按钮只生成这一镜；金额不再印在按钮上（合同 contract-moneycopy）。
  await expect(card.locator(INTERVENTION_CONFIRM), '主按钮是「生成这张」').toContainText('生成这张')
  await expect(card.locator(INTERVENTION_CONFIRM), '主按钮不出金额').not.toHaveText(/[¥￥$€£]|\d+\.\d{2}/)
  expect(walk.fixture.images, '卡还没按之前，一次供应商生成都没发生').toHaveLength(0)
  await walk.snap('priced-card-zh')

  // ── ② + ③ 按下去：真的发出去，而且账本记的是同一个数 ──
  //
  // 阳性对照在上面：按之前 `walk.fixture.images` 刚断过是 0，所以下面的「收到了」不是本来就有。
  const hostRefusals = []
  win.on('console', (message) => {
    const text = message.text()
    if (text.includes('[spend-confirm] host refused')) hostRefusals.push(text)
  })
  const nodeId = (await readProject(win, projectId)).payload.generationCanvas.nodes[0].id
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), '卡上的主按钮「生成这张」', { noWaitAfter: true })

  await expect.poll(() => walk.fixture.images.length,
    { message: '按下主按钮之后，供应商必须真的收到一次生成请求', timeout: DEFAULT_TIMEOUT_MS }).toBeGreaterThan(0)
  expect(hostRefusals, `宿主不许再拒（实际：${hostRefusals.join(' ')}）`).toHaveLength(0)
  await recorded(turnDone.received, 'generate returns once the user approved the card')
  const submitted = JSON.stringify(walk.fixture.images[0].body)
  expect(submitted, '发给供应商的就是卡上那一镜的提示词').toContain('青瓷')
  expect(submitted, '发给供应商的就是卡上那个模型').toContain(FIXTURE_APIMART_MODEL)

  await expect.poll(() => readRunEnvelope(projectRoot, operationId)?.envelope?.jobs?.length ?? 0,
    { message: 'Run 里必须真的有一张授权信封', timeout: DEFAULT_TIMEOUT_MS }).toBeGreaterThan(0)
  const run = readRunEnvelope(projectRoot, operationId)
  // 「账本记同一价」那一条：卡上不再印金额，但信封里冻的仍是目录那一行的价，一分不多一分不少。
  expect(run.envelope.jobs[0].price.maximum, '授权信封里冻住的金额 = 目录那一行的价').toBe(BASE_PRICE)
  expect(run.envelope.budget.unknownJobCount ?? 0, '这一镜的价是知道的，未知计数必须是 0').toBe(0)
  expect(run.policy.maxSpend, '夹具上限是一个小的正数（钉 0 的那颗钉子已拔），否则有价作业永远提交不了')
    .toBeGreaterThan(BASE_PRICE)

  // ── ④ 产物真的落回那个节点，卡收起来 ──
  await expect.poll(() => (readRunEnvelope(projectRoot, operationId)?.artifacts ?? []).filter((item) => item.status === 'ready').length,
    { message: '产物必须真的落盘 —— 这就是用户说的「出图」', timeout: stationTimeout({ operations: 6 }) }).toBeGreaterThan(0)
  await expect(win.locator(`[data-node-id="${nodeId}"][data-status="success"]`),
    '草稿那一刻建的那个节点在屏上变成 success').toBeVisible({ timeout: stationTimeout({ operations: 6 }) })
  await expectAbsent(card, { provenBy: cardProbe, message: '答完的卡要收起来' })
  await walk.snap('priced-card-after-confirm-zh')

  // ── ⑥ 两张一起摆（中文）──
  await twoShotPricedCard(walk, win, {
    locale: 'zh', ask: 'S_PRICED_TWO：再画两张青瓷茶杯。', planCall: 's-priced-two-1', done: 'S_PRICED_TWO_DONE：两张都起好了。',
    prompts: ['一只青瓷茶杯，晨光斜照', '一只青瓷茶杯，傍晚逆光'],
  })

  // ── ⑤ 英文：同一档再摆一张新卡（按过的那张已经收起来了，看不到「待确认」的英文长相）──
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload()
  const en = await draft(walk, win, {
    ask: 'S_PRICED_EN: please generate one more celadon teacup image.',
    planCall: EN_PLAN_CALL, generateCall: EN_GENERATE_CALL,
    prompt: 'A celadon teacup in slanting morning light', done: 'S_PRICED_EN_DONE: the draft is ready for your confirmation.',
  })
  const enCard = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  const enTotalProbe = await proveProbe(enCard.locator(PRICE_TOTAL), 'EN: the card renders a data-v4-price="total" slot')
  await expect(enCard.locator(PRICE_TOTAL), 'EN：有价这一档也不出金额').not.toHaveText(/[¥￥$€£]|\d+\.\d{2}/)
  await expectAbsent(enCard.locator(PRICE_UNAVAILABLE), { provenBy: enTotalProbe, message: 'EN：有价这一档没有 unavailable 那一格' })
  await expect(enCard.locator(INTERVENTION_CONFIRM), 'EN：Generate this one').toContainText('Generate this one')
  await expect(enCard.locator(INTERVENTION_CONFIRM), 'EN：主按钮不出金额').not.toHaveText(/[¥￥$€£]|\d+\.\d{2}/)
  await walk.snap('priced-card-en')
  // EN 这张只是来看长相的；看完就答（关掉），让等它的那个回合收尾。
  await closeSpendCard(enCard, 'close the EN card')
  await recorded(en.turnDone.received, 'the EN generate returns once its card was closed')

  // ── ⑥ 两张一起摆（英文）：合计以前在动作行左边会挤成三行，现在在翻页那一行，一行放得下 ──
  await twoShotPricedCard(walk, win, {
    locale: 'en', ask: 'S_PRICED_TWO_EN: draw two more celadon teacups.', planCall: 's-priced-two-en-1', done: 'S_PRICED_TWO_EN_DONE: both are drafted.',
    prompts: ['A celadon teacup in slanting morning light', 'A celadon teacup against the evening light'],
  })

  walk.report.verified = ['priced-card-shows-no-amount-zh-and-en',
    'confirm-really-reaches-the-vendor',
    'ledger-records-the-catalog-price',
    'artifact-lands-on-the-node-the-draft-created',
    'two-shot-total-on-the-pager-row-one-line-zh-and-en']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
