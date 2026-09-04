# Nomi 收敛总执行方案 Implementation Plan

**状态：**🚧 进行中；本文是 current-main 的执行总纲，不代表 M0–M5 已全部毕业。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以当前 `origin/main` 为唯一产品基线，以 M0–M5 为主轴，把 Nomi 的 Agent、MCP、分镜表、画布、视频拆解、TikHub、真实 Provider、持久化/重启和打包证据收敛成可执行、可回滚、可复核的交付序列。

**Architecture:** M0–M5 不是“已经完成的六个标签”，而是从架构基线、Host 生命周期、语义 effect、上下文投影、信任/溯源到打包毕业的连续证据链。每个阶段都必须沿同一条 `red → implementation → green → real user task → visual walkthrough → merge` 链闭环；Agent/MCP/UI 是投影或传输面，主进程 owner、项目文件、receipt、revision 和重启读回才是副作用真相。

**Tech Stack:** Electron + React/TypeScript + MCP stdio/tool catalog/semantic manifest + Project Agent Host + React Flow canvas + `.nomi` project persistence + Vitest/node tests + Playwright/Electron journeys + packaged smoke + computed-style design conformance + image2 design confirmation gate。

**Spec:** 本方案依据 `docs/qa/2026-09-04-real-user-test-contract.md`、`docs/qa/2026-09-04-epics-rebaseline-audit.md`、`docs/qa/2026-09-04-mcp-rebaseline-audit.md`、`docs/design/2026-09-01-agent-ui-final-redesign.md` 和已合入 PR 的实际差异；本方案只描述执行，不把历史 PR 标题、静态 mockup、fixture、loopback 或 skipped check 当作完成证据。

### Current baseline freshness (2026-09-05)

本次刷新先执行 `git fetch origin main`；随后 `git rev-parse origin/main` 得到精确 SHA `163bddf157b613bde1d8291098b8813cea2bc80b`，且本工作树 clean。该 SHA 是本方案当前唯一 baseline，已包含 #471 的 computable Agent UI design contract、已合入的 #474 Skill menu 修复、#475 的 convergence baseline refresh、#478、#479、#480 和 #481 的主线变更。#471 证明的是设计规则、来源定位、运行时 DOM/样式测量和 mismatch 报告可计算；#474 证明 Skill visibility 修复已进入主线；#475 只更新收敛基线文档；#481 只吸收结构债务拆分边界；这些都不等于 M0–M5 任一阶段毕业。

文中较早的 PR merge SHA、测试结果和状态是写作时的 `snapshot`：它们只用于追溯当时的证据，不持续更新，也不能覆盖本节的 current baseline。`implemented`/`tested`/`live-certified`/`blocked` 仍按本方案的证据门分别判断；远端 PR 的标题、按钮点击或 CI 绿灯不能单独升级阶段状态。

## Global Constraints

1. 当前基线固定为本次刷新确认的 `origin/main@163bddf157b613bde1d8291098b8813cea2bc80b`，即已包含 #468、#469、#470、#471、#474、#475、#478、#479、#480 和 #481；每个后续 PR 开工前必须重新 fetch `origin/main` 并记录完整 SHA。#471 的 UI 设计合同、#474 的 Skill menu 修复、#475 的基线文档刷新、#478、#479、#480 和 #481 的主线变更已合入，但都不构成 M0–M5 完成证据。
2. 本文是总方案，不授权一次性大合并。每个 featureId 必须拆成边界清楚的新 PR；实现、测试、批量修改和长代码阅读由执行 agent 负责，编排者只做拆解、分发和验收。
3. 每一个阶段都必须先写会失败的生产形状断言，再实现最小改动，再用同一输入、同一命令、同一断言 ID 重跑为绿；如果当前基线已绿，登记为 `absorbed/duplicate`，不得人为制造红灯。
4. 每个阶段强制覆盖 Happy、Boundary、Error、Timeout、Network 五类场景。无网络依赖的功能也要证明 Network 场景不发起外部请求。
5. mock 只允许位于 provider、APIMart、TikHub、同步客户端、图像生成器和模型运行时的 adapter/transport 边界。内部 resolver、store、UI、MCP handler 不得用假 mock 证明真实 effect。
6. 真实 Electron、packaged app、持久化/重启和视觉走查是独立门槛；unit、integration、fixture、静态截图、旧二进制、按钮点击、`SKIP` 和 CI green 都不能替代它们。
7. 所有写能力必须核对：实际项目/owner store effect、project revision、proposal/approval/deny、receipt、字段保留、撤销/回滚、关闭后重启读回和幂等。没有 effect 的能力要明确写 `不适用`，不能留空。
8. UI 设计以已合入 PR 设计稿和 design contract 为权威。Beautiful UI 与 AI Elements 只作为已记录的 pattern/structure/behavior 来源；不引入它们的运行时依赖、不建立第二套 tokens 或视觉基础设施。
9. 未经用户确认的新视觉方向不得进入实现。需要重新设计时执行 `Prompt Brief → image2/image_gen → 用户核对 → visual direction/design contract → 红测 → 实现 → 绿测 → Electron/packaged 视觉走查`；已被用户否定的 #454 锚行/参数条样张不得复用。
10. 真实 Provider、TikHub、APIMart、付费模型、第二台物理设备和外部同步客户端只使用环境变量/系统凭据注入；任何 key、token、URL 中的敏感查询参数都不得写入日志、文档、截图、receipt 或 Git。用户已授权本轮 live canary，但授权不等于当前环境已经通过 provider/sample/preflight。
11. 不能通过扩大 timeout、放宽 selector、改名、换 fixture、增加 `|| true`、`--passWithNoTests`、覆盖率排除或静默 catch 把红灯变绿。失败必须分类为 `blocked`、`needs-decision`、`environment`、`product` 或 `test-infrastructure`。
12. Git 收敛遵守：先保护 dirty worktree，比较 patch-id 和文件清单，再建立 task branch；只提交 scoped 文件，普通 PR 不自动 merge。只有所有 required checks、证据包和 review 门通过，且用户明确要求合入时，才合并到 main。

---

## 1. 先看结论：摘要与待办分开

### 1.1 当前已经确认的摘要（不是全部完成宣称）

