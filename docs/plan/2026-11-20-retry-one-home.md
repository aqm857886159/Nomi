# 失败后再发一次要不要问：只由主进程一处定（设计卡）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 碰花钱 / 长跑 / 可打断，按四类填 9 格（★0 / ★1 / ★2 / ★3 / ★4 / 5 / 6 / 8 / 拍板图 / ★9；★7 只写为什么不登记场景，本刀不新增操作）。不新增界面元素；唯一可见变化是 U1，见「拍板图清单」。
> 状态：**第一阶段已实现**。第二阶段要等「主进程核对确实问过人」的共用人证落地，再做下一刀，清单见文末。行号以 `48ad810e8`（origin/main）为准。
> 复盘：`docs/engineering/direction-checks/2026-11-21-retry-one-home.md`（独立线先写，再与本卡对照）。

## ★0 先查别人

- **RFC 6749 §4.1.2**（https://www.rfc-editor.org/rfc/rfc6749#section-4.1.2）
  - 它怎么做：授权码由授权方发出，短时有效，只能用一次，绑定申请它的那个客户端。
  - 对本刀：决定号由主进程发，只认发它的窗口，用一次即作废，过期作废；渲染层不能自报一份「批准了哪些」。
- **Stripe PaymentIntent 生命周期**（https://docs.stripe.com/payments/paymentintents/lifecycle）
  - 它怎么做：要不要再确认、确认的是哪一笔，由服务端持有的那一笔意图决定。
  - 对本刀：确认只对主进程那一份决定生效，卡出现后新冒出的那一笔不在里面。
- **仓库内 `electron/productionRun/submissionIntent.ts:39` `admission`**
  - 它怎么做：新单必须点名「看到的那一笔」（`newAttemptOf`），否则只观察；上一笔结果不确定时冻结 `priorOutcomeUnknown`，由主进程自己问人。
  - 对本刀：照它的思路（点名看到的那几笔、主进程判），但逐行对过后不共用这个函数，理由见 ★2 对照表。
- **仓库内 `electron/spendConfirmGrant.ts:62` + `src/workbench/capability/spendCardByIntent.ts`**
  - 它怎么做：主进程问人只有一条链 `requestRendererDecision('spend.confirm')`，卡按 intent 查表。
  - 对本刀：「主进程核对确实问过人」属于共用人证，另有主人。本刀第一阶段不碰，第二阶段接它。
- **仓库内 `scripts/concept-owners-scan.mjs` 的 `findFailureDecisionBypass`**
  - 它怎么做：已经用 TS 绑定追别名、属性写、展开覆盖。
  - 对本刀：新扫描照它扩，不新增检查命令。

出口：RFC 6749 §4.1.2（https://www.rfc-editor.org/rfc/rfc6749#section-4.1.2）· 授权码过期、用过或对不上就作废，客户端重新发起授权、用户再同意一次 · 确认了我们的出口：卡开着时冒出的那一笔被拒后，渲染层重新要决定、再问一次（最多一次）；号过期或窗口重载后，人再点一次「再发一次」即可，不留卡死的状态。

## ★1 用户怎么用

创作者点「再发一次 / 重新生成 / 重试」那一刻要三件事：
- 花不花第二次钱只问一次，而且问的是真话；
- 确认了就真的发出去；
- 确认的只是卡上那一笔，卡开着时又冒出来的那一笔不会被顺手放行。

指标与量具：
- **入口一致**：同一输入在画布、节点错误卡、分镜单项、任务中心看到的卡与动作，改前改后一致（U1 除外）。量具是现有出口测试：`generationOpenRuns.test.ts` 钉卡的标题、正文、按钮，这几条断言一字没改，主分支和本刀各跑一遍都绿。现有测试动过的地方见 ★9 第 9 条下的清单（只换了许可的来源，没有改卡和文案的断言）。
- **重复下单 0**：卡开着时新出现的那一笔，不被同一次确认放行。量具是跨层测试（渲染入口 → 真 IPC 处理器 → 真主进程 → 假供应商计数）。
- **确认后真的发出**：确认一次，供应商收到 1 次提交。量具是同一个跨层测试。
- **窗口真走**：verify-nomi（`--vendor fake-apimart`，`NOMI_TEST_NETWORK_GUARD=1`）。

### ★1b 连带界面（只有下面这几种输入的可见结果变，其余逐项不变）

