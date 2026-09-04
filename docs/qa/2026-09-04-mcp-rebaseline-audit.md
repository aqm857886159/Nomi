# MCP 全量能力审计与重基线

日期：2026-09-04
审计范围：MCP 工具面、schema/contract、授权/确认、执行器、receipt/persistence/recovery、Skills 注入、L1/L2/packaged 测试。
审计基线：`origin/main` = `45912ae01a155a3f6592f65368d0ce3d12fc034e`（merge PR #446）。

## 结论先行

当前 MCP 不是“没有实现”，而是“合同和若干真实链路已经存在，但工具级完成度不均，部分真实副作用与打包证据仍未闭合”。不能用 `tools/list` 通过、单元测试通过或 fixture 走查通过替代每个工具的真实 effect 证明。

当前最可靠的结论：

- MCP 有明确的 24 项工具目录、canonical semantic manifest、能力注册、schema 校验、租约/项目范围校验、确认/receipt 与部分持久化恢复实现。
- L1 协议链当前可绿：initialize、tools/list、未知工具、参数错误、取消长轮询、坏帧处理均有实际 stdio 进程证据。
- Skills 的 stdio resources/prompts 集成有真实进程测试；它是只读能力，不等于写入/制作能力完成。
- generation、production Run、画布写入等高风险路径大量使用 loopback provider、fake adapter 或零额度 fixture；这些可以证明控制流，不可以证明真实供应商副作用。
- 默认付费的 `mcp-draft-loop` 明确以 `NOMI_R16_GEN=1` 为门，当前默认运行会 `SKIP`，所以“全 MCP 绿”不成立。
- 本轮从当前本地 checkout 运行 L2 时，启动器 60 秒未拿到窗口并以 exit 1 退出；这是当前打包/启动证据红灯，不能被隐藏为 SKIP，也不能在没有重建产物前归因到业务逻辑。
- Skills/模型面存在两个需要持续防漂移的面：`modelToolSurfaceManifest` 是模型侧 canonical semantic surface，而 `MCP_TOOL_CATALOG` 还包含归并后的外部 MCP surface；二者不是同一份名称列表，报告中必须分别映射。

审计状态：**部分完成，不能宣称 MCP 全量毕业**。

## 当前 24 项 MCP 工具映射

下表以 `MCP_TOOL_RESOLVER.list()` 的 24 项目录为工具真相，能力以 canonical contract/semantic manifest 为准。测试栏列“最强已发现证据”，不代表该工具已经有真实持久化 effect。

