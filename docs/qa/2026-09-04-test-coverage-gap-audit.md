# 2026-09-04 能力测试覆盖缺口审计

日期：2026-09-04
基线：`origin/main` = `45912ae01a155a3f6592f65368d0ce3d12fc034e`（merge PR #446；本 worktree 另有未提交用户改动，未纳入本审计）
范围：主收敛计划、现有 QA reports、当前 tests/electron/src 测试目录的快速只读对账。
本次动作：只新增本文档；不运行测试、不做长扫描、不修改产品代码。

## 结论先行

当前主线不是“没有测试”，而是“测试资产分布在合同、unit、fixture、真实 Electron、packaged、持久化/重启和视觉多个层级，缺少按能力和分支收据统一闭环”。因此本表只回答三个问题：

1. 这项能力有哪些 Happy、Boundary、Error/Timeout/Network 场景入口。
2. 每一类证据目前到底到哪一层，哪些只是历史、fixture、mock 或存在测试文件。
3. 下一步要补哪一个最小可重跑收据。

“100% 覆盖”在本审计中的定义是：对一个明确模块的明确分支集合，逐分支留下可定位的测试/走查/持久化/重启收据，并在当前基线复核；不是测试文件数量、用例数量、工具数量或一串 CI 绿灯。没有分支清单、当前 SHA、原始输出/截图或真实用户任务，就不写成 100%。真实用户任务不可由 fixture、静态 mockup、组件存在、按钮点击、历史二进制或单元测试替代。

## 证据状态口径

| 标记 | 含义 |
|---|---|
| `有` | 已找到与该格直接对应的当前测试/收据入口；仍需确认是否覆盖全部分支 |
| `部分` | 只有局部、fixture/mock、历史 SHA、错误态或单层证据，不能升级为能力完成 |
| `缺` | 当前 tests/reports 未找到可引用证据 |
| `阻塞` | 有明确环境、凭据、Host flag、打包物或外部设备阻塞；不作静默 SKIP |
| `不适用` | 该能力/阶段没有这一类证据目标；不是“通过” |
| `待重跑` | 有旧收据或脚本入口，但不是当前基线的可复核结果 |

场景栏中的 `入口` 是可重跑测试/计划入口；`状态` 是本次审计判断。`Error/Timeout/Network` 合并展示，但下一动作必须把三类失败分别分类，不能用延长 timeout 掩盖失败。

## 能力测试矩阵

