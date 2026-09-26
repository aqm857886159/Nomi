#!/usr/bin/env node
// 真实用户任务 · **真花钱**：「Agent 起草两镜视频 → 我在卡上选『全部』点了生成 → 两镜在排队 / 生成中的时候，
// 我在画布上再点『生成全部』或节点的 ↑，不能把同一镜再花一次钱」。
//
//   NOMI_SPEND_OK=1 node tests/ux/agent-queued-shots.paid.mjs [--packaged <Nomi 可执行文件的绝对路径>]
//
// #875 修的是：制作流程排队 / 生成中的镜头，节点自身状态是 idle，于是底栏「生成全部」照样算它、节点 ↑ 也能按——
// 同一镜生成两次、扣两次钱。`agent-queued-shot-not-regenerable.walk.mjs` 在 loopback 夹具上压住受理造出了排队；
// 这一条在**真供应商**上走一遍：
//   · 卡在等人（归制作流程）→ 底栏「生成全部」只算用户自己那一个闲置节点，选中第 2 镜时它的 ↑ 按不下去；
//   · 确认之后 → 真实排队（制作流程逐镜顺序派发，第 1 镜提交时第 2 镜「已授权、还没轮到」）与生成中，
//     页面里挂一个观察者逐帧记下第 2 镜的相位与 ↑ 的可按性——窗口很短，看得见就记、看不见就如实记「没观察到」；
//   · 两镜在飞的整段（真视频一两分钟）：底栏只算那一个闲置节点，第 2 镜 ↑ 置灰（zh + en）；
//   · 两镜都落地：每镜恰好一次提交、整场恰好两笔供应商任务，两段真 mp4（480p · 4 秒 · 无音频）落在各自节点上。
//
// 卡上「逐镜 | 全部」只有报得出合计时才有（价格未知只能逐镜确认、一次派一镜，造不出排队）——所以隔离副本里给
// Seedance 那一行种了一个**夹具价**。它只决定卡的形态；真实扣多少由供应商按它自己的价目表结算。
// 花钱之前逐字段核对两镜草稿（_agentVideoPaid.mjs）；凭据与原库保护见 _paidRun.mjs / _realProfile.mjs。
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, waitForVisualQuiescence } from './_assert.mjs'
import { BRAIN, CHEAP_VIDEO_TERMS, VIDEO, cheapVideoProblems, plannedShots, probeLandedMedia } from './_agentVideoPaid.mjs'
import { findCanvasBlankPoint, findNodeHitPoint } from './_canvasHit.mjs'
import { openPaidWalk, readProductionRuns } from './_paidRun.mjs'
import { stationTimeout } from './_station-budget.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COMPOSER, INTERVENTION_CONFIRM,
  chooseAssistantModel, closeSpendCard, openCanvas, readProject, sendCanvas,
} from './agent-runtime-walk-support.mjs'

const MODEL_TURN_MS = stationTimeout({ turns: 1 })
const VIDEO_LANDS_MS = stationTimeout({ turns: 2 })
const GENERATE_ALL = '[data-storyboard-run-all="true"][data-batch-scope="all"]'
const ASK = '画两个视频镜头，先别生成：镜1，清晨的渔港，几只小船轻轻晃；镜2，同一个渔港的码头上，一只猫在晒太阳。'
  + `两镜都用 ${CHEAP_VIDEO_TERMS}。就这两镜，不要参考卡或锚点；起草完就停，不用问我。`
const GO = '好，两镜都生成吧。'
/** 夹具价（见文件头）：只为让付费卡报得出合计、出现「全部」。 */
const FIXTURE_PRICING = { cost: 1, enabled: true, specCosts: [] }

