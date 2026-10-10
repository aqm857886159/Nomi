# 付费卡并进对话投影（B）· 设计卡 + 方向检查

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：付费卡并进对话投影（删 1.5 秒轮询，「等用户」只留一种表示）
线/负责人：L-cardproj（Opus）        类别：[花钱][可打断]（不新增界面）
前置：付费卡①（#947，已合）。后续：C1（一次工具调用一条）、发动机收敛第 3–4 步。
方案来源：docs/research/2026-09-29-agent-message-layer-conformance/report.md §2.3 C4、§2.4 A5、§6 B、§8、§10.6
```

## 0. 一句话

「有一笔钱在等用户点头」这件事今天有四份：Run 账本里那次出价（唯一的事实）、渲染层每 1.5 秒拉一次的副本、主进程一张「谁在等这一笔」的转接表、闸里一份不进投影的 hold。这一刀只留账本那一份：面板从推过来的对话投影里读它，回合从账本里看它关没关，输入框也从同一份投影里认它。**用户看到的卡、按钮、文案、出现时机一律不变**。

## 1. 现状：四份「等你确认」（09-29 对照报告 A5 + 本次实查）

| # | 表示 | 位置 | 谁写 | 谁读 | 这一刀 |
|---|---|---|---|---|---|
| ① | 账本：这一次出价开着、还有没决定的镜 | `productionPendingSpend.awaitingSpendDecision` | Run reducer（present / 每镜决定 / × / 收回 / 删草稿） | 下面三份都从它抄 | **留，唯一事实** |
| ② | 渲染层副本：每 1.5 秒拉 `pendingSpend` | `useAgentPanelSpendConfirm.ts` 的 `POLL_INTERVAL_MS`、`refresh()`；IPC `nomi:production-runs:pending-spend` | 渲染层定时器 | 介入槽、卡体 | **删**，换成对话投影里的 `spend` |
| ③ | 转接表：`operationId → 正在等它的回合` | `spendDecisionWaiters.ts`（进程内 Map），`appIntegrationSpendConfirm.settleWaiterIfClosed` 递结论 | 每个卡上动作之后手工递一次 | `laneExtendedDesktopPorts.preflightGenerate` | **删**，回合直接看账本里这次出价关没关 |
| ④ | 闸的 hold 不进投影 → 等付费卡时输入框状态是 `running` 不是 `awaiting-approval` | `laneApprovalGate.hold` / `laneComposerIntent.laneComposerState` | 闸 | 输入框意图 | hold 留作「等」的机制（打断、关窗、打字都在这里）；输入框状态改由投影里的 `spend` 认 |

「正在发出」那几份（渲染层 `busy` / `batchView` / `stoppedDuringAction`，主进程 `spendCardActionQueue`）是**点击在路上**的本地状态，不是「等用户」，这一刀不动：它们各管一段 IPC 往返，合并只会让 × 又排到「生成剩下」后面去（10-02 搞破坏线 X2 的形状）。

**不走 lane 的待决付费有没有（报告 §10.6，删轮询前必须枚举）**：实查结论——
- 出卡只认 `origin.host === "nomi"` 的 Run（`awaitingSpendDecision`），而这个章只有 lane 的生成适配器盖（`generationTransportAdapters.ts` `plan()`；`generationSpendDecision.ts`、`runOwnedGenerationGateAuthority.ts` 盖的是决门之后的 `start` / `gate_request`，不新开出价）。画布单节点 ↑（L-cut1）的 Run 是 `origin.host: "canvas"` + `cardHidden`，外部 MCP 是外部宿主章，都不出这张卡。
- 渲染层 IPC 白名单里有 `generation.present`（`productionRunIpc.ts` `RENDERER_COMMAND_TYPES`），但 `src/` 里没有任何调用者。
- **有一种「卡开着、没有回合在等」**：全自动档代答失败（`decideByPolicyAfterDraft` 抛）→ 工具回失败、计划停在「已封印 + 门在等」→ 卡照样出现等用户（09-18 裁决「策略答不了才问人」）。所以面板的卡**必须从账本投影**，不能从 hold 派生——这正是本设计让 `spend` 住在工作区投影、而不是挂在闸上的原因。

## 2. 改成什么样

```
Run 账本（唯一事实）
  ├─ 主进程 Run 变更 / 全自动代答收尾 / 常驻生成面换相 ──► laneDesktopSpend（每个项目一份，惰性重读、同一宏任务合并）
  │        └─► 工作区投影 LaneWorkspaceProjection.spend（PendingSpendRead：off / ready+rows / unreadable）──推──► 面板
  │                 面板：useAgentPanelSpendConfirm(spend) 画卡；laneComposerState 认「在跑且有卡 = 等你确认」
  └─ laneDesktopSpend.cardClosed(operationId) ──► preflightGenerate 的 hold 收尾（卡关了 → 读逐镜结局）
