import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { expect, screenshotSettled } from './_assert.mjs'
import { openCanvas, readProject } from './agent-runtime-walk-support.mjs'
import { collapseAgentPanel, newProjectEntry, openRailDrawer, canvasSetZoomPercent } from './_shell.mjs'
import { spawnMcpStdioClient, parseToolResult } from './_mcpJourney.mjs'
import { quietElectronSpawn, repoRoot } from './_launchApp.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'
import { findNodeHitPoint } from './_canvasHit.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'

/** Mac launch rule is checked immediately before starting any GUI, including rehearsal. */
export async function waitForRelayLaunch({ limitMs = 2 * 60 * 60 * 1000 } = {}) {
  if (process.platform !== 'darwin') return { platform: process.platform }
  const started = Date.now()
  while (Date.now() - started < limitMs) {
    const front = execFileSync('lsappinfo', ['front'], { encoding: 'utf8' }).trim()
    const name = execFileSync('lsappinfo', ['info', '-only', 'name', front], { encoding: 'utf8' }).trim()
    const load5 = os.loadavg()[1]
    let idleSeconds = null
    try {
      const idle = execFileSync('ioreg', ['-c', 'IOHIDSystem'], { encoding: 'utf8' }).match(/"HIDIdleTime"\s*=\s*(\d+)/)
      if (idle) idleSeconds = Math.floor(Number(idle[1]) / 1e9)
    } catch (error) { console.warn(`[launch] HID idle check unavailable: ${error.message}`) }
    const foregroundPermitted = !/claude/i.test(name)
    console.log(`[launch] ${new Date().toISOString()} front=${name} load5=${load5} idleSeconds=${idleSeconds}`)
    if (load5 < 10 && (foregroundPermitted || (idleSeconds !== null && idleSeconds >= 600))) return { front: name, load5, idleSeconds, permittedBy: foregroundPermitted ? 'foreground' : 'idle', waitedMs: Date.now() - started }
    await new Promise((resolve) => setTimeout(resolve, 60_000))
  }
  throw new Error('Launch deferred for two hours: foreground app or five-minute load did not permit a quiet walk')
}

/** An isolated MCP transport calls the exact production declaration handler, without an LLM. */
export async function relayModelClient({ settingsDir, userDataDir, tempRoot, env = {} }) {
  const capabilityDir = path.join(tempRoot, 'capability')
  fs.mkdirSync(capabilityDir, { recursive: true })
  const childEnv = { ...env, [ENV_KEY_VAR]: '', NOMI_TEST_NETWORK_GUARD: '1', NOMI_WALK_FOREGROUND_OK: '' }
  const quiet = quietElectronSpawn(['-r', path.join(repoRoot, 'scripts/walkthrough-network-guard.cjs'), repoRoot, '--disable-gpu'], { env: childEnv })
  const client = spawnMcpStdioClient({ settingsDir, userDataDir, projectsDir: path.join(tempRoot, 'projects'), capabilityDir,
    captureStderr: true,
    runtime: { command: quiet.command, args: quiet.args, cwd: repoRoot, env: quiet.options.env },
    env: childEnv,
  })
  await client.initialize(stationTimeout())
  return {
    async call(name, args) {
      const result = parseToolResult(await client.callTool(name, args))
      const value = result.json ?? result.outcome
      if (result.isError || value?.ok === false) throw new Error(JSON.stringify(value || { text: result.text }))
      return value
    },
    close: () => client.terminate(),
  }
}

export async function captureRelayScreen(win, directory, tag) {
  fs.mkdirSync(directory, { recursive: true })
  await screenshotSettled(win, { path: path.join(directory, `${tag}.png`) })
  const text = await win.locator('body').innerText()
  fs.writeFileSync(path.join(directory, `${tag}.txt`), text)
  return text
}

// The older runtime helper waits for a Chinese-only document label. Keep this journey bilingual.
export async function createRelayProject(walk, win) {
  await newProjectEntry(win).click()
  await expect(win.locator('[aria-label="创作文档编辑区"] .tiptap[contenteditable="true"], [aria-label="Creation document editor"] .tiptap[contenteditable="true"]')).toBeVisible()
  const projectId = await win.evaluate(() => new URL(location.href).searchParams.get('projectId') ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get('projectId'))
  expect(projectId).toMatch(/^project-/)
  const project = (await win.evaluate(() => window.nomiDesktop.projects.listAsync())).find((item) => item.id === projectId)
  expect(project?.rootPath).toBeTruthy()
  expect(path.relative(walk.report.tempRoot, project.rootPath).startsWith('..')).toBe(false)
  Object.assign(walk.report, { projectId, projectRoot: project.rootPath })
  return { projectId, projectRoot: project.rootPath, name: project.name }
}

