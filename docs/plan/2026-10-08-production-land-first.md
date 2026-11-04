# 设计卡 + 方向检查：制作流程「先落节点、再发请求」（架构③）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：ProductionRun 派发前必须有已落地的节点；单镜 / 多镜同一个落地准入点；结局回填与普通画布同语义
线/负责人：I-landfirst（实现）  合同：协调会话 10-08（brief-I-landfirst.md）  类别：[花钱][长跑/可打断]
状态：已实现未推送（必红测试 10-08 经协调会话审过；Q1–Q4 已拍板）
```

## 开工三问

1. **14 天 fix 次数**（`node scripts/fix-churn.mjs`）：`appIntegration.ts` 18（这刀第 19）、`multiShotBatchScheduler.ts` 6、`electron/productionRun/multiShotCanvasLanding.ts` 5、`src/workbench/capability/multiShotCanvasLanding.ts` 8（目录 20）、`canvasLandingHost.ts` 4、`tryModel.ts` 3、`mcpStdioServer.ts` 10、`productionGenerationSubmission.ts` 11；概念「制作镜头的节点还在不在画布上」13、「画布付费生成（一镜一个单镜 Run）」2；自写登记 `gate-family`（30 天 98）、`mcp-protocol`（30 天 28）。全部命中 → 本页即方向检查，提交带 `Direction-Check: docs/plan/2026-10-08-production-land-first.md`。这一刀不是补丁轮次，而是协调会话已裁决的结构改动（架构③），类根因沿用 `docs/plan/2026-10-07-canvas-landing-direction-check.md` 的乙类（Run 账本与画布节点双份真相）。
2. **是不是我们独有的**：是。「镜头 ↔ 画布节点」「按镜头的花钱准入」在 `docs/engineering/self-written.json` 领域目录里。通用部分不自写：「调用前必须先拿到准入」用 TypeScript 类型（品牌类型）表达，编译器就是门岗；生成入口门岗只加一个数据字段（`landing`），不扩扫描面。
3. **补 / 换 / 删**：**换 + 删**。准入函数 `admitShotsForDispatch` 替掉开拍路径上的 `landCanvasBestEffort`（同提交删掉，主进程不再有「尽力预落地」这个口子）；`attachShotResult` 的「节点不在就跳过」换成按 nodeId 暂存（复用普通画布的 `holdRunOutcome`）。

## 入口全数（door-map + 手跟一跳）

| 门 | 发请求 | 改前：请求前有节点吗 | 改后 |
|---|---|---|---|
| GUI 多镜开拍 `appIntegration` start | 调度器 `dispatchUnit` → `submission.start` | 不保证：best-effort 预落地，失败照派；项目没开就不落 | 开拍前 + 每一趟派发前过准入 |
| GUI 单镜开拍 `appIntegration` start | `submission.start` | 无：先交、后落 | `startSingleShotProduction`：先落后交 |
| 进程内 stdio MCP（`mcpStdioServer`）多镜 / 单镜 | 同上 | **从不落**（R-gen-doors 没列，本线补查） | 同一准入，落地器一律拒（没有渲染层） |
| 恢复 / 继续 / 重做（`kickSchedulerForRun`） | 调度器 | 不看节点 | 调度器每一趟过准入 |
| 付费卡确认（`appIntegrationSpendConfirm.confirmOneShot`） | 经 start | 依赖草稿投影碰巧落过 | 批之前先过准入（确认 = 放到画布） |
| 画布节点 ↑（`appIntegrationCanvasShot`） | `submission.start` | 有（节点就是来源） | 来源节点记进 `origin.nodeId`，同一准入 |
| `nomi_try_model` / `model.onboarding.try` | `runTask` | 无 | 登记例外（理由在 `landingExceptions`） |
| 接入认证会话试跑 `integrationSession.ts::runTask` | `runTask` | 无 | 按 try-model 例外处理，单独列一行（10-09 裁决） |

全部生产派发都汇到 `productionGenerationSubmission.start`，它现在只收「已落地」准入。

## 设计（合同不改）

- **唯一准入点** `electron/productionRun/shotLandingAdmission.ts#admitShotsForDispatch`：读 Run → 没节点的镜调一次落地器（主进程 → 渲染层 materialize-shots，失败如实抛）→ 重读 → 有节点的发准入；落不下的报回来，调用方经同一模块的 `recordLandingFailure` 把 Run 停在 `landing_failed`（`retryLiftsStop` 为 true）。
- **提交出口**：`submission.start(input: GenerationSubmissionDispatchInput)` 必须带 `LandedShotAdmission`（品牌类型，只有准入函数造得出来）；第一笔耐久写之前、拿到 Run 锁之后各按耐久 Run 复核一次（`assertShotAdmission`），伪造 / 过期拒（`shot_not_landed`）。不依赖可注入的 `beforeDispatch`。
- **落地器** `canvasLandingHost.landBeforeDispatch`：不再 best-effort；文稿来源计划也真建节点（Q3 确认即落）；草稿投影 / Run 跟随 / 打开项目对账仍是 best-effort，且不替用户放文稿计划。
- **项目没打开（Q1 = A + C′）** `landingProjectAccess.ts`：主窗口隐藏且用户从没叫出来过（`backgroundLaunch.mainWindowHiddenFromUser`）→ 经现有 `nomi:production-deep-link` 通道让它打开目标项目（不 show、不 focus）再落地；用户看得见的窗口开着别的项目 → 拒，绝不切换；进程内 stdio 路 → `refuseLandingWithoutRenderer` 拒。拒绝回给 Agent「需要在 Nomi 里打开项目「X」后再继续」（`electron/productionRun/landingFailureCopy.ts`，中英两套，不谈钱）。
- **付费卡（Q2）**：确认那一下先过准入；落不下来什么都不批，卡留在原地、这一镜没决定，再按一次就是重试；卡上那一句复用现有失败行（`actionFailure.canvasLandingFailed`），不加新界面、不加任务中心行。
- **按镜头身份去重（10-09）**：文稿方案的那一镜如果已经经分镜行「放到画布」落过节点（方案 id = Run id，节点身份 = storyboardDesignId × shotId / anchorId，判据只用 `storyboardNodeBinding.findShotNode / findAnchorNode`），确认时认那个节点、绑到 Run 上，不再落第二份；认来的节点不重绑定候选、不拉进分镜组。镜头 id 不是稳定 id 时不猜，照常新建。
- **升级（10-09）**：升级前那一版建的画布批量确认草稿没记 `origin.nodeId`：不发、按「没交」收尾（收回出价），并带码 `canvas_consent_predates_upgrade` 回给画布，节点上如实说「升级后这批没有发出，需要重新确认」（中英，不谈钱）。已经交出去的旧 Run 不受影响（准入只在新一次派发之前）。
- **结局回填**：落地报文带上 Run 绑着的 `nodeId`；节点不在时出片结果 / 确定失败按 nodeId 暂存（同一份结局只暂存一次），撤销 / 放回时由 `canvasDocumentCommit` 落上。
- **门岗**：入口表每条加 `landing`（`node-first` + owner，或 `exception`）；例外理由只认 `scripts/generation-entrances-ledger.json#landingExceptions`，而且例外按身份写死（`APPROVED_LANDING_EXCEPTIONS`：try-model、接入认证试跑两条），多一条、少一条、换成普通调用点都红（#1139 N3）。

