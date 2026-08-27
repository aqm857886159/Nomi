# E2 配套：内部 Agent 接线 + 外部对标

> 状态：📋 **方案待拍板** · 日期：2026-08-27 · 基线：`origin/main` @ `8f9365ae`
>
> **本文是 [P5 E2「结构化粗剪」前置盘点与方案](2026-08-26-p5-e2-structured-rough-cut.md)（PR #179）的配套件，不是替代品。**
> 那份已经做完了**时间轴代码盘点**（§1）、**EditPlan 类型化操作集**（§2，8 条带 scope）、**Proposal 幂等**（§3，复用现成 `AdoptionProposalKey` 六元组）、**零模型派生算法**（§4）、**缺口与进入闸**（§5）。**本文不重复这些，直接引用。**
>
> 本文只补它没覆盖的两块：
> 1. **内部 Agent 怎么调用这些操作**（capability 接线、审批、作用域、MCP 关系）—— #179 全文零命中 `capability` / `agentChatPolicy` / `descriptor`
> 2. **外部对标**（竞品、开源、build-vs-buy）—— #179 全文零命中 `ChatCut` / `Remotion` / 竞品
>
> 沿用总纲词汇：EditPlan / 剪辑计划卡 / E1 采纳桥 / E2 结构化粗剪 / E3 理解式剪辑。
> **可信度**：仓库结论逐行读过给 `file:line`；外部结论标 URL + 抓取日期（2026-08-27）；star/license 用 GitHub API 实测。

---

## 0. 一页读懂

**E2 的地基已经比总纲写的时候更完整**——分镜到时间轴的字幕、转场、幂等键今天已全线实现（链路见 #179 §1.3/§1.5，本文 §1 只补它没查的那一处断点）。

**本文的核心命题**：E2 的操作集设计好了，但**内部 Agent 今天一个都调不到**——`agentChatPolicy.ts:35` 的 capability→工具组映射里根本没有 timeline 这一档，而且 `gate.ts` 是画布专用表，未登记的 timeline 工具会**直接 deny**。

**并且有一处断点会让 E2 的「零模型派生」在 Agent 路径上直接失效**（下面 §1）。

---

## 1. 补一处 #179 没查的断点：两条分镜路径 schema 分叉

#179 §1.3 说「分镜 schema 已把 `subtitle/dialogue` 作为结构字段」——**这句对渲染端 planner 成立，对内部 Agent 工具不成立**。

| 产出路径 | schema | `subtitle` / `dialogue` / `transition` |
|---|---|---|
| 渲染端 planner（创作区就地拆镜） | `src/workbench/generationCanvas/agent/storyboardPlan.ts:180-182` | ✅ 声明 |
| **内部 Agent 工具 `propose_storyboard_plan`** | `electron/harness/tools/canvasDescriptors.ts:81` | ❌ **未声明** |

后果：**用户在创作区拆镜 → 字幕转场自动就位；让内部 Agent 拆镜 → 永远没有。** E2 §4.2「对白 → 字幕轨」和 §4.4「转场应用」在 Agent 路径上派生不出任何东西——不是算法不对，是**上游根本没被要求填这些字段**。

> 补充证据：`canvasDescriptors.ts` 里 `dialogue` / `subtitles` 只出现在**禁止语**里（"no camera move / transition / dialogue"、"No … dialogue, subtitles, or sound"），是描述 prompt 该写什么，不是字段。

**修法**：`storyboardShotSchema` 补 `subtitle` / `dialogue` / `transition` 三个 **optional** 字段，与 `storyboardPlan.ts:180-182` 对齐；补一个**两份 schema 字段一致性断言测试**防再分叉。

这是全案性价比最高的一刀：下游（metadata 透传 → 采纳桥 → textClips/transitions）**全部已通**，只差声明，零 LLM 额外成本。

---

## 2. 内部 Agent 接线（本文正题）

> 接线事实经 Codex 独立读码复核（读 `harness/`、`agentChatV2*`、`applyCanvasToolCall`、pi 运行时与 4 份 pi 方案文档），逐条 `file:line`。
> ⚠️ **本节曾整段基于 2026-06 的 `agent-merge-architecture.md`，那份已 ⛔ 过期**（引擎已切 pi SDK），7 处结论作废，见 §2.7。

### 2.1 工具组按 `capability` 选，不是 skillKey

`electron/harness/agentChatPolicy.ts:35`：