| 出口 × 输入 | 改前看到 | 改后看到 |
|---|---|---|
| U1 批量完成通知 × 有一镜「结果未知」 | 「重试失败的 N 个」把结果未知那一镜也算进去。点了以后那一镜被跳过，0 次新提交（真窗已复现） | 正文照旧数全部失败，按钮只数能重试的；能重试的为 0 时，动作换成现成的「任务」（打开任务中心）。零新字符串（已拍板，方案甲） |
| U2 单镜重发 × 卡开着时同节点又冒出一笔 B | 一次确认把 A、B 都放行 | 只放行卡上那一笔 A。B 由主进程拒，照现有流程再问一次 |
| U3 节点「再发一次」× 那一镜的制作任务「核对中」 | 卡 → 确认 → 放行失败 →「没能记录你的核对结果…」 | **本刀不动**，另记待办 |
| U4 任务中心 × 结果未知、画布上已没有那个节点 | 同一张卡，确认后只放掉旧任务，0 次新提交 | 可见结果不变；放行改成只认主进程决定里列出的那一笔。诚实版另记待办 |

U3 的可达性（代码推演，未复现）：
- 「核对中」只在「找到了」之后出现，而「找到了」要求旧任务带任务号（`productionRunService.ts:348`）。
- 画布单镜的「结果未知」一律没有任务号（`productionRunService.ts:636`、`submissionOutbox.ts:171`）。
- 所以只有两种情形会碰到 U3：助手制作流程里落到画布的那一镜，以及重启后被标成「请先对账」的那一镜。
- 这两种都要文本模型或重启恢复，假供应商给不了，记 `unverified`。

### ★1c 老用户

- 不改存储格式。决定号只存在主进程内存里，不落盘。
- 升级后，旧的「没收尾」标记照旧由 `readCanvasOpenRuns` 读出：主进程决定「要问」→ 问人 → 放行 → 发出。夹具是 `tests/fixtures/old-user-data/runs/v0.24.0-canvas-interrupted`。
- 现有 `canvasOpenRuns.test.ts` 的 v0.24.0 中断夹具回放改成经决定号放行，仍是绿的。「决定 → 问人 → 放行 → 发出」整条链的跨版本回放归第二阶段。
- 窗口重载后决定号作废，重新点一次即可，不留脏状态。

## ★2 谁说了算

### 和主进程已有两处的关系

目标：「要不要再问」和「结果未知没有」，在主进程里不出现第三处并排的判定。判定归画布单镜主人：主人 `createCanvasShotRuns` 唯一持有一份 `createCanvasShotResend`（`canvasResendDecision.ts`，和决定号放在一起），别处拿不到它。规则体不写进主人文件本身，是因为那个文件在主分支上已是 799 行，到了体积门岗的 800 行红线。

| 已有处 | 管的对象 | 它判什么 | 本刀跟它的关系 |
|---|---|---|---|
| 甲：`submissionIntent.ts` 的 `admission` + `priorOutcomeUnknown` | 应用级一次性下单，唯一调用方是助手的试跑模型 `tryModel` | 新单能不能开：必须点名看到的那一笔，否则只观察；上一笔不确定 → 冻结措辞，主进程自己问人 | **不并，不动**。逐行对照见下表 |
| 乙：`appIntegrationSpendConfirm.ts` 的 `createPendingSpendActions` | 助手一次出价里的几镜 | 卡上身份对不对（`quoteId`），只交「还没决定 / 确定没发出」的镜，结果未知的不许再交 | **只读，不动**。它从不问「要不要再发」，只拒 |
| 丙：画布 `assertNodeIdle` + 渲染层 `askToResend` | 画布一个节点上没收尾的 Run | 改前：主进程信渲染层报的 `acknowledgedOpenRuns`，问不问由渲染层自己判 | **收成唯一一处**：主人持有的 `resend.decideResend` 判，`assertNodeIdle` 经 `resend.firstBlocked` 只执行；渲染层那份判断同提交删 |

**为什么不和甲共用一个函数**：拿同一个签名，逐行对两边该得出的答案：

| 情形 | 甲（试跑）今天的答案 | 画布该得出的答案 |
|---|---|---|
| 上一笔「确定没发出」，还有一次免费重试额度，新单不点名 | 直接收下当重试，不问人 | 确定没发出的 Run 已收尾，不在 open 里；人点「重新生成」照样问 |
| 没有旧单，但调用方说「要新开一笔」 | `priorOutcomeUnknown = true`，卡上说「可能已扣费」 | 用「再发一次」卡，措辞看节点上那次失败是不是结果未知 |
| 旧单的形状 | 一个回执 | 一个节点上可能有几笔 open run，外加批量草稿、交接镜两种来源 |

三行都要加调用方开关才能共用。那只是把两套规则塞进同一个文件，并没有收成一处。所以：
- 试跑在甲判，画布在丙判，各有唯一一处；
- 两处共读同一张「没收尾算哪种」表；
- 乙只读。

