// Shared settings → workflow canvas. Input is automated, not physical trackpad hardware.
import { expect, clickOrFail } from './_assert.mjs'

export async function selectCanvasGesture(win, scheme, snap) {
  const settings = win.getByRole('dialog', { name: '设置', exact: true })
  await clickOrFail(settings.locator('[data-settings-tab-id="general"]'), '打开已有通用手势设置')
  const option = settings.locator(`[data-canvas-gesture-scheme="${scheme}"]`)
  await clickOrFail(option, '选择共享画布手势')
  await expect(option).toHaveAttribute('aria-checked', 'true')
  expect(await win.evaluate(() => localStorage.getItem('nomi.canvasGesture.scheme'))).toBe(scheme)
  await expect(settings.getByText('生成画布和 ComfyUI 工作流设置共用此滚轮/双指手势。', { exact: false })).toBeVisible()
  if (snap) await snap(`mac-setting-${scheme}`)
  await clickOrFail(settings.locator('[data-settings-tab-id="models"]'), '回到模型设置')
}

export const viewportState = (viewport) => viewport.locator(':scope > div').first().evaluate((el) => {
  const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform)
  return { zoom: matrix.a, x: matrix.e, y: matrix.f }
})

export async function wheelAt(win, viewport, deltaX, deltaY, point) {
  const frame = await viewport.boundingBox()
  await win.mouse.move(point?.x ?? frame.x + frame.width * 0.65, point?.y ?? frame.y + 60)
  const consumed = win.evaluate(() => new Promise((resolve) => {
    document.addEventListener('wheel', () => requestAnimationFrame(() => requestAnimationFrame(resolve)), { once: true, capture: true })
  }))
  await win.mouse.wheel(deltaX, deltaY)
  await consumed
}

async function openWorkflow(win, name = '视频工作流 · 参数验收') {
  const settings = win.getByRole('dialog', { name: '设置', exact: true })
  const row = settings.getByRole('button', { name: `打开「${name}」的工作流设置`, exact: true })
  if (!(await row.isVisible())) {
    await clickOrFail(settings.getByRole('button').filter({ hasText: '本地 ComfyUI' }).first(), '打开已接入的 ComfyUI')
  }
  await clickOrFail(row, '触控板用户打开工作流')
}

function expectPan(before, after, dx, dy) {
  expect(after.zoom, '两指滑动应平移，不缩放').toBe(before.zoom)
  expect(after.x).toBeCloseTo(before.x - dx, 3)
  expect(after.y).toBeCloseTo(before.y - dy, 3)
}

async function expectAnchoredZoom(win, viewport, modifier, point) {
  const frame = await viewport.boundingBox()
  const anchor = point ?? { x: Math.round(frame.x + frame.width * 0.6), y: Math.round(frame.y + 100) }
  const before = await viewportState(viewport)
  await win.keyboard.down(modifier)
  try { await wheelAt(win, viewport, 0, -60, anchor) } finally { await win.keyboard.up(modifier) }
  const after = await viewportState(viewport)
  expect(after.zoom).toBeGreaterThan(before.zoom)
  for (const axis of ['x', 'y']) {
    const p = anchor[axis] - frame[axis]
    expect(Math.abs(((p - before[axis]) / before.zoom) * after.zoom + after[axis] - p)).toBeLessThan(0.05)
  }
  expect(await win.evaluate(() => window.visualViewport.scale)).toBe(1)
}

async function checkMainCanvas(win, scheme) {
  const settings = win.getByRole('dialog', { name: '设置', exact: true })
  await clickOrFail(settings.getByRole('button', { name: '关闭', exact: true }), '同一设置也作用于主画布')
  const stage = win.locator('.generation-canvas-v2__stage')
  const state = () => stage.locator('.generation-canvas-v2__canvas').evaluate((el) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform)
    return { zoom: matrix.a, x: matrix.e, y: matrix.f }
  })
  const point = await stage.evaluate((el) => {
    const box = el.getBoundingClientRect()
    for (const y of [0.15, 0.8, 0.5]) for (const x of [0.7, 0.9, 0.3]) {
      const point = { x: Math.round(box.x + box.width * x), y: Math.round(box.y + box.height * y) }
      const hit = document.elementFromPoint(point.x, point.y)
      if (hit && el.contains(hit) && !hit.closest('.generation-canvas-v2-node, button, input, textarea, [role="toolbar"], .generation-canvas-v2__minimap')) return point
    }
    throw new Error('主画布没有找到可操作空白区域')
  })
  const initial = await state()
  await wheelAt(win, stage, 32, -48, point)
  if (scheme === 'modifier-zoom') expectPan(initial, await state(), 32, -48)
  else expect((await state()).zoom).toBeGreaterThan(initial.zoom)
  await clickOrFail(win.getByRole('button', { name: '打开模型设置', exact: true }), '回到共享设置')
}

