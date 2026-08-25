# MCP/IPC 生命周期与边界加固（第 1 批：碰钱碰信任的真 bug）

日期：2026-08-25
分支：`claude/mcp-ipc-lifecycle-hardening`（worktree `/Users/aoqimin/Desktop/nomi-mcp-hardening`）
基线：`origin/main` = `0227eb19`
来源：PR #171 审计 `docs/audit/2026-08-25-app-wide-foundation-audit.md` §2「MCP 是真正的标准基础设施自研候选」

## 范围与不做项

**做**：A1 取消绑定在飞操作 / A2 协议版本交集协商 / A3 tools/call 运行时 schema 校验 / A4 stdio 行边界 /
B 付费确认并发绑定 / C IPC 回复 sender 绑定 / D IPC 注册入口 sender 绑定。

**明确不做**（owner 裁定，后续批次）：
- 引入 `@modelcontextprotocol/sdk` 接管 wire 层——需先 spike 验证；本批只让**行为**与标准一致，将来可平滑换。
- 画布/时间轴状态分离（第 3 批）。
- IPC `sendSync` 异步化（第 2 批）。

**避让**（并行 agent 的地盘）：`src/i18n/locales/*`、`generationCanvas/spend/anchorCheckpointView*`、
时间轴/画布采纳路径、`electron/productionRun/*` 的 proposal 部分。本批地盘：`electron/capabilityCore/*`、
`electron/preload.ts` 的 IPC 绑定区块、`rendererBridge.ts`。

## MCP 标准语义（Context7 实查，spec 2025-11-25 = 我们的 `PROTOCOL_VERSION`）

| 主题 | 规范原文要点 | 我们现状 |
|---|---|---|
| `notifications/cancelled` | 「stop processing the cancelled request, free associated resources, and **not send a response** for it」 | 无 id 的消息直接 `return`，通知从不解析 |
| 取消的错误处理 | 未知 requestId / 已完成 / 畸形通知 → **忽略**（保持 fire-and-forget，容忍竞态） | 不适用（根本没实现） |
| 取消的限制 | 客户端**禁止**取消 `initialize` | 不适用 |
| 版本协商 | 服务端回一个**自己支持**的版本；不兼容回 `-32602` + `data:{supported,requested}` | 原样回显客户端任意字符串 |
| tools/call 输入校验 | changelog 明写：「Input validation errors should now be returned as **Tool Execution Errors** rather than Protocol Errors」（便于模型自纠） | 无运行时校验，直接 cast |
| tools/call 未知工具 | Protocol Error `-32602` | 已符合 |

## 逐条：现状复核 / 根因 / 修法 / 对抗测试

### A1 取消不绑定在飞操作（最要紧，真金风险）

**现状复核**：`mcpProtocol.ts:330-333` `handle()` 开头 `if (id === undefined || id === null) return`——
所有通知（含 `notifications/cancelled`）在这里被丢掉。`mcpProtocol.ts:685-697` `handleIncoming` 只把
「对服务端请求的响应」按 id 路由，其余一律进 `handle`。`mcpStdioServer.ts:306-314` 断连只 `app.exit(0)`。

**根因**：**没有 request registry**——协议层不知道「此刻有哪些请求在飞、各自怎么中止」。取消语义、断连语义
都无处挂载。这不是「少写了一个 if」，是缺一层生命周期账本。

**修法**：新增 `mcpRequestRegistry.ts`（纯逻辑，可裸 node 测）：
- `begin(id)` → 登记 in-flight，返回 `AbortController` 句柄与 `finish()`。
- `cancel(requestId, reason)` → abort 对应 controller；未知/已完成 → **静默忽略**（规范要求）。
- `cancelAll(reason)` → stdio 断连时中止全部在飞。
- 被取消的请求**不回响应**（规范：not send a response）——`reply/replyError` 经 registry 判活，死了就不发。

