#!/usr/bin/env node
// 从样张实际渲染结果导出自动层契约；意图关系仍只能由拍板者手写。
// 与 scripts/extract-design-spec.mjs 同一边界：自动层记录挂点/几何，不替代动态 mode proof。
import { chromium } from '/Users/aoqimin/Desktop/Nomi/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mockup = path.join(root, 'docs/design/mockups/2026-09-03-storyboard-anchor-row-and-param-rail.html')
const output = path.join(root, 'docs/design/mockups/contracts/2026-09-03-storyboard-anchor-row-and-param-rail.auto.mjs')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } })
await page.goto(`file://${mockup}`, { waitUntil: 'networkidle' })
const geometry = await page.evaluate(() => {
  const measure = (name, selector, dimension) => {
    const el = document.querySelector(selector)
    const rect = el?.getBoundingClientRect()
    return { name, selector, dimension, expected: Math.round(rect?.[dimension] || 0) }
  }
  return [
    measure('行内画面格', '[data-storyboard-frame]', 'width'),
    measure('行内画面格', '[data-storyboard-frame]', 'height'),
    measure('锚行画面格', '[data-anchor-frame]', 'width'),
    measure('锚行画面格', '[data-anchor-frame]', 'height'),
    // FIX4：锚行「谁引用了我」从纯文字缩略胶囊改为带缩略图的可点行；引用缩略尺寸量的是缩略图
    // 本体（data-anchor-ref-thumb），不是整个可点行（data-shot-ref 现在是行的导航挂点，更宽）。
    measure('锚行引用缩略', '[data-anchor-ref-thumb]', 'width'),
    measure('参考 tile 识别尺寸', '[data-storyboard-ref-tile]', 'width'),
    measure('摘要 pill 高度', '[data-parameter-summary]', 'height'),
  ]
})
await browser.close()
if (geometry.some((rule) => rule.expected <= 0)) throw new Error(`样张挂点缺失，拒绝导出：${JSON.stringify(geometry)}`)
const source = [
  '// 分镜表锚行/镜头行 · 自动层契约（2026-09-03，由样张实际渲染导出）。',
  '// 禁止手改；布局改动后重新运行 scripts/extract-storyboard-anchor-mode-spec.mjs。',
  '',
  'export default ' + JSON.stringify({
    mockup: 'docs/design/mockups/2026-09-03-storyboard-anchor-row-and-param-rail.html',
    surface: '分镜表 · 锚行/镜头行自动层规格',
    layer: 'auto',
    geometry,
  }, null, 2),
  '',
].join('\n')
fs.writeFileSync(output, source)
console.log(`✅ 自动层契约已从样张导出：${geometry.map((rule) => `${rule.selector} ${rule.dimension}=${rule.expected}`).join(', ')}`)
