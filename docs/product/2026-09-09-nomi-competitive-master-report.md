# Nomi 竞争研究主报告：AdCraft 对标 + AI 剪辑全景 + 完整执行方案

> 日期：2026-09-09 · 本报告整合当日五份文档的全部结论（索引见附录 A），去重、统一编号、合并路线图，可独立阅读。
> 结论效力：所有「现状」均为 2026-09-09 当日实核（file:line / PR 全文 / 竞品源码与工具 schema），与旧文档冲突处以本文为准。

---

# 第一部分 · 执行摘要

**一句话**：Nomi 的底座选择（pi 运行时、声明式契约、productionRun 骨架、FFmpeg 剪辑）全部站在被验证的一侧；差距集中在「接通」——关键件散在影子期/在飞 PR/未合龙闭环里，而竞品把同构的东西全部交到了用户手里。

五条核心结论：

1. **AdCraft 的「9 个 agent」是叙事**：源码实核为 Python 确定性状态机 + 单一 pi 驱动结构化输出工人（无工具调用、拒后一次修复即终局）+ 9 套 persona 提示词 + 11 个角色 SKILL.md。与 Nomi「capability 工具组 + Skill Pack」本质同构，角色化包装成本极低。
2. **AdCraft 的招牌「拉片复刻」在开源仓库里没有实现代码**（1628 文件零命中）。我们 B 线（找参考→拆解→复刻）合龙后直接越过其开源交付。
3. **#646（agent 阶段 4 原子切换）是全局瓶颈**：三轮真实 C0 卡在分镜阶段，根因是工具契约对模型不友好（`operation` 首调缺字段、媒体档位 8/8 漏填、schema `type:None`）+ 审批卡 UI 摩擦 + 语言漂移——全部可修，修法已写明。
4. **agent 原生剪辑已成类目**：ChatCut 官方（托管 MCP+17 craft skills）、OpenChatCut（1653★，约 120 工具）、Pireel（1169★）、Palmier Pro（14.3k★，已转闭源）、Velorn（472★，生成+剪辑一体最接近 Nomi）。十条共性模式沉淀于第四部分 §3。LAVE（Adobe CHI'24）三组件均有开源实现，但**无一家把语义检索/粗剪/精修与生成侧、预算审批、角色一致性合进桌面工作台**——这是 Nomi 的空位。
5. **Nomi 剪辑的最大单点缺口是 transcript 层**：拆解引擎里的 whisper（#259）已在，抽成服务外暴两个工具即可解锁文本式剪辑/语义选段/口播粗剪三条线。

---

# 第二部分 · AdCraft 对标

## 1. 定位与形态

| | AdCraft | Nomi |
|---|---|---|
| 定位 | 广告垂直 Agentic 视频平台（Web+后端+Docker） | 通用 AI 视频桌面工作台（Electron，本地优先） |
| 团队/进度 | GML-MMGroup，1629 commits，案例墙+资产包 | 单人，迭代快 |
| 许可 | 个人非商业（2026-08-10 起） | AGPL-3.0-only |

## 2. Agent 架构实核（源码级）

| 层 | AdCraft 实现 |
|---|---|
| 编排真相源 | Python 后端（event store、canvas 状态机、proposal/guided actions、continuation outbox + 围栏租约 `fenced_lease.py`）；Python 选定并校验每次操作，拥有画布拓扑/供应商/素材库全部真相 |
| LLM 工人 | `apps/api/agent/`（Node/TS）跑 pi `@earendil-works/pi-ai` **0.81.1 带自家补丁**；无工具调用；structured transport 只回 typed contract |
| 容错 | Python 拒后只许修一次，二次拒绝终局（`structuredRepairPrompt`）；预提交失败码枚举约 10 个；审计白名单元数据 |
| 角色/风格 | 「9 Agent」= persona 提示词 + 11 角色 SKILL.md；约 40 个 Style Skill 仅为 advisory（policy 明文禁止风格改 schema/参数/候选数） |
| 契约 | 单 agent 约 50 operation（`propose_X_options`/`revise_X_options`/`materialize_*` 三段式动词）JSON codegen 成 typed 代码 |
| 专家映射 | `specialist_agents.py:15`：**节点类型查表**到 6 专家，不是 LLM 路由 |

