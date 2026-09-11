# 模型工具面审计 · 2026-09-11

> 用户 09-11 16:00 要求：把给模型看的**全部**工具拉出来，逐个对照顶尖产品的写法审一遍，
> 这次把底层毛病修好、不再反复。
>
> 本文只做审计与改写提案，**不改产品代码**。结构方案交给
> `docs/plan/2026-09-11-close-agent-doors.md`（另一位工人），本文末尾 §8 是给它的输入。
>
> 证据：`docs/audit/2026-09-11-model-tool-face/{internal,external}.json`
> （由同目录 `dump.mts` 从 `modelFacingToolSpecs(profile)` 机械生成，可复跑）。

---

## 0. 一句话结论

工具面这一层**不是写得糙，是有三扇门**。`modelFacingToolRegistry.ts` 自称
「模型可见工具的**唯一注册表**」，`agentToolCatalog.ts:31` 同时自称
「**The only** model-facing catalog entry point」——两句话都写在 main 上，
而它们投影的是两份**互相矛盾**的说明书。第三扇是契约上的 `projections.{pi,mcp}.description`，
23 个契约各自又写了一遍。

后果不是难看：`nomi_generation_plan` 这一个工具名，今天在仓库里有**三份不同的描述**，
其中两份直接互相否定（一份说它能 preview，一份说它 cannot preview）。
模型看到哪一份取决于它从哪条路进来，而**没有任何东西会因此报错**。

| 维度 | 数 |
|---|---|
| internal profile（面板 lane）工具 | **36** |
| mcp profile 别名说明书 / 对外发布工具 | **16 / 6** |
| 第三扇门（`modelToolSurfaceManifest`，gate 里叫 "internal"） | **12** |
| 描述不达 Anthropic 三条硬线的条数 | 见 §3 汇总 |
| 同效果重复组 | **4 组**（§4.1） |
| 描述与运行时/兄弟描述矛盾 | **5 条**（§4.2） |
| 中英混杂的模型可见字符串 | **13 处 / 9 个工具**（§4.3） |
| 选对工具率题库 | **30 条**（16 zh / 14 en） |

---

## 1. 先查别人

### 1.1 Anthropic 官方 — 抽成检查清单

来源：<https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools>

**字段硬约束（原文表格）**

| 字段 | 原文要求 |
|---|---|
| `name` | "The name of the tool. Must match the regex `^[a-zA-Z0-9_-]{1,128}$`." |
| `description` | "A detailed plaintext description of what the tool does, when it should be used, and how it behaves." |
| `input_schema` | "A [JSON Schema](https://json-schema.org/) object defining the expected parameters for the tool." |

**"Best practices for tool definitions" 五条（原文逐条）**

- **A1** "**Provide extremely detailed descriptions.** This is by far the most important factor in tool performance." 描述必须解释：
  - "What the tool does"
  - "When it should be used (and when it shouldn't)"
  - "What each parameter means and how it affects the tool's behavior"
  - "Any important caveats or limitations, such as what information the tool does not return if the tool name is unclear."
  - 长度底线原文：**"Aim for at least 3–4 sentences for each tool description, more if the tool is complex."**
  - 以及那句定性：**"The more context you can give Claude about your tools, the better it will be at deciding when and how to use them."**
- **A2** "**Prioritize descriptions, but consider using `input_examples` for complex tools.** Clear descriptions are most important, but for tools with complex inputs, nested objects, or format-sensitive parameters, you can use the `input_examples` field to provide schema-validated examples."
- **A3** "**Consolidate related operations into fewer tools.** Rather than creating a separate tool for every action (`create_pr`, `review_pr`, `merge_pr`), group them into a single tool with an `action` parameter. Fewer, more capable tools reduce selection ambiguity and make your tool surface easier for Claude to navigate."
- **A4** "**Use meaningful namespacing in tool names.** When your tools span multiple services or resources, prefix names with the service (for example, `github_list_prs`, `slack_send_message`). This makes tool selection unambiguous as your library grows…"
- **A5** "**Design tool responses to return only high-signal information.** Return semantic, stable identifiers (for example, slugs or UUIDs) rather than opaque internal references, and include only the fields Claude needs to reason about its next step. Bloated responses waste context…"

**好 / 坏描述示例（原文）**

好：
> "Retrieves the current stock price for a given ticker symbol. The ticker symbol must be a valid symbol for a publicly traded company on a major US stock exchange like NYSE or NASDAQ. The tool will return the latest trade price in USD. It should be used when the user asks about the current or most recent price of a specific stock. **It will not provide any other information about the stock or company.**"

坏：
> "Gets the stock price for a ticker."

官方评语原文：
> "The good description clearly explains what the tool does, when to use it, what data it returns, and what the `ticker` parameter means. The poor description is too brief and leaves Claude with many open questions about the tool's behavior and usage."

**→ 本审计使用的检查清单（每条工具逐项 ✓/✗）**

| 代号 | 判据 | 来源 |
|---|---|---|
| C1 | 说清**做什么** | A1 "What the tool does" |
| C2 | 说清**何时用 / 何时不用** | A1 "When it should be used (and when it shouldn't)" |
| C3 | **每个参数**的含义都有解释 | A1 "What each parameter means" |
| C4 | 说清**限制 / 它不返回什么** | A1 "caveats or limitations… what information the tool does not return" |
| C5 | **≥3 句** | A1 "at least 3–4 sentences" |
| C6 | 复杂入参带 **schema-valid 示例** | A2 |
| C7 | **不与兄弟工具效果重复**（能合并的已合并） | A3 |
| C8 | 名字**带命名空间**且全表一致 | A4 |

### 1.2 pi（我们真正跑的那个框架）

pi 是本仓的 Agent 运行时（`@earendil-works/pi-coding-agent` v0.85.1）。它自带的 coding agent
把模型可见文字**切成三个通道**，`ToolDefinition` 上各有一个字段
（`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:344-377`）：

| 字段 | 上游注释原文 | 付什么代价 |
|---|---|---|
| `description` | `Description for LLM` | 每次请求的工具 schema token |
| `promptSnippet?` | `Optional one-line snippet for the Available tools section in the default system prompt. Custom tools are omitted from that section when this is not provided.` | 系统提示词里**一行** |
| `promptGuidelines?` | `Optional guideline bullets appended to the default system prompt Guidelines section when this tool is active.` | 系统提示词里若干 bullet，**跨工具去重** |

装配点 `dist/core/system-prompt.js:41-43` 的注释写死了这条纪律：
> `// A tool appears in Available tools only when the caller provides a one-line snippet.`

**pi 自带工具的描述原文（代表性 4 条）**

- `read`（`dist/core/tools/read.js:37`）
  > "Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete."
- `bash`（`dist/core/tools/bash.js:150`）
  > "Execute a ${config.shellName} command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds."
- `edit`（`dist/core/tools/edit.js:86`）
  > "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes."
- `grep`（`dist/core/tools/grep.js:34`）
  > "Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars."

**snippet / guidelines 原文（代表性）**

- `read.js:16-19` — snippet `Read file contents`；guidelines `["Use read to examine files instead of cat or sed."]`
- `write.js:13-16` — snippet `Create or overwrite files`；guidelines `["Use write only for new files or complete rewrites."]`
- `edit.js:23-31` — snippet `Make precise file edits with exact text replacement, including multiple disjoint edits in one call`

