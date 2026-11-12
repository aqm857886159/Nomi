# 剪辑方向：先把粗剪做完，再交给专业软件

> 📋 方案待拍板（2026-10-28，只读核查 + 方向文档；生产代码未动）

## 0. 一句话

Nomi 不做专业剪辑软件那一套时间轴，力气压在「从分镜到一条能看的粗剪」，做完再用标准格式交给 Premiere / 达芬奇这类专业软件精修。地基是让 Agent 剪得顺：剪辑操作由 Agent 直接改、留检查点、随时回滚，不再每步弹卡（§5.0，用户已拍板）。时间轴的**数据**保留，它是 Agent 剪辑、撤销、导出的底座；时间轴的**界面**冻结在现在的水平，不再往专业剪辑方向加功能。

要用户权衡的核心：**放弃在 Nomi 里精修的那部分用户（让他们导出去 Pr / 达芬奇），换取把力气全压在我们独有的那一段。**

## 1. 起因

用户 2026-10-28 转来一篇文章，汇总了两条推文：一条来自管广告剪辑团队的 Alex Cooper，一条来自 VEED 联合创始人 Sabba Keynejad。文章的要点：

- 模型能力上来以后，Agent 已经能做初剪；夹在中间的「补剪辑能力」工具层会被吃掉。
- Sabba 建议：不要重造专业剪辑软件的时间轴，专心做好初剪，再方便地交给现有专业软件。
- 文章作者把自家产品的时间轴编辑器退居二线，默认只留一个预览播放器，「能标记、方便让 Agent 知道改哪就够了」。
- 分歧：Alex 全程在对话里剪；Sabba 认为视频有时间维度和画面空间位置，只靠聊天不够。

用户的问题：我们的剪辑和时间轴还弱，也没完成自动剪辑；是不是不需要时间轴，只要预览？以后 Agent 强了是不是连时间轴都不要？

## 2. 我们之前已经定过什么

这次的方向大部分不是新的，以前的方案已经走到了一半：

| 方案 | 定了什么 | 和文章的关系 |
|---|---|---|
| [2026-06-21-preview-rough-cut-overhaul.md](2026-06-21-preview-rough-cut-overhaul.md) §0 | 「Nomi 用户是 AI 创作者不是剪辑师」，不跟 Premiere / CapCut 拼专业功能（JKL 穿梭、帧级时间码对他们是噪音），只补普通人每天会碰的 | 一致 |
| [2026-06-21-canvas-preview-linkage.md](2026-06-21-canvas-preview-linkage.md) §0 | 5 个画像测试：只能留一条轨时全员留预览那条；大家真正点名要的是「就地重生成」「一键拼片」两个动作，不要第二条轨 | 一致，也说明我们的用户**要**那一条轨（见 §4） |
| [../superpowers/plans/2026-08-24-unified-agent-master-plan.md](../superpowers/plans/2026-08-24-unified-agent-master-plan.md) §5.1 | 自动剪辑三步：E1 采纳桥 / E2 结构化粗剪（按分镜结构派生，不靠 AI 猜）/ E3 理解式剪辑（要看懂内容，最后做） | 一致：E2 就是文章说的「初剪」 |
| [2026-08-28-editing-engine-uplift.md](2026-08-28-editing-engine-uplift.md) P2 | 特效、遮罩、关键帧、音频交叉淡化，评估 OpenCut-WASM 合成器与 MLT / libopenshot 后端 | **相反**：这就是「重造专业剪辑软件」，该方案已停 60 天 |
| [2026-08-01-timeline-experience-package.md](2026-08-01-timeline-experience-package.md) | 对标 SHUO 的时间轴手感打磨（吸附、幽灵播放头、胶片条、拖放落点） | 已做的够用；继续往这个方向打磨会滑向专业剪辑软件 |
| [../design/2026-09-05-editing-panel-design-contract.md](../design/2026-09-05-editing-panel-design-contract.md)（**用户 09-05 拍板**） | 剪辑面布局 C′（镜头 / 预览 / 常驻属性 / Nomi / 时间轴五块可拖面板）+ 时间轴补齐 11 条；变速、关键帧、自动字幕、自由加轨、Slip、多版本时间轴「另立项」 | 布局与 11 条看代码已大部分落地（`src/workbench/preview/panelLayout.ts`、`editingPanelLayoutSlice.ts`、`inspector/`），文档状态行仍写 ⏳，未逐条核。本文不推翻已落地的部分，只对「另立项」那一串表态（§5.2） |
| [2026-09-09-agent-native-editing-plan.md](2026-09-09-agent-native-editing-plan.md)（📋 待拍板） | A' 写入契约 / B' 转写层 / C' 文本式剪辑 / D' 验证环（Agent 抽帧看结果）/ E' 音乐节拍确定性 planner / F' 版本与互操作（**剪映草稿导出**）/ G' 标注层 + 改前改后语义预览 | 大部分一致，本文直接沿用它的 D' E' G'，不另起；F' 的剪映草稿与本文 §6 冲突，见拍板题 6 |

