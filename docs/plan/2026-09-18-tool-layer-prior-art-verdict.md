# 工具层分层裁决：拿 14 条发现去对照顶尖产品（2026-09-18）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：现行 · 2026-09-18 · 分支 `research/tool-layer-prior-art-20260918`（基线 `fix/verb-host-contract-sweep-20260918` @ 3bc0ca364）
> **输入**：`docs/plan/2026-09-18-tool-layer-findings-inventory.md`（14 条发现 + §4 九项已落地）与
> `docs/audit/2026-09-18-agent-capability-restatement-layers.md`（结构评审）。两份都读完了；本文回答它们 §5 的四问。
> **纪律**：每条结论带链接或 file:line；外网页面全部于 2026-09-18 抓取；凭记忆的东西一律标「未证实」。
> 对照用的仓库克隆（浅克隆，含 commit）在会话 scratchpad `prior-art/`，本文引用时给出 commit 与 file:line。
> **这份文件是要拿去做架构决定的。** 它允许、并且下面确实推翻了我们自己的一半判断。

## 先查别人

（本文件**就是**那份检索报告；这一节是它的索引，正文 §2 是逐面的原文与出处。）

- **依赖里已有？** pi 的 `AgentHarnessTool<TContext, TParameters>` 一份 typebox 两用（`node_modules/@earendil-works/pi-agent-core/dist/index.d.ts`，本人直接读，见 §2.5）；Vercel AI SDK 的 `inputSchema` 明写 *"dual purpose"*（https://ai-sdk.dev/docs/reference/ai-sdk-core/tool ）。
- **仓库里已有？** 我们在对外 MCP 面**已经是投影形状**：`electron/capabilityCore/mcpGenerationToolCatalog.ts:22` 用 `.omit().extend()`；而同文件 `:33-54` 又手抄了一份逐字段拷贝（见 §2 与 findings-inventory §6）。
- **生态里已有？** MCP 现行版 2026-07-28 规范（https://modelcontextprotocol.io/specification/2026-07-28/server/tools ）；Claude Agent SDK 一份 zod 派生模型面并在执行前校验（`sdk.d.ts:9145`，https://code.claude.com/docs/en/agent-sdk/custom-tools ）；OpenAI「Avoid JSON schema divergence」原句给的两条出路是派生或 CI 拦漂移（https://developers.openai.com/api/docs/guides/structured-outputs ）；Codex `_meta["openai/fileParams"]` 是圈里唯一「声明对应 → 生成翻译」的先例（`codex-mcp/src/codex_apps/file_params.rs:43-45`）。
- **自媒体/同族？** DTO 映射器族（MapStruct `unmappedSourcePolicy`、AutoMapper `AssertConfigurationIsValid()`，https://mapstruct.org/documentation/stable/reference/html/ ）——`verbFieldMap.ts` 的五条不变量是它的运行时复刻，而这一族的适用前提是「两边独立演化」，两边都归我们时它在维护一条自造的缝。

## 0. 一句话裁决

**「该有两遍，不该有四遍」对了一半、错了关键的一半。**

- **对的一半**：模型面与宿主准入之间必须有**两道运行时动作**——校验 + 审批——而且花钱的审批必须在宿主侧、绑定在模型给出的那份参数上。六个对照面全是这样（§2）。
- **错的一半**：**六个面里五个把这两道做成「一份 schema，两个用途」，唯一两处手写的 Codex 同名、无翻译层、且量得到漂移（§2.4）。** 五个面全部是「**一份 schema，两个用途**」：给模型看的 JSON Schema 从它派生，执行前用它校验，handler 的参数类型从它推导（MCP TS SDK 源码注释原话：*"so the listing and the call cannot diverge"*）。「宿主内部名 vs 模型友好名」这种差异在别人那里**不存在**——要么名字只起一次，要么差异是宿主**算出来**的（`mcp__server__tool` 命名空间、`x-mcp-header`、Codex `sanitize_json_schema`），从来不是手写对照表。
- 所以「第三遍从对应关系生成」是**第二好的解**：它属于 MapStruct / AutoMapper 那一族（声明对应 + 未映射即报错），那一族存在的前提是「两边的类型各自独立演化、且都不由你控制」——而我们两边**都是我们自己写的**。**第一好的解是让第三遍不存在**：模型面 schema = 宿主 schema 的**投影**（子集 + 描述 + 去掉宿主自补的字段），名字只起一次；宿主自补（`operation`、`cardHidden`、参考图身份）作为显式 `fill`，补完**再过同一份 schema**（Claude Code 原话：策略按钩子返回的输入评估，不按模型发的）。对应表上 9 条 `rename` 里 7 条的 `why` 是「模型面叫 X，宿主面叫 Y」——按我们自己的 R5.5，**偏好不是合法的偏差理由**。
- **它对在哪个前提上**：我们两面之间隔着 `RuntimeToolCall.args: unknown`（`electron/shared/agentCapabilities/transportContracts.ts:22-26`）——类型在传输处被抹平，TypeScript 看不见这条缝。这是「四遍手写还能活着」的结构原因，也是别人没有这个问题的原因：别人的 handler 直接调用领域 API，参数类型齐全。**前提变了**（工具同进程执行，或传输改成类型化）→ 对应表可以整个删掉。但注意：即便类型化，TS **也抓不到「漏传一个可选字段」**（B3 那种静默丢），所以投影化（名字相同 ⇒ 不需要传）比类型化更根本。

## 1. 我们今天实际有几层（实测，不是清单说的「四遍」）

沿 `draft_shots` 在内部 lane 上走一遍，参数被**校验或重建**的点：

| # | 在哪 | 用哪份 schema | 做什么 |
|---|---|---|---|
| 1 | `VerbDeclaration.prepareArguments`（`writeVerbs.ts:174`，pi 官方钩子） | 无 | 容忍（整包 JSON 串、数组写成串、单对象→一元数组、字段别名） |
| 2 | pi `validateToolArguments`（`@earendil-works/pi-ai/dist/utils/validation.js:280-307`） | `toModelVisibleSchema(verb.schema)`（`laneToolSchema.mts`） | TypeBox 编译校验 + 四道内置容忍梯 |
| 3 | `laneTools.mts:237` `descriptor.schema.safeParse(params)` | **同一份** verb zod | 跑 zod 才有的 `superRefine`（跨字段约束） |
| 4 | `laneExtendedDesktopPorts.ts:88` `spec.schema.parse(wire.args)`（prepare）与 `:162`（execute，用来比对审批时的那份） | **同一份** verb zod，第 3、4 次 | 归一 + 审批绑定 |
| 5 | `verbToTransportCall`（`laneVerbTransport.ts:64`）执行 `verbTransportRoutes.ts` 的表 | 表 | **翻译**：改名 / 折缺省 / 参考图补壳 / 选分支 |
| 6 | `generationTransportAdapters.ts:67-96` `parsedArgs` | `generationPlanInputSchema`（**宿主契约**，`generationPlanSchemas.ts:113`） | 准入校验；同一函数里还有一份**更窄的手抄** create/patch/present schema（清单 E1，仍在） |
| 7 | `mcpGenerationMultiShot.ts:336-367` | 无（手写 `inherited` 合并） | handler 自己再做一次「顶层缺省折进每镜」 |
| 8 | 花钱卡 / 节点标签 / 持久化投影 | `generationShotEnvelopeOf` | 下游投影（已整只搬） |