**归纳出的写法模式（8 条，我们逐条对照）**

1. 开口是**祈使动词 + 一句话职责**，现在时、无主语。从不写 "This tool allows you to…"。
2. 第 2 句 = **返回什么**（"Returns stdout and stderr."）。
3. 第 3 句 = **机械限制，永远带数字，且数字从真实常量插值**——`${DEFAULT_MAX_LINES}` 不是文案，
   就是代码本身，所以描述**不可能与实现漂移**。
4. 长度 1–4 句 / 约 20–60 词。最长的 `edit` 把长度花在**正确性不变量**上，不是花在能力吹嘘上。
5. **`description` 里没有「何时不用」**——工具选择建议一律挪进 `promptGuidelines`
   （"Use read to examine files instead of cat or sed."）。理由是预算：description 每次请求都付费，
   guidelines 跨工具去重后只付一次。
6. 参数描述是**名词短语片段**，不带句号，格式 `<名词短语>（<默认值或限定>）`：
   "Directory to search in (default: current directory)"、"Case-insensitive search (default: false)"。
7. **零副作用措辞**。pi 的 `ToolDefinition` 上**根本没有** readonly / destructive / cost 字段
   （grep `readOnly|sideEffect|destructive` 在 pi 两个包的 `types.d.ts` 上零命中）。
   最近的只有 `AgentTool.replay?: "never" | "safe"`（`pi-agent-core/dist/types.d.ts:350`），
   那是崩溃恢复策略，不是审批注解。
8. 零拟人、零 "you should"、零 CAPS/加粗/"IMPORTANT:"。

**与四列表的一致性**：`docs/engineering/framework-boundaries.json`（framework `pi`，能力 `coding-tools`）
把「它提供」记成 `pi 自带 7 个 coding 工具…工具的执行、schema、渲染全部由 pi 提供；宿主只出范围、沙箱、审批三样策略`，
并挂了 forbidden 规则 `own-file-tool-schema`。`docs/research/2026-09-07-pi-coding-tools-layer.md` §1 的四列表里
「我们另写了」那一列**是空的**，唯一的加法是 `LANE_CODING_TOOL_EFFECTS` 的 `{mutates, billable, reversal}`——
文档明说「pi **没有**这个概念，所以它不是『另写了一份 pi 的东西』，是一层 Nomi 领域注解」。

**这对本次审计的意义**：我们的 `ModelFacingToolSpec` 的三通道（`description` / `promptSnippet` /
`promptGuidelines`）**就是 pi 的三通道，字段名逐字相同**——设计是对的。§4.4 量的是我们有没有按它用。

### 1.3 Codex 与 Claude Code — 各抄代表性原文

**Codex**（`github.com/openai/codex`，`codex-rs/core/src/tools/handlers/*_spec.rs`，2026-09-11 抓取）

- `exec_command`（`shell_spec.rs`）
  > "Runs a command in a PTY, returning output or a session ID for ongoing interaction."
- `apply_patch`（`apply_patch_spec.rs`）——**整条描述就这 20 个词**，入参靠 Lark 文法约束：
  > "The `apply_patch` tool can be used to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON."
- `update_plan`（`plan_spec.rs`）
  > "Updates the task plan.\nProvide an optional explanation and a list of plan items, each with a step and status.\nAt most one step can be in_progress at a time."
- `new_context_window`（`new_context_window_spec.rs`）——**显式声明「非效果」**：
  > "Start a new context window. Does not clear, reset, or otherwise affect environment state."
- `list_mcp_resources`（`mcp_resource_spec.rs`）——**兄弟优先级写进描述**：
  > "Lists resources provided by MCP servers. … Prefer resources over web search when possible."
- `request_plugin_install`（`request_plugin_install_spec.rs`）——**全仓最强的「只在何时用 / 不要用于」**：
  > "# Request plugin/connector install\n\nUse this tool only after `list_available_plugins_to_install` returns a plugin or connector that exactly matches the user's explicit request.\n\nDo not use it for adjacent capabilities, broad recommendations, or tools that merely seem useful. Pass the returned `tool_type` through directly, and pass the returned `id` as `tool_id`.\n\nIMPORTANT: DO NOT call this tool in parallel with other tools."
- `spawn_agent`（`multi_agents_spec.rs`）——**预先堵死模型的自我合理化**：
  > "Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.\nRequests for depth, thoroughness, research, investigation, or detailed codebase analysis do not count as permission to spawn."

**Claude Code**（本机 `@anthropic-ai/claude-code` v2.1.263；描述是模板字面量，兄弟工具名由变量插值）

- `Read`（lean）
  > "Reads a file from the local filesystem.\n\n- `file_path` must be an absolute path.\n- Reads up to 2000 lines by default.\n- When you already know which part of the file you need, only read that part. …\n- Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed, and the harness tracks file state for you."
- `Write`（lean）——**「何时用 / 改用谁」压成一段**：
  > "Writes a file to the local filesystem, overwriting if one exists.\n\nWhen to use: creating a new file, or fully replacing one you've already Read. Overwriting an existing file you haven't Read will fail. For partial changes, use Edit instead."
- `Grep`（模板原文，`${ro}`=Grep、`${qe}`=Bash、`${mt}`=Agent）
  > "A powerful search tool built on ripgrep\n\n  Usage:\n  - ALWAYS use ${ro} for search tasks. NEVER invoke \\`grep\\` or \\`rg\\` as a ${qe} command. …"
- `Bash` 的**改道表**（由工具名变量生成，重命名不会留下孤儿引用）：
  > `File search: Use ${Glob} (NOT find or ls)` / `Content search: Use ${Grep} (NOT grep or rg)` / `Read files: Use ${Read} (NOT cat/head/tail)` / `Edit files: Use ${Edit} (NOT sed/awk)` / `Write files: Use ${Write} (NOT echo >/cat <<EOF)`
- `WebFetch`（full）——**代价高的失败模式写在第一行，抢在能力陈述之前**：
  > "IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g. Google Docs, Confluence, Jira, GitHub). If so, look for a specialized MCP tool that provides authenticated access."
- 参数描述里**点名模型常犯的那个错值**（`sdk-tools.d.ts`，`GlobInput.path`）：
  > "…IMPORTANT: Omit this field to use the default directory. DO NOT enter \"undefined\" or \"null\" - simply omit it for the default behavior."

**两家共同的写法模式（归纳）**

