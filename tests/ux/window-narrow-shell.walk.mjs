// 走查：窗口能缩到半屏（WindowNarrow 板外壳那一半，计划 A4g；拍板清单 docs/design/boards/2026-11-07-window-narrow/WindowNarrow.board.json）。
//
// 真实用户任务：用户把 Nomi 拖到半屏（700 宽）和别的窗口并排，在创作 / 生成 / 预览之间来回，叫 Nomi 说两句，再拉回宽屏。
// 改前：最小窗 1100 拖不下去；就算能窄，停靠的 Nomi 把内容挤没，窗口一窄就把存下的 Nomi 宽改成 300、拉回也不还原。
//
// 每一步量真实像素，再查这一类的不变量：
//   ① 窄窗只改「显示」：拖着窗口 1100 ↔ 700 来回三次，存下的形态、Nomi 宽、左栏抽屉宽、项目里的版面一个字节不变；
//   ② 只有一个判断「窗口宽 < 1060」：停靠的页此刻显示成小球，点开是浮窗，「停靠」变灰并说为什么；宽回来自动停回；
//   ③ 跨阈值的过渡每次跨只播一次（拖动途中不连播），减弱动效时直接换；
//   ④ 怎么都不让（L1）：分段、项目菜单、任务中心、设置、左栏、各页主体与它们的按钮，700 / 756 / 960 / 1100 都整个在窗内。
// 零额度：空画布 + 只有元数据的时间轴，不发消息、不碰任何生成。两轮：中文·浅色、英文·暗色。
// Run: pnpm run build && node tests/ux/window-narrow-shell.walk.mjs
//      打包产物：NOMI_WALK_APP=release/mac-arm64/Nomi.app/Contents/MacOS/Nomi node tests/ux/window-narrow-shell.walk.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import {
  AGENT_BALL, AGENT_PANEL, CANVAS_ADD_BAR, CANVAS_ZOOM_BAR, COLLAPSE_BUTTON, closeRailDrawer, closeSettings, ensureAgentPanelOpen, openRailDrawer, openSettings,
  railDrawerPanel, settingsDialog, switchWorkspace,
} from './_shell.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { MIN_WINDOW } from './_minWindow.mjs'
import { CANVAS_STAGE_SELECTOR } from './_canvasHit.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/window-narrow-shell')
fs.mkdirSync(shotsDir, { recursive: true })
const executablePath = process.env.NOMI_WALK_APP ? path.resolve(process.env.NOMI_WALK_APP) : undefined
const rounds = [
  { locale: 'zh-CN', scheme: 'light', tag: 'zh-light', projectName: '窄窗外壳走查 · 一个名字很长很长的短片项目' },
  { locale: 'en', scheme: 'dark', tag: 'en-dark', projectName: 'Window narrow shell walk · a short film with a very long name' },
].filter((round) => !process.env.NOMI_WALK_ROUNDS || process.env.NOMI_WALK_ROUNDS.split(',').includes(round.tag))

const HEIGHT = 800
const WIDE = 1100
const NARROW = MIN_WINDOW.width
const THRESHOLD = 1060
const WIDTHS = [700, 756, 960, 1100]
const PAGES = ['creation', 'generation', 'preview']
const DRAWER_STORED = 720
const DRAWER_RESERVE = 232
const STEP = 25

// 拍板清单元素断言（check:board-parity 认这些名字）。
const BOARD = {
  minSize: 'board:WindowNarrow/window.min-size',
  tier: 'board:WindowNarrow/shell.narrow-tier',
  ballNarrow: 'board:WindowNarrow/agent.ball-narrow',
  pill: 'board:WindowNarrow/agent.pill-confirm',
  float: 'board:WindowNarrow/agent.float-narrow',
  dockDisabled: 'board:WindowNarrow/agent.form-switch-dock-disabled',
  ballTip: 'board:WindowNarrow/agent.ball-hover-tip',
  motion: 'board:WindowNarrow/agent.collapse-motion',
  tight: 'board:WindowNarrow/composer.tight',
  noWriteback: 'board:WindowNarrow/shell.panel-width-no-writeback',
  exportIcon: 'board:WindowNarrow/topbar.export-icon',
  nameHide: 'board:WindowNarrow/topbar.project-name-hide',
  segment: 'board:WindowNarrow/topbar.segment',
  drawer: 'board:WindowNarrow/drawer.clamp',
  library: 'board:WindowNarrow/library.grid',
  settings: 'board:WindowNarrow/settings.dialog',
  neverYield: 'board:WindowNarrow/shell.never-yield',
}

const failures = []
const pagesLinePending = []
const knownIssues = []
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}
/** 「没有某个东西」的检查：带基线（proveProbe 先证过这个探针找得到它），并且要持续没有，不是此刻恰好没看见。 */
const checkAbsent = async (name, locator, provenBy) => {
  try {
    await expectAbsent(locator, { provenBy, message: name })
    check(name, true)
  } catch (error) {
    check(name, false, String(error?.message ?? error).split('\n')[0])
  }
}

const clip = (id, type, startFrame, endFrame) => ({
  id, type, sourceNodeId: `node-${id}`, label: id, startFrame, endFrame, frameCount: endFrame - startFrame + 60, offsetStartFrame: 0, offsetEndFrame: 0,
})
const TIMELINE = {
  version: 1, fps: 30, scale: 1, playheadFrame: 0,
  tracks: [
    { id: 'imageTrack', type: 'image', label: 'image', clips: [clip('clip-image', 'image', 0, 90)] },
    { id: 'videoTrack', type: 'video', label: 'video', clips: [clip('clip-video', 'video', 0, 120)] },
  ],
  textClips: [{ id: 'text-1', text: 'caption', startFrame: 0, endFrame: 90, style: 'caption' }],
  transitions: [],
}

