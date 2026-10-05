# MCP 重做：协议层换官方 SDK v2（设计卡 + 分段计划）

线：L-mcp　类别：[花钱][长跑][可打断][新界面]（新界面在第 3、4 段：现有「AI 助手连接」卡上的迁移提示与连接状态，已有用户拍板的画布）
用户 10-05 拍板（不再讨论）：重做协议层换官方 SDK；连接改本机地址直连（Streamable HTTP，只绑 127.0.0.1，校验 Host / Origin，带口令），Claude Desktop 留很薄的 stdio→HTTP 转发口；老用户迁移弹一句、点同意才改宿主配置并留备份，旧 stdio 启动器再留一个版本当转发器。协调会话定：SDK 用 v2（`@modelcontextprotocol/server`，2026-07-28 协议），新旧两版协议都兼容，确认旧宿主不退化之后再放开新协议。

按段推进。本卡覆盖全部五段；第 0、1 段已合入（#1011），第 2 段已实现未推送（分支 `feat/mcp-local-http`），第 3、4 段是计划。

## 设计卡（9 格）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在 Codex / Claude Code / Cursor / Claude Desktop 里让 AI 驱动 Nomi（读项目、改画布、起制作、付费前确认），我想连接稳、能跟上新版协议、换了宿主也不用重配，以便不必懂 MCP 也能把活交给 AI。真实任务：①Codex 里「把这段剧本做成分镜并出第一镜」：`nomi_session_open` → `nomi_operation_plan` → `nomi_operation_gate phase=request`（在 Codex 里弹付费确认）→ 出图；②Claude Code 里接一家中转模型：`nomi_model_setup action=connect_provider` → 宿主打开本机填写页（url 模式 elicitation）→ 保存后继续；③Claude Desktop 里起一个制作 Run，在对话里看活面板（MCP Apps widget）。**不做**：本 PR 不改工具面（tools/list 字节不变）、不改审批语义、不改「被动请求不拉起 Nomi」的规则；第 0–1 段不改连接方式。**已知坑**：2026-07-28 协议没有服务端推送式 elicitation，审批要先改成 input_required 才能放开新协议（见第 2 段）；Claude Desktop 只认 stdio。 | `electron/capabilityCore/mcpWireContract.test.ts`；三条真实任务第 2/3 段用真宿主走 |
| ★2 谁说了算 | 协议本身（握手、版本协商、JSON-RPC 路由、请求 id 关联、取消、断连中止、stdio 分帧、参数校验引擎）→ 官方 SDK `Server`。Nomi 只剩三件：①`createNomiMcpServer`（`mcpProtocol.ts`）在 SDK `Server` 上注册各方法的处理器，tools/call 里接审批与领域投影；②`guardMcpTransport` 在任何传输的入口拒未验证客户端、并在 SDK 校验请求之前跑工具的参数容忍钩子；③领域层（下方「保留的 Nomi 领域层」）。`createMcpProtocol` 只剩进程内连接（同一个 Server 经 SDK 的 `InMemoryTransport`），给单测与门岗脚本用。概念：`mcp.passive-discovery`（owner 由 `createMcpProtocol` 改为 `createNomiMcpServer`，`docs/engineering/concept-owners.json` 已改）、`mcp.live-instance-forwarding`（不碰）。碰 1 个概念 | `node scripts/door-map.mjs createMcpProtocol`（换前）：2 扇写门（`mcpStdioServer.ts`、`mcpNodeLauncher.ts`）；换后两扇都是同一句 `createNomiMcpServer(host).connect(new StdioServerTransport())`，`check:transport-assembly` 改为比对 `McpHost` 的可选成员 |
| ★3 一致与复用 | 删掉手写：`mcpStdioLine.ts`（分帧）、`mcpArgValidation.ts`（Ajv 校验器）、`mcpRequestRegistry.ts`（在飞账本）、`mcpProtocol.ts` 里的握手 / 版本协商 / 路由 / 服务端请求关联 / 取消 / 回响应。改用 SDK：`Server`、`StdioServerTransport`、`InMemoryTransport`、`fromJsonSchema`（SDK 自带 AJV）、`Server.request`、`ctx.mcpReq.signal / notify`。**`mcpTransportSchemaFromZod.ts` 不删**（与任务书不同，见下「偏离任务书的两处」）：它是领域投影（zod v3 契约 → 对外 JSON Schema 的扁平超集），内部 Agent 那一侧也照它做，SDK 只能转换 zod v4，且转出来字节必变 | `check:self-written`；`git grep -n "mcpArgValidation\|mcpStdioLine\|mcpRequestRegistry" -- electron scripts tests` 为空 |
| ★4 全状态 | 外部 AI 侧（无 Nomi 界面）：握手成功 / 版本不支持（SDK 改为回退到我们支持的最高版本，不再报错）/ 未授权（-32001 + `mcp_connection_unauthenticated`）/ 参数错（工具级 `isError` + `capability_input_invalid`）/ 领域错（工具级错误，人话 + 恢复动作，zh/en 跟 App 语言）/ 等待确认（客户端弹框）/ 拒绝或超时（不派发、`human_approval_required`）/ 取消中（停在途工作、不回响应）/ 断连（全部中止）。新界面（第 3、4 段）以用户已拍板的画布为准，要点见文末 | 特征测试 38 条；文案全在既有领域文件里，未新增 |
| 5 中途表 | 见下表 | 特征测试「进度与取消」「付费审批」两组 |
| 6 外部数据与失败 | 外部来源：①宿主发来的帧（不可信）→ SDK 按规范 schema 校验，畸形帧 SDK 回错误；②协议规范 2025-11-25 / 2026-07-28；③SDK 版本漂移 → 精确钉 `2.3.0`，不跟 `^`。偏差：我们仍只协商 2025 家族四个版本（不含 SDK 默认里的 2024-10-07，也暂不含 2026-07-28）。失败时宿主看到规范错误码，不会把锅甩给用户的 key | 规范 https://modelcontextprotocol.io/specification/2025-11-25 ；SDK https://ts.sdk.modelcontextprotocol.io/v2/ |
| 7 性能预算 | tools/list 约 51 KB（zh 51438 B / en 51482 B，换前换后逐字节相同、sha256 相同）；SDK 冷加载 ≈160 ms（`require('@modelcontextprotocol/server')` 三次实测 157–166 ms，启动器每次被宿主拉起多这么多）；参数校验由每个工具首次调用时编译一次 AJV，之后复用。包体见下「包体增量」 | 本机 `node -e` 实测；`check:mcp-payload` |
| 8 真实条件 | Windows：vitest 全绿（含 stdio 管道连接器）；编译后的 CommonJS 启动器 `mcpNodeLauncher.js` 在临时 HOME / 临时 capability 目录下走真 stdio：未验证身份回 -32001、验证后 initialize / tools/list / resources/list / 未知工具 / ping 都对，stdin 关闭即退出码 0，没有拉起 Nomi。真宿主（Codex / Claude Code / Cursor / Claude Desktop）握手与付费确认：`unverified`，第 2 段完工后在用户不用电脑时走；Linux CI 的 `test:mcp-journey`（真 Electron stdio）本机不跑（会起 Electron），靠 CI；打包冒烟靠 desktop-rc | 本卡「已验证 / 未验证」 |
| ★9 验收与回滚 | 验收：另一条线跑 `pnpm exec vitest run electron/capabilityCore/mcpWireContract.test.ts`（在第 0 段提交 `3cff1817d` 上对旧实现、在第 1 段提交上对 SDK 实现各跑一遍），再跑全部 MCP 单测与 `check:mcp-payload` / `check:tool-face` / `check:model-face-frozen` / `check:mcp-tool-refs` / `check:mcp-scope-reachable` / `check:mcp-operation-constructible` / `check:skill-tool-binding`；对比第 0 段提交（旧实现）与第 1 段提交（SDK）上同一组特征测试都绿。回滚：revert 第 1 段提交即回到手写协议层（第 0 段的特征测试仍对旧实现绿），无数据迁移 | PR `## 独立验收` |

