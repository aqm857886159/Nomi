// 付费卡「停下」类走查的共用读数与单张轮（agent-spend-stop-midway / agent-spend-confirm-then-close 共用）。
import path from 'node:path'

import { clickOrFail, expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { COPY } from './_spendRemainingWalk.mjs'
import { recorded } from './agent-runtime-walk-support.mjs'

/** 停下之后那一条提示（`useAgentPanelSpendConfirm` 推它时的原因是 `spend-batch-stopped`）。 */
export const STOP_NOTICE = '[data-notification-reason="spend-batch-stopped"]'

/** 这一次生成里落定了（出图或失败）的作业有几个。落图时主进程很忙：下一步之前等它落定，下一步的点击才不用排队。 */
export async function settledJobs(win, projectId, operationId) {
  return win.evaluate(async ({ pid, oid }) => {
    const read = await window.nomiDesktop.productionRuns.read(pid, oid)
    const run = read?.run ?? read
    return (run?.jobs ?? []).filter((job) => ['adopted', 'ready', 'failed', 'cancelled'].includes(job.status)).length
  }, { pid: projectId, oid: operationId })
}


/** 这一次生成在宿主那里批下了几镜（批下的才会派；派完之后供应商收到的就该正好是这么多）。 */
export async function authorizedShots(win, projectId, operationId) {
  return win.evaluate(async ({ pid, oid }) => {
    const read = await window.nomiDesktop.productionRuns.read(pid, oid)
    const run = read?.run ?? read
    // Jobs are dispatch records and can appear while the host is still
    // settling the card. The notice is sourced from the host's final
    // presentation outcome, so compare against its approved gates instead.
    const presentation = run?.generationPlan?.presentations?.at(-1)
    if (!presentation) return 0
    const inPresentation = new Set(presentation.shotIds ?? [])
    return new Set((run?.gates ?? [])
      .slice(Number(presentation.fromGate ?? 0))
      .filter((gate) => gate.status === 'approved')
      .flatMap((gate) => gate.authorizationEnvelope?.jobs ?? [])
      .map((job) => job.shotId)
      .filter((shotId) => shotId && inPresentation.has(shotId)))
      .size
  }, { pid: projectId, oid: operationId })
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

/** 「发出了 K 张，剩下 M 张没发」→ { sent, notSent }。 */
export function parseStopped(locale, said) {
  const [, sentText, notSentText, lastOne] = COPY[locale].stopped.exec(said ?? '') ?? []
  return { sent: Number(sentText), notSent: lastOne ? 1 : Number(notSentText) }
}

/** Read the stop sentence only after the host has settled, and require it to match durable authorization. */
export async function stoppedCountsAfterHostSettles(win, projectId, operationId, locale, total) {
  let result
  await expect.poll(async () => {
    const said = await win.evaluate(() => window.__spendBatchStopped)
    const durableSent = await authorizedShots(win, projectId, operationId)
    const settled = await settledJobs(win, projectId, operationId)
    if (said) {
      const parsed = parseStopped(locale, said)
      // Do not sample a notice while the host still has an approved job in
      // flight. Keep the exact count assertion after terminal job state.
      if (settled < durableSent || parsed.sent !== durableSent || parsed.notSent !== total - durableSent) return false
      result = { ...parsed, said }
      return true
    }
    // A fast run can authorize every shot before the stop notice exists; there is no stopped split to assert then.
    if (durableSent === total) {
      result = { sent: total, notSent: 0, said: null }
      return true
    }
    return false
  }, {
    message: `${locale}: stop notice must match the host's final authorized shot count`,
    timeout: stationTimeout({ operations: 12 }),
    intervals: [100],
  }).toBe(true)
  return result
}

/** 供应商这一叠收到的是哪几镜：按每一笔请求的提示词认回卡上的那一镜（认不出的原样留着，断言会把它摆出来）。 */
export function vendorShots(walk, imagesBefore, prompts) {
  return walk.fixture.images.slice(imagesBefore).map((record) => {
    const sentPrompt = String(record.body?.prompt ?? '')
    return [...prompts].find(([, prompt]) => prompt && sentPrompt.includes(prompt))?.[0] ?? `?${sentPrompt}`
  })
}

/**
 * 不等画面停稳、直接拍一张：这一叠在跑时画面一直在动（节点在落地），而且主进程占着界面线程，截图要等空档。
 * 拍不到不算失败（断言另有，图只是给人看的）；拍到没有记进报告。
 */
export async function quickShot(walk, win, label) {
  const file = path.join(walk.report.outputDir, `${label}.png`)
  const ok = await win.screenshot({ path: file, timeout: stationTimeout({ operations: 4 }) }).then(() => true, () => false)
  walk.report.shots = { ...(walk.report.shots ?? {}), [label]: ok ? file : null }
  return file
}


const CONFIRM = '[data-v4-control="confirm"]'
const DISMISS = '[data-v4-control="slot-dismiss"]'

/** 宿主那份待决出价里这一次出价还剩几镜没决定（推给面板的对话投影，唯一来路，`tests/ux/_laneSpendProbe.mjs`）；出价没了 = 0。 */
async function shotsLeftOnCard(win, operationId) {
  return win.evaluate((oid) => {
    localStorage.setItem('__nomiE2E', '1')
    return (window.__nomiLaneWorkspace?.spend?.rows ?? []).find((row) => row.operationId === oid)?.shots.length ?? 0
  }, operationId)
}

/**
 * ③ 单张「生成这张」和 ×（10-02 搞破坏线 X2；2026-10-10 仲裁器 docs/plan/2026-10-10-spend-arbiter.md）。
 * 两下都走 locator（不再一次采样坐标连点）。`mode`：
 *   · 'after-host-sees'：点了「生成这张」，等宿主那份待决出价少了这一镜（宿主收到了确认并批下），再点 ×——
 *     这一镜已交，× 如实说「发出了 1 张」；
 *   · 'immediate'：点了「生成这张」不等任何东西立刻点 ×（确认中立刻关闭，专门钉住那个竞态）——
 *     不管谁先到，只断言不随它变的：回执里在生成的 = 宿主批下的 = 供应商收到的，且 ≤ 1 张；× 之后没交出去的不再交。
 */
export async function singleStopRound(walk, win, projectId, locale, { present, mode }) {
  const imagesBefore = walk.fixture.images.length
  const { card, operationId, turnDone, receipt } = await present(walk, win, 3, locale)
  await watchStopNotice(win)
  await clickOrFail(card.locator(CONFIRM), `${locale}：「生成这张」`, { noWaitAfter: true })
  if (mode === 'after-host-sees') {
    await expect.poll(() => shotsLeftOnCard(win, operationId), { message: `${locale}：宿主收到确认、批下这一镜（卡上少了一镜）`, timeout: stationTimeout({ operations: 6 }), intervals: [100] }).toBeLessThan(3)
  }
  await clickOrFail(card.locator(DISMISS), `${locale}：×`, { noWaitAfter: true })
  // × 落在那一下还在路上时，那一句提示和 Agent 的回执差不多同时到：一边等回合说完，一边看提示。
  await recorded(turnDone.received, `${locale}: generate returns once the card is closed (single, ${mode})`, stationTimeout({ operations: 6 }))
  // 宿主批下的几镜都落定、供应商收到的数对上，再读那一句。
  const settled = async () => {
    const authorized = await authorizedShots(win, projectId, operationId)
    return authorized === walk.fixture.images.length - imagesBefore && authorized === await settledJobs(win, projectId, operationId)
  }
  await expect.poll(settled, { message: `${locale}: approved shots reached the provider and settled`, timeout: stationTimeout({ operations: 12 }) }).toBe(true)
  // × 回给卡的那一句只在「确认还在路上时点 ×」推（渲染层 busy 分支）：× 先到、或确认先落定时没有这一句，不是失败。
  // 给它几秒出现；出现了就必须和账本一致，没出现就只核账本。
  const said = await expect.poll(() => win.evaluate(() => window.__spendBatchStopped), { timeout: 4000, intervals: [100] }).toBeTruthy().then(() => win.evaluate(() => window.__spendBatchStopped), () => null)
  const stopped = said ? { ...parseStopped(locale, said), said } : null
  await quickShot(walk, win, `${locale}-single-stopped-${mode}`)
  const decision = receiptDecision(receipt())
  const authorized = await authorizedShots(win, projectId, operationId)
  expect(decision.closedBy, `${locale}：回执记成用户关掉了卡`).toBe('user_closed')
  expect(decision.generating, `${locale}：回执里在生成的张数 = 宿主批下的张数`).toHaveLength(authorized)
  expect(authorized, `${locale}：只点了一次「生成这张」，最多批下 1 张`).toBeLessThanOrEqual(1)
  if (mode === 'after-host-sees') expect(authorized, `${locale}：宿主已收到确认，这一镜已交，× 撤不回`).toBe(1)
  expect(vendorShots(walk, imagesBefore, decision.prompts).sort(), `${locale}：回执里在生成的那几镜，正好是供应商收到的那几镜`)
    .toEqual([...decision.generating].sort())
  // 提示是 × 回给卡的那一句（渲染层只在「确认还在路上时点 ×」推它）：出现了就必须和账本一致。
  if (stopped) expect(stopped, `${locale}: stop sentence agrees with durable host state`).toEqual({ sent: authorized, notSent: 3 - authorized, said })
  walk.report.singleStopped = { ...(walk.report.singleStopped ?? {}), [`${mode}:${locale}`]: {
    generating: decision.generating, vendor: vendorShots(walk, imagesBefore, decision.prompts), said: said ?? null,
  } }
  return decision.generating.length
}
