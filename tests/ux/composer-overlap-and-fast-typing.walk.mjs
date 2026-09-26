// R13 走查：节点生成浮框（composer）钉在节点正下方（被画布底部 chrome 挡就挡）+ 提示词编辑器快速输入不丢字。
//
// 两个用户可见症状（2026-09-21）：
//   ① 图片节点 composer 底栏（变体/参数芯片、生成钮）被画布左下的缩放工具条与底部「时间轴」胶囊压住；
//   ② 以 0ms 间隔逐键输入「A samurai walks…」变成「Ai waks…」（文字扩展工具、输入法上屏、极快打字）。
// ① 的修法（躲停靠区 / 翻到上方 / clamp 进视口）已于 2026-09-25 被用户收回：「钉在节点正下方、宽度固定、
// 被挡就挡」（原话「有时候位置不在下面而是在节点中间」「遮挡就遮挡了，保持位置」）。位置 owner 现在是
// src/workbench/generationCanvas/nodes/composerCanvasPlacement.ts（只看节点尺寸 + 画布缩放）。所以这里
// 不再断「底栏不与停靠区相交」「翻到上方」，改断反面：把节点拖进停靠区那片、压到舞台底边，浮框**照旧**钉在下方。
//
// 四件真实：打包同构的 dev Electron（隔离 profile）/ 真实页面输入（鼠标拖节点、键盘逐键输入、Cmd+V 粘贴、
// 点「优化」再点「应用」）/ 真实文本模型（DeepSeek 官方端点，走产品同一条 prompt_refine 管线，
// 用来产生一次真正来自编辑器之外的改写）/ 真实图片素材（1024×1792 实拍细节图进参考槽，让浮框长到截图里那么高）。
//
// 断言钉的是用户看得见的结果：
//   · 浮框卡片顶边 = 节点底边 + 14×缩放、中线 = 节点中线、屏幕宽恒 560——默认位置、拖到左下停靠区那片、
//     压到舞台底边（以前会翻上去的现场）、缩到最小窗口（1100×720 内容区）各测一次；伸出舞台 / 钻到停靠区底下是预期；
//   · 0ms / 5ms 逐键键入 ≥80 字符中英混合串（含空格与标点）后，编辑器与输入逐字相同（图片 + 视频节点）；
//   · 一次性粘贴长文本逐字相同；
//   · 外部改写（优化 → 应用提示）确实写进编辑器，且之后继续快打不丢字；
//   · 追加 C：「生成方式」模式栏完整在卡内、不被参考区滚动口裁、不与提示词区相交；浮框在屏上时 tab 点得中（zh/en）；
//   · 追加 B：底栏芯片文字不被裁断——只允许「有意省略号 + title 全名 + 省略后仍 ≥24px」（1100×720 EN 是现场）。
//   （原「追加 A：翻到上方的卡片不压节点浮条 / 标签行」随翻转一起退役：浮框恒在节点下方，结构上碰不到上沿 chrome。）
// 另记一个探针：输入过程中编辑器文字「倒退」（纯插入却变短）的次数——那就是旧值回流覆盖文档的现场。
//
// 用法：先 pnpm run build；DEEPSEEK_API_KEY 取自 env（`set -a; . ~/.nomi-secrets.env; set +a`）。
//   node tests/ux/composer-overlap-and-fast-typing.walk.mjs
// 产出：tests/ux/shots/composer-overlap-and-fast-typing/*.png + report.json（key 不进任何日志/截图/报告）。
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp, repoRoot, ACCEPTANCE_VIEWPORT } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { clickOrFail, expect, expectVisible, expectHittable, screenshotSettled, DEFAULT_TIMEOUT_MS } from './_assert.mjs'

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) throw new Error('需要 DEEPSEEK_API_KEY（外部改写走真实文本模型，不许 mock）：set -a; . ~/.nomi-secrets.env; set +a')

const VENDOR = 'deepseek-official'
const MODEL = 'deepseek-chat'
const REFERENCE_IMAGE = path.join(repoRoot, 'tests/ux/fixtures/hires-detail-1024x1792.png')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/composer-overlap-and-fast-typing')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

