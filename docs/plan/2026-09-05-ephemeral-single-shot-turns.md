# single-shot 走 Host 的临时执行路，不落进用户会话

> 2026-09-05 · 状态：执行中 · 触发：`tests/ux/agent-runtime-production.walk.mjs:169`
> 「Ephemeral image judging must not touch project or local working contexts」实测报红

## 为什么要动（背后的真实摩擦）

镜级画面校验（判官）和方向规划这类「问一次、零工具、不要历史」的调用，现在和用户正常聊天走**同一条**
Host 回合流水线。后果有两个，都用户可见：

1. **机器提示词进了用户的会话**。判官那句「你是资深影视分镜审片。下面这张图是…按 Rubric…」和它的判决，
   作为 user/assistant item 落在用户项目的活动线程上，面板照原样渲染（`ProjectAgentResidentShell:240`
   只按 threadId 过滤，不看 capability）。用户点开对话，看到的是自己没说过的话。
2. **它们会变成别人的历史**。`executionPrompt` 给多轮回合拼 prior 时收的是活动线程上全部 user/assistant
   item，判官的机器提示词也在其中——用户下一轮正常对话会以「此前同一项目线程：用户：你是资深影视分镜审片…」
   开头。

第 2 条本轮已先修（见下「已完成」）。本计划处理第 1 条，也是用户拍板要的那一版：**不落进用户线程**。

## 已经确认的事实（避免重复考古）

- 反方向早已修好：`16bb1abce fix(agent): isolate single-shot prompt history` 让 single-shot **不读**
  常驻线程 transcript，并在合同里写明「The Host still stores their result item for observability」。
  也就是说「存下来」是当时的**有意决定**，不是疏漏；本计划是推翻那半个决定，理由见上。
- `runSingleShotAgent` 早就声明 `history: {kind:'ephemeral'}`，但渲染层只有一条执行路
  （`runWorkbenchAgent` → `enqueueProjectAgentTurn`），该字段对**持久化**不起作用。
- single-shot 本来就**零工具**（`agentChatPolicy.ts:195` 给它空 skillTools），所以临时路不需要
  工具审批往返——这是本方案能做小的关键。
- 走查断言读的是**盘上**快照（`readCurrentProjectAgentHostSnapshot`），所以「不落盘」即可满足，
  但用户选的版本要求面板也干净，故必须是「压根不产生」，不是「产生了再过滤」。

## 范围

1. `projectAgentExecutionCoordinatorTypes.ts` / `projectAgentExecutionCoordinator.ts`：新增
   `runEphemeral(subscriptionId, request)`，直接调用已注入的 `runAgent` 依赖，**不 dispatch 任何 mutation**、
   不进命令账本、不碰仓库。绑定校验沿用 `snapshot(subscriptionId).binding`。
2. `projectAgentIpc.ts`：新增一条 request/response 通道。附件 claim 仍走既有
   `subscriptionAttachmentResolvers`（判官要靠它把本地帧换成主进程可读的资产身份，不能丢）。
3. preload + `projectAgentBridgeTypes.ts` + `bridge.ts`：暴露该方法。
4. `src/workbench/ai/agentLoopMode.ts`：`runSingleShotAgent` 改走新路，不再经 `runWorkbenchAgent`。
5. **fail-closed 守卫**：`turn.enqueue` 收到 `capability === 'single-shot'` 直接拒绝。
   这样「回到旧路」在结构上不可能，而不是靠自觉（R28：能让门岗拦的别留给人）。

## 不动项

- 常驻多轮回合的行为、线程语义、审批/花费策略：一律不动。
- 附件 claim 的解析与准入语义不动（8447f868f 刚修好本地帧准入）。
- 面板与 UI 不动（本方案让脏数据压根不产生，不需要展示层过滤）。
- 快照 schema 与迁移不动（不新增字段，只是不再写入这类 item）。

## 回滚

单条提交，`git revert` 即回到「single-shot 仍是 Host 回合」。渲染层不留并行开关。

## 验收门

| 门 | 判据 |
|---|---|
| 真机走查 | `pnpm run build && node tests/ux/agent-runtime-production.walk.mjs` 跑到底，paidCalls 0 |
| 盘上快照 | 判官前后 `readCurrentProjectAgentHostSnapshot` 完全相等（含 hostRevision） |
| 附件准入 | 走查里本地帧判官步骤仍通过（证明 claim 没丢） |
| 结构不可回退 | 新增单测：`turn.enqueue` 带 single-shot 被拒 |
| 阳性对照 | 去掉守卫/改回旧路时，上述断言必须报红（R17） |
| 既有回归 | Host 单测、`pnpm run gates` 全绿 |

## 已完成（本轮先落的一半）

`executionPrompt` 对称补齐：single-shot 既不读常驻 prior，其 item 也不再成为别人的 prior。
含阳性对照单测（去掉过滤即报红）。即使本计划后续被推翻，这一半也独立成立。
