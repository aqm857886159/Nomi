// 浏览器「提取提示词」付费走查与零花费演练共用的步骤本体（设计卡 docs/plan/2026-10-27-browser-extract-grant.md ★9 第 17 格）。
// 真付费走查（browser-extract-real.paid.mjs）与零花费演练（browser-extract-real.rehearsal.walk.mjs）跑**同一份**步骤，
// 差别只在读图模型：真付费是 App 里接好的真模型，演练是本机夹具里写好剧本的那个。两边各自直接调 openPaidWalk。
//
// 页面：本机回环 HTTP 服务给一页，页里一张登记过的真素材图（tests/ux/real-media-fixtures.json 的 image-4k-png，
// 从 NOMI_REAL_MEDIA_DIR 只读取；缺省压到长边 1920 的临时副本再给浏览器，跑完删，素材不提交）。在 Nomi 的浏览器面板里用地址栏打开这一页。
// 手势：对浏览视图发真实输入事件（webContents.sendInputEvent，Playwright 摸不到 WebContentsView），
// 走注入在网页里的那个「获取提示词」钮 → 「画面复刻」，以及工具栏的「截图提取提示词」。
//
// 四步（界面语言一致；每一步的硬断言写在步骤里，红了就整场红）：
//   ① 悬停图片 → 出卡 → 点取消：读图供应商 0 次、提示词库不变、标签页写「已取消提取」；
//   ② 再触发一次 → 卡开着时再触发一次：第二次回「忙」，标签页那句等于词典原文，始终只有 1 张卡；
//   ③ 在这张卡上点确认：读图供应商恰好 1 次、提示词库多 1 条；再等 60 秒，供应商仍是 1 次、没有第二张卡；
//   ④ 工具栏「截图提取」→ 出卡 → 取消：供应商仍是 1 次。
// 三方对账（确认 1 次 = 出站 1 笔 = 供应商 1 个任务）：卡上确认点击数；App 主进程自己的出站计数（undici 诊断通道，
// 演练里再与夹具收到的请求数对账，证计数器本身是对的）；供应商一侧（演练 = 夹具收到的读图请求；真付费 = 回包落成的那一条库内容，
// 账单由协调到供应商后台人工核对，这里不假装自动对过）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
import { expect, expectAbsent, proveProbe, screenshotSettled } from './_assert.mjs'
import { envKeyOf } from './_paidEnvKey.mjs'
import { SPEND_DIALOG } from './_paidRun.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'
import { uiText, uiTextWith } from './full-walk/invariants.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 被授权的读图模型：APIMart 上「看得见的那个」（electron/catalog/apimartTexts.ts：浏览器提取、视频拆解读帧都走它；deepseek 读不了图）。 */
export const VISION_MODEL = Object.freeze({ vendorKey: 'apimart', modelKey: 'gemini-3.5-flash' })
/** 登记的真素材（tests/ux/real-media-fixtures.json）：本机真实 4K PNG，素材不进仓库。 */
export const REAL_IMAGE_ID = 'image-4k-png'
/**
 * 页里那张图的长边上限（像素），缺省 1920：登记的 4K PNG 约 10 MB，内联进读图请求就是一次 13 MB 的请求体，真供应商收不收没有先例
 * （拆解读帧发的是小图）。压的只是尺寸，内容还是那张真照片；压出来的文件放测试临时目录、跑完删，不落用户目录、不进仓库。
 * NOMI_EXTRACT_IMAGE_MAX_EDGE=0 = 原样给那张 4K PNG（演练里整条链用原样跑通过一次：夹具收下 13 MB 的请求体）。
 */
const IMAGE_MAX_EDGE = Number(process.env.NOMI_EXTRACT_IMAGE_MAX_EDGE ?? 1920)
export const EXTRACT_EVIDENCE_DIR = path.join(REPO_ROOT, 'docs/evidence/2026-10-27-browser-extract-grant')
/** 确认之后再等多久：这段时间里供应商次数不许再涨、不许再冒出第二张卡（设计卡 ★9：确认之后不重发）。 */
export const HOLD_AFTER_CONFIRM_MS = 60_000
const HOLD_SAMPLE_MS = 2_000

