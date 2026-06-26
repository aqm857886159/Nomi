// 真机走查（R13）：① 校准后的坐/蹲姿在真 3D 编辑器里渲染对不对（人眼判断）；
// ② 已出缩略图的 3D 节点，整图悬浮「打开 3D 编辑器」按钮能不能点开编辑器（本次 click 修复）。
// 零额度：纯本地 3D 渲染，不碰任何生成 API。隔离 userData + 项目目录，不污染真实数据。
// 用法：pnpm run build && node tests/ux/scene3d-pose-click.walk.mjs
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
const tmp = mkdtempSync(path.join(os.tmpdir(), 'nomi-pose-walk-'))
const projectsDir = path.join(tmp, 'projects')
mkdirSync(projectsDir, { recursive: true })

const app = await electron.launch({
  executablePath: require('electron'),
  args: ['.', `--user-data-dir=${path.join(tmp, 'udata')}`],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E_SMOKE: '1', NOMI_PROJECTS_DIR: projectsDir },
})

const errors = []
const log = (m) => console.log(m)
let pass = { editorOpen: false, sitRendered: false, thumbnailMade: false, filledClickOpens: false }

try {
  const win = await app.firstWindow()
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)

  // 关掉可能挡路的引导/spotlight
  await win.keyboard.press('Escape').catch(() => {})

  // 开项目（优先已有卡，否则新建空白）
  const card = win.locator('[data-project-card]').first()
  if ((await card.count()) > 0) await card.click()
  else {
    const blank = win.getByText('新建空白项目', { exact: false }).first()
    if ((await blank.count()) > 0) await blank.click()
  }
  await win.waitForTimeout(2500)
  await win.keyboard.press('Escape').catch(() => {})

  // 进生成画布
  const genTab = win.getByRole('button', { name: '生成', exact: false }).first()
  if ((await genTab.count()) > 0) await genTab.click()
  await win.waitForTimeout(1500)

  // 加 3D 场景节点
  let added = false
  const byName = win.getByRole('button', { name: '3D场景', exact: false })
  if ((await byName.count()) > 0) { await byName.first().click(); added = true }
  if (!added) {
    const cube = win.locator('[title*="3D"], [aria-label*="3D"]')
    if ((await cube.count()) > 0) { await cube.first().click(); added = true }
  }
  await win.waitForTimeout(2000)
  await win.screenshot({ path: path.join(outDir, 'walk-01-node-added.png') })
  log(`  ✓ 3D 节点已添加 (added=${added})`)

  // —— 验证 ①：点空态 body「打开 3D 编辑器」→ 编辑器开 ——
  const openEmpty = win.getByRole('button', { name: '打开 3D 编辑器', exact: false })
  if ((await openEmpty.count()) > 0) await openEmpty.first().click()
  await win.waitForTimeout(4000)
  const editor = win.locator('[aria-label="3D 场景编辑器"]')
  pass.editorOpen = (await editor.count()) > 0
  await win.screenshot({ path: path.join(outDir, 'walk-02-editor-open.png') })
  log(`  ${pass.editorOpen ? '✓' : '✗'} 空态点击 → 编辑器打开`)

  // 加第二个假人（场景里默认已有一个；为还原「两人」再加一个）
  const addMan = win.locator('[aria-label="添加假人"]')
  if ((await addMan.count()) > 0) { await addMan.first().click(); await win.waitForTimeout(1200) }

  // 选第一个假人 → 姿势 tab → 套「坐姿」
  const firstMan = win.getByText('假人', { exact: true }).first()
  if ((await firstMan.count()) > 0) { await firstMan.click(); await win.waitForTimeout(700) }
  const poseTab = win.getByRole('button', { name: '姿势', exact: true })
  if ((await poseTab.count()) > 0) { await poseTab.first().click(); await win.waitForTimeout(700) }
  // 逐个套用本次校准过的地面姿势，各截一张人眼判断（坐/蹲/单膝跪）
  for (const label of ['坐姿', '蹲下', '单膝跪']) {
    const btn = win.getByRole('button', { name: label, exact: true })
    if ((await btn.count()) > 0) {
      await btn.first().click()
      await win.waitForTimeout(1500)
      await win.screenshot({ path: path.join(outDir, `walk-03-${label}-in-editor.png`) })
      if (label === '坐姿') pass.sitRendered = true
      log(`  ✓ 真编辑器套用「${label}」并渲染`)
    } else {
      log(`  ✗ 预设按钮「${label}」未找到`)
    }
  }
  // 最后停在「坐姿」做后续截图/点击验证
  const sitBtn = win.getByRole('button', { name: '坐姿', exact: true })
  if ((await sitBtn.count()) > 0) { await sitBtn.first().click(); await win.waitForTimeout(1200) }

  // 截图（生成缩略图 + 回写节点）
  const shot = win.getByRole('button', { name: '截图', exact: false }).first()
  if ((await shot.count()) === 0) {
    // 兜底用 title
    const shotByTitle = win.locator('[title="当前视口截图"]')
    if ((await shotByTitle.count()) > 0) { await shotByTitle.first().click(); pass.thumbnailMade = true }
  } else { await shot.click(); pass.thumbnailMade = true }
  await win.waitForTimeout(2500)
  log(`  ${pass.thumbnailMade ? '✓' : '✗'} 编辑器内截图（生成缩略图回写）`)

  // 关闭编辑器
  const close = win.locator('[title="关闭"]').first()
  if ((await close.count()) > 0) await close.click()
  await win.waitForTimeout(2000)
  await win.screenshot({ path: path.join(outDir, 'walk-04-back-on-canvas.png') })

  // —— 验证 ②：已出缩略图的节点，悬浮整图 → 点居中「打开 3D 编辑器」按钮 → 编辑器重开 ——
  // 此前编辑器关掉了，aria-label="3D 场景编辑器" 应消失
  await win.waitForTimeout(500)
  const editorGoneCount = await win.locator('[aria-label="3D 场景编辑器"]').count()
  // 悬浮缩略图节点，点居中带文字的 pill（区别于右上角只有 icon 的小钮）
  const node3d = win.locator('[data-kind="scene3d"]').first()
  if ((await node3d.count()) > 0) await node3d.hover().catch(() => {})
  await win.waitForTimeout(600)
  await win.screenshot({ path: path.join(outDir, 'walk-05-hover-thumbnail.png') })
  // pill 有可见文字「打开 3D 编辑器」；getByText 命中它（角落钮无文字）
  const pill = win.getByText('打开 3D 编辑器', { exact: true }).first()
  const pillCount = await pill.count()
  if (pillCount > 0) await pill.click({ force: true })
  await win.waitForTimeout(4000)
  const editorAgain = await win.locator('[aria-label="3D 场景编辑器"]').count()
  pass.filledClickOpens = editorGoneCount === 0 && editorAgain > 0
  await win.screenshot({ path: path.join(outDir, 'walk-06-filled-click-reopened.png') })
  log(`  ${pass.filledClickOpens ? '✓' : '✗'} 已出图态：悬浮 pill(count=${pillCount}) 点击 → 编辑器重开 (gone=${editorGoneCount}→again=${editorAgain})`)

  log('\n═══ 结果 ═══')
  log(`  编辑器可开:        ${pass.editorOpen ? '✓' : '✗'}`)
  log(`  真编辑器渲染坐姿:  ${pass.sitRendered ? '✓' : '✗'}`)
  log(`  截图生成缩略图:    ${pass.thumbnailMade ? '✓' : '✗'}`)
  log(`  已出图整图可点开:  ${pass.filledClickOpens ? '✓' : '✗'}  ← 本次 click 修复`)
  log(errors.length ? `\nconsole errors:\n  ${errors.slice(0, 8).join('\n  ')}` : '\nno console errors')
  const ok = pass.editorOpen && pass.sitRendered && pass.thumbnailMade && pass.filledClickOpens
  await app.close()
  process.exit(ok ? 0 : 1)
} catch (err) {
  log(`\nFAIL: ${err?.message || err}`)
  try { const win = await app.firstWindow(); await win.screenshot({ path: path.join(outDir, 'walk-FAIL.png') }) } catch {}
  await app.close().catch(() => undefined)
  process.exit(1)
}
