# Nomi Agentic Execution：核心概念说明

> 这份文档解释 Nomi“固定 Runtime 骨架 + 动态模块组合 + ExecutionContract 冻结”方案中的核心概念，也解释外部 Claude Code、Codex、Cursor 等客户端通过 CLI / MCP 驱动 Nomi 时，各层分别负责什么。
>
> 一句话总结：**模型负责提出方案，Nomi Runtime 负责验证、授权、执行、恢复和记录事实。**

## 1. 先建立整体心智模型

一次典型的 Nomi 生成任务可以抽象为：

```text
用户意图
  ↓
读取项目状态与能力目录
  ↓
Agent 提出 PlanCandidate
  ↓
Runtime 校验、解析参数、估价
  ↓
用户审批生成门
  ↓
冻结 ExecutionContract
  ↓
创建或绑定 ProductionRun
  ↓
提交 Provider 并异步跟踪
  ↓
验证并登记 Artifact
  ↓
提出 EditProposal / AdoptProposal
  ↓
用户确认后，才通过命令入口修改项目
```

这里最重要的边界是：**“想做什么”不等于“已经批准执行”，生成成功也不等于“已经进入时间轴”。**

## 2. 三种真相：意图、执行、项目

“真相”指系统在某一类问题上的唯一可信来源。把不同问题混在一起，会导致审批、恢复和项目状态互相打架。

### 2.1 意图真相：用户想做什么

意图真相描述目标和创作方向，例如：

- 做一张封面；
- 用几张图片做一个轻微动效；
- 把一段口播剪成短视频；
- 把一张图变成有镜头运动的视频。

它通常表现为：

- `Brief`：创作简报，描述目标、受众、风格和限制；
- `StoryboardPlan`：分镜规划；
- `PromptSpec`：结构化提示词规格；
- 用户上下文：已有素材、偏好、项目目标和对话信息。

意图可以被重新规划、修改、比较，但**不能直接触发付费生成、写入时间轴或覆盖项目**。

### 2.2 执行真相：这一次究竟执行什么

执行真相回答“本次请求最终绑定了什么”。它包括：

- 选择了哪个模块；
- 输入是哪一个 Asset 的哪个版本；
- 使用哪个模型和 Provider；
- 解析后的实际请求参数；
- 预计成本、并发和审批要求；
- 如何识别重复提交；
- 输出将产生哪些 Artifact。

核心对象包括：

- `PlanCandidate`：尚未批准的候选计划；
- `DraftExecutionSnapshot`：审批前展示给用户的最终执行预览；
- `ExecutionContract`：审批后冻结的单次执行合同；
- `ProductionContract`：一次生产 Run 的业务目标和预算合同；
- `ProductionRun`：生产任务的耐久状态源；
- `RuntimeTask`：Runtime 当前调度和执行的任务单元。

### 2.3 项目真相：项目现在是什么状态

项目真相记录已经发生并被项目接受的状态，例如：

- 已登记的 `Asset`；
- 已完成并保存的 `Artifact`；
- 当前 Canvas / Timeline；
- 当前项目 `revision`；
- 已采用的剪辑修改和命令收据。

MCP、右侧 Agent、外部 Agent 和聊天记录都不能各自维护一份项目真相。它们只能读取项目状态，或向 Nomi 提交经过校验的请求。

## 3. 固定骨架、动态模块、冻结合同

这套架构不是“所有流程写死”，也不是“模型完全自由发挥”，而是把自由度放在安全边界之内。

### 3.1 固定的执行骨架

由 Nomi Runtime 强制执行、模型不能跳过的部分包括：

- 状态机；
- 权限和工具边界；
- 预算、额度和花费记录；
- 审批规则；
- 幂等和重复提交处理；
- Asset 版本和项目 revision 校验；
- 事件日志；
- Provider 断线、未知状态和恢复；
- Artifact 登记；
- Proposal / Apply / Undo；
- 错误处理和回滚。

这些是“护栏”，不是某一种内容类型的创作流程。

### 3.2 动态选择的部分

模型、Skill、用户上下文和能力目录可以共同决定：

