# 会话历史（创作助手 / 画布助手）

> 状态：方案已拍板（2026-06-14，方案 A + 设计师/真实用户 agent 简化），进入实现。
> 关联记忆：`agent-memory-context-overhaul`（A 层模型缓存已落盘）、`creation-ai-attachments-plan`。
> 关联代码：`conversationPersistence.ts` / `conversationsIpc.ts` / `agentSessionStore.ts` / `CreationAiPanel.tsx` / `CanvasAssistantPanel.tsx` / `MemoryFold.tsx`。

---

## 0. 一句话

「新对话」现在会把旧对话**物理销毁**（界面气泡 + 磁盘 `conversations.json` 写空 + 模型记忆 `agent-session.json` 删除），且创作助手没有任何「记忆/历史」入口。本方案把**单线程**对话升级为**每个面板各自的会话列表**：新对话**归档不销毁**，随时翻回任意旧对话**连气泡带模型记忆一起接着聊**；并给创作助手补上「AI 记得 N 条」（与画布助手对齐）。

---

## 1. 痛点与根因（已实测确诊）

| 痛点 | 根因（file:line） |
|---|---|
| 点「新对话」旧对话全没、找不回 | `CreationAiPanel.tsx:320 handleNewConversation` → `resetCreationAiConversation`（`workbenchStore.ts:265` 清气泡）+ `clearWorkbenchAgentSession`（清模型记忆+删盘）；清气泡触发 `conversationPersistence` 防抖把 `conversations.json` 写成空数组 |
| 创作助手看不到「记忆」 | `MemoryFold`（项目记忆「AI 记得 N 条」）只挂在 `CanvasAssistantPanel.tsx:570`，创作助手未渲染 |

> 注：单条对话的**持久化本身是好的**（`conversations.json` 真在写、`loadProjectConversations` 真在读回）。缺的不是「存」，是「存成多条、新建时不覆盖、能翻回」。

---

## 2. 通俗讲解（用户视角）

- 你跟创作助手聊了一段（写开场），想换个话题，点右上角的「会话」（↺ 倒带图标）。
- 弹出来一个小窗：**最上面是「+ 新对话」，右边小字「当前会存入历史」**——告诉你点了不会丢。下面列着你过去聊过的几段，每段一句话摘要 + 时间（「开场氛围：便利店清晨」· 刚刚 / 「产品宣传 30 秒分镜」· 2 小时前）。
- 点「+ 新对话」→ 当前这段"嗖"地收进历史（一闪「已存入历史」），面板清空开始新的。
- 点历史里任意一段 → 那段对话**整段回来**，而且 AI 还记得你们聊到哪，能直接接着聊。
- 面板上多了一行「AI 记得 N 条」，点开能看见 AI 记住的设定/偏好（和画布助手一样），看错了能改能删——你不再"看不见它有没有记性"。

---

## 3. UI 变化（与简化版样张一致，token-only）

样张：`docs/design/`（本 session 的 `creation_assistant_history_simplified` mockup）。设计师 + 真实用户 agent 已审并简化。

### 3.1 头部（两面板一致）：5 → 3 元素
```
[N] 创作助手 ·········· [↺会话] [⤢放大] [✕收起]
```
- **删** token 计数 `12.4k tok`（仪表盘数字，0 行动价值；累计 token 仍可在别处低调暴露）。
- **删** 独立「新对话 +」键，并入「会话」弹层顶部。
- 「会话」按钮：`WorkbenchIconButton`，`IconHistory size=15 stroke=1.5`（带逆时针箭头=倒带感，非纯时钟）；`size-6 rounded-nomi-sm text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink`，打开态 `bg-nomi-accent-soft text-nomi-accent`。
- 放大/收起不动。

### 3.2 折叠条：2 → 1 条
- **删** 工具条 `AssistantToolsFold「5 个工具」`（与记忆条 DOM 几乎逐行相同=两条重复灰杠；工具能力靠用自学）。
- **留** `MemoryFold「AI 记得 N 条」`（N=0 不渲染），并**新挂到创作助手**（对齐）。

