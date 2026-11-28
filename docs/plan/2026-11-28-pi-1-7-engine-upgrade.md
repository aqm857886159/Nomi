# pi 1.7.0 内核升级与自写胶水清退（设计卡）

> 状态：已实现待验证

改动名：`@earendil-works/pi-*` 升级至 `1.7.0` 并同提交清退自写胶水　线/负责人：impl-pi-1-7-upgrade　类别：[长跑][可打断][其他]（内核引擎升级，路由命中长跑/可打断、Agent 行为、数据格式、性能）

## ★0 先查别人

1. `docs/research/2026-10-01-pi-coding-agent-reference-conformance/report.md:52` · 上游 `pi-coding-agent@1.7.0` 原生提供 `createPowerShellToolDefinition` / `createLocalPowerShellOperations` 与 `SessionManager` v3（含 `appendContextEdit` 原生上下文覆写），并移除 `0.85.1` 的 `pi-agent-core/harness` 与 `@earendil-works/chord` · **改了**我们的会话与工具宿主层：直接迁入 `Agent` + `SessionManager` v3，删除 `electron/agentLane/laneSupersededReads.mts` 自写折叠器，改调 `SessionManager.appendContextEdit`，并在 Windows 路径正式接线 `powershell` 工具。
2. Google Gen AI SDK 官方文档（https://googleapis.github.io/js-genai/ ）· `@google/genai@3.6.1` 在 `HttpOptions` 中原生支持自定义 `fetch` 与 `Part.inlineData`（含 `application/pdf`），且内部自动追加 `/v1beta` API 版本段 · **改了** `electron/ai/vendorModelConnection.ts:1`、`electron/ai/nativePdfPayload.ts:1` 与 `electron/catalog/modelDeclaration.ts:1`：开启 Google Gemini 自定义 `fetch` 代理/本地回环直通、剥除重复末尾 `/v1beta` 并开放原生 PDF `inlineData` 注入。
3. JSON Schema Draft 2020-12 与 `@earendil-works/pi-schema`（https://json-schema.org/draft/2020-12/schema ）· `pi 1.7.0` 全线从 `typebox` 迁至零依赖 `@earendil-works/pi-schema`（`CoercingValidator` + `formats`），由上游统一承担工具入参校验与类型收敛 · **改了** `electron/agentLane/laneToolInputBoundary.mts:1` 与 `package.json:1`：删除对 `typebox/value` 的运行时依赖，统一走 `@earendil-works/pi-schema`，将 `typebox` 移出主进程生产依赖闭包。
4. `electron/agentLane/laneSession.mts:1` 与 `electron/agentLane/laneLegacyMigration.mts:1` · 仓内旧转录单向迁移采用原子临时文件写盘加备份/幂等重入，读路径在项目冷打开阶段保持零写盘 · **确认了** `electron/agentLane/laneSessionV4Migration.mts:1` 的 `0.85.1` v4 JSONL → `SessionManager` v3 JSONL 迁移策略：仅在写路径或会话已有旧 v4 头时原子升级，空项目冷打开不落任何会话文件。
- 出口：electron/agentLane/laneNativeApproval.ts:1 · Windows PowerShell 工具未受 macOS Seatbelt / Linux bubblewrap 包裹，与未沙箱 bash 一样挂入同一审批闸（在 `beforeToolCall` 阻塞等待用户确认，用户拒绝、点停止或关闭窗口时立即释放等待并返回取消/拒绝结果） · 确认了接线 `createPowerShellToolDefinition` 时复用同一确认闸与取消出口

## ★1 用户怎么用

当我在已有项目或新项目中打开 Nomi Agent 对话、发送多模态附件、执行画布/读写/命令行工具、中途点停止或触发长对话自动压缩时，我想所有对话历史、工具审批、流式回复和恢复行为无缝工作，以便底层引擎升级对创作过程零打断。