- 选择哪些模块；
- 模块执行顺序；
- 哪些步骤可以并行；
- 是否需要参考图分析；
- 是否需要字幕、音频或动效；
- 选择哪个合法模型；
- 失败后局部重跑哪一部分；
- 是否采用某个 Recipe。

### 3.3 冻结后的部分

动态组合完成后，Nomi 会把候选方案编译成一份本次专属的 `ExecutionContract`：

```text
模型自由提出
  → Runtime 严格验证
  → 合法后冻结
  → 只按冻结结果执行
```

冻结的目的不是限制创作，而是防止“用户批准的是 A，实际执行时因为模型目录、Skill 或上下文刷新变成了 B”。

## 4. Workflow、Recipe、Module 和 Tool 的区别

这几个词都表示“完成事情的方式”，但抽象层级不同。

| 概念 | 它是什么 | 能否直接拥有花费或写项目权限 |
|---|---|---|
| Workflow | 一条完整的阶段流程 | 不应直接拥有权限 |
| Recipe | 常见任务的默认模块组合或推荐路径 | 不应绕过 Runtime |
| Module | 有明确输入、输出和副作用合同的语义能力块 | 由 Runtime 按合同授权 |
| Tool | 执行具体动作的低层接口，例如调用 Provider | 只能在允许范围内被模块使用 |

### 4.1 Workflow 为什么降级为 Recipe

完全固定的 Workflow 容易理解、早期也容易测试，但会逐渐僵化：

- 封面、海报、视频和已有素材剪辑被迫经过同一套阶段；
- 每新增一种任务，就要新增一套流程；
- 模型能力差异会变成大量 `if / else`；
- 时长、音频、首尾帧和参考图数量容易变成硬编码；
- 用户只想做局部动作时，也必须经过完整创作流程。

因此可以保留：

```text
cover.image
narrative.video
edit.existing
motion.graphics
poster.batch
```

但它们只是常用做法的快捷入口，即 `Recipe`，不是整个系统唯一的执行真相。

### 4.2 为什么不开放所有原始 Tool

如果模型直接看到几十个 Provider 或文件操作工具，并自行决定调用顺序，就可能出现：

1. 跳过审批；
2. 先调用 Provider，之后才发现参数不合法；
3. 生成结果未经验证就插入时间轴；
4. 断线重连后重复生成、重复扣费；
5. 工具之间的输入输出不兼容；
6. 从 Skill 文本中误以为自己拥有某项权限；
7. 失败后无法判断应该重试、对账还是重新生成。

所以模型组合的是**受约束的 Module**，而不是无边界的原始函数。

## 5. Module：有合同的语义能力块

`Module` 把一个用户能理解的能力，包装成可以被 Runtime 验证和执行的单元。

例如 `image_to_video` 不是一个裸 HTTP 请求，而是一个会声明完整约束的模块：

- 输入必须是哪种媒体，以及哪个 Asset 版本；
- 是否需要首帧或尾帧；
- 是否支持音频；
- 合法时长范围；
- 是否会花费额度；
- 是否需要审批；
- 失败后能否重试；
- 输出是什么类型的 Artifact；
- 允许使用哪些 Tool。

一个 Module 至少应声明：

```ts
{
  id,
  version,
  contentHash,
  inputs,
  outputs,
  requiredCapabilities,
  allowedTools,
  allowedCommands,
  sideEffectClass,
  approvalPolicy,
  retryPolicy,
  validatorRefs
}
```

字段含义：

- `id`：模块稳定标识，例如 `image_to_video`；
- `version`：模块合同版本；
- `contentHash`：模块内容指纹，用来证明执行时使用的是哪一版模块；
- `inputs` / `outputs`：输入输出的 Schema；
- `requiredCapabilities`：运行前必须具备的能力；
- `allowedTools`：模块可以调用的低层 Tool；
- `allowedCommands`：模块允许提出的项目命令；
- `sideEffectClass`：副作用等级，例如只读、草稿、花费额度、修改项目；
- `approvalPolicy`：需要哪一级人工审批；
- `retryPolicy`：哪些错误可以重试、如何重试；
- `validatorRefs`：执行前后需要运行的校验器。

## 6. Skill、Module、Runtime：三层不能混

### 6.1 Skill：方法和判断

Skill 是指导模型思考和工作的知识，例如：