### 中途表（外部 AI 的一次调用；末尾四行是第 2 段本机 HTTP 增补）

| 状态 | 用户关宿主 / 断连 | 宿主发 cancel | Nomi 被关 | 断网 | 连点（同一挑战重复确认） |
|---|---|---|---|---|---|
| 握手 / 列表（被动） | 进程退出，无副作用 · 不扣 · 无回执 | 规范禁止取消 initialize；其余忽略 | 不拉起 Nomi，照常只读回答 · 不扣 | 本机，不受影响 | 不适用 |
| 普通写（画布 / 文稿） | SDK 关连接时中止在途信号，写操作由领域侧按信号收尾 · 不扣 | 中止，**不回响应** · 不扣 | 转发失败如实报错 · 不扣 | 不受影响 | 各自独立执行 |
| 等待确认（elicitation 在客户端弹着） | 中止，未确认 = 未派发 · 不扣 | 中止；SDK 顺带向客户端发 cancelled 收起弹框 · 不扣 | 客户端仍可答，但兜底卡不可用 → 未确认 · 不扣 | 不受影响 | 同一 challengeId 只出一个确认面（`mcpConfirmationBinding`） |
| 付费生成已提交（start 之后） | 中止的是我们这侧的等待；已提交给供应商的任务走既有对账收敛，**不重提** · 以供应商为准 | 同左 | 同左 | 同左 | 回执在 Nomi 制作记录里 |
| 接模型等填写页（url 模式） | 轮询停止；会话停在 `needs_credential`，应用内路线仍在 · 不扣 | 同左 | 下次继续时重开 | 不受影响 | 一张一次性票，用掉即剥 |
| HTTP · 宿主正常退出（发 DELETE） | 会话关闭，SDK 中止这条会话全部在途调用（与 stdio 断连同一语义）· 不扣 | 只取消那一条，不回响应 · 不扣 | — | — | — |
| HTTP · 宿主断线但没发 DELETE（崩溃 / 拔网线式退出） | 规范 2025-11-25：断线**不等于**取消。在途调用跑完、结果没人收；**等确认那一种**（付费门 / 删除 / 文稿）5 分钟超时按未确认处理，不派发 · 不扣。会话挂着直到被挤掉（上限 32 条，挤最久没动静的）或 Nomi 退出 | 宿主重连后发 cancel 仍有效（同一会话号） | — | — | — |
| HTTP · Nomi 被关 / 重启 | 端点没了：宿主下一次请求连不上，按宿主自己的重连逻辑；Nomi 重启后旧会话号失效（404），宿主重新握手。退出时 SDK 中止全部在途调用 · 已提交给供应商的走对账，不重提 | — | 关窗口即关服务 | 本机，不受影响 | — |
| Desktop 转发口 · Nomi 没开 | 每个请求立刻回一帧「连不上 Nomi：请先打开 Nomi 再试」，不冷启动、不干等 · 不扣 | 原样转给 Nomi | 同左 | 本机 | 原样转发，由 Nomi 那边去重 |

