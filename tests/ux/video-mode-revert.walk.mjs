// I-canvas-revert-h：视频档案断开最后一张首帧参考后，生成框回到文生视频。
// 用法：NOMI_WALK_LANG=zh|en node tests/ux/video-mode-revert.walk.mjs

import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { launchNomiApp, currentCatalogVersion } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { expect, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { canvasFitViewButton, newProjectEntry, switchWorkspace } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = process.cwd()
const locale = process.env.NOMI_WALK_LANG === 'en' ? 'en' : 'zh-CN'
const languageTag = locale === 'en' ? 'en' : 'zh'
const generateLabel = uiText(locale, 'generationCommon.composer.generate')
const tempRoot = path.join(repoRoot, '.tmp', 'nomi-video-mode-revert-' + languageTag)
const settingsDir = path.join(tempRoot, 'settings')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/video-mode-revert', languageTag)
for (const dir of [tempRoot, settingsDir, shotsDir]) {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

const catalogNow = '2026-10-25T00:00:00.000Z'
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: currentCatalogVersion(),
  vendors: [{
    key: 'ux-local', name: 'UX Local', enabled: true, authType: 'none', providerKind: 'openai-compatible',
    createdAt: catalogNow, updatedAt: catalogNow,
  }],
  models: [{
    vendorKey: 'ux-local', modelKey: 'kling-3.0', labelZh: 'Kling 3.0', kind: 'video', enabled: true,
    createdAt: catalogNow, updatedAt: catalogNow,
    meta: {
      archetypeId: 'kling-3.0',
      adapter: {
        state: 'verified', activeRevision: 'ux-video-mode-revert', publicationModes: ['text_to_video', 'image_to_video'],
        modes: [{ taskKind: 'text_to_video', state: 'verified' }, { taskKind: 'image_to_video', state: 'verified' }],
      },
    },
  }],
  mappings: [],
  apiKeysByVendor: {},
}, null, 2))

const failures = []
const check = (name, ok, detail = '') => {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failures.push(name + (detail ? ' — ' + detail : ''))
}

