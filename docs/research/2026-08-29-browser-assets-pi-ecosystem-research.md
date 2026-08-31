# Nomi 浏览器、素材资源与 Pi 扩展生态调研

> 调研日期：2026-08-29
> 状态：📎 研究交接；尚未进入生产实现
> 范围：内置浏览器、外部素材源、Pi Package/Extension/Skill、项目与素材分类、Prompt/Skill/Workflow/Connector/Plugin 的统一调用机制
> 证据边界：代码结论以当前工作树为准；外部能力以 2026-08-29 可访问的官方文档、本地安装的 Pi 官方文档和 npm 包信息为准。未安装或执行第三方 Pi 扩展，未使用付费素材 API 做真实调用。

## 0. 一句话结论

Nomi 不需要再造一个功能更多的普通浏览器，也不应该先造一个什么都能装的插件市场。最值得做的是一条完整的创作资源链：

> **带着项目意图去找资料 -> 判断是否可用 -> 指定在作品里的用途 -> 进入画布/时间轴 -> 导出时仍能追溯来源和许可。**

围绕这条链，浏览器是“研究与采集台”，素材站 API 是“合规的候选资源入口”，Skill 是“方法”，Workflow 是“分阶段执行”，Connector 是“外部服务桥”，Plugin/Extension 则是“高权限代码”。这五类东西可以共用目录和调用入口，但绝不能共用安全等级，也不应在用户眼里混成一种卡片。

## 1. 决策摘要

### 1.1 建议先做的四件事

| 优先级 | 建议 | 解决的真实摩擦 | 为什么现在做 |
|---|---|---|---|
| P0 | 建立统一的素材来源与许可记录 | 用户从网页拖进来后，不知道能否商用、该不该署名、来源是否还找得到 | 当前 sidecar 只有 `pageUrl`，一旦进入成片链就失去决策证据 |
| P0 | 给 Agent 一组受限的 Nomi 原生浏览器工具 | 用户要在浏览器、聊天和画布之间反复复制信息；Agent 看不到用户正在看的页面 | Nomi 已有安全浏览器和采集能力，只差通过 capability 接到 Agent，不需要再装一套浏览器自动化 |
| P0 | 项目库和素材库增加“智能视图 + 多维筛选” | 内容一多，靠文件夹和名称搜索找不到“接下来该处理什么” | 分类的核心不是更多文件夹，而是按状态、用途、许可、最近动作找到下一步 |
| P0 | 定义统一扩展描述与调用合同 | Prompt、Skill、Playbook、工具和外部服务在选择器里语义混乱，也无法统一展示兼容性和权限 | Pi Agent Host 和 Skill 导入已有在飞 PR；现在先定接缝，能避免它们各自再造目录与权限逻辑 |

### 1.2 建议接入的首批外部资源

- **Pexels**：首批图片/视频直连候选。API 和许可相对清楚，但仍要保存作者、来源页和许可快照，并遵守 API 的回链/署名要求。
- **Freesound**：首批音效直连候选。必须按单条素材许可过滤；商业项目默认排除 `CC BY-NC`，`CC BY` 自动生成署名。
- **Openverse**：首批聚合发现候选，可查图片和音频，返回 creator/license/license_url/attribution 等字段。它适合“发现”，不能替代原站权利核验。
- **Pixabay**：图片/视频的第二批直连候选。网页有音乐资源，但官方 API 文档当前只覆盖图片和视频，不能把网页音乐库当成可直接调用的音乐 API。

Unsplash 因 hotlink 和下载追踪规则与 Nomi 本地落盘模型存在接缝，放到后续；Jamendo 的普通开发者计划面向非商业应用，不能作为默认商业音乐源；Mixkit 未发现稳定公开 API，先保留为浏览器人工导入入口。

### 1.3 Pi 扩展的总判断

Pi 的生态值得利用，但应该**吸收能力和包格式，不把完整系统权限原样交给 Nomi 用户项目**。

- 可以优先适配：网页研究、MCP Connector、结构化问答、语音输入。
- 只借鉴实现思想：第三方记忆、后台任务、目标管理。
- 不直接引入：通用浏览器自动化、图片生成插件、动态多 Agent/workflow 执行器。它们分别与 Nomi 浏览器、模型目录、`ProductionRun`/Project Agent Host 重叠。
- 第三方知识型 Skill 可以走受限导入；可执行 Extension 必须进入开发者模式、隔离执行、权限清单、版本锁定和审计流程。

Pi 官方 Package 文档明确写明：Package 拥有完整系统访问，Extension 可执行任意代码，Skill 也可能指示模型执行程序。这个风险不能靠一张“已安装”提示解决。

## 2. 研究边界与方法

本轮同时核对了四类证据：

1. Nomi 当前代码与架构文档，确认已经具备什么、哪里是真断点。
2. Pexels、Freesound、Openverse、Pixabay、Unsplash、Jamendo、Mixkit 的官方 API/许可页面。
3. Nomi 当前安装的 `@earendil-works/pi-coding-agent@0.84.3` Package 文档与 npm 可发现包。
4. 当前仍在进行中的 PR，避免与 Skill 标准导入、Agent Host、MCP 生成链、时间轴和 Agent 对话设计重复规划。

限制：

- 本轮没有下载并执行第三方 Pi 包，因此“推荐接入”不等于“已完成源码安全审计”。
- npm 下载量、更新时间和 GitHub 活跃度只适合作为候选筛选信号，不能替代代码审查、依赖审计和真实任务验证。
- 外部素材的许可结论不是法律意见。产品要提供证据、规则和风险提示，不能向用户承诺绝对无权利风险。
- `pnpm run radar:models` 本轮因网络 `fetch failed` 未完成；不能据此声称当天没有新增模型。仓库要求的 `nomi-research-radar` Skill 在本机和仓库中均未找到，因此本报告不包含当天论文雷达。

## 3. Nomi 当前能力与断点

### 3.1 已经有的基础

Nomi 已不是从零开始。当前浏览器已经具备：

- 多标签、书签、搜索。
- 网页图片与视频捕捞。
- 带 Cookie/Referer 的会话下载。
- `blob:`、`data:` URL 和 MSE 当前帧降级处理。
- 选区截图、提示词提取。
- 素材盒、文件夹、多选、拖入画布。
- Electron `sandbox`、`contextIsolation`，页面权限默认拒绝。

因此问题不在“能不能下载一张图”，而在下载之后是否变成一个**可理解、可追溯、可用于具体镜头**的创作资源。

### 3.2 当前关键断点

| 断点 | 当前事实 | 后果 |
|---|---|---|
| Agent 与浏览器断开 | 浏览器能力没有作为受限 capability 暴露给 Agent | 用户反复复制网址、文本、截图；Agent 无法围绕当前页面继续研究 |
| 浏览器只捕捞图/视频 | `BrowserMediaKind` 当前没有 audio | 用户找配乐/环境声/音效时又回到系统下载与手工导入 |
| 素材来源证据不足 | sidecar 保存 `pageUrl`，缺 creator、license、attribution、provider asset ID、许可快照 | 进入项目后无法判断能否商用，导出时也无法生成署名 |
| 导入后没有语义 | 素材主要按文件夹、来源、类型组织 | Agent 不知道一张图是角色参考、场景参考还是构图参考 |
| 浏览器 profile 全局共享 | 使用 `persist:nomi-browser-profile`，不是项目隔离 | 不同客户项目共用 Cookie/历史；研究上下文与登录身份没有边界 |
| 两区会话仍分裂 | 创作区与生成区保留两份历史 | 浏览器研究结论难以稳定跟随项目跨区使用 |
| Skill 主要是提示注入 | 工具权限按 `capability` 选择，不按 `skillKey` | 这是正确安全方向，但目前 Skill 的“需要哪些能力”与运行时 preflight 未形成清晰产品合同 |
| Skill 卡信息不足 | 只有图标、名称、两行描述、模型依赖和操作 | 用户无法判断效果、适用阶段、输入输出、权限、兼容性和可信度 |
| Skill 包视觉能力不足 | 当前包仅允许 `.md/.json/.txt`，manifest 无封面/视频/兼容范围/信任元数据 | 做不出用户提出的封面、悬停视频与完整详情页；也无法解释更新风险 |
| 项目库分类不足 | 只有名称搜索和“全部/Nomi 项目/文件夹项目” | 项目多后无法按进度、客户、系列、异常、收藏和待审找到工作 |

主要代码证据：

