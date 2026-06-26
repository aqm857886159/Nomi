# Agent 对话返回渲染面 UX 体检（2026-06-23）

> 触发：用户截图「查看步骤 / 整笔撤销」按钮被挤成竖排，要求修按钮 + 系统排查「两个 agent 在对话里返回的东西怎么返回」是否还有同类体验问题。
> 范围（区别于同日 whole-app 体检）：**两个 agent（创作助手 `CreationAiPanel` + 生成助手 `CanvasAssistantPanel`）在对话里「返回内容」的渲染面**——气泡 / markdown / 工具结果卡 / 计划卡 / 对账卡 / token 统计行 / 错误透传 / 空态 / 流式态。
> 方法：3 路并行只读 Explore（生成侧返回链 / 创作侧返回链 / 共享渲染层 `src/workbench/ai/`），同一把 8 类尺子。

## 一句话

竖排按钮已修（根因=`WorkbenchButton` 底座缺 `whitespace-nowrap` + 卡片把长文本+多按钮挤一行，已治本，见 9d59383）。**这一面最该先动的不是按钮，是「错误透传」整条断裂**：生成侧错误根本没被识别成错误（按普通回复渲染、还带「复制」），创作侧错误上下显示两遍、都不是红色语气、都甩原始 `error.message` 绕过 narrate 人话层。

## 好消息（P1 守住）

两个 agent 的核心发言**确实共用** `AssistantMessageView` / `UserMessageBubble` / `NomiMarkdown`（[CreationAiPanel.tsx:567](src/workbench/creation/CreationAiPanel.tsx) 与 [AssistantTimeline.tsx:177](src/workbench/generationCanvas/components/AssistantTimeline.tsx) 同组件、同身份行、同 markdown、同三点流式、同 token 行）——**没有并行版**，问题集中在外围「状态/错误/token/卡片」的接缝。共享渲染层本身瘦且健康（`AssistantMessageView` 122 行、`NomiMarkdown` 87 行）。

---

## 四档分诊

### 🟢 A 卫生清理（低风险，可直接做）

| # | 问题 | 证据 | 频率/影响 | 状态 |
|---|---|---|---|---|
| **A1** | 🔴**生成侧错误永不被识别成错误**：catch 写 `生成区 Agent 执行失败：…` 并置 `status:'error'`，但渲染层 `isError` 靠 `content.startsWith('（错误）')` 判定→永不命中。`status` 字段（真相源）没被读。错误按普通回复渲染、还带「复制/重发」 | [CanvasAssistantPanel.tsx:492/495](src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx) ↔ [AssistantTimeline.tsx:182](src/workbench/generationCanvas/components/AssistantTimeline.tsx) | 高（任何失败都走）| ✅ 本轮修 |
| A2 | 计划卡参数 chip 的 `▾` 是假下拉：暗示可点开改选项，但 `PendingChip` 无任何 onClick（注释自承「下一步」未完工）| [AgentPlanCard.tsx:65](src/workbench/generationCanvas/components/AgentPlanCard.tsx) | 高（每个带 modelKey 的节点都显）| ✅ 本轮删 ▾ |
| A3 | `cancelled` 态画布侧永远到不了：共享组件支持「已停止」第三态，创作侧传了、画布侧 `renderAssistantMessage` 不传 | [AssistantTimeline.tsx:177-185](src/workbench/generationCanvas/components/AssistantTimeline.tsx) | 长尾 | ✅ 本轮顺手补（随 A1 一起读 status）|
| A4 | 计划卡确认条无 `flex-wrap`/`shrink-0`：底座 nowrap 已挡竖排，但极窄列宽仍可能整行溢出（同我刚修 committed/deviation 的几何）| [AgentPlanCard.tsx:335](src/workbench/generationCanvas/components/AgentPlanCard.tsx) | 高（主路）| ✅ 本轮修 |
| A5 | `replyActionClassName` 死码 prop：两调用点各传一个类名（`workbench-creation-ai__reply-action` / `generation-canvas-v2-assistant__reply-action`），全仓 CSS 零命中、父行无 group-hover→按钮恒常显，prop 名实不符 | [AiReplyActionButton.tsx:64](src/workbench/ai/AiReplyActionButton.tsx)、[AssistantMessageView.tsx:53](src/workbench/ai/AssistantMessageView.tsx) | 高（每条 done 消息）| ⬜ 待核实运行时注入后删/实现 |
| A6 | 计划外单工具卡漏原始 id 给用户：connect 拼 `sourceClientId → targetClientId`、delete/run `nodeIds.join`、set_prompt `节点 {nodeId}`，违 toolCallSummary 头注「只显人话」| [toolCallSummary.ts:35/132-152](src/workbench/generationCanvas/components/toolCallSummary.ts) | 中（计划外零散动作）| ⬜ |
| A7 | 计划卡确认/拒绝手搓 className 覆写而非走 variant（同种确认动作一处 variant 一处手搓）| [AgentPlanCard.tsx:336-352](src/workbench/generationCanvas/components/AgentPlanCard.tsx) | 高 | ⬜（A4 时顺手收一半，变 variant 留待视觉核）|
| A8 | 撤销/确认文案不统一：「整笔撤销」/「撤销这次改动」/「仍要撤销」三种叫法；「确认」vs「确认全部」、「拒绝」vs「全部拒绝」| CommittedProposalCard / ReconcileDeviationCard / AgentPlanCard | 高（同面）| ⬜ |
| A9 | `pendingLabel` 撞车：`AssistantMessageView` 内置 `label="处理中"` + 画布侧又传 `pendingLabel='处理中'`，可能「处理中处理中」双显（待核实 loading mark 是否真渲染文字）| [AssistantMessageView.tsx:77-78](src/workbench/ai/AssistantMessageView.tsx)、[AssistantTimeline.tsx:181](src/workbench/generationCanvas/components/AssistantTimeline.tsx) | 中 | ⬜ |

