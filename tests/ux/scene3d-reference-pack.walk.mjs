// 真机走查：3D 导演台参考包出口。
// 铺好一个 scene3d → Seedance omni 视频镜头的最小画布，然后真实点击：
// 打开 3D 编辑器 → 选相机 → 点「推近」→ 点「导出运镜首尾帧」。
// 再真实点击「操控」→「录 take」→ 停止，等本地 mp4 写入目标视频节点 referenceVideoUrls。
// 硬证据：UI 显示 video_ref 目标；画布 store 里生成首/尾帧图片节点，并自动接到视频节点 first_frame/last_frame；
// 录 take 出片后目标视频节点拿到 referenceVideoUrls。
// 零额度：纯本地 3D 截图，不碰任何生成 API。
// 用法：pnpm run build && node tests/ux/scene3d-reference-pack.walk.mjs
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import path from 'node:path'
import os from 'node:os'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import { screenshotSettled } from './_assert.mjs'

const outDir = path.join(repoRoot, '.scene3d-reference-pack-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-scene3d-ref-pack-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.destroy()
        resolve(true)
      })
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('vite 未就绪'))
        else setTimeout(tick, 400)
      })
      req.setTimeout(1500, () => { req.destroy() })
    }
    tick()
  })
}

const devPort = await findFreePort()
const devUrl = `http://127.0.0.1:${devPort}`
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(devPort), '--strictPort'], {
  cwd: repoRoot,
  env: { ...process.env },
  stdio: 'ignore',
})
await waitForUrl(devUrl, 60000)

const { app, win } = await launchNomiApp({
  name: 'scene3d-reference-pack',
  userDataDir: path.join(tmp, 'udata'),
  projectsDir,
  env: {
    NOMI_DESKTOP_DEV: '1',
    VITE_DEV_SERVER_URL: devUrl,
    NOMI_E2E_SMOKE: '1',
  },
  settleMs: 0,
})

const log = (m) => console.log(m)
const errors = []
const pass = {
  projectOpen: false,
  storeReady: false,
  injected: false,
  editorOpen: false,
  cameraSelected: false,
  referencePanel: false,
  moveApplied: false,
  framesConnected: false,
  framesVisible: false,
  takeVideoRefAttached: false,
  takeVideoVisible: false,
}

async function closeApp() {
  const process = app.process()
  await Promise.race([
    app.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ])
  if (process.exitCode === null) process.kill('SIGKILL')
}

async function dismiss(win) {
  await win.keyboard.press('Escape').catch(() => {})
  const splashSkip = win.locator('[data-splash-skip="true"]').first()
  if ((await splashSkip.count()) > 0) await splashSkip.click().catch(() => {})
  await win.locator('.nomi-splash').first().waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})
}

async function waitForCanvasStore(win) {
  for (let i = 0; i < 20; i += 1) {
    const ready = await win.evaluate(async () => {
      try {
        const m = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
        return Boolean(m.useGenerationCanvasStore?.getState)
      } catch {
        return false
      }
    }).catch(() => false)
    if (ready) return true
    await win.waitForTimeout(500)
  }
  return false
}

