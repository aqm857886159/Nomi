# MCP 连接程序：找得到活 Nomi、转得对请求（设计卡 + 方向检查）

线：L-mcplauncher　类别：[长跑][可打断]　合同：`docs/fixes/2026-10-04-mcp-launcher-relaunch.root-cause.json`

## 设计卡（9 格）

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当外部 Agent（Codex / Claude Code）已配好 Nomi，我想隔一阵再让它读项目、写文稿，以便不用先手动开 Nomi、也不会白等。真实任务：①Nomi 后台自退（闲置 10 分钟）后，Agent 再调一次 `nomi_read`；②用户关了 Nomi 窗口，Agent 立刻再调；③用户在应用内点了「同意」后 `document.write`。不做：不改生成 / 付费确认语义，不改探测类请求（initialize / tools/list）不拉起 Nomi 的规则。已知坑：真 Nomi 退出时先清广告、进程再拖几秒。 | `electron/capabilityCore/mcpNodeLauncherRelaunch.test.ts`；真 Nomi 场景待用户不用电脑时验 |
| ★2 谁说了算 | 「Nomi 是否活着」归广告（`instanceAdvert`），launcher 只记自己拉起的子进程状态；请求形状归 `createMcpLoopbackRpcRequest`，转发一跳归新函数 `callMcpLoopbackRpc`。概念：`mcp.live-instance-forwarding`（新登记），碰 1 个概念，不碰 `mcp.passive-discovery` | `node scripts/door-map.mjs callMcpLoopbackRpc`（4 扇：定义 + 两个调用点 + ensureLiveInstance） |
| ★3 一致与复用 | 复用 `createMcpLoopbackRpcRequest`、`rpcErrorFromPayload`；删掉两份内联的 fetch + 超时 + 取消 + 错误解析，合成一份。只有 fetch 实现由宿主注入。无第二份定义。自写理由：领域约束（Nomi 自己的回环协议），不是通用 HTTP 能力 | `git grep -n createMcpLoopbackRpcRequest electron` 只剩 `mcpLoopbackRpcCall.ts` |
| ★4 全状态 | 外部 Agent 看到的错误文案分三种：「正在启动，60 秒内未就绪（进程仍在）」「启动失败（连续退出 / 没拉起）」「实例失联（已停止服务但进程不退）」；库不匹配 / 陈旧 / 旧版的快速失败文案不变。超时文案两边统一为中文一条。无界面，不涉及 i18n 文案表（launcher 本来就是纯中文串） | 测试 + `mcpNodeLauncher.test.ts` 既有快速失败用例 |
| 5 中途表 | 见下表 | 真进程测试（假 Nomi） |
| 6 外部数据与失败 | 外部来源：广告文件（`instanceAdvert` 已校验）、子进程退出码。输掉单实例竞争的兄弟退出码为 0，按 1/2/4/8 秒退避重拉；连续 3 次非零退出判启动失败，不再重试。Windows 上 pid 即 Electron 主进程 | `MAX_FAILED_EXITS`、`RESPAWN_BACKOFF_MS` |
| 7 性能预算 | 轮询间隔不变（200ms）；每次调用多一次子进程状态判断，可忽略；不新增常驻定时器 | 人工 |
| 8 真实条件 | Windows 假 Nomi 真进程：已验。真 Nomi（含 Clash 代理、休眠恢复）：`unverified`，等用户不用电脑时验 | 本卡「已验证 / 未验证」 |
| ★9 验收与回滚 | 验收：另一条线跑 `pnpm exec vitest run electron/capabilityCore/mcpNodeLauncherRelaunch.test.ts electron/capabilityCore/mcpLoopbackRpcCall.test.ts`（修前红 / 修后绿），再用真 Nomi 手验中途表四行。回滚：revert 本分支提交即可，无数据迁移 | PR `## 独立验收` |

### 中途表（外部 Agent 的这一次调用看到什么；不涉及花钱）

