# Agent 工具面：从第一性原理重新设计

> 状态：📋 **设计草案 · 讨论期，未拍板**（2026-09-11）
> 分支 `design/agent-tool-face-first-principles-20260911`，只出文档，不改产品代码。
> 起因：09-11 真机「模型说了报价卡、面板没卡、画布有节点」。表面是 4 个工具都能把节点放上画布、只有 1 个会弹卡；
> 深挖后确认**工具面是按代码分层长出来的**（`canvasModelTools.ts` / `extendedModelTools.ts` / `productionRunDescriptors.ts` 三处各写各的），不是按用户的动词长出来的。
> 用户 16:50 指示：不是「去重」，是**重设计**。
> 相关：`docs/plan/2026-09-11-close-agent-doors.md`（分支 `plan/close-agent-doors-20260911`，关门方案——本文档的结论会改变它的推荐；见 §9）。
> 所有 `file:line` 对 `origin/main` af3652e1c 核实。

---

## 0. 一页读懂（D6）

**真实摩擦**：用户说「生成一张开场图」。模型面前有四扇门都能把一个节点放上画布，只有一扇会弹报价卡；
而那扇正确的门，自己的说明书上写着 `This host cannot preview or start paid generation`。模型选错门是理性的。
用户看到节点出现了、模型说「做好了」，等图——图永远不来。他不会觉得「模型选错工具」，只会觉得「Nomi 的 AI 坏了」。

**为什么去重治不好**：四扇门不是四个重复，是四个**代码层**各自把「往画布放节点」投影成一个工具
（画布契约、生成契约、生产 Run 契约、分镜契约）。去掉三扇，下一个按代码层加的契约还会长出第五扇。
根因在**生成动词的方向**：今天的工具集 = 我们的模块清单；它应该 = 用户会要求的状态变化清单。

**这份文档做的事**：从「世界有哪些状态 × 用户会要求哪些变化」推出**20 个动词**（内部面），每个动词只改一种状态、只有一种效果类别；
花钱不是任何动词；每个写动词的返回值都说清「用户接下来会看到什么」。登记在案的 58 个工具名（37 内部面 + 13 外部独有 + 8 契约上有名但未投影）逐个映射到这 20 个。

**要权衡的那一个东西**：**把「生产 Run」那 10 个工具从模型面上拿掉**（§5.3）。
Run 是我们的流水线状态机，它的「产物版本 / 门 / 信任级」在用户的世界里都有对应物（文稿、分镜、报价卡、审批档），模型不需要第二套词。
代价：Goal 模式（长任务）的宿主侧要自己驱动 Run，模型只用同一套 20 个动词——这是一次不小的重构，但它同时消掉三扇门。

---

## 1. 出发点（主会话已定的 7 条原则，本文档当约束）

| # | 原则 | 在本文档里变成什么 |
|---|---|---|
| 1 | 工具集 = 模型的动作空间；动词从「世界有哪些状态」×「用户会要求哪些状态变化」推出来 | §3 状态清单 → §4 话术 → §5 动词 |
| 2 | 一个动词只改一种状态、只有一种效果类别（`read / reversible_local / spend / irreversible`） | §6 每个动词一格 `effect`；`check:tool-face` 规则 T1 |
| 3 | 模型看到的世界 = 用户看到的世界 | 读动词返回界面上的东西（节点状态、待确认卡、选区）；§6.1 |
| 4 | 花钱永远不是模型的动词；但返回值必须告诉模型「用户接下来会看到什么」 | `nextAction` 约定 §6.2；内部面装配期禁 `spend` |
| 5 | 动词用用户的词，全套一种语言 | 名字取自 `docs/GLOSSARY.md` 的规范名；描述统一英文（模型读的那份），中文进 i18n 表 |
| 6 | 动词数以覆盖全部真实话术为准，越少越好 | 42 句话术 → 20 个动词，每个动词至少被 1 句话术命中 |
| 7 | 不留安全阀门：非法入口只能拒绝并报错 | 错工具进来 = 拒绝 + 错误里点名正确动词；**没有**「悄悄转进正门」 |

---

## 先查别人

> R5 / R6 / R29。问的是四件事：**动词粒度**（一个工具管多大一件事）、**命名**、**描述结构**、**效果怎么标**、**返回值怎么告诉模型下一步**。
> 标 **[官方]** = 厂商文档 / 源码原文；标 **[社区]** = 逆向或第三方，只当佐证。引文均为原文，出处带 URL 或 file path（2026-09-11 抓取；Codex `02a8f03`、Cline `a7c1dfc`、Gemini CLI `ed2ac40`）。

### 2.1 Anthropic · Define tools **[官方]**

`https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools`

- 描述是产品：*"Provide extremely detailed descriptions. This is by far the most important factor in tool performance."* 四要素原文：*"What the tool does"* / *"When it should be used (and when it shouldn't)"* / *"What each parameter means and how it affects the tool's behavior"* / *"Any important caveats or limitations, such as what information the tool does not return"*；*"Aim for at least 3–4 sentences for each tool description."*
- 范例的五步顺序（good 例逐句）：做什么 → 输入约束 → 返回什么 → 何时用 → **明说不做什么**（*"It will not provide any other information about the stock or company."*）。
- 粒度：*"Consolidate related operations into fewer tools. Rather than creating a separate tool for every action (`create_pr`, `review_pr`, `merge_pr`), group them into a single tool with an `action` parameter."* / *"Fewer, more capable tools reduce selection ambiguity."*
- 命名：*"Use meaningful namespacing in tool names… `github_list_prs`, `slack_send_message`."* 正则 `^[a-zA-Z0-9_-]{1,128}$`。
- 返回值：*"Return semantic, stable identifiers… and include only the fields Claude needs to reason about its next step."*

### 2.2 Anthropic · Writing tools for agents / Building effective agents **[官方]**

`https://www.anthropic.com/engineering/writing-tools-for-agents` · `https://www.anthropic.com/engineering/building-effective-agents`

- 反模式点名：*"A common error we've observed is tools that merely wrap existing software functionality or API endpoints—whether or not the tools are appropriate for agents."* —— **这就是 §7.4 C1 的病名**：我们的工具面是 capability 契约（按 port 分层）的包装。
- 合并的形状：`list_users`+`list_events`+`create_event` → **`schedule_event`**；`get_customer_by_id`+`list_transactions`+`list_notes` → **`get_customer_context`**。*"By selectively implementing tools whose names reflect natural subdivisions of tasks, you simultaneously reduce the number of tools… and offload agentic computation."*
- 重叠的代价：*"Too many tools or overlapping tools can also distract agents from pursuing efficient strategies."* / *"Make sure each tool you build has a clear, distinct purpose."*
- 返回值是控制通道：*"If you choose to truncate responses, be sure to steer agents with helpful instructions."* / 错误 *"clearly communicate specific and actionable improvements, rather than opaque error codes or tracebacks."* / 去掉 *"low-level technical identifiers (for example: `uuid`, `256px_image_url`, `mime_type`)"*。
- Poka-yoke：*"Change the arguments so that it is harder to make mistakes."*（把相对路径改成必须绝对路径后 *"the model used this method flawlessly"*）。**注意这是「改参数让错误不可表达」，不是「错了悄悄转正门」**——原则 7 的出处。
- 评测：*"Prompts should be inspired by real-world uses and be based on realistic data sources."* / *"We actually spent more time optimizing our tools than the overall prompt."*

### 2.3 Claude Code 工具集 **[官方 docs + 发行包 `sdk-tools.d.ts`]**

`https://code.claude.com/docs/en/tools-reference.md` · `https://code.claude.com/docs/en/permissions.md` · `@anthropic-ai/claude-code@2.1.268/sdk-tools.d.ts`

- 全集 ≈45 个（`Read/Write/Edit/NotebookEdit/Glob/Grep/LSP/Bash/Monitor/Agent/Skill/ToolSearch/TodoWrite/EnterPlanMode/ExitPlanMode/Task*/Cron*/WebFetch/WebSearch/AskUserQuestion/Artifact/…`），但**分层**：少数常驻，其余 deferred，*"Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked."*
- 命名 PascalCase 名词/动词单词；描述结构 = 一句动词从句 + 操作规则 bullets + **否定规则**：`Read` *"Do NOT re-read a file you just edited to verify"*；`Write` 直接以 *"When to use:"* 开头并指路 *"For partial changes, use Edit instead."*；`Edit` 前置条件 *"You must Read the file in this conversation before editing, or the call will fail."*
- 效果/权限**不在工具上**，是 harness 的独立层：*"Permission rules are enforced by Claude Code, not by the model."* 按名 + 顶层标量参数匹配（`Agent(model:opus)`），主内容字段刻意**不可匹配**：*"A rule like `Bash(command:rm *)` would be bypassable by a compound command, so Claude Code ignores it."* 权限跨工具按**效果**写：*"An `Edit(...)` allow rule also grants read access to the same path."*
- 返回值是结构体，带继续/状态信号：`FileReadOutput.truncatedByTokenCap`、`GlobOutput.countIsComplete`、`BashOutput.backgroundCwdHint`（源码注释原话 *"Model-facing note that the session cwd was not changed"*）、`FileEditOutput.userModified`（*"Whether the user modified the proposed changes"*——**结果告诉模型「人插手了」**）。

### 2.4 pi SDK（我们的运行时底座）**[官方 docs + 发行包 0.85.1]**

`https://pi.dev/docs/latest/sdk` · `https://pi.dev/docs/latest/extensions` · `@earendil-works/pi-coding-agent@0.85.1/docs/extensions.md`、`dist/core/tools/*.js`

- `defineTool` 字段：`name / label / description / promptSnippet / promptGuidelines / parameters / constrainedSampling / renderShell / prepareArguments / executionMode / execute / renderCall / renderResult`。**没有任何效果/权限字段**；拦截靠事件：`pi.on("tool_call")` 可改 `event.input` 或 `return { block: true, reason }`。文档明说：*"It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash."*
- 内建 8 个（`read/bash/edit/write/grep/find/ls/powershell`），**默认只启 4 个**：*"Tools to include in prompt. Default: [read, bash, edit, write]"*。
- 三通道（我们已镜像：`lanePromptSections.ts`）：`description` 进 schema、`promptSnippet` 进 `Available tools:`、`promptGuidelines` 进 `Guidelines:` 且只在工具启用时出现。关键警告：*"Each guideline must name the tool it refers to — avoid 'Use this tool when...' because the LLM cannot tell which tool 'this' means."*
- 返回值指路（`read.js` 源码注释 *"Build an actionable continuation notice"*）：`[Showing lines 12-2012 of 8400. Use offset=2013 to continue.]`；错误也是指令：`Offset 9000 is beyond end of file (8400 lines total)`。
- 错误信号：*"To mark a tool execution as failed … throw an error from `execute`. Returning a value never sets the error flag."*（与 MCP 的 `isError:true` 相反——两套约定，选一套并让另一套写不出来。）
- 并行是默认，写工具要排队：*"two tools can read the same old file contents, compute different updates, and then whichever write lands last overwrites the other."*（`withFileMutationQueue`）

