# Project Agent Host 全阶段执行路线图

> 状态：🚧 进行中。Phase 1、2A、2B、3A、3B 已形成远端 checkpoint；当前处于 Phase 3C Round 07 合同复审，生产代码尚未开始。最终完成条件仍为 Phase 3–6 与发布候选门全部通过。

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
| Phase 2A | 已完成 | Host foundation、CAS、迁移/恢复合同已落地 |
| Phase 2B | 已完成 checkpoint | 单 Host、两面板投影、旧 writer 删除、receipt/Undo/项目切换已收口 |
| Phase 3A | 已完成 checkpoint | canonical `document.read` 已通过 Host，旧 read owner 已删除 |
| Phase 3B | 已完成 focused closure | `document.write` 已完成 Registry/Host/Surface/adapter/UI 路由；写入队列必须冻结可执行 anchor/revision/hash，缺失或 whole-document 占位在入队前 fail closed |
| Phase 3C | 合同复审中 | 首个 `set_node_prompt` 垂直切片；Round 06 preflight 已打回，Round 07 已补 Host-before-Surface、可信 hash 与 durable outcome 合同 |
| Phase 3 其余 | 未开始 | 其余 canvas reversible writes、timeline read/write、精确 result/version 引用 |
| Phase 4 | 未开始 | ProductionRun、付费/破坏性能力、receipt、TaskRef、typed cancel、export truth |
| Phase 5 | 未开始 | Skill/MCP 从 Registry 派生，list/read guard、shrink-only、legacy firewall |
| Phase 6 | 未开始 | 常驻 UI；只投影已冻结的 Host/domain 状态，基于现有设计系统调整 |

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

实现循环只运行当前切片的 focused matrix：相关单测、对应 TypeScript、
`check:capability-owners`、必要的词汇/结构门和 `git diff --check`。测试失败时
先把失败归类为契约、生命周期、实现或环境问题，记录到阶段日志；同一失败不
通过重复跑全量测试来“确认”。修复后只重跑直接受影响的矩阵。

每个切片 focused 绿后立即形成 **scoped 本地提交**；它是日常恢复点，不触发
`main` 整合、全量门禁或远端 push。远端 Draft PR 已保存 Phase 3B 之前的代码现场；
Phase 3/4 联合出口和最终 Phase 6 出口才形成远端 stage checkpoint。

远端 stage checkpoint 才做三件事：

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

## 流程 v3：停止无信息测试循环

本任务的节奏真源是本路线图与本地 harness 的
`execution-protocol-v3.json`。同一测试命令、同一失败签名在源码、fixture、依赖
和相关环境都没变化时最多执行两次；第二次相同失败后必须先归类为合同、生命周期、
实现或环境问题并改变对应证据，禁止第三次原样重跑。已知窄问题不能靠更宽测试诊断。

每个 lane 只允许一个生产代码 writer；reviewer 默认只读并复用 evidence ledger，
仅补查缺失、过期或有争议的证据。网络 fetch/push 失败不使未变化的代码验证失效，
也不触发重跑测试。

## 回滚与恢复

- 每个切片只回滚自己的 checkpoint，不重写默认分支或远端历史。
- 远端网络中断时，从最近 checkpoint 继续；先检查 `git status`、远端分支和
  PR，再恢复实现，不重新扫描全仓库。
- 只有最终候选通过全量 gates 后，才把 PR 标记为可合并；未经明确授权不 merge、
  squash、close 或直接 push protected branch。

## 下一步顺序

1. 先让 Phase 3C Round 07 的增量合同复审通过，再按同一垂直切片完成
   `set_node_prompt` 的 Host-before-Surface、exact receipt identity、stale revalidation
   和 typed outcomes；不新增第二套 approval、status 或 Undo owner。
2. 完成 timeline read/write 和精确 result/version 引用，形成
   Phase 3 focused 出口矩阵；此时不单独整合 `main`。
3. 推进 ProductionRun/付费链与 export integrity，形成 Phase 4 出口，再做一次
   Phase 3/4 联合 closure、整合当时的 `main` 并更新远端 checkpoint。
4. 阅读历史 PR 增量并完成 Registry 派生的 Skill/MCP surface（Phase 5）。
5. 最后基于设计系统完成常驻 UI、真实旅程和最终全量发布门（Phase 6）。
