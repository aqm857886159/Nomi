# 设计卡：模型可见工具的 tuple 兼容修复

类别：外部工具契约兼容性修复；状态：第 2 轮范围已批准，实施前验收合同如下。

## 第 2 轮范围裁定

2026-10-29 协调批准先止血 tuple，白名单另立后续。下列四项线上合同保留：递归 JSON 的 `$ref`、动态键名 `propertyNames`、实数 `exclusiveMinimum`、schema 形式的 `additionalProperties`。没有真实网关拒绝它们的证据，文档子集无法证明共同白名单，硬改会改变业务语义。标准表与第一轮盘点保留作调研记录，不作为本轮拒绝规则。

本轮只把 vec3 / window 改为定长同质数组，在共享 `collectVendorCompatibilityFailures` 拒绝任意 schema 位置的数组式 `items` 和 `prefixItems`，并提供真实网关的隔离 Agent 走查及零花费演练。结构性预防由共享 tuple 规则与真实整清单走查共同承担；后续白名单必须先取得各家真实网关证据，再另立合同设计，不先删或放宽四项约束。

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
| minimum / maximum / minLength / maxLength / pattern | 多数领域工具；pattern 在 stage_shot 与 save_skill | 普通 JSON Schema 与 Gemini Schema 有对应字段；不能推成全 strict 都支持 |
| anyOf | stage_shot、draft_shots、MCP nomi_operation_plan | 字段级 union；Google 当前 Schema 列出，不能一概判为不支持；null 分支仍需按形状核对 |
| default | stage_shot、MCP nomi_read / nomi_canvas_edit / nomi_operation_plan | Gemini 列出；普通 input_schema 与 strict 要分开；不可盲删执行默认值 |
| additionalProperties | 47 个条目，其中既有 boolean，也有 schema 值 | Gemini legacy Schema 未列；typed record 不是附带元数据，删除会放宽值域 |
| $schema | 22 个内部领域工具的根 | 转换器的 draft-07 标记；不是业务数据，可研究在发布边界去掉，但不能用它证明该 draft 的所有特性都可用 |
| $ref | draft_shots、MCP nomi_operation_plan | Gemini legacy Schema 未列；包含真正递归，不能有限展开等价替换 |
| propertyNames | stage_shot 的 plan.actors[].anchors 和 edits 的 actor 值 | Gemini 未列，OpenAPI 3.0.3 未纳入；动态键名 regex 不能用固定 properties 等价表达 |
| exclusiveMinimum:number | stage_shot、look_at_media、draft_shots、edit_timeline、MCP nomi_canvas_edit / nomi_timeline_edit / nomi_media_query | Gemini 未列；对整数可研究 minimum(n+1)，实数开区间不能用闭区间 minimum(ε) 等价替换 |
| type 数组 | draft_shots、MCP nomi_canvas_edit、MCP nomi_try_model 的参数/元数据值 | 当前生成器压缩了原始类型 union；Google legacy type 必须单字符串，需与 anyOf/null 分支一起核形状 |
| prefixItems | 存量 0 | 应在白名单之外；加入反例覆盖 |

### 不能等价替换的存量：第一轮停点（保留）

1. `generationPlanSchemas.ts` 的 `generationJsonValueSchema` 显式递归，接受任意深度 array/object；模型投影通过 continuity、keyframe.params 和计划参数广播。draft_shots 的 $ref 中两条是真正自引用。有限展开会限制旧数据的深度；删除 $ref / 换 {} 会把值域放宽；改 JSON 字符串或键值表会改变工具参数形状。三者均不是任务允许的等价替换。
2. `directorPlanSchema.ts` 的 `anchors:z.record(anchorName, vector)` 要保留动态 ASCII 键名 regex。固定 properties 无法覆盖所有合法键；删除 propertyNames 丢失约束；改数组改变形状。
3. `move.amount`、`durationSec`、`waveform.endSeconds` 等的实数严格正值约束无法用同一实数域的闭区间 minimum 等价表达。写最小 epsilon 会拒绝原先合法的小正数；minimum:0 会额外接受 0。
4. Gemini legacy 未列 additionalProperties，而现有 typed record 需要它表达开放键的值类型。若连 schema 值也删除，会违背已有结构与信息不丢门岗。

第一轮因此停止产品实现。第二轮按上述裁定仅处理 tuple，不把本轮成果报成共同子集白名单。

## ★1 用户怎么用

当创作者在 Agent 中要求「把这份文稿拆成分镜」时，我想模型请求能接受整份工具清单，以便先读文稿再生成分镜。

预期步骤：选择模型 → 打开已有文稿 → 输入拆分要求 → 发出整份工具清单 → 接受工具调用 → 执行读文稿与拆分。真实任务形态：用户报告中的 Windows 0.24.0 文稿拆分、已有导演计划的镜头窗口编辑、带嵌套模型参数的分镜续写。未获取用户原稿，不编造真任务通过。

指标与量具：主指标为整工具清单请求接受率（HTTP 2xx/带工具请求数），量具 `tests/ux/tool-schema-real.paid.mjs` 的启动前 HTTP 探针；质量指标为工具写对率（成功工具结果/工具调用数）与回合成功率（隔离画布落下两镜/1），量具为同一走查的真实 lane 转录与项目落盘。护栏为 54 条生产 profile/tool 的兼容率 54/54 及旧数组数据逐值保真，量具 `scripts/check-model-schema.node-test.mjs`、`electron/shared/director/directorPlanSchema.test.ts`。旧判据基线：54/54 通过，但 tuple 反例误放行；目标是 tuple 反例全部拒绝而存量仍全绿。实现线仅跑同步骤的 `tool-schema-real.rehearsal.walk.mjs`，夹具不算真实模型分数；付费与 Windows 由协调验，未跑记 unverified。

