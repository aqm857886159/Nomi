# Nomi 创作能力目录、Prompt 系统与 Pi 生态接入实施方案

> 日期：2026-08-29
> 状态：📎 方案交接；生产实现等待 Agent/Skill 接线稳定后再拍板
> 关联研究：`docs/research/2026-08-29-browser-assets-pi-ecosystem-research.md`
> 当前基线：Pi SDK `0.84.3`；工具由 `capability` 授权；创作区与生成区仍有两份 Agent 历史；Nomi 当前是 MCP Server，不是外部 MCP Client。

## 0. 决策结论

这件事不应被定义成“给 Pi 多装一些插件”，也不应先做一个包罗万象的插件市场。真正值得交付的是一套 **Nomi 创作能力系统**：

```text
用户说清目标
  -> Nomi 推荐当前阶段真正需要的方法/提示/外部能力
  -> 用户看见输入、产出、权限、费用、来源和效果样例
  -> Agent 在现有 capability 权限内执行
  -> 产出进入项目、素材、画布或 ProductionRun
  -> 项目锁定所用版本，结果可以复现、撤销和审计
```

核心取舍只有一个：

> **共用一个发现和选择入口，但绝不把 Prompt、Skill、Workflow、Connector 和可执行 Extension 合并成同一种运行时对象。**

原因很直接：用户可以在一个地方找能力，但系统不能把“一段提示词”和“一段可访问网络、文件、付费模型的代码”当成同一风险。前者可以只读注入，后者必须有权限、隔离、审批、版本和审计。

本方案默认选择：

1. 首期只做 **精选能力**，不开放无审核市场。
2. 首期兼容 Agent Skills 的知识包结构，但导入后转换成 Nomi 自己的版本化记录。
3. 外部 Pi Extension 不直接加载进 Nomi 生产进程；先吸收它们的方法和交互，必要时做 Nomi 原生 Connector。
4. Prompt 不批量搬运；建立 `PromptRecipe`，每条都要有变量、适用模型、版本、来源和评测。
5. `capability` 继续是工具权限的唯一 owner，Skill 只能申请能力，不能自行授予能力。
6. 创作产物继续由现有项目、画布、ProductionRun 和预算账本持有，第三方包不能另建第二套任务或资产真相源。

## 1. 为什么初版调研还不够

初版回答了“有哪些方向”，但还缺四类决定能否落地的证据：

| 缺口 | 如果不补会发生什么 | 本方案补法 |
|---|---|---|
| GitHub 高价值 Skill 没有系统分级 | 星标高就直接导入，容易带进许可证、运行时和质量问题 | 按标准兼容、Nomi 改造、只借鉴、拒绝四级处理 |
| Prompt 被当成文本收藏 | 用户能复制但不能稳定调用，模型变化后效果漂移 | 设计 `PromptRecipe`、编译顺序、变量和 with/without eval |
| 没有对齐 Nomi 代码真相 | 容易再造 Prompt 库、MCP Client、任务队列或 Agent 状态 | 每个方案落到现有 owner 和文件接缝 |
| 没有真实用户任务和验收数值 | 交付时只能说“功能做了”，不能证明创作更顺 | 10 条真实旅程、基线、任务成功率、时间和人工接管指标 |

## 2. 范围和不动项

### 2.1 本方案范围

- 创作能力目录：Prompt、Skill、Workflow、Connector、Extension 的统一发现与分型展示。
- Agent 激活机制：模式、PromptRecipe、Skill、项目上下文与工具观察的可控合成。
- 外部能力策展：GitHub、Agent Skills、Pi Package、Prompt 仓库和 MCP 的导入与审核链。
- 项目库、素材库的分类和智能视图。
- 浏览器研究结果、素材来源和权利证据进入项目的合同。
- 能力评测、版本锁定、更新、撤回、安全与许可证治理。

### 2.2 明确不做

- 不做通用 Chrome 扩展市场。
- 不允许用户从任意 npm 包一键安装并在 Electron 主进程执行。
- 不新建第二个 Agent runtime、任务队列、模型目录、预算系统或视频 renderer。
- 不承诺自动判断素材“绝对可商用”；只保存证据、规则和风险状态。
- 不把所有高星 Prompt 或 Skill 仓库批量镜像到 Nomi。
- 不在此包顺手完成项目级统一 Agent；该目标继续归 R2-U1。本方案只保证新合同能迁入统一宿主。

## 3. 用户、需求和失败条件

### 3.1 用户不是按扩展类型思考的

| 用户 | 真实目标 | 典型说法 | 失败条件 |
|---|---|---|---|
| 新手创作者 | 从想法尽快得到可发布短片 | “帮我把这段产品介绍做成 30 秒视频” | 先让他理解 Skill、Prompt、MCP，或配置十几个选项 |
| 熟练导演/剪辑师 | 快速研究、拆片、比较方案，同时保留镜头控制 | “按这个参考片的节奏，但不要照抄内容” | Agent 给泛泛建议，不能落到镜头、素材或时间点 |
| 商业团队 | 复用品牌资产，守住来源、客户和交付边界 | “上次客户 A 的风格和授权素材继续用” | 项目混库、授权证据丢失、升级后旧项目不可复现 |
| AI 工作流玩家 | 组合模型、方法和外部数据源 | “研究趋势，出三版方向，确认后批量生成” | 能力不可组合，或组合后绕过费用和写入确认 |
| 维护者/管理员 | 让生态可升级、可禁用、可回退 | “这个 Skill 更新后为什么项目变了” | 没版本、没哈希、没权限差异、没评测和撤回 |