const paid = await openPaidWalk('agent-queued-shots.paid.mjs', 'agent-queued-shots', [BRAIN, { ...VIDEO, pricing: FIXTURE_PRICING }])
const { walk } = paid
let failure
try {
  const { win } = await walk.start({ first: true })
  await paid.lockToAuthorizedModels(win)
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  await chooseAssistantModel(win, paid.label(BRAIN.vendorKey, BRAIN.modelKey), CANVAS_PANEL)
  const consent = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()
  const canvasNodes = async () => (await readProject(win, projectId)).payload.generationCanvas.nodes ?? []

  // ── 草稿：两镜，先别生成 ──
  await sendCanvas(win, ASK)
  // 回合结束有两种形状：说完了（composer 退出运行态），或者停在一张问题卡上等人答（`data-awaiting-answer`）。
  // 后者不是这条走查要测的——如实报红，别干等到超时。
  const composer = win.locator(`${CANVAS_PANEL} ${COMPOSER}`).first()
  await expect(win.locator(`${CANVAS_PANEL} ${COMPOSER}[data-mode="running"]`).first(), '起草这一轮起飞了').toBeVisible({ timeout: stationTimeout() })
  await expect.poll(async () => {
    const mode = await composer.getAttribute('data-mode')
    return mode !== 'running' ? 'idle' : (await composer.getAttribute('data-awaiting-answer')) === 'true' ? 'awaiting-answer' : 'running'
  }, { message: '起草这一轮落地（说完了或停下来问人）', timeout: MODEL_TURN_MS }).not.toBe('running')
  if ((await composer.getAttribute('data-awaiting-answer')) === 'true') {
    await walk.snap('queued-00-agent-asked-instead-of-drafting')
    throw new Error('起草这一轮 Agent 停下来反问了用户（还没出卡，一分钱没花）——见截图与转录')
  }
  const runs = readProductionRuns(projectRoot).filter((run) => run.generationPlan)
  expect(runs.length, '草稿起了一个制作 Run').toBe(1)
  const runId = runs[0].runId
  const draftProblems = () => {
    const shots = plannedShots(readProductionRuns(projectRoot).find((run) => run.runId === runId))
    const problems = shots.flatMap((shot) => cheapVideoProblems(shot.candidate).map((problem) => `${shot.shotId}：${problem}`))
    return { shots, problems: shots.length === 2 ? problems : [`计划里是 ${shots.length} 镜，不是 2 镜`, ...problems] }
  }
  const drafted = draftProblems()
  expect(drafted.shots.map((shot) => `${shot.candidate?.providerId}/${shot.candidate?.modelId}`), '草稿是两镜 Seedance 2.0').toEqual([`${VIDEO.vendorKey}/${VIDEO.modelKey}`, `${VIDEO.vendorKey}/${VIDEO.modelKey}`])
  await expect.poll(async () => (await canvasNodes()).filter((node) => node.kind === 'video' && node.meta?.productionRunId === runId).length,
    { message: '草稿落成画布上两个视频节点', timeout: DEFAULT_TIMEOUT_MS }).toBe(2)
  const [shot1, shot2] = (await canvasNodes()).filter((node) => node.kind === 'video' && node.meta?.productionRunId === runId).map((node) => node.id)

  // 用户自己也在画布上放了一个还没生成的节点（永远不点它）：底栏「生成全部」该算的只有它。
  const before = new Set((await canvasNodes()).map((node) => node.id))
  await clickOrFail(win.locator('[aria-label="添加视频节点"]').first(), '画布「添加视频节点」')
  await expect.poll(async () => (await canvasNodes()).filter((node) => !before.has(node.id)).length, { message: '闲置节点落盘', timeout: DEFAULT_TIMEOUT_MS }).toBe(1)
  const idleId = (await canvasNodes()).find((node) => !before.has(node.id)).id
  const idleEditor = win.locator(`[data-node-id="${idleId}"] div[contenteditable="true"]`).last()
  await clickOrFail(idleEditor, '闲置节点提示词输入框')
  await idleEditor.fill('海边日落的延时（这一张我自己之后再生成）')

  // ── 让 Agent 生成：卡摆出来，切「全部」，按下去之前把两个入口都看一遍 ──
  await sendCanvas(win, GO)
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  await expect(card, '付费卡摆在面板里等人').toBeVisible({ timeout: MODEL_TURN_MS })
  await clickOrFail(card.getByText('全部', { exact: true }), '卡上的范围切到「全部」（两镜一起派）')
  // 刚填完提示词的闲置节点还选中着：它钉在节点下方的浮框可能正好盖住第 2 镜，Ctrl+滚轮落在浮框上不缩放画布
  // （2026-09-26 Windows 实测第 2 镜只放大到 148px）。像用户一样先点空白处取消选中，再适应视图、放大。
  const blankBeforeZoom = await findCanvasBlankPoint(win)
  if (blankBeforeZoom) await win.mouse.click(blankBeforeZoom.x, blankBeforeZoom.y)
  await waitForVisualQuiescence(win)
  // 常驻 Agent 面板会盖住画布右侧；像用户一样先「适应视图」，再点第 2 镜上真正点得到的那一处。
  await clickOrFail(win.getByRole('button', { name: /^(适应视图|Fit view)$/ }).first(), '适应视图')
  await waitForVisualQuiescence(win)
  // 适应视图之后两镜在框里很小（点下去会选中框而不是镜头）：像用户一样按住 Ctrl 滚轮、锚在第 2 镜上放大到看得清再点。
  const shot2Node = win.locator(`[data-node-id="${shot2}"]`).first()
  for (let step = 0; step < 8; step += 1) {
    const box = await shot2Node.boundingBox()
    if (!box || box.width >= 240) break
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await win.keyboard.down('Control')
    await win.mouse.wheel(0, -240)
    await win.keyboard.up('Control')
    await waitForVisualQuiescence(win)
  }
  expect((await shot2Node.boundingBox())?.width ?? 0, '第 2 镜放大到看得清（≥ 240px 宽）').toBeGreaterThanOrEqual(240)
  await waitForVisualQuiescence(win)
  const blank = await findCanvasBlankPoint(win)
  expect(Boolean(blank), '画布上找得到空白处').toBe(true)
  const selectShot2 = async () => {
    const point = await findNodeHitPoint(win, { nodeSelector: `[data-node-id="${shot2}"]` })
    expect(Boolean(point), '第 2 镜在舞台上有点得到的地方').toBe(true)
    await win.mouse.click(point.x, point.y)
    await expect(shot2Node, '第 2 镜被选中').toHaveAttribute('data-selected', 'true')
  }
  /**
   * 选中第 2 镜之后，它自己的 ↑ 不许能按：要么渲染出来但置灰，要么这一镜归制作流程时根本不给 ↑。
   * 两种都是「从节点再发一次」的门关着；记下是哪一种。渲染出来而且能按 = 同一镜可以再花一次钱 → 红。
   */
  const shot2GenerateEntry = async (label) => {
    await selectShot2()
    await waitForVisualQuiescence(win)
    const generate = win.locator(`[data-node-id="${shot2}"] [data-bar-segment="generate"]`).first()
    const state = await generate.count() ? (await generate.isDisabled() ? 'disabled' : 'enabled') : 'not-rendered'
    expect(state, `${label}：第 2 镜的 ↑ 不能按`).not.toBe('enabled')
    return state
  }
  const deselect = () => win.mouse.click(blank.x, blank.y)
  await deselect()
  await expect(win.locator(GENERATE_ALL), '卡在等人：「生成全部」只算用户自己那一个闲置节点（两镜归制作流程）').toContainText('1', { timeout: DEFAULT_TIMEOUT_MS })
  walk.report.shot2GenerateWhileCardWaits = await shot2GenerateEntry('卡在等人')
  await walk.snap('queued-01-zh-card-all-scope-shot2-generate-disabled')

  // ── 花钱之前：宿主要派发的两镜都是被授权的那一档；不是就关卡、一分钱不花（上面「卡在等人」那两条已验过）──
  const beforeConfirm = draftProblems()
  walk.report.draft = {
    runId, cardVariant: (await card.locator('[aria-label="变体"]').first().getAttribute('title').catch(() => null)) ?? null,
    shots: beforeConfirm.shots.map((shot) => ({ shotId: shot.shotId, variantId: shot.candidate?.variantId, transportModelId: shot.candidate?.transportModelId, parameters: shot.candidate?.parameters })),
  }
  if (beforeConfirm.problems.length) {
    await closeSpendCard(card, '草稿不是被授权的那一档，关卡不花钱')
    walk.report.verified = ['card-waiting-generate-all-excludes-agent-shots', 'card-waiting-shot-generate-disabled']
    walk.report.blockedBeforeSpend = beforeConfirm.problems
    throw new Error(`付费前拦下（一分钱没花，卡已关）：宿主要派发的不是被授权的 Seedance 2.0 fast · 480p · 4s · 无音频——`
      + `${beforeConfirm.problems.join('；')}；卡上显示的变体是 ${walk.report.draft.cardVariant}`)
  }

  // 逐帧观察者：第 2 镜的状态 / 排队小标 / ↑ 可按性，底栏「生成全部」的字——只记变化。
  await win.evaluate(({ shotId, generate, generateAll }) => {
    const log = []
    let last = ''
    const sample = () => {
      const node = document.querySelector(`[data-node-id="${shotId}"]`)
      // ↑ 只看第 2 镜自己浮框里的那一颗：别的节点（比如用户那个闲置节点）选中时的 ↑ 不算。
      const button = node?.querySelector(generate)
      const dock = document.querySelector(generateAll)
      const entry = {
        status: node?.getAttribute('data-status') ?? null,
        placeholder: node?.querySelector('[data-shot-placeholder-state]')?.getAttribute('data-shot-placeholder-state') ?? null,
        generate: button ? (button.disabled ? 'disabled' : 'enabled') : null,
        dock: dock ? (dock.textContent ?? '').trim() : null,
      }
      const key = JSON.stringify(entry)
      if (key !== last) { log.push({ at: Math.round(performance.now()), ...entry }); last = key }
    }
    window.__queuedShotLog = log
    sample()
    new MutationObserver(sample).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })
  }, { shotId: shot2, generate: '[data-bar-segment="generate"]', generateAll: GENERATE_ALL })

  await clickOrFail(card.locator(INTERVENTION_CONFIRM), '卡上的主按钮（全部）', { noWaitAfter: true })
  const dispatched = () => (readProductionRuns(projectRoot).find((run) => run.runId === runId)?.jobs ?? []).filter((job) => job.providerTaskId)
  await expect.poll(() => dispatched().length, { message: '两镜都交给了供应商', timeout: stationTimeout({ operations: 8 }) }).toBe(2)

  // ── 两镜在飞：两个入口都不许再发一次（zh，再 en）──
  const stillInFlight = async () => (await canvasNodes()).filter((node) => [shot1, shot2].includes(node.id) && !node.result?.url).length === 2
  const inFlight = { zh: false, en: false }
  if (await stillInFlight()) {
    walk.report.shot2GenerateInFlight = await shot2GenerateEntry('生成中')
    await deselect()
    await expect(win.locator(GENERATE_ALL), '生成中：「生成全部」只算那一个闲置节点').toContainText('1')
    await walk.snap('queued-02-zh-in-flight-generate-all-counts-one')
    inFlight.zh = true
  }
  // 观察者住在这一页里：重开之前把它记下的帧取走。
  walk.report.queuedShotLog = await win.evaluate(() => window.__queuedShotLog)
  if (inFlight.zh) {
    await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
    await win.reload()
    await expect(win.locator(`[data-node-id="${shot2}"]`)).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    if (await stillInFlight()) {
      await expect(win.locator(GENERATE_ALL), 'EN in flight: Generate all counts only the idle node').toContainText('1', { timeout: DEFAULT_TIMEOUT_MS })
      walk.report.shot2GenerateInFlightEn = await shot2GenerateEntry('EN in flight')
      await walk.snap('queued-03-en-in-flight-shot2-generate-disabled')
      inFlight.en = true
    }
  }
  walk.report.inFlightChecked = inFlight
  expect(inFlight.zh, '两镜在飞的窗口里做过一次两入口检查（真视频一两分钟，不该一眨眼就出片）').toBe(true)

  // ── 两镜落地 ──
  for (const id of [shot1, shot2]) {
    await expect.poll(async () => (await canvasNodes()).find((node) => node.id === id)?.result?.url ?? '', { message: `镜头 ${id} 的真视频落地`, timeout: VIDEO_LANDS_MS }).toMatch(/^nomi-local:\/\//)
  }
  const finalRun = readProductionRuns(projectRoot).find((run) => run.runId === runId)
  const jobs = (finalRun.jobs ?? []).filter((job) => job.providerTaskId)
  expect(new Set(jobs.map((job) => job.providerTaskId)).size, '整场恰好两笔供应商任务').toBe(2)
  // 多镜 Run 里 job 归哪一镜只看 `metadata.shotId`（electron/shared/productionShotPhase.ts jobsForShot 同一判据）。
  const perShot = plannedShots(finalRun).map((shot) => jobs.filter((job) => job.metadata?.shotId === shot.shotId).length)
  expect(perShot, '每一镜恰好一次提交（没有被画布再发一次）').toEqual([1, 1])
  const landed = (await canvasNodes()).filter((node) => [shot1, shot2].includes(node.id))
  walk.report.media = []
  for (const node of landed) {
    const media = await probeLandedMedia(projectRoot, projectId, node.result.url)
    walk.report.media.push({ nodeId: node.id, ...media })
    expect(media.probe.kind, `${node.id}：一段能解码的真视频`).toBe('video')
    expect(Math.abs(media.probe.durationSeconds - 4) < 0.5, `${node.id}：片长就是授权的 4 秒（实测 ${media.probe.durationSeconds}s）`).toBe(true)
    expect(media.probe.hasAudio, `${node.id}：无音频那一档`).toBe(false)
  }
  for (const id of [shot1, shot2]) {
    await expect(win.locator(`[data-node-id="${id}"]`), `${id}：落地之后不再转圈`).toHaveAttribute('data-status', 'success', { timeout: DEFAULT_TIMEOUT_MS })
  }

  // 观察者的记录：第 2 镜只要在排队 / 生成中、且 ↑ 在屏上，↑ 就必须按不下去；底栏只要在屏上，就只算 1 个。
  const log = walk.report.queuedShotLog ?? []
  const owned = log.filter((entry) => entry.placeholder === 'queued' || entry.status === 'queued' || entry.status === 'running')
  expect(owned.length, '观察者活着：看见了第 2 镜的排队 / 生成中').toBeGreaterThan(0)
  expect(owned.filter((entry) => entry.generate === 'enabled'), '第 2 镜排队 / 生成中的每一帧，↑ 都按不下去').toEqual([])
  expect(log.filter((entry) => entry.dock && !/\b1\b/.test(entry.dock)), '底栏「生成全部」出现过的每一帧都只算 1 个').toEqual([])
  walk.report.queuedPhaseObserved = owned.some((entry) => entry.placeholder === 'queued' || entry.status === 'queued')
  await walk.snap('queued-04-both-real-videos-landed')

  walk.report.verified = [
    'card-waiting-generate-all-excludes-agent-shots', 'card-waiting-shot-generate-disabled',
    'in-flight-generate-all-excludes-agent-shots', 'in-flight-shot-generate-disabled',
    'exactly-one-submission-per-shot', 'two-real-videos-land-as-local-mp4',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await paid.finish(failure)
}
