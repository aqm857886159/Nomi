# 反例：这些错在真实产品里出现过，也被修过

> 抓取日期 2026-09-11。任务点名的三类反例逐类给证据。

---

## 反例 1 ——「一个效果多个工具」

### 1.1 GitHub MCP：101 个工具 / 64.6k token，被砍到 52 / 30.3k
出处：https://github.com/github/github-mcp-server/discussions/1182 （标题原文 "🚀 Improving GitHub MCP Server Performance and Resource Consumption: Introducing default toolsets"）

理由三条（原文）：
> 1. "Excessive context: 101 tools consuming 64.6k tokens by default"
> 2. "**LLMs struggle to choose the right tool from too many options**"
> 3. "**Defaults matter. Most users never customize their configuration, so they were paying a performance penalty for tools they never used**"

用户侧的怨（出处 https://github.com/github/github-mcp-server/issues/1286 ，标题 "Excessive context usage for tools"）：
> 报告者称"went **from 34k tokens to 80k tokens** just by adding the github mcp to Claude Code"，即便只开了必要 toolset 仍有 "over **66 tools**"，约占 Claude 4.5 上下文的一半；
> "being able to use nearly only half of Claude 4.5's available context for a single MCP tool is just too much for me"，
> "**some consolidation is desperately needed**"。
（本次抓取时该 issue 页面上**没看到**维护者的公开回复，只看到 assignee。别把 #1182 的结论当成对 #1286 的答复。）

修法（出处 https://github.blog/changelog/2025-10-29-github-mcp-server-now-comes-with-server-instructions-better-tools-and-more/ ，原文）：
> "The following pull request review tools have now been consolidated into a single, powerful `pull_request_review_write` tool: `create_and_submit_pull_request_review`, `create_pending_pull_request_review`, `submit_pending_pull_request_review`, `delete_pending_pull_request_review`"
> "The following issue tools have been consolidated into a single, powerful `issue_read` tool: `get_issue`, `get_issue_comments`, `list_labels (with issue_number)`, `list_sub_issues`"
> "the following issue tools are consolidated into a single `issue_write` tool: `create_issue`, `update_issue`"
> "The following sub-issue tools have been consolidated into a single `sub_issue_write` tool: `add_sub_issue`, `remove_sub_issue`, `reprioritize_sub_issue`"
> 效果自述："configurations leaner, AI reasoning clearer, and performance faster."

另：projects toolset 由 6 个细粒度工具压成 3 个（`projects_get` / `projects_list` / `projects_write`）。

**反直觉之处**：修法**不是删功能**，是把同一名词的所有操作压成 `名词_read` / `名词_write` 两个工具 + 一个 `method` 枚举。**工具数降 49%，能力一个没少。**

### 1.2 Notion：1:1 包 API 就是病因
出处 https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look （原文）：
> "**the 1:1 API mapping created suboptimal experiences for AI agents**, like high-context token consumption from working with hierarchical block data in JSON."
> "three years later, we've heard about the challenges of making several API requests to work with block children in a hierarchical JSON format."
> 于是 `create-pages` / `update-page` 是 "new, **ground-up rewrites** of existing Create & Update Page APIs, providing interfaces that make more sense for an AI agent conversation than a traditional, rigid web API."

**Notion 的解法和 GitHub 不同**：不是合并工具数，而是**换内容表示**（Notion-flavored Markdown 取代层级 JSON），理由是 "efficient content density per LLM token, **requiring fewer tool interactions** and less cost"。

### 1.3 Figma：`get_code` → `get_design_context`，并宣布"其余都是它的输入或 fallback"
出处 https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/ （原文）：
> "**get_design_context is the default entry point**: the other tools in this group are either inputs to it, or fallbacks when a selection is too large or you need a specific asset format."

**把"哪个是主入口、其余是什么角色"写进文档，是消除同类工具选择歧义的最低成本做法。**

### 1.4 官方指南对此的明文建议
- Anthropic《Define tools》："Rather than creating a separate tool for every action (`create_pr`, `review_pr`, `merge_pr`), group them into a single tool with an `action` parameter."
- Anthropic《Writing tools for agents》："Instead of implementing a `list_users`, `list_events`, and `create_event` tools, consider implementing a `schedule_event` tool which finds availability and schedules an event."；"**Too many tools or overlapping tools can also distract agents from pursuing efficient strategies.**"
- OpenAI《Function calling》："**Aim for fewer than 20 functions available at the start of a turn**"；"Combine functions that always execute sequentially into single operations"。

---

## 反例 2 ——「描述与运行时矛盾」

### 2.1 Figma：改了名，客户端缓存了旧清单，看起来像"新工具坏了"
出处 https://forum.figma.com/report-a-problem-6/figma-mcp-get-code-worked-good-but-get-design-context-doesn-t-work-at-all-46400

