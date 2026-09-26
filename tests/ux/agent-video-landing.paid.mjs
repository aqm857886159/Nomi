#!/usr/bin/env node
// 真实用户任务 · **真花钱**：「让 Agent 做一段视频 → 我在付费卡上点了生成 → 真视频要跑好一会儿 → 片子落到节点上」。
//
//   NOMI_SPEND_OK=1 node tests/ux/agent-video-landing.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//
// 2026-09-25 用户原话：「AI 付费卡生产出来的东西会一直转圈……视频早就生产出来了，他这里一直显示生成中。」
// `agent-spend-video-landing.walk.mjs` 用 loopback 夹具把那条修复钉住了（零额度，进 CI）；这一条在**真供应商**上
// 把同一条路走完，同样四件事（那份走查文件头 ①–④）：
//   ① 确认之后，节点上是普通生成那张等待画面，不是「整卡模糊 + N 字标」那第二套；
//   ② 真视频跑得比单次观察窗久（这里把窗口压到 OBSERVATION_WINDOW_MS）：窗口过了 Nomi 还在问，而不是永远转圈；
//   ③ 供应商一出片：节点变成结果（真 mp4 落进项目素材库，永久的 nomi-local 地址），任务面板不再说「供应商长时间没有返回新状态」；
//   ④ 英文界面 + 重开之后：节点上的片子还在。
//
// 大脑：APIMart 的 DeepSeek V3.2；视频：Seedance 2.0 fast · 480p · 4 秒 · 无音频（最便宜那一档）。
// 花钱之前逐字段核对 Agent 写进制作 Run 的草稿，不是那一档就关卡、一分钱不花（_agentVideoPaid.mjs）。
// 凭据与原库保护见 _paidRun.mjs / _realProfile.mjs：明文 key 不落地、跑完删凭据副本、原库指纹跑前跑后比对。
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { BRAIN, CHEAP_VIDEO_TERMS, VIDEO, cheapVideoProblems, plannedShots, probeLandedMedia } from './_agentVideoPaid.mjs'
import { openPaidWalk, readProductionRuns } from './_paidRun.mjs'
import { stationTimeout } from './_station-budget.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, INTERVENTION_CONFIRM,
  chooseAssistantModel, closeSpendCard, openCanvas, readProject, sendCanvas,
} from './agent-runtime-walk-support.mjs'

/** 单次观察窗（默认 300s）压到 15s：真视频一般要一两分钟，窗口一定会过——这正是 ② 要证的。 */
const OBSERVATION_WINDOW_MS = 15_000
process.env.NOMI_POLL_TIMEOUT_MS = String(OBSERVATION_WINDOW_MS)
const MODEL_TURN_MS = stationTimeout({ turns: 1 })
/** 真视频出片的安全上限（完成信号是节点 data-status=success，不是这个数）。 */
const VIDEO_LANDS_MS = stationTimeout({ turns: 2 })
const TASK_TRIGGER = '[data-task-center-trigger="true"]'
const ASK = `做一个 4 秒的视频镜头：一只纸船在雨后的水洼里慢慢漂，清晨的光。只要这一镜，用 ${CHEAP_VIDEO_TERMS}。直接生成。`

