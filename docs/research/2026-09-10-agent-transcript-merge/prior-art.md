# 先查别人 · 一轮回复里「文本—工具—文本」怎么摆

> 2026-09-10。服务 `docs/plan/2026-09-10-agent-transcript-merge-skill-evidence.md`。
> 问题只有一个：**模型一轮回复产出多段文本、中间夹着工具调用时，界面是一个气泡还是几个气泡？技能用没用上又是怎么给凭据的？**
> 所有 URL 都实抓过；抓到的是 monorepo 迁移后的真实路径（Cline 老的顶层 `webview-ui/` 已 404）。

## 1. 仓库已有的规则（我们自己现在是什么样）

| 位置 | 现在做什么 |
|---|---|
| `src/workbench/ai/lane/laneViewModel.ts`（改动前 :259-263） | 每个 `assistant-text` 段各推一个 `{ kind: 'assistant' }` 流项——**一段一个气泡** |
| `src/workbench/ai/v4/agentPanelV4Collapse.ts:46-59, :104-111` | 只折叠**工具**（相邻同名收据 → `tool-group`）与**思考**（一段 stretch 的思考合成一条披露）；`:111` 把这一段里的助手文本原样一条条推到 `process` 行**之后** |
| `src/workbench/ai/v4/AgentPanelV4Panel.tsx:270`（`data-v4-flow` 容器） | 流项之间 `gap-2.5`——每个气泡自带 10px 外边距 |

→ 三条合起来就是用户截图里的样子：一轮回复的三段话变成三块各自带间距的气泡，中间还隔着工具行。

## 2. 生态怎么做（实抓）

- **Cline** — https://github.com/cline/cline/blob/fc3273bbe0e106cdb9c0194b1a96b6536a74d9ad/apps/vscode/webview-ui/src/components/chat/chat-view/utils/messageUtils.ts#L202
  `groupMessages()` 只把**浏览器会话**折成一组，其余每条（含每条 `say:"text"`）都是 `result.push(message)` 各占一行。同文件 `groupLowStakesTools()`（:533）折的是**只读工具**的连段，两处吸收判定（:463 / :514）都显式跳过 `say:"text"`，注释写着 `// Text is OK - it will render separately`。
  `apps/vscode/src/shared/combineApiRequests.ts#L21` 合并的是「请求开始 + 请求结束」两条元数据，不是助手文本。
  **结论：不合并文本；工具行严格按时序内联。**
- **Roo Code**（Cline 的 fork）— https://github.com/RooCodeInc/Roo-Code/blob/b867ec9145750d0ae1ff7f02d35406e9bf2a0b16/webview-ui/src/components/chat/ChatView.tsx#L1096
  `groupedMessages` 只批量化**同类工具 ask**（读文件 / 列目录 / 改文件），没有任何分支碰 `say:"text"`。同上。
- **Continue** — https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/gui/src/pages/gui/Chat.tsx#L300-L332
  一条 assistant history item = 一个 `<StepContainer>`（文本）+ 紧跟其后的 `<ToolCallDiv>`。**顺序内联，跨回合不合并文本。**
- **Vercel AI SDK / AI Elements**（我们 vendor 的那份契约的上游）— https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage 、 https://elements.ai-sdk.dev/components/message
  `UIMessage.parts` 就是「文本块 + 工具块」的混合数组，官方范例 `message.parts.map(...)` **按发射顺序**逐块渲染，AI Elements 的 `<Message>` 也是**每个 part 一个**。
  **结论：支持「工具行按序内联在一轮之内」，但不支持「合并连续文本」。**
- **Claude Code 的技能凭据** — https://code.claude.com/docs/en/skills
  技能是**一等工具调用**（权限写成 `Skill(commit)`、`Skill(review-pr *)`），被调用时 `SKILL.md` 正文作为一条消息进入对话并留在后续回合里。即：技能用没用上，是靠转录里那一行**带技能名的工具行**说话的，不是靠猜。
  （第三方逆向记录 https://mikhail.io/2025/10/claude-code-skills/ 描述的形状是 `文本 → tool_use{name:"Skill", command:"pdf"} → "Launching skill: pdf"`；非官方，只当旁证。）
- **Cursor** — https://cursor.com/docs/agent/overview 只说 subagent 抽屉给「完整、有序的转录」。没找到官方描述它的气泡分组规则；抓到的只有一条用户报障 https://forum.cursor.com/t/agent-chat-inserts-a-completed-tool-status-line-mid-word-in-assistant-text/169497 （工具状态行插进了单词中间），它主张的是「工具件应当整块出现在文本段之间、不许打断句子」——那是「别切开一段」，比「跨工具合并文本」弱。

## 3. 结论（以及我们为什么仍然合并）

**诚实记录：「把一轮里被工具隔开的助手文本合成一个气泡」在生态里没有先例。** 五个来源全都是一段一块。所以这是一次**有意的偏离**，理由必须是领域约束，不是偏好：

1. **我们已经不按 parts 顺序排了。** `agentPanelV4Collapse.ts:104-111` 把整段工作折成一行 `process`（工具行进它的展开体），再把该段的助手文本**统一推到它之后**。也就是说三段文本在最终流里**本来就已经彼此相邻**——中间什么都没有。此时保持「三个流项」唯一的效果就是在一句话内部插进两条 10px 的分隔。上游 AI Elements 的「每 part 一个 Message」是配合**不折叠、不重排**的流用的；我们折了，就不能只抄它的后半句。
2. **工具行的内联顺序一个字都没动。** 偏离只发生在文本块的**合并**上；工具仍按 `sequence` 走（用户 2026-09-06 拍板「工具调用内联不置顶」保持）。
3. **段落语义没丢。** 合并用 `\n\n` 接，Markdown 里空行就是段落分隔，渲染出来仍是三段，只是不再是三个带外边距的气泡。

技能凭据这一条**跟着 Claude Code 走**：技能用没用上必须在转录里有物证。差别是我们没有把技能做成工具调用（Nomi 的技能是提示词层的方法论，不占一次工具往返），所以物证落成**用户气泡上的 chip（我挂了它）+ 该轮回复头上的一行凭据（它确实进了这一轮）**，两句话都取自同一条已落盘的事实 `LaneInputMessage.context.skillKey`，不新造真相源。
