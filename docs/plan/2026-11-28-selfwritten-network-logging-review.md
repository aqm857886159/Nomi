# 到期自写基础设施项实查评估：`network-stack` 最小安全面与 `logging-and-crash` 处置方案（SM-selfwritten-due）

> 状态：📋 方案待拍板
> 协作看板：`#1586`（`Q-smell` §3.2 `U-5` 子项 `SM-selfwritten-due`） · 线/负责人：`gemini-sm-selfwritten` · 类别：[其他]（纯只读评估与 `docs/engineering/self-written.json` 重写稿，不改运行时代码）
> 实查基线：`origin/main` @ `e0ad90bff`（Electron `43.4.1` 内置 Node `24.18.1` / `undici` `7.29.0`；宿主机 Node `>=22.19.0`；`package.json` 现装 `undici@6.19.8`、`socks@2.8.9`、`atomically@2.1.1`）
> 统一规矩：我们是一个小的桌面应用。只做创作者常走的路，以及这条路上的钱和数据安全；边角记一行，不写代码。每个 PR 写一节「明确不做」。

---

## 先查别人

- https://github.com/nodejs/undici/blob/v7.29.0/docs/docs/api/ProxyAgent.md（及同仓 `docs/docs/api/Socks5ProxyAgent.md`、`docs/docs/api/EnvHttpProxyAgent.md`） · Node 官方 `undici` 自 `v7.23+` 内置 `Socks5ProxyAgent` 并在 `ProxyAgent` 中原生接管 `socks5://` / `socks://`（支持账号密码与远端代理解析 DNS），同时通过 `Dispatcher1Wrapper` 兼容 Node 22 的 `globalThis.fetch`；但其 `ProxyAgent` 不支持老旧 `socks4://`，且 `EnvHttpProxyAgent` 只读进程环境变量、不读桌面 OS 系统代理 / PAC，也不按每次重定向动态走 `net.BlockList` 私网直连 · **改了** `network-stack` 的瘦身结论——实测当前 Electron `43.4.1` 已内置 `undici 7.29.0`（`electron/socksDispatcher.ts:4` 注释中「Electron 31 锁死 `undici 6.19.8`」的前提已过期），对齐升级 `package.json` 的 `undici` 至 `7.29.0` 后，`socks5://` 可直接交给 `undici` `ProxyAgent`，整文件删除自写 `electron/socksDispatcher.ts`（80 行）并移除运行时依赖 `socks@2.8.9`。
- https://github.com/TooTallNate/proxy-agents/tree/main/packages/socks-proxy-agent（对照 https://github.com/beleav/fetch-socks ） · `socks-proxy-agent` 实现的是传统 `node:http` 的 `http.Agent`，与 `globalThis.fetch`（`undici.Dispatcher`）接口不兼容；`fetch-socks` 虽面向 `undici >= 7` 封装了 `socks` + `Agent({ connect })`，但若仅需创作者常用的 HTTP/HTTPS/SOCKS5 代理，直接用 `undici@7.29.0` 内置 `ProxyAgent` 即可零额外依赖覆盖 · **改了** `docs/engineering/self-written.json` 原 `network-stack.alternativesChecked` 的失真条目——原表将不兼容 `fetch` 的 `socks-proxy-agent` 当作备选，重写稿修正为 `undici` `ProxyAgent` / `Socks5ProxyAgent`、`EnvHttpProxyAgent` 与 `fetch-socks` 并写明各自边界。
- https://www.electronjs.org/docs/latest/api/session（`ses.resolveProxy` / `ses.setProxy`）与 https://www.electronjs.org/docs/latest/api/net（`net.fetch`） · Electron 的 `session.resolveProxy` 与 `session.setProxy` 提供跨平台系统代理 / PAC 探测与 Chromium 渲染栈路由；而 `net.fetch` 走 Chromium 网络栈，脱离 Electron 主进程（`ELECTRON_RUN_AS_NODE=1` 单测与 CLI）不可用，不支持按请求注入独立 `undici.Dispatcher`（单供应商代理、付费防重发单次连接池、DNS 重绑固定 IP），也不暴露 Node `error.cause`（`syscall: "connect"` 等） · **确认了** Nomi「系统探测与渲染层归 `session.resolveProxy` / `setProxy`，主进程主动出站归原生 `fetch` + 显式 `Dispatcher`」的双栈分工不可被单一 `net.fetch` 替代，自写面只留双栈串行提交与本地模型私网绕行。
- https://github.com/stripe/smokescreen（对照 https://gitlab.com/gitlab-org/gitlab/-/work_items/378267 ） · 服务端 SSRF 防护通常下沉到受控出口代理（Smokescreen）或在配置代理时被迫整段关闭 DNS 重绑检查（GitLab `#378267`），而单机桌面软件面对用户自开的 Clash / Surge / sing-box TUN 模式时，本机 DNS 返回 `198.18.0.0/15` 合成地址池，静态私网黑名单会把正常代理用户全部误拦 · **确认了** `2026-11-13` 删掉生成/取片出站地址层后，仅剩 3 处「抓网页文字进模型上下文」（`textEntersModelContext`）入口保留「代理路由判主机名、直连路由凭合成解析器正证据放行 `198.18.0.0/15` 并固定解析 IP」的最小桌面安全面（`electron/networkOutboundPolicy.ts`），同时可删去该文件残留的旧 `declaredOrigins` 死分支。
- https://github.com/megahertz/electron-log/blob/master/docs/transports/file.md（及同仓 `docs/extend.md`、`docs/initialize.md`） · `electron-log` v5（零外部依赖，解包约 93 kB）提供 `maxSize -> .old.log` 单代大小轮转、`hooks` / `transforms` 拦截与 `__ELECTRON_LOG__` 渲染层全量自由文本 IPC 转发；但它不提供按天保留期清理（`pruneExpiredLogs`）、不支持崩溃道 `2MB` 就地截断（`truncate`）与轮转后重印构建会话表头（`--- session`），且其默认 IPC 转发绕过 `assertTrustedFireAndForget` 与按事件分钟限流 · **改了** `self-written.json` 原 `logging-and-crash` 的预设猜测（「落盘交给 `electron-log`」）——实算接入 `electron-log` 仅能替掉 `logFiles.ts` 内部约 45 行 `stat/rename/append`，却要倒贴约 65 行兼容适配代码（净增 ~20 行 + 新增 1 个随包 npm 依赖）并危及 `feedbackLogTail.ts` 与 `stallTimeline.ts` 严格行格式契约，故推荐**不引入 `electron-log`**，就地修掉 `logFiles.ts` 每行重复同步 `mkdirSync`/`statSync` 的性能瑕疵并转为精确 `justified`。
- https://www.electronjs.org/docs/latest/api/crash-reporter（对照 https://github.com/pinojs/pino/blob/main/docs/redaction.md ） · Electron 原生 `crashReporter.start({ uploadToServer: false })` 负责采集 C++/GPU/DLL 原生崩溃 Crashpad minidump（本仓 `electron/crashLog.ts:124` 已直接调用）；而 Pino 等通用日志库的 `redact` 只按固定 JSON 属性路径擦除，无法擦除被任意包装层拼进 `error.message` 自由文本的上游回显密钥 · **确认了** 崩溃原生层继续交给 `crashReporter`，而主进程崩溃面包屑同步写盘（`appendFileSync`）、上游流拆除噪音框过滤（`isUpstreamStreamTeardownError`）以及「闭合 API 拒收自由文本 + 错误原文转 `msg#<8位指纹>`」（`logger.ts` + `diskSafeFailure.ts` + `redact.ts`）属于 Nomi 本地隐私承诺的最小独有实现。

