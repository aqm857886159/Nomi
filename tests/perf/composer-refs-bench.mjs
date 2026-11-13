// 生成框 B3 的性能量具：参考行最坏规模（Seedance 2.5 参考上限 30 图）下的几个用户操作，每次采样一个全新页面。
//
// 量的是**真组件**（实验室里现役 BaseGenerationNode + NodeGenerationComposer，30 张参考灌进真 store，见
// src/devlab/designLab/nodeComposerBar/nodeComposerB3LabKit.tsx 的 b3r-video-30-refs），在无头 Chromium 里用真鼠标操作；
// 计时器是仓库唯一的 responseTimer（输入事件起表 → 判据到位再过两帧），长任务来自它自带的 PerformanceObserver。
// 不是打包后的 Electron：Electron 夹具项目没有可用的模型目录，生成框里根本没有参考数组，量不到参考行（2026-10-19 试过，见 PR）。
//
// 用法：node tests/perf/composer-refs-bench.mjs --op open-params|hover-ref|open-mode-menu|remove-ref [--runs 5] [--label x]
// 2026-11-12：生成方式从参数面板挪到底栏自己一格、按输入现算；面板里切方式的旧操作（switch-mode）随面板那一段一起删了，
// 换成「点开方式菜单」和「移走一张参考 → 方式与行尾重算」。
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../ux/design-lab/labStates.mjs'
import { assertLabPortOwnership, labPortFor } from '../ux/design-lab/labServer.mjs'
import { armResponse, takeResponse } from './canvas-scale/responseTimer.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback }
const OP = arg('--op', 'open-params')
const RUNS = Number(arg('--runs', '5'))
const LABEL = arg('--label', OP)
if (!['open-params', 'hover-ref', 'open-mode-menu', 'remove-ref'].includes(OP)) throw new Error(`未知操作 ${OP}`)

const ROLE = 'perf-composer-refs'
const HOST = '127.0.0.1'
const BASE = `http://${HOST}:${labPortFor(ROLE)}`
const STATE = 'b3r-video-30-refs'
const REF_COUNT = 30

async function waitForServer(url, timeoutMs = 90000) {
  const start = Date.now()
  for (;;) {
    try { const response = await fetch(url); if (response.ok || response.status === 404) return } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error('vite dev server 启动超时')
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

if (spawnSync('node', ['scripts/build-tailwind.mjs'], { cwd: REPO_ROOT, stdio: 'ignore' }).status !== 0) throw new Error('build-tailwind 失败')
assertLabPortOwnership(ROLE)
const vite = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules/vite/bin/vite.js'), '--host', HOST, '--port', String(labPortFor(ROLE)), '--strictPort'], { cwd: REPO_ROOT, stdio: 'ignore' })
await waitForServer(`${BASE}/design-lab.html`)
const browser = await chromium.launch({ headless: true })
const samples = []
try {
  for (let run = 0; run < RUNS + 1; run += 1) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.goto(`${BASE}/design-lab.html?screen=node-composer-bar&frame=1&state=${STATE}`, { timeout: 180000 })
    await page.waitForFunction(() => window.__designLabReady === true, null, { timeout: 90000 })
    await page.waitForFunction((count) => document.querySelectorAll('[data-composer-host] [data-reference-row] [data-asset-tile]').length >= count, REF_COUNT, { timeout: 30000 })
    let sample
    if (OP === 'open-params') {
      await armResponse(page, { predicate: 'paramPanelOpen' })
      await page.locator('[data-parameter-summary]').click()
      const response = await takeResponse(page)
      sample = { responseMs: response.ms, longTasks: response.longTasks }
    } else if (OP === 'hover-ref') {
      const tile = page.locator('[data-composer-host] [data-reference-row] [data-asset-tile]').nth(14 + (run % 5))
      const box = await tile.boundingBox()
      await page.mouse.move(box.x - 40, box.y + box.height / 2)
      await armResponse(page, { trigger: 'pointermove', predicate: 'refHoverTip' })
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      const response = await takeResponse(page)
      sample = { responseMs: response.ms, longTasks: response.longTasks }
    } else if (OP === 'open-mode-menu') {
      // 方式格的 aria-label 是菜单小标题「生成方式」（实验室默认中文）。Seedance 2.5 有 4 种方式，每行都带一句说明。
      await armResponse(page, { predicate: 'modeMenuOpen', arg: 4 })
      await page.locator('[data-node-composer-footer] button[aria-label="生成方式"]').click()
      const response = await takeResponse(page)
      sample = { responseMs: response.ms, longTasks: response.longTasks }
    } else {
      const tile = page.locator('[data-composer-host] [data-reference-row] [data-asset-tile]').nth(14 + (run % 5))
      await tile.hover()
      const remove = tile.locator('[data-asset-tile-remove]')
      await remove.waitFor({ state: 'visible' })
      await armResponse(page, { predicate: 'refRemoved', arg: REF_COUNT - 1 })
      await remove.click()
      const response = await takeResponse(page)
      sample = { responseMs: response.ms, longTasks: response.longTasks }
    }
    await context.close()
    if (errors.length) throw new Error(`页面抛错：${errors[0]}`)
    // 第 0 次是热身（拉懒加载块、字体），不进样本。
    if (run > 0) samples.push(sample)
  }
} finally {
  await browser.close()
  vite.kill('SIGTERM')
}
const out = path.join(REPO_ROOT, `tests/perf/results/composer-refs-${LABEL}.json`)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, `${JSON.stringify({ op: OP, refs: REF_COUNT, samples }, null, 2)}\n`)
const sorted = samples.map((s) => s.responseMs).sort((a, b) => a - b)
console.log(`${OP}（${REF_COUNT} 张参考）：中位 ${sorted[Math.floor(sorted.length / 2)]}ms / 最慢 ${sorted[sorted.length - 1]}ms / 长任务 ${samples.reduce((n, s) => n + s.longTasks, 0)} 个；结果 ${out}`)
