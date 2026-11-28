# pi coding agent 1.7.0 × Nomi Agent 线：参考实现逐层对照（2026-11-28 刷新）

> 对照日期 2026-11-28 · 上游 `@earendil-works/pi-coding-agent` / `pi-agent-core` / `pi-ai` / `pi-schema` **1.7.0**（原 2026-10-01 基线 `0.85.1`）
> 2026-11-28 刷新摘要：上游在 `1.x` 移除 `pi-agent-core/harness` 与 `@earendil-works/chord`，主干收敛为 `Agent`（`pi-agent-core`）+ `SessionManager` v3（`pi-coding-agent`）+ `@earendil-works/pi-schema` + `@google/genai@3.6.1`。本次同步完成：① `laneSupersededReads.mts` 自写折叠器删除，改走 `SessionManager.appendContextEdit` 原生投影；② `typebox` 工具边界校验删除，统一接入 `@earendil-works/pi-schema`；③ `BomTolerantExecutionEnv` / 6 参 `adaptPiTool` 胶水删除；④ 原第 52 行「没想到」的 Windows `createPowerShellToolDefinition` 已正式接线并纳入确认闸；⑤ Google Gemini 原生自定义 `fetch` 与 PDF `inlineData` 直通启用；⑥ 存量 v4 会话文件单向无损迁至 `SessionManager` v3。
> 与 09-07 那份（`docs/research/2026-09-07-pi-reference-implementation-conformance.md`）的关系：09-07 对照的是「重做方案」，列了 24 条没想到；本份对照今天 main 上跑着的 lane，并回答那 24 条现在各是什么状态、09-07 之后新出现的自写模块有没有重造 pi。pi 的细节（37 个事件、六节摘要提示词等）直接引 09-07，不重抄。

## 一屏总结

1. **Agent 线的地基已经是 pi 的，不是自己写的。** 会话落盘（`JsonlSessionRepo`）、有序转录、队列（steer / followUp）、重试退避、压缩（pi 的 `compact` + 阈值设置）、技能发现（`loadSourcedSkills`）、coding 工具与 bash 执行、历史分页，全是直接调用 pi，我们只写配置和适配。09-06 #546 那种「只接了最底层 loop、其余各写一份」的状态，在 `electron/agentLane/` 里已经不成立。
2. **09-07 的 24 条「没想到」**：见代码证据关闭 19 条，部分 2 条（G-18、G-21），待核 2 条（G-08、G-14），没有一条完全没动。pi 条目的对照欠账可以删：交付物齐了，剩下的待核项带阶段列在本文末。
3. **今天剩下的重复造轮子在 lane 旁边，不在 lane 里面**：
   - 两台 LLM 调用栈：lane 走 pi-ai；`electron/ai/`（`streamTextTask.ts`、`buildAiSdkModel.ts` 等约 530 行）还在用 AI SDK `ai@4` 跑文本任务——这是 0.24「两台发动机收敛」的对象。
   - 付费卡每 1.5 秒轮询 Run 账本（`useAgentPanelSpendConfirm.ts:52`）。「等用户」的等已经只住在审批闸里，只有卡的内容还靠轮询。
   - 旧转录迁移层 `laneLegacy*` 共 860 行：一次性，迁移窗口过了就删。
4. **#945 的 `laneContextFit` 不是重造压缩，但注释里有一句和 pi 不符。** 它挂在 pi 留给宿主的 `transform_context` 口上，pi 的压缩从设计上不动「保留的最近一段」。注释说「pi 的压缩只在回合之间量一次」，与 pi 文档和源码不符：pi 在同一个 run 里、每批工具结果落地后就量并压（`compaction.md:29-35`，`drive/checkpoint.js:59-61`，`tool-placement.js:157`）。#945 站得住的理由只能是「回合内旧工具结果收起」这一手段 pi 没有；真正该先做的是一个半天的重放实验，而不是改代码。
5. **0.24 的 B 和 C1 可以直接照 pi 的机制做，不需要新依赖。** pi 的转录是「助手消息里的 toolCall 段 + 独立 toolResult 消息，按 `toolCallId` 配对」；pi 的待决确认是「按 id 匹配、阻塞到回复、可超时、可取消」。我们的投影已经按 id 引用、不复制状态（`laneContracts.ts:111-135`）。B：把付费卡当成和 `task` 同款的按引用 join 段、轮询换成事件触发重投影；C1：在投影层纯函数 `laneProjection.ts` 里把同一 `toolCallId` 的 tool-call / pending / tool-result 合成一个 ToolUIPart 形状的段。主进程保持 pi 原生形状，界面拿到 ToolUIPart 形状。
6. **一处是「没想到」不是「有意不同」：Windows。** pi 0.85.1 有 `powershell` 工具（`pi-coding-agent/dist/core/tools/index.d.ts:7`）和 Git Bash / `shellPath` 方案（`docs/windows.md:1-40`），lane 只接了 bash。Windows 上命令沙箱起不来的问题要先看清根因是「没有 Git Bash」还是「OS 沙箱起不来」：前者 pi 有现成解，后者 pi 也没有。

## 0. 读了什么、没读什么

**读了**
- pi docs：`sdk.md`（Core Concepts、Prompting and Message Queueing、Tools、Custom Tools、RPC Mode Alternative）、`rpc.md`（Extension UI Protocol 全节、`tool_execution_*` 事件、命令表）、`compaction.md`（触发、cut point、`session_before_compact`）、`extensions.md`（`tool_call` 钩子 792-809、dialog timeout 2537-2573）、`windows.md`、`settings.md`、`security.md` 全文；`models.md` / `providers.md` / `sessions.md` / `session-format.md` 的目录与相关节。
- pi 源码：`pi-agent-core/dist/harness/runtime/drive/{checkpoint,structural,response,tools,recovery}.js`、`harness/compaction/compaction.js`、`pi-ai/dist/utils/{retry,overflow}.js`。
- 09-07 读过的 `dist/core/*` 公共面不重读，引用其结论。