| 状态 | 看到什么 | 花费 | 回执 |
|---|---|---|---|
| Nomi 退出中（广告已清、进程还拖几秒） | 等它退完 → 自动重新拉起 → 正常返回；最多等 15 秒，超过报「实例失联」 | 不扣 | 无 |
| Nomi 崩溃 / 被杀（含毫秒窗口） | 立即重新拉起 → 正常返回；连续 3 次拉起即非零退出报「启动失败」 | 不扣 | 无 |
| 用户手动关了 Nomi | 同「退出中」；关完后第一次调用会后台重新拉起（用户拍板的既有行为：真实工具调用可后台拉起） | 不扣 | 无 |
| 电脑休眠恢复 | 休眠期间广告心跳过期 → 若进程还在判「陈旧」快速失败并提示重启 Nomi；若进程已死按「崩溃」重新拉起 | 不扣 | 无 |
| 请求已发出后 Nomi 才退 | 连接被重置，原样报错，**不自动重发**（避免重复提交写操作） | 以 Nomi 当时状态为准 | 无 |

## 对代理的评估（任务 3）

用户本机开着 Clash。launcher 用 Node 原生 `fetch`，它不读系统代理，回环请求必然直连；Electron 内的 `appFetch` 对 `127.0.0.1` 也在 `systemProxy.ts` 的 `LOCAL_BYPASS_RULES` 里直连。两边结果等价，且都不会被代理拦。结论：不改，保持原生 fetch（改走 `appFetch` 会把 Electron 依赖拉进裸 Node 闭包，违反 `mcpLauncherClosure.test.ts`）。

## 方向检查（`Direction-Check`，`fix-churn` 命中 `mcpStdioServer.ts` 近 14 天 10 个 fix）

### 0. 一句话根因

两份启动器各自手抄「找实例 + 转请求」，没有单一边界，所以每次改一边另一边就漂移。

### 1. 归类表

| bug | 直接原因 | 类 |
|---|---|---|
| 调用白等 60 秒 | launcher 只拉起一次，后续不重试 | 拉起被当成「在跑」 |
| 文稿同意后仍 403 | launcher 漏转 `documentConfirmed` | 两份请求构造漂移 |
| 超时文案中英不一 | 两份各写各的 | 两份请求构造漂移 |
| 退出清理少 `dispose` | 两份各写各的 | 两份启动器漂移 |

### 2. 为什么一直出现

两份启动器的运行时不同（裸 Node 与 Electron），过去用「抄一份」代替「共享一个与运行时无关的函数」，缺的是共享层，不是某处判断。

### 3. 不改结构会冒出什么

| 预测 | 验证 |
|---|---|
| 下一个请求字段（新的确认标志）再漏一边 | `mcpLoopbackRpcCall.test.ts` 的结构守卫：任一启动器再自拼请求即红 |
| 拉起相关新分支再被「只拉起一次」绕开 | `mcpNodeLauncherRelaunch.test.ts` 三条真进程用例 |

### 4. 靶子独立性

测试用假 Nomi 与真进程 launcher，尺子不是同一条线写的实现自检；修前红（三条全部 30 秒超时）已实测，修后绿。

### 5. P0

「找到并保持一个活的 Nomi」是我们独有的（广告 + 单实例 + 后台自退协议）；HTTP 转发骨架通用但被协议字段约束，沿用现有 `fetch`，不引新库。

### 6. 补 / 重写 / 删

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 补 | 在 launcher 里再加一个重试分支 | 小 | 又一份漂移 | 否 |
| 重写（限一个模块） | 拉起状态机重写 + 两份转发合成一个函数 | 中 | 真 Nomi 下场景需手验 | 是（本次） |
| 删 | 删掉 `mcpStdioServer.ts` 旧配置路径 | 需确认没有旧配置用户 | 误伤老用户 | 另议，不在本次 |

### 7. 用户要权衡的核心

旧配置（版本 < 3）的 `mcpStdioServer.ts` 路径还要不要保留；它现在只是共用同一个转发函数，不再是漂移源。

## 特征测试清单

已钉住：`mcpNodeLauncher.test.ts`（快速失败、库不匹配、重定向、冷启竞争）、`mcpLauncherClosure.test.ts`（electron-free）、`mcpLoopbackRpcRequest.test.ts`。新增：`mcpNodeLauncherRelaunch.test.ts`、`mcpLoopbackRpcCall.test.ts`。

## 漂移清单处理

| 项 | 处理 |
|---|---|
| `documentConfirmed` 未转发 | 已修（共享函数） |
| 超时文案中英不一 | 已统一（共享函数，中文） |
| 退出清理没 `protocol.dispose()` | 已补（`close()`） |
| 发请求不走 appFetch | 评估后不改，见上 |
| 找项目库的方式（`expectedLibrary` vs `currentLibrary`） | 不动：裸 Node 算不出 documents 默认路径，是运行时差异；写进报告 |
