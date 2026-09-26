#!/usr/bin/env node
// 真实用户任务（R13）：Agent 起草两镜视频、我在卡上「全部」确认 → 两镜都在供应商那边跑 → 我重开窗口（zh，再 en）。
// 重开之后：两镜是不是还显示「生成中」？节点的 ↑ 能不能按？（底栏「生成全部」的归属见下方 expectBothInFlight 注释）
//
// 2026-09-26 真付费 T5 的 03 号截图：EN 重开之后第 2 镜「Generating」，第 1 镜却是一张空白的「Video node」——
// 看着像没在跑。用户以为它没跑、再点一次，就是同一镜付两次钱。这条走查把那一刻在零额度夹具上复现出来。
// 根因：画布重开收敛（canvasSnapshotNormalizer.convergeStuckMidFlightNode）把制作投影写的「生成中」记录
// （没有任务号——任务住在主进程的 Run 里）当幽灵收成空闲；回不回得来全看事件尾巴里有没有它。
// 修后：这类记录只归制作投影管，重开之后两镜都还是「生成中」；↑ 与「生成全部」本来就由制作 Run 判归属（#875），一直关着。
//
// 只有远端供应商是 loopback 夹具（零额度，视频任务默认压在 processing）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, proveProbe, waitForVisualQuiescence } from './_assert.mjs'
import { findCanvasBlankPoint, findNodeHitPoint } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_APIMART_VENDOR, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM,
  chooseAssistantModel, createRuntimeWalk, openCanvas, readProject, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

const VIDEO_MODEL = 'kling-v3'
const ASK = 'S_INFLIGHT_ASK：做两个视频镜头：镜1 清晨的渔港；镜2 码头上晒太阳的猫。先别生成。'
const GO = 'S_INFLIGHT_GO：好，两镜都生成吧。'
const PLAN_CALL = 's-inflight-plan-1'
const GENERATE_CALL = 's-inflight-go-1'

function readRun(projectRoot, runId) {
  const file = path.join(projectRoot, '.nomi', 'runs', runId, 'run.json')
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).run : null
}

