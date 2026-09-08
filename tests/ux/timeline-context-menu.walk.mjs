// R13 走查：时间轴右键菜单迁到 `WorkbenchMenu`（Radix）之后，**形态一条没变、行为多了三样**。
//
// 为什么要它（2026-09-08 刀 1）：这个菜单迁移前是全仓最坏的一个——
//   · **点外面关不掉**（全仓唯一，清单 C16）：只能按 Esc 或点一项，点画布别处它就一直挂在那；
//   · 高度靠 `menuItems.length * 34 - 12` **猜**，项数一变（clip 8 项 / text 4 项 /
//     transition 3 项 / track 2 项）贴着视口下缘弹出时就夹错，被切掉半截；
//   · 方向键完全不能用。
// 迁移铁律是**只换实现不动形态**，所以这份走查的重心是**逐项对账**：项数、顺序、文案、
// 快捷键、哪几项是红的——迁移前长什么样，迁移后必须一模一样。三样新能力单独验。
//
// 阳性对照：每一条「不该在」的断言（Esc 关、点外面关）都先用 `proveProbe` 拿到
// 「这个选择器确实找得到菜单」的基线，否则 `expectAbsent` 在选择器写错时也会绿
// （docs/lessons：expect-absent-passes-too-early / dead-selector-lies-both-ways）。
//
// 真 Electron + 真构建产物，隔离 userData / projects，全程不发生成请求（零额度）。
// 用法：pnpm run build && node tests/ux/timeline-context-menu.walk.mjs
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, expectAbsent, expectVisible, proveProbe, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/timeline-context-menu')
fs.mkdirSync(shotsDir, { recursive: true })

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-timeline-menu-'))
const userDataDir = path.join(root, 'user-data')
const settingsDir = path.join(root, 'settings')
const projectsDir = path.join(root, 'projects')
const capabilityDir = path.join(root, 'capability')
for (const dir of [userDataDir, settingsDir, projectsDir, capabilityDir]) fs.mkdirSync(dir, { recursive: true })

const projectId = 'timeline-context-menu-walk'
const projectRoot = path.join(projectsDir, projectId)
fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })

const makeClip = (id, label, startFrame, endFrame) => ({
  id, type: 'video', sourceNodeId: `node-${id}`, label,
  startFrame, endFrame, frameCount: endFrame - startFrame, offsetStartFrame: 0, offsetEndFrame: 0,
})
const timeline = {
  version: 1, fps: 30, scale: 1.5, playheadFrame: 150,
  tracks: [
    { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
    {
      id: 'videoTrack', type: 'video', label: '视频轨',
      clips: [makeClip('clip-a', '开场远景', 0, 120), makeClip('clip-b', '推门近景', 120, 240), makeClip('clip-c', '眼神反应', 240, 360)],
    },
    { id: 'audioTrack', type: 'audio', label: '音频轨', clips: [] },
  ],
  textClips: [],
  transitions: [],
}
const workbenchDocument = { version: 1, title: '时间轴右键菜单走查片', updatedAt: 1, contentJson: { type: 'doc', content: [] } }
const generationCanvas = { nodes: [], edges: [], selectedNodeIds: [], groups: [] }
const payload = { workbenchDocument, timeline, generationCanvas, storyboardPlan: null, storyboardPlanCommitted: false }
const project = {
  id: projectId, name: '时间轴右键菜单走查片', version: 2,
  createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot, workbenchDocument, timeline, generationCanvas, payload,
}
fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify(project, null, 2))
fs.writeFileSync(path.join(projectRoot, '.nomi/project.json'), JSON.stringify(project, null, 2))

const launched = await launchNomiApp({
  name: 'timeline-context-menu',
  userDataDir, settingsDir, projectsDir, capabilityDir, timeout: 300_000,
})
const { app } = launched
let win = launched.win