| MCP tool | 能力/内部路由 | 已发现测试证据 | 证据级别与当前判断 |
|---|---|---|---|
| `nomi_session_open` | project session / lease | `mcpStdioProjectSessionBinding.test.ts`, `mcpStdioProjectSessionRouter.test.ts`, `mcp-l1-handshake.e2e.mjs` | stdio/租约链有证据；需补重启后 lease/session 续接证明 |
| `nomi_read` | read projection；按 target 路由 canvas/project/model/run/artifact/integration | `mcpEditingSurface.test.ts`, `mcpToolResults.test.ts`, `mcp-l1-handshake.e2e.mjs`, `production-mcp-journey.e2e.mjs` | 只读投影与真实 MCP 读取有证据；每个 target 的权限/红测仍需逐项闭合 |
| `nomi_canvas_edit` | `canvas.write`，租约内语义写 | `mcpCanvasDocumentSurface.test.ts`, `canvasWrite*.test.ts`, `mcp-l1-handshake.e2e.mjs` | schema/lease/adapter 有证据；L1 只证明坏参数，不证明每个 write operation 的落盘 |
| `nomi_asset_import` | `asset.import` | `mcpToolCatalog` 路由测试、`mcp-l2-journeys.e2e.mjs` 相关流程 | 目录/路由有证据；真实导入、资产持久化、重启回读需单独证明 |
| `nomi_operation_plan` | generation plan/create/patch | `mcpGenerationTools.test.ts`, `nomiMcpGenerationPlanning.test.ts`, `mcpGenerationDispatcher.test.ts` | 单元/策略边界充分；外部 MCP 真正创建并恢复草稿需 L2/packaged 证据 |
| `nomi_operation_preview` | generation preview，read-only | `mcpGenerationTools.test.ts`, `mcpGenerationPreview` 相关测试 | 无 provider effect 的预览证据；需证明未知价格不被当作 0 |
| `nomi_operation_gate` | generation gate request/decide，human approval receipt | `mcpPlanConfirm.test.ts`, `mcpGenerationConfirmation.test.ts`, `mcpSemanticGenerationConfirmation.test.ts`, `nomiMcpElicitation.test.ts`, `mcp-generation-elicitation-first.e2e.mjs` | 授权/receipt 主要是强单测 + 零额度 E2E；真实 provider 提交仍未证明 |
| `nomi_operation_execute` | approved generation submit / Runtime Adapter | `mcpGenerationDispatcher.test.ts`, `nomiMcpGenerationPlanning.test.ts`, `mcp-generation-single-shot-gui-fallback.e2e.mjs`, `mcp-draft-loop.e2e.mjs` | fixture 可证明控制流；默认付费 journey SKIP，live provider effect 未闭合 |
| `nomi_operation_control` | cancel/reconcile generation | `mcpGenerationDispatcher.test.ts`, `mcp-generation-provider-degradation.e2e.mjs`, `mcp-l1-handshake.e2e.mjs` | 取消/不盲重提有证据；需补重启中断后的 durable envelope/reconcile 检查 |
| `nomi_run_start` | `production.start`，创建 durable Run 草稿 | `nomiMcpProductionRuns.test.ts`, `production-mcp-journey.e2e.mjs`, `mcp-l1-handshake.e2e.mjs` | 有真实项目/Run 创建证据；需单独核验磁盘状态与重启回读 |
| `nomi_run_control` | `production.control` pause/resume/cancel/set_trust | `nomiMcpProductionRuns.test.ts`, `productionRunResume.test.ts`, `productionRunPauseSemantics.test.ts` | 状态机单测有证据；MCP stdio 到真实 durable Run 的全动作矩阵未闭合 |
| `nomi_artifact_review` | artifact review/revise，版本/CAS | `nomiMcpProductionArtifacts.test.ts`, `nomiMcpProductionRevision.test.ts`, `productionArtifactContract.test.ts` | CAS/contract 有证据；需补外部 MCP 修改后的真实 artifact 回读与重启证据 |
| `nomi_run_gate` | creative gate / storyboard materialize | `nomiMcpStoryboardMaterialize.test.ts`, `productionSampleGate.test.ts`, `productionShotGate.test.ts` | 物化与门控单测有证据；尚需 MCP L2 真实 materialize → 项目/画布回读闭环 |
| `nomi_integration` | integration.begin / preflight / credential / declare / get | `mcpIntegrationTools.test.ts`, `mcpIntegrationManagementTools.test.ts`, `mcp-client-activation.walk.mjs` | 认证与接入状态机证据较强；真实第三方 provider 合同不在本次 MCP 绿证据内 |
| `nomi_integration_manage` | integration.manage.* vendor/session mutation | `mcpIntegrationManagementTools.test.ts`, `mcpIntegrationTools.test.ts` | 单测和 schema 有证据；需补修改后重启、敏感信息不泄露、权限失败 effect 检查 |
| `nomi_project_create` | `project.create` | `mcp-l1-handshake.e2e.mjs`, `mcp-l2-journeys.e2e.mjs`, `mcpToolCatalog` 路由测试 | L1 已创建真实隔离项目；需明确项目文件/索引持久化与重启回读 |
| `nomi_canvas_plan` | canonical model-facing `canvas.write` semantic plan | `modelToolSurfaceManifest.test.ts`, `mcpCanvasDocumentSurface.test.ts`, `canvasWrite*.test.ts` | canonical schema 存在；必须补真实 MCP/Agent `operation` effect，不能拿 legacy tool 名测试代替 |
| `nomi_canvas_maintenance` | `canvas.delete`，destructive/undo | `canvasDelete*.test.ts`, `mcpCanvasDocumentSurface.test.ts` | 删除/undo 合同有证据；需补授权、receipt、重启恢复和 packaged path |
| `nomi_document_read` | `document.read` | `documentRead*.test.ts`, `mcpCanvasDocumentSurface.test.ts` | 只读 schema/投影有证据；真实外部 MCP 读取与 selection scope 需覆盖 |
| `nomi_document_edit` | `document.write` proposal | `documentWrite*.test.ts`, `mcpCanvasDocumentSurface.test.ts` | 合同/适配器有证据；proposal/approve/落盘/undo 的 MCP E2E 缺口明显 |
| `nomi_timeline_read` | `timeline.read` | `timelineRead.test.ts`, `mcpEditingSurface.test.ts` | 单测/语义 manifest 有证据；真实项目时间线回读与 cursor 边界需补 |
| `nomi_timeline_edit` | `timeline.write` preview/apply/undo | `timelineWrite.test.ts`, `mcpEditingSurface.test.ts` | schema/receipt 设计有证据；MCP 外部调用的 apply/undo durable effect 未闭合 |
| `nomi_export_job` | `export.read`；启动/取消为 Host-only | `mcpEditingSurface.test.ts`, `mcpToolCatalog` 路由测试 | 只读 status/verify 有证据；export write 不应误报为 MCP 可调用 |
| `nomi_media_query` | `asset.read` media metadata/source/waveform | `assetRead.test.ts`, `mcpEditingSurface.test.ts` | 只读能力有证据；真实项目媒体源/波形与大文件边界需补 |

