# 2026-10-07 self-written under-review 六条事实

## 范围与方法

- 只读 `main` 当前源码、`docs/engineering/self-written.json`、GitHub commits API。
- 时间窗：2026-09-07T00:00:00Z–2026-10-07T23:59:59Z。Git log 统计按 GitHub REST `commits?path=...&since=&until=`；gate-family 的 `scripts/check-*.mjs` 是通配目录，不能用单路径 API 精确汇总，单独标明口径。
- “漏登扫描”= 当前登记 `paths` 与源码检索/入口检索的静态结果；不宣称运行了门岗或完整构建。

## 1. validation-policy

登记：`self-written.json:L463-L479`，status=`under-review`、reviewBy=2026-11-15，登记路径 `scripts/validation-policy.mjs`、`scripts/select-quality-gate-profile.mjs`、`scripts/test-focused.mjs`。登记表已有 alternatives：dorny/paths-filter、Nx affected、以及本仓结构评审。

当前实现事实：
- `validation-policy.mjs:L20-L41` 声明 full 与 validation-infrastructure 两个完整策略；`L43-L77` 是 infrastructure/docs/recognized/package 路径模式。
- `L99-L180` 定义 journey/desktop/canvas/full-canvas/performance 模式；`L200-L218` 通过 `raiseCanvas` 单调升档和 `failClosed` 统一失败输出。
- `L221-L255` 对 full/workflow_dispatch/空 diff/删除重命名/未识别路径 fail-closed；`L257-L327` 按文件把 unit/desktop/journeys/canvas/performance/package 逐项抬高；输出字段在 `L330-L340`。
- `select-quality-gate-profile.mjs:L5-L17` 从 Git `--name-status -z` 取 diff 并调用唯一分类器；`L19-L45` 将结果写 GitHub output，异常也落 full fail-closed。
- `test-focused.mjs:L9-L18` 取 `git diff -z`；`L20-L67` 识别 sibling tests；`L69-L85` 构造 Vitest/Node focused 命令；`L101-L121` 执行并失败即抛。

漏登/调用点扫描：`classifyValidationPolicy` 命中实现、profile selector、`git-delivery.mjs`、测试与审计/合同；`VALIDATION_POLICY_OUTPUTS` 只有实现+selector；`CORE_SMOKE_BLOCKING_FIXTURES` 命中实现、CI annotation hygiene、workflow、node tests。路径登记覆盖 3 个源码文件；未见同名未登记 `src/`/`electron/` 生产文件。

现成方案（版本/许可证/官方出处）：
- `dorny/paths-filter@v3`，MIT；官方仓库/用法：https://github.com/dorny/paths-filter 。能按 glob 输出 changed-path lane，但不提供本仓的删除/重命名 fail-closed、canvas critical/full monotone、concept-owner 对账。
- Nx `affected` v23（Nx 官方 23 是 current major；MIT）；官方命令：https://nx.dev/docs/reference/nx-commands ，发布策略：https://nx.dev/docs/reference/releases 。依赖图影响分析可替路径正则，但 Nomi 的验证维度是产品概念表，不是 Nx project graph。
- 登记表原 alternatives 已核对；未在 Nomi package.json 安装 dorny/Nx，版本是候选方案版本而非锁定依赖。

近30天 path log：20 次（`scripts/validation-policy.mjs`）。主要标题/证据：
- `c3f10e124d` 2026-10-05 “quickActions 归入全量画布验收”；
- `04d6bf1ae2` 2026-10-02 “门岗清理…check:site…ledger 移出 Contracts”；
- `468c695a1b` 2026-10-01 “画布显示主人改动触发 full 画布验收”；
- `9da06f0ac6` 2026-09-22 “used 夹具降为非阻断”；
- `ddf347a21b` 2026-09-22 “three defenses—always-on core flow smoke”；
- `9694f555cd` 2026-09-22 “canvas lane monotone”；
- `d65571cdbe` 2026-09-17 “Agent 分镜只认 Run 账本”；
- `74d55d262d` 2026-09-11 “gates 按风险分档”。完整 API 列表可由 `commits?path=scripts/validation-policy.mjs` 重放。

