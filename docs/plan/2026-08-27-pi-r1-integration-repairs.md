# Pi R1 接入修复与通用网络入口实施计划

> **For agentic workers:** Use subagent-driven-development / test-driven-development. 独立文件域可以并行；共享合同由主代理单点修改。每项先观察断言失败，再实现，再独立规格审查与质量审查。

**Goal:** 修复用户真实请求暴露的网络路由、错误事实、过期审批、上下文容量四项接入问题；保留 pi 运行核和现有专业界面。

**Architecture:** Nomi 拥有应用网络策略与工具执行授权，pi 只使用明确提供的网络入口和模型合同。网络入口不依赖第三方恰好保留全局 dispatcher；工具写入有效性绑定到具体 call，而不只绑定整轮对话。压缩继续由 pi 执行。

**Tech Stack:** 现有 Electron 43、undici、SOCKS 适配、pi SDK 0.84.3、Zod、Vitest、原生 Node tests、隔离 Electron walkthrough；不升级依赖、不引第二个网络栈或 Agent loop。

## 已批准范围与工作区

- 用户先批准四项修复，随后明确要求网络入口按底层根因通用修复，不限 pi 或 APIMart。
- 工作树：`/Users/aoqimin/Desktop/Nomi-codex-execution-20260826`。
- 分支：`codex/unified-agent-pi-20260826`；开工 HEAD：`b4a3f466813b1f4defa179e5b26b4100b0f5c8f9`。
- 保留已有 R1 未提交成果和 `MERGE_HEAD=7dab8ee8cc0990bdd57cca565966d9bfcddb4167` 的上游整合。开工 fetch 得到 `origin/main=4881cccebbeb79be4ff571b5985ef6642d422a8c`，提交前再次核验。禁止覆盖用户启动时生成的 CSS 或无关改动。
- 不动布局、控件、R2-U1 历史迁移、MCP 协议、ProductionRun 账本、付费收据、Apply/Undo 业务语义；不新增自动重试或付费重发。
- 不停止用户运行的应用；使用隔离用户数据的实例验收。同构建验收后再说明用户如何重启加载新主进程。

## 已验证根因

1. 实际 Electron main 中，`systemProxy` 安装 undici6 `.1` dispatcher 后，冷加载 pi 的传递依赖 undici8 初始化 `.2` 并覆盖 `.1`。这是模块初始化副作用，不是调用了 pi CLI 的 `configureHttpDispatcher`。
2. 同进程、同地址、不带密钥：默认请求 10516ms 连接超时、原代理 dispatch=0；显式原 dispatcher 1135ms 收到 401、dispatch=1。401 仅证明网络可达。
3. `errorFacts` 只观察 HTTP Response，不捕获 fetch rejection；OpenAI SDK 随后丢失底层 cause。网络错误因此退化为裸 `Request timed out.`。
4. 画布 client 未转发 `tool-error`；审批已失效但 turn 仍活跃时，旧卡可能先调用编辑器，再收到 main 拒绝。
5. facade 只传 `maxOutputTokens`，不传模型声明的 `contextWindow`，运行层统一落到 128k 默认值。

## 取舍与边界

| 方案 | 用户效果 | 判断 |
|---|---|---|
| 延长超时 / APIMart 特判 | 等得更久，其他入口仍可能坏 | 不采用 |
| 每次加载 SDK 后重装全局 dispatcher | 依赖加载顺序，热切换与其他库仍可覆盖 | 不采用 |
| 应用持有当前路由、各出口显式使用同一 transport | 设置、调用、探测一致；后续接 SDK 不重复造代理 | 采用，复用成熟 HTTP/代理能力 |

本轮六视角检查条件：CTO 看单一网络负责人；后端看启动/热切换/取消；前端看 call 失效后的最终写点；PM 看四项边界；设计看不增加控件/文案布局；用户任务看原请求能够批准建节点且不付费生成。实现审查必须检查这些条件，不把角色名称当验收证据。

## Task 1：通用网络路由（network owner）

**Files:** `electron/systemProxy.ts` / tests、应用 transport 模块、`electron/harness/context/agentContextHost.ts`、`electron/harness/runtime/pi/run.mts`；实扫后逐一迁移主进程模型/上传/下载/探测调用。`runtimePort.ts` 共享类型由主代理修改。完整入口清单和例外在实现前回填本节。