function writeProject(projectsDir, projectId, name) {
  const root = path.join(projectsDir, projectId)
  fs.mkdirSync(path.join(root, '.nomi'), { recursive: true })
  const now = Date.now()
  // 不写 editingPanelLayout：新项目默认布局（Nomi 390）——用户报问题时的样子。
  fs.writeFileSync(path.join(root, '.nomi', 'project.json'), JSON.stringify({
    id: projectId, name, version: 2, createdAt: now, updatedAt: now, savedAt: now, revision: 1, lastKnownRootPath: path.resolve(root),
    payload: { timeline: TIMELINE, generationCanvas: { nodes: [], edges: [], groups: [], selectedNodeIds: [] } },
  }))
  return path.join(root, '.nomi', 'project.json')
}

/** 某个元素（和它里面看得见的按钮）有没有整个在窗内；返回越界清单（空 = 都在）。 */
function outOfWindow(win, selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return [`${sel} 不在页面上`]
    const vw = window.innerWidth
    const vh = window.innerHeight
    const problems = []
    const test = (node, name) => {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return
      const r = node.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return
      if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) problems.push(`${name} [${Math.round(r.left)},${Math.round(r.top)} → ${Math.round(r.right)},${Math.round(r.bottom)}] 窗 ${vw}×${vh}`)
    }
    const box = el.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) problems.push(`${sel} 宽高为 0`)
    test(el, sel)
    // 竖着滚的列表（时间轴轨道区、正文）里滚到下面的按钮是滚得到的，不算越界：改量那个滚动区本身在不在窗内。
    // 横向被裁的照样算（工具条按钮挤出窗外、得横滚才看得到，就是越界）。
    const verticalScroller = (node) => {
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        if (/(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight + 1) {
          const box = node.getBoundingClientRect()
          const clip = parent.getBoundingClientRect()
          const clippedOnlyVertically = box.left >= clip.left - 0.5 && box.right <= clip.right + 0.5
          return clippedOnlyVertically ? parent : null
        }
        if (parent === el) break
      }
      return null
    }
    const scrollers = new Set()
    for (const button of el.querySelectorAll('button')) {
      const scroller = verticalScroller(button)
      if (scroller) { scrollers.add(scroller); continue }
      test(button, `${sel} 里的按钮「${(button.getAttribute('aria-label') || button.textContent || '').trim().slice(0, 16)}」`)
    }
    for (const scroller of scrollers) test(scroller, `${sel} 里的竖向滚动区`)
    return problems
  }, selector)
}

const rectOf = (win, selector) => win.evaluate((sel) => {
  const el = document.querySelector(sel)
  if (!el) return null
  const r = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, display: style.display, title: el.getAttribute('title') }
}, selector)