**没读 / 没实测**
- pi 的 79 个 `examples/extensions` 只按 09-07 清单引用。
- 没有在 pb04 的真实转录上重放压缩（问 1 第 1 条的实验）。
- 没有抓包验证出站报文里没有 pi 的归属头（代码侧确认 lane 不经 `provider-attribution.js`）。
- 没逐个核对 pi 的三套 conformance suite 是否都压过我们注入的 `FileSystem`。

**一个必须先说清的前提**
- pi 官方文档推荐的嵌入方式是 `createAgentSession()` / `AgentSession`（`sdk.md:44-66`）或 `pi --mode rpc`（`sdk.md:1150-1170`）。我们用的是更底层的 `AgentHarness`（pi-agent-core）。
- 09-07 §3 已证明 pi 自己的 CLI 不用 `AgentHarness`；本次复核：`pi-coding-agent/dist/` 里只有打包产物 `bundle/chunks/chunk-JVUZSMYM.js` 导出了这个类，没有任何 `new AgentHarness`。
- 所以 pi 的扩展运行时、`ctx.ui.confirm()`、RPC 的 `extension_ui_request` 属于 `AgentSession` 那条栈，我们不跑。下文「接入 pi」分三种含义：用它的库（已在用）、照它的协议形状自己实现（审批 / 确认）、跑它的 CLI 栈（不跑，也不建议跑：多一个进程、丢掉进程内耐久性、再多一台发动机）。
- 「进程内改用 `AgentSession`」这一选项本报告**没有评估**，留作开放问题（见文末）。

## 参考实现逐层对照

判定三档：`一致` / `有意不同(理由)` / `没想到`。「我们」列的 `file:line` 相对仓库根，「它」列相对 `node_modules/@earendil-works/`。

### 工具

| 它怎么做 | 我们怎么做 | 判定 | 若没想到补在哪个阶段前 |
|---|---|---|---|
| 工具定义：名字、描述（`description` / `promptSnippet` / `promptGuidelines` 三条通道）、typebox `parameters`、`execute`；`prepareArguments` 在校验前折叠旧形状（`sdk.md:579-612`；09-07 层 1） | `laneTools.mts` 把能力契约翻成 pi 工具面；`laneToolSchema.mts` 是模型可见 schema 的唯一生成点；`lanePromptSections.ts` 渲染 Available tools / Guidelines；容忍逻辑唯一 owner `electron/shared/agentCapabilities/modelArgumentTolerance.ts:11-28` | 一致（G-01/03/05/06 已关闭） | — |
| pi 自带 7 个 coding 工具，`BashOperations` 是可替换插槽 | `laneCodingTools.mts:1-25`：一个执行器都不自研，只加路径包容、换 bash 的 operations、转接 `execute` 签名；`laneCodingPaths.mts` 做路径包容 | 一致 | — |
| 失败必须 throw；输出必须自截断（`truncateHead` / `formatSize`） | `laneDesktopTools.ts` 失败抛成模型看得懂的错；`laneTools.mts` 引用 pi 的 `truncateHead` | 一致（G-02 / G-04） | — |
| 动态装载 `addedToolNames`；单工具 `executionMode` | `laneNativeAssembly.mts` 让 pi 持有工具激活；`laneToolGroups.mts` 按任务组点亮；`laneTools.mts:218-222` 按 `mutates` 设 sequential / parallel | 一致 | — |
| 库路径没有工具超时，`AbortSignal` 透传，工具自己管 | `laneTools.mts:137-245`：每个工具必须声明 `execution.timeoutMs`，付费类不许声称超过读类上限 | 有意不同（领域：花钱的写类工具必须有硬预算，不能无限等） | — |
| 无「同一工具连撞同一堵墙」计数 | `laneRepeatedFailure.mts`（131 行） | 有意不同（领域：模型读不懂中文供应商报错，会把同一次真钱调用连发） | — |
| Windows：默认 Git Bash（`shellPath` 可改），另有可选 `powershell` 工具（`dist/core/tools/index.d.ts:7`；`docs/windows.md:1-40`） | 只接 bash（`laneCodingTools.mts`、`laneNativeDesktop.mts` 无 powershell 引用） | **没想到** | 0.23 内先定位 Windows 沙箱起不来的真因；缺 bash 就接 `createPowerShellTool`，不自研 |

### 转录渲染

| 它怎么做 | 我们怎么做 | 判定 | 若没想到补在哪个阶段前 |
|---|---|---|---|
| 转录有序且落盘，一条助手消息里 thinking / text / toolCall 各占一个 `contentIndex`；toolResult 独立消息，靠 `toolCallId` 配对（09-07 层 2、G-23） | `laneProjection.ts` 走一遍不重排，按 `contentIndex` 逐段发 `LanePart`（`laneContracts.ts:72-130`）；`laneClient.ts` 渲染层零状态机 | 一致 | — |
| 流式：`tool_execution_update` 的 `partialResult` 是累计值，客户端整体替换（`rpc.md:1012-1055`） | 投影整体重推，渲染层不合并（`laneClient.ts:1-18`） | 一致 | — |
| 工具结果有给模型的 `content` 和给界面的 `details` 两个口 | `tool-result` 带 `nextAction` / `failure` 两个信封（`laneContracts.ts:83-110`），渲染层按结构摘掉末尾那行「User sees:」 | 一致 | — |
| 没有「一次工具调用一条」的合并视图 | `tool-call` 与 `tool-result` 是两个段（`laneContracts.ts:75, 83`），审批 `pending` 在 `LaneProjection.pending` 另一处 | 没想到（不是 pi 有我们没有，是 #930 要的 ToolUIPart 形状我们没有） | 0.24 C1 |
| 无 | 付费卡由 `useAgentPanelSpendConfirm.ts` 读 Run 账本，每 1.5 秒轮询（`:52`） | 没想到 | 0.24 B |