卡上动作（改参数 / 生成这张 / 生成剩下 / 去掉这张 / ×）照旧走原来的 IPC；改参数的回包直接带回宿主算好的那张卡（正式报价），不再另读一次。
```

- 读出价的函数只有一个：`residentSurfaceLifecycle.readPendingSpend`（按常驻生成面的相回 off / ready / unreadable；ready 时调能力核装上的 `listPendingSpend`）。旧的 `listPendingSpendConfirmations` + IPC `pending-spend` + 预载桥方法 + `productionRunApi.pendingSpend` 同批删。
- 「装好了却没装读口」那条运行时检查变成类型：ready 相自己带着读口。
- hold 的结局 `confirmed` / `declined` 两种在代码里从来走同一支（都去读逐镜结局），合成一种 `card-closed`。
- 走查探针（5 个真 App 走查直接调 `productionRuns.pendingSpend`）改读同一份对话投影：渲染层在 `__nomiE2E=1` 下挂只读的 `window.__nomiLaneWorkspace`（仓里已有的 E2E 桥写法）。

## 3. 九格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当 Agent 说「我来生成这几张」时，我想在面板里看到报价卡、逐张点「生成这张 / 去掉这张 / 生成剩下」或 ×，以便只为我点了的那几张花钱。步骤：①发一句话让 Agent 起草 ②卡出现 ③翻页、改参数 ④点「生成这张」→ 卡翻到下一张 ⑤点 × 或打字改口 ⑥回合拿到逐镜结局继续说话。**不做**：C1（一次调用一条）、SDK 升级、任何样子变化、状态点 / 收起坞计数（见 §6 待拍板）。**已知坑**：卡出现的时机从「最多晚 1.5 秒」变成「Run 一变就推」，所以卡会更早出现（同一帧内），这是唯一的时序差。真实任务：(a) 分镜文稿起 3 镜让 Agent 生成、逐张点；(b) 生成剩下 6 张中途 ×；(c) 卡开着时关窗再开。 | 真任务需真 App，本线 `unverified`（用户在用电脑，不起真 App）；交独立验收线 |
| ★2 谁说了算 | 「这一笔在等用户点头」唯一 owner = Run 账本 + `awaitingSpendDecision`（概念 `spend.pending-identity` 的写接口 `projectPendingSpendConfirm` 不变）；「回合在等」owner = `laneApprovalGate`（概念「等用户」，converged）。新读者 `laneDesktopSpend.ts` 只读 `PendingSpendRead`，不碰 `PendingSpendConfirm` 写口。删一个消费者（`spendDecisionWaiters.ts`）。 | `node scripts/door-map.mjs pendingSpend listPendingSpendConfirmations registerSpendWaiter settleSpendWaiter`（前 7 扇，见 §7） |
| ★3 一致与复用 | 推送照抄任务卡那条（`laneDesktopTasks.ts`：`subscribeProductionRunChanges` → `refreshTasks()` → 重发投影）；关没关用现成的 `currentPresentation` / `presentationIsOpen`；读失败的话术照旧走 `missingInterventionCard`。不引新库、不自写状态机。自写的只有一个接线文件 `laneDesktopSpend.ts`（领域约束：按镜头花钱的出价要推进对话投影，框架里没有这件事）。 | `pnpm run check:self-written`；`git grep subscribeProductionRunChanges` |
| ★4 全状态 | 全部沿用今天的长相：无卡（槽空）/ 读不到（会说话的卡，原两种原因原样）/ 有卡等你 / 「生成这张」在路上（动作置灰、× 可点）/「生成剩下」在跑（标题「正在发出 k/N」、只留 ×）/ 正在停下 / 停下提示（8 秒 toast）/ 卡关了（槽空、流里一行收据）。文案一个字不改。 | `check:i18n`；`tests/ux/spend-panel-write-ownership.test.mjs` 断言标题 / toast 原文 |
| 5 中途表 | 见 §4 | 特征测试 + 宿主级测试 |
| 6 外部数据与失败 | 外部来源不变（供应商请求链一行没碰）。新增的只是进程内的推送：能力核没起来 → `off`（无卡，同今天）；能力核装配失败 → `unreadable: surface-unavailable`（同今天的「付费确认没装起来」卡）；投影抛（`pending_spend_projection_empty`）→ `unreadable: projection-failed`（同今天的「连不上」卡）。 | `electron/capabilityCore/residentSurfaceLifecycle.ts`；`missingInterventionCard.ts` |
| 7 性能预算 | 今天：面板挂着就每 1.5 秒把项目里每个 Run 文件读一遍（空闲也读）。改后：只在 Agent 出价的 Run 变了 / 全自动代答收尾 / 换相时重读一次，同一宏任务里的多次变更合并成一次；空闲时 0 次。 | 只记录：`laneDesktopSpend.test.ts` 数「10 次变更 → 1 次读」 |
| 8 真实条件 | Windows ✓（本机单测）；英文界面 / 真付费 / 真 App 关窗重启 = `unverified`（不起真 App，不花钱）。 | 交独立验收：`tests/ux/agent-spend-card.walk.mjs`、`agent-spend-stop-midway.walk.mjs`、`_agentSpendScopeJourney.mjs` |
| ★9 验收与回滚 | 验收：另一条线跑上面三条真 App 走查（零额度夹具）+ 本卡 §8 核对清单；回滚：整串提交 revert（数据无迁移，Run 账本格式一字未动）。 | PR `## 独立验收` |

