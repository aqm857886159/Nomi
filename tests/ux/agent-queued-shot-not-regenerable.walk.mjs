#!/usr/bin/env node
// 真实用户任务（R13）：**Agent 起草两镜、用户点了确认之后，还没轮到的那一镜不能从画布再发一次。**
//
// 2026-09-25（T-AG-24 / #875）：确认之后，排队中的那一镜在节点上是闲着的（排队只住在制作流程里，节点自己的状态还是 idle），
// 于是框菜单「生成整框」照样把它算进去，选中它时节点的生成钮也能按——再按一次就是同一镜重复生成、重复扣费。
// #875 让画布的生成入口（底栏 / 框菜单 / 节点生成钮）都读制作流程对这一镜的归属。
//
// 怎么造出「真的在排队」：制作流程逐镜**顺序**派发（multiShotBatchScheduler：`await dispatchUnit` 一镜一镜来），
// 夹具把第一镜的受理压着不回，第二镜就停在「已授权、还没轮到」——供应商那边一次都没收到它。
// （定妆图 + 视频造不出来：有定妆图时第一轮只勾定妆图，视频镜不在已派出的范围里，那是「还没点头」，不是排队。）
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM,
  chooseAssistantModel, createRuntimeWalk, openCanvas, readProject, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

// 有价目的那一档：报得出合计，卡上才有「逐镜 / 全部」；价格未知时只能逐镜确认，一次只派一镜，造不出排队。

const ASK = 'S_QUEUE_ASK：画两张橘猫：一张在窗台晒太阳，一张在沙发上打盹。先别生成。'
const GO = 'S_QUEUE_GO：好，生成吧。'
const PLAN_CALL = 's-queue-plan-1'
const GENERATE_CALL = 's-queue-go-1'
const GENERATE_BUTTON = '[data-bar-segment="generate"]'
const candidate = { providerId: FIXTURE_APIMART_VENDOR, modelId: FIXTURE_APIMART_MODEL }

function readRun(projectRoot, runId) {
  const snapshot = path.join(projectRoot, '.nomi', 'runs', runId, 'run.json')
  if (!fs.existsSync(snapshot)) return null
  return JSON.parse(fs.readFileSync(snapshot, 'utf8')).run
}

/** 节点此刻在屏上说了什么：状态行相位与批次占位（排队中 · 第 n/N）。 */
function nodeFace(win, nodeId) {
  return win.evaluate((id) => {
    const node = document.querySelector(`[data-node-id="${id}"]`)
    return {
      present: Boolean(node),
      phase: node?.querySelector('[data-generation-status]')?.getAttribute('data-phase') ?? null,
      placeholder: node?.querySelector('[data-shot-placeholder-state]')?.getAttribute('data-shot-placeholder-state') ?? null,
    }
  }, nodeId)
}

/** 整窗截图之外再裁一张近景（画布缩得小，小标和按钮在整窗图里看不清）：几个元素的外接框外扩 24px。 */
async function snapCloseUp(win, file, locators) {
  const boxes = (await Promise.all(locators.map((locator) => locator.boundingBox()))).filter(Boolean)
  const x = Math.max(0, Math.min(...boxes.map((box) => box.x)) - 24)
  const y = Math.max(0, Math.min(...boxes.map((box) => box.y)) - 24)
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + 24
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + 24
  await win.screenshot({ path: file.replace(/\.png$/, '-closeup.png'), clip: { x, y, width: right - x, height: bottom - y } })
}

/** 把画布放大到框够宽（⌘/Ctrl + 滚轮恒缩放、锚在光标）。锚在框的左上角，框往右下长，不钻到左侧工具条下面。 */
async function zoomOntoFrame(win, frame) {
  for (let step = 0; step < 8; step += 1) {
    const box = await frame.boundingBox()
    if (!box || box.width >= 480) return
    await win.mouse.move(box.x + 20, box.y + 8)
    await win.keyboard.down('Control')
    await win.mouse.wheel(0, -200)
    await win.keyboard.up('Control')
    await expect.poll(async () => (await frame.boundingBox())?.width ?? 0, { message: '画布放大了', timeout: 3000 }).toBeGreaterThan(box.width)
  }
}