| # | 模式 | 证据 |
|---|---|---|
| P1 | 开口是**第三人称现在时谓语**描述工具做什么，不是祈使命令；工具名本身是动词短语时才用祈使 | "Runs a command…"、"Reads a file…"、"Updates the task plan."；例外 `view_image` / `Agent` |
| P2 | 第一句是**能独立成立的一句话职责**，后面的细节都是可选追加 | Codex 中位数就是这一句；Claude Code 的 lean/full 双版本就是把这句当不可再减的内核 |
| P3 | **「何时不用 / 改用谁」是必备段落**，代价越高越往前放 | WebFetch 把禁令放第一行；Codex `request_plugin_install` 用 "Use this tool only after…" + "Do not use it for…" |
| P4 | 参数**主渠道是 schema 字段描述**；只有**跨字段约束**才写进工具描述 | Codex `prefix_rule`: "…only with `sandbox_permissions: \"require_escalated\"`" |
| P5 | 副作用**稀疏标注，只标不可逆或要花钱的**；并且会**显式声明「非效果」** | "Does not clear, reset, or otherwise affect environment state."、"This tool is read-only and does not modify any files." |
| P6 | 长度**跟决策风险走，不跟 API 面积走** | Codex 机制显然的工具 1 句；要做策略决定的（spawn/install/escalate）10–40 倍 |
| P7 | **兄弟工具互相点名，并给出裁决规则**——凡两个工具可能做同一件事，至少一侧点名对方 | Bash ↔ Grep/Glob/Read/Edit/Write 双向；Agent ↔ Read/Grep；`tool_search` vs `list_mcp_resources` |
| P8 | 兄弟名用**变量/常量插值**，不写字面量，重命名不会留下孤儿引用 | Claude Code 全量插值；Codex 有常量的用 `format!` |

> **P7 是本次审计最该抄的一条。** 我们有 4 组同效果重复（§4.1），
> 而 36 条描述里**没有任何一条点名过兄弟工具并给出裁决规则**——唯一的例外是
> `start_production_run`（"…use the generation plan intent"），而它点的那个名字
> （"the generation plan intent"）**不是一个真实工具名**，模型没法照着调。

---

## 2. 我们的工具面

`dump.mts` 从 `modelFacingToolSpecs(profile)` 机械生成，两份 JSON 在同目录。

| profile | 数量 | 形状 |
|---|---|---|
| `internal`（面板 lane） | **36** 个工具 | 一别名一工具；12 个常驻 + 24 个按 `internalGroup` 延迟披露 |
| `mcp`（对外 stdio） | **16** 份别名说明书 → **6** 个发布工具 | 一契约一工具，别名折成判别字段，首字段 `leaseHandle` |

**第三扇门**：`electron/harness/tools/modelToolSurfaceManifest.ts` 另有 **12** 个
`nomi_*` 工具，字段叫 `intent` 而不是 `description`，schema 是**语义 schema**
而不是模型可见的扁平 schema，副作用用的是**另一套词表**
（`sideEffect: none|proposal|external` + `risk: read|project_write|paid_external`，
而不是 `{mutates, billable, reversal}`）。它经 `agentToolCatalog.ts` 投影，
而那个文件第 31 行的注释写着：

> `The only model-facing catalog entry point.`

同一时刻 `modelFacingToolRegistry.ts` 第 1 行写着：

> `模型可见工具的**唯一注册表**`

**两句话都在 main 上。** §4.2 是它们说出来的互相矛盾的话。

---

## 3. 逐工具打分（internal profile，36 条）

判据见 §1.1 的 C1–C8。`C3` 按「schema 字段有 `description` 的比例」机械计（100% = ✓，
0% 且字段数 > 0 = ✗，其余 = △）。`C5` 按句号切句。

| # | 工具 | C1 做什么 | C2 何时不用 | C3 参数 | C4 限制 | C5 ≥3句 | C6 示例 | C7 不重复 | C8 命名空间 | 重复组 | 矛盾 | 中英混杂 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `read_full_text` | ✓ | ✗ | n/a | ✓ | ✓ | ✓ | ✓ | ✗ | | | |
| 2 | `read_selection` | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | ✓ | ✗ | | | |
| 3 | `insert_at_cursor` | ✓ | ✓ | ✓ 1/1 | ✓ | ✓ | ✓ | ✓ | ✗ | | | |
| 4 | `replace_selection` | ✓ | ✗ | ✓ 1/1 | ✓ | ✓ | ✓ | ✓ | ✗ | | | |
| 5 | `append_to_end` | ✓ | ✗ | ✓ 1/1 | ✓ | ✓ | ✓ | ✓ | ✗ | | | |
| 6 | `nomi_canvas_read` | ✓ | ✗ | n/a | ✓ | ✓ | ✓ | ✓ | ✓ | | **M1** | |
| 7 | `nomi_canvas_write` | ✓ | ✗ | △ 14/34 | ✗ | ✗ 2 | ✓ | ✗ | ✓ | **D1** | | |
| 8 | `nomi_storyboard_write` | △ | ✗ | △ 30/42 | ✗ | ✗ 1 | ✓ | ✗ | ✓ | **D1 D2** | | **Z1** |
| 9 | `nomi_shot_reference_write` | ✓ | ✗ | △ 22/27 | ✗ | ✗ 2 | ✓ | ✓ | ✓ | | | **Z2** |
| 10 | `read_timeline` | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | ✓ | ✗ | | | |
| 11 | `inspect_timeline_range` | ✓ | ✓ | ✗ 0/2 | ✓ | ✓ | ✓ | ✓ | ✗ | | | |
| 12 | `get_media` | ✓ | ✗ | ✗ 0/1 | ✓ | ✗ 2 | ✗ | ✗ | ✗ | **D3** | | |
| 13 | `inspect_media` | ✓ | ✓ | ✗ 0/1 | ✓ | ✓ | ✗ | ✗ | ✗ | **D3** | | |
| 14 | `search_media` | ✓ | ✓ | ✗ 0/3 | ✓ | ✗ 2 | ✗ | ✓ | ✗ | | | |
| 15 | `inspect_source_range` | ✓ | ✓ | ✗ 0/3 | ✓ | ✗ 2 | ✗ | ✓ | ✗ | | | |
| 16 | `read_waveform` | ✓ | ✗ | ✗ 0/4 | ✓ | ✗ 2 | ✗ | ✓ | ✗ | | | |
| 17 | `propose_edit_plan` | ✓ | ✗ | △ 26/34 | ✗ | ✗ 2 | ✓ | ✓ | ✗ | | | |
| 18 | `apply_edit_plan` | ✓ | ✗ | △ 26/34 | ✗ | ✗ 2 | ✓ | ✓ | ✗ | | | |
| 19 | `undo_timeline_edit` | ✓ | ✗ | ✗ 0/3 | ✗ | ✗ 2 | ✗ | ✓ | ✗ | | | |
| 20 | `inspect_export_job` | ✓ | ✗ | ✗ 0/1 | ✗ | ✗ 2 | ✗ | ✓ | ✗ | | | |
| 21 | `verify_render` | ✓ | ✓ | ✗ 0/1 | ✓ | ✗ 2 | ✗ | ✓ | ✗ | | | |
| 22 | `export_timeline` | ✓ | ✗ | ✗ 0/5 | ✗ | ✓ | ✗ | ✓ | ✗ | | | |
| 23 | `cancel_export_job` | ✓ | ✗ | ✗ 0/1 | ✗ | ✗ 2 | ✗ | ✓ | ✗ | | | |
| 24 | `delete_canvas_nodes` | ✓ | ✓ | ✗ 0/2 | ✗ | ✓ | ✗ | ✓ | ✗ | | | |
| 25 | `nomi_generation_plan` | △ | ✗ | △ 17/66 | ✗ | ✗ 2 | ✓ | ✗ | ✓ | **D1** | **M2 M3** | **Z3** |
| 26 | `nomi_generation_status` | ✓ | ✓ | ✓ 3/3 | ✗ | ✓ | ✓ | ✗ | ✓ | **D4** | **M4** | |
| 27 | `get_production_run` | ✓ | ✗ | ✓ 1/1 | ✓ | ✓ | ✗ | ✗ | ✗ | **D4** | | |
| 28 | `subscribe_production_run` | ✓ | ✓ | ✓ 3/3 | ✓ | ✗ 2 | ✗ | ✓ | ✗ | | | |
| 29 | `read_production_artifact` | ✓ | ✓ | ✓ 2/2 | ✗ | ✗ 2 | ✗ | ✓ | ✗ | | | |
| 30 | `read_production_artifact_content` | ✓ | ✓ | ✓ 2/2 | ✗ | ✗ 1 | ✗ | ✓ | ✗ | | | |
| 31 | `start_production_run` | ✓ | ✓ | △ 2/8 | ✓ | ✗ 2 | ✓ | ✗ | ✗ | **D2** | **M5** | |
| 32 | `control_production_run` | ✓ | ✗ | △ 1/3 | ✗ | ✓ | ✗ | ✗ | ✗ | **D4** | | |
| 33 | `decide_production_gate` | ✓ | ✗ | △ 1/4 | ✓ | ✗ 2 | ✗ | ✓ | ✗ | | | |
| 34 | `revise_production_artifact` | ✓ | ✓ | △ 2/5 | ✗ | ✗ 2 | ✗ | ✓ | ✗ | | | |
| 35 | `review_production_artifact` | ✓ | ✓ | △ 2/4 | ✓ | ✗ 2 | ✗ | ✓ | ✗ | | | |
| 36 | `materialize_production_storyboard` | ✓ | ✓ | △ 2/3 | ✓ | ✗ 2 | ✗ | ✗ | ✗ | **D2** | | |

