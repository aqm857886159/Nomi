# 失败怎么分类：判定只在一处（设计卡）

> 标准档（★1 / ★2 / ★3 / ★4 / ★9）。不新增界面元素、不改样子、不增删公开错误码、不改返回字段形状。
> 状态：动手前稿，等协调回话；本卡里的行号以 `96182e162`（origin/main）为准。

## ★0 先查别人（仓库内先例；没有对应的外部库能替我们做这套按镜头花钱语义的失败归因）

- `electron/shared/vendorFailure.ts` · HTTP 状态到类别的查表已有共享主人 · 继续复用，不再抄一份。
- `electron/shared/assets/referenceFetchRefusal.ts`、`electron/shared/agentCapabilities/admissionRejectionHints.ts` · 参考拉取拒绝判据与准入恢复指引已有共享主人 · 判定入口调用它们，不重写。
- `docs/engineering/direction-checks/2026-11-18-failure-classify-one-home.md` · 近两个月四个判定文件 50 个 fix，说明各出口各判一遍是病根 · 决定收成一处。
- 出口：不涉及：本改动不新增界面、不改任何「用户出不去 / 继续做下去」的路径，只把失败判定收成一处；各出口给用户的下一步动作与改动前逐项一致（五出口对拍表守）。

## ★1 用户怎么用

当创作者的一次生成失败了，我想在画布、分镜、任务中心、内置助手、外部助手里看到同一个原因和同一组能做的动作（各自按语言和受众换说法），以便照着做下一步，而不是画布说「去模型接入」、外部助手拿到原样英文或一个不相干的码，越修越偏。

- 真实任务：①画布节点上 `401 Unauthorized` 失败 → 内置助手同一句 → 外部助手同一句；②外部助手调用抛出 `Error('not_node_not_found_extra')`（只是文字里碰巧含「node_not_found」）；③同步供应商已答复但素材没落本机，抛 `Error('still pending')` 并带 `code=asset_not_localized`。
- 不做：不改轮询上限、取回、下载（第二刀）；不碰接入词条与 `electron/catalog/`；不修「失败码被吞掉」与「认码正则的性能」两个遗留问题，搬家不会自动修好，现状写进报告；不新增公开码、不改界面元素。
- 已知坑：把「有意差异」抹平成统一（401 在外部助手有意原样透传；取回失败不能给盲重试；协议隐私码要隐藏 cause；无任务取回改重新生成；语言各出各的）。
- 量具：新增五出口对拍表测试 `src/workbench/observability/failureExits.parity.test.ts`（修前在主分支录一份、修后再录一份并 diff）；各旧测试随导出迁址继续跑；「什么都不做」「全部拦下」两版各一份 diff 存证据目录。没有真任务量具：写 `unverified`，不用 mock 顶替。
- 指标：目标=同输入同原因；信号=对拍表里「类别/公开码/原因键/动作」一致的行占比（除有意差异行）；护栏=界面出口词条与动作修前修后逐项相同（行数不许少于准备报告 §2 的全部例子 + U1–U3）。

### ★1b 连带界面
不新增露出点。已有露出点：画布错误卡、分镜行、任务中心行、内置助手红字、外部助手 MCP 回执文字与 `outcome`。词条与动作对同一输入不变，由对拍表钉住；变了就停下报协调。

### ★1c 老用户
旧项目里落盘的失败记录（node.error / Run 失败原文）打开后照新判定显示：判定输入仍是同一段原文，旧 `NOMI_ERR::`/`NOMI_VENDOR_ERR_B64::` 标记、`→ hint` 尾巴、`node_generation_in_flight: …` 都照旧读。用仓库登记的真实旧版本夹具核一次：`tests/fixtures/old-user-data/runs/v0.24.0-canvas-interrupted/node.json`（`node_generation_in_flight: …`，0.24.0 落盘；仓库里没有带失败原文的 0.24.1 夹具，`v0.24.1-pending-asset` 只有素材未落地的目录，不含失败串，如实写）。存储格式、IPC 形状不变，退回上一版不受影响。

