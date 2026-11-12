# 统计事件补细 + 删死事件（设计卡）

用户 2026-11-12：「现在没有丰富的上下文 每次很难定位问题」「核心是怎么构建数据收集 我们可以快速的发现问题 解决问题」；11-13 批准「全按推荐」（补细现有事件、不接第三方、设置页说明改成属实），并追加「不用告知了 已经开了 说明他愿意做数据反馈」——补字段不对已开启的人重新弹告知或确认。

底线不变：不上传提示词、文件名、素材、Key、邮箱、路径、错误原文；靠「键白名单 + 值闭合枚举 / 分档」保证。默认关，开了才发。

## ★0 先查别人（2026-11-13 复核网址）

1. VS Code 遥测 https://code.visualstudio.com/docs/configure/telemetry · 分 all / error / crash / off 四级；「Developer: Show Telemetry」实时看要发的事件，`code --telemetry` 导出本版**全部可能事件**的 JSON 表 · **确认了**「事件定义就是对外清单」：我们把设置页说明和事件定义写成一张能对账的表（★9 第 9 条），说明和实际对不上就红；**没借**分级（★2 不加开关）。
2. Zed 遥测 https://zed.dev/docs/telemetry · 崩溃（diagnostics）与用量（metrics）两个独立开关；崩溃报告**下次启动才发**；「Help > View Telemetry Log」让人审计发了什么 · **改了**「上次怎么退出」的做法：不在崩的那一刻发（那时进程可能已经没了），而是本机留一个退出标记、下次启动随 `app.started` 一起发；查看入口我们已有（设置页「查看待发 / 已发摘要」），不新增。
3. Sentry Electron https://docs.sentry.io/platforms/javascript/guides/electron/ · 「By default, the SDK sends user identity data (IP address, ID, and similar)」，还发 HTTP 体与 URL 参数，靠关键词黑名单替换 `[Filtered]` · **确认了**不接第三方：它的默认姿态与「不收身份、不收内容」相反，黑名单比我们的白名单弱一档；崩溃率这一格用自己的退出标记代替。
4. 仓库自己的先例：`docs/plan/2026-09-15-feedback-loop.md` 已比过 Sentry / PostHog / Aptabase / crashReporter，结论「传输自建」；这次没查到推翻它的新事实 · **确认了**接收端只存不判（`infra/feedback-worker/src/worker.mjs` 不校验键 → 新字段不需要部署接收端）。

出口：不涉及：本次不新增、不扩大、不挪动任何挡人的保护（统计校验拒收只丢一条事件，不挡创作者的任何操作）。

## ★1 目标 → 信号 → 指标

当我们发版后想知道「这版修好了没有、失败卡在哪一段、是我们拦的还是上游拒的、这版崩得多不多、后台卡不卡」，我想不必再向创作者要截图或派只读线去猜，以便当天定位、尽早修。

| 问题 | 字段（事件 · 取值集合） | 量具 |
|-|-|-|
| 这版修好了吗 | 所有事件 `systemProps.appPatch`（整数，补丁位） | `pnpm run intake:radar` 新读数「按补丁版本拆的生成失败率」 |
| 失败在哪一段 | `generation.completed.failureStage` ∈ submit / wait / fetch / land | 雷达失败类别排名（按阶段可切） |
| 各段多久 | `submitDuration`、`waitDuration` ∈ none / lt-1s / 1-5s / 5-30s / 30-120s / 2-10m / gt-10m | 同上 |
| 我们拦的还是上游拒的 | `upstreamStatus` ∈ ok / auth / rate-limit / client-4xx / server-5xx / network / timeout / not-sent / task-failed / unknown | 雷达新读数「失败里 unknown 占比」 |
| 本机拦了哪条 | `localRefusal`（只在 not-sent 时）∈ 7 个已是闭合码的本机拒绝 + `uncoded` | 同上 |
| 哪种方式 / 哪类模型 | `mode` ∈ text / image / firstLast / reference / other / none（复用 `modeDisplayKind` 的闭合集合）；`modelClass` ∈ builtin / custom / local（复用 `modelClassOfVendor`） | 同上 |
| 这版崩得多不多 | `app.started.lastExit` ∈ clean / main-exception / renderer-crashed / renderer-oom / renderer-killed / renderer-abnormal-exit / renderer-launch-failed / renderer-integrity-failure / renderer-memory-eviction / renderer-other / unresponsive-killed / abnormal / unknown | 雷达新读数「每版异常退出率」 |
| 后台卡不卡 | `perf.session.summary.mainStallMax` ∈ unknown / none / 100-250 / 250-1000 / 1000-5000 / gt-5000；`mainStallCount` ∈ unknown / 0 / 1-3 / 4-10 / gt-10（取 `stallMonitor` 已有的估计值） | 雷达新读数「主进程卡顿分档」 |