**汇总（36 条）**

| 判据 | 不合格 | 说明 |
|---|---|---|
| C1 做什么 | 2 | `nomi_storyboard_write`、`nomi_generation_plan` 只列 operation 不说职责 |
| **C2 何时不用** | **19** | 过半；且**零条点名兄弟工具**（见 §1.3 P7） |
| **C3 参数全描述** | **12 全空 + 12 部分** | 全表 `305` 个模型可见字段，只有 `159` 个有 `description`（**52%**） |
| C4 限制/不返回什么 | 16 | |
| **C5 ≥3 句** | **22** | Anthropic 原文 "at least 3–4 sentences" |
| C6 示例 | 20 | 门岗只在字段 ≥10 时要求，故大部分不违门岗但违 A2 |
| **C7 不与兄弟重复** | **9**（4 组） | §4.1 |
| **C8 命名空间一致** | **30** | 只有 6 个带 `nomi_` 前缀，30 个裸名；同一张表里两种约定 |

> **最贵的两格是 C2 和 C3**，而它们恰好是 Anthropic 原文列在 A1 里的第二、第三项。
> C3 的 52% 尤其值得看：`nomi_generation_plan` 有 **66 个模型可见字段，只有 17 个有描述**——
> 剩下 49 个字段模型只能看见一个名字和一个类型。

---

## 4. 四类系统性毛病

### 4.1 同效果重复（D1–D4）

判据不是「名字像」，是**「同一句用户的话，两个工具都能把它办成，而描述里没有任何一句话告诉模型挑哪个」**。

#### D1 · 四扇门通往同一件事：把节点放到生成画布上

| 工具 | operation | 它把什么放上画布 |
|---|---|---|
| `nomi_canvas_write` | `create_canvas_nodes` | 任意节点（keyframe / video / agent-artifact…） |
| `nomi_storyboard_write` | `propose_storyboard_plan` | 整份分镜的全部镜头节点 |
| `nomi_generation_plan` | `create` | 一份生成草稿（09-10 拍板后**草稿建即落画布**） |
| `materialize_production_storyboard` | — | 已批准的 production 分镜产物 |

四条描述**互不点名**。用户说「帮我生成一张海上日出的图」时，四扇门都接得住，
而模型手上唯一的区分信息是四个名字。这是 #547 那个 0/18 的同一种病，
只是当时是**两枚一模一样的硬币**，现在是**四枚长得不太一样但都能用的硬币**——
后者更难发现，因为门岗的 `identical-input-schema` 规则只抓前者
（判据是「schema 相同 **且** schema 里仍留着多值判别枚举」，`check-model-schema.ts:255-265`）。

**证据（机械可复跑）**：题库 `tests/fixtures/tool-selection/2026-09-11-tool-selection-bank.json`
里 `contestedWith` 非空的条目 **17/30**，其中 6 条的 `contestedWith` 指向这一组。

#### D2 · 「做一个成片」三扇门

`start_production_run` / `nomi_storyboard_write` / `materialize_production_storyboard`。
`start_production_run` 是全表**唯一**尝试划界的描述：

> "For a concrete image/video request or a multi-minute finished piece, use **the generation plan intent**…"

但 "the generation plan intent" **不是一个工具名**，模型无法照着调
（真正的工具叫 `nomi_generation_plan`）。按 §1.3 的 P8，兄弟引用必须是可插值的真实工具名。

#### D3 · `get_media` / `inspect_media`——最接近 #547 原型的一组

两者的**模型可见 JSON Schema 字节级相同**（194 B，均为 `{assetId}`），描述长度均为 189 字符，
且都以 "…one … media …" 起手：

> `get_media`: "Read one active-project media record by stable asset id without returning any path or URL. Returns the stored record only; no file path, no URL, and no media bytes ever cross this boundary."
>
> `inspect_media`: "Inspect bounded technical metadata without claiming semantic visual or audio understanding. Returns container-level facts only. It does not describe what is visible or audible in the media."

模型要区分「stored record」与「container-level facts」——这两个词组在描述里**都没有解释**。
它们没被门岗抓到，是因为 schema 里没有多值枚举（判据的后一半不成立）。

> 全表共 **6 组** schema 字节级相同（17 个工具）。其余 4 组**不是病**，
> 应当明确记为「已裁决合规」，避免下一个门岗把它们一起抓进来：
> `read_full_text`/`read_selection`/`nomi_canvas_read`/`read_timeline`（都是无参工具，
> 空 schema 相同不可避免，动作由名字定死）；`insert_at_cursor`/`replace_selection`/`append_to_end`
> （`{content}` 相同，动作由名字定死，#547 实测这一族成功率 100%）；
> `inspect_export_job`/`verify_render`/`cancel_export_job`（`{jobId}` 相同）；
> `propose_edit_plan`/`apply_edit_plan`（同一份 plan 的预览与应用，名字承担 preview/apply 的区分）。

#### D4 · 「这个任务跑到哪了 / 停掉它」跨两条管线

`nomi_generation_status`（read/cancel/reconcile）、`get_production_run`、`control_production_run`（pause/resume/cancel/set_trust）。
用户那句「刚才那个取消掉」在两条管线上**语义完全相同**，而三条描述都没说
「如果是 production run 请用另一个」。

### 4.2 描述与运行时 / 与兄弟描述矛盾（M1–M5）

