// Called by the real production Electron feedback walk; no React/store test bridge.
import { expect, clickOrFail } from './_assert.mjs'

export function zoomWorkflowFixtures(graph, binding, buildImportedWorkflow, buildMapping) {
  return [48, 80].map((count) => {
    const textGraph = structuredClone(graph)
    for (let i = 0; i < count - 5; i += 1) {
      textGraph[String(100 + i)] = { class_type: 'ImageScale', inputs: {
        image: [i < 6 ? '3' : String(100 + i - 6), 0], upscale_method: 'nearest-exact',
        width: 64, height: 64, crop: 'disabled',
      } }
    }
    if (count === 80) {
      // Synthetic custom node: stress the generic field menu without requiring an installed plugin.
      textGraph['174'].class_type = 'WorkflowZoomParameters'
      Object.assign(textGraph['174'].inputs, Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`parameter_${i}`, i])))
    }
    textGraph['4'].inputs.images = [String(100 + count - 6), 0]
    const extraBinding = { ...binding, params: [...binding.params, ...Array.from({ length: 10 }, (_, i) => ({
      nodeId: String(100 + i), inputKey: 'width', paramKey: `comfy_width_${i}`,
      label: `尺寸 ${i + 1}`, type: 'number', default: 64,
    }))] }
    return buildMapping(buildImportedWorkflow(textGraph, extraBinding), {
      modelKey: `comfy-zoom-${count}`, labelZh: `缩放验收 ${count} 节点`,
      draft: { text: JSON.stringify(textGraph), binding: extraBinding },
    })
  })
}

