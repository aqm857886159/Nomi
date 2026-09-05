# Nomi 真实用户测试契约与验收报告模板

日期：2026-09-04
契约基线：`origin/main=68e88075ddfaa90edb0078f902b2d9103dba1bb3`
适用范围：Agent、MCP、Storyboard、Canvas、TikHub、Video 以及 M0–M5 的后续实现、合流和重基线工作

> 这是一份可执行的测试契约和收据模板，不是“当前全仓库已验收”的报告。本次文档 PR 只固化规则；它没有替任何能力补真实 Electron、packaged、provider、重启或视觉证据，也没有声称全仓库 100% 覆盖。

## 1. 结论口径：什么才算完成

每个 `featureId` 都必须沿同一条证据链收口。顺序不能倒置，也不能用后面的证据补齐前面的缺口：

```text
真实用户任务 Electron / packaged journey
  → H / B / E / T / N 生产入口断言
  → 只在 transport / provider boundary 使用边界 mock
  → 真实副作用持久化 + cold start / restart readback
  → 视觉走查（先 image2 生成；用户确认后才允许实现）
  → changed production scope 的 raw V8 statements / branches = 100%
```

### 1.1 四个正交状态

测试收据同时填写“证据状态”和“交付状态”，不要把它们压成一个绿色图标。

| 状态 | 可以证明什么 | 不能证明什么 |
|---|---|---|
| `mock` | transport/provider 边界的控制流、错误分类、调用次数和“不产生副作用” | 真实供应商、真实 Electron、实际文件、重启恢复、用户任务完成 |
| `simulated` | deterministic fixture、loopback、零额度流程或模拟 profile 的可重复行为 | live provider、packaged parity、双机同步、真实用户价值闭环 |
| `live-certified` | 在明确记录的真实凭据/真实 Electron 或 packaged app 上完成了指定任务和副作用核对 | 未列出的工具、分支、平台或整个仓库 |
| `blocked` | 已定位的环境、凭据、平台、Host flag、打包物、网络或用户决策阻塞 | 通过；`blocked` 不得静默改成 `skip` 或 `pass` |

交付状态只能使用以下值：`已合入且已证明`、`已合入但未证明`、`部分完成`、`仅计划/设计`、`未开始`、`被阻塞`、`等待 owner/状态刷新`、`等待用户决策`。`CI green` 只能写在某个证据栏，不能直接作为交付状态。

### 1.2 明确不计入完成的“假绿”

- 点击 Login、Generate、Confirm、Retry 或 Export 按钮，只证明用户发出了动作，不证明认证、生成、确认、落盘或导出成功。
- 内部 reducer/state 注入、`window.__*` preview probe、静态 DOM、组件存在、fixture 直接灌入结果、旧二进制 smoke、历史 SHA 或测试文件存在，都不能代替真实用户任务。
- `agentHostEnabled=false` 下的单元测试不能证明真实 Host；mock provider 的 2xx 不能证明 live provider；两个模拟 profile 不能证明双设备同步。
- `SKIP`、`catch` 后继续、空数组、宽泛 selector、扩大 timeout、`|| true`、无测试通过（`--passWithNoTests`）都不能制造绿证据。
- 性能预算通过不能证明视觉、选择、拖拽、连线、持久化或业务交接完成；一张“看起来对”的截图不能替代状态矩阵。

## 2. Gate A：每个能力的强制验收顺序

### A0. 先定义真实用户任务

先写用户目标和实际入口，而不是先写测试文件。例如：

> 用户在一个隔离项目中选中一个镜头，请 Agent 修改时长和 prompt；用户查看行内预览，批准一次并能撤销；关闭并重新打开项目后，修改、receipt 和未点名字段仍然存在。

真实任务必须：

1. 从实际 Electron UI、MCP stdio 生产入口或真实 packaged app 开始；
2. 通过真实命令/桥接/Host/项目 repository 产生用户可观察 effect；
3. 读取实际项目文件、事实源、receipt、revision 或最终媒体验证结果；
4. 保存进入前、关键操作、确认/失败、落盘、重启后的证据；
5. 明确使用的是 `simulated`、`live-certified` 还是 `blocked`。

### A1. H/B/E/T/N 生产入口矩阵

每个 `featureId` 都要填满五类分支，且每类都有可观察断言。

