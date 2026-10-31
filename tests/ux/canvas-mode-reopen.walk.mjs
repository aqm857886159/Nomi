// I-canvas-revert-h：落盘的旧视频单图方式在冷重开后回到文生视频。
// 用法：NOMI_WALK_LANG=zh|en node tests/ux/canvas-mode-reopen.walk.mjs

import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, currentCatalogVersion } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { expect, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { canvasFitViewButton, canvasZoomPercent, canvasZoomStep, newProjectEntry, switchWorkspace } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = process.cwd()
const locale = process.env.NOMI_WALK_LANG === 'en' ? 'en' : 'zh-CN'
const languageTag = locale === 'en' ? 'en' : 'zh'
const generateLabel = uiText(locale, 'generationCommon.composer.generate')
const tempRoot = path.join(repoRoot, '.tmp', 'nomi-canvas-mode-reopen-' + languageTag)
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-mode-reopen', languageTag)
fs.rmSync(tempRoot, { recursive: true, force: true })
fs.rmSync(shotsDir, { recursive: true, force: true })
for (const dir of [settingsDir, projectsDir, shotsDir]) fs.mkdirSync(dir, { recursive: true })

const catalogNow = '2026-10-25T00:00:00.000Z'
fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: currentCatalogVersion(),
  vendors: [{ key: 'ux-local', name: 'UX Local', enabled: true, authType: 'none', providerKind: 'openai-compatible', createdAt: catalogNow, updatedAt: catalogNow }],
  models: [{
    vendorKey: 'ux-local', modelKey: 'kling-3.0', labelZh: 'Kling 3.0', kind: 'video', enabled: true, createdAt: catalogNow, updatedAt: catalogNow,
    meta: { archetypeId: 'kling-3.0', adapter: { state: 'verified', activeRevision: 'ux-canvas-mode-reopen', publicationModes: ['text_to_video', 'image_to_video'], modes: [{ taskKind: 'text_to_video', state: 'verified' }, { taskKind: 'image_to_video', state: 'verified' }] } },
  }],
  mappings: [],
  apiKeysByVendor: {},
}, null, 2))

const failures = []
const check = (name, ok, detail = '') => {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + name + (detail ? ' — ' + detail : ''))
  if (!ok) failures.push(name + (detail ? ' — ' + detail : ''))
}

function persistedProjectFiles() {
  const candidates = []
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    for (const relative of ['project.json', path.join('.nomi', 'project.json')]) {
      const file = path.join(projectsDir, entry.name, relative)
      if (fs.existsSync(file)) candidates.push(file)
    }
  }
  return candidates
}

function mutatePersistedNodeToLegacySingleImage() {
  const files = persistedProjectFiles()
  let changed = 0
  for (const file of files) {
    const project = JSON.parse(fs.readFileSync(file, 'utf8'))
    const canvas = project.payload?.generationCanvas
    const target = canvas?.nodes?.find((node) => node.id === 'legacy-video-target')
    if (!target) continue
    target.meta = {
      ...(target.meta || {}),
      modelKey: 'kling-3.0',
      modelVendor: 'ux-local',
      archetype: { ...((target.meta || {}).archetype || {}), id: 'kling-3.0', modeId: 'i2v' },
    }
    fs.writeFileSync(file, JSON.stringify(project, null, 2))
    changed += 1
  }
  return { files, changed }
}