### 3.3 会话弹层 `ConversationHistoryPopover`（新组件）
- 容器 `w-72 rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-md p-1`；BodyPortal + fixed，锚「会话」按钮下，向下展开 + 视口 clamp（仿 `AssetPickerPopover`，守 R13 弹层铁律）。
- 顶部：`button「+ 新对话」`（`h-[34px] px-2 rounded-nomi-sm text-bodySm`，`IconPlus 15`，右侧 `text-micro text-nomi-ink-40「当前会存入历史」`）。
- 分隔：`h-px bg-nomi-line-soft mx-1.5 my-1`（单条，不双层 border）。
- 列表 `ul` `max-h-[300px] overflow-auto`，每条 `li`（`group h-9 px-2 rounded-nomi-sm flex items-center gap-2`）：
  - 标题 `span.flex-1.min-w-0.truncate.text-bodySm.text-nomi-ink-80`（当前段 `text-nomi-ink`）——一句话摘要。
  - 时间 `span.shrink-0.text-micro.text-nomi-ink-40`。
  - 删除 `button.✕`（`IconX 12`，`shrink-0 size-5 text-nomi-ink-30 opacity-0 group-hover:opacity-100`；当前段不渲染删除键，防误删进行中）。
  - 当前段：`bg-nomi-accent-soft` + 左 `before:` 2px accent 竖条；**不渲染「当前」文字 pill**（与高亮重复表达）。

---

## 4. 架构与数据流

### 4.1 存储：`conversations.json` v1 → v2（主进程 `conversationsIpc.ts`）
```jsonc
// v2
{
  "v": 2,
  "creation":   { "activeId": "<threadId>", "threads": [ Thread, ... ] },
  "generation": { "activeId": "<threadId>", "threads": [ Thread, ... ] },
  "committedProposal": <unknown>   // 仍随 generation 活动线程
}
// Thread = { id, title, createdAt, updatedAt, messages: {id,role,content}[] }
```
- **迁移 v1→v2**：旧 `creationMessages`/`generationMessages` 非空 → 各包成一条 thread（`title` 由首条 user 文本兜底，`createdAt=updatedAt=迁移时刻`，迁移时刻由调用方传入，避免主进程读时钟）；空 → `{activeId:null,threads:[]}`。读到 v1 即就地返回 v2 形状（renderer 只认 v2）。
- 上限：每 area 线程数 `MAX_THREADS=30`（超出删最旧）；每线程消息仍 `MAX_MESSAGES=200`。`log` 丢弃数（不静默截断）。

### 4.2 渲染层线程模型
- 两个 store 字段从「消息数组」抽象为「活动线程 + 线程列表」。为守 R12（`generationCanvasStore` 白名单巨壳只减不增），线程逻辑放**外挂模块** `conversationThreads.ts`（仿 `generationAiConversation.ts` 的外挂 setState 模式），`creationAiMessages`/`generationAiMessages` 仍是「活动线程的 messages 投影」，**消费组件零改**。
- `conversationPersistence.ts` 改：读写「活动线程」而非裸数组；`loadProjectConversations` 载入线程列表 + 活动线程气泡。

### 4.3 「新对话」= 归档（`handleNewConversation` 重写）
1. 当前活动线程 messages 已实时同步在 thread 列表里（无需额外快照）。
2. 生成新空线程、设为 active、清 UI 投影。
3. 旧线程留在列表（归档）。
4. 触发该 area 的模型会话 reset（见 4.4），不再 `clearWorkbenchAgentSession` 全清。
5. 反馈：`showUndoToast` 同款轻提示「已存入历史」（无撤销按钮，纯告知）。

