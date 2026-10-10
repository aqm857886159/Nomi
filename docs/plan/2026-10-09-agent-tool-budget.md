# Agent 工具预算：逐工具列账 + stage_shot 瘦身 + 3D 导演台工具按场景常驻

> 状态：已实现未推送（分支 `chore/agent-tool-budget`）。设计卡（★5 格）+ 方向检查（RW）合一页。

## 设计卡

```
改动名：Agent 工具预算（账 / 瘦身 / 场景常驻）   线：工具预算线   类别：[其他]（模型可见工具面；不花钱、不长跑、无新界面）
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当创作者在不开 3D 导演台的情况下和 Agent 聊天时，不该每一轮都为导演台的 3534 个 schema token 付钱（占 10k 上限 35%）；打开导演台再提「推一个镜头」时，Agent 要真有 `stage_shot`。**不做**：不改 `stage_shot` 的执行 / 审批 / 参数语义；不做「找工具」元工具（A）和服务端 tool search（E）。**已知坑**：进出导演台会让工具前缀变一次，提示缓存失效一次（见 ★4）。**真实任务**：① 画布上不开导演台问「帮我规划这几个镜头」→ 清单里没有 `stage_shot`；② 打开导演台后「给镜头 3 推个近景」→ 清单里有 `stage_shot` 并能执行；③ 不开导演台时说「帮我做个双人对话的灰模预演」→ 模型如实说「先打开 3D 导演台」，不假装做了。 | `tests/agent-runtime/lane-scene-tools.test.mts`（真 HTTP、真 pi 循环）；③ 的真模型抽检由协调会话跑（本线不做付费调用，**unverified**） |
| ★1b 连带界面 | 无新增界面文字。Agent 面板上 `stage_shot` 的工具行 / 回执文案不变。模型在非导演台场景被要求做导演台的事时，口头说「先打开 3D 导演台」——这句是系统提示词里给模型的指引（英文，模型按用户语言复述），不是应用文案。 | `laneSceneUnavailableNotice`（`electron/agentLane/lanePromptSections.ts`）+ 测试 2 |
| ★2 谁说了算 | 「哪些工具属于哪个场景」→ 工具声明（`VerbDeclaration.residentScene`，`verbDeclaration.ts`）是唯一 owner；「用户此刻站在哪个场景」→ 渲染端的导演台会话登记（`directorSessionRegistry.isAnyDirectorSessionOpen`）是唯一事实源，随每次发送带一个布尔 `directorOpen`；「这一轮清单是什么」→ 宿主 `syncScenes`（`laneHost.mts`）。存一份、不推断（不靠“东西不见了”去猜意图）。门岗与宿主共用 `laneSceneToolNames`。 | `node scripts/door-map.mjs residentScene` |
| ★3 一致与复用 | 复用 pi 公开的 `lane.setActiveTools`（与 `nomi_request_tools` / 旧会话升级同一支笔），不写第二套激活状态；没有自研工具检索。pi 0.85.1 没有 tool-search 扩展 / MCP 暴露模式，见下「pi 0.85.1 核实」。 | `git grep residentScene` |
| ★4 全状态 | 导演台关：清单无 `stage_shot`，提示词里有「本轮不可用」一句。导演台开：清单有，提示词无该句。刚进 / 刚出：前缀变一次（缓存冷一次），之后同场景内稳定（循环测试里 6 轮：冷、热、**进=冷**、热、**出=冷**、热）。恢复旧会话：旧会话里持久化的清单可能带着 `stage_shot`，打开时按「关」收一次。隐藏的工具被模型硬调：pi 当作未知工具报错，工具不执行（测试 3）。能力不可用：开关关的构建没有导演台版 `stage_shot`，行为与今天逐字相同。 | 测试 1–4 |
| ★9 验收与回滚 | 验收：另一条线跑 `pnpm exec tsx scripts/check-model-schema.ts`（开关开 / 关各一遍，见 PR 正文数字）、`lane-scene-tools` 四条、`check-model-schema.node-test.mjs`。回滚：revert 本 PR 的提交；不涉及数据格式（旧会话里的 `activeToolNames` 配置条目照常可读）。 | PR 正文 |

### 缓存代价（合同第 3 条要求写清）

进出导演台各让工具前缀变一次 = 提示缓存冷一次。这是有意接受的：一次会话里进出导演台的次数很少，而不开导演台的每一轮都省下 `stage_shot` 的 schema 与提示词条目。真实供应商的 `cacheRead` / `cacheWrite` 需要真模型调用，本线不做付费调用，**记 unverified**；PR 里给的是本机回环里「前缀与上一次请求逐字相同才算命中」的模拟数字（`tests/agent-runtime/lane-scene-tools.test.mts` 第 4 条的 `t.diagnostic`），标明不是供应商数字。

## 方向检查（`fix-churn` 命中：`laneHost.mts` 近 14 天 5 个 fix，`writeVerbs.ts` 5 个，`directorPlanSchema.ts` 目录 3 个）

### 0. 一句话根因

「所有模型可见 schema 全部常驻」是 B1c 为了保缓存做的架构前提，它没有给“只服务某个场景的工具”留位置，于是每加一个大工具就把唯一的 10k 上限往边上推（开 3D-BOX 时 9997，只剩 3）。

### 1. 归类表

| 提交 / 现象 | 直接原因 | 类 |
|---|---|---|
| `026652ab1` B1c 把按组切换改成全部常驻 | 切组会改前缀、让缓存失效 | 工具面只有“全常驻”一档，没有“按场景”一档 |
| 开 3D-BOX 后门岗 9997 / 10000 | `stage_shot` 一个 3534 token | 同上：新加大工具的代价无处可放 |
| 门岗只打印组合总量 | 没有逐工具账 | 新加的工具不显形 |

### 2. 为什么会一直出现

判据（全部常驻 ≤ 10k）和装配（全部常驻）是同一个前提的两半：前提不变，每个大工具都会撞同一堵墙。本次不是又补一个特例分支，而是把“场景”做成声明里的一等维度（一个字段、一个宿主函数、一个门岗维度），以后新增场景工具只写一个声明字段。

### 3. 不改结构会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 下一个大工具（或 `stage_shot` 再长一点）在开 3D-BOX 的构建里直接让门岗红 | `NOMI_DIRECTOR_3DBOX=true pnpm exec tsx scripts/check-model-schema.ts` |
| 每一轮对话都在为用不上的导演台付 schema + 提示词 token | PR 正文的前后逐工具账 |

### 4. 靶子独立性

门岗的 estimateTokens 是 pi 自己的估法（chars/4），不是供应商 usage；本次不改判据和上限，只改“判哪些组合”。

### 5. P0

这不是我们独有的领域：通用的是“工具搜索 / 延迟加载”。pi 0.85.1 对应能力见下一节；A（找工具元工具）、E（服务端 tool search）已由协调会话定为以后再做。本次只做领域内独有的部分——“导演台是不是开着”这个产品事实 → 哪些工具可见。

### 6. 补 / 换 / 删 对比

| 选项 | 做什么 | 推荐 |
|---|---|---|
| 接入现成方案（A / E） | 找工具元工具 / 服务端 tool search | 以后（协调会话已定顺序） |
| 补 | 在 `stage_shot` 上加特例分支 | 否（第三个特例分支） |
| 换 | 把“全部常驻”换成“常驻 + 按场景”，同一提交里门岗判据一起换 | **是**：旧的“全部常驻”判据被“各场景组合的最大值”替换，没有并行版 |
| 删 | 删 `stage_shot` | 否 |

### 7. 用户要权衡的核心

不开导演台时让 Agent 少看到一个工具、换来每轮更省 token；代价是进出导演台各冷一次缓存，并且在导演台外 Agent 不能“顺手”建导演台节点（要先打开导演台）。

## 系统改进

- 为什么会发生：工具面只有“全常驻”一档，判据也只有“全部同时在”一种口径，新增场景化的大工具没有合法位置。
- 系统哪里没拦住：门岗只打印组合总量，没有逐工具账，新工具不显形。
- 补了什么（强弱）：结构上做不出来——`residentScene` 进声明，场景工具不进常驻目录（`LANE_MODEL_TOOL_CATALOG` 过滤掉它们），回到“全部常驻”需要同时改声明和测试；门岗——逐工具账 + 场景组合判据 + 结构断言（开关开时 `stage_shot` 必须是场景工具，回退即红，变异已验）。

## pi 0.85.1 核实（只核实，不改）

结论：**升级 pi 不是接上 A 方案的前提；0.85.1 里没有上游新版的 tool-search 扩展和 MCP 暴露模式。**

已核（安装包 `node_modules/@earendil-works/*` 0.85.1 的实际内容）：

- 没有 tool-search 扩展：`pi-coding-agent/dist/extensions/` 只有 `index.*` 与 `llama/`；全包检索 `createToolSearchExtension` 无命中。没有 MCP 暴露模式（`direct` / `deferred` / `codemode` / `hidden`）：`pi-coding-agent/dist`、`pi-agent-core/dist` 检索 `codemode` / `exposure` 只命中无关的 `lane.d.ts:53` 注释；`docs/usage.md:309` 明写“有意不含内置 MCP”。
- `setActiveToolsByName` 在 `pi-coding-agent/dist/core/agent-session.d.ts:318`（实现 `agent-session.js:659`），但那是 coding-agent 的 `AgentSession`；Nomi 用的是 `pi-agent-core` 的 `AgentHarness` / `AgentLane`，对应的是 `lane.setActiveTools(names, context)`（`pi-agent-core/dist/harness/runtime/lane.d.ts:87`），整体替换语义。
- 0.85.1 自带的是“动态工具加载”：`pi-coding-agent/docs/extensions.md:2365`（Dynamic Tool Loading）——工具结果上声明 `addedToolNames`（`pi-agent-core/dist/types.d.ts:325`），pi 在下一次请求前把它并入激活清单（`pi-agent-core/dist/harness/runtime/drive/tool-placement.js:137-156`）。**纯增量**时，原生支持的模型（Anthropic Sonnet/Opus/Fable 4.5+，非 Haiku；OpenAI gpt-5.4+，文档 `extensions.md:2381`）把新定义放在工具结果位置、保住前缀；其余模型、以及非纯增量（含“移除”）走回退——整表重发，缓存失效（`extensions.md:2392`）。代理 / 自定义模型要显式开 `compat.supportsToolReferences`（anthropic-messages）或 `compat.supportsToolSearch`（openai-responses），见 `pi-ai/dist/types.d.ts:546-548`、`616`。
- 对本次的含义：①进出导演台发生在**用户消息准入**而不是某个工具结果上，用不上 `addedToolNames`，只能走整体替换（本次的“冷一次”）；②A 方案（找工具元工具）今天就能用 `addedToolNames` 做（`nomi_request_tools` 已经在用同一机制承载 coding 组），不需要升级；③E 方案受 compat 开关与模型白名单限制，DeepSeek / Qwen / MiniMax 等走 openai-completions 的主力模型仍是整表重发。
- 未核（要升级到上游新版才能查，且本线不联网查证）：调研报告里提到的上游 `tool-search` 扩展和 MCP exposure 模式的具体接口——**unverified**，按报告原话，不写成事实。
