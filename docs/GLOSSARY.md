# 术语表 — 同一个东西的多个叫法

> 状态：🚧 长期维护
> 最后核对：2026-09-10

## 这份文件为什么存在

2026-08-27：一个 AI 要做「自动剪辑」，搜了 `自动剪辑 | auto-edit | autoEdit | rough-cut | roughcut`，**一条都没命中**已批准的总纲——因为那份文档从头到尾叫它「**AI 剪辑**」「**剪辑计划**」「**EditPlan**」「**E2**」「**剪辑段**」。于是它重新发明了一套已经存在的架构，还起了不同的名字。

搜不到 ≠ 不存在。**动手前，先来这张表把你要搜的词翻译成仓库实际用的词。**

## 怎么用

1. 你脑子里的词 → 查左列 → 拿到**规范名**和**去哪找**。
2. 左列没有你的词 → 说明这是个新词，**做完顺手加一行**（这张表靠使用者长大）。
3. 加词纪律：规范名**只能有一个**；同义词全部并到同一行，不要另起一行。

---

## 剪辑 / 时间轴

| 你可能搜的词 | 规范名 | 去哪找 |
|---|---|---|
| 自动剪辑 · auto-edit · autoEdit · 一键成片 | **AI 剪辑**（三步：E1/E2/E3） | `docs/superpowers/plans/2026-08-24-unified-agent-master-plan.md` §5.1 |
| 粗剪 · rough cut · roughcut | **E2 结构化粗剪**（≠ `2026-06-21-preview-rough-cut-overhaul.md`，那份讲的是**预览区手感**，不是自动剪辑） | 同上 |
| EDL · edit decision list · 剪辑决策 | **EditPlan**（一组类型化时间轴操作，每条带影响范围） | 同上 |
| 剪辑提案 · 提案卡 · propose_edit | **剪辑计划卡** | 同上 |
| 采纳 · 写回 · 落轴 · adopt | **采纳桥** | `src/workbench/adoption/adoptStoryboardBatch.ts` |
| 排片 · 送上时间轴 · arrange | **arrange_storyboard_to_timeline** / `sendStoryboardToTimeline` | `src/workbench/generationCanvas/agent/sendStoryboardToTimeline.ts:77` |
| 字幕 · 台词 · caption · subtitle | 时间轴侧叫 **`textClips`**；分镜侧叫 **`subtitle` / `dialogue`**（node.meta） | `timelineTypes.ts`、`adoptStoryboardBatch.ts:79` |
| 取景 · 构图 · 裁切 · crop | **framing / ClipFraming**（contain/cover + scale + offset） | `src/workbench/timeline/clipFraming.ts` |

## Agent

| 你可能搜的词 | 规范名 | 去哪找 |
|---|---|---|
| agent 引擎 · runAgentChatV2 · streamText 循环 | **pi runtime**（pi SDK 0.85.1）。`runAgentChatV2` 是**已被取代**的旧名 | `electron/harness/runtime/pi/` |
| 工具组 · toolset · skillKey 选工具 | **capability**（工具组按 capability 选，**不按 skillKey**） | `electron/harness/agentChatPolicy.ts:35` |
| 工具定义 · tool schema · descriptor | **模型可见工具清单**（`modelToolSurfaceManifest.ts`；`canvasDescriptors.ts` / `documentDescriptors.ts` 是**已删**的旧名） | `electron/harness/tools/` |
| 统一 agent · 跨区 agent · 常驻助手 | **R2-U1 项目级统一 Agent**（未交付） | `docs/plan/2026-08-26-pi-agent-loop-file-migration.md` §7 |
| 会话 · 线程 · session · thread | **`{sessionKey, threadId}` 二元组**；area 仅 `creation \| generation` | `src/workbench/ai/agentSessionKey.ts:3` |
| 幻影工具 · phantom tool | 后端有 schema、前端未实现的工具（历史问题，已修） | `docs/plan/agent-merge-architecture.md`（⛔ 已过期） |

## 生成 / 画布

| 你可能搜的词 | 规范名 | 去哪找 |
|---|---|---|
| 画布 · canvas · 节点图 · 流程图 | **生成画布 GenerationCanvas**（`@xyflow/react` 单内核，R21） | `src/workbench/generationCanvas/` |
| 3D 场景 · scene3d · 导演台 · director · 站位参考 · 运镜参考 · 灰模 | **导演台 director 节点**（唯一的 3D 节点；`scene3d` 是已删的 V1，老节点加载时自动迁移）；AI 来导 = **站位参考**（create_staging_reference → 灰模图喂 composition_ref）/ **运镜参考**（create_camera_move → 灰模 mp4 喂 video_ref） | `src/workbench/generationCanvas/nodes/director/`（`agent/`、`migration/`） |
| 拆镜头 · 分镜 · storyboard · 镜头表 | **分镜 / storyboard**；产物是 **StoryboardPlan** | `src/workbench/generationCanvas/agent/storyboardPlan.ts` |
| 锚 · 参考图 · 角色圣经 · 定妆 | **视觉锚 anchor**（character/scene/prop/style），**冻结**=frozen | `electron/shared/agentCapabilities/canvasModelShapes.ts` storyboardAnchorSchema |
| 镜号 · shot number · 顺序 | **`shotIndex`**（存储身份，拖动不变，排片唯一排序信号） | `src/workbench/generationCanvas/model/shotNumbering.ts` |
| 手艺产物 · Agent 画的图 · Agent 做的表 | **agent-artifact 节点**（Agent 不调模型、用代码/标记语言直接做出来的表达物：SVG/HTML/Markdown/表格/3D） | `src/workbench/generationCanvas/nodes/artifact/`，方案 `docs/plan/2026-09-06-agent-artifact-node.md` |

