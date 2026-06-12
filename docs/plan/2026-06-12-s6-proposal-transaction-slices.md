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
| **S6-2** | `applyBatch` 原子（施工时与 S6-3 对调——reconcile 依赖 txn.committed 先存在）：中途失败补偿回滚（aborted 路径，零半截）；proposalId 贯穿；txn.committed/aborted 事件；手势上下文（source:agent+共享 txnId）；整笔=一个 Cmd+Z 步。 | 无 | I3 注入失败投影逐字节相等（单测锁）；abort 后 Cmd+Z 不复活半截 ✅ |
| **S6-3** | `reconcile()` 纯函数（逐 clientId 比对+派生字段白名单）+ `txn.committed{reconciliation}`（I4）+ property test「任意批准重放→reconciliation ok」进 CI。对账 UI（偏差时「N 处出入」+per-field diff+一键整笔撤销；正常零可见 M1）。 | 有（偏差卡，复用现卡式） | property test 绿；注入偏差显 diff |
| **S6-4** | 锁：`node.locked` 字段+`canvas.node.locked/unlocked` 事件（source 恒 user）+reducer case；gate 集成（入边 deny/出边 allow，构建时 deny）；**锁 UI 过 R8**（徽标+只读态+一键解锁，基于获批样张 v3）。 | 有（锁徽标/toggle） | R13 锁旅程；几何实测不遮挡；design-fidelity 断言 |
| **S6-5** | 整笔撤销（按 proposalId，补偿事件进 Cmd+Z 栈，入口三约束）+ 最小轨迹视图（计划卡查看步骤，读 nomi:events:read，每步走 narrate）。 | 有（撤销入口+轨迹视图） | R13 J1 扩展旅程；撤销弹确认列明丢失修改 |
| **S6b** | T1 `run_generation_batch` 工具（受理语义，S6 后 0.5d） | 无 | 确认前零网络调用；approved nodeIds≡requested |

依赖：S6-0 → S6-1 → S6-2（对账依赖 effectiveArgs）→ S6-3（aborted 依赖 txn 事件）→ S6-4（锁依赖 gate）→ S6-5（撤销依赖 proposalId+txn）。顺序施工，单会话。

## 回滚

每片独立模块，可单独 revert。S6-4 锁 UI 若超期可拆 S6-lock 子片先行（master plan §8.1b）。事务层独立模块，可降级回逐条确认（不动 applyCanvasToolCall）。

## 验收（master plan §6 验收继承）

N6/7/8 计划卡看全改全确认且改值落地由对账保证；N10 I1 属性测试绿；N11 锁旅程；N12 注入偏差显 per-field diff+一键撤销。最终 R13 J1 扩展旅程+拒绝零痕迹+中途失败零半截。

## 施工回填（2026-06-12，S6-0 ~ S6-5 全部完工）

| 片 | commit | 结果 |
|---|---|---|
| S6-0 | `9879df1` | effectiveArgs+overridesDelta 进 approved；trace 单测锁 |
| S6-1 | `d98bda2` | evaluateGate 三步纯函数收编散落 if（同 commit 删）；gate.denied 落地 |
| S6-2 | `f415ca9` | applyProposalBatch 原子+补偿回滚；canvasGestureContext（source:agent+共享 txnId/proposalId）；整笔=一个 Cmd+Z barrier；abort 拔 barrier；I3 单测+I1 数据前提锁 |
| S6-3 | `b1df404` | reconcile 纯函数（白名单=position/categoryId/空标题兜底；modelKey 静默丢弃必报）；I4 committed 必带对账；property 60 轮进 CI；偏差卡 |
| S6-4 | `98812ec` | 锁全链路：locked 字段/专用事件/reducer/gate 锁面（入边 deny 出边 allow，clientId 翻译）/NodeLockBadge 外挂（巨壳基线 937→935 反降）/Tiptap editable 只读 |
| S6-5 | `ddf57b9` | 整笔撤销=补偿事务（用户工作保留，与 Cmd+Z 前缀重放本质区分）；选择性撤销列明；入口三约束；toastAction 第二入口；最小轨迹=committed 卡步骤标签 |

**真机 R13（2026-06-12）**：锁旅程全过——选中节点→描边锁出现→点击上锁（实心锁+prompt contenteditable=false）→再点解锁（恢复可编辑）；磁盘事件 `canvas.node.locked/unlocked`（source:user，seq 递增）真实入账（bridge events.read 验证）。零额度 smoke 10 断言绿。

**与计划的偏差**：① S6-2/S6-3 对调（reconcile 依赖 txn.committed 先存在）；② 轨迹视图 v1 用 in-memory 步骤标签而非 nomi:events:read（深查看器已在 eval 体系 S1.5 落地，不重复建——P1 单一真相源）；③ 计划卡确认→整笔撤销→Cmd+Z 反悔的完整 J1 扩展旅程需 LLM 额度，逻辑已由 proposalTxn/proposalUndo 13 例单测+property 锁死，真机走查与 onboarding 实跑一起等用户额度。

**欠账**：偏差卡/committed 卡/toast 的真机视觉走查（需 LLM 提议触发）；design-fidelity 断言未加新卡（同上原因，UI 不可达）。