| 类别 | 必须回答的问题 | 最小断言 |
|---|---|---|
| Happy | 正常用户目标是否完成？ | effect 正确产生，用户看到正确状态，结果可继续编辑 |
| Boundary | 长度、空值、Unicode、范围、权限、旧数据、revision 边界是什么？ | 边界输入被接受或拒绝，理由稳定，未发生越权副作用 |
| Error | 输入/状态/供应商错误是否可理解且可恢复？ | 错误码/文案可定位，状态不假成功，重试/取消语义明确 |
| Timeout | 等待超时时是否停止在正确阶段？ | 不重复发起、不扣费、不丢 proposal/receipt，用户能恢复 |
| Network | 断连/非 JSON/401/403/404/5xx/网络失败如何处理？ | transport/provider 错误被分类，敏感信息不泄漏，重试有界 |

H/B/E/T/N 的测试可以在边界使用 deterministic mock，但 mock 必须位于 transport/provider boundary；生产入口、schema、授权、项目/session/revision 绑定、effect guard 和结果投影必须真实执行。

### A2. 边界 mock 规则

允许 mock 的位置：

- transport 的 `invoke`、HTTP/WebSocket 响应、外部 provider polling、网络断连和确定性 timeout；
- 仅用于验证“请求如何被分类/拒绝/重试”，并断言 provider task、扣费、文件写入、receipt 写入均未发生；
- mock contract 必须记录输入、响应、调用次数、延迟模型和预期副作用。

禁止 mock 的位置：

- 用户点击、表单提交、MCP `tools/call`、真实 schema/manifest、授权/确认、Host projection、项目 repository、持久化读回、Electron 窗口和 packaged binary；
- 用 mock 返回结果直接填充 renderer store，再宣称 engine/provider/Agent 完成；
- 用 mock 截图、静态 HTML 或内部 reducer 注入代替用户路径。

### A3. 持久化和 cold start / restart

任何写能力都必须证明：

- 写入的事实源、项目身份、revision、receipt、字段保留、撤销/拒绝状态和结果文件；
- 关闭当前窗口或进程后重新打开项目，能读回相同语义状态；
- 恢复不会重复执行、重复扣费、重放旧 proposal、污染另一个项目或丢失错误原因；
- 如果能力不产生持久化，写明 `不适用` 和原因，不能留空；如果环境无法执行，写 `blocked` 和替代的低层证据。

“单测里 repository mock 的 snapshot 相等”只能作为局部证据；真实用户任务必须至少有一次真实 repository lifecycle，适用时再加 packaged readback。

### A4. 视觉门：image2 → 用户确认 → 实现

视觉或交互变更必须先经过 `docs/design/nomi-design-flow-image2-gate.md`：

1. 写 Prompt Brief 和用户要解决的摩擦；
2. 先生成 image2/样张，并把输出路径放进收据；
3. 等用户或指定 reviewer 明确确认，冻结设计 contract；
4. 只有确认后才进入 UI 实现；实现后在真实 Electron/packaged 上截图逐项对账；
5. 视觉失败、旧样张被否定或没有确认时，状态是 `等待用户决策`，不得继续叠加实现。

走查至少覆盖布局/层级、空/运行/成功/失败/确认/恢复态、主题、窄屏、键盘可达性、无裁切/重叠/重复控件、项目/Agent 身份和重启后显示一致性。自动化截图是证据材料，不是人工视觉 sign-off。

### A5. changed production scope 的 raw V8 门

代码 PR 的最后一道局部门是“本 PR 实际修改的 production scope”，不是全仓库总百分比，也不是把未改动 legacy 代码藏进 exclude：

```bash
evidence_dir="outputs/qa/2026-09-04/<featureId>/<head_sha>"
pnpm exec vitest run <production-entry-tests> \
  --coverage --coverage.provider=v8 \
  --coverage.include=<changed-production-file-1> \
  --coverage.include=<changed-production-file-2> \
  --coverage.reporter=text --coverage.reporter=json \
  --coverage.reportsDirectory="$evidence_dir/raw-v8" \
  --coverage.thresholds.statements=100 \
  --coverage.thresholds.branches=100
```

收据还要从 `coverage-final.json` 的 `statementMap` / `branchMap` 标出精确 changed span、分母、未覆盖条件和 owner。不得使用 coverage exclusion、ignore 注释、快照或只报总百分比绕过 changed scope；未改动 legacy 分支另列，不冒充本 PR 的 100%。

