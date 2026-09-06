// 设计实验室 · 供应商偏好走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与其它屏共用一份）；这里声明这一屏的取景参数，
// 外加**一条只有这一屏才成立的断言**。
//
// 那条断言是这一屏的命门：要看的东西全在展开后的浮层里（模型名有没有被 chip 挤没、
// 偏好那家排第几、没接入的家在不在）。浮层没打开的话，截出来是一个孤零零的触发钮——
// 一张「看着挺正常」的废图，而且和真绿长得一模一样。所以逐格验四件事：
//   · picker 类的格子必须真的有一个展开的下拉，且有选项；
//   · 「一家都没接入」那一格必须**恰好**是一行诚实空态（空白下拉读起来像「坏了」）；
//   · 每一行都必须看得见模型名（宽度 > 0）——这正是 2026-09-06 用户返工时的那个 bug；
//   · 浮层整个落在舞台里（溢出的部分按元素截图会被无声裁掉）。
//
// 产出：`tests/ux/shots/design-lab-vendor-order/<state>.png` + `_contact-sheet.png`（拍板用）。
// 真机那份证据在 `tests/ux/shots/vendor-order/journey-*.png`（vendor-preference-order.walk.mjs）——
// 实验室这份是喂固定夹具的现役组件，真机那份走完整条 IPC + catalog，两边摆一起才答得了
// 「实验室里对，真机里也对吗」。
//
// 用法：node tests/ux/design-lab-vendor-order.walk.mjs   （ONLY=vo-01-picker-preferred 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'vendor-order',
  title: '供应商偏好 ',
  // 与其它屏走查错开端口（agent-panel 5198 / editing 5200）：并行跑时撞端口，
  // --strictPort 会让我们的 vite 退出而连上别人那棵树（walkScreen 起飞前会拦）。
  port: 5201,
  // 舞台 460 宽（vendorOrderLabKit.STAGE_WIDTH）；三列一屏看完七格。
  cellWidth: 460,
  columns: 3,
  assertState: async (page, state, record) => {
    if (!state.id.includes('picker')) return
    const dropdown = page.locator('[data-nomi-select-dropdown]')
    const rows = page.locator('[data-nomi-select-dropdown] [role="option"]')
    const visible = await dropdown.first().isVisible().catch(() => false)
    if (!visible) {
      record(`${state.id} 的下拉没展开——这一格拍到的是一个触发钮，不是要看的浮层`)
      return
    }
    const count = await rows.count()
    const labels = await rows.allInnerTexts()
    if (state.id.includes('empty')) {
      // 空态这一格的承诺很硬：**恰好一行**，而且那一行要说清现状 + 给出路。
      // 只断「有内容」的话，一个真空白下拉也能混过去——那正是这一格要防的形态。
      if (count !== 1 || !labels.join(' ').includes('还没接入供应商')) {
        record(`${state.id} 应当只有一行「还没接入供应商」空态，实际 ${count} 行：${labels.join(' | ')}`)
        return
      }
    } else if (count < 2) {
      record(`${state.id} 展开后只有 ${count} 行选项，夹具没喂进去`)
      return
    }
    // 没接入的家（RunningHub 独家的 Kling 3 / Wan 2.6）必须一行都不出现——夹具喂的是整份目录，
    // 筛掉它们的是生产代码那道闸。这一条红了，说明闸没接上或者又被谁放宽了。
    if (labels.some((label) => /Kling 3|Wan 2\.6/.test(label))) {
      record(`${state.id} 出现了没接入那家才有的模型：${labels.join(' | ')}`)
    }
    // 模型名被 chip 挤到 0 宽正是这次返工的起因：一行只剩图标 + 一排 chip，
    // 用户根本看不出这是哪个模型。宽度断言让它再也回不来。
    const narrowest = await rows.evaluateAll((nodes) => Math.min(...nodes.map((node) => {
      const label = node.querySelector('[data-nomi-select-option-label]')
      return label ? label.getBoundingClientRect().width : 0
    })))
    if (!(narrowest > 24)) {
      record(`${state.id} 有选项的模型名被挤到 ${Math.round(narrowest)}px——chip 不许把主语吃掉`)
    }
    // 浮层必须整个落在舞台里。溢出的部分按元素截图时会被**无声**裁掉，
    // 拍出来是一张「下拉好像就这么短」的图——看着完全正常的假证据。
    const overflow = await page.evaluate((id) => {
      const stage = document.querySelector(`[data-design-lab-shot="${id}"] [data-design-lab-stage]`)
      const panel = document.querySelector('[data-nomi-select-dropdown]')
      if (!stage || !panel) return null
      const a = stage.getBoundingClientRect()
      const b = panel.getBoundingClientRect()
      return { bottom: Math.round(b.bottom - a.bottom), right: Math.round(b.right - a.right) }
    }, state.id)
    if (overflow && (overflow.bottom > 0 || overflow.right > 0)) {
      record(`${state.id} 的下拉溢出舞台（下 ${overflow.bottom}px / 右 ${overflow.right}px），截图会被裁掉；调大 STAGE_HEIGHT/STAGE_WIDTH`)
    }
  },
})
