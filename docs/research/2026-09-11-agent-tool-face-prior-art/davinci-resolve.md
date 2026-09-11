# DaVinci Resolve 21.1 的 MCP 服务器（官方）+ 三个社区版

> 抓取日期 2026-09-11。**本库里唯一和 Nomi 同域（视频创作）的官方样本**，所以单列一份。
>
> 一手出处：
> - 官方发布公告（逐字引用来源）：https://www.blackmagicdesign.com/media/release/20260908-03 「Blackmagic Design Announces DaVinci Resolve 21.1」，IBC 2026, Amsterdam, Tuesday, September 8, 2026
> - 官方发布贴 / What's New 正本：https://forum.blackmagicdesign.com/viewtopic.php?f=21&t=239823 （Peter Chamberlain, Blackmagic Design, Tue Sep 08, 2026 4:33 am，`Release of DaVinci Resolve Studio 21.1`）
> - 官方产品页：https://www.blackmagicdesign.com/products/davinciresolve/studio （**通篇没有** MCP / AI Assistant / 21.1 字样，只写 "DaVinci Resolve Studio features support for both Python and LUA scripting, along with developer APIs…"）
> - 报道：https://www.cgchannel.com/2026/09/blackmagic-design-releases-resolve-21-1/ ·
>   https://www.cined.com/davinci-resolve-21-1-released-ai-assistant-integration-via-mcp-individual-hdr-trims-and-python-scripting-moves-to-studio/ ·
>   https://digitalproduction.com/2026/09/08/resolve-21-1-adds-mcp-and-finally-gets-presets/ ·
>   https://www.explainx.ai/blog/davinci-resolve-21-1-mcp-server-ai-agents-2026 ·
>   https://byteiota.com/davinci-resolve-21-1-mcp-server/ ·
>   https://note.com/npaka/n/nea00a22e4f57 （日文实操综述）
> - 社区版对照：https://github.com/DigitalWorkflowCompany/resolve-mcp ·
>   https://github.com/samuelgursky/davinci-resolve-mcp ·
>   https://github.com/jenkinsm13/resolve-mcp

## 没拿到（明说，不编）

1. **官方 MCP 工具清单（name + description + schema）：没拿到。** Blackmagic **没有公开发布**任何工具名、描述或 schema。官方 What's New 里关于 MCP 的全部文字只有一行（见下）。产品页、发布公告、开发者页都没有 MCP 文档入口。
2. **本机没装 Resolve 21.1**（`/Applications/DaVinci Resolve` 不存在），所以**没有**跑 `tools/list` 拿全量。而且它是 Studio-only（€305 / $295），免费版没有这个功能。
3. **⚠️ 网上流传的「官方 88 工具 + 20 resources」是误传，别当官方数据用。**
   byteiota 那篇写 "Resolve 21.1's MCP server exposes 88 tools … 20 read-only resources"，但同一篇把「完整 API 文档」指向 `DigitalWorkflowCompany/resolve-mcp` —— 那是一个**第三方 MIT 仓库**，其 README 第一句自己写的就是 "An MCP server providing full API coverage for DaVinci Resolve **21**. Exposes **88 tools and 20 resources**"。88/20 是那个社区仓库的数字，被搬到了官方头上，又被搜索引擎反复复读。**本文件把它按社区版记，不按官方记。**
4. 官方对「审批 / 破坏性操作防护 / 日志 / 共享环境下的权限」**只字未提**。Digital Production 专门点了这一条（见下，原文引用）。

---

## 1. 官方到底说了什么（逐字）

### 1.1 What's New 正本里，MCP 只占一行

`Release of DaVinci Resolve Studio 21.1` 的 **General Improvements** 段第一条：

> Native MCP server for interacting with AI assistants.

**就这一行。** 整份 What's New 里 "MCP" 只出现这一次；没有工具清单、没有配置说明、没有安全章节。

### 1.2 发布公告里的定位（逐字）

> "DaVinci Resolve 21.1 now supports integration with AI assistants such as Claude, Claude Code and ChatGPT Codex, allowing customers to analyze projects, organize media, adjust settings and batch render using everyday conversational language. Customers can ask their AI assistant to create highlight edits from long form video, remove unwanted clips and render deliverables, so they can spend more time being creative rather than getting bogged down in repetitive tasks."