/**
 * 排队那一镜在屏上的全部证据：节点挂着排队小标；框菜单「生成整框」按不下去（两镜一在跑一在排，框里没有能再发的）；
 * 选中它时节点生成钮按不下去。先拍后判，修前修后都有图。
 * 两镜落在同一个框里，底栏「生成全部」这时不出现——框里的镜走框菜单这个入口，底栏那个入口由单镜走查（报价卡在等）覆盖。
 */
async function expectQueuedShotLocked(win, walk, { queuedNodeId, groupId, locale }) {
  await expect.poll(async () => (await nodeFace(win, queuedNodeId)).placeholder, { message: `${locale}：第二镜挂着「排队中」`, timeout: stationTimeout({ operations: 4 }) }).toBe('queued')
  const frame = win.locator(`[data-group-id="${groupId}"]`).first()
  await zoomOntoFrame(win, frame)
  await snapCloseUp(win, await walk.snap(`queued-canvas-${locale}`), [frame])

  await clickOrFail(frame.locator('[data-frame-more="true"]').first(), `${locale}：打开框菜单`)
  const generateFrame = win.locator('[data-frame-menu="true"] [role="menuitem"]').filter({ hasText: locale === 'zh' ? '生成整框' : 'Generate the whole frame' })
  await proveProbe(generateFrame, `${locale}：框菜单里有「生成整框」`)
  await snapCloseUp(win, await walk.snap(`queued-frame-menu-${locale}`), [frame, win.locator('[data-frame-menu="true"]')])
  const frameGenerateDisabled = await generateFrame.isDisabled()
  await win.keyboard.press('Escape')

  await clickOrFail(win.locator(`[data-node-id="${queuedNodeId}"]`).first(), `${locale}：选中排队中的第二镜`)
  const button = win.locator(GENERATE_BUTTON).first()
  await proveProbe(button, `${locale}：选中后节点生成钮出现`)
  await snapCloseUp(win, await walk.snap(`queued-selected-${locale}`), [win.locator(`[data-node-id="${queuedNodeId}"]`).first(), button])
  expect(frameGenerateDisabled, `${locale}：「生成整框」按不下去`).toBe(true)
  await expect(button, `${locale}：排队中的这一镜，生成钮按不下去`).toBeDisabled()
  await win.keyboard.press('Escape')
}

