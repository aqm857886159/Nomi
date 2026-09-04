# 2026-09-04 Main 收敛后续计划

**状态：**📋 方案待拍板。

> **For agentic workers:** 本文是计划文档，不是本轮实现授权。任何实现必须先按对应 featureId 建立独立 PR，并遵守本文的红测、真实 Electron、package、持久化重启和视觉验收门禁。

**Goal:** 以 `origin/main@53e3ab7c2f38561760a6b7262c76c098929a7c34`（PR #455 merge `976584c8`、PR #457 merge `53e3ab7c`）为唯一基线，只安排当前主线上仍有用户价值、但尚未完成或尚未被真实证据证明的收敛后续；不重复已合入、已被主线吸收或已关闭的工作。

**Architecture:** 先闭合 Agent Host、MCP 语义工具和 storyboard canonical write 的真实效果链，再闭合 canvas 选择与 S5/S6 证据、跨设备恢复、视频拆解 durable handoff 和 TikHub live 边界；架构三期只在所有权决策后拆成小 PR。生成、provider、同步和视觉设计的外部边界保持可审计、可拒绝、可恢复。

**Tech Stack:** Electron + React/TypeScript + MCP tool catalog/manifest + Agent Host + React Flow/canvas + `.nomi` project persistence + Playwright/Electron journeys + packaged smoke/evidence + image2 design gate。

**Spec:** 每一个 featureId 都必须产生一组可追溯的 `red → green` receipt：同一条断言先在当前 main 或修复前分支失败，再由最小实现使原断言通过；不得改写断言、只补 snapshot、只补 mock、只把测试 skip，或用覆盖率数字代替真实功能证据。

## Global Constraints

1. 本计划只读当前 `origin/main`、审计和 open PR 状态；本轮主动修改仅本文件，不改产品代码、测试或既有主计划，不 add/覆盖共享 `outputs`。普通基线 merge 允许同步 `origin/main` 已有文件（包括其既有索引变更），但不把这些同步内容作为本轮功能实现。
2. 所有 feature 的硬门禁都包含 Happy、Boundary、Error、Timeout、Network 五类红测。每一类都要有明确输入、预期状态/副作用和可定位断言；无网络依赖的功能也必须证明 `Network` 场景不发起外部调用，而不是省略该类。
3. 外部依赖只在 adapter/transport 边界 mock：provider、APIMart、TikHub、同步客户端、图像生成器和模型运行时不得被内部 resolver、store 或 UI 假 mock。mock journey 只能证明控制流/错误策略，不能证明 provider 成功或真实资产效果。
4. `red → green` 必须使用同一断言、同一生产调用形状和同一 featureId。每次 green receipt 同时记录 commit、测试命令、真实副作用、项目文件/receipt 路径和运行环境。
5. 真实 Electron journey 与 packaged journey 是独立门禁；unit/integration 通过、fixture 通过、静态 screenshot、旧 binary、CI skipped 或“按钮被点击”均不等于用户旅程完成。涉及状态的功能必须保存、退出、重启、读回并继续操作。
6. coverage receipt 只能从实际通过的 feature/tool/effect receipt 聚合；`skipped`、`blocked`、`fixture-only`、`old-baseline`、`visual-pending` 不得计为通过，不能伪造 100%。工具覆盖按“工具 → schema/resolver → 实际 effect → receipt → 持久化文件 → restart readback”计数，不按 `tools/list` 数量计数。
7. UI 功能先走 image2：真实 shell、真实用户任务、目标状态和 Prompt Brief → image2 探索 → 用户明确确认 → 冻结 design contract → 红测 → 实组件 → green → Electron/package 截图与视觉走查。用户拒绝的方向标为 `rejected`，不得从旧 mockup 直接实现。
8. live provider、真实第二设备、付费模型、外部同步客户端、发布或不可逆架构迁移均需要用户决策/授权。没有 key、额度、第二设备或可审计环境时只能标 `blocked`，不能以模拟结果代替。
9. 每个后续项目都要有一个新 PR 的清晰边界；已有 open PR 只能作为依赖、owner 或候选 patch，必须先 rebase 到 `53e3ab7c` 并重新核验，不能把旧 PR 整体当作完成证据。

## Baseline、Inventory 与排除项

### 当前基线

| 项目 | 事实 |
| --- | --- |
| `origin/main` | `53e3ab7c2f38561760a6b7262c76c098929a7c34`，PR #455/#457 已合入 |
| 本地共享收敛分支 | `codex/convergence-execution-plan-20260904`，本地已有 merge `ef518d5106172e861a878ad02922149db2c70baa`，其父线包含上述 `origin/main` |
| PR #453 | 仍为当前文档交付 PR；本轮需把本地 merge 和本文件一起推送，不能提交 7 个共享 `outputs` 脏文件 |
| 受保护脏文件 | `outputs/canvas-card-stack-20260827/01-real-version-stacks-light.png` 至 `06-real-project-switch-sidebar-collapsed.png`、`walk-report.json`；只读、不得 `git add`、不得覆盖 |

### 审计到的相关 open PR/branch 状态（2026-09-04 快照）

| PR/branch | 当前状态与 SHA | 本计划中的角色 |
| --- | --- | --- |
| #453 `codex/convergence-execution-plan-20260904` | open；本地基线 merge 为 `ef518d51`，远端旧 head 为 `ecf2ccd45becaf421374bb1804c9cb7b9fd7192a7` | 仅交付本计划和既有计划/审计文档，不引入产品代码/测试 |
| #454 storyboard/Agent | open；head `feb392525b8bbd75205890e8099ba1aff72cbba7`，相对新 main `CONFLICTING/DIRTY` | 只提取未证明的 canonical patch 和 rejected UI 依赖；不整体合入、不复制旧 anchor mockup |
| #452 Agent usage/receipt | open；head `75f8e4148ee6d539d2e54250e3c7bb5b75497f5a`，E2E/Quality 失败 | M1/M4 的 owner/依赖；先修其边界，不复制相同 usage ledger |
| #457 cross-device repair | **MERGED**；merge `53e3ab7c`，head `a58d048d9fe8789656bc80daa1bd58d403f6e396`；Contracts/Unit/Linux E2E/Canvas Acceptance/Mac Package/Quality Gate 均成功 | 主线已吸收代码、测试和 Settings surface；仍缺真实第二设备/真实同步客户端证据，只安排该残余证明，不复制 #457 |
| #435 3D/research workflow | open；head `5f1f5719b7b6c3be4cffeb4ca083b0a8a7df110d`，Contracts/Quality 失败 | TikHub/视频拆解的相关 owner；不将研究 workflow 等同 live provider |
| #419 packaged graduation C | open；head `7b67877af662546f435ec5deea53bf71cff81baa`，以旧 M5 分支为 base，`CONFLICTING/DIRTY` | 只作历史/候选 patch 参考；M5 必须按新 main 重新取证 |
| #328 cross-device continuation | open；head `fee6d56f40890dce7361bb55c9ba1fbd11ba9a05`，E2E/Performance/Quality 失败 | 旧同步候选，不重新整体安排；必须由 #457 或新 owner 重建真实证据 |
| #313 previous-session release | open；检查曾通过但仍未 merge，属于旧收敛队列 | 不作为本计划功能完成证据；若触及只作依赖核验 |
| `origin/perf/canvas-click-select-20260903` | `fa2c483a1e3359b6630fcc01d6f34a58859c1988`，独有 patch，尚无 PR | Canvas S5/S6 的候选实现；先在新 main 做红测和 truth-source 核验 |
| `origin/fix/mcp-remaining-holes-20260903` | `99396b...`，可能与已合入 #426 重叠 | 先做 patch-id/file compare；不得以该 branch 直接重排已吸收工作 |