export async function walkWorkflowMacGestures(win, snap, readCatalog) {
  await selectCanvasGesture(win, 'modifier-zoom', snap)
  await openWorkflow(win)
  const page = win.locator('[data-comfyui-workflow-page]')
  const viewport = page.getByRole('application')
  await clickOrFail(page.getByRole('button', { name: '适应', exact: true }), '定位完整工作流')
  const initial = await viewportState(viewport)
  await wheelAt(win, viewport, 32, 48)
  const panned = await viewportState(viewport)
  // RED: the previous workflow handler ignores the shared modifier-zoom preference.
  expectPan(initial, panned, 32, 48)
  for (const [dx, dy] of [[-12, 0], [0, -20]]) {
    const before = await viewportState(viewport)
    await wheelAt(win, viewport, dx, dy)
    expectPan(before, await viewportState(viewport), dx, dy)
  }
  const fine = await viewportState(viewport)
  await viewport.dispatchEvent('wheel', { deltaX: 0.25, deltaY: -0.75, deltaMode: 0, bubbles: true, cancelable: true })
  await win.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expectPan(fine, await viewportState(viewport), 0.25, -0.75)
  const shifted = await viewportState(viewport)
  await win.keyboard.down('Shift')
  try { await wheelAt(win, viewport, 0, 30) } finally { await win.keyboard.up('Shift') }
  expectPan(shifted, await viewportState(viewport), 30, 0)
  for (const modifier of ['Meta', 'Control']) await expectAnchoredZoom(win, viewport, modifier)
  await snap('mac-01-two-axis-pan')
  const graph = page.locator('[data-workflow-graph]')
  await clickOrFail(viewport.locator('[data-node-id="3"]'), '平移缩放后节点仍能打开菜单')
  const menu = graph.getByRole('menu')
  const menuBox = await menu.boundingBox()
  const menuBefore = await viewportState(viewport)
  // A zero-delta event outside the open menu must not dismiss it or move the graph.
  await viewport.dispatchEvent('wheel', { deltaX: 0, deltaY: 0, bubbles: true, cancelable: true })
  await win.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await viewportState(viewport)).toEqual(menuBefore)
  await expect(menu).toBeVisible()
  await wheelAt(win, viewport, 20, 40, { x: menuBox.x + 24, y: menuBox.y + 50 })
  expect(await viewportState(viewport)).toEqual(menuBefore)
  await expect(menu).toBeVisible()
  await clickOrFail(menu.getByRole('button', { name: '关闭菜单', exact: true }), '菜单独立滚动后关闭')

  await clickOrFail(page.locator('aside button').filter({ hasText: '缩放验收 48 节点' }), '触控板定位多节点工作流')
  await clickOrFail(graph.getByRole('button', { name: '适应', exact: true }), '适应多节点图')
  const beforeLarge = await viewportState(viewport)
  await wheelAt(win, viewport, -24, 18)
  expectPan(beforeLarge, await viewportState(viewport), -24, 18)
  const target = viewport.locator('[data-node-id="101"]')
  const targetBox = await target.boundingBox()
  await expectAnchoredZoom(win, viewport, 'Meta', { x: Math.round(targetBox.x + targetBox.width / 2), y: Math.round(targetBox.y + targetBox.height / 2) })
  await clickOrFail(target, '找到第二个尺寸节点')
  await clickOrFail(menu.getByRole('menuitemcheckbox').filter({ hasText: 'height' }), '暴露要调整的高度字段')
  await clickOrFail(page.locator('[data-workflow-save]'), '保存触控板定位后的修改')
  await expect.poll(() => readCatalog().models.find((model) => model.modelKey === 'comfy-zoom-48')?.meta?.comfyWorkflowImport?.binding?.params?.some((param) => param.nodeId === '101' && param.inputKey === 'height')).toBe(true)
  await snap('mac-02-saved-field-dark')

  await clickOrFail(page.locator('aside button').filter({ hasText: '缩放验收 80 节点' }), '触控板用户在大图列表找节点')
  await expect(graph).toHaveAttribute('data-workflow-graph', 'list')
  const list = graph.locator(':scope > div').first()
  await wheelAt(win, list, 0, 320)
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  for (let i = 0; i < 2; i += 1) {
    await clickOrFail(graph.getByRole('button', { name: '节点图', exact: true }), '触控板切回图')
    await clickOrFail(graph.getByRole('button', { name: '适应', exact: true }), '适应大图')
    const remounted = await viewportState(viewport)
    await wheelAt(win, viewport, 18, 24)
    expectPan(remounted, await viewportState(viewport), 18, 24)
    await clickOrFail(graph.getByRole('button', { name: '节点列表', exact: true }), '回到节点列表')
  }
  await clickOrFail(page.getByRole('button', { name: '返回设置', exact: true }), '检查主画布共用偏好')
  await checkMainCanvas(win, 'modifier-zoom')
  await selectCanvasGesture(win, 'wheel-zoom')
  await checkMainCanvas(win, 'wheel-zoom')
  await openWorkflow(win)
  await clickOrFail(page.getByRole('button', { name: '适应', exact: true }), '恢复鼠标档')
  const mouse = await viewportState(viewport)
  await wheelAt(win, viewport, 0, -60)
  expect((await viewportState(viewport)).zoom).toBeGreaterThan(mouse.zoom)
  await clickOrFail(page.getByRole('button', { name: '返回设置', exact: true }), '切回触控板偏好用于重启验证')
  await selectCanvasGesture(win, 'modifier-zoom')
  await openWorkflow(win)
  const switched = await viewportState(viewport)
  await wheelAt(win, viewport, 10, 15)
  expectPan(switched, await viewportState(viewport), 10, 15)
  await clickOrFail(page.getByRole('button', { name: '返回设置', exact: true }), '回到设置继续反馈验收')
  console.log('PASS: Mac gesture event matrix: shared real settings, two-axis/horizontal/vertical/fractional/Shift pan, Meta/Ctrl anchored zoom, page/menu isolation, saved field, 48/80 nodes, remount, live mode changes on BOTH canvases. Automated events, not physical trackpad validation.')
}

