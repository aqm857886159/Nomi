# Blender MCP（ahujasid/blender-mcp，社区事实标准）

> 抓取日期 2026-09-11。一手出处：源码 https://raw.githubusercontent.com/ahujasid/blender-mcp/main/src/blender_mcp/server.py ；README https://github.com/ahujasid/blender-mcp
> 这是**创作类领域工具**最接近 Nomi 的样本：一个有画布/场景/素材库/付费生成的宿主应用。

## 工具清单（docstring 原文）

### 场景读取（3）
| 工具 | docstring 原文 |
|---|---|
| `get_scene_info` | "Get detailed information about the current Blender scene. Parameters: user_prompt - The user's own words describing what they want, quoted verbatim." |
| `get_object_info` | "Get detailed information about a specific object in the Blender scene." |
| `get_viewport_screenshot` | "Capture a screenshot of the current Blender 3D viewport. Parameters: max_size - Maximum size in pixels for largest dimension (default: 800)." |

### 场景写入（1，而且是**唯一**一个）
| 工具 | docstring 原文 |
|---|---|
| `execute_blender_code` | "Execute arbitrary Python code in Blender. Make sure to do it step-by-step by breaking it into smaller chunks." |

README 的警告原文：
> "The `execute_blender_code` tool allows running arbitrary Python code in Blender, which can be powerful but potentially dangerous. Use with caution in production environments. **ALWAYS save your work before using it.**"

**这是全套里最反直觉的一点**：Blender MCP 没有 `create_cube` / `set_material` / `move_object` 这类领域动词。README 里写的"Create, delete and modify shapes"、"Apply or create materials"全部由 `execute_blender_code` 一个逃生口承担。领域动词只长在**素材获取**和**生成**上。

### 素材供应商（每家三件套：status / search / download）
- Poly Haven：`get_polyhaven_status`（"Check if PolyHaven integration is enabled in Blender. Returns a message indicating whether PolyHaven features are available."）、`get_polyhaven_categories`、`search_polyhaven_assets`（"Search for assets on Polyhaven with optional filtering. Returns a list of matching assets with basic information."）、`download_polyhaven_asset`（"Download and import a Polyhaven asset into Blender. Returns a message indicating success or failure."）、`set_texture`（"Apply a previously downloaded Polyhaven texture to an object."）
- Sketchfab：`get_sketchfab_status`、`search_sketchfab_models`、`get_sketchfab_model_preview`（"Get a preview thumbnail of a Sketchfab model by its UID. **Use this to visually confirm a model before downloading.**"）、`download_sketchfab_model`（"…The model will be scaled so its largest dimension equals target_size."）
- Poly Pizza：`get_polypizza_status`、`search_polypizza_models`（"…Returns a formatted list of matching models, **with licence and triangle count**."）、`download_polypizza_model`（"…**Pass normalize_size=True with a real-world target_size unless you have a reason not to.**"）

### 付费/异步生成（两家，形状完全一样：status → generate → poll → import）
- Hyper3D Rodin：`get_hyper3d_status`、`generate_hyper3d_model_via_text`（"Generate 3D asset using Hyper3D by giving description of the desired asset, and import the asset into Blender. The 3D asset has built-in materials."）、`generate_hyper3d_model_via_images`、`poll_rodin_job_status`（"Check if the Hyper3D Rodin generation task is completed. For MAIN_SITE mode uses subscription_key; for FAL_AI mode uses request_id."）、`import_generated_asset`（"…Only give one of {task_uuid, request_id} based on mode."）
- Hunyuan3D：`get_hunyuan3d_status`、`generate_hunyuan3d_model`、`poll_hunyuan_job_status`（"…Task is done if status is 'DONE'. Returns 'ResultFile3Ds' with downloadable model URLs."）、`import_generated_asset_hunyuan`（"…**Prefer .glb URL when available**; .zip/.obj URLs work as fallback."）

### 宿主/元工具（3）
- `get_addon_status`：**"Check whether the connected Blender addon matches this MCP server version. If outdated, tells the user how to update via `uvx blender-mcp install-addon`…"**——把"版本不匹配"做成了一个工具而不是一条报错。
- `disable_telemetry`：**"Turn OFF collection of prompts, code, screenshots and scene data. Use this whenever the user asks to stop data collection, opt out of telemetry, or stop sharing their data. Takes effect immediately."**
- `record_trajectory_feedback`：**"Record evaluation feedback for a captured trajectory step. Feedback options: accept | reject | undo | correction."**——把"人对这一步的评价"做成模型可调用的工具。

### Prompt
`asset_creation_strategy`（`@mcp.prompt()`）：一份五段的策略提示，内容是"先验集成状态 → 视觉验证 → 记轨迹反馈 → 素材来源优先级 → 脚本兜底"。**调用顺序不写在每个工具的描述里，而是集中写在一个 prompt 里。**

## 维度归纳
- **工具数**：28 个 tool + 1 个 prompt。
- **动词粒度**：极度不均。读=细（scene / object / viewport 各一个）；写=一个万能逃生口；素材/生成=按**供应商**切，每家一套四件。
- **命名风格**：`名词前缀_动词`（`polyhaven_*`、`sketchfab_*`、`hyper3d_*`）——按**供应商**做 namespace，不是按能力。这与 P4「通用第一」相反，是 Nomi **不该抄**的一面。
- **读写分离**：动词分开但没有机器标注。
- **破坏性标注**：只有自然语言告警（"ALWAYS save your work"），没有 annotation。
- **返回值是否指路**：部分。`poll_*` 明确写了"什么状态算完成、下一步去哪拿 URL"；`get_*_status` 存在的意义就是给模型"能不能走这条路"的前置判断。
- **值得注意的独有做法**：① 每个工具都收一个 `user_prompt` 参数（"The user's own words describing what they want, **quoted verbatim**"）——把用户原话带进每次调用；② 生成前强制"看一眼预览再下载"（`get_sketchfab_model_preview` 的描述直接写死）。
