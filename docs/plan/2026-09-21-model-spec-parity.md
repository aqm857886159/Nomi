# 模型说明书对等 + 分级披露 + 参数值层设防（2026-09-21）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：现行 · 分支 `fix/model-spec-parity-20260921`（基线 `origin/main` @ 5f17a7d17）
> 用户拍板（2026-09-21）：①「MCP 不能重造一套，而是复用」②「分级披露，里外都要做」
> ③ Nomi **不计算任何 API 花费**——返回里不许编造金额；档案参数选项自带的 `priceLabel` 可原样带出，没有就不写。

## 0. 一句话

「这个模型接受哪些参数」今天在仓里有**三份互不比对的定义**，而对外 MCP 面**一份都拿不到**；
参数值层又在一个两面共用的函数里**静默丢弃**未知键。本刀把这三份收敛成一份「准入契约」，
两个模型面都从它投影（薄名单 + 单模型详情两档），并让参数填错**明确拒绝而不是无声丢掉**。

## 1. 真实摩擦（从用户那一刻倒推，D1）

外部宿主（Claude Code 当 MCP 宿主）里的 AI 想「用 Seedance 2.5 的 720p、不要声音，出一条 5 秒视频」。
它先 `nomi_read{target:"models"}`，拿回来的每行只有 `vendor/modelKey/kind/label/keyStatus/usable/statusReason/references`
——**没有模式、没有参数、没有变体**。它只能猜参数名。猜错了，`compileParameters` 把那个键
默默扔掉，计划照样「成功」，用户拿到的是一条**带声音的 1080p** 片子，而且没有任何一处报错。

应用内 Agent 不猜：`list_models` 返回的是完整 `AgentModelEntry[]`（modes/params/slots）。
**同一件事，两个入口的质量差了一个数量级。**

## 2. 类根因

### 2.1 「这个模型接受哪些参数」有三份定义

| # | 在哪 | 从哪 derive | 谁读 |
|---|---|---|---|
| ① | `src/config/modelArchetypes/**` 的 `ArchetypeMode.params`（`ModelParameterControl[]`） | 人工 curated 档案 | 渲染层 UI 参数面板；`buildAgentModelEntries`（`src/workbench/generationCanvas/agent/availableModels.ts:59-81`）→ 应用内 Agent 的 `list_models` |
| ② | `modelParameterSchema`（`electron/capabilityCore/moduleCatalogBootstrap.ts:36-55`） | `model.onboarding.fields` + mapping `create.defaultParams` | **花钱那道闸**：`compileParameters`（`electron/capabilityCore/executionContract.ts:111-131`）真正拿它校验 |
| ③ | `videoParameterSchema`（`electron/capabilityCore/mcpGenerationVideoResolve.ts:220-226`） | video 档案的 mode params（video 档案住 `electron/shared/videoCapabilities`，主进程够得到） | 同上，video 时**覆盖** ② |

对外 MCP 面（`ModelListingEntry`，`electron/catalog/modelCatalogListing.ts:25-49`）**一份都不投**。

后果是机械的：
- **video** 模型走 ③，模型面（①）与准入面（③）同源，大体对得上；
- **image / audio / 3d** 模型走 ②，而 ② 来自 onboarding 字段——**档案里有、onboarding 里没有**的参数键，
  应用内 Agent 会被 ① 告知它存在，`compileParameters` 却按 ② 判定它「不被支持」→ 静默丢弃。
  这条缝**没有任何测试或门岗在比**。
- 外部 MCP 面不知道任何参数名 ⇒ 100% 靠猜 ⇒ 100% 落进同一个静默丢弃分支。

### 2.2 参数值层不设防

`compileParameters`（两面共用）今天的行为：
- **未知键** → `droppedFields.push(...)` + `warnings.push(...)`，**继续**（值没了，调用照常成功）；
- 类型不符 / 不在枚举 → 抛 `ContractCompilationError`，但消息只说「不符合当前模型的声明」，
  **不说合法取值是什么** ⇒ 模型无法自纠（MCP 规范要求 tool execution error 要能让模型 self-correct）；