出口：不涉及：本报告为纯只读评估方案文档，不修改任何生产代码或门岗脚本，不新增、扩大或挪动任何阻断用户操作的运行时保护。

---

## 短版设计卡

- ★1：完成 `docs/plan/2026-11-28-code-smell-census-phase1.md` §3.2 `U-5` 到期自写基础设施项实查，重点深挖 `network-stack`（10 文件 1,805 行）与 `logging-and-crash`（7 文件 1,236 行）并给出可直接粘贴替换 `docs/engineering/self-written.json` 的 JSON 重写稿与配套瘦身子单，顺带核清 `durable-json` 与 `ipc-invoke-failure-text` 定案衔接；量具：`scripts/prior-art-lib.mjs`、`scripts/doc-status-lib.mjs`、`scripts/self-written-lib.mjs`（内存代入校验 0 错）、`scripts/check-pr-judgement.mjs`；老用户：不适用（本单仅新增只读计划文档，零运行时与持久化改动）。
- ★2：自写通用能力登记的唯一 owner 为 `docs/engineering/self-written.json`（门岗判据单源：`scripts/self-written-lib.mjs`）；本报告给出逐文件去留裁决与重写 JSON，待协调与用户按 P1 拍板后由独立实现 PR 同步落地代码瘦身与登记表更新；证据：`node scripts/self-written-review.mjs`。
- ★3：核对 `2026-11-13` 出站地址层删除复盘、`2026-09-06` 日志与诊断包方案、`2026-09-24` 渲染失败日志方案及 `2026-10-22` `G-redact-owner` 方向检查；`network-stack` 选「升 `undici@7.29.0` 用内置 `ProxyAgent` 删 `socksDispatcher.ts` 与 `socks` 包 + 2 个领域文件归位 `electron/catalog/` + 保留 7 个最小安全/双栈路由文件转 `justified`」，`logging-and-crash` 选「不引 `electron-log`、消除 `logFiles.ts` 逐行同步 `statSync` 冗余并转 `justified`」；证据：全仓 `git grep` 与 `ELECTRON_RUN_AS_NODE=1` 实测。
- ★4：不适用：纯工程架构评估文档，不涉及桌面端界面空态、加载态、成功态、失败态、取消中、过期或能力不可用展示。
- ★9：本地实跑 `evaluatePlans()`、`documentStatus()`、将两份重写 JSON 代入 `validateRegistry()`、运行 `check-pr-judgement.mjs`（`push` 与 `merge` 双档）及本机路径/内部编号正则扫描均 `0` 错误；反例核验 `socks-proxy-agent` 不兼容 `undici`、`undici` v7 不支持 `socks4://`、`electron-log` 默认格式打断 `feedbackLogTail.ts` 投影；回滚：`git revert` 本次单文档提交。

---

## 明确不做

1. **本 PR 不修改 `docs/engineering/self-written.json`、不改动任何生产代码、测试代码、`package.json` 或门岗基线**：严格执行单文件只读评估交付，所有 JSON 改写稿与代码瘦身子单均在本报告内定稿，待协调拍板后分拆小型实现 PR 落地。
2. **不为老旧边角协议 `socks4://` 保留或新引入额外 npm 依赖**：现代桌面代理工具（Clash、Surge、sing-box、v2rayN）均原生暴露 HTTP 与 SOCKS5 端口；升级 `undici@7.29.0` 后直接用内置 `ProxyAgent` 承载 `socks5://` / `socks://`，遇到极罕见的 `socks4://` 明示 `unsupported` 引导改填 `http://` 或 `socks5://`，遵循「边角记一行，不写代码」，不再为 SOCKS4 保留 `socks` 或新装 `fetch-socks`。
3. **不在本单重复展开 `durable-json` 与 `ipc-invoke-failure-text` 的全量实现设计**：这两项已有清晰方向检查与 `Q-smell` 排期，本文仅在 §0 核实最新代码基线与衔接边界，不重造平行方案。
4. **不引入重型服务端日志框架（`pino` / `winston`）或自建远程崩溃收集服务端**：Nomi 坚持本地优先与零静默上传，崩溃 minidump 只落本机 `crashDumps`，诊断包由用户手动导出并自行决定是否发送。

---

## 零、`U-5` 四项到期自写基础设施全景与其余两项核清

`docs/plan/2026-11-28-code-smell-census-phase1.md` §3.2 `U-5` 共点名 4 项到期 / 临期 `under-review` 自写基础设施条目。全量核对 `docs/engineering/self-written.json` 与现役代码后，四项分流如下：

