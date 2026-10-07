// Card 24: read-only English/minimum-window geometry matrix.
// Usage: node tests/ux/card24-window-matrix.mjs [--out <dir>]
// The probe never clicks, changes app state, or intercepts network requests.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LAB_SCREEN_IDS, REPO_ROOT, readLabStates } from './design-lab/labStates.mjs'
import { assertLabPortOwnership, labPortFor } from './design-lab/labServer.mjs'

const root = REPO_ROOT
const outArg = process.argv.indexOf('--out')
const outDir = path.resolve(outArg >= 0 ? process.argv[outArg + 1] : path.join(root, 'docs/research/2026-10-07-pr1014-cards23-25/raw/card24'))
const sizes = [
  { id: 'min-1100x720', width: 1100, height: 720 },
  { id: 'normal-1440x900', width: 1440, height: 900 },
]
const port = labPortFor('popup-geometry', root)
const base = `http://127.0.0.1:${port}`
const vitePath = path.join(root, 'node_modules/vite/bin/vite.js')
const vite = spawn(process.execPath, [vitePath, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'ignore', 'pipe'],
})
vite.stderr?.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`))

function waitForServer(url, timeoutMs = 180_000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const response = await fetch(url)
        if (response.ok || response.status === 404) return resolve()
      } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error(`vite server timeout at ${url}`))
      setTimeout(tick, 250)
    }
    tick()
  })
}

function isVisible(node) {
  const style = getComputedStyle(node)
  const rect = node.getBoundingClientRect()
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0
}

function selectorFor(node) {
  const parts = []
  let current = node
  for (let depth = 0; current && current.nodeType === Node.ELEMENT_NODE && depth < 5; depth += 1) {
    let part = current.tagName.toLowerCase()
    if (current.id) part += `#${CSS.escape(current.id)}`
    else {
      const classes = [...current.classList].filter((name) => !name.includes(':')).slice(0, 2)
      if (classes.length) part += `.${classes.map((name) => CSS.escape(name)).join('.')}`
      const parent = current.parentElement
      if (parent) {
        const siblings = [...parent.children].filter((child) => child.tagName === current.tagName)
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
      }
    }
    parts.unshift(part)
    current = current.parentElement
  }
  return parts.join(' > ')
}

function inspectPage() {
  const isVisible = (node) => {
    const style = getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0
  }
  const selectorFor = (node) => {
    const parts = []
    let current = node
    for (let depth = 0; current && current.nodeType === Node.ELEMENT_NODE && depth < 5; depth += 1) {
      let part = current.tagName.toLowerCase()
      if (current.id) part += `#${CSS.escape(current.id)}`
      else {
        const classes = [...current.classList].filter((name) => !name.includes(':')).slice(0, 2)
        if (classes.length) part += `.${classes.map((name) => CSS.escape(name)).join('.')}`
        const parent = current.parentElement
        if (parent) {
          const siblings = [...parent.children].filter((child) => child.tagName === current.tagName)
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
        }
      }
      parts.unshift(part)
      current = current.parentElement
    }
    return parts.join(' > ')
  }
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const interactiveSelector = 'button,a,input,select,textarea,[role="button"],[role="menuitem"],[role="option"],[tabindex]:not([tabindex="-1"])'
  const nodes = [...document.querySelectorAll(`${interactiveSelector}, body *`)]
  const seen = new Set()
  const findings = []
  const add = (node, type, detail) => {
    if (!isVisible(node)) return
    const key = `${type}|${selectorFor(node)}|${detail}`
    if (seen.has(key)) return
    seen.add(key)
    const rect = node.getBoundingClientRect()
    findings.push({
      type,
      selector: selectorFor(node),
      text: String(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 180),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
      detail,
    })
  }

  for (const node of nodes) {
    if (!isVisible(node)) continue
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    const text = String(node.innerText || '').trim()
    const isInteractive = node.matches(interactiveSelector)
    if (text && (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)) {
      const intentional = style.textOverflow === 'ellipsis' || node.hasAttribute('title') || node.hasAttribute('aria-label') || node.hasAttribute('data-tooltip')
      if (!intentional) add(node, 'text-overflow', `scroll=${node.scrollWidth}x${node.scrollHeight} client=${node.clientWidth}x${node.clientHeight}`)
    }
    if (rect.left < -1 || rect.top < -1 || rect.right > viewport.width + 1 || rect.bottom > viewport.height + 1) {
      add(node, 'outside-viewport', `viewport=${viewport.width}x${viewport.height}`)
    }
    let ancestor = node.parentElement
    while (ancestor && ancestor !== document.body) {
      const overflow = getComputedStyle(ancestor).overflow
      const overflowX = getComputedStyle(ancestor).overflowX
      const overflowY = getComputedStyle(ancestor).overflowY
      const ar = ancestor.getBoundingClientRect()
      const clipsX = ['hidden', 'clip', 'auto', 'scroll'].includes(overflow) || ['hidden', 'clip', 'auto', 'scroll'].includes(overflowX)
      const clipsY = ['hidden', 'clip', 'auto', 'scroll'].includes(overflow) || ['hidden', 'clip', 'auto', 'scroll'].includes(overflowY)
      if ((clipsX && (rect.left < ar.left - 1 || rect.right > ar.right + 1)) || (clipsY && (rect.top < ar.top - 1 || rect.bottom > ar.bottom + 1))) {
        add(node, 'ancestor-clipping', `${selectorFor(ancestor)} rect=${Math.round(ar.x)},${Math.round(ar.y)},${Math.round(ar.width)}x${Math.round(ar.height)}`)
        break
      }
      ancestor = ancestor.parentElement
    }
    if (isInteractive) {
      if (rect.width < 24 || rect.height < 24) add(node, 'hit-target-under-24', `size=${Math.round(rect.width)}x${Math.round(rect.height)}`)
      const point = { x: Math.min(viewport.width - 1, Math.max(0, rect.left + rect.width / 2)), y: Math.min(viewport.height - 1, Math.max(0, rect.top + rect.height / 2)) }
      const hit = document.elementFromPoint(point.x, point.y)
      if (hit && hit !== node && !node.contains(hit)) add(node, 'center-occluded', `hit=${selectorFor(hit)}`)
    }
  }
  return { viewport, findings }
}

