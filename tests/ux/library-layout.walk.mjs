// 技能库 / 提示词库排版改版走查（2026-10-24 拍板图：SkillLibrary、PromptLibrary、LibraryDrawers、SkillDetail、PromptDetail、
// LibraryMine、LibraryStates；设计卡 docs/plan/2026-10-23-skill-prompt-library-layout.md ★9）。
//
// 真 Electron + 隔离资料目录 + 主进程网络闸（零外网、零花费）。数据全是真实宿主：内置技能、内置提示词（表情预设 + 效果）、
// 打包快照的公开库；「我的」提示词预埋两条（带参考图的「Q 版角色卡」、没有媒体的「Tokyo Walk」），我的技能走真实导入入口进来。
// 读取失败 / 加载两屏靠 _promptLibraryReadGate.cjs 在主进程入口把「读提示词库」那一路先换成失败、再挂住、再放行。
//
// 断言名 `board:<板>/<元素 id>` 对应 docs/design/boards/2026-10-24/*.board.json 里 implemented 的元素（check:board-parity 认这串字）。
// 截图写到 NOMI_LIBRARY_LAYOUT_SHOTS（默认系统临时目录），不写进仓库。
// 用法：pnpm build && node tests/ux/library-layout.walk.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { expect, clickOrFail, proveProbe, expectAbsent, applyColorSchemeForShot, waitForVisualQuiescence } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { newProjectEntry, openRailDrawer, closeRailDrawer, railDrawer, switchWorkspace, setAppLanguage, backToLibrary } from './_shell.mjs'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'

// 界面文案按键从词典取（check:test-copy-literals：测试不手抄文案）。
const zh = (key) => uiText('zh-CN', key)
const en = (key) => uiText('en', key)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = process.env.NOMI_LIBRARY_LAYOUT_SHOTS || path.join(os.tmpdir(), 'nomi-library-layout-walk')
fs.mkdirSync(out, { recursive: true })
const settingsDir = makeTempDir('nomi-library-layout-settings-')

// 「我的」提示词预埋：一条带参考图（卡上显示参考图、来源标签「网页提取」），一条没有媒体（文字封面）。
const referenceImage = `data:image/jpeg;base64,${fs.readFileSync(path.join(repoRoot, 'src/devlab/designLab/videoNodeNext/fixtures/frame-current.jpg')).toString('base64')}`
fs.writeFileSync(path.join(settingsDir, 'prompt-library-user.json'), JSON.stringify([
  {
    id: 'user-walk-qcard', title: 'Q 版角色卡', prompt: '画一张带有圆角和柔和投影的现代 UI 卡片 2:3 图片，卡片中央是参考图里的人物转成的 3D 卡通角色。',
    mediaUrl: referenceImage, mediaType: 'image', promptType: 'image', origin: 'user', source: '', sourceId: 'user', sourceUrl: '',
    updatedAt: '2026-10-24T01:00:00.000Z', tags: [zh('browserAssets.webExtraction')], referenceImages: [{ url: referenceImage, title: 'reference' }],
  },
  {
    id: 'user-walk-tokyo', title: 'Tokyo Walk', prompt: 'A stylish woman walks down a Tokyo street filled with warm glowing neon and animated city signage.',
    mediaUrl: '', mediaType: 'video', promptType: 'video', origin: 'user', source: '', sourceId: 'user', sourceUrl: '',
    updatedAt: '2026-10-24T00:59:00.000Z',
  },
], null, 2))

// 我的技能：一份正常的（拖进来导入），一份扩展块写坏的（选文件导入，详情里要报「包有问题」并禁用主按钮），外加一个不是技能的文件。
const skillFiles = makeTempDir('nomi-library-layout-skills-')
const goodSkill = '---\nname: walk-improv-scene\ndescription: 即兴生台词——让角色在设定好的世界里即兴对戏，长出编剧预设不出的真实口语。\n---\n# walk-improv-scene\n\n把即兴原料按「剪水 → 留金 → 上结构」整理成可拍的台词。\n'
const brokenSkillPath = path.join(skillFiles, 'SKILL.md')
fs.writeFileSync(brokenSkillPath, '---\nname: walk-broken-manifest\ndescription: 扩展块写坏的技能（走查用）。\nmetadata:\n  nomi:\n    tools: not-a-list\n---\n# walk-broken-manifest\n\n正文。\n')
const notSkillPath = path.join(skillFiles, 'notes.txt')
fs.writeFileSync(notSkillPath, 'not a skill')

const run = await launchNomiApp({
  name: 'library-layout',
  settleMs: 0,
  settingsDir,
  viewportSize: { width: 1440, height: 900 },
  mainRequire: [path.join(repoRoot, 'scripts', 'walkthrough-network-guard.cjs'), path.join(repoRoot, 'tests', 'ux', '_promptLibraryReadGate.cjs')],
  env: { NOMI_TEST_NETWORK_GUARD: '1' },
  initialLocalStorage: { 'nomi:locale:v1': 'zh-CN', 'nomi-color-scheme': 'light', 'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen' },
})
const win = run.win
win.setDefaultTimeout(stationTimeout({ operations: 2 }))
const readGate = (mode) => run.app.evaluate((_electron, value) => globalThis.__nomiWalkPromptLibraryMode(value), mode)
const shots = []
// 截图前等屏上的封面落定（图片读完或已判失败、视频首帧到了或已出错），否则截到的是还没解码的空框——那不是产品的样子。
// 等不到（例如网络闸拦下的远端媒体）也照截：失败的那张会变成占位，这正是要看的。
const mediaSettled = () => win.evaluate(() => {
  const inView = (element) => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth
  }
  const images = [...document.querySelectorAll('[data-skill-media="image"]')].filter(inView)
  const videos = [...document.querySelectorAll('[data-skill-media="video"] video, video[data-skill-media="video"]')].filter(inView)
  return images.every((image) => image.complete) && videos.every((video) => video.readyState >= 2 || video.error)
})
const shot = async (name) => {
  for (let tries = 0; tries < 40 && !(await mediaSettled()); tries += 1) await win.waitForTimeout(250)
  // 详情浮层是从卡片位置放大浮出的（260ms）：等它落定再截，否则截到的是半透明的中间帧。
  await waitForVisualQuiescence(win).catch(() => {})
  await win.screenshot({ path: path.join(out, `${name}.png`) })
  shots.push(name)
}
const page = win.locator('[data-library-host="page"]')
const libraryMain = win.locator('.nomi-library-page__main')
const toolbar = (tab) => win.locator(`[data-library-toolbar="${tab}"]`)
const box = async (locator) => locator.boundingBox()
const opacity = (locator) => locator.evaluate((element) => getComputedStyle(element).opacity)
const middle = (rect) => rect.y + rect.height / 2

