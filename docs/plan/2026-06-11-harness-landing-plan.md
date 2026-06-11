# Nomi Harness 落地方案(执行文档)

> 三部曲的第三篇,前两篇:`2026-06-10-nomi-harness-requirements.md`(要什么)、`2026-06-10-nomi-harness-teardown-reference-pool.md`(抄谁)。
> **本篇讲怎么落**:基于三路代码实测(file:line 全核过),给出切片路线、每片的范围/不动项/验收门/回滚。
> 已过 6 角色对抗评审(§9),P0+P1 必改项全部回填。
> 日期:2026-06-11。状态:**待用户拍板 D1-D4(§5),拍板后即为施工合同**。

---

## 1. 一句话 + 通俗版

**技术一句话**:为每个项目建一条 append-only 事件日志(EventLog)作为唯一真相源,画布是它的投影;agent 的提议/批准/执行/vendor 调用全部成为带因果链的事件——撤销、轨迹、治漂移、修卡顿在同一条地基上一次解决。

**通俗版(账本比喻)**:现在 Nomi 的画布是一张"便利贴"——只记此刻长什么样,擦了就没了。改造后变成一本"账本"——每件事(加节点、改提示词、AI 提议、你批准、调了哪个模型花了多少钱)都是一笔不可涂改的流水;画布只是把账本从头加一遍算出来的"余额"。想撤销?划掉最后几笔重算。想查 AI 哪步跑偏?顺着流水往回翻。

**用户能看到的变化**(无先后含义,交付顺序见 §6):
1. 生成时进度条真的在动,有人话阶段提示(不再"卡 30 秒像死了")
2. AI 的计划卡确认后,**一键撤销整笔**(不是一个个删节点)
3. 切项目后 AI 对话不再串台
4. 每次批量生成前看到预估总价;参数没变的重跑直接秒回结果不花钱
5. 计划卡上可展开「查看步骤」——AI 每一步做了什么、错在哪一步(最小轨迹视图,S6 交付)
6. 批量生成前先看到**执行计划图**——谁先跑、谁等谁、哪些并行,确认了才花钱;依赖链按正确顺序生成,镜头一致性不再靠运气(S2b 交付)

---

## 2. 原则对照(本方案怎么过 CLAUDE.md 的门)

| 原则 | 本方案的落法 |
|---|---|
| **P1 加新必删旧** | EventLog 翻正切片**物理删除**旧撤销栈(剪贴板逻辑先迁出,见 S5);合并两套 harness 同 commit 删 onboarding 重复 repair;S2 的旁路写日志在 S5 **必须收编进 eventLogRepository 单写者并删旁路**;影子日志期是迁移载体(有 CI 不变量+翻正切片在同一里程碑),不是长期并行版 |
| **P2 修根因** | bug②卡顿根因 = poll 结果不广播(实测 `catalogTaskActions.ts:166` 把 status 丢弃)→ 修在事件通道层;漂移根因 = provenance 只有 fallback 路径写(`runtime.ts:702` vs `buildProfileTaskResult` 不写)→ 统一为 VendorCallEvent |
| **P3 全绿≠完成** | 每个 UI 可见切片配 R13 走查 + 与已获批样张(计划卡 v3)对账 |
| **P4 通用第一** | 事件 schema 与 vendor/模型解耦;成本估算走 archetype params × pricing specCosts 通用 join |
| **P5 想清楚再动手** | 即本文档;S6 新 UI 元素先出 mockup 过 R8(设计约束已预写,见 S6) |
| **R5 查官方文档** | 新依赖清单:`ulid`(或等价单调 id)、`fast-check`(属性测试)——引入前各过一遍 Context7/官方文档 |
| **R9 防巨壳** | `generationCanvasStore.ts` 基线 871 行、棘轮只减不增 → **S5 第 0 步先纯机械拆壳**(行为零变化),再做影子日志,否则五门必红(评审 P0) |

---

## 3. 现状实测(三路探索,关键事实)

### 3.1 必须先更正的认知

- **画布不是 React Flow**——是全手写画布(`GenerationCanvas.tsx` 992 行,手写 pan/zoom/拖拽/SVG 边/视口虚拟化)。前文档「D3 学 Excalidraw 还是长在 React Flow store 上」的问法**作废**:没有第三方画布库要迁就,历史机制直接长在我们自己的 store/log 上。
- **harness loop 已经存在且在跑**——`electron/ai/agentChatV2.ts:466` 用 Vercel AI SDK `streamText` 多步 tool-calling(maxSteps 8/24 按 skill 分档,retry 3,repair 已有)。**D2「移植 ViMax」的问法也要修正**:ViMax 是 Python,我们有活的 TS loop,移植=制造并行版(违 P1)。正确动作是**借 ViMax 的设计**(transitions 状态机、turn_record 落盘、死循环护栏)加固现有 loop。

