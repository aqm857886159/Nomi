# 失败卡只把有来源证据的话标成「服务商原话」（设计卡）

改动名：服务商原话只认有来源证据的话  线/负责人：I-vendor-quote-provenance  类别：[其他]（纯 bug 修复：不增删界面元素、不改文案）

> 复盘：`docs/engineering/direction-checks/2026-10-27-vendor-quote-provenance.md`（用户 10-27 拍板：照推荐修——只认有来源的原话，删 raw 回退）。根因合同：`docs/fixes/2026-10-27-vendor-quote-provenance.root-cause.json`（随实现提交）。

## 动手前实查：「来源合同已经有了」只对了一半

任务书的前提是「`vendorOriginatedText` 只认结构化载荷的 `upstreamMsg`，这就是来源合同」。实查：`upstreamMsg` 这个字段不是来源证据——主进程在**服务商根本没回话**时也把本机的话写进去，而且这些分支都不带 `httpStatus` / `logicalCode`：

| 通道 | 服务商没回话的分支（`upstreamMsg` 里装的是什么） |
|---|---|
| `electron/vendor/vendorHttp.ts`（画布生成、取回查询共用） | 连不上 :306/:352（`networkMessage(error)`：`fetch failed`、`ECONNRESET: read ECONNRESET`）、等响应超时 :306 / 读响应超时 :329（我们自己的中文句）、出站策略拒发 :242、跳转被拒 :296、请求头守卫 :185、响应超限 :341。`vendorHttp.test.ts:261-264` 已钉住 `upstreamMsg: "fetch failed"`。 |
| `electron/ai/runtimeVendorError.ts:61`（文本任务、Agent、pi 运行时） | `thrown` / `timeout` 时 `upstreamMsg = error.message`：`fetch failed: connect ECONNREFUSED …`、看门狗的中文句。 |
| `electron/tasks/taskResultQuery.ts:122`（取回阶段出口） | 原样带着上面那份 structured 重新抛。 |

探针（真生产者，只删 raw 回退之后）：裸串 6 种都不再标；vendorHttp 的 `fetch failed` / `ECONNRESET: read ECONNRESET`、Agent 的 `fetch failed: connect ECONNREFUSED 127.0.0.1:443`、pi 运行时的 `fetch failed` 与超时中文句，5 种**仍然**标成「服务商原话」。也就是说只删回退，画布生成主路上的这个问题照旧。

所以「有来源」要落到证据上：复盘推荐原文就是「只有**有来源证据的** `upstreamMsg` / 任务失败原话才能进 providerMessage」。证据用载荷里已有的两个事实——`httpStatus`（服务商回了非 2xx）或 `logicalCode`（服务商回了 200 + 错误信封）——在，才算服务商这次真回了话。主进程两处早就按这个口径读：`electron/audioTaskRunner.ts:127`、`:209` 只在有 `httpStatus` 时把 `upstreamMsg` 当服务商的话；`electron/catalog/relayNativeWireUpgrade.ts:242` 没有 `httpStatus` 不读它。渲染层唯一的来源判据是例外，这次对齐。这不是在 network 分支里加特判（判据不看类别、不看任何词），也不新增字段。