哲学对照：AdCraft「无工具换确定性」（交互死板，每个意图先有 Python operation）；Nomi「有工具+作用域守卫+审批」（灵活，但契约必须对模型极友好——#646 C0 失败即证）。**不照抄无工具模式**（牺牲 Nomi 交互灵活性，违背 P4），但要把契约层收敛到「模型想错都难」。

## 3. 可借鉴的机制（逐条带源码锚点）

- **确定性骨架+LLM 填充**：`script_beats.py` 硬编码 6 拍广告骨架（钩子→揭示→利益→证明→CTA→补充），按时长均衡分秒 → 我们的预设流先写死节拍结构。
- **角色出场权威**：`character_occurrence_authority.py` + 引用策略栈 20+ 文件——同角色跨镜由服务端强制同一参考包 → 我们的参考槽体系缺这层服务端强制。
- **revision candidates + supersession 状态机**（`agent_canvas_capability_supersession.py`、`workflow_asset_history.prepare_generated_revision_candidates`）→ 候选版本语义参照。
- **预提交失败码分类表 + 审计白名单**（`durable_pi_run.py`）→ 工具契约错误回话模式。
- **BGM 链**：文字方向 skill → `propose_bgm_options` → 两家纯音乐源（火山/天谱乐）；**旁白 TTS 他们也没有**——我们方案 D 做完即领先。

---

# 第三部分 · AI 剪辑赛道全景

## 1. 三代 + 一类

| 代际 | 代表 | 特征 |
|---|---|---|
| 全自动管线代 | MoneyPrinterTurbo(121.6k)、NarratoAI(11k)、ShortGPT(7.9k) | 一键出片，产物不可编辑 |
| 本地能力代 | FunClip(6.2k)、auto-editor(5.2k) | 单点锋利（ASR 选段/阈值剪切），无创作上下文 |
| **agent 原生类（主战场）** | ChatCut 官方、OpenChatCut(1653)、Pireel(1169)、Palmier Pro(14.3k)、FireRed(3381)、Velorn(472)… | agent 与人操作同一真实项目状态，产物持续可编辑 |
| 商业坐标 | Descript（文本式剪辑鼻祖）、CapCut/剪映（卡点/免费全桶）、Premiere（Generative Extend 官方化）、Runway、OpusClip、DaVinci | 行业共识：AI 可靠区=字幕/去口水词/响度/粗剪；主趋势=**剪辑与创作边界消失**（Nomi 既有位置） |

## 2. 四家深挖要点

**ChatCut 官方**（托管 MCP + 17 craft skills）：八条操作纪律——发现阶梯（`read_project`→`preview_timeline`→`inspect_item`，未返回=未知）、帧原生、显式波及（删除默认留间隙/ripple 仅同轨/重叠拒绝）、先验旧后动刀、改后验证依赖元素、「agent 验证≠用户批准」、对齐校准（何时必须问/禁止问）、只做被要求的事。

**OpenChatCut**（约 120 工具全量解析）：transcript 层（`find_transcript` 时间坐标查询、`delete_text` 删文字=删视频、`clean_script` 固定口水词表）；文本式剪辑（timeline.md 物化→改→`apply_script` 原子回写）；节拍确定性 planner（`music_edit_plan`/`sync_cuts_to_music`）；`inspect_color` 数字验色；undo/命名版本；FCPXML 进 + **剪映草稿出**；ToolSearch 延迟激活控上下文。

**Pireel**：插件形态与 ChatCut 官方同构（1 SKILL+14 craft references）；editing Skills & Frames；双许可切分（AGPL 编辑器 + Apache 插件）。

**Palmier Pro**：14.3k★ 类目第一；v0.7.6 后 GPL 核转闭源二进制。**教训**：Pireel 式双许可切分更稳，Nomi 现有 AGPL+商务服务路线不改。

**FireRed-OpenStoryline**（3381★，小红书）：ASR 口播粗剪（去口水词/重复）、AI 转场（首尾帧+NL 生成）、BGM 卡点、剪辑工作流存档 Skill。

