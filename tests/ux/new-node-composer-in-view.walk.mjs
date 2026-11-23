#!/usr/bin/env node
// 新建节点连同它的底栏一起落在看得见的地方（矮窗口里加节点，底栏的「模型 / 参数 / 发送」那一行不被时间轴条盖住）。
//
// 现场：13 寸笔记本上窗口约 1280×800，在加节点条点「图片」，节点落在画面中间，它下面的底栏有一截伸到底部时间轴条后面，
// 模型 / 参数 / 发送那一行看不见，要自己拖画布。新建落点只看整个舞台，没扣掉底部停靠条，也没给底栏留地方；对焦那条路早就扣了。
// 这条走查走真入口（加节点条上的钮），断言：
//   · 1280×800、1100×720：新建图片 / 视频 / 文字节点后，底栏最下面一行的按钮点得到、加节点条每个按钮点得到、再点一次加节点条能加出第二个节点（elementFromPoint 命中自己）；
//   · 1440×960（默认窗口）：新节点 x 与改前逐像素相同，y 只往上提（基线数写在下面 BASELINE_1440）；
//   · 1280×800：节点上方的标题小标签上沿不低于舞台上沿（没被切）、节点自己的小工具条下沿不低于节点上沿（没压在节点上）；
//   · 每种带底栏的节点：真实底栏卡高度 ≤ 落点给底栏留的「刚建出来的高度」且差 ≤ 24（数从 composerCanvasPlacement.ts 读，悄悄漂了就红）；
//   · 新建前后 .react-flow__viewport 的 transform 一字不变（程序不挪画布）。
// 中文浅色 + 英文深色各一轨。零额度：不点生成，隔离 profile，窗口在屏外。
// 用法：pnpm run build && node tests/ux/new-node-composer-in-view.walk.mjs
// 想只量不断言（改前复现用）：NOMI_WALK_MEASURE_ONLY=1
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { readCanvasViewport, sameCanvasViewport, waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { screenshotSettled } from './_assert.mjs'
import { addCanvasNode, canvasAddBar, CANVAS_ADD_BAR, newProjectEntry, switchWorkspace } from './_shell.mjs'

const MEASURE_ONLY = process.env.NOMI_WALK_MEASURE_ONLY === '1'
const shotsDir = process.env.NOMI_WALK_SHOTS_DIR || path.join(repoRoot, 'tests/ux/shots/new-node-composer-in-view')
fs.mkdirSync(shotsDir, { recursive: true })

const SIZES = [
  { name: '1280x800', width: 1280, height: 800, short: true },
  { name: '1100x720', width: 1100, height: 720, short: true },
  { name: '1440x960', width: 1440, height: 960, short: false },
]
const TRACKS = [
  { locale: 'zh-CN', scheme: 'light' },
  { locale: 'en', scheme: 'dark' },
]
const KINDS = ['image', 'video', 'text']

// 1440×960 空画布新建节点在主干（556bc3388）上量到的节点左上角（屏幕像素，视口 0,0 缩放 1）。改前改后都必须是这组数。
const BASELINE_1440 = {
  image: { x: 581.36, y: 285.28 },
  video: { x: 581.36, y: 285.28 },
  text: { x: 581.36, y: 285.28 },
}

const STAGE = '.generation-canvas-v2__stage'
const NODE = '.generation-canvas-v2-node[data-node-id]'
const COMPOSER_CARD = '.generation-canvas-v2-node__composer-card, [data-text-process-box]'
const FOOTER = '[data-node-composer-footer]'
const DOCKS = '[data-canvas-bottom-dock]'

// 落点给底栏留的「刚建出来的高度」：数只在 composerCanvasPlacement.ts 里写一处，走查读源码里的常量。
const placementSource = fs.readFileSync(path.join(repoRoot, 'src/workbench/generationCanvas/nodes/composerCanvasPlacement.ts'), 'utf8')
const readConst = (name) => Number(new RegExp(`const ${name} = (\\d+)`).exec(placementSource)?.[1])
const INITIAL_HEIGHT = { image: readConst('COMPOSER_INITIAL_HEIGHT'), video: readConst('COMPOSER_INITIAL_HEIGHT'), text: readConst('TEXT_COMPOSER_INITIAL_HEIGHT') }
const INITIAL_SLACK = 24
if (!Object.values(INITIAL_HEIGHT).every((n) => n > 0)) throw new Error('读不到 composerCanvasPlacement.ts 里的刚建出来的底栏高度常量，走查跟着改')

const failures = []
const rows = []

async function measure(win) {
  return win.evaluate(({ stage, node, card, footer, docks, addBar }) => {
    const rect = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom }
    }
    const stageEl = document.querySelector(stage)
    const nodeEl = document.querySelector(node)
    const cardEl = document.querySelector(card)
    const footerEl = document.querySelector(footer)
    const dockRects = Array.from(document.querySelectorAll(docks))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
    const topDock = dockRects.reduce((best, d) => (best === null || d.r.top < best ? d.r.top : best), null)
    const label = nodeEl ? nodeEl.querySelector('[data-node-label-row]') : null
    const toolbar = nodeEl ? nodeEl.querySelector('[data-node-floating-toolbar]') : null
    const buttons = footerEl ? Array.from(footerEl.querySelectorAll('button')) : []
    const lowest = buttons.reduce((m, b) => Math.max(m, b.getBoundingClientRect().bottom), -Infinity)
    const bottomRow = buttons
      .filter((b) => Math.abs(b.getBoundingClientRect().bottom - lowest) < 4)
      .map((b) => {
        const r = b.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const hit = document.elementFromPoint(cx, cy)
        return { label: b.getAttribute('aria-label') || (b.textContent || '').trim().slice(0, 12), ok: !!hit && (hit === b || b.contains(hit)), cy }
      })
    const addBarButtons = Array.from(document.querySelectorAll(addBar + ' button')).map((b) => {
      const r = b.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { label: b.getAttribute('aria-label') || (b.textContent || '').trim().slice(0, 12), ok: r.width > 0 && !!hit && (hit === b || b.contains(hit)) }
    })
    return {
      addBarButtons,
      innerHeight,
      stage: rect(stageEl),
      node: rect(nodeEl),
      card: rect(cardEl),
      label: rect(label),
      toolbar: rect(toolbar),
      topDock,
      docks: dockRects.map(({ el, r }) => ({ cls: String(el.className).slice(0, 40), top: r.top, left: r.left, right: r.right, bottom: r.bottom })),
      bottomRow,
    }
  }, { stage: STAGE, node: NODE, card: COMPOSER_CARD, footer: FOOTER, docks: DOCKS, addBar: CANVAS_ADD_BAR })
}

