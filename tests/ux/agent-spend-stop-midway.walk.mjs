#!/usr/bin/env node
// 真实用户任务（R13）：付费卡「生成剩下 N 张」跑到一半停下（2026-10-02 真 App 实测抓到的：「生成剩下 6 张」要走半分钟，
// 这半分钟里卡上那颗 × 点不进去，6 张全发；就算送到宿主，也被「报价对不上」挡回去）。
//
//   ① 正在发出：点「生成剩下 12 张」，卡上标题写「正在发出 k/12 张」、动作行只写怎么停，不摆「去掉这张 / 生成这张 /
//      生成剩下」——卡不能装成还在等人点。宿主一张一张交（上一张供应商受理了才批下一张，10-09 拍板 B）：前两张压着
//      供应商的受理逐张放，核「正在发出 k/12」的 k 正好是供应商此刻受理过的张数 + 1（说的 = 做的）。拍这一画面给验收页，
//      让它跑完（十二张各发一次），每张「批准 → 受理」的耗时打进报告。
//   ② 中途 ×：点「生成剩下 6 张」，宿主批下第 1 张时把鼠标落在 × 上点下去（人的点击走的就是这条路：先进主进程、再送进窗口）。
//      不靠时序：× 之后不再有新的「批准 → 提交」，发出的张数 = 点 × 那一刻供应商已受理的张数，最多加上正在交的那一张。
//      卡关掉时照实说「发出了 K 张，剩下 N−K 张没发」；宿主只批下了这 K 张，供应商只收到这 K 张；回执记「你关掉了卡」，
//      回执里「在生成」的正好是供应商收到的那 K 镜（10-02 搞破坏线 X4：回执曾少算一张）。
//   ③ 单张：点「生成这张」紧接着点 ×（10-02 搞破坏线 X2）。回执里在生成的 = 宿主批下的 = 供应商收到的；
//      × 落在那一下还在路上时，卡关掉时那一句说的张数也正是这个数。
//
// 中英各开一个新项目：宿主批一张的时间随项目里的 Run 变多而变长（主进程那两段原有的慢路径，另开一条线修），
// 两种语言挤在一个项目里，英文那一半会被拖到超时。
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
import path from 'node:path'

import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { BATCH, COPY, TITLE, createPresenter } from './_spendRemainingWalk.mjs'
import { CANVAS_PANEL, createRuntimeWalk, expandResidentPanel, openCanvas, recorded } from './agent-runtime-walk-support.mjs'
import { backToLibrary, newProjectEntry } from './_shell.mjs'
import { STOP_NOTICE, settledJobs, authorizedShots, receiptDecision, watchStopNotice, stoppedCountsAfterHostSettles, vendorShots, quickShot, singleStopRound } from './_spendStopRounds.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const present = createPresenter('S_STOP')
/** 供应商这一叠（从 `from` 起）收到了几笔、受理了几笔（回了任务号）。 */
function vendorCounts(walk, from) {
  const records = walk.fixture.images.slice(from)
  return { received: records.length, accepted: records.filter((record) => record.acceptedAt).length }
}

/** 标题「正在发出 k/N」里的 k（中英两种说法里的第一个数）。 */
function sendingCurrent(text) {
  return Number(/(\d+)/.exec(text ?? '')?.[1] ?? Number.NaN)
}

/**
 * 每张「批准 → 受理」的耗时：宿主批下这一镜那一刻（这一镜那道付费门的 decidedAt）到供应商回了任务号（夹具记的 acceptedAt）。
 * 按提示词把供应商那一笔认回是哪一镜。真付费那次协调会话看真实数字；这里是零额度夹具的数。
 */
