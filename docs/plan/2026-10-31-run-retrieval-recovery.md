# 设计卡：钱花了、任务号还在的单子只取回

改动名：单镜 Run 的取回恢复（B4 / T1 / T10）　线：实现线本线，独立验收由协调派　类别：[花钱][可打断]
方向检查：`docs/engineering/direction-checks/2026-10-31-run-recovery-materialize.md`（用户 2026-10-31「都按推荐」）。

**一句话**：供应商已经收下、钱已经花了的单，只要任务号还在，就只该取回，不该判死、不该卡死、不该再下单。

## 三个问题

- **B4（既有，真多扣钱）**：关窗或重启后，观察者第一次查询抛错，记成 `single_shot_observation_failed`。此后点「重新取回」GET 0 次直接失败，错误卡主按钮是重试，点了 POST=2，文案写死中文。
- **T10（#1393 引入）**：落地崩在 `artifact.add` 之后、`job.status=ready` 之前，下一次 materialize 只把信封标成 materialized，job 永远 `provider_accepted`，这个节点一直被锁着。
- **T1（#1393 引入）**：`withLifecycle` 对「忙」无限 10ms 重试；`.lifecycle-lock` 空文件或损坏被当成忙，永远没人回收，查询永远不返回。

| 格 | 结论 | 证据 |
|---|---|---|
| ★0 先查别人 | ① [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile) · 持有者定期刷 mtime，超过 `stale` 判过期 · **T1 坏记录按 mtime 回收**。② [Temporal 活动失败检测](https://docs.temporal.io/encyclopedia/detecting-activity-failures) · 服务端发现不了 Worker 崩溃，靠超时到期加重试 · **T1 用总期限，到期交上层，不无限等**。③ [Stripe 幂等请求](https://docs.stripe.com/api/idempotent_requests) · 连接错误后同一幂等键重发不建第二个对象，GET 天然幂等 · **B4：连接失败不是再下单的理由；画布传输 `submitIdempotency: false`，唯一安全的重试是 GET**。④ 仓内 `electron/productionRun/multiShotBatchScheduler.ts` 的 `observeUnitOnce` · 瞬时错 pending、确定性错 settled，`job.retry_retrieval` 只查不交 · **单镜收到同一判据 `jobAwaitsRetrieval`，不另立一套** | 链接 + `文件` |
| ★1 用户怎么用 | 当我生成视频时关了窗或重启了，回来想拿到花了钱的那一镜，不想再扣一次。步骤：提交 → 关窗 → 供应商或网络出故障 → 重开 → 节点是「可找回」 → 点「重新取回」→ 落地。不做什么：不加主进程闸（见「两处偏离」）；不改批次路；不做批量写。已知坑：第一次查询失败就停成待取回，重开项目不自动再查，要点一下。真实任务：①关窗后断网再重开；②重启后供应商查询 5xx；③老项目里已经落下错误卡的节点。量具：矩阵的 POST 数、GET 数、主按钮 | `electron/capabilityCore/runRetrievalRecovery.e2e.test.ts` |
| ★1b 连带界面 | 节点错误卡：主按钮「去重新取回 / Retrieve again」。可找回面板：「重新取回」。任务面板（制作 Run）：`retry-retrieval` 现在单镜也能用。Agent 回执：不改。分镜表悬停提示：读同一份键 | `NodeErrorReport.retrievalSource.test.tsx`、矩阵 |
| ★2 谁说了算 | 「这笔是不是只差取回」只归 `electron/shared/productionShotPhase.ts` 的 `jobAwaitsRetrieval`。写「待取回」只归 `singleShotRunLifecycle.ts`（`markSingleShotAttention`、`reopenSingleShotRetrieval`）。产物到 job 的收尾只归 `productionGenerationSubmission.ts` 的 `settleWithArtifact`。消费者：`pollRun`、服务 `job.retry_retrieval`、任务面板、节点投影。同一份事实一份 | `node scripts/door-map.mjs jobAwaitsRetrieval` |
| ★3 一致与复用 | 判据复用 `jobAwaitsRetrieval`；重开沿用批次路同一条 `needs_attention → polling` 边；错误卡复用 `canvasRetrievable`、`retrieval-incomplete`，不加新码、新按钮；旧数据解码复用 `matchNomiErrorCode` 已有的整句解码位。不自写通用能力 | `git grep jobAwaitsRetrieval` |
| ★4 全状态 | 空：不适用（只改失败路径）。加载：「正在拉取结果」。成功：落地、Run 完成、标记删除。失败：取回失败回到可找回，再点再查；供应商明确失败给重试。部分成功：不适用（单镜一份产物）。取消中：已取消的 Run 不写待取回，已交出去的出片照样落地。过期：供应商任务过期，查询失败，留在可找回，「标记失败」后可重试。能力不可用：供应商没有查询接口，走无任务号路径，给重试 | 矩阵 |
| 5 中途表 | 见下表 | 矩阵、`productionGenerationLifecycle.test.ts` |
| 6 外部数据与失败 | 供应商查询：断连、5xx → 待取回，界面按 `retrieval-incomplete` 说，不说「已经生成」。认不出的状态 → 待取回，再查可能认得。说失败 → 确定性失败，给重试。提交 4xx、连接断开 → 行为不变。不把供应商原文写进账本（固定消息） | 矩阵的 `failure` 维 |
| ★7 性能 | 不适用：只改失败路径，不新增操作。T1 的期限只影响锁被占用时的等待，无竞争时走第一次 `acquire`，没有多余等待 | `perf-scenario：不适用` |
| 8 真实条件 | 英文界面：错误卡中英都截。真付费：脚本备好，待协调跑。Windows、最小窗口、真规模、干净安装、键盘全程：`unverified`，本改动只动主进程状态和一处文案 | `docs/evidence/2026-10-31-run-retrieval-recovery/` |
| 拍板图清单 | 不适用：不改界面元素和布局，只换主按钮归属和一句文案 | |
| ★9 验收与回滚 | 下面清单逐条核；回滚：还原这个 PR，旧数据不用迁（`output_retrieval_failed` 老版本已认得） | 下表 |

## 中途表（★5）

| 状态 | 停 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 已受理、在轮询 | 交给观察者 · 不扣 · 节点空闲 | 观察者接手 · 不扣 · Run | 查询失败，待取回 · 不扣 · Run | `recoverOrphans` 接手 · 不扣 · Run | 第二次查询并进来 · 不扣 |
| 待取回 | 没有在跑的 · 不扣 | 仍是待取回 · 不扣 | 点了回到待取回 · 不扣 | 仍是待取回 · 不扣 | 第一次放回轮询，第二次当在查 · 不扣 |
| 重新取回中 | 交给观察者 · 不扣 | 观察者接手 · 不扣 | 回到待取回 · 不扣 | 轮询态，`recoverOrphans` 接手 · 不扣 | 撞锁算在跑 · 不扣 |
| 落地中途 | 不影响落地 · 不扣 | 下一次查补齐 · 不扣 | 产物已在本机，不用网 · 不扣 | 下一次查补齐 · 不扣 | 先到先写，后到读结果 · 不扣 |

## 两处偏离协调方向

1. **消息码按知道多少选**：`job.errorCode` 一律 `output_retrieval_failed`（判据只认它），但消息码在供应商说过成功时才用 `output-retrieval-failed`，否则用 `retrieval-query`。理由：`narrate.ts` 写明用户 10-22 拍板不能在不知道时说「已经生成」。两者主按钮相同。
2. **不加主进程闸**（`blockingReason` 不加「待取回」）。理由：会挡住现有的明确入口（↑ 经确认后重新生成）；被挡时新记录没有任务号，错误卡回不到可找回面板；还要新增「放弃取回」IPC。主按钮再也不下新单，真想重下走 ↑（经确认）或「标记失败」再重试。限制明写：可找回节点上 ↑ 仍能下新单，这是用户明确操作。

## ★9 验收清单

1. 关窗后取回失败一次：故障好了点重新取回，GET ≥ 1，落地，POST 仍 1。
2. 重启（新 Run 宿主 `recoverOrphans`）后取回失败一次：同上。
3. 取回失败后点错误卡主按钮：POST 仍 1。
4. 没有任务号、供应商明确拒绝：行为不变，有测试钉住。
5. T10、T1 的复现转绿；再试清单外的崩溃点（add 之前崩、job 之后 complete 之前崩、complete 之后崩）。
6. 错误卡中英两轨真窗亲眼看，截图进 `docs/evidence/2026-10-31-run-retrieval-recovery/`，不带真实素材。
7. 类检查：矩阵测试，从 `tests/fixtures/run-retrieval-recovery-cases.json` 遍历「失败时机 × 有无任务号 × 窗口开关 / 重启」，每格判 POST 数、GET 数、主按钮。账本 `classCheck` 指它。
8. 反例：放回判死 → 矩阵红；拿掉 T10、T1 的修复 → 对应测试红。按字节还原，写清红了几格。
9. 零费用走查（环回假供应商）：关窗 → 取回失败 → 重开 → 重新取回落地。
10. 试跑写记录时撞上损坏或被占着的租约：调用能返回，不挂死（`recordResult` 自 #1397 起持锁等 `withLifecycle`）。

**反例（做到了算错）**：错误卡主按钮给「重试」而任务号还在；点重新取回 GET 仍是 0；为变绿改断言或预算；把 T1 的残留有效租约上限改掉。

### 功能分类
- [x] 花钱
- [x] 长跑 / 可打断
- [ ] 新界面 / 改交互
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能