三点实测结论：
- **模型面那一份 schema 被校验了三到四次**（#2 ajv、#3 zod、#4 zod×2），`laneToolSchema.mts:19-21` 头注释写的「校验只发生一次：pi 的 ajv 那次。宿主不再用 zod 复验」与 `laneTools.mts:237` 的「契约自己的那一次 parse……必须在这里、且只在这里」**互相矛盾**——两份文件头各自成立，合起来不成立。这不是 bug（superRefine 只有 zod 能跑），但说明「有几层」连我们自己也没数清。
- **翻译层（#5）做的「顶层缺省折进每镜」，宿主 handler（#7）自己也做了一遍**——`DRAFT_SHOTS_FIELD_MAP` 的两条 `defaults` 关系（`verbTransportRoutes.ts:190-191`）与 `mcpGenerationMultiShot.ts:359-366` 的 `inherited` 是同一件事的两份实现。外部 MCP 面只经过 #7，内部面两者都过。**任何住在翻译层里的逻辑，外部面天然没有**——清单 B5（`?? "full"` 只在内部 lane 有）是这一形状的一个实例，不是孤例。
- 审批闸（`laneApprovalGate.ts` → `preflightLaneApproval`，`laneApproval.ts:95-125`）跑在 pi 的 `before_tool`，**看到的是模型面参数**（#4 之前）；真正的花钱闸是宿主密封候选后摆出的报价卡（`nextAction: user_sees_spend_card`），**看到的是翻译 + 合成之后的宿主形状**。两道闸之间的一致性完全靠 #5 的翻译正确——`title` 在五处投影里各死一次，就是这条缝的直接证据。

## 2. 六个面逐个对照

每个面回答同样四件事：(a) 模型面与执行之间分几层、各叫什么；(b) 校验在哪、审批在哪；(c) 模型面 schema 与准入契约是不是**同一个对象**；(d) 有没有改名/翻译层，怎么做的。

### 2.1 MCP 规范（现行版 **2026-07-28**，不是任务书写的 2025-06-18）+ 参考实现 TS SDK

- 版本：https://modelcontextprotocol.io/specification/versioning — *"The **current** protocol version is 2026-07-28"*（本人 2026-09-18 抓取核实）。
- 规范原文（https://modelcontextprotocol.io/specification/2026-07-28/server/tools ，schema 存 scratchpad `prior-art/schema.ts`）：
  - 工具只有**一份** `inputSchema`（`schema.ts:1995`），加 `outputSchema` / `annotations` / `_meta`。
  - 校验双方都做、都对着**同一份**：Servers **MUST** *"Validate all tool inputs"*；Clients **SHOULD** *"Follow the `$ref` resolution requirements when validating tool inputs and outputs against `inputSchema` and `outputSchema`"*（客户端也校验输入这一句是 2026-07-28 新增的，2025-06-18 没有）。
  - 错误分两类、**语义校验失败归 `isError`**：Protocol errors（*"Unknown tool / Malformed requests … / Server errors"* → `-32602`）vs Tool execution errors（*"Input validation errors (e.g., date in wrong format, value out of range) / Business logic errors"* → `isError: true`），并且 *"Clients SHOULD provide tool execution errors to language models to enable self-correction."*
  - 审批是**宿主的独立一层、不在 schema 里**：*"there SHOULD always be a human in the loop with the ability to deny tool invocations"*；Clients SHOULD *"Prompt for user confirmation on sensitive operations"*、*"Show tool inputs to the user before calling the server"*。`ToolAnnotations` 明写 *"are hints … Clients should never make tool use decisions based on ToolAnnotations received from untrusted servers"*（`schema.ts:1903-1909`）。
  - **唯一的「字段要在别处再出现一次」机制是挂在字段上的注解，不是第二份映射**：`x-mcp-header` 写在模型面属性 schema 里，告诉传输把该参数镜像成 `Mcp-Param-{name}` 头；约束（只许基本类型、大小写不敏感唯一、静态可达）由客户端 **MUST** 校验，不合规就把工具从 `tools/list` 里剔除。
  - 新增 `InputRequiredResult`：`tools/call` 可以回 `resultType: "input_required"` + `elicitation/create`，**执行中途的人工闸成了协议结果形状**。
- 参考实现（`modelcontextprotocol/typescript-sdk` @ `6032170`，2026-09-16；本人复核）：`packages/server/src/server/mcp.ts:240-242` `tools/list` 用 `standardSchemaToJsonSchema(tool.inputSchema, 'input')` 派生模型面；`:272-274` `tools/call` 先 `validateToolInput(tool, …)` 再 `executeToolHandler` 再 `validateToolOutput`——**同一个对象**；`:276-280` 注释原话 *"The codec receives the SAME advertised JSON Schema `tools/list` emits … so the listing and the call cannot diverge."*
- (a) **1 层 schema + 1 层宿主审批**；(b) 校验：服务端必做、客户端应做，同一份；审批：宿主，作用在模型给的原始参数上；(c) **同一对象**；(d) **没有改名层**，只有字段级注解（`x-mcp-header`）这种「投影元数据挂在字段上、机器核」。

### 2.2 Claude Agent SDK / Claude Code（`@anthropic-ai/claude-agent-sdk@0.3.274`；docs 2026-09-18）

