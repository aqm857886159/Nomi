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
//   · 设置 = 顶栏齿轮（`data-shell-settings`）→ 设置弹窗（`data-settings-dialog`，页签 `data-settings-tab-id=file|models|ai|automation|general|about`，关闭钮 `data-settings-close`）。
//     模型设置 = 其中的「模型」页签（项目库右上那颗直达模型页的钮没有了）；语言 = 「通用」页签里的 `data-settings-locale=zh-CN|en` 分段（顶栏没有语言控件了）。
//   · 三个工作区 = 顶栏正中的分段（`data-shell-stage-center`）里 `data-mode=creation|generation|preview` 三颗（读 `aria-current="page"` 判当前在哪）。
//     只有打开了项目才有；项目库里没有。
//   · 左栏抽屉：左栏的 `data-shell-rail-item="docs|catalog|assets|flows|skills|prompts"`，点一下开、再点收；抽屉本体 `data-shell-drawer=<项>`，
//     抽屉里的内容区是它下面的 `section[aria-label]`。画布分组 / 分类目录在「目录」（catalog）里；文稿 / 方案行在「文稿」（docs）里。
//     抽屉是浮层：点空白、再点同一项、Esc、**选中别的文稿 / 方案**、切项目都会把它收起——走查读完抽屉里的东西要重开，别假设它常驻。
//     左栏本身可以收起（只剩顶栏里一颗 `data-shell-rail-expand`）；项目库页没有左栏。
//   · 画布底部（拍板稿 Main 板）：加节点条在内容区底部正中（横排，`.generation-canvas-v2-toolbar`：图片 视频 声音 文字 剪辑 | 导入 +，
//     「+」里是空间一组）；左下缩放簇「⛶ | − 100% + | ⋯」（`.generation-canvas-v2__zoom-bar`），重置视图 / 画框 / 整理 / 小地图 / 操作帮助 / 缩放滑块都收在 ⋯ 里。
//   · 新建项目：空库是三张动作卡里的「新建空白项目」；库里有项目时是右上角的「新建项目」钮。
import { clickOrFail, DEFAULT_TIMEOUT_MS, expect } from './_assert.mjs'
import { findCanvasBlankPoint } from './_canvasHit.mjs'
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
const SETTINGS_DIALOG = '[data-settings-dialog]'
const STAGE_CENTER = '[data-shell-stage-center]'
const RAIL_EXPAND = '[data-shell-rail-expand]'
const RAIL_ITEM = (item) => `[data-shell-rail-item="${item}"]`
const NEW_PROJECT_ENTRY = new RegExp(`^(${alternatives(['library.newBlankProject', 'appShell.library.newProject'])})`)

/**
 * 从项目里回到项目库——像用户一样点：开顶栏项目名菜单，点「回项目库」。`repeat` > 1 = 在菜单项上连点（保存在等锁时的重复点击）。
 * 点不到就红（clickOrFail），不静默跳过。
 * `beforeItemClick`：菜单已经打开、还没点「回项目库」的那一刻调用（性能量具在这里起表，不把开菜单算进去）。
 */
