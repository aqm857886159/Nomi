// Clip state precedence: selected wins over active, active belongs to trajectory clips only, neither inherits plain hover; labels inherit the clip foreground.
// Real production component + generated production CSS in Chromium; expected values are reference evidence.
// Run: node --import tsx tests/ux/director-clip-states.walk.mjs
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from 'playwright'
import { applyColorSchemeForShot, expect, screenshotSettled } from './_assert.mjs'
import { ClipBar } from '../../src/workbench/generationCanvas/nodes/director/timeline/ClipBar.tsx'

const reference = {
  trajectory: { label: '路径片段 0~120', base: '#0084d1', hover: 'oklch(68.5% .169 237.323)', text: 'oklch(97.7% .013 236.62)', alpha: 0.9 },
  closeup: { label: '特写片段 120~240', base: '#ec003f', hover: 'oklch(64.5% .246 16.439)', text: 'oklch(96.9% .015 12.422)', alpha: 0.9 },
  action: { label: '动作·行走', base: '#007a55', hover: 'oklch(59.6% .145 163.225)', text: 'oklch(95% .052 163.051)', alpha: 0.8 },
  pose: { label: '骨骼姿态片段', base: '#bb4d00', hover: 'oklch(66.6% .179 58.318)', text: 'oklch(96.2% .059 95.617)', alpha: 0.8 },
  lookat: { label: '视线·主角', base: '#432dd7', hover: 'oklch(51.1% .262 276.966)', text: 'oklch(93% .034 272.788)', alpha: 0.8 },
}
const out = path.resolve('tests/ux/shots/director/clip-states')
fs.mkdirSync(out, { recursive: true })
const css = fs.readFileSync('public/tailwind.generated.css', 'utf8')
const cases = Object.entries(reference).flatMap(([tone, value]) => ['normal', 'selected', 'active', 'selected-active'].map(state => {
  const id = `${tone}-${state}`
  return { id, tone, value, selected: state.includes('selected'), active: state.includes('active') }
}))
const browser = await chromium.launch({ headless: true, channel: process.env.NOMI_BROWSER_CHANNEL })
const page = await browser.newPage({ viewport: { width: 1080, height: 370 } })
let failures = 0
const results = []
async function compare(locator, expected, label) {
  // 等组件自己的颜色过渡结束，避免在主题/hover 的中间帧取样。
  await locator.evaluate(element => Promise.allSettled(element.getAnimations().map(animation => animation.finished)))
  const inspect = () => locator.evaluate((element, wanted) => {
    const color = value => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.fillStyle = value
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    return Object.entries(wanted).map(([property, value]) => ({ property, actual: color(getComputedStyle(element)[property]), expected: color(value) }))
  }, expected)
  const matches = values => values.every(v => v.actual.every((n, i) => Math.abs(n - v.expected[i]) <= 2))
  try { await expect.poll(async () => matches(await inspect()), { timeout: 1200 }).toBe(true) }
  catch { failures++; console.log(`FAIL ${label}: ${JSON.stringify(await inspect())}`) }
  results.push({ label, values: await inspect() })
}
try {
  const rows = cases.map(item => {
    const markup = renderToStaticMarkup(React.createElement(ClipBar, {
      clip: { id: item.id, tone: item.tone, label: item.value.label, startTime: 0, endTime: 4 },
      left: 0, width: 238, selected: item.selected, active: item.active, muted: false, onPointerDown: () => {},
    }))
    return `<div class="cell">${markup}</div>`
  }).join('')
  await page.setContent(`<html><head><style>${css}</style><style>body{padding:20px;background:var(--nomi-bg);color:var(--nomi-ink)}.matrix{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.cell{height:32px;position:relative}h1{font:16px system-ui;margin-bottom:16px}header{display:grid;grid-template-columns:repeat(4,1fr);margin-bottom:12px;font:12px system-ui}</style></head><body><h1>导演台 · 片段状态对账</h1><header><span>普通 / 悬停</span><span>选中</span><span>激活</span><span>选中优先</span></header><div class="matrix">${rows}</div></body></html>`)
  for (const theme of ['light', 'dark']) {
    await applyColorSchemeForShot(page, theme)
    for (const item of cases) {
      const clip = page.locator(`[data-clip-id="${item.id}"]`)
      const active = item.tone === 'trajectory' && item.active && !item.selected
      const alpha = item.selected ? 1 : active ? 0.95 : item.value.alpha
      const backgroundColor = `color-mix(in srgb, ${item.value.base} ${alpha * 100}%, transparent)`
      const foreground = item.selected ? '#fff' : active ? 'oklch(98.4% .019 200.873)' : item.value.text
      const borderColor = item.selected ? '#fff' : active ? '#00d3f2' : 'transparent'
      await page.mouse.move(0, 0)
      await compare(clip, { backgroundColor, borderTopColor: borderColor }, `${theme}/${item.id}`)
      await compare(clip.locator('span').first(), { color: foreground }, `${theme}/${item.id}/label`)
      await clip.hover()
      await compare(clip, { backgroundColor: item.selected || active ? backgroundColor : `color-mix(in srgb, ${item.value.hover} ${alpha * 100}%, transparent)` }, `${theme}/${item.id}/hover`)
      if (item.selected) {
        const handle = clip.locator('[aria-hidden] > span, [aria-hidden]:not(:has(span))').first()
        await compare(handle, { backgroundColor: 'rgba(255,255,255,.75)' }, `${theme}/${item.id}/handle`)
        await expect(handle).toHaveCSS('width', '4px')
        const box = await clip.boundingBox()
        await page.mouse.move(box.x + 8, box.y + box.height / 2)
        await compare(handle, { backgroundColor: 'rgba(255,255,255,.9)' }, `${theme}/${item.id}/handle-hover`)
        await expect(handle).toHaveCSS('width', '5px')
        await expect(clip.locator('[aria-hidden] > span, [aria-hidden]:not(:has(span))').last()).toHaveCSS('width', '4px')
      }
    }
    await page.mouse.move(0, 0)
    await screenshotSettled(page, { path: path.join(out, `${theme}.png`) })
  }
} finally {
  fs.writeFileSync(path.join(out, 'computed-styles.json'), JSON.stringify({ failures, results }, null, 2))
  await browser.close()
}
console.log(`clip states: ${results.length} checks; ${failures} failures`)
if (failures) process.exitCode = 1
