# 接模型验证 run 的失败路径：不许停在中间态（2026-09-12）

状态：✅ 已交付 · 分支 `fix/integration-run-failure-path-20260912`

> 上游复盘：`docs/plan/2026-09-11-mcp-integration-quality.md`（真机接入 otokapi 的完整轨迹与分层方案）。
> 根因合同：`docs/fixes/2026-09-12-integration-run-failure-path.root-cause.json`（recurring）。
> 本轮只做那份方案里的 **P0 + P1**；P2（并发/部分晋升/仅重试失败模型）与 P3（目录刷新滞后）按用户拍板不进本 PR。

## 一、背后逻辑（为什么要做这件事）

用户那一刻卡在哪：点完「确认验证」，界面写着「正在验证」，然后**永远**写着「正在验证」。
想取消，按钮告诉他不能取消。想知道为什么，界面上没有任何一个模型的错误原因。
唯一能做的是重启 app——重启之后才看到一行 `certification_timed_out`。
而同一批模型 curl 直连全部 200：上游好好的，卡住的是我们自己。

底下的机制是一句话：**失败路径比主路径弱**。主路径出错能进 catch，
catch 自己出错时无人兜底——那一下正好是「把 run 写成失败」的写盘，它拿不到文件锁抛了，
异常冒到一个没有 `.catch` 的 fire-and-forget promise 里被吞掉，状态机就停在 `certifying` 不动了。
再往下一层：状态机根本没有「中间态最终必须变成终态」这条规矩，也没给用户留逃生口，
恢复只发生在「下次启动」。所以任何一次写盘失败——锁、盘满、只读、被 kill 的实例留下的租约——
都会长成同一个样子。**锁只是放大器，没有兜底的状态机才是根因。**

一个必须点破的数字错配：文件租约的 TTL 是 **30 秒**（被 kill 的进程留下的租约要等它过期才能被接管），
而写盘时的自旋上限是 **3 秒**。等待上限短于租约上限，意味着撞上一次陈旧租约就**结构上不可能**成功——
不是「偶尔慢」，是「必然失败」。这条错配现在被写成一条构造期断言钉死了。

## 先查别人

**① 依赖里已有？** 有一半，但盖不住这条。`node_modules/.pnpm/p-retry@*/index.d.ts` 提供
`retries/factor/minTimeout/onFailedAttempt` 的指数退避，`p-queue` 提供并发与超时——它们解决的是
「重试怎么排」，不解决「重试到底了之后状态机该变成什么、证据留在哪、谁来收尸」。本仓也没装
`p-retry`（`git grep -n "p-retry\|async-retry" package.json` 无结果），为这一处引一个依赖
不划算（R20：不在护城河上但也不碰钱/信任，且标准库够用）。**结论：不引，自研 45 行。**

**② 仓库里已有？** 有三处相邻实现，都**不是**这条不变量的持有者，逐个看过：
- `electron/productionRun/productionRunLock.ts:193` `withLock` —— 拿锁/放锁的包装，
  不含重试，也不含「拿不到锁怎么办」。
- `electron/providerAdapter/serviceLifecycle.ts:1` `awaitAdapterStep` —— 管**单步**的
  deadline/abort，不管终态写。
- `electron/integrationCertification/providerAdapterCoordinator.ts:378`
  `cancelBeforeRemoteSettlement` —— 管「远端受理前能不能撤」，不管中间态收尾。
`git grep -n "errors.jsonl\|append-only"` 在 electron/ 下无结果：append-only 旁路日志是本仓第一份。
**结论：没有可复用的持有者，新建一个模块。**

**③ 生态里已有？** 上游同一批近邻调研已做完，正本在
`docs/research/2026-09-11-mcp-integration-quality/prior-art.md`（主仓未提交）。原文结论：

| 来源 | 与本轮相关的做法 | 我们照办 / 有意不同 |
|---|---|---|
| **TokenHub**（Go 网关 Provider Health System，https://jordanhubbard.github.io/tokenhub/developer/health.html） | 并发探测 + 每探测独立超时（默认 10s），绝无全局串行大墙钟；三态 healthy/degraded/down | **有意不同（本轮）**：并发与 per-model timeout 属 P2，本轮不做。本轮只保证「超时之后能自动收尾」 |
| **OpenClaw model-healthcheck**（https://clawhub.ai/xmanrui/skills/model-healthcheck） | 每模型独立 30s 超时并发跑；结果聚合成逐模型 `✅/❌ — 错误原文`；单模型可单独重测 | **照办一半**：逐模型错误原文本轮接进 `session.read`（`modelResults`）；单模型重测属 P2 |
| **model-check**（https://deepwiki.com/chxcodepro/model-check/4.2-model-detection-and-monitoring） | 每模型持久化 `last_status / latency / http status_code / error 原文`，把验证做成一等持久状态 | **照办**：run 的 `models[].modes[]` 本就持久化这些字段，本轮把它投影到会话面上（盘上有、界面上没有） |
| **Beluga AI**（https://beluga-ai.org/docs/guides/foundations/health-checks） | 验证请求刻意最小化（`WithMaxTokens(1)`），完整走鉴权链但成本压到厘级 | **不适用本轮**：我们的文本验证走 `streamTextTask` 生产同路，是上游复盘的「不动项」 |