| 条目 ID | 当前登记状态与限期 | 现役路径与代码行数 | 定案结论与衔接去向 |
| :--- | :--- | :--- | :--- |
| **`network-stack`** | `under-review`（`2026-11-30`） | `electron/` 下 10 个文件，共 **1,805 行** | **本文第一部分深挖**：升 `undici@7.29.0` 后**删除 `socksDispatcher.ts`（80L）与 `socks` 依赖**，将 `providerNetwork.ts`（22L）与 `proxyProbe.ts`（63L）迁回 `electron/catalog/` 领域目录，瘦身 `networkOutboundPolicy.ts` 与 `systemProxy.ts` 死分支，收缩为 **7 个最小桌面安全与双栈代理适配文件**并转 `justified`（预估净删 **240~290 行** + 减 1 个随包 npm 包）。 |
| **`logging-and-crash`** | `under-review`（`2026-11-30`） | `electron/logging/`（6 个生产文件 1,015 行）+ `electron/crashLog.ts`（221 行），共 **1,236 行** | **本文第二部分深挖**：实证接入 `electron-log` v5 会净增约 20 行适配胶水、多打进 1 个运行时 npm 包且易破坏 `feedbackLogTail.ts` / `stallTimeline.ts` 行协议；推荐**不引新包**，修复 `logFiles.ts` 逐行同步 `mkdirSync`/`statSync` 缺陷、去重 `diskSafeFailure.ts` 类别表后，转为精确 `justified`。 |
| **`durable-json`** | `under-review`（`2026-11-30`） | `electron/jsonFile.ts`（113L）、`electron/durability.ts`（93L）、`electron/sharingRetry.ts`（53L），共 **259 行** | **已有定案衔接（不续期）**：对照 `docs/plan/2026-11-28-code-smell-census-phase1.md` Top #19、`docs/engineering/direction-checks/2026-11-13-main-thread-sync-wait.md` 与 `docs/plan/2026-11-13-save-hotpath-safe-subset.md`：① 通用异步整文件原子写收归仓库已声明的 `atomically@2.1.1`（注意落地时需将其从 `package.json:365` `devDependencies` 提至 `dependencies` 以通过 `scripts/audit-package.mjs` 闭包门岗），随保存迁出主进程一并清退 `jsonFile.ts:29` 的 `Atomics.wait`；② 仅保留 `durability.ts`（单测 `ephemeral` 关 `fsync` 提速 20× 的唯一闸门，`check:heavy-path` 守卫）与 `sharingRetry.ts`（Windows 覆盖已有导出成品文件的定时器退避，弥补 `graceful-fs` 只管目标不存在的空白）转最小 `justified`。脚本/测试侧重复写盘归既有 `Q-atomic-scripts`。 |
| **`ipc-invoke-failure-text`** | `under-review`（`2026-11-23` **已逾期**） | `electron/shared/contracts/ipcInvokeFailure.ts`（67L）、`ipcResult.ts`（17L）、`projectSaveFailure.ts`（43L），共 **127 行** | **已有定案衔接（不续期）**：对照 `docs/audit/2026-10-24-ipc-error-class-name-direction.md`、`docs/engineering/direction-checks/2026-10-30-project-save-draft-contract.md` 与 `docs/plan/2026-11-28-code-smell-census-phase1.md` Top #7（批 2）：项目保存通道已率先通过 `ipcResult.ts` + `projectSaveFailure.ts` 改为显式 `{ ok: false, error, reason }` 结构化结果包络，不再解析错误原文；下一步在 `Q-smell` 批 2 将渲染层散落的 6 处 `"Error invoking remote method"` 手写正则统一收归 `IpcResult` 结构化错误码（无需为传错把 218 处 IPC 全盘重构成 `electron-trpc`），未迁通道的唯一兜底读法由 `ipcInvokeFailure.ts`（含 `isCodeClassName` 结构判据）单源承接。 |

---

## 一、第一部分：`network-stack` 逐文件实查与最小安全面 `justified` 重写稿

### 1.1 运行时底座与现装依赖核查

实查 `package.json`、`docs/engineering/package-budget.json` 及 Electron `43.4.1` 进程内运行时指标，发现一处关键**历史前提漂移**：

1. **Electron 内置 `undici` 已跨代升至 `7.29.0`**：在 Electron `43.4.1`（Node `v24.18.1`）中实测 `process.versions.undici === "7.29.0"`，而 `package.json:306` 仍停留在 Electron 31 时代的 `"undici": "6.19.8"`，同时额外携带 `"socks": "2.8.9"`（全仓仅 `electron/socksDispatcher.ts:13` 一处导入）。
2. **跨版本兼容性实测通过**：`undici@7.29.0` 声明 `engines.node: ">=20.18.1"`，内置 `ProxyAgent` 原生支持 `http://`、`https://`、`socks5://`、`socks://`（底层自动委派 `Socks5ProxyAgent`，支持鉴权与代理端 DNS 解析）；经本地回路实测，将 `undici@7.29.0` 的 `Agent` / `ProxyAgent` 作为 `{ dispatcher }` 传给 Electron `43.4.1`（Node 24）与宿主机 Node 22（`undici 6.29.1`，Vitest 运行环境）的 `globalThis.fetch` 执行 `GET` / `POST` 均完全兼容。
3. **相关安全辅助模块的既有边界**：`electron/credentialRedirectPolicy.ts`（34L，非标准头一律 `redirect: "error"`）、`electron/outboundDispatchEvidence.ts`（336L，`AsyncLocalStorage` 记账判定付费提交「未发出 vs 结果未知」）、`electron/networkErrorDetails.ts`（67L，底层 `cause.code` 提取与 URL 脱敏）均与 `network-stack` 正交协作；`2026-11-13` 提交 `3c0e2022c` 已删去生成/取片/媒体下载的出站地址拦截层，全仓仅剩 **3 处**抓文档进模型入口（`electron/catalog/catalogCommit.ts:524`、`electron/providerAdapter/docsDiscovery.ts:187`、`electron/providerAdapter/providedDocs.ts:89`）传 `textEntersModelContext: true`。

### 1.2 10 个登记文件逐一实查表