let passed = 0
function assert(condition, label, detail = '') {
  if (!condition) throw new Error(`WALK FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
  passed += 1
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
}
const snap = async (name) => { await screenshotSettled(win, { path: path.join(shotsDir, name) }); console.log(`  · 截图 ${name}`) }

async function resize(width, height) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((ref, bounds) => { ref.setBounds({ x: 0, y: 0, ...bounds }); ref.center() }, { width, height })
  await win.waitForTimeout(300)
}

const menu = () => win.locator('[data-testid="timeline-context-menu"]')
/** 菜单里每一项的「文案 + 快捷键 + 是不是红的」——对账表就是拿它和迁移前的清单逐条比。 */
const readMenu = () => menu().evaluate((node) => ({
  rect: node.getBoundingClientRect().toJSON(),
  items: [...node.querySelectorAll('[role="menuitem"]')].map((item) => ({
    label: item.querySelector('[data-menu-label-text]')?.textContent?.trim() ?? '',
    shortcut: item.querySelector('[data-menu-shortcut]')?.textContent?.trim() ?? '',
    danger: item.className.includes('text-workbench-danger'),
  })),
}))

async function rightClick(locator, offset = { dx: 0.5, dy: 0.5 }) {
  const box = await locator.boundingBox()
  const point = { x: box.x + box.width * offset.dx, y: box.y + box.height * offset.dy }
  await win.mouse.click(point.x, point.y, { button: 'right' })
  await menu().waitFor({ timeout: 4000 })
  return point
}

try {
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) localStorage.setItem(key, 'seen')
  })
  await win.reload()
  await resize(1440, 920)

  const card = win.locator('[data-project-card="true"]').filter({ hasText: '时间轴右键菜单走查片' }).first()
  await expect(card, '夹具项目卡没出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  await card.hover()
  await clickOrFail(card.getByRole('button', { name: /继续创作/ }).first(), '打开时间轴右键菜单走查片')
  await expect.poll(() => app.windows().some((c) => /[?&]projectId=/.test(c.url())), { message: '项目窗口没打开', timeout: DEFAULT_TIMEOUT_MS }).toBe(true)
  win = app.windows().find((c) => /[?&]projectId=/.test(c.url())) ?? win
  await win.waitForLoadState('domcontentloaded')
  await resize(1440, 920)
  await clickOrFail(win.locator('nav.nomi-stepper [data-mode="preview"]').first(), '进入预览')
  const clip = win.locator('[data-clip-id="clip-b"]').first()
  await expectVisible(clip, '时间轴上有可右键的片段')
  passed += 1
  console.log('  ✓ 时间轴上有可右键的片段')

  // ── ① 逐项对账：clip 菜单 8 项，文案 / 顺序 / 快捷键 / 红项与迁移前逐条一致 ──
  const clickPoint = await rightClick(clip)
  const seen = await readMenu()
  await snap('01-clip-menu.png')
  const EXPECTED_CLIP = [
    { label: '在播放头处分割', shortcut: 'S', danger: false },
    // 2026-09-08 用户裁决 C1：这一项做的是 ⌘D duplicate，而画布上同名的「复制」是 ⌘C 剪贴板，
    // 同字不同义会让人点错 —— 改叫「创建副本」。⌘ 由 platformModifier derive（C10 修的 bug）。
    { label: '创建副本', shortcut: '⌘D', danger: false },
    { label: '重新生成这个镜头', shortcut: '', danger: false },
    { label: '静音', shortcut: '', danger: false },
    { label: '删除', shortcut: '⌫', danger: true },
    { label: '涟漪删除', shortcut: '⇧⌫', danger: true },
    { label: '删除播放头左侧', shortcut: 'Q', danger: true },
    { label: '删除播放头右侧', shortcut: 'W', danger: true },
  ]
  assert(seen.items.length === EXPECTED_CLIP.length, 'clip 菜单项数与迁移前一致', `${seen.items.length}`)
  for (const [index, expected] of EXPECTED_CLIP.entries()) {
    const actual = seen.items[index]
    assert(
      actual.label === expected.label && actual.shortcut === expected.shortcut && actual.danger === expected.danger,
      `第 ${index + 1} 项对账一致`,
      `${actual.label}/${actual.shortcut || '—'}/${actual.danger ? '红' : '常规'}`,
    )
  }

  // ── ② 定位：菜单锚在右键点上，且**整块都在视口里** ──
  //
  // 时间轴在窗口最底下，8 项的 clip 菜单往下放不下 —— 迁移前的做法是把它**往上顶**
  // （`top = min(y, innerHeight - items*34 - 12)`，用一个猜出来的高度），于是菜单会盖住
  // 光标、项数一变位置就错。现在由 Radix 量真实盒子后**翻到光标上方**：贴的仍是同一个点，
  // 只是贴的边从上沿换成下沿。两种都算「锚在点上」，但都必须整块在视口里。
  const viewport = await win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const anchoredDown = Math.abs(seen.rect.top - clickPoint.y) <= 2
  const anchoredUp = Math.abs(seen.rect.bottom - clickPoint.y) <= 2
  assert(Math.abs(seen.rect.left - clickPoint.x) <= 2, '菜单左沿贴在右键点上', `${Math.round(seen.rect.left)} vs ${Math.round(clickPoint.x)}`)
  assert(anchoredDown || anchoredUp, '菜单纵向锚在右键点上（放得下向下展开，放不下翻到上方）', anchoredUp ? '翻到上方' : '向下展开')
  assert(
    seen.rect.top >= 0 && seen.rect.bottom <= viewport.height && seen.rect.left >= 0 && seen.rect.right <= viewport.width,
    '菜单整块落在视口内（真实测量避让，不再靠估算高度）',
    `top=${Math.round(seen.rect.top)} bottom=${Math.round(seen.rect.bottom)} / ${viewport.height}`,
  )

  // ── ③ 方向键（迁移前 0 项支持）──
  await win.keyboard.press('ArrowDown')
  await win.waitForTimeout(150)
  const highlighted = await menu().evaluate((node) => node.querySelectorAll('[role="menuitem"][data-highlighted]').length)
  assert(highlighted === 1, '方向键能在项间移动（迁移前完全不能用）', `高亮 ${highlighted} 项`)

  // ── ④ Esc 关（迁移前就有，守住不回归）。先拿基线，避免选择器写错时的假绿。 ──
  const escProbe = await proveProbe(menu(), '时间轴右键菜单')
  await win.keyboard.press('Escape')
  await expectAbsent(menu(), { provenBy: escProbe, message: 'Esc 关得掉菜单' })
  passed += 1
  console.log('  ✓ Esc 关得掉菜单')

  // ── ⑤ 点外面关（**新增能力**：迁移前这是全仓唯一关不掉的菜单）──
  await rightClick(clip)
  const outsideProbe = await proveProbe(menu(), '时间轴右键菜单')
  await snap('02-before-click-outside.png')
  const ruler = await win.locator('[data-track-id="imageTrack"]').first().boundingBox()
  await win.mouse.click(ruler.x + ruler.width - 30, ruler.y + ruler.height / 2)
  await expectAbsent(menu(), { provenBy: outsideProbe, message: '点菜单外面关得掉（新增能力）' })
  passed += 1
  console.log('  ✓ 点菜单外面关得掉（新增能力）')
  await snap('03-after-click-outside.png')

  // ── ⑥ 另一个 target 分支：右键**空轨**应当换成 2 项的那一套 ──
  //    菜单按 target 分四套项集（clip 8 / text 4 / transition 3 / track 2），
  //    只验一套的话「分支挂了、恒回 clip 那套」照样绿。
  // 空轨用图片轨（夹具里它没有片段）：右键它的右半边，那里一定是轨道本体不是片段。
  const emptyTrack = win.locator('[data-track-id="imageTrack"]').first()
  await rightClick(emptyTrack, { dx: 0.8, dy: 0.5 })
  const trackMenu = await readMenu()
  await snap('04-track-menu.png')
  assert(
    trackMenu.items.length === 2
      && trackMenu.items[0].label.includes('拼片')
      && trackMenu.items[1].label === '从素材库添加…',
    '右键空轨换成 2 项的那一套（target 分支没挂）',
    trackMenu.items.map((item) => item.label).join(' / '),
  )
  await win.keyboard.press('Escape')

  console.log(`\n✅ 时间轴右键菜单走查通过：${passed} 项`)
} catch (error) {
  console.error(`\n❌ ${error.message}`)
  await snap('99-error.png').catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}
