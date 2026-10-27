// R13 走查：画布生成浮框（B3 生成框）钉在节点正下方（被挡就挡）+ 提示词编辑器快速输入不丢字。
//
// 两个用户可见症状（2026-09-21）：
//   ① 图片节点浮框底栏（模型 / 参数芯片、生成钮）被画布左下的缩放条与底部胶囊压住；
//   ② 以 0ms 间隔逐键输入「A samurai walks…」变成「Ai waks…」（文字扩展工具、输入法上屏、极快打字）。
// ① 的修法（躲停靠区 / 翻到上方 / clamp 进视口）已于 2026-09-25 被用户收回：「钉在节点正下方、宽度固定、
// 被挡就挡」（原话「有时候位置不在下面而是在节点中间」「遮挡就遮挡了，保持位置」）。位置 owner 现在是
// src/workbench/generationCanvas/nodes/composerCanvasPlacement.ts（只看节点尺寸 + 画布缩放）。所以这里
// 不断「底栏不与停靠区相交」「翻到上方」，断反面：把节点拖进停靠区那片、压到舞台底边，浮框**照旧**钉在下方。
//
// 2026-10-27 按 B3 生成框重写（设计卡 docs/plan/2026-10-27-composer-walk-b3.md，含逐条断言的保留 / 改 / 退役对账表）：
//   · 模型从界面上选：底栏模型芯片 → 菜单里点一个能选、又收参考图的模型。不在数据层钉模型——钉出来的是界面上选不到的假现场；
//   · 参考图：画布底部「导入」经系统文件选择器导入真实 4K 图，再用生成框参考行的「画布点选」把那张卡接进来
//     （B3 去掉了「改图」方式钮，原来那一颗「加参考」拆成「画布点选」和「+」两颗，方式跟着输入走）；
//   · 生成供应商、「优化」用的文本模型都是本机回环夹具（tests/ux/agent-runtime-fixture.mjs）：零 key、零花费、出网闸只放行本机；
//   · 「生成方式模式栏完整、tab 点得中」那条退役：B3 图片节点没有这一组，视频的在参数面板顶部（对账表写了依据）。
//
// 四件真实：打包同构的 dev Electron（隔离 profile）/ 真实页面输入（界面选模型、系统文件选择器导入、画布点选、鼠标拖节点、
// 键盘逐键输入、Cmd+V 粘贴、点「优化」再点「应用」）/ 真实管线（内置生成供应商档案、模型目录、prompt_refine 文本任务都走产品那条，
// 只把远端换成本机回环夹具——改写仍然是从编辑器之外写进来的）/ 真实素材（登记表里的真实 4K PNG，3840×2160）。
//
// 断言钉的是用户看得见的结果：
//   · 模型是从界面上选的：选之前芯片上不是它；菜单里列着它；点完芯片显示它、再开菜单勾在它那行；参考入口可点；
//   · 参考图真用上了：接进来后参考行里是一张在用的小图（不是淡显的「未用到」）；
//   · 浮框卡片顶边 = 节点底边 + 14×缩放、中线 = 节点中线、屏幕宽恒 560——默认位置、拖到左下停靠区那片、
//     压到舞台底边（以前会翻上去的现场）、缩到最小窗口（1100×720 内容区）各测一次；伸出舞台 / 钻到停靠区底下是预期；
//   · 底栏芯片文字不被裁断——只允许「有意省略号 + title 全名 + 省略后仍 ≥24px」（1100×720 EN 是现场）；
//   · 0ms / 5ms 逐键键入 ≥80 字符中英混合串（含空格与标点）后，编辑器与输入逐字相同、文字从未倒退（图片 + 视频节点）；
//   · 一次性粘贴长文本逐字相同；
//   · 外部改写（优化 → 应用）把夹具回的那句逐字写进编辑器，之后继续快打不丢字；夹具恰好收到一次带原句的请求；
//   · 全程不点生成：夹具一笔出图请求都没收到。
//
// 用法：先 pnpm run build；真实素材目录走 env（素材不进仓库）：
//   NOMI_REAL_MEDIA_DIR=<本机素材目录> node tests/ux/composer-overlap-and-fast-typing.walk.mjs
// 产出：.tmp/pi-composer-overlap-and-fast-typing-development-<时间>/ 下的截图与 report.json。
import fs from 'node:fs'
import path from 'node:path'
import { stationTimeout } from './_station-budget.mjs'
import { clickOrFail, expect, expectAbsent, expectHittable, expectVisible, proveProbe } from './_assert.mjs'
import { waitForCanvasViewportSettled } from './_canvasHit.mjs'
import { addCanvasNode, canvasAddBar, canvasFitView, newProjectEntry, setAppLanguage, switchWorkspace } from './_shell.mjs'
import { FIXTURE_APIMART_MODEL_LABEL, flattenRequestText } from './agent-runtime-fixture.mjs'
import { createRuntimeWalk, escapeForRegExp, recorded } from './agent-runtime-walk-support.mjs'
import { requireRealMediaAssets } from './fixtures/realMedia.mjs'
import { uiText } from './full-walk/invariants.mjs'

