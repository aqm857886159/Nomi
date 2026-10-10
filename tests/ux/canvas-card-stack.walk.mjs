import { makeTempDir } from '../../scripts/_test-temp.mjs'
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
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { expectArrivalsReachable, expectCanvasViewportHeld, expectToolbarInsideStageEverywhere, findCanvasBlankPoint, findEdgeHitPoint, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { backToLibrary } from './_shell.mjs'
import { openFrameMenuFromToolbar } from './_groupFrame.mjs'

const root = makeTempDir('nomi-card-stack-walk-')
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

const launched = await launchNomiApp({ name: 'canvas-card-stack', settingsDir, projectsDir, settleMs: 1000, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
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

async function returnToLibrary() {
  await backToLibrary(win)
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
  // 这四条以前是 `check(..., await X.isVisible())` / `await X.count() === N`——**一次性采样、零等待**。
  // 上面那句 waitFor 只等了图片节点的媒体就绪（`data-node-media-state="ready"`），视频节点走的是
  // deferred 媒体队列里的另一条、另一个挂载时机，所以图片那条恰好稳、视频那条在慢机器上会赶在卡角
  // 挂上来之前就采到 false。2026-09-11 main 的 Canvas Acceptance 分片 2 正是这么红的（merge
  // 0cea000d8），而**同一棵 tree**（4983ba30）在 PR #725 的同一分片上全绿——红的是断言写法不是产品。
  // 改成 web-first 断言：由 expect 自己的超时预算轮询到真信号，不新增任何私有墙钟等待（R18）。
  // 本文件 386 行附近早就为「点完立刻 isVisible()」写下过同一条教训，这里把剩下的采样点补齐。
  // 10-07 起版本入口是图片右上角内侧的数字角标（用户拍板）：只写数字，名字写着几版；节点身后不再有叠卡。
  const imageBadge = imageNode.locator('[data-version-badge]')
  await expect(imageBadge, '图片节点右上角的版本角标').toHaveAttribute('aria-label', '铺开 3 个版本')
  await expect(imageBadge, '角标只写数字').toHaveText('3')
  check('图片版本角标在、只写数字', true)
  await expect(videoNode.locator('[data-version-badge]'), '视频节点右上角的版本角标').toHaveAttribute('aria-label', '铺开 2 个版本')
  check('视频版本角标在', true)
  check('角标在图片右上角内侧', await imageBadge.evaluate((badge) => {
    const node = badge.closest('.generation-canvas-v2-node')?.getBoundingClientRect()
    const rect = badge.getBoundingClientRect()
    return Boolean(node) && rect.right <= node.right && rect.top >= node.top && rect.right > node.right - 24 && rect.top < node.top + 24
  }))
  await screenshotSettled(win, { path: path.join(outputDir, '01-real-version-stacks-light.png') })

  await imageNode.click({ position: { x: 120, y: 120 } })
  await expect(imageNode.locator('.generation-canvas-v2-node__composer-card')).toBeVisible()
  // 2026-09-10 起浮框**刻意不再避让障碍**（自研的「最大空矩形避让搜索」已连同 composerObstaclePlacement.ts
  // 一起删掉；出处见 docs/research/2026-09-10-node-composer-placement/prior-art.md）；2026-09-25 起连视口
  // clamp / 翻转也删了，位置只是「节点尺寸 + 画布缩放」的函数。所以旧的「参数卡
  // 不得与任何非选中节点相交」描述的是已经删掉的那套行为，留着只会把「今天碰巧避开了」钉成不变量。
  // 换成守新形态下真正该成立的两条，两条都跟这一幕强相关（画布上正好摊着展开的雨夜参考组）：
  //   ① 钉住（2026-09-25 用户拍板「钉在节点正下方、宽度固定、被挡就挡」，owner 是
  //      src/workbench/generationCanvas/nodes/composerCanvasPlacement.ts）：卡顶边 = 节点底边 + 14×缩放、
  //      卡中线 = 节点中线、屏幕宽恒 560。不再 clamp 进视口、不再翻到上方，所以这里没有「翻转/贴边」的例外分支——
  //      「跑到一块空地上去」「压在节点中间」这两种漂移在这条下都当场红。判据与 node-composer-placement.walk.mjs 的 assertPinned 同一口径。
  //   ② 不被别的节点盖住：卡在**画布舞台内**的采样点上命中的不许是别的节点。盖住别的节点可以（新设计就这么定的）；
  //      伸出舞台、钻到停靠区底下被挡住也可以（「被挡就挡」），所以舞台外的采样点不算、非节点的遮挡不算。
  await expect.poll(() => imageNode.evaluate((selected) => {
    const anchor = selected.querySelector('.generation-canvas-v2-node__composer')
    const card = anchor?.querySelector('.generation-canvas-v2-node__composer-card')
    const stage = selected.closest('.generation-canvas-v2__stage')
    const viewportEl = document.querySelector('.react-flow__viewport')
    if (!anchor || !card || !stage || !viewportEl) return ['参数卡还没挂上']
    const nodeRect = selected.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const stageRect = stage.getBoundingClientRect()
    // 画布缩放读 React Flow 视口自己的 transform（DOMMatrix.a）——量的是用户眼前那一帧，不读 store。
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewportEl).transform).a
    const problems = []
    // ① 顶边 = 节点底边 + 14×缩放（在节点下面，不压在节点身上）。
    const expectedTop = nodeRect.bottom + 14 * zoom
    if (Math.abs(cardRect.top - expectedTop) > 2) {
      problems.push(`浮框顶边没钉在节点底边下方（card.top=${Math.round(cardRect.top)} 期望 ${Math.round(expectedTop)}，zoom=${zoom.toFixed(2)}）`)
    }
    // ① 中线 = 节点中线。
    const centreDelta = (cardRect.left + cardRect.right) / 2 - (nodeRect.left + nodeRect.right) / 2
    if (Math.abs(centreDelta) > 2) problems.push(`浮框中线偏离节点中线 ${centreDelta.toFixed(1)}px`)
    // ① 屏幕宽恒 560。
    if (Math.abs(cardRect.width - 560) > 1) problems.push(`浮框宽 ${cardRect.width.toFixed(1)}，应恒为 560`)
    // ② 左中右三点各打一次真实命中测试；只数落在舞台内的点，只把「别的节点」算作回归。
    for (const ratio of [0.15, 0.5, 0.85]) {
      const x = cardRect.left + cardRect.width * ratio
      const y = cardRect.top + Math.min(10, cardRect.height / 2)
      if (x < stageRect.left || x > stageRect.right || y < stageRect.top || y > stageRect.bottom) continue
      const hit = document.elementFromPoint(x, y)
      if (hit && card.contains(hit)) continue
      const blockerNode = hit?.closest('article[data-node-id]')
      if (blockerNode && blockerNode !== selected) {
        problems.push(`参数卡在横向 ${Math.round(ratio * 100)}% 处被节点「${blockerNode.getAttribute('data-node-id')}」盖住`)
      }
    }
    return problems
  }), { message: '参数卡必须钉在自己节点正下方（顶边 = 节点底边 + 14×缩放、中线对齐、宽 560），并且不被别的节点盖住' }).toEqual([])
  const regenerate = imageNode.locator('.generation-canvas-v2-node__composer-card').getByRole('button', { name: '重新生成', exact: true })
  await regenerate.scrollIntoViewIfNeeded()
  await expect.poll(() => regenerate.evaluate(button => {
    const bounds = button.getBoundingClientRect()
    const card = button.closest('.generation-canvas-v2-node__composer-card').getBoundingClientRect()
    return bounds.left >= card.left && bounds.right <= card.right && bounds.top >= card.top && bounds.bottom <= card.bottom
  }), { message: '受限参数卡能滚到完整的生成按钮' }).toBe(true)

  // 版本卡片：点角标原地铺开（10-06 替换浮动小窗，10-07 入口改成角标）。最新一版贴着节点；悬停才出「设为主图 / 下载 / 删除」；点卡 = 预览。
  await clickOrFail(imageNode.locator('[data-version-badge]'), '点右上角的数字角标铺开版本')
  const grid = win.locator('[data-version-grid="image-versions"]')
  await grid.waitFor({ state: 'visible' })
  const cardOrder = () => grid.locator('[data-version-identity]').evaluateAll((items) => items.map((item) => item.getAttribute('data-version-identity')))
  const beforeOrder = await cardOrder()
  await expect(imageNode.locator('[data-version-badge]'), '铺开时角标是按下态').toHaveAttribute('aria-pressed', 'true')
  check('三版铺成三张卡，最新在前', beforeOrder.join(',') === 'image-v3,image-v2,image-v1', beforeOrder.join(','))
  await screenshotSettled(win, { path: path.join(outputDir, '02-real-version-cards-light.png') })
  const card = (identity) => grid.locator(`[data-version-identity="${identity}"]`)
  // 节点此刻是选中的：宫格铺开时不挂生成浮框（它钉在节点正下方、定宽 560，会盖住宫格下面几行；V-1054）。
  await expect.poll(() => imageNode.locator('[data-composer-host="canvas"]').count(), { message: '铺开时选中节点不挂生成浮框', timeout: stationTimeout() }).toBe(0)
  check('铺开时选中节点不挂生成浮框（不盖宫格）', true)
  // 再点空白取消选中：铺开是持久的，取消选中不收起。
  const blank = await findCanvasBlankPoint(win, { inset: 40 })
  expect(blank, '画布上找不到空白处').not.toBeNull()
  await win.mouse.click(blank.x, blank.y)
  await expectVisible(grid, '取消选中后版本卡片仍铺着（持久）')
  await card('image-v1').hover()
  await clickOrFail(card('image-v1').locator('[data-toolbar-action="set-primary"]'), '把第 1 版设为主图')
  await expect(card('image-v1'), '第一版成为主图').toHaveAttribute('data-primary', 'true')
  check('第一版成为主图', true)
  // 点卡上的动作不选中节点：一选中就浮出生成框，正好压住下面一排版本卡。
  check('点「设为主图」不选中节点（不浮出生成框压住卡片）', await win.locator('[data-composer-host="canvas"]').count() === 0 && await imageNode.evaluate((node) => !node.closest('.react-flow__node')?.classList.contains('selected')))
  check('换主图不重排版本', (await cardOrder()).join(',') === beforeOrder.join(','), (await cardOrder()).join(','))
  await imageNode.locator('[data-node-media-state="ready"]').first().waitFor({ state: 'attached', timeout: stationTimeout() })

  await clickOrFail(card('image-v2').locator('button[aria-label^="预览"]'), '点第 2 版卡片打开预览')
  const imagePreview = win.locator('[role="dialog"][aria-label*="雨夜入场"]').first()
  await expectVisible(imagePreview, '版本预览弹层应可见')
  check('版本预览载入原图', await imagePreview.locator('img[alt^="雨夜入场"]').count() === 1)
  const imagePreviewProof = await proveProbe(imagePreview, '版本预览弹层确实可被探针找到')
  await clickOrFail(imagePreview.getByRole('button', { name: '关闭预览' }), '关闭版本预览')
  await expectAbsent(imagePreview, { provenBy: imagePreviewProof, message: '关闭后版本预览应从画布移除' })
  check('点卡片只是预览，主图没变', await card('image-v1').getAttribute('data-primary') === 'true')
  check('预览开关不选中节点（弹层是挂在节点里的门户，点击不冒回节点）', await win.locator('[data-composer-host="canvas"]').count() === 0)

  const downloadPath = path.join(root, 'downloads', '雨夜入场.png')
  await launched.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, downloadPath)
  await card('image-v1').hover()
  const imageDownloadButton = card('image-v1').locator('[data-toolbar-action="download"]')
  check('版本卡提供下载入口', await imageDownloadButton.isEnabled())
  await clickOrFail(imageDownloadButton, '下载第 1 版')
  await expect.poll(() => fs.existsSync(downloadPath) && fs.statSync(downloadPath).size > 0, { message: '下载桥接应写出非空版本图片文件', timeout: stationTimeout() }).toBe(true)
  check('版本图片下载文件非空', fs.statSync(downloadPath).size > 0)

  const deleteCard = card('image-v2')
  const deleteCardProof = await proveProbe(deleteCard, '待删除的第 2 版确实铺在画布上')
  await deleteCard.hover()
  await clickOrFail(deleteCard.locator('[data-toolbar-action="delete"]'), '删除第 2 版（不弹确认框）')
  await expectAbsent(deleteCard, { provenBy: deleteCardProof, message: '删除后第 2 版从宫格里消失' })
  check('删除版本后其他版本保留', await grid.locator('[data-version-identity]').count() === 2)
  await expectVisible(win.locator('[data-toast-action]', { hasText: '撤销' }).first(), '删除后提示条给「撤销」')
  check('删除不弹确认框、提示条给撤销', await win.locator('[data-confirm-dialog-surface="confirm"]').count() === 0)

  // 按住 Alt 把一张版本卡拖到空白处 = 复制成一张只含那一版的独立素材卡（真鼠标：down / move / up，不是合成 dragstart）。
  // V-1054 真鼠标复现过：画布内核的「Alt 拖节点 = 复制整个节点」先吃掉了这一下，落出的是带全部版本的节点副本。
  const nodeIdsOnCanvas = () => win.locator('.react-flow__node[data-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')))
  const idsBeforeCopy = await nodeIdsOnCanvas()
  const copySource = card('image-v1')
  const sourceBox = await copySource.boundingBox()
  if (!sourceBox) throw new Error('第 1 版卡没有可拖的边界')
  const dropAt = await findCanvasBlankPoint(win, { inset: 80 })
  expect(dropAt, '画布上找不到放副本的空白处').not.toBeNull()
  const grabAt = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 }
  await win.keyboard.down('Alt')
  await win.mouse.move(grabAt.x, grabAt.y)
  await win.mouse.down()
  await win.mouse.move(grabAt.x + 4, grabAt.y + 3)
  await win.mouse.move(dropAt.x, dropAt.y, { steps: 20 })
  await win.mouse.up()
  await win.keyboard.up('Alt')
  await expect.poll(async () => (await nodeIdsOnCanvas()).length, { message: 'Alt 拖版本卡：画布上多出一张卡', timeout: stationTimeout() }).toBe(idsBeforeCopy.length + 1)
  const copiedId = (await nodeIdsOnCanvas()).find((id) => !idsBeforeCopy.includes(id))
  const copied = win.locator(`.react-flow__node[data-id="${copiedId}"]`)
  check('Alt 拖版本卡：多出来的不是节点副本（没有带版本角标）', await copied.locator('[data-version-badge]').count() === 0, String(copiedId))
  check('Alt 拖版本卡：多出来的就是被拖的那一版', (await copied.locator('img').first().getAttribute('src') || '').includes('rain-1.svg'))
  check('Alt 拖版本卡：原节点没被复制、版本一张不少', !(await nodeIdsOnCanvas()).some((id) => id !== 'image-versions' && id.startsWith('image-versions')) && await grid.locator('[data-version-identity]').count() === 2)
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect.poll(async () => (await nodeIdsOnCanvas()).length, { message: '⌘Z 一次撤掉复制出来的卡', timeout: stationTimeout() }).toBe(idsBeforeCopy.length)

  // 宫格开着时按 Esc 就收起：焦点在画布空白处也算（V-1054：以前只认焦点在角标 / 宫格里）。
  const escBlank = await findCanvasBlankPoint(win, { inset: 40 })
  expect(escBlank, '画布上找不到空白处').not.toBeNull()
  await win.mouse.click(escBlank.x, escBlank.y)
  await win.keyboard.press('Escape')
  await expectHidden(grid, '焦点在画布空白处按 Esc，版本卡片应收起')
  await imageNode.click({ position: { x: 120, y: 120 } })
  // 打开时适应全貌（useAutoFitOnLoad）后这张图贴着舞台左缘，节点上方的浮条以前左半截压在项目资源管理器底下，
  // 用户得自己把画布拖开才点得到「复制为变体」。现在的不变量：任何位置选中节点，浮条都整条在可见舞台里，不用拖——
  // 初始位置（贴左缘）、被推到左边、被推到右边、窄窗口折两行，四种都验。
  await expectToolbarInsideStageEverywhere(win, imageNode, imageNode.locator('[data-node-floating-toolbar="true"]'), '图片节点浮条')
  // 2026-09-25 用户拍板「程序不再主动平移 / 缩放画布」：复制变体以前会自动聚焦过去（撤销时再退回原视角），
  // 两扇门都删了。现在验：复制前后视口逐格相同；变体要么落在舞台里，要么边缘提示指得到它、点一下框住
  // （判据在 _canvasHit.mjs expectArrivalsReachable）；撤销只删节点，同样不挪画布。
  const viewportBeforeDuplicate = await waitForCanvasViewportSettled(win)
  await clickOrFail(imageNode.getByRole('button', { name: '复制为变体' }), '复制当前节点为无结果的新变体')
  const duplicateArrival = await expectArrivalsReachable(win, {
    knownIds: nodes.map((node) => node.id), expectedCount: 1, viewportBefore: viewportBeforeDuplicate, label: '复制为变体',
  })
  const [duplicateId] = duplicateArrival.ids
  expect(duplicateId, '复制出来的是一张新变体节点').toMatch(/^gen-v2-/)
  await expect(win.locator(`.generation-canvas-v2-node[data-node-id="${duplicateId}"]`), '复制变体应选中新节点').toHaveAttribute('data-selected', 'true')
  const duplicateFlowNode = win.locator(`.react-flow__node[data-id="${duplicateId}"]`)
  await expectVisible(duplicateFlowNode, '复制出的变体看得到：落在舞台里，或点边缘提示过去（画布不替用户挪）')
  const duplicateProbe = await proveProbe(duplicateFlowNode, '复制出的变体已真实渲染')
  check('复制变体新增一个节点、画布没自己动、用户看得到它', true, duplicateArrival.path)
  const viewportBeforeUndo = await waitForCanvasViewportSettled(win)
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expectAbsent(duplicateFlowNode, { provenBy: duplicateProbe, message: '撤销应同时移除复制节点和继承连线' })
  check('复制变体可一次撤销', true)
  await expectCanvasViewportHeld(win, viewportBeforeUndo, '撤销复制只删节点，不替用户挪画布（不再「退回复制前的视角」）')
  check('撤销复制不挪画布', true)

  // 复制本身不挪画布；但若刚才走了边缘提示，视角停在变体那里，视频节点可能已在屏外。
  // 像用户一样点「适应视图」找回全部节点，再去铺开另一个节点的版本卡片。
  await clickOrFail(win.getByLabel('适应视图', { exact: true }), '找回视频节点后查看历史版本')
  await clickOrFail(videoNode.locator('[data-version-badge]'), '点视频节点的角标铺开版本')
  const videoGrid = win.locator('[data-version-grid="video-versions"]')
  await videoGrid.waitFor({ state: 'visible', timeout: stationTimeout() })
  await expect.poll(() => videoGrid.evaluate((grid) => {
    const stage = grid.closest('.generation-canvas-v2__stage')
    if (!stage) return false
    const cards = [...grid.querySelectorAll('[data-version-identity]')].map((card) => card.getBoundingClientRect())
    const stageRect = stage.getBoundingClientRect()
    return cards.length > 0 && cards.every((rect) => rect.left >= stageRect.left && rect.right <= stageRect.right)
  }), { message: '版本卡片应完整位于画布可见区（右边放不下就往左铺，不挪画布）', timeout: stationTimeout() }).toBe(true)
  check('版本卡片避开画布视口边缘', true, (await videoGrid.getAttribute('data-version-grid-placement')) || '')
  const videoHistoryCard = videoGrid.locator('[data-version-identity="video-v1"]')
  const historyVideo = videoHistoryCard.locator('video').first()
  await videoHistoryCard.hover()
  await historyVideo.waitFor({ state: 'visible', timeout: stationTimeout() })
  check('悬停视频版本卡真实播放元素可见', true)
  check('视频版本卡默认静音', await historyVideo.evaluate((video) => video.muted === true))
  const videoProgress = videoHistoryCard.getByRole('slider', { name: '视频进度' })
  await expect.poll(async () => Number(await videoProgress.getAttribute('aria-valuemax')), { message: '视频版本卡应加载可拖动时长', timeout: stationTimeout() }).toBeGreaterThan(0)
  const progressBox = await videoProgress.boundingBox()
  check('视频版本卡进度条可见', Boolean(progressBox))
  if (!progressBox) throw new Error('视频版本卡进度条没有可交互边界')
  await win.mouse.move(progressBox.x + progressBox.width * 0.2, progressBox.y + progressBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(progressBox.x + progressBox.width * 0.75, progressBox.y + progressBox.height / 2, { steps: 5 })
  await win.mouse.up()
  const draggedTime = Number(await videoProgress.getAttribute('aria-valuenow'))
  check('拖动进度条连续跳转', draggedTime > 0, String(draggedTime))
  await videoProgress.press('ArrowLeft')
  const nudgedTime = Number(await videoProgress.getAttribute('aria-valuenow'))
  check('键盘左键精确回退一秒', Math.abs(nudgedTime - Math.max(0, draggedTime - 1)) < 0.2, `${draggedTime} -> ${nudgedTime}`)
  await screenshotSettled(win, { path: path.join(outputDir, '03-real-video-version-scrub-light.png') })
  await videoProgress.blur()
  await win.mouse.move(12, 12)
  await expect.poll(() => historyVideo.evaluate((video) => video.paused && video.currentTime < 0.2), { message: '离开视频版本卡后播放暂停并回到起点', timeout: stationTimeout() }).toBe(true)
  check('离开视频版本卡后播放暂停并回到起点', true)
  // 人是先悬停、看到卡在播再点。悬停那一下视频才挂上来、换掉封面；按下和松开之间要是正赶上这次换图，
  // 浏览器会补发一次 mousemove，画布内核（节点点击距离 0）就把这一下当成拖、吞掉点击。所以先悬停等它播起来再点。
  await videoHistoryCard.hover()
  await expectVisible(videoHistoryCard.locator('[data-version-card-bar]'), '悬停视频版本卡出动作条')
  await expect.poll(() => historyVideo.evaluate((video) => !video.paused), { message: '悬停后视频版本卡在播', timeout: stationTimeout() }).toBe(true)
  await clickOrFail(videoHistoryCard.locator('button[aria-label^="预览"]'), '点视频版本卡打开预览')
  const videoPreview = win.locator('[role="dialog"][aria-label*="推镜进入咖啡馆"]').first()
  await expectVisible(videoPreview, '视频版本预览弹层应可见')
  const previewVideo = videoPreview.locator('video').first()
  await previewVideo.waitFor({ state: 'attached', timeout: stationTimeout() })
  check('视频版本预览挂载视频元素', await previewVideo.count() === 1)
  check('视频版本预览提供原生控制条', await previewVideo.getAttribute('controls') !== null)
  const videoPreviewProof = await proveProbe(videoPreview, '视频版本预览弹层确实可被探针找到')
  await clickOrFail(videoPreview.getByRole('button', { name: '关闭预览' }), '关闭视频版本预览')
  await expectAbsent(videoPreview, { provenBy: videoPreviewProof, message: '关闭后视频版本预览应从画布移除' })
  await clickOrFail(videoNode.locator('[data-version-badge]'), '再点角标收起视频版本')
  await expectHidden(videoGrid, '视频版本卡片应收起')

  // 折叠入口 = 框边右键菜单「折叠成卡」（框头上的折叠钮已删，10-10 拍板）。
  const referenceFrame = win.locator('.generation-canvas-v2__group-box[data-group-id="reference-group"]').first()
  await referenceFrame.scrollIntoViewIfNeeded()
  await openFrameMenuFromToolbar(win, referenceFrame)
  await clickOrFail(win.locator('[data-frame-menu="true"]').getByRole('menuitem', { name: uiText('zh-CN', 'generationCommon.canvas.group.menuCollapse') }).first(), '把雨夜参考组收成节点卡组')
  const collapsed = win.locator('[data-collapsed-group-id="reference-group"]')
  await expectVisible(collapsed, '收起后应显示一张编组卡')
  await expectCount(collapsed, 1, '收起后只保留一张编组卡')
  check('收起后只剩一个组卡', true)
  await expectAbsent(groupMembers, { provenBy: groupMembersProof, message: '收起后组内三个成员节点不再各自占画布' })
  check('三位成员已从画布投影隐藏', true)
  // 同上：收起动画刚落地那一帧采样会假红，交给 web-first 断言等真信号。
  await expectVisible(collapsed.getByRole('button', { name: '3 节点' }), '编组卡应显示「3 节点」语义')
  check('编组显示节点语义', true)
  // 编组的「+」（2026-09-24 拍板）：选中才出，挂在画布内核里的编组端口节点上（model/groupPort.ts），
  // 不再是折叠卡上常驻的两颗旧按钮（那两颗在 v0.22 按下会亮、拖出去不连线，已删）。
  const groupRings = win.locator('.react-flow__node[data-id="reference-group"] .react-flow__handle[data-affordance="magnetic"]')
  await expectCount(groupRings, 0, '未选中的折叠编组不出「+」圈')
  check('未选中的折叠编组不出「+」圈', true)
  const collapsedBody = collapsed.locator('[role="group"]')
  const bodyBox = await collapsedBody.boundingBox()
  if (!bodyBox) throw new Error('折叠编组卡身没有可点的边界')
  await win.mouse.click(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height * 0.4)
  await expectVisible(collapsed.locator('[data-frame-selected="true"]'), '点折叠卡身应选中这个编组（边框亮）')
  await expectCount(groupRings, 2, '选中的折叠编组左右各出一个「+」圈')
  const ringStates = await groupRings.evaluateAll((handles) => handles.map((handle) => {
    const icon = handle.querySelector('.generation-canvas-react-flow__handle-icon')
    const r = icon?.getBoundingClientRect()
    const top = r && r.width > 0 ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null
    // 只算画布里的遮挡（卡面 / 卡上控件）：卡摆在画布边缘时圈落到侧边工具栏底下，是视口问题，平移即可（同 canvas-handles-alt-drag 的判据）。
    const coveredOnCanvas = Boolean(top && !handle.contains(top) && top.closest('.react-flow__node'))
    return { side: handle.getAttribute('data-side'), hasPlusIcon: Boolean(icon?.querySelector('svg')), onTop: !coveredOnCanvas, coveredBy: coveredOnCanvas ? top.outerHTML.slice(0, 160) : null }
  }))
  check(
    '选中的折叠编组左右「+」圈可见、带加号、没被画布上的卡盖住',
    ringStates.map(({ side }) => side).sort().join(',') === 'left,right'
      && ringStates.every(({ hasPlusIcon, onTop }) => hasPlusIcon && onTop),
    JSON.stringify(ringStates),
  )
  await screenshotSettled(win, { path: path.join(outputDir, '04a-real-collapsed-group-selected-rings.png') })
  // 退出选中再点聚合线：圈的命中带伸在卡外，别让它挡住后面要点的那条线。
  const paneBox = await win.locator('.react-flow__pane').boundingBox()
  await win.mouse.click(paneBox.x + paneBox.width - 40, paneBox.y + 40)
  await expectCount(groupRings, 0, '点空白后折叠编组退出选中、「+」圈收起')
  // 退出选中后聚合线要等 React Flow 重新投影一帧才出现：瞬时 count() 在慢机器（CI）上会读到 0 假红
  // （2026-09-24 PR #862 Linux 撞到，本机 Windows 干净 main / 分支都绿）。等真信号，线真画不出来照样超时红。
  await expectCount(win.locator('g[data-aggregate-group="reference-group"]'), 1, '三条成员输入应聚合为一条编组线')
  check('三条成员输入聚合为一条编组线', true)
  // 连线是贝塞尔曲线：`locator.click()` 点的是外接盒中心，而曲线的外接盒中心不在曲线上——
  // 那一点谁盖着就点到谁（面板展开把画布收窄后，那里正好是选中节点的提示词面板，
  // Playwright 报 "subtree intercepts pointer events"）。用户点的是线本身，走查也点线本身。
  const aggregatePoint = await findEdgeHitPoint(win, {
    edgeSelector: 'g[data-aggregate-group="reference-group"] path[role="button"]',
  })
  check('聚合编组输入线上存在真的点得到的点', Boolean(aggregatePoint), JSON.stringify(aggregatePoint))
  await win.mouse.click(aggregatePoint.x, aggregatePoint.y)
  // 2026-10-08 用户「删掉连线中间的标签吗，没有作用」：连线中点不挂任何字。编组关系用不可见的方式验证：边带编组 id / 方向属性，
  // 「×」的读屏名是「断开整条编组连接」（不是某条成员边的断开）；界面上没有任何模式 / 标签文字，也没有伪造成员模式。
  const aggregateEdge = win.locator('g[data-aggregate-group="reference-group"]')
  await expect(aggregateEdge, '聚合线带编组方向（不可见属性）').toHaveAttribute('data-aggregate-direction', 'input')
  await expectVisible(win.getByRole('button', { name: uiText('zh-CN', 'generationCommon.canvas.group.disconnectAggregate'), exact: true }), '聚合线选中后的「×」读屏名是断开整条编组连接')
  // 正向断言：聚合线中点那一层只有「×」、没有任何文字（没有模式胶囊 / 「编组输入」字样）。
  await expect(win.locator('.generation-canvas-v2__edge-control > *'), '聚合线中点只有「×」一个控件').toHaveCount(1)
  await expect(win.locator('.generation-canvas-v2__edge-control'), '聚合线中点没有任何文字').toHaveText('')
  await screenshotSettled(win, { path: path.join(outputDir, '04-real-collapsed-group-link-light.png') })

  await expect.poll(() => {
    const current = JSON.parse(fs.readFileSync(path.join(projectRoot, '.nomi', 'project.json'), 'utf8'))
    return current.payload.generationCanvas.groups.find((entry) => entry.id === 'reference-group')?.collapsed
  }, { message: '重开前收起状态应已持久化' }).toBe(true)
  await returnToLibrary()
  check('返回项目库仍能看到两个项目', await win.locator('[data-project-card]').count() === 2)
  await openProjectCanvas('卡片堆叠体验验收')
  const reopenedImageNode = win.locator('[data-node-id="image-versions"]')
  const reopenedGroupMembers = win.locator('[data-node-id="group-character"], [data-node-id="group-scene"], [data-node-id="group-style"]')
  const reopenedCollapsed = win.locator('[data-collapsed-group-id="reference-group"]')
  await expectVisible(reopenedCollapsed, '重新打开项目后编组仍应保持收起')
  await expectAbsent(reopenedGroupMembers, { provenBy: groupMembersProof, message: '重新打开项目后组成员仍应隐藏' })
  check('重新打开后节点与聚合连接仍在', await win.locator('g[data-aggregate-group="reference-group"]').count() === 1)
  await clickOrFail(reopenedImageNode.locator('[data-version-badge]'), '铺开重开项目里的版本卡片')
  const reopenedGrid = win.locator('[data-version-grid="image-versions"]')
  await expectVisible(reopenedGrid, '重新打开后版本卡片可用')
  check('重新打开后删剩的两版仍在、号不变', (await reopenedGrid.locator('[data-version-card]').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-version-card')))).join(',') === '3,1')
  await clickOrFail(reopenedImageNode.locator('[data-version-badge]'), '收起重开项目里的版本卡片')

  await clickOrFail(collapsed.getByRole('button', { name: '3 节点' }), '展开雨夜参考组')
  await expectVisible(win.locator('[data-node-id="group-character"]'), '点击卡角后应恢复组内节点')
  // expectVisible above is the web-first assertion; do not immediately sample
  // isVisible(), which can race the React Flow expand animation and re-mount.
  check('点击卡角恢复组内节点', true)
  await expect.poll(() => win.locator('g[data-edge-id^="group-input-"]').count(), { message: '展开后真实成员输入线应完成投影' }).toBe(3)
  check('展开后恢复三条真实成员输入线', true)

  await openFrameMenuFromToolbar(win, referenceFrame)
  await clickOrFail(win.locator('[data-frame-menu="true"]').getByRole('menuitem', { name: uiText('zh-CN', 'generationCommon.canvas.group.menuCollapse') }).first(), '再次收起雨夜参考组')
  await expectVisible(collapsed, '再次收起后应恢复编组卡')
  await applyColorSchemeForShot(win, 'dark')
  await screenshotSettled(win, { path: path.join(outputDir, '05-real-collapsed-group-dark.png') })

  // Reopening changes the path geometry; sample its actual hit target again.
  const reopenedAggregatePoint = await findEdgeHitPoint(win, {
    edgeSelector: 'g[data-aggregate-group="reference-group"] path[role="button"]',
  })
  check('重开后聚合编组输入线仍有真实可点击点', Boolean(reopenedAggregatePoint), JSON.stringify(reopenedAggregatePoint))
  await win.mouse.click(reopenedAggregatePoint.x, reopenedAggregatePoint.y)
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

  // 10-08 外壳重设计：素材库住左栏「素材」抽屉（60px 图标栏 + 抽屉），不再是可展开的资源管理器侧栏。
  const assetLibraryTab = win.locator('[data-shell-rail-item="assets"]').first()
  if (await assetLibraryTab.getAttribute('aria-pressed') !== 'true') await clickOrFail(assetLibraryTab, '点左栏「素材」打开素材抽屉')
  await expect.poll(() => assetLibraryTab.getAttribute('aria-pressed'), { message: '「素材」应成为当前打开的抽屉' }).toBe('true')
  const assetLibraryPanel = win.locator('[data-shell-drawer="assets"] section[aria-label="素材库"]')
  await expectVisible(assetLibraryPanel, '切换标签后素材库面板应完成渲染')
  check('展开后素材库面板可见', true)
  await returnToLibrary()
  await openProjectCanvas('第二个项目 · F8 切换验收')
  // 换项目时抽屉自动关上（ShellRail 跟着 projectId 关抽屉），不把上一个项目的素材抽屉开着带过来。
  check('切换项目后左栏抽屉自动关上', (await win.locator('[data-shell-drawer]').count()) === 0
    && await win.locator('[data-shell-rail-item="assets"]').first().getAttribute('aria-pressed') === 'false')
  await screenshotSettled(win, { path: path.join(outputDir, '06-real-project-switch-sidebar-collapsed.png') })
  fs.writeFileSync(path.join(outputDir, 'walk-report.json'), JSON.stringify({ checks, projectRoot }, null, 2))
  console.log(JSON.stringify({ ok: true, checks }, null, 2))
} finally {
  await launched.close().catch(() => undefined)
}