CEO Grant Petty：

> "With AI assistant support, our customers can now ask Claude or ChatGPT to handle repetitive tasks such as create highlight edits, organizing media or batch rendering, which frees them up to focus on creative decisions."

**注意公告里根本没出现 "MCP" 三个字母**——对外话术是 "AI assistant integration"，"MCP" 只在给技术用户看的 What's New 里出现。

### 1.3 「100+ 工具」是被误读的数字（重要澄清）

公告原文：

> "…plus there are **over 100 new tools and controls for faster editing and color grading workflows**."

指的是**剪辑/调色的界面工具**（另有 "over 25 new Krokodove tools" 指 Fusion 节点），**不是 MCP 工具数**。explainx 也独立写明这批 "over 100 new editing and color tools" 与 MCP 能力是两码事。**Nomi 内部引用时别把「Resolve MCP 有 100+ 工具」当事实。**

### 1.4 设置入口

`File > Setup AI Assistants`（Digital Production、CineD、VP Land 三家一致）。Studio-only；免费版不含。

---

## 2. 真正的「工具面」证据：那 19 条新 Scripting API

官方 What's New 的 **Scripting API** 段是理解这次设计的关键——**Blackmagic 为 MCP 做的新增能力，是以 scripting API 的形式描述和交付的**，不是以「MCP 工具」的形式。逐字抄录（策略 3 条 + 能力 19 条，公告口径称 "20 new scripting APIs"）：

**策略（3）**
> Advanced scripting now requires DaVinci Resolve Studio.
> Built in Python support for console scripting.
> Python 2 is no longer supported.

**能力（19）**
> Manage keyboard customization presets.
> Update render presets.
> Add render preset to quick export.
> Query codecs, get and set formats for audio renders.
> Get media pool clip transcriptions with speaker and timing data.
> Create and flatten multicam clips.
> Trigger multicam SmartSwitch.
> Auto align timeline clips.
> Add transitions.
> Get and set more timeline clip inspector properties.
> Query and set timeline item fades.
> Query and set timeline item speed change.
> Normalize audio for timeline clips.
> Create, update and delete project setting presets.
> Import or export project setting presets.
> Clone media files.
> Set source audio mapping for media clips.
> Query and set output blanking.
> Validate and encrypt DCTL files.

**读这张表的两个判断：**

- **粒度 = scripting API 粒度，不是用户任务粒度。** 「Add transitions」「Query and set timeline item fades」「Query and set output blanking」是 API 方法级别的动词，不是「做一条 3 分钟高光片」。官方演示里那条用户任务（见 §3）是**模型自己编排出来的**，不是一个工具。
- **这批新增几乎全在「剪辑装配 + 交付」这条链上**：多机位合成/打平、自动对齐、转场、淡入淡出、变速、音频归一化、渲染预设、快速导出、项目设置预设。也就是说 Blackmagic 认定 agent 的主战场是**装配与交付**，不是创作判断。

Digital Production 的独立复述与此一致：

> "The scripting API expands accordingly, with Blackmagic saying 20 additional APIs have been added."

npaka 的日文综述也把三条路径画得很清楚（CLI → Python/Lua → Scripting API → Resolve；MCP → Resolve；Computer Use → GUI），并写明 "実行できる操作は、ResolveのMCPサーバーがAIアシスタント向けに公開している機能の範囲に限られます。あらゆるGUI操作を自由に実行できるわけではありません."（能做的只限 MCP 服务器对外公开的那部分，不是任意 GUI 操作都能做）。

---

## 3. 官方给的「一条用户任务」演示

Digital Production 转述 Blackmagic 的示例（这是目前能找到的、最接近官方 golden task 的东西）：

> "Blackmagic's example isn't merely conversational project search. It asks Claude to take a long video from the Media Pool, turn it into a three-minute highlight edit, remove edits shorter than one second and render the result as H.265 for review."

