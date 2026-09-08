// 设计实验室 · primitive 陈列 · 菜单族走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与其它屏共用一份）；这里声明这一屏的取景参数，
// 外加**只有这一屏才成立的断言**。
//
// 这一屏的命门和别的屏不一样：菜单 **Portal 到 body**，舞台子树里一个菜单项都没有。
// 于是「菜单压根没打开」和「菜单打开了」在舞台的 boundingBox 上完全分不出来——
// 截出来是一张白底说明卡，看着挺正常。所以每一格都逐项验**菜单本体**里的东西：
// 项数、危险项数、禁用项数、分隔线数、checkbox/radio 的 role、第二行灰字在不在。
// 反过来的一半同样重要：没有危险项的那几格必须**一个红项都没有**，否则
// 「哪一格都在报红」和「该红的在红」在断言上分不开。
//
// 产出：`tests/ux/shots/design-lab-primitives-menu/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 用法：node tests/ux/design-lab-primitives-menu.walk.mjs （ONLY=pm-01-canvas-node-menu 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

/**
 * 每一格许诺自己画了什么。
 * `items` = 可选项总数（menuitem + menuitemcheckbox + menuitemradio）。
 * `danger` = 红字项数。`disabled` = 禁用项数（且每一个都必须挂得住 title 说明）。
 * `separators` = 分隔线数。`descriptions` = 带第二行灰字的项数。
 * `checkbox` / `radio` = 各自的 role 数。`labels` = 分组标题数。
 */
const EXPECTED = {
  'pm-01-canvas-node-menu': { items: 5, danger: 1, disabled: 2, separators: 1, descriptions: 0, checkbox: 0, radio: 0, labels: 0 },
  'pm-02-timeline-context-menu': { items: 8, danger: 4, disabled: 0, separators: 0, descriptions: 0, checkbox: 0, radio: 0, labels: 0 },
  'pm-03-groups-checkbox-radio': { items: 6, danger: 0, disabled: 0, separators: 1, descriptions: 0, checkbox: 3, radio: 3, labels: 2 },
  'pm-04-description-row': { items: 3, danger: 0, disabled: 1, separators: 1, descriptions: 1, checkbox: 0, radio: 0, labels: 0 },
}

await walkDesignLabScreen({
  screen: 'primitives-menu',
  title: 'primitive 陈列 · 菜单族',
  // 端口按 worktree + 角色派生（design-lab/labServer.mjs）：写死端口在这台常年 20+ worktree
  // 的机器上一定会撞，撞了截回来的是别人分支的 UI。
  role: 'walk-primitives-menu',
  // 整屏取景（菜单 Portal 到 body），所以视口就是取景框：开小一点，接触表才读得动。
  viewport: { width: 520, height: 420 },
  cellWidth: 520,
  columns: 2,
  assertState: async (page, state, record) => {
    const expected = EXPECTED[state.id]
    // 新加了一格却没在上面认领自己画了什么 → 当场说出来，别让这一格无人验证地混进接触表。
    if (!expected) {
      record(`${state.id} 没有在 EXPECTED 里认领自己画了什么——补上它，别让这一格无人验证`)
      return
    }
    const seen = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"]')
      if (!menu) return null
      const all = [...menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')]
      const disabled = all.filter((node) => node.getAttribute('data-disabled') !== null)
      return {
        // 菜单在不在舞台外面：Portal 没生效的话它会留在舞台子树里，而那正是被 overflow 裁掉的老路。
        portaled: !menu.closest('[data-design-lab-stage]'),
        items: all.length,
        danger: all.filter((node) => node.className.includes('text-workbench-danger')).length,
        disabled: disabled.length,
        // 禁用项必须自己挂得住解释（迁移前要外包一层 <span title> 才行，那层壳没了）。
        disabledWithoutReason: disabled.filter((node) => !node.getAttribute('title')).length,
        separators: menu.querySelectorAll('[role="separator"]').length,
        descriptions: menu.querySelectorAll('[data-menu-description]').length,
        checkbox: menu.querySelectorAll('[role="menuitemcheckbox"]').length,
        radio: menu.querySelectorAll('[role="menuitemradio"]').length,
        labels: menu.querySelectorAll('[data-menu-label]').length,
      }
    })
    if (!seen) {
      record(`${state.id} 页面上没有 role="menu" —— 菜单没打开，这一格截的是一张白卡`)
      return
    }
    if (!seen.portaled) {
      record(`${state.id} 的菜单还留在舞台子树里 —— Portal 没生效，生产里它会被祖先 overflow 裁掉`)
    }
    for (const key of ['items', 'danger', 'disabled', 'separators', 'descriptions', 'checkbox', 'radio', 'labels']) {
      if (seen[key] !== expected[key]) {
        record(`${state.id} 许诺 ${key}=${expected[key]}，实际 ${seen[key]}`)
      }
    }
    if (seen.disabledWithoutReason > 0) {
      record(`${state.id} 有 ${seen.disabledWithoutReason} 个禁用项没有 title 说明——禁用必须说明为什么（§1.6 C1）`)
    }
  },
})
