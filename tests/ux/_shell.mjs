// 外壳（顶栏 / 左栏 / Agent 宿主）在走查里的**唯一**定位出口。
//
// 为什么要它（2026-10-09，#1136 外壳重设计的 CI 全红）：外壳一换，「返回项目库」从顶栏上一颗直达钮变成项目名菜单里的一项，
// 「Agent 面板开着」从默认状态变成要点一下小球——而这些位置在十几份走查里各写了一份（`getByRole('button', { name: '返回项目库' })`
// 抄了 15 处，用过的项目夹具自己又抄了一份面板选择器），改外壳的人没法一次改全，剩下的全部悬空成假红。
// 现在走查找这几处外壳位置，一律经这里：下次外壳再变，只改这一个文件。
//
// 范围：只放「走查为了到达别处而经过的外壳位置」（回项目库、叫出 / 收起 Agent 面板、模型设置入口、新建项目入口）。
// 走查自己要验的外壳细节（几何、快捷键、拖动）写在对应走查里，不进这里。
//
// 当前外壳（10-08 重设计）：
//   · 回项目库 = 顶栏项目名（`data-shell-project-menu`）打开的菜单里的「回项目库」一项。
//   · Agent 三形态：小球（`data-agent-ball`）/ 浮窗 / 停靠；面板头部的三选一钮是 `data-agent-form-to="ball|float|dock"`。
//     生成页默认是小球，创作 / 分镜 / 预览默认停靠。面板在小球形态下仍挂着，但在 hidden 容器里——「在不在」用 attached、
//     「看得见」用 visible，别混。
//   · 模型设置 = 顶栏齿轮（`data-shell-settings`）→ 设置弹窗里的「模型」页签（项目库右上那颗直达模型页的钮没有了）。
//   · 左栏抽屉：左栏的 `data-shell-rail-item="docs|catalog|assets|flows|skills|prompts"`，点一下开、再点收；
//     画布分组 / 分类目录在「目录」（catalog）里。
//   · 画布底部（拍板稿 Main 板）：加节点条在内容区底部正中（横排，`.generation-canvas-v2-toolbar`：图片 视频 声音 文字 剪辑 | 导入 +，
//     「+」里是空间一组）；左下缩放簇「⛶ | − 100% + | ⋯」（`.generation-canvas-v2__zoom-bar`），重置视图 / 画框 / 整理 / 小地图 / 操作帮助 / 缩放滑块都收在 ⋯ 里。
//   · 新建项目：空库是三张动作卡里的「新建空白项目」；库里有项目时是右上角的「新建项目」钮。
import { clickOrFail, expect } from './_assert.mjs'
import { uiText } from './full-walk/invariants.mjs'

// 文案一律按词典键取（不抄词典原文——check:test-copy-literals），中英两种语言都认。
const bothLocales = (key) => ['zh-CN', 'en'].map((locale) => uiText(locale, key))
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const alternatives = (keys) => keys.flatMap(bothLocales).map(escapeRegExp).join('|')

/** 展开态（停靠或浮窗）的常驻 Agent 面板（外壳发的两枚身份属性）。 */
export const AGENT_PANEL = '[data-agent-resident="true"][data-agent-panel="true"]'
/**
 * 收起态（小球形态）：面板仍挂着（回执效果、计划预览、角标投影都还在），但挂在 `hidden` 容器里——
 * 判「在」用 `toBeAttached`，**不用** `toBeVisible`。
 */
export const COLLAPSED_SHELL = '[data-agent-resident="true"][data-agent-collapsed="true"]'
/** 收起后叫回 Nomi 的唯一入口 = 内容区右下的 Agent 小球（`data-agent-ball` = idle / running / done / failed / pending）。 */
export const AGENT_BALL = '[data-agent-ball]'
/** 面板头部「收起」= 形态三选一里的「小球」。 */
export const COLLAPSE_BUTTON = '[data-agent-form-to="ball"]'
const TO_DOCK = '[data-agent-form-to="dock"]'
const DOCK_LAYER = '[data-shell-agent-layer][data-agent-form="dock"]'

const PROJECT_MENU = '[data-shell-project-menu]'
const BACK_TO_LIBRARY_ITEM = new RegExp(`^(${alternatives(['appShell.topbar.backToLibrary'])})$`)
const SETTINGS_BUTTON = '[data-shell-settings]'
const MODELS_TAB = '[data-settings-tab-id="models"]'
const RAIL_ITEM = (item) => `[data-shell-rail-item="${item}"]`
const NEW_PROJECT_ENTRY = new RegExp(`^(${alternatives(['library.newBlankProject', 'appShell.library.newProject'])})`)