替换工作量/风险依据：最薄替代只动 selector 的 1 个调用点 + workflow 输入，但仍需保留 `classifyValidationPolicy` 的 3 个输出消费者、`CORE_SMOKE_*` 的 workflow/annotation/test 关系，以及 2 个门岗测试文件；若迁 Nx affected，需新建 project graph、概念→项目映射和 fail-closed adapter。风险高于普通 path filter，低于重写全门岗族；登记表当前结论未定，报告不做替换建议。

源码链接：
- https://github.com/aqm857886159/Nomi/blob/main/scripts/validation-policy.mjs#L221-L340
- https://github.com/aqm857886159/Nomi/blob/main/scripts/select-quality-gate-profile.mjs#L5-L45
- https://github.com/aqm857886159/Nomi/blob/main/scripts/test-focused.mjs#L9-L121

## 2. network-stack

登记：`self-written.json:L516-L539`，under-review、reviewBy=2026-11-30；10 个路径 `proxySettings/systemProxy/socksDispatcher/proxyIpc/proxyProbe/hardenedFetch/appFetch/networkHostPolicy/networkOutboundPolicy/providerNetwork`。

当前实现事实：
- `proxySettings.ts:L15-L43` 定义 system/custom/off 三档并净化；`L49-L61` 原子读写偏好。
- `systemProxy.ts:L1-L21` 说明 app-owned route；`L27-L43` 定义 none/http/socks/unsupported；`L68-L105` 维护 active dispatcher，私网 bypass；`L107-L127` 等待最新 route generation。
- `socksDispatcher.ts:L1-L11` 记录为何未直接接 undici Socks5ProxyAgent：项目 pin 的 undici 6.19.8，而内置 Socks5ProxyAgent 从 undici 7.25.0 起；`L12-L40` 解析 socks URL；`L43-L79` 先 SOCKS 隧道、TLS 交给 undici connector。
- `proxyIpc.ts:L16-L21` 启动加载；`L23-L55` get/set/test IPC，trusted sender、即时重装、线路变更后重探。
- `hardenedFetch.ts:L1-L11` 定义 SSRF/DoS/阻塞/假 content 风险；`L32-L78` timeout/idle/maxBytes/content-type/private origin/streaming contract；`L113-L133` 结构化拒绝；`L136-L160` DNS-pinned dispatcher。
- `appFetch.ts:L11-L29` 是唯一 Node HTTP entry，注入当前 dispatcher、credential redirect policy、outbound evidence；不自带 body/retry/timeout。
- `networkHostPolicy.ts:L16-L36` 统一私网/loopback/metadata/fake-ip 地址分类，无 env escape hatch。
- `networkOutboundPolicy.ts:L1-L23` 是提交与取回共用的唯一 owner；`L34-L55` fake-ip 阳性探针与无 env 逃生口；`L63-L81` benchmarking/refusal codes；`L118-L205` 一次探测并缓存，提交/取回读同一事实。
- `providerNetwork.ts:L5-L21` provider-specific proxy route。

漏登/调用点扫描：`getAppDispatcher` 命中 systemProxy/appFetch/proxyIpc/hardenedFetch/comfyui socket 及测试；`authorizeOutboundDestination` 命中 networkOutboundPolicy/hardenedFetch/vendorOutboundGuard/测试；`appFetch` 生产引用超过 20 个（catalog/probe/vendor/MCP/local runtime/assets 等，搜索结果上限 100）；`providerDispatcher` 命中 providerNetwork/providerMediaFetch/vendorHttp/测试。10 个登记路径覆盖上述模块，未见同功能的新未登记 `electron/` 文件。

现成方案（版本/许可证/官方出处）：
- undici `6.19.8`（Nomi package.json pin），MIT；官方 ProxyAgent 文档：https://undici.nodejs.org/#/docs/api/ProxyAgent 。可替 HTTP route，但不能替 Nomi 的 fake-ip/私网策略与提交/取回同一 owner。
- `socks` `2.8.9`（Nomi pin），MIT；npm 官方页：https://www.npmjs.com/package/socks 。只提供 SOCKS protocol/client，不能替 dispatch/SSRF policy。
- Electron `43.4.1`（Nomi pin），MIT；`session.setProxy` 官方文档：https://www.electronjs.org/docs/latest/api/session#sessetproxyconfig 。只覆盖 Chromium session proxy，不覆盖 Node vendor/appFetch route。
- 登记表已列 undici ProxyAgent、socks-proxy-agent、Electron setProxy；`socks-proxy-agent` 未安装，且当前 source 注释给出 undici 版本不兼容理由。

