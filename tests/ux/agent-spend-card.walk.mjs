#!/usr/bin/env node
// 真实用户任务（R13/R16，D2 第③步，SpendCardQ1 板）：**Agent 说「已在画布上起草了 3 个镜头」之后，钱这一步长什么样。**
//
// 卡 = 指向元素（脸和画布节点一样）+ 一行只读摘要 + 「全部生成（N）」+「取消」。卡上没有可改的东西：想改就点指向元素，
// 画布滑过去、节点闪一下、生成框打开，在节点里改，卡上的摘要跟着变。点「生成」= 这几镜各走画布单节点提交（和节点 ↑ 同一条路），
// 宿主的出价按「已交给画布」关。
//
// 设计卡 ★1 的两个真实任务在这里跑通（C「节点上先点 ↑、卡上生成剩下 2 段」在 agent-spend-generate-remaining）：
//   A 纸船三镜头：文生视频 3 段，参数默认，「全部生成（3）」；
//   B 两段 9:16 竖版 + 一段横版，在节点里改其中一段的时长，再「全部生成（3）」。
// 每个任务都核：卡上摘要 = 节点参数 = 假上游收到的请求体。
//
// 板断言（SpendCardQ1，真 App 里才看得见的那几条；卡本身的长相在 design-lab-spend-card.walk.mjs）：
//   · board:SpendCardQ1/canvas.node.highlight —— 悬停指向元素，画布那个节点同亮；点它，节点闪一下；完成时各亮一下；
//   · board:SpendCardQ1/node.composer —— 节点生成框里改时长，卡上那一镜的摘要跟着变，发出去的就是改过的；
//   · board:SpendCardQ1/dock.pending-count —— 面板收成小球，「等你确认」的数也数上这张卡；
//   · board:SpendCardQ1/host.one-engine —— 点「生成」逐节点走画布单节点提交（制作 Run 自己不派作业，每一镜一个画布单镜 Run），
//     出价按「已交给画布」关，回合读回逐镜结局（回执照旧说三镜都在生成）。
// 最后一段：「取消」只收回这一次出价（节点留着），冷启动不复活旧卡，同一份草稿再 generate 卡就回来、读的是节点此刻的样子；
// 切到「直接生成」档，已经摆着的卡照样等人答（钱不因档位放行）；然后接 33 镜摆 3 镜那一段（_agentSpendScopeJourney）。
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。不灌 store、不直调桥。
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { checkSpendScopeJourney } from './_agentSpendScopeJourney.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CARD_BODY, CARD_CANCEL, CARD_EDITORS, CARD_TITLE, MONEY, NODE_COMPOSER, POINTER, RECEIPT_POINTERS, SPEND_CARD,
  armCanvasBridges, canvasHighlightOf, canvasNode, canvasRunsOf, cardFacts, cardTitle, createPresenter, editNodeParameter,
  hoverSummaryOf, nodeParams, offerFacts, pointerAway, pointerFace, pressPrimary, primaryLabel, say, secondsText, seenHighlights,
  shotNodes, watchCanvasHighlights, wireParams,
} from './_spendCardWalk.mjs'
import {
  APPROVAL_CARD, CANVAS_PANEL, COLLAPSE_BUTTON, COLLAPSED_DOCK, COMPOSER_PERMISSION, INTERVENTION_CONFIRM, permissionTier,
  createRuntimeWalk, openCanvas, readProject, recorded, sendCanvas,
} from './agent-runtime-walk-support.mjs'

const LOCALE = 'zh-CN'
const VIDEO = 'doubao-seedance-2.0@apimart'
const IMAGE = 'gpt-image-2@apimart'
const A = {
  highlight: 'board:SpendCardQ1/canvas.node.highlight',
  composer: 'board:SpendCardQ1/node.composer',
  dock: 'board:SpendCardQ1/dock.pending-count',
  engine: 'board:SpendCardQ1/host.one-engine',
}

const present = createPresenter('S_SPEND')