近邻里**没有**直接对应「终态写失败怎么办」的先例——它们的健康检查是无状态探针，
失败就是一条记录，不存在「状态机停在中间态」这个问题。那一层是我们自有的语义
（run 阶段集合、终态定义、文件租约锁的租期），按 R31 属于「没有外部标准可对齐」，
合同的 `internal_only_reason` 记了这个判断。

**④ TikHub 自媒体里怎么说？** 本轮没查——这条是进程内状态机与文件锁的收尾语义，
不是用户可感知的产品形态或框架选型，自媒体侧没有对应的讨论面。判断依据是上面三问已
给出可复核的判据（依赖 d.ts、仓库 file:line、四份带 URL 的近邻），不靠舆论补强。

**结论：用已有（近邻的「逐模型原文 + 持久化验证状态」照办）+ 自研（终态保证与看门狗）。**
自研的理由是领域约束而非偏好：这条不变量绑死本仓自己的 run 阶段集合与那把文件租约锁的
租期常量，任何通用重试库都拿不到这两个数，也就无法断言「预算必须长过租约」。

## 三、门表：run 状态的写入口与读入口

这条不变量要盖住的门，逐个点名（file:line 以本分支为准）：

**写入口（可能把 run 推进/推出中间态的地方）**

| 门 | 位置 | 本轮处置 |
|---|---|---|
| 唯一状态写 | `electron/providerAdapter/store.ts:295` `mutate`（文件租约锁在此） | 锁租期/自旋两个常量命名导出并互相绑定；自旋**不加长**（理由见下） |
| 终态写唯一入口 | `electron/providerAdapter/service.ts:733` `finishTerminal` | 四个同义入口收成这一个，一律转交 `TerminalWriteGuarantee` |
| 终态写实现体 | `electron/providerAdapter/terminalGuarantee.ts` `writeAdapterTerminalFailure` | 服务内不再自带实现，保证链与服务层调同一份 |
| run 执行入口 | `service.ts:299` `executeRun` | promise 挂 `.catch`，接住失败路径自己的失败 |
| 撤销 | `service.ts:266` `cancel` | 不变（远端已受理时仍不假装撤销），但结果由会话侧如实转述 |
| 启动恢复 | `service.ts:277` `resumeInterrupted` | 先跑旁路补偿，再开看门狗 |
| 看门狗 | `terminalGuarantee.ts` `TerminalReaper`（每 30s） | 新增：deadline 过期且非终态 → 强制 `timed_out` |
| 旁路 | `provider-adapters.json.errors.jsonl`（append-only） | 新增：主存写不进去时的证据，**不走同一把锁** |

**读入口（谁在看 run 的状态）**

| 门 | 位置 | 说明 |
|---|---|---|
| 单个 run | `store.ts:159` `getRun` | 不走锁——所以死锁期间读得到「还在 certifying」，症状才长成「卡住」而不是「报错」 |
| 活跃 run 列表 | `store.ts:171` `listRuns` | 看门狗的输入 |
| run → 会话阶段 | `integrationSession.ts:820` `syncHttpCertification` | 唯一同步点；run 一终态化，会话自动跟上（所以修在 run 层就够，不用在会话层再写一遍） |
| 会话投影 | `integrationSession.ts:774` `projection` | 新增 `modelResults`：逐模型的 error / httpStatus / errorCategory |
| 会话撤销 | `integrationSession.ts:1611` `cancel` | HTTP + 有 childRunRef → 开逃生口；ComfyUI 仍拒绝（理由见下） |

## 四、改了什么

### P0 — 失败路径不可破坏

1. **`executeRun` 的 promise 挂 catch**：记日志 + 转交终态保证。旧代码在这里把异常漏成
   未处理 rejection，run 就停住了。
2. **终态写三层保证**（`TerminalWriteGuarantee`）：
   同步直写 → 失败则**异步**指数退避重试 3s/6s/12s/24s（合计 45s）→ 仍失败落
   append-only `provider-adapters.errors.jsonl`，`resumeInterrupted` 启动时补偿扫描。
   重试链里每一轮都先读一眼 run：别人（看门狗 / cancel / 另一个进程）已经写成终态就认账收工。
3. **「退避预算必须长过租约 TTL」写成构造期断言**（`assertTerminalWriteOutlastsLease`）。
   两个常量 `PROVIDER_ADAPTER_STORE_LOCK_LEASE_MS` / `PROVIDER_ADAPTER_STORE_LOCK_SPIN_MS`
   从 store 命名导出：谁改了其中一个而不改另一个，服务一构造就炸。
4. **四个同义终态入口收成一个**（P1 加新必删旧）：`finishWithError` / `finishRunWithFailure` /
   `writeTerminalFailure` 的服务内实现删除，只剩 `finishTerminal`。保证没有旁路可绕。