### 3.2 对落地最有利的五个事实

| 事实 | 证据 | 意义 |
|---|---|---|
| 画布所有写入已收口在 40+ 个具名 action,无散落 setState | `generationCanvasStore.ts:75-128` | action 名就是事件名,**调用面 40+ 处一行不用改**,只换 action 内部实现 |
| 确认门已存在:工具 execute = 投递+等用户结果 | `agentChatV2.ts:237-272 makeAgentTool` + `agentChatV2Ipc.ts:30-57 pendingConfirmations` | 提议事务的"提议点"和 resolver 管道是现成的 |
| 计划卡已存在且支持改 prompt、折叠 create+connect | `AgentPlanCard.tsx:66-188` + `agentPlanSummary.ts` | 簇 A 的 UI 骨架已获批已实现,只缺事务语义 |
| 进度类型和 store action 已就绪,只是没人调 | `generationCanvasTypes.ts:59-67` + `generationCanvasStore.ts:431 setNodeProgress`;poll loop 在 `catalogTaskActions.ts:166` 丢弃 status | bug② 是接线问题不是架构问题 |
| 轨迹落盘有现成模板 | `electron/ai/onboarding/reporter.ts`(trace.json + TrialEvent[]) | V 的最小版可以照抄自己人的代码 |

### 3.3 已实测的债务(本方案顺手清)

| 债 | 位置 | 收编进哪个切片 |
|---|---|---|
| AI 对话跨项目泄漏(P0,上次走查发现) | `workbenchStore.ts:71` / `generationCanvasStore.ts:70` 两个全局单例无 projectId | S1 |
| 两套 harness,repair 字节级重复 | `agentChatHarness.ts:115-142` ≡ `onboarding/agent.ts:113-141` | S0 |
| provenance 只有 fallback 路径写,profile 路径(主路径)漏写 | `runtime.ts:702-719` vs `buildProfileTaskResult :576-620` | S4 |
| 批量建节点无原子性,中途失败留半截 | `generationCanvasTools.ts:65-75` 逐节点 addNode | S6 |
| 撤销栈瞬态、模块级单例、不分项目;**且同文件装着剪贴板** | `canvasHistory.ts:22-24`(栈)+ `:66-126`(clipboard) | S5(历史删除替换;**剪贴板先迁出独立模块再删文件**,评审 P1) |

---

## 4. 定稿架构

### 4.1 一条日志,三类来源,主进程统一定序

每个项目一条 append-only 日志(分段 JSONL):`<projectDir>/events/log-<seg>.jsonl`。

```ts
type NomiEvent = {
  v: 1;                   // 事件 schema 版本(评审 P1:载入时按版本 upcast,仿 projectV51ToV60 先例)
  id: string;             // evt_<ulid>(产生端铸)
  seq: number;            // ★主进程 append 时统一编号——全局顺序的唯一权威(评审 P1:跨进程 ULID 不保序)
  ts: string;             // ISO 8601
  source: 'user' | 'agent' | 'runtime' | 'system';
  causeId?: string;       // 因果链:由哪个事件引起(OpenHands 的命门机制)
  txnId?: string;         // 事务/手势分组:agent 提议批次 或 用户一次手势(一次 paste/框删 = 一个 txn)——undo 的最小单位(评审 P1)
  proposalId?: string;    // 属于哪笔 agent 提议(txnId 的特化标注)
  type: string;           // 见 4.2
  payload: Record<string, unknown>;
};
```

**事件演进策略**:`v` 字段 + 载入时 upcast 链(同 projectRecord 迁移管线);`canvas.node.updated{patch}` 是首版兼容形态,**带 deprecation 计划**——每引入一个具名事件(prompt-changed 等)即在写入端停发对应 patch 字段,upcast 不回写历史。

### 4.2 事件类型(首批,按域)

