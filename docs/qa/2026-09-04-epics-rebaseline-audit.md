# Nomi Epic 事实重基线审计

审计日期：2026-09-04
审计基线：`origin/main@45912ae01a155a3f6592f65368d0ce3d12fc034e`
范围：TikHub、视频拆解、画布性能 S1-S6、Agent M0-M5，以及相关旧计划/QA/walkthrough/PR merge SHA 的状态漂移。

## 0. 审计边界与结论口径

本次只读检查了当前 `origin/main` 的代码、计划、QA、测试、walkthrough、PR 状态和合入 SHA。没有修改产品代码，没有合并 PR，也没有把未合入 worktree 或远端分支的代码算入主线完成度。

证据列采用以下含义：

| 标记 | 含义 | 不能替代的证据 |
|---|---|---|
| `Y` | 当前 `origin/main` 有对应代码或 UI | 不等于真实用户链路已完成 |
| `U` | 有契约、单测或静态校验 | 不等于 Electron、provider 或持久化已证明 |
| `E` | 有真实 Electron walkthrough 能运行 | 若使用注入 fixture，只证明 UI/store 链路 |
| `R` | 有持久化、重启、重新读回证据 | 单次内存态或重新打开页面不算 |
| `V` | 有可检查的视觉证据，并且已完成走查/验收 | 代码存在或生成 PNG 不等于视觉通过 |
| `L` | 有真实 provider/live 证据 | mock、fixture、health probe 不算 |
| `P` | 有 packaged runtime 证据 | CI 编译成功不等于 packaged 功能通过 |
| `—` | 本次没有足够证据 | 不解释为不存在 |

“已合入”只表示代码或文档在基线中；“已完成”必须同时看该 feature 的验收条件。任何标题、PR 名称或旧 QA 的 `PASS` 都没有单独作为完成依据。

## 1. 证据矩阵

### 1.1 TikHub / 视频拆解

| featureId | origin/main 代码 / 合入证据 | UI | 契约/单测 | 真实 Electron | 持久化/重启 | 视觉 | live/provider | packaged | 当前判定 |
|---|---|---|---|---|---|---|---|---|---|
| `TIKHUB.V1.CONNECTOR` | `Y`；PR #296 → `6e90ce4d575a950181b6459fb92eaf38350d79e4` | `Y` 设置卡片与桥接 | `U` connector/transport/service/error-kind tests | `E` 只覆盖无效 key/无 key 的诚实错误路径 | `R` safeStorage 单测；无 TikHub 重启读回 | `—` 有 walk 截图能力，但未形成主线验收证据 | `L` 未证明；需要真实 key/provider | `—` | 连接器、校验和导入代码已合入；v1 端到端未闭环 |
| `TIKHUB.V1.1.ROUTE` | `Y`；PR #302 → `2344a342e07e3dcf387f342c977066208149fe07` | `Y` route row/设置入口 | `U` locale、health probe、sticky/failover/manual tests | `—` | `—` | `—` | `L` 免费 health probe 与真实业务请求边界已写明；业务 live 未证明 | `—` | 双域路由契约已合入；provider 业务成功未证明 |
| `DECON.ENGINE.V1` | `Y`；PR #290 → `7ecc5838731f1a40f068006c7cd48af65e384473` | `—` | `U` prompt/schema/JSON parser tests | `E` walkthrough 默认注入结果，不是 engine/provider 证据 | `—` | `—` | `L` `DECONSTRUCT_E2E`/APIMart gated，未见成功记录 | `—` | 引擎和解析契约已落地；真实模型链路未验收 |
| `DECON.PANEL.V1` | `Y`；PR #293 → `a7c0b2e56ab067d382c58f774a609dd64882f2ab`；渲染/设计资产 PR #295 → `a6541b49a4e6c36cdaa0b1697b3158f6e36bf200` | `Y` panel、shot row、提取到画布/编组 | `U` panel/store 相关单测与 walk 断言 | `E` empty/running/result/failed/retry/add/group/undo/coexistence 可注入走查 | `R` 未证明；renderer state 在 release session 时清空 | `—` mockup 与截图能力存在，但当前设计是否接受不能从标题推断 | `—` | `—` | UI 有功能骨架和确定性走查；设计验收与真实数据链路未闭合 |
| `DECON.AGENT.HANDOFF` | `—` 当前主线未找到已落地的 Agent tool/result-slot 接入 | `—` | `U` 只有向 Agent 兼容的设计前置约束 | `—` | `—` | `—` | `—` | `—` | 仍是后续接入项，不应把“面板存在”算成 Agent 完成 |