### 3.2 需求必须按创作阶段表达

| 阶段 | 用户需求 | 可用外部能力 | Nomi 必须持有的结果 |
|---|---|---|---|
| Brief | 补齐受众、平台、时长、已有素材和禁区 | 结构化问答、creative brief Skill | `CreativeBrief` 和未解决冲突 |
| 研究 | 找趋势、事实、参考作品和竞品 | 浏览器、web research、MCP Connector | `ResearchEvidence[]`，含来源和引用片段 |
| 规格 | 明确故事、镜头、声音、画幅和交付标准 | video-spec、storyboard、sound-design Skill | 版本化 `CreativeSpec` |
| 素材 | 找图、视频、音乐、音效并判断许可 | Pexels/Openverse/Freesound Connector | `AssetSourceEvidence` 与用途关系 |
| 生成 | 把意图编译成适配模型的提示和参数 | PromptRecipe、模型指南 Skill | 冻结后的 prompt、参数、模型和成本确认 |
| 编辑 | 选择片段、节奏、声音和转场 | video-use、EDL、sound-design Skill | EditPlan/时间轴操作提案，不直接改原文件 |
| 审片 | 查连续性、质量、风险和来源 | review/rights Skill、多模态理解 | 可定位到镜头/时间码的 Finding |
| 交付 | 导出、署名、平台包装和复用 | publish Workflow | 交付包、署名清单、能力版本清单 |

### 3.3 需求优先级判定

一个外部能力只有同时满足以下条件才进入精选候选：

1. 它解决的是创作链上的可观察断点，不只是“Agent 更聪明”。
2. 结果能进入 Nomi 已有对象，而不是只留在聊天文本里。
3. 输入、输出、依赖、成本和失败原因能在调用前解释清楚。
4. 不要求把工具权限、预算或项目写入权交给 Skill 自己。
5. 有可复现测试，且启用后相对未启用有明确增益。

## 4. 一个目录，五种合同

用户看到的是一个“能力”入口，系统内部必须保留五种可判别对象：

| 类型 | 它是什么 | 能否调用工具 | 典型结果 | 风险级别 |
|---|---|---|---|---|
| `PromptRecipe` | 可参数化、可评测的提示模板 | 否 | prompt/结构化文本 | 低 |
| `KnowledgeSkill` | 方法论、检查表和参考资料 | 只申请，不授权 | Agent 的执行方法 | 低到中 |
| `WorkflowDefinition` | 有阶段、依赖和审批点的声明式流程 | 经 capability 编排 | 多阶段项目产物 | 中 |
| `ConnectorDefinition` | 外部 API/MCP/素材源桥 | 仅白名单工具 | 外部资料或素材 | 中到高 |
| `ExecutableExtension` | 在隔离环境运行的代码 | 按显式权限 | 新工具/交互 | 最高，首期不开放 |

公共层只负责：

- 搜索、分类、推荐和详情展示；
- 来源、作者、版本、许可证、兼容性和内容哈希；
- 封面、短视频、截图和示例；
- 安装/启用/更新/撤回状态；
- 当前项目锁定的版本。

运行层按 `kind` 分发，禁止用一个 `executeCatalogItem()` 把五种对象抹平。

## 5. 领域数据模型

以下是边界合同，不要求首期把所有字段一次性展示出来。

### 5.1 公共目录摘要

```ts
type CatalogItemKind =
  | 'prompt-recipe'
  | 'knowledge-skill'
  | 'workflow'
  | 'connector'
  | 'executable-extension'

type CatalogItemSummary = {
  id: string
  kind: CatalogItemKind
  version: string
  contentHash: string
  name: string
  shortDescription: string
  author: { name: string; url?: string }
  provenance: {
    sourceType: 'builtin' | 'github' | 'npm' | 'local'
    sourceUrl?: string
    sourceRevision?: string
    importedAt: string
  }
  license: {
    spdx?: string
    status: 'verified' | 'review-required' | 'incompatible' | 'unknown'
    notice?: string
  }
  media: Array<{
    kind: 'cover' | 'image' | 'video'
    pathOrUrl: string
    sha256?: string
    width?: number
    height?: number
    bytes?: number
  }>
  stages: CreativeStage[]
  tags: string[]
  trustTier: 'builtin' | 'curated' | 'local' | 'developer'
  compatibility: { minNomi?: string; maxNomi?: string; platforms?: string[] }
  evaluation?: { suiteId: string; scorecardVersion: string; passedAt?: string }
}
```

### 5.2 PromptRecipe