| 序号 | 文件路径（原始行数） | ① 现在真实干什么 · 谁在调（生产引用） | ② 现成库能顶替哪部分 vs Nomi 独有桌面安全/领域约束 | ③ 处置归类 |
| :---: | :--- | :--- | :--- | :--- |
| 1 | `electron/proxySettings.ts`（**62L**） | 定义应用级代理三态偏好 `ProxyMode`（`system \| custom \| off`）与 `normalizeProxyPrefs`（选 `custom` 未填地址自动回退 `system` 防静默断网），读写 `<settingsRoot>/proxy-prefs.json`。**调用方（4 文件 7 处）**：`proxyIpc.ts:4`、`capabilityCore/host.ts:19`、`capabilityCore/mcpStdioServer.ts:20`、`ai/antigravityConnection.ts:45`（另 `systemProxy.ts:21` 仅引类型）。 | 原子读写文件**已复用** `configFileStore.ts`（零自写 IO）；`undici` 与 Electron `session` 均不管理「仅对本应用生效的三态偏好 + 切模式保留上次手填地址」这一产品设置语义；独立成文件是为隔离 `runtimePaths -> electron` 以便 `systemProxy.ts` 纯 Node 单测。 | **保留进最小 `justified`** |
| 2 | `electron/systemProxy.ts`（**539L**） | 维护应用级已提交路由 `activeRoute`：`resolveProxy`（环境变量优先 → `session.resolveProxy` 解析 PAC 串）、`SelectiveProxyDispatcher`（每跳按 `isPrivateHost(origin)` 让本机/内网模型直连、公网走代理）、`FreshConnectionDispatcher`（付费提交专用单次连接池，消除空闲 keep-alive 复用造成的 `UND_ERR_SOCKET` 双重扣费歧义）、`applySystemProxy`（代数号串行同步 Node `undici` 与 Chromium `session.setProxy`，失败回滚且优雅关闭旧连接池）、`getProxyStatus` 与 `describeNetworkError`（45L 中文错误翻译）。**调用方（14 文件 26 处）**：`appFetch.ts`、`hardenedFetch.ts`、`proxyIpc.ts`、`comfyuiProgressSocket.ts`、`host.ts`、`mcpStdioServer.ts`、`browserViewSession.ts`、`modelListProbe.ts` 等。 | HTTP/HTTPS 代理池与连接复用**已直接交给** `undici`（`ProxyAgent` / `Agent`），系统代理探测与渲染层代理**已直接交给** Electron `session.resolveProxy` / `session.setProxy`；`undici.EnvHttpProxyAgent` 不读桌面系统代理、不支持动态热切换与每跳 `net.BlockList` 私网绕行；Electron `net.fetch` 在纯 Node / CLI 下不可用、不支持注入 `FreshConnectionDispatcher`（防重复扣费）且屏蔽 `error.cause` 连接前证据。其中 `socks5://` 创建可改交 `undici@7.29.0` `ProxyAgent`，尾部 `describeNetworkError` 硬编码中文可收口至 `networkErrorDetails` + `desktopT`。 | **保留进最小 `justified` + 合并精简（约 −60L）** |
| 3 | `electron/socksDispatcher.ts`（**80L**） | `parseSocksProxyUrl`（解析 `socks5/socks4` URL 与解码账密）+ `socksConnector` / `createSocksDispatcher`（用 `socks` 库建隧道再交 `undici.buildConnector` 升 TLS）。**调用方（仅 1 文件）**：`electron/systemProxy.ts:16`（同时是全仓唯一导入 `package.json` `"socks": "2.8.9"` 之处）。 | **可由现成库直接顶替**：文件头明写自写唯一原因是 Electron 31 内置 `undici 6.19.8` 无 SOCKS5。现 Electron `43.4.1` 已内置 `undici 7.29.0`，对齐升级 `package.json` `undici` 至 `7.29.0` 后，`new ProxyAgent("socks5://...")` 原生支持 `socks5://` / `socks://`；按统一规矩不为古董 `socks4://` 留代码（返回诚实 `unsupported` 提示改用 `http://` 或 `socks5://`），仅留 ~12 行 URL 校验入 `systemProxy.ts`。 | **换现成库（`undici@7.29.0` `ProxyAgent`）后整文件删除（−80L，卸 `socks` 包）** |
| 4 | `electron/proxyIpc.ts`（**58L**） | 启动装代理 `applyProxyAtBoot`（含非打包态注入 `seedLabTrustedPrivateOrigins`）及注册 `nomi:proxy:get/set/test` 三条主窗口 IPC。**调用方（1 文件）**：`electron/main.ts:43`。 | IPC 通道由 Electron `ipcMain.handle` 承担；自写仅留 `assertTrustedSender` 主窗口身份守卫（防恶意页面篡改全局代理劫持流量）及设置变更后热切换 `applySystemProxy` + 刷新 `fake-ip` 环境快照的胶合。 | **保留进最小 `justified`** |
| 5 | `electron/proxyProbe.ts`（**63L**） | 从 `catalog/assetLocalization.ts` 派生免配置参考图上传源 `anonymousAssetHostingOrigins()`，顺序发 8s 超时 `GET`（任意 HTTP 响应码即判网络可达，逐项记 `tried[]`）。**调用方（1 文件）**：`electron/proxyIpc.ts:5`。 | 通用探活库（如 `is-online`）探测苹果/谷歌/Cloudflare 门户，在大陆分流规则下会误报「在线」却连不上参考图床；传输与超时已直接复用 `appFetch` + 原生 `AbortController`，63 行全部是 Nomi 匿名参考图上传链的有序回退可达性领域规则。迁入 `electron/catalog/assetUploadProbe.ts`（属已登记 `domainRoots` `electron/catalog/`）即可与 `assetLocalization.ts` 同域归位。 | **迁入领域目录 `electron/catalog/`（移出 `network-stack`）** |
| 6 | `electron/hardenedFetch.ts`（**537L**） | 主进程拉取不可信/外部 URL 的加固出口：协议限制、最多 5 跳手动重定向（带凭据默认拒跳，跨域 CDN 跳转剥离 `authorization`/`cookie` 与自定义 `sensitiveHeaders`）、仅在 `textEntersModelContext: true` 时逐跳执行 `authorizeOutboundDestination` 并用 `createPinnedDispatcher` 钉死解析 IP 防 DNS 重绑、总超时 + 按 `Content-Length` 放宽时限 + 读流侧 `idleTimeoutMs` 空闲看门狗、`allowContentTypes`（兼容 S3 `binary/octet-stream`）、`maxBytes` 流式硬截断与 `onChunk` 零内存落盘、拒绝路径 `abandonResponse` 释放连接池、挂载剥去签名 query 的 `HardenedFetchDiagnostics`。**调用方（约 20 文件 77 处）**：`providerMediaFetch.ts`、`localizeTaskAsset.ts`、`modelImageInput.ts`、`audioTaskRunner.ts`、`catalogCommit.ts`、`docsDiscovery.ts` 等。 | 底层请求与连接池**已复用** `appFetch` 与 `undici.Agent`；`got` 自带 `node:http` 平行栈会绕过 `appFetch` 计费账本与 `undici` 代理池，`ky` 无流式字节硬上限与跨域自定义鉴权头剥离，而 `undici` 内置 `bodyTimeout` 在流背压暂停解析器时不触发（`2026-09-29` 已实证），也无带签名 URL 脱敏的取片诊断符号。文件保留，注释与 3 处专用分支可适度精简。 | **保留进最小 `justified`** |
| 7 | `electron/appFetch.ts`（**36L**） | 主进程唯一 Node HTTP 出口：锁定原生 `globalThis.fetch`，串接测试网闸 `guardTestNetworkUrl`、路由注入 `getAppDispatcher`、凭据禁跳 `withCredentialRedirectPolicy` 与付费派发记账 `handOffToNetwork`。**调用方（35+ 文件 86 处）**：全主进程供应商调用、Agent Lane、MCP、价格预览等唯一出网口。 | HTTP 协议、`Request`/`Response`/`FormData` 及 `redirect: 'error'` 执行 **100% 交给 Node 原生 `fetch`（`undici`）**；36 行仅挂载「按镜头花钱未发出证据账本 + 自定义密钥头禁跳 + 私有代理池防 SDK 全局篡改」三条 Nomi 核心约束。 | **保留进最小 `justified`** |
| 8 | `electron/networkHostPolicy.ts`（**36L**） | 基于 Node 标准库 `net.BlockList` 判定 IPv4/IPv6 回环、RFC 1918 私网、链路本地 `169.254.0.0/16` / `fe80::/10`、CGNAT、`198.18.0.0/15` 及 `localhost`/`.local`，硬零禁止环境变量逃生口（`check:outbound-policy` 守卫）。**调用方（3 生产文件，基线锁死）**：`systemProxy.ts:14`、`networkOutboundPolicy.ts:17`、`integrationCertification/httpConnector.ts:8`。 | 子网匹配**已直接使用 Node 内置 `net.BlockList`**（零手写位运算，规避第三方 `ip` 包八进制绕过漏洞）；36 行仅定义「本机模型直连绕过代理」与「文档抓取内网拦截」共用的唯一私网范围表。 | **保留进最小 `justified`** |
| 9 | `electron/networkOutboundPolicy.ts`（**372L**） | ① 探测本机 Clash/Surge/sing-box TUN `fake-ip`（`198.18.0.0/15`）合成解析器（≤1.5s 缓存，供设置页状态行与地址判据共读）；② 非打包态精确回环白名单 `seedLabTrustedPrivateOrigins(app.isPackaged)`；③ 面向仅剩 3 处 `textEntersModelContext` 入口的 `authorizeOutboundDestination`（禁 `169.254.169.254` 云元数据、代理路由只判主机名、直连路由凭合成解析器证据放行公网域名的 `198.18/15` 并返回固定 IP）。**调用方（4 文件 11 处）**：`hardenedFetch.ts`、`proxyIpc.ts`、`systemProxy.ts`、`networkOutboundMessage.ts`。 | 社区 SSRF 包（`ssrf-req-filter` / `request-filtering-agent`）只挂 `node:http` `Agent` 且一律封杀 `198.18.0.0/15` 导致桌面 TUN 用户断网；本模块是桌面 `fake-ip` 环境识别与防提示词注入读取内网的最小安全策略。**存在历史冗余**：`2026-11-13` 删掉供应商出站地址层后，`authorizeOutboundDestination` 的 `declaredOrigins` 供应商私网参数已无外部生产传入，且文件内含约 185 行多轮历史复盘长注释。 | **保留进最小 `justified` + 合并精简（净删 ~120~140L）** |
| 10 | `electron/providerNetwork.ts`（**22L**） | 从目录 `Vendor.network` 读取 `proxyEnabled` / `proxyUrl`，转调 `systemProxy.ts` 的 `normalizeExplicitProxyUrl` 与 `createExplicitProxyDispatcher`。**调用方（10 文件 18 处）**：`vendorHttp.ts`、`providerMediaFetch.ts`、`projectAssetStore.ts`、`localizeTaskAsset.ts`、`catalogReconciliation.ts` 等。 | **零通用网络实现**：纯粹是把模型目录 `Vendor` 实体的单供应商代理配置映射到 `systemProxy` 的 22 行领域胶合。迁入 `electron/catalog/providerNetwork.ts`（属已登记 `domainRoots` `electron/catalog/`）即可回归目录领域。 | **迁入领域目录 `electron/catalog/`（移出 `network-stack`）** |