## 偏离任务书的两处（请协调会话确认）

1. **工具不走 `registerTool`，走 SDK 的低层处理器**（`Server.setRequestHandler('tools/list' | 'tools/call')`）；资源与提示同理。理由（都是领域约束，不是图省事）：
   - Nomi 的目录是**活的**：剧本流程（playbook）注册、能力适配器注册都会改工具描述与枚举；技能资源 / 提示每次都从活实例读。`registerTool` 是静态登记，用它就得自己再写一套「目录变化 → update / remove / 重新登记」的同步机，比它要替代的代码还多。
   - 工具标题按 App 当前语言每次现算（zh / en），`registerTool` 的标题是登记时的定值。
   - 参数容忍钩子（`prepareArguments`，例如把二次序列化的 JSON 文本还原成数组）必须在校验**之前**跑；SDK 的高层 `tools/call` 先校验后进处理器，钩子没处放。
   - 付费审批要「只有一个入口、谁也绕不过去」：接管 `tools/call` 就是唯一入口；每个工具包一层的做法，将来新登记一个工具忘了包，就是一扇绕过审批的门。
   - 所以「审批的接法」选**接管 `tools/call`**。SDK 官方文档把这条低层路写成支持的用法（「Build the server and list your tools by hand」），`createMcpHandler` / `serveStdio` 的工厂也同时接受 `Server`，第 2 段换传输不受影响。
2. **`mcpTransportSchemaFromZod.ts` 保留**：见 ★3。它不是协议，是「zod v3 契约怎样投成对外 schema」的领域投影，`tools/list` 字节不变的前提就是它不变。`mcpArgValidation.ts` 里那两个只服务于它的发布期检查（关键字白名单 `findUnsupportedSchemaFeatures`）并进它；运行时校验整个交给 SDK。