## ★2 谁说了算

**家（一处）**：新纯叶子 `electron/shared/generationFailure.ts`（不 import `src/`，不 import i18n / React / 桌面桥）。唯一入口 `decideGenerationFailure(input)`，输入 = 原文 `message` + 可选确证字段（`code`/`errorCode`）+ 事实：`locale`（zh-CN|en，替代 `i18n.language`）、`transient`（pi 判过瞬时，替代 C 的二次改判）。输出 `GenerationFailureDecision`：`kind`、`publicCode | null`（只来自确证码，含 U3 的码字段）、`vendorSide`、`primary/secondary`、`copy`（词条键 + 插值事实 / 或原文摘行）、`upstream`（有来源的供应商原话）、`modelKindFix`、`raw`。共享层同时搬入：判据全部（A 的完整优先序）、`GenerationErrorKind` / 动作表 / 是否供应商一侧表 / 无任务动作表、`shotClaimCopy` 的动作表、`parseVendorErrorFromMessage` / `stripVendorErrorMarker`、`parseTaskFailureMessage`（用共享词条文件里的 zh/en 兜底句）、`failureActionsFor(kind, {taskId, productionRunId, isProduction})`（任务来源改动作，原 `generationFailureActions` 内部逻辑）、公开码表（`POLICY_CODES` / 准入码 / 接入码，含整词边界的「文字里的码」识别）。

**词条文件**：`electron/shared/generationFailureCopy.ts`（纯数据，无 i18n）= 外部助手公开码的人话 + 恢复动作（原 `ERROR_HINT` / `USER_ACTION_HINT`，zh/en）与「任务失败兜底句」zh/en。界面原因 / 说明词条（`generationCommon.observability.error.*`）留在 `src/i18n/locales/generationCommon.ts`，共享层只返回键——搬 600+ 行双语词条没有任何行为收益、徒增旧词条漂移风险；写进报告「没做的」，协调有异议再改。

**三个出口只做投影**（各自保留自己受众的呈现，不再读原文判类别 / 码 / 动作）：
1. 画布 / 分镜 / 任务中心 / 浏览器 / 内置助手路径：`src/workbench/observability/classifyError.ts` 的 `classifyGenerationError(message)` = `decide…` + `i18n.t(键, 插值)`，返回形状 `GenerationErrorReport` 不变；`narrate.ts` 只剩词条投影（`narrateGenerationError` 等）；`generationFailureActions.ts` = 调 `failureActionsFor` + 取词条。
2. 外部助手：`electron/capabilityCore/mcpToolErrorResults.ts` 的 `buildToolErrorOutcome(toolName, error, locale)` = 读共享 `publicCode` + 词条文件取人话 / 恢复动作；公开码集合与 `outcome` 字段形状不变。
3. 内置助手：`src/workbench/ai/lane/laneCommandFailure.ts` 把 `transient` 作为事实传给共享层；不再「先分类、认不出再用 `'network error'` 重新分类」。保留的展示规则（`showableRaw`：未分类的拉丁散句不印、`stripClassificationMarkers`）是**该受众的呈现规则**，不改类别 / 码 / 词条键 / 动作。

**门数（door-map，前 → 后）**
- 判定出口（读原文自己分类 / 认码的函数）：前 3（`classifyGenerationError`、`buildToolErrorOutcome` 里的子串认码、`laneCommandFailure.classifiedFailure` 的二次改判）→ 后 1（`decideGenerationFailure`）。
- 调用门（文件×符号，只数，不改）：前 `classifyGenerationError` 11 扇（写 10 读 1）、`buildToolErrorOutcome` 2 扇、`laneFailureText` 3 扇、`providerFailureText` 2 扇、`generationFailureActions` 见 door-map 输出；动手后按同口径重数，目标：调用方文件不变（投影签名不变），共享层入口调用方 = 这三处投影 + 单测。
- 概念：`diagnostics.generation-error-copy` owner 迁址到共享叶子（登记迁址，不追加第二 owner）；`diagnostics.error-code` 不变。