### 会话

| 它怎么做 | 我们怎么做 | 判定 | 若没想到补在哪个阶段前 |
|---|---|---|---|
| v4 JSONL 事务落盘、`seq` 单调、撕裂行恢复、原子替换（09-07 层 3） | `laneSession.mts:1-17` 直接用 `JsonlSessionRepo`，只回答「写到哪、叫什么、谁持有」 | 一致 | — |
| 会话文件不指定 mode（世界可读） | `laneFileSystem.mts`：会话 0o600、目录 0o700（G-20）；注入的 `FileSystem` 满足原子替换（G-19） | 有意不同（领域：会话里是用户的原稿正文） | — |
| 同进程打开同一会话两次会写重复 seq，pi 抛 "Session is already open" | `laneSession.mts:57, 201` 知道并说明为什么致命；多窗口持有由 `laneWorkspace.mts` 管 | 一致（G-18：抛错路径确认在，「单一持有者」断言没逐行核） | — |
| 历史读用 Session / Branch API 分页 | `laneHistory.mts` / `laneHistoryPage.mts`：每一行来自当前 pi 分支，页缓存是可丢的 UI 缓存 | 一致 | — |
| 一个 cwd 一个会话目录；`/tree` `/fork` `/clone` | `laneWorkspace.mts`：一个项目多条对话；`laneWorkspaceSelection.ts` 做项目级选择 | 有意不同（领域：会话按创作项目绑定，不按 cwd；pi 的会话元数据没有项目选择） | — |
| 无 | `laneLegacy*` 共 860 行：旧转录迁移到 pi 会话 | 有意不同（领域：用户有旧版本落下的对话历史，不能丢） | 迁移窗口结束后整体删 |

### 上下文

| 它怎么做 | 我们怎么做 | 判定 | 若没想到补在哪个阶段前 |
|---|---|---|---|
| 阈值压缩 `contextTokens > contextWindow - reserveTokens`，同一个 run 里每批工具结果落地后、下一次助手响应前就量（`pi-coding-agent/docs/compaction.md:29-35`；`pi-agent-core/dist/harness/runtime/drive/checkpoint.js:59-61`；`tool-placement.js:157`） | `laneContextBudget.mts:12-18` 把成本上限翻成 pi 的公开设置，压缩本身用 pi 的 `compact()` | 一致 | — |
| 溢出恢复：压一次重试一次；已用过或没有可压的就失败，错误串是 `Assistant request exceeded the context window`（`harness/runtime/drive/response.js:139-143`；`compaction.js:410-415`） | 同上，不另写 | 一致 | — |
| 压缩从不动保留的最近一段（`keepRecentTokens`，cut point 不落在 toolResult 上）；超大单回合靠 split turn 摘要前缀（`compaction.js:420-440`） | `laneContextBudget.mts:20-51`：`before_compaction` 里换摘要提示词（保留画布 / 分镜状态、节点 id 映射、模型键），摘要末尾追加确定性的模型索引与选中状态 | 有意不同（领域：pi 的六节摘要为写代码调，会丢 anchor id，下一次画布写只能瞎编；09-07 G-22） | — |
| `transform_context` 可返回 `messages`，用途是上下文窗口管理 | **#945** `laneContextFit.ts`（108 行）：每次请求超预算时收起旧的大工具结果、其次旧的大写入参数，不动落盘转录 | 有意不同，**待实测**（理由只能是「回合内旧工具结果收起」pi 没有；其前提注释写错了） | 0.23：合并前做问 1 第 1 条的重放实验，改对注释 |
| AGENTS.md 按目录注入；技能 progressive disclosure | 技能发现用 `loadSourcedSkills`（`laneSkillCatalog.mts:14, 31`）；选中技能注入点 `laneSkillPrompt.mts` 调 pi 的 `formatSkillInvocation`；项目上下文来自领域记忆 | 有意不同（领域：用户项目不是代码仓库，没有 AGENTS.md） | — |

### 模型与花费

| 它怎么做 | 我们怎么做 | 判定 | 若没想到补在哪个阶段前 |
|---|---|---|---|
| 模型目录三层合并；自定义模型不声明 cost 默认全零（`provider-composer.js:71`）；`calculateCost` 就地写 `usage.cost` | `laneModelProvider.mts` 是 pi provider 唯一装配点；`:81-89` 把目录单价换成 pi 的 `ModelCost`，缺价目写全零占位，真正的断言由 `pricingBasis` 带出去 | 一致（G-10 已关闭） | — |
| 凭据 `auth.json` 0600 明文；归属头 `HTTP-Referer: pi.dev` 在 CLI 层（`pi-coding-agent/dist/core/provider-attribution.js:33`） | `laneModelProvider.mts:138-151`：凭据走 Nomi 加密存储；lane 直接用 pi-ai 的 `createProvider`，不经归属头那层（抓包未做） | 有意不同（领域：桌面应用，密钥归 Nomi 加密存储） | — |
| 默认模型：`defaultProvider` / `defaultModel`（`settings.md:30-31`，启动用的 LLM） | Agent 自己的文本模型 `assistantModelPref`；另有「用户为各生成任务声明的默认生成模型」（`laneDesktopModelDefaults.ts:1-18` → `generationDefaultModelResolver`） | 有意不同（领域：Nomi 有两种模型——驱动 Agent 的文本模型，和 Agent 替用户调用的图像 / 视频生成模型；pi 只有前一种） | — |
| 思考档位 7 档；`getContextUsage()` 压缩后有「不可知」第三态 | `LaneMetric` 三态 known / unknown / not-applicable（`laneContracts.ts:196-215`） | 一致 | — |

