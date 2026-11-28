# 全维度匿名产品数据闭环（第 1 刀）与反馈包 Agent 故障归因修复 — 设计卡

- 日期：2026-11-28
- 分支：`feat/product-telemetry-funnel-v2`
- 状态：实现中

## ★0 先查别人

1. **OpenTelemetry Semantic Conventions for GenAI（https://opentelemetry.io/docs/specs/semconv/gen-ai/ ，对照本仓 `electron/telemetry/trajectoryProjection.ts:76`）** · OpenTelemetry 规范把 Agent / 模型调用的错误类别约束为低基数闭合分类码（`error.type`，禁止放入异常消息原文、路径或凭据），并把回合级指标与单次工具错误拆层记录 · **对本决定的影响**：直接决定 `trajectoryProjection.ts` 的 `OUTBOUND_ERROR_KIND` 与 `agent.turn.completed` 的 `faultCategory` 只接收闭合枚举 / 小写标识符，不从自由文本做子串透传。
2. **PostHog Privacy-Safe Funnel Documentation（https://posthog.com/docs/product-analytics/funnels ，对照本仓 `electron/telemetry/telemetrySettings.ts:20`）** · 本地优先与隐私导向分析在不采集用户标识与文本内容时，通过固定枚举步骤（如 `prompt_shown -> setup_opened -> key_submitted -> verify_succeeded -> first_generation_succeeded`）与粗粒度安装账龄分桶计算激活转化与断点分布 · **对本决定的影响**：采用固定 6 步闭合 `onboarding.step` 与基于本机 `telemetry-settings.json` 首次创建时间的 `installAgeBucket` 四档分桶，精确时间戳永不出本机。
3. **VS Code Telemetry & Disclosure Architecture（https://code.visualstudio.com/docs/supporting/FAQ#_telemetry ，对照本仓 `electron/telemetry/telemetryClaims.test.ts:41`）** · VS Code 对开启遥测的客户端同时记录动作总分母（回合完成数、重试次数 `retryCount`）与失败细分码，且在设置页提供与代码校验器逐项对账的公开字段说明 · **对本决定的影响**：补齐 `agent.turn.completed`（含 `retryCount === 0` 一次做对率分母）、`timeline.adopted`（生成后真实上轴转化）与 `export.completed.failureReason`，并由 `telemetryClaims.test.ts` 100% 锁死中英告知说明与白名单校验器的一致性。

出口：不引入第三方分析 SDK（P0 隐私承诺要求不经任何第三方、只发 Nomi 自有接收端），沿用现有主进程 `telemetryOutbox` + `telemetryEvents` 闭合白名单与 `intake-radar` 纯函数聚合。

## 设计卡

### ★1 目标与成功指标
- **用户可感知目标**：在零隐私退让（100% 闭合枚举与粗分档区间、物理上装不下提示词/文稿/文件名/路径/密钥/URL/用户 ID、保持告知范围 `TELEMETRY_SCOPE_VERSION = 2` 内）的前提下，消除一键反馈包里 Agent 失败原因与工具失败码全空的盲区，并补齐新手接入、Agent 回合一次做对率、生成结果采纳上轴、导出失败分类与安装账龄分档五大产品漏斗指标，使 `intake:radar` 能直接算出真实转化率与断点。
- **量化判据与量具**：
  1. 反馈包 Agent 投影：历史与新建会话中的立即工具失败（形状拒收、熔断拦截、领域准备拒收、策略拒绝、未知工具）投影后 `nomi.tool.failure_code` 非空率 = `100%`（此前 `0/16`），结构化上游 HTTP/断流/截断/分类器错误回合 `nomi.turn.error_kinds` 非空率 = `100%`（此前 `0/32`），且 14 类敏感禁出串泄漏数 = `0` —— 量具：`electron/telemetry/trajectoryProjection.test.ts`、`tests/agent-runtime/lane-trace.test.mts`。
  2. 闭合遥测契约与告知对账：全部 9 个遥测事件的每一格在 `isTelemetryProps` 白名单、`DISCLOSURE` 对账表与 `src/i18n/locales/settings.ts` 中英说明中 100% 覆盖对齐，退役词（「功能使用」「Agent 每一步」「轨迹」/ `feature use` / `traces`）命中数 = `0` —— 量具：`electron/telemetry/telemetryClaims.test.ts`、`electron/telemetry/telemetryEvents.test.ts`、`pnpm run check:i18n`。
  3. 雷达漏斗读数：`intake:radar` 纯函数聚合准确产出新手接入转化率、Agent 回合成功率 / 一次做对率（`retryCount === 0`）/ 零工具失败率、生成后采纳进时间轴比例、导出失败原因分布及安装账龄分档，且终端摘要尾部顺序不变 —— 量具：`pnpm run test:intake-radar`。

