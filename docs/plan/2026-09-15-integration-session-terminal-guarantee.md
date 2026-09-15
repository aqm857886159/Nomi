# 接入验证会话的终态保证（2026-09-15）

状态：✅ 已交付

> 范围：接入验证（「用 AI 帮我接入」/ MCP `nomi_integration` / 设置页自检）的**会话层**
> 终态保证与取消逃生口。前情是 2026-09-11 真机死锁复盘
> `docs/plan/2026-09-11-mcp-integration-quality.md`（那一版只落在 `providerAdapter` 的 run 层）。
>
> 不动项：六步协议、凭证按 baseUrl 复用、声明式说明卡、run 层已有的
> `TerminalWriteGuarantee` / errors.jsonl 旁路、ComfyUI 预留账本的语义。

## 一、背后的逻辑（大白话）

用户的话是「接入验证一直转然后全部失败」。转的那个圈叫 `certifying`。

Nomi 里有**两个**状态机在管这件事：
- 外层是**会话**（`IntegrationSessionService`）——用户和驱动 Agent 看到的就是它；
- 内层是**验证 run**（`ProviderAdapterService`）——真正去打供应商接口的那个。

2026-09-11 那次死锁之后，我们给**内层**装了很结实的保证：终态写拿不到文件锁就退避重试，
重试完还写不进去就落 append-only 旁路日志，启动时补偿，外加一只 30 秒一次的看门狗。

问题是**外层没有自己的保证，它是借内层的**。外层跟内层同步只有一条路
（`syncHttpCertification`），而那条路要求三件事同时成立：会话是 HTTP 供应商类型、
已经拿到了 `childRunRef`、那个 run 还在盘上。三种状态从这个「借来的保证」下面漏下去：

1. **本地 ComfyUI 会话**——那条自检不花钱、压根不走 run，从头到尾没有东西可借；
2. **HTTP 会话在「意图已落盘、`startHttp` 还没返回」这个窗口里被打断**——盘上写着
   `certifying`，但还没有 `childRunRef`；
3. **run 记录已经被删**（用户把那个连接删了）而会话还引用着它。

这三种状态里，`cancel` 都直接抛 `Cannot cancel certification in progress`。
所以用户看到的就是：圈一直转、点取消没反应、只能重启 app——重启之后那条会话还在转，
因为没有任何东西会去收它。

## 二、要权衡的那个核心东西

**「给用户一个出口」和「不出现两个互相矛盾的结论」，看起来是对立的。**

原来的代码选了后者：不让你取消，是怕你取消之后那个还在飞的本地 promise 跑完了，
又把会话写回 `completed`——于是盘上一个「已取消」、界面上一个「已完成」。这个担心是对的。

但它把代价全压在用户身上：为了避免一种罕见的显示矛盾，让**所有**卡住的人都没有出口。

正确的拆法是：矛盾靠**「终态一旦定下就是封的」**来解，不靠**「不给出口」**来解。
于是两件事可以同时成立——取消随时可按，迟到的结果认账不覆写。

## 三、根因

- **直接原因**：`cancelCertifyingRun` 在三种「没有可撤的 run」的情形下抛异常，
  `IntegrationSessionService.cancel` 跟着抛，会话停在 `certifying`。
- **类根因（真正的根）**：**会话层拥有 `session.stage` 这份状态，却没有拥有它的终态保证**。
  它把终态保证外包给了子 run，而那份外包只覆盖子 run 存在的那些情形。
  一份状态的不变量必须由**拥有这份状态的那一层**兜住——借来的保证一定有边界，
  而边界之外就是死锁。
- 这是 `recurring`：同一族只要再出现一个「会话进了中间态但底下没有 run」的新入口
  （新的 connector kind、新的自检类型），旧修法就又漏一个。

## 四、修在哪（最早共享边界）

owner 层 = `electron/integrationCertification/`（会话层）。新增
`integrationSessionTerminal.ts` 作为这条不变量的家：

1. **认证 deadline 与开跑意图同一次落盘**（`integrationSession.ts` 的 `start()`）。
   只落意图 = 盘上多一条没有尽头的 `certifying`。
2. **会话层看门狗**——**复用 run 层那只 `TerminalReaper`**，只换一把「什么算终态」的尺子
   和一句理由。两层各写一只就是并行版（P1）：同一条判据两份实现，日后只会改到一份。
   装配在 `installIntegrationSessionRuntime()`，进程一起来就先补偿一遍再挂上周期扫描。
3. **cancel 永远可达**：`cancelCertifyingRun` 不再抛异常。能撤的真去撤；没有可撤的东西，
   一样放人走，标注 `certification_abandoned_locally`（这是**事实**，不是兜底）。