### 控制流

| 它怎么做 | 我们怎么做 | 判定 | 若没想到补在哪个阶段前 |
|---|---|---|---|
| steer 在下一次请求前注入，followUp 在内层循环跑干后；harness 队列默认 `"all"` | `laneHost.mts:294-295` 显式 `one-at-a-time`；`:652-685` 按「在跑 / 有卡在等 / 空闲」分流给 `lane.steer` / `lane.followUp` | 一致 | — |
| 重试 `RetryPolicy = {enabled, maxRetries, baseDelayMs}`，没有分类器钩子，判据是英文 40 条正则（`pi-ai/dist/utils/retry.js:167-174`） | `laneHost.mts:78` 只给配置；`laneProviderGuard.mts:1-40` 把中文供应商报文追加上游认得的英文标记，不替换原话 | 有意不同（领域：中转供应商错误是中文且状态码混用，重试等于再花一次真钱；pi 唯一的口子是改输入文本） | — |
| 库路径无超时；CLI 默认 `httpIdleTimeoutMs` 300s（`settings.md:176`），设全局 undici dispatcher | `laneProviderGuard.mts` + `laneStreamObserver.mts`：首字节 90s / 空闲 120s 两个看门狗（`laneHost.mts:67-68`），没有默认值 | 有意不同，先不动（领域：流卡住 lane 会永远转圈；能否用 pi-ai 的 `timeoutMs` 透传替掉一半，半天 spike 再定） | — |
| 中断：`AbortResult` 原样还回未消费的输入；被中断工具写合成结果；崩溃恢复写「外部结果未知」标记（`harness/runtime/drive/tools.js:7, 99-113`） | `laneRestoredInput.ts` 把取消返回的输入还给输入框；`laneApprovalGate.ts:1-20` 三条踩坑（被打断必须 resolve 不能 reject、等待中的 promise pi 不替我们打断、等待期记录不会被 abort 冲出去） | 一致 | — |
| harness 的 `before_tool` 只是钩子，没有对话框 | `laneApprovalGate.ts`（443 行）：`hold()` 停在 `before_tool` 里等人，四个动作、七种结局（`laneContracts.ts:497-512`） | 有意不同（领域：花钱 / 写画布要批准；pi 的对话框协议属于 AgentSession 栈，形状照它） | — |

### 扩展 API

| 它怎么做 | 我们怎么做 | 判定 | 若没想到补在哪个阶段前 |
|---|---|---|---|
| harness 钩子面：`before_run` / `before_tool` / `after_tool` / `before_request` / `before_payload` / `transform_context` / `before_compaction`；`tool_call` 是唯一 fail-closed 的钩子 | `laneHost.mts:382-412, 499` 注册这些钩子；审批抛异常按拒绝处理（`laneApprovalGate.ts:210, 341`） | 一致 | — |
| `appendCustomEntry` + `entryProjectors` 决定哪些进模型上下文 | `laneHost.mts:120-121, 297`：`nomi.ui.*` 不进、`nomi.ctx.*` 进，名字即判据，装配期校验 | 一致 | — |
| 在工具跑到一半插 custom entry，会插进 toolCall 与 toolResult 之间（G-16） | `laneReceiptAuthority.mts:5-20` 明说 before_tool 里的写已耐久、但到工具边界后才进转录，故同时读 queues | 一致 | — |
| 扩展运行时（`ExtensionRunner`、`pi.registerTool`、slash command） | 不跑；Nomi 的扩展是 MCP 与技能 | 有意不同（领域：用户是创作者，不装 TypeScript 扩展；对外集成走 MCP） | — |

### 观测与测试

| 它怎么做 | 我们怎么做 | 判定 | 若没想到补在哪个阶段前 |
|---|---|---|---|
| 不写常驻运行日志；遥测是 callback-scoped span，默认关 | `laneTrace*.mts` 只是 pi 条目的可重建视图，不是第二个写者；`electron/telemetry/trajectoryProjection.ts` 做字段白名单出站 | 有意不同（领域：桌面应用 + 隐私承诺，「数据只去我们的端点」需自证） | — |
| 三套随包 conformance suite，runner 无关 | 零成本替身见 `electron/agentLane/*.test.ts` | 一致，待核（本次未核三套 suite 是否都在跑） | 0.24 前核一遍 `createStorageConformance` 是否压过我们注入的 `FileSystem` |
| 上游没有工具调用正确率评测 | 铁律走查 + 工具写对率指标 | 有意不同（领域：Agent 改动必须带工具写对率与回合成功率） | — |

### 安全

