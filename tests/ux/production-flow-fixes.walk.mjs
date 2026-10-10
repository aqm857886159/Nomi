#!/usr/bin/env node
// 真实用户任务（零额度：loopback 夹具当供应商，不注入任何价格）：制作流程几处「停下来 / 继续」的验收走查。
// 真 App、真点击、真 IPC；每一步照测试表的行号记进 report.rows（ok / detail / 截图），红了照样往下走，最后按有没有红定退出码。
//
//   NOMI_PFF_SCENARIO=<一场> node tests/ux/production-flow-fixes.walk.mjs
//
// 场景（一次跑一场，每场一份独立资料）：
//   checkpoint          参考卡 + 两镜视频「全自动」放行 → 参考卡出图 → 任务卡上放行形象 → 两镜视频派出去并出片。
//   anchor-fail         参考卡生成失败 → 没开拍的视频镜说真实原因（不说「预算已用完 / 提额续拍」）；在参考卡上点「重试」→ 说人话。
//   pause-settle        三镜图片，第 1 镜在供应商那边时按急停 → 第 1 镜收尾后落到「已暂停」→ 第 3 镜「继续剩余」→ 剩下两镜出片。
//   pause-resume-early  急停后第 1 镜还没回来就点「继续剩余」→ 直接接着拍，不报错。
//   upgrade-open        「从上一版升级上来的资料」：NOMI_PFF_UPGRADE_FROM=<上一版跑 pause-settle / anchor-fail / consent-late-release 留下的 report.json>，
//                        在同一份资料上换这一版打开那个项目，看旧 Run 被怎么接住。
//   consent-late-release 付费卡① 第 13 条：参考卡 + 两镜视频批了之后，过了同意窗口（10 分钟）才在任务卡上放行形象 → 那一下点击续上同意，两镜照样派出去。
//   consent-late-resume  同上，换成急停：第 1 镜收尾、落到「已暂停」，过了同意窗口才点「继续剩余」→ 剩下两镜照样派出去。
//
// 等同意窗口是真的等（批准之后十分钟多一点），不改任何时钟、不改盘上的数据。
//
// 中文走完主路径；要看文案的那几步同时切到英文再拍一张（英文界面里不许出现中文、不许出现主进程英文原话以外的拼接）。
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { findCanvasBlankPoint, findNodeHitPoint } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER_PERMISSION, INTERVENTION_CONFIRM, PERMISSION_POPOVER, permissionTier,
  chooseAssistantModel, createRuntimeWalk, openCanvas, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'
import { canvasFitViewButton } from './_shell.mjs'

const SCENARIO = process.env.NOMI_PFF_SCENARIO || 'checkpoint'
const SCENARIOS = new Set(['checkpoint', 'anchor-fail', 'pause-settle', 'pause-resume-early', 'upgrade-open', 'consent-late-release', 'consent-late-resume'])
if (!SCENARIOS.has(SCENARIO)) throw new Error(`NOMI_PFF_SCENARIO 只认 ${[...SCENARIOS].join(' / ')}`)

const IMAGE = { providerId: 'apimart', modelId: 'gpt-image-2' }
const VIDEO = { providerId: 'apimart', modelId: 'doubao-seedance-2.0' }
const TASK_TRIGGER = '[data-task-center-trigger="true"]'
const TASK_CARD = '[data-production-task-card]'
/** 今天没有价格：这几句在任何路径上都不该出现（有价格的那条路另说）。 */
const BUDGET_COPY = /预算已用完|提额续拍|Budget ran out|Raise budget/
/** 主进程的英文原话拼进了界面（「run status … · 操作没成功」那一类）。 */
const RAW_MAIN_TEXT = /run status|not resumable|Generation (?:rework|authorization)|previously authorized|· 操作没成功|· The action/i
const CJK = /[㐀-鿿]/

const readRun = (root, id) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.nomi', 'runs', id, 'run.json'), 'utf8')).run } catch { return null }
}
const jobsOf = (run) => (run?.jobs ?? []).map((job) => `${job.metadata?.shotId}:${job.status}${job.errorCode ? `(${job.errorCode})` : ''}`).join(' ')
const log = (...args) => console.log(`[pff:${SCENARIO}]`, ...args)

const upgradeFrom = process.env.NOMI_PFF_UPGRADE_FROM
const previous = SCENARIO === 'upgrade-open'
  ? (() => {
    if (!upgradeFrom) throw new Error('upgrade-open 要 NOMI_PFF_UPGRADE_FROM=<上一版那一场的 report.json>')
    return JSON.parse(fs.readFileSync(upgradeFrom, 'utf8'))
  })()
  : null

process.env.NOMI_WALK_UNPRICED_MODEL = '1'
const walk = await createRuntimeWalk(`pff-${SCENARIO}`, {
  generationProvider: 'apimart',
  ...(previous ? { profileDir: previous.tempRoot } : {}),
})
const rows = {}
walk.report.rows = rows
walk.report.scenario = SCENARIO

/** 记一行测试表的结果：断言失败不抛，写成 ok:false 接着走。 */
async function row(id, title, check) {
  try {
    const detail = await check()
    rows[id] = { title, ok: true, detail: detail ?? '', shots: rows[id]?.shots ?? [] }
  } catch (error) {
    // 断言库的报错第一行只有「toBe 失败」，真正有用的是后面的 Expected / Received：一起留下。
    const detail = String(error?.message ?? error).replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((line) => line.trim()).filter(Boolean).join(' ')
    rows[id] = { title, ok: false, detail: detail.slice(0, 400), shots: rows[id]?.shots ?? [] }
    process.exitCode = 1
  }
  log(rows[id].ok ? 'PASS' : 'FAIL', id, title, rows[id].detail)
}

async function shot(id, label) {
  const file = await walk.snap(`${id}-${label}`).catch((error) => { log('snap failed', error.message.split('\n')[0]); return null })
  if (file) (rows[id] ??= { title: '', ok: false, detail: '', shots: [] }).shots.push(file)
  return file
}

async function setLocale(win, locale) {
  await win.evaluate((value) => localStorage.setItem('nomi:locale:v1', value), locale)
  await win.reload({ waitUntil: 'domcontentloaded' })
  await expect(win.locator('.generation-canvas-v2__stage')).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await waitForVisualQuiescence(win)
}

async function fitView(win) {
  const blank = await findCanvasBlankPoint(win)
  if (blank) await win.mouse.click(blank.x, blank.y)
  const fit = canvasFitViewButton(win)
  if (await fit.isVisible().catch(() => false)) await fit.click()
  await waitForVisualQuiescence(win)
}