/** Shared free/paid segment: select the declared model, prepare one video, stop before generate. */
export async function prepareRelayVideo({ win, newProject, model, capture }) {
  const { projectId, projectRoot } = await newProject()
  await openCanvas(win)
  await collapseAgentPanel(win)
  const before = new Set(((await readProject(win, projectId)).payload.generationCanvas.nodes ?? []).map((n) => n.id))
  await win.getByRole('button', { name: /添加视频节点|Add video node/i }).first().click()
  const fresh = async () => (await readProject(win, projectId)).payload.generationCanvas.nodes.find((n) => !before.has(n.id) && n.kind === 'video')
  await expect.poll(async () => Boolean(await fresh()), { timeout: stationTimeout() }).toBe(true)
  const id = (await fresh()).id
  const node = win.locator(`[data-node-id="${id}"]`)
  const textMode = node.getByText(uiText('zh-CN', 'generationCommon.nodeTry.video.text'), { exact: true }).or(node.getByText(uiText('en', 'generationCommon.nodeTry.video.text'), { exact: true }))
  if (await textMode.isVisible().catch(() => false)) await textMode.click()
  const projection = await win.evaluate(async (want) => {
    const rows = await window.nomiDesktop.modelCatalog.listModels({})
    const row = rows.find((r) => r.vendorKey === want.vendorKey && r.modelKey === want.modelKey)
    return row ? { kind: row.kind, enabled: row.enabled, published: row.published, publishedModes: row.publishedModes, availability: row.availability } : null
  }, model)
  console.log('[relay] catalog projection', JSON.stringify(projection))
  console.log('[relay] picker evidence', JSON.stringify({ node: await fresh(), videoRows: await win.evaluate(async () => (await window.nomiDesktop.modelCatalog.listModels({ kind: 'video', enabled: true })).filter((row) => row.availability?.usable).map(({ vendorKey, modelKey, publishedModes, availability }) => ({ vendorKey, modelKey, publishedModes, availability }))) }))
  await node.locator('[data-bar-segment="model-params"] button').first().click()
  await capture('model-menu')
  let neededReload = false
  if (!(await win.getByText(model.modelKey, { exact: true }).count())) {
    await capture('model-missing-before-reload')
    await win.keyboard.press('Escape')
    await win.reload()
    await node.waitFor({ state: 'visible', timeout: stationTimeout() })
    await canvasSetZoomPercent(win, 100, 'Keep the reloaded node and composer visible')
    const hit = await findNodeHitPoint(win, { nodeSelector: `.react-flow__node[data-id="${id}"]` })
    expect(hit, 'The reloaded node has a real pointer target').toBeTruthy()
    await win.mouse.click(hit.x, hit.y)
    await node.locator('[data-bar-segment="model-params"] button').first().click()
    await capture('model-menu-after-reload')
    neededReload = true
  }
  // This is the visible model menu, never a catalog/meta write that skips model selection.
  await win.getByText(model.modelKey, { exact: true }).last().click()
  const prompt = 'A blue glass marble rolls across a white table in morning light'
  await node.locator('[contenteditable="true"]').last().fill(prompt)
  await expect.poll(async () => {
    const n = await fresh()
    return { vendorKey: n?.meta?.modelVendor, modelKey: n?.meta?.modelKey, prompt: n?.prompt }
  }, { timeout: stationTimeout() }).toEqual({ ...model, prompt })
  await capture('before-generate')
  const generated = (await fresh()).runs ?? []
  expect(generated.length, 'free segment ends before a generated run exists').toBe(0)
  return { projectId, projectRoot, nodeId: id, node, projection, neededReload }
}

/** Shared paid/rehearsal segment: exactly one click, local asset, decoder and browser playback. */
export async function generateRelayVideo({ win, prepared, capture }) {
  const { node, projectId, nodeId } = prepared
  await node.locator('[data-bar-segment="generate"]').click()
  await expect.poll(() => node.getAttribute('data-status'), { timeout: stationTimeout({ turns: 2 }) }).toMatch(/^(success|error|failed|recoverable)$/)
  expect(await node.getAttribute('data-status'), 'generation finishes successfully; failures are reported immediately').toBe('success')
  const landed = (await readProject(win, projectId)).payload.generationCanvas.nodes.find((n) => n.id === nodeId)
  expect(landed.result?.url).toMatch(/^nomi-local:\/\/asset\//)
  const { probeLandedMedia } = await import('./_agentVideoPaid.mjs')
  const media = await probeLandedMedia(prepared.projectRoot, projectId, landed.result.url)
  expect(media.probe.kind).toBe('video')
  const playable = await node.locator('video').first().evaluate(async (video) => {
    await video.play()
    return { readyState: video.readyState, width: video.videoWidth, duration: video.duration }
  })
  expect(playable.width).toBeGreaterThan(0)
  await capture('landed')
  let stored
  await expect.poll(async () => {
    stored = (await win.evaluate((id) => window.nomiDesktop.assets.list({ projectId: id }), projectId)).items.find((asset) => asset.data?.url === landed.result.url)
    return Boolean(stored && stored.data.mediaType === 'video')
  }, { timeout: stationTimeout() }).toBe(true)
  const library = await openRailDrawer(win, 'assets', 'Open the project asset library')
  await expect(library.getByText(stored.name, { exact: true }).first()).toBeVisible()
  await capture('asset-library')
  return { nodeId, url: landed.result.url, media, playable, library: { id: stored.id, name: stored.name, mediaType: stored.data.mediaType } }
}