### 1.3 可直接粘贴替换的 `network-stack` 完整 JSON 重写稿

> 说明：以下 JSON 块已按 `scripts/self-written-lib.mjs` 的 `validateRegistry` 规则逐字段校验（收缩后的 7 条 `paths` 在当前仓库与瘦身完成后均真实存在，`alternativesChecked` 全部附真实官方文档/仓库 URL，`whyNotIntegrated` 对齐同文件 `retry-policy-adapter` / `bounded-cache-adapter` 的精炼体例）。若在执行子单 N-1/N-2 删迁 `socksDispatcher.ts` / `providerNetwork.ts` / `proxyProbe.ts` 之前先行合入登记表，亦零陈旧路径报错；推荐随子单 N-1/N-2 同批更新 `docs/engineering/self-written.json:1454-1486`。

```json
    {
      "id": "network-stack",
      "capability": "桌面双栈代理路由同步、单次付费连接隔离与不可信 URL 取回加固",
      "status": "justified",
      "plan": "docs/plan/2026-11-28-selfwritten-network-logging-review.md",
      "paths": [
        "electron/appFetch.ts",
        "electron/hardenedFetch.ts",
        "electron/systemProxy.ts",
        "electron/proxySettings.ts",
        "electron/proxyIpc.ts",
        "electron/networkHostPolicy.ts",
        "electron/networkOutboundPolicy.ts"
      ],
      "alternativesChecked": [
        {
          "name": "undici 7.29.0 Agent / ProxyAgent / Socks5ProxyAgent（直接承担连接池、HTTP/HTTPS 与 SOCKS5 代理隧道）",
          "source": "https://github.com/nodejs/undici/blob/v7.29.0/docs/docs/api/ProxyAgent.md"
        },
        {
          "name": "undici EnvHttpProxyAgent（仅读环境变量，不读桌面系统代理/PAC，不支持运行中热切换与每跳私网直连）",
          "source": "https://github.com/nodejs/undici/blob/v7.29.0/docs/docs/api/EnvHttpProxyAgent.md"
        },
        {
          "name": "Electron session.resolveProxy / session.setProxy 与 net.fetch（前两者直接承担系统代理探测与渲染层代理；net.fetch 不支持纯 Node 运行、单请求 Dispatcher 与连接前 cause 判据）",
          "source": "https://www.electronjs.org/docs/latest/api/session"
        },
        {
          "name": "Node.js net.BlockList（直接承担私网、回环、链路本地与 fake-ip 网段匹配）",
          "source": "https://nodejs.org/api/net.html#class-netblocklist"
        },
        {
          "name": "fetch-socks 与 socks-proxy-agent（socks-proxy-agent 为旧 http.Agent 不兼容 fetch；升 undici 7.29.0 后 SOCKS5 由内置 ProxyAgent 直接承担）",
          "source": "https://github.com/beleav/fetch-socks"
        }
      ],
      "whyNotIntegrated": "HTTP/HTTPS/SOCKS5 隧道与连接池直接交给 undici Agent / ProxyAgent，系统代理探测与 Chromium 路由交给 Electron session.resolveProxy / setProxy，网段分类交给 Node net.BlockList。自写最小适配仅承担 Nomi 独有的四项桌面与花钱安全约束：（1）应用内 system/custom/off 热切换在 Node 与 Chromium 双栈间串行提交，且每跳对本机/私网模型服务强制直连；（2）付费生成提交专用单次连接池，消除空闲复用连接重置的重复扣费歧义，并在唯一出口 appFetch 挂接未发出记账与自定义凭据头禁跳；（3）外部媒体与权重取回的读流侧空闲超时、按声明体积放宽时限、流式字节硬上限、跨域跳转去敏及去签名 URL 诊断；（4）桌面 TUN fake-ip（198.18.0.0/15）合成解析器识别，以及仅对「抓网页文字进模型」入口生效的防内网读取与直连 DNS 钉死。",
      "revisitWhen": "Electron 与宿主机 Node 支持双栈统一代理句柄且 undici 原生提供按跳私网绕行与读流侧空闲字节预算，或「抓网页文字进模型」的 3 处文档抓取入口改为纯离线/沙箱进程时，跑完整特征测试并删除对应适配层。"
    }
```

### 1.4 `network-stack` 配套代码瘦身子单（拍板后分步执行，预估总净删 **240~290 行** + 移除 1 个随包依赖）

1. **子单 `N-1`（换现成库删文件 · 需用户随本方案确认 `socks4://` 边角处置）**：升级 `package.json` 的 `"undici"` 从 `"6.19.8"` 至 `"7.29.0"`（与 Electron `43.4.1` 内置版本对齐），将 `electron/systemProxy.ts` 中 `socks5://` / `socks://` 分支直接交给 `new ProxyAgent(url)`，整文件删除 `electron/socksDispatcher.ts`（80L）与 `electron/socksDispatcher.test.ts`（迁保留的 URL 格式单测入 `systemProxy.test.ts`），并从 `package.json` 移除 `"socks": "2.8.9"`（同步用 `--update-baseline` 下调 `docs/engineering/package-budget.json` 包名单）。
   - **预计收益**：生产代码净删 **~68 行**，打包产物减少 `socks` 及其传递依赖。