- **越界**（min/max）→ 根本没有判据：`ParameterField`（`moduleManifest.ts:5-10`）只有 `type/required/enum/description`；
- `variantId` 不存在或不属于该模型 → `compileExecutionContract:146` 只判「非空串」，不判存在性。

### 2.3 节点模型键写入不设防

`bindModelIdentity`（`electron/capabilityCore/canvasNodeFactory.ts:71-85`）注释自陈
「非法/未知值原样存——校验留在 UI」。外部 MCP 面走的正是这条路（`canvasGraph.addNodes` 只校验 `kind`），
UI 面压根不传 `vendor/modelKey`（`src/workbench/generationCanvas/store/canvasNodeActions.ts:77-88` 传的是已组装好的 `meta`）。
即「留给 UI 的那层校验」**对这条路不存在**。而 `canvasRead`（`canvasRead.ts:36-52` 的 `.strict()` 节点）
**不返回任何模型字段** ⇒ 写进去的错模型键连读都读不回来。

## 3. 范围

### 做
- **A** 一份「模型准入契约」owner + 两面分级披露（薄名单 / 单模型详情），两面同一份投影。
- **B** `compileParameters` 改成结构化拒绝（未知键 / 错类型 / 不在枚举 / 越界 / 错变体），
  错误里带**合法键清单或最接近的键**与**合法取值**；`droppedFields` 删除（记了没人读的字段不留）。
- **C** `bindModelIdentity` 校验模型身份（注入校验器，保持本文件零 import 的约束）；
  `canvasRead` 把模型标识与变体读回来（参数按需）。

### 不动
- 不动花钱闸的相位（`phase`/`action`/报价卡）与审批收据；
- 不动 `tools/list` 的工具**数量**（棘轮）——分级走既有 `nomi_read` 的 `target` 机制扩展，不新增工具；
- 不动 `src/config/modelArchetypes` 的归属（见 §6 残余风险）；
- 不计算、不显示任何金额。

### 回滚
单分支、按 A/B/C 分 commit；任一档出问题可单独 `git revert` 该 commit，
门岗基线（`check:vocabularies` 登记、`check:mcp-payload` 字节）在同 commit 内改，不跨 commit。

## 4. 验收门
1. 「这个模型接受哪些参数」的来源数：改前 3（+MCP 面 0）→ 改后 1 + 投影层；报告里给逐条清单。
2. A/B/C 各有先红后绿用例；B 覆盖未知键 / 错类型 / 越界 / 错枚举 / 错变体 / 合法跨模型残留。
3. **两面对等性测试**：同一模型经 `list_models`（内部面）与 `nomi_read{target:"model"}`（外部面）
   拿到的详情**逐字段一致**。
4. 两面模型清单字节数改前/改后各量一次；`tools/list` 总字节不增。
5. 真实模型数字（R13.3）：工具写对率 / 回合成功率改前 vs 改后，只到「计划/预览」为止，不下单。

## 先查别人（第 5 节 · R5⑤：外部也读写的契约）

**这条契约外部宿主也读写**（Claude Code / Codex 当 MCP 宿主时按它写参数），按 R5.5 三列表登记。

