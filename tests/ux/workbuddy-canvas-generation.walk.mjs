// Real Electron + signed WorkBuddy MCP stdio replay; this does not certify the WorkBuddy LLM/UI.
// Loopback provider is protocol evidence only, never real paid-provider output.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { makeIsolatedDirs, parseToolResult, spawnMcpStdioClient, seedMcpClientIdentityEnv } from './_mcpJourney.mjs'
import { startFakeApimartServer, writeFakeApimartCatalog } from './_mcpL2Fixture.mjs'
import { newProjectEntry, switchWorkspace } from './_shell.mjs'
import { screenshotSettled, proveProbe, expectAbsent } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
const dirs = makeIsolatedDirs('nomi-workbuddy-chain-')
const out = path.resolve(
  process.argv.find((a) => a.startsWith('--out='))?.slice(6) || 'artifacts/workbuddy-canvas-generation',
)
fs.mkdirSync(out, { recursive: true })
let gui, mcp, provider
const viewportSize =
  process.env.NOMI_CANVAS_CHAIN_NARROW === '1' ? { width: 1100, height: 690 } : { width: 1280, height: 933 }
const report = {
  viewportSize,
  baseline: process.env.NOMI_TESTED_COMMIT || 'working-tree',
  transport: 'real stdio, signed workbuddy client, real Electron, loopback provider',
  steps: [],
}
async function assertCanvasAliases(win, phase) {
  const aliases = await win.evaluate(() =>
    [
      ['.react-flow__viewport', 'generation-canvas-v2__canvas'],
      ['.react-flow__edges', 'generation-canvas-v2__edges'],
      ['.react-flow__nodes', 'generation-canvas-v2__nodes'],
    ].map(([selector, alias]) => ({
      selector,
      alias,
      present: Boolean(document.querySelector(selector)?.classList.contains(alias)),
    })),
  )
  report.aliases ??= {}
  report.aliases[phase] = aliases
  assert.ok(
    aliases.every((row) => row.present),
    `framework container aliases survive ${phase}`,
  )
}
async function call(name, args) {
  const raw = await mcp.callTool(name, args, { timeoutMs: 60000 })
  const p = parseToolResult(raw)
  report.steps.push({ name, isError: p.isError })
  fs.writeFileSync(out + '/chain.json', JSON.stringify(report, null, 2))
  if (raw.isError) throw new Error(name + ': ' + p.text)
  return p.json ?? p.outcome
}
try {
  provider = await startFakeApimartServer()
  const catalog = writeFakeApimartCatalog(dirs.settingsDir, dirs.userDataDir, provider.origin, { withKey: false })
  // Normal canvas runtime uses catalog mappings (not the production-run E2E
  // adapter). Declare an auth-free local gateway with the shipped image codec.
  const stamp = new Date().toISOString()
  const source = catalog.models.find((m) => m.vendorKey === 'apimart' && m.modelKey === 'gpt-image-2')
  catalog.vendors.push({
    key: 'nomi-loopback',
    name: 'Loopback protocol fixture',
    enabled: true,
    baseUrlHint: provider.origin,
    authType: 'none',
    providerKind: 'openai-compatible',
    createdAt: stamp,
    updatedAt: stamp,
  })
  catalog.models.push({
    ...source,
    vendorKey: 'nomi-loopback',
    meta: {
      ...source.meta,
      adapter: {
        state: 'verified',
        activeRevision: 'loopback-image-v1',
        modes: [{ taskKind: 'text_to_image', state: 'verified' }],
        updatedAt: stamp,
      },
    },
  })
  catalog.mappings.push(
    ...catalog.mappings
      .filter((m) => m.vendorKey === 'apimart' && m.modelKey === 'gpt-image-2')
      .map((m) => ({ ...m, id: 'loopback-' + m.id, vendorKey: 'nomi-loopback' })),
  )
  fs.writeFileSync(path.join(dirs.settingsDir, 'model-catalog.json'), JSON.stringify(catalog))
  gui = await launchNomiApp({
    name: 'workbuddy-chain',
    viewportSize,
    ...dirs,
    settleMs: 0,
    syntheticCredentialStorage: true,
    mainRequire: [path.resolve('scripts/walkthrough-network-guard.cjs')],
    env: {
      NOMI_WALK_NET_LOG: out + '/network.jsonl',
      NOMI_CAPABILITY_DIR: dirs.capabilityDir,
    },
    initialLocalStorage: {
      'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen',
      'nomi:locale:v1': 'zh-CN',
      __nomiE2E: '1',
    },
  })
  const win = gui.win
  await newProjectEntry(win).click()
  await win.waitForFunction(() => location.hash.includes('projectId='))
  await switchWorkspace(win, 'generation')
  await win
    .locator('[data-nomi-generation-canvas-import-target]')
    .waitFor({ timeout: stationTimeout({ operations: 2 }) })
  await assertCanvasAliases(win, 'empty-canvas')
  mcp = spawnMcpStdioClient({
    ...dirs,
    clientInfo: { name: 'WorkBuddy', version: '5.2.6-chain-replay' },
    capabilities: {},
    captureStderr: true,
    env: {
      ...seedMcpClientIdentityEnv(dirs.capabilityDir, 'workbuddy'),
    },
  })
  assert.ok((await mcp.initialize()).result, 'signed WorkBuddy transport initialized')
  report.tools = (await mcp.rpc('tools/list', {}, 20000)).result.tools.map((t) => t.name)
  const session = await call('nomi_session_open', { bootstrap: { mode: 'current_project' } })
  const leaseHandle = session.leaseHandle
  const projectId = await win.evaluate(() => new URLSearchParams(location.hash.split('?')[1]).get('projectId'))
  const prompts = [
    '暖色自然光从窗边照入，两只猫看着桌上的零食，温馨电影质感。',
    '橘猫嗅闻零食包装袋，脸部近景，暖色侧光，浅景深。',
    '白猫和橘猫并排望向镜头，桌上有零食袋，温暖室内，正面中景。',
  ]
  const creating = call('nomi_canvas_edit', {
    leaseHandle,
    projectId,
    operation: 'create_canvas_nodes',
    summary: '创建三镜图片方案',
    nodes: prompts.map((prompt, i) => ({
      clientId: 'shot-' + i,
      kind: 'image',
      title: '测试分镜' + (i + 1),
      prompt,
      modelKey: 'gpt-image-2',
      vendor: 'nomi-loopback',
    })),
  })
  const proposal = win
    .locator('div.fixed.inset-0')
    .filter({ hasText: /在画布落一套方案|落到画布/ })
    .first()
  await proposal.waitFor({ timeout: stationTimeout({ operations: 2 }) })
  await proposal.locator('button').last().click()
  const result = await creating
  report.plan = result
  await win.waitForFunction(
    () => window.__nomiCanvasStore?.getState().nodes.length >= 3,
    {},
    { timeout: stationTimeout({ operations: 2 }) },
  )
  report.nodes = await win.evaluate(() =>
    window.__nomiCanvasStore
      .getState()
      .nodes.map((n) => ({ id: n.id, kind: n.kind, title: n.title, prompt: n.prompt, meta: n.meta, size: n.size })),
  )
  await assertCanvasAliases(win, 'external-landing')
  assert.equal(report.nodes.length, 3, 'the external plan lands all three shots')
  assert.ok(
    report.nodes.every(
      (node) =>
        node.kind === 'image' && node.meta.modelKey === 'gpt-image-2' && node.meta.modelVendor === 'nomi-loopback',
    ),
    'node kind and selected model identity survive external landing',
  )
  await screenshotSettled(win, { path: out + '/landed.png' })
  const nodeId = report.nodes[2].id
  await win.locator(`[data-node-id="${nodeId}"]`).click({ position: { x: 60, y: 60 } })
  await win.locator('[data-node-composer-footer]').waitFor({ timeout: stationTimeout() })
  report.controls = await win.locator('[data-node-composer-footer]').evaluate((el) => ({
    text: el.textContent,
    buttons: [...el.querySelectorAll('button')].map((b) => ({
      label: b.getAttribute('aria-label'),
      disabled: b.disabled,
      text: b.textContent,
    })),
    rect: el.getBoundingClientRect().toJSON(),
  }))
  await screenshotSettled(win, { path: out + '/selected.png' })
  report.reachability = await win.locator('[data-node-composer-footer]').evaluate((footer) => {
    const stage = footer.closest('[data-nomi-generation-canvas-import-target]')
    const rect = footer.getBoundingClientRect()
    const bounds = stage.getBoundingClientRect()
    return {
      footer: rect.toJSON(),
      stage: bounds.toJSON(),
      visible:
        rect.top >= bounds.top &&
        rect.left >= bounds.left &&
        rect.bottom <= bounds.bottom &&
        rect.right <= bounds.right,
      buttons: [...footer.querySelectorAll('button')].map((button) => {
        const r = button.getBoundingClientRect()
        return {
          label: button.getAttribute('aria-label'),
          hit: button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
        }
      }),
    }
  })
  assert.ok(report.reachability.visible, 'model/parameter/generate row must be inside the interactive canvas stage')
  assert.ok(
    report.reachability.buttons.every((b) => b.hit),
    'each visible footer action must be hit-testable',
  )
  assert.equal(provider.hits.filter((h) => h.method === 'POST').length, 0, 'landing and selection never generate')
  // Existing single-user-shot semantics: this click is the approval. Never add
  // another confirmation or weaken the Agent/batch confirmation path for a test.
  const generating = win.locator(`[data-node-id="${nodeId}"] [data-generating-placement="surface"]`)
  await win.locator('[data-bar-segment="generate"]').click()
  const generatingProof = await proveProbe(generating, 'clicked shot entered the real generating/reveal surface')
  await win.waitForFunction(
    (id) => Boolean(window.__nomiCanvasStore.getState().nodes.find((n) => n.id === id)?.result?.url),
    nodeId,
    { timeout: stationTimeout({ operations: 4 }) },
  )
  report.completed = await win.evaluate(() =>
    window.__nomiCanvasStore
      .getState()
      .nodes.map((n) => ({ id: n.id, kind: n.kind, status: n.status, result: n.result })),
  )
  assert.equal(report.completed.filter((n) => n.result?.url).length, 1, 'only the clicked shot generates')
  assert.equal(report.completed.find((n) => n.result?.url).id, nodeId, 'result lands on the same selected node')
  assert.equal(provider.hits.filter((h) => h.method === 'POST').length, 1, 'one generate click submits exactly once')
  await win.waitForFunction(
    () => {
      const footer = document.querySelector('[data-node-composer-footer]')
      if (!footer) return false
      return [...footer.querySelectorAll('button')].every((button) => {
        const r = button.getBoundingClientRect()
        return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
      })
    },
    {},
    { timeout: stationTimeout() },
  )
  report.controlsAfterResult = await win
    .locator('[data-node-composer-footer]')
    .evaluate((el) => el.getBoundingClientRect().toJSON())
  await win
    .locator(`[data-node-id="${nodeId}"] [data-node-media-state="ready"]`)
    .waitFor({ timeout: stationTimeout({ operations: 2 }) })
  report.preview = await win.locator(`[data-node-id="${nodeId}"] img`).evaluateAll((images) =>
    images.map((img) => ({
      src: img.getAttribute('src'),
      width: img.naturalWidth,
      height: img.naturalHeight,
      complete: img.complete,
    })),
  )
  await expectAbsent(
    generating,
    { provenBy: generatingProof, message: 'completed image reveal leaves the visible image' },
    stationTimeout({ operations: 2 }),
  )
  await assertCanvasAliases(win, 'generated-result')
  await screenshotSettled(win, { path: out + '/generated.png' })
  await win.reload()
  await win.waitForFunction(
    (id) => Boolean(window.__nomiCanvasStore?.getState().nodes.find((n) => n.id === id)?.result?.url),
    nodeId,
    { timeout: stationTimeout({ operations: 2 }) },
  )
  await assertCanvasAliases(win, 'renderer-reload')
  report.persisted = await win.evaluate(
    (id) => ({ id, url: window.__nomiCanvasStore.getState().nodes.find((n) => n.id === id)?.result?.url }),
    nodeId,
  )
  assert.equal(
    report.persisted.url,
    report.completed.find((n) => n.id === nodeId).result.url,
    'result survives a renderer reload',
  )
  report.providerHits = provider.hits
  console.log(JSON.stringify({ nodes: report.nodes, controls: report.controls }, null, 2))
} catch (e) {
  report.error = String(e.stack ?? e)
  console.error(report.error)
  if (gui) await gui.win.screenshot({ path: out + '/failure.png' }).catch(() => {})
  process.exitCode = 1
} finally {
  report.providerHits = provider?.hits
  fs.writeFileSync(out + '/chain.json', JSON.stringify(report, null, 2))
  await mcp?.terminate()
  await gui?.close()
  await provider?.close()
}