| 项目 | 当前事实 | 证据状态 |
|---|---|---|
| #468 real-user journey gates | 已合入，merge `3e997f2547d019b6ed6021f917074927e08cbf36`；新增真实用户任务契约、provider preflight、Electron/UI boundary harness 和 blocked-live 规则 | `implemented / tested`；当前只证明门和阻断诚实，不证明 live provider 成功 |
| #469 M0/M1 matrix evidence | 已合入，merge `15fdc9b8fd9af118f699f1408d54470fc4b7c4ff`；补 M0/M1 矩阵、文档/画布 approval、undo/disk rollback、stopped terminal、独立 session、cold restart 证据 | `implemented / tested`；M1 全量 Host、M3/M4 全量仍未毕业 |
| #470 long-video real-user contract | 已合入，merge `8891666960abb168e07b3fce440524f872fa1e4c`；真实长视频任务 manifest、H/B/E/T/N、provider check、Electron harness 和 live canary profile | `implemented / tested / blocked-live`；真实 canary 在 Skill menu 暴露前即被阻塞，未发生外部 API 请求；不能写成 provider 成功 |
| #471 computable Agent UI design contract | 已合入；其 merge commit 已包含于 current baseline `163bddf157b613bde1d8291098b8813cea2bc80b`；将 approved design source、selector/state/severity/tolerance、DOM/computed-style measurement 和 mismatch report 变成可计算合同 | `implemented / tested`（横切设计合同）；不等于 M0–M5 任一阶段毕业，packaged/真实 Host/provider 证据仍缺 |
| #473 storyboard planner Skill menu fix | 仍 open；与已合入的 #474 是同一 Skill menu 修复方向的重复 PR。其产品修复/真实 Electron menu walk 证据不能作为主线实现；Contracts gate 因缺少对应 root-cause contract 阻塞 | `duplicate / blocked`；不作为主线实现，未合入、无 live provider 请求 |
| #474 storyboard planner Skill menu fix | 已合入 main，merge commit `8ff53610900accad9a319f2720ec9e887712a9ff`；将 canonical `selectableInWorkbench`/共享 Workbench visibility boundary 的修复带入 current baseline | `implemented / tested`（Skill visibility 修复）；不等于 M0–M5 任一阶段毕业，真实 provider/package/全链证据仍缺 |
| #476 canvas.write durable receipt slice | 当前 open；本轮在 baseline `163bddf157b613bde1d8291098b8813cea2bc80b` 上已完成 P1 red→implementation→green：canonical `patch_shots` receipt、RPC/stdio request identity 和 renderer recovery lifecycle 已补齐；不宣称 M0–M5 完成 | `implemented / tested / headless-persistence-certified`；本轮 P1 focused 已绿，delivery/full CI 待完成；GUI-open renderer、packaged launcher、完整 canvas operations 不在本阶段完成证据内 |
| #481 structural shell-debt migration | 已合入 main，merge commit `163bddf157b613bde1d8291098b8813cea2bc80b`；只吸收 `verifiedCapabilityInvocation` 的 public facade/runtime/renderer/session 拆分、`mcpGenerationToolCatalog` 提取、`productionRunProjections` 提取及其 structural root-cause contract，边界是结构债务收敛，不新增 MCP 产品行为 | `implemented / tested`（结构拆分）；不等于 M0–M5 任一阶段毕业，不替代 #476 的 receipt/RPC/GUI 证据 |
| M0 文档基线 | owner map、tool mapping、legacy paths、PR slices 和 M-line rulings 已在 main | `implemented / tested`（架构文档）；不是产品 Happy path |
| M1 Host | Host lifecycle/settlement/projection 基础代码和 unit slices 已合入 | `implemented / tested`（局部）；真实 Host 默认关闭，完整 remediation/重启仍 `blocked` |
| M2 semantic surfaces | generation、editing、canvas/document 的语义切片和部分 MCP L2 已合入 | `implemented / tested`（局部/待 current-main 重跑）；全链 effect/receipt/restart 未证明 |
| M3 context/skills | 七层 context、prompt pipe、skill store/resources/prompts 代码和局部测试已合入 | `implemented / tested`（局部）；真实 Host projection/reload/restart `blocked` |
| M4 trust/taint | provenance、taint、action guard 和 signed/unsigned 边界代码已合入 | `implemented / tested`（局部）；真实 Host taint→approval→spend 与视觉 badge 未证明 |
| M5 packaged | packaged MCP 基础 smoke/签名客户端边界和 integration draft 有历史证据 | `implemented / tested`（历史/局部）；当前 SHA 的 M0–M5 packaged graduation 未完成，不能写 `live-certified` |
| TikHub | connector、route、safeStorage、verify-before-persist 和错误分类已合入 | `implemented / tested`（mock/错误边界）；真实 key、quota、packaged、重启仍 `blocked` |
| 视频拆解 | engine、panel、mock render 和长视频任务 harness 已合入 | `implemented / tested`（fixture/控制流）；真实 APIMart、durable result、Agent handoff、重启仍 `blocked` |
| 画布性能 | React Flow 单内核及 S1–S4/S6 hygiene 代码已合入；性能工具存在 | `implemented / tested`（局部/历史）；S5 artifact 与 click-select truth 需 current-main 重证 |

### 1.2 必须继续推进的待办

1. 先把当前 main 的证据重新分层，不把 #468/#469/#470 的“测试台已存在”升级成 Agent/MCP/Provider 已完成。
2. 按 M0→M5 逐阶段闭合 `context → tool → proposal/approval → effect → receipt → projection → persistence → restart`。
3. 以 `MCP_TOOL_RESOLVER.list()` 的当前目录建立 24 项工具 coverage ledger；逐项验证真实 effect，而不是只数 `tools/list`。
4. 用 canonical `nomi_canvas_plan` + `operation=patch_shots` 重建新版分镜表右侧 Agent 链；覆盖选择、未点名字段保持、preview、approve/deny、receipt、落盘和重启。
5. 用计算样式和 DOM 几何把 PR #315/#438/#445 的 Agent 设计转成机器可判定 contract；所有不一致都输出 expected/actual/delta，再修真实组件。
6. current main 重新跑画布 S5/S6、TikHub、视频拆解、packaged M5 和真实用户任务；真实 Provider 有 key 也必须先过 provider/sample/预算 preflight。
7. 清理工作树和 PR 队列只做可验证的收敛：不丢 dirty worktree，不整体合入冲突/旧基线 PR，不重复实现已被 main 吸收的功能。

---

## 2. 当前基线、设计真源和收敛规则

### 2.1 基线事实

开工命令：

```bash
git fetch origin main
git rev-parse origin/main
git merge-base --is-ancestor 163bddf157b613bde1d8291098b8813cea2bc80b origin/main
git status --short --branch
git worktree list --porcelain
```

本次结果：`origin/main` 精确为 `163bddf157b613bde1d8291098b8813cea2bc80b`，已包含 #479、#480 和 #481 merge commit；`git status --short --branch` 无 dirty 文件。任何执行分支都必须记录完整 SHA、dirty 状态、基于哪个 commit 和实际改动文件。历史基线快照不能替代这条 current-main 记录。

### 2.2 设计真源与来源边界

