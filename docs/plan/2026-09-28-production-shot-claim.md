# 制作镜头「认领」：画布与制作流程的唯一花钱准入点

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：执行中（2026-09-28）。协调会话出方案，Codex 实现。对应 PR #897 施工卡 P0-1 的第一刀；吸收 PR #877（草稿镜不说「排队中」）。

## 1. 要解决的真实问题（用户视角）
同一个镜头，画布和制作流程各自决定「该谁生成」，没有共同的记录，于是（2026-09-28 在 main 2da1cf100 上复核，见 `D:\tmp\codex-report-spend-boundary.md`）：
1. 制作流程已经把这一镜发给供应商、可能已扣费，正在对账（`submission_unknown` / `reconciling`）且 Run 处于 `needs_attention` → 画布显示「已停」，还能再生成一次 → **可能重复扣费**。
2. 「提额续拍」卡等确认时，job 回到 `authorization_required`、Run `needs_attention` → 画布生成一次，确认后制作流程又生成一次 → **重复扣费**。
3. 用户删掉镜头节点（`canvasDetached`）后，调度器照样生成扣费，结果没地方落。
4. Run `needs_attention` 时调度器照样派新任务。
5. 返工卡被拒后，计划停在 `sealed`、门 `rejected`，整批镜头永远判「归制作」→ 调度器不派、画布也不让生成，**永久卡死**。
另：`beforeDispatch`（发出前最后一道检查）钩子存在但生产装配从没接线；`productionShotOwnsGeneration` 在 submitted 分支借用了**显示阶段**做归属判断（显示把几种「钱可能已花」的状态显示成 stopped/null，归属跟着错）。

## 2. 用户拍板（2026-09-28，全按推荐）
- **谁先认领谁生成**：画布先生成了这一镜，制作流程就跳过它；制作流程已发出、可能已扣费的镜头，画布不许再生成，给「去对账」。
- **删掉镜头节点**：这一镜还没发出去的生成直接取消、不扣钱；已发出的照常跑完，结果留在任务卡、不落画布。
- **返工卡被拒**：被拒的镜头交还画布，可以自己在画布上生成，也可以再发起返工。
- **范围**：这次只做「镜头认领」，修掉上面 5 类；「画布付费生成整体收进制作流程」放到官方额度之前的下一块。

## 3. 设计
### 3.1 一个判据、一个写口
| 概念 | 唯一 owner | 允许谁消费 |
|---|---|---|
| **认领判据**（这一镜此刻谁有权花钱生成） | 新纯函数 `decideShotClaim(run, shotId, requester)`，放 `electron/shared/`（主进程与渲染层都能 import） | 主进程画布付费入口、调度器派发推导、`beforeDispatch`、渲染层按钮置灰（仅体验，不作防线） |
| **认领记录**（谁认领了哪个 attempt） | ProductionRun 账本：经 `productionRunRepository.execute` → reducer 写入（P0-1 的 write owner） | 同上所有读者 |
| 显示阶段（排队中/生成中/已停…） | `deriveProductionShotState`（**只管显示，不再参与归属**） | 画布卡、任务面板 |
`productionShotOwnsGeneration` 改为委托 `decideShotClaim`（或直接被它取代，删旧不留并行版）。

### 3.2 判据（只读 durable 状态：job 状态 / Run 状态 / 门状态 / 镜头是否 included / canvasDetached / 认领记录，**不读显示阶段**）
- **计划未提交**（draft / sealed 等确认卡）：门在等（未 rejected）且镜头 included → 归制作（画布拒，原因 `awaiting_confirmation`）；门 rejected / 计划 cancelled / 镜头 excluded / canvasDetached → 画布可认领。
- **计划已提交**，看这一镜**当前 attempt 的最新 job**：
  - 钱可能已花：`submit_intent_persisted` / 已提交 / 轮询中 / `submission_unknown` / `reconciling` → 归制作；画布拒，原因 `in_flight` 或 `needs_reconcile`（界面给「去对账」）。
  - 钱还没花：`authorization_required` / `authorized`：Run 在跑 → 归制作（`queued`，马上要发）；Run `pausing/paused/needs_attention/cancelled` → **画布可认领**，认领即把这个待发 job 标成被画布取代（终态，调度器永不再发）。
  - job 已终态（成功/失败/取消/被取代）→ 画布可认领。
- **调度器派发**（制作方认领）：只在 Run `running`、镜头 included、未 canvasDetached、job 待发且未被取代、门已批准时成立；**`needs_attention` 加进停止名单**。
- **canvasDetached**：reducer 在记 detached 的同一次提交里，把这一镜**尚未发出**的 job 取消（原因 `canvas_detached`）；已发出的照常跑完、不落画布。
- **返工被拒**：门 rejected 时这一镜释放给画布；仍可再发起返工（返工走新 attempt）。

### 3.3 三处强制点（同一判据）
1. **主进程画布付费入口**：绑定了制作镜头的节点（meta 上有 runId/shotId）在主进程提交前执行 `shot.claim({by:'canvas'})`；被拒返回结构化错误码（如 `production_shot_claimed`，带 reason），渲染层映射成人话；`needs_reconcile` 给「去对账」动作（复用任务卡现有的对账入口）。渲染层的预检只负责置灰，不是防线。
2. **调度器派发推导**（`batchScheduleDerivation` / `multiShotBatchScheduler`）：派发前经判据；被画布认领/取代的 job 不派。
3. **`beforeDispatch`**：生产装配（`appIntegration.ts` 创建 submission 处）接上钩子，发往供应商前用最新 durable Run 再判一次（防竞态）。