主指标（预测，发版后再量）：生成失败里 `errorType=unknown` 的占比 0.24 是 28%（`reports` 调查第 1 节），新版目标 <10%——这一刀先让「unknown」可以按 `upstreamStatus` 再拆一层；真正降多少，等新版本有 ≥200 条失败样本再量，**未验证：缺新版样本**。护栏：事件里出现任何自由文本 = 0（★9 第 1 条的测试是量具）。

真实任务：①0.24.1 视频失败率 88%——新字段能直接拆出「上游受理后报失败（task-failed）」和「取回失败（fetch）」各占多少；②发送前被拦——`not-sent` + `localRefusal`；③「生成时卡」——perf 汇总带主进程停顿档。

不做什么 / 已知坑：
- `failureStage` 的取回 / 落地两段只在主进程带了码（`retrieval-download` / `output-unreadable` 等）时分得出；渲染层只看得到「提交」与「等待（含取回、落地）」两段耗时，**取回 / 落地单独的耗时未采**（要新 IPC，违反 ★7）。
- `generation.completed` 只覆盖画布直生成（`taskApi.ts` 一扇门），制作流程 / Agent 付费卡的生成仍没有统计——补发送方是改行为，不在这一刀（留给协调）。
- 渲染层自己判的等待超时（`RecoverableTimeoutError`）从来不报事件，这一刀不改。
- `lastExit`：Windows 关机 / 注销时 `will-quit` 可能不触发，会记成 `abnormal`；开着统计的那次启动才开始记，关掉统计时删掉本机标记。

### ★1b 连带界面

只有设置页「隐私与诊断」一节的两句文字：`detail`（完整清单）改成和实际发的一致；`statusConfigured`（「只发白名单事件和脱敏后的工具轨迹」——轨迹从没发过）改成属实。中英两版，不加控件、不改布局。

### ★1c 老用户

- **告知范围版本**（`telemetryEvents.ts` 的 `TELEMETRY_SCOPE_VERSION` 与 `TELEMETRY_EVENT_MIN_SCOPE`，设置文件里的 `scopeVersion`）：机制是「事件名 → 至少要同意过哪一版」，入队时只比事件名，**不看字段**，所以结构上不要求加字段升档。新字段的归档：`generation.completed` 的阶段 / 状态类别 / 本机拒绝码 / 方式 / 模型类别 / 分段耗时 = 范围 1 的「耗时区间、成败、失败类别」；`app.started.lastExit` = 范围 1 的「成败」（应用这一次成没成功退出）；`appPatch` = 版本号，已在 1 里（原有 major.minor）；`perf.session.summary` 的主进程停顿 = 范围 2 的「流畅度分档数字」。都不新增类，`TELEMETRY_SCOPE_VERSION` 保持 2，已开启的人升级后**不弹任何东西**，新字段直接发（用户 11-13 原话）。没开启的人：什么都不发（`enqueueTelemetryEvent` 第一行的开关闸不变）。
- **旧队列**：本机待发队列里升级前入队的旧形状事件（缺 `appPatch`、带 `attemptCountBucket`、被删的两个事件名）读盘时过不了新校验，**直接丢**，不报错。量级：待发 ≤100 条、≤7 天，平时入队即发，通常是 0。真实旧数据回放：`tests/fixtures/old-user-data/telemetry/v0.24.1-outbox`（0.24.1 自己的同意写入 + 入队函数落盘）→ `telemetryOutbox.test.ts`「0.24.1 开着统计」一条。
- **旧版本发来的旧形状事件**：雷达照旧读（缺 `appPatch` 的记成 `x.y.?`，缺新字段的计入「没有这一格」），按补丁拆的读数只拿新版本的数。
- 被删的轨迹队列文件 `intake-queue-trajectories.json`：任何已发布版本都没写过它（见 ★3），不用迁。

## ★2 谁说了算