### 已合入、已吸收或已关闭：明确不重新安排

- PR #455（`976584c8`）及其 deterministic canvas media-error fixture 修复、PR #457（`53e3ab7c`）及其 cross-device settings/contract/E2E 代码已经属于当前基线；本计划只消费它们带来的入口，不重写 #455/#457。
- Agent M0 文档基线（#272/#275）、M1 Host 基础（#301 `13a78c02`）、M2 已合入 slices（#318 `89434944`、#337 `147fcd42`、#360 `e8477aa2`、#382 `f2ef66ed`）、M3（#372 `25cefcfe`、#374 `774e1105`、#376 `da415627`）、M4 provenance/taint（#405 `5d28462b`、#407 `b4d29656`、#408 `c1d34830`）、M5 Slice A（#420 `87bc55c9`）不作为新功能重新排期；这里只补尚未证明的残余闭环。
- MCP 已合入的 L2/描述/elicitation/retired-name 工作（#381 `deb48a6d`、#387 `8d091288`、#426 `d022252d`、#442 `b0b98a61`、#448 `7b25000c`）不重新做“剩余 holes”大合并；新项目只验证 24 工具的真实 effect coverage 与 durable receipt。
- Storyboard V5 已合入（#368 `c42bf63e`、#392 `48ae2ba3`、#414 `d8bbf8b0`）、Canvas S1/S2/S3/S4 与 S6 hygiene 已合入（#311 `a9112cda`、#341 `777c9be0`、#346 `a056b4ed`、#393 `2e750796`）；不重排这些已完成的基建。
- TikHub connector/route 已合入（#296 `6e90ce4d`、#302 `2344a342`），video deconstruction engine/panel/mock render 已合入（#290 `7ecc5838`、#293 `a7c0b2e5`、#295 `a6541b49`）；后续只针对 live、restart、Agent handoff 等证据缺口。
- 架构 phase 1 和 phase 2 的 boundary/archetype/neutral-contract 初始 slices 已合入（包括 #241 `47dd0af1`、#310 `d6da41f3` 以及主线 neutral contract 迁移 commits）；不重新安排 phase 2 已合入部分。

## 交付顺序与决策闸门

1. 先在 `53e3ab7c` 上刷新所有红测和 evidence manifest，优先处理无额度/无外部写入的 Agent M0/M1、MCP L2、canonical storyboard 和 Canvas S5/S6。
2. 在真实 Electron 上证明每个 effect 的 receipt、文件读回和重启恢复，再做 packaged journey；旧的 fixture-only、旧截图和 skipped check 只能保留为上下文。
3. 在 TikHub live、跨设备真实同步、APIMart/视频 live canary 前取得用户的 key/额度/第二设备/同步客户端授权；不因开关存在而宣称已完成。
4. UI image2 用户确认和架构 phase-3 所有权决策是独立闸门；二者未通过前不实现 rejected mockup、不做大规模 contract/cycle 重排。

## Follow-ups

### 1. `AGENT.M0.DEVIATED-CONTRACT` — Agent Host M0 残余契约闭合

**状态/优先级：** 部分完成；P0 基础可信度。M0 文档与 baseline 已交付，但 `deviated` 等真实偏离语义仍缺少生产 owner 的断言；不能把文档完成当作 Host 完成。

**用户价值：** 用户能看到“已偏离/需恢复/不可继续”的真实状态，避免 Agent 在重启、重复或异常后把错误状态伪装成成功。

**当前 main / PR / merge SHA：** `origin/main@53e3ab7c` 已含 M0 文档来源 #272 `c1f6b385`、#275 `7bf7e27f`；Host lifecycle forwarding shell 已由 #411 `ea0d51b7` 移除。没有新的 M0 product merge；#453 只承载计划。

**依赖 / 不重复：** 依赖当前 `projectAgentHost`/lifecycle state owner 和 M1 的真实 Host journey；不重复 M0 文档、不复制 #301 Host 基础、不为了绿灯改写既有 contract。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | 合法 session/command 完成后，M0 状态与真实 settled receipt 一致，`deviated=false`。 |
| Boundary | 空历史、单条历史、重启后最后一条 history、重复 command 的状态边界均不越界，`deviated` 只由真实偏离触发。 |
| Error | malformed state、未知 command、错 project/session 被标成可恢复错误或 `deviated`，不得伪造 settled。 |
| Timeout | lifecycle command 超时后进入可读的 timeout/deviated 状态，不能继续派发旧 command。 |
| Network | M0 纯契约不调用 provider；provider/network 不可用时断言调用次数为 0，状态仍可恢复。 |

**实现范围：** 在真实状态 owner 补齐偏离/settled 断言、状态序列化边界和 model-visible safe parse；保留现有语义，不扩展新 Host 功能。不得把 test-only fixture 变量当成生产 state。

**验证与交付：** unit 覆盖 reducer/parse/receipt；integration 覆盖 Host lifecycle 与 session history；真实 Electron 完成一次偏离→恢复→继续的用户旅程；packaged 作为 M5 的依赖 smoke；持久化重启读回 `deviated`/receipt；UI 仅验收已有状态显示，不新增视觉设计。

**是否需要用户决策：** 否，前提是保留当前状态语义；若要改“偏离是否可自动恢复”的文案或策略，另行决策。

**新 PR 交付边界：** 一个只改 M0 生产契约及其同一断言测试的 P0 小 PR；不包含 M1 Host enable、MCP 24-tool ledger、UI image2 或 live provider。

### 2. `AGENT.M1.HOST-LIFECYCLE` — Agent Host/M1 真实生命周期与结算

**状态/优先级：** 部分完成且被阻塞；P0。#301 已合入 Host 基础，但 Host 默认关闭，M1 remediation gaps 和真实 Electron Host 旅程没有证明；#452 usage/receipt follow-up 仍 open 且 E2E/Quality 失败。

**用户价值：** Agent 能在一个稳定的 Host 会话里开始、暂停、取消、结算并恢复任务，用户不会看到重复执行、孤儿任务或“看似成功但没有副作用”。

