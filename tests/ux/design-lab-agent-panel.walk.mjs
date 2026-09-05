// 设计实验室 · Agent 面板走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住在 `design-lab/walkScreen.mjs`（各屏共用一份）；这里只声明这一屏的取景参数。
//
// 用法：node tests/ux/design-lab-agent-panel.walk.mjs   （ONLY=form-06-tool-line 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'agent-panel',
  title: 'Agent 面板',
  port: 5198,
  outDir: 'tests/ux/shots/design-lab-agent-panel',
  // 面板固定 340px 宽（workbenchStore.assistantWidth 默认值）；四列刚好一屏看完。
  cellWidth: 340,
  columns: 4,
})
