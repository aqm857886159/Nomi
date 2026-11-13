// 生成框参考区「同一排所有虚线框」必须按框本身对齐：顶边与高度一致（误差 <= 1px）。
//
// 2026-10-18 用户指出：首尾帧方式下，鼠标点选框（无标签）比「首帧 / 尾帧」加号框（头上有标签）高出一截。
// #1183 把鼠标入口放进这一排时，清单只核了「同排」，没核框的顶边 / 底边，所以门岗没拦住。
// 这里遍历这一排的全部生产形态（真 NodeParameterControls / NodeInputReferenceEntry，零额度，目录桥是桩）：
//   视频：文生 / 首帧 / 首尾帧 / 全能参考（空与已填）；图片：有参考槽与泛用入口；文本节点；每种中英两轨。
// 设 NOMI_ROW_SHOTS=<目录> 会把每种情况的整排截图存下来（人眼对账用）。
import { afterAll, beforeAll, expect, test } from 'vitest'
import { chromium } from 'playwright'
// eslint-disable-next-line browser-fixture/no-restricted-imports -- 存量：用应用 vite.config 起设计实验室（屏按查询串懒加载），迁到 useBrowserFixture 要它先支持应用配置与「屏就绪」判据（docs/fixes/2026-10-24-browser-fixture-ready-signals.root-cause.json 残留风险）
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { assertTailwindApplied, freshTailwindCss } from './_freshTailwindCss.mjs'

freshTailwindCss()

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = process.env.NOMI_ROW_SHOTS
const video = { kind: 'video', archetype: 'seedance-2-apimart', model: 'doubao-seedance-2.0', section: 'all' }
const image = { kind: 'image', archetype: 'gpt-image-2', model: 'gpt-image-2-image-to-image', section: 'all' }
const CASES = [
  ['video-t2v', { ...video, mode: 't2v' }],
  ['video-first', { ...video, mode: 'first' }],
  ['video-firstlast', { ...video, mode: 'firstlast' }],
  ['video-firstlast-filled', { ...video, mode: 'firstlast', fill: 'frames' }],
  ['video-omni', { ...video, mode: 'omni' }],
  ['video-omni-filled', { ...video, mode: 'omni', fill: 'refs' }],
  ['image-edit', { ...image, mode: 'i2i' }],
  ['image-t2i', { ...image, mode: 't2i' }],
  ['text-node', { kind: 'text' }],
]

let server
let browser
let origin
beforeAll(async () => {
  server = await createServer({ root: repoRoot, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } })
  await server.listen()
  origin = `http://127.0.0.1:${server.httpServer.address().port}`
  browser = await chromium.launch({ headless: true })
}, 120000)
afterAll(async () => {
  await browser?.close()
  await server?.close()
})

/** 在页面里量：这一排每个虚线框 / 已填缩略图的顶边与高度。 */
function measureRow() {
  return [...document.querySelectorAll('[data-reference-row-stage] [data-reference-entry], [data-reference-row-stage] [data-asset-add-tile], [data-reference-row-stage] [data-reference-add-entry], [data-reference-row-stage] [data-asset-tile]')]
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        what: element.hasAttribute('data-reference-entry') ? 'pointer' : (element.hasAttribute('data-asset-add-tile') || element.hasAttribute('data-reference-add-entry')) ? 'add' : 'tile',
        top: rect.top, height: rect.height, left: rect.left,
      }
    })
}

for (const locale of ['zh-CN', 'en']) {
  for (const [name, query] of CASES) {
    test(`参考区同一排虚线框按框本身对齐：${name} / ${locale}`, async () => {
      const page = await browser.newPage({ viewport: { width: 700, height: 320 }, deviceScaleFactor: 2 })
      try {
        await page.goto(`${origin}/tests/ux/fixtures/reference-row-alignment-harness.html?${new URLSearchParams({ ...query, locale })}`, { timeout: 90000 })
        await page.addStyleTag({ content: freshTailwindCss() })
        await assertTailwindApplied(page, name)
        await page.locator('[data-reference-entry]').waitFor({ timeout: 60000 })
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        await page.waitForTimeout(400)
        if (shotsDir) {
          fs.mkdirSync(shotsDir, { recursive: true })
          await page.locator('[data-reference-row-stage]').screenshot({ path: path.join(shotsDir, `${name}-${locale === 'en' ? 'en' : 'zh'}.png`) })
        }
        const boxes = await page.evaluate(measureRow)
        expect(boxes.some((box) => box.what === 'pointer'), `${name}: 这一排应有鼠标点选框`).toBe(true)
        expect(boxes.length, `${name}: 鼠标框之外应还有加号框或已填缩略图`).toBeGreaterThanOrEqual(2)
        const head = boxes[0]
        for (const box of boxes) {
          expect(Math.abs(box.top - head.top), `${name}/${locale}: ${box.what} 顶边 ${box.top} 与鼠标框 ${head.top} 不齐（整排 ${JSON.stringify(boxes)}）`).toBeLessThanOrEqual(1)
          expect(Math.abs(box.height - head.height), `${name}/${locale}: ${box.what} 高度 ${box.height} 与鼠标框 ${head.height} 不一致`).toBeLessThanOrEqual(1)
        }
      } finally { await page.close() }
    }, 180000)
  }
}
