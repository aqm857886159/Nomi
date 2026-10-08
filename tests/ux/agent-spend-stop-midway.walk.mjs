#!/usr/bin/env node
// 真实用户任务（R13）：付费卡「生成剩下 N 张」跑到一半停下（2026-10-02 真 App 实测抓到的：「生成剩下 6 张」要走半分钟，
// 这半分钟里卡上那颗 × 点不进去，6 张全发；就算送到宿主，也被「报价对不上」挡回去）。
//
//   ① 正在发出：点「生成剩下 12 张」，卡上标题写「正在发出 k/12 张」、动作行只写怎么停，不摆「去掉这张 / 生成这张 /
//      生成剩下」——卡不能装成还在等人点。拍这一画面给验收页，让它跑完（十二张各发一次）。
//   ② 中途 ×：点「生成剩下 6 张」，宿主批下第 1 张时把鼠标落在 × 上点下去（人的点击走的就是这条路：先进主进程、再送进窗口）。
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

process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const present = createPresenter('S_STOP')
/** 停下之后那一条提示（`useAgentPanelSpendConfirm` 推它时的原因是 `spend-batch-stopped`）。 */
const STOP_NOTICE = '[data-notification-reason="spend-batch-stopped"]'

/** 这一次生成里落定了（出图或失败）的作业有几个。落图时主进程很忙：下一步之前等它落定，下一步的点击才不用排队。 */
async function settledJobs(win, projectId, operationId) {
  return win.evaluate(async ({ pid, oid }) => {
    const read = await window.nomiDesktop.productionRuns.read(pid, oid)
    const run = read?.run ?? read
    return (run?.jobs ?? []).filter((job) => ['adopted', 'ready', 'failed', 'cancelled'].includes(job.status)).length
  }, { pid: projectId, oid: operationId })
}

/** 这一次生成在宿主那里批下了几镜（批下的才会派；派完之后供应商收到的就该正好是这么多）。 */
async function authorizedShots(win, projectId, operationId) {
  return win.evaluate(async ({ pid, oid }) => {
    const read = await window.nomiDesktop.productionRuns.read(pid, oid)
    const run = read?.run ?? read
    return new Set((run?.jobs ?? []).map((job) => job.metadata?.shotId).filter(Boolean)).size
  }, { pid: projectId, oid: operationId })
}

/**
 * Agent 收到的回执里「在生成」的那几镜（`userDecision.shots.generating`），以及回执自己记着的每一镜的提示词。
 * 回执原文是一段 JSON、后面跟着给 Agent 看的那几句话（`User sees: …`）。
 */
function receiptDecision(receipt) {
  const json = JSON.parse(receipt.slice(0, receipt.indexOf('\nUser sees:')))
  const prompts = new Map((json.operation?.shots ?? []).map((shot) => [shot.shotId, shot.candidate?.prompt]))
  return { closedBy: json.userDecision?.shots?.closedBy, generating: [...(json.userDecision?.shots?.generating ?? [])], prompts }
}

/**
 * 停下之后那一句是一条会自己消失的提示（原因 `spend-batch-stopped`）：点之前先挂一个观察者，只看这一条提示，
 * 出现过就记下原话（读的时候它可能已经消失了）。上一轮挂的那个先摘掉。
 */
