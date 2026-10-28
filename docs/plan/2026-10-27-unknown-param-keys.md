# 模型写进 parameters 的未知键 · 设计卡 + 方向检查

```
改动名：模型写进 parameters 的「这个模型不认识的键」——每一扇写入门当场拒，不再有静默丢的路
线/负责人：I-unknown-param-keys（Claude Sonnet）        类别：[花钱][Agent 行为]（不新增界面）
状态：卡已写；特征测试已落（全部绿，另有 2 条 it.fails 标已知缺口）；修缺口要碰的文件方向检查已命中 → 本线停在这里，等拍板（§3）
```

## 0. 一句话

协调的读码猜测是「起草 / 改草稿写入时不核参数键，模型新写的未知键会在下一次读盘时被 `normalizeStoredDraft` 当失效参数悄悄清掉」。**实查证伪了它的前提**：主进程的每一扇写入门（Agent 的 `draft_shots` 单镜 / 多镜 / 改草稿 / 改多镜里的某一镜，对外 MCP 的 create 三种写法与 plan 改草稿两种写法）落盘之前都已经过确认时用的同一个 `compileParameters`，未知键当场以 `unknown_parameter`（带 `allowedKeys`，近似时带 `closestKey`）拒回给模型，什么都不落、供应商 0 次。**但静默丢的路确实存在，只是在别处**：①文稿方案「改一镜」这扇门主进程不碰、渲染层只合并不核键（回 `ok:true`，用户卡上是默认值）；②写入门放行并落盘的「意图键」，第一次读就被读盘归一悄悄清掉；③对外 MCP 画布建节点带的 `params`，无渲染层时整份蒸发、有渲染层时按控件同名筛掉。①③要渲染层配合，②要改 `executionContract.ts` / `mcpGenerationVideoResolve.ts`——这几个文件近 14 天已有 4 / 2 个 fix，**方向检查命中（§6），本线按停点停在设计卡与回归测试**。

## 1. 现状实查（以 origin/main `93ac7e2c6` 为准，下面每条都有命令或 `文件:行`）

### 1.1 门表：谁在往 `parameters` 里写、写入时核不核

`node scripts/door-map.mjs <符号>` 的输出：

| 符号 | 门 | 说明 |
|---|---|---|
| `normalizeStoredDraft` | 写 1 扇：`mcpGenerationTools.ts:538` | 读盘归一**只有一个读点**，所有 capability 都经它 |
| `stripParametersNotAccepted` | 写 1 扇（2 处出现）：`generationPlanPatch.ts:93`（换模型残留）、`:172`（读盘归一） | 「清」的判据只有这一个函数 |
| `admitPlanCandidate` | 3 扇：`executionContract.ts:438`（合同编译）、`generationPlanPatch.ts:115`（改草稿）、`mcpGenerationTools.ts:285`（起草，`admitDraftParameters`） | 「拒」的判据就是 `compileParameters`，三处同一趟 |
| `mergeNamedParameters` | 2 扇：`generationPlanPatch.ts:102`（画布草稿）、`storyboardSubjectAdapter.ts:80`（**文稿方案**） | 合并规则是同一个函数，**准入没有跟着走**（第二扇没有 `admitPlanCandidate` 配对） |
| `buildPlannedNodeMeta` | 5 扇（渲染层落画布）：`landedShotIntent.ts:169`、`storyboardProjection.ts:42`、`storyboardComposerModel.ts:49`、`applyCanvasToolCall.ts:464`、`plannedNodeMeta.ts:214` | 落地的筛子：只认模式控件同名的键 |

按「模型能把 `parameters` 写进哪里」数（逐门一格，`✔` = 落盘前过 `compileParameters`）：

| # | 门（模型面入口 → 落点） | 写入时准入 | 证据 |
|---|---|---|---|
| W1 | `draft_shots` 单镜 / MCP create（一句话、显式 `candidate`）→ `admitSingleCandidate` | ✔ | `mcpGenerationTools.ts:306`；类测试「创建门」 |
| W2 | `draft_shots` 多镜 / MCP create `shots[]` / `scriptText`（继承共享 `parameters`）→ `admitDraftShots` | ✔ | `mcpGenerationTools.ts:289`、`mcpGenerationMultiShot.ts:391-418`；类测试「创建门」 |
| W3 | `draft_shots` + `operationId` 补新镜头（文稿方案 extend）→ `admitDraftShots` | ✔ | `mcpGenerationTools.ts:545-`；`docPlan` 测试「补镜头」 |
| W4 | `draft_shots` 改草稿 / 改多镜里某一镜 / MCP plan patch → `resolvePlanPatch` | ✔（仅当 patch 带了 `parameters`） | `generationPlanPatch.ts:111-115`；类测试「改草稿门」 |
| W5 | 同上，但草稿是**文稿方案** → `patchStoryboardAuthoring` → 渲染层 `patchAgentStoryboardDesign` → `patchStoryboardSubject` | **✘ 无** | `mcpGenerationMultiShot.ts:611-632`、`agentStoryboardDesign.ts:54-77`、`storyboardSubjectAdapter.ts:59-98`；`docPlan` 测试的 `it.fails` |
| W6 | 对外 MCP `nomi_canvas_edit.create_canvas_nodes` 的 `nodes[].params` → 无渲染层：`dispatcher.ts:588` 重建 `NodeSpec`；有渲染层：`applyCanvasToolCall.ts:464` → `buildPlannedNodeMeta` | **✘ 无**（前者整份蒸发，后者按控件筛、静默丢） | `canvasGraph.ts:60-71`（`NodeSpec` 没有 `params` / `modeId` / `variantId`）、`plannedNodeMeta.ts:163-180` |
| W7 | 分镜规划师 `propose_storyboard_plan` / `patch_shots` 的行级 `params`、`aspectRatio` | 另一个 owner（`storyboardShotScope.ts`，比例走 `aspect_ratio` 槽），本卡不展开 | 2026-10-05 卡 §5 已记账 |
| W8 | `nomi_try_model` 的 `params` | 不是起草；键由模型卡自己声明 | `modelOnboarding.ts:121` |

