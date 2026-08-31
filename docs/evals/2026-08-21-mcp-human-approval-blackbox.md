# MCP / ProductionRun 黑盒下一轮测试合同

## 目的

这份合同约束下一轮真实测试的入口：脚本不能自行写 `run.json`、把 artifact 标成 `approved`，也不能直接调用低层 `generate`。测试只允许通过真正的 MCP stdio server 驱动 Nomi 的 ProductionRun；子 agent 只模拟人类在方向门、剧本审阅、分镜审阅和确认门上的点击。

## 黑盒调用顺序

1. `initialize`：clientInfo 写真实宿主（Codex / Claude Code / WorkBuddy），声明 `elicitation`。
2. `tools/list`、`resources/list`、按需 `resources/read`：读取 Nomi 的导演/编剧技能，不把技能正文硬编码到测试脚本。
3. `nomi_create_project`（或读取已有 `projectId`）。
4. `nomi_start_playbook`：传 `projectId`、已注册的 `playbook`、真实 brief 和 `durationSeconds: 30`。检查返回 `runId`、`status=awaiting_direction`、`budget.authorized=0`。
5. `nomi_get_run` + `nomi_subscribe_run`：等待 `gate-direction-v1` 的候选。子 agent 只从返回的 `directionCandidates` 中选择一项，然后调用 `nomi_decide_gate`。该工具由协议层先发 `elicitation/create`，只有子 agent 返回 `accept + confirm=true` 才会调用服务端；检查 `gate.decided` 和 `decidedChoiceKey`。
6. 等待 `awaiting_script_review`。使用 `nomi_get_run` 定位候选 script，再用 `nomi_read_artifact` 读取内容、版本和 hash。子 agent 模拟用户审阅，调用 `nomi_review_artifact`（`expectedVersion` 必须等于刚读到的版本）。检查 `artifact.adopted`；批准后才允许服务端异步拟分镜。
7. 等待 `awaiting_storyboard_review`。同样用 `nomi_read_artifact` 读取分镜；子 agent 确认后调用 `nomi_review_artifact`。检查分镜的 source script artifact/version/hash 未漂移。
8. 调用 `nomi_materialize_storyboard`，传刚读到的 `artifactId + expectedVersion`。服务端必须自己校验 adopted、剧本来源新鲜度，然后调用 renderer 的 `production.materialize-storyboard`，通过 `plan.attach` 建立真实 Production jobs、模型绑定和预算合同。检查返回的 canvas node IDs、binding 数和 `nomi://project/.../run/...` 深链。
9. 本测试到 materialize 为止，不调用任何 provider，也不调用低层 `generate`。媒体轮次另行从真实预算/样片/逐镜门开始。

## 主 agent 轨迹记录

每一次黑盒 RPC 和 server→client elicitation 都写一条独立 trajectory 记录；不修改 Run 快照、不伪造 artifact。至少保存：

```json
{
  "seq": 12,
  "at": "2026-08-21T00:00:00.000Z",
  "actor": "subagent",
  "surface": "mcp-stdio",
  "tool": "nomi_review_artifact",
  "args": { "projectId": "…", "runId": "…", "artifactId": "…", "expectedVersion": 1, "decision": "approved" },
  "before": { "status": "awaiting_script_review", "artifactVersion": 1, "eventCursor": 9 },
  "elicitation": { "shown": false },
  "result": { "isError": false, "kind": "artifact_review" },
  "after": { "status": "awaiting_storyboard_review", "eventCursor": 12 },
  "decision": { "kind": "script_review", "choice": "approved", "reason": "subagent user simulation" }
}
```

`nomi_subscribe_run` 是 durable 事实源：把 `afterCursor` 从上条记录的 cursor 继续递进，核对 `run.created`、`gate.candidates`、`gate.decided`、`plan.proposed`、`artifact.adopted`、`skill.loaded`、`plan.attached`。MCP 返回的结构化 outcome 只作模型转述，不替代事件流。

## 真实当前缺口

- `nomi_review_artifact` 不像 `nomi_decide_gate` 那样强制弹 `elicitation/create`。因此它可以作为「子 agent 模拟用户审阅点击」的写入口，但主 agent 必须记录它读过哪个版本、看过什么内容和做了什么决定。
- Nomi GUI 的 `review-script` 主动作只切到 Creation，没有独立脚本批准按钮；正式批准目前通过 `nomi_review_artifact` / ProductionRun command。Storyboard 编辑器的确认按钮会走 `artifact.review` + `materializeStoryboard`，因此两处不能被同一个“已批准”字段冒充。
- 现有 `tests/ux/production-mcp-journey.e2e.mjs` 已起真 Electron、真 MCP stdio 和 GUI fixture，但脚本/分镜审批未保存子 agent 轨迹，fixture 也会生成本地媒体；不能把它当作本次真实媒体验收。
- Run 事件包含 `commandId`、`decidedChoiceKey`、artifact 状态和 cursor，但没有审阅 actor/reason。actor/reason 应只写入外部 trajectory，不能篡改 ProductionRun 事实模型。

## 当前红灯

`tests/production/no-handwritten-production-run.test.mjs` 会扫描旧生成脚本，拒绝：

- 直接 `writeJson(...run.json)`；
- 自己写 `reviewStatus: 'approved'`；
- 把手写状态标成 `source: 'external-mcp'`；
- 直接 `invoke('generate')` 绕过 ProductionRun。

在旧入口移除前，该测试必须保持失败；“测试能跑”不能被当成“黑盒流程通过”。

## 本轮真实桌面黑盒结果（先停在媒体质量之前）

已实际启动构建后的 Electron、独立 MCP stdio 进程和 Playwright GUI，子 Agent 只做点击/确认，主 Agent 只记录轨迹。该轮使用 `NOMI_E2E_PRODUCTION_FIXTURE=1`，因此它证明的是协议、状态、画布落地和审阅交互，不证明新模型画面质量。

- 66 条桌面旅程断言通过；真实 MCP 工具目录为 22 个。
- 79 条 append-only JSONL 轨迹；17 个用户决策控件全部覆盖。
- 看到的状态：`awaiting_direction` → `awaiting_script_review` → `awaiting_storyboard_review` → `awaiting_contract` → `running` → `awaiting_rough_cut_review` → `awaiting_export` → `completed`。
- 子 Agent 决策覆盖率：17/17 = 100%。
- 主观察器记录的直接 provider 旁路：0；主观察器写 artifact/审批状态：0。
- materialize 返回 8 个画布生产 job，并核对字幕与对象形式的转场 metadata 没有蒸发。
- 轨迹原件：`outputs/2026-08-21-mcp-human-simulator-trajectory.jsonl`（临时 E2E 只保存安全投影，不含 key、完整 prompt 或 provider URL）。

因此，这一轮证明了“设计的审阅节点和外部 MCP → Nomi 画布闭环”在真实桌面入口可以走通；还没有把它误报成“30 秒真实片已通过”。下一轮必须用同一条序列、同一份轨迹合同，再接上真实 provider 和抽帧/音频证据。