- `electron/browser/core/browserViewTypes.ts`
- `electron/browser/core/browserViewSession.ts`
- `electron/harness/agentChatPolicy.ts`
- `electron/harness/context/agentContext.ts`
- `src/workbench/library/ProjectLibraryPage.tsx`
- `src/workbench/assets/assetTypes.ts`
- `src/workbench/skillLibrary/SkillCard.tsx`
- `electron/skills/skillPackage.ts`
- `electron/skills/skillManifestSchema.ts`
- `src/workbench/ai/CreationPromptPicker.tsx`

## 4. 用户是谁，他们真正想完成什么

### 4.1 五类核心用户

| 用户 | 心里想的不是 | 真正任务 | 最容易卡住的地方 |
|---|---|---|---|
| 新手创作者/自媒体运营 | “我要配置一个 Agent” | 从一个选题尽快得到可发的短片 | 不知道搜什么、素材能否用、下一步点哪里；术语和选项太多 |
| 有经验的导演/剪辑师 | “帮我全自动做完” | 快速找参考、比较方案，同时保留镜头和节奏控制 | Agent 不理解素材用途；建议无法定位到镜头；采纳后难撤销或追溯 |
| 商业内容团队/工作室 | “找一些免费图” | 在客户、系列和交付期之间复用资产并降低权利风险 | 项目和素材失去分类；团队不知道素材出处、授权范围和是否已用于别处 |
| AI 工作流玩家 | “只有一个聊天框” | 组合 Skill、模型、外部数据源和 Workflow | Skill/Prompt/工具边界不清；生态包不兼容；权限与失败原因不可见 |
| 维护者/管理员 | “插件越多越好” | 让扩展可升级、可禁用、可审计，不破坏项目 | 任意代码、依赖漂移、重复状态机、连接器泄露数据、包升级导致旧项目不可复现 |

### 4.2 一条真实创作链

```text
目标/脚本
  -> 研究主题、风格和参考作品
  -> 找到候选图片/视频/音乐/音效
  -> 判断质量、来源、许可与项目适配性
  -> 指定用途并进入项目
  -> 用于 Prompt、分镜、生成参考或时间轴
  -> 审片、替换、补缺
  -> 导出并保留来源/署名/决策记录
```

用户遇到的多数失败不是“模型不会生成”，而是链条中间断了：找到了但拿不进来、拿进来但 Agent 不知道怎么用、用了但导出时不知道是否合法、下周再打开时又找不到当时的判断。

## 5. 浏览器在创作链路中的卡点

### 5.1 卡点矩阵

| 阶段 | 用户卡点 | 根因 | 产品解法 | 优先级 |
|---|---|---|---|---|
| 形成搜索词 | 用户有“阴雨天旧城区追逐”的意图，却不知道该拆成场景、服装、镜头、声音哪些查询 | 浏览器不知道项目 brief、镜头和角色上下文 | Agent 从当前项目生成可编辑的研究清单和查询组 | P0 |
| 搜索与比较 | 普通搜索结果混着教程、低清图、营销页和不可用素材 | 搜索没有“参考/可出片”“类型/比例/时长/许可”筛选 | 统一搜索面板区分网页研究与结构化素材源，展示来源和许可状态 | P1 |
| 读取当前页 | 用户看到有价值页面，Agent 却不知道页面内容 | 页面上下文未进入 Agent，复制粘贴成本高 | 明确的“把当前页/选区交给 Nomi”上下文 chip；网页内容标记为不可信证据 | P0 |
| 判断可用性 | “免费下载”容易被理解为“可随意商用” | 页面许可、单素材许可、肖像/商标权是不同层 | 导入前显示 `参考素材/待确认/可商用/需署名/受限`，不要只显示下载按钮 | P0 |
| 抓取与下载 | 登录、反盗链、blob/MSE、低清缩略图、格式不兼容会导致静默失败 | 来源形态多，下载结果和预览不是一回事 | 保留当前多级降级，但把失败原因、实际质量和替代动作结构化 | P0 |
| 音频获取 | 浏览器只能捕捞图/视频，声音回到系统下载 | 媒体模型没有 audio，素材盒也缺音频预听/波形入口 | 增加 audio 候选、试听、许可字段和“作为音乐/音效/环境声”导入 | P1 |
| 导入归类 | 素材进了文件夹，但之后没人知道用途 | 文件类型被误当成创作语义 | 导入动作必须能表达角色、场景、风格、构图、动作、音乐、音效等用途 | P0 |
| 进入创作 | 拖到画布后，Prompt/分镜/生成引用仍要人工重讲一遍 | 素材、镜头、Prompt 之间没有显式关系 | 建立资源关系：`asset -> intendedRole -> scene/shot/prompt/run` | P1 |
| 跨区继续 | 创作区研究完，生成区 Agent 不记得结论 | 两份会话历史和上下文 owner 分裂 | 研究结论落项目资源/决策记录，不依赖聊天记录搬运；会话统一跟随 Agent Host 路线 | P0 依赖 |
| 导出交付 | 成片完成后才发现素材不明或署名漏了 | 权利检查发生得太晚 | 在使用时持续显示状态；导出前生成“来源与署名检查”，只处理异常 | P1 |
| 隐私与攻击 | 登录网页、客户资料和网页提示注入可能影响 Agent | 全局 profile、网页内容与工具执行边界不清 | 项目研究记录隔离；网页只读默认；内容不得改变系统指令或自动获得写/付费能力 | P0 |

### 5.2 浏览器应该增加什么，不应该增加什么

应该增加：

- 项目上下文驱动的研究任务和查询建议。
- 当前页/选区显式交给 Agent 的动作。
- 素材用途、来源、许可、实际下载质量。
- 结构化素材源的统一搜索结果。
- 从“候选”到“已用于哪个镜头”的关系。
- 可恢复的导入进度、失败原因和替代方案。

暂不增加：

- 密码管理、阅读模式、扩展商店等通用浏览器竞争面。
- Agent 任意点击、提交表单、登录和执行页面脚本。
- 默认把任何网页图片标成可出片素材。
- 另一个与 Pi Extension 并行的浏览器自动化运行时。

### 5.3 Agent 的最小浏览器工具面

第一阶段只暴露 Nomi 已知语义的原生工具，不开放通用 DOM 自动化：

| 工具语义 | 能做什么 | 默认权限 | 明确禁止 |
|---|---|---|---|
| `browser.search` | 以项目查询词打开搜索或结构化素材结果 | 只读 | 自动登录、绕过站点限制 |
| `browser.read_current_context` | 读取用户明确选中的页面/文本/媒体摘要 | 用户选定范围内只读 | 隐式读取其它 tab、Cookie、表单值 |
| `browser.list_media_candidates` | 列出当前页可捕捞媒体与质量 | 只读 | 宣称许可已核验 |
| `browser.save_reference` | 保存网页、选区或截图为研究证据 | 写项目研究记录 | 直接写时间轴或覆盖正式素材 |
| `browser.import_asset` | 下载用户选择的媒体并创建资源记录 | 写素材库；显示来源/用途 | 无用途、无来源静默入库 |
| `browser.capture_region` | 生成选区截图并关联来源 | 写参考素材 | 把截图自动标为可商用 |

真正执行权限仍由 `capability` 决定：Skill 只能声明“需要什么能力”，不能因为被选中就给自己授权。网页内容始终是不可信输入，不能覆盖系统指令、改变预算或触发付费/项目写入。

### 5.4 profile 与项目隔离建议

不建议简单地给每个项目复制一套完整浏览器 profile，这会让用户重复登录并制造大量存储。建议分开两层：

- **账户会话层**：默认仍可复用用户登录状态，但清楚显示当前身份，并允许“临时隔离会话”。
- **项目研究层**：标签页集合、保存的网页、选区、搜索记录、导入关系和许可证据按项目隔离。

商业/客户项目可开启严格模式：临时 profile、关闭跨项目历史建议、导出后可清理会话数据。这样兼顾登录便利和项目边界。

## 6. 素材资源调研

### 6.1 候选源评估