### ★1b 触及面清点
- **轨迹派生与投影（反馈包链路）**：`electron/agentLane/laneTraceRecorder.mts`、`electron/agentLane/laneHost.mts`、`electron/agentLane/laneTrace.mts`、`electron/telemetry/trajectoryProjection.ts`（`node scripts/door-map.mjs` 共 28 扇读写门，统一收口在 `deriveLaneTrace` 与 `projectTrajectoryTurn`）。
- **遥测契约、存储与 IPC**：`electron/shared/contracts/telemetry.ts`、`electron/telemetry/telemetryEvents.ts`、`electron/telemetry/telemetrySettings.ts`、`electron/telemetry/telemetryLifecycle.ts`、`electron/settings/telemetryIpc.ts`、`src/i18n/locales/settings.ts`。
- **真实业务触发点**：
  - 新手接入漏斗：`src/workbench/onboarding/onboardingState.ts`、`src/ui/onboarding/onboardingModelAvailability.ts`、`src/ui/onboarding/apimartConnectRoute.ts`、`src/ui/onboarding/useApimartVerification.ts`、`electron/ai/onboarding/onboardingIpc.ts`、`electron/providerAdapter/ipc.ts`、`src/workbench/api/taskApi.ts`。
  - Agent 回合完成：`electron/agentLane/laneRuntimePort.ts`、`electron/agentLane/laneHost.mts`、`electron/agentLane/laneWorkspace.mts`、`electron/agentLane/laneDesktopRuntime.ts`。
  - 时间轴采纳：`src/workbench/adoption/adoptGenerationNode.ts`、`src/workbench/adoption/adoptStoryboardBatch.ts`、`src/workbench/generationCanvas/agent/sendGenerationNodeToTimeline.ts`、`src/workbench/timeline/addAssetToTimeline.ts`、`src/workbench/timeline/agent/timelineCapabilityTarget.ts`。
  - 导出失败分类：`src/workbench/export/exportApi.ts`。
- **雷达聚合与渲染**：`scripts/lib/intake-radar/aggregate.mjs`、`scripts/lib/intake-radar/render.mjs`。
- **历史决议核对**：2026-11-13 曾删除从未接线的死定义 `feature.used` 与旧版无接线 `agent.turn.completed`（`toolCallBucket: '1-3'`）；2026-11-28 用户明确拍板批准全维度匿名产品数据闭环第 1 刀，要求把有真实触发点与雷达消费者的 `onboarding.step`、`agent.turn.completed`（含 `retryCount` 与 `breakerTripped`）、`timeline.adopted` 完整落地，同时继续禁止无意义的宽泛 `feature.used`。

### ★1c 老用户升级与存量数据兼容
- **本地待发队列（`telemetry-outbox.json`）**：`app.started.installAgeBucket` 与 `export.completed.failureReason` 均为可选字段（`export.completed` 仅在 `result === 'failure'` 时允许带 `failureReason`），升级前已排队的旧版 `app.started` 和 `export.completed` 事件继续 100% 通过 `isTelemetryEnvelope` / `isTelemetryProps` 正常发走，不丢队列。
- **本机遥测设置（`telemetry-settings.json`）**：老用户盘上没有 `firstSeenAt` 时，优先回退已有的 `consentedAt` 或文件 `birthtimeMs`/`mtimeMs` 推算粗账龄分档并惰性补齐本地 `firstSeenAt`；精确时间戳只留本机，不出网。
- **升级老用户的「首次生成成功」防误报**：`first_generation_succeeded` 同时检查 `onboardingState` 里已有的 `readChecklist().generated` 与专用一次性标记，老用户升级前已生成过作品的不会误报成首日首次生成。
- **历史 Agent 会话（`.nomi/agent-sessions/`）**：`deriveLaneTrace` 对盘上旧转录同时兼容 `LANE_VENDOR_FAILURE_DIAGNOSTIC`、`[nomi-classified: ...]`、审批记录 `LANE_APPROVAL_NOTE_TYPE` 与立即拒收首行头；`trajectoryProjection.ts` 同时兼容旧 `trace.jsonl` 里的原文故障前缀与新闭合词表。

