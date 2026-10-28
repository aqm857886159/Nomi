# 方向检查：同步供应商「答了、本机落地失败」不是「结果未知」（2026-10-28）

触发（`node scripts/fix-churn.mjs` 当日实数）：
- 文件级：`electron/productionRun/productionGenerationSubmission.ts` 近 14 天 7 个 fix，这一刀是第 8 个；`electron/tasks/taskResultQuery.ts` 8 个，第 9 个；`electron/assets/localizeTaskAsset.ts` 4 个，第 5 个。
- 概念级：「异步生成结果取回（上游状态词、结果地址、取回阶段）」近 14 天 24 个 fix，这一刀是第 25 个。
- 人工判：提交出口的确定结局要从两种（没发出去 / 当场拒绝）加到三种——「第三个特例分支」那一条。

改法是**补一档结局 + 删重复**：证据 owner 补上第四档（第三种确定结局），出口的确定结局改成一个封闭类型逐个落（不是再往 if 链上挂一支）；`taskResultQuery.ts` 里只给落地错误挂码的那层包装删掉（落地门自己挂，同一个函数）。不加供应商 / 模型 / 画布专用分支，不留开关、不留回退。

来源：协调会话 10-28 的 pb07 走查（② 红），只读线 L-pb07-trace 追到根因（协调交接区的 L-pb07-trace 报告，这里不重推，只核本刀要改的几处）。用户 10-28 拍板：0.24.0 发版前修。

## 0. 一句话根因

提交出口按「有没有证据证明供应商答过」给付费提交的失败定性，可它只认得供应商答「不」（明确拒绝）这一种答复；「供应商答了、结果已经在回答里，Nomi 把它落进本机失败」没有结局，于是同步供应商（创建请求的回答就是结果、在提交里落地）的一切落地失败都掉进兜底的「结果未知」。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| pb07 ②（10-28）：同步出图回 200，字节解码失败 → 卡上「Nomi 没拿到服务商的回复」、这一镜被锁（`needs_reconcile`），叫用户去服务商后台核对 | `submissionOutbox.ts` 外层 catch：不是没发出去、不是明确拒绝 → `markSubmissionUnknown` + `SubmissionReceiptUnknownError`，它把 `submission-unknown` 码加在 `output-unreadable` 前面，渲染层读第一个码 | 出口的结局集里没有「答了、本机落地失败」 |
| 同类：同步供应商的结果下载 403 / 签名过期、取片被出网策略拦、类型不符、写盘失败 | 同一个 catch（`localizeTaskAsset` 里抛出来的都走这里） | 同上 |
| 同类：Agent 付费卡交给画布的那几镜 | 同一个 dispatch；交接写回只有「受理前结束 = 没发出去 / 其余 = 结果未知」两档，于是写成 unknown → 卡上「先去核对」、直接生成档的出价退回给人 | 同上，外加交接写回不认「答了」 |
| 潜伏：执行器没声明 `networkTransport: "app-fetch"` 时，取结果那一下的连接失败在 cause 链里会被当成「提交没写出去」（释放预留 + 可能自动重发） | `observeSubmissionHandoffs` 的 cause 链判据不分是哪一次请求的连接失败 | 证据没分「提交」和「取结果」 |

## 2. 为什么这一类会一直出现

出口的结局判据是在引擎 B（异步）的形状下长出来的：受理 = 拿到任务号；结果在受理**之后**的 `materialize` 里落地，落不了就 `park` 成 `needs_attention` + `output_retrieval_failed`（`productionGenerationSubmission.ts` materialize 段、`generationOutputMaterializer.ts`）。0.24 的 #996 把画布同步流量接进同一个出口：同步供应商把「受理」「出结果」「落地」压进同一次 `adapter.submit`（`runTask` 只在文件落盘后才返回），出口看不见「受理」那一刻，只能在「一个字节没出门 / 当场拒绝 / 未知」三档里挑，落地失败哪档都不沾，掉进未知。每多一种同步落地失败（解码、下载、拦截、类型、写盘）就再冒一次；用户感知是「我的卡被锁了，还要我去后台查一个服务商没犯的错」。

缺的是两层：(a) 一个**只在结果落地门产生**的正证据（不是从「没有别的证据」推出来的）；(b) 出口的确定结局是一个封闭类型，加结局时编译器逼着每一处表态，而不是 if 链兜底。

| 铁律 | 结论 | 最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | 不适用：不碰意图 → 草稿参数 | — |
| ⑪ 能选到 | 不适用：不碰模型档案 / 入口可选项 | — |
| ⑫ 点了=以为的 | 适用：用户点 ↑，以为「这次失败了，看原因、可以再点」；修前实际是被锁 + 说「没拿到回复」。修后卡上说真原因、同一节点再点会派一笔新的 | pb07 ② 中英两轨走查 + `appIntegrationCanvasShot.test.ts`「第二次点击派发新的一笔」 |

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一种同步落地失败（新的解码判据、新的取片拦截、磁盘权限）照样锁卡、照样说「没拿到回复」 | 类测试：全部 `NomiErrorCode` 逐个从真落地门抛出，出口结局都是 `result_landing_failed`、渲染层读到的第一个码都是答后的码（`electron/productionRun/resultLandingOutcome.test.ts`） |
| 有人为某家同步供应商在画布那头加「解码失败就别锁」的特例，Agent 付费卡、别的同步入口照旧锁 | 修在证据 owner + 出口；画布、交接两头都只读 Run 里的 job 结局（`appIntegrationCanvasShot.test.ts` 单节点 / 批量 / 交接三组） |
| 另外三扇同步落地门（同步 TTS 的 `importLocalFile`、自定义调用脚本的 `saveFile`、CLI 进程写盘）本刀不挂证据，落地失败仍按未知锁 | `node scripts/door-map.mjs importLocalFile` 等；登记进根因合同 `residual_risks`，交协调定是否另派 |

