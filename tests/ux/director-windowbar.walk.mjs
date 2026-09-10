// 导演台 · Windows 自绘窗口栏共存走查（R13 真机走查；根因合同 docs/fixes/2026-09-04-fullscreen-overlay-windows-windowbar.root-cause.json）
// 用法: node tests/ux/director-windowbar.walk.mjs   （隔离 userData + 临时 projects；零额度，不碰任何生成 API）
//
// 用户报的症状（2026-09-04）：进导演台后整条顶部工具栏一个按钮都点不动，最小化/最大化/关闭也够不着。
// 根因不在渲染层：Windows frame:false 下那条 32px 自绘窗口栏是系统级拖拽带（-webkit-app-region → WM_NCHITTEST），
// 命中测试**看几何、不看 DOM 层级**，所以盖在它上面的全屏壳，顶部一条的点击会被系统当成拖窗口吃掉。
//
// 因此本走查断言的是**几何**，不是「Playwright 点得动」——CDP 合成的点击直接进渲染进程，
// 绕过原生命中测试，就算真用户点不动它也会绿。能证明修好的只有一件事：可交互内容整个落在拖拽带之外。
// 证据 = 三条几何断言 + 截图人眼核对（tests/ux/shots/director/windowbar/）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectVisible, screenshotSettled } from './_assert.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { createBlankProject, prepareIsolation } from '../../evals/lib/isoApp.mjs'
import { stationTimeout } from './_station-budget.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/director/windowbar')
fs.mkdirSync(shotsDir, { recursive: true })
const iso = prepareIsolation(path.join(repoRoot, '.tmp', `director-windowbar-walk-${Date.now().toString(36)}`), { requireCatalog: false })

let shotIndex = 0
const failures = []
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(label)
  return ok
}

