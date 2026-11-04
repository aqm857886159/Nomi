// 走查：预览页窄窗侧栏（设计卡 docs/plan/2026-11-04-preview-narrow-panels.md，2026-11-04 用户拍板「先收属性」）。
//
// 真实用户任务：小屏笔记本（1280 宽）开着 Nomi 进预览页，要从左栏「镜头 / 素材」把镜头拖进成片，偶尔看一眼属性。
// 上一版在这里翻车：三栏最小宽 920 > 舞台 812，面板库把左栏吸成 32px，栏里却仍画展开内容——空态说明一字一行竖排，
// 「收起」拆成两行；关掉 Nomi 后两栏被按比例撑宽（属性 240 → 420）还被当成用户拖的存下。
//
// 每一步都量真实像素（左 / 预览 / 属性），对拍板数字逐项比，再查这一类的不变量：
//   ① 侧栏要么画收起条（宽 32），要么画展开内容且宽 ≥ 它的最小宽（左 240、属性 200）——展开内容永远不挤进窄列；
//   ② 窗口变宽变窄、开关 Nomi、点被让成条的那一栏，都不改存下的开合与栏宽（layout.read 读的就是 Agent 看到的那份）；
//   ③ 只有用户亲手拖分隔条才写回；拖成收起条 = 关掉那一栏；
//   ④ 展开的侧栏里没有东西越出栏边、没有被省略号截断（属性栏最窄 200 时，整片 / 视频 / 图片 / 字幕四种选中态逐个查——设计实验室只按默认 240 画过它）。
// 零额度：空画布 + 只有元数据的时间轴（不带媒体文件），不碰任何生成。中英两轨各跑一遍（NOMI_WALK_LOCALES=zh-CN,en 可选）。
// Run: pnpm run build && node tests/ux/preview-narrow-panels.walk.mjs
//      打包产物：NOMI_WALK_APP=release/mac-arm64/Nomi.app/Contents/MacOS/Nomi node tests/ux/preview-narrow-panels.walk.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { clickOrFail, expect, screenshotSettled, textLineBoxes } from './_assert.mjs'
import { collapseAgentPanel, ensureAgentPanelOpen, switchWorkspace } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { stationTimeout } from './_station-budget.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/preview-narrow-panels')
fs.mkdirSync(shotsDir, { recursive: true })
const executablePath = process.env.NOMI_WALK_APP ? path.resolve(process.env.NOMI_WALK_APP) : undefined
const locales = (process.env.NOMI_WALK_LOCALES || 'zh-CN,en').split(',').map((value) => value.trim()).filter(Boolean)

const HEIGHT = 933
const RAIL = 32
const MIN = { source: 240, inspector: 200 }
const TOLERANCE = 1
const SETTLE_MS = 3000

// 拍板清单 docs/design/boards/2026-11-04-preview-narrow-panels/PreviewNarrowPanels.board.json 的元素断言（check:board-parity 认这些名字）。
const BOARD = {
  readable: 'board:PreviewNarrowPanels/rule.readable-or-rail',
  keepsIntent: 'board:PreviewNarrowPanels/rule.window-change-keeps-intent',
  inspectorFirst: 'board:PreviewNarrowPanels/rule.collapse-inspector-first',
  railSwaps: 'board:PreviewNarrowPanels/rule.rail-click-swaps',
  dragWrites: 'board:PreviewNarrowPanels/rule.drag-writes-back',
  row1280Open: 'board:PreviewNarrowPanels/row.1280-nomi-open',
  row1280Closed: 'board:PreviewNarrowPanels/row.1280-nomi-closed',
  row1440Open: 'board:PreviewNarrowPanels/row.1440-nomi-open',
  row1440Closed: 'board:PreviewNarrowPanels/row.1440-nomi-closed',
  row1100Open: 'board:PreviewNarrowPanels/row.1100-nomi-open',
}

const failures = []
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const clip = (id, type, startFrame, endFrame) => ({
  id, type, sourceNodeId: `node-${id}`, label: id, startFrame, endFrame, frameCount: endFrame - startFrame + 60, offsetStartFrame: 0, offsetEndFrame: 0,
})
// 四种选中态都要有东西可选；配乐轨有一段，属性栏「配乐音量」滑块才是可用态（带读数）。
const TIMELINE = {
  version: 1, fps: 30, scale: 1, playheadFrame: 0,
  tracks: [
    { id: 'imageTrack', type: 'image', label: 'image', clips: [clip('clip-image', 'image', 0, 90)] },
    { id: 'videoTrack', type: 'video', label: 'video', clips: [clip('clip-video', 'video', 0, 120)] },
    { id: 'audioTrack', type: 'audio', label: 'audio', clips: [clip('clip-music', 'audio', 0, 120)] },
  ],
  textClips: [{ id: 'text-1', text: 'caption', startFrame: 0, endFrame: 90, style: 'caption' }],
  transitions: [],
}

