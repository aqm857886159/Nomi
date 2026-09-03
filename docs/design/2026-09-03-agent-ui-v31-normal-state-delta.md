# Agent 面板 v3.1 正常态差异清单

> 日期：2026-09-03 · 范围：交互 epic 件 1.5，Agent 右栏正常态（空态、已有对话、输入与常驻 chrome）。
> 依据：`docs/design/mockups/2026-09-01-agent-ui-final-redesign.html` 的屏 A/D、`2026-09-01-agent-ui-final-redesign.md`、`2026-09-02-agent-ui-v3-walkthrough.md`，以及改前真机 `/tmp/agent-real.png`。

## 改前证据

- 改前真机已用真实 Electron fixture 截图并检查：`/tmp/agent-real.png`。面板仍是旧版三行 chrome，项目名显示为 `No...`；头部显示 `本轮 0 · 累计 0 tokens`；第二行显示 `当前现场 · 画布 · 0 个对象已选`；底栏是 7 个按钮挤在一行；空态仍是「从这里开始」大块居中提示。
- 改前一致性断言：通过 45；真差距 14；状态未驱达 10。红灯中的视觉差距包括 A-02 用量文案、A-06 用户气泡高度、A-10 回复高度、A-13 撤销入口、A-18 `@` token、A-20 未选模型提示，以及 B/D 工件挂点缺失。

## 逐条对照