2. **子单 `N-2`（领域归位 · 纯机械搬迁）**：将纯目录模型投影 `electron/providerNetwork.ts`（22L）迁至 `electron/catalog/providerNetwork.ts`，将参考图上传源探针 `electron/proxyProbe.ts`（63L）迁至 `electron/catalog/assetUploadProbe.ts`（与 `electron/catalog/assetLocalization.ts` 同属 `electron/catalog/` 领域根，保持零 Electron 依赖可纯 Node 单测）。
   - **预计收益**：消除 `electron/` 顶层 2 个混放模块，`network-stack` 登记路径从 10 个收窄至 7 个核心文件。
3. **子单 `N-3`（死分支与重复文案瘦身）**：
   - 在 `electron/networkOutboundPolicy.ts`（372L）中删除 `2026-11-13` 出站地址层退役后已无外部生产调用方传入的供应商 `declaredOrigins` 参数分支（仅保留非打包态 `labTrustedPrivateOrigins`），并将已沉淀至 `docs/engineering/direction-checks/2026-11-13-outbound-address-layer-delete.md` 的大段历史复盘长注释精简为一行指向链接（预计净删 **~120~140 行**）；
   - 在 `electron/systemProxy.ts`（539L）中将 `describeNetworkError`（484-523 行）的错误码提取收归 `electron/networkErrorDetails.ts`，硬编码中文提示对齐 `desktopT` 词表（预计净删 **~25~35 行**）；
   - 连同子单 `N-1`/`N-2` 一并把上述重写 JSON 落入 `docs/engineering/self-written.json` 的 `network-stack`。

---

## 二、第二部分：`logging-and-crash` 逐文件实查与 `electron-log` 接入评估

### 2.1 7 个生产文件与诊断/反馈消费链逐一实查

全量精读 `electron/logging/` 下全部 6 个生产源文件（1,015 行；另含 5 个单测文件 989 行）、`electron/crashLog.ts`（221 行），以及主/渲染进程调用点与下游消费端（`src/desktop/rendererLog.ts`、`electron/diagnostics/diagnosticsBundle.ts`、`electron/diagnostics/diagnosticsIpc.ts`、`electron/diagnostics/stallTimeline.ts`、`electron/feedback/feedbackLogTail.ts`）：

| 序号 | 文件路径（原始行数） | 现在真实干什么 · 下游谁在强依赖它 | 自写重复 / 实查发现的真实缺陷 |
| :---: | :--- | :--- | :--- |
| 1 | `electron/logging/logger.ts`（**251L**） | 主进程唯一日志出口（`check:main-console` 硬零守卫，75+ 文件 97 处调用）：闭合 `LogScope`（26 个模块名）、仅收标量的 `LogFields`、闭合 7 字段 `VendorCallSummary`（`logVendorCall`）、打包态 MCP stdio 专属诊断镜像开关 `markStderrAsDiagnosticSurface()`（`stdout` 让给 JSON-RPC 时向宿主 Claude Code / Codex 输出 `stderr`）、永不落盘的 `logDevDetail`、会话启动标记 `installMainLogger`。 | **无第三方等价物**：在编译期用类型抹掉自由文本参数位（提示词、请求体、素材路径无处可传），并精准区分「常规打包版禁写 `stderr`」与「打包版 MCP stdio 必写 `stderr` 吞 `EPIPE`」。 |
| 2 | `electron/logging/logFiles.ts`（**187L**） | 全仓**唯一**同步文件滚动写手 `createLogFileSink`，同时驱动三条本地落盘流：① 通用按天日志 `nomi-YYYY-MM-DD.log`（4MB `archive` 留一代 `.1.log` + 按文件名本地日期清 7 天前旧档 `pruneExpiredLogs`）；② 崩溃日志 `nomi-crash.log`（2MB `truncate` 就地清空）；③ 卡顿时间线 `nomi-stall-timeline.log`（`stallTimeline.ts:99`，192KiB `archive`）。每次新文件或滚动后自动补写首行 `--- session nomi=...` 表头；导出 `listLogFilesForBundle` 供诊断包与一键反馈按新旧读取。 | **实查抓到 1 处真实热路径瑕疵**：`logFiles.ts:110,116` 在**每一次 `append(line)`** 时都无条件执行同步 `fs.mkdirSync` + `fs.statSync(target).size` + `fs.appendFileSync`（单行日志触发 **3 次主线程同步 fs 系统调用**！）。改为仅在切换目标文件时 `mkdirSync` + 初次 `statSync`、后续在内存累加字节数，可立砍 2/3 同步系统调用。 |
| 3 | `electron/logging/redact.ts`（**184L**） | 第二道运行期脱敏纯函数库：① 36 个敏感字段名 + 11 个词根黑名单整段替换为 `<omitted:key>`；② 有序值脱敏（`data:/blob:`、保留 `scheme://host` 剥除签名 URL 路径与 query、带空格的 POSIX/Windows 本地目录如 `Nomi Projects/…`、`Bearer`/`sk-*`/`AKIA*`/长 Base64、控制字符压平、200 字单值与 2,000 字整行上限）；③ `redactError` + `stackFrames`（最多留 8 帧且剥除目录只留 `(文件名:行:列)`）。被 `crashLog.ts`、`diagnosticsFacts.ts`、`feedbackLogTail.ts`、`feedbackReport.ts`、`trajectoryProjection.ts` 共 13 处跨模块复用。 | **核心隐私资产，零冗余**：顺序敏感（先认 URL 再认路径防切碎 host，先认带空格用户根再走空白切分防漏项目名），且历次真窗口走查逃逸均已由 `redact.test.ts`（182L）钉死。 |
| 4 | `electron/logging/diskSafeFailure.ts`（**215L**） | 错误与事件落盘的结构化事实唯一提取器（`G-redact-owner`）：只提取合法代码类名（复用 `isCodeClassName`）、系统数字/标识符错误码、供应商封闭枚举 `VendorFailureFacts`，将其余自由文本 `error.message` 统一转为不可逆 `msg#<8位sha256>` 指纹；同时导出 `diskSafePayload` 递归剥除 `upstreamMsg`，供 `.nomi/events`（`eventLogRepository.ts`）、`vendorCallTrace.ts`、`productionGenerationMaterialization.ts` 共用。 | **实查抓到 1 处小重复**：`diskSafeFailure.ts:21` 为避开早期编译岛依赖手抄了一份 `VENDOR_FAILURE_CATEGORIES`，而如今中立层 `electron/shared/vendorFailure.ts:6` 已抽成单源，可直接改为从 `../shared/vendorFailure` 导入，消掉双份枚举。 |
| 5 | `electron/logging/rendererLog.ts`（**140L**） | 渲染层上报主进程日志的唯一 IPC 入口（`nomi:log:renderer`，配对 `src/desktop/rendererLog.ts` 202L）：先过 `assertTrustedFireAndForget` 校验发送方窗口身份，再用 Zod 强校验封闭标量形状（拒收留痕 `renderer-log-rejected`），执行**按事件每分钟 20 行 / 全局每分钟 200 行双桶限流**（防止坏图片刷屏挤掉同分钟唯一的 `project-save-failed` 或阻塞主进程写盘），最后分级汇入 `logger` 或 `logCrash`。 | **不可被通用库转发替代**：既是不可信渲染层的安全防刷闸门，又确保脱敏规则只在主进程单点执行一次。 |
| 6 | `electron/logging/devDiagnostics.ts`（**38L**） | 从 `main.ts` 拆出的开发态窗口事件监听（`did-fail-load`、`preload-error`、`console-message` 等），全部交 `logDevDetail` 仅打终端、打包版零开销不落盘（避免将本机 `userData` 路径与自由 console 内容写进用户磁盘）。 | 38 行极简接线，服务于 `main.ts` 体积受控与「开发可看、生产不落盘」边界。 |
| 7 | `electron/crashLog.ts`（**221L**） | 三层崩溃取证：① 原生层 `startNativeCrashCapture` 直接调用 Electron `crashReporter.start({ uploadToServer: false })` 采集本地 Crashpad minidump，配 `logBreadcrumb` 在高危原生调用前同步落盘面包屑；② 进程级 `installProcessGoneHandlers` 在 `app` 上捕获所有主/辅窗口与 GPU/utility 子进程的 `render-process-gone` / `child-process-gone`；③ JS 层 `installCrashHandlers`（`uncaughtExceptionMonitor`，不碰可能已损坏的 `stderr`）+ `installUncaughtExceptionNoiseFilter`（仅对全栈均为 `node:` 内建模块的 `undici` WebStreams `ERR_INVALID_STATE` 拆除竞态静默留证不弹原生错误框，其余真异常摘除自身后重抛回 Electron 原生 `dialog.showErrorBox`）。 | 原生崩溃采集**已用官方 `crashReporter`**，文件落盘**已复用 `logFiles.ts`**；自写部分全是 Electron 默认行为处理不了的桌面实战边界（`listenerCount === 1` 原生弹框保留术、原生闪退前最后一行同步 `appendFileSync`）。 |

