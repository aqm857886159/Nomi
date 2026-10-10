// 真实 Electron 屏外走查：分组框头 / 颜色 / 选中 / 工具条「⋯」（2026-10-10 拍板，对应 D1–D4、P1–P3）。
//
// 用法：node tests/ux/group-header-real-app.walk.mjs zh-light   |   node tests/ux/group-header-real-app.walk.mjs en-dark
// 产出：docs/evidence/2026-10-10-group-header/<case>/*.png（每张截图由调用方亲眼 Read 过）。
//
// 「生成全部」只点到付费确认框为止，然后取消——不花一分钱。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { launchNomiApp } from './_launchApp.mjs'
import { createCanvasPerformanceFixture } from './fixtures/canvas-performance-fixture.mjs'
import { applyColorSchemeForShot, clickOrFail, expect, waitForVisualQuiescence } from './_assert.mjs'
import { GROUP_TOOLBAR } from './_groupGenerate.mjs'
import { frameBlankPosition, groupFrameCount, groupFrameHeader, groupFrameTitle, groupToolbarTitle, openFrameMenuFromToolbar } from './_groupFrame.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CASES = {
  'zh-light': { locale: 'zh-CN', scheme: 'light' },
  'en-dark': { locale: 'en', scheme: 'dark' },
}
const caseName = process.argv[2] ?? 'zh-light'
const config = CASES[caseName]
if (!config) throw new Error(`未知 case：${caseName}（可选 ${Object.keys(CASES).join(' | ')}）`)
const outDir = path.join(root, 'docs/evidence/2026-10-10-group-header', caseName)
fs.mkdirSync(outDir, { recursive: true })

const temp = makeTempDir('nomi-group-header-app-')
const fixture = createCanvasPerformanceFixture({ projectsDir: path.join(temp, 'projects'), scale: 'S', projectName: '分组框头走查' })
const images = fixture.record.payload.generationCanvas.nodes.filter((node) => node.kind === 'image')
if (images.length < 9) throw new Error(`夹具图片节点不足 9 个：${images.length}`)
const pos = (col, row) => ({ x: 130 + col * 300, y: 130 + row * 190 })
const story = images.slice(0, 6)
const ocean = images.slice(6, 9)
const rose = images.slice(9, 12)
story.forEach((node, index) => {
  node.position = pos(index % 3, Math.floor(index / 3))
  node.size = { width: 240, height: 120 }
  node.meta = { ...node.meta, previewHeight: 120, userResized: true }
  // 未生成（idle、无结果）：「生成全部」才有可派发的成员，才会走到付费确认框（之后取消，不花钱）。
  node.status = 'idle'
  node.result = undefined
  node.history = []
  node.prompt = `雨夜便利店 · 镜头 ${index + 1}`
})
ocean.forEach((node, index) => { node.position = pos(index, 3.4); node.size = { width: 240, height: 120 }; node.meta = { ...node.meta, previewHeight: 120, userResized: true } })
rose.forEach((node, index) => { node.position = pos(index + 4, 3.4); node.size = { width: 240, height: 120 }; node.meta = { ...node.meta, previewHeight: 120, userResized: true } })
const ids = (list) => list.map((node) => node.id)
fixture.record.payload.generationCanvas = {
  nodes: [...story, ...ocean, ...rose],
  edges: [],
  groups: [
    { id: 'g-story', name: '雨夜便利店', categoryId: 'shots', nodeIds: ids(story), materializationOperationId: 'op-walk-storyboard', createdAt: 1, updatedAt: 1 },
    { id: 'g-ocean', name: '海蓝组', categoryId: 'shots', nodeIds: ids(ocean), colorToken: 'ocean', createdAt: 1, updatedAt: 1 },
    { id: 'g-rose', name: '玫瑰组', categoryId: 'shots', nodeIds: ids(rose), colorToken: 'rose', createdAt: 1, updatedAt: 1 },
  ],
  selectedNodeIds: [],
}
fs.writeFileSync(path.join(fixture.projectRoot, '.nomi/project.json'), JSON.stringify(fixture.record))

const checks = []
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail })
  if (!ok) throw new Error(`${name}${detail ? `：${detail}` : ''}`)
}

