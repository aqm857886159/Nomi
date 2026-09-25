#!/usr/bin/env node
// 真实用户任务（R13）：**「在画布上加一个图片节点，提示词写：…。先别生成。」之后，屏上说的是不是真话。**
//
// 2026-09-24 真模型走查（Windows，DeepSeek V4 Pro）：Agent 调 draft_shots 建好草稿、回「等你说一声就生成」，
// 节点却立刻挂上「排队中 · 第 1/1」，右上角任务按钮变蓝亮 1——说了「先别生成」的人读到的是「在排队、要扣钱」。
// 盘上实查那一刻：Run draft、0 个 job、0 道门、账本 0、供应商 0 次请求。钱没花，是字说错了。
// 同一次还查出：Agent 派出去的镜「生成中」是一层 8-25 的旧遮罩（模糊 + 大 N），9-08 普通节点换像素动画时没跟上。
//
// 用户拍板（样张 docs/design/2026-09-24-draft-shot-honest-status-mockup.html）：
//   ① 草稿节点什么都不挂；③ 报价卡在等人那一刻同草稿；④ 点了之后生成中走普通节点那一套（像素等待面 + 状态行）。
//   ② 任务面板那一半由 #869（2026-09-25 拍板的任务面板样张）接手：draft_shots 建的草稿不进任务列表，
//   报价卡在等人时归「等你处理」——这里按那一版断言，不另立一套。④ 的画法由 #870 落进节点自己的运行记录。
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
// 四个时刻，每个都用盘上的 Run 与夹具收到的请求数做硬证据，再看屏上说了什么：
//   草稿 → 报价卡在等 → 点了、供应商那边还在跑（夹具把任务停在 processing）→ 出图。
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM,
  chooseAssistantModel, createRuntimeWalk, openCanvas, readProject, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

// 干净装机那一档：目录里没有价目（确认后才封印，报价卡在等人时计划仍是 draft）。
process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const ASK = 'S_DRAFT_HOLD：在画布上加一个图片节点，提示词写：一只在窗台上晒太阳的橘猫。先别生成。'
const GO = 'S_DRAFT_GO：好，现在生成吧。'
const PLAN_CALL = 's-draft-hold-1'
const GENERATE_CALL = 's-draft-go-1'
const TASK_TRIGGER = '[data-task-center-trigger="true"]'
/** 任务按钮上那颗数字（只在有东西在跑/排队时出现）。 */
const TASK_COUNT = `${TASK_TRIGGER} > span.rounded-pill`
const TASK_PANEL = '[data-nomi-right-panel="tasks"]'

function readRun(projectRoot, runId) {
  const snapshot = path.join(projectRoot, '.nomi', 'runs', runId, 'run.json')
  if (!fs.existsSync(snapshot)) return null
  return JSON.parse(fs.readFileSync(snapshot, 'utf8')).run
}

/** 这个节点此刻在屏上说了什么（只看用户看得见的那几样）。 */
function nodeFace(win, nodeId) {
  return win.evaluate((id) => {
    const node = document.querySelector(`[data-node-id="${id}"]`)
    return {
      present: Boolean(node),
      waiting: Boolean(node?.querySelector('[data-generation-waiting]')),
      phase: node?.querySelector('[data-generation-status]')?.getAttribute('data-phase') ?? null,
      placeholder: node?.querySelector('[data-shot-placeholder-state]')?.getAttribute('data-shot-placeholder-state') ?? null,
      oldOverlay: Boolean(node?.querySelector('.generation-canvas-v2-node__generating-overlay')),
      errorCard: Boolean(node?.querySelector('[role="alert"]')),
    }
  }, nodeId)
}

/** 「这个节点什么都没说」：没有等待面、没有状态行、没有批次占位、没有旧遮罩、没有错误卡。 */
function isQuiet(face) {
  return face.present && !face.waiting && face.phase === null && face.placeholder === null && !face.oldOverlay && !face.errorCard
}

/**
 * 画布落地 host 已经把这个 Run 读进来了吗。节点「什么都不说」只有在它读进来之后才算数——
 * 读进来之前节点本来就什么都不说（那是恒真的空话）。E2E 桥只在 `__nomiE2E` 下挂出来。
 */
function landingHasRun(win, runId) {
  return win.evaluate((id) => Boolean(window.__nomiProductionLandingStore?.getState().runs?.[id]), runId)
}

