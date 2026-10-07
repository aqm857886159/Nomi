# 设计卡：没发出去的尝试放掉镜头认领（L-claim）

```
改动名：确定没离开本机的付费尝试 → 释放认领、可直接重试；说不清的仍进对账
线/负责人：L-claim（实现）        类别：[花钱][可打断]
```

根因合同：`docs/fixes/2026-10-06-claim-release-unsent-attempt.root-cause.json`（`detected_by: review`）。
方向检查：`docs/plan/2026-10-06-claim-release-unsent-attempt-direction-check.md`。

## 一句话

付费提交「有没有离开本机」以前只看**最后那个错误**里有没有连接层证据；在本机就被拦下的失败（出网策略、请求头、密钥、网络设置没就绪……）没有这种证据，一律被记成「结果未知」，镜头冻进对账，用户换模型重试也被拒。现在由**网络出口**（`appFetch`，主进程唯一的 Node HTTP 口）给每次付费派发记账：一笔可能花钱的请求都没交出去，或交出去的全在连上之前失败，才算「确定没发出」；其余一律仍按「结果未知」。

## 9 格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在分镜参考卡 / 画布节点 / Agent 付费卡上点生成，而这一次在本机就被拦下（代理 / 防火墙 / 网络设置 / 密钥 / 素材）时，我想看到「没发出去 + 为什么 + 下一步」，处理好就能直接重试（换不换模型都行），不被要求去服务商后台对账。步骤：①点生成 ②失败面写原因 ③修好（或换模型）④点重试 ⑤出图。**不做**：不改「结果未知」那一档的任何行为（仍锁住、仍要核对）；不自动重发本机拒绝；不在界面上谈钱。**已知坑**：代理拒绝 CONNECT（407/403）仍是「结果未知」（undici 没有结构化标记，见格 6）；引擎 B（目录执行器）没有提交侧出网策略（另报）。真实任务：V-1042 审计第 22 张（参考卡 GPT Image 2 被拦 → 换回环模型重试）；画布节点密钥缺失后补上再生成；Agent 付费卡在断网机器上点确认。主指标：本机被拦的尝试落成 `provider_not_reached` 的比例（目标 100%）；护栏：任何写出去过的尝试被判成「没发出」= 0（矩阵防双扣列 + 变异）。 | `electron/productionRun/unsentAttemptClaim.matrix.test.ts`；`tests/ux/claim-unsent-retry.walk.mjs` |
| ★2 谁说了算 | 「这次付费派发有没有离开本机」→ `production.submission-dispatch-evidence`（owner `electron/outboundDispatchEvidence.ts`，新写口 `observeSubmissionHandoffs` / `handOffToNetwork`，消费者加 `electron/appFetch.ts`）；「这一镜归谁」→ `decideShotClaim`（唯一判定口，新增：最近一次尝试确定结束在受理之前 → 归画布）；job 状态写手仍只有 `submissionOutbox`。碰 2 个概念。 | `node scripts/door-map.mjs observeSubmissionHandoffs handOffToNetwork jobEndedBeforeAcceptance SubmissionNotDispatchedError decideShotClaim`（合同 `doors`） |
| ★3 一致与复用 | 判据仍住原来的 owner，不另起分类器；上下文用 Node 内置 `AsyncLocalStorage`（不自写上下文传递）；「哪些请求不可能花钱」复用 `credentialRedirectPolicy.requestCarriesCredentials`；失败面复用画布错误卡的 `classifyGenerationError` + 词表，分镜画面格只是换个地方说同一句话；引擎 B 的请求头守卫复用引擎 A 的 `findIllegalHeader`。单测的 appFetch 替身也走同一个 `handOffToNetwork`。 | `git grep handOffToNetwork`；`check:self-written` |
| ★4 全状态 | 没发出（本机拦）：「这次生成没有发出去，停在了这台电脑上」+ 悬停说常见原因与「可以直接重试」；连不上：「连不上服务商」（原有词条）；Nomi 自己的出网策略：原有「Nomi 自己的安全策略先拦下了」；明确拒绝：原有分类；结果未知 / 对账中：「这一镜可能已被服务商收下，结果没法确认」，画面格**不出重试**；生成中 / 成功 / 可找回：不变。中英两套进 i18n；**不写「没扣费」**（10-02 用户定「界面不谈钱」，`check:i18n-no-cost-claims` 拦），只说事实「服务商没有收到它」。 | `src/workbench/creation/storyboard/exec/storyboardFailureCopy.test.ts`；截图 `tests/ux/shots/claim-unsent-retry/{zh-CN,en}/` |
| 5 中途表 | 见下表 | 矩阵 + 走查 + 人工推演 |
| 6 外部数据与失败 | undici：connect 阶段错误带 `syscall: "connect"` / DNS / TLS 码（原有判据）；代理 CONNECT 非 200 抛 `RequestAbortedError`（`UND_ERR_ABORTED`，只有文案能区分）→ 仍按结果未知（不靠文案）；供应商 4xx 名单 / 5xx / 断连：原有判据不变。未知失败不说成用户 key 的问题。 | https://github.com/nodejs/undici/blob/v6.19.8/lib/dispatcher/proxy-agent.js ；https://nodejs.org/api/async_context.html |
| 7 性能预算 | 每次 appFetch 多一次 `AsyncLocalStorage.getStore()` 与（仅派发内、可能花钱的请求）一个 Symbol 进出 Set；量级纳秒，不记录。 | 人工 |
| 8 真实条件 | Windows ✔；中 / 英 ✔（走查两轨）；最小窗口 ✘ unverified；真规模 ✘ 不适用（单镜）；干净安装 ✔（走查夹具新用户目录）；真付费 ✘ 零花费（回环 + 出网闸）；键盘全程 ✘ unverified。 | `tests/ux/shots/claim-unsent-retry/` |
| ★9 验收与回滚 | 验收：另一条线（协调会话派）读矩阵、跑两次变异（见 PR）、跑 `NOMI_AUDIT_LOCALE=zh-CN/en node tests/ux/claim-unsent-retry.walk.mjs` 看截图；回滚：revert 本 PR 的提交即可（无数据迁移，已冻的 `submission_unknown` 不动）。 | PR `## 独立验收`（待派） |