## 3. 现状核对（2026-10-28，`origin/main@5e3830719`）

| 能力 | 状态 | 证据 |
|---|---|---|
| 时间轴数据模型 | 固定 3 轨（image / video / audio）+ 文字轨 + 转场；片段级音量 / 淡入淡出已落盘并进导出 | `src/workbench/timeline/timelineTypes.ts`；`docs/ARCHITECTURE-NOW.md`「时间轴数据模型」 |
| Agent 剪辑控制面 | `read_timeline` / `inspect_timeline_range` / `propose_edit_plan` / `apply_edit_plan` / `undo_timeline_edit` 与媒体读取、导出工具已接入；剪辑计划先预览、批准后一次写入、一步撤销 | [2026-08-28-editing-engine-uplift.md](2026-08-28-editing-engine-uplift.md)「Implemented Control Plane」 |
| E2 粗剪：按镜序拼片 | **已有**。制作流程 assemble 阶段向渲染层要 `production.arrange`，按镜序整批落轴，写时间轴制品，再开「审粗剪、批准导出」门，Run 进入 `awaiting_rough_cut_review` | `electron/productionRun/productionRunDriverOps.ts:491-505` |
| E2 粗剪：对白 → 字幕 | **已有**。优先用分镜的字幕字段，没有就用对白 | `src/workbench/adoption/adoptStoryboardBatch.ts:78` `storyboardCaptionText` |
| E2 粗剪：转场 | **已有（部分）**。分镜里声明的转场落进时间轴；溶解 / 淡入淡出能渲染，match_cut / whip_pan 退成硬切并给警告 | `adoptStoryboardBatch.ts` `transitionFromNode`；`docs/ARCHITECTURE-NOW.md`「转场渲染」 |
| E2 粗剪：配乐垫底 | **没有**。拼片路径不碰音轨 | `grep` 采纳桥与 `electron/productionRun/`，无配乐逻辑 |
| E2 粗剪：配音（TTS） | **没有**。总纲 08-25 拍板 TTS 进 E2，未实现 | 同上 |
| E2 粗剪：按分镜时长对齐 | 未核：落轴时用的是成片实际时长还是分镜计划时长，实现前要先查 | `buildGenerationNodeTimelineClip.ts`（待核） |
| 给 Agent 指位置 | **部分**。选中一个片段可以作为引用交给 Agent（selection chip），内容变了会提示失效；在预览上划一个时间区间指给 Agent，还没有 | `src/workbench/ai/resident/timelineAgentSurface.tsx` |
| 交给专业软件 | **没有**。仓库里没有 OTIO / FCPXML / EDL / 剪映草稿任何交换格式的导出 | `grep -rliE 'fcpxml|opentimelineio|\.otio' src electron` 无相关命中；`git grep export_jianying_draft` 0 处 |
| 09-09 方案的工具 | `propose_edit_plan`、`verify_render`（只核回执）已有；`preview_timeline_frames`（D'）、`detect_beats` / `propose_music_plan`（E'）、`manage_markers`（G'）、`find_transcript`（B'）都还没有 | `git grep -l <工具名> -- electron src` |

