# Nomi Harness 总体方案(模块定义 × 施工合同)

> **历史文档 / 已废止施工入口（2026-08-22）**：本文保留作研究考据，不能
> 作为当前 runtime 的执行计划或“唯一执行真相源”。当前唯一事实 owner 是
> `ProductionRun`、Run intent/WAL、`RuntimeEnvelope`、outbox 和
> materialization receipt；本文的 per-project `EventLog`/`NomiEvent` 模型不应
> 再新建实现。请改读
> `docs/superpowers/specs/2026-08-22-runtime-ownership-adr.md` 与
> `docs/superpowers/plans/2026-08-22-mcp-ai-generation-vertical-slice.md`。

> **历史文档体系**:本文曾是 harness 的执行草案，现仅作研究记录，按框架模块组织。上游三份保留:
> `2026-06-10-nomi-harness-requirements.md`(要什么:24 需求点/簇 A-F/可控的透明)
> `2026-06-10-nomi-harness-framework-research.md`(为什么自建:框架选型证据)
> `2026-06-10-nomi-harness-teardown-reference-pool.md`(抄谁:参考池+ViMax 论文层)
> 本文**取代** `2026-06-11-harness-landing-plan.md`(其全部内容含评审记录已并入,P1 同 commit 删除)。
> 产出方法:三路代码实测 + 4 个模块设计 agent(E+T / C+S+地基 / L / V)并行设计 + 交叉调和 + 6 角色对抗评审(§9)。
> 日期:2026-06-11。状态:**待拍板点见 §8,拍板后即施工**。

---

## 0. 一页总览

**产品灵魂**(需求文档 §1):可控的透明——AI 在做什么/要做什么/记得什么/花了多少/能不能退回,全部「看得见、够得着、能纠正」,但默认不打扰(渐进披露)。

**框架**:H = (E, T, C, S, L, V) + Subagents + MCP,八件零件(与 2026 学术综述对齐,= Claude Agent SDK 七零件 + V)。本文 §2-§7 给每件零件:定义→机制→借鉴→现状→切片→验收。**框架是完整性对账单:每个改动必须答得出动了哪件零件;每件零件的缺口必须显式记账。**

**总架构(一条日志,两台泵,三道门,五个投影)**:

```
                ┌────────────── Loop-A 对话泵(秒级,烧token,产提议)──────────────┐
   用户 ⇄ AI 面板 → runAgentLoop(streamText 多步工具) → 工具确认门(L) → 画布
                                                                            │
                ┌──────── 画布 = EventLog 的投影(唯一交接面)◄───────────────┘
                │
                └→ Loop-B 生成泵(分钟级,烧额度,产资产):
                   buildDependencyWaves(拓扑波次) → 执行计划确认门(L) → 预算门(L)
                   → vendor 调用 → 技术自检(V) → 结果回画布
                                  │
   ┌──────────────────────────────▼──────────────────────────────────────────┐
   │  per-project append-only EventLog(地基,§1)                             │
   │  canvas.* agent.* vendor.* review.* context.* memory.* undo             │
   └──┬──────────┬──────────┬──────────┬──────────┬───────────────────────────┘
      ▼          ▼          ▼          ▼          ▼
   人话进度    人话错误    成本数字    配方/对账   记忆卡        ← V 的五个投影
  (N3/N4)   (N13/N14)    (N9)     (N20/N12)  (N18/N19)      (用户只见投影,不见日志)
```

**设计第一不变量(贯穿全文)**:任何事件类型,没有产品投影(进度文案/错误卡/成本数字/配方/步骤列表/记忆卡之一)就不准进 schema——"先铺日志再想产品"是被需求文档 §3 注明令禁止的。

**原则对照**(CLAUDE.md):P1 每处新建都点名同 commit 删什么(各切片);P2 三个 bug 全修在根因层(§7.4 错误压扁处/§2 调度层/§5 串台单例);P3 每个 UI 切片配 R13+样张对账;P4 事件 schema 与 vendor 解耦、成本走通用 join;P5 即本文;R9 S5 第 0 步先拆壳过棘轮。

---

## 1. 地基:EventLog(C/S/V 共享底座)

**定义**:项目的"创作账本"——用户、AI、runtime 对项目做过的每件**事实**按序记成不可涂改的流水。画布是流水算出的余额,记忆是流水的摘要,轨迹是流水本身。

### 1.1 Schema(v1 定稿)

```ts
type NomiEvent = {
  v: 1;                   // 事件版本,载入按 upcast 链迁移(仿 projectV51ToV60 先例)
  id: string;             // evt_<ulid>(产生端铸)
  seq: number;            // ★主进程 append 时统一编号——全局顺序唯一权威(跨进程 ULID 不保序)
  ts: string;             // ISO 8601
  source: 'user' | 'agent' | 'runtime' | 'system';   // = 角色 Role 的雏形(§5.6)
  causeId?: string;       // 因果链:被哪个事件引起(OpenHands 命门机制)
  txnId?: string;         // 事务/手势分组:agent 提议批次 或 用户一次手势 = undo 最小单位
  proposalId?: string;    // agent 提议批次(txnId 的特化标注)
  type: string;
  payload: Record<string, unknown>;   // 单事件 ≤4KB(写入端断言),大 payload 截断+sidecar
};
```

**链路键三层(字段级对齐,评审 P1 定稿)**:
- `causeId` = 事件级因果(被哪个事件引起);**Subagents 的 `parentEventId` 不是新字段**——它只是 hooks 的参数名,落到子循环事件即 `causeId`(= 父工具事件 id)。
- `txnId`/`proposalId` = 事务/手势分组(undo 与对账的单位)。
- `runId` = **vendor 域 payload 内的配对键**(同一次生成的 requested↔completed 配对),不是事件级字段。
- 用户直接点生成(不经 agent):`vendor.call.requested` 的 `source:'user'`、无 causeId——**用户手势本身就是根因,链路终点即它**。因果不变量据此精确化:source:'agent' 的 requested 必须经 causeId 走回一个 `agent.proposal.approved`;source:'user' 的不需要。

