// 设计实验室 · primitive 陈列 · 表单族走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与其它屏共用一份）；这里声明这一屏的取景参数，
// 外加**一条只有这一屏才成立的断言**。
//
// 那条断言防的是这一屏的两处命门：
//
// ① 下拉的展开态（`pf-08` / `pf-09`）。展开是取景台在首帧之后**真的点一下触发钮**得到的
//    （`primitivesLabKit.OpenPopoverStage`）。那一下要是没落地——触发钮的选择器变了、
//    portalTarget 没接上、组件早退——截出来只是一颗孤零零的触发 pill，和收起态那格
//    （`pf-07`）**看不出区别**。而 `NomiSelect` 非 searchable 时 `keepMounted` 是开的：
//    下拉的 DOM 一直在，只是 display:none——所以判据必须是「可见」，不是「存在」。
//    `pf-09` 还多一条：searchable 那格得真有一个能打字的搜索框，否则它和 `pf-08` 也就没区别了。
//    反过来 `pf-07` 必须是**收起**的：它许诺的是触发 pill 的形态矩阵，一旦某格自己弹开了，
//    要看的 pill 就被自己的浮层盖住了。
//
// ② 四态里的报错与禁用（`pf-01`…`pf-05`）。「报错」在截图上只是输入框下面多一行小字 +
//    描边变红；error prop 要是没透下去，这一格和默认态长得极像。所以按 `aria-invalid`
//    和 `disabled` 逐格数——那是组件自陈的状态，不是我们照着截图猜的。
//
// 产出：`tests/ux/shots/design-lab-primitives-forms/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 用法：node tests/ux/design-lab-primitives-forms.walk.mjs （ONLY=pf-08-nomi-select-open 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

/**
 * 每一格许诺自己停在什么形态。
 * `dropdown`: 'open' = 必须有一个可见的展开浮层且有选项；'closed' = 必须没有可见浮层。
 * `search`: 展开态里有没有那个能打字的搜索框。
 * `invalid` / `disabled`: 这一格里处于报错态 / 禁用态的表单件个数。
 */
//
// 2026-09-07 全表重算：这一屏的夹具按**真实调用点**重写了（见
// `src/devlab/designLab/primitivesForms/states/01-inputs.tsx` 头注）。下面每个数字都跟着变，
// 而每一处变化都对应一条「生产里本来就没有那种形态」的结论——不是把断言改松以迁就实现：
//   · `disabled` 普遍降到 0：真实调用点里禁用的输入框极少，而**禁用的开关仍绑着活数据**
//     （禁的是操作不是数据），旧夹具那种 `checked readOnly disabled` 组合生产零实例。
//   · `invalid` 普遍升到 2：本仓有**两套并存**的报错约定（error 传字符串 / 传 boolean），
//     两套各摆一格才叫把现状摆出来——这是生产侧的债，不是夹具的错。
//   · `pf-02` 的禁用数从 3 变 0：那 3 个里有 2 个是 NumberInput 的加减步进钮，
//     而 **5/5** 真实调用点都 `hideControls`——那两颗钮在生产里根本不存在。
//   · `pf-06` 从 2 变 0：旧夹具给比例选项编了个 `disabled: 4:3`，生产从不禁用比例档。
//   · `pf-08` 的 minOptions 从 5 变 4：候选换成 `buildModelSelectOptions` 真吐的四行
//     （含带供应商 chip 的行），旧那 5 行里有一行是编出来的「未接入（灰行）」。
// `pf-04` 那条登记随组件删除一并删掉：它认领的是一个已经不存在的格。
const EXPECTED = {
  // ② error=字符串 与 ③ error=boolean 各一个 → 2 个报错态；禁用输入框在真实调用点里没有。
  'pf-01-text-input-four-states': { dropdown: 'closed', invalid: 2, disabled: 0 },
  // Textarea（autosize 关那格）+ NumberInput（最大值那格）各带一个 boolean 报错。
  // 步进钮已被 `hideControls` 去掉，所以禁用数是 0 而不是旧表的 3。
  'pf-02-textarea-number': { dropdown: 'closed', invalid: 2, disabled: 0 },
  // 只有「截图快捷键」那颗开关是禁用的；两个 Checkbox 是 readOnly 的装饰对勾，不算禁用。
  'pf-03-switch-checkbox': { dropdown: 'closed', invalid: 0, disabled: 1 },
  'pf-05-search-input': { dropdown: 'closed', invalid: 0, disabled: 0 },
  // 三条分段控件都没有禁用档：比例组、设置页三档、接入向导三档，生产里都不禁用选项。
  'pf-06-segmented-controls': { dropdown: 'closed', invalid: 0, disabled: 0 },
  'pf-07-nomi-select-triggers': { dropdown: 'closed', invalid: 0, disabled: 1 },
  'pf-08-nomi-select-open': { dropdown: 'open', search: false, minOptions: 4, invalid: 0, disabled: 0 },
  'pf-09-nomi-select-searchable': { dropdown: 'open', search: true, minOptions: 5, invalid: 0, disabled: 0 },
}

