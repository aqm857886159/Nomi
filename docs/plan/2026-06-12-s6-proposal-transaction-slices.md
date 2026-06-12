# S6 提议事务主体 —— 子切片施工文档（R4）

> 上游唯一真相源：`docs/plan/2026-06-11-nomi-harness-master-plan.md` §6（L 模块）+ §8.1b（S6 不动项/回滚/验收）。
> 本文只做一件事：把 master plan 当整块（4.5-5.5d）的 S6 **拆成可独立 push 的子切片**，每片五门全过才 commit。
> 现状盘点见本 session Explore 报告（已并入下方「根因坐标」）。

## 范围（master plan §8.1 行）

提议事务主体：状态机 / applyBatch 原子 / 锁[含锁 UI 过 R8] / 对账 effectiveArgs 全量快照 / evaluateGate 收编[同 commit 删散落 if] / 选择性撤销 / 最小轨迹视图 + T2 meta。

## 不动项（master plan §8.1b 继承）

- `applyCanvasToolCall` 的单一真相源地位不变——事务层**包裹在它外面**，不重写写后立读 9 处。
- `buildDependencyWaves`（已落地，dependencyWaves.ts）不改签名，batch-run intent 复用它。
- `makeAgentTool` 确认门管道（agentChatV2.ts:239）+ `pendingConfirmations` 挂起/恢复不重写，只扩 payload。
- S5 影子日志 emitter/reducer/undoJournal 不重写，锁事件作为新 case 接进 reducer。

## 现状根因坐标（Explore 盘点，与 master plan 两处出入已修正）

- **override 蒸发**：`CanvasAssistantPanel.tsx:248` 算出 `effectiveArgs` 应用到 store，但 `:252 event.confirm({ok,result})` 不带它 → `workbenchAgentRunner.ts:97` → IPC `confirmTool`（agentChatV2Ipc.ts:90）→ `traceToolDecision({ok})`（agentChatTrace.ts:115）→ `agent.proposal.approved` payload 只有 `{toolCallId}`。
- **散落 gate if**：`CanvasAssistantPanel.tsx:228` 硬编码字符串门 `if (toolName==='read_canvas_state') 自动放行`，其余隐式排队（:239）。无 deny 路径。
- **GateDecision/GateIntent/evaluateGate**：全仓**未定义**（master plan 说 S2b 已定义，与现状不符——S2b 只落了 dependencyWaves）。从零建。
- **txn.committed**：schema 都没有，从零建。**gate.denied**：schema 占位（types.ts:41）无发射点。
- **proposalId**：纯 schema 占位（types.ts:19），emitter 只有 txnId，无写入点。
- **锁**：彻底空白——无 `node.locked` 字段、无事件、reducer 无 case。

## 子切片路线（每片独立 push）

| 片 | 内容 | UI? | 验收门 |
|---|---|---|---|
| **S6-0** | override 蒸发修复：`effectiveArgs`+`overridesDelta` 穿 confirm→IPC→`proposal.approved` payload（types.ts:38 注释兑现）。对账的「米」。 | 无 | typecheck+test；事件落盘带 effectiveArgs 真机验 |
| **S6-1** | `GateIntent`/`GateDecision`/`evaluateGate` 类型+纯函数（policy→invariant→ask 三步）；收编 `CanvasAssistantPanel:228` 散落 if（**同 commit 删**）；`gate.denied` 发射落地。 | 无 | 单测覆盖 allow/deny/ask；删 if 后行为不回归 |
| **S6-2** | `reconcile()` 纯函数（逐 clientId 比对+派生字段白名单）+ `txn.committed{reconciliation}`/`aborted` 事件 + property test「任意批准重放→reconciliation ok」进 CI + 四不变量 I1-I4。对账 UI（偏差时「N 处出入」+per-field diff）。 | 有（对账卡，复用现卡式） | property test 绿；注入偏差显 diff |
| **S6-3** | `applyBatch` 原子：中途失败补偿回滚（aborted 路径，零半截）；proposalId 贯穿（铸于 proposed，批量共一个）。 | 无 | R13「批量中途失败零半截」；I3 rejected/aborted 投影逐字节相等 |
| **S6-4** | 锁：`node.locked` 字段+`canvas.node.locked/unlocked` 事件（source 恒 user）+reducer case；gate 集成（入边 deny/出边 allow，构建时 deny）；**锁 UI 过 R8**（徽标+只读态+一键解锁，基于获批样张 v3）。 | 有（锁徽标/toggle） | R13 锁旅程；几何实测不遮挡；design-fidelity 断言 |
| **S6-5** | 整笔撤销（按 proposalId，补偿事件进 Cmd+Z 栈，入口三约束）+ 最小轨迹视图（计划卡查看步骤，读 nomi:events:read，每步走 narrate）。 | 有（撤销入口+轨迹视图） | R13 J1 扩展旅程；撤销弹确认列明丢失修改 |
| **S6b** | T1 `run_generation_batch` 工具（受理语义，S6 后 0.5d） | 无 | 确认前零网络调用；approved nodeIds≡requested |

依赖：S6-0 → S6-1 → S6-2（对账依赖 effectiveArgs）→ S6-3（aborted 依赖 txn 事件）→ S6-4（锁依赖 gate）→ S6-5（撤销依赖 proposalId+txn）。顺序施工，单会话。

## 回滚

每片独立模块，可单独 revert。S6-4 锁 UI 若超期可拆 S6-lock 子片先行（master plan §8.1b）。事务层独立模块，可降级回逐条确认（不动 applyCanvasToolCall）。

## 验收（master plan §6 验收继承）

N6/7/8 计划卡看全改全确认且改值落地由对账保证；N10 I1 属性测试绿；N11 锁旅程；N12 注入偏差显 per-field diff+一键撤销。最终 R13 J1 扩展旅程+拒绝零痕迹+中途失败零半截。
