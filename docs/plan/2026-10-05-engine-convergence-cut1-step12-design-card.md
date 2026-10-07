# 发动机收敛第一刀 第 1–2 步：设计卡与拍板单

> 状态：✅ 已实现未推送（2026-10-05，实现线 L-cut1）。F1–F3 已拍（F3 用户拍板，F1 / F2 协调会话定），按推荐组合实现，见 §9。真 App 那一步 `pending-real-app`（独立验收线）。
> 上游：[`2026-10-05-engine-convergence-cut1.md`](2026-10-05-engine-convergence-cut1.md)（施工计划正本、方向检查复盘、双扣地图；用户 10-04 拍板岔路 B）。基线：`origin/main@78cc49ad7`（#985 合入后）。
> 论断都带文件:行或命令；量不了的标 `unverified`。

## 0. 一句话

第 1–2 步要做的事没变：画布单节点 ↑、变体、重生成、重试、分镜行操作，批准 / 派发 / 记账都只走制作流程那一个口子。但计划里三处假设和现有代码对不上（已封计划不收新合同、落地按 Run 章认节点、观察者一次查询失败就停），另外两台发动机对「供应商当场明确拒绝」的回答不一样——这一格不拍，画布并进去以后每次被内容审核拒都会把这个节点锁住。

## 1. 方向检查（fix-churn）

`node scripts/fix-churn.mjs <文件>`，2026-10-04 在本分支跑：

| 文件 | 14 天内 fix 数（这一刀算第几个） |
|---|---|
| `electron/capabilityCore/appIntegration.ts` | 16（第 17） |
| `electron/runtime.ts` | 9（第 10） |
| `electron/productionRun/productionGenerationSubmission.ts` | 9（第 10） |
| `src/workbench/generationCanvas/runner/generationRunController.ts` | 7（第 8） |
| `src/workbench/generationCanvas/runner/catalogTaskActions.ts` | 3（第 4） |
| `electron/tasks/`（`taskIpcHandlers.ts`、`nodeSubmitInFlight.ts` 同目录同概念） | 3（第 4） |
| `electron/productionRun/canvasShotClaim.ts` | 2（第 3） |
| `src/workbench/generationCanvas/spend/`（`spendConfirm.ts` 所在目录） | 6（第 7） |
| `electron/spendGrant.ts` | 未命中 |

全部命中 RW。复盘文档就是施工计划正本 §0、§3、§6（类根因：钱从两个口子出，每修一次都是在两台之间再加一道对账）。结论不变：结构性地收，不再补认领 / 在途锁。本线后续 fix 提交统一带 `Direction-Check: docs/plan/2026-10-05-engine-convergence-cut1.md`。

## 2. 门表（改动前）

- `node scripts/door-map.mjs confirmAndRunNode confirmAndRunNodeVariants regenerateNodeInPlace mintSpendGrant claimCanvasProductionShot withNodeSubmitExclusive runTaskWithIdempotency` → 写 23 扇 · 读 1 扇。其中本步要收的单节点入口：三个控制器函数（`generationRunController.ts` 的 `confirmAndRunNode` / `confirmAndRunNodeVariants` / `regenerateNodeInPlace`）的 11 个调用点（`NodeGenerationComposer.tsx` ×3、`BaseGenerationNode.tsx`、`NodeErrorReport.tsx`、`storyboardRowActions.ts` ×6 行操作、`TaskCenterPanel.tsx`、`useProductionStatus.ts`、`TimelinePanel.tsx`），它们在控制器里各铸一次令牌（`generationRunController.ts:559/606/657`）。
- `node scripts/door-map.mjs runGenerationNode runGenerationNodesBatch runCatalogGenerationTask generationNodeExecutor runWorkbenchTaskByVendor fetchWorkbenchTaskResultByVendor` → 写 9 · 读 4：`runGenerationNode` 只有控制器 4 处调用（3 个单节点函数 + 批量循环），所以第 1、2 步在控制器这一层其实是同一刀。

## 3. 动手前查出来的（计划里没有）