const COMPOSER = '.generation-canvas-v2-node__composer'
const COMPOSER_CARD = '.generation-canvas-v2-node__composer-card'
const EDITOR = `${COMPOSER} .generation-canvas-v2-node__prompt-input`
const FOOTER = `${COMPOSER} [data-node-composer-footer]`
const DOCKS = '[data-canvas-bottom-dock]'
// 与 composerCanvasPlacement.ts 的 NODE_COMPOSER_GAP / NODE_COMPOSER_WIDTH 同一组数（前者是画布单位，后者是屏幕像素）。
const COMPOSER_GAP = 14
const COMPOSER_WIDTH = 560
const MIN_VIEWPORT = Object.freeze({ width: 1100, height: 720 })
const MODEL_TIMEOUT = stationTimeout({ operations: 6 })

// ≥80 字符，中英混合，含空格与标点；不含 @（那是引用触发符，会弹候选框）。
const MIXED = 'A samurai walks slowly through a bamboo forest in heavy rain, 镜头从背后跟拍，雨滴打在刀鞘上；camera at waist height (35mm, f/2.8)! 慢动作。'
const PASTE = '【粘贴】一只橘猫坐在窗台上，窗外是黄昏的城市天际线，暖色逆光。An orange cat on a windowsill at dusk, warm rim light, city skyline outside; 35mm film grain, shallow depth of field.'
if ([...MIXED].length < 80) throw new Error(`测试串必须 ≥80 字符，现在 ${[...MIXED].length}`)

const report = { viewport: {}, overlap: [], typing: [], external: null, screenshots: [] }
const redact = (text) => String(text).split(API_KEY).join('[REDACTED]')

async function launchWithDeepSeek(locale) {
  const root = path.join(repoRoot, '.tmp', `composer-keys-${locale}`)
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
  // 凭据必须是 safeStorage 密文，只能由同一 Electron 身份加密：先起一次拿密文、关掉、写 catalog、再起。
  const first = await launchNomiApp({ name: `composer-keys-${locale}`, tempRoot: root, ...dirs, settleMs: 0, initialLocalStorage })
  const cipher = await first.app.evaluate(({ safeStorage }, key) => safeStorage.encryptString(key).toString('base64'), API_KEY)
  await first.app.close()
  const catalogFile = path.join(dirs.settingsDir, 'model-catalog.json')
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
  const now = new Date().toISOString()
  catalog.vendors.push({ key: VENDOR, name: 'DeepSeek Official', enabled: true, baseUrlHint: 'https://api.deepseek.com', providerKind: 'openai-compatible', authType: 'bearer', createdAt: now, updatedAt: now })
  catalog.models.push({ vendorKey: VENDOR, modelKey: MODEL, labelZh: MODEL, kind: 'text', enabled: true, published: true, createdAt: now, updatedAt: now })
  catalog.apiKeysByVendor = { ...(catalog.apiKeysByVendor || {}), [VENDOR]: { vendorKey: VENDOR, apiKey: cipher, enc: 'safeStorage', enabled: true, createdAt: now, updatedAt: now } }
  fs.writeFileSync(catalogFile, JSON.stringify(catalog), { mode: 0o600 })
  const launched = await launchNomiApp({ name: `composer-keys-${locale}`, tempRoot: root, ...dirs, settleMs: 0 })
  await expect.poll(() => launched.win.evaluate(() => window.nomiDesktop.promptLibrary.textBrain().then((r) => r?.brain ?? null)),
    { message: '文本大脑应解析到隔离 catalog 里的 DeepSeek', timeout: DEFAULT_TIMEOUT_MS }).toEqual({ vendor: VENDOR, modelKey: MODEL })
  return launched
}

