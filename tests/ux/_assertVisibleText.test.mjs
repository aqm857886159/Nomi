// 真浏览器契约测试（#1705 走查真信号加固）：
// 1. `expectVisibleText`：可见文本通过，`display: none` / `[hidden]` / `visibility: hidden` 隐藏后代必红（对照 `toContainText` 会假绿）。
// 2. `probeInlineWhiteboardCanvas`：真实绘出多色源图的 `<canvas>` 通过，空白纸底 `#fbfbfa` / 全透明 / 隐藏画布必红。
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { chromium } from 'playwright'
import { expect as pwExpect, expectVisibleText } from './_assert.mjs'
import { probeInlineWhiteboardCanvas } from './full-walk/whiteboardCanvasProbe.mjs'

let browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 120_000)
afterAll(async () => { await browser?.close() })

async function htmlPage(markup) {
  const page = await browser.newPage()
  await page.setContent(`<!doctype html><html><body>${markup}</body></html>`)
  return page
}

describe('expectVisibleText：只认元素本身可见，隐藏后代必红', () => {
  test('可见标题与多行提示文案（white-space: pre-line）→ 通过', async () => {
    const page = await htmlPage(`
      <div role="dialog">
        <h2>再发一次这张图片？</h2>
        <p style="white-space: pre-line">上一次还没结束。\n再发一次可能会再扣一次钱。</p>
      </div>
    `)
    try {
      const dialog = page.getByRole('dialog')
      await expectVisibleText(dialog, '再发一次这张图片？', { timeout: 1000 })
      await expectVisibleText(dialog, '上一次还没结束。', { timeout: 1000 })
      await expectVisibleText(dialog, '再发一次可能会再扣一次钱。', { timeout: 1000 })
    } finally {
      await page.close()
    }
  }, 60_000)

  test('反例：外层弹窗可见但警示语在 display:none 后代里 → toContainText 假绿，expectVisibleText 必红', async () => {
    const page = await htmlPage(`
      <div role="dialog">
        <h2>再发一次这张图片？</h2>
        <p>上一次还没结束。</p>
        <p style="display: none">再发一次可能会再扣一次钱。</p>
      </div>
    `)
    try {
      const dialog = page.getByRole('dialog')
      // 对照：旧写法 toContainText 会把 display:none 后代当通过（假绿）
      await pwExpect(dialog).toContainText('再发一次可能会再扣一次钱。', { timeout: 1000 })
      // 新断言：必须报红失败
      await expect(
        expectVisibleText(dialog, '再发一次可能会再扣一次钱。', { timeout: 400 }),
      ).rejects.toThrow(/未找到自身可见的文本|toBeVisible/)
    } finally {
      await page.close()
    }
  }, 60_000)

  test('反例：警示语在 [hidden] 或 visibility:hidden 后代里 → 必红', async () => {
    const page = await htmlPage(`
      <div role="dialog">
        <h2>再发一次这张图片？</h2>
        <p hidden>再发一次可能会再扣一次钱。</p>
        <p style="visibility: hidden">上一次还没结束。</p>
      </div>
    `)
    try {
      const dialog = page.getByRole('dialog')
      await pwExpect(dialog).toContainText('再发一次可能会再扣一次钱。', { timeout: 1000 })
      await expect(
        expectVisibleText(dialog, '再发一次可能会再扣一次钱。', { timeout: 400 }),
      ).rejects.toThrow(/未找到自身可见的文本|toBeVisible/)
      await expect(
        expectVisibleText(dialog, '上一次还没结束。', { timeout: 400 }),
      ).rejects.toThrow(/未找到自身可见的文本|toBeVisible/)
    } finally {
      await page.close()
    }
  }, 60_000)

  test('反例：可见 <p> 内嵌 display:none <span> 藏起警示语 → 必红', async () => {
    const page = await htmlPage(`
      <div role="dialog">
        <p>上一次还没结束。<span style="display: none">再发一次可能会再扣一次钱。</span></p>
      </div>
    `)
    try {
      const dialog = page.getByRole('dialog')
      await expect(
        expectVisibleText(dialog, '再发一次可能会再扣一次钱。', { timeout: 400 }),
      ).rejects.toThrow(/未找到自身可见的文本|toBeVisible/)
    } finally {
      await page.close()
    }
  }, 60_000)

  test('同容器里存在一份隐藏副本 + 一份真实可见元素 → 通过（不因 strict mode 假红）', async () => {
    const page = await htmlPage(`
      <div role="dialog">
        <span style="display: none">再发一次可能会再扣一次钱。</span>
        <p>再发一次可能会再扣一次钱。</p>
      </div>
    `)
    try {
      const dialog = page.getByRole('dialog')
      await expectVisibleText(dialog, '再发一次可能会再扣一次钱。', { timeout: 1000 })
    } finally {
      await page.close()
    }
  }, 60_000)

  test('exact: true 严格区分整段与子串', async () => {
    const page = await htmlPage('<div role="dialog"><p>上一次还没结束。再发一次可能会再扣一次钱。</p></div>')
    try {
      const dialog = page.getByRole('dialog')
      await expectVisibleText(dialog, '再发一次可能会再扣一次钱。', { exact: false, timeout: 1000 })
      await expect(
        expectVisibleText(dialog, '再发一次可能会再扣一次钱。', { exact: true, timeout: 400 }),
      ).rejects.toThrow(/未找到自身可见的文本|toBeVisible/)
    } finally {
      await page.close()
    }
  }, 60_000)
})