## 4. 中途表（卡在等用户时被打断，钱和卡各是什么状态）

「今天」与「改后」逐格相同；改后一列只写不同之处，没写的就是相同。

| 此刻 \ 打断 | 关窗 | 断网 | 重启 | 连点 | 按停 / 切项目 |
|---|---|---|---|---|---|
| **A 卡出现，一张都没点** | 窗没了；lane 关 → 闸把 hold 收成 `cancelled(window-closed)` → 收回这次出价（计划回草稿）。**不扣**。回执：重开后流里那次 `generate` 记「被停」。 | 卡照常（投影是进程内的，不走网）。不扣。 | 进程死 → 启动清扫收回出价。不扣。重开不复活卡。 | 只读，无动作。 | 同关窗，原因 `stopped`。不扣。 |
| **B「生成这张」在路上** | 主进程那一镜照常批完、照常派发 → **扣这一镜**；没点的镜不发。回执：重开后画布落图；回合那条记「被停」+ 逐镜结局。（= 「关窗后已批的照发」） | 派发失败按 Run 自己的提交出口判「没受理 / 结果未知」，与本刀无关。 | 已落盘的提交意图按 Run 恢复；没批下的不发。 | 渲染层 `busy` 挡第二下；主进程 `serializeCardAction` + 「这镜已决定」挡第三道 → 只发一次。 | × 立刻送到主进程（不排队）；那一镜若已批下照样扣，提示「发出了 1 段，剩下 N 段没发」。 |
| **C「生成剩下」在跑** | 已批下的照发、照扣；没轮到的不发。 | 同 B。 | 同 B。 | 按钮在跑时不渲染。 | × 在两张之间生效，提示「发出了 k 段，剩下 N−k 段没发」。 |
| **D 卡关了（都决定了 / ×）** | 回合已拿到结局；关窗只影响后续对话。 | — | — | — | — |
| **E 孤儿卡（全自动代答失败，没有回合在等）** | 窗关 → 卡跟着消失；重开后清扫收回（今天同）。不扣。 | 同 A。 | 同 A。 | 同 B。 | 不影响（没有回合在等）。**改后**：输入框状态仍是「空闲」（只有在跑且有卡才算「等你确认」），打字开新一轮，不会被当成对这张卡的回答——与今天一致。 |

改后唯一的行为差（不是样子差）：**这次出价被卡上动作以外的路径关掉时（例如计划被取消），正在等这张卡的回合今天不会被唤醒**（转接表只在卡上四个动作之后递结论），回合一直挂着直到用户打字或按停；改后回合看到「这次出价关了」就醒，读逐镜结局继续说话。这是修一个挂起，计入特征测试。

## 5. 方向检查（RW）