- 如何做镜头设计；
- 如何判断跨镜头连续性；
- 如何写动态 Prompt；
- 如何检查字幕；
- 什么情况下应该重试；
- 什么情况下应该停止。

Skill 本质上是指导文本，不是安全边界。

### 6.2 Module：能力合同

Module 把某项能力变成可验证的单元，描述输入、输出、工具、命令、副作用、审批和重试规则。

### 6.3 Runtime：权威执行层

Runtime 负责：

- 判断调用是否有权限；
- 校验参数和版本；
- 估价和绑定预算；
- 创建耐久任务；
- 处理 Provider 提交和恢复；
- 登记 Artifact；
- 通过 Proposal / Apply / Undo 修改项目。

因此应保持以下关系：

```text
Skill   = 方法和判断
Module  = 输入输出与副作用合同
Runtime = 权限、状态、预算与恢复
```

Skill 不应直接拥有 Provider 权限、花额度权限、写时间轴权限、导出权限、任意文件系统权限或任意网络权限。外部 Agent、Skill 文本和模型都只能提出候选，最终权限由 Runtime 判断。

## 7. 从 PlanCandidate 到 ExecutionContract

### 7.1 PlanCandidate：候选计划

`PlanCandidate` 是 Agent 根据用户意图、项目上下文和能力目录提出的方案。它可以包含：

- 使用哪些模块；
- 模块的顺序；
- 模块参数；
- 参考图；
- 预计成本；
- 质量要求；
- 可以并行的步骤。

它不是执行命令，也不是审批结果。它可以被修改、比较、拒绝或重新生成。

### 7.2 DraftExecutionSnapshot：审批前预览

Runtime 会把候选计划解析成用户能够核对的 `DraftExecutionSnapshot`，至少应展示：

- 最终使用的模型和 Provider；
- 经过约束后的时长；
- 参考图选择和版本；
- 并发数量；
- 预计成本；
- 能力降级；
- 被丢弃或无法支持的字段；
- 风险和警告；
- 预计生成的 Artifact。

这一步解决的是“模型说了很多，但用户不知道实际会执行什么”的问题。

### 7.3 ExecutionContract：单次执行合同

用户确认后，Runtime 将预览封存为不可变的 `ExecutionContract`。它是一次具体操作的执行绑定，类似拍摄现场的“通告单”。

合同中明确记录：

```text
哪个模块
哪一个输入 Asset 的哪个版本
哪个模型和 Provider
实际请求参数
预计与授权的成本
审批记录及绑定的合同 hash
幂等键和请求指纹
输出 Artifact 的登记方式
```

合同一旦 seal：

- 不能因为模型目录刷新而自动换模型；
- 不能因为 Skill 更新而自动改变步骤；
- 不能因为 Agent 断线重连而重新解析一遍；
- Provider 只能按合同执行；
- 结果必须回写到合同绑定的 Run 和 Artifact。

### 7.4 ProductionContract：一次生产 Run 的业务合同

`ProductionContract` 的粒度比 `ExecutionContract` 更高。它描述一次 Run 的业务目标和边界，例如：

- 这次制作的目标是什么；
- 包含哪些镜头或任务；
- 总预算和支出上限是多少；
- 允许哪些模块和模型；
- 需要哪些人工门；
- 最终需要产生哪些交付物。

一个 Production Run 可以包含多个 ExecutionContract；单个 ExecutionContract 可以对应其中一个镜头或一次具体操作。

## 8. ProductionRun：付费任务的耐久状态源

聊天记录不适合充当付费生成任务的事实源。聊天可能断线、压缩、重连、换客户端、被截断或被重新解释，但生成任务必须持续知道：

```text
Provider 是否已经提交
ProviderTaskId 是什么
是否已经扣费
Artifact 是否已落盘
当前是 polling 还是 unknown
能不能安全重试
哪个项目 revision 发起了任务
```

因此这些状态应放在耐久的 `ProductionRun` / `ProductionJob` 中，而不是只放在聊天上下文里。

不必新造一套平行的 `GenerationJob`。更稳妥的方式是给已有 ProductionRun / Runtime 增加执行绑定字段：

```text
executionBinding
contractHash
moduleRef
inputAssetRefs
requestFingerprint
idempotencyKey
capabilitySnapshot
```

