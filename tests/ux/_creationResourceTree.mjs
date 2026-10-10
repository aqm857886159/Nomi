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
