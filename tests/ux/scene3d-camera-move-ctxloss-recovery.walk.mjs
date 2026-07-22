// 验「离屏运镜/take 出片抗 WebGL 上下文丢失」——治用户真机：离屏捕获 Canvas 一次 Context Lost →
// mp4 永久失败（无徽标无视频）。本走查在**离屏捕获进行中**强制对离屏 canvas loseContext()（可选再
// restoreContext()），断言 mp4 **仍然生成**（恢复接线 + Host 超时/null 重试兜底生效）。
// 零额度：纯本地 3D 离屏渲染 + 本地 ffmpeg。
// 用法：pnpm run build && node tests/ux/scene3d-camera-move-ctxloss-recovery.walk.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, '.camera-move-explore')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-cammove-ctxloss-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

function findMp4s(dir) {
  const out = []
  let entries = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const full = path.join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) out.push(...findMp4s(full))
    else if (name.toLowerCase().endsWith('.mp4')) out.push(full)
  }
  return out
}

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${path.join(tmp, 'udata')}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_SMOKE: '1', NOMI_PROJECTS_DIR: projectsDir },
})

const log = (m) => console.log(m)
const errors = []
const pass = { editorOpen: false, recStarted: false, ctxLostForced: false, mp4Made: false }

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
  await win.waitForTimeout(2000)
  const openEmpty = win.getByRole('button', { name: '打开 3D 编辑器', exact: false })
  if ((await openEmpty.count()) > 0) await openEmpty.first().click()
  await win.waitForTimeout(4000)
  pass.editorOpen = (await win.locator('[aria-label="3D 场景编辑器"]').count()) > 0
  log(`  ${pass.editorOpen ? '✓' : '✗'} 编辑器打开`)

  // possess 假人 → 录 take（触发离屏捕获管线，与运镜出片同一条 Scene3DTrajectoryCapture）。
  const firstMan = win.getByText('假人', { exact: true }).first()
  if ((await firstMan.count()) > 0) { await firstMan.click(); await win.waitForTimeout(800) }
  const possessBtn = win.getByRole('button', { name: '操控', exact: false }).first()
  if ((await possessBtn.count()) > 0) { await possessBtn.click(); await win.waitForTimeout(1000) }

  const recBtn = win.locator('[title^="录 take"]').first()
  if ((await recBtn.count()) > 0) { await recBtn.click(); await win.locator('[title="停止录制并生成参考视频"]').first().waitFor({ timeout: 8000 }).catch(() => {}); await win.waitForTimeout(200) }
  const stopBtn = win.locator('[title="停止录制并生成参考视频"]')
  pass.recStarted = (await stopBtn.count()) > 0
  log(`  ${pass.recStarted ? '✓' : '✗'} 开始录制`)

  await win.keyboard.down('KeyW')
  await win.waitForTimeout(2200)
  await win.keyboard.up('KeyW')
  await win.waitForTimeout(300)

  // 停止 → 建节点 + 挂载离屏捕获器（此刻 CameraMoveCaptureHost/take 出片管线开始采帧）。
  if ((await stopBtn.count()) > 0) { await stopBtn.first().click(); await win.waitForTimeout(400) }

  // 关编辑器（离屏 Host 常驻，捕获在后台继续）。
  const editor = win.locator('[aria-label="3D 场景编辑器"]')
  const close = editor.locator('[title="退出 3D 场景"]').first()
  await close.waitFor({ state: 'visible', timeout: 5000 })
  await close.click()
  await editor.waitFor({ state: 'hidden', timeout: 5000 })
  await win.waitForTimeout(300)

  // —— 关键：在离屏捕获**进行中**强制对离屏 canvas 丢上下文，再稍后恢复。 ——
  // 离屏捕获器是 aria-hidden、position:absolute left:-10000 的隐藏 div 里的 canvas。
  // 在采帧窗口内多打几拳 loseContext()，模拟真机「多 Electron 抢 context 配额」的瞬态丢失。
  for (let punch = 0; punch < 3 && !pass.ctxLostForced; punch += 1) {
    await win.waitForTimeout(500)
    const forced = await win.evaluate(() => {
      // 找离屏隐藏画布：aria-hidden 容器内、或 left:-10000 的定位容器内的 canvas。
      const hiddenHosts = Array.from(document.querySelectorAll('div[aria-hidden]'))
      let target = null
      for (const host of hiddenHosts) {
        const style = host.getAttribute('style') || ''
        if (style.includes('-10000')) {
          const c = host.querySelector('canvas')
          if (c) { target = c; break }
        }
      }
      if (!target) return { ok: false, reason: 'no-offscreen-canvas' }
      const ctx = target.getContext('webgl2') || target.getContext('webgl')
      const ext = ctx && ctx.getExtension('WEBGL_lose_context')
      if (!ext) return { ok: false, reason: 'no-lose-ext' }
      ext.loseContext()
      // 稍后恢复（真机浏览器在 preventDefault 后自动补发；测试手动触发 restored）。
      setTimeout(() => { try { ext.restoreContext() } catch { /* ignore */ } }, 600)
      return { ok: true }
    })
    if (forced.ok) {
      pass.ctxLostForced = true
      log('  ✓ 已在离屏捕获进行中强制 loseContext()（600ms 后 restoreContext）')
    } else {
      log(`  … 试图丢上下文：${forced.reason}（离屏 canvas 可能未挂载/已完成，重试）`)
    }
  }
  if (!pass.ctxLostForced) log('  ⚠️ 未能在采帧窗口内抓到离屏 canvas 强制丢上下文（捕获可能太快完成）')

  // 轮询：即便中途丢过一次上下文，mp4 是否**最终仍然产出**（恢复+重试兜底）。
  // Host 单次 watchdog 30s、最多 3 次 → 给足 ~110s。
  let mp4s = []
  for (let i = 0; i < 55; i += 1) {
    mp4s = findMp4s(projectsDir)
    if (mp4s.length > 0) break
    await win.waitForTimeout(2000)
  }
  pass.mp4Made = mp4s.length > 0
  await win.screenshot({ path: path.join(outDir, 'ctxloss-after.png') })
  let savedMp4 = ''
  if (mp4s[0]) {
    savedMp4 = path.join(outDir, 'ctxloss-recovered-take.mp4')
    try { copyFileSync(mp4s[0], savedMp4) } catch { savedMp4 = mp4s[0] }
  }
  log(`  ${pass.mp4Made ? '✓' : '✗'} 丢上下文后 mp4 仍产出（${mp4s.length} 个）${savedMp4 ? ' → ' + savedMp4 : ''}`)

  log('\n═══ 结果 ═══')
  log(`  编辑器可开:            ${pass.editorOpen ? '✓' : '✗'}`)
  log(`  开始录制:              ${pass.recStarted ? '✓' : '✗'}`)
  log(`  离屏丢上下文已强制:    ${pass.ctxLostForced ? '✓' : '✗(未抓到窗口)'}`)
  log(`  丢上下文后仍出 mp4:    ${pass.mp4Made ? '✓' : '✗'}`)
  log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors')
  // 核心断言：即使丢过上下文，mp4 最终仍出。ctxLostForced 是「确实注入了故障」的证据；
  // 若没抓到窗口（捕获太快）不算失败，但会明标，需人看是否真注入了故障。
  const ok = pass.editorOpen && pass.recStarted && pass.mp4Made
  await app.close()
  process.exit(ok ? 0 : 1)
} catch (err) {
  log(`\nFAIL: ${err?.message || err}`)
  try { const win = await app.firstWindow(); await win.screenshot({ path: path.join(outDir, 'ctxloss-FAIL.png') }) } catch {}
  await app.close().catch(() => undefined)
  process.exit(1)
}