async function acceptanceTimings(walk, win, projectId, operationId, from) {
  const facts = await win.evaluate(async ({ pid, oid }) => {
    const read = await window.nomiDesktop.productionRuns.read(pid, oid)
    const run = read?.run ?? read
    const approvedAt = {}
    for (const gate of run?.gates ?? []) {
      if (gate.status !== 'approved' || !gate.decidedAt) continue
      for (const job of gate.authorizationEnvelope?.jobs ?? []) if (job.shotId) approvedAt[job.shotId] = Date.parse(gate.decidedAt)
    }
    const prompts = (run?.generationPlan?.shots ?? []).map((shot) => [shot.shotId, shot.candidate?.prompt ?? ''])
    return { approvedAt, prompts }
  }, { pid: projectId, oid: operationId })
  return walk.fixture.images.slice(from).filter((record) => record.acceptedAt).map((record) => {
    const sentPrompt = String(record.body?.prompt ?? '')
    const shotId = facts.prompts.find(([, prompt]) => prompt && sentPrompt.includes(prompt))?.[0] ?? null
    return { shotId, approvedToAcceptedMs: shotId && facts.approvedAt[shotId] ? record.acceptedAt - facts.approvedAt[shotId] : null }
  })
}

/** ① 正在发出 k/12：拍那一画面，然后让它跑完。 */
async function sendingRound(walk, win, projectId, locale) {
  const imagesBefore = walk.fixture.images.length
  // 12 张：这一叠要走半分钟以上，截图等空档的那几秒落在它跑完之前。
  const { card, operationId, turnDone } = await present(walk, win, 12, locale)
  const cardProbe = await proveProbe(card, `${locale}：12 张的卡`)
  // 前两张压着受理、逐张放：每一步核「正在发出 k/12」的 k = 供应商已受理的 + 1，而且供应商手上只有正在交的那一张。
  walk.fixture.holdSubmits(true)
  const steps = []
  try {
    await clickOrFail(card.locator(BATCH), `${locale}：「生成剩下 12 张」`, { noWaitAfter: true })
    for (const k of [1, 2]) {
      await expect(card.locator(TITLE), `${locale}：标题说正在发第 ${k} 张`).toContainText(COPY[locale].sending(12), { timeout: stationTimeout({ operations: 4 }) })
      await expect.poll(() => vendorCounts(walk, imagesBefore).received, { message: `${locale}：第 ${k} 张的请求到了供应商`, timeout: stationTimeout({ operations: 4 }) }).toBe(k)
      await expect.poll(async () => sendingCurrent(await card.locator(TITLE).textContent()), { message: `${locale}：标题的 k 跟着真实受理走`, timeout: stationTimeout({ operations: 4 }) }).toBe(k)
      const counts = vendorCounts(walk, imagesBefore)
      steps.push({ title: k, ...counts })
      expect(counts, `${locale}：「正在发出 ${k}/12」时供应商受理了 ${k - 1} 张、手上只有正在交的第 ${k} 张（说的 = 做的）`).toEqual({ received: k, accepted: k - 1 })
      if (k === 1) await quickShot(walk, win, `${locale}-sending`)
      // 放这一张受理，紧接着再压上：下一张的请求到了就停在供应商门口。
      walk.fixture.holdSubmits(false)
      walk.fixture.holdSubmits(true)
    }
  } finally {
    walk.fixture.holdSubmits(false)
  }
  walk.report.sendingSteps = { ...(walk.report.sendingSteps ?? {}), [locale]: steps }
  await recorded(turnDone.received, `${locale}: generate returns once all twelve are decided`, stationTimeout({ operations: 24 }))
  await expectAbsent(card, { provenBy: cardProbe, message: `${locale}：十二张都定了，卡关掉` })
  await expect.poll(() => walk.fixture.images.length - imagesBefore,
    { message: `${locale}：十二张都真的发到供应商，各一次`, timeout: stationTimeout({ operations: 12 }) }).toBe(12)
  await expect.poll(() => settledJobs(win, projectId, operationId), { message: `${locale}：十二张都落定`, timeout: stationTimeout({ operations: 24 }) }).toBe(12)
  // 前两张的受理是走查自己压着的，耗时不算数；从第 3 张起是夹具照常受理的耗时。
  const timings = (await acceptanceTimings(walk, win, projectId, operationId, imagesBefore)).map((timing, index) => ({ ...timing, heldByWalk: index < 2 }))
  walk.report.acceptanceTimings = { ...(walk.report.acceptanceTimings ?? {}), [locale]: timings }
  console.log(`[spend-walk] ${locale} 批准 → 受理（ms）：${timings.map((timing) => `${timing.shotId}=${timing.approvedToAcceptedMs}${timing.heldByWalk ? '(压着)' : ''}`).join(' ')}`)
  return 12
}