| 设计层 | 权威来源 | 执行规则 |
|---|---|---|
| Agent v3.2 结构/状态 | `docs/design/2026-09-01-agent-ui-final-redesign.md`、`docs/design/2026-09-01-agent-ui-redesign-decisions.md`、`docs/design/2026-09-02-agent-ui-v3-walkthrough.md` | 用真实 shell、状态、字段和用户任务冻结 contract；不从抽象“AI 面板”脑补布局 |
| 异常态 | `docs/design/2026-09-03-agent-ui-p0-exception-states-walkthrough.md`、对应 mockup contracts | 解决 contract 与实现 selector/文案冲突后再实现；异常态必须单独走查 |
| 机器规范 | `docs/design/agent-ui-spec.generated.json`、`scripts/extract-design-spec.mjs`、`tests/ux/agent-ui-conformance.walk.mjs` | 保留 generated spec 作为可追溯输入，补 source locator、adaptation rule、runtime measurement 和 delta 报告 |
| 设计流程 | `docs/design/page-design-process.md`、`docs/design/nomi-design-flow-howto.md`、`docs/design/nomi-design-flow-image2-gate.md` | 已有 PR 设计稿优先；只有方向被否定或未冻结时才走新的 Prompt Brief/image2 用户确认 |
| Beautiful UI | PR #315 设计来源表；Thinking、Loading、Tool Chips、Streaming Text、Task Rows、Approval Card、Prompt Bar | 复用交互 pattern/结构/行为算法，改成 Nomi tokens、Tabler icons 和 Nomi state owner |
| AI Elements | PR #315 设计来源表；Context、Checkpoint、Message、Artifact、Queue | 只借鉴结构和行为；不引入 AI Elements runtime，不复制第二套视觉系统 |
| Nomi 独有 | AgentPlanCard、proposal receipt/undo、SpendConfirm、ReconcileDeviation、shot/canvas/timeline | Nomi 自有语义优先，必须绑定真实 owner store、receipt、revision 和恢复状态 |
| 被否定方向 | PR #454 锚行/参数条样张和相关旧视觉 | 只作为审计证据，不得直接实现或当作视觉验收基线 |

### 2.3 现有 PR/worktree 的处理

现有 PR/worktree 只作为候选 patch、依赖或审计材料，不能因为“有 PR”就计为完成；已合入 PR 也只计入其实际边界：

- #471：已合入 current `origin/main`；其 computable UI design contract 是横切合同，不把 M0–M5 或真实 provider/package 证据升级为完成。
- #473：与已合入 #474 是重复修复方向；其 Contracts gate 因缺 root-cause contract 阻塞，标记 `duplicate / blocked`，不作为主线实现，也不能把其 head 状态或独立验证写成 current-main 事实。
- #474：已合入 current `origin/main`，merge commit 为 `8ff53610900accad9a319f2720ec9e887712a9ff`；只吸收 Skill menu visibility 修复边界，不吸收 M0–M5 毕业、真实 provider 或 packaged 证据。
- #481：已合入 current `origin/main`，merge commit 为 `163bddf157b613bde1d8291098b8813cea2bc80b`；只吸收 `verifiedCapabilityInvocation`、MCP generation catalog 与 production projection 的结构拆分和 structural contract，不把结构债务收敛写成新的产品能力或 M0–M5 毕业证据。
- #466/#452：先做 receipt/Host 差异审计；若功能与 #469/#468 重叠，合并唯一 owner 后再拆小 PR。
- #454：保留已完成的分镜功能事实和模型身份修复线索；整体不作为 Agent epic 完成，不复制被否定的样张。
- #456/#459/#458/#435/#419/#412/#403/#399/#384：按当前 main 重算冲突、required checks 和用户价值；失败、旧 base、stacked 或仅诊断文档不直接合入。
- #328/#313：用户另有会话在处理，先只读比较 owner、文件和 merge 状态；不要从 dirty worktree 抢改动，也不要把模拟双 profile 当真实跨设备证据。
- 未有 PR 的候选 branch（如 canvas click-select、MCP remaining holes）必须先做 patch-id/file compare 和 current-main red test，再决定是否新建 PR。

每次收敛记录：PR/branch、base SHA、head SHA、是否 clean、文件清单、patch-id 重叠、测试结果、未纳入的 dirty 文件及保留理由。

---

## 3. 统一证据系统：所有阶段使用同一条流水线

### 3.1 六道硬门

每个 `featureId`、每个 M 阶段和每个跨域能力都按以下顺序执行：

1. **定义真实用户任务**：写清用户、入口、输入、预期可观察结果、实际副作用和可继续编辑的下一步。
2. **红测**：在当前 main 或修复前分支，以生产调用形状让同一断言失败；记录原始输出、错误分类和 baseline SHA。
3. **最小实现**：只修改该 featureId 的 owner 文件；不要顺手重构无关 shell 或改写断言。
4. **绿测**：同一命令、同一输入、同一断言 ID 通过；附 unit/integration/raw V8 changed-scope 收据。
5. **真实用户任务**：在真实 Electron 入口完成操作，不注入 Zustand/store，不把“按钮点击”当成功；写操作后读实际文件/owner store。
6. **视觉走查与合入**：固定 viewport/DPR，截取 normal/collapsed/loading/failure/approval/tainted/queue 等相关状态，先机器测量，再人工对照获批设计；所有 required checks 通过后才允许合入。

### 3.2 H/B/E/T/N 最低矩阵

| 类别 | 必须证明 |
|---|---|
| Happy | 标准输入完成用户目标，真实 effect、receipt、projection 和下一步入口存在 |
| Boundary | 空/极值/长文本/Unicode/多选/旧 revision/重复 operation/最小窗口/大视频等边界稳定 |
| Error | malformed args、未知工具、权限、schema、模型、供应商、媒体或凭据错误可见且不假成功 |
| Timeout | 启动、模型、provider、下载、审批、重启或 sync 超时能取消/恢复，不重复收费或写入 |
| Network | offline、DNS、401、403、404、429、5xx、非 JSON、断连可分类；无网络功能证明请求数为 0 |

### 3.3 统一 receipt 字段

每一份收据至少包含：`featureId`、`stage`、`baselineSha`、`headSha`、`taskId`、`userTask`、`inputFingerprint`、`assertionIds`、`red`、`green`、`environment`、`providerState`、`model/skill identity`、`projectId`（脱敏）、`revisionBefore/After`、`operationId`、`receiptId`、`effectPath`、`restartReadback`、`visualArtifact`、`coverage`、`decision`、`blockedReason`。真实 provider 额外记录 provider/model、请求 ID、调用次数、usage/cost；不记录 key。

### 3.4 覆盖率门

对 changed production scope 读取 raw V8 的 `statementMap`/`branchMap`，记录 changed span、分母、未覆盖条件。目标是 scoped statements/branches 100%；未达到时只能 `blocked`，不能用排除、快照或仓库总百分比掩盖。跨能力覆盖要按“工具/状态/副作用”聚合，不能按测试文件数、工具数量或 CI 绿灯聚合。

---

## 4. M0–M5 主轴执行方案

### M0 — 架构基线、owner、工具面和偏离契约

**目标与用户价值**：冻结“谁拥有状态、谁允许写入、哪些旧路径退役”的唯一事实，使 Agent 在重复、重启、错误或跨 session 时显示真实 `deviated/recoverable`，不把不一致状态伪装为成功。

**现有代码/PR/证据**：

- `docs/architecture/agent-m0-owner-map.md`、`agent-m0-tool-mapping.md`、`agent-m0-legacy-paths.md`、`agent-m0-pr-slices.md` 和 `agent-m-line-rulings.md` 已合入。
- #272/#275 提供文档基线；#469 把 M0/M1 矩阵和部分 runtime evidence 合入。
- `docs/qa/2026-09-01-agent-m0-red-lights.md` 记录过偏离红灯；旧 `hostLifecycle.test.ts` 转发 shell 不能证明生产 `deviated`。

**证据状态**：`implemented`（架构文档）；`tested`（映射/静态/局部契约）；`live-certified` 不适用；M0 的真实状态 owner/重启契约 `blocked`，不能把“文档完成”写成 Agent 完成。