### 模型侧 semantic manifest 不能与外部 MCP 目录混算

`electron/harness/tools/modelToolSurfaceManifest.ts` 当前明确暴露：

- generation：`nomi_generation_plan`、`nomi_generation_status`
- editing：`nomi_timeline_read`、`nomi_timeline_edit`、`nomi_export_job`、`nomi_media_query`
- canvas：`nomi_canvas_read`、`nomi_canvas_plan`、`nomi_canvas_edit`、`nomi_canvas_maintenance`
- document：`nomi_document_read`、`nomi_document_edit`
- `nomi_request_generation_gate`、`nomi_start_generation`、`nomi_decide_generation_gate` 是 Host-only transitions，不应作为模型自报工具。

外部 MCP `MCP_TOOL_CATALOG` 另外承载 session、归并 read、asset import、operation 族、Run、integration、project create 以及 semantic editing tools。审计和测试必须在报告中注明当前检查的是哪一面，不能只用名称数量作完成结论。

## 授权、确认、执行、receipt、持久化、恢复矩阵

| 层 | 已发现实现/测试 | 目前能证明什么 | 未闭合项 |
|---|---|---|---|
| session/project scope | `mcpConnectionContext.ts`、project session authority/store、`mcpStdioProjectSessionBinding/Router.test.ts` | 客户端身份、session、lease、project binding 有类型和校验 | stdio 重启后旧 handle、项目代际变化、跨项目重放的真实进程证据 |
| schema/contract | capability contracts、`modelToolSurfaceManifest.ts`、`mcpToolCatalog.ts`、`mcpArgValidation.test.ts`、`check:mcp-payload` | schema 边界、工具目录、payload ratchet 可检查 | canonical manifest 与外部目录的映射仍需机器可读 coverage ledger；不能漏报未测 operation |
| authorization | `approvalReceipt.ts`、`mcpGateConfirmation.ts`、`mcpConfirmationBinding.ts`、elicitation tests | HMAC receipt、过期、scope、消费幂等和 GUI/client confirmation 逻辑 | 每个有副作用工具的 receipt scope/target/project/revision 都需 MCP 调用级正反例 |
| execution | `dispatcher.ts`、`mcpProtocol.ts`、semantic generation/canvas/document/timeline adapters | 语义路由与 fail-closed 入口存在 | 一些测试对 handler 使用 mock；缺少每工具真实 state mutation 的统一 effect receipt |
| receipt | `approvalReceipt.ts`、`projectAgentProposalReceiptStore.ts`、production run receipt tests | receipt 文件、MAC、CAS、replay、部分 recovery 状态存在 | 不同 owner 的 receipt 是否统一关联 MCP request/session/operation，需 cross-layer test |
| persistence | approval receipt store、project-agent proposal receipt、production Run stores | 局部 durable state 有测试 | `nomi_canvas_*`、document/timeline/artifact review 的 MCP 落盘与重启回读未形成统一矩阵 |
| recovery | `projectAgentExecutionRecovery.ts`、`productionRunResume.ts`、production recovery tests | 生成提交未知、Agent execution orphan 等分类存在 | L1/L2/packaged 的 kill/restart/reconcile 真实证据不足，不能用 fixture 状态代替 |
| Skills injection | `skillStore.ts`、`skillIndex.ts`、`nomiSkillResources.mts`、`nomiMcpSkills.test.ts`, `mcp-skills-integration.e2e.mjs` | MCP resources/prompts 使用 canonical skill store；真实 stdio list/read 可测 | 需继续验证 packaged app 的同一 roots、hash mismatch、reload 与 UI/Pi/MCP/Host 四面一致 |