这样可以复用已有的：

- `CAS`；
- `event cursor`；
- `outbox`；
- `budget ledger`；
- approval；
- reconcile；
- cancel；
- restart recovery。

## 9. 持久化和恢复相关概念

### 9.1 Asset 与 Artifact

- `Asset`：项目中登记的输入或中间素材，例如原图、参考图、音频、用户上传的视频；
- `Artifact`：一次执行产生并经过登记的输出，例如生成图、视频、文本或音频。

Asset 强调“可被引用的项目素材”，Artifact 强调“某次执行产生的结果”。一个 Artifact 在被项目采用后，也可以成为后续执行的输入 Asset。

### 9.2 revision：项目版本

`revision` 用来确认某个计划是基于项目的哪个版本提出的。执行时如果输入版本已经变化，Runtime 可以阻止错误覆盖，或要求重新预览和审批。

### 9.3 CAS：内容寻址存储

CAS（Content-Addressed Storage）按内容指纹保存和定位文件。它有助于：

- 避免同一内容重复落盘；
- 让 Artifact 有稳定内容引用；
- 校验文件是否被修改；
- 在断线和重启后重新找到已落盘结果。

### 9.4 event cursor：事件游标

事件游标记录消费者已经读到哪一条持久事件。外部 Agent 或 UI 可以从游标继续订阅，而不是依赖聊天消息是否还在内存中。

### 9.5 outbox：待发送事件箱

Outbox 把“需要发送给外部系统的事件”先持久化，再异步发送。这样即使进程在发送前崩溃，也不会因为内存状态丢失而漏掉事件。

### 9.6 budget ledger：预算账本

预算账本记录预计、授权、实际和返还的额度变化。它必须能回答：

- 本次任务预计花多少；
- 用户批准了多少；
- Provider 实际扣了多少；
- 失败或取消后是否需要对账；
- 是否超过项目或 Run 的支出上限。

### 9.7 idempotencyKey：幂等键

幂等键用于识别“这是同一次提交的重试”，使重复请求不会再次创建任务或重复扣费。

### 9.8 requestFingerprint：请求指纹

请求指纹是经过规范化的模型、参数、输入版本等信息的摘要，用来识别两个请求是否实质相同。

### 9.9 providerTaskId：Provider 任务 ID

Provider 成功接收异步任务后返回的任务标识。它是 Nomi 查询进度、对账和恢复任务的关键外部引用。

### 9.10 unknown、reconcile 与 restart recovery

- `unknown`：Nomi 不确定 Provider 是否已经接收或扣费；
- `reconcile`：向 Provider 或账本核对真实状态；
- `restart recovery`：进程重启后从 ProductionRun、事件和 Provider ID 恢复任务。

Provider 提交结果未知时，正确动作是先对账，**不是盲目重试**。因为盲目重试可能造成重复任务和重复扣费。

## 10. 状态机：哪些动作可以发生，哪些不能发生

一个简化的状态流转如下：

```text
PlanCandidate
  → validated
  → DraftExecutionSnapshot
  → awaiting approval
  → approved
  → sealed ExecutionContract
  → submitted
  → running / polling
  → succeeded / failed / unknown
  → Artifact verified
  → AdoptProposal / EditProposal
  → applied / rejected / undone
```

关键不变量：

1. `awaiting approval` 之前不能调用会花费额度的 Provider；
2. 只有 `approved + sealed` 的合同才能开始付费执行；
3. `unknown` 状态不能直接重下单，必须先 reconcile；
4. `succeeded` 只表示生成任务成功，不表示已经改了时间轴；
5. 只有用户确认后的 Proposal 才能通过命令入口修改项目；
6. 每次项目修改都应有可追踪的 `CommandReceipt`，并支持 Undo。

## 11. MCP 第一片为什么只做单镜生成

第一片选择单镜生成，不是因为最终只支持单镜，而是因为单镜已经能验证最关键的基础能力：

```text
能力发现
→ 动态计划
→ 合同编译
→ 预算审批
→ Provider 提交
→ 异步进度
→ 断线恢复
→ Artifact 持久化
→ 外部 Agent 可见
```

### 11.1 第一片工具面