## 设计卡

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当生成失败、我在失败卡（或可找回面板）上看「服务商原话」时，我想那一行只出现服务商真说过的话，以便据此判断是服务商那边的事（换家 / 等 / 充值）还是我这边的事（网络 / 代理），不被本机的 `fetch failed` 带去找服务商。流程：点生成 → 本机断网 / 代理不通 / 连接被重置 / 超时 → 节点落失败卡，标题「连不上服务商」+ 查网络和代理的提示 → 卡上没有「服务商原话」那一行 → 原始报错仍在「技术详情」与「复制详情」→ 服务商真回了话（HTTP 429 / 503、200 + 错误码、异步任务失败原话）时那一行照旧。**不做什么**：不改错误类别表、人话文案、`vendorSide` 的出处、`ProviderMessageNote` 的样子；不在 network 分支加特判；不改主进程往 `upstreamMsg` 写什么（生产侧收紧另报）；技术详情 raw 原样。**已知坑**：来源证明不了的旧格式字符串（老项目存的裸 `node.error`、本机运行时 / CLI 的报错、Agent SSE 里包着的话）即使真是服务商说的也不再进「服务商原话」——这就是复盘 §7 用户拍板的权衡（可读让位给可证明），原文仍在技术详情；素材上传失败（免配置图床全挂）那句是我们拼的汇总，同样不再标，原文在技术详情、提示照旧指向代理。**真实任务**：① 画布图生图，主进程连服务商时连接被重置（vendorHttp → `ECONNRESET: read ECONNRESET`，发版前清单里的原样）；② 拆镜头 / Agent 文本任务断网（runtimeVendorError → `fetch failed: connect ECONNREFUSED …`）；③ 中转回 HTTP 503「当前分组下无可用渠道」（结构化原话，必须照旧显示）。**指标**（目标 → 信号 → 指标）：主指标——服务商没回话的失败报告带 providerMessage 的比例 → 0%，量具 `src/workbench/observability/vendorQuoteProvenance.test.ts`（真生产者三条通道 × 本机失败）+ `classifyGenerationError.test.ts` 裸串矩阵；质量指标——服务商回了话的报告照旧给出原话的比例 → 100%，量具同文件反例行 + 现有 structured 用例；护栏指标——分类结果（kind / reason / hint / 动作 / vendorSide）在现有用例上变化的比例 → 0，量具 `classifyGenerationError.test.ts` 全套与 31 个依赖测试文件；真机（中英各一张网络错误失败卡）：未验证：走查不抢前台的修复未进 main，只差真机核对。 | 上列测试；探针输出见本卡上一节 |
| ★1b 连带界面 | `providerMessage` 的读者（door-map 4 扇）：失败卡 `NodeErrorReport`（「服务商原话」行 + 反馈摘要 `原因：原话`）、可找回面板 `NodeRecoverableReport`（「服务商原话」行）、Agent 面板 `laneCommandFailure` 的 `classifiedFailure`（`原因：原话`）、分类器自身。本机失败在这几处都只剩人话标题 + 提示；原文在技术详情 / 复制详情（Agent 面板原文本来就只进日志）。不新增文案。 | `node scripts/door-map.mjs providerMessage`；`… ProviderMessageNote` |
| ★2 谁说了算 | 「这句话是不是服务商说的」唯一 owner：`src/workbench/observability/classifyError.ts#vendorOriginatedText`（door-map：1 扇写门，无第二份判据）。`reportFor` 只从它拿 `providerMessage`，不再自己从 raw 抠——删掉回退后 providerMessage 的来源只剩这一处。读者 4 扇 + `ProviderMessageNote` 2 扇只看字段有没有，不自判来源。同一份事实只有一份：`providerMessage` 渲染时现算、不落盘（见下「旧数据」）。不靠状态消失猜意图。**旧数据：现算**——节点只存原始串（`generationRunController.ts:423-426`：「Store the RAW message … NodeErrorReport runs classifyGenerationError over it」→ `deliverRunOutcome(… error: rawMessage)`）；两处 UI 渲染时 `useMemo(() => classifyGenerationError(…))`（`NodeErrorReport.tsx:77`、`NodeRecoverableReport.tsx:38`）；`providerMessage` 在 src / electron 里没有写盘点（door-map 只有读门；`electron/capabilityCore/readTask.ts` 的同名字段是 MCP 工具的另一份合同，见残余风险）。修复对旧卡自动生效：旧卡里存的结构化载荷同样按「有没有 httpStatus / logicalCode」重算。不改存盘格式、不迁移。 | `node scripts/door-map.mjs vendorOriginatedText`；`… extractReadableErrorLine`；`… upstreamMsg`；`git grep -n providerMessage -- src electron` |
| ★3 一致与复用 | 复用已有来源合同 `vendorOriginatedText` + `parseTaskFailureMessage`，不另写判据；「服务商回了话」复用载荷已有字段 `httpStatus` / `logicalCode`（`VendorErrorStructuredLite`），口径与主进程现有读法一致（`audioTaskRunner.ts:127/209`、`relayNativeWireUpgrade.ts:242`）。不加字符串黑名单、不按 `ECONNRESET` 一类的词判。生产者类型 `VendorErrorStructured.upstreamMsg` 的注释写的是「上游原话」，和 6 个分支的实际不符——改成实话（只改注释，不改生产者行为）。`extractReadableErrorLine` 删回退后还有一个用户：unknown 兜底的**标题**（不贴「服务商原话」标签），保留。不新增 npm 包。 | `git grep -n "structured.httpStatus\|httpStatus === undefined" -- electron` |
| ★4 全状态 | 不新增界面状态，逐类：服务商没回话（连不上 / 超时 / 本机拒发 / 跳转被拒 / 请求头守卫 / 响应超限）→ 标题 + 提示，没有「服务商原话」行，技术详情有原文；来源不明的裸串（含素材上传失败汇总、代理兜底中文句）→ 同上；服务商回了话（非 2xx、200 + 错误码）→ 照旧有那一行；异步任务失败格式 → 照旧；原话与标题重复 / 占位 `(no detail from provider)` → 照旧不显示；unknown 且来源不明 → 照旧把可读首行当标题（不贴标签）；取消中 / 过期：不涉及；能力不可用：不适用（不新增要模型或外部资源的动作）。文案不变，界面不谈钱。 | `pnpm run check:i18n` |
| ★9 验收与回滚 | **验收清单（动手前写全，实现线按它自验，验收线只核它）**：a 翻转特征测试——`现状：本机网络错误 %s 进失败详情时仍被标成服务商原话` 改为必须没有 providerMessage；b 裸串矩阵（来源不明）——`ECONNRESET`、`fetch failed`、`TypeError: fetch failed`、`getaddrinfo ENOTFOUND api.apimart.ai`、`TypeError: Failed to fetch`、`request failed: ETIMEDOUT`、`Request timed out.`、systemProxy 的 `网络请求失败：无法连接到该地址。（当前未启用代理；…）` → kind=network、无 providerMessage、raw 保留原文；c 类级（真生产者，服务商没回话）——vendorHttp 连不上（`fetch failed`；cause 带 `ECONNRESET`）、vendorHttp 等响应超时、Agent `modelCallFailure` 的 thrown、pi 运行时 `describeRuntimeError` 的 network 与 timeout、取回出口同形（`new VendorRequestError(tagNomiError('retrieval-query', …), 同一份 structured)`）→ 全部没有 providerMessage，raw 里仍有本机原文；d 反例（修完照旧显示原话）——结构化 upstreamMsg：vendorHttp 真回 HTTP 429 + `{"error":{"message":…}}`、200 + 错误码信封（`logicalCode`）、取回阶段 503「无可用渠道」；任务失败格式 `<原话> (taskId=…, kind=…)` → providerMessage = 原话；e 两个读门——`NodeErrorReport`、`NodeRecoverableReport` 各喂一份网络报告（vendorHttp 真生产者的串）→ 不出现「服务商原话」标签、技术详情钮在；喂结构化报告 → 照旧出现；中英两轨；f Agent 面板读门——`providerFailureText('Connection error.')` 只剩标题、不拼原文；带 httpStatus 的结构化原话 → 照旧 `原因：原话`（中文全角冒号、英文半角加空格）；g 分类不变——kind / reason / hint / 动作 / vendorSide 在现有全部用例上不变（`classifyGenerationError.test.ts` 全套 + 31 个依赖测试文件），只改与「服务商原话」有关的断言，且每处写明为什么；h 删干净——`reportFor` 里不再有 `extractReadableErrorLine`，后者只剩 unknown 标题一个调用点；i 变异——拿掉「服务商回了话」条件 → c 组红；把 raw 回退加回 → a / b 组红。**这一类会从哪里回来**：新的生产者分支往 `upstreamMsg` 写本机的话（不带 httpStatus / logicalCode）→ c 组按通道接住，判据不认字段名；新的本机原始串 → 默认就不给（b 组）；旧数据 → 渲染时按同一判据重算；任务失败格式里我们自己的兜底句 → 不在本单（非网络错误，见残余风险）。**反例 → 结果 → 证据**：实现后逐条填进报告与 PR 正文 `## 验收证据`。**回滚**：revert 实现提交（一个提交）。**独立验收**：不属四类，不强制；协调另派验收线核本清单。 | `pnpm exec vitest run src/workbench/observability/vendorQuoteProvenance.test.ts src/workbench/generationCanvas/runner/classifyGenerationError.test.ts …`；`docs/fixes/2026-10-27-vendor-quote-provenance.root-cause.json` |

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