### 2.2 `electron-log` v5 与 Electron `crashReporter` 逐项能力对标

针对「能否通过 `electron-log` v5 的 `hooks` / `transforms` / 自定义 `format` 零妥协挂载 Nomi 隐私规则与诊断导出链路」做逐项工程推演：

1. **落盘格式被两条下游解析器按字节锁死，换库没有自由度**：
   - **一键反馈投影器 `electron/feedback/feedbackLogTail.ts:38-165`（`projectLogLine`）**：严格按正则 `^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]\s+(.+)$`、表头 `--- session nomi=… electron=… <platform>-<arch> pid=…`、正文 `LEVEL scope event k=v … ErrorClass msg#<8hex> | at fn (file:1:2)` 逐词白名单投影出机；任何格式偏差都会导致 `projectLogLine` 返回 `null` **整行静默丢弃**，使远程反馈彻底失明。
   - **卡顿时间线读取器 `electron/diagnostics/stallTimeline.ts:141-163`（`readStallTimeline`）**：直接读取 `nomi-stall-timeline.1.log` 与 `nomi-stall-timeline.log`（依赖 `logFiles.ts` 的 `.1.log` 命名而非 `electron-log` 默认的 `.old.log`），剥掉 `[时间戳]`、跳过 `--- session` 行后做 `JSON.parse`。
   - **诊断包组装器 `electron/diagnostics/diagnosticsBundle.ts:137`**：依赖 `listLogFilesForBundle` 返回 `[nomi-crash.log, ...按日期倒序的 nomi-YYYY-MM-DD(.1).log]`，在超出 25MB 上限时优先裁掉最旧日期的日志，且依赖每个滚动分片首行都有 `--- session` 版本表头以便单看 `.log` 后半段仍知晓构建号。
2. **`electron-log` v5 的内建能力与 Nomi 需求的真实交集只有 ~45 行**：
   - `electron-log` v5 的 `hooks`（`log.hooks.push((msg, transport) => ...)`）是**事后拦截器**，挡不住调用方传入无规律的自由文本提示词——因此 `logger.ts`（编译期封闭标量签名）、`diskSafeFailure.ts`（错误原文转哈希指纹）与 `redact.ts`（字段名黑名单 + 路径/URL 擦除）**一行都不能删**。
   - `electron-log` v5 的 `log.initialize()` 渲染层 IPC 通道接收任意自由数组 `data: any[]`，既无 `assertTrustedFireAndForget` 窗口守卫，也无「单事件 20 行/分钟、全局 200 行/分钟」防刷限流——启用即引入隐私旁路与主进程同步写盘卡死风险，**必须显式禁用**，保留 `rendererLog.ts`（140L）。
   - `electron-log` v5 的 `errorHandler.startCatching()` 会常驻挂载 `process.on('uncaughtException')` 并接管弹框，破坏 `crashLog.ts:199` 依赖 `process.listenerCount('uncaughtException')` 让 Electron 原生框与 `isUpstreamStreamTeardownError` 噪音过滤共存的机制——**必须显式禁用**，保留 `crashLog.ts`（221L）。
   - `electron-log` v5 **没有按天保留期清理**（`pruneExpiredLogs` 仍须自写），默认轮转后缀是 `.old.log` 而非 `.1.log`，不支持崩溃道的 `truncate` 就地清空，也不会在大小轮转新建文件时自动重印 `--- session` 版本表头——若强行用 `resolvePathFn` + 自定义 `archiveLogFn` + 自定义 `format` + 3 个独立实例（按天异步/同步道、崩溃 `writeOptions` 同步 `truncate` 道、卡顿 `.1.log` 道）去模拟现有行为，**新增的 `electron-log` 适配配置代码约 65 行，比它替掉的 `createLogFileSink` 内部 45 行 `stat/rename/append` 还多出约 20 行**！

### 2.3 方案对比与明确推荐决策