async function watchStopNotice(win) {
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
function parseStopped(locale, said) {
  const [, sentText, notSentText, lastOne] = COPY[locale].stopped.exec(said ?? '') ?? []
  return { sent: Number(sentText), notSent: lastOne ? 1 : Number(notSentText) }
}

/** Read the stop sentence only after the host has settled, and require it to match durable authorization. */
async function stoppedCountsAfterHostSettles(win, projectId, operationId, locale, total) {
  let result
  await expect.poll(async () => {
    const said = await win.evaluate(() => window.__spendBatchStopped)
    const durableSent = await authorizedShots(win, projectId, operationId)
    if (said) {
      const parsed = parseStopped(locale, said)
      if (parsed.sent !== durableSent || parsed.notSent !== total - durableSent) return false
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
function vendorShots(walk, imagesBefore, prompts) {
  return walk.fixture.images.slice(imagesBefore).map((record) => {
    const sentPrompt = String(record.body?.prompt ?? '')
    return [...prompts].find(([, prompt]) => prompt && sentPrompt.includes(prompt))?.[0] ?? `?${sentPrompt}`
  })
}

/**
 * 不等画面停稳、直接拍一张：这一叠在跑时画面一直在动（节点在落地），而且主进程占着界面线程，截图要等空档。
 * 拍不到不算失败（断言另有，图只是给人看的）；拍到没有记进报告。
 */
async function quickShot(walk, win, label) {
  const file = path.join(walk.report.outputDir, `${label}.png`)
  const ok = await win.screenshot({ path: file, timeout: stationTimeout({ operations: 4 }) }).then(() => true, () => false)
  walk.report.shots = { ...(walk.report.shots ?? {}), [label]: ok ? file : null }
  return file
}

/** ① 正在发出 k/12：拍那一画面，然后让它跑完。 */
async function sendingRound(walk, win, projectId, locale) {
  const imagesBefore = walk.fixture.images.length
  // 12 张：这一叠要走半分钟以上，截图等空档的那几秒落在它跑完之前。
  const { card, operationId, turnDone } = await present(walk, win, 12, locale)
  const cardProbe = await proveProbe(card, `${locale}：12 张的卡`)
  await clickOrFail(card.locator(BATCH), `${locale}：「生成剩下 12 张」`, { noWaitAfter: true })
  await expect(card.locator(TITLE), `${locale}：标题说正在发第几张`).toContainText(COPY[locale].sending(12), { timeout: stationTimeout({ operations: 4 }) })
  await quickShot(walk, win, `${locale}-sending`)
  await recorded(turnDone.received, `${locale}: generate returns once all twelve are decided`, stationTimeout({ operations: 24 }))
  await expectAbsent(card, { provenBy: cardProbe, message: `${locale}：十二张都定了，卡关掉` })
  await expect.poll(() => walk.fixture.images.length - imagesBefore,
    { message: `${locale}：十二张都真的发到供应商，各一次`, timeout: stationTimeout({ operations: 12 }) }).toBe(12)
  await expect.poll(() => settledJobs(win, projectId, operationId), { message: `${locale}：十二张都落定`, timeout: stationTimeout({ operations: 24 }) }).toBe(12)
  return 12
}

/** ② 中途 ×：宿主批下第 1 张时点 ×，供应商只收到批下的那几张。 */
async function stopRound(walk, win, projectId, locale) {
  const imagesBefore = walk.fixture.images.length
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
    await win.mouse.click(dismissAt.x, dismissAt.y)
  } finally {
    walk.fixture.holdSubmits(false)
  }
  await recorded(turnDone.received, `${locale}: generate returns once the card is closed`)
  const { said, sent, notSent } = await stoppedCountsAfterHostSettles(win, projectId, operationId, locale, 6)
  await quickShot(walk, win, `${locale}-stopped`)
  walk.report.stoppedShotHasNotice = { ...(walk.report.stoppedShotHasNotice ?? {}), [locale]: await win.locator(STOP_NOTICE).count() > 0 }
  expect(sent + notSent, `${locale}：发了的 + 没发的 = 6（${said}）`).toBe(6)
  expect(sent, `${locale}：× 真的停下了（不是 6 张全发）`).toBeLessThan(6)
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
  walk.report.stopped = { ...(walk.report.stopped ?? {}), [locale]: { sent, notSent, said } }
  return sent
}

/**
 * ③ 单张「生成这张」刚点下去就点 ×（10-02 搞破坏线 X2：那一镜照样批下、发出、出图，回执却写「没生成、没花钱」，也没有一句提示）。
 * 两下都用鼠标落在按钮此刻的位置上（人的点击走的就是这条路）。× 落在哪一刻由主进程忙不忙决定，所以只断言不随它变的：
 * 回执里在生成的那几镜 = 宿主批下的 = 供应商收到的；× 落在那一下还在路上时，卡关掉时那一句说的张数也正是这个数。
 */
async function singleStopRound(walk, win, projectId, locale) {
  const imagesBefore = walk.fixture.images.length
  const { card, operationId, turnDone, receipt } = await present(walk, win, 3, locale)
  await watchStopNotice(win)
  const at = await card.evaluate((element) => Object.fromEntries(['confirm', 'slot-dismiss'].map((control) => {
    const box = element.querySelector(`[data-v4-control="${control}"]`)?.getBoundingClientRect()
    return [control, box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null]
  })))
  expect(at.confirm && at['slot-dismiss'], `${locale}：卡上「生成这张」和 × 都在`).toBeTruthy()
  await win.mouse.click(at.confirm.x, at.confirm.y)
  await win.mouse.click(at['slot-dismiss'].x, at['slot-dismiss'].y)
  // × 落在那一下还在路上时，那一句提示和 Agent 的回执差不多同时到：一边等回合说完，一边看提示，它一出来就拍（只留 8 秒）。
  await recorded(turnDone.received, `${locale}: generate returns once the card is closed (single)`, stationTimeout({ operations: 6 }))
  // Wait for the host's terminal authorization/job state before reading the sentence.
  const settled = async () => {
    const authorized = await authorizedShots(win, projectId, operationId)
    return authorized === walk.fixture.images.length - imagesBefore && authorized === await settledJobs(win, projectId, operationId)
  }
  await expect.poll(settled, { message: `${locale}: approved shots reached the provider and settled`, timeout: stationTimeout({ operations: 12 }) }).toBe(true)
  const stopped = await stoppedCountsAfterHostSettles(win, projectId, operationId, locale, 3)
  const said = stopped.said
  if (said) await quickShot(walk, win, `${locale}-single-stopped`)
  const decision = receiptDecision(receipt())
  expect(decision.closedBy, `${locale}：回执记成用户关掉了卡`).toBe('user_closed')
  expect(decision.generating, `${locale}：回执里在生成的张数 = 宿主批下的张数`).toHaveLength(await authorizedShots(win, projectId, operationId))
  expect(vendorShots(walk, imagesBefore, decision.prompts).sort(), `${locale}：回执里在生成的那几镜，正好是供应商收到的那几镜`)
    .toEqual([...decision.generating].sort())
  if (said) {
    expect(stopped, `${locale}: stop sentence agrees with durable host state`).toEqual({
      sent: decision.generating.length,
      notSent: 3 - decision.generating.length,
      said,
    })
  } else {
    expect(decision.generating.length, `${locale}: no stop sentence only when the host authorized every shot`).toBe(3)
  }
  walk.report.singleStopped = { ...(walk.report.singleStopped ?? {}), [locale]: {
    generating: decision.generating, vendor: vendorShots(walk, imagesBefore, decision.prompts), said: said ?? null,
    landed: said ? 'while-confirming' : 'after-confirm-returned',
  } }
  return decision.generating.length
}

const walk = await createRuntimeWalk('spend-stop-midway', { generationProvider: 'apimart' })
let failure
try {
  const { win } = await walk.start({ first: true })
  const zhProject = await walk.newProject()
  await openCanvas(win)
  const sentZh = await sendingRound(walk, win, zhProject.projectId, 'zh') + await stopRound(walk, win, zhProject.projectId, 'zh')
    + await singleStopRound(walk, win, zhProject.projectId, 'zh')

  // 英文：回项目库、换成英文，在英文的项目库里新开一个项目（像英文用户一样点「New blank project」）。
  await clickOrFail(win.getByRole('button', { name: '返回项目库' }), '返回项目库', { timeout: stationTimeout({ operations: 4 }) })
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload()
  await clickOrFail(win.getByRole('button', { name: /^New blank project/ }), 'en：新建空白项目', { timeout: stationTimeout({ operations: 4 }) })
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
    + await singleStopRound(walk, win, enProjectId, 'en')

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