| # | 工具 | 矛盾 | 证据 |
|---|---|---|---|
| **M1** | `nomi_canvas_read` | 同一个工具名有**三份**不同描述 | 注册表 spec `description`（452 字符，含"inventing an id is the single most common way a canvas edit fails"）／ 契约 `projections.pi.description`："Read the current generation canvas (nodes + edges)." ／ 契约 `projections.mcp.description`："Read the project canvas as compact nodes and edges." ／ 第三扇门 `modelToolSurfaceManifest.ts` 的 `intent`："Read the current generation canvas as bounded, safe nodes and reference edges." |
| **M2** | `nomi_generation_plan` | **一份说能 preview，一份说不能** | 注册表 spec：`"… This host cannot preview or start paid generation. …"`（`extendedModelTools.ts:53`）；`modelToolSurfaceManifest.ts:36` 的 `intent`：`"Form and revise one editable generation plan, then preview its proposed execution."` 两份 schema 也真的不同：lane 走 `generationPlanSchemaForHost({preview:false})`（剥掉 `preview` 分支），manifest 走 `generationPlanInputSchema`（**保留** `preview` 分支，`generationPlanSchemas.ts:80,91-93`） |
| **M3** | `nomi_generation_plan` | 措辞与**后果**不符 | "This host cannot … start paid generation" 说的是**模型够不着付费工具**（`paidBoundary.ts` 保证，属实）；但 09-10 拍板「草稿建即落画布 / 付费卡=介入槽一张卡」之后，一次成功的 `create` 正是**产出那张付费确认卡**的动作。模型手上关于「下一步会发生什么」只有这一句话，而这句话读起来像「到此为止」。**需关门方案在真机上核实后改写**（本审计只标，不下结论） |
| **M4** | `nomi_generation_status` | 名字归属与 spec 归属不是同一个契约 | 注册表里 `generation.run.read` 的 `aliases.pi` 就是 `nomi_generation_status`（`generation.ts:115`），而这个名字的 `ModelFacingToolSpec` 声明 `contractId: "generation.control"`（`extendedModelTools.ts`）。审批与副作用按后者算，别名解析按前者。同时 `generation.control` 自己的 `aliases.pi` 是 `nomi_cancel_generation`——**一个模型永远看不见的名字** |
| **M5** | `start_production_run` | 兄弟引用指向不存在的工具 | "…use **the generation plan intent**" —— 真实工具名是 `nomi_generation_plan` |

**另有 24 个「幽灵别名」**：契约声明了 `aliases.pi` / operation 别名，但**没有任何工具面发布它**，
而 `resolveModelToolCapabilityId` 仍会通过 `resolveCapabilityAlias` 把它们解析成真实能力。
其中两类值得关门方案单独看：

- **顶层幽灵**（契约主别名，模型看不见任何对应工具）：`read_canvas_state`（`canvas.read` 的 `aliases.pi`，
  而工具叫 `nomi_canvas_read`——**契约与工具对同一件事用了两个名字**）、`set_node_prompt`、
  `layout_read`、`layout_write`、`load_skill`、`author_skill`、`nomi_get_generation_context`、
  `nomi_resolve_generation_plan`、`nomi_cancel_generation`、`nomi_reconcile_generation`、`nomi_operation_read`。
- **付费边界上的幽灵**：`nomi_request_generation_gate`、`nomi_start_generation`、`nomi_decide_generation_gate`
  （`generation.gate`，`effect: "paid"`）。`paidBoundary.ts` 保证它们不投影到 internal profile，
  这一层是对的；本条只记录「这些名字可被解析」这个事实，**是否可达要由关门方案在 dispatcher 上验**。

`layout.read` / `layout.write` / `skill.read` / `skill.write` 四个契约**完全没有模型可见说明书**——
23 个契约里有 4 个是这样。

### 4.3 中英混杂（Z1–Z3）

同一张工具表里模型看到的语言必须统一。R15 管的是**用户可见文字**（i18n，`zh-CN`/`en`）；
**模型可见文字不在 R15 的覆盖里**——它不是 UI 文案，没有 locale，只有一份，
所以它必须自己选定一种语言并守住。今天没有任何规则说它该是哪种，于是它两种都是。

| # | 位置 | 原文 |
|---|---|---|
| **Z1** | `nomi_storyboard_write.description`（整条中文，而它的 `promptSnippet` 是英文） | "保存分镜、修改指定镜头或排列时间线。operation 必填：整份方案用 propose_storyboard_plan，局部修改用 patch_shots，排列用 arrange_storyboard_to_timeline。镜头通过 anchorIds 引用跨镜一致的角色、场景、道具和风格。" |
| **Z1** | `shots[].modelKey` / `shots[].params` 的 schema 描述 | "已指定填目录键；未指定用默认。" / "已指定按档案填；未指定派生，禁编键。" |
| **Z1** | `shots[].keyframe.enabled` 的 schema 描述（英文句子里嵌中文模式名） | "Set true only for **图片+视频** mode: create a first-frame image before the video." |
| **Z1** | `anchors[].name` 的 schema 描述（英文句子里嵌中文示例值） | "Display name & shot-reference key ('林夏' / '天台' / '红书包' / '全片风格')." |
| **Z2** | `nomi_shot_reference_write` 的 guideline（英文句子里嵌中文注释） | "layout: side-by-side=shoulder-to-shoulder row（并排/一字排开）; line=front-to-back queue（纵队）; …" |
| **Z2** | `characters[].name` 的 schema 描述 | "Character label, e.g. '林夏' / '角色A'." |
| **Z3** | `nomi_generation_plan.description` 里内联的示例 JSON | `…"prompt":"海上日出"}` |
| **Z3** | `nomi_canvas_write` 的示例 `when` / `arguments` | "创建一个镜头：" / `{summary:"开场镜头", nodes:[{title:"开场", prompt:"清晨日出"}]}` |
| **Z4** | **对外 MCP 的六个工具，每一个的首字段** | `leaseHandle.description`: "nomi_session_open 返回的项目租约句柄。" —— 外部宿主（Claude Code / Codex）看到的**第一个字段**是中文 |

合计 **13 处 / 9 个工具**（含 MCP 侧 6 个工具共用的那一条）。

> **注意这里不是「把中文都翻成英文」那么简单**：`'林夏'`、`图片+视频` 这几处是**示例值**与**模式名**，
> 换成英文会让中文用户场景下的示例失真。正确的裁决是分两类：
> **① 说明性散文一律英文**（Z1 的 description / schema description、Z4 的 leaseHandle）；
> **② 示例值可以保留中文，但必须明确标成示例**（"e.g."），因为它演示的正是
> 「prompt 要和用户同语言」这条 guideline。这条裁决要写进门岗，否则下一轮又会有人一刀切。

### 4.4 通道塌缩：`promptSnippet` 被当成 `description` 用

pi 的合同是三个通道各付各的代价（§1.2）。我们的 `ModelFacingToolSpec` 字段名与它逐字相同，
但 **36 条里有 20 条把 `promptSnippet` 直接赋成了 `description`**：

- `extendedModelTools.ts:22` — `promptSnippet: input.description`（覆盖 11 个工具）
- `productionModelTools.ts:20` — `promptSnippet: descriptor.description`（覆盖 11 个工具，与上面有重叠）

