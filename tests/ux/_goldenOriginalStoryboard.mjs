// Original-editor branch of the golden journey. The separate production-table
// mode remains in golden-path.e2e.mjs with its table-specific assertions intact.
import fs from 'node:fs'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'
import { clickOrFail, expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { waitForCanvasViewportSettled, findCanvasBlankPoint, findNodeHitPoint } from './_canvasHit.mjs'
import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { FIXTURE_IMAGE_MODEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { CANVAS_PANEL, COMPOSER_INPUT, COMPOSER_SEND, DOCUMENT, hasToolResult, openCanvas, readProject, recorded } from './agent-runtime-walk-support.mjs'
const { createProductionRunRepository } = tsxRequire('../../electron/productionRun/productionRunRepository.ts', import.meta.url)

export async function runOriginalStoryboardGolden({ walk, win, projectId, projectRoot, shot, setCurrentWin,
  prompts, titles, newPrompt, instruction, planCall, patchCall, shotId, targetAssertion, positiveControl }) {
  const plan = walk.fixture.expectText({ label: 'Original document selection creates a saved storyboard',
    match: body => flattenRequestText(body).includes('GOLDEN_SCRIPT') && !hasToolResult(body, planCall),
    reply: { type: 'tool', id: planCall, name: 'draft_shots', args: {
      shots: prompts.map((prompt, index) => ({ title: titles[index], taskKind: 'text_to_image', modelId: FIXTURE_IMAGE_MODEL,
        modeId: 't2i', parameters: { size: '1024x1024' }, prompt })),
    } } })
  const done = walk.fixture.expectText({ label: 'Original storyboard save returns through the same Agent turn',
    match: body => hasToolResult(body, planCall), reply: { type: 'text', text: 'GOLDEN_PLAN_DONE：三镜方案已保存。' } })
  // 方案正本 = 项目记录里的 storyboardDesign，和用户手建的那种同一处。
  const allDesigns = async () => Object.values((await readProject(win, projectId)).payload.storyboardDesignsByDocumentId ?? {}).flat()
  const beforeDesignIds = (await allDesigns()).map(design => design.id)
  const document = win.locator(DOCUMENT)
  await document.click()
  await document.selectText()
  await clickOrFail(win.locator('.workbench-selection-popover').getByRole('button', { name: '拆成镜头', exact: true }), '原划词拆成三镜')
  await recorded(plan.received, 'original document storyboard request')
  await recorded(done.received, 'original storyboard saved')
  await expect.poll(async () => (await allDesigns()).filter(design => !beforeDesignIds.includes(design.id)),
    { timeout: stationTimeout({ operations: 2 }) }).toHaveLength(1)
  const designId = (await allDesigns()).find(design => !beforeDesignIds.includes(design.id)).id
  const readPlan = async () => (await allDesigns()).find(design => design.id === designId).plan
  const originalPlan = structuredClone(await readPlan())
  expect(originalPlan.shots.map(row => row.prompt)).toEqual(prompts)
  expect(originalPlan.shots.map(row => row.shotId)).toEqual(['shot-1', shotId, 'shot-3'])
  // 2026-09-21 合并 ①：这条原先是 `shots.map(row => row.title)).toEqual(titles)`，钉的是一个
  // **不存在的契约**——`planShotSchema` 没有逐镜 `title` 这一格（zod 当场剥掉），分镜行的 UI 也不显示
  // 逐镜标题（`StoryboardShotRow.tsx` 全文零处读它）。实测 plan 行的键恰好就是 schema 那几个。
  // 模型拟的标题**没有丢**：`storyboardPlanFromDraftSubjects` 取第一条有名字的当方案名，
  // 也就是左栏方案行上那个名字。所以改成钉住真实契约的两条（判据：产品没回归，是断言写错了）：
  //   ① 逐镜不带 title —— 冒出来 = 有人又给「这一镜叫什么」加了第二个语义 owner；
  //   ② 模型写的标题成了方案的名字 —— 丢了就是真的丢了。
  expect(originalPlan.shots.filter(row => 'title' in row), 'plan 行不带逐镜标题（planShotSchema 没有这一格）').toHaveLength(0)
  expect(originalPlan.title, '模型拟的标题成为方案名，不是被静默丢掉').toBe(titles[0])
  expect(originalPlan.shots.map(row => row.modelKey)).toEqual(prompts.map(() => FIXTURE_IMAGE_MODEL))
  // 2026-09-21 合并 ①：这条原先断言「拆完镜头画布上一个节点都没有」。实测有一个，`kind=shot_table`
  // ——那是**这份方案的表格视图**，由 `ensureStoryboardShotTable` 在「显式写入一份方案」时建一张；
  // 那个文件在 origin/main 上逐字节同一份，手建分镜走的也是它，不是 Pass 2 长出来的副作用。
  // 用户拍的「Agent 产出先成方案、显式『放入画布』才落节点」说的是**生成节点**（会花钱、占画布的镜头卡），
  // 不是方案自己的表。所以断言收窄到它真正要守的那条，并把表视图**正着**钉下来——
  // 它没了或变成两张，同样是回归（判据：产品没回归，是断言写得太宽）。
  await expect.poll(async () => {
    const nodes = (await readProject(win, projectId)).payload.generationCanvas.nodes ?? []
    return { generation: nodes.filter(node => node.kind !== 'shot_table').length, tables: nodes.filter(node => node.kind === 'shot_table').length }
  }, { timeout: stationTimeout({ operations: 1 }) }).toEqual({ generation: 0, tables: 1 })
  expect(walk.fixture.images, 'Saving a storyboard submits no media').toHaveLength(0)
  const openEditor = async () => {
    await win.getByRole('button', { name: '创作', exact: true }).click()
    const expand = win.locator('[data-creation-resource-tree-toggle="expand"]:visible')
    if (await expand.isVisible()) await expand.click()
    await win.locator(`[data-storyboard-id="${designId}"]`).click()
    const editor = win.locator('[data-storyboard-editor="true"]')
    await expect(editor.locator('[data-storyboard-row]')).toHaveCount(3)
    return editor
  }
  let editor = await openEditor()
  for (let index = 0; index < 3; index++) {
    await expect(editor.locator(`[data-storyboard-row="${index + 1}"] [data-storyboard-prompt-block] [contenteditable="true"]`)).toHaveText(prompts[index])
  }
  await shot('original-three-shot-editor-before-placement')
  await editor.locator(`[data-place-storyboard="${designId}"]`).click()
  await expect(editor.locator(`[data-place-storyboard="${designId}"]`)).toHaveText('查看画布')
  const nodesOf = payload => (payload.generationCanvas?.nodes ?? []).filter(node => node.meta?.storyboardDesignId === designId
    && node.meta?.shotId && node.meta?.storyboardKeyframe !== true && !node.derivedFrom && !node.regeneratedFrom)
  const readNodes = async () => nodesOf((await readProject(win, projectId)).payload)
  await expect.poll(async () => (await readNodes()).length).toBe(3)
  const originalNodes = await readNodes()
  const nodeIds = originalNodes.map(node => node.id)
  expect(originalNodes.map(node => node.meta.shotId)).toEqual(['shot-1', shotId, 'shot-3'])
  expect(originalNodes.map(node => node.prompt)).toEqual(prompts)
  expect(originalNodes.map(node => node.title), 'Original materializer keeps its established localized shot labels').toEqual(['镜头 1', '镜头 2', '镜头 3'])
  expect(originalNodes.map(node => node.meta.modelKey)).toEqual(prompts.map(() => FIXTURE_IMAGE_MODEL))
  const originalGroup = (await readProject(win, projectId)).payload.generationCanvas.groups.find(group => originalNodes.every(node => group.nodeIds?.includes(node.id)))
  expect(originalGroup, 'Original placement must group the three shot nodes').toBeTruthy()
  await editor.locator(`[data-place-storyboard="${designId}"]`).click()
  await openCanvas(win)
  // 放入画布不再让画布自己适应到新镜头上（2026-09-25 拍板「程序不再主动平移 / 缩放画布」）：镜头落在屏外时
  // 舞台边只出一颗边缘提示。用户要看全三镜，自己点「适应视图」——它和点提示一样是用户发起的移动，且框住全部。
  // 先等视口停稳：进画布那一刻若要一次性摆全貌（useAutoFitOnLoad，画布量完节点后判一次），别让它落在我们这一下之后。
  await waitForCanvasViewportSettled(win)
  await clickOrFail(win.getByRole('button', { name: '适应视图', exact: true }), '适应视图：看全放入画布的三镜')
  await waitForCanvasViewportSettled(win)
  const second = originalNodes.find(node => node.meta.shotId === shotId)
  // Materialization selects the last newly created node so its composer is ready. Close that
  // anchored composer before selecting another shot; its overlay intentionally owns pointer input.
  const blank = await findCanvasBlankPoint(win, { preference: 'top-left', inset: 48 })
  expect(blank, 'Canvas exposes a blank point to dismiss the selected composer').toBeTruthy()
  await win.mouse.click(blank.x, blank.y)
  await waitForCanvasViewportSettled(win)
  const point = await findNodeHitPoint(win, { nodeSelector: `.generation-canvas-v2-node[data-node-id="${second.id}"]` })
  expect(point, 'Second original shot has a real hit target').toBeTruthy()
  await win.mouse.click(point.x, point.y)
  await expect(win.locator(`.generation-canvas-v2-node[data-node-id="${second.id}"][data-selected="true"]`)).toHaveCount(1)
  const viewport = win.locator('.react-flow__viewport')
  await waitForCanvasViewportSettled(win)
  const beforeViewport = await viewport.evaluate(element => getComputedStyle(element).transform)
  const patch = walk.fixture.expectText({ label: 'Agent patches the same saved Run and exact second shot',
    match: body => flattenRequestText(body).includes(instruction) && !hasToolResult(body, patchCall),
    reply: { type: 'tool', id: patchCall, name: 'draft_shots', args: { operationId: designId, shots: [{ shotId, prompt: newPrompt }] } } })
  const patched = walk.fixture.expectText({ label: 'Exact storyboard patch returns through original SDK',
    match: body => hasToolResult(body, patchCall), reply: { type: 'text', text: 'GOLDEN_PATCH_DONE：第二镜已更新。' } })
  await win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`).fill(instruction)
  await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_SEND}`), 'Agent定点改第二镜')
  const patchWire = await recorded(patch.received, 'exact second shot patch')
  expect(flattenRequestText(patchWire.body)).toContain(instruction)
  await recorded(patched.received, 'original author save after Agent patch')
  await expect.poll(async () => (await readPlan()).shots[1].prompt, { timeout: stationTimeout({ operations: 2 }) }).toBe(newPrompt)
  const expectedPlan = structuredClone(originalPlan)
  expectedPlan.shots[1].prompt = newPrompt
  delete expectedPlan.shots[1].promptSegments
  expect(await readPlan(), 'Agent prompt change must preserve every other authored field').toEqual(expectedPlan)
  await expect.poll(async () => (await readNodes()).map(node => node.prompt)).toEqual([prompts[0], newPrompt, prompts[2]])
  expect((await readNodes()).map(node => node.id)).toEqual(nodeIds)
  await waitForCanvasViewportSettled(win)
  await expect(viewport, 'Editing an existing shot must not pan or zoom the original canvas').toHaveCSS('transform', beforeViewport)
  expect((await readNodes())[0]).toEqual(originalNodes[0])
  expect((await readNodes())[2]).toEqual(originalNodes[2])
  await shot('original-shot2-agent-patch-keeps-viewport')
  editor = await openEditor()
  const secondRow = editor.locator('[data-storyboard-row="2"]')
  await expect(secondRow.locator('[data-storyboard-prompt-block] [contenteditable="true"]')).toHaveText(newPrompt)
  const collapse = win.locator('[data-creation-resource-tree-toggle="collapse"]:visible')
  if (await collapse.isVisible()) await collapse.click()
  expect(walk.fixture.images).toHaveLength(0)
  await secondRow.locator('[data-storyboard-frame]').getByRole('button', { name: '生成镜 2', exact: true }).click()
  // 用户自己点「生成镜 2」= 他本人要这一张：不弹付费确认，直接开始（2026-09-25 拍板；09-26 起不看金额）。
  // 证据是供应商真收到了这一张的请求、镜头走到 done——若中间弹了卡，走查不去点，请求永远发不出去。
  await expect.poll(() => walk.fixture.images.length, { timeout: stationTimeout({ operations: 2 }),
    message: 'A single shot the user starts goes straight to the provider without a confirmation card' }).toBe(1)
  await expect(secondRow.locator('[data-storyboard-frame]')).toHaveAttribute('data-storyboard-frame', 'done', { timeout: stationTimeout({ operations: 4 }) })
  await expect.poll(async () => (await readNodes()).find(node => node.meta.shotId === shotId)?.result?.url).toMatch(/^nomi-local:\/\//)
  expect(walk.fixture.images).toHaveLength(1)
  expect(walk.fixture.images[0].body.prompt).toContain(newPrompt)
  const completedNodes = await readNodes()
  expect(completedNodes.map(node => node.id)).toEqual(nodeIds)
  expect(completedNodes.map(node => node.prompt)).toEqual([prompts[0], newPrompt, prompts[2]])
  expect(await readPlan()).toEqual(expectedPlan)
  const resultUrl = completedNodes.find(node => node.meta.shotId === shotId).result.url
  await expect.poll(() => secondRow.locator('[data-storyboard-frame] img').first().evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  await shot('original-shot2-generated-real-jpg')
  const sessions = readLaneTranscripts(projectRoot)
  expect(sessions).toHaveLength(1)
  const originalMessages = laneMessages(sessions[0])
  expect(originalMessages.filter(message => message.role === 'toolResult' && [planCall, patchCall].includes(message.toolCallId))
    .map(message => [message.toolCallId, message.toolName, message.isError])).toEqual([[planCall, 'draft_shots', false], [patchCall, 'draft_shots', false]])
  const requestsBefore = walk.fixture.requests.length
  await walk.stopApp()
  const projectFile = path.join(projectRoot, '.nomi/project.json')
  if (positiveControl) {
    const record = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
    const node = nodesOf(record.payload).find(node => node.meta.shotId === shotId)
    if (!node) throw new Error('Positive control cannot find the original bound second node')
    node.prompt = prompts[1]
    fs.writeFileSync(projectFile, JSON.stringify(record, null, 2))
  }
  ;({ win } = await walk.start())
  setCurrentWin(win)
  const persisted = JSON.parse(fs.readFileSync(projectFile, 'utf8')).payload
  expect(nodesOf(persisted).find(node => node.meta.shotId === shotId)?.prompt, targetAssertion).toBe(newPrompt)
  expect(nodesOf(persisted).find(node => node.meta.shotId === shotId)?.result?.url).toBe(resultUrl)
  expect(nodesOf(persisted).map(node => node.id)).toEqual(nodeIds)
  expect(Object.values(persisted.storyboardDesignsByDocumentId ?? {}).flat().find(design => design.id === designId).plan).toEqual(expectedPlan)
  const projectCard = win.locator('[data-project-card]').first()
  await projectCard.hover()
  await clickOrFail(projectCard.getByText('继续创作', { exact: false }).first(), '冷启动重开原项目')
  await expect.poll(() => win.url().includes(`projectId=${projectId}`)).toBe(true)
  editor = await openEditor()
  const restoredRow = editor.locator('[data-storyboard-row="2"]')
  await expect(restoredRow.locator('[data-storyboard-prompt-block] [contenteditable="true"]')).toHaveText(newPrompt)
  await expect(restoredRow.locator('[data-storyboard-frame]')).toHaveAttribute('data-storyboard-frame', 'done')
  await expect.poll(() => restoredRow.locator('[data-storyboard-frame] img').first().evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true)
  expect(laneMessages(readLaneTranscripts(projectRoot).find(session => session.sessionId === sessions[0].sessionId))).toEqual(originalMessages)
  expect(walk.fixture.requests).toHaveLength(requestsBefore)
  expect(walk.fixture.images).toHaveLength(1)
  await shot('original-editor-cold-restored-fields-and-result')
  walk.report.verified = ['document-draft-saves-with-zero-nodes', 'original-editor-complete-author-fields', 'explicit-original-placement-stable-binding',
    'agent-patches-only-shot2-with-stable-canvas-viewport', 'original-single-shot-approval-exactly-one-image', 'original-editor-cold-restore', 'zero-restart-model-requests']
}
