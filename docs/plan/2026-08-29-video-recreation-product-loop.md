# 视频复刻：画布内最小产品闭环与 Agent 落地方案

日期：2026-08-29

状态：📋 方案待拍板，design/docs only

基线：`origin/main@f9ac6c67`，对齐 Draft PR #223 `8784ec77` 的实际实现

配套：[完整调研](../research/2026-08-28-video-recreation-research-and-plan.md) · [Prompt 与合同附录](../research/2026-08-29-video-recreation-prompts-and-contracts.md) · [可交互样张](../design/mockups/2026-08-29-video-recreation-canvas-minimal.html)

## 1. 结论

视频复刻不应成为一个新的编辑器，也不应成为一套新的 Agent runtime。它是在现有生成画布中，把“看中参考视频的一小段，按我的要求重做，再决定是否替换”压缩成一个可理解、可恢复、可审计的局部闭环。

P0 的唯一主路径是：

`节点内选片段 -> 复刻这 5 秒 -> 说一句修改 -> 确认一次费用 -> 候选直接出现在画布 -> 对比并决定 -> 替换/撤销`

核心产品决定：

1. 主对象仍是画布上的视频节点，不打开新的 Preview 工作区。
2. 时间范围在节点内播放器下方选择，入口只在有选区时就近出现。
3. 用户只写“改什么”；系统默认保留时长、动作、运镜、构图和未点名内容。
4. 付费生成只确认一次。生成完成后候选直接落在来源旁边，不再出现第二张“是否放到画布”确认卡。
5. 候选不覆盖来源；只有用户点击“替换此片段”才影响时间线，该操作可撤销。
6. Agent 做理解、补全、估价、编排和检查，不替用户扩大范围、花钱或 Apply。

## 2. 为什么放在画布里

画布已经是 Nomi 的素材关系、生成候选和 Agent 常驻入口。视频复刻的来源、意图、候选和替换结果都需要被看见，画布比独立页面更适合表达这组关系。

但“放在画布里”不等于把所有控制铺在画布上：

| 内容 | 位置 | 原因 |
| --- | --- | --- |
| 选区与播放 | 视频节点内部 | 贴近被操作对象，避免上下文切换 |
| 一句话修改 | 现有 Canvas Agent composer | 画布已有 Agent，不造第二个助手 |
| 费用与范围确认 | Agent 时间线中的一张确认项 | 审批 owner 已属于 Project Agent Host |
| 生成进度 | 同一 Agent Item + 节点轻状态 | 只投影 ProductionRun 事实，不造 Journey 状态机 |
| 候选结果 | 来源节点旁的派生节点 | 来源、候选、关系同时可见 |
| 原片/候选对比 | 临时对比层 | 只服务一次决定，不常驻占画布 |
| 最终替换 | 对比层中的“替换此片段” | 明确作用域，点击本身就是 Apply 意图 |

设计系统层级判断：选区上的“复刻这 5 秒”是 L2 情境动作；Agent composer 是已有 L1；对比层是临时 L3。P0 不增加画布常驻工具栏按钮，不增加新的右栏或模式切换器。

## 3. 最终用户体验

### 3.1 首次成功路径

以“把 00:19–00:24 的人物换成红发女性，其余不变”为例：

1. 用户把视频放入画布或粘贴可获取的视频链接。
2. 用户在视频节点内拖出 5 秒选区。系统显示首尾时间码和一个就近动作“复刻这 5 秒”。
3. 点击后，现有 Canvas Agent 自动带上来源、精确帧范围和关键帧。输入框只问一句：“这段想改什么？”
4. 用户输入“人物换成红发女性”。Agent 将其整理为可读摘要：改变人物外观；保留动作、运镜、构图、时长和原声。
5. 系统显示一次确认：范围、预计费用、模型、最长等待时间、取消与异常说明。用户点击“确认并生成”。
6. Agent 提交 ProductionRun。原节点保持可操作；真实状态显示排队、生成、检查或失败，不显示假进度百分比。
7. 成功后，候选节点直接出现在来源右侧，并带来源边。Agent 只给一个主操作“对比并决定”。
8. 对比层同步播放原片与候选，默认聚焦选区；保留失败、边界跳变和音画变化直接标注在时间线上。
9. 用户选择“替换此片段”或“保留候选”。替换通过 `timeline.write` 应用，画面立即显示“已应用”和“撤销”。
10. 撤销恢复原时间线，候选仍留在画布，不销毁已经付费得到的产物。