async function openBlankGenerationCanvas(win, english) {
  await clickOrFail(win.getByText(english ? /New blank project/i : '新建空白项目', { exact: false }), english ? 'New blank project' : '新建空白项目')
  await clickOrFail(win.getByRole('button', { name: english ? 'Generate' : '生成', exact: true }), english ? 'Generate tab' : '生成 标签')
  await expectVisible(win.locator('.generation-canvas-v2-toolbar').first(), '生成画布左缘工具条就绪')
  const consent = win.getByRole('button', { name: english ? "Don't share" : '不分享', exact: true }).first()
  if (await consent.isVisible().catch(() => false)) await consent.click()
}

/** 内容区尺寸：原生窗口 + Chromium 视口一起设，量回来核一遍（同 _launchApp 的做法）。 */
async function setViewport(app, win, size) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window, next) => window.setContentSize(next.width, next.height), size)
  await win.setViewportSize(size)
  const actual = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(actual, '内容区尺寸就是要测的那一档').toEqual(size)
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

/** 回退探针：纯插入期间编辑器文字长度变短的次数（= 旧值回流把文档覆盖回去）。 */
async function armRegressionProbe(win) {
  await win.locator(EDITOR).evaluate((root) => {
    const pm = root.classList.contains('ProseMirror') ? root : root.querySelector('.ProseMirror') ?? root
    window.__composerKeysProbe?.observer.disconnect()
    const probe = { last: pm.textContent.length, regressions: 0, observer: null }
    probe.observer = new MutationObserver(() => {
      const length = pm.textContent.length
      if (length < probe.last) probe.regressions += 1
      probe.last = length
    })
    probe.observer.observe(pm, { childList: true, subtree: true, characterData: true })
    window.__composerKeysProbe = probe
  })
}
const readRegressions = (win) => win.evaluate(() => {
  const probe = window.__composerKeysProbe
  probe?.observer.disconnect()
  return probe?.regressions ?? -1
})

async function clearEditor(win) {
  await clickOrFail(win.locator(EDITOR), '提示词框')
  await win.keyboard.press('Meta+a')
  await win.keyboard.press('Backspace')
  await expect.poll(() => readPrompt(win), { message: '提示词框已清空' }).toBe('')
}

/** 逐键打字（delay=ms），比对逐字相同；把丢字的现场与回退次数记进报告。 */
async function typeAndCompare(win, label, text, delay) {
  await clearEditor(win)
  await armRegressionProbe(win)
  const started = Date.now()
  await win.keyboard.type(text, { delay })
  const elapsed = Date.now() - started
  let actual = ''
  const settled = await expect.poll(async () => { actual = await readPrompt(win); return actual }, {
    message: `${label}：逐键 ${delay}ms 输入后编辑器应与输入逐字相同`, timeout: 4000,
  }).toBe(text).then(() => true, () => false)
  const regressions = await readRegressions(win)
  report.typing.push({ label, delayMs: delay, chars: [...text].length, elapsedMs: elapsed, identical: settled, regressions, actual: settled ? undefined : actual })
  console.log(`  ${settled ? '✓' : '✗'} ${label}（${delay}ms/键，${[...text].length} 字，${elapsed}ms，回退 ${regressions} 次）${settled ? '' : `\n      实得：${actual}`}`)
  expect(actual, `${label}：逐字相同`).toBe(text)
  expect(regressions, `${label}：纯插入期间编辑器文字从未倒退`).toBe(0)
}

async function pasteAndCompare(app, win, label, text) {
  await clearEditor(win)
  await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text)
  await win.keyboard.press('Meta+v')
  let actual = ''
  await expect.poll(async () => { actual = await readPrompt(win); return actual }, { message: `${label}：粘贴后逐字相同` }).toBe(text)
  report.typing.push({ label, mode: 'paste', chars: [...text].length, identical: actual === text })
  console.log(`  ✓ ${label}（粘贴 ${[...text].length} 字）`)
}

/**
 * 一次量清「节点 / 浮框卡 / 舞台 / 画布缩放 / 底栏控件 / 停靠区」的真实几何。只读。
 * 停靠区按 DOM 自己声明的 `data-canvas-bottom-dock` 取，不抄 class——2026-09-25 起它**不再**是浮框的输入，
 * 这里只把「卡压进了几块停靠区」记进报告当「被挡就挡」的现场证据，不断言。
 */
