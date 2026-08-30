# Project Agent Host 全阶段执行路线图

> 状态：🚧 Phase 6 B 批次实施中。Phase 1、2A、2B、3A、3B、3C、3D、4 与 5 已完成 checkpoint；PR #194 的 Agent 交互样张已作为 Phase 6 A 批次设计输入，当前进入 resident shell 实施。后续不追逐或整合 `main`，直到 Phase 6 focused checkpoint。

> 下一位 AI 的恢复入口：[Phase 6 与最终交付 Handoff](../superpowers/plans/2026-08-30-project-agent-host-phase6-handoff.md)。它只负责导航；本路线图仍是唯一状态/合同真源。

> 交付方法：本路线图继续是唯一活跃任务真源；复杂方案与执行节奏遵循 [engineering-plan-delivery](../../.agents/skills/engineering-plan-delivery/SKILL.md)。Skill 规定单一真源、宏批次、证据复用和成本熔断，不另建新的 protocol/version/ledger；本路线图负责 Project Agent Host 的具体合同、阶段状态和下一步。

## 目标

在当前任务分支完成 Project Agent Host 的 Phase 2B 至 Phase 6，并把最终
候选交付到 Draft PR #223 的可合并状态。Host 是项目级 Thread/Turn/Item、
审批和能力调用的唯一事实 owner；文档、画布、时间轴和 ProductionRun
继续由各自领域服务持有，Host 只保存经过验证的引用和投影。

这是一条持续执行目标，不以单个中间 PR 或一次全量测试通过作为完成标志。
每个阶段必须留下可恢复 checkpoint 和可审计出口证据，最后才做一次完整集成。

## 当前基线（2026-08-29）

| 阶段 | 状态 | 当前事实 |
| --- | --- | --- |
| Phase 1 | 已完成基础实现 | `canvas.read` 脊梁已存在，最终包级验收留到最终出口 |
| Phase 2A | 已完成 | Host foundation、CAS 与恢复合同已落地；发布 cutover 简化为旧会话只读归档 + 新 Host 干净启动 |
| Phase 2B | 已完成 checkpoint | 单 Host、两面板投影、旧 writer 删除、receipt/Undo/项目切换已收口 |
| Phase 3A | 已完成 checkpoint | canonical `document.read` 已通过 Host，旧 read owner 已删除 |
| Phase 3B | 已完成 focused closure | `document.write` 已完成 Registry/Host/Surface/adapter/UI 路由；写入队列必须冻结可执行 anchor/revision/hash，缺失或 whole-document 占位在入队前 fail closed |
| Phase 3C | 已完成 checkpoint | canonical `canvas.write@v1` 已统一 set/create/connect/tidy；真实 renderer transaction、receipt correlation、stale/lock、exact result pointer 和旧 owner 删除已通过 focused closure |
| Phase 3D | 已完成 checkpoint | canonical `timeline.read@v1` / `timeline.write@v1` 已统一 read/range/plan/apply/undo；Timeline kernel、CAS、Workbench Undo 和旧 owner 删除已通过 focused closure |
| Phase 4 | 已完成 checkpoint | 唯一付费 authorization、三条旧 writer 退役与 archive-only active-source cleanup 已完成；affected evidence、结构门和限定 P0/P1 review 已通过；远端恢复点 `189ac884` |
| Phase 5 | 已完成 checkpoint | 显式 audience、list/read 同 guard、version/hash URI、shrink-only、Registry-only 投影和 main-owned knowledge-only ZIP 边界已收口；affected closure 与限定复审通过 |
| Phase 6 | B 批次实施中 | 采用 PR #194 样张：一个 Host projection Dock 跨 Creation/Generation/Preview；共享 206px timeline splitter、queue/Stop/approval/task/artifact/thread/composer；旧面板不再挂载。 |