## 保留的 Nomi 领域层（不动语义和文案）

`mcpToolCatalog.ts`、`mcpCapabilityProjection.ts`、`mcpToolResults.ts`、`mcpToolErrorResults.ts`、`mcpGateConfirmation.ts`、`mcpElicitation.ts` / `mcpCredentialElicitation.ts`（文案与语义；`mcpElicitation.ts` 的发送口改由 SDK 的 `Server.request` 承担）、`mcpAppWidget.ts`、`mcpGeneration*` 一族、`mcpProgress.ts`（诚实进度：只报真实阶段与已用时长，不造总量——帧改由 SDK 发）、`mcpTrustDowngrade.ts` / `mcpDocumentConfirmation.ts` / `mcpTimelineConfirmation.ts` / `mcpSemanticGenerationFlow.ts` / `mcpPlanTrust.ts`。

## 行为差异（第 1 段，都是 SDK 按规范做的；特征测试钉的是两边都成立的不变量）

| 场景 | 旧 | 新 | 为什么可以 |
|---|---|---|---|
| initialize 请求不支持的版本 | 回 -32602 | 回我们支持的最高版本（2025-11-25），由客户端决定断不断 | 规范要求服务端回一个自己支持的版本；不支持的版本仍绝不被原样协商成功 |
| initialize 缺 `capabilities` / `clientInfo` | 照收 | SDK 按规范 schema 拒（-32603） | 规范必填；所有真实宿主都带 |
| stdio 收到非 JSON 行 | 回 -32700（id=null） | SDK 跳过该行，连接照常 | SDK 有意容忍（热重载工具往 stdout 打日志）；真实宿主不会发 |
| stdio 单行超长 | 4 MiB 起整行丢弃、连接照常 | 读缓冲超 10 MiB 即报错并**关连接**（失败即关） | 内存上限仍钉死；记录到 stderr 诊断事件 `stdio-transport-error` |
| 等待确认时被取消 / 超时 | 只在本地放弃等待 | 另向客户端发 `notifications/cancelled`，宿主可收起弹框 | 规范行为，用户少看到一个过期弹框 |
| 未知方法 | -32601「未实现的方法: x」 | -32601「Method not found」 | 码不变 |
| 断连日志 | 记「中止了几条」 | 同（计数改由 tools/call 处理器自己记） | — |
| tools/call 的 `arguments` 不是对象（如 null） | 进工具校验，回工具级 `capability_input_invalid` | SDK 回协议级 -32602，领域照样不被触达 | 规范要求对象；整包参数是一段 JSON 文本的那种（#547 真实写法）仍被容忍钩子在入口还原，特征测试钉住 |
| 参数校验的报错措辞 | 中文分项（「缺少必填参数」等） | SDK 校验器的英文措辞 | 线上不可见：工具错误文本与 nomiOutcome 本来就用 `capability_input_invalid` 的人话提示替换掉原句，换前换后线上字节一样 |
| 参数校验对 schema 里不认识的关键字 | 运行时报「无效工具 schema」 | 运行时放行；改由发布期白名单 `findUnsupportedSchemaFeatures` 拦（单测覆盖整个目录） | 运行时只校验自己发出去的 schema，卡在发布时更早 |
| 客户端取消自己的 initialize | 忽略（照回握手） | SDK 照取消处理，不回响应 | 规范禁止客户端这么做；只影响违规客户端自己 |
| 服务端发给客户端的请求 id | 字符串 `srv-1` | SDK 分配的数字 | JSON-RPC 允许两种，客户端按 id 原样回 |
| `ajv` 依赖 | 运行时依赖（手写校验器用） | 挪到 devDependencies（只剩一个单测用）；运行时校验用 SDK 自带的 | `check:packaged-deps` 要求每个运行时依赖有证据 |

## 先查别人