- 工具定义（`package/sdk.d.ts:9145`，本人复核）：`tool(name, description, zodShape, handler)`——**一份 zod**：模型面 JSON Schema 从它派生、执行前用它校验、`handler(args: InferShape<Schema>)` 的类型从它推导。文档：*"the handler's `args` are typed from it automatically"*（https://code.claude.com/docs/en/agent-sdk/custom-tools ）。
- 模型看到的名字和作者写的名字**确实不同**——`mcp__{server_name}__{tool_name}`——但这是宿主**算出来**的命名空间，不是作者写第二份。
- 审批是一条**与 schema 正交的六步流水线**（https://code.claude.com/docs/en/agent-sdk/permissions ）：hooks → deny 规则 → ask 规则 → permission mode → allow 规则 → `canUseTool`。规则语法是「工具名 + 参数前缀」（`Bash(npm run *)`），**不是**第二份 schema。
- **宿主准入层可以改写模型参数，改完重新过准入**：`PermissionResult = {behavior:'allow', updatedInput?: Record<string,unknown>} | {behavior:'deny', message}`（`sdk.d.ts:2389-2391`，本人复核）。PreToolUse 钩子 `updatedInput` 的原话（https://code.claude.com/docs/en/hooks ）：*"Replaces the entire input object … **Claude Code evaluates permission rules … against the input your hook returns, not the input Claude sent.**"* `PermissionRequest` 钩子：*"The modified input is re-evaluated against deny and ask rules."* ——**宿主自补 = 改写 + 重新准入**，不是一条看不见的翻译。
- **花钱/不可逆的闸是挂在同一份定义上的一个声明**：`_meta: { "anthropic/requiresUserInteraction": true }`（https://code.claude.com/docs/en/mcp ）——每次调用都弹窗，`bypassPermissions` / allow 规则 / 钩子的 `allow`+`updatedInput` 都跳不过，无 UI 的 `dontAsk` 模式下**拒绝而不是放行**：*"auto-approval would mean no human ever agreed."*
- (a) **2 层**：一份 schema；一条按名字 + 原始参数走的审批流水线；(b) 校验 = 同一份 zod；审批 = 流水线，可改写、改写后重审；(c) **同一对象**；(d) 没有改名层；只有宿主计算的命名空间。

### 2.3 Anthropic Messages API（docs 2026-09-18；页面存 scratchpad `prior-art/define-tools.md`、`strict-tool-use.md`、`so.md`）

- 一份 `input_schema`。`strict: true` 用文法约束采样保证输入合 schema（https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use ），但**表达不了钱相关的约束**：不支持 `minimum`/`maximum`/`multipleOf`、字符串长度、递归、`additionalProperties ≠ false`；`minItems` 只许 0/1（https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations ）。`refusal` / `max_tokens` 两种 stop_reason 下输出可能不合 schema；枚举大小写不保证。
- 定义工具的指导（`define-tools.md:73-86`）：*"Provide extremely detailed descriptions. This is by far the most important factor"*；*"Consolidate related operations into fewer tools … a single tool with an `action` parameter"*；*"Return semantic, stable identifiers (for example, slugs or UUIDs) rather than opaque internal references."* **没有任何一句支持「给模型一个与宿主不同的字段名」。**
- (a) 1 层；(b) 校验：采样期（可选）+ 宿主；审批：不在 API 里；(c) 同一对象；(d) 无。

### 2.4 OpenAI：function calling / Agents SDK / Codex

- **function calling 指南**（https://platform.openai.com/docs/guides/function-calling ，存 scratchpad `prior-art/function-calling.md:576-582`）的最佳实践原句，直接判了清单 A 类：
  *"**Don't make the model fill arguments you already know.** For example, if you already have an `order_id` based on a previous menu, don't include an `order_id` parameter. Instead, define `submit_refund()` with no parameters and pass the `order_id` in your code."*；
  *"**Use enums** and object structure to prevent invalid states. For example, `toggle_light(on: bool, off: bool)` allows for invalid calls."*；
  *"Make the functions predictable and intuitive"*；*"Combine functions that are always called in sequence."*