### #1139 评审后的语义（协调会话 10-09 裁决）

- **B1 部分落地按镜头算，不整批拦**：一批里已经落下、已经批过的兄弟镜照常派发；没落下的那一镜这次派发 0 次，Run 歇下时停在 `landing_failed`，点「继续」只重试没发出的那几镜（已发出的不再交）。用户看到的话必须和真实派发一致：
  - 一镜都没落下 → `nextAction: canvas_landing_failed`，那一句才说「这次没有发出生成请求」；
  - 部分落下 → `nextAction: observe`，逐镜说「已放到画布并发出 N 镜：…；有 M 镜没放到画布上，没有发出：…」（`landingOutcomeNotice`，中英）；
  - Agent 读 Run：投影带逐镜事实 `landing: { sent, notPlaced }`（`shotLandingFacts`，只读耐久 Run），转述按它说，一镜都没发出时才说「这次没有发出生成请求」；
  - 画布占位卡、付费卡的那一句改成按这一镜 / 这一批里那几镜说，不再对整批断言。
- **B2 C′ 租约**：拿到项目时同时拿一份租约（窗口代次 `backgroundWindowEpoch` + 仍对用户隐藏 + 窗口里开着的项目）。发 deep-link 之前、认下项目之后、排到落地队列时、发 materialize 之前、写回绑定之前都核；等待期间窗口被叫出来、用户切项目、窗口重建、hydrate 认下了别的项目，任一项就取消：`landing_failed`、派发 0 次、渲染层一次落地请求都不收。渲染层自己再按报文 `projectId` 核它认下的项目（`materializeShots` 的 binding 栅栏）。
- **B2 租约管到哪为止（第二轮复审，协调会话裁决）**：租约管到「落地写完、绑定写回」为止——写回绑定之后再核一次，失效就按 landing_failed：这一趟 0 派发，节点已经在画布上（绑定也在），之后「继续 / 再开一次」直接认它再派。**之后的派发不看窗口状态**：租约保护的是「后台往渲染层写节点」这一步，不让它和用户抢写、不切换用户可见的项目；节点已经落在画布上、也绑进了 Run，「生成那一刻 = 落画布那一刻」已经成立，用户确认过的生成就该照常发出，窗口这时候被打开不影响节点存在。落地器抛错时，这一次要落的镜一律不算落好（哪怕绑定已经写进了 Run）；渲染层正常返回、只落下了一部分，落下的照常派。
- **「已发」说实话（第二轮复审）**：开拍那一刻的逐镜通知在调度器和供应商都还没跑时就回（driveScheduler 是 fire-and-forget），所以只说「已放到画布、开始生成 N 镜」，不说「已发出」；「没放上的那几镜没有发出」照旧成立。Agent 读 Run 时「发出了」只认唯一判据 `jobMayHaveReachedProvider`（`provider_not_reached`、当场被拒、同意过期停在已授权都不算）。
- **「继续」说的就是会发生的（第二轮复审第 3 条）**：因为落地失败停下的批次，「继续」先过同一个准入点落画布：一镜都落不下 → 不继续、如实回「没放到画布上」；剩下没发的镜节点都被用户删掉了（detached）→ 制作流程不再派它们（删除事实优先），如实回「没有可继续的，去画布上直接生成那一镜」；落下了才继续、踢调度器。逐镜事实里另列 `removed`（节点被删、不会再派），不混进「没放上、可重试」。
- **「继续」三扇门一个判定（#1139 V-1139c）**：画布占位卡的「继续」（resume-batch IPC）、制作面板的「从断点继续」（渲染层 run.control）、外部 Agent 的 nomi_run_control resume（dispatcher production.control）都只问 `resumeOutlook`：这次继续会派哪几镜（其中哪几镜还没放到画布上）；一镜都不会派、也没有在等的 → `nothing_to_resume`，并说清剩下的镜各是为什么（节点删了 / 画布已接手 / 失败要单独重做）。run.control 的写口（`applyRunControl`）也问它，不写、抛带结果的 `NothingToResumeError`，谁绕过入口都改不成 running；各入口只把结果转成自己的话（画布卡 failure 码、面板那句真话、MCP 结构化 `resume.outcome`）。「会派的镜」只有一个定义 `shotsAwaitingDispatch`，这次补上了「画布已接手」也不派。以前只有画布卡、只在落地失败那一种停下里问过。
- **「生成剩下 N 张」一张一张交（10-09 协调会话拍板 B）**：上一张供应商受理了（拿到任务号）才批下一张；只等受理、不等生成完，受理之后各张照常并行生成。等的这段 × 照样进得来，正在交的那一张交完，后面的一张都不再批；批了却不会再派（Run 停了）就停下、如实少算这一张；派发迟迟不开始（30 秒）或交的那一下一直没结论（5 分钟兜底，供应商自己的提交超时先到）就停下如实说。卡上「正在发出 k/N」的 k = 批下的张数 = 供应商已受理的 + 正在交的那一张。为了不让刚批下的一镜陪着调度器睡完一觉（3–15 秒），同一 Run 的驱动被并进来时当场叫醒（`restUnlessKicked`）。判据住 `shotProviderHandover.ts`，只读耐久 Run。
- **× 能在两张之间插进来（#1139 CI eval:journey）**：「生成剩下 N 张」在两张之间先让出一拍事件循环，× 这条 IPC 才处理得到。以前每批一张都要等一次渲染层落地（真 I/O），那一拍是碰巧有的；节点先落之后这一叠全是微任务，× 要等整叠批完才轮得到。
- **一个 Run 一趟驱动 + 锁忙不是失败（#1139 第三轮，走查「12 张全批只发 10 张」）**：GUI 开拍口每批下一镜就新起一趟调度器驱动（只有重踢那条先查「在不在跑」），几趟抢同一把 Run 锁；抢输的那一镜被当成「这一趟的失败」丢下，几趟都歇了还说静止，它停在 authorized 再没人派（实测 shot-8 / shot-9）。让一拍之后批得更交错，这个旧洞才露出来。改法：调度器自己保证同一进程一个 Run 一趟驱动（`drivesInFlight`：再踢就并进去，歇下前按最新 Run 再走一遍），删掉主机层那份「谁在跑 / 跑时又被踢」；Run 锁被别的写者（别的进程）占着 = 等一拍再派（计进本趟等待预算，超了就如实说没歇稳、交给定时重踢），不进失败集。
- **逐镜交之前重核停下，长在交一镜的边界里（#1139 第三轮）**：整批派生 / 整批准入 / 整批确认之后、逐镜真正交出去之前，Run 被急停 / 取消 / 画布接手 / 节点删了，后面的镜都不许再交。这道判（镜头认领闸 `decideShotClaim`）原来已经在提交出口里逐镜跑，但它是装配方注入的依赖：生产三处都接了，测试夹具一律注入空函数，新装配方也能忘了接。现在它长在 `createProductionGenerationSubmission` 里，调用方换不掉、漏不了；`beforeDispatch` 只剩测试观察用的可选钩子（先跑它、再跑认领闸）。覆盖的逐镜派发入口：调度器（GUI 付费卡、MCP 两条、Agent、重启恢复、继续 / 重做都经它）、单镜开拍口 `startSingleShotProduction`（GUI + 无界面 MCP）、画布节点 `appIntegrationCanvasShot`——三者都只经 `submission.start` 交，这是唯一边界。
- **N1 观察拆开**：`submission.observeAccepted` 只观察已受理的那一次，不收准入、绝不调用供应商提交（节点删了也照样收结果）；`submission.start` 只给新派发，每次都先过准入，已受理的那一次再调它会被拒（`generation_already_accepted`）。单镜开拍口与调度器遇到已受理的先走 `observeAccepted`。
- **N2 暂存只在本次会话**：节点不在时暂存的结局住在画布 store 的 `heldNodeOutcomes`，与普通画布同一份；项目装载（`canvasDocumentCommit` 的 load）对两者一起清空——撤销栈本来就只在内存里，重启后也撤销不了删除。结果本身不丢：出片照常物化进 Run 账本（artifact）和项目里的文件，重新装载后仍在（`landFirstResultDurable.test.ts`）。