### 2.5 OpenAI Codex CLI（`codex-rs`）**[官方源码]**

`https://github.com/openai/codex` · `codex-rs/core/src/tools/handlers/*_spec.rs`、`protocol/src/protocol.rs:992`、`prompts/templates/permissions/**`

- **粒度极粗**：一个做事动词 `exec_command`（*"Runs a command in a PTY, returning output or a session ID for ongoing interaction."*）+ 一个改文件动词 `apply_patch`（自由文法，*"This is a FREEFORM tool, so do not wrap the patch in JSON."*）；没有 `read_file/grep/ls`——提示词让模型在 shell 里用 `rg`。其余是编排/通信（`update_plan / request_user_input(_async) / send_message_to_user_async / tool_search / spawn_agent / wait_agent…`）。
- 命名 `snake_case` `verb_object`，偶有点号命名空间（`clock.sleep`）。描述一句话；「何时用/何时不用」住在**参数描述**与**按策略切换的提示词片段**里（`approval_policy/never.md` 全文：*"Approval policy is currently never. Do not provide the `sandbox_permissions` for any reason, commands will be rejected."*）。
- 效果**不是工具元数据，是调用参数**：`sandbox_permissions: use_default | with_additional_permissions | require_escalated`、`justification`（*"User-facing approval question for `require_escalated`; omit otherwise."*）、`prefix_rule`；策略枚举 `AskForApproval { UnlessTrusted, OnRequest, Granular(...), Never }`。补丁安全另有三值裁决 `SafetyCheck::{AutoApprove, AskUser, Reject{reason}}`。
- 升级是**重试循环**不是预检：*"rerun the command with \"require_escalated\". ALWAYS proceed to use the `justification` parameter - do not message the user before requesting approval."* 且 *"Prefer requesting sandboxed additional permissions instead of asking to run fully outside the sandbox."*
- 返回值有 `output_schema`：`exit_code / session_id（"to pass to write_stdin when the process is still running"）/ original_token_count / output`；截断带头 `Warning: truncated output (original token count: N)`；拒绝归一成 `"exec command rejected by user"`。
- 曝光分层 `ToolExposure::{Direct, Deferred, DeferredModelOnly}` + `tool_search`（BM25）。

> 对 `close-agent-doors` 引 Codex 当「归一先例」的更正：Codex 归一的是**沙箱升级的重试路径**（同一个动词、换一个参数再来一次），不是「错动词悄悄改成对动词」。它的拒绝是显式的（`Reject{reason}`、`"rejected by configuration"`），模型看得见。

### 2.6 Cline **[官方源码，两代]**

`https://github.com/cline/cline` · `sdk/packages/core/src/extensions/tools/definitions.ts`、`apps/vscode/src/sdk/sdk-tool-policies.ts`、v3.17.9 `src/core/prompts/system.ts`

- 现役集：`read_files / search_codebase / run_commands / fetch_web_content / apply_patch / editor / skills / ask_question / submit_and_exit`。每条描述都写**批量**（*"call this tool in the same response as other independent tool calls"*）与**截断预算**（*"Output beyond ~Nk characters is middle-truncated"*）；`editor` 是刻意的反 shell 动词（*"over shell commands"*）；`submit_and_exit` 带结构标记 `lifecycle: { completesRun: true }`。
- 效果：宿主里**硬写名单** `isReadTool([...]) / isEditTool([...]) / isCommandTool / isBrowserTool`，不是工具元数据；Plan/Act = **换工具集 + shell 黑名单**，作者自陈：*"This is a simple blacklist, not a shell interpreter… It will not catch every possible mutation."*
- 上一代 `requires_approval`（模型自报风险）原文：*"A boolean indicating whether this command requires explicit user approval before execution in case the user has auto-approve mode enabled. Set to 'true' for potentially impactful operations like installing/uninstalling packages, deleting/overwriting files… Set to 'false' for safe operations like reading files/directories…"*；官方文档承认：*"These are examples, not guarantees."* **v3→v4 的走向：模型自报风险退役，改宿主判。**
- 上一代一回合一工具（*"You can use one tool per message"*）已被批量取代。改完文件把整份文件回给模型并说 *"You do not need to re-write the file with these changes, as they have already been applied."*

### 2.7 Cursor **[官方 docs]**

`https://cursor.com/docs/agent/overview.md` · `https://cursor.com/docs/agent/security/run-modes.md` · `https://cursor.com/docs/cli/reference/permissions.md`

- 不公开模型面描述，只有人读的类别语（Search files / Web / Fetch Rules / Read files / Edit files / Run shell commands / Browser / Image generation / Ask questions）。`Ask questions` 是**非阻塞**的：*"While waiting for your response, the agent continues reading files, making edits, or running commands."*
- **权限词表与工具词表解耦**——五个能力 token 覆盖所有工具：`Shell(cmd) / Read(glob) / Write(glob) / WebFetch(domain) / Mcp(server:tool)`，allow/deny 两表，*"Deny rules take precedence over allow rules."* 加一个工具不加一个权限概念。
- 三档运行模式：Auto-review（allowlist → sandbox → 分类器模型 → 人）/ Allowlist / Run Everything；官方自警：*"Auto-review is not a security boundary — The classifier can make mistakes."*

### 2.8 Gemini CLI **[官方源码]**（附）

`https://github.com/google-gemini/gemini-cli` · `packages/core/src/tools/tools.ts:1104`

- 唯一在工具对象上**声明效果类**的：
  ```ts
  export enum Kind { Read, Edit, Delete, Move, Search, Execute, Think, Agent, Fetch, Communicate, Plan, SwitchMode, Other }
  export const MUTATOR_KINDS   = [Kind.Edit, Kind.Delete, Kind.Move, Kind.Execute];   // 审批路由
  export const READ_ONLY_KINDS = [Kind.Read, Kind.Search, Kind.Fetch];                // 并行安全
  ```
  一个字段两件事：**审批**与**并行**。确认结局有七种：`ProceedOnce | ProceedAlways | ProceedAlwaysAndSave | ProceedAlwaysServer | ProceedAlwaysTool | ModifyWithEditor | Cancel`——`ModifyWithEditor`（改了再批）就是我们付费卡「卡上改参数直接生成」（09-10 拍板 3）的同类。
- 描述里写**返回契约**：`run_shell_command` 结尾 *"The following information is returned: Output… Exit Code: Only included if non-zero… Background PIDs: Only included if background processes were started."*；`write_file` 明说 *"The user has the ability to modify 'content' before it is saved."*
- 同一能力**按模型家族换措辞**（`default-legacy.ts` vs `gemini-3.ts`）。

### 2.9 MCP 规范 **[官方]**（我们对外面的协议）

`https://modelcontextprotocol.io/specification/2025-06-18/server/tools`

- `ToolAnnotations = { title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint }`，SDK 注释：*"all properties in ToolAnnotations are hints… Clients should never make tool use decisions based on ToolAnnotations received from untrusted servers."*（我们 `capabilityApprovalPolicy.ts` 的「只抬不降」正是照此写的。）
- 有状态工具：*"returning an explicit handle from a creation tool and accepting that handle as an argument on subsequent calls"*；*"A call against an expired or unknown handle should return a tool execution error that says so, so the model can recover."*
- 两种错误：协议错误 vs 执行错误（*"contain actionable feedback that language models can use to self-correct"*，`isError: true`）。

### 2.10 归纳：五个维度上别人怎么做，我们取什么

| 维度 | 别人的共识 | 分歧 | 本文档取 |
|---|---|---|---|
| **动词粒度** | 按「任务的自然切分」定，不按 API/模块（Anthropic `schedule_event`）；重叠 = 选错的直接原因 | Codex 一个 shell 动词 vs Gemini/Cline 专用动词「PREFERRED over shell」；Anthropic 建议 `action` 枚举合并，而 #547 实测 9 分支单工具 0/18 | **按状态切**：一个状态一个写动词；合并只在**字段同形**时做（`write_script.where`），异构分支不合并（这是 Anthropic 建议与 #547 数据的交点） |
| **命名** | `snake_case verb_object`；多服务器加前缀命名空间 | Cline 用名词（`editor`）；Claude Code 用 PascalCase 单词 | `动词_对象`，对象取 GLOSSARY；外部面机械加 `nomi_` |
| **描述结构** | 做什么 → 何时用 → **何时不用 + 该用谁** → 参数从哪来 → 返回/截断契约；≥3–4 句 | 住哪：Anthropic 全进 description；pi 三通道；Codex 进参数描述 + 按策略换的提示词片段 | 五槽结构化（§6.1），后果句**派生**；三通道保留 |
| **效果标注** | 要有，且要由**宿主**执行，不由模型自报（Cline 退役 `requires_approval`；Claude Code「enforced by Claude Code, not by the model」） | Gemini 声明在工具上 / Cline 宿主名单 / Codex 调用参数 / Cursor 独立能力格 | **Gemini 的声明 + Cursor 的解耦**：一个 `effect` 枚举（四值）住在声明上，审批与并行都从它派生；用户面前的权限概念只有「读 / 改（可撤）/ 花钱 / 撤不回」四个，不随动词数长 |
| **返回值 → 下一步** | 返回值是控制通道：截断续读指令、`session_id` 该传给谁、`userModified`「人插手了」、错误写成指令 | 错误信号：pi 必须 throw vs MCP `isError` | `nextAction.kind + userSees`（§6.2）；`wrong_verb` 错误点名正确动词；内部用 throw（pi 约定），外部映射成 `isError` |