| 它怎么做 | 我们怎么做 | 判定 | 若没想到补在哪个阶段前 |
|---|---|---|---|
| 没有内置沙箱（`security.md:31-37`）；project trust 只管加载项目本地配置；提示词注入是预期风险；路径零包容 | `laneCodingSandbox.mts:1-27`：bash 的 OS 沙箱照 pi 的 sandbox 示例接同一个包，只出策略；Windows 上不假装有沙箱，`active:false` 后自动放行档整档消失；`laneCodingPaths.mts` 路径包容；审批闸 + 硬闸 | 有意不同（领域：打包桌面应用、花用户的钱、MCP 宿主；pi 信任本机用户，我们不能） | — |
| 无 | 内部 agent 够得着但批不动付费闸；`laneHost.mts:554` 没有 target 就没有 surface 权限（fail-closed）；`projectAgentProposalReceiptStore` 的 `preparing → committed → undoing → undone` | 有意不同（领域：画布写入要回执和撤销） | — |

### 裁剪说明

未裁剪，九层全在。

## 四个问题

### 问 1：我们碰到过的 Agent 问题，pi 里有没有现成的解法

| 问题 | 我们（file:line） | pi 有没有 | 结论 |
|---|---|---|---|
| 上下文超窗（#945） | `laneContextBudget.mts:12-18`；#945 的 `laneContextFit.ts`（接 `transform_context`） | 有一半。pi 在同一个 run 内每批工具后量并压（`compaction.md:33-35`；`checkpoint.js:60`），溢出时压一次重试一次（`response.js:139-143`），能把超大回合拆成前缀摘要 + 保留尾巴（`compaction.js:420-440`）。pi 没有的是「不摘要、只把旧的大工具结果换成占位」。用户看到的 `Assistant request exceeded the context window` 恰是 pi 在「已用过一次溢出恢复」或「没有可压的」时写的串 | 先做实验再定留删：拿 pb04 那段 146K 的真实转录在 pi 的 `prepareCompaction` 上重放——(a) 阈值压缩本该在哪批工具后触发、有没有触发；(b) 摘要请求本身会不会超窗。(a) 没触发 = `laneCompactionSettings` 的换算问题，改配置；(b) 超窗 = 把收起放在摘要之前；都正常 = 删 #945 的收起。#945 注释里的前提必须改对 |
| 写入回执卡死 | `projectAgentProposalReceiptStore.ts:180, 350-405`；`laneReceiptAuthority.mts` | pi 对工具调用本身有耐久恢复：中断的工具补合成结果，带「外部结果未知」标记（`tools.js:7, 99-113`）；工具可通过 `onUpdate` 写耐久进度快照（`tools.js:263, 355`）。pi 没有「渲染层应用画布写入后回执、可撤销」这个语义 | 保留回执生命周期（领域）。可借：长写入用 `onUpdate` 把 preparing 写进 pi 检查点，崩溃恢复由 pi 补「结果未知」，我们只补领域那一半。#945 的已知拒绝落终态是这条线上的正确补丁 |
| 附件 | `laneDesktopAttachments.ts`、`laneDesktopInput.ts`（字节只在供应商请求时解析，落盘的是不可变素材声明） | pi 支持 `images: ImageContent[]` 随 prompt / steer / follow_up（`sdk.md:187-209`；`rpc.md:51-112`），没有素材库，不落声明 | 有意不同（领域：附件是项目素材库里的素材，转录只存 id 声明，重开后按当前素材解析）。交给供应商时仍是 pi 的 `ImageContent` 形状 |
| 默认模型 | `laneDesktopModelDefaults.ts:1-18`；`laneModelContext.ts` | pi 只有一种默认（驱动 LLM，`settings.md:30-31`）；「各生成任务的默认生成模型」pi 没有 | 保留（领域）。模型被告知的默认与宿主补的默认由同一个函数回答 |
| Windows 命令沙箱起不来 | `laneCodingSandbox.mts:21-27` | pi 没有内置沙箱（`security.md:31-37`），Windows 靠 Git Bash（`shellPath`）或 `powershell` 工具（`windows.md:1-40`） | 先分清是哪一个问题：没有 bash 可用 → pi 有现成解（接 `createPowerShellTool`，不自研）；OS 沙箱起不来 → pi 也没有，我们的 `active:false` 降级就是答案。0.23 内定位 |
| Agent 先用文字问「要生成吗」而不出卡 | `laneAskUserTool.ts`；`lanePromptSections.ts` | pi 没有这种机制；手段是工具的 `promptGuidelines` 与 `before_tool` 拦截（`extensions.md:792-809`） | 工具设计 + 提示词问题，不是框架问题。用 `promptGuidelines` 写明「要用户确认就出卡，不要文字问」，走查加断言 |
| Agent 话里念 id | `laneModelContext.ts`（标题↔id 索引）；`laneContextBudget.mts:44` | pi 没有；只给 content / details 两个口，不管模型嘴里说什么 | 提示词 + 压缩指令（压缩提示词已写「用户用标题称呼节点，不要编 id」）；补一条工具 `promptGuidelines` |
| 服务商原始 JSON 报错直接摆给用户 | `laneProviderGuard.mts`；`src/workbench/observability/classifyError.ts`；`details.failure` 信封 | pi 只有 `errorMessage` 原文 + 英文正则判重试（`retry.js:167-174`），没有面向用户的措辞 | 保留（领域：多语言 + 中转供应商）；`failure` 信封按 `code` 查 i18n 是对的做法 |
| 付费卡每 1.5 秒轮询；「等用户」有两三种表示 | 轮询 `useAgentPanelSpendConfirm.ts:52`；等待在 `laneApprovalGate.hold`（`laneContracts.ts:490-512`）；卡内容 `productionPendingSpend.ts`；ask_user 也是 hold | pi 的待决确认只有一种：id 匹配、阻塞、可超时、可取消（`rpc.md:1184-1260, 1352-1376`） | 照 pi 收成一种表示。「等」已经只有一个 owner（审批闸）；剩下的是卡内容的读取方式（轮询）与 ask_user 的卡。0.24 B 去掉轮询 |