读侧：`normalizeStoredDraft`（`generationPlanPatch.ts:156-178`）只动 `state==="draft"` 的操作，对顶层候选和每一镜各清一遍「不在这个模型参数表里的键」，**落盘**；只有 `preview` 会把结果报成 `clearedParameters`（`mcpGenerationTools.ts:613`），`plan` / `present` / `gate_request` 一个字不说。

另一个要紧的事实：内部 Agent 的主路径是「`draft_shots` → `generate` 摆卡 → 用户点生成 → 交给画布逐镜提交」，**这条路不再编合同**（`compileExecutionContract` 的调用点只有 `preview`、`gate_request` 和多镜密封，`mcpGenerationTools.ts:592 / 642 / 652`）。所以写入那一次准入是这条路上参数键的主要一道闸，漏一扇门就没有第二次机会。

### 1.2 协调猜测对账

| 猜测（任务书） | 实查 | 判 |
|---|---|---|
| 拒绝器已有（`unknown_parameter`，带 `closestKey` / `allowedKeys`），但跑在编译合同时、离付费闸近 | 它**也**跑在写入时：`admitDraftParameters`（2026-10-18 起）与 `resolvePlanPatch` 都走 `admitPlanCandidate`。Agent 的 lane 文本和 MCP 的结构化结果里都带得出合法键与最近键 | 前半对、后半不成立 |
| `normalizeStoredDraft` 把「这个模型不接受的参数」清掉并落盘，本来给换模型 / 存量用 | 对（`generationPlanPatch.ts:156-178`） | 对 |
| 起草 / 改草稿写入时不拒，所以新写的未知键会被读盘归一悄悄清掉 | W1–W4 写入时都拒，未知键进不了草稿，读盘归一碰不到它。类测试逐门逐形状钉住，并用 4 个变异证明测试不是空转（§7） | **证伪** |
| 因此「静默丢」是读盘归一造成的 | 静默丢确实有，来源是 W5 / W6（门不拒，落画布时被筛）和意图键（§1.3 G2） | 方向对、位置错 |

### 1.3 真正的缺口（实测，不是读码）

**G1 · 文稿方案改一镜（W5）**：同一份写错的输入，create / extend 当场拒，patch 回 `ok:true`，未知键住进方案那一镜的 `params`。

```
pnpm exec vitest run src/workbench/creation/storyboard/unknownParameterKeys.docPlan.test.ts
  建方案 / 补镜头 写 motion_strength   → 拒（admission = unknown_parameter），方案保持原样      ✓
  改一镜 写 steps（模型声明过的键）     → ok，存进那一镜                                        ✓
  改一镜 写 motion_strength（没有的键） → ok:true，那一镜 params 里多了 motion_strength        it.fails（缺口）
  buildPlannedNodeMeta 落画布           → 节点 meta 没有 motion_strength，有档案默认的 size     ✓（后果）
```

为什么这扇门一直没人管：方案正本在渲染层（用户在编辑器里随时换模型），主进程手里那份候选是一次性作者载荷、会过期，按它判会判错——所以 2026-10-05 的卡把「文稿方案改一镜」标成「不并」，2026-10-18 的卡把它标成「不适用：生成走分镜 / 画布执行器，不经 `compileParameters`」。**「不经 `compileParameters`」不等于「不用核」**：模型说的键最终要么上线缆、要么该被拒，落画布的筛子只会安静地丢。`generation.parameter-admission` 概念（`docs/engineering/concept-owners/generation.parameter-admission.json`）的 `allowed_consumers` 里也没有 `storyboardSubjectAdapter` / `agentStoryboardDesign`，概念门岗看不见这扇绕过 owner 的门。