const KEY_SHAPED = /\bsk-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i
const OP = stationTimeout({ operations: 1 })
const SLOW_OP = stationTimeout({ operations: 4 })

/** 读图请求：请求体里带图片（data: 内联的 image_url 部分）。引导时的连通性验证、别的文本调用都不带。 */
export function isVisionBody(body) {
  const text = JSON.stringify(body?.messages ?? body?.input ?? [])
  return text.includes('"image_url"') || text.includes('data:image/')
}

// ── 本机回环页面 ──────────────────────────────────────────────────────────────

const PAGE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Extraction walk page</title></head>
<body style="margin:24px;font-family:sans-serif;background:#f4f1ea"><h1 style="font-size:20px">Reference photo</h1>
<img id="hero" src="/reference.png" alt="Reference photo" style="display:block;width:640px;height:360px;object-fit:cover" /></body></html>`

/** 起页面服务：`/` 给页，`/reference.png` 把登记的真素材图（按 IMAGE_MAX_EDGE 压过尺寸）流出去。 */
export async function startExtractionPage({ env = process.env } = {}) {
  const asset = requireRealMediaAssets([REAL_IMAGE_ID], { env }).assets.get(REAL_IMAGE_ID)
  const originalBytes = fs.statSync(asset.file).size
  let served = asset.file
  let scratch = null
  if (IMAGE_MAX_EDGE > 0) {
    scratch = makeTempDir('nomi-extract-page-')
    served = path.join(scratch, 'reference.png')
    const ffmpeg = createRequire(import.meta.url)('@ffmpeg-installer/ffmpeg').path
    // 只压横向的长边（登记的是 3840×2160）；高度按比例取偶数。
    const scaled = spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', asset.file, '-vf', `scale='min(${IMAGE_MAX_EDGE},iw)':-2`, served])
    if (scaled.status !== 0) { cleanupTestTemp(scratch); throw new Error(`压小登记的真素材图失败：${String(scaled.stderr)}`) }
  }
  const bytes = fs.statSync(served).size
  const requests = []
  const server = http.createServer((request, response) => {
    requests.push(request.url ?? '')
    if (request.url === '/reference.png') {
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': bytes, 'cache-control': 'no-store' })
      fs.createReadStream(served).pipe(response)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    response.end(PAGE_HTML)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    pageUrl: `${origin}/`,
    image: { id: REAL_IMAGE_ID, bytes, originalBytes, maxEdge: IMAGE_MAX_EDGE, fileName: 'reference.png' },
    requests,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.()
      server.close(() => { if (scratch) cleanupTestTemp(scratch); resolve() })
    }),
  }
}

// ── 浏览视图（WebContentsView）里的手势 ───────────────────────────────────────────

const viewOf = (app, viewId, code) => app.evaluate(async ({ webContents }, input) => {
  const contents = webContents.getAllWebContents().find((candidate) => candidate.id === input.viewId)
  return contents ? contents.executeJavaScript(input.code, true) : { missingView: true }
}, { viewId, code })

const sendInput = (app, viewId, events) => app.evaluate(async ({ webContents }, input) => {
  const contents = webContents.getAllWebContents().find((candidate) => candidate.id === input.viewId)
  if (!contents) return false
  for (const event of input.events) {
    contents.sendInputEvent(event)
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  return true
}, { viewId, events })

/** 视图里某个元素的中心点（可见才有）；返回一段在视图里执行的表达式。 */
const centerOfSelector = (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || getComputedStyle(el).display === 'none') return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null })()`
/** 注入菜单里「画面复刻」那一项的中心点（按文字找：菜单是注入脚本里写死的中文，不随界面语言变；菜单没打开就是 null）。 */
const REPLICATE_OPTION_CENTER = `(() => { const menu = document.querySelector('[role="menu"][aria-label="选择提示词提取方式"]'); if (!menu || getComputedStyle(menu).display === 'none') return null; const el = [...menu.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes('画面复刻')); if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null })()`
const clickAt = ({ x, y }) => [{ type: 'mouseMove', x, y }, { type: 'mouseDown', x, y, button: 'left', clickCount: 1 }, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 }]

