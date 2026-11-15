// 常驻驱动的设计实验室通道：`goto design-lab <屏> [状态]` 时起本工作树的 vite 实验室服务器（随机本机端口）和一只无头 Chromium，
// 打开 design-lab.html 的那一屏；之后驱动的 shot / snap / click 落在这张实验室页上，goto 应用里的功能再切回 Nomi 窗口。
// 和 design-lab/walkScreen.mjs 同一个入口页、同一个就绪旗（window.__designLabReady）；不截接触表、不写 tests/ux/shots。
import { chromium } from 'playwright'
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stationTimeout } from './_station-budget.mjs'
import { labChildEnv } from './design-lab/labServer.mjs'
import { LAB_SCREEN_IDS, readLabStates } from './design-lab/labStates.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const HOST = '127.0.0.1'

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, HOST, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitForServer(url, vite, timeoutMs = 90_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (vite.exitCode !== null) throw new Error(`实验室服务器退出了（退出码 ${vite.exitCode}）`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error('实验室服务器 90 秒没起来')
}

/** surface：驱动的 `{ lab }` 槽。第一次调用起服务器和浏览器，之后只换屏。 */
export async function openDesignLabScreen(surface, { screen, state, viewport, theme = 'light' }) {
  if (!LAB_SCREEN_IDS.includes(screen)) throw new Error(`没有这一屏「${screen}」。可选：${LAB_SCREEN_IDS.join(' / ')}`)
  const states = readLabStates(screen).map((entry) => entry.id)
  if (state && !states.includes(state)) throw new Error(`「${screen}」没有状态「${state}」。可选：${states.join(' / ')}`)
  if (!surface.lab) {
    const tailwind = spawnSync(process.execPath, ['scripts/build-tailwind.mjs'], { cwd: repoRoot, stdio: 'ignore' })
    if (tailwind.status !== 0) throw new Error('build-tailwind 失败：实验室页会没有样式')
    const port = await freePort()
    const vite = spawn(process.execPath, [path.join(repoRoot, 'node_modules/vite/bin/vite.js'), '--host', HOST, '--port', String(port), '--strictPort'], {
      cwd: repoRoot,
      stdio: 'ignore',
      env: labChildEnv(),
    })
    const base = `http://${HOST}:${port}`
    await waitForServer(`${base}/design-lab.html`, vite)
    const browser = await chromium.launch({ headless: true })
    surface.lab = {
      base,
      browser,
      vite,
      page: null,
      context: null,
      active: false,
      url: null,
      async close() {
        await this.browser.close().catch(() => {})
        this.vite.kill('SIGTERM')
      },
    }
  }
  const lab = surface.lab
  // 一屏一个新上下文（design-lab/labPage.mjs：复用同一个上下文反复整页加载会在几十次后起不来）。
  await lab.context?.close().catch(() => {})
  lab.context = await lab.browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: theme })
  lab.page = await lab.context.newPage()
  lab.url = `${lab.base}/design-lab.html?screen=${encodeURIComponent(screen)}&frame=1${state ? `&state=${encodeURIComponent(state)}` : ''}`
  // 冷启动的 vite 要预打包依赖 + 转译整张模块图，首屏远超 30 秒。
  await lab.page.goto(lab.url, { timeout: 180_000 })
  await lab.page.waitForFunction(() => window.__designLabReady === true, null, { timeout: stationTimeout({ operations: 4 }) })
  lab.active = true
  return lab.url
}