async function run() {
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  assertLabPortOwnership('popup-geometry', root)
  await waitForServer(`${base}/design-lab.html`)
  assertLabPortOwnership('popup-geometry', root)
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] })
  const rows = []
  try {
    // One state per context keeps the Vite design-lab module graph and React stores
    // isolated. Workers parallelize independent matrix cells without sharing pages.
    const jobs = LAB_SCREEN_IDS.flatMap((screen) => readLabStates(screen).flatMap((state) => sizes.map((size) => ({ screen, state, size }))))
    const resultRows = new Array(jobs.length)
    let nextJob = 0
    const worker = async () => {
      while (true) {
        const index = nextJob++
        if (index >= jobs.length) return
        const { screen, state, size } = jobs[index]
        const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 })
        await context.addInitScript(() => localStorage.setItem('nomi:locale:v1', 'en'))
        const page = await context.newPage()
        const pageErrors = []
        page.on('pageerror', (error) => pageErrors.push(String(error)))
        let row
        try {
          await page.goto(`${base}/design-lab.html?screen=${encodeURIComponent(screen)}&frame=1&state=${encodeURIComponent(state.id)}`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
          await page.waitForFunction(() => window.__designLabReady === true, null, { timeout: 180_000 })
          const result = await page.evaluate(inspectPage)
          row = { screen, state: state.id, name: state.name, size: size.id, width: size.width, height: size.height, language: await page.evaluate(() => document.documentElement.lang), pageErrors, ...result }
          if (result.findings.length) {
            const safe = `${screen}__${state.id}__${size.id}`.replace(/[^a-z0-9_-]+/gi, '_')
            row.screenshot = path.relative(root, path.join(outDir, `${safe}.png`))
            await page.screenshot({ path: path.join(outDir, `${safe}.png`), fullPage: false })
          }
        } catch (error) {
          row = { screen, state: state.id, name: state.name, size: size.id, width: size.width, height: size.height, language: null, pageErrors, error: String(error), findings: [] }
        } finally {
          await page.close()
          await context.close()
        }
        resultRows[index] = row
        const done = resultRows.filter(Boolean).length
        if (done % 20 === 0) console.log(`processed ${done}/${jobs.length}`)
      }
    }
    await Promise.all(Array.from({ length: Number(process.env.CARD24_CONCURRENCY || 8) }, () => worker()))
    rows.push(...resultRows)
  } finally {
    await browser.close()
    vite.kill('SIGTERM')
  }
  const output = { generatedAt: new Date().toISOString(), base, sizes, screenCount: LAB_SCREEN_IDS.length, stateCount: rows.length / sizes.length, matrixCount: rows.length, rows }
  fs.writeFileSync(path.join(outDir, 'matrix.json'), `${JSON.stringify(output, null, 2)}\n`)
  const summary = rows.reduce((acc, row) => {
    const key = row.error ? 'errors' : row.findings.length ? 'findings' : 'clean'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  console.log(JSON.stringify({ matrixCount: rows.length, summary, outDir }, null, 2))
  if (summary.errors) process.exitCode = 1
}

run().catch((error) => { console.error(error); vite.kill('SIGTERM'); process.exitCode = 1 })