拆开看，这一句话要模型自己走完：**找素材 → 转录/分析 → 选段 → 装配时间轴 → 按规则清理（删短于 1 秒的剪辑）→ 设渲染格式 → 渲染**。没有任何一个工具叫 `make_highlight_reel`。**官方把编排责任整个留给了模型。**

## 4. 官方的缺口（被专业媒体点名）

Digital Production 原文：

> "What Blackmagic does not explain in its primer is the less glamorous facility side: permissions, safeguards around destructive operations, logging and how access should be restricted in shared environments. Before giving an assistant instructions to 'tidy up the project', those questions remain still important."

这是本库里**第一次有官方领域样本被公开指出「审批面缺失」**。对照 `counterexamples.md` 的三类反例，这属于第四类：**能力面先发，安全面留白**。

---

## 5. 社区版 A：`DigitalWorkflowCompany/resolve-mcp`（88 工具 / 20 resources，MIT）

README 首句（逐字）：

> "An MCP server providing full API coverage for DaVinci Resolve 21. Exposes 88 tools and 20 resources for project management, timeline editing, media import, color grading, rendering, export, AI analysis (transcription, audio classification, Intellisearch, Slate ID, motion deblur, speech generation), and composite workflows like automated dailies creation."

### 工具全清单（按 README 分组，工具名逐字）

| 组 | 工具名 |
|---|---|
| Project (6) | `create_project` `load_project` `save_project` `close_project` `set_project_setting` `disable_background_tasks` |
| Navigation (1) | `open_page`（"Switch between media, cut, edit, fusion, color, fairlight, deliver"） |
| Timeline (13) | `create_empty_timeline` `create_timeline_from_clips` `set_current_timeline` `set_current_timeline_by_name` `delete_timeline` `duplicate_timeline` `add_track` `delete_track` `set_track_name` `enable_track` `lock_track` `append_clips_to_timeline` `set_timeline_start_timecode` |
| Media Pool (4) | `create_bin` `set_current_folder` `move_clips_to_folder` `delete_clips` |
| Media Import (5) | `import_media` `import_media_to_bin` `scan_directory` `import_camera_roll` `import_timeline_from_file` |
| Metadata (8) | `get_clip_metadata` `set_clip_metadata` `set_clip_metadata_batch` `set_clip_property` `set_clip_color` `add_clip_flag` `extract_qc_notes_from_markers` `calculate_clip_file_sizes` |
| Clips (2) | `rename_clips`（带 token 模板 `{CAM}` `{REEL}` `{REEL:N}` `{N}` `{N:N}` `{DATE}` `{TIME}` `{UID}`）`rename_clip` |
| Markers (6) | `add_timeline_marker` `delete_timeline_marker` `delete_timeline_markers_by_color` `add_clip_marker` `get_clip_markers` `delete_clip_marker` |
| Color Grading (8) | `apply_drx_grade` `set_cdl` `apply_cdl_from_file` `set_lut` `search_and_apply_lut` `copy_grade` `reset_grades` `get_node_graph_info` |
| Audio (4) | `import_audio` `auto_sync_audio` `add_audio_track` `generate_speech` |
| Render (8) | `set_render_settings` `set_render_format` `add_render_job` `start_render` `get_render_progress` `wait_for_render` `delete_render_jobs` `load_render_preset` |
| Export (8) | `export_timeline` `export_ale` `export_edl` `export_fcpxml` `export_aaf` `export_csv` `export_otio` `export_drt` |
| Dailies (1) | `create_dailies` — "End-to-end pipeline: scan camera rolls, create bins (OCF/{Cam}/{Roll}), import media, build timeline, apply DRX/CDL/LUT grades, import and sync audio" |
| Stills (1) | `extract_stills_from_markers` |
| Fusion (3) | `add_fusion_comp` `create_fusion_node` `create_fusion_node_chain` |
| AI Analysis (8) | `transcribe_audio` `clear_transcription` `perform_audio_classification` `clear_audio_classification` `remove_motion_blur` `analyze_for_intellisearch` `reset_intellisearch_analysis` `analyze_for_slate` |
| Execute (2) | `execute_python` `execute_lua` — "Run arbitrary code with stdout/stderr capture and pre-populated Resolve API objects" |

