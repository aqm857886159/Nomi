# External Agent 单一审批面黑盒红测

## 目的

当 run 的来源是 Codex、Claude Code、WorkBuddy 等外部 Agent 时，用户的正常审批入口只能是当前 Agent 的 MCP elicitation：创意/生产门走 `nomi_decide_gate`，剧本/分镜走 `nomi_review_artifact`，粗剪和最终导出走一次 `nomi_approve_rough_cut`。Nomi 桌面端仍可展示只读进度；只有用户明确接管或处理 provider 恢复时，才允许出现 desktop click。

这条边界与 Nomi-origin 的 GUI 回归是两条不同旅程，不能把“在 Nomi 里点过确认”当作外部 Agent UX 已通过。供应商恢复也有 `nomi_reconcile_job`，只有用户明确接管时才需要 DOM。

## 黑盒检查点

`tests/ux/production-mcp-journey.e2e.mjs` 支持 `NOMI_EXTERNAL_AGENT_ONLY=1`。该开关不改变 ProductionRun、dispatcher 或 provider；它只让主观察器在真实 Electron + MCP fixture 结束时对 append-only trajectory 做 fail-closed 检查：

- `direction-choice` / `direction-approve`；
- `approve-script` / `approve-storyboard` / `materialize-confirm`；
- `contract-approve`、`sample-approve`、`shot-N-approve`；
- `rough-cut-and-export`（一次确认同时完成粗剪确认和最终导出）。

以上控制只要以 `surface: "desktop-click"` 出现，就记录为外部单一审批面违规。`takeover-*`、`reconcile-*` 等显式接管/恢复动作不在违规集合内。

证据只来自 trajectory；测试不读写 `run.json`，不补写 `approved`，不调用低层 generate。

## 历史 RED 与修复后的 GREEN 证据

第一轮黑盒曾经故意保留旧的 `approveCurrentProductionGate(window, …)`，得到 RED：外部 run 的方向、合同、样片、逐镜和导出审批会落到 Nomi DOM。这个 RED 证明了“有 MCP 工具”并不等于“用户真的可以留在 Agent 里完成确认”。

运行（`NOMI_EXTERNAL_STOP_BEFORE_MEDIA=1` 会在 materialize 后立即结束，绝不进入 contract/provider/media）：

```bash
NOMI_EXTERNAL_AGENT_ONLY=1 \
NOMI_EXTERNAL_STOP_BEFORE_MEDIA=1 \
NOMI_TRAJECTORY_OUT=/tmp/nomi-task5-external-red.jsonl \
NOMI_SCRIPT_CONTENT='外部 Agent 生成的剧本正文' \
NOMI_STORYBOARD_PLAN_JSON='<外部 Agent 生成的结构化 StoryboardPlan JSON>' \
node tests/ux/production-mcp-journey.e2e.mjs
```

历史 RED 实跑结果：

```text
PRODUCTION MCP E2E FAIL: external-agent-only run has no normal-path desktop-click approvals (found 2)
```

这两个违规分别是方向卡选择和方向确认的 DOM click；同一轮轨迹保存在
`/tmp/nomi-task5-external-red.jsonl`。测试在 materialize 后停止，没有 contract、provider 或媒体调用。

修复后的同类零额度黑盒实跑已经 GREEN。命令仍在 materialize 后停止，因此不花媒体额度：

```text
external-agent-only surface GREEN: Run <run-id>; media generation intentionally not started
```

实跑输出：

```text
external-agent-only run has no normal-path desktop-click approvals (found 0)
external-agent-only surface GREEN: Run run-1564f65d-ecac-4f4d-a224-ed1f064371ce; media generation intentionally not started
```

证据轨迹：`/tmp/nomi-task5-external-green4.jsonl`。该轮是真 Electron + 真 MCP stdio + 真项目目录；完成方向选择、剧本审阅、分镜审阅、落画布，正常审批的 desktop click 数为 0。`materialize` 是执行动作，不是额外的人审节点。

## 合同单测

`tests/production/external-agent-single-surface.test.mjs` 直接验证证据合同：

- Codex 外部来源的 normal approval desktop click 会被拒绝；
- MCP elicitation 以及明确 takeover/recovery click 会被接受。

`validateProductionTrajectory` 已在外部来源上接入这条检查；Nomi-origin 的旧 GUI fixture 通过 `originHost: "nomi"` 保持独立回归。

## 当前产品语义

1. 外部 Agent 等待 gate 时接收 elicitation，读取安全投影后调用 `nomi_decide_gate`；
2. 剧本和分镜仍各有一次审阅：分镜必须建立在已批准剧本上，合并会让用户批准一个还没看过的分镜；但 Nomi 不再重复弹同一确认；
3. 冻结与 QA 是自动内部门：它们仍留在 Run 事件和审计里，但默认不打断用户；
4. 默认不逐镜打断。样片或 QA 发现异常时才出现 shot gate；`confirm_all` 仍可用于逐镜审查；
5. 粗剪与最终导出合并为一次 Agent 确认。供应商对账也在 Agent 里完成；GUI 只保留用户明确要求的 takeover，不能作为外部正常路径的第二套审批面。

## 仍需单独验证的部分

上面的 GREEN 只证明“审批面”闭环，不声称媒体质量已经通过。真实 30 秒媒体 run 还要用同一套 MCP-only gate 走完 provider、QA、粗剪和导出，并对最终 MP4 做抽帧、切点、字幕和音频检查；任何白帧、静音、字幕越界或硬切都要回到根因修复后重新实跑。
