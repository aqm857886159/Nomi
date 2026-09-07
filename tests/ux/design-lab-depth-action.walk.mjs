// 设计实验室 · 画布「提取深度」走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`（与另几屏共用一份）；这里只声明这一屏的取景参数。
// 产出：`tests/ux/shots/design-lab-depth-action/<state>.png` + `_contact-sheet.png`（拍板用）。
//
// 十格要看的是同一条动线的五个时刻各来一遍光暗：选中视频时这个动作找不找得到、点开之后
// 是不是真的只问了一个问题、第一次要下 47MB 时那句话说不说人话、跑起来时用户看不看得出
// 「它在看的是我那段片子」、跑完之后它像不像一个普通视频节点。
// 接触表排两列，所以每一行正好是同一态的光/暗一对，明暗差异一眼可比。
//
// 用法: node tests/ux/design-lab-depth-action.walk.mjs
//      （ONLY=depth-action-02-panel 只跑一个；ONLY 非空时不出接触表）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'depth-action',
  title: '画布 · 提取深度',
  role: 'walk-depth-action',
  cellWidth: 800,
  columns: 2,
})
