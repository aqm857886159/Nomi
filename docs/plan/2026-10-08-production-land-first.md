# 设计卡 + 方向检查：制作流程「先落节点、再发请求」（架构③）

```
改动名：ProductionRun 派发前必须有已落地的节点；单镜 / 多镜同一个落地准入点；结局回填与普通画布同语义
线/负责人：I-landfirst（实现）  合同：协调会话 10-08（brief-I-landfirst.md）  类别：[花钱][长跑/可打断]
状态：必红测试已写，等协调会话审（未实现）
```

## 开工三问

1. **14 天 fix 次数**（`node scripts/fix-churn.mjs`）：`appIntegration.ts` 18（这刀第 19）、`multiShotBatchScheduler.ts` 6、`electron/productionRun/multiShotCanvasLanding.ts` 5、`src/workbench/capability/multiShotCanvasLanding.ts` 8（目录 20）、`canvasLandingHost.ts` 4、`tryModel.ts` 3；概念「制作镜头的节点还在不在画布上」13、「画布付费生成（一镜一个单镜 Run）」2；`check-generation-entrances.mjs` 属自写登记 `gate-family`（under-review，30 天 98 个 fix）。全部命中 → 本页即方向检查，提交带 `Direction-Check: docs/plan/2026-10-08-production-land-first.md`。这一刀不是补丁轮次，而是协调会话已裁决的结构改动（架构③），复盘的类根因沿用 `docs/plan/2026-10-07-canvas-landing-direction-check.md` 的乙类（Run 账本与画布节点双份真相）。
2. **是不是我们独有的**：是。「镜头 ↔ 画布节点」「按镜头的花钱准入」在 `docs/engineering/self-written.json` 领域目录里。通用部分不自写：①「调用前必须先拿到准入」用 TypeScript 类型（品牌类型 token）表达，不新写扫描器；② 门岗只在已有 `check:generation-entrances` 上加一个数据字段（`landing`），不新增扫描逻辑——gate-family 正在评审，本刀不扩它的扫描面。
3. **补 / 换 / 删**：**换 + 删**。新的准入函数 `admitShotsForDispatch` 替掉开拍路径上的 `landCanvasBestEffort`（同提交删掉），不留「落不下也照派」的旧路；`attachShotResult` 的「节点不在就跳过」换成按 nodeId 暂存（复用普通画布的 `holdRunOutcome`）。

## 现状（入口全数，door-map + 手跟一跳）

| 门 | 发请求 | 请求前有节点吗 |
|---|---|---|
| GUI 多镜开拍 `appIntegration` start | 调度器 `dispatchUnit` → `submission.start` | 不保证：best-effort 预落地，失败照派；项目没开就不落 |
| GUI 单镜开拍 `appIntegration` start | `submission.start` | 无：先交、后落 |
| 无界面 MCP（`mcpStdioServer`）多镜 / 单镜 | 同上 | **从不落**（R-gen-doors 报告没列这扇门，本线补查） |
| 恢复 / 继续 / 重做（`kickSchedulerForRun`） | 调度器 | 不看节点 |
| 画布节点 ↑（`appIntegrationCanvasShot`） | `submission.start` | 有（节点就是来源） |
| `nomi_try_model` / `model.onboarding.try` | `runTask` | 无（批准的例外） |
| 接入认证会话试跑 `integrationSession.ts::runTask` | `runTask` | 无（**待裁决**：算不算同一个例外） |

全部生产派发都汇到 `productionGenerationSubmission.start`（单镜 / 多镜 / 画布单节点）。

## 设计（合同不改）

- **唯一准入点** `electron/productionRun/shotLandingAdmission.ts#admitShotsForDispatch`：读 Run → 没节点的镜调一次「落画布」依赖（主进程 → 渲染层 materialize-shots，不再 best-effort，失败如实抛）→ 重读 → 有节点的发一份准入 token；落不下的由它**一处**写成 Run 停下原因 `landing_failed`（`retryLiftsStop` 为 true：「继续」/ 重做 = 重落再派）。
- **调用者**：多镜调度器每一趟派发前（覆盖开拍、继续、重做、重启恢复全部门）；单镜新开拍口 `singleShotProductionStart.ts#startSingleShotProduction`（GUI 与无界面 MCP 共用）；画布单节点（来源节点即落地，origin 记 nodeId）。
- **提交出口**：`submission.start` 必须带准入 token（类型上不带编译不过），并在第一笔耐久写之前按耐久 Run 复核（节点绑着、没 detached），伪造 / 过期一律拒（code `shot_not_landed`）——不依赖可注入的 `beforeDispatch`。
- **结局回填**：落地报文带上 Run 绑着的 `nodeId`；节点不在时 `attachShotResult` / 运行状态改走 `holdRunOutcome`（与 `runProjectDelivery` 同一个暂存），撤销 / 放回时由 `canvasDocumentCommit` 落上。
- **门岗**：入口表每条加 `landing`（`node-first` + owner，或 `exception`），例外理由住登记表 `landingExceptions`；try-model 登记例外 + 理由（只两个口、走唯一钱闸与确认、结果与回执可按任务号查）。

