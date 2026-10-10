// R13 走查：节点提示词「翻译」（2026-09-21 用户拍板：选中一段只翻那段、没选中翻整段、方向自动、
// 原地替换、Cmd+Z 一步回原文；图片和视频节点都有，放在「优化」左边）。
//
// 四件真实：打包同构的 dev Electron（隔离 profile）/ 真实页面输入（键盘打字、鼠标拖选、点按钮、
// Cmd+Z）/ 真实文本模型（DeepSeek 官方端点，走产品同一条 prompt_refine 文本管线）/
// 真实图片素材（仓库里的 1024×1792 实拍细节图，经「加参考 → 上传本地文件」进参考槽，再点 tile 插 chip）。
//
// 断言钉的是用户看得见的结果，不是实现：
//   · 选中段变成英文、选区外的字一个不动、chip 还在且数量不变（选区若在点按钮时丢了，
//     整段都会被翻——「选区外的字不动」这一条正好把它抓出来）；
//   · Cmd+Z 一步回到原文（逐字相等）；
//   · 不选中 → 整段翻；再点一次 → 翻回中文；
//   · 视频节点同样可用；
//   · 翻译钮在优化钮左边（几何量出来，不信 DOM 顺序）。
// 另记调用次数 / 成功次数 / 单次耗时进报告。
//
// 用法：先 pnpm run build；DEEPSEEK_API_KEY 取自 env（`set -a; . ~/.nomi-secrets.env; set +a`）。
//   node tests/ux/prompt-translate.walk.mjs
// 产出：tests/ux/shots/prompt-translate/*.png + report.json（key 不进任何日志/截图/报告）。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { clickOrFail, expect, expectVisible, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'
import { newProjectEntry } from './_shell.mjs'

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) throw new Error('需要 DEEPSEEK_API_KEY（真实文本模型走查，不许 mock）：set -a; . ~/.nomi-secrets.env; set +a')

const VENDOR = 'deepseek-official'
const MODEL = 'deepseek-chat'
const REFERENCE_IMAGE = path.join(repoRoot, 'tests/ux/fixtures/hires-detail-1024x1792.png')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/prompt-translate')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const TRANSLATE = '[data-prompt-tool="translate"]'
const OPTIMIZE = '[data-prompt-tool="optimize"]'
const COMPOSER = '.generation-canvas-v2-node__composer'
const EDITOR = `${COMPOSER} .generation-canvas-v2-node__prompt-input`
// 一次真模型翻译的等待预算：按站点预算算（6 个操作档 = 90s），不私设墙钟。
const MODEL_TIMEOUT = stationTimeout({ operations: 6 })
const CJK = /[㐀-鿿]/
const LATIN_WORD = /[A-Za-z]{3,}/

const report = { model: `${VENDOR}/${MODEL}`, calls: [], screenshots: [] }
const redact = (text) => String(text).split(API_KEY).join('[REDACTED]')

/**
 * 隔离 profile + 真实 DeepSeek 凭据。凭据必须是 safeStorage 密文（明文记录不可执行），
 * 而密文只能由同一个 Electron 身份加密：先起一次拿密文、关掉、写 catalog、再起。
 * 起第一次时 app 已把内置种子写进 catalog，这里只**追加**一家 DeepSeek，不改别的。
 */