三条**没人这么做、而我们要做**的（都来自 Nomi 的领域约束，不是偏好）：
1. **「花钱」从动词表里整个拿掉**——别人的危险动作（`rm`、`git reset --hard`）仍是模型可调的，只是要批；我们的钱只有宿主能花。理由：09-08/09-10 拍板「每次提交看报价确认」，报价由宿主算、模型算不出（`productionPendingSpend.ts` 注释①）。
2. **返回值里写「用户看到了什么」**——Claude Code 的 `userModified` 是最近的先例，但没人把「面板上此刻有一张卡」当返回字段。理由：Nomi 的面板与画布是模型看不见的第二个观众。
3. **拒绝而不是转发**——Anthropic 的 poka-yoke 是「改参数让错误不可表达」，Codex 的归一是同动词重试；没有一家在错动词上做静默转发。原则 7 与它们一致，与 `close-agent-doors` 的甲案不一致。

---

## 3. 状态清单：Agent 能碰到的全部状态

> 判据：一个「状态」= 用户在界面上看得见、且有一个明确 owner 层的东西。owner 层决定谁来执行与谁来撤销；效果类别决定审批闸怎么对它。
> 效果类别只有四个值：`read`（不改）/ `reversible_local`（改了、能撤、不花钱）/ `spend`（花用户的钱）/ `irreversible`（撤不回）。

| # | 状态（用户的词） | 用户在哪看到它 | owner 层 | 模型可读 | 模型可改 → 效果类别 | 今天谁在改它（file:line） |
|---|---|---|---|---|---|---|
| S1 | **项目**（哪个项目打开着） | 项目库 / 标题栏 | 主进程 project store | 是（上下文注入，不需要工具） | 内部：否；外部 MCP：新建项目 → `reversible_local` | `mcpToolCatalog.ts:296 nomi_project_create` |
| S2 | **文稿**（创作区文本、光标、选区） | 创作区 | 渲染层编辑器（`activeDocumentId`） | 是 | 插入/替换/追加 → `reversible_local`（进撤销栈） | `documentModelTools.ts` 5 个工具 |
| S3 | **镜头**（画布上的生成类节点：标题、提示词、模型、参数、参考、状态） | 生成画布 + 分镜表 | 渲染层画布 store（Zustand，`@xyflow/react` 单内核 R23）；**草稿正本在主进程 Run 域** | 是 | 建/改草稿 → `reversible_local`（09-10 拍板：草稿建即落画布） | 四扇门：`canvasModelTools.ts:149`、`:157`、`extendedModelTools.ts:53`、`productionRunDescriptors.ts:91` |
| S4 | **分镜**（镜头的表格视图 + 视觉锚：角色/场景/道具/风格） | 分镜表 | 同 S3（分镜表 = 画布节点的投影，09-09 拍板方案 B） | 是（与 S3 同一次读） | 同 S3 | `nomi_storyboard_write propose/patch` |
| S5 | **画布布局**（连线、分组/Frame、位置、标题） | 生成画布 | 渲染层画布 store | 是 | 连线/编组/整理/改名 → `reversible_local` | `nomi_canvas_write connect/tidy` |
| S6 | **手艺产物**（Agent 自己写的 SVG/HTML/Markdown/表格节点） | 生成画布 | 渲染层画布 store（`nodes/artifact/`） | 是 | 建 → `reversible_local` | `nomi_canvas_write create_canvas_nodes kind=artifact` |
| S7 | **站位/运镜参考**（导演台灰模） | 画布 director 节点 | 渲染层 `nodes/director/agent/` + 常驻 Host 离屏出图 | 是 | 建 → `reversible_local`（离屏渲染，不花钱） | `nomi_shot_reference_write` |
| S8 | **待确认的生成**（报价卡：模型·逐镜价·合计） | 面板介入槽 | 主进程 `productionPendingSpend.ts`（`origin.host==="nomi"` 才投影） | **是（今天不能）** | 「把草稿摆到用户面前」→ `reversible_local`（卡可关）；**点头 = 用户动作** | 只有 `nomi_generation_plan create` 会出卡（`generationTransportAdapters.ts:201`） |
| S9 | **生成任务**（已提交的付费工作：进度、结果、花了多少） | 节点状态 + 任务卡 | 主进程 Run 域 + 供应商 | 是 | 开始 → **`spend`（宿主独占）**；取消 → `irreversible`（撤不回、已花的不退） | `generation.ts:GATE` 3 个别名（不投内部）；`nomi_generation_status cancel` |
| S10 | **钱**（单价、报价、已花） | 报价卡 / 节点角标 | 主进程目录 `model.pricing` + Run 收据 | 是（随 S8/S9 读回） | **否**（永远不是模型的动词） | `shotPricing.ts` |
| S11 | **模型接入**（用户有哪些模型、模式、参数、参考槽、单价） | 设置 · 模型 / 节点模型下拉 | 主进程目录 + 用户供应商设置 | 是 | 接入（填 key）→ **宿主/用户独占**；模型只能「打开接入面」→ `reversible_local` | `laneModelRead.mts nomi_read`、`nomi_generation_plan context`、`mcpIntegrationTools.ts nomi_integration` |
| S12 | **时间轴**（fps、轨道、片段、字幕、转场、`revision`） | 时间轴预览 | 渲染层 timeline store（乐观锁 `revision`） | 是 | 编辑计划 → `reversible_local` + **先看再批**（`requiresPlanReview`）；撤销 → `reversible_local` | `apply_edit_plan` / `undo_timeline_edit` |
| S13 | **素材**（素材库：id、时长、编码、波形） | 素材库 | 主进程 asset store | 是 | 导入 → `reversible_local`（外部宿主才有文件路径）；删除 → `irreversible`（今天不给模型） | 5 个 `asset.read`；`nomi_asset_import` |
| S14 | **导出**（MP4 任务：进度、落盘、验证） | 导出面板 | 渲染层 export port | 是 | 开始 → `irreversible`（写文件/覆盖）；取消 → `irreversible` | `export_timeline` / `cancel_export_job` |
| S15 | **技能**（已装技能、技能正文） | 技能库 / 面板 chip | 主进程 skill store | 是 | 保存 → `reversible_local`（可删） | `load_skill` / `author_skill`（未投影） |
| S16 | **审批档与工作模式**（每步问/自动改/全自动；只看/改选区/自主） | 面板顶部 | 宿主快照（`capabilityApprovalPolicy.ts`） | 是（应随读回：模型该知道「这一步会不会停下来问」） | **否**（用户独占；模型改档 = 越权） | — |
| S17 | **选区与焦点**（画布选中了什么、文稿选了哪段、哪个面板在前） | 各面 | 渲染层 | 是 | 布局 → `reversible_local`（`layout.write` 存在但无话术证据，本轮不给动词） | `layout.ts`（未投影） |
| S18 | **生产 Run**（brief/playbook 流水线：阶段、门、产物版本、信任级） | **用户看不见「Run」**；他看到的是 S2/S3/S8/S16 | 主进程 `productionRun/` | 今天是 | 今天 10 个工具；**本文档主张：不是模型的状态**（§5.3） | `productionRunDescriptors.ts` 10 个 |
| S19 | **设置**（语言、主题、供应商 key） | 设置 | 宿主 | 否 | 否 | — |

**三条从表里直接读出来的事实**：

1. **S3/S4/S8 是一个状态的三面**（镜头草稿 = 分镜表的一行 = 报价卡上的一镜），今天由四个不同层的工具各自写。「一个状态一个写动词」是 §5 的第一刀。
2. **S8「待确认的生成」今天模型读不到**。它只会在 `nomi_generation_plan create` 的副作用里出现，成功返回值是裸 JSON（`laneExtendedTools.ts:22` `JSON.stringify(decision.result)`），没有一个字说「用户面前现在有一张卡」。原则 4 在返回值那一半今天是空的。
3. **S18「Run」不是用户的状态**。它的每个可见后果都已经是别的状态：产物版本 = 文稿/分镜的版本；门 = 报价卡与计划审阅；信任级 = 审批档。10 个工具是在让模型驱动我们的状态机。

---

## 4. 话术 → 动词

> 42 句用户会对 Nomi 说的话（中 26 / 英 16），新手与老手各半，覆盖 图 / 视频 / 分镜 / 改图 / 连线 / 整理 / 查状态 / 取消 / 接模型 / 用技能 / 导出 / 文稿。
> 每句标：要改哪个状态（§3 编号）、效果类别、**首个正确动词**（§5 的名字）。这张表就是 R30 题库（§7.1）。

