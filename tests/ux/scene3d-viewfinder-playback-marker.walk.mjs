// 真机走查（R13）：取景往返后时间轴播放，相机 marker 必须仍跟轨迹动（僵尸 ref 根治验收）。
// 复现链：3D 编辑器 → 选相机 → 「推近」预设（自动开时间轴）→ 进「输出画面」取景再退出 → 播放。
// 修前：取景往返把 CameraHelperView 整组重挂载，直驱表里仍是旧 Object3D → marker 冻住。
//
// 两阶段自校准（同一次运行里区分「bug 复现」和「检测器失灵」）：
//   阶段A 不进取景直接播 → marker 应动（验证像素差检测器本身有效）；
//   阶段B 取景往返后播   → 修前冻住(✗) / 修后照动(✓)。
// 运动断言 = 画布区（裁掉底部时间轴条与右侧浮窗）连续截图像素差 >> 静止噪声底。
// 零额度：纯本地 3D，无生成 API。
// 用法：pnpm run build && node tests/ux/scene3d-viewfinder-playback-marker.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { screenshotSettled } from './_assert.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, '.viewfinder-marker-lab')
mkdirSync(outDir, { recursive: true })

const { app, win } = await launchNomiApp({
  name: 'scene3d-viewfinder-playback-marker',
  env: { NOMI_E2E_SMOKE: '1' },
  settleMs: 1800,
})

const errors = []
const log = (m) => console.log(m)
const pass = {
  editorOpen: false,
  cameraSelected: false,
  presetApplied: false,
  phaseAMoved: false,
  viewfinderEntered: false,
  viewfinderExited: false,
  phaseBMoved: false,
}

// 全窗截图 → dataURL（后续在页面侧 2D canvas 做区域像素差）。
async function shot(win, name) {
  const buf = await screenshotSettled(win, { path: path.join(outDir, `${name}.png`) })
  return 'data:image/png;base64,' + buf.toString('base64')
}

// 两张截图在指定 CSS 像素矩形内的差异像素数（隔 2px 采样，通道差和 >36 记一票）。
// 截图是设备像素（retina 2x），rect 是 CSS 像素 → 页面侧按 naturalWidth/innerWidth 换算。
async function regionDiff(win, urlA, urlB, rect) {
  return win.evaluate(async ({ a, b, rect }) => {
    const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    const scale = ia.naturalWidth / window.innerWidth
    const sx = Math.round(rect.x * scale)
    const sy = Math.round(rect.y * scale)
    const sw = Math.round(rect.w * scale)
    const sh = Math.round(rect.h * scale)
    const draw = (img) => {
      const c = document.createElement('canvas')
      c.width = sw; c.height = sh
      const ctx = c.getContext('2d')
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      return ctx.getImageData(0, 0, sw, sh).data
    }
    const da = draw(ia)
    const db = draw(ib)
    let diff = 0
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        const i = (y * sw + x) * 4
        const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])
        if (d > 36) diff += 1
      }
    }
    return diff
  }, { a: urlA, b: urlB, rect })
}

