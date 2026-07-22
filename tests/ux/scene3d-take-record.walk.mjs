// 真机走查（R13）：S2「录 take」端到端——possess 角色 → 录制走位 → 停止 →
// 现有离屏捕获管线出 mp4。最硬证据 = 隔离项目目录里真生成出 .mp4 文件。
// 零额度：纯本地 3D 离屏渲染 + 本地 ffmpeg，不碰生成 API。
// 用法：pnpm run build && node tests/ux/scene3d-take-record.walk.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, '.take-record-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-take-walk-'))
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
  // NOMI_E2E=1 关 COOP/COEP（否则 Playwright launch timeout，见 electron/main.ts:661）。
  env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_SMOKE: '1', NOMI_PROJECTS_DIR: projectsDir },
})

const errors = []
const log = (m) => console.log(m)
const pass = {
  editorOpen: false,
  possessed: false,
  recStarted: false,
  recStopped: false,
  takeNode: false,
  mp4Made: false,
  videoVisible: false,
  completedBadgeRemoved: false,
  editorEntryVisible: false,
}

async function closeApp() {
  const process = app.process()
  await Promise.race([
    app.close().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ])
  if (process.exitCode === null) process.kill('SIGKILL')
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

  // 首次进入会出现三步 coach marks；本旅程测试录制，不让 onboarding 遮罩拦住假人行。
  const coachSkip = win.getByRole('button', { name: '跳过', exact: true }).first()
  if ((await coachSkip.count()) > 0) {
    await coachSkip.click()
    await win.waitForTimeout(500)
  }

  // possess 假人
  const firstMan = win.getByText('假人', { exact: true }).first()
  if ((await firstMan.count()) > 0) { await firstMan.click(); await win.waitForTimeout(800) }
  const possessBtn = win.getByRole('button', { name: '操控', exact: false }).first()
  if ((await possessBtn.count()) > 0) { await possessBtn.click(); await win.waitForTimeout(1000) }
  pass.possessed = (await win.locator('[aria-label="角色操控动作库"]').count()) > 0
  log(`  ${pass.possessed ? '✓' : '✗'} 进入操控态`)

  // 点「录 take」开始
  const recBtn = win.locator('[title^="录 take"]').first()
  const recCount = await recBtn.count()
  if (recCount > 0) { await recBtn.click(); await win.locator('[title="停止录制并生成参考视频"]').first().waitFor({ timeout: 8000 }).catch(() => {}); await win.waitForTimeout(200) }
  // 录制态出现「停止」按钮（title 停止录制并生成参考视频）
  const stopBtn = win.locator('[title="停止录制并生成参考视频"]')
  pass.recStarted = (await stopBtn.count()) > 0
  log(`  ${pass.recStarted ? '✓' : '✗'} 开始录制（录 take 钮 count=${recCount}，停止钮出现=${pass.recStarted}）`)

  // 按住 W 走一段
  await win.keyboard.down('KeyW')
  await win.waitForTimeout(2600)
  await win.keyboard.up('KeyW')
  await win.waitForTimeout(400)
  await win.screenshot({ path: path.join(outDir, 'tr-01-recording.png') })

  // 停止 → 触发建节点 + 离屏捕获
  if ((await stopBtn.count()) > 0) { await stopBtn.first().click(); await win.waitForTimeout(1200) }
  pass.recStopped = (await stopBtn.count()) === 0
  log(`  ${pass.recStopped ? '✓' : '✗'} 停止录制`)

  // 关编辑器看画布
  const editor = win.locator('[aria-label="3D 场景编辑器"]')
  const close = editor.locator('[title="退出 3D 场景"]').first()
  await close.waitFor({ state: 'visible', timeout: 5000 })
  await close.click()
  await editor.waitFor({ state: 'hidden', timeout: 5000 })
  // #1 修复后：take 节点继承 source 分类 → 与原节点同屏；关编辑器后 requestCanvasFit（360ms 触发 + 200ms 动画）
  // 把它带进视口。等够时间让 fit 落定再截图/检查（之前 1500ms 偏紧，拉到 2600ms 更稳）。
  await win.waitForTimeout(2600)
  // #1 真证据：take 节点继承 source 分类后，真渲染进画布视口（同分类才进 visibleNodesForRender→才有 DOM）。
  // 节点标题不画在卡面上（scene3d 卡面是 3D 编辑器入口，与 source 节点一致），所以不能按标题文本判命中。
  // 改判两件真实可见证据：① 画布上 scene3d 卡片外壳 ≥2（原节点 + take 节点都在当前分类同屏）；
  // ② take 节点底部状态徽标「参考视频生成中…/已生成 ✓」出现（出片态接力，见 Scene3DEditor）。
  const shellCount = await win.evaluate(() =>
    document.querySelectorAll('[class*="generation-canvas-v2-node"]').length)
  const badgeVisible = await win.evaluate(() =>
    document.body.innerText.includes('参考视频生成中') || document.body.innerText.includes('参考视频已生成'))
  pass.takeNode = shellCount >= 2 || badgeVisible
  await win.screenshot({ path: path.join(outDir, 'tr-02-canvas-take-node.png') })
  log(`  ${pass.takeNode ? '✓' : '✗'} take 节点进画布视口（卡片外壳=${shellCount}，状态徽标可见=${badgeVisible}）`)

  // 轮询临时项目目录，等离屏捕获 + ffmpeg 出 mp4（最多 ~70s）
  let mp4s = []
  for (let i = 0; i < 35; i += 1) {
    mp4s = findMp4s(projectsDir)
    if (mp4s.length > 0) break
    await win.waitForTimeout(2000)
  }
  pass.mp4Made = mp4s.length > 0
  const takeVideo = win.locator('[data-scene3d-take-video="true"]').first()
  await takeVideo.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  pass.videoVisible = (await takeVideo.count()) > 0 && await takeVideo.isVisible().catch(() => false)
  if (pass.videoVisible) {
    pass.videoVisible = await takeVideo.evaluate((video) => video instanceof HTMLVideoElement && video.controls)
    const takeCard = takeVideo.locator('xpath=ancestor::*[@data-node-id][1]')
    pass.editorEntryVisible = (await takeCard.getByRole('button', { name: '打开 3D 编辑器', exact: false }).count()) > 0
  }
  pass.completedBadgeRemoved = (await win.getByText('参考视频已生成', { exact: false }).count()) === 0
  await win.screenshot({ path: path.join(outDir, 'tr-03-after-capture.png') })
  // 把出的 mp4 拷进持久 outDir（临时 projectsDir 跑完即清），方便用户抽帧看腿。
  let savedMp4 = ''
  if (mp4s[0]) {
    savedMp4 = path.join(outDir, 'tr-walk-take.mp4')
    try { copyFileSync(mp4s[0], savedMp4) } catch { savedMp4 = mp4s[0] }
  }
  log(`  ${pass.mp4Made ? '✓' : '✗'} 生成 mp4（${mp4s.length} 个）${savedMp4 ? ' → ' + savedMp4 : ''}`)
  log(`  ${pass.videoVisible ? '✓' : '✗'} take 卡内显示可播放视频`)
  log(`  ${pass.completedBadgeRemoved ? '✓' : '✗'} 完成横条已由视频结果取代`)
  log(`  ${pass.editorEntryVisible ? '✓' : '✗'} 视频态保留 3D 编辑器入口`)

  log('\n═══ 结果 ═══')
  log(`  编辑器可开:      ${pass.editorOpen ? '✓' : '✗'}`)
  log(`  进入操控态:      ${pass.possessed ? '✓' : '✗'}`)
  log(`  开始录制:        ${pass.recStarted ? '✓' : '✗'}`)
  log(`  停止录制:        ${pass.recStopped ? '✓' : '✗'}`)
  log(`  建 take 节点:    ${pass.takeNode ? '✓' : '✗'}`)
  log(`  端到端出 mp4:    ${pass.mp4Made ? '✓' : '✗'}`)
  log(`  卡内视频可播:    ${pass.videoVisible ? '✓' : '✗'}`)
  log(`  完成横条已删除:  ${pass.completedBadgeRemoved ? '✓' : '✗'}`)
  log(`  3D 入口保留:     ${pass.editorEntryVisible ? '✓' : '✗'}`)
  log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors')
  // #1 修复后 takeNode 也是硬证据（同分类必渲染）；mp4Made 是离屏端到端真证据。
  const ok = Object.values(pass).every(Boolean)
  await closeApp()
  process.exit(ok ? 0 : 1)
} catch (err) {
  log(`\nFAIL: ${err?.message || err}`)
  try { const win = await app.firstWindow(); await win.screenshot({ path: path.join(outDir, 'tr-FAIL.png') }) } catch {}
  await closeApp()
  process.exit(1)
}