**当前 main / PR / merge SHA：** #301 `13a78c02` 已在 main；M1 gap 参考 `docs/plan/2026-09-03-m1-contract-coverage-gap-remediation.md`；#452 head `75f8e4148ee6d539d2e54250e3c7bb5b75497f5a` 尚未 merge。当前没有 M1 completion SHA。

**依赖 / 不重复：** 依赖 M0 契约、现有 Host capability/lease owner 和 #452 owner 的 usage ledger/receipt 取舍；先比较 #452 的 diff，不复制 `execution_settled`/usage receipt。M5 只消费本项目的 receipt，不在这里做 packaged graduation。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | Host 接收合法 command，生成一个 operation/usage receipt，完成后可从 Host 和项目文件读到同一 settlement。 |
| Boundary | stale lease、过期 revision、重复 operationId、关闭窗口后继续操作、两个 session 争同一 project 都被边界规则拒绝或安全恢复。 |
| Error | 未授权 capability、未知 tool、malformed args 和 Host disabled 返回可读错误，provider 不产生副作用。 |
| Timeout | command/approval/model runtime 超时可取消且只结算一次，队列没有 hidden retry。 |
| Network | provider/network 失败生成失败 receipt/可重试状态，断言不重复收费、不重派发已 settle 的 operation。 |

**实现范围：** 闭合 rc-01/rc-02/rc-05/rc-06 等已审计缺口，统一 Host command→proposal→approval/deny→effect→settlement→receipt；补真实 Host 开关下的 session history 和取消/恢复，不提前打开付费模型。

**验证与交付：** unit 覆盖 state machine、safeParse、idempotency 和 sensitive-field privacy；integration 覆盖 Host/lease/receipt/resolver；真实 Electron 走 start→approve/deny→cancel/settle→restart；packaged 走零额度 Host disabled/controlled journey；持久化重启必须读回唯一 operation 和 settled/deviated 状态；视觉走查 Agent status、queue、error、receipt 状态。

**是否需要用户决策：** 需要：是否在本地 Electron 允许真实 Host enable，以及 `execution_settled` 的可见性/取消语义；没有决策前只做 disabled/zero-quota 红测。

**新 PR 交付边界：** 先由 #452 owner 重新对齐后拆一个 M1 contract/Host journey PR；usage ledger 与 Host enable 不得和付费 provider、M4 trust 或 M5 package 混在同一 PR。

### 3. `AGENT.M2.SEMANTIC-EFFECT-CHAIN` — M2 语义调用到真实 effect

**状态/优先级：** 已有多 slice 合入但整链未证明；P0。M2 的 semantic generation/editing/canvas slices、legacy retirement 和若干 L2 tests 在 main，但“模型可见调用 → resolver → 真实 effect → receipt → revision”没有基于新 main 的完整 fresh journey。

**用户价值：** 用户给 Agent 一个自然语言任务后，系统真正修改目标文档/canvas/timeline 并留下可撤回、可审计的结果，而不是只显示一张成功卡片。

**当前 main / PR / merge SHA：** #318 `89434944`、#337 `147fcd42`、#360 `e8477aa2`、#382 `f2ef66ed` 已合入；MCP L2 基础 #381 `deb48a6d`、#387 `8d091288`、#426 `d022252d` 已合入。#426 的旧“remaining holes”不再整体重排；`origin/fix/mcp-remaining-holes-20260903@99396b...` 只可作 diff 比较。

**依赖 / 不重复：** 依赖 M1 的 lease/settlement、MCP tool coverage ledger 和 canonical storyboard patch；不在此项目重新实现 24-tool catalog 或 storyboard 专用 UI。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | 使用生产 manifest/catalog shape 的语义调用，在目标项目产生可读 effect、revision 变更和唯一 receipt；UI 与文件读回一致。 |
| Boundary | stale revision、wrong project、invalid lease、unsupported operation、empty selection、重复 operationId 均不修改目标。 |
| Error | schema/模型/vendor/capability 错误在 resolver 边界返回结构化错误，不能 fallback 到已退休 alias。 |
| Timeout | Agent/tool/provider polling 超时能 cancel/reconcile，不能留下 pending 假成功或二次 effect。 |
| Network | 外部 provider/loopback 不可用时只有明确 blocked/error receipt；mock adapter 之外不得有网络调用，付费调用次数为 0。 |

**实现范围：** 选取至少 canvas、document、timeline/generation 中的代表性真实 effect，建立 machine-readable coverage receipt；验证 schema→lease→proposal→approval→adapter→revision→receipt→restart readback。严格区分 fixture control-flow 与 live provider effect。

**验证与交付：** unit 覆盖每个 operation schema/resolver/receipt；integration 覆盖代表性写入、undo/revision 和 alias retirement；真实 Electron 完整执行一条用户任务并读回真实文件；packaged 执行零额度 L2 smoke；持久化重启后继续/拒绝未知 submission；视觉走查 proposal、confirmation、receipt、error/queue。coverage receipt 不得用工具数量或通过率填充未跑项目。

**是否需要用户决策：** 需要：哪些代表性 effect 可在无额度环境先认证，以及是否授权单次 paid canary；没有授权时不把 paid path 标成 green。

**新 PR 交付边界：** 先交 canonical effect/receipt 小 PR，再交覆盖 ledger/剩余 tool slices；不复制 #426，不把 paid canary、M5 package 和所有 24 个工具塞入一个大 PR。

### 4. `AGENT.M3.CONTEXT-PROJECTION` — 七层上下文投影与可恢复工作

**状态/优先级：** 代码和 unit slices 已部分完成；P1，依赖 M1/M2。#372/#374/#376 已合入，但 true Host seven-layer projection、skill/provider context reload 和 restart continuation 没有新 main 的真实证据。

**用户价值：** Agent 能持续理解当前项目、选中对象、权限、工具能力和上一次结果，用户关闭再打开后无需重新解释，也不会把别的项目或旧 revision 当成当前上下文。

**当前 main / PR / merge SHA：** #372 `25cefcfe`、#374 `774e1105`、#376 `da415627` 已合入；无完成 M3 merge。当前只消费这些 slices，不重新安排已合入代码。

**依赖 / 不重复：** 依赖 M1 session/lease、M2 canonical effect、M4 provenance；不新建第二套 Agent context store，不把 UI screenshot 当 projection proof。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | 同一 project/session 的上下文层投影到 Agent，调用正确 tool/target，重启后读回同一 context hash 与 task continuation。 |
| Boundary | project switch、selection empty、permission reduced、skill version changed、context too large 时只投影允许范围。 |
| Error | missing project/session、invalid skill hash、stale provider capability 产生结构化 blocked/error，不静默使用旧 context。 |
| Timeout | context build、skill reload、Agent resume 超时可重试/取消，不能产生第二个 task owner。 |
| Network | provider/catalog/network 不可用时 context 仍可安全读本地缓存但标 stale/blocked，不能声称 live capability。 |