| # | 事实 | 证据 |
|---|---|---|
| N1 | **已封的单镜计划不收新合同**：`generation.patch` 只许 draft，否则抛 `new_draft_required`。计划 §5.1「一个节点一个 Run，每次 ↑ 是同一个 Run 的新 attempt」要么改 reducer，要么每次 ↑ 建一个新 Run | `electron/productionRun/productionRunReducer.ts:212-214` |
| N2 | **Run 的落盘成本**：本机 Windows 临时目录、假供应商、200 / 500 次实测（探针已删）——点 ↑ 到供应商调用前 p50 118–166 ms、p95 222–273 ms（计划门 p95 ≤ 150 ms）；每个单镜 Run 约 97 KB（`events.ndjson` 81 KB：每条事件带一份整 Run 快照）；打开项目时 `list` + 逐个 `read` 约 9 ms / Run，500 个 Run ≈ 4.3 s 主进程同步读盘，且打开钩子 `list` 了两遍 | 探针数字见 §6 格 7；`electron/capabilityCore/appIntegration.ts:509`、`:522` |
| N3 | **画布落地按「这个 Run 的落地章」认节点**：一个节点只挂得住一个 Run 的章，「一个节点、多次 ↑、多个 Run」时落地宿主找不到节点 | `src/workbench/capability/multiShotCanvasLanding.ts:219`（`materializedNodeIdsByClientId`） |
| N4 | **单镜观察者一次查询异常就停**：轮询抛错 → 整个观察抛出 → 记 needs_attention；没有画布那台的 45 秒宽限、429 退避、慢道 20 分钟后落「可找回」 | `electron/productionRun/singleShotGenerationObserver.ts:105`、`electron/capabilityCore/appIntegrationRunObservation.ts:201`；对照 `catalogTaskActions.ts:71`、`:137` |
| N5 | **两台对「供应商当场明确拒绝」回答不同**：画布记「失败」、改了能再点 ↑；制作记 `submission_unknown`、这一镜再发被拦 | 特征测试 `canvasSingleSubmitCharacterization.test.ts`「供应商当场拒绝」、`electron/productionRun/providerRejectionSemantics.test.ts` |
| N6 | 任务中心把每个没取消的 Run 都列一行；每点一次建一个 Run 会和画布队列那一行重复 | `src/workbench/production/productionRunView.ts:110` |
| N7 | 文本节点本来就不走付费令牌（执行器 text 分支不传 gate），Run 物化也只认图 / 视频 / 音频 / 3D | `generationNodeExecutor.ts:62`、`electron/capabilityCore/generationRuntimeAdapter.ts:363` |
| N8 | 画布那台对「写出去之后断了」（socket / timeout）会用同一个键再交两次；主进程同键合并器重放同一个失败所以不二次下单，但节点最后落「失败、可再点」——用户再点就是可能的第二笔。这正是并进 Run 要消掉的那一类 | 特征测试「写出去之后连接断了」；`electron/submissionLedger.ts` 头注释 |

## 4. 岔路（必须拍）

### F1 Run 怎么分：每点一次一个 Run，还是每个节点一个 Run

| 选项 | 做什么 | 用户这边 | 代价 | 风险 |
|---|---|---|---|---|
| **a 每点一次 ↑ 一个单镜 Run（推荐）** | 完全复用现有单镜生命周期（草稿 → 封 → 批 → 交 → 查 → 物化 → 完成），reducer 一行不改；节点记它最近一次 Run 号；同节点在途由主进程按 Run 号前缀扫一遍目录判（实测 0.3–0.6 ms） | 手感不变 | 每次 ↑ 多一个约 97 KB 的 Run 目录；必须同 PR 加「打开项目不读已结束的画布 Run」，否则 500 次点击后打开项目多 4 秒 | 中：要多写一个打开项目的轻量索引 |
| b 每节点一个 Run、每次 ↑ 一个新 attempt（计划原文） | 给 reducer 加「已提交的单镜计划接受新合同」命令，改封印、授权、attempt 编号三处 | 手感不变；Run 目录数 = 节点数 | 碰付费最热的 reducer / 封印 / 授权（§1 表里 9–16 次 fix 的那一片） | 高 |