- **Structured Outputs 指南「Avoid JSON schema divergence」**（https://developers.openai.com/api/docs/guides/structured-outputs ，raw markdown 本人 2026-09-18 抓取并核过链接域名，`:3328-3332`）——唯一一句正面谈「两份 schema 漂移」的供应商原话：*"To prevent your JSON Schema and corresponding types in your programming language from diverging, we strongly recommend using native SDK schema helpers where available. If you prefer to specify the JSON schema directly, you could add CI rules that flag when either the JSON schema or underlying data objects are edited, or add a CI step that automatically generates the JSON Schema from type definitions (or vice-versa)."* 两条出路：**派生**，或 **CI 拦漂移**——没有第三条「手写两份再手写对照」。我们的 `check-verb-host-conformance` 是第二条出路；投影化是第一条。
- **Agents SDK（JS）**（`openai/openai-agents-js` @ `506f736a1`，2026-09-16；本人复核 file:line）：`tool()` 一份 `parameters`（zod 或 JSON Schema），同一对象既发给模型又做运行时 parser（`packages/agents-core/src/tool.ts:2323` `getSchemaAndParserFromInputType`）；zod 参数**强制** strict（`tool.ts:2278` *"Strict mode is required for Zod parameters"*）；到 OpenAI strict 方言的转换是**生成 + 无损断言**（`utils/tools.ts` 的 `toOpenAIStrictToolSchema` / `assertLosslessOpenAIStrictZodSchemaConversion`）。审批只有 `approve(item, {alwaysApprove})` / `reject(item, {alwaysReject, message})`（`runState.ts:3117/3144`），**不能改参数**；参数解析失败**fail-closed**（文档：*"the SDK calls it only after the tool arguments have parsed into an inspectable object. Malformed JSON and non-object values fail closed"*，https://openai.github.io/openai-agents-js/guides/human-in-the-loop/ ）；输入护栏可配置在审批前跑、审批后**再跑一次**（*"in case the tool call became unsafe while waiting"*）。
- **Codex**（`openai/codex` @ `c775dd3`，2026-09-17；本人读 clone）：
  - 每个工具有两处手写：`core/src/tools/handlers/<tool>_spec.rs`（模型面 `ToolSpec`，JSON Schema 逐属性手写）与 handler 的 serde struct（从 `ToolPayload::Function { arguments }` 字符串反序列化）。**这是六个面里唯一「模型面与 handler 两处手写」的**——但两处**同名**、中间没有第三份翻译，也**没有宿主侧 JSON-Schema 校验**（全仓 `Cargo.toml` 无 `jsonschema` 依赖，本人 grep 复核）：准入就是 serde 进 struct。
  - **两处手写的代价在它自己仓里量得到**（本人复核）：`ExecCommandArgs.timeout_ms: Option<u64>`（`core/src/tools/handlers/unified_exec.rs:40`）在 `shell_spec.rs` 里 **0 次出现**——宿主收一个模型从没被告知的字段；`view_image_spec.rs:23-27` 把 `detail` 发成 `string_enum(["high","original"])`，handler 侧按 agent 报告是 `Option<String>` 再手核（handler 行未本人复核，见 §9）。唯一的测试是 spec 的字面快照（`shell_spec_tests.rs`），**没有任何测试把 spec 字段与 struct 字段绑在一起**——这正是我们 A/B 类的形状。
  - **同一个仓把自己拥有的机器间契约全部单源**（agent 报告，本人未逐行复核）：`app-server-protocol/src/rpc.rs` 一个 Rust 类型 `derive(Deserialize, Serialize, JsonSchema, TS)` 同时出反序列化器 + JSON Schema + TypeScript，并有 `schema_fixtures_tests.rs` 拦漂移。**OpenAI 只在模型面工具 schema 上手写两份，而那正是它漂移的地方。**
  - **`_meta["openai/fileParams"]`——LLM 工具圈里唯一一处「声明对应 → 生成翻译」**（`codex-mcp/src/codex_apps/file_params.rs:43-45` *"Derives execution-time file capabilities from the raw schema, then masks declared file arguments as local paths for the model"*；`core/src/mcp_openai_file.rs:1-12` *"rewrite only the declared arguments into the provided-file payload shape"*；Apps SDK 文档 https://developers.openai.com/apps-sdk/reference §"Define file inputs"）。它的形状值得看清：**声明只是一张字段名单**（哪些参数是文件），**变换只有一种**（模型面：文件对象 → 本地路径串；执行时：路径 → 上传后的 file payload），执行器是通用代码。这与我们 `references` 那条 `resolved` 关系**完全同构**——也仅此一条；它不是 7 种关系 × 4 档来源的对照表的先例。
  - 审批顺序在 Codex 内部**自己就分两种**（agent 报告，`core/src/tools/orchestrator.rs:142` `// 1) Approval`）：自家工具审批看**已解析的类型化请求**（`ApprovalAction::ExecCommand`），第三方 MCP 工具审批看**模型面原始 JSON**、`fileParams` 改写发生在同意**之后**（`mcp_tool_call.rs:503`）。我们的报价卡看宿主合成后的候选，与「自家工具」那一支一致。
  - **审批的 affordance 长在模型面 schema 里**（`shell_spec.rs:232-275`）：`sandbox_permissions: "use_default" | "with_additional_permissions" | "require_escalated"`、`justification`（*"User-facing approval question for `require_escalated`; omit otherwise."*）、`prefix_rule`（*"Reusable approval prefix for `cmd`"*）。即：**模型自己声明这次要不要升级权限、给用户看的问题是什么**；决定权在宿主（`core/src/safety.rs:44-57` 按 `AskForApproval` 策略判），但"问什么"是模型填的字段。
  - MCP 工具进 Codex：`codex-rs/tools/src/json_schema.rs:62-71` `sanitize_json_schema`——*"Sanitize a JSON Schema … so it can fit our limited schema representation: Ensures every typed schema object has a `type` … Collapses `const` into single-value `enum` … Fills required child fields … with permissive defaults"*。这是一层**方言转换**（作者的 schema → 模型能吃的子集），方向与我们相反（它把「外部工具的 schema」投影成「模型面」，不是把「模型面」翻成「宿主面」），且是通用算法不是逐字段表。
- (a) function calling 1 层；Agents SDK 1 份 schema + 审批决定层；Codex **2 处手写但同名**（spec / handler struct）+ 策略层；(b) 校验：同一 schema（Agents SDK 强制 strict）；审批：独立层，只能批/拒（Agents SDK）或按策略判（Codex），审批的问题文本由模型面字段承载（Codex）；(c) 同一对象（Agents SDK）/ 同名两份（Codex）；(d) **没有逐字段改名层**；只有生成式方言转换（`toOpenAIStrictToolSchema`、`sanitize_json_schema`）。

### 2.5 pi（`@earendil-works/pi-agent-core@0.85.1`，本仓依赖，`node_modules/.../dist` 本人直接读）

- `AgentTool<TParameters> extends Tool<TParameters>`（`pi-agent-core/dist/types.d.ts:340-361`）：`parameters` **一份** TypeBox schema；`prepareArguments?: (args: unknown) => Static<TParameters>`（原注 *"Optional compatibility shim for raw tool-call arguments before schema validation. Must return an object that matches `TParameters`"*）；`execute(toolCallId, params: Static<TParameters>, …)`——**handler 的参数类型从同一份 schema 推导**。
- 校验一次、一份：`agent-loop.js:411` `validateToolArguments(tool, preparedToolCall)` → `pi-ai/dist/utils/validation.js:280-307`：`structuredClone` → `normalizeOptionalNulls` → `Value.Convert` → 非 TypeBox schema 再 `coerceWithJsonSchema` → `Compile(schema).Check`。失败抛带路径的错误串（**回显了整包参数**，`:303`——这也是我们 #547 那次「8 行报错只有 1 行是真的」的来源之一）。
- 没有审批层（pi 把它留给宿主的 hooks，我们的 `laneApprovalGate` 就挂在 `before_tool`）。`Tool.constrainedSampling?: {type:"json_schema", strict:"prefer"|"require"}`（`pi-ai/dist/types.d.ts:375-387`）是 strict 采样的开关。
- (a) 1 层 schema（+ `prepareArguments` 容忍钩子）；(b) 校验：pi 内一次；审批：宿主钩子；(c) **同一对象**，且 handler 参数类型 = `Static<TParameters>`；(d) 无改名层。**注意**：我们把 verb 的 zod 转成 TypeBox/JSON 给 pi 校验，然后又在 `execute` 里用 zod 再校验一次（§1 #3）——pi 的设计前提是「`execute` 拿到的就是校验过的 `Static<TParameters>`」，我们在它上面又叠了一台验证器。

### 2.6 ChatCut Desktop（最近的近邻：跨进程 + 花钱；本机 MCP 面本人 2026-09-18 直接读）