**事件域全表**(每个域右列 = 它的产品投影,即"为什么有资格进 schema"):

| 域 | 事件 | 产品投影 |
|---|---|---|
| canvas | `node.added/updated/moved/removed`、`edge.connected/disconnected`、`group.*`、`node.prompt-changed`、`node.result-added`、`node.locked/unlocked` | 画布本身 + 撤销 |
| agent | `turn.started/finished{finalTextHead≤2KB+hash}`、`tool.proposed`、`proposal.approved{effectiveArgs, overridesDelta}`(全量给对账用,增量给记忆提炼用)、`proposal.rejected`、`txn.committed{reconciliation}/aborted`、`gate.denied{reason}` | 计划卡/查看步骤/对账/轮次 footer |
| vendor | `call.requested{recipe}`、`call.completed{status,latencyMs,assetRefs,cost,error?}` | 配方面板/成本/人话错误 |
| review | `technical.completed{verdict,checks}`(V-b 拍板后才加 aesthetic) | 节点 ⚠ 自检标记 |
| context | `capped{droppedCount,...}`(将来 `compacted`) | 对话内轻提示「对话太长,AI 已不再记得最早 N 轮」(与 S1 分隔线同一套诚实机制)+ C1 触发器观测 |
| memory | `fact.added/corrected/removed`(S3 占位,S9 实现) | 记忆卡 + 纠正审计 |
| undo | `canvas.undone{targetTxnIds[]}` | 撤销=追加补偿事件,历史永不改写(PRISM 纪律) |

**关键裁定(对话文本边界)**:`agent.turn.finished` 携带 `finalTextHead`(截 2KB)+hash = "AI 说过什么"的**语义真相**;对话气泡 store = **展示缓存**(流式分片/渲染态),不是真相。日志=语义、store=展示,一刀切死,不出双真相。

### 1.2 三消费者契约(只共享读,写路径唯一)

| 消费者 | 消费方式 | 关键不变量 |
|---|---|---|
| **S 状态** | 快照+尾部重放:hydrate=载 project.json(`lastAppliedSeq`)+replay 尾部 | `replay(genesis..N) ≡ snapshot@N`(fast-check 属性测试,CI 锁) |
| **C 记忆** | 物化视图:提炼器读增量(`lastDistilledSeq` 游标)产出 memory.json | 删 memory.json 可从日志全量重建,结果等价 |
| **V 轨迹** | 日志本身:按 txnId/proposalId 过滤渲染;审计=因果链 join | 任一 `vendor.call.completed` 经 runId 配对到 requested;source:'agent' 的 requested 必经 causeId 走回 approved(§1.1 链路键三层) |

写路径唯一:`electron/events/eventLogRepository.ts` 单写者(S3 建,S5 收编一切旁路)。

### 1.3 写盘三件套与重放边界(评审 P1 定稿)

1. 渲染层 ring buffer,`50ms 或 20 条`先到先 flush(批量 IPC `nomi:events:append`);背压=500 条阻塞告警
2. 主进程 `appendFile` 批量写 + 每 1s fsync;**量化丢失窗口 ≤(50ms buffer + 1s fsync)**,对比现状 700ms debounce 同量级但事件粒度可审计(不夸大为"不丢")
3. 载入容忍撕裂尾行(最后一行 parse 失败即截断)

分段:5000 事件或 5MB rotation;undo 检查点每 **50 个 canvas 域事件**一个(只数 canvas 域)。immer 纪律:事件构造一律 plain input/`current()`,freeze 后 append,禁引用 draft(lint 看守)。

---

## 2. 模块 E:执行循环

**定义**:不是一个 loop,是**两台泵抽同一条日志**——Loop-A 规划泵(对话,产提议)+ Loop-B 落地泵(生成,产资产)。编码 agent 只有 A;创作域 B 是一等公民,因为这里"执行"=花钱且不可白嫖重试。两泵在「计划→批准→执行」同一形状下分工,交汇面是画布,因果链是对账。

**服务需求**:N3/N4/N5(B 泵波次=进度源+参考就绪保证)、N10/N12(交汇点确认门+因果链)、N15(txn=撤销单位)、N8/M1(一键确认不挡路)。

**机制要点**:
- **S0 统一内核**:新 `electron/ai/agentLoop.ts`(~150 行)`runAgentLoop(req, hooks, {mode:'stream'|'oneshot'})`,两模式共享 maxRetries=3 + `createToolCallRepair` + `buildAgentPromptParts`。三不变量:① loop 内零模块级可变状态(可重入=Subagents 零成本预留);② repair 全仓一份(同 commit 删 `onboarding/agent.ts:113-141`);③ 确认门留 T 层、history 留 caller。hooks 透传 `parentEventId`(子循环事件挂因果链)。
- **S2b 拓扑波次**:`buildDependencyWaves(nodes, edges, selection) → {waves, blocked, edgesUsed}`(纯函数,环检测);节点开跑前断言全部入边 source 已成功且参考真拿到,拿不到→标"上游参考未就绪"可重试,**杜绝静默裸跑**(修 `generationReferenceResolver.ts:64` 的静默 continue,ViMax 消融:无依赖调度一致性 -8.7%)。
- **护栏对照**:A 泵=maxSteps 8/24+retry 3+首 chunk 90s;B 泵=DAG 必终止+环拒绝+S2b 确认前零调用+S7 预算+S8 缓存。取消语义:A=abort+确认卡全拒;B=停派发、在途保留(vendor 取消能力待核实)。

**借鉴**:ViMax(transitions/turn_record/护栏思想,**不移植 Python**)、ViMax 论文依赖调度、OpenHands 因果链、LangGraph interrupt 思想(已被 awaitToolConfirmation 实现)。

**现状**:两套 loop(`agentChatV2.ts:417-486` vs `onboarding/agent.ts:102`),repair 字节级重复;B 泵平铺 FIFO(`generationRunController.ts:249-284`)。