**Velorn**（472★）：100+ MCP 工具 + ComfyUI 生产层，UGC 广告模板 + 分镜计划——定位最接近 Nomi 的直接对手，弱点是生成绑死 ComfyUI。

## 3. 十条共性模式（类目「底层」）

1. 时间轴真相源五级模型（项目/序列/轨道/片段/资产），帧原生坐标
2. 写入提案化（可撤销）+ 乐观锁 revision
3. 发现阶梯 + 诚实语义（未返回=未知）+ 分页
4. 显式 ripple/gap/重叠拒绝规则写进契约
5. transcript 层 = ASR 词级时间戳 → 时间坐标查询 → 文本式剪辑
6. **确定性 planner 承担节奏/颜色/响度数学，LLM 只做意图与编排**
7. 验证环：合成帧回读 + verify_export + 依赖元素检查；编辑器实时可见=评审面
8. craft skills 以插件/MCP 分发（`npx skills add`）
9. 「项目文件即接口」谱系：时间轴可序列化表示越干净，agent 接入越便宜
10. 标注即规划：agent 需要时间轴「便签层」（markers/章节/diff 预览）

## 4. 学术脉络

LAVE（Adobe CHI 2024）三组件——素材语义检索 / 粗剪 agent / 聊天式精修——2026 已全部有开源工程化实现；**空位**：无一家把三者与生成侧、预算审批、角色一致性合进桌面工作台。

---

# 第四部分 · Nomi 精确差距总表

> Nomi 现状基线（当日实核）：lane 时间轴读 100%（帧原生+乐观锁，`laneTimelineTools.ts`）；画布写工具 typed 契约+示例+副作用声明（`laneCanvasTools.ts:144`）；`propose_edit_plan` 契约存在但因 union 拍平问题**有意挡在阶段 3**（修法已写明，`laneTimelineTools.ts:14-24`）；productionRun 管线动词**已全套暴露**（`productionRunDescriptors.ts:12-96`）；拆解引擎九成熟（`deconstructVideo.ts`，#259）；找参考在飞（#619）；诚实过程反馈在飞（#658）；体感回归+体验量表在飞（#662/#664）。

| # | 差距 | 竞品证据 | Nomi 现状 | 级别 | 方案 |
|---|---|---|---|---|---|
| G1 | 端到端编排没接通（一句话→成片） | AdCraft 全链自动 | #646 三轮 C0 卡分镜阶段；根因=工具契约+审批卡 UI+语言漂移 | **P0** | A |
| G2 | 时间轴 agent 写入缺失 | OpenChatCut 全 CRUD/ChatCut edit_item | 读 100%，写入契约挡在阶段 3（修法已知） | **P0** | A' |
| G3 | transcript 层缺失 | 全类目的地基（FunASR/whisper） | 引擎内 whisper 未外暴 | **P0** | B' |
| G4 | 拉片复刻未合龙 | AdCraft README（开源无实现） | 找参考在飞+拆解引擎九成熟+复刻设计押后 | **P0** | B |
| G5 | 口播粗剪/语义选段缺失 | FireRed ASR 粗剪、FunClip LLM 选段 | 无 | P1 | C' |
| G6 | 验证环弱（agent 看不到结果） | preview_timeline/verify_export | receipt 级+波形，无帧回读 | P1 | D' |
| G7 | 生产级角色/场景资产包 | AdCraft 三视图/多机位+出场权威 | 参考槽体系已有，缺规范+服务端强制 | P1 | D |
| G8 | 声音链路：无 TTS 编排、无 BGM 卡点 | FireRed beat-sync；AdCraft 纯音乐源 | clip 音频参数已进导出，编排层无 | P1 | E / E' |
| G9 | AI 转场缺失 | FireRed 首尾帧+NL 生成；Premiere GenExtend 官方化 | 仅 dissolve/fade 滤镜 | P1 | L（并 E' 批次） |
| G10 | 版本化/候选回滚 | OpenCreator 全版本；AdCraft supersession | 采纳桥幂等键，无版本语义 | P2 | F / F' |
| G11 | 文本式剪辑（timeline.md） | OpenChatCut/Descript | 无 | P1 | C' |
| G12 | 标注/Markers | Timeline Studio（9/8 刚上） | 无 | P2 | G' |
| G13 | craft skills（剪辑方法论分发） | ChatCut 17 skills 开源 | Skill Pack 无剪辑技能 | P2 | M |
| G14 | 互操作（剪映草稿/FCPXML） | OpenChatCut 双向 | 无 | P2 | F' |
| G15 | 广告垂直预设流 | AdCraft script_beats 6 拍+recipes | genre profile 浅 | P2 | G |
| G16 | 角色化 Agent 叙事 | AdCraft 9 persona | capability 工具组（更通用） | P2 | C 尾巴 |
| G17 | 案例墙+官方资产包 | AdCraft Releases | 无 | P2 | H |