本次文档 PR 没有 changed production scope，因此 raw V8 对本 PR 是 `不适用`；这不是“全仓库 100%”，也不是产品验证通过。

## 3. 先红后绿：同一断言证据格式

每个新保护、缺口修复或重基线项，必须使用同一输入、同一命令、同一 featureId、同一断言 ID 和同一分支集合留下红/绿两段收据。临时制造红测的改动不得提交。

```text
featureId: <stable-id>
assertionId: <stable-id>
scope: <user-visible behavior and exact branch set>
base_sha: <exact origin/main or target baseline SHA>
head_sha: <exact implementation/test SHA; red phase may be blank>
environment: <OS / Electron mode / app version / harness version>
input: <project snapshot / tool args / fixture / provider response>
command: <exact command, copied unchanged into green proof>

red_proof:
  status: FAIL
  observed: <actual failure, assertion location, missing user condition>
  artifact: <raw output / JSONL / screenshot path>

green_proof:
  status: PASS
  observed: <same assertion and same branch set now pass>
  artifact: <raw output / JSONL / screenshot path>

positive_control:
  mutation: <wrong revision / unknown operation / removed guard / wrong expected value>
  expected: FAIL
  observed: <the test really blocks the regression>

remaining: <uncovered branch, blocker, owner, next command>
```

红证据必须是用户可观察行为未成立的真实失败；“文件不存在”只可用于验证收据机器本身的红门，不能当产品缺口。若目标断言在 baseline 已经通过，登记为“缺口判断错误/已吸收/duplicate”，不得为了格式制造假红。绿证据必须重跑同一命令；只换测试名、换 fixture、换 mock、换 SHA、放宽断言或扩大 timeout 都不算同一断言。

## 4. 收据字段和 artifact 约定

每项能力至少保存以下路径；路径中的 `<run-id>`、`<featureId>`、`<sha>` 必须实际替换，不能写“见日志”。

| 证据 | 最低 artifact 路径 | 必须包含 |
|---|---|---|
| 命令/失败输出 | `outputs/qa/2026-09-04/<featureId>/<sha>/red` 或 `green` | 完整命令、exit code、stdout/stderr、环境和时间 |
| Electron/packaged 走查 | `evals/runs/<run-id>/output.jsonl`、`evals/runs/<run-id>/screenshots/` | 用户步骤、实际 UI 状态、截图、项目/应用身份 |
| system receipt | `tests/system/runs/<run-id>/summary.json`、`report.md` | scope、断言数、失败分类、持久化/重启结果 |
| 项目副作用 | `outputs/qa/2026-09-04/<featureId>/<sha>/persistence/` | 文件清单、revision、receipt、前后摘要、重启读回 |
| raw V8 | `outputs/qa/2026-09-04/<featureId>/<sha>/raw-v8/coverage-final.json`、`coverage-summary.json` | statements/branches、changed span、未覆盖条件 |
| 视觉 | `outputs/qa/2026-09-04/<featureId>/<sha>/visual/` | image2、批准记录、宽/窄截图、差异说明、reviewer 结论 |

收据中的每条 artifact 都要能从当前 SHA 重跑。`/tmp` 可以作为运行中间目录，但最终报告必须复制或上传可定位的原始输出；只留下一个临时路径或一行“通过”不够。

## 5. CI 和本地命令门

这些命令来自当前 `package.json` 和 `.github/workflows/quality-gate.yml`；按改动风险选择，但选中的门必须有收据，未选的风险面要写明 `不适用` 或 `blocked`。