`node scripts/fix-churn.mjs`（2026-10-05，14 天窗口）：

| 文件 | 近 14 天 fix | 这一刀碰不碰 |
|---|---|---|
| `src/workbench/ai/v4/useAgentPanelSpendConfirm.ts` | 11 | 碰（删轮询） |
| `electron/capabilityCore/appIntegrationSpendConfirm.ts` | 8 | 碰（删读口、删递结论） |
| `electron/agentLane/laneExtendedDesktopPorts.ts` | 6 | 碰（hold 看账本） |
| `src/workbench/ai/ProjectAgentResidentShell.tsx` | 4 | 碰（传参） |
| `electron/agentLane/laneDesktopRuntime.ts` | 3 | 碰（接线） |
| `electron/productionRun/productionPendingSpend.ts` | 2 | 不碰 |
| `src/workbench/ai/v4/` 目录里另有 19 个文件 ≥2 | — | 只碰上面两个 |

**0. 一句话根因**：「等用户点头」的事实在 Run 账本里，但三个读者（面板、回合、输入框）各自抄了一份并用不同的节拍同步（1.5 秒轮询、动作后手工递、根本不同步），每一次修补都是在补「副本和账本对不上」的某一个缝。

**1. 归类**（14 天内这一带的 fix，按直接原因）：

| bug 形状 | 直接原因 | 类 |
|---|---|---|
| × 被「生成剩下」吞掉（e48944727）、停下提示说错张数（3bd287fb2） | 渲染层副本落后于宿主，× 带旧报价被挡 | 副本与账本不同步 |
| 全自动档下卡闪一下（「刚授权过又被问一遍」那一族，`policySpendDecision.ts` 文件头） | 轮询读到了代答前那一刻的草稿 | 副本与账本不同步 |
| 「读不到 ≠ 没有」两轮（09-12 / 09-13 / 09-14，`PendingSpendRead` 注释） | 轮询把失败写成空 | 副本的失败语义 |
| 回合等不到结论 / 撞 60 秒（09-22 裁决 A、`spendDecisionWaiters.ts` 文件头） | 结论靠动作后手工递 | 转接表 |
| 输入框等卡时是 `running`（报告 C4） | hold 不进投影 | 第四份表示 |

**2. 为什么会一直冒**：副本存在，就要有人维护「副本何时刷新、刷新失败算什么、动作后要不要手工刷」；每条新路径（逐镜、生成剩下、× 不排队、全自动代答）都得在三处各补一次同步。

**3. 不改结构的预测**（可验证）：
| 预测 | 怎么验证 |
|---|---|
| 计划被取消时等卡的回合挂住，直到用户打字 / 按停 | 本刀特征测试「计划取消 → 回合醒」改前红 |
| 发动机收敛第 3 步（批量进 Run）会给 `PendingSpendConfirm` 加第二个生产者，轮询节拍下又会出现「卡晚 1.5 秒 / 闪一下」 | 收敛方案 §4 已列为 B 的前置 |
| C1 要把审批放进工具 part，若卡还靠轮询，同一次批准会在投影和副本里各一份 | 报告 §4.4 |

**4. 靶子独立性**：特征测试由本线写，但断言的是今天的用户可见行为（标题、toast 原文、供应商收到哪几张），不是新实现的内部形状；真 App 走查由独立验收线跑。

**5. P0**：不是我们独有的那一半（推送订阅、请求-回包）全部用现成的（Electron IPC 推送、已有的 Run 变更订阅）；独有的是「按镜头的出价」这个事实本身。

**6. 补 / 重写 / 删**：

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 补 | 轮询间隔调小、动作后多刷一次 | 小 | 下一个路径照旧漏 | 否 |
| 重写（限一个模块） | — | — | — | 否 |
| **删** | 删副本（轮询、转接表、IPC 读口），三个读者都从账本推出的同一份投影读 | 中：约 15 个文件 | 中：花钱路径，靠特征测试 + 宿主级测试兜 | **是**（09-29 用户已拍板 B） |

**7. 用户要权衡的核心**：无新的取舍——这是已拍板的 B。唯一留给用户的是 §6 的界面问题。

## 6. 待拍板（界面，不在本刀做）