| 域 | 事件 | 备注 |
|---|---|---|
| canvas(业务事实,入日志) | `canvas.node.added / updated / moved / removed`、`canvas.edge.connected / disconnected`、`canvas.group.*`、`canvas.node.prompt-changed`、`canvas.node.result-added`、`canvas.node.locked / unlocked` | 由现有 40+ action 一一对应翻译;一次用户手势发出的多个事件共享一个 `txnId` |
| agent(提议事务) | `agent.turn.started / finished`、`agent.tool.proposed`、`agent.proposal.approved {overrides} / rejected`、`txn.committed / aborted` | 挂在 makeAgentTool 投递点 |
| vendor(治漂移) | `vendor.call.requested {vendorKey, modelKey, mappingId, archetypeId, params}`、`vendor.call.completed {status, latencyMs, assetUrls, cost}` | 在 `executeProfileOperation`/`buildProfileTaskResult` 出口发 |
| undo | `canvas.undone {targetTxnIds[]}` | **撤销=追加补偿事件**,历史永不改写(PRISM 纪律);粒度=txn(手势/提议),不是单事件 |

### 4.3 明确不入日志 / 限体积的(防日志爆炸)

- **会话态**:selectedNodeIds、pendingConnectionSourceId、canvasZoom/Offset——留普通 store 字段(tldraw 的 document/session 分离教训)
- **运行中进度**:progress 每秒变化走瞬态 store(`setNodeProgress`),**只有终态** `vendor.call.completed` 入日志
- **对话气泡文本**:留 store(S1 改为按 projectId 分桶),不进项目日志
- **tool-result 大 payload**(评审 P1):`read_canvas` 的 result 是全量画布快照——入日志一律**截断为 `{hash, byteSize, head[0..256]}`**;确需全文的落 sidecar 文件存引用。日志里不允许出现 >4KB 的单事件 payload(写入端断言)

### 4.4 写盘语义(评审 P1 三件套)与分层改动面

**写盘三件套**:
1. **渲染层批量**:事件先进内存 ring buffer,`50ms 或 20 条`先到先 flush 走 IPC `nomi:events:append`(批量);背压=buffer 超 500 条时阻塞新 append 并告警
2. **主进程落盘**:`appendFile` 批量写 + 每 1s 周期 fsync;**量化丢失窗口:崩溃最多丢「未 flush 的 ≤50ms 渲染层 buffer + 未 fsync 的 ≤1s」,对比现状 700ms debounce 全量快照窗口——同量级偏好,但事件粒度可审计**(不再夸大为"不丢")
3. **撕裂尾行容忍**:载入时最后一行 JSON.parse 失败即截断丢弃(JSONL 标配)

**分段与重放边界**:快照(project.json payload)记录 `lastAppliedSeq`;hydrate = 载快照 + 重放 `seq > lastAppliedSeq` 的尾部;segment 按 5000 事件或 5MB rotation;undo 用的内存检查点每 **50 个 canvas 域事件**一个(只数 canvas 域,防 agent/vendor 事件挤稀间距,评审 P2)。

```
不动:components/ 渲染层 ~2000 行(selector 返回形状不变)
不动:electron 主进程持久化协议(payload 黑盒,atomic 写盘照旧)
不动:40+ 处 store 调用点、graphOps.ts(102 行纯算子直接当 reducer)
改:generationCanvasStore.ts 871 行 → 先纯机械拆三件(壳/reducer/选择器),再改造(S5 第 0 步,过棘轮)
改:projectRecordSchema v6→v7(payload 加 lastAppliedSeq + events 指针;迁移管线已有先例)
改:workbenchProjectSession.ts hydrate/save(~100 行)
删:canvasHistory.ts——历史栈删除替换;剪贴板(:66-126)先迁 `canvasClipboard.ts` 同 commit 接管 copy/cut/paste
新:electron/events/eventLogRepository.ts(唯一写者:append/read/分段/定序)+ IPC nomi:events:*
```

**immer 纪律(评审 P1,S5 实现规范写死)**:事件构造一律用 plain input / `current()` 取值,**禁止引用 immer draft**;事件对象 `Object.freeze` 后 append;配 lint 看守。40+ action 逐个手改时这是最易批量犯的错。

---

## 5. D1-D4 拍板表(R3,带实测数据)