- 事件定义、白名单、闭合集合：`electron/telemetry/telemetryEvents.ts` 唯一一份（主进程校验）。
- 生成完成的发送口：`node scripts/door-map.mjs trackGenerationOutcome` → **1 扇门**（`src/workbench/api/taskApi.ts`，6 处调用：`runWorkbenchTaskByVendor` 同步终态 / 抛错、`submitCanvasShotRun` 同步终态 / 抛错、`pollCanvasShotRun` 异步终态、`fetchWorkbenchTaskResultByVendor` 异步终态）。画布单节点、画布批量（都经 `submitCanvasShotRun`）、附属付费口 / 接入测试（经 `runWorkbenchTaskByVendor`）是同一处；Agent 付费卡与制作流程没有发送口（见 ★1 已知坑）。字段推导收在新的 `src/workbench/api/generationTelemetry.ts` 一处纯函数，6 处调用只传「哪扇门、错误原文」。
- `modelClass` 由主进程算（`telemetryIpc.ts` 收到渲染层带来的 vendorKey，过 `modelClassOfVendor`），vendorKey 不进事件。
- 主进程停顿：`electron/diagnostics/stallMonitor.ts` 已有的估计值，加一个「上次取数以来的最大值 / 次数」内存计数，`telemetryIpc.ts` 收到 perf 汇总时补上。
- 上次退出：新模块 `electron/telemetry/sessionExit.ts`（本机标记文件 `telemetry-session-state.json`），`recordAppStarted` 启动它。
- 接收端 `infra/feedback-worker/src/worker.mjs`：**不校验键**（只存），新字段不需要部署；删掉死路由 `/v1/trajectories` 需要部署才在线上生效，不部署也不影响任何版本（没有发送方）。
- 雷达读取处：`scripts/lib/intake-radar/aggregate.mjs`（新四个读数）、`health.mjs`（删掉等 `agent.turn.completed` 的那几行）、`cloudflare.mjs` / `intake-radar.mjs`（删 `trajectories/` 前缀与计数）。

## ★3 一致与复用

以前定过：遥测「键白名单 + 值闭合枚举」（`telemetryEvents.ts` 头注释）；告知范围版本（2026-10 加 perf 时立的纪律）；传输自建（`2026-09-15-feedback-loop.md`）。都还算数。

三条路（调查报告第 5 节 A–G）：选 **A 补细现有事件，不加通道**。B（反馈多带三样）等出网守卫合入后下一刀；C 接 Sentry 违背默认不上报；D / G 是对没证据的问题买保险。

复用：失败类别 `classifyGenerationError`、本机码 `matchNomiErrorCode` + `NOMI_ERROR_ONLY_BEFORE_SUBMIT`、上游结构 `parseVendorErrorFromMessage`（状态码 / 类别）、方式 `modeDisplayKind`、模型三类 `modelClassOfVendor`、主进程停顿 `stallMonitor`。**本机拒绝码只用已是闭合枚举的 `NomiErrorCode` 里「只在提交前成立」的 7 个**（model-config、asset-too-large、asset-upload-failed、asset-invalid、reference-not-in-use、aspect-ratio-unsupported、outbound-blocked-credential-origin）；出网按地址判断那一层的码（outbound-blocked-submit）正在被整段删，不依赖它，落 `uncoded`；没有码的自由文本拒绝（如「图生图缺少参考图」）也落 `uncoded`。不在这一刀里造新码。

删掉（同提交删旧，不留并行版）：
- `feature.used`、`agent.turn.completed`：全仓没有发送方（`git grep`），类型、校验、范围表、测试、雷达 `health.mjs` 等它的行一起删。
- `attemptCountBucket`：写死 `'1'`（`taskApi.ts:174`），无信息。
- 轨迹通道：`IntakeQueueKind` 的 `trajectories`、`IntakeRoute` 的 `/v1/trajectories`、接收端路由、雷达 `trajectoriesCount` 与 `trajectories/` 前缀。依据：逐个 tag（v0.12.0…v0.24.1）`git grep` 非测试代码，`trajectories` 只出现在类型声明里，`enqueueIntake` / `submitIntake` 的唯一调用方一直是 `'feedback'`；轨迹现在只作反馈附件（`feedbackReport.ts` 的 `projectLaneTrajectory`），那一份不动。

## ★4 全状态

