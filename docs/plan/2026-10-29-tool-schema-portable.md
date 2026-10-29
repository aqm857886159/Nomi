# 设计卡：模型可见工具 schema 的可移植子集

类别：外部工具契约兼容性修复；状态：调研完成，命中不能等价替换的停点，尚未实施。

## ★0 先查别人

核对日期：2026-10-29。以下区分「请求接受某种 schema」与「严格解码保证约束成立」，不把两者混成支持。现有工具入参校验、业务语义和工具数量均不应因兼容修复改变。

- [OpenAI Function calling](https://developers.openai.com/api/docs/guides/function-calling) 与 [Structured Outputs / Supported schemas](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas) · 函数参数采用 JSON Schema；严格模式根必须是 object，不能是根 anyOf；支持基本类型、枚举、字段级 anyOf、items 对象、数值界、数组长度和本地引用（包括递归）。严格模式另要求属性全部 required、对象 additionalProperties:false · **确认了**根对象与单 schema items；**改了**判定口径：严格模式不是所有普通工具声明的共同规范，不能据此无条件允许递归，或把 optional 全改 required。
- [Google Gemini Function calling](https://ai.google.dev/gemini-api/docs/function-calling)、[官方 SDK Schema](https://googleapis.github.io/js-genai/release_docs/interfaces/types.Schema.html) 与 [OpenAPI 3.0.3 §4.7.24](https://spec.openapis.org/oas/v3.0.3.html#schema-object) · Gemini parameters 是 OpenAPI 子集，列出 type、properties、required、enum、items 单 schema、anyOf、default、description、pattern、min/max 等；未列 $ref、propertyNames、exclusiveMinimum、additionalProperties。OpenAPI 本身要求 items 是对象，type 是单字符串，且不支持未列出的 JSON Schema 扩展；不能把整个 OpenAPI 能力当成 Gemini 子集 · **确认了**必须拦 tuple items 数组与 prefixItems；**改了**现有注释中「Google 任何位置不支持 anyOf」的笼统判断，官方 Schema 现在列出了它。$ref 与动态 record 不能从 OpenAPI 总规范推导为 Gemini 支持。
- [Anthropic Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools) 与 [Structured outputs / JSON Schema limitations](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations) · 普通 input_schema 是 JSON Schema 对象，示例使用 properties、required、字符串 enum。严格工具的 grammar 管线另有限制：不接受递归，不支持数值界/字符串长度，minItems 仅 0/1，additionalProperties 只能 false · **确认了**普通工具 schema 与严格模式必须分开核实；**改了**“共同支持”不能直接取各家 strict 功能交集，否则任务指定的 length(2/3) 本身也不满足交集。
- [小米 MiMo 官方 OpenAI Chat Completions API](https://mimo.mi.com/docs/zh-CN/api/chat/openai-api) · 找到了公开 function tools 文档：parameters 是 JSON Schema object；strict 默认为 false，strict:true 仅支持一个子集；未找到公开的逐关键字/形状支持表。tool_choice 仅支持 auto · **确认了**探针使用 auto，不强制工具选择；**改了**证据措辞：不能宣称从官方公开表证明 tuple 或 $ref 在该网关必拒，需要真实请求数字。用户报告的 HTTP 失败与本地生成 tuple 是两条证据，尚未构成供应商端因果复现。
- [仓库模型可见工具必读](../engineering/model-facing-tool-checklist.md)、[pi 对照报告](../research/2026-10-01-pi-coding-agent-reference-conformance/report.md)、[单一生成与判据](../../electron/shared/agentCapabilities/modelVisibleJsonSchema.ts) · 生产与棘轮共用转换器和兼容性函数，不能在脚本另写一套判据；generationJsonValueSchema 明确支持任意深度 JSON · **确认了**唯一判据 owner，**改了**实施顺序：必须先处理无法等价表达的存量合同，不能靠放行或删约束凑全绿。

### 标准链接 / 我们的偏差 / 偏差理由

| 标准链接 | 当前偏差 | 偏差理由 / 本次判断 |
| --- | --- | --- |
| [OpenAPI Schema](https://spec.openapis.org/oas/v3.0.3.html#schema-object) | window 使用 items 数组；vec3 源 schema 也是 tuple | 非领域需求，只需同质定长数字数组；可换 z.array(...).length(n)，不改变运行时 JSON 数组形状 |
| [Gemini Schema](https://googleapis.github.io/js-genai/release_docs/interfaces/types.Schema.html) | $ref、propertyNames、数值 exclusiveMinimum，以及 additionalProperties/$schema 不在列出的 Schema 字段内 | 现有判据只盯根 union 与 const，没有维护明确的协议子集；必须逐形状审查，不能直接加入白名单 |
| [OpenAI Strict](https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas) | 存量有 optional、开放 record、default；未统一变成全 required / 全封闭对象 | 当前不是全工具 strict 模式；硬套 strict 会改变业务合同，本次禁止这样做 |
| [Anthropic Strict](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations) | 现有数值界、长度界、递归和开放 record 不是 strict 共同子集 | 普通 input_schema 与 strict 两种支持面不同；必须先明确目标支持面，不能声称定长数组可在所有 strict 管线强制成立 |
| [MiMo Function tools](https://mimo.mi.com/docs/zh-CN/api/chat/openai-api) | 没有公开逐关键字支持表可交叉证明白名单 | 保留未验证，真实整份清单探针交协调；不以兼容品牌或搜索摘要代替标准 |

### 生产盘点（先生成，后判断）

使用生产 `toModelVisibleSchema`、目录声明、pi 工具工厂与 `laneRequestToolDefinition` 生成 Agent 30 个工具；MCP 使用 `MCP_TOOL_RESOLVER.list()`，24 个工具。共 54 个 profile/tool 条目，20 种关键字。没有手写工具参数 schema，也没有执行任何工具。完整关键字 → 工具表与 JSON 指针随交接报告提供。

| 关键字 / 形状 | 实际工具（摘录） | 标准判断 |
| --- | --- | --- |
| type / properties / required / description / 字符串 enum | 普遍使用；核心/原生/pi/MCP 均覆盖 | 普通工具声明的保守核心；type 数组、复杂 enum 值等形状不能借同名关键字过门 |
| items 对象 / minItems / maxItems | arrange_canvas、stage_shot、draft_shots、edit_timeline 等 | OpenAPI 同质数组；strict 的长度约束支持另算 |
| items 数组 | stage_shot 的 plan.blocking.window、plan.shots.window、edits 中两处 window | 不可移植；已生成 4 个具体指针。源码 vec3 另有 tuple；当前整清单生成产物只观察到 window 四处，仍需同类替换和存盘回归 |
| minimum / maximum / minLength / maxLength / pattern | 多数领域工具；pattern 在 stage_shot 与 MCP nomi_read | 普通 JSON Schema 与 Gemini Schema 有对应字段；不能推成全 strict 都支持 |
| anyOf | stage_shot、draft_shots、MCP nomi_operation_plan | 字段级 union；Google 当前 Schema 列出，不能一概判为不支持；null 分支仍需按形状核对 |
| default | stage_shot、MCP nomi_read / nomi_canvas_edit / nomi_operation_plan | Gemini 列出；普通 input_schema 与 strict 要分开；不可盲删执行默认值 |
| additionalProperties | 47 个条目，其中既有 boolean，也有 schema 值 | Gemini legacy Schema 未列；typed record 不是附带元数据，删除会放宽值域 |
| $schema | 22 个内部领域工具的根 | 转换器的 draft-07 标记；不是业务数据，可研究在发布边界去掉，但不能用它证明该 draft 的所有特性都可用 |
| $ref | draft_shots、MCP nomi_operation_plan | Gemini legacy Schema 未列；包含真正递归，不能有限展开等价替换 |
| propertyNames | stage_shot 的 plan.actors[].anchors 和 edits 的 actor 值 | Gemini 未列，OpenAPI 3.0.3 未纳入；动态键名 regex 不能用固定 properties 等价表达 |
| exclusiveMinimum:number | stage_shot、look_at_media、draft_shots、edit_timeline、MCP nomi_canvas_edit / nomi_timeline_edit / nomi_media_query | Gemini 未列；对整数可研究 minimum(n+1)，实数开区间不能用闭区间 minimum(ε) 等价替换 |
| prefixItems | 存量 0 | 应在白名单之外；加入反例覆盖 |

### 不能等价替换的存量：实施停点

1. `generationPlanSchemas.ts` 的 `generationJsonValueSchema` 显式递归，接受任意深度 array/object；模型投影通过 continuity、keyframe.params 和计划参数广播。draft_shots 的 $ref 中两条是真正自引用。有限展开会限制旧数据的深度；删除 $ref / 换 {} 会把值域放宽；改 JSON 字符串或键值表会改变工具参数形状。三者均不是任务允许的等价替换。
2. `directorPlanSchema.ts` 的 `anchors:z.record(anchorName, vector)` 要保留动态 ASCII 键名 regex。固定 properties 无法覆盖所有合法键；删除 propertyNames 丢失约束；改数组改变形状。
3. `move.amount`、`durationSec`、`waveform.endSeconds` 等的实数严格正值约束无法用同一实数域的闭区间 minimum 等价表达。写最小 epsilon 会拒绝原先合法的小正数；minimum:0 会额外接受 0。
4. Gemini legacy 未列 additionalProperties，而现有 typed record 需要它表达开放键的值类型。若连 schema 值也删除，会违背已有结构与信息不丢门岗。

**结论：按任务要求，在设计卡单独提交后停止产品实现并报协调。** 不先上线一个会拒绝现有生产工具的白名单，不用例外、静默放宽或供应商分支绕过去。拟议唯一 owner 仍是 `collectVendorCompatibilityFailures`；具体白名单需协调确定兼容支持面和上述合同取舍后才能定案。

建议协调先确定「普通工具的实际传输支持面」：能否采用支持 JSON Schema 的传输字段并核对适配器（另调研），再决定递归/动态 record 的保留策略。若要先止血 tuple，应另行明确批准其范围，不能把它报成完成共同子集白名单。若坚持 legacy 最小交集，需要另立参数合同重设计任务，超出本任务“不改业务语义”的授权。

## ★1 用户怎么用

当创作者在 Agent 中要求「把这份文稿拆成分镜」时，我想模型请求能接受整份工具清单，以便先读文稿再生成分镜。

预期步骤：选择模型 → 打开已有文稿 → 输入拆分要求 → 发出整份工具清单 → 接受工具调用 → 执行读文稿与拆分。真实任务形态：用户报告中的 Windows 0.24.0 文稿拆分、已有导演计划的镜头窗口编辑、带嵌套模型参数的分镜续写。未获取用户原稿，不编造真任务通过。

指标与量具：主指标是整清单请求接受率（HTTP 2xx/1），量具为交协调的一次请求探针；质量指标是工具调用出现率（有 tool_calls/1），同一探针记录；护栏是工具 schema 合法率与旧数据接受率，量具计划为兼容函数正反例、全清单回归和 director/scene 存盘夹具。当前旧兼容函数对 54/54 条目报绿，对 tuple 反例也报绿，证明门岗缺口；新判据与旧数据回归尚未实现。工具写对率与完整回合成功率：未验证，单轮探针不执行工具，不能充当整轮任务闭环。

不做：错误文案/分类、工具增删/改名、业务语义、付费调用、真实用户资料读取。已知坑：一条 schema 可阻断整轮；协议接受不代表严格约束或成功拆分。

### ★1b 连带界面

Agent 红条、回执与加载状态不改文案和分类；本次无视觉变化。不能因为本地门岗绿就把原用户错误标已解决。

## ★2 谁说了算

模型可见 JSON Schema 的生成与兼容判据唯一 owner：`electron/shared/agentCapabilities/modelVisibleJsonSchema.ts`。`laneToolSchema.mts` 在生成时拦截；`scripts/check-model-schema.ts` 检查存量；两者继续 import 同一判据。工具定义 owner 是既有注册表，pi 原生工具仍用上游工厂，不另抄 schema。

`node scripts/door-map.mjs collectVendorCompatibilityFailures` 实际输出 1 扇生产读门：`electron/agentLane/laneToolSchema.mts` 的 `collectVendorCompatibilityFailures`；脚本默认只扫 src/electron、不含测试。补查 `scripts/check-model-schema.ts` 同名调用；再跟一跳确认 `laneTools.mts` 用 `toModelVisibleSchema`。存盘 owner 仍是 aiSceneSchema / directorPlanSchema，不新存一份事实。

## ★3 一致与复用

保留 Zod 3.25.76 与 zod-to-json-schema 3.25.1，问题是发布合同未声明兼容子集，不是 tuple 转换器生成了错误的 draft-07。升级依赖不能代替兼容支持面的决定。继续复用两处既有共享 owner、MCP resolver、pi 工厂；不引入库、不自己实现 JSON Schema 标准校验器。

症状：用户连续三次 Invalid request parameters。直接机制：生产确实广播 items 数组，旧兼容函数不拒绝它；供应商实际拒绝原因尚未由真实 HTTP 实验单独证实。类根因：按历史事故加黑名单，未知关键字/形状默认通过。重复性：任何供应商/版本/工具都能引入新形状，应在最早共享发布边界 fail closed。正式实现时先写 schema-v3 根因合同及红测试，再改代码；此次因停点没有创建假装已生效的预防合同。

## ★4 全状态

空/加载/成功/失败/部分成功/取消中/过期/能力不可用均沿用现有 Agent 状态机与中英文文案。兼容性检查属于装配/校验阶段，无新界面；未来不合法 schema 应在共享边界报错，具体提示仍沿用既有错误系统。本次停点状态为“调研完成、实现未开始”，原故障仍开放。

## ★9 验收与回滚

协调确定支持面后，实施前保留以下验收合同：

- 正例：普通标量、嵌套 object、同质数组、字符串 enum、无参数封闭 object、关键字同名业务属性（如属性名 const/items 不应被误当关键字）。
- 反例：任意深度 items 数组、prefixItems、未知关键字、关键字值类型错误、布尔/空 schema、type 数组、根 union，以及不在最终支持面的 $ref/record/union/null 等；default/enum 数据内部的对象不能被误扫成 schema。
- 全量：通过生产函数生成 Agent 核心/原生/延迟领域/pi/helper 与 MCP 整份清单，逐条用同一白名单函数校验；不能只扫领域目录或更新旧基线掩盖拒绝项。
- tuple：vec3 与 window 全部换为同质 length(n)；window 仍 refine(end > start)；旧场景与导演计划 JSON parse 后逐值相同。反例覆盖短/长数组、相等/倒序窗口、非有限数与旧嵌套参数。
- 逃逸账本：原用户事故保持开放；修复结账必须挂白名单的结构性预防、根因合同、回归矩阵与实际合入信息，不能用研究文档结账。
- 验证：相关单测先红后绿，check:model-schema、check:root-cause-contracts、check:mcp-tool-refs、check:walkthrough-tool-args、pnpm run gates、推送前快检。每次提交先 fix-churn --staged。
- 真模型：协调运行一次整清单探针，记录 HTTP 状态和是否 tool_calls；实现线只做 dry-run。Windows 原报告与完整创作者任务未真实复测前均标未验证。
- 独立验收：待协调派验收线；无实现结论可验。回滚当前文档提交只删调研文件，无运行时或存盘数据迁移。

本轮证据：生产 54 条 schema；items 数组 4 处；旧兼容判据 0 条失败；最小 tuple 反例未被拒绝。没有新白名单、没有 tuple 产品替换、没有旧数据新回归；不得把本轮的文档门岗通过算成上述功能验收。
