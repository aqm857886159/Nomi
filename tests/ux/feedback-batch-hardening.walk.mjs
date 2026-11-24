// 2026-08-06 feedback batch: real Electron journey for edge semantics, multi-result lifecycle,
// critical canvas text surfaces in both themes, and corrupt-manifest recovery.
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { expect, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { findCanvasBlankPoint, findEdgeHitPoint, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { canvasAddBar, canvasSetZoomPercent, createBlankProject, leaveProjectIfOpen, switchWorkspace, openRailDrawer } from './_shell.mjs'
import { assertOutsideRepo } from './uiDriverOptions.mjs'
import { uiText } from './full-walk/invariants.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = assertOutsideRepo(makeTempDir('nomi-feedback-batch-shots-'))
process.env.EVIDENCE_DIR = outDir
const fixtureDir = makeTempDir('nomi-feedback-batch-profile-')
const settingsDir = path.join(fixtureDir, 'settings')
const projectsDir = path.join(fixtureDir, 'projects')
for (const target of [settingsDir, projectsDir]) fs.mkdirSync(target)

const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da62f80f0400009f01012f713ba40000000049454e44ae426082',
  'hex',
)
const launch = async () => {
  const result = await launchNomiApp({
    name: 'feedback-batch',
    settingsDir,
    projectsDir,
    env: { NOMI_RENDERER_URL: `file://${path.join(repoRoot, 'dist', 'index.html')}` },
    settleMs: 1600,
  })
  const browserWindow = await result.app.browserWindow(result.win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})
  const skip = result.win.getByText('跳过', { exact: true }).first()
  if (await skip.isVisible().catch(() => false)) await skip.click()
  return result
}
const shot = async (win, name) => {
  await screenshotSettled(win, { path: path.join(outDir, name) })
  console.log(`  📸 ${name}`)
}

// Verify the toolbar in its own workspace so its canvas history never replays over the seeded fixture.
let projectRoot
{
  const { app, win } = await launch()
  await createBlankProject(win)
  await win.keyboard.press('Escape').catch(() => {})
  await switchWorkspace(win, 'generation', '切到生成区')
  await win.waitForTimeout(700)
  await canvasAddBar(win).locator('[data-add-intent="image"]').click()
  await expect(win.locator('.generation-canvas-v2-node')).toHaveCount(1)
  await leaveProjectIfOpen(win)
  await createBlankProject(win, '新建走查夹具项目')
  projectRoot = await win.evaluate(async () => {
    const projectId = new URLSearchParams(location.hash.split('?')[1]).get('projectId')
    const projects = await window.nomiDesktop.projects.listAsync()
    return projects.find((project) => project.id === projectId)?.rootPath
  })
  expect(projectRoot, '夹具项目有已登记的本地目录').toBeTruthy()
  await app.close()
}

const projectFile = path.join(projectRoot, '.nomi', 'project.json')
const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
const projectCard = (win) => win.locator(`[data-project-id="${project.id}"]`)
const continueProject = (win) => projectCard(win).getByRole('button', {
  name: uiText('zh-CN', 'library.continueCreating'), exact: true,
})
const assetDir = path.join(projectRoot, 'assets', 'generated', '2026-08-06')
fs.mkdirSync(assetDir, { recursive: true })
for (const name of ['role.png', 'main.png', 'alternate-a.png', 'alternate-b.png']) {
  fs.writeFileSync(path.join(assetDir, name), png)
}
const assetUrl = (name) => `nomi-local://asset/${encodeURIComponent(project.id)}/assets/generated/2026-08-06/${name}`
const result = (id, name, versionNo) => ({ id, type: 'image', url: assetUrl(name), createdAt: versionNo, versionNo })
const roleResult = result('role-result', 'role.png', 1)
const mainResult = result('main-result', 'main.png', 3)
const alternateA = result('alternate-a', 'alternate-a.png', 2)
const alternateB = result('alternate-b', 'alternate-b.png', 1)
project.payload.generationCanvas = {
  nodes: [
    {
      id: 'role-node', kind: 'character', title: '角色参考', categoryId: 'shots', groupId: 'group-a',
      position: { x: 260, y: 240 }, status: 'success', result: roleResult, history: [roleResult],
    },
    {
      id: 'shot-node', kind: 'image', title: '镜头结果', categoryId: 'shots', groupId: 'group-a',
      position: { x: 690, y: 235 }, size: { width: 420, height: 250 }, status: 'success',
      prompt: '雨夜街道，角色回头，电影光影', result: mainResult,
      history: [mainResult, alternateA, alternateB], meta: { aspect_ratio: '16:9' },
    },
  ],
  edges: [{ id: 'edge-style', source: 'role-node', target: 'shot-node', mode: 'style_ref' }],
  groups: [{ id: 'group-a', name: '分镜组', color: '#8a6a42' }],
  selectedNodeIds: [],
}
fs.writeFileSync(projectFile, `${JSON.stringify(project, null, 2)}\n`)