```text
nomi_get_generation_context
nomi_submit_generation_plan
nomi_preview_execution
nomi_decide_generation_gate
nomi_start_generation
nomi_get_run / nomi_subscribe_run
nomi_get_artifact
nomi_propose_adopt_artifact
```

这些工具覆盖“准备、预览、审批、执行、观察、取结果、提出采用”，但不把任意 Provider API 暴露给外部模型。

### 11.2 第一片明确不做

- 自动插入时间轴；
- 多镜头复杂连续性；
- 完整短剧；
- 全量 `EditorDocument`；
- HyperFrames / Remotion 生产渲染；
- 任意 Provider API 暴露。

如果单镜都无法保证“一次提交、不重复扣费、可恢复”，直接做六镜、音频、字幕和导出，只会把问题藏得更深。

## 12. 外部 Agent 和 Nomi 的权责边界

外部 Claude、Codex、WorkBuddy 等客户端已经具备模型和对话能力，Nomi 不需要再额外调用一次模型去规划。

正确流程是：

```text
Nomi 提供上下文、Schema、能力与限制
  → 外部 Host 生成 PlanCandidate
  → Nomi 校验并保存
  → Nomi 负责审批、预算与执行
```

### 12.1 外部 Agent 可以提出什么

- 模块；
- 参数；
- 顺序；
- 参考图；
- 成本估算；
- 质量要求。

### 12.2 外部 Agent 不能伪造什么

外部 Agent 不能直接提交或伪造：

- `approved: true`；
- `providerTaskId`；
- `assetId`；
- `qualityPass`；
- “已经成功”的结果；
- Nomi 的最终项目状态。

外部 Agent 是交互和规划的一个表面，**不是项目事实源，也不是最终 authority**。

## 13. 剪辑区 Agent：通过 Proposal 改项目

剪辑区域的 Agent 不是另一套独立 Agent 系统，而是同一个 Runtime 的另一个交互表面。

```text
剪辑区 Agent
  → 读取当前选区与时间轴
  → 生成 EditProposal
  → 展示 Diff
  → 用户 Apply
  → 产生 CommandReceipt
  → 支持 Undo
```

### 13.1 EditProposal

`EditProposal` 是“建议如何改剪辑项目”，而不是已经发生的修改。它可以包含：

- 要新增、删除或替换的片段；
- 时间点、时长和轨道变化；
- 字幕、音频或转场变化；
- 依赖的 Asset / Artifact；
- 预期效果和风险。

### 13.2 Diff、Apply、CommandReceipt、Undo

- `Diff`：把当前项目和建议修改并排比较；
- `Apply`：用户确认后，正式应用 Proposal；
- `CommandReceipt`：记录实际执行了哪条命令、基于哪个 revision、产生了什么结果；
- `Undo`：撤销已应用命令，而不是依赖聊天里“再改回去”。

剪辑区 Agent 不能直接改 Zustand、Timeline、项目文件，也不能直接把生成结果塞进时间轴。所有项目修改必须走现有命令入口。

## 14. 能力核、CLI 和 MCP

### 14.1 能力核 Capability Core

Nomi 主进程内置的能力核，把“建项目、读写画布、真实生成”等领域操作包装成外部可以调用的接口。它负责把外部请求送到 Nomi 的权限、项目和生成系统里。

### 14.2 CLI

CLI 是命令行接口，例如：

```bash
node scripts/nomi.mjs status
node scripts/nomi.mjs models
node scripts/nomi.mjs project create "咖啡广告"
```

它适合：

- Claude Code 通过 Bash 调用；
- 编写批处理脚本；
- 在没有对话式 MCP 的场景中进行可重复操作。

### 14.3 MCP

MCP（Model Context Protocol）是让 Claude Code、Codex、Cursor 等 AI 客户端把 Nomi 当作一组结构化工具使用的协议层。

MCP 解决的是“外部 Agent 如何发现和调用 Nomi 能力”，不等于“外部 Agent 获得 Nomi 的全部权限”。权限和事实仍由 Nomi Runtime 负责。

### 14.4 CLI 与 MCP 的关系

```text
CLI = 人或脚本直接调用的命令接口
MCP = Agent 发现并调用 Nomi 能力的协议接口
Runtime = 两者共同进入的权威执行层
```