### 3.2 用户不需要理解的内容

- 分镜 JSON、Provider prompt、模型引用语法和负向词。
- Project Agent Thread、Proposal、ProductionRun、Artifact 等内部名词。
- 为什么需要 `canvas.write` 或 `timeline.write`。
- 分析模型和生成模型如何分工。

界面只暴露对象、范围、变化、费用、结果和决定。

### 3.3 独立“视频拆解”

“视频拆解”是可复用分析能力，不是 P0 的第二个主流程。它将来源变成带时间证据的镜头事实，可供 Agent 回答、生成提示词或提取分镜。入口应先放在节点更多操作中；当用户开始复刻时，系统在后台按需产生最小分析 Artifact。

若分析会产生用户计费，必须进入 ProductionRun 的预算与确认链；不得为了在确认卡前生成漂亮摘要而静默调用付费模型。P0 可用本地抽帧、媒体元数据和用户原话完成 preflight，再把需要计费的理解与生成合并进一次预算确认。

## 4. 三个视角的价值与需求

### 4.1 用户视角

| 需求 | 验收条件 |
| --- | --- |
| 我能准确指出哪一段 | 选区使用帧边界保存；播放器、时间码和提交范围一致 |
| 我只需说改什么 | 默认 preserve 合同可见且可编辑，不要求长 Prompt |
| 花钱前知道代价 | 提交前展示估价、币种、上限、Provider 与取消规则 |
| 原片不会被偷改 | 来源 Asset 不可变；候选先独立存在 |
| 我能判断结果 | 原片/候选同步对比，显示 QA 证据而非笼统分数 |
| 我能反悔 | Apply 有一个明确 Undo；重启后仍可核对 |
| 失败后知道怎么办 | 错误说明影响、是否扣费、可恢复动作，未知提交不自动重试 |

北极星指标：`Accepted Segment Rate = 被 Apply 的候选片段数 / 已完成的付费候选数`。

护栏指标：首次可审候选时间、每个被接受片段的付费尝试数、Apply 后十分钟内 Undo 率、非目标区域变化率、边界不连续率、未知提交率和重复扣费率。

### 4.2 代码视角

| 原则 | 具体约束 |
| --- | --- |
| 一个事实一个 owner | 视频复刻只新增语义 payload 与 Artifact schema，不新增 Session/Task/Approval/Undo store |
| 来源不可变 | `sourceAssetId + contentHash + exact frame range` 是所有分析和生成的前提条件 |
| Provider-neutral | 用户意图先标准化，再由 provider compiler 产生实际 prompt/request |
| 付费 exactly-once | 预算、提交、receipt、恢复、取消与 Artifact 全部由 ProductionRun 持有 |
| 写入可撤销 | 候选落画布走 `canvas.write`；最终替换走 `timeline.write`；各自复用既有事务与 receipt |
| 失败可核对 | `runId/jobId/artifactId/resultId` 可串联，不把 free-form 文案当状态 |

### 4.3 Agent 视角

Agent 可以：读取用户选区、分析证据、提出 preserve/change、选择已批准档案中的模型、编译请求、估价、创建 Proposal、查询 Run、展示 QA、提出替换建议。

Agent 不可以：扩大选区、静默更换来源、绕过预算、在未确认时提交付费任务、把模型输出当事实、因超时重复提交、直接覆盖时间线、读取其他项目的私有素材。

所有外部 skill 都只能缩小 Host 已授予的 capability ceiling。高星 skill、Prompt 模板或 MCP 工具是方法和 adapter 候选，不是新的权限 owner。

## 5. 与 Draft PR #223 的 ownership 对齐

PR #223 的描述仍停留在 Phase 1/2A，但 `8784ec77` 的实际代码已经推进到 Project Agent Host、`canvas.read/write`、`document.read/write`、`timeline.read/write` 与 Phase 4 ProductionRun 关口。本方案以代码和执行路线图为准，不以过期 PR 描述为准。

