#!/usr/bin/env node
// 真实用户任务（R13/R16）：**「巨龙攻击村子，做成视频」→ 我在 Agent 付费卡上点了生成 → 视频要跑好几分钟 →
// 供应商那边出片了。节点上看到的是什么？任务面板说的是什么？**
//
// 2026-09-25 用户原话：「AI 付费卡生产出来的东西会一直转圈……视频早就生产出来了，他这里一直显示生成中。」
// 截图：节点整卡模糊 + 中间一个 N 字标（普通「生成」是另一套等待画面）；任务面板「等待确认 · 供应商长时间
// 没有返回新状态 · 0 / 4 已完成」。这条走查在真实应用里把那条路走完，钉住修好之后用户看到的东西：
//
//   ① 确认之后，节点上是**普通生成那张等待画面**（NodeGeneratingOverlay / GenerationWaitingSurface），
//      不是「整卡模糊 + N 字标」那第二套——一个节点「在生成」只有一种画法；
//   ② 供应商跑得比观察窗久（真视频常常 5 分钟以上；这里把窗口压到 8 秒）：窗口过了 Nomi **还在问**。
//      修之前这一步是断的：重踢用的是新建的供应商实例，它不知道这笔任务用的哪个模型，每一次查询都报错、
//      被吞成「还在跑」——供应商早出片了，Run 永远停在 polling，节点永远转；
//   ③ 供应商一出片：节点变成结果（真 mp4 落进项目素材库，地址是永久的 nomi-local://asset），
//      任务面板这次制作不再说「供应商长时间没有返回新状态」，生成阶段记为完成；
//   ④ 英文界面 + 重开（reload）之后：节点上的片子还在（以前结果地址是 5 分钟过期的签名链）。
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
// 产物是一段真供应商出的 mp4（docs/audit/2026-08-20-l3-f1-full-journey），不是合成色块。
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_APIMART_VENDOR, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM,
  createRuntimeWalk, openCanvas, readProject, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

// 干净装机那一档（内置目录没有价目）：付费卡照样能确认，花费由供应商结算——夹具出站只认回环，一分钱不花。
process.env.NOMI_WALK_UNPRICED_MODEL = '1'
// 把单次观察窗压到 8 秒（默认 300 秒）：这条走查要证的就是「窗口过了还会接着问」。
const OBSERVATION_WINDOW_MS = 8_000
process.env.NOMI_POLL_TIMEOUT_MS = String(OBSERVATION_WINDOW_MS)

const VIDEO_MODEL = 'kling-v3'
const ASK = 'S_VIDEO_LANDING：巨龙攻击村子，做成视频。'
const PLAN_CALL = 's-video-landing-1'
const GENERATE_CALL = `${PLAN_CALL}-generate`
const TASK_TRIGGER = '[data-task-center-trigger="true"]'

function readRun(projectRoot, runId) {
  const snapshot = path.join(projectRoot, '.nomi', 'runs', runId, 'run.json')
  if (!fs.existsSync(snapshot)) return null
  return JSON.parse(fs.readFileSync(snapshot, 'utf8')).run
}