### ★2 方案取舍与唯一主人
- **备选 A（拒绝）**：在 `trajectoryProjection.ts` 里直接对原始 `errors[]` 字符串跑宽泛正则猜「余额/鉴权/429」。拒绝原因：违背分层契约，且一旦原始串含路径加关键词容易发生意外分类或绕过结构化事实（违反 S4 与 `trajectoryProjection.test.ts` 的禁出断言）。
- **备选 B（采用）**：由唯一派生主人 `laneTrace.mts` 从 `AssistantMessage.diagnostics`（`LANE_VENDOR_FAILURE_DIAGNOSTIC` / `LANE_OUTPUT_TRUNCATED_DIAGNOSTIC`）、`laneAssistantFaultOf`、分类器尾标、`LANE_TRACE_NOTE` 工具失败记录、`LANE_APPROVAL_NOTE_TYPE` 及确定性立即错误头归一成闭合标识码；`trajectoryProjection.ts` 只放行精确闭合词表并二次过 `redactLogValue`。遥测白名单唯一主人在 `electron/shared/contracts/telemetry.ts` + `electron/telemetry/telemetryEvents.ts`，供应商归类唯一主人在 `modelClassOfVendor`（渲染层只传 `vendorKey` 过 IPC，主进程 `withMainProcessFacts` 覆盖归类，`vendorKey` 永不进事件）。
- **备选 C（拒绝）**：提升 `TELEMETRY_SCOPE_VERSION` 到 3 并弹窗重问所有已开启用户。拒绝原因：新增事件全部属于告知范围 1 已声明的「完成情况、耗时区间、失败原因类别」，不含任何新维度（如内容或设备指纹），保持 `scopeVersion = 2` 并在设置页完整清单诚实列明全部字段即可。

### ★3 边界、隐私与安全防线
- 物理闭合性：`isTelemetryProps` 对每个事件执行 `hasExactKeys` + 闭合 `Set` 枚举校验；任何多塞一格、少一格、塞入路径/URL/提示词/密钥的事件在主进程入口当场拒收（返回 `{ queued: false }`）。
- 遥测默认关闭：`readTelemetrySettings().enabled === false` 时 `recordTelemetryEvent` 直接短路返回 `false`，零磁盘队列写入、零网络请求。
- 自动化污染隔离：走查与 E2E（`NOMI_E2E=1`）自动打标 `systemProps.automated = true`，`intake-radar` 的 `splitAutomatedEvents` 默认 100% 剔除自动化事件，不污染真实转化率。

### ★4 错误与退化处理
- 渲染层遥测调用全部 fire-and-forget（`void desktop.telemetry?.track(...)`）且容忍 `desktop.telemetry` 未挂载（纯 Web / 单元测试夹具），绝不阻塞接入、生成、上轴或导出主流程。
- `telemetry-settings.json` 读写或 `fs.statSync` 异常时，`readInstallAgeBucket` 安全退化为 `'d0'`，不抛异常。
- `intake-radar` 遇到老版本事件（无 `installAgeBucket`、无 `export.completed.failureReason`、无新漏斗事件）时分母为 0 的比率返回 `null`（渲染为 `—`），不产生 `NaN` 或崩溃。

### 5 状态与数据流
- 业务触发点（主进程 / 渲染层） → `nomi:telemetry:track`（`withMainProcessFacts` 注入 `modelClass` / `providerClass`）或主进程 `recordTelemetryEvent` → `isTelemetryProps` 闭合白名单门卫 → `telemetryOutbox` 本地队列 → `/v1/events` → `intake-radar` `aggregate.mjs` 纯函数聚合 → `render.mjs` Markdown 与终端摘要。
- Agent 会话条目（`session` JSONL） → `laneTraceRecorder.mts` / `deriveLaneTrace`（闭合错误类别与闭合工具失败码） → `feedbackReport.ts` 调用 `projectLaneTrajectory`（白名单 + `redactLogValue`） → `/v1/feedback` 诊断附件。

### 6 并发、幂等与打断
- `onboarding.step` 的 `prompt_shown` 按单次启动内存态去重（避免 SWR 刷新重复刷分母）；`first_generation_succeeded` 按 `onboardingState` 跨会话持久化标记 + `checklist.generated` 双重去重，每台装机最多报 1 次。
- `timeline.adopted` 严格只在真实落轴成功（`applied.ok` 且 `replayed === false`）时发送，幂等重放（连点两次「加入时间轴」或重复排片 `replayed: true`）与预演（`validateOnly: true`）一律不计数。
- `agent.turn.completed` 在 `laneHost.mts` 按 `runId` 生命周期结算，用户主动点停止（`aborted`）记 `result: 'cancel'`，熔断停轮（`turn.isOver()`）记 `result: 'failure'` + `breakerTripped: true` + `faultCategory: 'tool_refused'`，每回合恰好结算 1 次。

