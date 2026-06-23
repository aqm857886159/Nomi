// Pose Lab 截图器：连本地 vite dev，渲染 pose-lab.html 的正/侧两视图各截一张。
// 用法：先 `pnpm dev:renderer`（后台），再 `node scripts/pose-lab-shot.mjs [port]`
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = process.argv[2] || '5273'
const outDir = path.join(repoRoot, '.pose-lab')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1800, height: 900 }, deviceScaleFactor: 2 })

async function shoot(view, from, count, tag) {
  const page = await context.newPage()
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', (err) => errors.push(String(err)))
  await page.goto(`http://127.0.0.1:${port}/pose-lab.html?view=${view}&from=${from}&count=${count}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__poseLabReady === true, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const file = path.join(outDir, `pose-${view}-${tag}.png`)
  await page.screenshot({ path: file })
  console.log(`  ✓ ${view} ${tag} → ${file}`)
  if (errors.length) console.log(`  ⚠ console errors (${view} ${tag}):\n   ` + errors.slice(0, 8).join('\n   '))
  await page.close()
}

const views = (process.argv[3] || 'front,side,q3').split(',')
try {
  for (const view of views) {
    await shoot(view, 0, 4, 'a')
    await shoot(view, 4, 4, 'b')
  }
} finally {
  await browser.close()
}