// ── 真实素材：登记表里的真实 4K PNG 直接当参考图（缺素材当场红，不退回合成图；不在走查里现场抽帧）──
const REFERENCE_IMAGE = requireRealMediaAssets(['image-4k-png']).assets.get('image-4k-png').file

const COMPOSER = '.generation-canvas-v2-node__composer'
const COMPOSER_CARD = '.generation-canvas-v2-node__composer-card'
const EDITOR = '.generation-canvas-v2-node__prompt-input'
const FOOTER = '[data-node-composer-footer]'
const DOCKS = '[data-canvas-bottom-dock]'
// 参考行里**在用**的小图（数组槽那一排 / 单帧槽）；淡显「未用到」的在 [data-reference-unused] 里，不算。
const IN_USE_TILE = '[data-reference-row] [data-asset-slot-group="array"] [data-asset-tile], [data-reference-row] [data-asset-slot] [data-asset-tile]'
// 与 composerCanvasPlacement.ts 的 NODE_COMPOSER_GAP / NODE_COMPOSER_WIDTH 同一组数（前者是画布单位，后者是屏幕像素）。
const COMPOSER_GAP = 14
const COMPOSER_WIDTH = 560
// 最小窗口 = electron/main.ts 的 minWidth / minHeight。
const MIN_VIEWPORT = Object.freeze({ width: 1100, height: 720 })
// 界面上选的那个图片模型：内置 APIMart 档案里的 GPT Image 2（文生图 + 参考图生图，参考槽收图），出图地址由出网闸指到本机夹具。
const PICKED_MODEL = FIXTURE_APIMART_MODEL_LABEL
const IMPORT_TIMEOUT = stationTimeout({ operations: 4 })
const MODEL_TIMEOUT = stationTimeout({ operations: 6 })

// ≥80 字符，中英混合，含空格与标点；不含 @（那是引用触发符，会弹候选框）。
const MIXED = 'A samurai walks slowly through a bamboo forest in heavy rain, 镜头从背后跟拍，雨滴打在刀鞘上；camera at waist height (35mm, f/2.8)! 慢动作。'
const PASTE = '【粘贴】一只橘猫坐在窗台上，窗外是黄昏的城市天际线，暖色逆光。An orange cat on a windowsill at dusk, warm rim light, city skyline outside; 35mm film grain, shallow depth of field.'
if ([...MIXED].length < 80) throw new Error(`测试串必须 ≥80 字符，现在 ${[...MIXED].length}`)
// 外部改写：编辑器里先打这一句，夹具（文本模型那头）回下面那一句；断言编辑器逐字等于它，再接着快打追加串。
const REWRITE_SOURCE = '一只橘猫坐在窗台上'
const REWRITE_RESULT = '黄昏时分，一只橘猫安静地坐在老木窗台上，暖色逆光勾出毛边，窗外是虚化的城市天际线。'
const REWRITE_SUFFIX = ' — then the camera cranes up, 雨停了。'

const walk = await createRuntimeWalk('composer-overlap-and-fast-typing', { generationProvider: 'apimart' })
const report = Object.assign(walk.report, { viewport: {}, modelPick: [], references: [], overlap: [], typing: [], external: null })