```ts
type PromptRecipe = CatalogItemSummary & {
  kind: 'prompt-recipe'
  intent: string
  mediaType: 'text' | 'image' | 'video' | 'audio' | 'multimodal'
  inputSchema: JsonSchema
  variables: Array<{
    key: string
    label: string
    required: boolean
    default?: unknown
    source?: 'user' | 'project' | 'selection' | 'asset' | 'model-profile'
  }>
  contextSelectors: Array<
    'creative-brief' | 'document' | 'selection' | 'shot' | 'asset' | 'research-evidence'
  >
  modelRequirements: {
    modalities: string[]
    capabilities?: string[]
    families?: string[]
  }
  outputSchema?: JsonSchema
  template: string
  evaluationCases: Array<{ id: string; fixture: string; assertions: string[] }>
}
```

`PromptRecipe` 是可发现、可复用、可版本化和可评测的能力定义，不是一次生成任务的执行记录。视频复刻方案中的 `GenerationRecipe` 则是 `RecreationIntent + ProviderCapability + PromptRecipe/Workflow` 编译后的领域执行产物，必须绑定具体 Provider、参数、成本预览和能力快照。两者保持不同 ID、schema 与生命周期：能力目录更新不能改写已经冻结的 `GenerationRecipe`，旧项目只通过所锁定的 PromptRecipe version/hash 复现编译输入。

### 5.3 KnowledgeSkill

Agent Skills 的 `SKILL.md + scripts/references/assets` 可作为输入格式，但 Nomi 首期只接受知识型内容：

```ts
type KnowledgeSkillManifest = CatalogItemSummary & {
  kind: 'knowledge-skill'
  entry: 'SKILL.md'
  activation: 'manual' | 'recommended' | 'automatic-safe'
  requestedCapabilities: string[]
  inputs?: JsonSchema
  outputs?: JsonSchema
  resourceIndex: Array<{
    path: string
    role: 'instruction' | 'reference' | 'example' | 'visual'
    sha256: string
  }>
  promptBudget: { catalogTokens: number; activationTokens: number }
}
```

约束：目录描述约 50–100 tokens；激活后的 `SKILL.md` 建议不超过 5,000 tokens、500 行；`references/` 和 `assets/` 按需加载，不把整个包塞进每一轮上下文。

### 5.4 WorkflowDefinition

```ts
type WorkflowDefinition = CatalogItemSummary & {
  kind: 'workflow'
  inputs: JsonSchema
  stages: Array<{
    id: string
    goal: string
    dependsOn: string[]
    capability: AgentChatCapability | ProductionCapability
    promptRecipeIds: string[]
    skillIds: string[]
    connectorIds: string[]
    outputContract: JsonSchema
    approval: 'none' | 'review' | 'spend' | 'publish'
    retry: 'never' | 'safe-read-only' | 'production-owned'
  }>
}
```

Workflow 只编排现有 capability 和 ProductionRun，不能自带任意 shell、HTTP 或模型调用。

### 5.5 ConnectorDefinition

```ts
type ConnectorDefinition = CatalogItemSummary & {
  kind: 'connector'
  transport: 'native-api' | 'mcp-stdio' | 'mcp-http'
  auth: { kind: 'none' | 'api-key' | 'oauth'; secretOwner: 'nomi-settings' }
  network: { allowedOrigins: string[]; redirectPolicy: 'same-origin' | 'allowlist' }
  tools: Array<{
    externalName: string
    nomiName: string
    inputSchema: JsonSchema
    outputSchema: JsonSchema
    effect: 'read' | 'download' | 'write' | 'spend'
    maxBytes?: number
  }>
  dataEgress: { categories: string[]; retention?: string }
}
```

### 5.6 项目能力锁

```ts
type ProjectCapabilityLock = {
  schemaVersion: 1
  items: Array<{
    id: string
    kind: CatalogItemKind
    version: string
    contentHash: string
    enabledAt: string
  }>
  runs: Array<{
    runId: string
    itemId: string
    version: string
    contentHash: string
    promptRecipeVersion?: string
    modelProfileKey?: string
  }>
}
```

项目打开时如果目录已更新，默认继续使用锁定版本。用户主动升级后才生成新锁；旧版本不可用时显示可解释的阻塞，不静默替换。

## 6. Prompt 与 Skill 的 Agent 调用链

### 6.1 编译顺序

统一 Prompt Compiler 按以下顺序合成：

```text
Nomi identity
-> 当前宿主/面板合同
-> 当前任务模式或 PromptRecipe
-> 已激活 KnowledgeSkill 指令
-> 选中的项目上下文
-> 用户请求
-> 不可信浏览器/Connector/工具观察
```

规则：

- 外部 Prompt 或 Skill 永远不能覆盖 Nomi identity、语言规则、权限策略、费用确认和项目写入合同。
- 浏览器和 Connector 内容用显式 `UNTRUSTED_EXTERNAL_CONTENT` 边界包裹，不能被当作系统指令。
- PromptRecipe 和 Skill 都可以声明需要的 capability，但最终工具集仍由 `agentToolsForCapability()` 派生。
- 一个会话可有一个主要任务模式、多个相容 Skill；冲突时必须在运行前给出冲突说明，不按列表顺序碰运气。
- 编译结果记录各层 id/version/hash，但不把密钥、完整浏览器 Cookie 或私有绝对路径写入日志。

### 6.2 调用方式

