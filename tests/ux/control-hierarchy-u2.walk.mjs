import { makeTempDir } from '../../scripts/_test-temp.mjs'
// R13 走查：控件分层法 U2（顶栏 + 项目库 + 设置归位）落地后的真机取证。
// 零额度——只截静态界面，绝不触发任何生成。
//   ① 项目库顶栏首屏截图（原判据「弱入口 = 3」已随外壳重设计退役：项目库与项目里是同一条顶栏）
//   ② 设置「通用」：语言分段 + 外观（从两处顶栏 + 品牌弹窗归位来的）
//   ③ 设置「关于」：版本 + 上手手册 + 重看开屏动画 + 检查更新（原品牌弹窗整块搬来）
//   ④ studio 顶栏（生成页）：右簇按钮清单 + 任务入口常驻（原判据「分 3 组 / 分隔线 3 / 主行动叫去出片」已退役：右簇不再分组画线，导出只在预览页顶栏）
//   ⑤ 预览页顶栏：「去出片」整颗消失，控制条的「导出 MP4」是唯一导出入口
// 用法: pnpm run build && node tests/ux/control-hierarchy-u2.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { screenshotSettled } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { closeSettings, newProjectEntry, openSettings, switchWorkspace } from './_shell.mjs'
import { walkEvidenceDir } from './_walkEvidence.mjs'

const outDir = walkEvidenceDir()

const WIN_W = 1680
const WIN_H = 1050
const root = makeTempDir('nomi-u2-walk-')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
fs.mkdirSync(settingsDir, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })

const checks = []
const note = (name, detail = '') => { checks.push({ name, detail }); console.log(`  · ${name}${detail ? ` — ${detail}` : ''}`) }

const { app, win: _initialWin } = await launchNomiApp({
  name: 'control-hierarchy-u2',
  userDataDir: settingsDir,
  settingsDir,
  projectsDir,
  args: ['--no-proxy-server'],
  settleMs: 0,
})

let win = _initialWin
const getWin = () => {
  const live = app.windows().filter((w) => !w.isClosed())
  win = live.find((w) => { try { return /projectId=/.test(w.url()) } catch { return false } }) || live[live.length - 1] || win
  return win
}

async function resizeWindow() {
  try {
    const bw = await app.browserWindow(getWin())
    await bw.evaluate((w, { width, height }) => { w.setBounds({ x: 0, y: 0, width, height }); w.center() }, { width: WIN_W, height: WIN_H })
  } catch (e) { note('resize 失败(非致命)', e.message) }
  await getWin().waitForTimeout(400)
}

async function snap(name, clip) {
  const p = path.join(outDir, name)
  await screenshotSettled(getWin(), clip ? { path: p, clip } : { path: p })
  note(`截图 ${name}`, `${(fs.statSync(p).size / 1024).toFixed(0)}KB`)
  return p
}

/** 只截顶栏那一条（右簇细节在全屏图上看不清）。 */
async function snapTopBar(name) {
  const box = await getWin().evaluate(() => {
    const bar = document.querySelector('[data-shell-topbar]') || document.querySelector('.nomi-library-page__main section')
    if (!bar) return null
    const r = bar.getBoundingClientRect()
    return { x: 0, y: Math.max(0, Math.round(r.top) - 4), width: Math.round(window.innerWidth), height: Math.round(r.height) + 12 }
  })
  return snap(name, box || undefined)
}