**实现范围：** 统一 seven-layer projection 的 owner、hash、scope、stale marker 和 restart readback；补 Host 与 canvas/document/Agent UI 的同源 context receipt，不扩大 skill 家族或 provider 范围。

**验证与交付：** unit 覆盖 layer projection/hash/permission；integration 覆盖 project switch、selection、skill reload、resume；真实 Electron 完成建任务→切项目→关闭→重启→继续；packaged 验证 bundled skill roots 与 capability fallback；持久化重启读回 context/receipt；视觉走查 stale、permission、long context、resume 状态。

**是否需要用户决策：** 需要：context hash 变化后默认“阻止继续”还是“允许用户确认后继续”；Host enable 范围也必须明确。

**新 PR 交付边界：** 一个只做 context projection/restart 的 PR；skill packaging 和 M5 package 另 PR；不重做 #372/#374/#376。

### 5. `AGENT.M4.TRUST-TAINT` — provenance/taint 可见且阻止未授权副作用

**状态/优先级：** 部分完成；P0 trust gate。#405/#407/#408 已把 provenance/taint 数据链带入 main，但没有 visual taint badge、Host-enabled real journey 或真实 spend boundary 的证明。

**用户价值：** 用户能知道素材、模型输出和 Agent action 是否可信、是否经过批准、是否来自 mock/外部 provider，并能在错误来源或过期批准时阻止修改和付费。

**当前 main / PR / merge SHA：** #405 `5d28462b`、#407 `b4d29656`、#408 `c1d34830` 已合入；#452 的 usage/receipt head `75f8e414...` 尚未完成。无 M4 completion SHA。

**依赖 / 不重复：** 依赖 M1 settlement、M2 effect receipt 和 UI image2 gate；不重新实现已合入 provenance/taint schema，不用旧 storyboard anchor mockup 作为 badge 设计。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | 有来源、revision、approval 和 cost policy 的 action 才能 effect，并生成带 provenance/taint/settlement 的 receipt。 |
| Boundary | unsigned/tainted/expired approval、mock source、旧 revision、wrong project 只能预览或拒绝，不能修改/收费。 |
| Error | 缺 provenance、冲突来源、schema 不可读、policy 不允许时显示结构化 trust error，调用 provider 次数为 0。 |
| Timeout | approval/receipt/provider timeout 后 action 保持 pending/blocked，重试不复制 effect 或扣费。 |
| Network | provider/network/asset source 失败时 taint 变为可见 stale/blocked，禁止 fallback 为“可信成功”。 |

**实现范围：** 将 taint/provenance/status 映射到真实 Agent proposal、confirmation、receipt、asset 和结果 slot；补零额度阻断及单次显式授权 canary 的审计字段。UI 视觉只在 image2 确认后实现。

**验证与交付：** unit 覆盖 provenance/taint/policy；integration 覆盖 approval→effect→receipt 与 no-spend refusal；真实 Electron 覆盖 approve/deny/expired/restart；packaged 覆盖 trust badge 和零额度拒绝；持久化重启读回 taint/receipt；视觉走查 loading/error/tainted/approved/paid confirmation，需用户接受。

**是否需要用户决策：** 需要：taint 文案/颜色和是否授权 paid canary；用户未确认 image2 或 spend policy 前不得把 M4 标绿。

**新 PR 交付边界：** 先做数据/拒绝路径 PR，再做 image2 确认后的 UI PR；paid canary 和 M5 package 不混入。

### 6. `AGENT.M5.PACKAGED-GRADUATION` — M0-M4 在 packaged runtime 的毕业证据

**状态/优先级：** 部分完成/待重跑；P0 release gate。#420 Slice A 已合入，但 current main 没有 M0-M4 全链在 packaged runtime 的新鲜证据；#419/#421/#422 仍是旧栈/open/未合入。

**用户价值：** 用户安装实际发行包后，Agent、MCP、skills、canvas 和 receipts 仍能启动、恢复和安全失败，不会出现开发环境能用、安装包失效的断层。

**当前 main / PR / merge SHA：** `origin/main@53e3ab7c` 已含 #420 `87bc55c9`；#419 head `7b67877a...` 为旧 M5 stack 且冲突，不能当 current main proof。当前基线没有 M5 graduation SHA。

**依赖 / 不重复：** 依赖 M0-M4 的真实 receipts、MCP L2 catalog、skills roots 和 image2/视觉验收；不重新安排 #420 已交付的 packaged Slice A，不在本项目打开 Host 或付费模型。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | 从新 build 安装包启动，catalog/manifest/skills 正确加载，完成零额度 Agent/MCP 用户旅程并留下 receipt。 |
| Boundary | Host disabled、unsigned/不同版本 skills、missing optional provider、首次启动/升级/最小窗口均有安全降级。 |
| Error | malformed package config、unknown tool、invalid IPC sender/args、损坏 receipt 返回可见错误，不启动隐藏 fallback。 |
| Timeout | packaged startup、MCP stdio、Agent task、restart recovery 超时可诊断且不假绿；进程退出后无孤儿 operation。 |
| Network | packaged 无网络/ provider 401/429/5xx 时保持 zero-quota safe mode；不得以 fake adapter 计 live success。 |

**实现范围：** 在 `53e3ab7c` 重新 build/package，重跑 M0-M4 代表旅程、MCP L2 smoke、skills root/hash、receipt/restart 和 mac packaged gate；记录每项真实证据状态。非目标是 Host enable、paid provider 和发布。

**验证与交付：** unit/integration 先在源码 runtime 通过；真实 Electron 作为安装包前置；packaged 是本项目主门禁；持久化重启读回 project/receipt/skills state；视觉走查安装包的 Agent/MCP/confirmation/error/receipt shell。任何 skipped check 都保留为未证明。

**是否需要用户决策：** 零额度 graduation 不需要；若要把 Host/paid path 纳入 package gate，需要用户明确授权、额度和回滚方式。

**新 PR 交付边界：** 一个基于 current main 的 packaged evidence/修复小 PR；不得把旧 #419 stack 整体 cherry-pick，不包含 provider live certification。

### 7. `MCP.L2.TOOL-EFFECT-COVERAGE` — 24 工具的真实 effect/receipt 覆盖

**状态/优先级：** L1/目录部分完成，L2 未完成；P0。当前 main 有 24-tool catalog、manifest、L1 及若干 L2/packaged slices，但 L2 启动曾出现 60 秒红、写工具未逐个证明 effect→receipt→file→restart；“24 tools”不是“24 effects”。

**用户价值：** 用户从 Agent、MCP client 或 UI 调用工具时，看到的每一个成功都对应真实项目变化、可审计 receipt 和可恢复状态，而不是只返回 protocol-level success。

**当前 main / PR / merge SHA：** `origin/main@53e3ab7c` 已含 MCP 相关 #381 `deb48a6d`、#387 `8d091288`、#426 `d022252d`、#442 `b0b98a61`、#448 `7b25000c`；packaged catalog 相关 #420 `87bc55c9`。`origin/fix/mcp-remaining-holes-20260903@99396b...` 可能重复 #426，尚无可用完成 SHA；当前 exact L2 rerun 仍需在 `53e3ab7c` 上执行。