// 实心主按钮：背景不透明且很暗（ink 底）。§1.8 一屏一个实心：库页 0 个，详情各 1 个。只在亮色下数。
const solidButtons = (locator) => locator.evaluate((root) => {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const rgba = (value) => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = '#000'
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
    return { r, g, b, a: a / 255 }
  }
  return [...root.querySelectorAll('button')].filter((button) => {
    if (!button.getBoundingClientRect().width) return false
    const { r, g, b, a } = rgba(getComputedStyle(button).backgroundColor)
    return a > 0.5 && (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.3
  }).length
})

// 文字对比度（WCAG）：文字色叠在它真实落上的底色上（逐层往上找背景、按 alpha 合成）。★9 第 7 条「卡面、文字 ≥4.5」的量具。
const contrastOf = (locator) => locator.evaluate((element) => {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const rgba = (value) => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = '#000'
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
    return { r, g, b, a: a / 255 }
  }
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 })
  const layers = []
  for (let node = element; node; node = node.parentElement) {
    const color = rgba(getComputedStyle(node).backgroundColor)
    if (color.a > 0) layers.push(color)
    if (color.a >= 0.99) break
  }
  let background = { r: 255, g: 255, b: 255, a: 1 }
  for (const layer of layers.reverse()) background = over(layer, background)
  const text = over(rgba(getComputedStyle(element).color), background)
  const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const luminance = (color) => 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
  const [light, dark] = [luminance(text), luminance(background)].sort((a, b) => b - a)
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
})
const contrast = {}

