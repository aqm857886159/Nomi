# M2 generation semantic slice 1

日期：2026-09-02
基线：`origin/main@349529e6`
分支：`m2/slice-1-semantic-generation`

状态：🚧 进行中

## 目标

把当前模型可见的 9 个 generation descriptor 收进两个按用户意图分组的
语义工具：`nomi_generation_plan`（context/create/patch/preview）与
`nomi_generation_status`（read/cancel/reconcile）。canonical capability、MCP
wire 名称和 Host 的持久化/审批 owner 不迁移；模型只看到语义 projection。

## 本片范围

- 新增 `modelToolSurfaceManifest` 的语义 descriptor 类型、schema、risk、capabilityRefs 和 Host-only 清单。
- generation 模型 projection 从 9 个旧 descriptor 收敛为 2 个语义 descriptor；普通 generation 任务保持不超过 10 个工具。
- semantic call 在现有 generation Host adapter 内翻译到 canonical planning seam；不新增 provider、store、renderer 状态或第二条 effect 路径。
- 将 generation capability 的 primary Pi alias 改为语义名，旧 wire alias 仅保留为内部/MCP 兼容解析，不回投模型。

## 明确不做

- 不删除 `generationAi*` 画布态；C9 三断言仍由后续 Host projection handoff 片收口。
- 不退役 ProductionRun legacy-playbook writer；本片只保留其 M2 红灯证据。
- 不实现 Context/Compaction、Deferred Loading、额外供应商或 UI 改造。
- 不启用 `agentHostEnabled`，不改预算/断言基线。

## 回滚与验收

回滚边界是本片新增 manifest/adapter projection 与 generation capability alias 变更；
canonical MCP routes、ProductionRun、generationAi* 和 Host policy 保持可独立回退。

- 旧 50 个模型 descriptor 的 generation 子集不再出现；Host-only gate 不在模型 projection。
- manifest descriptor 均有 intent/capabilityRefs/risk/effect/schema，且 semantic operation schema 映射到同一 planning seam。
- focused Vitest：先记录旧 projection 红态，再验证 semantic manifest、policy、adapter 和 registry。
- `check:root-cause-contracts`、`check:secrets`、受影响 gates 与失败 delta 相对 `origin/main` 为 0。
- ClawArena/OrchBench 自查：多模态产物不坍缩（N/A，本片只投影引用）；阶段旧信念复查（N/A，无 summary 迁移）；关键 ID/receipt/预算不丢（由既有 Host/adapter 测试覆盖）。
