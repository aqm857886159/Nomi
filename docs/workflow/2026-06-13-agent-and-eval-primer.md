# Nomi Agent 与评测体系——审读讲义 + 论文导读

> **这份文档是什么**：给你（项目所有者）审读用的整体讲义。三个部分：
> A. 我们的 agent（harness）到底是怎么设计的——每个机制讲到 file:line，配通俗讲解;
> B. 我们的评测体系是怎么设计的——以及它和业界共识的对应关系;
> C. 相关论文与开源设计导读——每条标注「我们抄了什么 / 没抄什么 / 为什么」。
>
> **和已有文档的关系**：本文是**历史讲义**（解释当时为什么），不是当前真相源，
> 其中 EventLog/NomiEvent 只作研究语汇。当前 runtime 施工真相是
> `docs/superpowers/specs/2026-08-22-runtime-ownership-adr.md` 与
> `docs/superpowers/plans/2026-08-22-mcp-ai-generation-vertical-slice.md`；
> 任何冲突以最新 ownership ADR 为准。
> 日期：2026-06-13。代码引用以当日 main（`5c7eab9`）为准。

---

# Part A · Agent 设计

## A0. 通俗讲解：一句话和一个比喻

**一句话**：AI 永远只能"提议"，落地权永远在用户手里，而每一步都记进一本不可涂改的账。

**比喻**：把 Nomi 想成一家有严格财务制度的工作室——

- **AI 是设计师**：能看图纸（读画布）、能画草稿（提议节点）、能写采购单（提议生成），但**没有公章**;
- **你是老板**：每张采购单都要你签字（确认门），签字前一分钱不许花;
- **EventLog 是总账**：谁在什么时候做了什么、谁批的、花了多少，全部按顺序记账，**只许追加不许涂改**;
- **画布是仓库现状**：仓库里有什么 = 把总账从头算一遍的结果（"画布是日志的投影"）;
- **记忆卡是便签**：从总账里提炼出"老板喜欢暖色调""主角是只橘猫"贴在墙上，AI 每次干活前先看一眼;
- **撤销是红字冲账**：不撕账页，而是追加一笔"冲销"——历史永远完整。

这套比喻里每一项都精确对应一个代码模块，下面逐个讲。

## A1. 总架构：一条日志、两台泵、三道门、五个投影

```
            ┌────── Loop-A 对话泵(秒级,烧 token,产提议)──────┐
 用户 ⇄ AI 面板 → runAgentLoop(streamText 多步工具) → 确认门 → 画布
                                                              │
            ┌────── 画布 = EventLog 的投影(唯一交接面)◄──────┘
            │
            └→ Loop-B 生成泵(分钟级,烧额度,产资产):
               拓扑波次 → 计划确认门 → 预算门 → vendor 调用 → 技术自检 → 回画布
                              │
 ┌─────────────────────────────▼─────────────────────────────┐
 │  per-project append-only EventLog(electron/events/)        │
 │  canvas.* agent.* vendor.* review.* context.* memory.* undo │
 └──┬──────────┬──────────┬──────────┬──────────┬─────────────┘
    ▼          ▼          ▼          ▼          ▼
 人话进度    人话错误    成本数字    配方/对账    记忆卡   ← 用户只见投影,不见日志
```

**为什么是两台泵**：编码 agent 只有一个 loop（工具调用近乎免费、可随便重试）。创作域的"执行"= 花真钱、等几分钟、不可白嫖重试——所以对话（产提议）和生成（产资产）必须是两台节奏不同的泵，交汇面是画布，因果链是对账。这是 Nomi 和所有编码 harness 最大的结构差异。

**设计第一不变量**：任何事件类型，没有产品投影（进度文案/错误卡/成本数字/配方/记忆卡之一）就不准进 schema——禁止"先铺日志再想产品"。

## A2. 六模块逐讲（H = E, T, C, S, L, V）