## 设计卡（花钱 + 可打断，9 格）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我（或我的 Agent）确认生成，我想每一镜先在画布上出现再发请求，以便知道这一次生成落在哪；落不下来就别发，告诉我、让我再点一次。不做：不改普通画布 / 分镜 / 列表的生成（它们已先有节点）；不新增界面。 | 必红测试 + C′ 测试（见★9） |
| ★2 谁说了算 | 准入与「落地失败」写口：`shotLandingAdmission`；拦截：提交出口 `submission.start`；结局暂存：store `holdRunOutcome`；替 Agent 打开项目：`landingProjectAccess` | `node scripts/door-map.mjs admitShotsForDispatch landBeforeDispatch` |
| ★3 一致与复用 | 落地复用 materialize-shots 与 `plan.bind-shot-nodes`；停下原因复用 `run.stop`；暂存复用普通画布那一份；打开项目复用 deep-link 通道与渲染层 `revealProjectTarget` | — |
| ★4 全状态 | 全落下 → 派；部分落下 → 落下的派、其余停 landing_failed；全落不下 → 0 派、停 landing_failed；节点已删（detached）→ 不派（认领照旧判给画布）；结局到时节点不在 → 暂存，撤销后落上 | 测试矩阵 |
| ★5 中途表 | 落地中关窗 / 切项目 → 落地失败、不派；派发后删节点 → 结局暂存；继续 → 重落再派；重启恢复 → 调度器同一准入；隐藏窗口等项目认下最多 30s，等不到按拒绝处理 | multi / single 的 retry 条、C′ 测试 |
| ★6 外部数据与失败 | 渲染层不可用、项目未开、超时（60s）都算落地失败，不吞错，原因（含项目名）回给 Agent | `landFirstProjectAccess.test.ts` |
| ★7 性能预算 | 每趟派发前多一次读 Run；只有存在未落地镜时才发渲染层 RPC（已落地的不重复落） | single「已落地不再落」条 |
| ★8 真实条件 | 本线只跑确定性测试，不起 App、不付费；真 App 最小真付费（多镜 2 + 单镜 1 + 一次人为落地失败 + 一次 MCP 冷启隐藏窗口）由协调会话亲自跑 | unverified |
| ★9 验收与回滚 | `electron/productionRun/landFirstMultiShot.test.ts`（4）、`landFirstSingleShot.test.ts`（4）、`landFirstOneAdmission.test.ts`（4 + 类型断言）、`landFirstProjectAccess.test.ts`（4）、`src/workbench/capability/productionOutcomeOnDeletedNode.test.ts`（18）、付费卡重试 e2e（1）、`scripts/check-generation-entrances.node-test.mjs`（新增 4）。改回旧行为必红做过（见交付报告）。独立验收：Codex 另一条线。回滚：revert 实现提交。 | `## 独立验收` 待派 |

