// 设计实验室 · 供应商偏好屏走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住在 `design-lab/walkScreen.mjs`（各屏共用一份）；这里声明这一屏的取景参数，
// 外加**一条只有这一屏才成立的断言**。
//
// 那条断言是这一屏的命门：要看的东西全在展开后的浮层里（模型名有没有被 chip 挤没、
// 偏好那家排第几、未配置那组沉在哪）。浮层没打开的话，截出来是一个孤零零的触发钮——
// 一张「看着挺正常」的废图，而且和真绿长得一模一样。所以逐格验：
//   · picker 类的格子必须真的有一个展开的下拉，且至少两行选项；
//   · 每一行都必须看得见模型名（宽度 > 0）——这正是 2026-09-06 用户返工时的那个 bug。
//
// 输出与真实 Electron 旅程（vendor-preference-order.walk.mjs）**共用一个目录**，
// 前缀区分：`lab-*` 是实验室里的现役组件，`journey-*` 是真机跑出来的。放一起是为了
// 对账时一眼能比「实验室里长这样、真机里长这样」。
//
// 用法：node tests/ux/design-lab-vendor-order.walk.mjs   （ONLY=vo-01-picker-preferred 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'vendor-order',
  title: '供应商偏好',
  port: 5209,
  outDir: 'tests/ux/shots/vendor-order',
  filePrefix: 'lab-',
  contactName: 'contact.png',
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
    if (count < 2) {
      record(`${state.id} 展开后只有 ${count} 行选项，夹具没喂进去`)
      return
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
      const dropdown = document.querySelector('[data-nomi-select-dropdown]')
      if (!stage || !dropdown) return null
      const a = stage.getBoundingClientRect()
      const b = dropdown.getBoundingClientRect()
      return { bottom: Math.round(b.bottom - a.bottom), right: Math.round(b.right - a.right) }
    }, state.id)
    if (overflow && (overflow.bottom > 0 || overflow.right > 0)) {
      record(`${state.id} 的下拉溢出舞台（下 ${overflow.bottom}px / 右 ${overflow.right}px），截图会被裁掉；调大 STAGE_HEIGHT/STAGE_WIDTH`)
    }
  },
})