const paid = await openPaidWalk('agent-video-landing.paid.mjs', 'agent-video-landing', [BRAIN, VIDEO])
const { walk } = paid
let failure
try {
  const { win } = await walk.start({ first: true })
  await paid.lockToAuthorizedModels(win)
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, paid.label(BRAIN.vendorKey, BRAIN.modelKey), CANVAS_PANEL)

  await sendCanvas(win, ASK)
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  await expect(card, 'Agent 起草并请求生成之后，付费卡摆在面板里等人').toBeVisible({ timeout: MODEL_TURN_MS })
  // ── 花钱之前：卡上要花的那一笔（等人答的那个 Run）就是被授权的那一档，而且只有一镜 ──
  // 模型可能起草了不止一次（每次一个 Run）；卡上等人的是最后调 generate 的那一份。多出来的草稿不花钱，如实记下。
  const runs = readProductionRuns(projectRoot).filter((run) => run.generationPlan)
  const run = runs.at(-1)
  const shots = plannedShots(run)
  const problems = shots.flatMap((shot) => cheapVideoProblems(shot.candidate).map((problem) => `${shot.shotId}：${problem}`))
  walk.report.draft = {
    runs: runs.length, runId: run?.runId,
    shots: shots.map((shot) => ({ shotId: shot.shotId, providerId: shot.candidate?.providerId, modelId: shot.candidate?.modelId,
      variantId: shot.candidate?.variantId, transportModelId: shot.candidate?.transportModelId, parameters: shot.candidate?.parameters })),
    // 卡上印给用户看的「变体」——和宿主要派发的那一档对照（两者不一致 = 看到的不是要付的）。
    cardVariant: (await card.locator('[aria-label="变体"]').first().getAttribute('title').catch(() => null)) ?? null,
  }
  await walk.snap('video-01-zh-spend-card-before-confirm')
  if (shots.length !== 1 || problems.length) {
    await closeSpendCard(card, '草稿不是被授权的那一档，关卡不花钱')
    walk.report.blockedBeforeSpend = problems
    throw new Error(`付费前拦下（一分钱没花，卡已关）：宿主要派发的不是被授权的 Seedance 2.0 fast · 480p · 4s · 无音频——`
      + `${shots.length} 镜；${problems.join('；')}；卡上显示的变体是 ${walk.report.draft.cardVariant}`)
  }
  await expect.poll(async () => (await readProject(win, projectId)).payload.generationCanvas.nodes
    .filter((node) => node.kind === 'video' && node.meta?.productionRunId === run.runId).length, { message: '草稿落成画布上一个视频节点', timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  const nodeId = (await readProject(win, projectId)).payload.generationCanvas.nodes
    .find((node) => node.kind === 'video' && node.meta?.productionRunId === run.runId).id
  const node = win.locator(`[data-node-id="${nodeId}"]`)

  // ── ① 确认 → 节点上是普通生成那张等待画面 ──
  const confirmedAt = Date.now()
  await clickOrFail(card.locator(INTERVENTION_CONFIRM), '付费卡上的主按钮', { noWaitAfter: true })
  const waiting = node.locator('[data-generating-placement="surface"]')
  await expect(waiting, '① 节点上是普通生成那张等待画面（GenerationWaitingSurface）').toBeVisible({ timeout: stationTimeout({ operations: 4 }) })
  await expect(node, '① 节点自己的状态就是「生成中」——与普通生成同一份状态').toHaveAttribute('data-status', 'running')
  const waitingProof = await proveProbe(waiting, '等待画面这个探针测得到')
  await expectAbsent(node.locator('.generation-canvas-v2-node__generating-overlay'), { provenBy: waitingProof, message: '①「整卡模糊 + N 字标」那第二套等待画面不在这个节点上' })
  await walk.snap('video-02-zh-waiting-ordinary-surface')

  // ── ② + ③ 真视频出片：节点变结果（窗口过了还在问，才等得到这一刻）──
  await expect(node, '③ 供应商一出片，节点就变成结果——不是永远转圈').toHaveAttribute('data-status', 'success', { timeout: VIDEO_LANDS_MS })
  const landedAfterMs = Date.now() - confirmedAt
  await expectAbsent(waiting, { provenBy: waitingProof, message: '③ 出片之后等待画面收起来' })
  const finalRun = readProductionRuns(projectRoot).find((candidate) => candidate.runId === run.runId)
  const providerTasks = new Set((finalRun.jobs ?? []).map((job) => job.providerTaskId).filter(Boolean))
  expect(providerTasks.size, '只花了一笔：这一镜恰好一个供应商任务（观察窗过了只查不交）').toBe(1)
  const landed = (await readProject(win, projectId)).payload.generationCanvas.nodes.find((item) => item.id === nodeId)
  const artifact = (finalRun.artifacts ?? []).find((item) => item.kind === 'video' && item.status !== 'rejected')
  expect(artifact?.projectRelativePath, '③ 真 mp4 落进了项目素材库').toMatch(/\.mp4$/)
  expect(landed.result?.url, '③ 节点结果是素材库的永久地址（不是会过期的签名预览链）')
    .toBe(`nomi-local://asset/${encodeURIComponent(projectId)}/${artifact.projectRelativePath.split('/').map(encodeURIComponent).join('/')}`)
  const media = await probeLandedMedia(projectRoot, projectId, landed.result.url)
  walk.report.landed = { nodeId, landedAfterMs, observationWindowMs: OBSERVATION_WINDOW_MS, providerTaskIds: [...providerTasks], media }
  expect(media.probe.kind, '③ 落盘的是一段能解码的视频').toBe('video')
  expect(Math.abs(media.probe.durationSeconds - 4) < 0.5, `③ 片长就是授权的 4 秒（实测 ${media.probe.durationSeconds}s）`).toBe(true)
  expect(media.probe.hasAudio, '③ 授权的是无音频那一档').toBe(false)
  // ② 的判据：出片晚于一个观察窗 = 窗口过后宿主还在问、而且问到了。早于窗口出片就诚实地记「没触发」，不假装验过。
  walk.report.observationWindowExercised = landedAfterMs > OBSERVATION_WINDOW_MS
  await walk.snap('video-03-zh-landed')

  await clickOrFail(win.locator(TASK_TRIGGER), '打开任务面板')
  const runCard = win.locator('[data-production-task-card]').first()
  await expect(runCard, '③ 任务面板里有这次制作').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(runCard.locator('[data-production-status-title]'), '③ 不再说「供应商长时间没有返回新状态」').not.toHaveText('供应商长时间没有返回新状态')
  await expect(runCard, '③ 生成阶段记为完成（不再是 0 / N）').not.toContainText(/\b0 \/ \d+ 已完成/)
  await walk.snap('video-04-zh-task-panel-after-landing')
  await win.keyboard.press('Escape')

  // ── ④ 英文 + 重开：片子还在 ──
  await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
  await win.reload()
  await expect(win.locator(`[data-node-id="${nodeId}"]`), '④ EN · 重开之后节点仍是结果').toHaveAttribute('data-status', 'success', { timeout: DEFAULT_TIMEOUT_MS })
  await walk.snap('video-05-en-landed-after-reload')
  await clickOrFail(win.locator(TASK_TRIGGER), 'open the task panel (EN)')
  const enCard = win.locator('[data-production-task-card]').first()
  await expect(enCard).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await expect(enCard.locator('[data-production-status-title]')).not.toHaveText('The provider has not returned a new state for a while')
  await walk.snap('video-06-en-task-panel')

  walk.report.verified = [
    'agent-paid-card-node-uses-the-ordinary-waiting-surface',
    'real-video-lands-as-local-mp4-on-the-same-node',
    'exactly-one-provider-task',
    'task-panel-no-longer-claims-the-provider-is-stale',
    'result-survives-reload-in-english',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