| 风险面 | 命令 | 门的含义 |
|---|---|---|
| 交付基线 | `pnpm run delivery:preflight` | 非 main、`origin/main` 可追溯、工作树干净；开始和 push 前记录 exact SHA |
| contracts | `pnpm run gates:contracts` 或 `pnpm run test:system:contracts` | 静态合同、脚本引用、边界、密钥、类型和测试系统合同；不等同产品完成 |
| unit/runtime | `pnpm run test:system:unit` 或 `pnpm run test:system:focused` | 单元/Agent runtime；必须反查到 featureId 和 H/B/E/T/N 分支 |
| desktop/journeys | `pnpm run test:e2e`、`pnpm run test:journeys`、`pnpm run test:system:desktop`、`pnpm run test:system:journeys` | 真实 Electron 用户旅程；必须保存截图/JSONL 和实际 effect |
| MCP | `pnpm run test:mcp-journey`、`pnpm run test:mcp-elicitation` | MCP L1/L2、授权/确认、结果投影和错误边界；零额度不等于 live provider |
| canvas | `pnpm run test:canvas:critical`、`pnpm run test:canvas:acceptance`、`pnpm run test:system:canvas:full` | React Flow 业务功能和真实走查；性能需单独跑 |
| performance | `pnpm run test:canvas:performance`、`pnpm run test:canvas-perf`、`pnpm run test:system:performance` | 性能预算和原始测量；不替代业务交互/视觉/持久化 |
| package | `pnpm run dist:mac:dir`、`pnpm run test:mcp-l2:packaged`、`pnpm run test:system:release` | 当前 SHA 新构建的 packaged app、安装身份、bridge、工具面和重启；缺包即 `blocked` |
| release/CI | `pnpm run gates`；Quality Gate 的 `contracts`、`unit`、`desktop-linux`、`canvas-acceptance`、`canvas-performance`、`mac-package` | CI 分层健康；Windows 另按需运行 `Win Gate`，不能用 Linux 代替 Windows |

Quality Gate 的 scope 会按 changed files 选择 unit/desktop/journeys/canvas/performance/package；fail-closed profile、上传的 walkthrough artifact 和 quality 汇总必须保留。`desktop-preview` 只在带 `desktop-preview` label 或手动 dispatch 时运行；`desktop-rc` 和 `win-gate` 不是普通 PR 自动绿证据。

## 6. 当前必测任务表（以 `origin/main=e0cd6742` 重跑）

下表是当前 Agent/MCP/Storyboard/Canvas/TikHub/Video/M0–M5 的最低任务，不是已通过清单。每次执行都必须为每行创建本契约第 3 节的 red/green receipt；没有实际运行结果时保留“缺口/待重跑”。