### H1 / H2 审计结论（上游复盘里的两条待验证假设）

- **H1「是否存在跨 await 持锁」——不存在。** `ProviderAdapterStore.mutate` 的回调是同步的，
  整段没有 `await`；同进程两次 mutate 结构上不可能交错。所以「锁被占」只可能来自
  **别的进程**或**被 kill 的实例留下的未过期租约**。
  推论：**没有**把自旋上限提到 30 秒——`Atomics.wait` 是同步阻塞，那会把 Electron 主进程
  一起冻住 30 秒，既救不了锁又卡死界面。正解是把熬租约的等待放到**异步**那一侧，
  预算 45s > 租约 30s。自旋保持 3s 并命名导出，让这个数字的含义显形。
- **H2「epoch 接管对运行中陈旧租约的行为」——行为正确，本轮不改。**
  `acquire` → `reclaimExpired` 只在 `now >= expiresAt` 时用原子 `rename` 抢占，未过期一律抛 Busy
  （不会抢走活着的持有者）；`mutate` 在写盘前 `assertOwned(lease)`，租约若已被接管则抛 Lost 且**不写**；
  `finally` 的 `release` 同样先 assertOwned，不会删掉别人的锁。fencing 是完整的。
  运行中的陈旧租约由 30s 过期 + reclaim 自然收回——本条的修复是让**等待方**的预算长过这个 30s。

### P1 — 自愈 + 逃生口

5. **看门狗**（`TerminalReaper`，每 30s，启动时随 `resumeInterrupted` 起）：
   deadline 已过且仍非终态的 run → 强制 `timed_out`。恢复不再只发生在「下次启动」。
6. **`certifying` 允许 cancel**：HTTP 会话经 `cancelCertifyingRun` **真的去撤 run**；
   撤不掉（远端已受理）也放人走，但如实标 `certification_already_submitted`。
   **ComfyUI 仍然拒绝**——它的 certifying 是一个还在飞的本地 promise，没有可撤的 run，
   放行只会让「已取消」和随后 resolve 的「已完成」打架。这是有意的不对称，测试钉住了。
7. **逐模型错误原文进 `session.read`**：`modelResults`（modelKey / state / error / httpStatus /
   errorCategory / reasonCode）。数据盘上本来就有（`persistedModeResult`），只是没投影出来——
   不新造第二份真相。

### 实施中抓到的一条同族问题（已修在本轮里）

兜底代码**自己**不许成为新的启动依赖或新的失败源，这一轮踩到两次：

- `logError` 在非 Electron 宿主（vitest）里拿不到 `app` 会抛，而它正写在 `executeRun` 的
  catch 里——「兜住失败」的那只手把 promise 又拒了一次，变回本 PR 要消灭的那个未处理 rejection。
  → `neverThrows()` 包住所有观测调用：观测是辅助，不许成为失败源。
- 旁路日志的默认路径要读 settings root，原本在 `TerminalWriteGuarantee` **构造期**解析——
  于是一条只在「写盘失败」时才用得到的路径，变成了所有宿主构造 `ProviderAdapterService` 的
  启动依赖，`service.test.ts` 有 18 条用例因此拿不到结果。
  → `journalPath` 改成可传函数，**按需解析**。

两条是同一句话的两个面：**失败路径上的每一行都要比主路径更保守**。

### 不留安全阀门

这些全是**会响的检测器**，不是静默兜底：写不进去 → errors.jsonl + `logError`；
被看门狗收掉 → run 带明确超时理由、会话同步 failed 并附 blockingReason；
cancel → 返回明确结论（撤掉了 / 远端已受理）。没有任何一条路是「悄悄当作没事」。

## 五、验收

- `electron/providerAdapter/terminalGuarantee.test.ts`（8 条）：不变量断言、退避到第 N 次成功、
  写盘一直抛 → 落 errors.jsonl → 补偿终态化、别人已终态则认账、终态即掐 abort、看门狗两条。
- `electron/providerAdapter/terminalGuaranteeStore.test.ts`（3 条）：**真实 store + 盘上植入的真实租约**。
  ①锁被占时终态写确实抛（复现那一下）；②持锁期覆盖不到整个预算时仍在预算内终态化；
  ③整段预算都拿不到锁 → errors.jsonl 留证 → 锁释放后补偿收尾。
- `electron/providerAdapter/serviceFailurePath.test.ts`（3 条）：executeRun 不再漏成
  unhandled rejection（catalog 抛错 + 植入租约，仍 resolve，旁路留证，`resumeInterrupted` 收尾）；
  看门狗收 deadline 过期的 run；不碰未到期的 run。
- `electron/integrationCertification/integrationSessionRunView.test.ts`（5 条）：
  cancel 三种结局 + 逐模型原文投影两条。
- 真实验收见 PR 正文。

## 六、回滚

三块互相独立、各自可单独 revert：`terminalGuarantee.ts`（含服务接线）、
`integrationSessionRunView.ts`（含会话接线）、store 的两个常量导出。
没有数据迁移；`errors.jsonl` 是新增旁路文件，删掉即回到旧行为。
