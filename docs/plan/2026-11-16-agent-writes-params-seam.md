# 全图：档案 → Agent 写参数（交接处 `agent-writes-params`）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 2026-11-16，只画图，不改任何代码、文字、测试。登记在 `docs/engineering/seams.json`。
> 基准：`origin/main` 4218cd7fb。行号以这个提交为准。
> 这张图回答的问题：Agent 被拒时读到的那句话是谁写的、写给谁、字段名从哪来。
> 方向依据：`docs/plan/2026-11-15-archetype-single-entry.md`（档案一个口，已合入）；「Agent 只说想要什么、参数由产品替它落」那张设计卡目前只在一条没合入的分支上，见第 4、5 节。

## 0. 先看结论

1. 给 Agent 看的字有三个写字的人：**工具定义**（`writeVerbs.ts` / `readVerbs.ts`，字段名是真字段）、**拒收正文**（`generationProblem.ts`，宿主写的，用宿主的叫法）、**手写提示**（索引、压缩提示、模型指引，各自手写）。三者之间没有任何代码引用关系。
2. 主干上 Agent 能写出的模型身份有**两套位置**：平铺 `shots[].modelId`，和 `shots[].candidate.{providerId, modelId}`（顶层还有一份 `candidate`）。而 `list_models` 给它看的词是 `modelId` + `vendor`，**从来没有 `providerId`**。所以 `candidate.providerId` 的说明「Provider id from list_models」（`writeVerbs.ts:54`）指向一个读不到的词。
3. 拒收正文（`generationProblemModelText`）**应用内 Agent 与外部客户端共用同一个函数**，两张脸的字段名不一样，写字的函数不知道自己在跟哪张脸说话。
4. 回程没有「宿主词汇 → Agent 词汇」的翻译：拒收的字段路径（`candidate.modelId`）、模型标签（`供应商/模型`）都是宿主写法，Agent 抄不回去。

## 1. 全图（一步一行）

「面」一列：**内** = 只给应用里的 Agent；**外** = 只给外部接进来的客户端（MCP）；**共** = 两边读同一份。

### 去程：档案 → 模型清单 → 工具定义 → Agent 写出来的调用 → 宿主收下