const nodeOf = (nodeId) => `[data-node-id="${nodeId}"]`
const composerOf = (nodeId) => `${nodeOf(nodeId)} ${COMPOSER}`
const nodeIds = (win) => win.locator('[data-node-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-node-id')))

async function openBlankGenerationCanvas(win) {
  await clickOrFail(newProjectEntry(win), '项目库的新建入口')
  await switchWorkspace(win, 'generation', '切到生成工作区')
  await expectVisible(canvasAddBar(win), '生成画布底部加节点条就绪')
}

/**
 * 画布底部「导入」→ 系统文件选择器 → 选真实 4K 图：真导入（复制进项目、建素材卡），等卡上出现这张图。返回素材卡的 id。
 * 点加节点条只走 `_shell.mjs` 的 `addCanvasNode` 一个口（它负责先把被生成框盖住的加节点条露出来）。
 */
async function importReferenceToCanvas(win, label) {
  const before = await nodeIds(win)
  const chooser = win.waitForEvent('filechooser')
  await addCanvasNode(win, 'import-file')
  await (await recorded(chooser, `${label}：画布底部「导入」打开系统文件选择器`, IMPORT_TIMEOUT)).setFiles(REFERENCE_IMAGE)
  const card = win.locator('[data-node-id][data-kind="asset"]')
  await expect(card, `${label}：画布上多了一张素材卡`).toHaveCount(1)
  const id = await card.getAttribute('data-node-id')
  expect(before, `${label}：素材卡是这次导入新建的`).not.toContain(id)
  await expect(card.locator('img[src^="nomi-local://"]'), `${label}：真实 4K 图导入完成，素材卡上是这张图`).toBeVisible({ timeout: IMPORT_TIMEOUT })
  return id
}

/** 从加节点条新建一个节点，返回它的 id（浮框认节点，不认「第一个」——画布上还有导入进来的素材卡）。 */
async function addNode(win, kind) {
  const before = await nodeIds(win)
  await addCanvasNode(win, kind)
  const node = win.locator(`[data-node-id][data-kind="${kind}"][data-selected="true"]`)
  await expectVisible(node, `新建的${kind}节点（选中态）`)
  const id = await node.getAttribute('data-node-id')
  expect(before, `新建的${kind}节点是新的一张卡`).not.toContain(id)
  await expectVisible(win.locator(composerOf(id)), `新建${kind}节点后浮出生成浮框`)
  return id
}

/**
 * 「模型是从界面上选的」：在 B3 底栏的模型芯片里选 PICKED_MODEL（真人路径：点芯片 → 菜单 → 点那一行）。
 * ①选之前芯片上不是它（不然「选」这一步证明不了什么）；②菜单里列着它（菜单只列此刻能用的模型）；
 * ③点完芯片显示它；④再开菜单，勾在它那一行（板 ComposerB3 modelmenu.row「当前行带勾」）；⑤参考入口可点（它收参考图）。
 */
async function pickModelInComposer(win, nodeId, locale, label) {
  const composer = win.locator(composerOf(nodeId))
  const chip = composer.locator('[data-bar-segment="model-params"]').getByRole('button', { name: uiText(locale, 'generationCommon.parameters.model'), exact: true })
  await expectVisible(chip, `${label}：底栏模型芯片`)
  const before = (await chip.innerText()).trim()
  expect(before, `${label}：选之前芯片上不是 ${PICKED_MODEL}（不然这一步证明不了模型是从界面上选的）`).not.toBe(PICKED_MODEL)
  const menu = win.locator('[data-nomi-select-dropdown]:visible')
  const row = menu.getByRole('option').filter({ has: win.locator('[data-nomi-select-option-label]', { hasText: new RegExp(`^${escapeForRegExp(PICKED_MODEL)}$`) }) })
  await clickOrFail(chip, `${label}：点模型芯片`)
  await expectVisible(menu, `${label}：模型菜单开了`)
  await expect(row, `${label}：模型菜单里列着 ${PICKED_MODEL}（菜单只列此刻能用的模型）`).toHaveCount(1)
  await clickOrFail(row, `${label}：在菜单里点 ${PICKED_MODEL}`)
  await expect(chip, `${label}：芯片显示选中的模型`).toHaveText(PICKED_MODEL)
  await clickOrFail(chip, `${label}：再开模型菜单核对勾选`)
  await expectVisible(row.locator('.tabler-icon-check'), `${label}：菜单里勾在 ${PICKED_MODEL} 那一行`)
  await walk.snap(`${locale === 'en' ? 'en' : 'zh'}-model-menu-checked`)
  await clickOrFail(chip, `${label}：再点芯片收起菜单`)
  await expect(menu, `${label}：模型菜单收起`).toBeHidden()
  await expect(composer.locator('[data-reference-entry]'), `${label}：参考行「画布点选」可点（选中的模型收参考图）`).toBeEnabled()
  await expect(composer.locator('[data-reference-add-entry], [data-asset-add-tile]').first(), `${label}：参考行「+」可点`).toBeEnabled()
  report.modelPick.push({ label, before, picked: PICKED_MODEL })
}

