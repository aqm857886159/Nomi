# Project Agent Host：Phase 6 合并前真实用户验收计划

> 状态：🚧 进行中

## 已确认的 Phase 6 执行增量（2026-08-31）

本计划已获用户确认，新增两条不可绕过的交付约束：

1. **PR #194 竞品/交互设计是本批第一顺位证据**，不是实现完成后的装饰性参考。每个可见交互先登记来源、用户摩擦、`adopt / adapt / reject` 决策、Nomi 组件落点和可观察测试；不直接 cherry-pick 竞品代码或引入第二套视觉基础设施。对账依据为 [PR #194](https://github.com/aqm857886159/Nomi/pull/194) 的 [Agent 交互专章](https://raw.githubusercontent.com/aqm857886159/Nomi/claude/youthful-buck-fe0def/docs/design/nomi-agent-interaction.md) 与 [精准实现合同](https://raw.githubusercontent.com/aqm857886159/Nomi/claude/youthful-buck-fe0def/docs/design/nomi-agent-interaction-implementation-contract.md)。
2. **高内聚、低耦合是实现硬门**：能力契约、模型工具投影、领域 Adapter、Host 编排、Skill 资源和 UI 投影各自成模块；跨层只通过稳定类型/事件接口，禁止在 resident、Skill、provider 或测试脚本中复制另一层的状态/参数/权限。

### PR #194 设计模式 → Nomi 落点 → 硬测试

| PR #194 模式 | Nomi 适配 | 必须通过的证据 |
|---|---|---|
| 单一 resident Dock、原来的右侧位置与收起圆角胶囊 | 保留 Workbench 几何和时间线 owner，Creation/Generation/Preview 只投影同一 Host | 三面切换保持同一 Thread、queue、artifact ref；收起不遮挡工作面 |
| 8 个互斥状态 + `retryable` / `deviated` 标志 | Host Item 状态作为唯一 UI 状态源；不再由消息/节点/审批各自拼状态 | drafting→proposed→queued→running→done/failed/stopped 每条原位更新；未知回执不得转 done |
| 三个视觉层级：过程一行、可展开一行、决策/产物卡 | 工具/思考/排队/用量默认摘要；计划、付费、失败、产物才升级卡片 | 默认不展示 raw schema；展开后字段可读且与实际参数一致；窄栏无横向溢出 |
| 上下文架、`@` 引用、发送即冻结 | ContextSnapshot 保存 target/revision/locator/附件/Skill/模型 | 对象变更显示“引用后已变化”；改用最新版生成新快照，不改历史 |
| 队列保存完整 `TurnDraft`、可编辑/删除/重排/暂停 | Host queue 持有文本、附件、上下文、模式、批准策略和时间戳 | Agent 忙时输入不丢；编辑后只执行最终草稿；取消不产生副作用 |
| 计划卡 + 同一 `InlineParameterBar` 批级/单镜参数 | 复用真实节点档案控件，审批以 `effectiveArgs` 重新 prepare/hash/execute | prompt、模型、模式、已声明参数、引用、预计费用逐字段可编辑并在回执中对账 |
| 付费卡明示单价/合计/冻结项，确认次数最少 | 一次批量安全确认；付费/不可逆仍单次确认；未知价格阻断而非猜测 | 每项单价、合计、冻结项可见；拒绝/停止/未知 receipt 均无重复提交 |
| Skill 列表→预览→载入→常驻标记 | 从仓库 `skills/` 与用户技能目录读取 metadata；选中后才注入正文，能力仍由 Host 交集裁剪 | UI 可见名称/说明/来源/缺失 provider；Agent 首轮可发现，匹配任务时真实加载，后续回执显示版本/hash |
| 工序图示、低对比等待、reduced-motion、暗色单独校验 | 只用 `src/design` 受管资产、Tabler 图标和 Nomi tokens；同屏最多一处扫光 | 标准/窄窗口、light/dark、`prefers-reduced-motion` 截图和键盘/ARIA 走查 |

### 费用与模型选择合同

