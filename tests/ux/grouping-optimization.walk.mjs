import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectAbsent, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'
import { waitForCanvasViewportSettled } from './_canvasHit.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { newProjectEntry } from './_shell.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/grouping-optimization')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const { app, win } = await launchNomiApp({
  name: 'grouping-optimization',
  args: ['--no-proxy-server'],
  settleMs: 0,
  initialLocalStorage: { 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen' },
})

try {
  await newProjectEntry(win).click()
  await win.getByRole('button', { name: '生成', exact: true }).click()
  const addImage = win.locator('[aria-label="添加图片节点"]').first()
  await expectVisible(addImage, '生成画布已可添加节点')
  for (let i = 0; i < 4; i += 1) await addImage.click()
  await win.getByLabel('适应视图', { exact: true }).click()
  await waitForCanvasViewportSettled(win)
  await win.mouse.click(420, 420)
  await win.keyboard.press('Control+a')
  await expect(win.locator('.generation-canvas-v2-node[data-selected="true"]')).toHaveCount(4)
  await win.locator('[aria-label^="创建分组"]').first().click()
  await expectVisible(win.locator('.generation-canvas-v2__group-box').first(), '组框已生成')
  await expectVisible(win.locator('[data-group-toolbar="true"]'), '组工具条已出现')
  await expect(win.locator('.generation-canvas-v2__group-box').first()).toHaveAttribute('data-frame-selected', 'true')
  for (const label of ['颜色', '排列', '生成整组', '进时间轴', '解组', '下载']) {
    const control =
      label === '颜色'
        ? win.locator('[data-toolbar-action-menu="group-color"]')
        : label === '排列'
          ? win.locator('[data-toolbar-action-menu="group-arrange"]')
          : win.locator(`[data-group-toolbar="true"] button[aria-label="${label}"]`)
    await expect(control).toBeVisible()
  }
  const groupPortHandles = win.locator('.generation-canvas-react-flow__handle[data-affordance="magnetic"]')
  await expect(groupPortHandles).toHaveCount(2)
  const selectedBlank = await win
    .locator('.generation-canvas-v2__group-box')
    .first()
    .evaluate((box) => {
      const rect = box.getBoundingClientRect()
      for (let y = rect.top + 14; y < rect.bottom - 14; y += 8)
        for (let x = rect.left + 14; x < rect.right - 14; x += 8) {
          const stack = document.elementsFromPoint(x, y)
          if (stack.some((el) => el.closest('[data-group-id]')) && !stack.some((el) => el.closest('[data-node-id]')))
            return { x, y }
        }
      return null
    })
  if (!selectedBlank) throw new Error('编组框内找不到空白点')
  await win.mouse.click(selectedBlank.x, selectedBlank.y)
  await expect(win.locator('.generation-canvas-v2__group-box').first()).toHaveAttribute('data-frame-selected', 'true')
  await expect(groupPortHandles).toHaveCount(2)
  const stage = await win.locator('.generation-canvas-v2__stage').boundingBox()
  if (!stage) throw new Error('画布舞台缺失')
  const toolbarProof = await proveProbe(win.locator('[data-group-toolbar="true"]'), '选中整组时组工具条真的在屏上')
  const portProof = await proveProbe(groupPortHandles, '选中整组时左右两个编组端口真的在屏上')
  await win.mouse.click(stage.x + 8, stage.y + 8)
  await expectAbsent(win.locator('[data-group-toolbar="true"]'), { provenBy: toolbarProof, message: '点画布空白后组工具条收起' })
  await expectAbsent(groupPortHandles, { provenBy: portProof, message: '点画布空白后编组端口收起' })
  await win.mouse.click(selectedBlank.x, selectedBlank.y)
  await expectVisible(win.locator('[data-group-toolbar="true"]'), '再次点击空白组框后工具条出现')

  const readGroupGeometry = () =>
    win.evaluate(() => {
      const frame = document.querySelector('.generation-canvas-v2__group-box')
      const nodes = [...document.querySelectorAll('.generation-canvas-v2-node[data-node-id]')].map((node) => ({
        id: node.getAttribute('data-node-id'),
        rect: node.getBoundingClientRect().toJSON(),
      }))
      return { frame: frame?.getBoundingClientRect().toJSON(), nodes }
    })
  const beforeGroupDrag = await readGroupGeometry()
  const groupDragStart = await win
    .locator('.generation-canvas-v2__group-box')
    .first()
    .evaluate((box) => {
      const rect = box.getBoundingClientRect()
      for (let y = rect.top + 18; y < rect.bottom - 18; y += 8)
        for (let x = rect.left + 18; x < rect.right - 18; x += 8) {
          const stack = document.elementsFromPoint(x, y)
          if (
            stack.some((el) => el.closest('[data-group-drag-surface="true"]')) &&
            !stack.some((el) => el.closest('[data-node-id]'))
          )
            return { x, y }
        }
      return null
    })
  if (!groupDragStart) throw new Error('编组框内找不到可拖动的空白表面')
  await win.mouse.move(groupDragStart.x, groupDragStart.y)
  await win.mouse.down()
  await win.mouse.move(groupDragStart.x + 36, groupDragStart.y + 24, { steps: 8 })
  // 拖动进行中（还没松手）：成员壳必须已经在平移。框动内容不动＝选择器没选中成员壳，
  // 松手后才会被 settle 一次性写回，只量松手后的几何看不出来（2026-10-11 方案卡 §6）。
  const liveMemberPreview = await win.evaluate(() =>
    [...document.querySelectorAll('.generation-canvas-react-flow__node-shell')]
      .map((shell) => shell.style.translate)
      .filter((value) => value !== ''),
  )
  if (liveMemberPreview.length === 0)
    throw new Error('拖动进行中成员壳没有任何 translate：框动内容不动（成员壳选择器没命中）')
  await win.mouse.up()
  await win.waitForTimeout(80)
  const afterGroupDrag = await readGroupGeometry()
  if (!beforeGroupDrag.frame || !afterGroupDrag.frame) throw new Error('编组框几何缺失')
  const groupDelta = {
    x: afterGroupDrag.frame.x - beforeGroupDrag.frame.x,
    y: afterGroupDrag.frame.y - beforeGroupDrag.frame.y,
  }
  if (Math.abs(groupDelta.x) < 20 || Math.abs(groupDelta.y) < 12)
    throw new Error(`空白拖组未移动：${JSON.stringify(groupDelta)}`)
  const nodeDeltas = afterGroupDrag.nodes
    .map((node) => {
      const before = beforeGroupDrag.nodes.find((candidate) => candidate.id === node.id)
      return before ? { id: node.id, x: node.rect.x - before.rect.x, y: node.rect.y - before.rect.y } : null
    })
    .filter(Boolean)
  if (nodeDeltas.some((delta) => Math.abs(delta.x - groupDelta.x) > 2 || Math.abs(delta.y - groupDelta.y) > 2)) {
    throw new Error(`空白拖组成员位移不一致：${JSON.stringify({ groupDelta, nodeDeltas })}`)
  }

  const nodeToDrag = afterGroupDrag.nodes[0]
  if (!nodeToDrag) throw new Error('编组节点缺失')
  await win.mouse.move(nodeToDrag.rect.x + nodeToDrag.rect.width / 2, nodeToDrag.rect.y + nodeToDrag.rect.height / 2)
  const beforeNodeDrag = await readGroupGeometry()
  await win.mouse.down()
  await win.mouse.move(
    nodeToDrag.rect.x + nodeToDrag.rect.width / 2 + 28,
    nodeToDrag.rect.y + nodeToDrag.rect.height / 2 + 16,
    { steps: 8 },
  )
  await win.mouse.up()
  await win.waitForTimeout(80)
  const afterNodeDrag = await readGroupGeometry()
  const movedNode = afterNodeDrag.nodes.find((candidate) => candidate.id === nodeToDrag.id)
  if (!movedNode) throw new Error('单节点拖动后节点缺失')
  const singleDelta = { x: movedNode.rect.x - nodeToDrag.rect.x, y: movedNode.rect.y - nodeToDrag.rect.y }
  if (Math.abs(singleDelta.x) < 14 || Math.abs(singleDelta.y) < 8)
    throw new Error(`节点卡片未单独移动：${JSON.stringify(singleDelta)}`)
  const otherDeltas = afterNodeDrag.nodes
    .filter((node) => node.id !== nodeToDrag.id)
    .map((node) => {
      const before = beforeNodeDrag.nodes.find((candidate) => candidate.id === node.id)
      return before ? { id: node.id, x: node.rect.x - before.rect.x, y: node.rect.y - before.rect.y } : null
    })
    .filter(Boolean)
  if (otherDeltas.some((delta) => Math.abs(delta.x) > 2 || Math.abs(delta.y) > 2)) {
    throw new Error(`节点卡片拖动影响了其他成员：${JSON.stringify(otherDeltas)}`)
  }
  await screenshotSettled(win, { path: path.join(shotsDir, '01-group-toolbar.png') })

  await win.locator('[data-toolbar-action-menu="group-arrange"]').click()
  await expectVisible(win.getByRole('menu', { name: '排列', exact: true }), '排列菜单已打开')
  await win.getByRole('menuitem', { name: '网格', exact: true }).click()
  await screenshotSettled(win, { path: path.join(shotsDir, '02-group-arranged-grid.png') })

  await win.locator('[data-toolbar-action-menu="group-color"]').click()
  await expectVisible(win.getByRole('menu', { name: '颜色', exact: true }), '颜色菜单已打开')
  await win.getByRole('menuitemradio', { name: '青绿', exact: true }).click()
  await screenshotSettled(win, { path: path.join(shotsDir, '03-group-color.png') })

  const facts = await win.evaluate(() => ({
    toolbar: document.querySelector('[data-group-toolbar="true"]')?.textContent,
    selectedFrame: document.querySelector('.generation-canvas-v2__group-box')?.getAttribute('data-frame-selected'),
    frameBorder: getComputedStyle(document.querySelector('.generation-canvas-v2__group-box')).borderColor,
    magneticHandles: document.querySelectorAll('.generation-canvas-react-flow__handle[data-affordance="magnetic"]')
      .length,
  }))
  fs.writeFileSync(path.join(shotsDir, 'facts.json'), JSON.stringify(facts, null, 2))
  console.log('✅ 编组优化走查完成 →', shotsDir, JSON.stringify(facts))
} finally {
  await app.close()
}
