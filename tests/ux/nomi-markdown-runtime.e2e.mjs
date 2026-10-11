import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'vite'
import { expect } from '@playwright/test'
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { redact } from './nomi-user-workflow-performance.e2e.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { waitForMarkdownModuleRequest } from './nomi-markdown-runtime-probe.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const output = path.join(root, 'docs/evidence/2026-10-10-nomi-user-performance/markdown-runtime', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`)
fs.mkdirSync(output, { recursive: true })
const sources = ['tests/ux/nomi-markdown-runtime.e2e.mjs', 'tests/ux/nomi-markdown-runtime-probe.mjs', 'tests/ux/fixtures/nomi-markdown-runtime/main.tsx', 'tests/ux/fixtures/nomi-markdown-runtime/index.html', 'tests/ux/_launchApp.mjs', 'tests/ux/full-walk/invariants.mjs', 'scripts/walkthrough-network-guard.cjs', 'src/workbench/common/LazyNomiMarkdown.tsx', 'src/workbench/common/NomiMarkdown.tsx', 'src/ui/chunkBoundary.tsx', 'src/workbench/ai/v4/AgentPanelV4Markdown.tsx', 'src/workbench/skillLibrary/SkillDetail.tsx', 'src/workbench/promptLibrary/PromptPreviewOverlay.tsx', 'src/workbench/generationCanvas/nodes/artifact/ArtifactBody.tsx']
const report = { scope: 'real production component runtime in Electron; controlled fixture props/resource faults; native navigation and provider tasks unverified', head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceHashes: Object.fromEntries(sources.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])), cells: [], passed: false }
const server = await createServer({ root, configFile: false, cacheDir: makeTempDir('nomi-markdown-vite-'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime'] } })
let instance
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const tempRoot = makeTempDir('nomi-markdown-runtime-')
  const logPath = path.join(tempRoot, 'network.jsonl')
  instance = await launchNomiApp({ name: 'nomi-markdown-runtime', tempRoot, settleMs: 0,
    mainRequire: [path.join(root, 'scripts/walkthrough-network-guard.cjs')],
    env: { NOMI_RENDERER_URL: `${origin}/tests/ux/fixtures/nomi-markdown-runtime/index.html`, NOMI_WALK_NET_LOG: logPath, NOMI_WALK_ALLOW_ORIGINS: '', NOMI_WALK_URL_REDIRECTS: '[]' },
  })
  const { win: page } = instance
  const pid = await instance.app.evaluate(() => process.pid)
  for (const locale of ['zh-CN', 'en']) for (const surface of ['agent', 'skill', 'prompt', 'artifact']) {
    const cell = { locale, surface, pid, cases: [], passed: false }
    report.cells.push(cell)
    try {
    let held, resolveRequested
    const requested = new Promise(resolve => { resolveRequested = resolve })
    let requests = 0
    await page.route('**/src/workbench/common/NomiMarkdown.tsx*', route => { requests += 1; held = route; resolveRequested() })
    await page.goto(`${origin}/tests/ux/fixtures/nomi-markdown-runtime/index.html?surface=${surface}`)
    await page.evaluate(locale => localStorage.setItem('nomi:locale:v1', locale), locale)
    await page.reload()
    await expect(page.locator('[data-runtime-open]')).toBeVisible()
    assert.equal(requests, 0, 'Markdown must remain absent before first use')
    await page.locator('[data-runtime-open]').click()
    await waitForMarkdownModuleRequest(requested)
    await expect(page.getByText(uiText(locale, 'common.rendering'), { exact: true })).toBeVisible()
    cell.cases.push('cold first-use fallback; absent before input')
    await page.evaluate(() => window.__nomiMarkdownRuntime.update())
    await expect(page.locator('[data-runtime-version]')).toHaveText('1')
    await held.continue()
    await page.unroute('**/src/workbench/common/NomiMarkdown.tsx*')
    await expect(page.getByRole('heading', { name: 'LATEST_CONTENT', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'OLD_CONTENT', exact: true })).toHaveCount(0)
    await expect(page.getByRole('table')).toContainText('verified')
    await expect(page.locator('pre')).toContainText('COPY_SOURCE_1')
    await expect(page.getByRole('link', { name: /Explicit image/ })).toHaveAttribute('href', 'https://example.invalid/image.png')
    cell.cases.push('newest props survive suspended first load; table/code/explicit image link')
    if (surface === 'agent') {
      await page.evaluate(() => window.__nomiMarkdownRuntime.update())
      await expect(page.getByText('STREAM_STEP_2', { exact: true })).toBeVisible()
      await page.evaluate(() => { window.__nomiMarkdownRuntime.update(); window.__nomiMarkdownRuntime.finish() })
      await expect(page.getByText('STREAM_STEP_3', { exact: true })).toBeVisible()
      cell.cases.push('two real renderer stream prop updates and final completion')
    }
    await page.screenshot({ path: path.join(output, `${locale}-${surface}-rendered.png`) })
    await page.evaluate(() => window.__nomiMarkdownRuntime.close())
    await expect(page.getByRole('heading', { name: 'LATEST_CONTENT', exact: true })).toHaveCount(0)
    await page.evaluate(() => window.__nomiMarkdownRuntime.open())
    await expect(page.getByRole('heading', { name: 'LATEST_CONTENT', exact: true })).toBeVisible()
    cell.cases.push('close/unmount and reopen retain current content')
    // Fresh JS context and a failed real module fetch. Cooldown isolates the
    // visible local failure contract from the existing automatic reload policy.
    await page.route('**/src/workbench/common/NomiMarkdown.tsx*', route => route.fulfill({ status: 503, contentType: 'text/javascript', body: 'Controlled missing Markdown chunk' }))
    await page.reload()
    await page.evaluate(() => sessionStorage.setItem('nomi.chunk-boundary.auto-reload.Markdown', String(Date.now())))
    await page.locator('[data-runtime-open]').click()
    await expect(page.locator('[data-chunk-boundary="Markdown"]')).toBeVisible()
    await expect(page.locator('[data-runtime-controls]')).toBeVisible()
    cell.cases.push('failed first module fetch stays local; parent controls survive')
    await page.screenshot({ path: path.join(output, `${locale}-${surface}-failure.png`) })
    await page.evaluate(() => window.__nomiMarkdownRuntime.close())
    await expect(page.locator('[data-runtime-surface]')).toHaveCount(0)
    await page.evaluate(() => window.__nomiMarkdownRuntime.open())
    await expect(page.locator('[data-chunk-boundary="Markdown"]')).toBeVisible()
    cell.cases.push('close/reopen preserves explicit cached chunk failure')
    await page.unroute('**/src/workbench/common/NomiMarkdown.tsx*')
    await page.reload()
    await page.locator('[data-runtime-open]').click()
    await expect(page.getByRole('heading', { name: 'OLD_CONTENT', exact: true })).toBeVisible()
    cell.cases.push('fresh context recovers original chunk after resource restoration')
    cell.passed = true
    } catch (error) {
      cell.failure = error.message
      cell.failureObservation = await page.evaluate(() => ({ headings: Array.from(document.querySelectorAll('h1')).map(element => element.textContent), controlsPresent: Boolean(document.querySelector('[data-runtime-controls]')), localChunkErrorPresent: Boolean(document.querySelector('[data-chunk-boundary="Markdown"]')) }))
      await page.screenshot({ path: path.join(output, `${locale}-${surface}-failed-observation.png`) })
      await page.unroute('**/src/workbench/common/NomiMarkdown.tsx*')
    }
  }
  await closeNomiApp(instance.app); instance = null
  const guards = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  const loaded = guards.filter(entry => entry.kind === 'guard-loaded' && entry.pid === pid)
  assert.equal(loaded.length, 1)
  assert.ok(['fetch', 'http', 'https', 'socket', 'chromium'].every(layer => loaded[0].layers.includes(layer)))
  assert.equal(guards.filter(entry => entry.kind === 'blocked' || entry.kind === 'guard-error').length, 0)
  report.guard = { pid, layers: loaded[0].layers, blockedAttempts: 0, errors: 0 }
  fs.copyFileSync(logPath, path.join(output, 'network.jsonl'), fs.constants.COPYFILE_EXCL)
  report.guard.sha256 = createHash('sha256').update(fs.readFileSync(path.join(output, 'network.jsonl'))).digest('hex')
  report.passed = report.cells.length === 8 && report.cells.every(cell => cell.passed)
  if (!report.passed) process.exitCode = 1
} catch (error) { report.failure = error.message; process.exitCode = 1 }
finally {
  if (instance) await closeNomiApp(instance.app)
  await server.close()
  fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(redact(report), null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ output, passed: report.passed, cells: report.cells.map(({ locale, surface, passed, cases }) => ({ locale, surface, passed, cases })), failure: report.failure }))
}