（README 的分组小标题写 Color 9 / Export 9，但实际列出的名字各是 8 个，合计 88 与首句一致。**这就是「文档数字和真实工具面对不上」的现场**，对照 `counterexamples.md`。）

### 20 个 resources（读侧全部走 resource，不走 tool）

`resolve://system/status` `project/current` `project/list` `project/settings` `project/timelines` `timeline/current` `timeline/tracks` `timeline/markers` `timeline/items` `mediapool/folders` `mediapool/current-folder` `mediapool/clips` `mediapool/selected-clips` `storage/volumes` `gallery/albums` `gallery/stills` `render/jobs` `render/formats` `render/presets` `render/is-rendering`

README 原话：

> "Resources provide read-only access to current Resolve state."

**这是本库里读写分离做得最硬的一家**：读侧根本不是工具，是 MCP resource，模型想改状态只能走 tool。比 GitHub 靠名字后缀（`_read`/`_write`）、Playwright 靠 caps 分层都更彻底——**协议层就分开了**。

### 两个可抄的形状

- **`create_dailies` 是「一条用户任务 = 一个工具」的样本**：扫卡 → 建 bin → 导入 → 建时间轴 → 套 DRX/CDL/LUT → 导入并同步音频，全在一个工具里。**88 个工具里只有 1 个长这样**，其余全是 API 粒度。
- **`wait_for_render` 与 `get_render_progress` 分开给**：一个是轮询探针，一个是阻塞等待。模型可以自己选「我要不要在这里挂住」。

---

## 6. 社区版 B：`samuelgursky/davinci-resolve-mcp`（同一域的**粒度 A/B 实验**，MIT）

这个仓库最有价值的地方：**同一套 Resolve 能力，它同时提供两种工具面，并公开推荐其中一种。**

| Mode | Entry point | Tools | Best for（README 原文） |
|---|---|---|---|
| Compound | `src/server.py` | **36** | "Default mode for most assistants. Related Resolve operations are grouped behind action parameters to keep context usage low." |
| Full / granular | `src/server.py --full` | **377** | "Power users who want one MCP tool per Resolve API method." |

> "The compound server is recommended unless you specifically need the granular one-tool-per-method surface."

**377 → 36，靠的就是 GitHub 那招**：相关操作收进 `action` 参数。README 的 Key Stats 还给了一个本库别处没有的数字：

> Kernel Actions | **136** guarded workflow actions across 9 compound tools

也就是：**361 个 API 方法（100% 覆盖）在下面，136 个「有护栏的工作流动作」在中间，9+ 个复合工具在最上面。三层，不是一层。**

### 9 个复合工具 + 它们的动作（`docs/kernels/README.md`，逐字）

原文对这两层的定义写得很干净：

> "API coverage answers 'can MCP reach every Blackmagic method?', while kernel coverage answers 'which higher-level, guarded agent workflows are available?'."

| Kernel | MCP Tool | 动作（节选，全部见出处） |
|---|---|---|
| Media analysis | `media_analysis` | `capabilities` `plan` `analyze_file` `analyze_clip` `analyze_bin` `analyze_project` `detect_sync_events` `publish_clip_metadata` `start_batch_job` `run_batch_job_slice` `batch_job_status` `cancel_batch_job` `resume_batch_job` `cleanup_artifacts` |
| Timeline edit | `timeline` | `duplicate_clips` `copy_clips` `move_clips` `copy_range` `overwrite_range` `lift_range` `story_spine_report` `create_variant_from_ranges` `bulk_set_item_properties` `apply_look_to_items` `thumbnail_contact_sheet` `set_title_text` `bulk_set_title_text` |
| Media Pool / ingest | `media_pool` | `safe_import_media` `safe_import_sequence` `safe_import_folder` `organize_clips` `normalize_metadata` `safe_relink` `safe_unlink` `link_proxy_checked` `link_full_resolution_checked` `media_pool_boundary_report` |
| Render / Deliver | `render` | `probe_render_matrix` `probe_render_settings` `validate_render_settings` `safe_set_render_settings` `prepare_render_job` `render_job_lifecycle_probe` `safe_quick_export` `export_render_boundary_report` |
| Review annotations | `timeline_markers` | `probe_annotations` `normalize_marker_payload` `copy_annotations` `clear_annotations_by_scope` `export_review_report` |
| Color / Grade | `timeline_item_color` | `probe_grade_item` `probe_node_graph` `safe_set_cdl` `safe_copy_grade` `safe_apply_drx` `grade_version_snapshot` `grade_version_restore` |
| Fusion composition | `fusion_comp` | `probe_fusion_comp` `safe_add_tool` `safe_set_inputs` `safe_connect_tools` |
| Project lifecycle | `project_manager` | `safe_project_create` `safe_project_export` `safe_project_archive` `safe_project_restore` `safe_project_delete` `safe_set_project_settings` `project_settings_snapshot` |
| Extension authoring | `script_plugin` | `safe_install_extension` `safe_remove_extension` `refresh_or_restart_required` |