1. 打开已有项目（含 `0.85.1` 落盘的 v4 JSONL 会话或更早版本项目）：冷打开阶段只读不写盘；打开存在 v4 会话的对话时单向无损升级为 `SessionManager` v3，历史消息、分支、压缩摘要、自定义笔记与模型/思考档位完整保留。
2. 发送普通文本或带图片/PDF 的消息：走 `pi-agent-core@1.7.0` `Agent` 循环流式输出；Google Gemini 线路原生透传自定义 `fetch` 与 PDF `inlineData`。
3. 调用画布/分镜/编码工具：工具入参经 `@earendil-works/pi-schema` `CoercingValidator` 校验；重复读同一资源时由 `SessionManager.appendContextEdit` 原生折叠旧读结果，原始转录不改写。
4. 在 Windows 环境解锁编码工具组：`powershell` 工具正式可用，且因无 OS 沙箱包裹强制走用户逐次确认闸。
5. 运行中点停止、排队 steer/followUp、或崩溃重开：未消费队列输入原样归还，未完成工具调用在重开时写入中断恢复提示并释放审批等待。

**不做什么 + 已知坑：**
- 不引入尚处 Experimental 阶段的 `@earendil-works/pi-durable`；
- 不改任何 UI 组件布局、设计 token 或拍板图元素；
- 不在 `phase: "open"` 冷打开路径静态引入 `pi-coding-agent` 顶层 CLI 入口（通过子路径 `./core/session-manager.js`、`./core/compaction/compaction.js`、`./core/skills.js` 保持 CLI/TUI 零加载）；
- 已知坑：根包未设 `"type": "module"`，`tsx` 脚本以 CJS 加载 `.ts` 时不能顶层 `require()` 纯 ESM 的 `@earendil-works/pi-schema`——`laneToolGroups.mts` 的工具参数采用纯 JSON Schema 字面量，校验器只在 ESM `.mts` 边界按需运行。

**真实任务与指标（每个指标点名量具）：**
- 真实任务 ①：多轮流式对话 + 工具调用 + 重复读资源折叠 + 中途 `abort` + 显式压缩全链路闭环（量具：`electron/agentLane/pi17RuntimeRegression.test.ts` 与 `pnpm run test:agent-runtime`）。
- 真实任务 ②：真实 `0.85.1` v4 会话 JSONL（含消息、工具结果、`compaction`、`custom` 笔记、头部模型与思考档位）打开并继续对话无损迁移至 v3（量具：`tests/agent-runtime/lane-v4-session-migration.test.mts`）。
- 真实任务 ③：Google Gemini 自定义 `fetch` `/v1beta` 归一与原生 PDF `inlineData` 载荷注入（量具：`electron/agentLane/pi17RuntimeRegression.test.ts`、`electron/ai/nativePdfPayload.test.ts`）。
- 主指标（目标 → 信号 → 指标）：`pi 1.7.0` 框架接触面与边界合规率 → 公开字段裁决覆盖比例 → `53/53`（100%）有显式裁决且 0 越界调用（量具：`pnpm run check:framework-surface`、`pnpm run check:framework-boundary`）。
- 质量指标（目标 → 信号 → 指标）：存量 v4 会话升级保真率与运行时契约通过率 → 迁移后消息/笔记/压缩摘要保留比例与运行时测试通过比例 → 100%（量具：`pnpm run test:agent-runtime`、`electron/agentLane/pi17RuntimeRegression.test.ts`）。
- 护栏指标（目标 → 信号 → 指标）：项目冷打开 CLI 入口混入数 = 0、冷打开会话目录写盘次数 = 0、主进程运行时依赖闭包缺失数 = 0、模型可见全部常驻工具 schema 预算 ≤ 10000 token（当前 9761 token）（量具：`tests/agent-runtime/lane-open-graph.test.mts`、`pnpm run check:packaged-deps`、`pnpm run check:model-schema`）。
- 线上真实模型意图准确率：未验证：缺量具（真模型评测属付费层 `evals/`，本 PR 为纯内核依赖升级，未改提示词与工具契约文案）。

### ★1b 连带界面

