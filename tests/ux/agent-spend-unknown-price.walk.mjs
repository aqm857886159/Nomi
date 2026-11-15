#!/usr/bin/env node
// 真实用户任务（R13，D2 第③步）：**这台机器的模型目录里一条价都没填**（= 内置生成模型的真实处境，也是每一台干净装机），
// 我让 Agent 生成一张图，卡上会说什么？按下去会发生什么？
//
// 2026-09-21 用户拍板：算不出价**绝不拦**生成；2026-09-30 付费卡逐镜：算不出价时卡上不说任何价格的话。
// D2 之后（SpendCardQ1 板，Q2 照 10-08「界面不谈钱」）：算得出价时动作行左边写「N 张」，算不出整行不印、不写 0。
// 按「生成」= 把这一镜交给画布（节点 ↑ 那一条画布单节点提交），钱的那一下记在画布那一镜的单镜 Run 上。三件事：
//   ① 卡上不说任何价格的话、没有「N 张」那一格、主按钮是「生成」且可点，**整张卡上没有任何 ¥0 / 0.00**（未知≠免费）；
//   ② 按下去**真的发起生成、真的出图**：供应商收到卡上那一镜、那个模型；画布那一镜冻住的授权信封里金额位是 null（不是 0）、
//      未知计数是 1；产物落回草稿那一刻建的那个节点，卡收起来；
//   ③ 英文一样（EN 串长 1.5-2 倍，截断只有眼睛看得出）。
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
import { expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR } from './agent-runtime-fixture.mjs'
import {
  CARD_PER_SHOT, CARD_PRIMARY, armCanvasBridges, canvasRunsOf, createPresenter, offerFacts, pressPrimary, primaryLabel, readRun, shotNodes,
} from './_spendCardWalk.mjs'
import { closeSpendCard, createRuntimeWalk, openCanvas, recorded } from './agent-runtime-walk-support.mjs'

// 这条走查的前提就是「目录里没有价目」。不设这个开关，夹具会种一行 pricing，整条走查测的就是另一个世界了。
process.env.NOMI_WALK_UNPRICED_MODEL = '1'

/** 未知价写成 0 的几种样子：三种可能（免费 / 算不出 / 真的零元）里，只有印 0 会被读成「这次免费」。 */
const ZERO = /[¥￥$]\s?0(?!\d)|0\.00/
const present = createPresenter('S_UNPRICED')
const prism = (line) => (tag) => [{
  title: `${tag} 六棱柱`, prompt: `${tag} ${line}`, taskKind: 'text_to_image',
  model: `${FIXTURE_APIMART_MODEL}@${FIXTURE_APIMART_VENDOR}`, parameters: {},
}]

/** ① 卡上一句价格的话都没有，主按钮「生成」可点，没有任何 0。 */
async function assertNoPriceWords(card, locale) {
  const primaryProbe = await proveProbe(card.locator(CARD_PRIMARY), `${locale}：卡上的主按钮在（下面那几条「不在」都以它为基线）`)
  await expectAbsent(card.locator(CARD_PER_SHOT), { provenBy: primaryProbe, message: `${locale}：算不出价时也没有逐镜明细（新卡没有「价格未知」那一行，合计那一格上面已经核过）` })
  await expect(card.locator(CARD_PRIMARY), `${locale}：主按钮是「生成」`).toContainText(primaryLabel(locale, { count: 1, kind: 'image', single: true }))
  // 算不出价**绝不拦**生成（用户 2026-09-21 硬性拍板）：按钮必须是可点的。
  await expect(card.locator(CARD_PRIMARY), `${locale}：算不出价时主按钮照样可点`).toBeEnabled()
  const text = (await card.innerText()).replace(/\s+/g, ' ')
  expect(text, `${locale}：卡上不许出现任何代表未知的 0（实际文本：${text}）`).not.toMatch(ZERO)
  expect(text, `${locale}：卡上一句价格的话都没有`).not.toMatch(/价格未知|算不出|Price unknown|only learn the cost/i)
}