| # | 这一步是什么 | 谁产出（文件:行 · 函数） | 谁读 | 身份 / 参数叫什么 | 面 | 现在谁守着 | 已知缺口 |
|---|---|---|---|---|---|---|---|
| 1 | 目录行 + 档案 → 模型条目 `AgentModelEntry` | 主进程 `electron/catalog/agentModelEntriesFromCatalog.ts:26 agentModelEntriesFromCatalog`；渲染层 `src/workbench/generationCanvas/agent/availableModels.ts:40 buildAgentModelEntries`（两处各一份，注释互相指认「同一条规则」） | 步骤 2、3 | 目录里叫 `modelKey` / `vendorKey`，条目里叫 `modelId` / `vendor`（`electron/shared/agentCapabilities/availableModels.ts:44`，类型注释写明 2026-09-18 改名的原因）；参数来自档案入口 `resolveModelArchetype(…, { variant: EVERY_VARIANT })` | 共 | `archetypeSingleEntry.structure.test.ts`（档案只走入口）；`modelSpecParity.class.test.ts` | 条目有两个生产者，靠注释保持一致，没有结构测试把两处的字段对齐 |
| 2 | 每回合注入的**索引 / 默认段** | `electron/agentLane/laneModelContext.ts:49 formatLaneModelIndex`；默认段 `:37`（「modelId: X，vendor: Y——仅供工具参数」）、`:43`（「必须在 modelId 里点名」）；当前对话文字模型 `:70`（`text vendorKey/modelKey`）；锚指引 `availableModels.ts:70 MODEL_ANCHOR_GUIDANCE`（「modelId/modeId 不能留空」） | 应用内 Agent（每条用户消息） | 索引行只有 `modelId`（+ 显示名），**不带 vendor**；默认段带 `modelId` 与 `vendor`；文字模型写 `vendorKey/modelKey` | 内 | `laneModelContext.test.ts`（逐字钉住旧句子）；`check-tool-face.ts` 量字数 | 同一个 id 两家都有时，索引只列一行、写不出是哪一家；三处手写了三种身份写法 |
| 3 | 模型清单工具 `list_models`（薄名单 / 单个详情） | 声明 `electron/shared/agentCapabilities/verbs/readVerbs.ts:159`（入参 `modelId` :169、`vendor` :170）；执行 `electron/agentLane/laneModelRead.mts:49`；投影 `electron/shared/agentCapabilities/modelSpecProjection.ts`（`resolveModelEntry :167`：同 id 多家且没给 vendor → `ambiguous`）；输出形状 `availableModelsSchema.ts:8`（变体 `modelKey` :30） | 应用内 Agent | 入参 `modelId` + `vendor`；行里 `modelId` / `vendor`；变体行里还有一个 `modelKey` | 内（`laneModelRead.mts` 注释称外部面 `nomi_read target=models` 是「同一个投影」，那边字段叫 `vendor` / `modelKey`） | `modelSpecParity.class.test.ts`；`check-model-schema.ts` | 变体行 `modelKey` 是第三个词；说明里「use the exact strings returned here」没说「哪个字段」 |
| 4 | 起草工具 `draft_shots` 的定义（**Agent 写参数的表**） | `writeVerbs.ts:32 draftShotSchema`：平铺 `modelId` :45、`variantId` :48、`modeId` :52、`candidate{providerId, modelId}` :53-56、`parameters`；顶层默认 `candidate` :202-205；说明里的示例 :278（`candidate: { providerId: "apimart", … }`） | 应用内 Agent | 模型身份两套位置：`modelId`，或 `candidate.providerId` + `candidate.modelId` | 内 | `check-tool-face.ts` + `tool-face-baseline.json`（字数）；`check-model-schema.ts`；`draftShotsProjection.test.ts`（只查发布 schema 的键） | `providerId` 在步骤 3 里读不到；两套位置谁赢由步骤 6 的投影决定（`draftShotsProjection.ts:96-99`，逐镜 `candidate` 赢平铺 `modelId`），Agent 看不到这条规则 |
| 5 | Agent 写出调用 → 入参边界（形状校验、错放字段提示） | `electron/agentLane/laneToolInputBoundary.mts:78 createLaneToolInputBoundary`（`prepareArguments` 之前一口收口）；字段行 `electron/shared/agentLane/toolInputIssues.ts`（`issuesFromZod :201`、近似键 `closestKey :71`）；错放字段对照 `electron/shared/agentCapabilities/draftFieldAliases.ts:8` | Agent（失败时读） | 字段路径**来自校验器**（真字段）；对照表手写：`model` / `modelid` / `modelname` → `modelId`（:11-13），`variant` → `variantId`；收到值截 32 字（`toolInputIssues.ts:30`） | 内 | `draftFieldAliases.test.ts`（值必须是 schema 里真有的字段，**改名后会红**）；`laneToolInputBoundary.test.ts`、25 条错写特征测试 | 对照表是手写的第二份字段名；32 字截断会把较长的模型名截半 |
| 6 | 语义镜 → 宿主候选（**唯一一处「模型面 → 宿主面」的翻译**） | `electron/shared/agentCapabilities/verbs/draftShotsProjection.ts:72 semanticsOf`（`:96-99` 拍平：`candidate.modelId` → `modelId`、`candidate.providerId` → `providerId`）；调用方 `electron/agentLane/laneVerbTransport.ts` | 宿主 | 出来是 `modelId` + `providerId`（宿主叫法） | 内 | `draftShotsProjection.test.ts` | 这里只拍平，**不查表、不判歧义**：写的名字对不对留给步骤 7 |
| 7 | 宿主收下 / 补全 / 拒收 | `electron/capabilityCore/mcpGenerationTools.ts:294`（`resolveCreateShots`）→ `electron/capabilityCore/semanticGenerationCandidate.ts`：具名模型找供应商 `:401 identityForNamedModel`（只写 id 时按注册表顺序**第一家取胜**，不判歧义）；找最接近 `:218 nearestCatalogModel`（:246 拼 `供应商/模型`）；`modelLabel :251`；无默认 `:469`；`candidate` 缺省文案 `:447`；变体 / 方式核对 `electron/capabilityCore/executionContract.ts:348,359,362`、`electron/capabilityCore/mcpGenerationVideoResolve.ts:154,191,202` | 应用内 Agent 与外部客户端（同一个宿主入口） | 宿主叫法：`candidate.providerId` / `candidate.modelId`，标签印 `供应商/模型` | 共 | `generationProblemCodes.test.ts`、`semanticGenerationCandidate.test.ts`、`scripts/check-verb-host-conformance.mjs`（查值到没到宿主） | `list_models` 会在同 id 多家时报歧义，这里却取第一家——**两个入口对同一件事两种答案** |