async function launchWithDeepSeek(locale) {
  const root = path.join(repoRoot, '.tmp', `prompt-translate-${locale}`)
  fs.rmSync(root, { recursive: true, force: true })
  const dirs = {
    userDataDir: path.join(root, 'user-data'), settingsDir: path.join(root, 'settings'),
    projectsDir: path.join(root, 'projects'), capabilityDir: path.join(root, 'capability'),
  }
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true })
  const initialLocalStorage = {
    'nomi:locale:v1': locale, 'nomi-color-scheme': 'light',
    'nomi:splash:v1': 'seen', 'nomi:journey-tour:v1': 'seen', 'nomi:canvas-gesture-hint:v1': 'seen',
  }
  const first = await launchNomiApp({ name: `prompt-translate-${locale}`, tempRoot: root, ...dirs, settleMs: 0, initialLocalStorage })
  const cipher = await first.app.evaluate(({ safeStorage }, key) => safeStorage.encryptString(key).toString('base64'), API_KEY)
  await first.app.close()
  const catalogFile = path.join(dirs.settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
  const now = new Date().toISOString()
  catalog.vendors.push({ key: VENDOR, name: 'DeepSeek Official', enabled: true, baseUrlHint: 'https://api.deepseek.com', providerKind: 'openai-compatible', authType: 'bearer', createdAt: now, updatedAt: now })
  catalog.models.push({ vendorKey: VENDOR, modelKey: MODEL, labelZh: MODEL, kind: 'text', enabled: true, published: true, createdAt: now, updatedAt: now })
  catalog.apiKeysByVendor = { ...(catalog.apiKeysByVendor || {}), [VENDOR]: { vendorKey: VENDOR, apiKey: cipher, enc: 'safeStorage', enabled: true, createdAt: now, updatedAt: now } }
  fs.writeFileSync(catalogFile, JSON.stringify(catalog), { mode: 0o600 })
  const launched = await launchNomiApp({ name: `prompt-translate-${locale}`, tempRoot: root, ...dirs, settleMs: 0 })
  // 断言前先证明现场：文本大脑就是这家 DeepSeek（不是别的内置家在替它答）。
  await expect.poll(() => launched.win.evaluate(() => window.nomiDesktop.promptLibrary.textBrain().then((r) => r?.brain ?? null)),
    { message: '文本大脑应解析到隔离 catalog 里的 DeepSeek', timeout: DEFAULT_TIMEOUT_MS }).toEqual({ vendor: VENDOR, modelKey: MODEL })
  return launched
}

async function openBlankGenerationCanvas(win, english) {
  await clickOrFail(newProjectEntry(win), english ? 'New blank project' : '新建空白项目')
  await clickOrFail(win.getByRole('button', { name: english ? 'Generate' : '生成', exact: true }), english ? 'Generate tab' : '生成 标签')
  await expectVisible(win.locator('.generation-canvas-v2-toolbar').first(), '生成画布左缘工具条就绪')
  // 首启遥测征询卡按最保护隐私的一档答，免得盖住画布。
  const consent = win.getByRole('button', { name: english ? "Don't share" : '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()
}

/** 编辑器内容的可读投影：文字原样，chip 记成 ⟪chip⟫，段落用 \n。只读。 */
function readPrompt(win) {
  return win.locator(EDITOR).evaluate((root) => {
    const pm = root.classList.contains('ProseMirror') ? root : root.querySelector('.ProseMirror') ?? root
    return [...pm.children].map((paragraph) => {
      let out = ''
      const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) { out += node.textContent; return }
        if (node.nodeType !== Node.ELEMENT_NODE) return
        if (node.matches('[data-asset-mention]')) { out += '⟪chip⟫'; return }
        if (node.matches('.ProseMirror-trailingBreak, br')) return
        node.childNodes.forEach(walk)
      }
      paragraph.childNodes.forEach(walk)
      return out
    }).join('\n')
  })
}

const chipCount = (text) => (text.match(/⟪chip⟫/g) ?? []).length

/** 真人拖选：量出子串在屏幕上的首尾坐标，鼠标按下 → 拖到尾 → 松开。 */
/**
 * 真人收起选区：鼠标点在提示词最后一个字的右边，光标落到文末。
 *
 * 不用 End 键：macOS 的 Chromium 里 End 只滚动、不移动光标（系统约定是 Cmd+→）。
 * 这条走查以前能靠 End「收起」选区，其实是旧回写 bug 的副作用——撤回之后外部同步把整篇
 * setContent 了一遍，选区被冲成文末光标；修掉回写之后撤回按 ProseMirror 的本义把原选区还回来，
 * End 就什么都不做了（2026-09-21 实测：main 撤回后选区 34–34，修后 18–29；两边按 End 都不变）。
 */