async function dismissSplash() {
  // SplashIntro 已按 Q18 删除，保留空函数供调用处走通。
}
async function dismissTour() {
  for (let i = 0; i < 6; i++) {
    const s = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await s.count()) await s.click({ timeout: 800 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(200)
  }
}

win.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`))

try {
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2200)
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(k, 'seen')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(1800)
  await resizeWindow()
  await dismissSplash()
  await getWin().waitForTimeout(600)

  // ========== ① 项目库顶栏（截图留证）==========
  // 旧判据「弱入口 = 3（接入模型 · 浏览器 · 设置）」随 10-08 外壳重设计退役：项目库与项目里是同一条顶栏（ShellTopBar），
  // 右簇按钮清单由 ④ 在 studio 顶栏上记录；这里只留首屏截图。
  await snap('01-library-top.png')

  // ========== ② / ③ 设置面板两个 tab ==========
  const settingsOpen = await openSettings(getWin(), { tab: 'general', label: '打开设置·通用' }).then(() => 1).catch(() => 0)
  note('设置面板打开', settingsOpen ? '是' : '否')

  await getWin().waitForTimeout(600)
  const localeBtns = await getWin().locator('[data-settings-locale]').count()
  const hasAppearance = await getWin().locator('[role="dialog"]').getByText('外观', { exact: false }).count()
  note('设置·通用', `语言分段 ${localeBtns} 个 / 外观行 ${hasAppearance ? '有' : '无'}`)
  await snap('02-settings-general.png')

  await openSettings(getWin(), { tab: 'about', label: '打开设置·关于' }).catch(() => {})
  await getWin().waitForTimeout(700)
  const aboutTexts = await getWin().evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="设置"]')
    return d ? (d.textContent || '').replace(/\s+/g, ' ').slice(0, 300) : ''
  })
  note('设置·关于', aboutTexts.slice(0, 160))
  await snap('03-settings-about.png')
  await closeSettings(getWin())

  // ========== ④ studio 顶栏（生成页）：右簇 3 组 + 「去出片」 ==========
  const blankCta = newProjectEntry(getWin())
  if (await blankCta.count()) await blankCta.click({ timeout: 6000 }).catch(() => {})
  await getWin().waitForTimeout(3000)
  await dismissTour()
  await resizeWindow()
  await getWin().locator('[data-shell-topbar]').first().waitFor({ state: 'visible', timeout: stationTimeout() }).catch(() => {})

  const rightCluster = await getWin().evaluate(() => {
    const right = document.querySelector('[data-shell-topbar] [role="toolbar"]')
    if (!right) return null
    // 10-08 外壳重设计：右簇不再分组画分隔线（层次靠间距与外壳底色），这里只记按钮清单。
    const labels = [...right.querySelectorAll('button')].map((b) => (b.textContent || '').trim() || b.getAttribute('aria-label') || '?')
    return { dividers: 0, groups: 0, labels }
  })
  note('studio 顶栏右簇', rightCluster ? `按钮 ${rightCluster.labels.length} 个 / 分隔线 ${rightCluster.dividers} / 分组 ${rightCluster.groups}：${rightCluster.labels.join(' | ')}` : '未找到')

  const taskTrigger = getWin().locator('[data-task-center-trigger="true"]').first()
  await taskTrigger.hover({ timeout: 4000 }).catch(() => {})
  await getWin().waitForTimeout(450)
  const taskTooltipVisible = await getWin().locator('[role="tooltip"]', { hasText: /^任务$/ }).first().isVisible().catch(() => false)
  note('任务入口悬浮名称', taskTooltipVisible ? '任务' : '未显示')
  await taskTrigger.click({ timeout: 4000 }).catch(() => {})
  await getWin().waitForTimeout(250)
  const taskPanelVisible = await getWin().locator('[role="dialog"][aria-label="任务"]').first().isVisible().catch(() => false)
  note('任务面板可打开', taskPanelVisible ? '是' : '否')
  await getWin().keyboard.press('Escape').catch(() => {})
  await getWin().waitForTimeout(200)
  await snapTopBar('04-studio-topbar-generate.png')

  // ========== ⑤ 预览页：顶栏「去出片」消失，控制条「导出 MP4」唯一 ==========
  await switchWorkspace(getWin(), 'preview', '切到预览页')
  await getWin().waitForTimeout(2200)
  const previewState = await getWin().evaluate(() => {
    const right = document.querySelector('[data-shell-topbar] [role="toolbar"]')
    const topLabels = right ? [...right.querySelectorAll('button')].map((b) => (b.textContent || '').trim() || b.getAttribute('aria-label') || '?') : []
    const exportButtons = [...document.querySelectorAll('button')]
      .map((b) => (b.textContent || '').trim())
      .filter((txt) => /导出\s*MP4|去出片/.test(txt))
    return { topLabels, exportButtons }
  })
  note('预览页顶栏', previewState.topLabels.join(' | ') || '(空)')
  note('全页「导出/去出片」按钮', `${previewState.exportButtons.length} 个：${previewState.exportButtons.join(' | ')}`)
  await snap('05-preview-full.png')
  await snapTopBar('06-preview-topbar.png')

  console.log('\n=== 判据 ===')
  const verdicts = [
    ['设置·通用有语言分段 2 段', localeBtns === 2],
    ['设置·关于含「重看开屏动画」', /重看开屏动画/.test(aboutTexts)],
    ['设置·关于含版本号', /当前版本|Version/.test(aboutTexts)],
    // 任务入口必须常驻：否则重启后内存队列为空，用户连任务面板和通知设置都找不到。
    ['无任务时仍有「任务」入口', (rightCluster?.labels || []).some((l) => /^任务$/.test(l))],
    ['悬浮任务入口显示名称', taskTooltipVisible],
    ['点击任务入口打开面板', taskPanelVisible],
    ['预览页顶栏无「去出片」', !(previewState.topLabels || []).some((l) => /去出片/.test(l))],
    ['全页导出入口恰好 1 个', previewState.exportButtons.length === 1],
  ]
  let failed = 0
  for (const [name, ok] of verdicts) { console.log(`  ${ok ? '✅' : '❌'} ${name}`); if (!ok) failed++ }
  console.log(`\n截图目录：${outDir}`)
  process.exitCode = failed ? 1 : 0
} catch (error) {
  console.error('走查失败:', error)
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