| # | 样张要什么 | 现役给了什么 | 数据从哪来 / 实施去向 |
|---|---|---|---|
| 1 | 头部一行，只留 Nomi、用量胶囊、历史、收起；不放线程名。 | 三段头部信息：Nomi + 线程标题、用量文字、费用文字，右侧历史/收起。 | `activeThread.title`、`lastTurnTokens`、`sessionTotalTokens`、`costLabel`；渲染拆到 `resident/ResidentPanelHeader.tsx`，线程标题和费用仅进 title/悬停明细。 |
| 2 | 用量胶囊写「还能聊 ~N 轮」，悬停再看本轮/累计/费用；UI 禁用 `tokens`。 | `usageCompact` 直接显示「本轮 N · 累计 N tokens」。 | `lastTurnTokens`、`sessionTotalTokens`、`agentUsageStore`；增加用户可懂的剩余轮数推导，详情仍用现有用量与费用数据。 |
| 3 | 删除「当前现场」整行 chrome；Agent 住在对话里。 | 独立上下文行含「当前现场 · 画布 · N 个对象已选」和定位按钮。 | `surface`、选中节点/片段只继续进入发送快照；`focusContext` 保留给对话内回执/上下文动作，不再常驻占一行。 |
| 4 | 正常态会话流底部锚定、可滚动；空态只留轻量提示，不抢主体。 | 流容器已有滚动/回到底部，但空态是较重的居中标题与描述。 | `items`、`activeTurn`、`showLatest`、`scrollToLatest`；`ResidentTranscript` 重写空态和条目布局。 |
| 5 | 用户消息是深色右对齐气泡，符合样张密度；回复是短文本行。 | 用户消息左边距加深色块，回复使用较大的 `text-caption` 与 padding，真机分别为 32px/40px，偏离样张 52px/19px 目标。 | `ProjectAgentItem.kind=user/assistant` 与 `item.text/status`；仅换布局 class，不动 snapshot 或流式逻辑。 |
| 6 | 思考、技能载入、工具、阶段、压缩都进对话流，一行式、可渐进展开；不另立面板。 | 已有 `skillEvents`、`ResidentThinkingState`、`ResidentToolChips`，但 JSX 顺序和 spacing 仍是旧外壳，部分状态只在驱动后出现。 | `skillEvents`、`planningTurn`、`toolChipItems`、`items`；由 `ResidentTranscript` 统一排序和一行样式，保留既有 primitives。未驱达的状态不造 fixture。 |
| 7 | 事件文案只说用户能行动/理解的内容；禁用 `当前现场`、`tokens`、`节点`、`原位`、`id`。 | 头部/上下文行仍有 `当前现场`、`tokens`；任务/产物文案可能经过 `itemRef()` 暴露内部标识。 | 现有 i18n key `currentScene`、`usageCompact`、`task/artifact`；正常态本件替换可见 chrome 文案，异常/任务卡继续使用已有人话 key，逐项扫 UI 文案。 |
| 8 | 排队消息贴 composer 上沿，浅色一行，右侧 `×` 撤回；不做独立队列卡。 | `ResidentTaskRows` 位于 composer 顶部，带队列区标题和多项任务动作。 | `activeQueue`、`runQueueMutation`、`stopTurn`、`editingQueue`；拆出 `ResidentQueueRow`，保留编辑/暂停/移动等能力进 hover/二级菜单，L1 只显示消息行。 |
| 9 | composer 无常驻引用架；`@` 作为唯一引用手势，选中引用成为句中 token。 | 引用/技能/提示词分别在输入框上方持久显示为一整排 chip；底排另有 `@` 引用按钮。 | `references`、`activeSkill`、`selectedLibraryPrompt`、`addReference/removeReference`；底排移除 `@`，保留引用状态在输入内容/架内的最小呈现，引用菜单通过 `@`/L3 到达。 |
| 10 | 底栏固定 5 簇：附件、执行方式、文本模型、提示词、发送；每枚约 32×32 方形 icon，hover/title 给全义。 | 底栏有附件、引用、技能、提示词、模式、授权、模型、发送 8 个交互点（旧真机视觉上为 7 个配置 icon + 发送）。 | 现有 handlers 和菜单全部保留；`attachments`、`skills`、`prompts`、`modes`、`models`、`policy` 按 §1.5 收到五簇：技能归入执行方式菜单，授权归入执行方式菜单，引用走 `@`。 |
| 11 | 未选文本模型时，机器人 icon 右上角一个红点；不摆常驻解释句。 | 模型入口无注意态；模型缺失只在模型菜单/后续执行时暴露。 | `selectedModel`、`models`、`selectedModelRow`；新增 `data-agent-model-alert` 红点和可访问 title，仍由模型菜单打开目录。 |
| 12 | icon 语义用 Tabler 图标：附件、闪电/执行方式、机器人、铅笔、向上发送。 | 现有图标是合理的，但模式/授权/技能/引用各自单独占位，形成拥挤长排。 | `IconPaperclip/IconBolt(或现有等价)/IconRobot/IconPencil/IconArrowUp`；只改布局和归组，不引入 emoji 或新图标库。 |
| 13 | 输入框占位短而具体：「继续告诉 Nomi 要改什么… 输入 @ 可以引素材或技能」；空态不堆说明。 | 占位只有「继续告诉 Nomi 要改什么…」，说明 `@` 的入口缺失。 | `agentResident.placeholder`；补中英 i18n，`AutoGrowTextarea` 继续作为唯一输入真相源。 |
| 14 | 回复内的写入回执带右侧撤销 icon；有风险时才出现文字确认卡。 | 回执只有「已批准」/定位动作，撤销只在画布撤销，不渲染 `data-agent-receipt-undo`。 | `item.kind=proposal/status=done`、`focusReceipt`；在回执行补 icon/title，handler 仍走现有画布撤销事件/命令边界，不删确认卡。 |
| 15 | v3.1 固定结果工件默认是一根细条「拆解结果 · N 镜 · 已选 N ▾」，点开才展开表格。 | Agent 面板没有 `data-agent-pinned-card`；拆解/批量工件仍在 canvas overlay 或其它系统。 | 当前 snapshot 的 `artifact/task` 只提供导航信息，没有可复用分镜行数据；本件先给结果区结构与挂点的安全占位，完整拆解表数据继续由既有 canvas/production owner 提供，不在这里造第二份真相源。 |
| 16 | 外壳仍是右侧 in-flow 面板，宽度由 `assistantWidth`，不遮挡主内容；收起为顶栏角标。 | 外壳位置由上层 Workbench 控制，收起按钮已有，但内部 UI 仍按旧三行布局。 | `collapsed`/`setCollapsed` 和上层 layout 保留；本件只替换内层 render，不改右槽定位或宽度 owner。 |
| 17 | 所有现有功能仍可达：附件格式、语音、技能库、提示词库、模式三档、授权/费用、模型选择、队列编辑与停止。 | 功能均已由外壳接线，但入口数量挤压正常态。 | 41 组现有 import/hook/回调继续保留；拆分组件只接收 callback/data props，菜单与确认协议不改。 |

## 实施边界与验收

- 本轮整体 render 替换后外壳为 734 行，仍低于 800 行门槛，因此不为形式拆出新的并行外壳；可复用的审批、工具、引用、输入 primitives 继续留在 `resident/*` 与 `composer/*`。若后续增加状态，优先按 header/transcript/composer presentation 拆分，不复制 store/Host 管道。
- 这是视觉/交互替换，不改断言器、不放宽尺寸容差、不伪造未驱达状态。已有 `ResidentUiPrimitives`、store、Host commands、附件/Skill/Prompt/Model API 继续作为唯一数据和行为来源。
- 必须补齐前后真机截图与暗色截图，并用人眼对照样张；最终报告分别列出一致性断言的通过数、真差距数、状态未驱达数，及仍未驱达的状态原因。