/**
 * 加参考（B3）：生成框参考行的「画布点选」→ 画布进点选态 → 点导入好的素材卡 → 接进来，参考行出现在用的小图。
 * 为什么不走「+」→「上传本地文件」：在还停在文生图的新建图片节点上，那条导入出来的素材卡会被选中、生成框跟着收起，
 * 结果只建了卡、没接上（2026-10-27 走查实测，产品问题另报）。这条走查守的是浮框位置与输入，不是上传；
 * 画布点选同样是生成框里真有的入口（板 ComposerB3 ref.tool.canvas-pick）。
 */
async function attachReferenceByCanvasPick(win, nodeId, assetId, label) {
  const composer = win.locator(composerOf(nodeId))
  const pickBar = win.locator('[data-canvas-pick-bar]')
  await clickOrFail(composer.locator('[data-reference-entry]'), `${label}：参考行「画布点选」`)
  await expectVisible(pickBar, `${label}：画布进了点选态`)
  await clickOrFail(win.locator(nodeOf(assetId)), `${label}：点导入好的素材卡`)
  const inUse = composer.locator(IN_USE_TILE)
  await expect(inUse, `${label}：真实 4K 图接进来了，是参考行里在用的小图`).toHaveCount(1, { timeout: IMPORT_TIMEOUT })
  await expect(pickBar, `${label}：点中即退出点选态`).toBeHidden()
  const proof = await proveProbe(inUse, `${label}：参考行渲染出在用的小图`)
  await expectAbsent(composer.locator('[data-reference-unused]'), { provenBy: proof, message: `${label}：接进来的图没被淡显成「未用到」（选中的模型用得上它）` })
  await win.mouse.move(8, 8) // 移开指针：小图悬停会弹大图预览，别让它盖住后面的几何与截图
  report.references.push({ label, file: path.basename(REFERENCE_IMAGE), bytes: fs.statSync(REFERENCE_IMAGE).size })
}

/** 编辑器内容的可读投影：文字原样，chip 记成 ⟪chip⟫，段落用 \n。只读。 */
function readPrompt(win, nodeId) {
  return win.locator(`${composerOf(nodeId)} ${EDITOR}`).evaluate((root) => {
    const pm = root.classList.contains('ProseMirror') ? root : root.querySelector('.ProseMirror') ?? root
    return [...pm.children].map((paragraph) => {
      let out = ''
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) { out += node.textContent; return }
        if (node.nodeType !== Node.ELEMENT_NODE) return
        if (node.matches('[data-asset-mention]')) { out += '⟪chip⟫'; return }
        if (node.matches('.ProseMirror-trailingBreak, br')) return
        node.childNodes.forEach(visit)
      }
      paragraph.childNodes.forEach(visit)
      return out
    }).join('\n')
  })
}