R12 说明：本任务分支当前有 6 个超过 800 行的 Host/工作台聚合文件。它们已按本批
人工审查后进入精确行数 allowlist，allowlist 只防止继续增长，不等于债务清零；
Canvas completion 与 Phase 4 大批必须优先抽取这些 owner 并下调基线，不能再新增
allowlist 条目来掩盖模块膨胀。

## 每个能力的固定内部顺序

能力不得横向铺开成“先改所有后端、再改所有 UI”。每个能力仍按下列顺序闭环，
但这些步骤只是批内依赖，不是独立 Round、评审、提交或推送单位：

1. **契约**：canonical id、version、input/output、effect、target、precondition、
   approval 和 aliases 只有一个 Registry owner。
2. **Verified invocation**：Host/main 生成并复验绑定、策略、目标和哈希；
   renderer/MCP 只能提供已绑定的 domain port。
3. **执行器**：只接受 verified invocation，输出安全 DTO；不把 editor、provider
   或 SDK 对象穿过边界。
4. **Surface transport**：sender/frame/owner/epoch、取消、轮换、项目切换和
   malformed reply 都 fail closed。
5. **领域 adapter**：复用现有领域事务、持久化和 Undo/reconcile；不在 Host
   重写领域状态机。
6. **Host/UI projection**：审批、队列、结果和失败都进入共享 Item/Proposal；
   UI 只消费 snapshot/patch。
7. **删除旧 owner**：删除 descriptor/`TOOL_META`/handler switch/renderer
   writer 等重复路径；owner gate 必须证明债务只减不增。

## 验证节奏

实现循环分成三层：

1. 批内只在新增验收项尚无证据，或源码、fixture、依赖、相关环境指纹变化时，运行
   最早失败边界的直接测试。已通过且指纹未变化的证据继续有效。
2. 宏批次稳定后只运行一次 affected closure：直接相关矩阵、受影响 TypeScript project、
   `check:capability-owners`、必要的词汇/结构/root-cause 门和 `git diff --check`。
3. 全仓 test/build/package/真实旅程只在最终候选整合固定的 `main` SHA 后运行一次。

测试失败先归类为契约、生命周期、实现或环境问题；相同命令和失败签名在相关指纹
未变化时最多出现两次，第三次原样重跑禁止。修复后只重跑受影响的失败文件；不能用
更宽测试诊断已知窄问题。互不共享锁、端口或生成目录的测试/TypeScript project 可以
并行，存在共享全局状态的命令保持串行。

每个宏批次 focused 绿后只做一次只读评审。reviewer 只对冻结合同和该批 diff 报告
P0/P1 阻断项；P2 或既有非回归进入 backlog，不能反向扩张当前批次。修复 reviewer
发现后只做一次 fix diff/失效条款 scoped re-review，并验证失效证据，不重跑整个 closure。
提交前先把本路线图的证据、状态、残余风险和下一批次回填，再把 scoped code + 路线图
一起 commit；刷新并检查远端任务分支后普通 push。生成的 commit SHA 记入 PR/交付报告或
下一 checkpoint，不要求 commit 自己记录自己的 hash。每个宏批次都必须推远端，不能只留本地。

## 一次性 Cutover 决策

正式发布采用 `archive-only`，不再把旧创作/生成对话或 Pi context 导入新 Host：

- 首次打开先把旧 `conversations.json`、旧 Pi context 和旧 Canvas proposal receipt
  复制到只读归档，再写一次性 cutover manifest；新 Host 从空状态初始化。
- manifest 与归档校验后，活跃位置中 hash 一致的旧 `conversations.json` / `agent-session.json`
  被删除；清理崩溃可重入，源文件已缺失视为完成，源内容变化则 fail closed 且不误删。
- 旧 pending/已批准但状态不明的 Agent 操作全部失效且不自动重放；旧 Canvas proposal
  只归档，不迁成可执行 Undo receipt。
- 文档、画布节点、素材、生成结果及 ProductionRun 继续由各自领域存储保留；
  ProductionRun 仍按 Phase 4 的核账/恢复合同处理，不能因 Agent cutover 被清空。