**G2 · 意图键：写入放行并落盘，第一次读就被清（读盘归一与写入准入是两个判据）**：`GENERATION_PLANNING_HINTS`（`cameraIntent` / `preferredFamily` / `preserveCharacter` / `quality` / `useReferenceAudio` / `durationSeconds` …）是 Nomi 推荐器读的、永不上线缆的键。`compileParameters` 认它们（按类型判，通过就放行、不进合同，`executionContract.ts:250-258`），草稿里存着；`stripParametersNotAccepted` 只看「在不在这个模型的参数表里」（`mcpGenerationVideoResolve.ts:322-339`），意图键永远不在表里。实测（`it.fails` 复现）：

```
draft_shots parameters:{resolution:"480p", cameraIntent:"pan", preserveCharacter:true}
  → 创建后落盘：{resolution, cameraIntent, preserveCharacter}
  → 第一次读是「改一句提示词」的 plan：changeset 里没有任何 clearedParameters，落盘变成 {resolution}
  → 第一次读是 preview：clearedParameters:["cameraIntent","preserveCharacter"]（唯一会说的一处）
```

后果：`videoRecommendationInput`（`mcpGenerationVideoResolve.ts:39`）在 preview 里读的是**读盘归一之后**的候选，模型写的意图一个都看不到；写入时给了「放行」，读时又悄悄丢——和协调担心的形状一模一样，只是丢的是意图键而不是未知键。

**G3 · 画布建节点的 `params`（W6）**：`plannedNodeSchema.params`（`canvasWrite.ts:68`）模型可写。无渲染层的 MCP 宿主：`dispatcher.ts:588-598` 把节点重建成 `NodeSpec`，`params` / `modeId` / `variantId` / `metadata` 都不在里面，回 `applied:true` 和一个真节点 id（同文件 :572-586 为 `artifact` 加过「拒收而不是建空壳」，`params` 没有）。有渲染层：`buildPlannedNodeMeta` 只认控件同名键，非法值回落默认，都不报告。只有对外 MCP 能走到（内部 Agent 的画布写动词收到生成类节点一律 `wrong_verb`，`writeVerbs.ts:67-90`），不在 `draft_shots` → 付费卡这条主路径上。**本线没写测试**（需要整套画布宿主夹具），只记账。

**顺带观察（不修）**：Agent 的 lane 文本里，`Next:` 说「Use a key from allowedKeys (prefer closestKey …)」，但 lane 的失败结构只带散文（`该模型此刻接受的参数键：…`、`最接近的合法键是 …`），没有叫 `allowedKeys` / `closestKey` 的字段（那是 MCP 的 `details`）。自纠不受影响（`draftSelfCorrection.test.ts` 绿），只是指引点名了一个这一面看不到的字段名。

### 1.4 特征测试（先写；全部一次绿，因为猜测的前提不成立）

```
pnpm exec vitest run electron/capabilityCore/unknownParameterKeys.class.test.ts \
                      src/workbench/creation/storyboard/unknownParameterKeys.docPlan.test.ts
  → 2 个文件：23 passed | 2 expected fail（G1、G2 各一条 it.fails）
```

`electron/capabilityCore/unknownParameterKeys.class.test.ts`（走真链：动词 schema → lane 翻译 → 传输适配器 → 规划 handler → 真 durable Run → 付费卡 → 交给画布 → 本机回环供应商，`vendor.executes` 记它真正收到的每一份请求）：

- 参照物取自共享边界本身（`compileExecutionContract`），不取自任何一扇门，各门才能分开红；
- 9 扇门同一份输入（近似键 `aspect_ratios`，真实键 `aspect_ratio`）：创建 5 扇 + 改草稿 4 扇，逐门断言 ①拒、②码和那句话与参照物逐字相同 ③不落草稿 / 草稿一字不动 ④不出卡 ⑤供应商 0 次 ⑥下一次读没有「清掉了什么」的痕迹；
- 远键（真实键叫 `size` 的模型被写了 `aspect_ratio`）：拒、列出合法键、**不编** `closestKey`；
- 真实档案（键由档案派生，注册表留空）：Z-Image 写 `aspect_ratio` 拒、Nano Banana 2 写 `aspect_ratio` 放行；
- 模型读到的就是拒绝本身：lane 文本含同一句话 + 「没提交没扣钱、改了再调」，MCP 结构化结果含 `closestKey`；
- 放行一侧：声明过的键起草 → 改草稿 → 摆卡 → 点生成，供应商收到的值与模型写的逐字相同；写入放行的键经预览 / 改提示词 / 摆卡三次读都在、也没被报成「清掉」；未声明参数表的模型原样带过（合同有告警、读盘不清、供应商收到原值）；
- 换模型残留照旧清并报（单镜、多镜里只换一镜），同一次 patch 里新写的未知键走「拒」不走「清」；存量旧草稿照旧清并报、第二次读不再有；
- `it.fails`：G2。

`src/workbench/creation/storyboard/unknownParameterKeys.docPlan.test.ts`：G1 的四格（见上）。

## 2. 根因三层

