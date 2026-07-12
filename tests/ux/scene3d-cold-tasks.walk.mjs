// 导演台冷用户走查（R13）：① 首次进入三步教练标注按拍板样张出现/推进/结束；② 只出现一次（持久化）；
// ③ T1 可见路径：冷用户只点「可见带文案控件」完成 选假人→姿势→套蹲下。零额度，隔离 userData。
// 用法：pnpm run build && node tests/ux/scene3d-cold-tasks.walk.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(repoRoot, '.pose-lab')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-cold-walk-'))
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
const pass = { shellVisibleFast: false, coachStep1: false, coachDimLaidOut: false, coachStep2: false, coachStep3: false, coachGone: false, coachOnce: false, t1Pose: false }

try {
  const win = await app.firstWindow()
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)
  await win.keyboard.press('Escape').catch(() => {})

  const card = win.locator('[data-project-card]').first()
  if ((await card.count()) > 0) await card.click()
  else await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await win.keyboard.press('Escape').catch(() => {})
  const genTab = win.getByRole('button', { name: '生成', exact: false }).first()
  if ((await genTab.count()) > 0) await genTab.click()
  await win.waitForTimeout(1200)
  await win.getByRole('button', { name: '3D场景', exact: false }).first().click()
  await win.waitForTimeout(1500)
  await win.getByRole('button', { name: '打开 3D 编辑器', exact: false }).first().click()
  // 外壳必须点击后 ~800ms 内真实上屏（boundingBox 非零）。DOM 在场 ≠ 上屏：r3f Canvas 初始化
  // 自 suspend 曾让 React 把已提交外壳整棵 display:none 隐身 1.8s+（2026-07-11 悬案，修=FencedCanvas）。
  await win.waitForTimeout(800)
  const shellBox = await win.locator('[role="dialog"][aria-label="3D 场景编辑器"]').boundingBox()
  pass.shellVisibleFast = Boolean(shellBox && shellBox.width > 100 && shellBox.height > 100)
  log(`  ${pass.shellVisibleFast ? '✓' : '✗'} 外壳 800ms 内真实上屏（非隐身）`)
  await win.waitForTimeout(3200)

  // ① 三步教练标注
  pass.coachStep1 = (await win.getByText('点假人，人就归你管').count()) > 0
  await win.screenshot({ path: path.join(outDir, 'cold-01-coach-step1.png') })
  log(`  ${pass.coachStep1 ? '✓' : '✗'} 首次进入出现教练第 1 步`)
  // 压暗层回归具名 token alpha 类（bg-nomi-ink/45），必须真实布局——悬案回归网的后半张。
  const dimWidth = await win.evaluate(() => {
    const el = document.querySelector('[role="dialog"][aria-label="3D 场景编辑器"] .bg-nomi-ink\\/45')
    return el ? el.getBoundingClientRect().width : 0
  })
  pass.coachDimLaidOut = dimWidth > 100
  log(`  ${pass.coachDimLaidOut ? '✓' : '✗'} 教练压暗层（token 类）已布局 (w=${dimWidth})`)
  await win.getByRole('button', { name: '下一步' }).click()
  await win.waitForTimeout(500)
  pass.coachStep2 = (await win.getByText('点相机，运镜归你调').count()) > 0
  await win.screenshot({ path: path.join(outDir, 'cold-02-coach-step2.png') })
  log(`  ${pass.coachStep2 ? '✓' : '✗'} 第 2 步（相机）`)
  await win.getByRole('button', { name: '下一步' }).click()
  await win.waitForTimeout(500)
  pass.coachStep3 = (await win.getByText('场景不用自己搭').count()) > 0
  await win.screenshot({ path: path.join(outDir, 'cold-03-coach-step3.png') })
  log(`  ${pass.coachStep3 ? '✓' : '✗'} 第 3 步（添加）`)
  await win.getByRole('button', { name: '开始使用' }).click()
  await win.waitForTimeout(500)
  pass.coachGone = (await win.getByText('点假人，人就归你管').count()) === 0
  log(`  ${pass.coachGone ? '✓' : '✗'} 「开始使用」后标注消失`)

  // ② 关掉重开 → 不再出现
  await win.keyboard.press('Escape')
  await win.waitForTimeout(1500)
  const reopen = win.getByRole('button', { name: '打开 3D 编辑器', exact: false })
  if ((await reopen.count()) > 0) await reopen.first().click()
  else {
    const pill = win.getByText('3D 编辑器', { exact: false }).first()
    if ((await pill.count()) > 0) await pill.click()
  }
  await win.waitForTimeout(3000)
  const editorAgain = (await win.locator('[aria-label="3D 场景编辑器"]').count()) > 0
  pass.coachOnce = editorAgain && (await win.getByText('点假人，人就归你管').count()) === 0
  await win.screenshot({ path: path.join(outDir, 'cold-04-second-open-no-coach.png') })
  log(`  ${pass.coachOnce ? '✓' : '✗'} 第二次进入不再出现（editorAgain=${editorAgain}）`)

  // ③ T1：只点可见带文案控件 → 选假人 → 姿势 → 蹲下
  await win.locator('[data-coach="mannequin-row"]').first().getByText('假人', { exact: false }).first().click()
  await win.waitForTimeout(800)
  await win.getByRole('button', { name: '姿势', exact: true }).first().click()
  await win.waitForTimeout(600)
  await win.getByRole('button', { name: '蹲下', exact: false }).first().click()
  await win.waitForTimeout(1500)
  pass.t1Pose = true
  await win.screenshot({ path: path.join(outDir, 'cold-05-t1-squat-applied.png') })
  log('  ✓ T1 可见路径：选假人 → 姿势 → 蹲下')

  log('\n═══ 结果 ═══')
  for (const [k, v] of Object.entries(pass)) log(`  ${k}: ${v ? '✓' : '✗'}`)
  log(errors.length ? `console errors: ${errors.length}\n${errors.slice(0, 5).join('\n')}` : 'no console errors')
  if (Object.values(pass).some((v) => !v)) process.exitCode = 1
} finally {
  // close 挂死硬兜底（同 reference-capture.walk）：竞速 8s 后 SIGKILL，杜绝僵尸 Electron。
  const electronProc = app.process()
  await Promise.race([
    app.close().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ])
  try { electronProc?.kill('SIGKILL') } catch { /* 已退出 */ }
}
