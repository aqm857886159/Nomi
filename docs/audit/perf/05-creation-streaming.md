# 05 · 创作文本面板 + AI 对话流式输出 — 性能审计

> 范围：创作助手（`CreationAiPanel`）+ 画布助手（`CanvasAssistantPanel`）的流式吐字、
> 创作文本编辑器（Tiptap `WorkbenchEditor`）。只读审计，未改源码。
> 日期：2026-06-22。

## 顶部结论：流式卡顿的根因

**一句话：rAF 合帧已经把"每 token 一次 setState"压到了"每帧一次"，但每帧那一次 setState 仍然
让整条对话线 + 整段累积 markdown 全量重渲 + 全量重 parse —— 越往后回复越长，单帧成本越线性增长，
所以是"前半段顺、后半段越来越顿"。**

拆成三层根因（按影响排序）：

1. **react-markdown 无 memo，每帧全量重 parse 累积全文（最重）。**
   `NomiMarkdown`（`src/workbench/common/NomiMarkdown.tsx:67`）是裸 `<ReactMarkdown>`，没有 `React.memo`，
   也没有按"内容没变就跳过"的短路。流式中那条正在吐字的助手消息，`content` 每帧都在变（越来越长），
   于是 remark-gfm 把**当前累积的整段全文**重新 mdast 解析一遍、重新 diff 整棵节点树。
   2000 字回复 = 后半程每帧解析约 2000 字 ×（剩余 token 数）次，单帧 parse 成本随长度线性上升。
   这是"打字越来越顿"的主因。

2. **消息组件无 memo，每帧整列表 reconcile。**
   `AssistantMessageView`（`src/workbench/ai/AssistantMessageView.tsx:58`）没有 `React.memo`。
   两个面板都用 `messages.map(...)` 直渲（`CreationAiPanel.tsx:551`、`AssistantTimeline.tsx:211`），
   每帧 setState 后整个 `messages` 数组身份变了 → 所有历史气泡（含早已 `done` 的）连同它们里面的
   `NomiMarkdown` 全部重渲 + 重 parse。长对话里"已完成的历史回复"本可冻结，现在每帧陪绑重渲。
   这是"对话越长、流式越卡"的放大器。

3. **无虚拟化。** 仓库装了 `@tanstack/react-virtual`（`package.json:71`）但两个面板都没用
   （grep 零命中）。长对话靠 `overflow-auto` 裸渲全部消息节点。叠加第 2 条（每帧全列表重渲），
   消息条数 N 直接乘进每帧成本。

> 注：rAF 合帧（`useRafCoalesce.ts` + 画布侧 `streamRaf`）已经做对了"把高频 setState 降到每帧一次"
> 这一层 —— 它治住了"每 token 一次重渲"，但治不了"每帧那一次重渲有多贵"。当前瓶颈完全在
> "每帧的单次重渲范围 = 整列表 + 整段 markdown 重 parse"。

---

## 发现表