不新增或修改任何界面组件与用户可见文案。投影层 `electron/shared/agentLane/laneProjection.ts` 输入迁至中立契约 `electron/shared/agentLane/laneSnapshotTypes.ts`，输出的 `LaneProjection`（消息顺序、工具回执、待决审批卡、历史分页、错误分类）与升级前逐字段一致；设计实验室夹具 `src/devlab/designLab/v4/` 同步对齐中立快照类型。

### ★1c 老用户

- **已有 `0.85.1` v4 会话数据的老用户**：`electron/agentLane/laneSessionV4Migration.mts` 在 `openLaneSession` 打开会话文件时自动检测 `format: "v4"` 头部，将全部 `entry`（`message`、`compaction`、`custom`）及头部 `configuration`（模型、思考档位）无损转换为 `SessionManager` v3 JSONL（`version: 3`，保持因果链 `parentId` 与原始时间戳），经同目录临时文件原子替换原文件；已经是 v3 的文件零开销跳过；坏行或非 v4 文件保持现有容错路径不断供。
- **更早期 legacy 对话记录的老用户**：`laneLegacyMigration.mts` / `laneLegacyImportLane.mts` 已同步迁至 `SessionManager` v3 写入接口，升级体验不变。
- **老用户的模型目录与自定义中转设置**：`modelDeclaration.ts` 与 `vendorModelConnection.ts` 保持既有供应商配置兼容，并为 Google Gemini 补齐自定义 `fetch` 与 `/v1beta` 尾部去重，原本配了 `/v1beta` 后缀的自定义地址不会拼成 `/v1beta/v1beta`。

## ★2 谁说了算

| 概念 / 事实 | 唯一主人 | 允许的消费者 | 保持「1」的机制 |
|---|---|---|---|
| Agent 会话落盘与 v4→v3 升级 | `electron/agentLane/laneSession.mts` + `electron/agentLane/laneSessionV4Migration.mts`（底层唯一落盘实现：`@earendil-works/pi-coding-agent` `SessionManager`） | `laneHost.mts`、`laneWorkspace.mts`、`laneLegacyImportLane.mts` | `check:framework-boundary` 禁止业务层绕过 `laneSession.mts` 直接调 `SessionManager.inMemory/create/open` |
| 重复读工具结果折叠 | `electron/agentLane/laneContextBudget.mts::recordSupersededReadEdits`（概念 `agent-lane.request-input-budget`） | `laneHostDrive.mts` 在工具结果落盘后调用，投影由 `SessionManager.buildSessionContext` 唯一消费 | 同提交删除旧 `laneSupersededReads.mts`，`check:concept-owners` 与 `check:boundary-owners` 守唯一写口 |
| 工具入参运行时校验与错误归一化 | `electron/agentLane/laneToolInputBoundary.mts` + `electron/shared/agentLane/toolInputIssues.ts::issuesFromPiSchema` | `laneHost.mts` 装配全部工具时统一包裹 | 唯一入口包裹 `toolInput.wrap(...)`，上游 `@earendil-works/pi-schema` 编译校验 |
| `Agent` 运行时驱动与审批/重试钩子 | `electron/agentLane/laneHostDrive.mts`（由 `laneHost.mts` 拆分） | 仅 `electron/agentLane/laneHost.mts` | 模块私有装配，同时将 `laneHost.mts` 从文件体积基线彻底销账（24 → 23） |
| Windows PowerShell 审批策略 | `electron/agentLane/laneNativeApproval.ts` | `laneNativeDesktop.mts` → `laneApprovalGate.ts` | `beforeToolCall` 唯一审批闸对 `powershell` 返回强制 `ask`，未获收据不进 `execute` |

没有靠「状态消失」猜测用户意图；取消、steer、followUp 与审批回复均走显式命令入口。

## ★3 一致与复用