**切片**:S0 → S2(进度接线)→ S2b → S3(transitions 入轨迹)。
**验收**:批量确认前零调用零扣费(网络断言);依赖链"图先出、视频等图"肉眼可见;Stop 即停无僵尸卡;repair grep 全仓一处;onboarding wizard 真机跑通。

---

## 3. 模块 T:工具

**定义**:agent 的手脚,**每只写操作的手上都焊着确认门**——读直通、写点头、花钱看完整计划。

**服务需求**:簇 F 已落(N2);T1 服务 N6/N7/N9/N10;T2(meta)服务 L 分级。

**机制要点**:
- **T1 `run_generation_batch`**(S2b 门使其结构性安全):schema=`{nodeIds(显式列举,≤48), reason?}`;流转全复用现成管道(makeAgentTool→pendingConfirmations→applyCanvasToolCall 新分支→buildDependencyWaves+estimateGenerationCost→**S2b 同一张确认视图**,P1 不做第二套 UI)。**结构性安全不变量**:handler 永不直接调 runGenerationNode,只产计划对象;花钱唯一入口=用户点确认(回归断言:确认前零网络调用)。工具结果=受理(runId)不等完成(挂起会烧 maxSteps/撞 90s 超时锁死对话)——语义 A vs B 待拍板。
- **T2 meta**:`makeAgentTool` 加 `meta:{writes, destructive, costy, domain}`,L 据此分级(读自动过/写确认/costy 走计划图)——把现在硬编码的"只读自动放行"约定声明化,收编 bug① 余项。

**现状**:10 工具(canvas 5+document 5,zod)+onboarding 第三组;确认门管道 100% 现成;无发起生成工具、无 meta。

**切片**:S0(工具组统一 ToolSet 形态)→ S6(事务语义+T2 顺手)→ **S6b=T1**(S6 后 0.5d,排进 M3 尾,防"记账了漂掉")。
**验收**:R13 J1 扩展「对 AI 说『都生成了吧』→计划卡列波次+总价→确认→真跑→进度动」;拒绝后画布与额度零变化;approved 的 nodeIds ≡ 实际 requested 节点集。

---

## 4. 模块 C:上下文管理

**定义**:决定每次喊模型干活时"它脑子里装什么"——对话装多少、画布喂多精、项目设定(风格/角色/调性)怎么不靠用户重复交代就一直在场。不爆窗口、不丢关键、不多花钱。

**服务需求**:N1/N18/N19(簇 E 全部)+ N5 隐性(上下文丢设定→产出驴唇不对马嘴)。

**三层机制(只有层 1 现在存在)**:
- **层 1 硬截断**(已有,保留):`capAgentHistory` 30 条/24k。
- **层 2 项目记忆卡**(S9):`ProjectMemoryCard{facts: MemoryFact[], lastDistilledSeq}`,`MemoryFact{text 一句人话, kind: character|style|brand|preference|constraint, origin: auto|user, sourceSeqs(下钻溯源), pinned}`。数据流:EventLog→(提炼器,增量)→memory.json(缓存)→注入 system prompt(预算 ≤1.5k token,超了按 pinned>user>auto+新近度裁)。提炼器 v1 **零 LLM**(规则抓高置信事实:建角色卡→character;`proposal.approved` 的 **overridesDelta**(用户改了 AI 提议的哪些字段,§1.1 已定双字段)=最强偏好信号;锁卡→constraint)。LLM 蒸馏软事实烧 token,默认关待拍板。不变量:用户纠正的事实自动提炼**永不静默覆盖**;memory.json 可删可重建。
- **层 3 摘要压缩**(裁剪中,带触发器复活)——见下方调和。

### ★ 张力调和:需求 §5 裁掉压缩 vs 对账 C1 最大缺口

**两份文档都对,说的不是同一条循环**:拆镜/定妆 planner(一次性 skill,跑完即弃)撞不上 24k,裁剪成立;创作面板长对话(sessionKey 跨 turn 累积+胖 tool-result)很快到顶,**到顶静默丢最老轮次——丢的恰是最早商定的风格设定,正中 N18 反面**。

处置三步(不和稀泥):① **现在**(并入 S3,~0.5h):截断时发 `context.capped` 事件——把"会不会撞"从互相猜测变成可观测事实(P2 在流程层的应用);② **结构修走 S9 不走压缩**:长对话里值得记住的大半是持久事实,本该住记忆卡随 system 常驻,不该赖在历史里怕被裁;③ **触发器**(满足任一才排压缩切片,1-2d 抄 ViMax 抢先式压缩+增量摘要+`context.compacted` 事件):真实项目一周内 `context.capped` ≥3 次 / 用户出现"AI 忘了我前面说的"反馈 / S9 上线后仍现上述任一。

**借鉴**:ViMax context_compactor(抢先式时机+增量摘要)、OpenHands(压缩=可回放事件)、Claude Code CLAUDE.md 形态(项目级人话事实+悄悄注入+可直接改;**不抄全局记忆**——创作项目间风格互窜是事故)、MovieAgent Character Bank(character 事实+pinned)。

**切片**:层1 随 S0;`context.capped` 并入 S3;层2=S9(**真实依赖:agent 域事件=S3,canvas/锁事件=S5-a/S6**——路线上 S9 本就在 S6 后,依赖天然满足);层3 挂触发器。
**验收**:J2 扩展「建角色卡→关 app→重开→说『给小鹿加奔跑镜头』,AI 不反问外形直接用对」(N18);删一条错误事实后下轮生成不受影响(N19);`context.capped` 日志可查。

---

## 5. 模块 S:状态/会话

**定义**:"关了再打开,一切还是离开时的样子"——项目状态**强接续**(字节级);AI 对话**弱但诚实**:可以断,不许装没断。

**服务需求**:N17(全员底线)、N10 间接(恢复错乱=「背着我改」观感)、串台 bug(S1)。

### ★ 实测更正(原落地方案 §7 S-a 描述不准,本文修订)