### F2 等结果由谁驱动

| 选项 | 做什么 | 用户这边 | 代价 | 风险 |
|---|---|---|---|---|
| a 主进程驱动（计划原文） | 交上去以后由单镜观察者查、物化，落地宿主把状态投到节点；渲染层只等 | 节点进度文案变少（只有「生成中」）；**一次网络抖动就落「需要处理」**（N4）；慢视频没有「可找回」 | 先补观察者的宽限 / 退避 / 可找回，落地按节点号认节点（N3），节点文案从 Run 推导 | 中高 |
| **b 渲染层照旧驱动，但每一步都过 Run 的口子（推荐，第二刀再换 a）** | 「交」= Run 的 start（意向日志 → 交 → 受理 / 未知）；「查」= Run 的 poll；「出片」= Run 的 materialize；节点照今天的写口写。渲染层不在（关窗、崩溃、重启）时主进程观察者接手，重开后节点按 Run 找回 | 手感不变（宽限、退避、可找回、取消都照旧） | 两个驱动者要有交接规则：渲染层在驱动时主进程不另起观察 | 中 |

### F3 供应商当场明确拒绝，算「没受理」还是「结果未知」（花钱语义）

| 选项 | 做什么 | 用户这边 | 代价 | 风险 |
|---|---|---|---|---|
| a 照制作那台现在的规矩 | 一律「结果未知」，这一镜锁住，去任务中心核对后放行 | 画布每次被内容审核拒、参数不合、余额不足，节点都锁住，要去任务中心点一次「放行」才能再点 ↑ | 零代码 | 手感明显变差（画布是最常用的面） |
| **b 在唯一判据旁加第三档「收到了明确拒绝」（推荐）** | `outboundDispatchEvidence.ts` 那一份判据旁边，只认**收到了响应**、状态在名单 400 / 401 / 402 / 403 / 404 / 422 / 429（`REJECTION_STATUS_CODES`，只写一处）或「HTTP 200 + 失败信封码」、且没回任务号（5xx、名单外的 4xx 如 408 / 409 / 425、没收到响应的一律仍算未知：409 常见于「同一幂等键已受理」、408 可能是上游收下后才超时，判错就是重复扣钱） → 这一镜「没受理、不扣」、可以再点；两台一起生效 | 画布照旧；Agent 那边也少一类误报「结果未知」 | 改提交出口一处分类 + 两个执行器把「收到的拒绝」打成同一种错；加真 loopback 测试 | 中：判错的代价是可能多扣一次，所以只认有响应、有 4xx 的证据 |
| c 只给画布开例外 | 画布那台的拒绝照旧算失败，制作那台照旧算未知 | 画布照旧 | 同一件事两个答案 | 高：正是要收掉的形状 |

**用户要权衡的核心**：供应商明明白白回了「拒绝」，要不要信它「没收下、没扣钱」？信（b），画布手感不变、Agent 也少误报；不信（a），钱上最保守，但画布每被拒一次就要去任务中心点一下才能再生成。

## 5. 有默认答案的（按默认写进卡，拍板时可改）

- **F4 文本 / ComfyUI 本地 / 本机进程后端**：不进 Run，原路照旧，登记成例外（到期：第二刀传输合一）。理由：文本本来不走令牌（N7）；ComfyUI 本地不花钱，按 09-26 方案是独立 bounded context。
- **F5 任务中心**：画布建的 Run 不进制作那一栏（按 `origin.host = canvas` 滤掉），仍是画布队列那一行，状态取自 Run 的每一步回话；第 3 步批量进 Run 时再统一成 Run 投影。
- **F6 授权信封里的价格**：用画布那台今天的报价口径（`quoteSpendLine`），不新增算价；算不出就是未知（`null`），不当 0。
- **F7 附属付费口（试跑、认证、视频拆解、新手试生成、提示词提取）**：不动，继续用令牌，在 `concept-owners.json` 的 `spend.pending-identity` 下登记例外，到期日 = 第一刀第 4 步。

