#!/usr/bin/env node
// 真实用户任务（R13/R16，D2 第③步）：**「我把档位切到直接生成，之后让 Agent 生成，还会不会一笔一笔问我？」**
//
// 2026-10-12 用户拍板：权限只有两档——请求批准（默认）/ 直接生成；只有「直接生成」替用户答付费那一下，不出卡。
// D2 第③步之后「直接生成」不是另一条花钱的路：主进程替用户记一笔**策略交接**（`by: 'policy'`），逐镜照样走画布单节点提交，
// 和卡上点「生成」、节点上点 ↑ 同一台发动机。卡只在策略答不了的时候出来（刹车 / 有一镜没交到 / 托管要先问人）。
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
// 走查像真人一样点：在面板里打字、在权限弹层里选档、看槽里有没有卡——不灌 store、不直调桥、不伪造待决状态。
//
//   ① 阳性对照——默认档「请求批准」下问一次：卡出现、供应商一次没碰、面板上没有任何失败；点「取消」关掉它。
//   ② 切到「直接生成」：先出一张确认卡，说清生成会直接跑；确认之后常驻一条提醒。
//   ③ 再问一次：从草稿落盘到交到为止**一次都不出卡**；供应商收到这一笔；宿主账本上这一镜是策略交出去的（`policy`），
//      出价按「已交给画布」关，制作 Run 自己不派作业；回执说是策略批的；节点出结果。
//   ④ 整场零额度（供应商是本机 loopback）。
// 「每一刻都不出卡」与托管要先问人时策略不代答，由 electron/capabilityCore/agentPanelSpendCardPolicy.e2e.test.ts 逐条钉。
import { clickOrFail, expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR } from './agent-runtime-fixture.mjs'
import { uiText } from './full-walk/invariants.mjs'
import {
  MONEY, RECEIPT_POINTERS, SPEND_CARD, armCanvasBridges, cardFacts, createPresenter, offerFacts, shotNodes,
} from './_spendCardWalk.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER, COMPOSER_PERMISSION, INTERVENTION_CONFIRM, PERMISSION_POPOVER,
  closeSpendCard, createRuntimeWalk, openCanvas, permissionTier, recorded,
} from './agent-runtime-walk-support.mjs'

const LOCALE = 'zh-CN'
const FAILURES = `${CANVAS_PANEL} [data-v4-block="errorbar"], ${CANVAS_PANEL} [data-v4-block="tool"][data-status="failed"]`
const present = createPresenter('S_AUTO')
const oneImage = (angle) => (tag) => [{
  title: `${tag} 六棱柱`, prompt: `${tag} 一个悬浮的六棱柱，${angle}，柔和的演播室灯光`, taskKind: 'text_to_image',
  model: `${FIXTURE_APIMART_MODEL}@${FIXTURE_APIMART_VENDOR}`, parameters: { aspect_ratio: '1:1' },
}]

/** 记下此刻起付费卡有没有出现过（哪怕只闪一帧）：轮询会错过一闪而过的卡，挂观察者。 */
async function watchSpendCard(win) {
  await win.evaluate((selector) => {
    window.__spendCardSeenObserver?.disconnect()
    window.__spendCardSeen = Boolean(document.querySelector(selector))
    window.__spendCardSeenObserver = new MutationObserver(() => {
      if (document.querySelector(selector)) window.__spendCardSeen = true
    })
    window.__spendCardSeenObserver.observe(document.body, { childList: true, subtree: true })
  }, SPEND_CARD)
}