| 发现 | file:line | 机制 | 症状 | 严重度 | 修复方向 | 实测验证法 |
|---|---|---|---|---|---|---|
| **react-markdown 无 memo，流式每帧重 parse 累积全文** | `src/workbench/common/NomiMarkdown.tsx:67-74` | 裸 `<ReactMarkdown>`，无 `memo`/无内容短路。流式那条消息 `content` 每帧变长 → remark-gfm 把当前累积全文整段重新 mdast 解析 + 整树 diff，每帧一次 | 打字越来越顿（前段顺、后段卡），回复越长越明显 | **P0** | ① `NomiMarkdown` 包 `React.memo`（props 只 `{children,compact}`，children 不变即跳过）；② 流式态可走"纯文本/轻量渲染"，仅终态 `done` 才上 full markdown（或对累积文本做"块级稳定前缀缓存"，只 re-parse 最后一个未闭合块） | 流式一条 2000 字含表格/列表的回复，录 Performance trace，看后半程每帧 `ReactMarkdown` 自渲时间是否随长度线性涨；改后应基本恒定 |
| **AssistantMessageView 无 memo，每帧整列表重渲** | `src/workbench/ai/AssistantMessageView.tsx:58`；消费点 `CreationAiPanel.tsx:551-577`、`AssistantTimeline.tsx:172-216` | 组件未 `memo`；每帧 `setMessages` 产生新数组 → 所有历史气泡（含 `done`）连同内部 `NomiMarkdown` 全部重渲+重 parse | 对话越长，流式越卡；滚动也跟着掉帧 | **P0** | `React.memo(AssistantMessageView)`，props 用稳定值（`turnStats`/`attachments` 引用稳定）；历史 `done` 消息内容不变即整条跳过。与上一条叠加才彻底——单独 memo markdown 还不够，列表层也要短路 | 制造 30+ 条历史对话，再流式发一条长回复；React DevTools Profiler 看流式每帧重渲组件数。改后应只剩"正在吐字的那一条"重渲 |
| **消息列表无虚拟化** | `CreationAiPanel.tsx:514-577`（`overflow-auto` + `messages.map`）、`AssistantTimeline.tsx:209-217` | 全部消息节点常驻 DOM；与"每帧全列表重渲"相乘，N 条消息 × 每帧成本 | 长对话滚动卡、流式时整页掉帧加剧 | P1 | 用已在依赖里的 `@tanstack/react-virtual` 给消息列表加 windowing（注意流式底部锚定 + 变高消息测量）。优先级低于 memo：先 memo 让非活动条零重渲，多数会话长度下虚拟化收益才显现 | 200 条消息的会话，量滚动帧率 + 首次挂载时间；对比 memo-only vs memo+virtual |
| **画布侧自动滚动 `scrollIntoView` 每帧触发 layout** | `CanvasAssistantPanel.tsx:176-179` | `useEffect` 依赖 `[messages, pendingToolCalls, deviationReport, collapsed]`；流式每帧 `messages` 变 → 每帧 `scrollIntoView({block:'end'})`，强制同步布局/滚动 | 流式时滚动"跳"、与重渲叠加掉帧 | P1 | ① 仅当用户已在底部时才自动滚（记录 `isAtBottom`，离底则停，避免抢用户滚动）；② 节流到每帧最多一次或用 rAF；③ 改 `scrollTop = scrollHeight` 避免 `scrollIntoView` 的额外查找 | 流式长回复时手动往上滚，观察是否被强制拉回底部 + Performance 面板看 "Layout" 紫条是否每帧出现 |
| **创作编辑器每次敲键 `setWorkbenchDocument` → AI 面板重渲** | `WorkbenchEditor.tsx:111-116`（`onChange`→`handleChange`）、订阅方 `CreationAiPanel.tsx:86,131` | Tiptap `onUpdate` 每字符触发 `setWorkbenchDocument(整 doc)`；`CreationAiPanel` 订阅 `workbenchDocument` 并 `useMemo` 重算 `documentText`（全文 extract）。在文档里打字 = 每键重渲整个 AI 面板 + 重 extract 全文 | 长文档里打字有顿挫；与流式无关但同属"创作文本面板卡顿" | P1 | ① AI 面板不订阅整个 `workbenchDocument`，改订阅派生的轻量 selector 或把 `documentText` 抽到只读 ref/单独 store slice；② 编辑器落 store 防抖（150–300ms），keystroke 不必每字同步全局；`documentToolsRef` 已是 live ref，AI 实际读全文走的是 tools，不必靠 store 全文驱动 | 在 5000 字文档里连续打字，Profiler 看每键是否重渲 `CreationAiPanel` 子树；量输入延迟 |
| **Tiptap 受控 `setContent` 重建整 doc（AI 写入/切节点时）** | `useNomiRichTextEditor.ts:76-82` | 受控内容 effect：`content` 变（JSON.stringify 比对）→ `editor.commands.setContent(content)` 整篇替换、重建 doc + 丢光标。AI 流式往文稿写时若走 setContent 路径会逐次全量重建 | AI 写长文进文稿时编辑器卡、光标跳 | P2（当前 AI 写入走 `tools.insertContent` chain 增量，非 setContent，所以日常不触发；切节点/外部覆盖时触发） | 已有反馈环防护（`lastEditorJsonRef`）。保持 AI 写入走 `insertContent` 增量链（现状正确，勿回退成 setContent）；大文档外部覆盖可考虑 diff-patch 而非整篇 setContent | 让 AI 连续 append 5 段长文，确认走的是 insertContent（增量）不是 setContent（整建）；量编辑器每段插入耗时是否随文档变长 |
| **空对话 suggestions/EMPTY_SUGGESTIONS 每渲新建（轻）** | `CreationAiPanel.tsx:410-414`（已 `useMemo`，OK）；`AssistantTimeline.tsx:66`（`EMPTY_SUGGESTIONS` 模块级常量，OK） | — | 无 | 信息项 | 现状正确，无需改 | — |
| **附件预览解析在主进程（非渲染主线程）** | `electron/ai/agentChatV2.ts:518-528`（`extractTextFromLocalAsset`/`buildAgentUserContent`） | PDF/Office 抽文本在 Electron 主进程异步，不阻塞渲染流式 | 不影响流式帧率 | 信息项（排除项） | 无需改（与流式卡顿无关） | — |

---

## 流式一帧到底重渲了什么（核心机制）

