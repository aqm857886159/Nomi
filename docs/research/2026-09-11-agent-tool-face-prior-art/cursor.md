# Cursor

> 抓取日期 2026-09-11。
> **出处等级**：非官方。泄露件 https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools 的 `Cursor Prompts/Agent Tools v1.0.json`（13 个 function schema）。**引用时必须说明是泄露件。**

## 13 个工具（描述原文，节选到关键段）

**`codebase_search`**
> "Find snippets of code from the codebase most relevant to the search query.
> This is a semantic search tool, so the query should ask for something semantically matching what is needed.
> If it makes sense to only search in particular directories, please specify them in the target_directories field.
> **Unless there is a clear reason to use your own search query, please just reuse the user's exact query with their wording.**
> Their exact wording/phrasing can often be helpful for the semantic search query. Keeping the same exact question format can also be helpful."

**`read_file`**
> "Read the contents of a file. the output of this tool call will be the 1-indexed file contents from start_line_one_indexed to end_line_one_indexed_inclusive, together with a summary of the lines outside start_line_one_indexed and end_line_one_indexed_inclusive.
> Note that this call can view at most 250 lines at a time and 200 lines minimum.
> When using this tool to gather information, it's your responsibility to ensure you have the COMPLETE context. Specifically, each time you call this command you should:
> 1) Assess if the contents you viewed are sufficient to proceed with your task.
> 2) Take note of where there are lines not shown.
> 3) If the file contents you have viewed are insufficient, and you suspect they may be in lines not shown, proactively call the tool again to view those lines.
> 4) When in doubt, call this tool again to gather more information. Remember that partial file views may…"

**`run_terminal_cmd`**（★ 审批语义写进描述）
> "**PROPOSE** a command to run on behalf of the user.
> If you have this tool, note that you DO have the ability to run commands directly on the USER's system.
> **Note that the user will have to approve the command before it is executed.**
> The user may reject it if it is not to their liking, or may modify the command before approving it. If they do change it, take those changes into account.
> **The actual command will NOT execute until the user approves it. The user may not approve it immediately. Do NOT assume the command has started running.
> If the step is WAITING for user approval, it has NOT started running.**"

**`list_dir`**
> "List the contents of a directory. The quick tool to use for discovery, before using more targeted tools like semantic search or file reading. Useful to try to understand the file structure before diving deeper into specific files. Can be used to explore the codebase."

**`grep_search`**（★ 描述里带示例表格）
> "### Instructions:
> This is best for finding exact text matches or regex patterns.
> This is preferred over semantic search when we know the exact symbol/function name/etc. to search in some set of directories/file types.
> Use this tool to run fast, exact regex searches over text files using the `ripgrep` engine.
> To avoid overwhelming output, the results are capped at 50 matches.
> Use the include or exclude patterns to filter the search scope by file type or specific paths.
> - Always escape special regex characters: ( ) [ ] { } + * ? ^ $ | . \
> - Use `\` to escape any of these characters when they appear in your search string.
> - Do NOT perform fuzzy or semantic matches.
> - Return only a valid regex pattern string.
> ### Examples:
> | Literal | Regex Pattern |
> |---|---|
> | function( | function\( |
> | value[in… |"

**`edit_file`**（★ 描述里声明"下游是谁"）
> "Use this tool to propose an edit to an existing file or create a new file.
> **This will be read by a less intelligent model, which will quickly apply the edit.** You should make it clear what the edit is, while also minimizing the unchanged code you write.
> When writing the edit, you should specify each edit in sequence, with the special comment `// ... existing code ...` to represent unchanged code in between edited lines. …"

**`search_replace`**
> "Use this tool to propose a search and replace operation on an existing file.
> The tool will replace ONE occurrence of old_string with new_string in the specified file.
> CRITICAL REQUIREMENTS FOR USING THIS TOOL:
> 1. UNIQUENESS: … Include AT LEAST 3-5 lines of context BEFORE the change point / AT LEAST 3-5 lines of context AFTER …
> 2. SINGLE INSTANCE: This tool can only change ONE instance at a time. …
> 3. VERIFICATION: Before using this tool: If multiple instances exist, gather enough context…"

**`file_search`**
> "Fast file search based on fuzzy matching against file path. Use if you know part of the file path but don't know where it's located exactly. Response will be capped to 10 results. Make your query more specific if need to filter results further."

**`delete_file`**（★ 唯一的破坏性工具，靠"失败也安全"写法降风险）
> "Deletes a file at the specified path. The operation will fail gracefully if:
>     - The file doesn't exist
>     - The operation is rejected for security reasons
>     - The file cannot be deleted"

**`reapply`**（★ 一个专门修"上一个工具没干对"的工具）
> "Calls a smarter model to apply the last edit to the specified file.
> Use this tool immediately after the result of an edit_file tool call ONLY IF the diff is not what you expected, indicating the model applying the changes was not smart enough to follow your instructions."

**`web_search`**
> "Search the web for real-time information about any topic. Use this tool when you need up-to-date information that might not be available in your training data, or when you need to verify current facts. The search results will include relevant snippets and URLs from web pages. This is particularly useful for questions about current events, technology updates, or any topic that requires recent information."

**`create_diagram`**（★ 领域产物工具，返回值就是校验反馈）
> "Creates a Mermaid diagram that will be rendered in the chat UI. Provide the raw Mermaid DSL string via `content`.
> Use <br/> for line breaks, always wrap diagram texts/tags in double quotes, **do not use custom colors, do not use :::, and do not use beta features**.
> **The diagram will be pre-rendered to validate syntax - if there are any Mermaid syntax errors, they will be returned in the response so you can fix them.**"

**`edit_notebook`**
> "Use this tool to edit a jupyter notebook cell. **Use ONLY this tool to edit notebooks.** … - It's critical that you set the 'is_new_cell' flag correctly! - This tool does NOT support cell deletion, but you can delete the content of a cell by passing an empty string as the 'new_string'. …"

## 维度归纳
- **工具数**：13（这批里最少的之一）。
- **动词粒度**：一个工具 = 一种"找/改/跑"的方式。同一效果（改文件）故意留了三个工具（`edit_file` 模糊改、`search_replace` 精确改、`edit_notebook` 专用），**用描述里的选择判据而不是合并来消歧**。
- **命名风格**：`动词_名词`（`read_file`、`delete_file`）和 `名词_动词`（`codebase_search`、`file_search`、`grep_search`、`web_search`）混用——**"搜"这一族统一放后缀**，让四个搜索工具在列表里排在一起。
- **读写分离**：无标注。
- **破坏性标注**：`run_terminal_cmd` 用"PROPOSE"这个词 + 三段"没批准就没跑"的强调；`delete_file` 用"fail gracefully"。
- **返回值是否指路**：`create_diagram` 把语法校验错误回灌给模型；`read_file` 的返回里带"窗口外还有多少行"的摘要，直接引导下一次调用。
- **最可迁移的一条**：`create_diagram` 的形状 = **Nomi 的"生成一个节点产物"应有的形状**——模型给声明式内容 → 宿主渲染 → 渲染失败把错误当工具返回值还给模型 → 模型自己修。
