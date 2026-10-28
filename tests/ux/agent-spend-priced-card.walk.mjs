#!/usr/bin/env node
// 真实用户任务（R13，D2 第③步）：**目录里填了价**的那一档——我让 Agent 生成一张图，卡上问我，我按「生成」，
// 账本按目录那一行的价记下，图真的落回我刚才那个节点。
// 合同 contract-moneycopy（#1099）+ 10-08「界面不谈钱」（D2 Q2 照它）：界面不出 Nomi 按价目表算的金额——
// 卡上动作行左边只写「N 张」（每一张都算得出价时才写；算不出整行不印），主按钮不带金额。
//
// D2 之后按「生成」= 把这一镜交给画布（和节点 ↑ 同一条画布单节点提交）：钱的那一下记在画布那一镜的单镜 Run 上
// （它封合同时冻住的授权信封），制作 Run 自己不派作业。夹具模式真正的保险是**出站只认回环**，钱本来就花不出去。
//
//   ① 有价这一档：动作行左边「1 张」、没有「算不出」那一格；主按钮是「生成」；卡上不出金额；
//   ② 按下去：供应商真的收到一次生成请求，送的就是卡上那一镜、那个模型；
//   ③ **账本记的是同一个数**：画布那一镜的单镜 Run 冻住的授权信封里 `price.maximum` = 目录那一行的价，未知计数是 0；
//   ④ 产物真的落回草稿那一刻建的那个节点，卡收起来；
//   ⑤ 英文一样（EN 串长 1.5-2 倍，截断只有眼睛看得出）；
//   ⑥ 两张一起摆：主按钮「全部生成（2）」不带金额，动作行只有取消和主按钮，主按钮的文字占一行（数行盒，不看盒子高度）。中英各拍一张。
import { expect, expectAbsent, proveProbe, textLineBoxes } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR } from './agent-runtime-fixture.mjs'
import {
  CARD_PRIMARY, MONEY, armCanvasBridges, canvasRunsOf, createPresenter, offerFacts, pointerAway, pressPrimary,
  primaryLabel, readRun, shotNodes,
} from './_spendCardWalk.mjs'
import { closeSpendCard, createRuntimeWalk, openCanvas, recorded } from './agent-runtime-walk-support.mjs'

// 这条走查的前提正好与 unknown-price 那条相反：目录里**有**价目那一行。
// 在这里硬设（而不是靠调用方记得不传），免得哪天默认值翻了面，这条走查悄悄变成另一个世界。
delete process.env.NOMI_WALK_UNPRICED_MODEL

/** 目录里那一行价目的基价（`agent-runtime-fixture.mjs` 的 `APIMART_FIXTURE_PRICING`）。 */
const BASE_PRICE = 0.3
const present = createPresenter('S_PRICED')
const teacups = (lines) => (tag) => lines.map((line, index) => ({
  title: `${tag} 茶杯 ${index + 1}`, prompt: `${tag} ${line}`, taskKind: 'text_to_image',
  candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: FIXTURE_APIMART_MODEL }, parameters: {},
}))

/**
 * 有价这一档的卡此刻摆着什么（主按钮写什么、动作行有几格），以及主按钮的文字占几行。
 * 「一行」直接数文字的行盒，不看盒子高度：按钮高度由 `h-7` 写死、折行时也不变（`< 24` 是它还是 22px 时写的，换尺寸就红；
 * 「与取消钮等高」依赖那一行是 `items-center`，换了对齐就恒真）。`tag` 标这一组是哪一张卡，四组实测记进 report.json。
 */
async function pricedRow(card, tag) {
  const primary = card.locator(CARD_PRIMARY)
  const actionCells = card.locator('[data-v4-block="card-actions"] > *')
  const box = await primary.boundingBox()
  const cancelBox = await actionCells.first().boundingBox()
  const actions = await actionCells.count()
  const lineBoxes = await textLineBoxes(primary)
  // 中文单张 / 两张、英文单张 / 两张四组：宽、高（连同旁边取消钮的高）、行盒数留在报告里，下次是「看得见在变」而不是「某天突然红」。
  ;(walk.report.pricedRows ??= []).push({ tag, lineBoxes, primaryWidth: box?.width, primaryHeight: box?.height, cancelHeight: cancelBox?.height, actions })
  return {
    primary: ((await primary.textContent()) ?? '').replace('⏎', '').trim(),
    actionCount: actions,
    lineBoxes,
  }
}

/** ⑥ 两张一起摆、报得出价：看完就关（「取消」），让等这张卡的那个回合收尾。 */
async function twoShotPricedCard(walk, win, locale, lines) {
  const two = await present(walk, win, { locale, kind: 'image', shots: teacups(lines) })
  await pointerAway(win)
  const row = await pricedRow(two.card, `${locale} two`)
  expect(row.primary, `${locale}：主按钮「全部生成（2）」`).toBe(primaryLabel(locale, { count: 2, kind: 'image' }))
  expect(row.primary, `${locale}：动作行不出金额`).not.toMatch(MONEY)
  expect(row.actionCount, `${locale}：动作行只保留取消和主按钮`).toBe(2)
  expect(row.lineBoxes, `${locale}：主按钮的文字占一行，不折行`).toBe(1)
  const file = await walk.snap(`priced-two-shots-${locale}`)
  await two.card.screenshot({ path: file.replace(/\.png$/, '-card.png') })
  await closeSpendCard(two.card, `${locale}：看完关掉两张的卡`)
  await recorded(two.turnDone.received, `${locale}: the two-shot generate returns once its card was closed`)
}