```
creation-editor → 全部文稿工具       canvas-agent  → 全部画布工具
creation-chat   → read_full_text / read_selection / author_skill
canvas-refine   → 仅 set_node_prompt  storyboard   → read_canvas_state + propose_storyboard_plan
其余（含 single-shot）→ 空工具集
```

作用域守卫 `agentToolIsInScope:46`（按 capability 校验工具名；`canvas-refine` 另校验 nodeId 在选中集内）。步数上限 `agentChatV2.ts:102`：`storyboard`=24、其余=8、`single-shot`=1 且零工具。

> **Skill 只提供方法，不授予工具权限**——换个 Skill 名字不能扩权（pi 方案原话）。

### 2.2 接线六跳

| 跳 | 动作 | 位置 |
|---|---|---|
| 1 | 建 `timelineDescriptors.ts`（Zod 参数 + 唯一工具说明，与 canvas/document 并列）。**参数直接映射 #179 §2 的 8 条 EditOperation，不另造一套操作词汇** | `electron/harness/tools/` |
| 2 | **新增 capability 并挂工具**（旧版漏了这跳） | `agentChatPolicy.ts:35` |
| 3 | 作用域守卫补分支（校验目标 clip/range 在冻结目标内） | `agentChatPolicy.ts:46` |
| 4 | 步数档位 | `agentChatV2.ts:102` |
| 5 | **建 timeline 领域 gate**（见 §2.3） | 渲染端 |
| 6 | 渲染端执行器 → **汇流 `adoptStoryboardBatch` 采纳桥** | `src/workbench/timeline/` → `adoption/` |

**capability 分两档**，对齐总纲「agent 不直接落轴」铁律与 #179「计划执行器只生成 Proposal，不直接调用 store」：

- **`timeline-planner`**（只读 + 产提案）：`read_timeline` / `inspect_timeline_range` / `propose_edit_plan`。多步工具循环，语义对齐现有 `storyboard`——**不是 `single-shot`**（那档零工具，装不下）。
- **`timeline-editor`**（可写）：`apply_edit_plan`（整份 EditPlan 一次 Apply / 一步 Undo）。

> 注意 EditPlan 的 `baseRevision` 时序（#179 §3）：必须在所有纯派生/异步 probe 完成后才从当前 timeline 读取。Agent 路径上尤其重要——模型思考期间用户可能动了轴。

### 2.3 审批：`gate.ts` 不能直接复用

`generationCanvas/agent/gate.ts:43` 的 `writes: true` 表**是画布专用的**——未登记的 timeline 工具会被**直接 deny**。必须建 timeline 领域 gate（或受控泛化）。**不能拿 `agentChatPolicy` 当审批替代品**：它管作用域，不管用户确认。

**破坏性二次确认今天不存在**——`destructive: true` 没有任何二次确认分支。「覆盖已有剪辑必须二次确认 + 必须给 reason」是**待实现需求**：descriptor 把 `reason` 设为必填，renderer gate / 计划卡 / 最终提交边界各落实一次。

> 与 #179 §2 的 `Scope.reason` 呼应：那是**给用户看的影响范围理由**，本项是**破坏性操作的授权理由**，两者不是同一个字段，别合并。

### 2.4 渲染端执行、主进程只回喂

pi 契约：**renderer 已执行的工具结果只回喂模型，主进程不得再执行一次**。所以剪辑工具的真实 execute 必须写在渲染端（时间轴 store 与采纳桥都在那边），主进程只做 Zod 解析 + 作用域校验 + 结果转发。与画布工具同构。

### 2.5 MCP：两套入口合同，一套领域实现

现状范式：`applyCanvasToolCall.ts:595`（内部）与 `capabilityApplyHandler.ts:543`（外部 `production.arrange`）各自入口，**最终都调 `sendStoryboardToTimeline.ts:77`**——共享点在领域函数，不在 schema 层。

剪辑开放给外部 agent 时：内部走 §2.2；外部走**顶层 `mcpToolCatalog.ts:12`**（**不是** `mcpGenerationTools.ts`，那是生成语义子目录），补 `READ_ONLY_TOOLS` 标注、dispatcher、外部授权、renderer bridge。`tools/list` 广播的 JSON Schema 同时是唯一运行时校验边界（`mcpProtocol.ts:445`）。

### 2.6 预览区：接 R2-U1 共同宿主，不是第三个面板

`agentSessionKey.ts:3` 只有 `creation | generation` 两个 area、**两份独立历史**（R1 过渡边界），**跨区记忆并未打通**。R2-U1 范围表（`2026-08-26-pi-agent-loop-file-migration.md:287`）已写明预览接**共同宿主**、且「**不虚构 E2 尚未实现的剪辑工具**」；验收用例（`:395`）写着「从创作发指令…**再到预览继续**」；`:51` 直接否掉了搬 JSX 的做法：