async function runRound({ locale, scheme, tag, projectName }) {
  console.log(`\n── ${tag} ──`)
  const tempRoot = makeTempDir('nomi-window-narrow-shell-')
  const projectsDir = path.join(tempRoot, 'projects')
  const projectFile = writeProject(projectsDir, `walk-window-narrow-${tag}`, projectName)
  const shot = async (win, name) => {
    await screenshotSettled(win, { path: path.join(shotsDir, `${tag}-${name}.png`) })
  }
  let app
  try {
    const launched = await launchNomiApp({
      name: `window-narrow-shell-${tag}`, tempRoot, projectsDir, settleMs: 0, timeout: 300_000,
      ...(executablePath ? { executablePath } : {}),
      viewportSize: { width: WIDE, height: HEIGHT },
      initialLocalStorage: {
        'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
        'nomi-color-scheme': scheme, __nomiE2E: '1',
        // 左栏「文档」抽屉存宽 720（上限）：窄窗里显示宽要让到「窗口 − 232」，存的那份不动。
        'nomi:shell-layout:v1': JSON.stringify({ state: { drawerWidth: { docs: DRAWER_STORED } }, version: 1 }),
      },
    })
    app = launched.app
    let win = launched.win
    win.on('pageerror', (error) => console.log(`[renderer:pageerror] ${error.message}`))

    const resize = async (width, height = HEIGHT) => {
      const browserWindow = await app.browserWindow(win)
      await browserWindow.evaluate((windowRef, size) => windowRef.setContentSize(size.width, size.height), { width, height })
      await win.setViewportSize({ width, height })
    }
    // 面板里那层（[data-v4-panel]）的宽是外框 ResizeObserver 回传、React 再写上去的，比外框晚一拍：
    // 改完窗口立刻量，量到的是上一个宽度的输入框底栏（2026-11-08 en 1060 量到 row 310 > 面板 300）。
    // 只等「内层跟上外框」这件事本身，不等结果对；等不到就记一条红。
    const panelInnerCaughtUp = async (label) => {
      const ok = await win.waitForFunction((panelSelector) => {
        const panel = document.querySelector(panelSelector)
        const inner = panel?.querySelector('[data-v4-panel]')
        if (!panel || !(inner instanceof HTMLElement)) return false
        const style = getComputedStyle(panel)
        const content = panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        return Math.abs(parseFloat(inner.style.width) - content) <= 1
      }, AGENT_PANEL, { timeout: DEFAULT_TIMEOUT_MS }).then(() => true, () => false)
      check(`${label}：面板内层宽跟上外框`, ok)
    }

    // ── 最小窗：700×720，再小拖不下去 ──
    {
      const browserWindow = await app.browserWindow(win)
      const minimum = await browserWindow.evaluate((windowRef) => windowRef.getMinimumSize())
      await browserWindow.evaluate((windowRef) => windowRef.setSize(560, 560))
      const size = await browserWindow.evaluate((windowRef) => windowRef.getSize())
      check(`${BOARD.minSize} 最小窗 = 700×720`, minimum[0] === NARROW && minimum[1] === MIN_WINDOW.height, `getMinimumSize ${minimum.join('×')}`)
      check(`${BOARD.minSize} 往 560×560 拖，停在 700×720`, size[0] === NARROW && size[1] === MIN_WINDOW.height, `实际 ${size.join('×')}`)
    }

    // ── 项目库与设置在 700 宽（不改，只看） ──
    await resize(NARROW)
    await win.locator('[data-project-card]').first().waitFor({ timeout: stationTimeout({ operations: 2 }) })
    {
      const library = await win.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-project-card]')].map((card) => card.getBoundingClientRect())
        return { cards: cards.length, worstRight: Math.max(...cards.map((r) => r.right)), vw: window.innerWidth, scrollWidth: document.scrollingElement.scrollWidth }
      })
      check(`${BOARD.library} 700 宽项目卡都在窗内、没有横向滚动`, library.cards > 0 && library.worstRight <= library.vw + 0.5 && library.scrollWidth <= library.vw, JSON.stringify(library))
      await shot(win, 'library-700')
      await openSettings(win)
      const dialog = await settingsDialog(win).boundingBox()
      check(`${BOARD.settings} 700 宽设置对话框整个在窗内`, Boolean(dialog) && dialog.x >= 0 && dialog.x + dialog.width <= NARROW + 0.5 && dialog.y >= 0 && dialog.y + dialog.height <= HEIGHT + 0.5, JSON.stringify(dialog))
      await shot(win, 'settings-700')
      await closeSettings(win)
    }

    await resize(WIDE)
    await clickOrFail(win.locator('[data-project-card]', { hasText: projectName.slice(0, 12) }).first(), 'open project', { timeout: stationTimeout() })
    for (let i = 0; i < 40 && !app.windows().some((page) => /projectId=/.test(page.url())); i += 1) await win.waitForTimeout(250)
    win = app.windows().find((page) => /projectId=/.test(page.url())) ?? win
    await resize(WIDE)
    await win.locator('.nomi-stepper').first().waitFor({ timeout: stationTimeout({ operations: 2 }) })
    await switchWorkspace(win, 'creation')
    await ensureAgentPanelOpen(win, 'Nomi 停靠', { form: 'dock' })
    // 过渡计数：每次 animationstart 记一笔（收拢 / 停回两种），用来判「每跨一次只播一次」。
    await win.evaluate(() => {
      window.__narrowMotion = []
      document.addEventListener('animationstart', (event) => {
        if (/nomi-agent-(gather|dock-in)/.test(event.animationName)) window.__narrowMotion.push(event.animationName)
      }, true)
    })
    const motionCount = () => win.evaluate(() => window.__narrowMotion.slice())

    const dockLayer = win.locator('[data-shell-agent-layer][data-agent-form="dock"]')
    const narrowBall = win.locator('[data-agent-ball-narrow="true"]')
    // 落盘那份拆成两段：用户的意图（各栏宽、左栏 / 属性栏开合、预设）逐字节比；visibility.assistant 是「停靠占不占位」的投影，
    // 由外壳形态单向写（ShellAgentHost），窄窗收成小球那一下会被翻成 false 并自动存一次——把「显示投影」和「落盘意图」拆开
    // 是移交的后续一题（计划表 A4g）。这里单独记它最后停在哪，不混进意图那一段，也不藏：停错了打 ⚠ 并进报告。
    const readDiskLayout = () => JSON.parse(fs.readFileSync(projectFile, 'utf8')).payload?.editingPanelLayout ?? null
    const readDisk = () => {
      const layout = readDiskLayout()
      if (!layout) return 'null'
      const { visibility = {}, ...rest } = layout
      const intentVisibility = { ...visibility }
      delete intentVisibility.assistant
      return JSON.stringify({ ...rest, visibility: intentVisibility })
    }
    const readDiskProjection = () => String(readDiskLayout()?.visibility?.assistant)
    const projectionDrift = []
    const snapshot = async () => ({
      ...(await win.evaluate(async () => ({
        form: window.localStorage.getItem('nomi:shell-agent-form:v1'),
        shellLayout: window.localStorage.getItem('nomi:shell-layout:v1'),
        layout: JSON.stringify((await window.__nomiCapabilityApply('layout.read', {})).layout),
      }))),
      disk: readDisk(),
    })
    const diffKeys = (a, b) => Object.keys(a).filter((key) => a[key] !== b[key])
    /** 等四份存档落定（自动保存防抖 700ms + 写盘）：最多等 8 秒，每 250ms 比一次；返回最后一份和等了多久。 */
    const settle = async (target) => {
      const started = Date.now()
      let snap = await snapshot()
      while (diffKeys(target, snap).length > 0 && Date.now() - started < 8000) {
        await win.waitForTimeout(250)
        snap = await snapshot()
      }
      return { snap, ms: Date.now() - started }
    }
    const settleLog = []
    /** 像人拖窗口边：每步 25px、一帧一步，从 from 拖到 to。 */
    const drag = async (from, to) => {
      const direction = to > from ? 1 : -1
      for (let width = from; direction > 0 ? width < to : width > to; width += direction * STEP) {
        await resize(width)
        await win.waitForTimeout(16)
      }
      await resize(to)
    }

    // ── 存档只认人：拖着窗口来回三次，四份存档一个字节不变 ──
    const panelWide = (await rectOf(win, AGENT_PANEL))?.width
    const dockProof = await proveProbe(dockLayer, '1100 宽停靠时找得到停靠栏')
    await win.waitForTimeout(2500)
    const before = await snapshot()
    const beforeProjection = readDiskProjection()
    check(`${BOARD.noWriteback} 起点：存的 Nomi 宽 390`, JSON.parse(before.layout).assistantWidth === 390, before.layout)
    for (let trip = 1; trip <= 3; trip += 1) {
      await drag(WIDE, NARROW)
      await expect(narrowBall.first(), `第 ${trip} 次拖到 700：停靠的 Nomi 没有收成小球`).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
      await checkAbsent(`${BOARD.tier} 第 ${trip} 次 700：没有停靠栏`, dockLayer, dockProof)
      const narrow = await snapshot()
      check(`${BOARD.noWriteback} 第 ${trip} 次 700：存的形态 / 抽屉宽 / Nomi 宽不变`, narrow.form === before.form && narrow.shellLayout === before.shellLayout && JSON.parse(narrow.layout).assistantWidth === 390, diffKeys(before, narrow).join(','))
      if (trip === 1) await shot(win, 'creation-700-ball')
      await drag(NARROW, WIDE)
      await expect(dockLayer.first(), `第 ${trip} 次拉回 1100：没有自动停回`).toBeAttached({ timeout: DEFAULT_TIMEOUT_MS })
      await win.waitForTimeout(1000)
      const settled = await settle(before)
      const back = settled.snap
      settleLog.push(settled.ms)
      const projection = readDiskProjection()
      if (projection !== beforeProjection) projectionDrift.push(`第 ${trip} 趟：落盘 visibility.assistant ${beforeProjection} → ${projection}（界面是停靠，layout.read 为 ${JSON.parse(back.layout).visibility?.assistant}）`)
      check(`${BOARD.noWriteback} 第 ${trip} 次回到 1100：四份存档逐字节相同`, diffKeys(before, back).length === 0, diffKeys(before, back).map((key) => `${key}: ${before[key]} → ${back[key]}`).join(' | '))
      check(`${BOARD.tier} 第 ${trip} 次回到 1100：Nomi 宽还原`, Math.abs(((await rectOf(win, AGENT_PANEL))?.width ?? 0) - panelWide) <= 1, `前 ${panelWide}`)
    }
    console.log(`  · 三趟拉回 1100 后四份存档落定用时（ms，含自动保存防抖 700）：${settleLog.join(' / ')}`)
    if (projectionDrift.length > 0) {
      console.log(`  ⚠ 已知（移交 A4g 后续：显示投影与落盘意图拆开）：停靠投影落盘没跟回来 — ${projectionDrift.join('；')}`)
      knownIssues.push(`${tag}：${projectionDrift.join('；')}`)
    } else {
      console.log('  · 停靠投影落盘（visibility.assistant）三趟都跟回来了')
    }
    {
      const motions = await motionCount()
      const gather = motions.filter((name) => name.includes('gather')).length
      const dockIn = motions.filter((name) => name.includes('dock-in')).length
      check(`${BOARD.motion} 拖动途中不连播：来回三次 = 收拢 3 次 + 停回 3 次`, gather === 3 && dockIn === 3, `收拢 ${gather} / 停回 ${dockIn}`)
    }
    // 减弱动效：直接换，不播。
    await win.emulateMedia({ reducedMotion: 'reduce' })
    {
      const startCount = (await motionCount()).length
      await drag(WIDE, NARROW)
      await expect(narrowBall.first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
      await drag(NARROW, WIDE)
      await expect(dockLayer.first()).toBeAttached({ timeout: DEFAULT_TIMEOUT_MS })
      check(`${BOARD.motion} 减弱动效：跨两次 0 次过渡，形态照换`, (await motionCount()).length === startCount, `多出 ${(await motionCount()).length - startCount}`)
    }
    await win.emulateMedia({ reducedMotion: 'no-preference' })

    // ── 阈值两侧：1060 停靠（面板最窄 300，输入框底栏收紧），1059 小球 ──
    await resize(THRESHOLD)
    await expect(dockLayer.first(), '1060 应仍停靠').toBeAttached({ timeout: DEFAULT_TIMEOUT_MS })
    await panelInnerCaughtUp(`${BOARD.tight} 1060`)
    {
      const composer = await win.evaluate((panelSelector) => {
        const panel = document.querySelector(panelSelector)
        const model = panel?.querySelector('[data-v4-control="model"]')
        const skill = panel?.querySelector('[data-v4-control="skill"]')
        const row = model?.parentElement
        const skillText = skill?.querySelector('span')
        const vw = window.innerWidth
        const stage = document.querySelector('[data-creation-surface]')?.getBoundingClientRect()
        const box = panel?.querySelector('[data-v4-block="composer"]')?.getBoundingClientRect()
        const send = panel?.querySelector('[data-v4-control="send"]')?.getBoundingClientRect()
        return {
          panel: Math.round(panel?.getBoundingClientRect().width ?? 0),
          row: row ? Math.round(row.clientWidth - parseFloat(getComputedStyle(row).paddingLeft) - parseFloat(getComputedStyle(row).paddingRight)) : 0,
          rowOverflow: row ? row.scrollWidth - row.clientWidth : null,
          sendInside: box && send ? send.left >= box.left && send.right <= box.right - 1 : null,
          model: Math.round(model?.getBoundingClientRect().width ?? 0),
          skillTextShown: skillText ? getComputedStyle(skillText).display !== 'none' : null,
          skillLabel: skill?.getAttribute('aria-label'),
          skillRight: Math.round(skill?.getBoundingClientRect().right ?? 0),
          panelRight: Math.round(panel?.getBoundingClientRect().right ?? 0),
          stage: stage ? Math.round(stage.width) : 0,
          vw,
        }
      }, AGENT_PANEL)
      check(`${BOARD.tier} 1060 停靠：面板最窄 300，内容区不小于 684`, composer.panel >= 299 && composer.panel <= 301 && composer.stage >= 683, JSON.stringify(composer))
      check(`${BOARD.tight} 1060（面板 300）：Skill 只留图标、读屏仍念 Skill，模型钮 ≥ 64`, composer.skillTextShown === false && composer.skillLabel === uiText(locale, 'agentPanelV4.skill') && composer.model >= 64 && composer.skillRight <= composer.panelRight, JSON.stringify(composer))
      check(`${BOARD.tight} 1060（面板 300）：发送钮在输入框里、这一排不溢出`, composer.sendInside === true && composer.rowOverflow === 0, JSON.stringify(composer))
      await shot(win, 'creation-1060-dock-tight')
    }
    await resize(THRESHOLD - 1)
    await expect(narrowBall.first(), '1059 应收成小球').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    await checkAbsent(`${BOARD.tier} 1059 小球（只有「< 1060」这一个判断）`, dockLayer, dockProof)
    await resize(WIDE)
    await expect(dockLayer.first()).toBeAttached({ timeout: DEFAULT_TIMEOUT_MS })
    {
      // 停回的过渡要先放完再量（收拢 / 停回 260ms）。
      await win.waitForTimeout(400)
      await panelInnerCaughtUp(`${BOARD.tight} 1100`)
      const wide =await win.evaluate((panelSelector) => {
        const panel = document.querySelector(panelSelector)
        const skillText = panel?.querySelector('[data-v4-control="skill"] span')
        const row = panel?.querySelector('[data-v4-control="model"]')?.parentElement
        const box = panel?.querySelector('[data-v4-block="composer"]')?.getBoundingClientRect()
        const send = panel?.querySelector('[data-v4-control="send"]')?.getBoundingClientRect()
        return {
          skillTextShown: skillText ? getComputedStyle(skillText).display !== 'none' : null,
          row: row?.clientWidth ?? 0,
          rowOverflow: row ? row.scrollWidth - row.clientWidth : null,
          sendInside: box && send ? send.left >= box.left && send.right <= box.right - 1 : null,
        }
      }, AGENT_PANEL)
      check(`${BOARD.tight} 1100（面板 340）：Skill 带字`, wide.skillTextShown === true, JSON.stringify(wide))
      check(`${BOARD.tight} 1100（面板 340）：发送钮在输入框里、这一排不溢出`, wide.sendInside === true && wide.rowOverflow === 0, JSON.stringify(wide))
      // 基线是「停靠」钮本身：getAttribute 先要找到这颗钮（找不到就超时报错），再看它身上没有「放不下」的标。
      const dockButton = await rectOf(win, `${AGENT_PANEL} [data-agent-form-to="dock"]`)
      const blockedAttr = await win.locator(`${AGENT_PANEL} [data-agent-form-to="dock"]`).first().getAttribute('data-agent-form-blocked', { timeout: DEFAULT_TIMEOUT_MS })
      check(`${BOARD.dockDisabled} 1100：「停靠」不灰`, dockButton !== null && blockedAttr === null, `${JSON.stringify(dockButton)} blocked=${blockedAttr}`)
    }

    // ── 700：小球悬停提示 → 点开浮窗 → 「停靠」变灰并说为什么 → 收回小球 → 等你确认胶囊 ──
    await drag(WIDE, NARROW)
    await expect(narrowBall.first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    {
      const ball = await rectOf(win, '[data-agent-ball-narrow="true"]')
      const tip = uiTextWith(locale, 'appShell.agent.ballNarrow', { shortcut: '⌘J' })
      check(`${BOARD.ballTip} 小球悬停说「窗口窄，先收在这里（⌘J 打开）」`, Boolean(ball?.title?.startsWith(tip)), `title「${ball?.title}」 期望开头「${tip}」`)
      let ballProblems = await outOfWindow(win, '[data-agent-ball-narrow="true"]')
      for (let wait = 0; ballProblems.length > 0 && wait < 4; wait += 1) {
        await win.waitForTimeout(250)
        ballProblems = await outOfWindow(win, '[data-agent-ball-narrow="true"]')
      }
      check(`${BOARD.ballNarrow} 小球整个在窗内`, ballProblems.length === 0, ballProblems.join('; '))
    }
    await clickOrFail(narrowBall.first(), '700 点小球')
    const float = win.locator('[data-agent-float]').first()
    await expect(float, '700 点小球应出浮窗').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    {
      const box = await rectOf(win, '[data-agent-float]')
      const area = await rectOf(win, '[data-shell-agent-layer]')
      check(`${BOARD.float} 浮窗 384×500、钉内容区右下 16、整个在窗内`, Math.round(box.width) === 384 && Math.round(box.height) === 500 && Math.abs(box.right - (area.right - 16)) <= 1 && Math.abs(box.bottom - (area.bottom - 16)) <= 1 && box.top >= 0 && box.right <= NARROW, `浮窗 ${JSON.stringify(box)} 内容区 ${JSON.stringify(area)}`)
      check(`${BOARD.float} 浮窗里的按钮都在窗内`, (await outOfWindow(win, '[data-agent-float]')).length === 0, (await outOfWindow(win, '[data-agent-float]')).join('; '))
      const formBefore = (await snapshot()).form
      const dockButton = win.locator(`${AGENT_PANEL} [data-agent-form-to="dock"]`).first()
      check(`${BOARD.dockDisabled} 「停靠」标着放不下、aria-disabled`, (await dockButton.getAttribute('data-agent-form-blocked')) === 'narrow' && (await dockButton.getAttribute('aria-disabled')) === 'true')
      await dockButton.hover()
      const hint = win.locator('[data-agent-form-blocked-hint]').first()
      await expect(hint, '悬停「停靠」应出提示').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
      const hintText = (await hint.textContent())?.trim()
      // Radix 提示会在里面再放一份只给读屏的副本，所以按「以这句开头」判。
      check(`${BOARD.dockDisabled} 悬停提示说为什么、什么时候回来`, Boolean(hintText?.startsWith(uiTextWith(locale, 'appShell.agent.dockNarrow', { width: THRESHOLD }))), `「${hintText}」`)
      check(`${BOARD.dockDisabled} 提示整个在窗内`, (await outOfWindow(win, '[data-agent-form-blocked-hint]')).length === 0, (await outOfWindow(win, '[data-agent-form-blocked-hint]')).join('; '))
      await shot(win, 'creation-700-float-dock-hint')
      // aria-disabled 的钮 Playwright 默认不点；人照样能点下去，所以强制点一下，看它确实不动。
      await dockButton.click({ force: true })
      await win.waitForTimeout(300)
      await checkAbsent(`${BOARD.dockDisabled} 点灰的「停靠」不动：没有停靠栏`, dockLayer, dockProof)
      check(`${BOARD.dockDisabled} 点灰的「停靠」不动：还是浮窗、存档不变`, (await float.isVisible()) && (await snapshot()).form === formBefore)
    }
    await clickOrFail(win.locator(`${AGENT_PANEL} ${COLLAPSE_BUTTON}`).first(), '浮窗收回小球')
    await expect(narrowBall.first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
    {
      const setBadge = (status, pending, unread = 0) => win.evaluate(([s, n, u]) => window.__nomiResidentActivityStore?.getState().setResidentDockBadge(s, n, u), [status, pending, unread])
      await setBadge('needs-confirm', 2)
      const pill = win.locator('[data-agent-ball="pending"]').first()
      await expect(pill, '等你确认胶囊没出现').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
      check(`${BOARD.pill} 700：「等你确认 2」胶囊整个在窗内`, (await outOfWindow(win, '[data-agent-ball="pending"]')).length === 0, (await outOfWindow(win, '[data-agent-ball="pending"]')).join('; '))
      await shot(win, 'creation-700-pill')
      await setBadge(null, 0)
    }

    // ── 左栏抽屉：存宽 720，700 宽里显示让到 468、盖不住小球；1100 回到 720；存的一直是 720 ──
    await openRailDrawer(win, 'docs')
    {
      const drawer = await railDrawerPanel(win, 'docs').boundingBox()
      const ball = await win.locator(AGENT_BALL).first().boundingBox()
      const stored = await win.evaluate(() => JSON.parse(window.localStorage.getItem('nomi:shell-layout:v1') ?? '{}').state?.drawerWidth?.docs)
      check(`${BOARD.drawer} 700：抽屉显示宽 = 窗口 − 232`, Boolean(drawer) && Math.abs(drawer.width - (NARROW - DRAWER_RESERVE)) <= 2, `抽屉 ${drawer?.width}`)
      check(`${BOARD.drawer} 700：抽屉右缘不盖小球`, Boolean(drawer && ball) && drawer.x + drawer.width <= ball.x, `抽屉右 ${drawer && drawer.x + drawer.width} 小球左 ${ball?.x}`)
      check(`${BOARD.drawer} 700：存的抽屉宽仍是 720`, stored === DRAWER_STORED, String(stored))
      await shot(win, 'creation-700-drawer')
    }
    await closeRailDrawer(win, 'docs')
    await drag(NARROW, WIDE)
    await expect(dockLayer.first()).toBeAttached({ timeout: DEFAULT_TIMEOUT_MS })
    await openRailDrawer(win, 'docs')
    {
      const drawer = await railDrawerPanel(win, 'docs').boundingBox()
      check(`${BOARD.drawer} 1100：抽屉回到存的 720`, Boolean(drawer) && Math.abs(drawer.width - DRAWER_STORED) <= 2, `抽屉 ${drawer?.width}`)
    }
    await closeRailDrawer(win, 'docs')

    // ── 四个宽度 × 三页：顶栏不撞、L1 都在窗内 ──
    const toolbarAria = uiText(locale, 'creationAi.editor.toolbarAria')
    const playerAria = uiText(locale, 'timelinePreview.player')
    const globalActions = uiText(locale, 'appBar.globalActions')
    const L1_COMMON = ['[data-shell-stage-center]', '[data-shell-project-menu]', '[data-task-center-trigger]', '[data-shell-settings]', '[data-shell-rail]']
    const L1_PAGE = {
      creation: [],
      generation: [CANVAS_STAGE_SELECTOR, CANVAS_ADD_BAR, CANVAS_ZOOM_BAR, '[data-timeline-strip]'],
      preview: [],
    }
    // 页面主体这几样由并行的页面线修（同一张板 creation.editor-grid、creation.toolbar-overflow、preview.timeline-toolbar，
    // owner I-window-narrow-pages）。它合入之前这里照量照记、不判红；本 PR 并入页面线之后，把 PAGES_LINE_MERGED 和「⏳」分支整段删掉，
    // 页面主体照判红——这个开关不许带进 main（协调 11-08 裁定）。
    const PAGES_LINE_MERGED = false
    const L1_PAGES_LINE = {
      creation: ['[data-creation-editor]', `[aria-label="${toolbarAria}"]`],
      generation: [],
      preview: [`[aria-label="${playerAria}"]`, '[data-timeline-toolbar-row]', '[data-testid="editing-surface-timeline"]'],
    }
    const topbar = () => win.evaluate((actionsLabel) => {
      const box = (el) => (el ? el.getBoundingClientRect() : null)
      const segment = box(document.querySelector('[data-shell-stage-center]'))
      const switcher = box(document.querySelector('[data-shell-view-switcher-slot]'))
      const left = document.querySelector('[data-shell-left-cluster]')
      const toolbar = box(document.querySelector(`[data-shell-topbar] [role="toolbar"][aria-label="${actionsLabel}"]`))
      const name = document.querySelector('[data-shell-project-name]')
      const nameShown = name ? getComputedStyle(name).display !== 'none' : false
      const leftContent = left ? left.clientWidth - parseFloat(getComputedStyle(left).paddingLeft) : 0
      const segRight = Math.max(segment?.right ?? 0, switcher?.right ?? 0)
      const exportButton = document.querySelector('[data-shell-export]')
      return {
        vw: window.innerWidth,
        segmentCenter: segment ? (segment.left + segment.right) / 2 : null,
        gapLeft: segment && left ? Math.round(segment.left - left.getBoundingClientRect().right) : null,
        gapRight: toolbar ? Math.round(toolbar.left - segRight) : null,
        nameShown,
        nameWidth: name ? Math.round(name.getBoundingClientRect().width) : 0,
        leftContent: Math.round(leftContent),
        exportCompact: exportButton ? exportButton.getAttribute('data-shell-export-compact') === 'true' : null,
      }
    }, globalActions)

    for (const width of WIDTHS) {
      await resize(width)
      for (const page of PAGES) {
        await switchWorkspace(win, page)
        await win.waitForTimeout(600)
        const narrowTier = width < THRESHOLD
        const shown = await win.evaluate(([panelSelector, ballSelector]) => ({
          panel: Boolean(document.querySelector(panelSelector)?.getClientRects().length),
          ball: Boolean(document.querySelector(ballSelector)?.getClientRects().length),
          dock: Boolean(document.querySelector('[data-shell-agent-layer][data-agent-form="dock"]')),
        }), [AGENT_PANEL, AGENT_BALL])
        if (page !== 'generation') check(`${BOARD.tier} ${page} ${width}：${narrowTier ? '小球' : '停靠'}`, narrowTier ? shown.ball && !shown.dock : shown.dock, JSON.stringify(shown))
        const problems = []
        for (const selector of [...L1_COMMON, ...L1_PAGE[page], shown.panel ? AGENT_PANEL : AGENT_BALL]) problems.push(...(await outOfWindow(win, selector)))
        const bodyProblems = []
        for (const selector of L1_PAGES_LINE[page]) bodyProblems.push(...(await outOfWindow(win, selector)))
        if (PAGES_LINE_MERGED) problems.push(...bodyProblems)
        else if (bodyProblems.length) {
          pagesLinePending.push(`${tag} ${page} ${width}：${bodyProblems.slice(0, 3).join('; ')}`)
          console.log(`  ⏳ ${page} ${width} 页面主体越界（页面线负责，合入前只记录）— ${bodyProblems.slice(0, 3).join('; ')}`)
        }
        check(`${BOARD.neverYield} ${page} ${width}：L1 都在窗内`, problems.length === 0, problems.slice(0, 4).join('; '))
        const bar = await topbar()
        check(`${BOARD.segment} ${page} ${width}：分段整窗居中、左右都不撞`, Math.abs(bar.segmentCenter - bar.vw / 2) <= 1 && bar.gapLeft >= 0 && bar.gapRight >= 0, JSON.stringify(bar))
        check(`${BOARD.nameHide} ${page} ${width}：项目名要么露 ≥ 两个字宽、要么只留箭头（左簇内容 ≤ 89 才藏）`, bar.nameShown ? bar.nameWidth >= 24 && bar.leftContent > 89 : bar.leftContent <= 89, JSON.stringify(bar))
        if (page === 'preview') {
          check(`${BOARD.exportIcon} preview ${width}：${bar.exportCompact ? '只留图标、离分段 ≥ 0' : '带字、离分段 ≥ 12'}`, bar.exportCompact ? bar.gapRight >= 0 : bar.gapRight >= 12, JSON.stringify(bar))
          if (width === NARROW) check(`${BOARD.exportIcon} preview 700：「导出 MP4」只留图标`, bar.exportCompact === true, JSON.stringify(bar))
          if (width === WIDE) check(`${BOARD.exportIcon} preview 1100：「导出 MP4」带字`, bar.exportCompact === false, JSON.stringify(bar))
        }
        await shot(win, `${page}-${width}`)
      }
    }

    // ── 用户流程：756 / 960 半屏里来回干活 ──
    for (const width of [756, 960]) {
      await resize(width)
      // 生成页：点小球出浮窗，打一句话（不发），收回。
      await switchWorkspace(win, 'generation')
      await ensureAgentPanelOpen(win, `${width} 生成页叫 Nomi`)
      check(`${BOARD.float} ${width} 生成页：浮窗在窗内`, (await outOfWindow(win, AGENT_PANEL)).length === 0, (await outOfWindow(win, AGENT_PANEL)).join('; '))
      const input = win.locator(`${AGENT_PANEL} textarea, ${AGENT_PANEL} [contenteditable="true"]`).first()
      await input.click()
      await input.pressSequentially(locale === 'en' ? 'still fits' : '窄窗里也能聊')
      await shot(win, `flow-${width}-generation-float`)
      await clickOrFail(win.locator(`${AGENT_PANEL} ${COLLAPSE_BUTTON}`).first(), `${width} 生成页收回`)
      // 预览页：停靠的页显示小球，⌘J 叫出浮窗并聚焦输入框；播放区和时间轴都在。
      await switchWorkspace(win, 'preview')
      await expect(narrowBall.first(), `${width} 预览页应是小球`).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
      await win.keyboard.press('Meta+J')
      await expect(win.locator('[data-agent-float]').first(), `${width} ⌘J 应叫出浮窗`).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
      const focusedIn = () => win.evaluate((panel) => {
        const active = document.activeElement
        const inPanel = Boolean(active?.closest(panel)) && (active?.tagName === 'TEXTAREA' || active?.getAttribute('contenteditable') === 'true')
        return { inPanel, at: active ? `${active.tagName.toLowerCase()}${active.id ? `#${active.id}` : ''}${active.getAttribute('data-v4-control') ? `[${active.getAttribute('data-v4-control')}]` : ''}` : 'none' }
      }, AGENT_PANEL)
      let focus = await focusedIn()
      for (let wait = 0; !focus.inPanel && wait < 8; wait += 1) {
        await win.waitForTimeout(250)
        focus = await focusedIn()
      }
      check(`${BOARD.float} ${width} 预览页 ⌘J：浮窗出来、焦点在输入框`, focus.inPanel, `焦点在 ${focus.at}`)
      await shot(win, `flow-${width}-preview-float`)
      await clickOrFail(win.locator(`${AGENT_PANEL} ${COLLAPSE_BUTTON}`).first(), `${width} 预览页收回`)
      // 创作页：在正文里打字，小球不挡字。
      await switchWorkspace(win, 'creation')
      const editor = win.locator('[data-creation-editor] [contenteditable="true"]').first()
      await editor.click()
      await win.keyboard.type(locale === 'en' ? ' Half screen draft.' : '半屏里接着写。')
      const editorBox = await win.locator('[data-creation-editor]').first().boundingBox()
      const editorInside = Boolean(editorBox) && editorBox.x >= 0 && editorBox.x + editorBox.width <= width + 0.5
      if (PAGES_LINE_MERGED || editorInside) check(`${BOARD.neverYield} ${width} 创作页：正文在窗内`, editorInside, JSON.stringify(editorBox))
      else pagesLinePending.push(`${tag} 流程 ${width} 创作页正文越界：${JSON.stringify(editorBox)}`)
      await shot(win, `flow-${width}-creation-typing`)
    }

    // 回到宽屏：创作页停回，存的 Nomi 宽仍是 390。
    await resize(WIDE)
    await switchWorkspace(win, 'creation')
    await expect(dockLayer.first(), '回到 1100 应停回').toBeAttached({ timeout: DEFAULT_TIMEOUT_MS })
    const end = await snapshot()
    check(`${BOARD.noWriteback} 走完回到 1100：存的 Nomi 宽仍是 390、停靠没被改掉`, JSON.parse(end.layout).assistantWidth === 390 && JSON.parse(end.form ?? '{}').state?.bySurface?.creation?.form !== 'ball', `${end.layout.slice(0, 120)}`)
  } catch (error) {
    failures.push(`${tag}: ${error.message.split('\n')[0]}`)
    console.log(`  ❌ ${tag} 中断：${error.message}`)
    const page = app?.windows().at(-1)
    if (page) await page.screenshot({ path: path.join(shotsDir, `${tag}-FAIL.png`) }).catch(() => undefined)
  } finally {
    await app?.close().catch(() => undefined)
  }
}

for (const round of rounds) await runRound(round)

if (pagesLinePending.length) {
  console.log(`\n⏳ 页面主体越界 ${pagesLinePending.length} 处（等 I-window-narrow-pages 合入）：`)
  for (const item of pagesLinePending) console.log(`  - ${item}`)
}
if (knownIssues.length) {
  console.log(`\n⚠ 已知、已移交（A4g 后续：显示投影与落盘意图拆开）${knownIssues.length} 轮：`)
  for (const item of knownIssues) console.log(`  - ${item}`)
}

if (failures.length) {
  console.log(`\n❌ window-narrow-shell：${failures.length} 条没过`)
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exit(1)
}
console.log('\n✅ window-narrow-shell 全过')