| # | 决策 | 推荐 | 实测依据 | 不选的代价 |
|---|---|---|---|---|
| **D1** | 事件溯源当地基? | **是,分三步**:S5 拆壳(过棘轮)→ 影子日志(CI 锁不变量 `replay(log)≡snapshot`)→ 翻正(日志为真相,快照降为缓存) | 手术量实测 ~1200 行集中在 store 一处;UI/调用面零改动;已有 persistRevision+迁移管线 = 所需基建的 80% | 不用:提议事务只能建在快照拷贝上(贵且笨),撤销/轨迹/漂移三件各自为政,长期两本账 |
| **D2** | ViMax 移植 vs 自建? | **都不是:保留现有 streamText loop,借 ViMax 设计加固**(transitions 状态机进轨迹、turn_record 落盘、护栏),同时合并两套 harness(S0) | 现有 loop 活着且完整(`agentChatV2.ts:417-486`);ViMax 是 Python,移植=并行版违 P1 | 移植:大 churn 零收益;从零自建:丢掉已验证的 repair/确认门 |
| **D3** | 画布历史长在哪? | **长在 EventLog 上,删 canvasHistory.ts 的历史栈**(剪贴板先迁出);画布是手写的,无第三方库迁就问题 | `canvasHistory.ts` 是瞬态引用栈;其快照 shape 证明了投影状态边界 | 保留两套:日志和栈两份历史真相,迟早打架 |
| **D4** | 第一块落地? | **按 §6 切片序**:快赢先行(S1 串台→S3 进度条,用户立即可感)→ V 地基(S2 schema+S4 漂移枢纽)→ 大手术(S5)→ 命门(S6 事务) | S1/S3 全不依赖 D1;S2 的 schema 投影语义**依赖"D1 倾向通过"**(若 D1 否决,schema 退化为纯观察日志仍可用,但部分设计白做——诚实声明) | 先做 S6 不做 S5:事务建在快照拷贝上,S5 来了要重写一遍(违 P1) |

---

## 6. 切片路线(每片独立可交付,五门全过才 push)

> 顺序已按评审调整:**用户可见的快赢(S1/S3)提前**,S2/S4 随后铺 V。S5 起需 D1 拍板。每片含 ~0.5d 五门+走查固定开销(已计入)。

### S0 合并两套 harness + repair 去重(0.5-1d)
- **范围**:抽 `runAgentLoop(model, tools, hooks, {mode:'stream'|'oneshot'})`;onboarding/agent.ts 换调用;**同 commit 删**其重复 repair(`onboarding/agent.ts:113-141`)和手写 step 计数
- **不动**:onboarding 的 tools/IPC/reporter;用户对话行为
- **验收门**:五门 + onboarding wizard 真机跑通一次模型接入
- **回滚**:单 commit revert

### S1 修 AI 对话跨项目泄漏(P0 债)(0.5-1d)
- **范围**:`creationAi*`(workbenchStore.ts:70-73)与 `generationAi*`(generationCanvasStore.ts:69-71)按 projectId 分桶或随项目重建;审一遍全部消费者
- **不动**:后端 sessionKey(已 per-project,`workbenchAgentRunner.ts:24-34`)
- **验收门**:五门 + R13 走查「项目 A 对话→切项目 B→面板干净→切回 A 对话还在」
- **回滚**:单 commit revert

### S2 进度事件流(治 bug②,用户立即可见)(1-2d)
- **范围**:主进程仿 `exportJobIpc.ts:39-51` 建 `taskEvents.ts`+`taskIpc.ts`(request-sent/poll-tick/asset-localizing 等阶段事件);preload 加 `tasks.onEvent`;poll loop(`catalogTaskActions.ts:154-167`)把 status 接到 `setNodeProgress`(action 已就绪);人话阶段文案(需求 N3/N4)
- **不动**:生成执行逻辑本身
- **验收门**:五门 + R13:点生成 2 秒内进度可见、阶段文案是人话
- **回滚**:事件通道独立,断开即回旧行为

### S2b 拓扑批量生成 + 执行前计划图确认(1.5-2.5d,源自 ViMax 论文 §2.3.1 + 用户拍板的"先看后跑")
- **动机(实测)**:画布边→参考解析已实现(`generationReferenceResolver.ts:61-90` = 论文 Eq.7),但 `runGenerationNodesBatch`(`generationRunController.ts:249-284`)平铺 FIFO 不看边——依赖节点与前置同时开跑,resolver 拿不到结果时**静默丢参考裸跑**(论文消融:无依赖调度全局一致性 -8.7%)
- **产品形态(用户定)**:批量生成**不直接跑**——先构建依赖关系图给用户看(画布上节点已有标题),**用户确认执行计划后才开始**。这是提议事务哲学在批量生成上的第一次落地(簇 A 同构);S7 成本总价将来挂同一张确认视图
- **范围**:① `buildDependencyWaves(nodes, edges)` 纯函数(拓扑分波,环检测);② 执行计划预览 UI(**先出样张过 R8,用户拍板后实现**);③ `runGenerationNodesBatch` 改按波次调度(独立簇并行、依赖等前置完成);④ 前置失败→下游标"上游参考未就绪"跳过可重试,**杜绝静默裸跑**(resolver 缺参考时显式上报);⑤ 单节点生成行为不变
- **不动**:边模型、参考解析逻辑本身、单节点 runGenerationNode
- **不依赖 D1**;波次开始/完成事件接 S2 进度通道、终态入 S3 日志
- **验收门**:五门 + R13 旅程「定妆图+场景图→镜头视频的依赖链批量:确认前零调用零扣费;确认后图先跑、视频等图完成且真拿到参考;独立节点并行;中途取消已跑的保留、没跑的不跑」+ 计划图显示顺序与实际执行顺序一致断言
- **回滚**:调度器独立函数,可退回 FIFO