const walk = await createRuntimeWalk('spend-full-auto', { generationProvider: 'apimart', trustFixtureOrigin: true })
let failure
try {
  const { win } = await walk.start({ first: true })
  await armCanvasBridges(win)
  const { projectId } = await walk.newProject()
  await openCanvas(win)
  const panel = win.locator(CANVAS_PANEL)

  // ① 阳性对照：默认档下问一次，卡必须出现（没有这一步，③ 的「没有卡」在一个根本长不出卡的现场里恒真）。
  await expect(panel.locator(COMPOSER), '默认档是「请求批准」').toHaveAttribute('data-approval-mode', 'request')
  const asked = await present(walk, win, { locale: LOCALE, kind: 'image', shots: oneImage('正面') })
  const askedFacts = await cardFacts(win)
  expect(askedFacts.cardText, '卡上不出钱（10-08「界面不谈钱」）').not.toMatch(MONEY)
  await expect(win.locator(FAILURES), '「请求批准」档下不去答那一下，也就没有任何失败').toHaveCount(0)
  expect(walk.fixture.images, '卡还没按，供应商一次没碰').toHaveLength(0)
  await walk.snap('full-auto-01-request-tier-asks')
  await closeSpendCard(asked.card, '点「取消」关掉这张卡')
  await recorded(asked.turnDone.received, 'the request-tier generate returns once its card was closed')
  expect((await offerFacts(win, projectId, asked.operationId)).closedBy, '这一次出价是用户关的').toBe('user_closed')

  // ② 切到「直接生成」：先问一次，确认卡说清生成会直接跑；确认之后常驻提醒。
  await clickOrFail(panel.locator(COMPOSER_PERMISSION), '权限档选择器')
  await expect(panel.locator(PERMISSION_POPOVER)).toBeVisible()
  await clickOrFail(panel.locator(permissionTier('direct')), '切到「直接生成」')
  const switchCard = panel.locator(`${APPROVAL_CARD}[data-kind="approval-reversible"]`)
  await expect(switchCard, '切档本身要问一次——这一次点头就是对之后每一笔生成的授权').toBeVisible()
  await expect(switchCard, '切档确认说清「生成会直接跑」').toContainText(uiText(LOCALE, 'agentPanelV4.autoModeConfirmBody').replace(/\*\*/g, ''))
  await walk.snap('full-auto-02-switch-says-paid-runs-directly')
  await clickOrFail(switchCard.locator(INTERVENTION_CONFIRM), '确认切到直接生成')
  await expect(panel.locator(COMPOSER), '档位变成「直接生成」').toHaveAttribute('data-approval-mode', 'direct')
  await expect(panel.locator('[data-v4-block="auto-mode"]'), '常驻提醒说实话：生成会直接跑').toContainText(uiText(LOCALE, 'agentPanelV4.autoModeBannerNote'))

  // ③ 再问一次：策略替用户交给画布——一次都不出卡，供应商收到这一笔。
  const imagesBefore = walk.fixture.images.length
  await watchSpendCard(win)
  const direct = await present(walk, win, { locale: LOCALE, kind: 'image', shots: oneImage('俯视'), waitForCard: false })
  await recorded(direct.turnDone.received, 'the direct-tier generate returns once the policy handed the shot over', stationTimeout({ operations: 6 }))
  await expect.poll(() => walk.fixture.images.length - imagesBefore, { message: '供应商收到这一笔', timeout: stationTimeout({ operations: 6 }) }).toBe(1)
  await expect.poll(async () => (await offerFacts(win, projectId, direct.operationId)).handOvers.map((entry) => `${entry.by}:${entry.outcome}`),
    { message: '这一镜是策略交给画布的，交到了', timeout: stationTimeout({ operations: 6 }) }).toEqual(['policy:accepted'])
  const offer = await offerFacts(win, projectId, direct.operationId)
  expect(offer.closedBy, '出价按「已交给画布」关').toBe('handed_to_canvas')
  expect(offer.productionJobs, '制作 Run 自己一笔作业都没派（同一台发动机：作业在画布那一镜的单镜 Run 里）').toBe(0)
  expect(direct.receipt(), '回执说得出是「直接生成」档批的').toContain('policy:full_auto')
  expect(await win.evaluate(() => window.__spendCardSeen), '从草稿落盘到交到为止，一次都不出卡').toBe(false)
  await expect(win.locator(FAILURES), '直接生成档下这一笔顺利交出去：面板上没有失败').toHaveCount(0)
  await expect.poll(async () => (await shotNodes(win, projectId, direct.operationId))[0]?.node?.status,
    { message: '草稿那一刻建的那个节点出了结果', timeout: stationTimeout({ operations: 6 }) }).toBe('success')
  // 对话流里那一行带组指向的收据（板 ④）是卡退场后留下的：这一档没有卡，也就没有那一行（板与设计卡都没要求，报告里交协调）。
  walk.report.directTierReceiptRow = await panel.locator(`${RECEIPT_POINTERS}[data-operation-id="${direct.operationId}"]`).count()
  await walk.snap('full-auto-03-direct-tier-no-card')

  // ④ 零额度：供应商是本机 loopback，一共只收到 ③ 那一笔。
  expect(walk.fixture.images, '整场只有「直接生成」档那一笔到了（loopback，零额度）').toHaveLength(1)

  walk.report.verified = [
    'request-tier-still-asks', 'switch-copy-matches-behaviour', 'direct-tier-hands-over-by-policy-without-a-card',
    'policy-hand-over-goes-through-the-canvas-engine',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
