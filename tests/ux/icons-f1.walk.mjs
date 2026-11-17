// F1 图标四档走查：真 Electron（先 pnpm build）、隔离资料、零额度。拍板清单 docs/design/boards/2026-10-18/IconsF1.board.json。
//
// 四个面（节点浮条与媒体控件 / 生成框底栏 / 顶栏 / 空态）逐个宿主量**渲染尺寸**：svg 的 getBoundingClientRect 宽高
// （按宿主的变换缩放折回 CSS 像素）+ 描边那条 path 的 computed stroke-width，**不读 svg 属性**——第 2 轮读的是属性，
// 按钮的 [&>svg] 把属性盖成 16 / 2 了照样报绿（方向检查 docs/engineering/direction-checks/2026-10-24-icon-size-owner.md）。
// 同时记按钮盒和图标中心偏差，给改前 / 改后对账用。
//
// 用法：node tests/ux/icons-f1.walk.mjs --locale zh-CN|en --scheme light|dark [--measure-only] [--out <目录>]
//   --measure-only：只量、只截图、不判——给改前构建拍同一取景的对照用。
import fs from 'node:fs'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'
import { expect } from '@playwright/test'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { canvasResetView, switchWorkspace } from './_shell.mjs'
import { proveProbe, screenshotSettled, waitForVisualQuiescence } from './_assert.mjs'
import { waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { uiText } from './full-walk/invariants.mjs'

const { createWorkspaceProject } = tsxRequire('../../electron/workspace/workspaceRepository.ts', import.meta.url)
const { GENERATION_NODE_PLUGINS } = tsxRequire('../../src/workbench/generationCanvas/nodes/registry.ts', import.meta.url)
const { ICON_TIERS } = tsxRequire('../../src/design/iconTiers.ts', import.meta.url)

const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i < 0 ? fallback : process.argv[i + 1] }
const locale = arg('--locale', 'zh-CN'), scheme = arg('--scheme', 'light')
const measureOnly = process.argv.includes('--measure-only')
const tag = `${locale === 'en' ? 'en' : 'zh'}-${scheme}`
const output = path.resolve(arg('--out', path.join(repoRoot, 'docs/evidence/2026-10-24-icons-f1-r3')))
const tempRoot = makeTempDir('nomi-icons-f1-')
const settingsDir = path.join(tempRoot, 'settings'), projectsDir = path.join(tempRoot, 'projects')
const projectId = 'icons-f1', projectRoot = path.join(projectsDir, projectId)
fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(settingsDir, { recursive: true })

const sizeOf = (kind) => ({ ...GENERATION_NODE_PLUGINS.find((plugin) => plugin.kind === kind).defaultSize })
const assetUrl = (name) => `nomi-local://asset/${encodeURIComponent(projectId)}/assets/generated/${name}`
const node = (id, kind, position, extra = {}) => ({
  id, kind, position, title: locale === 'en' ? 'Rainy street' : '雨夜街口', categoryId: 'shots', prompt: '', status: 'idle', meta: {}, size: sizeOf(kind), ...extra,
})
const resultNode = (id, kind, position, result) => node(id, kind, position, { status: 'success', result: { id: `${id}-v1`, createdAt: 1, ...result }, history: [] })
const SCENES = {
  emptyBrowsing: [node('empty-image', 'image', { x: 160, y: 140 }, { size: { width: 320, height: 240 } }), node('empty-audio', 'audio', { x: 560, y: 220 }), node('empty-director', 'director', { x: 1060, y: 140 })],
  composer: [node('composer-image', 'image', { x: 200, y: 100 }, { size: { width: 320, height: 240 } })],
  // 240×135 的视频卡（默认模型 16:9，渲染卡高 135 < 166）选中后收成紧凑档：圆盘 24 + 一行字，就是拍板板上的「窄条」样子。
  // 不用矮图片卡：默认图片模型写回 1:1，卡高跟着长到 240，进的是完整档。
  compactEngaged: [node('short-video', 'video', { x: 200, y: 160 }, { size: { width: 240, height: 135 } })],
  imageToolbar: [resultNode('result-image', 'image', { x: 260, y: 220 }, { type: 'image', url: assetUrl('rain.svg'), thumbnailUrl: assetUrl('rain.svg') })],
  videoPlayer: [resultNode('result-video', 'video', { x: 260, y: 220 }, { type: 'video', url: assetUrl('demo.mp4'), thumbnailUrl: assetUrl('rain.svg') })],
}

