// 设计实验室走查的**共用实现**（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 两屏（agent-panel / editing）走的是同一套流程，所以流程只写一份；各屏的入口文件
// （`tests/ux/design-lab-<屏>.walk.mjs`）只声明"哪一屏、截多宽、接触表排几列"。
// 把流程抄两份的代价不是多几行，是**两份会漂**——其中一份悄悄少了一条断言，没人看得出来。
//
// 它产出两样东西：
//   1. 每个状态一张 PNG（`tests/ux/shots/design-lab-<屏>/<id>.png`）——人眼逐格看。
//   2. 一张接触表（`.../_contact-sheet.png`）——所有状态平铺一图，给用户拍板用。
//
// 它同时把三件事变成硬断言（走查不带断言就是装饰品，见 check:walkthroughs 的断言密度规则）：
//   - 活页面的注册表 === `labStates.mjs` 从源码解析出来的清单（那把正则的活性证据）；
//   - 每个状态都真的渲染出了非空舞台（宽高 > 0，且舞台里不是只有两三个元素）；
//   - 渲染期间零 pageerror。
//
// 视觉基线的**比对**不在这里，在 `pnpm run check:design-lab`（Playwright toHaveScreenshot）。
// 这里只负责「让人看得见」。
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { readLabStates, REPO_ROOT } from './labStates.mjs'
import { assertLabPortOwnership, labPortFor } from './labServer.mjs'

const COVERAGE_TONE = { shell: '#2f7d4f', 'component-only': '#9a6a3c', missing: '#b23c3c', retired: '#6b6b6b' }
const COVERAGE_TEXT = { shell: '整条通', 'component-only': '只有组件', missing: '没实现', retired: '已取消' }

function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const response = await fetch(url)
        if (response.ok || response.status === 404) return resolve()
      } catch { /* not up yet */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('vite dev server 启动超时'))
      setTimeout(tick, 400)
    }
    tick()
  })
}

/**
 * @param {{screen: string, title: string, role: string, cellWidth: number, columns: number, viewport?: {width: number, height: number}}} config
 */