const walk = await createRuntimeWalk('queued-shot-not-regenerable', { generationProvider: 'apimart' })
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  const projectRoot = walk.report.projectRoot
  await openCanvas(win)
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, CANVAS_PANEL)
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()

  // ── ① 草稿：两镜，先别生成 ──
  const planner = walk.fixture.expectText({
    label: 'the agent drafts two image shots',
    match: (body) => flattenRequestText(body).includes('S_QUEUE_ASK'),
    reply: { type: 'tool', id: PLAN_CALL, name: 'draft_shots', args: {
      shots: [
        { title: '窗台', prompt: '一只橘猫在窗台上晒太阳', taskKind: 'text_to_image', candidate },
        { title: '沙发', prompt: '一只橘猫在沙发上打盹', taskKind: 'text_to_image', candidate },
      ],
    } },
  })
  let operationId
  const drafted = walk.fixture.expectText({
    label: 'the draft result comes back and the agent waits',
    match: (body) => {
      const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === PLAN_CALL)
      if (!result || flattenRequestText(body).includes('S_QUEUE_GO')) return false
      operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
      return true
    },
    reply: { type: 'text', text: 'S_QUEUE_HOLD_DONE：两镜都建好了，等你说一声就生成。' },
  })
  await sendCanvas(win, ASK)
  await recorded(planner.received, 'draft request')
  await recorded(drafted.received, 'draft result')
  const shotNodes = async () => (await readProject(win, projectId)).payload.generationCanvas.nodes
    .filter((node) => node.meta?.productionRunId === operationId && node.kind === 'image')
  await expect.poll(async () => (await shotNodes()).length, { message: '草稿落成两个图片节点', timeout: DEFAULT_TIMEOUT_MS }).toBe(2)

  // ── ② 确认：第一镜的受理压着不回 → 第二镜排队 ──
  const goTurn = walk.fixture.expectText({
    label: 'the user says go and the agent presents the draft',
    match: (body) => flattenRequestText(body).includes('S_QUEUE_GO'),
    reply: { type: 'tool', id: GENERATE_CALL, name: 'generate', args: { operationId } },
  })
  const goDone = walk.fixture.expectText({
    label: 'generate returns once the card is answered',
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === GENERATE_CALL),
    reply: { type: 'text', text: 'S_QUEUE_GO_DONE：已开始生成。' },
  })
  await sendCanvas(win, GO)
  await recorded(goTurn.received, 'generate request')
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  await proveProbe(card, '报价卡摆在面板里等人')
  await clickOrFail(card.getByText('全部', { exact: true }), '卡上的范围切到「全部」（两镜一起派）')
  await walk.snap('card-two-shots-zh')
  walk.fixture.holdSubmits(true)
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), '卡上的主按钮', { noWaitAfter: true })
  await expect.poll(() => walk.fixture.images.length, { message: '第一镜的生成请求到了供应商', timeout: stationTimeout({ operations: 4 }) }).toBe(1)
  await recorded(goDone.received, 'generate returns after the approval')
  expect(readRun(projectRoot, operationId)?.generationPlan?.state, '计划已提交').toBe('submitted')

  // 盘上硬证据：两镜都勾进了这一批；一镜在提交（受理被夹具压着），另一镜已授权、还没轮到。
  expect((readRun(projectRoot, operationId)?.generationPlan?.shots ?? []).filter((shot) => shot.included !== false), '两镜都勾进了这一批').toHaveLength(2)
  const jobStatuses = () => (readRun(projectRoot, operationId)?.jobs ?? []).map((job) => job.status).sort().join(',')
  await expect.poll(jobStatuses, { message: '一镜在提交、一镜已授权待派', timeout: stationTimeout({ operations: 2 }) }).toBe('authorized,submitting')
  // 第二镜 = 已派出范围里、供应商还没收到的那一镜；它的节点是两个里挂着排队小标的那个。
  const nodes = await shotNodes()
  await expect.poll(async () => (await Promise.all(nodes.map((node) => nodeFace(win, node.id)))).filter((face) => face.placeholder === 'queued').length,
    { message: '两个节点里恰好一个在排队', timeout: stationTimeout({ operations: 4 }) }).toBe(1)
  const faces = await Promise.all(nodes.map((node) => nodeFace(win, node.id)))
  const queuedNode = nodes[faces.findIndex((face) => face.placeholder === 'queued')]
  const groupId = (await readProject(win, projectId)).payload.generationCanvas.groups
    .find((group) => group.nodeIds.includes(queuedNode.id))?.id
  expect(Boolean(groupId), '两镜落在同一个框里').toBe(true)

  // ── ③ 排队那一镜：框菜单与节点生成钮都发不出第二次（zh + en） ──
  await expectQueuedShotLocked(win, walk, { queuedNodeId: queuedNode.id, groupId, locale: 'zh' })
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload()
  await expectQueuedShotLocked(win, walk, { queuedNodeId: queuedNode.id, groupId, locale: 'en' })
  expect(walk.fixture.images, '整个过程里画布没有替它再发一次').toHaveLength(1)

  walk.report.verified = ['queued-shot-frame-generate-disabled', 'queued-shot-generate-button-disabled']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  walk.fixture?.holdSubmits(false)
  await walk.finish(failure)
}