**依赖 / 不重复：** 依赖 M1 lease/settlement、M2 semantic effect、canonical storyboard、M5 packaged；不重新实现已合入 #426 的通用 holes。工具 ledger 必须区分 model-facing manifest 与 external catalog，不能混计。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | 每个纳入覆盖范围的 read/write tool 用生产名称、schema 和 resolver 执行；write 后有真实 effect、receipt、文件路径和 restart readback。 |
| Boundary | invalid lease/revision/operation、wrong target、empty selection、duplicate confirmation、large media/document boundary 都拒绝且无副作用。 |
| Error | malformed args、unknown/retired tool、权限/模型/vendor 不支持返回 MCP error envelope，不能被内部 mock 吞掉。 |
| Timeout | L2 startup 60 秒边界、long-running run、provider polling、cancel/restart 都有可诊断 timeout；不通过 `SKIP` 隐藏。 |
| Network | loopback/provider/APIMart unavailable、401/403/429/5xx 时 mock 仅停在 adapter，断言无真实付费调用并生成 blocked/error receipt。 |

**实现范围：** 建立 machine-readable ledger（capability、schema、resolver、effect owner、behavior test、receipt、file、restart）；先覆盖写入与 canonical surface，再扩展 read/media/export。对 `nomi_canvas_plan`、document/timeline edit、asset import、run/artifact review、maintenance、integration manage 明确真实副作用边界。

**验证与交付：** unit 覆盖 schema/permission/receipt；integration 覆盖 tool→resolver→effect；真实 Electron 做 MCP client→项目变更→receipt→重启读回；packaged 做 catalog/stdio/skills/L2 smoke；持久化重启每项 write 必须读回或安全 reconcile；视觉走查 Agent tool bar、proposal/confirmation、receipt、blocked/error。coverage receipt 只计跑过的 effect，不填“24/24”假数字。

**是否需要用户决策：** 需要：paid generation 是否允许进入 L2 canary；无授权时 zero-quota/fake adapter 只能是 control-flow evidence。

**新 PR 交付边界：** 先交 ledger + canonical semantic writes，再按 capability 分小 PR；另交 packaged gate。禁止把 `origin/fix/mcp-remaining-holes` 未比较的内容直接合入，禁止重排 #426。

### 8. `STORYBOARD.AGENT.CANONICAL-PATCH` — canonical storyboard Agent patch

**状态/优先级：** 设计与部分实现存在，但 production canonical loop 未证明；P0。#454 open、冲突且不能整体合入；旧 `patch_shots` preview probe/旧 storyboard walk 不能作为生产证据。

**用户价值：** 用户在 storyboard 表中选中镜头、让 Agent 修改 prompt/duration/aspect/model/vendor 等字段时，只有选中的行被改动，用户可预览差异、批准/拒绝、撤销，并在重启后找回同一结果。

**当前 main / PR / merge SHA：** storyboard V5 #368 `c42bf63e`、#392 `48ae2ba3`、#414 `d8bbf8b0` 已在 main。#454 head `feb392525b8bbd75205890e8099ba1aff72cbba7` 包含 Agent/right-dock/patch 方向，但未 merge；其现有 `isStoryboardPatchTool(toolName) === 'patch_shots'` 与 `window.__nomiStoryboardPatchPreview` 不是 canonical proof。生产 canonical contract 必须是 `modelToolSurfaceManifest.canvas → nomi_canvas_plan → canvasWriteSemanticInputSchema → args.operation=patch_shots`；没有 canonical patch completion SHA。

**依赖 / 不重复：** 依赖 MCP/M2 semantic effect、M1 receipt、canvas selection truth 和 UI image2 gate；不整体 cherry-pick #454，不实现已被拒绝的 anchor/parameter rail mockup。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | 使用真实 `nomi_canvas_plan` + `args.operation=patch_shots` 和真实 selection injection，只改选中行；prompt、kind、duration、aspect、model/vendor 均进入 diff/receipt。 |
| Boundary | 空/多选、选中已删除行、未选行、字段缺省、相同值、旧 revision、重复确认都保持 untouched fields 且不产生第二次 effect。 |
| Error | invalid revision/operation/model/vendor、schema mismatch、wrong project、deny/cancel 返回结构化错误，canvas/table 不变。 |
| Timeout | Agent call、preview、approval、adapter timeout 可取消/恢复，不能留下 pending 假成功或重复 patch。 |
| Network | model/provider/network 失败只产生 blocked/error receipt；patch 本身不得因网络 fallback 静默写入，provider 调用次数可核验。 |

**实现范围：** 把 canonical tool/catalog、selection injection、全部字段 diff、approve/deny、receipt、table/canvas consistency、persistence/restart 和 duplicate/cancel 纳入生产路径；预览必须显示所有会写入的字段。旧 anchor UI 另走 image2，不得由旧静态 HTML 推导。

**验证与交付：** unit 覆盖 schema/selection/untouched-field/diff/receipt；integration 覆盖 manifest→MCP→canvas write→table readback；真实 Electron 完成选行→preview→approve/deny→restart；packaged 验证 canonical tool path 与安全拒绝；持久化重启读回 patch receipt/revision；视觉走查 storyboard/Agent dock/row selection/diff/confirmation/error，必须在 image2 用户确认后验收。

**是否需要用户决策：** 需要：anchor/parameter rail 的新视觉方向和字段密度；旧 #454 anchor mockup 已明确 rejected，用户未确认新 image2 前只能交付逻辑/receipt，不实现 UI。

**新 PR 交付边界：** PR-A 只做 canonical functional path 与同一断言；PR-B 只在 image2 confirmed 后做真实组件/视觉状态；不合并 #454 全量，不混入 Canvas S5/S6 或 paid provider。

### 9. `CANVAS.CLICK-SELECT-S5-S6` — click-select 唯一真相与性能/卫生重证

**状态/优先级：** S1-S4/S6 hygiene 已合入，S5 与 click-select 未在 current main fresh 证明；P1。`origin/perf/canvas-click-select-20260903@fa2c483a` 有独有 patch，但无 PR；PR #455 只修 deterministic media-error harness，不能替代 S5/perf/selection proof。

**用户价值：** 用户点击节点、空白区、多选或缩放时，界面选择、React Flow state 和领域 selection 保持一致，编辑目标可靠；复杂 canvas 仍保持可用性能。

**当前 main / PR / merge SHA：** #311 `a9112cda`、#341 `777c9be0`、#346 `a056b4ed`、#393 `2e750796` 已在 main；当前 main 需要重跑 S5，S6 click-select 无 main merge。候选 branch tip `fa2c483a`，其 implementation commit `9d36eb23` 仅作审查输入。