try {
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.evaluate(() => {
    try {
      localStorage.setItem('__nomiE2E', '1')
      localStorage.setItem('nomi-color-scheme', 'light')
    } catch {}
  })
  await win.waitForTimeout(1800)
  await dismiss(win)

  const card = win.locator('[data-project-card]').first()
  if ((await card.count()) > 0) await card.click()
  else {
    const blank = win.getByText('新建空白项目', { exact: false }).first()
    if ((await blank.count()) > 0) await blank.click()
  }
  await win.waitForTimeout(2500)
  await dismiss(win)
  pass.projectOpen = /projectId=/.test(win.url()) || (await win.getByRole('button', { name: '生成', exact: false }).count()) > 0
  log(`  ${pass.projectOpen ? '✓' : '✗'} 进入隔离项目`)

  const genTab = win.getByRole('button', { name: '生成', exact: false }).first()
  if ((await genTab.count()) > 0) await genTab.click()
  await win.waitForTimeout(1500)
  pass.storeReady = await waitForCanvasStore(win)
  log(`  ${pass.storeReady ? '✓' : '✗'} 画布 E2E store bridge 就绪`)
  if (!pass.storeReady) throw new Error('画布 store 未暴露')

  const ids = await win.evaluate(async () => {
    const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const state = useGenerationCanvasStore.getState()
    const scene = state.addNode({
      kind: 'scene3d',
      title: '导演参考台',
      categoryId: 'shots',
      position: { x: 160, y: 180 },
      exactPosition: true,
      select: false,
    })
    const target = state.addNode({
      kind: 'video',
      title: '镜头 01',
      prompt: '一名角色在城市街口向镜头走来，保持构图与机位。',
      categoryId: 'shots',
      position: { x: 920, y: 180 },
      exactPosition: true,
      select: false,
      meta: {
        modelVendor: 'apimart',
        modelKey: 'doubao-seedance-2.0',
        archetype: { id: 'seedance-2-apimart', modeId: 'omni', variantId: 'standard' },
      },
    })
    state.connectNodes(scene.id, target.id, 'reference')
    state.setCanvasTransform(1, { x: 0, y: 0 })
    return { sceneId: scene.id, targetId: target.id }
  })
  pass.injected = Boolean(ids?.sceneId && ids?.targetId)
  log(`  ${pass.injected ? '✓' : '✗'} 注入导演台 + video_ref 目标 (${ids.sceneId} → ${ids.targetId})`)

  const sceneNode = win.locator(`[data-node-id="${ids.sceneId}"]`)
  await sceneNode.waitFor({ state: 'visible', timeout: 8000 })
  await screenshotSettled(win, { path: path.join(outDir, '01-canvas-seeded.png') })
  const openEditor = sceneNode.getByRole('button', { name: '打开 3D 编辑器', exact: false })
  await openEditor.first().click({ timeout: 5000 })
  await win.waitForTimeout(4500)
  pass.editorOpen = (await win.locator('[aria-label="3D 场景编辑器"]').count()) > 0
  log(`  ${pass.editorOpen ? '✓' : '✗'} 点击打开 3D 编辑器`)

  // 首次进入的 coach marks 会遮住相机行；本旅程聚焦参考包出口，显式跳过后再操作。
  const coachSkip = win.getByRole('button', { name: '跳过', exact: true }).first()
  if ((await coachSkip.count()) > 0) {
    await coachSkip.click()
    await win.waitForTimeout(500)
  }

  const cameraRow = win.getByRole('button', { name: '相机1', exact: true }).first()
  await cameraRow.click({ timeout: 8000 })
  await win.waitForTimeout(700)
  pass.cameraSelected = (await win.getByText('FOV', { exact: false }).count()) > 0
    || (await win.getByText('运镜预设', { exact: true }).count()) > 0
  log(`  ${pass.cameraSelected ? '✓' : '✗'} 选中相机并显示运镜属性`)

  const referencePanel = win.locator('[data-scene3d-reference-panel]').first()
  await referencePanel.waitFor({ state: 'attached', timeout: 5000 })
  await referencePanel.scrollIntoViewIfNeeded({ timeout: 5000 })
  await win.waitForTimeout(500)
  await referencePanel.waitFor({ state: 'visible', timeout: 5000 })
  const targetLabel = await win.locator('[data-scene3d-reference-target]').first().innerText()
  pass.referencePanel = /video_ref/.test(targetLabel) && /镜头 01/.test(targetLabel)
  await screenshotSettled(win, { path: path.join(outDir, '02-camera-reference-panel.png') })
  log(`  ${pass.referencePanel ? '✓' : '✗'} 参考输出面板指向 video_ref (${targetLabel})`)

  const pushIn = win.getByRole('button', { name: '推近', exact: true }).first()
  await pushIn.click({ timeout: 5000 })
  await win.waitForTimeout(900)
  pass.moveApplied = await win.evaluate(async () => {
    const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const nodes = useGenerationCanvasStore.getState().nodes
    const scene = nodes.find((node) => node.title === '导演参考台')
    const state = scene?.meta?.scene3dState
    return Array.isArray(state?.trajectories) && state.trajectories.length > 0
      && Array.isArray(state?.trajectoryBindings) && state.trajectoryBindings.length > 0
  })
  log(`  ${pass.moveApplied ? '✓' : '✗'} 点击「推近」后生成相机轨迹`)

  const exportFrames = win.getByRole('button', { name: '导出运镜首尾帧', exact: true }).first()
  await exportFrames.click({ timeout: 5000 })
  await win.waitForTimeout(3500)
  await screenshotSettled(win, { path: path.join(outDir, '03-after-export-frames.png') })
  const frameState = await win.evaluate(async (targetId) => {
    const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
    const state = useGenerationCanvasStore.getState()
    const incoming = state.edges.filter((edge) => edge.target === targetId)
    const first = incoming.find((edge) => edge.mode === 'first_frame')
    const last = incoming.find((edge) => edge.mode === 'last_frame')
    const imageSources = new Set(state.nodes.filter((node) => node.kind === 'image').map((node) => node.id))
    return {
      imageCount: imageSources.size,
      firstConnected: Boolean(first && imageSources.has(first.source)),
      lastConnected: Boolean(last && imageSources.has(last.source)),
      firstSourceId: first?.source || null,
      lastSourceId: last?.source || null,
      modes: incoming.map((edge) => edge.mode).sort(),
    }
  }, ids.targetId)
  pass.framesConnected = Boolean(frameState.firstConnected && frameState.lastConnected && frameState.imageCount >= 2)
  log(`  ${pass.framesConnected ? '✓' : '✗'} 首/尾帧图片自动接入视频节点 (${frameState.modes.join(', ')})`)

  const possessCamera = win.getByRole('button', { name: '操控', exact: true }).first()
  await possessCamera.click({ timeout: 8000 })
  await win.waitForTimeout(900)
  const cameraToolbar = win.locator('[aria-label="镜头操控工具栏"]').first()
  await cameraToolbar.waitFor({ state: 'visible', timeout: 8000 })

  const recBtn = win.locator('[title^="录 take"]').first()
  await recBtn.click({ timeout: 5000 })
  await win.waitForTimeout(500)
  const stopBtn = win.locator('[title="停止录制并生成参考视频"]').first()
  await stopBtn.waitFor({ state: 'visible', timeout: 5000 })
  await win.keyboard.down('KeyW')
  await win.waitForTimeout(2200)
  await win.keyboard.up('KeyW')
  await win.waitForTimeout(400)
  await screenshotSettled(win, { path: path.join(outDir, '04-recording-take.png') })
  await stopBtn.click({ timeout: 5000 })
  await win.waitForTimeout(1400)

  let attachedState = null
  for (let i = 0; i < 45; i += 1) {
    attachedState = await win.evaluate(async (targetId) => {
      const { useGenerationCanvasStore } = await import('/src/workbench/generationCanvas/store/generationCanvasStore.ts')
      const state = useGenerationCanvasStore.getState()
      const target = state.nodes.find((node) => node.id === targetId)
      const takeNodes = state.nodes.filter((node) => node.title === '录制走位参考')
      const targetVideoUrls = Array.isArray(target?.meta?.referenceVideoUrls) ? target.meta.referenceVideoUrls : []
      return {
        targetVideoUrls,
        targetAttachedUrl: typeof target?.meta?.cameraMoveAttachedUrl === 'string'
          ? target.meta.cameraMoveAttachedUrl
          : '',
        targetModeId: target?.meta?.archetype?.modeId,
        takeCount: takeNodes.length,
        takeStatuses: takeNodes.map((node) => ({
          hasAutoCapture: Boolean(node.meta?.cameraMoveAutoCapture),
          hasVideo: Boolean(node.meta?.cameraMoveVideo),
        })),
      }
    }, ids.targetId)
    if (
      attachedState?.targetVideoUrls?.length > 0
      && attachedState.targetVideoUrls.includes(attachedState.targetAttachedUrl)
    ) break
    await win.waitForTimeout(2000)
  }
  await screenshotSettled(win, { path: path.join(outDir, '05-after-record-take.png') })
  pass.takeVideoRefAttached = Boolean(
    attachedState?.targetVideoUrls?.length > 0 &&
    attachedState.targetVideoUrls.includes(attachedState.targetAttachedUrl) &&
    attachedState?.targetModeId === 'omni' &&
    attachedState?.takeCount > 0,
  )
  log(
    `  ${pass.takeVideoRefAttached ? '✓' : '✗'} 录 take 参考视频写入 video_ref ` +
    `(urls=${attachedState?.targetVideoUrls?.length ?? 0}, takes=${attachedState?.takeCount ?? 0}, mode=${attachedState?.targetModeId ?? 'n/a'})`,
  )

  // 关闭全屏后检查用户实际看见的画布结果：首尾帧必须是有真实 <img> 的标准图片节点，
  // take 节点必须直接显示可播放视频，而不是只剩一个“已生成”状态条。
  const editor = win.locator('[aria-label="3D 场景编辑器"]')
  const close = editor.locator('[title="退出 3D 场景"]').first()
  await close.waitFor({ state: 'visible', timeout: 5000 })
  await close.click()
  await editor.waitFor({ state: 'hidden', timeout: 5000 })
  await win.waitForTimeout(2600)

  const frameIds = [frameState.firstSourceId, frameState.lastSourceId].filter(Boolean)
  const frameImagesLoaded = []
  for (const frameId of frameIds) {
    const image = win.locator(`[data-node-id="${frameId}"] img`).first()
    await image.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
    frameImagesLoaded.push(
      (await image.count()) > 0 && await image.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0).catch(() => false),
    )
  }
  pass.framesVisible = frameImagesLoaded.length === 2 && frameImagesLoaded.every(Boolean)

  const takeVideo = win.locator('[data-scene3d-take-video="true"]').first()
  await takeVideo.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  pass.takeVideoVisible = (await takeVideo.count()) > 0
    && await takeVideo.evaluate((video) => video instanceof HTMLVideoElement && video.controls).catch(() => false)
  await screenshotSettled(win, { path: path.join(outDir, '06-canvas-reference-media-visible.png') })
  log(`  ${pass.framesVisible ? '✓' : '✗'} 首/尾帧图片节点在画布中真实可见`)
  log(`  ${pass.takeVideoVisible ? '✓' : '✗'} take 节点在画布中显示可播放视频`)

  log('\n═══ 结果 ═══')
  log(`  隔离项目:              ${pass.projectOpen ? '✓' : '✗'}`)
  log(`  store bridge:          ${pass.storeReady ? '✓' : '✗'}`)
  log(`  注入画布夹具:          ${pass.injected ? '✓' : '✗'}`)
  log(`  打开导演台:            ${pass.editorOpen ? '✓' : '✗'}`)
  log(`  选中相机:              ${pass.cameraSelected ? '✓' : '✗'}`)
  log(`  UI 显示 video_ref:     ${pass.referencePanel ? '✓' : '✗'}`)
  log(`  推近运镜落轨迹:        ${pass.moveApplied ? '✓' : '✗'}`)
  log(`  首尾帧自动连视频槽:    ${pass.framesConnected ? '✓' : '✗'}`)
  log(`  首尾帧图片真实可见:    ${pass.framesVisible ? '✓' : '✗'}`)
  log(`  录 take 写入 video_ref: ${pass.takeVideoRefAttached ? '✓' : '✗'}`)
  log(`  take 卡内视频可播:      ${pass.takeVideoVisible ? '✓' : '✗'}`)
  log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors')

  const ok = Object.values(pass).every(Boolean)
  await closeApp()
  vite.kill('SIGTERM')
  process.exit(ok ? 0 : 1)
} catch (err) {
  log(`\nFAIL: ${err?.message || err}`)
  try {
    const win = await app.firstWindow()
    await win.screenshot({ path: path.join(outDir, 'FAIL.png') })
  } catch {}
  await closeApp()
  vite.kill('SIGTERM')
  process.exit(1)
}
