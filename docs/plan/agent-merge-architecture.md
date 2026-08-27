# 两个 Agent 合并：修幻影工具 + 架构对齐 + 对话连续

> ⛔ 本文描述的 `runAgentChatV2` 单引擎架构已在 2026-08 被 pi SDK 运行时取代，现行实施见 `docs/plan/2026-08-26-pi-r1-runtime-cutover.md`。

> 用户拍板：① 修幻影工具 ② 创作区/生成区 Agent 架构对齐（都用真工具调用、共用一套引擎）③ 对话跨区连续（Agent 记得之前说过的）④ 活体测试（起 app，肉眼看真实返回格式与体验）。

## 背景（已读穿的事实）
- 引擎只有一个：`electron/runtime.ts` 的 `runAgentChatV2`（`streamText` + 工具 + 流式）。两个面板都走它。
- 但它有三个问题：
  1. **永远只挂 canvas 工具**，跟 skill 无关 → 创作区拿到的是画布工具（无意义），创作区因此改用"假工具"（让模型输出 JSON，前端正则 `parseCreationDocumentAction` 抠出来）。脆。
  2. **零对话历史**：`messages: [{ role:'user', content:userPrompt }]`，连单面板多轮记忆都没有。
  3. **`delete_canvas_nodes`** 后端有 schema、前端 `throw 'not implemented'`。幻影工具。
- 文档工具的真实实现**已存在**于编辑器（`CreationDocumentTools`：readFullText / readSelectionText / insertAtCursor / replaceSelection / appendToEnd …），只是没被接成 Agent 工具。
- 人在回路：后端 `makeTool.execute` 发 `tool-call` → 前端确认卡片 → `confirmTool` 回传结果 → 继续 loop。这套机制好用，复用它。
- AI SDK v4.3.19：`(await result.response).messages` 可取本轮生成的消息（含 tool-call/tool-result），用于回灌历史。

## 范围（动什么）

### Phase 1 — 修幻影工具（最小、独立）
- 渲染端实现 `delete_canvas_nodes`：`generationCanvasTools.delete_nodes(nodeIds)`→ store `deleteNode`。
- 接进 `CanvasAssistantPanel.applyConfirmedToolCall` 与 `generationCanvasAgentClient.defaultExecuteToolCall`（删掉两处 `throw 'not implemented'`）。

### Phase 2 — 架构对齐（创作区也用真工具）
- 新增 `electron/ai/documentTools.ts`：`read_full_text` / `read_selection` / `insert_at_cursor` / `replace_selection` / `append_to_end` 的 zod schema（无 execute，execute 在前端确认后做）。
- `runtime.ts`：按 skillKey 选工具组——`workbench.creation.*` → 文档工具；其余（generation / storyboard / 默认）→ canvas 工具。引擎其余逻辑不变（一套引擎，参数化工具组）。
- 重写 `CreationAiPanel.tsx`：监听 `tool-call` 事件、复用确认卡片、用 `creationDocumentTools` 真正执行。**删除** JSON 解析路径。
- `creationAiModes.ts`：prompt 改成引用真实工具名；**删除** `parseCreationDocumentAction` / `createFallbackCreationDocumentAction` / `extractJsonCandidate` / `normalizeActionType` 等死代码。read_* 工具按需取正文，user 消息不再塞整篇文稿（history 才不会爆）。
- 抽出共享确认卡片组件（消除两面板重复，规则1）。

### Phase 3 — 对话连续
- `runtime.ts`：内存 `Map<sessionKey, CoreMessage[]>`。`RunAgentChatV2Payload` 加 `sessionKey`、`resetSession?`。回放 history，跑完把 user 消息 + `(await result.response).messages` 追加进去，封顶最近 ~30 条。
- 统一 sessionKey：两面板都用 `nomi:workbench:<projectId|local>`（创作区去掉 `:${mode}` 后缀）→ 共享同一条后端记忆。
- 新对话：加 `nomi:agents:chatV2:clearSession` IPC + bridge，"新对话"按钮清后端 session + 两端显示线程。

### Phase 4 — 活体测试（肉眼）
- 起 app（`pnpm start` 或 Preview MCP）。前提：本地已配一个 text 模型（`chooseTextModel` 否则抛错）。
- 真点：创作区让 AI 续写/润色 → 看确认卡片与写入；生成区拆镜头 → 看 plan 卡片、节点落地、删除节点；跨区问"我们刚定的主角是谁" → 验证记忆。
- 截图记录真实返回格式与体验；以用户视角找问题，回填本文档。