/**
 * 从项目里回到项目库——像用户一样点：开顶栏项目名菜单，点「回项目库」。`repeat` > 1 = 在菜单项上连点（保存在等锁时的重复点击）。
 * 点不到就红（clickOrFail），不静默跳过。
 */
export async function backToLibrary(win, { timeout, repeat = 1, label = 'back to library' } = {}) {
  const budget = timeout === undefined ? {} : { timeout }
  await clickOrFail(win.locator(PROJECT_MENU), `${label}（打开顶栏项目菜单）`, budget)
  await clickOrFail(win.getByRole('menuitem', { name: BACK_TO_LIBRARY_ITEM }), label, { ...budget, ...(repeat > 1 ? { clickCount: repeat } : {}) })
}

/** 「已经在某个项目里就先回项目库」：不在项目里（已经是项目库，顶栏没有项目菜单）就什么也不做，返回有没有点。 */
export async function leaveProjectIfOpen(win, label = 'back to library') {
  if (!(await win.locator(PROJECT_MENU).first().isVisible().catch(() => false))) return false
  await backToLibrary(win, { label })
  return true
}

/**
 * 叫出常驻面板。已经展开就什么也不做；小球着就点小球（先出浮窗）。
 * `form`：'any'（默认，面板在就行）/ 'dock'（要停靠右栏——夹具的版面前提「画布剩多宽」按停靠算）。
 */
export async function ensureAgentPanelOpen(win, label = '展开常驻 Agent 面板', { timeout, form = 'any' } = {}) {
  const budget = timeout === undefined ? {} : { timeout }
  if (!(await win.locator(AGENT_PANEL).first().isVisible().catch(() => false))) {
    await clickOrFail(win.locator(AGENT_BALL).first(), `${label}（点 Agent 小球）`, budget)
  }
  await expect(win.locator(AGENT_PANEL).first(), `${label}：点完面板仍没有展开`).toBeVisible(budget)
  if (form === 'dock' && (await win.locator(DOCK_LAYER).count()) < 1) {
    await clickOrFail(win.locator(`${AGENT_PANEL} ${TO_DOCK}`).first(), `${label}（切到停靠）`, budget)
    await expect(win.locator(DOCK_LAYER).first(), `${label}：点了「停靠」仍不是停靠形态`).toBeAttached(budget)
  }
}

/** 收起常驻面板（变小球），把画布整块还给用户（走查接下来要点画布上的东西时用）。已经是小球就什么也不做。 */
export async function collapseAgentPanel(win, label = '收起常驻 Agent 面板') {
  if (!(await win.locator(AGENT_PANEL).first().isVisible().catch(() => false))) return
  await clickOrFail(win.locator(`${AGENT_PANEL} ${COLLAPSE_BUTTON}`).first(), label)
  await expect(win.locator(AGENT_BALL).first(), `${label}：点完没变成小球`).toBeVisible()
}

/**
 * 「模型设置」入口：顶栏齿轮（项目库与项目里是同一条顶栏，所以 `where` 在新外壳下没有区别，签名保留给调用方）。
 * 走查要等它出现、判它在不在时用——它同时是「应用已就绪」的常用信号。
 */
export function modelSettingsEntry(win, { where = 'any' } = {}) {
  void where
  return win.locator(SETTINGS_BUTTON).first()
}

/** 打开设置里的模型区：点顶栏齿轮、再点设置弹窗里的「模型」页签。 */
export async function openModelSettings(win, { label = 'open model settings', timeout } = {}) {
  const budget = timeout === undefined ? {} : { timeout }
  await clickOrFail(modelSettingsEntry(win), `${label}（顶栏齿轮）`, budget)
  await clickOrFail(win.locator(`[data-settings-dialog] ${MODELS_TAB}`), `${label}（设置里的「模型」页签）`, budget)
}

/**
 * 项目库里「新建一个项目」的入口（也是「已经回到项目库」的常用信号）：空库是动作卡「新建空白项目」，
 * 库里有项目时是右上角「新建项目」钮——走查别自己按文案猜，经这里找。
 */
export function newProjectEntry(win) {
  return win.getByRole('button', { name: NEW_PROJECT_ENTRY }).first()
}