const walk = await createRuntimeWalk('spend-unknown-price', { generationProvider: 'apimart', trustFixtureOrigin: true })
let failure
try {
  const { win } = await walk.start({ first: true })
  await armCanvasBridges(win)
  const { projectId } = await walk.newProject()
  await openCanvas(win)

  // ── ① 卡上说的是「什么都不说」，不是「免费」──
  const { card, operationId, turnDone } = await present(walk, win, { locale: 'zh-CN', kind: 'image', shots: prism('一个悬浮的六棱柱，柔和的演播室灯光') })
  const cardProbe = await proveProbe(card, '算不出价的付费卡照样摆在介入槽里')
  await assertNoPriceWords(card, 'zh-CN')
  expect(walk.fixture.images, '卡还没按之前，一次供应商生成都没发生').toHaveLength(0)
  await walk.snap('unknown-price-card-zh')

  // ── ② 按下去：**真的发起生成、真的出图** ──
  // 阳性对照在上面：按之前 `walk.fixture.images` 刚断过是 0，所以下面的「收到了」不是本来就有。
  const [drafted] = await shotNodes(win, projectId, operationId)
  await pressPrimary(card, '卡上的主按钮「生成」')
  await expect.poll(() => walk.fixture.images.length, { message: '按下「生成」之后，供应商真的收到一次生成请求', timeout: stationTimeout({ operations: 6 }) }).toBe(1)
  await recorded(turnDone.received, 'generate returns once the user pressed generate')
  const submitted = JSON.stringify(walk.fixture.images[0].body)
  expect(submitted, '发给供应商的就是卡上那一镜的提示词').toContain('六棱柱')
  expect(submitted, '发给供应商的就是那个算不出价的模型').toContain(FIXTURE_APIMART_MODEL)
  await expect.poll(async () => (await offerFacts(win, projectId, operationId)).handOvers.map((entry) => entry.outcome),
    { message: '这一镜交到了', timeout: stationTimeout({ operations: 6 }) }).toEqual(['accepted'])
  // 画布那一镜冻住的授权：为一个算不出价的镜头铸出的授权，金额位是 null（不是 0），账本如实记下价格未知。
  const [canvasRun] = await canvasRunsOf(win, projectId, operationId)
  const sealed = await readRun(win, projectId, canvasRun.runId)
  const envelope = (sealed?.gates ?? []).filter((gate) => gate.scope === 'budget_envelope' && gate.authorizationEnvelope).at(-1)?.authorizationEnvelope
  expect(envelope?.jobs?.length ?? 0, '画布那一镜真的有一张授权信封').toBeGreaterThan(0)
  expect(envelope.jobs[0].price.maximum, '未知价那一镜的授权金额位是 null，绝不是 0').toBeNull()
  expect(envelope.budget.unknownJobCount, '账本如实记下这一镜价格未知').toBe(1)
  expect((await offerFacts(win, projectId, operationId)).productionJobs, '制作 Run 自己一笔作业都没派').toBe(0)
  // 节点真的拿到产物：画布那一镜的 Run 里有产物，草稿那一刻建的那个节点变成 success；卡收起来。
  await expect.poll(async () => (await canvasRunsOf(win, projectId, operationId))[0]?.artifacts.length ?? 0,
    { message: '产物真的落盘——这就是用户说的「出图」', timeout: stationTimeout({ operations: 6 }) }).toBeGreaterThan(0)
  await expect.poll(async () => (await shotNodes(win, projectId, operationId))[0]?.node?.status,
    { message: '草稿那一刻建的那个节点变成 success', timeout: stationTimeout({ operations: 6 }) }).toBe('success')
  expect((await shotNodes(win, projectId, operationId))[0]?.nodeId, '还是草稿那一刻建的那个节点').toBe(drafted.nodeId)
  await expectAbsent(card, { provenBy: cardProbe, message: '答完的卡要收起来（问题答完了就不该还在等人答）' }, stationTimeout({ operations: 6 }))
  await walk.snap('unknown-price-after-generate-zh')

  // ── ③ 英文：再摆一张新卡（上面那张已经按过、收起来了，要看的是「未知价待决」那一档的英文长相）──
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload()
  const en = await present(walk, win, { locale: 'en', kind: 'image', shots: prism('A floating hexagonal prism, soft studio lighting') })
  await assertNoPriceWords(en.card, 'en')
  await walk.snap('unknown-price-card-en')
  // EN 这张只是来看长相的；看完就答（「取消」），让等它的那个回合收尾。
  await closeSpendCard(en.card, 'close the EN card')
  await recorded(en.turnDone.received, 'the EN generate returns once its card was closed')

  walk.report.verified = [
    'card-says-nothing-about-price-not-zero-zh-and-en', 'generate-is-never-blocked-by-unknown-price',
    'generate-really-reaches-the-vendor-and-the-node-gets-its-artifact', 'canvas-run-authorization-carries-null-not-zero',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
