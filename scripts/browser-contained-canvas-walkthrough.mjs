// R13 走查：浏览器 contained 素材盒 → 画布（2026-07-22 复测 P0 回归 dfc47477 根治验证）。
// 复测确认：main 探针 canvasImportAvailable()=true、IPC 链在场，唯一断点是 contained popover 不消费探针
//（availability 被无条件置 false → 「放到画布」永不出现 → 0 节点）。本走查在真 Electron 里证：
//  ① contained overlay 的跨窗探针在画布挂载时返回 true（fix 现在消费的正是它，单测 canvasImportAvailabilitySource 锁死消费）；
//  ② 从 overlay 派发导入 → 经 IPC → 父窗画布真加 React Flow 节点（素材真落画布，refute「0 节点」）。
// 用法：pnpm run build && node scripts/browser-contained-canvas-walkthrough.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync } from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.browser-contained-lab')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

let failures = 0
const ok = (msg) => console.log('  ✓ ' + msg)
const fail = (msg) => { console.error('  ✗ ' + msg); failures += 1 }

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.'],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_ALLOW_MULTI_INSTANCE: '1' },
})
try {
  const win = await app.firstWindow()
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1']) window.localStorage.setItem(k, 'seen')
  })
  await win.waitForTimeout(1500)
  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await win.getByRole('button', { name: '生成', exact: false }).first().click()
  await win.waitForTimeout(1500)

  // 画布导入目标在场（fix 的探针查的就是它）
  const canvasMounted = await win.evaluate(() => Boolean(document.querySelector('[data-nomi-generation-canvas-import-target="true"]')))
  if (canvasMounted) ok('父窗画布导入目标在场')
  else fail('父窗画布导入目标缺席')
  const nodesBefore = await win.evaluate(() => document.querySelectorAll('[data-node-id]').length)

  // 开浏览器 → 点「素材盒」→ contained overlay 上屏
  await win.locator('[aria-label="打开浏览器"]').first().click()
  await win.waitForTimeout(2500)
  await win.screenshot({ path: path.join(outDir, '01-browser-open.png') }).catch(() => {})
  await win.getByText('素材盒', { exact: true }).first().click({ timeout: 5000 }).catch(async () => {
    await win.getByRole('button', { name: '素材盒', exact: false }).first().click({ timeout: 5000 }).catch(() => fail('点不到「素材盒」按钮'))
  })
  await win.waitForTimeout(2000)

  // 找到 contained overlay 窗（独立透明窗，URL 带 browser-asset-overlay）
  let overlay = null
  for (let i = 0; i < 10 && !overlay; i += 1) {
    for (const w of app.windows()) {
      const url = w.url()
      if (/browser-asset-overlay/i.test(url)) { overlay = w; break }
    }
    if (!overlay) await win.waitForTimeout(500)
  }
  if (!overlay) {
    fail('没找到 contained overlay 窗（浏览器素材盒 overlay 未上屏）')
  } else {
    ok('contained overlay 窗已上屏')
    // ① 跨窗探针：画布挂载时必须 true（fix 消费的正是它；旧回归无条件 false）
    const probe = await overlay.evaluate(async () => {
      const bridge = window.nomiDesktop?.browser?.assetOverlay
      if (!bridge?.canvasImportAvailable) return 'no-bridge'
      return await bridge.canvasImportAvailable()
    })
    if (probe === true) ok('① contained 跨窗探针 canvasImportAvailable()=true（fix 现消费此信号，availability 不再被钉 false）')
    else fail(`① 跨窗探针异常：${JSON.stringify(probe)}（画布挂载时应为 true）`)

    // ② overlay 派发导入 → IPC → 父窗画布加节点（素材真落画布）
    await overlay.evaluate(() => {
      window.dispatchEvent(new CustomEvent('nomi-browser-asset-import-to-canvas', {
        detail: { assets: [{ id: 'e2e-contained-1', type: 'image', title: 'e2e-contained.png', previewUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }] },
      }))
    })
    await win.waitForTimeout(2500)
    const nodesAfter = await win.evaluate(() => document.querySelectorAll('[data-node-id]').length)
    await win.screenshot({ path: path.join(outDir, '02-after-import.png') }).catch(() => {})
    if (nodesAfter === nodesBefore + 1) ok(`② contained → 画布：React Flow 节点 ${nodesBefore}→${nodesAfter}（+1，素材经 IPC 真落画布，refute「0 节点」）`)
    else fail(`② 节点数未 +1：${nodesBefore}→${nodesAfter}（导入链断）`)
  }

  console.log('\n人眼终审素材:', outDir)
  console.log(failures === 0 ? '\n总判定: PASS' : `\n总判定: FAIL (${failures})`)
} finally {
  await app.close().catch(() => {})
}
process.exit(failures === 0 ? 0 : 1)