| 来源 | 可调用内容 | 官方事实与约束 | Nomi 适配判断 |
|---|---|---|---|
| Pexels | 图片、视频 REST API | API Key 放 `Authorization`；默认 200 次/小时、20,000 次/月；API 要求显著回链并尽可能署名；许可允许免费使用和修改，但禁止未修改转售、图库式再分发、暗示人物/品牌背书、作为商标等 | **P1 直连**。字段清楚、创作适配高；保存 photographer、source page、Pexels ID、许可快照和回链 |
| Freesound | 音效及部分音频 API | Token/OAuth2；单素材可能为 CC0、CC BY、CC BY-NC；用户上传仍可能有权利瑕疵 | **P1 直连**。商业项目默认过滤 NC，BY 自动署名；优先 sound effect，不把所有音频都当可商用音乐 |
| Openverse | 图片、音频聚合 API | 匿名/注册用户均可用且有 rate limit；可按 commercial/modification/license 过滤；详情返回 creator、license、license_url、provider、source、attribution；禁止把 API 当批量爬取工具 | **P1 发现层**。字段最适合建立证据模型，但必须回到 `foreign_landing_url`/原始来源复核，不把聚合结果当法律保证 |
| Pixabay | 图片、视频 API | API Key；支持搜索、类型和视频；License 允许免费使用、无需强制署名、可修改，但禁止 standalone 分发、部分商标商业使用、误导性使用等；第三方权利由用户判断 | **P1/P2 直连**。作为 Pexels 补充；网页音乐不等于官方音乐 API，先不直连音乐 |
| Unsplash | 图片 API | Demo 50 次/小时，生产批准后常规 1,000 次/小时；必须 hotlink API 返回的图片 URL；下载要调用 `download_location`；API 另有回链/署名要求 | **P2**。图片质量高，但 hotlink/下载追踪和本地优先落盘要专项设计，不能用普通“下载后脱离来源”适配 |
| Jamendo | 音乐 API | 可搜索大量音乐；普通开发者计划页面明确面向 Non-Commercial Apps，商业用途走 Jamendo Licensing | **不做默认免费源**。后续如有商业授权合作再接，避免用户误以为搜索到即可商用 |
| Mixkit | 视频、音乐、音效、模板网页资源 | 不同内容类型有不同 License；未发现稳定公开 API | **浏览器入口**。可人工发现与按页面许可导入，不列入首批 Connector |

### 6.2 推荐的来源组合

首个可验证组合不是“接最多站点”，而是覆盖三类创作缺口：

1. **Pexels：图片 + 视频**，验证结构化搜索、预览、导入和回链。
2. **Freesound：音效**，验证单素材多许可证、自动过滤和署名。
3. **Openverse：跨源图片 + 音频发现**，验证聚合结果回源、许可字段和风险分层。

这个组合能验证统一模型是否真的通用。如果三者都需要各写一套 UI、许可状态和导入流程，说明底层合同还没有收口，不应继续扩站点。

### 6.3 统一资源证据模型

当前 `AssetRef` 不应被塞入所有研究/许可字段。建议在项目资源层增加单一 `ResourceRecord`，本地素材通过 `assetId` 关联：

```ts
type UsageStatus =
  | 'reference_only'
  | 'rights_unknown'
  | 'requires_attribution'
  | 'cleared'
  | 'restricted'
  | 'blocked'

type IntendedRole =
  | 'character_reference'
  | 'scene_reference'
  | 'style_reference'
  | 'composition_reference'
  | 'action_reference'
  | 'music'
  | 'sound_effect'
  | 'ambience'

interface ResourceRecord {
  id: string
  projectId: string
  assetId?: string
  kind: 'web_page' | 'image' | 'video' | 'audio' | 'document'
  intendedRoles: IntendedRole[]

  provider?: string
  providerAssetId?: string
  sourcePage: string
  directMediaUrl?: string
  creator?: string
  creatorUrl?: string

  license?: string
  licenseUrl?: string
  attribution?: string
  licenseSnapshot?: {
    checkedAt: string
    termsUrl: string
    termsHash?: string
  }
  usageStatus: UsageStatus
  usageReason?: string
  userRightsAssertion?: string

  captureQuality?: {
    width?: number
    height?: number
    durationMs?: number
    mimeType?: string
    isOriginal?: boolean
  }
  downloadedAt?: string
  contentHash?: string
}
```

设计原则：

- 网页捕捞默认 `reference_only` 或 `rights_unknown`，绝不因为“下载成功”变成 `cleared`。
- 结构化 provider 可以根据单条素材和项目用途派生状态，但要保存规则版本和原始字段。
- `contentHash` 用于去重和确认同一素材，`providerAssetId` 用于回源和更新。
- 许可状态属于“某素材在某项目用途下的判断”，不是文件本身永远不变的属性。
- 导出检查只列异常和需署名项，不让用户阅读一整份法律表格。
- Nomi 给出证据和合理默认，不代替用户对肖像、商标、隐私、场地产权等第三方权利负责。

### 6.4 用户看到的许可体验

不要让用户面对 SPDX 或 Creative Commons 术语墙。素材卡只需要显示可行动状态：

- **仅作参考**：可用于 Prompt/风格/构图参考，不直接进入成片。
- **待确认**：来源或使用范围不完整，成片使用前处理。
- **可用于当前项目**：规则已匹配当前项目用途。
- **需要署名**：可使用，Nomi 会把署名加入交付清单。
- **不可用于当前项目**：例如商业项目中的 BY-NC。

点击详情时再展开原始许可、作者、来源、检查日期和风险说明。

## 7. Pi Agent 插件与 Skill 筛选

### 7.1 Pi 生态能提供什么

Pi 官方支持五类可打包资源：Extension、Skill、Prompt Template、Theme 和由 npm/git 分发的 Pi Package。Extension 可以注册工具、命令、事件与 UI；Skill 对齐 Agent Skills；Package Gallery 元数据支持 `pi.image` 和 `pi.video`，其中视频可在桌面端悬停预览、点击全屏。

这正好验证了用户提出的 Skill 展示方向是可行的，但 Nomi 应复用元数据思想，不直接复刻 Pi 的权限模型。

### 7.2 候选筛选

| 候选 | 价值 | 与 Nomi 的关系 | 建议 |
|---|---|---|---|
| `pi-web-access` | 网页搜索、抓取、PDF、视频理解 | 与 Nomi 浏览器互补，但若直接装会绕过项目证据链和浏览器权限 | **适配能力，不直装**：搜索/读取结果接到 Nomi 原生浏览器工具与 `ResourceRecord` |
| `pi-mcp-adapter` | 接入大量 MCP Server | 能快速获得文档、云服务和垂直数据能力 | **P1 受控 Connector**：域名/Server/工具白名单、输入输出审计、按能力审批、项目级启停 |
| `@juicesharp/rpiv-ask-user-question` | 结构化选择、补充信息 | 适合创作 brief、候选比较、执行前确认 | **优先借鉴 UI 与协议**：复用 Nomi Agent 对话词表，不引入另一套对话组件 |
| `@juicesharp/rpiv-voice` | 本地语音输入 | 创作者在看画面时口述修改比打字自然 | **P2**：作为输入方式，不做独立 Agent 模式；要有设备权限和转写预览 |
| `pi-memory` / `pi-hermes-memory` | 长期记忆、检索与压缩 | 可能改善跨轮对话，但会与 Nomi 项目记忆形成双真相源 | **只借鉴检索/压缩**：所有持久事实仍写入 Nomi Project Agent Host/项目资源层 |
| `pi-background-tasks`、目标管理类包 | 后台执行、追踪目标 | 与 `ProductionRun`、任务队列、Project Agent Host 重叠 | **不接入运行时**：可参考状态呈现，不再造第二套任务 owner |
| `pi-agent-browser-native` | 通用浏览器操作 | 与内置浏览器重叠，且任意网页操作权限过大 | **不引入**：用 Nomi 最小浏览器工具面 |
| image-gen 类 Pi 包 | 对话内生成图片 | 与模型目录、参数档案、画布节点、花费确认重叠 | **不引入**：统一调用 Nomi generation capability |
| 动态 workflow/subagent 扩展 | 任意编排多个 Agent | 容易绕过 Run、预算、写回和恢复语义 | **暂不引入**：垂直 Workflow 只能编排 Nomi 声明式 capability |

### 7.3 引入第三方包的安全门

| 层级 | 允许内容 | 默认信任 | 运行方式 |
|---|---|---|---|
| Nomi 内置 | 官方 Skill、Workflow、Connector | 内置签名/版本锁定 | 随应用发布，走统一 capability |
| Nomi 精选 | 完成源码、依赖、许可和真实任务审计的第三方包 | 明确“经审核” | 固定版本、可撤回、最小权限 |
| 知识型 Skill | `SKILL.md`、references、文本/视觉说明资产 | 不授工具权限 | 只做上下文与方法注入；拒绝 scripts/bin/hooks |
| 本地自定义 | 用户自己的 Prompt/Skill/Workflow 声明 | 仅当前用户/项目 | 显示来源；不默认分享或暴露给外部 MCP |
| 可执行 Extension | TypeScript/JavaScript、进程、网络访问 | 默认不信任 | 仅开发者模式；隔离进程、权限清单、网络范围、版本锁和审计日志 |

