# 发动机收敛第一刀 第 3–4 步：批量进 Run、收尾删旧（设计卡）

> 状态：✅ 已实现未推送（2026-10-05，实现线 L-cut34，分支 `feat/engine-convergence-step34`）。真付费 / 真 App 那几条 `pending-real-app`（独立验收线）。
> 上游：[`2026-10-05-engine-convergence-cut1.md`](2026-10-05-engine-convergence-cut1.md)（施工计划正本：§3 双扣地图、§5.3 第 3–4 步、§5.5 迁移、§5.6 回滚、§8 待拍板）、[`2026-10-05-engine-convergence-cut1-step12-design-card.md`](2026-10-05-engine-convergence-cut1-step12-design-card.md)（F1a 一次 ↑ 一个单镜 Run、F2b 渲染层驱动、F3b 明确拒绝可再点）、[`2026-10-05-paid-card-in-conversation.md`](2026-10-05-paid-card-in-conversation.md)（B，已合 #999）。
> 协调会话已定：§8 D（附属付费口这一刀不动，登记带到期日 2026-11-15 的例外）；第 3、4 步合成一个 PR、按阶段提交；F3 沿用 `outboundDispatchEvidence.providerExplicitlyRejected`。
> 论断带文件 / 命令；量不了的标 `unverified`。

## 0. 一句话

画布上要花钱的生成，单节点和批量现在都只从制作流程那一个口子出去：批量卡点了确认，卡上列出的每个要花钱的节点在主进程各开一份出价（一镜一个单镜 Run），轮到它才冻住请求、批、交；排队里去掉的、整批 × 的、窗口没了的，主进程收回出价、再也交不出去。画布那一侧的令牌、报价、认领、进程内在途锁整段删掉。

## 1. 方向检查（fix-churn，2026-10-05 本分支）

`node scripts/fix-churn.mjs <这一刀碰的文件>`：`productionGenerationSubmission.ts` 11（第 12）、`runtime.ts` 8（第 9）、`productionRunRepository.ts` 7（第 8）、`generationRunController.ts` 7（第 8）、`capability/` 目录 16（第 17）、`spend/` 目录 8（第 9）、`batchPlanPreview.ts` 3（第 4）、`submissionOutbox.ts` 3（第 4）、`electron/tasks/` 3（第 4）、`productionRunDriverOps.ts` 3（第 4）。全部命中 RW；复盘文档仍是施工计划正本 §0 / §3 / §6（类根因：钱从两个口子出）。这一刀是结构性收口（删令牌路），不是补丁；提交统一带 `Direction-Check: docs/plan/2026-10-05-engine-convergence-cut1.md`。

## 2. 门表

改前（`origin/main@7b81dfcb6`）：`node scripts/door-map.mjs confirmAndRunNode confirmAndRunNodeVariants regenerateNodeInPlace runGenerationNode runGenerationNodesBatch runGenerationNodesByPlan confirmGenerationSpend runWorkbenchTaskByVendor mintSpendGrant runTask claimCanvasProductionShot withNodeSubmitExclusive` → 写 38 · 读 12 · 共 50。
改后（第 3 步之后；第 4 步之后同一条命令仍是这个数——第 4 步删的是制作那一侧的旧写手与死路，不在这 12 个符号里）：同一条命令 → 写 34 · 读 11 · 共 45。消失的：`claimCanvasProductionShot`（`runtime.ts` 写 + `appIntegration.ts` 读）、`withNodeSubmitExclusive`（`taskIpcHandlers.ts`）、画布两处 `mintSpendGrant`（`generationRunController.ts`、`spendConfirm.ts`）。剩下的 `mintSpendGrant` / `runTask` 门全部是附属付费口（登记例外）或不花钱的本地 / 文本路（`catalogTaskActions.ts` 的 `runWorkbenchTaskByVendor`）。
画布 Run 这条链：`node scripts/door-map.mjs submitCanvasShot submitCanvasShotRun consentCanvasShots withdrawCanvasShots createCanvasShotRuns pollCanvasShotRun` → 改前 6 扇、改后 13 扇（多出来的是批量卡的「开出价 / 收回」：卡确认、队列取消、波次结束各一处调用，一个 IPC、一个实现）。