### 回程：拒收正文 → 面板上的失败行 → Agent 再读到 → 重试或熔断

| # | 这一步是什么 | 谁产出（文件:行 · 函数） | 谁读 | 身份 / 参数叫什么 | 面 | 现在谁守着 | 已知缺口 |
|---|---|---|---|---|---|---|---|
| 8 | 抛出一条带闭合原因的拒收 | `electron/capabilityCore/transportFailure.ts:64 refuseGeneration` → `GenerationRefusal`（正文由 `generationProblemModelText` 现写）；结构类拒收 `refuseArgument`（正文是抛出点手写的散文） | 步骤 9、10 | 事实字段 `GenerationProblem`：`code`、`field`（宿主路径，如 `candidate.modelId`，`electron/shared/generationProblem.ts:71` 注释）、`model`（`供应商/模型` 标签）、`nearest`、`allowed` | 共 | `generationProblem.test.ts`、`generationProblemCodes.test.ts` | `field` 与 `model` 是宿主词汇，没有「按脸翻译」的参数 |
| 9 | 给**模型**读的英文正文 | `generationProblem.ts:151 generationProblemModelText`：`unknown_model` :157（「Name a providerId/modelId exactly as list_models gives it」）；`no_default_model` 经 `PICK_MODEL_ACTION_EN :196`（「name its modelId (and providerId as listed)」） | **应用内 Agent 与外部客户端同读** | 句子里写 `providerId` / `modelId`；而应用内 Agent 读到的清单里叫 `modelId` / `vendor` | 共 | 无（测试只钉旧措辞，没有「文字里的字段名必须真存在」的检查） | 本处 `providerId` 在应用内面上是**不存在的词**（见第 2 节 ①） |
| 10 | `Next:` 下一步 + 信封 | `electron/shared/agentLane/laneFailureFromDecision.ts:57 laneFailureFromDecision`（`:98-103` 把 `GENERATION_PROBLEM_NEXT_ACTION_EN`（`generationProblem.ts:196` 起）套成 `Nothing was submitted … Next:`）；渲染 `electron/shared/agentLane/laneToolContract.ts:140 renderLaneToolFailure` | 应用内 Agent | 同步骤 9 | 内 | `laneFailureFromDecision.test.ts` | 同步骤 9；外部面另走 `electron/capabilityCore/mcpToolErrorResults.ts` |
| 11 | 面板上的失败行（**给创作者看，不给模型**） | `src/workbench/ai/lane/laneToolFailureText.ts:139 problemSentence`（按 `problem.code` 查词条）→ `src/i18n/locales/agentToolFailure.ts:55` 起（`problemUnknownModel: '没有这个模型，这一步没有执行。'` 等，zh / en 各一份） | 创作者 | 不印任何字段名 | 内 | `laneToolFailureText.test.ts`；`scripts/check-error-surface.mjs`（码表 ↔ 词典逐条对账） | 本行不泄露字段名，无缺口 |
| 12 | Agent 再读到 → 重试或熔断 | `electron/agentLane/laneRepeatedFailure.mts:83 createLaneRepeatedFailureTracker`（墙 = 工具 + 失败码 + 字段路径；同一堵墙连撞 `LANE_REPEATED_FAILURE_BLOCK = 3` 次拦下）；判在 `laneToolInputBoundary.mts:139` | Agent 下一轮 | 墙的身份用**失败码 + 字段路径**，不看正文 | 内 | `laneRepeatedFailure.test.ts`、`laneToolInputBoundary.test.ts` | 字段路径是宿主路径（`candidate.modelId`）；正文教错写法时，Agent 照改仍撞同一堵墙，3 次后被拦——熔断救得了循环，救不了「教错」 |