### S3 结构化轨迹最小版(V 先行)(1-2d)
- **范围**:定稿 `NomiEvent` schema(§4.1,**一次定对,S5 复用同一 schema**;含 v/seq/txnId/payload 体积断言);在 `agentChatV2Ipc.sendChatV2Event` 旁路追加写 `<projectDir>/events/log-0.jsonl`(turn/tool-call/tool-result[截断]/error/usage);新 `electron/events/eventLogRepository.ts` + IPC;结构抄 `onboarding/reporter.ts`
- **明示**:此时旁路写是过渡形态,**S5 收编为单写者并删旁路**(P1 看守)
- **验收门**:五门 + 真机一轮 agent 对话后日志可读、因果字段齐全、无 >4KB 单事件
- **回滚**:旁路写入,关掉即无副作用

### S4 VendorCallEvent + provenance 统一(治漂移数据枢纽)(1-2d)
- **范围**:`executeProfileOperation`/`buildProfileTaskResult` 出口发 `vendor.call.requested/completed`(带 vendorKey/modelKey/mappingId/archetypeId/解析后参数);**修 profile 路径不写 provenance 的根因**(P2),两条路径统一在 buildProfileTaskResult 出口写;`vendor.call.*` 终态事件入 S3 日志
- **不动**:mapping/archetype 解析逻辑
- **验收门**:五门 + 真实生成一次后,日志里能顺因果链答出「这张图用了哪个 mapping/archetype/参数」
- **回滚**:出口旁路,可独立 revert

### S5 EventLog 地基(D1 手术,三步)(5-7d)
- **S5-0 纯机械拆壳(0.5-1d)**:`generationCanvasStore.ts` 871 行 → 壳/reducer(投影函数)/选择器三文件,**行为零变化**,先过 check:filesize 棘轮(评审 P0);白名单基线同步下调
- **S5-a 影子日志(2-3d)**:40+ action 内部改为「构造事件(plain input,freeze)→append(批量 IPC)→同步 reduce(graphOps 当 reducer)」;store 接口/外部行为完全不变;**引入 fast-check(先过 R5),CI 锁属性测试:随机操作序列下 `replay(events) ≡ store snapshot`**;**同步收编 S3 旁路为 eventLogRepository 单写者,删旁路**
- **S5-b 翻正(2-3d)**:hydrate 改「快照缓存(lastAppliedSeq)+重放尾部+撕裂尾行容忍」;undo/redo 改日志重放(txn 粒度,就近检查点,撤销=追加 `canvas.undone` 补偿事件);schema v6→v7(老项目以当前快照合成 genesis 事件);**同 commit:剪贴板迁 canvasClipboard.ts、删 canvasHistory.ts**
- **不动**:components/ 渲染层、40+ 调用点、electron 写盘协议
- **已知陷阱(实测)**:① agent 工具「写后立读」9 处(`generationCanvasTools.ts:67-99`)——append+reduce 必须同步,禁 async 投影;② 胖节点边界——progress/runs 瞬态不入日志,result/history 终态入(§4.3);③ 跨 store 事务(`workbenchStore.ts:159 deleteCategory` 连动画布)——发复合事件;④ immer draft 禁入事件(§4.4 纪律)
- **验收门**:五门 + 属性测试绿 + 真机:开旧项目(迁移)、编辑、关开、**撤销粒度与现在一致(一次手势=一步)**、崩溃恢复(杀进程重开,丢失窗口 ≤§4.4 量化值)、copy/paste 正常
- **回滚**:S5-0/S5-a 各自可整体 revert(无行为变化);S5-b 前打 tag,v7 加载器保留读 v6 能力