/**
 * 给验收页拍一张看得清字的局部图：放大到这几张卡的字读得出来（不点它们，免得弹出输入框），只截这几张卡那一块。
 * 整屏图照拍（看得到上下文），这一张是给人对着读卡上那句话的。
 */
let zoomCount = 0
/** 画布上真正空着、看得见的那一块：左边浮着工具条、底下浮着生成条与缩放条，都不算。 */
async function usableStage(win) {
  const stage = await win.locator('.generation-canvas-v2__stage').first().boundingBox()
  if (!stage) return null
  return { left: stage.x + 80, top: stage.y + 12, right: stage.x + stage.width - 12, bottom: stage.y + stage.height - 130 }
}
const unionOf = (boxes) => {
  const x = Math.min(...boxes.map((box) => box.x)); const y = Math.min(...boxes.map((box) => box.y))
  return { x, y, width: Math.max(...boxes.map((box) => box.x + box.width)) - x, height: Math.max(...boxes.map((box) => box.y + box.height)) - y }
}
/** 中键拖动空白处，把这几张卡挪到可见区正中（和用户平移画布是同一个手势）。 */
async function centerOn(win, union, area) {
  const dx = (area.left + area.right) / 2 - (union.x + union.width / 2)
  const dy = (area.top + area.bottom) / 2 - (union.y + union.height / 2)
  if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return
  const from = await findCanvasBlankPoint(win)
  if (!from) return
  await win.mouse.move(from.x, from.y)
  await win.mouse.down({ button: 'middle' })
  await win.mouse.move(from.x + dx, from.y + dy, { steps: 10 })
  await win.mouse.up({ button: 'middle' })
  await waitForVisualQuiescence(win)
}
/** 卡片附近一个滚轮真会缩放画布的空白点（卡片与带 nowheel 的区域会吃掉滚轮）。 */
async function wheelAnchorNear(win, union, area) {
  const points = [
    { x: union.x + union.width / 2, y: union.y + union.height / 2 },
    { x: union.x + union.width / 2, y: union.y - 14 },
    { x: union.x - 14, y: union.y + union.height / 2 },
    { x: union.x + union.width + 14, y: union.y + union.height / 2 },
    { x: union.x + union.width / 2, y: union.y + union.height + 14 },
  ].filter((point) => point.x > area.left && point.x < area.right && point.y > area.top && point.y < area.bottom)
  return win.evaluate((candidates) => candidates.find((point) => {
    const element = document.elementFromPoint(point.x, point.y)
    return Boolean(element && element.closest('.react-flow') && !element.closest('.react-flow__node') && !element.closest('.nowheel'))
  }) ?? null, points)
}
async function zoomShot(win, id, label, nodeIds) {
  try {
    await fitView(win)
    const area = await usableStage(win)
    if (!area) return null
    const boxesOf = async () => (await Promise.all(nodeIds.map((nodeId) => win.locator(`[data-node-id="${nodeId}"]`).first().boundingBox()))).filter(Boolean)
    const wheel = async (point, delta) => {
      await win.mouse.move(point.x, point.y)
      await win.keyboard.down('Control'); await win.mouse.wheel(0, delta); await win.keyboard.up('Control')
      await waitForVisualQuiescence(win)
    }
    for (let step = 0; step < 16; step += 1) {
      let boxes = await boxesOf()
      if (!boxes.length || boxes[0].width >= (nodeIds.length === 1 ? 420 : 340)) break
      await centerOn(win, unionOf(boxes), area)
      boxes = await boxesOf()
      const anchor = await wheelAnchorNear(win, unionOf(boxes), area)
      if (!anchor) break
      await wheel(anchor, -160)
      const grown = unionOf(await boxesOf())
      if (grown.width > area.right - area.left - 24 || grown.height > area.bottom - area.top - 24) { await wheel(anchor, 160); break }
    }
    const settled = await boxesOf()
    if (!settled.length) return null
    await centerOn(win, unionOf(settled), area)
    const union = unionOf(await boxesOf())
    const stage = await win.locator('.generation-canvas-v2__stage').first().boundingBox()
    const left = Math.max(stage.x, union.x - 24); const top = Math.max(stage.y, union.y - 40)
    const right = Math.min(stage.x + stage.width, union.x + union.width + 24); const bottom = Math.min(stage.y + stage.height, union.y + union.height + 24)
    const file = path.join(walk.outputDir, `z${String(++zoomCount).padStart(2, '0')}-${id}-${label}.png`)
    await screenshotSettled(win, { path: file, clip: { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) } })
    ;(rows[id] ??= { title: '', ok: false, detail: '', shots: [] }).shots.push(file)
    return file
  } catch (error) {
    log('zoom shot failed', String(error?.message ?? error).split('\n')[0])
    return null
  }
}

/** 放大到能看清这一张卡、并选中它。 */
async function focusNode(win, nodeId) {
  await fitView(win)
  const target = win.locator(`[data-node-id="${nodeId}"]`).first()
  for (let step = 0; step < 8; step += 1) {
    const box = await target.boundingBox()
    if (!box || box.width >= 260) break
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await win.keyboard.down('Control'); await win.mouse.wheel(0, -240); await win.keyboard.up('Control')
    await waitForVisualQuiescence(win)
  }
  const point = await findNodeHitPoint(win, { nodeSelector: `[data-node-id="${nodeId}"]` })
  await win.mouse.click(point.x, point.y)
}

/** 画布上每张制作卡此刻挂着什么（排队 / 已停小标、按钮、失败卡、节点底部那行反馈）。 */
function faces(win, nodeIds) {
  return win.evaluate((ids) => ids.map((id) => {
    const node = document.querySelector(`[data-node-id="${id}"]`)
    const placeholder = node?.querySelector('[data-shot-placeholder-state]')
    const feedback = [...(node?.querySelectorAll('p[role="status"]') ?? [])].map((element) => element.textContent?.trim()).filter(Boolean).join(' | ')
    return {
      id,
      exists: Boolean(node),
      status: node?.getAttribute('data-status') ?? null,
      placeholder: placeholder?.getAttribute('data-shot-placeholder-state') ?? null,
      placeholderText: placeholder?.textContent?.trim() ?? null,
      action: node?.querySelector('[data-production-shot-action]')?.getAttribute('data-production-shot-action') ?? null,
      failure: node?.querySelector('[role="alert"]')?.textContent?.trim().slice(0, 160) ?? null,
      feedback: feedback || null,
    }
  }), nodeIds)
}