- cutover 后只有新 Host 是 Agent writer，不保留新旧双写；新 Host 产生数据后不承诺
  直接降级到旧版本。

这里删除的是旧 Agent 会话/Pi context 的无损迁移复杂度，不删除新 Host 自身的
CAS、receipt correlation、崩溃恢复和 ProductionRun exactly-once 安全边界。
Host 合同也不再保留 legacy thread provenance；旧文字/context/receipt 只存在于归档，
不能重新进入运行时、审批或 Undo 状态。

remote recovery push 前刷新任务分支引用，但只观察、不把 `main` 合入开放中的
宏批次；如果网络失败或远端没有新事实，记录
一次 transport 错误后熔断，不重复 fetch/push，不让它阻塞实现。远端分支若前进，
普通 push 会安全拒绝，此时才暂停并检查分歧；禁止 force-push。

开放中的 Phase 4/5/6 都不因 `main` 移动而 rebase/merge。Phase 6 focused UI 完成并形成
远端 recovery checkpoint 后，才 fetch 一次、记录一个固定的 `origin/main` SHA、整合一次，
处理冲突并运行最终全量门。验证期间 `main` 再移动不触发追赶；只有仓库合并策略明确
阻塞时才重新评估，不把持续追主线当作实现循环。

## 阶段出口定义

### Phase 3：只读与可撤写

- 所有目标能力从 Registry 派生并通过 Host；读写都带 exact target/revision/
  anchor/content hash 等 precondition。
- proposal、领域事务和 Undo 保持一个 owner；旧 alias/descriptor/switch 已删除。
- 画布、文档、时间轴结果引用稳定的 result/version，不复制 renderer 状态。

### Phase 4：ProductionRun 与付费链

- destructive/paid capability 只能由 Host 提案，真人确认后进入既有 ProductionRun。
- `runId/jobId/artifactId/resultId`、预算、provider receipt、恢复和取消 exactly-once；
  Host、TaskCenter、MCP 和 UI 只投影同一事实。
- 关闭 PR #202 暴露的 reference role、typed cancel、ETA honesty、可审阅产物和
  export manifest truth 缺口。

### Phase 5：Skill/MCP 投影

- Skill 只能缩小 Host ceiling；未知 capability、可执行目录、越权 URI fail closed。
- `skills/list` 与 `skills/read` 使用同一 audience/visibility guard；工具列表和
  schemas 从 Registry 派生，legacy route 不能承接 canonical binding。
- 进入本阶段前必须先读历史 PR 证据，并只补届时 `main` 上新增/更新 PR 的增量。

#### Phase 5 冻结合同（2026-08-30）

**包边界。** Skill 是知识包，不是执行扩展。renderer 只把现有导出 envelope、裸
`SKILL.md` 归一成文件表；zip 保留原始 bytes，通过 trusted async IPC 交给 main。main 以
central directory 为权威，分别校验 raw filename 与 Unicode-effective alias 的
path/type/duplicate/ancestor，再从 raw stream 解压并核对压缩输入实际消费字节、输出 size 与
CRC，最后才剥唯一 wrapper 并形成文件表；随后盖 `nomi-skill-v1` 版本并做唯一权威校验。允许
根 `SKILL.md` / `skill.json` 和有界递归纯文本知识文件（包括 `references/`、`assets/`、
`examples/`、`evals/` 与 README）；路径穿越、符号
链接、重复/碰撞 entry、大小/数量/深度越界、二进制或不支持内容、`scripts/` / `bin/` /
`hooks/` 全部拒绝，
不得静默导入截断包。导出与导入保留同一递归知识文件表。

**可见性。** Skill 显式声明 `audience: internal | mcp`。当前第一方导演/编剧知识 Skill
逐个声明 `mcp`；目录名前缀不再拥有授权语义。用户导入包即使自称 `mcp` 也强制为
`internal`，直到以后存在经批准的外曝 consent UI。list、read、resources 和 prompts
共用一个 audience/origin guard；猜 name、directoryName 或 URI 不能绕过 list。

