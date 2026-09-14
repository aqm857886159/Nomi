// 微信反馈回归：画布图片要能放大；普通图片节点名字要能直接在图上修改并持久化。
// 2026-09-14 追加媒体生命周期断言：画布内联 <img> 挂的是落盘边界派生的 `.preview.` 缩略图，
// 全屏预览对话框拿到的是原图 URL（两者必须不同——画布不为每个节点解码原图）。
// 零额度：使用隔离项目 + 本地 SVG 图片，不调用任何模型。
// 用法：pnpm run build && node tests/ux/canvas-image-preview-and-rename.e2e.mjs
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectVisible } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-canvas-image-preview-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const projectId = 'canvas-image-preview-e2e'
const projectRoot = path.join(projectsDir, `canvas-image-preview-${projectId}`)
const outDir = path.join(repoRoot, '.canvas-image-preview-lab')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

const ORIGINAL_TITLE = '镜头原名'
const RENAMED_TITLE = '雨夜街口 · 主角入场'
const IMAGE_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
    <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#53677c"/><stop offset="1" stop-color="#d3b29b"/></linearGradient></defs>
    <rect width="960" height="540" fill="url(#sky)"/><circle cx="700" cy="130" r="58" fill="#f3d5ad"/>
    <path d="M0 420L220 190l180 230 210-210 350 260v70H0z" fill="#26353e"/>
    <path d="M0 470l300-170 220 190 220-170 220 170v50H0z" fill="#14252b"/>
  </svg>