实测:对话气泡 store **无 persist 中间件**,项目 payload **无 aiMessages 字段**——整 app 重启后气泡和 LLM Map 一起空,**字面 S-a 今天不存在**。真实的不同步是:① 运行中切项目(气泡全局单例泄漏=S1 的串台,方向相反:气泡错、记忆对);② 渲染层 reload(气泡空、Map 还在)。**关键推论:S-a 是 S1 将要"制造"的缺口**——S1 把气泡按项目持久化后,「气泡在、记忆空」才变成真命题。

### ★ 张力调和:裁剪 resume vs 不同步

「不能 resume」=功能缺席,persona B 能忍,裁剪成立;「不同步」=**界面说谎**(用户基于"AI 记得"继续指令,AI 拿空上下文瞎做,钱白花还怪模型蠢)——直接击穿"可控的透明"(假透明比不透明更糟)。两者不矛盾:裁的是"恢复记忆"能力,补的是"如实声明没记忆"的诚实义务,后者便宜得多。

处置两级:① **「新会话」分隔线必须与 S1 同片交付**(+0.5d,否则 S1 自己把谎话 ship 出去):hydrate 查 `llmSessionAlive`(一次 IPC 查 Map.has),气泡有而 Map 无→分隔线「之前的对话 AI 已不再记得」,旧气泡保留可滚;Map 有而气泡空→正常续。不变量:**UI 呈现的"AI 记得的范围"⊆ LLM 实际范围,宁少不多**。② 从日志重建(真 resume,0.5-1d,重建有损需声明)挂触发器:分隔线上线后"希望它接着记得"诉求 ≥2 次,与 C 层 3 共享信号。

### ★ document/session/conversation 三域字段分类(= S5-a 施工清单)

| 字段 | 域 | 入日志 | 入快照 | 入撤销 |
|---|---|---|---|---|
| nodes/edges/groups + node 的 prompt/params/title/position/locked/result/history | document | ✅ | ✅(缓存) | ✅ |
| node.progress / 运行中 run 态 | 瞬态 | ❌(仅终态) | ❌ | ❌ |
| selectedNodeIds | session | ❌ | **❌(现状违规:generationCanvasStore.ts:846-854 在存,S5-b 摘除)** | **❌(现状违规:canvasHistory.ts:11 在回放)** |
| pendingConnectionSourceId / canvasZoom/Offset / AiDraft/Collapsed | session | ❌ | ❌ | ❌ |
| 对话气泡 | **conversation(第三域)** | 语义入(`turn.finished` 截断文本),展示态不入 | S1 拍板:若持久化,独立 per-project 文件,不混 canvas payload | ❌ |
| clipboard | session(app 级) | ❌ | ❌ | ❌(迁 canvasClipboard.ts) |

比 tldraw 二分多一条裁定:**对话单列 conversation 域**——塞 document 会把聊天灌进创作账本,塞 session 则重启即丢违 S1 目标。

**切片**:S1(分桶+**分隔线**)、S5(翻正+session 字段摘除)、S9(记忆=会话连续性的结构性替代,两模块在此合流)。
**验收**:切 A→B→A 各归各位;**重启后旧气泡可见则分隔线必在**(R13 步骤);杀进程重开画布一致;撤销不再跳选区、重开不再恢复幽灵选区。

---

## 6. 模块 L:权限/生命周期闸门(创作域最厚)

**定义**:AI 想动你的作品/花你的钱之前必须经过的那道门——散落的 if 收敛成一条求值流,"批准了什么"变成可对账事件,"不许碰"变成可锁不变量。创作域比编码域多管两道:**花钱**和**创作主权**。

**服务需求**:簇 A 全簇(N6-N12)+ M1。

### 6.1 统一求值流(3 步,不是 Claude SDK 的 6 步)

```ts
type GateIntent = { kind:'tool-call'|... } | { kind:'batch-run'|... } | { kind:'spend'|... };
type GateDecision = { outcome:'allow' } | { outcome:'deny'; reason: 人话 } | { outcome:'ask'; proposal };
function evaluateGate(intent, ctx): GateDecision  // ① policy(只读→allow)② invariant(锁/校验→deny)③ ask
```

砍掉 SDK 的 hook registry/permission mode/规则 DSL(单用户桌面无配置面消费者);三道门(每工具/批量计划/预算)= 同一管道的三种 intent。决策入日志的裁剪:**deny 必入**(N14 素材,人话 reason 回喂 LLM 可自我修正)、ask 的结果入(approved/rejected 本来就是事件)、只读 allow **不入**(纯噪声,不抄 PRISM 全记)。收编时**同 commit 删** `CanvasAssistantPanel.tsx:224-232` 散落 if(P1)。

### 6.2 提议事务(状态机 × 事件严丝合缝)

**Proposal 不是独立对象,是日志的投影**(`status = reduce(events where proposalId=X)`,调研报告 §五 的字段全部变派生,P1 不出第二真相)。状态机(rolled-back 拆三义):

```
铸 proposalId → proposed ─(reject)→ rejected(画布零痕迹)
                        └(approve)→ approved ─(全成)→ committed ─(整笔撤销)→ rolled-back ⇄ Cmd+Z
                                              └(中途失败)→ aborted(补偿回滚,零半截)
```

每迁移恰对应一个事件(§1.1 agent 域);粒度=一轮折叠(create+connect 共一个 proposalId,批准是一次用户意志)。**四不变量进 CI**:I1 任何 `source:'agent'` 的 canvas 事件因果链必回指一个 approved(N10 的结构保证);I2 deny 必入日志带人话;I3 rejected/aborted 后画布投影与提议前逐字节相等;I4 committed 必带对账结果。

### 6.3 对账(N12 的命门)

实测根因:`effectiveArgs = {...baseArgs, ...overrides}` 浅合并后**即蒸发**(CanvasAssistantPanel.tsx:244),今天对账无米下锅。设计:① `proposal.approved` 记录**合并后的 effectiveArgs**(不是 overrides 增量,快照要自洽);② `txn.committed` 携带 clientIdToNodeId 映射;③ 纯函数 `reconcile()` 逐 clientId 比对,**派生字段白名单显式声明**(position/categoryId/title 兜底是渲染层有意 derive,不算偏差);④ 不一致不静默:「执行与批准有 N 处出入」+per-field diff+一键整笔撤销;正常时用户什么都看不见(M1);⑤ property test「任意批准重放→reconciliation 必 ok」进 CI。

