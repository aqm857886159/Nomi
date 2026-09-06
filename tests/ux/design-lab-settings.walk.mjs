// 设计实验室 · 设置「隐私与诊断」走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与其它屏共用一份）；这里声明这一屏的取景参数，
// 外加**一条只有这一屏才成立的断言**。
//
// 那条断言是这一屏的命门：四格里有三格靠「挂载后自动点一次导出」把组件推到目标状态
// （settingsLabKit.SettingsStage 的 autoExport）。那一次点击要是没落地——按钮换了结构、
// 桥没装上、结果行还没回来——截出来的是一张**默认态**的图。而默认态和目标态在这一格里
// 长得极像（同一块面板，只差按钮下面那一行小字），人眼扫接触表根本挑不出来，
// 和真绿一模一样。所以逐格验：组件自陈的 `data-diagnostics-state` 必须就是这一格许诺的那个。
//
// 产出：`tests/ux/shots/design-lab-settings/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 用法：node tests/ux/design-lab-settings.walk.mjs   （ONLY=privacy-03-saved 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

/** 每一格许诺自己停在哪个状态。id → 组件自陈的 `data-diagnostics-state`。 */
const EXPECTED_STATE = {
  'privacy-01-idle': 'idle',
  'privacy-02-exporting': 'exporting',
  'privacy-03-saved': 'saved',
  'privacy-04-failed': 'failed',
}

await walkDesignLabScreen({
  screen: 'settings',
  title: '设置 · 隐私与诊断 ',
  // 端口按 worktree + 角色派生（design-lab/labServer.mjs）：写死端口在这台常年 20+ worktree
  // 的机器上一定会撞，撞了截回来的是别人分支的 UI。
  role: 'walk-settings',
  // 舞台 516 宽（settingsLabKit.SETTINGS_CELL_WIDTH）；两列一屏看完四格。
  cellWidth: 516,
  columns: 2,
  assertState: async (page, state, record) => {
    const expected = EXPECTED_STATE[state.id]
    // 新加了一格却没在上面认领 → 当场说出来，而不是安静地放它过去（那就又多一格没人验的图）。
    if (!expected) {
      record(`${state.id} 没有在 EXPECTED_STATE 里认领自己停在哪个状态——补上它，别让这一格无人验证`)
      return
    }
    const section = page.locator('[data-settings-section="diagnostics"]')
    if (!(await section.count())) {
      record(`${state.id} 里根本没有诊断区块——桥没装上或组件早退了，这一格截的是半张面板`)
      return
    }
    const actual = await section.first().getAttribute('data-diagnostics-state')
    if (actual !== expected) {
      record(`${state.id} 许诺停在「${expected}」，实际是「${actual}」——自动点击那一步没落地，截的是另一个状态`)
      return
    }
    // 三个结果态还要真的有那一行字：状态属性对了但结果行没渲出来，图上仍然什么都看不出。
    if (expected !== 'idle' && expected !== 'exporting' && !(await page.locator('[data-diagnostics-result]').count())) {
      record(`${state.id} 是结果态却没有结果行，拍板时看不到「导出了什么」`)
    }
  },
})