// Visual and interaction journey.
{
  const { app, win } = await launch()
  // 夹具在 App 外替换了清单，按项目库的现役流程确认这份外部更新。
  const syncBadge = projectCard(win).locator('[data-sync-status]')
  await expectVisible(syncBadge, '项目库已检查夹具状态')
  if (await syncBadge.getAttribute('data-sync-status') === 'external-change') {
    await syncBadge.click()
    const syncDialog = win.getByRole('dialog', { name: uiText('zh-CN', 'library.syncDetailsExternal'), exact: true })
    await syncDialog.getByRole('button', { name: uiText('zh-CN', 'library.syncRecheck'), exact: true }).click()
    await expect(syncDialog).toBeHidden()
  }
  await expect(syncBadge).toHaveAttribute('data-sync-status', 'ready')
  await continueProject(win).click()
  await win.waitForTimeout(2200)
  await switchWorkspace(win, 'generation', '切到生成区')
  await win.waitForTimeout(1100)

  const edge = win.locator('.generation-canvas-v2__edge[data-edge-id="edge-style"]')
  const edgePath = edge.locator('.generation-canvas-v2__edge-path')
  const hitSelector = '.generation-canvas-v2__edge[data-edge-id="edge-style"] .generation-canvas-v2__edge-hit'
  const readEdgePoint = async () => {
    let point
    await expect.poll(async () => {
      point = await findEdgeHitPoint(win, { edgeSelector: hitSelector, withinSelector: '.generation-canvas-v2__stage' })
      return point !== null
    }, { message: '参考连线上有用户能命中的位置' }).toBe(true)
    return point
  }
  const edgeControl = win.locator('.generation-canvas-v2__edge-control[data-edge-id="edge-style"]')
  const strokeOpacityOf = (locator) => locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).strokeOpacity))
  const expectNear = async (actualPromise, expected, state) => {
    const actual = await actualPromise
    if (Math.abs(actual - expected) > 0.05) throw new Error(`${state}: expected ${expected}, received ${actual}`)
  }

  // 2026-10-08 用户「删掉连线中间的标签吗，没有作用」：连线中点不再有类型标签；悬停才出断开「×」（下面悬停时先证明探针测得到，之后再证「不悬停就没有」）。
  await expectNear(strokeOpacityOf(edgePath), 0.18, 'idle edge opacity')
  await shot(win, '01-edge-label-collapsed.png')

  const hoverPoint = await readEdgePoint()
  await win.mouse.move(hoverPoint.x, hoverPoint.y)
  await win.waitForTimeout(220)
  const xProof = await proveProbe(edgeControl.locator('[data-edge-disconnect]'), '悬停一条线时中点出「×」')
  if ((await edgeControl.innerText()).trim() !== '') throw new Error('hovered edge midpoint carries text')
  await expectNear(strokeOpacityOf(edgePath), 1, 'hovered edge opacity')
  await shot(win, '02-edge-label-hover.png')

  await win.locator('[data-node-id="role-node"]').click()
  await win.waitForTimeout(220)
  await expectNear(strokeOpacityOf(edgePath), 1, 'selected asset edge opacity')
  await shot(win, '03-edge-label-selected-asset.png')

  const blank = await findCanvasBlankPoint(win)
  expect(blank, '画布上有可点的空白').not.toBeNull()
  await win.mouse.click(blank.x, blank.y)
  await win.waitForTimeout(220)
  await expectAbsent(edgeControl, { provenBy: xProof, message: '放掉选择、鼠标离开后中点没有任何控件' })

  await win.locator('[data-node-id="shot-node"]').click()
  await win.waitForTimeout(600)
  await shot(win, '04-dark-toolbar-clearance.png')

  // 旧的「点标签 → 连接语义菜单」整段作废（同上，用户 10-08）：点线只选中，不弹菜单。
  const clickPoint = await readEdgePoint()
  await win.mouse.click(clickPoint.x, clickPoint.y)
  await win.waitForTimeout(250)
  if ((await edgeControl.innerText()).trim() !== '') throw new Error('clicking an edge put text on its midpoint')
  await win.keyboard.press('Escape')

  // 铺开方向取决于点角标当时的空间。先缩小，让版本宫格和主节点同屏。
  await canvasSetZoomPercent(win, 55, '给版本宫格腾出空间')
  await waitForCanvasViewportSettled(win)
  const stackButton = win.locator('[data-node-id="shot-node"] button[data-version-badge]')
  await expect(stackButton).toHaveText('3')
  await stackButton.click()
  const grid = win.locator('[data-version-grid="shot-node"]')
  const cards = grid.locator('[data-version-card]')
  await expect(cards).toHaveCount(3)
  const alternateTile = grid.locator('[data-version-card="2"]')
  await alternateTile.hover()
  await shot(win, '06-result-stack-actions.png')
  await alternateTile.locator('[data-toolbar-action="delete"]').click()
  await expect(alternateTile).toHaveCount(0)
  await expect(cards).toHaveCount(2)
  await expect(stackButton).toHaveText('2')

  await openRailDrawer(win, 'assets', '打开素材库')
  await win.waitForTimeout(500)
  await win.getByRole('tab', { name: '项目素材' }).click()
  await win.waitForTimeout(500)
  await shot(win, '07-project-assets-all-results.png')
  await win.getByRole('tab', { name: '全部素材' }).click()
  await win.waitForTimeout(500)
  const assetCell = win.locator('[role="button"]').filter({ has: win.locator('img') }).first()
  if (await assetCell.isVisible().catch(() => false)) await assetCell.hover()
  await shot(win, '08-all-assets-delete-action.png')

  await win.getByRole('button', { name: '设置' }).click()
  await win.getByRole('dialog', { name: '设置' }).getByRole('button', { name: '通用' }).click()
  const switchToLight = win.getByRole('button', { name: '切换到浅色模式' })
  if (await switchToLight.isVisible().catch(() => false)) await switchToLight.click()
  await win.keyboard.press('Escape')
  await win.waitForTimeout(350)
  await shot(win, '09-light-assets-and-type.png')
  await app.close()
}

// Corrupt only the primary manifest. The valid backup must keep the library card alive and recover in-app.
fs.writeFileSync(projectFile, '{bad json')
{
  const { app, win } = await launch()
  await expectVisible(continueProject(win), '清单损坏后项目卡仍保留继续创作入口')
  await continueProject(win).click()
  const dialog = win.getByRole('dialog')
  await dialog.getByRole('button', { name: '恢复上次备份' }).click()
  await win.locator('[data-node-id="shot-node"]').waitFor({ state: 'visible', timeout: 10000 })
  await win.waitForTimeout(300)
  await shot(win, '10-recovered-project.png')
  if (!(await win.locator('[aria-label="工作区切换"]').isVisible())) throw new Error('project recovery did not reopen the studio')
  await app.close()
}

console.log('\n✓ feedback batch walkthrough passed')
