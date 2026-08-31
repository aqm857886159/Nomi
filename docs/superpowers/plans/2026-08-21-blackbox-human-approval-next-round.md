# 下一轮黑盒生产测试：子 Agent 模拟用户，主 Agent 只观测

## 这轮要证明什么

上一轮真实供应商片已经证明了媒体质量问题可以被抽帧和音频证据抓出来，但没有证明 Nomi 设计的生产流程真的被走通。本轮先不追求“赶快再生成一条片”，而是证明下面这条真实用户旅程能不能在不走旁路的情况下完成：

```text
外部 Agent 输入创作意图
  → 方向候选
  → 人类选择方向
  → 剧本候选
  → 人类审阅/修改/批准
  → 分镜候选
  → 人类审阅/修改/批准
  → materialize 到 Nomi 画布
  → 用户确认批量生成
  → 逐镜生成/QA/定向重试
  → 时间轴、字幕、转场、音频
  → 项目内可恢复的粗剪导出
```

这条链的“人类”由子 Agent 模拟，但子 Agent 只能执行用户动作：输入自然语言、点击候选、批准、要求修改、确认批量生成和确认导出。它不能写 run JSON、不能伪造 artifact、不能直接调 provider、不能修改 `pass` 字段、不能用 FFmpeg 代替 Nomi 的生产导出。

主 Agent 的角色是观察员和评测器：订阅/读取 MCP 与 ProductionRun 的事件，记录轨迹，计算指标，抽取真实媒体帧和音频证据，最后判断流程在哪个节点断掉。主 Agent 不替用户做决定。

## 明确禁止的旁路

- 不再把 `scripts/benchmarks/run-real-30s-continuity-film.mjs` 当产品流程；它只保留为上一轮媒体基准。
- 测试中不能直接 `invoke('generate')`、不能直接调用 `image_to_video`、不能自行写 `run.json` 或 approved artifact。
- 不能由主 Agent 直接拼写剧本/StoryboardPlan 并写入项目来“制造输入”。剧本和分镜必须由真实 planner seam 产出。
- 不能把 `approved`、`pass`、`verdict` 写进证据后再读回来当作评测结果。审批是子 Agent 动作，质量 verdict 必须来自真实帧/音频审查。
- 不能用统一 `cut`/`fade` 数量冒充真实转场；时间轴必须保存有明确类型和可渲染证据。

## 子 Agent 的可用动作

子 Agent 只允许调用以下两类接口：

1. **读取**：获取项目、run、artifact、待审卡片、事件和安全的预览深链。
2. **用户动作**：提交创作意图；选择方向；批准或要求修订剧本；批准或要求修订分镜；确认 materialize；确认生成；接受/拒绝 QA 结果；确认导出。

每一个写动作都必须有 `actor: subagent-human-sim`、`decisionId` 和自然语言理由。它不能调用 renderer、provider 或文件系统写入 API。若候选缺失、状态错误或版本过期，子 Agent 必须记录为用户所见的失败，不能自己修复状态。

## 主 Agent 轨迹格式

每个事件写入一个 append-only JSONL（只保存安全投影，不保存 key、完整 provider URL 或本地绝对路径）：

```json
{
  "seq": 12,
  "at": "2026-08-21T...Z",
  "actor": "subagent-human-sim|main-observer",
  "surface": "mcp-external|canvas-agent-internal",
  "action": "nomi_review_artifact|production.storyboard.materialize|...",
  "inputHash": "sha256:...",
  "projectId": "...",
  "runId": "...",
  "artifactId": "...",
  "artifactVersion": 2,
  "before": {"runStatus":"awaiting_script_review"},
  "decision": "approve|request_revision|confirm|observe",
  "outcome": "accepted|rejected|stale|failed|pending",
  "after": {"runStatus":"awaiting_storyboard_review"},
  "provider": {"model":"redacted", "jobId":"..."},
  "evidence": ["nomi://project/..."],
  "reason": "用户可读的一句话"
}
```

轨迹必须能回答：谁在什么时候看到了什么、做了什么决定、状态如何变化、产物版本是否对应、失败是否能恢复。

## 指标（主 Agent 计算，不能由候选自报）

### 流程完整性