### ★7 性能预算
- **不适用说明**：本改动仅在低频离散动作完成点（启动一次、模型验证一次、Agent 回合结束一次、素材落轴一次、导出结束一次）构造小常数对象（`< 1 KB`）走既有异步 `telemetryOutbox`，不增加画布渲染订阅、不扫目录、不在高频帧循环或流式 delta 上运行；`withMainProcessFacts` 与 `readInstallAgeBucket` 单次耗时 `< 0.1 ms`，不改变任何交互响应、帧率或内存曲线。

### 8 可观测性与回滚
- 自检：`telemetryClaims.test.ts`、`telemetryEvents.test.ts`、`trajectoryProjection.test.ts`、`lane-trace.test.mts`、`aggregate.node-test.mjs`。
- 回滚：全部改动位于同一独立分支，若需回滚可直接整单 revert；因新增队列事件受 `isTelemetryEnvelope` 保护，旧版或新版客户端遇到不认识的队列条目均安全丢弃不崩溃。

拍板图清单：不适用（仅更新设置页「查看完整清单」折叠区内的既有匿名遥测文字说明以如实披露闭合枚举字段，不增删改任何界面组件、布局或交互状态）。

### ★9 验收清单与反例
1. **轨迹工具失败码全覆盖（正向 + 重建）**：`prepareArguments` 形状拒收（`tool_arguments_invalid`）、连续失败熔断（`tool_retry_stopped`）、领域准备拒收（如 `wrong_verb` / `generation_input_invalid`）、策略拒绝（`approval_denied_by_policy`）及执行期失败在 `deriveLaneTrace` 与 `projectTrajectoryTurn` 中均产出非空闭合 `nomi.tool.failure_code`，删除派生目录重建后字节级一致。
2. **轨迹回合错误类别全覆盖（正向 + 反例）**：带 `LANE_VENDOR_FAILURE_DIAGNOSTIC`（401 `auth`、402 `balance`、429 `rate-limit`、404 `upstream-4xx`、503 `upstream-5xx`、网络/超时）、`LANE_OUTPUT_TRUNCATED_DIAGNOSTIC`（`output-truncated`）、`[nomi-classified: ...]` 尾标及 `provider-error` 的失败回合在 `nomi.turn.error_kinds` 中均准确透传闭合码；**反例**：直接往 `turn.errors` 塞未脱敏自由文本 `'/Users/aoqimin/secret 余额不足'` 时，`nomi.turn.error_kinds` 必须忽略该自由文本且产物零路径/零原文泄漏。
3. **五项漏斗事件白名单与反例**：`onboarding.step`、`agent.turn.completed`、`timeline.adopted`、`export.completed`（含可选 `failureReason`，兼容无此字段旧事件）、`app.started`（含可选 `installAgeBucket`，兼容无此字段旧事件）正例全部通过 `isTelemetryProps`；**反例**：向任一字段注入提示词、文件路径、URL、API Key、非枚举字符串，或在 `result === 'success'` 上携带失败专属字段，100% 返回 `false`。
4. **告知口径与禁用词守卫**：`telemetryClaims.test.ts` 100% 通过；`zhSettings.general.telemetry` 不含「功能使用」「Agent 每一步」「轨迹」，`enSettings.general.telemetry` 不含 `feature use`、`each Agent step`、`tool traces`、`traces`。
5. **真实触发点幂等与边界反例**：重复点击同一节点「加入时间轴」（`replayed: true`）不重复发 `timeline.adopted`；老用户 `checklist.generated === true` 时生成成功不误发 `first_generation_succeeded`；Agent 一回合零重试成功报 `retryCount: 0, result: 'success'`，撞满熔断报 `breakerTripped: true, result: 'failure', faultCategory: 'tool_refused'`。
6. **雷达报告聚合与尾部顺序**：`intake-radar` 准确计算新手接入转化率、Agent 回合成功率 / 一次做对率 / 零工具失败率、生成后上轴采纳率、导出失败原因分布与账龄分档；报告全文与终端摘要零「轨迹」字样，终端摘要末尾依旧是 `新增反馈`、`待分诊`、`报告 →` 与 `versionHealth.conclusion`。