| 层 | G1 / G2 / G3 |
|---|---|
| 症状 | 模型说「把运动强度调到 0.5 / 保住同一个人」，回执是成功，用户卡上是档案默认 |
| 直接原因 | G1：文稿方案 patch 只合并不核键；G2：读盘归一的「允许键」少认了写入准入认的意图键；G3：画布建节点没有任何一处对 `params` 说话 |
| **类根因** | **同一个问题——「这个模型此刻接受哪些键」——有三份各写各的答案，且只有第一份会开口**：写入准入 `compileParameters`（声明键 ∪ 意图键 ∪ 未声明表放行，**拒**）、读盘归一 `stripParametersNotAccepted`（只认声明键，**安静地清**）、渲染层落地 `buildPlannedNodeMeta`（只认控件同名键，**安静地丢**）。凡是绕过第一份的写入（W5 / W6），后两份都会把键吃掉而不吭声；凡是第一份认、第二份不认的键（G2），写入放行、读时消失 |

「同类还能从别处回来吗」（按门表答）：能——**任何新开的、把模型写的 `parameters` 合并进某处的门**，只要不去调 `admitPlanCandidate`，就是 W5 的复制品；`mergeNamedParameters` 已经有 2 扇门而只有 1 扇带准入，就是这个形状。

## 3. 要怎么修（推荐）与本线为什么停在这里

补法按强弱（删掉 > 结构上做不出来 > 门岗自动拦 > 写规则文字）：

1. **G2（主进程内，最小）**：把「一个键对这个模型是什么身份」收成一个函数 `parameterKeyStatus(key, schema)` → `declared | planning-hint | undeclared-table | unknown`，`compileParameters` 和 `stripParametersNotAccepted` 都只调它（换成一个 `switch`，漏分支 tsc 红）：读盘只清 `unknown`。这是**换**不是补（同提交删掉 `stripParametersNotAccepted` 里那条自己的 `!(key in accepted)` 判据）。两条出路等价：读盘认意图键（推荐：preview 的推荐才看得到模型写的意图），或写入时就不存意图键；类测试里的 `it.fails` 写成与方向无关的不变量「写入落盘的，第一次读之后还是那一份」，任一条修好都会转绿。
2. **G1（要渲染层）**：判据搬家——`closestParameterKey` / `editDistance` / 拒绝构造从 `executionContract.ts`（它 `import node:crypto`，渲染层不能进）搬到 `electron/shared/`（**移动不是复制**），渲染层 `patchAgentStoryboardDesign` 在写入前用方案那一镜此刻的 `modelKey / modelVendor / modeId`（加上这次 patch 自带的覆盖）和 `shotModeControls` 算允许键，不认识的键回一个类型化回执 `{status:'parameter-rejected', rejection}`，主进程 `patchStoryboardAuthoring` 接到后抛 `ContractCompilationError`——于是 lane 与 MCP 两面拿到的和 create / extend 是同一句话。比例槽 `aspect_ratio`（`foldRatioIntoSlot`）仍是合法键。**风险点**：渲染层算出的允许键必须与主进程 `acceptedParameterSchema`（视频还有变体 / 供应商特化）同源，否则就是第二份判据——要配一条 parity 测试，对全档案目录逐 (模型, 模式) 比两边的键集；对不上的格要么修要么在这扇门上写明「判不了就放行并带告警」。
3. **G3（对外 MCP，另排）**：无渲染层时对 `params` / `modeId` / `variantId` 照 `artifact` 的先例拒收（`capability_unsupported`）；有渲染层时让 `buildPlannedNodeMeta` 把「丢了什么」报回去，而不是安静筛掉。
4. **门岗**：把 `mergeNamedParameters` 的调用点登记进 `generation.parameter-admission` 的 `write_api` / `allowed_consumers`，`check:concept-owners` 就看得见下一扇不带准入的门（现在它看不见 W5，因为 W5 不在名单里）。

**为什么本线不动手**：任务书的停点——「要改的文件本身命中 → 设计卡提交后停下」「要改 IPC / 工具合同形状 → 停下」。

- G2 要改 `executionContract.ts`（近 14 天 4 个 fix，这是第 5 个）和 `mcpGenerationVideoResolve.ts`（2 个，第 3 个）——文件本身命中；
- 也**不在未命中热点的 `normalizeStoredDraft` / `generationPlanPatch.ts` 里加一行「意图键别清」来绕开**：那是第三个特例分支（判据还是两份），正是 P1 要拦的补法；
- G1 要改 `capabilityApplyHandler.ts` 一侧的回执（近 14 天 2 个 fix，第 3 个；目录 11 个）并给 `storyboard.patch-design` 加一个回执变体——文件命中，并且我把「渲染层↔主进程请求/应答的回执形状」当 IPC 形状处理，不替协调决定它算不算；
- 工具的模型可见 schema 一个字不用改，`spendConfirmationRequirement` 不碰，不改落盘形状。

