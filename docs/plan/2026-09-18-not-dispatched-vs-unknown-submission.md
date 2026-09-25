# 「没写出去」与「结果未知」分成两档：付费提交的出站失败该怎么记

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：实施中（PR #810）· 2026-09-18

## 背后的真实摩擦（一句话）

用户点了报价卡、付了钱，四镜里有一镜因为一次**网络抖动**没发出去——Nomi 却告诉他
「供应商可能已经接受任务，请先去供应商核对，Nomi 不会自动重提」，同时另外几镜的钱已经花了、
任务还在飞，却再没有人去轮询它们，整个 Run 停在「运行中」一动不动。
他既拿不到片子，也不知道该去哪里对账。

## 范围

- `electron/outboundDispatchEvidence.ts`（新）：判定一次 `fetch()` 抛错属于「没写出去」还是「结果未知」。
- `electron/capabilityCore/apimartGenerationProvider.ts` / `apimartGenerationErrors.ts`：
  把 undici 的 cause 链摊平进消息并原样挂上 `cause`。
- `electron/productionRun/submissionOutbox.ts`：两条互斥出口（`markNotDispatched` / `markSubmissionUnknown`）。
- `electron/productionRun/productionRunState.ts`：`submitting → needs_attention` 成为合法转移。
- `electron/productionRun/productionGenerationSubmission.ts`：供应商异常进入提交层的唯一收口处分流。
- `electron/productionRun/multiShotBatchScheduler.ts`：一镜派发失败不带走整批。
- 走查侧仪器三条（让下一次同类红自己说出原因）。

## 不动项

- **「结果未知」这一档的行为一个字不改**：仍然挂 `unsettled`、仍然不自动重提、仍然要人去供应商核对。
- 不碰意图日志的状态机（`prepared → committed | aborted` 的禁令保持原样）。
- 不碰预算授权链：调度器仍然只消费 gate 已授权的额度，不创建也不提高。
- 不改任何供应商档案、不新增依赖。
- 不给「重发」加可配置开关、不加指数退避、不加第二次重发——**只有一次**。

## 回滚

- 「自动重发一次」单独一条 commit（`b051b947c`）：撤掉它，其余三层仍然成立
  （不再误报 `submission_unknown`、不再一镜带走整批），只是抖动要人工重来。
- 整条 PR 回滚即回到今天的 main 行为；没有数据迁移、没有落盘格式变化，
  耐久 Run 里新增的只有 `needs_attention` + `errorCode: provider_not_reached` 这一种既有形状。

## 验收门

1. 阳性对照修前必红：`electron/productionRun/submissionNotDispatched.test.ts` 两条、
   `electron/productionRun/submissionOutbox.test.ts` 的两端，在 pristine `568b58272` 上实测红。
2. 本机 `pnpm run gates` 全量档全过；`mcp-l2-journeys` ×3 全绿（66 断言）。
3. CI `E2E Walkthroughs (Linux)` **连续 3 轮绿**（这条红是间歇的，一轮不算数）。
4. R21 `recurring` 合同 + 机器生成的门表通过 `check:root-cause-contracts`。

## 先查别人

凭记忆不算查；下面每条都实读过源码或文档。

1. **undici 自己就把 `UND_ERR_SOCKET` 归进「可重试」** —— `node_modules/undici/lib/handler/retry-handler.js:52`
   （本仓装的是 undici 6.19.8）默认 `errorCodes` 列表是
   `ECONNRESET / ECONNREFUSED / ENOTFOUND / ENETDOWN / ENETUNREACH / EHOSTDOWN / EHOSTUNREACH / EPIPE / UND_ERR_SOCKET`。
   我们的判据与上游自己的分类**同一个集合**，不是我们发明的一套。
   同一处 `methods` 默认只含 `GET/HEAD/OPTIONS/PUT/DELETE/TRACE`——`POST` 不在内，
   所以 POST 的重发必须由**调用方**基于幂等键自己决定，这正是我们要在提交层做的事。

