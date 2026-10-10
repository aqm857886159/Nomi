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