| featureId | 必测真实用户任务 | H/B/E/T/N 与命令 | artifact 路径 | 失败判定 / 已知缺口 | baseline 规则 |
|---|---|---|---|---|---|
| `AGENT.OVERALL.CREATIVE-JOURNEY` | 新建隔离项目；用户让 Agent 修改选中镜头/文档；用户批准或拒绝；看到可编辑结果并重启读回 | H/B/E/T/N：`tests/ux/agent-runtime-production.walk.mjs`、`agent-runtime-editing.walk.mjs`、异常态 walk；unit：`electron/projectAgentHost/*test.ts`；`pnpm run build && node tests/ux/agent-runtime-production.walk.mjs` | `evals/runs/<run-id>/`、`tests/system/runs/<run-id>/`、`outputs/qa/.../persistence/` | Host canonical 链、context→tool→receipt→projection、真实 Host 默认关闭、网络/provider/重启 reconcile 未形成统一 live 收据 | 不能以 reducer 注入、按钮点击、旧 preview probe 或 Host disabled 的绿测覆盖真实任务；先记录 baseline red 或 `blocked` |
| `AGENT.M0.BASELINE` | 验证 M0 定义的 owner、工具映射、ProductionRun approval、captured snapshot 和 deviated durable state；M0 本身是合同/事实基线，不把文档当产品 happy path | `pnpm exec vitest run electron/productionRun/productionGenerationAuthorizationFlow.test.ts electron/productionRun/productionShotGate.test.ts electron/productionRun/productionRunE2eFixture.test.ts electron/capabilityCore/canvasReadCapturedSnapshotFlow.test.ts electron/projectAgentHost/projectAgentHost.test.ts --reporter=verbose` | `outputs/qa/.../M0/`、`tests/system/runs/<run-id>/summary.json` | M0 文档已交付但 deviated 真实合同需重建；旧 `electron/projectAgentHost/hostLifecycle.test.ts` 转发壳不能证明旧命题 | 不因 M0 文档已合入而写产品完成；旧命令若不存在必须标 stale，不得更新 baseline 掩盖 |
| `AGENT.M1.HOST` | 在受控 `agentHostEnabled` 下创建 turn，执行/取消/拒绝/失败一次，保存 terminal usage/receipt，关闭再打开 Host 读回 | `pnpm exec vitest run electron/projectAgentHost/projectAgentHost.test.ts electron/projectAgentHost/projectAgentExecutionCoordinator.test.ts --reporter=verbose`；再跑 `pnpm run build && node tests/ux/agent-ui-exception-states-runtime.walk.mjs` | `tests/system/runs/<run-id>/`、`evals/runs/<run-id>/screenshots/`、`outputs/qa/.../restart/` | rc-01/02/05/06、真实 Host、全量 persistence/restart、取消/timeout/network 未闭环；M1 代码已合入不等于毕业 | 先红后绿使用同一 Host flag、项目和 turn 输入；不得把 `agentHostEnabled=false` 当 green |
| `AGENT.M2.SEMANTIC` | 从 canonical tool 到 document/canvas/generation/timeline effect，用户预览、确认/拒绝、撤销并重启恢复 | `pnpm exec vitest run electron/harness/tools/modelToolSurfaceManifest.test.ts electron/harness/tools/agentToolCatalog.test.ts electron/capabilityCore/mcpCanvasDocumentSurface.test.ts electron/capabilityCore/mcpEditingSurface.test.ts electron/capabilityCore/generationTransportAdapters.test.ts --reporter=verbose`；`pnpm run test:mcp-journey` | `outputs/qa/.../M2/`、`evals/runs/<run-id>/` | 旧 writer retirement、lease/scope/graph、ProductionRun parity、完整语义链未 fresh prove；zero-quota journey 不能替代真实 effect | 不更新 semantic baseline 来吞掉旧工具名、授权、revision 或 receipt 失败；历史合入 SHA 必须标为历史 |
| `AGENT.M3.CONTEXT` | 用户打开项目后 Agent 读取七层 context/skill，执行一次工具调用，UI ledger 显示正确 identity，reload/restart 后仍能回查 | `pnpm exec vitest run electron/harness/context/promptPipe.test.ts electron/ai/agentChatV2.facade.test.ts electron/projectAgentHost/projectAgentExecutionCoordinator.test.ts --reporter=verbose`；配合 `pnpm run build && node tests/ux/agent-ui-exception-states-runtime.walk.mjs` | `outputs/qa/.../M3/`、`evals/runs/<run-id>/screenshots/` | 真实 Host 七层 projection、provider cache、完整 ledger/restart 未证明；context factory 单测不是用户闭环 | baseline 只允许增加有明确 featureId 的断言；不得以 skill stdio read 历史 smoke 更新完成状态 |
| `AGENT.M4.TRUST` | 用户看到 signed/unsigned、tainted/approved 状态；拒绝一次不产生 effect，批准一次产生 scoped receipt，重启后状态不漂移 | `pnpm exec vitest run electron/harness/context/provenanceActionGuard.test.ts electron/projectAgentHost/projectAgentExecutionHelpers.test.ts --reporter=verbose`；真实走查在 image2 确认后执行 | `outputs/qa/.../M4/`、`outputs/qa/.../visual/`、`outputs/qa/.../restart/` | 独立 taint badge/视觉未验收；Host disabled 下 taint→action→真实 spend 未覆盖；live/provider 需另行授权 | 未有批准 image2 前不得实现新的视觉；unsigned rejection 单测不能更新为 M4 live-certified |
| `AGENT.M5.PACKAGED` | 用当前 SHA 新打包 app，用户完成 M0→M5 关键链：client confirmation、工具/资源、拒绝写入、重启回读 | `pnpm run build && node tests/ux/packaged-mcp-smoke.e2e.mjs release/mac-arm64/Nomi.app`；`pnpm run test:mcp-l2:packaged`；`node tests/ux/model-integration-packaged.e2e.mjs --packaged release/mac-arm64/Nomi.app` | `outputs/qa/.../M5/`、`evals/runs/<run-id>/`、package artifact checksum/signature | 当前 main 的 M2 L2、M3 full Host、M4 spend guard、packaged parity 尚未重新证明；历史 smoke 不毕业 | 只接受当前 HEAD 新构建二进制；缺 `release/mac-arm64/Nomi.app` 或签名/身份不符时记 `blocked`，不复用旧 release |
| `MCP.OVERALL.TOOL-SURFACE` | 用户激活 MCP client，看到正确 tools/list，调用读/写工具，结果回到正确项目，断连/取消后恢复且不重复执行 | `pnpm run test:mcp-journey`；`pnpm run test:mcp-elicitation`；contracts：`pnpm run check:mcp-payload && pnpm run check:mcp-tool-refs` | `evals/runs/<run-id>/`、`tests/system/runs/<run-id>/`、`outputs/qa/.../mcp/` | 24 工具目录不是 24 项真实 effect；L2 启动、统一跨工具 persistence/restart、packaged L2 和付费确认仍缺口 | 不把 tools/list 数量、L1 handshake、mock transport 或默认 `SKIP` 更新成 live-certified |
| `STORYBOARD.CANONICAL.PATCH-SHOTS` | 用户在新版分镜表选中镜头；右侧 Agent 以 `toolName=nomi_canvas_plan`、`args.operation=patch_shots` 提议；用户预览、批准/拒绝、撤销，未点名字段保留，重启可恢复 | unit：`src/workbench/creation/storyboard/storyboardDInteractions.test.ts`、`exec/storyboardExec.test.ts`、`storyboardPlanLifecycle.test.ts`；`pnpm run build && node tests/ux/storyboard-table-exec.walk.mjs`；canonical journey 必须真实喂 `nomi_canvas_plan` + `operation=patch_shots` | `evals/runs/<run-id>/screenshots/`、`outputs/qa/.../storyboard/`、`outputs/qa/.../persistence/` | 旧 `patch_shots` toolName、`window.__nomiStoryboardPatchPreview` 只能算旧名/探针；选择注入、confirmation/receipt、落盘/重启、非法 revision/model/vendor 尚未闭合；旧锚行/参数条样张已否定 | 不修改或更新被否定的旧 mockup baseline；新视觉先 image2→用户确认，确认前状态为 `等待用户决策` |
| `CANVAS.FUNCTIONAL.REACT-FLOW` | 用户打开真实画布，拖拽/平移/缩放/选择/连接节点，修改后回到时间轴/预览，关闭重开后节点与业务状态一致 | `pnpm run build && pnpm run test:canvas:critical`；完整时 `pnpm run test:canvas:acceptance`；unit：`src/workbench/generationCanvas/reactFlow/canvasNodeSelectionSync.test.ts`、`generationCanvasReactFlowAdapter.test.ts` | `evals/runs/<run-id>/`、`tests/ux/shots/`、`outputs/qa/.../canvas/` | 当前基线 fresh S5 不完整；S6 click-select 未合入且 RF/业务 selection 双真相冲突；性能通过不等于交互完成 | 历史 JSON 含旧 commit/`dirty:true` 时只作历史；禁止为了让 benchmark 通过更新/重写 baseline，先修真实失败再用原参数复跑 |
| `CANVAS.PERFORMANCE.S1-S6` | 低负载干净环境运行 prod/dev/throttle/L/select，保存原始性能和画布外重渲染/拖拽几何证据，再做用户走查 | `pnpm run build && node tests/ux/canvas-performance-benchmark.e2e.mjs final-postfix-prod --scale S --scenario blank-pan,node-drag-image,node-drag-video,multi-node-drag,drag-at-low-zoom,drag-over-dense-edges --runs 5 --warmup 1`；select 同脚本 `final-postfix-select --scale S --scenario click-select --runs 5 --warmup 1`；`node tests/ux/canvas-s5-walkthrough.walk.mjs` | `tests/ux/perf-results/canvas-*.json`、`evals/runs/<run-id>/screenshots/`、`outputs/qa/.../canvas-perf/` | 高负载、媒体同时播放、旧 dirty artifact、click-select 选择冲突会使结果无效；S6 hygiene 不覆盖 click-select | 不更新阈值或提交新的 dirty baseline 来消除越线；必须记录机器负载、commit、runs/warmup 和原始 JSON |
| `TIKHUB.CONNECTOR.LIVE-BOUNDARY` | 用户在设置中保存 key，导入分享链接，看到平台/来源证据和错误；退出重启后安全配置读回；经授权才做一次真实无水印 canary | contract：`pnpm exec vitest run electron/connectors/tikhubConnector.test.ts electron/connectors/tikhubTransport.test.ts electron/connectors/tikhubRoute.test.ts electron/connectors/tikhubConnectorService.test.ts electron/shared/contracts/tikhubErrorKinds.test.ts --reporter=verbose`；walk：`pnpm run build && node tests/ux/tikhub-connector.walk.mjs`；live：`TIKHUB_E2E=1 TIKHUB_API_KEY=<authorized-key> TIKHUB_SHARE_URL=<authorized-url> node tests/transport-spike/tikhub.mjs` | `outputs/qa/.../tikhub/`、`evals/runs/<run-id>/screenshots/`、`outputs/qa/.../restart/` | fake 2xx/invalid key 不能证明真实 provider；当前无真实 key、quota、packaged、TikHub 重启读回和成功证据 | 没有明确 key/额度授权时不重试、不更新 live baseline，保留 mock/simulated 和 `blocked` |
| `VIDEO.DECONSTRUCTION.END-TO-END` | 用户导入真实视频，等待拆解，查看/选择镜头，送入新版分镜表/画布，重试一个失败镜头，重启后结果仍可回查 | unit：`pnpm exec vitest run electron/video/deconstructVideo.test.ts --reporter=verbose`；fixture walk：`pnpm run build && node tests/ux/deconstruction-panel.walk.mjs`；live：`pnpm run build && DECONSTRUCT_E2E=1 node tests/ux/video-deconstruct.e2e.mjs <authorized-video>` | `outputs/qa/.../video/`、`evals/runs/<run-id>/screenshots/`、`outputs/qa/.../persistence/` | 面板注入结果只证明 UI/store；真实 APIMart/provider、durable result/selection/restart、Agent handoff、单镜 retry 和用户确认视觉仍缺口 | 缺 APIMart key/额度或用户确认设计时记 `blocked`/`等待用户决策`；不把注入结果或旧 mockup 写成 live-certified |

