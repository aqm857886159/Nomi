#!/usr/bin/env node
// 真实用户任务（R13）：**Agent 起草两镜、用户在面板卡上点一下「生成 2 张」之后，每一镜只发一次——还没轮到的那一镜，画布上各扇生成入口也发不出第二次。**
//
// 2026-09-25（T-AG-24 / #875）：确认之后，排队中的那一镜在节点上是闲着的（排队只住在制作流程里，节点自己的状态还是 idle），
// 于是框菜单「生成整组」照样把它算进去，选中它时节点的生成钮也能按——再按一次就是同一镜重复生成、重复扣费。
// #875 让画布的生成入口（框菜单 / 组工具条 / 节点生成钮）都读这一镜此刻归谁。
//
// 2026-10-28（I-double-submit-walks）：D2 第③步（#1336，用户 2026-10-23 拍板 Q1 / Q3c）之后，造法和断言都按现行规矩改：
//   · 卡上一张卡一颗「生成 2 张」（翻页删了）：点一下就把没决定的两镜都交给画布那一台，每一镜走画布单节点提交；
//     制作 Run 自己不再派作业（盘上 0 个 job），作业住在每一镜自己的画布单镜 Run 里（`origin.handOverOf` 指回这一镜）。
//   · 「已授权、还没轮到」不再靠夹具压着受理：并发 6 之下两镜同时发。要造出排队，用仓库已有的 E2E 桥
//     `window.__nomiSetBatchConcurrency(1)`（ProductionCanvasLandingHost，先例 shot-nodes-lifecycle.e2e.mjs）把画布批量并发压到 1，
//     夹具再压着第一镜的受理——第二镜的交接已记下、同意已开、画布 Run 还没有作业，节点挂「排队中」，供应商一次都没收到它。
//   · 规矩的唯一说法在概念登记 docs/engineering/concept-owners/production.shot-generation-ownership.json 的 notes，这里不另抄。
//     钱的那半句（任何一扇门都不把同一镜交两次）由集成矩阵 electron/capabilityCore/sameShotOnceDoors.e2e.test.ts 兜；
//     这条走查只管屏上说真话 + 按钮态，供应商按镜各收几个、盘上每一镜的 Run 作业是几个做它的硬证据。
//
// 四个时刻（每个都用夹具按镜数请求 + 盘上 Run 的作业做硬证据，再看屏上说什么，zh + en）：
//   ① 第一镜提交中（夹具压着受理）、第二镜排队：框菜单 / 组工具条「生成整组」、两个节点的生成钮都按不下去；框头「生成全部」按了也不发。
//      中文看完，现场从设置里切英文（不重载：批次在渲染层内存里，重载会丢）再看一遍；
//   ② 放开受理、任务压在 processing：第一镜交到了、在生成，第二镜仍排在它后面（画布批量并发 1：前一镜出结果才轮到下一镜）；各扇门依旧发不出；
//   ③ 重载窗口（渲染层内存里什么都没了，英文）——排队那一镜去哪了：被收回，出价账上记着「撤回」（不是悄悄没了），节点说「还没生成」，
//      供应商从没收到它；第一镜节点变成「可取回」、↑ 看着能按，按下去主进程按节点的在途准入挡住，屏上说「这个节点还在生成」，
//      供应商仍只收到它 1 个——这一步守的就是 appIntegrationCanvasShot 的 assertNodeIdle（拿掉它，这里要红在「同一镜只收到 1 个」）；
//   ④ 被收回的第二镜没丢：用户自己按它的 ↑，供应商收到 1 个、出图。
//
// 别往 ①②③ 里加慢步骤：夹具压着的受理、压在 processing 的任务，App 这一头各有 2 分钟的等待上限——超了，第一镜变成「结果未知 / 可取回」，
// 排队的第二镜也被放出去（从点卡到走完 15 秒上下，余量够）。
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR, FIXTURE_TEXT_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CARD_PRIMARY, CARD_TITLE, armCanvasBridges, canvasRunsOf, cardTitle, offerFacts, pressPrimary, primaryLabel, say, shotNodes,
} from './_spendCardWalk.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL,
  chooseAssistantModel, createRuntimeWalk, openCanvas, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