**依赖 / 不重复：** 依赖 storyboard selection injection 与 canonical write，但不实现 storyboard；必须确认 React Flow/domain 谁是唯一 truth source，不重排 S1-S4/S6 hygiene，不覆盖共享 outputs。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | click node/row 后 React Flow selection、domain selection、Agent target 和视觉高亮四者相同，随后 patch 只作用于该 selection。 |
| Boundary | blank click、multi-select、dense edges、low zoom、collapsed group、drag/connect、selection clear 不误选、不丢选、不改变连接。 |
| Error | stale/deleted node、media error/retry、unknown target 产生可见 error 并清理无效 selection，不触发写入。 |
| Timeout | S5 launch/render/wait、media retry、large graph interaction 超过阈值时可诊断且无 infinite retry/selection race。 |
| Network | canvas selection/perf 不依赖网络；provider/network unavailable 时断言 click-select 仍可用且没有隐藏请求。 |

**实现范围：** 在 `53e3ab7c` fresh baseline 上重建 S5 scenario，验证候选 branch 的 unique truth、click-select、React Flow/domain projection、performance artifacts；只保留实测的增量 patch。共享 outputs 保持不变，未来 evidence 使用新路径。

**验证与交付：** unit 覆盖 selection reducer/adapter；integration 覆盖 click/drag/group/connection；真实 Electron 完成 dense canvas 用户旅程并采集阈值；packaged 运行性能/selection smoke；持久化重启读回 selection/graph revision；视觉走查选中、未选中、hover、error/retry、最小窗口。S5 数值和截图必须来自本次 main，不使用旧 artifacts 冒充。

**是否需要用户决策：** 否，默认维持现有 S4 交互和唯一 truth；若要改 selection 语义/性能阈值，需另行批准。

**新 PR 交付边界：** 一个只做 click-select truth/interaction 的小 PR；S5 fresh evidence 与性能修复可作为同 owner 的第二 PR；不纳入 storyboard UI、shared outputs 或 PR455 已合入 harness。

### 10. `WORKSPACE.CROSS-DEVICE.RESTART-SYNC` — 跨设备关闭/重启/真实同步

**状态/优先级：** 主线代码、测试和 Settings surface 已由 #457 合入，但真实双设备/真实同步客户端仍未证明；P1。#457 merge `53e3ab7c` 的自动化检查已成功，旧 PR #328 仍 open 且 E2E/Performance/Quality 失败。模拟 profile、两个本地目录或截图不能证明两台真实电脑同步。

**用户价值：** 用户在设备 A 保存并关闭项目，在设备 B 打开、编辑、保存，再回到 A 继续工作；冲突、离线、缺资产和半同步不会静默丢稿。

**当前 main / PR / merge SHA：** current main `53e3ab7c` 已含 #457 head `a58d048d9fe8789656bc80daa1bd58d403f6e396` 及其 workspace sync/settings/contract/E2E 代码；没有真实双设备 completion SHA。#328 head `fee6d56f40890dce7361bb55c9ba1fbd11ba9a05` 仍是旧候选。相关设计基线为 `docs/superpowers/plans/2026-09-01-cross-device-project-continuation.md`。

**依赖 / 不重复：** 依赖 project manifest/asset/export persistence、M0-M3 restart receipt；不引入 cloud SDK，不复制 #328 全量，不把 local simulated profiles 计为真实 sync。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | A 保存/关闭→真实同步客户端→B 打开并读回→B 编辑保存→同步回 A→A 重启继续，project revision/资产/receipt 一致。 |
| Boundary | 冲突 revision、同名 project、缺 asset、未完成 sync、export 文件、device settings/API key 都按 ownership 规则处理；secret 不随项目同步。 |
| Error | 损坏 manifest、非法路径、权限不足、缺 sync root、无法读 asset 显示可恢复错误并保留 backup/quarantine。 |
| Timeout | sync lock、upload/download、重启 readback 超时可恢复/继续，不覆盖较新的 revision，不显示假成功。 |
| Network | 断网、同步客户端断开、offline queue、部分上传均有可见 pending/failed state；不会把本地 mock 结果标为 remote synced。 |

**实现范围：** 闭合 manifest/revision/backup/conflict/quarantine、portable config（不含 secret）、asset/export ownership、save/close/restart/readback；先定义真实外部 sync client 的证据格式，再做双设备 canary。

**验证与交付：** unit 覆盖 manifest/merge/conflict/secret exclusion；integration 覆盖两个隔离目录的 sync protocol；真实 Electron 必须使用两台可访问设备或真实同步客户端完成 A→B→A；packaged 两端均使用安装包；持久化重启是主验收；视觉走查 Settings→File & saving、pending/conflict/missing asset/recovery。没有第二设备只能标 `blocked`。

**是否需要用户决策：** 需要：选择实际同步客户端/第二设备和是否授权真实 canary；默认不做云服务，也不自动同步 API key。

**新 PR 交付边界：** 不复制或重开 #457；由其 owner 另交一个只包含真实设备/真实同步客户端 canary 与 evidence 的后续 PR，必要时先补最小 restart/conflict 修复。真实设备 evidence 独立记录，不能用 #328 或模拟 profile 替代；不得改既有 shared outputs。

### 11. `TIKHUB.V1.LIVE-RESTART-PACKAGE` — TikHub live、密钥边界与安装包证据

**状态/优先级：** connector/route 已有代码，live 未认证；P1。当前 evidence 只有 no-key/invalid/fixture 边界，未证明 authorized TikHub response、短期 URL、safeStorage 重启和 packaged journey。

**用户价值：** 用户粘贴 Douyin/TikTok share URL 后，系统可在授权范围内解析直接媒体 URL、导入项目并保留来源证据，再进入已有 deconstruct workflow，避免手工下载和来源丢失。

**当前 main / PR / merge SHA：** connector #296 `6e90ce4d575a...`、route #302 `2344a342...` 已合入；asset source evidence 相关 #388 `d8ebe6d7...` 已在主线。#435 head `5f1f5719b7b6c3be4cffeb4ca083b0a8a7df110d` 仍 open 且 Contracts/Quality 失败；无 live completion SHA。当前 `TIKHUB.V1.CONNECTOR/ROUTE` 不能计 live。

**依赖 / 不重复：** 依赖 asset import/restart、deconstruct result handoff、M4 provenance；不重写 connector/route，不把 #435 研究 workflow 或 invalid-key walk 当 live。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | 授权 share URL 经真实 TikHub response 解析 direct URL，导入项目并生成 `AssetSourceEvidence`，重启后仍可追溯来源。 |
| Boundary | unsupported platform、无 direct URL、多候选 route、短期 URL、下载 cap/大小/时长边界给出可读选择或拒绝，不越过 cap。 |
| Error | missing key、401/403/404/5xx、non-JSON、invalid response 映射结构化 error；不把错误响应当媒体。 |
| Timeout | route/download/direct URL expired/upstream timeout 可取消、重试受限并保留失败 receipt，不无限重试。 |
| Network | DNS/offline/429/quota/rate-limit 明确 blocked；mock 只在 TikHub adapter 边界，不能伪造 live import；provider call/cost 可核验。 |