## 3. 动手前查出来的（计划里没有）

| # | 事实 | 证据 |
|---|---|---|
| N9 | **一批放进一个多镜 Run，会把并行的批量变成串行**：提交出口按 Run 加锁（`productionGenerationSubmission.start` → `runLock.withLock`），交的那一下（同步出图要一直等到出完）在锁里；锁拿不到直接抛 `ProductionRunLockBusyError`，不排队。多镜调度器是单写者、一镜一镜交，所以没撞上；画布批量今天同波并行 6 个（用户拍板） | `productionGenerationSubmission.ts` `start`；`productionRunLock.ts` `acquire` |
| N10 | **依赖波次的下游请求在卡确认时还拼不出来**：首帧图 → 视频这一对，视频的参考是上一波刚出的图；制作那台的授权冻的是完整合同（报文哈希逐字比），确认那一刻冻不住下游 | `prepareAuthorizedSubmission` 的 `providerWirePayloadHash` 比对；`captureApprovedGenerationInputs`（「本批产出的结果是依赖，允许变」） |
| N11 | **F1a（一次 ↑ 一个单镜 Run）之下，「绑着制作镜头的节点」仍是两个 Run 争同一镜**，认领这件事本身不会消失；能删的是 `canvasShotClaim.ts` 这个包装和 `runTask` 里那一行，认领判据只留在画布付费口的准入里 | `decideShotClaim`；`appIntegrationCanvasShot.claimBoundProductionShot` |
| N12 | 本地 ComfyUI 节点在主进程付费闸里要令牌（`consumeTaskSpend` 对 ComfyUI 走 `assertAndConsumeSpendGrant`），但它不花钱；画布不再铸令牌后必须改成「本地不核令牌」 | `electron/tasks/taskSpend.ts` |
| N13 | 文本节点从来没用过它铸的令牌（执行器文本分支不传）；改写模式经 `nomi:tasks:run` 走付费闸却不带令牌——看起来今天就会被拒（未实测，`unverified`，不在本刀范围，已登记为后续） | `generationNodeExecutor.ts` 文本分支；`runtime.ts` 文本分支 `spendGate` |
| N14 | `productionGenerationSubmission.resume` 生产里没有任何调用方（只有测试），`definitelyNotSubmitted` 只从它进来 | `grep -rn "\.resume(" electron src` |

## 4. 岔路与这一刀的选择（实现层，按「用户会选的那版」做掉，事后报）

### G1 批量怎么进 Run：一批一个多镜 Run，还是一镜一个单镜 Run

| 选项 | 做什么 | 用户这边 | 代价 / 风险 |
|---|---|---|---|
| a 一批一个多镜 Run（计划原文） | 卡上每一镜是 Run 里的一镜 | **同步出图的模型批量从并行变成一镜一镜交**（N9）：6 张同步图今天约 30 秒，变成约 3 分钟；异步模型起跑错开几秒 | 要改提交锁的粒度（碰 outbox / 意向日志 / 防重入，花钱最热的一片），或者接受变慢 |
| **b 一镜一个单镜 Run，卡确认时一起开出价（选这个）** | 卡上点确认 = 每个要花钱的节点建自己的单镜 Run、出价开着；轮到它冻住请求、批、交（和单节点 ↑ 同一段代码） | 手感不变：同一张卡、同样并行、同样的波次与刹车 | 每个节点一个 Run 目录（F1a 已接受的代价）；「一张卡一份授权」落在「卡上那几镜的出价」上，而不是一道门盖住所有镜 |

同时解了 N10：出价开着 = 用户同意了这一镜「照它的输入生成一次」；冻进合同的是交的那一刻的请求（上游刚出的图在里面），由那一刻的手势收据批。出价收回（去掉 / × / 窗口没了 / 重开没人会再交）之后主进程拒交（`canvas_generation_withdrawn`），每一镜的结局照旧读 `generationPresentationOutcome`（generating / removed / failedBeforeSending / undecided + 原因）。

### G2 文稿方案的 `generate`（E6）怎么「交回 operation」

