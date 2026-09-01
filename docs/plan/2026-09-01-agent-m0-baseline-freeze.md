# M0：Agent 架构基线冻结

> ⏳ 已拍板·未开工（M0 文档/契约/红灯基线；生产实现从 M1 开始）

这是 PR #272（merge `c1f6b385`）之后的冻结包。依据：

- [执行计划](../research/2026-09-01-agent-architecture-solution-and-execution-plan.md) §5、§6、§8；
- [根因总稿](../research/2026-09-01-agent-architecture-root-cause-synthesis.md) §5、§6、§8、§10；
- PR #223 历史精确 ref：`origin/codex/project-agent-host-phase1-20260827@46066ed0`（本地可复核对象为 `46066ed0595014eb070c3709b5a6d212e0594aaf`）。

## 六项交付

1. [唯一 owner map](../architecture/agent-m0-owner-map.md)：三种状态逐项指定 owner，并记录 Host、Pi runtime、ProductionRun、Artifact 的精确 ref。
2. [50 项工具映射](../architecture/agent-m0-tool-mapping.md)：`keep / merge / host-only / delete` 去向、理由和 15 个语义目标对照；49 个当前 catalog descriptor 加 1 个 wire-level gate 计数差异显式标注。
3. [旧路径清单](../architecture/agent-m0-legacy-paths.md)：按 M1–M5 里程碑列出删除时点和不得保留的 fallback。
4. 四份 schema-v3 根因合同已在 M1 带回生产路径并正式启用：[RC-01](../fixes/2026-09-01-rc-01-durable-owner.root-cause.json)、[RC-02](../fixes/2026-09-01-rc-02-semantic-tool-surface.root-cause.json)、[RC-05](../fixes/2026-09-01-rc-05-typed-output-projection.root-cause.json)、[RC-06](../fixes/2026-09-01-rc-06-settlement-barrier.root-cause.json)。
5. [M1 测试红灯清单](../qa/2026-09-01-agent-m0-red-lights.md)：门编排 18 测、canvas snapshot 挂起、`deviated` 恒 false 均有复现命令/当前状态/验收断言。
6. [PR #223 切片方案](../architecture/agent-m0-pr-slices.md)：Host/runtime → semantic projection → context/compaction → UI/真实旅程。

## M0 停止条件

- 三种状态和每个持久化字段都只有一个 owner；无法证明的字段留在 owner map 的 OPEN QUESTION。
- 每个工具都有去向和理由；计数来源不一致时不补造 descriptor。
- M1 红灯在门编排恢复、快照生命周期收敛、偏差状态有写入/持久化 owner 之前保持红色。
- 本 PR 不改 `electron/`、`src/` 生产实现；只落 docs/ 与现有事实的索引。

## 维护者裁决可见性

Codex 本轮两次尝试 `gh pr view 272 --comments`（代理与无代理）均无法连接 GitHub API，未取得评论正文，因此当时把裁决列为 OPEN QUESTION。**跨池收尾班已在网络可达环境取得两条评论并落仓**：全部裁决见 [agent-m-line-rulings.md](../architecture/agent-m-line-rulings.md)（出处 PR #272 的 issuecomment-5484766923 与 issuecomment-5485265252）。冻结包各处原先的“裁决读不到”OPEN QUESTION 已改为指向该文件。

## 本轮验证收据

- `pnpm run gen:ledger`：通过（生成 DELIVERY-LEDGER 与 superpowers plans 索引）。
- `pnpm run check:docs-index`：通过（无新增未收录方案）。
- `pnpm run check:doc-status`：通过（无新增状态违规）。
- `pnpm run typecheck`：通过（收尾班装好依赖后实跑，三个 tsconfig 全绿）。
- `pnpm run check:root-cause-contracts`：内置 18 项 checker tests 通过，四份 M1 schema-v3 合同均通过正式校验。
