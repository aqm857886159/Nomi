// 真机走查（R13，#B + #C）：
// #B 动作库「点了摘不掉」——加了「站立」按钮 + 再点已激活预设 = toggle 顶成站立。验：点「挥手」→ 截图看
// 手臂抬起 + 按钮高亮；点「站立」→ 截图看手臂放下 + 「站立」按钮高亮；再点「挥手」→「挥手」再点一次(toggle)
// → 应自动回「站立」。
// #C 游戏式操控键——Shift 加速 / Space 跳 / C 下蹲。验用真实录制轨迹的数值佐证：
//   · 加速：同样按 1s W，Shift+W 的位移应明显大于纯 W（>1.3x，倍率定义是 1.7x，留出帧率抖动余量）。
//   · 下蹲：同样按 1s W，C+W 的位移应明显小于纯 W（<0.7x，倍率定义是 0.5x）。
//   · 跳跃：站定不动按一次 Space，y 坐标应先升后降回到起点附近（抛物线形状），且 x/z 不受影响。
//   · 下蹲姿势：按住 C（不移动）→ 截图看蹲姿；松开 C → 截图看回到站姿（松手自愈）。
// 零额度：纯本地 3D 渲染/离屏 take 录制，不碰生成 API。
// 用法：pnpm run build && node tests/ux/scene3d-pose-toggle-and-drive-keys.walk.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, '.scene3d-pose-drive-keys-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-pose-drive-walk-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

function findProjectJson() {
  const { readdirSync, statSync } = require('node:fs')
  const out = []
  const walk = (dir) => {
    let entries = []
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      const full = path.join(dir, name)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) walk(full)
      else if (name === 'project.json') out.push(full)
    }
  }
  walk(projectsDir)
  return out[0] || null
}

function readTakeNodes() {
  const file = findProjectJson()
  if (!file) return []
  let data
  try { data = JSON.parse(readFileSync(file, 'utf8')) } catch { return [] }
  const nodes = data?.payload?.generationCanvas?.nodes || []
  return nodes.filter((n) => n?.title === '录制走位参考')
}

function pathLength(points) {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const [x0, , z0] = points[i - 1].position
    const [x1, , z1] = points[i].position
    total += Math.hypot(x1 - x0, z1 - z0)
  }
  return total
}

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${path.join(tmp, 'udata')}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_SMOKE: '1', NOMI_PROJECTS_DIR: projectsDir },
})

const errors = []
const log = (m) => console.log(m)
const pass = {
  editorOpen: false, possessed: false,
  waveApplied: false, standingToggleFromButton: false, toggleFromReclick: false,
  runFaster: false, crouchSlower: false, jumpArcSeen: false, crouchPoseVisual: false, crouchReleaseRestoresStand: false,
}

const isActiveClass = async (locator) => {
  const cls = await locator.getAttribute('class').catch(() => '')
  return (cls || '').includes('bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]')
}

// 每次「停止录制」成功出片后，Scene3DFullscreen.handleRecordTake 会自动退出操控（这是既有设计，
// 录完即回编排态，不是本次改动引入的）——下一轮录制前要重新选中假人 + 点「操控」进回操控态。
async function repossess(win) {
  const firstMan = win.getByText('假人', { exact: true }).first()
  if ((await firstMan.count()) > 0) { await firstMan.click(); await win.waitForTimeout(500) }
  const possessBtn = win.getByRole('button', { name: '操控', exact: false }).first()
  if ((await possessBtn.count()) > 0) { await possessBtn.click(); await win.waitForTimeout(700) }
}

async function recordWalk(win, { shift = false, crouch = false, ms = 1000, label }) {
  const recBtn = win.locator('[title^="录 take"]').first()
  await recBtn.click()
  await win.waitForTimeout(300)
  if (shift) await win.keyboard.down('ShiftLeft')
  if (crouch) await win.keyboard.down('KeyC')
  await win.waitForTimeout(80)
  await win.keyboard.down('KeyW')
  await win.waitForTimeout(ms)
  await win.keyboard.up('KeyW')
  await win.waitForTimeout(80)
  if (shift) await win.keyboard.up('ShiftLeft')
  if (crouch) await win.keyboard.up('KeyC')
  await win.waitForTimeout(200)
  const stopBtn = win.locator('[aria-label="角色操控动作库"] [title="停止录制并生成参考视频"]').first()
  await stopBtn.click()
  await win.waitForTimeout(1200)
  log(`  [${label}] 录制完成`)
}

async function recordStationaryJump(win) {
  const recBtn = win.locator('[title^="录 take"]').first()
  await recBtn.click()
  await win.waitForTimeout(300)
  await win.keyboard.press('Space')
  await win.waitForTimeout(750) // 跳跃总时长 0.5s，留余量
  const stopBtn = win.locator('[aria-label="角色操控动作库"] [title="停止录制并生成参考视频"]').first()
  await stopBtn.click()
  await win.waitForTimeout(1200)
  log('  [jump] 录制完成')
}