### 6.4 预算门(S7)

`estimateGenerationCost`:archetype params × `Model.pricing.specCosts` 通用 join(数据已有全未用)。三呈现一拦截:计划卡每镜头 chip+卡底总价(C 要镜头级 D 要一句话,同一数据两档披露)/S2b 计划图总价/单节点 hover;拦截唯一在生成入口前,**按单次触发总估价计**。借 OpenMontage 估价签字,**砍** 7 维打分(模型选择已有 bug① 机制)和硬性封顶(需求 §5 明确不做配额强制)。成本写回 `provenance.cost`→事件,预估 vs 实花可对照。

### 6.5 锁(N11)

**语义:防 AI 的硬禁,对用户是一次点击的软门**(N11 原文"AI 碰都不许碰"≠"我自己也改不了",用户被自己的锁挡死违 M1)。数据:`node.locked` 投影自 `canvas.node.locked/unlocked`(source 恒 user,**agent 无 lock 工具**——锁是用户主权表达)。锁面精确定义:改 prompt/params/references/删除/**入边**(改变生成输入)=deny;**出边=allow**(锁住的角色卡被引用喂参考正是定妆用途:不许改它,尽管用它);移动=allow。deny 发生在**提议构建时**不是批准后(用户不该批准注定失败的计划)。用户路径:锁徽标+只读态+一次点击解锁,**不做**"临时覆盖一次"复杂态。

### 6.6 角色 Role(裁决:砍掉注册表)

完整 CreativeRole 注册表**现在是过度设计**(一个人+一个 agent;ViMax 实证角色由 prompt+工具体现)。**最薄保留(零成本,全部已在)**:事件 `source` 字段=Role.kind 雏形;每 skill 工具集=capabilities 雏形;approval 事件 source:'user'=approvedBy 雏形。**升级信号写死**:第二个并发 agent loop / 差异化权限需求 / 多人协作——届时 source 旁加 `actorId`(v 字段+upcast 链保证事件历史不改写),管道签名不换。

**借鉴**:SDK 分层求值+短路+deny 回喂(不抄规则 DSL);PRISM 决策入日志纪律(不抄 10-hook 取证栈);OpenMontage 估价签字(不抄打分/封顶);OpenHands 拒绝即事件。

**切片**(顺序与 §8.1 对齐,评审 P1 修正):**S2b 定义 `GateDecision` 类型 + batch-run intent 首落地**(类型随本片诞生)→ S3(schema 定稿时收编 deny 事件形态,与 S2b 词表同步重命名)→ S6(主体:状态机/applyBatch 原子/锁/对账/evaluateGate 收编)→ S7(spend intent)。
**验收**:N6/7/8 计划卡看全改全确认且改值落地由对账保证;N10 I1 属性测试绿;N11 R13 旅程「锁角色卡→AI 重拆→计划不含改卡且能说出为什么→出边正常引用→一次点击解锁」;N12 注入偏差时显示 per-field diff+一键撤销。

---

## 7. 模块 V:轨迹/评估接口

**定义**:把"AI 替你创作的每一步"变成一份可翻译的账本——向下撑复现/对账/审计,向上实时翻译成人话进度/人话错误/成本数字。**账本永不直接见用户,见用户的只有五个投影。**

**服务需求**:N3/N4(进度)、N13/N14(错误)、N9(成本)、N12(对账)、N20(复现)、N21(审计)、N5/N23(自检)、M2(渐进披露)。

### 7.1 轨迹底座

复用 §1.1 schema,V 只定义自己域的 payload 并钉死因果链方向:`review.* →causeId→ vendor.call.completed →runId→ vendor.call.requested →causeId→ proposal.approved`。N14"哪个镜头哪步为什么"=沿链反走。进度不入日志终态才入(词表共享,存储不共享);assetRefs 只存本地引用(远端 URL 会过期,复现靠它)。

### 7.2 人话翻译层(簇 B 机制)

**单文件叙述注册表 + TS 穷举强制全覆盖**:`src/workbench/observability/narrate.ts`,`Record<NarratableEventType, (payload)=>Narration>` ——新增事件类型不补文案则 typecheck 红。纪律:进度/错误展示组件**只准调 `narrate()`**,字面量文案=review 必拒;`classifyGenerationError` 的七段中文 hint 在 S4 迁入此表并删原处(P1)。**S2 的进度条文案从第一天就由这张表驱动**——S3 落盘的事件词表在 S2 已以进度条形式见过用户,日志不是"没人看的底层"。不做 i18n 框架(单语,YAGNI)。

### 7.3 成功信号(两层,免费层默认开)

| 层 | 做什么 | 成本 | 默认 |
|---|---|---|---|
| **L0 技术自检** | ffprobe 黑帧/静音/零时长/破损;图片解码失败/尺寸不符 → `review.technical.completed` | 免费 <1s(复用 `electron/export/mediaProbe.ts` 已有基建) | 开,不可关(只标记不拦截) |
| **L1 VLM 审美**(V-b) | 图阶段并行 k=2 候选,VLM 评分取优(ViMax 铁律:k=2、只图阶段) | 2 倍生成费+评委费 | **关**;批量确认视图按次勾选,需拍板 |

**诚实纪律核心**:自检只标记,**绝不静默丢弃、绝不自动重跑**——suspect 时节点 ⚠+人话("这段视频可能是黑屏的")+一键重跑。不抄 OpenMontage"review 不过就不呈现":用户主权第一,AI 没资格替用户扔结果。

### 7.4 结构化错误(修在压扁处,P2)

根因:`runtime.ts:516` throw 时把 httpStatus/logicalCode/upstreamMsg 全压进字符串,下游正则反猜修不回来。S4 落地:① `requestJson` 改 throw `VendorRequestError{structured: {vendorKey, httpStatus, logicalCode, upstreamMsg≤256, category(401→auth/402→balance/429→quota 查表不是猜), retryable}}`;② completed 事件 error 字段放 structured;③ `classifyGenerationError` 改吃 structured、正则降级为老数据兜底,hint 迁 narrate 表。

### 7.5 复现(一份数据三个用途)

`NormalizedRecipe{modelKey, mappingId, archetypeId, prompt, seed, params(键排序), referenceAssets[{slot, sha256, localRef}]}`——**配方(N20)**=`vendor.call.requested.recipe`,节点详情「配方」面板+「按此配方重出」;**指纹(S8)**=`hash(recipe)`,参考图归一难题用 sha256 内容寻址一次解决;**缓存与复现自动对齐**:参数没动→指纹命中秒回零花费,真要重抽→「强制重跑」。诚实边界:同配方+seed **不保证 vendor bit 级复现**,话术是"用一模一样的配方重新生成";承诺一模一样的那条路是缓存命中。

### 7.6 产品出口总账(每个出口归谁,无"等想起来再说")

| 出口 | 需求 | 切片 |
|---|---|---|
| 人话进度条 | N3/N4 | S2(narrate 表是 S2 交付物) |
| 人话错误卡 | N13/N14 | S4(结构化错误钉进范围) |
| 轮次 footer「N 步·token」 | N9 后半 | **S3 第一天的可感知出口**(+0.5d,先 token 后金额待 S7) |
| 成本预估+总价 | N9 前半 | S7 |
| 查看步骤+对账标注 | M2/N12 | S6(每步走 narrate;偏差标注) |
| 技术自检 ⚠ | N5/N23 | **V-a 并入 S4**(0.5-1d) |
| 配方面板+一键重出 | N20 | **V-c 并入 S8**(+0.5d;S8 被裁则降级只读配方挂 S4 数据) |
| 审计导出 markdown | N21 | **V-d 后置**(M3 后 0.5d,reporter buildSummary 模式,仅 persona C) |
| VLM 审美 | N5 进阶 | V-b 需拍板 |

**自砍记录**:轨迹全景时间线(无人要,自嗨)、aesthetic 预留事件(没拍板不进 schema)、i18n narrate。

---

## 7b. 模块 Subagents 与 MCP(有意留薄,写死触发条件)

**Subagents**:今天 24 需求点无一逼出多 agent——留薄有实证(ViMax 单 loop+阶段 prompt 跑通同域全流水线;FilmAgent"多 agent 超单模型"成立于无人在环的辩论裁判场景,**Nomi 有人在回路,用户本人就是 judge**,其增益已被确认门+计划卡部分捕获)。**升级信号写死**:① 某 skill 上下文在 C1 压缩后仍爆(长剧本 J2);② V-b 拍板要做(k 候选+评委是天然子循环);③ 自审出现"创作者自评自"系统性偏高。**反信号**:显得高级/想起名/想并行(B 泵波次已是生成并行)。**升级路径不推倒**:subagent=父工具 execute 里再调一次 `runAgentLoop` + `parentEventId` 挂因果链,零编排框架。S0 唯一义务:loop 可重入(单测:同 model 并发两次互不污染)。

**MCP**:24 需求点零命中,服务的是 P4 接口纪律。零代码预留三条:① loop 工具入口=AI SDK ToolSet(MCP client 产出的正是 ToolSet,支持是定义性的);② 工具组装单点收口 `buildToolsForSkill`(将来 MCP 工具在此 merge 且必经 makeAgentTool 确认门——信任边界外不免审);③ 事件 schema 已 vendor-agnostic。外接需求出现前一行不写,出现时先过 Context7(R5)。将来外接工具若花钱,T2 meta 的 costy 自动覆盖,无需 MCP 特例。

---

## 8. 执行路线与拍板点

### 8.1 切片路线(含模块设计追加的钉子,每片五门全过才 push)

| 切片 | 内容(粗体=本轮模块设计的追加/修订) | 量 |
|---|---|---|
| S0 | 合并两套 harness(runAgentLoop 抽取,同 commit 删重复 repair)+ **可重入义务 + parentEventId 透传 + MCP 三条边界纪律** | 0.5-1d |
| S1 | 修对话串台(按 projectId 分桶)+ **「新会话」分隔线同片交付(llmSessionAlive 探针)** | 1-1.5d |
| S2 | 进度事件流(治 bug②)+ **narrate.ts 注册表作为本片交付物** | 1-2d |
| S2b | 拓扑批量+执行前计划图确认(样张 A/B 待拍板)| 1.5-2.5d |
| S3 | 轨迹最小版:schema v1 定稿(**含 context/memory 域占位 + GateDecision/deny 形态 + finalTextHead 裁定**)+ eventLogRepository + 旁路写 + **`context.capped` + 轮次 footer(可感知出口)** | 1.5-2.5d |
| S4 | VendorCallEvent+provenance 统一 + **结构化错误(§7.4)+ NormalizedRecipe 进 payload + V-a 技术自检(L0)** | 2-3d |
| S5 | EventLog 地基三步(S5-0 拆壳过棘轮 → S5-a 影子+属性测试+收编 S3 旁路 → S5-b 翻正+删 canvasHistory[剪贴板先迁]+**session 字段按 §5 表摘除**) | 5-7d |
| S6 | 提议事务主体(状态机/applyBatch 原子/锁[**含用户侧锁 UI 过 R8**]/**对账 effectiveArgs 全量快照**/evaluateGate 收编[同 commit 删散落 if]/选择性撤销策略/最小轨迹视图)+ T2 meta | 4.5-5.5d |
| S6b | **T1 `run_generation_batch`**(受理语义,引用 §3 设计) | 0.5d |
| S7 | 成本预估 gate(按次总价)+ 计划卡/计划图挂总价 + cost 写回 | 1-2d |
| S8 | 指纹缓存 + **V-c 配方面板+一键重出**(共享 normalizeRecipe)(可裁,裁则配方降级只读版) | 1.5-2.5d |
| S9 | 项目记忆卡(C 层 2 + 记忆 UI「AI 记得 N 条」)(依赖 S3 非 S5) | 2-3d |
| 后置 | V-d 审计导出(0.5d,persona C 出现才做) | — |

