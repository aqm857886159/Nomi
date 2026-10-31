# 文稿方案的生成改走自己的方案 Run · 设计卡（2026-10-16）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：📝 设计卡，**不写代码**。需要用户看样张拍板（确认卡从全局框换成 Agent 面板报价卡），排 **0.24 设计线**。
> 来由：#1203 真付费验收第三次——Agent 对文稿方案调 `generate`，弹的是旧全局确认框「生成这 2 项？」，没走策略代答，「直接生成」档与两个刹车对文稿方案都不生效。诊断见协调报告 D-L19-msplan；当期先如实标注（两档下文稿方案都每批问一次）+ 门岗（`requestConfirm` 只经 owner），本卡是结构解。

```
改动名：文稿方案的生成走它自己的方案 Run（统一付费代答入口 + 两个刹车）   线/负责人：待派（0.24 设计线）   类别：[花钱][长跑][可打断][新界面]
```

## 0. 现状（读码确认）

- Agent `generate`（文稿方案）→ `electron/capabilityCore/mcpGenerationTools.ts` 的 `present` 分支：`current.sourceDocumentId` 存在就走 `presentStoryboardAuthoring`（`mcpGenerationMultiShot.ts`）→ 渲染层 `storyboard.present`（`src/workbench/capability/storyboardPresent.ts`）→ `runStoryboardBatch` → `confirmStoryboardPlanBatch`（全局框，勾选清单）→ `consentCanvasShots`：每一镜各建一个**画布单镜 Run**，交出去时按窗口铸手势收据。
- 文稿方案自己那份方案 Run（`draft_shots` 建的 `op-…`，带 `sourceDocumentId`）**从来没有出价、付费门、job**。
- 所以 `directGenerationBrakes.ts#spendDecisionByPolicy`（档位 + 连续失败 + 计划外 + 已停止）在这条路上没有事实可读；原地加「问档位」会得到「没有刹车的自动花钱」（协调已否决）。

## 1. 目标设计

文稿方案的 `generate` 与画布草稿走**同一条**路：

1. `present` 不再把决定交给渲染层：主进程在这份方案 Run 上开一次出价（`operations.present`，带 `policySnapshot`），与画布草稿相同。
2. 「问不问」只问 `spendDecisionByPolicy(policy, 这份方案 Run)`：
   - **请求批准**：Agent 面板出报价卡（`PendingSpendConfirm`，与画布草稿同一张卡；卡上逐镜可去掉，承担原全局框「勾选这一批跑哪几镜」的职责）；
   - **直接生成**：档位代答，收据 `decidedBy: policy:full_auto`；连续失败 / 计划外 / 已停止 → 退回报价卡并多一行原因（与画布草稿一模一样）。
3. 执行与结果落在这份方案 Run 上（job 带 `metadata.shotId`），画布节点按草稿落地口（`draftLanding` / `canvasLandingHost`）落位与回填；分镜表的行状态从这份 Run 派生（与「分镜 / 画布同一份镜头」10-08 拍板同方向）。
4. 全局框 `confirmStoryboardPlanBatch` 对 Agent 发起的文稿方案**不再使用**；用户自己在分镜表上点「生成未生成的 N 镜」是否也换成同一张卡，作为本卡要拍板的连带面（默认答案：换，一功能一个家）。
5. 锚卡（参考卡）先行波次、首帧 → 镜头的依赖、生成策略门（`resolveGeneratableGate`）全部改接到方案 Run 的调度上（制作流程的锚点检查点已有同类能力）。

## 2. 删什么（P1）

- `mcpGenerationTools.ts` 的 `present` 里 `sourceDocumentId` 那一支与 `presentStoryboardAuthoring`、渲染层 `storyboard.present` 处理。
- Agent 发起路径上的 `runStoryboardBatch` → `consentCanvasShots` 那一段（若连带面拍「用户点的也换」，`confirmStoryboardPlanBatch` 同 PR 删，`eslint.config.mjs` 允许表随之收窄）。
- 设计卡与两档灰字里的已知限制「按文稿里的分镜方案出图仍会每批问一次」（实现合入同 PR 删掉）。

## 3. 九格