const walk = await createRuntimeWalk('spend-priced-card', { generationProvider: 'apimart', trustFixtureOrigin: true })
let failure
try {
  const { win } = await walk.start({ first: true })
  await armCanvasBridges(win)
  const { projectId } = await walk.newProject()
  await openCanvas(win)

  // ── ① 有价这一档，卡上不出金额 ──
  const { card, operationId, turnDone } = await present(walk, win, { locale: 'zh-CN', kind: 'image', shots: teacups(['一只青瓷茶杯，晨光斜照']) })
  const cardProbe = await proveProbe(card, '有价的付费卡摆在介入槽里')
  // 新卡算不出价时整行不印（没有「暂时算不出价格」那一格可找）：有价这一档要证的是那一格真的在。
  await pointerAway(win)
  const single = await pricedRow(card, 'zh-CN single')
  expect(single.primary, '单张的主按钮是「生成」').toBe(primaryLabel('zh-CN', { count: 1, kind: 'image', single: true }))
  expect(await card.innerText(), '卡上不出金额').not.toMatch(MONEY)
  expect(walk.fixture.images, '卡还没按之前，一次供应商生成都没发生').toHaveLength(0)
  await walk.snap('priced-card-zh')

  // ── ② + ③ 按下去：真的发出去，而且账本记的是同一个数 ──
  const [drafted] = await shotNodes(win, projectId, operationId)
  await pressPrimary(card, '卡上的主按钮「生成」')
  await expect.poll(() => walk.fixture.images.length, { message: '按下「生成」之后，供应商真的收到一次生成请求', timeout: stationTimeout({ operations: 6 }) }).toBe(1)
  await recorded(turnDone.received, 'generate returns once the user pressed generate')
  const submitted = JSON.stringify(walk.fixture.images[0].body)
  expect(submitted, '发给供应商的就是卡上那一镜的提示词').toContain('青瓷')
  expect(submitted, '发给供应商的就是卡上那个模型').toContain(FIXTURE_APIMART_MODEL)
  await expect.poll(async () => (await offerFacts(win, projectId, operationId)).handOvers.map((entry) => entry.outcome),
    { message: '这一镜交到了', timeout: stationTimeout({ operations: 6 }) }).toEqual(['accepted'])
  const offer = await offerFacts(win, projectId, operationId)
  expect(offer.productionJobs, '制作 Run 自己一笔作业都没派（钱的那一下在画布那一镜的单镜 Run 上）').toBe(0)
  const [canvasRun] = await canvasRunsOf(win, projectId, operationId)
  const sealed = await readRun(win, projectId, canvasRun.runId)
  const envelope = (sealed?.gates ?? []).filter((gate) => gate.scope === 'budget_envelope' && gate.authorizationEnvelope).at(-1)?.authorizationEnvelope
  expect(envelope?.jobs?.[0]?.price?.maximum, '画布那一镜冻住的授权信封里的金额 = 目录那一行的价').toBe(BASE_PRICE)
  expect(envelope?.budget?.unknownJobCount ?? 0, '这一镜的价是知道的，未知计数必须是 0').toBe(0)

  // ── ④ 产物真的落回那个节点，卡收起来 ──
  await expect.poll(async () => (await canvasRunsOf(win, projectId, operationId))[0]?.artifacts.length ?? 0,
    { message: '产物真的落盘——这就是用户说的「出图」', timeout: stationTimeout({ operations: 6 }) }).toBeGreaterThan(0)
  await expect.poll(async () => (await shotNodes(win, projectId, operationId))[0]?.node?.status,
    { message: '草稿那一刻建的那个节点变成 success', timeout: stationTimeout({ operations: 6 }) }).toBe('success')
  expect((await shotNodes(win, projectId, operationId))[0]?.nodeId, '还是草稿那一刻建的那个节点').toBe(drafted.nodeId)
  await expectAbsent(card, { provenBy: cardProbe, message: '答完的卡要收起来' }, stationTimeout({ operations: 6 }))
  await walk.snap('priced-card-after-generate-zh')

  // ── ⑥ 两张一起摆（中文）──
  await twoShotPricedCard(walk, win, 'zh-CN', ['一只青瓷茶杯，晨光斜照', '一只青瓷茶杯，傍晚逆光'])

  // ── ⑤ 英文：同一档再摆一张新卡（按过的那张已经收起来了，看不到「待确认」的英文长相）──
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload()
  const en = await present(walk, win, { locale: 'en', kind: 'image', shots: teacups(['A celadon teacup in slanting morning light']) })
  await pointerAway(win)
  const enRow = await pricedRow(en.card, 'en single')
  expect(enRow.primary, 'EN：Generate').toBe(primaryLabel('en', { count: 1, kind: 'image', single: true }))
  expect(await en.card.innerText(), 'EN：卡上不出金额').not.toMatch(MONEY)
  await walk.snap('priced-card-en')
  // EN 这张只是来看长相的；看完就答（「取消」），让等它的那个回合收尾。
  await closeSpendCard(en.card, 'close the EN card')
  await recorded(en.turnDone.received, 'the EN generate returns once its card was closed')

  // ── ⑥ 两张一起摆（英文）──
  await twoShotPricedCard(walk, win, 'en', ['A celadon teacup in slanting morning light', 'A celadon teacup against the evening light'])

  walk.report.verified = [
    'priced-card-keeps-count-on-primary-not-footer-zh-and-en', 'generate-really-reaches-the-vendor', 'canvas-run-ledger-records-the-catalog-price',
    'artifact-lands-on-the-node-the-draft-created', 'two-shot-primary-one-line-zh-and-en',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