## 方向检查

- **一句话根因**：「这一镜在不在画布上」由 Run 账本和画布节点各存一份，花钱口只看账本（认领、授权、同意窗口），从不要求账本里有节点——于是落地成了「尽力而为的旁路」，每多一个开拍时机（单镜 / 无界面 / 恢复）就多一个先发请求、后找地方放的口子。
- **类**：乙（双份真相）+ 丙（结局到了容器不在），见 10-07 复盘。铁律 ⑫「点了 = 以为的」：用户点确认以为在画布上生成，实际可能只在账本里生成。
- **不改结构会冒出什么**：① 新开拍时机（例如 ACP 外部 Agent）照抄 `submission.start` 又漏落地——现在编译不过；② 无界面 MCP 生成的结果永远不在画布上——现在拒并说清；③ 结局回填再长一条「节点不在就跳过」——现在与普通画布同一个暂存。
- **选项**：补（每个开拍口各加一句 await 落地）→ 否，门数不减、新口子照漏；**换（本设计）**→ 是；重写（把节点身份并进 Run，画布只读投影）→ 属「分镜 / 画布同一份镜头」后续；B（主进程直接把节点写进没打开的项目文件）→ 协调会话记成独立卡，不在本 PR。
- **用户要权衡的核心**：落不下画布时宁可不发请求、让用户再点一次，也不先发再找地方放。

