# Codex（OpenAI）

> 抓取日期 2026-09-11。**一手出处（开源源码，非泄露）**：https://github.com/openai/codex `codex-rs/core/src/tools/`

## 工具定义原文

### `exec_command`（`handlers/shell_spec.rs`）
```
name: "exec_command"
description: "Runs a command in a PTY, returning output or a session ID for ongoing interaction."
```
（Windows 下额外拼接 `windows_shell_guidance()`。）
参数描述原文：
```
cmd               "Shell command to execute."
workdir           "Working directory for the command. Defaults to the turn cwd."
tty               "True allocates a PTY for the command; false or omitted uses plain pipes."
yield_time_ms     "Wait before yielding output. Defaults to 10000 ms; effective range is 250-30000 ms."
                  (Windows 版) "Maximum time to wait before returning a session ID for a still-running command.
                   Commands that finish sooner return immediately. For ordinary commands, omit this parameter
                   to use the 10000 ms default. Effective range on Windows is 10000-30000 ms."
max_output_tokens "Output token budget. Defaults to 10000 tokens; larger requests may be capped by policy."
shell             "Shell binary to launch. Defaults to the user's default shell."
login             "True runs the shell with -l/-i semantics; false disables them. Defaults to true."
environment_id    "Environment id from <environment_context>. Omit to use the primary environment."
```
**每个参数描述都写了默认值和有效范围。** 且 `output_schema: Some(unified_exec_output_schema())`——**有输出 schema**。

### `write_stdin`
```
description: "Writes characters to an existing unified exec session and returns recent output."
session_id      "Identifier of the running unified exec session."
chars           "Bytes to write to stdin. Defaults to empty, which polls without writing."
yield_time_ms   "Wait before yielding output. Non-empty writes default to 250 ms and cap at 30000 ms;
                 empty polls wait 5000-300000 ms by default."
```

### `request_permissions`（★ 权限本身是一个工具）
```
name: "request_permissions"
description: "Request additional filesystem or network permissions from the user and wait for the client
 to grant a subset of the requested permission profile. Use environment_id to target a specific attached
 environment; omit it to use the primary environment. Relative filesystem paths resolve against the selected
 environment cwd. Granted permissions apply automatically to later shell-like commands in the current turn,
 or for the rest of the session if the client approves them at session scope."
reason          "Optional short explanation for why additional permissions are needed."
permissions     (permission_profile_schema)
```
**注意三件事写进了描述**：① 授权是"批一个子集"不是全有全无；② 授权对**本回合后续命令**自动生效；③ 客户端可以把它升到 **session 作用域**。

### `apply_patch`（★ freeform，不是 JSON）
```
name: "apply_patch"
description: "The `apply_patch` tool can be used to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON."
format: { type: "grammar", syntax: "lark", definition: <apply_patch.lark> }
```
**用 lark 语法约束输出，而不是 JSON schema。**

### `update_plan`
```
name: "update_plan"
description: "Updates the task plan.
Provide an optional explanation and a list of plan items, each with a step and status.
At most one step can be in_progress at a time."
plan[].step    "Task step text."
plan[].status  enum ["pending","in_progress","completed"]  "Step status."
```
**"同时只能有一个 in_progress" 这条不变量写在描述里。**

### `request_user_input`（★ 描述随 mode 动态生成）
```
name: "request_user_input"
description = format!("Request user input for one to three short questions and wait for the response.
                       This tool is only available in {allowed_modes}.")
```
问题 schema 的参数描述原文：
```
questions        "Questions to show the user. Prefer 1 and do not exceed 3"
questions[].id   "Stable identifier for mapping answers (snake_case)."
questions[].header   "Short header label shown in the UI (12 or fewer chars)."
questions[].question "Single-sentence prompt shown to the user."
questions[].options  "Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its
                      label with \"(Recommended)\". Do not include an \"Other\" option in this list; the client
                      will add a free-form \"Other\" option automatically."
options[].label       "User-facing label (1-5 words)."
options[].description "One short sentence explaining impact/tradeoff if selected."
```
并且服务端**强制归一**（`normalize_request_user_input_tool_args`）：
```
if missing_options { return Err("request_user_input requires non-empty options for every question") }
for question in &mut args.questions { question.is_other = true; }
```
**UI 约束（字数、选项数、推荐项位置）直接进 schema 描述，且运行时校验 + 强制补 Other。**