| 选项 | 做什么 | 用户这边 | 代价 |
|---|---|---|---|
| **a 照旧用画布那张整批确认卡，钱走 G1，点了确认就交回（选这个）** | `storyboard.present` 不再等整批跑完：出价开好那一刻回话，带上每一镜的 Run 号（`operations`），整批在画布上接着跑 | Agent 不再卡在「等整批出完」；卡的样子不变 | 这张卡仍是「全部 / 取消」，不能逐镜去掉 |
| b 改成对话里的逐镜付费卡（「生成这张 / 去掉这张 / 生成剩下 / ×」） | 文稿方案也出 PendingSpendConfirm 卡 | 逐镜控制（与用户 09-29「按项控制」一致） | 卡上「生成这张」要能为一个画布节点冻请求——画布请求只有渲染层拼得出，首帧 → 视频这一对确认时冻不住（N10）；卡上改参数要写回画布节点；碰付费卡最热的四个文件（11 / 8 / 6 次 fix）。约 1 周，需要样张 |

选 a 的理由：钱的口子已经收成一个（这一刀的目标），而 b 是界面行为的改变（要用户拍板、要样张），见 §8。

### G3 本地 ComfyUI：主进程付费闸对它不再核令牌（N12）。文本：不再给它铸用不上的令牌。两者仍不进 Run（登记例外，到期：第二刀传输合一）。

### G4 性能尾巴怎么修：一次落盘多条命令（不改盘上格式），而不是事件只存增量

「事件只追加增量」会让 0.23 读不懂最新那条事件——0.23 写 Run 时从最新事件里取整份 Run（`executeUnlocked` 的 `runFromEvent(journal.latest())`），回滚后任何一条命令都会失败（违反施工计划 §5.6 的回滚承诺）。改成：同一把锁里的几条命令事件一次追加、一次 fsync、快照写一次（`repository.executeBatch`），每条事件仍带整份快照、仍一行一条，旧版本照样读写；收据「挑战 → 签证 → 铸 → 验 → 用掉」五次整份读写并成一次（`issueGestureReceipt`）。第 4 步再并两处：执行绑定随「预留 → 提交意向 → 提交中」那一批落盘（信封先封；崩在两者之间，重来沿用信封里那份绑定）；供应商受理之后「已受理 → 计划已交 → 单镜 Run 进行中」三次落盘并成一次，而且「进行中」只由提交出口写（GUI、stdio、画布原来各自补一笔，删掉）。数字见 §7。

## 5. 九格（花钱 + 长跑 + 可打断）

