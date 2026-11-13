import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
export async function createReleaseCoreSteps(load) {
const { expect } = await load('tests/ux/_assert.mjs')
const { CREATION_PANEL, COMPOSER, APPROVAL_CARD, chooseAssistantModel, expandResidentPanel, sendCreation, readProject } = await load('tests/ux/agent-runtime-walk-support.mjs')
const { readLaneTranscripts, laneMessages } = await load('tests/ux/agent-lane-observer.mjs')
const { openStoryboardEditor } = await load('tests/ux/_creationResourceTree.mjs')
const { collapseAgentPanel, newProjectEntry } = await load('tests/ux/_shell.mjs')
const { uiText } = await load('tests/ux/full-walk/invariants.mjs')
const { confirmLockExitSpend } = await load('tests/ux/.releaseCoreHosting.mjs')
const { stationTimeout } = await load('tests/ux/_station-budget.mjs')

function trajectory(projectRoot) {
  const calls = [], failures = [], manual = [], retryCalls = []
  const failedTools = new Set()
  for (const session of readLaneTranscripts(projectRoot)) for (const message of laneMessages(session)) {
    if (message.role === 'assistant' && Array.isArray(message.content)) for (const part of message.content) {
      if (part.type !== 'toolCall') continue
      calls.push({ id: part.id, name: part.name, arguments: part.arguments })
      if (failedTools.has(part.name)) { retryCalls.push(part.id); failedTools.delete(part.name) }
      if (/ask_user|request_user/.test(part.name)) manual.push(part)
    }
    if (message.role === 'toolResult' && message.isError === true) {
      const name = message.toolName ?? calls.find(call => call.id === message.toolCallId)?.name
      const text = (message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n')
      failures.push({ id: message.toolCallId, name, text })
      failedTools.add(name)
    }
  }
  return { calls, failures, retryCalls, manual }
}

async function draftTask({ walk, win, input, brainLabel, rehearsal, locale }) {
  await newProjectEntry(win).click()
  await expect(win.locator(`[aria-label="${uiText(locale, 'creationAi.editor.documentAria')}"] .tiptap[contenteditable="true"]`)).toBeVisible()
  const projectId = await win.evaluate(() => new URL(location.href).searchParams.get('projectId') ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get('projectId'))
  const summary = (await win.evaluate(() => window.nomiDesktop.projects.listAsync())).find(row => row.id === projectId)
  assert.ok(summary?.rootPath)
  assert.ok(!path.relative(path.join(walk.report.tempRoot, 'projects'), summary.rootPath).startsWith('..'))
  const project = { projectId, projectRoot: summary.rootPath, name: summary.name }
  Object.assign(walk.report, { projectId, projectRoot: summary.rootPath })
  await expandResidentPanel(win)
  await chooseAssistantModel(win, brainLabel, CREATION_PANEL)
  await win.keyboard.press('Escape')
  const noShare = win.getByRole('button', { name: uiText(locale, 'agentPanelV4.consent.decline'), exact: true }).first()
  if (await noShare.isVisible()) await noShare.click()
  const ask = `${input.story} 请起草恰好${input.draftShots}镜的图片分镜方案，使用 ${input.image.vendorKey}/${input.image.modelKey}，text_to_image，参数 ${JSON.stringify(input.parameters)}。只创建方案草稿，不报价、不生成、不问问题；不要参考卡、首帧、视频或占位节点，完成后停止。`
  if (rehearsal) {
    walk.fixture.expectText({ label: 'fixed story draft', match: body => JSON.stringify(body).includes(input.story),
      reply: { type: 'tool', id: 'release-core-draft', name: 'draft_shots', args: { shots: input.shots.slice(0, input.draftShots).map(shot => ({ title: shot.prompt, prompt: shot.prompt, taskKind: 'text_to_image', parameters: input.parameters, candidate: { providerId: input.image.vendorKey, modelId: input.image.modelKey } })) } } })
    walk.fixture.respond({ label: 'draft complete', match: body => (body.messages ?? []).some(m => m.role === 'tool' && m.tool_call_id === 'release-core-draft'), reply: { type: 'text', text: '分镜草稿已完成。' } })
  }
  const began = Date.now()
  await sendCreation(win, ask)
  const composer = win.locator(`${CREATION_PANEL} ${COMPOSER}`)
  // The transcript is a positive start signal even when a loopback turn finishes between frames.
  await expect.poll(() => readLaneTranscripts(project.projectRoot).flatMap(laneMessages).filter(m => ['user', 'nomi.input'].includes(m.role)).length, { timeout: stationTimeout({ operations: 2 }) }).toBeGreaterThan(0)
  await expect.poll(async () => {
    const messages = readLaneTranscripts(project.projectRoot).flatMap(laneMessages)
    const last = messages.filter(m => m.role === 'assistant').at(-1)
    const terminal = last?.content?.some(part => part.type === 'text') && !last.content.some(part => part.type === 'toolCall')
    return (await composer.getAttribute('data-awaiting-answer')) === 'true'
      || (terminal && await composer.getAttribute('data-mode') !== 'running')
  }, { timeout: stationTimeout({ turns: 1 }) }).toBe(true)
  const authoredDesigns = record => Object.values(record.payload?.storyboardDesignsByDocumentId ?? {}).flat().filter(d => d.plan?.shots?.some(s => s.prompt?.trim()))
  const draftAccepted = readLaneTranscripts(project.projectRoot).flatMap(laneMessages).some(m => m.role === 'toolResult' && m.toolName === 'draft_shots' && !m.isError)
  if (draftAccepted) await expect.poll(async () => authoredDesigns(await readProject(win, project.projectId)).length, { timeout: stationTimeout({ operations: 2 }) }).toBeGreaterThan(0)
  const record = await readProject(win, project.projectId)
  const designs = authoredDesigns(record)
  const shots = designs.flatMap(design => design.plan?.shots ?? [])
  const trace = trajectory(project.projectRoot)
  const pending = await win.locator(`${CREATION_PANEL} ${APPROVAL_CARD}`).isVisible()
  const placeholders = [...shots.filter(shot => !shot.prompt?.trim()).map(shot => shot.shotId),
    ...(record.payload.generationCanvas?.nodes ?? []).filter(node => !node.prompt?.trim()).map(node => node.id)]
  const manualSteps = trace.manual.length + Number(pending) + Number(shots.length < 3 || shots.length > 5)
  const elapsedMs = Date.now() - began
  await walk.snap('draft-finished')
  return { project, success: shots.length >= 3 && shots.length <= 5 && !pending, shotCount: shots.length, toolCalls: trace.calls.length,
    failures: trace.failures.length, retries: trace.retryCalls.length, manualSteps, placeholders: placeholders.length,
    placeholderIds: placeholders, elapsedMs, trace, designs, ask }
}

function seedBatch(walk, input) {
  const projectId = 'project-release-core-batch', documentId = 'doc-release-core', designId = 'release-core-five-shots'
  const projectRoot = path.join(walk.report.tempRoot, 'projects', projectId)
  const plan = { title: '旧书店的信', anchors: [], scenes: [{ id: 'scene-1', title: '旧书店' }], shots: input.shots.map((shot, index) => ({ ...shot,
    index: index + 1, sceneId: 'scene-1', shotKind: 'image', durationSec: 3, anchorIds: [],
    modelVendor: input.image.vendorKey, modelKey: input.image.modelKey, modeId: 'text_to_image', params: input.parameters })) }
  const record = { id: projectId, name: 'Release core batch', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot,
    payload: { workbenchDocuments: [{ id: documentId, version: 1, title: plan.title, updatedAt: 10, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: input.story }] }] } }],
      activeDocumentId: documentId, timeline: null, generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
      storyboardDesignsByDocumentId: { [documentId]: [{ id: designId, documentId, title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] } } }
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  for (const file of ['project.json', '.nomi/project.json']) fs.writeFileSync(path.join(projectRoot, file), JSON.stringify(record, null, 2))
  return { projectId, projectRoot, designId }
}