/** 等视图里某个点（表达式给出坐标）出现，有就返回坐标。 */
async function viewPoint(app, viewId, expression, message, timeout = OP) {
  let found = null
  await expect.poll(async () => { found = await viewOf(app, viewId, expression); return Boolean(found && !found.missingView) }, { message, timeout }).toBe(true)
  return found
}

/**
 * 页内「提取」的真手势：悬停图片 → 点「获取提示词」钮 → 点菜单里的「画面复刻」。
 * 钮和菜单是注入在网页里的（electron/browser/core/browserViewBridges.ts，写死的中文，不随界面语言变）。
 */
async function triggerInPageExtraction(app, viewId) {
  const hero = await viewPoint(app, viewId, centerOfSelector('#hero'), '页面里的图片')
  await sendInput(app, viewId, [{ type: 'mouseMove', x: hero.x - 4, y: hero.y - 4 }, { type: 'mouseMove', x: hero.x, y: hero.y }])
  const button = await viewPoint(app, viewId, centerOfSelector('button[aria-label="Nomi 获取提示词"]'), '悬停图片后出现「获取提示词」钮')
  await sendInput(app, viewId, clickAt(button))
  const option = await viewPoint(app, viewId, REPLICATE_OPTION_CENTER, '点钮后出现提取方式菜单')
  await sendInput(app, viewId, clickAt(option))
}

// ── 计数器与观察者 ─────────────────────────────────────────────────────────────

/**
 * 主进程自己的出站计数：订阅 undici 的 diagnostics_channel（App 唯一出站入口抓了原生 fetch，补丁 globalThis.fetch 拦不到它）。
 * 只计数、不拦截；只数 POST 到模型接口的（chat / messages / generateContent / responses）。
 */
async function installOutboundCounter(app) {
  await app.evaluate(() => {
    if (globalThis.__extractOutbound) return
    const counts = { model: 0, other: 0 }
    globalThis.__extractOutbound = counts
    const channels = process.getBuiltinModule('node:diagnostics_channel')
    channels.subscribe('undici:request:create', ({ request }) => {
      if (request?.method !== 'POST') return
      if (/\/chat\/completions|\/v1\/messages|generateContent|\/responses/.test(String(request.path ?? ''))) counts.model += 1
      else counts.other += 1
    })
  })
}
const readOutbound = (app) => app.evaluate(() => ({ ...globalThis.__extractOutbound }))

/** 付费确认卡的观察者：出现过几次、同一时刻最多几张。活体 = 取样次数（一次都没取到的「0 次」不作数）。 */
async function installCardWatch(win) {
  await win.evaluate((selector) => {
    const watch = { opened: 0, maxConcurrent: 0, samples: 0 }
    window.__extractCardWatch = watch
    let open = 0
    const sample = () => {
      const now = document.querySelectorAll(selector).length
      watch.samples += 1
      if (now > open) watch.opened += now - open
      open = now
      watch.maxConcurrent = Math.max(watch.maxConcurrent, now)
    }
    new MutationObserver(sample).observe(document.body, { childList: true, subtree: true, attributes: true })
    sample()
  }, SPEND_DIALOG)
}
const readCardWatch = (win) => win.evaluate(() => ({ ...window.__extractCardWatch }))

/** 「我的库」（用户级、跨项目）里的条目：提取的结果只进这里（addUserPrompt → promptLibrary.userAdd），读它用同一组 userList。 */
const userPrompts = (win) => win.evaluate(async () => {
  const result = await window.nomiDesktop.promptLibrary.userList()
  return (result?.prompts ?? []).map((prompt) => ({ id: prompt.id, title: prompt.title, prompt: prompt.prompt }))
})