```
改动名：批量进 Run、收尾删旧（发动机收敛第一刀 第 3–4 步）   线/负责人：L-cut34（实现）/ 另派验收线   类别：[花钱][长跑][可打断]
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在画布上框选「生成全部」/ 在分镜表点「生成未生成的 N 镜」/ 让 Agent 生成文稿方案，我想它和今天一样：一张卡、点了就并行跑、排队里能去掉某一个、能整批 ×；并且**去掉的那一个、× 之后还没轮到的，主进程那边也真的不发**，关窗 / 重启后不出现「不知道花没花」。步骤：框选 → 卡 → 确认 → 节点逐个出图 → 任务中心同一批。**不做**：逐镜付费卡用在文稿方案上（G2-b，待拍板）、附属付费口（D）、改价、新界面。**已知坑**：每个要花钱的节点一个 Run 目录（F1a 同款）。真实任务：(a) 分镜 3 镜整批，中途在任务中心去掉一镜、再整批 ×；(b) Agent 对文稿方案 `generate` 一次；(c) 一批跑到一半关窗再开 | (a)(b)(c) 真 App `pending-real-app`；主进程边界的同名场景见 §6 测试表 |
| ★2 谁说了算 | 「画布上这一次付费生成」批准 / 派发 / 在途 / 记账唯一 owner = 它自己的单镜 Run（`createCanvasShotRuns`，写口 `productionRunRepository.execute/executeBatch` + reducer，派发口 `productionGenerationSubmission.start`）。碰 4 个概念：`canvas.shot-run`（pending → converged）、`canvas.node-submit-in-flight`（删除，渲染层 `trackNodeSubmit` 并进 `canvas.shot-run`）、`production.shot-generation-ownership`（画布一侧问判定口的地方改成画布付费口准入）、`spend.pending-identity`（第 4 步 pending → converged） | §2 门表；`check:concept-owners` |
| ★3 一致与复用 | 全部复用：单镜生命周期、出价（presentations）与它的结局判据、手势收据、提交出口、意向日志、`submission_unknown`、派发闸、单镜观察者、画布那台传输。新写的只有：批量卡的「开出价 / 收回」两个主进程入口（同一个文件）、仓库「一次落盘多条命令」、收据「一次写完」——都是这个领域自己的账本，没有现成库可接 | `pnpm run check:self-written` |
| ★4 全状态 | 节点：空闲 / 排队（卡上同意了，还没轮到）/ 提交中 / 生成中 / 成功 / 失败（带原因，可再点）/ 可找回 / 结果没法确认（不给 ↑）/ 已取消（排队里去掉或整批 ×：没交、没扣）。文案全部复用现有键，不新增界面 | `check:i18n` |
| 5 中途表 | 见下表 | §6 测试表 |
| 6 外部数据与失败 | 出站报文、「写出去没有」「明确拒绝」判据一字不改（`outboundDispatchEvidence.ts`）。新增的失败面只有「开出价」这一次 IPC：主进程没装好 / 抛错 → 整批不开始（与以前铸令牌失败同一条反馈） | `confirmedProjectContinuation.test.ts`、`notificationOwnership.test.ts` |
| 7 性能预算 | 见 §7 | 探针 `electron/capabilityCore/canvasShotLatency.perf.test.ts`（`NOMI_PERF=1`） |
| 8 真实条件 | Windows 本机单测 ✓；真 App、英文界面、真付费、0.23 回滚读写新 Run = `pending-real-app` | 交独立验收线 |
| ★9 验收与回滚 | 验收（另一条线）：§6 全绿且双扣地图五条在 `doubleChargeMap.e2e.test.ts`；真 App 跑 (a)(b)(c)。回滚：整串提交 revert；批量卡开的单镜 Run 是现有 schema（`origin.host` 字符串、`presentations` 现有字段），0.23 读得懂；事件格式没改，0.23 写得进 | `## 独立验收` 待补 |

**格 5 中途表**（改后；「今天」是对照）

| 处境 | 排队里去掉这一镜 | 整批 × | 关窗 | 重启 / 重开项目 | 连点 |
|---|---|---|---|---|---|
| 卡确认了、还没轮到 | 出价记「去掉」，主进程拒交（今天：只有渲染层跳过） | 出价收回（user_closed），主进程拒交 | 这个窗口开的出价收回（stopped） | 没人会再交：重开项目时收回（stopped） | 同一个运行记录号只开一份出价 |
| 轮到了、写出去之前 | 已经在交：去不掉（今天同） | 交完这一镜，剩下的不发 | 主进程那一笔照常交完，结果进 Run | 同单节点 ↑ | 同节点只交一笔（准入） |
| 写出去了、没回执 | — | 不撤单，等结果 | 观察者接手 | **结果没法确认、不能再 ↑ / 再进一张卡** | 被拒「先核对」 |
| 供应商明确拒绝 | — | — | — | 失败原因从 Run 读回 | 下一张卡 / 下一次 ↑ 可以再生成（F3） |

## 6. 测试表（走真实边界：真仓库 / reducer / 收据 / 提交出口 / 派发闸；供应商是进程内计数器）

