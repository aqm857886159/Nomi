# Project Agent Host 全阶段执行路线图

> 状态：🚧 进行中。Phase 1、2A、2B、3A、3B 已形成远端 checkpoint；Phase 3C Canvas completion 已完成本地 focused closure，下一批为 Phase 3D timeline。最终完成条件仍为 Phase 3–6 与发布候选门全部通过。

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
| Phase 3C | 本地闭环完成 | canonical `canvas.write@v1` 已统一 set/create/connect/tidy；真实 renderer transaction、receipt correlation、stale/lock、exact result pointer 和旧 owner 删除已通过 focused closure |
| Phase 3D | 下一批 | timeline read/propose/apply/undo 与旧 owner 删除；`delete_canvas_nodes`、`run_generation_batch` 归 Phase 4 |
| Phase 4 | 未开始 | ProductionRun、付费/破坏性能力、receipt、TaskRef、typed cancel、export truth |
| Phase 5 | 未开始 | Skill/MCP 从 Registry 派生，list/read guard、shrink-only、legacy firewall |
| Phase 6 | 未开始 | 常驻 UI；只投影已冻结的 Host/domain 状态，基于现有设计系统调整 |

R12 说明：本任务分支当前有 6 个超过 800 行的 Host/工作台聚合文件。它们已按本批
人工审查后进入精确行数 allowlist，allowlist 只防止继续增长，不等于债务清零；
Canvas completion 与 Phase 4 大批必须优先抽取这些 owner 并下调基线，不能再新增
allowlist 条目来掩盖模块膨胀。

## 每个能力的固定垂直切片

能力不得横向铺开成“先改所有后端、再改所有 UI”。每个能力按下列顺序闭环：

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

实现循环分成两层。微切片 RED/GREEN 只运行当前最早失败边界的直接测试文件；
只有完整 lane 稳定后才运行一次 focused closure，包括相关矩阵、对应 TypeScript、
`check:capability-owners`、必要的词汇/结构门和 `git diff --check`。测试失败时
先把失败归类为契约、生命周期、实现或环境问题，记录到证据账本；同一失败不
通过重复跑更宽测试来“确认”。修复后只重跑指纹已变化的直接测试。

每个交付批次 focused 绿后只做一次只读评审。评审通过后，按仓库 push 纪律只运行
一次完整 push gate，再形成一个 **scoped 本地提交**并普通 push 到现有任务分支；
批内检查点只控制依赖顺序和直接 RED/GREEN，不分别触发评审、提交、推送或宽测试。
这样每个大批次只有一次完整门禁成本，同时远端 Draft PR 仍持续获得可恢复备份。
日常 recovery checkpoint 不整合 `main`；Phase 3/4 联合出口和最终 Phase 6 出口才形成
**remote stage checkpoint**。

## 一次性 Cutover 决策

正式发布采用 `archive-only`，不再把旧创作/生成对话或 Pi context 导入新 Host：

- 首次打开先把旧 `conversations.json`、旧 Pi context 和旧 Canvas proposal receipt
  复制到只读归档，再写一次性 cutover manifest；新 Host 从空状态初始化。
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

remote recovery push 前刷新远端基线与任务分支引用，但只观察、不把 `main` 合入开放中的
lane；如果网络失败或远端没有新事实，记录
一次 transport 错误后熔断，不重复 fetch/push，不让它阻塞实现。远端分支若前进，
普通 push 会安全拒绝，此时才暂停并检查分歧；禁止 force-push。

remote stage checkpoint 才做三件事：

1. 对照本路线图和对应 acceptance matrix 做一次只读 closure review；
2. 只在 Phase 3/4 联合出口或 Phase 6 最终出口把当时的 `origin/main` 整合一次，
   处理直接重叠并保留已冻结行为；
3. 运行仓库要求的完整 push gate 一次，再推送任务分支 checkpoint。

日常允许 `fetch` 观察主线或刷新任务分支，但不为每个新提交 rebase/merge。只有 Phase 3/4
联合出口和最终 Phase 6 出口整合 `main`；这样不会永远追着主线跑，也不会把
主线的新问题误判成当前切片回归。

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

### Phase 6：常驻 UI 与最终候选

- UI 只投影已有 Host/domain 状态，不新增权限、审批、任务或结果 owner。
- 现有设计系统和真实工作台是基准；先做可体验样张，再替换旧面板。
- 最终出口才运行全量 gates、typecheck/test/build/package、真实创作→生成→预览→
  导出旅程、重启/跨项目/冲突/MCP 私有性/付费审批验收。

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

## 流程 v4：关键路径与停止无信息循环

本任务的节奏真源是本路线图与本地 harness 的
`execution-protocol-v4.json`。同一测试命令、同一失败签名在源码、fixture、依赖
和相关环境都没变化时最多执行两次；第二次相同失败后必须先归类为合同、生命周期、
实现或环境问题并改变对应证据，禁止第三次原样重跑。已知窄问题不能靠更宽测试诊断。

每个 lane 只允许一个生产代码 writer；reviewer 默认只读并复用 evidence ledger，
仅补查缺失、过期或有争议的证据。网络 fetch/push 失败不使未变化的代码验证失效，
也不触发重跑测试。

Phase 3C 的内部依赖顺序固定为：能力合同 → durable approval → Canvas raw
evidence/hash → Surface transport → executor → Host ordering/typed outcome → 现有
receipt/transaction 关联 → 删除旧 owner。前两项已完成，后六项不再各自作为交付轮次，
而是合并为两个批次：主干批次一次完成 evidence/hash、Surface transport、executor、
Host ordering/typed outcome；领域切换批次一次完成 receipt/transaction 关联、renderer
adapter、边界内 stale revalidation 和旧 owner 删除。批内仍按最左侧失败边界推进，
但只在批末做一次 focused closure、一次只读评审、一次提交和一次恢复 push。

每条测试证据保存命令、直接文件、源码/fixture/环境指纹、结果签名、失败分类和
下一条允许命令。通过的证据在指纹未变化时继续有效；reviewer 只消费账本并检查
缺失或有争议的合同条件。任何命令若不能关闭当前 criterion、缩小失败分类或验证
一次指纹变化，就不进入执行队列。

## 回滚与恢复

- 每个切片只回滚自己的 checkpoint，不重写默认分支或远端历史。
- 远端网络中断时，从最近 checkpoint 继续；先检查 `git status`、远端分支和
  PR，再恢复实现，不重新扫描全仓库。
- 只有最终候选通过全量 gates 后，才把 PR 标记为可合并；未经明确授权不 merge、
  squash、close 或直接 push protected branch。

## 下一步顺序

1. Phase 3C 已完成本地 closure；保存 checkpoint 后直接进入 Phase 3D，不重开已通过的
   Canvas 微切片，也不新增第二套 approval、status 或 Undo owner。
2. 用一个 Phase 3D 大批完成 timeline read/propose/apply/undo 与旧 owner 删除，形成
   Phase 3 出口矩阵；不在批内整合 `main`。
3. 用一个端到端大批推进 ProductionRun/付费链与 export integrity，形成 Phase 4 出口，再做一次
   Phase 3/4 联合 closure、整合当时的 `main` 并更新远端 checkpoint。
4. 阅读历史 PR 增量并完成 Registry 派生的 Skill/MCP surface（Phase 5）。
5. 最后基于设计系统完成常驻 UI、真实旅程和最终全量发布门（Phase 6）。
