# 设计卡：同步供应商「答了、本机落地失败」不再记成「结果未知」

```
改动名：提交出口补一档确定结局「供应商答了、Nomi 本机把结果落地失败」   线/负责人：I-sync-landing   类别：[花钱][长跑]
```

方向检查：`docs/engineering/direction-checks/2026-10-28-sync-landing-not-unknown.md`（热点 + 第三个确定结局，推荐「补 + 删」）。

## 问题（实查，根因见方向检查与协调交接区的 L-pb07-trace 报告）

0.24 起画布节点 ↑、批量卡、Agent 付费卡交给画布的镜，都经制作提交出口（`submissionOutbox`）。同步供应商（创建请求的回答就是结果）的结果在 `adapter.submit` 里就落地（`runTask` → `localizeTaskAsset`）；回答 200 之后落地失败（字节读不出、下载 403 / 签名过期、取片被拦、类型不符、写盘错），出口兜底记成 `submission_unknown`：卡上说「Nomi 没拿到服务商的回复」，这一镜被锁（`needs_reconcile`），叫用户去服务商后台核对。0.23.2 同样的事说「生成的文件没能读出来」、可以再点。

### 功能分类
- [ ] 新界面 / 改交互
- [x] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

## 9 格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在画布上点 ↑（或在 Agent 付费卡上点生成）、同步供应商回了结果但 Nomi 没能把它落进项目时，我想看到真原因（读不出 / 没取回 / 被拦），这一镜不被锁，以便我决定要不要再点一次（再点会再生成、再花一次）。步骤：选同步模型 → 点 ↑ → 供应商 200 → 落地失败 → 卡上真原因 → 再点 ↑ → 新的一笔。**不做**：同步结果的「重新取回」（结果地址只在那一次回答里，没有任务号可查）；不碰另外三扇同步落地门（同步 TTS、自定义调用 saveFile、CLI 写盘，登记残余）。真实任务：① Seedream 一类同步图片供应商回了读不出的字节（09-29 Seedream 5.0 事故形状）；② 用户自接的 OpenAI 兼容中转出图，结果地址签名过期 403；③ 开着 fake-IP 代理的用户，同步出图的取片被出网策略拦。主指标：同步落地失败被记成「结果未知 / 锁卡」的比例 = 0（量具：`appIntegrationCanvasShot.test.ts` 与类测试 `resultLandingOutcome.test.ts`、pb07 ②）；护栏：没有落地正证据的失败被放行成确定结局的比例 = 0（量具：同两份测试的反例格）；基线：修前 100%（pb07 ② 10-28 红） | 测试路径；pb07 走查 |
| ★1b 连带界面 | 画布节点错误卡（读不出 → 「生成的文件没能读出来」+ 重试、不弹切家提示；下载失败 → 「任务已提交，这次没能取回结果」；取片被拦 → 出网策略那一句）；Agent 付费卡那一镜（交接写回「交到了」，不再「先去核对」、直接生成档的出价不退回）；任务中心（这类画布 Run 已收尾，不进「要你处理」）。文案全部是现有词条，不新增 | `classifyError` 单测；pb07 截图 |
| ★2 谁说了算 | 「这次付费提交供应商答没答、答了什么」唯一 owner = `electron/outboundDispatchEvidence.ts`（概念 `production.submission-dispatch-evidence`），新增读口 `answeredSubmissionFailure` 与写口 `withResultLandingEvidence`（只给落地门用）；落盘唯一 owner = `submissionOutbox.submitOnce`（概念 `production.submission-admission`）；正证据唯一产生处 = `electron/assets/localizeTaskAsset.ts`（door-map 证明只有一扇门）；「这一镜结束在供应商答复之后」的判据 = `electron/shared/productionShotJobs.ts`，交接写回只读它。同一份事实一份：job 结局记在 Run 里，信封不另记；不靠「东西不见了」猜意图 | `node scripts/door-map.mjs <符号>` |
| ★3 一致与复用 | 结局状态 / 码 / 预留处理复用引擎 B 的取回失败（`needs_attention` + `output_retrieval_failed`、预留不动）；挂码复用异步取回的同一个函数 `retrievalStageError`（搬到 `electron/tasks/retrievalStageError.ts`，不依赖运行时），「哪些码只在提交前成立」复用现成的穷举表 `NOMI_ERROR_ONLY_BEFORE_SUBMIT`（答后码集合 = 它的补集，不另写第二张表；新码不答这一问 typecheck 就红）；删掉 `taskResultQuery.ts` 里只为落地错误挂码的那层包装 | `git grep retrievalStageError`；`check:self-written` |
| ★4 全状态 | 成功：不变。失败（答了、落地失败）：节点「失败」+ 真原因，不锁，可再点。失败（明确拒绝 / 没发出去）：不变。结果未知（写出去后断 / 超时 / 5xx / 名单外 4xx）：不变，仍锁、仍指去核对。取消中 / 过期 / 能力不可用：不碰。文案不谈钱（沿用现有词条） | 单测；`check:i18n` |
| 5 中途表 | 落地失败那一刻关窗：结局已在派发返回前落盘（job = needs_attention），重开项目不锁、不交观察者（没有任务号）；重启：同上（`recoverOrphans` 只交「生成中」的）；断网：落地失败本身可能就是断网，结局同上；连点：同一节点第二次点派发新的一笔（新 Run），供应商收第二次 = 用户第二次点；同一运行记录号重放 → 照 Run 账本回失败，不再交 | `appIntegrationCanvasShot.test.ts` 重启 / 重放格 |
| 6 外部数据与失败 | 外部：同步供应商的创建回答（结果地址 / data URL / 字节）、结果 CDN（403 / 过期 / 被代理改写到私网）。偏差：回答可能是坏字节或网页冒充。失败时用户看到真原因（读不出 / 没取回 / 被拦），不甩给用户的 key、不说服务商失败 | 现有 `generatedMediaDecode` 判据 |
| ★7 性能 | 不适用：不新增交互，失败分类只多一次 cause 链遍历（≤5 层），不在任何热路径上 | — |
| 8 真实条件 | 零花费：pb07 中英两轨真窗口（本机回环同步供应商）；Windows / 最小窗口 / 键盘全程：unverified（本线在 macOS 跑）；真付费：协调在本分支构建上跑成功路径样本（复用现有付费走查，协调点名的 `tests/ux/canvas-image-reference.paid.mjs`），失败路径真付费不跑（要真供应商回坏字节，造不出来） | 截图路径（实现线亲眼看过） |
| ★9 验收与回滚 | 见下方验收清单（动手前写全）；回滚 = revert 修复提交（文档提交可留） | `## 独立验收`：待补 V-sync-landing |