### 1.2 画布性能 S1-S6

| featureId | origin/main 代码 / 合入证据 | UI | 契约/单测 | 真实 Electron | 持久化/重启 | 视觉 | live/provider | packaged | 当前判定 |
|---|---|---|---|---|---|---|---|---|---|
| `CANVAS.S1.EVAL` | `Y/U`；PR #311 → `a9112cdac34fb7a1528546cd5f6d98f9f4290d0c` | `—` | `U` eval harness/baseline | `E` 有性能场景能力；当前基线非当前 commit fresh run | `—` | `—` | `—` | `—` | 评测基础设施已合入；当前机器/当前 main 需重测 |
| `CANVAS.S2.BASELINE` | `Y/U`；同 PR #311 与 committed baseline artifacts | `—` | `U` | `E` 历史 walkthrough/benchmark | `—` | `—` | `—` | `—` | 有历史 baseline，但 JSON 含旧 commit/`dirty:true`，不是当前 main 的完成证据 |
| `CANVAS.S3.OFFCANVAS` | `Y`；PR #341 → `777c9be065faefc16a909df51c15ace1c00a03c1` | `—` | `U` | `E` CI Linux 成功；Mac/Windows 为 skipped | `—` | `—` | `—` | `—` | 代码与自动化性能门已合入；需当前基线复测 |
| `CANVAS.S4.RF-KERNEL` | `Y`；PR #346 → `a056b4ed506bf981c0a68491454d0687642f563b` | `—` | `U` | `E` Canvas Performance Linux、Mac Package 成功 | `—` | `—` | `—` | `P` 仅有历史 package check，不是全场景 packaged 验收 | 反应流拖拽几何归属和停止写回已合入 |
| `CANVAS.S5.REVERIFY` | `Y/U/E`；S5 artifacts、walk、summary 已在主线 | `Y` 交互走查存在 | `U` benchmark/walk | `E` 零 quota walkthrough 能覆盖拖拽、连接、平移、错误 | `—` | `—` 输出被忽略，未形成视觉验收包 | `—` | `—` | 性能数据和走查能力存在，但 committed artifacts 历史/dirty；需当前 main 重新跑 |
| `CANVAS.S6.HYGIENE` | `Y/U`；PR #393 → `2e750796ab860ef18b4abd5a126ea656f924407b` | `—` | `U` dead-code/perf hygiene、CI checks | `E` S5 walk 与性能门历史成功 | `—` | `—` | `—` | `P` Canvas Performance Linux + Mac Package 成功 | 卫生批已合入；不能替代 click-select 优化 |
| `CANVAS.S6.CLICK-SELECT` | `—` 未合入；远端 `origin/perf/canvas-click-select-20260903` 最新 `fa2c483a...`，实现提交 `9d36eb23...` | `Y` 当前已有选择 UI | `U` 设计笔记记录 red 失败与待补测试 | `—` | `—` | `—` | `—` | `—` | 仍暂停、无 PR；业务 store 写入与 RF 选择真相冲突，不能算 S6 完成 |

### 1.3 Agent M0-M5