function fail(message) {
  failures.push(message)
  console.log(`  FAIL ${message}`)
}

async function runCombo(size, track) {
  const tag = `${size.name}.${track.locale}.${track.scheme}`
  const { app, win } = await launchNomiApp({
    name: `new-node-composer-in-view-${size.name}`,
    viewportSize: { width: size.width, height: size.height },
    args: ['--no-proxy-server'],
    settleMs: 0,
    initialLocalStorage: {
      'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen',
      'nomi:canvas-gesture-hint:v1': 'seen',
      'nomi:locale:v1': track.locale,
      'nomi-color-scheme': track.scheme,
    },
  })
  try {
    await newProjectEntry(win).click()
    await switchWorkspace(win, 'generation', '切到生成工作区')
    await win.locator(STAGE).first().waitFor()
    await waitForCanvasViewportSettled(win)
    for (const kind of KINDS) {
      const before = await readCanvasViewport(win)
      await addCanvasNode(win, kind)
      await win.locator(NODE).first().waitFor()
      await win.waitForTimeout(700)
      const after = await readCanvasViewport(win)
      const m = await measure(win)
      const label = `${tag} ${kind}`
      rows.push({ label, m, before, after })
      console.log(`${label}: ${JSON.stringify({ node: m.node, card: m.card, label: m.label, toolbar: m.toolbar, stage: m.stage, topDock: m.topDock, bottomRow: m.bottomRow })}`)
      await screenshotSettled(win, { path: path.join(shotsDir, `${tag}.${kind}.png`) })
      if (!MEASURE_ONLY) {
        if (!sameCanvasViewport(before, after)) fail(`${label}：新建后视口变了 ${JSON.stringify(before)} → ${JSON.stringify(after)}`)
        if (m.card && INITIAL_HEIGHT[kind]) {
          const real = m.card.h
          if (real > INITIAL_HEIGHT[kind] + 0.5) fail(`${label}：真实底栏高 ${real.toFixed(1)} 比落点留的刚建出来高度 ${INITIAL_HEIGHT[kind]} 还高（数漂了）`)
          if (INITIAL_HEIGHT[kind] - real > INITIAL_SLACK) fail(`${label}：落点留的刚建出来高度 ${INITIAL_HEIGHT[kind]} 比真实底栏高 ${real.toFixed(1)} 多留了 ${(INITIAL_HEIGHT[kind] - real).toFixed(1)}，超过 ${INITIAL_SLACK}（数漂了）`)
        }
        if (size.name === '1280x800') {
          // 标题小标签没被舞台上沿切；小工具条不压在节点上（选中时才出现，新建即选中）。视频与图片同标准，不放豁免。
          if (!m.label) fail(`${label}：没找到标题小标签`)
          else if (m.label.y < m.stage.y - 0.5) fail(`${label}：标题小标签上沿 ${m.label.y.toFixed(1)} 高过舞台上沿 ${m.stage.y.toFixed(1)}，被切`)
          if (!m.toolbar) fail(`${label}：没找到节点小工具条`)
          else if (m.toolbar.bottom > m.node.y + 0.5) fail(`${label}：小工具条下沿 ${m.toolbar.bottom.toFixed(1)} 压在节点上沿 ${m.node.y.toFixed(1)} 之下`)
        }
        if (size.short) {
          // 判据是「点得到」，不是边线：1100×720 下底栏卡自己的下内边距可以伸进停靠条上沿几像素，里面的按钮仍点得到。
          const bad = m.bottomRow.filter((b) => !b.ok)
          if (bad.length) fail(`${label}：底栏最下一行点不到：${bad.map((b) => b.label).join(' / ')}`)
          if (!m.bottomRow.length && kind !== 'text') fail(`${label}：没找到底栏按钮`)
          const badBar = m.addBarButtons.filter((b) => !b.ok)
          if (!m.addBarButtons.length) fail(`${label}：没找到加节点条按钮`)
          if (badBar.length) fail(`${label}：加节点条上点不到：${badBar.map((b) => b.label).join(' / ')}`)
          // 不先点空白处取消选择，直接再点一次加节点条，要能加出第二个节点。
          await canvasAddBar(win).locator('[data-add-intent="image"]').first().click({ timeout: 3000 }).catch(() => {})
          await win.waitForTimeout(500)
          const count = await win.locator(NODE).count()
          if (count !== 2) fail(`${label}：再点一次加节点条没加出第二个节点（节点数 ${count}）`)
          await win.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
          await win.waitForTimeout(300)
        } else {
          // 默认窗口：x 与主干基线逐像素相同；y 只许往上提（带底栏的种类整块放不下时才提），文字节点整块放得下 → 不动；底栏卡下沿仍在停靠条上沿之上。
          const want = BASELINE_1440[kind]
          if (want && m.node) {
            if (Math.abs(m.node.x - want.x) > 0.5) fail(`${label}：1440×960 落点 x ${m.node.x} 不等于主干基线 ${want.x}`)
            if (m.node.y > want.y + 0.5) fail(`${label}：1440×960 落点 y ${m.node.y} 比主干基线 ${want.y} 还低（只许往上提）`)
            if (kind === 'text' && Math.abs(m.node.y - want.y) > 0.5) fail(`${label}：1440×960 文字节点整块放得下，落点 y ${m.node.y} 应等于主干基线 ${want.y}`)
          }
          // 默认窗口所有节点落点和主干差都不超过 20 像素（视频出生即 420×236、图片 340×340，不再按避让足迹虚抬）。
          if (want && m.node && want.y - m.node.y > 20) fail(`${label}：1440×960 落点 y ${m.node.y} 比主干基线 ${want.y} 提高了 ${(want.y - m.node.y).toFixed(1)}，超过 20`)
          if (m.card && m.topDock !== null && m.card.bottom > m.topDock + 0.5) fail(`${label}：1440×960 底栏下沿 ${m.card.bottom.toFixed(1)} 压到停靠条上沿 ${m.topDock.toFixed(1)} 下面`)
        }
      }
      // 撤销这次新建，回到空画布再量下一种（Cmd/Ctrl+Z 是产品的撤销，不是绕过界面写 store）。
      await win.locator(STAGE).first().click({ position: { x: 4, y: 4 }, force: true }).catch(() => {})
      await win.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
      await win.waitForTimeout(300)
      if ((await win.locator(NODE).count()) > 0) fail(`${label}：撤销后画布上还有节点，下一种量不准`)
    }
  } finally {
    await app.close().catch(() => {})
  }
}

for (const size of SIZES) for (const track of TRACKS) await runCombo(size, track)

fs.writeFileSync(path.join(shotsDir, 'rows.json'), JSON.stringify(rows, null, 2))
if (failures.length) {
  console.log(`new-node-composer-in-view: ${failures.length} FAIL`)
  process.exit(1)
}
console.log(`new-node-composer-in-view: ${MEASURE_ONLY ? 'MEASURED' : 'OK'}`)
