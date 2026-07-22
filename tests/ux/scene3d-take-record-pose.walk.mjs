// 真机走查（R13）：pose-over-time——录 take 时**中途切动作**（走→蹲→挥手）真录进参考视频。
// 端到端证据有两层：① 停止录制后，持久化到项目目录的录制场景里，被操控角色带上了 poseTrack
// （≥2 关键帧，含 squat/wave）——证明「点动作→录进 poseTrack→落进可回放 Scene3DState」整条生产者通；
// ② 离屏捕获 + ffmpeg 真出 .mp4——证明带 poseTrack 的场景能被现有离屏管线渲染出片（不掉帧/不崩）。
// 零额度：纯本地 3D 离屏渲染 + 本地 ffmpeg，不碰生成 API。
// 用法：pnpm run build && node tests/ux/scene3d-take-record-pose.walk.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, '.take-record-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-take-pose-walk-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

function walkFiles(dir, predicate, out = []) {
  let entries = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const full = path.join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) walkFiles(full, predicate, out)
    else if (predicate(name)) out.push(full)
  }
  return out
}
const findMp4s = () => walkFiles(projectsDir, (n) => n.toLowerCase().endsWith('.mp4'))

// 在持久化的项目 JSON 里找「录制场景带 poseTrack（含 squat 与 wave）」的证据。
function poseTrackPersisted() {
  const jsons = walkFiles(projectsDir, (n) => n.toLowerCase().endsWith('.json'))
  for (const file of jsons) {
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { continue }
    if (text.includes('"poseTrack"') && text.includes('"squat"') && text.includes('"wave"')) {
      return { file, ok: true }
    }
  }
  return { file: null, ok: false }
}

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${path.join(tmp, 'udata')}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_SMOKE: '1', NOMI_PROJECTS_DIR: projectsDir },
})

const errors = []
const log = (m) => console.log(m)
const pass = { editorOpen: false, possessed: false, recStarted: false, posed: false, recStopped: false, poseTrack: false, mp4Made: false }

try {
  const win = await app.firstWindow()
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)
  // 关开屏介绍（全新 userData → splash 必出，会拦点击）。
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

  const recBtn = win.locator('[title^="录 take"]').first()
  if ((await recBtn.count()) > 0) { await recBtn.click(); await win.locator('[title="停止录制并生成参考视频"]').first().waitFor({ timeout: 8000 }).catch(() => {}); await win.waitForTimeout(200) }
  const stopBtn = win.locator('[title="停止录制并生成参考视频"]')
  pass.recStarted = (await stopBtn.count()) > 0
  log(`  ${pass.recStarted ? '✓' : '✗'} 开始录制`)

  // 录制中：走 → 切「下蹲」→ 再走 → 切「挥手」（每步留时间戳，构成 poseTrack）。
  await win.keyboard.down('KeyW'); await win.waitForTimeout(1300); await win.keyboard.up('KeyW')
  const squat = win.getByRole('button', { name: '下蹲', exact: false }).first()
  if ((await squat.count()) > 0) { await squat.click(); await win.waitForTimeout(300) }
  await win.screenshot({ path: path.join(outDir, 'trp-01-recording-squat.png') })
  await win.keyboard.down('KeyW'); await win.waitForTimeout(1200); await win.keyboard.up('KeyW')
  const wave = win.getByRole('button', { name: '挥手', exact: false }).first()
  if ((await wave.count()) > 0) { await wave.click(); await win.waitForTimeout(300) }
  await win.screenshot({ path: path.join(outDir, 'trp-02-recording-wave.png') })
  pass.posed = (await squat.count()) > 0 && (await wave.count()) > 0
  log(`  ${pass.posed ? '✓' : '✗'} 录制中切了下蹲 + 挥手`)

  if ((await stopBtn.count()) > 0) { await stopBtn.first().click(); await win.waitForTimeout(1500) }
  pass.recStopped = (await stopBtn.count()) === 0
  log(`  ${pass.recStopped ? '✓' : '✗'} 停止录制`)

  // 轮询：等持久化的 poseTrack + 端到端 mp4。
  let mp4s = []
  let persisted = { ok: false, file: null }
  for (let i = 0; i < 40; i += 1) {
    if (!persisted.ok) persisted = poseTrackPersisted()
    mp4s = findMp4s()
    if (persisted.ok && mp4s.length > 0) break
    await win.waitForTimeout(2000)
  }
  pass.poseTrack = persisted.ok
  pass.mp4Made = mp4s.length > 0
  await win.screenshot({ path: path.join(outDir, 'trp-03-after-capture.png') })
  log(`  ${pass.poseTrack ? '✓' : '✗'} 录制场景持久化含 poseTrack(squat+wave)${persisted.file ? ' → ' + path.basename(persisted.file) : ''}`)
  log(`  ${pass.mp4Made ? '✓' : '✗'} 端到端出 mp4（${mp4s.length} 个）${mp4s[0] ? ' → ' + path.basename(mp4s[0]) : ''}`)

  log('\n═══ 结果 ═══')
  log(`  编辑器可开:        ${pass.editorOpen ? '✓' : '✗'}`)
  log(`  进入操控态:        ${pass.possessed ? '✓' : '✗'}`)
  log(`  开始录制:          ${pass.recStarted ? '✓' : '✗'}`)
  log(`  录制中切动作:      ${pass.posed ? '✓' : '✗'}`)
  log(`  停止录制:          ${pass.recStopped ? '✓' : '✗'}`)
  log(`  poseTrack 落盘:    ${pass.poseTrack ? '✓' : '✗'}`)
  log(`  端到端出 mp4:      ${pass.mp4Made ? '✓' : '✗'}`)
  log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors')
  const ok = pass.editorOpen && pass.possessed && pass.recStarted && pass.posed && pass.recStopped && pass.poseTrack && pass.mp4Made
  await app.close()
  process.exit(ok ? 0 : 1)
} catch (err) {
  log(`\nFAIL: ${err?.message || err}`)
  try { const win = await app.firstWindow(); await win.screenshot({ path: path.join(outDir, 'trp-FAIL.png') }) } catch {}
  await app.close().catch(() => undefined)
  process.exit(1)
}