## 设计卡（花钱 + 可打断，9 格）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在 Agent 面板点确认付费卡，我想每一镜先在画布上出现再开始花钱，以便钱花在哪一镜我看得见；落不下来就别花，告诉我、让我再点一次。不做：不改普通画布 / 分镜 / 列表的生成（它们已先有节点）；不新增界面布局。 | 必红测试 4 份（见★9） |
| ★2 谁说了算 | 准入与「落地失败」状态唯一 owner：`admitShotsForDispatch`；拦截唯一 owner：提交出口 `submission.start`；结局暂存唯一 owner：store `holdRunOutcome` | `node scripts/door-map.mjs submitCanvasShotRun landCanvasForRun dispatchUnit` |
| ★3 一致与复用 | 落地复用现有 materialize-shots 与 `plan.bind-shot-nodes`；停下原因复用 `run.stop`；暂存复用普通画布那一份 | — |
| ★4 全状态 | 落地成功 → 派；部分镜落下 → 落下的派、其余停在 landing_failed；全部落不下 → 0 派、停 landing_failed；节点已删（detached）→ 不派（认领照旧判给画布）；结局到时节点不在 → 暂存，撤销后落上 | 测试矩阵 |
| ★5 中途表 | 落地中关窗 / 切项目 → 落地失败、不派；派发后删节点 → 结局暂存；继续 → 重落再派；重启恢复 → 调度器同一准入 | multi / single 测试的 retry 条 |
| ★6 外部数据与失败 | 渲染层不可用、项目未开、超时（60s）都算落地失败，不吞错；无界面 MCP 见待裁决 Q1 | — |
| ★7 性能预算 | 每趟派发前多一次读 Run；只有存在未落地镜时才发一次渲染层 RPC（已落地的不重复落） | single「已落地不再落」条 |
| ★8 真实条件 | 本线只跑确定性测试，不起 App、不付费；真 App 最小真付费（多镜 2 + 单镜 1 + 一次人为落地失败）由协调会话亲自跑 | unverified |
| ★9 验收与回滚 | 必红：`electron/productionRun/landFirstMultiShot.test.ts`（4）、`landFirstSingleShot.test.ts`（4）、`landFirstOneAdmission.test.ts`（4 + 类型断言）、`src/workbench/capability/productionOutcomeOnDeletedNode.test.ts`（15 红 + 3 对照绿）、`scripts/check-generation-entrances.node-test.mjs`（新增 4）。实现后做「改回旧行为必红」。独立验收：Codex 另一条线。回滚：revert 实现提交。 | `## 独立验收` 待派 |

## 方向检查

- **一句话根因**：「这一镜在不在画布上」由 Run 账本和画布节点各存一份，花钱口只看账本（认领、授权、同意窗口），从不要求账本里有节点——于是落地成了「尽力而为的旁路」，每多一个开拍时机（单镜 / 无界面 / 恢复）就多一个先花钱后找地方放的口子。
- **类**：乙（双份真相）+ 丙（结局到了容器不在），见 10-07 复盘。铁律 ⑫「点了 = 以为的」：用户点确认以为在画布上生成，实际可能只在账本里生成。
- **不改结构会冒出什么**：① 新开拍时机（例如 ACP 外部 Agent 第一步）照抄 `submission.start` 又漏落地；② 无界面 MCP 生成的结果永远不在画布上（今天已是，见上表）；③ 结局回填再长一条「节点不在就跳过」的分支。
- **选项**：补（给每个开拍口各加一句 await 落地）→ 否，门数不减、新口子照漏；**换（本设计）**→ 是：准入 token 让「不落地就派」编译不过 + 提交出口复核；重写（把节点身份并进 Run，画布只读投影）→ 太大，属「分镜 / 画布同一份镜头」后续。
- **用户要权衡的核心**：落不下画布时宁可不花钱、让用户再点一次，也不先花钱再找地方放。

## 待裁决（发协调会话）

见交付消息 Q1–Q4（无界面 MCP、没有节点时失败在哪看见 / 重试按钮在哪、文稿来源计划确认即落、接入认证试跑是否同一例外）。