**「没收尾算哪种」一张表**：`electron/shared/productionJobOpenAs.ts`。
- 写法：`Record<ProductionJobStatus, 'in_flight' | 'needs_reconcile' | null>`，新长一个状态而表里没写，类型检查当场红。
- 原来两份手抄清单改读它：`decideShotClaim.ts` 的 `IN_FLIGHT` / `NEEDS_RECONCILE`，以及 `canvasShotResult.ts` 的 `blockingReason`。主分支上同一组状态一共手列了 7 处（6 个文件）：除了这两处，还有 `productionShotPhase.ts` 两处、`productionRunRepository.ts`、画布主人的重放判断，以及渲染层 `releaseUnknownSubmission.ts`。前四处一并改读这张表，渲染层那处随函数删掉。
- 逐状态对拍：`productionJobOpenAs.test.ts`，与改前清单和改前画布判据全等。
- `productionSubmissionActions.ts` 的 `submissionActions` 不并进来。它看证据，回答「供应商收下没有」，并进来会丢掉 `errorCode`、任务号这些证据。
- 第三稿提过的 `humanCanRelease` 列没加：它只为 U3 服务，U3 本刀不动。

### 主人与出口

**主人**：主进程 `createCanvasShotRuns`（`appIntegrationCanvasShot.ts`），它持有唯一一份 `resend = createCanvasShotResend(...)`（`canvasResendDecision.ts`）。IPC 经 `canvasShotRunApi.decideCanvasResend` 进 `resend.decideResend`。

`resend.decideResend` 读原任务（主人的 `readCanvasOpenRuns`，加上绑定的那一笔制作任务）和共享表，结果是三种之一：
- `send`：没有没收尾的、也没说要重发 → 照常走现有的花钱判定（要不要弹花钱卡由 `spendConfirmationRequirement` 定，本刀不改）。
- `refuse`：不是人发起的，遇到没收尾的 → 现有码 `node_generation_in_flight`。
- `ask`：要问人。主进程当场铸一个决定号，号里记下：
  - 卡打开那一刻这个节点在途的 Run → 它最新那笔作业号；
  - 结果未知、确认后可放行的那几笔（`release`）；
  - 项目、窗口、节点、30 分钟过期。

  号本体只在主进程内存里，回给渲染层的只有号、`resultUnknown`、`release` 清单和供显示的 `open`。

  `open` 只给显示用：它是判定那一刻读到的同一份没收尾清单，渲染层只拿它同步节点显示，不许拿它算放行或要不要再问（放行只认号和 `release`）。类型上标只读（`ReadonlyArray<Readonly<...>>`）；渲染层读它的地方只有一处，`generationRunController.ts` 的 `synchronizeCanvasOpenRuns(decision.open)`（提交前 grep 核过）。这样判定和显示读同一份，卡前不再另读一次。

`assertNodeIdle` 执行时（经 `resend.firstBlocked`），只有受信窗口里人点的单镜提交才认决定号（批量卡同意的镜、交接镜永远不放行别人的在途），规则是：
- 号绑这次提交的运行记录号，同一记录号重放仍认，换一个记录号就不认。
- 只放行号里记下、且作业号没变的那几笔。
- 多出来的一笔，或同一 Run 换了一笔作业 → 拒 `node_generation_in_flight` → 渲染层重新要决定、再问一次（最多一次）。

**出口只报意图、只展示**：
- 画布单镜 / 节点错误卡 / 分镜单项 / 任务中心有节点：`confirmAndRunNode(..., { resend })` → `canvasResendDecide`（报 `resend`、发起方、节点失败是否结果未知、绑定的制作 Run）→ 按判定走：
  - `send`：照常走现有的花钱判定（单张按现有规则不弹卡）；
  - `ask`：现成的 `confirmGenerationResend` 卡；
  - `refuse`：抛现有码。

  确认后逐条放行 `release`（带号），提交带 `resendDecisionId`。
- 任务中心无节点（U4）：`canvasResendDecide`（报原 Run / 作业）→ 同一张卡 → 放行号里那一笔，不发新的（可见结果不变）。
- 批量（画布 / 列表 / 分镜波次 / 助手方案）：不变。照旧读 `canvasOpenRuns`，只为显示「跳过 N 个」；真正拦的是主进程，批量草稿永不放行在途。
- U1 批量通知：重试候选只读共享失败判定 `generationFailureActions(...).canRetry`。

**不变量**：
1. 出口自报的字段只能往「问 / 拒」推，不能往「发」推。`resend: true` 只会把 `send` 变成 `ask`；`initiator` 不是 `user` 只会变成 `refuse`。放不放行只看主进程自己的事实：受信窗口的提交手势、不是批量草稿、不是交接镜、决定号有效。
2. **第一阶段**：放行结果未知那一笔，仍经制作 Run 命令通道 `job.reconcile user_checked_abandon`，由渲染层按决定逐条发。主进程在通道上核对：这一笔必须在同一窗口、同一项目的一份有效决定的 `release` 清单里，清单外的、没带号的、号是编的、号已被用掉的，一律拒。**第二阶段**：写口迁进主进程主人，渲染层不再发这条命令（扫描落点 A）。
3. 一次确认只放行决定里那几笔。下面这些一律当没确认：决定之后新冒出的、作业号变了的、过期的、窗口没了的、已经被另一次提交用过的，以及跨节点 / 跨项目 / 跨窗口的。
4. **第二阶段**：放行时服务要的人手势章，改成接共用人证（主进程核对确实问过人）；第一阶段沿用通道现有的窗口来源章。