近30天 path log（按登记路径逐文件）：
- proxySettings 1：`c93863f1be` 2026-09-21 “never write a default over config unreadable”。
- systemProxy 1：`c42ffefb89` 2026-10-02 “paid submissions never blind-resend after connection reached”。
- socksDispatcher/proxyIpc/proxyProbe/providerNetwork/networkHostPolicy：各 0。
- hardenedFetch 4：`3824c2c35d` 09-29 refused responses release connection；`e61cdbcc8d` 09-17 local speech sidecar；`8e0c22d760` 09-07 video-depth weights；`ebe40bb562` 09-07 submit/retrieval same outbound owner。
- appFetch 2：`1e5628bb6e` 10-06 unsent paid attempts release claim；`fbdf4cbdd9` 10-02 credential redirect owner。
- networkOutboundPolicy 4：`a114092f11`/`2f29c7c3d6` outbound wording; `52a4dae84a` tests/gates; `ebe40bb562` owner unification.
- 合并去重后：至少 11 个 distinct path-touch commits；API lists each exact path count above。

替换工作量/风险依据：dispatcher 层约 4 个直接 route/IPC 接口（applySystemProxy/getAppDispatcher/probe/providerDispatcher）与 3 个测试族；若换 `undici ProxyAgent`/`socks-proxy-agent`，需保留 `systemProxy` committed route、private bypass、`networkOutboundPolicy.authorizeOutboundDestination`、hardenedFetch 的 pinned DNS/structured refusal。真正风险在 policy callsites（vendor submit + retrieval + assets/providers），不是 SOCKS connector；替换 dispatcher 可中等，替换 policy 高风险。

源码链接：
- https://github.com/aqm857886159/Nomi/blob/main/electron/systemProxy.ts#L1-L105
- https://github.com/aqm857886159/Nomi/blob/main/electron/socksDispatcher.ts#L1-L79
- https://github.com/aqm857886159/Nomi/blob/main/electron/proxyIpc.ts#L16-L55
- https://github.com/aqm857886159/Nomi/blob/main/electron/hardenedFetch.ts#L1-L160
- https://github.com/aqm857886159/Nomi/blob/main/electron/appFetch.ts#L11-L29
- https://github.com/aqm857886159/Nomi/blob/main/electron/networkOutboundPolicy.ts#L1-L205

## 3. durable-json

登记：`self-written.json:L541-L555`，under-review、reviewBy=2026-11-30；paths `electron/jsonFile.ts`, `electron/durability.ts`。

当前实现事实：
- `jsonFile.ts:L7-L19` temp-in-same-dir → fsync → rename，保证旧完整文件/新完整文件二选一；`L26-L58` Windows EPERM/EBUSY/EACCES 退避重试；`L64-L105` mkdir/open/write JSON/fsync/close/rename，失败清理 temp；`L107-L109` JSON parse read。
- `durability.ts:L1-L31` 说明 durable/ephemeral 的语义、生产默认 durable、测试唯一入口；`L34-L63` mode API 与唯一 `fsyncIfDurable`; `L65-L93` 唯一 directory-fsync 实现及 Windows unsupported error handling。

漏登/调用点扫描：`writeJsonFileAtomic` 被生产 run repository、conversations IPC、proposal receipt store、config/workspace stores 等多处调用；`fsyncIfDurable`/`fsyncDirectoryIfDurable` 只从 durability + callers 进入。源码注释称目录 fsync 历史曾 6 份副本，2026-09-08 已收口；未见另一个新 JSON atomic writer被登记。

现成方案：
- `write-file-atomic` 8.0.0，ISC；官方 npm：https://www.npmjs.com/package/write-file-atomic 。提供 temp+rename、fsync 选项，但不提供本仓 Windows retry/目录 barrier 语义。
- `atomically` 2.1.1，许可证需在采用前核对；官方页：https://www.npmjs.com/package/atomically 。声明是 write-file-atomic rewrite，带 retry/fsyncWait，适合比较，但不应把当前页面未核实的 license 当成已批准事实。
- pi `publishFileAtomically`/FileSystem.renameFile，pi package 0.85.1、MIT（Nomi package pin）；仅 lane injected FS 语义，不能替全 Electron durability mode。