## 测试证据分类

### 当前已运行且为绿的最小检查

以下命令在 `/Users/aoqimin/Desktop/Nomi` 当前 checkout 运行成功；注意该 checkout 本地 `main` 为 `bcd2e900119e642be46388abb700be1322a4ae38`，落后于审计基线 `origin/main`，因此这些结果只作为支持证据，不冒充精确基线的全套结果。

```text
pnpm run check:mcp-payload
MCP tools/list payload: 19925 bytes (ratchet max 20016)
MCP payload ratchet passed

pnpm run check:mcp-tool-refs
MCP 工具名引用一致：9 处调用点全部命中目录里的 24 个工具

pnpm exec vitest run \
  electron/capabilityCore/mcpProtocol.test.ts \
  electron/capabilityCore/mcpPlanConfirm.test.ts \
  electron/capabilityCore/approvalReceipt.test.ts \
  electron/capabilityCore/nomiMcpSkills.test.ts \
  electron/shared/agentCapabilities/registry.test.ts
Test Files 5 passed; Tests 27 passed

node tests/ux/mcp-l1-handshake.e2e.mjs
MCP-L1 PASS: C1/C2/C3/C4/C5 green; C6 declaration green
```

L1 是真实 stdio 进程，但它的业务副作用边界主要是创建隔离 project/Run、取消长轮询和协议健壮性；不能据此宣称所有 24 工具均有真实 effect。

### 真实红证据

```text
node tests/ux/mcp-l2-journeys.e2e.mjs
exit 1
Nomi 走查启动失败（mcp-l2-journeys）：等了 60000ms 没等到窗口
原始错误：electronApplication.firstWindow: Target page, context or browser has been closed
```

该红证据发生在启动阶段，最可能与 stale `dist-electron`、主进程启动退出或打包/用户数据环境有关；目前没有足够输出把它归因到某个 MCP handler。它仍然必须保留为红灯，因为 L2 真实 Electron 证据尚未闭合。最小修复验证顺序见后文。

### 明确是 skip/fixture/static 的证据

- `node tests/ux/mcp-draft-loop.e2e.mjs` 默认输出：`SKIP ... 会花一次真图额度。NOMI_R16_GEN=1 ... 才跑。` 这是成本保护，不是绿证据。
- `mcp-l2-journeys.e2e.mjs` 使用 fake APIMart/loopback provider；即便通过，也只能证明 Nomi 的真实 app/MCP 控制流接上一个可控 provider，不证明第三方合同和真实收费 effect。
- `mcp-generation-provider-degradation.e2e.mjs` 使用 fake runtime adapters，证明 recovery policy，不证明供应商请求。
- `mcp-generation-multishot-confirm.e2e.mjs` 明确 provider=0，证明真实 handler + 确认卡，不跑生成。
- `mcp-skills-integration.e2e.mjs` 是真实 MCP stdio + skillStore，但全程只读，不能覆盖 skill 写入或制作副作用。
- `packaged-mcp-smoke.e2e.mjs` 的设计目标是隔离 cwd 下的打包 MCP 启动、catalog、签名 client 和 draft 级 smoke；它不是完整 packaged L2 production effect。

没有为了制造红灯而修改产品测试或故意破坏 origin/main。当前已有的 L2 启动红灯足够作为环境/打包闭合的真实阻断；其余未证明项保持 `unproven`，不伪造失败，也不伪造成功。

## 关键缺口与最小验证命令

### 1. 工具目录 → canonical contract → handler 的全量映射

红测：