| 入口 | 用户行为 | 适合什么 | 默认行为 |
|---|---|---|---|
| Agent 自动推荐 | 用户自然描述目标 | 新手、明确阶段任务 | 先显示一行“将使用什么、产出什么”，只读能力可直接激活 |
| 模式选择器 | 用户主动选创作方式 | 高频专业任务 | 选择主要模式/PromptRecipe，不把 Skill 和模式混成同级语义 |
| `@能力` | 用户在输入中点名 | 熟练用户 | 解析、预检依赖并显示 chip |
| 能力详情页“用于当前任务” | 从目录探索 | 发现新方法 | 返回 Agent composer，并带入示例输入 |

可花钱、可写项目、可下载或可对外发送数据的动作仍走现有确认卡。安装/启用能力不等于批准未来所有副作用。

### 6.3 运行前 Preflight

每次调用前生成：

```ts
type CapabilityPreflight = {
  resolvedItems: Array<{ id: string; version: string; contentHash: string }>
  missingInputs: Array<{ key: string; reason: string }>
  missingProviders: string[]
  missingConnectors: string[]
  requestedCapabilities: string[]
  expectedOutputs: string[]
  dataEgress: string[]
  estimatedCost?: { currency: string; min?: number; max?: number }
  conflicts: Array<{ code: string; message: string; resolutions: string[] }>
}
```

无缺口才进入运行；缺口直接给可行动的修复入口。禁止 Agent 先开始，执行到一半才发现没有视频模型、素材许可不明或外部 Key 缺失。

## 7. UI 信息架构与交互

这是下一轮样张的输入，不在本方案里直接改 UI。

### 7.1 能力库

能力库是一张可扫描的工作列表，不做营销首页。顶部只保留：搜索、创作阶段筛选、类型筛选、已安装/可用状态。

卡片必须回答五个问题：

1. 它帮我完成什么结果？
2. 适合创作的哪一步？
3. 我要提供什么，它会产出什么？
4. 需要哪些模型、Connector、权限或费用？
5. 来源是否可信，当前项目会用哪个版本？

悬停只做快速预览：封面或静音短视频、名称、一句话结果、最重要依赖。点击进入详情抽屉/页面，展示：

- 2–3 个真实 before/after 或输入/输出示例；
- 阶段时间线；
- 权限、数据去向、费用和平台兼容；
- 来源、许可证、版本、更新时间、评测结果；
- “用于当前任务”主动作；
- 更新时的权限差异和回退入口。

不在卡片上常驻安装、删除、更新、收藏、分享等一排按钮；低频管理动作进入详情或溢出菜单，符合现有控件层级规则。

### 7.2 Prompt、模式和 Skill 不再混为一个列表

当前 `CreationPromptPicker` 同时放模式、自定义 Prompt 和 Playbook，用户无法理解它们会如何改变行为。目标结构：

```text
主要方式（单选）
  自动 / 通用问答 / 写故事 / 写剧本 / 提示词 / 审校 / 用户 PromptRecipe

本轮能力（多选、相容才可）
  参考片分析 / 素材取证 / 声音设计 / 权利检查 ...
```

主要方式决定任务框架；Skill 只补方法；Connector 在需要时由 Skill/Workflow 申请，并显示数据流。用户无需理解底层五类合同，但界面不能假装它们是同一个东西。

### 7.3 项目库

不再主要按“本地/文件夹”分类。保留来源筛选作为次级维度，主视图增加可行动的智能视图：

- 继续创作：最近有编辑或进行中任务；
- 待处理：有失败任务、缺素材、待确认、权利未确认；
- 待审片：有新生成结果或 QA finding；
- 已交付：存在成功导出记录；
- 收藏/置顶；
- 客户、系列、平台标签。

这些是同一份项目记录的派生视图，不复制项目。项目摘要增加 `statusSignals`、`labels`、`lastAction`，状态从真实任务/导出/异常派生，用户标签才持久化。

### 7.4 素材库

素材库的主筛选维度：

- 类型：图片/视频/音乐/音效/文档；
- 用途：角色/场景/道具/风格/构图/动作/B-roll/音乐/音效；
- 来源：生成/本地/浏览器/Connector；
- 权利：可用/需署名/待确认/受限；
- 状态：候选/已选/已用于镜头/需替换；
- 关系：项目、场景、镜头、Prompt、Run。

文件夹仍可用，但不再承担创作语义。

### 7.5 失败体验

失败卡必须说明三件事：发生了什么、为什么、下一步是什么。例如：

- “这个 Skill 需要视频理解模型；当前只配置了文本模型” -> 打开模型目录并预筛可用模型。
- “该素材许可要求署名；当前导出清单未包含作者” -> 一键补入署名。
- “项目锁定 Skill 1.2.0，但本机只有 1.4.0” -> 下载锁定版本或查看升级差异。
- “Connector 将当前选区发送到外部服务” -> 显示发送字段、服务方和本次允许/取消。

## 8. 外部生态的接入策略

### 8.1 四级分流