export async function verifySavedMacGestures(win, snap) {
  await clickOrFail(win.getByRole('button', { name: '打开模型设置', exact: true }), '冷启动检查触控板偏好')
  const settings = win.getByRole('dialog', { name: '设置', exact: true })
  await clickOrFail(settings.locator('[data-settings-tab-id="general"]'), '查看保存的手势设置')
  await expect(settings.locator('[data-canvas-gesture-scheme="modifier-zoom"]')).toHaveAttribute('aria-checked', 'true')
  await clickOrFail(settings.locator('[data-settings-tab-id="models"]'), '冷启动打开工作流')
  await openWorkflow(win, '缩放验收 48 节点')
  const page = win.locator('[data-comfyui-workflow-page]')
  const viewport = page.getByRole('application')
  await clickOrFail(page.getByRole('button', { name: '适应', exact: true }), '浅色模式定位节点')
  const before = await viewportState(viewport)
  await wheelAt(win, viewport, 16, -20)
  expectPan(before, await viewportState(viewport), 16, -20)
  const target = viewport.locator('[data-node-id="101"]')
  const box = await target.boundingBox()
  await expectAnchoredZoom(win, viewport, 'Meta', { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) })
  await clickOrFail(target, '核对触控板用户保存的字段')
  await expect(page.getByRole('menuitemcheckbox').filter({ hasText: 'height' })).toHaveAttribute('aria-checked', 'true')
  await snap('mac-03-cold-start-light')
  await clickOrFail(page.getByRole('button', { name: '返回设置', exact: true }), '还原鼠标档回归其余操作')
  await selectCanvasGesture(win, 'wheel-zoom')
  await clickOrFail(settings.getByRole('button', { name: '关闭', exact: true }), '返回主画布')
  console.log('PASS: cold restart retains trackpad preference and field edit; light-theme pan/Meta zoom; mouse scheme restored through real settings.')
}