## 4. 靶子独立性检查

- 尺子一：pb07 走查（09-29～10-01 写的，早于 #996，不是本线写的；当时 ①–④ 全绿）。
- 尺子二：单测走真仓库、真 Run 服务、真提交出口、真落地门（`localizeTaskAsset` 真跑，只把它下面的 `importRemoteAsset` 换成按剧本抛错），不读被测函数实现。反例变异（落地门不挂证据 / 出口仍走兜底）必须让对应格变红，实现线报告里给红绿。
- **靶子有错的一处**：pb07 ④ 用 HTTP 418 当「认不出类别的话」。418 不在明确拒绝名单里（`electron/providerExplicitRejection.test.ts` 钉着，F3 用户拍板：判错成拒绝的代价是重复扣钱），按设计就是「结果未知」，修完也是红的。先修靶子：夹具改成名单里、`classifyError` 又没有专门类别的 404（`categorizeVendorFailure` 对 404 给 `unknown`），注释写明为什么。只改测试，不扩名单。

## 5. P0：这些是我们独有的吗

「这次付费提交，供应商到底答没答、答了什么」是按镜头花钱语义的一部分，判据 owner 早已存在（`electron/outboundDispatchEvidence.ts`，概念 `production.submission-dispatch-evidence`）；没有现成库回答它。业界的 transactional outbox / 幂等键（Stripe Idempotency-Key 一类）只解决「重发会不会变成第二张单」，回答不了「回答已经到了、本机落不了地算哪一档」，而且我们接的供应商都不认幂等键（`submitIdempotency: false`）。所以不接新东西，只给现有 owner 补一档；挂码沿用现有的取回阶段出口（`retrievalStageError`，搬到不依赖运行时的模块里给落地门用），不写第二份。

## 6. 接入 / 补 / 重写 / 删 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 没有能回答「答了、本机落不了地」的标准 / 库（见 §5） | — | — | 否 |
| **补（本线）** | 证据 owner 加第四档：正证据只由结果落地门 `localizeTaskAsset` 挂（模块私有 Symbol，cause 链上读）；出口按封闭的确定结局逐个落：job `needs_attention` + `output_retrieval_failed`（与引擎 B 取回失败同一状态 / 码）、预留照旧 `reserved`（同引擎 B：答过了、可能已扣，不释放也不悬着）、信封不记 `submitted_unknown`、不重发；交接写回 `accepted`；落地门统一挂取回阶段码（与异步取回同一个函数），删掉 `taskResultQuery.ts` 里只给落地错误挂码的那层 | 约 7 个生产文件，每处几行 | 证据只在一扇门产生；同步 TTS / 自定义调用 saveFile / CLI 写盘三扇门本刀不覆盖（登记残余） | **是** |
| 重写（限一个模块） | 同步落地挪到 `provider_accepted` 之后、走引擎 B 的 materialize（`runTask` 只回结果地址，不在提交里落地） | 改 `runTask` 返回契约 + 画布结果交付链 + 可找回 | 发版前跨运行时 / 画布 / 可找回三处，风险大 | 发版后另议 |
| 删 | 删掉出口兜底「未知」 | 小 | 真的未知（写出去后断、超时、5xx）会被当确定，用户再点就是第二笔 | 否 |

与引擎 B 的两处差别（领域原因）：
1. job 上没有 `providerTaskId`：同步供应商没有可查的任务，结果地址只在那一次回答里。于是 `jobAwaitsRetrieval` 不成立，不给「重新取回」（按不动的按钮不给）；这一镜落「失败」，同一节点可以再点。
2. job 的 `errorMessage` 是落地错误自己的话（第一个码就是真原因：读不出 → `output-unreadable`），不像引擎 B 那样改挂 `output-retrieval-failed`：那句话的下一步是「去任务面板重新取回」，同步结果没有这一步。

信封：留在 `sealed`（与明确拒绝同样处理）。信封没有「答了但没有任务号」这一态，`submitted_unknown` 全仓没有读者；耐久的结局以 Run 里的 job 为准。

## 7. 用户要权衡的核心

同步供应商答了、Nomi 本机落不了地时，是「如实说读不出来 / 没取回、这一镜不锁、再点会再生成一次（再花一次）」，还是「锁住，让用户去服务商后台核对一个服务商没犯的错」；本线选前者（0.23.2 的行为），记账仍按「已答复、可能已扣」处理。

## 特征测试清单（动结构前先锁住）

- `electron/capabilityCore/appIntegrationCanvasShot.test.ts`：同步出图 200 后落地门抛 `decode_failed` → 改前 job = `submission_unknown`、错误第一个码 = `submission-unknown`、第二次点击被拒 `needs_reconcile`（改前红格的复现）；改后 job = `needs_attention` / `output_retrieval_failed`、第一个码 = `output-unreadable`、第二次点击派发新的一笔。
- 同文件反例（改前改后都绿）：写出去后 `socket hang up` → 仍 `submission_unknown` + 锁；明确拒绝 → 仍 `provider_rejected`、预留释放。
- `electron/productionRun/resultLandingOutcome.test.ts`（类测试）：真落地门 × 全部 `NomiErrorCode` → 结局都是 `result_landing_failed`、第一个码都不在 `NOMI_ERROR_ONLY_BEFORE_SUBMIT` 里；没有落地证据的超时 / 5xx / 418 / 连接重置 → 仍是未知。
- 结账挂的类检查：上面这份类测试 + `electron/productionRun/submissionNotDispatched.test.ts`（出口结局矩阵，原有）。