成功回执（`draft_shots` 的返回）：`writeVerbs.ts` 里 `draft_shots` 没声明 `outputSchema`（同文件的时间线、导出写动词有）。**未验证**：lane 在把宿主 `operation` 交给模型之前是否投影过；若没投影，成功回执里模型读到的也是宿主词汇。

## 2. 同一个东西在几处各手写了一遍

### ① 模型身份字段名与写法

| 写法 | 位置（主干） | 面 |
|---|---|---|
| `modelId` + `vendor` | `readVerbs.ts:169-170`、`availableModels.ts:44`、`modelSpecProjection.ts`、`laneModelRead.mts:49-70`（含 `vendorsForModelId`） | 内（清单） |
| `modelId` 平铺 | `writeVerbs.ts:45`、`draftShotsProjection.ts:96-98`、`draftFieldAliases.ts:11-13`、`writeVerbs.ts:146`（两处矛盾拒收 `modelId="…" and candidate.modelId="…"`）、`:231` | 内 |
| `candidate.providerId` + `candidate.modelId` | `writeVerbs.ts:53-56`、`:202-205`、示例 `:278` | 内（模型写）；宿主候选也是这个叫法 |
| `providerId/modelId`（斜杠） | `generationProblem.ts:157`；标签 `semanticGenerationCandidate.ts:246,251,256`；`executionContract.ts:348,359,362`；`mcpGenerationVideoResolve.ts:154,191,202` | 共（印进 Agent 读的正文，但 Agent 清单里没有这种写法） |
| `modelId (and providerId as listed)` | `generationProblem.ts:196`（再经 `laneFailureFromDecision.ts:99` 进 `Next:`） | 共 |
| `candidate.modelId`（字段路径） | `semanticGenerationCandidate.ts:256,469`；`generationProblem.ts:71` 注释 | 共 |
| `when candidate is omitted` | `semanticGenerationCandidate.ts:447` | 共 |
| `vendorKey/modelKey`（文字模型） | `laneModelContext.ts:70` | 内 |
| `modelKey/modeId/resolution`（压缩提示） | `electron/agentLane/laneContextBudget.mts:59` | 内 |
| `modelKey`（变体行） | `availableModelsSchema.ts:30`（`list_models` 详情里的 `variants[].modelKey`） | 内 |
| `vendor` / `modelKey` 当别名 | `electron/capabilityCore/mcpGenerationToolCatalog.ts:26-27,50` | 外 |
| 「把读侧的 vendorKey/modelKey 当成了生成侧的 providerId/modelId」 | `electron/capabilityCore/mcpToolErrorResults.ts:109-110`（zh / en 各一份） | 外 |
| `modelId=` 列表行 + 「modelId 必须用上面列出的」 | `availableModels.ts:95,101`（`formatAvailableModelsForPrompt`） | 内 |

### ② 「怎么点名模型」的句子