更正：2026-10-28 对话里我说过「assemble 阶段只有一行」，那是照抄 `docs/ARCHITECTURE-NOW.md` 的旧描述，与代码不符。E2 实际已完成主干（拼片 + 字幕 + 转场 + 审粗剪门），缺的是声音（配乐、配音）和时长对齐。`ARCHITECTURE-NOW.md` 那一行随本方案拍板一起改。

## 4. 判断

**同意文章的部分：**

1. 不跟专业剪辑软件拼时间轴。我们 06-21 已经这么定了，这次是把走偏的部分（uplift P2）正式砍掉。
2. 初剪是值钱的那一段，而且我们比通用 Agent 剪辑多一个结构优势：分镜里本来就有镜序、对白、转场、时长，粗剪可以从结构派生，不用让 AI 看片猜。又便宜又稳，这正是 E2 的设计。
3. 精修交出去。缺的是交换格式，这是目前最便宜、价值最高的一块空白。

**不同意的部分：**

1. **「将来 Agent 强了就不要时间轴」不成立。** 视频有时间维度，「第 3 镜」「12 秒到 15 秒这段」总得有个地方能指。文章拿 Codex 去掉代码编辑器做类比，但 Codex 保留了 diff（看改了什么）。对应到视频，Agent 时代的时间轴会退化成「预览 + 镜头条 + 这次改了什么」，不会消失。
2. **时间轴的数据模型不能动。** Agent 的剪辑计划、撤销、导出、交换格式全建在它上面。要简化的是界面，不是数据。
3. **现在不默认隐藏时间轴界面。** 06-21 的用户测试里全员都留了预览那条轴。等 E2 能把轴自动填满、用户主要靠「审粗剪 → 指出问题 → Agent 改」来工作之后，再拿使用数据决定要不要收起。
4. **文章的经验多来自口播和广告**，核心是转写 + 剪废话。我们是 AI 生成短片，难点在生成和一致性，剪辑主要是拼装。所以「替代初级剪辑师」不能照搬成我们的宣传口径。

## 5. 方向决定（待拍板）

### 5.0 人和 Agent 共改时间轴：直接改、留检查点、随时回滚（用户 2026-10-28 拍板）

用户原话：「我觉得应该是第二派 否则剪辑会变成不如人类自己做」。

**两派**（调研出处见 §7）：

| 派别 | 代表 | 做法 |
|---|---|---|
| 先提议、人批准、再落盘 | Cursor 改动审阅、Google Docs 建议模式 | Agent 的改动挂着，人逐条接受 / 拒绝 |
| **直接落盘、留检查点、随时回滚（选这派）** | Descript Underlord、Figma 画布 Agent、Claude Code | Agent 直接改，改前存检查点，人看结果，不满意一键回滚 |

**为什么**：剪辑是高频、小步、要立刻看效果的活。每改一下都要点一次卡，Agent 剪辑就比人自己拖还慢，失去存在意义。时间轴操作不花钱、能撤销，把确认放在这里是在最不需要拍板的地方要人拍板。

**同类视频产品怎么做**（2026-10-28 调研，出处见 §7）：

