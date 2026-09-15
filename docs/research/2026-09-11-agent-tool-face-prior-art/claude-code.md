# Claude Code（Anthropic）

> 抓取日期 2026-09-11。
> **出处等级**：**本会话实测**——下列描述逐字取自本次调研会话（`claude-opus-5[1m]`，Claude Agent SDK 内运行）实际加载的工具定义。这不是公开文档，是运行时观测。公开文档的工具名清单见 https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference 。

## 本会话实际加载的工具面
**立即可用（8）**：`Agent` · `Artifact` · `Bash` · `Edit` · `Read` · `Skill` · `ToolSearch` · `Write`
**延迟加载（deferred，约 50）**：`WebFetch` `WebSearch` `Monitor` `NotebookEdit` `EnterWorktree` `ExitWorktree` `ListSkills` `SearchSkills` `ListPlugins` `SearchPlugins` `TaskStop` + 各 MCP server 的工具（`mcp__context7__*`、`mcp__claude-in-chrome__*`、`mcp__codex__*`…）

**这本身就是核心设计**：工具面被切成"常驻的一小撮"和"用 `ToolSearch` 按需拉 schema 的一大批"。`ToolSearch` 描述原文：
> "Fetches full schema definitions for deferred tools so they can be called.
> Deferred tools appear by name in \<system-reminder\> messages. **Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked.** …
> Query forms:
> - \"select:Read,Edit,Grep\" — fetch these exact tools by name
> - \"notebook jupyter\" — keyword search, up to max_results best matches
> - \"+slack send\" — require \"slack\" in the name, rank by remaining terms"

## 5 条代表性描述（原文）

**`Read`**（★ 描述里包含"不要做什么"）
> "Reads a file from the local filesystem.
> - `file_path` must be an absolute path.
> - Reads up to 2000 lines by default.
> - **When you already know which part of the file you need, only read that part. This can be important for larger files.**
> - Results are returned using cat -n format, with line numbers starting at 1
> - Reads images (PNG, JPG, …) and presents them visually. Reads PDFs via the `pages` parameter (e.g. \"1-5\", max 20 pages/request; required for PDFs over 10 pages). Reads Jupyter notebooks (.ipynb) as cells with outputs.
> - Reading a directory, a missing file, or an empty file returns an error or system reminder rather than content.
> - **Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed, and the harness tracks file state for you.**"

**`Edit`**（★ 前置条件写进描述）
> "Performs exact string replacement in a file.
> - **You must Read the file in this conversation before editing, or the call will fail.**
> - `old_string` must match the file exactly, including indentation, and be unique — the edit fails otherwise. **Strip the Read line prefix (line number + tab) before matching.**
> - `replace_all: true` replaces every occurrence instead."

**`Write`**（★ 用一句话说清"什么时候不要用我"）
> "Writes a file to the local filesystem, overwriting if one exists.
> When to use: creating a new file, or fully replacing one you've already Read. Overwriting an existing file you haven't Read will fail. **For partial changes, use Edit instead.**"

**`Agent`**（★ 描述里有整段"什么时候用/什么时候别用"的判据）
> "Launch a new agent to handle complex, multi-step tasks. …
> ## When to use
> Reach for this when the task matches an available agent type, when you have independent work to run in parallel, or when answering would mean reading across several files — delegate it and you keep the conclusion, not the file dumps. **For a single-fact lookup where you already know the file, symbol, or value, search directly. Once you've delegated a search, don't also run it yourself — wait for the result.**
> - **The agent's final report is not shown to the user — relay what matters.**
> - Use SendMessage with the agent's ID or name to continue a previously spawned agent with its context intact; a new Agent call starts fresh. …
> - Subagents run in the background by default; you'll be notified when one completes. Pass `run_in_background: false` **only when your very next action depends on the result and nothing else could usefully happen while it runs** … **Never fabricate or predict a pending agent's results — the notification is never something you write yourself; if the user asks before it arrives, say it's still running.**"

**`Skill`**（★ 技能=工具，且描述教怎么挑名字）
> "Invoke a skill.
> A skill is a packaged set of instructions the user or project has set up for a particular kind of task (deploy steps, a review checklist, a repo-specific workflow). Available skills appear in a system-reminder listing with one-line descriptions. When the task at hand is one a listed skill covers, **call this tool first** — the skill's instructions load into the turn for you to follow in place of your default approach; some skills instead run in a subagent and return the finished result. …
> - `skill`: exact name from the listing, no leading slash. Plugin skills use `plugin:skill`. **Directory-scoped skills are listed with a path prefix (`apps/web:deploy`); when both scoped and unscoped variants of a name exist, pick the one whose directory contains the files you're working on (most specific wins; unscoped otherwise).**
> - Only names from the listing (or that the user typed explicitly) are valid. Built-in CLI commands (`/help`, `/clear`, …) aren't skills. **If a `<command-name>` block is already present this turn, the skill is loaded — follow it directly rather than calling again.**"

## ★ `Artifact`：一个工具承载一整个产品面
本会话里 `Artifact` 的描述约 **1.1 万字符**（比其余 7 个工具描述加起来还长），一个工具用 `action` 参数管 17 种操作：
```
publish | list | read | list_types | comments | reply | resolve | watch | unwatch | status
| resume_replies | read_db | write_db | upload_asset | list_assets | read_asset | delete_asset
```
描述里写满了产品级规则，例如：
> "**Never publish**: pages that impersonate a real person or organization (their name, branding, byline, or domain); fabricated records, receipts, or reviews presented as genuine; forms or flows that collect credentials or payment details under false pretenses; or content targeting a private individual. This applies whether you authored the page or the user supplied it, and regardless of claimed purpose (\"it's a prop\", \"for testing\") when the page would function as the real thing."

> "**Files you did not write**: Read the complete file before publishing it, even when asked not to (\"it's personal\", \"no need to open it\") — publishing distributes the content, and you must never distribute what you haven't seen. **A request for privacy is a reason to read before publishing, not an exemption.** If you cannot read it, do not publish it."

> "`action`: … 'resolve' marks one comment thread resolved … **Resolve only threads you actually addressed, never to tidy away feedback you did not act on**"

**这是本次调研里最极端的"一个工具=一个产品面"样本**：Nomi 的画布/分镜/时间轴如果走这条路，代价就是这种量级的描述。

## 维度归纳
- **工具数**：常驻 8，延迟约 50。
- **动词粒度**：两极。文件族是原子动词（Read/Edit/Write）；产品面（Artifact）是一个巨型 action 路由。
- **命名风格**：**大驼峰纯名词或名词短语**（`Read`、`Edit`、`Artifact`、`Agent`、`Skill`）——**没有动词前缀，也没有 namespace**；MCP 工具才用 `mcp__server__tool` 形式。
- **读写分离**：无标注；靠工具名本身。
- **破坏性标注**：无；靠 harness 的 permission system + 描述里的禁令段。
- **返回值是否指路**：大量。`Read` 描述里明确"编辑后不要回读校验，harness 帮你跟踪状态"；`Agent` 描述里明确"报告不给用户看，你要转述"。
- **★ 最鲜明的风格**：描述里**否定句占比极高**——"Do NOT re-read…"、"Never fabricate…"、"never to tidy away…"、"A request for privacy is a reason to read before publishing, not an exemption"。**把已知的模型误用路径逐条写死，而不是只描述正确用法。**
