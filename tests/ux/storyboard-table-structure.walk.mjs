// 分镜表「能不能看到、能不能点到」走查（审计 B5a + B8，AUD-20261005-12 / -16）：
// 真实 Electron / IPC / 渲染 / 项目文件，零生成额度（全程不点生成，供应商不接网），窗口全程在屏幕外。
//
// 要证的三句话（都是「用户看得到、点得到」，不是「DOM 里有」）：
//   ① 选中一行之后，多选浮条**不用滚动**就在视野里、点得到（sticky 不能被表格的 overflow-hidden 废掉）；
//   ② 最后一行的弹出层（行 ⋯ 菜单 / 「用作…」菜单 / 提示词片段菜单）完整露出、整块点得到，不被表格边界裁掉；
//   ③ 最小窗口 1100×690、中英两种语言下，每一行的「生成」和「⋯」都点得到。
//
// 判据全部走 `_assert.mjs` 的 elementFromPoint 采样（`expectOverlayReachable` / `expectHittable`）：
// 裁切不改 getBoundingClientRect，DOM 在、toBeVisible 绿、Playwright click 还会自己滚——只有命中测试说实话。
//
// 用法：pnpm run build && node tests/ux/storyboard-table-structure.walk.mjs
//   STORYBOARD_TABLE_STRUCTURE_OUT=<dir>  截图与报告输出目录（默认 tests/ux/shots/storyboard-table-structure）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { clickOrFail, expectOverlayReachable, expectVisible, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outRoot = process.env.STORYBOARD_TABLE_STRUCTURE_OUT || path.join(repoRoot, 'tests', 'ux', 'shots', 'storyboard-table-structure')
const MIN_WINDOW = { width: 1100, height: 690 }
const projectId = 'storyboard-table-structure-walk'
const designId = 'table-structure-design'
const LAST = 5

const stamp = '2026-10-05T00:00:00.000Z'
const catalogJson = JSON.stringify({
  version: 12,
  vendors: [{ key: 'ux-local', name: 'UX Local', enabled: true, authType: 'none', providerKind: 'openai-compatible', createdAt: stamp, updatedAt: stamp }],
  models: [{
    vendorKey: 'ux-local', modelKey: 'seedance-2-5', labelZh: 'Seedance 2.5', kind: 'video', enabled: true,
    meta: {
      archetypeId: 'seedance-2.5',
      adapter: {
        state: 'verified', activeRevision: 'table-structure',
        publicationModes: ['text_to_video', 'image_to_video'],
        modes: [{ taskKind: 'text_to_video', state: 'verified' }, { taskKind: 'image_to_video', state: 'verified' }],
      },
    },
    createdAt: stamp, updatedAt: stamp,
  }],
  mappings: [], apiKeysByVendor: {},
}, null, 2)

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const assetUrl = `nomi-local://asset/${encodeURIComponent(projectId)}/assets/hero.png`
const img = (id) => ({ id, type: 'image', url: assetUrl, thumbnailUrl: assetUrl, createdAt: 1 })

const videoShot = (index, extra = {}) => ({
  index, shotId: `shot-${index}`, shotKind: 'video', durationSec: 5, anchorIds: [],
  modelKey: 'seedance-2-5', modeId: 'omni', prompt: `第 ${index} 镜画面`, ...extra,
})
// 最后一镜是「已出图」的图片镜：它的行里有「用作…」菜单，且它是表里最后一行——被表格边界裁掉的菜单就出在这里。
const plan = {
  title: '表结构走查',
  profileKey: 'genre.short-drama',
  anchors: [],
  shots: [
    videoShot(1, { prompt: '远景，第一镜画面', promptSegments: [{ key: 'shotSize', start: 0, end: 2 }] }),
    videoShot(2),
    videoShot(3),
    videoShot(4),
    { index: LAST, shotId: `shot-${LAST}`, shotKind: 'image', durationSec: 3, anchorIds: [], prompt: `第 ${LAST} 镜画面` },
  ],
}
const nodes = [{
  id: `n-shot${LAST}`, kind: 'image', categoryId: 'shots', title: `镜头 ${LAST}`, prompt: `第 ${LAST} 镜画面`,
  position: { x: 0, y: 0 }, status: 'success', result: img('r-last'),
  meta: { storyboardDesignId: designId, shotId: `shot-${LAST}`, imageDurationSec: 3 },
}]
const projectRecord = (projectRoot) => ({
  id: projectId, name: '表结构走查', version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 1,
  lastKnownRootPath: projectRoot,
  payload: {
    workbenchDocuments: [{ id: 'doc-1', version: 1, title: '走查', updatedAt: 10, contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '雨夜。' }] }] } }],
    activeDocumentId: 'doc-1', timeline: null,
    generationCanvas: { nodes, edges: [], selectedNodeIds: [], groups: [] },
    storyboardDesignsByDocumentId: { 'doc-1': [{ id: designId, documentId: 'doc-1', title: plan.title, plan, committed: false, status: 'draft', sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12 }] },
  },
})

