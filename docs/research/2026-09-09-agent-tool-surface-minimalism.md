# Agent 工具面极简主义：证据 + Nomi 设计

> 2026-09-09 · 问题：OpenChatCut 用约 120 个工具堆出能力；Nomi 该走「少而底层」吗？答案：**该，且我们已经在正确的路上**——本文给外部证据 + 现状盘点 + 收敛目标与增长政策。
> 依据：子代理调研（Claude Code / Anthropic 工程博客 ×2 / SWE-agent ACI 论文 / Manus / OpenHands / Berkeley function-calling 数据），每条带来源。

---

## 一、外部证据（五条独立线，全部指向同一个方向）

| 证据线 | 结论 | 来源 |
|---|---|---|
| **Claude Code** | 内置仅 ~15 工具；**Bash 是万能逃生口**——任何未内置能力（ffmpeg/git/包管理）由模型写命令组合完成。「工具层保持简单，模型层承担智能」 | code.claude.com/docs/en/claude-code/tools |
| **Anthropic「Code execution with MCP」** | 工具 schema 全塞上下文 → 挤爆；改为把能力呈现为代码 API，agent 写代码调用：工具定义 token **150K→2K（省 98.7%）**，组合逻辑（循环/条件/过滤）下沉到代码，模型只看最终摘要 | anthropic.com/engineering/code-execution-with-mcp |
| **Anthropic Tool Search / Programmatic Tool Calling** | 工具标 `defer_loading`，按需搜索加载 3–5 个：上下文 77K→8.7K；大工具库下准确率反而**上升**（49%→74%）——动态发现让「大库」与「少上下文」兼容 | anthropic.com/engineering/advanced-tool-use |
| **SWE-agent ACI 论文**（NeurIPS 2024） | 不是「越少越好」，是「**少量精心设计的原语 > 原始大动作空间**」：带 guardrails+简洁反馈的小命令集比裸 shell 多解 10.7 个百分点。**反馈质量比数量更决定成败** | arxiv.org/abs/2405.15793 |
| **Manus 上下文工程** | KV-cache 命中率是第一指标（缓存/未缓存成本差 10 倍）；「**Mask, don't remove**」：不动态增删工具（破坏前缀缓存），用 logits mask+状态机；**保持少于 20 个原子原语**——「小而分离优于大而全」 | manus.im/blog/Context-Engineering-for-AI-Agents… |
| **反例数据** | Berkeley function-calling：单工具 95–96% 准确率，20+ 工具掉到 **65–78%**，多步链误差相乘；Less-is-More 论文：减候选工具提成功率省 70% 时间 | arxiv.org/abs/2411.15399 等 |

**一条重要的分野**：收敛工具（Manus/Claude Code 路线）和动态发现（Tool Search 路线）是同一问题的两种解法——前者治「选择负担」，后者治「上下文负担」。**常驻工具必须少；长尾可以存在但必须延迟加载。**

## 二、Nomi 现状盘点（当日实核）

lane 工具面：timeline 读 3 + canvas 写 2（`nomi_canvas_write`/`nomi_storyboard_write` 均为 ops-union 单工具）+ document 2 + 生产动词 9（`productionRunDescriptors.ts`）+ 媒体读 ~5 + 导出 ~3 ≈ **25 个左右**，加上 P0-2/P0-3 计划中的 `edit_timeline`/`read_transcript`/`find_transcript`/`preview_timeline_frames` 后约 **30 个**——正好踩在 Berkeley 数据的警戒线上。

**我们的结构性优势**：`nomi_canvas_write` 和计划中的 `edit_timeline` 已经是「**原语+组合**」形态——操作是 payload 数组（kernel `TimelineOperation[]`），不是每操作一个工具。这正是 Claude Code/Manus 路线；OpenChatCut 的 120 工具是反面教材（它的 #112「原子批校验过严整批被拒」就是工具粒度太碎的直接代价）。

## 三、设计：三层工具面政策

### 第一层 · 常驻（目标 ≤16，跨 capability）
| 域 | 工具 | 形态 |
|---|---|---|
| 画布 | `nomi_canvas_read` / `nomi_canvas_write` / `nomi_storyboard_write` | 已是 ops-union 单工具 ✅ |
| 时间轴 | `read_timeline` / `edit_timeline(operations[])`（P0-2）/ `preview_timeline_frames`（P1-2）/ `export_timeline` + `inspect_export_job` | **禁拆**：不许出现 `move_clip`/`trim_clip`/`split_clip` 独立工具 |
| 媒体/理解 | `get_media`（含 inspect）/`search_media` / `read_transcript` / `find_transcript`（P0-3） | 查询类按「读什么」分，不按「对谁读」分 |
| 生产 | `start/get+subscribe/control(action)/decide/revise/review/materialize` | 保持 9 个（每个是独立副作用域，不值得合并） |

### 第二层 · 增长政策（写进工程纪律，防再膨胀）
1. **新能力 = 现有 ops-union 工具加一个操作分支**，不是新工具（kernel 加操作→契约 derive，见 P0-2）。
2. **新工具只允许在「新副作用域」**出现：读写/计费/审批三类边界之外不开新工具。
3. **Mask, don't remove**：capability 工具组就是我们的 mask——工具名保持 `nomi_` 前缀+域前缀，组级遮蔽不增删 schema（保 KV-cache 前缀稳定，Manus 原则）。
4. **反馈质量是原语的一半**（SWE-agent）：每个原语的拒绝理由必须「说清哪个字段、合法值、下一步」——这正是 P0-1·A1 在做的事；工具面收敛后单工具的 feedback 投入反而应该加码。

### 第三层 · 长尾延迟加载
- 工具面 >30 或 MCP 外部宿主场景 → ToolSearch 延迟激活（P2 已登记触发条件）。
- **不给内置 agent shell**：Claude Code 的「Bash 万能口」在 Nomi 语境 = 安全边界破坏（本地文件/密钥/任意进程）；外部 agent（Codex/Claude Code）经 MCP 调用时自带自己的 shell——我们的 MCP 面保持小而声明式即可，这是有意的差异不是缺失。

## 四、对既有方案的修正

- P0-2 的 `edit_timeline` 设计从「对齐 OpenChatCut 粒度」正式改为「**kernel 原语投影，永不拆分**」——并把本政策作为拒绝「加 XX 独立工具」类需求的依据（R20 build-vs-buy 的工具面版本）。
- P0-3 的 `read_transcript`/`find_transcript` 保持两个：它们是两种查询意图（浏览 vs 定位），不是两个数据源——符合「按意图分不按对象分」。
- 长期看 `read_canvas_state`/`read_timeline`/`read_transcript` 可评估合并为 `read_state(projection)` 单工具——**收益是上下文，代价是投影参数复杂度**；挂 P2 评估，不在第一批动。

## 五、一句话

**少工具不是目标，少工具是「原语+组合+反馈质量」三件事做对之后的自然结果。** 我们的 kernel+CAS+derive 契约已经把前两件做对了；把「新能力=加操作分支不是加工具」写成纪律，工具面就会停在 16 附近，而 OpenChatCut 们的 120 工具会成为我们营销页上的对比图。
