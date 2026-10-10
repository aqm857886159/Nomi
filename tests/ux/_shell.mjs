// 外壳（顶栏 / 左栏 / Agent 宿主）在走查里的**唯一**定位出口。
//
// 为什么要它（2026-10-09，#1136 外壳重设计的 CI 全红）：外壳一换，「返回项目库」从顶栏上一颗直达钮变成项目名菜单里的一项，
// 「Agent 面板开着」从默认状态变成要点一下小球——而这些位置在十几份走查里各写了一份（`getByRole('button', { name: '返回项目库' })`
// 抄了 15 处，用过的项目夹具自己又抄了一份面板选择器），改外壳的人没法一次改全，剩下的全部悬空成假红。
// 现在走查找这几处外壳位置，一律经这里：下次外壳再变，只改这一个文件。
//
// 范围：只放「走查为了到达别处而经过的外壳位置」（回项目库、叫出 / 收起 Agent 面板）。
// 走查自己要验的外壳细节（几何、快捷键、拖动）写在对应走查里，不进这里。
import { clickOrFail, expect } from './_assert.mjs'
import { uiText } from './full-walk/invariants.mjs'

// 文案一律按词典键取（不抄词典原文——check:test-copy-literals），中英两种语言都认。
const bothLocales = (key) => ['zh-CN', 'en'].map((locale) => uiText(locale, key))
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const anyOf = (key, { anchored = true } = {}) => new RegExp(`${anchored ? '^' : ''}(${bothLocales(key).map(escapeRegExp).join('|')})${anchored ? '$' : ''}`)

/** 展开态的常驻 Agent 面板（外壳发的两枚身份属性）。 */
export const AGENT_PANEL = '[data-agent-resident="true"][data-agent-panel="true"]'
/** 收起态：外壳仍在，但没有 `data-agent-panel`。 */
export const COLLAPSED_SHELL = '[data-agent-resident="true"][data-agent-collapsed="true"]'
/** 收起态下叫回面板的钮。 */
export const COLLAPSED_DOCK_OPEN = '[data-v4-control="dock-open"]'
/** 面板头部的「收起」钮。 */
export const COLLAPSE_BUTTON = '[data-v4-control="collapse"]'

const BACK_TO_LIBRARY = anyOf('appBar.backToLibrary')
const NEW_PROJECT_ENTRY = anyOf('library.newBlankProject', { anchored: false })
const NEW_PROJECT_ENTRY_ANCHORED = new RegExp(`^${NEW_PROJECT_ENTRY.source}`)
const MODEL_SETTINGS_ENTRY_IN_PROJECT = bothLocales('appBar.openModelAccess').map((label) => `[aria-label="${label}"]`).join(', ')
const MODEL_SETTINGS_ENTRY = `[data-testid="open-model-settings"], ${MODEL_SETTINGS_ENTRY_IN_PROJECT}`

/**
 * 从项目里回到项目库——像用户一样点。`repeat` > 1 = 连点（保存在等锁时的重复点击）。
 * 点不到就红（clickOrFail），不静默跳过。
 */
export async function backToLibrary(win, { timeout, repeat = 1, label = 'back to library' } = {}) {
  const button = win.getByRole('button', { name: BACK_TO_LIBRARY })
  if (repeat === 1) {
    await clickOrFail(button, label, timeout === undefined ? {} : { timeout })
    return
  }
  await clickOrFail(button, label, timeout === undefined ? { clickCount: repeat } : { timeout, clickCount: repeat })
}

/** 叫出常驻面板：已经展开就什么也不做；收起着就点回来。 */
export async function ensureAgentPanelOpen(win, label = '展开常驻 Agent 面板', { timeout } = {}) {
  if (await win.locator(COLLAPSED_SHELL).isVisible().catch(() => false)) {
    await clickOrFail(win.locator(COLLAPSED_DOCK_OPEN).first(), label)
  }
  await expect(win.locator(AGENT_PANEL).first(), `${label}：点完面板仍没有展开`).toBeVisible(timeout === undefined ? {} : { timeout })
}

/** 收起常驻面板，把画布整块还给用户（走查接下来要点画布上的东西时用）。 */
export async function collapseAgentPanel(win, label = '收起常驻 Agent 面板') {
  if (!(await win.locator(AGENT_PANEL).first().isVisible().catch(() => false))) return
  await clickOrFail(win.locator(`${AGENT_PANEL} ${COLLAPSE_BUTTON}`).first(), label)
  await expect(win.locator(COLLAPSED_SHELL).first(), `${label}：点完面板仍没有收起`).toBeVisible()
}

/** 「已经在某个项目里就先回项目库」：不在项目里（已经是项目库）就什么也不做，返回有没有点。 */
export async function leaveProjectIfOpen(win, label = '回项目库') {
  const button = win.getByRole('button', { name: BACK_TO_LIBRARY })
  if (!(await button.first().isVisible().catch(() => false))) return false
  await clickOrFail(button, label)
  return true
}

/**
 * 「模型设置」入口（项目库右上 / 项目顶栏上那颗直达模型页的钮）。走查要等它出现、判它在不在时用——
 * 它同时是「应用已就绪」的常用信号。`where: 'project'` = 只认项目里的那一颗（项目库上的不算）。
 */
export function modelSettingsEntry(win, { where = 'any' } = {}) {
  return win.locator(where === 'project' ? MODEL_SETTINGS_ENTRY_IN_PROJECT : MODEL_SETTINGS_ENTRY).first()
}

/** 打开设置里的模型区：点入口、等设置弹窗出现。 */
export async function openModelSettings(win, { label = 'open model settings', timeout } = {}) {
  await clickOrFail(modelSettingsEntry(win), label, timeout === undefined ? {} : { timeout })
}

/**
 * 项目库里「新建一个项目」的入口（也是「已经回到项目库」的常用信号）。库里有没有项目、第一次打开还是回来，
 * 它的长相可以不同——走查别自己按文案猜，经这里找。
 */
export function newProjectEntry(win) {
  return win.getByRole('button', { name: NEW_PROJECT_ENTRY_ANCHORED }).first()
}