/** ② 中途 ×：宿主批下第 1 张时点 ×，供应商只收到批下的那几张。 */
async function stopRound(walk, win, projectId, locale) {
  const imagesBefore = walk.fixture.images.length
  let atDismiss
  const { card, operationId, turnDone, receipt } = await present(walk, win, 6, locale)
  // 批下的那几张先压在供应商那头（收下了、还没回）：停下之后主进程不忙着落图，那一句提示在的时候截得到图。
  // 压着不影响要量的事——供应商收到几笔请求，压着也照样记；放开之后它们照常出图。
  walk.fixture.holdSubmits(true)
  try {
    await clickOrFail(card.locator(BATCH), `${locale}：「生成剩下 6 张」`, { noWaitAfter: true })
    // 这一叠在跑时界面线程被主进程占着，走查每问一次页面都要等空档——点 × 之前只问必要的几次。
    await expect(card.locator(TITLE), `${locale}：标题说正在发第几张`).toContainText(COPY[locale].sending(6), { timeout: stationTimeout({ operations: 4 }) })
    const controls = await card.evaluate((element) => Object.fromEntries(['confirm', 'alternate', 'batch', 'slot-dismiss']
      .map((control) => [control, element.querySelectorAll(`[data-v4-control="${control}"]`).length])))
    expect(controls, `${locale}：正在发出时不摆「生成这张 / 去掉这张 / 生成剩下」，只留 ×（它就是停下）`)
      .toEqual({ confirm: 0, alternate: 0, batch: 0, 'slot-dismiss': 1 })
    await watchStopNotice(win)
    // 宿主批下第 1 张的那一刻，鼠标落在 × 此刻的位置上点下去——不走「定位 → 等可点 → 滚动 → 点」那几个来回：
    // 每个来回都要等主进程空出来，等完这一叠早跑完了。
    let dismissAt
    await expect.poll(async () => {
      const seen = await win.evaluate(async ({ oid }) => {
        // 宿主那一份待决出价：推给面板的对话投影（唯一来路，`tests/ux/_laneSpendProbe.mjs`）。
        localStorage.setItem('__nomiE2E', '1')
        const read = window.__nomiLaneWorkspace?.spend
        const left = (read?.rows ?? []).find((row) => row.operationId === oid)?.shots.length ?? 0
        const box = document.querySelector('[data-v4-block="intervention"][data-kind="spend"] [data-v4-control="slot-dismiss"]')?.getBoundingClientRect()
        return { left, at: box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null }
      }, { oid: operationId })
      dismissAt = seen.at
      return seen.left
    }, { message: `${locale}：宿主批下第 1 张`, timeout: stationTimeout({ operations: 6 }), intervals: [100] }).toBeLessThan(6)
    expect(dismissAt, `${locale}：批下第 1 张时卡和 × 都还在`).toBeTruthy()
    atDismiss = vendorCounts(walk, imagesBefore)
    await win.mouse.click(dismissAt.x, dismissAt.y)
    // × 先到主进程、卡关掉，才放开供应商那头的受理：放开之后不许再有新的「批准 → 提交」。
    await expect.poll(() => win.evaluate(({ oid }) => (window.__nomiLaneWorkspace?.spend?.rows ?? []).some((row) => row.operationId === oid), { oid: operationId }),
      { message: `${locale}：× 关掉了卡`, timeout: stationTimeout({ operations: 6 }), intervals: [100] }).toBe(false)
  } finally {
    walk.fixture.holdSubmits(false)
  }
  await recorded(turnDone.received, `${locale}: generate returns once the card is closed`)
  const { said, sent, notSent } = await stoppedCountsAfterHostSettles(win, projectId, operationId, locale, 6)
  await quickShot(walk, win, `${locale}-stopped`)
  walk.report.stoppedShotHasNotice = { ...(walk.report.stoppedShotHasNotice ?? {}), [locale]: await win.locator(STOP_NOTICE).count() > 0 }
  expect(sent + notSent, `${locale}：发了的 + 没发的 = 6（${said}）`).toBe(6)
  expect(sent, `${locale}：× 真的停下了（不是 6 张全发）`).toBeLessThan(6)
  // 不靠时序：发出的 = 点 × 那一刻已受理的，最多加上正在交的那一张（宿主一张一张交，手上最多一张在交）。
  expect(atDismiss.received - atDismiss.accepted, `${locale}：点 × 那一刻供应商手上最多一张在交`).toBeLessThanOrEqual(1)
  expect(sent, `${locale}：发出的 ≥ 点 × 之前已受理的`).toBeGreaterThanOrEqual(atDismiss.accepted)
  expect(sent, `${locale}：发出的 ≤ 点 × 之前已受理的 + 正在交的那一张`).toBeLessThanOrEqual(atDismiss.received)
  expect(receipt(), `${locale}：回执记成用户关掉了卡`).toMatch(/closed the card/)
  // 批下的正好是那一句说的张数；供应商收到的正好是批下的那几张（派完再数）。
  expect(await authorizedShots(win, projectId, operationId), `${locale}：宿主只批下了 ${sent} 张`).toBe(sent)
  await expect.poll(() => walk.fixture.images.length - imagesBefore,
    { message: `${locale}：供应商只收到批下的 ${sent} 张`, timeout: stationTimeout({ operations: 6 }) }).toBe(sent)
  // 回执、提示、供应商三处说的是同一份（10-02 搞破坏线 X4：提示和供应商都是 3 张，回执只算了 2 张在生成）：
  // 回执里「在生成」的那几镜，正好是供应商收到的那几镜，张数正好是提示说的「发出了 K 张」。
  const decision = receiptDecision(receipt())
  expect(decision.generating, `${locale}：回执里在生成的张数 = 提示说发出的张数`).toHaveLength(sent)
  expect(vendorShots(walk, imagesBefore, decision.prompts).sort(), `${locale}：回执里在生成的那几镜，正好是供应商收到的那几镜`)
    .toEqual([...decision.generating].sort())
  // 批下的几张都落定（出图或失败）再往下走：落图时主进程很忙，下一步的点击要等它空出来。
  await expect.poll(() => settledJobs(win, projectId, operationId), { message: `${locale}：批下的 ${sent} 张都落定`, timeout: stationTimeout({ operations: 12 }) }).toBe(sent)
  walk.report.stopped = { ...(walk.report.stopped ?? {}), [locale]: { sent, notSent, said, atDismiss } }
  return sent
}