// ── 证据 ────────────────────────────────────────────────────────────────────────

/**
 * 落盘前查 key：演练的假钥匙、环境变量里的 key、形如 sk-… / Bearer … 的串，命中就不写、抛错。
 * 真实资料那条路不读 key，原串无从比对，就按形状拦。返回写下的相对路径。
 */
export function writeExtractEvidence(subdir, fileName, report, { secrets = [] } = {}) {
  const text = `${JSON.stringify(report, null, 2)}\n`
  for (const secret of [envKeyOf(process.env), ...secrets]) {
    if (secret && secret.length >= 8 && text.includes(secret)) throw new Error('证据里出现了 key 原串，拒绝写入仓库——请更换这把 key')
  }
  if (KEY_SHAPED.test(text)) throw new Error('证据里有形如 key 的串（sk-… / Bearer …），拒绝写入仓库')
  const dir = path.join(EXTRACT_EVIDENCE_DIR, subdir)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, fileName)
  fs.writeFileSync(file, text)
  return path.relative(REPO_ROOT, file)
}

/** 证据摘要的公共部分（演练与付费同一份形状）。 */
export function extractEvidence({ script, mode, startedAt, journey, walk, failure, model, page }) {
  return {
    script, mode, startedAt, finishedAt: new Date().toISOString(),
    result: failure ? 'failed' : 'passed',
    failure: failure ? String(failure?.message ?? failure).slice(0, 2000) : null,
    model, image: page?.image ?? null,
    locales: (journey.passes ?? []).map((pass) => pass.locale),
    passes: journey.passes ?? [],
    holdAfterConfirmMs: HOLD_AFTER_CONFIRM_MS,
    spend: { text: walk.report.spend?.text ?? null, mediaCalls: walk.report.spend?.media?.length ?? null },
    networkBlocked: walk.report.networkBlocked ?? [],
    walkOutputDir: walk.report.outputDir ? path.relative(REPO_ROOT, walk.report.outputDir) : null,
  }
}

// ── 旅程 ────────────────────────────────────────────────────────────────────────

/**
 * @param {object} journey 调用方给的空对象，步骤往里写 passes / 计数；失败时里面已有的部分照样进证据。
 * @param {{ walk: any, page: Awaited<ReturnType<typeof startExtractionPage>>, locales: string[], evidenceSubdir: string,
 *           fixture?: any, outboundShouldMatchFixture?: boolean }} context
 *   locales：每个语言各走一遍四步（演练：zh-CN + en 各一套截图；真付费：只走 zh-CN，只花一次）。
 *   fixture：演练传夹具，用来与出站计数对账（证计数器本身是对的）；真付费不传。
 */
