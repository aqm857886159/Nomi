# Agent 面板 v4 设计实验室逐板对账（2026-09-06）

范围是 panel 这一列的真实 React 组件；画布外层（文稿、React Flow、时间轴）属于接线阶段，不在阶段一取景框内。截图目录：`artifacts/design-lab/agent-panel-v4/`。

| 定稿板 | 实验室状态 | 组件逐件核对 | 结果 |
|---|---|---|---|
| Main | `v4-main` | 8 积木顺序、390px 面板、Context 环、composer | 通过 |
| Feasible | `v4-feasible` | 助手中断、收据原位、继续入口 | 通过 |
| Vocabulary | `v4-vocabulary-user` + tool/task/intervention/queue/context states | 用户气泡附件 chip；Tool 7 状态；Task 5 状态；介入槽 8 kind；Queue；Context | 通过 |
| Composer | `v4-composer-*` | + 文件、模型名、Skill、权限三档、运行停止、引用、三种高度、模型/Skill 弹层 | 通过 |
| Process | `v4-process-flow` | 发出→思考→调工具→完成/失败→流式→打断/排队 7 时刻 | 通过 |
| Rendering | `v4-rendering` | 生成中 spinner、视频动作 icon、任务进度 | 通过 |
| Sources | `v4-sources` | 引用 chip、附件语义、失败收据 | 通过 |
| FlowCreation | `v4-flow-creation` | 文稿/技能/规划语义保留在对话流 | 通过 |
| FlowGeneration | `v4-flow-generation` | 图片/视频任务卡与费用、状态尾部 | 通过 |
| FlowPreview | `v4-flow-preview` | 时间轴 timeline icon、可撤销介入槽 | 通过 |
| Collapsed | `v4-collapsed` | 32px rail、Context 环、时间轴/节点图标 | 通过 |
| Dark | `v4-dark` | `data-mantine-color-scheme=dark` token 翻转、对比度与按钮反转 | 通过 |

核对基准：`docs/design/mockups/2026-09-06-agent-panel-v4/src/_agent.css` 的间距/圆角/颜色 token；图标使用 Tabler（时间轴 `IconTimelineEvent`、文稿 `IconFileText`、节点 `IconLayersSubtract`），未使用 robot/sparkles/cpu/hourglass。模型按钮仅显示名称；权限数据属性分别为 `step/safe-auto/project` 与 `confirm/within-budget`；介入槽仅保留「确认 / 不要」和「不再问 →」。

发现并处理的差异：4 处。① 本地 Tabler 聚合表没有 `IconLayers`，改用同一语义的 `IconLayersSubtract`；② Vite 首帧因把翻译函数放在模块级夹具造成空白，改为组件内求值；③ 390px 取景框下引用 chip 造成模型名折行，加入 `shrink-0/whitespace-nowrap/truncate`；④ 暗色气泡沿 token 翻转成浅色，增加暗色专用 `bg-nomi-ink-10`，与定稿一致。修复后重新截图，未保留有出入项。

验证记录：renderer 逐个打开 44 个状态，`window.__designLabReady === true`；人工查看 `v4-main`、`v4-vocabulary-user`、`v4-composer-*`、`v4-process-flow`、`v4-collapsed`、`v4-dark`，页面错误 0。基线截图未更新。

## 现场截图复核（2026-09-06）

- `artifacts/design-lab/agent-panel-v4/manifest.json`：44 个 v4 状态，逐个 `frame=1` 截图，页面错误 0。
- 重点人工查看：`v4-main.png`、`v4-vocabulary-user.png`、`v4-composer-idle.png`、`v4-composer-height-30.png`、`v4-composer-height-scroll.png`、`v4-process-flow.png`、`v4-collapsed.png`、`v4-dark.png`。
- 逐项复核结果：390px 面板（收起坞 32px）、头部 40px、composer 初始 84px、640–800 高度上限 30%、小面板 6 行上限、模型名无图标、权限合同数据属性、Tabler 对象图标、介入槽仅确认/不要、不再问仅可撤销态、暗色 token 翻转，均通过。
- 有出入：0（此前 4 处差异已在首版提交中处理；本轮修正了 composer 被内容撑高、介入槽多余取消按钮、收起坞宽度和夹具硬编码文案）。
