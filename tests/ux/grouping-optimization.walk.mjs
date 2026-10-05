import { launchNomiApp } from './_launchApp.mjs'
import { expect, expectVisible, screenshotSettled } from './_assert.mjs'
import { waitForCanvasViewportSettled } from './_canvasHit.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  await win.getByRole('button', { name: '新建空白项目', exact: false }).first().click()
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
    await expect(win.getByRole('button', { name: label, exact: true })).toBeVisible()
  }
  const groupPortHandles = win.locator('.generation-canvas-react-flow__handle[data-affordance="magnetic"]')
  await expect(groupPortHandles).toHaveCount(2)
  const selectedBlank = await win.locator('.generation-canvas-v2__group-box').first().evaluate((box) => {
    const rect = box.getBoundingClientRect()
    for (let y = rect.top + 14; y < rect.bottom - 14; y += 8) for (let x = rect.left + 14; x < rect.right - 14; x += 8) {
      const stack = document.elementsFromPoint(x, y)
      if (stack.some((el) => el.closest('[data-group-id]')) && !stack.some((el) => el.closest('[data-node-id]'))) return { x, y }
    }
    return null
  })
  if (!selectedBlank) throw new Error('编组框内找不到空白点')
  await win.mouse.click(selectedBlank.x, selectedBlank.y)
  await expect(win.locator('.generation-canvas-v2__group-box').first()).toHaveAttribute('data-frame-selected', 'true')
  await expect(groupPortHandles).toHaveCount(2)
  const stage = await win.locator('.generation-canvas-v2__stage').boundingBox()
  if (!stage) throw new Error('画布舞台缺失')
  await win.mouse.click(stage.x + 8, stage.y + 8)
  await expect(win.locator('[data-group-toolbar="true"]')).toHaveCount(0)
  await expect(groupPortHandles).toHaveCount(0)
  await win.mouse.click(selectedBlank.x, selectedBlank.y)
  await expectVisible(win.locator('[data-group-toolbar="true"]'), '再次点击空白组框后工具条出现')
  await screenshotSettled(win, { path: path.join(shotsDir, '01-group-toolbar.png') })

  await win.getByRole('button', { name: '排列', exact: true }).click()
  await expectVisible(win.getByRole('menu', { name: '排列', exact: true }), '排列菜单已打开')
  await win.getByRole('button', { name: '网格', exact: true }).click()
  await screenshotSettled(win, { path: path.join(shotsDir, '02-group-arranged-grid.png') })

  await win.getByRole('button', { name: '颜色', exact: true }).click()
  await expectVisible(win.getByRole('menu', { name: '颜色', exact: true }), '颜色菜单已打开')
  await win.getByRole('button', { name: '青绿', exact: true }).click()
  await screenshotSettled(win, { path: path.join(shotsDir, '03-group-color.png') })

  const facts = await win.evaluate(() => ({
    toolbar: document.querySelector('[data-group-toolbar="true"]')?.textContent,
    selectedFrame: document.querySelector('.generation-canvas-v2__group-box')?.getAttribute('data-frame-selected'),
    frameBorder: getComputedStyle(document.querySelector('.generation-canvas-v2__group-box')).borderColor,
    magneticHandles: document.querySelectorAll('.generation-canvas-react-flow__handle[data-affordance="magnetic"]').length,
  }))
  fs.writeFileSync(path.join(shotsDir, 'facts.json'), JSON.stringify(facts, null, 2))
  console.log('✅ 编组优化走查完成 →', shotsDir, JSON.stringify(facts))
} finally {
  await app.close()
}