| 能力 | Happy | Boundary | Error / Timeout / Network | unit | integration | real Electron | packaged | persistence | restart | visual | 下一动作 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Agent 总体（M0–M5 交接）** | 入口：`tests/ux/agent-runtime-production.walk.mjs`、`agent-runtime-editing.walk.mjs`。状态：`部分`，有生产旅程形状但完整 Host canonical 链未在当前基线证明。 | 入口：`electron/harness/tools/modelToolSurfaceManifest.test.ts`、`agentToolCatalog.test.ts`、lease/scope/provenance 测试。状态：`部分`，canonical 工具、项目/session/revision、taint 和 approval 仍需跨层对账。 | 入口：`agent-ui-exception-states-runtime.walk.mjs`、`projectAgentExecutionRecovery` 相关测试。状态：`部分/阻塞`，异常态入口存在；真实 Host 默认关闭，网络/provider 失败与重启 reconcile 未形成统一真实收据。 | `部分` | `部分` | `阻塞` | `部分`（历史 smoke） | `部分`（各 owner 局部） | `部分`（局部 recovery） | `部分`（有 walk 入口，无完整批准视觉验收） | 先按 M0→M5 逐层建立 `context → tool → proposal/receipt → projection → persistence → restart` 的真实任务收据，再谈总体完成。 |
| **Agent / M0 baseline** | 入口：`docs/qa/2026-09-01-agent-m0-red-lights.md`、统一 Agent 主计划。状态：`部分`，M0 文档基线已合入，非产品 Happy path。 | 入口：owner map、tool mapping、deviated red-light 记录。状态：`部分`；旧 `hostLifecycle.test.ts` 现在是转发 shell，不能证明 deviated 分支。 | 入口：M0→M1 红灯清单。状态：`部分`，失败分类已有；没有独立的 timeout/network 产品边界。 | `部分` | `缺` | `缺` | `缺` | `缺` | `缺` | `不适用` | 把 M0 事实改成“baseline docs delivered”；恢复真实 deviated contract test，并用另一个同类入口和重启读回证明唯一 owner。 |
| **Agent / M1 Host** | 入口：`electron/projectAgentHost/projectAgentHost.test.ts`、`projectAgentExecutionCoordinator.test.ts`、reducer/repository 测试。状态：`部分`，生命周期/结算/投影代码与局部单测存在。 | 入口：M1 remediation 的 rc-01/02/05/06、project/session/revision、legacy preservation。状态：`部分`，缺口尚未逐项红→绿闭环。 | 入口：`projectAgentExecutionRecovery.ts`、异常态 walk。状态：`部分/阻塞`，恢复分类有；Host 默认关闭，真实 timeout/network/取消路径未到生产 Host。 | `有` | `部分` | `阻塞` | `缺` | `部分`（repository/receipt 局部） | `缺`（Host 全量） | `缺` | 先逐项补 remediation contract 的失败收据；再在受控 `agentHostEnabled` 下做批准/拒绝、取消、失败恢复、持久化和重启真实用户任务。 |
| **Agent / M2 semantic execution** | 入口：`electron/harness/tools/modelToolSurfaceManifest.test.ts`、MCP canvas/document/generation tests、`mcp-l2-journeys.e2e.mjs`。状态：`部分/待重跑`，语义切片和零额度控制流存在，完整主线未 fresh prove。 | 入口：lease/scope/graph、canonical `nomi_canvas_plan`、document/timeline、legacy writer retirement。状态：`部分`，旧工具名/授权/ProductionRun parity 仍有审计缺口。 | 入口：`mcp-generation-provider-degradation.e2e.mjs`、取消/重试测试。状态：`部分`，fake adapter 可证明控制策略，不证明真实 provider；当前 L2 启动有 60 秒红灯。 | `有` | `部分` | `阻塞` | `部分`（历史/未重放） | `部分`（局部 Run/receipt） | `部分`（局部 recovery） | `缺` | 在当前 main 建立一条从真实 Agent/MCP 调用到语义 effect 的红测；绿后用同一参数补 receipt、落盘、重启和正向/负向 revision 控制。 |
| **Agent / M3 context** | 入口：`electron/harness/context/agentContext.test.ts`、prompt pipe/facade/coordinator tests、`mcp-skills-integration.e2e.mjs`。状态：`部分`，context factory/skill load/stdio read 有证据。 | 入口：七层 context、session identity、skill hash/provider cache、UI ledger projection。状态：`部分`，真实 Host 七层 projection 未证明。 | 入口：agent runtime/provider walks、recovery tests。状态：`部分/阻塞`，局部错误处理有；真实 Host timeout/network/reload 未闭环。 | `有` | `部分` | `阻塞` | `部分`（skills 只读历史 smoke） | `缺`（完整 Host ledger） | `缺`（完整 Host） | `缺` | 在 Host enabled 的受控配置下跑 `context → tool → receipt → projection`；分别记录 skill hash mismatch、provider failure、reload 和重启读回。 |
| **Agent / M4 trust** | 入口：`electron/harness/context/provenanceActionGuard.test.ts`、`electron/vendor/provenance.test.ts`。状态：`部分`，guard/helper 和 provenance 代码存在。 | 入口：signed/unsigned、tainted/approved、spend/approval、receipt scope。状态：`部分`，unsigned write rejection 不能代替 taint→spend 证据，独立 taint badge 也未验收。 | 入口：action guard/helper tests。状态：`部分`，fail-closed 局部有；真实 provider、取消、网络失败和重复确认未形成 Host 旅程。 | `有` | `部分` | `阻塞` | `部分`（unsigned 边界历史） | `缺` | `缺` | `缺` | 先确定并验收可见 provenance/taint 设计；再补批准/拒绝、重复提交、取消、receipt、持久化/重启和受控 spend canary。 |
| **Agent / M5 packaged** | 入口：`tests/ux/packaged-mcp-smoke.e2e.mjs`、`docs/qa/2026-09-03-m5-graduation-checklist.md`。状态：`部分/待重跑`，历史 packaged smoke 有局部通过。 | 入口：signed clients、unknown caller、tools/resources、Host-disabled boundary。状态：`部分`，当前 main 的 M2 L2/M3 full Host/M4 spend 未复核。 | 入口：packaged L2、启动器和客户端拒绝路径。状态：`阻塞/待重跑`，当前有启动超时红灯；不能将其归因或隐藏为业务 SKIP。 | `部分` | `部分`（历史 packaged） | `阻塞` | `部分`（历史 smoke） | `部分`（integration draft） | `部分`（integration draft restart） | `缺` | 用当前 main 重新构建打包物，记录二进制/commit/签名/工具面/拒绝写入/重启回读/截图，再按 M0–M5 逐项判定。 |
| **MCP 总体** | 入口：`tests/ux/mcp-l1-handshake.e2e.mjs`、`mcp-client-activation.walk.mjs`、`mcp-l2-journeys.e2e.mjs`。状态：`部分`，24 项外部 MCP 目录和 L1 stdio 链有证据；不是 24 项真实 effect 全覆盖。 | 入口：`electron/capabilityCore/mcpArgValidation.test.ts`、`mcpProtocol.test.ts`、`mcpStdioProjectSessionBinding.test.ts`、`check:mcp-payload`、`check:mcp-tool-refs`。状态：`部分`，schema/lease/receipt 的工具级正反例与 canonical manifest 映射仍不完整。 | 入口：坏帧、取消长轮询、参数错误、provider degradation、L2 启动。状态：`部分/阻塞`，L1 错误边界较强；L2 当前 checkout 启动 60 秒未拿到窗口；付费 draft 默认是 `SKIP`。 | `有` | `部分` | `阻塞` | `部分`（smoke/历史） | `部分`（owner 局部） | `缺`（统一跨工具） | `缺` | 建立机器可读的 24 工具 coverage ledger；每个写工具用隔离项目验证 effect→receipt→实际文件→重启回读，再补 packaged L2，保留 provider=0 与真实 provider 的证据边界。 |
| **Storyboard 分镜表 + Agent canonical patch** | 入口：`tests/ux/storyboard-table-exec.walk.mjs`、`storyboard-table-phasec.walk.mjs`、`storyboard-trigger.walk.mjs`。状态：`部分`，表格主流程较充分；右侧 Agent canonical path 未证实。 | 入口：`src/workbench/creation/storyboard/*test.ts`、`storyboardPlan*.test.ts`、`docs/qa/2026-09-04-pr454-storyboard-agent-audit.md`。状态：`部分`；必须使用 `toolName=nomi_canvas_plan` + `args.operation=patch_shots`，覆盖选择注入、未点名字​​段保持、非法 revision/model/vendor、重复确认。 | 入口：`patchshots-card.walk.mjs`、`patchshots-width-check.walk.mjs`、分镜状态/失败 walk。状态：`部分`；旧名输入和 preview probe 不能证明生产 Agent；timeout/network 失败态及取消需真实路径。 | `有` | `部分` | `部分/阻塞`（表格有走查，Agent canonical 未证） | `缺` | `缺` | `缺` | `部分/未通过`（旧锚行/参数条样张已被否定，无批准替代设计） | 先对 canonical `nomi_canvas_plan(operation=patch_shots)` 做红测→绿测；补 preview、approve/deny、receipt、落盘/重启和正向控制；等待新设计方向后做真实 Electron 视觉走查。 |
| **Canvas（功能/React Flow/性能 S1–S6）** | 入口：`tests/ux/canvas-real-suite.mjs`、`canvas-s5-walkthrough.walk.mjs`、Canvas store/graph tests。状态：`部分/待重跑`，功能与性能脚本存在，当前基线 fresh evidence 不完整。 | 入口：S1–S6 artifacts、off-canvas、RF kernel、click-select 分支。状态：`部分`；历史 JSON 含旧 commit/dirty，click-select 未合入且业务 store/RF selection truth 冲突仍是缺口。 | 入口：`canvas-real-suite.test.mjs` 的 hard timeout/shard/failure transcript、画布 walk 错误路径。状态：`部分`；本地超时护栏有，network 不适用核心画布；不能把性能通过当交互完成。 | `有` | `部分` | `待重跑` | `部分`（历史 package performance） | `部分`（局部 canvas store） | `缺`（完整用户任务） | `缺`（当前验收包） | 在干净当前 main 上重跑 S5 prod/dev/throttle/L/select；先固定 RF 唯一选择真相和失败断言，再补真实 Electron 截图、拖拽/连接/恢复和必要的重启收据。 |
| **TikHub connector / route** | 入口：`electron/connectors/tikhubConnector.test.ts`、`tikhubConnectorService.test.ts`、`tikhubRoute.test.ts`、`tests/ux/tikhub-connector.walk.mjs`。状态：`部分`，fake 2xx/保存前校验和设置 walk 有证据，未证明真实业务 provider。 | 入口：平台识别、URL 抽取、双域 route/sticky/failover、无 key/不支持平台/无直链。状态：`有/部分`，测试覆盖入口明确，但未形成按 feature branch 的当前收据。 | 入口：`tikhubTransport.test.ts`（401/403/404/5xx/非 JSON/网络失败）、设置页无效 key walk。状态：`有/部分`，错误分类较强；真实请求、quota 和 timeout 仍需凭据/授权。 | `有` | `有`（connector/service/transport mock） | `部分`（无 key/无效 key 诚实错误） | `缺` | `部分`（safeStorage 单测） | `缺`（TikHub 重启读回） | `部分`（有截图能力，未形成验收包） | 先固定 deterministic payload/error fixture contract；再在授权、额度上限和真实 key 下做一次 live canary，补保存/重启/packaged 和视觉收据，失败即分类为 blocked。 |
| **视频拆解 engine / panel / canvas handoff** | 入口：`tests/ux/deconstruction-panel.walk.mjs`、`tests/ux/video-deconstruct.e2e.mjs`、解析/schema 单测。状态：`部分`，面板可注入 result，不能证明 engine/provider。 | 入口：empty/running/result/failed/retry/add/group/undo/coexistence、shot schema、提取到画布。状态：`部分`；流程状态有注入走查，Agent result-slot、单镜 retry 和后续创作交接未闭合。 | 入口：panel walk 错误态、`video-deconstruct.e2e.mjs` 的 `DECONSTRUCT_E2E` 门、provider/network 失败。状态：`部分/阻塞`，默认会 SKIP/注入；真实视频+APIMart 成功证据缺失。 | `部分` | `部分`（fixture） | `部分`（注入结果的面板走查） | `缺` | `缺`；报告指出 renderer state 在 release session 时清空 | `缺` | `缺/待设计`（旧 mockup 不能自动成为验收） | 先用 deterministic fixture 固定解析、状态和失败契约；再做受授权的真实 provider canary；补 durable result/selection/restart、Agent handoff 和用户认可的桌面/窄屏视觉验收。 |
| **跨设备继续编辑** | 入口：当前有 `electron/workspace/workspaceRepository.test.ts`、`workspaceManifest*.test.ts`、`workspaceProjectIdentity.test.ts` 等本地工作区测试；计划入口 `docs/superpowers/plans/2026-09-01-cross-device-project-continuation.md`。状态：`部分/仅计划边界`，本地项目存储不能等同双机闭环。 | 入口：workspace path、revision、backup、manifest lock/corruption、missing asset 相关测试/计划。状态：`部分`；设备级设置、Keychain/DPAPI、绝对路径、冲突隔离边界已写明。 | 入口：计划中的 sync incomplete、另一设备新版本、损坏清单、素材缺失、配置失败、密钥重填、空间不足、冲突副本。状态：`缺/阻塞`，当前未找到已落地的跨设备真实任务收据；network 由外部同步客户端承载，需单独标明。 | `部分`（本地 workspace） | `缺`（双 profile/sync） | `缺` | `缺` | `部分`（本地 repository/backup） | `缺`（跨设备重开） | `缺` | 刷新 #328 的 owner/分支/dirty 状态；随后用两个独立 Electron profile 完成 A 保存关闭→同步→B 打开编辑保存→同步回 A，覆盖冲突/离线/缺资源/导出/重开；模拟 profile 不得写成真实双机证据。 |

