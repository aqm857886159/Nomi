# 实施方案：生成请求链收口成「一份声明、一个降级函数、一个问题形状」

- 方向检查：`docs/engineering/direction-checks/2026-11-08-generation-request-chain.md`。入库时放 `docs/engineering/direction-checks/2026-11-08-generation-request-chain.md`，跟 S0 的 PR 一起进。后面每片碰热点的提交都带 `Direction-Check: docs/engineering/direction-checks/2026-11-08-generation-request-chain.md`。
- 基线：main `745b3c5b4`，2026-11-08。

**要用户拍板的有两件**，都因为要改的文件本身到线，P1 的代批例外不适用（例外要求「要改的文件本身没命中」）：

1. 这份方向检查本身（RW）。到线的文件有四个：
   - S1 要改 `laneToolFailureEnvelope.ts`，14 天 2 个 fix，这一刀是第 3 个；
   - S3 要改 `taskParams.ts`，14 天 6 个 fix；
   - S4 要改 `classifyError.ts`（14 天 9 个 fix）和 `vendorFailure.ts`（2 个）。
2. S3「参考放置收成一个函数」进不进 0.25：**推荐进**，但挂三道闸：S0 先红后绿、全格子逐字节对比、一次免费走查加一条真付费样本。三道闸在 0.25 切版前过不了，S3 就挪到 0.26，0.25 只发 S0、S1、S2、S4。代价是创作者继续发官方说互斥的双键请求，结果按哪个字段出来不确定。

剩下的不用等用户：S0、S0b 只加测试和量具。S2 碰的文件本身没到线，只命中「参数准入」概念的第 3 个 fix，改法是换和删，协调可以按 P1 例外代批，事后报用户。S2 动手前要按开工时的 main 重跑 `node scripts/fix-churn.mjs`。

## 先说「声明」已经有多少

不用从零造。档案槽位 `ArchetypeReferenceSlot`（`electron/shared/modelArchetypes/types.ts:22–65`）已经声明了这些：

- `inputKey`：键名；
- `asArray`：是不是数组；
- `roleName`：合并成角色数组时的 role，缺省由 kind 派生；
- `min` / `max`；
- `requiresAnyOf`：跨槽依赖。

`ArchetypeMode.combineSlotsInto` 声明了合并进哪个对象数组，`sources[].checkedAt` 已经是结构化出处。

缺的是两样：

- **只读它的那个函数。** 今天主进程 `projectReferencesOntoBodyKeys` 不读这张表，按 body 键名猜「族」；引擎 B 不读角色表，把合同角色词原样塞进去。
- **互斥对。** `image_urls` 和 `image_with_roles` 不能同时出现，现在没有地方声明。

所以 S3 主要是删「猜」的那几份，加回「读」的那一份。

---

## S0 官方字段类测试 + 官方事实靶子（只加测试，短档，进 0.25）

**改 / 加**

- `tests/fixtures/vendor-official/apimart/<modelKey>.json`，每个内置图片 / 视频模型一份，每个模式写清：
  - 官方允许的参考键；
  - 每个键的形状（字符串、字符串数组、`{url, role}` 数组）；
  - role 枚举；
  - 张数上限；
  - 互斥对；
  - 「1 张时的语义」（比如 Wan 2.7 的 `image_urls` 1 张就是首帧）；
  - 每条带 `source`（官方页 URL）和 `fetchedAt`。
- 抽取：从本线已经下载的官方页（`复盘线下载的官方页副本（协调本机，不入库）`）先由脚本抽一版，再人工逐条对。复核线不能是写档案的线，也不能是写这个测试的线。
- `electron/parity/officialWire.matrix.test.ts`：遍历每个内置 APIMart 图片 / 视频模型 × 每个档案模式 × 两条路（画布 `runTask`、Run 路 catalog provider，两边都抓真 fetch 的 body）× 参考集 {0 张, 1 张, 每槽上限}。断言六条：
  1. body 里的参考键都在官方集合里；
  2. 每个 URL 只出现在一个键里；
  3. 互斥对不同时出现；
  4. role 都在官方枚举里；
  5. 每个键的张数不超过官方上限；
  6. 同一个意图，两条路出同一个 body（键和值都一样）。