- 以前定过什么：`docs/research/2026-10-01-pi-coding-agent-reference-conformance/report.md` 定下「会话、压缩、技能、编码工具全部用 pi 原生能力，只保留花钱审批、路径沙箱与项目级多会话绑定」；其中第 52 行明确记下 Windows 缺 `powershell` 工具接线。
- 三条路选哪条：**换用上游 `1.7.0` 原生能力并同提交删自写胶水**（P0 + P1）：
  1. 删 `electron/agentLane/laneSupersededReads.mts`（自写消息数组折叠器）→ 换 `SessionManager.appendContextEdit`；
  2. 删 `BomTolerantExecutionEnv` / `NodeExecutionEnv` / `createLaneFileSystem` 文件系统包装与 6 参 `adaptPiTool` 胶水 → 换 `pi-coding-agent@1.7.0` 原生 5 参 `AgentTool` 与子路径懒加载；
  3. 删 `electron/agentLane/` 对 `typebox` 的运行时依赖与 `package.json` / `package-budget.json` 中为已移除的 `@earendil-works/chord` 留下的 `esbuild` 打包排除补丁 → 换 `@earendil-works/pi-schema@1.7.0`；
  4. 拆解超长历史债文件 `electron/agentLane/laneHost.mts` 为生命周期宿主 `laneHost.mts` 与运行驱动 `laneHostDrive.mts`，同提交从 `scripts/file-size-baseline.json` 销账。

## ★4 全状态

- 空：新建项目或未发消息时，冷打开不创建会话 JSONL，面板态与升级前一致。
- 加载 / 流式生成中：`Agent` 流式事件实时更新 `LiveLaneOperation`（流式文本/思考段、运行中工具列表、自动重试倒计时），与升级前一致。
- 成功：回合结束落盘 `AssistantMessage` 与自定义回执笔记，重算上下文用量与历史页。
- 失败：供应商错误经 `laneProviderGuard.mts` 分类；不可重试错误当场停止并展示诊断信息，可重试瞬时错误按 `RetryPolicy` 退避重试。
- 部分成功 / 取消中：用户点停止时触发 `AbortController.abort()`，运行中工具收到 `signal` 中止，未消费的排队消息原样退回输入框。
- 过期（旧版 v4 会话）：首次打开自动原子升级至 v3，用户无感知直接继续对话。
- 能力不可用：Windows 无 Git Bash 时编码组仍可通过 `powershell` 工具执行命令（受确认闸保护）；模型不支持原生 PDF 时走既有降级提示，不静默丢附件。

## 5 中途表

| 状态 | 点停止 | 关窗 / 切项目 | 断网 | 进程重启（崩溃恢复） | 连点发送（steer / followUp） |
|---|---|---|---|---|---|
| 流式请求中 | 中止当前流，保留已生成片段或落 aborted，退还未消费排队消息 · 模型按上游实际 token 计 · 转录留 aborted 记录 | `laneHost.close()` 中止在途运行并刷盘延迟笔记 · 不多发新请求 · 转录完整落盘 | `laneProviderGuard` 识别网络中断，瞬时错误有限重试，耗尽后报网络故障 · 不发工具扣费 · 错误段可见 | 重开会话后读取已落盘 v3 JSONL · 无悬空请求 · 历史完整可见 | 按策略入 `steer` 或 `followUp` 队列 · 不并发乱序发请求 · 队列项在快照可见 |
| 工具等待审批中 | `gate.abortAll()` 立即释放等待并标取消 · 0 花费 · 审批卡收起 | `close()` 释放审批闸并落盘取消笔记 · 0 花费 · 下次打开不卡死 | 审批属本地交互不受断网影响 · 0 花费 · 保持等待用户决定 | 重开时 `interruptedToolCalls` 补合成中断结果 · 0 额外花费 · 提示上次未完成 | 新输入进排队并在下轮或工具边界消费 · 未批准工具绝不提前执行 · 队列可见 |
| 工具执行中 | `signal` 透传中止工具并写中断结果 · 已发出的外部任务走既有运行账本恢复 · 回执落盘 | 等待收尾或中止后释放会话锁 · 不丢已落盘回执 · 重开可查 | 本地工具照常返回，网络工具抛错收口 · 失败不重发扣费 · 错误回执落盘 | `interruptedToolCalls` 标记外部结果未知，防盲目重发 · 不自动重复扣费 · 恢复提示可见 | 入队等待当前工具边界结束 · 写工具保持串行 · 顺序确定 |
| 自动压缩中 | `abort` 中止压缩 LLM 调用，保留原未压缩分支 · 仅计已发生摘要请求 · 原历史不丢 | 关闭时中止未完成压缩，不写半截 compaction 条目 · 不破坏 JSONL · 重开仍是完整旧链 | 压缩请求失败回退或报错，不损毁原消息树 · 0 工具花费 · 原消息完好 | 原子追加保证要么有完整 compaction 条目要么没有 · 0 额外花费 · `buildSessionContext` 一致 | 新消息排队等本轮压缩与回复收尾 · 不丢消息 · 队列可见 |