**Nomi 反超点（保持放大）**：MCP 被外部 agent 调用（双入口）；开放接入（66 认证台账+任意中转+ComfyUI 直导）；生成+剪辑一体（参考槽/角色一致性深度）；productionRun 预算账本/审批/门；本地优先桌面完整度；经验沉淀闭环+体验质量保障（#662/#664）。

---

# 第五部分 · 完整方案总集

> **📁 最终方案包（开工入口）**：[docs/plan/2026-09-09-competitive-response-plans/INDEX.md](../plan/2026-09-09-competitive-response-plans/INDEX.md) —— 本部分全部方案已整理为可执行文件夹（P0-1/P0-2/P0-3/P1-1/P1-2/P1-3/P2/P0-hardening 八个文件，含路线图与批次），以下保留总集叙述。

> 制作线方案 A–H 详版见 [AdCraft 对比文档](2026-09-09-adcraft-vs-nomi-full-comparison-and-plan.md)；剪辑线方案 A'–G' 详版见 [agent 原生剪辑方案](../plan/2026-09-09-agent-native-editing-plan.md)。此处收录每条的核心设计与验收门。

## 制作线（对 AdCraft）

**A【P0】把 #646 推过合并门**——三刀：① 工具契约收敛（storyboard 族 `operation` 路由字段派生化、媒体档位 enum/derive+容忍兜底、错误回话模型可自纠、消灭 `type:None`）；② 审批卡默认展开摘要+思考文本折叠+模型名不截断；③ 输出语言约束注入。验收=#646 既有合并门：L2 回放全绿（补语料到 200）+ 打包 C0 真短片一次通过（MP4+13 截图+R30 正式数字）。

**B【P0→P2】拉片复刻合龙**——B1 拆解面板按 2026-09-05 拍板立新方案出样张（引擎契约已定，面板只消费）；B2 镜头表→分镜表节点可编辑工作流；B3 局部复刻接 M 线审批链（#232）。验收：对标视频→拆解→勾镜落画布→起稿真实 E2E。

**C【P0→P1】管线动词硬化**（修正后射程）——C0 真跑推过阶段 02（依赖 A）；步数上限重审（24/8/1 对长任务偏紧，管线 capability 单独设档）；进度复用 #658 五段语汇投影阶段状态；角色化包装=纯 UI 投影。

**D【P1】角色/场景资产包规范**——三视图/面部/服装/色板槽位化=复用 `ArchetypeReferenceSlot` 声明式体系；服务端「出场权威」强制同一参考包（借 AdCraft）；可导出导入。

**E【P1】对白→TTS→音轨**——`meta.dialogue` 增加「生成旁白」：TTS 供应商（MiniMax/ElevenLabs 已接）→音频落素材库→自动落 audio 轨对齐镜头；BGM v1 手选。

**F【P2】候选版本/回滚**——资产 lineage+重生成两段式候选（复用 #232 候选语义+采纳桥幂等模式）；与 OpenCreator「每次修改新版本」对齐，覆盖生成与剪辑两侧。

**G【P2】广告预设流**——Skill Pack v2 承载三条 playbook 模板（产品展示/游戏买量/电商种草），**先写死 6 拍节拍骨架再 LLM 填充**（借 `script_beats.py`）；零产品代码。

**H【P2】案例墙+官方资产包**——依赖 B/D 合龙后产出真实成片与资产包（Releases+sha256）。

## 剪辑线（对 agent 原生类目）