**能力缩小。** manifest 可选 `requestedCapabilities`，每项只能是 canonical Registry ID。
运行工具集合为 `Host capability ceiling ∩ Skill requestedCapabilities`；未知 ID、Pi/MCP alias
或 legacy tool name fail closed。字段缺失时保持当前 legacy Host ceiling，避免把现有无声明
Skill 意外变成零工具。旧 `tools`、`permissions` 和 stage tools 继续表示 Workflow/产品需求，
不得授予 Host 或 MCP 权限，也不得自动注册工具。

**版本化投影。** summaries/content 同时带 main 派生的确定性 package content hash 与版本。
MCP resource URI 严格绑定 directory/version/hash，read 时重新执行同一可见性检查并校验当前
版本/hash；畸形、过期、缺失或不可见 URI 均 fail closed。Pi/MCP canonical tools 继续只由
Registry + 显式 transport adapter 派生，Skill/manifest 不改变 `MCP_CAPABILITY_RESOLVER`。

**不在本阶段。** 不建设 PromptRecipe catalog、Connector/MCP client、ExecutableExtension、
能力 marketplace、项目 capability lock 或 Phase 6 UI 改版；MCP artifact/player 的最终视觉
闭环归 Phase 6 真实客户端旅程，本批只保留现有 Registry/ProductionRun 投影边界。

#### Phase 5 验收与证据预算

| Criterion | 最小证据 |
| --- | --- |
| 包完整性与知识-only 边界 | `skillZipImport.test.ts` + `skillPackage.test.ts` + `parseSkillImport.test.ts`：三种输入、递归 round-trip、raw traversal/duplicate/symlink/type/declared+actual limits/CRC/binary/executable-dir 拒绝，renderer 不解压 |
| ZIP/IPC 信任与性能边界 | `skillIpc.test.ts` + Electron/renderer typecheck：async invoke/handle、trusted sender guard、raw bytes 只在 main lazy stream decode |
| list/read 对称与用户包不外曝 | `skillStore.test.ts` + `nomiMcpSkills.test.ts`：同一 guard 覆盖 list/read/resources/prompts、伪造 audience/name/URI 失败 |
| Skill 只能缩小 Host ceiling | `skillManifestSchema.test.ts` + `skillCapability.test.ts` + `agentChatPolicy.test.ts`：canonical ID 交集、unknown/alias fail closed、缺字段 legacy 保持 |
| MCP 版本化资源且 Registry 唯一 | `nomiMcpSkills.test.ts` + `mcpCapabilityProjection.test.ts`：strict URI/stale hash 拒绝、manifest 不注册 tool/schema |
| recurring 类根因结构防护 | `check:root-cause-contracts` + Phase 5 根因合同覆盖全部变化中的生产边界 |

批内只运行新增/直接失效的测试；宏批次结束运行上述 affected files、受影响 TypeScript project、
`check:root-cause-contracts`、`check:capability-owners`、必要结构门和 `git diff --check` 各一次。
随后只做一次当前合同 P0/P1 diff review，修复只重跑被失效证据。整批一次 commit/push，
不整合 `main`，不运行全仓 test/build/package。

### Phase 6：常驻 UI 与最终候选

- UI 只投影已有 Host/domain 状态，不新增权限、审批、任务或结果 owner。
- 现有设计系统和真实工作台是基准；先做可体验样张，再替换旧面板。
- 最终出口才运行全量 gates、typecheck/test/build/package、真实创作→生成→预览→
  导出旅程、重启/跨项目/冲突/MCP 私有性/付费审批验收。

#### Phase 6 设计输入与当前实施记录（2026-08-30）

PR #194（head `b157cebd49ef93eb98aedc871ead96ed06b35e6b`）只作为问题与设计证据，未 cherry-pick：

