// R13 走查 + 回归门：图片浮条「切图 ▾ → 九宫格(3×3)」不许再卡死（2026-08-20）。
//
// 用户报告：「点击图片的切图功能 九宫格 直接卡死」。根因取证与修法见
// docs/plan/2026-08-20-grid-split-freeze.md。修前（4096² 源图、空项目、M 系列 Mac）：
//   主线程最长空窗 782ms、9 次同步 PNG 编码占 701ms、60MB 走 JSON 深拷贝、UI 冻 1.6s。
// 慢机器上就是用户说的「直接卡死」。
//
// 这份走查把那三个数钉成断言，回归会直接报红：
//   ① 主线程最长单次阻塞 < 400ms（「卡死」的直接度量：心跳漏拍）
//   ② 全程零次同步 toDataURL（同步 PNG 编码=主线程被霸占的根因）
//   ③ store/DOM 里零 data: URL（base64 进 store = 「图多即卡」的病根，也是 JSON 深拷贝的燃料）
// 外加行为对账（2026-08-20 用户拍板的切图长相）：
//   ④ 9 张切片摊成 9 个**独立节点**（不是藏进堆叠）
//   ⑤ **逐步**冒出来——中途能抓到「已经有几张、还没满 9 张」的中间态
//   ⑥ 切完自动**编组**，整组能一起拖走
//
// 零额度——只用本地 ffmpeg 造的 4K 细节图，不触发任何生成。
// 用法：node tests/ux/image-grid-split-freeze.walk.mjs [档位]   3=九宫格(默认) / 2=四视图 / 1=裁剪
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { clickOrFail, expect, expectCount, expectVisible, screenshotSettled } from './_assert.mjs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
// 可调框的三档共用这一份走查：3=九宫格(3×3)、2=四视图(2×2)、1=裁剪。默认跑九宫格。
// 三档走的是同一条 Blob 管线，只有产物去处不同（切图摊成节点 / 裁剪原地改这张），所以一起验。
const GRID = [1, 2].includes(Number(process.argv[2])) ? Number(process.argv[2]) : 3
const TILES = GRID * GRID
const NODES = TILES + 1 // 原图不动，仍留在画布上
const GRID_LABEL = GRID === 3 ? '九宫格' : GRID === 2 ? '四视图' : '裁剪'
const SIDE = 4096
/** 主线程单次阻塞预算。人对 >400ms 的无响应开始有「卡了」的体感；修前是 782ms。 */
const BLOCK_BUDGET_MS = 400
const outDir = path.join(repoRoot, `docs/design/mockups/2026-08-20-grid-split-freeze/${GRID}x${GRID}`)
fs.mkdirSync(outDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-split-walk-'))
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

// 细节丰富的图：PNG 体积量级贴近真实出图，不是一压就没的纯色块。
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const still = path.join(root, 'big.png')
if (spawnSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `mandelbrot=s=${SIDE}x${SIDE}`, '-frames:v', '1', still]).status !== 0) {
  throw new Error('夹具编码失败')
}
console.log(`· 夹具 ${SIDE}×${SIDE} PNG = ${(fs.statSync(still).size / 1024 / 1024).toFixed(1)} MB`)