**缺口**：恢复真实 deviated/settled contract；safe parse、未知 command、错 project/session、重复 operation、重启后的 history 边界；明确 M0 不调用 provider。

**红测 → 实现 → 绿测 → 真实用户任务 → 视觉走查 → 合入门槛**：

- [ ] 红测：对合法 session/command、空历史、重复 command、malformed state、未知 command、错 project/session、超时状态分别断言当前状态不满足唯一 owner/settlement 不变量；provider spy 必须为 0。
- [ ] 实现：只在 M0 state owner、safe parser、history/receipt contract 补最小生产逻辑；不扩展 M1 Host 或付费 provider。
- [ ] 绿测：同一 M0 断言通过，覆盖 reducer/parse/receipt 的 scoped branch 100%，并证明不产生 provider 请求。
- [ ] 真实用户任务：在隔离项目中执行“发起一次可恢复操作→制造中断/重启→看到偏离→恢复→继续”，从 Host/项目文件读回相同 operation/receipt。
- [ ] 视觉走查：只检查现有 deviated/recoverable 状态文案和层级；若需要新 badge/布局，先走 image2 确认门。
- [ ] 合入：M0 contract PR 只含 owner、contract、测试和证据；required checks 全绿、红绿收据同断言、重启读回通过后才合入。

### M1 — Agent Host 生命周期、结算、队列和恢复

**目标与用户价值**：用户让 Agent 做一件事时，Host 能正确开始、等待确认、执行、取消、结算和恢复；不会出现重复执行、孤儿任务、隐性 retry 或“有卡片但没有 effect”。

**现有代码/PR/证据**：

- #301 的 Host 基础、lifecycle/settlement/projection 和 legacy preservation 已合入；#469 提供 document/canvas approval、undo/disk rollback、stopped terminal、独立 thread、cold restart 的 M1 证据入口。
- #452 仍是 open 的 usage/receipt follow-up，不能整体当作完成；先比较 `projectRevision` 防漂移和 `execution_settled` 是否重复。
- 参考 `docs/plan/2026-09-03-m1-contract-coverage-gap-remediation.md`、`docs/plan/2026-09-01-m1-round2-host-runtime.md`。

**证据状态**：`implemented`（Host 基础）；`tested`（unit/局部 Electron）；`live-certified` `blocked`（真实 Host 默认关闭，未证明 provider）；M1 全量 `partial`。

**缺口**：rc-01 history、rc-02 alias deletion、rc-05 safeParse/sensitive fields、rc-06 generic settlement；queue 与 full TurnDraft；取消、审批超时、网络失败、重启后的唯一 operation；真实 Host flag 下的 UI projection。

**红测 → 实现 → 绿测 → 真实用户任务 → 视觉走查 → 合入门槛**：

- [ ] 红测：合法 command、stale lease/revision、重复 operationId、关闭窗口、双 session、未知 tool/malformed args、approval timeout、cancel、provider 401/429/5xx 均先失败或进入正确 blocked/deviated 状态；断言 provider 不重复调用。
- [ ] 实现：由唯一 Host/lease/receipt owner 收口 command→proposal→approval/deny→effect→settlement；不复制 #452 的 usage ledger，不打开隐藏 fallback。
- [ ] 绿测：重跑原红测；验证 Host/repository/project file 三处 settlement 一致，敏感字段不落盘，operation 幂等，changed scope statements/branches 100%。
- [ ] 真实用户任务：新建隔离项目，用户提交长任务，批准一次、拒绝一次、取消一次，关闭并重启后继续或安全终止；Agent、文件和 receipt 三面一致。
- [ ] 视觉走查：Agent header、message/tool row、queue、approval、error、receipt、recovery 与 PR #315/#438 contract 逐项测量；不使用 #454 rejected anchor rail。
- [ ] 合入：M1 PR 与 M4 trust、M5 package、paid canary 分开；真实 Host flag、持久化/重启、取消/失败回滚和视觉验收全部有收据。

### M2 — 语义 MCP/effect 链、分镜表和真实写入

**目标与用户价值**：自然语言或 MCP 语义调用真正修改目标文档、canvas、timeline、generation plan 或新版分镜表，并留下唯一 receipt、revision、可撤销结果和可继续编辑入口。

**现有代码/PR/证据**：

- #318、#337、#360、#382 等 semantic slices 已合入；#381/#387/#426/#442/#448 的 MCP surface、L2/elicitation/退休名工作已部分合入。
- 新版分镜表 V5 A/B 段已合入（#330/#368 等）；C/D、Agent canonical patch、result-slot、approval 和重启仍需重基线。
- #454 有分镜三栏骨架、选择/引用解耦、`patch_shots` 方向和模型 vendor 修复，但整体不等于完成；旧 `patch_shots`/preview probe 不能证明生产 canonical path。

**证据状态**：`implemented`（语义切片/表格基础）；`tested`（unit、schema、部分 fixture/L2）；`live-certified` `blocked`（完整真实 effect/Provider 未证明）；整体 `partial / needs-rebaseline`。

**缺口**：24 项 MCP 真实 effect ledger；canonical `nomi_canvas_plan` + `operation=patch_shots`；selection injection、未点名字段保持、invalid revision/model/vendor、preview/approve/deny、receipt、落盘、重启、undo 和 Agent/table/canvas 一致性。

**2026-09-05 slice evidence（仅 headless canvas.write）**：`nomi_canvas_edit` 已补一条真实 stdio effect 链：catalog resolver → verified project lease → shared main-process receipt prepare → dispatcher → disk gateway → committed receipt；新 receipt service 可在同一项目目录重启后读回。红测先证明基线真实写入无 receipt，绿测覆盖重复 requestId、最大 payload 成功、空 payload schema、失效 lease、磁盘缺失和取消前不得晚写。对应单测为 `electron/capabilityCore/mcpStdioCanvasWriteReceipt.test.ts`；构建后真实用户任务契约入口为 `tests/ux/mcp-canvas-write-durable-receipt.e2e.mjs`，本轮 fresh build 后已通过 9 assertions，证据状态为 `implemented / tested / headless-persistence-certified`。GUI-open renderer、packaged launcher 的实际运行、视觉 walkthrough 和其余 canvas operations 的全链仍为 `blocked / not this PR`，不能将本 slice 升格为 M2 graduated。