| 事实/行为 | 唯一 owner | 视频复刻新增什么 | 明确禁止 |
| --- | --- | --- | --- |
| Thread/Turn/Item | Project Agent Host | 复刻摘要和结果的 UI projection | `VideoRecreationSession`、独立聊天历史 |
| Proposal/approval | Project Agent Host | 复合审批中的语义 payload | 自建 confirm 状态、renderer 直接批准 |
| Capability schema/policy | Capability Registry | provider-neutral recreation input schema | 页面手写第二份 schema/effect |
| 付费生成 | ProductionRun | recreation execution payload 与 QA policy ref | 组件直接调 Provider、独立 job store |
| 候选画布节点 | `canvas.write` + Canvas domain | `RecreationArtifactRef` 和来源边 recipe | 绕过 proposal transaction 直接写 store |
| 时间线替换 | `timeline.write` + Timeline domain | exact source range 与 candidate artifact ref | 第二套 TimelineStore、直接 mutate clip |
| Apply/Undo | 各领域现有 transaction/receipt | 只投影 receipt | Journey 状态机或视频复刻专属 Undo |
| 二进制产物 | Artifact/asset domain | 分析、关键帧、候选与 QA manifest | 把大对象复制进 Host snapshot |

本 PR 不复制 #223 的实现，也不假设它已经可合并。实施分支必须以 #223 Phase 3/4 合同进入 `main` 后的真实代码为基线；若 owner 或 API 再变化，先更新本文对齐表再开工。

## 6. 一次确认合同

### 6.1 用户承诺

“确认并生成”只出现一次，并同时授权：

1. 在显示的预算上限内执行该片段的理解、生成和 QA；
2. 成功后按显示的放置规则，把该 Run 的候选作为可撤销节点放在来源旁边。

这不授权替换时间线。之后点击“替换此片段”是新的、明确的 Apply 决定，但不再弹一层重复确认框。

### 6.2 运行时合同

Project Agent Host 应拥有一个复合审批 envelope，而不是让 ProductionRun 和 `canvas.write` 各问一次：

```ts
type RecreationApprovalEnvelope = {
  approvalId: string
  projectId: string
  sourceBinding: {
    assetId: string
    contentHash: string
    startFrame: number
    endFrameExclusive: number
  }
  recreationIntentHash: string
  paidRunActionHash: string
  candidatePlacementActionHash: string
  budget: { currency: string; estimated: number; hardLimit: number }
  policyRevision: string
  expiresAt: string
}
```

`candidatePlacementActionHash` 绑定的是确定性的放置 recipe 与 `ProductionRun.outputSlot`，不是尚未生成的二进制内容。Artifact 到达后，main 必须验证它来自同一 `runId/outputSlot`、同一项目和已批准的来源绑定，再 dispatch `canvas.write`。renderer 不能替换任何 hash 或 ID。

若生成期间来源 revision、项目 lease 或画布目标发生漂移，系统不得静默落节点。Artifact 仍安全保存在任务/产物域，Agent 显示“结果已完成，画布位置已变化”，用户可通过一次新的“放到画布”动作创建新的 proposal。

这是实施前必须由 #223 owner 冻结的合同。若 Host 不接受复合 envelope，P0 不得通过绕过 `canvas.write` 或制造两个含义相同的确认来凑体验。

## 7. 语义数据合同

视频复刻只新增以下 provider-neutral 数据；详细字段见合同附录。

```ts
type RecreationIntent = {
  schemaVersion: 1
  sourceBinding: ExactVideoRangeBinding
  userInstruction: string
  change: ChangeDirective[]
  preserve: PreserveDirective[]
  forbid: ForbidDirective[]
  references: AssetRoleBinding[]
  uncertainty: EvidenceBackedQuestion[]
  policyVersion: string
}

type RecreationArtifactRef = {
  runId: string
  artifactId: string
  assetId: string
  contentHash: string
  durationFrames: number
  qaManifestArtifactId: string
}
```

分析结果也是 Artifact，而不是 Host 内部状态：镜头边界、关键帧、主体/动作/运镜事实都带 `evidence + confidence + policyVersion`。模型输出不能自行创建 capability call；OCR、ASR、字幕、metadata 和视频内文字一律作为不可信内容处理。