> 预览没有 Agent；**这不是只移动 JSX 就能解决的外观问题**

**分工**：剪辑 capability + renderer 执行器**先独立建**（不依赖 R2-U1）；**预览的 Agent 呈现面等 R2-U1**，届时作为视图投影接入。不新增 `WorkbenchAgentArea='preview'` / preview sessionKey / 第三份历史。

**@ 引用**：选中 clip/时间段要作为 **typed request 目标冻结**在请求里 → `agentToolIsInScope` 校验 → 渲染端提交前**复验 timeline revision**。否则用户切了选区，在途任务会改到新目标上。

### 2.7 作废清单（旧版本文的错误，留档以免重犯）

| 旧版说 | 实际 |
|---|---|
| 工具组按 `skillKey` 选 | 按 **`capability`**（`agentChatPolicy.ts:35`）|
| 沿用 `gate.ts` 的 `writes:true` | 画布专用表，未知 timeline 工具**直接 deny** |
| 破坏性二次确认「沿用现有机制」 | **不存在**，属待实现 |
| 「跨区记忆已经打通」 | **假的**，R1 保留两份历史 |
| 剪辑 MCP 工具进 `mcpGenerationTools.ts` | 应进顶层 `mcpToolCatalog.ts` |
| 提案工具做成 `single-shot` | 应做成受限 `timeline-planner` capability |
| @ 引用「只差注入 prompt」 | 还需目标冻结 + 作用域校验 + revision 复验 |

---

## 3. 一处需要和 #179 对账的结论（我不下断言）

**导出音频到底通不通，两份文档看到的不是同一条路。**

- #179 §1.4 说：renderer manifest 声明 `audioCodec:'none'` / `audioMode:'mute'`，WebM exporter 只 preload image/video、不混音 → **「预览可听到 BGM」≠「MP4 粗剪含 BGM」**。
- 本文查到：`electron/export/exportJobs.ts:169-170` 在任一素材有音轨时把 profile 改成 `aac / mixdown`；`ffmpegFiltergraph.ts:192` 有完整音频链（atrim → asetpts → adelay → amix + volume 补偿）。

**两条都可能对**——导出有两条后端（WebM canvas 路 `timelineWebmExport.ts` / ffmpeg filtergraph 路），`exportPlanner.ts` 负责选。

**待办**：E2 动手前**实测一次导出**，确认粗剪走哪条后端、音频是否真的出声。这直接决定 #179 §4.3「音乐垫底」能不能宣称完成。**在测出来之前，两份文档都不要声称音频已通。**

---

## 4. 外部对标（#179 未覆盖）

### 4.1 商业产品

| 产品 | 核心机制 | 交互 | 剪完留下什么 |
|---|---|---|---|
| **ChatCut** | 自动转录（100+ 语言）、分说话人、**词→帧映射**；Agent 分析每条 clip → 找高光 → 去重复 take/口癖 → 排序 → 上字幕/B-roll/音乐 | Viewer + AI 面板 + 下方时间轴；**@ 引用** timeline item / asset / viewer 区域 / 转录稿文字；Agent ／ Video Gen 双模；有 **Skills & Design Styles** | **"a real, editable timeline"**；导出含 **XML（Premiere/DaVinci）** |
| **Descript** | 文本即视频；去口癖/停顿、Studio Sound | 文档式 | 轴 + XML |
| **Premiere（Sensei）** | Scene Edit Detection 自动打切点（实测 47/49） | 传统 NLE | 工程 |
| **可灵/即梦/Higgsfield/Vidu/海螺** | **全在生成侧发力，剪辑侧几乎空白** | — | — |

> **「生成完 → 成片」是无人区。** 画布 + 时间轴同在一个 app，是我们唯一能吃下这段的结构性优势。
> ChatCut 三条最该对齐：@ 引用（→ §2.6）、Skills（我们已有 31 个）、**剪完留真轴**（我们已有，且带一步撤销）。

### 4.2 开源（star / license / 活跃度 GitHub API 实测 2026-08-27）

