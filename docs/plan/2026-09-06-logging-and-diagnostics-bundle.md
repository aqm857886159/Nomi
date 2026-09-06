# 日志与诊断包方案

> 日期：2026-09-06 · 状态：🚧 实现中 · 独立实现轨：`feat/logging-diagnostics-20260906`
> 来源：2026-09-06 日志体系盘点（`docs/…/program-agent-audit-and-real-usecases-20260906` 记录的「无统一落盘日志」结论）+ 本轨 Context7/web 实查。

## 1. 先说用户要解决的摩擦（D6）

**背后逻辑。** 用户在群里说「导出失败了」「模型调不通」时，我们手上什么都没有。今天主进程里 99 处 `console.error/warn` 只写进 stdout——开发时终端能看到，打包成 `.app` 双击启动后**没有任何地方接住它**，进程一退就没了。唯一留在盘上的东西是崩溃日志（`nomi-crash.log`）：它只在崩溃时写，而绝大多数用户报的问题**根本不崩溃**，只是"这一步没成"。于是每次远程排查都从「你能不能重现一下」开始，用户要为我们的盲区付出时间。

**具体例子。** 2026-08-12 Windows 上改保存名闪退那次，手上零信息，只能靠猜；后来补了 `crashLog.ts` 三层证据才定位。而"KIE 调用一直 402"这类不崩溃的失败，至今还是零证据——供应商回了什么状态码、耗时多久、重试几次，全都写进了没人接的 stdout。

**用户要权衡的那一件事：** 留下足够排查的证据，和"日志本身不能变成新的隐私泄漏面"。这两件事天然对立——最有用的日志（提示词长什么样、素材在哪个路径、用的哪把 key）恰好是最不能记的。

**本方案的取法：** 日志**只记结构化的运行事实**（哪个模块、什么事件、成功还是失败、多久、供应商回了几），**永不接受**提示词/密钥/绝对路径作为参数——不是"写进去以后再擦掉"，而是这些东西压根没有能通过的参数位（R28：防线建在最早能拦住的那层）。用户想把证据给我们时，设置里一个按钮打成 zip，**保存到他自己选的位置**，我们不自动上传任何东西。

**陌生概念说明。**
- 「按天滚动」= 每天一个日志文件（`nomi-2026-09-06.log`），旧的过期自动删。不是无限增长的一个大文件。
- 「诊断包」= 一个 zip，里面是日志 + 脱敏后的模型目录 + 当前项目的 Agent 命令账本 + 制作收据 + 版本/系统信息。**用户自己保存、自己决定发不发给我们**，不联网。

## 2. 现状盘点（证据）

| 现有可追踪物 | 位置 | 覆盖什么 | 盲区 |
|---|---|---|---|
| `nomi-crash.log` | `electron/crashLog.ts:20` → `app.getPath("logs")` | JS 未捕获异常、渲染/子进程死亡、原生崩溃面包屑 | **只在崩溃时写**；不崩的失败零记录 |
| Crashpad minidump | `crashDumps`（`crashLog.ts:startNativeCrashCapture`） | 原生崩溃模块名 | 同上 |
| Agent 命令账本 | `project-agent-host/<项目>/commands-v1.jsonl`（`projectAgentRepository.ts:356`） | Agent 命令流水 | 只覆盖 Agent 一条路径 |
| productionRun 收据 | `<项目>/.nomi/runs/<runId>/run.json` 等（`productionRunPaths.ts:13`） | 制作运行状态机 | 只覆盖制作运行 |
| 导出任务 store | `electron/export/exportJobStore.ts:17` 的 `export.log` | 单个导出任务 | 在项目临时目录里，用户找不到 |
| 项目内播放事件 | `src/media/videoPlaybackTelemetry.ts` | 播放器状态 | 渲染层、进项目事件 |
| 频率遥测（#522） | `electron/telemetry/` | 白名单计数，默认关 | **刻意**不含任何诊断细节 |
| **99 处 `console.error/warn/log`** | `electron/**`（35 个文件，`main.ts` 独占 18 处） | —— | **打包后全丢** |

