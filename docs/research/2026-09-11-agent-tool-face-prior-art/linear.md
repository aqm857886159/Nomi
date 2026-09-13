# Linear MCP Server（官方）

> 抓取日期 2026-09-11。
> **没拿到**：Linear 官方文档页 https://linear.app/docs/mcp **不列工具清单**，全文只有一句：
> > "The Linear MCP server has tools available for finding, creating, and updating objects in Linear like issues, projects, and comments — with more functionality on the way"
> 下面 31 条来自 Speakeasy 的实连目录 https://www.speakeasy.com/product/mcp-gateway/catalog/linear/ （第三方对官方 server 的 `tools/list` 快照，**非官方文档**，描述文本是 server 自己返回的原文）。

## 工具清单（31，描述原文）

| 工具 | 描述原文 |
|---|---|
| `get_attachment` | "Retrieve an attachment's content by ID." |
| `create_attachment` | "Create a new attachment on a specific Linear issue by uploading base64-encoded content." |
| `delete_attachment` | "Delete an attachment by ID" |
| `list_comments` | "List comments for a specific Linear issue" |
| `save_comment` | "Create or update a comment on a Linear issue. If `id` is provided, updates the existing comment; otherwise creates a new one." |
| `delete_comment` | "Delete a comment from a Linear issue" |
| `list_cycles` | "Retrieve cycles for a specific Linear team" |
| `get_document` | "Retrieve a Linear document by ID or slug" |
| `list_documents` | "List documents in the user's Linear workspace" |
| `create_document` | "Create a new document in Linear" |
| `update_document` | "Update an existing Linear document" |
| `extract_images` | "Extract and fetch images from markdown content. Use this to view screenshots, diagrams, or other images embedded in Linear issues." |
| `get_issue` | "Retrieve detailed information about an issue by ID, including attachments and git branch name" |
| `list_issues` | "List issues in the user's Linear workspace. For my issues, use \"me\" as the assignee." |
| `save_issue` | "Create or update a Linear issue. If `id` is provided, updates the existing issue; otherwise creates a new one." |
| `list_issue_statuses` | "List available issue statuses in a Linear team" |
| `get_issue_status` | "Retrieve detailed information about an issue status in Linear by name or ID" |
| `list_issue_labels` | "List available issue labels in a Linear workspace or team" |
| `create_issue_label` | "Create a new Linear issue label" |
| `list_projects` | "List projects in the user's Linear workspace" |
| `get_project` | "Retrieve details of a specific project in Linear" |
| `save_project` | "Create or update a Linear project. If `id` is provided, updates the existing project; otherwise creates a new one." |
| `list_project_labels` | "List available project labels in the Linear workspace" |
| `list_milestones` | "List all milestones in a Linear project" |
| `get_milestone` | "Retrieve details of a specific milestone by ID or name" |
| `save_milestone` | "Create or update a milestone in a Linear project. If `id` is provided, updates the existing milestone; otherwise creates a new one." |
| `list_teams` | "List teams in the user's Linear workspace" |
| `get_team` | "Retrieve details of a specific Linear team" |
| `list_users` | "Retrieve users in the Linear workspace" |
| `get_user` | "Retrieve details of a specific Linear user" |
| `search_documentation` | "Search Linear's documentation to learn about features and usage" |

## 维度归纳
- **工具数**：31。
- **动词粒度**：读侧三段式固定（`list_X` / `get_X`），写侧**upsert 合一**——`save_issue` / `save_comment` / `save_project` / `save_milestone` 全部是"给 id 就改，不给就建"。这是把 create+update 两个工具压成一个的最干净写法，而且**判据写在描述里**（"If `id` is provided…"），模型不用猜。
- **命名风格**：`动词_名词`，名词用**产品里用户看得见的词**（issue / cycle / milestone / team），不是数据库表名。
- **读写分离**：非常整齐——`list_`/`get_`/`search_` 只读；`save_`/`create_`/`update_`/`delete_` 写。删除**单独留一个工具**（`delete_comment`、`delete_attachment`），没有塞进 `save_*` 的 action 参数里。
- **破坏性标注**：文档层面没有；靠动词名区分（`delete_*` 自带语义）。
- **返回值是否指路**：`get_issue` 明说返回里含 "git branch name"——把"下一步你要用的东西"放进返回里；`list_issues` 直接在描述里教用法（"For my issues, use \"me\" as the assignee."），**把最常见的一次查询写成描述里的配方**，而不是另开一个 `list_my_issues` 工具。
