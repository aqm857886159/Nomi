# Project Agent 历史 PR 覆盖索引

> 状态：已完成 2026-08-29 的一次只读 evidence 审计；完整证据见 [`docs/audit/2026-08-29-project-agent-pr-evidence.md`](./2026-08-29-project-agent-pr-evidence.md)。Phase 5 前只需按届时最新 `main` 做增量枚举并更新漂移，不得跳过历史 PR。

原则：最新 `main` 是代码基线；历史 PR 是严重问题证据和设计输入，不整包 merge，不机械 cherry-pick。PR 即使落后于 `main`，也必须提炼其中的严重问题、核心语义决策和 review 异议，并结合当前实现给出 `adopt / adapt / reject` 结论，不能因代码漂移而跳过。

最终 evidence 表必须至少记录：问题与上下文、关键文件/语义 diff、review 讨论、相对最新 `main` 的漂移、采纳结论、落入的阶段合同以及防回归证据。UI 条目还要先对照现有已批准设计；只有发现明确缺口时，才通过 `docs/design/nomi-design-system.md` 补充调整依据。

| PR / issue | 当前已知核心输入 | 首次读取阶段 | 后续出口 | 审计状态 |
|---|---|---|---|---|
| #181 pi runtime | AgentSession、上下文快照、附件、取消、工具回喂边界 | Phase 2B | Host execution/recovery | 已审计；adopt/adapt/reject 见 evidence |
| #194 Agent 交互设计 | 稳定 Item、busy queue、Skill/context/approval 呈现 | Phase 2B | Phase 6 UI 复用 | 已审计；adopt/adapt/reject 见 evidence |
| #195 Skill / tool surface | audience、progressive disclosure、list/read 同守卫、Skill shrink-only | Phase 5 前 | Registry/Skill/MCP | 已审计；安全缺口已登记 |
| #196 React Flow 试验 | renderer 只应是画布投影 | Phase 2B | Phase 6 renderer 边界 | 已审计；fallback 结论已登记 |
| #197 v0.21.0 | ProductionRun、预算、受控采纳、sender/owner/cancel | Phase 4 | paid/destructive | 已审计；领域 owner 结论已登记 |
| #199 React Flow card stack（撤下） | resultId/version、历史卡栈、折叠编组、聚合连线 | Phase 3 | Canvas target/precondition | 已审计；撤下原因和替代 PR 已登记 |
| #201 card stack / group-link follow-up | duplicate variant、视频 scrub、聚合端口、项目切换清理 | Phase 3/6 | Canvas projection / real journey | 已审计；未合入，需最新 main 增量复核 |
| #202 MCP 真实旅程 | 取消、审批身份、reference role、ETA、产物、export truth | Phase 3/4/5 | 对应能力验收 | 已审计；13 项去向已登记 |
| #203 React Flow 迁移 | domain/store/persistence 独立于 renderer | Phase 2B | Phase 6 renderer 边界 | 已审计；需最新 main 增量复核 |
| #204 单源门岗 | semantic owner AST 检查与 R14.1 | Phase 2B | 全阶段结构门岗 | 已审计；能力 owner 仍需人工对偶审计 |
| #213 safe AI timeline editing | 时间轴控制面、卡片/控件行为；与当前 Canvas timeline 改动直接重叠 | Phase 2B checkpoint | main integration 保行为 | 已审计；checkpoint 必须保行为 |
| #223 Project Agent Host | 当前任务分支与 Draft PR | 全阶段 | 最终交付 | 持续更新；本次审计已记录快照漂移 |

## 阶段边界

- Phase 2B：只读取会影响 Host owner、旧外壳行为、receipt/recovery 和 checkpoint 合并冲突的条目。
- Phase 3/4：补读 capability、取消、审批、ProductionRun 和真实旅程证据。
- 进入 Phase 5 前：以 evidence 文档为基线，重新枚举新增/更新的 MCP / Skill / Registry PR，补增量后冻结行为合同。
- Phase 6：复用冻结合同，只补 UI 相关 PR / 截图 / review 增量；UI 不得反向修改权限、Registry 或生命周期语义。