结论：缺的正是「不崩溃的失败」这一档，而它占用户报障的绝大多数。

## 3. R20 build-vs-buy 闸

### 三问一：这是通用问题吗？

**是。** 「结构化日志落盘 + 按天/按大小滚动 + 保留期」是通用基础设施，不是 Nomi 的护城河。

### 三问二：同类产品怎么做？（Context7 + web 实查，2026-09-06）

| 现役方案 | 实查到的能力 | 出处 |
|---|---|---|
| **electron-log v5** | Electron 生态事实标准，零依赖。`transports.file.maxSize`（默认 1MB）→ 超限**改名成 `.old.log`**；`resolvePathFn(variables, message)` 可自定路径；`hooks` 可按 transport 拦截/改写单条消息；`transforms` 可改数据；`archiveLogFn` 在滚动时回调 | Context7 `/megahertz/electron-log`（`docs/transports/file.md`、`docs/extend.md`）+ npm/GitHub |
| electron-log-rotate | **已 deprecated**，作者自己标注不再推荐 | GitHub hisasann/electron-log-rotate |
| VS Code | 自写 logService（多 transport、按天目录），但那是编辑器规模的自有需求 | —— |

### 三问三：在护城河上吗？如何取舍

**不在护城河上。** 按 R20，不在护城河上又碰信任的应当用标准实现——所以 electron-log 是**默认选项**，需要有具体理由才不用。逐条对着我们的三条真实需求核：

| 需求 | electron-log 给什么 | 差多少 |
|---|---|---|
| **按天滚动 + 保留期** | 只有 `maxSize` → `.old.log` 这一种滚动模型。按天要自己写 `resolvePathFn` 返回带日期的名字；**过期清理它不做**（`archiveLogFn` 只在按大小滚动时触发） | 保留期那段代码我们照样得写 |
| **大小上限** | ✅ 原生 | 0 |
| **脱敏（不记提示词/key/路径）** | `hooks` 能按内容拦截，但那是**事后按串匹配**——提示词长什么样没有可匹配的特征 | 真正的防线是我们自己的**类型化 API**（下节），它不提供 |

**决定：不引入 electron-log，写一个共享文件写手。** 三条理由，按权重：

1. **P1 单一实现。** 仓库里**已经有**一份经过实战、带注释、有单测的同步落盘 + 滚动写手（`electron/crashLog.ts:38-58`），而它**不能**换成 electron-log：崩溃面包屑的整个价值在于「进程被原生崩溃带走的前一刻那行已经落盘」，必须 `appendFileSync`、必须不依赖任何可能自己抛错的第三方（该文件注释已写明这条约束）。引入 electron-log 的结局是仓库里**两个文件写手 + 两套滚动策略**——正是 P1 要禁的并行版。正解是把已有的那份**提炼成共享原语**，两条日志道（崩溃道 / 通用道）共用一份滚动实现。
2. **真正的信任边界不在写手层。** 「不记提示词/key/路径」这件事，任何写手库都帮不上——它必须是**调用方够不着**：logger 的公开 API 只收 `scope + event + 受限字段表`，供应商调用只收一个六字段的结构体。一个想记提示词的调用点，**在类型层就没有参数位**（R28）。这一层是我们自己的，无论用不用 electron-log 都要写。
3. **成本对称。** 抵掉上面两条后，electron-log 净剩的价值 = 「别人维护的 appendFile + rename」，约 60 行；而代价是打包体积里多一个运行时依赖 + 它默认的 console transport / `initialize()` 的渲染层 IPC 转发（会绕过本仓 `assertTrustedSender` 的 IPC 闸，且可能把渲染层任意 console 内容——含提示词——转进日志）必须逐条关掉。