function measureComposer(win) {
  return win.evaluate(({ footerSelector, dockSelector, cardSelector, composerSelector }) => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: r.width } }
    const footer = document.querySelector(footerSelector)
    const card = footer?.closest(cardSelector)
    // 浮框锚点是节点 article 的直接子元素（BaseGenerationNode），和 node-composer-placement.walk.mjs 同一口径。
    const node = card?.closest(composerSelector)?.parentElement
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const viewportEl = document.querySelector('.react-flow__viewport')
    // 画布缩放读 React Flow 视口自己的 transform（DOMMatrix.a）——量的是用户眼前那一帧，不读 store。
    const zoom = viewportEl ? new DOMMatrixReadOnly(getComputedStyle(viewportEl).transform).a : 1
    const controls = footer ? [...footer.querySelectorAll('button, [role="button"], [role="combobox"]')].filter((el) => el.getBoundingClientRect().width > 0) : []
    const docks = [...document.querySelectorAll(dockSelector)].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    const describe = (el) => el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 24) || el.tagName
    const dockOverlaps = []
    if (card) {
      const c = card.getBoundingClientRect()
      for (const dock of docks) {
        const b = dock.getBoundingClientRect()
        const overlapX = Math.min(c.right, b.right) - Math.max(c.left, b.left)
        const overlapY = Math.min(c.bottom, b.bottom) - Math.max(c.top, b.top)
        if (overlapX > 0 && overlapY > 0) dockOverlaps.push({ dock: describe(dock), overlap: [Math.round(overlapX), Math.round(overlapY)] })
      }
    }
    // 追加 B：底栏芯片的文字不许被裁断。允许的只有「有意的省略号 + title 能看全名」，且省略后仍留得下字。
    const clipped = []
    for (const control of controls) {
      const name = describe(control)
      if (control.scrollWidth > control.clientWidth + 1) clipped.push({ control: name, why: `内容溢出按钮 ${control.scrollWidth}>${control.clientWidth}` })
      for (const span of control.querySelectorAll('span')) {
        const text = span.textContent?.trim() ?? ''
        if (!text || span.children.length) continue
        if (span.scrollWidth <= span.clientWidth + 1) continue
        const ellipsis = getComputedStyle(span).textOverflow === 'ellipsis'
        const titled = Boolean(control.getAttribute('title')) && control.getAttribute('title').includes(text.replace(/…$/, ''))
        if (!ellipsis || !titled) clipped.push({ control: name, text, why: ellipsis ? '省略号但 title 看不到全名' : '无省略号的硬裁断' })
        else if (span.clientWidth < 24) clipped.push({ control: name, text, why: `省略后只剩 ${span.clientWidth}px，读不出字` })
      }
    }
    // 追加 C：「生成方式」模式栏属于最小高度——整块在卡片内、在参考区滚动口的可见范围内、不与提示词区相交。
    // 按用户看得到的结构找（参考区里那组「生成方式」分段），不依赖实现侧标记——修前修后同一把尺。
    const modeBar = card?.querySelector('[data-node-composer-mode-bar] [role="group"][aria-label], [data-node-composer-references] [role="group"][aria-label]')?.parentElement
    let modeBarIssues = null
    if (modeBar) {
      const m = modeBar.getBoundingClientRect()
      const c = card.getBoundingClientRect()
      const scrollport = modeBar.closest('[data-node-composer-references]')?.getBoundingClientRect()
      const prompt = card.querySelector('[data-node-composer-prompt]')?.getBoundingClientRect()
      modeBarIssues = []
      if (m.top < c.top - 0.5 || m.bottom > c.bottom + 0.5) modeBarIssues.push(`模式栏超出卡片 ${Math.round(m.top)}–${Math.round(m.bottom)} vs 卡 ${Math.round(c.top)}–${Math.round(c.bottom)}`)
      if (scrollport && (m.top < scrollport.top - 0.5 || m.bottom > scrollport.bottom + 0.5)) modeBarIssues.push(`模式栏被参考区滚动口裁掉 ${Math.round(m.top)}–${Math.round(m.bottom)} vs 口 ${Math.round(scrollport.top)}–${Math.round(scrollport.bottom)}`)
      if (prompt && m.bottom > prompt.top + 0.5 && m.top < prompt.bottom) modeBarIssues.push(`模式栏与提示词区相交 ${Math.round(m.bottom)} > ${Math.round(prompt.top)}`)
    }
    // 钉住判据用未取整的原始值算，报告里的盒子才取整。
    const cardRaw = card?.getBoundingClientRect()
    const nodeRaw = node?.getBoundingClientRect()
    return {
      zoom,
      pin: cardRaw && nodeRaw ? {
        cardTop: cardRaw.top,
        expectedTop: nodeRaw.bottom + 14 * zoom,
        centreDelta: (cardRaw.left + cardRaw.right) / 2 - (nodeRaw.left + nodeRaw.right) / 2,
        width: cardRaw.width,
      } : null,
      modeBarIssues,
      clipped,
      card: card ? rect(card) : null,
      node: node ? rect(node) : null,
      stage: stage ? rect(stage) : null,
      footer: footer ? rect(footer) : null,
      controls: controls.map((el) => ({ name: describe(el), ...rect(el) })),
      docks: docks.map((el) => ({ name: describe(el), ...rect(el) })),
      dockOverlaps,
      viewport: { width: innerWidth, height: innerHeight },
    }
  }, { footerSelector: FOOTER, dockSelector: DOCKS, cardSelector: COMPOSER_CARD, composerSelector: COMPOSER })
}

