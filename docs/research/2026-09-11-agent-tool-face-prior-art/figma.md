# Figma MCP Server（官方）

> 抓取日期 2026-09-11。一手出处：
> - https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/ （工具清单正本）
> - https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server （高层指南，自称"high-level look"，把工具清单指向上面那页）
> - https://www.figma.com/blog/design-context-everywhere-you-build/ （博客，**没有**讲工具重命名，别拿它当出处）

## 工具清单（原文描述）

### Design → Code（7）
| 工具 | 描述原文 | 返回 |
|---|---|---|
| `get_design_context` | "Use the MCP server to get the design context for a layer or your selection in Figma" | React + Tailwind 代码（可换框架） |
| `get_metadata` | "Returns a sparse XML representation of your selection containing just basic properties" | XML 大纲：层 ID / 名 / 类型 / 位置 / 尺寸 |
| `get_screenshot` | "Allows the agent to take a screenshot of your selection" | PNG |
| `download_assets` | "Downloads assets from a Figma file" | 导出渲染 + 原始素材的临时 URL（一次最多 20 个 node） |
| `get_variable_defs` | "Returns the variables and styles used in your Figma selection" | 颜色/间距/字体 token |
| `get_motion_context` | "Returns keyframe animation data for an animated node" | keyframe 轨道 + CSS @keyframes + motion.dev 片段 |
| `get_figjam` | "Returns metadata for FigJam diagrams in XML format" | XML + 节点截图 |

文档对这组的定位（原文）：
> "get_design_context is the default entry point: the other tools in this group are either inputs to it, or fallbacks when a selection is too large or you need a specific asset format."

### Code → Design（5）
| 工具 | 描述原文 |
|---|---|
| `use_figma` | "The general-purpose tool for writing to Figma files" |
| `generate_figma_design` | "Lets you prompt your MCP client to send live UI as design layers" |
| `create_new_file` | "Creates a new blank Figma Design, FigJam, or Figma Slides file" |
| `upload_assets` | "Uploads assets (PNG, JPG, GIF, WebP) into a Figma file" |
| `generate_diagram` | "Generates a FigJam diagram from Mermaid syntax or descriptions" |

### 设计系统 / Code Connect（4）
`get_libraries`（"Get the design libraries associated with a Figma file"）、`search_design_system`（"Searches across all connected design libraries for components, variables, and styles"）、`get_code_connect_map`（"Retrieves mapping between Figma instance node IDs and Code Connect components"）、`add_code_connect_map`（"Adds a mapping between a Figma node ID and code component"）。

### 生成式插件 / Shader（9）
`list_generative_plugins` / `get_generative_plugin` / `create_generative_plugin` / `update_generative_plugin` / `list_shaders` / `get_shader` / `create_shader` / `update_shader` / `list_file_shaders`。
注意 `create_generative_plugin`、`create_shader` 文档标 **"Requires: figma-generative-plugins skill" / "Requires: figma-shaders skill"**——工具本身声明了它依赖一个技能。

### 账号（1）
`whoami`：**"Returns the identity of the user authenticated to Figma"**，返回 email + plans + 每个 plan 的 seat type；文档注明它是 `create_generative_plugin` / `create_shader` 的**前置**。

### Prompt（不是工具）
`create_design_system_rules`：**"A prompt for creating a rule file that provides agents with design system context"**。

## 维度归纳
- **工具数**：26 个 tool + 1 个 prompt。
- **动词粒度**：一个工具 = "一次能用得上的一整件设计上下文"，不是一次 API 调用。`get_design_context` 一把返回代码+结构；写侧更极端，`use_figma` 一个工具管 create/edit/delete/inspect 全部写操作。
- **命名风格**：**动词_名词**（`get_*` / `create_*` / `list_*` / `search_*` / `download_*` / `upload_*`），名词用**用户词汇**（design context、variable、library、shader、figjam），不是 API 内部词（不叫 `get_node_tree`）。
- **读写分离**：靠动词前缀天然分开；写侧被刻意收成 `use_figma` 一个总入口 + 4 个专用创建器。
- **破坏性标注**：文档层面**没有** readOnly/destructive 标注；`generate_figma_design` 只写 "Respects seat type permissions"。
- **返回值是否指路**：是。`get_metadata` 明确定位成"先拿大纲再取细节"的分页手段；文档写死了"默认入口 + 其余是它的输入或 fallback"的调用图。