const TASK_PANEL = '[data-nomi-right-panel="tasks"]'
const TOASTS = '.mantine-Notification-root'

/**
 * 「预算已用完 / 提额续拍」这类话只会出现在三块产品界面上：镜头卡（占位、失败、节点反馈，`faces` 读的那几格）、
 * 任务面板、提示框。只读这三块（各自的 data 属性 / 类名定位），不读整页——整页里有 Agent 对话和我们自己 seed 的
 * 文字，断言会被它们污染成必然命中或必然不中。返回命中的那几段原文，空数组 = 这三块上都没有。
 */
async function budgetCopyOnProductSurfaces(win, nodeIds) {
  const cardFaces = await faces(win, nodeIds)
  // 探针得先证明它读得到东西：镜头卡一张都没读到、任务面板是空的，「没有预算文案」就是一句空话。
  if (!cardFaces.some((face) => face.exists)) throw new Error('镜头卡一张都没读到（节点不在视野里？）')
  const panelText = await win.locator(TASK_PANEL).first().textContent().catch(() => '')
  if (!panelText?.trim()) throw new Error('任务面板没读到内容')
  const cards = cardFaces.flatMap((face) => [face.placeholderText, face.failure, face.feedback])
  const toasts = await win.locator(TOASTS).allTextContents().catch(() => [])
  return [...cards, panelText, ...toasts].filter((text) => text && BUDGET_COPY.test(text))
}

/** 打开任务面板查一遍三块产品界面，再关上（截图时界面状态与之前一样）。 */
async function assertNoBudgetCopy(win, nodeIds, where) {
  await openTaskCard(win)
  const hits = await budgetCopyOnProductSurfaces(win, nodeIds)
  await closeTaskPanel(win)
  if (hits.length > 0) throw new Error(`${where}：镜头卡 / 任务面板 / 提示框上还有预算文案：${JSON.stringify(hits)}`)
}

