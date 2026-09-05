// Shared, isolated Electron setup for the pi cutover's real user-task walks.
// Business actions stay in the walks: this file only launches, observes and records.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { createAgentRuntimeFixture } from './agent-runtime-fixture.mjs'

export const CREATION_PANEL = '[data-agent-resident="true"][data-agent-panel="true"][data-agent-surface="creation"]'
export const CANVAS_PANEL = '[data-agent-resident="true"][data-agent-panel="true"][data-agent-surface="generation"]'
export const DOCUMENT = '[aria-label="创作文档编辑区"] .tiptap[contenteditable="true"]'

export function toolNames(body) {
  return (body.tools ?? []).map((tool) => tool.function.name).sort()
}

export function hasToolResult(body, id) {
  return (body.messages ?? []).some((message) => message.role === 'tool' && message.tool_call_id === id)
}

/** One I/O safety bound, not a polling/sleep-based completion signal. */
export async function recorded(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 60_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function stopRuntimeApp(app) {
  const child = app.process()
  const exited = () => child.exitCode !== null || child.signalCode !== null
  try {
    await recorded(app.close(), 'the actual Electron process to close')
    expect(exited(), 'Cold restoration requires a terminated process, not a page reload').toBe(true)
  } catch (error) {
    if (!exited()) {
      // Only the child this walk launched. Never kill by name or touch another Nomi instance.
      const exit = once(child, 'exit', { signal: AbortSignal.timeout(5_000) })
      void exit.catch(() => {}) // Observe cancellation even if kill itself throws.
      try {
        if (!child.kill('SIGKILL')) throw new Error('Could not terminate the owned Electron process', { cause: error })
        await exit
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Electron close and owned-process cleanup failed', { cause: cleanupError })
      }
    }
    throw error
  }
}

export async function finalizeRuntimeWalk(report, { error, cleanup = [], collect } = {}) {
  const failures = error ? [error] : []
  for (const action of cleanup) {
    try { await action() } catch (cleanupError) { failures.push(cleanupError) }
  }
  try { Object.assign(report, await collect?.()) } catch (evidenceError) { failures.push(evidenceError) }
  report.result = failures.length ? 'failed' : 'passed'
  report.error = failures.length ? failures.map((failure) => failure instanceof Error ? failure.stack : String(failure)).join('\n\n') : undefined
  if (failures.length) process.exitCode = 1
  fs.writeFileSync(path.join(report.outputDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  return report
}

export async function readProject(win, projectId) {
  return win.evaluate((id) => window.nomiDesktop.projects.readAsync(id), projectId)
}

/**
 * Read back the active document without hiding the persisted schema version.
 * The legacy field remains readable for old projects, but current journeys must
 * prove that the writer emits the multi-document shape.
 */
export function readPersistedWorkbenchDocument(record) {
  const payload = record && typeof record === 'object' && record.payload && typeof record.payload === 'object'
    ? record.payload
    : null
  if (payload && Array.isArray(payload.workbenchDocuments)) {
    const activeDocumentId = typeof payload.activeDocumentId === 'string' ? payload.activeDocumentId : ''
    const document = payload.workbenchDocuments.find((item) => item && item.id === activeDocumentId)
    return document ? { schema: 'multi', document } : { schema: 'missing', document: null }
  }
  if (payload && payload.workbenchDocument && typeof payload.workbenchDocument === 'object') {
    return { schema: 'legacy', document: payload.workbenchDocument }
  }
  return { schema: 'missing', document: null }
}

export function requireCurrentPersistedWorkbenchDocument(record) {
  const readback = readPersistedWorkbenchDocument(record)
  if (readback.schema !== 'multi') {
    const detail = readback.schema === 'legacy'
      ? 'legacy workbenchDocument was readable but is not an acceptable current-writer result'
      : 'no supported persisted workbench document was readable'
    throw new Error(`Current multi-document persistence evidence missing: ${detail}`)
  }
  return readback.document
}

function conversationsFromProjectAgentSnapshot(snapshot) {
  const threads = (snapshot?.threads || []).map((thread) => ({
    id: thread.threadId,
    title: thread.title || '',
    createdAt: thread.createdAt || 0,
    updatedAt: thread.updatedAt || 0,
    messages: (snapshot?.items || [])
      .filter((item) => item.threadId === thread.threadId && (item.kind === 'user' || item.kind === 'assistant'))
      .map((item) => ({ id: item.itemId, role: item.kind, content: item.text || '' })),
  }))
  return { creation: { activeId: snapshot?.activeThreadId || null, threads }, generation: { activeId: null, threads: [] } }
}

export async function readConversations(win, projectId, durableRoots) {
  // The old conversations IPC was retired by the Project Agent cutover. When
  // a walk already owns the isolated profile, read the persisted Host snapshot
  // directly. Calling projectAgent.open() here would release the resident
  // renderer subscription on the same WebContents, making the next user turn
  // fail with project_agent_subscription_invalid.
  if (durableRoots?.settingsRoot && durableRoots?.projectRoot) {
    return conversationsFromProjectAgentSnapshot(readCurrentProjectAgentHostSnapshot(durableRoots.settingsRoot, durableRoots.projectRoot))
  }
  const snapshot = await win.evaluate(async (id) => {
    const record = await window.nomiDesktop.projects.readAsync(id)
    const opened = await window.nomiDesktop.projectAgent.open({
      projectId: id,
      immutableProjectUuid: record?.immutableProjectUuid,
      projectGeneration: record?.projectGeneration,
    })
    if (!opened?.ok) throw new Error('projectAgent.open failed')
    return opened.value.snapshot
  }, projectId)
  return conversationsFromProjectAgentSnapshot(snapshot)
}

export function readNativeContexts(projectRoot, settingsRoot) {
  if (!settingsRoot) return null
  const state = readCurrentProjectAgentHostSnapshot(settingsRoot, projectRoot)
  if (!state) return null
  const byThread = new Map()
  for (const item of state.items || []) {
    const threadId = item.threadId
    if (typeof threadId !== 'string' || !threadId) continue
    const entries = byThread.get(threadId) || []
    if (item.kind === 'tool' && typeof item.toolCallId === 'string') {
      entries.push({ type: 'message', message: {
        role: 'toolResult',
        toolCallId: item.toolCallId,
        content: item.resultRef || '',
      } })
    } else if (item.kind === 'user' || item.kind === 'assistant') {
      entries.push({ type: 'message', message: { role: item.kind, content: item.text || '' } })
    }
    byThread.set(threadId, entries)
  }
  const projectId = state.binding?.projectId
  return [...byThread.entries()].map(([threadId, entries]) => ({
    sessionKey: typeof projectId === 'string' ? `nomi:workbench:${projectId}:creation` : undefined,
    threadId,
    snapshot: JSON.stringify({
      format: 'nomi.pi-work-context',
      piVersion: '0.84.3',
      data: { entries },
    }),
  }))
}

export function snapshotMessages(record) {
  const envelope = JSON.parse(record.snapshot)
  expect(envelope.format).toBe('nomi.pi-work-context')
  expect(envelope.piVersion).toBe('0.84.3')
  return envelope.data.entries.filter((entry) => entry.type === 'message').map((entry) => entry.message)
}

/**
 * Current ProjectAgentHost persistence is a settings-owned, binding-partitioned
 * snapshot. Keep the legacy Pi reader above for the old support journeys, but
 * let current-host journeys prove the durable state that production actually
 * writes today.
 */
export function readCurrentProjectAgentHostSnapshot(settingsRoot, projectRoot) {
  const projectFile = path.join(projectRoot, '.nomi', 'project.json')
  if (!fs.existsSync(projectFile)) return null
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
  const { immutableProjectUuid, projectGeneration, id: projectId } = project
  if (typeof immutableProjectUuid !== 'string' || typeof projectGeneration !== 'number' || typeof projectId !== 'string') {
    return null
  }
  const partition = `project-agent.${encodeURIComponent(immutableProjectUuid)}.g${projectGeneration}`
  const snapshotFile = path.join(settingsRoot, 'project-agent-host', partition, 'snapshot-v1.json')
  if (!fs.existsSync(snapshotFile)) return null
  const envelope = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))
  expect(envelope.schemaVersion, 'Current ProjectAgentHost snapshot schema').toBe(1)
  expect(envelope.binding, 'Current ProjectAgentHost snapshot binding').toEqual({
    immutableProjectUuid,
    projectGeneration,
    projectId,
  })
  return envelope.state
}

export function readProjectAgentProposalReceipt(projectRoot) {
  const receiptFile = path.join(projectRoot, '.nomi', 'project-agent-proposal-receipt.json')
  if (!fs.existsSync(receiptFile)) return null
  return JSON.parse(fs.readFileSync(receiptFile, 'utf8'))
}

/**
 * Locate a current tool result by its persisted capability and its matching
 * proposal approval. The test never invents or assumes the provider's call id.
 */
export function readCurrentProjectAgentToolEvidence(settingsRoot, projectRoot, capabilityId) {
  const state = readCurrentProjectAgentHostSnapshot(settingsRoot, projectRoot)
  if (!state) return null
  const tool = state.items.find((item) => item.kind === 'tool' && item.capability?.id === capabilityId)
  const proposal = tool
    ? state.items.find((item) => item.kind === 'proposal' && item.approval?.toolCallId === tool.toolCallId)
    : undefined
  const receipt = readProjectAgentProposalReceipt(projectRoot)
  return { state, tool, proposal, receipt }
}

export async function chooseCreationMode(win, mode) {
  await clickOrFail(win.locator(`${CREATION_PANEL} [data-agent-composer-prompt="true"]`), '当前 Agent 提示词选择器')
  await clickOrFail(win.locator(`[data-agent-menu-item="${mode}"]`), `当前 Agent 提示词 ${mode}`)
}

export async function chooseAssistantModel(win, modelIdentity) {
  await clickOrFail(win.locator(`${CREATION_PANEL} [data-agent-composer-model="true"]`), '当前 Agent 模型选择器')
  await clickOrFail(win.locator(`[data-agent-menu-item="${modelIdentity}"]`), `当前 Agent 文本模型 ${modelIdentity}`)
}

export async function openCanvas(win) {
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }), '生成工作区')
  await expect(win.locator('.generation-canvas-v2__stage')).toBeVisible()
  // Host cutover retired the in-canvas assistant panel; the project Agent now lives in the
  // ResidentShell dock, resident by default since 2026-09-05. Its collapsed launcher is
  // the pill with [data-agent-resident-collapsed]; expanding it reveals [data-agent-composer].
  const launcher = win.locator('[data-agent-resident-collapsed="true"]')
  // This is a genuine two-state UI (persisted expanded/collapsed preference).
  if (await launcher.isVisible()) await clickOrFail(launcher, '展开常驻助手')
  await expect(win.locator('[data-agent-resident="true"] [data-agent-composer="true"]')).toBeVisible()
}

