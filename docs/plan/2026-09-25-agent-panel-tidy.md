# Agent 回复代码块 + 任务面板状态对账

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 用户 2026-09-25 两条反馈，一个分支两笔提交。任务面板这一版**只修乱码、状态和重复条目，不重新设计**
> （改成「生成历史」那种页面是下一版的事）。根因合同：
> `docs/fixes/2026-09-25-agent-code-block-skin.root-cause.json`、`docs/fixes/2026-09-25-task-center-state-owner.root-cause.json`。

## 症状与范围

1. **代码块**（「粘贴框设计有问题吧，为什么这么丑」）：Agent 回复里的提示词被套两层带边框的框、右上一颗大复制钮，
   等宽字、长行横向截断。范围：唯一的 Markdown owner `src/workbench/common/NomiMarkdown.tsx`，所有读者一起受益。
2. **任务面板**（「一堆什么东西，太乱了，状态也对不上」）：卡片与行露出 `generation.single-shot`；
   「等待超时 · 可重新拉取」在「已完成」下；一张卡同时说「等待确认 / 供应商长时间没有返回新状态 / 0 / 4 已完成」；
   一张在跑的卡旁边两行「等待开始」。

不动项：任务面板的版式与交互（行、卡、摘要条、刹车横幅）不改；报价卡、画布占位、Agent 面板不改；
主进程的 Run 状态机与 reducer 不改（只改列表投影和 IPC 返回的形状）。

## 先查别人

- Streamdown 官方样式文档 https://github.com/vercel/streamdown/blob/main/apps/website/content/docs/styling.mdx ：
  `data-streamdown` 属性选择器（`code-block` 等）是官方支持的改样式方式——所以代码块的形由 Nomi 经这组钩子自己管，
  不另写渲染器（`docs/engineering/framework-boundaries.json` 的 streamdown 条目禁止第二个 Markdown 解析器）。
- Streamdown 官方组件文档 https://github.com/vercel/streamdown/blob/main/apps/website/content/docs/components.mdx ：
  覆盖 `components` 时保留上游契约（表格要保留 `data-streamdown="table-wrapper"`）。同理，`pre` 适配器保留上游
  「给子元素打 `data-block`」的契约，只多打一个 `data-nomi-code`，代码源与复制仍归上游。
- 已安装的 streamdown 2.6.0 源码：默认 `pre` 只 `cloneElement(child, {"data-block": "true"})`，`MarkdownCode` 把其余 props
  透传给 `CodeBlock`，后者铺到 `code-block-body` 上——`data-nomi-code` 就是这样到达皮肤的，没有并行渲染路径。
  代码块外框 `border + p-2 + gap-2`、标题行、带边框的 body（`p-4`）、带边框+毛玻璃的动作条都来自这里（`docs/fixes/2026-09-25-agent-code-block-skin.root-cause.json` 的 direct_cause 逐条列出）。
- 任务中心原方案 `docs/plan/2026-08-02-task-center-queue.md`：分组/排序/可取消性判定本应「全在纯函数」，
  组件只负责画——本次把后来长回组件里的分组、汇总、标签表收回纯函数，是回到这份方案的初衷，不是新设计。
- 仓内 `electron/productionRun/productionPlaybooks.ts:1` 的注册表先例：「字面量散落多处 ⇒ 加第二个就漏改一处」，
  于是 playbook 名单只有一个真相源。本次对**显示**做同样的事：流程 / 阶段的人话名只从 `productionRunLabels.ts` 取。
- 真实数据：一次真实 Agent 对话走查留下的两份 Run 事件日志（已原样收进 `tests/ux/fixtures/task-center-agent-drafts/`）
  显示 Agent 一段对话留下两份 `plan.state=draft, cardHidden=true` 的草稿——就是截图里那两行「等待开始」。
  同时实测列表 IPC 在服务模式下返回的是完整 Run（带 `jobs`、`generationPlan`），和 `ProductionRunSummary` 类型不符。

## 样张与拍板（2026-09-25）

样张 `docs/design/mockups/2026-09-25-agent-panel-tidy/`（在线：https://claude.ai/artifact/PwZiq9tRTbiZukvAHZ4J17），
用户拍板「设计没问题」，五条全取推荐项：D1-A「等你处理」排最上面、行上常驻「重新拉取」+ 悬停说明「只查结果，不重新生成，不花钱」；
D2-A 顶栏数字计入「等你处理」；D3-A 代码块去掉语言标题行、复制钮 24px 在右上角；D4-A 全部自动换行；D5-A 字体按内容判断。
D3/D4 取代 `docs/plan/2026-09-09-b2e-streamdown.md` 原第 9、55 行（该文已同步改写）。
机器契约：`docs/design/mockups/contracts/2026-09-25-agent-panel-tidy-{task-center,code-block}.intent.mjs`，由两份走查执行。

## 实施

1. 代码块：单层容器、隐藏语言标题、复制钮 24px 幽灵图标钉右上、`pre` 换行不横滚；`codeFenceTypeface` 按
   「围栏语言是否高亮器认得的编程语言 → 否则看内容」判字体，提示词走正文字体、真代码仍等宽。
2. 任务面板：`TASK_CENTER_GROUPS`（进行中 / 等你处理 / 排队中 / 已完成）是唯一分组与顺序；每种任务一个映射
   （生成 `generationRowState`，制作 `STATUS_GROUP` + 视图分支 `group`，导出 `buildExportJobTaskRows`）；
   `summarizeTaskCenterRows` / `orderTaskCenterRows` 由按钮和面板共用；`isProductionRunTask` 判没出价的草稿、丢掉的计划不是任务；
   列表 IPC 两种模式都返回摘要投影（带计划的在场两格）；流程 / 阶段 / 技能证据只经翻译键上屏。

## 回滚与风险

每个问题一笔提交，可单独 revert。风险：徽标现在把「等你处理」也计入数字（等待超时的生成会让按钮亮着直到重新拉取）；
已出价草稿的行仍显示原始模型键（显示名不在本次范围）。详见两份合同的 residual_risks。

## 验收门

- 单测：`codeFenceTypeface.test.ts`、`agentPanelV4MarkdownKernel.test.ts`、`productionRunView.test.ts`、
  `productionRunTaskCenter.test.ts`、`taskCenterEntries.test.ts`、`productionRunRepository.test.ts`、`productionRunIpc.test.ts`。
- 真 app 走查（zh + en，截图亲眼看过）：`tests/ux/agent-code-block.walk.mjs`、`tests/ux/task-center-states.walk.mjs`，
  改前（断言红 = 复现）与改后证据在 `docs/evidence/2026-09-25-agent-panel-tidy/`。
- `pnpm run gates`、`pnpm run review:branch`。