- `electron/parity/officialWire.known-red.json`：今天红的格子，每格写复现编号（复现 1 = 按族封顶，复现 2 = 角色词，复现 3 = 双键）。棘轮：只许减。红格转绿后还留在表里，测试也要红，逼着删掉那一行。
- 把媒体批的双键探针扩到全部模式，验证预测 P1。结果写进测试注释，作为 known-red 的出处。

**不删**：这一片只加测试。

**老用户**：不涉及。

**验收（实现线自验，验收线只核这张表）**

- [ ] 在 `745b3c5b4` 上跑，红的格子 = known-red 表，不多不少。至少含 Seedance 2.0 首尾帧、Vidu Q4 参考、Wan 2.7 参考 1 张（复现 3），以及复现 1 的三格。
- [ ] 每条官方事实都有 `source` URL。抽 5 条，打开原页能找到原句。
- [ ] 反例 1：手动把某格 body 里多余的 `image_urls` 删掉，那格转绿，known-red 那一行让测试变红（棘轮有效）。
- [ ] 反例 2：把靶子的任意一条改成从我们档案里抄的值（比如把 Seedance 2.0 的上限写成档案里的数），复核清单要能指出它没有官方出处。
- [ ] 反例 3：靶子不能拿 A 和 B 互比代替：只改 A 的 body，第 6 条断言和第 1–5 条断言里各至少有一条红。

**依赖**：无。最先做。

---

## S0b 量具：在 main 上重跑 39 题，补齐 8 道不可判（评测花费，进 0.25）

**改**

- 修 `tests/ux/agent-param-eval-real-model.walk.mjs` 夹具的起始态，让 P23、P24、P26、P29、P31、P32、P33、P35 能判。这 8 道题缺的是夹具里的草稿。
- 把本线的逐站分类（`复盘线的逐站分类脚本 eval_station.py（协调本机，不入库）`）改写成仓里的 `tests/ux/agent-param-eval-stations.mjs`，让「本链占多少」以后能复算。

**跑**：先在 main 上跑一次，作为 #1435 之后的新基线，用来验证预测 P2。S1 + S2 之后跑一次，S3 之后再跑一次。

**验收**

- [ ] 39 题全部可判；
- [ ] 输出逐站计数，和本线基线同口径：breaker 单列，「拼参数 / 报错没说清 / 起始态 / 其它」四栏；
- [ ] 报告里写清花了多少 DeepSeek 额度。

**依赖**：无，和 S0 并行。

---

## S1 拒收带闭合原因：Agent 面板说对原因，遥测记原因（标准档，改了可见文案，进 0.25）

**改**

- 新增 `electron/shared/generationProblem.ts`：闭合码表 `GenerationProblemCode`，加上问题形状 `{code, field?, allowed?, nearest?, min?, max?, next?, retryable, charged}`。形状借 RFC 9457 的成员语义，不走 HTTP 媒体类型。

  码表首批：

  | 码 | 意思 | 带什么 |
  |---|---|---|
  | `unknown_model` | 点名的 id 不存在 | `nearest`，从 list_models 按编辑距离取 |
  | `no_default_model` | 没点名，也没有默认 | — |
  | `mode_not_in_model` | 模式不在这个模型里 | `allowed` |
  | `ratio_not_in_mode` | 比例不在这个模式里 | `allowed` |
  | `duration_not_in_mode` | 时长不在这个模式里 | `min` / `max` 或 `allowed` |
  | `reference_over_capacity` | 参考超量 | `max` |
  | `reference_role_not_in_mode` | 角色不在这个模式里 | `allowed` |
  | `parameter_not_allowed` | 参数值不允许 | 字段 issues |

  后面的上游码在 S4 加。
- `electron/shared/agentLane/laneToolFailureEnvelope.ts`：`generation_input_invalid` 信封加一个 `problem` 成员。
- `src/workbench/ai/lane/laneToolFailureText.ts` 和 i18n `agentToolFailure.ts`：按 `problem.code` 出本地话，每个码一句 zh、一句 en。
- 抛出点改成带码，按 door-map 逐个列：
  - `semanticGenerationCandidate.ts:390–425`：拆成 `unknown_model` 和 `no_default_model`。判法是：调用里点了名但找不到，就是前者。
  - `mcpGenerationMultiShot.ts`：同一句的另一份，约 161 行，一起拆。
  - `mcpGenerationVideoResolve.ts`：`Unknown video mode` 改成 `mode_not_in_model`。
  - `executionContract.ts`：约 201–358 行的比例、时长、参考超量（约 350 行那条，目前抛出时不带 rejection）。