| # | 用户说 | 谁 | 改哪个状态 | 效果 | 首个正确动词 → 接着 |
|---|---|---|---|---|---|
| 1 | 生成一张开场图 | 新手 | S3 建草稿 → S8 出卡 | reversible_local | `draft_shots` → `generate` |
| 2 | 帮我把这段文案拆成 6 个镜头 | 新手 | S2 读 → S3/S4 建 6 个草稿（**不出卡**） | reversible_local | `read_script` → `draft_shots` |
| 3 | 把第 3 镜的提示词改成夜景 | 老手 | S3 改草稿 | reversible_local | `look_at_canvas` → `draft_shots(shotId)` |
| 4 | 这 6 镜全部生成 | 老手 | S8 一张批量卡 | reversible_local（点头是用户的） | `generate(shotIds[6])` |
| 5 | 第 2 镜用 Kling 重新出一版，5 秒 | 老手 | S3 改模型/参数 → S8 | reversible_local | `list_models` → `draft_shots` → `generate` |
| 6 | 把这张图的背景换成雪山 | 新手 | S3 新草稿（image_edit，参考=原图）→ S8 | reversible_local | `draft_shots(taskKind=image_edit, references)` → `generate` |
| 7 | 先别生成，我看看你排的镜头 | 新手 | 无（读） | read | `look_at_canvas`（回复只转述，不调 `generate`） |
| 8 | 现在画布上有什么 | 新手 | 读 S3/S5 | read | `look_at_canvas` |
| 9 | 那张图生成好了吗 / 花了多少 | 新手 | 读 S9/S10 | read | `check_job` |
| 10 | 取消正在跑的那条视频 | 老手 | S9 取消 | irreversible（问） | `check_job` → `cancel_job` |
| 11 | 把开场镜和第二镜连起来，作为参考 | 老手 | S5 连线 | reversible_local | `look_at_canvas` → `arrange_canvas(connect)` |
| 12 | 画布太乱了，帮我整理一下 | 新手 | S5 布局 | reversible_local | `arrange_canvas(tidy)` |
| 13 | 这三镜编成一组叫「回忆」 | 老手 | S5 分组 | reversible_local | `arrange_canvas(group)` |
| 14 | 给第 4 镜加一个推镜头的运镜参考 | 老手 | S7 | reversible_local | `stage_shot(camera_move=push_in)` |
| 15 | 帮我接一下 DeepSeek | 新手 | S11（key 用户填） | reversible_local（只打开面板） | `start_model_setup(provider)` → 回复告诉他在哪填 |
| 16 | 我有哪些能生视频的模型 | 新手 | 读 S11 | read | `list_models(kind=video)` |
| 17 | 用「口播成片」这个技能来做 | 老手 | 读 S15 | read | `read_skill` → 按技能方法论走 |
| 18 | 把这套做法存成技能 | 老手 | S15 保存 | reversible_local | `save_skill` |
| 19 | 删掉画布上那两个空节点 | 老手 | S3 删除 | irreversible（问） | `look_at_canvas` → `delete_from_canvas` |
| 20 | 把镜头按顺序放到时间轴上 | 新手 | S12 | reversible_local + 先看再批 | `edit_timeline(place_shots)` |
| 21 | 开头那段太长，剪掉前 2 秒 | 老手 | S12 | reversible_local + 先看再批 | `read_timeline` → `edit_timeline` |
| 22 | 刚才那步撤销 | 新手 | 上一次改动 | reversible_local | `undo(changeId)` |
| 23 | 导出 MP4 | 新手 | S14 | irreversible（问） | `export_video` |
| 24 | 素材库里有没有雨天的镜头 | 老手 | 读 S13 | read | `look_at_media(query)` |
| 25 | 帮我把文案开头改得更抓人 | 新手 | S2 | reversible_local | `read_script` → `write_script(where=selection/替换段)` |
| 26 | 做一张分镜对照表放画布上 | 老手 | S6 | reversible_local | `make_artifact(table)` |
| 27 | Make me a 10-second product teaser | novice | S2? → S3 ×N → S8 | reversible_local | `draft_shots` → `generate`（先问还是直接出卡：按审批档，不由模型猜） |
| 28 | Regenerate shot 5 with the same prompt but 16:9 | expert | S3 改参数 → S8 | reversible_local | `draft_shots(shotId, parameters)` → `generate` |
| 29 | What's still rendering? | novice | 读 S9 | read | `check_job` |
| 30 | Don't generate anything yet, just lay out the shots | novice | S3 草稿，**禁 generate** | reversible_local | `draft_shots` |
| 31 | Swap the model on every shot to Seedance | expert | S3 批量改 | reversible_local | `list_models` → `draft_shots(shots[])` |
| 32 | Group the intro shots and title the group "Cold open" | expert | S5 | reversible_local | `arrange_canvas(group)` |
| 33 | Link the character sheet to shots 2–4 as a reference | expert | S5 连线（参考边） | reversible_local | `arrange_canvas(connect)` |
| 34 | Which of my models can do image-to-video? | novice | 读 S11 | read | `list_models` |
| 35 | Cancel the export | expert | S14 | irreversible（问） | `cancel_job` |
| 36 | Stop, undo that | novice | 上一次改动 | reversible_local | `undo` |
| 37 | How much will these 6 shots cost? | novice | 读 S10（报价） | read | `generate(dryRun)`? **否** — `look_at_canvas` 已带每镜单价；合计在卡上。回复引用目录单价 |
| 38 | Write the voice-over script for these shots | expert | S2 | reversible_local | `look_at_canvas` → `write_script(where=end)` |
| 39 | Add a push-in on the hero shot | expert | S7 | reversible_local | `stage_shot` |
| 40 | Connect my Anthropic key | novice | S11 | reversible_local（打开面板） | `start_model_setup` |
| 41 | Use the "UGC ad" skill | novice | 读 S15 | read | `read_skill` |
| 42 | Delete the two duplicate shots | expert | S3 删 | irreversible（问） | `delete_from_canvas` |

（42 句；≥30 的要求已过。第 37 句是刻意放进去的**反例**：「问价」不是一个动词，价格随读回带出——若模型为了报价去调 `generate`，那就是选错工具，题库要抓。）

**归纳**：42 句只落在 **20 个动词** 上；每个动词至少 1 句命中；没有任何一句需要两个「写同一状态」的动词二选一。

---

## 5. 最小动词集（20 个，内部面）

> 命名规则：`动词_对象`，对象取 `docs/GLOSSARY.md` 规范名的英文（shot / script / canvas / timeline / media / model / skill / job / video / artifact）。内部面**不带** `nomi_` 前缀（前缀是多服务器宿主的命名空间，属外部面）。

### 5.1 读（7 个）—— 模型看到的世界 = 用户看到的世界

| 动词 | 读哪个状态 | 返回「用户看得见的」 |
|---|---|---|
| `look_at_canvas` | S3+S4+S5+S6+S7+S8 | 每个节点：标题、种类、提示词、模型、参数摘要、**状态（草稿/待确认/生成中/完成/失败）**、**单价（已知才印，算不出印 unknown 绝不印 0）**；连线、分组；分镜锚；**正在等用户点头的卡**（有的话）；当前选中的节点；当前审批档（S16） |
| `read_script` | S2 | `scope: all \| selection`；全文或选区原文；截断规则原样从 `laneContracts` 插值 |
| `read_timeline` | S12 | 全量快照 + `revision`；可选 `range{startFrame,endFrame}` 只看一段（合并 `inspect_timeline_range`） |
| `look_at_media` | S13 | `query` 搜索列表 / `assetId` 一条的技术事实（时长、编码、帧范围、可选波形桶）；永不含路径 |
| `list_models` | S11+S10 | 用户接了哪些模型、每个的模式/参数/参考槽/单价；`kind` 收窄（image/video/audio）；`modelKey` 只看一个 |
| `check_job` | S9+S14 | 一个生成或导出任务的进度、结果引用、花了多少；`jobId` 来自 `generate`/`export_video` 的返回 |
| `read_skill` | S15 | 一个技能的正文（不授予任何权限） |
| *(上下文注入，非工具)* | S1、S16 | 项目、审批档随系统提示词每回合注入，不占工具格 |

### 5.2 写（13 个）—— 一个动词一种状态一种效果

| 动词 | 改哪个状态 | 效果 | 用户接下来看到（`nextAction`） |
|---|---|---|---|
| `write_script` | S2 | `reversible_local` | 文稿里多了/换了一段，可 Cmd+Z |
| `draft_shots` | S3/S4（**唯一**能在画布上造出生成类节点的动词） | `reversible_local` | 画布上出现/更新了草稿节点（有模型、有参数、**有单价角标**、没开始生成、没花钱）；`nextAction: none` |
| `generate` | S8（把指定草稿摆到用户面前） | `reversible_local`（卡可关；点头是用户动作） | **面板介入槽出现报价卡**（逐镜 ‹1/4› 翻 + 全部）；`nextAction: user_sees_spend_card`；全自动档下宿主按档处理，返回值如实说 |
| `arrange_canvas` | S5 | `reversible_local` | 连线/分组/位置/标题变了；**要它建生成类节点 → 拒绝并点名 `draft_shots`** |
| `make_artifact` | S6 | `reversible_local` | 画布上出现一个手艺产物节点 |
| `stage_shot` | S7 | `reversible_local` | 目标镜头多了一个站位/运镜参考（灰模） |
| `edit_timeline` | S12 | `reversible_local` + `reviewBeforeApply` | **时间轴高亮 + 计划审阅卡**（每步问/自动改档都先看；全自动档直接落）；含「把镜头按顺序放上时间轴」 |
| `undo` | 上一次由 Agent 造成的改动 | `reversible_local` | 回到改动前；`changeId` 来自任一写动词的返回 |
| `delete_from_canvas` | S3/S5/S6/S7 删除 | `irreversible` | **确认卡**（永远问） |
| `export_video` | S14 | `irreversible` | **确认卡** → 导出进度 |
| `cancel_job` | S9/S14 取消 | `irreversible` | **确认卡**（已花的不退） |
| `save_skill` | S15 | `reversible_local` | 技能库多了一条 |
| `start_model_setup` | S11（只打开面板，**不碰 key**） | `reversible_local` | **设置 · 模型页打开并预填供应商**；用户在那里填 key |

20 = 7 读 + 13 写。（`undo`、`start_model_setup` 是新动词；其余全由现有工具合并/改名而来，见 §6。）

**没有的动词，以及为什么没有**：

- **没有 `spend` 类动词**。花钱只有宿主/UI 能做（`paidBoundary.ts` 不变）。`generate` 的效果是「把卡摆出来」，不是「花」。装配期不变量：内部 profile 里出现 `effect: "spend"` 直接抛。
- **没有「建画布节点」**。节点是状态的表现，不是状态；镜头节点由 `draft_shots` 造，产物节点由 `make_artifact` 造，导演台节点由 `stage_shot` 造。想造别的种类 = 拒绝。
- **没有「读生成上下文」**。它是 `list_models`。
- **没有 `preview` / `resolve`**。「按真实模型档案钳值、合并/拆条建议」是 `draft_shots` 返回值的一部分（宿主做完告诉模型改了什么），不是模型要另调的一步。
- **没有 `reconcile`**。核对供应商状态是宿主的维护动作，模型调它只会「不小心重提一笔」。
- **没有 Run 的任何动词**（§5.3）。
- **没有 `ask_user`**。介入槽的卡由宿主按效果类别弹；模型要问问题就写字。
- **没有 `layout_*`**。42 句里没有一句要它。

### 5.3 「生产 Run」不上模型面 —— 这次要权衡的核心

今天 `productionRunDescriptors.ts` 给模型 10 个动词：`start_production_run / get / subscribe / read_artifact / read_artifact_content / control / decide_gate / revise_artifact / review_artifact / materialize_storyboard`。

从状态表看，它们各自对应的用户状态是：