## 先查别人

> 「他们怎么做 → 我们这批怎么做 → 判定」写在同一格；判定只有三种：一致 / 有意不同（附理由）/ 后续要改（附去处）。

| 问 | 他们怎么做 → 我们这批怎么做 → 判定 | 出处 |
|---|---|---|
| 生态里已有？（会扣费的请求怎么不重复执行） | **他们**：Stripe 每个会扣费的请求带幂等键，同一个键重放只执行一次、返回同一结果。**我们**：制作派发用 `providerIdempotencyKey`（runId + contractHash + attempt + shotId），续批要求键不变，变了就拒（`electron/productionRun/prepareProductionGenerationAuthorization.ts:421-423`）。**一致**。 | https://docs.stripe.com/api/idempotent_requests |
| 生态里已有？（一个任务同一时刻只归一个执行者） | **他们**：BullMQ 的 worker 取任务时拿锁（lock token + 过期时间），只有持锁者能完成任务；锁过期的「卡住任务」会被挪回队列。**我们**：一镜只有一个判定口 `decideShotClaim`（`electron/shared/decideShotClaim.ts:53`），画布认领按 attempt 持久化进 Run（reducer `shot.claim`），制作每次派发前再问一次（`productionShotDispatchGuard`）。**有意不同**：我们不做「过期自动转交」——可能已经花了钱的在途 / 待对账任务永远归制作（`NEEDS_RECONCILE` / `IN_FLIGHT`），超时不能把它转给画布再花一次，只能对账后决定。 | https://docs.bullmq.io/guide/workers/stalled-jobs |
| 生态里已有？（会被重试的步骤怎么保证只生效一次） | **他们**：Temporal 的活动可能被重试，官方要求活动幂等；工作流状态靠事件历史重放。**我们**：Run 是事件溯源的，唯一写口是 `applyProductionCommand`（`electron/productionRun/productionRunReducer.ts`），认领是一条带固定 commandId 的命令（`shot.claim:<run>:<shot>`），重放不会认领两次。**一致**。 | https://docs.temporal.io/activity-definition |
| 仓库里已有？ | **已有，但分散**：画布提交、Run reducer、批次调度器各自从 Run 状态的不同子集推断「这镜归谁」，没有按 attempt 落盘的认领记录（本方案根因合同的 direct_cause）；节点显示用的相位判定在 `electron/shared/productionShotPhase.ts:175`。**这批**：归属收成 `decideShotClaim` 一处，相位判定继续只管显示、改显示不许顺带改归属。 | `docs/fixes/2026-09-28-production-shot-claim.root-cause.json` |
| 依赖里已有？ | 依赖里没有任务队列 / 工作流引擎（`package.json` 没有 BullMQ、Temporal 一类）；React Flow 与 Zustand 管画布和界面状态，不管跨进程的任务归属。**结论**：没有可直接用的依赖，按上面三家的模式自研判定口。 | `package.json` |
| TikHub 自媒体里怎么说？ | **本轮未查**：这是内部的花钱边界，不是面向用户的产品能力，自媒体侧没有可比的一手经验——明着标出来，不冒充。 | — |

**结论**：用业界已验证的三件套——单一判定口、持久化的认领记录、执行前复核 + 幂等键；实现自研，因为判据依赖 Nomi 的 Run / Plan 结构。和 BullMQ 的唯一有意不同是「不做过期自动转交」，理由见上。

## 4. 不动项
画布普通节点（不属于制作流程）的生成路径；Agent/MCP 的授权卡流程本身；价格与预算规则；「画布付费生成整体收进制作流程」（下一块）。

## 5. 验收门（缺一不算完成）
- **判据矩阵单测**：job 状态 × Run 状态 × 门状态 × detached × 已有认领，逐格断言；把 5 类问题各写成「改回旧行为必红」的回归测试。
- **调度器**：`needs_attention` 不派；被取代 job 不派；detached 取消待发 job。
- **集成**：暂停 → 画布认领 → 继续剩余：该镜不再派（第 1 条已修的回归防线）；unknown/reconciling → 画布被拒且给对账；提额续拍：画布认领后确认不重复；删节点 → 不派；返工被拒 → 画布可生成、可再返工。
- **装配测试**：证明生产装配真的传入了 `beforeDispatch`。
- 改掉把错误行为钉成正确答案的测试（`productionShotPhase.test.ts:76-77, 115-120`、`productionShotOwnership.test.ts:48-54` 缺格、`batchScheduleDerivation.test.ts:333-340, 261-271`，以 2026-09-28 调查为准）。
- 根因合同 v3（`recurring`，门表用 `node scripts/door-map.mjs productionShotOwnsGeneration runTask beforeDispatch` 生成）。
- **真机付费验收（协调会话跑，小预算）**：用 `tests/ux/agent-queued-shots.paid.mjs` 一类脚本在真实资料拷贝上复现 2、3、4 三个场景，确认供应商只收到一次提交。
- 用户可见文案（被拒提示、去对账）中英文都有，截图亲眼看过。

## 6. 回滚
认领记录是新增字段，旧 Run 无记录时按判据推导；回滚即撤掉三处强制点，账本字段保留无害。