**到点以后谁跟 / 「不知道」当不当失败**：不涉及（纯判定，无定时、无长跑）。「认不出」仍是 `unknown`，不编原因，不甩锅给 key。

**交接处（只引用，不新造、不升格）**：内置助手路径命中已登记的 `agent-writes-params`（owner 未定，checked=true）；结果解析 `vendorErrorIpc.ts` / `taskFailureMessage.ts` 命中 `result-to-project`（checked=false）。见 `docs/engineering/seams.json`。

**删什么 / 为什么能删 / 现有调用方怎么过**

| 删 | 为什么能删 | 调用方怎么过 |
|---|---|---|
| `mcpToolErrorResults.ts` 里 `Object.keys(ERROR_HINT).find((key) => rawMessage.includes(key))`（:208）及按表顺序抢码 | 判据本体搬进共享层，改为「确证码字段」+「整词边界、取文中最先出现的一个」；子串认码没有任何合同依据（U1/U2） | 唯一调用方 `mcpProtocol.ts:516` 和 `mcpRpcError.ts:43` 调 `buildToolErrorOutcome`，签名不变；`mcpToolResults.test.ts` 现有断言（`generate failed: renderer_or_provider_unknown` 仍识别、`ECONNRESET boom` 仍原样）随迁继续跑 |
| `classifyError.ts` 内全部判据（A 的优先序、`detect*`、`legacyEvidence` 等）与 `narrate.ts` 里的类别 / 动作 / 供应商一侧三张表 | 搬进共享层；留投影 + 词条 | 11 扇调用门读 `classifyGenerationError`，签名与返回形状不变；`narrate` 的导出（`GenerationErrorKind`、`narrateGenerationErrorActions`、`narrateIsVendorSideFailure`、`GENERATION_ERROR_KINDS`、`ERROR_KEY_BY_KIND`）改为从共享层 import（同提交改 ~10 个 test / src 引用，无并行版、无转出别名） |
| `laneCommandFailure.ts:207-208` 的 `classifyGenerationError('network error')` 二次改判 | 改成共享层的输入事实 `transient`；类别由共享层一处判 | `providerFailureText` 2 扇、`laneFailureText` 3 扇，签名与 `AssistantFailureFacts` 形状不变 |
| `vendorErrorIpc.ts` / `taskFailureMessage.ts` / `shotClaimCopy.ts` 的判定函数（搬走后原路径删除） | 纯判定，随共享层；渲染端 `formatTaskFailureMessage`（产出端）仍留在 renderer 并从共享层 import 同一份格式常量 | 其调用方（`generationRunController` 等）改 import 路径，行为不变 |

## ★3 一致与复用

- 以前定过：准备报告 `P-home-classify`（推荐抽纯共享叶子、①②③只投影、同提交删旧判据）；用户 11-17 定「判定只在共享层一处，出口不再自己防守」与「共享层之外读原文 / 码再自己匹配、构造或覆盖类别、公开码、词条、动作，要在代码层写不出来」。按今天仍算数，原因没变（近两个月四个判定文件 56 个非合并提交、50 个 fix）。
- 三条路：沿原方向修（继续在三处各补）= 已被 50 个 fix 证伪，不选；换做法（抽共享叶子）= 选；删（外部助手只回码指回 Nomi）= 丢模型自纠与恢复指引，不选。
- 复用：`electron/shared/nomiErrorCodes.ts`、`assets/referenceFetchRefusal.ts`、`contracts/ipcInvokeFailure.ts`、`vendorFailure.ts`、`generationProblem.ts`、`admissionRejectionHints.ts`、`productionShotPhase.ts` 原样复用，不重写；pi 适配 `laneProviderGuard.mts` 与 `recoverableCopy.ts` 保留为唯一主人，只消费。
- 热点：`node scripts/fix-churn.mjs src/workbench/observability/classifyError.ts` 与 `src/workbench/ai/lane/laneCommandFailure.ts` 红（见下「待协调」）。
- P0：共享叶子是把已有判据搬家，不新增自写能力；门岗扫描 failure-decision-bypass 属自写条目 gate-family，理由写在方向检查的补充一节。
- 文件拆分：共享叶子按职责分四个文件（入口 generationFailure、词汇表 generationFailureKinds、原文读取 generationFailureWire、检测器 generationFailureDetect），判定入口仍只有 decideGenerationFailure；原因是文件体积门岗不许单文件超 800 行。