### 功能分类
- [x] 花钱
- [x] 长跑 / 可打断
- [x] 新界面 / 改交互（失败面文案、对账态不出重试）
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式

## 格 5 中途表（状态 × 停 / 关窗 / 断网 / 重启 / 连点）

状态说明：A = 本机被拦（`never_reached_network`）；B = 连不上（`connect_failed`）；C = 发出后不明（`submission_unknown`）；D = 明确拒绝（`provider_rejected`）；E = 重试中（第二次派发进行中）。

| 状态 | 停（点停 / 收回） | 关窗 | 断网 | 重启 | 连点重试 |
|---|---|---|---|---|---|
| A 本机被拦 | 看到失败面「没发出去」· 不扣 · 回执：job `needs_attention/provider_not_reached`，预留 `released` | 同左（结论已落盘，不靠窗口）· 不扣 · 同左 | 下次重试若仍断网 → 仍是 A 或 B · 不扣 · 同左 | 重开项目：画布 Run 已收尾、标记已删，节点照常可点 · 不扣 · 盘上 Run | 同一运行记录号去重；新运行记录号各自独立派发，第一笔在派发时检查节点在途（`node_generation_in_flight`）· 只发一笔 · Run 账本 |
| B 连不上 | 同 A（出口自动重发过一次仍连不上）· 不扣 · 同 A | 同 A | 同 A | 同 A | 同 A |
| C 发出后不明 | 失败面「可能已被收下」，无重试 · 可能已扣 · job `submission_unknown`，预留 `unsettled` | 交给主进程观察者；结论不变 · 可能已扣 · 同左 | 不变 · 可能已扣 · 同左 | 重开项目「没收尾」标记仍在，节点拒成 `needs_reconcile` · 可能已扣 · 盘上 Run | 每次都被认领拒成 `needs_reconcile`，供应商不再多收 · 不再扣 · 矩阵防双扣列 |
| D 明确拒绝 | 失败面写供应商原因，可重试 · 不扣 · `provider_rejected`，预留 `released` | 同左 | 同左 | 同左 | 同 A |
| E 重试中 | 交出去之前点停 → 收回、不发；交出去之后 → 跟普通生成一样跑完 · 按普通生成 · Run 账本 | 交给观察者跑完 · 按普通生成 · 同左 | 交出前断网 → 落 A/B；交出后断网 → 落 C · 见 A/B/C · 同左 | 交出前崩溃：提交意向已 committed → 重启记 C（保守）· 可能已扣 · 意向日志 | 同节点第二下被在途拒（`node_generation_in_flight`）· 只发一笔 · 同左 |

## 自写了什么、为什么必须

- `observeSubmissionHandoffs` / `handOffToNetwork`（约 70 行）：「这一次付费派发有没有离开本机」是**按镜头的花钱语义**（领域目录内），判据只能住在我们自己的出口上；上下文传递用 Node 内置 `AsyncLocalStorage`，不自写。
- `storyboardFailureCopy`（20 行）：只是把现有分类器的结论放进分镜画面格，没有新判据。

## V-1047 验收后的修订（2026-10-06）

- **B1 子进程执行器**：画布那台的 runTask 里有 process 分支（即梦 CLI、Antigravity CLI），子进程自己出网、不经 appFetch，第一版账上 0 笔 → CLI 跑起来后超时会被判成「没发出」。修法：派发账订阅 Node 的 `child_process` 诊断通道，派发期间建的每个子进程都进账；**真的跑起来了（有 pid）就算可能写出去**，只有连进程都没起来（CLI 没装，spawn 失败）才算没发出。同时即梦提交类子命令不再自动重跑（只有 `query_result` 可以），否则超时重跑本身就是第二笔。
- **其余不经 appFetch 的出网口**：`electron/offLedgerEgress.structure.test.ts` 逐个登记（异步子进程 = 进账；ws / 浏览器 session.fetch / 同步 spawn / 测试替身脚本 = 写明为什么不在付费派发里）；新加一个没登记、或登记了代码里已没有，就红。数门：`node scripts/door-map.mjs spawn execFile fork spawnSync execFileSync execSync WebSocket WebSocketServer utilityProcess`（门表已并进根因合同）。
- **矩阵补格**：CLI 子进程「跑起来后超时被杀 / 被杀 / 非零退出」→ 进对账、重试被拒、0 笔多发；「CLI 没装」→ 释放、可重试。变异：账本不看子进程 → 6 格红；把没起来的子进程也算进账 → 「CLI 没装」2 格红。
- **★4 补真 App 截图**：主文案「这次生成没有发出去，停在了这台电脑上」用真实的本机拦截场景走了一遍（回环供应商的自定义请求头里混进中文，请求头守卫在交给网络前拒），中英两轨，改对请求头后重试出图：`tests/ux/shots/claim-unsent-retry/{zh-CN,en}/03-stopped-on-this-computer.png`、`04-fixed-header-retry-succeeds.png`。
- **「见下方技术详情」**：分镜画面格的悬停说明末尾接上「技术详情：<这一次的原始原因>」，那句话在画面格里也成立。
