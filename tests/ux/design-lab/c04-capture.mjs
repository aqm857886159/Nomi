// Reproduce both revisions in this worktree. Preserve source bytes/index; no checkout, stash or extra worktree.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { labPortFor, assertLabPortOwnership } from './labServer.mjs'
import { withFreshLabPage } from './labPage.mjs'

const root = process.cwd()
const output = path.join(root, 'docs/plan/2026-09-09-storyboard-warning-aggregate-eta')
const sources = ['src/workbench/creation/storyboard/StoryboardPlanStrategyPanel.tsx', 'electron/capabilityCore/mcpGenerationTools.ts']
const saved = new Map(sources.map(file => [file, fs.readFileSync(file)]))
const entry = path.join(root, '.c04-evidence.html')
if (fs.existsSync(entry)) throw new Error('Temporary entry already exists')
const port = labPortFor('walk-storyboard')
const ownership = assertLabPortOwnership('walk-storyboard')
if (ownership.status !== 'free') throw new Error('Capture requires its own lab server')
const css = spawnSync('node', ['scripts/build-tailwind.mjs'], { stdio: 'inherit' })
if (css.status !== 0) throw new Error('Tailwind build failed')
const html = fs.readFileSync('design-lab.html', 'utf8').replace('/src/devlab/designLab.tsx', '/tests/ux/design-lab/c04-evidence.tsx')
fs.writeFileSync(entry, html)
const server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let browser
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Vite startup timed out')), 30_000)
    server.stdout.on('data', chunk => { if (chunk.toString().includes('Local:')) { clearTimeout(timer); resolve() } })
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Vite exited ${code}`)) })
  })
  assertLabPortOwnership('walk-storyboard')
  browser = await chromium.launch({ headless: true })
  const receipt = { baseline: execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim(), head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), viewport: { width: 1440, height: 1100 }, inputs: { shots: 8, outputKinds: ['video'], concurrency: 6 }, phases: {} }
  for (const phase of ['before', 'after']) {
    for (const file of sources) fs.writeFileSync(file, phase === 'before' ? execFileSync('git', ['show', `origin/main:${file}`]) : saved.get(file))
    const fixture = JSON.parse(execFileSync('pnpm', ['exec', 'tsx', 'tests/ux/design-lab/c04-fixture.ts'], { encoding: 'utf8' }))
    receipt.phases[phase] = { eta: fixture.eta, screenshots: {} }
    for (const specimen of ['c04', 'c06']) {
      await withFreshLabPage(browser, { viewport: receipt.viewport, deviceScaleFactor: 1, colorScheme: 'light' }, async page => {
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        await page.addInitScript(data => { window.__c04Fixture = data }, fixture)
        await page.goto(`http://127.0.0.1:${port}/.c04-evidence.html?specimen=${specimen}`, { waitUntil: 'networkidle' })
        const selector = specimen === 'c04' ? '[data-storyboard-strategy-panel]' : '[data-spend-confirm-dialog]'
        await page.locator(selector).waitFor({ state: 'visible' })
        await page.evaluate(() => document.fonts.ready)
        const text = await page.locator(selector).innerText()
        const rows = await page.locator('[data-storyboard-strategy-blocker]').count()
        if (specimen === 'c04' && rows !== (phase === 'before' ? 8 : 1)) throw new Error(`Unexpected blocker rows: ${rows}`)
        if (errors.length) throw new Error(errors.join('\n'))
        const filename = `${specimen}-${phase}.png`
        await page.screenshot({ path: path.join(output, filename), animations: 'disabled' })
        receipt.phases[phase].screenshots[specimen] = { filename, text, blockerRows: rows }
      })
    }
  }
  fs.writeFileSync(path.join(output, 'capture-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
} finally {
  for (const [file, bytes] of saved) fs.writeFileSync(file, bytes)
  await browser?.close()
  server.kill('SIGTERM')
  fs.unlinkSync(entry)
}