### 规范
- **MCP 2026-07-28 · Tools**（https://modelcontextprotocol.io/specification/2026-07-28/server/tools ，本人 2026-09-21 抓取全文）：
  - 错误分两类，**「Input validation errors (e.g., date in wrong format, value out of range)」明确归 Tool Execution Errors → `isError: true`**，
    且 *"Clients **SHOULD** provide tool execution errors to language models to enable self-correction."*
    → **我们的偏差**：今天未知键根本不报错（静默丢）。**偏差理由**：无。本刀消除。
  - `outputSchema` + `structuredContent`：*"Servers **MUST** provide structured results that conform to this schema"*；
    *"a tool that returns structured content SHOULD also return the serialized JSON in a TextContent block."*
    → 我们已是这个形状（`structuredContent.nomiRunData` 一族），新 `target:"model"` 沿用。
  - `tools/list` 支持分页与缓存、**要求确定性顺序**——但**规范里没有**「工具结果内部再分级」的机制。
    → 分级披露是**规范之上的设计模式**，不是协议特性；我们据此选择「不新增工具、在 `nomi_read` 的 `target` 里分级」。
  - Security：*"Servers **MUST**: Validate all tool inputs"* → C 与 B 都落在这条上。
- **Stateful Tools 一节**（同页，非规范性指引）：*"A call against an expired or unknown handle should return
  a tool execution error that says so, so the model can recover by creating a new one."*
  → 同构地，未知 `modelId`/`variantId`/参数键都该是「说清楚 + 给出路」的执行错误，而不是丢弃或泛化消息。

### 同类做法（分级披露怎么做）
- **Solo.io agentgateway**（https://www.solo.io/blog/mcp-progressive-disclosure ，本人 2026-09-21 读全文）：
  *"the gateway replaces the upstream tool list with two meta-tools (`get_tool` and `invoke_tool`)
  so clients see only a lightweight index"*；文中明说这是 **layered on top of MCP，不是协议的一部分**。
  形状 = 「薄索引 + 按名取详情」，与本刀的 `target:"models"` / `target:"model"` 同构。
- **Anthropic Skills 的结构**（同一模式的另一处实例）：名字 + 一句描述进上下文，正文调用时才载入。
- **MCP 社区综述**（https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices 与
  https://github.com/orgs/ModelContextProtocol-Security/discussions/3 ，检索所得、**未逐句复核**）：
  反复出现的建议是 *separate manifests from schemas*、`list_tools` / `describe_tool` 两级。

### 仓库里已有
- 外部 MCP 面已经是**投影形状**：`electron/capabilityCore/mcpGenerationToolCatalog.ts:22`（`.omit().extend()`）——
  本刀延用同一手法，不再手抄第二份。
- 档案→主进程的**既有桥**是 codegen：`scripts/gen-archetype-wire-defaults.ts` →
  `electron/catalog/archetype*.generated.ts`，带漂移门 `check:archetype-defaults`。本刀不新增第二种桥。
- 分级披露在本仓已有先例：`skills.list`（元数据，不含正文）/ `skills.read`（正文）——
  `electron/capabilityCore/dispatcher.ts:390-404`，注释原话「渐进披露，不含正文」。
  **模型目录照抄这个已被接受的形状**，不发明第三种。

### 反方 / 推翻
- 2026-09-18 的裁决（`docs/plan/2026-09-18-tool-layer-prior-art-verdict.md` §0）说「一份 schema 两个用途」，
  唯一「两份手写」的先例 Codex 已被量到漂移。本刀的三份参数定义正是那条裁决点名的形状。
- **不采纳**「给外部面另造一份模型详情、从档案 derive」的做法（同日 scratchpad `mcp-paid-path/PLAN.md` 的提法）：
  那会变成第四份。正解是接到**准入契约**这一份上——它才是真正决定成败的那份。

## 6. 残余风险 / 没做的

> **这一节的原内容（「本刀不做档案搬家」）已被下面 2026-09-22 的附录推翻——搬家做了。**
> 当前的残余风险以根因合同 `residual_risks` 为准。

---

# 追加（2026-09-22）：独立验收推翻两条判断 → 在本分支把 A 做掉

独立验收（报告见会话 scratchpad `verify-model-spec/REPORT.md`）用实测推翻了上面 §6 的两条：

