# GitHub MCP Server（官方）

> 抓取日期 2026-09-11。一手出处：
> - README https://github.com/github/github-mcp-server （工具名 + annotation title）
> - 源码 https://github.com/github/github-mcp-server/blob/main/pkg/github/issues.go （description / annotations / schema 原文）
> - Discussion #1182 https://github.com/github/github-mcp-server/discussions/1182 （默认 toolsets 的数字与理由）
> - Changelog 2025-10-29 https://github.blog/changelog/2025-10-29-github-mcp-server-now-comes-with-server-instructions-better-tools-and-more/ （合并了哪些工具）

## 规模与分组
README 按 **toolset** 分组：actions / code quality / code security / context / copilot / dependabot / discussions / gists / git / governance / issues / labels / notifications / organizations / projects / pull requests / repositories / secret protection —— 17 组、约 66 个工具名。

Discussion #1182 的数字（原文）：
> 工具从 **"101 tools"** 降到 **"52 tools"**；token 从 **"64.6k tokens"** 降到 **"30.3k tokens"**。
> 默认 toolsets："context - Current user and GitHub context, repos - Repository operations, issues - Issue tracking, pull_requests - PR workflows, users - User information"
> 理由三条：
> 1. "Excessive context: 101 tools consuming 64.6k tokens by default"
> 2. "LLMs struggle to choose the right tool from too many options"
> 3. "**Defaults matter. Most users never customize their configuration, so they were paying a performance penalty for tools they never used**"

## 合并了哪些（Changelog 2025-10-29 原文）
> "The following pull request review tools have now been consolidated into a single, powerful `pull_request_review_write` tool: `create_and_submit_pull_request_review`, `create_pending_pull_request_review`, `submit_pending_pull_request_review`, `delete_pending_pull_request_review`"

> "The following issue tools have been consolidated into a single, powerful `issue_read` tool: `get_issue`, `get_issue_comments`, `list_labels (with issue_number)`, `list_sub_issues`"

> "the following issue tools are consolidated into a single `issue_write` tool: `create_issue`, `update_issue`"

> "The following sub-issue tools have been consolidated into a single `sub_issue_write` tool: `add_sub_issue`, `remove_sub_issue`, `reprioritize_sub_issue`"

> 理由原文："configurations leaner, AI reasoning clearer, and performance faster."

另有 **server instructions**（原文）：
> "Server instructions are a feature of the Model Context Protocol specification which acts like a system prompt that guides the model in effectively using an MCP server."
——**调用顺序/依赖写在 server 级说明里，不是塞进每个工具描述里。**

## 合并后的工具长什么样（源码原文）

`issue_read`：
```
Name:        "issue_read"
Description: "Get information about a specific issue in a GitHub repository."
Annotations: Title: "Get issue details", ReadOnlyHint: true
```
它的 `method` 参数枚举（描述原文，注意每个分支自己写了返回什么）：
```
1. get - Get issue details. Also returns best-effort hierarchy flags (`has_parent`, `has_children`); `parent` and `sub_issues_summary` are optional relationship summaries, and `closed_by_pull_requests` summarizes the pull requests configured to close the issue as `total_count` plus up to 5 `references`.
2. get_comments - Get issue comments.
3. get_sub_issues - Get sub-issues (children) of the issue.
4. get_parent - Get the parent issue, if this issue is a sub-issue of another.
5. get_labels - Get labels assigned to the issue.
Enum: ["get","get_comments","get_sub_issues","get_parent","get_labels"]
Required: ["method","owner","repo","issue_number"]
```

`issue_write`：
```
Name:        "issue_write"
Description: "Create a new or update an existing issue in a GitHub repository."
Annotations: Title: "Create or update issue/pull request", ReadOnlyHint: false
Meta: ui: { resourceUri: IssueWriteUIResourceURI, visibility: ["model","app"] }
```

### ★ 最值得 Nomi 抄的一段：写操作先渲染一张表单，返回值负责"按住"模型
`issue_write` 在开启表单模式时**不直接写**，而是返回一个 `IsError=true` 的占位结果。源码注释原文：
> "The result is marked IsError=true so agents that bail on error don't claim success or chain dependent tool calls while the user is still interacting with the form; the host renders the UI regardless because rendering is keyed off the tool's `_meta.ui` resourceUri."

返回给模型的正文原文（update 分支）：
> "An interactive form has been shown to the user for editing issue #%d in %s/%s. **STOP — do not call any other tools, do not respond as if the issue was updated, and do not claim the operation succeeded.** The issue has NOT been updated yet; only the form was rendered. Wait silently for the user to review and click Submit. When they do, the real result will be delivered to your context automatically."

## 维度归纳
- **工具数**：默认 52（全量曾 101，README 现列约 66 名）。
- **动词粒度**：合并后以"名词 + 读/写"为单位——`issue_read` / `issue_write` / `sub_issue_write` / `pull_request_read` / `pull_request_review_write` / `projects_get` / `projects_list` / `projects_write` / `label_write` / `custom_properties_read` / `custom_properties_write`。具体操作降级成 `method` 枚举。
- **命名风格**：**名词_读写**（`issue_read`），与老命名 `get_issue`（动词_名词）相反——这是一次刻意的方向反转，为的是"同一名词的所有操作排在一起"。
- **读写分离**：写进名字里，并且有 `--read-only` 开关。README 原文："Read-only mode takes priority: write tools are skipped if `--read-only` is set, even if explicitly requested via `--tools`"。
- **破坏性标注**：用 MCP `ToolAnnotations`，但**实际只填了 `Title` + `ReadOnlyHint`**；`DestructiveHint` / `IdempotentHint` 在 issues.go 里一次都没出现。
- **返回值是否指路**：是，而且是最强的一种——见上面的 "STOP" 文案。