## 4. 九格（针对 §3 的修法；本线已落的只有 ★9 里的回归测试）

| 格 | 结论 | 证据 |
|---|---|---|
| ★0 先查别人 | 见文末「先查别人」 | 链接 / `文件:行` |
| ★1 用户怎么用 | 当我在 Agent 对话里说「第 2 镜加点运动强度 / 保住同一个人」，我想要写的这些键要么真的进了请求、要么当场被告知进不了，以便我付的钱对得上我说的话。步骤：①说出要求 ②Agent 写 `parameters` ③宿主按所选模型核键 ④不认识 → 拒绝回给 Agent（合法键 / 最接近的键）⑤Agent 改对再交或问我 ⑥卡上摘要读节点 ⑦点生成，请求里就是这一份。**不做**：给模型新字段（工具 schema 不变）、替模型猜键（远键不编 `closestKey`）、拒绝「没声明参数表」的模型（照旧带过并告警，R17）。**已知坑**：意图键不上线缆；`aspect_ratio` 在文稿方案里是比例槽、不是某家的键；判不了的不拒也不丢。**真实任务**：(a) Z-Image「16:9 海边日出」模型猜 `parameters.aspect_ratio`；(b) 多镜分镜第 2 镜写 `motion_strength`；(c) 文稿方案里「把第 2 镜加点运动强度」走 patch。**指标**：主——未知键在每扇写入门被拒的比例，目标 9/9 扇主进程门（量具：`unknownParameterKeys.class.test.ts`）+ 文稿方案 patch 门 0→1（量具：`docPlan` 测试的 `it.fails` 转 `it`）；质量——Agent 收到拒绝后下一轮改对（量具：`electron/agentLane/draftSelfCorrection.test.ts` 的脚本化模型，只读工具结果文本）；护栏——声明过的键放行率 100%、值原样到供应商（量具：类测试放行一侧）；真模型的工具写对率：**未验证：缺量具**（协调安排） | 上述测试路径 |
| ★1b 连带界面 | 不新增界面、不改文案。Agent 回执：拒绝正文是现有的 `ContractCompilationError` 句子（中文散文，R15 现状）+ 英文 `Next:`（`admissionRejectionHints.ts`，MCP 与 lane 同读）；MCP：`errorCode` + `details{at,allowedKeys,closestKey}`。付费卡 / 通知 / 任务列表不受影响 | `admissionRejectionReachesModel.class.test.ts`；类测试「模型读到的就是拒绝本身」 |
| ★2 谁说了算 | 概念「参数准入」`generation.parameter-admission`，owner = `executionContract.ts#compileParameters`；本卡把「key 的身份」收进它（§3-1），渲染层只是它的另一个消费者（§3-2）。同一份事实现在存**3 份**（写入 / 读盘 / 落地各一份允许键集），目标 1。没有靠「东西不见了」猜意图 | `door-map` 表（§1.1） |
| ★3 一致与复用 | 复用 `compileParameters` / `admitPlanCandidate` / `ParameterRejection` / `admissionRejectionHints`，不写第二个校验器；比例判据仍是 `electron/shared/aspectRatioValue.ts`。不为「渲染层不能 import node:crypto」另写一份——搬家 | `check:self-written`（`executionContract*` 在领域根里）；`git grep closestParameterKey` |
| ★4 全状态 | 空：没有未知键 → 无变化。加载：不适用（同步判）。成功：放行，值原样。失败：拒绝回给 Agent，不落草稿、不出卡、不扣费。部分成功：多镜里一镜写错 → **整份拒**（连写对的镜也不落）。取消中：不适用（起草阶段无在飞的任务）。过期：存量旧草稿读盘清残留并报。能力不可用（模型没声明参数表）：原样带过 + 合同告警——下一步是「用 `list_models` 里该模型自己的键」，**告警目前只在 `preview` / `gate_request` 的结果里**，内部 Agent 没有这两个动词，所以看不到（残余风险，§8） | 类测试放行一侧 |
| 5 中途表 | 判在同步的一次调用里，早于任何出价与派发：关窗 / 断网 / 重启 / 连点 / 按停——都是「调用随回合中止，没落草稿，不扣」；连点两次 `draft_shots` = 两份草稿（既有行为，与本刀无关）。草稿已落、卡未出：重开后读盘归一照旧，不扣 | 与 2026-10-05 卡 §4 同构 |
| 6 外部数据与失败 | 外部来源：模型写的参数键 / 值（MCP 2026-07-28「Tools · Error Handling」把输入校验错归为 tool execution error，客户端 SHOULD 交给模型自纠）；目录档案 / 注册表的参数表。偏差：我们对「没声明表」放行 + 告警而不是拒，因为证不出错就不许拒。失败用户看到什么：不甩给 key——拒绝文案只谈键与合法键 | 官方文档链接见「先查别人」 |
| ★7 性能 | 不适用：这是修 bug，不新增用户操作；每镜多一次键集合查找，同步、O(键数)，可忽略 | — |
| 8 真实条件 | Windows ✗（本线在 Mac）；英文界面 ✗；最小窗口：不适用；真规模：不适用；干净安装：不适用；**真付费：`unverified`**（本线不起真 App、不花钱）；键盘全程：不适用 | 协调另排 |
| 拍板图清单 | 不适用：不改界面 | — |
| ★9 验收与回滚 | 见 §7 | §7 |