这个六分量框架不是自创的，与 2026 学术综述 [Agent Harness Engineering: A Survey](https://github.com/Gloriaameng/Awesome-Agent-Harness)（110+ 论文、23 系统）的 H=(E,T,C,S,L,V) 模型对齐。每个模块按「定义 → 我们怎么做 → 为什么这么做」讲。

### E · 执行循环（`electron/ai/agentLoop.ts`，86 行）

**定义**：思考 → 调工具 → 执行 → 喂回 → 再思考，到收敛才停。

**我们怎么做**：全仓**唯一**的循环内核 `runAgentLoop(req, hooks, {mode})`。对话（stream）和模型接入向导（oneshot）共用同一台发动机。三条不变量写死在文件头注释：
1. 零模块级可变状态——可重入，为将来 Subagents 零成本预留;
2. 坏 JSON 自修复（`createToolCallRepair`）全仓只此一份——弱模型吐出不合 schema 的工具参数时，让**同一个模型自己修自己的 JSON**（temperature 0.1，修不好返回 null 走原始报错）;
3. 确认门焊在工具层，对话历史归调用方——内核只负责"开一轮循环"。

**护栏**：maxSteps 按 skill 分档（planner 24 / 默认 8，`agentChatHarness.ts:96`——旧的硬编码 5 步曾静默截断长分镜计划，真 bug 修出来的）;retry=3;首字块 90s 超时（`agentStreamConsumer.ts`——只超"等模型首响应"，不超"等用户确认"）。

**为什么**：曾经有两套 loop（对话一套、onboarding 一套），repair 逻辑字节级重复——S0 合并时同 commit 删掉旧的（P1 加新必删旧）。

### T · 工具（`electron/ai/canvasTools.ts` + `agentChatV2.ts` 的 makeAgentTool）

**定义**：agent 的手脚，**每只写操作的手上都焊着确认门**。

**我们怎么做**：6 个画布工具 + 5 个文档工具，全部 zod schema。关键设计：
- **主进程的工具故意不带 execute**——真正执行在渲染进程 `applyCanvasToolCall.ts`。LLM 发 tool_use → emit 到 UI → 用户看到计划卡 → 点确认 → 结果喂回 LLM 继续循环。这就是 LangGraph 的 interrupt 思想，但用一个 Promise（`awaitToolConfirmation`）实现，零框架依赖。
- **clientId 间接寻址**：LLM 给自己提议的节点编临时 id，同一轮里连边可以引用还没创建的节点;真实 nodeId 在确认后由渲染层铸造并回填映射。
- **`run_generation_batch` 的受理语义**：批准前零网络调用零扣费;批准 = 受理并启动，返回回执但**不把生成结果喂回 LLM**——分钟级进度走画布事件，不阻塞秒级对话回合，不烧 maxSteps。这是两台泵的接缝。
- **位置不信 LLM**：节点坐标由渲染层 derive 成紧凑网格——LLM 手写像素坐标必溢出视口（真 bug）。

### C · 上下文管理（`electron/ai/agentChatHarness.ts`）

**定义**：决定每次喊模型干活时"它脑子里装什么"。不爆窗口、不丢关键、不多花钱。

**三层机制**：
1. **硬截断**（`capAgentHistory`）：30 条消息 + 24k token 双上限;裁剪可能砍断 tool-call/tool-result 配对，所以裁后丢弃开头的孤儿 tool 消息（provider 会拒收）;
2. **旧轮工具载荷压缩**（`compactOldToolPayloads`）：最近 8 条之外的工具参数/结果，长字符串截到 120 字——模型对旧轮只需要"做过什么"，不需要逐字原文（每请求省 2-3k token）;
3. **项目记忆卡**（`electron/memory/projectMemory.ts`）：EventLog 的物化视图。零 LLM 规则提炼器抓高置信事实（建角色卡→character、用户改了 AI 提议的哪些字段→最强偏好信号、锁卡→constraint），一句人话注入 system prompt（预算 ≤1.5k token）。两条硬规矩：**用户纠正的事实自动提炼永不静默覆盖;用户删除留墓碑**（删除点之前的旧事件不再重提炼同一事实，之后的新事件可以——重新上锁理应重新记住）。memory.json 可删，从日志全量重建结果等价。

**摘要压缩有意没做**，挂了触发器：`context.capped` 事件一周 ≥3 次或出现"AI 忘了我说的"反馈才做。理由：长对话里值得记住的大半是持久事实，本该住记忆卡随 system 常驻，不该赖在历史里怕被裁。

**省钱的细节**：Anthropic 系模型 prompt 缓存打**双断点**（system + 最后一条消息，`buildAgentPromptParts`），把增长的对话历史也纳入前缀缓存;非 Anthropic provider 字节不变（P4 通用第一）。配套跨 provider 采集缓存命中 token（`agentStreamConsumer.ts:51`）——没测量就谈不上优化。

### S · 状态/会话（EventLog 地基 + 分桶历史）

**定义**："关了再打开，一切还是离开时的样子"——项目状态字节级强接续;AI 对话**弱但诚实：可以断，不许装没断**。

**我们怎么做**：
- 对话历史内存 Map 按 `nomi:workbench:<projectId>` 分桶（修掉了跨项目串台的真 bug）;
- **历史里只存简短 displayPrompt，不存含整张画布快照的完整 prompt**——否则每轮各存一份旧快照，token 雪崩;
- 「新会话」分隔线：重启后气泡还在但 LLM 记忆空 → UI 必须画分隔线「之前的对话 AI 已不再记得」。不变量：**UI 呈现的"AI 记得的范围" ⊆ LLM 实际范围，宁少不多**——假透明比不透明更糟;
- EventLog（`electron/events/eventLogRepository.ts`）：全仓唯一写者;seq 主进程统一编号（跨进程 ULID 不保序，顺序权威只能有一个）;崩溃撕裂尾行写读两侧成对处理;单事件 ≤4KB，超限字段截断 + 全文落 sidecar，读回自动还原;落盘前递归脱敏;**任何 IO 失败只 console.error，绝不打断产品主流程**（旁路观察的纪律）。

### L · 权限闸门（`src/workbench/generationCanvas/agent/gate.ts`）

**定义**：AI 想动你的作品/花你的钱之前必经的那道门。创作域比编码域多管两道：**花钱**和**创作主权**。

**我们怎么做**：散落的 if 收敛成一个纯函数 `evaluateGate(intent, ctx)`，三步求值：
① policy（只读 → 直通零摩擦）② invariant（锁/校验 → deny，带人话理由）③ ask（其余等用户点头）。
- 工具分级是声明式 TOOL_META 表（writes/destructive/costy），不认识的工具直接 deny——安全默认;
- **锁的语义**：锁面 = 改 prompt / 删除 / **入边**（改变生成输入）→ deny;**出边放行**——锁住的角色定妆卡被引用当参考恰是定妆用途（"不许改它，尽管用它"）;
- deny 发生在**提议构建时**而非批准后——不让用户批准注定失败的计划;deny 的人话 reason 回喂 LLM，模型能自我修正;
- 决策入日志的裁剪：deny 必入、ask 的结果入、只读 allow 不入（纯噪声）。

**提议事务**（`proposalTxn.ts`）是 L 的执行臂：一笔提议 = 一个 proposalId = 一次原子批量。边应用边攒补偿计划（建节点记删除、连边记差集、改 prompt 记旧值），中途失败 = 补偿回滚到提议前投影、零半截;commit 必带对账（`reconcile()` 逐字段比对执行终态 vs 批准快照，偏差不静默）;编辑哨点保证整笔撤销前**列明用户后来改过的内容再丢**。四不变量进了 CI：I1 任何 agent 来源的画布事件因果链必回指一个 approved（"AI 背着我改"在结构上不可能）;I2 deny 必入日志;I3 拒绝/中止后画布逐字节复原;I4 committed 必带对账。

### V · 轨迹/评估接口（`electron/events/agentChatTrace.ts` + `vendorCallTrace.ts` 等）

**定义**：把"AI 替你创作的每一步"变成可翻译的账本——向下撑复现/对账/审计，向上翻译成人话。**账本永不直接见用户，见用户的只有五个投影**。

**关键机制**：
- 因果链三层：`causeId`（事件级因果）→ `txnId/proposalId`（事务 = undo 单位）→ `runId`（vendor 配对键）。"哪个镜头哪步为什么错" = 沿链反走;
- **人话翻译单源**：`narrate.ts` 注册表 + TS 穷举强制——新增事件类型不补文案则 typecheck 红;展示组件只准调 narrate()，字面量文案 review 必拒;
- **结构化错误修在压扁处**：vendor HTTP 错误带 `{httpStatus, logicalCode, category(401→auth/402→balance 查表不是猜), retryable}` 结构化穿透，不再压成字符串让下游正则反猜;
- **NormalizedRecipe 一份数据三用途**：配方面板（按此配方重出）/ 指纹缓存（`fingerprintCache.ts`，参数没动→秒回零花费，**命中也入日志**——零调用的"秒回"必须可观测）/ 复现。诚实边界写进注释：同配方+seed 不保证 vendor bit 级复现，敢承诺"一模一样"的只有缓存命中;
- **技术自检只标记不拦截**：ffprobe 黑帧/静音/破损 → 节点 ⚠ + 人话 + 一键重跑;**绝不静默丢弃、绝不自动重跑**——用户主权第一，AI 没资格替用户扔结果（这条是明确不抄 OpenMontage 的"review 不过就不呈现"）。

### 有意留薄的三件（升级信号写死）

| 留薄项 | 为什么不做 | 什么信号才做 |
|---|---|---|
| Subagents | ViMax 实证单 loop + 阶段 prompt 跑通全流水线;Nomi 有人在回路，用户本人就是 judge | 某 skill 压缩后仍爆窗口 / VLM 审美拍板要做 / 自审系统性偏高 |
| MCP | 24 需求点零命中 | 首个外接需求出现（届时工具必经 makeAgentTool 确认门，信任边界外不免审）|
| Role 注册表 | 一个人 + 一个 agent，事件 source 字段已是雏形 | 第二个并发 loop / 差异化权限 / 多人协作 |

**反信号也写了**："显得高级 / 想起名 / 想并行"不构成升级理由。这是整套设计里最值得学的纪律：**每个不做的决定都有书面的触发条件，而不是"以后再说"**。

---

# Part B · 评测体系设计

## B0. 通俗讲解：体检 + 病历 + 复查

五门 CI 只能回答"代码健康吗"，R13 走查只能回答"界面顺不顺"。**没有任何机制回答「AI 拆镜头拆得好不好」**——这恰是产品核心价值。评测体系补的就是这个闭环：

```
真实使用轨迹落盘 ──→ 攒够一批看病历(error analysis,找失败模式)
       ↑                        │
       │                        ▼
  修根因(P2) ←── 失败模式变成评测用例(dataset)
       │                        │
       └──→ 复查(重跑评测,回归 diff) ──→ 用例锁死不复发
```

迭代节奏从"用一下感觉怪怪的"变成：**评测发现 → 分级 → 修根因 → 用例锁死 → 下一轮**。

## B1. 五层模型——"确定性断言能覆盖的绝不用 LLM"

| 层 | 评什么 | 怎么评 | 成本 |
|---|---|---|---|
| L0 | mapping/archetype/schema 正确性 | 942 个 vitest 单测（五门 CI）| 零 |
| L1 | agent 终态：节点数/prompt/参数/连边 | 真 Electron 隔离实例跑真 agent + 终态断言 | 小额度 |
| L2 | 拆镜头质量、指令遵循 | LLM-judge（须先校准，未校准不计 pass）| 中额度 |
| L3 | 生成产物 | L3a ffprobe 技术自检(免费) / L3b VLM 客观缺陷(抽样) | 零~中 |
| L4 | J1-J5 旅程 | 断言只是下限门，**R13 人眼穿透不被豁免** | 小 |

## B2. 八个关键机制（每个都有出处）

1. **两段式跑/评分离**（`scripts/eval-run.mjs` / `eval-score.mjs`）：跑一次花额度，先落 JSONL;评分器免费可反复重跑。抄 promptfoo 的数据面 + OpenHands benchmarks 的执行面。
2. **真 Electron 隔离实例取证终态**（`evals/lib/isoApp.mjs`）：每个 case 全新 app 实例（项目目录 + userData 双隔离），跑完**取证画布落盘终态——不信 agent 自述**。为什么不做"事件重放拼终态"：渲染层 derive 逻辑（网格布局/归类/meta 补全）抽不净就是第二份语义，违 P1。
3. **infra 错误与行为失败分开计数**（`evals/lib/grading.mjs`）：端点超时/429/空流是基础设施问题，重试一次;**行为失败不重试——那正是要测的东西**。"空流检测"（turn 名义 ok 但零文本零工具零 usage）是 2026-06-12 真实 vendor 事故当天实测出的端点降级形态，当天进评分器。
4. **评测安全门**：每个 case 断言 `vendor.call.requested === 0`——评测环境**结构性不许花真钱**;单次 run case×trial ≤60 硬上限。
5. **judge 铁律**（`evals/lib/judge.mjs`）：未对人工标注校准到 P/R≥80% 前，判决只展示参考绝不计 pass;few-shot 来自专家 critique 且 pass/fail 各半防单边;judge 输出解析失败冒泡为 error 不静默当 fail;弃 1-5 打分制只做二元 + 理由（可行动）。
6. **dataset 纪律**（`evals/datasets/storyboard.mjs`，16 case）：含数字干扰（"店里 10 种甜品但只要 3 镜头"）、指令遵循反例（"不要连线"→maxChainEdges:0）、反向用例（点名要 video 才建 video）。扩充**只准来自真实失败**，占比 ≥60% 是运转验收线——防 eval 集变成自嗨题库;pass 率 100% = 集子太弱，触发扩容。
7. **capability / regression 双生命周期**：新 case 进 capability（~70% 通过率是健康态）→ 连续 3 次全过毕业进 regression → regression 破了 = P0。
8. **节奏按数据量不按日历**：单人项目没有外部流量，轨迹 = dogfooding 攒的;攒够 ~50 条才触发 error analysis（`check:audit` 提醒），不硬转。LLM 在环的评测**提醒不阻断**、不进五门（非确定 + 烧额度 + 断网不可跑）。

## B3. 已实证 + 还欠的

循环已转通：施工期抓出并修掉 2 个真 bug（prod projectId 解析、agent 连线 clientId 吊边），各配回归锁。实测账：冒烟 5 case ≈3 分钟 ≈11 万 token;全量 15 case ≈10 分钟 ≈31 万 token。

**还欠你三件事**：① `evals/judge.config.json` 填便宜档 judge key;② 查看器标注 ≥10 条导出;③ 拍板 Q1（默认连线？）/ Q2（宣传片默认 image 还是 video？）——见 `docs/audit/2026-06-12-eval-error-analysis-v1.md`。

---

# Part C · 论文与设计导读

> 按「读它学什么 → 我们抄了什么 / 没抄什么」组织。标 ⭐ 的是建议精读的五篇/个，其余按兴趣。
> harness 侧更完整的拆解（含核实程度声明）见 `docs/plan/2026-06-10-nomi-harness-teardown-reference-pool.md`。

## C1. Agent / Harness 架构

| # | 资料 | 读它学什么 | 我们的取舍 |
|---|---|---|---|
| ⭐1 | [Agent Harness Engineering: A Survey](https://github.com/Gloriaameng/Awesome-Agent-Harness)（2026 综述，110+ 论文 23 系统）| H=(E,T,C,S,L,V) 六分量模型——本文 Part A 的骨架就是它;V（评估接口）是多数 harness 最弱的一格 | 框架全盘对齐;V 按 OpenHands 风格做深 |
| ⭐2 | [OpenHands 事件存储与重放](https://deepwiki.com/All-Hands-AI/OpenHands/12.2-event-storage-and-replay) + [SDK 论文 arXiv:2511.03690](https://arxiv.org/html/2511.03690v1) | **事件溯源金标准**：一切皆不可变 typed Event，append-only EventLog 同时是 agent 记忆 AND 审计日志;因果链（tool_call_id 指回 action）;压缩本身是可回放事件;resume = base_state + 重放 | 抄了：append-only / causeId 因果链 / "日志即真相、画布即投影" / 拒绝即事件。没抄：它的 Python 运行时和 delegation |
| 3 | [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-python) | hook 机制（PreToolUse/PostToolUse）、parent_tool_use_id 线索、分层权限求值 | 抄了：确认门思想、deny 回喂。没抄：hook registry / permission mode / 规则 DSL（单用户桌面无配置面消费者，6 步求值砍成 3 步）|
| 4 | [PRISM（arXiv:2603.11853）](https://arxiv.org/abs/2603.11853) | L 做到极致的样子：10 个生命周期 hook、防篡改审计日志、决策全入账 | 抄了："决策入日志""撤销=追加补偿事件，历史永不改写"的纪律。没抄：10-hook 取证栈（治理场景才需要）|
| 5 | [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | 反框架宣言：组合简单模式（routing/orchestrator/evaluator）优于上重框架;多数场景一个 loop + 好工具就够 | 我们整个"有意留薄"哲学（Subagents/MCP/Role 全挂触发器）与此同源 |
| 6 | [LangGraph interrupt / human-in-the-loop](https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/) | 图执行中断等人批准的正式化模型 | 思想已被 `awaitToolConfirmation` 一个 Promise 实现，没引框架 |
| 7 | Martin Fowler: [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html) | 事件溯源的原典：状态 = reduce(events)、投影、快照、补偿事件 | 我们的"Proposal 不是对象是日志投影"“撤销=红字冲账"全是它的应用;读它能看懂 S5 三步（影子→属性测试→翻正）为什么这么排 |

## C2. 创作域 Agent（和编码域的本质差异）

| # | 资料 | 读它学什么 | 我们的取舍 |
|---|---|---|---|
| ⭐8 | [ViMax（HKUDS）](https://github.com/HKUDS/ViMax) + [论文 arXiv:2606.07649](https://arxiv.org/abs/2606.07649) | 最接近 Nomi 的 agent×视频系统。runtime 层：TurnControl + transitions 状态机 + turn_record 落盘 + 抢先式压缩 + 死循环护栏。域机制层：**依赖图+拓扑调度（消融 -8.7%，它最强的结论）**、两步生成（文→关键图→视频，便宜阶段拦废片）、VLM best-of-k 质检（k=2 最优，k≥3 引入选择噪声）| 抄了：拓扑波次调度（S2b）、两步生成引导、k=2 铁律（V-b 若做）。没抄：Python 移植（现有 loop 活着且完整）、全自动形态——论文自己承认 "does not yet address interactive revision"，**交互式修订正是 Nomi 全部设计所在的位置** |
| 9 | [OpenMontage](https://github.com/calesthio/OpenMontage) | 创作域多出的两道门：执行前估价签字（单步超阈值人工批）+ ffprobe 后渲染自检 | 抄了：预算门（S7）、技术自检管线。没抄：7 维 provider 打分（已有 bug① 机制）、硬性封顶、"review 不过就不呈现"（用户主权第一）|
| 10 | [ComfyUI](https://github.com/comfy-org/ComfyUI) + [ComfyMind（NeurIPS 2025）](https://github.com/EnVision-Research/ComfyMind) | 昂贵节点图的增量语义：只重跑变了的节点、指纹缓存、失败局部回溯不全量重生成 | 抄了：指纹缓存（S8，hash(recipe)→秒回零花费）。创作域"重跑=烧钱"逼出的核心架构 |
| 11 | [tldraw](https://github.com/tldraw/tldraw)（只读思想，许可证有风险）| 画布状态建模：document/session 域分离快照、事务、mark/bailToMark 时间旅行 | 抄了：document/session/conversation 三域字段分类（S5 施工清单的理论根据——selectedNodeIds 不入快照不入撤销）。没抄：依赖它（自定义许可证）|

**创作 vs 编码 harness 一句话**：编码 agent 优化「正确性/速度」，创作 agent 优化「成本/审美/可控重跑」——多三道 gate（预算、视觉自审、增量缓存）+ 一套画布历史模型。

## C3. 评测方法论

| # | 资料 | 读它学什么 | 我们的取舍 |
|---|---|---|---|
| ⭐12 | [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)（2026.01）| 词表（task/trial/transcript/outcome 分清）;**20-50 个取自真实失败的任务就够起步**;**评终态不评路径**（"don't grade the path, grade what it produced"）;瑞士奶酪分层（自动评测/生产监控/AB/人工各补各的洞）;有 evals 的团队换新模型快几周 | 我们 §B 的词表、起步规模、"评终态"主干全部对齐;L0-L4 + 人工就是瑞士奶酪的本地化 |
| ⭐13 | Hamel Husain: [Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/) + [Creating a LLM Judge](https://hamel.dev/blog/posts/llm-judge/) | 失败产品的共同根因 = 没有评测系统;**先 error analysis（看数据、open coding 分类失败）再写评测**——评测标准只能在看数据中浮现;LLM-judge 是"骗人认真看数据的 hack";critique shadowing：专家标二元 pass/fail + critique → judge few-shot 对齐 → 测 agreement;**trace 查看器是最被低估的投资** | 我们的 S2（首轮 error analysis）、S1.5（轨迹查看器+标注）、judge 校准铁律（P/R≥80% 前不计 pass）逐条来自这两篇 |
| ⭐14 | [τ-bench（arXiv:2406.12045，ICLR 2025）](https://arxiv.org/abs/2406.12045) | **终态数据库比对**的评测形态（对话怎么走不管，最后数据库状态对不对）;**pass^k 可靠性指标**（k 次全过才算，SOTA 模型 pass^8 <25%——agent 一致性远比单次成功难）| 我们 L1 的"画布终态断言"同构;`grading.mjs` 的 aggregateTrials 同时算 pass@k 和 pass^k（passAllK）|
| 15 | [Evaluation and Benchmarking of LLM Agents: A Survey（KDD'25，arXiv:2507.21504）](https://arxiv.org/abs/2507.21504) | 评测对象（行为/能力/可靠性/安全）× 评测过程（交互模式/数据集/指标/工具/环境）的全景分类法;人工评估在主观维度仍是金标准 | 当地图用：检查我们的覆盖面有没有系统性盲区 |
| 16 | [LLM-as-a-judge 综述（arXiv:2411.15594）](https://arxiv.org/abs/2411.15594) + MT-Bench（arXiv:2306.05685）| judge 的系统性偏差：位置偏差、冗长偏差、自我偏好;二元判定 + pairwise 比绝对打分可靠 | 我们弃 1-5 制、L3b "美"只做 pairwise、judge 强制 JSON + 解析失败冒泡，都是对这些偏差的防御 |
| 17 | [promptfoo](https://github.com/promptfoo/promptfoo)（代码蓝本）| GradingResult 三元组 {pass, score, reason}、断言失败 vs infra 错误分开计数、grader 解析失败不静默当 fail | 类型抄它、执行抄 OpenHands;没引入它本体（prompt×provider 矩阵抽象与单 agent 端到端任务不匹配，且带 SQLite 第二真相源）|
| 18 | [VBench](https://arxiv.org/abs/2311.17982)（视频生成评测）| 把"视频质量"分解成 16 个可独立测的维度（主体一致性/运动平滑度/美学…）——维度分解思想 | L2 rubric 的四候选维度（镜头语言/节奏/连续性/角色一致性）用同样的分解法，但**维度不预设，带进 error analysis 验证**（criteria drift 纪律）|

## C4. 推荐阅读顺序（共 ~6 小时）

1. **先读两篇方法论**（1.5h）：Anthropic Demystifying evals（#12）→ Hamel evals（#13 第一篇）。读完你就有了审读 Part B 的全部判断力。
2. **再读事件溯源**（1h）：Fowler Event Sourcing（#7）→ OpenHands 事件存储页（#2）。读完你能判断 S5"画布翻正到日志上"值不值得。
3. **然后读 τ-bench 论文**（1h，可只读 §3-4）：理解终态评测 + pass^k 为什么是 agent 评测的当前共识。
4. **最后读 ViMax 论文**（1.5h，重点 §2.3 依赖调度和 Limitations）：理解"它是一键流水线、我们是人在回路画布"的定位差，以及拓扑波次为什么值 -8.7%。
5. 剩下的当工具书查。

---

# 附 · 审读清单

读完本文你应该能回答（答不出说明哪一节没讲清，回来骂我）：

**Agent 侧**
1. 为什么是"两台泵"而不是一个 loop？交汇面是什么？
2. "画布是日志的投影"具体指什么？谁是真相源？撤销为什么"免费"？
3. AI 提议的节点还没创建，连边怎么引用它？（clientId）
4. `run_generation_batch` 批准后，生成结果为什么不喂回 LLM？
5. 锁住的角色卡，AI 能引用它当参考吗？能给它接入边吗？为什么不对称？
6. deny 为什么发生在提议构建时而不是批准后？
7. 用户纠正过的记忆事实，自动提炼器能覆盖吗？删除后又出现同类事件呢？
8. Subagents 现在为什么不做？什么信号出现才做？

**评测侧**
9. 为什么"评终态不评路径"？我们在哪个文件取证终态？为什么不信 agent 自述？
10. infra 错误和行为失败为什么分开计数？哪种允许重试？
11. judge 没校准之前，它的判决能计入 pass 吗？校准的门槛是什么？
12. dataset 扩容的唯一合法来源是什么？pass 率 100% 意味着什么？
13. pass@k 和 pass^k 的区别？哪个衡量可靠性？
14. 评测环境怎么在结构上保证不花真钱？
