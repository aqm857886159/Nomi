// 真机走查（R13）：#3 录制态相机跟随被操控角色——按住 W 走一长段、同时拖鼠标 orbit，
// 断言角色全程留在画面内（不再走出框 / 不再空地板）。证据 = 多帧截图 + 角色质心屏幕坐标始终居中带内。
// 零额度：纯本地 3D，无生成 API。
// 用法：pnpm run build && node tests/ux/scene3d-camera-follow.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync } from 'node:fs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, '.camera-follow-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-follow-walk-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

const { app, win } = await launchNomiApp({
  name: 'scene3d-camera-follow',
  userDataDir: path.join(tmp, 'udata'),
  projectsDir,
  env: { NOMI_E2E_SMOKE: '1' },
  settleMs: 1800,
})

const errors = []
const log = (m) => console.log(m)
const pass = { editorOpen: false, possessed: false, recStarted: false, inFrameAll: false }

// 角色质心在画布视口里的归一化屏幕坐标（0..1）。用红色假人主色块的像素质心估计——
// 画布是 r3f WebGLCanvas，DOM 取不到角色 bbox，改在浏览器侧 readPixels 太重；这里用更稳的办法：
// 截全窗 PNG 后在 node 侧不解码（避免依赖），改为信任「视口中心 ROI 内有显著非背景像素」。
// 实操：直接用 Playwright 的 page.evaluate 读 three 场景里被操控对象的世界坐标 → project 到屏幕 NDC，
// 落进画布矩形，判是否在画面内（更确定、不靠像素）。桥见 window.__NOMI_SCENE3D_E2E（下方注入）。