- 统计关：什么都不发、不记退出标记（启动时删掉旧标记）。
- 统计开、未配置上报地址（开发版）：照旧只留本机。
- 生成成功：`upstreamStatus=ok`，无失败三格。失败：带失败三格（`localRefusal` 只在 not-sent 时有）。取消：不带 `upstreamStatus` 与失败格（现在没有发送方发 cancel）。
- 认不出的值：一律落闭合集合里的兜底值（`unknown` / `uncoded` / `other` / `none`），不出门任何自由文本。
- 能力不可用：主进程停顿监视器没装（MCP 子进程）→ `mainStallMax=unknown`。
- 界面：只有设置页两句文字，中英两版，长度与原句同量级，不改布局。

## 5 中途表

门岗按路径（`taskApi.ts`、`intakeQueue.ts`）把这次判成「长跑」类。本次没有新增、也没有改动任何长跑任务本身：生成的提交 / 轮询 / 取消、反馈队列的发送与重试逻辑一行没动，只在生成结局处多一次原有的异步 `telemetry.track`，并删掉了从没被调用的轨迹队列类别。

| 状态 | 停 / 取消 | 关窗 | 断网 | 重启 | 连点 |
|-|-|-|-|-|-|
| 生成进行中 | 照旧；取消不发事件（现在本来就没有取消的发送方）· 花费不变 · 无新回执 | 照旧；退出标记记成 clean（will-quit 走到了）· 花费不变 | 照旧；结局事件进本机待发队列，联网后随下一次发送出去 · 花费不变 | 进程被强退 → 下次启动 `lastExit=abnormal` · 花费不变 | 每次结局各一条事件，不合并 · 花费不变 |
| 统计事件待发 | 关掉统计 → 队列删光，标记删掉 | 待发留在本机（≤100 条、≤7 天） | 照旧留本机，不重试风暴（沿用原发件箱） | 旧形状的待发读盘即丢，新形状照发 | 不涉及 |

## 6 外部数据与失败

- 上游错误原文：只用来分类，**不出门**；分不出就落兜底值（unknown / uncoded / task-failed）。规范：供应商结构化失败走 `shared/vendorFailure` 已有解析（HTTP 状态码 + 查表类别），我们的偏差：状态码优先于类别，401/403 都算 auth。失败时用户看到的不变（错误卡不动）。
- 本机退出标记：坏 JSON / 认不出的值 → `unknown`，不抛；不是外部数据，但按外部数据对待。
- Electron `render-process-gone` 的 `reason`：官方文档列出的值逐个映射，文档以后新增的值 → `renderer-other`（https://www.electronjs.org/docs/latest/api/structures/render-process-gone-details）。
- 接收端：只存不判，新字段不需要部署。

## 8 真实条件

- 英文界面：设置页说明中英 × 浅暗四张截图，自己看过，布局不变。
- 真规模：不适用——每次生成只多常数次内存读（★7）。
- 干净安装 / 老用户：0.24.1 自己的函数落的统计设置与待发队列（`tests/fixtures/old-user-data/telemetry/v0.24.1-outbox`）升级回放过。
- Windows：`unverified`（`will-quit` 在 Windows 关机 / 注销时可能不触发，会记成 abnormal，★1 已知坑）。
- 真付费：不适用——不碰花钱路径，不调用上游；假上游 401 / 500 / 连接超时三例见 ★9。
- 键盘全程：不适用——没有新增可操作元素。

拍板图清单：不适用——只改设置页已有一段说明文字（中英），不加元素、不改布局。

## ★7 性能

新增的操作：无（没有新的用户操作）。每次生成多做的事：渲染层读已有内存值（请求里的 extras、archetype 注册表）+ 两次时间戳相减 + 一次错误原文的正则 / base64 解码（错误分类本来就做）；主进程算 `modelClass` 是查内置种子表（内存）。**不为统计新增读盘、不新增同步 IPC**（沿用原来那一次异步 `telemetry.track`）。断言：`generationTelemetry.test.ts` 用假 bridge 数调用——一次生成只调一次 `track`，推导函数不触发任何 bridge 调用。启动时退出标记读一次、写一次（启动期，不在生成路径）。perf 场景：不适用——没有新增交互，生成路径只多常数次内存读。

## ★9 验收清单与反例（动手前写全）