import { groupFrame, groupFrameGenerateAll, openFrameMenuByRightClick, selectFrameByBlankClick } from './_groupFrame.mjs'
import { groupGenerateButton } from './_groupGenerate.mjs'
import { switchAppLocale } from './_permissionTiersPaidSteps.mjs'
import { uiText } from './full-walk/invariants.mjs'

const ASK = 'S_QUEUE_ASK：画两张橘猫：一张在窗台晒太阳，一张在沙发上打盹。先别生成。'
const GO = 'S_QUEUE_GO：好，生成吧。'
const PLAN_CALL = 's-queue-plan-1'
const GENERATE_CALL = 's-queue-go-1'
const GENERATE_BUTTON = '[data-bar-segment="generate"]'
const PAGER = '[data-v4-block="pager"]'
const LOCALE = { zh: 'zh-CN', en: 'en' }
const candidate = { providerId: FIXTURE_APIMART_VENDOR, modelId: FIXTURE_APIMART_MODEL }
/** 供应商收到的请求按镜认：请求体里的提示词带着这一镜的标题词。 */
const SHOT_WORD = { 'shot-1': '窗台', 'shot-2': '沙发' }
const requestsOfShot = (walk, shotId) => walk.fixture.images.filter((record) => String(record.body?.prompt ?? '').includes(SHOT_WORD[shotId]))
const perShot = (walk) => ({ 'shot-1': requestsOfShot(walk, 'shot-1').length, 'shot-2': requestsOfShot(walk, 'shot-2').length })
/** 画布单镜 Run 一行：`shot-1:submitting`（这一镜的 Run 里各作业此刻的状态，没有作业就空着）。 */
const runJobsLine = (runs) => runs.map((run) => `${run.shotId}:${run.jobs.map((job) => job.status).join('+')}`)

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

/** 点画布空白处取消选中。不按 Esc：框被选中时 Esc 取消不了它，后面点节点就点在「选中的框」里，节点自己的生成框不出现。 */
async function deselect(win) {
  const blank = await findCanvasBlankPoint(win)
  expect(Boolean(blank), '画布上找得到空白处').toBe(true)
  await win.mouse.click(blank.x, blank.y)
}

/**
 * 画布上各扇「再发一次」的门此刻的样子（按钮态，先拍后判，修前修后都有图）：框菜单「生成整组」、组工具条「生成整组」、
 * 每个节点自己的生成钮都按不下去。每一扇都先证它在屏上找得到（找不到的「按不下去」是空话），再判。
 * `snap`：这一刻要不要拍图（排队那一刻拍整窗 + 近景，别的时刻只判）。
 */
async function expectGenerateDoorsClosed(win, walk, { frame, nodeIds, locale, label, snap }) {
  const L = LOCALE[locale]
  if (snap) {
    await zoomOntoFrame(win, frame)
    await snapCloseUp(win, await walk.snap(`${snap}-canvas-${locale}`), [frame])
  }
  await openFrameMenuByRightClick(frame)
  const menuGenerate = win.locator('[data-frame-menu="true"] [role="menuitem"]').filter({ hasText: uiText(L, 'generationCommon.canvas.group.menuGenerate') })
  await proveProbe(menuGenerate, `${label}：框菜单里有「生成整组」`)
  if (snap) await snapCloseUp(win, await walk.snap(`${snap}-frame-menu-${locale}`), [frame, win.locator('[data-frame-menu="true"]')])
  const menuDisabled = await menuGenerate.isDisabled()
  await win.keyboard.press('Escape')
  expect(menuDisabled, `${label}：框菜单「生成整组」按不下去`).toBe(true)

  await selectFrameByBlankClick(frame)
  const toolbarGenerate = groupGenerateButton(win)
  await proveProbe(toolbarGenerate, `${label}：选中框后组工具条里有「生成整组」`)
  await expect(toolbarGenerate, `${label}：组工具条「生成整组」按不下去`).toBeDisabled()
  await deselect(win)

  for (const [shotId, nodeId] of Object.entries(nodeIds)) {
    const node = win.locator(`[data-node-id="${nodeId}"]`).first()
    await clickOrFail(node, `${label}：选中 ${shotId}`)
    const button = win.locator(`[data-node-id="${nodeId}"] ${GENERATE_BUTTON}`)
    await proveProbe(button, `${label}：选中后 ${shotId} 自己的生成钮出现`)
    if (snap) await snapCloseUp(win, await walk.snap(`${snap}-selected-${shotId}-${locale}`), [node, button])
    await expect(button, `${label}：${shotId} 的生成钮按不下去`).toBeDisabled()
    await deselect(win)
  }
}