- 遥测：`agent.tool.failed` 加 `reason`（闭合码，过 `telemetryEvents.ts` 的标识符校验）。

**删**

- 这些抛出点的纯散文 `refuseToModel(GENERATION_ARGUMENT_REFUSAL, "…")` 调用，改成只收 problem 的构造器。构造器从码和字段生成给模型读的英文正文，让写不带码的拒收在类型上写不出来。
- 面板那句兜底「这个模型不接受这组参数，这一步没有执行。」只在 `parameter_not_allowed` 时出现，不再兜所有情况。

**老用户**

- 0.24 留下来的 lane 记录里，失败行没有 `problem`。面板读到旧信封时照今天的规则显示，因为 `failureOf` 是按入参重推的。
- 要用一份真实 0.24 记录测，从 `docs/evidence` 或评测产物里取，不碰用户资料目录。

**验收**

- [ ] 8 个码每个都有一条用真实拒收触发的测试，入参取自 39 题轨迹。
- [ ] 反例 1：candidate 点名 `volcengine` + `doubao-seedream-5-0-pro`（不带日期后缀，轨迹里真出现过）。面板必须说「没有这个模型，最接近的是 …」，不许说「没有配置可用的图片模型」。
- [ ] 反例 2：真的没有默认模型，镜头也没点名。说「先选一个默认图片模型」，并给去设置的指路。
- [ ] 反例 3：被拒的是参考超量。面板不许说「这个模型不接受这组参数」。
- [ ] zh、en 两轨面板截图：至少 `unknown_model`、`ratio_not_in_mode`、`reference_over_capacity` 三种。实现线自己 Read 过，协调逐张对过。这是可见文案改动，按「可见修复要先出图」，先拿文案表给协调对，再截图。
- [ ] 遥测：一条失败事件带 `reason`；`reason` 不在码表里时，校验拒收。
- [ ] 量具：S0b 重跑后，「点名 id 不存在却说没配置默认模型」这一栏从 9 变成 0。

**依赖**：无。和 S0 并行。

**热点**：`laneToolFailureEnvelope.ts` 文件 14 天 2 个 fix，这一刀是第 3 个。另有目录 `src/workbench/ai/lane/` 4 个、`electron/telemetry/` 5 个，概念「画布付费生成」12 个、「参数准入」2 个。文件本身到线，要等用户拍板这份方向检查。

---

## S2 Agent 工具面：模式决定传输种类，比例由降级函数翻（标准档，进 0.25）

**事实**

- Agent 填的 `taskKind` 现在被拿去和档案的**传输桶**（`modeTransportFor`，也就是 mapping 寻址键）比。视频档案的所有模式共用一个传输桶，所以 Agent 照语义写「首尾帧 = image_to_video」会被拒。
- 这是要模型去学我们内部的寻址键，违反 ⑪「能选到」。基线里 10 次错误调用是这个。
- 引擎 B 还另有一张 `MODE_TO_TASK_KIND`（`apimartGenerationProvider.ts:105–128`），把模式字符串映射成传输种类，是第二份答案。

**改**

- `mcpGenerationVideoResolve.ts` 的 `videoModeForPlan`：给了 modeId 时，传输种类只由 `modeTransportFor` 算，`taskKind` 不再参与比较。`taskKind` 只在模型没有模式（非档案模型）时才读。
- 工具 schema 里 `taskKind` 的描述改成「模型有 modeId 时不用填」，不加条件关键字，因为 OpenAI 结构化输出不支持 if/then。
- 比例：不新写函数。全仓唯一的比例 owner 是 `electron/shared/aspectRatioValue.ts`（`resolveAspectRatioChoice`，宿主翻译和画布参数面板同用）。它已经会按「同档」挑像素串，只是只认冒号写法（`1280:720`），不认 x 写法（`2560x1440`，第 67 行注释）。
  - 让 `normalizeAspectRatioToWH` / `widthHeightOf` 认 `WxH`；同档挑选、`several_sizes` 拒收的规则都不动。
  - 单测用火山 Seedream 4.5 / 5.0 的真实 `size` 枚举（`seedreamVolcengine.ts:22`）。
  - S3 时这个 owner 原样被降级函数调用。
  - 画布面板也读这个判据，改完后火山 Seedream 的 `size` 会被画布认成比例控件。这是可见变化：先截图，看画布那个控件长什么样、会不会变。会变的话先出图给协调。