| Run 工具 | 用户世界里它其实是 | 新动词 |
|---|---|---|
| `start_production_run`（建 brief 草稿） | 「帮我做一支 30 秒产品片」= 写文稿 + 排镜头 | `write_script` + `draft_shots` |
| `read_production_artifact(_content)` | 读文稿 / 看分镜 | `read_script` / `look_at_canvas` |
| `revise_production_artifact` | 改文稿 / 改镜头 | `write_script` / `draft_shots` |
| `review_production_artifact`、`decide_production_gate` | **用户**点头/打回 | 不是模型的动词（模型替用户「记录用户的决定」是范畴错误） |
| `materialize_production_storyboard` | 把分镜落到画布 | `draft_shots`（分镜本来就是节点的投影，没有「落」这一步） |
| `control_production_run`（pause/resume/cancel/set_trust） | 取消 / 改审批档 | `cancel_job`；改档是用户独占（S16） |
| `get_production_run` / `subscribe_production_run` | 「跑到哪了」 | `check_job` |

**底层逻辑**：Run 是我们把「一次长任务」做成 durable 状态机的方式——这是对的，但它是**宿主的**实现。让模型拿着 `runId / artifactId / expectedVersion / gateId` 驱动它，等于让模型学我们的数据库 schema。Goal 模式（09-08 拍板 v1 = 一个 Run + 一条 lane）里，Run 应该在 lane 外面包着模型：宿主开 Run、宿主推进阶段、每个阶段的模型回合用的还是这 20 个动词。

**后果**：`start_production_run` 那扇「永远出不了卡」的门（`origin.host="embedded-agent"`）随之消失，不是被修好，是不存在了。

**代价**：Goal 模式的宿主侧编排要重写成「Run 驱动 lane」而不是「lane 驱动 Run」；`docs/plan/2026-09-08` 的 Goal 方案 §（实施前置门六条）要重排。这是本文档最大的结构性主张，也是六角色评审 CTO 一栏点名的那条（§8）。

---

## 6. 新工具面定稿草案

### 6.1 一份声明，三处派生

今天一个工具的「后果」被写了三遍，三套词表：

| 在哪 | 词表 | 消费者 |
|---|---|---|
| `capabilityContract.effect` | `read / reversible_write / destructive / paid` | `capabilityWorkModeDecision` |
| `capabilityContract.effectClass`（+ `operationEffectClasses`） | `reversible_local / spend / irreversible` | `capabilityIsHardGated`、MCP `destructiveHint` |
| `ModelFacingToolSpec.effects` | `{mutates, billable, reversal: none/proposal/undoable}` | pi `replay`、装配期不变量 |

三张表说的是一件事，而且互相要靠 `modelEffectsForCapability()` 翻译（`modelFacingTools.ts`）。**收成一个字段**：

```ts
// 一个动词的全部声明（单一 owner；描述、schema、效果、返回约定都从它派生）
interface VerbDeclaration {
  name: string;                       // 动词_对象，见 §5
  state: StateId;                     // S1..S19，恰好一个
  effect: "read" | "reversible_local" | "spend" | "irreversible";
  reviewBeforeApply?: true;           // 只允许出现在 reversible_local 上（效果从调用本身看不出来的那种）
  describe: {                         // 描述不是一段散文，是五个必填槽，渲染成 Anthropic 结构
    does: string;                     // 一句：改/读什么
    useWhen: string;                  // 用户说什么时用
    notWhen: string;                  // 什么时候不要用 + 该用哪个（点名动词）
    params: string;                   // 参数从哪来（"ids come from look_at_canvas"）
    // consequence 不手写：由 effect + nextAction 派生（见 6.2），手写就会出现
    // "This host cannot preview or start paid generation" 这种与 paidBoundary 矛盾的句子
  };
  schema: ZodObject;                  // 根是 object；没有根级 union（G-01）
  nextAction: NextActionKind;         // 成功时用户会看到什么（写动词必填；读动词恒 none）
  examples: Example[];                // 至少一个，测试过自己的 schema
  profiles?: ("internal" | "mcp")[];  // 缺省两个都投；差异必须引用 §6.4 的一条领域约束
}
```

派生关系（全部机器做，不手抄）：

- `mutates` = `effect !== "read"`；`billable` = `effect === "spend"`；pi `replay` = `mutates ? "revalidate" : "safe"`。
- `capabilityIsHardGated` = `effect ∈ {spend, irreversible}` ∨ `reviewBeforeApply && !granted`。
- 内部 profile 装配：`effect === "spend"` → **抛**（不是过滤——今天 `projectsToInternalProfile` 是静默过滤，一个没写 `effect:"paid"` 的花钱契约会静默进内部面）。
- MCP `annotations`：`readOnlyHint = effect==="read"`；`destructiveHint = effect ∈ {spend, irreversible}`。
- 描述 `consequence` 句 = `CONSEQUENCE_BY[effect][nextAction]`，一张 4×6 的表，全仓只此一份。

### 6.2 返回值约定：`nextAction` + `userSees`

每个写动词成功时返回同一个信封（读动词只有 `state`）：

```ts
interface VerbResult {
  ok: true;
  changeId?: string;                  // 给 undo 用；reversible_local 必有
  state: unknown;                     // 改完之后用户看得见的那部分（和对应读动词同形状的切片）
  nextAction: {
    kind: "none"                      // 已生效，用户看到结果
        | "user_sees_spend_card"      // 面板介入槽出现报价卡；生成还没开始；点头是用户的事
        | "user_sees_review_card"     // 时间轴高亮 + 计划审阅卡
        | "user_sees_confirm_card"    // 不可逆动作的确认卡
        | "user_sees_panel"           // 某个面板被打开（模型接入）
        | "job_running";              // 已开始，用 check_job 跟
    userSees: string;                 // 一句人话，模型可以直接转述："画布上多了 6 个草稿镜头，还没生成，也没花钱。"
    jobId?: string; cardId?: string;
  };
}
```

失败时：

```ts
interface VerbFailure {
  ok: false;
  code: "wrong_verb" | "stale_read" | "invalid_args" | "not_allowed_in_mode" | "domain_failed";
  message: string;
  useInstead?: string;                // wrong_verb 时点名正确动词。**只点名，不代调**（原则 7）
  nextAction: string;                 // 可行动的一句："Call look_at_canvas, then retry with the ids it returns."
}
```

`userSees` 是原则 4 的落点：模型说「已经出卡了」之前，它手里有一句宿主写的、和面板同源的话。「模型说了卡、面板没卡」在这条约定下**结构上不可能**——卡和这句话是同一次投影。

### 6.3 逐动词定稿（描述原文按 Anthropic 五槽；英文是模型读的那份）

> 写法：`does` / `useWhen` / `notWhen` / `params` 四槽手写，第五槽 `consequence` 由 6.1 的表派生，这里用 *斜体* 标出派生句以便评审。schema 只列要点。

#### `look_at_canvas` · S3–S8 · `read`

- **does**: Read everything the user currently sees on the generation canvas: every shot and node (title, kind, prompt, model, parameter summary, status, unit price when known), the reference links and groups between them, the storyboard anchors, any priced confirmation card that is waiting for the user, the current selection, and the user's approval mode.
- **useWhen**: Before any change to shots, links or groups, and whenever the user asks what is on the canvas, what a shot costs, or what is still waiting on them.
- **notWhen**: Do not use it to read the script (`read_script`), the timeline (`read_timeline`) or the media library (`look_at_media`). It never changes anything.
- **params**: None. Every id you pass to a write verb comes from here; inventing an id is the most common way an edit fails.
- *consequence*: *Nothing changes. Prices are printed only when known; `unknown` is never 0.*
- schema: `{}`；返回 `{ nodes[], links[], groups[], anchors[], pendingCards[], selection[], approvalMode }`。

#### `read_script` · S2 · `read`

- **does**: Read the creation document as plain text — the whole document, or only the text the user has selected.
- **useWhen**: Before editing the script, when splitting it into shots, and whenever the user says "this" or "here" (use `scope: "selection"` — it is the only way to resolve that).
- **notWhen**: Not for shots or canvas content (`look_at_canvas`). An empty selection means ask, not guess.
- **params**: `scope` — `"all"` (default) or `"selection"`.
- *consequence*: *Nothing changes. Long text is truncated to the first N lines / N KB; the result says so.*（N 从 `laneContracts` 插值）
- schema: `{ scope?: "all" | "selection" }`。

#### `read_timeline` · S12 · `read`

- **does**: Read the project timeline: fps, duration, playhead, every track, clip, text overlay and transition, plus the `revision` every edit must carry. Pass a frame range to read only one moment.
- **useWhen**: Before `edit_timeline`, and when the user talks about a moment ("the part around 0:30" → pass `range`).
- **notWhen**: Not for canvas shots that are not on the timeline yet (`look_at_canvas`).
- **params**: `range?: { startFrame, endFrame }` — integer frames at the project fps; convert seconds yourself.
- *consequence*: *Nothing changes. Clips and assets are named by id, never by file path.*

#### `look_at_media` · S13 · `read`

- **does**: Search the project's media library, or read bounded technical facts (duration, codec, frame range usage, waveform buckets) about one asset.
- **useWhen**: The user asks whether a kind of footage exists, or you need an asset id for a reference or a timeline edit.
- **notWhen**: It reports container facts only; it never describes what is visible or audible. It does not import anything (external hosts use `import_media`).
- **params**: `query?`, `kinds?`, `limit?` to search; `assetId` (+ optional `frames`/`waveform`) to inspect one.
- *consequence*: *Nothing changes. No path, URL or media bytes ever cross this boundary.*

#### `list_models` · S11+S10 · `read`

- **does**: Read the models the user has connected: each model's modes, parameters with allowed values, reference slots and unit price.
- **useWhen**: Before choosing a `modelKey` or any parameter in `draft_shots`; when the user asks which models can do something.
- **notWhen**: It cannot connect a model or take an API key (`start_model_setup`). Never invent a modelKey — use the exact strings returned here.
- **params**: `kind?: "image" | "video" | "audio"` narrows; `modelKey?` returns one model in full.
- *consequence*: *Nothing changes.*

#### `check_job` · S9+S14 · `read`

- **does**: Read one generation or export job: its stage, progress, result reference and what it has cost so far.
- **useWhen**: The user asks whether something is done, what is still running, or what it cost; before `cancel_job`.
- **notWhen**: It never starts, retries or reconciles provider work. If a job id is unknown, say so — do not resubmit.
- **params**: `jobId` — from the `nextAction` of `generate` or `export_video`, or from `look_at_canvas`.
- *consequence*: *Nothing changes.*

#### `read_skill` · S15 · `read`

