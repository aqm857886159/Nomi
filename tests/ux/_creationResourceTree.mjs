import { clickOrFail, expectVisible } from './_assert.mjs'
import { openRailDrawer, railItem } from './_shell.mjs'

/**
 * 文稿树（原「创作内容」列）10-08 外壳重设计后住在左栏「文稿」抽屉里：平时收着，点左栏「文稿」一步就回来。
 * 09-06 那条可达性不变量照旧：**不是「树必须一直在屏幕上」，是「在这几个面上，树最多一步就能回来」。**
 * 这个 helper 就是那一步——它点的是真界面上的左栏钮，不灌 store、不改 localStorage。
 */

export async function ensureCreationResourceTree(win, where = '') {
  const label = where || '当前面'
  const tree = win.locator('[data-creation-resource-tree="true"]')
  // 判「抽屉开着没」看左栏钮的按下态，不看树此刻可不可见：#1197 起选中文稿 / 方案会把抽屉收起，收起有 160ms 的滑出动画，
  // 这期间树还「可见」——按可见判会误以为还开着、不重开，下一步点行就落空（夜跑 S08 的一个成因）。按下态是同步的。
  const wasOpen = (await railItem(win, 'docs').getAttribute('aria-pressed').catch(() => null)) === 'true'
  await openRailDrawer(win, 'docs', `${label}：点左栏「文稿」`)
  await expectVisible(tree, `${label}：点了左栏「文稿」，文稿树还是没出来`)
  return !wasOpen
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
  await ensureCreationResourceTree(win, label)
  const tree = win.locator('[data-creation-resource-tree="true"]')
  const rows = typeof target === 'string'
    ? tree.locator(`[data-storyboard-row="${target}"]`)
    : tree.locator('[data-storyboard-row]')
  const row = typeof target === 'string' ? rows.first() : target.pick === 'last' ? rows.last() : rows.first()
  await expectVisible(row, `${label}：左栏里没有这份分镜方案`)
  // 点方案行里真正的按钮（行容器的正中间在悬停探头 / 更多操作按钮出现时可能落在别的东西上）。
  await clickOrFail(row.locator('[data-storyboard-id]'), `${label}：点左栏方案行`)
  await expectVisible(win.locator('.workbench-storyboard:visible').first(), `${label}：点了方案行，分镜编辑器没有出现`)
}