2. **`SocketError` 带的字节计数是整条连接累计的，不能当「这次请求写没写」的证据** —— `node_modules/undici/lib/core/errors.js:140` 配 `node_modules/undici/lib/core/util.js:454`
   （`SocketError` 把 socket 信息整包挂上；`getSocketInfo` 直接取 Node socket 的累计
   `bytesWritten` / `bytesRead`）。第一版判据要求两者为 0，被 PR #810 第一轮 CI 当场证伪：
   keep-alive 复用的连接上一次请求早写过字节。

3. **Stripe：网络层错误正是幂等键存在的理由，处置是「用同一个幂等键、同一组参数重试」** —— https://docs.stripe.com/error-low-level
   （“Network errors” 与 “Idempotency” 两节，2026-09-18 读）。原文点明客户端此时不知道服务端
   收到没有，要用同一个幂等键重试到拿出确定结果，且第一次重试应当很快、之后才退避。
   我们的形态更保守：只重发一次，且只在**能证明没写出去**时。

4. **AWS SDK：I/O 失败（连接重置、DNS 解析失败、socket 超时）归 transient，自动重试** —— https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html
   （“Error classification” 表，2026-09-18 读）：transient 用 50ms 基准退避重试，非重试类才直接返回。
   业界对「连接层失败」的默认判断是可重试，不是「可能已扣费」。

5. **一镜失败不带走整批，生态近邻是 `p-map` 的 `stopOnError`** —— https://github.com/sindresorhus/p-map
   （2026-09-18 读）：默认 `true` 时「第一个 mapper 拒绝就直接抛回调用方」，`false` 时等所有
   promise 落定再用 `AggregateError` 汇总。我们此前是前者，而批次里每一镜都**已经花过钱**，
   掐掉兄弟镜观察的代价与纯计算批次完全不同；所以取后者的形状：失败记下来、继续跑、最后如实报状态。

6. **仓内近邻：同一份文件的轮询路早就这么做了** —— `electron/productionRun/multiShotBatchScheduler.ts:124`
   （`observeUnitOnce` 的注释原文：一次抖动被吞成 `pending` 并记 warn，理由是「不许一条抖动
   杀死兄弟镜的长观察」）。派发路缺的就是同一条防线——不是新设计，是把同一份文件里已有的判断补齐。

7. **Node `http.Server` 的 keep-alive 超时是这次竞态窗口的来源** —— https://nodejs.org/api/http.html#serverkeepalivetimeout
   实测值由夹具自己报出来：CI run 35322059157 的连接账本打印 `keepAliveTimeout=5000ms`，
   并记录服务端在 `08:06:56.856` / `08:06:59.281` 干净关闭（`hadError=false`）两条空闲连接。
   C9 那段 4–7 秒空窗稳定跨过它——不是推测，是服务端那一侧的记录。

8. **HTTP/1.1 对这一幕有规范级答案** —— https://www.rfc-editor.org/rfc/rfc9112#section-9.6
   （连接关闭与重试，2026-09-18 读）：对端在没有给出响应的情况下关闭连接时，请求未被处理，
   客户端可在新连接上重试。我们的判据落在这条规范上，而不是「看着像」。

## 取舍点（用户要权衡的那一个）

**能证明「一个字节都没写出去」时，要不要自动重发一次？**

- 不重发：绝不可能重复扣费，但一次网络抖动就把一镜变成「请去供应商核对」的人工单子，
  而用户刚刚才为这一笔点过确认。
- 重发一次：抖动自愈，代价是理论上仍存在「供应商收下后才关连接、且一个响应字节都没发」
  这一种情形会到达供应商；幂等键逐字不变、供应商档案声明 `submitIdempotency`，会被对面去重。

2026-09-18 拍板取后者，并把它单独成一条 commit，以便随时只撤这一条。
