# P4 真供应商加固 — 慢轮询调度器 + 锚检查点批准路径

> 收尾切片。前置：S1–S6.5（PR #155 已 MERGED 进 origin/main，a1490639）。纪律同 S 系列。
> 触发源：S6.5（PR #155）用真金验收多镜生产入口，真语义 create→真 APIMart 提交全通，但两镜卡在 `processing` 到不了 materialize，暴露两个 P4 验收门级缺口。实跑记录：`/Users/aoqimin/Desktop/nomi-p4-s6p5/docs/plan/2026-08-25-p4-s6p5-multishot-create.md` §4.2 / §8.5。
> 那个 worktree 只读参考，不改。

## 0. 一句话

修两个真供应商加固缺口到根因：① S4 批量调度器对慢真供应商轮询失效（32 次无间隔轮询毫秒级耗尽，静息后无持久再驱动 → 真视频永不 materialize）；② 锚检查点没有生产批准路径（`production.decide-gate` 拒检查点门、无自动放行、渲染层无检查点卡 → 带锚批次死锁）。用 S6.5 悬在 APIMart 的两条真任务做零新增花费的真金验收（reconcile 救回），带锚路径走零额度 E2E + 渲染层卡真机截图。

## 1. 缺口 1（重）：调度器对慢真供应商轮询失效

### 1.1 根因（file:line，已实读）

**根因 A — 无轮询节奏（`electron/productionRun/multiShotBatchScheduler.ts:121-142` `dispatchUnit`）**：
```
for (let i = 0; i < 32; i += 1) {
  const polled = await deps.submission.poll(...)   // L126 一次 provider query
  if (polled.nextAction === "materialize") { ...; return }
  if (polled.nextAction === "attention") return
  // still polling → 无任何 await sleep → 立刻下一轮
}
```
`submission.poll`（`productionGenerationSubmission.ts:499-533`）每调只做**一次** provider `query`，pending 时返回 `nextAction:"poll"`（L532）。32 次循环**无间隔** → 真视频（分钟级、query 恒返 `processing`）时 32 次 query 毫秒级打完 → `dispatchUnit` 悄悄返回（未 materialize），job 停在 `polling`。L140 注释自己写「a real provider adds a wait」——**但根本没有 wait**。loopback E2E 的 vendor `query` 恒返 `succeeded`（`multiShotBatchScheduler.e2e.test.ts:78`）→ 首轮即 materialize，从不暴露。

**根因 B — 静息后无持久再驱动**：`dispatchUnit` 返回后，`runToQuiescence`（L165-283）走到 L276「Nothing to dispatch」return `quiescent:true`。**此后没有任何东西再 kick 调度器**。现有再 kick 家只有两处：`kickSchedulerForRun`（`appIntegration.ts:383-398`）经 `reconcileOpenProjectHook`（L494-524）**仅在项目打开/切换时**触发；`resumeUnfinishedRuns`（`productionRunService.ts:637-693`）**仅在启动扫描**触发（且对语义多镜 run 因 `isSemanticSingleShot`==true 跳过 job 改写、也不 re-kick 调度器——它只驱动 legacy playbook）。→ 「一次 kick 跑到静息→在途 job 无人再 poll」。`nomi_get_run` 只读不驱动。

### 1.2 修法（对齐现有 durable/无状态机制，P1 不造第二套定时器体系）

调度器无自有状态、每 tick 从 `jobs[]`+ledger 纯派生（`batchScheduleDerivation`）——这是「重启也活」的地基，**不动**。补两处：

**A. 轮询加节奏 + 快返（`multiShotBatchScheduler.ts`）**：`dispatchUnit` 加可选 `sleep` 依赖 + 有界快轮询（默认几次、短退避），仍 pending 就**返回让 job 停在 `polling`**（不再空转 32 次）。分钟级等待交给下方持久再驱动，`runToQuiescence` 保持不阻塞请求路径。快轮询次数/退避走 options（测试可注 0 退避 = 今天行为）。理由：submission `start` 对已提交 job 返 `nextAction:"observe"`（`productionGenerationSubmission.ts:430`）→ 再进 `dispatchUnit` 安全续 poll，无重提。

**B. 持久、重启安全的再驱动（`appIntegration.ts`，调度器 owner）**：`runToQuiescence` 已返 `BatchOutcome.progress.inFlight`（`batchScheduleDerivation.ts:243-251`）。改 `kickSchedulerForRun`：一次 tick 后读 outcome，若 `inFlight>0`（有 job 在等 provider）→ 用**单个 per-run 退避 `setTimeout`** 重新 `kickSchedulerForRun`（自 reschedule）；`inFlight===0`（完成/停在用户检查点/halt）→ 不再 arm，清掉该 run 的 timer。**一个 run 一个再驱动 timer**（Map<runId,timer>），不是第二套调度系统。重启安全：进程重启后 `reconcileOpenProjectHook`（项目打开）+ startup `resumeUnfinishedRuns` 触发点会重新 `kickSchedulerForRun` → 重新 arm；durable 真相仍是 `polling` job。stopCapabilityCore 清所有 timer。

