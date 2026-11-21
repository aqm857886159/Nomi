// 付费卡「范围」那一段（接在 agent-spend-card 后面，另开一个项目）：33 镜的计划只摆 3 镜上卡（generate 带 shotIds）。
//
//   · 卡只问这 3 镜、按顺序指着这 3 个节点；33 镜的计划原样留着（点名摆上卡只开一次出价，不缩这一批）；
//   · 在节点里改第 2 镜（提示词 + 比例），卡上只有那一镜的摘要变——卡读节点，不存副本；宿主那份计划不被节点上的改动偷偷改写；
//   · 「取消」收回的是这一次出价：计划仍是 draft、33 镜一个不少、画布节点一个不动；
//   · 第二笔（另一份草稿）有它自己的节点，不串第一笔的改动；
//   · 对第一份草稿再 generate 同样 3 镜：卡回来，指着同样 3 个节点，第 2 镜在节点上的改动还在。
// 全程一笔媒体都不提交。Agent 出的付费卡天然串行（等这张卡的回合挂在它上面），所以先答第一笔、再出第二笔。
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { readLaneSpend } from './_laneSpendProbe.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CARD_CANCEL, CARD_EDITORS, NODE_COMPOSER, SPEND_CARD,
  cardFacts, cardTitle, editNodeParameter, hoverSummaryOf, nodeParams, pointerAway, pointerFace,
} from './_spendCardWalk.mjs'
import {
  CANVAS_PANEL, COMPOSER, COMPOSER_PERMISSION,
  createRuntimeWalk, hasToolResult, openCanvas, permissionTier, readProject, recorded, sendCanvas, waitForV4TurnIdle,
} from './agent-runtime-walk-support.mjs'
import { backToLibrary } from './_shell.mjs'

const IMAGE = 'gpt-image-2@apimart'