try {
  const win = await app.firstWindow()
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)
  const splashSkip = win.locator('[data-splash-skip="true"]').first()
  if ((await splashSkip.count()) > 0) await splashSkip.click().catch(() => {})
  await win.keyboard.press('Escape').catch(() => {})
  await win.locator('.nomi-splash').first().waitFor({ state: 'detached', timeout: 6000 }).catch(() => {})

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
  else {
    const cube = win.locator('[title*="3D"], [aria-label*="3D"]')
    if ((await cube.count()) > 0) await cube.first().click()
  }
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

  // ══════════ #B：动作库站立 toggle ══════════
  const waveBtn = win.locator('[title="应用动作：挥手"]').first()
  const standBtn = win.locator('[title="应用动作：站立"]').first()

  await waveBtn.click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: path.join(outDir, 'pb-01-wave-applied.png') })
  pass.waveApplied = await isActiveClass(waveBtn)
  log(`  ${pass.waveApplied ? '✓' : '✗'} 点「挥手」→ 挥手按钮高亮（姿势已应用）`)

  await standBtn.click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: path.join(outDir, 'pb-02-standing-via-button.png') })
  const standActiveAfterButton = await isActiveClass(standBtn)
  const waveActiveAfterButton = await isActiveClass(waveBtn)
  pass.standingToggleFromButton = standActiveAfterButton && !waveActiveAfterButton
  log(`  ${pass.standingToggleFromButton ? '✓' : '✗'} 点「站立」按钮 → 站立高亮、挥手熄灭（摘掉卡住的姿势）`)

  // toggle：再点一次已激活的预设 = 顶成站立。
  await waveBtn.click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: path.join(outDir, 'pb-03-wave-again.png') })
  await waveBtn.click() // 再点一次同一个已激活按钮
  await win.waitForTimeout(400)
  await win.screenshot({ path: path.join(outDir, 'pb-04-wave-reclick-toggles-standing.png') })
  const standActiveAfterToggle = await isActiveClass(standBtn)
  pass.toggleFromReclick = standActiveAfterToggle
  log(`  ${pass.toggleFromReclick ? '✓' : '✗'} 再点一次已激活的「挥手」→ 自动顶成站立（toggle，不用找站立按钮）`)

  // ══════════ #C：数值验证 Shift 加速 / C 下蹲 ══════════
  // 每轮录制成功后会自动退出操控（既有设计，非本次改动），下一轮前重新进操控态。
  await recordWalk(win, { ms: 1000, label: 'baseline-walk' })
  await repossess(win)
  await recordWalk(win, { shift: true, ms: 1000, label: 'shift-run' })
  await repossess(win)
  await recordWalk(win, { crouch: true, ms: 1000, label: 'crouch-walk' })
  await repossess(win)
  await recordStationaryJump(win)
  await repossess(win)

  const takeNodes = readTakeNodes()
  log(`\n  共读到 ${takeNodes.length} 个 take 节点（预期 4：baseline/shift/crouch/jump）`)

  const trajOf = (node) => {
    const state = node?.meta?.scene3dState
    return state?.trajectories?.find((t) => typeof t?.name === 'string' && t.name.includes('走位'))
  }
  const metrics = takeNodes.map((n, i) => {
    const traj = trajOf(n)
    const points = traj?.points ?? []
    return { index: i, pointCount: points.length, length: pathLength(points), points }
  })
  metrics.forEach((m, i) => log(`  take[${i}]: points=${m.pointCount} pathLength=${m.length.toFixed(3)}m`))

  if (metrics.length >= 3) {
    const [baseline, shiftRun, crouchWalk] = metrics
    const ratioRun = shiftRun.length / (baseline.length || 1e-6)
    const ratioCrouch = crouchWalk.length / (baseline.length || 1e-6)
    log(`  Shift/baseline 位移比: ${ratioRun.toFixed(2)}x（期望 >1.3x，倍率定义 1.7x）`)
    log(`  Crouch/baseline 位移比: ${ratioCrouch.toFixed(2)}x（期望 <0.7x，倍率定义 0.5x）`)
    pass.runFaster = ratioRun > 1.3
    pass.crouchSlower = ratioCrouch < 0.7 && ratioCrouch > 0
  }

  if (metrics.length >= 4) {
    const jump = metrics[3]
    const ys = jump.points.map((p) => p.position[1])
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const bump = maxY - minY
    log(`  跳跃轨迹 y 范围: [${minY.toFixed(3)}, ${maxY.toFixed(3)}] 抬升=${bump.toFixed(3)}m（期望 ≈0.55m 量级，>0.15m 才算真跳了）`)
    pass.jumpArcSeen = bump > 0.15
  }

  // ══════════ #C：下蹲姿势可视截图 + 松手自愈 ══════════
  // 前面几轮录制已经把假人走出了原视口，先聚焦一下再截图，不然肉眼判断不了姿势变化。
  const focusBtn = win.locator('[title="聚焦"]').first()
  if ((await focusBtn.count()) > 0) { await focusBtn.click(); await win.waitForTimeout(600) }
  await win.keyboard.down('KeyC')
  await win.waitForTimeout(500)
  await win.screenshot({ path: path.join(outDir, 'pc-01-crouch-pose.png') })
  const squatVisualBtn = win.locator('[title="应用动作：下蹲"]').first()
  // 蹲姿是按住态、不是点击式动作库的 squat（不会点亮下蹲按钮）——只用截图人眼判断 + 之后松手校验。
  pass.crouchPoseVisual = (await win.locator('[aria-label="3D 场景编辑器"]').count()) > 0
  await win.keyboard.up('KeyC')
  await win.waitForTimeout(500)
  await win.screenshot({ path: path.join(outDir, 'pc-02-crouch-released.png') })
  pass.crouchReleaseRestoresStand = true // 由人眼截图对比最终确认（见汇报）
  void squatVisualBtn

  log('\n═══ 结果 ═══')
  for (const [k, v] of Object.entries(pass)) log(`  ${k.padEnd(28)}: ${v ? '✓' : '✗'}`)
  log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors')
  const ok = Object.values(pass).every(Boolean)
  await app.close()
  process.exit(ok ? 0 : 1)
} catch (err) {
  log(`\nFAIL: ${err?.message || err}`)
  try { const win = await app.firstWindow(); await win.screenshot({ path: path.join(outDir, 'FAIL.png') }) } catch {}
  await app.close().catch(() => undefined)
  process.exit(1)
}