- 依赖里：官方 TypeScript SDK v2 `@modelcontextprotocol/server@2.3.0`，`Server` / `StdioServerTransport` / `InMemoryTransport` / `fromJsonSchema` / `createMcpHandler` / `serveStdio` / `validateHostHeader` / `validateOriginHeader` 全在导出表里（`node_modules/@modelcontextprotocol/server/dist/index.d.cts:809`）。旧 v1 `@modelcontextprotocol/sdk@1.29.0` 只是 pi 的传递依赖，不用。
- 仓库里：手写协议层 `electron/capabilityCore/mcpProtocol.ts:112`（`createMcpProtocol`）、分帧 `electron/capabilityCore/mcpStdioLine.ts:10`、校验 `electron/capabilityCore/mcpArgValidation.ts:69`、在飞账本 `electron/capabilityCore/mcpRequestRegistry.ts:29`；自写登记 `docs/engineering/self-written.json` 的 `mcp-protocol` 一条（状态 under-review，结论「能覆盖则接 SDK」）。
- 生态里：SDK v2 文档 https://ts.sdk.modelcontextprotocol.io/v2/ （低层 Server 手动列工具：https://ts.sdk.modelcontextprotocol.io/v2/advanced/low-level-server.md ；JSON Schema 直通：https://ts.sdk.modelcontextprotocol.io/v2/advanced/schema-libraries.md ；v1→v2 迁移：https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2 ）；规范 2025-11-25 https://modelcontextprotocol.io/specification/2025-11-25 （生命周期 / 取消 / 进度 / elicitation url 模式）；本机 HTTP 的 DNS 重绑定防护：规范 Streamable HTTP 安全警告 https://modelcontextprotocol.io/specification/2025-11-25/basic/transports 。
- 生态里（stdio→HTTP 转发口的先例）：`mcp-remote` 就是给只认 stdio 的 Claude Desktop 接远端 HTTP 服务器的薄转发器 https://www.npmjs.com/package/mcp-remote ；SDK 自带的 `serveStdio` 能在 stdio 上同时服务新旧两版协议（`node_modules/@modelcontextprotocol/server/dist/index.d.cts:809` 导出）。第 2 段优先用 SDK 的客户端 + 服务端两头拼转发口，不引 mcp-remote（它会把 OAuth 等我们不要的东西一起带进来）。
- 结论：协议、传输、校验、取消、请求关联全部接 SDK；Nomi 只写领域（目录投影、审批、诚实进度、widget 内容、未验证客户端拒绝的判据）。

## 分段计划

| 段 | 做什么 | 验收 | 状态 |
|---|---|---|---|
| 0 | 本设计卡；特征测试 `mcpWireContract.test.ts`（38 条，跨传输复用：用例只依赖文件末尾的「连接器」表，换协议实现 / 加传输只加一行连接器） | 旧实现上全绿 | 已实现未推送 |
| 1 | 协议层换 SDK v2，传输仍是 stdio；同提交删 `mcpStdioLine.ts`、`mcpArgValidation.ts`、`mcpRequestRegistry.ts` 及 `mcpProtocol.ts` 的握手 / 路由 / 取消 / 进度帧 / 请求账本；两个 stdio 入口改用 `StdioServerTransport`；特征测试再加一个「真 stdio 管道」连接器 | 第 0 段特征测试 + 全部 MCP 单测 + 7 道 MCP 门岗全绿；tools/list 字节不变 | 已实现未推送 |
| 2 | 本机 HTTP 直连 + Desktop 转发口（落地细节见下「第 2 段增补」） | HTTP 与转发口两个连接器跑同一组特征测试；DNS 重绑定（伪造 Host / Origin）被拒；未验证身份 -32001；真 Electron 端到端；Claude Code、Codex 真握手 | 已实现未推送 |
| 3 | 宿主配置新写法（HTTP 直连 + 口令头；Claude Desktop 写转发口）；Nomi 更新后在「AI 助手连接」卡顶部问一句迁移（画布已拍板，见下），点「改过去」才改、改前备份原文件；旧 stdio 启动器再保留一个版本，内部改成转发器，不点同意照样能用；所有写配置的测试用临时 HOME | 迁移前后宿主都能连；备份可还原；不点同意零改动 | 计划 |
| 4 | 记录「最近谁来调用 / 什么时候 / 调用次数 / 正在用」：第 2 段的本机 HTTP 会话层里按连接记客户端名（自报名只作展示，身份以口令为准）、最近一次调用的工具与时间、本会话调用次数、在途调用数，主进程内存里存；连接状态界面读它（见下「第 3、4 段界面」）。「测试连接」复用现有 `mcpVerify`，只握手和 tools/list，不花钱 | 单测 + 「AI 助手连接」卡真截图（zh / en，六种状态框都截）对照拍板画布逐项打勾 | 计划 |

