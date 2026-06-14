# 创作 AI 流式 turn 控制器（相3 P1）

**分支**：`fix/creation-streaming`　**关联**：`docs/audit/2026-06-14-ultra-deep-mechanism-audit.md` §2.6、`docs/plan/2026-06-14-ultra-audit-remediation.md` 相3 P1。

## 病根

创作 AI 助手在途流式的生命周期（`sending` / `cancelRef` / `pendingToolCalls` / `pendingId`）是 `CreationAiPanel` 的**组件局部 state**，与项目切换无共享中止信号。后果：

1. **切项目/新对话串台**：`swapCreationAiProject` 换了 store 里的 messages，但没人调 `cancelRef.current()`；在途 `runWorkbenchAgent` 的 `onContent`/`onToolCall`/resolved 回调（捕获了稳定的 zustand setter）继续往**新项目**的消息列表/文档写——写文档卡弹到新项目，点应用把旧项目内容写进新项目文档。
2. **「停止」后无独立态**：cancel 后气泡走 `done` 分支，显示成普通完成，没有「已取消」第三态；语义上把用户主动取消和正常完成/出错混为一谈。
3. **id 用 `Date.now()`**：同毫秒两条消息 id 碰撞 → 串气泡/渲染键冲突。

> 说明：流层（`desktopAgentsChatStream.stop()`）已在 cancel 时合成 `result`+`done` 终止事件，await 链不会永挂——所以本次重点是**串台**与**态/ id**，不是「永不 settle」。

## 方案：单一 turn 控制器

新增 `src/workbench/creation/creationTurnController.ts`——一个 zustand store，收口创作区在途轮次的全部易变状态，组件局部不再持有：

- `turnId`（单调计数器）：标识当前活动轮次；递增即作废旧轮次。
- `sending`：是否有在途轮次（驱动发送/停止按钮，替代局部 `sending`）。
- `cancel`：当前轮次的流取消句柄。
- `pendingToolCalls`：待用户批准的写文档卡（替代局部 state）。
- `messageSeq`：单调消息 id 计数器（替代 `Date.now()`）。

动作：

| API | 语义 |
|---|---|
| `begin()` | `++turnId`、`sending=true`、`cancel=null`，返回 `{ id, isCurrent() }` |
| `attachCancel(id, fn)` | 仅当 `id` 仍是当前轮次才挂取消句柄 |
| `finish(id)` | 仅当 `id` 当前：`sending=false`、`cancel=null`（正常/取消收尾） |
| `requestUserCancel()` | 用户点「停止」：调 `cancel()`，**保留**当前轮次（让 resolved 分支把气泡落到 `cancelled`） |
| `abandon()` | 切项目/新对话/卸载：调 `cancel()` + `++turnId`（作废）+ `sending=false` + 拒绝并清空 `pendingToolCalls` |
| `addPendingToolCall` / `resolvePendingToolCall` / `clearPendingToolCalls(reject?)` | 写卡增删；清空可选 reject 各 confirm |
| `nextMessageId(role)` | `creation_ai_<role>_<++messageSeq>` 单调唯一 |

### 接线

- **CreationAiPanel**：`sending`/`pendingToolCalls` 改读控制器；`send()`、`launchStoryboardPlanning()` 改用 `begin/attachCancel/finish`，所有 `onContent/onToolCall/resolved/catch/finally` 用 `isCurrent(id)` 守卫；停止按钮 → `requestUserCancel()`；resolved 分支检测 `response.raw?.cancelled` → 落 `status:'cancelled'`；新对话先 `abandon()`；`useEffect` 卸载 `abandon()`；所有 id 走 `nextMessageId`。
- **workbenchStore.swapCreationAiProject**：进函数即 `abandonCreationTurn()`（结构性保证：任何「创作区切项目」都先中止在途轮次）。
- **workbenchAiTypes**：`status` 联合加 `'cancelled'`。

## 不动

- `electron/*`、`generationCanvas/`（生成区同类病另案）、`src/workbench/project`、`export`。
- 流层 `desktopAgentsChatStream`（cancel 终止合成已正确）。
- 编辑器受控回灌保留 selection（相3 另一条 P1，非本窗口任务）。

## 回滚

单分支单提交集；回退 `git revert` 该范围 commit 即恢复局部 state 形态。

## 验收门

- 单测：turn 控制器状态机（begin/作废/finish/abandon/user-cancel/id 单调）。
- 五门全过。
- 真机走查（R13）：① 发消息→中途停止（面板不卡、立即可发下一句、气泡显示「已停止」非错误）；② 流式中切项目（旧回复不串入新项目、不弹写卡）。