## 7. 已知缺口总表（本基线，不是完成宣称）

| 能力簇 | 当前已知事实 | 必须补的最小闭环 |
|---|---|---|
| Agent / M0–M5 | 文档、装配、语义切片、context、trust 和 packaged 基础代码分散存在；各阶段仍有历史/局部/待重跑证据 | 每个 M 阶段都补真实任务、H/B/E/T/N、receipt、持久化/重启、适用的 packaged 和视觉证据；M0 文档完成不能替代产品完成 |
| MCP | L1 handshake、schema/manifest 和若干零额度 L2 入口存在；不是所有工具真实 effect 的证明 | 建立工具 coverage ledger；写工具逐项验证授权→effect→receipt→实际文件→重启；补取消、断连、elicitation、packaged L2 和明确的 live/provider 边界 |
| Storyboard | 新版表格部分功能存在；canonical 右侧 Agent 仍混有旧 `patch_shots` 判定，旧锚行/参数条设计被否定 | 用 `nomi_canvas_plan` + `operation=patch_shots` 做生产形状红→绿；补选择、未点名字段、preview/approve/deny、receipt、落盘/重启；新 image2 先获确认 |
| Canvas | React Flow 单内核和性能工具已合入；S5 artifact 有历史/dirty，S6 click-select 未合入 | 在 current main 低负载重跑 prod/dev/throttle/L/select；先修选择真相与业务投影，再补真实拖拽/连接/恢复/截图，不更新 baseline 藏越线 |
| TikHub | connector/route/safeStorage/fixture/unit 代码存在；没有当前真实 key 成功、packaged、重启和额度收据 | 先完成 deterministic payload/error contract；获授权后做一次有限 live canary；补保存→重启、packaged 和视觉，失败分类为 `blocked` |
| Video | engine/panel/render 代码存在，默认走查注入结果；真实 APIMart/provider 和 durable state 未闭合 | fixture 先固定 schema/错误控制流；授权后跑真实视频 canary；补结果/选择持久化、重启、Agent handoff、retry 和新设计确认 |
| 视觉 / 全局 | 有批准和未批准样张并存，CI/截图有时只能证明脚本跑过 | 每个 UI 功能都走 image2→用户确认→实现→真实 Electron 截图；未确认对象不进入实现，未有真实任务/重启/视觉者不得升级状态 |
| coverage | 既有局部 receipt 可对 changed span 做 raw V8 100%；仓库总 coverage 不是本契约目标 | 每个代码 PR 精确登记 changed production span；raw V8 statements/branches 必须 100%，未改动 legacy branch 列为后续 owner，不用 exclude/快照遮挡 |