| featureId | origin/main 代码 / 合入证据 | UI | 契约/单测 | 真实 Electron | 持久化/重启 | 视觉 | live/provider | packaged | 当前判定 |
|---|---|---|---|---|---|---|---|---|---|
| `AGENT.M0.BASELINE` | `Y` 文档交付；PR #272 → `c1f6b385a43c5520889b3af4baf3d9b4fd09485b`；PR #275 → `7bf7e27f01c3e2e95c1ba89ec21945cc06a4e96b` | `—` | `U` owner map/tool mapping/red-lights/PR slices | `—` | `—` | `—` | `—` | `—` | M0 的文档基线已合入；计划仍写“未开工”是状态漂移，不是产品完成 |
| `AGENT.M1.HOST` | `Y/U`；PR #301 → `13a78c02b5894884c13e755ad861a85c4b31e584` | `Y` 相关 Agent UI 代码存在，但 Host 默认关闭 | `U` lifecycle/settlement/projection tests；deviated coverage 有缺口 | `—` 未证明真实启用 Host | `—` Host 全量持久化未覆盖 | `—` | `—` | `—` | 主要装配代码已合入；M1 的 contract gap remediation 仍未闭环 |
| `AGENT.M2.SEMANTIC` | `Y/U`；#318 → `8943494471a1f8baf6e10169e761ccbf367dc4ea`；#337/#338/#339 → `147fcd4...`/`c331317...`/`82ebc4d...`；#359 → `8e22dff...`；#360 → `e8477aa...`；#382 已合入 | `Y` generation/editing/canvas surfaces | `U` manifest、lease/scope/graph、timeline/generation tests | `E` 有零 quota journey 能力，但当前完整语义链未 fresh reverify | `—` | `—` | `—` | `—` | 语义切片已落地，不等于 M2 整体完成；旧 writer retirement/full chain 仍有红灯 |
| `AGENT.M3.CONTEXT` | `Y/U`；#372 → `25cefcfe57a4c66a56314d560f685c379417cf76`；#374 → `774e1105dc7ab3d2330d820b99021a0ee0516463`；#376 → `da415627618ad1c3356de0b9b4fc694cce4b23b0` | `Y` context/skill 相关表面存在 | `U` promptPipe/facade/coordinator/skill tests | `—` M5 checklist 明确真实 Host 未覆盖 | `—` | `—` | `—` | `—` | 七层 context 代码和单测已合入；真实 Host projection 未证明 |
| `AGENT.M4.TRUST` | `Y/U`；#405 → `5d28462b6c8e4a7030928f21d1abe195bb2f6214`；#407 → `b4d29656089a496173c4c0a9ced1f8657bec999a`；#408 → `c1d34830a6321997573529d5d31f2a0bf242d370` | `—` 独立 taint badge 未证明 | `U` provenance/action guard/helper tests | `—` | `—` | `—` 视觉 taint 状态缺失 | `—` Host disabled，真实 spend gate 未覆盖 | `—` | 信任/溯源代码已合入；实际 Host taint→action 仍未毕业 |
| `AGENT.M5.PACKAGED` | `Y/U`；PR #420 → `87bc55c9fb56a91d36438d49715fb8ba5e893ec4` 合入 main；#419/#421/#422 不构成 main 合入 | `Y` packaged MCP surface | `U` packaged smoke/checklist 有历史证据 | `—` M3 full Host 不覆盖 | `—` Host full persistence 不覆盖 | `—` | `—` | `P` 历史 M0/M3 skills/unsigned boundary smoke；当前 main L2 未重新验证 | 未毕业；QA 明确写 current main not graduated |

## 2. 逐项审计与下一动作

### 2.1 TikHub

当前事实：连接器、双域路由、safeStorage 校验、IPC trusted-sender 边界、设置卡片和 fixture/unit 测试均在 `origin/main`。`docs/plan/2026-09-01-tikhub-connector-v1.md` 仍标记“进行中”，但 v1 acceptance bullets 已写成全 `✅`，这是最明显的状态漂移之一。计划同时明确：真实 inner payload 要通过 `TIKHUB_E2E=1` 确认；业务调用可能产生费用；默认测试不应调用 provider。

真实阻塞：没有当前可引用的真实 TikHub key/provider 成功证据；没有 TikHub 专属重启读回；没有 packaged walkthrough；walk 产生的截图未作为 tracked 验收资产。`importTikhubShareUrl` 的当前语义是导入远程素材并附带 `AssetSourceEvidence`，不是“一次调用自动完成视频拆解并生成分镜表”。