## 证据缺口的统一收口顺序

矩阵不要求一次性补齐所有能力；每项按风险最小闭环推进：

1. **先定模块和分支**：给 `featureId` 列出 Happy、Boundary、Error、Timeout、Network 的具体分支，不用“有测试文件”代表全覆盖。
2. **先红后绿**：在当前 main 记录一个可观察缺口；实现/合流后以同一输入、同一命令、同一分支集合复跑。若本来已绿，登记为已吸收/重复，不制造假红灯。
3. **再做真实任务**：从用户目标出发走完整闭环，例如“让 Agent 修改选中镜头并恢复”“导入视频并把拆解结果送入画布”“在第二个 profile 继续编辑并导出”。真实任务必须记录实际入口、结果、失败原因和截图。
4. **再核对副作用**：对写能力读取真实项目文件/owner store，核对 revision、receipt、字段保留、撤销和重启回读；mock handler 只能证明控制流。
5. **最后补打包/视觉**：使用当前 commit 新构建的 packaged app；视觉证据必须覆盖实际组件、桌面/窄屏、空/运行/成功/失败/恢复态，并注明是否得到设计认可。

## 当前不应写成的结论

- 不能把 `CI green`、工具目录数量、测试文件数量、历史 `50/50`、旧二进制 smoke 或 fixture walk 写成能力 100%。
- 不能把点击 Login/Generate、出现卡片、面板有结果、旧 mockup 与静态 DOM 断言写成真实用户任务完成。
- 不能把 `agentHostEnabled=false` 下的单测/unsigned rejection 写成 M1/M3/M4 Host 真实完成。
- 不能把 `mcp-draft-loop` 默认 `SKIP`、真实 provider 未授权、TikHub/APIMart 缺 key 或跨设备只有两个模拟 profile 写成 live-certified。
- 不能把“已合入”与“已证明”合并成一个状态；每个模块/分支都要保留当前 SHA、证据类型、缺口和下一动作。

## 主要来源

- 主计划：[2026-09-04-main-convergence-and-rebaseline.md](../superpowers/plans/2026-09-04-main-convergence-and-rebaseline.md)
- Epic 重基线：[2026-09-04-epics-rebaseline-audit.md](2026-09-04-epics-rebaseline-audit.md)
- MCP 审计：[2026-09-04-mcp-rebaseline-audit.md](2026-09-04-mcp-rebaseline-audit.md)
- Storyboard/Agent 审计：[2026-09-04-pr454-storyboard-agent-audit.md](2026-09-04-pr454-storyboard-agent-audit.md)
- M0 红灯：[2026-09-01-agent-m0-red-lights.md](2026-09-01-agent-m0-red-lights.md)
- M5 清单：[2026-09-03-m5-graduation-checklist.md](2026-09-03-m5-graduation-checklist.md)
- 跨设备计划：[2026-09-01-cross-device-project-continuation.md](../superpowers/plans/2026-09-01-cross-device-project-continuation.md)
