# Nomi 统一运行时交接文档

> 用途：把本轮已经确定的产品目标、方案层级、执行顺序和真实状态交给下一轮对话。  
> 方案工作树：`/Users/aoqimin/Desktop/Nomi-unified-runtime-design`  
> 分支：`codex/mcp-runtime-plan-hardening`  
> 当前提交：`e706b4e7`（docs-only hardening）  
> 状态：方案已归一；运行时代码尚未实现；PhaseEvidence = `blocked`

## 0. 先记住这一句话

Nomi 要做的不是“再造一套 MCP 协议”，而是让用户留在自己正在使用的 AI 软件里，就能安全地调用 Nomi 当前项目完成一次视频生成：

```text
读 Nomi 项目上下文
→ 提出一镜计划
→ 看预览、成本和目标
→ 在 Nomi 界面或被调用的、已登记的外部软件界面确认
→ Nomi 验证确认并只提交一次
→ 进度/取消/断线恢复
→ Artifact 回到正确项目
```

用户不应被强行拉回 Nomi 界面。**默认把一次确认放在用户正在使用的、已登记且可验证的外部软件里；客户端做不到时，才用 Nomi GUI 兜底。**普通的
`confirm: true`、MCP elicitation 返回值或旧 `spendConfirmed` 不能直接当作真人凭证。
外部客户端必须预先登记并能证明这次真实用户操作；Nomi 主进程负责验证并签发一次性审批凭证。
一次确认要同时说明当前项目、模型、成本和本次生成目标；客户端确认成功后，Nomi 不应再次要求用户点击第二次。

这条用户体验取舍的完整设计和相似摩擦审计见：
`docs/superpowers/specs/2026-08-23-mcp-client-first-authorization-design.md`、
`docs/audit/2026-08-23-mcp-client-authorization-friction-audit.md`、
`docs/superpowers/plans/2026-08-23-mcp-client-first-authorization.md`。

## 1. 唯一方案层级

不要把下面文件当成多套并行方案：

```text
最终用户价值
  ↓
中文总路线（P0–P7：先后顺序和产品边界）
  ↓
Ownership ADR（谁拥有真相、哪些规则不可违反）
  ↓
英文 Vertical Slice（P0–P3 的逐文件施工合同，Task 0–7）
  ↓
PhaseEvidence（测试、真实旅程、六角色、对抗评审决定是否放行）
```

唯一入口：

- 中文路线：`docs/superpowers/plans/2026-08-22-nomi-unified-editor-runtime.md`
- 所有权 ADR：`docs/superpowers/specs/2026-08-22-runtime-ownership-adr.md`
- 详细设计参考：`docs/superpowers/specs/2026-08-22-unified-runtime-mcp-generation-design.md`
- 当前施工合同：`docs/superpowers/plans/2026-08-22-mcp-ai-generation-vertical-slice.md`
- 放行账：`docs/audit/2026-08-22-mcp-generation-phase-evidence.md`

已废止或仅作参考：

- `2026-08-22-external-agent-runtime-mcp-control-plane.md`：已标记 `superseded`，不建第二个 Operation/EventStore。
- `2026-08-21` 及更早的大方案：保留产品想法、用户任务和验收素材，但不再作为当前施工顺序。
- `2026-06-11-nomi-harness-master-plan.md`：历史资料，不能重新建立 per-project EventLog/NomiEvent owner。

## 2. 产品路线 P0–P7

| 阶段 | 要做的事 | 用户价值 | 放行条件 |
|---|---|---|---|
| P0 | 干净基线、唯一 owner、ADR、旧入口隔离、feature flag | 不会出现第二套 Run/资产/审批，也不会误花钱 | 基线、六角色、对抗检查通过 |
| P1 | 已登记模块、工具白名单、Skill/Asset/Runtime 边界 | 外部软件只能调用 Nomi 明确允许的能力 | 未知模块/工具/资产 fail-closed；付费前无网络 |
| P2 | `PlanCandidate → ExecutionContract`，冻结模型/素材/成本/参数 | 预览看到的就是实际执行内容 | 字段守恒、hash 稳定；没有合同不能 submit |
| P3 | MCP 单镜闭环：计划、预览、确认、一次提交、进度、恢复、Artifact | 用户可在调用软件里完成一次可靠生成 | 确认前 0 次 provider；成功后 1 次提交、1 个 Artifact |
| P4 | 恢复、有限并发、波次和局部重试 | 长任务不丢失、不重复扣费 | 503/崩溃/迟到回调/unknown 都可恢复 |
| P5 | `Artifact → EditProposal → Apply/Undo` | 用户决定是否把结果放进时间轴，并可撤销 | stale revision、伪造 lineage、原子 apply 都通过 |
| P6 | 音频、审片、参考图、HyperFrames/Remotion 独立模块 | 扩展能力不污染核心运行时 | 每个模块单独 sandbox、预览/导出对账 |
| P7 | 多镜头、完整 Editor/Timeline、Agent Workbench、Recipes | 完整 AI 视频创作工作台 | P3–P5 已证明内核可靠后再启动 |

P3 之前不做完整 Timeline v2、自动落轴、多镜头短剧、完整宣传片、生产渲染器或第二套 Agent 执行路径。

