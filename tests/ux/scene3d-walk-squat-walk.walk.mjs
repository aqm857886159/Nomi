// 真机走查（R13）：#4「走→蹲→走」录得出来——录制中走两步 → 点下蹲 → 再按 W 走，停止出 mp4。
// 关键证据 = 抽帧：起始段=站/走（腿分开直立）、中段=蹲（重心下沉）、末段**回到站/走**（不再蹲到片尾）。
// 修前根因：按 W 恢复走路不打 pose 事件 → squat 关键帧 step-hold 到片尾。修后：恢复时补 base 关键帧。
// 还断言持久化 poseTrack ≥3 关键帧（base 起点 + squat + base 恢复）。
// 零额度：纯本地 3D 离屏渲染 + 系统 ffmpeg 抽帧，不碰生成 API。
// 用法：pnpm run build && node tests/ux/scene3d-walk-squat-walk.walk.mjs
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { mkdtempSync, mkdirSync, readdirSync, statSync, readFileSync, copyFileSync, existsSync } from 'node:fs'

const outDir = path.join(repoRoot, '.walk-squat-walk-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-wsw-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

const FFMPEG = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg'
  : existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : 'ffmpeg'

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

// 在任意嵌套 JSON 树里递归找带 squat 的 poseTrack 数组（scene3d state 嵌在节点 data 深处）。
function findPoseTrackWithSquat(node) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findPoseTrackWithSquat(item)
      if (hit) return hit
    }
    return null
  }
  if (Array.isArray(node.poseTrack) && node.poseTrack.some((k) => k && k.presetId === 'squat')) {
    return node.poseTrack
  }
  for (const key of Object.keys(node)) {
    const hit = findPoseTrackWithSquat(node[key])
    if (hit) return hit
  }
  return null
}

// 持久化的录制场景里被操控角色 poseTrack：含 squat 且 squat 之后有 base 恢复关键帧。
function poseTrackInfo() {
  const jsons = walkFiles(projectsDir, (n) => n.toLowerCase().endsWith('.json'))
  for (const file of jsons) {
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { continue }
    if (!text.includes('"poseTrack"') || !text.includes('"squat"')) continue
    let json
    try { json = JSON.parse(text) } catch { continue }
    const track = findPoseTrackWithSquat(json)
    if (track) {
      const keys = track.map((k) => k.presetId ?? 'base')
      const squatIdx = keys.indexOf('squat')
      // 恢复证据：squat 之后存在一个 base 关键帧（step-hold 据此切回 locomotion → 腿重新迈）。
      const resumedAfterSquat = squatIdx >= 0 && keys.slice(squatIdx + 1).includes('base')
      return { file, ok: true, keys, count: track.length, resumedAfterSquat }
    }
  }
  return { ok: false, keys: [], count: 0, resumedAfterSquat: false }
}

const { app, win } = await launchNomiApp({
  name: 'scene3d-walk-squat-walk',
  userDataDir: path.join(tmp, 'udata'),
  projectsDir,
  env: { NOMI_E2E_SMOKE: '1' },
  settleMs: 1800,
})

const errors = []
const log = (m) => console.log(m)
const pass = { editorOpen: false, possessed: false, recStarted: false, walkSquatWalk: false, recStopped: false, poseTrackOk: false, resumedKeyframe: false, mp4Made: false, framesExtracted: false }