**诚实标注取舍代价：** 我们自己拥有了 EACCES / 磁盘满 / Windows 文件锁这些边界。缓解：所有写路径 try/catch 吞掉（丢一行日志绝不能拖垮 app，`crashLog.ts` 已是这个纪律），并有单测钉住滚动与保留期。

## 4. 方案

### 4.1 防线在哪一层（PR 描述要写清的那件事）

```
       用户可见                     ┌─ 设置「隐私与诊断」→ 导出诊断包（用户自己选保存位置，不联网）
                                    │
  ─────────────────────────────────┼───────────────────────────────────────────────
       类型层（编译期）             │  logger 的 API 不接受提示词/key/路径
         electron/logging/logger.ts │  · fields: Record<string, string|number|boolean|null>
                                    │  · 供应商调用只收 VendorCallSummary 六字段
  ─────────────────────────────────┼───────────────────────────────────────────────
       值层（运行期·第二道网）      │  redactLogValue()：绝对路径/URL query/密钥形/超长值 → 占位符
         electron/logging/redact.ts │  字段名黑名单（prompt/apiKey/path/…）→ <omitted:key>
  ─────────────────────────────────┼───────────────────────────────────────────────
       门岗（每次 push）            │  check:main-console —— electron/ 里新增 console.* 当场红
         scripts/check-main-console │  （硬零；今天 99 处在本 PR 内一次清干净）
  ─────────────────────────────────┼───────────────────────────────────────────────
       写手（单一实现）             │  electron/logging/logFiles.ts
                                    │  崩溃道（nomi-crash.log，truncate）与通用道
                                    │  （nomi-YYYY-MM-DD.log，archive + 保留期）共用
```

### 4.2 模块

```
electron/logging/
  logFiles.ts   共享文件写手：同步 append、会话表头、大小上限滚动、按天文件名、保留期清理
  redact.ts     值级脱敏 + 字段名黑名单
  logger.ts     唯一出口：logInfo / logWarn / logError / logVendorCall
electron/diagnostics/
  diagnosticsBundle.ts   组包（fflate zipSync，仓库已有依赖）+ 清单
  catalogRedaction.ts    模型目录脱敏（key/customConfig/networkConfig/URL 内嵌凭据）
  diagnosticsIpc.ts      IPC + showSaveDialog（单参数形态，见 nativeDialogParent 不变量）
electron/shared/contracts/diagnostics.ts   契约类型（渲染层只依赖这里）
src/workbench/settings/DiagnosticsBundleSection.tsx   「隐私与诊断」里的导出行
```

`crashLog.ts` 的 `append` 改为调用 `logFiles.ts` 的共享原语（行为逐字不变：2MB、truncate、会话表头），并把它自己那句 `console.error` 换成 logger——这是 P1 的删旧那一半。

### 4.3 日志格式与内容

一行一条，可 grep：

```
[2026-09-06T04:21:33.412Z] INFO  vendor        call vendor=apimart model=seedance-1-0 status=200 ms=1843 cost=0.3200 req=8f2a…
[2026-09-06T04:21:35.001Z] ERROR export        ffmpeg-exit code=1 jobId=exp_17… stage=concat
```

- 文件：`app.getPath("logs")/nomi-YYYY-MM-DD.log`；单文件上限 4MB，超限改名 `nomi-YYYY-MM-DD.1.log`（只留一代）；保留 7 天，跨天首次写入时清理过期文件。
- 每个文件首行写会话表头（Nomi 版本 / Electron 版本 / 平台 / pid），沿用 `crashLog.ts` 的理由：滚动后半段日志也要能归属到构建。
- **供应商调用只记摘要**：`vendor / model / status / ms / cost / requestId`。请求体、响应体、提示词、素材 URL 一律不进。

### 4.4 诊断包内容

