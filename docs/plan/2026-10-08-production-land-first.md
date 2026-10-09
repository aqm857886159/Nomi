# 设计卡 + 方向检查：制作流程「先落节点、再发请求」（架构③）

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
- **门岗**：入口表每条加 `landing`（`node-first` + owner，或 `exception`）；例外理由只认 `scripts/generation-entrances-ledger.json#landingExceptions`。

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