**命名规律非常整齐，而且是给模型看的：`probe_*` = 只读探针；`safe_*` = 带校验/回读的写；`*_boundary_report` = 「这个域我能做到哪为止」的自述；`*_capabilities` = 环境探测。** 一个动作名就告诉模型它属于哪一类。

### 返回值形状：`_operation` 信封（本库里最成熟的一份）

> "Every compound tool return carries an `_operation` block beside its payload, so an agent reads one shape instead of a different key per tool: `status` (`success` / `partial` / `blocked` / `failed`), `verification` (with `contradiction` kept distinct — Resolve reported success and the readback disagreed), `changes` (the semantic delta), `warnings`, and an `execution_id`."

两处「刻意的缺席」，写得比大多数官方文档都清楚：

> "Two absences are meaningful and deliberate. `verification.status: \"unverified\"` means *no evidence was reported*, not 'checked and clean'. A missing `changes` means the action did not report a delta, not that nothing changed — an empty `{}` there would be a confident, wrong answer about an edit that simply never declared one."

以及为什么不把信封平铺进顶层：

> "…flattening would rewrite a background job's `status: \"done\"` and a confirm gate's `status: \"confirmation_required\"`."

（**顺带证实：这套工具面里存在 `status: "confirmation_required"` 这一档。**）

### 事前风险评估工具

> "`inspect_operation(tool?, target_action?, target_params?)` evaluates pre-flight risk level (`low`, `medium`, `high`, `critical`), destructive potential, and blast radius (`item`, `track`, `timeline`, `project`, `system`) before taking action"

并且诚实地限定它是启发式：

> "It is a heuristic over action names, not a simulation — it never touches the project and does not validate your parameters, so `recognised: false` means the levels are defaults rather than a finding, and `snapshot_available: null` means rollback availability was not determined rather than absent."

**`blast radius`（item / track / timeline / project / system）这个维度，本库其它 13 家一个都没有。**

### 审批与标注（`SECURITY.md`，逐字）

> "Treat the MCP client as the user-confirmation boundary. Clients should ask for confirmation before destructive or high-impact actions such as quitting Resolve, deleting projects, replacing clips, relinking media, deleting markers, changing render/project settings, or installing/removing scripts, Fuses, DCTLs, and presets."

> "Tools use MCP `ToolAnnotations` where supported: `readOnlyHint` for probe/list/get operations. `destructiveHint` for operations that overwrite, delete, relink, replace, change project state, or can otherwise cause meaningful workflow impact. `idempotentHint` for repeatable state changes such as page switching. `openWorldHint` for operations that touch filesystem paths, media, render output, scripts, Fuses, DCTLs, presets, or other external resources."

**⚠️ 紧接着这句是本次调研最该记住的一条工程代价：**

> "Compound tools group multiple actions behind an `action` parameter, so their **annotation is conservative when any action in the group can mutate state**."

也就是说：**把操作收进 `action`/`method` 枚举是有代价的——annotation 的粒度随之塌到整组，一个组里只要有一个写操作，整组就得按破坏性标。** README 的可迁移结论 1（"名词 + 读/写 + method 枚举"）必须配一条补丁：**枚举收敛只在「同一组内读写属性一致」时才免费。**

### 「我不做什么」表