后果具体：`lanePromptSections.ts` 渲染的 `Available tools` 菜单本该是一行一个工具，
现在其中 20 行是整条描述。最极端的一行是 `nomi_generation_plan`——
它的「一行菜单项」是整条 415 字符的描述，其中 214 字符是一个内联 JSON 示例对象。

这条不需要讨论对错：本仓自己的类型注释（`modelFacingTools.ts`）已经写死了
`通道②。一行，进系统提示词的 Available tools 菜单。全表只出现一次。`
——**规则在，只是没人执行它**。这正是 R28 的形状：编译器拦得住的（`promptSnippet` 可以做成
与 `description` 不同的必填类型），留给了没人看的注释。

### 4.5 对外 MCP 侧的两条额外病

- **`nomi_canvas_edit` 的描述是 5345 字符**，由三个别名的 `description` + 全部 `promptGuidelines`
  机械拼成（`projectMcpTool`）。也就是说：内部宿主看到的是「短描述 + 跨工具去重的 Guidelines 段」，
  外部宿主看到的是**同样的内容全部塞进一个工具的 description**——通道③ 的去重收益在 MCP 侧整个丢失。
  对比 §1.3：Codex 全仓最长的 `spawn_agent` 才 ~700 词，而它是**唯一**的异常值。
- **`nomi_canvas_edit` 有 28 个顶层字段却 `discriminators: {}`**。三个别名的 `aliasBoundInput` 都是空的
  （`operation` 本来就在参数里），所以合并后模型面对的是一个 28 字段的扁平对象，
  没有任何判别字段告诉它哪几个字段属于同一组。这与 Anthropic 的 A3（合并成带 `action` 参数的工具）
  形式上像，实质相反——A3 要求**有**那个 action 参数并把字段按它分组。

---

## 5. 改写提案（原文）

写法遵循 §1.3 归纳的 P1–P8 与 §1.1 的 C1–C8。每条给出：**新 `description` 原文**、
**新 `promptSnippet`（一行）**、**schema 该收紧/该删的字段**。

> **统一约定（三条，适用于全部 36 条）**
> 1. 第 1 句 = 第三人称现在时谓语 + 一句话职责（P1/P2）。
> 2. 第 2 句 = 返回什么 / 不返回什么（C4 + P5「显式声明非效果」）。
> 3. 最后一句 = **何时不用，并点名真实工具名**（C2 + P7）。工具名一律**从常量插值**，
>    不写字面量（P8）——见 §6 的 `TOOL` 常量表提案。

### 5.1 D3 组：`get_media` / `inspect_media`（最高优先级，字节级相同的一组）

**`get_media`**

> **description（新）**
> Returns one media asset's stored project record — its id, kind, display name, duration and the project-relative reference the canvas and timeline use to point at it. This is the record Nomi keeps, not the file: no filesystem path, no URL and no media bytes ever cross this boundary. Requires an `assetId` you already have from `search_media` or from a canvas/timeline read; it cannot look an asset up by name. For container-level technical facts (codec, resolution, sample rate) call `inspect_media` instead — this tool does not return them.
>
> **promptSnippet（新）**
> `Read one media asset's stored project record by id.`

**`inspect_media`**

> **description（新）**
> Returns container-level technical facts about one media asset: codec, resolution, frame rate, sample rate, channel count and bit depth, read from the file header. It reports what the container declares and nothing about content — it does not describe what is visible or audible, and it never decodes frames. Requires an `assetId`; use `search_media` first when you only have a name. For the project record (display name, canvas reference) call `get_media` instead.
>
> **promptSnippet（新）**
> `Read one media asset's container-level technical facts.`

**schema（两者共有）**：`assetId` 今天是**裸的无描述字符串**（0/1）。加：

> `assetId`: `Stable asset id, e.g. from search_media results or a canvas node's assetId. Not a filename and not a path.`

### 5.2 D1 组：四扇通往画布的门

**裁决建议一句话**：`nomi_generation_plan` 是**唯一**「用户描述一次生成、我们把它变成画布上一个待生成节点」的门；
其余三个各自守一个它独有的语义。四条描述各加一句互相点名的裁决规则（P7），
且**四条的裁决规则必须两两一致**——由 §6 的门岗机械核对。

**`nomi_generation_plan`**

> **description（新）**
> Creates or revises one generation draft — the thing a user gets when they describe an image or a video they want. `operation:"context"` first reads what models, modes and parameters this project actually offers; `operation:"create"` turns a described shot into a draft node on the generation canvas; `operation:"patch"` revises a draft you already created. Identifiers (`moduleId`, `providerId`, `modelId`, `mode`) must be copied from a `context` read — inventing one is the single most common way this call fails. You cannot start the generation or spend the user's credit from here: the draft lands on the canvas and Nomi builds the confirmation card the user approves. Use `nomi_canvas_write` instead to create a non-generation node or to re-wire existing nodes, and `nomi_storyboard_write` instead when the user asked for a whole storyboard rather than one shot.
>
> **promptSnippet（新）**
> `Create or revise one generation draft on the canvas.`

> ⚠️ 倒数第二句（"the draft lands on the canvas and Nomi builds the confirmation card"）是
> §4.2 M3 的修法，**要由关门方案在真机上核实 09-10 之后的真实行为再定稿**。
> 现文案 "This host cannot preview or start paid generation" 必须删掉——它是 M2 矛盾的那一半。

**`nomi_canvas_write`**

> **description（新）**
> Creates, connects, retitles or tidies generation-canvas nodes in one reversible batch. `operation` selects which fields apply and unrelated fields are rejected, so send one operation per call but batch every node of that operation together rather than calling once per node. The whole batch lands as a proposal the user still has to accept — say what you are proposing, never that it is done. Node ids, model keys and vendor names must come from `nomi_canvas_read` or the user's available-models list; inventing one fails the call. Use `nomi_generation_plan` instead when the user described an image or video to generate, and `nomi_storyboard_write` instead for a whole storyboard.
>
> **promptSnippet（新）**
> `Create, connect, retitle or tidy canvas nodes in one batch.`

**`nomi_storyboard_write`**（今天整条中文 → 全英文，Z1）

> **description（新）**
> Saves, patches or arranges a whole storyboard — the ordered set of shots for a piece, not a single shot. `operation:"propose_storyboard_plan"` replaces the entire plan; `operation:"patch_shots"` changes only the rows you name; `operation:"arrange_storyboard_to_timeline"` lays existing shot nodes out in story order. Shots reference recurring characters, locations, props and style through `anchorIds`, which is what keeps them consistent across the piece. Every write is a proposal the user still has to accept. Use `nomi_generation_plan` instead for a single described shot, and `materialize_production_storyboard` instead when the storyboard came from an approved production artifact.
>
> **promptSnippet（新）**
> `Save, patch or arrange a whole storyboard.`

**`materialize_production_storyboard`**

> **description（新）**
> Attaches one approved production storyboard artifact to the real generation canvas, keeping its run and artifact provenance. Supply the exact `expectedVersion` you read from the artifact; a stale version is rejected rather than silently applied. This writes canvas nodes only — it starts no generation and spends no credit. Use it only for a storyboard that already exists as an approved artifact of a production run; for a storyboard you are authoring yourself use `nomi_storyboard_write`.
>
> **promptSnippet（新）**
> `Put an approved production storyboard onto the canvas.`

