# OpenAI Agents SDK

> 抓取日期 2026-09-11。一手出处 https://openai.github.io/openai-agents-python/tools/

## Hosted tools（官方托管，描述原文）
| 工具 | 描述原文 |
|---|---|
| `WebSearchTool` | "lets an agent search the web" |
| `FileSearchTool` | "allows retrieving information from your OpenAI Vector Stores" |
| `CodeInterpreterTool` | "lets the LLM execute code in a sandboxed environment" |
| `HostedMCPTool` | "exposes a remote MCP server's tools to the model" |
| `ImageGenerationTool` | "generates images from a prompt" |
| `ToolSearchTool` | "lets the model load deferred tools, namespaces, or hosted MCP servers on demand" |
| `ProgrammaticToolCallingTool` | "lets the model coordinate eligible tools from generated JavaScript" |

注意最后两个：**"按需加载工具" 和 "用生成的 JS 编排工具" 都被做成了工具本身**。

## Function tools：元数据从代码里 derive
装饰器行为（文档原文要点）：
- **Name**："will be the name of the Python function (or you can provide a name)"
- **Description**："taken from the docstring of the function (or you can provide a description)"
- **Schema**："automatically created from the function's arguments"（`inspect` + Pydantic）
- **Argument descriptions**："taken from the docstring of the function, unless disabled"
- 解析器：`griffe`，支持 Google / Sphinx / NumPy 三种 docstring 格式。

**含义**：工具描述的**真相源是函数 docstring**，不是另一份 JSON。这是"单一语义 owner"（R14.1）的一个现成实现。

## Agents as tools
`as_tool()` 把一个 agent 暴露成可调用工具，"enabling one agent to call another **without a full handoff**"。可配 `max_turns` / `run_config` / `needs_approval` / `parameters`（结构化入参 schema）。
**`needs_approval` 是工具定义上的一个字段**——审批不是宿主全局策略，是**逐工具声明**的。

## 失败处理
- `failure_error_function`：自定义"工具报错时回给模型什么话"。
- 默认走 `default_tool_error_function`。
- 传 `None` 则异常向上抛，由调用方处理。
> 自定义函数接收 context + exception，返回一条对模型友好的消息。

**"错误消息也是提示工程的一部分"在 SDK 层被做成了一个可注入的钩子。**

## 维度归纳（作为"设计指南"读）
- 工具的 **name / description / schema 三者都从同一段代码 derive**，杜绝描述与实现漂移。
- **审批（`needs_approval`）与失败文案（`failure_error_function`）是工具的属性**，不是外部配置。
- 工具太多时的官方答案是 `ToolSearchTool`（延迟加载）而不是"合并工具"。
