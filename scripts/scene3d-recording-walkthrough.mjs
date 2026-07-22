// R13 走查：3D 人物动作录制事务 + C 键姿势 + 保留预选运镜（2026-07-22 复测三 FAIL 根治验证）。
// 断言链：
//  C — 一次点击「开始录制」→ 3 秒倒计时结束**直接**进入录制（CTA 变「完成这段动作」，恢复操作 0）。
//  D — 录制中 W→C(按住)→W → 停止后 take 的 poseTrack 含 crouch 关键帧（现场蹲、成片也蹲，非站）。
//  E — 录制前给相机套「右横移跟拍」→ 最终 take 保留该运镜轨迹，且不生成重采样「机位路径」。
// 读取口：window.__nomiLastRecordedTake（仅 NOMI_E2E，useScene3DTakeRecorder 停止时挂）。
// 用法：pnpm run build && node scripts/scene3d-recording-walkthrough.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync } from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.scene3d-recording-lab')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

let failures = 0
const ok = (msg) => console.log('  ✓ ' + msg)
const fail = (msg) => { console.error('  ✗ ' + msg); failures += 1 }

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.'],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_ALLOW_MULTI_INSTANCE: '1' },
})
try {
  const win = await app.firstWindow()
  const shot = async (name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    window.__nomiE2E = true
    window.localStorage.setItem('__nomiE2E', '1')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1']) window.localStorage.setItem(k, 'seen')
    window.localStorage.removeItem('nomi.onboarding.scene3dCoach.v1')
  })
  await win.waitForTimeout(1500)

  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)
  await win.getByRole('button', { name: '生成', exact: false }).first().click()
  await win.waitForTimeout(1500)
  await win.locator('[aria-label="添加3D 场景节点"]').first().click()
  await win.waitForTimeout(1000)
  await win.locator('[aria-label="打开 3D 编辑器"]').first().click()
  await win.waitForTimeout(3000)
  // 跳过 5 步引导
  for (let step = 1; step <= 5; step += 1) {
    const next = win.getByRole('button', { name: step < 5 ? '下一步' : '开始使用', exact: true })
    await next.first().click({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(400)
  }
  await win.getByRole('button', { name: '跳过', exact: true }).first().click({ timeout: 1500 }).catch(() => {})
  await win.waitForTimeout(500)

  // ── E 设置：给相机1 套「右横移跟拍」运镜预设 ──────────────────────────
  await win.getByText('相机1', { exact: true }).first().click()
  await win.waitForTimeout(700)
  await win.getByRole('button', { name: '预设', exact: true }).first().click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(500)
  const trackRightBtn = win.getByRole('button', { name: '右横移跟拍', exact: true })
  if ((await trackRightBtn.count()) > 0) {
    await trackRightBtn.first().click()
    await win.waitForTimeout(800)
    ok('已给相机套「右横移跟拍」运镜预设（E 前置）')
  } else {
    fail('预设面板找不到「右横移跟拍」按钮（E 前置失败）')
  }
  await shot('01-track-right-applied.png')

  // ── C：一次点击「开始录制」→ 倒计时结束直接进入录制 ────────────────────
  await win.getByRole('tab', { name: '人物动作', exact: false }).first().click({ timeout: 4000 }).catch(() => fail('点不到「人物动作」任务'))
  await win.waitForTimeout(600)
  const cta = win.locator('[data-coach="export-button"]')
  const ctaBefore = (await cta.first().innerText().catch(() => '')).trim()
  if (ctaBefore.includes('开始录制')) ok(`act 任务 CTA 初始=「${ctaBefore}」`)
  else fail(`act 任务 CTA 初始异常：「${ctaBefore}」`)

  await cta.first().click() // ← 只点这一次
  await win.waitForTimeout(3600) // 3 秒倒计时 + 余量
  const ctaAfter = (await cta.first().innerText().catch(() => '')).trim()
  await shot('02-after-single-click-countdown.png')
  if (ctaAfter.includes('完成这段动作')) ok('C 通过：一次点击后倒计时结束**直接进入录制**（CTA=「完成这段动作」，0 次恢复点击）')
  else fail(`C 失败：倒计时结束 CTA=「${ctaAfter}」（期望「完成这段动作」——退回「开始录制」即首击不真开录的回归）`)

  // ── D：录制中 W→C(按住)→W ─────────────────────────────────────────────
  await win.keyboard.down('w'); await win.waitForTimeout(650); await win.keyboard.up('w')
  await win.waitForTimeout(150)
  await win.keyboard.down('c') // 按住下蹲
  await win.waitForTimeout(500)
  await shot('03-c-held-live-crouch.png') // 现场应肉眼可见半蹲
  await win.waitForTimeout(500)
  await win.keyboard.up('c')
  await win.waitForTimeout(150)
  await win.keyboard.down('w'); await win.waitForTimeout(650); await win.keyboard.up('w')
  await win.waitForTimeout(300)

  // 停止录制（再点 CTA=完成这段动作）→ buildRecordedTakeScene → 挂 window.__nomiLastRecordedTake
  await cta.first().click()
  await win.waitForTimeout(1800)
  await shot('04-after-stop.png')

  const take = await win.evaluate(() => {
    const t = window.__nomiLastRecordedTake
    if (!t) return null
    return {
      trajectoryNames: (t.trajectories || []).map((x) => x.name),
      poseTracks: (t.objects || []).map((o) => (o.poseTrack || []).map((k) => k.presetId || (k.pose ? 'pose' : 'base'))),
    }
  })
  if (!take) {
    fail('没拿到录制产物 take（window.__nomiLastRecordedTake 为空——录制可能没真跑起来）')
  } else {
    console.log('  📄 take.trajectoryNames =', JSON.stringify(take.trajectoryNames))
    console.log('  📄 take.poseTracks =', JSON.stringify(take.poseTracks))
    // D：poseTrack 含 crouch 关键帧
    const hasCrouch = take.poseTracks.some((track) => track.includes('crouch'))
    if (hasCrouch) ok('D 通过：最终 take 的 poseTrack 含 crouch 关键帧（现场蹲进了成片，非全程站）')
    else fail('D 失败：poseTrack 无 crouch 关键帧（C 键姿势没进最终 take）')
    // E：保留右横移跟拍，不生成重采样机位路径
    if (take.trajectoryNames.includes('右横移跟拍')) ok('E 通过：最终 take 保留「右横移跟拍」运镜轨迹')
    else fail('E 失败：最终 take 丢了「右横移跟拍」运镜轨迹')
    if (!take.trajectoryNames.includes('机位路径')) ok('E 通过：没有重采样「机位路径」覆盖预选运镜')
    else fail('E 失败：仍生成「机位路径」覆盖了预选运镜')
  }

  console.log('\n人眼终审素材:', outDir)
  console.log('  03-c-held-live-crouch.png —— 按住 C 时角色应肉眼可见半蹲')
  console.log(failures === 0 ? '\n总判定: PASS' : `\n总判定: FAIL (${failures})`)
} finally {
  await app.close().catch(() => {})
}
process.exit(failures === 0 ? 0 : 1)