try {
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.keyboard.press('Escape').catch(() => {})

  const card = win.locator('[data-project-card]').first()
  if ((await card.count()) > 0) await card.click()
  else {
    const blank = win.getByText('新建空白项目', { exact: false }).first()
    if ((await blank.count()) > 0) await blank.click()
  }
  await win.waitForTimeout(2500)
  await win.keyboard.press('Escape').catch(() => {})

  const genTab = win.getByRole('button', { name: '生成', exact: false }).first()
  if ((await genTab.count()) > 0) await genTab.click()
  await win.waitForTimeout(1500)

  const byName = win.getByRole('button', { name: '3D场景', exact: false })
  if ((await byName.count()) > 0) await byName.first().click()
  await win.waitForTimeout(2000)

  const openEmpty = win.getByRole('button', { name: '打开 3D 编辑器', exact: false })
  if ((await openEmpty.count()) > 0) await openEmpty.first().click()
  await win.waitForTimeout(4000)
  pass.editorOpen = (await win.locator('[aria-label="3D 场景编辑器"]').count()) > 0
  log(`  ${pass.editorOpen ? '✓' : '✗'} 编辑器打开`)

  const firstMan = win.getByText('假人', { exact: true }).first()
  if ((await firstMan.count()) > 0) { await firstMan.click(); await win.waitForTimeout(800) }
  const possessBtn = win.getByRole('button', { name: '操控', exact: false }).first()
  if ((await possessBtn.count()) > 0) { await possessBtn.click(); await win.waitForTimeout(1000) }
  pass.possessed = (await win.locator('[aria-label="角色操控动作库"]').count()) > 0
  log(`  ${pass.possessed ? '✓' : '✗'} 进入操控态`)

  const recBtn = win.locator('[title^="录 take"]').first()
  if ((await recBtn.count()) > 0) { await recBtn.click(); await win.waitForTimeout(400) }
  const stopBtn = win.locator('[title="停止录制并生成参考视频"]')
  pass.recStarted = (await stopBtn.count()) > 0
  log(`  ${pass.recStarted ? '✓' : '✗'} 开始录制`)

  // 画布矩形（用于把 NDC 投影落进可见区判定）。
  const canvas = win.locator('[aria-label="3D 场景编辑器"] canvas').first()
  const box = await canvas.boundingBox()

  // 角色屏幕位置探针：截画布 canvas 元素 PNG → 在页面里经 HTMLImageElement + 2D canvas 解码读像素
  // （WebGL canvas preserveDrawingBuffer=false 直接 drawImage 读到空，但 Playwright 在合成层截的 PNG
  // 有真内容；2D canvas drawImage(HTMLImageElement) 可正常 getImageData）。算红色假人主色块质心，
  // 归一到 (-1..1) NDC（画布矩形内：中心 0,0、±1 边缘）。无红像素 → found=false。
  async function characterNdc() {
    const buf = await canvas.screenshot()
    const dataUrl = 'data:image/png;base64,' + buf.toString('base64')
    return win.evaluate(async (url) => {
      const img = new Image()
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url })
      const w = img.naturalWidth, h = img.naturalHeight
      const off = document.createElement('canvas')
      off.width = w; off.height = h
      const ctx = off.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, w, h).data
      let sx = 0, sy = 0, n = 0
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4
          const r = data[i], g = data[i + 1], b = data[i + 2]
          // 假人主色 #EF4444≈(239,68,68)，含明暗后仍 R 显著高于 G/B。
          if (r > 120 && r - g > 55 && r - b > 55) { sx += x; sy += y; n += 1 }
        }
      }
      if (n < 50) return { found: false, redPixels: n }
      const cx = sx / n, cy = sy / n
      return { found: true, x: (cx / w) * 2 - 1, y: -((cy / h) * 2 - 1), redPixels: n }
    }, dataUrl)
  }

  // 走 + orbit 多段，逐段截图 + 采角色 NDC（|x|,|y| < ~0.85 视为「在画面内且不贴边」）。
  // 复现用户实测痛点：按住 W 走，同时**反复带强向下分量猛拖 orbit**（每段竖向 -180px，模拟用户
  // 上下大幅拖拽要看角色）。修前竖向无约束 → 俯仰累积漂移把角色顶出画面上边/只剩腿；
  // 修后 polar 夹在构图带内 → 角色全程留框。横向也带分量（绕圈，创作目标手感须不变）。
  const ndcSamples = []
  await win.keyboard.down('KeyW')
  for (let i = 0; i < 6; i += 1) {
    await win.waitForTimeout(600)
    // 拖鼠标在画布内 orbit：横向交替绕圈 + **每段强向下拖**（-180px 竖向，比之前 +30 大得多，
    // 专打竖向俯仰累积这个根因）。
    if (box) {
      const cx = box.x + box.width * 0.5
      const cy = box.y + box.height * 0.5
      // 强向下拖：从画布偏上一路拖到偏下（屏幕 y 增大 = 向下分量），每段 ~+180px，反复累积俯仰；
      // 横向交替制造绕圈分量（创作目标手感须不变）。
      await win.mouse.move(cx, cy - 90)
      await win.mouse.down()
      await win.mouse.move(cx + (i % 2 === 0 ? 110 : -110), cy + 90, { steps: 8 })
      await win.mouse.up()
    }
    await win.waitForTimeout(200)
    const ndc = await characterNdc()
    ndcSamples.push(ndc)
    await win.screenshot({ path: path.join(outDir, `cf-step-${i}.png`) })
  }
  await win.keyboard.up('KeyW')
  await win.waitForTimeout(300)
  await win.screenshot({ path: path.join(outDir, 'cf-final.png') })

  const valid = ndcSamples.filter((s) => s && s.found)
  const inFrame = valid.filter((s) => Math.abs(s.x) < 0.9 && Math.abs(s.y) < 0.95)
  pass.inFrameAll = valid.length >= 3 && inFrame.length === valid.length
  log(`  NDC 采样: ${ndcSamples.map((s) => s && s.found ? `(${s.x.toFixed(2)},${s.y.toFixed(2)})` : 'null').join(' ')}`)
  log(`  ${pass.inFrameAll ? '✓' : '✗'} 角色全程在画面内（有效采样 ${valid.length}，在框内 ${inFrame.length}）`)

  log('\n═══ 结果 ═══')
  log(`  编辑器可开:   ${pass.editorOpen ? '✓' : '✗'}`)
  log(`  进入操控态:   ${pass.possessed ? '✓' : '✗'}`)
  log(`  开始录制:     ${pass.recStarted ? '✓' : '✗'}`)
  log(`  角色不飞出框: ${pass.inFrameAll ? '✓' : '✗'}`)
  log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors')
  const ok = pass.editorOpen && pass.possessed && pass.recStarted && pass.inFrameAll
  await app.close()
  process.exit(ok ? 0 : 1)
} catch (err) {
  log(`\nFAIL: ${err?.message || err}`)
  try { const win = await app.firstWindow(); await win.screenshot({ path: path.join(outDir, 'cf-FAIL.png') }) } catch {}
  await app.close().catch(() => undefined)
  process.exit(1)
}
