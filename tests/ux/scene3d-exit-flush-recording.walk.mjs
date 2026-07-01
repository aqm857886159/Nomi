// 真机走查（R13，#A）：退出操控（不点「停止录制」，直接点「退出操控」）必须先 flush 出片，不能丢录制。
// 根因回顾：useScene3DTakeRecorder 里「possessTarget 变 null → 静默清空 isRecording」的 effect 抢跑在
// stopRecording 之前，录了的这段直接消失。治本 = exitPossess 本身先调 stopRecording（ref 转发接线），
// 这里验的就是这条链路：possess → 录 take → 直接点「退出操控」（不点「停止录制」）→ 出片。
// 证据两层：① 持久化项目 JSON 里出现「录制走位参考」take 节点，带非退化的走位轨迹（≥2 点，证明真录到了移动）；
// ② 端到端 mp4 落盘（证明整条离屏出片管线走通，不是空节点）。
// 零额度：纯本地 3D 离屏渲染 + 本地 ffmpeg。
// 用法：pnpm run build && node tests/ux/scene3d-exit-flush-recording.walk.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, '.scene3d-exit-flush-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-exit-flush-walk-'))
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

// 在持久化的项目 JSON 里找「录制走位参考」take 节点 + 非退化走位轨迹（≥2 点）。
function takeNodePersisted() {
  const jsons = walkFiles(projectsDir, (n) => n.toLowerCase().endsWith('.json'))
  for (const file of jsons) {
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { continue }
    if (!text.includes('录制走位参考')) continue
    let data
    try { data = JSON.parse(text) } catch { continue }
    // 项目持久化真实形状：{ payload: { generationCanvas: { nodes: [...] } } }（见 project.json）。
    const nodes = data?.payload?.generationCanvas?.nodes || data?.nodes || data?.state?.nodes || []
    for (const node of nodes) {
      if (node?.title !== '录制走位参考') continue
      const state = node?.meta?.scene3dState
      const trajectory = state?.trajectories?.find((t) => typeof t?.name === 'string' && t.name.includes('走位'))
      const points = trajectory?.points ?? []
      if (points.length >= 2) return { file, ok: true, pointCount: points.length }
    }
  }
  return { file: null, ok: false, pointCount: 0 }
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
  editorOpen: false, possessed: false, recStarted: false, movedWhileRecording: false,
  exitedNotStopped: false, exitedUI: false, takePersisted: false, mp4Made: false,
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

  await win.screenshot({ path: path.join(outDir, 'ef-01-possessed.png') })

  const recBtn = win.locator('[title^="录 take"]').first()
  if ((await recBtn.count()) > 0) { await recBtn.click(); await win.waitForTimeout(400) }
  const stopBtn = win.locator('[aria-label="角色操控动作库"] [title="停止录制并生成参考视频"]')
  pass.recStarted = (await stopBtn.count()) > 0
  log(`  ${pass.recStarted ? '✓' : '✗'} 开始录制`)

  // 录制中走一段（制造非退化轨迹），然后——关键：不点「停止录制」，直接点「退出操控」。
  await win.keyboard.down('KeyW')
  await win.waitForTimeout(1200)
  await win.keyboard.up('KeyW')
  await win.waitForTimeout(150)
  await win.screenshot({ path: path.join(outDir, 'ef-02-recording-after-walk.png') })
  pass.movedWhileRecording = pass.recStarted // 走了 1.2s，视为已产生位移（后续持久化校验会验证真非退化）

  const exitBtn = win.locator('[aria-label="角色操控动作库"] [title="退出操控"]').first()
  const stopStillThere = (await stopBtn.count()) > 0
  log(`  录制仍在进行(未点停止): ${stopStillThere ? '✓' : '✗'}`)
  pass.exitedNotStopped = stopStillThere
  if ((await exitBtn.count()) > 0) { await exitBtn.click(); await win.waitForTimeout(1200) }

  pass.exitedUI = (await win.locator('[aria-label="角色操控动作库"]').count()) === 0
  log(`  ${pass.exitedUI ? '✓' : '✗'} 退出操控后 UI 回到编排态（动作库消失）`)
  await win.screenshot({ path: path.join(outDir, 'ef-03-after-exit.png') })

  // 轮询：持久化的 take 节点 + 端到端 mp4。
  let persisted = { ok: false, file: null, pointCount: 0 }
  let mp4s = []
  for (let i = 0; i < 40; i += 1) {
    if (!persisted.ok) persisted = takeNodePersisted()
    mp4s = findMp4s()
    if (persisted.ok && mp4s.length > 0) break
    await win.waitForTimeout(2000)
  }
  pass.takePersisted = persisted.ok
  pass.mp4Made = mp4s.length > 0
  log(`  ${pass.takePersisted ? '✓' : '✗'} 退出后仍生成「录制走位参考」take 节点（${persisted.pointCount} 个轨迹点）${persisted.file ? ' → ' + path.basename(persisted.file) : ''}`)
  log(`  ${pass.mp4Made ? '✓' : '✗'} 端到端出 mp4（${mp4s.length} 个）${mp4s[0] ? ' → ' + path.basename(mp4s[0]) : ''}`)
  await win.screenshot({ path: path.join(outDir, 'ef-04-final.png') })

  log('\n═══ 结果 ═══')
  for (const [k, v] of Object.entries(pass)) log(`  ${k.padEnd(22)}: ${v ? '✓' : '✗'}`)
  log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors')
  const ok = Object.values(pass).every(Boolean)
  await app.close()
  process.exit(ok ? 0 : 1)
} catch (err) {
  log(`\nFAIL: ${err?.message || err}`)
  try { const win = await app.firstWindow(); await win.screenshot({ path: path.join(outDir, 'ef-FAIL.png') }) } catch {}
  await app.close().catch(() => undefined)
  process.exit(1)
}