下一动作：先补一条不付费的 fixture contract red→green，明确真实 payload/schema；再在用户提供 key、允许 provider 额度后做一次 live canary；之后做设置保存→退出→重启→读回，以及 packaged runtime；最后以新的中文/英文、宽/窄窗口截图做视觉走查。不能把 health probe 或 invalid-key walk 升级成 live 成功。

可复用命令（命令本身只作为后续执行模板，本次未执行 provider/live）：

```bash
# 红：先把真实 payload/错误分类缺口写成失败的 fixture contract；绿：补齐 fixture 后运行同一组
pnpm exec vitest run electron/connectors/tikhubConnector.test.ts electron/connectors/tikhubTransport.test.ts electron/connectors/tikhubRoute.test.ts electron/connectors/tikhubConnectorService.test.ts electron/shared/contracts/tikhubErrorKinds.test.ts --reporter=verbose

# live/provider：必须显式得到授权并提供真实 key/share URL；没有 key 时不要盲重试
TIKHUB_E2E=1 TIKHUB_API_KEY=... TIKHUB_SHARE_URL=... node tests/transport-spike/tikhub.mjs

# Electron/视觉：构建后检查桌面与窄窗口、中文与英文；当前截图输出默认不等于验收
pnpm run build && node tests/ux/tikhub-connector.walk.mjs
```

### 2.2 视频拆解

当前事实：引擎 #290、panel #293、mockup/render #295 都已经进入 `origin/main`。但 `docs/plan/2026-09-01-video-deconstruction-v1.md` 仍写“设计+文档 only，样张待用户拍板（拍板前不写壳）”，与当前代码落地事实冲突；应改为“代码已落地、设计验收和真实 provider 仍未闭环”，不能照计划标题判断。

真实阻塞：`tests/ux/deconstruction-panel.walk.mjs` 默认使用注入结果，能证明面板、状态、选择、加到画布、编组和 undo 的 UI/store 链路，但不证明真实 engine/provider。`tests/ux/video-deconstruct.e2e.mjs` 需要 `DECONSTRUCT_E2E` 与 APIMart key，且明示消耗真实额度；当前没有成功运行证据。`videoDeconstructions` 在 renderer store 中，`releaseWorkbenchProjectSession.ts` 会清空相关状态，因此没有完整结果的持久化/重启证明。计划中 Agent handoff、单镜头 retry/task center/restart 等仍是后续项。

下一动作：先用 deterministic fixture 建立真实失败态和结果态的红/绿契约；再用真实视频、真实 provider 做一次带额度上限的 canary；补 durable result/selection/session readback 和 restart recovery；重新做用户认可的新设计样张，再实施或修正 UI；最后补 Agent canonical result-slot/handoff 的真实 Electron 证据。

```bash
# 红/绿：解析、schema 和错误态先固定，再跑面板链
pnpm exec vitest run electron/video/deconstructVideo.test.ts --reporter=verbose
pnpm run build && node tests/ux/deconstruction-panel.walk.mjs

# live/provider：真实 provider 才能证明 engine，不要把默认注入结果当成 provider 证据
pnpm run build && DECONSTRUCT_E2E=1 node tests/ux/video-deconstruct.e2e.mjs tests/ux/fixtures/fixture-video.mp4

# 视觉：检查 desktop/narrow、empty/running/result/failed/retry；旧 mockup 若不符合当前设计意图，先重新拍板
pnpm run build && node tests/ux/deconstruction-panel.walk.mjs
```

### 2.3 画布性能 S1-S6

当前事实：S1/S2 评测基础设施 #311、S3 off-canvas #341、S4 RF kernel #346、S6 hygiene #393 都已合入。S5 的 walkthrough、baseline summary 和 final artifacts 也在主线，但这些 artifacts 是历史测量：例如 `canvas-final-postfix-select.json` 记录 `commit=a056...`、`dirty=true`、`pass=false`，click-select frame gap 已在阈值附近/越线，并有同时播放视频的 fixture hard failure。故不能复述成“S1-S5 全绿”。