/** 回退探针：纯插入期间编辑器文字长度变短的次数（= 旧值回流把文档覆盖回去）。 */
async function armRegressionProbe(win, nodeId) {
  await win.locator(`${composerOf(nodeId)} ${EDITOR}`).evaluate((root) => {
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

/**
 * 点进提示词框之前先证它真人点得到：中心点在视口里、最顶层就是它（没伸出舞台、没被左栏 / 时间轴盖住）。
 * 只靠 click 不够——框在舞台外时 Playwright 会先把容器滚一下再点，照样「点得动」。
 */
async function focusEditor(win, nodeId, label) {
  const editor = win.locator(`${composerOf(nodeId)} ${EDITOR}`)
  await expectHittable(editor, `${label}（真人点得到：在舞台里、没被盖住）`)
  await clickOrFail(editor, label)
}

async function clearEditor(win, nodeId) {
  await focusEditor(win, nodeId, '提示词框')
  await win.keyboard.press('Meta+a')
  await win.keyboard.press('Backspace')
  await expect.poll(() => readPrompt(win, nodeId), { message: '提示词框已清空' }).toBe('')
}

/** 逐键打字（delay=ms），比对逐字相同；把丢字的现场与回退次数记进报告。 */
async function typeAndCompare(win, nodeId, label, text, delay) {
  await clearEditor(win, nodeId)
  await armRegressionProbe(win, nodeId)
  await win.keyboard.type(text, { delay })
  let actual = ''
  const settled = await expect.poll(async () => { actual = await readPrompt(win, nodeId); return actual }, {
    message: `${label}：逐键 ${delay}ms 输入后编辑器应与输入逐字相同`, timeout: 4000,
  }).toBe(text).then(() => true, () => false)
  const regressions = await readRegressions(win)
  report.typing.push({ label, delayMs: delay, chars: [...text].length, identical: settled, regressions, actual: settled ? undefined : actual })
  console.log(`  ${settled ? '✓' : '✗'} ${label}（${delay}ms/键，${[...text].length} 字，回退 ${regressions} 次）${settled ? '' : `\n      实得：${actual}`}`)
  expect(actual, `${label}：逐字相同`).toBe(text)
  expect(regressions, `${label}：纯插入期间编辑器文字从未倒退`).toBe(0)
}

async function pasteAndCompare(app, win, nodeId, label, text) {
  await clearEditor(win, nodeId)
  await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), text)
  await win.keyboard.press('Meta+v')
  let actual = ''
  await expect.poll(async () => { actual = await readPrompt(win, nodeId); return actual }, { message: `${label}：粘贴后逐字相同` }).toBe(text)
  report.typing.push({ label, mode: 'paste', chars: [...text].length, identical: actual === text })
  console.log(`  ✓ ${label}（粘贴 ${[...text].length} 字）`)
}

/**
 * 一次量清「节点 / 浮框卡 / 舞台 / 画布缩放 / 底栏控件 / 停靠区」的真实几何。只读。
 * 停靠区按 DOM 自己声明的 `data-canvas-bottom-dock` 取，不抄 class——2026-09-25 起它**不再**是浮框的输入，
 * 这里只把「卡压进了几块停靠区」记进报告当「被挡就挡」的现场证据，不断言。
 */
function measureComposer(win, nodeId) {
  return win.evaluate(({ nodeSelector, footerSelector, dockSelector, cardSelector, composerSelector }) => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: r.width } }
    const nodeEl = document.querySelector(nodeSelector)
    const footer = nodeEl?.querySelector(footerSelector)
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
    // 底栏芯片的文字不许被裁断。允许的只有「有意的省略号 + title 能看全名」，且省略后仍留得下字。
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
  }, { nodeSelector: nodeOf(nodeId), footerSelector: FOOTER, dockSelector: DOCKS, cardSelector: COMPOSER_CARD, composerSelector: COMPOSER })
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
 * `pushedOffStage`：这一格是「以前会翻上去」的现场——先证卡确实伸出了舞台底边（基线，不然这格是摆设），再断它仍钉在下方。
 */
async function assertComposerPinned(win, nodeId, label, { pushedOffStage = false } = {}) {
  await expect.poll(async () => pinProblems(await measureComposer(win, nodeId)), {
    message: `${label}：浮框钉在节点正下方（顶边 = 节点底边 + ${COMPOSER_GAP}×缩放、中线对齐、宽 ${COMPOSER_WIDTH}）`,
  }).toEqual([])
  const geometry = await measureComposer(win, nodeId)
  report.overlap.push({ label, ...geometry })
  console.log(`  · ${label}：浮框钉在节点下方，card=${JSON.stringify(geometry.card)}，node=${JSON.stringify(geometry.node)}，zoom=${geometry.zoom.toFixed(2)}，压进停靠区 ${geometry.dockOverlaps.length} 块（被挡就挡，不断言），底栏控件 ${geometry.controls.length} 颗，芯片裁断 ${geometry.clipped.length} 处`)
  expect(geometry.footer, `${label}：底栏在`).not.toBeNull()
  expect(geometry.controls.length, `${label}：底栏里有控件`).toBeGreaterThan(0)
  expect(geometry.clipped, `${label}：底栏芯片文字没有被裁断`).toEqual([])
  if (pushedOffStage) {
    expect(geometry.card.bottom, `${label}：现场确实把浮框压出了舞台底边（以前这里会翻到上方）`).toBeGreaterThan(geometry.stage.bottom)
  }
}