## 3. 第一批施工合同：Task 0–7

Task 与阶段对应关系：`Task 0 ≈ P0`，`Task 1 ≈ P1`，`Task 2 ≈ P2`，`Task 3–6 = P3`，`Task 7 = P0–P3 收口审查`。

### Task 0：地基和闸门

- 在干净 sibling worktree 记录真实代码基线。
- 固定 Runtime、ProductionRun、Asset、Canvas/Timeline 的唯一 owner。
- 固定 receipt、lease、旧入口、feature flag 和回滚规则。
- 先做失败测试和六角色/对抗设计 checkpoint。
- **不能调用 provider，不能写付费路径。**

### Task 1：可信能力目录

- 建 hash 固定的 ModuleManifest/registry。
- 工具、能力、输入、输出、副作用全部有白名单。
- Skill 文本不能扩权；用户目录/远程安装不能成为 P3 authority。

### Task 2：执行合同

- 编译 `PlanCandidate → ExecutionContractV1`。
- 把合同绑定到现有 `ProductionJob`/`RuntimeTask`，不新建第二个 GenerationJob owner。
- 补 Runtime envelope、Run intent/WAL、锁、迁移和字段守恒测试。
- 此阶段仍不得调用 provider。

### Task 3：只读规划和预览

- 实现项目上下文、draft create/reuse、plan submit、preview、阶段权限。
- `context/read` 必须纯读；唯一创建 draft 的入口是 `operation/create`。
- 计划阶段 `providerCalls = 0`。

### Task 4：审批和一次提交

- 实现 typed challenge/receipt、reservation、spend grant 和唯一 P3 provider adapter。
- 支持两条正向确认路径：**已登记并可验证的外部软件界面优先**；Nomi GUI 使用同一 challenge 兜底。
- 连接动作只建立客户端身份；只读上下文复用当前项目 lease；第一次 generation_submit 将项目范围与生成审批组合成一次确认。
- 同一 session/contract 的预览、进度、取消、重连和 reconcile 不再次确认；项目、scope、价格或合同实质变化才重新确认。
- 同时测试三类失败：普通外部 `confirm:true`、未登记客户端、重放/跨项目/错误任务。
- 成功路径只能产生一个 provider job；支持 poll、cancel、reconcile、restart。

### Task 5：Artifact

- 持久化内容、来源、合同和任务 provenance。
- 生成 proposal-ready 状态，但不自动修改时间轴。
- 测试重复回调、重复下载、重启和确定性 materialization。

### Task 6：真实旅程

- In-process MCP contract journey。
- 零额度 fake provider。
- 真实 Electron stdio/外部 MCP host。
- 断线、重启、503、submission unknown、重复回调和跨项目拒绝。
- 真实 provider smoke 只能单独标记、受 feature flag 和成本上限控制。

### Task 7：最终收口

- 填 PhaseEvidence：commit、输入 hash、命令、旅程产物、截图/媒体、成本 receipt、rollbackRef。
- 六角色评审：CTO、PM、设计、前端、后端、真实用户。
- 独立对抗评审：伪造审批、跨项目、重复扣费、旧入口、恶意 Skill、WAL 崩溃恢复。
- 任一 P0/P1 未通过就保持 `blocked`，不进入下一阶段。

## 4. 当前真实状态

已经完成：

- 旧大方案被归一为 P0–P7。
- P0–P3 被拆成 Task 0–7 的逐文件执行计划。
- 主要 owner、审批边界、外部确认语义和后置范围已经写入文档。
- docs-only hardening 提交：`e706b4e7`。

尚未完成：

- 没有新的 MCP/runtime 生产实现。
- 没有 durable receipt、lease store、WAL、provider idempotency 或 materialization 实现。
- 没有真实外部 MCP host 到 Artifact 的可复核旅程。
- 没有正向“已登记外部软件点击确认 → Nomi 铸 receipt → 不二次确认”的 E2E 证据。
- PhaseEvidence 的 P0/P2/P3/final 全部是 `blocked`。

旧基线的 typecheck/test/build 全绿，只说明旧代码基线健康，不能说新方案已经完成。

## 5. 下一轮对话应该直接做什么

1. 先读本文件和四个 canonical 文件，不重新发明第二套方案。
2. 使用干净 implementation sibling worktree，重新记录 `origin/main` 基线。
3. 从 Task 0 的 P0 checkpoint 开始：先补边界/失败测试/证据。
4. P0 未通过前，不写 provider submit、Asset materialization、Pi adapter 或时间轴写入。
5. P3 验收必须明确包含：
   - 已登记外部软件确认成功且不打开 Nomi；
   - 不支持可验证外部确认的客户端由同一 challenge 进入 Nomi GUI，确认一次即可继续；
   - 普通外部确认被拒绝；
   - 任一确认路径都不要求第二次点击。

## 6. 给新对话的启动句

```text
请先阅读：
docs/superpowers/plans/2026-08-22-nomi-runtime-handoff.md

然后按其中唯一路线继续。不要把旧文档当第二套方案，也不要把“用户可在外部软件确认”改回“必须回 Nomi 界面”。当前只从 Task 0/P0 开始，先给出本轮要写的失败测试和放行标准；不要直接进入 provider 或付费代码。
```