### P0：碰到的自写登记

- **`mcp-protocol`（to-replace）**：本刀只改 `mcpStdioServer.ts` 里开拍分支的接线（单镜改调共用开拍口、多镜给调度器递落地器），协议层一行没动。协议本身已交给官方 MCP TypeScript SDK v2（https://ts.sdk.modelcontextprotocol.io/v2/）；剩下的是领域装配，替换计划照 `docs/plan/2026-10-05-mcp-official-sdk.md` 走，本刀不扩它。为什么现在不换：要换的不是本刀碰的这几行（领域接线不随协议库走）；哪天换：按那份计划的第 3 段。
- **`gate-family`（under-review，评审期 2026-10-31）**：本刀的「不落地就派」主防线在 TypeScript 类型上（编译器拦），不新增门岗脚本；`check:generation-entrances` 只多核一个声明字段与一张例外表。现成方案对照：eslint-plugin-boundaries / dependency-cruiser 管的是「谁能 import 谁」，表达不了「这个入口发请求前有没有节点」这条领域声明（https://github.com/javierbrea/eslint-plugin-boundaries、https://github.com/sverweij/dependency-cruiser）。为什么现在不换：结论等门岗账本（`docs/audit/2026-10-01-gate-ledger.md`）拍板；哪天换：账本保留 / 合并 / 删除清单拍板后。

## 先查别人

- 「先拿到许可才能调用」用类型表达（品牌类型 / nominal typing）：https://www.typescriptlang.org/play/?#example/nominal-typing 。本刀的 `LandedShotAdmission` 即此法，编译器就是门岗，不另写扫描器。
- 「有副作用之前先过一道零副作用的闸」：Run 提交出口早已采用（派发闸排在第一笔耐久写之前），electron/productionRun/submissionOutbox.ts:272。本刀把「节点先存在」放进同一个出口，不另起一条。
- 节点不在时到达的结局按 nodeId 暂存、节点回来时落上：普通画布已有，src/workbench/generationCanvas/runner/runProjectDelivery.ts:46（holdRunOutcome）。制作流程复用同一份，不另写暂存区。
- 主进程让窗口打开某个项目：现有 deep-link 处理 src/workbench/project/useProjectNotificationTarget.ts:20（revealProjectTarget）；后台冷启的隐藏主窗口 electron/backgroundLaunch.ts:14（backgroundWindowOptions）。C′ 复用这两样，不新建窗口。