- **真实创作**不套用最低价策略：用户明确指定模型/参数时尊重其意图；未指定时使用 Nomi 设置中已保存的默认 image/video 模型（没有默认值才阻断并要求选择），确认卡仍显示真实价格、供应商、模型、输入、引用和冻结项。
- **只有测试/评测 job**为了控制额度才使用 ApiMart 最低成本档（最短时长/最低清晰度）；该选择器属于测试 harness，不得被 ProductionRun、composer 或默认模型解析调用。测试 key 不写入仓库、日志或截图。
- ApiMart key 只允许通过现有加密 catalog 或一次性环境注入读取；任何脚本不得把明文 key 落盘。最终候选最多一个新的付费 provider job，复用其 job/receipt/artifact 完成人工旅程；`submission_unknown`、重复 receipt 或第二 job 立即停止并 reconciliation。

### Skill 资源加载合同

- Pi `ResourceLoader` 只加载 Nomi 明确允许的仓库 `skills/` 和用户技能根，不读取 cwd/agentDir 中的任意 `AGENTS.md`、扩展、设置或凭据；保留现有 sandbox 隔离测试。
- 资源 catalog 由单一 `electron/harness/runtime/pi` 模块提供：`list` 只返回 metadata，`load` 才读取正文；Skill 不能授权新工具，MCP 不能复制 Host 历史。
- resident Skill 菜单、MCP `skills.list/read`、Pi 可发现资源和 Host `skillVersions` 必须来自同一记录/哈希；任一路径缺失或版本漂移都返回可行动错误，不能静默按未加载继续。

### 模块边界与交付顺序

1. **证据与 RED 测试**：先写 PR #194 对账 ledger、测试 harness 的 ApiMart 最低价选择合同、默认模型优先级合同、仓库 Skill 发现/加载测试和真实用户任务测试；确认旧实现对这些测试失败。
2. **最小闭环实现**：新增/调整单一资源 catalog、测试专用价格选择器和 profile 接线；修复默认模型→composer/ProductionRun 与 Skill metadata→Pi loader→Host evidence 的链路；不在 UI 或 provider 目录复制逻辑。
3. **真实任务与 UI**：从 UI 自然语言输入跑小猫头像、5 分钟视频、指定模型、只规划、改镜重生成、Skill/Prompt、时间线/导出、队列/Stop/恢复、未知回执等任务；截图对账 PR #194 几何、层级、文案、图标、密度和无障碍。
4. **交付门**：只重跑受影响 focused 单测/集成/Electron/Playwright 证据；确认无 P0/P1 后提交并 push 当前任务分支。不得整合 main、rebase、force-push 或启动全量 release/第二个付费任务。

## 目标

在合并前证明一个真实用户可以通过同一个 resident Agent 完成“理解现场 → 修改内容 → 生成/引用素材 → 检查时间线 → 复核结果”的闭环。验收不只看按钮存在，而要同时证明：UI 操作进入 Host、Host 只产生一份 Thread/Turn/Item/queue 历史、领域 owner 持久化真实结果、失败可解释且可恢复。

## 总体产品目标（不是固定提示词）

这项工作的目标不是为几个演示句子写一套固定回复，而是让 Agent 成为跨 Creation、Generation、Preview 的任务协调者：用户只说想要的结果，Agent 负责理解意图、读取当前现场、拆出可执行步骤、调用真实领域能力、在不可逆或付费处做最少且明确的确认、持续报告进度并交付可复核的结果。用户可以换目标、换模型、换素材，流程仍由同一套能力合同和领域 owner 驱动。

```
用户目标
  → 意图与约束（目标、时长、素材、模型、预算）
  → 可审阅计划（剧本 / 分镜 / 生成参数 / 预计花费）
  → 领域执行（文档、画布节点、生成 runner、PR213 时间线、导出）
  → 状态与反馈（Host Item、任务/产物 ref、错误、重试/停止）
  → 复核与交付（时间线 revision、导出 receipt、可打开 artifact）
```

### 设计判断与边界

- Agent 不拥有第二份时间线、生成队列、ProductionRun 或费用账本；它只编排并投影各 owner 的稳定 ref。
- PR #213 的 `read_timeline`、`inspect_timeline_range`、`propose_edit_plan`、`apply_edit_plan`、`undo_timeline_edit` 和 `export_timeline` 是时间线能力的唯一调用面；不再写一套“Agent 剪辑 API”。
- “帮我做一个 5 分钟视频”必须能展开为剧本 → 分镜 → 参考图/关键帧 → 视频片段 → 失败片段有界重试 → 按镜序排片/剪辑 → 导出。测试使用短的 loopback 媒体，但断言逻辑时长、镜头数、依赖、模型/参数、时间线 revision 和导出回执，不能把几秒样片冒充五分钟成片。
- 规划、生成、剪辑和导出不是四套聊天壳；是同一个 Host Thread 下的连续 Turn/Item。付费确认由现有 spend/ProductionRun 门负责，不能由 prompt 或 Skill 自行授权。