let { app, win } = await launchNomiApp({
  name: 'image-grid-split-freeze',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
})
const getWin = () => {
  const live = app.windows().filter((w) => !w.isClosed())
  win = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } }) || live[live.length - 1] || win
  return win
}
const snap = async (name) => {
  await screenshotSettled(getWin(), { path: path.join(outDir, name) })
  console.log(`  · 截图 ${name}`)
}
const verdicts = []
const check = (name, ok, detail = '') => {
  verdicts.push([name, ok, detail])
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

win.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`))
win.on('crash', () => console.log('  [renderer CRASH]'))

try {
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  const bw = await app.browserWindow(getWin())
  await bw.evaluate((w) => { w.setBounds({ x: 0, y: 0, width: 1680, height: 1050 }); w.center() })

  await clickOrFail(getWin().locator('button, [role="button"]').filter({ hasText: '新建空白项目' }), '新建空白项目', { timeout: 30_000 })
  await clickOrFail(getWin().getByRole('button', { name: '生成', exact: false }), '顶栏「生成」')
  await expectVisible(getWin().locator('.generation-canvas-v2__stage').first(), '生成画布没出来', 30_000)

  // —— 投放大图 ——
  const b64 = fs.readFileSync(still).toString('base64')
  await getWin().evaluate((png) => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const rect = stage.getBoundingClientRect()
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'big.png', { type: 'image/png' }))
    const opts = { bubbles: true, cancelable: true, clientX: rect.x + 500, clientY: rect.y + 320, dataTransfer: dt }
    stage.dispatchEvent(new DragEvent('dragover', opts))
    stage.dispatchEvent(new DragEvent('drop', opts))
  }, b64)
  const nodeImage = getWin().locator('[data-node-id] img').first()
  await expectVisible(nodeImage, '大图没落进画布（投放失败）', 60_000)
  await expect
    .poll(() => nodeImage.evaluate((img) => img.naturalWidth), { message: '节点图没解码到原始尺寸', timeout: 60_000 })
    .toBe(SIDE)
  await snap('00-seeded.png')

  // —— 探针：心跳漏拍 = 主线程被同步任务霸占的时长；另数同步 PNG 编码次数 ——
  await getWin().evaluate(() => {
    const hb = { max: 0, last: performance.now(), syncEncodes: 0 }
    window.__nomiHb = hb
    setInterval(() => {
      const now = performance.now()
      hb.max = Math.max(hb.max, now - hb.last)
      hb.last = now
    }, 25)
    const rawToDataUrl = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      hb.syncEncodes += 1
      return rawToDataUrl.apply(this, args)
    }
  })

  // —— 真实路径：选中节点 →（裁剪按钮 / 切图 ▾ 选档位）→ 确认 ——
  await clickOrFail(getWin().locator('[data-node-id]').first(), '图片节点')
  if (GRID === 1) {
    await clickOrFail(getWin().getByRole('button', { name: '裁剪', exact: true }), '浮条「裁剪」')
  } else {
    await clickOrFail(getWin().getByRole('button', { name: '切图', exact: true }), '浮条「切图 ▾」')
    await snap('01-split-menu.png')
    await clickOrFail(getWin().getByRole('menuitem', { name: new RegExp(GRID_LABEL) }), `菜单项「${GRID_LABEL}」`)
  }
  const confirmSplit = getWin().getByRole('button', { name: GRID === 1 ? '确认裁剪' : '确认切图' })
  await expectVisible(confirmSplit.first(), `${GRID_LABEL}取景框没打开`)
  await snap('02-grid-overlay.png')
  await getWin().evaluate(() => { window.__nomiHb.max = 0; window.__nomiHb.last = performance.now() })

  const t0 = Date.now()
  await clickOrFail(confirmSplit, `取景框「确认${GRID === 1 ? '裁剪' : '切图'}」`)

  // 裁剪是「原地改这张」：不该多出节点，产物进本节点的图片堆叠。同样不许有 base64 / 同步编码。
  if (GRID === 1) {
    await expectVisible(getWin().getByLabel('2 张堆叠图片').first(), '裁剪结果没进堆叠', 60_000)
    await expectCount(getWin().locator('[data-node-id]'), 1, '裁剪不该新建节点（它是原地改这张）', 10_000)
    const cropHb = await getWin().evaluate(() => window.__nomiHb)
    const cropUrls = await getWin().evaluate(() =>
      [...document.querySelectorAll('[data-node-id] img')].map((img) => (img.currentSrc || img.src || '').slice(0, 12)))
    check('裁剪原地改这张（不新建节点、结果进堆叠）', true)
    check(`主线程最长阻塞 < ${BLOCK_BUDGET_MS}ms`, cropHb.max < BLOCK_BUDGET_MS, `实测 ${Math.round(cropHb.max)}ms`)
    check('零次同步 PNG 编码（toDataURL）', !cropHb.syncEncodes, `实测 ${cropHb.syncEncodes} 次`)
    check('裁剪结果零 base64', cropUrls.every((u) => !u.startsWith('data:')), JSON.stringify(cropUrls))
    await snap('04-cropped.png')
    const failedCrop = verdicts.filter(([, ok]) => !ok)
    console.log(`\n  ${failedCrop.length ? `❌ ${failedCrop.length} 项未过` : '✅ 全部通过'}`)
    if (failedCrop.length) process.exitCode = 1
    throw new Error('__done__')
  }

  // ① 逐步布局：切的过程中盯节点数——抓得到「多于 1、还没到满」的中间态才叫逐步。
  //    （一次性落满的旧写法在这里必然抓不到中间态，所以这条断言测得到真东西。）
  let sawPartial = false
  let sawFeedback = false
  for (let i = 0; i < 60; i += 1) {
    const [count, splitting] = await Promise.all([
      getWin().locator('[data-node-id]').count(),
      getWin().getByRole('status', { name: /切图中/ }).count(),
    ])
    if (splitting > 0) sawFeedback = true
    if (count > 1 && count < NODES) sawPartial = true
    if (count >= NODES) break
    if (i === 2) await snap('03-splitting.png')
    await getWin().waitForTimeout(120)
  }

  // ② 结果对账：原图 1 + 切片 N = N+1 个节点（不是藏进堆叠的 N 张）
  await expectCount(getWin().locator('[data-node-id]'), NODES, `${GRID_LABEL}没摊成 ${TILES} 个节点`, 60_000)
  const elapsed = Date.now() - t0
  console.log(`  · 确认 → ${TILES} 个切片节点全部就位 ${(elapsed / 1000).toFixed(1)} s`)

  const hb = await getWin().evaluate(() => window.__nomiHb)
  check('切图期间有「切图中」反馈（不是点完没动静）', sawFeedback)
  check(`逐步冒出来（抓到未满 ${TILES} 张的中间态）`, sawPartial)
  check(`主线程最长阻塞 < ${BLOCK_BUDGET_MS}ms`, hb.max < BLOCK_BUDGET_MS, `实测 ${Math.round(hb.max)}ms（修前 782ms）`)
  check('零次同步 PNG 编码（toDataURL）', !hb.syncEncodes, `实测 ${hb.syncEncodes} 次（修前 ${TILES} 次）`)

  // ③ base64 不许进 store：切片必须是落盘后的 nomi-local:// 门牌号
  const urls = await getWin().evaluate(() =>
    [...document.querySelectorAll('[data-node-id] img')].map((img) => (img.currentSrc || img.src || '').slice(0, 12)))
  check('切片零 base64（全是 nomi-local:// 门牌号）', urls.every((u) => !u.startsWith('data:')), JSON.stringify(urls))

  // ④ 切完自动编组：画布上应出现一个把 N 张圈起来的组框
  await expectCount(getWin().locator('[data-group-id]'), 1, '切完没自动编组', 30_000)
  const grouped = await getWin().evaluate(() => {
    const frame = document.querySelector('[data-group-id]')
    const box = frame?.getBoundingClientRect()
    const tiles = [...document.querySelectorAll('[data-node-id]')].map((n) => n.getBoundingClientRect())
    const inside = tiles.filter((r) => box && r.left >= box.left - 4 && r.right <= box.right + 4
      && r.top >= box.top - 4 && r.bottom <= box.bottom + 4)
    return { members: inside.length, label: frame?.textContent?.trim().slice(0, 40) || '' }
  })
  check(`组框圈住 ${TILES} 张切片`, grouped.members === TILES, JSON.stringify(grouped))

  // ⑤ 切完要能一眼看全：九张摊开比原图占地大得多，多半有一半在视口外 —— 复用批量落节点的 fit 信号揭出来
  let allVisible = false
  for (let i = 0; i < 20 && !allVisible; i += 1) {
    allVisible = await getWin().evaluate(() => [...document.querySelectorAll('[data-node-id]')].every((n) => {
      const r = n.getBoundingClientRect()
      return r.left >= -2 && r.top >= -2 && r.right <= window.innerWidth + 2 && r.bottom <= window.innerHeight + 2
    }))
    if (!allVisible) await getWin().waitForTimeout(250)
  }
  check(`切完 ${TILES} 张全在视口里（不用自己找）`, allVisible)
  await snap('04-tiles-grouped.png')

  // ⑤ 几何体检：算出来的格位 vs 真正渲染出来的方框，对不上就是用户说的「很乱」。
  //    栽过：布局按 129px 步距摆，可壳把每张卡钉在 240 宽 → 九张互相压掉 110px，糊成一团。
  const geometry = await getWin().evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-node-id]')]
      .map((n) => { const r = n.getBoundingClientRect(); return { id: n.getAttribute('data-node-id'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })
      .sort((a, b) => a.y - b.y || a.x - b.x)
    let overlaps = 0
    for (let i = 0; i < tiles.length; i += 1) for (let j = i + 1; j < tiles.length; j += 1) {
      const a = tiles[i], b = tiles[j]
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps += 1
    }
    return { tiles, overlaps, widths: [...new Set(tiles.map((t) => t.w))], heights: [...new Set(tiles.map((t) => t.h))] }
  })
  // 源图卡和瓦片不同宽：按「出现次数最多的那个宽度」认瓦片，别按写死的阈值切。
  const widthTally = new Map()
  for (const t of geometry.tiles) widthTally.set(t.w, (widthTally.get(t.w) || 0) + 1)
  const tileWidth = [...widthTally.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const tileRects = geometry.tiles.filter((t) => t.w === tileWidth)
  const cols = new Set(tileRects.map((t) => t.x)).size
  const rows = new Set(tileRects.map((t) => t.y)).size
  check(`${TILES} 张切片零重叠`, geometry.overlaps === 0, `重叠对数 ${geometry.overlaps}`)
  check(`${TILES} 张切片同宽同高（等分切图应等大）`, tileRects.length === TILES
    && new Set(tileRects.map((t) => t.h)).size === 1, `瓦片 ${tileRects.length} 张 · 宽 ${tileWidth} · 高 ${JSON.stringify([...new Set(tileRects.map((t) => t.h))])}`)
  check(`摆成 ${GRID} 列 ${GRID} 行`, cols === GRID && rows === GRID, `列 ${cols} 行 ${rows}`)

  // ⑤ 一次切图 = 一个 Cmd+Z 步（9 个节点 + 编组挂同一 txn，否则撤销要按 10 次）
  await getWin().locator('.generation-canvas-v2__stage').first().click({ position: { x: 40, y: 40 } })
  await getWin().keyboard.press('Meta+z')
  await expectCount(getWin().locator('[data-node-id]'), 1, `一次 Cmd+Z 没把整次切图撤干净（${TILES} 张瓦片+编组要挂同一个撤销步）`, 20_000)
  await expectCount(getWin().locator('[data-group-id]'), 0, 'Cmd+Z 后组框还在', 20_000)
  check('一次 Cmd+Z 撤掉整次切图', true)
  await snap('05-after-undo.png')

  const failed = verdicts.filter(([, ok]) => !ok)
  console.log(`\n  ${failed.length ? `❌ ${failed.length} 项未过` : '✅ 全部通过'}`)
  if (failed.length) process.exitCode = 1
} catch (error) {
  if (!String(error).includes('__done__')) {
    console.log(`\n❌ 走查中断：${String(error).slice(0, 400)}`)
    await snap('99-error.png')
    process.exitCode = 1
  }
} finally {
  await app.close().catch(() => {})
  console.log(`\n截图目录：${outDir}`)
}