### 问 2：0.24 的 B 和 C1 能不能直接照 pi 的机制做

能，不需要新依赖。pi 里真的可用 / 不可用的：

| pi 的机制 | 我们进程里能不能用 | 用法 |
|---|---|---|
| 转录：toolCall 段 + 独立 toolResult 消息，`toolCallId` 配对 | 在用 | C1 的数据来源，不用改 |
| `tool_execution_start / update / end`，`partialResult` 是累计值（`rpc.md:1012-1055`） | harness 有同类事件，投影已整体重推 | 合并段的「输出」直接取累计值 |
| `before_tool` 里 hold | 在用（`laneApprovalGate`） | B 的「等」不变，仍只有这一个 owner |
| `extension_ui_request / response`（按 id 匹配、阻塞、超时落默认值、cancelled） | 协议形状可抄，代码不能用（属于 AgentSession + 扩展运行时，harness 没有） | 我们的 `hold` 已是同一个形状；不要为了「接入 pi 的确认协议」去跑 pi 的 RPC 子进程 |
| `appendCustomEntry` + `entryProjectors` | 在用 | 付费卡的引用可以走它（按 id 不复制状态），`task` 段已是这个做法（`laneContracts.ts:126-135`） |
| 工具 `onUpdate` 耐久进度快照 | 可用 | 写类工具的 preparing 进度 |

**B（付费卡并进对话投影）**
1. 「等」不动：它已经在 `laneApprovalGate.hold` 里，且是唯一 owner。
2. 「卡内容」不进转录（会冻成第二份真相），按引用 join：投影时按 `toolCallId` / `operationId` 去 Run 账本读一次，和 `task` 段同款。
3. 去轮询：Run 账本变化通过事件触发重投影（laneHost 已在 lane 事件上推完整投影），渲染层 `useAgentPanelSpendConfirm` 退化成「读投影里这一段 + 本地改动账本」。删轮询前必须先枚举有没有不走 lane 的待决付费来源（#930 §10 第 6 条，例如分镜编辑器的「提交执行计划」）——这是唯一没核实的前置。
4. 为什么不能直接用 pi 的 `confirm`：我们的卡是可编辑的报价（逐镜改参数、范围选择、重新封印），用户点头前要能改，且必须跨重启存活；Run 账本耐久，闸本身只活在 laneHost 内存（`laneContracts.ts:460`）。这是领域约束。

**C1（一次调用一条）**
1. 数据已齐：`tool-call`（`laneContracts.ts:75`）、`LaneProjection.pending`（按 `toolCallId`）、`tool-result`（`:83`）。
2. 在投影层 `laneProjection.ts`（纯函数、零运行时依赖）把同一 `toolCallId` 的三者合成一个段，字段名对齐 AI SDK 的 `ToolUIPart`：`type: tool-<name>`、`toolCallId`、`state`、`input`、`output`、`errorText`、`approval?`。
3. 状态映射：running → `input-available`；pending → `approval-requested`；有结果 → `output-available` / `output-error`；拒绝 / 改口 / 被停 / 关窗 / 重启——AI SDK 只有一个 `output-denied`，但这几种文案必须不同（#930 A3），所以合并段额外带我们的 `outcome`（`laneContracts.ts:497-512` 的七种结局），不压成一个词。
4. 取舍：

| 方案 | 好处 | 代价 |
|---|---|---|
| 主进程 pi 原生形状，投影层输出 ToolUIPart 形状的本地类型（推荐） | 不动 pi 层；不引入 `ai` 类型（主进程钉 `ai@4`，AI Elements 要 v6）；以后换 SDK 真类型只是一行 `import type` | 要维护一个与 ToolUIPart 同名字段的本地类型，登记成带到期日的债（#930 §8） |
| 主进程直接产 ToolUIPart | 少一层映射 | 主进程要认识 UI 词表，与「投影层纯函数、渲染层零状态机」相反，还会引入 `ai` 版本问题 |
| 跑 pi RPC 子进程，吃它的 `extension_ui_request` | 协议现成 | 多一个进程、丢掉进程内耐久性、harness 与 AgentSession 两套状态，与「两台发动机收敛」方向相反 |

结论：B 和 C1 都应先做，且都不依赖 AI SDK / AI Elements 的最终取舍。pi 给的是形状与不变量（id 配对、阻塞到回复、取消是一等结局、永不复制状态），不是可以直接拿来跑的代码。

### 问 3：「自己写了什么」清单