| 格 | 结论 |
|---|---|
| ★1 用户怎么用 | 在「创作」写好文稿，对 Agent 说「拆成 6 镜并生成」。请求批准档：Agent 面板出一张报价卡（与画布草稿同一张），逐镜可去掉，点生成才跑。直接生成档：不弹卡直接跑，同一镜连续失败 3 次、或这轮要补计划外的镜才停下问。不做：不新增第三种确认卡；不改价格显示（仍不显示价格）。主指标：直接生成档下文稿方案每批需要的点击 = 0；护栏：重复扣费 0、停止后新增提交 0。 |
| ★2 谁说了算 | 档位：`capabilityApprovalPolicy.ts`；代答与刹车：`directGenerationBrakes.ts#spendDecisionByPolicy`（唯一入口，文稿方案成为第 4 个调用路径，入口仍只有一个函数）；出价：`productionGenerationPresentation`；「说好的计划」：这份方案 Run 上曾有 job 的镜；画布落位：草稿落地口。全局框不再是文稿方案的决定者。 |
| ★3 一致与复用 | 复用画布草稿的出价 / 报价卡 / 收据 / 刹车 / 落地，全部现成；新写的只有「文稿方案的锚卡波次与策略门改接到方案 Run」。 |
| ★4 全状态 | 空（方案没有可跑的镜：回 nothing_to_generate）/ 部分已生成（只摆未生成与失败的镜）/ 失败 1、2 次自动重试、第 3 次刹车 / 计划外补镜刹车 / 已停止 / 能力不可用（没有可用模型：与画布草稿同一路径）/ 策略门挡住（缺参考：卡上说清，不开跑）。zh + en，不谈价格。 |
| 5 中途表 | 见 §4。 |
| 6 外部数据与失败 | 供应商提交 / 查询失败沿用方案 Run 的既有分类（没到供应商不计入刹车）；文稿在生成途中被改：沿用现有「方案内容冲突」判据（`assertAuthorCurrent`），冲突就不交、卡说清。 |
| ★7 性能 | 新增操作：文稿方案出价、刹车判定。最坏规模：1 份方案 40 镜（`draft_shots` 上限）× 3 次失败；刹车判定预算 p95 ≤ 50ms（已有量具 `directGenerationBrakes.perf.test.ts`，NOMI_PERF=1）；报价卡渲染沿用现有卡。 |
| 8 真实条件 | 真付费：两档各跑一次文稿方案 2 镜 + 补第 3 镜；Windows / mac 开发态；最小窗口下报价卡。 |
| ★9 验收与回滚 | 独立验收另一条线按 §5 核；回滚 = revert 回到全局框路径（当期的已知限制文案随之恢复）。迁移：已存在的、按旧路径跑过的文稿方案画布单镜 Run 不迁，历史结果照旧显示；新一轮生成走方案 Run。 |

## 4. 中途表（格 5）：文稿方案，直接生成档，生成进行中

| 状态 × 打断 | 点停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 已交出、供应商生成中 | 该镜照常扣一次、结果回填画布节点；后续镜标已停止 | 主进程继续跑，关窗不是停止 | 已交出的靠轮询恢复不重发；未交出的失败，没到供应商不计入刹车 | 从方案 Run 的 jobs 重新派生，已有 job 的镜不重发 | 同镜同 jobId，供应商只收一次 |
| 排队、尚未交出 | 派发闸 `run_stopped`，不发、不扣 | 照 Run 当前态派 | 提交前断网 = 未到供应商，不扣费 | 继续派剩余镜 | 停止幂等 |
| 刹车已触发（报价卡在面板上） | 停止 = 整轮停，出价收回 | 卡是 Run 的投影，重开面板重建 | 无外部调用 | 卡仍在，要人点 | 第一次放行，之后幂等 |

## 5. 测试计划（实现时先写必红）

- 直接生成档：文稿方案 `generate` 不弹任何框，收据 `policy:full_auto`，供应商受理 = 镜数。
- 请求批准档：文稿方案出 Agent 面板报价卡（不是全局框），点生成才受理。
- 计划外：同一请求补第 3 镜 → 刹车 2，卡上多一行原因。
- 连续失败 3 次 → 刹车 1。
- 走查：`agent-permission-two-tiers.paid.mjs` 的文稿方案两步转绿（协调真付费）。
- 门岗：`eslint.config.mjs` 的 `requestConfirm` 允许表收窄后仍绿。

## 6. 需要用户拍板（样张）

1. 文稿方案的确认从全局框换成 Agent 面板报价卡（逐镜可去掉）——要看真组件样张。
2. 连带面：用户自己在分镜表上点「生成未生成的 N 镜」是否也换成同一张卡（默认：换）。
