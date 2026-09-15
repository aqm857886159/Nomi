# 设计指南类（硬性建议逐条抄）

> 抓取日期 2026-09-11。

---

## A. Anthropic —《Define tools》
https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools

工具定义字段：`name`（"Must match the regex `^[a-zA-Z0-9_-]{1,128}$`"）、`description`（"A detailed plaintext description of what the tool does, when it should be used, and how it behaves."）、`input_schema`、`input_examples`。

### "Best practices for tool definitions"（全文照抄）
> * **Provide extremely detailed descriptions.** This is by far the most important factor in tool performance. Your descriptions should explain every detail about the tool, including:
>   * What the tool does
>   * When it should be used (and when it shouldn't)
>   * What each parameter means and how it affects the tool's behavior
>   * Any important caveats or limitations, such as what information the tool does not return if the tool name is unclear. The more context you can give Claude about your tools, the better it will be at deciding when and how to use them. **Aim for at least 3–4 sentences for each tool description, more if the tool is complex.**
>
> * **Prioritize descriptions, but consider using `input_examples` for complex tools.** Clear descriptions are most important, but for tools with complex inputs, nested objects, or format-sensitive parameters, you can use the `input_examples` field to provide schema-validated examples.
>
> * **Consolidate related operations into fewer tools.** Rather than creating a separate tool for every action (`create_pr`, `review_pr`, `merge_pr`), group them into a single tool with an `action` parameter. **Fewer, more capable tools reduce selection ambiguity and make your tool surface easier for Claude to navigate.**
>
> * **Use meaningful namespacing in tool names.** When your tools span multiple services or resources, prefix names with the service (for example, `github_list_prs`, `slack_send_message`). This makes tool selection unambiguous as your library grows, and is especially important when using tool search.
>
> * **Design tool responses to return only high-signal information.** Return semantic, stable identifiers (for example, slugs or UUIDs) rather than opaque internal references, and include only the fields Claude needs to reason about its next step. **Bloated responses waste context and make it harder for Claude to extract what matters.**

### 好 / 坏描述对照（原文）
好：
> "Retrieves the current stock price for a given ticker symbol. The ticker symbol must be a valid symbol for a publicly traded company on a major US stock exchange like NYSE or NASDAQ. The tool will return the latest trade price in USD. It should be used when the user asks about the current or most recent price of a specific stock. **It will not provide any other information about the stock or company.**"

坏：
> "Gets the stock price for a ticker."

文档点评：
> "The good description clearly explains what the tool does, when to use it, what data it returns, and what the `ticker` parameter means. The poor description is too brief and leaves Claude with many open questions."

### `input_examples` 的代价（原文）
> "**Token cost** - Examples add to prompt tokens: ~20–50 tokens for simple examples, ~100–200 tokens for complex nested objects"

### 其它可用机制
`tool_choice`：`auto` / `any` / `tool` / `none`。
> "when you have `tool_choice` as `any` or `tool`, the API prefills the assistant message to force a tool to be used. This means that the models will not emit a natural language response or explanation before `tool_use` content blocks, even if explicitly asked to do so."

---

## B. Anthropic —《Writing tools for agents》
https://www.anthropic.com/engineering/writing-tools-for-agents

### 做评测（原文）
> "It can be difficult to anticipate which tools agents will find ergonomic and which tools they won't without getting hands-on yourself."
> "Prompts should be inspired by real-world uses and be based on realistic data sources and services."
> "**We recommend you avoid overly simplistic or superficial 'sandbox' environments that don't stress-test your tools with sufficient complexity.**"
> "**Strong evaluation tasks might require multiple tool calls—potentially dozens.**"
> "Use simple agentic loops (`while`-loops wrapping alternating LLM API and tool calls): one loop for each evaluation task."
> "In your evaluation agents' system prompts, we recommend instructing agents to output not just structured response blocks (for verification), but also **reasoning and feedback blocks**."
> "You can even let agents analyze your results and improve your tools for you. Simply concatenate the transcripts from your evaluation agents and paste them into Claude Code."

### 选工具（原文）
> "**More tools don't always lead to better outcomes.**"
> "A common error we've observed is tools that merely wrap existing software functionality or API endpoints—whether or not the tools are appropriate for agents."
> "We recommend building **a few thoughtful tools targeting specific high-impact workflows**, which match your evaluation tasks and scaling up from there."
> "Tools can consolidate functionality, handling potentially multiple discrete operations (or API calls) under the hood."
> 举例："Instead of implementing a `list_users`, `list_events`, and `create_event` tools, consider implementing a `schedule_event` tool which finds availability and schedules an event."
> "Make sure each tool you build has a **clear, distinct purpose**."
> "**Too many tools or overlapping tools can also distract agents from pursuing efficient strategies.**"

### Namespacing（原文）
> "Namespacing (grouping related tools under common prefixes) can help delineate boundaries between lots of tools."
> "For example, namespacing tools by service (e.g., `asana_search`, `jira_search`) and by resource (e.g., `asana_projects_search`, `asana_users_search`), can help agents select the right tools at the right time."
> "**We have found selecting between prefix- and suffix-based namespacing to have non-trivial effects on our tool-use evaluations.**"

### 返回什么（原文）
> "Tool implementations should take care to **return only high signal information** back to agents."
> "They should prioritize contextual relevance over flexibility, and **eschew low-level technical identifiers**."
> "Agents also tend to grapple with natural language names, terms, or identifiers significantly more successfully than they do with cryptic identifiers."
> "**We've found that merely resolving arbitrary alphanumeric UUIDs to more semantically meaningful and interpretable language significantly improves Claude's precision in retrieval tasks by reducing hallucinations.**"
> "You can enable both by exposing a simple `response_format` enum parameter in your tool, allowing your agent to control whether tools return `\"concise\"` or `\"detailed\"` responses."
> 数字：Slack 线程响应 detailed 格式 **206 tokens** vs concise **72 tokens**（约 1/3）。

### token 预算（原文）
> "We suggest implementing some combination of **pagination, range selection, filtering, and/or truncation** with sensible default parameter values."
> "**For Claude Code, we restrict tool responses to 25,000 tokens by default.**"
> "If you choose to truncate responses, be sure to steer agents with helpful instructions."
> "Tool truncation and error responses can steer agents towards more token-efficient tool-use behaviors (using filters or pagination) or give examples of correctly formatted tool inputs."

### 写描述（原文）
> "We now come to one of the most effective methods for improving tools: prompt-engineering your tool descriptions and specs."
> "**When writing tool descriptions and specs, think of how you would describe your tool to a new hire on your team.**"
> "Avoid ambiguity by clearly describing (and enforcing with strict data models) expected inputs and outputs."
> "**In particular, input parameters should be unambiguously named: instead of a parameter named `user`, try a parameter named `user_id`.**"
> "Even small refinements to tool descriptions can yield dramatic improvements."
> 数字：Claude Sonnet 3.5 在 SWE-bench Verified 上拿到 SOTA，是在 "we made precise refinements to tool descriptions, dramatically reducing error rates and improving task completion" 之后。

---

## C. Anthropic —《Building effective agents》Appendix 2: Prompt engineering your tools
https://www.anthropic.com/engineering/building-effective-agents

工具规格 "deserve just as much prompt engineering attention as your overall prompts"。

决定工具格式的三条（原文）：
> 1. "Give the model enough tokens to 'think' before it writes itself into a corner."
> 2. "Keep the format close to what the model has seen naturally occurring in text on the internet."
> 3. "Make sure there's no formatting 'overhead' such as having to keep an accurate count of thousands of lines of code, or string-escaping any code it writes."

ACI（agent-computer interface）四条（原文）：
> - "**Put yourself in the model's shoes.** Is it obvious how to use this tool, based on the description and parameters, or would you need to think carefully about it?"
> - "How can you change parameter names or descriptions to make things more obvious? **Think of this as writing a great docstring for a junior developer on your team.**"
> - "**Test how the model uses your tools:** Run many example inputs in our workbench to see what mistakes the model makes, and iterate."
> - "**[Poka-yoke] your tools. Change the arguments so that it is harder to make mistakes.**"

真实案例（原文）：
> 做 SWE-bench agent 时 "we actually spent more time optimizing our tools than the overall prompt"；模型在 `cd` 之后用相对路径老出错，于是把工具改成 "always require absolute filepaths—and we found that the model used this method flawlessly"。

---

## D. OpenAI —《Function calling》Best practices
https://developers.openai.com/api/docs/guides/function-calling

> **1. Write clear and detailed function names, parameter descriptions, and instructions.**
> - "Explicitly describe the purpose of the function and each parameter (and its format), and what the output represents."
> - "**Use the system prompt to describe when (and when not) to use each function.**"
> - Include examples and edge cases to address recurring failures.
> - For deferred tools, provide detailed guidance in function descriptions while keeping namespace descriptions concise.
>
> **2. Apply software engineering best practices.**
> - "Make the functions predictable and intuitive"（principle of least surprise）
> - "Leverage enums and structured objects to prevent invalid states"
> - "**Apply the 'intern test'**—ensure humans could use the function with only provided documentation"
>
> **3. Offload burden from the model using code.**
> - "Don't require models to fill arguments you already possess"
> - "**Combine functions that always execute sequentially into single operations**"
>
> **4. Keep initial function availability small.**
> - "**Aim for fewer than 20 functions available at the start of a turn**" as a soft guideline
> - "Use tool search to defer large or rarely-used functions"
>
> **5. Leverage OpenAI resources.** — Playground 里迭代 schema；函数生态很大时考虑微调。

枚举反例（原文）：避免 `toggle_light(on: bool, off: bool)` 这类"允许自相矛盾调用"的设计。

strict 模式要求：`additionalProperties: false`；所有字段 `required`；可选字段写成 `type: ["string","null"]`。

返回值：字符串，格式自选（JSON / 错误码 / 纯文本）；图片/文件用 image/file object 数组返回。

---

## E. MCP 规范 — Tools 一章 + Tool annotations

### 规范正文（2026-07-28 与 2025-06-18 版一致的硬性条款）
https://modelcontextprotocol.io/specification/2025-06-18/server/tools 、 https://modelcontextprotocol.io/docs/concepts/tools

> "Tools in MCP are designed to be **model-controlled** …"
> "For trust & safety and security, there **SHOULD** always be a human in the loop with the ability to deny tool invocations. Applications **SHOULD**:
> * Provide UI that makes clear which tools are being exposed to the AI model
> * Insert clear visual indicators when tools are invoked
> * Present confirmation prompts to the user for operations, to ensure a human is in the loop"

工具名（2026-07-28 新增的 SHOULD 段）：
> "Tool names **SHOULD** be between 1 and 128 characters … **SHOULD** be considered case-sensitive … The following **SHOULD** be the only allowed characters: uppercase and lowercase ASCII letters (A-Z, a-z), digits (0-9), underscore (_), hyphen (-), and dot (.) … **SHOULD NOT** contain spaces, commas, or other special characters … **SHOULD** be unique within a server."
> 命名冲突："Clients or proxies that aggregate tools from multiple servers **MAY** encounter naming collisions (for example, two servers each exposing a `search` tool) and **SHOULD** implement a disambiguation strategy such as prefixing tool names with a server identifier."

有状态工具（2026-07-28 新增的**非规范性设计指南**，对 Nomi 的"生成任务"很直接）：
> "MCP has no protocol-level session … Servers that need to maintain state across calls — a shopping cart, an open browser context, a database transaction — should do so by **returning an explicit handle from a creation tool and accepting that handle as an argument on subsequent calls**."
> 设计 handle 要考虑：
> * "**Authorization.** … a handle is a name, not a capability. The server should validate the caller's authorization against the handle on every call."
> * "**Opacity.** Handles that encode internal structure invite parsing or guessing; opaque identifiers do not."
> * "**Lifetime.** … the server's retention policy should be stated in the creation tool's description (e.g., \"baskets expire after 24 hours of inactivity\") **so the model can see it when deciding to create state**."
> * "**Expiry errors.** A call against an expired or unknown handle should return a tool execution error that says so, so the model can recover by creating a new one."

错误分两类（原文）：
> 1. "**Protocol Errors** indicate issues with the request structure itself that models are less likely to be able to fix"（unknown tool / malformed / server error，走 JSON-RPC error）
> 2. "**Tool Execution Errors** contain actionable feedback that language models can use to self-correct and retry with adjusted parameters"（API 失败 / 输入校验 / 业务逻辑，走 `isError: true`）
> 示例文案原文："Invalid departure date: must be in the future. Current date is 08/08/2025."
> "Clients **SHOULD** provide tool execution errors to language models to enable self-correction."

### Tool annotations（schema 原文，`schema/2025-06-18/schema.ts`）
https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-06-18/schema.ts
```ts
/**
 * Additional properties describing a Tool to clients.
 *
 * NOTE: all properties in ToolAnnotations are **hints**.
 * They are not guaranteed to provide a faithful description of
 * tool behavior (including descriptive properties like `title`).
 *
 * Clients should never make tool use decisions based on ToolAnnotations
 * received from untrusted servers.
 */
export interface ToolAnnotations {
  /** A human-readable title for the tool. */
  title?: string;

  /** If true, the tool does not modify its environment.
   *  Default: false */
  readOnlyHint?: boolean;

  /** If true, the tool may perform destructive updates to its environment.
   *  If false, the tool performs only additive updates.
   *  (This property is meaningful only when `readOnlyHint == false`)
   *  Default: true */
  destructiveHint?: boolean;

  /** If true, calling the tool repeatedly with the same arguments
   *  will have no additional effect on the its environment.
   *  (This property is meaningful only when `readOnlyHint == false`)
   *  Default: false */
  idempotentHint?: boolean;

  /** If true, this tool may interact with an "open world" of external
   *  entities. If false, the tool's domain of interaction is closed.
   *  For example, the world of a web search tool is open, whereas that
   *  of a memory tool is not.
   *  Default: true */
  openWorldHint?: boolean;
}
```
**默认值的方向很重要**：`readOnlyHint=false`、`destructiveHint=true`、`openWorldHint=true` —— **不声明 = 按最危险处理**（fail-closed）。