**IPC 形状**（新通道和新字段，不改存储）：
- `canvas-submit` 负载删 `acknowledgedOpenRuns`，加 `resendDecisionId`。
- 新增 `nomi:tasks:canvas-resend-decide`，回 `send` / `refuse` / `ask`（`ask` 带号、`resultUnknown`、`release`、只读的 `open`）。
- `production-run` 命令通道的 `job.reconcile user_checked_abandon` 负载多一个 `resendDecisionId`，主进程核对它。

**数门**（door-map，`src` + `electron`，不含测试；改前 3150 个文件，改后 3154 个）：

| 符号 | 改前 | 改后 |
|---|---|---|
| `acknowledgedOpenRuns` | 5 门 / 8 处 | 0 |
| 画布「要不要再问」 | 2 处（主进程 `assertNodeIdle` 信渲染层 + 渲染层 `askToResend` 自判） | 1 处（主人持有的 `resend.decideResend`）；渲染层 2 处调 `canvasResendDecide`，只读判定 |
| 试跑「要不要再问」（`submissionIntent.admission`） | 1 | 1（不动） |
| 按状态手列「结果未知」那一组 | 7 处（6 个文件，扫描量具） | 0；1 张表（`productionJobOpenAs` 6 门 / 7 处调用） |
| `releaseUnknownCanvasSubmissionsForNode` / `releaseUnknownSubmissionForNode` | 1 / 1 | 0 / 0（删） |
| `releaseUnknownSubmission` | 2 门 / 3 处 | 2 门 / 2 处（只按决定清单逐条放） |
| `canvasOpenRuns` | 10 门 / 13 处 | 9 门 / 10 处 |
| `markCanvasRunSettled`（替别的 Run 放占用） | 主人与摇铃 | 只在登记的主人函数和摇铃里（扫描落点 B 守） |
| `createPendingSpendActions` | 3 | 3（不动） |

**删了什么 / 为什么能删 / 现有调用方怎么过**：

| 删 | 为什么能删 | 调用方怎么过 |
|---|---|---|
| canvas-submit 的 `acknowledgedOpenRuns` 整条链（bridge / taskApi / catalogTaskActions / catalogTaskResolve / generationNodeExecutor / generationRunController / taskIpcHandlers / 主进程） | 它是渲染层自报的许可，U2 就出在这里 | 同一条链只传 `resendDecisionId`；主进程按号放行 |
| 渲染层 `askToResend` 自己判「问不问、措辞、放谁」的分支 | 主进程 `resend.decideResend` 判 | 读判定：`resultUnknown` 定措辞，`release` 定放谁 |
| `releaseUnknownCanvasSubmissionsForNode`、`releaseUnknownSubmissionForNode` | 「卡后重读全部没收尾的再逐个放」正是扩大范围的那一步 | 改成按决定的 `release` 清单逐条调 `releaseUnknownSubmission`（带号） |
| `decideShotClaim` 的两个 Set、`blockingReason` 的状态判断 | 合成一张表，逐状态相同 | 改读 `productionJobOpenAs`，对拍测试钉住 |
| 批量通知只排除本机拒绝的自判 | 共享失败判定已有 `canRetry` | 读 `generationFailureActions` |

**改动的文件**：
- 主进程：
  - 新增：`electron/shared/productionJobOpenAs.ts`、`electron/shared/canvas/canvasResendDecide.ts`、`electron/capabilityCore/canvasResendDecision.ts`；
  - 修改：`appIntegrationCanvasShot.ts`、`canvasShotRunApi.ts`、`appIntegration.ts`、`canvasShotResult.ts`、`taskIpcHandlers.ts`、`runtimeBridge.ts`、`productionRunIpc.ts`、`decideShotClaim.ts`、`productionShotPhase.ts`、`productionRunRepository.ts`。
- 渲染层：`bridge.ts`、`taskApi.ts`、`catalogTaskActions.ts`、`catalogTaskResolve.ts`、`generationNodeExecutor.ts`、`generationRunController.ts`、`releaseUnknownSubmission.ts`、`useProductionStatus.ts`、`batchPlanPreview.ts`。
- 门岗：`scripts/concept-owners-scan.mjs`、`check-concept-owners.mjs` 及其 node 测试，`pre-push-scan-guards.mjs` 注释。
- 测试工具：`tests/ux` 驱动的假供应商加 `--vendor-drop-submit <n>`（前 n 次下单收完请求不回话，用来在真窗里造出「结果未知」）和 `--vendor-fail-task <n>`（前 n 个建好的任务查询时报普通失败，用来和「结果未知」并排看 U1 的计数）。