- **adopt**：稳定 Item 气泡、忙碌队列、工具请求需批准、340px resident Dock、36px 收起入口、
  共享 Thread/Skill/context/model/approval 入口、生成/预览时间轴可拖拽高度。
- **adapt**：样张的静态按钮和演示数据改为 `ProjectAgentHost` snapshot/patch、
  `runWorkbenchAgent`、`turn.transition`、`queue.edit` 和现有领域组件投影；Dock 在当前真实
  Workbench 三个 Workspace 的高层注入，跨面板不建立第二份历史。
- **reject**：样张中的本地 demo transcript、独立 approval/task/result owner、旧面板 fallback；
  文档/画布/时间轴/ProductionRun 继续由既有领域 owner 持有。

当前 B 批次已落地：`ProjectAgentResidentShell`、共享 timeline 高度（默认 206px、140–300px）与
水平 separator；Creation/Generation/Preview 均从 `WorkbenchShell` 注入同一 Host projection Dock，
支持 queue edit/cancel、Stop、工具批准/拒绝、Thread 切换/删除、Skill/context/model/mode、附件、
 任务/产物引用展示。原 `CreationAiPanel`、`CanvasAssistantEntry`/`CanvasAssistantPanel` 与旧
 conversation bucket 已删除；生产挂载图只保留 resident shell，不再提供 fallback。

## 历史 PR 注意点

进入 Phase 5 或 Phase 6 前，必须阅读并引用：

- `docs/audit/2026-08-29-project-agent-pr-evidence.md`
- `docs/audit/2026-08-29-project-agent-pr-coverage-index.md`

这些 PR 可能晚于当时的 `main`，但记录的是当时发现的严重问题和有效思路。
它们是问题证据和设计输入，不是机械 cherry-pick 清单；实现以阶段冻结合同和
届时最新 `main` 为代码基线。尤其 MCP、Skill、Registry 和 UI 的工作必须保留
这些 PR 的核心约束，同时以现有设计系统和真实界面校正呈现，不另造第二套状态。

具体执行不是等到 Phase 5 才第一次阅读：每个 MCP、Skill、Registry 或 UI lane
在写 RED 前先读取证据表中与该 lane 直接重叠的行和原 PR 语义 diff，记录
`adopt / adapt / reject`。Phase 5 做一次全量增量审计，Phase 6 只补 UI 和新 PR
的变化，不重复同源审计。

这些决定必须进入 tracked evidence，不能只保存在被 `.gitignore` 排除的 harness
运行态。Phase 5/6 开工合同把以下缺口设为 hard fail：相关 PR 的 base/head SHA 与
核验日期、相对届时 `main` 的新增/更新 PR 增量、每个 lane 的 `adopt / adapt / reject`
和对应验收项。UI 另需冻结批准设计的 commit/path、真实工作台截图、关键状态对账和
设计系统版本；结构门必须拒绝缺失证据的 Registry/MCP/Skill/UI RED，而不是依赖人工记忆。

## 流程 v5：三个宏批次

本路线图是唯一活跃流程真源。`.agents/runtime/harness/...` 下的 protocol v2-v4、Round
1-10 合同、evaluation 和 stale ledger 只作为历史证据，不再驱动任务，也不再为后续工作
新增 Round 文件。这样避免把关键状态放在被 `.gitignore` 排除的 32 个运行态文件中。

### A. Phase 4 Closure

一个批次完成剩余 paid authority：gate 前冻结唯一 authorization envelope/digest，Approval、
budget/outbox 和实际 provider payload 消费同一 identity，任何 mismatch 在 job、ledger、outbox、
provider 副作用前失败；同时删除 renderer `mintSpendGrant -> runPlanWithToasts` 直达路径和
advertised/routable `nomi_generate` 旧 provider 路。随后按已批准的 archive-only 方案审计现有
cutover；满足则只补 recovery matrix，不写迁移代码，有真实缺口才做最小修复。整批只有一次
Phase 4 affected matrix、一次评审、一次 commit/push，不整合 `main`，不跑全仓门。