以**创作助手流式一条长回复**为例，追一帧：

1. 后端 `runAgentChatV2` 经 `streamText` 逐 token emit `content-delta`，渲染层 `onContent(_delta, streamedText)`
   拿到**累积全文** `streamedText`（`CreationAiPanel.tsx:301`）。
2. `pushStreamFrame(() => setMessages(prev => prev.map(...)))`（`:303-307`）——rAF 合帧：一帧内多个 token
   只保留最后一个 thunk，每帧 flush 一次。✅ 这层已治住"每 token 一次 setState"。
3. flush 执行那一次 `setMessages`：返回**新数组**（`prev.map`），即使只改了最后一条，数组身份变了。
4. `CreationAiPanel` 重渲 → `messages.map`（`:551`）重建所有 `<AssistantMessageView>`。**因为无 memo**，
   N 条消息全部重渲。
5. 每个 `AssistantMessageView` 渲染 `<NomiMarkdown>{content}>`（`AssistantMessageView.tsx:79`）。**因为无 memo**，
   每条都重新跑 `<ReactMarkdown remarkPlugins={[remarkGfm]}>` ——
   - 历史 `done` 消息：content 没变，但仍被重新 parse（纯浪费）。
   - 正在吐字那条：content 变长了，**当前累积全文整段重新 mdast 解析 + 整树 diff**。

**react-markdown 重 parse 次数估算**：设回复最终 T 个 token、N 条历史消息。
- 当前：每帧（≈每 rAF）重 parse **(N 条历史全文 + 1 条当前累积全文)**。当前那条的 parse 成本 ∝ 已累积长度。
  整轮总 parse 工作量 ≈ Σ(每帧 N 条历史 parse) + Σ(当前条 1+2+...+长度) → **随回复长度二次方累积**，
  这就是后半程明显变顿的数学根源。
- memo 后理想：历史 N 条 parse 0 次（content 未变跳过）；当前条仍每帧 parse 一次累积全文（线性，可接受），
  若再加"稳定前缀/仅 parse 末块"则降到准恒定。

画布助手（`CanvasAssistantPanel` + `AssistantTimeline`）同构：`streamRaf` 合帧 ✅，但 `AssistantTimeline`
本身每帧重建整个 `liveBlocks` 数组 + `messages.map` 全列表渲染，`AssistantMessageView` 同样无 memo。
额外多一个 `scrollIntoView` 每帧（见表 P1）。`AgentPlanCard` 已正确 `React.memo`（`:360`）——
这是仓库里唯一做对 memo 的流式子组件，可作为其余组件的模板。

---

## 建议真机实测项（量化，跑前先清场，见 R13 走查坑）

1. **流式长回复后半程帧率**：发"写一篇 2000 字、含 2 个表格 + 多级列表的分镜脚本"，
   Chrome DevTools Performance 录制整轮。看：① 后半程平均 FPS；② 单帧最长 `ReactMarkdown` 自渲时间是否随累积长度线性/二次涨；
   ③ 每帧重渲组件数（React Profiler）。这是验证表中 P0 两条的核心指标。
2. **长对话叠加流式**：先堆 30–50 条历史对话，再流式发一条长回复。量"流式每帧重渲组件数"——
   当前应≈全部消息，memo 后应≈1。
3. **输入延迟（编辑器）**：在 5000 字文档里连续快速打字，量按键到字符上屏的延迟 + 每键是否重渲 `CreationAiPanel`
   子树（验证表中"编辑器→AI 面板重渲"那条）。
4. **自动滚动抢占**：流式时手动往上滚回看历史，确认画布助手是否每帧把你拽回底部（`scrollIntoView`）。
5. **虚拟化收益基线**：200 条消息会话，量滚动 FPS + 面板挂载时间，作为决定是否上 `@tanstack/react-virtual` 的依据
   （建议先做 memo，再用此实测判断虚拟化是否还需要）。

## 修复优先级建议

1. **P0-A** `React.memo(NomiMarkdown)` + **P0-B** `React.memo(AssistantMessageView)` —— 两者必须一起做，
   缺一不可（只 memo markdown，外层列表仍每帧重渲会打穿；只 memo 列表项，markdown 仍重 parse）。
   预期：流式每帧重渲从"全列表"降到"1 条"，历史 markdown parse 归零。**改动小、收益最大、风险低。**
2. **P1** 自动滚动按"是否在底部"门控 + 节流（画布侧）；创作编辑器落 store 防抖 / AI 面板退订整 doc。
3. **P1/P2** 流式态轻量渲染（仅末块 re-parse 或终态才上 full markdown）。
4. **P1** 虚拟化 —— 依实测项 5 决定，memo 之后再评估。