## 6 外部数据与失败

1. `@earendil-works/pi-*@1.7.0` 会话文件（本地 JSONL）：规范为 `SessionManager` v3（`version: 3`）及历史遗留 `0.85.1` v4（`format: "v4"`）。偏差处理：`laneSessionV4Migration.mts` 校验首行头部并逐行容错解析，撕裂尾行忽略，临时文件写完再 `rename` 原子替换。
2. Google Gemini API（`@google/genai@3.6.1`）：规范见 https://googleapis.github.io/js-genai/ 。偏差处理：自定义中转 `baseUrl` 若已带 `/v1beta` 或 `/v1beta/`，在 `vendorModelConnection.ts` 归一剥除末尾 `/v1beta` 防止 SDK 二次拼接成 404；未知上游错误保持原始报文透出，绝不甩锅给用户的 API Key。
3. 模型工具调用入参（JSON）：经 `@earendil-works/pi-schema` `CoercingValidator` 校验，不合 schema 时由 `issuesFromPiSchema` 转为结构化字段错误回传模型自修，不炸宿主进程。

## ★7 性能

- ① 新增用户操作：无（纯底层 Agent 引擎依赖升级与胶水清退，未新增任何界面交互动作）。
- ② 最坏规模：100+ 条历史消息 + 重复大文件读取的已有项目冷打开与多轮工具调用。
- ③ 预算与护栏：冷打开会话目录写盘 0 次、冷打开不加载 `pi-coding-agent` 顶层 CLI 包、模型可见全量常驻工具 schema ≤ 10000 token（实测 9761 token）、主进程打包依赖体积在 `package-budget.json` 预算内（且移除了 `typebox` 运行时与冗余 `esbuild` 排除项）。
- ④ 性能场景：`perf-scenario` 证据按规则填「不适用：纯底层 Agent 引擎依赖升级与旧胶水删除，未新增或改动任何用户交互操作、画布渲染或文件落地规模路径」。

## 8 真实条件

- 免费确定性全链路：`fauxProvider` / 本地回环 HTTP 假上游实跑流式文本、多工具并发与串行调用、重复读 `appendContextEdit` 折叠、中途 `abort`、显式压缩、v4→v3 真实格式会话迁移（`electron/agentLane/pi17RuntimeRegression.test.ts` + `pnpm run test:agent-runtime` 全套）。
- Windows：PowerShell 工具定义、路径解析与强制审批策略已通过跨平台单测验证（`electron/agentLane/` 与 `tests/agent-runtime/`）；Windows 真机进程执行：`unverified`（当前构建机为 macOS）。
- 真付费模型抽检：`unverified`（未碰花钱计价与生成调度，属底层库版本升级）。

## 拍板图

不适用：纯后端 Agent 内核与依赖升级，不新增或修改任何用户可见界面元素、布局、样式或文案。

## ★9 验收与回滚

**验收清单与反例（动手前写全，实现线逐项自验，验收线只核本清单）：**