**2026-09-05 #476 P1 follow-up evidence（基于 `163bddf157b613bde1d8291098b8813cea2bc80b`）**：新红测先走真实 RPC/stdio receipt 边界，未 mock dispatcher/store：`rpcServer.test.ts` 暴露 canonical `patch_shots` 未落 receipt、随机 approval identity 和 document replay 二次 renderer effect；`mcpStdioDocumentReceipt.test.ts` 暴露 direct document request identity/cancellation 未穿透；`proposalUndoReceiptLifecycle.test.ts` 暴露 `effect_unknown`/`partial`/`commit_failed` hydration 被拒。首次 red 命令为 `pnpm exec vitest run electron/capabilityCore/rpcServer.test.ts electron/capabilityCore/mcpStdioDocumentReceipt.test.ts src/workbench/generationCanvas/agent/proposalUndoReceiptLifecycle.test.ts --reporter=verbose`，结果 `6 failed, 31 passed`。最小生产修复后，同一边界扩展命令 `pnpm exec vitest run electron/capabilityCore/mcpDocumentWriteReceipt.test.ts electron/capabilityCore/mcpStdioCanvasWriteReceipt.test.ts electron/capabilityCore/mcpStdioDocumentReceipt.test.ts electron/capabilityCore/rpcServer.test.ts electron/capabilityCore/mcpProtocol.test.ts electron/capabilityCore/mcpLoopbackRpcRequest.test.ts src/workbench/generationCanvas/agent/proposalUndoReceiptLifecycle.test.ts --reporter=dot` 结果 `7 files, 61 passed`：canonical receipt/requestId/replay-conflict/late-disconnect、document RPC/stdio identity+cancel、三种 recovery lifecycle hydration 均 green；没有放宽断言或 gate。用户任务入口仍使用自然表达“我想做一个完整短片”，canonical tool/id 仅作为技术链断言，不作为用户话术。本轮状态为 `P1 green / awaiting delivery and remote required checks`，不创建 follow-up、不开合并；真实 Electron/packaged/视觉证据仍为 `blocked / not this PR`。

**红测 → 实现 → 绿测 → 真实用户任务 → 视觉走查 → 合入门槛**：

- [ ] 红测：在当前 main 用生产 manifest/catalog shape 对 document/canvas/timeline/generation/storyboard 各取代表性写操作，先断言当前 canonical 调用链无法完成 effect 或缺 receipt；另测 stale revision、wrong project、empty selection、旧 alias、重复 operation。
- [ ] 实现：按工具/能力唯一 owner 补 resolver→lease→proposal→approval→adapter→revision→receipt→persistence；新版分镜表只接受 canonical `nomi_canvas_plan` 的 `patch_shots` operation。
- [ ] 绿测：同一 payload 通过；从真实项目文件/owner store 读取 effect，比较 revision/receipt，确认未点名字段和未选行未变；mock provider 仅证明控制流。
- [ ] 真实用户任务：用户打开新版分镜表，选择一行，让右侧 Agent 修改 prompt/镜头语言/时长中的一项，预览→批准；再拒绝另一项；切到 canvas/preview，关闭重启后读回 table/canvas/receipt 并可继续编辑。
- [ ] 视觉走查：按 approved PR design 测量右侧 Agent、分镜表、result slot、tool row、approval card、queue 和异常态；设计方向若仍需改，先 Prompt Brief→image2→用户确认。
- [ ] 合入：至少一条 document、一条 canvas、一条 storyboard、一条 timeline/generation 代表性 effect 具备真实 receipt/重启证据；不能用 24 项目录数替代。

### M3 — 七层上下文、Skill 加载、模型切换和持续理解

**目标与用户价值**：Agent 真实理解当前项目、选择、文档/画布状态、权限、工具能力、Skill 和模型身份；用户切换 Skill/模型或重启后，不需要重新解释，也不会把旧项目/旧 revision 当当前事实。

**现有代码/PR/证据**：

- #372/#374/#376 已合入 context factory、prompt pipe、skill event 等代码；MCP resources/prompts 的 stdio 集成有局部证据。
- #470 的真实长视频用户任务在旧 baseline 明确记录：当时可见 Agent Skill 菜单没有 `workbench.storyboard.planner`，所以在 `load-skill` 阶段 `blocked-live`，未发生外部 API 请求。#474 已将 Skill visibility 修复合入 current main，但不回写或升级这条历史 canary 证据，也不代表后续真实 provider canary 已通过。
- `skillStore.ts`、`skillIndex.ts`、`nomiSkillResources.mts`、`mcp-skills-integration.e2e.mjs` 是主要验证入口；需确保 UI/Pi/MCP/Host 使用同一 roots/hash。

**证据状态**：`implemented`（context/skill slices）；`tested`（unit/stdio read/局部 smoke）；`live-certified` `blocked`（真实 Host 七层投影、Skill visible load、模型切换和重启 continuation 未证明）。

**缺口**：Skill 目录→正文→证据三层载入、hash mismatch/reload、模型/vendor identity 与 capability 对账、Host projection、project switch、permission reduction、context overflow、provider stale cache、restart continuation。

**红测 → 实现 → 绿测 → 真实用户任务 → 视觉走查 → 合入门槛**：

- [ ] 红测：真实 Agent/MCP/Host 入口尝试加载一个可见 Skill、一个不存在/旧 hash Skill，切换模型/vendor，切换项目和权限；当前至少保留 `skill_not_exposed_in_current_agent_menu` 这一真实红证据。
- [ ] 实现：修复统一 skill roots/index/visibility/reload 和 model identity 投影；不得在 UI、MCP、Pi、Host 各造一份 skill store。
- [ ] 绿测：同一任务读回 context hash、skill hash、model/vendor、project/session/selection；失效时结构化 blocked，不静默复用旧正文。
- [ ] 真实用户任务：导入真实长视频，用户选择 Skill，切换 text-vision 模型，执行拆解/创作任务；中途切换项目、关闭重启，再从同一 context 继续，记录 provider call/usage。
- [ ] 视觉走查：检查“已载入 Skill”事件、模型/供应商身份、context、loading/blocked/reload 状态；严格按 PR #315 的 source/adaptation mapping，不凭新造卡片。
- [ ] 合入：真实 Host enabled 的 context→tool→receipt→projection→restart journey 通过；Skill 不暴露时必须先修可见边界或明确 blocked，不得把 runner 里声明的 Skill 当产品可用。

### M4 — provenance、taint、签名、审批和危险动作

**目标与用户价值**：用户清楚知道来源、revision、可信度、审批和成本范围；未经批准、带污染、过期或来源不明的动作只能预览或被拒绝，不能修改项目、触发付费或伪装为成功。

**现有代码/PR/证据**：

- #405/#407/#408 已合入 provenance/taint/action guard/helper；packaged signed/unsigned rejection 有历史证据。
- `electron/harness/context/provenanceActionGuard.test.ts`、`electron/vendor/provenance.test.ts` 和 M4 root-cause 文档是现有 owner/证据入口。
- 当前 `agentHostEnabled=false`；unsigned write rejection 不等于 taint→spend，也不等于真实 Host approval。

**证据状态**：`implemented`（guard/provenance）；`tested`（unit/unsigned boundary）；`live-certified` `blocked`（真实 Host、可见 taint badge、批准后 scoped spend、重启 receipt 未证明）。

**缺口**：signed/unsigned 与 tainted/approved 的跨层投影；approval receipt scope、cost policy、重复确认、撤回/deny、provider 失败/超时、可见 trust 状态、restart/reconcile 和有限 live spend 边界。

**红测 → 实现 → 绿测 → 真实用户任务 → 视觉走查 → 合入门槛**：