`handle()` 改为：先解析通知（`notifications/cancelled` 走 registry.cancel，其余通知继续忽略），
再处理有 id 的请求。`initialize` 按规范不可取消 → registry 不登记它。

**「这类还能从别的入口出现吗」（P2）**：在飞路径共三条——① `transport.invoke`（tools/call 主路）、
② `sendServerRequest`（服务端→客户端 elicitation，自带 timer）、③ 进度心跳 `progress`。三条全挂 registry：
取消时 abort invoke、reject pending elicitation、stop progress。**已提交给供应商的不盲目重试/重复提交**——
abort 只切断我们这侧的等待，供应商侧任务经既有 reconcile 语义（`productionGenerationSubmission.poll/materialize`）
收敛，本批不新增重试路径。

**对抗测试**（`mcpRequestLifecycle.test.ts`）：
- `cancels an in-flight tool call and sends no response`
- `ignores cancellation for an unknown request id`
- `ignores cancellation for an already-completed request`
- `ignores a malformed cancellation notification`
- `refuses to cancel initialize per spec`
- `cancels every in-flight request when stdio disconnects`
- `does not resubmit provider work on cancel`（已提交 → 走 reconcile，不重发）

### A2 协议版本原样回显

**现状复核**：`mcpProtocol.ts:345-347`——`const negotiatedVersion = typeof requested === 'string' && requested ? requested : PROTOCOL_VERSION`。
客户端报 `"1.0.0"` 或 `"banana"`，我们照抄回去。

**根因**：把「兼容老客户端」实现成了「无条件顺从」，没有支持集合这个概念。注释里的担心（硬回偏好版本会让
老客户端断开）是真的，但正解是**交集**不是回显。

**修法**：`SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25','2025-06-18','2025-03-26','2024-11-05']`（降序）。
- 请求版本在支持集合内 → 回该版本。
- 不在集合内 → 回 `-32602` + `data:{ supported, requested }`（规范给的正是这个形状）。
- 缺省/非字符串 → 回我们的偏好版本 `PROTOCOL_VERSION`（规范：服务端回自己支持的版本）。

**对抗测试**（`mcpProtocolVersion.test.ts`）：`negotiates an exactly supported version` /
`falls back to preferred version when client omits it` / `rejects an unsupported version with -32602 and supported list` /
`rejects a non-string protocol version`。

### A3 tools/call 参数无运行时校验

**现状复核**：`mcpProtocol.ts:389` `const args = (params?.arguments as Record<string, unknown>) || {}`，
`mcpProtocol.ts:406` `const built = tool.build(args)`。目录里的 JSON Schema 只用于 `tools/list` 广播
（`mcpProtocol.ts:361`），从不参与校验。

**根因**：**schema 是广告，不是边界**。同一份 schema 对外声明契约、对内却没人执行 → 非法/缺失/未知字段
被 `build` 的 `a.foo` 取值吞成 `undefined`，一路默认值往下走。

**修法**：新增 `mcpArgValidation.ts`——把目录里那份 JSON Schema 当**唯一**校验源，在 `build` 之前执行。
**不引新库**（仓库已有 `zod@3.25`，但为每个工具再手写一份 zod schema = 第二份真相源，违反 P1）；
实现一个覆盖目录实际用到的 JSON Schema 子集的校验器。实扫两份目录（`mcpToolCatalog.ts` +
`mcpGenerationTools.ts`）得出的关键字全集只有 11 个：
`type / properties / required / items / enum / additionalProperties / minimum / maximum / maxItems / default / description`，
类型只有 `object / string / array / number / integer`。校验器**只认这些**，遇到不认识的关键字要
在自测里报出来（防止将来有人加了 `pattern` 却以为在校验）。

按规范（changelog 明写）校验失败回 **Tool Execution Error**（`isError:true` 的 result），
不是 `-32602`——让模型能自纠重试。走既有 `buildToolErrorOutcome` 漏斗，不另造错误文案体系。

