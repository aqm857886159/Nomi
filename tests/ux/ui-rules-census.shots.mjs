// UI 规则普查 · 取证截图（只读，不是门岗）。
//
// 读 `tests/ux/shots/ui-rules-census/report.json`（ui-rules-census.dom.mjs 跑出来的），
// 每条规则挑「命中最多的 3 个格（尽量不同屏）」，在设计实验室里重新渲染那一格，
// 把这一格里该规则的全部命中用红框圈出来，整屏截图到 `tests/ux/shots/ui-rules-census/top3/<规则>__<序号>__<屏>__<格>.png`。
// 格 id 带 -zh / -en 的会在文件名里标出语言；没带的是中文默认格（设计实验室大多数格只有一种语言）。
//
// 用法：node tests/ux/ui-rules-census.shots.mjs        （RULES=UI-R10,UI-R04 只截这几条）
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './design-lab/labStates.mjs'
import { assertLabPortOwnership, labOriginFor } from './design-lab/labServer.mjs'
import { stationTimeout } from './_station-budget.mjs'

const ROLE = 'popup-geometry'
const ORIGIN = labOriginFor(ROLE)
const OUT = path.join(REPO_ROOT, 'tests/ux/shots/ui-rules-census/top3')
const report = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tests/ux/shots/ui-rules-census/report.json'), 'utf8'))
const only = (process.env.RULES || '').split(',').filter(Boolean)
// 已知是误报 / 信息档的不截：10-spaced（WCAG 间距例外已满足）、23（白字压在缩略图上，量不到图片背景）
const SKIP = new Set(['UI-R10-spaced', 'UI-R23'])
const picks = []
for (const [rule, rows] of Object.entries(report.byRule)) {
  if (SKIP.has(rule) || (only.length && !only.includes(rule))) continue
  const byCell = new Map()
  for (const r of rows) (byCell.get(r.cell) ?? byCell.set(r.cell, []).get(r.cell)).push(r)
  const ranked = [...byCell.entries()].sort((a, b) => b[1].length - a[1].length)
  const chosen = []
  const screens = new Set()
  for (const [cell, hits] of ranked) { const screen = cell.split('/')[0]; if (!screens.has(screen) && chosen.length < 3) { chosen.push([cell, hits]); screens.add(screen) } }
  for (const [cell, hits] of ranked) if (chosen.length < 3 && !chosen.some(([c]) => c === cell)) chosen.push([cell, hits])
  chosen.forEach(([cell, hits], i) => picks.push({ rule, cell, hits, n: i + 1 }))
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const tailwind = spawnSync(process.execPath, ['scripts/build-tailwind.mjs'], { cwd: REPO_ROOT, stdio: 'inherit' })
if (tailwind.status !== 0) throw new Error('build-tailwind 失败')
assertLabPortOwnership(ROLE)
const vite = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', new URL(ORIGIN).port, '--strictPort'], { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'pipe'] })
vite.stderr?.on('data', (c) => process.stderr.write(`[vite] ${c}`))
const browser = await chromium.launch()
const index = []
try {
  for (let t = Date.now() + 300000; ; ) {
    try { if ((await fetch(`${ORIGIN}/design-lab.html`)).ok) break } catch { /* not up */ }
    if (Date.now() > t) throw new Error('vite 起不来')
    await new Promise((r) => setTimeout(r, 400))
  }
  for (const { rule, cell, hits, n } of picks) {
    const [screen, id] = cell.split('/')
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', deviceScaleFactor: 1 })
    try {
      const page = await context.newPage()
      await page.goto(`${ORIGIN}/design-lab.html?screen=${screen}&frame=1&state=${id}`, { timeout: 180000, waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => window.__designLabReady === true, null, { timeout: stationTimeout() })
      await page.waitForTimeout(250)
      await page.evaluate((rects) => {
        for (const r of rects) {
          const box = document.createElement('div')
          box.style.cssText = `position:fixed;left:${r.x - 2}px;top:${r.y - 2}px;width:${r.w + 4}px;height:${r.h + 4}px;outline:2px solid #ff2d55;pointer-events:none;z-index:2147483647`
          document.body.appendChild(box)
        }
      }, hits.map((h) => h.rect))
      const lang = /(^|[-_])en([-_]|$)/.test(id) ? 'en' : /(^|[-_])zh([-_]|$)/.test(id) ? 'zh' : 'zh(默认)'
      const file = path.join(OUT, `${rule}__${n}__${screen}__${id}.png`.replace(/[^\w.\-]+/g, '_'))
      await page.screenshot({ path: file, animations: 'disabled' })
      index.push({ rule, n, cell, lang, hits: hits.length, example: hits[0].text || hits[0].label || '', file: path.relative(REPO_ROOT, file).split(path.sep).join('/') })
      console.log(`  ${rule} #${n} ${cell}（${hits.length} 处）`)
    } catch (e) { console.log(`  ✗ ${rule} ${cell}: ${String(e).split(/\r?\n/)[0]}`) } finally { await context.close() }
  }
} finally { await browser.close(); vite.kill() }
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2))
console.log(`截图 ${index.length} 张 → ${path.relative(REPO_ROOT, OUT)}`)