- **does**: Read one installed skill's body so you can follow its method.
- **useWhen**: The user names a skill, or the skills index in this prompt matches the task.
- **notWhen**: Loading a skill grants no tool permission and runs nothing.
- **params**: `skillKey` — from the skills index.
- *consequence*: *Nothing changes.*

#### `write_script` · S2 · `reversible_local` · nextAction `none`

- **does**: Write finished prose into the creation document — at the cursor, in place of the selection, or at the end.
- **useWhen**: The user asks you to write, rewrite, tighten or extend script text.
- **notWhen**: Never write a diff, a summary of the change, or a plan to write later. Not for shot prompts (`draft_shots`).
- **params**: `content` — the exact text; `where` — `"cursor" | "selection" | "end"`. Read the selection first unless the user told you exactly what to replace.
- *consequence*: *The change is applied immediately and goes onto the user's undo stack (Cmd+Z, or `undo` with the returned `changeId`).*
- schema: `{ content: string, where: enum }`；三个 `where` 同一份字段，不是三个分支。

#### `draft_shots` · S3/S4 · `reversible_local` · nextAction `none`

- **does**: Create or update draft shots on the canvas. **This is the only verb that creates image, video, audio or 3D shots.** A draft has a title, prompt, model, parameters, references and a unit price; it is not generated and costs nothing until the user approves it.
- **useWhen**: Whenever the user asks to make, draw, render, regenerate, restyle or re-time any media — including a single image — or to split text into shots, or to change a shot's prompt/model/parameters/references. Pass `shotId` to update an existing draft; omit it to create.
- **notWhen**: It does not start generation and shows the user no card — call `generate` for that, unless the user said not to generate yet. Not for links, groups or layout (`arrange_canvas`), not for hand-made artifacts (`make_artifact`).
- **params**: `shots[]` — each with `shotId?`, `title`, `prompt` (Simplified Chinese), `taskKind`, `modelKey`, `modeId`, `parameters`, `references[]` (asset ids or shot ids), `anchorIds[]`; `anchors[]` for characters/scenes/props/styles. Model and parameter values come from `list_models`; ids from `look_at_canvas`. The host clamps values to the model's real limits and reports every clamp in the result.
- *consequence*: *Draft nodes appear or update on the canvas with their price badge; nothing is generated and nothing is spent. The result lists every shot id and any value the host had to clamp.*
- schema 要点：根 object；`shots` 最多 40；`prompt` 非空；不收 `operation`。

#### `generate` · S8 · `reversible_local` · nextAction `user_sees_spend_card`

- **does**: Put the named draft shots in front of the user as one priced confirmation card. Generation starts only when the user approves the card in Nomi.
- **useWhen**: Right after `draft_shots`, when the user asked to generate; or when they ask to generate existing drafts ("run all six").
- **notWhen**: Never to get a price — `look_at_canvas` already carries unit prices. Never when the user said "don't generate yet". It cannot approve, start, or spend anything itself.
- **params**: `shotIds[]` — from `draft_shots` or `look_at_canvas`.
- *consequence*: *The user now sees a card in the panel with model, per-shot price and total (‹1/N› paging, "all"). Nothing has been generated yet. In full-auto mode the host may approve within the user's standing grant; the result says which happened. Tell the user what the card shows; never say generation has started.*
- 返回：`nextAction.kind = user_sees_spend_card | job_running`（全自动档），`cardId` / `jobId`。

#### `arrange_canvas` · S5 · `reversible_local` · nextAction `none`

- **does**: Change how existing nodes relate and sit on the canvas: connect reference links, group nodes (with a title), retitle, reposition or tidy the layout.
- **useWhen**: The user asks to connect, link, group, rename, move or tidy.
- **notWhen**: It cannot create shots or any generating node — such a request is rejected with `wrong_verb` naming `draft_shots`. Not for hand-authored artifacts (`make_artifact`).
- **params**: `links[]` (`fromId`, `toId`, `role`), `groups[]` (`title`, `nodeIds[]`), `retitle[]`, `tidy: true`. All ids from `look_at_canvas`.
- *consequence*: *Applied immediately; undoable via `changeId`.*

#### `make_artifact` · S6 · `reversible_local` · nextAction `none`

- **does**: Put a hand-authored artifact on the canvas — SVG, HTML, Markdown or a table you wrote yourself.
- **useWhen**: The user wants a chart, table, mood board, comparison sheet or diagram that you can author directly without a generation model.
- **notWhen**: Not for images or video that need a model (`draft_shots`).
- **params**: `fileType`, `title`, `content`.
- *consequence*: *An artifact node appears; no model is called, nothing is spent.*

#### `stage_shot` · S7 · `reversible_local` · nextAction `none`

- **does**: Attach a staging (blocking) or camera-motion reference to one shot; Nomi renders a gray 3D reference for it.
- **useWhen**: The user asks for a push-in, a two-shot, a specific blocking, or "show me the camera move".
- **notWhen**: It does not generate the shot itself and it is not a prompt edit (`draft_shots`).
- **params**: `shotId`; `staging` (characters/layout/camera/environment/customBlocking) **or** `cameraMove` (move/customMove/speed/subjectPose). Exactly one of the two.
- *consequence*: *A director node appears linked to the shot; rendered offscreen, nothing is spent.*

#### `edit_timeline` · S12 · `reversible_local` + `reviewBeforeApply` · nextAction `user_sees_review_card`

- **does**: Apply one transaction of timeline operations (move, trim, split, place shots in story order, add text, add transition) against the `revision` you read.
- **useWhen**: The user asks to cut, trim, reorder, place shots on the timeline, or add captions/transitions.
- **notWhen**: Not without a fresh `read_timeline`; a stale `revision` is rejected and resending it cannot succeed. Not for shot content (`draft_shots`).
- **params**: `revision`, `summary`, `operations[]` in frames.
- *consequence*: *The timeline highlights the plan and the user sees a review card before it applies (in full-auto mode it applies and the result says so). Undoable via `changeId`.*

#### `undo` · 上一次改动 · `reversible_local` · nextAction `none`

- **does**: Revert one change you made, by the `changeId` its result returned.
- **useWhen**: The user says undo / go back / that was wrong.
- **notWhen**: It cannot un-spend money or un-export; those are not undoable and `check_job`/`cancel_job` are the verbs there.
- **params**: `changeId`.
- *consequence*: *The state returns to before that change.*
- 前置证据：每个 `reversible_local` 动词的 owner 层必须交出「真能撤」的证据（09-08 拍板的可撤清单）；交不出的先降成 `irreversible`（问），不许挂着 reversible 的名等以后补。

#### `delete_from_canvas` · S3/S5/S6/S7 · `irreversible` · nextAction `user_sees_confirm_card`

- **does**: Delete exact nodes (shots, artifacts, director references) from the canvas.
- **useWhen**: The user names what to delete.
- **notWhen**: Never to "clean up" on your own initiative; never for nodes you did not read in `look_at_canvas`.
- **params**: `nodeIds[]`.
- *consequence*: *The user always sees a confirmation card first, in every approval mode.*
- 备注：画布有撤销点（#630）；若 owner 层能证明删除可撤，这个动词降为 `reversible_local`。不是本文档裁的，是证据裁的。

#### `export_video` · S14 · `irreversible` · nextAction `user_sees_confirm_card` → `job_running`

- **does**: Start exporting the timeline to an MP4 file.
- **useWhen**: The user asks to export / render out / save the video.
- **notWhen**: Not before the user has seen the timeline they want; it overwrites the target file.
- **params**: `preset?`, `fileName?`.
- *consequence*: *A confirmation card first; after approval the job runs and `check_job` follows it.*

#### `cancel_job` · S9/S14 · `irreversible` · nextAction `user_sees_confirm_card`

- **does**: Cancel one running generation or export job.
- **useWhen**: The user asks to stop it.
- **notWhen**: Not for drafts (delete them) and not for cards (the user closes them).
- **params**: `jobId`.
- *consequence*: *Confirmation card first; credit already spent is not refunded.*

#### `save_skill` · S15 · `reversible_local` · nextAction `none`

- **does**: Save a validated skill package to the user's library.
- **useWhen**: The user asks to save this way of working as a skill.
- **notWhen**: Not for one-off instructions.
- **params**: `name`, `body` (SKILL.md format, R31).
- *consequence*: *A new entry in the skill library; deletable there.*

#### `start_model_setup` · S11 · `reversible_local` · nextAction `user_sees_panel`

- **does**: Open Nomi's model settings for one provider so the user can connect it.
- **useWhen**: The user asks to connect / add / set up a model or provider.
- **notWhen**: It never accepts, asks for, or stores an API key; keys are typed by the user in that panel only.
- **params**: `provider?` (a hint; free text is fine).
- *consequence*: *The settings panel opens prefilled; tell the user where to paste the key.*

### 6.4 两个 profile 的差异（只允许是领域约束）

| 差异 | 领域约束 | 说明 |
|---|---|---|
| 外部面**多** `confirm_generation`（`spend`，`destructiveHint`） | **paidBoundary**：外部宿主的用户不在看 Nomi 面板，确认在客户端里弹（elicitation，09-10 20:30 拍板 7）；宿主拿到收据后由 Nomi 结清 | 内部面装配期见 `spend` 即抛；外部面每个 `spend` 动词必须带 `destructiveHint`（`assertPaidBoundaryExternalSurface` 保留） |
| 外部面**多** `import_media`、`create_project`、`connect_model`（多相位） | **无头宿主**：外部宿主有用户的文件路径与没有打开的项目；内部 Agent 结构上没有（用户拖拽、项目已开） | 三条都要在 `VerbDeclaration.profiles` 上引用这一行；不引用的 profile 差异门岗红 |
| 外部面每个动词首字段 `leaseHandle`；`documentId` 传输字段 | 租约与寻址是传输层，不进语义输入 | 现状保留（`mcpTransportFields`） |
| 外部面名字带 `nomi_` 前缀 | 多服务器宿主的命名空间（Anthropic namespacing） | 机械加前缀，不另起名 |

除此之外**零差异**：同一份 `VerbDeclaration`，同一份描述，同一份 schema 指纹（`profile-schema-drift` 规则保留）。

### 6.5 系统提示词那一半（三通道保留，内容换）