**A'【P0】时间轴写入契约**——统一 transition/text 两支 `action` 为 discriminated shape（差额下沉 refine）；v1 操作集=重排/帧级裁切/clip 音频/文字轨/转场（只发布引擎渲染得了的值）/落轴素材；每操作带 `affects` 影响声明（计划卡按它分组，直修 C0 审批卡摩擦）；走采纳桥同族（整批一事务一步撤销）。验收：真实任务「对调两镜+全片字幕+局部转场」→计划卡可读→批准→一步撤销。

**B'【P0】transcript 层**——`extractAudioTrack`+whisper 链抽成 `electron/video/transcribe.ts` 唯一 owner（拆解引擎改消费，同 commit 删内联）；`TranscriptAsset`（segments 帧级时间戳+speakerId 可空）；工具 `read_transcript`（分页紧凑视图）+`find_transcript`（时间坐标查询）；媒体档位参数服务端 derive（对 C0 教训）。验收：10 分钟口播→转写→`find_transcript("价格")` 帧区间正确。

**C'【P1】文本式剪辑**——`read_script`（segment-id 编码 timeline.md）/`apply_script`（diff→A' 操作序列→同一提案链，无效行整批拒）；删行=删片段+同轨 ripple。验收：15 分钟口播删 3 段口水词→时长缩短无口型断裂。

**D'【P1】验证环**——`preview_timeline_frames`（复用导出链帧 resolver，同一帧语义，不出本地路径）；`verify_export` 升级抽帧自检；依赖元素检查清单进工具守则。验收：提案批准后 agent 主动抽帧自检引用帧号。

**E'【P1】节拍确定性 planner**——`detect_beats`（本地能量/onset，模型级 v2 登记）→缓存→`propose_music_plan`（确定性只读计划）→采纳桥执行；切点数值断言重拍±1 帧；锁定片段不切。

**F'【P2】版本/ToolSearch/互操作**——undo/命名版本（依赖 F 落版本语义，不双轨）；工具面>30 再建 ToolSearch；`export_jianying_draft` 优先、FCPXML v2。

**G'【P2】标注层+语义 diff 预览**——`manage_markers`（章节/节拍/备注，human 可见可编辑）；计划卡每操作附改前/改后摘要；节拍标注与 E' 共享数据。验收：agent 长任务全程 markers 规划→执行→清除，human 手改后 agent 不覆盖。

---

# 第六部分 · 统一路线图

```
全局瓶颈：#646 过门（方案 A 三刀）
     │
第一批 ├─ A' 写入契约 + B' transcript（剪辑线，#646 后立即）
       └─ B1 拆解面板立方案出样张（制作线，可并行）
     │
第二批 ├─ C' 文本式剪辑 + D' 验证环
       ├─ C 管线动词硬化（步数上限/进度投影）
       └─ B2 拆解→可编辑工作流 + E 对白 TTS + D 资产包
     │
第三批 ├─ E' 节拍 planner + G' markers
       ├─ F 候选版本（生成+剪辑两侧统一）
       └─ B3 局部复刻（接 M 线审批链）
     │
第四批 └─ G 预设流 + H 案例墙/资产包 + F' ToolSearch/互操作 + M 技能存档
```

**纪律**：#646 过门前不开新战线；A'/B' 的先红用例可先行（不依赖 lane 合并）；每条方案过 P5（真实外壳+样张拍板）再开工；验收=R16 真实任务闭环+R13 走查，五门绿只是必要条件。

---

# 第七部分 · 不做清单

1. **不抄 AdCraft 代码**（个人非商业许可）；能力设计可借鉴。
2. **不建第二套流水线/状态机**——productionRun 唯一引擎，能力走工具暴露。
3. **不做 9 个真 agent 实例**——角色化=UI 投影（P4）。
4. **不做智能 BGM 编排 v1**、不做直播切片/高光赛道（ChopperBot/autoclip 领域）、不做实时自回归编辑（JoyAI 研究向）、不用 Remotion/PySceneDetect（已有 ffmpeg+时间轴+抽帧）。
5. **不云化**——本地优先是结构性差异，不因对标而动。
6. **不照抄 AdCraft 无工具模式**——保 Nomi 交互灵活性，契约层收敛即可。
7. **不改许可路线**——AGPL+商务服务，避免 Palmier 式开源核断裂。

---

