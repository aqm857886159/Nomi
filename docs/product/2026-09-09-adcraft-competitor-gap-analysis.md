# AdCraft vs Nomi 竞品差距分析

> 日期：2026-09-09 · 对象：[GML-MMGroup/AdCraft](https://github.com/GML-MMGroup/AdCraft) · 依据：AdCraft README/仓库结构（2026-09 已开源，1629 commits）+ Nomi `docs/ARCHITECTURE-NOW.md`（2026-08-31 核对基线）

## 一句话定位

| | AdCraft | Nomi |
|---|---|---|
| 定位 | **广告垂直** Agentic 视频制作平台（Web + 后端 + Docker） | **通用** AI 视频创作桌面工作台（Electron，本地优先） |
| 核心叙事 | 一句粗糙的想法 → 自动编排完整广告流水线，全程可编辑 | 本地优先 + 成本结构 + 开放接入 + 作为 agent 的生成后端 |
| 许可 | 个人非商业许可（2026-08-10 由 GPL 改出） | AGPL-3.0-only |
| 团队 | GML-MMGroup 团队，1629 commits，行业案例展示墙 + 推荐资产包 | 单人（青阳），迭代快 |

## 流水线对照

AdCraft：创意 → 创意方案 → 脚本 → 产品视觉 → 角色 → 场景 → 分镜 → 视频 → **声音** → 合成 → 成片，由 9 个具名 Agent 编排。

Nomi 的 `productionRun` playbook：brief → direction → script → storyboard → build → generate → qa → **assemble（目前只有一行）** → export（`electron/productionRun/productionPlaybooks.ts:33`）。

**结论：阶段骨架已经对齐，差距不在「有没有这条流水线」，在纵深和完成度。**

## 差距清单（按严重度排）

### G1 端到端编排纵深 — 差一档
AdCraft 是「一句话 → 全自动跑完整条链，分阶段并行、真实进度状态（排队/生成/待确认/失败/跳过）、从任意节点继续、已满意素材保留不重做」。Nomi 侧：agent 新通路在影子期用户走不到；步数上限 8/24；`assemble` 阶段只有一行。**「一句话到成片」的完整感是 AdCraft 最强的产品体验，也是 Nomi 最大差距。**

### G2 专业 Agent 分工的用户可感知叙事
AdCraft 有 9 个具名角色（创意总监/编剧/产品视觉/角色设计/场景设计/分镜/视频导演/声音总监/最终合成），用户能感知「一个团队在干活」。Nomi 是 capability 工具组（creation-editor / canvas-agent / storyboard…），架构上更通用（符合 P4），但**用户感知上没有分工叙事**。这条可以用「角色化包装」低成本补，不用改架构。

### G3 生产级角色/场景资产体系
AdCraft 角色资产 = 三视图转面 + 面部参考 + 服装结构细节 + 配饰 + 统一色板；场景资产 = 定场/远中近景/多机位/过渡镜头的完整世界观分镜板。Nomi 有角色/场景固定（2026-06-06 已设计落地）和声明式参考槽体系（`ArchetypeReferenceSlotKind` 六种），但**资产规范深度和跨镜头一致性保障不在一个量级**。

### G4 声音环节缺整条链路
AdCraft 有声音总监编排 BGM/音效/旁白/节奏。Nomi 音频是时间轴 clip 音频参数 + 导出 mixdown（已扎实），但**没有「旁白/BGM 智能编排」这条生成链路**——脚本里的 dialogue 只落到字幕（`adoptStoryboardBatch.ts:79`），没有 TTS 编排成音轨。

### G5 候选版本 / 回滚 / 素材溯源
AdCraft：每次重生成先出候选版本，可预览/接受/拒绝/切换/回滚；统一素材库带来源、版本历史、生成备注、使用状态。Nomi：素材库 + 资源库发现层已有，但版本/候选语义弱（history prompt backlog 2026-06-15 未清）。

### G6 拉片复刻（视频克隆）闭环
AdCraft 已把「上传对标视频 → 拉片分析镜头语言/节奏/字幕音效同步 → 转成可编辑工作流 → 换素材产出结构相似的新广告」做成招牌功能。Nomi 有视频拆解 v1（2026-09-01 计划 + mockup + TikHub 数据源），**方向已对，但还没落成「结构 → 可编辑工作流 → 重制」的完整闭环**。这是需要提速的一条。

### G7 广告垂直预设创意流
AdCraft 有产品展示 / 游戏买量 / 电商种草预设流 + Style Skill。Nomi 分镜表有 genre profile（2026-09-01），但广告垂直的预设工作流是浅的。

### G8 团队势能：案例展示墙 + 推荐资产包
AdCraft 展示汽车/食品/美妆/服装等真实成片案例，并发布推荐角色/场景资产包。Nomi 单人开发 + 功能迭代强，但**缺「用 Nomi 做出的成片」展示墙和官方资产包**——这是营销短板不是工程短板。

## Nomi 领先 / AdCraft 做不了的地方

1. **MCP 被外部 agent 调用**（`electron/capabilityCore/mcpToolCatalog.ts`）——Nomi 是 agent 的生成后端，复用用户 agent 会员额度。AdCraft 是封闭平台，结构上做不了。
2. **开放接入**：任何 OpenAI 兼容/Anthropic/中转粘贴即用，66 条认证台账，ComfyUI 工作流直导 + 运行前缺件预检。AdCraft 是封闭的平台白名单（即梦/可灵/海螺/豆包/通义/混元/讯飞）。
3. **本地优先**：素材/生成物/工作流全在本机，成本结构（草稿→参考→精修、多供应商择价）。
4. **时间轴真实剪辑导出**：FFmpeg filtergraph（字幕/转场/clip 音频/mixdown）+ 导出验证回执，是真实剪辑器而非合成预览。
5. AGPL 开源 + Skill Pack 生态 + 「让你的 AI 替你接入」的定制叙事。

## 行动建议（映射差距 → Nomi 现有资产）

| 优先级 | 动作 | 补哪条 | 现有依托 |
|---|---|---|---|
| P0 | 把 `productionRun.assemble` 补成真成片，影子期 agent 通路收口到用户可达 | G1 | productionRun 引擎 + E1 采纳桥已实现 |
| P0 | 视频拆解 v1 收口为「拉片 → 可编辑分镜表工作流 → 换素材重制」闭环 | G6 | 拆解 v1 计划 + 分镜表节点（2026-09-07） |
| P1 | 角色资产升级为「资产包规范」（三视图/面部/服装/色板槽位），复用声明式参考槽 | G3 | 参考槽体系已是声明式一等数据 |
| P1 | 对白→TTS 编排成音轨（旁白/BGM 进时间轴） | G4 | clip 音频参数已落盘进导出 |
| P2 | 候选版本/回滚语义进素材库 | G5 | 素材库 + 发现层已有 |
| P2 | 广告垂直预设创意流（用 Skill Pack 承载，不写死代码） | G7 | Skill Pack v2 + genre profile |
| P2 | 成片案例墙 + 官方角色/场景资产包 | G8 | 用户群 + B 站教程渠道 |

## 备注

### 附：Agent 层对照（Nomi 影子 agent / 通用 agent vs AdCraft agent 团队）

**底座同源（好消息）**：AdCraft 提交记录明确写着 "run Pi agent runtime with local deployments"——它也跑在 pi 上。Nomi 刚切到 pi 0.85.1 `AgentHarness`（顺序/重试/队列/花费/崩溃恢复一次到位），**运行时底座的选择不落后，和它同源**。差距不在底座，在 agent「能操作的对象」和「编排语义」。

| 维度 | AdCraft | Nomi 现状（ARCHITECTURE-NOW 基线） | 差距判定 |
|---|---|---|---|
| Agent 数量与分工 | 9 个具名专业 agent，用户可感知「一个团队」 | capability 工具组（creation-editor / canvas-agent / storyboard…），架构更通用（P4）但无角色叙事 | 感知层差距，包装可补 |
| Agent 操作对象 | 整条可编辑流水线：增删/重排步骤、单步运行、任意节点继续、已满意素材保留 | 影子 lane 只接了 `document.read` / `document.write` 两个工具；不注册 IPC、用户走不到，用户仍在旧通路 | **核心差距** |
| 管线动词 | 跑阶段 / 从节点续跑 / 候选版本确认，画布显示真实阶段状态（排队/生成/待确认/失败/跳过） | `productionRun` 引擎有阶段机+门+预算账本+审批回执，但**没有 agent 工具暴露它**；步数上限 24/8/1 撑不起全流水线 | **核心差距** |
| 局部修改纪律 | 局部修改只影响相关内容，重生成先出候选版本 | `canvas-refine` 已有 nodeId 作用域守卫（只能改选中集） | 机制对齐，缺候选版本层 |
| 会话与记忆 | 全流程统一上下文 + 素材库跨活动一致 | 两个 area（creation/generation）独立历史，无跨区记忆（R2-U1 未交付）；预览区无 agent | 中等差距 |
| 工程纪律 | 未见对等机制 | 影子通路 CI 每轮机器断言新旧一致性、工具作用域守卫、证据制经验沉淀闭环（→Skill/Runbook/Gate） | **Nomi 领先** |
| 生成节奏控制 | 适时请求确认、生成新候选 | 采纳桥 Proposal 幂等键（replay/stale/needs_attention） | 机制对齐 |

**结论**：影子 agent 的差距是「通路的可达性 × 工具面的广度 × 管线动词」三件事，不是 runtime 好坏。顺位：① 按 2026-09-07 重做方案走完阶段 1（垂直切片把 canvas-agent 工具组接进新通路）→ 阶段 4 删旧切换；② 把 `productionRun` 的阶段动词（跑阶段/从节点续跑/候选确认）暴露成 agent 工具；③ 再谈 9 角色化包装。在 ①② 完成前，任何「多 agent 团队」的 UI 叙事都是空壳。

### 许可与借鉴

- AdCraft 的生产流程编排、资产规范设计**可以借鉴**（能力设计不受许可证保护）；其代码为个人非商业许可，**不可复制代码**。
- 与 2026-09-07 LibTV 竞品分析互补：LibTV 是画布交互层对标，AdCraft 是**编排纵深 + 资产体系**对标。两者指向同一个结论——Nomi 的下一段主升浪在「从画布工具到端到端制作系统」。