describe('probeInlineWhiteboardCanvas：量取画板 <canvas> 真实渲染像素', () => {
  test('反例：画板未挂载 / 隐藏 / 全透明 <canvas> / 纯 #fbfbfa 空白纸底 → hasRenderedContent 全为 false', async () => {
    const page = await htmlPage('')
    try {
      expect((await page.evaluate(probeInlineWhiteboardCanvas)).hasRenderedContent).toBe(false)

      // 全透明 canvas
      await page.setContent(`
        <div data-nomi-inline-whiteboard="true" style="width:320px;height:180px">
          <canvas width="320" height="180" style="width:320px;height:180px"></canvas>
        </div>
      `)
      const transparent = await page.evaluate(probeInlineWhiteboardCanvas)
      expect(transparent.boardVisible).toBe(true)
      expect(transparent.hasRenderedContent).toBe(false)
      expect(transparent.bestCanvas.nonTransparentSamples).toBe(0)

      // 纯空白纸底 #fbfbfa（模拟源图写进 canvasAssets 但图层不可见或渲染层未绘出图）
      await page.evaluate(() => {
        const ctx = document.querySelector('canvas').getContext('2d')
        ctx.fillStyle = '#fbfbfa'
        ctx.fillRect(0, 0, 320, 180)
      })
      const blankPaper = await page.evaluate(probeInlineWhiteboardCanvas)
      expect(blankPaper.boardVisible).toBe(true)
      expect(blankPaper.hasRenderedContent).toBe(false)
      expect(blankPaper.bestCanvas.nonTransparentSamples).toBeGreaterThan(0)
      expect(blankPaper.bestCanvas.distinctColors).toBe(1)
      expect(blankPaper.bestCanvas.nonUniformSamples).toBe(0)
    } finally {
      await page.close()
    }
  }, 60_000)

  test('正例：在 #fbfbfa 纸底上真实绘出多色源图（并存透明覆盖层 canvas）→ hasRenderedContent 为 true', async () => {
    const page = await htmlPage(`
      <div data-nomi-inline-whiteboard="true" style="width:320px;height:180px">
        <canvas id="tree" width="320" height="180" style="width:320px;height:180px"></canvas>
        <canvas id="sky" width="320" height="180" style="width:320px;height:180px"></canvas>
      </div>
    `)
    try {
      await page.evaluate(() => {
        const ctx = document.getElementById('tree').getContext('2d')
        ctx.fillStyle = '#fbfbfa'
        ctx.fillRect(0, 0, 320, 180)
        // 模拟真实源图块（多色梯度）
        const grad = ctx.createLinearGradient(40, 20, 260, 150)
        grad.addColorStop(0, '#1e3a8a')
        grad.addColorStop(0.5, '#059669')
        grad.addColorStop(1, '#d97706')
        ctx.fillStyle = grad
        ctx.fillRect(40, 20, 220, 130)
      })
      const rendered = await page.evaluate(probeInlineWhiteboardCanvas)
      expect(rendered.boardVisible).toBe(true)
      expect(rendered.visibleCanvasCount).toBe(2)
      expect(rendered.hasRenderedContent).toBe(true)
      expect(rendered.bestCanvas.distinctColors).toBeGreaterThanOrEqual(2)
      expect(rendered.bestCanvas.nonUniformSamples).toBeGreaterThanOrEqual(8)
    } finally {
      await page.close()
    }
  }, 60_000)
})