### 当前执行的两个宏批次

**A · 真实任务合同与证据**：把用户目标、能力清单、工具调用、失败恢复、UI 反馈和截图/Host/领域快照写成可执行验收；先用零额度 loopback 跑通一条长任务，发现问题直接修复。

**B · Resident 生产闭环**：在保持 PR194 外壳布局的前提下，让 resident Agent 通过现有 Generation composer、ProductionRun 和 PR213 时间线 owner 完成计划、生成、排片、导出；删除或禁止任何绕过 owner 的旧重复调用面；只重跑受影响的 focused component/integration/GUI 证据。

每个宏批次只在其端到端结果可观察、可恢复、可回放时关闭；“模型给了一个听起来合理的回复”不算完成。

## 测试 seams（用户已明确的范围）

- **Agent 控件**：thread/history、composer、附件、引用、Skill、提示词、运行方式/授权、模型、发送、停止、队列编辑/取消、批准/拒绝、任务/产物跳转、收起/展开。
- **Host 工具**：document read/write、canvas read/write/delete、timeline read/write、asset read、export read/write，以及工具调用、审批、拒绝、取消、重复调用防护。
- **真实任务**：文本创作/改稿、画布建卡/引用/参数、图片与视频生成请求、引用素材与提示词、Skill/context 注入、预览/时间线检查与导出入口。
- **质量维度**：功能结果、持久化、跨 Creation/Generation/Preview 连续性、窄窗口/暗色/无障碍、文案/icon/空间排版、错误反馈与恢复。

## 用户体验验收增量（2026-08-30）

本轮走查把用户现场反馈转成硬验收项，而不是留在评语层：

1. 工具调用卡只呈现“要做什么、会改变什么、结果是什么”，隐藏 schema 参数、能力 id、result hash 等内部细节；需要展开时也必须是可读摘要。
2. 队列只呈现 queued / proposed / running 的活动任务；done、failed、stopped 进入对话回执，不再占用队列空间或显示可取消的红色按钮。
3. 保留 PR #194 的外层 resident 位置和收起圆角胶囊，但压缩 header、上下文条、消息间距和 composer 的无效留白，保证真实对话区域优先。
4. “创建镜头卡/生成”必须在真正执行前呈现可读的提示词、模型、关键参数、引用和预计费用；没有冻结值就不能把操作伪装成已完成。
5. “回到现场”必须产生可见的焦点/高亮/辅助反馈；如果当前现场已经可见，不增加遮挡内容的侧栏。
6. 批量可批准的安全操作合并成一次低打扰确认，危险或付费操作仍在执行前保留明确的单次确认；完成态只显示回执和撤销入口（若领域 owner 支持）。
7. header 显示本轮和会话累计 token，用量/预计费用可见；未知价格明确显示“未定价/需确认”，不能用 0% 或静默数字制造掌控感。

### 本次能力漏洞的根因与永久规则（2026-08-31，固化为 R24）

这次“审批卡只有批准/拒绝”的问题，不是少画了一个按钮，而是验收模型把“工具能被调用”误当成“用户能完成真实任务”。实现只验证了 Host 的 boolean approval、proposal/receipt 和节点落地，却没有把真实 image/video 节点的完整控制面（prompt、model、mode、每个已声明参数、引用）作为同一份提案合同的一部分；因此 UI 只能批准 Agent 当时猜的值，不能在副作用前修正值，Host 也没有在修正后重新 prepare/hash/execute。

从现在起，对每个用户可见 Agent 能力执行“领域节点对账规则”：

1. 先列出该领域真实 UI 能做的动作与字段，再逐字段核对 Agent tool schema、approval editor、Host adapter 和结果回执；缺一项就标记为能力缺口，不得以“批准后可去节点里再改”算完成。
2. 审批不是二元按钮，而是“最终提案确认”：用户改过的 `effectiveArgs` 必须重新经过同一 adapter 的 prepare、校验、hash、receipt 和 execute；拒绝不得写入，参数错误必须返回可纠正反馈。
3. 真实任务测试必须使用用户自然语言目标（例如“帮我生成小猫头像”“做 5 分钟视频”），覆盖模型/模式/尺寸/时长/引用/费用等决策，并断言这些值在 Host、领域 owner 和 UI 回执中一致；不能只断言工具名出现。
4. 每新增一个节点字段，必须同时增加：schema 合同、审批编辑控件、effectiveArgs 回归测试、真实 UI walk 断言；否则禁止把该字段宣传为 Agent 已支持。