近30天 path log：
- jsonFile 1：`9e2466e882` 2026-09-24 “Windows sync-disk/antivirus file lock prevents save deadlock”。
- durability 1：`a7f1559c10` 2026-09-08 “directory fsync converge to durability.fsyncDirectoryIfDurable”。
- 2 path-touch commits total; titles above。

替换工作量/风险依据：`writeJsonFileAtomic` 是多域共享函数，至少 run/conversations/proposal/config/workspace callers；interface 是 `(filePath,value,{mode?})`, and directory barrier is a separate exported function. Replacing only temp+rename is low/medium; preserving fsync mode, directory-fsync unsupported handling, Windows retry, file mode 0600 and error cleanup is required. Data corruption risk high, test/runtime code volume low.

源码链接：
- https://github.com/aqm857886159/Nomi/blob/main/electron/jsonFile.ts#L7-L109
- https://github.com/aqm857886159/Nomi/blob/main/electron/durability.ts#L1-L93

## 4. logging-and-crash

登记：`self-written.json:L557-L570`，under-review、reviewBy=2026-11-30；paths `electron/logging/`, `electron/crashLog.ts`。

当前实现事实：
- `logging/logger.ts:L1-L17` says unique main logger sink, 99 old console sites, shared `logFiles`; `L31-L73` closes LogScope/LogFields/levels; `L75-L94` closes VendorCallSummary to six safe fields; `L96-L110` daily sink/size/retention; `L138-L175` stderr diagnostic surface + same redacted line to disk/stderr; `L178-L223` logInfo/Warn/Error/logVendorCall; `L230-L248` session-start install.
- `crashLog.ts:L1-L25` defines three evidence layers (uncaught JS, process-gone, Crashpad); `L26-L52` dedicated 2MB truncate crash sink and shared redaction; `L54-L63` synchronous breadcrumbs; `L78-L104` render/child process gone; `L106-L119` Crashpad local-only (`uploadToServer:false`); `L130-L138` uncaughtExceptionMonitor; `L140-L169` narrow upstream stream teardown detector; `L177-L210` noise filter only suppresses known upstream modal while preserving default behavior.

漏登/调用点扫描：`logInfo/logWarn/logError/logVendorCall` are used across main/vendor/agent/production/export/proxy; `crashLog` is sole process-gone/Crashpad surface; shared `logFiles.ts` is unique file writer per logger and crash. No extra logger file found outside registered `electron/logging/` + crashLog path.

现成方案：
- `electron-log` 5.4.4, MIT；official npm: https://www.npmjs.com/package/electron-log . Covers Electron/Node file rotation, but not Nomi closed fields/redaction/privacy contract or Crashpad handling.
- Electron `crashReporter` in Electron 43.4.1, MIT/Electron official API: https://www.electronjs.org/docs/latest/api/crash-reporter . Covers minidump capture, but not Nomi synchronous redacted breadcrumbs/process-gone structured log.
- Optional Pino/Winston are generic logging libraries; not in Nomi package, so no current pin/evidence of fit. The registered alternatives above are the checked pair.

近30天 path log (unique commits 4):
- logger 3 path hits: `ebb5e8aefd` 09-24 “renderer failure evidence into main log”; `e61cdbcc8d` 09-17 local speech sidecar; `8e0c22d760` 09-07 video-depth weights.
- crashLog 2 path hits: `ebb5e8aefd` 09-24 same renderer evidence; `e69a1cc3ce` 09-10 renderer-crash channel sender guard.
- combined distinct commits = 4.

替换工作量/风险依据：logger API has 4 public writers + closed `LogScope`, `LogFields`, `VendorCallSummary`; every production caller must preserve redaction and field restrictions. crash API has `logCrash/logBreadcrumb/installProcessGoneHandlers/startNativeCrashCapture/installCrashHandlers/installUncaughtExceptionNoiseFilter`; direct replacement with electron-log leaves Crashpad/noise semantics to reimplement. File sink swap medium; replacing privacy/redaction contract high risk; callsite count high.

源码链接：
- https://github.com/aqm857886159/Nomi/blob/main/electron/logging/logger.ts#L1-L249
- https://github.com/aqm857886159/Nomi/blob/main/electron/crashLog.ts#L1-L210