## ★9 验收清单（动手前写全；验收线只核这份）

门：画布单节点 ↑、批量卡轮到的那一镜、Agent 付费卡交给画布的那一镜，三条都进 `appIntegrationCanvasShot.dispatch` → `submission.start` → `submissionOutbox.submitOnce`；同步结果只在 `localizeTaskAsset` 落地（mapping 同步出图、无映射兜底、自定义调用返回的地址）。

| # | 检查 | 期望 | 怎么验 |
|---|---|---|---|
| A1 | 单节点 ↑，供应商 200，落地门里字节解码失败（`decode_failed`） | job `needs_attention` + `output_retrieval_failed`、无 `providerTaskId`；抛给渲染层的是落地错误本身，第一个码 `output-unreadable`（不是 `submission-unknown`）；预留仍 `reserved`（不是 `unsettled` / `released`）；信封不是 `submitted_unknown`；画布 Run 已收尾（没收尾标记清空） | `appIntegrationCanvasShot.test.ts` |
| A2 | 同一节点再点 ↑ | 派发新的一笔（供应商收到第 2 次），成功落地 | 同上 |
| A3 | 200 之后结果下载 403（hardenedFetch 的真错误） | 同 A1 的结局；第一个码 `retrieval-download` | 同上 |
| A4 | 类型不符（图片冒充视频，`task_kind_mismatch`） | 同 A1；第一个码 `retrieval-download` | 同上 |
| A5 | 取片被出网策略拦（`outbound-blocked`） | 同 A1；第一个码 `outbound-blocked` | 同上 |
| A6 | 写盘失败（无码的 `EACCES`） | 同 A1；第一个码 `retrieval-download` | 类测试 |
| A7 | Agent 付费卡交给画布的那一镜落地失败 | 交接写回 `accepted`（不是 `unknown`）；出价那一镜是「已交」；直接生成档的出价不退回 | `appIntegrationCanvasShot.test.ts` 交接格 |
| A8 | 批量卡轮到的那一镜落地失败 | 同 A1；下一张卡可以再生成它 | 同上 |
| A9 | 类：全部 `NomiErrorCode` 逐个从真落地门抛出 | 出口结局一律 `result_landing_failed`；渲染层读到的第一个码不在 `NOMI_ERROR_ONLY_BEFORE_SUBMIT` 里（提交前那几个改挂 `retrieval-download`） | `resultLandingOutcome.test.ts` |
| A10 | 渲染层读 A1 / A3 / A5 的错误 | `output-unreadable`（不点名服务商、不弹切家提示、主动作重试）/ `retrieval-incomplete` / `outbound-blocked` | `classifyError` 单测 |
| A11 | pb07 走查中英两轨 | ② 卡上「生成的文件没能读出来」、不弹切家提示；③ 再点 ↑ 能派发并落地成功；④ 夹具改 404 后通过 | `node tests/ux/full-walk/run.mjs --only pb07-failure-kinds`，截图亲眼看 |
| A12 | 异步取回路不变 | 无查询步任务的下载失败、`readResult` 落地失败照旧带取回阶段码；有任务号的画布节点照旧落「可找回」 | `retrievalStagePhase.test.ts`、`localizeTaskAsset.test.ts` |
| A13 | 正证据只有一个产生处 | `door-map` 数证据写口 = 1 扇（`localizeTaskAsset.ts`） | `node scripts/door-map.mjs withResultLandingEvidence` |