/** 钉住判据（与 composerCanvasPlacement 同一个不变量，在真机屏幕坐标里验）；返回问题清单，空 = 钉住。 */
function pinProblems(geometry) {
  const pin = geometry?.pin
  if (!pin) return ['量不到浮框卡片或它的节点']
  const problems = []
  if (Math.abs(pin.cardTop - pin.expectedTop) > 2) problems.push(`顶边 ${pin.cardTop.toFixed(1)} ≠ 节点底边 + ${COMPOSER_GAP}×缩放 = ${pin.expectedTop.toFixed(1)}（zoom=${geometry.zoom.toFixed(2)}）`)
  if (Math.abs(pin.centreDelta) > 2) problems.push(`中线偏离节点中线 ${pin.centreDelta.toFixed(1)}px`)
  if (Math.abs(pin.width - COMPOSER_WIDTH) > 1) problems.push(`宽 ${pin.width.toFixed(1)} ≠ ${COMPOSER_WIDTH}`)
  return problems
}

/**
 * 浮框钉在节点正下方（2026-09-25 用户拍板「钉在节点正下方、宽度固定、被挡就挡」）：
 * 顶边 = 节点底边 + 14×缩放、中线 = 节点中线、屏幕宽恒 560。不看视口、不看停靠区——那些不再是输入，
 * 所以卡压进缩放条 / 时间轴胶囊、伸出舞台都**不算**失败。
 * `onScreen`：这一格浮框本该整块在舞台内（默认位置 / 新建节点），此时顺带断「生成方式」tab 点得中；
 * 拖到左下停靠区那片时卡的左半截会伸出舞台、钻到左栏底下，那是预期，不断命中。
 * `pushedOffStage`：这一格是「以前会翻上去」的现场——先证卡确实伸出了舞台底边（基线，不然这格是摆设），再断它仍钉在下方。
 */