async function clickAtTextEnd(win) {
  const point = await win.locator(EDITOR).evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let last = null
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent.length) last = node
    if (!last) return null
    const range = document.createRange()
    range.setStart(last, last.textContent.length - 1)
    range.setEnd(last, last.textContent.length)
    const rect = range.getBoundingClientRect()
    return { x: rect.right + 2, y: rect.top + rect.height / 2 }
  })
  if (!point) throw new Error('提示词里没有文字，点不到文末')
  await win.mouse.click(point.x, point.y)
  await expect.poll(() => win.evaluate(() => window.getSelection()?.isCollapsed ?? false), { message: '点在文末之后选区已收起' }).toBe(true)
}

async function dragSelect(win, needle) {
  const box = await win.locator(EDITOR).evaluate((root, target) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent.indexOf(target)
      if (at < 0) continue
      const first = document.createRange(); first.setStart(node, at); first.setEnd(node, at + 1)
      const last = document.createRange(); last.setStart(node, at + target.length - 1); last.setEnd(node, at + target.length)
      const a = first.getBoundingClientRect(); const b = last.getBoundingClientRect()
      return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 }
    }
    return null
  }, needle)
  if (!box) throw new Error(`拖选目标不在编辑器里：${needle}`)
  await win.mouse.move(box.x1, box.y1)
  await win.mouse.down()
  await win.mouse.move((box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2, { steps: 6 })
  await win.mouse.move(box.x2, box.y2, { steps: 6 })
  await win.mouse.up()
  await expect.poll(() => win.evaluate(() => window.getSelection()?.toString() ?? ''), { message: `鼠标拖选应正好选中「${needle}」` }).toBe(needle)
}

/** 点翻译钮并等结果落地（编辑器内容变了且按钮回到空闲态）。记一次调用。 */
async function clickTranslate(win, label, idleLabel = '翻译提示词（中英互译，选中一段只翻那段）') {
  const before = await readPrompt(win)
  const started = Date.now()
  await clickOrFail(win.locator(`${COMPOSER} ${TRANSLATE}`), `翻译钮（${label}）`)
  let after = before
  let ok = false
  try {
    await expect.poll(async () => { after = await readPrompt(win); return after !== before },
      { message: `${label}：${MODEL_TIMEOUT / 1000}s 内提示词应被译文替换`, timeout: stationTimeout({ operations: 6 }), intervals: [250] }).toBe(true)
    ok = true
  } finally {
    report.calls.push({ label, ok, ms: Date.now() - started })
  }
  // 完成后按钮回到空闲名字（运行中它叫「翻译中…（再点取消）」）。
  await expect(win.locator(`${COMPOSER} ${TRANSLATE}`), `${label}：完成后翻译钮回到空闲态`).toHaveAttribute('aria-label', idleLabel)
  console.log(`  ✓ ${label}（${Date.now() - started}ms）\n      前：${before}\n      后：${after}`)
  return { before, after }
}

async function shot(target, name) {
  const file = path.join(shotsDir, `${name}.png`)
  await screenshotSettled(target, { path: file })
  report.screenshots.push(file)
}

/** 翻译钮在优化钮左边、同一行、同尺寸（真几何）。 */
async function expectTranslateLeftOfOptimize(win, label) {
  const geometry = await win.locator(COMPOSER).evaluate((card, selectors) => {
    const rect = (selector) => card.querySelector(selector)?.getBoundingClientRect()
    const t = rect(selectors.translate); const o = rect(selectors.optimize)
    return t && o ? { tRight: t.right, oLeft: o.left, tMid: t.top + t.height / 2, oMid: o.top + o.height / 2, tH: t.height, oH: o.height } : null
  }, { translate: TRANSLATE, optimize: OPTIMIZE })
  expect(geometry, `${label}：翻译钮与优化钮都在底栏 B 簇里`).not.toBeNull()
  expect(geometry.tRight, `${label}：翻译钮在优化钮左边`).toBeLessThanOrEqual(geometry.oLeft)
  expect(Math.abs(geometry.tMid - geometry.oMid), `${label}：两颗在同一行`).toBeLessThan(2)
  expect(geometry.tH, `${label}：同一尺寸档`).toBe(geometry.oH)
}

