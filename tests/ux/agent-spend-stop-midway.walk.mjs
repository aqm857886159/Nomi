#!/usr/bin/env node
// 真实用户任务（R13，D2 第③步，SpendCardQ1 板 ③ / card.progress.stop）：付费卡「全部生成（12）」跑到一半，我点「取消」停下剩下的。
//
// D2 之后「全部生成（N）」= 把这 N 镜一次交给画布（宿主在出价上记交接），画布按自己的批量并发（6）逐节点提交——
// 和画布上框选生成同一台发动机；卡不再一张一张批、一张一张交（这是行为变化，PR 偏差清单 ⑧）。
//
//   ① 正在发出：点「全部生成（12）」，供应商门口压着受理。卡上标题写「正在发出 1/12 张」（还没有一张落定），
//      动作行只说怎么停，没有主按钮、没有「不生成 ×」——卡不能装成还在等人点；供应商手上同时最多 6 笔（画布批量并发）。
//      拍这一画面给验收页，然后放开受理：十二张各发一次，卡收起来，出价按「已交给画布」关，回执说十二张都在生成。
//   ② 中途「取消」：再点「全部生成（12）」，压着受理，等供应商门口到了 6 笔（并发上限：这 6 笔已经在交），点「取消」。
//      排着队的 6 镜当场收回、不再交；已经在交的 6 笔照常交完。卡关掉时照实说「发出了 6 张，剩下 6 张没发」；
//      回执记「你关掉了卡」，回执里「在生成」的正好是供应商收到的那 6 镜；放开受理之后供应商不再收到新的一笔。
//   ③ 单段：点「生成」，请求到了供应商门口（压着受理）再点「取消」——这一镜已经在交，撤不回：照常交完，提示说已经发出去了。
//
// 中英各开一个新项目（画布上节点多了以后截图要等空档，两种语言挤在一个项目里英文那一半会被拖慢）。
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CARD_CANCEL, CARD_PRIMARY, CARD_PROGRESS, CARD_TITLE, EXCLUDE, OFFER_ROWS, STOP_NOTICE, createPresenter, offerFacts, primaryLabel, say, stoppedLine,
} from './_spendCardWalk.mjs'
import { CANVAS_PANEL, createRuntimeWalk, expandResidentPanel, openCanvas, recorded } from './agent-runtime-walk-support.mjs'
import { backToLibrary, newProjectEntry } from './_shell.mjs'
import { handOverCounts, quickShot, receiptDecision, singleStopRound, stopNoticeSaid, vendorShots, watchStopNotice } from './_spendStopRounds.mjs'

const IMAGE = 'gpt-image-2@apimart'
const BATCH_CONCURRENCY = 6
const A = { progress: 'board:SpendAskSplit/ask.sending', stop: 'board:SpendAskSplit/ask.sending' }

const present = createPresenter('S_STOP')
const twelve = (tag) => Array.from({ length: 12 }, (_, index) => ({
  title: `${tag} 第 ${index + 1} 张`, prompt: `${tag} 第 ${index + 1} 张：海边的灯塔，第 ${index + 1} 种天色`, taskKind: 'text_to_image', model: IMAGE,
}))

/** 供应商这一叠（从 `from` 起）收到了几笔、受理了几笔（回了任务号）。 */
function vendorCounts(walk, from) {
  const records = walk.fixture.images.slice(from)
  return { received: records.length, accepted: records.filter((record) => record.acceptedAt).length }
}

/** 正在发出时确认条上摆着的控件（只该剩「取消」），以及对话里那一组行尾还挂没挂「不生成 ×」（不该挂）。 */
function sendingControls(card) {
  return card.evaluate((element, { exclude, rows }) => ({
    confirm: element.querySelectorAll('[data-v4-control="confirm"]').length,
    dismiss: element.querySelectorAll('[data-v4-control="slot-dismiss"]:not([disabled])').length,
    toggles: element.querySelectorAll(exclude).length + [...document.querySelectorAll(rows)].reduce((sum, group) => sum + group.querySelectorAll(exclude).length, 0),
  }), { exclude: EXCLUDE, rows: OFFER_ROWS })
}