- 拓扑：`~/Library/Application Support/ChatCut/chatcut-mcp` 是 709 字节 shell 脚本，`exec /Applications/ChatCut.app/Contents/MacOS/ChatCut …/app.asar/out/main/mcp/server.js`，并设 `CHATCUT_MCP_SOCKET=…/mcp.sock`——MCP server 是**独立进程**，经 Unix socket 进桌面 app。**与我们同构**：模型面在 server 进程，执行在 app 进程，中间跨进程。
- `submit_video` 的 `inputSchema`（本会话 `mcp__chatcut_desktop__submit_video` 定义，本人读）：
  - `additionalProperties: false`，`required: ["model","taskMode"]`；`model` 是**给模型的别名枚举** `seedance-2-5 | seedance2 | seedance2fast | seedance2mini | kling | omni`；供应商参数的翻译在 handler 里，**并且写进了工具描述让模型知道**：*"For Kling customize multi-shot, omit prompt and pass model:kling, shotType:customize, and multiPrompts; the tool submits provider params as multiShot:true, shotType:customize, multiPrompt, and prompt:\"\"."*
  - 容忍写进 schema 本身而不是另一层：`durationSeconds: {anyOf:[number,string]}` *"Prefer a number; simple seconds strings like \"8s\" are accepted."*
  - **模型只给素材引用，身份宿主解析**：`refImages/refVideos/refAudios` 是 *"asset refs (UUID, short prefix, or asset://id)"*；`submit_image.referenceAssetIds` 原话 *"the backend resolves bytes server-side"*——与我们 A2 修法同一条。
  - 互斥约束只写在描述里（*"Do not combine with frame inputs"*），schema 上没有 `oneOf`——和我们 C2 一样靠模型自觉。
- `edit_item`（时间轴写，最复杂的一支）：`adds/updates/deletes` 是 `items: {type:"object", additionalProperties: {}}`——**模型面是松壳，真校验在 app 进程里**，配 `validateOnly: true` 干跑（*"dry-run validation/planning; no commit"*）与 `json` 字符串兼容入口。即 ChatCut 在最复杂的工具上选择了**「一份松 schema + 描述承载规则 + 宿主强校验 + 干跑」**，没有第二份模型面 schema。
- **钱怎么闸**：`submit_video`/`submit_image` **直接花额度、没有宿主审批卡**。闸有三道，没有一道是 schema：① 技能文本（`~/.claude/skills/chatcut-video-gen/SKILL.md:273` *"Generation costs credits. Before submitting, briefly tell the user what you're about to generate."*、`:107` *"Ambiguous or missing — ASK the user … A round-trip confirmation is cheaper than a wasted generation."*）；② 后端权益（`chatcut-image-gen/SKILL.md:10` `FEATURE_NOT_INCLUDED`）；③ `track_progress` 的 `recoveryUrl`（*"instead of resubmitting and spending credits again"*）。
- (a) 1 份 schema（模型面 = MCP inputSchema）+ app 进程内校验；(b) 校验：server 进程按 inputSchema、app 进程按内部规则（`edit_item` 明示）；审批：**没有宿主层**，靠提示词 + 后端权益；(c) 同一对象；(d) 模型别名 → 供应商参数的翻译**在 handler 里**、并在描述里向模型公开，没有对照表。

### 2.7 其它对照（Vercel AI SDK · LangGraph · Pydantic AI · Composio · DTO 映射器）

- **Vercel AI SDK**（`vercel/ai` @ `12845693d`，2026-09-17；本人复核 file:line）：`inputSchema` *"Serves dual purpose: generates the model-facing JSON schema AND performs runtime validation"*（https://ai-sdk.dev/docs/reference/ai-sdk-core/tool ）。顺序**先校验再审批再执行**：`resolve-tool-approval.ts:37` 的参数注释是 *"Valid tool call."*；*"Approval decisions cannot modify tool input"*（https://ai-sdk.dev/docs/agents/tool-approvals ）。**唯一的输入变换是 `T → T`**：`tool-input-refinement.ts:14-18` `(input: InferToolInput<T>) => InferToolInput<T>`，注释 *"must return an input with the same type shape"*，用途是跨供应商归一（`null` vs `""`），**不是改名**。花钱闸的绑定：`tool-approval-signature.ts:72` `hashCanonical(input)` 进 HMAC 载荷 `['ai-sdk-tool-approval-v1', approvalId, toolCallId, toolName, inputDigest]`——**审批绑定的是这份参数的规范哈希**（我们 `laneExtendedDesktopPorts.ts:169` 用 `JSON.stringify` 比对是同一个意图的手工版）。`@ai-sdk/policy-opa` 把「谁能花多少」放进 OPA 策略，*"entirely on top of the public `toolApproval` callback"*。
- **LangGraph HITL**（https://docs.langchain.com/oss/python/langchain/human-in-the-loop ）：四种决定 `approve / edit / reject / respond`，`edit` 的 resume 形状 `{"type":"edit","edited_action":{"name":…,"args":{…}}}`——人可以改参数，但改完**回到同一份工具契约**。
- **Pydantic AI**（https://pydantic.dev/docs/ai/tools-toolsets/tools-advanced/ ）：schema 从函数签名派生；`prepare: (RunContext, ToolDefinition) -> ToolDefinition | None` 可以**按次改模型看到的 name/description/parameters_json_schema**（只改模型面视图，执行函数不动）；审批 `ToolApproved(override_args=…)` 可改参数；`ToolReturn(return_value, content, metadata)` 是**输出侧**的「模型看的 / 应用看的」显式分离。**这是最接近「两个视图」的设计——但它是一份定义 + 一个声明的投影函数，不是两份 schema。**
- **Composio 修饰器**（https://docs.composio.dev/docs/tools-direct/modify-tool-behavior/before-execution-modifiers ，本人抓取）：`modifySchema({toolSlug, toolkitSlug, schema}) => schema`（删属性、改描述）、`beforeExecute({toolSlug, toolkitSlug, params}) => params`（*"modify the arguments called by the LLM before they are executed"*，例子就是宿主填值 `params.arguments.size = 1`）、`afterExecute`。三者都是**声明的、按工具挂的变换函数**，类型 `Schema→Schema` / `Params→Params`——用在**你不拥有执行端**的边界上。
- **DTO 映射器（我们对应表真正的同族）**：MapStruct（https://mapstruct.org/documentation/stable/reference/html/ §2.4）`unmappedTargetPolicy = ERROR|WARN|IGNORE`（默认 WARN）、`unmappedSourcePolicy`（默认 IGNORE），编译期生成、*"Clear error-reports at build time"*；AutoMapper（https://docs.automapper.io/en/stable/Configuration-validation.html ）`AssertConfigurationIsValid()` *"checks to make sure that every single Destination type member has a corresponding type member on the source type"*，出路是 custom resolver / projection / `Ignore()`。**`verbFieldMap.ts` 的五条不变量（①每个源字段有关系 ②关系源存在 ④落点存在 ⑤同落点分优先级）就是 `unmappedSourcePolicy=ERROR` + `unmappedTargetPolicy` 的运行时复刻**，`resolved`/`consumed`/`absentOn` 对应 custom resolver / `Ignore()`。这一族的适用前提在它们自己的动机里写着：AutoMapper *"eliminate the need for manual testing"* 之于「两边类型独立演化」——**两边都是你自己写的时候，这一族是在维护一条你自己造出来的缝**。