/**
 * hover 出名字。刚点过的按钮 Radix 不会再弹气泡（按下即关、要等指针离开），
 * 所以像真人一样先把鼠标挪开再悬停上去。
 */
async function hoverName(win, name, message) {
  await win.mouse.move(8, 8)
  await win.locator(`${COMPOSER} ${TRANSLATE}`).hover()
  await expectVisible(win.locator('[data-radix-popper-content-wrapper]').filter({ hasText: name }), message)
}

let current
try {
  // ─────────────── 中文界面：图片节点全流程 ───────────────
  current = await launchWithDeepSeek('zh-CN')
  let win = current.win
  await openBlankGenerationCanvas(win, false)
  await addCanvasNodeFromRail(win, 'image')
  const composer = win.locator(COMPOSER).first()
  await expectVisible(composer, '新建图片节点后浮出生成浮框')
  await expectTranslateLeftOfOptimize(win, '图片节点')
  await expect(win.locator(`${COMPOSER} ${TRANSLATE}`), '提示词为空时翻译钮禁用').toBeDisabled()

  // 真实素材进参考槽：改图模式 → 加参考 → 上传本地文件。
  await clickOrFail(composer.getByRole('button', { name: '改图', exact: true }), '改图 模式')
  await clickOrFail(composer.locator('button[aria-label="加参考"]'), '加参考')
  await win.locator('input[type="file"][aria-label="上传本地文件"]').first().setInputFiles(REFERENCE_IMAGE)
  await expectVisible(composer.locator('[aria-label="输入图1"]'), '上传后出现参考 tile「输入图1」')

  // 打字 + 点 tile 插 chip + 继续打字。
  await clickOrFail(win.locator(EDITOR), '提示词框')
  // 中文走 insertText = 输入法上屏那一下（逐键 type 会丢字，那是仪器问题不是产品问题）。
  await win.keyboard.insertText('一只橘猫坐在窗台上，参考')
  await clickOrFail(composer.locator('[aria-label="输入图1"]'), '参考 tile（插入引用 chip）')
  await expect(win.locator(`${EDITOR} [data-asset-mention]`), '提示词里插入了 1 个引用 chip').toHaveCount(1)
  await win.keyboard.insertText('的毛色，窗外是黄昏的城市天际线，暖色逆光')
  const original = await readPrompt(win)
  expect(original, '原始提示词（含 chip）').toBe('一只橘猫坐在窗台上，参考⟪chip⟫的毛色，窗外是黄昏的城市天际线，暖色逆光')
  await shot(win, '01-zh-original')

  // ① 选中一段 → 只翻那段。
  await dragSelect(win, '窗外是黄昏的城市天际线')
  const partial = await clickTranslate(win, '选中一段（中→英）')
  expect(partial.after.startsWith('一只橘猫坐在窗台上，参考⟪chip⟫的毛色，'), '选区前的文字与 chip 原样不动').toBe(true)
  expect(partial.after.endsWith('，暖色逆光'), '选区后的文字原样不动').toBe(true)
  const replaced = partial.after.slice('一只橘猫坐在窗台上，参考⟪chip⟫的毛色，'.length, -'，暖色逆光'.length)
  expect(CJK.test(replaced), `选中段已无中文：${replaced}`).toBe(false)
  expect(LATIN_WORD.test(replaced), `选中段变成了英文：${replaced}`).toBe(true)
  expect(chipCount(partial.after), '引用 chip 数量不变').toBe(1)
  await shot(win, '02-zh-partial-translated')

  // ② Cmd+Z 一步回原文：像真人一样先点回提示词框再按。
  await clickOrFail(win.locator(EDITOR), '点回提示词框')
  await win.keyboard.press('Meta+z')
  await expect.poll(() => readPrompt(win), { message: 'Cmd+Z 一步回到原文（逐字相等）' }).toBe(original)
  console.log('  ✓ Cmd+Z 一步回到原文')

  // ③ 不选中 → 整段翻成英文。
  await clickAtTextEnd(win)
  const whole = await clickTranslate(win, '整段（中→英）')
  expect(CJK.test(whole.after), `整段已无中文：${whole.after}`).toBe(false)
  expect(chipCount(whole.after), '整段翻译后 chip 仍在且只有 1 个').toBe(1)
  await shot(win, '03-zh-whole-english')

  // ④ 对英文提示词再点一次 → 翻回中文。
  const back = await clickTranslate(win, '整段（英→中）')
  expect(CJK.test(back.after), `翻回中文：${back.after}`).toBe(true)
  expect(chipCount(back.after), '翻回中文后 chip 仍在且只有 1 个').toBe(1)
  await expectTranslateLeftOfOptimize(win, '图片节点（翻译后）')
  await hoverName(win, '翻译提示词', 'hover 翻译钮出名字')
  await shot(win, '04-zh-image-icon-and-result')

  // ⑤ 视频节点：英文提示词 → 中文。
  await win.keyboard.press('Escape')
  await addCanvasNodeFromRail(win, 'video')
  await expectVisible(win.locator(COMPOSER).first(), '新建视频节点后浮出生成浮框')
  await expectTranslateLeftOfOptimize(win, '视频节点')
  await clickOrFail(win.locator(EDITOR), '视频节点提示词框')
  await win.keyboard.type('A samurai walks slowly through a bamboo forest in heavy rain, camera tracking from behind', { delay: 40 })
  await expect.poll(() => readPrompt(win), { message: '视频节点提示词逐字打进去了' }).toBe('A samurai walks slowly through a bamboo forest in heavy rain, camera tracking from behind')
  const video = await clickTranslate(win, '视频节点整段（英→中）')
  expect(CJK.test(video.after), `视频提示词翻成中文：${video.after}`).toBe(true)
  await shot(win, '05-zh-video-translated')
  await current.app.close()
  current = null

  // ─────────────── 英文界面：图片节点 英→中 + 截图 ───────────────
  current = await launchWithDeepSeek('en')
  win = current.win
  await openBlankGenerationCanvas(win, true)
  await addCanvasNodeFromRail(win, 'image')
  await expectVisible(win.locator(COMPOSER).first(), 'EN：新建图片节点后浮出生成浮框')
  await expectTranslateLeftOfOptimize(win, 'EN 图片节点')
  await clickOrFail(win.locator(EDITOR), 'EN 提示词框')
  await win.keyboard.type('An orange cat sitting on a windowsill at dusk, warm rim light, city skyline outside', { delay: 40 })
  await expect.poll(() => readPrompt(win), { message: 'EN：提示词逐字打进去了' }).toBe('An orange cat sitting on a windowsill at dusk, warm rim light, city skyline outside')
  const en = await clickTranslate(win, 'EN 界面整段（英→中）', 'Translate prompt (Chinese ↔ English; select text to translate only that part)')
  expect(CJK.test(en.after), `EN 界面下英文提示词翻成中文：${en.after}`).toBe(true)
  await hoverName(win, 'Translate prompt', 'EN：hover 翻译钮出英文名字')
  await shot(win, '06-en-image-icon-and-result')
  await current.app.close()
  current = null

  const succeeded = report.calls.filter((call) => call.ok)
  report.summary = {
    calls: report.calls.length,
    succeeded: succeeded.length,
    msMin: Math.min(...succeeded.map((call) => call.ms)),
    msMax: Math.max(...succeeded.map((call) => call.ms)),
    msAvg: Math.round(succeeded.reduce((sum, call) => sum + call.ms, 0) / Math.max(1, succeeded.length)),
  }
  report.result = 'pass'
  console.log(`\n  翻译调用 ${report.summary.calls} 次，成功 ${report.summary.succeeded} 次，耗时 ${report.summary.msMin}–${report.summary.msMax}ms（均 ${report.summary.msAvg}ms）`)
} catch (error) {
  report.result = 'fail'
  report.error = redact(error?.stack ?? error)
  if (current) await current.win.screenshot({ path: path.join(shotsDir, 'FAIL.png') }).catch(() => {})
  console.error(redact(error?.stack ?? error))
  process.exitCode = 1
} finally {
  if (current) await current.app.close().catch(() => {})
  fs.writeFileSync(path.join(shotsDir, 'report.json'), redact(JSON.stringify(report, null, 2)))
}