## 8. 验收报告可复制模板

把下面内容复制到对应 QA 报告，并删除不适用的空项；空项不能默认为通过。

```markdown
# <featureId> 验收报告

date: <YYYY-MM-DD timezone>
featureId: <stable id>
delivery_status: <one allowed delivery status>
evidence_status: <mock | simulated | live-certified | blocked>
owner: <person or task>
base_sha: <exact SHA>
head_sha: <exact SHA>
merge_sha: <exact merge SHA or not merged>
environment: <OS / Electron dev or packaged / app version / harness>

## User task

goal: <real user outcome>
entry: <actual UI / MCP / packaged entry>
steps: <numbered user actions, no internal injection>
observed_effect: <actual visible and persisted effect>

## H/B/E/T/N

| class | production entry / command | assertion | result | artifact |
|---|---|---|---|---|
| Happy | | | | |
| Boundary | | | | |
| Error | | | | |
| Timeout | | | | |
| Network | | | | |

mock_boundary: <exact transport/provider seam; explain why it cannot create product effect>

## Red then green

assertionId: <stable id>
input: <same input in both phases>
command: <same command in both phases>
red_proof: FAIL; <observed failure>; artifact: <path>
green_proof: PASS; <observed pass>; artifact: <path>
positive_control: <mutation>; expected FAIL; artifact: <path>

## Persistence / restart

persistence_proof: <file/store/receipt/revision paths and values>
restart_proof: <cold start/reopen command and exact readback>
duplicate_or_replay_check: <result>

## Visual

image2_prompt_brief: <path>
image2_output: <path>
user_or_reviewer_confirmation: <name/date/decision or waiting user decision>
implementation_screenshot_paths: <paths>
visual_result: <pass/fail/blocked with differences>

## Raw V8 changed production scope

scope_files: <exact changed production files and spans>
command: <exact vitest v8 command>
raw_report: <coverage-final.json and coverage-summary.json>
statements: <covered/total = 100% or blocked>
branches: <covered/total = 100% or blocked>
uncovered_conditions: <none or exact input conditions + owner>

## Decision

current_state: <one allowed delivery status>
known_gaps: <specific gaps, no generic “待完善”>
next_action: <exact command/task/owner>
baseline_update: <禁止更新 / allowed reason and reviewer>
```

