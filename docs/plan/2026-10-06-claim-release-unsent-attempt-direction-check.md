# 方向检查：付费提交「发没发出去」与镜头认领（L-claim）

触发：`electron/productionRun/productionGenerationSubmission.ts` 14 天内 9 个 fix、`src/workbench/observability/classifyError.ts` 14 个、`electron/capabilityCore/apimartGenerationProvider.ts` 5 个、`submissionOutbox.ts` / `outboundDispatchEvidence.ts` 各 3 个（`fix-churn` 热点）。设计卡：`docs/plan/2026-10-06-claim-release-unsent-attempt.md`。

### 0. 一句话根因

「这次付费尝试有没有离开本机」一直是从**最后抛出来的那个错误**的形状里猜的，而唯一能确定回答它的地方——网络出口 `appFetch`——从来没被问过；于是每多一种失败形状（连接复用、超时、明确拒绝、本机拦截）就要在提交出口补一条判据。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| c42ffefb8 付费提交连上后不许盲重发 | `UND_ERR_SOCKET` 被当成「没写出去」，自动重发双扣 | 从错误形状猜发没发 |
| bc75e26af 付费提交要有响应超时、超时算结果未知 | 超时错误的归类缺失 | 同上 |
| 0377b6042 明确拒绝算没受理 | 4xx 被一律当成结果未知，镜头冻住 | 同上（第三档靠错误上的 providerAnswer） |
| 本次 V-1042 #22 | 本机拦截没有连接证据 → 结果未知 → 认领拒成 needs_reconcile | 同上（第四种形状） |
| 0de7e0e03 / 904d2ca37 认领缺口 | 认领判定口各条路径不一致 | 认领判定分支顺序（本次又一处：受理前结束的单镜卡在 awaiting_confirmation） |
| 12c9843ca / cb2cced31 / 857ca3453 … | 渲染层按文案猜失败类别 | 分类器靠文案（与本类相邻，本次用结构化码 `submission_not_sent` 避开） |

### 2. 为什么这一类会一直出现

证据住错了层。错误对象穿过 runTask、目录执行器、自定义脚本、IPC 好几层，每层都可能包一层、丢一层 cause、换一种形状；在最外层「看形状」注定每来一种新形状就补一刀。真正的事实（有没有请求交给网络、交出去的是不是在连上之前就失败）只在网络出口那一刻是确定的。

铁律对照：⑫「点了 = 以为的」——用户点「重试」以为会重试，实际被拒成「先去核对」；本次以矩阵（每个入口 × 每种失败的「点了重试会怎样」）为类检查。⑩ ⑪ 不适用（不涉及参数抽取 / 可选项）。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 新加一道本机检查（比如素材体积前置检查）会再把镜头冻进对账 | 在 `requestVendor` 里 fetch 之前抛任意 Error，跑矩阵「画布节点」列：旧代码红，本次代码绿 |
| 自定义调用脚本「先发一笔、第二步被拦」会被判成没发出，用户重试 = 双扣 | 矩阵「先发出一笔、再在本机被拦」格（变异 2 时红） |
| 引擎 B 的密钥含中文字符 → fetch 当场抛 ByteString 错 → 结果未知 | 矩阵 Agent 付费卡「请求头不合法」格（本次给引擎 B 补了同一个请求头守卫） |

### 4. 靶子独立性检查

- 矩阵由实现线写，判据是「供应商回环一共收到几笔 + job 状态 + 认领判定」，不是实现线自己的中间量；独立验收线要复跑两次变异（见 PR）。
- 走查闸（`scripts/walkthrough-network-guard.cjs`）以前在 fetch 层抛一个不带 cause 的 `TypeError`，真实网络里不存在这种形状——靶子本身有错。本次改成和真实 undici 拒连同形（cause 在 connect 阶段），并加了闸自己的测试。

### 5. P0：这些是我们独有的吗

「付费尝试有没有离开本机、这一镜归谁」是按镜头的花钱语义，领域内。上下文传递用 Node 内置 `AsyncLocalStorage`（现成）；不自写 HTTP、不自写代理。

命中自写登记 **`network-stack`**（under-review，复查 2026-11-30）：本次只在 `electron/appFetch.ts` 里加了一行把请求交给
`outboundDispatchEvidence.handOffToNetwork`，判据与账本都住在 `outboundDispatchEvidence.ts`（花钱语义那一侧），没有往代理 / SOCKS /
dispatcher 那一半加任何东西。为什么现在不换成现成方案：登记里待替换的是代理 / SOCKS / 系统代理探测那一半（undici ProxyAgent、
socks-proxy-agent、Electron session.setProxy），它们回答的是「怎么出去」；本次回答的是「这一次派发有没有请求交给网络」，现成库没有这个概念，
换掉代理实现也不影响它——`appFetch` 作为唯一出口的位置不变，账本跟着出口走。哪天换：按登记的 2026-11-30 复查把代理那一半接到现成库时，
`handOffToNetwork` 原样留在新的出口函数里，矩阵与 `outboundDispatchEvidence.test.ts` 是回归。

### 6. 接入 / 补 / 重写 / 删

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | undici dispatcher 级 `onConnect` 见证（连接建立前出错 = 没写出去） | 要包一层 dispatcher 并跟 undici 处理器 API 走 | undici 升级改处理器接口时会静默失效（判成没发出 = 双扣方向） | 否（作为代理 CONNECT 拒绝那一格的后续候选） |
| 补 | 在每个本机拒绝点挂一个「没发出」标记 | 小 | 每多一种本机检查就要记得挂；漏挂只是多对账，但同类继续冒 | 否 |
| 重写（限一个模块） | 判据从「一个错误」扩到「一次派发」：出口记账、提交出口问账本；认领判定口加「受理前确定结束 → 归画布」 | 中（7 个生产文件，判据仍一个 owner） | 声明了 app-fetch 的传输若绕过 appFetch 会误判（只有两台生产传输声明，`check:network-entry` 守） | **是** |
| 删 | — | — | — | — |

### 7. 用户要权衡的核心

「没法证明没发出」的尝试宁可让你多核对一次，也不冒重复扣费的险；本次只是把**能证明**的那一大类（在本机就被拦下的）从对账里放出来。

## 特征测试清单

- `electron/productionRun/submissionNotDispatched.test.ts`、`electron/capabilityCore/apimartFreshConnection.test.ts`、`electron/providerExplicitRejection.test.ts`、`electron/productionRun/doubleChargeMap.e2e.test.ts`、`electron/shared/productionShotPhase.test.ts`、`electron/productionRun/multiShotBatchScheduler.e2e.test.ts`：改动前后都绿（原有三档语义未变）。
- 新增类检查：`electron/productionRun/unsentAttemptClaim.matrix.test.ts`、`electron/outboundDispatchEvidence.test.ts`（`observeSubmissionHandoffs` 一组）。

## V-1047 补记

独立验收找到同一类的又一种形状：子进程（即梦 / Antigravity CLI）自己出网，派发账看不见。这正是 §2 说的「证据住错了层」——
所以修法不是在 CLI 那一处补一刀，而是让派发账在**进程创建**这一层也有一个不需要各处记得的入口（Node `child_process` 诊断通道），
再用结构测试把剩下所有不经 appFetch 的出网口逼成「要么进账、要么写明不在付费派发里」。
