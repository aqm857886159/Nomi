// R13 真机走查：dreamina CLI「exit=0 只吐错误行」→ 节点立刻报人话错误（91bb7695 修复验证）。
// 本机此刻 CLI 登录态真实失效（authsdk: refresh failed）= 活体故障注入，不花任何积分。
// 期望：视频节点用「即梦 Seedance 2.0（会员）」提交后 **不再**空转「仍在生成」，
// 而是很快落错误态、文案含「登录」指引。截图人眼判断。
// 用法：node scripts/dreamina-honest-error-walkthrough.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.dreamina-error-lab')
fs.mkdirSync(outDir, { recursive: true })
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamina-walk-settings-'))
const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamina-walk-projects-'))

const shot = async (win, name) => { await win.screenshot({ path: path.join(outDir, name) }); console.log('  📸 ' + name) }

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.'],
  cwd: repoRoot,
  env: {
    ...process.env,
    NOMI_E2E: '1',
    NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
    NOMI_RENDERER_URL: 'file://' + path.join(repoRoot, 'dist', 'index.html'),
    NOMI_SETTINGS_DIR: settingsDir,
    NOMI_PROJECTS_DIR: projectsDir,
  },
})
const errors = []
let failed = false
try {
  const win = await app.firstWindow()
  const bw = await app.browserWindow(win)
  await bw.evaluate((w) => w.setBounds({ x: 0, y: 0, width: 1600, height: 1000 })).catch(() => {})
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2000)

  await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2600)
  await win.keyboard.press('Escape')
  await win.getByText('生成', { exact: true }).first().click()
  await win.waitForTimeout(1500)

  // 加视频节点 → 打开 composer
  const direct = win.locator('[aria-label="添加视频节点"]')
  if ((await direct.count()) === 0 || !(await direct.first().isVisible().catch(() => false))) {
    await win.locator('[aria-label="添加节点菜单"]').first().click()
    await win.waitForTimeout(400)
  }
  await win.locator('[aria-label="添加视频节点"]').first().click()
  await win.waitForTimeout(900)
  const node = win.locator('[data-kind="video"][data-node-id]').first()
  await node.waitFor({ timeout: 8000 })
  await node.click({ position: { x: 40, y: 40 } })
  await win.waitForTimeout(1400)

  // 选「即梦 Seedance 2.0（会员）」（CLI 已装 → keyless 可用）
  const modelTrigger = win.locator('button[aria-label="模型"]').first()
  await modelTrigger.waitFor({ timeout: 8000 })
  await modelTrigger.click()
  await win.waitForTimeout(400)
  const jm = win.getByRole('option', { name: /即梦 Seedance/ }).first()
  await jm.waitFor({ timeout: 6000 })
  await jm.click()
  await win.waitForTimeout(1200)

  // 填提示词（tiptap contenteditable）
  const editor = win.locator('.generation-canvas-v2-node__composer-card [contenteditable="true"]').first()
  await editor.click()
  await win.keyboard.insertText('一只猫跳下沙发')
  await win.waitForTimeout(500)

  // 点生成 → 花费确认卡 → 确认
  await win.locator('button[aria-label="生成素材"]').first().click()
  await win.waitForTimeout(900)
  // 花费确认卡（自定义 overlay，无 role=dialog）：等「开始生成」标题出现，点**最后一个**「生成」按钮
  // （弹层 portal 挂 DOM 末尾；顶部 tab 的「生成」在前面）。真机截图核实文案。
  await win.getByText('开始生成', { exact: true }).first().waitFor({ timeout: 8000 })
  await win.getByRole('button', { name: '生成', exact: true }).last().click()
  console.log('  ✅ 已确认花费卡（开始生成 → 生成）')
  await shot(win, '01-submitted.png')

  // 关键断言：**不该**长时间「仍在生成」——CLI 快速失败（authsdk 行）→ 节点错误态 + 登录指引。
  // 给 90s 窗口（CLI 冷启 + 可能的一次重试），每 3s 查一次。
  let sawError = ''
  for (let i = 0; i < 30; i++) {
    await win.waitForTimeout(3000)
    const gateTitle = await win.getByText('账号权限不足', { exact: false }).count()
    const errCard = await win.getByText(/生成失败|登录|会员/, { exact: false }).count()
    if (gateTitle > 0 || errCard > 0) { sawError = `账号权限不足=${gateTitle} errCard=${errCard} @${(i + 1) * 3}s`; break }
  }
  // 误分类回归断言：绝不能再出「模型未开通」+火山 Ark 指引
  const wrongTitle = await win.getByText('模型未开通', { exact: false }).count()
  if (wrongTitle > 0) { failed = true; console.error('  ❌ 仍被误分类成「模型未开通」') }
  console.log(`  错误态出现: ${sawError || '（90s 内未出现!）'}`)
  if (!sawError) failed = true
  // 反向断言：不能还挂着「仍在生成」
  const stillSpinning = await win.getByText('已超常规时长', { exact: false }).count()
  if (stillSpinning > 0) { failed = true; console.error('  ❌ 仍在空转「已超常规时长」') }
  await shot(win, '02-honest-error.png')
} catch (e) {
  failed = true
  console.error('  ❌ 走查失败：', e)
  try { const w = await app.firstWindow(); await shot(w, 'ERROR.png') } catch { /* noop */ }
} finally {
  await app.close()
}
console.log(errors.length ? ('  ⚠️ console/page errors:\n' + errors.slice(0, 6).join('\n')) : '  ✅ 无 console/page error')
console.log(failed ? '❌ 走查失败' : '✅ 走查通过')
process.exitCode = failed ? 1 : 0