有 5 份手写：`generationProblem.ts:157`、`:196`；`laneModelContext.ts:43`；`availableModels.ts:71`（`MODEL_ANCHOR_GUIDANCE`）；`readVerbs.ts:163`（「Never invent a modelId — use the exact strings returned here」）。它们之间没有引用关系。

「改名后会红」的守卫只有一条：`draftFieldAliases.test.ts`（对照表的值必须是 draft schema 里真有的字段）。其余地方改了字段名，不会有任何测试因为**文字里还写着旧名**而红。

### ③ 守着文字的东西

- 守**措辞**：`laneModelContext.test.ts`（钉住索引句子，如 `:38`）、`generationProblemCodes.test.ts`（钉 `field: "candidate.modelId"`、标签 `供应商/模型`，如 `:66`）、`generationProblem.test.ts`（样本同样用宿主路径与标签）。守的是句子没变，不是句子真。
- 守**表格（schema）**：`check-tool-face.ts`（字数）、`check-model-schema.ts`、`draftShotsProjection.test.ts`、`check-verb-host-conformance.mjs`（值到没到宿主）。
- **没有任何东西**检查「给模型看的字里出现的字段名，在这张脸的字段定义里真有」。

## 3. 这处交接近 14 天的修补

命令（路径取 `seams.json` 里这一条登记的前缀；`mcpGenerationTools`、`shotDraft`、`src/workbench/ai/lane` 这类不带斜杠的按前缀匹配）：

```
git log --since="14 days ago" --oneline -- 'electron/agentLane/*' 'electron/shared/agentLane/*' \
  'electron/shared/agentCapabilities/*' 'electron/capabilityCore/mcpGenerationTools*' \
  'electron/capabilityCore/shotDraft*' 'src/workbench/ai/lane*' \
  'src/workbench/generationCanvas/agent/*' 'tests/ux/agent-param-eval*'
```

结果：**52 条**（含合并提交与测试线）。原样标题：