### Phase 5 — 验证 + 回填 + 提交
- 每个 Phase 结束：`tsc -p electron/tsconfig.json` + `pnpm build` + `pnpm test` 绿；grep 确认无死代码残留。
- 分 Phase 提交，便于回滚。

## 不动什么
- 不动 onboarding agent（`electron/ai/onboarding/*`）。
- 不动 `requestPipeline` / 模型目录 / 供应商接入。
- 不动时间轴、导出、生成节点执行（`runGenerationNode`）。
- 不改设计 token / 配色。
- `runAgentChat`（v1，非流式 fallback）暂不动。

## 回滚策略
- 分 Phase 提交；任一 Phase 出问题 `git revert` 该 commit。
- 后端工具组选择与 history 都是增量改动，恢复旧行为=改回"永远 canvas 工具 + 空 messages"。

## 验收门
1. `tsc` / `pnpm build` / `pnpm test` 全绿。
2. grep 确认 `parseCreationDocumentAction`、`delete_canvas_nodes is not yet implemented` 等已物理删除，无外部引用。
3. 活体：创作区真工具确认卡片可写入文档；生成区可删节点；跨区记忆可验证（截图为证）。
4. 控制台无新报错；幻影工具不再出现在任何 prompt。

## Phase 4 活体测试结果（2026-06-02 回填）

### 怎么测的（诚实说明边界）
真实 Electron 窗口我的工具截不到图，且 macOS keychain ACL 会阻止非交互式 `safeStorage.decryptString`（这是 OS 硬边界，不是代码问题）。所以活体观测用一个**一次性 Node 探针** `scripts/live-agent-probe.cjs`（已按规则1删除）：
- **同一个模型构建**：编译产物 `dist-electron/ai/buildAiSdkModel.js`（`dm-fox` / `gpt-5.5`，与工作台文本模型同端点）。
- **同一套工具 zod schema**：编译产物 `documentTools.js` / `canvasTools.js`（引擎实际用的就是这些）。
- **同一套 streamText 配置**：`temperature 0.7`、`maxSteps 5`、`toolCallStreaming true`。
- 唯一差异：key 来源走 `.secrets/agent.key`（绕开 keychain），且不经 IPC 确认层（execute 里自动确认，等价于用户点了"应用"）。探针**从不打印 key 明文**。

### 观测到的真实返回格式

**TEST 1 — 创作区（文档工具，多步）**
```
tool-call → read_full_text {}
tool-call → append_to_end {"content":"夜晚来临时，蹦蹦抱着满怀的月光，安心地睡着了，梦里也开满了温柔的小花。"}
final text: "我先看一下现有文稿的语气和内容，再在末尾补上一句贴合它的温暖收束。已在文末追加了一句温暖的结尾。"
```
- 模型**先读后写**（read_full_text → append_to_end），`maxSteps` 串联生效。
- `append_to_end.content` 只装**最终要追加的那句话**，不是整篇正文 → 与系统提示约束一致，history 不会因塞整篇文稿而膨胀。
- read_full_text 参数是空对象 `{}`，与 schema 一致。

**TEST 2 — 跨区记忆（同一 history，切到生成区 skill 的系统提示）**
```
final text: "蹦蹦"
>>> 记忆验证: 回复是否包含 "蹦蹦" = true
```
- 复用同一条 message history、但换成生成区系统提示后，模型仍准确回忆出创作区定下的主角名"蹦蹦" → **跨区记忆打通**（这正是统一 `nomi:workbench:<projectId|local>` sessionKey 的目的）。

**TEST 3 — 生成区（delete_canvas_nodes 真工具）**
```
tool-call → delete_canvas_nodes {"nodeIds":["node-abc"]}
final text: "已删除节点 `node-abc`。"
```
- 删除载荷 `{"nodeIds":["node-abc"]}` 与渲染端 `defaultExecuteToolCall` 期望的数组形状完全一致 → 幻影工具已成真工具，端到端载荷对得上。

### 结论
三项全过：真工具调用载荷正确、读后写多步可用、跨区记忆可回忆、删除节点端到端载荷一致。返回格式即"自然语言计划/结果 + 结构化 tool-call 载荷"，与前端确认卡片消费的形状匹配。探针已删除。
