# electron/productionRun · electron/shared 结构评审：Run 的「派生事实」没有家（症状簇触发，2026-09-24）

触发：`check:symptom-cluster` 在 `2026-09-24-draft-shot-dispatch-honesty` 这份合同落盘后报 `electron/productionRun`（7 天 22 份）与
`electron/shared`（7 天 35 份）。R21 的要求是：第三份合同出现后先回答「这一层的结构有没有问题」，再继续修。
`electron/shared` 这一簇大半是「谁都要 import 中立契约层」的正常流量，这里只看和 Run 状态有关的那一族。

## 放在一起看

| 合同 | 那一刻用户看到的是假的什么 | 缺的是哪一个「从 Run 派生出来的事实」 |
|---|---|---|
| `2026-09-18-full-auto-spend-card-and-static-receipt` | 全自动档还弹付费卡；回执说有卡、面板没卡 | 「这一笔此刻在不在等人点头」 |
| `2026-09-20-draft-receipt-facts` | 工具回执和保存下来的方案、真实的审批决定对不上 | 「这份草稿现在处在哪一步」 |
| `2026-09-22-waiting-for-user-one-owner` | 收回出价不是终态；卡在等时打的字被读成别的 | 「这件事是不是在等用户」 |
| `2026-09-22-generate-waits-in-preflight` | 等用户的那段住在工具执行里，60 秒一到回合就断 | 同上（运行面） |
| **`2026-09-24-draft-shot-dispatch-honesty`（本次）** | 「先别生成」的草稿挂「排队中 · 第 1/1」、任务按钮亮 1 | 「这一轮用户点过头、派出去了没有」 |

五份修的对象不同，形状一样：**Run 本身是唯一真相**（`productionRunTypes.ts` 的状态机 + `productionRunState.ts` 的迁移表都很干净），
但**从 Run 推出来的、给人看的那几个事实**——在不在等人、派没派出去、这一步算不算「在跑」——没有一个固定的家。
每个界面拿自己手边的字段猜：占位节点猜「没有 job = 排队」，任务中心猜「没终止 = 在跑」，任务卡猜「status 字面是 draft = 草稿」，
回执用写死的表。猜法各不相同，出事的时候就各错各的。

## 结构结论

`electron/productionRun` 的持久层没有问题；问题在**读侧**：Run 的派生事实散落在消费者里，而不是长在 Run 旁边。
今天它们已经各自收过一次 owner——`productionPendingSpend.awaitingSpendDecision`（等你点头）、`policySpendDecision`（档位代答）、
`laneApprovalGate`（运行面的等）、本次补进 `electron/shared/productionShotPhase.ts` 的 `jobAwaitsHuman` / `isShotInDispatchedScope`（派没派出去）——但这些 owner 是**按事故一件一件长出来的**，
没有一处说「Run 能回答的问题就这几个，都在这里」。下一个新界面（例如 T-AG-24 的批量「生成全部」、T-AG-25 的任务按钮在等粗剪）
仍然会先去读 `run.status` / `plan.state` / `job.status` 的字面值，再自己拼一个判断。

证据（本次实扫）：渲染层直接读 Run 字面状态再自行判断的地方，在本次之前至少有三处——
`src/workbench/production/shotPlaceholderState.ts`（旧版「没有 job → 排队中」）、`src/workbench/taskCenter/productionRunTaskCenter.ts`（「非终态 → running」）、
`src/workbench/production/productionRunView.ts`（`run.status === 'draft'` 定标题）；主进程侧 `electron/productionRun/batchScheduleDerivation.ts` 自带一份
`authorization_required` 判断。其中任务中心那两处已由 #869 重做（草稿不进任务列表、等人的归「等你处理」），任务卡标题随之走 #869 的分组；画布那处与调度器本次接到 `productionShotPhase` 的同一张人工门表。

## 建议（结构层面，不在本 PR 实施）

1. **把 Run 的派生事实收成一个模块**（候选位置 `electron/shared/contracts/productionRunFacts.ts`）：「派没派出去」（今天在 `productionShotPhase` 的人工门表）、
   `awaitingSpendDecision` 的判据部分、「在等用户」、「在跑」都住在这里，主进程与渲染层同读。已有的 owner 迁过去时只搬判据、不改行为。
2. **加一道棘轮门岗**（同 `check:vocabularies` 的做法）：`src/` 里不许出现 `run.status ===` / `generationPlan.state ===` / `job.status ===`
   这类对 Run 字面状态的直接判断（白名单只放上面那个模块与它的测试），存量记基线只减不增。这样第六个界面想自己猜的时候，编译前就红。
3. **任务中心的「在跑 / 在等你」要分开说**：今天 `running` 组同时装着「供应商那边在跑」和「在等你拍板」（方向 / 剧本 / 分镜 / 合同 / 粗剪），
   任务按钮对两者一样亮。这是 T-AG-25 的产品问题，要先问用户，但它和第 1 条是同一个「派生事实」的家。

## 本次没有做的

- 没有迁移已有的 owner（第 1 条）——那会碰花钱确认面与运行面，属于架构改动，按 R4/R7 单独出方案。
- 没有加第 2 条门岗——需要先有第 1 条的模块才有白名单可放。