- [ ] 红测：对 unsigned、tainted、expired approval、mock source、旧 revision、wrong project、缺 provenance 和重复 confirmation 逐一断言无 effect/无 provider spend；当前 Host disabled 时记录为边界红，不伪造 Host 成功。
- [ ] 实现：补唯一 provenance/action gate 和 receipt scope；若新增 badge、approval card 或危险动作投影，先完成获批视觉方向。
- [ ] 绿测：同一状态机通过，receipt 包含 source/revision/approval/cost scope/attempt/provider namespace；批准一次只产生一次 effect，拒绝/超时保持无副作用。
- [ ] 真实用户任务：用户从一个带来源的素材/拆解结果发起动作，看到 tainted/needs approval，拒绝一次，批准一次；关闭重启后 receipt 状态和可用动作不漂移。
- [ ] 视觉走查：逐屏核对 trust/taint/approval/blocked/settled/error；机器测量颜色、层级、布局、可读性，人工确认危险动作没有被“成功”样式覆盖。
- [ ] 合入：Host-enabled journey、持久化/重启、拒绝无 effect、批准唯一 effect、scoped V8 100% 和视觉 sign-off 全部通过；未授权 paid canary 只能 `blocked`。

### M5 — 当前 SHA 的 packaged graduation

**目标与用户价值**：用户安装/启动真实新构建的 Nomi.app 后，M0–M4 的关键链路、MCP 客户端边界、Skill/resources、拒绝写入、恢复和真实用户任务在打包态仍一致，不因 dev-only 路径而失真。

**现有代码/PR/证据**：

- #420 packaged MCP 基础已合入；#419/#421/#422 属旧 M5 stacked/open 候选，不能替代当前 main 取证。
- `docs/qa/2026-09-03-m5-graduation-checklist.md` 明确记录 Host 全量、M2 L2、M4 spend 和 current-main fresh package 尚未毕业。
- 入口：`tests/ux/packaged-mcp-smoke.e2e.mjs`、`tests/ux/model-integration-packaged.e2e.mjs`、`pnpm run test:mcp-l2:packaged`、`pnpm run dist:mac:dir`。

**证据状态**：`implemented`（packaged 基础）；`tested`（历史/局部 smoke）；`live-certified` `blocked`（当前 SHA 新包、M0–M5 全链、真实 Host/provider/视觉未闭合）。

**缺口**：当前 SHA 新构建 artifact、签名/安装身份、catalog/manifest/skills roots parity、packaged L2、Host disabled/enabled 边界、M4 spend guard、启动/重启、长任务、截图和失败诊断。

**红测 → 实现 → 绿测 → 真实用户任务 → 视觉走查 → 合入门槛**：

- [ ] 红测：故意使用损坏 package config、unknown tool、unsigned write、invalid sender/args、损坏 receipt、启动/stdio timeout；必须产生可诊断红证据，不被 `SKIP` 隐藏。
- [ ] 实现：只修 packaged launcher/config/asset roots/测试隔离；不把历史二进制或旧 SHA 的通过结果复制到 current baseline。
- [ ] 绿测：从 current HEAD 构建包，核对 checksum/signature/identity，跑 tools/resources/skills、MCP L2、rejection、restart readback 和至少一条零额度 Agent 用户任务。
- [ ] 真实用户任务：安装当前包，新建隔离项目，完成“Skill 加载→模型选择→Agent/MCP 读写→审批/拒绝→生成/拆解可继续→关闭重启回读”；记录所有 provider 请求为 0 或明确 live canary。
- [ ] 视觉走查：packaged app 在 desktop、窄屏、最小窗口和关键异常态逐屏截图；与已批准 design contract 做 DOM/computed-style + 人工走查。
- [ ] 合入：M0–M4 收据引用的 SHA 与 packaged SHA 一致；所有 packaged required checks、持久化/重启、视觉和清洁安装验证通过，才可标 `graduated`。

---

## 5. 跨能力执行线

### 5.1 MCP 全功能 coverage ledger

以 `MCP_TOOL_RESOLVER.list()` 当前目录为工具真相，另列 `modelToolSurfaceManifest`，不把两套名称混算。为每个 tool 建一行机器可读记录，字段为：`toolName`、`canonicalCapability`、`schemaSource`、`resolver`、`owner`、`readOrWrite`、`H/B/E/T/N assertions`、`effectPath`、`receipt`、`persistence`、`restart`、`packaged`、`visual`、`providerState`、`status`。

覆盖顺序：

- [ ] session/project/lease：打开、续接、错项目、过期 lease、MCP stdio 重启。
- [ ] read surface：project、document、canvas、timeline、artifact、run、resources/prompts；读回必须与 UI/文件同一 revision。
- [ ] write surface：asset import、document/canvas/timeline edit、generation plan/status、run start/control、artifact review/materialize、export；每项必须有实际 effect 和 receipt。
- [ ] confirmation/safety：elicitation、approval/deny、cancel、reconcile、unknown/retired tool、unsigned client、tainted source。
- [ ] Skills/model surface：list/read、content hash、reload、model/vendor identity、capability mismatch、packaged roots。
- [ ] fault matrix：bad frame、malformed args、wrong scope、stale revision、timeout、disconnect、401/403/429/5xx、non-JSON；所有失败不可假成功。

最低命令集合：

```bash
pnpm run check:mcp-payload
pnpm run check:mcp-tool-refs
pnpm run test:mcp-elicitation
pnpm run test:mcp-journey
pnpm run test:mcp-l2:packaged
```

当前判断：MCP `implemented / tested`（目录、schema、部分 L1/L2）；整体 `live-certified: blocked`，因为 24 项真实 effect、跨工具 receipt/restart、packaged L2 和付费确认未形成同一份 current-main 收据。

### 5.2 Agent UI、Beautiful UI、AI Elements 的精确实现线

实现前必须建立 `designContract`，至少包含：`sourceLibrary`、`sourceLocator`、`adaptationRule`、`viewport`、`dpr`、DOM hook、component/state、expected bounds、spacing、radius、border、color、typography、order/visibility、ARIA/data attributes 和 allowed delta。

运行时测量必须从真实 Electron DOM 获取：`getBoundingClientRect()`、computed styles、文本实际换行/高度、scroll/overflow、visibility、ARIA/data hooks 和 sibling order。报告格式固定为：

```json
{
  "featureId": "AGENT.UI.<state>",
  "element": "data-agent-<hook>",
  "expected": { "x": 0, "y": 0, "width": 0, "height": 0, "gap": 0 },
  "actual": { "x": 0, "y": 0, "width": 0, "height": 0, "gap": 0 },
  "delta": { "width": 0, "height": 0, "gap": 0 },
  "status": "pass"
}
```

流程：

- [ ] 从 PR #315/#438/#445 的获批设计和 `agent-ui-spec.generated.json` 生成/更新 contract，不从截图猜尺寸。
- [ ] 对 normal、collapsed、loading、failure、approval、queue、artifact、tainted、long-text、narrow viewport 分别定义 expected/actual/delta。
- [ ] 当前基线先运行 contract 让缺失 hook/布局差异红；优先处理固定 result card、storyboard/browser Agent Dock、queue selector/time text、plain user-facing artifact title 等已知差异。
- [ ] 实现只修真实 `WorkbenchShell`、`ProjectAgentResidentShell`、Storyboard workspace 和 Nomi design primitives；不得引入 AI Elements/Beautiful UI runtime。
- [ ] 绿测后在 Electron/package 逐态截图，机器报告无超差，再进行人工视觉走查；“机器通过但人不喜欢”进入 design decision，不得自动视为绿。