| 评估维度 | 方案 A：接入 `electron-log` v5 管文件轮转 + 留脱敏纯函数 | **方案 B（推荐）：不引新包，就地修复 `logFiles.ts` 同步 `stat` 瑕疵并转 `justified`** |
| :--- | :--- | :--- |
| **代码增删行数** | 删 `logFiles.ts` 内部写盘逻辑约 45 行，新增三通道 `resolvePathFn` / `archiveLogFn`（模拟 `.1.log`、`truncate` 与重印表头）/ 精确行格式器约 65 行 → **净增约 +20 行**（`logger` / `redact` / `diskSafeFailure` / `rendererLog` / `crashLog` 均无法删） | `logFiles.ts` 改内存计数替代逐行 `mkdirSync`+`statSync`（改 ~15 行），`diskSafeFailure.ts` 复用 `shared/vendorFailure` 删重复枚举（−6 行） → **净删约 10~15 行，零适配胶水** |
| **新依赖体积与打包门岗** | 新增运行时依赖 `electron-log@^5.4.4`（npm 解包 ~93 kB，虽然零传递依赖，但触发 `docs/engineering/package-budget.json` 全平台 `packages[]` 名单增长红灯，需人工签 `--allow-growth`） | **0 新增依赖**，`package.json` 与 `package-budget.json` 零膨胀 |
| **性能与崩溃可靠性** | 默认异步写流在 C++/DLL 原生崩溃瞬间会丢失最后一行 `logBreadcrumb`，仍需为崩溃道单配同步写或保留原同步写手（造成两套写手并存，违背 P1） | 3 条本地流继续共用单一 `createLogFileSink`，且内存缓存当前文件字节数后**每行日志减少 2 次主线程同步 `fs` 系统调用（−66%）**，原生崩溃前同步 `appendFileSync` 面包屑零妥协 |
| **对诊断包与一键反馈的影响** | **中高风险**：一旦 `electron-log` 升级微调时间/级别/多行栈拼接格式，`feedbackLogTail.ts` 会静默丢弃全部日志行，`stallTimeline.ts` 会把行计入 `droppedLines` | **零风险**：`nomi-YYYY-MM-DD(.1).log`、`nomi-crash.log`、`nomi-stall-timeline(.1).log` 文件名、首行构建表头与行级词法保持 100% 字节级兼容 |

**明确推荐：采用方案 B（不引入 `electron-log`，就地消除 `logFiles.ts` 每行重复同步 `mkdirSync`/`statSync` 与 `diskSafeFailure.ts` 重复枚举，将 `logging-and-crash` 转为精确 `justified`）**。这与本仓 `2026-09-06`（`docs/plan/2026-09-06-logging-and-diagnostics-bundle.md` §3）和 `2026-09-24` 两次 `R20` 实查结论完全一致，终结 `self-written.json` 初建时留下的「尚未下结论」悬案。

### 2.4 推荐方案（方案 B）对应的 `logging-and-crash` 完整 JSON 改写稿

> 说明：以下 JSON 块可直接替换 `docs/engineering/self-written.json:1567-1587`，已通过 `validateRegistry` 形状与路径存在性校验（`0` 错误、`0` 陈旧路径）。配套微修子单 `L-1`（`logFiles.ts` 内存字节计数免逐行 `mkdirSync`/`statSync` + `diskSafeFailure.ts` 复用 `shared/vendorFailure`）可与登记表更新同 PR 交付。

```json
    {
      "id": "logging-and-crash",
      "capability": "闭合类型运行日志、零自由文本错误指纹脱敏、受控渲染层失败限流上报与三层崩溃留证",
      "status": "justified",
      "plan": "docs/plan/2026-11-28-selfwritten-network-logging-review.md",
      "paths": [
        "electron/logging/",
        "electron/crashLog.ts"
      ],
      "alternativesChecked": [
        {
          "name": "Electron crashReporter（已直接用于采集原生层 C++/GPU/DLL Crashpad minidump）",
          "source": "https://www.electronjs.org/docs/latest/api/crash-reporter"
        },
        {
          "name": "electron-log v5（仅覆盖单代 .old.log 大小轮转；无按天保留期清理、无崩溃道就地清空与轮转后重印构建表头，且默认 IPC 转发绕过窗口守卫与按事件限流，强接反而净增适配代码与随包依赖）",
          "source": "https://github.com/megahertz/electron-log/blob/master/docs/transports/file.md"
        },
        {
          "name": "Pino redaction（仅按固定属性路径擦除结构字段，无法阻止任意包装层拼进 error.message 自由文本的上游回显密钥落盘）",
          "source": "https://github.com/pinojs/pino/blob/main/docs/redaction.md"
        },
        {
          "name": "Zod 3（已直接用于校验不可信渲染层日志 IPC 报文的封闭标量形状）",
          "source": "https://zod.dev/"
        }
      ],
      "whyNotIntegrated": "原生崩溃 minidump 直接交给 Electron crashReporter，渲染层报文结构校验交给 Zod，进程内文件重命名复用 jsonFile。自写部分仅服务于 Nomi 本地优先隐私承诺与桌面诊断闭环：（1）logger 以闭合模块域与纯标量签名在编译期封死提示词与请求体入口，并在打包态专门为 MCP stdio 宿主开放吞 EPIPE 的 stderr 诊断面；（2）diskSafeFailure 与 redact 将非自定错误原文一律转为 8 位哈希指纹、剥除栈帧本地目录与带空格项目路径，严守日志随诊断包和一键反馈出机不带用户内容与回显凭据；（3）rendererLog 在主进程边界执行发送窗口校验与按事件分钟分桶限流；（4）单一共享同步写手 logFiles 统一驱动按天日志（含 7 天清理与分片构建表头）、原生闪退前同步面包屑崩溃道与卡顿时间线，保证下游 feedbackLogTail 与 diagnosticsBundle 的严格行协议。",
      "revisitWhen": "Electron 官方内置带渲染层发送方鉴权、按天保留期及同步崩溃面包屑的结构化日志原语，或诊断包与一键反馈不再消费本地行式日志文件时重新评估。"
    }
```

---

## 三、拍板后建议执行顺序（独立小型 PR）

| 顺序 | 子单代号 | 动作摘要 | 是否需用户先拍板 | 预估净行数变化 |
| :---: | :---: | :--- | :---: | :--- |
| 1 | **`SM-net-1`** | 升 `undici` 至 `7.29.0`（对齐 Electron 43），`socks5://` 改走内置 `ProxyAgent`，删 `electron/socksDispatcher.ts` 并移除 `package.json` 的 `socks` 依赖；`socks4://` 明示 `unsupported` | **是**（确认 `socks4://` 边角不保留独立包与更新包预算） | **−68L**（卸 `socks` 包） |
| 2 | **`SM-net-2`** | `providerNetwork.ts` 与 `proxyProbe.ts` 迁入 `electron/catalog/`；清理 `networkOutboundPolicy.ts` 死参数分支与历史长文，`systemProxy.ts` 错误码提取收归 `networkErrorDetails` + `desktopT`；合入本文 §1.3 `network-stack` `justified` JSON | 随本报告一并拍板 | **−175~220L**（登记路径 10 → 7） |
| 3 | **`SM-log-1`** | `electron/logging/logFiles.ts` 改为切换文件时做一次 `mkdirSync`/`statSync` 并在内存维护字节计数（砍掉每行 2 次同步 `fs` 调用），`diskSafeFailure.ts` 改引 `electron/shared/vendorFailure.ts` 单源枚举；合入本文 §2.4 `logging-and-crash` `justified` JSON | 随本报告一并拍板 | **−10~15L**（每行日志 −66% 同步 `fs` 调用，0 新包） |