| 产品 | Agent 改动怎么落 | 怎么回头 | 怎么保护人的改动 |
|---|---|---|---|
| Descript Underlord | 直接改项目 | 改前自动存检查点，聊天里显示，一键 Revert；另有编辑器撤销和版本历史 | 未见文档 |
| ChatCut（商业版） | Agent 在可见的时间轴上直接改，用户随时检查、手调 | 逐步撤销 | 未见文档 |
| OpenChatCut（开源） | 写进真实轨道、片段、字幕 | undo / redo + 命名版本检查点 | 被锁定的片段，节拍卡点时不切 |
| Kapwing Kai | 2026-05 起直接改项目（亮度、滤镜、位置、淡入淡出、删图层） | 未见文档 | 未见文档 |
| VEED AI Agent | 打字说需求，Agent 直接执行，时间轴仍在 | 未见文档 | 未见文档 |
| OpenCreator | 对话和可视化两种模式共用一份状态 | 每次修改生成新版本，可回看对比 | 未见文档 |
| Adobe Premiere AI Assistant（2026-06 公测） | 在打开的工程里执行任务 | 审批流程未公开 | 第三方 Automation Agent 另加了一层权限系统 |
| Timeline Studio（开源） | **例外**：应用前给语义 diff 预览 | — | — |

结论：视频类产品几乎全是「直接改」，差别在回头的方式。没有任何一家公开说明「人和 Agent 同时改同一段」时怎么处理，这是空白，下表里的「按片段判冲突」和「锁住人手改过的片段」可以成为我们的长处。

**现状与要改的**（2026-10-28 核对）：

| 现状 | 改成 |
|---|---|
| `edit_timeline` 声明为本地可撤销（`reversible_local`），却每次都弹审批卡（`nextAction: user_sees_review_card`，`electron/shared/agentCapabilities/verbs/writeVerbs.ts:415`） | 直接落盘；对话里只留一行「改了什么」+ 回滚按钮，时间轴上高亮被改的片段。审批卡这条路径同批删掉（P1，不留开关） |
| 冲突按整条时间轴判：读时的版本号和提交时不一致，整份计划作废（`stale_revision`） | 按片段判：只检查这次要动的片段有没有被人改过；没碰到就照常落盘，碰到了只重做那几个片段 |
| 「撤销 Agent 那次」在人后来动过时间轴后一律拒绝（`undo_stale_revision`） | 每次 Agent 改动前存检查点；回滚只要和人后来的改动不重叠就照常执行，重叠时说清楚是哪几个片段冲突 |
| Agent 不知道人改了什么，可能把人的手调改回去 | 每轮告诉 Agent「上次读完以后用户改了这些」；人手改过的片段默认锁定，除非用户明说让它改 |
| 历史里不分谁改的，Cmd+Z 混在一起 | 每一步记下是人还是 Agent |

**仍然要确认的**：花钱的（配音生成、生成配乐、重生成镜头）和不可逆的，照现有花钱规矩按项确认。剪辑操作本身，包括删片段，一律不确认，因为一键就能回滚。

**先量后改**：动手前先在真实项目上用真实模型跑约 15 条常见剪辑指令，量四个数：工具写对率、一轮做成的比例、因版本过期被拒的次数、每做成一次要点几下。改完再跑同一套，前后对比。这套指令登记进 `evals/`，以后每次改剪辑工具都重跑。

**界面**：「改了什么 + 回滚」是新界面，走设计管线第 1 步，先出样张再写码。

### 5.1 保留

- 时间轴数据模型、采纳桥（一次写入 / 一步撤销 / 幂等键）、Agent 剪辑控制面。
- 预览那一条时间轴界面，以及 06-21 定下的两个桥动作（就地重生成、一键拼片）。

### 5.2 砍掉

- [2026-08-28-editing-engine-uplift.md](2026-08-28-editing-engine-uplift.md) 的 **P2 合成器能力**：特效、遮罩、关键帧、透明度 / 混合模式、真 match_cut / whip_pan、OpenCut-WASM 合成器试验。
- 同文档的 **Backend evaluation**（MLT / libopenshot / OpenCut-WASM / Remotion 对比矩阵）。
- 09-05 剪辑面合同里「另立项」的专业剪辑项：**变速、关键帧、自由加轨、Slip、多版本时间轴**不再立项；**自动字幕**（转写）不砍，归 E3 / 09-09 B'。
- 拍板后同批改 uplift 文档：P2 与 Backend evaluation 标 ⛔ 并指向本文；P0 / P1 / P4 已完成部分照实结案；P3 的转写 / 语义分析归 E3。09-05 合同的「补齐范围」一行加注指向本文。

