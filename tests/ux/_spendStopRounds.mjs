// 付费卡「停下」类走查的共用读数与单段轮（agent-spend-stop-midway / agent-spend-confirm-then-close 共用）。
//
// D2 第③步：卡上「生成 / 全部生成（N）」把这几镜交给画布（宿主在这一次出价上记交接，每一镜走画布单节点提交）；
// 「取消」收回这一次出价——还没交到供应商手里的不再交（排着队的画布同意当场收回），已经在交的照常交完、算「发出去了」。
// 读数一律取自宿主账本（这一次出价的交接记录）与假上游（收到几笔），不取自界面。
import path from 'node:path'

import { clickOrFail, expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { CARD_CANCEL, CARD_PRIMARY, SPEND_CARD, STOP_NOTICE, offerFacts, stoppedLine } from './_spendCardWalk.mjs'
import { recorded } from './agent-runtime-walk-support.mjs'

/**
 * 这一次出价的交接此刻落到哪了：交出去了的（供应商受理 / 结果未知）、确定没发的（收回 / 没发出去）、还在交的。
 * 一镜只交一次的轮里，交出去了的 = 供应商收到的那几镜。
 */
export async function handOverCounts(win, projectId, operationId) {
  const facts = await offerFacts(win, projectId, operationId)
  const outcomes = facts.handOvers.map((entry) => entry.outcome)
  return {
    sent: outcomes.filter((outcome) => outcome === 'accepted' || outcome === 'unknown').length,
    notSent: outcomes.filter((outcome) => outcome === 'withdrawn' || outcome === 'not_sent').length,
    pending: outcomes.filter((outcome) => outcome === null).length,
    total: outcomes.length,
    closedBy: facts.closedBy,
  }
}

/**
 * Agent 收到的回执里「在生成」的那几镜（`userDecision.shots.generating`），以及回执自己记着的每一镜的提示词。
 * 回执原文是一段 JSON、后面跟着给 Agent 看的那几句话（`User sees: …`）。
 */
export function receiptDecision(receipt) {
  const json = JSON.parse(receipt.slice(0, receipt.indexOf('\nUser sees:')))
  const prompts = new Map((json.operation?.shots ?? []).map((shot) => [shot.shotId, shot.candidate?.prompt]))
  return { closedBy: json.userDecision?.shots?.closedBy, generating: [...(json.userDecision?.shots?.generating ?? [])], prompts }
}

/**
 * 停下之后那一句是一条会自己消失的提示（原因 `spend-batch-stopped`）：点之前先挂一个观察者，只看这一条提示，
 * 出现过就记下原话（读的时候它可能已经消失了）。上一轮挂的那个先摘掉。
 */
export async function watchStopNotice(win) {
  await win.evaluate((selector) => {
    window.__spendBatchStoppedObserver?.disconnect()
    window.__spendBatchStopped = null
    const before = new Map([...document.querySelectorAll(selector)].map((element) => [element, element.textContent?.trim() ?? '']))
    window.__spendBatchStoppedObserver = new MutationObserver(() => {
      const candidate = [...document.querySelectorAll(selector)].find((element) => {
        const text = element.textContent?.trim() ?? ''
        return Boolean(text) && (!before.has(element) || before.get(element) !== text)
      })
      if (candidate && !window.__spendBatchStopped) {
        window.__spendBatchStopped = candidate.textContent.trim()
        window.__spendBatchStoppedObserver.disconnect()
      }
    })
    window.__spendBatchStoppedObserver.observe(document.body, { childList: true, subtree: true, characterData: true })
  }, STOP_NOTICE)
}

/** 观察者记下的那一句停下提示（没出现 = null）。 */
export function stopNoticeSaid(win) {
  return win.evaluate(() => window.__spendBatchStopped)
}

/** 供应商这一叠收到的是哪几镜：按每一笔请求的提示词认回卡上的那一镜（认不出的原样留着，断言会把它摆出来）。 */
export function vendorShots(walk, imagesBefore, prompts) {
  return walk.fixture.images.slice(imagesBefore).map((record) => {
    const sentPrompt = String(record.body?.prompt ?? '')
    return [...prompts].find(([, prompt]) => prompt && sentPrompt.includes(prompt))?.[0] ?? `?${sentPrompt}`
  })
}

/**
 * 不等画面停稳、直接拍一张：这一叠在跑时画面一直在动（节点在落地 / 出图），截图要等空档。
 * 拍不到不算失败（断言另有，图只是给人看的）；拍到没有记进报告。
 */
export async function quickShot(walk, win, label) {
  const file = path.join(walk.report.outputDir, `${label}.png`)
  const ok = await win.screenshot({ path: file, timeout: stationTimeout({ operations: 4 }) }).then(() => true, () => false)
  walk.report.shots = { ...(walk.report.shots ?? {}), [label]: ok ? file : null }
  return file
}

/** 单段卡那一镜（走查自己的提示词，按它认回供应商那一笔）。 */
const oneShot = (tag) => [{ title: `${tag} 六棱柱`, prompt: `${tag} 一个悬浮的六棱柱，柔和的演播室灯光`, taskKind: 'text_to_image', model: 'gpt-image-2@apimart' }]

/**
 * 单段卡上「生成」与「取消」（10-02 搞破坏线 X2；D2 之后「生成」= 交给画布）。`mode`：
 *   · 'after-host-sees'：点了「生成」，等宿主在出价上记下这一笔交接、请求到了供应商门口（压着受理），再点「取消」——
 *     这一镜已经在交，「取消」收不回它：照常交完，提示如实说「已经发出去了」。两下都走 locator。
 *   · 'immediate'：点了「生成」立刻点「取消」（确认中立刻关闭，专门钉住那个竞态）——两下在同一帧里点（真人最快的连点）：
 *     Playwright 两次 locator 点击之间隔着几十毫秒，单段卡在那之前早就交完、收起来了，「取消」点不到，竞态就钉不住。
 *     两下都是卡上那两颗真按钮的点击（同一个 React 处理器），第二下重新找按钮（第一下可能已经让动作行重画了）。
 *     不管谁先到，只断言不随它变的：回执里在生成的 = 交出去了的 = 供应商收到的，且 ≤ 1；取消之后没交出去的不再交；
 *     出价只有一个终态（取消先到 = 用户关的；交接先落定 = 已交给画布、取消没有可收回的，不说话）。
 */
export async function singleStopRound(walk, win, projectId, locale, { present, mode }) {
  const imagesBefore = walk.fixture.images.length
  const { card, operationId, turnDone, receipt } = await present(walk, win, { locale, kind: 'image', shots: oneShot })
  await watchStopNotice(win)
  if (mode === 'immediate') {
    const pressed = await win.evaluate(({ cardSelector, primary, cancel }) => {
      const generate = document.querySelector(`${cardSelector} ${primary}`)
      generate?.click()
      const stop = document.querySelector(`${cardSelector} ${cancel}`)
      stop?.click()
      return { generate: Boolean(generate), cancel: Boolean(stop) }
    }, { cardSelector: SPEND_CARD, primary: CARD_PRIMARY, cancel: CARD_CANCEL })
    expect(pressed, `${locale}：同一帧里「生成」和「取消」都点到了`).toEqual({ generate: true, cancel: true })
  } else {
    walk.fixture.holdSubmits(true)
    try {
      await clickOrFail(card.locator(CARD_PRIMARY), `${locale}：「生成」`, { noWaitAfter: true })
      await expect.poll(() => walk.fixture.images.length - imagesBefore, { message: `${locale}：这一镜的请求到了供应商门口（压着受理）`, timeout: stationTimeout({ operations: 6 }), intervals: [100] }).toBe(1)
      await clickOrFail(card.locator(CARD_CANCEL), `${locale}：「取消」`, { noWaitAfter: true })
    } finally {
      walk.fixture.holdSubmits(false)
    }
  }
  // 取消落在那一下还在路上时，那一句提示和 Agent 的回执差不多同时到：一边等回合说完，一边看提示。
  await recorded(turnDone.received, `${locale}: generate returns once the card is closed (single, ${mode})`, stationTimeout({ operations: 6 }))
  // 交接都落定、供应商收到的数对上，再读那一句。
  await expect.poll(async () => {
    const counts = await handOverCounts(win, projectId, operationId)
    return counts.pending === 0 && counts.sent === walk.fixture.images.length - imagesBefore
  }, { message: `${locale}: every hand-over settled and the provider count agrees`, timeout: stationTimeout({ operations: 12 }) }).toBe(true)
  // 那一句只在这一次出价真有镜交给过画布时才说（「取消」先到、一镜都没交时没有这一句，不是失败）。给它几秒出现；出现了就必须和账本一致。
  const said = await expect.poll(() => stopNoticeSaid(win), { timeout: 4000, intervals: [100] }).toBeTruthy().then(() => stopNoticeSaid(win), () => null)
  await quickShot(walk, win, `${locale}-single-stopped-${mode}`)
  const decision = receiptDecision(receipt())
  const counts = await handOverCounts(win, projectId, operationId)
  expect(decision.closedBy, `${locale}：回执记的关因就是账本上那一个（只有一个终态）`).toBe(counts.closedBy)
  if (mode === 'after-host-sees') expect(decision.closedBy, `${locale}：回执记成用户关掉了卡`).toBe('user_closed')
  else expect(['user_closed', 'handed_to_canvas'], `${locale}：取消先到 = 用户关的；交接先落定 = 已交给画布`).toContain(decision.closedBy)
  expect(decision.generating, `${locale}：回执里在生成的 = 交出去了的`).toHaveLength(counts.sent)
  expect(counts.sent, `${locale}：只点了一次「生成」，最多交出去 1 段`).toBeLessThanOrEqual(1)
  if (mode === 'after-host-sees') expect(counts.sent, `${locale}：请求已经到了供应商门口，「取消」撤不回它`).toBe(1)
  if (decision.closedBy === 'handed_to_canvas') {
    expect(counts.sent, `${locale}：交接先落定，这一镜交出去了`).toBe(1)
    expect(said, `${locale}：取消到的时候已经没有可收回的，不说话`).toBeNull()
  }
  expect(vendorShots(walk, imagesBefore, decision.prompts).sort(), `${locale}：回执里在生成的那几镜，正好是供应商收到的那几镜`)
    .toEqual([...decision.generating].sort())
  if (said) expect(said, `${locale}: stop sentence agrees with the host's hand-over ledger`).toBe(stoppedLine(locale, { sent: counts.sent, notSent: 1 - counts.sent, kind: 'image' }))
  walk.report.singleStopped = { ...(walk.report.singleStopped ?? {}), [`${mode}:${locale}`]: {
    closedBy: decision.closedBy, generating: decision.generating, vendor: vendorShots(walk, imagesBefore, decision.prompts), said: said ?? null,
  } }
  return decision.generating.length
}