4. **终态封口**：`start()` 的认证结果先攒在局部变量里，回写前先查
   `isTerminalIntegrationStage(session.stage)`。已经落终态的会话不许被迟到的结果复活。
5. **旧数据补偿**：`integrationSessionRecord.ts` 给盘上已经卡在 `certifying` 的老会话
   按它最后一次动过的时间补一个 deadline——用户此刻盘上就躺着这样的会话，
   不补等于让他手动删文件。按 `updatedAt` 而不是「从现在起算」，
   否则每次重启都给它续命一轮。

### 派生而不是拍数字

会话 deadline 是**派生**的，不是拍一个 10 分钟（09-10 用户退回过 #690 那种改常量的修法）：
它必须长过子 run 把自己收干净的上限 = 批次 deadline（5min）＋ 终态写退避预算（45s）
＋ 看门狗一个周期（30s）= 375s。短于它，会话会在 run 还有合法机会成功时先被判死，
两层给出互相矛盾的结论。这条大小关系写成 `assertSessionDeadlineOutlastsRunSettlement()`
并在测试里钉住。顺手把 `batchTimeoutMs` 的默认值从 `service.ts` 里复制的四份收成一个
`PROVIDER_ADAPTER_BATCH_TIMEOUT_MS`（门表：4 → 1）。

## 五、没有留安全阀门

按 2026-09-11「不留安全阀门」：本单没有静默转进、没有 fallback。
- 看门狗**不吞**任何东西：被它收掉的会话带着 `certification_timed_out` 出现在投影里；
- 取消不可撤时标注 `certification_abandoned_locally`，而不是假装撤销了；
- 没有 deadline 的会话**不判死**（没根据不判死），legacy 那批靠迁移补 deadline 而不是猜。

## 六、验收门

- 复现测试（阳性对照：修前 7/7 红，红的是 `Cannot cancel certification in progress`
  与「没有会话看门狗」）→ 修后 8/8 绿：
  `electron/integrationCertification/integrationSessionTerminal.test.ts`
- 既有两条断言**旧行为**的测试改指新不变量（不是删覆盖）：
  `integrationSessionRunView.test.ts`（1 条改写 + 2 条新增覆盖另两个漏洞窗口）、
  `integrationSession.test.ts`（ComfyUI certifying 现在可取消）
- `pnpm run gates` 绿
- 真机一次：隔离 profile，DeepSeek 官方端点走「接一个 OpenAI 兼容中转站」，
  会话能落终态、certifying 阶段能取消（截图见 PR 正文）

## 七、本单之后怎么接（T-MO-07，不在本单）

T-MO-07 = 并行验证 + 每模型 30s 超时 + 部分成功 + 只重测失败。它**依赖**本单：

1. **per-model 超时先要有归属**。本单只保证「批次一定落终态」；T-MO-07 要的是
   「每个模型各自落终态」，那是 `ProviderAdapterService.process()` 里把串行循环换成
   `Promise.allSettled` + per-model `awaitStep(timeoutMs: 30_000)`。
   现有 `awaitAdapterStep` 已经支持 per-step timeout，不用新造等待原语。
2. **批次 deadline 会从「压线」变成「几乎用不上」**。6 个模型串行压 5 分钟是 T-MO-07
   要解决的 P1；并行之后批次时间 ≈ 最慢的那个模型。此时
   `PROVIDER_ADAPTER_BATCH_TIMEOUT_MS` 应当下调，而**会话 deadline 会自动跟着降**——
   因为本单已经把它做成派生量，`assertSessionDeadlineOutlastsRunSettlement` 会替我们
   检查新的大小关系。这就是本单不拍数字的回报。
3. **部分成功的终态词表要先定**。`promoteFinal(..., deadlineReached)` 已经会晋升已通过的
   模型，会话侧 `partial` 这个 stage 也已经存在（`integrationStageFromAdapterRun`），
   所以 T-MO-07 不需要新 stage；要做的是让 `partial` 带上逐模型 ✅/❌，
   而逐模型原文在本单之前就已经投影到会话面上了（`modelResultsFromRun`）。
4. **「只重测失败模型」** = 复用同会话再 propose 一次，`selections` 填上轮失败者。
   本单把「卡住的会话能被取消/收尸」修好之后，这个重试循环才有意义——
   否则用户连上一轮都退不出来。

## 先查别人（R27）

### 池子一：框架原生（我们已经装的东西自带的）