const walk = await createRuntimeWalk('spend-video-landing', { generationProvider: 'apimart' })
let failure
try {
  const { win } = await walk.start({ first: true })
  const { projectId } = await walk.newProject()
  const projectRoot = walk.report.projectRoot
  await openCanvas(win)

  const planner = walk.fixture.expectText({
    label: 'the agent drafts one video shot',
    match: (body) => flattenRequestText(body).includes('S_VIDEO_LANDING'),
    reply: { type: 'tool', id: PLAN_CALL, name: 'draft_shots', args: {
      shots: [{ title: '镜头 58', prompt: '巨龙攻击村子，火光照亮夜空', taskKind: 'text_to_video', candidate: { providerId: FIXTURE_APIMART_VENDOR, modelId: VIDEO_MODEL } }],
    } },
  })
  let operationId
  const draftDone = walk.fixture.expectText({
    label: 'the draft result carries the host operationId',
    match: (body) => {
      const result = (body.messages ?? []).find((message) => message.role === 'tool' && message.tool_call_id === PLAN_CALL)
      if (!result) return false
      operationId = /"operationId":"([^"]+)"/.exec(String(result.content))?.[1]
      return true
    },
    reply: { type: 'hold' },
  })
  const generateDone = walk.fixture.expectText({
    label: 'generate returns once the user approved the card',
    match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === GENERATE_CALL),
    reply: { type: 'text', text: 'S_VIDEO_LANDING_DONE：已经开始生成。' },
  })
  await sendCanvas(win, ASK)
  await recorded(planner.received, 'video draft request')
  await recorded(draftDone.received, 'video draft result')
  draftDone.release({ type: 'tool', id: GENERATE_CALL, name: 'generate', args: { operationId } })

  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.filter((node) => node.kind === 'video').length,
    { timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  const nodeId = (await readProject(win, projectId)).payload.generationCanvas.nodes.find((node) => node.kind === 'video').id
  const node = win.locator(`[data-node-id="${nodeId}"]`)

  // ── ① 确认 → 节点上是普通生成那张等待画面 ─────────────────────────────────────────
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  await expect(card, '付费卡在 Agent 面板里等着').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), '付费卡上的主按钮', { noWaitAfter: true })
  await expect.poll(() => walk.fixture.videos.length, { message: '确认之后供应商真的收到了视频生成请求', timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  await recorded(generateDone.received, 'generate returned after approval')

  const waiting = node.locator('[data-generating-placement="surface"]')
  await expect(waiting, '节点上是普通生成那张等待画面（GenerationWaitingSurface）').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(node, '节点自己的状态就是「生成中」——与普通生成同一份状态').toHaveAttribute('data-status', 'running')
  const waitingProof = await proveProbe(waiting, '等待画面这个探针测得到')
  // 第二套画法（整卡模糊 + N 字标 = GeneratingOverlay 的居中形态）不许再出现在这个节点上。
  await expectAbsent(node.locator('.generation-canvas-v2-node__generating-overlay'), { provenBy: waitingProof, message: '「整卡模糊 + N 字标」那第二套等待画面已经删掉了' })
  await walk.snap('video-waiting-ordinary-surface-zh')

  // ── ② 供应商比观察窗跑得久：窗口过了 Nomi 还在问 ─────────────────────────────────
  const pollsAtWindowEnd = await expect.poll(() => walk.fixture.videoTaskPolls()[0] ?? 0, { timeout: DEFAULT_TIMEOUT_MS })
    .toBeGreaterThan(0).then(() => walk.fixture.videoTaskPolls()[0])
  await expect.poll(() => walk.fixture.videoTaskPolls()[0] ?? 0, {
    message: `观察窗（${OBSERVATION_WINDOW_MS}ms）过了之后 Nomi 还在查询这笔任务（修之前：新实例查不了，永远停在 polling）`,
    timeout: stationTimeout({ operations: 4 }),
  }).toBeGreaterThan(pollsAtWindowEnd + 2)
  expect(walk.fixture.videos, '只查不交：同一笔钱没有被再提交一次').toHaveLength(1)
  await expect(node, '供应商还没出片时节点仍在等待').toHaveAttribute('data-status', 'running')

  // ── ③ 供应商出片 → 节点变结果，任务面板跟上 ────────────────────────────────────
  walk.fixture.releaseVideos()
  await expect(node, '供应商一出片，节点就变成结果').toHaveAttribute('data-status', 'success', { timeout: stationTimeout({ operations: 4 }) })
  await expectAbsent(waiting, { provenBy: waitingProof, message: '出片之后等待画面收起来' })
  const run = readRun(projectRoot, operationId)
  const artifact = run.artifacts.find((item) => item.kind === 'video' && item.status !== 'rejected')
  expect(artifact?.projectRelativePath, '真 mp4 落进了项目素材库').toMatch(/\.mp4$/)
  expect(fs.statSync(path.join(projectRoot, artifact.projectRelativePath)).size, '落盘的是那段真视频的字节').toBeGreaterThan(100_000)
  const landed = (await readProject(win, projectId)).payload.generationCanvas.nodes.find((item) => item.id === nodeId)
  expect(landed.result?.url, '节点结果是素材库的永久地址（不是 5 分钟过期的签名预览链）')
    .toBe(`nomi-local://asset/${encodeURIComponent(projectId)}/${artifact.projectRelativePath.split('/').map(encodeURIComponent).join('/')}`)
  await walk.snap('video-landed-zh')

  await clickOrFail(win.locator(TASK_TRIGGER), '打开任务面板')
  const runCard = win.locator('[data-production-task-card]').first()
  await expect(runCard, '任务面板里有这次制作').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(runCard.locator('[data-production-status-title]'), '不再说「供应商长时间没有返回新状态」')
    .not.toHaveText('供应商长时间没有返回新状态')
  await expect(runCard, '生成阶段记为完成（不再是 0 / N）').not.toContainText(/\b0 \/ \d+ 已完成/)
  await walk.snap('task-panel-after-landing-zh')
  await win.keyboard.press('Escape')

  // ── ④ 英文 + 重开：片子还在 ───────────────────────────────────────────────────
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload()
  await expect(win.locator(`[data-node-id="${nodeId}"]`), 'EN · 重开之后节点仍是结果').toHaveAttribute('data-status', 'success', { timeout: DEFAULT_TIMEOUT_MS })
  await walk.snap('video-landed-en')
  await clickOrFail(win.locator(TASK_TRIGGER), 'open the task panel (EN)')
  const enCard = win.locator('[data-production-task-card]').first()
  await expect(enCard).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(enCard.locator('[data-production-status-title]')).not.toHaveText('The provider has not returned a new state for a while')
  await walk.snap('task-panel-after-landing-en')

  walk.report.verified = [
    'agent-paid-card-node-uses-the-ordinary-waiting-surface',
    'observation-continues-past-the-window-without-resubmitting',
    'provider-finish-lands-a-real-mp4-on-the-same-node',
    'task-panel-no-longer-claims-the-provider-is-stale',
    'result-survives-reload-in-english',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