## 3. 四问的回答

**Q1 分几层。** 顶尖产品在「模型看到的工具面」与「执行」之间是 **1 份 schema + 1 条审批策略**，没有更多：MCP/TS SDK（§2.1）、Agent SDK/Claude Code（§2.2）、Messages API（§2.3）、OpenAI Agents SDK（§2.4）、pi（§2.5）、ChatCut（§2.6）、Vercel/Pydantic/LangGraph（§2.7）全部如此。唯一的两处手写是 Codex（`*_spec.rs` + handler struct，§2.4），但两处**同名**、中间无翻译。各层为什么存在：schema 那一层存在是因为模型需要一份合同、执行需要一次校验——**同一份满足两边**；审批那一层存在是因为「能不能做」不是形状问题而是策略问题（模式 / 规则 / 钱 / 人在不在），所以它按**工具名 + 同一份参数**判，从不按第二份 schema 判。

**Q2 跨进程 + 花钱闸。** 别人有同样的约束：ChatCut 跨 socket 花额度（§2.6），Claude Code 的 MCP 工具跨进程且可不可逆（§2.2），Vercel 的 `needsApproval` 工具可以是付费 API（§2.7）。他们把准入校验放在**执行侧、对着同一份 schema**（MCP：server MUST validate；ChatCut：`edit_item` 在 app 进程强校验 + `validateOnly` 干跑），把钱的决定放在**策略层**（Claude Code `_meta["anthropic/requiresUserInteraction"]`；Vercel `toolApproval` + OPA 策略；ChatCut 后端权益 + 技能文本）。**「模型面 schema 直接当准入校验」在有钱的场景下够用，前提是三件事一起成立**：① 准入除了 schema 还有一道**策略**（花不花钱、谁批）——我们有（`laneApprovalGate` + 报价卡）；② 审批绑定的是**同一份参数的哈希**（Vercel `hashCanonical(input)` 进 HMAC）——我们有手工版（`laneExtendedDesktopPorts.ts:169` `JSON.stringify` 比对）；③ 宿主自补的字段在补完之后**重新过同一份 schema 与策略**（Claude Code：*"against the input your hook returns, not the input Claude sent"*）——**我们没有**：自补发生在翻译层（§1 #5），审批闸在它之前看模型面，报价卡在它之后看宿主面，两者之间只有翻译的正确性做保证。没有人证明「第二份手写 schema」在有钱场景下是必要的；有人证明的是「一份 schema + 策略 + 绑定 + 补后重审」够用。

**Q3 翻译从对应关系派生。** LLM 工具圈**没有人做**「声明字段对应 → 生成翻译」。做的是三类别的事：(i) **一份定义派生投影**——Pydantic `prepare: ToolDefinition → ToolDefinition`、Composio `modifySchema: Schema → Schema`（删属性、改描述）；(ii) **`T → T` 归一/补值**——Vercel `refineToolInput`（注释明写 *"must return an input with the same type shape"*）、Composio `beforeExecute: Params → Params`、Claude Code `updatedInput`；(iii) **生成式方言转换**——Codex `sanitize_json_schema`、OpenAI Agents `toOpenAIStrictToolSchema` + 无损断言。LLM 圈唯一的「声明对应 → 生成翻译」是 Codex 的 `_meta["openai/fileParams"]`（§2.4）：**一张字段名单 + 一种变换 + 通用执行器**——它是我们 `references: resolved` 那一条的先例，不是整张表的先例。「声明对应 + 未映射即错」的成熟先例在 DTO 映射圈（MapStruct `unmappedTargetPolicy=ERROR`、AutoMapper `AssertConfigurationIsValid`，§2.7），它们的代价与 `verbFieldMap.ts` 一样：一套自己的关系词表（我们 7 种 `kind` + 4 档 `from`，308 行）、生成器本身要测（`check-verb-host-conformance` 内置阳性对照）、以及最重要的一条——**它只在两边类型必须独立演化时才值得**。**更好的解**：一份 schema + 两个显式声明——`hide`（模型面不显示的宿主字段：`operation`、`cardHidden`、完整 `candidate`、`contentHash/version`）与 `fill`（宿主补：`operation: 'create'`、`cardHidden: true`、参考图身份）——补完再过同一份 schema。字段名相同 ⇒ 不需要「传」，B/C/D 类整族消失；`check-verb-host-conformance` 的 R1–R3 退化成一句子集断言，R4（lane 有适配器）与 R5（下游不手抄信封）保留。

**Q4 §4 九项里哪些是对的方向走错了实现。** 见 §5：两项（翻译派生化、一致性门岗 R1–R3）是「对的方向、为一条本可消掉的缝造的机器」；一项（superRefine 搬到动词面）只做了一半；其余六项方向与实现都对。

## 4. 裁决展开：对在哪个前提上，前提变了怎么办

- **对的部分对在**：跨进程传输 + 宿主侧花钱闸 ⇒ 执行侧必须自己校验（MCP MUST）、审批必须在宿主（MCP SHOULD）。这两条与传输机制无关，前提不会变。
- **错的部分错在**：把「两道动作」实现成了「两份手写 schema」。它能活下来的**唯一前提**是 `RuntimeToolCall.args: unknown`——传输把类型抹平，TS 看不见 verb 与 host 之间的缝，于是「同一件事写两遍」不报错。别人没有这条缝：MCP SDK / Agent SDK / Vercel / pi 的 handler 参数类型都从那一份 schema 推导（`InferShape` / `Static<TParameters>` / `InferToolInput`）。
- **正确的分法**（与六个面一致）：
  1. **一份宿主契约 schema**（今天的 `generationPlanInputSchema` 一族）= 准入校验的唯一真相。
  2. **模型面 = 它的投影**：`VerbDeclaration.schema` 不再手写，改为 `project(hostSchema, { hide: [...], describe: {...} })`；字段名与宿主**逐字相同**；`laneToolSchema.mts` 已有的「生成 + 信息不丢门岗」机制直接套在投影上。
  3. **宿主自补是显式 `fill`，补完重新过 ①**——不是一条模型看不见的翻译。
  4. **审批策略按工具名 + 参数哈希**（已有），报价卡从 ①③ 的同一个对象渲染，`title` 那类字段不再需要「一路活到底」的门岗，因为它从来没离开过那一个对象。
  5. 真正有损的关系只剩**一条**：`references: string[]` → `{assetId}[]`。两个出路都比对应表便宜：宿主契约直接收 `string | {assetId,…}`（一份 schema 内的 union，`jsonArgTolerance.ts` 已有同款写法），或模型面就填 `[{assetId}]`。