| 级别 | 判定 | 处理 |
|---|---|---|
| 标准兼容导入 | 纯知识、Agent Skills 结构、许可证清楚、无脚本依赖 | 校验后转换为 KnowledgeSkill |
| Nomi 原生改造 | 方法有价值，但依赖 CLI/外部 Provider/另一套状态 | 重写输入输出，接 Nomi capability 和项目对象 |
| 只借鉴 | 架构或交互有价值，但许可证/运行时/范围冲突 | 记录设计来源，不复制实现 |
| 拒绝 | 泄露系统提示、未知许可、高权限、质量差或不可评测 | 不进目录，保留拒绝原因 |

### 8.2 首批 Nomi 原生能力

| 能力 | 借鉴来源 | 输入 | 输出 | 最关键的门 |
|---|---|---|---|---|
| 创作 Brief 访谈 | video-spec-builder、Pi structured question | 目标、平台、素材 | `CreativeBrief` | 冲突项不允许静默补猜 |
| 参考研究与证据 | last30days、pi-web-access `source_check` | 主题/时间范围 | `ResearchEvidence[]` | 引用片段、时间、来源质量 |
| 参考视频拆解 | video-use、OpenMontage | 视频/URL、研究问题 | 节奏/镜头/声音/时间码 | 观察与推断分开 |
| B-roll 与素材取证 | OpenMontage、Pexels/Openverse | 镜头需求 | 候选素材+权利证据 | 下载前确认用途与质量 |
| 通用视频提示编译 | OpenMontage | 镜头规格+模型档案 | prompt+参数建议 | 不写死 vendor；模型约束来自目录 |
| 声音设计 | sound-design Skill、Freesound | 镜头/情绪/对白 | 声音 cue 和素材候选 | 音乐/音效/环境声分轨语义 |
| 审片 | video-use、Nomi shotVerify | 成片/镜头目标 | 时间码 finding | 必须可定位、可采纳/忽略 |
| 权利与署名检查 | media-provenance-rights、pi-media | 使用中素材 | 异常与署名清单 | 不做“绝对合法”承诺 |
| 短视频营销改编 | marketingskills | 原片+平台 | 平台版本计划 | 保留品牌/事实约束 |
| 交付包装 | OpenMontage publish | 导出物+平台 | 文件、文案、署名、版本清单 | 发布/上传另需确认 |

### 8.3 Pi 插件的具体处理

| Pi 包/机制 | 对 Nomi 的真实价值 | 决策 |
|---|---|---|
| `pi-web-access` | 多源搜索、内容缓存、精确段落、`source_check`、视频理解 | 借鉴证据对象和 curator；浏览器与网络执行重写为 Nomi 原生 capability |
| `pi-multimodal-proxy` | 文本模型的图/音/视频描述、稳定媒体 id、压缩后召回、局部重查、数据出境同意 | P1 高价值改造：做 Nomi `MediaDigest`，不直接装 Extension |
| `@speclip/pi-media` | 不改原文件的编辑快照、内容哈希、联系表、来源凭证、no-clobber | 借鉴不可变快照和 provenance；不装，因 Windows 不支持且与 Nomi 时间轴/导出 owner 重叠 |
| `pi-mcp-adapter` | 快速接入外部 MCP 工具 | 只用作 Connector 兼容研究；Nomi 当前只有 MCP Server，需另做受控 Client 边界 |
| `rpiv-ask-user-question` | 结构化补问和 typed options | 优先吸收为统一 `AgentElicitation` 协议和 Nomi 卡片 |
| `rpiv-voice` | 看画面时口述修改 | P2 输入能力；转写预览后才发送，不改变 Agent 模式 |
| memory/background/subagent/goal | 展示长期任务和记忆机制 | 不接运行时；与项目记忆、ProductionRun、任务中心重复 |
| image/video generation 包 | 对话内直接调用 Provider | 不接；统一走模型目录、画布、预算确认和 ProductionRun |

## 9. 内容供应链与安全审核

```text
发现候选
-> 固定 source revision / npm tarball / content hash
-> 许可证与作者核验
-> 结构和大小校验
-> scripts/hooks/bin/postinstall 与依赖静态审计
-> Prompt injection / 数据出境 / 路径与网络权限检查
-> Nomi adapter
-> with/without 自动评测
-> 人工创作质量评审
-> 精选发布
-> 更新、撤回和旧项目锁定版本支持
```

### 9.1 导入限制

- Agent Skills 包：下载上限 10 MiB、解压后 25 MiB、最多 1,000 文件，可先对齐 `npx skills` 的防护语义。
- 路径必须规范化，拒绝绝对路径、`..`、符号链接逃逸和重复大小写路径。
- 视觉资源有 MIME、像素、时长和总字节限制；视频默认静音预览，不自动播放音频。
- 首期知识型包拒绝 `scripts/` 执行，只允许把脚本作为不可执行的人工审计材料。
- Prompt/Skill 文本进行秘密扫描、危险外链和指令越权扫描，但静态扫描不能替代人工和真实任务评测。
- 任何更新重新计算权限差异；新增网络域名、工具、数据类型或执行代码时视为重大更新，不能自动启用。

### 9.2 许可证规则

- MIT/Apache/BSD 不等于内容可直接复制；仍保存 NOTICE、作者和原始版本。
- AGPL/GPL 来源默认只做研究和设计借鉴，除非产品明确选择相应合规策略。
- 未声明许可证 = 不分发、不内置，只能记录为研究线索。
- Prompt 仓库也受版权和许可约束；公开可访问不等于可批量再发布。