**「这类还能从别的入口出现吗」（P2）**：`tools/call` 是工具参数进入能力核的**唯一**入口
（`resources/read` / `prompts/get` 各有自己的 uri 校验，已在 `productionArtifactResource` 做过）。
校验挂在 `handle` 的 tools/call 分支里、`build` 之前 → 24 个工具**一次全覆盖**，加新工具自动纳入。
另加一条**结构测试**：遍历整个 catalog，断言每个 inputSchema 只用白名单关键字 → 将来有人写了校验器不认识的
关键字，测试当场报红（不是等运行时静默放过）。

**对抗测试**（`mcpArgValidation.test.ts`）：`rejects a missing required argument` /
`rejects a wrong-typed argument` / `rejects an unknown field when additionalProperties is false` /
`rejects an out-of-range number` / `rejects a non-object arguments payload` /
`accepts a valid payload unchanged`（回归：校验不改写合法入参）/
`every catalog schema uses only supported keywords`（结构门）。

### A4 stdio 行处理

**现状复核**：`mcpStdioServer.ts:294-305`——`readline` 无 `maxLength`；非 JSON 行静默 `return`；
`rl.on('close')` 直接退进程。

**根因**：把 stdin 当可信输入。没有行长上限 → 一条超长行能把主进程内存吃满（本地 MCP 客户端行为异常
或被劫持时）；非法行静默丢弃 → 客户端永远等不到响应也不知道为什么。

**修法**：
- 行长上限 `MAX_LINE_BYTES = 4 MiB`（够装带 base64 参考图的 tools/call，又钉死上限）；超长行 → 丢弃并
  向 stderr 记一条，若能从中解析出 id 则回 `-32600`，否则静默（无 id 无从回）。
- 非 JSON 行 → 回 `-32700 Parse error`（JSON-RPC 标准码）而不是静默；无法定位 id 时按规范只记日志。
- 断连（`close`/`end`）→ 先 `registry.cancelAll('stdio disconnected')` 中止在飞，再关 preview server 退出。

**对抗测试**（`mcpStdioLine.test.ts`）：`rejects a line over the byte limit` /
`replies parse error for malformed json` / `ignores blank lines` /
`cancels in-flight work before exiting on disconnect`。

### B 付费确认的并发绑定

**现状复核**：`mcpGateConfirmation.ts:61,142-153` 已有 `generationConfirmationInFlight`，按
**challengeId** 去重（这条是好的，别推翻）。缺口在 `mcpProtocol.ts:503-541` 的 `nomi_generate` 付费路：
`spendTrust` 只按 **projectId** 记信任，`elicitBooleanConfirm` 没有任何 in-flight 绑定 → 两个首次付费请求
同时进来，双双发现 `isTrusted=false`，双双弹确认、双双放行。

**根因**：challenge 与 request **不是一一绑定的**——`mcpGateConfirmation` 那层绑了（按 challengeId），
而 `nomi_generate` 这条更常走的路**根本没有 challenge 概念**，只有一个项目级布尔信任。并发窗口 =
「第一次 elicit 发出」到「trust 落账」之间。

**修法**：**接在既有的家里**（P1 不造第二套）——把 `mcpGateConfirmation.ts` 里那套「同 key 共享一个
in-flight promise」的模式提取成 `mcpConfirmationBinding.ts`，两处共用：
- 生成门继续按 `challengeId` 绑（行为不变）。
- `nomi_generate` 付费路按 `projectId` 绑：并发第二个**排队**等第一个的确认结果（不是各弹各的）。
  第一个 accept → 第二个走已建立的信任放行；第一个 decline → 第二个拿到明确拒绝，**不弹第二张卡**。

**绝不能出现一次确认放行两笔生成**：排队者复用的是「信任状态」而非「那一次确认」——第一个确认落账后，
第二个仍逐次经主进程 `assertAndConsumeSpendGrant` 铸/校验自己的令牌（硬闸不变）。语义是
「一次确认建立一段会话信任，信任内每笔仍逐笔铸令牌」，与用户在确认卡上看到的授权范围文案一致。

