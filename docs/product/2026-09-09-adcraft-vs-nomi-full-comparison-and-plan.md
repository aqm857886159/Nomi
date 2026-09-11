# AdCraft vs Nomi：完整对比 + 差距清单 + 可执行方案

> 日期：2026-09-09 · 前置文档：[AdCraft 竞品差距分析](2026-09-09-adcraft-competitor-gap-analysis.md)（本篇是其完整版，含在飞 PR 综合考量）
> 对象：[GML-MMGroup/AdCraft](https://github.com/GML-MMGroup/AdCraft)（2026-07 开源，1629 commits，广告垂直 Agentic 视频平台）
> 我方现状依据：`docs/ARCHITECTURE-NOW.md`（2026-08-31 基线）+ 逐文件实核 + **8 个在飞 PR 全文读取**（#646 / #658 / #659 / #656 / #619 / #662 / #664 / #643）
> ⚠️ 本文档所有「现状」均带锚点；与旧文档冲突处以锚点为准（ARCHITECTURE-NOW 关于 assemble 的描述已过期，见 §3-G1）。

---

## 一、结论摘要（先读这段）

1. **底座同源，不落后**：AdCraft 提交记录明确 "run Pi agent runtime"——它也跑 pi。我们刚切 pi 0.85.1 `AgentHarness`，运行时选型同一条被验证的路线。
2. **差距不在「有没有」，在「纵深和接通」**：流水线骨架（productionRun 九阶段）、拆解引擎（#259 九成熟）、找参考（#619 在飞）、工具契约规范（重做方案 §3）我们全都有或在做；AdCraft 赢在**全部接通并交到用户手里**，我们的关键件散落在「影子期 / 在飞 PR / 已废弃方案的替代路线」里没汇流。
3. **#646 是全局瓶颈**：agent 阶段 4 原子切换三轮真实 C0 全部卡在阶段 02（分镜回合 0/1），暴露的不是模型能力问题，是**我们的工具契约对模型不友好 + 审批卡 UI 摩擦**——这恰好就是 AdCraft「对话控制创作」做得好的那部分。推过 #646 = 补上 G1（编排纵深）的一半。
4. 本文档给出 **8 个方案（A–H）**，每个带落点 file:line、依赖、分期、验收门，按 P0/P1/P2 排序（§5 路线图）。

---

## 二、完整能力对比矩阵

| 能力域 | AdCraft | Nomi 现状（锚点） | 判定 |
|---|---|---|---|
| **产品形态** | Web + 后端 + Docker，云上协作 | Electron 桌面，本地优先，素材/生成物全本机 | 各有取向，Nomi 结构性优势（隐私/成本） |
| **一句话→成片** | ✅ 全自动跑完整条链，分阶段并行 | 引擎在：playbook 九阶段（`electron/productionRun/productionPlaybooks.ts:30`）；**agent 真跑在阶段 02 失败**（#646 三轮 C0，分镜回合 0/1，无 MP4） | **差距（P0）** |
| **流水线可编辑** | 增删/重排步骤、单步运行、任意节点继续、已满意素材保留 | `productionRun` 有暂停/恢复（`productionRunResume.ts`）、审批回执、幂等门；**无 agent 侧「跑阶段/从节点续跑」动词** | **差距（P0，方案 C）** |
| **Agent 分工叙事** | 9 个具名 agent（创意总监/编剧/产品视觉/角色/场景/分镜/导演/声音/合成） | capability 工具组（`electron/harness/agentChatPolicy.ts:35`），架构更通用但无角色感知 | 感知差距（P2，方案 C 附带包装） |
| **对话控制创作** | 改什么/怎么改、生成候选、适时请求确认 | 阶段 4 切换 PR #646 在飞：真实 C0 暴露**首调 schema 错、媒体档位遗漏 8/8、中文漂移、审批卡需逐个展开、思考文本挤占阅读区**（6 类摩擦） | **差距（P0，方案 A）** |
| **真实进度状态** | 排队/生成/待确认/失败/跳过，多阶段并行可见 | #658（C-1 诚实过程反馈）在飞：十执行阶段→五段语汇，统一状态胶囊；幽灵片段留 C-2 | 接近持平（#658 合并后） |
| **生产级角色资产** | 三视图转面+面部+服装结构+配饰+色板 | 角色/场景固定已有（`docs/design/2026-06-06-character-scene-fixation-design.md`）；声明式参考槽一等数据（`electron/shared/videoCapabilities/types.ts:31`，六种 kind） | **差距（P1，方案 D）** |
| **生产级场景资产** | 定场/远中近景/多机位/过渡镜头世界观板 | 多镜头连续性方案在飞过 P4-S5（`docs/superpowers/plans/2026-08-24-p4-multishot-continuity.md`） | 差距（P1，方案 D） |
| **找对标素材** | ❌ 无（直接上传参考） | **#619 在飞**：TikHub 抖音/小红书/TikTok 广告库搜「正在跑的素材」，平台级设定+evidence[] 渲染 | **Nomi 领先** |
| **拉片（视频拆解）** | ✅ 招牌功能：拆镜头语言/节奏/字幕音效同步→转可编辑工作流 | 引擎九成熟（`electron/video/deconstructVideo.ts`，#259：本地 ffmpeg 切点+一镜多帧+whisper 转写归属）；面板 v1 方案已按 2026-09-05 拍板改道；**未接线交付** | **差距（P0，方案 B）** |
| **视频复刻（换素材重制）** | ✅ 结构相似但全新 | #232 已设计（复刻 5 秒→一句话改→候选替换→RecreationApprovalEnvelope），**押 M 线后未开工** | **差距（P1，方案 B-P2）** |
| **声音链路** | 声音总监：BGM/音效/旁白/节奏成体系 | clip 音频参数已落盘进导出（`src/workbench/timeline/clipAudio.ts`、FFmpeg mixdown）；**对白→TTS→音轨编排链路整条缺** | **差距（P1，方案 E）** |
| **剪辑导出** | 可编辑时间线：排序/裁剪/字幕/音频，渲染成片 | FFmpeg filtergraph：视觉/音频/文字三链+转场 blend+mixdown+导出验证回执（`electron/export/ffmpegFiltergraph.ts`） | **Nomi 更扎实** |
| **候选版本/回滚** | 每次重生成=候选版本，预览/接受/拒绝/切换/回滚；素材库带版本溯源 | 采纳桥 Proposal 幂等键（`adoptStoryboardBatch.ts`）；素材库无版本语义（history backlog 2026-06-15 未清） | 差距（P2，方案 F） |
| **模型接入** | 封闭平台白名单（即梦/可灵/海螺/豆包/通义/混元/讯飞），统一配置中心 | 66 条认证台账+APIMart/Kie 双核+任意 OpenAI 兼容/中转粘贴即用+ComfyUI 工作流直导+运行前缺件预检 | **Nomi 领先** |
| **被外部 agent 调用** | ❌ 做不了 | MCP 生成语义 11 工具（`electron/capabilityCore/mcpToolCatalog.ts`）+ #646 后 `nomi_canvas_edit` typed schema 公开 | **Nomi 领先** |
| **经验沉淀/自改进** | 未见对等机制 | 证据制经验闭环（`electron/experience/`，四段证据才激活） | **Nomi 领先** |
| **体验质量保障** | 未见对等机制 | #662 体感回归机制（夜跑扫描+基线棘轮）+ #664 十维体验量表在飞 | **Nomi 领先** |
| **素材/资产分发** | 推荐角色/场景资产包（Releases 下载）+ 行业案例展示墙 | 无资产包、无案例墙 | 差距（P2，方案 H） |
| **预设创意流** | 产品展示/游戏买量/电商种草 + Style Skill | Skill Pack v2（`docs/skill-pack-format.md`）+ 分镜表 genre profile；广告垂直预设浅 | 差距（P2，方案 G） |

---

## 三、差距清单（定级 + 与在飞 PR 的关系）

> 级别定义：P0 = 挡住「一句话到成片」主叙事；P1 = 补齐后产品上一个量级；P2 = 增强/营销。

### G1【P0】端到端编排没接通 —— 瓶颈就是 #646
- **实核更正**：`ARCHITECTURE-NOW.md` 说 assemble「目前只有一行」**已过期**。`productionRunDriverOps.ts:625-638` 显示 assemble 现在真实产出 timeline artifact（粗剪）：跑 `run.stage assemble` → 落 `artifact-timeline` → completed，QA 判分后有完整测试链（`productionQaVerify.test.ts:45`：样片门批准→续跑剩余镜头→qa→assemble→粗剪）。
- **真正的断点**：agent 真跑推不过阶段 02。#646 三轮 C0 失败根因：
  1. **工具契约对模型不友好**：`nomi_storyboard_write` 首调缺 `operation` 字段被 schema 拒；旧 main 的 `nomi_generation_plan` schema 缺顶层 `type: object` 直接 HTTP400；模型保存 8 镜时 **8/8 遗漏 `modelKey`/`params.resolution`**（媒体档位没被工具契约强制）。
  2. **UI 摩擦**：审批卡只列 #1–#8 需逐个展开辨认；长篇思考/anchor/carrier 文本挤占阅读区；模型名截断成 `gpt-5-…`/`DeepS…`。
  3. **语言漂移**：指定中文标题被改成英文。
- 这三条全部对应重做方案 §3「模型优先的工具契约」——schema 硬规则、错误可自纠、容忍族。**#646 的合并门失败不是运气，是 §3 还没收敛到 storyboard 族工具上的证明。**

### G2【P0】拉片复刻闭环没合龙 —— 三个零件都在，缺装配
- 前半（找对标素材）：#619 在飞，抖音/小红书/TikTok 广告库检索已实现。
- 中段（拆成结构）：`electron/video/deconstructVideo.ts` 引擎九成熟；拆解面板 v1 方案 ⛔ 废弃后按 2026-09-05 consolidation 改道，**新交互还没立新方案文档**。
- 后段（换素材重制）：#232 复刻设计（候选替换+审批链）押 M 线后未开工。
- AdCraft 把这整条做成了招牌功能；我们每段都领先或持平，**唯独没合龙**。

### G3【P1】生产级角色/场景资产体系缺失
- AdCraft 角色资产=完整规范（三视图/面部/服装/配饰/色板），场景资产=多机位世界观板。我们有参考槽声明式体系（六种 kind、每槽带 kind/label/min/max）和角色/场景固定，但没有「资产包规范」这层语义。

### G4【P1】声音链路只有剪辑没有编排
- 对白只落字幕（`adoptStoryboardBatch.ts:79`）；无「脚本对白→TTS→音轨→节奏对齐」生成链。MiniMax/ElevenLabs 供应商已接，缺的是编排层。

### G5【P2】候选版本/回滚
- 重生成直接覆盖，无候选层；素材库无版本溯源。

### G6【P2】广告垂直预设 + 角色化包装
- Skill Pack 承载预设流（不写死代码）；9 角色叙事用包装补，不动架构（P4）。

### G7【P2】案例墙 + 官方资产包
- 营销短板，非工程短板；等 B 方案合龙后用真实成片填充。

---

## 四、可执行方案（A–H）

> 每条方案按 R4 写：做什么 / 落点 / 依赖 / 验收门。开任何一条前先过 P5（读真实外壳+出样张拍板），本文档只给作战地图不给实施细节替代。

### 方案 A【P0】把 #646 推过合并门 —— 最高优先，一切都排在它后面

**做什么**（三刀，全部在 #646 或其测试分支内完成，不开新战线）：

| 刀 | 内容 | 落点 |
|---|---|---|
| A1 工具契约收敛 | 对 storyboard/generation 族工具执行重做方案 §3 七维检查表：① `operation` 类路由字段从必填改为**按动作派生或给模型默认值**；② `modelKey`/`params.resolution` 等媒体档位在 schema 里**带 enum 或从项目默认 derive**（模型漏填时容忍族兜底+回执提示，而不是静默存空）；③ 错误回话改成模型可自纠的人话（含缺什么字段、合法值是什么）；④ schema 语言统一（消灭 `type: None` 这类顶层错误） | `electron/harness/tools/`、`electron/shared/agentCapabilities/canvasWrite.ts`、`laneCanvasTools`（typed 那份已 extend，收敛后旧份删除即随 #646） |
| A2 审批卡与阅读区 | 六类摩擦逐条修：审批卡默认展开摘要（镜号+缩略图+档位一行看全）；思考/anchor/carrier 文本折叠进「过程」区默认收起；模型名不截断、显示档位徽标 | `src/workbench/ai/lane/`（laneViewModel + v4 组件），owner = agent-panel |
| A3 语言漂移 | 项目/任务级「输出语言」约束注入系统段；验收判据加入 C0 断言（标题与答复语言一致） | `electron/agentLane/` system prompt 装配处 |

**依赖**：#659（¥50 预算+180s 等待）已就绪；#658 的诚实反馈能让 A2 有统一语汇可复用。
**验收门**（=#646 既有合并门，不放松）：L2 回放全绿（语料 138 回合已是 green-short-of-corpus，补到 200）+ 打包 C0 真短片**一次通过**（出 MP4、13 截图全、R30 首调与回合成功率给正式数字）。
**注意**：三轮已累计实付 ≈¥0.19，预算边界纪律（全局 ¥50 账本硬拦）照旧。

### 方案 B【P0】拉片复刻闭环合龙 —— Nomi 版差异化，不抄 AdCraft

**为什么是 Nomi 的活**：AdCraft 从「上传参考」开始；我们从「**找到正在跑的爆款**」开始（#619）→「拆懂结构」（#259 引擎）→「落成可编辑画布」（现役画布写入）→「换素材重制」（#232）。前两段 AdCraft 没有，这是差异化叙事：「**对标素材库 + 拉片**」而非「拉片」。

**分三步**：
- **B1（P0）拆解面板重立方案并交付**：按 2026-09-05 consolidation §3 的拍板结论写新方案文档（替代 ⛔ 废弃的 2026-09-01 版），样张先拍板。引擎契约已定（`DeconstructVideoPayload/Result`，`visionFailed`/`carriedOver` 诚实标记），面板只消费。验收门沿用废弃方案 §3.4 的五条（契约对账/真实任务 E2E/诚实态走查/控件契约/五门绿），E2E 旅程改为：#619 搜到对标 → 落进项目 → 拆解 → 勾镜落画布 → 起稿。
- **B2（P1）拆解结果→可编辑工作流**：镜头结构表一键转「分镜表节点」（`docs/plan/2026-09-07-storyboard-table-node.md` 的节点形态），每镜提示词可改、可整组喂参考重生成——这一步完成「拉片→我的版本」的 AdCraft 等价物。
- **B3（P2）局部复刻**：#232 的复刻 5 秒/候选替换/RecreationApprovalEnvelope 接入 M 线（=#646 后的 lane）审批/预算/撤销链。**不提前做**，等 A 方案把管线动词打通。

### 方案 C【P0→P1】productionRun 管线动词暴露为 agent 工具

> ⚠️ **2026-09-09 第二轮实核修正**：`electron/harness/tools/productionRunDescriptors.ts:12-96` 显示管线动词**已全套暴露**（start/get/subscribe/control(pause/resume/cancel/set_trust)/decide/revise/review/materialize）——本节原判「没有 agent 工具暴露它」基于过期基线，作废。修正后本方案剩余射程：① C0 真跑把这套动词推过阶段 02（见方案 A，#646 三刀不变）；② 步数上限重审（`agentChatV2.ts:102` 的 24/8/1 对全流水线长任务偏紧，管线类 capability 单独设档）；③ 前端进度复用 #658 五段语汇投影阶段状态；④ 角色化包装（纯 UI 投影）。时间轴侧的 agent 写入契约另见 [agent 原生剪辑方案 A'](../plan/2026-09-09-agent-native-editing-plan.md)。

**做什么**（#646 合并后立即排）：
- 新增 lane 工具（按 capability `canvas-agent` 扩展）：`run_production_stage`（跑指定阶段）、`continue_from_stage`（从任意节点续跑，跳过已完成）、`propose_candidate`（把重生成结果作为候选提交确认而非直接覆盖）。全部走既有 `productionRunControl` / `productionRunResume` 的领域函数，**不写第二套状态机**（P1/P4）。
- 步数上限重审：`electron/ai/agentChatV2.ts:102` 的 24/8/1 对全流水线长任务不够，管线类 capability 单独设档（如 48 步），按 R22 配验证。
- 前端进度复用 #658 的五段语汇投影 productionRun 阶段状态，画布上显示真实阶段（对齐 AdCraft 的排队/生成/待确认/失败/跳过）。
- 角色化包装（P2 尾巴）：capability → 具名 agent 卡片（编剧/分镜/导演/合成）纯 UI 投影，不改工具组结构。

**验收门**：真实任务「一句 brief → agent 跑完 brief→…→assemble 出粗剪 MP4」E2E 通过（R16），人工走查确认「从第 3 镜继续跑」不改已满意镜头。

### 方案 D【P1】角色/场景资产包规范

**做什么**：在现有素材库资产上叠「资产规范」语义，不建第二套库（P1）：
- 角色资产 = 槽位化规范：正/侧/背三视图、面部参考、服装细节、配饰、色板——**每槽就是一个 `ArchetypeReferenceSlot`**（kind=image_ref + roleName），复用声明式参考槽渲染（`AssetReference.tsx:69`）与请求映射（`archetypeMeta.ts:688`），生成时自动带上正确槽位。
- 场景资产 = 定场/远中近/多机位镜头组，同样槽位化。
- 「角色库/场景库」入口挂在素材库既有分类下（`libraryDiscovery.ts` 不动）。
**验收门**：一个角色资产包跨 3 镜生成，人物身份一致性人眼走查通过（R13）；资产包可导出/导入（对齐 AdCraft 的 Releases 资产包形态，为方案 H 铺垫）。

### 方案 E【P1】对白→TTS→音轨编排

**做什么**：
- 分镜/脚本的 `meta.dialogue`（现只落字幕）增加「生成旁白」动作：按镜头时长选 TTS 供应商（MiniMax/ElevenLabs 已接，走既有认证），生成音频落素材库 → 自动落 audio 轨、起点对齐对应镜头、时长超限提示。
- BGM 先不做智能编排（AdCraft 也是模板级），v1 = 手选 BGM + 既有 clip 音频参数（`clipAudio.ts` 的 dB/fade 已进导出）。
**验收门**：8 镜脚本一键生成全部对白音频并落轴，导出 MP4 人声清晰、与画面镜头对齐（真实 E2E，R16）。

### 方案 F【P2】候选版本/回滚进素材库

- 资产元数据加 `lineage`（来源/生成参数/被谁引用）+ 重生成走「候选→确认」两段式（复用 #232 的候选语义和采纳桥幂等模式），素材库显示版本分支。
- 验收门：同节点重生成 3 次产生 3 候选，切换/回滚后画布与素材库一致，撤销链完整。

### 方案 G【P2】广告垂直预设流（Skill Pack 承载）

- 用 Skill Pack v2 写三条预置 playbook 模板：产品展示 / 游戏买量 / 电商种草（阶段结构、每阶段提示词要点、验收清单），选择场景即套用——**纯数据技能，零产品代码**，正好验证书包格式的表达力。
- 验收门：零代码新增一条预设流并真实跑通一个品类。

### 方案 H【P2】案例墙 + 官方资产包

- A/B 方案合龙后产出真实成片：官网/B 站「Nomi 案例」页（对标 AdCraft 的行业案例墙）；发布首个官方角色/场景资产包（Releases + sha256，形态照抄 AdCraft 的分发做法）。
- 依赖：B 合龙（要有真实成片）、D（要有资产包）。

---

## 五、路线图（依赖排序）

```
方案 A（#646 过门）─────────────┐
   │                            │
   ├─→ 方案 C（管线动词暴露）──┼─→ 方案 B3（局部复刻）→ 方案 F（候选版本）
   │                            │
方案 B1（拆解面板）→ B2（结构转工作流）─┘
#619（找参考，在飞）┘
方案 D（资产包）──→ 方案 H（案例墙+资产包发布）
方案 E（TTS 编排）   方案 G（预设流，随时可插）
```

| 批次 | 内容 | 判据 |
|---|---|---|
| **第一批（现在）** | A（#646 三刀）+ B1 立方案出样张 + #619/#658 合并 | #646 合并门绿 |
| **第二批** | C（管线动词）+ B2（拆解→工作流） | 一句 brief → agent 跑出粗剪 MP4；对标视频→拆解→我的版本 E2E |
| **第三批** | D + E | 资产包跨镜一致；对白一键落音轨 |
| **第四批** | B3 + F + G + H | 复刻审批链、候选版本、预设流、案例墙 |

**原则**：第一批结束前，不开任何新战线。所有 P2 的前提是 P0 合龙——AdCraft 的 1629 commits 里最值钱不是功能数量，是**全链接通后没有任何一环是演示品**。

---

## 六、不做 / 不抄清单

1. **不抄 AdCraft 代码**：个人非商业许可（2026-08-10 起），能力设计可借鉴，代码一行不碰。
2. **不建第二套流水线/状态机**：productionRun 就是唯一引擎，管线动词走工具暴露（P1）。
3. **不做 9 个真的独立 agent 实例**：角色化是 UI 投影，底层保持 capability 工具组（P4——为不同角色写两套 UI/运行时是并行版）。
4. **不做智能 BGM 编排**（v1 不做）：手选 BGM + 既有音频参数够用，先补对白 TTS 这条硬链路。
5. **不用 Docker/后端**：桌面本地优先是结构性差异，不因对标而云化。

---

## 附：证据来源

### 附二：AdCraft Agent 架构深挖（源码实核，2026-09-09）

**「9 个 Agent」是产品叙事，架构上只有一个。** 实核 `apps/api/agent/src/prompts/agents.ts`：

```
"You are the AdCraft Video Agent, the sole production Agent identity
 for video advertising cognition."
"Perform only the current operation selected and validated by Python.
 Do not choose another operation, capability, Agent identity..."
"Do not invent platform state, mutate Canvas topology, publish Nodes or
 Bindings, call media providers, access files, use a shell, or invoke
 hidden tools."
```

真实架构 = **确定性 Python 状态机 + 单一 pi 驱动的「结构化输出工人」**：

| 层 | 实现 | 职责 |
|---|---|---|
| 编排真相源 | Python 后端（`apps/api`，Alembic 迁移可见域模型：event store、workflow authoring、agent_runs+structured validation、canvas_authoring/command_control/editing、progressive_creative_session、guided_actions/proposals、continuation_outbox+superseded_state、provider_model_registry、video_parameter_provenance、auto_media_execution） | **Python 选定并校验每次操作**，拥有画布拓扑/素材库/供应商调用/状态机全部真相；outbox 模式做续跑 |
| LLM 工人 | `apps/api/agent/`（Node/TS）跑 **pi `@earendil-works/pi-ai` 0.81.1（带自家补丁）**，无工具调用——agent 被 prompt 明令禁止调媒体供应商/碰文件/用 shell/隐工具 | 每次只做 Python 指定的**一个 operation**，经 structured transport 只回 typed contract；输出包 Markdown = 违规 |
| 角色 | 「9 Agent」= prompts/registry 里 9 套 persona + 11 个角色 Skill（`skills/video_agent_*/SKILL.md`：script_authoring、storyboard_design、scene_design、character_design、bgm_direction…），**每次请求只挂一个 trusted Skill** | 方法层提示词模块 |
| 风格 | 50+ 版本化 Style Skill（`video-skills/<名>/1.0.0/references/`），只是 **advisory projection**——policy 明文规定风格**不许改** Node 类型/候选数/输出 schema/供应商参数/时长画幅权威/参考白名单 | 纯装饰层，动不了契约 |
| 契约 | `contracts/agent-capabilities.json` 单 agent `video_agent` 约 50 个 operation（`propose_X_options`/`revise_X_options`/`materialize_*`/`execute_canvas_*`/`*_prompt`），**codegen 生成 typed 代码**（`generate-agent-capabilities.ts`） | 契约即边界 |
| 容错 | `structuredRepairPrompt`：**Python 拒绝后只许修一次，第二次拒绝即终局**；配 `protocol-validator.ts` / `provider-conformance.ts` | 自纠一轮就死，保确定性 |

**与 Nomi 的哲学对照**（这解释了双方所有体验差异）：

| | AdCraft | Nomi |
|---|---|---|
| LLM 地位 | 无工具的「认知函数」，Python 牵着走 | 有真实工具（画布写/时间轴/媒体读）的行动者，capability 作用域守卫 |
| 确定性来源 | Python 状态机全拥有 | 引擎拥有阶段/门/预算；LLM 在工具边界内自主 |
| 代价 | 交互死板：每个意图都要先有 Python operation；改一个字也要走 proposal 流 | 灵活；但**工具契约必须对模型极友好，否则当场卡死（#646 C0 三轮失败即证）** |
| pi 版本 | 0.81.1 + 自家 patch（动上游源码） | 0.85.1 全家桶，无 patch（更新、且尊重上游） |

**对我方方案的三个直接影响**：
1. **方案 A 更站得住**：AdCraft 用「无工具+结构化运输+一次修复」换确定性；我们的路线是「有工具+契约友好」。C0 失败证明我们的契约层还没到 AdCraft 那种「模型想错都难」的收敛度——§3 七维检查表就是往这个方向走，不必照抄它的无工具模式（会牺牲 Nomi 的交互灵活性，也违背 P4）。
2. **方案 C 的管线动词**：AdCraft 的 operation 命名法值得抄——`propose_X_options` / `revise_X_options` / `materialize_*` 三段式（提案→修订→物化）正好映射我们的「候选版本」语义，`run_production_stage`/`continue_from_stage`/`propose_candidate` 可沿用这个动词结构。
3. **角色化包装再降级**：AdCraft 的「9 Agent 团队」实际是 1 agent + 9 套 persona 提示词 + 11 个 SKILL.md——和我们「capability 工具组 + Skill Pack」的结构**本质相同**。方案 C 尾巴的角色化包装成本更低了：纯 prompt 层 + UI 卡片，零架构改动。

### 附三：方案级深挖实核（源码逐条验证，2026-09-09 第二轮）

> 1628 个文件全列清单 + 逐文件抓取。每条方案落到他们真实 file:line。

**方案 A（工具契约）——他们的实现**：`apps/api/agent/src/` 里 `pi-structured-transport.ts` / `protocol-validator.ts` / `provider-conformance.ts`；Python 侧 `agent_structured_validation_audit.py` 枚举 `_PRE_SUBMISSION_FAILURE_CODES`（`agent_context_input_missing`、`agent_model_capability_mismatch`、`agent_operation_not_allowed`…约 10 个预提交失败码）+ `durable_pi_run.py` 的 `_SAFE_AUDIT_IDENTITY_FIELDS`（审计只留白名单元数据）+ `_TERMINAL_STATUS_BY_EVENT`。契约从 `contracts/agent-capabilities.json` **codegen 成 typed 代码**（`generate-agent-capabilities.ts` + `scripts/generate_agent_contracts.py`）。**可借**：预提交失败码分类表 + 白名单审计字段模式；我们的 §3 收敛可对齐这个成熟度。

**方案 B（拉片复刻）——重大诚实发现：开源仓库里没有实现**。全 1628 文件 grep `clone|deconstruct|replicate|remake|analyz`，web 与 api 侧均无对应代码；`agent-capabilities.json` 约 50 个 operation 里也没有对标视频分析类操作。README 的招牌功能「视频克隆/拉片」**在开源 drop 中不存在**（可能闭源保留或未交付）。**结论：我们 B 方案（#619 找参考 + #259 拆解引擎 + 复刻审批链）合龙后，在开源赛道直接越过他们的交付物。**

**方案 C（管线动词）——他们的编排真实形态**：`services/specialist_agents.py:15` 的 `SPECIALIST_BY_NODE_TYPE` 字典把**画布节点类型**映射到 6 个专家（script→script_writer、character-generation→character_designer、scene→scene_designer、storyboard→storyboard_artist、storyboard-video-generation→video_director、bgm→sound_director），经 `StructuredGenerationRuntime` 调用——「选专家」是节点类型查表，不是 LLM 路由。续跑 = `agent_canvas_continuation_worker.py` + `continuation_lease.py` + `fenced_lease.py`（围栏租约防并发）+ `continuation_outbox`。决策 = `agent_canvas_next_action.py` + `next_action_dispatch.py` + `command_replan.py`。**可借**：围栏租约模式（我们 productionRun 已有幂等/锁，补 fenced lease 语义即可）；「节点类型→专家」查表证实角色化是纯投影，方案 C 尾巴成本更低。

**方案 D（资产体系）**：仓库里只有 demo 图（`assets/Character_Assets_demo1-6.png`）；真正的资产机制是**引用策略服务栈**：`agent_canvas_character_occurrence_authority.py`（角色出场权威）、`character_reference_prompt_policy.py`、`role_reference_policy.py`、`reference_semantics.py`、`v2_shot_reference_planner/resolver.py`、`v2_reference_bundle_builder/delivery/audit.py`、`product_upload_multiview_compiler.py`（产品多视图编译！）。**可借**：「角色出场权威」= 同角色跨镜出现时由服务强制同一参考包，不是靠提示词自觉；我们的参考槽体系缺的就是这层服务端强制。三视图等规范在闭源资产包里（Releases 分发）。

**方案 E（声音）**：BGM 链 = `video_agent_bgm_direction` SKILL（只出文字方向：情绪/节拍结构/留白给旁白）→ `propose_bgm_options` op → `tools/volcengine_pure_music.py` + `tianpuyue_pure_music.py`（两家纯音乐源）+ `bgm_provider_factory.py`。合成 = `tools/ffmpeg.py` + `media_composition.py` + `media_subtitles.py`。policy 明文「不加旁白/歌词除非契约要求」——**旁白 TTS 链路他们也没有成体系**，我们的方案 E 做完即持平或领先。

**方案 F（候选/回滚）**：`agent_canvas_capability_supersession.py` + `supersession_repair.py`（能力替代语义）+ `orphaned_proposal_repair.py`（孤儿提案修复）+ `workflow_asset_history.prepare_generated_revision_candidates`（生成修订候选）+ DB 迁移 `add_continuation_superseded_state`。**他们的「候选版本」= revision candidates + supersession 状态机**，比我们只有采纳桥幂等键深一层。方案 F 可对标这套语义命名。

**方案 G（预设流）**：`services/script_beats.py` —— **硬编码 6 拍广告骨架**（钩子→揭示→利益演示→社交证明→CTA→补充证明，按目标时长均衡分配秒数，模板含 scene_intent/visual_action/product_action/spoken_or_on_screen_text 四字段）。LLM 只在骨架上填充。+ `role_prompt_recipes.py` / `media_recipes.py` / `agent_canvas_video_skills.py` + `style_activation.py`。**可借**：「确定性骨架 + LLM 填充」——我们的 Skill Pack 预设流应该先给每类广告写死节拍结构，比纯提示词描述「风格」可靠得多。

**修正记录**：前文「50+ 版本化 Style Skill」实际为 `apps/api/agent/video-skills/` 下约 40 个目录（每个 1.0.0 + references/），量级不变。

### 附一：其余证据来源

- AdCraft：README（2026-09 版）、仓库提交记录（"run Pi agent runtime"、里程碑时间线）
- Nomi 现状：`docs/ARCHITECTURE-NOW.md` + `electron/productionRun/productionPlaybooks.ts:30` + `electron/productionRun/productionRunDriverOps.ts:625-638` + `electron/shared/videoCapabilities/types.ts:31` + `src/workbench/timeline/clipAudio.ts` + `electron/video/deconstructVideo.ts`（#259）
- 在飞 PR（2026-09-09 全文读取）：#646（阶段4切换+三轮 C0 失败实录）、#658（C-1 过程反馈）、#659（C0 预算）、#656（磁吸连线）、#619（TikHub 找参考）、#662（体感回归）、#664（体验量表）
- 历史方案：`docs/plan/2026-09-07-agent-runtime-rebuild.md`（§3 工具契约 / §6 阶段）、`docs/plan/2026-09-01-video-deconstruction-v1.md`（⛔ 废弃，改道依据 2026-09-05 consolidation）、#232 视频复刻设计