/**
 * 把节点拖到画布左下（与缩放条、时间轴胶囊同一片区域）：节点水平中心压在缩放条右端附近，
 * 节点底边落在「浮框下沿贴近舞台底边」的高度——正是 09-21 截图里底栏被停靠区盖住的那个现场。
 * 2026-09-25 起浮框不再躲它，这一格用来证「照旧钉在节点下方，被挡就挡」。
 * 真人手势：在节点卡片上按下、分步挪、松开（不灌 store）。
 */
async function dragNodeToBottomLeft(win, nodeId, label, { bottomInset } = {}) {
  const plan = await win.evaluate(({ nodeSelector, composerSelector, bottomInset: inset }) => {
    const node = document.querySelector(nodeSelector)
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const zoomBar = [...document.querySelectorAll('[data-canvas-bottom-dock]')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .sort((a, b) => a.left - b.left)[0]
    const composer = node?.querySelector(composerSelector)
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
  }, { nodeSelector: nodeOf(nodeId), composerSelector: COMPOSER_CARD, bottomInset })
  expect(plan, `${label}：量得到节点、舞台与缩放条`).not.toBeNull()
  const dx = plan.targetCenterX - plan.nodeCenterX
  const dy = plan.targetBottom - plan.nodeBottom
  await win.mouse.move(plan.from.x, plan.from.y)
  await win.mouse.down()
  await win.mouse.move(plan.from.x + dx / 2, plan.from.y + dy / 2, { steps: 8 })
  await win.mouse.move(plan.from.x + dx, plan.from.y + dy, { steps: 8 })
  await win.mouse.up()
}

async function ensureComposerOpen(win, nodeId, label) {
  const composer = win.locator(composerOf(nodeId))
  if (!(await composer.isVisible().catch(() => false))) await clickOrFail(win.locator(nodeOf(nodeId)), `${label}：点节点重新选中`)
  await expectVisible(composer, `${label}：生成浮框在`)
}

/**
 * 新卡的落点由画布避让决定，不保证整张生成框在视口里：画布正中已有素材卡时，新图片节点落在它左边、
 * 一半压在左栏底下，生成框左半截（模型芯片）跟着被盖住（2026-10-27 走查实测，另报）。真人会点缩放簇
 * 「适应视图」把卡都放进视口，走查照做，再点回这张卡。浮框位置的判据按缩放算，适应视图改了缩放也照样成立。
 * 适应视图是一段 200ms 的动画：等变换层停稳再量、再拖——在动画半路量，拖的起点还是动画前的位置，等于没拖上
 * （2026-10-27 走查实测：视频节点没拖动，生成框留在舞台外）。
 */
async function fitViewAndReselect(win, nodeId, label) {
  await canvasFitView(win, `${label}：缩放簇「适应视图」`)
  await waitForCanvasViewportSettled(win)
  await ensureComposerOpen(win, nodeId, `${label}：适应视图后`)
}

/**
 * 外部改写：点「优化」→「优化提示」→ 夹具（文本模型那头）回 REWRITE_RESULT →「应用提示」。
 * 「应用」是编辑器之外的写入（NodePromptOptimizer → updateNode），编辑器必须逐字显示它。
 */
async function optimizeAndApply(win, nodeId, locale) {
  const expected = walk.fixture.expectText({
    label: 'prompt_refine：优化 → 应用',
    match: (body) => flattenRequestText(body).includes(REWRITE_SOURCE),
    reply: { type: 'text', text: REWRITE_RESULT },
  })
  await clickOrFail(win.locator(`${composerOf(nodeId)} [data-prompt-tool="optimize"]`), '优化钮')
  await clickOrFail(win.getByRole('button', { name: uiText(locale, 'generationCommon.optimizer.optimizePrompt'), exact: true }), '优化弹层里的改写钮')
  const request = await recorded(expected.received, '文本模型那头收到改写请求', MODEL_TIMEOUT)
  await clickOrFail(win.getByRole('button', { name: uiText(locale, 'generationCommon.optimizer.apply'), exact: true }), '改写结果的应用钮')
  await expect.poll(() => readPrompt(win, nodeId), { message: '外部改写（应用提示）逐字写进了编辑器' }).toBe(REWRITE_RESULT)
  const refineRequests = walk.fixture.requests.filter((record) => flattenRequestText(record.body).includes(REWRITE_SOURCE))
  expect(refineRequests.length, '文本模型那头恰好收到一次带原句的改写请求（走的是本机回环夹具）').toBe(1)
  return { model: request.body?.model ?? null }
}

/** 全程不点生成：这条走查不发生图请求（出图链路另有走查）。 */
function expectNoGeneration(label) {
  expect(walk.fixture.images.length, `${label}：没点生成，夹具一笔出图请求都没收到`).toBe(0)
}

async function runChinese() {
  const { app, win } = await walk.start({ first: true })
  await openBlankGenerationCanvas(win)
  report.viewport.default = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }))

  // 真实 4K 图先进画布，再新建图片节点：界面上选模型 + 画布点选接上这张图，浮框长到真实使用时那么高。
  const referenceCard = await importReferenceToCanvas(win, '中文')
  const imageNode = await addNode(win, 'image')
  await fitViewAndReselect(win, imageNode, '中文·图片节点')
  await pickModelInComposer(win, imageNode, 'zh-CN', '中文·图片节点')
  await attachReferenceByCanvasPick(win, imageNode, referenceCard, '中文·图片节点')
  await walk.snap('zh-default-position')
  await assertComposerPinned(win, imageNode, '中文·默认位置')

  await dragNodeToBottomLeft(win, imageNode, '中文·图片节点')
  await ensureComposerOpen(win, imageNode, '中文·拖到左下后')
  await assertComposerPinned(win, imageNode, '中文·左下角（默认窗口）')
  await walk.snap('zh-bottom-left-default-window')

  // 压到底边：节点压到舞台底边附近，下方放不下整张浮框——以前这里会翻上去，2026-09-25 起不翻，
  // 仍钉在节点正下方，伸出舞台的那截被裁（用户拍板「遮挡就遮挡了，保持位置」）。
  await dragNodeToBottomLeft(win, imageNode, '中文·压到底边', { bottomInset: 90 })
  await ensureComposerOpen(win, imageNode, '中文·压到底边')
  await assertComposerPinned(win, imageNode, '中文·压到底边（默认窗口）', { pushedOffStage: true })
  await walk.snap('zh-pinned-below-at-stage-bottom')

  const restore = await walk.resizeWindow(MIN_VIEWPORT.width, MIN_VIEWPORT.height)
  report.viewport.min = MIN_VIEWPORT
  await dragNodeToBottomLeft(win, imageNode, '中文·最小窗口')
  await ensureComposerOpen(win, imageNode, '中文·最小窗口')
  await assertComposerPinned(win, imageNode, '中文·左下角（最小窗口）')
  await walk.snap('zh-bottom-left-min-window')
  await walk.resizeWindow(restore.width, restore.height)

  // 丢字：图片节点。
  await typeAndCompare(win, imageNode, '图片节点·0ms', MIXED, 0)
  await typeAndCompare(win, imageNode, '图片节点·5ms', MIXED, 5)
  await pasteAndCompare(app, win, imageNode, '图片节点·粘贴', PASTE)
  await walk.snap('zh-image-typed')

  // 外部改写：优化 → 应用，编辑器必须逐字显示改写结果；之后继续快打不丢字。
  await clearEditor(win, imageNode)
  await win.keyboard.type(REWRITE_SOURCE, { delay: 0 })
  const rewrite = await optimizeAndApply(win, imageNode, 'zh-CN')
  report.external = { source: 'optimizer apply (updateNode)', before: REWRITE_SOURCE, after: REWRITE_RESULT, model: rewrite.model }
  console.log(`  ✓ 外部改写生效（文本模型 ${rewrite.model}）\n      前：${REWRITE_SOURCE}\n      后：${REWRITE_RESULT}`)
  await focusEditor(win, imageNode, '点回提示词框')
  await win.keyboard.press('Meta+ArrowDown')
  await win.keyboard.press('End')
  await win.keyboard.type(REWRITE_SUFFIX, { delay: 0 })
  await expect.poll(() => readPrompt(win, imageNode), { message: '外部改写后继续 0ms 快打，结果 = 改写结果 + 追加串' }).toBe(REWRITE_RESULT + REWRITE_SUFFIX)
  report.external.appendedIdentical = true
  await walk.snap('zh-after-external-rewrite')

  // 丢字：视频节点。适应视图只按节点框视口，新视频卡常落在最下面、生成框伸出舞台点不进去；
  // 真人会把卡往上拖到生成框整块露出来再打字——走查照做（拖到左下停靠区那片，和图片节点同一个现场）。
  await win.keyboard.press('Escape')
  const videoNode = await addNode(win, 'video')
  await fitViewAndReselect(win, videoNode, '中文·视频节点')
  await dragNodeToBottomLeft(win, videoNode, '中文·视频节点')
  await ensureComposerOpen(win, videoNode, '中文·视频节点拖到左下后')
  await typeAndCompare(win, videoNode, '视频节点·0ms', MIXED, 0)
  await typeAndCompare(win, videoNode, '视频节点·5ms', MIXED, 5)
  await pasteAndCompare(app, win, videoNode, '视频节点·粘贴', PASTE)
  await assertComposerPinned(win, videoNode, '中文·视频节点（左下角，默认窗口）')
  await walk.snap('zh-video-typed')
  expectNoGeneration('中文')
  await walk.stopApp()
}

