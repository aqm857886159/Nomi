// 设计实验室 · Agent 面板走查（R13 人眼判断的素材源）。零额度：纯本地渲染，不碰任何生成 API。
//
// 流程住 `design-lab/walkScreen.mjs`——四屏共用一份。以前这份文件里是整段流程，加第二屏时
// 若照抄一份，两份就会各自漂：其中一份悄悄少一条断言，从输出上看不出来。
// 这里只声明这一屏的取景参数。
//
// 用法：node tests/ux/design-lab-agent-panel.walk.mjs   （ONLY=form-06-tool-line 只跑一个）
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'

await walkDesignLabScreen({
  screen: 'agent-panel',
  title: 'Agent 面板',
  role: 'walk-agent-panel',
  // 面板固定 340px 宽（workbenchStore.assistantWidth 默认值）。
  cellWidth: 340,
  columns: 4,
})
