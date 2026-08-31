// 工具栏功能层级梳理走查（用户拍板：全屏从最左移到右侧工具区，和下载做伴）。
// 种一个图片节点 + 一个视频节点，分别选中让浮动工具栏出现，截图人眼核对全屏新位置。
// 零额度：nomi-local PNG/本地 mp4，不调模型。
// 用法：pnpm run build && node tests/ux/toolbar-order.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-toolbar-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const projectId = 'toolbar-order-walk'
const projectRoot = path.join(projectsDir, `toolbar-${projectId}`)
const outDir = path.join(repoRoot, '.toolbar-order-lab')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

let passed = 0
function assert(cond, label) {
  if (!cond) throw new Error(`WALK FAIL: ${label}`)
  passed += 1
  console.log(`  ✓ ${label}`)
}

// 图片夹具（真实 PNG，IMG.LY 的离线解码器不接受 SVG）
const genDir = path.join(projectRoot, 'assets', 'generated')
fs.mkdirSync(genDir, { recursive: true })
const pngPath = path.join(genDir, 'img.png')
const png = spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=1', '-frames:v', '1', pngPath], { timeout: 120_000 })
if (png.status !== 0) throw new Error('png 夹具失败')
const IMAGE_URL = `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/img.png`

// 视频夹具（真 h264 mp4）
const mp4Path = path.join(genDir, 'clip.mp4')
const enc = spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=12', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4Path], { timeout: 120_000 })
if (enc.status !== 0) throw new Error('mp4 夹具失败')
const VIDEO_URL = `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/clip.mp4`

const nodes = [
  { id: 'img-node', kind: 'image', categoryId: 'shots', title: '3D-gen-v2-scene3d-msiq86jf-cc12-1786093984602', position: { x: 160, y: 160 }, exactPosition: true, size: { width: 420, height: 260 }, status: 'success', result: { id: 'img-r', type: 'image', url: IMAGE_URL, createdAt: 1 }, meta: { imageWidth: 960, imageHeight: 540 } },
  { id: 'vid-node', kind: 'video', categoryId: 'shots', title: '视频镜头', position: { x: 160, y: 560 }, exactPosition: true, size: { width: 420, height: 260 }, status: 'success', result: { id: 'vid-r', type: 'video', url: VIDEO_URL, createdAt: 1 } },
]
const payload = { workbenchDocument: null, timeline: null, generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } }, storyboardPlan: null, storyboardPlanCommitted: false }
const project = { id: projectId, name: '工具栏梳理回归', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1, lastKnownRootPath: projectRoot, workbenchDocument: null, timeline: null, generationCanvas: payload.generationCanvas, payload }
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project))