```
b83182295 refactor(archetypes): 档案表不再从入口导出，测试与脚本改走入口
d0b4a669a refactor(archetypes): Agent 侧改走档案入口，删模型详情的手搓特化链
842503f75 refactor(archetypes): 渲染层改走档案入口，档必传
2d8bdead0 feat(generation): 发送前一处通用判定：方式缺必需输入 / 依赖的槽没有 / 选项要的槽没有，两个发送口都拒
10fef6de0 chore(dead-code): 删掉没人用的产品模块，共 26 个文件、约 1120 行
f2c0da8ed Merge origin/main into feat/storyboard-strips-land
ba69f4086 fix(save): 隔离区先写、原子写、不截断；改名不再改写内容；打开时也提示，那句话重写成人话
143f9948d fix(save): 临时目录改走 makeTempDir；逃逸账本结账、类级矩阵测试
773838150 fix(save): 一处不合格不再让整个项目存不下来（写口自己拒收 + 存盘读盘逐项隔离）
325237525 feat(mode): the mode is computed from the inputs and shown in the bottom bar
c667d9d34 chore(wip): renderer reads the mode from inputs; machine mode switches deleted [存档点，测试未全绿]
7e4d35936 Merge pull request #1484 from aqm857886159/fix/text-selection-action-b
c78c1e7b8 fix(skills): 技能名在气泡小签和「已载入技能」两处走同一份 key 查找，不再印 key
8acd4bfb0 fix(creation): 选区浮条动作收成一张表一条分派；「拆成镜头」按样张 B 换分镜图标、挪到「AI 编辑」右边
d636e9efd refactor(params): consolidate existing normalization policies without changing behavior
32e369a80 Merge origin/main into feat/storyboard-strips
df30d61da Merge pull request #1447 from aqm857886159/test/agent-param-eval
cf88c69ec Merge pull request #1455 from aqm857886159/test/perf-probe-flake
53c454ee7 Merge remote-tracking branch 'origin/main' into test/agent-param-eval
a51215157 test: seed draft fixtures before their first renderer session
f2524e382 test: remove diagnostic work from unit performance gates
a49655655 test: separate missing undo history from agent failures
80bb14c0b test: fail dry runs on missing test-stage evidence
bbeb3312a test: complete approval driver locator fixture
59aed847b test: separate model-dependent evaluation results
60ee7f06f test: answer draft approvals from declared task intent
bba3ba588 test: seed fixed native drafts before parameter evaluation
86a9953da test: correct parameter evaluation acceptance and readback
67be4fc91 fix(agent): name an available model when drafting without a default
eb44f5ba9 fix(agent): shorten model guidance and capture bilingual refusal details
000b847ca fix(agent): report variant-specific controls in model details
b143fb0aa Merge remote-tracking branch 'origin/main' into test/agent-param-eval
e2a05bae4 refactor(agent): structural refusals use the refuseArgument shorthand
16b8a9cd1 fix(agent): give every drafting refusal a closed reason code
c5d57d125 Merge pull request #1435 from aqm857886159/fix/agent-tool-failure-boundary
79283fecb Merge remote-tracking branch 'origin/main' into fix/prompt-outbound-description-2
4d6a093cb refactor(agent): 熔断记数收进入参边界一处（settle / prepare），宿主瘦回冻结线以下
02fba146c fix(agent): 准备步骤里的拒收也走入参边界；执行层第 3 次带上「停」；25 条错写特征测试
dd48d2298 fix(canvas-agent): 删掉 applyCanvasToolCall 里吞掉字段的第二次校验
7bc8d14f2 feat(telemetry): agent.tool.failed——工具失败的匿名计数，只有五格标识符
e9093aa79 fix(agent): 准入层拒收的字段事实并入同一份清单，两个出口一起带
cdb2d35e1 fix(agent-panel): 工具失败行说「哪个字段 · 该填什么」，删掉按英文正文猜的老路
f40fb22ce fix(agent): 工具入参失败走一个边界——一份清单、一个正文、形状错也进熔断
b08df9ed6 test: 参数题库走查的回项目库标签不抄词典文案
52570a85a test: 参数题库走查把宿主配置目录隔离到临时 profile
58e17bc39 test: 参数题库走查的轮询间隔用常量，过 check:walkthroughs
6010b818f test: Agent 参数/重试真 App 走查（读题库、逐题记轨迹、三个数）与夜跑排除登记
4e799766f test: Agent 参数/重试判分器与阳阴性对照
5927a8656 docs: Agent 参数/重试测试集短版设计卡与题库
a861ea844 fix: 用户给了提示词原文，Agent 逐字落；起草工具的骨架与风格词要求只在由 Agent 来写时适用
283eb55f2 fix: 参考卡测试与注释跟上「正文就是描述框里的字」
f9489e888 fix(storyboard): keep per-shot controls and one film aspect
```

其中直接动到「给 Agent 的身份字段文字或拒收句子」的有 4 条：`16b8a9cd1`、`67be4fc91`、`eb44f5ba9`、`000b847ca`；动到入参边界 / 字段行的有 `f40fb22ce`、`02fba146c`、`e9093aa79`、`cdb2d35e1`、`4d6a093cb`。前一组是「改这一句话的意思」；没有哪一条改过「这句话里的字段名从哪来」。

## 4. 分支上已改、主干还没有

比较对象：一条尚未合入的分支（单句柄那一刀，`origin/refactor/agent-single-model-handle`，与主干的共同祖先 9e63cad06）。以下在主干上**都还不存在**：