/** 一镜此刻在屏上说了什么：节点状态、状态行相位、等待面、批次小标。 */
function nodeFace(win, nodeId) {
  return win.evaluate((id) => {
    const node = document.querySelector(`[data-node-id="${id}"]`)
    return {
      present: Boolean(node),
      status: node?.getAttribute('data-status') ?? null,
      phase: node?.querySelector('[data-generation-status]')?.getAttribute('data-phase') ?? null,
      waiting: Boolean(node?.querySelector('[data-generation-waiting]')),
      placeholder: node?.querySelector('[data-shot-placeholder-state]')?.getAttribute('data-shot-placeholder-state') ?? null,
      text: (node?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
    }
  }, nodeId)
}

/** 选中这一镜，读它自己浮框里的 ↑：必须渲染出来（渲染不出来 = 选择器坏了或浮框没出，直接红），返回 enabled / disabled。 */
async function generateEntry(win, nodeId) {
  const point = await findNodeHitPoint(win, { nodeSelector: `[data-node-id="${nodeId}"]` })
  expect(point, `${nodeId}：选得中这一镜（有真实命中点）`).not.toBeNull()
  await win.mouse.click(point.x, point.y)
  await waitForVisualQuiescence(win)
  const button = win.locator(`[data-node-id="${nodeId}"] [data-bar-segment="generate"]`).first()
  await button.waitFor({ state: 'attached', timeout: DEFAULT_TIMEOUT_MS })
  return (await button.isDisabled()) ? 'disabled' : 'enabled'
}

async function zoomOnto(win, nodeId) {
  const node = win.locator(`[data-node-id="${nodeId}"]`).first()
  for (let step = 0; step < 8; step += 1) {
    const box = await node.boundingBox()
    if (!box || box.width >= 240) return
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await win.keyboard.down('Control')
    await win.mouse.wheel(0, -240)
    await win.keyboard.up('Control')
    await waitForVisualQuiescence(win)
  }
}

/** 落盘的那份节点（重开读的就是它）：模型、档案、属于哪个制作 Run、状态、运行记录。 */
async function persistedNodes(win, projectId, ids) {
  const nodes = (await readProject(win, projectId)).payload.generationCanvas.nodes
  return Object.fromEntries(ids.map((id) => {
    const node = nodes.find((candidate) => candidate.id === id)
    const meta = node?.meta ?? {}
    return [id, {
      status: node?.status ?? null, modelKey: meta.modelKey ?? null, modelVendor: meta.modelVendor ?? null,
      archetype: meta.archetype ?? null, productionRunId: meta.productionRunId ?? null,
      runs: (node?.runs ?? []).map((run) => ({ id: run.id, status: run.status, source: run.source ?? run.kind ?? null })),
      metaKeys: Object.keys(meta).sort(),
    }]
  }))
}

/**
 * 重开之后的时间线：画布上第 1 镜出现在第几毫秒、画布落地 store 读回这个 Run 在第几毫秒（E2E 桥只在 __nomiE2E 下挂出）。
 * 若 Run 晚于节点到场，中间那一段「节点像空闲、归属判据还拿不到 Run」就是 ↑ 可能被按下去的空窗。
 */
async function reloadTimeline(win, { runId, shot1 }) {
  await win.evaluate(() => { window.__reloadProbeStart = performance.now() })
  const started = Date.now()
  await win.reload({ waitUntil: 'domcontentloaded' })
  let canvasAt = null
  let runAt = null
  let runJobs = null
  while (Date.now() - started < 30_000 && (canvasAt === null || runAt === null)) {
    const sample = await win.evaluate(({ id, node }) => {
      const run = window.__nomiProductionLandingStore?.getState().runs?.[id]
      return {
        node: Boolean(document.querySelector(`[data-node-id="${node}"]`)),
        run: Boolean(run),
        jobs: run ? (run.jobs ?? []).map((job) => `${job.metadata?.shotId}:${job.status}`) : null,
      }
    }, { id: runId, node: shot1 }).catch(() => null)
    const elapsed = Date.now() - started
    if (sample?.node && canvasAt === null) canvasAt = elapsed
    if (sample?.run && runAt === null) { runAt = elapsed; runJobs = sample.jobs }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return { canvasAt, runAt, runJobs, exposureMs: canvasAt !== null && runAt !== null ? Math.max(0, runAt - canvasAt) : null }
}

/**
 * 这一时刻两镜都在跑、各自的 ↑ 渲染出来且置灰（发不出第二次）。
 * 底栏「生成全部」这里不判：这个场景里两镜都归制作 Run，画布上没有别的可生成节点，底栏本来就不出现——
 * 「不在」判不出它算不算这两镜（原先那条断言永远过）。它的归属判据由 #875 的单测守；真机上要一个用户自己的闲置节点
 * 作阳性对照，记 TODO T-QA-38。
 */
function expectBothInFlight(observed, label) {
  for (const shot of ['shot1', 'shot2']) {
    const face = observed.faces[shot]
    expect(face.status, `${label}：${shot} 节点状态仍是「生成中」`).toBe('running')
    expect(face.phase, `${label}：${shot} 状态行说「生成中」`).toBe('generating')
    expect(face.waiting, `${label}：${shot} 是普通生成那张等待画面`).toBe(true)
    expect(observed.entries[shot], `${label}：${shot} 的 ↑ 渲染出来且置灰`).toBe('disabled')
  }
}

/** 一个时刻的全部观察：两镜的样子、各自 ↑。先拍再点（点会改选中态）。 */
async function observe(win, walk, label, { shot1, shot2, projectId }) {
  const persisted = await persistedNodes(win, projectId, [shot1, shot2])
  const blank = await findCanvasBlankPoint(win)
  if (blank) await win.mouse.click(blank.x, blank.y)
  await clickOrFail(win.getByRole('button', { name: /^(适应视图|Fit view)$/ }).first(), `${label}：适应视图`)
  await waitForVisualQuiescence(win)
  await zoomOnto(win, shot1)
  const faces = { shot1: await nodeFace(win, shot1), shot2: await nodeFace(win, shot2) }
  await walk.snap(`${label}-canvas`)
  const blank2 = await findCanvasBlankPoint(win)
  if (blank2) await win.mouse.click(blank2.x, blank2.y)
  await waitForVisualQuiescence(win)
  const entries = { shot1: await generateEntry(win, shot1) }
  await walk.snap(`${label}-shot1-selected`)
  entries.shot2 = await generateEntry(win, shot2)
  await walk.snap(`${label}-shot2-selected`)
  if (blank2) await win.mouse.click(blank2.x, blank2.y)
  return { persisted, faces, entries, persistedAfterSelect: await persistedNodes(win, projectId, [shot1, shot2]) }
}

const walk = await createRuntimeWalk('inflight-shots-reload', { generationProvider: 'apimart' })
let failure
try {
  const { win } = await walk.start({ first: true })
  // 挂出画布落地 store 的 E2E 桥（只读口）。
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  await win.reload({ waitUntil: 'domcontentloaded' })
  const { projectId } = await walk.newProject()
  const projectRoot = walk.report.projectRoot
  await openCanvas(win)
  await chooseAssistantModel(win, FIXTURE_TEXT_MODEL_LABEL, CANVAS_PANEL)
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()
  // 给视频模型一行价目（设置页同一条 IPC）：报得出合计，卡上才有「全部」，两镜才会一起派出去。
  await win.evaluate(({ vendorKey, modelKey }) => window.nomiDesktop.modelCatalog.upsertModel({
    vendorKey, modelKey, pricing: { cost: 1, enabled: true, specCosts: [] },
  }), { vendorKey: FIXTURE_APIMART_VENDOR, modelKey: VIDEO_MODEL })

  const planner = walk.fixture.expectText({
    label: 'the agent drafts two video shots',
    match: (body) => flattenRequestText(body).includes('S_INFLIGHT_ASK'),
    reply: { type: 'tool', id: PLAN_CALL, name: 'draft_shots', args: {
      shots: [
        { title: '渔港', prompt: '清晨的渔港，几只小船轻轻晃', taskKind: 'text_to_video', candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: VIDEO_MODEL } },
        { title: '码头猫', prompt: '码头上一只橘猫在晒太阳', taskKind: 'text_to_video', candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: VIDEO_MODEL } },
      ],
    } },
  })
  let operationId
  const drafted = walk.fixture.expectText({
    label: 'the draft result comes back and the agent waits',
    match: (body) => {
      const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === PLAN_CALL)
      if (!result || flattenRequestText(body).includes('S_INFLIGHT_GO')) return false
      operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
      return true
    },
    reply: { type: 'text', text: 'S_INFLIGHT_HOLD_DONE：两镜都建好了。' },
  })
  await sendCanvas(win, ASK)
  await recorded(planner.received, 'draft request')
  await recorded(drafted.received, 'draft result')
  const shotNodes = async () => (await readProject(win, projectId)).payload.generationCanvas.nodes
    .filter((node) => node.meta?.productionRunId === operationId && node.kind === 'video')
  await expect.poll(async () => (await shotNodes()).length, { message: '两个视频节点落地', timeout: DEFAULT_TIMEOUT_MS }).toBe(2)
  const run0 = readRun(projectRoot, operationId)
  const nodeIdOf = (shotId) => run0.generationPlan.shots.find((shot) => shot.shotId === shotId)?.nodeId
  await expect.poll(() => Boolean(nodeIdOf('shot-1') && nodeIdOf('shot-2')), { message: '两镜绑到节点', timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
  const shot1 = nodeIdOf('shot-1')
  const shot2 = nodeIdOf('shot-2')

  const goTurn = walk.fixture.expectText({
    label: 'the user says go and the agent presents the draft',
    match: (body) => flattenRequestText(body).includes('S_INFLIGHT_GO'),
    reply: { type: 'tool', id: GENERATE_CALL, name: 'generate', args: { operationId } },
  })
  const goDone = walk.fixture.expectText({
    label: 'generate returns once the card is answered',
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === GENERATE_CALL),
    reply: { type: 'text', text: 'S_INFLIGHT_GO_DONE：已开始生成。' },
  })
  await sendCanvas(win, GO)
  await recorded(goTurn.received, 'generate request')
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  await proveProbe(card, '报价卡摆在面板里等人')
  await clickOrFail(card.getByText('全部', { exact: true }), '卡上的范围切到「全部」')
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), '卡上的主按钮', { noWaitAfter: true })
  await expect.poll(() => walk.fixture.videos.length, { message: '两镜的视频请求都到了供应商', timeout: stationTimeout({ operations: 8 }) }).toBe(2)
  await recorded(goDone.received, 'generate returns after approval')
  await expect.poll(async () => [(await nodeFace(win, shot1)).phase, (await nodeFace(win, shot2)).phase].join(','),
    { message: '重开之前两镜都显示生成中', timeout: stationTimeout({ operations: 4 }) }).toBe('generating,generating')

  const observations = {}
  observations.beforeReload = await observe(win, walk, 'zh-before-reload', { shot1, shot2, projectId })
  expectBothInFlight(observations.beforeReload, 'zh · 重开之前')
  // 重开（zh）：量「节点到场」与「Run 读回」各在第几毫秒。
  observations.timelineZh = await reloadTimeline(win, { runId: operationId, shot1 })
  await expect(win.locator(`[data-node-id="${shot1}"]`)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect.poll(async () => (await nodeFace(win, shot2)).present, { timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
  await waitForVisualQuiescence(win)
  observations.afterReloadZh = await observe(win, walk, 'zh-after-reload', { shot1, shot2, projectId })
  expectBothInFlight(observations.afterReloadZh, 'zh · 重开之后')
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  observations.timelineEn = await reloadTimeline(win, { runId: operationId, shot1 })
  await expect(win.locator(`[data-node-id="${shot1}"]`)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await waitForVisualQuiescence(win)
  observations.afterReloadEn = await observe(win, walk, 'en-after-reload', { shot1, shot2, projectId })
  expectBothInFlight(observations.afterReloadEn, 'en · 重开之后')
  observations.jobs = (readRun(projectRoot, operationId)?.jobs ?? []).map((job) => ({ shotId: job.metadata?.shotId, status: job.status, providerTaskId: Boolean(job.providerTaskId) }))
  observations.videoRequests = walk.fixture.videos.length
  walk.report.observations = observations

  walk.fixture.releaseVideos()
  for (const id of [shot1, shot2]) {
    await expect(win.locator(`[data-node-id="${id}"]`)).toHaveAttribute('data-status', 'success', { timeout: stationTimeout({ operations: 6 }) })
  }
  expect(walk.fixture.videos, '整场只有两次视频提交（重开没有让任何一镜被再发一次）').toHaveLength(2)
  walk.report.verified = ['both-in-flight-shots-stay-generating-after-reload-zh-en', 'reload-does-not-reopen-either-generate-entry', 'both-real-results-land']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  walk.fixture?.releaseVideos?.()
  await walk.finish(failure)
}