- `Available tools` 菜单：20 行 `- verb: does`。
- `Guidelines`（跨动词去重）只剩四条：① 先读再写，id 从读回来；② 花钱只在用户点头之后，卡由 Nomi 出，你只转述 `userSees`；③ 提示词写简体中文；④ 不把 id/JSON 摊给用户。
- 身份层里那两条「建草稿只能说草稿已建好…」（`agentContext.ts:45-46`）删掉——它们是在用散文补返回值缺的 `userSees`，返回值有了就不需要了（P1）。

---

## 7. 对照表：现有 58 个名字 → 20 个动词

> 「留」= 名字与语义都不动；「改」= 语义保留、改名/改描述/改 schema；「删」= 模型面上不再有；「合并」= 并进另一个动词。理由一句。

### 7.1 内部面（37 个名字，含 1 个注册表外的；一名多 operation 的按 operation 拆行）

| 现有 | 处置 | 去向 | 理由 |
|---|---|---|---|
| `read_full_text` | 合并 | `read_script(scope=all)` | 同一状态两个读；`scope` 是同形字段的枚举，不是分支 |
| `read_selection` | 合并 | `read_script(scope=selection)` | 同上 |
| `insert_at_cursor` | 合并 | `write_script(where=cursor)` | 三个写只差 `where`，字段完全相同 |
| `replace_selection` | 合并 | `write_script(where=selection)` | 同上 |
| `append_to_end` | 合并 | `write_script(where=end)` | 同上 |
| `nomi_canvas_read` | 改 | `look_at_canvas` | 加节点状态、单价、待确认卡、选区、审批档（原则 3） |
| `nomi_canvas_write · create_canvas_nodes`（生成类 kind） | **删** | 拒绝 → `wrong_verb: draft_shots` | 四扇门之一；不留阀门 |
| `nomi_canvas_write · create_canvas_nodes`（artifact kind） | 合并 | `make_artifact` | 产物是独立状态 S6 |
| `nomi_canvas_write · connect_canvas_edges / tidy_canvas / retitle` | 合并 | `arrange_canvas` | 同一状态 S5 |
| `nomi_canvas_write · set_node_prompt` | 合并 | `draft_shots(shotId, prompt)` | 改镜头就是改草稿 |
| `nomi_storyboard_write · propose_storyboard_plan` | 合并 | `draft_shots(shots[], anchors[])` | 分镜 = 节点投影，「整份方案」= 一批草稿；四扇门之二 |
| `nomi_storyboard_write · patch_shots` | 合并 | `draft_shots(shotId…)` | 同上 |
| `nomi_storyboard_write · arrange_storyboard_to_timeline` | 合并 | `edit_timeline(place_shots)` | 它改的是时间轴 S12，不是分镜 |
| `nomi_shot_reference_write`（staging / camera_move） | 改 | `stage_shot` | 语义不变，改用户的词 |
| `read_timeline` | 留 | `read_timeline` | — |
| `inspect_timeline_range` | 合并 | `read_timeline(range)` | 同一状态、同一形状的子集 |
| `propose_edit_plan` | **删** | — | 审阅卡本身就是预览（`reviewBeforeApply`），预览工具是第二份 |
| `apply_edit_plan` | 改 | `edit_timeline` | 改名；`reviewBeforeApply` 保留 |
| `undo_timeline_edit` | 合并 | `undo(changeId)` | 撤销是跨状态的一个动词 |
| `search_media` / `get_media` / `inspect_media` / `inspect_source_range` / `read_waveform` | 合并 | `look_at_media` | 五个读同一状态；`assetId` 有无决定搜索还是细看 |
| `inspect_export_job` / `verify_render` | 合并 | `check_job` | 与生成任务同一「任务」状态 |
| `export_timeline` | 改 | `export_video` | 改用户的词 |
| `cancel_export_job` | 合并 | `cancel_job` | 同上 |
| `delete_canvas_nodes` | 改 | `delete_from_canvas` | 改名；效果由可撤证据裁 |
| `nomi_generation_plan · context` | 合并 | `list_models` | 它读的是 S11 |
| `nomi_generation_plan · create / patch` | 合并 | `draft_shots` | 四扇门里唯一会出卡的那扇——**出卡这半拆成 `generate`** |
| `nomi_generation_status · read` | 合并 | `check_job` | — |
| `nomi_generation_status · cancel` | 合并 | `cancel_job` | — |
| `nomi_generation_status · reconcile` | **删** | 宿主维护 | 模型调它 = 可能重提 |
| `nomi_read`（`laneModelRead.mts`，注册表外） | 合并 | `list_models` | 第二份 S11 读，且不在注册表 |
| `start_production_run` | **删** | `write_script` + `draft_shots` | §5.3；`origin.host="embedded-agent"` 那扇门随之消失 |
| `get_production_run` / `subscribe_production_run` | **删** | `check_job` | §5.3 |
| `read_production_artifact` / `read_production_artifact_content` | **删** | `read_script` / `look_at_canvas` | §5.3 |
| `control_production_run` | **删** | `cancel_job`；改档用户独占 | §5.3 |
| `decide_production_gate` | **删** | — | 模型替用户记录用户的决定，范畴错误 |
| `revise_production_artifact` / `review_production_artifact` | **删** | `write_script` / `draft_shots`；评审是用户的 | §5.3 |
| `materialize_production_storyboard` | **删** | `draft_shots` | 四扇门之四 |

未投影但登记在契约上的：`nomi_request_generation_gate` / `nomi_start_generation` / `nomi_decide_generation_gate` → **留（宿主独占，永不上内部面）**；`nomi_resolve_generation_plan` → 合并进 `draft_shots` 返回值；`load_skill` → 改 `read_skill`；`author_skill` → 改 `save_skill`；`layout_read` / `layout_write` → **删**（无话术）。

### 7.2 外部面独有（13 个）

| 现有 | 处置 | 去向 | 理由 |
|---|---|---|---|
| `nomi_operation_plan` / `nomi_operation_preview`（手写，`mcpGenerationToolCatalog.ts:59-134`） | 合并 | `nomi_draft_shots` | 注册表外的第二份生成面；预览进返回值 |
| `nomi_operation_gate`（request/decide） | 改 | `nomi_confirm_generation`（`spend`） | paidBoundary 领域约束，§6.4 |
| `nomi_operation_execute` | **删** | 宿主在收据结清后自动提交 | 「确认」和「执行」是一件事的两半，模型不该分两次调 |
| `nomi_operation_control` | 合并 | `nomi_cancel_job` | — |
| `nomi_read`（`mcpToolCatalog.ts:108`） | 合并 | `nomi_list_models` | — |
| `nomi_asset_import` | 留 | `nomi_import_media` | 无头宿主领域约束 |
| `nomi_project_create` | 留 | `nomi_create_project` | 同上 |
| `nomi_integration` | 留 | `nomi_connect_model`（多相位） | 同上 + 密钥走 elicitation URL |
| `nomi_artifact_review` / `nomi_run_gate` / `nomi_run_start` / `nomi_run_control` | **删** | — | Run 家族，§5.3 |
| `nomi_canvas_maintenance`、`nomi_timeline_edit`、`nomi_export_job`、`nomi_layout_*` 等注册表投影 | 随 7.1 走 | — | 同一份声明机械加前缀 |

### 7.3 计数

| 处置 | 内部面（37 名 → 45 行） | 契约上有名未投影（8 名） | 外部独有（13 名） | 合计 |
|---|---|---|---|---|
| 留 | 1（`read_timeline`） | 3（付费别名，宿主独占） | 3（`asset_import` / `project_create` / `integration`） | **7** |
| 改 | 5（`canvas_read` / `shot_reference_write` / `apply_edit_plan` / `export_timeline` / `delete_canvas_nodes`） | 2（`load_skill` / `author_skill`） | 1（`operation_gate`） | **8** |
| 删 | 13（`create_canvas_nodes` 生成类 / `propose_edit_plan` / `reconcile` / 10 个 Run 工具） | 2（`layout_read` / `layout_write`） | 5（`operation_execute` / `artifact_review` / `run_gate` / `run_start` / `run_control`） | **20** |
| 合并 | 26（5 文稿 / 3 画布写 op / 3 分镜 op / `inspect_timeline_range` / `undo_timeline_edit` / 5 素材读 / 2 导出读 / `cancel_export_job` / 4 生成 plan-status op / `nomi_read`） | 1（`resolve_generation_plan`） | 4（`operation_plan` / `operation_preview` / `operation_control` / `nomi_read`） | **31** |
| 新增 | 2（`undo`、`start_model_setup`） | — | — | **2** |

（内部面按 operation 拆行：`nomi_canvas_write` 4 行、`nomi_storyboard_write` 3 行、`nomi_generation_plan` 2 行、`nomi_generation_status` 3 行，37 名 → 45 行；45 = 1 + 5 + 13 + 26。）

### 7.4 现状的重叠与矛盾，逐条

| # | 重叠/矛盾 | 在哪 |
|---|---|---|
| C1 | 四个工具都能把生成类节点放上画布，只有一个出卡 | `canvasModelTools.ts:149,157`、`extendedModelTools.ts:53`、`productionRunDescriptors.ts:91` |
| C2 | 唯一正确的工具描述劝退：`This host cannot preview or start paid generation` | `extendedModelTools.ts:53` |
| C3 | 同一后果三套词表（`effect` / `effectClass` / `effects{mutates,billable,reversal}`） | `capabilityContract.ts:3,9`、`modelFacingTools.ts` |
| C4 | 语言混杂：`nomi_storyboard_write` 描述是中文，其余英文；示例 `when` 中英混 | `canvasModelTools.ts:157` |
| C5 | 两份 S11 读：`nomi_read(models)`（注册表外）与 `nomi_generation_plan context` | `laneModelRead.mts:5`、`extendedModelTools.ts:53` |
| C6 | 两份 S8/S9 生成面：注册表的 `generation.*` 与手写的 `mcpGenerationToolCatalog.ts` 五个 | `mcpGenerationToolCatalog.ts:59-134` |
| C7 | 成功返回值无 `nextAction`/`userSees`；只有错误路径有 `nextAction` | `laneExtendedTools.ts:22`、`laneRuntimePort.ts:85` |
| C8 | `propose_edit_plan`（预览）与 `apply_edit_plan` 的 `requiresPlanReview`（也是预览）双份 | `extendedModelTools.ts:36-41`、`timelineWrite.ts` |
| C9 | 「模型替用户记录用户的决定」 | `decide_production_gate`、`review_production_artifact` |
| C10 | `start_production_run` 与 `nomi_generation_plan` 的差别只是 `origin.host` 一个字符串 | `productionRunTransportAdapters.ts:113` vs `generationTransportAdapters.ts:201` |
| C11 | 身份提示词在用散文补返回值缺的东西（「建好草稿只能说…」） | `agentContext.ts:45-46` |
| C12 | `projectsToInternalProfile` 是静默过滤不是断言：一个漏标 `paid` 的花钱契约会静默进内部面 | `paidBoundary.ts:63` |
| C13 | 内部面工具数：核心 11 + 延迟 26 = 37（含 `nomi_read`），已超 OpenAI「<20」建议；延迟组按代码层分（timeline/media/maintenance/generation/production），不按用户任务分 | `laneToolCatalog.ts`、`extendedModelTools.ts` |