## 10. 与现有代码的收口点

### 10.1 当前真相

| 事实 | 证据 | 设计约束 |
|---|---|---|
| Agent 工具按 capability 选择 | `electron/harness/agentChatPolicy.ts:35` | Skill 不得成为权限 owner |
| 工具调用再做作用域校验 | `electron/harness/agentChatPolicy.ts:46` | 新 Connector 也要走同一确认/作用域链 |
| Skill 当前整段注入 | `electron/harness/context/agentContext.ts:41` | 改成索引 + 按需资源，避免上下文膨胀 |
| system prompt 四层合成 | `electron/harness/context/agentContext.ts:75` | 扩展成 Prompt Compiler，不在各面板重复拼接 |
| 公共 Prompt 只支持图/视频文本与封面 | `electron/promptLibrary/promptLibraryTypes.ts:21` | 迁移为 PromptRecipe 或保留为 Showcase，不直接升格为 Agent 模式 |
| 自定义系统提示只存名字/正文 | `electron/settings/systemPromptsContract.ts:53` | 无法表达变量、兼容性、来源、评测，需要版本迁移 |
| Skill manifest 有 tools/providers/stages | `electron/skills/skillManifestSchema.ts:81` | 可演进，不再另建平行 manifest |
| Skill DTO 缺媒体/版本/许可/评测 | `electron/skills/skillIpc.ts:7` | 详情页所需信息从主进程统一给出 |
| 项目摘要缺标签和状态信号 | `src/workbench/project/projectRecordSchema.ts:27` | 分类需要 schema migration，不在 UI 临时计算多份 |
| AssetRef 只有基本来源线索 | `src/workbench/assets/assetTypes.ts:23` | 权利证据应落 sidecar/项目关系，而不是只加卡片标签 |
| 浏览器 profile 全局共享 | `electron/browser/core/browserViewSession.ts:18` | 项目研究上下文和登录身份要明确隔离策略 |

### 10.2 建议模块边界

```text
electron/capabilityCatalog/
  catalogSchema.ts
  catalogStore.ts
  catalogImport.ts
  catalogValidation.ts
  catalogEvaluation.ts
  catalogIpc.ts

electron/prompts/
  promptRecipeSchema.ts
  promptCompiler.ts
  promptMigration.ts

electron/connectors/
  connectorSchema.ts
  connectorRegistry.ts
  connectorPolicy.ts
  transports/

electron/skills/
  保留现有 owner，skillManifestSchema 演进并接 catalog id/version/hash

src/workbench/capabilityLibrary/
  目录、详情和状态视图

src/workbench/ai/
  只负责选择和展示激活状态，不持有目录真相
```

`capabilityCatalog` 管元数据、版本和发现；`skills` 管知识加载；`prompts` 管编译；`connectors` 管外部工具边界；现有 `harness` 管 Agent 会话与工具桥；ProductionRun 管生产状态和预算。模块名可以在实现前再按仓库命名收敛，但职责不能混。

### 10.3 IPC 草案

```text
nomi:capability-catalog:list(filters)
nomi:capability-catalog:get(id, version?)
nomi:capability-catalog:import-preview(source)
nomi:capability-catalog:import-confirm(reviewToken)
nomi:capability-catalog:update-preview(id)
nomi:capability-catalog:update-confirm(reviewToken)
nomi:capability-catalog:disable(id)
nomi:capability-catalog:remove(id)
nomi:capability-catalog:preflight(projectId, activation)
nomi:capability-catalog:evaluation(id, version)
```

所有写接口继续绑定 sender/window，主进程验证输入；渲染层不读取任意 Skill 绝对路径，不自己解压包或拉 GitHub。

## 11. 迁移策略

### 11.1 Prompt

1. `LibraryPrompt` 保留为展示型 prompt 示例，新增 `recipeId` 可选关联。
2. 用户“我的库”条目迁成最小 PromptRecipe：无变量、来源 local、evaluation 未运行。
3. `CustomSystemPrompt` 迁成用户主要方式；保留 id/name/body，不丢数据，补 version/hash 和明确 capability 语义。
4. 现有 7 个内置模式变成内置 PromptRecipe/Mode 定义的单一真相，删除选择器里的平行列表。
5. 迁移后旧文件只读导入一次，不双写。

### 11.2 Skill

1. 现有 `skill.json` 升 schema version，新字段全部可选以读取旧包。
2. 首次扫描为每个 Skill 计算内容哈希和来源；内置包来源由应用版本派生。
3. 旧 markdown-only Skill 仍可列出，但标记 `review-required`，默认不自动激活。
4. `SKILL.md` 从全量正文注入改为去 frontmatter 的主说明；references/assets 只在明确需要时加载。
5. `tools` 字段降为 requested capabilities 的兼容输入，不能直接决定暴露工具。

### 11.3 项目与素材

1. 项目 manifest 增加 `labels`、`capabilityLock`、`statusSignals` 的版本化字段。
2. 素材 sidecar 增加 `sourceEvidence`、`intendedRoles`、`relations`、`rightsStatus`。
3. 旧浏览器素材只有 `pageUrl` 时迁为 `rightsStatus: unknown`，绝不推断许可。
4. 旧项目没有能力锁时继续打开；第一次使用新能力才创建锁。