## 生产 / 门禁

| 你可能搜的词 | 规范名 | 去哪找 |
|---|---|---|
| 生产流程 · 流水线 · pipeline · run | **ProductionRun** + **playbook 阶段机** | `electron/productionRun/productionPlaybooks.ts:33` |
| 合成 · 拼接 · assemble | **assemble 阶段**（playbook 第 8 阶段） | 同上 |
| 门 · 闸 · gate · 检查点 | 代码侧叫 **门岗**（`scripts/check-*.mjs`）；流程侧叫 **门/gate**（审批） | `package.json` gates 链 |
| 棘轮 · baseline · 只减不增 | **棘轮门岗**（存量进 baseline，新增报红） | `scripts/*-baseline.json` |
| 审片 · 校验 · QA · verify | **shotVerify / production.verify-shots** | `src/workbench/capability/capabilityApplyHandler.ts:554` |

## 动作词（按钮 / 菜单文案的规范动词）

> **这张表是门岗 `check:controls` 的 owner。** 规则本体在设计系统
> [§1.8 按钮三档：文字还是图标](design/nomi-design-system.md#18-按钮三档文字还是图标强制--有门岗)，
> 这里只登记「同一个动作，全 app 只准用哪个词」。
> 「替代说法」列里的词**作为一整条按钮文案出现即报红**（`确定` 红，`确认删除` 不红——那是一句话不是第二种说法）。
> 加一组：先确认它真是同一个动作（`移除`≠`删除`：一个从列表里拿掉、一个从盘上删掉，是两个动作，不进这张表）。

| 规范名 | 替代说法（整条文案等于它即红） | 英文 | 用在哪 |
|---|---|---|---|
| **撤销** | 撤回 · 回退 · 反悔 | Undo | `common.undo`；Undo Toast（设计系统 §5.4） |
| **删除** | 删掉 · 去掉 · 清掉 · 抹掉 | Delete | `common.delete`；节点/会话/素材的销毁动作 |
| **关闭** | 关掉 · 收掉 · 关上 | Close | `common.close`；弹窗、面板、预览的收起 |
| **取消** | 算了 · 不要 · 不用 · 放弃 · 不了 | Cancel | `common.cancel`；否定动作统一样式（§1.8 规则 4） |
| **生成** | 去生成 · 开始生成 · 生成一下 · 出图 | Generate | 生成主动作；带后果时写成「生成 ¥1.20」 |
| **确认** | 确定 · 好的 · 知道了 · 我知道了 · 没问题 | Confirm | `common.confirm`；花钱确认（§3.5 `SpendConfirmDialog`） |

## 对外接口

| 你可能搜的词 | 规范名 | 去哪找 |
|---|---|---|
| MCP 工具 · 外部 agent 工具 | **MCP_TOOL_CATALOG**（顶层）；`mcpGenerationTools.ts` 只是**生成子目录** | `electron/capabilityCore/mcpToolCatalog.ts:12` |
| 能力核 · capability core | **capabilityCore** | `electron/capabilityCore/` |

---

## 已知的「同名不同物」陷阱

这些词在仓库里**指两个不同的东西**，最容易搞混：

| 词 | 含义 A | 含义 B |
|---|---|---|
| **粗剪 rough cut** | `2026-06-21-preview-rough-cut-overhaul.md` = **预览区手感**（音量/全屏/redo/trim 气泡） | E2 = **自动生成粗剪** |
| **gate / 门** | `scripts/check-*.mjs` **代码门岗** | ProductionRun 的**审批闸** |
| **metadata / meta** | planned node 上叫 `metadata` | 真实 canvas node 上叫 **`meta`**（`applyCanvasToolCall.ts:308` 做的转换） |
| **transition** | `TimelineTransition` **数据**（已实现） | 转场**渲染效果**（**未实现**，见 `docs/ARCHITECTURE-NOW.md`） |
| **plans 目录** | `docs/plan/`（397 篇，功能级方案） | `docs/superpowers/plans/`（35 篇，**跨阶段总纲住这**） |
| **表格 / table** | **产物表格** = `agent-artifact` 的一个 `fileType`（`ARTIFACT_FILE_TYPES` 里的 `'table'`）：Agent 手写的一段**静态只读 HTML 片段**，落盘成文件、只用来看，没有行模型、不可编辑、不投影任何东西 | **分镜表**（storyboard shot table）= 创作面的**可编辑行编辑器**，行是 StoryboardPlan 的镜头、每行绑模型与参考槽；方案是内容正本，节点派生并可逐字段覆写，行内采纳/丢弃覆写；执行状态从节点投影 |