**触发器清单(不排期,信号到才做)**:C 层 3 压缩(capped ≥3 次/周 或"AI 忘了"反馈 或 S9 后仍现)/ S 真 resume(分隔线后"想让它记得"≥2 次)/ Subagents(三信号)/ MCP(首个外接需求)/ Role 升级(三信号)/ V-d 审计导出(persona C 出现)。

**总量(评审 P1 复算)**:净 **22-33d(含 S9)/ 20-30d(不含 S9)**,含审批/五门/走查开销按 **28-40d 备粮**。诚实声明两笔账:① 模块设计的"钉子"追加 ≈ +3.5-4d(规范性补强,非新功能);② **S9 从旧方案的"后置另出方案"提为排期切片(2-3d)是显式扩 scope**——簇 E 是需求第三期,提进来的理由是它与 S3/S5/S6 的依赖已理清、设计已在 §4 完成;不认可可裁回后置。S8 可裁;每片可暂停。里程碑:M1=S0→S4(快赢+可观测)/ M2=S5(地基)/ M3=S6→S9。

### 8.1b 施工细则(不动项 / 回滚 / 验收细则 / 根因坐标——逐片,R4 合同条款)

| 切片 | 不动什么 | 回滚 | 验收细则 + 根因坐标 |
|---|---|---|---|
| S0 | onboarding 的 tools/IPC/reporter;用户对话行为 | 单 commit revert | onboarding wizard 真机跑通一次接入;repair grep 全仓一处;loop 可重入单测(同 model 并发两次互不污染) |
| S1 | 后端 sessionKey(已 per-project) | 单 commit revert | 根因:`workbenchStore.ts:70-73`/`generationCanvasStore.ts:69-71` 全局单例无 projectId;R13「A 对话→切 B 面板干净→切回 A 还在」+「重启后旧气泡可见则分隔线必在」 |
| S2 | 生成执行逻辑本身 | 事件通道独立,断开即回旧行为 | 根因:`catalogTaskActions.ts:154-167` poll 丢 status;主进程仿 `exportJobIpc.ts:39-51` 建 taskEvents/taskIpc;点生成 2 秒内进度可见、文案是人话且全部经 narrate();**词表键以 S3 schema 草案为准,S3 定稿同 commit 重命名** |
| S2b | 边模型、参考解析逻辑本身、单节点 runGenerationNode | 调度器独立函数,可退回 FIFO | 确认前零调用零扣费(网络断言);依赖链「图先跑、视频等图且真拿到参考」;**独立节点并行**;**中途取消=已跑保留、没跑不跑**;**计划图显示顺序 ≡ 实际执行顺序回归断言** |
| S3 | 画布 store(此时旁路观察,不投影) | 旁路写,关掉零副作用 | 真机一轮对话后日志可读、因果字段齐、无 >4KB 单事件;footer 数字与日志 usage 事件一致;**footer 文案走 narrate 表,S7 后 token 呈现切金额并删 token 形态(P1)** |
| S4 | mapping/archetype 解析逻辑 | 出口旁路,可独立 revert | 根因:`runtime.ts:702-719` 只 fallback 写 provenance、`buildProfileTaskResult :576-620` 漏写——统一在后者出口写;真实生成后顺因果链答出「哪个 mapping/archetype/参数」;三种注错(断网/坏 key/402)分类全中不靠正则兜底;黑帧样本走出口出现 ⚠ 且结果不被扣留 |
| S5 | components/ 渲染层 ~2000 行、40+ 调用点、electron 写盘协议、graphOps.ts | S5-0/S5-a 各自整体 revert(零行为变化);S5-b 前打 tag,v7 加载器保留读 v6 | **陷阱四条**:① agent 工具「写后立读」9 处(`generationCanvasTools.ts:67-99`)——append+reduce 必须同步,禁 async 投影;② 胖节点边界——progress/runs 瞬态不入日志,result/history 终态入;③ 跨 store 事务(`workbenchStore.ts:159 deleteCategory` 连动画布)——发复合事件;④ immer draft 禁入事件(freeze+lint)。真机:旧项目迁移、关开、**撤销粒度=一次手势**、崩溃恢复(丢失 ≤§1.3 量化窗)、copy/paste 正常、快照不再含 selectedNodeIds、撤销不回放选区 |
| S6 | applyCanvasToolCall 单一真相源地位(事务包裹在外面) | 事务层独立模块,可降级回逐条确认 | **撤销入口三约束(评审 P1 回填)**:① 计划卡入口存活到下一笔提议或本会话结束;② 画布侧 toast 第二入口;③ 切项目/清空对话后不再提供(日志仍可查)。**选择性撤销**:用户改过提议节点→确认弹窗**列明将一并丢失的修改**;补偿事件进 Cmd+Z 栈(可撤销"撤销")。mockup **必出折叠+展开两态**,以**获批样张 v3** 为基准过 R8(含锁 toggle)。R13:「确认→改其中一节点→整笔撤销(弹确认)→复原→Cmd+Z 反悔→AI 节点回来」;拒绝零痕迹;批量中途失败零半截;注入偏差时 per-field diff 可见。**若实施超 5.5d,锁 UI 可拆 S6-lock 子片先行交付** |
| S6b | 生成调度器本身 | 工具可单独下架 | 确认前零网络调用断言;approved nodeIds ≡ 实际 requested 节点集 |
| S7 | 生成执行逻辑 | gate 可配置关闭 | 单次触发总估价超阈值需确认;未超零打扰;计划卡镜头级+卡底总价两档披露 |
| S8 | 主进程(纯渲染层旁路) | 关闭即回 | 参数没变重跑秒回零请求;改任一参数正常重跑;配方一键重出发出与原 recipe 逐字段相等的请求 |
| S9 | 对话 store、LLM history 机制 | memory.json 可删(从日志重建等价) | J2 扩展:重开项目说「给小鹿加奔跑镜头」AI 不反问设定;删错误事实后下轮不受影响;用户纠正永不被自动提炼覆盖 |

