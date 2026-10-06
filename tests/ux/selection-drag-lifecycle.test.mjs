import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { createServer } from 'vite'

let server, browser, page, cacheDir
beforeAll(async () => {
  cacheDir = mkdtempSync(path.join(tmpdir(), 'nomi-selection-drag-vite-'))
  server = await createServer({
    configFile: false,
    cacheDir,
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  })
  await server.listen()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
})
afterAll(async () => {
  await browser?.close()
  await server?.close()
  if (cacheDir) rmSync(cacheDir, { recursive: true, force: true })
})
beforeEach(async () => {
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/tests/ux/fixtures/selection-drag-lifecycle-harness.html`,
  )
  await page.locator('#group').waitFor()
  await frames()
})
const frames = () =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const snapshot = () => page.evaluate(() => window.selectionDragFixture.snapshot())
async function start(target) {
  await page
    .locator(`#${target}`)
    .dispatchEvent('pointerdown', { pointerId: 7, button: 0, clientX: 10, clientY: 10, bubbles: true })
  await page.evaluate(() =>
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 40, clientY: 35, bubbles: true })),
  )
}
const release = () =>
  page.evaluate(() =>
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, clientX: 90, clientY: 90, bubbles: true })),
  )
async function interrupt(reason) {
  await page.evaluate((reason) => {
    if (reason === 'blur') window.dispatchEvent(new Event('blur'))
    else if (reason === 'hidden') window.selectionDragFixture.hide()
    else if (reason === 'unmount') window.selectionDragFixture.unmount()
    else if (reason === 'readOnly') window.selectionDragFixture.readOnly()
    else window.dispatchEvent(new PointerEvent(reason, { pointerId: 7, bubbles: true }))
  }, reason)
  await frames()
}
// 拖动所有者 × 收尾原因的矩阵：每一种「用 DOM 预览代替逐样本写 store」的拖动所有者，
// 在每一种结束方式下都必须只在落点写一次、拖动途中 revision / events 纹丝不动。
const DRAG_OWNER_MATRIX = ['group', 'selection']
for (const target of DRAG_OWNER_MATRIX) {
  it.each(['pointerup', 'blur', 'hidden', 'unmount', 'readOnly', 'pointercancel', 'lostpointercapture'])(
    `${target} settles applied positions once on %s`,
    async (reason) => {
      const before = await snapshot()
      expect(before.groups).toHaveLength(1)
      await start(target)
      await frames()
      const moved = await snapshot()
      if (target === 'group') {
        // Group drag keeps React Flow's measured wrappers stationary during the
        // gesture; the production shell moves through the DOM preview and the
        // store commits the final position at settle.
        expect(moved.nodes[0].position).toEqual({ x: 10, y: 20 })
        expect(moved.groupPreview).toBe('30px 25px')
      } else {
        // Selection drag keeps the durable node table untouched; the selected
        // shells carry the transient translate until the shared settle boundary.
        expect(moved.nodes[0].position).toEqual({ x: 10, y: 20 })
        expect(moved.selectionPreview).toBe('30px 25px')
      }
      expect(moved.revision).toBe(before.revision)
      expect(moved.events).toEqual([])
      await interrupt(reason)
      const settled = await snapshot()
      expect(settled.nodes[0].position).toEqual({ x: 40, y: 45 })
      expect(settled.groupPreview).toBe('')
      expect(settled.selectionPreview).toBe('')
      expect(settled.revision).toBe(before.revision + 1)
      expect(settled.events.filter((event) => event.type === 'canvas.node.moved')).toHaveLength(2)
      if (target === 'group') expect(settled.groups[0].frameBounds).toMatchObject({ x: 30, y: 25 })
      expect(settled.dragging).toBeNull()
      await release()
      expect(await snapshot()).toEqual(settled)
      await page.evaluate(() => window.selectionDragFixture.undo())
      expect((await snapshot()).nodes.map((node) => node.position)).toEqual(before.nodes.map((node) => node.position))
      await page.evaluate(() => window.selectionDragFixture.redo())
      expect((await snapshot()).nodes.map((node) => node.position)).toEqual(settled.nodes.map((node) => node.position))
    },
  )
  it.each(['replaceGraph', 'switchProject'])(
    `${target} ignores queued movement and late release after %s with reused IDs`,
    async (replacement) => {
      await start(target)
      await frames()
      await page.evaluate((replacement) => window.selectionDragFixture[replacement](), replacement)
      const replaced = await snapshot()
      await page.evaluate(() =>
        window.dispatchEvent(
          new PointerEvent('pointermove', { pointerId: 7, clientX: 90, clientY: 90, bubbles: true }),
        ),
      )
      await interrupt('blur')
      await release()
      const after = await snapshot()
      expect(after.nodes).toEqual(replaced.nodes)
      expect(after.groups).toEqual(replaced.groups)
      expect(after.revision).toBe(replaced.revision)
      expect(after.events).toEqual(replaced.events)
      expect(after.dragging).toBeNull()
    },
  )
}
it('flushes the original pending RAF on blur before the first frame', async () => {
  const before = await snapshot()
  await page
    .locator('#group')
    .dispatchEvent('pointerdown', { pointerId: 7, button: 0, clientX: 10, clientY: 10, bubbles: true })
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 40, clientY: 35, bubbles: true }))
    window.dispatchEvent(new Event('blur'))
  })
  const settled = await snapshot()
  expect(settled.nodes[0].position).toEqual({ x: 40, y: 45 })
  expect(settled.revision).toBe(before.revision + 1)
  expect(settled.events.filter((event) => event.type === 'canvas.node.moved')).toHaveLength(2)
})
it.each(['replaceGraph', 'invalidateProject'])(
  'rejects a queued RAF after %s before it writes',
  async (replacement) => {
    await page
      .locator('#group')
      .dispatchEvent('pointerdown', { pointerId: 7, button: 0, clientX: 10, clientY: 10, bubbles: true })
    await page.evaluate((replacement) => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 7, clientX: 40, clientY: 35, bubbles: true }))
      window.selectionDragFixture[replacement]()
    }, replacement)
    const replaced = await snapshot()
    await frames()
    await interrupt('blur')
    await release()
    const after = await snapshot()
    expect(after.nodes).toEqual(replaced.nodes)
    expect(after.groups).toEqual(replaced.groups)
    expect(after.revision).toBe(replaced.revision)
    expect(after.events).toEqual(replaced.events)
    expect(after.dragging).toBeNull()
  },
)