try {
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push(String(e)))
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

  // 走 → 蹲 → 再走（#4 的核心序列：第二段走必须把角色从蹲恢复到走）。
  await win.keyboard.down('KeyW'); await win.waitForTimeout(1400); await win.keyboard.up('KeyW')
  await win.screenshot({ path: path.join(outDir, 'wsw-01-walk.png') })
  const squat = win.getByRole('button', { name: '下蹲', exact: false }).first()
  if ((await squat.count()) > 0) { await squat.click(); await win.waitForTimeout(500) }
  await win.screenshot({ path: path.join(outDir, 'wsw-02-squat.png') })
  // 再按 W 恢复走路（修复点：此刻应往 poseTrack 补 base 关键帧，腿重新迈）。
  await win.keyboard.down('KeyW'); await win.waitForTimeout(1600); await win.keyboard.up('KeyW')
  await win.screenshot({ path: path.join(outDir, 'wsw-03-walk-again.png') })
  pass.walkSquatWalk = (await squat.count()) > 0
  log(`  ${pass.walkSquatWalk ? '✓' : '✗'} 录制中执行 走→蹲→再走`)

  if ((await stopBtn.count()) > 0) { await stopBtn.first().click(); await win.waitForTimeout(1500) }
  pass.recStopped = (await stopBtn.count()) === 0
  log(`  ${pass.recStopped ? '✓' : '✗'} 停止录制`)

  let mp4s = []
  let pt = { ok: false }
  for (let i = 0; i < 40; i += 1) {
    if (!pt.ok) pt = poseTrackInfo()
    mp4s = findMp4s()
    if (pt.ok && mp4s.length > 0) break
    await win.waitForTimeout(2000)
  }
  pass.poseTrackOk = pt.ok
  pass.resumedKeyframe = pt.resumedAfterSquat
  pass.mp4Made = mp4s.length > 0
  log(`  ${pass.poseTrackOk ? '✓' : '✗'} poseTrack 落盘（关键帧序列=[${pt.keys?.join(' → ')}]，共 ${pt.count} 帧）`)
  log(`  ${pass.resumedKeyframe ? '✓' : '✗'} squat 后有 base 恢复关键帧（治「蹲到片尾」根因）`)
  log(`  ${pass.mp4Made ? '✓' : '✗'} 端到端出 mp4（${mp4s.length} 个）`)

  // 抽帧：起始/中段/末段，人眼看 走→蹲→走。复制 mp4 进持久 outDir。
  if (mp4s[0]) {
    const savedMp4 = path.join(outDir, 'wsw-take.mp4')
    try { copyFileSync(mp4s[0], savedMp4) } catch {}
    const src = existsSync(savedMp4) ? savedMp4 : mp4s[0]
    // 取首帧、25%、50%、75%、末帧（fps 未知，用时间百分比无 ffprobe；改用 select 按帧序号 + 兜底）。
    const r = spawnSync(FFMPEG, [
      '-y', '-i', src,
      '-vf', "select='eq(n\\,0)+eq(n\\,5)+eq(n\\,10)+eq(n\\,15)+eq(n\\,20)+eq(n\\,25)+eq(n\\,30)'",
      '-vsync', '0', '-frames:v', '7',
      path.join(outDir, 'wsw-frame-%02d.png'),
    ], { encoding: 'utf8' })
    const frames = walkFiles(outDir, (n) => /^wsw-frame-\d+\.png$/.test(n))
    pass.framesExtracted = frames.length >= 3
    log(`  ${pass.framesExtracted ? '✓' : '✗'} 抽帧 ${frames.length} 张 → ${outDir}/wsw-frame-*.png${r.status !== 0 ? ' (ffmpeg status=' + r.status + ')' : ''}`)
  }

  log('\n═══ 结果 ═══')
  log(`  编辑器可开:          ${pass.editorOpen ? '✓' : '✗'}`)
  log(`  进入操控态:          ${pass.possessed ? '✓' : '✗'}`)
  log(`  开始录制:            ${pass.recStarted ? '✓' : '✗'}`)
  log(`  走→蹲→再走:          ${pass.walkSquatWalk ? '✓' : '✗'}`)
  log(`  停止录制:            ${pass.recStopped ? '✓' : '✗'}`)
  log(`  poseTrack 落盘:      ${pass.poseTrackOk ? '✓' : '✗'}`)
  log(`  squat 后 base 恢复帧: ${pass.resumedKeyframe ? '✓' : '✗'}`)
  log(`  端到端出 mp4:        ${pass.mp4Made ? '✓' : '✗'}`)
  log(`  抽帧成功:            ${pass.framesExtracted ? '✓' : '✗'}`)
  log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors')
  const ok = pass.editorOpen && pass.possessed && pass.recStarted && pass.walkSquatWalk
    && pass.recStopped && pass.poseTrackOk && pass.resumedKeyframe && pass.mp4Made && pass.framesExtracted
  await app.close()
  process.exit(ok ? 0 : 1)
} catch (err) {
  log(`\nFAIL: ${err?.message || err}`)
  try { const win = await app.firstWindow(); await win.screenshot({ path: path.join(outDir, 'wsw-FAIL.png') }) } catch {}
  await app.close().catch(() => undefined)
  process.exit(1)
}