## 第 2 段增补（本机 HTTP 直连 + Desktop 转发口，2026-10-05）

**做成了什么样**（和上面计划行原先写的有三处不同，都写了原因）：

- **服务端**：开着的 Nomi 主进程在回环 RPC 起好后，起 `electron/capabilityCore/mcpHttpServer.ts`。传输用 SDK 的 Streamable HTTP（`@modelcontextprotocol/node` 的 `NodeStreamableHTTPServerTransport`，有会话号），只听 `127.0.0.1`，地址 `http://127.0.0.1:47173/mcp`。Host / Origin 用 SDK 的 `localhostHostValidation` / `localhostOriginValidation` 拦，非本机一律 403。**与计划不同①**：没用 `createMcpHandler`，那个入口服务的是 2026-07-28 的无会话形态；我们这一段只开 2025 家族，要有会话（付费门的会话级信任、list_changed、断连中止都挂在会话上），所以用有会话的那个传输。
- **一条派发路径**：每条会话一个 `createNomiMcpServer`（与 stdio 同一个工厂、同一套 tools/call 审批），会话里的领域调用经回环 RPC 进本进程的 `rpcServer`。三条入口（裸 Node 启动器 / Electron stdio / 本机 HTTP）走的是同一扇门：同样的认人、租约、渲染层 / 磁盘网关选路、收据。`check:transport-assembly` 现在比对三个装配点是否接齐 `McpHost` 的可选成员。
- **认人**：**与计划不同②**，不用 `Authorization: Bearer`。宿主一看到 401 / Bearer 就会去做 OAuth 发现，把用户带进一个根本不存在的登录流程。改成与回环 RPC 同一对身份头：`x-nomi-mcp-client` + `x-nomi-mcp-client-proof`，签名就是现有的客户端签名（用本机 capability token 给客户端名签）。没过的请求回同一帧 -32001（`mcpUnauthenticatedResponse`），与 stdio 上的拒绝逐字相同；已开的会话换了人同样拒。
- **端口**：默认 47173，因为写进宿主配置的地址要稳定。走查和隔离实例（`NOMI_E2E=1` 或自定义 capability 目录）不占默认端口，要显式给 `NOMI_MCP_HTTP_PORT`（0 = 随机）。端口被占就本次不开 HTTP、记 `mcp-http-unavailable`，旧 stdio 启动器照常能用。实际地址写进 capability 目录的 `mcp-http.json`，转发口和走查都读它。
- **确认弹框挂在所属调用上**：**与计划不同③**，没改成 `ctx.mcpReq.send`（那样就得把付费门的连接级去重拆成每次调用一份）。改为按这次调用的取消信号找回请求 id，`Server.request(..., { relatedRequestId })`。效果一样：HTTP 下弹框走那次 POST 的 SSE 流，stdio 下线上不变。
- **Desktop 转发口**：`mcpHttpForwarder.ts`（入口）+ `mcpHttpBridge.ts`（桥）。打包后与旧启动器一样以 `ELECTRON_RUN_AS_NODE=1` 跑，闭包 electron-free（`mcpLauncherClosure.test.ts` 已扩到它）。桥里不认工具、不碰审批，只做两件传输本身要的事：把协商出的协议版本告诉 HTTP 传输；Nomi 没开时给宿主那个请求回一句「连不上 Nomi：请先打开 Nomi 再试」。
- **配置写入的位置先留好**：`buildMcpHttpHostEntry(client)` 算出要写进宿主的那一条（地址 + 身份头），第 3 段的迁移流程调用它；这一段不写任何宿主配置。
- **依赖**：新增 `@modelcontextprotocol/node@2.1.1`、`@modelcontextprotocol/client@2.3.0`（转发口的 HTTP 客户端传输）、`hono@4.12.26`（`@hono/node-server` 的非可选 peer，electron-builder 不跟 peer，必须显式列）。`hono` / `@hono/node-server` 此前已作为 v1 SDK 的传递依赖在锁文件里。HTTP 服务端按需加载，不进 Nomi 冷启动的关键路径。

