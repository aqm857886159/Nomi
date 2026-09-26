import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { expectAbsent, proveProbe } from './_assert.mjs'
let server, browser, page, cacheDir
beforeAll(async () => {
  cacheDir = mkdtempSync(path.join(tmpdir(), 'nomi-t7-vite-lifecycle-'))
  server = await createServer({ configFile: false, cacheDir, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } })
  await server.listen()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/ux/fixtures/composer-lifecycle-harness.html`)
})
afterAll(async () => { await browser?.close(); await server?.close(); if (cacheDir) rmSync(cacheDir, { recursive: true, force: true }) })
it('keeps a captured gesture when focus moves between elements, but releases on window blur', async () => {
  await page.reload()
  await page.locator('#unpublished-draft').focus()
  await startPan()
  await page.locator('#readonly').focus()
  expect(await page.locator('#stage').getAttribute('data-dragging')).toBe('true')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  expect(await page.locator('#stage').getAttribute('data-dragging')).toBeNull()
  // 手势被 blur 收掉，但画布已经移过去了：记的是此刻屏幕上那一份（2026-09-21，见下面那条
  // 「records the viewport that is actually on screen」的长注释）。
  await expect.poll(() => page.evaluate(() => window.composerFixture.gesture().remembers)).toBe(1)
})
it('opens history when the original trigger selects an unselected node in the same event', async () => {
  await page.reload()
  await page.locator('#select').click()
  await page.locator('#history').click()
  expect(await page.locator('#history').textContent()).toBe('history')
  await page.locator('#select').click()
  expect(await page.locator('#history').textContent()).toBe('composer')
})
it('invalidates the single history owner across selection, results, kind and identity', async () => {
  await page.locator('[role="status"]').waitFor()
  await page.evaluate(() => window.composerFixture.fail())
  await page.locator('#history').click()
  expect(await page.locator('#history').textContent()).toBe('history')
  for (const toggle of ['select', 'available']) {
    await page.locator(`#${toggle}`).click(); await page.locator(`#${toggle}`).click()
    expect(await page.locator('#history').textContent()).toBe('composer')
    await page.locator('#history').click()
  }
  for (const toggle of ['kind', 'identity']) {
    await page.locator(`#${toggle}`).click()
    expect(await page.locator('#history').textContent()).toBe('composer')
    await page.locator('#history').click()
  }
})
it('degrades only its own region and reaches for the one recovery that can work: a full reload', async () => {
  // React.lazy 一旦 reject 会永久缓存失败，且浏览器 module map 对「取失败的模块 URL」也按
  // 错误缓存：同一 specifier 再 import 立刻重抛原错误、根本不发第二次请求。换新 lazy 实例
  // 只解开两层缓存里的一层，所以恢复只能靠拿到全新 JS 上下文的整页重载。
  await page.locator('[role="alert"]').waitFor()
  await page.locator('#unpublished-draft').fill('still unpublished')
  expect(await page.locator('#stage').count()).toBe(1)
  await expect.poll(() => page.evaluate(() => window.composerFixture.snapshot().reloads)).toBe(1)
  await page.locator('[role="alert"] button').click()
  expect(await page.evaluate(() => window.composerFixture.snapshot().reloads)).toBe(2)
  expect(await page.locator('#unpublished-draft').inputValue()).toBe('still unpublished')
})

/**
 * 把焦点交给一张 React Flow 节点，并确认「人能按键」的前提成立：节点已是选中态、焦点真落在它身上。
 * reload 后立刻 focus+按键，React Flow 还没把节点挂好的那一刻，这一下按键会被吞掉。以前同页的浮框位置
 * harness 跑着逐帧 rAF 测量、页面一直在出帧，把这个时序盖住了；它改成纯函数（2026-09-25）后时序才暴露。
 */
async function focusFlowNode(node) {
  await expect.poll(() => node.evaluate((element) => element.classList.contains('selected'))).toBe(true)
  await node.focus()
  await expect.poll(() => node.evaluate((element) => element === document.activeElement)).toBe(true)
}

async function openEscapePopover() {
  await page.locator('[data-escape-anchor]').click()
  await expect.poll(() => page.locator('[data-escape-popover]').count()).toBe(1)
}

async function expectPopoverClosedWithSelectedNode() {
  await expect.poll(() => page.locator('[data-escape-popover]').count()).toBe(0)
  expect(await page.locator('[data-escape-node]').getAttribute('data-selected')).toBe('true')
  expect(await page.locator('[data-escape-composer]').count()).toBe(1)
  expect(await page.locator('[data-host-escapes]').textContent()).toBe('0')
  expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-escape-anchor'))).toBe(true)
}