async function runEnglish() {
  const { win } = await walk.start()
  // 界面语言是前置设置，经设置「通用」切（外壳唯一出口），不是这条走查要验的东西。
  await setAppLanguage(win, 'en', '切到英文界面')
  await openBlankGenerationCanvas(win)
  const referenceCard = await importReferenceToCanvas(win, 'EN')
  const imageNode = await addNode(win, 'image')
  await fitViewAndReselect(win, imageNode, 'EN·图片节点')
  await pickModelInComposer(win, imageNode, 'en', 'EN·图片节点')
  await attachReferenceByCanvasPick(win, imageNode, referenceCard, 'EN·图片节点')
  await dragNodeToBottomLeft(win, imageNode, 'EN·图片节点')
  await ensureComposerOpen(win, imageNode, 'EN·拖到左下后')
  await assertComposerPinned(win, imageNode, 'EN·左下角（默认窗口）')
  await typeAndCompare(win, imageNode, 'EN·图片节点·0ms', MIXED, 0)
  await walk.snap('en-bottom-left-typed')
  await dragNodeToBottomLeft(win, imageNode, 'EN·压到底边', { bottomInset: 90 })
  await ensureComposerOpen(win, imageNode, 'EN·压到底边')
  await assertComposerPinned(win, imageNode, 'EN·压到底边（默认窗口）', { pushedOffStage: true })
  await walk.snap('en-pinned-below-at-stage-bottom')
  await walk.resizeWindow(MIN_VIEWPORT.width, MIN_VIEWPORT.height)
  await dragNodeToBottomLeft(win, imageNode, 'EN·最小窗口')
  await ensureComposerOpen(win, imageNode, 'EN·最小窗口')
  await assertComposerPinned(win, imageNode, 'EN·左下角（最小窗口）')
  await walk.snap('en-bottom-left-min-window')
  expectNoGeneration('EN')
  await walk.stopApp()
}

let failure
try {
  await runChinese()
  await runEnglish()
  console.log('\ncomposer-overlap-and-fast-typing 走查通过')
} catch (error) {
  failure = error
  console.error('composer-overlap-and-fast-typing 走查失败:', error instanceof Error ? error.stack ?? error.message : String(error))
} finally {
  await walk.finish(failure)
}