---

## 8. 验收设计

### 8.1 R30 题库：选对工具率 + 回合成功率

题库 = §4 的 42 句，每句带 `{ utterance, lang, persona, expectedFirstVerb, expectedEffect, expectedNextAction, forbiddenVerbs[] }`。第 37 句这类「反例」的 `forbiddenVerbs = ["generate"]`。

**两条腿，口径写死**：

| 腿 | 跑什么 | 量什么 | 进哪 |
|---|---|---|---|
| 零额度 loopback（`tests/agent-runtime/`） | 一个脚本「模型」按题库逐句发出 `expectedFirstVerb` 调用，走真实 lane（真实 `before_tool` 闸、真实 owner 层、隔离 profile） | ① 每个写动词的返回信封含 `nextAction.kind === expectedNextAction`；② `userSees` 非空且与面板投影同源（同一次 `productionPendingSpend` 快照）；③ `wrong_verb` 路径：向 `arrange_canvas` 要生成类节点 → `ok:false, useInstead:"draft_shots"`，**画布节点数不变** | CI，每 PR |
| 真实模型（DeepSeek 便宜档，`~/.nomi-secrets.env`） | 42 句各跑 1 回合（真出的按件封顶，默认 `generate` 不点头） | **选对工具率** = 首调 ∈ expectedFirstVerb 的句数 / 42，按 意图桶 × 语言 × 新老手 出分布；**回合成功率** = 终态匹配 ∧ 回复里出现了 `userSees` 的事实（用判官量表打「有没有声称生成已开始」） | 数字写进 PR；基线：现状先跑一轮得出，目标 ≥ 90%（`mcp-onboarding-baseline` 同口径） |

A/B 项（同题库、同模型、只换工具面）：`write_script(where)` 一个动词 vs 三个动词；`look_at_media` 一个 vs 五个。数字裁，不是审美裁。

### 8.2 `check:tool-face` 门岗（单一 owner，从 `VerbDeclaration[]` 派生）

| 规则 | 判据 | 先验会红（R17） |
|---|---|---|
| T1 一效果一工具 | 每个声明恰好一个 `effect`；不存在 `operationEffectClasses` 之类的按参数分效果 | 把 `generate` 加 `operation: start` 分支 → 红 |
| T2 一状态一写动词 | 同一 `state` 的 `effect ≠ read` 声明至多一个（`undo`/`delete_from_canvas` 例外登记为跨状态动词） | 再加一个写 S3 的动词 → 红 |
| T3 描述五槽必填 | `does/useWhen/notWhen/params` 非空；`notWhen` 至少点名一个别的动词名 | 删 `notWhen` → 红 |
| T4 后果句派生 | 描述文本里的后果句 === `CONSEQUENCE_BY[effect][nextAction]`；文本里出现 `cannot .* paid`、`never generates` 等与 paidBoundary 矛盾的手写措辞 → 红 | 把 `This host cannot preview or start paid generation` 放进 `does` → 红 |
| T5 语言统一 | 模型读的描述与示例 `when` 全英文（正则：无 CJK）；中文只在 i18n 表 | 现状 `nomi_storyboard_write` 立刻红 |
| T6 命名 | `^[a-z]+_[a-z_]+$`，动词 ∈ 固定词表（look_at/read/list/check/write/draft/generate/arrange/make/stage/edit/undo/delete_from/export/cancel/save/start），对象 ∈ GLOSSARY 英文名 | `nomi_foo` 进内部面 → 红 |
| T7 内部面无 spend | internal profile 装配期 `effect === "spend"` → 抛（不是过滤） | 给 `generate` 改 `effect: spend` → 起不来 |
| T8 profile 差异必引领域约束 | `profiles` 与缺省不同的声明必须带 `profileReason ∈ {paidBoundary, headlessHost}` | 加一个只投 mcp 的读 → 红 |
| T9 注册表外无工具 | 扫 `electron/` 里所有 `{ name: '...', description: ..., parameters: ... }` 形状的对象，不在 `VerbDeclaration[]` 的 → 红 | 现状 `laneModelRead.mts`、`mcpGenerationToolCatalog.ts` 立刻红 |
| T10 每个动词 ≥1 句话术 | 题库里 `expectedFirstVerb` 覆盖全部动词；反过来题库里出现的动词必须存在 | 加一个没人说的动词 → 红 |
| T11 示例过自己的 schema | 现有 `lane-tool-contract.test.mts` 保留 | — |
| T12 可撤证据 | 每个 `reversible_local` 声明引用一条 `undoEvidence`（测试文件路径） | 把 `save_skill` 标 reversible 而不给证据 → 红 |

### 8.3 交付顺序建议（不在本文档实施）

1. 先跑现状基线（8.1 两条腿，现工具面）——**数字先于改动**（09-10 用户退回 #690 的教训）。
2. `VerbDeclaration` + 派生 + `check:tool-face`（T1–T12，逐条先验会红）。
3. 内部面切到 20 动词，同 commit 删 37 个旧名（P1）；外部面同一声明加前缀。
4. Run 下模型面（§5.3）与 Goal 模式宿主编排重排——**单独方案、单独拍板**，本文档只定方向。
5. 重跑 8.1，数字进 PR。

---

## 9. 与 `close-agent-doors` 方案的关系

那份方案推荐「甲：错工具进来悄悄转进正门」并改写五条描述。本文档的结论**推翻甲**（原则 7），并且让乙的代价消失：
乙的代价是「模型撞门多一个回合 + 外部宿主破坏性变更」；但当 `arrange_canvas` 从设计上就不收生成类节点、`draft_shots` 是唯一造镜头的动词、描述的 `notWhen` 点名它、`wrong_verb` 错误再点名一次时，「撞门」是一个模型在三处提示下仍选错的事件——那正是 R30 要量的东西，不该用阀门把它藏起来。
那份方案的 §7 三道门（结构 / R30 / 真实模型）与门表 `doors.json` 直接沿用；描述改写原文 B-1～B-5 作废，由 §6.3 替代。

---

## 10. 六角色评审（R7）——各挑一处最大的问题

| 角色 | 最大的问题 | 本文档的回答 / 待拍板 |
|---|---|---|
| **CTO** | §5.3 把 Run 下模型面是一次架构反转（Run 驱动 lane），Goal 模式 v1 方案（09-08）刚拍板，重排成本高；且 `ProductionGenerationPlan` 的 durable 正本今天就住在 Run 域里 | 承认。分两步：本轮只把 Run 的 10 个工具从模型面拿掉（模型不调它们，宿主照旧用 Run 存草稿），Goal 编排反转另出方案。这样 C1/C10 两处门本轮就消失，反转可以慢 |
| **设计** | 「模型看到的 = 用户看到的」要求 `look_at_canvas` 返回待确认卡、单价、审批档——这些今天在三个投影里（`pendingSpend`、`shotPricing`、`approvalPolicy`），读工具要把它们拼成一份，等于给模型造一个「面板的镜像」，容易和面板漂 | 用同一份投影：`look_at_canvas` 的 `pendingCards` 直接消费 `productionPendingSpend.ts` 的输出，不另拼；门岗 T4 的 `userSees` 也从它派生。漂 = 两处消费同一函数，结构上不会 |
| **PM** | 20 个动词里 `generate` 与 `draft_shots` 分开，新手说「生成一张图」要两次调用；模型会不会只调第一个然后说「好了」？ | 这正是 C7 要修的：`draft_shots` 返回 `userSees: "…没生成、没花钱"`，模型手里有原话；题库第 1/27 句量它。若数字说分开不行，备选是 `draft_shots(thenGenerate: true)`——但那是同一动词两种 nextAction，违反原则 2，要用户拍 |
| **前端** | `wrong_verb` 拒绝要在 admission 层判「这个 kind 是不是生成类」，判据是 `nodes/registry.ts:43 executionKind`，那份登记在渲染层；主进程的 lane 要判就得把它搬到 `shared/` | 搬到 `electron/shared/`（它本来就是纯数据），渲染层 import 同一份。加规则 T2 时先验会红 |
| **后端** | 合并五个 media 读成 `look_at_media` 会让一个工具的返回形状随参数变（列表 vs 单条 vs 波形）；`check_job` 合并生成与导出也是两种形状 | 返回用判别字段 `kind: "list" \| "asset" \| "generation" \| "export"`，schema 上是 oneOf 输出（输出不受 G-01 影响，G-01 只管输入）。8.1 的 A/B 项专门量这两处 |
| **真实用户** | 「我说取消，它还弹一张卡问我确不确定」——取消被标 `irreversible` 永远问，比我自己点 × 还慢 | 如实标：取消已花的钱不退，09-08 拍板「撤不回永远问」。但卡是一键的；且 `cancel_job` 的卡可以和任务卡合一（任务卡上本来就有停止钮）。若用户觉得多余，改的是审批策略表，不是把 cancel 标成 reversible |

---

## 11. 未决 / 需要用户拍板的

1. **§5.3 Run 下模型面**——方向拍板（CTO 栏的两步走是默认解）。
2. **`generate` 独立成动词** vs `draft_shots(thenGenerate)`（PM 栏）——默认独立，数字裁。
3. **`write_script` 一动词三 `where`**、**`look_at_media` 一动词** —— 默认合并，A/B 数字裁。
4. **`delete_from_canvas` 是 `irreversible` 还是 `reversible_local`**——由可撤证据裁，不由本文档裁。
5. **外部面「无头宿主」这类 profile 差异算不算「paidBoundary 那种领域约束」**——任务书只放行 paidBoundary 一种；本文档把「无头宿主」当第二种登记在 T8 里，需要点头。