已确认的最小接缝：`appFetch: typeof globalThis.fetch` 是 Node 出站公共入口；`getAppDispatcher(signal?)` 等待应用配置就绪，以私有稳定转发 dispatcher 选择当前已提交路由。SDK 只通过 main 的 `RuntimeTurnHooks.fetch` 接入，renderer DTO 不接受函数。代理切换串行、旧异步结果不得回写；首次配置失败不得静默直连，热切失败保留已生效路由并报告失败。旧路由 graceful close，不中止在飞请求。

实扫范围包括 vendor HTTP、AI4（三协议）、pi（三协议）、上传、下载、音频、模型/原生接入探测、Comfy HTTP/WebSocket、headless；约 24 个 Node fetch 出口。Chromium `net.fetch/session.fetch` 保留浏览器会话语义；本地 RPC/预览的 Node HTTP 服务端监听不是出站请求，测试/CLI 的独立 loopback 通信不强行迁移。`networkHostPolicy.ts` 只承接既有私网判断，避免 transport 与 hardenedFetch 循环依赖。

依据：[undici 官方显式 dispatcher 文档](https://github.com/nodejs/undici/blob/main/docs/docs/index.md)、[pi SDK](https://pi.dev/docs/latest/sdk)；具体行为以已锁定的 0.84.3 和本机 Electron 冷加载实测为准。

- [x] 读取所有直接 fetch / undici / http(s) 出口，区分 Node 出站、Chromium、服务端监听、明确直连的外部 CLI。不得把服务端监听当出站迁移。
- [x] 明确最小 transport API，复用现有代理解析、SOCKS、私网绕过；当前路由每次请求读取，不能会话创建时固定旧代理。
- [x] RED：真实 Electron main 首次 fetch 前安装代理，冷 import 当前 pi 模块后，对合成目标发请求；断言仍经过本地可计数路由。不能用 RUN_AS_NODE 代替。
- [x] RED：A→B→off 热切换、并发配置旧结果晚到、启动配置就绪前首请求；探测与真实调用走同一实际出口；私网仍直连。
- [x] 实现唯一网络路由负责人，显式给 SDK fetch；迁移同类出口，不增加模型特例、不修改请求重发语义。
- [x] GREEN：同一模型请求/非 Agent 请求/上传下载和探测验证；补机器边界检查阻止新增裸出口。

核心断言形态：

```ts
await applySystemProxy(session, { mode: 'custom', customUrl: proxyA });
await import(currentPiEntry);
await applicationRequest(target);
expect(proxyARequests).toBe(1);
await applySystemProxy(session, { mode: 'custom', customUrl: proxyB });
await applicationRequest(target);
expect(proxyBRequests).toBe(1);
```

## Task 2：网络错误事实（parent owner）

**Files:** `electron/harness/runtime/pi/errorFacts.mts`、`electron/harness/runtime/runtimePort.ts`、`electron/ai/runtimeVendorError.ts`、共享网络错误工具及现有消费者；测试 `tests/agent-runtime/errorFacts.test.mts` / 网络集成 tests 和 `electron/ai/runtimeVendorError.test.ts`。

- [x] RED：fetch 抛含 `UND_ERR_CONNECT_TIMEOUT` cause 的错误；原实现 records 为空，期望网络事实含 code、脱敏 URL、不含伪 HTTP 状态。
- [x] RED：主动取消与网络失败分开；循环 cause、有界文本、URL query/凭据、跨截断密钥均不泄漏；原 SDK 错误对象仍按原语义传播。
- [x] SDK 归一化之前捕获原始网络事实；复用原 vendor 错误分类，不靠字符串猜 HTTP 状态，不把主动 Stop 标成可重试故障。
- [x] GREEN（专项，非产品验收）：真实 pi SDK 接到网络 rejection 后最终结果保留结构化 network；HTTP 401/429/5xx、取消和原有脱敏测试仍通过。完整用量/取消套件在集成门复跑。

```ts
const cause = Object.assign(new Error('connect timed out'), { code: 'UND_ERR_CONNECT_TIMEOUT' });
const original = new TypeError('fetch failed', { cause });
await assert.rejects(observedFetch(async () => { throw original; })(target), (error) => error === original);
assert.equal(records[0].kind, 'network');
assert.equal(records[0].code, 'UND_ERR_CONNECT_TIMEOUT');
assert.equal(records[0].status, undefined);
```

## Task 3：具体工具调用的过期审批（approval owner）

**Files:** `src/workbench/ai/workbenchAgentRunner.ts`、画布 client / approval helpers / `CanvasAssistantPanel.tsx`，必要时创作工具入口沿用同一有效性合同；对应 test files。不改 JSX 布局或增控件。

- [x] RED：真实 adapter 发工具→tool-error→模型仍运行→点击旧批准，编辑器调用必须为 0。
- [x] RED：批准已点击但模型目录/素材准备仍 await 时过期，恢复后最终写入必须为 0；同批任一调用过期不得部分提交。
- [x] 通过具体 call 的生命周期/取消状态保护最终写点，并传递过期事件撤卡；不能只判断整轮 sending 或仅隐藏卡片。
- [x] GREEN：有效批准仍执行一次，重复批准不执行两次；拒绝、停止、终态、换项目/线程仍受保护；不取消已经移交任务中心的合法生成任务。

独立审查补充：同一项目新建对话会使 turn 身份失效，但不应跳过该事务已落地步骤的补偿。事务执行器需区分写入资格与目标画布装载身份；复用既有 undo journal 的装载代次（仅 clear/restore 改变），同代次按原补偿操作回滚，不同代次不触碰新载入的画布。增加“第一步已改、第二步媒体探测等待中换对话”以及切项目/同项目重载反例；不改内容 revision 或 Undo 产品语义。

质量审查进一步发现：仅验证同一画布不足，旧 await 回来后仍可能覆盖新线程已提交的值，并删掉新事务的 Undo。采用最小的文档写入接管边界：当前未提交的可补偿批次在另一笔文档编辑开始前同步收尾，发生在新动作读状态/建立撤销点之前；随后旧异步结果只报告已中止，不再回滚第二次。store 的文档动作分类用完整类型约束，选区、视口和聊天动作不触发接管；后台生成任务本身不取消。当前步骤的补偿根据真实前后画布收集，覆盖同步写入已完成但 Promise 尚未返回的窗口。复用原工具执行器、补偿器和 Undo journal，不增加另一套重放/合并引擎。代价是未提交的批量编辑遇到新文档编辑会中止，优先保证新编辑与撤销历史不被旧任务破坏；跨任务语义合并不偷塞进本轮。验收新增同/不同节点新线程修改、同轮第二批、人工编辑以及 Undo/Redo 不复活旧半截。

```ts
emitToolCall('call-a');
const approval = approveAndHoldPreparation('call-a');
emitToolError('call-a');
releasePreparation();
await approval;
expect(documentOrCanvasWrites).toBe(0);
```

## Task 4：模型窗口合同（capacity owner）

**Files:** `electron/ai/agentChatV2.ts` / `.facade.test.ts`；必要的纯模型 metadata helper 和 native compaction 测试。与 network owner 的 host 注入分开。

- [x] RED：模型 meta.contextWindow=32768 / 262144 时 facade 必须完整传入所选模型容量；输出 token 限额独立不变。
- [x] RED：字符串、布尔、NaN、Infinity、0、负值不可强转成合法窗口；没有声明不得伪称已知容量。
- [x] 最小实现：只转交有效容量；缺失时保留明确的兼容默认，不按模型名猜容量；压缩算法/会话推进仍归 pi。
- [x] GREEN（专项）：真实 SDK 的模型窗口与压缩阈值按传入值工作；小窗口 reserve 边界成功/失败均稳定收尾。

```ts
await runWithSelectedModel({ contextWindow: 32768, maxOutputTokens: 2048 });
expect(runtimeRequest.model).toMatchObject({ contextWindow: 32768, maxOutputTokens: 2048 });
```

## 验证与交付

- [x] 各项记录 RED 命令/失败断言，再记录 GREEN 和变更文件；独立 spec→quality 审查，发现问题只窄修。
- [x] `pnpm run typecheck`、`pnpm run check:test-types`、scoped lint、全部 Vitest/native tests、`pnpm run gates`。
- [x] 真 Electron 冷启动网络脚本；正式 ASAR 同入口检查（非 RUN_AS_NODE）。启动与测试数据隔离。
- [x] 复跑现有 editing walkthrough 的建节点/连接/批准/Undo/Stop/冷恢复；过期审批的故障注入未使用真实用户项目。
- [x] 真实供应商小额验收已执行且如实记录：文本回复与文稿工具闭环通过；画布轮因供应商返回畸形 tool arguments 被 schema 安全拒绝，未落画布、未生成媒体，整条 live walk 未宣称全绿。真实密钥未进输出/仓库。
- [x] 回填结果，明确本轮四项和整个 R1 的差别。只推任务分支/更新既有 PR，不合并 main。

**回滚：** 仅按本计划提交边界回退；保留原项目、会话和凭据。禁止 reset/checkout 整个脏工作树，禁止用旧 Agent loop 作为回退并行引擎。

## 阶段记录

2026-08-27：用户批准执行；工作区及上游已核验；重新查阅 pi 官方 SDK 和 undici 官方资料。尚未修改产品代码，正在补复现与入口清单。

2026-08-27 / Task2 实现冻结：

- 首轮 RED：`runtime-network-error.test.mts` 8 项中 6 失败（记录为空 / SDK 结果仅 runtime）；`runtimeVendorError.test.ts` 5 项中 1 失败（无法解码 network 分类）；旧 vendor HTTP 原因测试 11 项中 2 失败（只剩 fetch failed / terminated）。
- 追加 RED：有界 aggregate 遍历仍读取 39 个额外条目、诊断 URL 仍含 userinfo/query。已修正预算下界并清除诊断地址中的鉴权信息。
- GREEN：`pnpm exec vitest run electron/networkErrorDetails.test.ts electron/vendor/vendorHttp.test.ts electron/ai/runtimeVendorError.test.ts --maxWorkers=2` → 25/25。
- GREEN：独立输出目录 `.tmp/repair-diagnostics-tests` 的 native 编译 + `runtime-network-error.test.mjs` / `errorFacts.test.mjs` → 15/15，包含三协议真实 SDK（fetch 故障注入，不消耗额度）。
- 父线程负责的 9 个 TS/MTS 文件严格 ESLint exit 0；尚待独立审查和通用路由接线后的完整回归，不代表用户当前运行实例已加载修复。

2026-08-27 / Task4 三文件冻结：合法窗口原值透传；facade+seed 44/44、native 11/11。独立规格审查复跑 44/11 通过，独立质量审查通过；专项验收完成，仍待完整应用集成验证。

2026-08-27 / Task2 独立规格与质量审查均通过：各自复跑 Vitest 25/25、native 15/15。补全错误断言的真实 instanceof 类型收窄，测试类型门从 109 处存量下降到 98（vendorHttp.test.ts 的旧 11 处清零，棘轮只下调该文件）。

2026-08-27 / Task3 独立规格发现并修复同项目新线程跳过补偿：真实 RED 21 项 1 失败（edited 未恢复 original）；装载代次修复后相关五文件 48/48，规格复核六文件 51/51 通过。无新增界面。

2026-08-27 / 真实供应商验收脚本扩展：加入原用户两图片节点/参考连线的批准前零修改、批准后落盘、成功原生工具回执、整笔 Undo；不批准媒体生成。独立审查指出连线 mode 和工具失败回执可假绿，四个原断言反例 RED 后补精确 mode、callId、isError 和实际 nodeId 对账，脚本单测 9/9；尚未实际发起供应商验收。

2026-08-27 / Task1 实现与双审关闭：32 文件 217 项定向测试、网络入口静态门岗及真实 Electron 冷加载 9 个检查点通过；pi 冷加载、热切换、在飞流、multipart、私网、下载/探测、WebSocket、AI4 三协议、pi 注入与 SOCKS 均走应用线路。规格审查补出代理失败日志凭据泄露，真实 RED 6 项 1 失败后只记录脱敏 message，focused 14/14；质量审查补出 HTTP 已达后 body.cancel 拒绝会误报不通，真实 RED 后 focused 15/15。两项均经原 reviewer 复核关闭。

2026-08-27 / Task3 质量审查补出第二个 P1：旧批次晚回会覆盖新线程已提交值并删除它的 Undo。新增“文档写入前先收尾旧可补偿事务”的单一边界，不靠事件过滤或第二套重放引擎；当前步按实际前后态登记补偿，晚到结果不再重复回滚，agent 补偿不污染用户 typing burst。原反例扩为新线程/同轮新批/手工编辑 × 同/异节点，并验证 Undo/Redo、同步 subscriber、新画布代次、后台结果/状态。

2026-08-27 / Task3 最终双审关闭：规格复核先后补出并关闭补偿同步重入和双 waiter 初始化竞态；latest-wins 独立探针得到 old=aborted、first=aborted、second=committed，事件顺序 old edit→original→second edit，Undo/Redo 与锁状态一致。质量复核补出排队候选取得 ownership 前 Stop 会遗留 owner；初始资格检查与 Undo 点纳入 release 的 `finally` 后，候选当场 aborted，下一次人工编辑不再触发延迟清理。最终专项 9 文件 77/77，更宽画布回归 38 文件 429/429，typecheck / test-types（src/native 0、存量 98）/ scoped lint / filesize / i18n / adoption 均通过。Task3 spec 与 quality 均 PASS。

2026-08-27 / 启动与凭据根因收口：正式打包首次启动暴露 catalog read、capability bootstrap、relay maintenance 与首屏 text-brain readiness 会提前触碰 macOS safeStorage。读路径已改为纯 metadata；APIMart/text model 只在真实 request 前原子解析同一 catalog 快照中的 enabled vendor、endpoint 与 credential；capability/relay 移到首窗后且后台 rejection 被消化。catalog 83 文件 839 项、启动相关 9 文件 101 项与只读 3 文件 44 项通过；独立最终审查未发现 P0–P2。该项不改变界面、模型选择或付费规则。

2026-08-27 / 正式 ASAR 与用户任务验收：`pnpm run build` 与离线 `electron-builder --mac dir --arm64` 通过，产物为 Electron 43.4.1 / Node 24.18.1。packaged production walkthrough 通过 5 条真实任务（方向审批、脚本产物、批量生成确认、审片偏差、ephemeral 隔离）；packaged editing walkthrough 经两次冷启动通过创作审批/应用/撤销、画布计划/撤销、Stop 无迟到写、线程隔离与 native context 恢复。所有截图均人工查看。

2026-08-27 / 最终门岗：`pnpm run gates` exit 0；应用 Vitest 792 文件（791 passed / 1 expected skipped），7122 tests（7121 passed / 1 expected skipped）；native pi runtime 151/151；lint 0 error、88 warnings ≤ 98；test-types 95 ≤ 98；build 与 23 个结构门岗通过。真实 Electron 冷网络脚本 9/9，通过 cold pi import、热切换/在飞流、multipart、私网、探测/下载、WebSocket、AI4 三协议、pi fetch 注入、SOCKS 与 off 路由。

2026-08-27 / 真实 APIMart 小额验收：首个失败只因 provider walk 在项目创建后沿用 Playwright expect 的 5s 默认值；失败截图已证产品随后正常进入编辑器，加入显式 120s 源码契约后测试 9/9。重跑中纯文本轮（2359 tokens）与 `append_to_end` 审批→应用→Undo（6199 tokens）均通过并人工查看三张截图。画布轮消耗 12093 tokens 后取消：模型返回的最终参数对象只有 `nodes`，第二节点 prompt 错误吞入了 `edges` 与 `summary` 的 JSON 尾段；Nomi 记录 `agent.tool.completed ok=false` 并拒绝写入，画布保持空、媒体请求为 0。总计 20651 tokens，供应商未返回金额；原 catalog 字节不变、临时凭据副本已删除。此结果证明 Pi 真请求/工具审批/持久化/Undo 已工作，也诚实保留“该模型本次复杂工具参数畸形、未完成画布 live task”的供应商兼容性事实；不通过放宽 schema 接受损坏计划来制造假绿。

2026-08-27 / live 失败后的有界合同复核：`summary` 在旧/新 active Agent 合同中一直必填；把它改 optional 会让已损坏的 payload 以“两个节点、零条边”进入审批，故不采用。复核补出 descriptor 的字段级说明未带入最终 JSON Schema：先加 wire-schema 断言得到 45 项中 1 RED，再恢复旧工具表中 `summary`（确认前展示）与 `edges`（必须同调用提交）的说明，最终 descriptor/provider 54/54、真实 SDK 同-loop Zod 纠错 1/1、typecheck 和 scoped lint 通过。没有自动猜测修 JSON，也没有再次花额度重试。