1. **B 的真实保护面只有 video。** 真实目录里 149/156（95.5%）模块的 `parameterSchema` 为空；
   video 靠 `videoCompileOptions` 用档案覆盖了这份空表，image 58/61、audio 20/20、3d 5/5 **没有任何覆盖**，
   全部落进「放行并警告」。同一批 82 个模型实测：main 80/82 静默丢弃 → 本分支 82/82 **原样放行上 wire**。
   即对 95% 的模型，这一刀把「静默丢」换成了「静默转发」，**拒绝一次都没发生**；
   而 `contract.warnings` 全仓零读者——正是本刀自己杀掉的 `droppedFields` 形状。
2. **A 比 §6 说的便宜。** 42/42 档案文件是纯数据，0 个 import React/i18n/图标；
   35/35 对 `../modelCatalogMeta` 全是 `import type`、0 个值导入。
   **而那堵「i18n 墙」根本不存在**：`src/config/modelCatalogMeta.ts:4-14` 只是把
   `ModelParameterControl` 从 `electron/shared/videoCapabilities/types` **再导出**一遍；
   档案文件对它只取类型。所以「16k 行生成桥 / 先拆渲染层依赖」两条都不成立。

## A-1 搬家：范围、落点、引用、回滚

**照 PR #310（二期 video 档案归一）的先例。** 那次的做法与两条纪律：
- `docs/fixes/2026-09-02-archetype-video-registry-derivation.root-cause.json`：
  **搬迁探针**——把全部 `identifierPatterns` / variant `modelKey` / `legacyIds` × raw/lower/upper/
  `models/` 前缀/裸末段/带前缀末段共 1042 条语料，在新旧两个数组序上跑同一套三趟匹配**逐一比赢家**。
- **不留 re-export 转发壳**（那次专门删净 33 个）。

| 项 | 内容 |
|---|---|
| **搬哪些** | `src/config/modelArchetypes/` 整个目录：42 个非测试文件（`index.ts` 注册表+解析器、`types.ts`、`anchorPolicy.ts`、`customCapabilityContract.ts` + 38 个档案数据）＋ 17 个测试 |
| **落哪** | `electron/shared/modelArchetypes/`。与 video 的 canonical 家 `electron/shared/videoCapabilities/` 平级——两者都在中立契约层，渲染层与主进程**都** import 得到（`src→electron/shared` 是 R-B1 明确放行的方向） |
| **谁引用** | 85 处 `config/modelArchetypes`（61 个非测试文件）。**逐个改 import 路径，不留壳**。`src/config/modelArchetypes/` 目录删净 |
| **i18n 墙** | **不存在，无需处理**。档案对 `../modelCatalogMeta` 只有 `import type { ModelParameterControl }`，而那个类型的家本来就是 `electron/shared/videoCapabilities/types`。搬家后档案直接 `import type ... from "../videoCapabilities/types"`，**少一跳，不多一跳**。`modelCatalogMeta.ts` 的 `i18n`（10 处控件显示文案）留在渲染层不动——它服务的是控件**文案**，与档案声明无关。故档案层存的仍是机器可读标识，不夹带任何语言的文案 |
| **顺序风险** | `MODEL_ARCHETYPES` 数组字面量顺序**逐字不动**（这次是搬家、不是合并两份登记，与 #310 的风险来源不同）。仍按 #310 先例跑搬迁探针证明三趟匹配赢家 diffs=0 |
| **回滚** | 搬家自成一个 commit（`git mv` + import 改名，无逻辑改动）。回滚 = `git revert` 该 commit |

## A-2 搬完之后（这才是 A 本体）

- 准入层对 image/audio/3D **同样按档案声明校验**；「放行并警告」只留给真无声明的模型，
  且那条 warning 必须有**真实读者**（到达调用方的工具结果里），否则删。
- 两面同一条 `AgentModelEntry` 投影链 + 两面分级（薄名单 / 单模型详情）；
  MCP 走 `nomi_read` 的 target 扩展、**不新增工具**；`modelCatalogListing` 里重复的知识删除，
  `keyStatus/usable/statusReason` 并入后两面都有。