用户报告：`get_code` 时代能正确返回 Compose 代码，换成 `get_design_context` 后**无论要什么框架都只回 HTML/CSS**。原话：
> "We're wondering if there is a bug in `get_design_context`? Can we get the same functionality as the old `get_code`?"

Figma 员工 Junko3 回复：
> "We recently renamed our `get_code` tool to `get_design_context`."
并建议重连 server 刷新工具清单。用户确认重启 Figma + 重连后本地恢复；另发现旧的组件连接会干扰新的框架映射，删掉重发布才好。

**教训**：工具**改名是破坏性变更**。客户端会缓存 `tools/list`，旧描述配新运行时 = 用户眼里的"功能倒退"。这条直接命中 Nomi 的 P1「加新必删旧」——删旧必须同时让**已连接的宿主**看见新清单（MCP 里就是 `notifications/tools/list_changed`）。

### 2.2 MCP annotation 是"提示"不是"契约"，客户端可以不理
规范原文（`ToolAnnotations` 的 JSDoc）：
> "NOTE: **all properties in ToolAnnotations are hints. They are not guaranteed to provide a faithful description of tool behavior** (including descriptive properties like `title`). Clients should never make tool use decisions based on ToolAnnotations received from untrusted servers."
> 规范正文："For trust & safety and security, clients **MUST** consider tool annotations to be untrusted unless they come from trusted servers."

现实中的两头落空（**二手来源，标注清楚**）：
- 有报告称 ChatGPT 的 MCP connector 会忽略 `readOnlyHint: true` 仍然弹确认（OpenAI Developer Community 帖 https://community.openai.com/t/mcp-annotations-being-ignored/1369672 ；本次未逐字核对帖内原文，**只作为"存在争议"的线索**）。
- 另一侧：恶意/马虎的 server 可以把破坏性工具标成 `readOnlyHint: true`，规范不拦。

**对 Nomi 的含义**：Nomi 既是 MCP **宿主**又是 MCP **server**。作为宿主，不能拿外部 server 的 annotation 当审批依据；作为 server，annotation 要填**但不能当唯一防线**——真闸必须在自己这边（对照 R28「防线建在最早能拦住的那层」）。

### 2.3 GitHub MCP 自己也只填了一半
`pkg/github/issues.go` 里所有 `mcp.ToolAnnotations` **只出现 `Title` 和 `ReadOnlyHint`**，`DestructiveHint` / `IdempotentHint` / `OpenWorldHint` 一次都没写。而 schema 的默认是 `destructiveHint=true`——**等于所有写工具默认被当成破坏性**，这是 fail-closed 的，但也意味着 annotation 在实践中没被当成细粒度表达工具用。

---

## 反例 3 ——「描述写内部术语」

### 3.1 官方明文反对
- Anthropic《Writing tools for agents》："They should prioritize contextual relevance over flexibility, and **eschew low-level technical identifiers**."；"**merely resolving arbitrary alphanumeric UUIDs to more semantically meaningful and interpretable language significantly improves Claude's precision in retrieval tasks by reducing hallucinations**."；举例：用 `name` 和 `file_type` 而不是 `uuid` 和 `mime_type`。
- Anthropic《Define tools》："Return semantic, stable identifiers (for example, slugs or UUIDs) rather than opaque internal references."
- Anthropic《Writing tools for agents》参数命名："instead of a parameter named `user`, try a parameter named `user_id`."
- OpenAI《Function calling》："Apply the 'intern test'—ensure humans could use the function with only provided documentation."

### 3.2 真实产品里的内部词残留
- **Blender MCP**：`poll_rodin_job_status` 的描述原文 "For MAIN_SITE mode uses subscription_key; for FAL_AI mode uses request_id."；`import_generated_asset` 的 "Only give one of {task_uuid, request_id} based on mode."。`MAIN_SITE` / `FAL_AI` / `subscription_key` / `task_uuid` **全是内部实现词**，模型必须先理解 Hyper3D 的两种部署模式才会用。这是"按供应商切工具"的连带代价。
- **Codex**：`exec_command` 的 `environment_id` 描述是 "Environment id from `<environment_context>`. Omit to use the primary environment." —— 内部词，但**明确写了去哪儿找它**，这是内部词的正确用法（不可避免时，指路）。
- **反面标杆**：Linear 的 `list_issues` 描述 "For my issues, use \"me\" as the assignee." —— 用**用户会说的话**（"我的 issue"）教模型怎么填**产品的字段**。

### 3.3 名字层面的内部 vs 用户词汇对照
| 用户词汇 | 内部词 | 出处 |
|---|---|---|
| `get_design_context` | ~~get_node_tree~~ | Figma |
| `issue_read` / `save_issue` | ~~graphql_query_issue~~ | GitHub / Linear |
| `notion-fetch` | ~~get_block_children~~ | Notion（博客明说是为了绕开 block JSON） |
| `browser_snapshot` | ~~get_accessibility_tree~~ | Playwright |
| ✗ `poll_rodin_job_status` | | Blender（供应商内部词漏到工具名） |