`
const generatedAssetsDir = path.join(projectRoot, 'assets', 'generated')
fs.mkdirSync(generatedAssetsDir, { recursive: true })
fs.writeFileSync(path.join(generatedAssetsDir, 'fixture.svg'), IMAGE_SVG)
// 与生产落盘边界（electron/assets/assetPreview.ts）同名规则：源旁边的 `<name>.preview.<ext>`。
const IMAGE_PREVIEW_SVG = IMAGE_SVG.replace('width="960" height="540"', 'width="320" height="180"')
fs.writeFileSync(path.join(generatedAssetsDir, 'fixture.preview.svg'), IMAGE_PREVIEW_SVG)
const IMAGE_URL = `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/fixture.svg`
const IMAGE_PREVIEW_URL = `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/fixture.preview.svg`

const nodes = [
  {
    id: 'image-result-node', kind: 'image', categoryId: 'shots', title: ORIGINAL_TITLE,
    position: { x: 180, y: 180 }, exactPosition: true, size: { width: 480, height: 270 }, status: 'success',
    result: { id: 'image-result-1', type: 'image', url: IMAGE_URL, thumbnailUrl: IMAGE_PREVIEW_URL, createdAt: 1 }, meta: { imageWidth: 960, imageHeight: 540 },
  },
  {
    id: 'character-result-node', kind: 'character', categoryId: 'shots', title: '林夏',
    // React Flow 只渲染视口内的节点：右侧 Agent 面板占位后画布约 865px 宽，x=800 的卡在视口外不会进 DOM；
    // y 要避开选中图片节点时展开的浮动工具条（它会拦截落在其下方的点击）。
    position: { x: 180, y: 640 }, exactPosition: true, size: { width: 200, height: 200 }, status: 'success',
    result: { id: 'character-result-1', type: 'image', url: IMAGE_URL, createdAt: 1 }, meta: { imageWidth: 960, imageHeight: 540 },
  },
]
const payload = {
  workbenchDocument: null,
  timeline: null,
  generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } },
  storyboardPlan: null,
  storyboardPlanCommitted: false,
}
const project = {
  id: projectId,
  name: '图片预览与改名回归',
  version: 2,
  createdAt: 1,
  updatedAt: 1,
  savedAt: 1,
  revision: 1,
  lastKnownRootPath: projectRoot,
  // 兼容项目发现/旧加载入口：关键 payload 同时保留顶层镜像；持久化后仍以 payload 为真相源。
  workbenchDocument: null,
  timeline: null,
  generationCanvas: payload.generationCanvas,
  payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi', 'project.json'), JSON.stringify(project, null, 2))

const { app, win: _launchedWin } = await launchNomiApp({
  name: 'canvas-image-preview-and-rename',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  settleMs: 1200,
})

async function closeApp() {
  const child = app.process()
  await Promise.race([app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function dismissOnboarding(win) {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.keyboard.press('Escape').catch(() => {})
  for (let i = 0; i < 4; i += 1) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|完成|知道了|开始创作/ }).first()
    if ((await skip.count()) > 0) await skip.click({ timeout: 800 }).catch(() => {})
  }
}

async function openFixtureCanvas(win) {
  await dismissOnboarding(win)
  const generationButton = win.getByRole('button', { name: '生成', exact: true }).first()
  const node = win.locator('[data-node-id="image-result-node"]')
  if (await node.isVisible().catch(() => false)) return node

  const projectCard = win.locator('[data-project-card]', { hasText: '图片预览与改名回归' }).first()
  if (await projectCard.isVisible().catch(() => false)) {
    await projectCard.hover()
    const continueButton = projectCard.getByText('继续创作', { exact: false }).first()
    if ((await continueButton.count()) > 0) await continueButton.click()
    else await projectCard.dblclick()
    await win.waitForTimeout(1600)
  }
  if (await generationButton.isVisible().catch(() => false)) await generationButton.click()
  await node.waitFor({ state: 'visible', timeout: 8000 })
  return node
}

try {
  const win = _launchedWin
  await dismissOnboarding(win)
  await win.reload()
  await win.waitForTimeout(1000)
  const imageNode = await openFixtureCanvas(win)
  const characterNode = win.locator('[data-node-id="character-result-node"]')
  await characterNode.waitFor({ state: 'visible', timeout: 8000 })

  await imageNode.click()
  const inlineImageSrc = await imageNode.locator('img').first().getAttribute('src')
  const inlineUsesPreview = inlineImageSrc === IMAGE_PREVIEW_URL
  const imagePreviewButton = imageNode.getByRole('button', { name: '全屏预览图片' })
  await expectVisible(imagePreviewButton, '图片节点选中后显示全屏预览入口', 3000)
  await characterNode.click()
  const cardPreviewButton = characterNode.getByRole('button', { name: '全屏预览图片' })
  // expectVisible 已经等到可见（不可见会直接抛红）；不再二次采样 isVisible()——选中切换那一帧工具条会短暂重挂，采到 false 是假红。
  await expectVisible(cardPreviewButton, '角色节点选中后显示全屏预览入口', 3000)
  const bothKindsHavePreview = true

  await imageNode.click()
  await expectVisible(imagePreviewButton, '重新选中图片节点后恢复全屏预览入口', 3000)
  await imagePreviewButton.click()
  const lightbox = win.getByRole('dialog', { name: `${ORIGINAL_TITLE}预览` })
  await expectVisible(lightbox, '点击预览入口后打开图片预览对话框', 3000)
  const modalSemantics = await lightbox.getAttribute('aria-modal') === 'true'
  const lightboxImageSrc = await lightbox.locator('img').getAttribute('src')
  const originalImageUsed = lightboxImageSrc === IMAGE_URL
  if (!inlineUsesPreview || !originalImageUsed) throw new Error(`图片生命周期错误：inline=${inlineImageSrc} modal=${lightboxImageSrc}`)
  await win.screenshot({ path: path.join(outDir, '01-image-lightbox.png') })
  await win.keyboard.press('Escape')
  await lightbox.waitFor({ state: 'detached', timeout: 3000 })

  await imageNode.hover()
  const inlineTitle = imageNode.locator('[data-node-inline-title="true"]')
  await inlineTitle.waitFor({ state: 'visible', timeout: 3000 })
  await inlineTitle.click()
  const titleInput = inlineTitle.locator('input')
  await titleInput.fill(RENAMED_TITLE)
  await titleInput.press('Enter')
  await win.waitForTimeout(1200)
  const renamedOnCanvas = (await inlineTitle.textContent())?.includes(RENAMED_TITLE) === true
  await win.screenshot({ path: path.join(outDir, '02-inline-renamed.png') })

  await win.reload()
  await win.waitForTimeout(1400)
  const reloadedNode = await openFixtureCanvas(win)
  await reloadedNode.hover()
  const persistedAfterReload = (await reloadedNode.locator('[data-node-inline-title="true"]').textContent())?.includes(RENAMED_TITLE) === true

  const result = { bothKindsHavePreview, inlineUsesPreview, modalSemantics, originalImageUsed, renamedOnCanvas, persistedAfterReload }
  console.log(JSON.stringify(result))
  const ok = Object.values(result).every(Boolean)
  await closeApp()
  process.exit(ok ? 0 : 1)
} catch (error) {
  console.error(error)
  await closeApp()
  process.exit(1)
}