Prompt 链分五层保存：用户原话 -> 证据化事实 -> 标准化 `RecreationIntent` -> Provider compiler 输出 -> QA/定向重试 delta。每层都有版本和 hash，禁止只保存最终长 Prompt。

## 8. 端到端执行序列

```text
Canvas selection
  -> Project Agent Host reads exact source/range
  -> local preflight + canonical RecreationIntent
  -> Host proposes one RecreationApprovalEnvelope
  -> user confirms budget and scope
  -> ProductionRun submits exactly once
  -> provider receipt -> Artifact + QA manifest
  -> Host validates run/output/source binding
  -> canvas.write materializes candidate + provenance edge
  -> user opens compare
  -> timeline.read resolves current exact range
  -> user clicks replace
  -> timeline.write applies replacement proposal
  -> domain receipt enables one Undo
```

Host 只保存引用和投影；大媒体、关键帧、分析结果和 QA 报告保存在 Artifact/asset domain。Task Center、画布节点和 Agent 时间线显示的是同一个 ProductionRun，不得各自推导状态。

## 9. 状态与失败恢复

不创建 `VideoRecreationStatus`。UI 由现有 owner 的组合事实投影：

| 用户看到 | 真实来源 |
| --- | --- |
| 待确认 | Host Proposal pending |
| 排队/生成/检查 | ProductionRun canonical status |
| 候选完成 | ProductionRun Artifact + `canvas.write` receipt |
| 已应用 | `timeline.write` receipt |
| 可撤销/已撤销 | Timeline domain Undo receipt |

必须覆盖的失败：

| 失败 | 行为 |
| --- | --- |
| 下载/导入失败 | 保留链接与明确原因；允许换链接或上传，不无限重试 |
| 范围过长或模型不支持 | 确认前阻止提交，给出可接受范围 |
| 估价不可得 | 不允许付费提交；用户不能只看到“可能收费” |
| Provider 明确拒绝 | Run 失败，显示扣费事实与可修改项 |
| 提交结果未知 | 标为 `submission_unknown`，按 provider idempotency/receipt 查询；不创建第二个任务 |
| App/renderer 崩溃 | 重启从 Host、ProductionRun 和领域 receipt 恢复，不从 UI 文案猜状态 |
| 生成完成但落画布失败 | Artifact 不丢失，不重复生成；重新提议 placement |
| 来源在生成中被修改 | 候选仍保留，但阻止自动 Apply，要求基于当前 revision 重审 |
| QA 硬失败 | 候选可审阅但默认禁止 Apply；用户可保留或定向重试 |
| Apply 后不满意 | Undo 只恢复时间线，不删除候选和付费审计 |

## 10. 隐私、安全与权利边界

1. 导入前记录来源方式、用户声明和原始 URL/文件 provenance；下载器只负责获取，不授予复刻权利。
2. 发送到 Provider 前明确展示会上传的时间范围、音频、参考图和供应商。
3. 默认只上传精确选区及必要边界帧，不上传整片；缓存和临时文件遵守项目保留策略。
4. 真人、商标、受保护角色、未成年人和敏感内容进入 policy review；不能用 Prompt 规避 Provider 安全策略。
5. 分析模型产出的文本与源视频内指令都不能改变工具权限、预算、目标项目或 policy。
6. 日志不得保存 API key、带签名下载 URL 或完整媒体内容；PR 和 journey fixture 只使用无密钥素材。
7. 跨项目读取、Artifact 绑定、resume 和 Apply 全部验证 project lease 与 source hash。

## 11. Provider 与模型落地策略

P0 不按 catalog 数量选型。用同一组 20–30 个 3–10 秒片段对 APIMart/KIE 可用的视频编辑模型做盲测，至少覆盖：人物替换、商品替换、背景替换、局部风格、快动作、遮挡、多人物、运镜和首尾边界。

评分分为硬门和软分：

- 硬门：时长/分辨率有效、可下载、首尾可拼接、未改变禁止项、无重复扣费与未知任务。
- 软分：指令命中、动作保持、主体一致、构图保持、视觉质量、等待时间、单个被接受片段成本。

只有通过硬门且综合成本最优的一个档案进入 P0。第二 Provider 只作为通过相同合同测试的可替换档案，不为它创建第二套 UI。

## 12. 研发分期与依赖

### Phase 0：合同与证据