**删**

- `mcpGenerationVideoResolve.ts:194–203` 那条「Video mode X is a K mode, but this shot asks for Y」拒收；
- `apimartGenerationProvider.ts:105–152` 的 `MODE_TO_TASK_KIND` 和 `taskKindForMode`。B 改成读编译后合同里由 `modeTransportFor` 算好的传输种类。

**老用户**

- 旧草稿只有 `taskKind`、没有 `modeId` 的，照今天 `videoModeForPlan` 后半段按 `taskKind` 和推荐事实挑模式，行为不变。要一份只带 `taskKind` 的旧草稿做测试。

**验收**

- [ ] 反例 1：P21 的入参（首尾帧，modeId=firstlast，taskKind=image_to_video）不再被拒，编译出的传输种类等于 `modeTransportFor` 的结果。
- [ ] 反例 2：P04（火山 Seedream 4.5，`aspectRatio: "1:1"`）编译出 `size: "2048x2048"`。同一比例只有一档，所以不拒。
- [ ] 反例 2b：同一比例有两档像素串（同档规则判不出）时，仍然是 `several_sizes` 拒收并列出候选，不随便挑一档（挑档 = 挑价钱）。
- [ ] 反例 3：模式里根本没有任何比例或尺寸（比如只有首帧决定画幅的模式），仍然返回 `ratio_not_in_mode`，不偷偷丢掉。
- [ ] `grep -rn "MODE_TO_TASK_KIND" electron` 结果为空。
- [ ] 量具：S0b 重跑后，「taskKind 和 modeId 打架」从 10 变成 0，「比例没翻成尺寸」从 15 变成 ≤ 3。剩下的应该只有 HappyHorse 图生视频那种合法拒收，加上火山 Seedance 2.5 `ratio` 那 2 次：那 2 次本片要先查清原因，是合法就留着，是漏了就一起修。

**依赖**：S1，因为拒收要用同一个 problem 形状；比例那一刀不依赖 S1，可以先做。S0 不是硬依赖。

**热点**：`aspectRatioValue.ts` 和 `mcpGenerationVideoResolve.ts` 动手前先跑 `node scripts/fix-churn.mjs`。本线没跑这两个文件。

---

## S3 参考放置收成一个降级函数（四类：花钱。设计卡 9 格全填，另派独立验收线。进 0.25 要用户拍板，见开头）

**改**

- 新增 `electron/shared/generationLowering/lowerGenerationIntent.ts`，纯函数、同步，不读盘、不读目录。
  - 输入：
    - 声明：档案模式的槽位表 + `combineSlotsInto` + 互斥对 + 参数控件；非档案模型的声明见下面「老用户」；
    - 意图：`{references: [{url, slotKind, role?}], params: 语义参数}`。
  - 输出：`{bodyParams, problems}`。规则只有四条：
    1. 每个参考按槽位表放进且只放进一个键；
    2. 合并槽按 `roleName` 合成对象数组；
    3. 互斥对里只出现声明的那一个；
    4. 比例到尺寸、默认值都从声明取。
- 新增 `electron/shared/generationLowering/declarationForMode.ts`：从档案模式和 mapping body 合成上面的声明。互斥对加进档案模式的类型，作为 `exclusiveInputKeys`，每条带 `sources`。
- 引擎 A：渲染层 `buildCatalogTaskRequest` 只送意图（模式、参考列表、语义参数），`runTask` 在主进程调降级函数。headless 调用方（MCP、Run 门）同样只送意图。
- 引擎 B：`projectionRequest` 改为调同一个降级函数，再交给共用模板渲染。
- 校验器：同一份声明编译一次，校验降级结果，issues 进 S1 的 problem 形状。选型由本片设计卡 ★0 定，约束有两条：
  - 渲染层不许引入 CJS 校验器（`.dependency-cruiser.mjs` R-B7，见 `modelSchemaStandardCheck.ts` 文件头）；
  - 主进程不 eval（Ajv 的 CSP 说明）。

  可选项：TypeBox `Value`（解释执行）、内置声明用 Ajv standalone 预编译加运行期解释执行，或者沿用 `compileParameters` 的判据但改成读声明。本线没核 TypeBox 1.3.7 吃不吃原始 JSON Schema，记 `unverified`。