**实现范围：** 先固定 fixture response/error contract，再在用户明确 key/额度后做最小 live canary；验证 safeStorage key status、runtime-only secret、下载 cap、asset evidence、deconstruct input、退出重启和 packaged。不得打印 key，不自动扩大抓取/下载范围。

**验证与交付：** unit 覆盖 route/error/cap/evidence/safeStorage；integration 覆盖 URL→adapter→asset import→deconstruct handoff；真实 Electron 做授权 live URL journey；packaged 做 no-key/authorized bounded journey；持久化重启读回 asset/evidence（不读回明文 key）；视觉走查 settings/key status/import/provenance/error。live 证据要单列 `live-certified`，fixture 仍标 `fixture-only`。

**是否需要用户决策：** 需要：提供有效 TikHub key、允许的 URL、额度/下载 cap 和 live canary；无授权时保持 blocked，不盲目重试。

**新 PR 交付边界：** connector/route 不新做大 PR；新增一个 bounded live/restart/package evidence PR（可由 #435 owner 修复后承接），不把 TikHub live、视频 provider 和 3D UI 混在一起。

### 12. `DECON.VIDEO.DURABLE-HANDOFF` — 视频拆解 durable result 与 Agent handoff

**状态/优先级：** engine/panel/mock render 已在 main，durable handoff 未完成；P1。当前 `DeconstructVideoResult` 主要是 renderer session state，`releaseWorkbenchProjectSession.ts` 会清理它；没有 Agent result slot、任务中心、重启继续和真实 provider 成功证据。

**用户价值：** 用户把参考视频拆成结构化镜头后，可以在 panel 或 Agent 中看到同一个结果，选择镜头生成 canvas 节点/组，关闭应用后回来继续，不必重复等待或丢失选择。

**当前 main / PR / merge SHA：** engine #290 `7ecc5838`、panel #293 `a7c0b2e5`、mock/render #295 `a6541b49`、asset evidence #388 `d8ebe6d7` 已合入；相关 design/3D workflow PR #435 head `5f1f5719...` 未完成。`DECON.AGENT.HANDOFF` 没有 main merge SHA。

**依赖 / 不重复：** 依赖 M2 effect/receipt、M3 context、asset evidence、M5 package；不重做已合入 engine/panel，不创建第二个 panel/Agent result view，不把 fixture parse 当 APIMart/vision live。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | 视频→结构化 result→选择镜头→canvas nodes/group→Agent result slot 的引用一致，保存后重启仍可继续。 |
| Boundary | empty selection、partial failed shots、unknown columns、large video、panel 与 Agent 同时打开、关闭/折叠运行中任务都不丢结果或重复写入。 |
| Error | invalid schema、parse/vision/ASR failure、missing media 显示可恢复错误，不能产出假 storyboard。 |
| Timeout | ffmpeg/ASR/vision/provider timeout、重启中断、single-shot retry timeout 可取消并可从 durable task state 恢复。 |
| Network | APIMart/vision/Whisper/network unavailable 时只走明确 fixture/offline policy；无 credentials 不计 live，不创建 provider 假结果。 |

**实现范围：** 将 result/task/selection/retry/status 按 project/source key durable 存储，设计 canonical Agent result slot、task center、single-shot retry、resume/reconcile；panel 与 Agent 读取同一 source of truth，串接真实 canvas materialization 和 receipt。

**验证与交付：** unit 覆盖 result schema/task state/retry/selection；integration 覆盖 panel/Agent/result slot/canvas；真实 Electron 用 deterministic fixture 走完整用户旅程，再将 live provider 单独认证；packaged 验证视频导入/结果恢复；持久化退出重启是硬门禁；视觉走查 panel、Agent slot、progress/error/retry/selected shots，新的布局先过 image2。

**是否需要用户决策：** 需要：panel 与 Agent 并置的 UI 方向，以及是否授权 APIMart/vision/ASR live canary；未授权时只做 fixture durable proof。

**新 PR 交付边界：** 第一 PR 只做 durable state/result-slot/handoff/restart；第二 PR 做 image2 确认后的 UI；第三个独立 PR 才做 live provider；不复活旧 mockup、不重排 #290/#293/#295。

### 13. `ARCH.PHASE3.NEUTRAL-CONTRACTS` — 架构三期与中立层收尾（决策闸门）

**状态/优先级：** 仍在架构 roadmap 中，但未达到立即实现条件；P2/高风险。phase 1 与 phase 2 初始 neutral-contract slices 已部分合入；phase 3 的 providerAdapter↔catalog↔integrationCertification hard-loop 拆分、`integrationSession.ts` 分解和 `electron/runtime.ts` 依赖清理仍未证明。旧审计中的耦合数量只能作为历史信号，必须在 `53e3ab7c` fresh scan 后再定范围。

**用户价值：** 减少升级/模型/provider/Agent 变更引发的循环依赖与启动回归，让不同界面共享稳定 contract，长期降低用户遇到“某个页面能用、另一个页面失效”的概率。

**当前 main / PR / merge SHA：** phase 1 boundary gate/ownership map 已在历史 commits（包括 `e84a0b42`）；phase 2 provider/model expansion #241 `47dd0af1`、archetype #310 `d6da41f3` 及后续 neutral contract slices `564e1338`、`2599800d` 已在主线，当前 `electron/shared/contracts` 有 9 个文件。phase 3 没有 merge SHA，也没有授权中的新实现 PR。

**依赖 / 不重复：** 依赖 M1-M4 所有权稳定、provider #241 语义稳定和 fresh module ownership/cycle scan；不重排已合入 phase 2，不把旧“55/62 type-only imports、37 cycles、1696-line session”等历史数字直接当 current target。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | 目标 contract 从 neutral layer 被 Agent/MCP/canvas/provider 各 consumer 使用，typecheck/build 和代表性行为保持一致，未新增 cycle。 |
| Boundary | type-only/value import、re-export shell、legacy path、optional provider、platform package path 只按 ownership 规则通过或被 boundary gate 拒绝。 |
| Error | circular initialization、missing contract、bad adapter registration、wrong capability 返回可诊断错误，不靠 import order 偶然通过。 |
| Timeout | build、package startup、provider/catalog bootstrap 超时能定位 boundary，不用延长 timeout 或 skip 掩盖 cycle。 |
| Network | architecture red/green 不需要 live provider；provider/network failure 在 adapter boundary 保持现有 safe behavior，不能因迁移绕过认证/receipt。 |

**实现范围：** 先生成 current main 的 import/module ownership/cycle inventory；取得 contract owner、兼容期和 phase-3 hard-loop 拆分决策；之后只迁移一个中立 contract slice，再拆 `integrationSession`/provider-catalog cycle，保持行为不变。禁止顺手改 UI、tool semantics 或 provider policy。