## 6. 设计卡（按推荐组合 F1a + F2b + F3b，9 格）

```
改动名：画布单节点付费生成并进制作流程（第一刀 第 1–2 步）   线/负责人：L-cut1（实现）/ 另派验收线   类别：[花钱][长跑][可打断]
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在画布上点 ↑（或变体、原地重生成、报错卡重试、分镜行生成、任务中心重新生成），我想它和今天一样快、一样不弹卡，并且中途关窗、崩溃、重启后，这一镜要么照常落图，要么明说「结果没法确认」，**不会被收成空闲让我再扣一次**。步骤：选节点 → ↑ → 节点「提交中 / 生成中」→ 出图落节点 → 任务中心同一行。**不做**：批量「生成全部」与分镜整批（第 3 步）、删认领 / 在途锁 / 令牌整文件（第 3–4 步）、文本 / ComfyUI 本地（F4）、附属付费口（F7）、改价、改界面。**已知坑**：每点一次多一个 Run 目录（F1）；渲染层与主进程交接（F2）。真实任务：(a) 30 节点短片项目逐个 ↑ 出图，挑 2 个做 ×3 变体；(b) Agent 起草 2 镜后，在画布上对其中 1 镜原地重生成；(c) 视频节点 ↑ 后立刻关窗、重开 | (a)(b)(c) `unverified`；走查脚本随实现交付（零花费：本机假供应商 / 网络闸），真 App 那步 `pending-real-app` |
| ★2 谁说了算 | 「这一镜这一次付费生成」的批准 / 派发 / 在途 / 记账唯一 owner = ProductionRun（写口 `productionRunRepository.execute` + reducer，派发口 `productionGenerationSubmission.start` → 提交出口）。碰 4 个概念：`spend.pending-identity`（画布单节点那条 nodeId + quoteId 旧路迁走，批量那条随第 3 步）、`canvas.node-submit-in-flight`（单节点路改由 Run 判在途，文件第 3 步删）、`production.shot-generation-ownership`（判定口不变，单节点路的认领调用挪进主进程准入、第 3 步删）、3D-BOX 准入（判据不搬家，问它的地方从渲染层 `runGenerationNode` 挪到主进程准入，同提交删渲染层那一行） | §2 门表；收口后门表随实现交付 |
| ★3 一致与复用 | 全部复用：Run 账本、单镜生命周期、逐镜授权信封、手势收据（`approvalReceipt` 的主进程手势章）、提交出口、意向日志、`submission_unknown`、派发闸、单镜观察者（只管孤儿 Run）、`buildProfileHttpRequest`、画布那台全部传输。不引新库（持久状态机已是自己的事件溯源 reducer，09-26 定稿决策 3）。自写只有一个接线文件 `electron/capabilityCore/canvasTransportProvider.ts`：把 `runtime.ts` 现有的执行函数包成 `GenerationProvider`，不复制传输代码（领域约束：两种传输挂同一个按镜头花钱的提交出口） | `pnpm run check:self-written`；`grep -n xstate package.json` 无 |
| ★4 全状态 | 节点：空闲 / 提交中 / 生成中（含已超常规时长）/ 成功 / 失败（带原因，可再点）/ 可找回（免费重新拉取）/ **结果没法确认**（不给 ↑，指去任务中心）/ 已取消（没发出去，不扣）。文案全部复用现有 i18n 键（`generationCommon.*`、`classifyGenerationError`），不新增界面 | `pnpm run check:i18n`；截图随实现交付，中英各一 |
| 5 中途表 | 见下表 | 打断脚本随实现交付 |
| 6 外部数据与失败 | 外部来源：供应商 API（各家 mapping 声明）、用户保存的连接、参考素材。「写出去没有」只认 `outboundDispatchEvidence.ts`；F3b 加的「收到明确拒绝」也住那里，只认有响应且 4xx / 信封错误码的证据；上游原文脱敏说人话、不甩锅给 key。同步传输（自定义调用脚本、同步音频、对话出图兜底）没有供应商任务号：包装时用画布那台自己的结果号当 providerTaskId，结果在提交那一刻就已落盘，查询直接回这一份 | `electron/parity/engineDifferences.test.ts`；特征测试 |
| 7 性能预算 | 已测（探针，已删）：每点一次建单镜 Run 到供应商调用前 p50 118–166 ms / p95 222–273 ms（**超计划门 p95 ≤ 150 ms**，需在实现里把「封 + 批」并成一次落盘再量）；97 KB / Run；打开项目 9 ms / Run（500 个 ≈ 4.3 s，F1a 必须配「已结束画布 Run 不读」）。未测：任务中心 500 行、真 App 点击到出站 | 实现交付时补 `test:canvas:performance` 输出 |
| 8 真实条件 | 全部 `unverified`：Windows 真 App、英文界面、最小窗口、500 节点、干净安装、真付费（各 kind 1 次小额）、0.23 回滚读新 Run | 独立验收线 |
| ★9 验收与回滚 | 验收（另一条线）：特征测试全绿且断言不改（F3 那两条按拍板结论改）；双扣 ①–⑥ 测试全绿；新增「崩溃在写出去之后 → 重启后这一镜是结果没法确认、↑ 被拒」「同节点连点两次只发一次」「预演没好 → 主进程准入拒」三条端到端；门表显示单节点入口只经提交出口；`check:generation-entrances` 账本更新。回滚：每步一个 revert；旧节点 meta 不改写（legacy read），新 Run 用现有 schema（`origin.host` 是字符串），0.23 读得懂（读代码得出，`unverified`，合入前在 0.23 安装包上实打一次） | `## 独立验收` 待补 |