try {
  // ═══ 提示词库页签（项目库，没开项目）════════════════════════════════════════════════
  await expect(win.locator('[data-shell-topbar]'), 'board:PromptLibrary/shell.topbar').toBeVisible()
  await clickOrFail(win.locator('[data-library-tab-button="prompts"]'), '提示词页签')
  await expect(win.locator('[data-library-tab-button]'), 'board:PromptLibrary/library.tabs').toHaveCount(3)

  // LibraryStates「读取失败」：内置 + 公开库这一次没读出来 →「没拉到提示词」+ 一句原因 +「重试」；我的那段照常列在上面。
  // （板上这一格还要求「我的库读取失败也要显示」= 另修 D-12，所以清单里这一格是 in-progress，不在这里认领。）
  const error = page.locator('[data-library-error]')
  await expect(error, '读取失败态没出来').toBeVisible()
  await expect(error).toContainText(zh('libraries.prompt.fetchFailed'))
  await expect(error).toContainText('我的提示词不受影响')
  await expect(page.locator('[data-prompt-card="user-walk-qcard"]'), '读取失败时我的提示词照常在').toBeVisible()
  await shot('states-error-zh-light')
  // LibraryStates「加载」：挂住这一次读取 → 加载标 +「正在读取提示词…」（技能那一半是另修 D-10，清单里 in-progress）。
  await readGate('hold')
  await clickOrFail(error.locator('[data-library-retry]'), '重试')
  const loading = page.locator('[data-library-loading]')
  await expect(loading, '点重试后没有加载态').toContainText(zh('libraries.prompt.fetching'))
  await shot('states-loading-zh-light')
  await readGate('pass')
  await expect(page.locator('[data-library-section="builtin:source:builtin-expressions"]'), '放行之后内置没读出来').toBeVisible()
  await expect(error).toHaveCount(0)
  await expect(loading).toHaveCount(0)

  // 页签行：「全部 / 图片 / 视频」分段（按内容宽、不竖成柱子）· 搜索 · 新建，和页签同一排。
  const tabsBox = await box(win.locator('[data-library-tab-button="prompts"]'))
  const segment = toolbar('prompts').getByRole('radiogroup')
  await expect(segment, 'board:PromptLibrary/prompt-lib.type-segment').toBeVisible()
  const segmentBox = await box(segment)
  expect(segmentBox.height, '分段竖成了一根柱子').toBeLessThan(40)
  expect(segmentBox.width, '分段被挤成一根柱子').toBeGreaterThan(120)
  expect(Math.abs(middle(segmentBox) - middle(tabsBox)), '分段不在页签那一行').toBeLessThan(8)
  const promptSearch = toolbar('prompts').locator('input[type="search"]')
  await expect(promptSearch, 'board:PromptLibrary/prompt-lib.search').toHaveAttribute('placeholder', zh('libraries.prompt.searchPlaceholder'))
  const searchBox = await box(promptSearch)
  expect(searchBox.x, '分段盖住或挤到了搜索框').toBeGreaterThanOrEqual(segmentBox.x + segmentBox.width)
  expect(Math.abs(middle(searchBox) - middle(tabsBox)), '搜索不在页签那一行').toBeLessThan(8)
  await expect(toolbar('prompts').locator('[data-prompt-new]'), 'board:PromptLibrary/prompt-lib.new').toHaveText('新建')
  await expect(toolbar('prompts').locator('[data-prompt-new]'), 'board:LibraryMine/mine.new').toBeEnabled()
  await expect(segment, 'board:LibraryMine/mine.type-segment').toBeVisible()
  await expect(promptSearch, 'board:LibraryMine/mine.search').toBeVisible()
  expect(await solidButtons(libraryMain), '提示词库页上出现了实心按钮').toBe(0)

  // 左侧分类常驻三段：全部 / 我的；内置（表情预设、效果各组）；公开库（各来源）；都带计数。
  const nav = page.locator('[data-library-category-nav]')
  await expect(nav, 'board:PromptLibrary/prompt-lib.category-nav').toBeVisible()
  await expect(nav.locator('[data-library-category-segment="builtin"]')).toHaveText('内置')
  await expect(nav.locator('[data-library-category-segment="public"]')).toHaveText('公开库')
  // 公开库离线：主进程用打包快照兜底（网络闸下照样有 5 个来源）。
  await expect(nav.locator('[data-library-category^="public:source:"]'), 'board:PromptLibrary/prompt-lib.public-fallback').toHaveCount(5)
  await expect(nav.locator('[data-library-category="mine"]')).toContainText('2')
  await expect(nav.locator('[data-library-category="builtin:source:builtin-expressions"]')).toContainText('25')
  expect(await nav.locator('[data-library-category^="builtin:category:"]').count(), '效果各组没进提示词库的内置段').toBeGreaterThan(3)
  // 分类名长时：一行省略 + 悬停全名（title）。
  expect(await nav.locator('[data-library-category]').evaluateAll((buttons) => buttons.every((button) => button.title && button.querySelector('.truncate')))).toBe(true)
  // 没有横向滚动的标签排。
  expect(await libraryMain.evaluate((root) => [...root.querySelectorAll('*')].some((element) => element.scrollWidth > element.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(element).overflowX))), '提示词库页上有横向滚动').toBe(false)

  // 首页每组一行真卡片 +「全部 N ›」；点了 = 只看这一组、全部摊开（同左侧分类）。
  const expressions = page.locator('[data-library-section="builtin:source:builtin-expressions"]')
  await expect(expressions, 'board:PromptLibrary/prompt-lib.group').toContainText('表情预设')
  const more = expressions.locator('[data-library-show-all]')
  await expect(more, 'board:PromptLibrary/prompt-lib.group-more').toContainText('全部 25')
  // ★9 第 15 条：挂着的媒体元素 ≤ 首屏可见卡片 + 一屏预取；首页没露出来的卡、屏外的卡一张都不挂（不挂就不发请求）。
  const mounted = await page.locator('[data-library-scroll]').first().evaluate((scroll) => {
    const box = scroll.getBoundingClientRect()
    const cards = [...scroll.querySelectorAll('[data-prompt-card]')]
    const visible = cards.filter((card) => { const rect = card.getBoundingClientRect(); return rect.bottom > box.top && rect.top < box.bottom }).length
    return { visible, cards: cards.length, media: scroll.querySelectorAll('img[src], video[src]').length }
  })
  expect(mounted.media, `首页挂了 ${mounted.media} 个媒体元素，可见卡 ${mounted.visible} 张`).toBeLessThanOrEqual(mounted.visible * 2)
  expect(mounted.cards, '首页把没露出来的卡也挂上了').toBeLessThan(221)
  console.log(`[library-layout] prompt page home: visible cards ${mounted.visible}, mounted cards ${mounted.cards}, mounted media ${mounted.media}`)
  await shot('prompt-page-zh-light')
  await clickOrFail(more, '表情预设「全部 25 ›」')
  await expect(nav.locator('[data-library-category="builtin:source:builtin-expressions"]')).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => page.locator('[data-prompt-card]').count(), { message: '选中一组后没有全部摊开' }).toBe(25)
  await expect(page.locator('[data-library-show-all]'), '选中一组后组头还在折叠').toHaveCount(0)

  // 卡：封面只放图、封面上没有任何字和角标；标题、类型在封面下（标题悬停出全名）。
  const expressionCard = page.locator('[data-prompt-card="builtin-expr-joy-1"]')
  await expect(expressionCard, 'board:PromptLibrary/prompt-lib.card').toBeVisible()
  await expect(expressionCard.locator('[data-prompt-cover] img[data-skill-media="image"]')).toBeVisible()
  expect(await expressionCard.locator('[data-prompt-cover]').evaluate((cover) => cover.innerText.trim()), '封面上压了字').toBe('')
  await expect(expressionCard.locator('[data-prompt-card-title]'), 'board:PromptLibrary/prompt-lib.card.title').toHaveText('喜悦 1/5 · 一丝笑意')
  await expect(expressionCard.locator('button').first()).toHaveAttribute('title', '喜悦 1/5 · 一丝笑意')
  await expect(expressionCard.locator('[data-prompt-card-meta]'), 'board:PromptLibrary/prompt-lib.card.meta').toHaveText('图片')

  // 「全部 / 图片 / 视频」：切到视频只剩视频卡（视频带小图标）。
  await clickOrFail(nav.locator('[data-library-category="all"]'), '分类「全部」')
  await clickOrFail(segment.getByRole('radio', { name: '视频', exact: true }), '只看视频')
  await expect(segment.getByRole('radio', { name: '视频', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect.poll(() => page.locator('[data-prompt-card-meta]').evaluateAll((metas) => metas.length > 0 && metas.every((meta) => meta.textContent.includes('视频') && meta.querySelector('svg')))).toBe(true)
  await clickOrFail(segment.getByRole('radio', { name: '全部', exact: true }), '回到全部类型')

  // 公开库按来源成组；远端示例媒体在网络闸下取不到 → 图片 / 视频占位 +「已失效」，不是白卡。
  await clickOrFail(nav.locator('[data-library-category="public:source:sora2-viral"]'), '公开库「Sora 2」')
  await expect(page.locator('[data-example-media-expired]').first(), 'board:LibraryStates/states.media-expired').toHaveText('已失效')
  await shot('states-media-expired-zh-light')

  // 搜索：按组全部摊开（效果只在提示词库，Q1）；搜不到：「没有匹配的提示词」+「换个分类或搜索词试试」。
  await clickOrFail(nav.locator('[data-library-category="all"]'), '分类「全部」')
  await promptSearch.fill('人物三视图')
  await expect(page.locator('[data-prompt-card="effect-character-three-view"]'), '效果在提示词库里搜不到').toBeVisible()
  await expect(page.locator('[data-prompt-card="effect-character-three-view"]')).toHaveCount(1)
  await promptSearch.fill('zzqq-没有这个词')
  const noMatch = page.locator('[data-library-no-match]')
  await expect(noMatch, 'board:LibraryStates/states.no-match').toContainText(zh('libraries.prompt.noMatch'))
  await expect(noMatch).toContainText(zh('libraries.prompt.tryAnotherFilter'))
  await shot('states-no-match-zh-light')

  // 提示词详情（内置效果）：× 在标题行、meta「分类 · 内置 · 类型」、媒体、全文、来源、复制、唯一主按钮「放上画布」。
  await promptSearch.fill('人物三视图')
  await clickOrFail(page.locator('[data-prompt-card="effect-character-three-view"] button').first(), '打开「人物三视图」详情')
  const detail = win.locator('[data-prompt-preview="effect-character-three-view"]')
  await expect(detail, 'board:PromptDetail/prompt-detail.dialog').toBeVisible()
  await expect(detail.locator('[data-prompt-detail-title]'), 'board:PromptDetail/prompt-detail.title').toHaveText('人物三视图')
  await expect(detail.locator('[data-prompt-detail-meta]'), 'board:PromptDetail/prompt-detail.meta').toContainText('内置 · 图片')
  const closeBox = await box(detail.locator('[data-prompt-detail-close]'))
  const mediaBox = await box(detail.locator('[data-prompt-detail-media]'))
  expect(closeBox.y + closeBox.height, '× 压在了媒体上').toBeLessThanOrEqual(mediaBox.y + 1)
  await expect(detail.locator('[data-prompt-detail-close]'), 'board:PromptDetail/prompt-detail.close').toHaveAttribute('aria-label', '关闭')
  await expect(detail.locator('[data-prompt-detail-media] [data-skill-media]'), 'board:PromptDetail/prompt-detail.media').toBeVisible()
  await expect(detail.locator('[data-prompt-detail-text]'), 'board:PromptDetail/prompt-detail.text').toContainText(/\S/)
  await expect(detail.locator('[data-prompt-detail-source]'), 'board:PromptDetail/prompt-detail.source').toHaveAttribute('href', /^https?:/)
  const add = detail.locator('[data-prompt-detail-add]')
  await expect(add, '主按钮不是「放上画布」').toHaveText(zh('libraries.prompt.preview.send'))
  // 项目库页上没开项目：「放上画布」禁用并说原因（真机 J-02：以前会建到看不见的画布上）。
  await expect(add).toBeDisabled()
  await expect(add).toHaveAttribute('title', zh('libraries.layout.needsProject'))
  // 复制图标 +「已复制」（检查剪贴板结果再说 = 另修 D-07，清单里这一格 in-progress）。
  const copy = detail.locator('[data-prompt-detail-copy]')
  await expect(copy).toHaveAttribute('aria-label', zh('libraries.prompt.preview.copyAria'))
  await clickOrFail(copy, '点复制')
  await expect(copy).toHaveAttribute('aria-label', zh('libraries.prompt.preview.copied'))
  expect(await solidButtons(detail), '提示词详情不止一个实心主按钮').toBe(1)
  await shot('prompt-detail-zh-light')
  await clickOrFail(detail.locator('[data-prompt-detail-close]'), '关详情')
  await expect(detail).toHaveCount(0)
  await promptSearch.fill('')

  // 我的提示词：同一张卡；有参考图显示参考图、没有用文字封面；卡下「来源标签 · 类型」；编辑 / 删除悬停或键盘聚焦才露出。
  await clickOrFail(nav.locator('[data-library-category="mine"]'), '分类「我的」')
  await expect(nav.locator('[data-library-category="mine"]'), 'board:LibraryMine/mine.category-nav').toHaveAttribute('aria-current', 'true')
  const mineSection = page.locator('[data-library-section="mine"]')
  await expect(mineSection, 'board:LibraryMine/mine.group').toHaveText(/我的\s*2/)
  const qcard = page.locator('[data-prompt-card="user-walk-qcard"]')
  await expect(qcard.locator('img[data-skill-media="image"]'), 'board:LibraryMine/mine.prompt-card').toHaveAttribute('src', /^data:image\/jpeg/)
  await expect(qcard.locator('[data-prompt-card-title]'), 'board:LibraryMine/mine.prompt-card.title').toHaveText('Q 版角色卡')
  await expect(qcard.locator('[data-prompt-card-meta]'), 'board:LibraryMine/mine.prompt-card.meta').toHaveText('网页提取 · 图片')
  const tokyo = page.locator('[data-prompt-card="user-walk-tokyo"]')
  await expect(tokyo.locator('[data-prompt-text-cover]'), 'board:PromptLibrary/prompt-lib.card.text-cover').toContainText('Tokyo street')
  const actions = qcard.locator('[data-prompt-card-actions]')
  expect(await opacity(actions), '编辑 / 删除平时就露着').toBe('0')
  await qcard.hover()
  await expect.poll(() => opacity(actions), { message: '悬停没有露出编辑 / 删除' }).toBe('1')
  await win.mouse.move(720, 20)
  await expect.poll(() => opacity(actions)).toBe('0')
  await qcard.locator('button').first().focus()
  await expect.poll(() => opacity(actions), { message: 'board:LibraryMine/mine.prompt-card.actions' }).toBe('1')
  await shot('mine-prompt-zh-light')
  // 键盘 Enter 打开详情（我的条目：底栏最左删除、编辑图标）。
  await win.keyboard.press('Enter')
  const mineDetail = win.locator('[data-prompt-preview="user-walk-qcard"]')
  await expect(mineDetail, '键盘 Enter 没打开详情').toBeVisible()
  await expect(mineDetail.locator('[data-prompt-detail-meta]')).toHaveText('我的 · 网页提取 · 图片')
  const deleteBox = await box(mineDetail.locator('[data-prompt-detail-delete]'))
  const addBox = await box(mineDetail.locator('[data-prompt-detail-add]'))
  expect(deleteBox.x, '删除不在底栏最左').toBeLessThan(addBox.x - 200)
  await expect(mineDetail.locator('[data-prompt-detail-delete]'), 'board:PromptDetail/prompt-detail.delete').toHaveAttribute('aria-label', '删除')
  await expect(mineDetail.locator('[data-prompt-detail-edit]'), 'board:PromptDetail/prompt-detail.edit').toHaveAttribute('aria-label', '编辑')
  await shot('prompt-detail-mine-zh-light')
  // 编辑 → 内联表单预填（照旧）；取消。
  await clickOrFail(mineDetail.locator('[data-prompt-detail-edit]'), '编辑')
  const composer = page.locator('textarea').first()
  await expect(composer, 'board:PromptLibrary/prompt-lib.composer-form').toHaveValue(/圆角和柔和投影/)
  await clickOrFail(page.getByRole('button', { name: '取消', exact: true }), '取消编辑')
  // 新建：切到「我的」+ 内联表单；保存后出现在「我的」。
  await clickOrFail(toolbar('prompts').locator('[data-prompt-new]'), '点新建')
  await page.locator('textarea').first().fill('雨夜站台，她回头看了一眼，列车进站的灯扫过积水。')
  await clickOrFail(page.getByRole('button', { name: zh('libraries.prompt.composer.saveToMine'), exact: true }), '点保存')
  await expect(mineSection).toHaveText(/我的\s*3/)
  // 删除我的提示词：撤销 toast 在，撤销能找回。
  await clickOrFail(tokyo.locator('button').first(), '打开 Tokyo Walk')
  await clickOrFail(win.locator('[data-prompt-preview="user-walk-tokyo"] [data-prompt-detail-delete]'), '删除 Tokyo Walk')
  const keptProof = await proveProbe(qcard, '另一张我的提示词还在')
  await expectAbsent(tokyo, { provenBy: keptProof, message: '删掉的提示词还在' })
  await clickOrFail(win.getByRole('button', { name: '撤销', exact: true }).last(), '撤销删除提示词')
  await expect(tokyo, '撤销没有找回提示词').toBeVisible()

  // ═══ 技能库页签 ═══════════════════════════════════════════════════════════════════
  await clickOrFail(win.locator('[data-library-tab-button="skills"]'), 'Skill 页签')
  await expect(win.locator('[data-library-tab-button]'), 'board:SkillLibrary/library.tabs').toHaveCount(3)
  await expect(win.locator('[data-shell-topbar]'), 'board:SkillLibrary/shell.topbar').toBeVisible()
  await expect(win.locator('[data-shell-topbar]'), 'board:LibraryMine/shell.topbar').toBeVisible()
  await expect(win.locator('[data-library-tab-button="skills"]'), 'board:LibraryMine/library.tabs').toHaveAttribute('aria-selected', 'true')
  const skillSearch = toolbar('skills').locator('input[type="search"]')
  await expect(skillSearch, 'board:SkillLibrary/skill-lib.search').toHaveAttribute('placeholder', zh('libraries.skill.searchPlaceholder'))
  const skillTabsBox = await box(win.locator('[data-library-tab-button="skills"]'))
  expect(Math.abs(middle(await box(skillSearch)) - middle(skillTabsBox)), '搜索不在页签那一行').toBeLessThan(8)
  const importButton = toolbar('skills').locator('[data-skill-import]')
  await expect(importButton, 'board:SkillLibrary/skill-lib.import').toHaveAttribute('aria-label', /SKILL\.md.*zip.*文件夹/)
  await expect(importButton, 'board:LibraryMine/mine.import').toBeVisible()
  const newSkill = toolbar('skills').locator('[data-skill-new]')
  await expect(newSkill, 'board:SkillLibrary/skill-lib.new-ai').toHaveText('新建')
  // 项目库页上没开项目：「新建」（用 AI 写）禁用并说原因（真机 J-01：以前芯片漏进下一个新建的项目）。
  await expect(newSkill).toBeDisabled()
  await expect(newSkill).toHaveAttribute('title', zh('libraries.layout.needsProject'))
  expect(await solidButtons(libraryMain), '技能库页上出现了实心按钮').toBe(0)

  const skillNav = page.locator('[data-library-category-nav]')
  await expect(skillNav, 'board:SkillLibrary/skill-lib.category-nav').toBeVisible()
  await expect(skillNav.locator('[data-library-category-segment="builtin"]')).toHaveText('内置')
  await expect(skillNav.locator('[data-library-category-segment="public"]'), '技能库多出了公开库那一段').toHaveCount(0)
  await expect(skillNav.locator('[data-library-category="mine"]')).toContainText('0')
  // 技能库只列 kind: skill：卡片 id 全是 skill:…，没有效果、没有提示词（Q1）。
  const skillCards = page.locator('[data-skill-card]')
  await expect(skillCards.first(), 'board:SkillLibrary/skill-lib.card').toBeVisible()
  expect(await skillCards.evaluateAll((cards) => cards.every((card) => /^skill:/.test(card.getAttribute('data-skill-card')) && !/^skill:effect-/.test(card.getAttribute('data-skill-card')))), '技能库里混进了效果或提示词').toBe(true)
  // 我的为空：首页不出现「我的」一组（Q6）。
  const builtinProof = await proveProbe(page.locator('[data-library-section^="builtin:"]'), '技能库首页有内置分组')
  await expectAbsent(page.locator('[data-library-section="mine"]'), { provenBy: builtinProof, message: '我的为空时首页出现了「我的」一组' })
  const firstGroup = page.locator('[data-library-section^="builtin:"]').first()
  await expect(firstGroup, 'board:SkillLibrary/skill-lib.group').toBeVisible()
  await expect(firstGroup.locator('[data-library-show-all]'), 'board:SkillLibrary/skill-lib.group-more').toContainText(/全部 \d+/)
  // 条卡：小封面（示意插画）+ 名字 + 两行简介；卡上没有角标、没有按钮。
  const card = skillCards.first()
  await expect(card.locator('[data-skill-media]'), 'board:SkillLibrary/skill-lib.card.cover').toBeVisible()
  await expect(card.locator('[data-library-entry-title]'), 'board:SkillLibrary/skill-lib.card.title').toBeVisible()
  await expect(card.locator('[data-library-entry-summary]'), 'board:SkillLibrary/skill-lib.card.summary').toHaveCSS('-webkit-line-clamp', '2')
  expect(await card.locator('button').count(), '条卡里套了别的按钮').toBe(0)
  contrast.lightSkillTitle = await contrastOf(card.locator('[data-library-entry-title]'))
  contrast.lightSkillSummary = await contrastOf(card.locator('[data-library-entry-summary]'))
  await shot('skill-page-zh-light')
  // 效果不在技能库：搜「人物三视图」技能库里没有，提示词库里有（上面已证）。
  await skillSearch.fill('人物三视图')
  await expect(page.getByText(zh('libraries.skill.noMatch')), '效果混进了技能库').toBeVisible()
  await expect(page.locator('[data-skill-card]')).toHaveCount(0)
  await skillSearch.fill('')
  // 「全部 N ›」= 只看这一组、全部摊开。
  const groupId = await firstGroup.getAttribute('data-library-section')
  const total = Number((await firstGroup.locator('[data-library-show-all]').innerText()).match(/\d+/)[0])
  await clickOrFail(firstGroup.locator('[data-library-show-all]'), '第一组「全部 N ›」')
  await expect(skillNav.locator(`[data-library-category="${groupId}"]`)).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => page.locator('[data-skill-card]').count(), { message: '选中一组后没有全部摊开' }).toBe(total)

  // 「我的」为空：一句说明（右上新建让 AI 写，或拖进来、点导入），不在空态里再放第二份按钮。
  await clickOrFail(skillNav.locator('[data-library-category="mine"]'), '分类「我的」')
  const mineEmpty = page.locator('[data-library-mine-empty]')
  await expect(mineEmpty, 'board:LibraryMine/mine.empty').toContainText(zh('libraries.skill.noMine'))
  await expect(mineEmpty).toContainText('点右上「导入」')
  expect(await mineEmpty.locator('button').count(), '空态里又放了一份按钮').toBe(0)
  await shot('mine-empty-zh-light')

  // 拖放导入：拖着文件进来出现「松手就导入」，松手后进「我的」。
  const dropZone = page
  const transfer = await win.evaluateHandle((text) => {
    const dt = new DataTransfer()
    dt.items.add(new File([text], 'SKILL.md', { type: 'text/markdown' }))
    return dt
  }, goodSkill)
  await dropZone.dispatchEvent('dragenter', { dataTransfer: transfer })
  await dropZone.dispatchEvent('dragover', { dataTransfer: transfer })
  await expect(dropZone, 'board:SkillLibrary/skill-lib.drop-import').toHaveAttribute('data-skill-drop-zone', 'active')
  await expect(page.getByText(zh('libraries.skill.dropHint'))).toBeVisible()
  await shot('skill-drop-zh-light')
  await dropZone.dispatchEvent('drop', { dataTransfer: transfer })
  const mineSkill = page.locator('[data-skill-card="skill:walk-improv-scene"]')
  await expect(mineSkill, 'board:LibraryMine/mine.skill-card').toBeVisible()
  await expect(dropZone).toHaveAttribute('data-skill-drop-zone', 'idle')
  await expect(mineSkill.locator('[data-library-entry-title]'), 'board:LibraryMine/mine.skill-card.title').toHaveText('walk-improv-scene')
  await expect(mineSkill.locator('[data-library-entry-summary]'), 'board:LibraryMine/mine.skill-card.summary').toContainText('即兴生台词')
  // 用户导入的外部技能没有封面：中性包图标占位。
  await expect(mineSkill.locator('[data-skill-media="placeholder"]')).toBeVisible()
  // 回执：选了一个不是技能的文件 → 工具行下方一行人话原因。
  const fileInput = page.locator('input[type="file"]').first()
  await fileInput.setInputFiles(notSkillPath)
  const receipts = page.locator('[data-skill-receipts]')
  await expect(receipts, 'board:SkillLibrary/skill-lib.receipt').toContainText(zh('libraries.skill.importReason.unsupportedType'))
  expect((await box(receipts)).y, '回执不在工具行下方').toBeGreaterThan(skillTabsBox.y + skillTabsBox.height)
  // 扩展块写坏的技能：照样进「我的」，详情正文顶红字、主按钮禁用并说原因。
  await fileInput.setInputFiles(brokenSkillPath)
  const brokenSkill = page.locator('[data-skill-card="skill:walk-broken-manifest"]')
  await expect(brokenSkill, '写坏扩展块的技能没进「我的」').toBeVisible()
  await shot('mine-skill-zh-light')
  await clickOrFail(brokenSkill, '打开坏技能详情')
  const brokenDetail = win.locator('[data-skill-detail="skill:walk-broken-manifest"]')
  await expect(brokenDetail.locator('[data-skill-detail-invalid]'), 'board:SkillDetail/skill-detail.invalid-notice').toContainText('metadata.nomi')
  await expect(brokenDetail.locator('[data-skill-detail-add-to-chat]')).toBeDisabled()
  await expect(brokenDetail.locator('[data-skill-detail-add-to-chat]')).toHaveAttribute('title', zh('libraries.skill.invalidReason'))
  await shot('skill-detail-invalid-zh-light')
  // 我的技能：删除在底栏最左；删了可撤销，撤销能完整还原。
  await clickOrFail(brokenDetail.locator('[data-skill-detail-delete]'), '删除坏技能')
  await expect(brokenDetail).toHaveCount(0)
  const deleteProof = await proveProbe(mineSkill, '另一个我的技能还在')
  await expectAbsent(brokenSkill, { provenBy: deleteProof, message: '删掉的技能还在' })
  await clickOrFail(win.getByRole('button', { name: '撤销', exact: true }).last(), '撤销删除技能')
  await expect(brokenSkill, 'board:SkillDetail/skill-detail.delete').toBeVisible()

  // 技能详情（内置）：封面 + 名字 + 简介 + 「分组 · 内置 · 来源 ↗ · 许可 · 作者」；底栏导出图标 + 唯一主按钮「放进对话」。
  await clickOrFail(skillNav.locator('[data-library-category="all"]'), '分类「全部」')
  await skillSearch.fill('多视图')
  await clickOrFail(page.locator('[data-skill-card="skill:curated-multi-view"]'), '打开「多视图设定」')
  const skillDetail = win.locator('[data-skill-detail="skill:curated-multi-view"]')
  await expect(skillDetail, 'board:SkillDetail/skill-detail.dialog').toBeVisible()
  const cover = skillDetail.locator('header [data-skill-media]').first()
  await expect(cover, 'board:SkillDetail/skill-detail.cover').toBeVisible()
  const coverBox = await box(cover)
  expect([Math.round(coverBox.width), Math.round(coverBox.height)], '详情封面不是 192×120').toEqual([192, 120])
  await expect(skillDetail.locator('[data-skill-detail-title]'), 'board:SkillDetail/skill-detail.title').toHaveText('多视图设定')
  await expect(skillDetail.locator('[data-skill-detail-title] + p'), 'board:SkillDetail/skill-detail.summary').toHaveText('把同一主体整理成一致的多面设定。')
  const meta = skillDetail.locator('[data-skill-detail-meta]')
  await expect(meta, 'board:SkillDetail/skill-detail.meta').toContainText('角色与场景')
  await expect(meta).toContainText('内置')
  await expect(meta).toContainText('Apache-2.0')
  await expect(meta.locator('a[href^="https://github.com/"]')).toHaveText('来源')
  await expect(skillDetail.getByRole('heading', { name: '配方', exact: true }), 'board:SkillDetail/skill-detail.body').toBeVisible()
  await expect(skillDetail, '正文里漏出了 frontmatter').not.toContainText('metadata:')
  await expect(skillDetail.locator('[data-skill-detail-export]'), 'board:SkillDetail/skill-detail.export').toHaveAttribute('aria-label', zh('libraries.skill.exportPackage'))
  await expect(skillDetail.locator('[data-skill-detail-delete]'), '内置技能不该有删除').toHaveCount(0)
  const addToChat = skillDetail.locator('[data-skill-detail-add-to-chat]')
  await expect(addToChat).toHaveText(zh('libraries.skill.addToChat'))
  await expect(addToChat).toBeDisabled()
  await expect(addToChat).toHaveAttribute('title', zh('libraries.layout.needsProject'))
  expect(await solidButtons(skillDetail), '技能详情不止一个实心主按钮').toBe(1)
  await shot('skill-detail-zh-light')
  // 只关详情、不关库：Esc 之后库还在。
  await win.keyboard.press('Escape')
  await expect(skillDetail).toHaveCount(0)
  await expect(page.locator('[data-skill-card="skill:curated-multi-view"]'), 'board:SkillDetail/skill-detail.close').toBeVisible()
  await skillSearch.fill('')

  // 暗色：示意插画封面换暗纸底 + 浅线（反相 + 转回色相），照片 / 视频不动（Q8）；卡面文字对比度 ≥4.5。
  await applyColorSchemeForShot(win, 'dark')
  const filters = () => page.locator('[data-skill-card] img[data-skill-media="image"]').evaluateAll((images) => images.map((image) => ({ illustration: image.className.includes('invert'), filter: getComputedStyle(image).filter })))
  await expect.poll(async () => (await filters()).some((entry) => entry.illustration && entry.filter.includes('invert')), { message: '暗色里示意插画没有换成暗纸底' }).toBe(true)
  expect((await filters()).filter((entry) => !entry.illustration).every((entry) => entry.filter === 'none'), '暗色里照片封面被反相了').toBe(true)
  contrast.darkSkillTitle = await contrastOf(page.locator('[data-skill-card] [data-library-entry-title]').first())
  contrast.darkSkillSummary = await contrastOf(page.locator('[data-skill-card] [data-library-entry-summary]').first())
  await shot('skill-page-zh-dark')
  await clickOrFail(page.locator('[data-skill-card]').first(), '暗色里打开一张技能')
  await expect(win.locator('[data-skill-detail]')).toBeVisible()
  await shot('skill-detail-zh-dark')
  await win.keyboard.press('Escape')
  await expect(win.locator('[data-skill-detail]')).toHaveCount(0)
  await clickOrFail(win.locator('[data-library-tab-button="prompts"]'), '提示词页签（暗）')
  await expect(page.locator('[data-prompt-card]').first()).toBeVisible()
  contrast.darkPromptTitle = await contrastOf(page.locator('[data-prompt-card-title]').first())
  await shot('prompt-page-zh-dark')
  await clickOrFail(page.locator('[data-prompt-card] button').first(), '暗色里打开一张提示词')
  await expect(win.locator('[data-prompt-preview]')).toBeVisible()
  await shot('prompt-detail-zh-dark')
  await win.keyboard.press('Escape')
  await expect(win.locator('[data-prompt-preview]')).toHaveCount(0)
  await applyColorSchemeForShot(win, 'light')
  for (const [name, ratio] of Object.entries(contrast)) expect(ratio, `${name} 对比度 ${ratio} < 4.5`).toBeGreaterThanOrEqual(4.5)

  // ═══ 项目里：左栏两个抽屉（280px）════════════════════════════════════════════════════
  await clickOrFail(win.locator('[data-library-tab-button="projects"]'), '项目页签')
  await clickOrFail(newProjectEntry(win), '新建一个项目')
  await switchWorkspace(win, 'generation', '进生成画布数一下节点')
  await expect(win.locator('.react-flow__pane').first()).toBeVisible()
  const nodesBefore = await win.locator('.react-flow__node').count()
  const skillsPanel = await openRailDrawer(win, 'skills', '左栏「Skill」')
  const skillsDrawer = railDrawer(win, 'skills')
  expect(Math.round((await box(skillsDrawer)).width), 'board:LibraryDrawers/drawer.panel').toBeGreaterThanOrEqual(270)
  await expect(skillsDrawer.locator('header h2'), 'board:LibraryDrawers/drawer.title').toHaveText('Skill')
  await expect(skillsDrawer.locator('header [data-skill-import]'), 'board:LibraryDrawers/drawer.import').toBeVisible()
  await expect(skillsDrawer.locator('header [data-skill-new]'), 'board:LibraryDrawers/drawer.new').toBeEnabled()
  await expect(skillsPanel.locator('input[type="search"]'), 'board:LibraryDrawers/drawer.search').toBeVisible()
  const filter = skillsPanel.locator('[data-library-category-menu]')
  await expect(filter, 'board:LibraryDrawers/drawer.filter').toHaveText('全部')
  const drawerGroup = skillsPanel.locator('[data-library-section^="builtin:"]').first()
  await expect(drawerGroup, 'board:LibraryDrawers/drawer.group').toBeVisible()
  await expect(drawerGroup.locator('[data-library-show-all]'), 'board:LibraryDrawers/drawer.group-more').toContainText(/全部 \d+/)
  const drawerSkill = skillsPanel.locator('[data-skill-card]').first()
  await expect(drawerSkill, 'board:LibraryDrawers/drawer.skill-card').toHaveCSS('height', '66px')
  await expect(drawerSkill.locator('[data-library-entry-title]'), 'board:LibraryDrawers/drawer.skill-card.title').toBeVisible()
  await expect(drawerSkill.locator('[data-library-entry-summary]'), 'board:LibraryDrawers/drawer.skill-card.summary').toHaveCSS('-webkit-line-clamp', '2')
  // 没有横向滚动的标签排。
  expect(await skillsDrawer.evaluate((root) => [...root.querySelectorAll('*')].some((element) => element.scrollWidth > element.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(element).overflowX))), '抽屉里有横向滚动').toBe(false)
  await shot('drawer-skill-zh-light')
  // 「分类 ▾」：菜单里三段，选一组 = 只看这一组。
  await clickOrFail(filter, '分类 ▾')
  const menu = win.getByTestId('library-category-menu')
  await expect(menu).toBeVisible()
  await shot('drawer-skill-menu-zh-light')
  await clickOrFail(menu.getByRole('menuitemradio').filter({ hasText: '我的' }), '菜单里选「我的」')
  await expect(filter).toHaveText('我的')
  await expect(skillsPanel.locator('[data-skill-card]'), '我的技能不是两张').toHaveCount(2)
  // 项目里「放进对话」能点：挂成技能芯片、切到创作（行为不变）。
  await clickOrFail(skillsPanel.locator('[data-skill-card="skill:walk-improv-scene"]'), '打开我的技能')
  const drawerDetail = win.locator('[data-skill-detail="skill:walk-improv-scene"]')
  await expect(drawerDetail.locator('[data-skill-detail-add-to-chat]')).toBeEnabled()
  await clickOrFail(drawerDetail.locator('[data-skill-detail-add-to-chat]'), '点「放进对话」')
  await expect(win.locator('[data-v4-chip="skill"]').first(), 'board:SkillDetail/skill-detail.add-to-chat').toContainText('walk-improv-scene')
  await expect(win.locator('[data-mode="creation"]').first()).toHaveAttribute('aria-current', 'page')

  // 提示词抽屉（这时在创作里）：两列，封面下标题 + 类型；「分类 ▾」里同时管图片 / 视频。
  const promptsPanel = await openRailDrawer(win, 'prompts', '左栏「提示词」')
  const promptsDrawer = railDrawer(win, 'prompts')
  await expect(promptsDrawer.locator('header [data-prompt-new]')).toBeVisible()
  const promptFilter = promptsPanel.locator('[data-library-category-menu]')
  await clickOrFail(promptFilter, '提示词「分类 ▾」')
  await clickOrFail(win.getByTestId('library-category-menu').getByRole('menuitemradio').filter({ hasText: '我的' }), '菜单里选「我的」')
  await expect(promptFilter).toHaveText('我的')
  const drawerQcard = promptsPanel.locator('[data-prompt-card="user-walk-qcard"]')
  await expect(drawerQcard, 'board:LibraryDrawers/drawer.prompt-card').toBeVisible()
  const drawerCards = await promptsPanel.locator('[data-prompt-card]').evaluateAll((cards) => cards.slice(0, 2).map((element) => Math.round(element.getBoundingClientRect().top)))
  expect(drawerCards[0], '抽屉里提示词卡不是一行两张').toBe(drawerCards[1])
  await expect(drawerQcard.locator('[data-prompt-card-title]'), 'board:LibraryDrawers/drawer.prompt-card.title').toHaveText('Q 版角色卡')
  await expect(drawerQcard.locator('[data-prompt-card-meta]'), 'board:LibraryDrawers/drawer.prompt-card.meta').toHaveText('网页提取 · 图片')
  await expect(promptsPanel.locator('[data-prompt-card="user-walk-tokyo"] [data-prompt-text-cover]'), 'board:LibraryDrawers/drawer.prompt-card.text-cover').toContainText('Tokyo')
  // 截断后的下一行不许从封面底部的内边距里露出半行（280px 抽屉里正文会被截断）。
  const clampedInside = await promptsPanel.locator('[data-prompt-card="user-walk-tokyo"] [data-prompt-text-cover]').evaluate((box) => {
    const text = box.firstElementChild.getBoundingClientRect()
    return { clamped: box.firstElementChild.scrollHeight > box.firstElementChild.clientHeight + 1, inside: text.bottom <= box.getBoundingClientRect().bottom - parseFloat(getComputedStyle(box).paddingBottom) + 0.5 }
  })
  expect(clampedInside, '抽屉里的文字封面：正文该被截断、且截断后不露半行').toEqual({ clamped: true, inside: true })
  await shot('drawer-prompt-zh-light')
  await clickOrFail(promptFilter, '提示词「分类 ▾」')
  await clickOrFail(win.getByTestId('library-category-menu').getByRole('menuitemradio', { name: '视频', exact: true }), '菜单里选「视频」')
  await expect(promptFilter).toHaveText('我的 · 视频')
  await expect.poll(() => promptsPanel.locator('[data-prompt-card-meta]').evaluateAll((metas) => metas.length > 0 && metas.every((item) => item.textContent.includes('视频')))).toBe(true)
  await clickOrFail(promptFilter, '提示词「分类 ▾」')
  await clickOrFail(win.getByTestId('library-category-menu').getByRole('menuitemradio').filter({ hasText: '全部' }).first(), '菜单里选回全部类型')
  await expect(promptFilter).toHaveText('我的')

  // 「放上画布」：总是新建对应类型的节点、带参考图、选中它，并切到生成画布让人看见；撤销删掉这个节点（Q9）。
  await clickOrFail(drawerQcard.locator('button').first(), '打开 Q 版角色卡')
  const qDetail = win.locator('[data-prompt-preview="user-walk-qcard"]')
  await expect(qDetail.locator('[data-prompt-detail-add]')).toBeEnabled()
  await clickOrFail(qDetail.locator('[data-prompt-detail-add]'), '点「放上画布」')
  await expect(win.locator('[data-mode="generation"]').first(), '放上画布后没切到生成画布').toHaveAttribute('aria-current', 'page')
  await expect(win.locator('.react-flow__node'), 'board:PromptDetail/prompt-detail.add-to-canvas').toHaveCount(nodesBefore + 1)
  await expect(win.locator('.react-flow__node.selected'), '新节点没被选中').toHaveCount(1)
  await expect(win.getByText(zh('libraries.prompt.sentToCanvas').replace('{{kind}}', zh('libraries.prompt.card.image'))).first()).toBeVisible()
  await expect.poll(() => win.locator('[data-node-composer-references] img').count(), { message: '新节点没带上参考图' }).toBeGreaterThan(0)
  await expect(win.locator('[data-node-composer-references] img').first(), '参考图不是条目自带的那张').toHaveAttribute('src', /^data:image\/jpeg/)
  await expect(win.getByText(zh('generationCommon.composer.promptReferenceUnsupported')), '收得下参考图的模型却说不支持').toHaveCount(0)
  await shot('add-to-canvas-zh-light')
  await clickOrFail(win.getByRole('button', { name: '撤销', exact: true }).last(), '撤销放上画布')
  await expect(win.locator('.react-flow__node'), '撤销没删掉新节点').toHaveCount(nodesBefore)

  // ═══ 英文 + 暗色：抽屉与页签各一张；主按钮不截断（★9 第 16 条）════════════════════════════
  await setAppLanguage(win, 'en', '切到英文')
  const drawerTruncation = async () => win.locator('[data-shell-drawer] button, [data-library-toolbar] button').evaluateAll((buttons) => buttons.filter((button) => button.offsetWidth && button.scrollWidth > button.clientWidth + 1).map((button) => button.textContent))
  const enSkills = await openRailDrawer(win, 'skills', 'Skill drawer (en)')
  await expect(enSkills.locator('[data-library-category-menu]')).toHaveText('All')
  await expect(railDrawer(win, 'skills').locator('header [data-skill-new]')).toHaveAttribute('aria-label', en('libraries.skill.createAria'))
  expect(await drawerTruncation(), '英文抽屉里有按钮被截断').toEqual([])
  await shot('drawer-skill-en-light')
  await applyColorSchemeForShot(win, 'dark')
  await shot('drawer-skill-en-dark')
  await applyColorSchemeForShot(win, 'light')
  const enPrompts = await openRailDrawer(win, 'prompts', 'Prompt drawer (en)')
  await expect(enPrompts.locator('[data-library-category-menu]')).toHaveText('All')
  await shot('drawer-prompt-en-light')
  await applyColorSchemeForShot(win, 'dark')
  await shot('drawer-prompt-en-dark')
  await clickOrFail(enPrompts.locator('[data-prompt-card] button').first(), 'open a prompt (en)')
  await expect(win.locator('[data-prompt-detail-add]')).toHaveText(en('libraries.prompt.preview.send'))
  expect(await win.locator('[data-prompt-detail-add]').evaluate((button) => button.scrollWidth <= button.clientWidth + 1), '英文「Add to canvas」被截断').toBe(true)
  await shot('prompt-detail-en-dark')
  await win.keyboard.press('Escape')
  await expect(win.locator('[data-prompt-preview]')).toHaveCount(0)
  await applyColorSchemeForShot(win, 'light')
  await closeRailDrawer(win, 'prompts')
  // 中文抽屉暗色一张（对照英文那张）。
  await setAppLanguage(win, 'zh-CN', '切回中文')
  await openRailDrawer(win, 'skills', '左栏「Skill」（暗）')
  await applyColorSchemeForShot(win, 'dark')
  await shot('drawer-skill-zh-dark')
  await openRailDrawer(win, 'prompts', '左栏「提示词」（暗）')
  await shot('drawer-prompt-zh-dark')
  await applyColorSchemeForShot(win, 'light')
  await closeRailDrawer(win, 'prompts')
  await setAppLanguage(win, 'en', '再切到英文看宽页')
  await backToLibrary(win, { label: 'back to library (en)' })
  await clickOrFail(win.locator('[data-library-tab-button="skills"]'), 'Skill tab (en)')
  await expect(toolbar('skills').locator('[data-skill-new]')).toHaveText('New')
  await expect(page.locator('[data-library-category="mine"]')).toContainText('Mine')
  await expect(page.locator('[data-library-category-segment="builtin"]')).toHaveText('Built-in')
  await shot('skill-page-en-light')
  await clickOrFail(page.locator('[data-skill-card]').first(), 'open a skill (en)')
  await expect(win.locator('[data-skill-detail-add-to-chat]')).toHaveText(en('libraries.skill.addToChat'))
  expect(await win.locator('[data-skill-detail-add-to-chat]').evaluate((button) => button.scrollWidth <= button.clientWidth + 1), '英文「Add to chat」被截断').toBe(true)
  await shot('skill-detail-en-light')
  await applyColorSchemeForShot(win, 'dark')
  await shot('skill-detail-en-dark')
  await win.keyboard.press('Escape')
  await expect(win.locator('[data-skill-detail]')).toHaveCount(0)
  await shot('skill-page-en-dark')
  await applyColorSchemeForShot(win, 'light')
  await clickOrFail(win.locator('[data-library-tab-button="prompts"]'), 'Prompts tab (en)')
  await expect(toolbar('prompts').getByRole('radio', { name: 'Video', exact: true })).toBeVisible()
  await expect(page.locator('[data-library-category-segment="public"]')).toHaveText('Public')
  const enSegment = await box(toolbar('prompts').getByRole('radiogroup'))
  expect(enSegment.height, '英文分段竖成了柱子').toBeLessThan(40)
  expect((await box(toolbar('prompts').locator('input[type="search"]'))).x, '英文分段挤到了搜索框').toBeGreaterThanOrEqual(enSegment.x + enSegment.width)
  await shot('prompt-page-en-light')
  await clickOrFail(page.locator('[data-prompt-card] button').first(), 'open a prompt on the page (en)')
  await expect(win.locator('[data-prompt-detail-add]')).toHaveAttribute('title', en('libraries.layout.needsProject'))
  await shot('prompt-detail-en-light')
  await win.keyboard.press('Escape')
  await expect(win.locator('[data-prompt-preview]')).toHaveCount(0)
  await applyColorSchemeForShot(win, 'dark')
  await shot('prompt-page-en-dark')
  await applyColorSchemeForShot(win, 'light')

  fs.writeFileSync(path.join(out, 'journey.json'), JSON.stringify({ passed: true, paidCalls: 0, contrast, shots }, null, 2))
  console.log(`library-layout walk passed · ${shots.length} shots in ${out} · contrast ${JSON.stringify(contrast)}`)
} catch (error) {
  await win.screenshot({ path: path.join(out, 'FAIL.png') }).catch(() => undefined)
  throw error
} finally {
  await run.close()
  cleanupTestTemp(skillFiles)
}