### 5.3 冻结

- 时间轴界面不再加新的交互功能（新手势、新轨道类型、专业剪辑快捷键、变速等）。bug 照修。
- 例外只有一种：§5.4 三件事本身需要的最小界面（例如在预览上划区间）。

### 5.4 要做的三件事（按顺序，都排在 §5.0 之后）

§5.0 是地基：Agent 剪得不顺，下面三件做出来也只是让 Agent 多一些剪不顺的活。

1. **E2 补声音**：配乐垫底（用 09-09 方案 E' 的节拍确定性 planner：本地算节拍，Agent 只选曲和模式）+ 配音（TTS）进音轨，走同一条采纳链；先核实并补齐按分镜时长对齐。这一条做完，E2 才算「能看、有字幕、有声音的粗剪」，也就是用户说的「完成自动剪辑」。配音涉及花钱，按花钱类走完整设计卡。
2. **导出交换格式（OTIO）**：把时间轴导出成 Premiere / 达芬奇能打开的工程，素材按引用带上。选型见 §6；它替换 09-09 方案 F' 里的剪映草稿导出（拍板题 6）。属于「数据格式」类，按 R5.5 先对齐规范再动手。
3. **标记 + 改了什么**：就是 09-09 方案 G'（时间轴标注层 + 剪辑计划卡的改前改后语义预览），再加上在预览上划区间指给 Agent。现在只能选中整个片段当引用，划区间和标注都还没有。这一条对应文章说的「能标记」和 Codex 的 diff；符合设计系统 §1.0「Agent 只指路」。新界面，走设计管线第 1 步（Claude Design 画布出样张）。

09-09 方案 D'（Agent 改完抽帧看结果）是三件事共用的验证手段，随第 1 件一起做。E3（看懂内容再剪：转写、审片给节奏建议、「开头收紧到 15 秒」，即 09-09 的 B' C'）维持总纲顺序，排在这三件之后。

## 6. 交换格式选型

| 格式 | 谁能打开 | 优点 | 问题 | 结论 |
|---|---|---|---|---|
| OTIO（OpenTimelineIO，ASWF 标准） | 达芬奇 18.5 起原生导入导出；Premiere 已正式支持导入导出（2024-10 起 beta）；Avid Media Composer 2025.6 完整支持 | 开放标准，有基金会维护；片段位置、出入点、多轨、转场、标记都覆盖；素材按引用 | Premiere 对外来 OTIO 的画幅 / 采样率可能要手调；最新版本 0.18.1（2025-11），核心库是 C++ / Python，JS 侧要实现时再查 | **首选** |
| FCPXML | Final Cut Pro；部分第三方 | Apple 官方格式 | 只覆盖 Apple 生态；FCP 专有转场 / 字幕 / 插件不跨软件 | 不做第一版；OTIO 插件里有 FCP XML 适配器，要时走那条 |
| FCP7 XML / EDL | 老格式，兼容面广 | 简单 | 信息少（EDL 基本只有剪切点） | 不做 |
| 剪映草稿 | 剪映 | 国内用户多 | 非公开格式；社区工具 pyJianYingDraft 说明剪映 6+ 已加密 `draft_content.json`，新版无法直接写；剪映能否导入 XML / OTIO 未查证 | **不做**（P0：不追非标准私有格式）；剪映能否导入 OTIO 记为 `unverified`，实现前实测 |