| # | 检查 | 反例（改坏 → 应红） |
|-|-|-|
| 1 | 每个新字段只能是声明的枚举 / 分档 | 每个字段塞一段错误原文 / 一个路径 → 校验拒、事件不入队（每字段一条） |
| 2 | 新增键不在白名单 → 拒 | 把 `hasExactKeys` 放宽成通配 → 测试红 |
| 3 | 完整版本号在所有事件上 | 构造信封时去掉 `appPatch` → 红 |
| 4 | 生成完成的每个发送口都带齐新字段（6 处调用逐个测） | 让其中一处少传 → 红 |
| 5 | 四个失败阶段 × 上游状态类别各造一例落到正确枚举 | 映射写错 → 红 |
| 6 | 上次退出：渲染进程死亡、主进程未清标记退出、正常退出三种，下次启动各自正确 | 删掉 will-quit 写 clean → 红 |
| 7 | 被删两个事件名、`attemptCountBucket`、轨迹队列类别：全仓 `git grep` 无残留（文档历史除外）；旧队列里带这些名字的条目被丢弃不报错 | 旧队列夹具读盘 → 只剩合法条目 |
| 8 | 已开启的老设置文件（scopeVersion 2 / 缺 scopeVersion 两种旧形状）升级后不弹确认、新字段照发；没开启的什么都不发 | 把 TELEMETRY_SCOPE_VERSION 升到 3 → 红 |
| 9 | 设置页说明列的每一类都能在事件定义里找到对应事件，反之亦然 | 删说明里一类 / 加一个事件不进说明 → 红 |

另：假上游回 401、回 500、连接超时各一次，贴最终入队的事件 JSON，里面不许出现任何自由文本。

### ★9 结果（2026-11-13 回填）

九条全过。反例逐个改坏 → 跑对应测试 → 还原，15 个反例全部变红（第 7 条另加一个：发件箱读盘不再按新校验过滤 → 手写旧形状与 0.24.1 真实旧队列两条测试都红）：

| # | 反例 | 结果 |
|-|-|-|
| 1 | `failureStage` / `lastExit` / `mainStallMax` / `localRefusal` / `mode` 各自去掉闭合集合校验（5 个） | 各红 1 条（`telemetryEvents.test.ts` 逐字段塞错误原文 / 路径） |
| 2 | `hasExactKeys` 放宽成恒真 | 红 6 条 |
| 3 | 构造信封去掉 `appPatch` | 红 6 条 |
| 4 | `pollCanvasShotRun` 不发 | 红 1 条（`generationTelemetry.test.ts` 6 处发送口逐个测） |
| 5 | 5xx 映射成 client-4xx | 红 4 条 |
| 6 | 删掉 will-quit 写 clean | 红 3 条 |
| 7 | 信封校验不再要求 `appPatch`（旧队列的旧形状不该再被收） | 红 7 条；`git grep` 被删名字只剩旧数据夹具、反向断言和历史说明 |
| 8 | `TELEMETRY_SCOPE_VERSION` 升到 3 | 红 4 条 |
| 9 | 说明删掉「卡在哪一段」/ 加一个事件不进说明（2 个） | 各红 1 条（`telemetryClaims.test.ts`） |

假上游三例（走真实发送口 `runWorkbenchTaskByVendor` → 主进程 `withMainProcessFacts` → `buildTelemetryEnvelope`，错误原文里故意带密钥、路径、地址、IP、提示词）：

```
401     → props {capability:video, durationBucket:<1s, result:failure, mode:text, submitDuration:lt-1s, waitDuration:none, upstreamStatus:auth,       errorType:auth,    failureStage:submit, modelClass:custom}
500     → props {…同上…, upstreamStatus:server-5xx, errorType:server,  failureStage:submit, modelClass:custom}
连接超时 → props {…同上…, upstreamStatus:network,    errorType:network, failureStage:submit, modelClass:custom}
systemProps 三例相同：{locale:zh-CN, osFamily:macos, appMajor:0, appMinor:25, appPatch:1}
```

整份 JSON 里搜不到密钥、路径、地址、IP、`ETIMEDOUT`、提示词。连接超时第一次跑出来是 `upstreamStatus=unknown`（没码没结构就落「说不清」），而分类器其实已从原文认出是网络类——补了一条：没码没结构、分类器判 `network` → `upstreamStatus=network`，测试已加。

实现中的两处补充：
- 分类器判成 `local-refusal` 但没有 Nomi 码的主进程结构化拒发（同节点在途、预演没好等）→ `not-sent` + `uncoded`（这些码还不是闭合表）。
- 同意走查 `tests/ux/telemetry-consent.walk.mjs` 的假生成事件改成新形状（带 vendorKey，由主进程补 modelClass）。Agent 面板同意卡里「用了哪些功能」一句没改（不在本次范围，留给协调）。

回滚：revert 这一个提交；接收端不需要部署，雷达读旧形状照旧。