### 功能分类

- [ ] 新界面 / 改交互
- [x] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

## 5. 同类入口与处置

| 入口 | 处置 | 理由 |
|---|---|---|
| W1–W4 | 已核，类测试钉住 | §1.1 |
| W5 文稿方案改一镜 | 待拍板（§3-2） | 渲染层拥有，要回执变体 |
| W6 画布建节点 `params` | 待排期（§3-3），只记账 | 仅对外 MCP；内部 Agent 走不到 |
| W7 分镜规划师行级 `params` | 另一个 owner，不并 | 2026-10-05 卡已记账 |
| 付费卡上改参数（`revisePendingSpend`） | 不适用 | 2026-10-24 起卡上不改参数 |
| 画布节点自己生成 | 不适用 | 引擎 A，不经草稿 |

## 6. 方向检查（RW）

`node scripts/fix-churn.mjs`（2026-10-28，对 §3 要改的文件）：

```
electron/capabilityCore/executionContract.ts            近 14 天已有 4 个 fix，这一刀是第 5 个
electron/capabilityCore/mcpGenerationVideoResolve.ts    已有 2 个，第 3 个
electron/capabilityCore/mcpGenerationTools.ts           已有 3 个，第 4 个
electron/capabilityCore/dispatcher.ts                   已有 3 个，第 4 个
src/workbench/capability/capabilityApplyHandler.ts      已有 2 个，第 3 个（目录 11 个）
src/workbench/generationCanvas/agent/plannedNodeMeta.ts 已有 2 个，第 3 个（目录 9 个）
概念「参数准入」                                         含 15 个文件，近 14 天 7 个 fix，这一刀是第 8 个
```

没命中：`generationPlanPatch.ts`、`generationPlanningParameters.ts`、`mcpGenerationMultiShot.ts`、`storyboardSubjectAdapter.ts`、`agentStoryboardDesign.ts`、`storyboardShotScope.ts`；本线自己的三个文件（两份测试、这张卡）未命中。

#### 复盘 0 · 一句话根因

「这个模型此刻接受哪些键」是一个问题，却有三份答案（写入拒、读盘清、落地丢），只有第一份会开口；凡是绕过第一份、或第一份认而后两份不认的键，都会静默消失。

#### 复盘 1 · 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 2026-09-22 参数准入收口 | 档案够不着 → 95% 模型空表放行 | 允许键集的来源不唯一 |
| 2026-10-05 比例 `aspectRatio` 被当意图键吞掉 | 意图键表里写了一个不该有的键，编合同时 `continue` | 意图键 ∈ 写入放行、∉ 读盘 / 落地 |
| 2026-10-18 起草不核参数值 | 只在 gate_request 才编合同 | 写入门漏掉准入 |
| 本卡 G1 / G2 / G3 | 文稿方案 patch / 意图键 / 画布建节点 | 同上，换了门 |

#### 复盘 2 · 为什么这一类会一直出现

准入是**每扇门自己记得去调**的函数，不是**合并参数这件事自带的**步骤：`mergeNamedParameters` 一个函数两扇门，准入只跟了一扇。「谁写参数」没有登记，概念门岗看不见新门。三条体验铁律落点：⑩ 说的=摆的（模型说的键 ≠ 请求里的键，没有一处会红）、⑪ 能选到（允许键集三份）。

#### 复盘 3 · 不改结构接下来会冒什么（可验证预测）

| 预测 | 怎么验证 |
|---|---|
| 下一次有人给某个渲染层写入口接 `mergeNamedParameters` 而不带准入，又多一扇静默门 | `node scripts/door-map.mjs mergeNamedParameters` 数门，对 `admitPlanCandidate` 的 3 扇 |
| 再有一类「写入认、读盘不认」的键（比如新增一个意图键）被读盘清掉 | 类测试的 `it.fails`（G2）；给 `GENERATION_PLANNING_HINTS` 加一个键即复现 |

#### 复盘 4 · 靶子独立性

类测试的参照物取自共享边界（`compileExecutionContract`）而不是门；断言的是落盘候选 / 供应商收到的请求，不是实现自己产出的中间值；4 个变异证明它们不是空转（§7）。没有评测分数参与。

#### 复盘 5 · P0

