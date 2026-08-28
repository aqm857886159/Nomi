#!/usr/bin/env node
// B6 real GUI journey (zero quota): a genuine canvas Agent turn reads project A through the
// main-owned Surface port. Its post-tool model response is held while the user leaves A, opens B,
// and reloads the window. A late response from the retired turn must never become a B bubble or
// B conversation entry. Only the text vendor is loopback; UI, Pi, IPC, Surface binding, executor,
// project persistence, project switch, and reload all use production paths.
import path from 'node:path'

import { clickOrFail, expect } from './_assert.mjs'
import { FIXTURE_IMAGE_MODEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import {
  CANVAS_PANEL,
  DOCUMENT,
  createRuntimeWalk,
  hasToolResult,
  openCanvas,
  readConversations,
  readProject,
  recorded,
  sendCanvas,
  toolNames,
} from './agent-runtime-walk-support.mjs'

const PROJECT_A_NAME = 'B6 Surface 项目 A'
const PROJECT_B_NAME = 'B6 Surface 项目 B'
const A_NODE_TITLE = 'B6_A_ONLY_NODE'
const A_SEED_PROMPT = 'B6_A_SEED：只创建一张 A 专属图片节点，不要生成。'
const A_READ_PROMPT = 'B6_A_READ：请先读取画布，再告诉我 A 专属节点是否存在。'
const A_READ_CALL = 'b6-read-a-1'
const A_LATE_REPLY = 'B6_A_LATE_RESULT_SHOULD_NOT_SURFACE'
const B_BARRIER_PROMPT = 'B6_B_BARRIER：只回复 B6_B_ONLY_REPLY，不调用工具。'
const B_BARRIER_REPLY = 'B6_B_ONLY_REPLY'

async function currentProjectId(win) {
  return win.evaluate(() => {
    const url = new URL(location.href)
    return url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId')
  })
}

async function renameCurrentProject(win, name) {
  await clickOrFail(win.locator('.nomi-appbar__breadcrumb-seg--name'), `编辑项目名为 ${name}`)
  const input = win.getByRole('textbox', { name: '项目名称', exact: true })
  await expect(input).toBeVisible()
  await input.fill(name)
  await input.press('Enter')
  await expect(win.locator('.nomi-appbar__breadcrumb-seg--name')).toContainText(name)
  await expect
    .poll(
      async () => {
        const projects = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
        return projects.some((project) => project.name === name)
      },
      { message: `renamed project ${name} must persist before switching` },
    )
    .toBe(true)
}

async function createNamedProject(win, name, projectsDir) {
  await clickOrFail(win.getByRole('button', { name: /^新建空白项目/ }), `新建 ${name}`)
  await expect(win.locator(DOCUMENT)).toBeVisible({ timeout: 30_000 })
  const projectId = await currentProjectId(win)
  expect(projectId).toMatch(/^project-/)
  await renameCurrentProject(win, name)
  const projects = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
  const project = projects.find((item) => item.id === projectId)
  expect(project?.rootPath).toBeTruthy()
  const relativeRoot = path.relative(projectsDir, project.rootPath)
  expect(relativeRoot).not.toBe('')
  expect(relativeRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRoot)).toBe(false)
  return { projectId, projectRoot: project.rootPath, name }
}

async function backToLibrary(win) {
  await clickOrFail(win.getByRole('button', { name: /项目库/ }).first(), '回到项目库并释放当前 Surface')
  await expect(win.getByRole('button', { name: /^新建空白项目/ })).toBeVisible({ timeout: 30_000 })
}

async function openProject(win, name) {
  const card = win.locator('[data-project-card="true"]', { hasText: name })
  await clickOrFail(card, `打开 ${name}`)
  // Reopening restores the project's last active workspace. A project last used on the
  // generation canvas therefore has no creation editor mounted; the shared top navigation
  // is the stable signal that project hydration and routing completed.
  await expect(win.getByRole('button', { name: '生成', exact: true })).toBeVisible({ timeout: 30_000 })
}