### 4.4 模型记忆按 area 隔离 + 切换重灌（`agentSessionStore.ts` / `agentChatV2.ts` / `workbenchSessionKey`）
- `workbenchSessionKey(area)` → `nomi:workbench:<projectId>:<area>`（creation / generation 各一把）。**后果**：跨区「原始对话」共享取消——但跨区**重要知识**本就由项目记忆事实（`MemoryFold`，跨区共享、持久）承载，更干净。本变更在文档显式声明。
- `agent-session.json` 从「单 `CoreMessage[]`」改为「`{version,sessions:{[sessionKey]:CoreMessage[]}}`」map（一文件原子写，多 key 不互覆盖）。
- **切/回线程**：renderer 调后端「reset 该 area 会话」+ 把目标线程气泡（`{role,content}`）重建成 `CoreMessage[]` 重灌进该 area 的内存 Map + 落盘——实现「翻回旧对话接着聊」。重建是**文本轮**重建（user/assistant 文本；tool 气泡降级为文本/丢弃）——足够续聊，且源是真实气泡内容（非 trace），不踩"trace 重建不出合法 tool pair"的坑。

### 4.5 标题一句话摘要（`S4`）
- 线程**归档时**（或首轮结束后）跑一次便宜 LLM 调用，回看该线程提炼≤16 字摘要写入 `thread.title`；失败/未跑 → 兜底取首条**实质** user 文本（跳过「在吗/帮我看下」等寒暄，截断）。
- 不阻塞 UI：先用兜底标题落库，摘要异步回填。

---

## 5. 不动什么

- 单条对话的落盘/读回管线骨架（防抖、原子写、切项目 flush、崩溃恢复）——复用，不重写。
- `MemoryFold` 项目记忆系统（S9）——只是把它也挂到创作助手，不改其逻辑。
- 画布对账/整笔撤销事务（`committedProposal`）——仍随 generation 活动线程落盘。
- 节点/画布/时间轴/导出——零接触。
- 附件 chip、composer、放大全屏、stale 分隔线——不动（stale 分隔线在多线程下语义仍成立：活动线程气泡 vs 该 area 模型记忆）。

---

## 6. 回滚策略

- 全程 additive + 版本门：`conversations.json` 带 `v`，v2 读 v1 兼容；`agent-session.json` 带 `version`，旧单形状读为单 key。
- 任一 S 切片可独立 revert：S0（schema）落地后即使 S1-S4 未上，旧单线程行为不变（v2 退化成「每 area 一条线程」）。
- 出问题最坏退回：`handleNewConversation` 恢复旧「清空」实现即回到当前行为，数据文件 v2 仍可被旧逻辑读首条线程。

---

## 7. 验收门

1. **五门全过**：`check:filesize`（新组件 ≤800 行、不喂巨壳）→ `lint:ci` → `typecheck` → `test` → `build`。
2. **单测**：v1→v2 迁移、归档不丢旧线程、切线程重灌、`MAX_THREADS` 淘汰、损坏文件优雅降级。
3. **保真断言**（`design-fidelity.e2e.mjs`）：头部元素数（=3）、弹层 DOM 结构（顶部新对话 / 每条无消息数 / 无「当前」pill / 当前态高亮）、记忆条出现在创作助手。
4. **R13 真机走查**（穿透）：聊一段 → 点新对话（看到「已存入历史」、旧的没丢）→ 开「会话」弹层翻回旧对话 → 气泡回来 → 接着聊 AI 仍记得上文。人眼判断顺不顺、弹层在窄面板边缘不被裁。
5. **样张对账**：与简化版 mockup 逐项并排，差异当场补齐或记因。

---

## 8. 切片排期

| 切片 | 内容 | 门 |
|---|---|---|
| S0 | schema v2 + 迁移（主进程 + bridge 类型）| 单测：迁移/降级 |
| S1 | 线程模型外挂 + 新对话归档 + restore | 单测：归档/restore |
| S2 | 模型记忆 per-area + 切换重灌 | 单测：重灌/隔离 |
| S3 | 历史弹层 + 头部精简 + 记忆条对齐（两面板）| 保真断言 |
| S4 | 摘要标题 + 新对话反馈 | — |
| S5 | 五门 + R13 走查 + 样张对账 | 全绿 + 走查过 |