**特征测试**：同一组 38 条用例现在跑四个连接器：进程内、stdio 管道、本机 HTTP、Desktop 转发口（stdio→HTTP），合计 152 条：150 绿、2 条按规范跳过。跳过的是「未握手也能列 tools/list」：Streamable HTTP 有会话，规范要求先握手，所以这一条只对两个无会话的连接器成立，HTTP 上「未握手 → 400」改由 `mcpHttpServer.test.ts` 钉。tools/list 字节在四个连接器上都与目录推出的形状逐字节一致。另加 `mcpHttpServer.test.ts` 11 条 HTTP 专属边界：只听 127.0.0.1、Host 重绑定 403、Origin 403、-32001 同帧、会话不许换人、404 / 400、会话上限、端口选择、端点文件、宿主配置条目、转发口在 Nomi 没开时的回答。改回「不认人」的变异：HTTP 与转发口两个连接器上未验证用例 12 条全红。中途表「宿主断线但没发 DELETE」那一行有自动化证据（V-1019 补）：`mcpHttpServer.test.ts` 对付费门、删除节点、文稿改写三种等确认调用，各自在确认弹框发出后掐断宿主那条流（不发 DELETE、不回答），用假时钟推进过 5 分钟超时，断言领域派发 0 次、收据验证与 Nomi 兜底卡都没被调、关服务时在途调用数为 0（调用确实以未确认收尾）。变异：超时按「确认通过」处理，3 条全红；不推进时钟，3 条也红（证明是超时、不是断线让它收尾）。

**真实测试**（Windows 本机，2026-10-05）：
- 真 Electron 端到端 `tests/ux/mcp-http-direct.e2e.mjs`（16 条断言全绿，已加进 `test:mcp-journey`，CI 的 Linux 上同样跑）：隔离的真 Nomi，窗口经 `mainRequire` 注入 `tests/ux/_offscreenWindows.cjs` 全挪到屏幕外、不可聚焦，断言里核了全部窗口坐标。直连覆盖握手 → tools/list（24 个，与目录一致）→ 建项目（真落到隔离项目目录）→ 未知工具 -32602 → widget 资源；未带身份 -32001；Host 重绑定 403；Origin 403。Desktop 转发口用 Electron 自带 Node（`ELECTRON_RUN_AS_NODE=1`）跑编译产物，同样握手 → 列工具 → 建项目。
- 真宿主握手（都不调模型，配置全在临时目录）：
  - Claude Code 2.1.132：`CLAUDE_CONFIG_DIR=<临时目录>`，`claude mcp add --transport http --header ...`，再 `claude mcp list`，结果「✓ Connected」。
  - Codex 0.154.0：`CODEX_HOME=<临时目录>` 写一份 `[mcp_servers.x] url + http_headers`，用 `codex app-server` 的 `mcpServerStatus/list`（列 MCP 服务的工具清单，不起会话、不调模型）。Codex 真连上，拿到 `serverInfo.name = nomi-capability-core` 和 24 个工具。`codex mcp list` 只读配置、不连，不能当握手证据。
  - 前后核对：用户真实的 `~/.claude.json`、`~/.claude/settings.json`、`~/.codex/config.toml` 里没有这次的临时服务名，后两份的 sha256 与修改时间不变。`~/.claude.json` 一直被正在运行的 Claude Code 自己改写，只能按「不含临时服务名」核。
  - 副作用如实记：Codex app-server 在新的临时 CODEX_HOME 里会自己去 GitHub 拉一次插件仓库（git fetch）；那几个 git 进程跟着临时目录一起停掉、删掉了。
- **未验**：
  - Electron stdio 在 Windows 上跑不起来：Electron 主进程的 stdin 一启动就结束（最小复现已做），靠 CI 的 Linux。
  - Claude Desktop 真握手：桌面应用没有命令行健康检查，转发口只用 SDK 客户端与真 Electron 验了。
  - Cursor：未验。
  - 付费确认在真宿主里经 HTTP 弹框：要调模型才能触发，没做。HTTP 上的付费拦截时机由特征测试在真 HTTP 服务端 + SDK 客户端上钉住。

## 第 3、4 段界面（用户 10-05 已在 Claude Design 画布拍板，作为界面验收依据）