/**
 * 框头「生成全部」：框里没东西可生成的这一刻按钮仍可按（只有框里没成员才置灰），按下去走的是同一个可生成集合——
 * 没有一镜可发，什么也不交，弹「这个组里没有可生成的…」。按钮可按就真按一下，证「按下去不发」；置灰了就是这扇门本来就关着。
 * 这里不把「可按」本身钉成规矩：只钉「按了也不发」。
 */
async function expectHeaderGenerateAllSendsNothing(win, walk, { frame, locale, label }) {
  const L = LOCALE[locale]
  const header = groupFrameGenerateAll(frame)
  await proveProbe(header, `${label}：框头有「生成全部」`)
  const before = perShot(walk)
  const pressable = await header.isEnabled()
  if (pressable) {
    await header.click()
    await expect(win.getByText(uiText(L, 'generationCommon.canvas.group.generateEmpty')).first(), `${label}：按下去说「这个组里没有可生成的节点」`).toBeVisible({ timeout: stationTimeout() })
  }
  expect(perShot(walk), `${label}：框头「生成全部」${pressable ? '按了也' : '本来就'}不发：供应商按镜的数没变`).toEqual(before)
  return pressable ? 'pressed-nothing-sent' : 'disabled'
}

const walk = await createRuntimeWalk('queued-shot-not-regenerable', { generationProvider: 'apimart', trustFixtureOrigin: true })
let failure
try {
  const { win } = await walk.start({ first: true })
  // 画布 / 落地 store 的 E2E 桥（含 `__nomiSetBatchConcurrency`）只在 localStorage.__nomiE2E === '1' 时挂：打开开关再重载一次。
  await armCanvasBridges(win)
  const { projectId } = await walk.newProject()
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
  // 读画布此刻的样子（E2E 桥上的 store），不读落盘的那份：落盘有延迟，节点和框都可能比屏上晚一拍（夜里撞上过「屏上有框、落盘还没有」）。
  await expect.poll(async () => (await shotNodes(win, projectId, operationId)).every((shot) => shot.nodeId),
    { message: '草稿落成两个图片节点', timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
  // 节点 ↔ 镜：按镜断言，不靠「哪个节点排在前面」猜。
  const nodeIds = Object.fromEntries((await shotNodes(win, projectId, operationId)).map((shot) => [shot.shotId, shot.nodeId]))
  expect(Object.keys(nodeIds).sort(), '两个节点各绑着 shot-1 / shot-2').toEqual(['shot-1', 'shot-2'])
  const groupOfShots = () => win.evaluate((ids) => (window.__nomiCanvasStore?.getState().groups ?? [])
    .find((group) => ids.every((id) => group.nodeIds.includes(id)))?.id ?? null, Object.values(nodeIds))
  await expect.poll(groupOfShots, { message: '两镜落在同一个框里', timeout: DEFAULT_TIMEOUT_MS }).not.toBeNull()
  const frame = groupFrame(win, await groupOfShots())

  // ── ② 一张卡一颗「生成 2 张」：点一下，两镜都交给画布；并发压到 1 + 夹具压着受理 → 第一镜提交中、第二镜排队 ──
  const goTurn = walk.fixture.expectText({
    label: 'the user says go and the agent presents the draft',
    match: (body) => flattenRequestText(body).includes('S_QUEUE_GO'),
    reply: { type: 'tool', id: GENERATE_CALL, name: 'generate', args: { operationId } },
  })
  // 这条走查不登记「generate 回话之后模型再说一句」的期待：重载窗口会让这一回合随窗口一起结束（见 ⑤），那一句永远不会来。
  await expect.poll(() => win.evaluate(() => typeof window.__nomiSetBatchConcurrency), { message: 'E2E 桥挂出来了', timeout: DEFAULT_TIMEOUT_MS }).toBe('function')
  await win.evaluate(() => window.__nomiSetBatchConcurrency(1))
  await sendCanvas(win, GO)
  await recorded(goTurn.received, 'generate request')
  const card = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="spend"]`)
  const cardProof = await proveProbe(card, '报价卡摆在面板里等人')
  await expect(card.locator(CARD_TITLE), '卡问的是这两镜').toContainText(cardTitle(LOCALE.zh, 2, 'image'))
  await expect(card.locator(CARD_PRIMARY), '一张卡一颗「生成 2 张」').toContainText(primaryLabel(LOCALE.zh, { count: 2, kind: 'image' }))
  await expectAbsent(card.locator(PAGER), { provenBy: cardProof, message: '没有翻页（Q1：一张卡一颗生成）' })
  expect(perShot(walk), '按之前供应商一次请求都没收到').toEqual({ 'shot-1': 0, 'shot-2': 0 })
  await walk.snap('card-two-shots-zh')

  walk.fixture.holdSubmits(true)
  await pressPrimary(card, '卡上的「生成 2 张」（只按这一次）')
  await expect.poll(() => requestsOfShot(walk, 'shot-1').length, { message: '第一镜的生成请求到了供应商', timeout: stationTimeout({ operations: 4 }) }).toBe(1)
  await expect.poll(async () => (await nodeFace(win, nodeIds['shot-2'])).placeholder, { message: '第二镜挂着「排队中」', timeout: stationTimeout({ operations: 4 }) }).toBe('queued')
  // 第一镜在供应商那边（提交中，等一会儿状态行会改说「生成中 · 已等 N 秒」）——两个字都是「已经在路上」，只要不是排队 / 空闲。
  expect((await nodeFace(win, nodeIds['shot-1'])).phase, '第一镜已经在路上（提交中 / 生成中），不是排队').toMatch(/^(submitting|generating)$/)
  // 卡在报进度（进度数字 N/M 会随第一镜的状态行一起走，不钉它；钉「点取消停下剩下的」这句提示，它在整个批次进行中都在）。
  await expect(card, '卡在报进度：点「取消」停下剩下的').toContainText(say(LOCALE.zh, 'agentPanelV4.spendBatchStopHint'))

  // 按镜的硬证据（供应商 / 盘上）：第一镜 1 个请求、第二镜一个都还没到；制作 Run 0 个作业；出价上两笔交接都是用户点的；
  // 画布单镜 Run：第一镜 1 个作业在提交，第二镜 0 个作业（同意已开、还没轮到）。
  expect(perShot(walk), '第一镜只收到 1 个，第二镜还没轮到').toEqual({ 'shot-1': 1, 'shot-2': 0 })
  const held = await offerFacts(win, projectId, operationId)
  expect(held.productionJobs, '制作 Run 自己 0 个作业（作业住在每一镜的画布单镜 Run 里）').toBe(0)
  expect(held.open, '出价还开着（两镜都还没交完）').toBe(true)
  expect(held.handOvers.map((entry) => `${entry.shotId}:${entry.by}`), '出价上两笔交接，都是用户点的').toEqual(['shot-1:gesture', 'shot-2:gesture'])
  await expect.poll(async () => runJobsLine(await canvasRunsOf(win, projectId, operationId)),
    { message: '画布单镜 Run：第一镜 1 个作业在提交，第二镜 0 个作业', timeout: stationTimeout({ operations: 2 }) }).toEqual(['shot-1:submitting', 'shot-2:'])

  // ── ③ 排队那一刻：各扇再发一次的门都发不出（zh；再现场切到英文，批次与排队不变，英文下再核一遍）──
  await expectGenerateDoorsClosed(win, walk, { frame, nodeIds, locale: 'zh', label: 'zh 排队时', snap: 'queued' })
  const headerZh = await expectHeaderGenerateAllSendsNothing(win, walk, { frame, locale: 'zh', label: 'zh 排队时' })
  await switchAppLocale(win, LOCALE.en)
  await expect(card, '英文界面：卡还在报进度（Cancel to stop the rest）').toContainText(say(LOCALE.en, 'agentPanelV4.spendBatchStopHint'))
  expect((await nodeFace(win, nodeIds['shot-2'])).placeholder, '切语言没动批次：第二镜仍在排队').toBe('queued')
  await expectGenerateDoorsClosed(win, walk, { frame, nodeIds, locale: 'en', label: 'en 排队时', snap: 'queued' })
  const headerEn = await expectHeaderGenerateAllSendsNothing(win, walk, { frame, locale: 'en', label: 'en 排队时' })
  expect(perShot(walk), '排队的整个过程里，画布没有替任何一镜再发一次').toEqual({ 'shot-1': 1, 'shot-2': 0 })
  walk.report.queuedMoment = { frameHeaderGenerateAll: { zh: headerZh, en: headerEn }, perShot: perShot(walk), canvasRuns: runJobsLine(await canvasRunsOf(win, projectId, operationId)) }

  // ── ④ 放开受理（任务压在 processing）：第一镜交到了、在生成；第二镜仍排在它后面（并发 1：前一镜出结果才轮到下一镜）──
  walk.fixture.holdTasks(true)
  walk.fixture.holdSubmits(false)
  await expect.poll(async () => (await offerFacts(win, projectId, operationId)).handOvers.map((entry) => `${entry.shotId}:${entry.outcome}`),
    { message: '第一镜的交接落定为「交到了」，第二镜还没落定', timeout: stationTimeout({ operations: 6 }) }).toEqual(['shot-1:accepted', 'shot-2:null'])
  await expect.poll(async () => runJobsLine(await canvasRunsOf(win, projectId, operationId)).join(),
    { message: '画布单镜 Run：第一镜的作业在供应商那边查询，第二镜还是 0 个作业', timeout: stationTimeout({ operations: 4 }) }).toMatch(/^shot-1:(provider_accepted|polling),shot-2:$/)
  await expect.poll(async () => (await nodeFace(win, nodeIds['shot-1'])).phase, { message: '第一镜状态行说「生成中」', timeout: stationTimeout({ operations: 4 }) }).toBe('generating')
  expect((await nodeFace(win, nodeIds['shot-2'])).placeholder, '第二镜仍排在第一镜后面').toBe('queued')
  expect(perShot(walk), '第一镜 1 个、第二镜还没轮到').toEqual({ 'shot-1': 1, 'shot-2': 0 })
  await expectGenerateDoorsClosed(win, walk, { frame, nodeIds, locale: 'en', label: 'en 第一镜生成中、第二镜排队', snap: 'inflight' })
  walk.report.inFlightMoment = {
    perShot: perShot(walk), handOvers: (await offerFacts(win, projectId, operationId)).handOvers.map((entry) => `${entry.shotId}:${entry.outcome}`),
    canvasRuns: runJobsLine(await canvasRunsOf(win, projectId, operationId)),
  }

  // ── ⑤ 重载窗口（英文已经是界面语言）：渲染层内存里的批次、节点在生成的记号都没了 ──
  await win.reload()
  await expect.poll(async () => (await nodeFace(win, nodeIds['shot-1'])).present && (await nodeFace(win, nodeIds['shot-2'])).present,
    { message: '重载之后两个节点回来了', timeout: stationTimeout({ operations: 6 }) }).toBe(true)
  // 排队那一镜去哪了：被收回——出价按「停下」关，这一镜的交接落定为「撤回」；节点说「还没生成」；供应商从没收到它；卡随回合一起没了。
  await expect.poll(async () => (await offerFacts(win, projectId, operationId)).handOvers.map((entry) => `${entry.shotId}:${entry.outcome}`),
    { message: '重载之后排队那一镜的交接落定为「撤回」（出价账上有交代，不是悄悄没了）', timeout: stationTimeout({ operations: 6 }) }).toEqual(['shot-1:accepted', 'shot-2:withdrawn'])
  const reloaded = await offerFacts(win, projectId, operationId)
  expect(reloaded.closedBy, '出价按「停下」关').toBe('stopped')
  await expect.poll(async () => (await nodeFace(win, nodeIds['shot-2'])).placeholder, { message: '排队那一镜说「还没生成」，不再说排队', timeout: stationTimeout({ operations: 4 }) }).toBe('not_generated')
  await expectAbsent(card, { provenBy: cardProof, message: '重载之后进度卡没了（回合随窗口一起结束）' })
  expect(perShot(walk), '重载之后排队那一镜供应商仍一次都没收到').toEqual({ 'shot-1': 1, 'shot-2': 0 })
  await walk.snap('reloaded-en')

  // 第一镜：节点变成「可取回」，↑ 看着能按（渲染层不记得它在生成了）——按下去，主进程按节点的在途准入挡住，供应商仍只收到这一镜 1 个。
  const node1 = win.locator(`[data-node-id="${nodeIds['shot-1']}"]`).first()
  await clickOrFail(node1, '重载后选中第一镜')
  const up1 = win.locator(`[data-node-id="${nodeIds['shot-1']}"] ${GENERATE_BUTTON}`)
  await proveProbe(up1, '重载后第一镜自己的生成钮出现')
  await walk.snap('reloaded-shot-1-selected-en')
  // 这一句是下面「主进程挡」那一步的前提：若 ↑ 在这里变灰，说明渲染层自己挡住了，这一步就不再覆盖主进程的在途准入——得另找办法覆盖它，别让它悄悄变成空话。
  await expect(up1, '重载之后渲染层不认得第一镜在生成：它的 ↑ 看着按得下去（主进程的在途准入是最后一道）').toBeEnabled()
  await up1.click({ noWaitAfter: true })
  const blocked = win.getByText(uiText(LOCALE.en, 'generationCommon.observability.error.nodeInFlight.reason')).first()
  // 先等「有结论」：要么屏上说了「这个节点还在生成」，要么供应商又收到了请求；再判对错（同一镜只收到 1 个）。
  await expect.poll(async () => (requestsOfShot(walk, 'shot-1').length > 1 ? 'sent-again' : (await blocked.isVisible()) ? 'blocked' : 'waiting'),
    { message: '按下 ↑ 之后必须有结论（主进程挡了，或又发出去了）', timeout: stationTimeout({ operations: 4 }) }).not.toBe('waiting')
  expect(requestsOfShot(walk, 'shot-1'), '同一镜只收到 1 个').toHaveLength(1)
  await expect(blocked, '主进程挡住这一笔，屏上照实说「这个节点还在生成」').toBeVisible()
  await walk.snap('reloaded-shot-1-blocked-en')
  await deselect(win)
  walk.report.reloadedMoment = {
    perShot: perShot(walk), offerClosedBy: reloaded.closedBy, handOvers: reloaded.handOvers.map((entry) => `${entry.shotId}:${entry.outcome}`),
    canvasRuns: runJobsLine(await canvasRunsOf(win, projectId, operationId)), shot1UpBlockedBy: 'nodeInFlight',
  }

  // ── ⑥ 被收回的第二镜没丢：用户自己按它的 ↑，供应商收到 1 个，出图 ──
  const node2 = win.locator(`[data-node-id="${nodeIds['shot-2']}"]`).first()
  await clickOrFail(node2, '重载后选中第二镜')
  const up2 = win.locator(`[data-node-id="${nodeIds['shot-2']}"] ${GENERATE_BUTTON}`)
  await proveProbe(up2, '重载后第二镜自己的生成钮出现')
  await expect(up2, '被收回的第二镜没人在生成它：↑ 按得下去').toBeEnabled()
  await up2.click({ noWaitAfter: true })
  await expect.poll(() => requestsOfShot(walk, 'shot-2').length, { message: '用户按了第二镜的 ↑：供应商收到它', timeout: stationTimeout({ operations: 4 }) }).toBe(1)
  walk.fixture.holdTasks(false)
  await expect(win.locator(`[data-node-id="${nodeIds['shot-2']}"][data-status="success"]`), '第二镜出图（success）').toBeVisible({ timeout: stationTimeout({ operations: 6 }) })
  expect(perShot(walk), '整个过程里每一镜只收到 1 个').toEqual({ 'shot-1': 1, 'shot-2': 1 })
  expect(walk.fixture.images, '整个过程里供应商一共只收到 2 个生成请求').toHaveLength(2)
  await walk.snap('done-en')

  walk.report.verified = ['queued-shot-frame-generate-disabled', 'queued-shot-generate-button-disabled', 'one-request-per-shot',
    'reload-withdraws-the-queued-shot-on-the-ledger', 'reload-second-submit-refused-by-main-node-in-flight', 'withdrawn-shot-generates-once-when-asked']
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  walk.fixture?.holdSubmits(false)
  walk.fixture?.holdTasks(false)
  await walk.finish(failure)
}