反例（改完必须仍是原样）：

| # | 反例 | 期望 |
|---|---|---|
| X1 | 请求写出去之后连接被重置（`socket hang up` / `ECONNRESET`），没有落地证据 | `submission_unknown` + `SubmissionReceiptUnknownError` + 锁（`production_shot_claimed: needs_reconcile`）+ 预留 `unsettled` + 不重发 |
| X2 | 响应头 / 体超时 | 同 X1 |
| X3 | 供应商回 5xx（带 `providerAnswer`） | 同 X1 |
| X4 | 供应商回 418（及 408 / 409 / 410 / 413 / 425 / 451） | 同 X1 |
| X5 | 明确拒绝名单（400 / 401 / 402 / 403 / 404 / 422 / 429，无任务号） | `provider_rejected`，预留 provider-safe 释放，节点可再点 |
| X6 | 没发出去（本机拦下 / 连上之前失败） | `provider_not_reached`，预留释放 |
| X7 | 异步轮询 / 物化路径（引擎 B 取回失败 park） | 不变：有任务号的 `output_retrieval_failed` 仍是「待取回」 |
| X8 | 不自动重发：落地失败即使碰上「声明幂等 + 连接层字样」也不重发 | 供应商只收到 1 次 |
| X9 | 非 app-fetch 传输：落地证据 + cause 链深处有取片的连接失败 | 不判「没发出去」（不释放、不重发） |
| X10 | 错误正文里只是**带着** `NOMI_ERR::output-unreadable::` 字样、不是落地门挂的证据 | 仍是结果未知（证据不从文字推） |
| X11 | 前一次尝试可能已到达（`anyAttemptMayHaveReached`）、后一次落地失败 | 结果未知（最不确定的那次说了算） |

这一类会从哪里回来：入口（三条都在门表里，已覆盖）；形状（解码 / 下载 / 拦截 / 类型 / 写盘，类测试逐码覆盖）；边界（另外三扇同步落地门：同步 TTS `importLocalFile`、自定义调用脚本 `saveFile`、CLI 进程写盘——本刀不覆盖，登记 `residual_risks`）；版本（修前已经被锁成 `submission_unknown` 的旧 Run 不迁移，照旧走「我核对过了，重新生成」释放）。

花钱走查：零花费演练 = pb07（本机回环同步供应商）；成功路径真付费样本由协调在本分支构建上跑一次（复用现有付费走查，不新写）；失败路径不花钱跑（造不出真供应商回坏字节）。