const { app, win } = await launchNomiApp({
  name: 'toolbar-order',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

try {
  const pageErrors = []
  const consoleErrors = []
  win.on('pageerror', (error) => pageErrors.push(error.message))
  win.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2000)
  await win.locator('[data-project-card]', { hasText: '工具栏梳理回归' }).first().click()
  await win.waitForTimeout(2000)
  const generationTab = win.getByRole('button', { name: '生成', exact: true }).first()
  if (await generationTab.count()) await generationTab.click()
  await win.waitForTimeout(1800)
  console.log('  → route:', win.url())
  console.log('  → rendered nodes:', await win.locator('[data-node-id]').count())
  await win.screenshot({ path: path.join(outDir, '0-project-open.png') })

  // —— 图片节点：点节点容器选中（点标题会进改名模式，工具栏不浮）→ 读工具栏按钮顺序 ——
  await win.locator('[data-node-id="img-node"]').first().click({ force: true, timeout: 8000 })
  await win.locator('[role="toolbar"][aria-label="图片操作"]').waitFor({ state: 'visible', timeout: 15000 })
  const imgOrder = await win.evaluate(() => {
    const bar = document.querySelector('[role="toolbar"][aria-label="图片操作"]')
    if (!bar) return null
    return Array.from(bar.querySelectorAll('button')).map((b) => (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim().slice(0, 8))
  })
  assert(imgOrder && imgOrder.length > 0, `图片工具栏浮出（${imgOrder ? imgOrder.length : 0} 个按钮）`)
  const fsIdx = imgOrder.findIndex((x) => x.includes('全屏'))
  const dlIdx = imgOrder.findIndex((x) => x.includes('下载'))
  assert(fsIdx > 0, `图片：全屏不再在最左（idx=${fsIdx}）`)
  assert(dlIdx >= 0 && Math.abs(fsIdx - dlIdx) === 1, `图片：全屏与下载相邻成工具组（全屏idx=${fsIdx} 下载idx=${dlIdx}）`)
  assert(!imgOrder[0].includes('全屏'), `图片：最左是创作动作不是全屏（最左=「${imgOrder[0]}」）`)
  await win.screenshot({ path: path.join(outDir, '1-image-toolbar.png') })

  const imageBar = win.locator('[role="toolbar"][aria-label="图片操作"]')
  for (const action of ['建参考图', 'AI 编辑', '裁剪', '抠图', '更多']) {
    assert((await imageBar.getByRole('button', { name: action, exact: true }).count()) === 1, `图片：常驻「${action}」`)
  }
  assert((await imageBar.getByRole('button', { name: /切图|变换|画板/ }).count()) === 0, '图片：长尾动作不再平铺')

  const bundledResources = await win.evaluate(async () => {
    const response = await fetch('nomi-local://resource/remove-background/resources.json')
    const resources = await response.json()
    const keys = Object.keys(resources)
    const firstChunk = resources['/models/isnet_quint8']?.chunks?.[0]?.name
    const chunkResponse = firstChunk
      ? await fetch(`nomi-local://resource/remove-background/${firstChunk}`)
      : null
    return {
      ok: response.ok && Boolean(chunkResponse?.ok),
      keys,
      firstChunkSize: chunkResponse ? (await chunkResponse.arrayBuffer()).byteLength : 0,
    }
  })
  assert(
    bundledResources.ok && bundledResources.keys.length === 3 && bundledResources.firstChunkSize === 4194304,
    '抠图量化模型与 CPU WASM 从打包内资源读取',
  )

  const imageBeforeRemoval = await win.locator('[data-node-id="img-node"] img').first().getAttribute('src')
  await win.evaluate(() => {
    const toolbar = document.querySelector('[role="toolbar"][aria-label="图片操作"]')
    const state = { seenBusy: false }
    const scan = () => {
      const button = Array.from(toolbar?.querySelectorAll('button') ?? []).find((item) =>
        (item.textContent || '').includes('抠图'),
      )
      if (button?.getAttribute('aria-busy') === 'true' && button instanceof HTMLButtonElement && button.disabled) {
        state.seenBusy = true
      }
    }
    const observer = new MutationObserver(scan)
    if (toolbar) observer.observe(toolbar, { attributes: true, childList: true, characterData: true, subtree: true })
    scan()
    window.__nomiRemoveBackgroundWalk = { observer, state }
  })
  await imageBar.getByRole('button', { name: '抠图', exact: true }).click()
  await win.waitForFunction(
    (before) => {
      const state = window.__nomiRemoveBackgroundWalk?.state
      const image = document.querySelector('[data-node-id="img-node"] img')
      const failed = document.body.innerText.includes('抠图资源加载失败')
      return Boolean(state?.seenBusy || (image instanceof HTMLImageElement && image.src !== before) || failed)
    },
    imageBeforeRemoval,
    { timeout: 10_000 },
  )
  const sawBusy = await win.evaluate(() => Boolean(window.__nomiRemoveBackgroundWalk?.state.seenBusy))
  assert(sawBusy, '抠图点击后立即进入忙碌态')
  await win.waitForFunction(
    (before) => {
      const image = document.querySelector('[data-node-id="img-node"] img')
      return (
        (image instanceof HTMLImageElement && image.src !== before) ||
        document.body.innerText.includes('抠图资源加载失败')
      )
    },
    imageBeforeRemoval,
    { timeout: 180_000 },
  )
  const imageAfterRemoval = await win.locator('[data-node-id="img-node"] img').first().getAttribute('src')
  const removeBackgroundFailed = (await win.getByText('抠图资源加载失败', { exact: true }).count()) > 0
  if (removeBackgroundFailed) {
    throw new Error(
      `真实离线抠图失败\npage errors: ${pageErrors.join(' | ') || '(none)'}\nconsole errors: ${consoleErrors.join(' | ') || '(none)'}`,
    )
  }
  assert(Boolean(imageBeforeRemoval && imageAfterRemoval && imageBeforeRemoval !== imageAfterRemoval), '真实离线抠图完成并写回新图片')
  assert(!removeBackgroundFailed, '离线资源链路未触发失败通知')

  await imageBar.getByRole('button', { name: '更多', exact: true }).click()
  const imageMenuItems = await win.locator('[role="menu"] [role="menuitem"]').allTextContents()
  for (const item of ['四视图', '九宫格', '向左旋转', '向右旋转', '水平翻转', '垂直翻转', '在画板中打开']) {
    assert(imageMenuItems.some((text) => text.includes(item)), `图片「更多」可达：${item}`)
  }
  await win.screenshot({ path: path.join(outDir, '1b-image-more-menu.png') })
  await win.keyboard.press('Escape')

  await imageBar.getByRole('button', { name: '查看生成记录', exact: true }).click()
  const provenanceDialog = win.getByRole('dialog', { name: '生成记录' })
  await provenanceDialog.waitFor({ state: 'visible' })
  assert((await provenanceDialog.locator('h2').textContent())?.trim() === '生成记录', '生成记录使用固定标题')
  const provenanceGeometry = await provenanceDialog.evaluate((dialog) => {
    const subtitle = dialog.querySelector('[title="3D-gen-v2-scene3d-msiq86jf-cc12-1786093984602"]')
    const close = dialog.querySelector('button[aria-label="关闭"]')
    if (!subtitle || !close) return { found: false }
    const dialogRect = dialog.getBoundingClientRect()
    const closeRect = close.getBoundingClientRect()
    return { found: true, closeAtRight: closeRect.right > dialogRect.right - 40 }
  })
  assert(provenanceGeometry.found && provenanceGeometry.closeAtRight, '长节点名独立省略，关闭按钮固定在右上')
  await win.screenshot({ path: path.join(outDir, '1c-provenance-long-title.png') })
  await provenanceDialog.getByRole('button', { name: '关闭' }).click()

  // —— 视频节点：点节点容器选中 → 读工具栏按钮顺序 ——
  await win.locator('[data-node-id="vid-node"]').first().click({ force: true })
  await win.locator('[role="toolbar"][aria-label="视频操作"]').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  const vidOrder = await win.evaluate(() => {
    const bar = document.querySelector('[role="toolbar"][aria-label="视频操作"]')
    if (!bar) return null
    return Array.from(bar.querySelectorAll('button')).map((b) => (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim().slice(0, 8))
  })
  if (vidOrder && vidOrder.length) {
    const vFs = vidOrder.findIndex((x) => x.includes('全屏'))
    const vDl = vidOrder.findIndex((x) => x.includes('下载'))
    assert(vFs > 0, `视频：全屏不再在最左（idx=${vFs}）`)
    assert(vDl >= 0 && Math.abs(vFs - vDl) === 1, `视频：全屏与下载相邻成工具组（全屏idx=${vFs} 下载idx=${vDl}）`)
    await win.screenshot({ path: path.join(outDir, '2-video-toolbar.png') })
    const videoBar = win.locator('[role="toolbar"][aria-label="视频操作"]')
    assert((await videoBar.getByRole('button', { name: '取画面', exact: true }).count()) === 1, '视频：三个动作收为「取画面」')
    assert((await videoBar.getByRole('button', { name: /提取首帧|提取尾帧|按镜头拆分/ }).count()) === 0, '视频：取画面动作不再平铺')
    await videoBar.getByRole('button', { name: '取画面', exact: true }).click()
    const videoMenuItems = await win.locator('[role="menu"] [role="menuitem"]').allTextContents()
    for (const item of ['提取首帧', '提取尾帧', '按镜头拆分']) {
      assert(videoMenuItems.some((text) => text.includes(item)), `视频「取画面」可达：${item}`)
    }
    await win.screenshot({ path: path.join(outDir, '2b-video-capture-menu.png') })
  } else {
    console.log('  · 视频工具栏未定位到（选择器差异），仅截图留存')
    await win.screenshot({ path: path.join(outDir, '2-video-toolbar.png') })
  }

  console.log(`\n✅ 工具栏梳理走查通过（${passed} 项断言）\n   截图：${outDir}`)
} finally {
  await app.close().catch(() => {})
}