function makeFixture() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-storyboard-structure-'))
  const settingsDir = path.join(tempRoot, 'settings')
  const projectsDir = path.join(tempRoot, 'projects')
  const projectRoot = path.join(projectsDir, projectId)
  fs.mkdirSync(path.join(projectRoot, '.nomi'), { recursive: true })
  fs.mkdirSync(path.join(projectRoot, 'assets'), { recursive: true })
  fs.mkdirSync(settingsDir, { recursive: true })
  fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), catalogJson)
  fs.writeFileSync(path.join(projectRoot, 'assets', 'hero.png'), png)
  const project = projectRecord(projectRoot)
  for (const file of [path.join(projectRoot, 'project.json'), path.join(projectRoot, '.nomi', 'project.json')]) {
    fs.writeFileSync(file, JSON.stringify(project, null, 2))
  }
  return { tempRoot, settingsDir, projectsDir }
}

const failures = []
const screenshots = []
const measured = {}
let appInstance = null
let win = null
let outDir = outRoot

const record = (tag, key, value) => { (measured[tag] ??= {})[key] = value }
const snap = async (tag, name) => {
  const target = path.join(outDir, `${tag}-${name}.png`)
  await screenshotSettled(win, { path: target })
  screenshots.push(target)
}
/** 一条断言一条红：别让第一条失败把后面的证据吞掉。 */
async function check(tag, label, fn) {
  try { await fn() } catch (error) { failures.push(`${tag}：${label} → ${String(error?.message || error).split('\n')[0]}`) }
}
const editor = () => win.locator('[data-storyboard-editor="true"]:visible')
const row = (index) => editor().locator(`[data-storyboard-row="${index}"]`).first()
const scroller = () => win.locator('[data-storyboard-scroll="true"]').first()
const scrollTop = (top) => scroller().evaluate((element, value) => { element.scrollTop = value }, top)
const scrollRowIntoView = (index) => row(index).evaluate((element) => element.scrollIntoView({ block: 'center' }))

/** 一个点在不在「用户此刻能点到」的位置：中心点的命中元素是它自己（或它里面），且整个矩形中心在视口里。 */
async function reachOf(locator) {
  return locator.first().evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const hit = document.elementFromPoint(x, y)
    return {
      rect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
      inViewport: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight,
      hittable: Boolean(hit) && (hit === element || element.contains(hit)),
      hitBy: hit ? `${hit.tagName.toLowerCase()}${typeof hit.className === 'string' && hit.className ? `.${hit.className.split(/\s+/)[0]}` : ''}` : 'null',
    }
  })
}
async function expectReachable(locator, label) {
  await expectVisible(locator, `${label} 没出现`)
  const reach = await reachOf(locator)
  if (!reach.inViewport || !reach.hittable) {
    throw new Error(`${label} 点不到（inViewport=${reach.inViewport}，中心点上画的是 ${reach.hitBy}，rect=${JSON.stringify(reach.rect)}）`)
  }
  return reach
}