## ★3 一致与复用

- 卡复用 `confirmGenerationResend`：只问是否再花一次，不改模型或参数；单位照旧是积分；不带托管告知。
- 失败后「能不能重试」只读共享失败判定，`electron/shared/generationFailure*.ts` 不动。
- 放行仍走服务的 `job.reconcile`（释放预留由服务做），不另写账本逻辑；服务对 `reconciling` 不放宽。
- 交接处照登记引用 `docs/engineering/seams.json` 的 `result-to-project`，本刀不新建、不升级。
- 遥测事件与原因码一个不删，也不新增采集。

## ★4 全状态

决定只在主进程内存里：
1. 渲染层报意图 → `resend.decideResend` 回 `ask`，带号。
2. 渲染层弹现成那张卡。卡不超时；窗口没了号随之作废。
3. 人点确认 → 渲染层按 `release` 逐条放行（带号），主进程逐条核对清单。任一放行失败 → 照旧报「没能记录你的核对结果…」，不提交；之后再点会重新要决定、再问。
4. 提交带号 → `assertNodeIdle` 只放行号里那几笔仍在途的。多出来的一笔 → 拒 → 重新要决定、最多再问一次。
5. 号被第一次提交用掉（同一运行记录号重放仍认），过期 30 分钟作废，窗口关掉或重载（`releaseSender`）作废。

三条路比较（详见复盘）：
- 沿渲染层各入口修：许可仍可自报。不选。
- 收进主进程画布准入这一处：和试跑共读一张表，规则各管各的。**选这条**。
- 删掉原地重发：会回退已批准的人手重发，是产品取舍，不选。

## 5 中途表

| 状态 | 停 / 取消 | 关窗 / 重载 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 卡开着（已铸号，没确认） | 点取消：0 写入、不放行、不发，号留在内存里 30 分钟后自清 · 不扣 · 节点照旧显示失败 | 号随窗口作废（`releaseSender`）· 不扣 · 再开窗点「再发一次」重新问 | 本机判定不走网，卡照常 · 不扣 | 号不落盘，重启后没有号 · 不扣 · 旧的没收尾标记照旧读出，再点重新问 | 第二次点「再发一次」再要一份新号、再弹一次卡；只有被确认的那份号能用 |
| 已确认、逐条放行中 | 不可取消（放行是本机写账本，瞬时）| 放行到一半窗口没了：已放的那几笔记账，号作废，没放的留着，下次再问 | 放行不走网 | 已放的照账本；没放的重启后仍是「结果未知」，再点重新问 | 放行失败 → 报「没能记录你的核对结果…」，不提交；再点重新要决定 |
| 已提交（带号） | 照现有生成取消流程 | 照现有：窗口没了交给观察者 | 照现有：结果未知那一路 | 照现有重启恢复 | 号已被这一次提交用掉；第二次提交换了运行记录号就不认，节点上有在途 → 拒 |

花费一栏只有「已提交」会扣，和改前一样；本刀不改计价、不改退费。

## 6 外部数据与失败

- 外部来源：只有渲染层经 IPC 报来的意图（`resend`、发起方、`resultUnknown`、绑定的制作 Run 号）。IPC 处理器按字符串收窄，空项目、空节点又没作业号直接拒。
- 我们的偏差：渲染层报的字段只能把判定往「问 / 拒」推（不变量 1）；放不放行只看主进程自己的事实。
- 失败时用户看到什么：判定失败（能力核没起来）→ 渲染层照现有出错路径报错，不发；放行核对不过 → 现有「没能记录你的核对结果…」。不碰供应商协议，不碰 key。

## ★7 性能（路径推出了「新增功能 / 性能」，这里写清为什么不登记场景）

- ① 新增的用户操作：没有。点「再发一次」/ 批量重试 / 单张生成还是原来那几下，只是点下去之后多一次本机 IPC 判定。
- ② 最坏规模：判定读的是提交时本来就读的那份「没收尾的 Run」索引（同一项目、同一节点）；决定号存主进程内存，每次点重发最多一份，30 分钟或窗口没了就清。
- ③ 预算：判定不走网、不写盘，只读提交时本来就读的那份索引，耗时和改前提交时的占用检查同量级，按「点击到可见反馈 ≤100ms」算；没单独量，记 `unverified`。
- ④ 场景：不登记新场景，PR 正文 `perf-scenario` 写「不适用」和这条理由；以后若批量重试的张数上到几十张，再给批量入口补场景。

## 8 真实条件

- 英文界面：真窗中英各走一遍（截图见文末清单）。
- 最小窗口：走查在默认 1280×800 跑，没测更小的，记 `unverified`。
- Windows：没跑，记 `unverified`（本刀不碰平台相关代码）。
- 真规模：批量只测了 2 张；更多张数 `unverified`。
- 干净安装：走查用隔离的新资料目录，等同首次启动。
- 真付费：不跑。本刀只改放不放行，不改报文和计价；用假供应商数 POST。
- 键盘全程：没测，记 `unverified`。