### 5.3 新版分镜表与 Agent 右槽

用户任务是“选中某几行→让 Agent 修改指定字段→预览→批准/拒绝→回到表格/画布继续”。必须同时证明：真实 selection、`nomi_canvas_plan`/`patch_shots` canonical tool、未点名字段保持、model/vendor/aspect/duration identity、receipt、undo、重启和右槽投影。旧 `patch_shots` 直调、注入 store、只看一张结果卡都只算 fixture/control-flow。

### 5.4 Canvas 功能与性能

先把 React Flow selection、domain selection、Agent target、视觉高亮统一为一个 truth source，再跑 S5/S6：prod/dev/throttle/L/select、dense edges、blank click、multi-select、collapsed group、drag/connect、media error/retry、large graph。性能通过不能替代交互通过；历史 dirty artifact 或旧 commit 必须重跑。

### 5.5 TikHub connector

现有 connector/route/verify-before-persist/错误分类先以 deterministic 401/403/404/429/5xx/non-JSON/network fixtures 固定。用户已授权 live canary 时，先检查 `TIKHUB_API_KEY`、授权 share URL、预算/次数、真实 route 和 output cap；仅当 authenticated verify 成功后才持久化 key。真实任务为“设置保存→重启回读→导入授权分享链接→AssetSourceEvidence→可继续拆解”。失败必须写 `blocked`，不能把 decryptable key 当 Connected。

### 5.6 视频拆解与长视频真实任务

使用已合入 #470 的 manifest/runner/Provider preflight。真实任务包含：导入仓库 60 秒以上或用户授权的长视频→加载可见 Skill→切换 text-vision 模型→拆解→查看/选择镜头→失败镜头重试→送新版分镜表/画布→Agent 修改→审批→保存→重启回读。每次真实 provider 只做单次、单并发、每镜一帧、无视频生成、无自动重试的最小 canary；记录 provider/model/request ID/usage/cost。#470 的真实 live canary 结论是：在 Skill menu 暴露前即被阻塞，未发生外部 API 请求；因此不能写成 provider 成功。后续审批 selector、durable result/selection/restart 和失败回滚也未证明。

### 5.7 持久化、重启和跨设备

所有本地能力都执行“写入→读取真实项目文件/owner store→关闭→重启→继续/拒绝旧操作”。跨设备另行验证 A 保存关闭→真实同步客户端→B 打开编辑→同步回 A→重启；两个模拟 profile 只能是 `simulated`，不能是 `live-certified`。API key、设备凭据和绝对路径按 ownership 规则不进入项目同步。

### 5.8 Worktree/PR 收敛

每轮先运行 `git worktree list --porcelain`，保护 dirty/ detached/ full clone；对 open PR 获取 base/head/check 状态，比较 patch-id/file overlap，标记 `merge / rework / superseded / blocked / external-owner`。只把确实未吸收的 scoped patch 新建 PR；不整体合入冲突、旧 base、只诊断或用户否定设计的 PR。清理硬盘必须另有精确目标、size、保留理由和可恢复方案，不能和本方案的业务合入混做。

---

## 6. 交付顺序和可执行任务清单

每个任务结束都要产出独立 receipt；checkbox 只表示计划步骤，不表示当前已完成。

### Task 0：基线与账本冻结

**Files:**
- Read: `docs/qa/2026-09-04-main-convergence-inventory.md`, `docs/qa/2026-09-04-epics-rebaseline-audit.md`, `docs/qa/2026-09-04-test-coverage-gap-audit.md`
- Read: all files under `docs/plan/` and `docs/architecture/agent-m0-*`
- Produce: `outputs/qa/<date>/baseline/manifest.json`（不提交共享 outputs）

- [ ] 刷新 `origin/main`，记录 SHA、open PR、worktree、dirty 文件和 merge ancestry。
- [ ] 把每个能力的状态拆成 `implemented/tested/live-certified/blocked`，不能只写一个“完成”。
- [ ] 发现 baseline 已通过的断言登记 `absorbed/duplicate`，发现不可执行的断言登记具体 blocked reason。

### Task 1：M0 red/green contract

**Files:** M0 owner/parser/history/receipt 及其 scoped tests；不得修改 UI、M5 package 或 provider。

- [ ] 先运行 M0 deviated red matrix。
- [ ] 修最小生产 owner。
- [ ] 重跑同一矩阵、raw V8、restart readback 和 zero-provider assertion。
- [ ] 开独立 M0 PR；required checks green 后等待 review。

### Task 2：M1 Host lifecycle

**Files:** Host lifecycle/coordinator/repository/recovery、#452 差异关联测试；不得合并旧 #452 整体。

- [ ] 先形成 approval/deny/cancel/settlement/duplicate/timeout/network 红测。
- [ ] 在受控 Host flag 下实现唯一 operation/receipt。
- [ ] 跑真实 Electron 任务、关闭重启、字段隐私和 scoped coverage。
- [ ] 视觉 contract 覆盖 header/message/queue/approval/error/receipt；必要时先走 image2。

### Task 3：M2 canonical effect + MCP ledger

**Files:** `electron/capabilityCore/`, MCP catalog/manifest/resolver、document/canvas/timeline/generation/storyboard owners、ledger tests。

- [ ] 先逐工具生成 red records，不因目录已有 24 行就跳过 effect。
- [ ] 先交代表性 effect/receipt PR，再交覆盖 ledger/剩余工具小 PR。
- [ ] 每项写能力完成实际 effect、receipt、实际文件和重启回读；失败保留 blocked/error receipt。

### Task 4：M3 context/Skill/model surface

**Files:** context factory/prompt pipe/skill store/index/resources/model identity/UI projection。

- [ ] 保留并标注 #470 的历史 Skill 菜单不可见红证据；在 #474 已合入的 current main 上重新验证可见性，但不把本地修复或按钮可见升级成 live provider 绿证据。
- [ ] 修统一 roots/hash/reload/visibility 和模型切换投影。
- [ ] 用真实长视频任务和重启 continuation 验证；没有 provider 只证明 local context，不升级 live。

### Task 5：M4 trust/taint/approval

**Files:** provenance/action guard/approval receipt/Agent projection；先冻结视觉方向再改新 UI。

- [ ] 先测 unsigned/tainted/expired/mock/wrong revision 无 effect。
- [ ] 再测 approved scoped effect、deny/cancel/timeout、唯一 receipt 和 restart。
- [ ] 最后才在用户明确范围内做单次 paid canary；记录调用次数和费用，未执行写 blocked。

### Task 6：Storyboard canonical path

**Files:** storyboard table/Agent Dock/`nomi_canvas_plan` projection/patch operation/receipt tests。

- [ ] 以用户任务先红后绿，不复制 #454 rejected visual。
- [ ] 证明真实选择、字段保留、preview/approve/deny、undo/restart。
- [ ] 用计算样式 contract 和 Electron 逐态视觉走查验收。

### Task 7：Canvas S5/S6

**Files:** React Flow selection truth、performance harness、current-main artifacts。

