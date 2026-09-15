# Slack MCP Server（官方）

> 抓取日期 2026-09-11。一手出处 https://docs.slack.dev/ai/slack-mcp-server/
> **没拿到**：Slack 官方文档按**能力**而不是按 tool name 列表组织，页面上给的是能力名 + 一句话；**没有**逐个工具的机器 schema。下面的名字是文档里的能力标题，不保证等于 `tools/list` 里的 `name`。

## 能力清单（描述原文）

### 搜索
- Search messages and files — "filter by date, user, and content type. Retrieve metadata and content."
- Search users — "filter by name (with partial name matching), email, and user ID. Retrieve user details and statuses."
- Search channels — "filter by channel name and description. Retrieve channel metadata."
- List user channels — "list the channels you're a member of, filterable by type (public, private, DMs, group DMs), name prefix, and workspace."
- Search emoji — "returns the list of custom emoji available in the workspace."

### 消息
- Send messages — "send messages to any type of conversation in Slack."
- **Draft messages — "draft, format, and preview messages directly within AI clients."**
- Read channels — "grab the complete message history of channels."
- Read threads — "grab complete message thread conversations."
- Create conversation/channel — "creates a new Slack channel, group DM, or IM conversation on behalf of the authenticated user."
- Add reactions — "adds an emoji reaction to a Slack message on behalf of the authenticated user."

### Canvas
- Create/update canvas — "create and share rich, formatted documents."
- Read canvas — "**export canvases as markdown files**."

### 用户 / 文件 / 列表
- Fetch user info — "access complete user profile info, including custom profile fields and statuses."
- List channel members — "retrieve a list of user IDs for members of a given Slack channel or conversation."
- Upload files — "upload files to Slack via a **two-step process. The file isn't visible until the second step completes.**"
- Create/read lists — "create lists with custom schemas and read their contents."
- Update lists and records — "update list metadata and columns, and add or update individual records (rows)."

## 权限模型
文档把**每个能力映射到 OAuth scope**：读用 `search:read.public` / `search:read.private` / `files:read` / `emoji:read` / `channels:history`；写用 `chat:write` / `canvases:write` / `reactions:write` / `files:write`。
**能不能用某个工具由 scope 决定，不由工具清单决定。**

明确不做（原文）："We do not support SSE-based connections or Dynamic Client Registration at this time"；"unlisted apps are prohibited from using MCP"。

## 维度归纳
- **工具数**：约 19 个能力（官方不给准确 tool name 数）。
- **动词粒度**：一件用户任务一个能力。注意 **"Draft messages" 是独立于 "Send messages" 的一个工具**——"起草并预览"和"发出去"被刻意拆成两件事，因为后者不可撤销。
- **命名风格**：文档层用人话（"Send messages"），不是 `slack_chat_postMessage`。
- **读写分离**：用 OAuth scope 做真闸，不是靠命名约定。
- **破坏性标注**：没有 annotation；靠 scope + "on behalf of the authenticated user" 这类措辞提示副作用主体。
- **返回值是否指路**：文件上传显式写"两步，第一步完成前文件不可见"——**把多步流程的中间状态写进描述**。