（路径推不出类别：生产改动只在 `src/workbench/observability/classifyError.ts` 与 `electron/vendor/vendorHttp.ts` 的一行注释；其余是测试与文档。）

## 残余风险（动手前已知，不在本单）

- 任务失败格式认的 `TaskResult.error` 里，主进程有几条分支写的是我们自己的话（`tasks.missingTaskId`、`tasks.noQueryOperation`、`tasks.modelUnresolvable`、`tasks.trackingLost` / `tasks.unknown`、`LOCAL_TASK_EXPIRED`）：渲染层仍会把它们当服务商原话。不是网络错误；要在主进程给 `TaskResult` 带来源事实，另报协调。
- MCP 工具 `read_task` 的 `providerMessage`（`electron/capabilityCore/readTask.ts`）直接读 `TaskResult.error`，同上一条的形状；模型可见合同，按模型可见工具清单另做。
- 生产侧收紧（服务商没回话时不往 `upstreamMsg` 写本机的话，让字段名本身成真）是结构上更强的一层，涉及主进程五个读者（`audioTaskRunner`、`customCallRunner`、`relayNativeWireUpgrade`、`imageRouteFallback`、事件日志），另报协调；本单的渲染层判据对旧数据仍然必要。

> 并 main 后的补记（2026-10-27，协调）：#1340 删了没有生产调用者的 `describeRuntimeError`，Agent 车道改在 `createNomiProvider` 经 `modelCallFailure` 铸载荷。★9 里「pi 运行时 `describeRuntimeError` 的 network 与 timeout」和反例里它的 HTTP 503 那格，改由同一生产者 `modelCallFailure` 的「拿到 2xx 后流中途断了」与「HTTP 503」承担（`src/workbench/observability/vendorQuoteProvenance.test.ts`），network 那格与已有的 thrown 一格重复，删去。