这条规则把检查入口从“按钮是否存在”提升为“用户价值链是否闭环”，用于阻止同类的伪接通、参数丢失和模型默认值张冠李戴再次进入验收。

### PR #194 / 竞品研究增量对账（2026-08-31）

本次只做当前 Phase 6 合同内的增量，不重排既有阶段。基于 PR #194 head
`43634a90997f4957a16ad9fca52b0801e8d1e94b` 的逐张证据与
`docs/design/nomi-design-system.md` 对账：

| 研究模式 | Nomi 决定 | 本批动作 |
|---|---|---|
| 原位状态链、Thinking/Tool Chips/Task Rows、摘要→细节 | adopt | 保持现有 Host Item 原位投影；继续用 token、Tabler 图标和按需展开，不追加第二份历史。 |
| 参数/费用/引用同卡、审批是最终提案 | adapt | 继续复用真实节点参数档案；工具摘要不露 raw key，细节层仍可追查；Preview 入口改走时间线 profile。 |
| Skill / 模型发现的列表→预览 | adapt | Skill 只收窄能力，模型档案只填声明槽；不把竞品供应商皮肤或营销数据带入 Nomi。 |
| 竞品自动扣费、CLI/JSON 日志、无语义状态缩写、大块空白 | reject | 保留真实费用/停止/回执；技术字段按需显示；所有布局继续过 Nomi 密度与无障碍门。 |

本增量的可观察出口是：Preview resident 使用同一 Host 的 timeline 工具投影；工具摘要使用用户可理解的字段名；未声明的参数不伪装成可编辑能力。既有图片/视频真实生成闭环与四个 handoff 文档不变。

实现对账结果：参数摘要通过 Nomi i18n 映射为“尺寸/画幅/时长/帧率”等用户语言，未知字段只显示为“其他设置”数量；审批编辑器对当前模型未声明的字段只给出可行动提示，不生成 raw key 输入；“回到现场”携带选中的节点/片段，由 Workbench 复用既有节点聚焦或时间线选择，不新增遮挡侧栏；Preview 请求以 `timeline` profile 和 `workbench.timeline.editor` Skill 保持工具集合稳定，兼容 KV cache 的 sticky profile 规则。

## 任务角色

1. **新手创作者**：只描述目标，不学习 Nomi 格式；Agent 自动读取当前文稿并给出一次可批准的最小改动。
2. **专业分镜师**：在 Generation 中指定节点、模型和参考关系，要求“先规划、后批准、不生成”，再修改单节点提示词并撤销。
3. **成片审校者**：从 Preview 选择时间线范围，要求检查节奏/素材并返回可追溯结果；拒绝危险操作后仍能继续。
4. **预算敏感用户**：提出真实生成目标，先验证参数和预计成本；合并前使用 loopback provider 验证请求/参数/引用，最终候选最多一次付费 provider job。

## 能力与工具梳理（先对齐样张，再决定是否新增工具）

这张表以当前 `agentToolsForCapability` 注册表和真实 resident 入口为准，不把“按钮存在”当成能力。结论先行：样张中承诺的图片/视频生成已经接通；Agent 不新增绕过节点、模型参数和费用确认的 `generate_image` / `generate_video` 工具。