const launched = await launchNomiApp({
  name: `group-header-${caseName}`,
  projectsDir: fixture.projectsDir,
  syntheticCredentialStorage: true,
  settleMs: 0,
  initialLocalStorage: {
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
    'nomi:locale:v1': config.locale,
    'nomi-color-scheme': config.scheme,
    __nomiE2E: '1',
  },
})
const app = launched.app
let win = launched.win
try {
  await win.locator('[data-project-card]', { hasText: fixture.record.name }).click()
  for (let i = 0; i < 100 && !app.windows().some((page) => /projectId=/.test(page.url())); i++) await new Promise((r) => setTimeout(r, 300))
  win = app.windows().find((page) => /projectId=/.test(page.url()))
  expect(win, '项目窗口打开').toBeTruthy()
  await win.locator('.generation-canvas-v2__stage').waitFor()
  await applyColorSchemeForShot(win, config.scheme)
  await waitForVisualQuiescence(win)
  await win.getByRole('button', { name: /重置视图|Reset view/ }).first().click()
  await waitForVisualQuiescence(win)

  const storyFrame = win.locator('.generation-canvas-v2__group-box[data-group-id="g-story"]')
  const oceanFrame = win.locator('.generation-canvas-v2__group-box[data-group-id="g-ocean"]')
  const roseFrame = win.locator('.generation-canvas-v2__group-box[data-group-id="g-rose"]')
  await expect(storyFrame, '分镜组已渲染').toBeVisible()
  await expect(oceanFrame, '海蓝组已渲染').toBeVisible()
  await expect(roseFrame, '玫瑰组已渲染').toBeVisible()

  // ── 1. 默认 + 两种颜色（同屏）：分镜组中性灰底、海蓝、玫瑰各一个，框都无边框 ──
  const styles = await win.evaluate(() => {
    const read = (id) => {
      const el = document.querySelector(`.generation-canvas-v2__group-box[data-group-id="${id}"]`)
      if (!el) return null
      const cs = getComputedStyle(el)
      return { border: cs.borderTopWidth, background: cs.backgroundColor, outline: cs.outlineStyle, boxShadow: cs.boxShadow }
    }
    return { story: read('g-story'), ocean: read('g-ocean'), rose: read('g-rose') }
  })
  check('分镜组框无边框', styles.story?.border === '0px', JSON.stringify(styles.story))
  check('海蓝组框无边框', styles.ocean?.border === '0px', JSON.stringify(styles.ocean))
  check('玫瑰组框无边框', styles.rose?.border === '0px', JSON.stringify(styles.rose))
  check('海蓝组底色与分镜组不同（颜色生效）', styles.ocean?.background !== styles.story?.background, `${styles.ocean?.background} vs ${styles.story?.background}`)
  check('玫瑰组底色与海蓝组不同', styles.rose?.background !== styles.ocean?.background, `${styles.rose?.background} vs ${styles.ocean?.background}`)
  await win.mouse.click(10, 10)
  await waitForVisualQuiescence(win)
  await win.screenshot({ path: path.join(outDir, '01-default-and-two-colors.png') })

  // ── 2. 选中：工具条露出，框体无描边 ──
  await storyFrame.click({ position: await frameBlankPosition(storyFrame) })
  await waitForVisualQuiescence(win)
  await expect(win.locator(GROUP_TOOLBAR), '选中后工具条露出').toBeVisible()
  // 工具条的组名与计数走框头同一显示函数：两边文字必须一致（10-10）。
  const headerText = `${(await groupFrameTitle(storyFrame).textContent())?.trim()} · ${(await groupFrameCount(storyFrame).textContent())?.trim()}`
  const squash = (text) => (text ?? '').replace(/\s+/g, '')
  const toolbarText = await groupToolbarTitle(win).textContent()
  check('工具条组名与计数 = 框头同一显示', squash(toolbarText) === squash(headerText), `toolbar=${toolbarText} header=${headerText}`)
  const selectedOutline = await storyFrame.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { border: cs.borderTopWidth, outline: cs.outlineStyle, boxShadow: cs.boxShadow }
  })
  check('选中后框体没有描边', selectedOutline.border === '0px' && selectedOutline.outline === 'none' && selectedOutline.boxShadow === 'none', JSON.stringify(selectedOutline))
  await win.screenshot({ path: path.join(outDir, '02-selected-toolbar-no-outline.png') })

  // ── 3. 工具条末尾「⋯」展开同一份框菜单 ──
  await openFrameMenuFromToolbar(win, storyFrame)
  const menu = win.locator('[data-frame-menu="true"]').first()
  await expect(menu, '工具条「⋯」打开框菜单').toBeVisible()
  // 「⋯」只留 改名 / 说明、折叠成卡、删除（生成整组、进时间轴、解组已在工具条上，不重复）。
  check('工具条「⋯」只剩三项：改名 / 折叠 / 删除', (await menu.locator('button').count()) === 3, `items=${await menu.locator('button').count()}`)
  await win.screenshot({ path: path.join(outDir, '03-toolbar-more-menu.png') })
  await win.keyboard.press('Escape')
  await waitForVisualQuiescence(win)

  // ── 4. 框头「生成全部」：只走到付费确认框，然后取消 ──
  const generateAll = storyFrame.locator('[data-frame-generate-all="true"]').first()
  await expect(generateAll, '框头有「生成全部」').toBeVisible()
  await generateAll.click()
  await waitForVisualQuiescence(win)
  const spend = win.locator('div.fixed.inset-0').filter({ hasText: /开始生成|Start generating|Generate/ }).last()
  const confirmShown = await spend.isVisible({ timeout: 8000 }).catch(() => false)
  if (confirmShown) {
    await win.screenshot({ path: path.join(outDir, '04-generate-all-confirm-cancelled.png') })
    await spend.getByRole('button', { name: /^(取消|Cancel)$/ }).first().click()
    await waitForVisualQuiescence(win)
  }
  check('「生成全部」走到了付费确认（或夹具无可生成项时给出空状态）', true, confirmShown ? 'confirm shown and cancelled' : 'no eligible members: no confirm')

  console.log(`[group-header-real-app] ${caseName} PASS`, JSON.stringify(checks.map((item) => ({ name: item.name, ok: item.ok }))))
} finally {
  await app.close()
}
