// Shared, isolated Electron setup for the pi cutover's real user-task walks.
// Business actions stay in the walks: this file only launches, observes and records.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, screenshotSettled } from './_assert.mjs'
import { createAgentRuntimeFixture } from './agent-runtime-fixture.mjs'

export const CREATION_PANEL = '[aria-label="AI 创作区"]'
export const CANVAS_PANEL = '[aria-label="生成区 AI 助手"]'
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

export async function readConversations(win, projectId) {
  const result = await win.evaluate((id) => window.nomiDesktop.conversations.read(id), projectId)
  expect(result.ok, 'The real conversations IPC must succeed').toBe(true)
  return result.conversations
}

export function readNativeContexts(projectRoot) {
  const file = path.join(projectRoot, '.nomi', 'agent-session.json')
  if (!fs.existsSync(file)) return null
  const container = JSON.parse(fs.readFileSync(file, 'utf8'))
  expect(container.version, 'Product entry must persist the v3 pi working-context store').toBe(3)
  return Object.values(container.records)
}

export function snapshotMessages(record) {
  const envelope = JSON.parse(record.snapshot)
  expect(envelope.format).toBe('nomi.pi-work-context')
  expect(envelope.piVersion).toBe('0.84.3')
  return envelope.data.entries.filter((entry) => entry.type === 'message').map((entry) => entry.message)
}

export async function chooseCreationMode(win, mode) {
  await clickOrFail(win.locator(`${CREATION_PANEL} [data-creation-prompt-picker]`), '本轮提示词选择器')
  await clickOrFail(win.locator(`[data-prompt-option="${mode}"]`), `创作提示词 ${mode}`)
}

export async function openCanvas(win) {
  await clickOrFail(win.getByRole('button', { name: '生成', exact: true }), '生成工作区')
  await expect(win.locator('.generation-canvas-v2__stage')).toBeVisible()
  // Host cutover retired the in-canvas assistant panel; the project Agent now lives in the
  // ResidentShell dock (gated by the default-off agentHost flag, #194). Its collapsed launcher is
  // the pill with [data-agent-resident-collapsed]; expanding it reveals [data-agent-composer].
  const launcher = win.locator('[data-agent-resident-collapsed="true"]')
  // This is a genuine two-state UI (persisted expanded/collapsed preference).
  if (await launcher.isVisible()) await clickOrFail(launcher, '展开常驻助手')
  await expect(win.locator('[data-agent-resident="true"] [data-agent-composer="true"]')).toBeVisible()
}

export async function sendCreation(win, text) {
  const input = win.getByRole('textbox', { name: '创作 AI 输入', exact: true })
  await expect(input).toBeVisible()
  await input.fill(text)
  await clickOrFail(win.getByRole('button', { name: '创作 AI 发送', exact: true }), '发送创作指令')
}

export async function sendCanvas(win, text) {
  const input = win.getByRole('textbox', { name: '给生成助手发送消息', exact: true })
  await expect(input).toBeVisible()
  await input.fill(text)
  await clickOrFail(win.getByRole('button', { name: '生成 AI 发送', exact: true }), '发送画布指令')
}

export async function newConversation(win, panel) {
  await clickOrFail(win.locator(panel).getByRole('button', { name: '会话历史', exact: true }), '会话历史')
  await clickOrFail(win.getByRole('button', { name: '新对话 当前会存入历史' }), '新对话（归档而非清空旧对话）')
}

export async function selectConversation(win, panel, title) {
  await clickOrFail(win.locator(panel).getByRole('button', { name: '会话历史', exact: true }), '会话历史')
  await clickOrFail(win.locator('li').filter({ has: win.getByText(title, { exact: true }) }), `恢复会话 ${title}`)
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
