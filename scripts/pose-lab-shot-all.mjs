// 一次性截全部 12 个预设 × 多视角（每视角 3 批 ×4）。用法：node scripts/pose-lab-shot-all.mjs <port>
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2] || '5274'
const outDir = path.join(repoRoot, '.pose-lab')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1800, height: 700 }, deviceScaleFactor: 2 })

async function shoot(view, from, tag) {
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://127.0.0.1:${port}/pose-lab.html?view=${view}&from=${from}&count=4&zoom=150`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__poseLabReady === true, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const file = path.join(outDir, `pose-${view}-${tag}.png`)
  await page.screenshot({ path: file })
  console.log(`  ✓ ${view} ${tag} → ${file}`)
  if (errors.length) console.log(`  ⚠ ${view} ${tag}: ` + errors.slice(0, 4).join(' | '))
  await page.close()
}

const views = (process.argv[3] || 'front,side,q3').split(',')
try {
  for (const view of views) {
    await shoot(view, 0, 'a')  // standing,t-pose,walk,run
    await shoot(view, 4, 'b')  // sit,squat,single-knee,double-knee
    await shoot(view, 8, 'c')  // hands-on-hips,point,wave,cheer
  }
} finally {
  await browser.close()
}