const walk = await createRuntimeWalk('project-agent-canvas-isolation')
let failure
try {
  const launched = await walk.start({ first: true })
  let { win } = launched
  const projectA = await createNamedProject(win, PROJECT_A_NAME, launched.projectsDir)
  await openCanvas(win)

  const seedArgs = {
    summary: 'B6 A 项目辨识节点',
    nodes: [
      {
        clientId: 'b6-a-only',
        kind: 'image',
        title: A_NODE_TITLE,
        prompt: '只属于项目 A 的红色标记卡。',
        modelKey: FIXTURE_IMAGE_MODEL,
        modeId: 't2i',
        params: { size: '1024x1024' },
      },
    ],
    edges: [],
  }
  const seedRequest = walk.fixture.expectText({
    label: 'seed one distinguishing node in project A',
    match: (body) => flattenRequestText(body).includes(A_SEED_PROMPT) && !hasToolResult(body, 'b6-seed-a-1'),
    reply: { type: 'tool', id: 'b6-seed-a-1', name: 'create_canvas_nodes', args: seedArgs },
  })
  const seedDone = walk.fixture.expectText({
    label: 'finish the real A seed tool turn',
    match: (body) => hasToolResult(body, 'b6-seed-a-1'),
    reply: { type: 'text', text: 'B6_A_SEEDED' },
  })
  await sendCanvas(win, A_SEED_PROMPT)
  const seedWire = await recorded(seedRequest.received, 'project A seed tool request')
  expect(toolNames(seedWire.body)).toContain('read_canvas_state')
  const plan = win.locator('[data-agent-plan-card="true"]')
  await expect(plan).toBeVisible()
  await clickOrFail(plan.locator('[data-plan-confirm-all="true"]'), '批准 A 专属节点')
  await recorded(seedDone.received, 'project A seed tool result')
  await expect(win.locator(CANVAS_PANEL)).toContainText('B6_A_SEEDED')
  await expect
    .poll(
      async () => {
        const canvas = (await readProject(win, projectA.projectId)).payload.generationCanvas
        return canvas.nodes.map((node) => node.title)
      },
      { message: 'A distinguishing node must reach the real project before isolation proof' },
    )
    .toEqual([A_NODE_TITLE])

  await backToLibrary(win)
  const projectB = await createNamedProject(win, PROJECT_B_NAME, launched.projectsDir)
  await backToLibrary(win)
  await openProject(win, PROJECT_A_NAME)
  await openCanvas(win)

  const readRequest = walk.fixture.expectText({
    label: 'project A asks the real Pi tool host to read canvas',
    match: (body) => flattenRequestText(body).includes(A_READ_PROMPT) && !hasToolResult(body, A_READ_CALL),
    reply: { type: 'tool', id: A_READ_CALL, name: 'read_canvas_state', args: {} },
  })
  const heldAfterRead = walk.fixture.expectText({
    label: 'hold the model response after main-owned canvas.read succeeded for A',
    match: (body) => hasToolResult(body, A_READ_CALL),
    reply: { type: 'hold' },
  })
  await sendCanvas(win, A_READ_PROMPT)
  const readWire = await recorded(readRequest.received, 'project A canvas.read request')
  expect(toolNames(readWire.body)).toContain('read_canvas_state')
  const postReadWire = await recorded(heldAfterRead.received, 'project A canvas.read tool result')
  const toolResult = postReadWire.body.messages.find(
    (message) => message.role === 'tool' && message.tool_call_id === A_READ_CALL,
  )
  expect(toolResult, 'the real Pi turn must receive main canvas.read output').toBeTruthy()
  expect(String(toolResult.content)).toContain(A_NODE_TITLE)
  expect(String(toolResult.content)).not.toContain(PROJECT_B_NAME)

  // Leaving A synchronously abandons its renderer turn after main acknowledges Surface release.
  await backToLibrary(win)
  await openProject(win, PROJECT_B_NAME)
  expect(await currentProjectId(win)).toBe(projectB.projectId)
  await openCanvas(win)

  // A hard document replacement invalidates the retired frame/owner. The late A response is released
  // only after the new B document has committed, then a real B turn provides a causal transport barrier.
  await win.reload({ waitUntil: 'domcontentloaded' })
  await openCanvas(win)
  const bBarrier = walk.fixture.expectText({
    label: 'project B remains independently usable after A switch and window reload',
    match: (body) => flattenRequestText(body).includes(B_BARRIER_PROMPT),
    reply: { type: 'text', text: B_BARRIER_REPLY },
  })
  heldAfterRead.release({ type: 'text', text: A_LATE_REPLY })
  await sendCanvas(win, B_BARRIER_PROMPT)
  const bWire = await recorded(bBarrier.received, 'project B post-reload barrier')
  expect(flattenRequestText(bWire.body)).not.toContain(A_READ_PROMPT)
  expect(hasToolResult(bWire.body, A_READ_CALL)).toBe(false)
  const bPanel = win.locator(CANVAS_PANEL)
  await expect(bPanel).toContainText(B_BARRIER_REPLY)
  await expect(bPanel).not.toContainText(A_LATE_REPLY)
  await expect(bPanel).not.toContainText(A_READ_PROMPT)

  // UI publication precedes the asynchronous conversation save. Wait on the persisted
  // causal barrier itself so the isolation assertions inspect durable state, not a race.
  await expect
    .poll(async () => JSON.stringify((await readConversations(win, projectB.projectId)).generation), {
      message: 'project B barrier turn must persist before isolation is inspected',
      timeout: 30_000,
    })
    .toContain(B_BARRIER_REPLY)
  const bConversations = await readConversations(win, projectB.projectId)
  const bConversationText = JSON.stringify(bConversations.generation)
  expect(bConversationText).toContain(B_BARRIER_PROMPT)
  expect(bConversationText).toContain(B_BARRIER_REPLY)
  expect(bConversationText).not.toContain(A_READ_PROMPT)
  expect(bConversationText).not.toContain(A_LATE_REPLY)
  expect(bConversationText).not.toContain(A_NODE_TITLE)
  expect((await readProject(win, projectB.projectId)).payload.generationCanvas.nodes).toEqual([])
  expect((await readProject(win, projectA.projectId)).payload.generationCanvas.nodes.map((node) => node.title)).toEqual(
    [A_NODE_TITLE],
  )
  await walk.snap('project-b-clean-after-a-read-switch-reload')

  walk.fixture.assertClean()
  walk.report.projectA = projectA
  walk.report.projectB = projectB
  walk.report.verified = [
    'real-pi-main-canvas-read-returned-project-a-node',
    'project-switch-abandoned-a-turn',
    'window-reload-invalidated-old-surface-owner',
    'late-a-response-did-not-enter-project-b-ui-or-persistence',
    'project-b-remained-usable-and-empty',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
