# Notion MCP Server（官方 hosted）

> 抓取日期 2026-09-11。一手出处：
> - https://developers.notion.com/guides/mcp/mcp-supported-tools （工具清单正本）
> - https://www.notion.com/blog/notions-hosted-mcp-server-an-inside-look （设计理由）

## 工具清单（36，描述原文）

### 搜索 / 读取
- `notion-search` — "Search Notion and sources connected to your workspace, such as Slack, Mail, Calendar, Google Drive, and Jira"
- `notion-ai-search` — "Search Notion and sources connected to your workspace"（自然语言语义查询）
- `notion-fetch` — "Retrieves content from a Notion page, database, data source, or saved database view"
- `notion-query-data-sources` — "Query Notion data sources with SQL, read rows from one data source, or run a saved view"
- `notion-query-meeting-notes` — "Query the current user's meeting notes, filtering by meeting-specific properties"

### 页面写入
- `notion-create-pages` — "Creates one or more Notion pages with specified properties and content"（**复数**：一次建多页）
- `notion-update-page` — "Update a Notion page's properties, content, icon, or cover"
- `notion-move-pages` — "Move one or more Notion pages or databases to a new parent"
- `notion-duplicate-page` — "Duplicate a Notion page within your workspace"
- `notion-create-folder` — "Create an empty Folder under a parent page"

### 数据库 / 视图
- `notion-create-database` — "Creates a new Notion database, initial data source, and initial view"（**一次建三样**）
- `notion-update-data-source` — "Update a Notion data source's properties, name, description, or other attributes"
- `notion-create-view` — "Create a new view on a Notion database"
- `notion-update-view` — "Update a view's name, filters, sorts, or display configuration"

### 附件 / 文件（三步一族）
- `notion-create-file-upload` — "Creates a short-lived URL for uploading one local file directly to Notion"
- `notion-create-attachment` — "Creates a Notion attachment from exactly one source: inline UTF-8 text, a file at a direct public HTTPS URL, or a completed file upload"
- `notion-download-attachment` — "Downloads the complete UTF-8 text content of an attachment"

### 技能（Notion Skills）
- `notion-search-skills` — "Finds active Notion Skills that the connected user can access"
- `notion-download-skill` — "Downloads a complete Notion Skill"
- `notion-convert-page-to-skill` — "Marks a Notion page as a Notion Skill without changing its content"

### Custom Agent 会话（11 个，**把"派一个子 agent"做成了完整的工具族**）
`notion-list-agents` / `notion-search-agents` / `notion-query-sessions` / `notion-search-sessions` / `notion-spawn-session` / `notion-get-session-status` / `notion-wait-session` / `notion-stop-session` / `notion-send-message-to-session` / `notion-list-session-events` / `notion-read-session-event`

### 评论 / 人 / 杂项
- `notion-create-comment` — "Add a comment to a page or specific content"
- `notion-get-comments` — "Lists all comments and discussions on a page"
- `notion-get-teams` — "Retrieves a list of teams (teamspaces) in the current workspace"
- `notion-get-users` — "Lists workspace members and guests with their IDs, names, emails, and types"
- `notion-get-async-task` — "Retrieves the current status of an async task started by another tool"

## 设计理由（博客原文）
> "create-pages and update-page are new, ground-up rewrites of existing Create & Update Page APIs, providing interfaces that make more sense for an AI agent conversation than a traditional, rigid web API."

> "three years later, we've heard about the challenges of making several API requests to work with block children in a hierarchical JSON format."

> Notion-flavored Markdown 的理由："efficient content density per LLM token, requiring fewer tool interactions and less cost than the open-source MCP server for common use cases."

> 对旧版（1:1 包 API）的判词："the 1:1 API mapping created suboptimal experiences for AI agents, like high-context token consumption from working with hierarchical block data in JSON."

## 维度归纳
- **工具数**：36（其中 11 个是 Custom Agent 会话管理，真正的"文档动词"只有 25 左右）。
- **动词粒度**：以"用户会一口气做完的一件事"为单位。`notion-create-database` 一次建 database + data source + view 三层；`notion-create-pages`/`notion-move-pages` 天生**批量**（复数名）。
- **命名风格**：`产品名-动词-名词`（kebab-case，全局带 `notion-` 前缀做 namespace）。名词全是用户词汇（page / database / view / comment / teamspace）。
- **读写分离**：动词区分；无机器标注。
- **破坏性标注**：文档层没有。注意**没有 `notion-delete-page` 工具**——删除干脆不给 agent。
- **返回值是否指路**：`notion-get-async-task`（"…an async task started by another tool"）是显式的"下一步在哪拿结果"入口；文件上传三件套把"先要一个 URL，再用它建 attachment"的顺序写进了描述。
- **最可迁移的一条**：**内容表示层换掉了，不是工具数量换掉了**。Notion 判断瓶颈不在"工具太多"，而在"内容格式对模型不友好（层级 JSON）"，于是发明了 Notion-flavored Markdown。