### 8.2 拍板点汇总(全部待你定的收进这一张表)

| # | 决策 | 推荐 | 实测依据 | 不选的代价 |
|---|---|---|---|---|
| **D1** | 事件溯源当地基(S5 三步) | ✅ 是 | 手术量实测 ~1200 行集中在 generationCanvasStore 一处;40+ 调用点接口不动、渲染层零改动;已有 persistRevision+迁移管线=所需基建 80% | 提议事务只能建在快照拷贝上(贵且笨);撤销/轨迹/漂移三件各自为政;长期两本账违 P1 |
| **D2** | ViMax 移植 vs 自建 | 都不是:保留现有 loop,借设计加固(transitions/turn_record/护栏) | 现有 loop 活着且完整(`agentChatV2.ts:417-486` streamText,repair/确认门已验证);ViMax 是 Python | 移植:大 churn 零收益+并行版违 P1;从零自建:丢掉已验证的 repair/确认门 |
| **D3** | 画布历史长哪 | EventLog 上,删 canvasHistory(剪贴板先迁 canvasClipboard.ts) | 画布是全手写非 React Flow(无第三方库迁就);canvasHistory 是瞬态引用栈且混装剪贴板(:66-126) | 保留两套:日志和栈两份历史真相,迟早打架 |
| **D4** | 第一块落地 | 按 §8.1 切片序(快赢 S1/S2 先行→地基→命门) | S0-S4 不依赖 D1;S6 依赖 S5(事务建在日志上) | 先 S6 后 S5:事务建在快照拷贝上,S5 来了重写一遍违 P1 |