it.each([
  ['the external anchor', '[data-escape-anchor]'],
  ['a portal button', '[data-escape-button]'],
  ['a portal input', '[data-escape-input]'],
])('closes an anchored popover from %s without forwarding Escape to React Flow', async (_label, selector) => {
  await page.reload()
  await openEscapePopover()
  await page.locator(selector).focus()
  await page.keyboard.press('Escape')
  await expectPopoverClosedWithSelectedNode()
})

it('keeps child-prevented and composing Escape inside the open popover', async () => {
  await page.reload()
  await openEscapePopover()
  await page.locator('[data-escape-prevent]').focus()
  await page.keyboard.press('Escape')
  expect(await page.locator('[data-escape-popover]').count()).toBe(1)
  expect(await page.locator('[data-escape-node]').getAttribute('data-selected')).toBe('true')
  expect(await page.locator('[data-host-escapes]').textContent()).toBe('0')
  await page.locator('[data-escape-input]').evaluate((input) => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, isComposing: true })
    input.dispatchEvent(event)
  })
  expect(await page.locator('[data-escape-popover]').count()).toBe(1)
  expect(await page.locator('[data-escape-node]').getAttribute('data-selected')).toBe('true')
  expect(await page.locator('[data-host-escapes]').textContent()).toBe('0')
})

it('lets nested NomiSelect consume the first Escape and closes the parent on the second', async () => {
  await page.reload()
  await openEscapePopover()
  await page.getByRole('button', { name: 'nested select' }).click()
  await expect.poll(() => page.locator('[data-nomi-select-dropdown]:visible').count()).toBe(1)
  await page.keyboard.press('Escape')
  await expect.poll(() => page.locator('[data-nomi-select-dropdown]:visible').count()).toBe(0)
  expect(await page.locator('[data-escape-popover]').count()).toBe(1)
  expect(await page.locator('[data-escape-node]').getAttribute('data-selected')).toBe('true')
  await page.keyboard.press('Escape')
  await expectPopoverClosedWithSelectedNode()
})

it('lets a nested document-bubble owner consume Escape without reaching React Flow', async () => {
  await page.reload()
  await openEscapePopover()
  await page.locator('[data-open-document-menu]').click()
  await page.locator('[data-escape-button]').focus()
  await page.keyboard.press('Escape')
  await expect.poll(() => page.locator('[data-document-child="menu"]').count()).toBe(0)
  expect(await page.locator('[data-escape-popover]').count()).toBe(1)
  expect(await page.locator('[data-escape-node]').getAttribute('data-selected')).toBe('true')
})

it('yields focus-outside Escape to a higher dialog before closing the parent', async () => {
  await page.reload()
  await openEscapePopover()
  await page.locator('[data-open-higher-dialog]').click()
  await page.locator('[data-escape-outside]').focus()
  await page.keyboard.press('Escape')
  await expect.poll(() => page.locator('[data-document-child="dialog"]').count()).toBe(0)
  expect(await page.locator('[data-escape-popover]').count()).toBe(1)
  expect(await page.locator('[data-escape-node]').getAttribute('data-selected')).toBe('true')
})

it('preserves React Flow Escape deselection when no anchored popover owns the key', async () => {
  await page.reload()
  const flowNode = page.locator('.react-flow__node[data-id="escape-node"]')
  await focusFlowNode(flowNode)
  await page.keyboard.press('Escape')
  await expect.poll(() => page.locator('[data-escape-composer]').count()).toBe(0)
  expect(await page.locator('[data-escape-node]').getAttribute('data-selected')).toBe('false')
})

it('retains focus-outside fallback and releases the anchor after closing', async () => {
  await page.reload()
  await openEscapePopover()
  await page.locator('[data-escape-outside]').focus()
  await page.keyboard.press('Escape')
  await expectPopoverClosedWithSelectedNode()
  await page.keyboard.press('Escape')
  await expect.poll(() => page.locator('[data-escape-composer]').count()).toBe(0)
  expect(await page.locator('[data-escape-node]').getAttribute('data-selected')).toBe('false')
})

