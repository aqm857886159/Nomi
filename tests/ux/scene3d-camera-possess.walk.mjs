// 真机走查（R13）：把「操控」泛化到相机 = possess 镜头 → WASD 飞它录运镜。
// 验主路：进编辑器 → 选相机 → 点「操控」→ 进镜头操控态 → 按 WASD 飞相机（截图证明视角在变=相机在飞）
// → 录 take → 停止 → 出「录制走位参考」节点（运镜 mp4 链路）。
// 证据 = 多帧截图 + 飞行前后画面差异（相机移动则像素大幅变化）+ 操控的是「镜头工具栏」不是「角色动作库」。
// 零额度：纯本地 3D 离屏，无生成 API。
// 用法：pnpm run build && node tests/ux/scene3d-camera-possess.walk.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, '.camera-possess-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-cam-possess-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${path.join(tmp, 'udata')}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_SMOKE: '1', NOMI_PROJECTS_DIR: projectsDir },
})

const errors = []
const log = (m) => console.log(m)
const pass = {
  editorOpen: false,
  cameraSelected: false,
  possessed: false,
  cameraFlew: false,
  recStarted: false,
  recordedNode: false,
  videoRendered: false,
}

// 红色假人质心（全窗 PNG → 页面侧 2D canvas 读像素，假人主色 #EF4444 显著 R 高于 G/B）。
// 相机飞行 → 假人在画面里平移/缩放 → 质心坐标 + 红像素数大幅变化。
// 注意：必须在 frameloop=always（录制态）下测——demand 模式静止时 WebGL 截图陈旧（读到上一帧）。
async function redCentroid(win) {
  const buf = await win.screenshot()
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
        if (r > 120 && r - g > 55 && r - b > 55) { sx += x; sy += y; n += 1 }
      }
    }
    if (n < 50) return { found: false, n }
    return { found: true, x: Math.round(sx / n), y: Math.round(sy / n), n }
  }, dataUrl)
}

function centroidDelta(a, b) {
  if (!a || !b) return 0
  const dxy = a.found && b.found ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  const dn = Math.abs((a.n || 0) - (b.n || 0))
  return dxy + dn * 0.02 // 位置位移 + 红像素数变化（飞近/飞远）的合成度量
}