- **前提变了怎么办**：若将来工具在同进程执行、或传输类型化（`RuntimeToolCall<T>`），上面 ②③ 不变（它们不依赖传输），只是 ④ 的哈希绑定可以退成引用相等。**反过来**，若有一天模型面**必须**与宿主面不同名（例如接入一个字段名固定的外部 skill 生态），再回到对应表——那时它是 Composio 那种「你不拥有执行端」的边界，前提成立。

## 5. §4 九项逐项判定

| # | 已落地项 | 判定 | 依据 |
|---|---|---|---|
| 1 | 多镜与单镜共用候选合成器（模型不再发明 `candidateId`/接线） | **对的方向，对的实现** | OpenAI 原句 *"Don't make the model fill arguments you already know"*（§2.4）；ChatCut 模型只给 asset ref（§2.6） |
| 2 | 镜头信封单一真相源 + 编译期穷尽性断言（`generationShotEnvelope.ts`） | **对的方向，对的实现**（但它治的是宿主**内部**五处投影，与「分几层」无关） | prior art 是「投影元数据挂在字段上、机器核」（MCP `x-mcp-header`，§2.1）。风险：R5 门岗用正则抓 `{a: x.a}` 重建是脆的，长期该由类型（`satisfies Pick<…>`）而不是文本扫描兜 |
| 3 | 动词↔宿主一致性门岗（R1–R5） | **对的方向，为一条本可消掉的缝造的尺子** | 内部面确实曾一道门都没有（评审 §3 的密度对比成立）。但 R1–R3 核的是「两份 schema 的复合成不成立」——投影化之后这个问题不存在，三条退化为子集断言；R4/R5 保留 |
| 4 | 翻译层从对应关系派生（`verbFieldMap.ts` + `verbTransportRoutes.ts`） | **对的方向，错的实现（第二好解）** | 方向对：对应关系必须被机器核，手写函数无人核（评审 §1 ②）。实现错：造了 7 种关系 × 4 档来源的翻译机去维护一条缝，而 9 条 rename 里 7 条的 `why` 是命名偏好（`verbTransportRoutes.ts:161,166-167,186,211,215,218,224,228`），按 R5.5 不是合法偏差；`defaults` 两条与宿主 `inherited`（§1 #7）重复。同族先例（MapStruct/AutoMapper）的适用前提是两边独立演化——我们不满足 |
| 5 | 参考图身份宿主解析（`resolveProjectAssetReferenceIdentity`） | **对的方向，对的实现** | ChatCut `referenceAssetIds` *"the backend resolves bytes server-side"*（§2.6）；Composio `beforeExecute` 宿主填值（§2.7） |
| 6 | 跨字段约束搬到动词面（`writeVerbs.ts:126-169` superRefine） | **对的方向，只做了一半** | zod `superRefine` **不进 JSON Schema**，模型在发出前看不到它，只在被拒时看到——而且它跑在 `laneTools.mts:237` 那次 zod 复验，不在 pi 的 ajv（§1 #3）。真正「发出前告知」= 写进 description（Anthropic *"extremely detailed descriptions … is by far the most important factor"*）或按 OpenAI *"Use enums and object structure to prevent invalid states"* 改结构（`shotId` 要 `draftId` → 拆成两个分支）。`role` 字段描述已隐含「锚被别的镜复用」，所以真机归零可信，但机制上是错误信息在教模型 |
| 7 | 技能不许复述注册表事实（`check:skill-tool-binding` 五类） | **对的方向，对的实现** | 所有面都把工具定义当唯一真相源（§2）；ChatCut 技能文本只讲选型与流程，工具性质在 schema 描述里（§2.6） |
| 8 | 失败形状两个出口收敛（`laneFailureFromDecision.ts`） | **对的方向，对的实现** | MCP 2026-07-28 把「输入校验失败」归 `isError`（模型可自纠）、`-32602` 只留给形状/未知工具（§2.1）——顺手核一下我们 `capability_input_invalid` 走的是哪一类 |
| 9 | `check:boundary-owners`（958 个 owner 核在位） | **与分层无关；方向对** | 不需要 prior art；它核的是「声明过的主人在不在」 |

## 6. 三条在跑的 lane 怎么办

| lane | 分支 | 处置 | 理由 |
|---|---|---|---|
| 翻译派生化 | `fix/verb-host-contract-sweep-20260918`（本文基线，已到 head e804cd3b1） | **让它落地，但冻结方向**：不再加关系种类、不再加 rename；下一刀是**做减法**——把 7 条偏好 rename 改成同名（改 `list_models` 输出与 verb 字段名，不改宿主），删 `defaults` 两条（宿主 `inherited` 已做），只留 `references`（有损）与 `absentOn`（领域约束）。表缩到那一步时 `verbFieldMap.ts` 可整个删、换成 `project(hostSchema, {hide, describe})` + `fill` | 它今天是内部面唯一会红的东西，撤掉比留着贵；但继续往里加关系就是在给缝加固 |
| 技能加载迁 pi | `fix/skill-loading-align-pi-20260918` | **不受影响** | 它治的是 D 类（技能复述注册表），与「模型面 vs 宿主面分几层」正交；`check:skill-tool-binding` 第五类（字段值要过 verb schema）在投影化之后照样成立，只是 schema 来源换成投影 |
| 合账本 | `fix/storyboard-single-ledger-20260918` | **不受影响** | 它治的是分镜表 0/23 可见（两套账本），在宿主内部；它 merge 了翻译派生化分支，随那条一起落 |

**一句话**：三条都不用停；变的是**翻译派生化的下一步方向**（减法，不是加法）。

## 7. R5.5 三列表：规范链接 / 我们的偏差 / 偏差理由

工具 schema 是对外也读写的契约（外部 MCP 宿主也调），按 R5.5 逐条登记。理由只许是领域约束；下面标「**偏好**」的按规则不成立。