const walk = await createRuntimeWalk('spend-stop-midway', { generationProvider: 'apimart' })
let failure
try {
  const { win } = await walk.start({ first: true })
  const zhProject = await walk.newProject()
  await openCanvas(win)
  const sentZh = await sendingRound(walk, win, zhProject.projectId, 'zh') + await stopRound(walk, win, zhProject.projectId, 'zh')
    + await singleStopRound(walk, win, zhProject.projectId, 'zh', { present, mode: 'after-host-sees' })

  // 英文：回项目库、换成英文，在英文的项目库里新开一个项目（像英文用户一样点「New blank project」）。
  await backToLibrary(win, { timeout: stationTimeout({ operations: 4 }) })
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload()
  await clickOrFail(newProjectEntry(win), 'en：新建空白项目', { timeout: stationTimeout({ operations: 4 }) })
  await clickOrFail(win.getByRole('button', { name: 'Generate', exact: true }), 'en：生成工作区', { timeout: stationTimeout({ operations: 4 }) })
  const stage = win.locator('.generation-canvas-v2__stage')
  await expect(stage, 'en：生成画布').toBeVisible({ timeout: stationTimeout({ operations: 4 }) })
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

  expect(walk.fixture.images.length, '供应商一共收到的 = 两叠正在发出的各十二张 + 中途 × 之前批下的那几张（「生成剩下」和单张各中英一次）').toBe(sentZh + sentEn)
  walk.report.verified = [
    'card-shows-progress-not-per-shot-actions-while-sending',
    'x-stops-generate-remaining-midway-only-approved-shots-sent',
    'stop-notice-says-sent-and-not-sent',
    'receipt-records-user-closed',
    'receipt-generating-equals-vendor-received',
    'single-confirm-then-x-receipt-and-notice-follow-host-final-set',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