「等付费卡」时，标题栏状态点仍显示「在跑」（蓝），收起坞的待确认计数是 0——因为这两处只认工具审批卡。要不要让它们也说「等你确认」？这会改变用户看到的样子，按规矩停在这里，出样张由用户拍板。推荐：做（状态点和计数读同一份 `spend`，两行改动），但不在本刀。

## 7. 门表（door-map）

改前（2026-10-05，`origin/main` 3e43bea11）：

```
node scripts/door-map.mjs pendingSpend listPendingSpendConfirmations registerSpendWaiter settleSpendWaiter
  写入口 4 扇 · 读入口 3 扇 · 共 7 扇
  [read]  electron/productionRun/productionActionIpc.ts         listPendingSpendConfirmations
  [read]  src/devlab/designLab/v4/states/07-spend-params.tsx    pendingSpend   （局部变量名，假阳性）
  [read]  src/workbench/ai/v4/useAgentPanelSpendConfirm.ts      pendingSpend
  [write] electron/agentLane/laneExtendedDesktopPorts.ts        registerSpendWaiter
  [write] electron/capabilityCore/appIntegrationSpendConfirm.ts settleSpendWaiter
  [write] src/workbench/ai/v4/useAgentPanelSpendConfirm.ts      pendingSpend
  [write] src/workbench/production/productionRunApi.ts          pendingSpend
```

改后（同一组符号再加新的读口）：

```
node scripts/door-map.mjs pendingSpend listPendingSpendConfirmations readPendingSpend registerSpendWaiter settleSpendWaiter whenCardCloses watchSpendCardClose
  渲染层：0 扇（只剩设计实验室里一个叫 pendingSpend 的局部变量，假阳性）
  [read]  electron/capabilityCore/residentSurfaceLifecycle.ts   readPendingSpend   （唯一读口的定义 + ready 相字段）
  [read]  electron/agentLane/laneDesktopSpend.ts                readPendingSpend   （唯一消费者：推进对话投影）
  [write] electron/agentLane/laneDesktopSpend.ts                watchSpendCardClose（定义 whenCardCloses）
  [read]  electron/agentLane/laneExtendedDesktopPorts.ts        whenCardCloses     （唯一消费者：generate 的等待）
  （另有 agentPanelSpendConfirmTestUtils.ts 一扇——测试夹具，文件名不带 .test 被扫进来）
  registerSpendWaiter / settleSpendWaiter / listPendingSpendConfirmations / productionRunApi.pendingSpend：0 扇（已删）
```

「等用户（付费卡）」的写者只有一个——Run 账本里的出价：

```
node scripts/door-map.mjs presentGenerationPlan removePresentedShot withdrawGenerationPresentation settlePresentation
  写入口 4 扇，全部在 productionRunReducer.ts / productionRunRepository.ts（概念 production.spend-card-presentation，本刀未动）
```

投影只有一条路：账本 → Run 服务事件 tap → `laneDesktopSpend` → `LaneWorkspaceProjection.spend` → 面板（卡 + 输入框状态）。

**没收的那一条**：介入槽的优先链仍是「换档 > 钱 > 工具审批」三选一（`ProjectAgentResidentShell.tsx`）。报告建议收成两选一，但换档卡是渲染层本地的「刚点了全自动」回应、不是宿主事实，钱和工具审批的先后是产品规则（钱撤不回来）；两路数据现在已经同源（同一份推送），把链挪进一个函数只是搬代码，不减少表示，所以不动。

## 8. 给独立验收线的核对清单

1. `git grep -n "POLL_INTERVAL_MS\|setInterval" src/workbench/ai/v4/useAgentPanelSpendConfirm.ts` 无结果。
2. `git grep -n "pending-spend\|pendingSpend(" -- src electron` 只剩测试 / 走查探针以外 0 处。
3. `electron/capabilityCore/spendDecisionWaiters.ts` 不存在。
4. 零额度夹具跑 `tests/ux/agent-spend-card.walk.mjs`、`tests/ux/agent-spend-stop-midway.walk.mjs`：卡出现、改参数、生成这张、生成剩下中途 ×、关窗重开，截图与改前逐张对比，样子一致。
5. 卡开着时让这份计划被取消（卡上动作以外的关卡路径）：回合醒来说结局（改前会挂住）。
6. 全自动档：不出卡；把模型换成会拒的、让代答失败：卡出现、输入框打字开新一轮。
7. 改前改后 `C:\Users\<你>\Documents\Nomi Projects` 指纹一致（走查用隔离资料）。