### S6 提议事务 Proposal + 最小轨迹视图(激活簇 A+D)(4-5d)
- **范围**:makeAgentTool 投递点铸 proposalId;批准→`agent.proposal.approved{overrides}`→执行(画布事件带 causeId+txnId=proposalId)→`txn.committed`;**批量原子**:store 加 `applyBatch`,中途失败 `txn.aborted`+补偿事件回滚;**整笔撤销**:按 proposalId 反做;**锁**:`canvas.node.locked` 事件 + agent 工具改前查锁;拒绝记 `agent.proposal.rejected`;**最小轨迹视图**:计划卡「查看步骤」展开(读日志渲染步骤列表,兑现 §1 承诺 #5)
- **选择性撤销冲突策略(评审 P1,定死)**:用户已修改提议节点(改 prompt/连新边)后点整笔撤销 → **先弹一次确认,列明将一并丢失的用户修改**;补偿事件正常进 Cmd+Z 栈(**Cmd+Z 可以撤销"整笔撤销"**)——两套撤销由此互操作,不并行
- **撤销入口设计约束(评审 P1,mockup 前置约束)**:① 计划卡上的入口存活到**下一笔提议或本会话结束**;② 画布侧给第二入口(确认落地后的 toast 内"撤销");③ 对话清空/切项目后不再提供整笔撤销(日志仍可查)
- **UI 过 R8**:计划卡按已获批样张 v3 补齐 chip 下拉可改;mockup **必须出默认折叠态+展开态两张**,默认态保持"一句话+一键确认"(评审 P2 防密度超载)
- **不动**:applyCanvasToolCall 单一真相源地位(事务包裹在外面)
- **验收门**:五门 + design-fidelity 断言 + R13 走 J1 扩展:「AI 拆镜头→计划卡改参数→确认→画布落地→改其中一个节点→整笔撤销(弹确认)→画布复原→Cmd+Z 反悔撤销→AI 节点回来」;拒绝后画布零痕迹;批量中途失败画布零半截
- **回滚**:事务层独立模块,可降级回逐条确认

### S7 成本预估 gate(簇 C)(1-2d)
- **范围**:新 `estimateGenerationCost.ts`(archetype params × Model.pricing.specCosts join,数据已有全未用);**gate 按「单次触发的总预估」计**(评审 P2:批量 20 个低单价镜头也要拦),拦在 `runGenerationNode` 与批量入口;成本写回 `provenance.cost`(DTO 字段已声明,`taskApi.ts:44`);计划卡显示预估总价
- **验收门**:五门 + 真机:批量生成前看到总价;单次触发总价超阈值需确认
- **回滚**:gate 可配置关闭

### S8 节点指纹缓存(治白花钱;可裁)(1-2d)
- **范围**:`nodeFingerprint.ts`(hash 模型+prompt+seed+参数+参考图归一);`runCatalogGenerationTask` 入口旁路,命中即复用 result(provenance 标 fromCache)+发 cache-hit 进度事件;重点覆盖 `rerunGenerationNodeAsNewNode`(最易白花钱路径)
- **已知难点**:参考图 URL 归一(nomi-local:// vs 远端 vs dataURL 同图)
- **验收门**:五门 + 真机:参数没变重跑秒回不发请求;改任一参数则正常重跑
- **回滚**:纯旁路,关闭即回

### S9(后置)项目记忆卡(簇 E)
- 依赖 S3/S5 的日志(记忆=日志的物化视图),完成 S6 后另出方案。

**总量(评审修正 + S2b):S0-S8 净工程 17-24 个聚焦工作日,含审批回路/五门/走查固定开销后按 22-32 天备粮;S8 可裁,S9 已后置。里程碑:M1=S0-S2b-S4(快赢+可观测+拓扑批量);M2=S5(地基);M3=S6-S8(事务+成本+缓存)。每片独立 push,任何一片后都可暂停。M1 结束时用户可感知的是 S1 防串台+S2 进度条;命门(整笔撤销)在 M3 见面——这是地基先行的代价,已知情。**

---

## 7. 框架完整性对账(H=ETCSLV × 切片覆盖矩阵)

> 框架(参考池 §1:H 六分量 + Subagents/MCP = 8 件零件,即 Claude Agent SDK 七零件 + V)在这里当**完整性对账单**用:每件零件先翻译成"对 Nomi 意味着什么"(我们是创作 harness,不照搬编码 agent 的解释),再对"现状→哪个切片管→还缺什么"。**有缺口不等于必须现在做,但必须显式记账,不许靠遗忘漏掉。**

| 零件 | 对 Nomi 的含义(创作域翻译) | 现状(实测) | 切片覆盖 | 缺口 / 有意留薄 |
|---|---|---|---|---|
| **E 执行循环** | **两条循环**:①对话 loop(LLM 多步工具调用)②生成 runtime(慢且贵的 vendor 任务调度)——编码 agent 只有①,创作 harness ②同样是 E | ①活着(`agentChatV2.ts:466`,maxSteps/retry/repair)但有两套;②批量是平铺 FIFO | **S0**(合并两套)、**S2b**(②改拓扑波次调度)、S3(transitions 状态机入轨迹,借 ViMax) | 无大缺口 |
| **T 工具注册** | agent 的手脚:10 个 zod 工具 + makeAgentTool 确认门包装 | `canvasTools.ts`/`documentTools.ts` 各 5 个;onboarding 第三组独立 | **S0**(去重)、**S6**(提议事务语义包装) | **缺口 T1**:agent 没有"发起生成"工具——它只能摆好节点等用户点。S2b 的确认门落地后,给 agent 加 `run_generation_batch` 工具变得**结构性安全**(它只能产出待确认的执行计划,花不了钱)。**缺口 T2**:工具 schema 加 meta(bug① 余项,MEMORY 在案) |
| **C 上下文管理** | 喂给模型的东西怎么不爆、不丢关键:对话历史 + 画布状态 + 参考素材 | `capAgentHistory` **只会硬截断**(30 条/24k token,`agentChatHarness.ts:18-40`)——长对话早期内容静默消失,无摘要无压缩 | S1(防串台,算半个) | **缺口 C1(对账查出的最大洞)**:压缩/增量摘要**没有任何切片管**。ViMax 的抢先式压缩+增量摘要设计已调研(参考池 §3.2)但未排期。长对话(用户改十几轮提示词)必撞 |
| **S 状态/会话** | 项目持久化 + 跨重启连续性 | project.json 快照(700ms debounce);**主进程 LLM 对话记忆是易失 Map**(`agentChatV2.ts:387`,进程退出即丢) | **S1**(对话按项目分桶)、**S5**(EventLog 地基) | **缺口 S-a**:重启后 UI 气泡还在(store 持久化了)但 LLM 记忆是空的——**两套真相不同步**,用户接着聊,AI 全忘了。可从 S3 日志重建或持久化历史 |
| **L 权限/生命周期** | 确认门、锁、预算闸——创作域 L 比编码域多一道"花钱前拦截" | 每工具确认门已有(`makeAgentTool`);无锁、无预算、无角色规则 | **S2b**(批量执行门)、**S6**(提议批准/拒绝/锁)、**S7**(预算 gate) | 覆盖最好的一件。角色级规则(谁能改什么)留 S6 落地后看实际需要再加 |
| **V 轨迹/评估接口** | 两半:①**轨迹**(每步可查可回放)②**成功信号**(这步结果好不好——创作域=视觉/技术自检) | ①onboarding 有 trace 模板,主路径全无;②全无 | ①=**S3/S4/S5/S6**(覆盖最重,设计如此) | **缺口 V-a**:②成功信号没有切片——生成完没人自动看一眼"是不是黑帧/静音/破图"(OpenMontage 的 ffprobe 技术自检,**免费**);VLM best-of-2 审美评分(**烧额度**)另案。当前 V 只记"发生了什么",不判"结果好不好" |
| **Subagents** | 分而治之、隔离上下文 | 无 | — | **有意留薄(有实证)**:ViMax 实测就是单 loop + 阶段 prompt + 工具角色(参考池 §3.2),Nomi 同构。触发条件写死:某个 skill 需要隔离上下文/并行探索时再开,不预建 |
| **MCP** | 外部能力标准接口 | 无 | — | **有意延后**:Nomi 工具全是进程内的,无外接生态需求;S0 抽的 `runAgentLoop` 接口预留扩展位,需求出现前不做(P4:接口通用,不预实现) |

### 缺口处置表(R3,记账不等于扩 scope——当前承诺范围 S0-S8 不变)

| # | 缺口 | 建议处置 | 量级 | 谁拍板 |
|---|---|---|---|---|
| C1 | 上下文压缩/增量摘要 | M3 后独立切片,抄 ViMax preflight compaction + 增量摘要 | 1-2d | 推荐做,排期你定 |
| V-a | 技术自审(ffprobe 黑帧/静音/破图,免费) | 并入 S4 出口或 M3 后小切片;"review 不过就标记不静默呈现" | 0.5-1d | 推荐做 |
| S-a | LLM 记忆跨重启同步 | S3 之后顺手:从日志重建对话历史(或持久化 Map) | 0.5-1d | 推荐做 |
| T1 | agent 发起生成工具(走 S2b 确认门) | S6 之后:`run_generation_batch` 工具,只能产出待确认计划 | 0.5d | 推荐做(依赖 S2b+S6) |
| T2 | 工具 schema meta(bug① 余项) | 并入 S6(改工具时顺手) | ~0.5d | 推荐并入 |
| V-b | VLM best-of-2 审美评分 | **烧用户额度**——默认不做,做也是可选开关 | 1-2d | **必须你拍板** |

---

## 8. 风险表

| 风险 | 等级 | 缓解 |
|---|---|---|
| S5 影子期拖长,变成长期并行版(违 P1) | 高 | S5 三步排同一里程碑;CI 不变量看守;翻正 commit 必删 canvasHistory(剪贴板已先迁出) |
| 「写后立读」改异步导致 agent 工具读旧值 | 高 | 架构锁死:append+reduce 同步执行;属性测试覆盖 |
| immer draft 泄漏进事件 payload | 高 | §4.4 纪律 + lint 看守 + freeze 断言 |
| 日志膨胀(高频事件/大 payload 误入) | 中 | §4.3 白名单 + 4KB 单事件断言 + tool-result 截断;拖拽合并单 NodeMoved |
| 跨进程事件乱序 | 中 | 主进程 seq 统一定序,全局顺序唯一权威(§4.1) |
| 老项目迁移(v6 无日志) | 中 | v7 加载器以当前快照合成 genesis 事件;迁移管线已有三版先例 |
| 事件 schema 演进腐烂(updated{patch}) | 中 | v 字段 + upcast 链 + deprecation 计划(§4.1) |
| undo 粒度退化(逐事件而非逐手势) | 中 | txnId 手势分组进 schema 首版(§4.1),S5-b 验收门点名测试 |
| 撤销语义吓到用户(跨会话历史) | 低 | 首版保持会话内撤销 UX 不变;跨会话撤销留产品决策 |
| store 手术期间并行会话冲突 | 中 | S5 期间单会话施工(MEMORY 先例教训) |
| 工期低估 | 中 | 已按 20-30 天备粮;S8 可裁;每里程碑后可暂停重估 |

---

## 9. 验收与发布

- 每片:五门(`check:filesize`→`lint:ci`→`typecheck`→`test`→`build`)+ 片内验收门(§6)
- M3 完成后:R13 全旅程 J1-J5 走查 + R14 审计文档;与计划卡样张 v3 逐项对账(P3)
- 发布:重打包 /Applications/Nomi.app(工作树必须干净,MEMORY 教训)

---

## 10. 评审记录(R7 回填)

6 角色对抗评审(CTO/前端/后端/PM/设计/真实用户)结论:**架构方向成立,1 P0 + 7 P1 必改后可拍板**。全部已回填:

| 必改项 | 回填位置 |
|---|---|
| P0 S5a 撞 check:filesize 棘轮 | S5 增第 0 步纯机械拆壳 |
| P1 canvasHistory 里有剪贴板,删文件=砍功能 | §3.3 / S5-b:剪贴板先迁 canvasClipboard.ts |
| P1 事件 schema 无版本化 | §4.1:v 字段 + upcast + deprecation 计划 |
| P1 IPC 写盘三件套缺失、崩溃恢复承诺夸大 | §4.4:批量/fsync/撕裂尾行 + 量化丢失窗口 |
| P1 tool-result 大 payload 日志爆炸 | §4.3:截断 + 4KB 断言 + sidecar |
| P1 用户手势无分组,undo 粒度退化 | §4.1 txnId + S5-b 验收门 |
| P1 选择性撤销冲突 + 双撤销并存语义 | S6:确认弹窗策略 + Cmd+Z 互操作 + R13 旅程 |
| P1 §1 承诺轨迹可见但无切片交付 | S6 增最小轨迹视图(计划卡「查看步骤」) |
| P2 批次 | 单写者收编(S3/S5)、seq 定序(§4.1)、成本按次计总(S7)、计划卡两态 mockup(S6)、检查点只数 canvas 域(§4.4)、工期备粮(§6) |