```bash
pnpm run check:mcp-payload
pnpm run check:mcp-tool-refs
pnpm exec vitest run electron/harness/tools/modelToolSurfaceManifest.test.ts electron/harness/tools/agentToolCatalog.test.ts electron/capabilityCore/mcpEditingSurface.test.ts
```

最小绿测要求：每个 24 项工具都能列出 capability、input/output schema、resolver method、effect owner 和至少一个行为测试；故意删一项映射或改 tool name 后检查必须失败。

持久化验证：对每个 write-capability 使用隔离 project，调用后读取项目实际状态文件或 owner store，重启 MCP stdio，再用 `nomi_read`/对应 read tool 回读相同 revision。

打包验证：

```bash
pnpm run build
pnpm run dist:mac:dir
node tests/ux/packaged-mcp-smoke.e2e.mjs release/mac-arm64/Nomi.app
```

### 2. 画布/文档/时间线 semantic write 的真实 effect

红测：必须以 canonical MCP 名称调用，不能直接调用旧别名：

```text
tools/call name=nomi_canvas_plan
arguments={leaseHandle, operation:"set_node_prompt", ...}
```

最小绿测：同一调用链依次证明 schema → project lease → proposal/confirmation → owner adapter → changed revision → result receipt；故意使用错误 lease、旧 revision、未知 operation、第二次相同 operationId 都必须得到 typed error/replay，而不能静默成功。

```bash
pnpm exec vitest run \
  electron/capabilityCore/mcpCanvasDocumentSurface.test.ts \
  electron/capabilityCore/canvasWriteTransportAdapters.test.ts \
  electron/shared/agentCapabilities/canvasWrite.test.ts \
  electron/shared/agentCapabilities/documentWrite.test.ts \
  electron/shared/agentCapabilities/timelineWrite.test.ts
node tests/ux/mcp-l2-journeys.e2e.mjs
```

持久化/恢复：调用后关闭 MCP/应用，重新打开同一隔离目录，`nomi_read` 读取项目/画布/文档/时间线，断言 revision、字段和 receipt 一致；杀死发生在 commit 前/后的进程，分别断言没有半写和不重复应用。

打包：先 `pnpm run build`，再运行 `packaged-mcp-smoke`，随后新增/执行一个 packaged semantic-write journey；当前已有 packaged smoke 不足以覆盖该项。

### 3. 付费确认与真实提交边界

红测：无 receipt、错误 project/session、过期 challenge、错误 revision、重复消费、客户端只返回裸 boolean 时必须失败且 provider call 数为 0。

```bash
pnpm exec vitest run \
  electron/capabilityCore/approvalReceipt.test.ts \
  electron/capabilityCore/mcpPlanConfirm.test.ts \
  electron/capabilityCore/mcpGenerationConfirmation.test.ts \
  electron/capabilityCore/mcpSemanticGenerationConfirmation.test.ts \
  electron/capabilityCore/mcpGenerationDispatcher.test.ts
node tests/ux/mcp-generation-elicitation-first.e2e.mjs
node tests/ux/mcp-generation-single-shot-gui-fallback.e2e.mjs
```

绿测：一次 confirmation 只铸造一个 durable receipt；execute 只接受该 receipt；重复 execute 返回同一结果或明确 replay，不产生第二次 provider submission。

持久化：重启 MCP/应用后 receipt 仍能 verify/consume；receipt MAC、project identity、contract hash、cost scope、attempt 和 provider namespace 不变。

打包：

```bash
pnpm run build
pnpm run dist:mac:dir
node tests/ux/packaged-mcp-smoke.e2e.mjs release/mac-arm64/Nomi.app
node tests/ux/production-mcp-journey.e2e.mjs
```

`mcp-draft-loop` 只有在明确批准成本并设置 `NOMI_R16_GEN=1` 后才可作为 live provider 证据；默认 SKIP 不得计绿。

### 4. Run/artifact/storyboard materialize

红测：错误 artifact version、未批准 gate、重复 materialize、应用重启后的旧 run、unknown submission 均必须阻断或进入 reconcile，而不是重新调用。