/**
 * 打开左栏抽屉里的某一项（走查为了找分组 / 目录等去的）。目前只登记了走查用到的：
 * 'catalog'（画布分组 / 分类目录）。别处要用别的项，在这里加映射，不要在走查里抄钮。
 * 已经开着（按下态）就什么也不做。
 */
export async function openRailDrawer(win, item, label = `open ${item} drawer`) {
  if (item !== 'catalog') throw new Error(`openRailDrawer 还没登记「${item}」`)
  const closed = win.locator(`${RAIL_ITEM(item)}[aria-pressed="false"]`)
  if (await closed.first().isVisible().catch(() => false)) await clickOrFail(closed, label)
  await expect(win.locator(`${RAIL_ITEM(item)}[aria-pressed="true"]`).first(), `${label}：点完抽屉仍没开`).toBeVisible()
}

// ── 画布底部：加节点条 + 缩放簇 ───────────────────────────────────────────────────────────────

/** 选择器常量：给 page.evaluate 里量几何用（页内拿不到 Node 侧的 import，选择器串得从这里传进去）。 */
export const CANVAS_ADD_BAR = '.generation-canvas-v2-toolbar'
export const CANVAS_ADD_MORE_MENU = '.generation-canvas-v2-toolbar__more-menu'
export const CANVAS_ZOOM_BAR = '.generation-canvas-v2__zoom-bar'
export const CANVAS_NAV_STACK = '.generation-canvas-v2__navigation-stack'
const CANVAS_VIEW_OPTIONS = '[data-canvas-view-options]'
const navAny = (key) => new RegExp(`^(${alternatives([`generationCommon.navigation.${key}`])})$`)

/** 加节点条（内容区底部正中那条横排）。 */
export function canvasAddBar(win) {
  return win.locator(CANVAS_ADD_BAR).first()
}

/**
 * 从加节点条新建一个节点：常驻位的直接点；收在「+」里的（导演台 / 3D 模型 / 全景 / 白板）先开「+」再点。
 * 找不到就抛，不返回 false（软守卫会让后面每一步在空画布上「通过」）。
 * @returns {Promise<'resident'|'more'>}
 */
export async function addCanvasNode(win, kind, { timeout = 5000 } = {}) {
  const bar = canvasAddBar(win)
  await bar.waitFor({ timeout })
  const resident = bar.locator(`[data-add-intent="${kind}"]`).first()
  if ((await resident.count()) > 0) {
    await resident.click()
    return 'resident'
  }
  const more = bar.locator('[data-canvas-add-more="true"]').first()
  await more.waitFor({ timeout })
  await more.click()
  const item = win.locator(`${CANVAS_ADD_MORE_MENU} [data-node-kind="${kind}"]`).first()
  await item.waitFor({ timeout })
  await item.click()
  return 'more'
}

/** 左下缩放簇里的「适应视图」钮（只返回定位器，点不点、断言什么由走查自己写）。 */
export function canvasFitViewButton(win) {
  return win.locator(CANVAS_ZOOM_BAR).getByRole('button', { name: navAny('fitView') }).first()
}

export async function canvasFitView(win, label = 'fit view') {
  await clickOrFail(canvasFitViewButton(win), label)
}

/** 左下缩放簇上显示的百分数（数字，不带 %）。 */
export async function canvasZoomPercent(win) {
  const text = await win.locator(`${CANVAS_ZOOM_BAR} [data-canvas-zoom-percent]`).first().innerText()
  const value = Number.parseFloat(text)
  if (!Number.isFinite(value)) throw new Error(`读不到缩放百分数：「${text}」`)
  return value
}

/** 点 − / + 一下（direction = 'in' | 'out'）。 */
export async function canvasZoomStep(win, direction, label = `zoom ${direction}`) {
  await clickOrFail(win.locator(CANVAS_ZOOM_BAR).getByRole('button', { name: navAny(direction === 'in' ? 'zoomIn' : 'zoomOut') }), label)
}

/** 开 ⋯（更多视图选项）。已经开着就不动。 */
export async function openCanvasViewOptions(win, label = 'open view options') {
  if (await win.locator(CANVAS_VIEW_OPTIONS).first().isVisible().catch(() => false)) return
  await clickOrFail(win.locator(CANVAS_ZOOM_BAR).getByRole('button', { name: navAny('viewOptions') }), label)
  await expect(win.locator(CANVAS_VIEW_OPTIONS).first(), `${label}：点完面板没出来`).toBeVisible()
}

