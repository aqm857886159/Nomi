# Cline

> 抓取日期 2026-09-11。**一手出处（开源源码，非泄露）**：
> https://github.com/cline/cline/blob/main/sdk/packages/core/src/extensions/tools/definitions.ts

## 9 个默认工具（description 原文，拼接后）

**`read_files`**
> "Read the content of text or image files at the provided absolute paths, or return only an inclusive one-based line range when start_line/end_line are provided on the same file entry as its path. **When you already know multiple files you need, read them together in one call, and call this tool in the same response as other independent tool calls.** Each read returns at most {MAX_READ_LINES} lines / ~{N}k characters; longer files report their total line count, page through them with start_line/end_line on that file's entry. Binary files that are not image and large files are not supported. Returns file contents or error messages for each path."

**`search_codebase`**
> "Perform regex pattern searches across the codebase. **Supports multiple parallel searches. When several search patterns could be useful and do not depend on each other, run them together in one call, and call this tool in the same response as other independent tool calls.** Use for finding code patterns, function definitions, class names, imports, etc. Output beyond ~{N}k characters per query is middle-truncated; **narrow patterns beat broad ones**."

**`run_commands`** — 描述由 `buildRunCommandsDescription(shell, isWindows)` **在运行时按真实 shell 生成**（不是常量）。

**`fetch_web_content`**
> "Fetch content from URLs and analyze them using the provided prompts. Use for retrieving documentation, API references, or any web content. Each request includes a URL and a prompt describing what information to extract. **Fetch independent URLs together in one call**, and call this tool in the same response as other independent tool calls."

**`apply_patch`** — 描述是常量 `APPLY_PATCH_TOOL_DESC`。

**`editor`**
> "An editor for controlled filesystem edits on the text file at the provided path. Provide `insert_line` to insert `new_text` at a specific line number. Otherwise, the tool replaces `old_text` with `new_text`, or creates the file with `new_text` if file does not exist. **Use this tool for making small, precise edits to existing files or creating new files over shell commands.** If several edits to different files or non-overlapping regions are already known, emit multiple editor tool calls in the same response instead of serializing them across turns."

**`skills`**（★ 技能=工具，且描述是**动态拼出来的**）
> "Execute a skill within the main conversation. When users ask you to perform tasks, check if any available skills match. When users reference a slash command, invoke it with this tool. Input: `skill` (required) and optional `args`. Example: `skill: \"pdf\"`, `skill: \"commit\", args: \"-m \\\"Fix bug\\\"\"`, `skill: \"review-pr\", args: \"123\"`, `skill: \"ms-office-suite:pdf\"`. **When a skill matches the user's request, invoking this tool is a blocking requirement before any other response. Never mention a skill without invoking this tool.**"
>
> 源码把 `description` 定义成 getter：`return \`${baseDescription} Available skills: ${skills.join(", ")}.\`` —— **可用技能清单实时拼进描述里**，技能增删不改工具数。

**`ask_question`**
> "Ask user a question for clarifying or gathering information needed to complete the task. For example, ask the user clarifying questions about a key implementation decision. **You should only ask one question. Provide an array of 2-5 options for the user to choose from.** Never include an option to toggle to Act mode."

**`submit_and_exit`**（★ "任务结束"是一个工具，且带 lifecycle 标记）
> "Submit the final answer and exit the conversation. For example, submit a summary of the investigation and confirm the issue is resolved. You should only submit once all necessary steps are completed. **Make sure to verify your output matches the expected format, data types, and file locations specified.** Provide a summary of the investigation and confirm the issue is resolved."
>
> 源码：`lifecycle: { completesRun: true }`

## 工具定义里的非描述字段（source of truth）
每个工具在 `createTool()` 里带这些运行时属性，**它们不进模型上下文，但决定宿主怎么对待这次调用**：
```
timeoutMs     retryable     maxRetries     lifecycle.completesRun
```
对照表（源码原文）：
| 工具 | retryable | maxRetries | 备注 |
|---|---|---|---|
| `read_files` | true | 1 | `timeoutMs: timeoutMs * 2 // Account for multiple files` |
| `search_codebase` | true | 1 | |
| `fetch_web_content` | true | 2 | |
| `run_commands` | **false** | 0 | |
| `apply_patch` | **false** | 0 | |
| `editor` | **false** | 0 | 注释原文："Editing operations are stateful and should not auto-retry" |
| `skills` | false | 0 | |
| `ask_question` | false | 0 | |
| `submit_and_exit` | false | 0 | `completesRun: true` |

**"能不能自动重试"= 幂等性的工程化表达，而且是在工具定义里声明的，不在 annotation 里。**

## 维度归纳
- **工具数**：9。**全套调研里最少。**
- **动词粒度**：一个工具管一整族。`editor` 一个工具管 insert / replace / create 三件事，判据写在描述里（"Provide `insert_line` to … Otherwise, the tool replaces … or creates the file if …"）。
- **命名风格**：`动词_名词`复数（`read_files`）/ `名词_动词`（`search_codebase`）/ 纯名词（`editor`、`skills`）。
- **读写分离**：无标注，但用 `retryable` 区分了"重跑安全"与否。
- **破坏性标注**：`retryable:false + maxRetries:0` 是事实上的 destructive 标记。
- **返回值是否指路**：`read_files` 描述里写死"超长文件会报总行数，用 start_line/end_line 翻页"——**截断策略和恢复办法一起写进描述**（正是 Anthropic「Writing tools for agents」建议的做法）。
- **★ 三条反复出现的句式**："call this tool in the same response as other independent tool calls" 在 4 个工具描述里**逐字重复**——**把"并行调用"当成一条跨工具的行为规范，写进每一个能并行的工具**。