当前实现已关闭三条旧 writer：renderer `run_generation_batch`、driver
`production.generate-node` 和 advertised/routable `nomi_generate`。`nomi_generate` 的 policy
tombstone 保留以 fail closed，但 resolver/catalog、MCP `tools/list`、`tools/call` 和 dispatcher
不再提供执行路径。archive-only cutover 会归档后移除活跃旧源，绝不恢复旧 queue、审批或 Undo。

#### Phase 4 evidence matrix（closure 前）

| Criterion | Evidence | Fingerprint | Result |
| --- | --- | --- | --- |
| 唯一 authorization digest 绑定 gate、Approval、预算、outbox 与 provider payload | `productionGenerationAuthorization.test.ts`、`productionGenerationAuthorizationFlow.test.ts`、`productionGenerationSubmission.test.ts`、`generationRuntimeAdapter.test.ts` | base `de988bcb` + Phase 4 paid-authority source/fixtures | 4 files，42/42 passed |
| renderer/driver 旧 generation writer 不可路由 | binding/dispatcher 与 renderer/driver legacy route 定向矩阵 | base `de988bcb` + legacy route deletion diff | binding/dispatcher 53/53；renderer 79/79；driver 36/36 passed |
| `nomi_generate` 不广告、不调用且 tombstone 保留 | `nomiGenerateRetirement.test.ts` 与直接受影响 MCP tests | base `de988bcb` + catalog/protocol/result cleanup diff | 10 files，93/93 passed |
| archive-only 不重放旧执行且保留作品/付费数据 | `projectAgentMigration.test.ts` | base `de988bcb` + active-source hash cleanup/recovery fixtures | 14/14 passed |
| Electron 类型合同 | `pnpm exec tsc -p electron/tsconfig.json --noEmit` | base `de988bcb` + current Phase 4 TypeScript diff | passed |
| 抽取后的共享 gate decision 保持 receipt 绑定与拒绝语义 | `productionGenerationAuthorizationFlow.test.ts` | `runOwnedGenerationGateAuthority.ts` / `appIntegration.ts` extraction fingerprint | 7/7 passed |
| 返工不覆盖仍被兄弟 job 消费的 run-wide authority | `productionMultiShotSchema.test.ts` | reviewer P1 fix：preparation + reducer 双边界 | 10/10 passed；scoped re-review PASS |
| Phase 4 closure 结构与 hygiene | `check:root-cause-contracts`、`check:capability-owners`、`check:filesize`、`check:batch-machines`、`git diff --check` | base `de988bcb` + complete Phase 4 diff | passed |

上述证据仅在对应源码、fixture、依赖或环境指纹变化时失效。限定 reviewer 只报告了一个 P1：
返工覆盖 run-wide authority 时可能遗留仍可派发的兄弟 job。修复在 preparation 与 reducer 两层
拒绝有待批准/已批准/已写提交 intent 的旧 job，直接证据与 scoped re-review 均通过；未重跑无关测试。

### B. Phase 5 Skill/MCP

复用现有历史 PR coverage index，只枚举相对记录 SHA 的增量，按 lane 写一次
`adopt / adapt / reject`。完成 Registry 派生的 Skill/MCP surface、list/read 同 guard、
shrink-only 和 legacy firewall。整批只有一次 affected matrix、一次评审、一次 commit/push；
不重读已覆盖 PR，不把 Phase 6 UI 拉进本批，也不整合 `main`。

增量审计已观察 GitHub `main@491d670ac35e3b4db8156bc9eeac0a0daa36cd18`，不 fetch、
不合入。PR #226 的 Capability/Skill 分权、知识-only 渐进披露、版本/hash 证据予以 adopt/adapt；
PromptRecipe、Connector、ExecutableExtension 和 marketplace 延后。#227-#235 中只有 #231 的
“不包含 MCP schema”进一步钉住 owner 边界，#232 留作 Phase 6 UI 输入，其余不改变本批合同。