S6 的卫生批已经完成，但 click-select 优化没有完成。`origin/perf/canvas-click-select-20260903` 的工作记录明确写着 paused/no PR，原因包括业务 store 仍写入、RF 与业务 selection 双重真相、四向 OR fallback 和 S4 projection conflict；机器高负载也使 benchmark 无效。该远端分支不能算 `origin/main` 证据。

下一动作：在低负载、干净工作树、当前 `origin/main` 上重跑 S5 prod/dev/throttle/L/select；把 click-select 先设计成 RF 唯一选择真相、业务层只读投影，再用失败测试固定冲突/重复通知/拖拽回归，最后才开 PR。性能完成后必须附上当前 commit、dirty 状态、运行参数、原始 JSON、Electron walkthrough 截图和视觉走查记录。

```bash
# 当前主线 red/green 基线：先确认失败/越线，再修复后用完全相同参数复跑
pnpm run build && node tests/ux/canvas-performance-benchmark.e2e.mjs final-postfix-prod --scale S --scenario blank-pan,node-drag-image,node-drag-video,multi-node-drag,drag-at-low-zoom,drag-over-dense-edges --runs 5 --warmup 1
pnpm run build && node tests/ux/canvas-performance-benchmark.e2e.mjs final-postfix-select --scale S --scenario click-select --runs 5 --warmup 1

# S5 Electron/视觉走查
pnpm run build && node tests/ux/canvas-s5-walkthrough.walk.mjs

# click-select 分支专用：仅在低负载、确认分支未合入前运行；不能把它写成 main 通过
pnpm exec vitest run src/workbench/generationCanvas/reactFlow/canvasNodeSelectionSync.test.ts src/workbench/generationCanvas/reactFlow/generationCanvasReactFlowAdapter.test.ts --reporter=verbose
```

### 2.4 Agent M0-M5

#### M0

M0 的文档交付已通过 #272/#275 合入，但计划仍写“已拍板·未开工”。这是“文档基线已交付、产品实现不在 M0 范围”的状态漂移。QA 还记录了一个重要回归风险：旧的 `hostLifecycle.test.ts` 已变成很薄的转发 shell，`markDeviated` 相关断言消失，不能把该命令的绿色当成 deviated contract 绿色。

下一动作：把 M0 重新标为“baseline docs delivered”；补一个当前真实的 deviated contract test，并把旧 QA 命令迁移到真实实现测试。

```bash
# 红：当前旧 proxy 不足以证明 deviated；先保留失败测试作为缺口
pnpm exec vitest run electron/projectAgentHost/hostLifecycle.test.ts --reporter=verbose
# 绿候选：补齐后跑真实 Host contract，而非只跑 forwarding shell
pnpm exec vitest run electron/projectAgentHost/projectAgentHost.test.ts electron/projectAgentHost/projectAgentExecutionCoordinator.test.ts --reporter=verbose
```

#### M1

M1 装配 PR #301 已合入，Host lifecycle/settlement/projection 边界和 legacy preservation 代码、单测存在。但 M1 remediation 文档列出的 rc-01 Pi history、rc-02 alias deletion、rc-05 safeParse/sensitive fields、rc-06 generic `execution_settled`、deviated test 等缺口没有被本次基线证明已闭环。真实 Electron Host 也没有证明，因为 `agentHostEnabled=false`。

下一动作：逐项把 remediation contract 写成先红测试，补齐后绿；再打开受控 Host flag 做真实 Electron、持久化和重启读回。视觉上要走查 Agent UI 的异常态、工作模式和右侧 Agent 与画布状态是否一致。

```bash
# 红/绿 contract 集合（当前结果需以实际依赖和当前脚本为准）
pnpm exec vitest run electron/projectAgentHost/projectAgentHost.test.ts electron/projectAgentHost/projectAgentExecutionCoordinator.test.ts --reporter=verbose
# Electron/视觉候选：仅在 Host flag 可控开启后执行，不把 disabled 状态当完成
pnpm run build && node tests/ux/agent-ui-exception-states-runtime.walk.mjs
```

#### M2

