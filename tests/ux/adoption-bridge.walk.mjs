// P5 E1 R13 走查（零额度）：产物 → 加入时间轴 → 预览有段 → 一步 Undo 复原。
// 只播种一个已有产物，不触发生成；四路隔离目录都显式设置，尤其是 NOMI_CAPABILITY_DIR。
// 用法：pnpm run build && node tests/ux/adoption-bridge.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, proveProbe, DEFAULT_TIMEOUT_MS, screenshotSettled } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/adoption-bridge')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-adoption-bridge-'))
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const projectId = 'adoption-bridge-walk'
const projectRoot = path.join(projectsDir, `adoption-${projectId}`)
fs.mkdirSync(projectRoot, { recursive: true })
const swatch = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#2f6f8f"/></svg>',
)
const nodes = [{
  id: 'adoption-shot-1', kind: 'image', title: '采纳桥镜头 1', categoryId: 'shots', shotIndex: 1,
  position: { x: 160, y: 120 }, result: { id: 'adoption-artifact-1', type: 'image', url: swatch, createdAt: 1 },
}, {
  // 第二个产物专供拖拽腿：拖拽和点击各用各的产物，两条腿的断言不会互相污染。
  id: 'adoption-shot-2', kind: 'image', title: '采纳桥镜头 2', categoryId: 'shots', shotIndex: 2,
  position: { x: 420, y: 120 }, result: { id: 'adoption-artifact-2', type: 'image', url: swatch, createdAt: 2 },
}]
const project = {
  id: projectId, name: 'P5 E1 采纳桥走查', version: 1, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocument: { version: 1, title: 'P5 E1 采纳桥走查', updatedAt: 1, contentJson: { type: 'doc', content: [] } },
    timeline: null,
    generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
    storyboardPlan: null, storyboardPlanCommitted: false,
  },
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))

let app
let win
let failed

/**
 * 起一个实例并把窗口调到固定尺寸。
 *
 * **不用 `win.reload()`**：原地刷新后活动项目会话为空（getActiveWorkbenchProjectId() 恒 null），
 * 面板会静默空掉——那副样子和「真 bug」一模一样，截图看起来像功能坏了。
 * 要让 localStorage 的主题/引导标记生效，只能关掉再用**同一个 userDataDir** 冷启动。
 */
async function launch(name, settleMs = 1200) {
  const launched = await launchNomiApp({
    name, userDataDir, settingsDir, projectsDir,
    env: { NOMI_CAPABILITY_DIR: capabilityDir },
    args: ['--disable-gpu'], timeout: 300000, settleMs,
  })
  app = launched.app
  win = app.windows().find((candidate) => !candidate.isClosed()) || app.firstWindow()
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((windowRef, bounds) => windowRef.setBounds(bounds), { x: 0, y: 0, width: 1440, height: 960 })
  await win.waitForTimeout(500)
  return win
}

async function shutdown() {
  await win?.close().catch(() => {})
  await app?.close().catch(() => {})
}