## ★4 全状态（界面逐态不变；下面是失败分类的出口）

空：空原文 → 现有 `unknown` 兜底词条；加载：不涉及；成功：不涉及；失败：见 ★9 对拍表；部分成功：不涉及；取消中：不涉及（取消不是失败，仍由调用方短路）；过期：旧落盘失败串照新判定显示（★1c）；能力不可用：不涉及，模型可用性结论只读不改。文案走现有 i18n（zh / en），不新增键、不含「免费 / 不扣费」类断言（`noChargeClaims.test` 继续读目录）。

## ★9 验收与回滚

**判据（只有一句）**：用准备报告 U1–U3 与 §2 全部例子的同一组输入对五个出口对拍；①「什么都不做」（主分支）上目标测试必须红；②「全部拦下」版（共享判定一律返回 unknown / 一律只给 retry）上目标测试也必须红；两版都由我自己做出来跑给协调看。

**U1–U3 统一结果（请协调拍板）**
- U1 `not_node_not_found_extra` → 五出口一律 `unknown`、`publicCode=null`、外部助手原文透传（码须是整词：前后不得紧挨 `[A-Za-z0-9_]`）。理由：没有任何合同要求任意前后缀放行，且旧行为会让助手去刷新节点。
- U2 `unknown_model_identity node_not_found` → 文中**最先出现**的整词码 `unknown_model_identity`（外部助手 `publicCode=unknown_model_identity`；画布 / 内置助手 `unknown`）。理由：包装错误通常外层在前（`外层: 内层原因`），最先出现的码就是最外层、最接近调用方能做的那一步；与登记表书写顺序无关；多码并存不丢信息，备选「多码即 null」会丢掉确证信息。设计卡批示：加一条断言钉住「按文中位置、不按表序」，以后不得悄悄改成按表序（测试里把两码调换顺序，结果跟着换）。
- U3 `Error('still pending')`+`code=asset_not_localized` → 外部助手 `publicCode=asset_not_localized`、人话 + 「在 Nomi 打开节点完成本地化」，与把码塞回 message 的结果一致；画布 / 内置助手只收 message，该码不是生成类别，仍 `unknown`（不新增类别 = 不新增词条 = 不改界面）。理由：确证码不因放在字段还是文字里而丢失；确证码表只登记一次（结构化表与人话表合一）。

**有意差异（保留，写成共享层输入事实 / 受众投影，各一条保持用例）**
- 识别域断层：`401 Unauthorized`，外部助手 `errorCode=null`、原文、无恢复动作；画布 / 内置助手 `auth`+「去模型接入」。（`mcpToolResults.test.ts:187` 同类断言保留）
- 阶段码优先：`NOMI_ERR::retrieval-download:: fetch failed` + taskId → `retrieval-incomplete`，动作「重新取回」；外部助手原文；不得统一成盲重试。
- 无任务取回改重新生成（`failureActionsFor` 的 `taskId` / `isProduction` 事实）；pi 瞬时 → `unknown` 改 `network`（`transient` 事实，而非出口改判）；协议隐私码（`node_not_found` 带私有 cause）外部助手只留码；语言（locale 输入）；`human_approval_required` 只问「在 Nomi 确认一次」。