**格 5 中途表**（推荐组合下；「今天」是对照）

| 处境 | 停 / 点 × | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 点了还没发出去 | 不发、不扣，节点回空闲（今天同） | Run 停在 authorized，重开后节点「停下待继续」，不自动发（今天：节点空闲） | 确定没写出去：重试 1 次，再失败落失败、不扣 | 同关窗 | 只有一个 attempt：主进程按节点最近一个 Run 判在途（今天靠进程内锁） |
| 写出去了、还没回执 | 只停本地等待，不撤单 | 主进程观察者接手 | 结果未知，不重发，指去任务中心（今天：落失败、可再点 = 可能第二笔） | **结果没法确认、↑ 被拒**（今天：收成空闲，可再扣一次） | 被拒「还在生成」 |
| 供应商受理、在出图 | 停本地等待；Run 里照常收完，重开后落图 | 观察者接手，重开补落 | 宽限内照查，超了落可找回（今天同） | 按 Run 续查 | 同上 |
| 出完图、落盘中 | 不受影响 | 重开补落 | 下载失败按物化规则重试 | 按 Run 补 | 同上 |
| 供应商明确拒绝 | 无 | 无 | 无 | 失败原因从 Run 读回 | F3b：可再点、新 Run；F3a：锁住待核对 |

花费：扣不扣只以「有没有写出去」和（F3b）「收到的是不是明确拒绝」为准；回执在 Run 账本与任务中心。

## 7. 特征测试（已提交，动结构前先锁住）

| 文件 | 钉住什么 |
|---|---|
| `src/workbench/generationCanvas/runner/canvasSingleSubmitCharacterization.test.ts` | 走真实控制器 + 真实执行器，只换渲染层 ↔ 主进程那条边：①用户 ↑ 不弹卡、只发一笔、幂等键 = 运行记录号、结果落节点、队列记成功；②受理后轮询期间节点挂任务号、出片落节点；③供应商当场拒绝 → 失败带原话、改了再点能重新发（F3）；④写出去之后断 → 同键交 3 次、落失败（F3 / N8）；⑤轮询中供应商失败 → 失败；⑥等结果时点停 → 空闲、队列取消、结果不落；⑦提交在路上点停 → 不进轮询；⑧原地重生成 → 同节点、旧结果进历史；⑨Agent 发起 → 先弹卡、取消一笔不发 |
| `electron/productionRun/providerRejectionSemantics.test.ts` | 制作那台：执行器抛「rejected the request」→ `submission_unknown`、这一镜再发被拦、供应商只收到 1 次（F3） |
| 双扣 ①–⑥ 既有测试 | `multiShotBatchScheduler.e2e`、`productionBatchSettlesAfterRelease.e2e`、`canvasShotClaimAttempt`、`productionShotPhase`、`submissionNotDispatched`、`productionShotDetachReport.e2e`、`productionRunReducerCanvasLanding`、`batchScheduleDerivation`、`nodeSubmitInFlight`：本分支 9 个文件 127 条全绿 |