| # | 检查项 | 反例（怎么改坏必红） | 自验结果与证据 |
|---|---|---|---|
| 1 | `@earendil-works/pi-agent-core` / `pi-ai` / `pi-coding-agent` / `pi-schema` 全部对齐 `1.7.0`，无 `@earendil-works/pi-durable`，`typebox` 移出生产 `dependencies` | 在 `electron/agentLane/` 重新引入 `from '@sinclair/typebox'` 或漏装运行时包 → `check:packaged-deps` / `check:framework-boundary` 红 | 通过：`pnpm run check:packaged-deps`、`pnpm run check:package-budget` |
| 2 | `framework-boundaries.json` 53 个 pi 接触面字段 100% 有裁决，业务层零直接调 `SessionManager.inMemory/open` | 在 `laneHost.mts` 直接调 `SessionManager.inMemory()` 或漏登记新增字段 → `check:framework-boundary` / `check:framework-surface` 红 | 通过：`pnpm run check:framework-boundary`、`pnpm run check:framework-surface` |
| 3 | 自写 `laneSupersededReads.mts` 已物理删除，重复读同一资源改由 `SessionManager.appendContextEdit` 原生折叠，且原始转录保留原值、写动词/失败读不误折 | 让 `recordSupersededReadEdits` 什么都不做 → `laneSupersededReads.test.ts` 断言旧读被折叠红；让它把所有工具结果全部折叠 → 写动词与不同入参保留原值断言红 | 通过：`electron/agentLane/laneSupersededReads.test.ts`、`electron/agentLane/pi17RuntimeRegression.test.ts` |
| 4 | 存量 `0.85.1` v4 会话文件打开时单向原子升级为 v3，消息、工具结果、`compaction`、`custom` 笔记与模型/思考档位零丢失，重开幂等 | 让 `upgradeV4SessionFileIfNeeded` 跳过转换 → `SessionManager.open` 读不出 v4 条目，`lane-v4-session-migration.test.mts` 红 | 通过：`tests/agent-runtime/lane-v4-session-migration.test.mts` |
| 5 | 项目冷打开（`phase: "open"`）零写盘且模块图不混入 `pi-coding-agent/dist/index.js` CLI 入口 | 把 `./core/compaction/compaction.js` 改成静态顶层导入 `@earendil-works/pi-coding-agent` → `lane-open-graph.test.mts` `--assert-no-cli-entry` 红 | 通过：`tests/agent-runtime/lane-open-graph.test.mts` |
| 6 | Windows `powershell` 工具已接线，且在审批策略中与未沙箱 `bash` 一样强制要求用户确认（`ask`） | 把 `powershell` 从 `laneNativeApproval.ts` 漏掉放行 → 审批单测与越权反例红 | 通过：`electron/agentLane/laneCodingTools.mts`、`electron/agentLane/laneNativeApproval.ts`、`tests/agent-runtime/lane-coding-tools.test.mts` |
| 7 | Google Gemini 自定义 `fetch` 透传、`/v1beta` 去重与原生 PDF `inlineData` 生效 | 去掉 `/v1beta` 尾部剥除或把 `supportsNativePdf` 关回 `false` → `pi17RuntimeRegression.test.ts` 与 `nativePdfPayload.test.ts` 红 | 通过：`electron/agentLane/pi17RuntimeRegression.test.ts`、`electron/ai/nativePdfPayload.test.ts` |
| 8 | `electron/agentLane/laneHost.mts` 拆分为 `laneHost.mts` + `laneHostDrive.mts`（均 < 650 行），从 `scripts/file-size-baseline.json` 销账 | 合回单文件超 800 行 → `pnpm run check:filesize` 红 | 通过：`pnpm run check:filesize`、`pnpm run check:boundary-owners`、`pnpm run check:concept-owners` |

**回滚：** 单提交完整 revert 本 PR 合并提交（注意：已在本地升级为 v3 的会话文件仅发生在开发者/升级后打开过的会话；若需回退依赖版本，未打开过的存量会话文件仍保持原状）。

**独立验收：** 合并前由协调会话派独立验收线（非 `impl-pi-1-7-upgrade`）对照 ★9 逐项盲验并回填报告链接与验收 HEAD。

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [x] 新增功能 / 性能
