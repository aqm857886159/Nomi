// 弹层几何普查 · CI 入口（判据在 popupGeometry.mjs，那里写了为什么）。
//
// 跑哪些格：**所有屏里声明 `capture: 'viewport'` 的格**——实验室约定「浮层逃出舞台的形态必须整屏截」，
// 所以这个声明就是「这一格有打开的浮层」的登记处。普查对它们逐格量；量出一个打开的浮层都没有的格单独报
// （声明了有浮层却没打开 = 那一格的样张本身坏了，普查不能对它装绿）。
//
// 和视觉基线道不同，几何不随字体栅格化变，所以**所有平台都跑**（CI 的 linux 也跑）。
//
// 用法：node tests/ux/design-lab/popupGeometry.census.mjs   （SCREEN=node-quick-actions 只跑一屏）
//       node tests/ux/design-lab/popupGeometry.census.mjs --shard 2/4   （CI 分片：只量计划分给第 2 片的格，计划见 scripts/lib/e2eShardPlan.mjs）
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { REPO_ROOT } from './labStates.mjs'
import { listMeasurableTargets, listViewportTargets, staleUnmeasurableKeys, UNMEASURABLE } from './popupGeometryTargets.mjs'
import { censusCellsForShard, parseShardArg } from '../../../scripts/lib/e2eShardPlan.mjs'
import { assertLabPortOwnership, labOriginFor } from './labServer.mjs'
import { probePopupGeometry } from './popupGeometry.mjs'
import { stationTimeout } from '../_station-budget.mjs'

// 冷启动那一次要等 vite 预打包整张模块图（慢机器上几分钟）；之后每格一次本地加载。
const COLD_START_MS = stationTimeout({ operations: 12 })
const PER_STATE_MS = stationTimeout({ operations: 4 })

const ROLE = 'popup-geometry'
const ORIGIN = labOriginFor(ROLE)
const ONLY_SCREEN = process.env.SCREEN || ''
// 导演台两屏按真机窗口内容区取景（同 design-lab.visual.spec.mjs）。
const DIRECTOR_SCREENS = new Set(['director-3dbox', 'director-refine'])
const VIEWPORT = { width: 1440, height: 1000 }

const staleExemptions = staleUnmeasurableKeys()
if (staleExemptions.length) throw new Error(`弹层几何普查的豁免指向不存在的格（改名或删了，把豁免一起删掉）：${staleExemptions.join('、')}`)
for (const { screen, state } of listViewportTargets(ONLY_SCREEN)) {
  const why = UNMEASURABLE[`${screen}/${state.id}`]
  if (why) console.log(`  ↷ ${screen}/${state.id}：不量（${why}）`)
}
const shardFlag = process.argv.indexOf('--shard')
const shard = shardFlag === -1 ? null : parseShardArg(process.argv[shardFlag + 1])
const assigned = shard ? new Set(censusCellsForShard(shard.index, shard.total)) : null
const targets = listMeasurableTargets(ONLY_SCREEN).filter(({ screen, state }) => !assigned || assigned.has(`${screen}/${state.id}`))
if (!targets.length && shard) {
  console.log(`第 ${shard.index}/${shard.total} 片没有分到要量的格，直接通过。`)
  process.exit(0)
}
if (!targets.length) throw new Error(`没有要量的格（SCREEN=${ONLY_SCREEN || '全部'}）`)

const tailwind = spawnSync(process.execPath, ['scripts/build-tailwind.mjs'], { cwd: REPO_ROOT, stdio: 'inherit' })
if (tailwind.status !== 0) throw new Error('build-tailwind 失败：整页没有样式，几何没有意义')

assertLabPortOwnership(ROLE)
const port = new URL(ORIGIN).port
const vite = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', port, '--strictPort'], {
  cwd: REPO_ROOT,
  stdio: ['ignore', 'ignore', 'pipe'],
})
vite.stderr?.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`))

const failures = []
const browser = await chromium.launch()
try {
  // 冷启动预热：第一次加载要等 vite 预打包整张模块图。
  const deadline = Date.now() + COLD_START_MS
  for (;;) {
    try { if ((await fetch(`${ORIGIN}/design-lab.html`)).ok) break } catch { /* not up */ }
    if (Date.now() > deadline) throw new Error('实验室 vite 起不来')
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  assertLabPortOwnership(ROLE)
  {
    const warm = await browser.newPage()
    await warm.goto(`${ORIGIN}/design-lab.html?screen=${targets[0].screen}&frame=1&state=${targets[0].state.id}`, { timeout: COLD_START_MS, waitUntil: 'domcontentloaded' })
    await warm.waitForFunction(() => window.__designLabReady === true, null, { timeout: COLD_START_MS })
    await warm.close()
  }
  // 一格量一次；渲染超时（导演台那几格是 WebGL，慢机器上偶尔超时）重来一次，再不行算失败（不放过）。
  const measure = async (screen, state) => {
    const context = await browser.newContext({
      viewport: DIRECTOR_SCREENS.has(screen) ? { width: 1280, height: 933 } : VIEWPORT,
      colorScheme: 'light',
    })
    try {
      const page = await context.newPage()
      await page.goto(`${ORIGIN}/design-lab.html?screen=${screen}&frame=1&state=${state.id}`, { timeout: PER_STATE_MS, waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => window.__designLabReady === true, null, { timeout: PER_STATE_MS })
      await page.waitForTimeout(150) // Radix 定位在就绪后的下一帧落位
      return await page.evaluate(probePopupGeometry)
    } finally {
      await context.close()
    }
  }
  for (const { screen, state } of targets) {
    const label = `${screen}/${state.id}`
    let result = null
    let lastError = null
    for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
      try { result = await measure(screen, state) } catch (error) { lastError = error }
    }
    if (!result) {
      failures.push(`${label} 渲染失败（试了两次）：${String(lastError).split(/\r?\n/)[0]}`)
      console.log(`  ✗ ${label} 渲染失败`)
      continue
    }
    if (result.layers === 0) console.log(`  · ${label}：没有打开的浮层（这一格整屏截的理由是别的）`)
    for (const violation of result.violations) failures.push(`${label} ${violation.rule} ${JSON.stringify(violation)}`)
    console.log(`  ${result.violations.length ? '✗' : '✓'} ${label}（触发钮 ${result.triggers}、浮层 ${result.layers}）`)
  }
} finally {
  await browser.close()
  vite.kill()
}

if (failures.length) {
  console.error(`\n❌ 弹层几何普查：${failures.length} 条违例`)
  for (const failure of failures) console.error(`   · ${failure}`)
  process.exit(1)
}
console.log(`\n✅ 弹层几何普查：${targets.length} 格，浮层都不压自己的触发钮和那一排工具条、整块在窗口里`)