let app
try {
  const first = await launchNomiApp({
    name: 'canvas-mode-reopen-seed-' + languageTag,
    userDataDir: path.join(tempRoot, 'user-data'), settingsDir, projectsDir, settleMs: 0,
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': 'dark', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
  })
  app = first.app
  const seedWin = first.win
  seedWin.setDefaultTimeout(stationTimeout())
  await newProjectEntry(seedWin).waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
  await newProjectEntry(seedWin).click({ noWaitAfter: true })
  await seedWin.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: stationTimeout({ operations: 2 }) })
  await switchWorkspace(seedWin, 'generation', '生成工作区')
  await seedWin.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: stationTimeout({ operations: 2 }) })
  const seeded = await seedWin.evaluate((currentLocale) => {
    const store = window.__nomiCanvasStore.getState()
    store.restoreSnapshot({
      nodes: [{
        id: 'legacy-video-target', kind: 'video', title: '旧视频镜头', position: { x: 240, y: 160 },
        prompt: currentLocale === 'en' ? 'A shot from the old project.' : '旧项目里的一个镜头。', categoryId: 'shots',
        meta: { modelKey: 'kling-3.0', modelVendor: 'ux-local', vendor: 'ux-local', archetype: { id: 'kling-3.0', modeId: 't2v' } },
      }],
      edges: [], groups: [], selectedNodeIds: [],
    })
    return { nodeId: 'legacy-video-target' }
  }, locale)
  check('先保存一个真实项目与视频节点', seeded.nodeId === 'legacy-video-target')
  await seedWin.waitForTimeout(2200)
  const persisted = await seedWin.evaluate(async () => {
    const projectMatch = location.href.match(/[?&]projectId=([^&#]+)/)
    const projectId = projectMatch ? decodeURIComponent(projectMatch[1]) : null
    const desktop = window.nomiDesktop
    if (!projectId || !desktop?.projects?.save || (!desktop.projects.readAsync && !desktop.projects.read)) return { error: '项目保存 bridge 不存在', projectId, desktopKeys: Object.keys(desktop || {}), projectKeys: Object.keys(desktop?.projects || {}) }
    const record = desktop.projects.readAsync ? await desktop.projects.readAsync(projectId) : desktop.projects.read(projectId)
    const state = window.__nomiCanvasStore.getState()
    if (!record || !state.nodes.some((node) => node.id === 'legacy-video-target')) return { error: '窗口内画布节点未就绪' }
    const generationCanvas = {
      ...(record.payload?.generationCanvas || {}),
      nodes: state.nodes,
      edges: state.edges,
      groups: state.groups,
      selectedNodeIds: state.selectedNodeIds,
    }
    await desktop.projects.save(projectId, { ...record, payload: { ...record.payload, generationCanvas } })
    return { projectId, nodeCount: state.nodes.length }
  }).catch((error) => ({ error: String(error) }))
  check('把当前画布快照写入真实项目文件', persisted.nodeCount === 1, JSON.stringify(persisted))
  if (persisted.nodeCount !== 1) throw new Error('真实项目快照保存失败')
  await app.close()
  app = undefined

  const mutated = mutatePersistedNodeToLegacySingleImage()
  check('应用关闭期间把项目文件改成旧的单图方式', mutated.changed >= 1, mutated.changed + ' 个持久化文件；' + mutated.files.join(', '))
  if (mutated.changed < 1) throw new Error('没有找到可修改的持久化项目文件')

  const restarted = await launchNomiApp({
    name: 'canvas-mode-reopen-' + languageTag, userDataDir: path.join(tempRoot, 'user-data'), settingsDir, projectsDir, settleMs: 0,
    initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': 'dark', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', __nomiE2E: '1' },
  })
  app = restarted.app
  const win = restarted.win
  win.setDefaultTimeout(stationTimeout())
  const continueLabel = uiText(locale, 'library.continueCreating')
  const continueButton = win.getByRole('button', { name: continueLabel, exact: true }).first()
  await continueButton.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) })
  await continueButton.click({ noWaitAfter: true })
  const syncDialog = win.getByRole('dialog').first()
  if (await syncDialog.isVisible().catch(() => false)) {
    await syncDialog.getByRole('button', { name: uiText(locale, 'library.syncRecheck'), exact: true }).click()
    await syncDialog.waitFor({ state: 'hidden', timeout: stationTimeout({ operations: 2 }) })
    await continueButton.click({ noWaitAfter: true })
  }
  await switchWorkspace(win, 'generation', '重开项目的生成工作区')
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore), undefined, { timeout: stationTimeout({ operations: 2 }) })
  await canvasFitViewButton(win).click()
  await win.waitForTimeout(500)
  await win.evaluate(() => window.__nomiCanvasStore.getState().selectNode('legacy-video-target'))
  const target = win.locator('[data-node-id="legacy-video-target"]').first()
  const composer = target.locator('.generation-canvas-v2-node__composer').first()
  await expectVisible(composer, '重开后选中视频节点，生成框出现')
  const reopenedState = await win.evaluate(() => {
    const state = window.__nomiCanvasStore.getState()
    const targetNode = state.nodes.find((node) => node.id === 'legacy-video-target')
    return { modeId: targetNode?.meta?.archetype?.modeId, edgeCount: state.edges.filter((edge) => edge.target === 'legacy-video-target').length }
  })
  check('冷重开 hydrate 后清掉旧单图方式，回到文生视频', reopenedState.modeId === 't2v' && reopenedState.edgeCount === 0, JSON.stringify(reopenedState))
  const summary = composer.locator('[data-parameter-summary]').first()
  await expect(summary, '重开后的生成框缺少参数摘要入口').toBeVisible()
  await summary.click()
  const panel = win.locator('[data-agent-parameter-panel]').first()
  await expectVisible(panel, '重开后的生成框参数面板出现')
  const composerProof = await proveProbe(composer, '重开后的生成框探针可用')
  await expectAbsent(composer.locator('[data-reference-row] img'), { provenBy: composerProof, message: '重开后的生成框错误显示首帧图片' })
  await expect(composer.locator('[data-bar-segment="generate"]'), '重开后文生视频生成按钮不可点').toBeEnabled()
  await summary.click()
  // 只有一个节点时适应视图会放到 200% 以上，生成框被挤出窗口、截图证明不了它；缩回 110% 以内再拍，拍完核生成框整个在窗口里。
  for (let step = 0; step < 6 && (await canvasZoomPercent(win)) > 110; step += 1) await canvasZoomStep(win, 'out', '缩到节点和生成框同屏')
  const shot = path.join(shotsDir, '01-after-reopen-text-to-video.png')
  const framed = await win.evaluate(() => {
    const composer = document.querySelector('[data-node-id="legacy-video-target"] .generation-canvas-v2-node__composer')
    const generate = composer?.querySelector('[data-bar-segment="generate"]')
    const box = composer?.getBoundingClientRect()
    const button = generate?.getBoundingClientRect()
    const inside = (rect) => Boolean(rect) && rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
    return {
      composer: box ? { top: box.top, bottom: box.bottom, left: box.left, right: box.right } : null,
      generate: button ? { top: button.top, bottom: button.bottom, left: button.left, right: button.right } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      fits: inside(box) && inside(button),
    }
  })
  check(`截图前生成框与「${generateLabel}」按钮都在窗口内`, framed.fits, JSON.stringify(framed))
  await screenshotSettled(win, { path: shot })
  console.log('  · shot ' + shot)
} catch (error) {
  failures.push(String(error))
  console.error(error)
} finally {
  await app?.close().catch(() => {})
}

console.log('\n截图：' + shotsDir)
if (failures.length) {
  console.error('\n✗ ' + failures.length + ' 条没过：\n  ' + failures.join('\n  '))
  process.exit(1)
}
console.log('\n✓ 冷重开回文生走查通过')