## 12. 评测系统

### 12.1 单个 Prompt/Skill 的对照评测

每个候选都跑：

```text
同一模型 + 同一 fixture + 同一预算
  A: 不启用候选
  B: 启用候选
比较结构断言、人工质量、token、时间、工具次数和失败恢复
```

不能只看最终回答“像不像更专业”。评分维度：

- 任务完成：是否生成要求的结构化结果；
- 可执行性：是否能直接落到项目/镜头/素材；
- 真实性：引用和素材来源是否可验证；
- 控制：是否在审批前写入或花费；
- 效率：轮次、人工补问、token、工具调用、耗时；
- 稳定性：重复三次是否保持关键字段；
- 退化：模型不支持、Connector 断线、版本缺失时是否给出正确出路。

### 12.2 十条真实用户旅程

| ID | 任务 | 成功标准 |
|---|---|---|
| J1 | 一句话产品 brief 变成 30 秒竖屏规格 | ≤5 个高信息问题；产出完整 CreativeBrief；冲突显式 |
| J2 | 研究近 30 天某视觉趋势 | 每条关键结论有来源、日期和引用片段；不可访问来源诚实标注 |
| J3 | 拆解一条参考视频 | 输出时间码、镜头、节奏、声音和可借鉴规则；不把内容照抄成方案 |
| J4 | 为三个镜头找 B-roll | 候选可预览；质量、许可、作者和用途齐全；下载失败有替代项 |
| J5 | 把一条镜头规格编译给两个视频模型 | 各模型参数合法；核心意图一致；无私自生成 |
| J6 | 给 60 秒片做声音设计 | 音乐/环境/动作/转场 cue 可定位；受限素材被排除或标记 |
| J7 | 用文本模型继续讨论之前的图片/视频 | 媒体稳定 id 可召回；压缩后仍可针对局部重查；有数据出境确认 |
| J8 | 审片并修三个连续性问题 | Finding 精确到镜头/时间码；采纳后形成可撤销提案 |
| J9 | 导出商业片 | 所有外部素材有来源状态；缺署名/未知许可只拦异常，不重查全部 |
| J10 | 三个月后打开旧项目 | 找得到所用 Skill/Prompt/Connector 版本；更新不改变旧项目结果 |

### 12.3 目标指标

首期不追“安装量”，追以下用户价值指标：

- 首次有效产出时间降低 30%；
- 研究/素材阶段跨窗口复制次数降低 60%；
- J1–J10 任务成功率 ≥85%；
- 因缺模型/Key/权限导致的中途失败减少 50%；
- 外部素材进入已用状态时，来源证据完整率 ≥95%；
- 旧项目能力版本可复现率 100%；
- Prompt/Skill with/without 对照中，至少一项主要任务质量提升且总成本增幅可解释；
- 任何可执行能力越权写入/花费为 0。

具体百分比在真实基线跑完后调整，但先定义采集口径，不能上线后才找指标。

## 13. 分期交付

### P0：先闭合价值链，不开市场

1. 定义 CatalogItem、PromptRecipe、能力锁和 AssetSourceEvidence 合同。
2. 收敛 Prompt Compiler；保留 capability 权限 owner。
3. 做首批四个内置 Nomi 能力：Brief 访谈、研究证据、参考片拆解、权利检查。
4. 浏览器增加“当前页/选区交给 Agent”和证据记录，不开放任意 DOM 自动化。
5. 项目库增加待处理/待审片智能视图；素材库增加用途/权利/状态筛选。
6. 建立 J1–J4、J9、J10 的 eval fixtures 和基线。

P0 出口：用户能从目标开始，经研究/素材进入项目，并能在导出前追溯；能力调用不需要理解插件类型。

### P1：精选生态和多模态增强

1. Agent Skills 受限导入、版本/哈希/许可证/评测链。
2. 能力详情页、封面/图片/悬停视频和更新差异。
3. Pexels/Openverse/Freesound 原生 Connector。
4. `MediaDigest`：稳定媒体 id、压缩后召回、局部重查、数据出境确认。
5. 声音设计、B-roll、视频提示编译、审片 Nomi-native Skill。
6. 评估受控 MCP Client，只做白名单 Connector，不加载 `pi-mcp-adapter` 运行时。

P1 出口：精选外部能力可安全进入真实创作，用户能看懂效果、依赖和版本。

### P2：团队和生态治理

1. 团队私有能力库、审核和分发。
2. Prompt/Skill A/B、版本回退和撤回通知。
3. 语音输入与转写预览。
4. 开发者模式下的隔离 ExecutableExtension 试验。
5. 发布包装、团队许可策略和审计导出。

P2 不以开放公有市场为默认出口；只有精选供应链运行稳定、撤回和安全事件机制验证后才另行评估。

## 14. 实现任务与文件责任