| 用户目标/样张入口 | 当前能力与实际工具 | 领域 owner / 结果 | 状态与下一步 |
|---|---|---|---|
| 问问题、读当前文稿 | `creation-chat`：`read_full_text`、`read_selection`、`author_skill` | Creation 文档/Skill 库 | 已覆盖；无写入时不弹审批 |
| 修改文稿 | `creation-editor`：文档读工具 + `insert_at_cursor`、`replace_selection`、`append_to_end` | 文档 owner；Host 只持有提议/回执 | 已覆盖；每次写入一次确认 |
| “帮我生成一个小猫头像” | `canvas-agent` 的 `create_canvas_nodes`，创建 image 节点并写入同语言 prompt | Generation Canvas 节点 owner | 已覆盖自然语言意图；不再因 Ask 模式拒绝 |
| 图片生成 | Agent 建卡/聚焦现有 image composer；composer 读取设置默认 image model、参数并走既有 spend confirmation 与 `/v1/images/generations` | Generation runner + asset/result owner | 已通过 loopback 真任务；不新增直跑工具 |
| 视频生成/图片转视频 | Agent 建卡/引用边；现有 video composer 读取默认 video model、参数和 image reference，走 spend confirmation 与 `/v1/videos` | Generation runner + asset/result owner | 已通过 loopback 真任务；不新增直跑工具 |
| 文本生成 | Agent 创建 text 节点；现有 text composer 负责流式 `/v1/chat/completions` 和结果落盘 | Text node / Generation runner | 已通过真任务；审批回执期间自动元数据写入已修复竞态 |
| 镜头卡、引用边、提示词与模型参数 | `canvas-agent`：`read_canvas_state`、`create_canvas_nodes`、`connect_canvas_edges`、`tidy_canvas`、`set_node_prompt`、`create_staging_reference`、`create_camera_move`、`delete_canvas_nodes`；审批卡内可编辑 image/video 节点的 prompt、model、mode 和已声明生成参数 | Canvas owner；Host 承担 proposal/approval，并以最终 `effectiveArgs` 重新 prepare | 已补齐审批编辑与 Host 重校验；仍需在 UI walk 中逐字段对账 |
| Skill / Prompt 选择 | Resident 的 Skill/Prompt 菜单仅改变方法或本轮表达，不新增权限；工具仍由 capability + skill intersection 决定 | Host policy + Skill library | 必须补真实菜单选择走查；不为每个 Skill 复制一套工具 |
| 素材、时间线检查与导出 | Preview resident 通过 `canvas-agent` 的 `timeline` profile 暴露 asset/timeline/export descriptors；读操作可直接做，时间线写入/导出仍需一次确认 | Asset / Timeline / Export owners | 已接入 Host 路由；仍需跨 Generation→Preview 真用户任务证明结果与回执 |
| Preview 中的 Agent 操作 | resident 使用真实 timeline target、时间线 skill 和 PR213 owner；不再走无工具的 `canvas-chat` | Preview/Timeline owner | 路由与提示合同已接通；待真实时间线读→计划→批准→验证走查 |

### 工具建设判断

- 必须做：把样张可见的“生成图片/视频”入口接到既有节点 composer；把自然语言意图、默认模型/参数、引用、费用确认和结果回写串成一条证据链；补 Skill/Prompt 菜单的真实选择走查。
- 不应做：独立的 Agent 直生成工具、第二套历史/队列/参数表、每个模型一套 UI、把 Skill 当授权、把 Preview 的未接能力伪装成已完成。直生成工具会绕过领域 owner 和付费确认，反而制造重复任务与不可 reconciliation 的状态。
- 必须标红的未覆盖项：Timeline/Export 虽已进入 resident 的 Host profile，仍需要单独真实任务证明跨界面结果、审批回执和导出验证；不能只因工具已注册就宣称完成。

## 工具集优化与统一编排（2026-08-31）

本轮吸收 Agent 工具系统笔记中的三条可落地原则：原子能力优先、知识按需加载、工具执行链必须独立于模型输出。Nomi 不采用“一个万能 call_tool”替代所有类型安全工具，也不把 30 个完整 schema 永久塞进每一轮上下文；采用稳定的工具注册表 + 任务 profile 裁剪 + 领域 owner 执行。

### 原子能力边界

- 读现场：文档、画布、素材、时间线、ProductionRun 状态分别由 read capability 提供，返回有界、无路径的稳定 ref/摘要。
- 计划：剧本/分镜/生成参数/剪辑计划只产生可审阅 candidate，不产生付费副作用。
- 写入：文档、画布、时间线、ProductionRun gate 分别走各自 owner 的 proposal/receipt/CAS 入口；不允许 Agent 直接写 store 或 provider。
- 运行：图片/视频/文本生成复用现有节点 composer、spend grant、asset consent 和 Runtime Adapter；长任务由 ProductionRun 持有阶段和 job 依赖。
- 交付：导出、验证、artifact 深链是独立的可观察动作，不能用“生成完成”文案代替文件验证。

### 工具呈现策略