安装前至少核对：包来源、作者、许可证、版本、内容哈希、依赖与 postinstall、声明权限、网络域名、数据去向、兼容的 Nomi/Pi 版本。升级不是普通刷新，必须显示权限变化并允许回退到项目锁定版本。

## 8. 项目库、素材库和扩展库的分类

### 8.1 核心原则：一个真相源，多种智能视图

用户说“要分类”时，直觉方案是继续加文件夹，但文件夹无法回答：

- 哪些项目正在等我审？
- 哪些素材许可不完整？
- 哪些角色参考被 12 个镜头使用？
- 上周给某客户做的竖屏悬疑短片在哪？
- 哪些 Skill 更新后可能影响旧项目复现？

因此底层保留一个物理 owner，上层用字段、关系和保存查询形成智能视图。文件夹可以继续存在，但不是唯一分类方式。

### 8.2 项目库

默认常驻视图控制在少量、可行动的集合：

- 最近继续。
- 进行中。
- 等待处理：缺素材、生成失败、待审、许可异常。
- 已交付。
- 收藏。
- 归档。

筛选维度按需展开：项目阶段、客户/系列、内容类型、比例、负责人、更新时间、使用的 Workflow、标签。用户可保存组合筛选为自定义视图，不复制项目。

建议项目生命周期使用产品已有状态 owner 派生，避免为项目库再造一套相近词表。当前建议语义是“筹备/研究/制作/审核/交付/归档”，最终命名应与 Project Agent Host 和 Agent 对话词表对账后落地。

### 8.3 素材库

素材需要同时支持五种找法：

| 维度 | 示例 |
|---|---|
| 媒体类型 | 图片、视频、音乐、音效、文档、网页证据 |
| 创作用途 | 角色、场景、风格、构图、动作、音乐、环境声 |
| 生命周期 | 候选、已采纳、正在使用、未使用、已归档 |
| 来源与权利 | 本地、网页、生成、Pexels；待确认、需署名、可用、受限 |
| 项目关系 | 用于哪个场景/镜头/Prompt/Run/时间轴片段 |

高价值智能视图：重复素材、缺来源、许可异常、低清候选、已用于成片、未使用的大文件、被多个镜头复用的核心资产。

### 8.4 Prompt、Skill、Workflow、Connector 与 Extension 目录

目录可以统一搜索，但必须让用户一眼看出类别和后果：

| 类型 | 用户理解 | 作用 | 是否执行代码/外部操作 |
|---|---|---|---|
| Prompt | “换一种回答/创作方式” | 改变当前请求的指令和表达 | 否 |
| Skill | “让 Nomi 用某种专业方法做” | 按需提供方法、约束、例子 | 本身否；只声明所需 capability |
| Workflow/Playbook | “按一套步骤完成一类任务” | 多阶段编排、检查点、输入输出 | 由 Nomi runtime 执行声明式步骤 |
| Connector | “连接一个外部资源或服务” | 搜索/读取/写入外部系统 | 是，受域名、工具与数据权限约束 |
| Extension/Plugin | “给 Nomi 增加代码能力” | 注册工具、事件或 UI | 是，高风险，默认不面向普通用户 |

当前 `CreationPromptPicker` 把 Prompt 与 Playbook 分组、又只展示 `isPlaybook` Skill，容易让用户误以为它们只是不同模板。建议改为统一 Catalog 的不同 tab/筛选，而不是继续往一个选择器里加组。

## 9. Skill 展示与调用体验

### 9.1 Skill 卡片应该回答的五个问题

用户悬停或点开 Skill 时，不是为了看一段营销文案，而是快速判断：

1. 它能帮我得到什么结果？
2. 适合当前项目的哪个阶段？
3. 我需要提供什么，它会产出什么？
4. 它要用哪些模型、工具、外部服务和权限？
5. 这个版本可信、兼容、可复现吗？

紧凑卡片只显示：封面、名称、结果型一句话、阶段/媒介标签、信任/安装状态。桌面悬停可静音播放短视频，触屏点击进入详情；视频加载失败必须回到封面，不能让布局跳动。

详情页再展示：

- 演示视频/图片和真实输入输出例子。
- 适用/不适用场景。
- 输入、输出和可调整项。
- 所需 capability、模型、Connector、付费与写入风险。
- 作者、来源、版本、兼容范围、更新时间、内容哈希和变更记录。
- 安装、试用一次、加入当前项目、固定到输入框等动作。

### 9.2 统一扩展描述合同

建议在现有 Skill manifest 上抽出公共描述层，而不是把 Connector/Extension 字段全部塞进 Skill：

```ts
interface CatalogDescriptor {
  id: string
  kind: 'prompt' | 'skill' | 'workflow' | 'connector' | 'extension'
  name: string
  description: string
  outcome?: string
  version: string
  author?: string
  source?: string

  categories: string[]
  tags: string[]
  mediaTypes?: Array<'text' | 'image' | 'video' | 'audio'>
  stages?: string[]

  visual?: {
    coverImage?: string
    demoVideo?: string
    gallery?: string[]
  }
  compatibility?: {
    nomi?: string
    pi?: string
    platforms?: string[]
  }
  requiredCapabilities?: string[]
  permissions?: string[]
  inputs?: unknown
  outputs?: unknown
  examples?: unknown[]
  trust?: {
    origin: 'builtin' | 'curated' | 'local' | 'third_party'
    reviewedAt?: string
    contentHash?: string
  }
}
```

视觉资产不能继续塞进只允许文本的 Skill 文件列表。可以借鉴 Agent Skills 的 `assets/` 结构和 Pi 的 `pi.image`/`pi.video` 元数据，但二进制资源要有尺寸、类型、总量限制与路径安全；可执行目录仍与知识型 Skill 分开。

### 9.3 三种调用方式

1. **Agent 自动建议**：根据当前阶段和意图提出一个 Skill/Workflow，解释会带来什么结果，用户不必先逛市场。
2. **输入框显式固定**：用户通过 `@` 搜索并固定 Skill、资源或 Connector 到本次请求；chip 清楚显示类别。
3. **从目录试用/加入项目**：详情页“试用一次”生成可撤销的候选；确认后再固定到项目，不因浏览卡片自动安装或授权。

“模式”只决定当前 Agent 可以探索、提案还是执行，不应被用来伪装 Skill 类别。Skill 选择也不能绕过 capability。运行时取交集：

```text
当前宿主/模式允许的 capability
  ∩ Skill/Workflow 声明需要的 capability
  ∩ 项目与用户策略允许的 capability
  = 本次实际可调用工具
```

### 9.4 一次调用的完整机制

```text
用户意图/显式 @ 引用
  -> Catalog 解析类型、版本、输入输出和依赖
  -> Agent 形成候选计划
  -> capability / 权限 / 花费 / 外部数据 preflight
  -> 必要时用结构化问答补信息或确认
  -> Nomi 原生执行器/Connector 执行
  -> 产出 Artifact、ResourceRecord、Proposal 或项目写入
  -> 记录调用版本、来源、权限、结果和可撤销动作
```

失败也必须落在同一机制里：缺输入就问具体问题，缺权限就说明需要什么，版本不兼容就给升级/固定旧版选择，外部源失败就保留查询与重试点，不把“什么都没发生”留给用户。

## 10. 目标体验示例

用户在一个竖屏国风悬疑项目里说：“给第三场找雨夜旧城的场景参考，再找一段紧张但不喧闹的环境声。”

理想路径：

1. Agent 读到第三场、9:16、角色服装和商业项目属性，给出两组可编辑查询，不直接开始下载。
2. 浏览器打开“网页参考”和“可用素材”两个结果面；Pexels/Openverse/Freesound 结果显示来源与许可状态。
3. 用户选中一张构图图、一张场景图和一个音频。导入动作已经带上“构图参考/场景参考/环境声”，不再弹空文件夹选择作为主要决策。
4. 网页截图默认只作参考；Freesound 的 CC BY 音频显示“需要署名”，署名内容自动进入项目交付清单。
5. 回到创作/画布后，Agent 能说清每个资源用于哪个场景或镜头。模型只收到需要的引用，不把整页网页内容塞进 Prompt。
6. 导出时只提示一个仍为“待确认”的素材和一个自动生成的署名项。用户无需重新追查浏览历史。

