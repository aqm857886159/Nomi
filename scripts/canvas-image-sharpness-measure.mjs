// 诊断探针（非断言）：画布里的图为什么发虚？
//
// 反馈 2026-08-20 G2#434/436：「画布里这个图片有点模糊，实际图片很清晰的」。
// 用户截图里**同一层里的文字（镜头 3 / 镜头 4 标签）是锐的**——排除了整层被当缓存栅格拉伸
// （那样文字会一起糊）。文字锐、位图糊 = 位图被放大到超过自身像素。
//
// 所以要量的就一件事：**显示这张图需要多少设备像素 vs 它实际有多少像素**。
//   需要的设备像素 = 显示 CSS 宽 × devicePixelRatio × 画布缩放
//   实际有的      = img.naturalWidth
// 前者 > 后者 → 在放大插值 → 必糊。逐档缩放量一遍，找出从哪一档开始亏。
//
// 这是**量测工具**不是走查（故意不带 .walk：它只打印数字、不做断言，
// 判据是「需要的设备像素 vs 实际像素」这条比值，人看数字下结论）。
// 用法：pnpm run build && node scripts/canvas-image-sharpness-measure.mjs
import { launchNomiApp } from '../tests/ux/_launchApp.mjs'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findBlankCanvasPoint } from '../tests/ux/_canvasPoints.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-image-sharpness')
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nomi-sharp-'))
const userDataDir = path.join(tempRoot, 'user-data')
const projectsDir = path.join(tempRoot, 'projects')
mkdirSync(projectsDir, { recursive: true })
mkdirSync(shotsDir, { recursive: true })

const FIXTURE = path.join(repoRoot, 'tests/ux/fixtures/hires-detail-1024x1792.png')

const { app, win: initialWin } = await launchNomiApp({
  name: 'canvas-image-sharpness',
  userDataDir, settingsDir: userDataDir, projectsDir,
  args: ['--no-proxy-server'], settleMs: 0,
})

let win = initialWin
const getWin = () => {
  const live = app.windows().filter((c) => !c.isClosed())
  win = live.find((c) => /projectId=/.test(c.url())) || live[live.length - 1] || win
  return win
}
const snap = async (name) => {
  await getWin().screenshot({ path: path.join(shotsDir, name) })
  console.log(`  · 截图 ${name}`)
}
async function dismissFirstRun() {
  for (let i = 0; i < 6; i += 1) {
    const a = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await a.isVisible().catch(() => false)) await a.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}
async function resize(w, h) {
  const bw = await app.browserWindow(getWin())
  await bw.evaluate((t, s) => { t.setBounds({ x: 0, y: 0, width: s.width, height: s.height }); t.center() }, { width: w, height: h })
  await getWin().waitForTimeout(350)
}

/** 核心度量：这张图在当前缩放下，需要多少设备像素、实际有多少。 */
const measure = () => getWin().evaluate(() => {
  const img = document.querySelector('.generation-canvas-v2-node img')
  if (!img) return { error: 'node 里没有 img' }
  const layer = document.querySelector('.generation-canvas-v2__canvas')
  const m = layer ? new DOMMatrixReadOnly(getComputedStyle(layer).transform) : null
  const zoom = m ? m.a : 1
  const rect = img.getBoundingClientRect()          // 已含画布缩放
  const dpr = window.devicePixelRatio || 1
  const neededW = Math.round(rect.width * dpr)
  const neededH = Math.round(rect.height * dpr)
  return {
    zoom: Number(zoom.toFixed(3)),
    dpr,
    natural: `${img.naturalWidth}x${img.naturalHeight}`,
    cssBox: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
    neededDevicePx: `${neededW}x${neededH}`,
    // >1 = 在放大插值（糊）；<1 = 在缩小（锐）
    upscaleFactor: img.naturalWidth ? Number((neededW / img.naturalWidth).toFixed(2)) : null,
    imageRendering: getComputedStyle(img).imageRendering,
    src: String(img.currentSrc || img.src).slice(0, 70),
  }
})

async function findBlankPoint() {
  // 扫描 + 真实鼠标到位复验，见 tests/ux/_canvasPoints.mjs（磁性「+」句柄只在光标下才冒出来）。
  return findBlankCanvasPoint(getWin(), { rows: [0.35, 0.5, 0.65, 0.8], columns: [0.6, 0.7, 0.8, 0.5, 0.4] })
}

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().waitForTimeout(1500)
  await dismissFirstRun()
  const blankProject = getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  await blankProject.waitFor({ timeout: 8000 })
  await blankProject.click()
  await getWin().waitForTimeout(2200)
  await dismissFirstRun()
  await resize(1600, 1000)

  const generation = getWin().getByRole('button', { name: '生成', exact: true }).first()
  await generation.waitFor({ timeout: 8000 })
  await generation.click()
  await getWin().locator('.generation-canvas-v2-toolbar').waitFor({ timeout: 8000 })

  // 经 素材库 上传 → 拖到画布，得到一个带真图的节点（这条路是仓里已验证的入图路径）
  await getWin().getByRole('button', { name: '素材库' }).first().click({ timeout: 5000 }).catch(() => {})
  await getWin().waitForTimeout(900)
  const uploadBtn = getWin().getByRole('button', { name: '上传素材' }).first()
  await uploadBtn.waitFor({ timeout: 8000 })
  await uploadBtn.click()
  await getWin().waitForTimeout(600)
  const inputs = getWin().locator('input[type="file"]')
  console.log(`  · file input 数量: ${await inputs.count()}`)
  await inputs.last().setInputFiles(FIXTURE, { timeout: 5000 })
  await getWin().waitForTimeout(3000)
  await snap('00-library.png')

  // 把素材库里的图拖到画布空白处
  const tile = getWin().locator('img[src]').filter({ visible: true }).last()
  const tileBox = await tile.boundingBox()
  const blank = await findBlankPoint()
  let ok = false
  if (tileBox && blank) {
    await getWin().mouse.move(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2)
    await getWin().mouse.down()
    await getWin().mouse.move(blank.x, blank.y, { steps: 24 })
    await getWin().mouse.up()
    await getWin().waitForTimeout(2500)
    ok = (await getWin().locator('.generation-canvas-v2-node img').count()) > 0
  }
  console.log(`  · 拖进画布后 node 里有 img: ${ok}`)

  if (!ok) {
    console.log('\n⚠️ 没能把图放进节点——下面的量测无效，需要换入图路径')
    await snap('99-no-image.png')
  } else {
    await snap('01-zoom-default.png')
    console.log('\n【逐档缩放量测】upscaleFactor > 1 = 正在放大插值（糊）\n')
    console.log('  ' + JSON.stringify(await measure()))
    for (let i = 0; i < 8; i += 1) {
      await getWin().keyboard.press(process.platform === 'darwin' ? 'Meta+=' : 'Control+=')
      await getWin().waitForTimeout(260)
      const m = await measure()
      console.log('  ' + JSON.stringify(m))
      if (i === 3) await snap('02-zoomed-mid.png')
    }
    await snap('03-zoomed-max.png')
  }
  console.log('\n截图在', shotsDir)
} catch (err) {
  console.error('\n探针出错:', err.message)
  await snap('99-error.png').catch(() => {})
} finally {
  await app.close().catch(() => {})
}
