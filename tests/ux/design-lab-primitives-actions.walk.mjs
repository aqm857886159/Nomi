// 设计实验室 · primitive 陈列 · 动作族走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与其它屏共用一份）；这里声明这一屏的取景参数，
// 外加**一条只有这一屏才成立的断言**。
//
// 那条断言是这一屏的命门：忙态那两格（`pa-02` / `pa-06`）和它们旁边的默认态在缩略图上
// 几乎一样——同一排按钮，只差左边多一颗 14px 的品牌 N 转圈（`NomiLoadingMark`）。
// `loading` 要是没生效（prop 被 Mantine 的 `loading={false}` 吃掉、转圈件被换成别的 spinner、
// 组件签名改了名），截出来就是一张**默认态**的图；人眼扫接触表挑不出来，走查也照样绿。
// 所以逐格验组件自陈的两件事：转圈标的个数，和「忙 = 自动禁用 + aria-busy」这条承诺
// （`src/design/actions.tsx`：三个按钮件都写着 `disabled={disabled || loading}`）。
//
// 反过来的一半同样重要：非忙态的格子必须**一颗转圈都没有**。少了这一半，
// 「哪一格都在转」和「该转的在转」在断言上分不出来。
//
// 产出：`tests/ux/shots/design-lab-primitives-actions/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 用法：node tests/ux/design-lab-primitives-actions.walk.mjs （ONLY=pa-02-workbench-button-busy 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

/**
 * 每一格许诺自己画了什么。
 * `busy` = 这一格里处在忙态的按钮数（转圈标数 === 它，且每一颗都必须 disabled + aria-busy）。
 * `minButtons` = 这一格至少要有几颗按钮——防「整格塌成半排」这种一眼看不出的缺样本。
 */
//
// 2026-09-07 全表重算：这一屏的夹具按**真实调用点**重写了（见两份 states 文件的头注）。
// 每个数字变小的地方，都对应一条「生产里本来就没有那种组合」的结论，不是把断言改松：
//   · `pa-01` 8→7：`accent` 全仓只有一个调用点（sm + shrink-0），md 那颗是编出来的；
//   · `pa-03` 9→8：md 裸态那排删了——42 个真实调用点里 40 个用 className 改尺寸，
//     组件的默认尺寸在生产里几乎没活过，摆一颗当对照就够；
//   · `pa-05` 7→6：`outline` 全仓零调用，删掉；
//   · `pa-06` 5→4：真实 loading 恒配 disabled，两对足够，不再摆裸 loading；
//   · `pa-07` busy 1→0：`IconActionButton` 的 13 个真实调用点里**没有一个**传 `loading`。
//     忙态那一格是编出来的，删了它——于是这一屏的 NomiLoadingMark 也应当是 0 个。
const EXPECTED = {
  'pa-01-workbench-button-matrix': { busy: 0, minButtons: 7 },
  'pa-02-workbench-button-busy': { busy: 3, minButtons: 7 },
  'pa-03-workbench-icon-button': { busy: 0, minButtons: 8 },
  'pa-04-action-card': { busy: 0, minButtons: 3 },
  'pa-05-design-button-variants': { busy: 0, minButtons: 6 },
  'pa-06-design-button-busy': { busy: 2, minButtons: 4 },
  'pa-07-icon-action-button': { busy: 0, minButtons: 5 },
  'pa-08-design-button-sizes': { busy: 0, minButtons: 6, heights: [28, 28, 32, 32, 36, 36] },
}

await walkDesignLabScreen({
  screen: 'primitives-actions',
  title: 'primitive 陈列 · 动作族',
  // 端口按 worktree + 角色派生（design-lab/labServer.mjs）：写死端口在这台常年 20+ worktree
  // 的机器上一定会撞，撞了截回来的是别人分支的 UI。
  role: 'walk-primitives-actions',
  // 舞台 480 宽（primitivesLabKit.PRIMITIVE_STAGE_WIDTH）；三列一屏看完七格。
  cellWidth: 480,
  columns: 3,
  assertState: async (page, state, record) => {
    const expected = EXPECTED[state.id]
    // 新加了一格却没在上面认领自己画了什么 → 当场说出来，别让这一格无人验证地混进接触表。
    if (!expected) {
      record(`${state.id} 没有在 EXPECTED 里认领自己画了什么——补上它，别让这一格无人验证`)
      return
    }
    const seen = await page.evaluate((shotId) => {
      const stage = document.querySelector(`[data-design-lab-shot="${shotId}"]`)
      if (!stage) return null
      const buttons = [...stage.querySelectorAll('button')]
      const busy = buttons.filter((node) => node.getAttribute('aria-busy') === 'true')
      return {
        buttons: buttons.length,
        heights: buttons.map((node) => node.getBoundingClientRect().height),
        marks: stage.querySelectorAll('.nomi-loading-mark').length,
        busy: busy.length,
        // 忙态没自动禁用 = 用户能在生成中再点一次；这条承诺住在组件里，只有这里看得见。
        busyNotDisabled: busy.filter((node) => !node.disabled).length,
      }
    }, state.id)
    if (!seen) {
      record(`${state.id} 的舞台不在 DOM 里——这一格截的不是它自己`)
      return
    }
    if (seen.buttons < expected.minButtons) {
      record(`${state.id} 只有 ${seen.buttons} 颗按钮（许诺 ≥ ${expected.minButtons}）——样本没画全`)
    }
    if (expected.heights && (
      seen.heights.length !== expected.heights.length
      || seen.heights.some((height, index) => Math.abs(height - expected.heights[index]) > 0.5)
    )) {
      record(`${state.id} 按钮高度 ${seen.heights.join('/')}，许诺 ${expected.heights.join('/')}——size 三档必须真实生效`)
    }
    if (seen.busy !== expected.busy) {
      record(`${state.id} 许诺 ${expected.busy} 颗忙态按钮，实际 ${seen.busy} 颗——loading 没生效，截的是默认态`)
    }
    // 转圈标必须与忙态按钮一一对应：数目对不上就是「忙态换了别的 spinner」或「转了两颗」。
    if (seen.marks !== expected.busy) {
      record(`${state.id} 有 ${seen.marks} 个 NomiLoadingMark，许诺 ${expected.busy} 个——品牌转圈件被换掉或漏渲`)
    }
    if (seen.busyNotDisabled > 0) {
      record(`${state.id} 有 ${seen.busyNotDisabled} 颗忙态按钮还点得动——loading 必须自动禁用（actions.tsx 的承诺）`)
    }
  },
})
