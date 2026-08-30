import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/react-flow-read-only')
const port = 5291
const harnessUrl = `http://127.0.0.1:${port}/tests/ux/fixtures/react-flow-read-only-harness.html`
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const failures = []
const rendererDiagnostics = []
function check(label, condition, detail = '') {
  console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
})
const viteOutput = []
const keepViteOutput = (chunk) => {
  viteOutput.push(...String(chunk).split('\n').filter((line) => line.trim()))
  if (viteOutput.length > 40) viteOutput.splice(0, viteOutput.length - 40)
}
vite.stdout.on('data', keepViteOutput)
vite.stderr.on('data', keepViteOutput)

const viteFailure = new Promise((_, reject) => {
  vite.once('error', (error) => reject(error))
  vite.once('exit', (code, signal) => {
    reject(new Error(`Vite exited before the harness was ready (code=${code}, signal=${signal})`))
  })
})
let launched
let app
try {
  try {
    await Promise.race([
      expect.poll(async () => {
        try {
          const response = await fetch(harnessUrl, { signal: AbortSignal.timeout(1_500) })
          await response.arrayBuffer()
          return response.ok
        } catch {
          return false
        }
      }, {
        message: `Vite harness did not become ready at ${harnessUrl}`,
        timeout: 45_000,
        intervals: [100, 250, 500, 1_000],
      }).toBe(true),
      viteFailure,
    ])
  } catch (error) {
    throw new Error(`${String(error)}\nVite output:\n${viteOutput.join('\n') || '(none)'}`)
  }
  console.log('  ✓ 只读走查 Vite harness 已就绪')
  let win
  launched = await launchNomiApp({
    name: 'react-flow-read-only',
    env: { NOMI_DESKTOP_DEV: '1', VITE_DEV_SERVER_URL: harnessUrl },
    settleMs: 0,
  })
  ;({ app, win } = launched)
  win.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      rendererDiagnostics.push({ type: `console.${message.type()}`, text: message.text() })
    }
  })
  win.on('pageerror', (error) => rendererDiagnostics.push({ type: 'pageerror', text: String(error) }))
  const source = win.locator('.react-flow__node[data-id="readonly-source"]')
  const target = win.locator('.react-flow__node[data-id="readonly-target"]')
  const group = win.locator('[data-group-id="readonly-group"]')
  await source.waitFor({ state: 'visible', timeout: 15_000 })
  await target.waitFor({ state: 'visible', timeout: 15_000 })
  await group.waitFor({ state: 'visible', timeout: 15_000 })
  const canvasProbe = await proveProbe(source, '只读画布节点已渲染')

  const initial = await win.evaluate(async () => {
    const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const state = useGenerationCanvasStore.getState()
    return {
      nodes: state.nodes.map((node) => ({ id: node.id, position: node.position })),
      edges: state.edges.map((edge) => edge.id),
      groups: state.groups.map((item) => item.id),
      selected: state.selectedNodeIds,
    }
  })
  check('只读画布仍渲染节点、边和编组', initial.nodes.length === 2 && initial.edges.length === 1 && initial.groups.length === 1, JSON.stringify(initial))
  check('只读画布不显示新增工具栏', await win.locator('.generation-canvas-v2-toolbar').count() === 0)
  check('只读画布不暴露素材导入落点', await win.locator('[data-nomi-generation-canvas-import-target]').count() === 0)
  const interactionSurface = await source.evaluate((element) => ({
    className: element.className,
    handles: element.querySelectorAll('.generation-canvas-react-flow__handle').length,
  }))
  await expectAbsent(win.locator('.generation-canvas-v2-toolbar'), {
    provenBy: canvasProbe,
    message: '只读画布不显示新增工具栏',
  })
  await expectAbsent(win.locator('[data-nomi-generation-canvas-import-target]'), {
    provenBy: canvasProbe,
    message: '只读画布不暴露素材导入落点',
  })
  await expectAbsent(win.locator('.generation-canvas-v2__edge-hit'), {
    provenBy: canvasProbe,
    message: '只读边不渲染可点击命中层',
  })
  check('React Flow 节点关闭拖动与连接', !interactionSurface.className.includes('draggable') && interactionSurface.handles === 0, JSON.stringify(interactionSurface))
  check('只读边不渲染可点击命中层', await win.locator('.generation-canvas-v2__edge-hit').count() === 0)

  const sourceBefore = await source.boundingBox()
  await win.mouse.move(sourceBefore.x + sourceBefore.width / 2, sourceBefore.y + sourceBefore.height / 2)
  await win.mouse.down()
  await win.mouse.move(sourceBefore.x + sourceBefore.width / 2 + 150, sourceBefore.y + sourceBefore.height / 2 + 90, { steps: 10 })
  await win.mouse.up()
  await source.click()
  await win.keyboard.press('Delete')
  await source.click({ button: 'right' })

  const groupBefore = await group.boundingBox()
  await win.mouse.move(groupBefore.x + 18, groupBefore.y + groupBefore.height - 18)
  await win.mouse.down()
  await win.mouse.move(groupBefore.x + 110, groupBefore.y + groupBefore.height + 45, { steps: 8 })
  await win.mouse.up()

  const afterInteractions = await win.evaluate(async () => {
    const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const state = useGenerationCanvasStore.getState()
    return {
      nodes: state.nodes.map((node) => ({ id: node.id, position: node.position })),
      edges: state.edges.map((edge) => edge.id),
      groups: state.groups.map((item) => item.id),
      selected: state.selectedNodeIds,
      menus: document.querySelectorAll('.generation-canvas-v2__context-node-menu, .generation-canvas-v2__node-context-menu').length,
    }
  })
  await expectAbsent(win.locator('.generation-canvas-v2__context-node-menu, .generation-canvas-v2__node-context-menu'), {
    provenBy: canvasProbe,
    message: '只读点击不创建右键菜单',
  })
  check('真实鼠标与键盘操作不能改变只读图状态', JSON.stringify(afterInteractions.nodes) === JSON.stringify(initial.nodes) && JSON.stringify(afterInteractions.edges) === JSON.stringify(initial.edges) && JSON.stringify(afterInteractions.groups) === JSON.stringify(initial.groups), JSON.stringify(afterInteractions))
  check('只读点击不创建选择或右键菜单', afterInteractions.selected.length === 0 && afterInteractions.menus === 0, JSON.stringify(afterInteractions))
  await screenshotSettled(win, { path: path.join(shotsDir, '01-read-only.png') })

  await win.reload({ waitUntil: 'domcontentloaded' })
  await source.waitFor({ state: 'visible', timeout: 15_000 })
  const afterReload = await win.evaluate(async () => {
    const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const state = useGenerationCanvasStore.getState()
    return { nodes: state.nodes.length, edges: state.edges.length, groups: state.groups.length }
  })
  const reloadProbe = await proveProbe(win.locator('.react-flow__node[data-id="readonly-source"]'), '刷新后只读节点仍已渲染')
  await expectAbsent(win.locator('.generation-canvas-v2-toolbar, [data-nomi-generation-canvas-import-target]'), {
    provenBy: reloadProbe,
    message: '刷新后仍无编辑入口',
  })
  check('刷新后只读投影完整恢复', afterReload.nodes === 2 && afterReload.edges === 1 && afterReload.groups === 1, JSON.stringify(afterReload))
  check('刷新后仍无编辑入口', await win.locator('.generation-canvas-v2-toolbar, [data-nomi-generation-canvas-import-target]').count() === 0)
  await screenshotSettled(win, { path: path.join(shotsDir, '02-after-reload.png') })
} catch (error) {
  failures.push(String(error))
  console.error(error)
  const liveWindow = app?.windows().find((candidate) => !candidate.isClosed())
  if (liveWindow) {
    const failureState = await liveWindow.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 2_000) || '',
      bodyHtml: document.body?.innerHTML?.slice(0, 4_000) || '',
    })).catch((stateError) => ({ stateError: String(stateError) }))
    fs.writeFileSync(
      path.join(shotsDir, '99-failure.json'),
      `${JSON.stringify({ error: String(error), failureState, rendererDiagnostics }, null, 2)}\n`,
    )
    await liveWindow.screenshot({ path: path.join(shotsDir, '99-failure.png') }).catch(() => {})
    console.error(JSON.stringify({ failureState, rendererDiagnostics }, null, 2))
  }
} finally {
  await launched?.close().catch(() => {})
  if (vite.exitCode === null && vite.signalCode === null) vite.kill('SIGTERM')
}

console.log(failures.length ? `\n❌ ${failures.length} 项失败:\n - ${failures.join('\n - ')}` : '\n✅ React Flow 只读与刷新走查通过')
process.exit(failures.length ? 1 : 0)