- **`AgentModelEntry` 补 variants**（验收：变体现在「可被拒、不可发现」）。

## A-3 做完之后的真实保护面（实测，不是估计）

搬家 + 准入接档案之后，对**真实种子目录**重新量了一遍「这个模型有没有可校验的声明」：

| kind | 有声明 / 总数 | 无声明 |
|---|---|---|
| image | 57/59 | 2 |
| video | 53/55 | 2 |
| audio | 18/20 | 2 |
| model3d | 4/5 | 1 |
| text | 1/15 | 14 |
| **合计** | **133/154 = 86.4%** | 21 |

**只看媒体模型：132/139 = 95.0%。** 改前是 **7/156 = 4.5%**（且那 7 个里没有一个来自档案，见下）。

剩下 21 个「无声明」：14 个是 **text/chat 模型**（本就没有媒体参数，`buildAgentModelEntries`
给它们的是一个 catalog 定义的 `chat` 壳模式）；7 个是媒体模型，它们的 `fal/*` 前缀键
档案匹配器认不出来。这 7 个仍走「放行 + warning」。

### 只读事实核查：`parameterSchema` 那条来源今天有没有真实使用者

（协调方 2026-09-22 追加要求。跑真实 `seedBuiltins` 目录 → `createCatalogModuleRegistry`。）

- 非空的是 **6 个**（协调方转述的是 7；我量到 6/154，差异应是解析出的模块集略有出入）：
  `apimart/MiniMax-H3-Context-IR`(text)、`agnes/agnes-image-2.1-flash`(image)、
  `agnes/agnes-image-2.0-flash`(image)、`agnes/agnes-video-v2.0`(video)、
  `agnes/agnes-video-2.5`(video)、`agnes/agnes-video-2.5-flash`(video)。
- **6 个的非空内容全部来自 `mapping.create.defaultParams`，没有一个来自 `model.onboarding.fields`。**
- 全部是**内置种子模型**（apimart / agnes 的 builtin 行）。
- 全目录：带 `onboarding.fields` 的 **0 个**；只有 `defaultParams` 的 6 个；两者皆无 148 个。

**结论**：「接入表单字段」这条来源在内置目录里**今天零使用者**——它只可能由用户/Agent
自己接入的模型填。故搬家之后的三类分工成立，但要如实写成：
**内置模型走档案（现在真的走通了）/ 用户接入的模型走 onboarding 表单字段（路径存在、内置目录里为空）
/ 两者皆无走放行并警告（剩 21 个，其中 14 个是本就无参数的 chat 模型）**。

**当初的设计意图**：`parameterSchema` 由 `c439c56ff`（2026-08-23，*feat: add generic runtime
module and asset boundaries*）引入，**没有配套的 docs/plan 方案文档**（全仓 `docs/` 里除本刀外
无任何文件提到 `parameterSchema`）；意图只留在代码注释
`electron/capabilityCore/moduleCatalogBootstrap.ts:44-46`：
「Mapping defaults are already user/catalog-owned declarations. They fill the schema only when
onboarding has no richer field description for that key.」
即 onboarding 字段本是**首选、更丰富**的那一份，defaults 只是兜底——而实测只有兜底那一条真正生效过。


---

## 第二轮验收之后的更正（2026-09-22）

**① 不要再拿评测数字当「参数拒绝有用」的证据。** 验收方用 10 句把非法取值/拼错键名
**写死在用户原话里**的题、4 组同日同会话共 40 个 run：**准入层一次都没被触发**——
因为 DeepSeek 先查 `list_models`，然后直接告诉用户做不到（「Seedance 2.0 最高只到 4k，没有 8k 这一档」）。
所以「被拒后改对的比例」用真实模型量不出来（分母为 0）。
**拒绝的价值是挡住不查目录、或不合作的调用方**，目前只有单测证据。

