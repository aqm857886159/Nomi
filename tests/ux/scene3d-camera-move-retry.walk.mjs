// 验「离屏出片失败重试兜底」——确定性故障注入：强制离屏捕获**第 1 次尝试失败**
// （localStorage['__nomiForceCameraMoveFail']=1，模拟上下文丢失导致的空结果），断言 mp4
// 仍**最终产出**（说明 Host 真的重挂捕获器重来、并在第 2 次成功出片）。
// 这条比「注入上下文丢失」更硬地证明了重试逻辑会重来出片（上下文丢失的时序不可靠时的兜底证明）。
// 零额度：纯本地渲染 + ffmpeg。生产从不置该标志 → coerceOutcomeForE2E 恒 no-op。
// 用法：pnpm run build && node tests/ux/scene3d-camera-move-retry.walk.mjs
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
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-cammove-retry-'))
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
const pass = { editorOpen: false, recStarted: false, mp4Made: false }

try {
  const win = await app.firstWindow()
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForLoadState('domcontentloaded')
  // 尽早置故障注入标志：强制第 1 次离屏捕获尝试失败。
  await win.evaluate(() => { try { window.localStorage.setItem('__nomiForceCameraMoveFail', '1') } catch {} })
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

  const firstMan = win.getByText('假人', { exact: true }).first()
  if ((await firstMan.count()) > 0) { await firstMan.click(); await win.waitForTimeout(800) }
  const possessBtn = win.getByRole('button', { name: '操控', exact: false }).first()
  if ((await possessBtn.count()) > 0) { await possessBtn.click(); await win.waitForTimeout(1000) }

  const recBtn = win.locator('[title^="录 take"]').first()
  if ((await recBtn.count()) > 0) { await recBtn.click(); await win.locator('[title="停止录制并生成参考视频"]').first().waitFor({ timeout: 8000 }).catch(() => {}); await win.waitForTimeout(200) }
  const stopBtn = win.locator('[title="停止录制并生成参考视频"]')
  pass.recStarted = (await stopBtn.count()) > 0
  log(`  ${pass.recStarted ? '✓' : '✗'} 开始录制（故障注入：第 1 次捕获强制失败）`)

  await win.keyboard.down('KeyW')
  await win.waitForTimeout(2200)
  await win.keyboard.up('KeyW')
  await win.waitForTimeout(300)
  if ((await stopBtn.count()) > 0) { await stopBtn.first().click(); await win.waitForTimeout(400) }
  const editor = win.locator('[aria-label="3D 场景编辑器"]')
  const close = editor.locator('[title="退出 3D 场景"]').first()
  await close.waitFor({ state: 'visible', timeout: 5000 })
  await close.click()
  await editor.waitFor({ state: 'hidden', timeout: 5000 })

  // 轮询：第 1 次被强制判失败后，重试兜底应在 ~800ms 后重挂捕获器、第 2 次真出片。给足 ~110s。
  let mp4s = []
  for (let i = 0; i < 55; i += 1) {
    mp4s = findMp4s(projectsDir)
    if (mp4s.length > 0) break
    await win.waitForTimeout(2000)
  }
  pass.mp4Made = mp4s.length > 0
  await win.screenshot({ path: path.join(outDir, 'retry-after.png') })
  let savedMp4 = ''
  if (mp4s[0]) {
    savedMp4 = path.join(outDir, 'retry-recovered-take.mp4')
    try { copyFileSync(mp4s[0], savedMp4) } catch { savedMp4 = mp4s[0] }
  }
  log(`  ${pass.mp4Made ? '✓' : '✗'} 第 1 次强制失败后，重试仍出 mp4（${mp4s.length} 个）${savedMp4 ? ' → ' + savedMp4 : ''}`)

  log('\n═══ 结果 ═══')
  log(`  编辑器可开:              ${pass.editorOpen ? '✓' : '✗'}`)
  log(`  开始录制:                ${pass.recStarted ? '✓' : '✗'}`)
  log(`  首次失败后重试出 mp4:    ${pass.mp4Made ? '✓' : '✗'}`)
  log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors')
  const ok = pass.editorOpen && pass.recStarted && pass.mp4Made
  await app.close()
  process.exit(ok ? 0 : 1)
} catch (err) {
  log(`\nFAIL: ${err?.message || err}`)
  try { const win = await app.firstWindow(); await win.screenshot({ path: path.join(outDir, 'retry-FAIL.png') }) } catch {}
  await app.close().catch(() => undefined)
  process.exit(1)
}