- [ ] 在干净 current main 运行 prod/dev/throttle/L/select 和交互边界。
- [ ] 修唯一选择真相及性能回归；不更新 baseline 藏越线。
- [ ] 真实 Electron 完成节点选择→Agent patch→画布/文件回读→重启，附截图和 perf transcript。

### Task 8：TikHub + video live boundary

**Files:** TikHub connector/route/credential/transport、video engine/panel/result persistence/Agent handoff。

- [ ] 先把 fixtures/error matrix 变 deterministic green。
- [ ] 通过 provider/sample/preflight 后，各做一次最小 live canary；真实 key 不写入任何 artifact。
- [ ] 完成长视频、Skill/model switch、单镜 retry、审批、持久化/重启和视觉走查；任意缺口标 blocked。

### Task 9：M5 packaged graduation

**Files:** packaged launcher/config/test harness；从 current HEAD 新构建。

- [ ] 先让损坏配置/unknown tool/unsigned/timeout 红。
- [ ] 跑当前包的 M0–M5、MCP L2、Skill/resources、Host boundary、restart 和 visual。
- [ ] 只有 packaged SHA 与 source receipt 对齐且所有门通过才标 graduated。

### Task 10：总体验收与 PR 合流

**Files:** evidence index/coverage ledger/PR inventory/plan status。

- [ ] 检查所有 M 阶段和跨能力 featureId 的 red/green、真实任务、视觉、持久化、restart、package receipt。
- [ ] 检查没有 open PR/worktree 中遗漏的独有 patch；dirty 文件有保留理由。
- [ ] 对每个未完成项给出唯一 owner、下一个 PR、blocked reason 和复现命令。
- [ ] 只有总证据包和用户认可的视觉/架构决策都齐时，才写“整体完成”；否则写“已合入但未证明/部分完成/blocked”。

---

## 7. 每阶段 PR 合入门槛模板

在 PR 描述中复制并填写以下字段；空值不是通过：

```markdown
featureId:
stage: M0 | M1 | M2 | M3 | M4 | M5 | cross-lane
baseSha:
headSha:
ownerFiles:
redCommand:
redResult:
greenCommand:
greenResult:
happy:
boundary:
error:
timeout:
network:
realUserTask:
effectPath:
receiptPath:
persistence:
restartReadback:
packaged:
visualContract:
visualWalkthrough:
scopedStatements:
scopedBranches:
providerState: zero-request | loopback | live-certified | blocked
skillModelIdentity:
knownLimitations:
decision: merge | rework | blocked
```

不得使用“全部测试通过”“已有页面”“PR 已合并”“截图看起来一样”作为字段替代。每个字段要么有 artifact/command，要么明确 `不适用` 或 `blocked:<reason>`。

## 8. 完成定义、停止条件和不确定项

### 8.1 只有同时满足以下条件，才可以宣称整体完成

- M0–M5 每个阶段都有当前 main SHA 的实现/测试/真实任务/视觉/持久化或明确不适用证据。
- Agent UI 设计 contract 的 expected/actual/delta 全部在允许误差内，且人工视觉走查认可；Beautiful UI/AI Elements 只作为来源映射，无第二运行时。
- MCP 全目录逐工具有 schema/resolver/effect/receipt/persistence/restart/packaged 状态；目录数量本身不算完成。
- 新版分镜表、canvas、视频拆解、TikHub 的真实用户任务能在真实 Electron 中完成或被可解释地阻断；没有把 fixture/loopback 当 live。
- Skill 加载、模型切换、审批/拒绝、异常/回滚、冷启动/重启、长视频和 provider 请求/费用边界都有可审计收据。
- current SHA packaged app 复跑通过，所有 required checks 绿，open PR/worktree 的独有 patch 已处理。

### 8.2 必须停止并记录 blocked/waiting 的情况

- #470 的历史 live canary 曾因 Skill 没有从真实 Agent 菜单暴露而 `blocked-live`，且未发生外部 API 请求；#474 的主线修复不等于该 canary 已重跑或 M3/provider 已毕业。
- provider credential/sample/额度/真实 request ID 不可用；用户已授权不代表能伪造可用环境。
- Host flag、第二台物理设备、真实同步客户端、packaged artifact 或视觉用户确认缺失。
- PR 有冲突/dirty/旧 base，无法确认改动是新功能还是已吸收 patch。
- 生产断言失败但只能通过放宽断言、扩大 timeout、改名、换 mock 或 skip 消除。

### 8.3 当前仍需在执行中确认的事实

1. #452 的 usage/receipt 逻辑与 #469/#468 当前 Host owner 的最终合并边界。
2. 当前 main 的 `agentHostEnabled` 受控开启方式、真实 Host 的安全测试配置和可回滚开关。
3. `workbench.storyboard.planner` 应由哪个 canonical Skill source 暴露，以及 UI/Pi/MCP/Host 四面的 visibility contract。
4. MCP 当前目录的 24 项逐工具 effect 清单与旧别名 retirement 的最终映射。
5. TikHub/APIMart 真实 key 对应的 provider、样本、额度和调用费用；只读检查不能从加密 record 推断可用。
6. S5/S6 当前 main 的 fresh performance baseline、click-select branch 是否已被其他分支吸收。
7. #328/#313 外部会话最终 merge/返工状态；在 owner 返回前不抢改动、不写成完成。

## 9. 来源索引

- 当前主线盘点：[2026-09-04-main-convergence-inventory.md](../qa/2026-09-04-main-convergence-inventory.md)
- Epic 重基线：[2026-09-04-epics-rebaseline-audit.md](../qa/2026-09-04-epics-rebaseline-audit.md)
- MCP 审计：[2026-09-04-mcp-rebaseline-audit.md](../qa/2026-09-04-mcp-rebaseline-audit.md)
- 真实用户测试契约：[2026-09-04-real-user-test-contract.md](../qa/2026-09-04-real-user-test-contract.md)
- 覆盖缺口审计：[2026-09-04-test-coverage-gap-audit.md](../qa/2026-09-04-test-coverage-gap-audit.md)
- 长视频任务：[2026-09-04-real-user-long-video-task.md](../qa/2026-09-04-real-user-long-video-task.md)
- 分镜/Agent 审计：[2026-09-04-pr454-storyboard-agent-audit.md](../qa/2026-09-04-pr454-storyboard-agent-audit.md)
- M0 红灯：[2026-09-01-agent-m0-red-lights.md](../qa/2026-09-01-agent-m0-red-lights.md)
- M5 清单：[2026-09-03-m5-graduation-checklist.md](../qa/2026-09-03-m5-graduation-checklist.md)
- Agent 设计真源：[2026-09-01-agent-ui-final-redesign.md](../design/2026-09-01-agent-ui-final-redesign.md)
- 设计流程：[nomi-design-flow-howto.md](../design/nomi-design-flow-howto.md)、[nomi-design-flow-image2-gate.md](../design/nomi-design-flow-image2-gate.md)
- 旧 open-work-ledger：[2026-09-03-open-work-ledger.md](2026-09-03-open-work-ledger.md)（历史快照，状态以本方案和 current-main 审计为准）
- 旧后续计划：[2026-09-04-main-convergence-follow-ups.md](2026-09-04-main-convergence-follow-ups.md)（被本方案的 current-main 基线和 M0–M5 主轴取代）