#### Phase 5 closure（2026-08-30）

| 验收面 | 证据/指纹 | 结果 |
| --- | --- | --- |
| Skill 包、IPC、visibility、capability 与 MCP 投影 affected matrix | 基线 `189ac884` + 完整 Phase 5 diff；14 个直接测试文件 | 14/14 files、182/182 tests passed |
| ZIP 两个复审修复 | `skillZipImport.ts` / `.test.ts`：raw/effective 双 identity；raw stream + inflater `bytesWritten`；0x7075 traversal/forbidden/duplicate/type 与 `compressedSize +1/+4/+16` | 19/19 passed；同一 reviewer scoped re-review PASS，无剩余 P0/P1 |
| 生产类型边界 | Electron 与 renderer production TypeScript projects；ZIP 修复后 Electron project 重验 | passed；既有 `tsconfig.test.json` 历史红线未扩入本批 |
| 结构、性能与 hygiene | `check:root-cause-contracts`（35 个变化中的高风险生产文件）、`check:capability-owners`（131/131）、`check:filesize`、`check:heavy-path`、`check:i18n`、`check:test-waits`、scoped ESLint、`git diff --check` | passed；`electron/main.ts` 从 850 降至 836 行，filesize 基线同步下调 |

阶段出口选择是提交并推送当前任务分支形成远端恢复点，但不整合 `main`、不 merge Draft PR，
也不提前进入 Phase 6。用户补充 Agent 交互设计后再恢复 Phase 6 UI；历史 PR evidence 只补届时
变化的 UI/new-PR 增量，不重做 Phase 5 审计。

### C. Phase 6 UI 与最终候选

先基于既有设计系统和冻结 Host/domain projection 完成常驻 UI，做一次 focused UI/visual/
journey closure 并 push recovery checkpoint。然后只在最终候选前固定并整合一个 `main` SHA，
运行一次全量 gates、typecheck/test/build/package、真实创作到导出旅程、恢复/跨项目/隐私/
审批验收和最终只读评审，再 push 最终 checkpoint 并更新 Draft PR。

### Scope 与成本准入

- **当前批次修复**：违反已冻结安全不变量，或由本批 diff 引入的回归。
- **Backlog**：既有、P2、非当前交付路径问题；记录但不扩当前批次。
- **最终整合处理**：只存在于 `main` 漂移或 merge conflict 的问题。
- 命令只有在关闭一个 criterion、缩小未分类失败、或验证变化指纹时才准入。
- 评审只消费已有 evidence；除证据缺失、过期或有争议外，不重复运行命令。

该方案吸收了独立流程审计，但拒绝其中“Phase 4 和 Phase 6 各整合一次 `main`”与
“Phase 5 只留本地提交”两点：前者重复制造冲突与全量门成本，后者不能满足网络中断恢复。
最终选择是每个宏批次远端 checkpoint、`main` 只在最终候选固定整合一次。

## 回滚与恢复

- 每个切片只回滚自己的 checkpoint，不重写默认分支或远端历史。
- 远端网络中断时，从最近 checkpoint 继续；先检查 `git status`、远端分支和
  PR，再恢复实现，不重新扫描全仓库。
- 只有最终候选通过全量 gates 后，才把 PR 标记为可合并；未经明确授权不 merge、
  squash、close 或直接 push protected branch。

## 下一步顺序

1. 暂停在 Phase 6 前，接收并冻结用户补充的 Agent 交互设计；暂停期间不改权限、生命周期、
   Registry 或 Skill/MCP 已验收合同，也不整合 `main`。
2. 恢复后完成 Phase 6 UI focused checkpoint；推远端后固定并整合一个 `main` SHA，运行唯一一次
   最终全量验收，形成最终 checkpoint 并把 Draft PR 更新到可合并状态。