## 5. gate-family

登记：`self-written.json:L573-L589`, under-review, reviewBy=2026-10-31; paths `scripts/check-*.mjs`, `scripts/run-gates-contracts.mjs`.

当前实现事实/漏登扫描：
- `package.json` currently declares **103** `check:*` scripts (read-only package scan). The registry says “100+” and wildcard scope is intentionally broader than GitHub code search.
- `run-gates-contracts.mjs:L1-L36` defines all-run/no-early-exit and advisory semantics; `L50-L72` closes advisory fill authority; `L75-L110` rejects unknown/duplicate/orphan gate names and verifies package script existence; `L122-L191` runs every gate, aggregates failures, returns nonzero for blocking failures; `L194-L236` spawns `pnpm run` and fail-closes signal termination.
- `check-self-written.mjs:L1-L7` declares added `src/`/`electron/` files must be domainRoots/registered; `L46-L68` computes base/diff/registry; `L70-L77` emits warnings/errors and blocks after `enforceFrom`.
- `check-prior-art.mjs:L1-L17` defines plan/PR prior-art rules; its owner is `scripts/prior-art-lib.mjs`.
- `check-root-cause-contracts.mjs:L136-L167` loads/validates door table and can fill missing doors; `L178-L202` classifies warnings vs blocking schema errors.
- Package scan found 103 named `check:*` entries. GitHub search found 51 `scripts/check-*.mjs/ts` files (search index may omit files); no unregistered gate-family file can be proven from this static index alone. Treat wildcard leak scan as bounded, not exhaustive.

现成方案：
- `eslint-plugin-boundaries` 7.2.0, MIT；official npm https://www.npmjs.com/package/eslint-plugin-boundaries . It enforces import architecture only, not custom registries/contracts/ratches.
- `dependency-cruiser` 18.2.0 (Nomi pin), MIT; official npm https://www.npmjs.com/package/dependency-cruiser . It can provide dependency graph/rules, not domain contract/ledger semantics (Nomi already uses it in check-boundaries).
- `knip` 6.39.0, ISC; official npm https://www.npmjs.com/package/knip . It finds unused files/exports/dependencies, not Nomi's gate judgments.

近30天 git log：
- `run-gates-contracts.mjs` path count 3: `76cf481b9d` 10-05 “37 unregistered contract boundaries frozen + advisory fill health”; `04d6bf1ae2` 10-02 “gate cleanup”; `3bf56a2bd4` 10-01 “gate slimming by ledger”.
- `scripts/check-*.mjs` wildcard cannot be exact via one API path; package-level check script count is 103. Keyword search `gates:` returned 95 recent commits, but that is not a path count and should not be presented as one.

替换工作量/风险依据：No single interface: package scripts are 103 command names; gate-family includes shell/Node scripts, workflows, tests, baselines, docs ledgers and root-cause contracts. Replacing all with ESLint/dependency-cruiser/Knip would not cover domain predicates. A realistic removal requires per-gate inventory + user decisions (retain/merge/downgrade/delete) and workflow/package/test updates. Risk high; current status explicitly defers conclusion until gate ledger/user decision.

源码链接：
- https://github.com/aqm857886159/Nomi/blob/main/scripts/run-gates-contracts.mjs#L1-L236
- https://github.com/aqm857886159/Nomi/blob/main/scripts/check-self-written.mjs#L1-L77
- https://github.com/aqm857886159/Nomi/blob/main/scripts/check-root-cause-contracts.mjs#L136-L202
- https://github.com/aqm857886159/Nomi/blob/main/package.json

## 6. conversations-store

登记：`self-written.json:L591-L605`, under-review, reviewBy=2026-11-15; paths `electron/conversations/conversationsStore.ts`, `electron/conversations/conversationsIpc.ts`.

当前实现事实：
- `conversationsStore.ts:L1-L25` defines v2 persisted messages/threads/areas and committedProposal; `L27-L35` caps and sanitizes proposal; `L37-L67` sanitizes messages/threads; `L70-L85` sorts/caps 30 threads and validates activeId; `L87-L115` migrates v1 single message arrays to v2 thread areas.
- `conversationsIpc.ts:L1-L16` says per-project `.nomi/conversations.json`; `L18-L21` resolves path; `L23-L35` read IPC validates sender/normalizes v1/v2; `L37-L59` write IPC validates sender/sanitizes and delegates atomic JSON write.