**验证与交付：** unit 覆盖 neutral contract/adapter compatibility；integration 覆盖 import boundary、catalog/provider/Agent startup；真实 Electron 跑代表性 Agent/MCP/canvas/provider-disabled journey；packaged 验证 module resolution；持久化重启只在 touched runtime 有效时执行；视觉走查只证明行为/布局没有回归，不替代 architecture gate。

**是否需要用户决策：** 必须：批准 phase 3 是否现在启动、neutral layer owner、兼容期/删除旧路径策略和可接受的 PR 数量。决策未通过不得实施高风险迁移。

**新 PR 交付边界：** PR-0 只交 fresh inventory + decision record；PR-1 只迁移一个 neutral contract slice；PR-2 才拆 hard loops/large session；每个 PR 有独立 red→green 和回滚点，不创建 mega PR。

### 14. `UI.IMAGE2.DESIGN-GATE` — UI 设计 image2→用户确认→视觉验收

**状态/优先级：** 规则已有于当前收敛分支的 design 文档，但 current `origin/main@53e3ab7c` 尚未把它变成所有 UI follow-up 的强制交付闸门；P0 横切流程。旧 #454 anchor/parameter rail mockup 已 rejected，不能继续实现。

**用户价值：** 用户在真实组件出现前就能确认层级、密度、信息优先级和状态设计，减少静态稿与真实工作流脱节；实现后还能在 Electron/package 中确认视觉没有退化。

**当前 main / PR / merge SHA：** `docs/design/nomi-design-flow-image2-gate.md` 与 `docs/design/agent-ui-state-coverage-gaps.md` 当前由 PR #453 分支承载，尚未属于 `origin/main`；本 feature 没有产品 merge SHA。审计依据 `docs/qa/2026-09-04-pr454-storyboard-agent-audit.md`：#454 旧 anchor 方向已 rejected。

**依赖 / 不重复：** 依赖真实 shell/current screenshot、用户任务、featureId 和相关功能的状态矩阵；不从旧 HTML/mockup 继续实现，不用 image2 图替代真实交互/持久化/Agent/MCP/canvas/provider 证据。

**红测矩阵（H/B/E/T/N；每格先红后绿，使用同一断言）：**

| 类别 | 必须先失败再通过的生产断言 |
| --- | --- |
| Happy | Prompt Brief 明确用户任务/状态/changed variable，image2 经用户明确确认后，真实组件的结构与 design contract 一致，并在 Electron/package 截图中可核对。 |
| Boundary | desktop/narrow/min window、long text、empty/loading/error/confirmation/tainted/queue、多候选和最小窗口均有可读层级，不以单一 happy screenshot 通过。 |
| Error | 用户拒绝/撤回确认、image2 生成失败、design contract 冲突时状态为 `rejected`/`blocked`，断言不创建实现 PR 或不继续旧方向。 |
| Timeout | image2 生成、审阅、确认、实现后视觉走查超时/中断可恢复，不把未审阅稿标 confirmed。 |
| Network | image2/image asset 服务不可用时保留 Prompt Brief 与 blocked receipt，不把静态 HTML、本地 placeholder 或旧 screenshot 标为视觉 green。 |

**实现范围：** 为每个需 UI 的 feature 建立 Prompt Brief、image version、changed variable、path、反馈、decision 和 desktop/narrow/min evidence；用户确认后冻结 component contract，再做 production red→green、真实 Electron/package、持久化和视觉走查。优先覆盖 Agent status/confirmation/receipt、storyboard patch、M4 taint、deconstruct handoff、sync settings。

**验证与交付：** unit 只验证状态/字段映射；integration 验证真实组件与 production state；真实 Electron 验证用户 journey；packaged 验证安装包布局与可用性；持久化重启验证 UI 读回状态；视觉走查必须由用户确认后的 design contract、Electron/package screenshots 和长文本/错误态 checklist 共同通过。没有 image2 confirmation，后三项均为 `not proven`。

**是否需要用户决策：** 必须；每个新 UI feature 都要用户确认 image2 方向。#454 anchor 旧方向明确不可直接实现。

**新 PR 交付边界：** design record/Prompt Brief 可先独立 PR；用户确认后每个真实 UI feature 单独实现 PR，并附同一 featureId 的 visual receipt；不在本计划 PR 中修改 product UI。

## 每个新 PR 的最小证据包

提交实现 PR 前，PR 描述必须逐项链接以下证据；缺一项就保持 `partial`/`blocked`，不可写“完成”：

1. featureId、current main SHA、owner、依赖和新 PR scope；
2. Happy/Boundary/Error/Timeout/Network 五条 red receipt，以及同一断言的 green receipt；
3. 外部依赖 mock 的边界和“mock 之外无外部调用”的证明；
4. unit、integration、真实 Electron、packaged 的命令、版本、环境和结果；
5. 实际副作用：项目文件/receipt/revision/asset 路径，退出重启后的 readback/reconcile；
6. coverage receipt 的分子、分母、跳过项、blocked 项和 fixture-only 项，禁止把未证明项计入 100%；
7. 若涉及 UI：image2 Prompt Brief、用户确认、冻结 design contract、实现后 Electron/package 截图和视觉走查；
8. 若涉及 live/同步/付费/架构决策：用户授权、额度/设备/环境、失败边界、回滚和明确的 `live-certified`/`blocked` 标签。

### Scoped coverage hard gate

用户要求的 `100% branch` 与 `100% statement` 是**每一个交付 PR 的 scoped production module/test target**，不是自动把整个仓库宣称为 100%。PR 必须列出精确的 production module、对应 test target、branch/statement 分子分母、coverage tool receipt（命令、commit、配置、原始输出路径和环境），并证明该 receipt 来自实际运行的测试；只补 unit、只跑 fixture、只看 CI job 名称或手填 coverage 数字均不合格。

若全仓库覆盖不可行，必须明确写出“仓库级 100% 未达成”，不得把局部 module 的 100% 冒充全仓库 100%；同时列出剩余 uncovered branch 的 `owner`、`blocking reason`、预计承接的 `next PR` 和其依赖。uncovered branch 不能藏在 ignore/exclude、snapshot 或 skipped test 中；每个被保留的 branch 都要有对应的 H/B/E/T/N 断言或明确标为 blocked。该 coverage gate 与真实 Electron journey、packaged journey、持久化重启和 UI image2/视觉走查相互独立，任何一项通过都不能替代另一项。

## 本计划的完成定义

本文件在 PR #453 中完成交付，且本轮只包含计划/审计/设计文档及本地 `ef518d51` 基线 merge（同步到 `origin/main@53e3ab7c`）；不包含产品代码、测试修改或共享 `outputs`。后续项目只有在各自新 PR 的证据包满足上述硬门禁后，才可从 `partial`/`not proven` 变为 `complete`；合并 SHA、CI green、fixture pass 或按钮点击本身都不构成完成。
