# Project Agent Host 全阶段执行路线图

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
| Phase 3B | 进行中 | `document.write` 已完成 Registry/Host/Surface/adapter/UI 路由，正在补执行闭环证据 |
| Phase 3 其余 | 未开始 | canvas reversible writes、timeline read/write、精确 result/version 引用 |
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

每个切片 focused 绿后立即提交并推送 checkpoint。checkpoint 是恢复点，不是
发布声明；PR 保持 Draft/未合并。

阶段出口才做三件事：

1. 对照本路线图和对应 acceptance matrix 做一次只读 closure review；
2. 只在此处把当时的 `origin/main` 整合一次，处理直接重叠并保留已冻结行为；
3. 重新跑阶段出口矩阵并推送新的 checkpoint。

日常允许 `fetch` 观察主线，但不为每个新提交 rebase/merge。只有 Phase 3/4
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

## 回滚与恢复

- 每个切片只回滚自己的 checkpoint，不重写默认分支或远端历史。
- 远端网络中断时，从最近 checkpoint 继续；先检查 `git status`、远端分支和
  PR，再恢复实现，不重新扫描全仓库。
- 只有最终候选通过全量 gates 后，才把 PR 标记为可合并；未经明确授权不 merge、
  squash、close 或直接 push protected branch。

## 下一步顺序

1. 补齐并通过 `document.write` Host execution coordinator：拒绝不执行、确认后
   执行、proposal 生命周期正确、stale revision/anchor fail closed。
2. 按同一垂直切片完成 canvas reversible writes 和 timeline read/write，形成
   Phase 3 出口矩阵并整合一次 `main`。
3. 推进 ProductionRun/付费链与 export integrity，形成 Phase 4 出口。
4. 阅读历史 PR 增量并完成 Registry 派生的 Skill/MCP surface（Phase 5）。
5. 最后基于设计系统完成常驻 UI、真实旅程和最终全量发布门（Phase 6）。