## 15. Nomi 开着、关着和后台运行

外部调用不应该要求用户记住“必须打开还是必须关闭”。Nomi 可以根据当前状态自动选择安全路径。

| 状态 | 处理方式 | 用户体验 |
|---|---|---|
| Nomi 开着且目标项目在前台 | 通过应用内服务和渲染层处理 | 画布可即时刷新 |
| Nomi 开着但项目不在前台 | 对目标项目安全落盘，确认仍由 Nomi 展示 | 不污染当前画布 |
| Nomi 关闭 | 拉起无窗口的 headless Nomi | 任务完成后，重新打开即可看到结果 |

### 15.1 A 模式与 B 模式

- A 模式：Nomi 已打开，外部调用内部本地服务；
- B 模式：Nomi 关闭，自动拉起无窗口后台主进程完成任务并落盘。

两种模式应尽量暴露相同的命令和语义。区别在于运行承载方式，而不是用户需要学习两套 API。

### 15.2 Headless Host

`headless host` 是没有可见窗口的 Nomi 运行实例，用于在应用关闭时读取能力、执行任务、保存项目数据和恢复状态。它不是另一套业务逻辑，应该复用同一套 Runtime 和持久化层。

## 16. 调用前的身份、Token 与客户端证明

### 16.1 Token

Token 是外部程序访问本机 Nomi 服务的基础凭证，通常由 Nomi 启动时生成并保存到：

```text
~/.nomi/capability-core/token
```

Token 解决“是不是一个得到本地服务允许的调用者”，但不自动等于“可以批准付费生成”。

### 16.2 API Key

API Key 是 Provider 的模型调用凭证，决定某个模型渠道能否实际发起生成。Token 和 API Key 是两件不同的事：

```text
Token   = 外部程序访问 Nomi 的凭证
API Key = Nomi 访问 Provider 的凭证
```

### 16.3 客户端证明与 trusted host

Claude Code、Codex、Cursor 等客户端还需要使用 Nomi 为当前电脑和具体客户端生成的身份证明。证明用于区分可信宿主和普通外部调用。

缺少有效证明的客户端可以获得有限的外部权限，但不能仅凭自报客户端名称就越过 Nomi 的可信宿主门，也不能伪造真人批准。

### 16.4 握手

MCP 接入卡的“成功”应基于真实启动和握手，而不是只检查配置文件里是否有一行命令。握手用于确认：

- 命令可启动；
- MCP server 可通信；
- 客户端身份凭证有效；
- 当前客户端具备允许的权限。

## 17. 项目、Canvas、Node、Edge 与 Generation Intent

这些是 CLI / MCP 使用层的基本对象。

- `Project`：Nomi 中的一个创作项目；
- `Canvas`：项目中的生成和编排画布；
- `Node`：画布上的一个镜头、文本、图片、视频、角色、场景或音频节点；
- `Edge`：节点之间的连接关系，例如参考、输入或数据流；
- `prompt`：节点或生成任务的提示词；
- `Generation Intent`：希望生成的媒体类型或目的，例如 `image`、`video`、`text`、`audio`。

例如，CLI 可以先建立项目，再添加节点，再为节点生成结果：

```text
创建 Project
  → Canvas add Node
  → 设置 prompt / references
  → 生成 Artifact
  → 将 Artifact 作为结果登记到 Node 和 Project
```

### 17.1 references

`references` 是生成任务使用的参考素材。它不只是一个文件路径，还应绑定到具体 Asset、版本和用途，避免模型或 Provider 使用了用户没有批准的旧素材。

### 17.2 Playbook

`Playbook` 是一组可恢复的制作草稿或推荐执行路径，例如 `brand.promo`。它更接近可复用的 Recipe / 业务流程入口，不应绕过合同、审批和 ProductionRun。

### 17.3 模型目录与模型选择

模型目录是 Nomi 对当前可用能力的结构化快照。外部 Agent 应先读取目录，再提出候选，而不是凭记忆拼出 Provider 或模型名称。

常见字段包括：

- `vendor`：模型所属的 Provider 或渠道；
- `modelKey`：Provider 使用的稳定模型标识；
- `kind`：模型支持的媒体类型，例如 `image`、`video`、`text`；
- `label`：给人看的模型名称；
- `enabled`：该模型是否已启用并具备可调用条件。