**对抗测试**（`mcpSpendConcurrency.test.ts`）：`two concurrent first-time paid requests elicit exactly once` /
`the queued request is refused when the first declines` /
`each admitted generation still mints its own spend grant` /
`a decline does not establish session trust`。

### C IPC 回复的 sender 绑定

**现状复核**：`rendererBridge.ts:51-62` `ipcMain.on(CAPABILITY_APPLY_REPLY_CHANNEL, (_event, payload) => ...)`
——`_event` 整个被丢弃，只按 `payload.id` 找 pending。`preload.ts:602-620` 回复时也只带 id。

**根因**：**回复通道没有身份**。请求明明是定向发给 `target` webContents 的（`rendererBridge.ts:82`），
回来时却接受任何 renderer/frame 的同 id 回复。付费确认的 `confirmed:true` 正是走这条桥
（文件头注释第 10-11 行把它当信任边界），所以这是信任缺口不是洁癖。

**修法**：
- `pending` 条目记下发出时的 `webContentsId` 与 `frameId`。
- reply 监听器改用 `event`：校验 `event.sender.id === entry.webContentsId` 且
  `event.senderFrame` 的 `routingId`/`origin` 与登记一致；不匹配 → **丢弃并记一条 stderr**，
  绝不 resolve/reject（否则伪造者能把真请求打成失败 = 拒绝服务）。
- `rendererTargetIdentity()` 已经给出 `{webContentsId, frameId, origin}` 的形状，沿用它做真相源，不另立。

**「这类还能从别的入口出现吗」（P2）**：`ipcMain.on` 全仓实扫，凡「主进程发起、渲染层回复」的配对通道
都要绑 sender。本批扫出并修 `nomi:capability:apply-reply` 这一条；扫描结论写进本文档「实扫结论」一节。

## 实扫结论（P2 通用性判定）

全仓扫描 `ipcMain.on` / `ipcMain.handle` 后，本批涉及的「主进程发起、渲染层回复」配对只有
`electron/capabilityCore/rendererBridge.ts:78` 的 `nomi:capability:apply-reply`；其余命中是渲染层上报、
浏览器视图控制或单向事件，没有按请求 id 接受 renderer 结果的同类信任边界。该配对现在按
`event.sender.id`、`event.senderFrame.routingId`、`event.senderFrame.url` 的 origin 三项同时校验，
不匹配只记录并丢弃。stdio 入口同时覆盖 Electron server (`mcpStdioServer.ts:309`) 与 bare-Node
launcher (`mcpNodeLauncher.ts:263`)，共享 `mcpStdioLine.ts` 的 4 MiB UTF-8 行界限和 parse-error 语义。

实施后对抗测试落在：`mcpRequestLifecycle.test.ts`（伪造/完成取消、initialize 不可取消、版本不兼容）、
`mcpSpendConcurrency.test.ts`（并发首次付费确认只弹一次、拒绝共享结果、每笔独立 signal/grant 路）、
`mcpArgValidation.test.ts`（缺失/类型/未知字段/范围/目录结构门）以及 `mcpStdioLine.test.ts`
（非法、超长、空行、UTF-8 字节计数）。

## 本次阻断修复（PR #174 follow-up）

### D IPC sender/origin 威胁模型与修法

全仓实扫 `electron/` 的 `ipcMain.handle/on`：共 173 个注册点，其中 35 个显式以 `_event` 忽略来源。
主窗口只从本地 `file://` 入口（生产）或受控 Vite `http://localhost` 入口（开发）加载，并在
`main.ts:329-333` 拦截离开入口的顶层导航；没有 `<webview>`，但应用内 BrowserView/WebContentsView
确实会加载用户指定的远端网页（`electron/browser/core/browserViews.ts:242-257,282-285`），且辅助菜单/覆盖窗
也带 preload。因此「非受信渲染帧」在产品结构上**可达**，只是当前 BrowserView 没有主窗口 preload、且
浏览器通道按 owner/viewId 做了额外关联；它不能被当作主窗口身份。严重度按本地桌面攻击面记为高（远端页面
本身不应获得 Nomi 主 IPC 权限），不是把远端网页误报成可直接调用所有 Nomi 通道。