| 条目 | 来源 | 脱敏 |
|---|---|---|
| `manifest.json` | 本模块 | 含 schema 版本、生成时间、Nomi/Electron/Node/Chrome 版本、平台、条目清单与字节数、**被排除的东西与原因** |
| `system.json` | `os` | 系统版本、架构、内存、时区、语言 |
| `logs/nomi-*.log` | 保留期内的通用日志 | 写入时已脱敏 |
| `logs/nomi-crash.log` | 崩溃道 | 栈里的绝对路径脱敏 |
| `model-catalog.json` | `getSettingsRoot()/model-catalog.json` | **key 字段整段替换**为 `"<redacted>"`；`customConfig` / `networkConfig` 同；vendor baseUrl 保留（排查必需）但剥掉内嵌 `user:pass@` |
| `project/commands-v1.jsonl` | 当前项目的 Agent 命令账本 | 原样（用户主动导出到自己盘上的自有数据；清单里显式声明它含创作内容） |
| `project/runs/<runId>/run.json` | 制作运行收据快照 | 只取 `run.json`，不取 brief/script/storyboard 等提示词产物 |

总大小上限 25MB，超限时按「日志由新到旧」截断并在清单里记明。

### 4.5 不做项

- 不自动上传、不联网、不接遥测端点（遥测是 #522 那条独立的白名单频率道，两者不共用管道）。
- 不收口渲染层 `console.*`（渲染层日志会天然带上用户输入；本轨只收口主进程）。
- 不改 Crashpad / minidump 采集。

## 5. 验收门

- 单测：脱敏（key / 提示词 / 绝对路径不出现在输出里，含错误栈路径）、按天滚动、大小上限、保留期清理、诊断包清单与目录脱敏。
- 门岗：新增 `check:main-console`（硬零，先验它会红——R17）；现有 `gates:contracts` 全绿。
- 走查：`tests/ux/diagnostics-bundle.walk.mjs` 真 Electron 打开设置 → 隐私与诊断 → 导出 → 用 fflate 解开 zip 断言条目齐全且不含密钥串。`showSaveDialog` 由 Playwright 在主进程侧打桩（`app.evaluate`），**不在生产代码里留 E2E 逃生口**。
- i18n：`zh-CN` + `en` 同步。
- 设计实验室：新增 `settings` 屏，登记本格；基线**待用户拍板**（`calibration.json` 的 `pendingApprovalScreens`），本轨不跑 `--update`。

## 5.1 走查实测抓到的两件事（2026-09-06，真 Electron）

第一次跑 `tests/ux/diagnostics-bundle.walk.mjs`，「包里不许出现本机绝对路径」当场红——而且泄漏来自
**另一个 worktree** 的崩溃栈。两条根因，各自修在自己的层：

1. **崩溃日志没走脱敏。** `crashLog.ts` 从前把原始栈整段落盘（`/Users/<人名>/…`）。它过去只是本机黑匣子，
   没人往外发；现在它进诊断包了。→ `recordCrash` / `logBreadcrumb` 改走 `logging/redact`，
   帧里只留「文件名:行:列」。**一条脱敏规则管住所有我们写出去的字**。
2. **日志没跟着 profile 走。** macOS 的 `app.getPath("logs")` 是 `~/Library/Logs/<app>`，**不随 userData 变**——
   于是这台机器上每个实例（正装的、dev 的、E2E 的、20 多个 worktree 的）都往同一个文件里写。
   → `main.ts` 在重定向 userData 时同时 `app.setPath("logs", <profile>/logs)`，并把这段挪到
   `installMainProcessLifecycle` **之前**（晚一步，这次会话的表头就落进被隔离掉的那个目录了）。
   正常安装的用户没有那个 env，路径与从前逐字一致。

这两条都不是单测能发现的：单测喂的是自己造的临时目录，永远"干净"。

## 6. 回滚

单向新增 + 一次性 `console.*` 替换。回滚 = revert 本 PR；`crashLog.ts` 的行为在本 PR 内保持逐字不变，回滚不影响崩溃证据链。