模型目录只回答“当前有哪些合法能力”，不等于用户已经批准使用某个模型。最终选中的模型仍必须进入 `DraftExecutionSnapshot`，并在 `ExecutionContract` 中冻结。

## 18. Run、Artifact 安全投影与预览

### 18.1 Run

`Run` 是一次可观察、可恢复的生产过程。外部 Agent 可以通过 `get_run` 读取状态，通过 `subscribe_run` 按事件游标等待变化。

### 18.2 Artifact

`get_artifact` 返回的是与 Run 绑定的产物安全投影。它不应该把所有本地路径、完整提示词或 Provider 内部字段无条件暴露给外部客户端。

安全投影可以包含：

- 产物类型；
- 所属项目和 Run；
- 状态；
- 可验证的引用；
- 精确的 Nomi 深链；
- 限时预览地址。

### 18.3 Loopback 预览

媒体文件可以通过项目、Run 和 Artifact 绑定的本机 loopback 地址限时预览。它的作用是让外部宿主查看结果，同时避免把任意本地路径直接暴露出去。

## 19. 安全和可靠性原则

这套架构的安全边界不是一句“模型要小心”，而是由数据和状态结构保证。

### 19.1 审批前零副作用

审批前可以读取上下文、生成候选和预估成本，但不能触发会花费额度或修改项目的动作。

### 19.2 审批绑定合同 hash

用户批准的不是一句自然语言，而是一个可核对的执行快照。批准记录应绑定 `contractHash`，确保之后执行的内容没有被偷偷替换。

### 19.3 一次提交和幂等恢复

成功路径应只提交一次。断线时先读取持久状态和 Provider 任务 ID；状态未知时先 reconcile；确认没有提交过，才允许安全重试。

### 19.4 不把状态写进聊天

聊天适合解释和交互，ProductionRun、事件、账本和项目 revision 才适合保存执行事实。

### 19.5 本地优先不等于完全离线

项目、素材、提示词、密钥和编排状态可以优先保存在本机，但使用外部模型 Provider 时，完成任务所需的输入仍会发送给对应供应商。

## 20. 交付分层与止损规则

不要一开始就重写完整编辑器或支持所有复杂制作类型。应先证明最小闭环：

```text
发现能力
  → 提出计划
  → 预览合同
  → 人工审批
  → 只提交一次
  → 可观察
  → 可恢复
  → Artifact 落盘
```

推荐的止损规则是：

> **如果当前阶段不能证明审批前零调用、成功路径只提交一次、断线不重复扣费，就不进入剪辑区和多镜头。**

实践中可以配合以下措施降低风险：

- 前期阶段优先使用零额度测试；
- 每个阶段只设置一个可验证目标；
- 每阶段保存 `PhaseEvidence`；
- 使用 feature flag 和回滚点；
- 不先做不可逆迁移；
- 不允许平行事实源；
- 不用 `completed` 状态代替真实媒体验收；
- 关键阶段做角色化和对抗性评审；
- 最终使用真实 MCP Host、真实用户任务、截图和媒体证据验证。

## 21. 方案取舍

| 方案 | 优点 | 致命问题 | 结论 |
|---|---|---|---|
| 全部写死 Workflow | 容易理解，早期好测 | 僵化、重复，难适应模型能力差异 | 保留为 Recipe |
| 所有 MCP Tool 自由组合 | 灵活，开发快 | 容易越权、重复扣费、无法恢复 | 不采用 |
| 先重写完整编辑器 | 最终体验完整 | 范围过大，延迟验证核心问题 | 后置 |
| 图片和视频各做一套系统 | 每类任务局部简单 | Runtime、审批、预算和恢复重复 | 不采用 |
| 外部 Agent 直接拥有权限 | 交互自然，少一层 | 断线、伪造、跨项目，无法持久恢复 | 外部 Agent 只规划，Nomi 保持 authority |
| 固定 Runtime + 动态 Module + ExecutionContract | 灵活、可审计、可恢复、可渐进交付 | 初期需要设计合同和测试 | 采用 |

