# Agent 原生 AI 剪辑：完整项目调研（ChatCut 类产品深挖）

> 日期：2026-09-09 · 定位：**通用 agent 底层的 AI 剪辑**（agent 直接读写真实时间轴），不含一键流水线代（MoneyPrinterTurbo 类，见[前一篇](2026-09-09-ai-video-editing-landscape-and-gap.md)）
> 方法：GitHub 搜索 + README/源码树/工具 schema 实读（OpenChatCut 的 `openchatcut-tool-schemas.json` 全量解析、ChatCut 官方 agent-plugin 全部 skill 实读）
> 交付配套：可执行方案见 [2026-09-09-agent-native-editing-plan](../plan/2026-09-09-agent-native-editing-plan.md)

---

## 一、赛道定性与四家代表

「agent 原生剪辑」的定义：**agent 和人操作同一个真实项目状态**——agent 的每次编辑写进真实轨道/片段/字幕，编辑器立即可见、可继续手动改、可撤销、可交给另一个 agent。与流水线代的分界线是「产物是否仍可编辑」。

| 产品 | 形态/Stars/许可 | Agent 接入方式 | 时间轴真相源 |
|---|---|---|---|
| **ChatCut（官方，闭源）** | chatcut.io SaaS + Desktop | 托管 MCP（`api.chatcut.io/api/external-mcp/mcp`）+ Codex/Claude 插件包 + `npx skills` 技能树 | 云端 Project/DB/S3，「工具调用写穿 Zero/DB/S3 路径，编辑器可见」 |
| **OpenChatCut** | 1653★ · AGPL · TS/React19/**Remotion 4**/Electron43 | 内置 agent + MCP 外接，**工具 schema JSON 直接放仓库**（`assets/agent/openchatcut-tool-schemas.json`，约 120 个工具） | 本地项目 + 多轨时间轴（Remotion 渲染） |
| **Pireel**（原 pireel） | 1169★ · AGPL（编辑器）+ Apache-2.0（agent 插件） | `npx skills add pireel/pireel-agent`：1 个 SKILL + 14 篇 craft references + MCP | 本地画布+时间轴，托管版加 Chat |
| **FireRed-OpenStoryline**（小红书） | 3381★ · Apache-2.0 · Python | 内置对话 agent + OpenClaw/Claude Code skills | 时间轴 + 内容理解状态 |
| 小型簇 | Mr.Director(34)、cut-motion(144)、velocut(452)、ai-video-editor(793)、Cassette(131)、deepvideo、openscene、StoryCraft | 多为「自然语言→时间轴操作」的单机/插件形态 | — |

**共同信号**：这一类产品全部把 agent 接入做成「**MCP/插件 + 操作上下文 skill + 时间轴工具组**」三层，且都在 2026 上半年密集发布——agent 原生剪辑已经从论文（LAVE 2024）变成实战场。

## 二、ChatCut 官方：agent 操作上下文的教科书

实读其 `chatcut-plugin-basics-claude/SKILL.md`（约 5 千词的操作纪律）+ 17 个 skill（asset-import / transcription / verification / export / known-errors / talking-head-guide / multicam-sync / create-motion-graphics / shader-gen / video-gen / image-gen / music / digital-human / widget-forms / product-help / connect / basics）。

**工具词汇**（从 skill 文本提取）：`list_projects` / `create_project` / `target_project` / `get_editor_url` / `read_project`（只回项目地图+时间轴目录）/ `preview_timeline`（分页 items、间隙、标记、合成帧、bounded speech；`views:["viewer"]`；`tracks/itemIds/fromFrame/toFrame` 收窄）/ `inspect_item`（单件完整细节）/ `browse_assets` / `inspect_asset` / `manage_media_pool` / `edit_item` / `submit_export` / `track_export` / `ask_followup_questions`（MCP-App 卡片）。

**八条可迁移的设计纪律**（每条都是踩坑换来的）：