export async function walkWorkflowZoom(win, snap, readCatalog) {
  const page = win.locator('[data-comfyui-workflow-page]')
  const graph = page.locator('[data-workflow-graph]')
  const viewport = graph.getByRole('application')
  const transform = viewport.locator(':scope > div').first()
  const state = () => transform.evaluate((el) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform)
    return { zoom: matrix.a, x: matrix.e, y: matrix.f }
  })
  const wheel = async (deltaY, position) => {
    const box = await viewport.boundingBox()
    await win.mouse.move(position?.x ?? box.x + box.width * 0.55, position?.y ?? box.y + box.height * 0.25)
    const consumed = win.evaluate(() => new Promise((resolve) => {
      document.addEventListener('wheel', () => requestAnimationFrame(() => requestAnimationFrame(() => resolve())), { once: true, capture: true })
    }))
    await win.mouse.wheel(0, deltaY)
    await consumed
  }
  const fit = () => clickOrFail(graph.getByRole('button', { name: '适应', exact: true }), '适应工作流')
  const open = () => clickOrFail(win.getByRole('button', { name: '打开「视频工作流 · 参数验收」的工作流设置', exact: true }), '打开截图指定的工作流画布')
  await open()
  await expect(viewport).toBeVisible()
  await fit()
  const before = await state()
  const card = viewport.locator('[data-node-id="3"]')
  const box = await card.boundingBox()
  // MouseEvent client coordinates are integer CSS pixels; use the same point in the invariant.
  const anchor = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
  const frame = await viewport.boundingBox()
  await snap('zoom-00-before-dark')
  // RED on original code: no listener, matrix.a stays unchanged.
  await wheel(-120, anchor)
  await expect.poll(async () => (await state()).zoom).toBeGreaterThan(before.zoom)
  const after = await state()
  for (const axis of ['x', 'y']) {
    const point = anchor[axis] - frame[axis]
    const worldPoint = (point - before[axis]) / before.zoom
    expect(Math.abs(worldPoint * after.zoom + after[axis] - point)).toBeLessThan(0.05)
  }
  await snap('zoom-01-node-anchor-dark')
  await clickOrFail(card, '放大后仍能点击节点配置')
  const menu = graph.getByRole('menu')
  await expect(menu).toBeVisible()
  await snap('zoom-01b-node-menu-dark')
  const menuBox = await menu.boundingBox()
  await wheel(120, { x: menuBox.x + 20, y: menuBox.y + 20 })
  expect(await state()).toEqual(after)
  await clickOrFail(menu.getByRole('button', { name: '关闭菜单', exact: true }), '关闭节点菜单')
  for (let i = 0; i < 4; i += 1) await wheel(-120, anchor)
  const frameBeforeMenu = await viewport.boundingBox()
  const scrollBeforeMenu = await graph.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }))
  await clickOrFail(card, '最大缩放时打开靠下的节点菜单')
  expect(await viewport.boundingBox()).toEqual(frameBeforeMenu)
  expect(await graph.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }))).toEqual(scrollBeforeMenu)
  const bottomItem = menu.getByRole('menuitemcheckbox').last()
  const bottomBox = await bottomItem.boundingBox()
  const viewportBox = await viewport.boundingBox()
  await snap('zoom-01c-bottom-menu')
  expect(bottomBox.y + bottomBox.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height)
  await clickOrFail(menu.getByRole('button', { name: '关闭菜单', exact: true }), '关闭完整可见的菜单')

  // A wheel during a drag must not be overwritten by the drag's old absolute baseline.
  await fit()
  const area = await viewport.boundingBox()
  const start = { x: area.x + area.width * 0.6, y: area.y + 60 }
  await win.mouse.move(start.x, start.y)
  await win.mouse.down()
  await win.mouse.move(start.x + 30, start.y + 20)
  const panned = await state()
  await win.mouse.wheel(0, -120)
  await expect.poll(async () => (await state()).zoom).toBeGreaterThan(panned.zoom)
  const zoomedDrag = await state()
  await win.mouse.move(start.x + 50, start.y + 35)
  await expect.poll(async () => Math.abs((await state()).x - zoomedDrag.x - 20)).toBeLessThan(0.05)
  expect(Math.abs((await state()).y - zoomedDrag.y - 15)).toBeLessThan(0.05)
  await win.mouse.up()

  // Native dispatch complements physical mouse input for line/page/trackpad unit variants.
  for (const deltaMode of [0, 1, 2]) {
    await fit()
    const initial = await state()
    await viewport.dispatchEvent('wheel', { deltaMode, deltaY: -1, bubbles: true, cancelable: true, clientX: area.x + 300, clientY: area.y + 80 })
    await expect.poll(async () => (await state()).zoom).toBeGreaterThan(initial.zoom)
  }
  const horizontal = await state()
  await viewport.dispatchEvent('wheel', { deltaMode: 0, deltaX: 120, deltaY: 0, bubbles: true, cancelable: true })
  expect(await state()).toEqual(horizontal)
  await fit()
  const pinchBefore = await state()
  await win.keyboard.down('Control')
  await wheel(-120)
  await win.keyboard.up('Control')
  await expect.poll(async () => (await state()).zoom).toBeGreaterThan(pinchBefore.zoom)
  expect(await win.evaluate(() => window.visualViewport.scale)).toBe(1)

  for (const [deltaY, limit] of [[-120, 2], [120, 0.3]]) {
    for (let i = 0; i < 16; i += 1) await wheel(deltaY)
    await expect.poll(async () => (await state()).zoom).toBe(limit)
    const bounded = await state()
    await wheel(deltaY)
    expect(await state()).toEqual(bounded)
  }
  await fit()
  const fitted = await state()
  await clickOrFail(graph.getByRole('button', { name: '放大', exact: true }), '原有放大按钮')
  await expect.poll(async () => (await state()).zoom).toBeGreaterThan(fitted.zoom)
  await clickOrFail(graph.getByRole('button', { name: '缩小', exact: true }), '原有缩小按钮')
  await fit()
  expect(await state()).toEqual(fitted)

  // Many-node task: navigate a large workflow, expose a field, save and reopen it.
  await clickOrFail(page.locator('aside button').filter({ hasText: '缩放验收 48 节点' }), '定位多节点工作流')
  await expect(graph.locator('[data-node-id]')).toHaveCount(48)
  await fit()
  const mediumBefore = await state()
  await wheel(-120)
  await expect.poll(async () => (await state()).zoom).toBeGreaterThan(mediumBefore.zoom)
  const aside = page.locator('aside')
  const asideBox = await aside.boundingBox()
  const graphBeforeSidebar = await state()
  await wheel(500, { x: asideBox.x + 100, y: asideBox.y + asideBox.height - 100 })
  await expect.poll(() => aside.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  expect(await state()).toEqual(graphBeforeSidebar)
  await fit()
  await clickOrFail(viewport.locator('[data-node-id="100"]'), '找到需要暴露的尺寸节点')
  await clickOrFail(menu.getByRole('menuitemcheckbox').filter({ hasText: 'height' }), '暴露高度字段')
  await clickOrFail(page.locator('[data-workflow-save]'), '保存工作流配置')
  await expect.poll(() => readCatalog().models.find((model) => model.modelKey === 'comfy-zoom-48')?.meta?.comfyWorkflowImport?.binding?.params?.some((param) => param.nodeId === '100' && param.inputKey === 'height')).toBe(true)
  await snap('zoom-02-many-nodes-dark')

  // >60 nodes starts in list view; scrolling must remain native and listener must attach on return.
  await clickOrFail(aside.getByRole('button').filter({ hasText: '缩放验收 80 节点' }), '大图先看完整列表')
  await expect(graph).toHaveAttribute('data-workflow-graph', 'list')
  const list = graph.locator(':scope > div').first()
  const listBox = await list.boundingBox()
  await win.mouse.move(listBox.x + listBox.width / 2, listBox.y + 100)
  await win.mouse.wheel(0, 500)
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await clickOrFail(list.locator('[data-node-id="174"]'), '列表中打开多字段自定义节点')
  await expect(menu).toBeVisible()
  const visibleMenu = async () => {
    const menuBounds = await menu.boundingBox()
    const graphBounds = await graph.boundingBox()
    expect(menuBounds.y).toBeGreaterThanOrEqual(graphBounds.y)
    expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(graphBounds.y + graphBounds.height)
  }
  await visibleMenu()
  expect(await menu.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  const menuFrame = await menu.boundingBox()
  const listScroll = await list.evaluate((el) => el.scrollTop)
  await win.mouse.move(menuFrame.x + 30, menuFrame.y + 100)
  await win.mouse.wheel(0, 1000)
  await expect.poll(() => menu.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  expect(await list.evaluate((el) => el.scrollTop)).toBe(listScroll)
  await menu.getByRole('menuitemcheckbox').last().scrollIntoViewIfNeeded()
  await expect(menu.getByRole('menuitemcheckbox').last()).toBeVisible()
  await visibleMenu()
  await snap('zoom-02b-long-menu-list')
  await win.mouse.move(listBox.x + listBox.width - 40, listBox.y + 100)
  await win.mouse.wheel(0, -500)
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeLessThan(listScroll)
  await visibleMenu()
  await menu.getByRole('button', { name: '关闭菜单', exact: true }).scrollIntoViewIfNeeded()
  await clickOrFail(menu.getByRole('button', { name: '关闭菜单', exact: true }), '关闭多字段菜单')
  for (let i = 0; i < 3; i += 1) {
    await clickOrFail(graph.getByRole('button', { name: '节点图', exact: true }), '切到图定位细节')
    await expect(viewport).toBeVisible()
    await fit()
    const initial = await state()
    await wheel(-120)
    await expect.poll(async () => (await state()).zoom).toBeCloseTo(initial.zoom * 1.24, 4)
    await clickOrFail(graph.getByRole('button', { name: '节点列表', exact: true }), '回到完整列表')
  }
  await clickOrFail(page.getByRole('button', { name: '返回设置', exact: true }), '关闭工作流页')
  await open()
  await fit()
  const reopened = await state()
  await wheel(-120)
  await expect.poll(async () => (await state()).zoom).toBeCloseTo(reopened.zoom * 1.24, 4)
  await clickOrFail(page.getByRole('button', { name: '返回设置', exact: true }), '回到既有反馈走查')
  console.log('PASS: workflow canvas wheel anchor, drag+zoom, limits, delta modes, Ctrl-wheel, menu/sidebar/list isolation, 5/48/80 nodes, list remount, close/reopen, persisted field edit.')
}

export async function verifySavedWorkflowZoom(win, snap) {
  await clickOrFail(win.getByRole('button', { name: '打开模型设置', exact: true }), '冷启动后核对工作流设置')
  const settings = win.getByRole('dialog', { name: '设置', exact: true })
  await clickOrFail(settings.getByRole('button').filter({ hasText: '本地 ComfyUI' }).first(), '打开 ComfyUI')
  await clickOrFail(settings.getByRole('button', { name: '打开「缩放验收 48 节点」的工作流设置', exact: true }), '重新打开已保存的大图')
  const page = win.locator('[data-comfyui-workflow-page]')
  const graph = page.locator('[data-workflow-graph]')
  const viewport = graph.getByRole('application')
  await expect(graph.locator('[data-node-id]')).toHaveCount(48)
  await clickOrFail(graph.getByRole('button', { name: '适应', exact: true }), '浅色模式查看完整图')
  const transform = viewport.locator(':scope > div').first()
  const zoom = () => transform.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)
  const initial = await zoom()
  const node = viewport.locator('[data-node-id="100"]')
  const box = await node.boundingBox()
  await win.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2))
  await win.mouse.wheel(0, -120)
  await expect.poll(zoom).toBeCloseTo(initial * 1.24, 4)
  await clickOrFail(node, '缩放后核对保存的字段')
  await expect(graph.getByRole('menuitemcheckbox').filter({ hasText: 'height' })).toHaveAttribute('aria-checked', 'true')
  await snap('zoom-03-saved-field-light')
  await clickOrFail(page.getByRole('button', { name: '返回设置', exact: true }), '关闭工作流设置')
  await clickOrFail(settings.getByRole('button', { name: '关闭', exact: true }), '返回生成画布')
  console.log('PASS: light theme wheel zoom and exposed field retained after cold restart.')
}