```bash
pnpm exec vitest run \
  electron/capabilityCore/nomiMcpProductionRuns.test.ts \
  electron/capabilityCore/nomiMcpProductionArtifacts.test.ts \
  electron/capabilityCore/nomiMcpProductionRevision.test.ts \
  electron/capabilityCore/nomiMcpStoryboardMaterialize.test.ts \
  electron/productionRun/productionRunResume.test.ts
node tests/ux/production-mcp-journey.e2e.mjs
```

绿测：MCP 创建 Run → 读状态/事件 → gate → artifact review/materialize → `nomi_read` 回读 → 重启 → 继续/对账全链路成功，且每个 durable transition 有 operation/receipt/revision。

打包验证同上，但必须从隔离的 packaged app/launcher 启动，不能依赖 repository `dist-electron` 或当前开发目录。

### 5. Skills 注入、hash 与 packaged roots

红测：删/增/修改一个 Skill、使用旧 content hash、无签名客户端请求内部 skill、packaged app 找不到 user skills 时都必须得到诊断或 fail-closed，不得返回旧 body。

```bash
pnpm exec vitest run \
  electron/capabilityCore/nomiMcpSkills.test.ts \
  electron/capabilityCore/skillDispatcher.test.ts \
  electron/harness/runtime/pi/nomiSkillResources.test.ts \
  electron/skills/skillStore.test.ts \
  electron/skills/skillManifestSchema.test.ts
node tests/ux/mcp-skills-integration.e2e.mjs
node tests/ux/skill-import-formats.walk.mjs
```

绿测：UI/Pi/MCP/Host 都从同一 `skillStore` roots 发现；resources URI content-addressed；read 前重新发现并核 hash；packaged app 与开发 app 的 builtin/user roots 一致且 diagnostics 可见。

打包：

```bash
pnpm run build
pnpm run dist:mac:dir
node tests/ux/mcp-skills-integration.e2e.mjs
```

命令必须在 packaged launcher 环境中执行，而不是只在 repo cwd 中启动。

### 6. L2 当前启动红灯

最小红测已经发生：

```bash
node tests/ux/mcp-l2-journeys.e2e.mjs
```

最小绿测顺序：

```bash
pnpm run build
node tests/ux/mcp-l2-journeys.e2e.mjs
```

若仍红，继续检查 `_launchApp.mjs` 的主进程 stderr、隔离 user-data/单实例环境和 Electron executable；不能直接重试并把 `SKIP` 当绿。绿后再运行：

```bash
pnpm run test:mcp-journey
```

并把每个 journey 的 provider=0、loopback fixture、真实 app、packaged app 状态分别记入 evidence matrix。

## MCP plans/specs 与当前实现的状态

需要以当前代码重新对齐的 canonical 文档包括：

- `docs/superpowers/specs/2026-08-22-unified-runtime-mcp-generation-design.md`
- `docs/superpowers/specs/2026-08-23-mcp-client-first-authorization-design.md`
- `docs/superpowers/plans/2026-08-08-production-mcp-evals.md`
- `docs/superpowers/plans/2026-08-22-mcp-ai-generation-vertical-slice.md`
- `docs/superpowers/plans/2026-08-23-mcp-client-first-authorization.md`
- `docs/superpowers/plans/2026-08-23-p1-p3-editable-mcp-generation.md`
- `docs/superpowers/plans/2026-08-22-external-agent-runtime-mcp-control-plane.md`
- `docs/superpowers/plans/2026-08-27-release-media-pack-skill.md`

文档共同要求的核心不变量是：主进程是 authority；MCP/UI/Agent 只是 projection/transport；高风险写入要有 project lease、CAS/revision、human approval receipt、预算/成本 scope、幂等和 recovery；Skills 必须从统一仓库真源发现；打包应用必须走独立 launcher 验证。

当前实现与这些要求的关系：基础骨架大多存在，但各工具的“真实 external process effect + durable recovery + packaged evidence”不均衡。因此下一阶段不再新增第二套 MCP surface，而是补 coverage ledger、canonical path E2E 和 durable/package gates。

## 改动文件

本审计任务没有修改产品代码、没有合并、没有修改 `origin/main`。本工作区只新增：

- `docs/qa/2026-09-04-mcp-rebaseline-audit.md`

相关执行方案应链接本报告，并将 MCP 状态记为 `partial/unproven`，直到上述红→绿→持久化→打包门逐项完成。