## 拍板图清单

不适用：不增删界面元素、不改布局和文案。U1 只把批量通知按钮的计数改成「只数能重试的」，为 0 时换成同一族通知现成的「任务」动作，零新字符串；这一处的做法是用户拍板的方案甲（经协调会话转达）；没有新出样张，改后真窗截图见文末。

## ★9 验收与回滚

### R2：跨层测试的判据修正（只改测试）

- ★1：创作者确认 X 后只重发 X，旁边未确认的 Y 保持结果未知；继续重发 Y 仍须再问，取消后供应商不多收。量具是同一条跨层测试里的供应商计数、真实作业状态和确认卡。
- ★2：沿 `confirmAndRunNode` → 真预加载桥 → 真 IPC → 真主进程走；`door-map confirmAndRunNode` 得到 7 个调用文件，本刀不改这些入口或产品主人。
- ★3：沿原测试直接调新决定 IPC 会在主分支 TypeError；选换成主分支也有的渲染入口，复用既有 IPC 装配；删掉直接调决定 IPC 的搭架子，不保留两条路径。
- ★4：清单内 X 正常放行并发出；夹带 Y、无号、编造号均不放行 Y；Y 再点仍弹卡，取消无新提交。不改用户数据、产品行为或依赖。
- ★9（动手前预测）：主分支会错误放行 Y，真实作业状态断言红；`decideResend` 恒拒会使 X 无法完成重发，正向断言红；主人 `covers` 改成接受清单外作业时，Y 状态断言红。还原后同一测试须绿。
- 最早漏拦在验收：原测试直接调用新 IPC，拿缺函数的异常充当负对照；本刀把失败形状收成行为断言。原 U2 是第二条真实旧案（卡后 B 被多发），正常 X 确认后恰好多发一次是阴性对照；交回前复跑三种坏版本和还原版本，达不到预测即不交完成。

**判据**：两个「没做成」版本都要红，而且红在经过新主人的测试上。
- 「什么都不做」= 主分支产品文件（R2 实测 `2b14af4e3`，新增产品模块临时移走）+ 本分支测试，4 条均为断言红：U1 × 2 分别把重试数 1 /「任务」错报为「重试失败的 2 个」；U2 供应商应收 2 笔、实收 3 笔；放行只认清单应保持 Y 为 `submission_unknown`，夹带 / 无号 / 编造号后均变成 `needs_attention`。旧版这条直接调新 IPC 得到 TypeError，不计行为证据；R2 已删该调法，改走 `confirmAndRunNode`，没有 TypeError / 模块缺失。另两个新增模块的单测不纳主分支负对照。
- 「全拦」分两个变体，都改主人持有的 `resend.decideResend`（改坏的是副本，测试解析改指过去，工作树源码不动；同一套配置不改坏时 53 条全绿）：
  - 永远问：D1、D3 红；
  - 永远拒：U2、确认 A 后真发出、D1、放行只认清单红。
- 两个版本的 diff 和测试输出都在证据目录里。
- 如实记：「放行只认清单」这一条在「永远问」下是绿的（永远问不放宽清单，这条红不了）；这个变体由 D1、D3 两条红抓住，不为它复制断言。
- R2 三种实跑：主分支 4 红 / 4 绿；主人 `decideResend` 恒拒 4 红 / 2 绿，清单项红在 `promise rejected "Error: node_generation_in_flight { code: '…' }" instead of resolving`（X 本应真发出）；主人 `covers` 保留有效决定 / 未用检查、删掉 Run / 作业清单核对时 1 红 / 5 绿，清单项红在 `expected [ 'needs_attention', …(2) ] to deeply equal [ 'submission_unknown', …(2) ]`。日志与产品差异为 `L-home-retry-r2/02-main.{log,diff}`、`03-always-refuse.{log,diff}`、`04-outside-allowed.{log,diff}`；每次按原 HEAD 还原后已跟踪状态为空。

**通过清单**（跨层的走「渲染入口 → 真 IPC 处理器 → 真主进程 → 假供应商」）：