### 🔵 B 产品取舍（出样张拍板）

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| **B1** | 🔴**错误透传整体重设计**：①错误气泡无红色/danger 视觉语气，和正常回复仅差开头三字（`isError` 唯一作用是隐藏复制按钮）②创作侧一次 catch 同时 `setError`（底部红 banner）+ 写 `（错误）` 进气泡→同错误上下两遍、文案不同源 ③两侧都裸贴 `error.message` 绕过 narrate 七段人话词表（生成域已治理，对话域漏网，违 narrate「字面量必拒」铁律）| [AssistantMessageView.tsx:81/90](src/workbench/ai/AssistantMessageView.tsx)、[CreationAiPanel.tsx:211/402-405](src/workbench/creation/CreationAiPanel.tsx)、[narrate.ts:58-72](src/workbench/observability/narrate.ts) | 高（最伤信任）|
| B2 | token 统计行降噪：「本轮 ~Xk tokens · 缓存命中 N%」对视频创作用户零行动价值（开发者/计费概念），代码自承是 S7 前过渡债；且创作侧只填 totalTokens→永远不显缓存命中%（与生成侧不对等）| [narrate.ts:78-85](src/workbench/observability/narrate.ts)、[AssistantMessageView.tsx:93](src/workbench/ai/AssistantMessageView.tsx)、[CreationAiPanel.tsx:396](src/workbench/creation/CreationAiPanel.tsx) | 高（每条消息常驻一行噪音）|
| B3 | 返回面之上两条折叠条占首屏：`AssistantToolsFold`（列 6 个工具名=开发者黑话）+ `MemoryFold` 恒占顶部高度，把对话/卡片往下挤（~300px 窄面板）| [CanvasAssistantPanel.tsx:641-642](src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx) | 中（窄面板首屏）|

### 🟡 C 字段收纳

（本面无独立 C 项；token 行/工具折叠条的"收纳 vs 删"归 B2/B3 一起拍。）

### ⚫ D 大重构 / 名实不符（单独立项）

| # | 问题 | 证据 |
|---|---|---|
| D1 | 截断/空响应无专门态：全链路无 `finishReason`/`truncat`/`max_tokens` 处理，空响应一律补「已完成。」/「（空响应）」，被截断的回复与正常完成无法区分→用户把半截内容当完整用 | generationCanvasAgentClient.ts 全文、[CanvasAssistantPanel.tsx:464/471](src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx)、[CreationAiPanel.tsx:392](src/workbench/creation/CreationAiPanel.tsx)（需底层 runner 透出标记，跨层）|
| D2 | 两个对话编排巨壳：`CanvasAssistantPanel` 764 行（`submitAgentMessage` 单 useCallback ~300 行）、`CreationAiPanel` 746 行（`send` 单 useCallback ~170 行），都逼近 800 阈值 | CanvasAssistantPanel.tsx:213-507、CreationAiPanel.tsx:242-411 |

---

## 本轮即修（A 簇，与竖排修复连续、低风险）

1. **A1+A3 根因**：渲染层 `isError`/`cancelled` 改读 `message.status`（真相源），不再嗅 content 前缀。
2. **A2**：删 `PendingChip` 的假下拉 `▾`（chip 只如实展示 AI 配的值，改值去节点/画布——符合「创作者主权」）。
3. **A4**：计划卡确认条加 `flex-wrap` + 按钮 `shrink-0`（几何安全网，对齐 committed/deviation）。

## 留样张拍板（下一步最该动 B1）

**B1 错误透传重设计** 是这一面最大的体验改善，但涉及「红色语气长什么样、创作侧双重展示留哪个、错误文案怎么接 narrate」多处取舍→出样张拍板再做。B2（token 行）、B3（折叠条）次之，可一起出。

## 已知健康（别硬抽）

共享渲染层瘦健康；StoryboardPlanCard 手写品牌 chip 是**有据取舍**（StatusBadge 是 Mantine 非品牌色），登记备查非必改。