/** ① 正在发出 1/12：拍那一画面，然后放开受理、让它跑完。 */
async function sendingRound(walk, win, projectId, locale) {
  const imagesBefore = walk.fixture.images.length
  const { card, operationId, turnDone } = await present(walk, win, { locale, kind: 'image', shots: twelve })
  const cardProbe = await proveProbe(card, `${locale}：12 张的卡`)
  await expect(card.locator(CARD_PRIMARY), `${locale}：主按钮是「全部生成（12）」`).toContainText(primaryLabel(locale, { count: 12, kind: 'image' }))
  walk.fixture.holdSubmits(true)
  let peak
  try {
    await clickOrFail(card.locator(CARD_PRIMARY), `${locale}：「全部生成（12）」`, { noWaitAfter: true })
    await expect(card.locator(CARD_PROGRESS), `${A.progress}：确认条只剩一行「正在发出第 1 张」（还没有一张落定）`)
      .toContainText(say(locale, 'agentPanelV4.spendBatchProgressImage', { current: 1, total: 12 }), { timeout: stationTimeout({ operations: 4 }) })
    await expect(card.locator(CARD_TITLE), `${A.stop}：正在发出时不画标题`).toHaveCount(0)
    expect(await sendingControls(card), `${A.progress}：正在发出时没有主按钮、没有「不生成 ×」，「取消」在且可点`).toEqual({ confirm: 0, dismiss: 1, toggles: 0 })
    await expect.poll(() => vendorCounts(walk, imagesBefore).received, { message: `${locale}：画布批量并发的那一批到了供应商门口`, timeout: stationTimeout({ operations: 6 }) }).toBe(BATCH_CONCURRENCY)
    peak = vendorCounts(walk, imagesBefore).received
    await quickShot(walk, win, `${locale}-sending`)
    expect(vendorCounts(walk, imagesBefore), `${locale}：压着受理时供应商手上最多 ${BATCH_CONCURRENCY} 笔、一笔都没受理`).toEqual({ received: BATCH_CONCURRENCY, accepted: 0 })
  } finally {
    walk.fixture.holdSubmits(false)
  }
  await expect.poll(() => walk.fixture.images.length - imagesBefore, { message: `${locale}：十二张都真的发到供应商，各一次`, timeout: stationTimeout({ operations: 24 }) }).toBe(12)
  await expectAbsent(card, { provenBy: cardProbe, message: `${locale}：十二张都交出去了，卡收起来` }, stationTimeout({ operations: 24 }))
  const receipt = flattenRequestText((await recorded(turnDone.received, `${locale}: generate returns once all twelve are handed over`, stationTimeout({ operations: 24 }))).body)
  expect(receipt, `${locale}：回执说十二张都在生成`).toContain('All 12 shot(s) on the card are generating')
  const offer = await offerFacts(win, projectId, operationId)
  expect(offer.closedBy, `${locale}：出价按「已交给画布」关`).toBe('handed_to_canvas')
  expect(offer.handOvers.map((entry) => entry.outcome), `${locale}：十二笔交接都落成「交到了」`).toEqual(Array(12).fill('accepted'))
  expect(offer.productionJobs, `${locale}：制作 Run 自己一笔作业都没派`).toBe(0)
  walk.report.sending = { ...(walk.report.sending ?? {}), [locale]: { peakInFlight: peak } }
  return 12
}