const consoleErrors = []
const { app, win } = await launchNomiApp({ name: 'director-windowbar', userDataDir: iso.chromiumDir, settingsDir: iso.settingsDir, projectsDir: iso.projectsDir })
const snap = async (label) => {
  shotIndex += 1
  const file = path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${label}.png`)
  await screenshotSettled(win, { path: file })
  console.log(`  · shot ${path.relative(repoRoot, file)}`)
}
win.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
win.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))
process.on('unhandledRejection', async (error) => {
  console.error(String(error && error.message ? error.message : error).split('\n')[0])
  if (consoleErrors.length) console.error(`renderer console errors (${consoleErrors.length}):\n  ${consoleErrors.slice(0, 8).join('\n  ')}`)
  await app.close().catch(() => {})
  process.exit(1)
})

await win.evaluate(() => {
  for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) window.localStorage.setItem(key, 'seen')
  window.localStorage.setItem('__nomiE2E', '1')
})
await win.reload()
await expectVisible(win.getByText('新建空白项目', { exact: false }).first(), '项目库没起来', stationTimeout({ operations: 4 }))

await createBlankProject(win, iso.projectsDir)
const generateTab = win.getByRole('button', { name: '生成', exact: true }).first()
await expectVisible(generateTab, '新建项目后工作台没打开（没有「生成」页签）', stationTimeout({ operations: 4 }))
await clickOrFail(generateTab, '顶栏·生成页签')
const boardCta = win.locator('button[aria-label^="新建一个"][aria-label$="节点"]').first()
if (await boardCta.count()) await boardCta.click({ timeout: stationTimeout() }).catch(() => {})
await win.keyboard.press('Escape').catch(() => {})
await win.mouse.click(60, 520).catch(() => {})
// 点法收口在 _canvasRail：加号自 2026-09-06「第三档」起 5 常驻 + 「更多」，导演台住「更多」里
await addCanvasNodeFromRail(win, 'director')
await expectVisible(win.locator('[data-testid="director-node"]').first(), '画布上没出 director 节点卡')
await snap('canvas')

await clickOrFail(win.locator('[data-testid="director-node-open"]').first(), '节点卡·进入导演台')
await expectVisible(win.locator('[data-testid="director-editor"]'), '全屏导演台没打开', stationTimeout({ operations: 2 }))
await win.waitForFunction(() => Boolean(window.__nomiDirectorE2E), null, { timeout: stationTimeout({ operations: 4 }) })
await snap('editor-open')

// ── 量几何：窗口栏 / 全屏壳 / 顶栏按钮 / 窗口控件 四者的真实矩形 ──
const geometry = await win.evaluate(() => {
  const rect = (element) => {
    if (!element) return null
    const { top, bottom, left, right, width, height } = element.getBoundingClientRect()
    return { top, bottom, left, right, width, height }
  }
  const windowbar = document.querySelector('.workbench-windowbar')
  const editor = document.querySelector('[data-testid="director-editor"]')
  // 2026-09-09 五簇重排：整行 director-header 没了，常驻控件全在悬浮顶栏 director-topbar 里
  const header = document.querySelector('[data-testid="director-topbar"]')
  const headerControls = header ? Array.from(header.querySelectorAll('button')) : []
  const windowControlLabels = ['最小化', '最大化', '还原', '关闭']
  const windowControls = windowbar
    ? Array.from(windowbar.querySelectorAll('button')).filter((button) => windowControlLabels.some((label) => (button.getAttribute('aria-label') ?? '').includes(label)))
    : []
  return {
    platform: window.nomiDesktop?.platform ?? null,
    windowbar: rect(windowbar),
    editor: rect(editor),
    header: rect(header),
    headerControlCount: headerControls.length,
    headerControlMinTop: headerControls.length ? Math.min(...headerControls.map((button) => button.getBoundingClientRect().top)) : null,
    windowControls: windowControls.map((button) => ({ label: button.getAttribute('aria-label'), ...rect(button) })),
  }
})

const bandHeight = geometry.platform === 'win32' ? (geometry.windowbar?.height ?? 0) : 0
console.log(`  · platform=${geometry.platform} 窗口栏高度=${bandHeight} 全屏壳 top=${geometry.editor?.top}`)

check(
  '① 全屏壳从窗口栏之下起画（不再 inset-0 铺满）',
  Boolean(geometry.editor) && geometry.editor.top >= bandHeight,
  `editor.top=${geometry.editor?.top} 需 ≥ ${bandHeight}`,
)

check(
  '② 顶部工具条整条落在拖拽带之外（这才是「点得动」的充要条件）',
  geometry.headerControlCount > 0 && geometry.headerControlMinTop !== null && geometry.headerControlMinTop >= bandHeight,
  `${geometry.headerControlCount} 个按钮，最高的 top=${geometry.headerControlMinTop} 需 ≥ ${bandHeight}`,
)

const controls = geometry.windowControls
const controlsUncovered = controls.length > 0 && controls.every((control) => control.bottom <= (geometry.editor?.top ?? 0) && control.width > 0)
check(
  '③ 最小化 / 最大化 / 关闭 三颗窗口控件露在全屏壳之上',
  geometry.platform === 'win32' ? controlsUncovered : true,
  geometry.platform === 'win32' ? controls.map((control) => `${control.label}@${Math.round(control.top)}..${Math.round(control.bottom)}`).join(' ') || '一颗都没找到' : '非 Windows：窗口控件交系统，跳过',
)

// 顶栏工具真的还能用（渲染层行为回归；证不了原生命中测试，只证没把交互改坏）
await clickOrFail(win.locator('[data-testid="director-view-cluster"] button').first(), '顶栏·重置视角')
await snap('toolbar-clicked')

expect(consoleErrors, '④ 渲染层无 console error').toEqual([])

await app.close().catch(() => {})
if (failures.length) {
  console.error(`\n✗ 走查失败 ${failures.length} 条：\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\n✅ 导演台与 Windows 窗口栏共存走查通过（截图仍需人眼核对）')