/** Agent 起草 → 切「全自动」→ 说一句「全部生成」。返回 Run 与镜。 */
async function draftAndRelease(win, projectRoot, { tag, shots, beforeGenerate }) {
  const planner = walk.fixture.expectText({
    label: `${tag} draft`, match: (body) => flattenRequestText(body).includes(`${tag}_ASK`),
    reply: { type: 'tool', id: `${tag}-plan`, name: 'draft_shots', args: { shots } },
  })
  let operationId
  const drafted = walk.fixture.expectText({
    label: `${tag} draft result`, match: (body) => {
      const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === `${tag}-plan`)
      if (!result || flattenRequestText(body).includes(`${tag}_GO`)) return false
      operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
      return true
    },
    reply: { type: 'text', text: `${tag}_HOLD_DONE` },
  })
  await sendCanvas(win, `${tag}_ASK 起草这几镜，先别生成。`)
  await recorded(planner.received, 'draft request')
  await recorded(drafted.received, 'draft result')
  await expect.poll(() => (readRun(projectRoot, operationId)?.generationPlan?.shots ?? []).filter((shot) => shot.nodeId).length,
    { message: '草稿落到画布上', timeout: DEFAULT_TIMEOUT_MS }).toBe(shots.length)
  const planShots = readRun(projectRoot, operationId).generationPlan.shots
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_PERMISSION}`), '权限档选择器')
  await expect(win.locator(`${CANVAS_PANEL} ${PERMISSION_POPOVER}`)).toBeVisible()
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${permissionTier('project')}`), '切到「全自动」')
  const switchCard = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="approval-reversible"]`)
  await expect(switchCard).toBeVisible()
  await clickOrFail(switchCard.locator(INTERVENTION_CONFIRM), '确认切到全自动')
  beforeGenerate?.()
  const goTurn = walk.fixture.expectText({ label: `${tag} go`, match: (body) => flattenRequestText(body).includes(`${tag}_GO`), reply: { type: 'tool', id: `${tag}-go`, name: 'generate', args: { operationId } } })
  const goDone = walk.fixture.expectText({ label: `${tag} go done`, match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === `${tag}-go`), reply: { type: 'text', text: `${tag}_GO_DONE` } })
  await sendCanvas(win, `${tag}_GO 全部生成吧`)
  await recorded(goTurn.received, 'generate request')
  return { operationId, planShots, goDone }
}

async function openTaskCard(win) {
  if (!(await win.locator(TASK_CARD).first().isVisible().catch(() => false))) await clickOrFail(win.locator(TASK_TRIGGER), '打开任务面板')
  await expect(win.locator(TASK_CARD).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
}

async function closeTaskPanel(win) {
  await win.keyboard.press('Escape').catch(() => {})
  await waitForVisualQuiescence(win)
}

/**
 * 等这一批的同意窗口真的过去：从批准它的那一刻（付费门的 `decidedAt`）起算，等到它那份信封的到期时间再多 30 秒。
 * 两个版本都适用：上一版派发时核的就是信封的到期时间，这一版的同意窗口与它等长（10 分钟）。
 * 这是这几行测试的前提本身（时间必须真的过去），不是拿墙钟去猜某件事做完了没有。
 */
async function outlastConsentWindow(projectRoot, operationId) {
  const run = readRun(projectRoot, operationId)
  const gates = (run?.gates ?? []).filter((gate) => gate.scope === 'budget_envelope' && gate.status === 'approved')
  // 这一版信封住在门上；上一版（付费卡逐镜之前）整批一份，住在计划上。
  const expiries = [...gates.map((gate) => gate.authorizationEnvelope?.expiresAt), run?.generationPlan?.authorizationEnvelope?.expiresAt].filter(Boolean)
  if (!gates.length || !expiries.length) throw new Error('没有批过的付费门，等不了它的同意窗口')
  const lapsesAt = Math.max(...expiries.map((value) => Date.parse(value))) + 30_000
  log(`等同意窗口过去：到 ${new Date(lapsesAt).toISOString()}（批准于 ${gates.map((gate) => gate.decidedAt).join(', ')}）`)
  await expect.poll(() => Date.now() >= lapsesAt, { message: '同意窗口过去', timeout: stationTimeout({ operations: 50 }), intervals: [15_000] }).toBe(true)
  return new Date(lapsesAt).toISOString()
}

/** 这一批批过的付费门上记的「谁续过同意」（这一版才有；上一版这一格不存在）。 */
const renewedBy = (projectRoot, operationId) => (readRun(projectRoot, operationId)?.gates ?? [])
  .filter((gate) => gate.scope === 'budget_envelope').map((gate) => gate.consentRenewedBy ?? null)

/** 英文界面里这一块不许有中文。 */
function assertNoCjk(text, where) {
  const hit = CJK.exec(text ?? '')
  if (hit) throw new Error(`${where} 在英文界面里有中文：「${String(text).slice(Math.max(0, hit.index - 20), hit.index + 20)}」`)
}

let failure
try {
  const started = await walk.start({ first: SCENARIO !== 'upgrade-open' })
  let { win } = started

  if (SCENARIO === 'upgrade-open') {
    // ── 上一版留下的资料：换这一版打开同一个项目 ──
    const { projectId, projectRoot, operationId, scenario: previousScenario, projectName } = previous.seed
    log('upgrade from', previousScenario, 'run', operationId, 'status on disk', readRun(projectRoot, operationId)?.status, jobsOf(readRun(projectRoot, operationId)))
    // 上一版那一场最后切到了英文（界面语言跟着资料走）：先切回中文走主路径，英文那一张后面再切。
    await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'zh-CN'))
    await win.reload({ waitUntil: 'domcontentloaded' })
    await waitForVisualQuiescence(win)
    const card = win.locator('[data-project-card="true"]').filter({ hasText: projectName }).first()
    await expect(card).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await card.hover()
    await clickOrFail(card.getByRole('button', { name: /继续创作|Continue/ }), '打开上一版留下的项目')
    await win.waitForFunction((id) => location.href.includes(`projectId=${encodeURIComponent(id)}`), projectId)
    await openCanvas(win)
    const nodeIds = readRun(projectRoot, operationId).generationPlan.shots.map((shot) => shot.nodeId).filter(Boolean)
    if (previousScenario === 'consent-late-release') {
      // 上一版：放行形象晚于 10 分钟，两镜视频派发时撞上「授权已过期」、一直「排队中」（F1）。这一版打开同一个项目。
      const run0 = readRun(projectRoot, operationId)
      const videoNodeIds = run0.generationPlan.shots.filter((planShot) => planShot.role !== 'anchor').map((planShot) => planShot.nodeId)
      await row('U5', '升级（老资料）：上一版过了同意窗口、视频镜一直「排队中」的批次，打开后如实停下——「这镜还没开拍，需要你再确认一次」并给「继续」', async () => {
        await expect.poll(() => readRun(projectRoot, operationId)?.stop?.reason ?? null, { timeout: stationTimeout({ operations: 6 }), intervals: [500] }).toBe('consent_expired')
        await fitView(win)
        await expect.poll(async () => (await faces(win, videoNodeIds)).every((face) => face.placeholder === 'stopped' && face.action === 'resume-consent'),
          { timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
        if (walk.fixture.videos.length !== 0) throw new Error(`没人点就派出去了 ${walk.fixture.videos.length} 镜`)
        await assertNoBudgetCopy(win, videoNodeIds, '老资料打开后')
        return `${readRun(projectRoot, operationId).status} · stop=${readRun(projectRoot, operationId).stop?.reason} · ${jobsOf(readRun(projectRoot, operationId))} · ${JSON.stringify((await faces(win, videoNodeIds)).map((face) => [face.placeholderText, face.action]))}`
      })
      await shot('U5', 'zh-consent-expired')
      await zoomShot(win, 'U5', 'zh-consent-expired', [videoNodeIds[0]])
      // 同一张小标的英文：切过去拍一张、再切回来（界面语言只是渲染层的事，Run 一个字不动）。
      await setLocale(win, 'en')
      await fitView(win)
      await row('U5en', '升级（老资料，英文）：同一张小标说英文、没有中文、不说预算', async () => {
        const all = await faces(win, videoNodeIds)
        for (const face of all) if (face.placeholderText) assertNoCjk(face.placeholderText, `卡 ${face.id}`)
        if (all.some((face) => BUDGET_COPY.test(face.placeholderText ?? ''))) throw new Error(`英文界面有预算文案：${JSON.stringify(all.map((face) => face.placeholderText))}`)
        return JSON.stringify(all.map((face) => face.placeholderText))
      })
      await shot('U5en', 'en-consent-expired')
      await zoomShot(win, 'U5en', 'en-consent-expired', [videoNodeIds[0]])
      await setLocale(win, 'zh-CN')
      await fitView(win)
      await row('U6', '点「继续」（这一下就是确认）：两镜视频派出去并出片', async () => {
        await focusNode(win, videoNodeIds[0])
        await clickOrFail(win.locator(`[data-node-id="${videoNodeIds[0]}"] [data-production-shot-action]`).first(), '这镜的「继续」', { noWaitAfter: true })
        await expect.poll(() => walk.fixture.videos.length, { timeout: stationTimeout({ operations: 4 }) }).toBe(2)
        walk.fixture.releaseVideos()
        for (const nodeId of videoNodeIds) {
          await expect(win.locator(`[data-node-id="${nodeId}"][data-status="success"]`)).toBeVisible({ timeout: stationTimeout({ operations: 6 }) })
        }
        return `${jobsOf(readRun(projectRoot, operationId))} · 续同意：${JSON.stringify(renewedBy(projectRoot, operationId))}`
      })
      await fitView(win)
      await shot('U6', 'zh-after-continue')
      await zoomShot(win, 'U6', 'zh-after-continue', videoNodeIds)
      await setLocale(win, 'en')
      await fitView(win)
      await shot('U6', 'en-after-continue')
      await zoomShot(win, 'U6', 'en-after-continue', videoNodeIds)
    } else if (previousScenario === 'pause-settle') {
      await row('U1', '升级：上一版一直「暂停中」的制作，打开后落到「已暂停」；没开拍的镜头不猜原因、不说预算，给「继续」', async () => {
        await expect.poll(() => readRun(projectRoot, operationId)?.status, { timeout: stationTimeout({ operations: 4 }), intervals: [500] }).toBe('paused')
        await fitView(win)
        await expect.poll(async () => (await faces(win, nodeIds)).some((face) => face.placeholder === 'stopped'), { timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
        const all = await faces(win, nodeIds)
        if (all.some((face) => BUDGET_COPY.test(face.placeholderText ?? ''))) throw new Error(`升级后挂着预算文案：${JSON.stringify(all)}`)
        return `${readRun(projectRoot, operationId).status} · stop=${JSON.stringify(readRun(projectRoot, operationId).stop ?? null)} · ${jobsOf(readRun(projectRoot, operationId))} · ${JSON.stringify(all.map((face) => [face.placeholderText, face.action]).filter(([text]) => text))}`
      })
      await zoomShot(win, 'U1', 'zh-legacy-paused', [nodeIds.at(-1)])
      await openTaskCard(win)
      await shot('U1', 'zh-task-card')
      await closeTaskPanel(win)
      await row('U2', '升级：没开拍的镜头上「继续剩余」能用，剩下的镜头出片', async () => {
        const run = readRun(projectRoot, operationId)
        const pending = run.generationPlan.shots.filter((planShot) => run.jobs.find((job) => job.metadata?.shotId === planShot.shotId)?.status === 'authorized')
        if (pending.length === 0) throw new Error(`没有待继续的镜头：${jobsOf(run)}`)
        const last = pending.at(-1)
        await zoomShot(win, 'U2', 'zh-stopped-shot', [last.nodeId])
        await focusNode(win, last.nodeId)
        await shot('U2', 'zh-stopped-shot')
        await clickOrFail(win.locator(`[data-node-id="${last.nodeId}"] [data-production-shot-action]`).first(), '第 3 镜「继续剩余」', { noWaitAfter: true })
        const before = walk.fixture.images.length
        try {
          await expect.poll(() => walk.fixture.images.length, { timeout: stationTimeout({ operations: 4 }) }).toBe(before + pending.length)
        } catch {
          // 派不出去时如实写清卡在哪：Run 的状态、每镜的 job、批准信封的到期时间对比现在。
          const after = readRun(projectRoot, operationId)
          const expiresAt = after?.gates?.filter((gate) => gate.scope === 'budget_envelope' && gate.authorizationEnvelope).at(-1)?.authorizationEnvelope?.expiresAt
          const lapsed = expiresAt && Date.parse(expiresAt) <= Date.now()
          throw new Error(`点了「继续剩余」，剩下的镜头没有派出去（夹具只收到 ${walk.fixture.images.length - before} 笔）：Run ${after?.status} · ${jobsOf(after)}`
            + `${lapsed ? ` · 批准信封 ${expiresAt} 到期（现在 ${new Date().toISOString()}）——派发时核「授权过期」，一直拒` : ''}`)
        }
        await expect.poll(() => readRun(projectRoot, operationId).jobs.filter((job) => job.status === 'ready' || job.status === 'adopted').length,
          { timeout: stationTimeout({ operations: 4 }) }).toBe(run.generationPlan.shots.length)
        return jobsOf(readRun(projectRoot, operationId))
      })
      await fitView(win)
      await shot('U2', 'zh-after-resume')
      await zoomShot(win, 'U2', 'zh-after-resume', nodeIds)
      await setLocale(win, 'en')
      await fitView(win)
      await shot('U2', 'en-after-resume')
      await zoomShot(win, 'U2', 'en-after-resume', nodeIds)
    } else {
      await fitView(win)
      await row('U3', '升级：上一版参考卡失败后一直「进行中」的批次（视频镜一直排队），打开后如实停下，不说「预算已用完 / 提额续拍」', async () => {
        await expect.poll(async () => (await faces(win, nodeIds)).some((face) => face.placeholder === 'stopped'), { timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
        await assertNoBudgetCopy(win, nodeIds, '升级后的旧制作')
        return JSON.stringify((await faces(win, nodeIds)).map((face) => face.placeholderText ?? face.failure))
      })
      await shot('U3', 'zh-legacy-stopped')
      await zoomShot(win, 'U3', 'zh-legacy-stopped', [nodeIds.at(-1)])
      await setLocale(win, 'en')
      await fitView(win)
      await row('U4', '升级（英文）：同一个旧制作，英文界面也不说预算、没有中文', async () => {
        await assertNoBudgetCopy(win, nodeIds, '英文界面')
        for (const face of await faces(win, nodeIds)) if (face.placeholderText) assertNoCjk(face.placeholderText, `卡 ${face.id}`)
        return JSON.stringify((await faces(win, nodeIds)).map((face) => face.placeholderText))
      })
      await shot('U4', 'en-legacy-stopped')
      await zoomShot(win, 'U4', 'en-legacy-stopped', [nodeIds.at(-1)])
    }
  } else {
    const { projectId, projectRoot, name: projectName } = await walk.newProject()
    walk.report.seed = { scenario: SCENARIO, projectId, projectRoot, projectName }
    await openCanvas(win)
    await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, CANVAS_PANEL)
    const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
    if (await consent.isVisible().catch(() => false)) await consent.click()

    if (SCENARIO === 'consent-late-release') {
      const videoShot = (n, prompt) => ({ title: `镜${n}`, prompt, taskKind: 'text_to_video', candidate: VIDEO, durationSec: 4, parameters: { resolution: '480p', generate_audio: false } })
      const shots = [
        { title: '渔港参考', role: 'anchor', storyboard: { kind: 'scene', carrier: 'visual' }, prompt: '清晨的渔港全景，薄雾', taskKind: 'text_to_image', candidate: IMAGE },
        videoShot(1, '清晨渔港，小船轻晃'), videoShot(2, '码头上一只猫晒太阳'),
      ]
      const { operationId, planShots, goDone } = await draftAndRelease(win, projectRoot, { tag: 'PCL', shots })
      walk.report.seed.operationId = operationId
      await recorded(goDone.received, 'generate returns')
      const [, video1, video2] = planShots
      await row('C1', '参考卡出图后停在「形象确认」，两镜视频批过了、还没派', async () => {
        await expect.poll(() => readRun(projectRoot, operationId)?.gates?.find((gate) => gate.scope === 'anchor_checkpoint')?.status ?? null,
          { timeout: stationTimeout({ operations: 8 }) }).toBe('waiting')
        return jobsOf(readRun(projectRoot, operationId))
      })
      const lapsedAt = await outlastConsentWindow(projectRoot, operationId)
      await openTaskCard(win)
      await shot('C2', 'zh-checkpoint-after-window')
      await clickOrFail(win.locator(`${TASK_CARD} [data-production-primary-action]`).first(), '制作卡主按钮（过目后开拍）')
      await clickOrFail(win.locator('[data-anchor-checkpoint-primary][data-anchor-checkpoint-mode="approve"]'), '形象确认卡「开拍」（同意窗口已过）')
      await closeTaskPanel(win)
      await row('C2', `过了同意窗口（${lapsedAt} 之后）才放行形象：这一下点击续上同意，两镜视频照样派出去（不卡在「排队中」）`, async () => {
        await expect.poll(() => walk.fixture.videos.length, { timeout: stationTimeout({ operations: 4 }) }).toBe(2)
        return `${jobsOf(readRun(projectRoot, operationId))} · 续同意：${JSON.stringify(renewedBy(projectRoot, operationId))}`
      })
      await fitView(win)
      await shot('C2', 'zh-videos-generating')
      await zoomShot(win, 'C2', 'zh-videos-generating', [video1.nodeId, video2.nodeId])
      walk.fixture.releaseVideos()
      await row('C3', '两镜视频出片、落回各自的卡；整批收尾', async () => {
        for (const planShot of [video1, video2]) {
          await expect(win.locator(`[data-node-id="${planShot.nodeId}"][data-status="success"]`)).toBeVisible({ timeout: stationTimeout({ operations: 6 }) })
        }
        await expect.poll(() => readRun(projectRoot, operationId)?.status, { timeout: stationTimeout({ operations: 4 }) }).not.toBe('running')
        return `${readRun(projectRoot, operationId).status} · ${jobsOf(readRun(projectRoot, operationId))}`
      })
      await fitView(win)
      await shot('C3', 'zh-landed')
      await zoomShot(win, 'C3', 'zh-landed', [video1.nodeId, video2.nodeId])
      await setLocale(win, 'en')
      await fitView(win)
      await shot('C3', 'en-landed')
      await zoomShot(win, 'C3', 'en-landed', [video1.nodeId, video2.nodeId])
    } else if (SCENARIO === 'consent-late-resume') {
      const imageShot = (n, prompt) => ({ title: `镜${n}`, prompt, taskKind: 'text_to_image', candidate: IMAGE })
      const shots = [imageShot(1, '清晨渔港'), imageShot(2, '码头的猫'), imageShot(3, '海鸥')]
      const { operationId, planShots, goDone } = await draftAndRelease(win, projectRoot, { tag: 'PCR', shots, beforeGenerate: () => walk.fixture.holdSubmits(true) })
      walk.report.seed.operationId = operationId
      const [, , shot3] = planShots
      const nodeIds = planShots.map((planShot) => planShot.nodeId)
      await expect.poll(() => walk.fixture.images.length, { message: '第 1 镜的提交到了夹具（压着）', timeout: stationTimeout({ operations: 4 }) }).toBe(1)
      await openTaskCard(win)
      await clickOrFail(win.locator(`${TASK_CARD} [data-production-control="pause"]`).first(), '任务卡「暂停」（急停）')
      await expect.poll(() => readRun(projectRoot, operationId)?.status, { timeout: DEFAULT_TIMEOUT_MS }).toMatch(/^paus/)
      await closeTaskPanel(win)
      walk.fixture.holdSubmits(false)
      await recorded(goDone.received, 'generate returns')
      await row('C4', '急停后第 1 镜收尾，落到「已暂停」', async () => {
        await expect.poll(() => readRun(projectRoot, operationId)?.status, { timeout: stationTimeout({ operations: 4 }), intervals: [500] }).toBe('paused')
        return jobsOf(readRun(projectRoot, operationId))
      })
      const lapsedAt = await outlastConsentWindow(projectRoot, operationId)
      await row('C5', `过了同意窗口（${lapsedAt} 之后）才点「继续剩余」：这一下点击续上同意，剩下两镜派出去并出片`, async () => {
        await focusNode(win, shot3.nodeId)
        await shot('C5', 'zh-stopped-shot3-after-window')
        await zoomShot(win, 'C5', 'zh-stopped-shot3-after-window', [shot3.nodeId])
        await clickOrFail(win.locator(`[data-node-id="${shot3.nodeId}"] [data-production-shot-action]`).first(), '第 3 镜「继续剩余」', { noWaitAfter: true })
        await expect.poll(() => walk.fixture.images.length, { timeout: stationTimeout({ operations: 4 }) }).toBe(3)
        await expect.poll(() => readRun(projectRoot, operationId).jobs.filter((job) => job.status === 'ready' || job.status === 'adopted').length,
          { timeout: stationTimeout({ operations: 4 }) }).toBe(3)
        return `${jobsOf(readRun(projectRoot, operationId))} · 续同意：${JSON.stringify(renewedBy(projectRoot, operationId))}`
      })
      await fitView(win)
      await shot('C5', 'zh-after-resume')
      await zoomShot(win, 'C5', 'zh-after-resume', nodeIds)
      await setLocale(win, 'en')
      await fitView(win)
      await shot('C5', 'en-after-resume')
      await zoomShot(win, 'C5', 'en-after-resume', nodeIds)
    } else if (SCENARIO === 'checkpoint' || SCENARIO === 'anchor-fail') {
      const videoShot = (n, prompt) => ({ title: `镜${n}`, prompt, taskKind: 'text_to_video', candidate: VIDEO, durationSec: 4, parameters: { resolution: '480p', generate_audio: false } })
      const shots = [
        { title: '渔港参考', role: 'anchor', storyboard: { kind: 'scene', carrier: 'visual' }, prompt: '清晨的渔港全景，薄雾', taskKind: 'text_to_image', candidate: IMAGE },
        videoShot(1, '清晨渔港，小船轻晃'), videoShot(2, '码头上一只猫晒太阳'),
      ]
      const { operationId, planShots, goDone } = await draftAndRelease(win, projectRoot, {
        tag: SCENARIO === 'checkpoint' ? 'PFC' : 'PFA', shots,
        // 参考卡交给供应商之后，供应商判它失败（夹具的逐笔失败注入：受理成功、轮询回 failed）。
        beforeGenerate: () => { if (SCENARIO === 'anchor-fail') walk.fixture.setMediaBehavior(({ kind }) => (kind === 'image' ? { fail: { message: 'fixture: image generation failed' } } : undefined)) },
      })
      walk.report.seed.operationId = operationId
      await recorded(goDone.received, 'generate returns')
      const [anchor, video1, video2] = planShots
      const nodeIds = planShots.map((planShot) => planShot.nodeId)

      if (SCENARIO === 'checkpoint') {
        await row('T1', '参考卡出图后，任务面板里出现「形象确认」', async () => {
          await expect.poll(() => readRun(projectRoot, operationId)?.gates?.find((gate) => gate.scope === 'anchor_checkpoint')?.status ?? null,
            { timeout: stationTimeout({ operations: 8 }) }).toBe('waiting')
          const run = readRun(projectRoot, operationId)
          return `参考卡 ${jobsOf(run)}；封信封时项目版本 ${run.gates?.filter((gate) => gate.scope === 'budget_envelope' && gate.authorizationEnvelope).at(-1)?.authorizationEnvelope?.projectRevision}`
        })
        await openTaskCard(win)
        await shot('T1', 'zh-checkpoint-card')
        await clickOrFail(win.locator(`${TASK_CARD} [data-production-primary-action]`).first(), '制作卡主按钮（过目后开拍）')
        await row('T1b', '形象确认卡：今天没有价格，说明行不提预算（以前拼成「按已批准的 已批准的 预算开拍」）', async () => {
          const card = win.locator('[data-anchor-checkpoint-card]').first()
          await expect(card).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
          const note = (await win.locator('[data-anchor-checkpoint-note]').first().textContent())?.trim() ?? ''
          if (BUDGET_COPY.test(note) || /预算|budget/i.test(note)) throw new Error(`说明行提到了预算：「${note}」`)
          if (/已批准的\s*已批准的/.test(note)) throw new Error(`说明行重复：「${note}」`)
          const file = path.join(walk.outputDir, `z${String(++zoomCount).padStart(2, '0')}-T1b-zh-checkpoint-card.png`)
          await screenshotSettled(card, { path: file })
          const entry = (rows.T1b ??= { title: '', ok: false, detail: '', shots: [] })
          entry.shots = [...entry.shots, file]
          return note
        })
        await clickOrFail(win.locator('[data-anchor-checkpoint-primary][data-anchor-checkpoint-mode="approve"]'), '形象确认卡「开拍」')
        await closeTaskPanel(win)
        await row('T2', '放行形象后，两镜视频真的派出去（不卡在「排队中」）', async () => {
          await expect.poll(() => walk.fixture.videos.length, { timeout: stationTimeout({ operations: 4 }) }).toBe(2)
          return jobsOf(readRun(projectRoot, operationId))
        })
        await fitView(win)
        await shot('T2', 'zh-videos-generating')
        await zoomShot(win, 'T2', 'zh-videos-generating', [video1.nodeId, video2.nodeId])
        walk.fixture.releaseVideos()
        await row('T3', '两镜视频出片、落回各自的卡；整批收尾，Run 不再一直「进行中」', async () => {
          for (const planShot of [video1, video2]) {
            await expect(win.locator(`[data-node-id="${planShot.nodeId}"][data-status="success"]`)).toBeVisible({ timeout: stationTimeout({ operations: 6 }) })
          }
          await expect.poll(() => readRun(projectRoot, operationId)?.status, { timeout: stationTimeout({ operations: 4 }) }).not.toBe('running')
          return `${readRun(projectRoot, operationId).status} · ${jobsOf(readRun(projectRoot, operationId))}`
        })
        await fitView(win)
        await shot('T3', 'zh-landed')
        await zoomShot(win, 'T3', 'zh-landed', [video1.nodeId, video2.nodeId])
        await row('T4', '全程没有「预算已用完 / 提额续拍」', async () => {
          await assertNoBudgetCopy(win, [anchor.nodeId, video1.nodeId, video2.nodeId], '整条路走完')
          return 'ok：镜头卡、任务面板、提示框上都没有'
        })
        await openTaskCard(win)
        await shot('T3', 'zh-task-card-settled')
        await closeTaskPanel(win)
        await setLocale(win, 'en')
        await fitView(win)
        await shot('T3', 'en-landed')
        await zoomShot(win, 'T3', 'en-landed', [video1.nodeId, video2.nodeId])
      } else {
        await row('T5', '参考卡生成失败后，Run 停下来（不会一直转）', async () => {
          await expect.poll(() => readRun(projectRoot, operationId)?.status, { timeout: stationTimeout({ operations: 6 }), intervals: [500] }).toBe('needs_attention')
          return jobsOf(readRun(projectRoot, operationId))
        })
        await fitView(win)
        await row('T6', '没开拍的视频镜说真实原因：不出现「预算已用完 / 提额续拍」', async () => {
          await expect.poll(async () => (await faces(win, [video1.nodeId, video2.nodeId])).every((face) => face.placeholder === 'stopped'),
            { timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
          const all = await faces(win, [video1.nodeId, video2.nodeId])
          if (all.some((face) => BUDGET_COPY.test(face.placeholderText ?? ''))) {
            throw new Error(`视频镜上挂着预算文案：${JSON.stringify(all.map((face) => [face.placeholderText, face.action]))}`)
          }
          return JSON.stringify(all.map((face) => [face.placeholderText, face.action]))
        })
        await shot('T6', 'zh-shots-after-anchor-failed')
        await zoomShot(win, 'T6', 'zh-shots-after-anchor-failed', [video1.nodeId])
        await row('T7', '在失败的参考卡上点「重试」：说人话，不拼主进程英文原话', async () => {
          await focusNode(win, anchor.nodeId)
          const retry = win.locator(`[data-node-id="${anchor.nodeId}"] [role="alert"] button`).filter({ hasText: /^(重试|仍要重试|Retry|Retry anyway)$/ }).first()
          await expect(retry).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
          await retry.click()
          let feedback = null
          await expect.poll(async () => { feedback = (await faces(win, [anchor.nodeId]))[0].feedback; return Boolean(feedback) }, { timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
          if (RAW_MAIN_TEXT.test(feedback)) throw new Error(`反馈里拼着主进程原话：「${feedback}」`)
          if (/^操作没成功，请稍后再试$/.test(feedback)) throw new Error('反馈只有一句「操作没成功，请稍后再试」，没说原因和能做什么')
          return feedback
        })
        await shot('T7', 'zh-anchor-retry-feedback')
        await zoomShot(win, 'T7', 'zh-anchor-retry-feedback', [anchor.nodeId])
        await setLocale(win, 'en')
        await fitView(win)
        await row('T8', '英文界面：视频镜不说预算、没有中文', async () => {
          const all = await faces(win, [video1.nodeId, video2.nodeId])
          if (all.some((face) => BUDGET_COPY.test(face.placeholderText ?? ''))) throw new Error(`英文界面有预算文案：${JSON.stringify(all.map((face) => face.placeholderText))}`)
          for (const face of all) if (face.placeholderText) assertNoCjk(face.placeholderText, `卡 ${face.id}`)
          return JSON.stringify(all.map((face) => face.placeholderText))
        })
        await shot('T8', 'en-shots-after-anchor-failed')
        await zoomShot(win, 'T8', 'en-shots-after-anchor-failed', [video1.nodeId])
        await row('T9', '英文界面：参考卡「重试」的反馈是英文人话', async () => {
          await focusNode(win, anchor.nodeId)
          const retry = win.locator(`[data-node-id="${anchor.nodeId}"] [role="alert"] button`).filter({ hasText: /^(Retry|Retry anyway)$/ }).first()
          await expect(retry).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
          await retry.click()
          let feedback = null
          await expect.poll(async () => { feedback = (await faces(win, [anchor.nodeId]))[0].feedback; return Boolean(feedback) }, { timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
          assertNoCjk(feedback, '参考卡反馈')
          if (RAW_MAIN_TEXT.test(feedback)) throw new Error(`反馈里拼着主进程原话：「${feedback}」`)
          return feedback
        })
        await shot('T9', 'en-anchor-retry-feedback')
        await zoomShot(win, 'T9', 'en-anchor-retry-feedback', [anchor.nodeId])
        walk.report.seed.nodeIds = nodeIds
      }
    } else {
      // ── 三镜图片：第 1 镜的提交压在夹具里时按急停 ──
      const imageShot = (n, prompt) => ({ title: `镜${n}`, prompt, taskKind: 'text_to_image', candidate: IMAGE })
      const shots = [imageShot(1, '清晨渔港'), imageShot(2, '码头的猫'), imageShot(3, '海鸥')]
      const { operationId, planShots, goDone } = await draftAndRelease(win, projectRoot, {
        tag: SCENARIO === 'pause-settle' ? 'PFP' : 'PFE', shots,
        beforeGenerate: () => walk.fixture.holdSubmits(true),
      })
      walk.report.seed.operationId = operationId
      const [, , shot3] = planShots
      const nodeIds = planShots.map((planShot) => planShot.nodeId)
      await expect.poll(() => walk.fixture.images.length, { message: '第 1 镜的提交到了夹具（压着）', timeout: stationTimeout({ operations: 4 }) }).toBe(1)
      await openTaskCard(win)
      await clickOrFail(win.locator(`${TASK_CARD} [data-production-control="pause"]`).first(), '任务卡「暂停」（急停）')
      await expect.poll(() => readRun(projectRoot, operationId)?.status, { timeout: DEFAULT_TIMEOUT_MS }).toMatch(/^paus/)
      await closeTaskPanel(win)

      if (SCENARIO === 'pause-resume-early') {
        await row('T13', '急停后第 1 镜还没回来就点「继续剩余」：直接接着拍，不报错', async () => {
          await focusNode(win, shot3.nodeId)
          await expect(win.locator(`[data-node-id="${shot3.nodeId}"] [data-production-shot-action]`).first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
          await shot('T13', 'zh-pausing-before-resume')
          await zoomShot(win, 'T13', 'zh-pausing-before-resume', [shot3.nodeId])
          await clickOrFail(win.locator(`[data-node-id="${shot3.nodeId}"] [data-production-shot-action]`).first(), '第 3 镜「继续剩余」', { noWaitAfter: true })
          await expect.poll(() => readRun(projectRoot, operationId)?.status, { timeout: DEFAULT_TIMEOUT_MS }).toBe('running')
          const feedback = (await faces(win, [shot3.nodeId]))[0].feedback
          if (feedback && (RAW_MAIN_TEXT.test(feedback) || /没成功|failed/i.test(feedback))) throw new Error(`点了继续报错：「${feedback}」`)
          return feedback ?? '没有报错'
        })
        walk.fixture.holdSubmits(false)
        await recorded(goDone.received, 'generate returns')
        await row('T14', '接着拍：三镜都出片', async () => {
          await expect.poll(() => walk.fixture.images.length, { timeout: stationTimeout({ operations: 4 }) }).toBe(3)
          await expect.poll(() => readRun(projectRoot, operationId).jobs.filter((job) => job.status === 'ready' || job.status === 'adopted').length,
            { timeout: stationTimeout({ operations: 4 }) }).toBe(3)
          return jobsOf(readRun(projectRoot, operationId))
        })
        await fitView(win)
        await shot('T14', 'zh-all-landed')
        await zoomShot(win, 'T14', 'zh-all-landed', nodeIds)
      } else {
        walk.fixture.holdSubmits(false)
        await recorded(goDone.received, 'generate returns')
        await row('T10', '急停后在跑的那一镜收尾，Run 落到「已暂停」（不再一直转）', async () => {
          await expect.poll(() => readRun(projectRoot, operationId)?.status, { timeout: stationTimeout({ operations: 4 }), intervals: [500] }).toBe('paused')
          return jobsOf(readRun(projectRoot, operationId))
        })
        await openTaskCard(win)
        await shot('T10', 'zh-task-card-after-pause')
        await closeTaskPanel(win)
        await row('T11', '「继续剩余」能用：剩下两镜派出去并出片', async () => {
          await focusNode(win, shot3.nodeId)
          await shot('T11', 'zh-stopped-shot3')
          await zoomShot(win, 'T11', 'zh-stopped-shot3', [shot3.nodeId])
          await clickOrFail(win.locator(`[data-node-id="${shot3.nodeId}"] [data-production-shot-action]`).first(), '第 3 镜「继续剩余」', { noWaitAfter: true })
          let feedback = null
          await expect.poll(async () => {
            feedback = (await faces(win, [shot3.nodeId]))[0].feedback
            return walk.fixture.images.length >= 3 || Boolean(feedback)
          }, { timeout: stationTimeout({ operations: 4 }) }).toBe(true)
          if (walk.fixture.images.length < 3) throw new Error(`没有继续，节点反馈：「${feedback}」`)
          await expect.poll(() => readRun(projectRoot, operationId).jobs.filter((job) => job.status === 'ready' || job.status === 'adopted').length,
            { timeout: stationTimeout({ operations: 4 }) }).toBe(3)
          return jobsOf(readRun(projectRoot, operationId))
        })
        await fitView(win)
        await shot('T11', 'zh-after-resume')
        await zoomShot(win, 'T11', 'zh-after-resume', nodeIds)
        await row('T12', '「继续剩余」出错时说人话（不拼主进程英文原话）', async () => {
          const all = await faces(win, nodeIds)
          const bad = all.find((face) => face.feedback && RAW_MAIN_TEXT.test(face.feedback))
          if (bad) throw new Error(`卡 ${bad.id} 的反馈拼着主进程原话：「${bad.feedback}」`)
          return JSON.stringify(all.map((face) => face.feedback).filter(Boolean))
        })
        await setLocale(win, 'en')
        await fitView(win)
        await shot('T11', 'en-after-resume')
        await zoomShot(win, 'T11', 'en-after-resume', nodeIds)
      }
    }
    walk.report.seed.nodeIds ??= undefined
  }
  const summary = Object.entries(rows).map(([id, entry]) => `${id} ${entry.ok ? 'PASS' : 'FAIL'}`).join(' · ')
  log('rows', summary)
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  walk.fixture?.holdSubmits(false)
  await walk.finish(failure, { unscriptedFixture: true })
}