export async function sendCreation(win, text) {
  const input = win.locator(`${CREATION_PANEL} [data-agent-input="true"]`)
  await expect(input).toBeVisible()
  await input.fill(text)
  await clickOrFail(win.locator(`${CREATION_PANEL} [data-agent-composer-send="true"]`), '发送当前 Agent 指令')
}

export async function sendCanvas(win, text) {
  const input = win.locator(`${CANVAS_PANEL} [data-agent-input="true"]`)
  await expect(input).toBeVisible()
  await input.fill(text)
  await clickOrFail(win.locator(`${CANVAS_PANEL} [data-agent-composer-send="true"]`), '发送当前 Agent 画布指令')
}

export async function newConversation(win, panel) {
  const resident = win.locator(panel)
  await clickOrFail(resident.locator('[data-agent-history="true"]'), '当前 Agent 会话列表')
  await clickOrFail(win.locator('[data-agent-thread-menu="true"]').getByRole('button', { name: '新对话', exact: true }), '当前 Agent 新对话')
}

export async function selectConversation(win, panel, title) {
  const resident = win.locator(panel)
  await clickOrFail(resident.locator('[data-agent-history="true"]'), '当前 Agent 会话列表')
  await clickOrFail(win.locator('[data-agent-thread-menu="true"]').getByRole('button', { name: title, exact: true }), `恢复当前 Agent 会话 ${title}`)
}