出处：
- [OpenTimelineIO（ASWF）](https://github.com/AcademySoftwareFoundation/OpenTimelineIO)；版本见 [piwheels](https://www.piwheels.org/project/opentimelineio)；采用情况见 [ASWF 2025-11 项目评审](https://tac.aswf.io/meetings/2025-11-12/OpenTimelineIO_ASWF_Project_Review_Nov_2025.pdf)
- [Premiere 发布说明](https://helpx.adobe.com/premiere-pro/kb/fixed-issues.html)、[Premiere OTIO beta 公告](https://community.adobe.com/t5/premiere-pro-beta-discussions/new-in-beta-otio-import-and-export/td-p/14937493)
- [DaVinci Resolve 18 手册 OTIO 一节](https://www.steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part1410.htm)
- [Remotion：export OpenTimeline](https://www.remotion.dev/docs/export-opentimeline)
- [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft)

## 7. 先查别人（★0）

| 出处 | 它怎么做 | 对我们哪个决定的影响 |
|---|---|---|
| 用户转来的文章（Sabba Keynejad / VEED） | 建议不重造时间轴，做好初剪再交专业软件 | **确认了** §5.2 砍 P2 合成器、§5.4② 做交换格式 |
| 同文章作者的产品（BaoCut） | 时间轴编辑器退居二线，默认只留预览 | **改了**：我们不照搬「默认隐藏」，因为 06-21 用户测试显示我们的用户要那一条轴（§4 第 3 条） |
| Codex 去掉代码编辑器（文章引用） | 去掉编辑器，保留 diff 审阅 | **确认了** §4 第 1 条：时间轴会退化成「预览 + 改了什么」，不会消失 |
| Alex Cooper 团队（文章引用） | 按风格拆小技能 + 资深剪辑师逐条点评训练 | **确认了** E3 之前先把 E2 做成结构派生；风格学习归后续技能库，不进本方向 |
| Premiere / 达芬奇 / Avid 都已原生支持 OTIO | 标准格式在主流剪辑软件落地 | **确认了** §6 首选 OTIO |
| pyJianYingDraft：剪映 6+ 草稿加密 | 社区逆向的私有格式被厂商关掉 | **改了** 09-09 方案 F' 的剪映草稿导出 → OTIO（拍板题 6） |
| [Descript：回滚 Underlord 的改动](https://help.descript.com/ai-assistant/revert) | Agent 改前自动存检查点，对话里一键 Revert；关掉项目后用版本历史 | **确认了** §5.0 选「直接改 + 检查点」 |
| [ChatCut 介绍（Product Hunt）](https://www.producthunt.com/products/chatcut-ai-video-editor)、[第三方评测](https://www.nemovideo.com/blog/video-tool-alternatives/chatcut-video-editor) | Agent 在可见时间轴上直接改，用户检查、手调、逐步撤销 | **确认了** §5.0 |
| [OpenChatCut](https://github.com/0xsline/OpenChatCut)；工具清单见 [../research/2026-09-09-agent-native-video-editing-landscape.md](../research/2026-09-09-agent-native-video-editing-landscape.md) | 写进真实轨道；undo / redo、命名版本；锁定片段不被卡点切 | **确认了** §5.0 检查点 + 锁住人手改过的片段 |
| [Kapwing 2026-05 发布说明](https://www.kapwing.com/help/kapwing-release-notes-may-2026/) | Kai 从「生成器」改成能直接改项目的剪辑助手 | **确认了** §5.0 |
| [VEED：Introducing AI Agent](https://veed.io/blog/introducing-ai-agent-by-veed) | 打字说需求，Agent 直接执行，时间轴保留 | **确认了** §5.0 与 §4 第 1 条（时间轴不消失） |
| [Premiere AI Assistant（ProVideo Coalition）](https://www.provideocoalition.com/premiere-ai-assistant/)、[Automation Agent for Premiere](https://digitalproduction.com/2026/09/04/automation-agent-premiere-timeline-aware-ai-workflows/) | 官方助手在工程里直接执行；第三方加了权限系统 | **确认了** 花钱 / 不可逆另加确认这一层 |
| [Figma agent](https://www.figma.com/blog/the-figma-agent-is-here/) | Agent 和人在同一个文件里同时干活，改动直接落进共享文件 | **确认了** §5.0 一份数据、直接落盘 |
| Cursor 论坛：[拒绝一条连带全拒](https://forum.cursor.com/t/rejecting-a-single-edit-rejects-all-edits-of-that-file/138062)、[手改后审阅显示旧改动](https://forum.cursor.com/t/all-changes-show-stale-agent-changes-and-disregard-user-changes/144331) | 「先提议后批准」在人中途手改时容易错乱 | **确认了** §5.0 不走提议派；冲突按片段判 |
| [CHI 2026：多用户 + AI Agent 协作写作](https://arxiv.org/html/2509.11826v2) | 指出协作场景里还没有成形的 AI 交互范式；原型让 Agent 的任务和回答对所有人可见 | **确认了** §5.0 历史里标明谁改的 |
| [Agent 原生剪辑版图调研](../research/2026-09-09-agent-native-video-editing-landscape.md)：Timeline Studio | Agent 标注层 + 应用前的语义 diff 预览 | **确认了** §5.4③ 直接用 09-09 的 G'，不另起 |

## 8. 拍板题（每题带默认答案）

| # | 问题 | 默认 |
|---|---|---|
| 0 | 人和 Agent 共改时间轴走哪派？ | **已拍板（2026-10-28）**：直接落盘、留检查点、随时回滚（§5.0） |
| 0b | 除花钱和不可逆以外，还有什么剪辑操作要先确认？ | 没有；删片段也不确认，靠一键回滚兜底 |
| 1 | 砍掉 uplift 的 P2 合成器与后端评估？ | 砍 |
| 2 | 时间轴界面冻结（只修 bug，不加新交互）？ | 冻结 |
| 3 | 时间轴界面现在要不要默认收起、只留预览？ | 不收，等 E2 补完后看使用数据再定 |
| 4 | 三件事的顺序：E2 补声音 → OTIO 导出 → 预览划区间？ | 按这个顺序 |
| 5 | 交换格式只做 OTIO，不做 FCPXML？ | 是 |
| 6 | 09-09 方案 F' 要做剪映草稿导出（理由：国内用户面、OpenChatCut 用它抢用户），本文建议改成 OTIO。剪映 6+ 已加密草稿文件，第三方写入靠逆向，随时会被关；代价是国内只用剪映的用户暂时接不住。改不改？ | 改成 OTIO；同时实测剪映能否导入 OTIO / XML，能就顺带覆盖，不能就记为已知缺口 |
| 7 | 09-05 合同「另立项」里的变速、关键帧、自由加轨、Slip、多版本时间轴，是否正式不做？ | 不做；自动字幕保留，归 E3 |
| 8 | E2 的配音默认开还是关？（连带花钱：TTS 按量计费） | 默认关，用户在审粗剪时点了才生成，按项确认 |
| 9 | 配乐来源：生成还是用户自己的素材库？（连带花钱） | 先用素材库里的音频；生成配乐作为第二步 |
| 10 | 什么时候开工？ | 0.24 发版后；本 PR 按 0.24 期间的规矩开着不合 |

## 9. 拍板后怎么落

- 本文状态改 🚧，同批改 [2026-08-28-editing-engine-uplift.md](2026-08-28-editing-engine-uplift.md)（§5.2）、09-05 剪辑面合同（§5.2 加注，并按代码核实后更新它的状态行）、09-09 方案 F'（按拍板题 6 改）和 `docs/ARCHITECTURE-NOW.md`「生产流程引擎」「自动剪辑总纲」两行（§3 的更正）。
- §5.4 每件事各开一条线、各写一张设计卡：①花钱类，9 格全填；②数据格式类，先写「规范链接 / 我们的偏差 / 偏差理由」；③新界面，先出 Claude Design 画布样张。
- 每条线的真实任务都用登记过的真素材跑：一条 6–10 镜的 AI 短片，从分镜到粗剪到导出 OTIO，再在达芬奇里打开核对片段位置和出入点。

## 10. 回滚

本文是方向文档，不动代码。不拍板就关 PR；拍板后若方向要改，改本文状态为 ⛔ 并指向新方案。