generation、editing、canvas/document、MCP surface 等语义切片已经通过 #318/#337/#338/#339/#359/#360 等进入主线，契约和单测也存在。可是 M2 计划仍是“进行中”；旧 MCP chain audit 记录过工具名/授权/lease/full journey 的红灯，ProductionRun parity 和 legacy writer retirement 也没有被当前基线重新证明。零 quota journey 的存在只能证明无成本测试能力，不能替代完整主线语义链。

下一动作：先把当前 tool catalog、manifest、lease/scope/graph、document/canvas、generation/editing 组成一条 mainline red journey，再逐个修成 green；随后做真实 Electron 的选择→调用→预览/批准/拒绝→receipt→重启恢复，并补 Agent 右侧交互的一致性与视觉证据。

```bash
pnpm exec vitest run electron/harness/tools/modelToolSurfaceManifest.test.ts electron/harness/tools/agentToolCatalog.test.ts electron/capabilityCore/mcpCanvasDocumentSurface.test.ts electron/capabilityCore/mcpEditingSurface.test.ts electron/capabilityCore/generationTransportAdapters.test.ts --reporter=verbose
# 该 journey 若因旧工具名/授权或缺门失败，应保留为红灯并迁移，不要静默跳过
pnpm run test:mcp-journey
```

#### M3

M3 的 context factory、skill load、session audit 已通过 #372/#374/#376 合入，prompt pipe/facade/coordinator 单测存在。但 checklist 明确真实 Host 的七层 context 没有覆盖；provider cache、完整 UI ledger projection 和真实 Electron journey 也没有 fresh evidence。

下一动作：在 Host enabled 的受控配置中验证 context → tool → receipt → projection 全链路；把 provider cache 和重启边界拆成可重复的红/绿测试；补宽/窄窗口视觉走查，确认右侧 Agent、画布和分镜表不会出现孤岛状态。

```bash
pnpm exec vitest run electron/harness/context/promptPipe.test.ts electron/ai/agentChatV2.facade.test.ts electron/projectAgentHost/projectAgentExecutionCoordinator.test.ts --reporter=verbose
pnpm run build && node tests/ux/agent-ui-exception-states-runtime.walk.mjs
```

#### M4

M4 provenance docs/implementation/taint-action final 已通过 #405/#407/#408 合入，相关 guard/helper 单测存在。当前仍没有独立的视觉 taint badge 验收；Host disabled 时，taint→action→真实 spend boundary 也没有被实际跑通。旧 stacked 文档里对其他 PR 的依赖不能直接视为当前 main 事实。

下一动作：补 UI 中明确可见的 provenance/taint 状态设计并先做视觉样张；再补 unsigned/signed、tainted/approved、拒绝/批准、receipt 和持久化重启的 Electron red/green journey；最后才做 live/provider 或 spend canary。

```bash
pnpm exec vitest run electron/harness/context/provenanceActionGuard.test.ts electron/projectAgentHost/projectAgentExecutionHelpers.test.ts --reporter=verbose
# 视觉和真实 Host 门：当前 Host disabled 时只能作为候选命令，不能宣称通过
pnpm run build && node tests/ux/agent-ui-exception-states-runtime.walk.mjs
```

#### M5

M5 计划仍是“进行中”，并且 non-goal 明确 `agentHostEnabled=false`。#420 的 packaged MCP 主线已合入；#419 仍是开放的 release runbook，#421/#422 是 stacked branch 上的合并，不是当前 `origin/main` 合入。QA checklist 的历史 M0 smoke、M3 skills smoke、unsigned boundary 不能升级成当前 main 全部毕业；其中 M2 L2 没有重新验证，M3 full Host 没覆盖，Host full persistence 没覆盖，QA 已明确“current main not graduated”。

下一动作：先在当前 main 构建全新 packaged artifact，跑 M0→M5 对应 smoke；再跑 packaged L2 和 Host-disabled/Host-enabled 两种明确边界；记录二进制、commit、签名、工具数、拒绝写入、重启读回和截图。只有所有历史依赖都重放或明确关闭后，才能改 M5 为 graduated。