这条体验比“装了 20 个素材插件”更有价值，因为它把发现、决策、使用和交付连成了同一条事实链。

## 11. 与当前在飞工作的边界

| 在飞 PR | 已覆盖内容 | 本报告如何衔接 |
|---|---|---|
| [#195](https://github.com/aqm857886159/Nomi/pull/195) | 裸 `SKILL.md`/zip、Agent Skills references/assets 结构、拒绝 scripts/bin/hooks、Skill 私有性与两份后续方案 | 不重做 Skill 导入；采用“知识型 Skill 不授执行权限”的边界，补视觉元数据、Catalog 和调用合同 |
| [#194](https://github.com/aqm857886159/Nomi/pull/194) | Agent 对话词表、状态、Skill 交互形态、控件规格 | Skill 详情、结构化问答、调用状态应复用该词表和组件，不建立新状态族 |
| [#223](https://github.com/aqm857886159/Nomi/pull/223) | Project Agent Host、队列、Proposal、命令账本、持久化和 capability 接线 | 浏览器工具、Catalog 调用记录和跨区项目上下文接入它；不再造会话/任务 owner |
| [#202](https://github.com/aqm857886159/Nomi/pull/202) | MCP 四镜生成真实旅程审计，发现引用只显示数量、不显示角色等问题 | `IntendedRole` 和资源关系直接补“引用是谁、做什么”的缺口；Connector 也要进入同一审计链 |
| [#179](https://github.com/aqm857886159/Nomi/pull/179) / [#207](https://github.com/aqm857886159/Nomi/pull/207) | 时间轴能力盘点、EditPlan、内部 Agent timeline capability 与外部对标 | 本报告不重做自动剪辑；素材写入时间轴只能走既有 Proposal/Apply/Undo 路径 |

开始实现前应先确认这些 PR 的最终合并状态和 schema owner。尤其 #195、#223 当前仍有冲突或处于 Draft，不能把分支里的设计误写成已发布能力。

## 12. 分期路线

### P0：先闭合“发现到可用”

1. 扩展素材 sidecar/项目资源层，落 `ResourceRecord`、用途、许可状态、内容哈希和迁移。
2. 网页导入默认参考/待确认；素材卡与导出前异常清单能读写同一状态。
3. 增加受限的浏览器只读/导入 capability，经 Project Agent Host 接线；不开放通用 DOM 自动化。
4. 导入时选择创作用途，并建立资源到场景/镜头/Prompt/Run 的关系。
5. 项目库和素材库增加智能视图、组合筛选与保存视图；继续保留文件夹但不复制实体。
6. 定稿 `CatalogDescriptor` 与调用 preflight，和 #194/#195/#223 的 owner 对账。

P0 验收任务：

- 用户从当前网页保存一个场景参考，回到生成画布后 Agent 能准确引用其用途和来源。
- 一个来源不明网页素材不会被自动标成可商用。
- 用户能在两步内找到“当前项目许可异常的素材”。
- 创作区研究结论不依赖复制聊天记录就能在生成区继续使用。
- 网页内容不能触发付费、项目写入或权限升级。

### P1：接入首批资源与 Skill 详情

1. 用统一 Connector 接 Pexels、Freesound、Openverse；通过同一结果模型进入浏览器/素材盒。
2. 增加音频候选、试听、波形摘要和音乐/音效/环境声用途。
3. 上 Skill/Workflow 详情页、封面、短视频、真实例子、权限与兼容信息。
4. 接结构化问答能力，用于 brief、候选比较和执行确认。
5. 增加署名清单和来源证据导出；对规则变化/链接失效做状态刷新。

P1 验收任务：

- 同一搜索可比较 Pexels、Openverse 和网页参考，但状态与来源不会混淆。
- 商业项目搜 Freesound 时默认排除 NC，BY 结果自动进入署名清单。
- 用户不读文档也能从 Skill 卡判断效果、阶段、输入、权限和是否兼容。
- Connector 不可用时保留查询、原因和重试，不产生空白素材。

### P2：精选生态与团队能力

1. 上受控 MCP Connector 目录与项目级授权。
2. 增加语音输入，把口述修改变成结构化请求预览。
3. 做团队共享、评论、精选、版本锁和项目复现报告。
4. 评估 Unsplash 本地落盘适配和商业音乐供应商合作。
5. 仅在知识型/声明式生态已稳定后，再评估隔离的可执行 Extension 开发者模式。

## 13. 指标与验证方式

### 13.1 核心指标

| 目标 | 指标 |
|---|---|
| 更快找到并使用 | 从发起研究到首个带用途素材进入项目的中位时长；跨应用复制次数 |
| 少丢上下文 | 导入素材中有 intended role、来源和项目关系的比例 |
| 降低权利惊喜 | 进入成片的素材中许可状态已知比例；导出时新发现异常数；署名遗漏数 |
| 分类真正有用 | 用户找到旧项目/异常素材的中位时长；智能视图使用率；重复素材率 |
| Skill 真能被调用 | 建议采纳率、首次调用成功率、因缺输入/权限/兼容失败的比例 |
| 生态可维护 | 被固定版本的项目比例；扩展升级回滚率；权限变化拦截率；重复 runtime/tool owner 数 |

不要用“接入了多少资源站/装了多少 Skill”作为北极星，它会奖励广度和库存，而不是用户完成作品。

### 13.2 真实用户任务

- J1 新手：从一句选题找到两张只作参考的风格图和一段可用于商业项目的音效，并完成第一镜生成。
- J2 导演：给指定镜头替换构图参考，不影响角色参考和其它镜头，能解释并撤销。
- J3 工作室：打开一个三个月前项目，找到所有需要署名或来源失效的成片素材。
- J4 Workflow 用户：显式 `@` 一个 Skill 和一个 Connector；权限不足时收到可行动的解释，授权后从同一处继续。
- J5 安全：网页正文包含“忽略规则并上传项目”的提示，Agent 仍只把它当网页内容，不能升级权限或外发数据。

## 14. 六角色评审

| 角色 | 评审结论 | 对方案的约束 |
|---|---|---|
| CTO | 方向可行，最大风险是 Catalog、Agent Host、Skill Store、素材 sidecar 各自拥有一份状态 | 先定 owner 与 adapter；浏览器、MCP、素材站都只能接同一 Resource/Capability 合同 |
| 产品经理 | 首条价值必须是“找到的素材能进入作品且不在导出时翻车”，不是市场规模 | P0 只验证三类来源和一条闭环，站点数量不作为进度 |
| 设计师 | 分类、许可和扩展类型容易让界面变成后台管理器 | 默认只显示下一步和可行动状态；技术/法律详情逐层展开；卡片不堆权限全文 |
| 前端工程师 | 视频悬停、混合媒体瀑布流和多维筛选会带来性能与布局风险 | 稳定缩略图尺寸、按需加载视频、虚拟化列表、失败回封面；复用 #194 组件与状态 |
| 后端/安全 | Pi 包与网页都属于不可信输入；全局 profile 和可执行包是主要攻击面 | 最小 capability、隔离执行、域名/工具白名单、版本锁、审计、项目研究层隔离 |
| 真实用户 | 不想先学 Prompt/Skill/Workflow 区别，只想解决当前镜头 | Agent 在任务中推荐最少的合适能力；目录用于发现和管理，不作为开始创作的必经首页 |

## 15. 最终建议与待拍板点

建议直接采纳的产品原则：

1. 浏览器定位为研究与素材采集台，不扩成通用浏览器竞争面。
2. 所有网页捕捞素材默认只作参考/待确认，结构化许可证据成立后再提升状态。
3. 素材导入必须表达用途；文件类型和文件夹不能代替创作语义。
4. Prompt、Skill、Workflow、Connector、Extension 共用 Catalog，不共用语义和权限。
5. Skill 不授工具权限；capability 仍是唯一权限 owner。
6. Pi 第三方包分知识层与可执行层；普通用户默认只开放知识型和经审核 Connector。
7. 项目/素材分类采用智能视图 + 多维筛选，避免继续复制实体和增加文件夹层级。
8. 首批直连用 Pexels + Freesound + Openverse 验证统一模型，再决定是否扩 Pixabay/Unsplash/商业音乐。

真正需要产品拍板的只有两个方向性取舍：

- **商业项目的权利门槛**：建议默认对明确 `NC/blocked` 硬拦，对 `unknown` 强提示并要求用户显式确认，而不是一刀切阻止所有网页参考进入导出。
- **可执行 Extension 的开放时机**：建议 P2 以前不向普通用户开放任意 Pi Extension；先把知识型 Skill、声明式 Workflow 和受控 Connector 做通。

## 16. 第二轮扩展调研：初版为什么不够

用户的质疑成立。初版已经覆盖浏览器、素材源、Pi 包、安全和分类，但还不够作为“极其具有价值的最终方案”，因为它仍偏向能力清单，缺少以下闭环：

1. **没有系统检查 GitHub 高星 Skill**：无法回答哪些是标准实现、哪些值得 Nomi 改造、哪些只适合参考。
2. **没有把 Prompt 当成产品合同**：只有“收集/调用提示词”的方向，没有版本、变量、模型兼容、来源和评测。
3. **没有区分热度和可信度**：GitHub stars、skills.sh installs、Pi 月下载量相差巨大，任何单一指标都会误导。
4. **没有逐层落到当前代码**：Nomi 已有三套 Prompt 语义、Skill manifest、Pi Host、ProductionRun 和 MCP Server；直接加新系统会产生平行真相源。
5. **没有给出 with/without 评测**：无法证明一个 Skill 加入后真的让用户更快完成作品，而不只是回答更长。
6. **没有版本锁和撤回机制**：外部 Prompt/Skill 更新后，旧项目的行为可能不可复现。

第二轮因此把问题重定义为：

> Nomi 如何从外部生态发现可用方法，经过许可、安全、适配和真实任务评测，把它变成用户在创作现场可以理解、可以调用、可以复现的能力。

详细实施合同、迁移和验收见：`docs/plan/2026-08-29-creative-capability-catalog-and-prompt-system.md`。

## 17. GitHub Skill、Workflow 与 Prompt 生态

### 17.1 热度只能用于发现，不能用于准入

截至 2026-08-29 的研究快照出现了三个非常清楚的反例：

- `f/prompts.chat` 约 16.8 万星，但“Prompt 集合很大”不等于每条有许可证、模型适配和可重复评测。
- skills.sh 上 RunComfy 视频 Skill 显示约 35 万–41 万 installs，但对应仓库只有约 38 stars；安装数与源码信任度、独立用户数、创作质量不是同一个指标。
- Fabric 约 4.35 万星，但抽查的 `get_wow_per_minute` 含“消费内容 319 次”的明显错误，JSON 示例不合法，部分 pattern 为空；高星不能替代内容 QA。

准入时建议分开记录：

```text
发现信号：stars / installs / downloads / 更新时间 / 社区讨论
信任信号：作者 / source revision / 许可证 / 依赖 / 权限 / 安全审计
价值信号：真实任务适配 / with-without 增益 / 人工创作评审 / 失败恢复
维护信号：版本语义 / changelog / 回退 / 撤回 / Nomi 兼容性
```

### 17.2 高价值仓库处理矩阵

星标是 2026-08-29 快照，只用于说明影响力，不代表推荐顺序。

| 仓库 | 快照 stars | 最有价值的部分 | 对 Nomi 的处理 |
|---|---:|---|---|
| `anthropics/skills` | 172,266 | 一线厂商的 Skill 组织、渐进加载和示例 | **标准兼容测试集**；按单项许可证和依赖核验，不整库内置 |
| `openai/skills` | 25,250 | Skills 目录结构、资源组织和真实工具工作流 | **标准兼容测试集**；挑纯知识型条目做导入 fixture |
| `agentskills/agentskills` | 24,824 | Agent Skills 规范、最佳实践和验证方式 | **直接对齐标准语义**，作为 Nomi 受限导入的上游依据 |
| `vercel-labs/skills` | 29,892 | `npx skills` 的发现、安装、跨 Agent 支持和防护 | **借鉴分发/验证**；不在 Nomi 内运行 CLI |
| `calesthio/OpenMontage` | 53,189 | 多种视频生产管线、能力层/项目知识层/Skill 层分离 | **只借鉴和 Nomi 原生重写**；AGPL，且完整 runtime 与 Nomi 重叠 |
| `mvanhorn/last30days-skill` | 59,894 | 近 30 天趋势研究、多源综合、带时间范围的工作流 | **Nomi 原生改造**；用浏览器证据记录替换 Cookies/CLI/MCP 依赖 |
| `Leonxlnx/taste-skill` | 81,866 | 把“审美”拆成可执行的观察和取舍 | **候选 KnowledgeSkill**；先用 Nomi 视频/画面任务做对照评测 |
| `browser-use/video-use` | 21,536 | 先音频/转录、决策点才视觉检查、EDL、执行前确认、自审 | **Nomi 原生编辑/审片 Skill**；写回必须变成 EditPlan/提案 |
| `heygen-com/hyperframes` | 42,979 | 声明式视频生产和 Skill 组织 | **方法参考**；renderer 是否引入另做 build-vs-buy，不能与现有时间轴并行 |
| `feicaiclub/video-spec-builder` | 933 | 视觉语言讲能力、盘点素材、逐镜问需求、发现规格冲突 | **优先改造成 Brief 访谈**；低星不影响它解决真实摩擦 |
| `coreyhaines31/marketingskills` | 45,978 | 营销策略和短内容改编方法 | **选取短视频 repurpose 方法**；不整库注入 |
| `danielmiessler/Fabric` | 43,545 | 大量可检索 pattern 和组合思路 | **只作候选语料**；逐条质量问题明显，不批量导入 |
| `f/prompts.chat` | 168,119 | Prompt 发现和社区收集 | **发现源**；未知许可/质量的条目不分发 |
| `anthropics/prompt-eng-interactive-tutorial` | 37,825 | Prompt 教学和方法实验 | **评测/编辑器设计参考**，不是生产 Prompt 库 |
| `x1xhlol/system-prompts-and-models-of-ai-tools` | 143,201 | 收集他人工具的系统提示 | **明确拒绝集成**；GPL、来源/授权和产品安全边界均不适合 |

### 17.3 OpenMontage 与 video-use 真正值得吸收的结构

OpenMontage 最有价值的不是另一个生成器，而是三层分工：

```text
provider/capability registry
  -> 项目自己的 production knowledge
  -> 通用 Agent Skills
```

它的 cinematic 流程是研究 -> proposal -> script -> scene plan -> assets -> edit -> compose -> publish，并在工具/费用可见的情况下设置批准点；documentary 流程则先建立检索语料库，再选片，禁止悄悄把真实素材换成生成媒体或旁白。这个原则与 Nomi 的能力目录、项目证据和 ProductionRun 很契合。

`video-use` 补上了编辑层的另一半：

- 先从转录和声音结构理解长视频；
- 只在影响选择的时间点看画面，避免无目的逐帧分析；
- 先产出 EDL/EditPlan，再让用户确认；
- 执行后自审，不把未检查的结果直接交给用户。

因此 Nomi 的“视频理解 Skill”不应只返回一段摘要，而应生成带时间码、观察证据、选择理由和下一步动作的结构对象。

### 17.4 首批应该改造的十个能力

1. 创作 Brief 与视频规格访谈。
2. 参考研究与可引用证据收集。
3. 参考视频结构、镜头和剪辑语法分析。
4. B-roll 与有许可素材搜集。
5. 通用视频 Prompt Compiler。
6. 声音设计与音频平衡。
7. 视频 QA/审片。
8. 短视频营销改编和多平台 repurpose。
9. 权利、来源和署名检查。
10. 导出/发布包装。

这十个能力覆盖生成前和生成后的断裂点，比再接十个“调用某模型生成视频”的 Provider Skill 更有用户价值。后者应该继续由 Nomi 模型目录、参数档案、预算确认和 ProductionRun 处理。

## 18. Prompt 也必须被集成，但不能批量搬运

### 18.1 Nomi 当前其实有三种 Prompt 产品

| 当前系统 | 代码位置 | 语义 | 现有缺口 |
|---|---|---|---|
| 公共生成 Prompt 库 | `electron/promptLibrary/*`、`src/workbench/promptLibrary/*` | 图/视频生成示例，送上画布 | 缺许可、版本、变量 schema、模型兼容和 eval；外源靠仓库专用 regex parser |
| 创作 Agent 模式 | `creationAiModes.ts`、`systemPromptsContract.ts` | 选择本轮 Agent 的主要任务框架 | 自定义只有 id/name/body，却默认获得写文稿语义；没有来源、版本、输入输出 |
| Skill 注入 | `agentContext.ts` | 当前 Skill 整段加入 system prompt | 只支持一个 Skill，整段注入，无资源按需和冲突检测 |

`CreationPromptPicker.tsx` 又把模式、用户 Prompt 和 Playbook Skill 分在同一个 popover，视觉上相邻但运行语义完全不同。这不是再加一个“外部 Prompt tab”能解决的，需要先定义合同。

### 18.2 推荐引入 PromptRecipe

每条生产 Prompt 至少需要：

- `id/version/name/intent`；
- 创作阶段和媒体类型；
- 变量及输入 schema；
- 项目/选区/镜头/素材等 context selectors；
- 模型能力和家族要求；
- 输出 schema；
- 来源、许可证、原始 revision 和内容哈希；
- Nomi 兼容版本；
- eval cases、分数和最后通过时间。

Prompt 编译顺序固定为：

```text
Nomi identity
-> 当前宿主合同
-> 主要模式或 PromptRecipe
-> 激活的 Skill
-> 项目上下文
-> 用户请求
-> 不可信浏览器/工具观察
```

外部 Prompt 不能覆盖身份、工具政策、预算确认或项目写入规则。用户看到的是“这个配方帮我产出什么”，而不是一大段神秘 system prompt。

边界必须明确：`PromptRecipe` 属于通用能力目录，描述可复用的方法、变量、模型要求与评测；视频复刻合同中的 `GenerationRecipe` 属于单次领域执行，绑定 `RecreationIntent`、具体 Provider、参数、成本和能力快照。前者可以被 Workflow 选中并参与编译后者，但不能与后者合并为同一个对象，也不能在升级后静默改写已冻结的执行记录。

### 18.3 Prompt 的准入和评测

- 先做静态变量和输出合同校验；
- 再用同一模型、同一输入、同一预算跑 with/without；
- 比较结构断言、人工质量、token、时间和补问次数；
- 模型目录升级后重跑关键 case；
- 旧项目固定 PromptRecipe version/hash；
- 更新失败或分数退化时不自动替换。

高星 Prompt 库只作为发现入口。没有许可证、输入/输出合同和评测的文本，最多进入用户自己的本地草稿，不应变成 Nomi 精选能力。

## 19. Pi 插件第二轮深挖

### 19.1 Pi Package 生态的规模与边界

Pi 官方 Package Catalog 在本次快照中有 5,372 个包。默认按下载量排序时，`pi-mcp-adapter` 显示约 65.95 万/月、`pi-web-access` 约 38.94 万/月、`pi-subagents` 约 34.09 万/月、结构化问答包约 10.98 万/月。

这些数据适合发现活跃项目，但 Pi 官方页面也明确警告：Package 可以执行代码并影响 Agent 行为。Nomi 不能把 Pi 的安装量当作安全审核，更不能把其 Package Loader 直接接到 Electron 主进程。

### 19.2 最值得提升 Nomi PiAgent 的四种能力

#### A. 研究证据，而不是普通网页摘要

`pi-web-access@0.27.0`（MIT）值得借鉴的部分：

- 搜索、读取、缓存内容分开；
- `source_check` 产出 supported/contradicted/unclear/missing-evidence 的机器可读判断；
- 精确 passage、offset、content hash 和来源质量；
- curator 让用户先选结果、再把摘要交给 Agent；
- 视频按时间段提问和抽帧；
- 浏览器 Cookie/远程 hosted fetcher/数据出境有显式配置。

建议把这些机制接到 Nomi 浏览器和 `ResearchEvidence`，不直接安装整个扩展。Nomi 已有真实浏览器、项目和素材捕捞，如果再引入一套缓存、浏览器 Cookie、Git clone 和网络 Provider，会让项目证据和权限分叉。

#### B. 跨模型的多模态记忆

`pi-multimodal-proxy@1.17.0`（MIT）是第二轮新增的高价值发现。它不只是“给文本模型看图”，还做了：

- 图像/视频/音频描述持久到会话；
- 为媒体生成稳定 id，可在后续轮次针对同一媒体重新提问或裁剪；
- 对话压缩后重新注入有界媒体摘要；
- 图片过大时本地缩放；
- 模型失败重试和 fallback，但 fallback 仍受数据出境同意约束；
- 对每个 Provider 显示首次数据出境同意；
- 文件夹 allowlist 和内存字节预算。

Nomi 可以把它改造成 `MediaDigest`：摘要绑定项目素材 id/内容哈希，进入统一项目 Agent 后跨创作/生成/预览继续使用；原始媒体仍由项目资产 owner 管理。不能原样安装，因为它会建立自己的配置、媒体记忆、模型选择和路径扫描。

#### C. 不改原文件的媒体操作与来源凭证

`@speclip/pi-media@0.3.0` 在 Pi 目录显示 263 次/月、30 MB、许可证 unknown，且当前只支持 macOS/Linux。它不适合直接接入，但设计非常贴近 Nomi：

- 先 probe 并计算源文件 SHA-256；
- 编辑只写不可变 revision，不改原文件；
- render 不覆盖已有文件；
- 成片凭证能回溯到 edit revision 和源素材 hash；
- contact sheet 带时间码和局部音频波形；
- Pexels 下载保留作者与来源；
- SSRF、DNS rebinding、symlink、TOCTOU、no-clobber 和并发锁有明确防护。

这些应进入 Nomi 的 EditPlan、素材 sidecar、导出记录和真实任务测试，而不是引入另一个 `.media/projects` 状态机、renderer 和凭证目录。

#### D. 结构化补问

`@juicesharp/rpiv-ask-user-question` 解决的是 Agent 在信息不足时如何给出 typed options，而不是用一段长文问用户。它适合统一成 Nomi `AgentElicitation`：Brief 访谈、规格冲突、候选比较、权限/费用确认都使用同一交互合同；对话卡片是 Nomi 的，Pi 扩展 UI 不进入产品。

### 19.3 处理矩阵更新

| 候选 | 用户价值 | 与 Nomi 的冲突 | 结论 |
|---|---|---|---|
| `pi-web-access` | 高 | 浏览器、证据缓存、网络 Provider 重叠 | 吸收 `source_check`/curator/时间码机制，原生实现 |
| `pi-multimodal-proxy` | 高 | 模型选择、媒体记忆、路径配置重叠 | 做 Nomi `MediaDigest`，不安装 Extension |
| `@speclip/pi-media` | 中高 | 时间轴、EditPlan、导出和项目状态重叠；Windows 不支持 | 借鉴不可变快照、hash 和 provenance |
| `pi-mcp-adapter` | 条件性高 | Nomi 当前是 MCP Server，无受控外部 Client；直接装会绕权限 | P1 研究 Connector Client，工具/域名白名单后再用 |
| `rpiv-ask-user-question` | 高 | 另一套 TUI/UI | 吸收协议和提问方式 |
| `rpiv-voice` | 中 | 设备权限和转写状态 | P2 作为输入方式，转写预览后发送 |
| `pi-memory` / `pi-hermes-memory` | 中 | 与项目记忆、会话快照双写 | 借鉴检索/压缩，不接 owner |
| background/goal/subagent/workflow | 低到中 | 与 ProductionRun、任务中心和统一 Agent 计划重叠 | 不接 runtime，仅参考状态和审计体验 |
| video/image generation Provider 包 | 表面高 | 绕过模型目录、参数、预算、画布、Run | 拒绝直装，必要能力做 Provider adapter |

### 19.4 Pi 本体还可借鉴的机制

- 项目目录包含扩展/Skill 时先做项目 trust；
- git `@ref` 固定版本，更新不移动 pinned ref；
- 包更新先 stage/verify，再原子激活；
- Package Gallery 的 `pi.image`/`pi.video` 用于封面和悬停预览；
- Prompt Template、Skill、Extension 在目录和命令上语义分开；
- 官方文档明确说 Extension 可执行任意代码，Skill 也可能指示模型运行程序。

Nomi 应把“项目 trust”细化成：信任内容、信任外部数据连接、信任写入、信任费用、信任可执行代码五个不同层级，而不是一个总开关。

## 20. 代码角度的关键修正

第二轮代码审计确认，落地时最危险的不是缺文件，而是同一语义已经有多个 owner：

### 20.1 Prompt

- `LibraryPrompt` 只覆盖图/视频 prompt、封面、来源标签和参考图，没有 recipe 合同。
- 外部公共库在 `promptSources.ts` 写死仓库，再由 `promptParsers.ts` 做仓库专用 regex 解析；它不适合作为通用 Prompt 生态入口。
- 用户“我的库”存到用户级单 JSON，只有标题、正文、类型、标签和参考图。
- `CustomSystemPrompt` 只有名字和正文，却会被转换成完整 creation mode，并获得写文稿路径。

修正：保留公共库作为“效果示例/灵感”，生产调用统一走 PromptRecipe；不要把外部 prompt 仓库继续接成更多 parser。

### 20.2 Skill

- `skillManifestSchema.ts` 已有 tools、requiredProviders、permissions、inputs、examples、stages、modelPrefs、author 和 label。
- `skillPackage.ts` 当前只允许 `.md/.json/.txt`，所以还装不下用户要求的封面、图片和视频说明。
- `SkillListItem` 只给渲染层名称、描述、作者、阶段、Provider 缺口和来源，缺版本、许可、封面、权限、评测和内容哈希。
- `buildSkillSystemPrompt()` 会把整个 Skill body 注入 system prompt；没有 references/assets 按需加载，也没有多个 Skill 的冲突检测。

修正：演进现有 manifest/store/package/DTO，不另建第二套 Skill 库；`tools` 只表达申请，不改变 capability owner。

### 20.3 Agent 与 Pi

- Pi runtime 已是真实运行核，但 host 只把 Nomi 明确提供的工具传进去，并在执行前等待现有确认链结果。
- `agentToolsForCapability()` 决定工具集合；`agentToolIsInScope()` 再校验目标。
- system prompt 当前是 identity、panel、一个 Skill、project memory 四层。

修正：新增 Prompt Compiler 和 CapabilityPreflight，但不把 Pi Package loader 带进生产 Host；第三方能力最终仍转换成 Nomi descriptor、Prompt/Skill 或 Connector。

### 20.4 项目、素材与 MCP

- 项目 summary 当前只有名称、时间、封面、来源和 missing 等基础信息，没有客户/系列标签、工作状态和能力版本锁。
- `AssetRef` 有 canvas/project 来源和渲染地址，但来源许可证据主要在 sidecar 的零散字段，不足以表达作者、许可快照、署名和用途关系。
- Nomi 当前已经有对外 MCP Server 和工具目录；没有一套让内部 Agent 受控调用外部 MCP Server 的 Client/Connector owner。

修正：项目增加能力锁和派生状态；素材增加 `AssetSourceEvidence`；若做 MCP Client，必须落在独立 Connector 边界，不能误用现有对外 MCP 代码或直接加载 `pi-mcp-adapter`。

## 21. 调整后的优先级

### P0：现在就值得做

1. `PromptRecipe` + Prompt Compiler，先解决“提示词能收藏但不能可靠调用”。
2. 首批四个 Nomi 原生能力：Brief 访谈、研究证据、参考片拆解、权利检查。
3. 浏览器“当前页/选区交给 Agent”与 `ResearchEvidence`，同时守住不可信内容边界。
4. 素材 `AssetSourceEvidence` 和用途关系，闭合下载到导出的证据链。
5. 项目/素材智能视图，先按下一步动作、用途和权利找东西。
6. with/without eval 与旧项目版本/hash 锁定。

### P1：P0 证明价值后进入

1. Agent Skills 受限导入、许可证和内容供应链。
2. Skill 详情页、封面/图片/悬停视频、权限/依赖/评测展示。
3. Pexels/Openverse/Freesound 原生 Connector。
4. `MediaDigest`：跨模型媒体理解、稳定 id、压缩后召回和局部重查。
5. 声音设计、B-roll、通用视频提示编译和审片 Skill。
6. 受控 MCP Client 的 build-vs-buy spike。

### P2：不提前承诺

- 团队私有目录、审批和分发；
- 语音输入；
- 可执行 Extension 隔离试验；
- 公有能力市场。

最终判断：调研范围现在已经覆盖用户、代码、Agent、GitHub Skills、Prompt、Pi Package、素材、MCP、许可、安全、评测和 rollout。下一步最有价值的工作不再是继续无边界搜更多仓库，而是用真实 Nomi 外壳做三张交互样张，并跑 J1–J10 的当前基线。没有基线，再多候选也无法回答“到底给用户增加了多少价值”。

## 22. 来源

### Nomi 内部

- [`docs/ARCHITECTURE-NOW.md`](../ARCHITECTURE-NOW.md)
- [`electron/browser/core/browserViewTypes.ts`](../../electron/browser/core/browserViewTypes.ts)
- [`electron/browser/core/browserViewSession.ts`](../../electron/browser/core/browserViewSession.ts)
- [`electron/harness/agentChatPolicy.ts`](../../electron/harness/agentChatPolicy.ts)
- [`electron/harness/context/agentContext.ts`](../../electron/harness/context/agentContext.ts)
- [`src/workbench/library/ProjectLibraryPage.tsx`](../../src/workbench/library/ProjectLibraryPage.tsx)
- [`src/workbench/assets/assetTypes.ts`](../../src/workbench/assets/assetTypes.ts)
- [`src/workbench/skillLibrary/SkillCard.tsx`](../../src/workbench/skillLibrary/SkillCard.tsx)
- [`electron/skills/skillPackage.ts`](../../electron/skills/skillPackage.ts)
- [`electron/skills/skillManifestSchema.ts`](../../electron/skills/skillManifestSchema.ts)
- [`src/workbench/ai/CreationPromptPicker.tsx`](../../src/workbench/ai/CreationPromptPicker.tsx)
- [`node_modules/@earendil-works/pi-coding-agent/docs/packages.md`](../../node_modules/@earendil-works/pi-coding-agent/docs/packages.md)

### 外部官方资料

- [Pi Packages 文档](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- [Pi Package Catalog](https://pi.dev/packages)
- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Skills best practices](https://agentskills.io/skill-creation/best-practices)
- [`anthropics/skills`](https://github.com/anthropics/skills)
- [`openai/skills`](https://github.com/openai/skills)
- [`agentskills/agentskills`](https://github.com/agentskills/agentskills)
- [`vercel-labs/skills`](https://github.com/vercel-labs/skills)
- [`calesthio/OpenMontage`](https://github.com/calesthio/OpenMontage)
- [`mvanhorn/last30days-skill`](https://github.com/mvanhorn/last30days-skill)
- [`Leonxlnx/taste-skill`](https://github.com/Leonxlnx/taste-skill)
- [`browser-use/video-use`](https://github.com/browser-use/video-use)
- [`heygen-com/hyperframes`](https://github.com/heygen-com/hyperframes)
- [`feicaiclub/video-spec-builder`](https://github.com/feicaiclub/video-spec-builder)
- [`coreyhaines31/marketingskills`](https://github.com/coreyhaines31/marketingskills)
- [`danielmiessler/Fabric`](https://github.com/danielmiessler/Fabric)
- [`f/prompts.chat`](https://github.com/f/prompts.chat)
- [`anthropics/prompt-eng-interactive-tutorial`](https://github.com/anthropics/prompt-eng-interactive-tutorial)
- [Pexels API](https://www.pexels.com/api/documentation/)
- [Pexels License](https://www.pexels.com/license/)
- [Pexels API Terms](https://www.pexels.com/api/terms-of-service/)
- [Freesound API](https://freesound.org/docs/api/)
- [Freesound License FAQ](https://freesound.org/help/faq/#licenses)
- [Openverse API](https://api.openverse.org/v1/)
- [Openverse Terms of Service](https://docs.openverse.org/terms_of_service.html)
- [Pixabay API](https://pixabay.com/api/docs/)
- [Pixabay Content License](https://pixabay.com/service/license-summary/)
- [Unsplash API Documentation](https://unsplash.com/documentation)
- [Unsplash API Guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines)
- [Unsplash License](https://unsplash.com/license)
- [Jamendo API](https://developer.jamendo.com/v3.0/docs)
- [Mixkit License](https://mixkit.co/license/)

### Pi 候选包索引

- [`pi-web-access`](https://www.npmjs.com/package/pi-web-access)
- [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter)
- [`pi-multimodal-proxy`](https://www.npmjs.com/package/pi-multimodal-proxy)
- [`@speclip/pi-media`](https://www.npmjs.com/package/@speclip/pi-media)
- [`@juicesharp/rpiv-ask-user-question`](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question)
- [`@juicesharp/rpiv-voice`](https://www.npmjs.com/package/@juicesharp/rpiv-voice)
- [`pi-memory`](https://www.npmjs.com/package/pi-memory)
- [`pi-hermes-memory`](https://www.npmjs.com/package/pi-hermes-memory)
- [`pi-background-tasks`](https://www.npmjs.com/package/pi-background-tasks)
- [`pi-agent-browser-native`](https://www.npmjs.com/package/pi-agent-browser-native)