| # | 条目 | 测试 | 阶段 |
|---|---|---|---|
| 1 | U1：一镜结果未知 + 一镜普通失败 → 正文数 2、重试数 1，只重跑普通那镜；全是结果未知 → 动作是「任务」 | `batchPlanPreview.retryable.test.ts` | 一 |
| 2 | U2：卡开着时同节点冒出 B → 只放行 A；B 被拒、再问一次；供应商不因第一次确认多收 B | `resendOneHome.crossLayer.test.ts` | 一 |
| 3 | 确认 A → A 被放下，新的一笔发出，供应商只多收这一次 | 同上 | 一 |
| 4 | D1：用户单张、没有没收尾的 → 不弹重发卡，照常走现有花钱判定（单张不弹卡），1 次 POST | 同上 | 一 |
| 5 | D3：不是人发起的遇到在途 → 拒；伪造的提交（自报 user、不经判定）也被拒 | 同上 | 一 |
| 6 | 放行只认决定清单：从渲染重发入口确认 X，在真实放行命令前夹带 Y（沿用号 / 无号 / 编造号）→ Y 均保持结果未知；X 放行、节点成功、供应商恰多收 1 笔；再点 Y 必须再问，取消不多收。主分支与主人放宽清单都在 Y 状态断言红，主人恒拒在 X 应重发的断言红 | 同上（R2 三种负对照见上） | 一 |
| 7 | 决定号作用域：跨窗口 / 跨项目 / 跨节点不认；同一记录号重放认，换记录号不认；30 分钟过期；窗口没了作废；能力核没起来一律不放 | `canvasResendDecision.test.ts` | 一 |
| 8 | 状态表：每个状态都有表态（类型检查），与改前清单和改前画布判据逐状态全等 | `productionJobOpenAs.test.ts` | 一 |
| 9 | 现有出口测试：卡标题 / 正文 / 按钮、取消 0 写入、竞态最多再问一次、放行失败可见、批量跳过、机器拒；卡和文案的断言一字没改 | `generationOpenRuns.test.ts`、`generationLockExit.test.ts` 等 | 一 |
| 10 | 主进程现有：后来的 Run 不获旧批准、v0.24.0 中断夹具、重启 / 取回失败、收尾摇铃 | `canvasOpenRuns.test.ts`、`canvasOpenRunsRecovery.test.ts`、`canvasShotSettledBell.test.ts` | 一 |
| 11 | 免费找回（`job.retry_retrieval`）不经过重发判定、不弹卡（阴性对照） | 现有 F4 系列 | 一 |
| 12 | 试跑模型：`submissionIntent` / `tryModel` 不改，现有测试全绿 | 现有 | 一 |
| 13 | G7 跨层：放行失败后再点能过（主进程一侧） | — | **二** |
| 14 | U4 诚实版：无节点时不承诺重发 | — | **二** |
| 15 | 老数据：v0.24.0 中断 / 未知夹具走完「决定 → 问人 → 放行 → 发出」 | — | **二** |
| 16 | U3：「核对中」那一镜 | — | 另记待办 |

**第 9、10 条里动过的现有测试**（卡、文案、按钮的断言都没动；动的是许可从哪来）：
- 主进程三份（`canvasOpenRuns` / `canvasOpenRunsRecovery` / `canvasShotSettledBell`）：提交负载的 `acknowledgedOpenRuns: [...]` 换成真去要一份决定拿到的 `resendDecisionId`。F9/F12 多两种不该放行的情形（别的窗口、别的节点的号），为造别的节点的号多交了一笔，所以供应商计数从 1 变 2；收尾摇铃那份多一句「被确认的那笔确实在没收尾清单里」。
- 渲染层 `generationLockExit` C2：被删的 `releaseUnknownCanvasSubmissionsForNode` 换成「要决定 → 按 `release` 逐条放」，并多断言放行命令带号。
- `releaseUnknownSubmission.test.ts`：调用多传号，命令负载多断言一个 `resendDecisionId`。
- `generationOpenRuns` F8：判定变成异步，测试等卡的确认函数就位再点。G7（放行失败可见）：改前靠「卡后第二次读没收尾的」失败来造放行失败，那次读已经删了，改成放行命令本身失败；节点的断言从「整个节点不变」收成「运行历史不变」，因为结果未知那一笔在判定时会把节点显示同步成「可能已扣费」，这是改前就有的显示同步，不是新行为。另加断言：只放行判定里那一笔、带着号。
- 其余 9 份渲染层测试只在 `taskApi` 桩里加一行 `canvasResendDecide`（指向测试用的照抄判定），断言不动。

**写不出来**（扫描锚在落点，不锚名字；在 `check:concept-owners` 里加规则 `resend-owner-bypass`，登记进推送前 `SCAN_GUARDS`）：
- **落点 B**：替别的 Run 放占用（`markCanvasRunSettled`），只允许在主人登记的函数 `settle` / `withdrawConsent` / `assertNodeIdle` / `handOff`、摇铃 `canvasShotSettledBell.ts`、索引 `canvasShotRunIndex.ts` 本身里。主人文件里登记之外的函数碰它也拦，判定所在的 `canvasResendDecision.ts` 和渲染层也拦。
- **落点 C**：恰好列出 `submission_unknown` + `reconciling` 两个状态的清单，只允许在共享表里。
- **两个落点的五种绕法各一条反例**：改名、内联（动态 import）、别名、属性赋值 / 整模块属性、展开 / `Object.assign` / 拼接。
  - 单测里全拦；
  - 往真实文件里注入、改坏 → 全仓扫描红，复原 → 绿，10 组 20 次；
  - 主分支上同一组手列 7 处，本刀之后全仓扫描为 0。