try {
  const win = await app.firstWindow()
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)
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
  await win.screenshot({ path: path.join(outDir, 'cp-0-editor.png') })

  // 选相机：左侧场景节点列表里点「相机1」。
  const cameraItem = win.getByText('相机1', { exact: true }).first()
  if ((await cameraItem.count()) > 0) { await cameraItem.click(); await win.waitForTimeout(800) }
  // 相机被选中 → 出现相机预览浮窗（标题含「相机1」）。
  pass.cameraSelected = (await win.getByText('相机1 · 16:9', { exact: false }).count()) > 0
  log(`  ${pass.cameraSelected ? '✓' : '✗'} 选中相机`)
  await win.screenshot({ path: path.join(outDir, 'cp-1-camera-selected.png') })

  // 点「操控」进相机运镜操控态。
  const possessBtn = win.getByRole('button', { name: '操控', exact: false }).first()
  if ((await possessBtn.count()) > 0) { await possessBtn.click(); await win.waitForTimeout(1000) }
  pass.possessed = (await win.locator('[aria-label="镜头操控工具栏"]').count()) > 0
  // 反向校验：不该误入「角色操控动作库」（那是 WASD 给角色）。
  const characterBar = (await win.locator('[aria-label="角色操控动作库"]').count()) > 0
  log(`  ${pass.possessed ? '✓' : '✗'} 进入镜头操控态（角色动作库出现=${characterBar ? '是(错!)' : '否(对)'}）`)
  await win.screenshot({ path: path.join(outDir, 'cp-2-possessed.png') })

  const canvas = win.locator('[aria-label="3D 场景编辑器"] canvas').first()
  const box = await canvas.boundingBox()
  // 点画布上半（不点中假人，避免改选择）让键盘焦点在编辑器上。
  if (box) await win.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3)
  await win.waitForTimeout(300)

  // 先开始录制（frameloop=always）→ WebGL 截图变实时（demand 模式静止时截图陈旧，测不出移动）。
  const recBtn = win.locator('[title^="录 take"]').first()
  if ((await recBtn.count()) > 0) { await recBtn.click(); await win.locator('[title="停止录制并生成参考视频"]').first().waitFor({ timeout: 8000 }).catch(() => {}); await win.waitForTimeout(200) }
  const stopBtn = win.locator('[title="停止录制并生成参考视频"]')
  pass.recStarted = (await stopBtn.count()) > 0
  log(`  ${pass.recStarted ? '✓' : '✗'} 开始录制（frameloop=always，截图实时）`)

  // WASD 飞相机：录制态下记录飞行前质心，按住 W 飞一段，再记录飞行后质心。相机在飞 → 假人在画面里大幅平移。
  const before = await redCentroid(win)
  await win.screenshot({ path: path.join(outDir, 'cp-3-before-fly.png') })
  await win.keyboard.down('KeyW')
  for (let i = 0; i < 5; i += 1) {
    await win.waitForTimeout(420)
    await win.screenshot({ path: path.join(outDir, `cp-fly-${i}.png`) })
  }
  await win.keyboard.up('KeyW')
  await win.waitForTimeout(400)
  const after = await redCentroid(win)
  await win.screenshot({ path: path.join(outDir, 'cp-4-after-fly.png') })
  const delta = centroidDelta(before, after)
  pass.cameraFlew = delta > 60 // 相机平移 → 假人质心/像素数大幅变；静止则~0
  log(`  ${pass.cameraFlew ? '✓' : '✗'} WASD 飞相机（假人质心前=${before.found ? `(${before.x},${before.y})n${before.n}` : '无'} 后=${after.found ? `(${after.x},${after.y})n${after.n}` : '无'}，delta=${delta.toFixed(1)}）`)

  // 停止录制 → 应建「录制走位参考」节点（运镜 mp4 链路）。
  if ((await stopBtn.count()) > 0) { await stopBtn.first().click(); await win.waitForTimeout(2500) }
  await win.screenshot({ path: path.join(outDir, 'cp-5-after-stop.png') })

  // 出片是异步的；关编辑器后画布上应多出一个「录制走位参考」3D 节点（运镜 take 已落节点 = mp4 链路已起）。
  // 计 3D 节点入口数：原 1 个 → 录完应为 2 个（buildRecordedCameraTakeScene 返回非 null 才会建节点）。
  const beforeNodes = await win.getByText('点击进入 3D 编辑器', { exact: false }).count()
  const editor = win.locator('[aria-label="3D 场景编辑器"]')
  const closeBtn = editor.locator('[title="退出 3D 场景"]').first()
  await closeBtn.waitFor({ state: 'visible', timeout: 5000 })
  await closeBtn.click()
  await editor.waitFor({ state: 'hidden', timeout: 5000 })
  await win.waitForTimeout(3500)
  const node3dCount = await win.getByText('点击进入 3D 编辑器', { exact: false }).count()
  const titleSeen = (await win.getByText('录制走位参考', { exact: false }).count()) > 0
  pass.recordedNode = node3dCount >= 2 || titleSeen
  log(`  ${pass.recordedNode ? '✓' : '✗'} 录运镜落「录制走位参考」节点（3D 节点数 ${node3dCount}，标题可见=${titleSeen}）`)
  await win.screenshot({ path: path.join(outDir, 'cp-6-recorded-node.png') })

  // 离屏出片是真渲染：等节点徽标从「参考视频生成中…」走到「参考视频已生成 ✓」
  // = 这段运镜真的被离屏管线渲成了 mp4（cameraWithPlaybackPosition 按录下的位置+aim 轨迹逐帧出片）。
  for (let i = 0; i < 30; i += 1) {
    if ((await win.getByText('参考视频已生成', { exact: false }).count()) > 0) { pass.videoRendered = true; break }
    await win.waitForTimeout(1000)
  }
  log(`  ${pass.videoRendered ? '✓' : '✗'} 离屏出片完成「参考视频已生成 ✓」（运镜真渲成 mp4）`)
  await win.screenshot({ path: path.join(outDir, 'cp-7-video-rendered.png') })

  log('\n═══ 结果 ═══')
  log(`  编辑器可开:       ${pass.editorOpen ? '✓' : '✗'}`)
  log(`  选中相机:         ${pass.cameraSelected ? '✓' : '✗'}`)
  log(`  进入镜头操控态:   ${pass.possessed ? '✓' : '✗'}`)
  log(`  WASD 飞相机:      ${pass.cameraFlew ? '✓' : '✗'}`)
  log(`  开始录制:         ${pass.recStarted ? '✓' : '✗'}`)
  log(`  出录制参考节点:   ${pass.recordedNode ? '✓' : '✗'}`)
  log(`  运镜渲成 mp4:     ${pass.videoRendered ? '✓' : '✗'}`)
  log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors')
  const ok = pass.editorOpen && pass.cameraSelected && pass.possessed && pass.cameraFlew && pass.recStarted && pass.recordedNode && pass.videoRendered
  await app.close()
  process.exit(ok ? 0 : 1)
} catch (err) {
  log(`\nFAIL: ${err?.message || err}`)
  try { const win = await app.firstWindow(); await win.screenshot({ path: path.join(outDir, 'cp-FAIL.png') }) } catch {}
  await app.close().catch(() => undefined)
  process.exit(1)
}