**删**（同一个 PR 删干净，不留并行版、不留回退）

- `taskParams.ts` 里的 `projectReferencesOntoBodyKeys`，以及 `archetypeReferenceUrlsByFamily`、`carriedReferenceUrlsByFamily`、`OBJECT_SHAPE_REF_KEY`、`hasDistinctFlatSource`；`applyHeadlessParamDefaults` 只剩「默认值从声明取」，或者整个并进降级函数；
- `apimartGenerationProjection.ts` 里的 `projectReferenceUrls`、`PROJECTION_KEYS`、`PARAMETER_ALIASES`，还有 `mirrorApimartReferenceParameterAliases`；
- `archetypeInput.ts` 里 `referenceInputParams` 的参考那一半；
- 渲染层 `buildReferenceExtras`、`buildArchetypeInputParams` 里「写线上键」的部分，只保留采集语义意图；
- `imageEditGuardError` 的散文护栏，改成声明里图生图槽的 `min: 1` 由校验器判，A 和 B 不再一个带 `modelModeBodies`、一个不带；
- `modelReferenceSelection` 作为「容量依据」的用法。容量只读声明，它只留身份用途。

**老用户**

1. **旧画布节点**：`node.meta` 里可能残留以前泄漏的线上键（10-22 那次）。降级函数只读意图（composer 参考列表 + 声明过的语义参数），残留键自然不进 body。
   - 用升级路径门岗的真实旧版本项目数据测：0.23、0.24 各至少一份带参考的视频节点；
   - 期望：body 只比旧版少了双键，其余逐字节相同。
2. **声明卡接入的中转模型**（没有档案）：今天靠 `bodyReferenceSupport` 从 body 模板猜参考键。
   - 本片做一次性推导：从 body 模板里的参考占位推出槽位表，存进那条声明。
   - 验收要求：对测试语料里每一条非档案声明，推导后的 body 和今天的 body 逐字节相同。推导不出的形状要列出来，在设计卡 ★1c 里逐条定怎么过。
   - 「推导不出就照旧猜」不能是默认答案（P1）；但也不能让老用户的模型突然不能用（老用户迁移原则）。所以要先数清有多少，再定。
   - 本线没核 `bodyReferenceSupport` 的全部形状，记 `unverified`。

**验收**

- [ ] S0 的 known-red 表清空，复现 1、2、3 全转绿。
- [ ] 逐字节对比报告：全部格子改前、改后 body 对照，每一处差异都挂一句官方原文作为理由。没有理由的差异算失败。
- [ ] 反例 1：Seedance 2.0 首尾帧，body 只有 `image_with_roles`（first_frame + last_frame），没有 `image_urls`，同一个 URL 出现 1 次。
- [ ] 反例 2：Wan 2.7「参考生」1 张，body 里不出现会被官方解读成「首帧」的 `image_urls`（除非官方页写明这个模式就用它）。
- [ ] 反例 3：Vidu Q4 参考 1 张，body 形状和官方页的那个模式一致。
- [ ] 反例 4：Seedance 2.0 全能参考放 3 张，Run 路不再被按族封顶成 1 张（复现 1）。
- [ ] 反例 5：Run 路的合同角色词（比如 `subject`）不会原样出现在 `role` 里，只出现官方枚举值（复现 2）。
- [ ] `grep -rn "projectReferencesOntoBodyKeys\|PARAMETER_ALIASES\|PROJECTION_KEYS" electron src` 结果为空。
- [ ] 免费走查：真窗口，3 个模型（Seedance 2.0 首尾帧、Vidu Q4 参考、Wan 2.7 参考），抓发出前的请求体，产物带修复标记。
- [ ] 一条真付费样本：Seedance 2.0 首尾帧，由协调在专用工作树跑。出片要能看出首帧和尾帧都被用上了；看不出就记 `unverified`，不算过。
- [ ] 独立验收线核以上清单，编号不能和实现线相同。

**依赖**：

- S0 必须先进；
- 要用 S1 的 problem 形状；
- 建在媒体批之上：分支 `fix/catalog-media-docs-align`，角色表已收进 `referenceChannels.ts`，那批先合。

**A4h 怎么排**（计划里的「Run 路张数按模型不按模式」，就是复现 1）：

