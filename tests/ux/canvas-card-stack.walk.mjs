// 真实用户任务：多版本结果卡组 + 收起编组 + 重开持久化。
// 零模型额度；使用隔离项目与本地 SVG/MP4。先 pnpm build，再 node 本文件。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import {
  applyColorSchemeForShot,
  clickOrFail,
  expect,
  expectAbsent,
  expectCount,
  expectHidden,
  expectVisible,
  proveProbe,
  screenshotSettled,
} from './_assert.mjs'
import { findEdgeHitPoint } from './_canvasHit.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-card-stack-walk-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const projectId = 'canvas-card-stack-walk'
const projectRoot = path.join(projectsDir, projectId)
const secondProjectId = 'canvas-card-stack-walk-second'
const secondProjectRoot = path.join(projectsDir, secondProjectId)
const outputDir = path.resolve('outputs/canvas-card-stack-20260827')
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(path.join(projectRoot, 'assets', 'generated'), { recursive: true })
fs.mkdirSync(path.join(secondProjectRoot, '.nomi'), { recursive: true })
fs.mkdirSync(path.join(secondProjectRoot, 'assets', 'generated'), { recursive: true })
fs.mkdirSync(outputDir, { recursive: true })

const imageSvg = (label, start, end) => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
  <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs>
  <rect width="800" height="800" rx="60" fill="url(#g)"/><circle cx="610" cy="190" r="96" fill="#fff" opacity=".22"/>
  <path d="M0 610L180 360l160 180 140-210 320 360v110H0z" fill="#141820" opacity=".72"/>
  <text x="54" y="96" fill="white" font-size="42" font-family="sans-serif" font-weight="700">${label}</text>