README 有一整节 `What This Does Not Do`，其中一句直接切中 Nomi：

> "**Judging a cut** — Nothing here has an opinion about whether an edit is good. **Every destructive action is plan → review → confirm for that reason.**"

以及素材不可变：

> "This project treats camera originals and source media as immutable. … The server must not modify, transcode, proxy, or create derivatives of source media unless the user explicitly asks for that."

以及缺依赖时的态度：

> "each one refuses honestly with its own install line rather than degrading into a guess — a fabricated tempo or an invented level produces confident, wrong output, which is worse than no feature."

---

## 7. 社区版 C：`jenkinsm13/resolve-mcp`（295+，1:1 镜像的极端）

README 首句：

> "**The most comprehensive MCP server for DaVinci Resolve.** 295+ tools covering the complete DaVinci Resolve scripting API (v20.3)"

命名是**统一 `resolve_` 前缀 + 动词_名词**：`resolve_list_projects` `resolve_create_project` `resolve_load_project` `resolve_get_project_settings` `resolve_set_project_setting` `resolve_switch_page` `resolve_import_media` `resolve_create_bin` `resolve_search_clips` `resolve_delete_clips` `resolve_relink_clips` `resolve_auto_sync_audio` `resolve_create_empty_timeline` …

分组即 API 分组：Project Management (10) / Media Pool (21) / Timeline (15) / Editing (12) / Markers & Playhead (9) / Rendering (14) / Color (12) / Fusion (8) / Fairlight (4) / Clip Metadata (18) / Timeline Items (11) / Clip Versions (11) / Gallery & Stills (7) / Node Graph (5) / **Layout Presets (22)** / Dolby Vision & Stereo 3D (4) / Media Storage (3) / Project Manager (10) / Bin-Folder (4) / Generators & Titles (13)。

**「Layout Presets 22 个工具」这一条是最好的反面教材**：UI 布局预设这种低频能力，占掉了整个工具面的 7%，永远和「剪一条片」争同一份上下文预算。

它另给 3 个「AI Bridge」工具（需 `GEMINI_API_KEY`）：`resolve_analyze_timeline`（"AI-powered editorial critique of the current timeline"）、`resolve_add_markers`、`resolve_build_from_markers`（"Fill marker-defined slots with AI-selected footage"）。**这是把「判断」也做成工具**，和 samuelgursky 明确拒绝做判断正好相反——两种取向摆在同一个域里，很值得对照。

Resources 只有 5 个：`resolve://version` `resolve://project` `resolve://timelines` `resolve://bins` `resolve://render-queue`。

---

## 8. 维度归纳与横向差异

| 维度 | 官方（21.1 内置） | 社区 A（DWC, 88） | 社区 B（gursky, 36/377） | 社区 C（jenkins, 295+） |
|---|---|---|---|---|
| 工具数 | **未公开** | 88 tools + 20 resources | 36 compound（默认）/ 377 granular / 18 offline | 295+ |
| 动词粒度 | **scripting API 粒度**（从 19 条新 API 的措辞反推） | API 粒度为主，`create_dailies` 是唯一的任务级 | **三层**：361 API 方法 → 136 guarded actions → 9 复合工具 | 严格 1:1 API 镜像 |
| 命名 | 未公开 | 动词_名词，无前缀 | `probe_*` / `safe_*` / `*_capabilities` / `*_boundary_report`（**按风险类别命名**） | `resolve_` + 动词_名词 |
| 读写分离 | 未公开 | **协议级**：读=resource，写=tool | 动作前缀 `probe_` vs `safe_` + 四种 annotation | 无（read/get 混在 tool 里） |
| 破坏性/花钱/不可逆怎么标 | **没有公开机制**；Digital Production 公开点名这一缺口 | 无标注 | `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint` 全用 + `inspect_operation` 给 risk level 与 **blast radius** + `status: "confirmation_required"` + `dry_run` | 无标注 |
| 返回值指路 | 未知 | `get_render_progress` / `wait_for_render` 成对给 | **`_operation` 统一信封**：status / verification（含 `contradiction`）/ changes / warnings / execution_id；两处「刻意缺席」写进文档 | 无 |
| 与 scripting API 的关系 | **就是 scripting API 之上的一层**：新能力全部以 scripting API 形式发布，MCP 只有一行 | 镜像 + 1 个 composite | 明确分层：API 覆盖 vs kernel 覆盖 | **纯镜像** |
| 审批 | 未公开（官方留白） | 无 | "Treat the MCP client as the user-confirmation boundary" + plan → review → confirm | 无 |
| 渲染这种重活 | 未公开 | `add_render_job` → `start_render` 两步 | `validate_render_settings` → `safe_set_render_settings` → `prepare_render_job`（**校验/设置/入队三段**） | 一组 render 工具 |