**为何不塞进 scheduler 内部循环**：scheduler 设计成「跑到静息就返回、无自有状态」正是为了重启安全 + 请求路径不阻塞。把分钟级 sleep 塞进 `runToQuiescence` 会让请求路径（gate confirm→start）挂几分钟。再驱动住在 owner（appIntegration）符合关注点分离：scheduler 纯派生，owner 管「什么时候再喊它」。

### 1.3 E2E（`multiShotBatchScheduler.e2e.test.ts` 加「慢 vendor」用例）

loopback vendor `query` 头 N 次返 `processing`、之后 `succeeded`。断言：单次 `runToQuiescence` 后 job 仍 `polling`（未 materialize）；多次 `runToQuiescence`（模拟再驱动，注 0 退避）后最终 materialize + artifact ready。**R18：测试禁墙钟轮询等待**——不用私有 waitFor/Date.now 截止；用重复调用 `runToQuiescence`（纯函数式推进）+ `waitForProduction` 一族断编排链。生产退避定时（scheduler sleep dep）是允许的（R18 只禁测试侧墙钟等待）。

## 2. 缺口 2（重）：锚检查点没有生产批准路径

### 2.1 根因（file:line，已实读）

- **①命令层拒检查点门**（`electron/capabilityCore/dispatcher.ts:378-380`）：`production.decide-gate` 只放行 `gate.scope==='stage'` 且 gateId 前缀 `gate-direction-/gate-sample-/gate-freeze-`；`anchor_checkpoint`（scope=`anchor_checkpoint`，`anchorCheckpoint.ts:43-45`）落进 `if(!creativeGate) throw 'This production gate must be decided in Nomi'`（L380）→ MCP 外部客户端（`nomi_decide_gate`）无法批检查点。
- **②渲染层无检查点卡**：`useProductionStatus.localizedGateCopy`（`useProductionStatus.ts:16-63`）无 `anchor_checkpoint` 分支 → 落 L62 raw 英文 agent 文案；`productionRunView.gateKindOf`（`productionRunView.ts:14-20`）不识别检查点（返 'stage' 兜底）；`waitingGate` 分支（`productionRunView.ts:218-252`）会把它当泛化门用 `approvalRequired` 文案（非检查点家族词汇、无锚图、无「点头开拍/只重锚」）。
- **③无自动放行配置接线**：appIntegration 构造 scheduler 时不设 `anchorAutoReleaseMs`（`multiShotBatchScheduler.ts:24-29`：undefined=永不自动放行）→ 生产带锚批次停在检查点等人。

reducer `gate.decide`（`productionRunReducer.ts:601-644`）**已泛化支持**任意 gate approve/reject（只置 status，派生读它）——检查点 approve/reject 在 reducer 层已通，缺的是命令层放行 + 渲染层卡 + reject→重锚接线。

### 2.2 修法（已拍板 T1 + 已有卡片家族词汇；不设样张前置，PR 附卡光/暗截图）

- **① 命令层放行检查点门**（`dispatcher.ts`）：`production.decide-gate` 的 `creativeGate` 判据扩入 `isAnchorCheckpointGate(gate)`（复用 `anchorCheckpoint.ts` 的 exported 判据，不重写前缀字符串）。approve/reject 都放行。MCP `nomi_decide_gate` 据此能批检查点（外部客户端路径，缺口 2③）。
- **② 渲染层检查点卡**（`useProductionStatus.ts` + `productionRunView.ts`，S3a 确认卡同族）：
  - `gateKindOf` 加 `anchor_checkpoint` → 新 kind `'checkpoint'`；`ProductionGateKind` 加 `'checkpoint'`。
  - `localizedGateCopy` 加 `anchor_checkpoint` 分支 → i18n 文案（术语人话：「主角形象」不说「锚」；「点头开拍」/「不满意只重锚」）。
  - `onPrimaryAction` 的 requestConfirm：检查点门 `kind:'plan'`（免费质量门、非花钱）、`confirmLabel`=「点头开拍」、`cancelLabel`=「只重画形象」；`details` 展示锚图（gate.jobIds → 对应 job 的 result 缩略图 / nodeId）。
  - reject 分支：检查点门 reject 走 `gate.decide status:rejected` +**接 S6 reworkShot 重锚**（锚也是 shot，role:'anchor'）——见 ③。