| 测试 | 锁住什么 | 修前 | 修后 |
|---|---|---|---|
| `doubleChargeMap.e2e.test.ts` 路径 1 | 批次停下后画布接手 shot-2，「继续」后制作不派 shot-2（画布经真实画布付费口） | 红（`canvasShotTestUtils` / 准入认领不存在） | 绿 |
| 同 路径 2 | 付费卡还摆着时画布被拒（awaiting_confirmation），一个字节不发 | 红（同上） | 绿 |
| 同 路径 3 | 删节点后调度器不派那一镜 | 绿（已有行为，这里集中锁住） | 绿 |
| 同 路径 4a / 4b | 制作结果未知 / 还在生成时画布被拒（needs_reconcile / in_flight） | 红（同上） | 绿 |
| 同 路径 5 | 同意过期停下后调度器不派剩下的镜 | 绿（已有行为，集中锁住） | 绿 |
| `appIntegrationCanvasShot.test.ts`「reported case: 去掉一项就不发那一项」 | 主进程拒交被去掉的那一镜，供应商 0 次 | 红（没有开出价 / 收回入口；令牌按节点放行） | 绿 |
| 同「中途点 ×」 | 交了的照常收完，没轮到的一镜不发 | 红 | 绿 |
| 同「× 之后再来一张卡」 | 已交的那一镜在路上，第二张卡不重交 | 红 | 绿 |
| 同「关窗」 | 窗口开的出价收回；重开项目没人会再交的出价收回 | 红 | 绿 |
| 同「批量里写出去之后断了」 | 结果未知，重启后再来一张卡也不盲重发 | 红 | 绿 |
| 同「批量里供应商当场明确拒绝」 | F3：没受理、没扣钱，下一张卡可以再生成 | 红 | 绿 |
| 同「轮到的那一镜预演没好」 | 主进程准入拒，出价收回 | 红 | 绿 |
| `canvasShotClaimAttempt.test.ts`（路径 6） | 认领命令号带 attempt；画布一侧改走真实画布付费口 | 绿（第 0 步已修） | 绿 |
| `confirmedProjectContinuation.test.ts`「开出价那一下换了项目」「开出价时节点被改」 | 卡确认后、交之前的异步空档仍守住项目与已批输入 | 红（入口不存在） | 绿 |
| `taskIpcHandlers.test.ts` canvas consent | IPC 只认真实发起窗口、拒空卡 / 缺身份、收回原因原样传 | 红 | 绿 |

「修前红」的跑法：把新测试与 `canvasShotTestUtils.ts` 拷到 `origin/main@7b81dfcb6` 的工作树里跑（结果附在实现线报告里）。

## 7. 性能

探针：`NOMI_PERF=1 pnpm exec vitest run electron/capabilityCore/canvasShotLatency.perf.test.ts --silent=false`（真仓库、真收据、真提交出口、真 fsync；供应商是进程内假的；本机 Windows 11 + NVMe，数随机器和杀毒扫描浮动，取三次）。

| 量的是什么 | 改前（`origin/main@7b81dfcb6`，同口径探针） | 改后 | 目标 |
|---|---|---|---|
| 单节点 ↑：主进程收到「交」→ 供应商请求发出 | p50 355 ms / p95 465 ms | p50 159–166 ms / p95 180–213 ms | p95 ≤ 150 ms：**没达到** |
| 同上，关掉 fsync 的底（`NOMI_PERF_EPHEMERAL=1`） | — | p50 86 ms / p95 100–170 ms | — |
| 批量卡 10 镜：点确认 → 10 份出价落盘 | —（旧路不落盘，只铸内存令牌） | 140–158 ms | — |
| 批量卡 10 镜：点确认 → 第 10 镜请求发出（画布默认并发 6） | 未量（旧路每镜还要多两次 IPC 与一次报价） | 1.8–1.9 s（最慢 2.1 s） | — |
| 打开一个已有 500 个收尾画布 Run 的项目（recoverOrphans + listRuns） | — | 9–13 ms | — |

没达到目标的原因（实测，CPU 剖面 + 逐文件计数）：一次 ↑ 在供应商之前要过约 16 道落盘屏障（建 Run 2、收据 1、封 + 批那一批约 5、提交锁纪元 1、执行信封 1、提交前那一批 4、意向日志 2），本机每道 3–5 ms；不算 fsync 的底还有约 86 ms，大头是约 10 次「重新读一遍最新 Run」（每次读事件日志 + 快照两份文件，Windows 上每次打开文件约 1 ms）和每道写的建目录 / 开文件 / 改名。每一次重读都在一个 await 之后、守的是「这一刻盘上是什么」（锁内重读、派发闸、提交前那一批的修订号），不能随手删。再往下压只有两条路，都超出「不改盘上格式」这一刀：见 §8 第 4 条。

## 8. 待拍板（交协调会话）