| 仓库 | ★ | License | 最近 push | 可复用什么 |
|---|---:|---|---|---|
| [OpenCut](https://github.com/OpenCut-app/OpenCut) | 87,085 | MIT | 2026-08-10 | ⚠️ **仓库刚重写**（tree 仅 151 文件、changelog 停在 0.3.0、桌面端改 Rust），星多但当下不是可抄的成熟库 |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | 51,769 | **AGPL-3.0** | 2026-08-22 | `edit_decisions.schema.json` 可对照 #179 §2 的操作集；**与本仓同 License，借鉴无法务风险** |
| [video-use](https://github.com/browser-use/video-use) | 21,420 | MIT | 2026-08-26 | ✅✅ 见下 |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | 14,424 | Apache-2.0 | 2026-08-25 | **E3 转录的直接答案**：JS API 可在 Electron 跑，SenseVoice 中/粤/英/日/韩 + CTC 时间戳 |
| [auto-editor](https://github.com/WyattBlue/auto-editor) | 5,081 | Unlicense | 2026-08-25 | 静音检测算法 + 多 NLE EDL 导出格式 |
| [PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | 5,124 | BSD-3 | 2026-08-24 | 镜头边界检测算法 |
| [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | 1,965 | Apache-2.0 | 2026-08-07 | ◐ 抄语义不抄依赖（JS binding 仍 WIP、未发 npm） |

**video-use 四条**（整个"产品" = 1 个 322 行 SKILL.md + 6 个 py 脚本，引擎就是 Claude Code 本身）：

1. **唯一值得存在的派生物是「打包转录稿」**——词级 JSON 按「静音≥0.5s 或换说话人」断句，**token 只有原始 JSON 的 1/10**；其余（口癖、重复 take、镜头分类、打分）**全部决策时现推，不预计算**。
2. **文字为主、视觉按需**——唯一视觉下钻工具给 `[start,end]` 出「胶片条+波形+词标签」PNG，文档明写 **"Not a scan tool"**。→ 给 §2.2 的 `inspect_timeline_range` 定了性：**决策点用，不做背景索引**。
3. **硬规则 vs 艺术自由分离**——硬规则只收「会导致**静默失败**」的：字幕必须最后一层、逐段抽取+无损 concat、每段边界 30ms 音频淡入淡出防爆音、overlay 必须 PTS 位移、**绝不切在词中间**、切边留 30–200ms padding。
4. **自审环**——对**输出文件**在每个切点 ±1.5s 逐张检查，**最多 3 轮**，超了诚实上报。→ 与 `production.verify-shots`（`capabilityApplyHandler.ts:554`）同构，可复用。

> anti-pattern 第二条直接约束 EditPlan 设计：**"Hand-tuned moment-scoring functions. The LLM picks better than any heuristic you'll write."** —— 别预计算打分矩阵。这与 #179「零模型派生」不冲突：结构能派生的用派生（不烧钱），派生不出的交给 LLM 选（别手写启发式）。

### 4.3 build-vs-buy 闸（R20）

| 能力 | 通用？ | 现成方案（实查） | 决定 |
|---|---|---|---|
| 时间轴交换格式 | 是 | OTIO（JS binding **WIP、未发 npm**） | **对齐语义，不取依赖** |
| 渲染引擎 | 是 | **Remotion** —— [License FAQ](https://www.remotion.dev/docs/license/faq) 明确 source-available、按公司规模收费、**与 AGPL 不兼容**；本仓 `AGPL-3.0-only` | **继续 ffmpeg**（法务硬边界，非技术偏好） |
| 转录 ASR（E3） | 是 | sherpa-onnx（Apache-2.0，Electron 可跑，中文可用） | **用它，本地优先**——顺带比 ChatCut 强一条：**素材不出机器** |
| 静音检测 | 是 | auto-editor（Unlicense） | 抄算法不引依赖（它是 Nim） |
| 镜头边界检测 | 是 | PySceneDetect（BSD-3） | 抄算法；v0 先用 ffmpeg `select='gt(scene,0.4)'` |
| **剪辑决策** | **否** | — | **自研** = 护城河 |
| **意图直通** | **否** | — | **自研**，结构上对手抄不动 |

### 4.4 做完之后我们站在哪

| 维度 | ChatCut | Descript | Premiere AI | OpenMontage | video-use | **Nomi（E2+E3 后）** |
|---|---|---|---|---|---|---|
| 转录稿剪辑 | ✅ | ✅✅ | ◐ | ◐ | ✅ | ✅ E3（**本地不出机器**）|
| 自动删静音/口癖 | ✅ | ✅ | ◐ | ◐ | ✅ | ✅ E3 |
| 场景切分 | ✅ | — | ✅✅ | ✅ | — | ✅ E3 |
| 对话式剪辑 Agent | ✅✅ | ◐ | ◐ | ✅ | ✅✅ | ✅ 本文 §2 |
| @ 引用上下文 | ✅✅ | — | — | — | ◐ | ✅ §2.6（带目标冻结+revision 复验）|
| 剪完留真时间轴 | ✅ | ✅ | ✅ | ◐ | ❌ | ✅ **已有，一步撤销** |
| 生成+剪辑同一 app | ✅ | ❌ | ◐ | ✅ | ❌ | ✅ **已有** |
| **上游意图直通剪辑** | ❌ | ❌ | ❌ | ◐ | ❌ | ✅✅ **§1 —— 唯一** |
| 本地优先/素材不上云 | ❌ | ❌ | ◐ | ◐ | ❌ | ✅✅ **已有定位** |
| 外部 agent 可驱动（MCP） | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ §2.5 |
| 导出到专业 NLE | ✅ XML | ✅ XML | 原生 | ◐ | ❌ | ◐ 待排（OTIO/FCPXML） |
| 多图层/关键帧曲线 | ✅ | ◐ | ✅✅ | ✅ | ◐ | ❌ **主动不做**（总纲：不拼通用 NLE）|

---

## 5. 范围 / 不动项 / 验收门（R4）

**范围**：§1 的 schema 对齐 + §2 的 Agent 接线六跳。**时间轴操作集、EditPlan 类型、派生算法、缺口清单全部以 [#179 那份](2026-08-26-p5-e2-structured-rough-cut.md) 为准，本文不重复定义。**

**不动项**：
1. 不另造 EditPlan 类型 / Proposal key / 操作词汇（用 #179 §2/§3）；
2. 不自己写落轴路径（走 `adoptStoryboardBatch`）；
3. 不新增 `WorkbenchAgentArea='preview'` / 第三份历史（§2.6）；
4. 不改 `TimelineState` 语义（§1 只补 optional 字段）；
5. 不引入 Remotion 或第二渲染器（AGPL 冲突）；
6. 不做任意图层数 / 关键帧曲线。

**验收门**：
1. 五门全过 + **两份 storyboard schema 字段一致性测试**（防 §1 的分叉复发）；
2. 单测：capability→工具组映射、作用域守卫拒绝越界目标、破坏性工具缺 `reason` 即拒、EditPlan `baseRevision` 时序（异步 probe 后才取）；
3. **导出音频实测**（§3）——在测出来之前不声称音频已通；
4. **P3 真机走查**：「Agent 拆镜 → 生成 → 剪辑计划卡 → Apply → 预览 → Undo 复原」，截图自己亲眼 Read 过；
5. **R16 真实任务**：至少 3 条（① 15 镜短剧自动成片 ② **J-混剪**（一半上传素材+一半 AI 镜头），断言 **agent 未直接写时间轴** ③ 让 Agent「节奏调快 20%」）。

---

## 6. 待拍板

| # | 决策点 | 推荐 |
|---|---|---|
| ① | **§1 schema 对齐先行**（补三个 optional 字段）能否直接开工？ | **能**——纯声明对齐、下游全通、零 LLM 成本、单字段可回滚。**它是 E2 §4.2/§4.4 在 Agent 路径上生效的前提** |
| ② | 剪辑 capability 分 `timeline-planner` / `timeline-editor` 两档 | **认可**——对齐「agent 不直接落轴」与 #179「只生成 Proposal」 |
| ③ | 导出音频走哪条后端（§3）—— 谁去实测 | 建议**并进 #179 的 §5 缺口清单**，一次测清 |
| ④ | 预览区 Agent 呈现面等 R2-U1，本轮不做 | **是**——否则在造马上要拆的债 |

---

## 附：一手材料

- 配套主文档：[P5 E2 结构化粗剪前置盘点](2026-08-26-p5-e2-structured-rough-cut.md)（PR #179）、[E3 语义剪辑](2026-08-26-e3-semantic-editing.md)（同 PR）
- 总纲：[统一 Agent 总体方案 §5.1](../superpowers/plans/2026-08-24-unified-agent-master-plan.md)
- pi 运行时：[R1 切换](2026-08-26-pi-r1-runtime-cutover.md)、[逐文件迁移 §7 R2-U1](2026-08-26-pi-agent-loop-file-migration.md)
- 外部仓库（已 clone 逐文件读，非 README 概括）：`browser-use/video-use`、`calesthio/OpenMontage`
- 产品文档：[ChatCut — What is ChatCut](https://chatcut.io/docs/what-is-chatcut)、[Editor Overview](https://chatcut.io/docs/editor-overview)
- pi 接线事实：Codex 独立读码复核（7 处旧结论作废，见 §2.7）
