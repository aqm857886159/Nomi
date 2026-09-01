// One-shot renderer for the video-deconstruction v1 mockup.
// Runs from the main repo's playwright (this worktree has no node_modules).
// Usage: node scripts/render-deconstruction-shots.mjs [absolute-html-path] [absolute-out-dir]
import { chromium } from '/Users/aoqimin/Desktop/Nomi/node_modules/playwright/index.mjs'
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const htmlPath =
  process.argv[2] ||
  '/Users/aoqimin/Desktop/nomi-w3-design/docs/design/mockups/2026-09-01-video-deconstruction-v1.html'
const outDir =
  process.argv[3] ||
  '/Users/aoqimin/Desktop/nomi-w3-design/docs/design/mockups/2026-09-01-video-deconstruction-v1'

mkdirSync(outDir, { recursive: true })

// Each labeled block: give its .sheet-label + following sibling(s) an id via nth match.
// We target by walking the DOM: a "shot" = the .app / wrapper right after each .sheet-label.
const shots = [
  { file: '00-full.png', selector: null }, // whole page
  { file: '01-layoutA-result.png', selector: '#app-a' },
  { file: '06-layoutA-agent-collapsed.png', selector: '#app-agent-collapsed' },
  { file: '07-layoutA-decon-collapsed.png', selector: '#app-decon-collapsed' },
  { file: '02-layoutA-states.png', selector: '#states-row' },
  { file: '03-layoutA-canvas-group.png', selector: '#app-canvas-group' },
  { file: '04-layoutB-drawer.png', selector: '#app-layout-b' },
  { file: '05-dark-result.png', selector: '#app-dark' },
]

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 2 })
await page.setViewportSize({ width: 1340, height: 1200 })
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' })
// Let the "appearing" pop animations settle so the group shot is stable.
await page.waitForTimeout(700)

for (const shot of shots) {
  const target = join(outDir, shot.file)
  if (!shot.selector) {
    await page.screenshot({ path: target, fullPage: true })
    console.log('rendered', shot.file, '(fullPage)')
    continue
  }
  const el = await page.$(shot.selector)
  if (!el) {
    console.error('MISSING selector', shot.selector, '->', shot.file)
    process.exitCode = 1
    continue
  }
  await el.screenshot({ path: target })
  console.log('rendered', shot.file, 'from', shot.selector)
}

await browser.close()
console.log('done')