- `review_gate_coverage`：方向、剧本、分镜、materialize、批量生成、QA、导出各有真实人类动作；缺一个即失败。
- `artifact_provenance_rate`：被采用的剧本/分镜/样片都能回指 source artifact、version、content hash、decision event。
- `bypass_count`：直接 provider 调用、外部写 artifact、无审批落画布等旁路次数，目标为 0。
- `recovery_rate`：关闭/重新打开项目后，仍能从项目内找到剧本、分镜、生成任务、QA、时间轴、导出。

### 体验与交互

- `time_to_first_review`：用户输入到第一次需要做决定的时间。
- `decision_load`：用户真正需要决定的次数；同一问题不能反复确认。
- `stale_explanation_rate`：版本过期时是否解释清楚并提供可行动入口。
- `external_to_nomi_handoff_rate`：外部 Agent 产物是否自动出现在 Nomi 项目，而不是要求用户复制粘贴。

### 成片质量

- `narrative_causality`：每镜都有目标—动作—可见结果；边界有因果交接。
- `continuity_pass_rate`：抽帧三联图中空间、角色状态、关键道具连续的边界比例。
- `subtitle_sync`：字幕来自分镜/脚本，数量、时间和画面对白对应。
- `transition_render_rate`：明确声明的非 cut 转场在最终媒体中确实可见。
- `audio_audibility`：真实音频轨可听，有旁白 cue、波形和非静音统计。

## 真实测试步骤

1. 主 Agent 建立空项目和 trace；不写内容 artifact。
2. 子 Agent 输入一句自然语言需求，例如“雨夜里有人捡到一张画着门的湿纸条，进入创作室，把它变成一条完整的 30 秒短片”。
3. 子 Agent 读取方向候选，选择一个并记录理由；若没有候选，测试失败。
4. 子 Agent 审阅剧本：批准、要求一次具体修订，或拒绝；不直接改文件。
5. 子 Agent 审阅分镜：检查故事目标、镜头因果、字幕、转场、首尾状态；批准或要求修订。
6. 子 Agent 通过统一 materialize seam 确认落画布；主 Agent 检查节点 metadata 与 artifact provenance 守恒。
7. 子 Agent 确认批量生成；主 Agent 只观察 job、provider model、retry lineage 和预算。
8. 生成完成后，主 Agent 对真实视频做 ffprobe、抽帧、边界三联图、音频波形和字幕解析；质量不合格时，子 Agent 只针对红镜头发起 retry/decision。
9. 子 Agent 确认导出；主 Agent 关闭项目后重新打开，验证所有产物仍可发现。
10. 只有流程指标和媒体指标都过，才把这一轮片标成通过；否则记录根因并进入下一轮。

## 根因分类与迭代规则

- **流程旁路**：事件中出现直接 provider/文件写入 → 修 MCP/ProductionRun seam，不改 prompt 掩盖。
- **审批缺失**：状态从 candidate 跳 adopted → 修 gate/reducer/UI action，不手动补 approved。
- **信息蒸发**：计划字段存在但 job/node/request 没有 → 做字段守恒对账，修 converter/renderer/driver。
- **故事拼接**：镜头各自漂亮但无目标—动作—结果 → 修 planner schema 和 review checklist，再重生红镜头。
- **媒体伪通过**：静音、字幕越界、cut 被算成转场 → 修真实导出和验收合同，不改 verdict。
- **重启丢失**：项目重开后 run 卡住或产物不可见 → 修 durable state/recovery 和 artifact projection。

每次迭代必须保留上一轮 trace、失败证据和媒体，不能覆盖；下一轮只修改导致失败的 seam，并重新跑同一套指标。

## 通过门槛

- `bypass_count = 0`
- 所有设计中的审阅节点均有子 Agent 决策事件
- 采用 artifact 的 provenance/hash/version 完整且可回读
- 关闭重开后项目产物完整可发现
- 30 秒左右 MP4：视频、音频、字幕均在同一时长内；音频可听；至少两个明确可见的非 cut 转场
- 每个镜头和每个边界都有真实抽帧证据；无人工“先写 pass 再断言”的假绿

如果真实黑盒链在 renderer/UI 环节无法继续，结果必须明确标成 `blocked_at_real_seam`，同时保留已执行的工具调用和用户可见错误；不能退回上一轮手写脚本来宣称通过。