1. Resident 首轮只加载与当前目标相关的 profile（creation、generation、timeline、production、recovery），核心读工具和一个跨领域状态工具常驻；不相关的完整 schema 延迟到目标确认后再进入下一轮。
2. 工具文件按四层归属管理：`shared/agentCapabilities` 是能力契约真源，`harness/tools/agentToolCatalog` 是唯一模型投影入口，`capabilityCore` 是领域 Adapter，`projectAgentHost` 只编排；调用方不再从多个 descriptor 文件拼接工具清单。
3. profile 只裁剪模型看到的工具，不改变 canonical alias、Host owner 或权限；切换 profile 不建立第二个 Thread/queue/history。
4. 同一 Thread 的 profile 只允许单向升级（generation → storyboard/timeline → production），不会在每个模型循环中动态增删工具；升级后保持稳定顺序和 schema，保护 KV cache，跨轮继续时不因“继续”缩回工具集。
5. Tool description 只讲“何时用、输入的真实含义、会不会产生副作用、失败后怎么办”；参数使用 enum、稳定 ref、revision 和有界输出，业务校验失败必须返回可纠正建议。
6. 工具结果默认给摘要 + 稳定 ref，完整 JSON/技术字段按需读取；UI 只投影行动价值、进度、费用和下一步。

### 统一编排循环

```text
目标 → 目标合同 → profile/Skill 选择 → 读取现场
  → 计划 candidate → 风险/费用门 → domain tool 执行
  → 事件/receipt → 验证 → 继续、定点修订、停止或安全恢复
```

模型只负责判断下一步；Host 负责循环边界、步数、取消、审批、去重、上下文压缩和历史；领域 owner 负责真实写入和副作用。Skill 只能提供方法，MCP 只能提供外部 transport，两者都不能跳过 Host 或 owner。

### 必须新增的真实证据

- 同一用户目标在 creation → generation → preview 三个 surface 之间保持一个 Host Thread 和稳定 task/artifact refs。
- “生成小猫头像”能从自然语言进入图片节点并获得真实结果；“5 分钟视频”能形成 ProductionRun、剧本、分镜、节点、片段、时间线 revision 和导出验证，而不是只返回计划文本。
- 工具 profile 缩减后，模型仍能发现并完成目标；工具缺失、参数伪造、stale revision、provider 超时和未知 receipt 都有可行动反馈且不重复执行。

## 验收合同

| 合同 | 可观察证据 | 硬失败 |
|---|---|---|
| 一个 resident shell | 三个 surface 只有一个 Host projection；切换不丢 draft、thread、context | 是 |
| 每个控件有真实结果 | click/fill/keypress 后可观察菜单、Host mutation、持久化或可解释反馈 | 是 |
| 工具完整可调用 | 请求体工具清单与注册表一致；每个高风险工具至少走一次真实批准/拒绝/取消路径 | 是 |
| 提案参数完整可编辑 | image/video 提案的 prompt、model、mode、声明参数可在审批前编辑；批准后 adapter 以最终 `effectiveArgs` 重校验并执行 | 是 |
| 生成链真实接通 | loopback 记录真实 chat→tool→capability→asset/task 结果；参数/引用原样落盘；禁止静默成功 | 是 |
| 用户任务闭环 | 每个角色从目标输入到结果/反馈结束，不依赖内部 API 代替 UI 操作 | 是 |
| 失败可恢复 | stop、deny、queue edit/cancel、stale target、provider error 都有可行动反馈且无重复执行 | 是 |
| 证据可复核 | 每一步写 trace、截图、Host snapshot/领域项目快照，报告标注 covered/asserted/unverified | 是 |

## 执行纪律

- 先用零额度 loopback fixture 验证所有路径、参数、引用、Skill 和 UI；不以截图代替结果。
- 付费生成只在最终候选执行一次，执行前记录 provider/model/input/预计支出/既有 receipt；状态未知立即停止并 reconciliation。
- 每个失败按“症状 → 根因 → 入口集”记录；能在当前合同内修复的直接修复并补回归测试。
- 不整合 main、不 rebase、不 force-push；只重跑受改动影响的证据。

## 交付物

- `tests/ux/project-agent-resident-real-tasks.walk.mjs`：resident shell 真实用户任务走查与 trace/screenshot/report。
- `.agents/runtime/harness/<run-id>/`：product spec、round contract、evaluation、final report（本地证据，不进入产品运行时）。
- `docs/audit/2026-08-30-project-agent-host-real-user-validation.md`：实际结果、发现、修复和未验证边界。