## 8. 拍板后的施工步（按推荐组合，每步可单独 revert）

1. （若 F3b）提交出口加「收到明确拒绝」一档：判据住 `outboundDispatchEvidence.ts`，两个执行器把收到的 4xx / 信封错误码打成同一种错；loopback 真端口测试；`providerRejectionSemantics.test.ts` 断言按结论翻。根因合同 `docs/fixes/<日期>-provider-explicit-rejection.root-cause.json`。
2. `canvasTransportProvider.ts`：包 `runtime.ts` 的执行函数（不复制传输）；对拍矩阵加一列「画布经 Run」，出站报文逐字节等于今天的画布。
3. 主进程「画布生成这一镜」命令（受信 IPC，手势章）：准入（预演闸、在途、绑定制作镜头的认领）→ 建单镜 Run → 封 + 批一次落盘 → start；查 / 物化两个口子；渲染层不在时交给观察者。同提交删 `runGenerationNode` 里的预演闸那一行、删单节点路上的 `mintSpendGrant`（`generationRunController.ts:559/606/657`）。
4. 打开项目轻量索引：已结束的画布 Run 不 `read`；任务中心滤掉 `origin.host = canvas`。量 500 Run 打开耗时。
5. 走查脚本（零花费：本机假供应商 / 网络闸）+ `check:generation-entrances` 账本 + `concept-owners.json` 例外登记（F4、F7 带到期日）+ 门表前后对比。

## 自己写了什么、为什么必须

这一轮只写了设计卡和两份特征测试，没有生产代码。拍板后唯一的新生产文件是 `canvasTransportProvider.ts`（接线：把画布那台的传输挂到按镜头花钱的同一个提交出口，领域约束），没有新判据、没有新状态机、不引新库；F3b 的第三档判据住在现有的唯一判据文件里，不另立一份。

## 9. 实施结果（2026-10-05）

拍板：F3 = b（用户）；F1 = a、F2 = b（协调会话）；F4–F7 按默认。

| 步 | 提交 | 做了什么 |
|---|---|---|
| 1 | `0377b6042` | 第三档「收到了明确拒绝」：判据 `outboundDispatchEvidence.providerExplicitlyRejected`，两个执行器收到响应才挂证据（`providerAnswer`），提交出口记成 `needs_attention / provider_rejected`、预留安全释放。合同 `docs/fixes/2026-10-05-provider-explicit-rejection.root-cause.json` |
| 2 | `7c4cad6d6` | `canvasTransportProvider` 把画布那台的传输包成执行器（不复制传输）；`runTask` 的令牌闸改按 admission 选（缺省令牌路，画布单镜 Run 传 `RUN_APPROVED_ADMISSION`）；对拍矩阵加 `canvas-node-run`，7 个用例与画布按生成逐字节相同 |
| 3 | `e46569609` | 主进程「画布生成这一镜」（`appIntegrationCanvasShot`）：准入 → 单镜 Run → 手势收据批准 → 提交出口；查结果经 Run；渲染层不在交给观察者。控制器三处单节点铸令牌删掉（文本 / 本地 ComfyUI 例外）；3D-BOX 闸挪进主进程准入（单节点路删渲染层那一行，批量令牌路暂留到第 3 步）。合同 `docs/fixes/2026-10-05-canvas-paid-into-production-run.root-cause.json` |
| 4 | `8cc90106b` | 打开项目只 `listRuns` 一次（以前每个制作 Run 读 4 次）；「没收尾」标记按节点指纹命名、不打开文件；收据库过期已久的拿掉 |
| 5 | 本提交 | 走查剧本 `tests/ux/full-walk/playbooks/pb11-canvas-single-run.walk.mjs`（零花费回环夹具 + 出网闸），登记进全功能走查目录 J01 |