**官方 vs 社区，差在哪（一句话）：**
社区版在**比官方多一层**——护栏层（safe_/probe_/信封/风险评估/确认）。官方版把这一层整个留给了 MCP 客户端（Claude Code / Codex 的审批 UI）和用户。**Blackmagic 的赌注是「宿主负责审批，我负责能力」**；这在编程 agent 那边成立（宿主本来就有成熟审批），在 Nomi 这种「自己就是宿主」的产品里**不成立**——我们没有别人替我们做审批。

---

## 9. 对 Nomi 时间轴 / 素材 / 导出动词的可迁移结论（9 条）

> 每条：**结论** — 依据（出处）— 落到 Nomi 是什么。

1. **同域官方样本证明：「按 API 方法暴露动词」是能发布出去的默认解——但它把编排成本全转嫁给了模型。**
   官方为 MCP 新增的 19 条能力全是 API 级动词（`Add transitions` / `Query and set timeline item fades` / `Auto align timeline clips`，见 §2），而官方唯一的演示任务是「长片 → 3 分钟高光 → 删掉短于 1 秒的剪辑 → 渲染 H.265」（§3）——**中间那一整条编排没有任何工具承载**。
   → Nomi：如果我们也只给 API 级动词，那「做一条 30 分钟漫剧」就等于每次都让模型现场重新发明流程。**至少要有一个任务级动词承载我们的主链路**（对照社区 A 的 `create_dailies`：88 个工具里唯一的任务级工具，恰好是这家的主业「dailies」）。

2. **★ 三层结构比「几个工具」更值得抄：API 方法 → 有护栏的工作流动作 → 复合工具。**
   samuelgursky 把 361 个 API 方法、136 个 guarded actions、9 个复合工具明确分成三层并分别统计覆盖率，原文："API coverage answers 'can MCP reach every Blackmagic method?', while kernel coverage answers 'which higher-level, guarded agent workflows are available?'"（§6）。
   → Nomi：工具面不要在「薄包装 vs 粗动词」之间二选一。**底层保留完整能力（内部可调，不暴露给模型），中层是带护栏的工作流动作，上层是模型看见的那几个复合工具。** 这也正好给 R29 的四列表一个可填的骨架。

3. **★ 把操作收进 `action`/`method` 枚举，代价是破坏性标注塌到整组——必须同时定「同组读写属性必须一致」的规则。**
   `SECURITY.md` 原文："Compound tools group multiple actions behind an `action` parameter, so their annotation is conservative when any action in the group can mutate state."（§6）
   → Nomi：README 可迁移结论 1（`storyboard_read` + `storyboard_write(method=…)`）成立的前提是**读写已经分开**。**绝不要把「预览报价」和「执行扣费」放进同一个工具的枚举里**——那会让整个工具永远按「花钱」标，模型每次只读也要过审批卡，审批就会被点成肌肉记忆。

4. **读侧走 MCP resource、写侧才走 tool，是比命名约定更硬的读写分离。**
   社区 A 把 20 个读状态全做成 `resolve://…` resource："Resources provide read-only access to current Resolve state."（§5）
   → Nomi：当前画布/分镜/时间轴/素材/运行状态这些「当前是什么」全部做成 resource，工具面只剩「改什么」。**副作用**：工具数量直接掉一半，而且模型读状态不占工具槽。

