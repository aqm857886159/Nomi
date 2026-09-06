// 2026-08-06 feedback batch: real Electron journey for edge semantics, multi-result lifecycle,
// critical canvas text surfaces in both themes, and corrupt-manifest recovery.
import { launchNomiApp } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.join(repoRoot, '.feedback-batch-walk')
const settingsDir = path.join(os.tmpdir(), 'nomi-feedback-batch-walk-settings')
const projectsDir = path.join(os.tmpdir(), 'nomi-feedback-batch-walk-projects')
for (const target of [outDir, settingsDir, projectsDir]) fs.rmSync(target, { recursive: true, force: true })
for (const target of [outDir, settingsDir, projectsDir]) fs.mkdirSync(target, { recursive: true })

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

// First boot creates a real registered workspace; the fixture then only replaces canvas content.
{
  const { app, win } = await launch()
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(1700)
  await win.keyboard.press('Escape').catch(() => {})
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click()
  await win.waitForTimeout(700)
  await addCanvasNodeFromRail(win, 'image')
  await win.waitForTimeout(900)
  await app.close()
}

const projectRoot = fs.readdirSync(projectsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(projectsDir, entry.name))[0]
const projectFile = path.join(projectRoot, '.nomi', 'project.json')
const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'))
const assetDir = path.join(projectRoot, 'assets', 'generated', '2026-08-06')
fs.mkdirSync(assetDir, { recursive: true })
for (const name of ['role.png', 'main.png', 'alternate-a.png', 'alternate-b.png']) {
  fs.writeFileSync(path.join(assetDir, name), png)
}
const assetUrl = (name) => `nomi-local://asset/${encodeURIComponent(project.id)}/assets/generated/2026-08-06/${name}`
const result = (id, name, createdAt) => ({ id, type: 'image', url: assetUrl(name), createdAt })
const roleResult = result('role-result', 'role.png', 1)
const mainResult = result('main-result', 'main.png', 4)
const alternateA = result('alternate-a', 'alternate-a.png', 3)
const alternateB = result('alternate-b', 'alternate-b.png', 2)
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
  const continueButton = win.getByText('继续创作', { exact: true }).first()
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click()
  await win.waitForTimeout(2200)
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click()
  await win.waitForTimeout(1100)

  const edge = win.locator('.generation-canvas-v2__edge[data-edge-id="edge-style"]')
  const edgePath = edge.locator('.generation-canvas-v2__edge-path')
  const edgeHit = edge.locator('.generation-canvas-v2__edge-hit')
  const edgeControl = win.locator('.generation-canvas-v2__edge-control[data-edge-id="edge-style"]')
  const edgeTag = edgeControl.locator('.generation-canvas-v2__edge-tag-pill').filter({ hasText: '风格' })
  const opacityOf = (locator) => locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity))
  const pointerEventsOf = (locator) => locator.evaluate((element) => getComputedStyle(element).pointerEvents)
  const strokeOpacityOf = (locator) => locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).strokeOpacity))
  const expectNear = async (actualPromise, expected, state) => {
    const actual = await actualPromise
    if (Math.abs(actual - expected) > 0.05) throw new Error(`${state}: expected ${expected}, received ${actual}`)
  }

  await expectNear(opacityOf(edgeControl), 0, 'collapsed edge label opacity')
  if (await pointerEventsOf(edgeControl) !== 'none') throw new Error('collapsed edge label intercepted pointer events')
  await expectNear(strokeOpacityOf(edgePath), 0.18, 'idle edge opacity')
  await shot(win, '01-edge-label-collapsed.png')

  await edgeHit.hover({ force: true })
  await win.waitForTimeout(220)
  await expectNear(opacityOf(edgeControl), 1, 'hovered edge label opacity')
  if (await pointerEventsOf(edgeControl) !== 'auto') throw new Error('hovered edge label was not interactive')
  await expectNear(strokeOpacityOf(edgePath), 1, 'hovered edge opacity')
  await shot(win, '02-edge-label-hover.png')

  await win.locator('[data-node-id="role-node"]').click()
  await win.waitForTimeout(220)
  await expectNear(opacityOf(edgeControl), 1, 'selected asset edge label opacity')
  await expectNear(strokeOpacityOf(edgePath), 1, 'selected asset edge opacity')
  await shot(win, '03-edge-label-selected-asset.png')

  await win.locator('.generation-canvas-v2__stage').click({ position: { x: 500, y: 760 }, force: true })
  await win.waitForTimeout(220)
  await expectNear(opacityOf(edgeControl), 0, 'cleared selection edge label opacity')
  if (await pointerEventsOf(edgeControl) !== 'none') throw new Error('cleared edge label intercepted pointer events')

  await win.locator('[data-node-id="shot-node"]').click()
  await win.waitForTimeout(600)
  await shot(win, '04-dark-toolbar-clearance.png')

  await edgeTag.click()
  await win.waitForTimeout(250)
  await shot(win, '05-edge-mode-menu.png')
  if (!(await win.getByRole('menu', { name: '连接语义' }).isVisible())) throw new Error('edge mode menu did not open')
  await win.keyboard.press('Escape')

  const stackButton = win.getByRole('button', { name: '3 张堆叠图片' })
  await stackButton.click()
  await win.waitForTimeout(450)
  const alternateTile = win.getByRole('listitem').first()
  await alternateTile.hover()
  await shot(win, '06-result-stack-actions.png')
  await alternateTile.getByRole('button', { name: '删除这张图片' }).click()
  const dialog = win.getByRole('dialog')
  await dialog.getByRole('button', { name: '删除这张图片' }).click()
  await win.waitForTimeout(700)
  if (!(await win.getByRole('button', { name: '2 张堆叠图片' }).isVisible())) throw new Error('result-level delete did not preserve the stack')

  await win.getByRole('button', { name: '素材库' }).click()
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
  const continueButton = win.getByText('继续创作', { exact: true }).first()
  if (!(await continueButton.isVisible().catch(() => false))) throw new Error('corrupt project disappeared from the library')
  await continueButton.click()
  const dialog = win.getByRole('dialog')
  await dialog.getByRole('button', { name: '恢复上次备份' }).click()
  await win.locator('[data-node-id="shot-node"]').waitFor({ state: 'visible', timeout: 10000 })
  await win.waitForTimeout(300)
  await shot(win, '10-recovered-project.png')
  if (!(await win.locator('[aria-label="工作区切换"]').isVisible())) throw new Error('project recovery did not reopen the studio')
  await app.close()
}

console.log('\n✓ feedback batch walkthrough passed')