/** 打开走查项目并切到预览步骤。冷启动后每次都要重走，因为会话不跨实例。 */
async function openProjectToPreview() {
  const projectCard = win.getByText('P5 E1 采纳桥走查', { exact: false }).first()
  await expect(projectCard, '项目卡没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await projectCard.hover()
  await clickOrFail(win.getByRole('button', { name: /继续创作/ }).first(), '打开 P5 E1 采纳桥项目')
  await win.waitForFunction(() => /projectId=/.test(location.href), undefined, { timeout: DEFAULT_TIMEOUT_MS })
  const previewTab = win.locator('nav.nomi-stepper [data-mode="preview"]').first()
  await clickOrFail(previewTab, '预览 tab')
  await expect(previewTab, '预览 tab 点击后没有切换 active').toHaveAttribute('aria-current', 'page', { timeout: DEFAULT_TIMEOUT_MS })
  await win.waitForFunction(() => new URL(location.href).searchParams.get('step') === 'preview', undefined, { timeout: DEFAULT_TIMEOUT_MS })
}

try {
  await launch('adoption-bridge')
  await win.evaluate(() => {
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
    localStorage.setItem('nomi-color-scheme', 'dark')
  })
  // 冷启动让上面写的标记生效（不是 win.reload()，理由见 launch 的注释）。
  await shutdown()
  await launch('adoption-bridge-dark')
  await openProjectToPreview()

  // ── 腿 1：点击贴尾 ────────────────────────────────────────────────
  const sourceButton = win.getByRole('button', { name: /采纳桥镜头 1.*点击加到片尾/ }).first()
  await expect(sourceButton, '生成产物来源按钮没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await proveProbe(sourceButton, '预览区确实渲染了产物来源按钮')
  await clickOrFail(sourceButton, '加入时间轴（点击贴尾）')

  const timelineClip = win.locator('.workbench-preview [data-testid="timeline-clip"]').first()
  await expect(timelineClip, '加入时间轴后预览没有出现片段').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await screenshotSettled(win, { path: path.join(shotsDir, '01-dark-applied.png') })
  const clipProof = await proveProbe(timelineClip, '加入时间轴后片段确实可见')

  const undo = win.getByRole('button', { name: /撤销时间轴编辑/ }).first()
  await clickOrFail(undo, '一步撤销采纳')
  await expectAbsent(timelineClip, { provenBy: clipProof, message: '一步 Undo 后片段应从时间轴复原' })
  await screenshotSettled(win, { path: path.join(shotsDir, '02-dark-undone.png') })

  // ── 腿 2：拖拽落轴 ────────────────────────────────────────────────
  // 这条腿是本次修复的**核心回归**：拖拽路径此前绕过采纳桥直写时间轴，
  // 而走查只有点击腿，所以那条旁路一直没被走查抓到（门岗也扫不到它）。
  // 判据不是「轴上多了个片段」——直写也能做到——而是**一步 Undo 能不能整个撤掉**：
  // 只有走桥的落轴才压一层栈，直写会压成另一番样子。
  //
  // 定位器按 data-testid + nodeId 取，**不按文字**：这张卡的可见文字只有角标序号「2」，
  // 名字只活在 aria-label/title 里，`hasText: '采纳桥镜头 2'` 永远匹配不上——
  // 上一版正是这么写的，于是这条腿从来没真正跑到过（静态门岗看不出，它不执行走查）。
  // 另外页面上还有画布节点把手也是 [draggable="true"]，裸选会撞上它们。
  // 先等点击腿那张「已加入时间轴末尾」自然消失，再拖。
  // 否则下面「不该出现末尾文案」的断言会被腿 1 的残留回执误伤——
  // 那是仪器脏，不是产品坏，必须先把现场清干净再断言。
  await expect(
    win.getByText('已加入时间轴末尾', { exact: false }),
    '点击腿的回执迟迟不消失，拖拽腿的文案断言会被它污染',
  ).toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS })

  const dragSource = win
    .locator('.workbench-preview [data-testid="preview-source-shot"][data-node-id="adoption-shot-2"]')
    .first()
  await expect(dragSource, '拖拽用的产物来源没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const dragProof = await proveProbe(dragSource, '预览区确实渲染了可拖拽的产物来源')
  // 落点三个坑，都是探针量出来的（读源码看不出）：
  //  ① 必须 `.workbench-preview` 限定域：生成页那套时间轴同时挂载着（祖先 display:none），
  //     裸 .first() 会抓到那份零尺寸的隐藏轨，等到超时也不会可见——点击腿早就这么限定了。
  //  ② 落点要内层 __clips：drop/dragover handler 挂在它上面，外层 [data-testid] 只是网格容器。
  //  ③ __clips 宽 3600px 远超视口，dragTo 默认取几何中心 → 落在视口外收不到 drop，
  //     所以显式给 targetPosition，落在轨道左端可见处。
  const imageTrackClips = win
    .locator('.workbench-preview [data-testid="timeline-track"][data-track-type="image"] .workbench-timeline-track__clips')
    .first()
  await expect(imageTrackClips, '时间轴图片轨没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await dragSource.dragTo(imageTrackClips, { targetPosition: { x: 60, y: 23 } })

  const draggedClip = win.locator('.workbench-preview [data-testid="timeline-clip"]').first()
  await expect(draggedClip, '拖拽落轴后时间轴没有出现片段').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })

  // 回执必须说**落点**，不是「末尾」。用户明明拖到了指定位置，报「已加入时间轴末尾」
  // 就是回执在说假话——此前没有任何断言盖住这句话，只能靠人眼看截图才发现。
  const dropReceipt = win.getByText('已加入时间轴指定位置', { exact: false }).first()
  await expect(dropReceipt, '拖拽落轴的回执没有出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  const receiptProof = await proveProbe(dropReceipt, '拖拽回执确实按落点措辞')
  await expect(
    win.getByText('已加入时间轴末尾', { exact: false }),
    '拖拽落轴却报「已加入时间轴末尾」——回执在说假话',
  ).toHaveCount(0, { timeout: DEFAULT_TIMEOUT_MS })
  await screenshotSettled(win, { path: path.join(shotsDir, '03-dark-drag-applied.png') })
  const draggedProof = await proveProbe(draggedClip, '拖拽落轴后片段确实可见')

  await clickOrFail(win.getByRole('button', { name: /撤销时间轴编辑/ }).first(), '一步撤销拖拽采纳')
  await expectAbsent(draggedClip, {
    provenBy: draggedProof,
    message: '拖拽落轴后一步 Undo 应整体复原（没复原 = 拖拽路径没走采纳桥）',
  })
  // 采纳被别的途径撤掉后，那张还挂着的回执**不能再提供撤销**——
  // 它此刻弹的是上一笔无关编辑，会静默毁掉用户没要求撤的东西。
  await expectAbsent(dropReceipt, {
    provenBy: receiptProof,
    message: '撤销后残留的回执仍在（它的「撤销」会弹掉无关编辑）',
  })
  await screenshotSettled(win, { path: path.join(shotsDir, '04-dark-drag-undone.png') })
  if (!dragProof) throw new Error('拖拽来源探针未成立')

  // ── 光色证据 ────────────────────────────────────────────────────
  // 同一真实入口再取一张光色证据，确保采纳桥回执在两套 token 下都不依赖颜色才能理解。
  // 这里同样是**冷启动**而不是 win.reload()：原地刷新会把活动项目会话清空，
  // 面板静默空掉，拍出来的「光色截图」其实是一张退化页面。
  await win.evaluate(() => localStorage.setItem('nomi-color-scheme', 'light'))
  await shutdown()
  await launch('adoption-bridge-light')
  await openProjectToPreview()
  await screenshotSettled(win, { path: path.join(shotsDir, '05-light-restored.png') })
  // 正向探针的阳性对照，避免「光色截图」其实拍到错误页面。
  await expect(
    win.getByRole('button', { name: /采纳桥镜头 1.*点击加到片尾/ }).first(),
    '光色重开后产物来源探针失效',
  ).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  console.log(`✅ P5 E1 采纳桥走查通过（点击腿 + 拖拽腿）；光/暗截图见 ${shotsDir}`)
} catch (error) {
  failed = error
} finally {
  await shutdown()
}
if (failed) {
  console.error(`❌ ${failed.message}`)
  process.exit(1)
}