async function startPan() {
  await page.locator('#stage .react-flow__pane').dispatchEvent('pointerdown', { pointerId: 4, pointerType: 'mouse', isPrimary: true, button: 1, buttons: 4, clientX: 20, clientY: 20 })
  await page.locator('#stage').dispatchEvent('pointermove', { pointerId: 4, pointerType: 'mouse', buttons: 4, clientX: 50, clientY: 40 })
  expect(await page.locator('#stage').getAttribute('data-dragging')).toBe('true')
}
// 2026-09-21：中断收尾**必须落一个真相**。
//
// 中断不会把画布移回去（reconciler.cancel() 只丢还没应用的那一帧 delta），所以「只丢不记」
// 会让记住的视口 ≠ 屏幕上的视口——下次切分类回来、或任何视口同步 effect 跑一次，
// 画布就跳回中断前的位置。这条 case 因此从「一次都不许记」改成「记的是此刻真实的那一份」。
// 只读那一档仍然一次都不记：只读画布本来就不写视口。
it.each([
  ['pointercancel', 1], ['lostpointercapture', 1], ['blur', 1], ['hidden', 1], ['readonly', 0], ['unmount', 1],
])('releases pan state on %s and records the viewport that is actually on screen', async (reason, remembers) => {
  await page.reload()
  await startPan()
  const activeGesture = page.locator('#stage[data-dragging]')
  const activeProof = await proveProbe(activeGesture, 'pan enters the active dragging state before interruption')
  if (reason === 'hidden' || reason === 'readonly' || reason === 'unmount') await page.locator(`#${reason}`).click()
  else await page.locator('#stage').dispatchEvent(reason, { pointerId: 4 })
  if (reason !== 'unmount' && reason !== 'hidden') {
    await page.waitForFunction(() => !document.querySelector('#stage')?.hasAttribute('data-dragging'))
    expect(await page.locator('#stage').getAttribute('data-panning')).toBeNull()
  }
  await expectAbsent(activeGesture, { provenBy: activeProof, message: `${reason} releases the active gesture and it stays released` })
  await expect.poll(() => page.evaluate(() => window.composerFixture.gesture().remembers)).toBe(remembers)
})
it('ignores a different pointer cancellation, and normal pointerup persists exactly once', async () => {
  await page.reload(); await startPan()
  await page.locator('#stage').dispatchEvent('pointercancel', { pointerId: 99 })
  expect(await page.locator('#stage').getAttribute('data-dragging')).toBe('true')
  await page.locator('#stage').dispatchEvent('pointerup', { pointerId: 4 })
  expect(await page.locator('#stage').getAttribute('data-dragging')).toBeNull()
  expect(await page.evaluate(() => window.composerFixture.gesture().remembers)).toBe(1)
})

// 2026-09-25 用户拍板「钉在节点正下方、宽度固定、被挡就挡」（原话：「有时候位置不在下面而是在节点中间」）。
// 以前这里有四条断言守着「翻到上方 / clamp 进视口 / 让开浮动工具条 / 让开底部停靠区」——正是它们让浮框
// 跑到节点身上。现在断反面：节点贴边、贴底、挂工具条、底部有停靠区、缩放到两端，浮框都只跟着节点走。
it('pins the card right below the node whatever the stage edges, toolbar, docks and zoom are', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('#geometry-stage').waitFor({ timeout: 5000 })
  await page.locator('#geometry-toolbar').click()
  await page.evaluate(() => {
    const dock = document.createElement('div')
    dock.setAttribute('data-canvas-bottom-dock', 'true')
    Object.assign(dock.style, { position: 'absolute', left: '0px', bottom: '12px', width: '600px', height: '48px' })
    document.querySelector('#geometry-stage').append(dock)
  })
  const sample = () => page.evaluate(() => {
    const card = document.querySelector('#geometry-card').getBoundingClientRect()
    const node = document.querySelector('#geometry-stage .generation-canvas-v2-node').getBoundingClientRect()
    return { cardTop: card.top, cardWidth: card.width, cardCentre: (card.left + card.right) / 2, nodeBottom: node.bottom, nodeCentre: (node.left + node.right) / 2 }
  })
  for (const zoom of [0.4, 1, 2]) {
    await page.evaluate((value) => window.composerFixture.zoom(value), zoom)
    for (const [left, top] of [[100, 100], [-80, 10], [850, 10], [10, 740], [850, 740]]) {
      await page.locator('#geometry-stage .generation-canvas-v2-node').evaluate((node, point) => { node.style.left = point[0] + 'px'; node.style.top = point[1] + 'px' }, [left, top])
      await expect.poll(async () => {
        const m = await sample()
        return Math.abs(m.cardTop - (m.nodeBottom + 14 * zoom)) < 1 && Math.abs(m.cardWidth - 560) < 1 && Math.abs(m.cardCentre - m.nodeCentre) < 1
      }, { message: `zoom=${zoom} node=(${left},${top})` }).toBe(true)
    }
  }
})