export async function backToLibrary(win, { timeout, repeat = 1, label = 'back to library', beforeItemClick } = {}) {
  const budget = timeout === undefined ? {} : { timeout }
  await clickOrFail(win.locator(PROJECT_MENU), `${label}（打开顶栏项目菜单）`, budget)
  const item = win.getByRole('menuitem', { name: BACK_TO_LIBRARY_ITEM })
  if (beforeItemClick) {
    await item.first().waitFor(budget.timeout === undefined ? {} : { timeout: budget.timeout })
    await beforeItemClick()
  }
  await clickOrFail(item, label, { ...budget, ...(repeat > 1 ? { clickCount: repeat } : {}) })
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
 *
 * 先等「面板或小球」其中一个出现，再判是哪一个（2026-10-28，短片走查冷重启后 15 秒红）：外壳挂常驻面板有个过程
 * （冷启动、切工作区、重开项目之后都有），在它挂上之前一次性采样 `isVisible()`，会把「还没挂」当成「是小球」，
 * 去等一颗永远不会出现的小球——而面板其实已经按落盘的形态好好地展开着。这是**只多等不少判**的改法：面板已在 / 小球已在
 * 时一样走原路；只有「还没挂上」这一种原本会红的情形变绿；两个都不出现，原来红、现在还是红（信息更准）。
 * 几十份走查经 `expandResidentPanel` / `openCanvas` / 直接调用走到这里，所以修在这一处，不在各走查里各绕一遍。
 */
export async function ensureAgentPanelOpen(win, label = '展开常驻 Agent 面板', { timeout, form = 'any' } = {}) {
  const budget = timeout === undefined ? {} : { timeout }
  const panel = win.locator(AGENT_PANEL).first()
  const ball = win.locator(AGENT_BALL).first()
  await expect(panel.or(ball).first(), `${label}：面板和小球都没出现（外壳没把常驻 Agent 挂上来？）`).toBeVisible({ timeout: timeout ?? DEFAULT_TIMEOUT_MS })
  if (!(await panel.isVisible().catch(() => false))) {
    await clickOrFail(ball, `${label}（点 Agent 小球）`, budget)
  }
  await expect(panel, `${label}：点完面板仍没有展开`).toBeVisible(budget)
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

/**
 * 打开设置弹窗（可选直接落到某个页签）。已经开着就不再点齿轮；页签已经是当前页就不再点。
 * 项目库与项目里是同一条顶栏，所以哪都能用。弹窗没出来就抛，不静默。
 * @param {'file'|'models'|'ai'|'automation'|'general'|'about'} [tab]
 */
export async function openSettings(win, { tab, label = 'open settings', timeout } = {}) {
  const budget = timeout === undefined ? {} : { timeout }
  const dialog = win.locator(SETTINGS_DIALOG).first()
  if (!(await dialog.isVisible().catch(() => false))) {
    await clickOrFail(modelSettingsEntry(win), `${label}（顶栏齿轮）`, budget)
    await expect(dialog, `${label}：点了顶栏齿轮，设置弹窗没出来`).toBeVisible(budget)
  }
  if (tab) {
    const tabButton = dialog.locator(`[data-settings-tab-id="${tab}"]`)
    if ((await dialog.getAttribute('data-settings-tab')) !== tab) await clickOrFail(tabButton, `${label}（设置里的「${tab}」页签）`, budget)
    await expect(dialog, `${label}：点完设置仍不在「${tab}」页签`).toHaveAttribute('data-settings-tab', tab, budget)
  }
  return dialog
}

/** 设置弹窗（只返回定位器：判它在不在 / 在里面找东西用）。 */
export function settingsDialog(win) {
  return win.locator(SETTINGS_DIALOG).first()
}

/** 关设置弹窗（点它的关闭钮）。没开就什么也不做。 */
export async function closeSettings(win, label = 'close settings') {
  const dialog = win.locator(SETTINGS_DIALOG).first()
  if (!(await dialog.isVisible().catch(() => false))) return
  await clickOrFail(dialog.locator('[data-settings-close]'), label)
  await expect(dialog, `${label}：点了关闭，设置弹窗还在`).toBeHidden()
}

/** 打开设置里的模型区：点顶栏齿轮、再点设置弹窗里的「模型」页签。 */
export async function openModelSettings(win, { label = 'open model settings', timeout } = {}) {
  return openSettings(win, { tab: 'models', label, timeout })
}

/**
 * 模型设置首页 →「自定义 API / 中转站」接入向导（弹出「添加一个 AI 模型」）。
 * 没有已接入项时这一行直接摆在首页；有已接入项时它收在「其他接入方式」折叠里，先展开。点完等向导出现。
 */
export async function openCustomApiWizard(win, { label = 'open custom API wizard', timeout } = {}) {
  const budget = timeout === undefined ? {} : { timeout }
  await openModelSettings(win, { label, timeout })
  const customApi = win.locator('[data-model-home-action="custom-api"]').first()
  await expect(customApi.or(win.locator('[data-model-home-action="other-ways"]').first()).first(), `${label}：模型设置首页上既没有「自定义 API」也没有「其他接入方式」`).toBeVisible(budget)
  if (!(await customApi.isVisible().catch(() => false))) await clickOrFail(win.locator('[data-model-home-action="other-ways"]').first(), `${label}（展开「其他接入方式」）`, budget)
  await clickOrFail(customApi, `${label}（点「自定义 API / 中转站」）`, budget)
}

/**
 * 切应用语言：开设置 →「通用」→ 点语言分段里的那一项 → 关设置。外壳顶栏已经没有语言控件，语言只住设置「通用」里。
 * 已经是该语言就只确认、不重复点。切完等分段的按下态跟上（语言是同步生效的，不加等待）。
 * @param {'zh-CN'|'en'} locale
 */
export async function setAppLanguage(win, locale, label = `switch language to ${locale}`) {
  const dialog = await openSettings(win, { tab: 'general', label })
  const option = dialog.locator(`[data-settings-locale="${locale}"]`)
  if ((await option.getAttribute('aria-pressed')) !== 'true') await clickOrFail(option, label)
  await expect(option, `${label}：点完语言分段没有按下`).toHaveAttribute('aria-pressed', 'true')
  await closeSettings(win, `${label}（关设置）`)
}

/**
 * 读当前应用语言（设置「通用」里语言分段的按下项），读完关设置。外壳没有别处显示当前语言。
 * @returns {Promise<'zh-CN'|'en'>}
 */
export async function readAppLanguage(win, label = 'read app language') {
  const dialog = await openSettings(win, { tab: 'general', label })
  const pressed = dialog.locator('[data-settings-locale][aria-pressed="true"]')
  await expect(pressed, `${label}：语言分段里没有任何一项按下`).toHaveCount(1)
  const locale = await pressed.getAttribute('data-settings-locale')
  await closeSettings(win, `${label}（关设置）`)
  return locale
}

/**
 * 切工作区（创作 / 生成 / 预览）：点顶栏正中分段里的那一颗。已经在目标工作区就什么也不做。
 * 只有打开了项目才有这个分段——在项目库里调用会明确报错，不静默。
 * @param {'creation'|'generation'|'preview'} mode
 */
export async function switchWorkspace(win, mode, label = `switch to ${mode} workspace`) {
  const step = win.locator(`${STAGE_CENTER} [data-mode="${mode}"]`).first()
  await expect(step, `${label}：顶栏里没有工作区分段（只有打开了项目才有；这里还在项目库？）`).toBeVisible()
  if ((await step.getAttribute('aria-current')) === 'page') return
  await clickOrFail(step, label)
  await expect(step, `${label}：点完还没切过去`).toHaveAttribute('aria-current', 'page')
}

/**
 * 项目库里「新建一个项目」的入口（也是「已经回到项目库」的常用信号）：空库是动作卡「新建空白项目」，
 * 库里有项目时是右上角「新建项目」钮——走查别自己按文案猜，经这里找。
 */
export function newProjectEntry(win) {
  return win.getByRole('button', { name: NEW_PROJECT_ENTRY }).first()
}

/** 左栏抽屉的项（与 ShellRail 的 `data-shell-rail-item` 一一对应）。 */
export const RAIL_DRAWER_ITEMS = ['docs', 'catalog', 'assets', 'flows', 'skills', 'prompts']
const assertRailItem = (item) => {
  if (!RAIL_DRAWER_ITEMS.includes(item)) throw new Error(`没有这个左栏抽屉项「${item}」（可选：${RAIL_DRAWER_ITEMS.join(' / ')}）`)
}

/** 左栏上的某一颗（只返回定位器：判它在不在 / 按下态用）。 */
export function railItem(win, item) {
  assertRailItem(item)
  return win.locator(RAIL_ITEM(item)).first()
}

/** 抽屉本体（`data-shell-drawer=<项>`，开着才存在）。 */
export function railDrawer(win, item) {
  assertRailItem(item)
  return win.locator(`[data-shell-drawer="${item}"]`).first()
}

/** 抽屉里的内容区（各库沿用原来的面板名当 aria-label：素材库 / 技能库…；走查在里面找东西要钉在这里，别全页找）。 */
export function railDrawerPanel(win, item) {
  return railDrawer(win, item).locator('section[aria-label]').first()
}

/**
 * 打开左栏抽屉里的某一项（'docs' | 'catalog' | 'assets' | 'flows' | 'skills' | 'prompts'）。
 * 已经开着就什么也不做；左栏被收起就先展开；项目库页没有左栏（报错，不静默）。
 * 点完等抽屉本体出现（等的是元素，不是时长）。
 */
export async function openRailDrawer(win, item, label = `open ${item} drawer`) {
  assertRailItem(item)
  const button = railItem(win, item)
  const expand = win.locator(RAIL_EXPAND).first()
  // 左栏 / 「展开左栏」二者必有其一（项目刚打开时要等它挂上来——等的是元素，不是时长）；都没有 = 还在项目库。
  await expect(button.or(expand).first(), `${label}：左栏上没有「${item}」，也没有「展开左栏」——还在项目库？`).toBeVisible()
  if (!(await button.isVisible().catch(() => false))) await clickOrFail(expand, `${label}（先展开左栏）`)
  if ((await button.getAttribute('aria-pressed')) !== 'true') await clickOrFail(button, label)
  await expect(button, `${label}：点完左栏按钮没有按下`).toHaveAttribute('aria-pressed', 'true')
  await expect(railDrawer(win, item), `${label}：点完抽屉仍没开`).toBeVisible()
  return railDrawerPanel(win, item)
}

/** 收起左栏抽屉（再点一下当前开着的那一项）。没开就什么也不做。 */
export async function closeRailDrawer(win, item, label = `close ${item} drawer`) {
  assertRailItem(item)
  if (!(await railDrawer(win, item).isVisible().catch(() => false))) return
  await clickOrFail(railItem(win, item), label)
  await expect(railDrawer(win, item), `${label}：再点一下仍没收起`).toBeHidden()
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
 * 把画布底部的外框控件（加节点条 / 缩放簇）露出来再点。
 * 选中节点后它的生成框盖在这两块控件之上（用户 2026-10-10 验收规则：生成框层级更高，见
 * src/workbench/generationCanvas/reactFlow/canvasLayerOrder.ts）；真人要用被盖住的钮，先点画布空白处取消选择。
 * 走查照做：目标中心的最顶层不是它自己，就点一下空白处，再等它露出来。点空白不动视口、不建节点。
 */
export async function revealCanvasDock(win, target, label = 'canvas dock control') {
  const box = await target.boundingBox()
  if (!box) throw new Error(`${label}：不在页面上，没法露出来`)
  const topmost = () => target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!hit && (hit === el || el.contains(hit))
  })
  if (await topmost()) return
  const blank = await findCanvasBlankPoint(win)
  if (!blank) throw new Error(`${label}：被生成框盖住，且画布上找不到可以点的空白处来取消选择`)
  await win.mouse.click(blank.x, blank.y)
  await expect.poll(topmost, { message: `${label}：点空白取消选择后仍被别的东西盖住` }).toBe(true)
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
    await revealCanvasDock(win, resident, `add ${kind}`)
    await resident.click()
    return 'resident'
  }
  const more = bar.locator('[data-canvas-add-more="true"]').first()
  await more.waitFor({ timeout })
  await revealCanvasDock(win, more, 'add more')
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
  await revealCanvasDock(win, canvasFitViewButton(win), label)
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
  const stepButton = win.locator(CANVAS_ZOOM_BAR).getByRole('button', { name: navAny(direction === 'in' ? 'zoomIn' : 'zoomOut') })
  await revealCanvasDock(win, stepButton, label)
  await clickOrFail(stepButton, label)
}