/** ② 中途「取消」：供应商门口到了 6 笔（已经在交）时点「取消」，排着队的 6 镜收回。 */
async function stopRound(walk, win, projectId, locale) {
  const imagesBefore = walk.fixture.images.length
  const { card, operationId, turnDone, receipt } = await present(walk, win, { locale, kind: 'image', shots: twelve })
  const cardProbe = await proveProbe(card, `${locale}：12 张的卡`)
  await watchStopNotice(win)
  walk.fixture.holdSubmits(true)
  let atStop
  try {
    await clickOrFail(card.locator(CARD_PRIMARY), `${locale}：「全部生成（12）」`, { noWaitAfter: true })
    await expect.poll(() => vendorCounts(walk, imagesBefore).received, { message: `${locale}：并发那 6 笔到了供应商门口`, timeout: stationTimeout({ operations: 6 }) }).toBe(BATCH_CONCURRENCY)
    atStop = vendorCounts(walk, imagesBefore)
    await clickOrFail(card.locator(CARD_CANCEL), `${A.stop}：正在发出时点「取消」（停下剩下的）`, { noWaitAfter: true })
    await expectAbsent(card, { provenBy: cardProbe, message: `${locale}：取消之后卡关掉` }, stationTimeout({ operations: 6 }))
    // 取消先到宿主、排着队的那几镜收回，才放开供应商那头的受理：放开之后不许再有新的一笔。
    await expect.poll(async () => (await handOverCounts(win, projectId, operationId)).notSent, { message: `${locale}：排着队的 6 镜收回了`, timeout: stationTimeout({ operations: 6 }) }).toBe(12 - BATCH_CONCURRENCY)
  } finally {
    walk.fixture.holdSubmits(false)
  }
  await recorded(turnDone.received, `${locale}: generate returns once the card is closed`, stationTimeout({ operations: 12 }))
  await expect.poll(async () => (await handOverCounts(win, projectId, operationId)).pending, { message: `${locale}：每一笔交接都落定`, timeout: stationTimeout({ operations: 12 }) }).toBe(0)
  const counts = await handOverCounts(win, projectId, operationId)
  expect(counts, `${locale}：已经在交的 6 笔交完、排着队的 6 镜没发`).toMatchObject({ sent: BATCH_CONCURRENCY, notSent: 12 - BATCH_CONCURRENCY, closedBy: 'user_closed' })
  await expect.poll(() => walk.fixture.images.length - imagesBefore, { message: `${locale}：供应商只收到点取消之前那 6 笔`, timeout: stationTimeout({ operations: 6 }) }).toBe(atStop.received)
  const said = await expect.poll(() => stopNoticeSaid(win), { message: `${locale}：卡关掉时那一句`, timeout: stationTimeout({ operations: 6 }), intervals: [100] }).toBeTruthy().then(() => stopNoticeSaid(win))
  expect(said, `${locale}：照实说发出了几张、剩下几张没发`).toBe(stoppedLine(locale, { sent: counts.sent, notSent: counts.notSent, kind: 'image' }))
  await quickShot(walk, win, `${locale}-stopped`)
  walk.report.stoppedShotHasNotice = { ...(walk.report.stoppedShotHasNotice ?? {}), [locale]: await win.locator(STOP_NOTICE).count() > 0 }
  const decision = receiptDecision(receipt())
  expect(decision.closedBy, `${locale}：回执记成用户关掉了卡`).toBe('user_closed')
  expect(decision.generating, `${locale}：回执里在生成的张数 = 提示说发出的张数`).toHaveLength(counts.sent)
  expect(vendorShots(walk, imagesBefore, decision.prompts).sort(), `${locale}：回执里在生成的那几镜，正好是供应商收到的那几镜`)
    .toEqual([...decision.generating].sort())
  walk.report.stopped = { ...(walk.report.stopped ?? {}), [locale]: { ...counts, said, atStop } }
  return counts.sent
}

const walk = await createRuntimeWalk('spend-stop-midway', { generationProvider: 'apimart', trustFixtureOrigin: true })
let failure
try {
  const { win } = await walk.start({ first: true })
  const zhProject = await walk.newProject()
  await openCanvas(win)
  const sentZh = await sendingRound(walk, win, zhProject.projectId, 'zh-CN') + await stopRound(walk, win, zhProject.projectId, 'zh-CN')
    + await singleStopRound(walk, win, zhProject.projectId, 'zh-CN', { present, mode: 'after-host-sees' })

  // 英文：回项目库、换成英文，在英文的项目库里新开一个项目（像英文用户一样点「New blank project」）。
  await backToLibrary(win, { timeout: stationTimeout({ operations: 4 }) })
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload()
  await clickOrFail(newProjectEntry(win), 'en：新建空白项目', { timeout: stationTimeout({ operations: 4 }) })
  await clickOrFail(win.getByRole('button', { name: 'Generate', exact: true }), 'en：生成工作区', { timeout: stationTimeout({ operations: 4 }) })
  await expect(win.locator('.generation-canvas-v2__stage'), 'en：生成画布').toBeVisible({ timeout: stationTimeout({ operations: 4 }) })
  const enProjectId = await win.evaluate(() => {
    const url = new URL(location.href)
    return url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId')
  })
  expect(enProjectId, 'en：新项目的 id').toMatch(/^project-/)
  expect(enProjectId, 'en：是另开的新项目').not.toBe(zhProject.projectId)
  await expandResidentPanel(win)
  await expect(win.locator(`${CANVAS_PANEL} [data-v4-control="input"]`), 'en：Agent 面板的输入框在').toBeVisible({ timeout: stationTimeout({ operations: 4 }) })
  const sentEn = await sendingRound(walk, win, enProjectId, 'en') + await stopRound(walk, win, enProjectId, 'en')
    + await singleStopRound(walk, win, enProjectId, 'en', { present, mode: 'after-host-sees' })

  expect(walk.fixture.images.length, '供应商一共收到的 = 两叠正在发出的各十二张 + 中途取消之前已经在交的那几张 + 单段各一张').toBe(sentZh + sentEn)
  walk.report.verified = [
    'card-shows-progress-not-decision-actions-while-sending',
    'batch-goes-through-canvas-concurrency',
    'cancel-midway-withdraws-queued-shots-in-flight-ones-finish',
    'stop-notice-says-sent-and-not-sent',
    'receipt-records-user-closed',
    'receipt-generating-equals-vendor-received',
    'single-generate-then-cancel-after-host-sees-is-sent',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