// 同上：滚轮接管被 blur 打断时，画布已经移过去了，所以记的是此刻真实的那一份（不是「不记」）。
it('wheel takeover is cancelled on blur and keeps the on-screen viewport as the remembered one', async () => {
  await page.reload()
  await page.locator('#stage .react-flow__pane').dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: 20, clientY: 20 })
  await page.locator('#stage').dispatchEvent('wheel', { clientX: 30, clientY: 30, deltaY: 10 })
  await page.locator('#stage').dispatchEvent('pointermove', { pointerId: 7, buttons: 1, clientX: 60, clientY: 60 })
  expect(await page.locator('#stage').getAttribute('data-dragging')).toBe('true')
  const activeGesture = page.locator('#stage[data-dragging]')
  const activeProof = await proveProbe(activeGesture, 'wheel takeover enters the active dragging state before blur')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  expect(await page.locator('#stage').getAttribute('data-dragging')).toBeNull()
  await expectAbsent(activeGesture, { provenBy: activeProof, message: 'blur releases wheel takeover and it stays released' })
  await expect.poll(() => page.evaluate(() => window.composerFixture.gesture().remembers)).toBe(1)
})
it('cancelling one stage keeps another active stage owned', async () => {
  await page.reload(); await startPan()
  await page.evaluate(() => { window.releaseOther = window.composerFixture.holdOther() })
  await page.locator('#stage').dispatchEvent('pointercancel', { pointerId: 4 })
  expect(await page.locator('#other-stage').getAttribute('data-dragging')).toBe('true')
  await page.evaluate(() => window.releaseOther())
})

it('history A to B to A restores composer without replacing a typed draft', async () => {
  await page.reload()
  await page.locator('#unpublished-draft').fill('unpublished across A B A')
  await page.locator('#history').click()
  expect(await page.locator('#history').textContent()).toBe('history')
  await page.locator('#identity').click()
  expect(await page.locator('#history').textContent()).toBe('composer')
  await page.locator('#identity').click()
  expect(await page.locator('#history').textContent()).toBe('composer')
  expect(await page.locator('#unpublished-draft').inputValue()).toBe('unpublished across A B A')
})
it('keeps a slider keyboard edit projected through the original React Flow ownership boundary', async () => {
  await page.reload()
  const slider = page.getByRole('slider', { name: 'projection duration' })
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => page.locator('[data-projection-duration]').textContent()).toBe('6')
  expect(await page.evaluate(() => window.projectionSnapshot())).toEqual({ ownsNodes: true, position: { x: 40, y: 40 } })
  await expect.poll(() => slider.getAttribute('aria-valuenow')).toBe('6')
})

it('keeps original node keyboard movement from disabling subsequent projection updates', async () => {
  await page.reload()
  await focusFlowNode(page.locator('.react-flow__node[data-id="projection-node"]'))
  await page.keyboard.press('ArrowRight')
  // 键盘移动经 React Flow 的 change 回调异步投影回来：等状态转换，不在按键后同一拍读。
  await expect.poll(async () => (await page.evaluate(() => window.projectionSnapshot())).position.x).toBeGreaterThan(40)
  expect((await page.evaluate(() => window.projectionSnapshot())).ownsNodes).toBe(true)
  const slider = page.getByRole('slider', { name: 'projection duration' })
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => page.locator('[data-projection-duration]').textContent()).toBe('6')
  await expect.poll(() => slider.getAttribute('aria-valuenow')).toBe('6')
})


it('opens an unselected history through the real delayed React Flow selection projection', async () => {
  await page.reload()
  const a = page.locator('[data-projected-history="history-a"]')
  const b = page.locator('[data-projected-history="history-b"]')
  expect(await a.locator('[data-projected-tray]').count()).toBe(0)
  await a.locator('[data-history-trigger]').click()
  await expect.poll(() => a.getAttribute('data-selected')).toBe('true')
  await expect.poll(() => a.locator('[data-projected-tray]').count()).toBe(1)
  await b.locator('[data-history-trigger]').click()
  await expect.poll(() => b.locator('[data-projected-tray]').count()).toBe(1)
  await expect.poll(() => a.locator('[data-projected-tray]').count()).toBe(0)
  await a.locator('[data-history-trigger]').click()
  await expect.poll(() => a.locator('[data-projected-tray]').count()).toBe(1)
  await a.locator('[data-history-trigger]').click()
  await expect.poll(() => a.locator('[data-projected-tray]').count()).toBe(0)
  await page.locator('[data-history-availability]').click()
  await a.locator('[data-history-trigger]').click()
  expect(await a.locator('[data-projected-tray]').count()).toBe(0)
  await page.locator('[data-history-availability]').click()
  expect(await a.locator('[data-projected-tray]').count()).toBe(0)
})