createWorkspaceProject({ rootPath: projectRoot, record: { id: projectId, name: 'Icons F1', payload: {
  generationCanvas: { nodes: SCENES.emptyBrowsing, edges: [], groups: [], selectedNodeIds: [], canvasZoom: 1, canvasPan: { x: 0, y: 0 } },
  timeline: null, workbenchDocument: null,
} } }, { settingsRoot: settingsDir, defaultProjectsRoot: projectsDir })
fs.mkdirSync(path.join(projectRoot, 'assets', 'generated'), { recursive: true })
fs.writeFileSync(path.join(projectRoot, 'assets', 'generated', 'rain.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#d69072"/><stop offset="1" stop-color="#34465f"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#g)"/><path d="M0 560L260 330l220 170 200-190 600 400H0z" fill="#141820" opacity=".7"/></svg>`)
fs.copyFileSync(path.join(repoRoot, 'marketing/assets/demo.mp4'), path.join(projectRoot, 'assets', 'generated', 'demo.mp4'))

const run = await launchNomiApp({ name: 'icons-f1', tempRoot, settingsDir, projectsDir,
  userDataDir: path.join(tempRoot, 'user-data'), settleMs: 0, viewportSize: { width: 1680, height: 1050 },
  initialLocalStorage: { 'nomi:locale:v1': locale, 'nomi-color-scheme': scheme, '__nomiE2E': '1', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
})
let win = run.win
const report = { locale, scheme, mode: measureOnly ? 'measure-only' : 'assert', boundary: 'built macOS Electron; isolated profile and fixture project; rendered geometry only; no generation requested', hosts: [], checks: [], screenshots: [] }
const failures = []
// 量过、还没拍进截图的宿主：下一张截图把它们的盒子位置记成裁切框（对照图按同一宿主、同一取景裁）。
const pendingHosts = []

/** 一个宿主：页内找到那颗 svg，量渲染尺寸、描边、按钮盒、中心偏差（全部折回 CSS 像素）。 */
async function measure(face, host, selector, tier) {
  const found = await win.evaluate((sel) => {
    const svg = document.querySelector(sel)
    if (!svg) return null
    const box = svg.closest('button') ?? svg.parentElement
    const svgRect = svg.getBoundingClientRect(), boxRect = box.getBoundingClientRect()
    const scale = box.offsetWidth > 0 ? boxRect.width / box.offsetWidth : 1
    const stroked = svg.querySelector('path:not([stroke="none"]), line, circle, rect, polyline') ?? svg
    const center = (rect) => [rect.left + rect.width / 2, rect.top + rect.height / 2]
    const [sx, sy] = center(svgRect), [bx, by] = center(boxRect)
    const round = (value) => Math.round(value * 100) / 100
    return {
      width: round(svgRect.width / scale), height: round(svgRect.height / scale), strokeWidth: round(Number.parseFloat(getComputedStyle(stroked).strokeWidth)),
      scale: round(scale), box: { width: round(boxRect.width / scale), height: round(boxRect.height / scale) }, centerDelta: { x: round((sx - bx) / scale), y: round((sy - by) / scale) },
      rect: { x: round(boxRect.left), y: round(boxRect.top), width: round(boxRect.width), height: round(boxRect.height) },
    }
  }, selector)
  if (!found) {
    const seen = await win.evaluate(() => [...document.querySelectorAll('article[data-node-id]')]
      .map((card) => `${card.getAttribute('data-node-id')}:${[...card.querySelectorAll('[data-node-empty-state]')].map((el) => el.getAttribute('data-empty-tier') ?? '(none)').join('/') || '-'}`).join(' '))
    console.log(`  没找到 ${selector}；页面上的节点与空态档：${seen}`)
  }
  const expected = tier ? ICON_TIERS[tier] : null
  const pass = Boolean(found) && (!expected || (Math.abs(found.width - expected.size) <= 0.5 && Math.abs(found.height - expected.size) <= 0.5 && Math.abs(found.strokeWidth - expected.stroke) <= 0.01))
  const entry = { face, host, selector, tier, expected, rendered: found, pass }
  report.hosts.push(entry)
  if (found) pendingHosts.push(entry)
  console.log(`${pass ? '·' : '✗'} ${face} · ${host}: ${found ? `${found.width}×${found.height} / ${found.strokeWidth}（盒 ${found.box.width}×${found.box.height}，偏 ${found.centerDelta.x},${found.centerDelta.y}）` : '没找到'}${expected ? ` 期望 ${expected.size} / ${expected.stroke}` : ''}`)
  if (!measureOnly && expected && !pass) failures.push(`${face} · ${host}`)
  return entry
}

function check(id, hosts, detail) {
  const pass = hosts.every((entry) => entry.pass)
  report.checks.push({ id, pass, detail })
  console.log(`${pass ? '✓' : '✗'} ${id}: ${detail}`)
}

async function shot(name, selectors, pad = 16) {
  const clip = await win.evaluate(({ list, margin }) => {
    const rects = list.flatMap((sel) => [...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect())).filter((rect) => rect.width > 0)
    // 取景要先找到元素：一个都没找到 → 返回 null → 下面的 expect 当场红（这是「必须存在」，不是「不存在」断言）。
    if (!rects.length) return null
    const left = Math.max(0, Math.min(...rects.map((r) => r.left)) - margin), top = Math.max(0, Math.min(...rects.map((r) => r.top)) - margin)
    const right = Math.min(window.innerWidth, Math.max(...rects.map((r) => r.right)) + margin), bottom = Math.min(window.innerHeight, Math.max(...rects.map((r) => r.bottom)) + margin)
    return { x: left, y: top, width: right - left, height: bottom - top }
  }, { list: selectors, margin: pad })
  expect(clip, `${name}：取景的元素一个都没找到`).not.toBeNull()
  const file = path.join(output, `${name}-${tag}.png`)
  await screenshotSettled(win, { path: file, clip })
  report.screenshots.push(path.relative(repoRoot, file))
  for (const entry of pendingHosts.splice(0)) {
    const { rect } = entry.rendered
    const inside = rect.x >= clip.x - 0.5 && rect.y >= clip.y - 0.5 && rect.x + rect.width <= clip.x + clip.width + 0.5 && rect.y + rect.height <= clip.y + clip.height + 0.5
    if (inside) entry.crop = { shot: path.basename(file), x: rect.x - clip.x, y: rect.y - clip.y, width: rect.width, height: rect.height }
  }
}

async function put(nodes, selectedId) {
  // 摆场景（状态矩阵）用 E2E 桥写 store；量的是摆好之后真组件的渲染。
  await win.evaluate((value) => window.__nomiCanvasStore.setState({ nodes: value, groups: [], edges: [], selectedNodeIds: [] }), nodes)
  await expect(win.locator('article[data-node-id]')).toHaveCount(nodes.length)
  await canvasResetView(win); await waitForCanvasViewportSettled(win)
  if (selectedId) await win.evaluate((id) => window.__nomiCanvasStore.getState().selectNode(id), selectedId)
  await waitForVisualQuiescence(win)
}

const article = (id) => `article[data-node-id="${id}"]`
try {
  await win.locator('[data-project-card]', { hasText: 'Icons F1' }).click()
  await expect.poll(() => run.app.windows().some((w) => w.url().includes(`projectId=${projectId}`))).toBe(true)
  win = run.app.windows().find((w) => w.url().includes(`projectId=${projectId}`))
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await win.waitForFunction(() => Boolean(window.__nomiCanvasStore))

  // ── 空态：大 / 中空态 24 / 1.5（导演节点内嵌也是大卡）；节点窄条（音频条）和矮卡紧凑档 13 / 1.8（D3 / D4）。
  await put(SCENES.emptyBrowsing)
  await proveProbe(win.locator(`${article('empty-audio')} [data-node-empty-state] svg`), 'audio strip empty mark is mounted')
  const empty = [
    await measure('empty.states', 'image · browsing (icon tier)', `${article('empty-image')} [data-node-empty-state][data-empty-tier="icon"] svg`, 'empty'),
    await measure('empty.states', 'audio strip · browsing', `${article('empty-audio')} [data-node-empty-state] svg`, 'corner'),
    await measure('empty.states', 'director inline · browsing', `${article('empty-director')} [data-node-empty-state] svg`, 'empty'),
  ]
  await shot('empty-states', [article('empty-image'), article('empty-audio'), article('empty-director')])
  for (const [id, host, tier] of [['empty-audio', 'audio strip · selected', 'corner'], ['empty-director', 'director inline · selected', 'empty']]) {
    await win.evaluate((nodeId) => window.__nomiCanvasStore.getState().selectNode(nodeId), id)
    await expect(win.locator(`${article(id)} [data-node-empty-state]`)).not.toHaveAttribute('data-empty-tier', 'icon')
    await waitForVisualQuiescence(win)
    empty.push(await measure('empty.states', host, `${article(id)} [data-node-empty-state] svg`, tier))
    // 每选一个就拍一张：选下一个时上一个回到浏览态，合拍会拿错状态。
    await shot(`${id}-selected`, [article(id)])
  }
  await put(SCENES.compactEngaged, 'short-video')
  empty.push(await measure('empty.states', 'short video · selected (compact tier)', `${article('short-video')} [data-node-empty-state][data-empty-tier="compact"] svg`, 'corner'))
  await shot('empty-compact-selected', [article('short-video')])

  // ── 生成框底栏：参考入口条档 18 / 1.8；▾ 角标 13 / 1.8；工具与生成箭头 16 / 2（D1 / D2 / D3）。
  await put(SCENES.composer, 'composer-image')
  const composerCard = `${article('composer-image')} .generation-canvas-v2-node__composer-card`
  await proveProbe(win.locator(`${composerCard} [data-node-composer-footer]`), 'selected image node shows its composer')
  empty.push(await measure('empty.states', 'image · selected (full tier)', `${article('composer-image')} [data-node-empty-state][data-empty-tier="full"] svg`, 'empty'))
  await shot('empty-full-selected', [`${article('composer-image')} [data-node-empty-state]`])
  const composer = [
    await measure('composer.bar', 'reference add tile ＋', `${composerCard} [data-asset-add-tile] > svg`, 'bar'),
    await measure('composer.bar', 'reference pointer entry', `${composerCard} [data-reference-entry] > svg`, 'bar'),
    await measure('composer.bar', 'parameter summary ▾', `${composerCard} [data-parameter-summary] > svg`, 'corner'),
    await measure('composer.bar', 'prompt tool (first)', `${composerCard} [data-prompt-tool-cluster] button > svg.tabler-icon`, 'tool'),
    await measure('composer.bar', 'generate ↑', `${composerCard} [data-bar-segment="generate"] > svg`, 'tool'),
  ]
  await measure('composer.bar', 'model chip ▾ (NomiSelect, outside F1 code scope)', `${composerCard} [data-bar-segment="model-params"] button svg.tabler-icon-chevron-down`, null)
  await shot('composer-bar', [composerCard])
  check('board:IconsF1/composer.bar', composer, 'reference entries 18/1.8, summary ▾ 13/1.8, prompt tools and generate arrow 16/2 — rendered geometry')

  // ── 节点浮条：条档 18 / 1.8；视频播放器控件工具档 16 / 2（D1 / D2）。
  await put(SCENES.imageToolbar, 'result-image')
  const toolbar = '[data-node-floating-toolbar]'
  await proveProbe(win.locator(`${toolbar} [data-toolbar-action]`), 'image result shows its floating toolbar')
  // 菜单触发钮的主图标是第一个 svg、▾ 永远是最后一个；拆分钮的 ▾ 触发钮只有 ▾（不是条档宿主，下面单独记）。
  const toolbarHosts = await win.evaluate((sel) => [...document.querySelectorAll(`${sel} [data-toolbar-action] > svg:first-child, ${sel} [data-toolbar-action-menu] > svg:first-child:not(:last-child)`)].map((svg) => {
    const button = svg.closest('button')
    return button.getAttribute('data-toolbar-action') ?? button.getAttribute('data-toolbar-action-menu')
  }), toolbar)
  const nodeHosts = []
  for (const action of [...new Set(toolbarHosts)]) {
    nodeHosts.push(await measure('node.toolbar', `toolbar · ${action}`, `${toolbar} [data-toolbar-action="${action}"] > svg:first-child, ${toolbar} [data-toolbar-action-menu="${action}"] > svg:first-child:not(:last-child)`, 'bar'))
  }
  await measure('node.toolbar', 'split menu ▾ (ToolbarActionMenu, outside F1 code scope)', `${toolbar} [data-toolbar-action-menu] > svg:last-child`, null)
  await shot('node-toolbar', [toolbar, article('result-image')])
  await put(SCENES.videoPlayer, 'result-video')
  await proveProbe(win.locator(`${article('result-video')} [data-node-video-controls] button > svg`), 'video result shows its player controls')
  nodeHosts.push(await measure('node.toolbar', 'video player · play', `${article('result-video')} [data-node-video-controls] button > svg`, 'tool'))
  nodeHosts.push(await measure('node.toolbar', 'video player · mute', `${article('result-video')} [data-node-video-controls] button:nth-of-type(2) > svg`, 'tool'))
  await shot('node-video', [toolbar, article('result-video')])
  check('board:IconsF1/node.toolbar', nodeHosts, 'floating toolbar actions 18/1.8, video player controls 16/2 — rendered geometry')
  check('board:IconsF1/empty.states', empty, 'big / medium empty states (incl. director inline) 24/1.5, audio strip and compact tier 13/1.8 — rendered geometry')

  // ── 顶栏（预览页才有布局与导出）：图标条档 18 / 1.8；项目名 ▾、导出、布局 ▾ 角标 13 / 1.8（D1 / D3）。
  await switchWorkspace(win, 'preview', 'open preview for the full topbar')
  const topbar = '[data-shell-topbar]'
  const layout = `${topbar} button[aria-haspopup="menu"][aria-label="${uiText(locale, 'timelinePreview.previewLayout.title')}"]`
  await proveProbe(win.locator(`${topbar} [data-shell-export] > svg`), 'preview topbar shows Export with its icon')
  await waitForVisualQuiescence(win)
  const topbarHosts = [
    await measure('topbar', 'project ▾', `${topbar} [data-shell-project-menu] > svg`, 'corner'),
    await measure('topbar', 'layout menu icon', `${layout} > svg:first-child`, 'bar'),
    await measure('topbar', 'layout menu ▾', `${layout} > svg:last-child`, 'corner'),
    await measure('topbar', 'export', `${topbar} [data-shell-export] > svg`, 'corner'),
    await measure('topbar', 'task center', `${topbar} [data-task-center-trigger] > svg`, 'bar'),
    await measure('topbar', 'browser', `${topbar} [data-shell-browser] > svg`, 'bar'),
    await measure('topbar', 'settings', `${topbar} [data-shell-settings] > svg`, 'bar'),
  ]
  await shot('topbar', [topbar], 0)
  check('board:IconsF1/topbar', topbarHosts, 'bar icons 18/1.8, project ▾ / export / layout ▾ 13/1.8 — rendered geometry')

  fs.writeFileSync(path.join(output, `report-${tag}.json`), `${JSON.stringify(report, null, 2)}\n`)
  if (failures.length > 0) throw new Error(`F1 渲染尺寸不符拍板值（${failures.length} 处）：\n  ${failures.join('\n  ')}`)
  console.log(`\n${measureOnly ? '量完（不判）' : '全过'}：${report.hosts.length} 个宿主，报告 ${path.relative(repoRoot, path.join(output, `report-${tag}.json`))}`)
} finally {
  await run.app.close()
}