### `view_image`
```
name: "view_image"
description: "View a local image file from the filesystem when visual inspection is needed.
              Use this for images already available on disk."
path    "Local filesystem path to an image file."
detail  enum ["high","original"]  "Image detail level. Defaults to `high`; use `original` to preserve exact resolution."
output_schema: { image_url: "Data URL for the loaded image.",
                 detail: "Image detail hint returned by view_image. Returns `high` for default resized behavior
                          or `original` when original resolution is preserved." }
```

### 还有（已确认存在、本次未逐条抄描述）
`tool_search` · `get_context_remaining` · `new_context_window` · `current_time` · `list_available_plugins_to_install` · `request_plugin_install` · `send_message_to_user_async` · `sleep` · MCP 资源三件套（`list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource`）· 多 agent 两代（v1: `spawn/wait/send_input/resume_agent/close_agent`；v2: `spawn/wait/send_message/list_agents/interrupt_agent/followup_task`）。

## ★ `consequential_tool_message_templates.json`（55 条）——破坏性操作的人话确认文案表
`codex-rs/core/assets/consequential_tool_message_templates.json`，`schema_version: 4`，55 条，全部属于 `server_name: "codex_apps"`。每条结构：
```json
{
  "tool_title": "add_comment_to_issue",
  "template_params": [
    {"name": "pr_number",       "label": "Pull request"},
    {"name": "repo_full_name",  "label": "Repository"},
    {"name": "comment",         "label": "Comment"}
  ],
  "template": "Allow {connector_name} to add a comment to a pull request?"
}
```
样本（原文）：
```
create_branch                          -> Allow {connector_name} to create a branch?
create_pull_request                    -> Allow {connector_name} to create a pull request?
add_review_to_pr                       -> Allow {connector_name} to submit a pull request review?
enable_auto_merge                      -> Allow {connector_name} to enable pull request auto-merge?
remove_reaction_from_pr_review_comment -> Allow {connector_name} to remove a reaction from a pull request review comment?
delete_event                           -> Allow {connector_name} to delete an event?
create_spreadsheet                     -> Allow {connector_name} to create a spreadsheet?
batch_update                           -> Allow {connector_name} to apply presentation updates?
batch_update                           -> Allow {connector_name} to apply document updates?
slack_send_message                     -> Allow {connector_name} to send a message?
create_issue                           -> Allow {connector_name} to create an issue?
unassign_issue                         -> Allow {connector_name} to unassign an issue?
```
关键点：
1. **确认文案是一张随版本发布的资产表**（有 `schema_version`），不是运行时拼字符串。
2. 同一个工具名（`batch_update`）在不同 connector 下有**不同的人话**（"apply presentation updates" vs "apply document updates"）——**人话按场景写，不按工具名写**。
3. `template_params` 把"这次调用哪几个参数要展示给用户看、用什么标签展示"显式登记了——**审批卡的字段不是模型决定的，是产品预先定义的**。

## 维度归纳
- **工具数**：核心约 20 + MCP/多 agent/插件族。
- **动词粒度**：`exec_command` 一个工具管所有命令执行（PTY + 会话），`write_stdin` 管交互续写——**把"长任务"建模成 session id 而不是两个工具**。
- **命名风格**：`动词_名词`（`exec_command`、`view_image`、`apply_patch`、`update_plan`、`request_permissions`、`request_user_input`）。**全部用动词开头，且动词本身就是意图**（request_ 而不是 get_）。
- **读写分离**：靠 approvals 模块 + `request_permissions` 运行时协商，不靠命名。
- **破坏性标注**：**55 条人话模板表**（见上）+ approvals 策略，不用 MCP annotation。
- **返回值是否指路**：`exec_command` / `view_image` 都有 `output_schema`；`view_image` 的输出里回传 `detail` 让模型知道自己拿到的是原图还是缩图。