/** 供应商收到的每一笔（按提示词认回是哪一镜）。 */
function requestsByShot(walk, from, shots) {
  return walk.fixture.videos.slice(from).map((record) => {
    const facts = wireParams(record.body)
    const shot = shots.find((candidate) => candidate.node?.prompt && facts.prompt.includes(candidate.node.prompt))
    return { shotId: shot?.shotId ?? null, ...facts }
  })
}

/** 「节点参数 = 发出去的」：每一镜请求体的比例 / 时长 / 清晰度逐项等于它节点上的（节点上有的那几样）。 */
function expectWireEqualsNodes(label, requests, nodes) {
  expect(requests.map((request) => request.shotId).sort(), `${label}：供应商收到的正好是这几镜、各一次`).toEqual(nodes.map((shot) => shot.shotId).sort())
  for (const shot of nodes) {
    const request = requests.find((candidate) => candidate.shotId === shot.shotId)
    const expected = nodeParams(shot.node.meta)
    if (expected.aspect) expect(request.aspect, `${label}：${shot.title} 发出去的比例 = 节点上的`).toBe(expected.aspect)
    if (expected.duration) expect(request.duration, `${label}：${shot.title} 发出去的时长 = 节点上的`).toBe(expected.duration)
    if (expected.resolution) expect(String(request.resolution ?? '').toLowerCase(), `${label}：${shot.title} 发出去的清晰度 = 节点上的`).toBe(expected.resolution.toLowerCase())
  }
}

/** 「卡上摘要 = 节点参数」（整齐的那一种）：组下方那一行写的比例、清晰度、总时长都是节点上的。 */
function expectUniformSummary(label, summary, nodes) {
  expect(summary, `${label}：卡上有组下方那一行摘要`).toBeTruthy()
  const params = nodes.map((shot) => nodeParams(shot.node.meta))
  for (const facts of params) {
    if (facts.aspect) expect(summary, `${label}：摘要里有节点上的比例 ${facts.aspect}`).toContain(facts.aspect)
    if (facts.resolution) expect(summary, `${label}：摘要里有节点上的清晰度 ${facts.resolution}`).toContain(facts.resolution)
  }
  if (params.every((facts) => facts.duration)) {
    const total = params.reduce((sum, facts) => sum + facts.duration, 0)
    expect(summary, `${label}：摘要里的总时长是节点上的时长加起来`).toContain(say(LOCALE, 'agentPanelV4.spendCard.summarySeconds', { value: secondsText(total) }))
  }
}