- **落点 A**（只有主人能发 `user_checked_abandon`）：第二阶段。第一阶段由主进程的清单核对拦（第 6 条）。

**回滚**：单个提交，`git revert` 即回到改前。不改存储，回滚没有数据迁移。

## 拍板记录

- 用户（2026-11-21）：都按推荐。判定收进主进程画布准入一处，删入口自报放行。
- U1 选甲：正文数全部失败，按钮只数能重试的，零新字符串。
- 谁去问人：渲染层照旧弹现成那张卡。主进程在卡前铸号，号绑卡打开那一刻的具体几笔。
- U3、U4 诚实版、英文跳过提示的单复数（「1 previous requests have not finished」），都另记待办。

## 第二阶段（共用人证落地后的下一刀）

- 放行写口迁进主进程主人：渲染层不再发 `user_checked_abandon`，扫描加落点 A。
- 放行的人手势章接共用人证（不变量 4）。
- G7 跨层、U4 诚实版、老数据整链回放（通过清单 13–15）。

### U1 / U3 截图（主分支代码，隔离窗口 + 假供应商第一次下单断开，中英各一套，都打开看过）

- `u1-now-batch-toast`（U1 现在，批量通知）：「已完成 1 个，1 个失败 — 在画布上单独重试」+「重试失败的 1 个」；失败那一镜自己写着「上一次没等到结果，可能已经扣费 · 再发一次」。
- `u1-now-after-retry-click`（U1 现在，点了「重试失败的 1 个」之后）：只弹「1 张上一次还没结束，这次跳过了。· 生成区」，供应商没收到新提交。
- `u1-target-task-action`（U1 改后要复用的现成动作）：同一族通知已有的「任务」按钮。
- `u3-now-resend-card`：「再发一次这张图片？上一次没等到结果，可能已经扣费。再发一次可能会再扣一次钱。」

### 改后真窗截图（本提交构建，隔离窗口 + 假供应商，只走本机回环，中英各一套，都打开看过）

U1 混合（第一次下单不回话 = 结果未知，第一个建好的任务报普通失败）：
- `01-u1-mixed-toast`：通知「批量生成失败：2 个未完成」+ 按钮「重试失败的 1 个」（英文「Batch generation failed: 2 unfinished」+「Retry 1 failed」）；左边普通失败给「重试」，右边写「上一次没等到结果，可能已经扣费 · 再发一次」。
- `02-u1-mixed-after-retry-click`、`03-u1-mixed-retried`：点按钮后只有普通失败那张重跑出图，结果未知那张原样不动；供应商下单从 2 次变 3 次。单张重跑按现有规则不弹花钱卡。

能重试的为 0（第一次下单不回话，另一张成功）：
- `01-batch-spend-card`：整组生成的花钱卡，两张都勾上。
- `02-u1-batch-toast`：「已完成 1 个，1 个失败 — 在画布上单独重试」+ 按钮「任务」（英文「Completed 1; 1 failed — retry them individually on the canvas」+「Tasks」）。
- `03-u1-task-center`：点「任务」打开任务中心，「等你处理 1」里是那笔「提交结果不明」和「再发一次」。
- `04-resend-card`：节点上点「再发一次」弹现成那张卡：「再发一次这张图片？上一次没等到结果，可能已经扣费。再发一次可能会再扣一次钱。」取消 / 再发一次。
- `05-resend-done`：确认后那张出图，供应商下单从 2 次变 3 次。
- `06-first-generate`、`07-first-generate-done`：新节点第一次生成，没有重发卡（单张按现有规则也不弹花钱卡），出图，下单从 3 次变 4 次。

任务中心那颗「再发一次」（第一次下单不回话，另一张成功；这一笔有画布节点，走的是节点那条路，没有节点的那条分支真窗没走到，由 `useProductionStatus.test.ts` 的三条覆盖，改回旧形状时三条都红）：
- `01-tc-panel`：通知按钮「任务」打开任务中心，「等你处理 1」里是「提交结果不明，Nomi 已停止自动重试」和「再发一次」（英文「Waiting on you 1」「Submission result is unknown; Nomi stopped automatic retries」「Send again」）。
- `02-tc-resend-card`：点面板里的「再发一次」，弹的是和节点上同一张卡（「再发一次这张图片？」取消 / 再发一次；英文「Send this image again?」Cancel / Send again）。
- `03-tc-after-cancel`：点「取消」，卡关上、节点原样还是「上一次没等到结果」；供应商下单仍是 2 次（面板随外部点击收起是现有行为）。
- `04-tc-resend-done`：重新打开面板再点「再发一次」→ 确认，那张出图，下单从 2 次变 3 次，且第 3 次在确认之后才到（中英两遍的供应商记账时间都核过）。