async function assertComposerPinned(win, label, { onScreen = false, pushedOffStage = false } = {}) {
  await expect.poll(async () => pinProblems(await measureComposer(win)), {
    message: `${label}：浮框钉在节点正下方（顶边 = 节点底边 + ${COMPOSER_GAP}×缩放、中线对齐、宽 ${COMPOSER_WIDTH}）`,
  }).toEqual([])
  const geometry = await measureComposer(win)
  report.overlap.push({ label, ...geometry })
  console.log(`  · ${label}：浮框钉在节点下方，card=${JSON.stringify(geometry.card)}，node=${JSON.stringify(geometry.node)}，zoom=${geometry.zoom.toFixed(2)}，压进停靠区 ${geometry.dockOverlaps.length} 块（被挡就挡，不断言），底栏控件 ${geometry.controls.length} 颗，模式栏 ${geometry.modeBarIssues === null ? '无' : geometry.modeBarIssues.length ? '被裁' : '完整'}，芯片裁断 ${geometry.clipped.length} 处`)
  expect(geometry.footer, `${label}：底栏在`).not.toBeNull()
  expect(geometry.controls.length, `${label}：底栏里有控件`).toBeGreaterThan(0)
  expect(geometry.clipped, `${label}：底栏芯片文字没有被裁断`).toEqual([])
  if (pushedOffStage) {
    expect(geometry.card.bottom, `${label}：现场确实把浮框压出了舞台底边（以前这里会翻到上方）`).toBeGreaterThan(geometry.stage.bottom)
  }
  if (geometry.modeBarIssues) {
    expect(geometry.modeBarIssues, `${label}：「生成方式」模式栏完整在卡内`).toEqual([])
    if (onScreen) {
      const tabs = win.locator(`${COMPOSER} [data-node-composer-mode-bar] [role="group"][aria-label] button, ${COMPOSER} [data-node-composer-references] [role="group"][aria-label] button`)
      for (let index = 0; index < await tabs.count(); index += 1) await expectHittable(tabs.nth(index), `${label}：模式 tab #${index + 1}`)
    }
  }
}

/**
 * 把节点拖到画布左下（与缩放条、时间轴胶囊同一片区域）：节点水平中心压在缩放条右端附近，
 * 节点底边落在「浮框下沿贴近舞台底边」的高度——正是 09-21 截图里底栏被停靠区盖住的那个现场。
 * 2026-09-25 起浮框不再躲它，这一格用来证「照旧钉在节点下方，被挡就挡」。
 * 真人手势：在节点卡片上按下、分步挪、松开（不灌 store）。
 */