async function batchTask({ walk, win, input, batch }) {
  await win.locator('[data-project-card]', { hasText: 'Release core batch' }).first().click()
  await openStoryboardEditor(win, batch.designId)
  await collapseAgentPanel(win)
  const button = win.locator('[data-storyboard-batch]')
  await expect(button).toBeEnabled()
  const rtts = []
  let inFlight
  await win.evaluate(() => {
    window.__releaseCoreHeartbeat = { maxMs: 0, samples: 0, last: performance.now() }
    window.__releaseCoreTimer = setInterval(() => {
      const now = performance.now(), state = window.__releaseCoreHeartbeat
      state.maxMs = Math.max(state.maxMs, now - state.last - 100)
      state.samples++; state.last = now
    }, 100)
  })
  const timer = setInterval(() => {
    if (inFlight) return
    const began = Date.now()
    inFlight = win.evaluate(() => document.readyState).then(() => rtts.push(Date.now() - began)).finally(() => { inFlight = null })
    inFlight.catch(() => {})
  }, 250)
  const began = Date.now()
  try {
    await button.click()
    await expect(win.locator('[data-spend-confirm-dialog]')).toBeVisible()
    const boxes = win.locator('[data-spend-confirm-dialog] input[type="checkbox"]')
    assert.equal(await boxes.count(), 5, 'Exactly five authorized image rows')
    assert.equal(await boxes.filter({ visible: true }).count(), 5)
    for (const box of await boxes.all()) assert.ok(await box.isChecked())
    await walk.snap('batch-confirm')
    await confirmLockExitSpend(win, {}, { context: 'batch-release-core' })
    const nodes = async () => (await readProject(win, batch.projectId)).payload.generationCanvas.nodes.filter(n => n.meta?.storyboardDesignId === batch.designId)
    let timedOut = false
    try { await expect.poll(async () => {
      const rows = await nodes()
      return rows.length === 5 && rows.every(n => ['success', 'error', 'recoverable'].includes(n.status))
    }, { timeout: stationTimeout({ turns: 1 }) }).toBe(true) } catch (error) { if (!/Timeout/.test(error.message)) throw error; timedOut = true }
    const rows = await nodes()
    const shots = input.shots.map(shot => {
      const node = rows.find(n => n.meta?.shotId === shot.shotId)
      return { shotId: shot.shotId, outcome: node?.result?.url && node.status === 'success' ? 'success' : ['error', 'recoverable'].includes(node?.status) ? 'failed' : 'stuck',
        status: node?.status ?? null, error: node?.error ?? null, nodeId: node?.id ?? null, runs: node?.runs ?? [], result: node?.result ?? null,
        modelVendor: node?.meta?.modelVendor ?? null, modelKey: node?.meta?.modelKey ?? null,
        params: node ? Object.fromEntries(Object.keys(input.parameters).map(key => [key, node.meta?.[key] ?? null])) : null }
    })
    const heartbeat = await win.evaluate(() => { clearInterval(window.__releaseCoreTimer); return window.__releaseCoreHeartbeat })
    assert.ok(heartbeat.samples > 0 && rtts.length > 0, 'Responsiveness was actually sampled')
    const busyReleased = await win.locator('[data-place-storyboard]').isEnabled()
    await walk.snap('batch-finished')
    const rejectedRetries = rows.flatMap(n => n.runs ?? []).filter(run => /node_generation_in_flight|retry.*refus|already.*running/i.test(JSON.stringify(run))).length
    return { shots, elapsedMs: Date.now() - began, longestUnresponsiveMs: Math.max(heartbeat.maxMs, ...rtts), heartbeat, rtts, busyReleased, rejectedRetries, timedOut }
  } finally { clearInterval(timer); if (inFlight) await inFlight }
}
return { draftTask, seedBatch, batchTask }
}