**门表（改动后）**：11 个单节点调用点不变，全部经三个控制器函数 → `authorizeSingleNode`（只给文本 / 本地 ComfyUI 两类例外铸令牌；控制器里铸令牌从 3 处变 1 处）→ `runGenerationNode(ledger: 'run')` → 执行器 → `submitCanvasShotRun` → 受信 IPC `nomi:tasks:canvas-submit` → `createCanvasShotRuns` → `productionGenerationSubmission.start`（提交出口）。查：`pollCanvasShotRun`（执行器与「重新拉取」两处）→ Run 的 poll / materialize。`node scripts/door-map.mjs submitCanvasShot submitCanvasShotRun createCanvasShotRuns pollCanvasShotRun` → 写 5 · 读 1，一条链。

**性能（本机 Windows、机器有负载、假供应商，60–300 次）**：点 ↑ 到供应商调用前 p50 约 180–245 ms、p95 约 290–390 ms（计划门 p95 ≤ 150 ms，只记录不阻断；界面在 IPC 之前就进「提交中」，不等它）。钱花在：
- Run 命令约 7 条 × 9–12 ms ≈ 70 ms（约 35%）：每条命令写一条带整份 Run 快照的事件 + 重写 run.json + 仓库锁；
- 收据库 5 次读写 ≈ 65 ms（约 33%）：整份状态读、验 MAC、原子重写；
- 提交出口的意向日志 / 运行时信封 / Run 锁 ≈ 25 ms；建草稿与报文准备 ≈ 15 ms。
- 收据库原先不清理：300 次点击涨到 2.8 MB、每次批准 1.4 秒——已在第 4 步修掉（稳定在最近几分钟）。

**登记为后续（不放进本 PR）**：
- Run 事件「只追加增量 + 定期快照」：预计每条命令 10 ms → 3–5 ms，每次点击省约 35–45 ms；每个单镜 Run 落盘约 97 KB → 约 20 KB。碰 `productionRunRepository` 读写格式，要独立一刀并做旧数据只读兼容。
- 收据三连（挑战 → 铸 → 消费）并成一次读写、去掉重复的 verify / consume：预计每次点击再省约 40 ms。两项合计预计 p95 落到 150 ms 以内（`unverified`）。

**信任模型的变化（如实写明）**：以前「人点了确认」由渲染层的确认卡与令牌表达；现在主进程把**到达受信 IPC `nomi:tasks:canvas-submit` 的那一次调用**当作一次用户手势并铸收据。这比以前更依赖渲染层不被劫持：渲染层若被注入脚本，就能自己发这条 IPC。与以前的信任边界大致相当（以前被劫持的渲染层同样能铸令牌、发提交），没有变得更宽，也没有变得更窄。收据防御：配置要求 `receiptTtlMs >= defaultTtlMs`（收据比挑战先过期会让同一手势有机会铸出第二张），违反则直接拒绝该配置；生产两者都是 5 分钟。

**第 3 条核对（受理后关窗、重开后结果能落地）——真 App 待验（`pending-real-app`）**：以后这样验：用 `submit_declaration` 登记一个会先回 queued 的本机异步适配器（零花费），在画布上点 ↑，等到节点进「生成中」后立刻关 App，重开后等结果；预期节点由主进程观察者接手，按 Run 找回并落图，不被收成空闲、不出现第二笔提交。

**给独立验收线的核对清单**：见实现线报告；真 App 一步 `pending-real-app`：pb11 中英各跑一遍、C 之后关掉 App 再开再点 ↑ 仍被拦、0.23 安装包打开带画布 Run 的项目不报错。
