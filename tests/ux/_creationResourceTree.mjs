import { clickOrFail, expectVisible } from './_assert.mjs'

/**
 * 文稿树（原「创作内容」列）10-08 外壳重设计后住在左栏「文稿」抽屉里：平时收着，点左栏「文稿」一步就回来。
 * 09-06 那条可达性不变量照旧：**不是「树必须一直在屏幕上」，是「在这几个面上，树最多一步就能回来」。**
 * 这个 helper 就是那一步——它点的是真界面上的左栏钮，不灌 store、不改 localStorage。
 */

export async function ensureCreationResourceTree(win, where = '') {
  const tree = win.locator('[data-creation-resource-tree="true"]')
  if (await tree.isVisible().catch(() => false)) return false
  // 按下态 = 抽屉开着；没按下的那颗才是「打开」。
  const expand = win.locator('[data-shell-rail-item="docs"][aria-pressed="false"]').first()
  if (!(await expand.isVisible().catch(() => false))) {
    throw new Error(`${where || '当前面'}：文稿抽屉没开，可左栏上没有「文稿」钮——这就是回不去了`)
  }
  await clickOrFail(expand, `${where || '当前面'}：点左栏「文稿」`)
  await expectVisible(tree, `${where || '当前面'}：点了左栏「文稿」，文稿树还是没出来`)
  return true
}

/**
 * 打开分镜编辑器（某一份方案）。**唯一入口**：点左栏方案行。
 *
 * 所有走查都经这里，不许再各自「点方案行等编辑器」——`tests/ux/storyboard-editor-entry.test.mjs` 静态拦这种写法。
 * 入口只在这一处，将来方案视图替换编辑器时只改这里。
 *
 * @param {import('playwright').Page} win
 * @param {string | { pick: 'first' | 'last' }} [target] 方案 id；省略 = 第一份
 */
export async function openStoryboardEditor(win, target = { pick: 'first' }, where = '') {
  const label = where || '打开分镜编辑器'
  await ensureCreationResourceTree(win, label).catch(() => false)
  const rows = typeof target === 'string'
    ? win.locator(`[data-storyboard-row="${target}"]`)
    : win.locator('[data-storyboard-row]')
  const row = typeof target === 'string' ? rows.first() : target.pick === 'last' ? rows.last() : rows.first()
  await expectVisible(row, `${label}：左栏里没有这份分镜方案`)
  await clickOrFail(row, `${label}：点左栏方案行`)
  await expectVisible(win.locator('.workbench-storyboard:visible').first(), `${label}：点了方案行，分镜编辑器没有出现`)
}