/** 草稿这一态在屏上的全部证据：节点什么都不说、任务按钮不亮、任务面板里没有这份草稿（#869：草稿不是任务）。 */
async function expectDraftFace(win, walk, nodeId, { runId, locale }) {
  await expect.poll(() => landingHasRun(win, runId), { message: `${locale}：画布落地 host 读到了这份草稿`, timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
  await clickOrFail(win.locator(TASK_TRIGGER).first(), `${locale}：打开任务面板`)
  const panelProof = await proveProbe(win.locator(TASK_PANEL), `${locale}：任务面板打开了`)
  await expectAbsent(win.locator(`${TASK_PANEL} [data-task-id="production-run:${runId}"], ${TASK_PANEL} [data-production-task-card]`),
    { provenBy: panelProof, message: `${locale}：还没点头的草稿不在任务列表里` })
  await walk.snap(`draft-task-panel-${locale}`)
  await win.keyboard.press('Escape')
  const face = await nodeFace(win, nodeId)
  expect(isQuiet(face), `${locale}：草稿节点什么都不挂（实得 ${JSON.stringify(face)}）`).toBe(true)
  await expect(win.locator(TASK_TRIGGER).first(), `${locale}：任务按钮不变蓝`).not.toHaveClass(/bg-nomi-accent/)
  await expect(win.locator(TASK_COUNT), `${locale}：任务按钮不显示数字`).toHaveCount(0)
  await walk.snap(`draft-${locale}`)
}

const walk = await createRuntimeWalk('draft-not-queued', { generationProvider: 'apimart' })
let failure
try {
  const { win } = await walk.start({ first: true })
  // 挂出画布落地 store 的 E2E 桥（见 landingHasRun）。只挂读口，不改任何行为。
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  const { projectId } = await walk.newProject()
  const projectRoot = walk.report.projectRoot
  await openCanvas(win)
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, CANVAS_PANEL)
  // 首启的遥测征询卡会盖住面板：按最保护隐私的那一档答，这也是真人默认会走的路。
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()

  // ── ① 草稿：Agent 只调 draft_shots，然后说「等你说一声」 ──
  const planner = walk.fixture.expectText({
    label: 'the agent drafts one titled image shot and does not generate',
    match: (body) => flattenRequestText(body).includes('S_DRAFT_HOLD'),
    reply: { type: 'tool', id: PLAN_CALL, name: 'draft_shots', args: {
      shots: [{ title: '窗台橘猫', prompt: '一只在窗台上晒太阳的橘猫', taskKind: 'text_to_image', candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: FIXTURE_APIMART_MODEL } }],
    } },
  })
  let operationId
  const drafted = walk.fixture.expectText({
    label: 'the draft result comes back and the agent says it will wait',
    match: (body) => {
      const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === PLAN_CALL)
      if (!result || flattenRequestText(body).includes('S_DRAFT_GO')) return false
      operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
      return true
    },
    reply: { type: 'text', text: 'S_DRAFT_HOLD_DONE：已建好，等你准备好随时说一声就生成。' },
  })
  await sendCanvas(win, ASK)
  await recorded(planner.received, 'draft request')
  await recorded(drafted.received, 'draft result')
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.length, { timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  const nodeId = (await readProject(win, projectId)).payload.generationCanvas.nodes[0].id
  expect((await readProject(win, projectId)).payload.generationCanvas.nodes[0].meta.productionRunId, '节点属于这份草稿').toBe(operationId)

  // 硬证据：盘上是草稿、没有 job，供应商一次都没被叫到。
  const draftRun = readRun(projectRoot, operationId)
  expect(draftRun?.status, 'Run 是草稿').toBe('draft')
  expect(draftRun?.generationPlan?.state, '计划是草稿').toBe('draft')
  expect(draftRun?.jobs ?? [], '没有任何生成任务').toHaveLength(0)
  expect(walk.fixture.images, '供应商一次生成请求都没收到').toHaveLength(0)

  // 屏上：节点什么都不说，任务按钮不亮。任务面板里出现这份草稿 = 任务中心已经轮询到它了，再判才不是假绿。
  await expect.poll(() => nodeFace(win, nodeId).then((face) => face.present), { timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
  await expectDraftFace(win, walk, nodeId, { runId: operationId, locale: 'zh' })
  // 英文同一态（R15：EN 串更长，截断只有眼睛看得出）。之后整条路都在英文下走。
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload()
  await expect.poll(() => nodeFace(win, nodeId).then((face) => face.present), { timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
  await expectDraftFace(win, walk, nodeId, { runId: operationId, locale: 'en' })

  // ── ② 报价卡在等人：节点同草稿 ──
  const goTurn = walk.fixture.expectText({
    label: 'the user now says go and the agent presents the draft',
    match: (body) => flattenRequestText(body).includes('S_DRAFT_GO'),
    reply: { type: 'tool', id: GENERATE_CALL, name: 'generate', args: { operationId } },
  })
  const goDone = walk.fixture.expectText({
    label: 'generate returns once the card is answered',
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === GENERATE_CALL),
    reply: { type: 'text', text: 'S_DRAFT_GO_DONE：已开始生成。' },
  })
  await sendCanvas(win, GO)
  await recorded(goTurn.received, 'generate request')
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  const cardProof = await proveProbe(card, '报价卡摆在面板的介入槽里等人')
  expect(readRun(projectRoot, operationId)?.jobs ?? [], '卡在等：仍然没有任何生成任务').toHaveLength(0)
  expect(walk.fixture.images, '卡在等：供应商仍然一次请求都没收到').toHaveLength(0)
  expect(await landingHasRun(win, operationId), '报价卡在等人：画布落地 host 仍读着这份 Run').toBe(true)
  expect(isQuiet(await nodeFace(win, nodeId)), '报价卡在等人：节点仍然什么都不挂').toBe(true)
  await walk.snap('card-waiting-en')
  // #875：报价卡摆出来等人 = 这一镜归制作流程，画布再发一次就是同一镜两笔。节点照样什么都不挂（上一句），
  // 但底栏不把它算进「生成全部」、选中它时生成钮按不下去。点一下空白画布取消选中（不按 Esc：会碰到面板上的卡）。
  const runAll = win.locator('[data-batch-dock="true"] [data-storyboard-run-all="true"]')
  expect(await runAll.count() === 0 || await runAll.first().isDisabled(), '报价卡在等人：底栏不提供「生成全部」').toBe(true)
  await clickOrFail(win.locator(`[data-node-id="${nodeId}"]`).first(), '选中报价卡在等的这一镜')
  const generateButton = win.locator('[data-bar-segment="generate"]').first()
  await proveProbe(generateButton, '选中后节点生成钮出现')
  await walk.snap('card-waiting-selected-en')
  await expect(generateButton, '报价卡在等人：节点生成钮按不下去').toBeDisabled()
  await win.locator('.react-flow__pane').first().click({ position: { x: 24, y: 24 } })
  await proveProbe(card, '取消选中后报价卡仍在等人')

  // ── ③ 点了：真的派出去；供应商那边停在 processing，拍「生成中」 ──
  walk.fixture.holdTasks(true)
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), '卡上的主按钮「仍要生成」', { noWaitAfter: true })
  await expect.poll(() => walk.fixture.images.length, { message: '按下之后供应商必须真的收到一次生成请求', timeout: stationTimeout({ operations: 4 }) }).toBe(1)
  await recorded(goDone.received, 'generate returns after the approval')
  await expectAbsent(card, { provenBy: cardProof, message: '答完的卡收起来' })
  await expect.poll(async () => (await nodeFace(win, nodeId)).phase, { message: '节点状态行说「生成中」', timeout: stationTimeout({ operations: 4 }) }).toBe('generating')
  const inFlight = await nodeFace(win, nodeId)
  expect(inFlight.waiting, `生成中 = 普通节点那一面像素等待面（实得 ${JSON.stringify(inFlight)}）`).toBe(true)
  expect(inFlight.oldOverlay, '旧的模糊遮罩 + 大 N 不在').toBe(false)
  expect(inFlight.placeholder, '旧的批次占位不在').toBeNull()
  await expect(win.locator(TASK_COUNT), '真的在跑：任务按钮亮 1').toHaveText('1')
  expect(readRun(projectRoot, operationId)?.generationPlan?.state, '计划已提交').toBe('submitted')
  await expect(win.locator(`[data-node-id="${nodeId}"] [data-generation-status]`), 'EN 状态行').toContainText('Generating')
  await walk.snap('dispatched-en')

  // 中文同一态：重开后拍「生成中」（回合已经结束，重开不会打断谁）。
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'zh-CN'))
  await win.reload()
  await expect.poll(async () => (await nodeFace(win, nodeId)).phase, { message: 'zh：重开后节点仍说「生成中」', timeout: stationTimeout({ operations: 4 }) }).toBe('generating')
  await expect(win.locator(`[data-node-id="${nodeId}"] [data-generation-status]`), 'zh 状态行').toContainText('生成中')
  await walk.snap('dispatched-zh')

  // ── ④ 出图：放开夹具，产物落回草稿那一刻建的那个节点 ──
  walk.fixture.holdTasks(false)
  await expect(win.locator(`[data-node-id="${nodeId}"][data-status="success"]`), '还是草稿那一刻建的那个节点，变成 success')
    .toBeVisible({ timeout: stationTimeout({ operations: 6 }) })
  expect((await nodeFace(win, nodeId)).phase, '出图后不再说「生成中」').not.toBe('generating')
  await walk.snap('done-zh')

  walk.report.verified = ['draft-says-nothing-and-spends-nothing', 'draft-not-counted-as-running-task',
    'card-waiting-says-nothing', 'card-waiting-canvas-cannot-regenerate', 'dispatched-uses-the-shared-waiting-surface', 'result-lands-on-the-drafted-node']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