/**
 * 收起 ⋯。没开就不动。点 ⋯ 自己（再点一下 = 收起）而不是按 Esc：Esc 同时是画布上「取消画框 / 清选择」的键，
 * 读完画框就绪态再按 Esc 会把被读的状态一起清掉。
 */
export async function closeCanvasViewOptions(win) {
  if (!(await win.locator(CANVAS_VIEW_OPTIONS).first().isVisible().catch(() => false))) return
  await win.locator(CANVAS_ZOOM_BAR).getByRole('button', { name: navAny('viewOptions') }).click()
  await expect(win.locator(CANVAS_VIEW_OPTIONS).first()).toBeHidden()
}

/** ⋯ 里的某一项（`reset-view` | `frame-tool` | `tidy` | `minimap` | `controls-help`）的定位器；调用前要先 openCanvasViewOptions。 */
export function canvasViewOption(win, option) {
  return win.locator(`${CANVAS_VIEW_OPTIONS} [data-view-option="${option}"]`).first()
}

/** 点 ⋯ 里的一项，点完收起 ⋯。 */
export async function runCanvasViewOption(win, option, label = `view option ${option}`) {
  await openCanvasViewOptions(win, `${label}（开 ⋯）`)
  await clickOrFail(option === 'controls-help' ? canvasViewOption(win, option).locator('button') : canvasViewOption(win, option), label)
  if (option !== 'controls-help') await closeCanvasViewOptions(win)
}

export const canvasResetView = (win, label = 'reset view') => runCanvasViewOption(win, 'reset-view', label)
export const canvasToggleFrameTool = (win, label = 'toggle frame tool') => runCanvasViewOption(win, 'frame-tool', label)
export const canvasTidy = (win, label = 'tidy canvas') => runCanvasViewOption(win, 'tidy', label)
export const canvasToggleMinimap = (win, label = 'toggle minimap') => runCanvasViewOption(win, 'minimap', label)

/** 打开「画布操作」帮助浮层（经 ⋯ 里的那一行）；浮层开着时 ⋯ 保持开着，关帮助用 Esc。 */
export async function openCanvasControlsHelp(win, label = 'open canvas controls help') {
  await runCanvasViewOption(win, 'controls-help', label)
}

/** 把缩放调到某个百分数（拖 ⋯ 里的滑块）。调完收起 ⋯。 */
export async function canvasSetZoomPercent(win, percent, label = 'set zoom') {
  await openCanvasViewOptions(win, `${label}（开 ⋯）`)
  const slider = win.locator(`${CANVAS_VIEW_OPTIONS} input[type="range"]`).first()
  await slider.fill(String(percent))
  await closeCanvasViewOptions(win)
}

/** 「+」点开的空间一组菜单（导演台 / 3D 模型 / 全景 / 白板）。 */
export function canvasAddMoreMenu(win) {
  return win.locator(CANVAS_ADD_MORE_MENU).first()
}

/** 缩放滑块（在 ⋯ 里）：自动开 ⋯ 并返回滑块定位器；⋯ 保持开着，用完调 closeCanvasViewOptions。 */
export async function canvasZoomSlider(win) {
  await openCanvasViewOptions(win, 'open view options for the zoom slider')
  return win.locator(`${CANVAS_VIEW_OPTIONS} input[type="range"]`).first()
}

/** 「画框」工具的开关钮（在 ⋯ 里，带 aria-pressed）：自动开 ⋯ 并返回定位器；⋯ 保持开着。 */
export async function canvasFrameToolButton(win) {
  await openCanvasViewOptions(win, 'open view options for the frame tool')
  return canvasViewOption(win, 'frame-tool')
}

/** 「画布操作」帮助那一行（在 ⋯ 里）里的触发钮：自动开 ⋯ 并返回定位器；⋯ 保持开着。 */
export async function canvasControlsHelpTrigger(win) {
  await openCanvasViewOptions(win, 'open view options for the controls help')
  return canvasViewOption(win, 'controls-help').locator('button')
}

/** 画框工具此刻是不是就绪（读 ⋯ 里那一行的 aria-pressed，读完收起 ⋯）。 */
export async function canvasFrameToolPressed(win) {
  const button = await canvasFrameToolButton(win)
  const pressed = await button.getAttribute('aria-pressed')
  await closeCanvasViewOptions(win)
  return pressed === 'true'
}

/** 「画布操作」帮助浮层（role=dialog）。 */
export function canvasControlsHelpDialog(win) {
  return win.getByRole('dialog', { name: new RegExp(`^(${alternatives(['generationCommon.canvas.controlsHelp.aria'])})$`) })
}