- 不单独派线，并进本片，作为反例 4。
- 本片挪到 0.26 的话，A4h 作为最小修补单独进 0.25：给 `modelReferenceSelection` 的返回类型加上 modeId（它现在只有 taskKind），再在 `runtime.ts:296` 和 `apimartGenerationProvider.ts:271` 两处传进去。原因是 Seedance 2.5 / Wan 3.0 首尾帧放两张图会被拒，这挡住了用户。

---

## S4 上游错误归一 + 余额不足 + 文本大脑总发输出上限（四类：花钱。设计卡 9 格，独立验收。进 0.25）

**改**

- `electron/shared/vendorFailure.ts` 收成唯一的上游归一，按通用字段判，不按供应商写分支：
  - 输入：HTTP 状态、`error.type`、字符串 `error.code`、`error.param`、`message`；
  - 输出：S1 的 problem；
  - 新增码：
    - `provider_balance_insufficient`：402，或 `type=payment_required`，或 `code=insufficient_user_quota`；
    - `provider_rate_limited`：429 或 `rate_limit_error`，可重试，带 `Retry-After`；
    - `provider_rejected_input`：400 / 422 或 `invalid_request_error`，`param` 进 `field`；
    - `provider_model_unavailable`：沿用现在的 `model_not_found` 一族；
    - `provider_auth`：401 / 403。
- 余额数字：`insufficient_user_quota` 的正文「current balance: $X, required: $Y」是 one-api / new-api 一族网关的统一措辞，不是某一家的。能按这个格式解析出来就带上 `balance` 和 `required`，解析不出就不带数字。用协调 11-08 的真实样本（协调 11-08 文字大脑一问一个的回执（本机，不入库；结果表见 docs/plan/2026-11-07-catalog-audio-text.md「一问一个结果」） 第 11 行）当夹具。
- `classifyError.ts:431` 的 `UPSTREAM_CODE_KINDS` 登记 `insufficient_user_quota` → balance。画布 narrate 的余额文案改成带数字、两个动作（去充值 / 换模型），不给重试。
- `electron/agentLane/laneModelProvider.mts:228–233`：openai 协议的大脑**总是**发输出上限。上限取「声明的 `maxOutputTokens`」和「lane 默认」中较小的那个。lane 默认值由设计卡定，依据是 39 题轨迹和 R2 轨迹里观测到的最长一次输出 × 2，不拍脑袋。
- 内置文本模型的声明：从公开价目接口（`GET /api/pricing/model?model=`，不要 Key）离线取 `limits.max_output_tokens`，写进声明。这是离线生成步骤，运行时不调。
- Agent 侧：`provider_balance_insufficient` 不重试，lane 直接停。给模型的正文是「Do not retry. The account cannot cover this model's pre-hold (balance $X, needs $Y). Tell the user both numbers; offer top-up or a cheaper model from list_models.」面板显示同一句本地话。

**删**

- `detectLegacyErrorKind` 里靠「余额 / balance / quota / insufficient」正则判余额和额度的那几支：上游归一已经按码和状态判了，正则只留给没有结构化字段的旧文本。完全删要等 S7。
- `laneModelProvider.mts` 里「openai 协议没配上限就不发」的那条分支。

**老用户**

- 已经存下的大脑配置没有 `maxOutputTokens` 的，按 lane 默认发。行为变化：以前不封顶，现在封顶。设计卡反例要证明最长的真实输出不会被截断。

**验收**

- [ ] 夹具：真实 402 样本 → `provider_balance_insufficient`，`balance=2.758154`，`required=40.048`，`retryable=false`。
- [ ] 反例 1：只有 402、没有 code 的响应 → 仍然是 balance，只是不带数字。
- [ ] 反例 2：429 + `rate_limit_error` → `provider_rate_limited`，可重试，不进余额。
- [ ] 反例 3：400 + `param: "size"` → `provider_rejected_input`，`field=size`。
- [ ] 反例 4：轨迹里最长的那次 `draft_shots` 输出，在新上限下没被截断（`finish_reason` 不是 length）。
- [ ] 画布和面板截图：余额不足那条，zh/en 各一张。
- [ ] 一次付费核对，由协调做：claude-fable-5.1 带上限发一次，余额约 $2.7 时不再 402。

**依赖**：S1 的 problem 形状。和 S3 无关，可以并行。