| 模块（行数） | pi / AI SDK 的对应能力 | 推荐 |
|---|---|---|
| `electron/ai/streamTextTask.ts`、`buildAiSdkModel.ts`、`vendorLanguageModel.ts`、`aiSdkVendorError.ts`（约 530 行，文本任务走 AI SDK `ai@4`） | lane 已走 pi-ai；`laneSingleShot.mts`（46 行）已是「一次 provider 调用，无循环无会话」 | **改成接入**：文本任务改走 pi-ai 单次调用，删 AI SDK 栈与 `ai@4` 钉死。大改动（`textStreamIpc.ts` / `customCallDispatch.ts` / `apimartTexts.ts` / `shotVerifyDeps.ts` 等调用方）。这是 0.24「两台发动机收敛」本体，也是 AI SDK 版本裁决的前置 |
| `useAgentPanelSpendConfirm.ts`（395 行）里的 1.5 秒轮询 | 事件触发重投影 | **改成接入**：见问 2 B。删轮询，保留本地改动账本（领域）。中等 |
| 合并 tool-call / pending / tool-result 三处（`laneViewModel.ts` 502 行的一部分） | ToolUIPart 形状 | **改成接入形状**：见问 2 C1。大，但范围有界 |
| `laneContextFit.ts`（#945，108 行） | pi 的 `transform_context` 口（在用）+ 阈值压缩 | **先不动，做实验**：合并前注释改对；做重放实验再定留删 |
| `laneContextBudget.mts`（51 行） | pi 的 `compact` + `CompactionSettings` | 保留（已是配置 + 领域摘要指令） |
| `laneApprovalGate.ts`（443 行） | pi 只有 `before_tool` 钩子；对话框协议在 AgentSession 栈 | 保留（领域：花钱 / 写画布审批、七种结局） |
| `laneProviderGuard.mts`（176）+ `laneStreamObserver.mts`（134） | pi 库路径无超时；重试判据无钩子 | 保留中文报文归一（领域）；看门狗先不动，半天 spike 看能否用 pi-ai `timeoutMs` 透传替掉一半 |
| `laneRepeatedFailure.mts`（131） | 无 | 保留（领域：连发同一次真钱调用） |
| `laneToolSchema.mts`（272）+ `laneTools.mts`（290）+ `laneToolGroups.mts`（126）+ `lanePromptSections.ts`（87）+ `laneToolCatalog.ts`（63） | pi 工具定义 / 三条通道 / `addedToolNames` | 保留（已是对 pi 形状的适配，不是第二份工具系统；领域能力契约是我们的） |
| `laneCodingTools.mts`（334）+ `laneCodingPaths.mts`（127）+ `laneCodingSandbox.mts`（285） | pi 的 7 个 coding 工具、sandbox 示例同一个包 | 保留；**补 Windows**：接 pi 的 `createPowerShellTool` / `shellPath` |
| `laneSession.mts`（260）+ `laneFileSystem.mts`（104）+ `laneHistory*.mts`（139） | pi 的 `JsonlSessionRepo` / Session API | 保留（适配层；0600 与原子替换是领域加固） |
| `laneWorkspace.mts`（279）+ `laneWorkspaceSelection.ts`（29） | pi 的会话列表归 repo，没有项目选择 | 保留（领域：一个项目多条对话） |
| `laneSkillCatalog.mts`（383）+ `laneSkillPrompt.mts`（41） | pi 的 `loadSourcedSkills` / `formatSkillInvocation`（在用） | 保留（只做投影与策略） |
| `laneLegacy*`（共 860 行） | 无 | 保留到迁移窗口结束，之后整体删 |
| `laneTrace*.mts`（389） | pi 的 custom entry | 保留（可重建视图，非第二写者） |
| `laneIpc.ts`（217）+ `laneCommandCodec.ts`（116）+ `laneRuntimePort.ts`（273）+ `laneNativeLoader.cts`（41） | pi 包是 ESM-only，主进程只能动态 `import()` | 保留（Electron CJS/ESM 接缝，不是重造） |
| `src/workbench/ai/lane/laneClient.ts`（渲染层订阅，零状态机） | pi 的事件 / 快照 | 保留 |

### 问 4：pi 没有、必须我们自己设计的（Nomi 的独有价值）

1. 按镜头花钱确认：可编辑的报价卡、范围选择、逐镜参数修订、重新封印报价，不点头就不派发。pi 的确认只有 yes / no / 文本。
2. ProductionRun：多镜头批量的持久编排（调度、暂停收尾、停下原因、返工 / 续拍、预算账本）。pi 的 run 是单个对话回合。
3. 画布 / 分镜 / 时间轴领域工具，及「写入回执 + 撤销」（`preparing → committed → undoing → undone`）。
4. 模型目录与中转适配：多供应商、中转地址可编辑、目录单价换成 `ModelCost`、中文报文归一防重复付费重试。
5. 审批档位与硬闸：工作模式 / 自动改档位、`alwaysAsksUser`、内部 agent 够得着但批不动付费闸。
6. 项目绑定的多对话工作区与表面权威（没有 target 就没有写权限）。
7. 附件作为不可变素材声明（转录里存 id，字节只在供应商请求时解析）。
8. 生成默认模型的声明与可用性闸（生成模型 ≠ 驱动 Agent 的 LLM）。
9. 压缩指令里的领域锚点（节点 id、modelKey / modeId / 分辨率、「审批与完成声明只是历史描述」）。
10. 失败话术的 i18n 与归属（`failure` 信封按 `code` 查词条，失败属于发出去的那一次）。
11. MCP 宿主面：对外集成，pi 刻意没有 MCP。
12. 隐私自证：字段白名单投影、同意合同、数据只去我们自己的端点。

## 09-07 的 24 条「没想到」现状

「待核」= 本次没逐行核对，不算关闭。