const vite = await createServer({ root: repoRoot, server: { host: '127.0.0.1', port: 0 } })
let app
try {
  await vite.listen()
  const baseUrl = 'http://127.0.0.1:' + vite.httpServer.address().port
  let win
  ;({ app, win } = await launchNomiApp({
    name: 'video-mode-revert-' + languageTag,
    userDataDir: path.join(tempRoot, 'user-data'),
    settingsDir,
    projectsDir: path.join(tempRoot, 'projects'),
    env: { NOMI_DESKTOP_DEV: '1', VITE_DEV_SERVER_URL: baseUrl },
    initialLocalStorage: {
      'nomi:locale:v1': locale,
      'nomi-color-scheme': 'dark',
      'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen',
      __nomiE2E: '1',
    },
    settleMs: 0,
  }))
  win.setDefaultTimeout(stationTimeout())
  await win.evaluate(() => {
    localStorage.setItem('__nomiE2E', '1')
    localStorage.setItem('nomi-color-scheme', 'dark')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  await newProjectEntry(win).waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
  await newProjectEntry(win).click({ noWaitAfter: true })
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: stationTimeout({ operations: 2 }) })
  await switchWorkspace(win, 'generation', '生成工作区')
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: stationTimeout({ operations: 2 }) })

  const catalogSeeded = await win.evaluate(async () => {
    const desktop = window.nomiDesktop
    if (!desktop?.modelCatalog) return { error: '模型目录 bridge 不存在' }
    const model = (await desktop.modelCatalog.listModels({ vendorKey: 'ux-local' }))
      .find((candidate) => candidate.modelKey === 'kling-3.0')
    if (!model?.publishedModes?.includes('text_to_video') || !model.publishedModes.includes('image_to_video')) {
      return { error: '视频档案发布模式不完整：' + JSON.stringify(model?.publishedModes || []) }
    }
    const { notifyModelOptionsRefresh } = await import('/src/config/modelCatalogCache.ts')
    notifyModelOptionsRefresh('all')
    return { ok: true }
  }).catch((error) => ({ error: String(error) }))
  check('隔离环境注入 Kling 3.0 视频档案', catalogSeeded.ok === true, catalogSeeded.error || '')
  await win.waitForTimeout(700)

  const seeded = await win.evaluate((currentLocale) => {
    const store = window.__nomiCanvasStore.getState()
    const imageUrl = location.origin + '/prompt-media/expressions/builtin-expr-joy-1.webp'
    store.restoreSnapshot({
      nodes: [
        {
          id: 'video-source', kind: 'image', title: '首帧参考', position: { x: 60, y: 160 }, prompt: '', categoryId: 'shots', status: 'success',
          result: { id: 'video-source-result', type: 'image', url: imageUrl, createdAt: 1 },
        },
        {
          id: 'video-target', kind: 'video', title: '视频镜头', position: { x: 420, y: 160 }, prompt: currentLocale === 'en' ? 'A slow camera move through the scene.' : '镜头缓慢穿过场景。', categoryId: 'shots',
          meta: { modelKey: 'kling-3.0', modelVendor: 'ux-local', vendor: 'ux-local', archetype: { id: 'kling-3.0', modeId: 't2v' } },
        },
      ],
      edges: [], groups: [], selectedNodeIds: [],
    })
    return { imageUrl }
  }, locale)
  check('创建视频节点与真实同源首帧素材', Boolean(seeded.imageUrl))
  await win.waitForTimeout(500)
  await canvasFitViewButton(win).click()
  await win.waitForTimeout(500)

  const target = win.locator('[data-node-id="video-target"]').first()
  const composer = target.locator('.generation-canvas-v2-node__composer').first()
  await win.evaluate(() => window.__nomiCanvasStore.getState().selectNode('video-target'))
  await expectVisible(composer, '选中视频节点后生成框出现')
  const summary = composer.locator('[data-parameter-summary]').first()
  await expect(summary, '视频生成框缺少参数摘要入口').toBeVisible()

  await win.evaluate(() => window.__nomiCanvasStore.getState().connectNodes('video-source', 'video-target', 'first_frame'))
  await win.waitForFunction(() => window.__nomiCanvasStore.getState().nodes.find((node) => node.id === 'video-target')?.meta?.archetype?.modeId === 'i2v', undefined, { timeout: stationTimeout() })
  const connectedState = await win.evaluate(() => {
    const state = window.__nomiCanvasStore.getState()
    const targetNode = state.nodes.find((node) => node.id === 'video-target')
    return {
      modeId: targetNode?.meta?.archetype?.modeId,
      edges: state.edges.filter((edge) => edge.target === 'video-target').map((edge) => edge.mode),
    }
  })
  check('连入首帧后视频档案升格到单图方式', connectedState.modeId === 'i2v' && connectedState.edges[0] === 'first_frame', JSON.stringify(connectedState))
  await win.waitForFunction(() => document.querySelector('[data-node-id="video-target"] [data-reference-row] img') !== null, undefined, { timeout: stationTimeout() })
  await summary.click()
  const panel = win.locator('[data-agent-parameter-panel]').first()
  await expectVisible(panel, '打开视频生成框参数面板')
  const connectedImage = composer.locator('[data-reference-row] img').first()
  await expect(connectedImage, '升格后的生成框没有显示首帧格图片').toBeVisible()
  const connectedImageProof = await proveProbe(connectedImage, '连线后生成框里的首帧图片探针可用')
  if (await panel.isVisible().catch(() => false)) await summary.click()
  const connectedGeometry = await win.evaluate((label) => {
    const composer = document.querySelector('[data-node-id="video-target"] .generation-canvas-v2-node__composer')
    const generate = composer?.querySelector('[data-bar-segment="generate"]')
    const rect = (element) => element?.getBoundingClientRect()
    const composerRect = rect(composer)
    const generateRect = rect(generate)
    const inside = (box) => Boolean(box) && box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight
    return {
      composer: composerRect ? { left: composerRect.left, top: composerRect.top, right: composerRect.right, bottom: composerRect.bottom } : null,
      generate: generateRect ? { left: generateRect.left, top: generateRect.top, right: generateRect.right, bottom: generateRect.bottom } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      fits: inside(composerRect) && inside(generateRect),
      label,
    }
  }, generateLabel)
  check(`连线后截图前生成框与「${generateLabel}」按钮都在窗口内`, connectedGeometry.fits, JSON.stringify(connectedGeometry))
  const connectedShot = path.join(shotsDir, '01-connected-single-image.png')
  await screenshotSettled(win, { path: connectedShot })
  console.log('  · shot ' + connectedShot)

  const edgeId = await win.evaluate(() => window.__nomiCanvasStore.getState().edges.find((edge) => edge.target === 'video-target')?.id)
  await win.evaluate((id) => window.__nomiCanvasStore.getState().disconnectEdge(id), edgeId)
  await win.waitForFunction(() => window.__nomiCanvasStore.getState().nodes.find((node) => node.id === 'video-target')?.meta?.archetype?.modeId === 't2v', undefined, { timeout: stationTimeout() })
  const disconnectedState = await win.evaluate(() => {
    const state = window.__nomiCanvasStore.getState()
    const targetNode = state.nodes.find((node) => node.id === 'video-target')
    return {
      modeId: targetNode?.meta?.archetype?.modeId,
      edgeCount: state.edges.filter((edge) => edge.target === 'video-target').length,
    }
  })
  check('断开最后首帧后回到档案的文生视频方式', disconnectedState.modeId === 't2v' && disconnectedState.edgeCount === 0, JSON.stringify(disconnectedState))
  await win.waitForFunction(() => document.querySelector('[data-node-id="video-target"] [data-reference-row] img') === null, undefined, { timeout: stationTimeout() })
  await expectAbsent(composer.locator('[data-reference-row] img'), { provenBy: connectedImageProof, message: '断线后生成框仍显示首帧图片' })
  await expect(composer.locator('[data-bar-segment="generate"]'), '回到文生后生成按钮不可点').toBeEnabled()
  if (await panel.isVisible().catch(() => false)) await summary.click()
  const disconnectedGeometry = await win.evaluate((label) => {
    const composer = document.querySelector('[data-node-id="video-target"] .generation-canvas-v2-node__composer')
    const generate = composer?.querySelector('[data-bar-segment="generate"]')
    const rect = (element) => element?.getBoundingClientRect()
    const composerRect = rect(composer)
    const generateRect = rect(generate)
    const inside = (box) => Boolean(box) && box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight
    return {
      composer: composerRect ? { left: composerRect.left, top: composerRect.top, right: composerRect.right, bottom: composerRect.bottom } : null,
      generate: generateRect ? { left: generateRect.left, top: generateRect.top, right: generateRect.right, bottom: generateRect.bottom } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      fits: inside(composerRect) && inside(generateRect),
      label,
    }
  }, generateLabel)
  check(`断线后截图前生成框与「${generateLabel}」按钮都在窗口内`, disconnectedGeometry.fits, JSON.stringify(disconnectedGeometry))
  const disconnectedShot = path.join(shotsDir, '02-after-disconnected-text-to-video.png')
  await screenshotSettled(win, { path: disconnectedShot })
  console.log('  · shot ' + disconnectedShot)
} catch (error) {
  failures.push(String(error))
  console.error(error)
} finally {
  await app?.close().catch(() => {})
  await vite.close()
}

console.log('\n截图：' + shotsDir)
if (failures.length) {
  console.error('\n✗ ' + failures.length + ' 条没过：\n  ' + failures.join('\n  '))
  process.exit(1)
}
console.log('\n✓ 视频档案断线回文生走查通过')
