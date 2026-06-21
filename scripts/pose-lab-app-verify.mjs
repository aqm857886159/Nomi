// 真机验证：打包后的 App 里打开 3D 编辑器、套用预设、截图。
// 用法：pnpm run build && node scripts/pose-lab-app-verify.mjs
import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, '.pose-lab')
mkdirSync(outDir, { recursive: true })

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.'],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E_SMOKE: '1' },
})

const errors = []
try {
  const win = await app.firstWindow()
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1500)

  // 开项目
  const projectCard = win.locator('[data-project-card]').first()
  if ((await projectCard.count()) > 0) await projectCard.click()
  else await win.getByText('新建空白项目', { exact: false }).first().click()
  await win.waitForTimeout(2500)

  // 进生成画布
  await win.getByRole('button', { name: '生成', exact: false }).first().click()
  await win.waitForTimeout(1500)
  await win.screenshot({ path: path.join(outDir, 'app-01-canvas.png') })
  console.log('  ✓ canvas screenshot')

  // 加 3D 场景节点：左侧工具栏「3D场景」按钮（找不到按名字就点最下面的立方体图标）
  let added = false
  const byName = win.getByRole('button', { name: '3D场景', exact: false })
  if ((await byName.count()) > 0) { await byName.first().click(); added = true }
  if (!added) {
    const toolbarButtons = win.locator('button:visible')
    // 兜底：点画布左侧工具栏区域里的最后一个图标按钮
    const cube = win.locator('[title*="3D"], [aria-label*="3D"]')
    if ((await cube.count()) > 0) { await cube.first().click(); added = true }
    else console.log(`  (no 3D button by name/title; total visible buttons=${await toolbarButtons.count()})`)
  }
  await win.waitForTimeout(2000)
  await win.screenshot({ path: path.join(outDir, 'app-02-after-add.png') })
  console.log(`  ✓ after-add screenshot (added=${added})`)

  // 进入 3D 全屏编辑器（aria-label="打开 3D 编辑器" 的按钮）
  const enter = win.getByRole('button', { name: '打开 3D 编辑器', exact: false })
  if ((await enter.count()) > 0) {
    await enter.first().click()
    await win.waitForTimeout(4000)
    await win.screenshot({ path: path.join(outDir, 'app-03-editor.png') })
    console.log('  ✓ editor screenshot')

    // 选中左侧「假人」场景节点 → 切「姿势」tab
    await win.getByText('假人', { exact: true }).first().click()
    await win.waitForTimeout(800)
    const poseTab = win.getByRole('button', { name: '姿势', exact: true })
    if ((await poseTab.count()) > 0) { await poseTab.first().click(); await win.waitForTimeout(800) }
    await win.screenshot({ path: path.join(outDir, 'app-04-pose-panel.png') })
    console.log(`  ✓ pose panel (tab found=${(await poseTab.count()) > 0})`)

    // 套用预设动作并逐个截图（预设按钮文案=preset.label）
    for (const label of ['蹲下', '坐姿', '叉腰', '举双手', '站立']) {
      const presetBtn = win.getByRole('button', { name: label, exact: true })
      if ((await presetBtn.count()) > 0) {
        await presetBtn.first().click()
        await win.waitForTimeout(1500)
        await win.screenshot({ path: path.join(outDir, `app-pose-${label}.png`) })
        console.log(`  ✓ pose ${label}`)
      } else {
        console.log(`  (preset button "${label}" not found)`)
      }
    }
  } else {
    console.log('  (no 打开 3D 编辑器 button found)')
  }

  console.log(errors.length ? `console errors:\n  ${errors.slice(0, 10).join('\n  ')}` : 'no console errors')
} catch (error) {
  console.error(`\nFAIL: ${error?.message || error}`)
  try { const win = await app.firstWindow(); await win.screenshot({ path: path.join(outDir, 'app-FAIL.png') }) } catch {}
} finally {
  await app.close().catch(() => undefined)
}