/** 缩放簇里的 ⋯（视图选项）触发钮。开 / 关 / 判焦点都经它，别在走查里按文案另抄一份。 */
export function canvasViewOptionsButton(win) {
  return win.locator(CANVAS_ZOOM_BAR).getByRole('button', { name: navAny('viewOptions') })
}

/** 开 ⋯（视图选项）。已经开着就不动。 */
export async function openCanvasViewOptions(win, label = 'open view options') {
  if (await win.locator(CANVAS_VIEW_OPTIONS).first().isVisible().catch(() => false)) return
  const optionsButton = canvasViewOptionsButton(win)
  await revealCanvasDock(win, optionsButton, label)
  await clickOrFail(optionsButton, label)
  await expect(win.locator(CANVAS_VIEW_OPTIONS).first(), `${label}：点完面板没出来`).toBeVisible()
}

/**
 * 收起 ⋯。没开就不动。点 ⋯ 自己（再点一下 = 收起）而不是按 Esc：Esc 同时是画布上「取消画框 / 清选择」的键，
 * 读完画框就绪态再按 Esc 会把被读的状态一起清掉。
 */
export async function closeCanvasViewOptions(win) {
  if (!(await win.locator(CANVAS_VIEW_OPTIONS).first().isVisible().catch(() => false))) return
  await canvasViewOptionsButton(win).click()
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

/**
 * 生成页顶栏里「画布 ↔ 列表」那一个图标切换（外壳 viewSwitcher 槽，紧挨「生成」）。
 * 走查切视图一律经这里，别自己按文案 / 图标猜：按钮上的 data-generation-view-switcher 写的是**当前**视图，
 * 图标和 aria-label 显示的是点了会去的那个。已经在目标视图就什么也不做。
 * @param {'canvas' | 'list'} to
 */
export async function switchGenerationView(win, to, label = `switch to ${to}`) {
  const button = win.locator('[data-shell-topbar] [data-generation-view-switcher]')
  await expect(button, `${label}：顶栏里没有「画布 ↔ 列表」切换（只有生成页有）`).toBeVisible()
  if ((await button.getAttribute('data-generation-view-switcher')) === to) return
  await clickOrFail(button, label)
  await expect(button, `${label}：点完还没切过去`).toHaveAttribute('data-generation-view-switcher', to)
}