1. **发现阶梯**：`read_project`（地图，省 token）→ `preview_timeline`（分页）→ `inspect_item`（单件）→ `browse_assets`（库）。明文规定「不要并行调多个发现阶段」「read_project 没返回的细节=未知，不是空」——**诚实语义进工具契约**。
2. **帧原生**：「时间轴放置与时长是帧原生的；面向用户的摘要才用秒」。
3. **显式波及语义**：「删除默认留间隙；ripple 只作用于同轨；重叠默认拒绝；顺序内容同轨按时间排、分层内容上高层轨」——把剪辑师的本能写成机器规则。
4. **先验旧后动刀**：「不要依赖过期的 item id / 轨道布局 / 资产就绪态——用户可能刚在编辑器里手动改过」。
5. **改后验证**：「报告完成前验证真实结果：结构改动后检查字幕/动图/B-roll/音乐的依赖对齐；生成类要看真实合成帧才能说好看」+ `verification` skill + `verify` 类工具。
6. **编辑器即评审面**：「agent 验证 ≠ 用户批准；默认交付可编辑时间轴而不是导出 MP4」——防止 agent 用成品文件敷衍可编辑性。
7. **对齐校准**：什么时候必须问（新项目/模糊创意/花钱的生成/重大分叉）、什么时候不许问（机械可逆/用户说继续）；「只问承重信息，不跑固定清单」。
8. **只做被要求的事**：「不要默默加音乐/字幕/转场/调色」。

## 三、OpenChatCut：最完整的开源工具面（约 120 工具全量解析）

按功能域归并（数量为实数）：