- **③ reject→只重锚**（接既有 `reworkProductionShot`）：检查点卡 reject → 对锚 shot（role:'anchor'）发 reworkShot（`appIntegration.ts:529` reworkProductionShot 已存在，退回 sealed→new_attempt→重标 submitted→kick scheduler）。派生（`batchScheduleDerivation.ts:53,221,264-272`）已支持「rejected → 只重锚、镜仍 blocked」——锚 new_attempt 后需新 job → `anchorDispatch` 重派锚 → 新锚 ready → 检查点重开。**验收门 §5.1 变体「锚不满意只重锚」由此闭环**。
- **④ 自动放行**（T1「可配超时自动放行」）：查 `BatchSchedulerOptions.anchorAutoReleaseMs` 已是配置家（scheduler 已消费、派生已实现 auto_release）。**但生产侧无「production policy 超时配置」字段家**——appIntegration 不注入它。裁定：**v1 不为它新造配置面**（禁做零 UI 配置面，且 T1 原文「可配超时」的配置家未建）→ 生产默认 undefined（停等人批，安全默认）。**plan 记明**：机制（scheduler+派生）已就绪，只差「production policy 里加一个超时字段 + 设置面接线」——作遗留（§7）。这不违 T1：T1 要求「停一拍、点头开拍、可重锚」——这些本切片全做；「可配超时自动放行」是 T1 的可选增强，机制已备、配置家未建，明标遗留（D4 诚实边界）。

## 3. 真供应商验收（零新增花费优先）

### 3.1 救回 S6.5 两条悬空任务（缺口 1 的真金验收，零新增花费）

S6.5 花的两条真 t2v 任务悬在 APIMart：durable run.json shot-1 `provider_accepted`→`polling` providerStatus=`processing` taskId=`task_01M0TZM4…`；shot-2 taskId=`task_01M0TZMK…`（§4.2）。缺口 1 修好后：
- 同一隔离 harness 思路（真 catalog 拷贝 + `NOMI_CAPABILITY_DIR` 隔离，`evals/lib/isoApp.mjs` prepareIsolation 现成；`tests/ux/p4-s6p5-multishot-paid.e2e.mjs` 的 lease/stdio 三坑照抄）恢复那个 Run。
- 修好的调度器（含再驱动）轮询取回两条真产物 → materialize → 画布节点回填 → ffprobe 验媒体（时长/编码）→ 截图亲读。**这就是缺口 1 的真金验收，零新增花费。**
- 若供应商侧任务已过期取不回：如实记录，跑一次最低规格重生成验收（额度默认授权，2 镜以内，报花销）。

### 3.2 带锚检查点路径（零额度 E2E + 渲染层卡真机截图）

- 零额度 E2E（loopback）：锚完成→检查点 gate 出现→approve→镜批开拍；reject→只重锚（锚新 attempt、镜不动）。断言不变量：每 Job ≤1 submit、reject 后镜 job 数不变。
- 渲染层检查点卡真机截图（光/暗）：走隔离 harness 让检查点卡真弹 GUI，Playwright 截图，亲 Read 判断（术语人话、锚图在、按钮语义对）。
- 真金带锚跑不强制（锚是图、便宜）；若判值得，跑一锚一镜小验证，报花销。

## 4. 连带小修（S6.5 记录，实查后能收就收）

- **多镜确认卡「总时长/画幅 未知」**（§4.1 摩擦）：查投影链（`mcpGenerationTools` multiShotGateProjectionFor / specs 组装）。若投影 bug（shot 传了 duration/size 却没投到卡）修掉；若数据真缺如实标注。
- **「价未知/¥0」**（§4.1 摩擦）：查 `catalogPricingResolver` 取价链。真 catalog 无 APIMart 逐模型定价 → 属「catalog 没录价」则不造价（§9 诚实边界：估不出标未知），但确保「未知」显示语义清楚**不显成 ¥0**（¥0 和未知是两码事）。

## 5. 回归（全保持）

- 单镜 E2E、S3a、elicitation、S4 批次（含现有 checkpoint→approve→shots）、S5 走查、S6 J2 返工 + 版本条。
- 单镜 create/seal/start 路径不动；scheduler 无状态派生地基不动；现有 loopback E2E（0 退避）逐字节等同。

## 6. 门禁

`check:filesize`→`check:tokens`→`check:i18n`→`check:heavy-path`→`check:test-waits`→`check:walkthroughs`→`check:test-types`→`lint:ci`→`typecheck`→`test`→`build`（`pnpm run gates`），真退出码（**别管道接 test/build**）。花钱步骤环境闸 `APIMART_E2E=1 NOMI_SPEND_OK=1`。key 绝不进日志/报告/仓库。

## 7. 遗留（交付时更新）

- **锚检查点「可配超时自动放行」的配置家未建**（§2.2④）：scheduler `anchorAutoReleaseMs` + 派生 auto_release 机制已就绪；只差 production policy 加超时字段 + 设置面接线。生产默认停等人批（安全默认）。作独立后续（需 UI 配置面 = 样张前置）。
- （沿用 S6.5 遗留）scriptText 生产 LLM planner 不接；锚「复用既有同名素材」入口不做；插镜命令层不做。

## 8. 回滚

单 PR 可回滚；关 `NOMI_MCP_GENERATION_SINGLE_SHOT_V1` 回退多镜语义面；调度器再驱动/轮询退避是纯增强（0 退避=今天），单镜/legacy 零触及。