**热点**：`classifyError.ts` 14 天 9 个 fix（这一刀是第 10 个），`vendorFailure.ts` 2 个（第 3 个），概念「生成错误怎么说成人话」10 个（第 11 个）。文件本身到线，代批例外不适用，和 S3 一样要用户拍这份方向检查。本片的改法是换和删：码在抛出时写定，删掉正则认余额那几支，不再加新的认字规则。

---

## 0.26 及以后（不进 0.25）

| 片 | 做什么 | 删什么 | 依赖 |
|---|---|---|---|
| S5 预扣预检 | 选大脑、选模型时，用声明里的价目接口和余额接口（APIMart 是 `/api/pricing/model` 和 `/v1/balance`，写在供应商声明里，不写 `if apimart`）估预扣，比余额，不够就在选择器上提示 | — | S4 |
| S6 参数清单快照核对 | 协调带 Key 抓 `GET /v1/models?expand=parameters`，快照进仓，带日期。CI 把内置声明的字段、枚举、范围、默认值逐项和快照比 | 手抄的 body 字段表 | S3 |
| S7 查询和计价进声明 | 映射里声明查询的 `language` 跟界面语言走、`cost` 路径和 `expires_at`；画布遥测 `errorType` 改成读 problem 码 | `electron/vendor/cost.ts` 里按家写的表项；`classifyGenerationError` 的正则分类（等所有门都带码之后） | S1、S4 |
| S8 删引擎 B 的传输 | Run 路的 provider 统一走 `canvasTransportProvider.ts` 那层壳到 `runTask`（绞杀者模式最后一步），七项差异按方向检查 §6 的表逐条收掉，`engineDifferences.test.ts` 先改成「同一意图同一 body」再随 B 删除 | `apimartGenerationProvider.ts` 的传输部分（send / query / task id / 结果解析）；七项里的 multipart 拒收、antigravity 拒收、chat-image 回落；付费提交上 A 的指纹缓存 | S3 |
| S9 幂等键 | 映射按模型声明 `submit.idempotency`（来源：单模型 schema 端点），Run 门的 `providerIdempotencyKey` 接上 `Idempotency-Key`，409 三个码进闭合码 | — | S6、S8 |
| S10 真调用封印 | 「列表里有」不等于「能调用」：模型选择器显示最近一次真调用的结果和日期；`model_not_found` 的模型标灰 | — | S4 |

## 顺序

```
S0 ─┬────────────── S3 ──┬── (0.26) S6 → S9
S0b ┤（基线、S2 后、S3 后各跑一次）   └── (0.26) S8
S1 ─┼── S2
    └── S4 ── (0.26) S5、S10
            S7 在 S1 + S4 之后
```

可以同时开工的线：S0、S0b、S1 三条。S2 和 S4 在 S1 合入后开工。S3 在 S0 合入后开工。

**轮数**：每片最多 3 轮（实现加修补）。超过就停下来，回到这份方向检查重看，不再补。

## 量具和目标（0.25 切版前）

| 指标 | 基线（`b08df9ed6`，修前） | 目标（S1–S4 之后） | 量具 |
|---|---|---|---|
| 拼参数类错误调用 | 32 / 82 | ≤ 5 | S0b 重跑 + 逐站分类 |
| 报错没说清类 | 33 / 82 | 0 | 同上 |
| 工具写入成功率 toolWriteRate | 62.3% | ≥ 80% | 39 题评测 |
| 回合成功率 turnSuccess | 61.3% | ≥ 75% | 同上 |
| 官方字段类测试红格 | 待 S0 数出 | 0 | `officialWire.matrix.test.ts` |
| 线上 Agent 失败原因分布 | 没有量具 | 有：`agent.tool.failed.reason` | 0.25 发出后 `pnpm run intake:radar` |
| 线上画布 `input` 失败占比 | 20.3%（正则口径） | S7 之后改成码口径再比 | `generation.completed` |

## 推广到全局（交给全局普查线，不在本方案里做）

这条链的做法可以直接套到其它「两条路都在用的概念」上，每个概念配齐五样：

1. 一份声明；
2. 一个纯函数 owner；
3. 一个问题形状；
4. 一条对外部真相的类测试；
5. 一条按「这项工作的产物由谁写」数入口的门岗。

现在的 `door-map` 按符号名数，数不出「同一件工作 4 个名字」。全局普查线可以从「请求体里的某个键由几个函数写过」这种按产物数的口径入手。