await walkDesignLabScreen({
  screen: 'primitives-forms',
  title: 'primitive 陈列 · 表单族',
  // 端口按 worktree + 角色派生（design-lab/labServer.mjs）：写死端口在这台常年 20+ worktree
  // 的机器上一定会撞，撞了截回来的是别人分支的 UI。
  role: 'walk-primitives-forms',
  // 舞台 480 宽（primitivesLabKit.PRIMITIVE_STAGE_WIDTH）；三列一屏看完九格。
  cellWidth: 480,
  columns: 3,
  assertState: async (page, state, record) => {
    const expected = EXPECTED[state.id]
    // 新加了一格却没在上面认领自己停在什么形态 → 当场说出来，别让这一格无人验证地混进接触表。
    if (!expected) {
      record(`${state.id} 没有在 EXPECTED 里认领自己停在什么形态——补上它，别让这一格无人验证`)
      return
    }

    // ① 展开态。`keepMounted` 让收起的下拉也留在 DOM 里，所以只认**可见**的那一个。
    const dropdown = page.locator('[data-nomi-select-dropdown]:visible')
    const openCount = await dropdown.count()
    if (expected.dropdown === 'open') {
      if (openCount !== 1) {
        record(`${state.id} 应当有 1 个展开的下拉，实际 ${openCount} 个——自动点击那一步没落地，截的是一颗触发钮`)
        return
      }
      const options = dropdown.first().locator('[role="option"]')
      const optionCount = await options.count()
      if (optionCount < expected.minOptions) {
        record(`${state.id} 展开后只有 ${optionCount} 行选项（许诺 ≥ ${expected.minOptions}）——夹具没喂进去`)
      }
      // 选中行的对勾/加粗是这一格许诺要看的东西之一；一行都没选中说明 value 没接上。
      const selected = await options.evaluateAll((nodes) => nodes.filter((node) => node.getAttribute('aria-selected') === 'true'
        || node.dataset.checked === 'true'
        || node.querySelector('[data-nomi-select-option-label]')?.className.includes('font-semibold')).length)
      if (selected < 1) {
        record(`${state.id} 展开后没有任何一行是选中态——受控 value 没接上，「选中长什么样」这一格就白截了`)
      }
      const search = dropdown.first().locator('input:not([type="hidden"])')
      const hasSearch = (await search.count()) > 0 && await search.first().isVisible().catch(() => false)
      if (hasSearch !== expected.search) {
        record(`${state.id} 许诺搜索框 ${expected.search ? '有' : '没有'}，实际 ${hasSearch ? '有' : '没有'}——searchable 那条轴没生效`)
      } else if (hasSearch && await search.first().isDisabled().catch(() => true)) {
        record(`${state.id} 的搜索框打不了字——长枚举那条路走不通，这一格只是张图`)
      }
    } else if (openCount !== 0) {
      record(`${state.id} 不该有展开的浮层，却有 ${openCount} 个——要看的收起态被自己的下拉盖住了`)
    }

    // ② 报错 / 禁用两态。按组件自陈的属性数，不按截图猜。
    const seen = await page.evaluate((shotId) => {
      const stage = document.querySelector(`[data-design-lab-shot="${shotId}"]`)
      if (!stage) return null
      const fields = [...stage.querySelectorAll('input, textarea, select, button')]
      return {
        fields: fields.length,
        invalid: fields.filter((node) => node.getAttribute('aria-invalid') === 'true').length,
        disabled: fields.filter((node) => node.disabled || node.getAttribute('aria-disabled') === 'true').length,
      }
    }, state.id)
    if (!seen) {
      record(`${state.id} 的舞台不在 DOM 里——这一格截的不是它自己`)
      return
    }
    if (seen.fields === 0) {
      record(`${state.id} 舞台里一个表单件都没有——这一格是空的`)
      return
    }
    if (seen.invalid !== expected.invalid) {
      record(`${state.id} 许诺 ${expected.invalid} 个报错态，实际 ${seen.invalid} 个——error 没透下去，截的和默认态一样`)
    }
    if (seen.disabled !== expected.disabled) {
      record(`${state.id} 许诺 ${expected.disabled} 个禁用态，实际 ${seen.disabled} 个——disabled 没透下去或多禁了`)
    }
  },
})