画布：https://claude.ai/artifact/Ni8YgHDGTzGQmbYRDgPqnC （v5）。本 PR 第 0、1 段不实现界面，第 3、4 段照画布做，验收逐项对照：

- **改在现有的「AI 助手连接」卡上**（`src/ui/onboarding/ConnectAssistantCard.tsx`），不新开页面。
- 客户端标签加小圆点：连着是绿色，差一步是黄色，未接入不显示。卡头总徽章五种：正在使用 / 已接入 / 等你完成接入 / 配置已失效 / 未接入。
- 状态框六种：正在使用（「刚刚调用了 X · 这次会话已调用 N 次工具」）/ 最近连过（「最近一次使用：3 小时前」）/ 已写入但还没连过来（提示重启）/ Cursor 等用户在 Cursor 里打开 / 配置失效（通栏「升级接入」）/ 未接入（通栏「一键接入」）。
- 操作按钮「测试连接」「重新写入」「撤销接入」收进状态框底部，做成一行轻量文字按钮：撤销靠左、颜色压淡；其余靠右，「测试连接」放最右。**不要单独占一行带边框的按钮**（用户特意指出）。
- 迁移提示（第 3 段）：更新后在卡顶部问一句「Nomi 换了更快的连接方式，要把 Claude Code、Codex、Cursor 改过去吗？改之前会先备份；不改也照样能用到下个版本」。按钮靠右：「以后再说」在左，「改过去」在右。改完显示一行「已改好 N 个，原配置的备份放在各自旁边，重启它们后生效」。
- 卡底常驻一行浅色小字（不加底框）：「用之前先打开 Nomi。Nomi 关着时，助手那边会直接提示连不上。」
- 数据来源：「最近谁来调用 / 什么时候 / 调用次数 / 正在用」由第 4 段在新的会话层记录；「测试连接」复用现有 verify，只握手和 tools/list，不花钱。
- 文案全走 i18n（zh / en）；不出现「预算」「价格」字样，不要求用户懂 MCP、HTTP、口令这些词。

## 包体增量（第 1 段）

新进安装包的运行时包：`@modelcontextprotocol/server@2.3.0`（不含 source map 约 2.4 MB，其中运行时 `.cjs` 约 0.9 MB，自带打进去的 AJV）、`@modelcontextprotocol/core@2.3.0`（不含 source map 约 1.0 MB）、`zod@4.4.3`（约 4.4 MB；锁文件里早就有这一版，是否已随包取决于打包闭包，以 desktop-rc 的包体审计为准）。`ajv` 挪出运行时依赖（约 2.1 MB，若无其它运行时依赖带它则从包里消失）。合计上限约 +7.8 MB、可能净减约 2 MB；包内包名单会多出 `@modelcontextprotocol/server`、`@modelcontextprotocol/core` 两个名字，desktop-rc 的 `audit-package` 需要协调会话用 `--update-baseline --allow-growth` 记一次账。

## 已验证 / 未验证

- 已验证（Windows 本机）：特征测试 38 条在旧实现（提交 `3cff1817d`，临时 worktree 里跑）上全绿；第 1 段上「进程内」「stdio 管道」两个连接器各 38 条全绿；全部 MCP 单测（81 个文件）除下面两处既有问题外全绿；7 道 MCP 门岗与 typecheck / lint / filesize / i18n / vocabularies / self-written / prior-art / packaged-deps / supply-chain-pins / package-budget 全过；tools/list 换前换后 zh-CN 51438 B（sha256 362ff862…7469）、en 51482 B（sha256 982a9e81…6114）完全相同。
- 既有问题（与本改动无关，main 上同样红）：`mcpConfig.test.ts`「walkthrough 把 HOME 挪到临时目录仍写入」在 Windows 上红；`mcpConversationJourney.test.ts` 两条在整批并发跑时偶发超时、单独跑绿。`check:concept-owners` 36 处是 main 上的存量（本改动不增）；`check:transport-assembly` 在 Windows 上因路径写法读不到文件（既有），改路径后本地跑过。
- 未验证：真宿主握手与付费确认（`unverified`，第 2 段后走）；Linux CI 的 `test:mcp-journey`（真 Electron stdio）；打包冒烟与包体审计（desktop-rc 作业，需要更新包内包名单基线，见 PR 正文）。
