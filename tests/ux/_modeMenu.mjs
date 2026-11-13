// 视频节点底栏的方式格（2026-11-12 起「生成方式」只住这里，参数面板里那一段删了）。
// 走查要读方式、切方式都从这里拿，名字按词典键取（不手抄「全能参考」这类文案），中英都能用。
//
//   import { modeName, readModeCell, openModeMenu, pickMode, closeModeMenu } from './_modeMenu.mjs'
//   await pickMode(win, composer, 'zh', 'firstLast')        // 打开方式格 → 点「首尾帧」那一行
//   const rows = await openModeMenu(win, composer, 'zh')    // [{ name, description, disabled, checked, icon }]
//   await closeModeMenu(win)
//   await readModeCell(composer, 'zh')                      // 方式格上的字；只有一种方式（不显示方式格）时 null
//
// kind：'text'（文生视频）| 'image'（图生视频）| 'firstLast'（首尾帧）| 'reference'（全能参考）。
// 档案自带的方式名归不进这四类的行，按档案原名显示——用 pickModeByName。
import { clickOrFail } from './_assert.mjs'
import { uiText } from './full-walk/invariants.mjs'
import { bringButtonIntoReach } from './_generateReach.mjs'

export const MODE_KINDS = ['text', 'image', 'firstLast', 'reference']

/** locale：'zh' / 'zh-CN' / 'en'（词典按 zh-CN / en 存）。 */
const dict = (locale) => (locale === 'zh' ? 'zh-CN' : locale)

/** 方式的名字（按词典键取）。 */
export const modeName = (locale, kind) => uiText(dict(locale), `generationCommon.modeMenu.name.${kind}`)

/** 方式格的无障碍名 = 菜单小标题「生成方式」/ "Generation mode"。 */
export const modeCellLabel = (locale) => uiText(dict(locale), 'generationCommon.modeMenu.heading')

/** composer：节点生成框（`.generation-canvas-v2-node__composer` 或含它的 locator）。 */
export const modeCell = (composer, locale) => composer.locator(`[data-node-composer-footer] button[aria-label="${modeCellLabel(locale)}"]`).first()

/** 方式格上显示的方式名；方式格不在（模型只有一种方式 / 图片节点）时 null。 */
export async function readModeCell(composer, locale) {
  const cell = modeCell(composer, locale)
  return (await cell.count()) ? ((await cell.textContent()) ?? '').trim() : null
}

const VISIBLE_OPTION = '[data-nomi-select-dropdown] [role="option"]:visible'

/** 打开方式格，返回菜单每一行（只看露在屏上的那份下拉）。打不开就红。 */
export async function openModeMenu(win, composer, locale) {
  const cell = modeCell(composer, locale)
  await bringButtonIntoReach(win, cell, '底栏方式格')
  await clickOrFail(cell, '底栏方式格')
  await win.locator(VISIBLE_OPTION).first().waitFor({ state: 'visible' })
  return win.evaluate(() => [...document.querySelectorAll('[data-nomi-select-dropdown] [role="option"]')]
    .filter((el) => el.getBoundingClientRect().width > 0)
    .map((el) => {
      const check = el.querySelector('svg.tabler-icon-check')?.closest('span')
      return {
        name: el.querySelector('[data-nomi-select-option-label]')?.textContent?.trim() ?? '',
        description: el.querySelector('[data-nomi-select-option-description]')?.textContent?.trim() ?? '',
        disabled: el.hasAttribute('data-combobox-disabled') || el.getAttribute('aria-disabled') === 'true',
        checked: Boolean(check) && !check.classList.contains('invisible'),
        icon: Boolean(el.querySelector('svg.tabler-icon:not(.tabler-icon-check)')),
      }
    }))
}

export async function closeModeMenu(win) {
  await win.keyboard.press('Escape')
  await win.locator(VISIBLE_OPTION).first().waitFor({ state: 'hidden' }).catch(() => {})
}

/** 打开方式格并点名字正好是 label 的那一行（置灰的行点不动 → 红）。返回点之前读到的全部行。 */
export async function pickModeByName(win, composer, locale, label) {
  const rows = await openModeMenu(win, composer, locale)
  const row = rows.find((candidate) => candidate.name === label)
  if (!row) throw new Error(`方式菜单里没有「${label}」：${JSON.stringify(rows.map((r) => r.name))}`)
  if (row.disabled) throw new Error(`方式菜单里「${label}」是置灰的：${row.description}`)
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const option = win.locator(VISIBLE_OPTION).filter({ has: win.locator('[data-nomi-select-option-label]', { hasText: new RegExp(`^${escaped}$`) }) }).first()
  await clickOrFail(option, `方式菜单「${label}」`)
  return rows
}

/** 按四类之一切方式（名字按词典键取）。 */
export const pickMode = (win, composer, locale, kind) => pickModeByName(win, composer, locale, modeName(locale, kind))