| 规范 / 先例 | 我们的偏差 | 偏差理由（领域约束才算） |
|---|---|---|
| MCP 2026-07-28：一份 `inputSchema` 同时给模型与校验（https://modelcontextprotocol.io/specification/2026-07-28/server/tools ；TS SDK `mcp.ts:240-274`） | 内部面两份手写 schema（verb / host）+ 对应表 | **偏好 + 传输抹平类型**。无领域约束要求两份；应改为投影（§4） |
| MCP：`-32602` 只留形状/未知工具，语义校验失败归 `isError` | `capability_input_invalid` 等码的归类**未核** | 待核（§9） |
| MCP：审批在宿主、作用于模型原始参数；`ToolAnnotations` 只是 hint | `laneApprovalGate` 在 `before_tool` 看模型参数 ✓；报价卡看翻译后宿主形状 | 报价需要宿主解析（目录、钳制、单价）——**领域约束成立**；但卡与模型调用之间应共享同一对象（§4 ④），不是靠翻译正确 |
| MCP `x-mcp-header`：字段级投影元数据挂在 schema 上、客户端 MUST 核 | 信封字段用 `GENERATION_SHOT_ENVELOPE_KEYS` + 正则门岗 R5 | 同一思路的仓内实现，**无偏差**；正则实现是权宜 |
| Claude Code `updatedInput`：宿主改写后**重新过准入** | 翻译层自补后不重过审批闸 | **无领域理由**；投影化 + `fill` 后重过 ① 即可消掉 |
| Claude Code `_meta["anthropic/requiresUserInteraction"]`：花钱工具的闸是定义上的一个声明、模式与钩子都跳不过 | 我们用 `effect: "spend"` 只许宿主 profile + `paidBoundary` + `nextAction: user_sees_spend_card` | 同一思路（声明在定义上、装配期核），**无偏差**；对外 MCP 面可考虑同时发 `_meta` 让 Claude Code 宿主也强制弹窗（§9 未证实它读第三方 server 的这个键） |
| OpenAI：*"Don't make the model fill arguments you already know"* | A1/A2 已修 ✓；**外部面仍广播 `candidate: generationCandidateSchema`（`candidateId/revision/moduleId/mode`）与 `references[].contentHash/version`**（`mcpGenerationToolCatalog.ts:22-30`） | 无领域理由；见 §8 |
| pi：`execute(params: Static<TParameters>)`，校验一次 | 我们在 `execute` 内再 zod 校验一次（§1 #3） | **领域约束成立**（superRefine 只有 zod 能跑），但两份文件头对「校验几次」说法矛盾（§1），要改一处 |
| ChatCut：模型别名 → 供应商参数的翻译在 handler 内、并在描述里公开 | 我们的翻译在独立表里、模型看不见 | 偏好；且 ChatCut 的做法印证「翻译在 handler、名字对模型公开」就够 |
| Vercel：审批绑定 `hashCanonical(input)` | `JSON.stringify` 逐字比对（`laneExtendedDesktopPorts.ts:169`） | 同一意图；键序敏感是**已知弱点**（zod parse 后键序稳定，今天没炸） |

## 8. 清单 14 条都没覆盖的那一条

**对外 MCP 面把宿主契约 schema 原样广播给外部模型，A/E 两类缺陷在外部面以另一种形式存在，而外部面那道门岗看不见它。**

- `electron/capabilityCore/mcpGenerationToolCatalog.ts:22-30`：`generationTransportSchema = generationPlanInputSchema.options[1].omit({operation}).extend({leaseHandle, projectId, operationId, vendor, modelKey, patch})`，`:62` 直接 `inputSchema: generationInputSchema`。于是外部模型（Claude Code 当 MCP 宿主时）看到的 `candidate` 是 `generationCandidateSchema`——要 `candidateId / revision / moduleId / mode`，全是模型拿不到的内部身份（清单 A1 的外部版）；`references[]` 的 `contentHash / version` 也一并广播（A2 的外部版，只是今天已改可选）。
- `scripts/check-mcp-operation-constructible.mjs` 只证「**最小实例**可构造」（头注释：*"只填必填"*）——`candidate` 可选，不填就绿。它核不到「模型拿得到这个值吗」（`verbTransportRoutes.ts:28-33` 的 `from-read:` 核只在内部面有）。
- `:33-52` `buildOperationCreateParams` 是外部面的**手写逐字段拷贝**（B2/E1 那一族），`createFields` 每加一个字段这里就静默丢一个；`:43-49` 又手写了一遍 `vendor→providerId` / `modelKey→modelId`——**同一条 rename 现在有三份实现**：内部表（`verbTransportRoutes.ts:161-167`）、外部 build（这里）、宿主 `inherited`（`mcpGenerationMultiShot.ts:359-366`）。
- 它为什么没进清单：清单按「内部面一天挖出来的」收，而它在外部面；评审 §3 说「对外 MCP 面（早就有第二道门）干净得多」——干净的是**可构造性**，不是**可填性**。投影化（§4）把两个面变成同一份宿主 schema 的两个投影后，这一条与内部面的 A 类一起消失。

## 9. 未证实 / 没查到的

- MCP 现行版 2026-07-28 的 `x-mcp-header` / `InputRequiredResult` 两节：原文由本人抓取的版本页 + schema.ts 确认存在，**逐句条文未逐字复核**（引用来自同日抓取的规范页）。
- Claude Code 是否对**第三方** MCP server 的 `_meta["anthropic/requiresUserInteraction"]` 也强制弹窗：文档写在 `/mcp` 页，语义上是的，**未真机验**。
- ChatCut app 进程内的校验实现（`out/main/mcp/server.js` 之后）**不可见**；结论只基于它广播的 `inputSchema` 与技能文本。
- 我们 `capability_input_invalid` 一族在对外 MCP 面走 `isError` 还是 `-32602`：**未核**。
- Codex `ToolHandler` trait 的确切签名：clone 里 grep 未命中（文件组织已变），本文只引用了 `*_spec.rs` / handler 的 `ToolPayload::Function { arguments }` 与 `sanitize_json_schema`，均为本人读到的 file:line。
- Codex `view_image.rs` handler 侧 `detail: Option<String>`、`app-server-protocol` 的 `derive(JsonSchema, TS)` + 漂移测试、`orchestrator.rs:142` 审批位置：来自 agent 报告，**本人未逐行复核**（spec 侧 `detail` 枚举与 `timeout_ms` 漂移已本人复核）。
- 「投影化后 `verbFieldMap.ts` 可整个删掉」是设计推断，**没做原型**；`references` 那一条要选 union 还是模型面填对象，需要看 `modelVisibleJsonSchema` 对 union 的发布（Google legacy 路径不支持 `anyOf`，`modelArgumentTolerance.ts:30-34` 已记）。
