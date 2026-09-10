# 一轮回复一个气泡 · 技能用没用上要有物证

> 2026-09-10 · 分支 `fix/agent-transcript-merge-skill-evidence-20260910`
> 起因：两条用户真机反馈（截图可见）。R21 合同 `docs/fixes/2026-09-10-agent-transcript-merge.root-cause.json`。

## 底层逻辑（这修的是哪个真实摩擦）

**反馈 #7**：用户发一句话，Nomi 答一轮，屏幕上出来的是**三块各自带间距的气泡**——
「好，我先看看…」「好的，用 Seedream 4.5…」「已经提交生成了…」，中间还夹着工具行。
读起来像 Nomi 自言自语了三次。可它其实只是**一个人说的一段话**：模型一轮回复在传输上
天然就是「一条消息里的若干块」（text / tool-call / text…），我们照着块数摆气泡，就把
一段话切成了三句话。

**反馈 #6**：用户在 composer 里挑了一个技能，发出去之后**对话里一个字都看不到它**，
于是他以为技能压根没被用上（实核：`skillKey` 确实随消息发出并落盘，只是从没上过屏）。
技能是「这一轮按哪套方法做」的唯一开关，看不见它，用户就只能靠猜。

## 他要权衡的那件事

**顺序 vs 完整。** 工具行必须按发生顺序内联（2026-09-06 用户拍板「工具调用内联不置顶」），
而文本要读成一段完整的话。两者看似冲突——本方案的取法是：**工具行一个都不动，只把文本
合成一个气泡**，落点选这一回合**最后**一段文本的位置（还在流的是它，气泡跟着字往下长，
不会跑到已经发生的工具行上面去）。

## 先查别人

完整报告：`docs/research/2026-09-10-agent-transcript-merge/prior-art.md`（每条带 URL / file:line）。三条要点：

1. **仓库已有的折叠规则** — `src/workbench/ai/v4/agentPanelV4Collapse.ts:46-59, :104-111`：
   我们**已经**在折叠了，但只折工具与思考；`:111` 把一段工作里的助手文本原样一条条推到
   `process` 行之后。也就是说三段文本在最终流里**本来就已经相邻**，中间什么都没有——
   保持三个流项唯一的效果是在一句话内部插进两条 `gap-2.5`（`AgentPanelV4Panel.tsx` 的流容器）。
2. **生态：一段一块，没有先例合并** — https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage （上游 AI Elements 逐 part 渲染）；Cline `messageUtils.ts#L202/#L533`（吸收判定显式跳过
   `say:"text"`，注释 `// Text is OK - it will render separately`）、Roo Code `ChatView.tsx#L1096`、
   Continue `Chat.tsx#L300-L332`、上游 Vercel AI SDK / AI Elements 的 `message.parts.map(...)`
   （https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage 、 https://elements.ai-sdk.dev/components/message ）
   全都是**每个 part 一个块**。
   → **诚实结论：合并是一次有意偏离，理由是领域约束**——上游那套「每 part 一块」配的是
   **不折叠、不重排**的流；我们折了工具、重排了文本落点，就不能只抄它的后半句。
   偏离只发生在文本合并上，工具行的内联顺序一个字不改。
3. **技能凭据跟 Claude Code 走** — https://code.claude.com/docs/en/skills ：技能是一等调用
   （`Skill(commit)` 这样的权限语法），被调用时正文进转录、留在后续回合里；**用没用上有物证**。
   我们的技能是提示词层的方法论、不占一次工具往返，所以物证落成两处：用户气泡上的 chip
   （「我挂了它」）+ 该轮回复头上一行凭据（「它确实进了这一轮」），两者取自同一条已落盘的
   事实 `LaneInputMessage.context.skillKey`，不新造真相源。

## 范围

改（视图投影层 + 一条已落盘事实的搬运，**不改转录存储格式**）：

- `electron/shared/agentLane/laneContracts.ts` — `user` 段加只读 `skillKey?`。
- `electron/shared/agentLane/laneProjection.ts` — 从**这条消息自己**的 `context.skillKey` 读出来。
- `src/workbench/ai/lane/laneViewModel.ts` — 唯一产地：按回合合并助手文本 + 用户气泡 chip + 回复头凭据。
- `src/workbench/ai/v4/agentPanelV4Types.ts` — `assistant` 流项加 `skill?`（是助手文本的一个**状态**，不是第九个积木）。
- `src/workbench/ai/v4/AgentPanelV4Message.tsx` / `AgentPanelV4Panel.tsx` — 渲染那一行凭据。
- `src/workbench/ai/v4/useAgentPanelV4Data.ts` — 技能 key → 技能库里的显示名。
- `src/i18n/locales/agentPanelV4.ts` — `skillUsed`（zh-CN + en）。

**不动**：
- `agentPanelV4Collapse.ts` 一行不改。合并在更早的边界做完之后，一段 stretch 里至多只剩一个
  助手项，`:111` 那条推送**由构造保证**只会推一条——不需要在第二个地方再写一遍合并（P1）。
- `AgentPanelV4Composer.tsx` / `agentPanelV4Logic.ts` / `ProjectAgentResidentShell.tsx`（PR #720 在改）。
- 技能**多选**不做（用户反馈 #6 的第三项，另议）。

## 回滚

单 commit，`git revert` 即回到「一段一个气泡、技能不上屏」。数据面零迁移：`skillKey` 是
读出来的，转录一个字节都没多写，旧对话里没有它就是没挂技能。

## 验收门

- `laneViewModel.test.ts`：合并 + 回合边界 + 技能 chip/凭据三条；`laneProjection.test.ts`：
  `skillKey` 只从那条消息自己的 context 来。
- R13 真机走查 `tests/ux/agent-transcript-merge.walk.mjs`（零额度 loopback）：
  一回合「文本→工具→文本→工具→文本」断言**只有 1 个** `[data-v4-block="assistant"]`、
  工具行 2 条按序在过程里；带技能发一条断言用户气泡有 `[data-v4-chip="skill"]`、
  回复头有 `[data-v4-skill-used]`；截图人眼看。
- `pnpm run gates` 全过；`check:i18n` 基线只减不增；单文件 ≤800 行。