- **G2-b：文稿方案的 `generate` 改用对话里的逐镜付费卡**（推荐：做，但单独一刀、先出样张）。代价：约 1 周；碰付费卡最热的四个文件；需要「确认时冻不住下游」的设计（卡上「生成这张」= 同意，轮到它再冻，和本刀批量卡同一个模型）。不做的代价：文稿方案仍是「全部 / 取消」，不能逐镜去掉。
- **G1 的取舍是否接受**（推荐：接受 b）：「一张卡一份授权」落在「卡上那几镜各自开着的出价」上，而不是一道门盖住所有镜。若坚持 a（一批一个多镜 Run），需要先把提交锁改成按镜，或接受同步出图的批量变串行。
- **N13（文本改写可能一直被付费闸拒）**：是否另派一条线实测 + 修（推荐：派，S）。
- **性能目标 p95 ≤ 150 ms 没达到（§7）**：现在 p95 约 180–213 ms（改前 465 ms）。三个选项：
  - a 接受现状，这一刀收（推荐）：已经快了一倍多；用户点 ↑ 到节点进入「生成中」本来还要等供应商回话（几百毫秒到几秒），这 30–60 ms 差距用户分不出来。代价：数字不达标、登记在合同残余风险里。
  - b 仓库加一层「按事件日志字节数校验」的进程内读缓存：每次重读从两次开文件变成一次 stat，预计省 20–25 ms。代价：钱路径的唯一写入口加缓存，跨进程（MCP stdio 进程也写同一个项目）只靠「日志只追加、字节数必变」保证不读旧；要单独一张设计卡 + 对抗评审，S–M。
  - c 改盘上格式（事件只存增量、或把批准与提交前那一批并成一次落盘）：能到 100 ms 以内。代价：0.23 回滚后读不懂新 Run（违反施工计划 §5.6），要等回滚窗口过了、单独一刀。

## 自己写了什么、为什么必须

主进程「开出价 / 收回」两个入口（`appIntegrationCanvasShot.consent/withdraw`）、仓库「一次落盘多条命令」（`productionRunRepository.executeBatch`）、收据「一次写完」（`approvalReceipt.issueGestureReceipt`）。三样都是 Nomi 自己的按镜头花钱账本的一部分（领域约束：出价、门、收据、事件日志的格式与回滚兼容只有我们自己定义），没有可接入的现成实现；没有引新库、没有新状态机。

## 9. 实施结果

- 第 3 步（`2f3194214`）：批量卡进 Run，画布令牌路 / 认领包装 / 在途锁整段删（明细见提交说明）。
- 第 4 步：
  - 旧剧本那台生成写手（driver 向渲染层派 `production.generate-node`、样片门、逐镜门、冻结检查）整段删；旧版本留下的、还挂着「已授权 / 提交中」生成任务的剧本 Run，打开后停成「需要处理」（`legacy_generation_writer_retired`），不派、不花钱。渲染层只服务它的 `production.check-frozen` 分支一起删。
  - `resume(definitelyNotSubmitted)` 整条死路删（`productionRunResume.ts`、信封的 `markDefinitelyNotSubmitted`、意向日志的 `allowRetryAfterAbort`）：被中止的那一次尝试只能在新的批准下以新尝试重来。
  - `spend.pending-identity` pending → converged：PendingSpendConfirm 只剩 Run 投影一个生产者；四个报价 / 令牌函数只剩登记的附属付费口例外（试跑、认证、视频拆解、提示词提取、新手 ComfyUI 试生成；到期 2026-11-15，清单在 `docs/engineering/concept-owners.json` 该条 notes）。基线里这一概念冻结的 10 扇旧写门随收口删除。
  - 性能尾巴：见 §4 G4 与 §7。
- 门表：§2（12 个旧符号 50 → 45）。根因合同：`docs/fixes/2026-10-05-canvas-paid-into-production-run.root-cause.json`（第 4 步补了范围、两条不变量、三个回归测试、删掉的路径）。
- 没验的（`pending-real-app`，交独立验收线）：真 App 里写出去后崩溃 / 重启 / 关窗 / 批量中途 ×、真付费一镜、0.23 回滚后打开新 Run、旧剧本 Run 在新版本里打开停成「需要处理」的样子。