/** @param {Awaited<ReturnType<typeof createRuntimeWalk>>} walk */
export async function checkSpendScopeJourney(walk, win) {
  await backToLibrary(win, { label: '回项目库，另开一个项目跑范围那一段' })
  const { projectId, projectRoot } = await walk.newProject()
  await openCanvas(win)
  const panel = win.locator(CANVAS_PANEL)
  await clickOrFail(panel.locator(COMPOSER_PERMISSION), '权限档选择器')
  await clickOrFail(panel.locator(permissionTier('request')), '权限档选回「请求批准」')
  await expect(panel.locator(COMPOSER)).toHaveAttribute('data-approval-mode', 'request')
  const card = win.locator(SPEND_CARD)
  const graph = async () => {
    const canvas = (await readProject(win, projectId)).payload.generationCanvas
    return { nodes: canvas.nodes, edges: canvas.edges, groups: canvas.groups ?? [] }
  }
  const runs = () => win.evaluate((id) => window.nomiDesktop.productionRuns.list(id), projectId)
  const readRun = (operationId) => win.evaluate(({ pid, rid }) => window.nomiDesktop.productionRuns.read(pid, rid), { pid: projectId, rid: operationId })
  const liveNode = (nodeId) => win.evaluate((id) => {
    const node = window.__nomiCanvasStore?.getState().nodes.find((candidate) => candidate.id === id)
    return node ? { prompt: node.prompt ?? '', meta: node.meta ?? {} } : null
  }, nodeId)
  const pending = async () => {
    // 宿主那一份待决出价，读的是推给面板的对话投影（唯一来路）。
    const read = await readLaneSpend(win)
    expect(read?.surface).toBe('ready')
    return read.rows
  }
  let turn = 0
  // 一步的工作量随镜头数涨（33 镜草稿要落 33 个节点），安全上限按镜头数给，不用固定 60 秒。
  const toolTurn = async (name, args, bound = stationTimeout({ turns: 1, operations: 1 })) => {
    const id = `CJ1_TOOL_${++turn}`, done = `${id}_DONE`
    const request = walk.fixture.expectText({ label: id, match: (body) => flattenRequestText(body).includes(id), reply: { type: 'tool', id, name, args } })
    const result = walk.fixture.expectText({ label: done, match: (body) => hasToolResult(body, id), reply: { type: 'text', text: done } })
    await sendCanvas(win, `${id}：执行这一条分镜操作，保留其他草稿。`)
    await recorded(request.received, id, bound)
    await recorded(result.received, done, bound)
    await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: panel.getByText(done, { exact: true }), doneTimeout: bound })
  }
  const draft = async (shots) => {
    const before = new Set((await runs()).map((run) => run.runId))
    await toolTurn('draft_shots', { shots }, stationTimeout({ turns: 1, operations: shots.length }))
    await expect.poll(async () => (await runs()).filter((run) => !before.has(run.runId)).length).toBe(1)
    // shotId 由宿主发（create 的 schema 故意不收调用方给的 shotId）。
    return (await runs()).find((run) => !before.has(run.runId)).runId
  }
  // `generate` 等用户答完那张卡才返回：出卡这一步只等到「请求发出去、卡出现」；那一轮的结果要到卡被答掉之后才有。
  const present = async (operationId, shotIds) => {
    const id = `CJ1_TOOL_${++turn}`, done = `${id}_DONE`
    const request = walk.fixture.expectText({ label: id, match: (body) => flattenRequestText(body).includes(id),
      reply: { type: 'tool', id, name: 'generate', args: { operationId, shotIds } } })
    const result = walk.fixture.expectText({ label: done, match: (body) => hasToolResult(body, id), reply: { type: 'text', text: done } })
    await sendCanvas(win, `${id}：执行这一条分镜操作，保留其他草稿。`)
    await recorded(request.received, id)
    await expect.poll(async () => (await pending()).find((row) => row.operationId === operationId)?.shots.map((shot) => shot.shotId)).toEqual(shotIds)
    await expect(card, '卡摆出来了').toBeVisible({ timeout: stationTimeout() })
    return { settled: async () => flattenRequestText((await recorded(result.received, done)).body) }
  }
  const cancel = async (label) => {
    const proof = await proveProbe(card, `${label}：卡真的在屏上`)
    await clickOrFail(card.locator(CARD_CANCEL), label)
    await expectAbsent(card, { provenBy: proof, message: `${label}：卡退出介入槽` })
  }
  const makeShot = (index, role = 'shot') => ({ role, title: `CJ1 ${role} ${index}`, prompt: `CJ1_${role}_${index} 原始画面`,
    ...(role === 'anchor' ? { storyboard: { kind: 'character', carrier: 'visual' } } : {}),
    taskKind: 'text_to_image', model: IMAGE })
  const nodeOf = (graphNodes, operationId, shotId) => graphNodes.find((node) => node.meta?.productionRunId === operationId && node.meta?.productionShotId === shotId)

  const baselineGraph = await graph()
  const operationId = await draft(Array.from({ length: 33 }, (_, index) => makeShot(index + 1, index < 3 ? 'anchor' : 'shot')))
  const originalShots = (await readRun(operationId)).generationPlan.shots
  expect(originalShots).toHaveLength(33)
  expect(originalShots.filter((shot) => shot.role === 'anchor')).toHaveLength(3)
  const requestedIds = originalShots.slice(0, 3).map((shot) => shot.shotId)
  await expect.poll(async () => (await graph()).nodes.length, { timeout: stationTimeout({ operations: 33 }) }).toBe(baselineGraph.nodes.length + 33)
  const draftedGraph = await graph()
  const requestedNodeIds = requestedIds.map((shotId) => nodeOf(draftedGraph.nodes, operationId, shotId)?.id)
  expect(requestedNodeIds.every(Boolean), '卡上那三镜各有一个节点').toBe(true)

  const firstTurn = await present(operationId, requestedIds)
  expect(await graph(), '摆上卡不动画布').toEqual(draftedGraph)
  await pointerAway(win)
  let facts = await cardFacts(win)
  expect(facts.title, '卡只问点名的这 3 镜，不是整份 33 镜的计划').toBe(cardTitle('zh-CN', 3, 'image'))
  expect(facts.pointers.map((pointer) => pointer.id), '三个指向元素按顺序指着那三个节点').toEqual(requestedNodeIds)
  expect(facts.editors, '卡上没有编辑器').toBe(0)
  // 点名摆上卡只开一次出价，不改这一批：被点名的几镜写 included 与 updatedAt，没点名的一字不动、整批没缩。
  const expectPlanKept = async (label) => {
    const plan = (await readRun(operationId)).generationPlan.shots
    expect(plan.map((shot) => shot.shotId), `${label}：整批没缩`).toEqual(originalShots.map((shot) => shot.shotId))
    const untouched = (shot) => !requestedIds.includes(shot.shotId)
    expect(plan.filter(untouched), `${label}：没被点名的镜一字不动`).toEqual(originalShots.filter(untouched))
    const withoutPresentation = ({ included, updatedAt, ...rest }) => rest
    expect(plan.map(withoutPresentation), `${label}：计划只动 included 与 updatedAt（节点上的改动不写回计划）`).toEqual(originalShots.map(withoutPresentation))
  }
  await expectPlanKept('摆上卡之后')
  await walk.snap('cj1-three-of-33-pointers')

  // 在节点里改第 2 镜：点它的指向元素 → 生成框打开 → 改提示词、改比例。卡上只有那一镜的摘要变。
  const third = requestedNodeIds[2]
  const second = requestedNodeIds[1]
  const thirdHoverBefore = await hoverSummaryOf(win, third)
  await clickOrFail(pointerFace(card, second), '点第 2 个指向元素的缩略图（去节点里改）')
  const promptBox = win.locator(`${NODE_COMPOSER} [contenteditable="true"]`).first()
  await expect(promptBox, '第 2 镜的生成框打开了').toBeVisible({ timeout: stationTimeout() })
  await promptBox.click()
  await win.keyboard.press('ControlOrMeta+A')
  const editedPrompt = 'CJ1 第二镜在节点上改的提示词，不串其他镜头'
  await win.keyboard.insertText(editedPrompt)
  await expect.poll(async () => (await liveNode(second))?.prompt, { message: '第 2 镜节点上的提示词改了', timeout: stationTimeout() }).toBe(editedPrompt)
  const aspect = await editNodeParameter(win, second, 'aspect_ratio', { pick: '16:9' })
  expect(nodeParams((await liveNode(second)).meta).aspect, '第 2 镜节点上的比例改成了 16:9').toBe('16:9')
  const secondHover = await hoverSummaryOf(win, second)
  expect(secondHover, '卡上第 2 镜的摘要读的是节点上改过的比例').toContain('16:9')
  expect(await hoverSummaryOf(win, third), '第 3 镜的摘要没被第 2 镜带走').toBe(thirdHoverBefore)
  expect((await liveNode(third)).prompt, '第 3 镜节点上的提示词没变').toBe('CJ1_anchor_3 原始画面')
  await expectPlanKept('在节点里改了第 2 镜之后')
  expect(walk.fixture.images, '改节点不提交').toHaveLength(0)
  await walk.snap('cj1-second-node-edited-card-reads-it')

  // 「取消」= 收回这一次出价：计划仍是 draft、33 镜一个不少、画布节点一个不动。
  const beforeCancel = (await graph()).nodes.map((node) => node.id).sort()
  await cancel('取消第一笔')
  expect(await firstTurn.settled(), '第一笔的回合读到的是「他关了这张卡」').toContain('the user cancelled the card before deciding them')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: panel.getByText(/CJ1_TOOL_\d+_DONE/).last() })
  expect(await pending(), '第一笔取消之后没有任何待决').toEqual([])
  expect((await readRun(operationId)).generationPlan, '收回的是出价，不是计划').toMatchObject({ state: 'draft' })
  expect((await readRun(operationId)).generationPlan.presentations.at(-1)?.closed?.by, '这一次出价记的是「用户关了卡」').toBe('user_closed')
  expect((await readRun(operationId)).generationPlan.shots, '33 镜一个不少').toHaveLength(33)
  expect((await graph()).nodes.map((node) => node.id).sort(), '取消之后画布一个节点都没动').toEqual(beforeCancel)

  // 第二笔：另一份草稿，有它自己的节点——第一笔第 2 镜上的改动一个都不串过来。
  const otherOperationId = await draft([makeShot(99)])
  const otherShots = (await readRun(otherOperationId)).generationPlan.shots
  const secondTurn = await present(otherOperationId, otherShots.map((shot) => shot.shotId))
  await expect.poll(async () => (await pending()).map((row) => row.operationId)).toEqual([otherOperationId])
  const otherNodeId = nodeOf((await graph()).nodes, otherOperationId, otherShots[0].shotId)?.id
  facts = await cardFacts(win)
  expect(facts.pointers.map((pointer) => pointer.id), '第二笔的卡指着它自己的那个节点').toEqual([otherNodeId])
  expect((await liveNode(otherNodeId)).prompt, '第二笔的节点是它自己的提示词').toBe('CJ1_shot_99 原始画面')
  await walk.snap('cj1-second-operation-has-own-node')
  await cancel('取消第二笔')
  expect(await secondTurn.settled(), '第二笔的回合同样读到「他关了这张卡」').toContain('the user cancelled the card before deciding them')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: panel.getByText(/CJ1_TOOL_\d+_DONE/).last() })
  for (const id of [operationId, otherOperationId]) {
    const plan = (await readRun(id)).generationPlan
    expect(plan.state).toBe('draft')
    expect(plan.presentations.at(-1)?.closed?.by).toBe('user_closed')
  }

  // 两笔都取消之后：对第一份草稿再 generate 同样 3 镜 = 重新出价，卡回来（不用重新起草），读的是节点此刻的样子。
  const afterBoth = (await graph()).nodes.map((node) => node.id).sort()
  const requotedTurn = await present(operationId, requestedIds)
  expect((await pending()).map((row) => row.operationId), '同一份草稿重新出价').toEqual([operationId])
  expect((await pending())[0].shots.map((shot) => shot.shotId), '还是原来那三镜').toEqual(requestedIds)
  await pointerAway(win)
  facts = await cardFacts(win)
  expect(facts.pointers.map((pointer) => pointer.id), '回来的卡指着同样那三个节点').toEqual(requestedNodeIds)
  expect(await card.locator(CARD_EDITORS).count(), '回来的卡上同样没有编辑器').toBe(0)
  expect(await hoverSummaryOf(win, second), '第 2 镜在节点上的改动还在，卡上读得到').toBe(secondHover)
  expect((await liveNode(second)).prompt, '第 2 镜节点上改的提示词还在').toBe(editedPrompt)
  await expectPlanKept('重新出价之后（镜头、参数、锚点一个字不丢）')
  expect((await graph()).nodes.map((node) => node.id).sort(), '经过一整个回合，画布节点一个不多也一个不少').toEqual(afterBoth)
  expect((await readRun(operationId)).jobs).toHaveLength(0)
  expect((await readRun(otherOperationId)).jobs).toHaveLength(0)
  expect(walk.fixture.images).toHaveLength(0)
  await walk.snap('cj1-withdrawn-offer-requotes-reading-the-nodes')
  await cancel('取消重新出的那张卡')
  expect(await requotedTurn.settled(), '重新出价的那一轮同样以成功形状收尾').toContain('the user cancelled the card before deciding them')
  await waitForV4TurnIdle(win, { panel: CANVAS_PANEL, settledBy: panel.getByText(/CJ1_TOOL_\d+_DONE/).last() })
  expect(await pending(), '收尾之后介入槽是空的').toEqual([])
  walk.report.spendScopeJourney = { projectId, projectRoot, operationId, otherOperationId, requestedIds, requestedNodeIds, planItems: 33,
    edited: { prompt: editedPrompt, aspect }, pendingOrder: 'serial — one lane-issued card at a time',
    verified: ['three-of-33', 'pointers-in-plan-order', 'node-edit-shows-on-that-pointer-only', 'plan-untouched-by-node-edits',
      'cancel-withdraws-only-the-offer', 'serial-cards-second-has-own-node', 'requote-reads-the-edited-nodes'],
    mediaSubmissions: 0 }
}