**应过清单（每条 = 一个测试；改坏→红、还原→绿，日志进报告）**
1. 五出口对拍表：准备报告 §2 的 I1a–I9 + U1–U3 全部输入，逐个比「类别 / 公开码 / 原因键 / 动作」，修前（主分支）与修后各录一份并 diff；界面出口（画布 / 分镜 / 任务中心 / 内置助手）修前修后逐项相同，外部助手只有 U1–U3 三行变。
2. 「什么都不做」版（主分支，只带新测试）：U1、U2、U3 三条红。
3. 「全部拦下」版（共享判定一律 `unknown`）：`401 Unauthorized` 在画布 / 内置助手必须仍是 `auth`+去模型接入 → 红；另一版「一律只给 retry」：`retrieval-incomplete` 的 view-task、`model-unavailable-upstream` 的 switch-same-capability 等 → 红。
4. 反例：把子串认码放回外部助手出口（含改名、内联、别名）→ 扫描红；在内置助手出口自行 `kind` 覆盖（还原 `'network error'` 二次判定）→ 扫描红 + 对拍红；还原 `cb2cced31` 旧案（端口 `59401` 读成 401）→ `legacyEvidence` 用例红；`storyboardFailureCopy` 只拼技术详情、`laneProviderGuard` 只追加 pi marker → 保持绿（不该拦的不拦）。
5. 锁（代码层写不出第二处）：扩现有 `check:concept-owners`（scan/lib + node-test，不新增检查命令，登记迁址不抬基线）认出共享层之外：读 raw / message / code 后自行匹配并构造或覆盖「失败类别 / 公开码 / 词条键 / 动作」（对象字面量里的 `kind` / `errorCode` / `primary` / `secondary` / `vendorSide` 取值是封闭词表里的字面量；对封闭词表字面量做 `includes` / 正则 / 相等判断后赋给上述字段；含别名与内联）；并配 ESLint 限制 import：共享层内部表（动作表 / 码表）只许经投影函数读。检查本身的反例（放回子串认码 / 在出口覆盖 kind）进 node-test；新扫描型测试登记进 `scripts/pre-push-scan-guards.mjs` 的 `SCAN_GUARDS`，提交前跑 `node scripts/check-scan-guard-census.mjs`。
6. 老用户：把 `runs/v0.24.0-canvas-interrupted/node.json` 的 `error` 喂对拍，修前修后同为「本机拒绝 / local-refusal」。
7. 公开码集合与 `outcome` 字段形状不变：`mcpToolResults.test.ts` / `mcpRpcError.test.ts` 现有断言全过；码集合快照断言。
8. 自查探针先装进程级 `globalThis.fetch` 拦截（非回环一律抛）并跑金丝雀。

**独立验收**：协调另派验收线（不是实现线），核本节清单与反例；PR 正文 `## 独立验收` 写「待派」。
**回滚**：revert 本提交即可（无存储格式 / IPC 形状变更，无迁移）。
**声明**：不起窗口——界面出口词条与动作对同一输入不变，由五出口对拍证明；外部助手公开码集合与返回字段形状不变，只改认错的几种输入，所以不跑真模型评测。不花钱、不读 Key、不连真供应商。

## 待协调（停点）
1. 热点：`classifyError.ts` / `laneCommandFailure.ts` 触发 fix-churn 红（目录近 14 天已有 5 个 fix）。这一刀不是再补一刀，而是把三处判定收成一处（P1 的「先类根因复盘」本质就是它）。需协调代批：用准备报告 `P-home-classify` + 本卡当「类根因复盘」，`Direction-Check:` trailer 指向本卡。
2. U1/U2/U3 的统一结果与「界面词条留在 generationCommon、共享层只返回键」的取舍（上）。