// 播放窗口内连拍三张，返回相邻两对的区域差。tag 用于截图命名。
async function playAndMeasure(win, rect, tag) {
  const playBtn = win.locator('[title="播放"]').first()
  await playBtn.waitFor({ timeout: 5000 })
  await playBtn.click()
  await win.waitForTimeout(350)
  const playing = (await win.locator('[title="暂停"]').count()) > 0
  const s1 = await shot(win, `${tag}-t0`)
  await win.waitForTimeout(650)
  const s2 = await shot(win, `${tag}-t1`)
  await win.waitForTimeout(650)
  const s3 = await shot(win, `${tag}-t2`)
  // 停住 + 归零，给下一阶段一个干净起点（播完自停时「暂停」按钮已回「播放」）。
  const pauseBtn = win.locator('[title="暂停"]').first()
  if ((await pauseBtn.count()) > 0) await pauseBtn.click()
  const resetBtn = win.locator('[title="归零"]').first()
  if ((await resetBtn.count()) > 0) await resetBtn.click()
  await win.waitForTimeout(400)
  const d1 = await regionDiff(win, s1, s2, rect)
  const d2 = await regionDiff(win, s2, s3, rect)
  return { playing, d1, d2 }
}

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

  // 3D 场景自 2026-09-06「第三档」起住在左缘的「更多」里；点法收口在 _canvasRail，找不到当场抛。
  await addCanvasNodeFromRail(win, 'scene3d', { timeout: 8000 })
  await win.waitForTimeout(2000)

  const openEmpty = win.getByRole('button', { name: '打开 3D 编辑器', exact: false })
  if ((await openEmpty.count()) > 0) await openEmpty.first().click()
  await win.waitForTimeout(4000)
  pass.editorOpen = (await win.locator('[aria-label="3D 场景编辑器"]').count()) > 0
  log(`  ${pass.editorOpen ? '✓' : '✗'} 编辑器打开`)

  // 首次进编辑器的分步教练卡（z-[6] 遮罩拦所有点击）→ 点「跳过」清场。
  const skipCoach = win.getByRole('button', { name: '跳过', exact: true }).first()
  if ((await skipCoach.count()) > 0) { await skipCoach.click().catch(() => {}); await win.waitForTimeout(600) }
  await screenshotSettled(win, { path: path.join(outDir, 'vf-0-editor.png') })

  // 选相机（左侧场景列表）→ 右栏「运镜预设」面板出现。
  const cameraItem = win.getByText('相机1', { exact: true }).first()
  if ((await cameraItem.count()) > 0) { await cameraItem.click(); await win.waitForTimeout(800) }
  pass.cameraSelected = (await win.getByText('相机1 · 16:9', { exact: false }).count()) > 0
  log(`  ${pass.cameraSelected ? '✓' : '✗'} 选中相机`)

  // 点「推近」预设 → 落轨迹 + 自动开时间轴（出现播放钮）。
  const pushIn = win.getByRole('button', { name: '推近', exact: true }).first()
  await pushIn.waitFor({ timeout: 5000 })
  await pushIn.click()
  await win.waitForTimeout(1200)
  pass.presetApplied = (await win.locator('[title="播放"]').count()) > 0
  log(`  ${pass.presetApplied ? '✓' : '✗'} 推近预设落轨迹（时间轴自动打开）`)
  await screenshotSettled(win, { path: path.join(outDir, 'vf-1-preset.png') })

  // 运动检测区 = 画布全宽 × y 38%-72% 横带。排除的恒动/污染源：上方相机预览浮窗
  // （POV 是 objectWithPlaybackPose 纯投影，不走直驱表、修没修都在动，含 % 角标）、
  // 顶部 pill/toast、底部时间轴条（播放头恒动）与状态句。带内只剩场景本体——未绑轨迹的
  // 假人/网格恒静止，唯一会动的就是被直驱盖章的相机 marker。
  // 两阶段测量前都走「取消选中 → 适应视图」：取景退出会把编辑器视角留在相机近景，
  // fit 由场景包围盒决定 → 两阶段构图一致、marker 必在带内。
  const canvas = win.locator('[aria-label="3D 场景编辑器"] canvas').first()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('拿不到 3D 画布 boundingBox')
  const rect = {
    x: box.x,
    y: box.y + box.height * 0.38,
    w: box.width,
    h: box.height * 0.34,
  }
  const settleForMeasure = async () => {
    // 编辑器 fit 钮 =「看全场…」（把假人和相机都框回画面）；注意画布页另有「适应视图」，
    // 名字不同但都别裸配 title——作用域钉进编辑器 dialog。相机保持选中：POV 浮窗在横带外，
    // marker 选中态是黄色（对比更强），也不会召出假人的操控提示圈。
    const fit = win.locator('[aria-label="3D 场景编辑器"] [title^="看全场"]').first()
    await fit.waitFor({ timeout: 5000 })
    await fit.click()
    await win.waitForTimeout(1200)
  }

  await settleForMeasure()
  await win.waitForTimeout(800) // 预设 toast 淡出，画面完全静止
  // 静止噪声底：不播放连拍两张的区域差（demand 帧循环下应≈0）。
  const f1 = await shot(win, 'vf-2-floor-a')
  await win.waitForTimeout(600)
  const f2 = await shot(win, 'vf-2-floor-b')
  const floor = await regionDiff(win, f1, f2, rect)
  const movedThreshold = Math.max(400, floor * 6)
  log(`  · 静止噪声底 diff=${floor}（运动判定阈=${movedThreshold}）`)

  // 阶段A：不进取景直接播 → marker 应沿轨迹动（检测器有效性）。
  const a = await playAndMeasure(win, rect, 'vf-3-phaseA')
  pass.phaseAMoved = a.playing && (a.d1 > movedThreshold || a.d2 > movedThreshold)
  log(`  ${pass.phaseAMoved ? '✓' : '✗'} 阶段A 直接播放 marker 在动（playing=${a.playing} d1=${a.d1} d2=${a.d2}）`)

  // 阶段B：取景往返（进「输出画面」再回工作视图 = CameraHelperView 整组卸载重挂）→ 再播。
  // 进取景需先选中相机（chip 作用于「所选相机」）。
  const cameraItemB = win.getByText('相机1', { exact: true }).first()
  if ((await cameraItemB.count()) > 0) { await cameraItemB.click(); await win.waitForTimeout(700) }
  const enterVf = win.locator('[title^="进入所选相机取景"]').first()
  await enterVf.waitFor({ timeout: 5000 })
  await enterVf.click()
  await win.waitForTimeout(1500)
  pass.viewfinderEntered = (await win.locator('[title="回到导演工作视图"]').count()) > 0
  log(`  ${pass.viewfinderEntered ? '✓' : '✗'} 进入取景（输出画面）`)
  await screenshotSettled(win, { path: path.join(outDir, 'vf-4-viewfinder.png') })

  const exitVf = win.locator('[title="回到导演工作视图"]').first()
  if ((await exitVf.count()) > 0) await exitVf.click()
  await win.waitForTimeout(1500)
  pass.viewfinderExited = (await win.locator('[title^="进入所选相机取景"]').count()) > 0
  log(`  ${pass.viewfinderExited ? '✓' : '✗'} 退出取景回工作视图`)
  await screenshotSettled(win, { path: path.join(outDir, 'vf-5-back.png') })

  await settleForMeasure() // 取景退出视角留在近景 + 浮窗盖 marker → 清选中 + fit 回一致构图
  const b = await playAndMeasure(win, rect, 'vf-6-phaseB')
  pass.phaseBMoved = b.playing && (b.d1 > movedThreshold || b.d2 > movedThreshold)
  log(`  ${pass.phaseBMoved ? '✓' : '✗'} 阶段B 取景往返后播放 marker 仍在动（playing=${b.playing} d1=${b.d1} d2=${b.d2}）`)

  log('\n═══ 结果 ═══')
  log(`  编辑器可开:               ${pass.editorOpen ? '✓' : '✗'}`)
  log(`  选中相机:                 ${pass.cameraSelected ? '✓' : '✗'}`)
  log(`  推近预设落轨迹:           ${pass.presetApplied ? '✓' : '✗'}`)
  log(`  阶段A 播放 marker 动:     ${pass.phaseAMoved ? '✓' : '✗'}（检测器有效性）`)
  log(`  取景进/出:                ${pass.viewfinderEntered ? '✓' : '✗'} / ${pass.viewfinderExited ? '✓' : '✗'}`)
  log(`  阶段B 往返后 marker 动:   ${pass.phaseBMoved ? '✓' : '✗'}（僵尸 ref 验收）`)
  log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors')
  const ok = Object.values(pass).every(Boolean)
  await app.close()
  process.exit(ok ? 0 : 1)
} catch (err) {
  log(`\nFAIL: ${err?.message || err}`)
  try { await win.screenshot({ path: path.join(outDir, 'vf-FAIL.png') }) } catch {}
  await app.close().catch(() => undefined)
  process.exit(1)
}