真正的取舍是：**用一点前期合同和测试成本，换取后续不被 Workflow、Provider、Skill 和 Editor 的多套状态拖垮。**

## 22. 常见误解

### “模型能看到工具，就能调用工具。”

不一定。模型可见性、Module 的 `allowedTools`、Runtime 的权限校验和用户审批是不同层次。

### “Skill 里写了某个工具，所以 Skill 有这个权限。”

不成立。Skill 是指导文本，权限必须由 Runtime 和 Module 合同授予。

### “生成成功，就应该自动进时间轴。”

不应该。生成结果先成为 Artifact，再由剪辑区 Agent 提出 Adopt / Edit Proposal，用户确认后才 Apply。

### “聊天里说已经成功，就说明任务成功。”

不成立。真实成功必须由 ProductionRun、Provider 状态、Artifact 登记和媒体验证共同证明。

### “Nomi 关闭了，就不能被外部调用。”

不一定。Headless Host 可以复用同一个 Runtime 在后台执行并落盘。

### “拿到 Token 就能花额度。”

不成立。Token 只解决访问 Nomi 服务；实际生成还需要启用的模型、Provider API Key、合法合同和真人审批。

## 23. 术语速查表

| 术语 | 解释 |
|---|---|
| Agent | 负责理解意图、提出计划或生成编辑建议的模型驱动交互者 |
| Artifact | 一次执行产生并登记的输出产物 |
| Asset | 项目中可被引用的输入或中间素材 |
| Authority | 对权限、预算、状态和项目事实拥有最终决定权的一方；在本架构中是 Nomi Runtime |
| CAS | 按内容指纹保存和定位文件的内容寻址存储 |
| CommandReceipt | 项目命令实际执行后的可追踪收据 |
| Contract | 把“这次要做什么”冻结成可验证、可审计的结构化约定 |
| contractHash | 执行合同的内容指纹，用于绑定审批与执行 |
| DraftExecutionSnapshot | 审批前展示给用户的解析后执行预览 |
| Edge | Canvas 节点之间的连接关系 |
| ExecutionContract | 某一镜或某一次具体操作的不可变执行绑定 |
| Feature flag | 控制某项能力是否启用的开关，便于分阶段交付和回滚 |
| Headless Host | 无窗口运行的 Nomi 主进程实例 |
| idempotencyKey | 防止同一次请求重复创建任务或重复扣费的幂等键 |
| MCP | 让外部 AI 客户端以结构化工具调用 Nomi 的协议层 |
| Module | 有输入、输出、工具、命令和副作用合同的语义能力块 |
| PlanCandidate | Agent 提出的、尚未批准的候选计划 |
| Playbook | 可复用的制作草稿或推荐流程入口 |
| ProductionContract | 一次生产 Run 的业务目标、预算和执行边界 |
| ProductionRun | 生产任务的耐久状态源 |
| Proposal | 尚未正式写入项目的生成结果采用或剪辑修改建议 |
| Provider | 实际提供图像、视频、文本或音频模型服务的外部渠道 |
| Recipe | 常见任务的默认 Module 组合或推荐路径 |
| reconcile | 向 Provider、任务状态或账本核对真实结果 |
| revision | 项目当前版本，用来防止基于旧状态错误执行或覆盖 |
| Runtime | 负责权限、状态机、预算、执行、恢复和项目命令的权威层 |
| Skill | 描述方法、判断和工作步骤的指导文本 |
| Tool | 执行具体动作的低层接口 |
| Token | 外部程序访问本机 Nomi 服务的凭证 |
| Workflow | 一条完整的阶段流程；在本方案中主要作为 Recipe 的来源 |

## 24. 与使用指南的关系

这份文档回答“这些概念为什么这样分层，以及它们各自负责什么”。具体命令、接入方式和错误排查见：

- [`docs/guide/capability-core-cli-mcp.md`](./capability-core-cli-mcp.md)

相关架构决策可以继续查看：

- [`docs/superpowers/plans/2026-08-20-storyboard-execution-contract-v2.md`](../superpowers/plans/2026-08-20-storyboard-execution-contract-v2.md)
- [`docs/superpowers/plans/2026-08-21-agent-editor-workbench.md`](../superpowers/plans/2026-08-21-agent-editor-workbench.md)