## 9. baseline 禁令与停线条件

### 9.1 禁止更新 baseline 的情况

- 只是为了消除失败、越线、dirty 标记、旧 commit、缺 artifact、启动超时或 flaky 而更新；
- 没有先保存红证据、原始输出、输入、机器负载和失败分类；
- 新 baseline 没有 exact SHA、运行参数、环境、owner 和 reviewer；
- 用静态 mockup、fixture、模拟 profile、旧 packaged binary、默认 `SKIP` 或按钮点击替代真实证据；
- 视觉样张尚未通过 image2 和用户确认；
- coverage 不是 raw V8，或 changed production scope 不是 statements/branches 100%；
- baseline 变更会隐藏一个尚未解释的功能回归、真实 provider 失败、持久化丢失、重启重放或平台差异。

### 9.2 必须停线并标记 blocked / waiting 的情况

- 需要 API key、真实素材、付费额度、第二台可访问设备、签名 packaged artifact 或用户独有决策；
- canonical production entry、project/session/revision、receipt owner 或 artifact 归属无法确认；
- 视觉方向有冲突或旧样张已被否定；
- CI contract 失败、红绿命令无法复跑、positive control 不失败，或测试只能依赖 catch/skip/扩大 timeout；
- 合流后 exact SHA、PR head、merge SHA、tree 或运行 artifact 对不上。

停线不是失败隐藏：报告必须保留已完成的 `mock`/`simulated` 低层证据、阻塞原因、替代命令和下一步 owner。只有真实任务、H/B/E/T/N、边界 mock、持久化/重启、视觉和适用的 raw V8 scope 全部闭合，才可将该 `featureId` 写成“已合入且已证明”。

## 10. 本契约的范围声明

本文件建立的是后续工作的共同验收格式。它不更新任何产品 baseline，不替代 `docs/qa/2026-09-04-main-convergence-inventory.md`、`docs/qa/2026-09-04-test-coverage-gap-audit.md` 或主收敛计划的当前状态，也不把其中的历史/局部/阻塞证据升级为完成。每一项能力仍需在自己的独立分支和 PR 中按本契约留下可复核收据；本仓库目前没有因此文件而获得“全仓库 100%”结论。