| 工作包 | 主要文件/模块 | 结构测试 |
|---|---|---|
| Catalog schema/store | 新 `electron/capabilityCatalog/*` | kind 判别、版本/hash、路径和大小限制 |
| PromptRecipe 与编译器 | `electron/promptLibrary/*`、`electron/harness/context/agentContext.ts` | 层级顺序、外部内容降权、身份/权限不可覆盖 |
| Skill schema v3 | `electron/skills/skillManifestSchema.ts`、`skillStore.ts`、`skillPackage.ts` | 旧包迁移、资源按需、tools 不授予权限 |
| Catalog IPC/bridge | `electron/main.ts`、preload/desktop bridge、`src/workbench/api/*` | sender 绑定、输入校验、错误不泄露绝对路径 |
| 能力库 UI | 新 `src/workbench/capabilityLibrary/*` | 类型/状态筛选、依赖缺口、版本差异 |
| Picker 收口 | `src/workbench/ai/CreationPromptPicker.tsx`、creation modes | 主要方式单选、Skill 多选、冲突预检 |
| 项目分类 | `projectRecordSchema.ts`、repository、`ProjectLibraryPage.tsx` | 状态派生唯一、标签迁移、不复制项目 |
| 素材证据 | `electron/assets/*`、`assetTypes.ts`、资产 UI | browser/connector/import 三入口同一证据合同 |
| Browser Agent bridge | `electron/browser/*`、harness descriptors | 只读范围、项目归属、prompt injection 隔离 |
| Connector runtime | 新 `electron/connectors/*` | 域名/工具白名单、取消、字节限制、数据出境确认 |
| Eval harness | `tests/e2e`、`electron/*/*.test.ts`、fixtures | with/without、J1–J10、旧项目复现 |

## 15. 验收门

### 15.1 产品验收

- 用户不需要先理解 Prompt/Skill/MCP/Plugin 才能完成 J1–J10。
- 卡片、详情、激活、运行中、失败、更新和撤回状态完整。
- 权限、费用、数据出境和许可异常在发生副作用前可见。
- UI 改动先出真实 Nomi 外壳样张并拍板，再实现和真机走查。

### 15.2 工程验收

- 目录、Prompt、Skill、Connector、Workflow 各有单一 schema owner。
- 新实现替代现有列表/拼接逻辑时，同一提交删除旧并行实现。
- 项目运行记录固定版本和哈希；离线打开不依赖远程目录。
- 可执行代码不在 Electron 主进程无隔离加载。
- capability、项目写入、预算和 ProductionRun 的 owner 不漂移。
- 所有迁移可重复执行、可恢复、无静默数据丢失。
- 全仓门禁和真实 Electron 旅程通过。

### 15.3 内容验收

- 每个精选能力有来源、许可、版本、输入、输出、依赖、失败样例和 eval。
- 每个 Skill 至少一个“不开 Skill”基线和一个启用测试。
- 人工创作评审不是只看语言流畅，而是检查能否直接进入下一创作阶段。
- 下架能力有替代建议和旧项目恢复策略。

## 16. 风险和反制

| 风险 | 早期信号 | 反制 |
|---|---|---|
| 目录变成另一个素材商城 | 首页大量卡片，用户仍不知道下一步 | 以项目阶段推荐为主，能力库为次；首期精选 ≤10 个 |
| 上下文被 Skill 撑爆 | token 上升、回答反而变差 | progressive disclosure、预算和资源按需加载 |
| Prompt 更新导致项目漂移 | 同一输入得出不可解释差异 | 版本/hash 锁定、eval、主动升级 |
| Connector 泄露私有内容 | 外部调用前用户看不到发送内容 | 数据出境清单、字段级预览、项目级授权 |
| Skill 绕过工具政策 | manifest.tools 直接暴露工具 | capability 继续唯一授权 owner，requested 只做 preflight |
| 第三方状态机分叉 | 包里又有项目、任务、记忆、预算 | 只适配输入输出；第三方 runtime 不进入生产 owner |
| 分类越做越重 | 每个对象都要求用户手动打十个标签 | 自动派生状态/关系，用户只维护少量客户/系列标签 |
| 星标和安装量误导 | 高热度候选真实任务无增益 | 热度只用于发现，准入看许可、安全和 with/without eval |

## 17. 需要用户拍板的产品决策

只有三项会改变产品方向：

| 决策 | 推荐 | 为什么 |
|---|---|---|
| 首期做精选能力还是开放市场 | **精选能力** | Nomi 的价值是完成创作，不是维护 5,000 个未知包；solo 团队也扛不住市场治理 |
| 能力库是独立一级入口还是项目内入口 | **项目内推荐为主，独立库为管理/探索** | 用户从任务出发，独立市场不应成为首屏 |
| 首批重点是生成更多还是研究/理解/审片 | **研究、理解、素材证据和审片** | 生成已有模型目录和画布；真正断裂的是生成前后的上下文、证据和决策 |

其余字段、模块拆分和测试策略属于实现细节，可按本方案自主推进。

## 18. 下一步

1. 用现有 Nomi 外壳制作三张可点击样张：能力库、Skill 详情、Agent 激活/预检。
2. 同时跑 J1–J4/J9/J10 的当前基线，填入真实时间、轮次和失败数据。
3. 样张拍板后只实施 P0，不把 P1/P2 的市场、MCP Client 或可执行 Extension 偷塞进首包。
4. P0 完成后用同一真实任务复跑，增益不足的能力不进入精选发布。