export async function walkDesignLabScreen(config) {
  const OUT_DIR = path.join(REPO_ROOT, `tests/ux/shots/design-lab-${config.screen}`)
  const HOST = '127.0.0.1'
  // 端口按 worktree 派生，不再写死（labServer.mjs）：写死的端口是整台机器的全局单例，
  // 而这台机器上常年挂着 20+ worktree。下面那道 waitForServer 只探「有没有人应答」——
  // 端口被别的树占着时它会**照样成功**，然后整份走查截的是别人分支的 UI。
  const PORT = labPortFor(config.role)
  const BASE = `http://${HOST}:${PORT}`
  const ONLY = (process.env.ONLY || '').split(',').map((value) => value.trim()).filter(Boolean)

  const failures = []
  const record = (message) => { failures[failures.length] = message; console.error(`  ✗ ${message}`) }

  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const states = readLabStates(config.screen)
  const wanted = ONLY.length ? states.filter((state) => ONLY.includes(state.id)) : states
  if (!wanted.length) throw new Error(`ONLY=${ONLY.join(',')} 没有匹配到任何状态`)

  console.log('▶ 生成 tailwind 产物…')
  const tailwind = spawnSync('node', ['scripts/build-tailwind.mjs'], { cwd: REPO_ROOT, stdio: 'inherit' })
  if (tailwind.status !== 0) throw new Error('build-tailwind 失败：整页会没有样式，截图无意义')

  console.log('▶ 启动 vite dev server…')
  // 起之前先看这口是不是别人的；是就当场停，别把别人的服务器当自己的。
  assertLabPortOwnership(config.role)
  const vite = spawn('npx', ['vite', '--host', HOST, '--port', String(PORT), '--strictPort'], {
    cwd: REPO_ROOT,
    // stderr 不再丢掉：--strictPort 撞口时 vite 是从这里喊的，
    // 以前 'ignore' 把它咽掉，于是「没绑上」和「绑上了」在日志里长得一模一样。
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  vite.stderr?.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`))
  await waitForServer(`${BASE}/design-lab.html`)
  // 应答了不等于是我起的那一个：--strictPort 绑失败时应答的是原来占口的那个进程。
  // 截图之前必须证明答话的就是本树（fail-closed）。
  assertLabPortOwnership(config.role)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: config.viewport ?? { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => { pageErrors[pageErrors.length] = String(error) })

  try {
    // ① 活页面的注册表必须与源码解析结果一致。
    await page.goto(`${BASE}/design-lab.html?screen=${config.screen}&frame=1&state=${states[0].id}`)
    await page.waitForFunction(() => window.__designLabReady === true, { timeout: 20000 })
    const live = await page.evaluate(() => window.__designLabStates)
    const parsed = states.map((state) => state.id)
    if (JSON.stringify(live) !== JSON.stringify(parsed)) {
      record(`注册表解析漂了：活页面 ${live?.length} 个 / 源码解析 ${parsed.length} 个`)
      console.error('    只在活页面：', (live || []).filter((id) => !parsed.includes(id)).join(', '))
      console.error('    只在解析里：', parsed.filter((id) => !(live || []).includes(id)).join(', '))
      // 两边**一个都不重叠** = 我们截的根本不是自己这棵 worktree 的页面：
      // `reuseExistingServer` 式的「端口上已经有人应答就用它」在这台机器上会连到
      // 另一个 worktree 的 vite（20+ worktree 并行是常态，端口写死必然撞）。
      // 这一条要**当场停**：继续跑下去只会截出一批别人家的 UI，而每一张看起来都很正常。
      const overlap = parsed.filter((id) => (live || []).includes(id)).length
      if (overlap === 0) {
        throw new Error(
          `端口 ${config.port} 上应答的不是本 worktree 的实验室（活页面的状态和本仓一个都对不上）。`
          + `\n先查是谁占着：lsof -nP -iTCP:${config.port} -sTCP:LISTEN`
          + `\n别去 kill 别人的 dev server——给本屏换一个没人用的端口。`,
        )
      }
    }

    // ② 逐状态截图 + 非空断言。
    for (const state of wanted) {
      await page.goto(`${BASE}/design-lab.html?screen=${config.screen}&frame=1&state=${state.id}`)
      await page.waitForFunction(() => window.__designLabReady === true, { timeout: 20000 })
      const shot = page.locator(`[data-design-lab-shot="${state.id}"]`)
      const box = await shot.boundingBox()
      if (!box || box.width < 40 || box.height < 24) {
        record(`${state.id} 舞台没渲染出来（boundingBox=${JSON.stringify(box)}）`)
        continue
      }
      const file = path.join(OUT_DIR, `${state.id}.png`)
      // 浮层类形态（BodyPortal + fixed 定位）不在舞台的 DOM 子树里，按元素截会截出
      // 「浮层没打开」的假证据，所以这一族改截整屏（注册项里显式声明 capture: 'viewport'）。
      if (state.capture === 'viewport') await page.screenshot({ path: file, animations: 'disabled' })
      else await shot.screenshot({ path: file, animations: 'disabled' })
      // 「有个框但里面是空的」和「渲染对了」在 boundingBox 上分不出来，所以还要数元素。
      // 但 `missing` 档**本来**就只有一句「现役未实现」——对它数元素会把设计缺口误报成渲染失败。
      // 判据因此按各自的承诺分开：missing 档必须是 missing 舞台，其余档必须有真内容。
      const stage = await shot.evaluate((node) => node.firstElementChild?.getAttribute('data-design-lab-stage')
        || node.querySelector('[data-design-lab-stage]')?.getAttribute('data-design-lab-stage')
        || '')
      if (state.coverage === 'missing') {
        if (stage !== 'missing') record(`${state.id} 标了 coverage=missing，却渲染成 ${stage || '(无舞台)'}`)
      } else {
        if (stage === 'missing') record(`${state.id} 渲染成了「现役未实现」占位，但它的 coverage 是 ${state.coverage}`)
        // 数元素时**连 Portal 层一起数**：走 AnchoredPopover 的形态（转场选择器、素材选择器）
        // 整个身体都 Portal 到 body 上，舞台子树里只剩一颗锚点按钮。只数舞台子树，
        // 「浮层渲染得好好的」会被误判成「舞台是空的」——2026-09-06 三条 picker-* 就是这么假红的。
        // 元素截图截的是「整页渲染后按舞台的框裁」，盖在舞台上的浮层本来就进了图，
        // 所以判据也该按「这一格画出了什么」算，而不是按 DOM 谁是谁的孩子算。
        const distinct = await page.evaluate((shotId) => {
          const stage = document.querySelector(`[data-design-lab-shot="${shotId}"]`)
          const inStage = stage ? stage.querySelectorAll('*').length : 0
          let inPortals = 0
          for (const node of document.body.children) {
            if (node.id === 'design-lab-root') continue
            inPortals += 1 + node.querySelectorAll('*').length
          }
          return inStage + inPortals
        }, state.id)
        if (distinct < 3) record(`${state.id} 这一格只有 ${distinct} 个元素，形态大概率没渲染出来`)
      }
      console.log(`  ✓ ${state.id.padEnd(34)} ${Math.round(box.width)}×${Math.round(box.height)}  ${state.name}`)
    }

    // ③ 接触表（拍板用）。
    //
    // 它是**把刚截的那些 PNG 拼起来**，不是再渲染一遍页面。
    // 页面里的 `?contact=1` 是给人在浏览器里滚着看的活视图；但拿它做 fullPage 截图会得到
    // 一张大半空白的图——视口外的 iframe 浏览器根本不渲染，fullPage 只是把视口拉长、
    // 补不回那些从没画过的帧（首版实测：10602px 高的图里只有头两排有东西）。
    // 用 <img> 拼则没有这个问题，而且拼进去的就是基线钉住的那几张图，不是第二个真相源。
    if (!ONLY.length) {
      const cells = wanted.map((state) => {
        const data = fs.readFileSync(path.join(OUT_DIR, `${state.id}.png`)).toString('base64')
        return `<figure><figcaption><span style="background:${COVERAGE_TONE[state.coverage]}">${COVERAGE_TEXT[state.coverage]}</span> <b>${state.name}</b> <i>${state.id}</i></figcaption>`
          + `<img src="data:image/png;base64,${data}" width="${config.cellWidth}" /></figure>`
      })
      const sheetWidth = config.columns * (config.cellWidth + 20) + 32
      await page.setViewportSize({ width: sheetWidth, height: 1000 })
      await page.setContent(
        `<style>body{margin:0;padding:16px;background:#faf8f4;font:12px/1.5 system-ui}`
        + `h1{font-size:16px;margin:0 0 4px}p{margin:0 0 14px;color:#666}`
        + `.g{display:grid;grid-template-columns:repeat(${config.columns},${config.cellWidth + 20}px);gap:14px;align-items:start}`
        + `figure{margin:0}figcaption{font-size:11px;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`
        + `figcaption span{display:inline-block;padding:1px 5px;border-radius:8px;color:#fff}`
        + `figcaption i{color:#999;font-style:normal}img{display:block;border:1px solid #ddd;background:#fff}</style>`
        + `<h1>Nomi · ${config.title}接触表（${wanted.length} 个状态 · ${new Date().toISOString().slice(0, 10)}）</h1>`
        + `<p>绿=整条通 · 棕=组件在但界面走不到 · 红=设计文档要求而现役没有 · 灰=设计已取消</p>`
        + `<div class="g">${cells.join('')}</div>`,
      )
      const sheet = path.join(OUT_DIR, '_contact-sheet.png')
      await page.screenshot({ path: sheet, fullPage: true, animations: 'disabled' })
      console.log(`\n▶ 接触表：${sheet}`)
    }

    if (pageErrors.length) record(`页面抛错 ${pageErrors.length} 条：${pageErrors.slice(0, 3).join(' | ')}`)
  } finally {
    await browser.close()
    vite.kill('SIGTERM')
  }

  if (failures.length) {
    console.error(`\n❌ 设计实验室走查失败 ${failures.length} 条`)
    process.exit(1)
  }
  console.log(`\n✅ ${wanted.length} 个状态全部渲染并截图：${OUT_DIR}`)
}
