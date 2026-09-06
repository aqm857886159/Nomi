// 左缘竖排工具条的**共享点法**（2026-09-06「第三档」之后）。
//
// 立项根因：这条工具条从 9 个平铺收成「5 常驻 + 一个『更多』」，收进去的 5 种
// （文字 / 3D 场景 / 3D 模型 / 全景图 / 画板）**菜单没展开时根本不在 DOM 里**。
// 走查里那些 `if ((await x.count()) > 0) await x.click()` 的软守卫遇上这种情况不会红，
// 只会静默地什么都不做，然后后面每一步都在一个空画布上「通过」——
// 正是 docs/lessons/dead-selector-lies-both-ways 那一族的假绿。
//
// 所以点左缘只准走这一个口：它自己判断该种在常驻还是在「更多」，找不到就**抛**，不返回 false。
const RAIL = '.generation-canvas-v2-toolbar'
const MORE_MENU = '.generation-canvas-v2-toolbar__more-menu'

/**
 * 从左缘工具条新建一个节点。
 * @returns {Promise<'resident'|'more'>} 它是从常驻位点的还是从「更多」里点的（断言可用）。
 */
export async function addCanvasNodeFromRail(win, kind, { timeout = 5000 } = {}) {
  const toolbar = win.locator(RAIL).first()
  await toolbar.waitFor({ timeout })
  const resident = toolbar.locator(`[data-add-intent="${kind}"]`).first()
  if ((await resident.count()) > 0) {
    await resident.click()
    return 'resident'
  }
  // waitFor 而不是 `if (count === 0)`：找不到就当场抛，不给软守卫留后路。
  const more = toolbar.locator('[data-canvas-add-more="true"]').first()
  await more.waitFor({ timeout })
  await more.click()
  const item = win.locator(`${MORE_MENU} [data-node-kind="${kind}"]`).first()
  await item.waitFor({ timeout })
  await item.click()
  return 'more'
}