| 项 | 分支上 | 主干 |
|---|---|---|
| 模型完整名字生成 / 查表 | 新增 `electron/shared/agentCapabilities/modelHandle.ts`：`modelHandleOf`（`modelId@vendor`）、`resolveModelHandle`、`nearestModelHandles` | 没有这个文件，没有 `modelHandleOf` |
| `draft_shots` 上点名模型 | 平铺 `modelId`、`candidate`（逐镜与顶层）、关键帧上的点名合成**一个** `model` 字段 | 两套位置（步骤 4） |
| 名字拆回宿主身份 | `draftShotsProjection.ts` 新增 `resolveDraftShotModels`：查不到 / 多家只写 id 时当场拒收并给完整名字 | 步骤 6 只拍平，不查表 |
| 索引 / 默认段 / 失效行 | `laneModelContext.ts` 用 `modelHandleOf` 生成 | 步骤 2 手写 `modelId` / `vendor` |
| `list_models` | 行与详情带 `model`（完整名字）；外部面导出字节不变 | 步骤 3 |
| 门岗 | `modelHandle.structure.test.ts`（别处不许自己拼 / 切 `id@vendor`）、`check-verb-host-conformance.mjs` 扩 `model`、`modelSpecParity.class.test.ts` 扩 | 无 |
| 设计卡 | `docs/plan/2026-11-15-agent-intent-landing.md` | 无 |
| **分支上也没动** | `generationProblem.ts:157,196`、`semanticGenerationCandidate.ts` 的标签与路径、`executionContract.ts`、`mcpGenerationVideoResolve.ts`、`laneContextBudget.mts:59`、变体行 `modelKey`、32 字截断、`identityForNamedModel` 的「第一家取胜」 | 同上，仍在 |

分支合入后，本图的步骤 2、3、4、5（对照表的值）、6 要重画；步骤 7-12 不变。

## 5. 「Agent 意图落参」方向已落与未落

方向：Agent 只说「哪个模型 + 想要什么」，参数由产品替它落（用户已按推荐拍板）。

| 刀 | 内容 | 状态 |
|---|---|---|
| 前置 | 档案一个口 `resolveModelArchetype`（`docs/plan/2026-11-15-archetype-single-entry.md`），Agent 侧模型详情改走入口 | **主干已合入**（`d0b4a669a`、`842503f75`、`b83182295`） |
| 1 单句柄 | 镜头上模型只有一个名字，删三处重复和半个名字的索引 | **只在分支上**，没合入 |
| 2a 连线类落地 | 方式由参考推（`modeForInputs`，主干已有 `electron/shared/modelArchetypes/modeForInputs.ts:144`），删 Agent 路另算的 `videoModeForPlan`（`mcpGenerationVideoResolve.ts:185`）、`modeId` / `taskKind` 二选一、渲染层静默换默认 | **没做**（主干 `videoModeForPlan` 仍在） |
| 2b 值摆不成原样 | 取最近的、付钱前写明（用户已定「甲」） | **没做**；界面半等确认卡展示方向 |
| 3 上下文减肥 | 删重复工具首句、语言规则尾份、过时指引 | **没做** |

## 6. 还没定的事（只列问题）

1. 拒收正文要不要按「面」渲染（应用内 / 外部各一份），还是宿主只交结构事实、字写在各面？
2. 「文字里出现的字段名必须在这张脸的字段定义里真有」这条检查，名单是人列还是从已发布的 schema 生成？
3. 步骤 6 / 7：只写 id 且多家都有时，应用内 `list_models` 报歧义、宿主却取第一家——两个入口以哪个为准？外部客户端的这个行为要不要一起变？
4. `draft_shots` 成功回执里模型读到的是不是宿主词汇？（本图未核到）
5. 平铺 `modelId` 与 `candidate` 两套位置：分支把它们合成 `model`；合入前，主干的 `candidate.providerId` 说明（`writeVerbs.ts:54`）指向读不到的词，是否在合入前单独处理？
6. 拒收里「收到的值」截 32 字，与分支合入后的完整名字（`modelId@vendor`）长度的关系，是否要调？
7. 渲染层 `buildAgentModelEntries` 与主进程 `agentModelEntriesFromCatalog` 两个条目生产者，是否要有结构测试对齐字段？