function writeProject(projectsDir, projectId, name) {
  const root = path.join(projectsDir, projectId)
  fs.mkdirSync(path.join(root, '.nomi'), { recursive: true })
  const now = Date.now()
  // 不写 editingPanelLayout：新项目用默认布局（左 300 / 属性 240 / Nomi 390，两栏都开）——就是用户报问题时的样子。
  fs.writeFileSync(path.join(root, '.nomi', 'project.json'), JSON.stringify({
    id: projectId, name, version: 2, createdAt: now, updatedAt: now, savedAt: now, revision: 1, lastKnownRootPath: path.resolve(root),
    payload: { timeline: TIMELINE, generationCanvas: { nodes: [], edges: [], groups: [], selectedNodeIds: [] } },
  }))
}

async function runLocale(locale) {
  console.log(`\n── ${locale} ──`)
  const tag = locale === 'en' ? 'en' : 'zh'
  const tempRoot = makeTempDir('nomi-preview-narrow-')
  const projectsDir = path.join(tempRoot, 'projects')
  const projectName = `preview-narrow-${tag}`
  writeProject(projectsDir, `walk-${projectName}`, projectName)
  let app
  try {
    const launched = await launchNomiApp({
      name: `preview-narrow-panels-${tag}`, tempRoot, projectsDir, settleMs: 0, timeout: 300_000,
      ...(executablePath ? { executablePath } : {}),
      viewportSize: { width: 1280, height: HEIGHT },
      initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen', 'nomi-color-scheme': 'light', __nomiE2E: '1' },
    })
    app = launched.app
    let win = launched.win
    win.on('pageerror', (error) => console.log(`[renderer:pageerror] ${error.message}`))
    await clickOrFail(win.locator('[data-project-card]', { hasText: projectName }).first(), 'open project', { timeout: stationTimeout() })
    for (let i = 0; i < 40 && !app.windows().some((page) => /projectId=/.test(page.url())); i += 1) await win.waitForTimeout(250)
    win = app.windows().find((page) => /projectId=/.test(page.url())) ?? win

    const resize = async (width) => {
      const browserWindow = await app.browserWindow(win)
      await browserWindow.evaluate((windowRef, size) => windowRef.setContentSize(size.width, size.height), { width, height: HEIGHT })
      await win.setViewportSize({ width, height: HEIGHT })
    }
    await resize(1280)
    await win.locator('.nomi-stepper').first().waitFor({ timeout: stationTimeout({ operations: 2 }) })
    await switchWorkspace(win, 'preview')
    await ensureAgentPanelOpen(win, 'Nomi docked', { form: 'dock' })

    const measure = () => win.evaluate(() => {
      const panel = (id) => {
        const element = document.querySelector(`[data-panel][data-testid="${id}"]`)
        if (!element) return null
        return { width: Math.round(element.getBoundingClientRect().width), rail: Boolean(element.querySelector('.workbench-panel-rail')) }
      }
      return { viewport: window.innerWidth, source: panel('editing-surface-source'), preview: panel('editing-surface-preview'), inspector: panel('editing-surface-inspector') }
    })
    /** 展开的侧栏里越出栏左右边的可见元素与文字（被栏裁掉 = 看不全）。 */
    const overflowIn = (side) => win.evaluate((id) => {
      const panel = document.querySelector(`[data-panel][data-testid="${id}"]`)
      if (!panel || panel.querySelector('.workbench-panel-rail')) return []
      const box = panel.getBoundingClientRect()
      const outside = (rect) => rect.width > 0 && rect.height > 0 && rect.bottom > box.top && rect.top < box.bottom && (rect.right > box.right + 0.5 || rect.left < box.left - 0.5)
      const found = []
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node && found.length < 5; node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (!node.textContent.trim()) continue
          const range = document.createRange()
          range.selectNodeContents(node)
          if ([...range.getClientRects()].some(outside)) found.push(`text「${node.textContent.trim().slice(0, 24)}」`)
        } else {
          const style = getComputedStyle(node)
          if (style.visibility === 'hidden') continue
          const name = `${node.tagName.toLowerCase()}${node.getAttribute('aria-label') ? `[${node.getAttribute('aria-label')}]` : ''}`
          if (outside(node.getBoundingClientRect())) found.push(name)
          // 被省略号截断也算看不全（夹具里的名字都很短，截断只可能是栏太窄挤出来的）。
          else if (style.textOverflow === 'ellipsis' && node.scrollWidth > node.clientWidth + 1) found.push(`${name}…「${node.textContent.trim().slice(0, 24)}」`)
        }
      }
      return found
    }, `editing-surface-${side}`)
    const readIntent = async () => (await win.evaluate(() => window.__nomiCapabilityApply('layout.read', {}))).layout
    const describe = (m) => `${m.source?.rail ? 'rail' : m.source?.width} / ${m.preview?.width} / ${m.inspector?.rail ? 'rail' : m.inspector?.width}（视口 ${m.viewport}）`
    const near = (actual, wanted) => Math.abs(actual - wanted) <= TOLERANCE
    const matches = (m, [source, preview, inspector]) => {
      const side = (frame, wanted) => (wanted === 'rail' ? frame.rail && near(frame.width, RAIL) : !frame.rail && near(frame.width, wanted))
      return Boolean(m.source && m.preview && m.inspector) && side(m.source, source) && near(m.preview.width, preview) && side(m.inspector, inspector)
    }

    /** 等布局落定到拍板数字（窗口改尺寸、面板库换约束都要一两帧），再查这一类的不变量。 */
    const expectRow = async (label, wanted, board = []) => {
      let m = await measure()
      for (let waited = 0; !matches(m, wanted) && waited < SETTLE_MS; waited += 100) {
        await win.waitForTimeout(100)
        m = await measure()
      }
      check(`${label}：${wanted.join(' / ')}${board.length ? ` [${board.join(' ')}]` : ''}`, matches(m, wanted), `实际 ${describe(m)}`)
      for (const side of ['source', 'inspector']) {
        const frame = m[side]
        const readable = frame && (frame.rail ? near(frame.width, RAIL) : frame.width >= MIN[side] - TOLERANCE)
        check(`${label}：${side} 要么收起条要么 ≥ ${MIN[side]} [${BOARD.readable}]`, Boolean(readable), JSON.stringify(frame))
        const clipped = await overflowIn(side)
        check(`${label}：${side} 里没有东西越出栏边`, clipped.length === 0, clipped.join('、'))
      }
      if (m.source && !m.source.rail) {
        const lines = await textLineBoxes(win.locator('#editing-surface-source button[aria-label]').last())
        check(`${label}：左栏「${uiText(locale, 'previewSource.collapse')}」一行`, lines === 1, `${lines} 行`)
      }
      return m
    }
    const shot = async (name) => screenshotSettled(win, { path: path.join(shotsDir, `${name}-${tag}.png`) })
    const clickRail = (side) => clickOrFail(win.locator(`[data-panel][data-testid="editing-surface-${side}"] .workbench-panel-rail`).first(), `click ${side} rail`)
    const expectIntent = async (label, wanted) => {
      const layout = await readIntent()
      const actual = { sourceWidth: layout.sourceWidth, inspectorWidth: layout.inspectorWidth, source: layout.visibility.source, inspector: layout.visibility.inspector }
      check(`${label}：存档 ${JSON.stringify(wanted)} [${BOARD.keepsIntent}]`, JSON.stringify(actual) === JSON.stringify(wanted), `实际 ${JSON.stringify(actual)}`)
    }
    const defaults = { sourceWidth: 300, inspectorWidth: 240, source: true, inspector: true }

    // ── 用户报问题时的样子：1280 开 Nomi ──
    await expectRow('1280 开 Nomi', [300, 480, 'rail'], [BOARD.row1280Open, BOARD.inspectorFirst])
    await shot('1280-nomi-open')
    await clickRail('inspector')
    await expectRow('1280 开 Nomi · 点属性收起条', ['rail', 540, 240], [BOARD.row1280Open, BOARD.railSwaps])
    await shot('1280-nomi-open-inspector')
    await clickRail('source')
    await expectRow('1280 开 Nomi · 再点左栏收起条', [300, 480, 'rail'])

    await resize(1440)
    await expectRow('1440 开 Nomi', [292, 480, 200], [BOARD.row1440Open])
    await shot('1440-nomi-open')
    // 属性栏此刻是最窄的 200：四种选中态逐个查有没有被裁的读数 / 控件。
    const objectRow = win.locator('[data-testid="preview-inspector-object"]').first()
    const selections = [
      ['video', win.locator('.workbench-preview [data-track-type="video"] [data-testid="timeline-clip"]:visible').first()],
      ['image', win.locator('.workbench-preview [data-track-type="image"] [data-testid="timeline-clip"]:visible').first()],
      ['text', win.locator('.workbench-preview .workbench-timeline-text-clip[data-text-clip-id]:visible').first()],
    ]
    for (const [type, target] of selections) {
      await clickOrFail(target, `select ${type} clip`)
      await expect(objectRow, `选中 ${type} 后属性栏没切过去`).toHaveAttribute('data-object-type', type)
      await expectRow(`1440 开 Nomi · 属性栏 200 · 选中${type}`, [292, 480, 200])
      await shot(`1440-nomi-open-inspector-${type}`)
    }
    // 之后几步保持选中字幕：1100 点开属性栏（也是 200）时顺带看字幕那一组。

    await resize(1100)
    await expectRow('1100 开 Nomi', [240, 410, 'rail'], [BOARD.row1100Open])
    await shot('1100-nomi-open')
    await clickRail('inspector')
    await expectRow('1100 开 Nomi · 点属性收起条', ['rail', 450, 200], [BOARD.row1100Open, BOARD.railSwaps])
    await shot('1100-nomi-open-inspector')
    await clickRail('source')
    await expectRow('1100 开 Nomi · 再点左栏收起条', [240, 410, 'rail'])
    await expectIntent('改了三次窗口宽、点了四次收起条之后', defaults)

    // ── Nomi 关：侧栏保持用户的宽，多出来的给预览 ──
    await collapseAgentPanel(win, 'collapse Nomi')
    await resize(1280)
    await expectRow('1280 关 Nomi', [300, 670, 240], [BOARD.row1280Closed])
    await shot('1280-nomi-closed')
    await resize(1440)
    await expectRow('1440 关 Nomi', [300, 830, 240], [BOARD.row1440Closed])
    await shot('1440-nomi-closed')
    await ensureAgentPanelOpen(win, 'reopen Nomi', { form: 'dock' })
    // 1100 时外壳把超限的 Nomi 宽从 390 钳到 340（WorkbenchShell「窄窗只收上限」，09-01 定稿），回到 1440 不会自己放回去：
    // 舞台 1022，两栏都放得下（300 + 240，预览 482）。
    await expectRow('1440 重新开 Nomi（Nomi 已被钳到 340）', [300, 482, 240])
    await expectIntent('开关 Nomi 之后', defaults)

    // ── 只有用户亲手拖才写回 ──
    await collapseAgentPanel(win, 'collapse Nomi for drag')
    await expectRow('1440 关 Nomi（拖之前）', [300, 830, 240])
    const separators = win.locator('#editing-surface-stage-row > [role="separator"]')
    const drag = async (index, dx) => {
      const box = await separators.nth(index).boundingBox()
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await win.mouse.move(x, y)
      await win.mouse.down()
      for (let step = 1; step <= 10; step += 1) await win.mouse.move(x + (dx * step) / 10, y)
      await win.mouse.up()
    }
    await drag(0, 60)
    await expectRow('拖宽左栏 60', [360, 770, 240], [BOARD.dragWrites])
    await expectIntent('拖宽左栏之后', { ...defaults, sourceWidth: 360 })
    await resize(1280)
    await expectRow('拖宽后改窗口到 1280', [360, 610, 240])
    await expectIntent('拖宽后改窗口', { ...defaults, sourceWidth: 360 })
    await drag(1, 400)
    await expectRow('把属性拖成收起条', [360, 818, 'rail'], [BOARD.dragWrites])
    await expectIntent('拖成收起条之后', { ...defaults, sourceWidth: 360, inspector: false })
    await clickRail('inspector')
    await expectRow('点属性收起条重新打开', [360, 610, 240])
    await expectIntent('点收起条重新打开之后', { ...defaults, sourceWidth: 360 })
  } catch (error) {
    failures.push(`${locale}: ${String(error?.stack || error).slice(0, 800)}`)
    console.log(`  ❌ ${locale} 走查中断：${error?.message || error}`)
  } finally {
    await app?.close().catch(() => {})
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

for (const locale of locales) await runLocale(locale)
if (failures.length > 0) {
  console.log(`\n❌ preview-narrow-panels: ${failures.length} 处不对\n${failures.map((line) => `  · ${line}`).join('\n')}`)
  process.exit(1)
}
console.log(`\n✅ preview-narrow-panels: ${locales.join(' + ')} 全过；截图在 ${path.relative(repoRoot, shotsDir)}`)
