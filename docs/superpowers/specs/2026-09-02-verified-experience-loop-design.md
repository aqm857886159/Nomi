# Verified Experience Loop 设计规格

## 目标

Nomi 在一轮对话结束后，自动从“真实问题 → 尝试解决 → 可验证结果”的轨迹中提炼可复用经验，并把它放到正确的长期载体。系统不把确认责任推给用户，也不因为一次漂亮的回答就污染长期知识：机器证据是激活闸门，无法证明时进入隔离区，产品主流程继续运行。

## 现状与边界

- Agent 运行时由 canonical `ProjectAgentHost` 管理；Host 在 `async.result` 提交并确认终态后异步触发经验完成旁路。旧 `agentChatV2Ipc` trace 不是本闭环的生产入口。
- 会话持久化仍按 `creation|generation` 分区；本功能只消费一轮已完成轨迹，不改变两个 area 的历史边界。
- `electron/memory/projectMemory.ts` 是现有事实记忆的物化视图。本功能不会绕过它直接改 `memory.json`，而是通过明确的投影入口写入事件/事实。
- 默认不上传、不调用远端训练服务、不把完整对话发出本机。候选的来源文本在本地经过脱敏、长度限制和哈希；未来接入本地或用户已配置的模型时，只替换 extractor，不改变证据闸门。

## 核心对象

### 1. 轨迹（Trajectory）

只保存完成判定所需的最小字段：会话/项目/线程身份、用户问题摘要、助手结果摘要、工具调用结果、错误/拒绝、持久化效果、验证结果和时间。原文不进 EventLog；摘要由统一 redact+truncate 函数生成，重复轨迹以 `trajectoryId` 幂等。

### 2. 候选（Experience Candidate）

候选包含：

- `kind`: `fact | procedure | troubleshooting | invariant | decision | training-example`
- `destination`: `memory | skill | runbook | gate | adr | training-data | incident`
- `scope`: `project | global`（默认 project，跨项目必须有独立证据）
- `risk`: `green | yellow | red`
- `evidence`: 问题、行动、结果、验证四段以及引用的 EventLog seq
- `status`: `quarantined | active | shadow | demoted | superseded`
- `confidence`, `reuseCount`, `failureCount`, `lastVerifiedAt`, `expiresAt`

### 3. 证据闸门

候选必须同时有问题信号、解决动作和结果验证。只有“回答了一个问题”或“模型自己说已经解决”都不算证据。

- **green**：稳定事实/约束，来源明确、风险低、项目内一次验证通过 → 直接激活到 project memory。
- **yellow**：可复用步骤、偏好或排障经验，需一次完整解决轨迹但仍有泛化不确定性 → `shadow`，两次独立成功或回归测试通过后激活。
- **red**：会改变代码、架构、共享门岗、训练数据或跨项目知识 → `quarantined`，只生成候选和审计事件；只有独立验证和人工可审阅的 PR 流程才能进入工程资产。运行时不自动改生产代码。

缺少任一证据时只写 `incident`（不进入长期记忆），并给出缺口原因；不弹窗阻塞当前用户。

## 自动生命周期

`candidate → quarantined|active|shadow → reused → promoted|demoted|superseded|expired`。

- 相同 `contentHash` 在同一 scope 幂等合并，不重复写入。
- shadow 候选两次不同 `trajectoryId` 的成功复用，或一个明确通过的回归检查，才晋级。
- 任何三次失败、一次明确矛盾证据或过期时间到达，自动降级/停用，并保留原因和溯源。
- promoted 只改变本地投影，不删除原始事件；删除/回滚靠追加事件恢复。

## 路由规则

| 候选形态 | 去向 | 默认状态 |
|---|---|---|
| 稳定事实、项目约束、用户偏好 | 现有 project memory 投影 | active（green） |
| 可重复执行的步骤 | Skill 候选 | shadow（yellow） |
| 供应商/平台故障与恢复步骤 | Runbook 候选 | shadow（yellow） |
| 可机械检测的重复缺陷/不变量 | Gate/Test 候选 | quarantined（red） |
| 架构取舍及原因 | ADR 候选 | quarantined（red） |
| 脱敏后的成功/失败样本 | training-data 候选 | quarantined（red） |
| 证据不足或未解决问题 | Incident | active 但不参与提示词 |

Git 不是知识类型，而是 red 候选的交付载体；本 PR 只实现安全候选与状态机，不在用户对话结束时自动 push/merge。

## 触发与失败策略

Host 在已提交的 terminal turn 后调用 `completeProjectAgentExperience`。它先追加 bounded `agent.turn.finished` EventLog receipt，再异步运行 repository；所有异常只记 warning，不阻塞或改变回答。重启后可从 EventLog 重放，处理使用 `trajectoryId` 幂等。当前 extractor 仍要求显式 envelope 和其引用的真实 EventLog seq。

## 隐私与数据治理

- 默认 local-only；候选正文只写项目 `.nomi/experience/`，并经过 `redactDeep`、摘要长度上限和哈希。
- 不收集 API key、文件路径、原始附件、完整对话；training-data 候选必须显式带 `consent: true` 才能导出，当前实现只保存隔离记录。
- project scope 不跨项目检索；global 候选必须由晋级器在多项目独立证据后产生，当前不自动晋级 global。
- 事件日志是事实来源，JSON 是可重建投影；删除投影不删除审计证据，回滚用追加事件。

## 可验证完成标准

1. 缺问题/动作/验证任一项时不会激活长期知识。
2. green 候选直接进入 memory，yellow 先 shadow，red 永不直接改生产资产。
3. 复用成功可晋级；三次失败、矛盾或过期可自动降级且留溯源。
4. 同一轨迹重复处理只产生一个候选；崩溃/损坏投影可从 EventLog 重建。
5. 敏感字段被脱敏，超长文本被截断，默认不出本机。
6. 会话完成旁路失败不影响 Agent `result`/`done`。