| # | 决策 | 推荐 | 来源 |
|---|---|---|---|
| **P-1** | S2b 确认 UI 样张 | 方案 A(画布原位波次徽标+确认条) | 样张已出,待选 A/B |
| **P-2** | T1 工具结果语义 | A 受理即返回(B 等完成会锁死对话) | 模块 E+T |
| **P-3** | S1 气泡是否随项目落盘 | 落盘+分隔线(旧对话作为工作记录可见且诚实) | 模块 S |
| **P-4** | 预算阈值默认值与可调性 | 设置页单一可调数字;默认值等 pricing 单位核实后定 | 模块 L(pricing 单位疑似积分制,待核实) |
| **P-5** | 锁的用户解锁交互 | 先解锁再改(一次点击,无临时态) | 模块 L |
| **P-6** | V-b VLM 审美评分 | 默认不做;做也是批量视图按次开关,k 锁死 2 | 模块 V(烧额度,必须拍) |
| **P-7** | 记忆 LLM 蒸馏软事实 | 默认关(规则提炼先跑) | 模块 C(烧 token) |
| **P-8** | L0 自检批量汇总提示 | 要(批量完成 toast「8 张里 2 张可疑」) | 模块 V |
| **P-9** | R13 加"长本子"边界旅程 | 加(否则 Subagents/C 压缩的触发信号永远观测不到) | 模块 Subagents |

**待核实清单**:pricing.cost 单位/币种;vendor 任务取消能力;项目复制是否逐文件拷贝(日志 seq 隔离);nodeIds≤48 对 J2 是否够。

---

## 9. 风险表与评审记录

风险表(承自落地方案,模块设计后新增两条):

| 风险 | 等级 | 缓解 |
|---|---|---|
| S5 影子期拖长成并行版 | 高 | 三步同里程碑;CI 不变量;翻正必删 canvasHistory |
| 写后立读改异步读旧值 | 高 | append+reduce 同步锁死;属性测试 |
| immer draft 泄漏进事件 | 高 | plain input/current()+freeze+lint |
| 日志膨胀 | 中 | 白名单+4KB 断言+tool-result 截断 |
| 跨进程乱序 | 中 | 主进程 seq 唯一定序 |
| 老项目迁移 | 中 | v7 以快照合成 genesis;迁移管线有先例 |
| schema 演进腐烂 | 中 | v 字段+upcast+updated{patch} deprecation |
| undo 粒度退化 | 中 | txnId 手势分组进 schema 首版 |
| **narrate 表被绕过(文案散落回潮)** | 中 | Record 穷举编译红+lint no-restricted-syntax+review 纪律 |
| **切片钉子膨胀(+4d 后继续涨)** | 中 | 拍板点之外不再加范围;新想法一律进触发器清单 |
| 工期低估 | 中 | 26-38d 备粮;S8 可裁;每里程碑可暂停重估 |
| store 手术期并行会话冲突 | 中 | S5 单会话施工 |

**评审记录**:
- 2026-06-11 R7 六角色对抗评审(对原落地方案):1 P0(S5 撞 filesize 棘轮)+7 P1(剪贴板/schema 版本化/写盘三件套/payload 截断/手势分组/选择性撤销/轨迹视图)全部回填,本文继承。
- 2026-06-11 四模块设计交叉调和:修正原 §7 S-a 事实错误(气泡未持久化,缺口由 S1 制造→分隔线同片交付);发现 session 域泄漏两处现行犯(快照存 selectedNodeIds、撤销回放选区);发现 N12 对账无米下锅(effectiveArgs 合并即蒸发);Role 注册表裁决砍除;C1/S-a 由"缺口"细化为"带触发器的处置"。
- 2026-06-11 合成期对抗评审(对本文):1 P0(施工细则系统性丢失→回填 §8.1b)+ 6 P1(approved 双字段 effectiveArgs+overridesDelta / runId·parentEventId 字段级对齐 / GateDecision 提前到 S2b / context.capped 补产品投影 / 工期复算 22-33d 且 S9 扩 scope 显式声明 / 因果不变量精确化)全部回填;P2 七条(S9 真实依赖改写 / §0 指针 / teardown 拍板表标注已取代 / footer P1 纪律 / S2 词表同步重命名 / S6 拆分断点 / store 文件名)全部带上。
- 验收总门:每片五门+片内验收;M3 后 R13 全旅程 J1-J5+R14 审计+样张对账(P3);发布前工作树必须干净。