漏登/调用点扫描 (important): GitHub code search for `registerConversationsIpc` only returns `electron/conversations/conversationsIpc.ts`, docs and `electron/agentLane/laneDesktopStructure.test.ts`; current structure test asserts `electron/main.ts` does NOT contain `registerConversationsIpc`, preload does NOT contain `nomi:conversations:`, bridge does NOT expose conversations (`laneDesktopStructure.test.ts:L8-L23`). Search for `nomi:conversations` returns only IPC file/docs/test. This is strong evidence the IPC/store is retired/dead from production graph. No hidden importer was found in static search, but grep/index is not a proof of runtime dynamic import.

现成方案：
- pi `JsonlSessionRepo`/Session API, pinned `@earendil-works/pi-agent-core`/`pi-coding-agent` 0.85.1; package metadata/license MIT; source Nomi `electron/agentLane/laneSession.mts:17` and report. It already owns lane persistence/order/history pagination.
- SQLite 3.53.4 (2026-07-24), public domain; official https://www.sqlite.org/ and release history https://sqlite.org/changes.html . Nomi has no sqlite dependency and no evidence this retired two-area JSON store still needs a replacement.
- (Alternative if retaining file JSON) `write-file-atomic` 8.0.0 ISC, https://www.npmjs.com/package/write-file-atomic ; Nomi already has `electron/jsonFile.ts`.

近30天 path log：0 commits touching either `electron/conversations/conversationsStore.ts` or `conversationsIpc.ts` (GitHub REST path API). Related migration/cutover activity exists elsewhere: `7a0647181c` 10-01 “domain roots narrowed (ai/conversations/connectors)”; `38db4a3d94` 10-05 paid-card conversation projection; `ba69e53fbb` 10-05 paid-card visible behavior tests. These do not touch the two registered files.

替换工作量/风险依据：static production callsites = 0 found; two files + their direct tests/docs only. The store API is ~115 lines pure sanitizer/migration; IPC is ~60 lines with two channels. Deletion risk is stale tests/docs or dynamic registration, not live lane data, because lane now uses pi session files and structure test asserts the old channels are absent. Confirm current release branch before deleting; report makes no deletion claim.

源码链接：
- https://github.com/aqm857886159/Nomi/blob/main/electron/conversations/conversationsStore.ts#L1-L115
- https://github.com/aqm857886159/Nomi/blob/main/electron/conversations/conversationsIpc.ts#L1-L60
- https://github.com/aqm857886159/Nomi/blob/main/electron/agentLane/laneDesktopStructure.test.ts#L8-L23

## Design-card fields

### ★1 用户怎么用
纯调研，不适用。没有用户操作或产品界面改动；输出是事实报告与可审计链接。

### ★2 谁说了算
- 登记状态/期限：`docs/engineering/self-written.json` entries (current `main`, lines cited above)。
- 代码语义：the cited current `main` source files and their tests/workflows; no new owner or policy is introduced.
- Final retain/replace/delete decision belongs to coordinator/user after this evidence; this document does not decide it.

### ★3 一致与复用
- Reuse existing source owners: validation classifier, outbound policy, jsonFile/durability, logger/logFiles/redact, gate runner/package script list, pi lane Session.
- Alternatives are recorded as comparison evidence only; no dependencies are added and no code path is forked.

### ★4 全状态
- Report states: current/under-review/dead-code-evidence/uncertain; no UI state machine added.
- Missing runtime proof is explicitly marked; static grep/search cannot prove dynamic imports or all wildcard gate files.

### ★9 验收与回滚
- Acceptance = each of six entries has current file:line refs, static leak scan, ≥2 alternatives with version/license/official URL, path-based 30-day commit count/titles, and callsite/interface-based effort/risk note; markdown lint/links can be checked by coordinator.
- Rollback = delete/revert this research-only markdown file; no production data/code rollback is involved.

## Boundaries / non-claims

This report does not claim any entry should be replaced, deleted, or retained. It does not install packages, alter gates, modify `self-written.json`, or run paid/network calls. Versions/licenses are candidate alternatives from official package/docs pages; they are not new Nomi dependencies.