通用能力：「封闭对象拒未知键」（JSON Schema `additionalProperties:false` / Zod `.strict()`）——Zod 默认是**静默剥掉**未知键（`zod@3.25.76 v3/types.js:2053 unknownKeys:"strip"`），正是我们要避免的形状，所以信封全用 `.strict()`；但 `parameters` 的合法键集**因模型而异**，只能是每模型一张动态表。我们独有的：三档表来源（档案 / 映射 / 无声明）、意图键、null=未设、语义载体键、`closestKey`——这些是领域约束，不是 ajv 能给的。结论：不引第二个校验器，把现有这一个的「键身份」收成一处。`electron/capabilityCore/executionContract*` 在自写登记的领域根里。

#### 复盘 6 · 接入 / 补 / 重写 / 删

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 每个模型生成一份 JSON Schema（`additionalProperties:false`）交 ajv（仓库已有 8.20.0）核 | 要重写 null=未设 / 意图键 / 未声明表放行 / closestKey | 变成第二个校验器；还是要给渲染层一份 | 否 |
| 补 | 在 `patchAgentStoryboardDesign` / `stripParametersNotAccepted` 各加一个特例 | 小 | **第三个特例分支**——正是 P1 要拦的 | 否 |
| **重写（限「键身份」一处）** | `parameterKeyStatus` 一处，写入 / 读盘 / 渲染层都只调它 | §3 的 1、2 | 碰 3 个热点文件 + 回执变体，需拍板 | **是** |
| 删 | 删读盘归一 | 存量旧草稿、换模型残留没人清 | 破坏旧数据 | 否 |

#### 复盘 7 · 用户要权衡的核心

要不要为了让「文稿方案改一镜」也开口，给渲染层↔主进程的 `storyboard.patch-design` 加一个类型化回执（并把判据搬到 `electron/shared/`）；还是接受这扇门现在只靠「落画布时的诚实缺席」，只先修主进程内的 G2。推荐：两个都做，先 G2（小、主进程内、独立），再 G1。

## 7. ★9 验收清单与反例（动手前写全；本线已按它自验，附结果）

**验收（谁：另一条线，用什么：下面的命令，不得与实现线编号相同）**

| # | 检查 | 命令 / 位置 | 本线结果 |
|---|---|---|---|
| A1 | 主进程每扇写入门拒未知键：码、那句话、不落草稿 / 草稿不动、不出卡、供应商 0 次 | `pnpm exec vitest run electron/capabilityCore/unknownParameterKeys.class.test.ts` | 绿（创建 5 扇 + 改草稿 4 扇） |
| A2 | 同一份输入各扇门结果逐字一致（对共享边界的参照物） | 同上 | 绿 |
| A3 | 声明过的键放行，值原样到供应商 | 同上「放行的一侧」 | 绿 |
| A4 | 未声明参数表的模型：带过 + 告警 + 读盘不清 + 供应商收到原值 | 同上 | 绿 |
| A5 | 换模型残留照旧清并报（单镜 / 多镜里一镜）；同一次 patch 新写的未知键走拒 | 同上 | 绿 |
| A6 | 存量旧草稿照旧清并报，第二次读不再有 | 同上 | 绿 |
| A7 | 写入落盘的键，第一次读之后还是那一份（意图键） | 同上末尾 `it.fails` | **红（G2，修后转 `it`）** |
| A8 | 文稿方案改一镜写没有的键：拒、方案不变 | `docPlan` 测试的 `it.fails` | **红（G1，修后转 `it`）** |
| A9 | 画布建节点 `params`（W6） | — | 未验证：未写测试（需画布宿主夹具），记账 |
| A10 | 真模型的工具写对率 / 回合成功率（R13.3） | — | 未验证：缺量具，协调安排 |

**反例（改回旧行为必红；单文件内联改动、原样改回、改回后 `git diff` 为空，没有用 `git checkout -- <目录>`）**

| 变异 | 位置 | 结果 |
|---|---|---|
| M1a 去掉起草时的准入 | `mcpGenerationTools.ts` `admitDraftParameters` 函数体 | 8 红：创建门 5 + 远键 + lane 文本 + 真实档案；改草稿门 4 仍绿（它们有自己的准入） |
| M1b 去掉改草稿时的准入 | `generationPlanPatch.ts:115` | 5 红：改草稿门 4 + 「新写的未知键走拒不走清」；创建门仍绿 |
| M2 读盘归一也清新写的声明键 | `mcpGenerationVideoResolve.ts` `stripParametersNotAccepted` 的 filter 多一个键 | 8 红，含「读盘归一不碰新写的键」「声明过的键…供应商收到原值」 |
| M3 共享边界对未知键改成带过 | `executionContract.ts` `compileParameters` 未知键分支 | 14 红（所有门 + 参照物 + 真实档案），放行一侧大多仍绿 |
| M4（修 G1 后才有）去掉渲染层的核键 | `patchAgentStoryboardDesign` | A8 必须红 |
| M5（修 G2 后才有）读盘又只认声明键 | `stripParametersNotAccepted` | A7 必须红 |

