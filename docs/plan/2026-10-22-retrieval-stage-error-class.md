# 设计卡：取回阶段不再说「还没发出去 / 可以重试」（⑬ retrievalStageError 同类口子）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：取回阶段的错误码只说取回阶段的话   线/负责人：F-poll-reupload（⑬）   类别：[花钱][长跑]
```

来源：`docs/engineering/direction-checks/2026-10-22-poll-reupload.md` 2b 节（用户 10-22 拍板另开 PR 修）。热点：`electron/tasks/taskResultQuery.ts`（14 天第 4 个 fix，概念「异步生成结果取回」第 20 个），方向检查另写 `docs/engineering/direction-checks/2026-10-22-retrieval-stage-error-class.md`。

## 问题（实查，不是推测）

任务已经提交、钱已经花了之后，「查任务 / 取结果 / 下载」这一段报的错，有两处会说成「还没发出去、可以重试」：

1. **主进程出口放行提交前语义的码**：`retrievalStageError` 对已带码的错误原样放行，不分阶段。今天就有活的生产者——
   - 查询请求同样过 `vendorHttp.requestJson` 的出站守卫，被拦时一律挂 `outbound-blocked-submit`，人话是「这次生成**没有发出去**……然后重新生成」（`vendorOutboundGuard.authorizeSubmitDestination` 不知道这是查询）；
   - 同一个守卫的凭据绑定分支挂 `outbound-blocked-credential-origin`（「请求没离开本机、没有计费」那一族）；
   - 修 #1285 之前，查询前重传参考失败会挂 `asset-upload-failed`（「还没请求这次选的服务商」）。
   而 `VendorRequestError` 的 `structured.upstreamMsg` 就是那句拒绝人话，渲染层会把它当「服务商原话」印出来。
2. **渲染层不认取回阶段码**：`classifyGenerationError` 没有 `retrieval-*` 分支。实测：`retrieval-query` 归成 `unknown`，提示「可以重试一次，或换一个模型」，主动作 `retry`（= 再生成 = 再扣一次）。

## 验收清单（实现前写）

入口用 `node scripts/door-map.mjs` 数：`retrievalStageError` 1 扇（只在 `taskResultQuery.ts`，6 处调用）；`fetchTaskResult` 的调用者 20 处（画布轮询 / 重新取回、MCP read_task、Agent、制作 Run 对账、试模型、认证、主进程 IPC）。所有调用者都经 `fetchTaskResult` 这一个出口，所以主进程侧修在出口；渲染侧修在唯一分类器。

| # | 入口 / 界面 | 今天的样子（实查） | 要过的检查 | 怎么验 |
|---|---|---|---|---|
| C1 | 主进程出口 `fetchTaskResult`（全部 20 个调用者共用） | 已带码一律放行；无 query 分支的下载 `localizeTaskAsset` 抛错不经 `retrievalStageError` | 从 `fetchTaskResult` 抛出的任何错误，码都属于「提交之后」那一族（`retrieval-*` / `outbound-blocked` / `output-*` / `credential-redirect`）；提交前语义的码（`asset-*`、`outbound-blocked-submit`、`outbound-blocked-credential-origin`、`submission-*`、`model-config`）一律改挂对应阶段的 `retrieval-*`，原码标记从正文剥掉 | 特征测试：本机回环，查询被出站守卫拦（fake-ip）→ 抛出的码是 `retrieval-query`，正文不含「没有发出去 / 还没请求 / 重新生成」 |
| C2 | 同上，`VendorRequestError.structured.upstreamMsg` | 改挂时原样带着拒绝人话，渲染层当「服务商原话」印 | 改挂提交前语义码时，不把 Nomi 自己的拒绝人话当服务商原话带出去（真服务商的原话，如 503「无可用渠道」，照旧保留——#1213 要它） | 同一特征测试读 `structured.upstreamMsg`；另一条用例：真 503 的原话照旧在 |
| C3 | 码表本身 | 「哪个码属于哪个阶段」没有写在任何地方，`isRetrievalStageCode` 只认 `retrieval-*` + `outbound-blocked` | `nomiErrorCodes.ts` 给每个码登记阶段（穷举 `Record<NomiErrorCode, …>`，新增码不写阶段 typecheck 红）；C1 的放行判据只读这张表 | typecheck + 单测遍历全部码 |
| C4 | 渲染层分类器 `classifyGenerationError`（错误卡 / 分镜格 / Agent 面板的失败说明都读它） | `retrieval-query` → `unknown` + 「可以重试一次」+ 主动作 `retry` | 任何 `retrieval-*` 码：归到「已提交、取回没成」那一类，主动作不是 `retry`（不再生成），提示里不出现「没发到服务商 / 重试」；真服务商原话照旧显示 | 分类器单测：四个 `retrieval-*` 码 × 有 / 无服务商原话 |
| C5 | 画布轮询（`waitForCatalogTaskResult`）→ 可找回面板 | 查询失败落可找回 ✓；面板的「服务商原话」取自分类器（今天对 `outbound-blocked-submit` 给空，故可见区没印出来；技术详情里有原文） | 查询被出站守卫拦时，可找回面板不出现「这次生成没有发出去」 | 渲染层组件测试：用 C1 产出的真实错误串喂 `NodeRecoverableReport` |
| C6 | 「重新取回」（`recoverTaskActions`） | 查询报错 → 可找回 ✓（实测，写成守护测试）；查到之后只有服务商明说失败（status=failed）才进错误桶，`localizeRemoteResultUrl` 不抛错 | 已付费任务在「重新取回」里任何一步失败，节点都不进带「重试生成」主动作的状态 | `recoverTaskActions.projectIdentity.test.ts` 守护用例 |
| C7 | 画布首次生成（`waitForCatalogTaskResult` → `generationRunController`） | 查询失败无论带什么码都包成 `RecoverableTimeoutError` → 可找回 ✓（实测，写成守护测试）；之后只有服务商明说失败才进错误桶 | 查询持续报提交前的码 → 仍落可找回、只提交一次 | `catalogTaskActions.test.ts` 守护用例 |
| C8 | MCP `read_task`（外部 Agent） | 报错包成「不要重新提交」+ 原文 200 字；原文可能含「然后重新生成」 | 原文里不再出现提交前口径（随 C1 自然成立） | readTask 单测喂 C1 的错误 |
| C9 | 制作 Run 对账、试模型、认证 | 读 `fetchTaskResult` 报错只做「仍在处理 / 待对账」，不重新提交（已核 `productionRunService.reconcileProviderTask`、`tryModel.pollTaskToTerminal`） | 不变；随 C1 拿到的码更准 | 既有测试全绿 |
| C10 | 反例：提交阶段 | 提交时被拦照旧是 `outbound-blocked-submit`，「没发出去、可以重新生成」是**对的** | 提交阶段的码和口径一个字不变 | 既有 vendorHttp / 出站守卫测试全绿 + 新增一条对照用例 |

总判据（协调要求）：**已付费任务取结果失败时，任何界面的主动作都不能是会再扣一次的重试**——C4 / C6 / C7 三条是它在渲染层的全部落点，C1–C3 是它在主进程的落点。

## 协调已定（10-22）

协调回复「可以，按 A」：C4 新增一类「已提交、这次没取回」，中英各一条，主动作「去任务面板重新取回」，只说事实不谈钱；新状态要中英两轨真截图。C1 改挂时原码不丢，放进技术详情并标明「Nomi 自己拦下」；C2 Nomi 的拒绝话不当服务商原话。spend-paid-sample 不单独花钱，引用 #1285 成功路径样本，失败路径用本机假上游实测。

### 当时的选项

C4 需要分类器给 `retrieval-*` 一个归宿，两种做法：
- **A（推荐）新增一类「已提交、这次没取回」**：中英各一条 reason / hint，主动作「去任务面板重新取回」；文案只说事实（任务已提交、这次查询 / 下载没成、点重新取回只查不生成），不谈钱。代价：新文案一组，要过 `check:i18n` 和文案约束。
- **B 复用现有 `output-retrieval-failed`**：零新文案；但它的话是「已经生成，但结果没能取回」，查询这一步失败时其实不知道生成好了没有，说「已经生成」不准。

### 协调补充（10-22，推送前）

错误卡主按钮按任务来源分：画布任务「去重新取回 / Retrieve again」，点了回到可找回面板；制作 Run 保留「查看制作任务」（那是 Agent 制作任务的说法，放在画布任务上会误导）。中英截图重拍。

## 9 格（花钱 / 长跑）

| 格 | 结论 |
|---|---|
| ★1 用户怎么用 | 当我的视频已经提交、Nomi 查结果时被本机网络 / 代理拦住，我想看到「任务还在，修好后点重新取回」，而不是「这次没发出去，重新生成」。真实任务：① 开 Clash TUN fake-ip 生成视频，生成中途代理出问题；② 改了供应商地址没重存 key，查询被凭据绑定拦；③ #1285 修前的参考重传失败。主指标：取回阶段错误被说成「没发出去 / 可重试」的比例 = 0（量具：C1–C7 测试） |
| ★1b 连带界面 | 可找回面板的「服务商原话」、错误卡、分镜格悬停、Agent 面板失败说明、MCP read_task 的 message |
| ★2 谁说了算 | 「码属于哪个阶段」唯一 owner = `nomiErrorCodes.ts` 的阶段表；主进程出口 = `fetchTaskResult`；渲染出口 = `classifyGenerationError` |
| ★3 一致与复用 | 阶段表就是 `nomiErrorCodes.ts` 里的 `NOMI_ERROR_ONLY_BEFORE_SUBMIT`（码表旁边，同一个 owner）；`isRetrievalStageCode`（「可找回」去处）不变；新分类复用 `output-retrieval-failed` 的动作形状（view-task） |
| ★4 全状态 | 查询失败 / 读结果失败 / 下载失败 / 超时：都是可找回 + 重新取回；提交阶段失败：照旧 |
| 5 中途表 | 关窗重开：可找回节点照旧能重新取回（无状态重建）；断网：查询失败落可找回；连点重新取回：只查不提交 |
| 6 外部数据与失败 | 服务商真原话照旧保留；Nomi 自己的拒绝不冒充服务商原话 |
| ★7 性能 | 不适用：不新增操作 |
| 8 真实条件 | 本机回环 + 渲染组件测试 + 新状态中英两轨真截图；不改成功路径，`spend-paid-sample` 引用 #1285 那条真付费样本（协调跑完给链接），失败路径用本机假上游实测 |
| ★9 验收与回滚 | 上表 C1–C10 逐条；回滚 revert 本 PR |