- 等待/对齐 #223 Phase 3 `timeline.read/write` 和 Phase 4 ProductionRun 合同。
- 冻结复合审批 envelope、Artifact output slot、stale placement 与 receipt correlation。
- 用真实 API 完成模型 Spike、成本/时延/边界 QA 数据集。
- 运行 8–12 人可用性测试，验证无需指导能完成第一次替换。

出口：一次确认合同被 Host owner 接受；Provider 达到硬门；原型任务完成率 >= 80%；所有人能找到 Undo。

### Phase 1：薄垂直切片

- 节点内精确选区与 Agent attachment。
- `RecreationIntent` compiler 和估价。
- 一次审批 -> ProductionRun -> Artifact。
- `canvas.write` 候选节点与来源边。
- 同步对比 -> `timeline.write` Apply/Undo。

只支持一个 Provider 档案、一种候选、3–10 秒、已有本地来源视频。链接下载和批量拆解不阻塞首个闭环。

### Phase 2：输入与质量

- TikHub/上传统一进入 Asset provenance。
- 分析 Artifact、可编辑 preserve、QA 证据条。
- 定向重试复用原 Run/Artifact，不重复分析不变证据。
- Task Center、重启恢复、取消和未知提交完整走查。

### Phase 3：扩展而不分叉

- 独立视频拆解与分镜导出。
- 多候选、模型档案替换、批量片段。
- Skill/MCP 只投影 Registry 已批准能力。
- 依据 Accepted Segment Rate 和成本数据决定是否支持整片编排。

## 13. 测试与验收矩阵

### 13.1 合同测试

- 精确帧范围、source hash、intent hash 和 policy revision 在全链不漂移。
- paid action 与 candidate placement 两个 hash 均来自同一 approval。
- ProductionRun submit 在 timeout/restart/replay 下 exactly-once。
- Artifact 与 run/output/project/source 绑定不匹配时 fail closed。
- `canvas.write` 和 `timeline.write` 使用各自 canonical receipt 与 Undo owner。
- Provider compiler golden tests 不丢 change/preserve/forbid/reference role。

### 13.2 真实任务 E2E

1. 上传视频 -> 选 5 秒 -> 改人物 -> 一次确认 -> 候选出现 -> 替换 -> Undo。
2. 生成中重启 -> 恢复同一 Run -> 不重复扣费 -> 候选出现。
3. Provider timeout 且提交未知 -> 查询原任务 -> 不自动重提。
4. 生成时移动/删除来源 -> Artifact 保留 -> 自动 placement 被阻止 -> 可重新放置。
5. QA 检出非目标区域变化 -> 默认不 Apply -> 定向重试。
6. 窄窗口和移动宽度完成选区、确认、候选、对比与撤销，无文字/控件重叠。

### 13.3 用户研究

观察而不教学：用户从导入开始完成“只改一个片段”。记录首次找到入口时间、是否理解候选不会覆盖原片、是否能预测费用、是否会误以为“保留候选”等于 Apply、失败后的下一步和撤销发现率。

## 14. Go / No-Go

进入生产实现必须同时满足：

- #223 owner 表已在主线或实施基线上成立，没有第二个 Session/Approval/Task/Undo owner。
- 复合审批与 ProductionRun receipt 合同有测试，不靠 UI 顺序保证。
- 模型评测硬门全过；边界不连续与非目标变化达到产品阈值。
- 原型任务完成率 >= 80%，费用理解率和 Undo 发现率为 100%。
- 真实 API journey 无重复扣费、无密钥落盘、无未知提交自动重试。

任一不满足则停在 Spike/用户测试，不把“能调用模型”包装成已交付的视频复刻。

## 15. 本方案 PR 的边界

包含：产品/技术/Agent 方案、竞品与开源调研、Prompt/数据合同、可交互 HTML、journey 轨迹、最终桌面/窄屏/移动截图。

不包含：旧 Preview 右栏、`VideoRecreationSession`、直接 Provider adapter、APIMart key、生产状态机、eval 输出、未对齐 #223 的 capability 实现。

本 PR 合并后，下一步不是直接铺 UI，而是先在 #223 owner 上冻结“一次确认 + ProductionRun + 可撤销候选物化”的窄合同，再用一个真实 5 秒样本完成薄垂直切片。