```bash
pnpm run build && node tests/ux/packaged-mcp-smoke.e2e.mjs release/mac-arm64/Nomi.app
pnpm run test:mcp-l2:packaged
node tests/ux/model-integration-packaged.e2e.mjs --packaged release/mac-arm64/Nomi.app
```

## 3. 旧计划与状态漂移清单

| 文档/主题 | 文档状态 | 当前代码/证据 | 应改成的事实状态 |
|---|---|---|---|
| `2026-09-01-tikhub-connector-v1.md` | “进行中”，v1 acceptance 全 `✅` | connector、route、settings、tests 已合入；无 live/restart/package | “代码/契约已落地；live、重启、packaged、视觉待验收” |
| `2026-09-01-video-deconstruction-v1.md` | “设计+文档 only，样张待拍板，不写壳” | engine、panel、render 已合入 | “壳已存在；设计重新拍板、真实 provider、持久化、Agent handoff 待完成” |
| `2026-09-01-canvas-drag-perf-eval-v2.md` | “S1-S5 已交付，S6 进行中” | S1-S4、S6 hygiene 已合入；S5 artifacts 历史/dirty；click-select 暂停 | “S1-S4 代码已合入；S5 需当前 main 重测；S6 hygiene 已合入、click-select 未完成” |
| `2026-09-01-agent-m0-baseline-freeze.md` | “已拍板·未开工” | M0 文档通过 #272/#275 已合入 | “M0 文档基线已交付，产品代码不在范围” |
| `2026-09-01-m1-final-assembly-closure.md` | “已交付” | M1 代码/单测已合入，但 remediation contract 与真实 Host 缺口仍在 | “装配切片已合入；contract gap、真实 Host、持久化待闭环” |
| `2026-09-02-m2-*.md` | 多处“进行中” | 多个 semantic slice 已合入；完整 chain/parity 未 fresh prove | “语义切片部分完成，M2 overall 未毕业” |
| `2026-09-03-m5-packaged-graduation.md` | “进行中” | #420 已入 main，#419/#421/#422 不是当前 main 全量证据 | “packaged MCP 基础已入主线；current main graduation 未完成” |

另一个容易重复计算的来源是 worktree/远端分支：当前 dirty main worktree、#454 worktree、`perf/canvas-click-select-20260903` 都不能自动算进 `origin/main`。本报告只按基线计算；后续合并前应为每个候选分支建立“是否已被 main 吸收”的 commit/path 对照。

## 4. 全量推进顺序建议

1. 先清账：冻结本报告矩阵，给每个 `featureId` 建一条当前 main 的 red command；把旧 QA 中代理命令、历史 commit、注入 fixture 明确标注为非完成证据。
2. 先合入已完成且低风险的代码/文档分支，但每个 PR 合入前检查 exact merge SHA、变更路径和是否重复包含；不把 stacked branch 的 merge 当作 main merge。
3. 先做零额度 contract/UI 红绿：TikHub payload/error、视频拆解状态/选择/undo、canvas click-select selection truth、M1 deviated/M2 semantic chain/M4 taint boundary。
4. 在用户拍板新样张后做视觉实现；视觉走查必须覆盖 Agent 右侧、画布、分镜表、TikHub 设置、视频拆解面板的桌面/窄屏、中文/英文、空/运行/成功/失败/恢复态。
5. 只在有授权和额度边界时做 TikHub/APIMart live canary；记录 provider、输入 hash、费用/额度、响应 schema 和失败分类。
6. 重新构建并验证 packaged runtime，覆盖 M0-M5 的当前 main，不复用旧二进制或旧 commit 的 `PASS`。
7. 最后再讨论新的架构方案：以合并后的最大当前版本、fresh tests、Electron、重启、视觉和 packaged 证据为输入，而不是以旧计划标题为输入。

## 5. 本次实际改动文件

仅新增本审计报告：

`docs/qa/2026-09-04-epics-rebaseline-audit.md`

没有修改产品代码、测试、计划源文件或任何 merge state；没有合并 PR。审计工作区内依赖未安装，因此本次没有执行构建、Vitest、Electron、provider 或 packaged 命令；命令目录已按后续执行顺序列出，避免把静态检索冒充运行证据。