</svg>`

for (const [name, label, start, end] of [
  ['rain-1.svg', '雨夜 · 01', '#d69072', '#34465f'],
  ['rain-2.svg', '雨夜 · 02', '#9b7fd1', '#273752'],
  ['rain-3.svg', '雨夜 · 03', '#ef8a64', '#39405d'],
  ['character.svg', '角色参考', '#55a5a5', '#293b4d'],
  ['scene.svg', '场景参考', '#c89b63', '#4b3c42'],
  ['style.svg', '风格参考', '#7f77c9', '#323247'],
]) fs.writeFileSync(path.join(projectRoot, 'assets', 'generated', name), imageSvg(label, start, end))
fs.copyFileSync(path.resolve('marketing/assets/demo.mp4'), path.join(projectRoot, 'assets', 'generated', 'demo.mp4'))
for (const name of ['rain-1.svg', 'rain-2.svg', 'rain-3.svg', 'character.svg', 'scene.svg', 'style.svg']) {
  fs.copyFileSync(path.join(projectRoot, 'assets', 'generated', name), path.join(secondProjectRoot, 'assets', 'generated', name))
}
fs.copyFileSync(path.resolve('marketing/assets/demo.mp4'), path.join(secondProjectRoot, 'assets', 'generated', 'demo.mp4'))

const assetUrl = (name) => `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/${name}`
const imageResult = (id, name, createdAt) => ({ id, type: 'image', url: assetUrl(name), thumbnailUrl: assetUrl(name), createdAt })
const videoResult = (id, createdAt, thumbnail) => ({ id, type: 'video', url: assetUrl('demo.mp4'), thumbnailUrl: assetUrl(thumbnail), createdAt })
const nodes = [
  {
    id: 'image-versions', kind: 'image', categoryId: 'shots', title: '雨夜入场', prompt: '人物走进雨夜咖啡馆',
    position: { x: 140, y: 120 }, size: { width: 260, height: 260 }, status: 'success',
    result: imageResult('image-v3', 'rain-3.svg', 3),
    history: [imageResult('image-v3', 'rain-3.svg', 3), imageResult('image-v2', 'rain-2.svg', 2), imageResult('image-v1', 'rain-1.svg', 1)],
  },
  {
    id: 'video-versions', kind: 'video', categoryId: 'shots', title: '推镜进入咖啡馆', prompt: '缓慢推进',
    position: { x: 760, y: 120 }, size: { width: 300, height: 260 }, status: 'success',
    result: videoResult('video-v2', 2, 'rain-2.svg'),
    history: [videoResult('video-v2', 2, 'rain-2.svg'), videoResult('video-v1', 1, 'rain-1.svg')],
  },
  {
    id: 'group-character', kind: 'image', categoryId: 'shots', title: '角色参考', groupId: 'reference-group',
    position: { x: 180, y: 480 }, size: { width: 220, height: 220 }, status: 'success', result: imageResult('character', 'character.svg', 1), history: [],
  },
  {
    id: 'group-scene', kind: 'image', categoryId: 'shots', title: '场景参考', groupId: 'reference-group',
    position: { x: 460, y: 480 }, size: { width: 220, height: 220 }, status: 'success', result: imageResult('scene', 'scene.svg', 1), history: [],
  },
  {
    id: 'group-style', kind: 'image', categoryId: 'shots', title: '风格参考', groupId: 'reference-group',
    position: { x: 740, y: 480 }, size: { width: 220, height: 220 }, status: 'success', result: imageResult('style', 'style.svg', 1), history: [],
  },
]
const edges = [
  { id: 'group-input-character', source: 'image-versions', target: 'group-character', mode: 'reference', order: 0, viaGroupId: 'reference-group' },
  { id: 'group-input-scene', source: 'image-versions', target: 'group-scene', mode: 'style_ref', order: 1, viaGroupId: 'reference-group' },
  { id: 'group-input-style', source: 'image-versions', target: 'group-style', mode: 'reference', order: 2, viaGroupId: 'reference-group' },
  { id: 'group-internal', source: 'group-character', target: 'group-scene', mode: 'reference', order: 0 },
]
const groups = [{
  id: 'reference-group', name: '雨夜参考组', categoryId: 'shots', nodeIds: ['group-character', 'group-scene', 'group-style'],
  color: '#746ce8', collapsed: false, inputLinks: [{ sourceNodeId: 'image-versions' }], createdAt: 1, updatedAt: 1,
}]
const generationCanvas = { nodes, edges, groups, selectedNodeIds: [], canvasZoom: 0.86, canvasPan: { x: 30, y: 10 } }
const payload = { workbenchDocument: null, timeline: null, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
const project = {
  id: projectId, name: '卡片堆叠体验验收', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot, workbenchDocument: null, timeline: null, generationCanvas, payload,
}
for (const target of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(project, null, 2))
}
const secondProject = JSON.parse(JSON.stringify(project).replaceAll(projectId, secondProjectId))
secondProject.id = secondProjectId
secondProject.name = '第二个项目 · F8 切换验收'
secondProject.lastKnownRootPath = secondProjectRoot
for (const target of [path.join(secondProjectRoot, 'project.json'), path.join(secondProjectRoot, '.nomi', 'project.json')]) {
  fs.writeFileSync(target, JSON.stringify(secondProject, null, 2))
}

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  if (!ok) throw new Error(`${name}${detail ? `: ${detail}` : ''}`)
}

const launched = await launchNomiApp({ name: 'canvas-card-stack', settingsDir, projectsDir, settleMs: 1000 })
const { win } = launched

async function dismissOnboarding() {
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.keyboard.press('Escape').catch(() => undefined)
}

async function openProjectCanvas(name) {
  await dismissOnboarding()
  const projectCard = win.locator('[data-project-card]', { hasText: name }).first()
  await projectCard.waitFor({ state: 'visible', timeout: 10_000 })
  if (await projectCard.isVisible().catch(() => false)) {
    await projectCard.hover()
    const continueButton = projectCard.getByText('继续创作', { exact: false }).first()
    if (await continueButton.count()) await continueButton.click()
    else await projectCard.dblclick()
    await win.waitForTimeout(1200)
  }
  const generationButton = win.getByRole('button', { name: '生成', exact: true }).first()
  if (await generationButton.isVisible().catch(() => false)) await generationButton.click()
  await win.locator('[data-node-id="image-versions"]').waitFor({ state: 'visible', timeout: 10_000 })
}

async function openCanvas() {
  await dismissOnboarding()
  await win.reload()
  await win.waitForTimeout(800)
  await openProjectCanvas('卡片堆叠体验验收')
}

async function backToLibrary() {
  await clickOrFail(win.getByRole('button', { name: '返回项目库' }), '返回项目库')
  await win.locator('[data-project-card]').first().waitFor({ state: 'visible', timeout: 10_000 })
}

try {
  await openCanvas()
  const imageNode = win.locator('[data-node-id="image-versions"]')
  const videoNode = win.locator('[data-node-id="video-versions"]')
  const groupMembers = win.locator('[data-node-id="group-character"], [data-node-id="group-scene"], [data-node-id="group-style"]')
  await imageNode.locator('[data-node-media-state="ready"]').waitFor({ state: 'attached', timeout: 10_000 })
  await expectCount(groupMembers, 3, '展开的雨夜参考组应显示三个成员节点')
  const groupMembersProof = await proveProbe(groupMembers, '展开编组里的成员节点可被同一 data-node-id 探针找到')
  check('图片版本卡角可见', await imageNode.getByRole('button', { name: '3 版' }).isVisible())
  check('视频版本卡角可见', await videoNode.getByRole('button', { name: '2 版' }).isVisible())
  check('图片卡角最多两层', await imageNode.locator('[data-card-stack-rear]').count() === 2)
  check('视频两版只有一层后卡', await videoNode.locator('[data-card-stack-rear]').count() === 1)
  await screenshotSettled(win, { path: path.join(outputDir, '01-real-version-stacks-light.png') })

  await imageNode.getByRole('button', { name: '3 版' }).click()
  const tray = imageNode.locator('[data-node-result-stack="image-versions"]')
  await tray.waitFor({ state: 'visible' })
  const beforeOrder = await tray.locator('[data-result-stack-item]').evaluateAll((items) => items.map((item) => item.getAttribute('data-result-stack-item')))
  check('托盘列出三版', beforeOrder.join(',') === 'image-v3,image-v2,image-v1', beforeOrder.join(','))
  await screenshotSettled(win, { path: path.join(outputDir, '02-real-version-tray-light.png') })
  await tray.locator('[data-result-stack-item="image-v1"] button').first().click()
  const afterOrder = await tray.locator('[data-result-stack-item]').evaluateAll((items) => items.map((item) => item.getAttribute('data-result-stack-item')))
  check('切换当前版不重排历史', afterOrder.join(',') === beforeOrder.join(','), afterOrder.join(','))
  check('第一版成为当前', await tray.locator('[data-result-stack-item="image-v1"]').getAttribute('data-current') === 'true')

  const imagePreviewButton = tray.locator('[data-result-stack-item="image-v2"] button[aria-label="预览"]')
  await clickOrFail(imagePreviewButton, '打开历史图片预览')
  const imagePreview = win.locator('[role="dialog"][aria-label*="雨夜入场"]').first()
  await expectVisible(imagePreview, '历史图片预览弹层应可见')
  check('历史图片预览载入原图', await imagePreview.locator('img[alt="雨夜入场"]').count() === 1)
  const imagePreviewProof = await proveProbe(imagePreview, '历史图片预览弹层确实可被探针找到')
  await clickOrFail(imagePreview.getByRole('button', { name: '关闭预览' }), '关闭历史图片预览')
  await expectAbsent(imagePreview, { provenBy: imagePreviewProof, message: '关闭后历史图片预览应从画布移除' })

  const downloadPath = path.join(root, 'downloads', '雨夜入场.png')
  await launched.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, downloadPath)
  const imageDownloadButton = tray.locator('[data-result-stack-item="image-v1"] button[aria-label="下载这一版"]')
  check('历史图片提供下载入口', await imageDownloadButton.isEnabled())
  await clickOrFail(imageDownloadButton, '下载历史图片')
  await expect.poll(() => fs.existsSync(downloadPath) && fs.statSync(downloadPath).size > 0, { message: '下载桥接应写出非空历史图片文件', timeout: 10_000 }).toBe(true)
  check('历史图片下载文件非空', fs.statSync(downloadPath).size > 0)

  const deleteRow = tray.locator('[data-result-stack-item="image-v2"]')
  const deleteRowProof = await proveProbe(deleteRow, '待删除历史图片结果确实在托盘中')
  await clickOrFail(deleteRow.locator('button[aria-label="删除"]'), '删除历史图片结果')
  const confirmDialog = win.locator('[data-confirm-dialog-surface="confirm"]')
  await expectVisible(confirmDialog, '删除历史结果应显示确认弹窗')
  await clickOrFail(win.locator('[data-confirm-dialog-confirm]'), '确认删除历史图片结果')
  await expectAbsent(deleteRow, { provenBy: deleteRowProof, message: '确认后历史图片结果应从托盘移除' })
  check('删除历史结果后其他版本保留', await tray.locator('[data-result-stack-item]').count() === 2)

  await clickOrFail(imageNode.getByRole('button', { name: '2 版' }), '关闭结果版本托盘')
  await expectHidden(tray, '结果版本托盘应完成退场')
  await imageNode.click({ position: { x: 120, y: 120 } })
  await clickOrFail(imageNode.getByRole('button', { name: '复制为变体' }), '复制当前节点为无结果的新变体')
  const selectedNode = win.locator('.generation-canvas-v2-node[data-selected="true"]').first()
  await expect.poll(() => selectedNode.getAttribute('data-node-id'), { message: '复制变体应选中新节点' }).toMatch(/^gen-v2-/)
  const duplicateId = await selectedNode.getAttribute('data-node-id')
  const duplicateFlowNode = win.locator(`.react-flow__node[data-id="${duplicateId}"]`)
  await expectVisible(duplicateFlowNode, '复制出的变体应自动进入视口并可见')
  const duplicateProbe = await proveProbe(duplicateFlowNode, '复制出的变体已真实渲染')
  check('复制变体新增一个节点且用户立即看得到', true)
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expectAbsent(duplicateFlowNode, { provenBy: duplicateProbe, message: '撤销应同时移除复制节点和继承连线' })
  check('复制变体可一次撤销', true)

  await videoNode.getByRole('button', { name: '2 版' }).click()
  const videoTray = videoNode.locator('[data-node-result-stack="video-versions"]')
  await videoTray.waitFor({ state: 'visible', timeout: 10_000 })
  await expect.poll(() => videoTray.evaluate((tray) => {
    const stage = tray.closest('.generation-canvas-v2__stage')
    if (!stage) return false
    const trayRect = tray.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    return trayRect.left >= stageRect.left && trayRect.right <= stageRect.right
  }), { message: '版本托盘应完整位于画布可交互视口', timeout: 5_000 }).toBe(true)
  const videoTrayPlacement = await videoTray.getAttribute('data-placement')
  check('版本托盘避开画布视口边缘', true, videoTrayPlacement || '')
  const videoHistoryRow = videoTray.locator('[data-result-stack-item="video-v1"]')
  const historyVideo = videoHistoryRow.locator('video').first()
  await videoHistoryRow.locator('button').first().hover()
  await historyVideo.waitFor({ state: 'visible', timeout: 10_000 })
  check('悬停历史视频真实播放元素可见', true)
  check('历史视频默认静音', await historyVideo.evaluate((video) => video.muted === true))
  const videoProgress = videoHistoryRow.getByRole('slider', { name: '视频进度' })
  await expect.poll(async () => Number(await videoProgress.getAttribute('aria-valuemax')), { message: '历史视频应加载可拖动时长', timeout: 10_000 }).toBeGreaterThan(0)
  const progressBox = await videoProgress.boundingBox()
  check('历史视频进度条可见', Boolean(progressBox))
  if (!progressBox) throw new Error('历史视频进度条没有可交互边界')
  await win.mouse.move(progressBox.x + progressBox.width * 0.2, progressBox.y + progressBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(progressBox.x + progressBox.width * 0.75, progressBox.y + progressBox.height / 2, { steps: 5 })
  await win.mouse.up()
  const draggedTime = Number(await videoProgress.getAttribute('aria-valuenow'))
  check('拖动进度条连续跳转', draggedTime > 0, String(draggedTime))
  await videoProgress.press('ArrowLeft')
  const nudgedTime = Number(await videoProgress.getAttribute('aria-valuenow'))
  check('键盘左键精确回退一秒', Math.abs(nudgedTime - Math.max(0, draggedTime - 1)) < 0.2, `${draggedTime} -> ${nudgedTime}`)
  await screenshotSettled(win, { path: path.join(outputDir, '03-real-video-history-scrub-light.png') })
  await videoProgress.blur()
  await win.mouse.move(12, 12)
  await win.waitForTimeout(250)
  check('离开历史视频后播放暂停并回到起点', await historyVideo.evaluate((video) => video.paused && video.currentTime < 0.2))
  await clickOrFail(videoHistoryRow.locator('button[aria-label="预览"]'), '打开历史视频预览')
  const videoPreview = win.locator('[role="dialog"][aria-label*="推镜进入咖啡馆"]').first()
  await expectVisible(videoPreview, '历史视频预览弹层应可见')
  const previewVideo = videoPreview.locator('video').first()
  await previewVideo.waitFor({ state: 'attached', timeout: 10_000 })
  check('历史视频预览挂载视频元素', await previewVideo.count() === 1)
  check('历史视频预览提供原生控制条', await previewVideo.getAttribute('controls') !== null)
  const videoPreviewProof = await proveProbe(videoPreview, '历史视频预览弹层确实可被探针找到')
  await clickOrFail(videoPreview.getByRole('button', { name: '关闭预览' }), '关闭历史视频预览')
  await expectAbsent(videoPreview, { provenBy: videoPreviewProof, message: '关闭后历史视频预览应从画布移除' })
  await videoNode.getByRole('button', { name: '2 版' }).click()
  await expectHidden(videoTray, '视频版本托盘应完成退场')

  const collapse = win.getByRole('button', { name: '收起分组「雨夜参考组」' })
  await collapse.scrollIntoViewIfNeeded()
  await clickOrFail(collapse, '把雨夜参考组收成节点卡组')
  const collapsed = win.locator('[data-collapsed-group-id="reference-group"]')
  await expectVisible(collapsed, '收起后应显示一张编组卡')
  await expectCount(collapsed, 1, '收起后只保留一张编组卡')
  check('收起后只剩一个组卡', true)
  await expectAbsent(groupMembers, { provenBy: groupMembersProof, message: '收起后组内三个成员节点不再各自占画布' })
  check('三位成员已从画布投影隐藏', true)
  check('编组显示节点语义', await collapsed.getByRole('button', { name: '3 节点' }).isVisible())
  const collapsedMagneticHandles = collapsed.locator('.generation-canvas-v2-node__magnetic-handle')
  await expectCount(collapsedMagneticHandles, 2, '收起编组应保留左右两个磁性连接句柄')
  const collapsedHandleStates = await collapsedMagneticHandles.evaluateAll((handles) => handles.map((handle) => {
    const style = window.getComputedStyle(handle)
    const bounds = handle.getBoundingClientRect()
    return {
      side: handle.getAttribute('data-side'),
      rendered: style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0,
      hasPlusIcon: Boolean(handle.querySelector('.generation-canvas-v2-node__magnetic-handle-icon svg')),
    }
  }))
  check(
    '收起编组保留可交互的左右悬浮加号',
    collapsedHandleStates.map(({ side }) => side).sort().join(',') === 'left,right'
      && collapsedHandleStates.every(({ rendered, hasPlusIcon }) => rendered && hasPlusIcon),
    JSON.stringify(collapsedHandleStates),
  )
  check('三条成员输入聚合为一条编组线', await win.locator('g[data-aggregate-group="reference-group"]').count() === 1)
  // 连线是贝塞尔曲线：`locator.click()` 点的是外接盒中心，而曲线的外接盒中心不在曲线上——
  // 那一点谁盖着就点到谁（面板展开把画布收窄后，那里正好是选中节点的提示词面板，
  // Playwright 报 "subtree intercepts pointer events"）。用户点的是线本身，走查也点线本身。
  const aggregatePoint = await findEdgeHitPoint(win, {
    edgeSelector: 'g[data-aggregate-group="reference-group"] path[role="button"]',
  })
  check('聚合编组输入线上存在真的点得到的点', Boolean(aggregatePoint), JSON.stringify(aggregatePoint))
  await win.mouse.click(aggregatePoint.x, aggregatePoint.y)
  await expectVisible(win.getByText('编组输入', { exact: true }), '聚合线应显示编组关系而不是伪造成员模式')
  await screenshotSettled(win, { path: path.join(outputDir, '04-real-collapsed-group-link-light.png') })

  await expect.poll(() => {
    const current = JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi', 'project.json'), 'utf8'))
    return current.payload.generationCanvas.groups.find((entry) => entry.id === 'reference-group')?.collapsed
  }, { message: '重开前收起状态应已持久化' }).toBe(true)
  await backToLibrary()
  check('返回项目库仍能看到两个项目', await win.locator('[data-project-card]').count() === 2)
  await openProjectCanvas('卡片堆叠体验验收')
  const reopenedImageNode = win.locator('[data-node-id="image-versions"]')
  const reopenedGroupMembers = win.locator('[data-node-id="group-character"], [data-node-id="group-scene"], [data-node-id="group-style"]')
  const reopenedCollapsed = win.locator('[data-collapsed-group-id="reference-group"]')
  await expectVisible(reopenedCollapsed, '重新打开项目后编组仍应保持收起')
  await expectAbsent(reopenedGroupMembers, { provenBy: groupMembersProof, message: '重新打开项目后组成员仍应隐藏' })
  check('重新打开后节点与聚合连接仍在', await win.locator('g[data-aggregate-group="reference-group"]').count() === 1)
  await clickOrFail(reopenedImageNode.getByRole('button', { name: '2 版' }), '打开重开项目的历史结果托盘')
  const reopenedTray = reopenedImageNode.locator('[data-node-result-stack="image-versions"]')
  await expectVisible(reopenedTray, '重新打开后历史结果托盘可用')
  check('重新打开后历史结果仍保留', await reopenedTray.locator('[data-result-stack-item]').count() === 2)
  await clickOrFail(reopenedImageNode.getByRole('button', { name: '2 版' }), '关闭重开项目的历史结果托盘')

  await clickOrFail(collapsed.getByRole('button', { name: '3 节点' }), '展开雨夜参考组')
  await expectVisible(win.locator('[data-node-id="group-character"]'), '点击卡角后应恢复组内节点')
  // expectVisible above is the web-first assertion; do not immediately sample
  // isVisible(), which can race the React Flow expand animation and re-mount.
  check('点击卡角恢复组内节点', true)
  await expect.poll(() => win.locator('g[data-edge-id^="group-input-"]').count(), { message: '展开后真实成员输入线应完成投影' }).toBe(3)
  check('展开后恢复三条真实成员输入线', true)

  await clickOrFail(collapse, '再次收起雨夜参考组')
  await expectVisible(collapsed, '再次收起后应恢复编组卡')
  await applyColorSchemeForShot(win, 'dark')
  await screenshotSettled(win, { path: path.join(outputDir, '05-real-collapsed-group-dark.png') })

  await clickOrFail(win.locator('g[data-aggregate-group="reference-group"] path[role="button"]'), '重新选中编组输入线')
  await clickOrFail(win.getByRole('button', { name: '断开整条编组连接' }), '一次断开完整编组关系')
  await expectAbsent(win.locator('g[data-aggregate-group="reference-group"]'), {
    provenBy: await proveProbe(collapsed, '断开后编组卡仍存在'),
    message: '断开聚合线后不应残留成员关系线',
  })
  check('聚合线一次断开整组关系', true)

  await expect.poll(() => {
    const current = JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi', 'project.json'), 'utf8'))
    return current.payload.generationCanvas.groups.find((entry) => entry.id === 'reference-group')?.collapsed
  }, { message: '收起状态应持久化到项目文件' }).toBe(true)
  const persisted = JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi', 'project.json'), 'utf8'))
  const persistedGroup = persisted.payload.generationCanvas.groups.find((entry) => entry.id === 'reference-group')
  check('收起状态写入项目', persistedGroup?.collapsed === true)
  check('断开的编组声明不再持久化', !persistedGroup?.inputLinks?.length)

  const sidebar = win.locator('aside[aria-label="项目资源管理器"]')
  const expandSidebar = sidebar.getByRole('button', { name: '展开侧栏' })
  if (await expandSidebar.isVisible().catch(() => false)) await expandSidebar.click()
  await expect.poll(() => sidebar.getAttribute('data-collapsed'), { message: '素材库操作前左侧栏应展开' }).toBe('false')
  const assetLibraryTab = sidebar.getByRole('button', { name: '素材库' }).first()
  if (await assetLibraryTab.getAttribute('aria-pressed') !== 'true') await clickOrFail(assetLibraryTab, '切换到左侧素材库')
  await expect.poll(() => assetLibraryTab.getAttribute('aria-pressed'), { message: '素材库标签应成为当前侧栏面板' }).toBe('true')
  const assetLibraryPanel = sidebar.locator('section[aria-label="素材库"]')
  await expectVisible(assetLibraryPanel, '切换标签后素材库面板应完成渲染')
  check('展开后素材库面板可见', true)
  await backToLibrary()
  await openProjectCanvas('第二个项目 · F8 切换验收')
  const secondSidebar = win.locator('aside[aria-label="项目资源管理器"]')
  check('切换项目后左侧栏自动收起', await secondSidebar.getAttribute('data-collapsed') === 'true')
  await screenshotSettled(win, { path: path.join(outputDir, '06-real-project-switch-sidebar-collapsed.png') })
  fs.writeFileSync(path.join(outputDir, 'walk-report.json'), JSON.stringify({ checks, projectRoot }, null, 2))
  console.log(JSON.stringify({ ok: true, checks }, null, 2))
} finally {
  await launched.close().catch(() => undefined)
}