### 5.3 D4 组：两条管线的状态/取消

**`nomi_generation_status`**

> 末句追加：`This tool only covers generation operations started from the canvas. For a production run — anything you started with start_production_run — read get_production_run and act with control_production_run instead.`

**`get_production_run`**

> 末句追加：`This covers production runs only. For a single canvas generation operation use nomi_generation_status instead.`

**`control_production_run`**

> 末句追加：`Cancels or pauses the production run as a whole. To cancel one canvas generation operation use nomi_generation_status with operation:"cancel" instead.`

### 5.4 M5：`start_production_run` 的兄弟引用改成真实工具名

> 现文：`"… use the generation plan intent; Nomi Host handles preview, approval, and start transitions."`
> 新文：`"… use nomi_generation_plan instead. This tool never generates media and never spends credit; it stops at the first review gate and waits for the user."`

### 5.5 全表批量项（不逐条列，交给实施）

| 项 | 范围 | 动作 |
|---|---|---|
| **参数描述补齐** | 12 个工具 0 描述 + 12 个部分 | 每个模型可见字段按 §1.3 P4 的格式补：`<名词短语>（默认值/限定）`；跨字段约束写进工具 description，不写进字段 |
| **`promptSnippet` 拆出来** | 20 个工具 | 一行、祈使/谓语起手、≤12 词；参考 pi 的 `Read file contents` |
| **`promptGuidelines` 承接「何时不用」** | 全表 | 跨工具去重的规则进通道③；**只有点名兄弟工具的裁决规则**留在 description（因为它是这个工具独有的） |
| **中英统一** | 13 处 | 说明性散文一律英文；示例值保留中文但必须带 `e.g.` 标记（§4.3 的两类裁决） |
| **命名空间统一** | 30 个裸名 | 按 A4 全部加 `nomi_` 前缀，或全部去掉——**但必须二选一**。建议保留裸名并在系统提示词里声明「本表全部是 Nomi 工具」，因为 internal profile 里不存在第二个服务；**MCP profile 必须全部带前缀**（那里真的和别的服务混在一起）。这条要用户拍板 |
| **`nomi_canvas_edit`（MCP）瘦身** | 1 个工具 | 5345 字符 → 别名 description 合并后 ≤600 字符；`promptGuidelines` 改为投影到 MCP 的 `instructions` 或工具 annotations，而不是拼进 description |

---

## 6. 单一 owner 与门岗提案

### 6.1 今天有几扇门

| # | 门 | 文件 | 描述字段 | schema | 副作用词表 |
|---|---|---|---|---|---|
| 1 | **注册表**（36 internal / 6 mcp） | `electron/shared/agentCapabilities/modelFacingToolRegistry.ts` + 6 个 `*ModelTools.ts` | `description` / `promptSnippet` / `promptGuidelines` | 扁平化后的模型可见 schema | `{mutates, billable, reversal}` |
| 2 | **契约投影** | 各 `*.ts` 契约上的 `projections.{pi,mcp}.description` | `description` | — | `effect` / `effectClass` |
| 3 | **harness 清单**（12 个） | `electron/harness/tools/modelToolSurfaceManifest.ts` → `agentToolCatalog.ts` | `intent` | 语义 schema（**未扁平化**） | `{sideEffect, risk}` |

三扇门里**门 1 与门 3 的自我声明互相排斥**（§2 引的两句话），而门 2 是散在 23 个契约上的第三份文案。

**描述、schema、effect 三样今天确实不同源。** 但要说清楚**不是全散**：

- **effect** 已经收好了：`modelEffectsForCapability()` 从契约的 `effect`/`effectClass` 派生，
  装配期还有两条不变量（只读必 `reversal:"none"`、花钱必 `mutates`）。门 3 的 `{sideEffect, risk}`
  是它之外的**第二套手写词表**——这一处是真散。
- **schema** 在门 1 里是单一 owner（契约 schema → `flattenDiscriminatedUnion` → 模型可见），
  门 3 直接用**未扁平化的语义 schema**，所以同名工具两边的模型可见形状真的不同（M2 实证）。
- **description** 是**最散的一样**：三扇门各写各的，没有任何一处比对它们。

### 6.2 建议：收成一处，并且让「一处」这件事可被机器证明

**第一步（结构，交给关门方案）**：删掉门 3 与门 2 的描述字段，
让 `agentToolCatalog` 从 `modelFacingToolSpecs("internal")` 投影，契约上的
`projections.*.description` 全部删除（它们没有独立消费者，只是第三份文案）。
这是 P1「加新必删旧」的标准形状——注册表已经是新实现，门 2、门 3 是并行版。

**第二步（防线，本文件的提案）**：新增 `pnpm run check:tool-face`。
它与现有 `check:model-schema` **职责不重叠**：后者量的是**结构**
（空 schema / 根级 union / const-vs-enum / schema 相同 / 描述太短 / 缺示例 / 两 profile 漂移），
前者量的是**语义与一致性**——今天没有任何东西在看的那一半。

**规则表（以脚本 `RULES` 为准，此处只列设计意图；每条加规则前必须先验它会红，R17）**

| ruleId | 判据 | 为什么编译器/现有门岗管不了 |
|---|---|---|
| `single-description-owner` | 一个工具名在全仓只能有**一处** `description`/`intent`/`projections.*.description`。AST 扫这三个字段名，同名工具出现 ≥2 次即红 | 这是 M1/M2 的机器判据。今天三处各写各的，改一处不会让另两处报错 |
| `contradicts-paid-boundary` | 描述里出现 `cannot … paid` / `never generates` / `does not spend` 一族措辞的工具，其 `effects.billable` 与 `paidBoundary.isPaidBoundaryAlias` 必须与措辞一致；措辞与派生结果不符即红 | M3。措辞是散文，`billable` 是布尔——没人比对过 |
| `sibling-reference-resolves` | 描述里形如「use X instead」的 X 必须是**当前 profile 上真实存在的工具名** | M5（"the generation plan intent" 不存在）。这条同时强制 P8：兄弟名从 `TOOL` 常量插值，字面量直接红 |
| `mutual-tiebreak` | 声明为同一「效果组」（新增 `effectGroup` 字段）的工具，**两两之间至少一侧点名对方并给出裁决规则** | D1/D2/D4。现有 `identical-input-schema` 只抓 schema 字节相同的那一种重复，抓不到「schema 不同但效果相同」 |
| `describes-what-and-when-not` | 每条 description 必须**两段都有**：做什么（首句谓语）+ 何时不用（含 `instead` / `only when` / `does not` 一族）。今天 19 条缺后半段 | 现有 `thin-description` 只数字符数（门槛 120），数不出语义 |
| `snippet-is-one-line` | `promptSnippet !== description`，且 ≤120 字符、无换行、无 `{` | 4.4 的 20 条。本仓注释已经写死这条规则，只是没人执行 |
| `field-descriptions-complete` | 模型可见 schema 的每个字段都要有 `description`。棘轮：基线 `146` 个缺失，只减不增 | C3 的 52%。schema 合法但字段无描述，编译器与 ajv 都不会说话 |
| `model-facing-prose-is-english` | 模型可见的**说明性**字符串（description / promptSnippet / promptGuidelines / schema field description）不得含中日韩字符；**示例值**（`examples[].arguments`、description 里 `e.g.` 之后的引号内容）豁免 | §4.3。R15 只管用户可见文字，模型可见文字今天没有任何规则 |
| `name-convention-uniform` | 同一 profile 内工具名前缀约定唯一（要么全带 `nomi_`，要么全不带）；MCP profile 强制带前缀 | C8。A4 的机器化 |
| `no-orphan-alias` | 契约声明的 `aliases.pi` 必须要么等于某个 spec 的 `name`，要么显式登记成 `operationAlias`。今天 11 个顶层幽灵别名 | §4.2 末。`read_canvas_state` 与 `nomi_canvas_read` 是同一件事的两个名字，没有任何东西发现过 |