async function setSidebar(state) {
  await win.locator('[data-creation-resource-tree-toggle]:visible').first().waitFor({ state: 'visible', timeout: stationTimeout() })
  const toggle = win.locator(`[data-creation-resource-tree-toggle="${state}"]:visible`)
  if (await toggle.isVisible().catch(() => false)) await toggle.click()
  await win.waitForTimeout(500)
}

async function openEditor(locale) {
  const { tempRoot, settingsDir, projectsDir } = makeFixture()
  appInstance = await launchNomiApp({
    name: `storyboard-table-structure-${locale}`, tempRoot, settingsDir, projectsDir, settleMs: 1200,
    viewportSize: MIN_WINDOW,
    mainRequire: [path.join(repoRoot, 'tests', 'ux', '_offscreenWindows.cjs')],
    initialLocalStorage: {
      'nomi:locale:v1': locale, 'nomi:splash:v1': 'seen',
      'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
    },
  })
  win = appInstance.win
  const card = win.locator('[data-project-card]', { hasText: '表结构走查' }).first()
  if (await card.isVisible().catch(() => false)) {
    await card.hover()
    const open = card.getByText(locale === 'en' ? 'Continue' : '继续创作', { exact: false }).first()
    if (await open.isVisible().catch(() => false)) await open.click()
    else await card.dblclick()
  }
  await clickOrFail(win.getByRole('button', { name: /^(创作|Create)$/ }), '切到创作页')
  await setSidebar('expand')
  await clickOrFail(win.locator(`[data-storyboard-id="${designId}"]`), '选中走查分镜')
  const appeared = await editor().waitFor({ state: 'visible', timeout: stationTimeout() }).then(() => true).catch(() => false)
  if (!appeared) await clickOrFail(win.getByRole('button', { name: /打开分镜|再次编辑|Open storyboard|Edit again/ }).first(), '打开分镜页')
  await expectVisible(editor(), '分镜编辑器未渲染')
  await expectVisible(row(1), '第一镜未渲染')
  // 证明真的在这一语言的现场（只有那一种语言才有的说法）。
  await expectVisible(
    editor().getByText(locale === 'en' ? 'Generate reference cards to lock looks first' : '先生成参考卡锁住长相', { exact: false }).first(),
    `界面没有切到 ${locale}——这一轮拍出来的不是这门语言的证据`,
  )
}

async function closeApp() {
  if (!appInstance) return
  const instance = appInstance
  appInstance = null
  await Promise.race([instance.app.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 8000))])
  await instance.close()
}