**这一类会从哪些入口 / 形状 / 边界 / 版本回来**（按 `door-map` 答）：新的合并 `parameters` 的门（`mergeNamedParameters` 数门）；新增一个意图键；渲染层新增一个 `buildPlannedNodeMeta` 的调用者（现 5 扇）；换模型后的残留（已钉）；存量旧草稿（已钉）；注册表与档案的参数表来源不一致（本线用「注册表留空、键全由档案派生」那一格覆盖了档案来源）。**已知没覆盖**：create 与读盘分别用 `createDraftScope()` 与启动时抓的 `deps.registry` 两份目录快照（`mcpGenerationTools.ts:491` / `appIntegration.ts:207`、`:216`）；仅注册表来源（自接中转、无档案）的模型在会话中途改了映射时，写入认的键读盘可能不认——读盘解析不出模型时按「什么都不清」处理，所以最坏是漏清不是错清；未单测。

**回滚**：本线两个提交只加测试与文档，没有生产代码；`git revert` 两个提交即可，无迁移、无开关。

**花钱走查**：本线不改任何生产代码，没有新增付费走查；真付费抽检（`spend-paid-sample`）由协调决定豁免或安排。若 G1 / G2 的修法落地：免费演练 = 本卡的类测试与 `docPlan` 测试（供应商是进程内回环替身）；产物标记字面量 = 渲染层新拒绝回执的 `status` 字符串 `parameter-rejected`；专用工作树里跑。

**独立验收**：待协调派验收线。

## 8. 残余风险

- G1 / G2 / G3 都还开着（§1.3）。G1 是唯一一个 `draft_shots` 能走到的静默门。
- 「没声明参数表」的告警在内部 Agent 一侧看不到（只在 `preview` / `gate_request` 的合同里）：R17 要求的「明说」只做到一半。
- lane 的 `Next:` 点名了 lane 这一面没有的字段名（§1.3 顺带观察）。
- 目录快照两份（§7 末尾）。

## 先查别人

- **MCP 规范 2026-07-28 · Tools · Error Handling**（https://modelcontextprotocol.io/specification/latest/server/tools ，实抓）· 把「API failures、input validation errors（例如日期格式错、取值越界）、业务逻辑错」归为 tool execution error，以 `isError:true` 放在工具结果里；客户端 SHOULD 把它交给语言模型以便自纠；协议错误（未知工具、请求结构不合法）才走 JSON-RPC error，且「模型不太可能修好」· **确认了**：未知参数键是模型能自纠的输入校验错，必须作为带合法键的工具结果回给模型，不是协议错、更不是静默吞掉。同一节写着 Servers MUST validate all tool inputs。
- **Anthropic · Writing effective tools for AI agents**（https://www.anthropic.com/engineering/writing-tools-for-agents ，实抓）· 工具出错应返回具体、可行动的说明而不是晦涩码；参数名要无歧义（identifier 式命名）· **确认了**：`closestKey` / `allowedKeys` 和「远键不编」；也解释了顶层 `aspectRatio` 语义字段（各家叫 `size` / `ratio` / `aspect_ratio` 是歧义本身）。
- **Vercel AI SDK provider 规范**（`node_modules/.pnpm/@ai-sdk+provider@3.0.10/node_modules/@ai-sdk/provider/dist/index.d.ts:864-870`，本机实查）· 不支持的设置只发 `unsupported-setting` 警告，「The call will proceed … suboptimal results」· **改了**（反面先例）：这套对不花钱的预览合适，对按次付费的生成等于让用户按默认值付钱，所以我们拒而不是警告（2026-10-05 卡已采同一结论，本卡沿用并推到所有门）。
- **Zod 默认剥掉未知键**（`node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js:2053`，`unknownKeys: "strip"`，本机实查）· 生态里最常用的校验器默认就是静默丢 · **确认了**：模型面信封要 `.strict()`（仓库已如此），而 `parameters` 的合法键因模型而异，只能由每模型动态表在写入口核——不能指望 schema 层。
- **仓库内先例**：`docs/plan/2026-10-18-null-optional-params.md`（起草阶段过同一个 `compileParameters`；§同类入口表把文稿方案改一镜标成「不适用」——本卡 G1 修正这一条）、`docs/plan/2026-10-05-agent-aspect-ratio-semantic.md`（语义载体键 + 「静默吞掉」的前一次）、`electron/agentLane/draftSelfCorrection.test.ts`（只凭工具结果文本自纠的脚本化模型）· **确认了**写入口过同一判据的方向，**修正了**「文稿方案不适用」这一条。
- 模型可见工具必读（`docs/engineering/model-facing-tool-checklist.md`）逐项：技能 / 提示词里没有「未知键会被忽略」这类过期祈使句（`git grep` 过 `skills/`、`agent-skills/`、`lanePromptSections.ts`、`writeVerbs.ts`；`workbench-storyboard-planner` 写的是「不猜键、不静默换档」，与本卡一致）；拒绝文案带下一步（`admissionRejectionHints.ts`）；本刀不改动词声明，三道门岗（`check:model-schema` / `check:mcp-tool-refs` / `check:walkthrough-tool-args`）不受影响。