| # | 状态 | 证据 |
|---|---|---|
| G-01 根级 anyOf | 已关闭 | `scripts/check-model-schema.ts:72`（`root-union` 规则）；`laneToolSchema.mts` 单一生成点 |
| G-02 失败必须 throw | 已关闭 | `laneDesktopTools.ts` |
| G-03 描述三通道 | 已关闭 | `lanePromptSections.ts:1-87` |
| G-04 输出截断 | 已关闭 | `laneTools.mts` 引用 pi 的 `truncateHead` / `formatSize` |
| G-05 枚举 | 已关闭 | `scripts/check-model-schema.ts:73, 82, 208`（`const-instead-of-enum`） |
| G-06 旧形状折旧 | 已关闭 | `modelArgumentTolerance.ts:11-28`；`laneCanvasTools.ts:6` |
| G-07 路径包容 | 已关闭 | `laneCodingPaths.mts` |
| G-08 唯一校验点 | 待核 | 见 `modelArgumentTolerance.ts` 头注释；未逐行核「不在转换器后再接严格 zod parse」 |
| G-09 `addedToolNames` | 已关闭 | `laneNativeAssembly.mts` 头注释 |
| G-10 cost 默认 0 | 已关闭 | `laneModelProvider.mts:81-89` |
| G-11 看门狗 vs 重试 | 已关闭 | `laneProviderGuard.mts:1-40` |
| G-12 中文报文归一 | 已关闭 | 同上 |
| G-13 审批 fail-closed | 已关闭 | `laneApprovalGate.ts:210, 341`；`laneHost.mts:554` |
| G-14 整批工具审批语义 | 待核 | 只见 `laneTools.mts:218-222` 的 `executionMode`，没看到「拒一个是否拒整批」的显式决定 |
| G-15 customType 进不进上下文 | 已关闭 | `laneHost.mts:120-121, 297` |
| G-16 custom entry 插进 call 与 result 之间 | 已关闭 | `laneReceiptAuthority.mts:5-20` |
| G-17 上下文占用三态 | 已关闭 | `laneContracts.ts:196-215` |
| G-18 同会话打开两次 | 部分 | `laneSession.mts:57, 201` 知道并说明；「单一持有者」断言待核 |
| G-19 原子替换 | 已关闭 | `laneFileSystem.mts` |
| G-20 会话 0600 | 已关闭 | `laneFileSystem.mts:1-10` |
| G-21 归属头 | 部分 | 代码侧不经 `provider-attribution.js`；抓包未做 |
| G-22 压缩提示词领域化 | 已关闭 | `laneContextBudget.mts:35-47` |
| G-23 助手消息拆多段 | 已关闭 | `laneProjection.ts` 逐 `contentIndex` 发段 |
| G-24 队列模式 | 已关闭 | `laneHost.mts:294-295` |

**没想到清单（实施阶段的前置门）**

| # | 没想到的那一层 | 参考实现 | 补在哪个阶段前 | 状态 |
|---|---|---|---|---|
| N-1 | Windows：PowerShell 工具 / `shellPath` | `docs/windows.md:1-40`；`dist/core/tools/index.d.ts:7` | 0.23：先定位 Windows 沙箱问题，确认缺 bash 就接 | 未补 |
| N-2 | 一次工具调用一个段（审批并入同一个段） | `rpc.md:1184-1260`；转录按 `toolCallId` 配对 | 0.24 C1 | 未补 |
| N-3 | 付费卡去轮询、事件触发重投影 | 同上 | 0.24 B（前置：枚举不走 lane 的待决付费来源） | 未补 |
| N-4 | 上下文超窗：先确认 pi 的回合内阈值压缩有没有触发 | `compaction.md:33-35`；`checkpoint.js:60` | 0.23：#945 的重放实验 | 未补 |
| N-5 | 两台 LLM 调用栈（`ai@4` 与 pi-ai） | `laneSingleShot.mts` 已是 pi-ai 单次调用 | 0.24「两台发动机收敛」 | 未补 |
| N-6 | G-08 / G-14 / G-18 / G-21 的待核项 | 见上表 | 0.24 前各核一遍 | 待核 |

## 开放问题

- **进程内改用 `AgentSession`（`createAgentSession()`）而不是 `AgentHarness`**：pi 自己的 CLI 和官方文档都走 `AgentSession`，它带着扩展运行时、对话框协议、压缩编排等；我们 09-07 选了更底层的 `AgentHarness`。本报告只比较了「跑 RPC 子进程」这一种接入方式，没有评估进程内 `AgentSession`。需要单独评估：它能替掉我们哪几块、会丢掉什么（耐久性、custom entry、项目绑定的工作区）、09-07 的选择今天是否还成立。

## 建议的先后

| 时机 | 做什么 | 规模 |
|---|---|---|
| 0.23 内 | 问 1 第 1 条的重放实验（半天）；改 #945 注释里「pi 只在回合之间量一次」那句；定位 Windows 沙箱问题 | 小 |
| 0.23 内 | `framework-boundaries.json` 的 pi 条目登记 `referenceConformance`，删掉泛泛的 pi 对照欠账（本 PR） | 小 |
| 0.24 B / C1 | 问 2 的做法；同一刀里把 1.5 秒轮询换成事件触发 | 中 / 大 |
| 0.24 两台发动机收敛 | `electron/ai/` 的 AI SDK 栈改走 pi-ai 单次调用 | 大 |
| 0.24 之后 | 看门狗用 pi-ai `timeoutMs` 透传能否替掉一半（半天 spike）；`laneLegacy*` 迁移窗口结束后整体删；评估进程内 `AgentSession` | 小 / 中 |

## 自检

- 每一格「它怎么做」都有 `file:line` 或文档位置；09-07 已有的细节处引用，不重抄。
- 不是全「一致」也不是全「有意不同」：「没想到」出现在 Windows、合并段、付费卡轮询、两台调用栈。
- 每条「有意不同」的理由都是领域约束（花钱 / 画布写入回执 / 项目绑定 / 中文中转供应商 / 桌面隐私承诺）。
- 没读和没实测的，明着标在 §0 和「待核」里。