5. **动作名直接编码风险类别：`probe_*`（只读探针）/ `safe_*`（带回读校验的写）/ `*_capabilities`（环境探测）/ `*_boundary_report`（我能做到哪为止）。**
   samuelgursky 的 136 个动作全按这套命名（§6）。
   → Nomi：比 README 结论 1 的「名词_读写」更进一步——**前缀同时告诉模型「这会不会改东西」和「改完有没有回读验证」**。`*_boundary_report` 尤其值得抄：**给每个域一个「说清自己边界」的动作**，模型撞墙前先问，比撞墙后编强。

6. **★ 写操作统一返回一个信封，并且把「没证据」和「已确认没问题」在类型上分开。**
   `_operation` 信封：`status`(success/partial/blocked/failed) / `verification`（`contradiction` 单列 = Resolve 报成功但回读不一致）/ `changes` / `warnings` / `execution_id`；文档明写 "`verification.status: \"unverified\"` means *no evidence was reported*, not 'checked and clean'"、"A missing `changes` means the action did not report a delta, not that nothing changed"（§6）。
   → Nomi：这直接对上我们踩过的两个坑——`expectAbsent 通过得太早`（计数本来就是 0）和 `harness 的 catch 会把自己的 bug 洗成产品结论`。**工具返回值里「没测到」必须是一个独立取值，不能和「测了没问题」共用 `success`。** 做成契约 + 门岗。

7. **破坏性不是一个布尔，是「风险等级 × 影响半径」。**
   `inspect_operation` 返回 risk level(`low`/`medium`/`high`/`critical`) + destructive potential + blast radius(`item`/`track`/`timeline`/`project`/`system`)，并诚实声明它是启发式不是模拟（§6）。**本库 14 个样本里只有这一家有「影响半径」。**
   → Nomi：审批卡该显示的不是「这是破坏性操作」，而是「这会动 1 个节点 / 这一整条分镜 / 整个项目」。**影响半径进审批文案表**（对照 README 结论 7 的 Codex 文案表）。

8. **渲染/导出这类重活要拆成「校验 → 设置 → 入队 → 启动 → 轮询」，不是一个 `render()`。**
   社区 B：`validate_render_settings` → `safe_set_render_settings` → `prepare_render_job` → `render_job_lifecycle_probe`；社区 A：`add_render_job` → `start_render`，并且 `get_render_progress`（探针）与 `wait_for_render`（阻塞）**分开给，让模型自己选要不要挂住**（§5、§8）。
   → Nomi：导出 MP4 与付费生成同形——**`校验(不花钱) → 报价确认 → 提交(拿 handle) → 查状态`**，其中「查状态」和「等到好」是两个工具。这与 09-09 拍板的「每次提交看报价确认」和 README 结论 11（run handle）合流。

9. **「我不做什么」要写成产品声明，而不是留给用户去撞。**
   samuelgursky 有整节 `What This Does Not Do`，其中："Nothing here has an opinion about whether an edit is good. **Every destructive action is plan → review → confirm for that reason.**" 以及素材不可变原则、缺依赖时"refuses honestly … rather than degrading into a guess"（§6）。反面是社区 C 直接把 `resolve_analyze_timeline`（"AI-powered editorial critique"）做成工具（§7）。
   → Nomi：**Agent 能不能替用户判断「这条片好不好」，是产品级取舍，必须先拍板再定工具面**——两种做法在同一个域里都有人做，不存在默认答案。在拍板前，工具描述里先写死「不评判」，避免模型自己长出这个职责。（同时呼应 R2「缺口明着标」/ D4「诚实交付」。）

---

## 10. 两条不该抄的

- **别学官方「能力面先发、审批面留白」。** Blackmagic 能这么做，是因为它的宿主（Claude Code / Codex）自带成熟审批 UI；Digital Production 已经公开点名了这个缺口（§4）。**Nomi 自己就是宿主**，审批面没有别人替我们兜。
- **别让低频能力占住工具槽。** 社区 C 的 `Layout Presets (22 tools)` 占了整个工具面的 7%（§7）——UI 布局预设和「剪一条片」抢同一份上下文预算。对照 README 结论 3（默认只暴露一小撮）：**Nomi 的设置面、偏好面、供应商管理面，都不该常驻在模型的工具清单里。**