/** Current Host threads may intentionally have no title; select by persisted order in that case. */
export async function selectConversationAt(win, panel, index) {
  const resident = win.locator(panel)
  await clickOrFail(resident.locator('[data-agent-history="true"]'), '当前 Agent 会话列表')
  const rows = win.locator('[data-agent-thread-menu="true"] > div')
  await clickOrFail(rows.nth(index + 1).getByRole('button').first(), `恢复当前 Agent 第 ${index + 1} 个会话`)
}

export async function createRuntimeWalk(name) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--packaged' || !path.isAbsolute(args[1]))) {
    throw new Error('Usage: node <walk.mjs> [--packaged /absolute/Nomi.app/Contents/MacOS/Nomi]')
  }
  const executablePath = args[1]
  const mode = executablePath ? 'packaged' : 'development'
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `nomi-pi-${name}-`))
  const settingsDir = path.join(tempRoot, 'settings')
  const outputDir = path.join(repoRoot, '.tmp', `pi-${name}-${mode}-${Date.now()}`)
  fs.mkdirSync(outputDir, { recursive: true })
  const fixture = await createAgentRuntimeFixture({ rootDir: repoRoot, settingsDir })
  const launches = []
  const screenshots = []
  const report = { name, mode, tempRoot, outputDir, launches, screenshots, paidCalls: 0 }
  let current

  async function start({ first = false } = {}) {
    current = await launchNomiApp({
      name: `pi-${name}`, tempRoot, settingsDir, settleMs: 0,
      ...(executablePath ? { executablePath } : {}),
      env: { NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '', NOMI_DESKTOP_DEV: '', NOMI_E2E_PRODUCTION_FIXTURE: '0', NOMI_DISABLE_AUTO_UPDATE: '1' },
      args: ['--no-proxy-server'],
    })
    const { win, app } = current
    win.setDefaultTimeout(30_000)
    const info = await app.evaluate(({ app: mainApp }) => ({
      packaged: mainApp.isPackaged, appPath: mainApp.getAppPath(), userData: mainApp.getPath('userData'),
      node: process.versions.node, electron: process.versions.electron, pid: process.pid,
    }))
    expect(info.packaged).toBe(Boolean(executablePath))
    expect(info.userData).toBe(current.userDataDir)
    if (executablePath) expect(info.appPath.endsWith('app.asar')).toBe(true)
    launches.push(info)
    if (first) {
      // Onboarding/locale preferences only. No project, tool, task or result is seeded.
      await win.evaluate(() => {
        localStorage.setItem('nomi:locale:v1', 'zh-CN')
        localStorage.setItem('nomi-color-scheme', 'light')
        for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
          localStorage.setItem(key, 'seen')
        }
      })
      await win.reload({ waitUntil: 'domcontentloaded' })
    }
    expect(win.url().startsWith('file:')).toBe(true)
    return current
  }

  async function newProject() {
    const { win } = current
    await clickOrFail(win.getByRole('button', { name: /^新建空白项目/ }), '新建空白项目')
    await expect(win.locator(DOCUMENT)).toBeVisible({ timeout: 30_000 })
    const projectId = await win.evaluate(() => {
      const url = new URL(location.href)
      return url.searchParams.get('projectId') ?? new URLSearchParams(url.hash.split('?')[1] ?? '').get('projectId')
    })
    expect(projectId).toMatch(/^project-/)
    const summaries = await win.evaluate(() => window.nomiDesktop.projects.listAsync())
    const project = summaries.find((item) => item.id === projectId)
    expect(project?.rootPath, 'The real created project must have a canonical isolated folder').toBeTruthy()
    expect(path.relative(current.projectsDir, project.rootPath).startsWith('..')).toBe(false)
    report.projectId = projectId
    report.projectRoot = project.rootPath
    return { projectId, projectRoot: project.rootPath, name: project.name }
  }

  async function snap(label) {
    const file = path.join(outputDir, `${String(screenshots.length + 1).padStart(2, '0')}-${label}.png`)
    await screenshotSettled(current.win, { path: file })
    screenshots.push(file)
    return file
  }

  async function stopApp() {
    if (!current) return
    const closed = current
    current = undefined
    await stopRuntimeApp(closed.app)
  }

  async function finish(error) {
    if (error && current) {
      try { await current.win.screenshot({ path: path.join(outputDir, 'FAIL.png') }) }
      catch (captureError) { console.error('Failure screenshot unavailable:', captureError.message) }
    }
    await finalizeRuntimeWalk(report, {
      error, cleanup: [stopApp, () => fixture.close()],
      collect: () => {
        Object.assign(report, { textRequests: fixture.requests.length, imageRequests: fixture.images.length, unexpected: fixture.unexpected })
        fixture.assertClean() // Includes requests received during app teardown, after the body checkpoint.
      },
    })
  }

  return { fixture, report, outputDir, start, newProject, snap, stopApp, finish }
}
