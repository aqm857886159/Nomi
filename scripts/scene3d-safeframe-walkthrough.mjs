// R13 走查：3D 安全画幅（F1 · 独立复测 A/C FAIL「默认单人/双人整颗头出框」根治验证）。
// 开默认场景 → 预览最终画面（输出相机按主体安全画幅自动取景）→ 截图人眼看头脚不裁；再加第二个假人 → 再看双人。
// 用法：pnpm run build && node scripts/scene3d-safeframe-walkthrough.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.scene3d-safeframe-lab')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
const base = '/tmp/nomi-safeframe-walk'
const projectsDir = path.join(base, 'projects')
const settingsDir = path.join(base, 'settings')
fs.rmSync(base, { recursive: true, force: true })
fs.mkdirSync(projectsDir, { recursive: true })
fs.mkdirSync(settingsDir, { recursive: true })

let failures = 0
const ok = (msg) => console.log('  ✓ ' + msg)
const fail = (msg) => { console.error('  ✗ ' + msg); failures += 1 }

// 扫 projectsDir 下最新的 PNG（构图截图落盘处），把它当真实输出复制到 lab 供人眼看。
function newestPng(sinceMs) {
  let best = null
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.png')) {
        const st = fs.statSync(full)
        if (st.mtimeMs >= sinceMs && (!best || st.mtimeMs > best.mtimeMs)) best = { full, mtimeMs: st.mtimeMs }
      }
    }
  }
  try { walk(projectsDir) } catch { /* 目录还没建 */ }
  return best?.full ?? null
}

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${path.join(base, 'udata')}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E: '1', NOMI_E2E_ALLOW_MULTI_INSTANCE: '1', NOMI_PROJECTS_DIR: projectsDir, NOMI_SETTINGS_DIR: settingsDir },
})
try {
  const win = await app.firstWindow()
  const shot = async (name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1680, height: 1020 })).catch(() => {})
  await win.waitForLoadState('domcontentloaded')
  await win.evaluate(() => {
    window.__nomiE2E = true
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
  for (let step = 1; step <= 5; step += 1) {
    await win.getByRole('button', { name: step < 5 ? '下一步' : '开始使用', exact: true }).first().click({ timeout: 3000 }).catch(() => {})
    await win.waitForTimeout(350)
  }
  await win.getByRole('button', { name: '跳过', exact: true }).first().click({ timeout: 1500 }).catch(() => {})
  await win.waitForTimeout(500)

  // ── F1 单人：预览最终画面（auto 相机按主体安全画幅取景）→ 截图人眼看头脚不裁 ──
  const preview = win.getByText('预览最终画面', { exact: false })
  await preview.first().click({ timeout: 5000 }).catch(() => fail('点不到「预览最终画面」'))
  await win.waitForTimeout(1500)
  const outputChip = await win.getByText('输出画面', { exact: false }).count()
  if (outputChip > 0) ok('已进输出画面（相机安全画幅取景）')
  else fail('没进输出画面')
  await shot('01-default-single-output-view.png')

  // ── 真产物：点「使用这张构图」出 16:9 构图 PNG，从画布节点读回真实输出（复测就是读这张 PNG 判截头）──
  const saveComposition = async (name, label) => {
    const before = Date.now()
    await win.getByText('使用这张构图', { exact: false }).first().click({ timeout: 5000 }).catch(() => fail(`${label}：点不到「使用这张构图」`))
    let png = null
    for (let i = 0; i < 20 && !png; i += 1) { await win.waitForTimeout(500); png = newestPng(before) }
    if (png) {
      fs.copyFileSync(png, path.join(outDir, name))
      console.log('  📸 ' + name + '（真实 16:9 构图输出，落盘 ' + path.basename(png) + '）')
      ok(`${label}：16:9 构图 PNG 已落（人眼看头脚是否在画幅内）`)
    } else {
      fail(`${label}：构图 PNG 没落盘`)
    }
  }
  await saveComposition('02-single-composition-output.png', '单人构图')

  // ── F1 双人：回工作视图 → 加第二个假人 → 再预览 → 出双人构图 PNG ──
  await win.getByText('回工作视图', { exact: false }).first().click({ timeout: 4000 }).catch(() => {})
  await win.waitForTimeout(800)
  await win.locator('[data-coach="add-button"]').first().click({ timeout: 3000 }).catch(() => {})
  await win.waitForTimeout(600)
  // 添加菜单里的「假人」项（场景树里也有个「假人」，取菜单里最后出现的那个）。
  const addedSecond = await win.getByText('假人', { exact: true }).last().click({ timeout: 3000 }).then(() => true).catch(() => false)
  if (!addedSecond) { await win.keyboard.press('Escape').catch(() => {}); fail('加不了第二个假人（双人 F1 跳过）') }
  await win.waitForTimeout(1200)
  if (addedSecond) {
    await win.getByText('预览最终画面', { exact: false }).first().click({ timeout: 5000 }).catch(() => fail('双人：点不到预览'))
    await win.waitForTimeout(1500)
    await shot('03-two-person-output-view.png')
    await saveComposition('04-two-person-composition-output.png', '双人构图')
  }

  console.log('\n人眼终审素材:', outDir)
  console.log('  02-single-composition-output.png —— 默认单人真实 16:9 输出：整颗头+脚都要在画幅内（复测此处截头）')
  console.log('  04-two-person-composition-output.png —— 双人真实输出：两人头脚都要在画幅内')
  console.log(failures === 0 ? '\n总判定: PASS' : `\n总判定: FAIL (${failures})`)
} finally {
  await app.close().catch(() => {})
}
process.exit(failures === 0 ? 0 : 1)