**② 我上一轮报的「MCP 面 6/8 建草稿（基线 0/8）」未被独立复现**（验收方两组都是 1/10，
题集不同、薄名单字段也不同，两边不可直接比）。**该数字作废**，只保留被直测证实的体积收益：
基线应用内 `list_models` 一次倒出 155 条 / **256,136 字符**；分支薄名单 **45,153 字符**、
单模型详情平均 **2,283 字符**（与我量的 266,904 → 42,281 同量级）。

**③ 声明覆盖的最终数字**（修完 `fal/*` 丢 meta 那个 bug 之后）：
**138/154 = 89.6%**，媒体模型 **137/139 = 98.6%**，无声明 16 个（14 个是 text/chat）。

---

## 集成期裁决（2026-09-22）：省略 vendor 时维持「拒绝」，不改成按排序解析

集成到 `integration/fixes-20260922` 时复核了一条尾巴：`resolveModelEntry`
（`electron/shared/agentCapabilities/modelSpecProjection.ts:118`）在「没传 vendor 且这个
modelId 名下有 ≥2 家」时是**结构化拒绝**（`ambiguous_model_vendor`），而不是按某个排序挑一家。
提出的改法是「按执行侧同一把尺解析出一家，返回 `resolvedVendor` / `otherVendors`」。

**实测下来这个改法今天做不了，因为仓库里是两把规则不同的尺：**

| | 实现 | 规则 |
|---|---|---|
| 执行侧 | `orderByVendorPreference`（`electron/shared/contracts/vendorPreference.ts:24`，调用点 `electron/catalog/executableModel.ts:105`） | 用户顺序 → 目录原序。**没有 `vendorTier` 这一级** |
| 渲染层 | `pickImplicitVendorMatch`（`src/config/modelIdentity.ts:174`，`vendorTier` 在 `:114`） | 用户顺序 → 官方 > 内置中转 > 自接 → 目录原序 |

而**真正决定「裸 modelId 落到哪家」的是渲染层那把**——计划写回时用的就是它
（`src/workbench/generationCanvas/agent/plannedNodeMeta.ts:76`、
`src/workbench/generationCanvas/agent/storyboardAnchorPolicy.ts:72`、
`src/workbench/common/useDedupedModelSelect.ts:394`）。

**实测数据**（真实 `applyBuiltinSeeds` 目录，156 个模型 / 152 个不同 modelKey）：

- 同名多家的 modelKey 只有 **4 个**：`suno-v5.5`（kie, apimart，同 tier1）、
  `MiniMax-H3`（apimart tier1, minimax tier2）、`eleven_v3` 与 `eleven_text_to_sound_v2`
  （elevenlabs, runway，同 tier2）。
- 两把尺在这 4 个上 **4/4 一致**，且在「默认无用户顺序」「用户顺序 `[kie]`」「用户顺序
  `[apimart]`」三档下都一致——因为同 tier 的那三个本来就退化成目录序，
  而 `MiniMax-H3` 的 tier 更优的那家恰好也排在目录前面。
- **分叉出现在用户自接中转那一档**，也正是 #832 要修的那个场景：给 `gpt-image-2`
  加一家自接的 `myrelay` 并让它排在目录前面 → 执行侧那把尺挑 **myrelay**，
  渲染层那把尺挑 **apimart**。

所以照「执行侧那把尺」实现，会让详情页说的供应商和计划真正会落到的那家在这一档上对不上，
等于把 #832 刚修掉的毛病换个地方再造一遍。

**裁决：本刀维持现状——省略 vendor 且同名多家时结构化拒绝并列出各家，`ambiguous_model_vendor` 保留。**
它已验收，且最差也只是让调用方多说一句话，不会悄悄给错说明书。

**待办（归属持有 #828 的会话，已排期）**：把两把尺收成 `electron/shared/` 里的一份
（注意本仓不留转发式 re-export，收尺时要一并改调用点）。收完之后，这里再改成
按那把唯一的尺解析，并在返回里给出 `resolvedVendor` 与 `otherVendors`。