**落点建议**：这些规则中有 4 条（`snippet-is-one-line`、`sibling-reference-resolves`、
`single-description-owner`、`no-orphan-alias`）**可以在装配期用 `collectSpecs()` 里的 throw 拦住**，
按 R28「防线建在最早能拦住的那层」应当放在那里，而不是放进门岗——
`modelFacingToolRegistry.ts:collectSpecs()` 已经有两条这样的不变量了（只读必 `none`、花钱必 `mutates`），
再加四条是同一个位置、同一种形状。剩下的（棘轮类、语义类）才进 `check:tool-face`。

---

## 7. 验收设计（R30 的第三个数：选对工具率）

R30 今天只有两个数：**一次写对率** 与 **回合成功率**
（`tests/agent-runtime/lane-tool-accuracy.test.mts` 内部、`electron/capabilityCore/mcpToolAccuracy.test.ts` 对外）。
两者量的都是「模型填对参数了吗」。**没有任何东西量「模型挑对那扇门了吗」**——
而 §4.1 的四组重复正是在这个维度上出问题的。

**题库**：`tests/fixtures/tool-selection/2026-09-11-tool-selection-bank.json`
—— **30 条**（16 zh / 14 en），覆盖 图 / 视频 / 分镜 / 改图 / 查状态 / 取消 / 导出 / 文稿 / 时间轴 / 媒体 / 删除 / 成片。
每条带 `expectedTool`、`expectedOperation`、`contestedWith`、`note`。
全部 `expectedTool` 与 `contestedWith` 已用脚本对 `internal.json` 的 36 个真实工具名核过，零未知名。

**两档跑法（同一份题库）**

| 档 | 怎么跑 | 判据 |
|---|---|---|
| ① 零额度 loopback | 喂给 `tests/agent-runtime/laneFixture.mjs` 的假模型，断言首次 tool call 的 `name === expectedTool` | 进 CI。**必须带阳性对照**（照 `lane-tool-accuracy.test.mts` 的做法：摘掉「兄弟裁决句」的对照臂）——否则一个恒等于 30/30 的数字和真做对了长得一样 |
| ② DeepSeek 真实跑 | 用户 09-09 拍板便宜档优先 DeepSeek，key 在 `~/.nomi-secrets.env` | 数字写进 PR，不进基线（真实模型有方差）。同一题库跑 internal 与 mcp 两个 profile，**两个数应当相等**——不等就是 profile 漂移 |

**`contestedWith` 这一列是活的验收门**：它非空 = 一个「同效果重复」的实证。
§5 的裁决句改写落地后，对应条目的 `contestedWith` 应当**变空**；
它变空的那天，就是那扇门真的关上了。今天 **17/30** 非空。

**建议的验收阈值**（交给关门方案与用户拍板）：
零额度档 ≥ 28/30（允许两条歧义条目失手），DeepSeek 真实档首轮**只记录基线数字不设门**，
第二轮起按首轮 +10% 或 ≥80% 取高者。

---

## 8. 交给关门方案的输入

给 `docs/plan/2026-09-11-close-agent-doors.md` 与 `scripts/door-map.mjs` 的七条：

1. **门的总数是三扇，不是一扇。** `modelFacingToolRegistry.ts`（36+6）、
   契约上的 `projections.{pi,mcp}.description`（23 个契约）、
   `electron/harness/tools/modelToolSurfaceManifest.ts`（12 个，经 `agentToolCatalog.ts`）。
   后两扇的描述字段没有独立消费者，按 P1 应当同 commit 删掉。
   `door-map.mjs` 如果只扫注册表，会漏掉 §4.2 全部五条矛盾。

2. **生成类节点的门今天是四扇，不是一扇**（D1）：`nomi_canvas_write:create_canvas_nodes`、
   `nomi_storyboard_write:propose_storyboard_plan`、`nomi_generation_plan:create`、
   `materialize_production_storyboard`。合并或裁决都行，但**裁决必须写进描述并且两两一致**，
   否则模型看不见你的裁决。§5.2 给了四条互相点名的文案草稿。

3. **`nomi_generation_plan` 有两份 schema 在跑**：lane 走
   `generationPlanSchemaForHost({preview:false})`（无 `preview` 分支），
   harness 清单走 `generationPlanInputSchema`（**有** `preview` 分支）。
   合门之前先定：`preview` 这个 operation 到底存不存在。

4. **M3 需要真机核实**：描述说 "This host cannot preview or start paid generation"，
   而 09-10 拍板后草稿创建正是产出付费确认卡的动作。
   本审计只标记不下结论——请在真机上确认一次 `create` 之后用户看到什么，再定稿 §5.2 的那一句。

5. **effect 有两套词表**：注册表的 `{mutates, billable, reversal}`（派生自契约）
   与 harness 清单的 `{sideEffect: none|proposal|external, risk: read|project_write|paid_external}`（手写）。
   关门时保留前者（它有装配期不变量与派生点），删后者。

6. **四个契约完全没有模型可见说明书**：`layout.read`、`layout.write`、`skill.read`、`skill.write`。
   另有 **11 个顶层幽灵别名**（含 `read_canvas_state` 与 `nomi_canvas_read` 是同一件事的两个名字）。
   请在 dispatcher 上验一次：一个未发布的别名从模型面打进来会不会被执行。
   本审计只证明「它们可被 `resolveCapabilityAlias` 解析」，**没有证明可达**。

7. **防线位置**：§6.2 列的九条规则里有四条应当落在
   `modelFacingToolRegistry.ts:collectSpecs()` 的装配期 throw（那里已经有两条同形状的不变量），
   而不是新开门岗（R28）。新门岗 `check:tool-face` 只承接棘轮类与语义类五条。
   加任何一条**先验它会红**（R17）。

---

## 附：本审计的可复跑证据

```bash
# 两个 profile 的工具面（本文件全部数字的来源）
pnpm exec tsx docs/audit/2026-09-11-model-tool-face/dump.mts

# 幽灵别名与三扇门的描述对照
pnpm exec tsx docs/audit/2026-09-11-model-tool-face/ghosts.mts
```

生成物：`docs/audit/2026-09-11-model-tool-face/{internal,external}.json`。
题库：`tests/fixtures/tool-selection/2026-09-11-tool-selection-bank.json`。