const walk = await createRuntimeWalk('spend-card', { generationProvider: 'apimart', trustFixtureOrigin: true })
let failure
try {
  let { win } = await walk.start({ first: true })
  await armCanvasBridges(win)
  const { projectId, name } = await walk.newProject()
  await openCanvas(win)
  await expect(win.locator(`${CANVAS_PANEL} [data-v4-block="composer"]`)).toHaveAttribute('data-approval-mode', 'request')
  walk.report.wire = {}

  // ── 任务 A：纸船三镜头，文生视频 3 段，参数默认 ──────────────────────────────────────────────
  const taskA = await present(walk, win, {
    locale: LOCALE, kind: 'video',
    shots: (tag) => [1, 2, 3].map((index) => ({
      title: `${tag} 纸船 ${index}`, prompt: `${tag} 纸船第 ${index} 镜：雨后清晨，纸船顺着水流漂`, taskKind: 'text_to_video', model: VIDEO,
    })),
  })
  const cardA = taskA.card
  const cardProof = await proveProbe(cardA, '付费卡在 Agent 面板的介入槽里')
  let nodesA = await shotNodes(win, projectId, taskA.operationId)
  expect(nodesA.every((shot) => shot.nodeId), '三镜都落到了画布上').toBe(true)
  walk.report.taskANodes = nodesA.map((shot) => ({ shotId: shot.shotId, nodeId: shot.nodeId, meta: shot.node.meta }))
  await pointerAway(win)
  let facts = await cardFacts(win)
  expect(facts.title, '标题问的是这三段').toBe(cardTitle(LOCALE, 3, 'video'))
  expect(facts.pointers.map((pointer) => pointer.id), '卡上是三个指向元素，按分镜顺序指着那三个节点').toEqual(nodesA.map((shot) => shot.nodeId))
  expect(facts.editors, '卡上没有一个可改的东西（生成框 / 参数 chip / 输入框）——改参数的家只有节点').toBe(0)
  expect(facts.confirm?.text, '主按钮是「全部生成（3）」').toBe(primaryLabel(LOCALE, { count: 3, kind: 'video' }))
  expect(facts.confirm?.text ?? '', '动作行上不出钱').not.toMatch(MONEY)
  walk.report.taskASummary = facts.groupSummary
  expectUniformSummary('任务 A', facts.groupSummary, nodesA)
  expect(walk.fixture.videos, '卡还没按之前，供应商一笔都没收到').toHaveLength(0)
  await walk.snap('task-a-card-three-pointers')

  // 悬停指向元素：画布那个节点同亮（中性样式），组下方那一行换成这一镜的摘要。
  await watchCanvasHighlights(win)
  await pointerFace(cardA, nodesA[0].nodeId).hover()
  await expect.poll(() => canvasHighlightOf(win, nodesA[0].nodeId), { message: `${A.highlight}：悬停第 1 个指向元素，画布上那个节点同亮`, timeout: stationTimeout() }).toBe('hover')
  await walk.snap('task-a-hover-pointer-canvas-node-lit')
  await pointerAway(win)
  await expect.poll(() => canvasHighlightOf(win, nodesA[0].nodeId), { message: `${A.highlight}：鼠标移开，画布上那个节点不再亮`, timeout: stationTimeout() }).toBe(null)

  // 收成小球：「等你确认」的数也数上这张卡（Q5）。
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COLLAPSE_BUTTON}`), '面板收成小球')
  const ball = win.locator(COLLAPSED_DOCK).first()
  await expect(ball, `${A.dock}：收起后小球说有一件在等你确认`).toHaveAttribute('data-agent-ball', 'pending', { timeout: stationTimeout() })
  await expect(ball, `${A.dock}：等你确认的数里有这张付费卡`).toHaveAttribute('data-agent-dock-count', '1')
  await walk.snap('task-a-collapsed-ball-counts-the-card')
  await clickOrFail(ball, '点小球把面板叫回来')
  await expect(cardA, '面板回来，卡还在原处等着').toBeVisible({ timeout: stationTimeout() })

  // 点第 2 个指向元素：画布滑过去、节点闪一下、生成框为它打开。
  await clickOrFail(pointerFace(cardA, nodesA[1].nodeId), '点第 2 个指向元素的缩略图（去节点里看）')
  await expect.poll(async () => (await seenHighlights(win)).some((seen) => seen.nodeId === nodesA[1].nodeId && seen.value === 'flash'),
    { message: `${A.highlight}：点指向元素，画布上那个节点闪一下`, timeout: stationTimeout() }).toBe(true)
  await expect(win.locator(canvasNode(nodesA[1].nodeId)), '画布上那个节点露在眼前').toBeInViewport()
  await expect(win.locator(NODE_COMPOSER), '那个节点的生成框打开了（改参数的家）').toBeVisible({ timeout: stationTimeout() })
  await walk.snap('task-a-click-pointer-node-flashes')
  await pointerAway(win)
  // 定位那一下闪完了再按（闪是 1.4 秒）：不然「完成时各亮一下」落在一个还亮着的节点上，看不出它又亮了一次。
  await expect.poll(() => canvasHighlightOf(win, nodesA[1].nodeId), { message: '定位那一下闪完了', timeout: stationTimeout() }).toBe(null)

  // 点「全部生成（3）」：每一镜走画布单节点提交。
  const videosBeforeA = walk.fixture.videos.length
  await watchCanvasHighlights(win)
  await pressPrimary(cardA, '任务 A：「全部生成（3）」')
  await expect.poll(() => walk.fixture.videos.length - videosBeforeA, { message: `${A.engine}：供应商收到三笔视频请求`, timeout: stationTimeout({ operations: 6 }) }).toBe(3)
  await expectAbsent(cardA, { provenBy: cardProof, message: '三镜都交出去了，卡收起来' }, stationTimeout({ operations: 6 }))
  walk.report.highlightsAtClose = await seenHighlights(win)
  const receiptA = flattenRequestText((await recorded(taskA.turnDone.received, '任务 A：generate 在卡答完之后返回', stationTimeout({ operations: 6 }))).body)
  expect(receiptA, `${A.engine}：回合读回逐镜结局——三镜都在生成（回执文案不变）`).toContain('All 3 shot(s) on the card are generating')
  nodesA = await shotNodes(win, projectId, taskA.operationId)
  const requestsA = requestsByShot(walk, videosBeforeA, nodesA)
  walk.report.wire.taskA = walk.fixture.videos.slice(videosBeforeA).map((record) => record.body)
  expectWireEqualsNodes('任务 A', requestsA, nodesA)
  const offerA = await offerFacts(win, projectId, taskA.operationId)
  walk.report.taskAOffer = offerA
  expect(offerA.closedBy, `${A.engine}：出价按「已交给画布」关`).toBe('handed_to_canvas')
  expect(offerA.handOvers.map((entry) => entry.by), `${A.engine}：三镜都记成卡上那一下（手势）交出去的`).toEqual(['gesture', 'gesture', 'gesture'])
  expect(offerA.productionJobs, `${A.engine}：制作 Run 自己一笔作业都没派——钱走的是画布那一台发动机`).toBe(0)
  const canvasRunsA = await canvasRunsOf(win, projectId, taskA.operationId)
  walk.report.taskACanvasRuns = canvasRunsA
  expect(new Set(canvasRunsA.map((run) => run.runId)).size, `${A.engine}：每一镜一个画布单镜 Run`).toBe(3)
  expect(canvasRunsA.every((run) => run.jobs.length === 1), `${A.engine}：每个画布单镜 Run 正好一笔作业`).toBe(true)
  // 卡关了：对话流里留一行「已发出 3 段」，指着交出去的那三个节点（Q4）。
  const receiptRow = win.locator(`${CANVAS_PANEL} ${RECEIPT_POINTERS}`).last()
  await expect(receiptRow, '卡关了之后对话流里有交出去的那几镜').toBeVisible({ timeout: stationTimeout() })
  await expect(receiptRow).toContainText(say(LOCALE, 'agentPanelV4.spendCard.receiptSentVideo', { count: 3 }))
  await walk.snap('task-a-sent-three-receipt')
  // 供应商出片：三个节点出结果，各亮一下；对话流那一行变成「已生成 3 段」。
  walk.report.highlightsBeforeRelease = await seenHighlights(win)
  walk.fixture.releaseVideos()
  for (const shot of nodesA) {
    await expect(win.locator(canvasNode(shot.nodeId)), `${shot.title} 出了结果`).toHaveAttribute('data-status', 'success', { timeout: stationTimeout({ operations: 8 }) })
  }
  await expect.poll(async () => {
    const seen = await seenHighlights(win)
    return nodesA.every((shot) => seen.some((entry) => entry.nodeId === shot.nodeId && entry.value === 'flash'))
  }, { message: `${A.highlight}：完成时画布上那三个节点各亮一下`, timeout: stationTimeout({ operations: 4 }) }).toBe(true)
  await expect(receiptRow).toContainText(say(LOCALE, 'agentPanelV4.spendCard.receiptGeneratedVideo', { count: 3 }), { timeout: stationTimeout() })
  await walk.snap('task-a-generated-three-receipt')

  // ── 任务 B：两段 9:16 竖版 + 一段横版，在节点里改一段的时长，再生成 ───────────────────────────────
  const taskB = await present(walk, win, {
    locale: LOCALE, kind: 'video',
    shots: (tag) => [
      { title: `${tag} 竖版 1`, prompt: `${tag} 竖版第 1 镜：巷口的猫`, taskKind: 'text_to_video', model: VIDEO, aspectRatio: '9:16' },
      { title: `${tag} 竖版 2`, prompt: `${tag} 竖版第 2 镜：猫跳上墙头`, taskKind: 'text_to_video', model: VIDEO, aspectRatio: '9:16' },
      { title: `${tag} 横版 3`, prompt: `${tag} 横版第 3 镜：屋顶远景`, taskKind: 'text_to_video', model: VIDEO, aspectRatio: '16:9' },
    ],
  })
  const cardB = taskB.card
  let nodesB = await shotNodes(win, projectId, taskB.operationId)
  expect(nodesB.map((shot) => nodeParams(shot.node.meta).aspect), '任务 B：起草的比例落到了节点上').toEqual(['9:16', '9:16', '16:9'])
  await pointerAway(win)
  facts = await cardFacts(win)
  expect(facts.pointers.map((pointer) => pointer.id), '任务 B：三个指向元素指着那三个节点').toEqual(nodesB.map((shot) => shot.nodeId))
  walk.report.taskBSummary = facts.groupSummary
  const mixedGroups = [say(LOCALE, 'agentPanelV4.spendCard.summaryGroup', { value: '9:16', count: 2 }), say(LOCALE, 'agentPanelV4.spendCard.summaryGroup', { value: '16:9', count: 1 })].join(' · ')
  expect(facts.groupSummary, '任务 B：比例逐镜不同，摘要按比例分组').toContain(mixedGroups)
  expect(facts.groupSummary, '任务 B：摘要不再带「N 镜 · 逐镜不同」前缀').not.toContain('逐镜不同')
  await walk.snap('task-b-card-mixed-aspects')
  // 点第 3 个指向元素，在它的生成框里把时长改了：卡上那一镜的摘要跟着变（读节点，不存副本）。
  const hoverBefore = await hoverSummaryOf(win, nodesB[2].nodeId)
  await clickOrFail(pointerFace(cardB, nodesB[2].nodeId), '任务 B：点第 3 个指向元素的缩略图（去节点里改）')
  const edited = await editNodeParameter(win, nodesB[2].nodeId, 'duration')
  walk.report.taskBDuration = edited
  const hoverAfter = await hoverSummaryOf(win, nodesB[2].nodeId)
  walk.report.taskBHover = { before: hoverBefore, after: hoverAfter }
  expect(hoverAfter, `${A.composer}：节点里改了时长，卡上那一镜的摘要跟着变`).toContain(secondsText(edited.after))
  expect(hoverAfter, `${A.composer}：摘要不是改之前那一句`).not.toBe(hoverBefore)
  await walk.snap('task-b-node-duration-edited-card-follows')
  nodesB = await shotNodes(win, projectId, taskB.operationId)
  expect(nodeParams(nodesB[2].node.meta).duration, `${A.composer}：节点上的时长就是改过的那个`).toBe(edited.after)
  const videosBeforeB = walk.fixture.videos.length
  await pressPrimary(cardB, '任务 B：「全部生成（3）」')
  await expect.poll(() => walk.fixture.videos.length - videosBeforeB, { message: '任务 B：供应商收到三笔', timeout: stationTimeout({ operations: 6 }) }).toBe(3)
  await recorded(taskB.turnDone.received, '任务 B：generate 在卡答完之后返回', stationTimeout({ operations: 6 }))
  const requestsB = requestsByShot(walk, videosBeforeB, nodesB)
  walk.report.wire.taskB = walk.fixture.videos.slice(videosBeforeB).map((record) => record.body)
  expectWireEqualsNodes('任务 B', requestsB, nodesB)
  expect(requestsB.find((request) => request.shotId === nodesB[2].shotId)?.duration, `${A.composer}：发出去的是节点里改过的时长`).toBe(edited.after)
  expect(requestsB.filter((request) => request.aspect === '9:16'), '任务 B：两段竖版按竖版发').toHaveLength(2)

  // ── 「取消」只收回这一次出价：节点留着；冷启动不复活；同一份草稿再 generate，卡回来、读的是节点此刻的样子 ───────────
  const taskX = await present(walk, win, {
    locale: LOCALE, kind: 'image',
    shots: (tag) => [{ title: `${tag} 六棱柱`, prompt: `${tag} 一个悬浮的六棱柱，柔和的演播室灯光`, taskKind: 'text_to_image', model: IMAGE }],
  })
  const cardX = taskX.card
  const xProof = await proveProbe(cardX, '单段卡摆出来了')
  const [shotX] = await shotNodes(win, projectId, taskX.operationId)
  facts = await cardFacts(win)
  expect(facts.pointers.map((pointer) => pointer.id), '单段卡是一个指向元素，指着那个节点').toEqual([shotX.nodeId])
  expect(facts.confirm?.text, '单段卡的主按钮就是「生成」').toBe(primaryLabel(LOCALE, { count: 1, kind: 'image', single: true }))
  expect(facts.editors, '单段卡上也没有编辑器零件').toBe(0)
  // 在节点上改提示词：卡不存副本，取消之后这一处改动还在节点上。
  await clickOrFail(pointerFace(cardX, shotX.nodeId), '点单段卡的缩略图')
  const promptBox = win.locator(`${NODE_COMPOSER} [contenteditable="true"]`).first()
  await expect(promptBox, '节点的生成框打开了').toBeVisible({ timeout: stationTimeout() })
  await promptBox.click()
  await win.keyboard.press('ControlOrMeta+End')
  const PROMPT_TAIL = '背景加一层薄雾'
  await win.keyboard.insertText(`，${PROMPT_TAIL}`)
  await expect.poll(async () => (await shotNodes(win, projectId, taskX.operationId))[0].node.prompt, { message: '节点上的提示词改了', timeout: stationTimeout() }).toContain(PROMPT_TAIL)
  await pointerAway(win)
  const imagesBeforeX = walk.fixture.images.length
  await clickOrFail(cardX.locator(CARD_CANCEL), '「取消」（收回这一次出价）')
  await expectAbsent(cardX, { provenBy: xProof, message: '取消之后卡退出介入槽' })
  const declined = flattenRequestText((await recorded(taskX.turnDone.received, '取消之后 generate 返回')).body)
  expect(declined, '模型读到的是「他关了这张卡」，不是一个错误').toContain('the user cancelled the card before deciding them')
  const offerX = await offerFacts(win, projectId, taskX.operationId)
  expect(offerX.closedBy, '出价按「用户关了卡」关').toBe('user_closed')
  expect(offerX.planState, '收回的是出价，不是计划').toBe('draft')
  expect(walk.fixture.images.length - imagesBeforeX, '取消不提交').toBe(0)
  const nodesBeforeRestart = (await readProject(win, projectId)).payload.generationCanvas.nodes.map((node) => node.id).sort()
  // 冷启动：旧卡不复活，节点都在。
  await walk.stopApp()
  ;({ win } = await walk.start())
  const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: name })
  await expect(projectCard).toBeVisible()
  await projectCard.hover()
  await clickOrFail(projectCard.getByRole('button', { name: say(LOCALE, 'library.continueCreating') }).first(), '冷启动重开这个项目')
  await win.waitForFunction((id) => location.href.includes(`projectId=${encodeURIComponent(id)}`), projectId)
  await openCanvas(win)
  const cardAfterRestart = win.locator(SPEND_CARD)
  await expectAbsent(cardAfterRestart, { provenBy: xProof, message: '冷启动不复活已收回的卡' })
  expect((await readProject(win, projectId)).payload.generationCanvas.nodes.map((node) => node.id).sort(), '冷启动后节点一个不少').toEqual(nodesBeforeRestart)
  // 同一个 operationId 再 generate：卡回来（不用重新起草），读的是节点此刻的样子（改过的提示词还在节点上）。
  const REOPEN = 'spend-reopen'
  const reopen = walk.fixture.expectText({ label: 'the model re-quotes the same withdrawn draft', match: (body) => flattenRequestText(body).includes('S_SPEND_REOPEN'),
    reply: { type: 'tool', id: REOPEN, name: 'generate', args: { operationId: taskX.operationId } } })
  const reopenDone = walk.fixture.expectText({ label: 'the re-quoted request reaches its card', match: (body) => (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === REOPEN),
    reply: { type: 'text', text: 'S_SPEND_REOPEN_DONE' } })
  await sendCanvas(win, 'S_SPEND_REOPEN：还是生成吧。')
  await recorded(reopen.received, 'generate on the same operation')
  const cardReopened = win.locator(SPEND_CARD)
  await expect(cardReopened.locator(CARD_TITLE), '同一份草稿再 generate，卡就回来了').toContainText(cardTitle(LOCALE, 1, 'image'), { timeout: stationTimeout({ operations: 4 }) })
  await expect(cardReopened.locator(`${CARD_BODY} ${POINTER}`), '回来的卡指着同一个节点').toHaveAttribute('data-node-pointer-id', shotX.nodeId)
  expect(await win.evaluate((nodeId) => window.__nomiCanvasStore?.getState().nodes.find((node) => node.id === nodeId)?.prompt ?? null, shotX.nodeId),
    '节点上改过的提示词还在（节点就是草稿）').toContain(PROMPT_TAIL)
  expect(await cardReopened.locator(CARD_EDITORS).count(), '回来的卡上同样没有编辑器').toBe(0)
  await walk.snap('requoted-card-points-at-the-edited-node')
  // 卡摆着的时候切到「直接生成」：已经摆着的这张照样等人答，一笔都不发（钱不因档位放行；档位只管之后的 generate）。
  const reopenProof = await proveProbe(cardReopened, '重新出的这张卡摆着')
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_PERMISSION}`), '权限档选择器')
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${permissionTier('direct')}`), '切到「直接生成」')
  const switchCard = win.locator(`${CANVAS_PANEL} ${APPROVAL_CARD}[data-kind="approval-reversible"]`)
  await expect(switchCard, '切档要先确认').toBeVisible()
  await clickOrFail(switchCard.locator(INTERVENTION_CONFIRM), '确认切到直接生成')
  await expect(win.locator(`${CANVAS_PANEL} [data-v4-block="auto-mode"]`), '直接生成档有常驻提醒').toBeVisible()
  await expect(cardReopened, '付费卡在切档之后仍然等着人答').toBeVisible()
  expect(walk.fixture.images.length - imagesBeforeX, '切档不提交已经摆着的卡').toBe(0)
  expect((await offerFacts(win, projectId, taskX.operationId)).handOvers, '切档不替他交出去').toEqual([])
  await walk.snap('requoted-card-still-waits-under-direct-tier')
  await clickOrFail(cardReopened.locator(CARD_CANCEL), '把重新出的这张卡也取消')
  await expectAbsent(cardReopened, { provenBy: reopenProof, message: '取消之后卡退出介入槽' })
  await recorded(reopenDone.received, '第二次 generate 在卡取消之后返回')
  expect(walk.fixture.images.length - imagesBeforeX, '取消、冷启动、重新出价、切档，一笔图片都没提交').toBe(0)

  walk.report.verified = [
    'task-a-three-pointers-default-params-generate-all', 'task-b-node-duration-edit-follows-and-is-sent',
    'card-summary-equals-node-equals-wire', 'hover-pointer-lights-the-canvas-node', 'click-pointer-flashes-and-opens-the-node',
    'collapsed-ball-counts-the-card', 'one-engine-canvas-single-node-runs', 'offer-closes-handed-to-canvas',
    'receipt-sent-then-generated-and-nodes-flash', 'cancel-withdraws-only-the-offer', 'cold-restart-no-old-card',
    'requote-reads-the-node-as-edited', 'pending-card-still-waits-under-direct-tier',
  ]
  await checkSpendScopeJourney(walk, win)
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