不做：错误文案/分类、工具增删/改名、业务语义、付费调用、真实用户资料读取。已知坑：一条 schema 可阻断整轮；协议接受不代表严格约束或成功拆分。

### ★1b 连带界面

Agent 红条、回执与加载状态不改文案和分类；本次无视觉变化。不能因为本地门岗绿就把原用户错误标已解决。

## ★2 谁说了算

模型可见 JSON Schema 的生成与兼容判据唯一 owner：`electron/shared/agentCapabilities/modelVisibleJsonSchema.ts`。`laneToolSchema.mts` 在生成时拦截；`scripts/check-model-schema.ts` 检查存量；两者继续 import 同一判据。工具定义 owner 是既有注册表，pi 原生工具仍用上游工厂，不另抄 schema。

`node scripts/door-map.mjs collectVendorCompatibilityFailures` 实际输出 1 扇生产读门：`electron/agentLane/laneToolSchema.mts` 的 `collectVendorCompatibilityFailures`；脚本默认只扫 src/electron、不含测试。补查 `scripts/check-model-schema.ts` 同名调用；再跟一跳确认 `laneTools.mts` 用 `toModelVisibleSchema`。存盘 owner 仍是 aiSceneSchema / directorPlanSchema，不新存一份事实。

## ★3 一致与复用

保留 Zod 3.25.76 与 zod-to-json-schema 3.25.1，问题是发布合同未声明兼容子集，不是 tuple 转换器生成了错误的 draft-07。升级依赖不能代替兼容支持面的决定。继续复用两处既有共享 owner、MCP resolver、pi 工厂；不引入库、不自己实现 JSON Schema 标准校验器。

症状：用户连续三次 Invalid request parameters。直接机制：生产确实广播 items 数组，旧兼容函数不拒绝它；供应商实际拒绝原因尚未由真实 HTTP 实验单独证实。类根因：同质固定长度数据以 tuple 发布，且共享发布边界未拦截 tuple 形状。重复性：任意工具、嵌套位置和 JSON Schema 草案都能再引入 tuple，应在最早共享边界拒绝，无供应商分支。先写 schema-v3 根因合同和红测试，再替换两处源 schema。保留现有依赖；换依赖不能代替发布边界规则。

## ★4 全状态

空/加载/成功/失败/部分成功/取消中/过期/能力不可用均沿用现有 Agent 状态机与中英文文案。兼容性检查属于装配/校验阶段，无新界面；未来不合法 schema 应在共享边界报错，具体提示仍沿用既有错误系统。原故障在真实网关及 Windows 验证前仍开放；本地实现不等于已解决。

## ★9 验收与回滚

实施前确定本轮验收合同：

- 正例：同质定长数组、嵌套 object / anyOf / definitions / typed record；业务属性名 items / prefixItems，以及 default / enum / examples / const 数据里的同名字样不误扫。
- 反例：根、嵌套属性、items、union、definitions、additionalProperties 的数组式 items；任意 schema 位置 prefixItems（包括空数组）均红。生成时拦截与存量棘轮继续共用同一函数；不得改四项合同或增删工具。
- 全量：生产目录、原生目录、pi 工厂、request helper、MCP resolver 共 54 条条目逐条调用共享判据，全部通过，不能只扫领域目录。
- tuple：vec3 与 window 换为 length(3/2) 数字数组；window 仍 refine(end > start)。旧场景 / 导演计划 JSON round-trip 逐值相同；覆盖 position/rotation/scale、dressing、blocking/shots。短/长/非数字向量、短/长/负/非有限/相等/倒序 window 均拒绝。非有限 vec3 沿用原 z.number 合同，不额外收紧。
- 根因合同与逃逸账本：结构性预防挂共享 tuple 规则 + 真实网关走查；未获真实网关证据、独立验收及合入 PR 前只登记 reviewed，不伪造 fixed。
- 真实走查：复用 openPaidWalk、createRuntimeWalk 与生产 Agent lane。只授权一个协调指定且真实目录已配置的 OpenAI 兼容文本模型；凭据由 openPaidWalk 复制密文。单个用户回合拆两镜，仅建草稿，不点生成。HTTP 状态、出站真实工具名（必须包含 stage_shot）、是否工具调用、每次结果是否成功、落盘两镜均有证据。没有响应 / 没有调用 / 缺结果 / 参数拒绝均不能算通过；不重试回合、不切模型兜底。
- 零花费演练：同一份步骤、真实 Electron/IPC/工具执行，夹具大脑、假凭据、公网名单为空；中英各一回合。构建标记 `tuple arrays are not portable`（新规则里的字面量，随构建进入产物）。专用任务工作树；只协调可跑付费，一场只一回合，文本回合内工具续轮不冒充单 HTTP。
- 验证：相关单测先红后绿，check:model-schema、check:root-cause-contracts、check:mcp-tool-refs、check:walkthrough-tool-args、演练、pnpm run gates、推送前快检。每个提交前 fix-churn --staged。
- 独立验收：待协调派验收线。真实模型 / Windows 原报告均 unverified，不能用回环绿灯顶替。无 UI 改动；回滚本轮实现提交即可，旧数据不迁移。

第一轮标准表、四项合同与清单盘点是历史基线，第二轮实现结果和反例证据以交接报告为准。