async function dragNodeToBottomLeft(win, nodeSelector, label, { bottomInset } = {}) {
  const plan = await win.evaluate(({ nodeSelector: selector, composerSelector, bottomInset: inset }) => {
    const node = document.querySelector(selector)
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const zoomBar = [...document.querySelectorAll('[data-canvas-bottom-dock]')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .sort((a, b) => a.left - b.left)[0]
    const composer = document.querySelector(composerSelector)
    if (!node || !stage || !zoomBar) return null
    const n = node.getBoundingClientRect(); const s = stage.getBoundingClientRect()
    const composerHeight = composer ? composer.getBoundingClientRect().height : 260
    const gap = 24
    return {
      from: { x: n.left + n.width / 2, y: n.top + n.height * 0.35 },
      targetCenterX: zoomBar.right - 20,
      // bottomInset：把节点直接压到舞台底边附近，下方放不下整张浮框——以前这里会翻到上方，
      // 现在断它仍钉在节点下方、伸出舞台的那截被裁。
      targetBottom: inset === undefined ? s.bottom - 12 - gap - composerHeight : s.bottom - inset,
      nodeBottom: n.bottom, nodeCenterX: n.left + n.width / 2,
    }
  }, { nodeSelector, composerSelector: COMPOSER_CARD, bottomInset })
  expect(plan, `${label}：量得到节点、舞台与缩放条`).not.toBeNull()
  const dx = plan.targetCenterX - plan.nodeCenterX
  const dy = plan.targetBottom - plan.nodeBottom
  await win.mouse.move(plan.from.x, plan.from.y)
  await win.mouse.down()
  await win.mouse.move(plan.from.x + dx / 2, plan.from.y + dy / 2, { steps: 8 })
  await win.mouse.move(plan.from.x + dx, plan.from.y + dy, { steps: 8 })
  await win.mouse.up()
}

async function ensureComposerOpen(win, nodeSelector, label) {
  const composer = win.locator(COMPOSER).first()
  if (!(await composer.isVisible().catch(() => false))) await clickOrFail(win.locator(nodeSelector), `${label}：点节点重新选中`)
  await expectVisible(composer, `${label}：生成浮框在`)
}

async function shot(target, name) {
  const file = path.join(shotsDir, `${name}.png`)
  await screenshotSettled(target, { path: file })
  report.screenshots.push(file)
}

async function uploadReference(win, english) {
  const composer = win.locator(COMPOSER).first()
  await clickOrFail(composer.locator(`button[aria-label="${english ? 'Add reference' : '加参考'}"]`), english ? 'Add reference' : '加参考')
  await win.locator(`input[type="file"][aria-label="${english ? 'Upload local file' : '上传本地文件'}"]`).first().setInputFiles(REFERENCE_IMAGE)
  await expectVisible(composer.getByLabel(/^(输入图|Input image)\s*1$/i).first(), '上传后参考槽出现真实图片 tile')
  await win.mouse.move(8, 8) // 移开指针：tile 悬停会弹大图预览，别让它盖住后面的几何与截图
}

async function optimizeAndApply(win, english) {
  const before = await readPrompt(win)
  await clickOrFail(win.locator(`${COMPOSER} [data-prompt-tool="optimize"]`), '优化钮')
  await clickOrFail(win.getByRole('button', { name: english ? 'Optimize Prompt' : '优化提示', exact: true }), '优化提示')
  const apply = win.getByRole('button', { name: english ? 'Apply Prompt' : '应用提示', exact: true })
  const started = Date.now()
  await expect(apply, '真模型给出优化结果').toBeVisible({ timeout: MODEL_TIMEOUT })
  await apply.click()
  let after = before
  await expect.poll(async () => { after = await readPrompt(win); return after !== before && after.trim().length > 0 },
    { message: '外部改写（应用提示）写进了编辑器' }).toBe(true)
  return { before, after, ms: Date.now() - started }
}

let current
try {
  // ─────────────── 中文界面 ───────────────
  current = await launchWithDeepSeek('zh-CN')
  let win = current.win
  await openBlankGenerationCanvas(win, false)
  report.viewport.default = ACCEPTANCE_VIEWPORT

  // 图片节点 + 改图模式 + 真实参考图：浮框长到截图里那么高。
  await addCanvasNodeFromRail(win, 'image')
  const imageNode = '[data-node-id]'
  await expectVisible(win.locator(COMPOSER).first(), '新建图片节点后浮出生成浮框')
  await clickOrFail(win.locator(COMPOSER).first().getByRole('button', { name: '改图', exact: true }), '改图 模式')
  await uploadReference(win, false)
  await shot(win, '00-zh-default-position')
  await assertComposerPinned(win, '中文·默认位置', { onScreen: true })

  await dragNodeToBottomLeft(win, imageNode, '中文·图片节点')
  await ensureComposerOpen(win, imageNode, '中文·拖到左下后')
  await assertComposerPinned(win, '中文·左下角（默认窗口）')
  await shot(win, '01-zh-bottom-left-default-window')

  // 压到底边：节点压到舞台底边附近，下方放不下整张浮框——以前这里会翻上去，2026-09-25 起不翻，
  // 仍钉在节点正下方，伸出舞台的那截被裁（用户拍板「遮挡就遮挡了，保持位置」）。
  await dragNodeToBottomLeft(win, imageNode, '中文·压到底边', { bottomInset: 90 })
  await ensureComposerOpen(win, imageNode, '中文·压到底边')
  await assertComposerPinned(win, '中文·压到底边（默认窗口）', { pushedOffStage: true })
  await shot(win, '01b-zh-pinned-below-at-stage-bottom')

  await setViewport(current.app, win, MIN_VIEWPORT)
  report.viewport.min = MIN_VIEWPORT
  await dragNodeToBottomLeft(win, imageNode, '中文·最小窗口')
  await ensureComposerOpen(win, imageNode, '中文·最小窗口')
  await assertComposerPinned(win, '中文·左下角（最小窗口）')
  await shot(win, '02-zh-bottom-left-min-window')
  await setViewport(current.app, win, ACCEPTANCE_VIEWPORT)

  // 丢字：图片节点。
  await typeAndCompare(win, '图片节点·0ms', MIXED, 0)
  await typeAndCompare(win, '图片节点·5ms', MIXED, 5)
  await pasteAndCompare(current.app, win, '图片节点·粘贴', PASTE)
  await shot(win, '03-zh-image-typed')

  // 外部改写：优化 → 应用，编辑器必须显示改写结果；之后继续快打不丢字。
  await clearEditor(win)
  await win.keyboard.type('一只橘猫坐在窗台上', { delay: 0 })
  const rewrite = await optimizeAndApply(win, false)
  report.external = { source: 'optimizer apply (updateNode)', before: rewrite.before, after: rewrite.after, ms: rewrite.ms }
  console.log(`  ✓ 外部改写生效（${rewrite.ms}ms）\n      前：${rewrite.before}\n      后：${rewrite.after}`)
  await clickOrFail(win.locator(EDITOR), '点回提示词框')
  await win.keyboard.press('Meta+ArrowDown')
  await win.keyboard.press('End')
  const suffix = ' — then the camera cranes up, 雨停了。'
  await win.keyboard.type(suffix, { delay: 0 })
  await expect.poll(() => readPrompt(win), { message: '外部改写后继续 0ms 快打，结果 = 改写结果 + 追加串' }).toBe(rewrite.after + suffix)
  report.external.appendedIdentical = true
  await shot(win, '04-zh-after-external-rewrite')

  // 丢字：视频节点。
  await win.keyboard.press('Escape')
  await addCanvasNodeFromRail(win, 'video')
  await expectVisible(win.locator(COMPOSER).first(), '新建视频节点后浮出生成浮框')
  await typeAndCompare(win, '视频节点·0ms', MIXED, 0)
  await typeAndCompare(win, '视频节点·5ms', MIXED, 5)
  await pasteAndCompare(current.app, win, '视频节点·粘贴', PASTE)
  await assertComposerPinned(win, '中文·视频节点', { onScreen: true })
  await shot(win, '05-zh-video-typed')
  await current.app.close()
  current = null

  // ─────────────── 英文界面 ───────────────
  current = await launchWithDeepSeek('en')
  win = current.win
  await openBlankGenerationCanvas(win, true)
  await addCanvasNodeFromRail(win, 'image')
  await expectVisible(win.locator(COMPOSER).first(), 'EN：新建图片节点后浮出生成浮框')
  await clickOrFail(win.locator(COMPOSER).first().getByRole('button', { name: /edit/i }).first(), 'EN：改图模式')
  await uploadReference(win, true)
  await dragNodeToBottomLeft(win, imageNode, 'EN·图片节点')
  await ensureComposerOpen(win, imageNode, 'EN·拖到左下后')
  await assertComposerPinned(win, 'EN·左下角（默认窗口）')
  await typeAndCompare(win, 'EN·图片节点·0ms', MIXED, 0)
  await shot(win, '06-en-bottom-left-typed')
  await dragNodeToBottomLeft(win, imageNode, 'EN·压到底边', { bottomInset: 90 })
  await ensureComposerOpen(win, imageNode, 'EN·压到底边')
  await assertComposerPinned(win, 'EN·压到底边（默认窗口）', { pushedOffStage: true })
  await shot(win, '06b-en-pinned-below-at-stage-bottom')
  await setViewport(current.app, win, MIN_VIEWPORT)
  await dragNodeToBottomLeft(win, imageNode, 'EN·最小窗口')
  await ensureComposerOpen(win, imageNode, 'EN·最小窗口')
  await assertComposerPinned(win, 'EN·左下角（最小窗口）')
  await shot(win, '07-en-bottom-left-min-window')
  await current.app.close()
  current = null

  report.result = 'pass'
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