| 能力 | 在哪 | 本单怎么用 |
|---|---|---|
| `AbortController` / `AbortSignal`（Node 原生） | `electron/providerAdapter/serviceLifecycle.ts:34`（`awaitAdapterStep` 已用它做 per-step 取消与超时竞速） | 直接复用，**没有**为会话层另写等待/取消原语 |
| `AbortSignal.timeout` / `signal.reason` | Node ≥18 原生，`electron/tasks/comfyCandidateTest.ts:125` 已用 `setTimeout + controller.abort` | ComfyUI 那条路 300s 硬超时已存在，本单不重做，只在它之上补会话层兜底 |
| `structuredClone` | Node 原生，`integrationSession.ts` 的 `clone()` | 不引 lodash 之类 |

### 池子二：生态 npm

| 方案 | 结论 | 理由 |
|---|---|---|
| `p-timeout` / `p-retry`（sindresorhus） | **不引** | 我们要的不是「给一个 promise 加超时」，而是「**盘上的状态机**不许停在中间态」——超时只是触发器，真正的难点是终态**写**本身可能失败（文件锁）。`p-retry` 帮不到写盘退避 + append-only 旁路 + 启动补偿这一整套，而那一套 `providerAdapter/terminalGuarantee.ts` 已经有了。引它只会多一层与已有实现并行的重试语义。 |
| `bullmq` / `agenda` 之类任务队列（自带 stalled-job reaper） | **不引** | 它们的 reaper 是对的思路：BullMQ 每 `stalledInterval` 毫秒跑一次 stalled 检查，发现锁没续上的 active job 先移回 wait 重试，超过 `maxStalledCount`（默认 1）就**永久判 failed**（docs.bullmq.io/guide/jobs/stalled、docs.bullmq.io/guide/workers/stalled-jobs，2026-09-15 经 Context7 实查），与本单的看门狗同构。但都要 Redis/Mongo。Nomi 是本地优先、单机、无外部服务；为一只 30 秒扫一次的看门狗引一个数据库违反 R20（不在护城河上，但标准实现的代价反而更高）。**借的是它的语义**：非终态 + 超期 = 强制失败并留理由，不是静默重排。 |
| `xstate`（状态机库，自带 `after` 定时转移） | **不引（本单）** | `after(...)` 正是「中间态到点自动转终态」的声明式表达，思路可借。但我们的状态机是**落盘**的、跨进程的、还要和另一层（run）对齐；xstate 的定时转移活在内存里，进程死了就没了——而本单要修的恰恰是「进程死了之后谁来收」。改造成本远大于复用现成的 `TerminalReaper`。 |

### 池子三：我们自己（最重要的一池 —— 本单主要是复用，不是新造）

| 已有的 | 在哪 | 本单的关系 |
|---|---|---|
| `TerminalReaper`（非终态 + 过期 → 强制终态） | `electron/providerAdapter/terminalGuarantee.ts:281` | **直接复用**，只把元素类型结构化成 `TerminalReapable` 并允许传自己的 `isTerminal`。会话层不新造看门狗。 |
| `TerminalWriteGuarantee`（退避重试 + errors.jsonl + 启动补偿） | `electron/providerAdapter/terminalGuarantee.ts:139` | 不动。会话状态写的是 `integration-sessions.json`，不走 run 那把文件锁，所以本单不需要第二份写保证。 |
| `assertTerminalWriteOutlastsLease`（派生关系机检） | `electron/providerAdapter/terminalGuarantee.ts:44` | **照抄手法**：`assertSessionDeadlineOutlastsRunSettlement` 是它的同族，让「会话 deadline > run 收敛上限」变成构造期就炸的断言。 |
| `adapterTerminalReasonCode`（run 终态 → 封闭原因码） | `electron/integrationCertification/integrationSessionRecord.ts:40` | 复用它产出 `certification_timed_out`，不在看门狗里另写字面量。 |
| `isTerminalAdapterStage` | `electron/providerAdapter/store.ts` | run 层那把尺子；会话层的 `isTerminalIntegrationStage` 是另一个状态机的词表，两把尺子各管一层，但只各有一份（原来 `integrationSession.ts` 里那个 `TERMINAL` const 已被收进新模块）。 |
| `awaitAdapterStep` | `electron/providerAdapter/serviceLifecycle.ts:26` | per-step 超时/取消的唯一实现；T-MO-07 的 per-model 30s 就用它，不新造。 |

## 回滚

四处独立小改，可各自单独 revert；无数据迁移（`certifyingDeadlineAt` 是新增可选字段，
迁移只补值不改结构，旧版本读到未知字段会被 `validateState` 拒——所以**回滚要连
`integrationSessionRecord.ts` 的 allowlist 一起回**，否则已写过新字段的盘读不回去）。