export async function runBrowserExtractJourney(journey, { walk, page, locales, evidenceSubdir, fixture = null }) {
  journey.passes = []
  const { win, app } = await walk.start({ first: true })
  await installOutboundCounter(app)
  await walk.newProject()
  // 读图的大脑固定成被授权的那一个：getTextBrain 读这条偏好；它不可用就直接报错，不会悄悄换成别家。
  await win.evaluate((pref) => localStorage.setItem('nomi.assistantModel', JSON.stringify(pref)), VISION_MODEL)

  const evidenceDir = path.join(EXTRACT_EVIDENCE_DIR, evidenceSubdir)
  fs.mkdirSync(evidenceDir, { recursive: true })
  const visionOnFixture = () => (fixture ? fixture.requests.filter((request) => isVisionBody(request.body)).length : null)

  for (const locale of locales) {
    const tag = locale === 'zh-CN' ? 'zh' : 'en'
    const L = (key) => uiText(locale, key)
    const LW = (key, values) => uiTextWith(locale, key, values)
    const pass = { locale, steps: [], shots: [], counts: {} }
    journey.passes.push(pass)
    const step = (id, text, facts = {}) => pass.steps.push({ id, text, ok: true, ...facts })

    // 语言：第一遍沿用 walk.start 设的 zh-CN；之后换语言 = 改本地偏好并重载（浏览器面板、视图随之重开）。
    if (locale !== (await win.evaluate(() => localStorage.getItem('nomi:locale:v1')))) {
      await win.evaluate((value) => localStorage.setItem('nomi:locale:v1', value), locale)
      await win.reload({ waitUntil: 'domcontentloaded' })
    }
    await expect(win.locator('[data-shell-browser]'), '顶栏浏览器入口').toBeVisible({ timeout: SLOW_OP })
    await installCardWatch(win)

    // 打开浏览器面板、地址栏打开本机页面、等视图里的页面和注入脚本就绪。
    // 页面重载（换语言、刷新提示词库）不会关掉上一遍留下的浏览视图（主进程拥有视图，渲染层重载没有卸载回调）：它们的 console 事件带着旧的
    // tabId，新面板会忽略。所以这一遍只认「开面板之前不存在」的那个视图。
    const staleViews = await app.evaluate(({ webContents }, base) => webContents.getAllWebContents().filter((contents) => contents.getURL().startsWith(base)).map((contents) => contents.id), page.origin)
    await win.locator('[data-shell-browser]').click()
    const address = win.locator(`input[aria-label="${L('browserAssets.addressBar')}"]`).first()
    await expect(address, '浏览器面板地址栏').toBeVisible({ timeout: SLOW_OP })
    await address.click()
    await address.fill(page.pageUrl)
    await address.press('Enter')
    let viewId = null
    await expect.poll(async () => {
      viewId = await app.evaluate(({ webContents }, input) => webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(input.base) && !input.stale.includes(contents.id))?.id ?? null, { base: page.origin, stale: staleViews })
      return viewId !== null
    }, { message: '浏览视图加载了本机页面', timeout: SLOW_OP }).toBe(true)
    await expect.poll(() => viewOf(app, viewId, `document.readyState === 'complete' && Boolean(document.getElementById('hero')?.naturalWidth) && window.__nomiBrowserPromptHoverBridgeInstalled === true`),
      { message: '页面里的图片已加载、提取脚本已注入', timeout: SLOW_OP }).toBe(true)
    const feedback = win.locator('[data-browser-action-feedback]')
    const card = win.locator(SPEND_DIALOG)
    // 等不到卡 / 等不到库里那一条时，把标签页当时写的那句带进失败信息：真供应商回空、回错、断网，原因都在那一句里。
    const explain = async (wait) => {
      try { await wait() } catch (error) {
        const shown = await feedback.innerText({ timeout: 1_000 }).catch(() => '（标签页没有提示）')
        error.message = `${error.message}\n标签页当时写的是：${shown}`
        throw error
      }
    }
    const snapMain = async (name) => {
      const source = await walk.snap(`${tag}-${name}`)
      const target = path.join(evidenceDir, `${tag}-${name}.png`)
      fs.copyFileSync(source, target)
      pass.shots.push(path.relative(REPO_ROOT, target))
      return target
    }
    const read = async () => ({
      outbound: (await readOutbound(app)).model,
      fixtureVision: visionOnFixture(),
      library: (await userPrompts(win)).length,
      cards: await readCardWatch(win),
    })
    const base = await read()
    const delta = async () => {
      const now = await read()
      return {
        outbound: now.outbound - base.outbound,
        fixtureVision: now.fixtureVision === null ? null : now.fixtureVision - base.fixtureVision,
        library: now.library - base.library,
        cardsOpened: now.cards.opened - base.cards.opened,
        maxConcurrentCards: now.cards.maxConcurrent,
        cardSamples: now.cards.samples,
      }
    }
    let confirmClicks = 0
    pass.counts.base = base
    // 这一遍开始前库里已有的条目（第二遍时里面有第一遍存的那一条）：「新的那一条」= 不在这里面的那条，不能按列表顺序取。
    const idsBefore = new Set((await userPrompts(win)).map((prompt) => prompt.id))

    // ── ① 悬停 → 出卡 → 取消 ──
    await triggerInPageExtraction(app, viewId)
    await explain(() => expect(card, '① 出卡').toBeVisible({ timeout: SLOW_OP }))
    const cardText = await card.innerText()
    expect(cardText, '① 卡标题').toContain(L('runtime.capability.promptExtractionTitle'))
    expect(cardText, '① 卡说明').toContain(L('runtime.capability.promptExtractionMessage'))
    expect(cardText, '① 来源页那一行').toContain(L('runtime.capability.promptExtractionPage'))
    expect(cardText, '① 来源页是这台本机页面的真实地址').toContain('127.0.0.1')
    expect(cardText, '① 图片那一行').toContain(L('runtime.capability.promptExtractionImage'))
    expect(cardText, '① 图片是页面里那张').toContain(page.image.fileName)
    expect(cardText, '① 读图模型那一行').toContain(VISION_MODEL.modelKey)
    expect(cardText, '① 主按钮').toContain(L('runtime.capability.confirmPromptExtraction'))
    pass.counts.cardTextAtStep1 = cardText
    await snapMain('1-extract-card')
    const cardProof1 = await proveProbe(card, '① 付费确认卡（它此刻在屏上）')
    await card.locator('[data-spend-confirm-action="cancel"]').click()
    await expectAbsent(card, { provenBy: cardProof1, message: '① 点取消后卡关掉' }, SLOW_OP)
    await expect(feedback, '① 标签页写「已取消提取」').toHaveText(L('browserAssets.promptExtractionCancelled'), { timeout: OP })
    const afterCancel = await delta()
    expect(afterCancel.outbound, '① 取消后读图供应商 0 次（主进程出站计数）').toBe(0)
    if (fixture) expect(afterCancel.fixtureVision, '① 取消后读图供应商 0 次（夹具收到的请求）').toBe(0)
    expect(afterCancel.library, '① 取消后提示词库不变').toBe(0)
    expect(afterCancel.cardsOpened, '① 恰好弹过 1 张卡').toBe(1)
    step('1-cancel', '悬停点提取 → 出卡 → 取消：供应商 0 次，库不变，标签页写已取消', { delta: afterCancel })

    // ── ② 再触发 → 卡开着时再触发一次 → 回「忙」，始终只有 1 张卡 ──
    await triggerInPageExtraction(app, viewId)
    await expect(card, '② 出卡').toBeVisible({ timeout: SLOW_OP })
    await expect(card, '② 此刻恰好 1 张卡').toHaveCount(1)
    await triggerInPageExtraction(app, viewId)
    await expect(feedback, '② 第二次触发回「忙」，界面上那句等于词典原文').toHaveText(L('browserAssets.promptExtractionBusy'), { timeout: SLOW_OP })
    await expect(card, '② 回「忙」之后仍然只有 1 张卡').toHaveCount(1)
    const afterBusy = await delta()
    expect(afterBusy.maxConcurrentCards, '② 同一时刻最多 1 张卡').toBe(1)
    expect(afterBusy.cardsOpened, '② 两次触发一共只弹过 2 张卡（第 ① 步 1 张 + 这一步 1 张）').toBe(2)
    expect(afterBusy.outbound, '② 忙的时候供应商仍是 0 次').toBe(0)
    await snapMain('2-busy-hint')
    step('2-busy', '卡开着时再触发：回忙，标签页那句等于词典原文，始终只有 1 张卡', { delta: afterBusy })

    // ── ③ 在这张卡上点确认 ──
    const cardProof3 = await proveProbe(card, '③ 付费确认卡（它此刻在屏上）')
    await card.locator('[data-spend-confirm-action="confirm"]').click()
    confirmClicks += 1
    await expectAbsent(card, { provenBy: cardProof3, message: '③ 点确认后卡关掉' }, SLOW_OP)
    await explain(() => expect.poll(async () => (await userPrompts(win)).length - base.library, { message: '③ 提示词库多 1 条', timeout: SLOW_OP }).toBe(1))
    const added = (await userPrompts(win)).find((prompt) => !idsBefore.has(prompt.id))
    expect(added, '③ 库里多出来的那一条').toBeTruthy()
    // 名字是模型回的（真付费时事先不知道，且词典插值可能转义特殊字符）：核「已存入提示词库：」这个前缀，名字另由库里那一条对账。
    const savedPrefix = L('browserAssets.savedToPromptLibraryNamed').split('{{name}}')[0]
    await expect(feedback, '③ 标签页写「已存入提示词库：<名字>」').toContainText(savedPrefix, { timeout: OP })
    expect(LW('browserAssets.savedToPromptLibraryNamed', { name: '' }), '③ 前缀取法与词典模板一致').toBe(savedPrefix)
    const afterConfirm = await delta()
    expect(afterConfirm.outbound, '③ 确认后读图供应商恰好 1 次（主进程出站计数）').toBe(1)
    if (fixture) expect(afterConfirm.fixtureVision, '③ 确认后读图供应商恰好 1 次（夹具收到的请求；计数器与地面真值相等）').toBe(1)
    expect(afterConfirm.library, '③ 库里恰好多 1 条').toBe(1)
    expect(confirmClicks, '③ 卡上确认点击 1 次').toBe(1)
    pass.counts.reconcile = { confirmClicks, outbound: afterConfirm.outbound, supplierSide: fixture ? afterConfirm.fixtureVision : `回包落成的库内容：${JSON.stringify({ title: added.title, promptChars: added.prompt.length })}` }
    // 再等 60 秒：供应商次数不许再涨、不许再冒出第二张卡、库不许再多一条。
    for (let sample = 0; sample < HOLD_AFTER_CONFIRM_MS / HOLD_SAMPLE_MS; sample += 1) {
      await new Promise((resolve) => setTimeout(resolve, HOLD_SAMPLE_MS))
      const held = await delta()
      expect(held.outbound, `③ 确认之后等满 ${HOLD_AFTER_CONFIRM_MS / 1000} 秒，供应商仍是 1 次`).toBe(1)
      if (fixture) expect(held.fixtureVision, '③ 等待期间夹具也只收到 1 次读图请求').toBe(1)
      expect(held.library, '③ 等待期间库里仍是多 1 条').toBe(1)
      expect(held.cardsOpened, '③ 等待期间没有再弹卡').toBe(2)
    }
    const afterHold = await delta()
    step('3-confirm', `在卡上点确认：供应商恰好 1 次，库多 1 条，再等 ${HOLD_AFTER_CONFIRM_MS / 1000} 秒仍是 1 次`, { delta: afterHold, added: { title: added.title } })

    // ── ④ 工具栏「截图提取」→ 出卡 → 取消 ──
    await win.locator(`button[aria-label="${L('browserAssets.screenshotPrompt')}"]`).click()
    let menuPage = null
    await expect.poll(async () => {
      for (const candidate of app.windows()) {
        if (candidate === win || candidate.isClosed()) continue
        if ((await candidate.title().catch(() => '')) === 'Nomi Browser Chrome Menu') { menuPage = candidate; return true }
      }
      return false
    }, { message: '④ 工具栏弹出提取方式菜单', timeout: OP }).toBe(true)
    await menuPage.locator('button[data-id="replicate"]').click()
    await viewPoint(app, viewId, centerOfSelector('#__nomi_prompt_screenshot_selection__'), '④ 浏览视图里出现截图框选层', SLOW_OP)
    const size = await viewOf(app, viewId, '({ width: window.innerWidth, height: window.innerHeight })')
    const from = { x: 60, y: 90 }
    const to = { x: Math.min(420, size.width - 40), y: Math.min(300, size.height - 40) }
    await sendInput(app, viewId, [
      { type: 'mouseMove', ...from },
      { type: 'mouseDown', ...from, button: 'left', clickCount: 1 },
      { type: 'mouseMove', x: Math.round((from.x + to.x) / 2), y: Math.round((from.y + to.y) / 2), button: 'left' },
      { type: 'mouseMove', ...to, button: 'left' },
      { type: 'mouseUp', ...to, button: 'left', clickCount: 1 },
    ])
    await explain(() => expect(card, '④ 截图提取也出卡').toBeVisible({ timeout: SLOW_OP }))
    const shotCardText = await card.innerText()
    expect(shotCardText, '④ 卡标题').toContain(L('runtime.capability.promptExtractionTitle'))
    expect(shotCardText, '④ 图片那一行写「页面截图」').toContain(L('runtime.capability.promptExtractionScreenshot'))
    const cardProof4 = await proveProbe(card, '④ 付费确认卡（它此刻在屏上）')
    await card.locator('[data-spend-confirm-action="cancel"]').click()
    await expectAbsent(card, { provenBy: cardProof4, message: '④ 点取消后卡关掉' }, SLOW_OP)
    await expect(feedback, '④ 标签页写「已取消提取」').toHaveText(L('browserAssets.promptExtractionCancelled'), { timeout: OP })
    const afterShot = await delta()
    expect(afterShot.outbound, '④ 截图提取取消后供应商仍是 1 次').toBe(1)
    if (fixture) expect(afterShot.fixtureVision, '④ 截图提取取消后夹具仍是 1 次').toBe(1)
    expect(afterShot.library, '④ 库里仍是多 1 条').toBe(1)
    expect(afterShot.cardsOpened, '④ 整遍一共弹过 3 张卡（① 取消的、② 确认的、④ 截图取消的）').toBe(3)
    step('4-screenshot-cancel', '工具栏截图提取 → 出卡 → 取消：供应商仍是 1 次', { delta: afterShot })
    pass.counts.final = afterShot

    // 提示词库里新的那一条（第 ③ 步确认后存进去的）：关掉浏览器面板（它盖住左侧栏）→ 左侧栏「提示词库」抽屉 → 按那一条的标题搜，只剩它。
    // 硬断言：**不重载窗口**，抽屉里就要看到这一条。浏览器提取经 promptLibraryApi.addUserPrompt 直接写库、不经抽屉自己的 hook；
    // 「我的库」列表在渲染层只有一个共享缓存（promptLibrary/userPromptList.ts），写口写完当场发布，抽屉每次打开还会重读一次，
    // 所以这里不需要、也不许靠重载页面救场（以前这一格只是观察，红了就重载再看，缺陷因此一直挂着）。
    await win.locator(`button[aria-label="${L('browserAssets.closeBrowser')}"]`).first().click()
    const entryCard = win.locator(`[data-prompt-card="${added.id}"]`)
    if (!(await win.locator('[data-prompt-library]').isVisible())) await win.locator('[data-shell-rail-item="prompts"]').click()
    await win.locator(`input[aria-label="${L('libraries.prompt.searchAria')}"]`).fill(added.title)
    await expect(entryCard, '不重载窗口，左侧「提示词」抽屉里就能看到第 ③ 步存进去的那一条').toBeVisible({ timeout: SLOW_OP })
    await expect(entryCard.locator('[data-prompt-card-title]'), '那一条的标题就是库里存的标题').toHaveText(added.title, { timeout: OP })
    pass.counts.libraryPanel = { entryShownWithoutReload: true }
    // 这一条的封面是网页图的缩略图，也就是登记的那张私人真素材：证据要进公开仓库，所以截图时就把封面遮住（Playwright mask，不是事后涂），
    // 那张照片的任何缩略都不落进仓库；标题、来源标签、「我的」分组照常入镜。
    const librarySnap = path.join(evidenceDir, `${tag}-3-library-entry.png`)
    await screenshotSettled(win, { path: librarySnap, mask: [entryCard.locator('[data-prompt-cover]')], maskColor: '#c9c6bd' })
    pass.shots.push(path.relative(REPO_ROOT, librarySnap))
    await win.locator('[data-shell-rail-item="prompts"]').click()
  }
}