| 功能域 | 工具 | 值得注意的设计 |
|---|---|---|
| 时间轴 CRUD | read_timeline、move_item、set_item_timing、split_item、remove_item（`ripple:true` 收尾间隙）、duplicate_item、clear_timeline、edit_track（`tighten`/`reorder_items`）、manage_timelines（多序列/复制/插入） | 「items 同轨禁重叠」是 schema 级规则 |
| **transcript 层** | transcribe_track、read_transcript（紧凑短语视图）、**find_transcript**（「找一句话什么时候说」=时间坐标查询）、manage_transcript（纠错/翻译变体保词级时间）、**delete_text**（「删文字=删视频」）、edit_gap（呼吸/静音间隙列出与编辑）、clean_script（固定口水词表+类型化停顿）、remove_silence | 文本→时间坐标→视频剪辑的完整链 |
| **文本式剪辑** | **read_script**（时间轴物化成 segment-id 编码的 timeline.md）→ 人/agent 改 Markdown → **apply_script**（原子提交，无效行整批拒绝） | 编辑 Markdown 就是剪辑时间轴 |
| 语义媒体 | search_media（**ChineseCLIP 视觉场景命中**+transcript 命中统一面）、detect_scenes（本地 FFmpeg 场景切分）、find_highlights（长→短高光） | |
| **音乐节拍** | detect_beats（设备端节拍/重拍）、analyze_music（**设备端 Beat This+CLAP 模型**）、inspect_music（读缓存）、**music_edit_plan**（从缓存分析+BGM 修剪确定性生成只读切分计划）、sync_cuts_to_music（执行时重算、只切开未锁定视频轨）、music_image_plan/sync_images_to_music | **确定性 planner + agent 执行**——节奏数学不交给 LLM 自由发挥 |
| 字幕 | read/edit_captions（分页）、apply_caption_avoidance（分析字幕下方可见层，挪开遮挡）、place_graphics_in_safe_zone | 遮挡规避做成了工具 |
| 颜色 | **inspect_color**（「按数字测色域而不是看截图猜」：luma 黑白电平/RGB）、auto_grade | 色彩验证数字化 |
| 音频 | normalize_loudness（LUFS 离线分析）、isolate_voice（AI 降噪） | |
| 生成 | submit_image（gpt-image-2/nano-banana/MiniMax…）、submit_voice（ElevenLabs/豆包/MiniMax/Inworld/Fish）、submit_sound、submit_music（Mureka/MiniMax…）、submit_video（Seedance/Kling/Hailuo/Grok…）、track_progress、**rerun_generation**（带完整原提交参数重跑） | 生成任务可追溯重放 |
| 动图/MG | submit_motion_graphic、**create_motion_graphic_from_code（内联 React/JSX）**、update_item_props（模板 prop 白名单）、convert_motion_graphic_to_video、export_motion_graphic_prores（4444 透明通道） | MG=资产（代码+属性）/item（时位+覆盖）分离 |
| 多机位 | multicam_sync（时码→拍摄时钟→音频波形多级对齐）、change_cam（持久多机位范围切换） | |
| 版本/撤销 | **undo_last_change / redo_last_change**、manage_versions（命名版本检查点）、manage_link_group（持久编辑关系，一个可撤销变更） | |
| 互操作 | **import_timeline（FCPXML 1.x / CMX3600 EDL）**、**export_jianying_draft（导出剪映草稿！）**、import_asset/import_folder/browse_local_media、push_asset | 「导出剪映草稿」是抢存量用户的钩子 |
| 导出验证 | submit_render_job（异步）/track_export/read_export_history/**verify_export**（交付前质检） | |
| Agent 自身 | **ToolSearch（延迟工具目录按关键词激活 schema）**、load_skill/install_skill/run_skill_script（白名单命令）、**report_user_friction**（用户被卡住时静默遥测）、ask_followup_questions、read_agent_artifact（历史工具结果有界回读） | 工具太多→用 ToolSearch 控上下文预算 |

**OpenChatCut 的启示**：它证明了「通用 agent 底层剪辑」的工具面可以完整到 120 个而不失控——靠的是 ①读写分离+发现阶梯 ②确定性 planner 承担节奏/颜色数学 ③ToolSearch 延迟激活控上下文 ④每个工具的 description 都写「什么时候用/什么时候不用」。

## 四、Pireel 与 FireRed 的补充

- **Pireel**：插件形态与 ChatCut 官方同构（1 SKILL + craft references：talking-head-edit / montage-edit / audio-and-music / captions / storyboard-draft / talking-head-cleanup / montage-variants / known-errors / export）。特色：**editing Skills & Frames**（可复用剪辑风格与版式），`connect-agent.md` 单页接入指引值得抄。
- **FireRed-OpenStoryline**：见前一篇（ASR 口播粗剪 / AI 转场 / beat-sync / 剪辑工作流存档 Skill）。补充：2026-03 起与 OpenClaw/Claude Code 生态打通——**闭源 SaaS 的 craft skills 开源分发**成为共同打法（ChatCut 官方同样把 craft skills 开源在 agent-plugin 仓库）。

## 五、共性架构总结（这一类产品的「底层」，含 5.5 补充至 10 条模式）

```
┌─ agent 宿主（Codex / Claude Code / 内置 agent）
│    ├─ 插件 = MCP 配置 + 操作上下文 SKILL + craft references + 校验脚本
│    └─ 工具面 = 发现阶梯(读) + 结构化操作(写) + 验证(看) + 生成(付钱) + 元工具(ToolSearch/undo)
├─ 时间轴真相源 = 项目/序列/轨道/片段/资产 五级模型，帧原生坐标
│    ├─ 写入纪律：提案化(可撤销) / 显式 ripple+gap / 重叠拒绝 / 乐观锁 revision
│    └─ 读纪律：分页 / 未返回=未知 / 先验旧后动刀
├─ transcript 层 = ASR(词级时间戳) → find_transcript(时间坐标查询) → 文本式剪辑(delete_text / timeline.md)
├─ 确定性 planner = 节拍/颜色/响度数学本地算，LLM 只做意图与编排
└─ 验证环 = 合成帧回读 + verify_export + 依赖元素检查；编辑器实时可见=评审面
```

## 六、扩容扫描（第二轮，2026-09-09 补充）

### 6.1 Palmier Pro —— 类目第一，也是最重要的商业教训

**14.3k★，本类目最高**，"macOS video editor built for AI"。关键事实：**开源核转闭源**——v0.7.6 及之前 GPLv3 源码保留在 `last-gpl-source` 分支，之后只发二进制。教训双向：① 需求真实（类目天花板 14k★）；② 纯 GPL 开源核撑不住商业化。对 Nomi 的启示：Pireel 的**双许可切分**（编辑器 AGPL + agent 插件 Apache-2.0 + 托管增值）比 Palmier 的「先全开后转闭」更平稳——Nomi 的 AGPL + 商务服务路线与现状兼容，不用改。

### 6.2 新挖掘仓库（机制要点）

| 仓库 | Stars | 核心机制 |
|---|---|---|
| [ronak-create/FableCut](https://github.com/ronak-create/FableCut) | 659 | **「项目文件即接口」**：整条时间轴=一个 `project.json`（媒体/片段/轨道/特效/关键帧/转场），agent 走 MCP/REST 写 JSON，时间轴实时更新；零 npm 依赖单文件服务 |
| [MartinDelophy/ai-video-editor](https://github.com/MartinDelophy/ai-video-editor)（Timeline Studio） | 793 | **2026-09-08（昨天）刚给 agent 加 Timeline markers**：agent 经 Skill+CLI+MCP 读写标记/章节/区间，**apply 前给语义 diff 预览**；便携 `.timeline` 工程格式；13 语；Whisper 字幕/AI 音乐/Smart Frame 插件 |
| [VelornLabs/velorn](https://github.com/VelornLabs/velorn) | 472 | **100+ MCP 工具** + ComfyUI 生产层（规划→生成→素材→时间轴→字幕→导出全项目化）；UGC 广告模板+分镜计划——**与 Nomi 定位最接近的直接对手**（生成+剪辑一体），但它把生成绑死在 ComfyUI |
| [mrbuslov/capcut-ai-editor](https://github.com/mrbuslov/capcut-ai-editor)（SmartCut） | 102 | **不造编辑器，直接改闭源编辑器的工程文件**：MCP server 读剪映自动字幕→启发式删静音/重复条（本地零 API key，可选 GPT 增强）→回写剪映工程。寄生策略样本 |
| [linyqh/speclip-skills](https://github.com/linyqh/speclip-skills) | 106 | NarratoAI 作者的新一代：AI 剪辑以 **skills 形态分发** |
| AH64-dll/OpenEdit | 46 | 编辑器整体作为本地 MCP server |
| Kush36Agrawal/Video_Editor_MCP | 51 | ffmpeg 级剪辑操作 MCP 化 |
| nanzhi84/Rushes | 24 | 本地对话式剪辑 agent |
| velocut（open-ribbi） | 452 | 浏览器内 AI-native 剪辑 |
| JoyAI-Video-Edit（京东） | 1.8k | 自回归实时开放式剪辑（研究向） |

### 6.3 商业产品坐标（2026 现状）

| 产品 | 范式 | 与 agent 原生的关系 |
|---|---|---|
| **Descript** | 文本式剪辑鼻祖：转写→删文字=删视频；filler 词自动删；Overdub 克隆声补录；Eye Contact/Studio Sound | 口播范式的价格锚（$24/mo）；agent 原生产品的 transcript 层做出来就是它的开源替代 |
| **CapCut/剪映** | 免费全桶：自动字幕/卡点 auto-beat sync/智能剪/文生音 | 字节生态；**其工程文件格式已被 OpenChatCut 导出和 SmartCut 寄生**——剪映生态是开源阵营的公共互操作目标 |
| **Premiere Pro** | Firefly 系：Generative Extend（AI 补帧填缺口）/文本式剪辑跟进/Object Mask | 专业锚；「生成补剪辑缺口」被 Adobe 官方化，验证方案 L 的 AI 转场方向 |
| **Runway** | 生成式特效/擦除/慢放 | 生成侧专项，不碰时间轴 agent |
| **OpusClip** | 长切短自动高光 | 专项赛道（对应 find_highlights 工具级能力） |
| **DaVinci** | AI 调色/语音隔离免费给 | 颜色/音频 AI 能力的质量标杆 |

**行业共识判断**（多来源交叉）：AI 剪辑的可靠区=字幕/静音口水词/响度清理/场景检测/粗剪；不可靠区=创意节奏/叙事/风格一致性。2026 的主趋势是「**剪辑与创作的边界消失**」——生成与剪辑进同一界面。这正是 Nomi 的既有位置，验证不追.Descript 式单点而做「生成+剪辑一体 agent 工作台」的路线。

### 6.4 学术脉络

- **LAVE**（Adobe, CHI 2024）：LLM 助力剪辑的开山——agent 对话 + 时间轴 grounding（语义素材检索→粗剪→局部精修），此后所有「对话式剪辑」产品都是它的工程化。开源实现仅见 fork（stijnklomp-LAVE/client）。
- 剑桥/社区后续（ChatCut、Mr.Director 等）均为 LAVE 范式 + 真实工程化（MCP/插件分发）。
- 值得记的判断：LAVE 论文里的三个组件（**素材语义检索 / 粗剪 agent / 聊天式精修**）到 2026 已全部有开源实现，但**没有任何开源项目把三者与生成侧、预算审批、角色一致性合到一个桌面工作台**——这是 Nomi 的空位。

### 6.5 新增两条共性模式（并入 §五，模式清单至此 10 条）

9. **「项目文件即接口」谱系**：从 FableCut（整条时间轴=JSON 文档）到 SmartCut（寄生剪映工程文件）到 Timeline Studio（便携 `.timeline`），时间轴的可序列化表示越干净，agent 接入越便宜。Nomi 的 timelineTypes 已是强类型单一真相源，差的是**稳定的序列化/回写层**（方案 C' 的 timeline.md 是它的可读形态）。
10. **标注即规划**：Timeline Studio 的 agent markers（章节/节拍/修改备注，apply 前语义 diff）——agent 需要在时间轴上有「便签层」来做长任务规划，不只是读写片段。

## 七、Nomi 对照（现状锚点 + 精确差距）

Nomi 已有（#646 后口径）：pi lane 运行时；画布读写工具组（`nomi_canvas_write` typed 契约+示例+容忍器，`laneCanvasTools.ts:144`）；**时间轴读工具**（`laneTimelineTools.ts`：帧原生+`revision` 乐观锁纪律已写进工具守则 `TIMELINE_GUIDELINES`）；`propose_edit_plan` 契约存在但**被明确挡在阶段 3**（`laneTimelineTools.ts:14-24`：`operations[]` 的 transition/text 两支各有一个形状不同的 `action` 字段，`flattenDiscriminatedUnion` 当场拒收——这是**已知且有明确修法的债**）；productionRun 全套动词工具（`productionRunDescriptors.ts`：start/get/subscribe/control/decide/revise/review/materialize）；导出工具（`exportCapabilities.ts`）。

精确差距（对照 §五五层）：

| 层 | ChatCut/OpenChatCut | Nomi | 差距 |
|---|---|---|---|
| 时间轴写入 | 全 CRUD+ripple+split+tighten | 读 100%；写入=propose_edit_plan 待修契约 | **P0**（修法已知） |
| transcript 层 | 词级 ASR→find_transcript→delete_text→timeline.md | 无（拆解引擎内部 whisper 未外暴） | **P0** |
| 验证环 | preview_timeline 帧回读/verify_export/inspect_color | read_waveform（renderer 解码）+verify_render（receipt 级） | P1 |
| 确定性 planner | detect_beats/music_edit_plan/sync_cuts | 无 | P1 |
| 版本/撤销 | undo/redo/命名版本工具 | 编辑器有撤销；agent 侧无版本工具 | P2 |
| 元工具/预算 | ToolSearch 延迟激活 | 无（工具面小暂时不痛，长了会痛） | P2 |
| 互操作 | FCPXML/EDL 进、剪映草稿出 | 无 | P2 |
| craft skills | 官方开源 17 个 skill 分发 | Skill Pack 有画布技能，无剪辑 craft skill | P2 |
| 标注/Markers | Timeline Studio agent markers（章节/节拍/diff 预览） | 无 | P2（方案 G'） |

**Nomi 反超点**（保持并放大）：生成+剪辑一体（agent 剪完直接在画布生成补镜头，OpenChatCut 有 submit_video 但没有参考槽/角色一致性深度）、productionRun 审批/预算/门（这类产品都没有生产级预算账本）、MCP 外调双入口、本地优先桌面完整度。