async function walkLocale(locale) {
  const tag = locale === 'zh-CN' ? 'zh' : 'en'
  outDir = path.join(outRoot, tag)
  fs.mkdirSync(outDir, { recursive: true })
  await openEditor(locale)
  const viewport = await win.evaluate(() => ({ w: innerWidth, h: innerHeight }))
  record(tag, 'viewport', viewport)
  if (viewport.w !== MIN_WINDOW.width || viewport.h !== MIN_WINDOW.height) failures.push(`${tag}：视口不是 ${MIN_WINDOW.width}×${MIN_WINDOW.height}（${viewport.w}×${viewport.h}）`)

  // ── ③ 最小窗口：每一行的「生成」和「⋯」都点得到 ──
  await scrollTop(0)
  record(tag, 'rowWidth', await row(1).evaluate((element) => Math.round(element.getBoundingClientRect().width)))
  await snap(tag, '01-min-window-top')
  for (let index = 1; index <= LAST; index += 1) {
    await scrollRowIntoView(index)
    await win.waitForTimeout(250)
    await check(tag, `第 ${index} 行的行首「⋯」点不到`, async () => {
      await expectReachable(row(index).locator(`[data-storyboard-row-menu-trigger="${index}"]`), `第 ${index} 行的行首「⋯」`)
    })
    // 已出图的行底栏用状态标签代替「生成」，所以只数还没出图的行。
    if (index < LAST) {
      await check(tag, `第 ${index} 行的「生成」点不到`, async () => {
        await expectReachable(row(index).locator('[data-storyboard-generate-state]'), `第 ${index} 行的「生成」`)
      })
      // 底栏的参数汇总按钮（2026-10-06 #1042 起底栏是画布同款参数条，原来的底栏「⋯」已删，开关进了这块面板）。
      await check(tag, `第 ${index} 行底栏的参数汇总按钮点不到`, async () => {
        await expectReachable(row(index).locator('[data-storyboard-composer-bar] [data-parameter-summary]').first(), `第 ${index} 行底栏的参数汇总按钮`)
      })
    }
    // 整条底栏不许有叶子越过行右缘（越过的那部分被表格边界剪掉，人看不到）。
    const spill = await row(index).evaluate((element) => {
      const card = element.getBoundingClientRect()
      let worst = 0
      for (const node of element.querySelectorAll('[data-storyboard-composer-bar] *')) {
        if (node.children.length > 0) continue
        const rect = node.getBoundingClientRect()
        if (rect.width < 1 && rect.height < 1) continue
        worst = Math.max(worst, Math.round(rect.right - card.right))
      }
      return worst
    })
    record(tag, `row${index}BarSpillPx`, spill)
    if (spill > 0) failures.push(`${tag}：第 ${index} 行底栏有 ${spill}px 越过行右缘（被表格剪掉）`)
  }
  await scrollRowIntoView(1)
  record(tag, 'row1Bar', await row(1).locator('[data-storyboard-composer-bar]').evaluate((bar) => ({
    clientWidth: bar.clientWidth, scrollWidth: bar.scrollWidth,
    children: [...bar.children].map((child) => `${(child.textContent || '').trim().slice(0, 14) || child.tagName}:${Math.round(child.getBoundingClientRect().width)}`),
  })))
  await snap(tag, '02-min-window-row1')

  // ── ① 选中一行：浮条不用滚动就在视野里 ──
  await scrollTop(0)
  await clickOrFail(row(2).locator('[data-storyboard-frame]').first(), '点第 2 行画面格的角上选中它（中间是「生成」，别点到）', { position: { x: 6, y: 6 } })
  const toolbar = win.locator('[data-storyboard-selection-toolbar]').first()
  await check(tag, '选中行后浮条不用滚动就能点到', async () => {
    const reach = await expectReachable(toolbar, '多选浮条')
    record(tag, 'toolbarReach', reach)
  })
  await check(tag, '浮条里每个按钮都点得到、浮条没有横向滚动（英文「Delete」不被截成「Dele」）', async () => {
    const overflow = await toolbar.evaluate((element) => element.scrollWidth - element.clientWidth)
    record(tag, 'toolbarHorizontalOverflowPx', overflow)
    if (overflow > 0) throw new Error(`浮条横向溢出 ${overflow}px`)
    await expectReachable(toolbar.getByRole('button', { name: /删除|Delete/ }).first(), '浮条里的「删除已选」')
  })
  record(tag, 'scrollTopAfterSelect', await scroller().evaluate((element) => Math.round(element.scrollTop)))
  await snap(tag, '03-selected-toolbar-visible')
  // 滚到中间再看一眼：sticky 的意思是「一直跟着」，不是「只在底部出现」。
  await scrollTop(120)
  await win.waitForTimeout(250)
  await check(tag, '滚动途中浮条仍然跟着（sticky）', async () => {
    await expectReachable(toolbar, '滚动中的多选浮条')
  })
  await clickOrFail(win.locator('[data-storyboard-selection-toolbar] button').filter({ hasText: /清除|Clear/ }).first().or(toolbar.locator('button[aria-label]').last()), '收起浮条').catch(() => undefined)
  await win.keyboard.press('Escape').catch(() => undefined)

  // ── ② 最后一行的弹出层：完整露出，整块点得到 ──
  await scrollRowIntoView(LAST)
  await win.waitForTimeout(250)
  await clickOrFail(row(LAST).locator(`[data-storyboard-row-menu-trigger="${LAST}"]`), '点最后一行的行首「⋯」')
  await check(tag, '最后一行的行菜单被裁', async () => {
    await expectOverlayReachable(win.locator(`[data-storyboard-row-menu="${LAST}"]`), '最后一行的行菜单')
  })
  await snap(tag, '04-last-row-menu')
  // 点别处就关上（逃逸账本 LAW12-sb-row-more：以前点别处之后菜单还开着）。
  await win.locator('[data-storyboard-editor="true"]:visible header').first().click({ position: { x: 4, y: 4 } })
  await win.waitForTimeout(300)
  await check(tag, '点别处之后行菜单还开着', async () => {
    const open = await win.locator(`[data-storyboard-row-menu="${LAST}"]`).count()
    if (open > 0) throw new Error(`行菜单还在（${open} 个）`)
  })
  // 不论上面过没过，把状态复位成「没开」（再点一次触发钮 = 收起），免得残留的菜单挡住后面的步骤。
  if (await win.locator(`[data-storyboard-row-menu="${LAST}"]`).count() > 0) {
    await row(LAST).locator(`[data-storyboard-row-menu-trigger="${LAST}"]`).click()
    await win.waitForTimeout(250)
  }

  await scrollRowIntoView(LAST)
  const useAsButton = row(LAST).locator('[data-storyboard-actbar] button[aria-label]').last()
  await clickOrFail(useAsButton, '点最后一行的「用作…」')
  await check(tag, '最后一行的「用作…」菜单被裁', async () => {
    await expectOverlayReachable(win.locator('[data-storyboard-result-intake-menu]'), '最后一行的「用作…」菜单')
  })
  await snap(tag, '05-last-row-use-as-menu')
  await win.keyboard.press('Escape')
  await win.waitForTimeout(250)
  await check(tag, '「用作…」菜单按 Esc 没有关上', async () => {
    const open = await win.locator('[data-storyboard-result-intake-menu]').count()
    if (open > 0) throw new Error(`菜单还在（${open} 个）`)
  })
  if (await win.locator('[data-storyboard-result-intake-menu]').count() > 0) {
    await useAsButton.click()
    await win.waitForTimeout(250)
  }

  // 提示词片段菜单（第 1 行；它自己也在表里，行内原地定位的那一族）。
  await scrollRowIntoView(1)
  const segment = row(1).locator('[data-storyboard-prompt-segment]').first()
  if (await segment.count() > 0) {
    await segment.click()
    await check(tag, '提示词片段菜单被裁', async () => {
      await expectOverlayReachable(win.locator('[data-storyboard-prompt-menu]'), '提示词片段菜单')
    })
    await snap(tag, '06-segment-menu')
    await win.keyboard.press('Escape')
    await win.waitForTimeout(250)
    await check(tag, '提示词片段菜单按 Esc 没有关上', async () => {
      const open = await win.locator('[data-storyboard-prompt-menu]').count()
      if (open > 0) throw new Error(`菜单还在（${open} 个）`)
    })
  } else {
    failures.push(`${tag}：第 1 行没渲染出提示词片段（走查夹具失效，片段菜单没验到）`)
  }
  await closeApp()
}

try {
  for (const locale of ['zh-CN', 'en']) await walkLocale(locale)
} catch (error) {
  failures.push(`走查中断：${error?.message || error}`)
  await win?.screenshot({ path: path.join(outRoot, '99-FAIL.png') }).catch(() => {})
} finally {
  await closeApp()
}

const report = [
  '# storyboard table structure walk (B5a + B8)',
  '',
  `result: ${failures.length ? 'failed' : 'passed'}`,
  `screenshots: ${screenshots.join(', ')}`,
  `measured: ${JSON.stringify(measured, null, 2)}`,
  'covers: selection toolbar reachable without scrolling and while scrolling; last-row row-menu / use-as menu / prompt-segment menu fully hittable; every row generate button and ellipsis hittable at 1100x690 in zh and en; no composer-bar leaf past the row edge.',
  failures.length ? `failures:\n- ${failures.join('\n- ')}` : 'failures: none',
].join('\n')
fs.mkdirSync(outRoot, { recursive: true })
fs.writeFileSync(path.join(outRoot, 'report.md'), `${report}\n`)
console.log(report)
if (failures.length) process.exit(1)