根因是 IPC 注册点没有共享的 sender 身份断言：同一进程内只要拿到任一带 preload 的 WebContents，就可能
触达 `_event` 被丢掉的权限/真金路径。新增 `electron/ipcSenderGuard.ts` 的 `assertTrustedSender(event)`：
要求 `BrowserWindow.fromWebContents(event.sender)` 恰为 `mainWindowRegistry` 登记的主窗口、sender 为主
webContents、frame 为主 frame，且 origin 与主窗口当前 URL 一致。`nomi:tasks:grant-spend` 与
`nomi:capability:active-project` 接入该守卫；另将同一真金入口的任务提交 `nomi:tasks:run` 绑定，避免
守卫只保护铸令牌而放过相邻入口。

新增 `scripts/check-ipc-sender-binding.mjs` + `scripts/ipc-sender-binding-baseline.json`，扫描所有
`ipcMain.handle/on` 注册点，记录未调用 `assertTrustedSender` 的存量并只允许下降；挂入 `pnpm run gates`。
R17 验证记录：先在临时分支工作树向 `electron/main.ts` 注入一个未设防 handler，门岗输出新增 1 处并以
非零码退出（实录：`174 registrations; 4 guarded; 170 unguarded (baseline 169)`，`exit=1`）；随后立即
撤销临时行，正式 baseline 只记录当前存量，避免把故意测试代码带入提交。清理后实录：
`173 registrations; 4 guarded; 169 unguarded (baseline 169)`，`exit=0`。

### B 空 projectId 并发绑定

`mcpConfirmationBinding.run` 原先对空 key 直接执行 task，导致两个没有可用 projectId 的并发请求不进账本。
本次选择更根因的第二种修法：schema 仍要求字段存在（但空字符串是合法 string），因此由协议层把空 projectId
映射为**每次调用唯一匿名 key**（`__anonymous__:<sequence>`），任何请求都经过 binding；空 key 不共享确认，也不会把某次
确认误绑定到另一个项目。`mcpSpendConcurrency.test.ts` 新增空 projectId 并发回归：两个确认面各自出现、各自
批准后各自进入生成，且不再走 `if (!key) return task()` 逃生口。先红后绿记录：新增回归前
`pnpm vitest run electron/capabilityCore/mcpSpendConcurrency.test.ts` 在空 key 账本断言处以
`expected 0 to be 2` 失败；实现匿名 key 后同命令 `4 tests passed`。

## 回滚

每条独立 commit，互不依赖：
- A1/A4 回滚 = 删 `mcpRequestRegistry.ts` + 恢复 `handle()` 开头两行与 `rl.on('line')`。
- A2 回滚 = 恢复 `negotiatedVersion` 那一行。
- A3 回滚 = 删 `mcpArgValidation.ts` + 去掉 `build` 前那次调用。
- B 回滚 = 恢复 `mcpGateConfirmation.ts` 原文件 + 去掉付费路的绑定调用。
- C 回滚 = 恢复 `rendererBridge.ts` 的 `_event` 签名。

数据面无 schema 变更、无迁移、无持久化格式改动 → 回滚不需要转换任何用户快照。

## 验收门

`check:filesize` → `check:tokens` → `check:i18n` → `check:heavy-path` → `check:test-waits` →
`lint:ci` → `typecheck` → `test` → `build`，逐条真退出码（**不接管道**，见记忆
`piped-test-runs-mask-exit-codes`）。另：本批全是主进程协议/IPC 层，无用户可见 UI 改动 → 不涉 R8 样张；
R13 走查由既有 MCP e2e 覆盖。