# 附录 A · 源文档索引

| 文档 | 内容 |
|---|---|
| [AdCraft 竞品差距分析](2026-09-09-adcraft-competitor-gap-analysis.md) | 首轮差距分析（G1–G8 雏形） |
| [AdCraft vs Nomi 完整对比与方案](2026-09-09-adcraft-vs-nomi-full-comparison-and-plan.md) | 18 域对比矩阵 + 方案 A–H + 附二 agent 架构 + 附三 源码级深挖 |
| [AI 剪辑开源版图 v1](../research/2026-09-09-ai-video-editing-landscape-and-gap.md) | 三代版图（管线代/能力代/agent 代）+ 方案 I–M（已被 A'–G' 深化） |
| [Agent 原生剪辑版图](../research/2026-09-09-agent-native-video-editing-landscape.md) | ChatCut/OpenChatCut/Pireel/Palmier 深挖 + 扩容 14 仓 + 商业/学术 + 10 模式 |
| [Agent 原生剪辑方案](../plan/2026-09-09-agent-native-editing-plan.md) | 剪辑线施工图 A'–G'（接口设计/分期/验收门/回滚） |
| [剪辑栈底层架构分析](../research/2026-09-09-nomi-editing-architecture-analysis.md) | 七层架构图（kernel/CAS/resolver 资产盘点）+ 方案 X1–X5（X1 修正 A' 落点） |
| [Velorn 深挖](../research/2026-09-09-velorn-deep-dive.md) | 剪辑轴+ComfyUI 集成轴双对标；可借清单（timeline-context 生成动词/缺件安装队列/健康摘要工具） |
| **[竞品核心架构对标报告](../research/2026-09-09-competitor-core-architecture-benchmark.md)** | **五家+定稿矩阵 · 12 条失败模式（issue 实证）→ N1–N8 优化清单** |
| [竞品交互设计研究](../research/2026-09-09-competitor-interaction-design-study.md) | 界面为什么长这样：五家交互卡片+横向模式表+拆解面板/计划卡设计输入 |
| [Agent 对话交互微细节](../research/2026-09-09-agent-chat-interaction-detail-study.md) | 消息解剖/ProposalCard 精确结构/Composer 状态机/错误呈现/对话守则 → 面板改进 10 条映射 |
| [Agent 工具面极简主义](../research/2026-09-09-agent-tool-surface-minimalism.md) | 五条外部证据线（Claude Code/Manus/SWE-agent/Anthropic/反例数据）→ 三层工具面政策+增长纪律 |
| [pi 运行时设计研究](../research/2026-09-10-pi-runtime-design-study.md) | pi 本地考古+上游调研：API 面核对、Lane 实验性风险、方案四条迭代 |

# 附录 B · 关键证据清单

- **AdCraft**：README（2026-09）、1628 文件树全列、`apps/api/agent/src/prompts/agents.ts`、`contracts/agent-capabilities.json`、`specialist_agents.py`、`script_beats.py`、`durable_pi_run.py`、`productionRun` 对照的 `fenced_lease.py`/`continuation_worker.py`、`tools/{ffmpeg,media_composition,media_subtitles,volcengine_pure_music,tianpuyue_pure_music}.py`、`video-skills/` 目录树
- **agent 原生剪辑**：ChatCut agent-plugin 全部 17 skill 实读 + 托管 MCP 端点；OpenChatCut `openchatcut-tool-schemas.json` 全量解析（约 120 工具）+ 2558 文件树；Pireel agent-plugin 结构；Palmier Pro 许可轨迹（`last-gpl-source`）
- **Nomi 当日实核**：`docs/ARCHITECTURE-NOW.md`、`productionRunDescriptors.ts:12-96`、`laneTimelineTools.ts:1-60`、`laneCanvasTools.ts:60-171`、`agentChatPolicy.ts:35`、`exportCapabilities.ts:177-196`、`productionPlaybooks.ts:30`、`productionRunDriverOps.ts:625-638`、`deconstructVideo.ts`、`clipAudio.ts`、`ffmpegFiltergraph.ts`、`adoptStoryboardBatch.ts`、PR #646（三轮 C0 实录）/ #658 / #659 / #619 / #656 / #662 / #664 全文
