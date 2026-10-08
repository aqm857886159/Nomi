// 设计实验室 · Agent 面板 v4 走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`——三屏共用一份。这里只声明这一屏的取景参数。
//
// 取景宽度 = 面板宽 390 + `Piece` 取景框的左右内边距：这一屏大多数格子只渲**一个积木**
// （定稿 Vocabulary / Composer 两板画的就是单件的状态阵列），不是整块面板。
//
// 用法：node tests/ux/design-lab-agent-panel-v4.walk.mjs  （ONLY=v4-composer-idle 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'agent-panel-v4',
  title: 'Agent 面板 v4',
  // 端口按 worktree + 角色派生（design-lab/labServer.mjs）：写死端口在这台常年 20+ worktree
  // 的机器上一定会撞，撞了截回来的是别人分支的 UI（docs/lessons/design-lab-port-5197-collision-fakes-visual-red.md）。
  role: 'walk-agent-panel-v4',
  cellWidth: 410,
  columns: 4,
  /**
   * 付费卡的 ⚙ 面板也走同一块面板渲染（`InlineParameterBar` 的 `renderParameterPanel`），
   * 所以 2026-09-11 13:00 拍板的「面板里不许再套下拉」在这里必须同样成立——
   * 卡上那一刻用户正在确认花多少钱，多点一次最贵。
   * 只对那一格断言：其余格子没有参数浮层，对它们断言「没有下拉」是句在任何情况下都成立的废话。
   */
  async assertState(page, state, record) {
    if (state.id === 'v4-consent-first-ask') {
      const geometry = await page.evaluate(() => {
        const card = document.querySelector('[data-v4-block="consent"]')
        const decline = document.querySelector('[data-v4-consent-decline]')
        const accept = document.querySelector('[data-v4-consent-accept]')
        if (!(card instanceof HTMLElement) || !(decline instanceof HTMLElement) || !(accept instanceof HTMLElement)) return null
        card.style.width = '300px'
        card.style.boxSizing = 'border-box'
        const rect = (element) => {
          const box = element.getBoundingClientRect()
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }
        }
        return { card: rect(card), decline: rect(decline), accept: rect(accept) }
      })
      if (!geometry) {
        record(`${state.id} consent action geometry missing`)
      } else {
        const { card, decline, accept } = geometry
        if (accept.width <= 0 || accept.height <= 0 || accept.right > card.right + 1 || accept.bottom > card.bottom + 1) {
          record(`${state.id} primary action is clipped at narrow width: ${JSON.stringify(geometry)}`)
        }
        if (accept.right < decline.right - 1 || accept.top < decline.top - 1) {
          record(`${state.id} primary action is not the rightmost action on the final row: ${JSON.stringify(geometry)}`)
        }
      }
    }
    if (state.id !== 'v4-spend-params-panel-open') return
    const shape = await page.evaluate(() => {
      const panel = document.querySelector('[data-agent-parameter-panel="true"]')
      if (!panel) return null
      return {
        selects: panel.querySelectorAll('[aria-haspopup="listbox"]').length,
        options: panel.querySelectorAll('[role="radio"]').length,
        inputs: panel.querySelectorAll('input, [role="slider"]').length,
      }
    })
    if (!shape) { record(`${state.id} ⚙ 面板没打开（取景台那一下点空了），这一格什么都没证`); return }
    // 基线在前：⚙ 里确实有东西（摊开的选项或滑杆/输入框），后面那句「没有下拉」才不是废话。
    if (shape.options + shape.inputs === 0) record(`${state.id} ⚙ 面板里什么控件都没有，这一格证不了任何事`)
    if (shape.selects) record(`${state.id} 付费卡 ⚙ 面板里不该有下拉（数到 ${shape.selects} 个）——选项必须摊开`)
  },
})
