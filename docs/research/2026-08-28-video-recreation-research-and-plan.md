# Nomi 视频复刻：产品、技术与 Agent 落地方案

日期：2026-08-29

状态：立项候选 v3，已对齐 Project Agent Host，可进入用户测试与模型 Spike

范围：本地 Nomi 仓库、LibTV、TapNow、小云雀、Adobe、Runway、Kling、KIE、TikHub 与相关开源仓库

配套产物：[落地主方案](../plan/2026-08-29-video-recreation-product-loop.md) · [Prompt 与数据合同附录](2026-08-29-video-recreation-prompts-and-contracts.md) · [可交互体验样张](../design/mockups/2026-08-29-video-recreation-canvas-minimal.html)

> 名称校正：本文讨论的是 **LibTV**，不是 LiveTV。星数与在线能力是 2026-08-29 的核验快照，不能当永久事实。

> **2026-08-29 ownership 校正**：本文保留竞品、模型、开源 skill、Prompt 和用户研究证据；实现边界以[落地主方案](../plan/2026-08-29-video-recreation-product-loop.md)为准。Draft PR #223 `8784ec77` 已形成 Project Agent Host、`canvas.read/write`、`timeline.read/write` 与 ProductionRun 的统一 owner。下文中的 `VideoAnalysisArtifact`、`RecreationArtifactRef` 等只表示语义 payload/Artifact，不授权新建 Session、Task、Approval、Journey、Undo store 或独立 Workspace。

## 0. 最终判断

原方案**调研方向正确，但不足以立项**。它证明了“播放器 + 可切时间轴 + 局部重拍”比“满画布 shot 卡”更合理，也盘点了 Nomi 的部分复用能力；但缺少五类决定成败的内容：

1. 没有把用户价值变成可执行、可验收的需求合同。
2. 没有区分“高星仓库”“Agent skill”“可嵌入运行时”和“只能借鉴的方法”，容易形成伪集成。
3. Prompt 仍被当成一段文案，没有事实、意图、Provider 编译、QA、定向重试五层边界。
4. Agent 只有概念，没有权限、人工确认、幂等、未知提交和恢复规则。
5. 没有模型评测集、用户研究计划、量化 Go/No-Go 阈值和研发拆票。

本版的核心决策是：

- 产品入口可叫 **视频复刻**，工作台内只保留两个模式：**逐帧拆解**与**局部重拍**。
- 主对象始终是视频；在 Nomi 中它表现为画布视频节点，播放器下方仍是该节点唯一的局部选区时间轴，不新增独立 Preview 工作区。
- P0 只交付一个高价值闭环：`节点内切选 3–10 秒 -> 说一句只改什么 -> 一次估价确认 -> 候选落画布 -> QA/对比 -> 替换/撤销`。
- “拆解”负责产生可核验事实；“复刻”负责产生候选版本。二者使用不同 Run，不能把模型猜测直接变成生成指令。
- 原视频不可变，生成结果先成为 `RecreationArtifactRef`，只有 canonical `timeline.write` Proposal -> Apply 才能影响时间轴。
- 先用真实评测选择一个视频编辑 Provider 上线，不预设“接入越多越好”。
- 外部 skill 只能作为受控 Provider 或方法来源，不能绕过 Nomi 的资产、合同、预算、审计和撤销链。

### 产品一句话

用户选中视频中一小段，用一句话说明“只改什么”，Nomi 自动守住其余内容，给出可对比、可撤销的重拍版本。

### P0 不做什么

- 不承诺像素级、人物身份级或版权意义上的“原样复制”。
- 不做未经逐段确认的一键整片生成。
- 不自动复制来源视频的商标、真人身份、受保护角色或音频。
- 不新增第二套 TimelineStore、第二套画布或独立短剧编辑器。
- 不把 APIMart/KIE catalog 中的“视频生成”条目冒充“视频理解”能力。
- 不默认安装 Remotion、PySceneDetect、LosslessCut 等新运行时来重复 Nomi 已有能力。

## 1. 成功标准

这项功能的成功不是“能调用一个视频模型”，而是同时成立三件事：

| 视角 | 用户最终得到什么 | 必须成立的证据 |
|---|---|---|
| 用户 | 不学复杂 Prompt，也能只改一小段，并确信原片没有被偷偷改坏 | 8–12 人任务测试中，至少 80% 无指导完成首个替换；所有人能找到撤销 |
| 代码 | 一份来源、一条时间轴、一个生成合同，失败可恢复且不重复扣费 | 原片 hash 不变；合同、费用、结果、Apply/Undo 全链可追溯；未知提交不自动重提 |
| Agent | 能替用户做分析和准备，但不能替用户花钱、扩大修改范围或覆盖成片 | 权限测试证明 Agent 只能产出候选、检查和 Proposal，关键动作必须有人审回执 |

北极星指标建议用 **Accepted Segment Rate**：用户发起付费生成后，最终被 Apply 到完整视频的片段版本占比。它比“生成次数”更接近用户价值，也会同时暴露 Prompt 质量、模型质量、边界衔接和交互信任问题。

配套护栏指标：

- 每个被接受片段的平均付费尝试次数。
- 从选中范围到第一次可审版本的时间。
- Apply 后 10 分钟内的 Undo 比例。
- 未要求区域的变化率与边界不连续率。
- `submission_unknown`、重复提交和无法定价的发生率。

## 2. 证据等级与仍需补做的调研

### 2.1 证据等级

| 等级 | 定义 | 本方案如何使用 |
|---|---|---|
| E1 | 官方文档、官方源码、Nomi 真实代码 | 可形成产品或技术约束 |
| E2 | 可复现的产品实测、登录后截图、真实 API Spike | 可形成交互和 Provider 决策 |
| E3 | 媒体、社区演示、二手评测 | 只用于发现线索，不能单独形成承诺 |
| H | 尚未验证的假设 | 必须进入用户研究或模型 Spike，不能写成事实 |

已足够支持的结论：本地切镜/抽帧/时间轴/Undo/ProductionRun 可复用；播放器下切时间范围是正确主交互；模型需要“变更 + 保留 + 禁止”合同；生成前必须估价与确认。

仍然不能仅靠桌面调研回答的问题：

1. 用户更自然地说“复刻”“重拍”“替换”还是“改这一段”。
2. 用户能否理解“拆出片段”与“替换到完整视频”的区别。
3. 目标素材上 Kling Video O1、Runway Aleph、Seedance 2.5 谁的保留能力更稳定。
4. 3–10 秒窗口是否覆盖主要需求，快动作和多人遮挡是否需要更短默认值。
5. 保留原时间轴音频是否显著提高接受率，还是增加权利与同步风险。

这些问题不能继续查文章解决，必须用原型任务测试和真实模型样本解决，见第 14 节。

## 3. 用户、场景与需求

### 3.1 首批目标用户

| 用户 | 高频任务 | 现在的摩擦 | P0 提供的价值 |
|---|---|---|---|
| 短视频/独立创作者 | 借一个镜头节奏重做自己的内容 | 不会写运镜 Prompt，整片重生成成本高 | 框选一段，替换主体/场景，保留动作与时长 |
| 品牌与效果营销 | 把成片中的商品、人物、背景换成新版本 | 返剪或重拍慢，模型容易误改 Logo 与文案 | 锁定品牌项、显示预计费用、逐段审阅 |
| 专业剪辑/导演 | 拆解参考片并验证某个镜头方案 | 长文本分析无法落到时间点，生成结果难回剪 | 时间码、关键帧、局部版本和边界 QA 均在同一工作台 |

首版不以“完全不剪辑的一键整片用户”为主目标。那类用户需要脚本、素材、连续性、音频和批量预算编排，超出 P0 的可信范围。

### 3.2 核心 JTBD

当我看到参考视频中一个值得借鉴的片段时，我想准确选中它，只说明要改变的内容，让系统保留动作、运镜、时长和未点名的画面，并在不破坏原片的前提下把满意结果放回完整视频。

### 3.3 用户真正需要的不是“长 Prompt”

用户界面只要求完成四个决策：

1. **改哪一段**：时间轴选择范围，支持切点吸附和逐帧微调。
2. **只改什么**：一句自然语言，可绑定人物、商品或背景参考图。
3. **必须保留什么**：动作、运镜、构图、时长、光线、时间轴原声等显式开关。
4. **是否接受结果**：查看 QA 与原片对比，再替换或继续保留候选。

“景别、机位、镜头运动、主体轨迹、首尾帧、Provider 参数”等由系统从事实和能力档案中推导；只有低置信或冲突项才要求用户确认。

### 3.4 失败旅程必须有答案

| 失败 | 用户看到什么 | 用户可做什么 | 系统不能做什么 |
|---|---|---|---|
| 链接无法下载 | 平台/权限/大小的具体原因 | 换链接或上传本地文件 | 无限重试或静默换来源 |
| 自动切点不准 | 建议切点和低置信标识 | 拖动、删除、新增切点 | 把建议当最终边界 |
| 分析不确定 | 对应字段显示“不确定”及证据帧 | 修正或忽略该字段 | 编造看不到的事实 |
| Provider 不支持所选范围/引用数 | 在付费前显示能力冲突 | 缩短、减少引用或换模型 | 丢字段后直接提交 |
| 生成任务状态未知 | 标记“已提交，结果待核实” | 查询原任务或稍后恢复 | 自动创建新任务再次扣费 |
| 变更命中但背景被改 | QA 标出“保留失败” | 定向重试或保留旧版 | 直接 Apply |
| 边界跳变 | 首尾边界对比失败 | 调整范围、换版本或加过渡 | 掩盖失败并称“已完成” |

## 4. 最终用户体验

### 4.1 首次成功路径

以“把 00:19–00:24 的人物换成红发女性，其余不变”为例：

1. 用户把视频放进画布；链接获取和本地上传最终都落为带 provenance/hash 的项目资产。
2. 用户在视频节点内的胶片时间轴拖出 `00:19–00:24`，入口“复刻这 5 秒”就近出现。
3. 点击后，现有 Canvas Agent 自动带入来源、精确帧范围与关键帧，只问“这段想改什么？”
4. 用户输入“人物换成红发女性”。Agent 展示简短摘要：改变人物；默认保留动作、运镜、构图、时长和原声。
5. 系统显示范围、模型、外传内容、预计费用上限和最长等待时间；用户只确认一次“确认并生成”。
6. Project Agent Host 提交同一 ProductionRun。生成中节点仍可播放，关闭页面后可恢复且不会重复提交。
7. 成功 Artifact 通过 `canvas.write` 作为候选节点出现在来源旁边，并保留 provenance 边；不再弹第二张落画布确认卡。
8. 用户点击“对比并决定”，同步查看原片/候选与 QA 证据。
9. 点击“替换此片段”通过 `timeline.write` Apply；点击本身表达精确替换意图，不再套重复确认框。
10. Undo 只恢复时间线，候选和付费产物仍保留在画布与 Artifact 域。

### 4.2 工作台布局

- 视频节点：播放器与唯一局部选区时间轴；胶片、播放头、切点和范围都以源帧为真相。
- Canvas Agent：复用已有 composer 和 Item/Proposal 投影；不增加复刻右栏或第二个助手。
- 画布：来源、候选与 provenance 边；生成完成后候选就近出现，原片永不被覆盖。
- 对比层：只在用户决定时出现，同步播放原片/候选并显示边界与 preserve QA。
- 拆解：作为节点更多操作或 Agent 意图按需调用，不做常驻顶栏模式。

### 4.3 时间轴交互合同

- 自动切镜只产生 `suggested` 边界；用户拖动后成为 `confirmed`。
- 点击片段定位播放头；拖动空白建立自由范围；拖动把手调整起止；键盘左右移动一帧，`Shift + 左右` 移动五帧。
- 选区以源视频时间为准，显示到帧；内部统一存 frame，秒数只用于显示和 Provider 编译。
- Provider 窗口限制应在拖动时提示，但不阻止用户分析；只有提交生成时才要求落入合法范围。
- 拆出片段只创建非破坏性引用，不立即改时间轴。Apply 才产生一个可撤销的离散编辑。
- 候选作为画布节点版本栈/派生关系呈现，不复制一条可编辑时间线；最终只有 Apply 改变 canonical timeline。

### 4.4 状态投影，不新增状态机

视频复刻不定义自己的 lifecycle。待确认来自 Project Agent Host Proposal；排队、生成、检查、失败和取消来自 ProductionRun；候选完成来自 Artifact 与 `canvas.write` receipt；已应用/可撤销/已撤销来自 `timeline.write` 领域 receipt。UI 只组合这些事实，不新增 `VideoRecreationStatus` 或 Journey store。

## 5. 需求清单与验收合同

### 5.1 P0 用户需求

| ID | 需求 | 验收标准 |
|---|---|---|
| VR-U01 | URL 与本地文件导入 | 成功后落项目资产并记录 source/hash；失败给出可行动原因；不把任意远程 URL 直接交给 ffmpeg |
| VR-U02 | 自动建议切点 | 返回时间码、联系表和 `truncated`；建议切点可增删拖；无切点时仍允许自由框选 |
| VR-U03 | 精确选区 | 起止不越界、不反转，最小一帧；播放头和选区双向同步；重开项目后范围不漂移 |
| VR-U04 | 片段事实拆解 | 主体、动作、场景、运镜、构图、光线、文字/对白、音频 cue 均带 confidence 与证据时间戳；未知可为空 |
| VR-U05 | 修改意图 | 用户可写一句话并编辑 `改变/保留/禁止`；系统不得擅自增加创意目标 |
| VR-U06 | 参考素材绑定 | 每个引用显示角色和用途；提交前校验 Provider 数量、类型、分辨率和大小限制 |
| VR-U07 | 生成预检和确认 | 显示 Provider、模型、范围、引用、费用上限、外传内容、音频策略和能力缺口；未确认不提交 |
| VR-U08 | 局部版本生成 | 结果归入当前片段版本组；失败不影响原片和其他版本；刷新/重启后可恢复 |
| VR-U09 | QA 与对比 | 至少检查变更命中、保留项、时长、首尾边界和媒体可播放性；未验证项明确显示 |
| VR-U10 | 替换与撤销 | Apply 只替换所选时间范围；一次 Apply 对应一次 Undo；撤销后候选版本仍可审阅 |
| VR-U11 | 定向重试 | 从失败 QA 项生成新 draft，只改失败维度；每次重试重新估价和确认 |
| VR-U12 | 权利与隐私 | 外部上传、真人/品牌/原音频复用有明确确认；项目可显示远程处理记录和删除状态 |

### 5.2 非功能需求

| ID | 约束 | 验收标准 |
|---|---|---|
| VR-N01 幂等 | 同一提交不能重复扣费 | `runId + segmentVersionId + attempt` 唯一；网络超时进入 `submission_unknown`，只 reconcile |
| VR-N02 可追溯 | 任何结果都能解释来源 | 可追到源 hash、选区、分析 Artifact、Prompt policy、合同 hash、模型、费用、审批和 QA |
| VR-N03 可恢复 | 应用重启不丢付费任务 | submitted/processing/unknown 均从持久化 Run 恢复，不靠 React 内存 |
| VR-N04 性能 | 本地先可用 | 30–60 秒常见视频先完成 probe、胶片和切点，再异步理解；重活不在 Renderer 主线程 |
| VR-N05 无双源 | 时间边界只存一份 | 所有片段从现有 Timeline/source offsets 或领域引用投影，禁止 AnalysisStore 复制一条可编辑时间轴 |
| VR-N06 可替换 | Provider 不渗透 UI | UI 消费 capability 与 canonical contracts；Provider 参数只存在于 `GenerationRecipe` 和档案 |
| VR-N07 可解释降级 | 远程理解不可用仍能工作 | 保留本地 probe/切镜/抽帧/手工意图；UI 明确哪些分析缺失 |
| VR-N08 安全 | 视频内文字不成为 Agent 指令 | OCR、字幕、转写和 VLM caption 全部作为不可信数据；不得驱动工具或扩大权限 |

## 6. 竞品与官方能力调研

获取层与理解层必须分开：TikHub 的通用视频接口负责把分享链接解析为可下载媒体地址，鉴权使用 Bearer key；它不产出镜头事实，也不能成为视频理解来源。下载完成后仍要经过 Nomi 的 hardened fetch、大小/协议/重定向限制、ffprobe、项目资产落盘和 content hash。`cobalt` 只作为 TikHub 之外的自托管 adapter 备选，不进入 P0。

| 来源 | 已验证事实 | 应借鉴 | 不照搬 |
|---|---|---|---|
| LibTV | 逐帧拉片、片段重拍；时间范围作为引用；原片与结果对比；官方 skill 通过上传、会话、轮询、下载连接后端 Agent | 视频中心的局部闭环；前端 Agent 与创作 Agent 的职责边界 | 把自然语言黑盒会话当 Nomi 的核心合同；让外部 Agent 决定预算和落轴 |
| Adobe Premiere Generative Media | 在时间轴拖范围后就地打开生成任务栏，可加首尾帧/多参考，显示 credits，生成后直接审阅 | 选区旁就地生成、参考帧、费用预告 | Premiere 的复杂工具密度和专业术语 |
| Runway Aleph 2.0 | 官方建议用“动作动词 + 目标变换”；未点名的背景/光线/周边应保持；支持编辑一帧后传播 | Prompt 短、精确，默认保持未要求区域 | 默认堆叠风格词、把 motion 指令用于所有任务 |
| Kling Video O1 | 原生视频编辑；3–10 秒、最大 200MB；视频外最多 4 个图片/Element；用 `@Video/@Image/@Element` 绑定 | 引用绑定和主体/背景/移除的任务模板 | 把 Kling 专有语法暴露为用户必须学习的格式 |
| KIE Seedance 2.5 | 参考视频单段 2–30 秒、最多 10 段且总计不超过 30 秒、单段最大 200MB；编辑场景可匹配输入时长 | 参考视频复刻 Spike；时长和多参考能力档案 | 在未跑真实样本前承诺局部保留质量 |
| TapNow | 秒级片段重拍；Playlist 强调 preview、trim、timing、arrange clips | 局部重拍与最终编排分层 | 把 Playlist 当局部编辑主界面 |
| 小云雀 | 上传确认、预计花费、解析状态、局部重试、分镜对比 | 显式确认与局部失败恢复 | 维护独立短剧画布和通用画布两套真相 |

核心结论：LibTV 与 Adobe 共同验证了“选区即任务边界”；Runway 与 Kling 共同验证了“只说变化，其余保持”；Nomi 的差异化不是多一个模型按钮，而是把这两件事做成可信、可撤销、可恢复的本地工作流。

## 7. GitHub skills 与开源集成决策

### 7.1 选择标准

Star 只能证明关注度，不能证明适合嵌入。每个候选按六项判断：直接覆盖环节、源码质量、协议边界、许可证、运行时重复度、是否能保留 Nomi 的预算/审计/撤销不变量。

### 7.2 集成矩阵

| 项目 | 快照 | 有价值的源码事实 | 决策 |
|---|---:|---|---|
| `libtv-labs/libtv-skills` | 1,019★ · MIT | `SKILL.md` 只有上传、创建/追加会话、8 秒轮询、下载；文件限制 200MB；明确要求用户侧 Agent 原样传话，不扩写 Prompt | **P1 可选外部 Provider adapter**。不作为核心真相源，不让它直接 Apply 或绕过费用确认 |
| `FireRedTeam/FireRed-OpenStoryline` | 3,324★ · Apache-2.0 | `understand_clips` 做客观 caption + `aes_score`；`group_clips` 做场景聚合；`generate_ai_transition` 锁运镜并用过渡介质 | **P0 吸收方法与带来源的 Prompt policy**。改成 Nomi schema，删除无依据的魔法词和“输出思考过程” |
| `saranambiar/hyperframes-video-agent-skills` | 47★ · Apache-2.0 | intake 要求 decision-complete scene spec、首尾帧、锁定项、proof timestamps；QA 要求 probe、边界帧、contact sheet、只重渲染受影响场景 | **P0 吸收需求合同与 QA 方法**。星数低但直接解决迭代成本，价值高于泛用高星项目 |
| `remotion-dev/remotion` | 57,627★ · 仓库 API 未给出 SPDX | `Sequence`、trim、稳定组合和静音检测成熟 | **只借鉴确定性编排语义**。MVP 不加 runtime，Nomi 已有 ffmpeg 与时间轴 |
| `heygen-com/hyperframes` | 42,979★ · Apache-2.0 | 面向 Agent 的 HTML 视频与确定性渲染 | **暂不集成**。适合信息图/产品演示，不解决生成视频局部保留 |
| `mifi/lossless-cut` | 43,269★ · GPL-2.0 | 成熟的切段、范围、无损导出心智 | **交互 benchmark only**。不复制 GPL 代码，不引入第二编辑器 |
| `imputnet/cobalt` | 42,416★ · AGPL-3.0 | 多平台媒体获取，自托管 | **下载 adapter 备选调研**。如采用需进程/服务隔离并完成 AGPL 合规，不进入 MVP |
| `Breakthrough/PySceneDetect` | 5,130★ · BSD-3-Clause | 场景检测和评测基线成熟 | **与现有 ffmpeg 做 benchmark**。只有显著提升召回/渐变转场识别时才引入 Python 依赖 |

另外两个早期线索 `browser-use/video-use`、`Pluviobyte/video-production-skills` 可以继续核验，但在确认活跃度、许可证和源码质量前，不进入承诺清单。

### 7.3 “集成 skill”在 Nomi 中的准确含义

不能把 GitHub skill 文件复制进仓库就称完成。正确集成有三种：

1. **方法集成**：把 intake、proof frame、定向重试等原则写进 Nomi 自有合同、Prompt policy 和测试。
2. **Provider 集成**：外部 skill 通过受控 adapter 读取冻结合同，返回 artifact；上传、费用、状态和 Apply 仍归 Nomi。
3. **Benchmark 集成**：仅用于离线评测现有实现，不进入产品依赖和用户项目。

必须满足的外部 skill 沙箱合同：

- 输入只能是已批准的片段资产、引用资产和冻结 `GenerationRecipe`。
- 输出只能是 artifact、usage、provider task id、status 和错误，不允许直接写 store。
- 网络上传前产生人审回执；返回链接必须下载到项目资产并重新 probe/hash。
- 外部会话内容不得成为 Nomi 的恢复真相；必须持久化 task id 和 reconcile 状态。
- Skill 的自然语言说明不是可执行权限，权限由 Nomi adapter 和主进程代码决定。

## 8. Prompt 架构

Prompt 不是一个字符串，而是一条可版本化的编译链：

```text
视频/帧/转写（不可信数据）
  -> 事实拆解 Prompt
  -> ShotBreakdown + evidence + confidence
  -> 用户意图归一 Prompt
  -> RecreationIntent(change/preserve/forbid)
  -> 确定性 Provider Compiler
  -> GenerationRecipe + renderedPrompt
  -> QA Prompt / 确定性媒体检查
  -> QualityReport
  -> 定向重试 Prompt（只消费失败项）
```

五层职责：

| 层 | 允许做什么 | 禁止做什么 |
|---|---|---|
| 事实拆解 | 只描述看见/听见的内容，给证据和置信度 | 推断身份、品牌所有权、剧情动机或生成建议 |
| 意图归一 | 把用户原话整理为 change/preserve/forbid/uncertainty | 擅自加入“电影感、8K、史诗”等目标 |
| Provider 编译 | 根据能力档案映射引用语法、时长和参数 | 丢弃不支持字段后静默提交 |
| QA | 判断变更命中与未要求区域保持，输出证据 | 用一个“像不像”总分替代分维度结论 |
| 定向重试 | 只修失败维度，锁定已通过项 | 重新设计整个片段或扩大选区 |

完整模板、Schema、Provider 示例和测试向量见[附录](2026-08-29-video-recreation-prompts-and-contracts.md)。其中直接吸收 OpenStoryline 的“客观、禁止编造、场景聚合、连续运镜”原则，但不机械复制 `cinematic masterpiece` 一类无可验证词。

## 9. 模型能力与路由

### 9.1 理解模型

Gemini 官方视频理解能力可做描述、分段、问答、信息提取和时间戳引用，并支持 Structured Output。已知限制是默认视觉采样约 1 FPS，快动作可能丢失；结构化输出只保证语法符合，不保证语义正确。

P0 路由：

- ffmpeg 先做确定性 probe、切镜、首/中/尾帧和边界附近帧。
- 普通片段给 VLM 视频 + 关键帧；高运动片段提高到 2–4 FPS 或追加短窗口抽帧。
- OCR/ASR 不在 P0 强依赖链时，字段明确标为未验证，不能让 VLM 猜对白。
- Schema 在本地做范围、枚举、证据、时间码和跨字段校验；修复一次仍失败则进入 `needs_review`。

### 9.2 生成/编辑模型

| 任务 | 高优先 Spike | 原因 | 路由前必须验证 |
|---|---|---|---|
| 局部主体/背景/光线编辑 | Kling Video O1、Runway Aleph | 都有官方原生视频编辑与保持语义 | 3–10 秒稳定性、引用限制、费用、任务恢复、数据保留 |
| 参考视频复刻 | KIE Seedance 2.5 | 支持多模态参考、视频窗口和匹配输入时长 | `duration=-1` 实际行为、首尾帧模式互斥、保留能力 |
| 首尾帧过渡/补帧 | Nomi catalog 中支持 first/last frame 的已验证模型 | 与边界衔接直接相关 | 运镜锁定、形态差异、首尾帧误差 |

APIMart 当前候选文档未形成可信 `video_understanding` 合同，继续作为待核验项；KIE/生成 catalog 名称不能自动被当成理解 Provider。

### 9.3 路由规则

路由先硬约束，后质量评分：

1. 输入类型、时长、大小、分辨率、引用数量、地区/账户可用性必须满足。
2. 任务类型必须匹配：edit、reference recreate、first-last transition 不能混用。
3. 用户锁定项必须被 Provider 合同表达；表达不了就阻止提交或明确要求换模型。
4. 候选按离线评测的 preservation、adherence、boundary、cost、latency 排序。
5. UI 可显示“推荐/更快/更省”，但不展示一排技术参数让用户自行研究。

## 10. Agent 设计

### 10.1 逻辑角色

这些是一个 Project Agent Host 内可测试的逻辑职责，不是八个独立 Agent、Session 或 runtime owner：

```text
Intake
  -> Analyst
  -> Intent Normalizer
  -> Prompt Compiler
  -> Capability Planner
  -> Executor
  -> QA Reviewer
  -> Edit Proposal
```

- `Intake`：确认来源、范围、目标、锁定项和权利状态。
- `Analyst`：产生带证据的事实，不给创意建议。
- `Intent Normalizer`：忠实整理用户要求，暴露冲突和不确定项。
- `Prompt Compiler`：将 canonical intent 映射为 Provider recipe；尽量由确定性代码完成。
- `Capability Planner`：选择满足硬约束的模型，估算费用，产生 `PlanCandidate`。
- `Executor`：只执行冻结 `ExecutionContract`，持久化 task id 和状态。
- `QA Reviewer`：执行媒体 probe、证据帧和分维度检查。
- `Edit Proposal`：提出时间轴替换，不直接 Apply。

### 10.2 权限矩阵

| 动作 | Agent 自动 | 需要人审 | 永久禁止 |
|---|:---:|:---:|:---:|
| ffprobe、切点建议、抽帧、联系表 | ✓ |  |  |
| 本地分析、Prompt 草案、QA | ✓ |  |  |
| 修正明显的 schema/时间范围格式 | ✓ |  |  |
| 修改用户已锁定的 preserve/forbid |  |  | ✓ |
| 把源视频/参考图上传外部 Provider |  | ✓ |  |
| 产生付费提交 |  | ✓，必须含费用上限 |  |
| 复用真人身份、品牌、原音频 |  | ✓，必须含权利声明 |  |
| 扩大用户选区或批量生成其他片段 |  |  | ✓ |
| `submission_unknown` 后创建新任务 |  |  | ✓ |
| 覆盖原始资产或直接写 TimelineStore |  |  | ✓ |
| 提出 canonical `timeline.write` Proposal payload | ✓ |  |  |
| Apply 到时间轴 |  | ✓ |  |

### 10.3 恢复与防重复扣费

- `PlanCandidate` 可编辑；一旦冻结为合同，任何变更都必须创建新 revision。
- 每个提交持久化 attempt、Provider task id、请求 hash 和最后查询游标。
- 请求已经发出但响应丢失时进入 `submission_unknown`。只能用 Provider idempotency key 或查询接口 reconcile，不能自动重提。
- 生成完成后先下载、probe、hash 成本地 artifact，再进入 QA；远程 URL 不是最终资产。
- Apply 使用目标 timeline revision/hash，若用户期间改过目标片段则返回 stale/needs_attention，不能覆盖新编辑。

## 11. 数据合同

需要冻结的语义 payload 与 Artifact schema（不等于新增 store 或 lifecycle owner）：

| 对象 | 职责 | 关键不变量 |
|---|---|---|
| `VideoAnalysisArtifact` | 描述采样、理解和校验产物 | 作为 Artifact metadata；付费、状态与恢复仍由 ProductionRun 持有 |
| `ShotBoundary` | 建议/确认切点 | frame 为真相；来源与 confidence 可追踪 |
| `ShotBreakdown` | 片段事实 | 每项可为空；模型事实带 evidence 和 confidence |
| `RecreationIntent` | 用户的改变/保留/禁止 | 用户锁定项不可被 Agent 覆盖；保留用户原话 |
| `GenerationRecipe` | Provider-neutral 计划和 Provider 编译结果 | 能力预检通过后才能冻结；包含 policyVersion |
| `RecreationArtifactRef` | 某一选区的候选语义引用 | 原片为 immutable base；实际二进制和生命周期由 Artifact/ProductionRun 持有 |
| `QualityReport` | 分维度 QA 与证据 | pass/fail/unverified 分开；总分不能掩盖硬失败 |
| `TimelineReplacementPayload` | 从源范围替换为某 Artifact | 由 Host 包进 Proposal；带 target hash/revision；stale 不强行执行 |

完整 TypeScript 草案与 JSON 示例见[附录](2026-08-29-video-recreation-prompts-and-contracts.md)。

## 12. Nomi 代码架构与复用

### 12.1 已有能力

| 能力 | 当前真相源 | 用法 |
|---|---|---|
| 切镜与联系表 | [`detectShotCuts.ts`](../../electron/video/detectShotCuts.ts:99) | 作为本地建议层；沿用 `truncated` 和缓存策略 |
| 指定时间抽帧 | [`extractVideoFrame.ts`](../../electron/video/extractVideoFrame.ts:108) | 首/中/尾、边界 proof frames；失败不冒充成功 |
| 时间轴片段/source offsets | [`timelineTypes.ts`](../../src/workbench/timeline/timelineTypes.ts:23) | frame 和 offset 是编辑真相，不创建第二时间轴 |
| split/resize/undo | [`workbenchStore.ts`](../../src/workbench/workbenchStore.ts:523) | Apply 复用离散编辑和撤销语义 |
| 候选冻结合同 | [`executionContract.ts`](../../electron/capabilityCore/executionContract.ts:16) | `PlanCandidate -> ExecutionContract`、hash、字段校验和新 draft 规则 |
| 费用/目标签名确认 | [`approvalReceipt.ts`](../../electron/capabilityCore/approvalReceipt.ts:25) | 绑定 contractHash、targetHash、pricing snapshot 和 maximum |
| ProductionRun | [`productionRunTypes.ts`](../../electron/productionRun/productionRunTypes.ts:6) | 复用信任档位、预算门、shot 粒度合同和恢复机制 |

### 12.2 #223 之后的新增边界

实现应在现有 owner 中增加窄 adapter/schema，而不是创建 `electron/videoRecreation` runtime 或 `VideoRecreationWorkspace`：

| 新增内容 | 所属边界 |
|---|---|
| `RecreationIntent`、分析/QA Artifact schema | provider-neutral capability/domain contract |
| source/range Agent attachment | 现有 Canvas Agent attachment/read projection |
| Provider compiler 与 capability profile | ProductionRun/provider adapter 边界 |
| 一次确认的复合 approval payload | Project Agent Host Proposal contract |
| 候选节点 materialization recipe | canonical `canvas.write` adapter |
| 对比后 replacement payload | canonical `timeline.write` adapter |
| 节点内选区与对比 UI | 现有 GenerationCanvas nodes/components |

边界规则：Host 持有 Thread/Turn/Item/Proposal；ProductionRun 持有任务、预算、Provider receipt、取消、恢复和 Artifact；Canvas/Timeline 各自持有 mutation、receipt 与 Undo。Renderer 只消费投影并提交用户意图，不持有 Provider key、不执行重活，也不 mint authority/hash。

### 12.3 实施前需做的代码 Spike

1. 验证现有 `TimelineClip` 的 offset 能否完整表达“同源片段 -> 生成版本替换 -> Undo”，不足字段只能在领域 Proposal 中补，不复制 Timeline。
2. 验证 ProductionRun 的 shot 粒度计划能否把 `segmentId/versionId/targetHash` 放进现有 reference/parameters；优先扩合同，不创建平行 Run 引擎。
3. 确认远程视频落资产的 hardened fetch、大小上限和断点行为；TikHub 只返回下载来源，不返回理解结果。
4. 用一个假 Provider 完成提交、unknown、reconcile、成功、失败、重启恢复的契约测试，再接真实模型。

## 13. 成本、隐私、版权与安全

### 13.1 成本

- 分析前显示估算：采样级别、视频时长、是否远程上传、可能的 token/调用费用。
- 生成前显示上限而非模糊“约若干积分”：片段时长、候选数、分辨率、模型、单次与最大费用。
- QA 需要额外模型费用时单独计入 recipe，不允许生成后才出现隐藏成本。
- 定向重试是新付费 attempt，必须显示“为什么重试”和“哪些已通过项不会重做”。
- 预算未知时不伪造价格；标 `costCertainty=partial`，P0 默认不允许无上限提交。

### 13.2 隐私

- 默认本地 probe、切镜和抽帧；只上传所选片段和必要引用，而非整段来源视频。
- 上传确认展示 Provider、素材列表、预计保留时间和删除能力；不支持远程删除时明确写出。
- API key 只在主进程/安全存储；日志不写二进制、签名 URL、Prompt 中的隐私字段或密钥。
- 项目删除时清理本地分析缓存；远程删除按 Provider 能力记录 `requested/confirmed/unsupported`。

### 13.3 版权与安全

- 导入时记录来源 URL、时间、hash 和用户的权利声明，不判断其法律真伪但保留审计事实。
- 真人身份、未成年人、品牌 Logo、受保护角色和原音频复用进入显式确认；高风险内容沿用全局安全政策。
- 默认复刻镜头结构、节奏和动作意图，不默认复制品牌、人物身份、台词和音乐。
- 视频里的字幕、二维码、口播、OCR 和 metadata 都是**不可信内容**，只能作为分析数据，不能触发工具、打开链接或改变 Agent 指令。

### 13.4 观测、支持与止损

- 关键事件：`source_imported`、`segment_selected`、`intent_confirmed`、`preflight_viewed`、`spend_approved`、`submission_terminal`、`qa_reviewed`、`segment_applied`、`segment_undone`。
- 事件只记录 task 类型、范围长度、Provider/model version、费用、状态和匿名失败码；不记录 Prompt 原文、帧图、签名 URL 或人物信息。
- 支持包可导出 source/contract/task/QA 的 id、hash、时间线与脱敏日志，不能包含原视频和 key。
- Provider 必须有新提交 kill switch：关闭后仍允许查询、reconcile 和下载已经付费的任务。
- 质量、重复扣费或数据策略触线时只关闭生成，不影响本地拆解和已生成版本的审阅/导出。

## 14. 两个必须先做的验证

### 14.1 用户研究

对象：短视频创作者 4 人、品牌/营销 3–4 人、专业剪辑 3–4 人，共 8–12 人。使用当前 HTML 样张与 3 个真实素材任务，不先讲功能。

任务：

1. 在 42 秒视频中选出 5 秒目标动作，并把边界修准。
2. 只替换人物外观，保持推镜、动作、环境和原时间轴音频。
3. 判断一个“主体改对但背景漂移”的候选是否可用，并发起定向重试。
4. 把合格版本替换到完整视频，再撤销。
5. 找到生成费用、外传素材和未验证 QA 项。

采集指标与 Go 阈值：

| 指标 | Go 阈值 |
|---|---:|
| 无引导完成核心任务 | ≥ 80% |
| 选区边界错误 | 中位数 ≤ 2 帧 |
| 找到并理解费用确认 | ≥ 90% |
| 明白生成不会覆盖原片 | 100% |
| Apply 后能自行 Undo | 100% |
| 完成一次意图所需 Prompt 改写 | 中位数 ≤ 2 次 |
| “拆解/局部重拍”命名理解 | ≥ 80%，否则调整文案再测 |

每次观察用户停顿、误点和追问，不只收满意度。低于阈值的核心任务必须改原型并复测，不能用帮助文案掩盖。

### 14.2 模型 Spike

评测集至少 30 个 3–10 秒片段，覆盖 10 类，每类 3 个：主体替换、商品替换、背景替换、重打光、快动作、遮挡、多人交互、镜面/透明物、画面文字/Logo、明显运镜与转场。

对 Kling Video O1、Runway Aleph、Seedance 2.5 做同源对比；不支持某任务的模型记 `unsupported`，不能用失败分拉低后混成总榜。

每个样本记录：

- `edit_adherence`：要求的变化是否完成。
- `preservation`：未要求的主体、背景、光线、构图是否保持。
- `identity/product`：引用主体是否稳定。
- `motion/camera`：动作节奏与运镜方向是否保持。
- `boundary`：选区首尾与相邻原片是否连续。
- `duration/audio`：时长、帧率和音频策略是否符合合同。
- `latency/cost/failure`：P50/P95、实际费用、失败与 unknown。

硬性淘汰条件：重复扣费无法防止、无任务查询/恢复路径、费用无法封顶、数据政策不可接受、关键 preserve 字段无法表达。质量 Go 阈值先设为：主要任务 `adherence ≥ 80%`、硬锁定项 `preservation ≥ 75%`、边界可接受率 `≥ 80%`，再结合人评校准；不得只看供应商宣传样片。

## 15. 研发拆分与排期

实际拆分以[落地主方案第 12 节](../plan/2026-08-29-video-recreation-product-loop.md)为准，并受 #223 阶段出口约束。依赖顺序固定为：

1. 冻结 Project Agent Host 复合审批、ProductionRun output slot、`canvas.write` placement 和 `timeline.write` replacement 的关联合同。
2. 完成 30 样本模型 Spike、Prompt policy、费用/恢复/引用限制和用户任务测试。
3. 交付一个 3–10 秒、单 Provider、单候选的画布薄切片。
4. 再补链接导入、独立拆解、QA 定向重试和多候选；不得先建平行 Workspace/Session 来抢跑 owner 依赖。

若按 2 名工程师 + 0.5 产品/设计 + 兼职模型评测估算，在 #223 Phase 3/4 合同已经稳定的前提下，Spike 到受控 Beta 仍可按约 5–6 周评估；Host/ProductionRun 合同未稳定的时间不应伪装进功能工期。

### Rollout

1. Internal：30 样本全量评测与团队真实项目，Provider 新提交默认可一键停用。
2. Design partner：5–10 名目标用户，限制单片 3–10 秒和每日预算，逐例复盘失败与 Undo。
3. Beta：达到用户研究、模型质量和重复扣费门禁后放量；任何硬门回退则只保留“视频拆解”。
4. GA：至少连续两周无重复提交事故，Accepted Segment Rate、单次接受成本和 P95 恢复时长稳定后再评估。

### P1

- OCR/ASR/节拍与 shot 对齐。
- 第二编辑 Provider 与按任务自动路由。
- 多选片段的预算汇总和逐段确认。
- 更丰富的 reference binding 与局部遮罩。
- 分析 Artifact 与 ProductionRun 在任务中心的统一投影视图。

### P2

- 多片段 Playlist、节奏重排和批量 QA。
- 高置信自动过渡、音频 ducking 与字幕同步。
- 可复用“复刻 brief”模板和项目记忆。
- 整片候选只作为显式高级模式，不成为默认按钮。

## 16. P0 发布验收

### 16.1 代码与数据

- 原始视频字节和 content hash 在所有编辑后保持不变。
- 分析/QA Artifact 可独立失败或重算；所有付费状态、重试和恢复仍由 ProductionRun 单一持有。
- 100% 执行请求有 source/intent/paid-action/placement-action hash、pricing snapshot 和同一 Host 人审回执。
- Schema 首次或一次修复后的可解析率 ≥ 95%；进入系统的 canonical object 100% 通过本地语义校验。
- 选区无负数、反转、越界和浮点累计漂移；重开后误差 ≤ 1 帧。
- 模拟网络超时 100 次不出现重复 Provider submission。
- Apply stale target 时 100% 拒绝静默覆盖；Undo 恢复前一 timeline revision。

### 16.2 用户体验

- 无付费确认不能产生 Provider submission。
- 一次生成确认同时绑定付费 Run 与候选 placement；主路径不得再弹第二张“落画布”确认。
- 用户始终能看到当前操作影响的时间范围。
- 生成结果默认是候选，不会自动覆盖完整视频。
- QA 硬失败和未验证项不能用绿色“通过”隐藏。
- 失败文案至少给一个下一步：重试查询、调整范围、换模型、减少引用、定向重试或保留旧版。
- 桌面与窄屏无关键控件遮挡、横向溢出或动态内容导致的布局跳动。

### 16.3 真实任务 E2E

- J1：本地导入 -> 切选 -> 拆解 -> 保存 -> 重启恢复。
- J2：链接导入失败 -> 可行动错误 -> 改用本地文件继续。
- J3：选区 -> 只改主体 -> 费用确认 -> 生成成功 -> QA -> Apply -> Undo。
- J4：Provider 返回 unknown -> 重启 -> reconcile 原任务 -> 成功，不重复扣费。
- J5：背景保留失败 -> 定向重试 -> 新版本通过，V1 和原片仍可用。
- J6：用户在生成期间改动目标时间轴 -> Apply 返回 stale，不覆盖新编辑。

## 17. 七角色审查结论

| 角色 | 最强质疑 | 本版处理 |
|---|---|---|
| 真实用户 | 我只想改一段，为什么要理解一堆术语？ | 只要求范围、变化、保留、接受四个决策；其余自动推导 |
| PM | “复刻”承诺是否过大？ | 产品入口保留易懂名称，实际操作叫局部重拍，并明确不承诺像素级复制 |
| 设计 | 是否又做成节点和卡片堆？ | 播放器和时间轴为主，右侧只编辑当前段，画布是显式二级出口 |
| 前端 | 会不会维护第二套时间轴状态？ | 工作台只投影现有 Timeline/source offsets，Analysis 只存边界证据和引用 |
| 后端 | 外部 Provider 失败会不会重复扣费？ | attempt、task id、idempotency/reconcile、submission_unknown 全部进入持久化合同 |
| 模型/Agent | Prompt 是否可测试、可切模型？ | canonical intent 与确定性 Provider compiler 分离，QA/重试按失败维度工作 |
| 安全/法务 | 是否变成盗用真人、品牌和音频的一键工具？ | 来源与权利记录、风险项确认、最小上传、禁止默认复制和可审计链 |

审查后的最终取舍：先把“一段改对且放心替换”做深，不做“整片自动复刻”的广而不可信版本。

## 18. 已定决策与尚待证据

已定，不再反复讨论：

1. 主交互是播放器 + 时间轴，不是满画布 shot 卡。
2. P0 包含局部重拍，不放到 P2。
3. 原片不可变，候选版本与 Apply 分离，必须 Undo。
4. 外部上传、付费、时间轴 Apply、真人/品牌/原音频复用需要人审。
5. Prompt 使用五层架构，Provider 私有语法不暴露给用户。
6. 不按 Star 盲装依赖；开源能力按方法、Provider、benchmark 三种方式集成。

尚待 Sprint 0 用证据决定：

1. 首发视频编辑 Provider：Kling Video O1、Runway Aleph 或 Seedance 2.5。
2. 用户界面主术语最终用“局部重拍”还是“改这一段”。
3. P0 是否默认保留时间轴原音频。推荐：用户完成权利声明后默认保留原时间轴音频，并默认静音生成视频自带音轨。
4. 质量阈值是否达到 Beta；达不到则只发布“视频拆解”，不把不稳定生成包装成复刻。

## 19. 一手来源

- [LibTV 官网](https://www.liblib.tv/)
- [libtv-labs/libtv-skills](https://github.com/libtv-labs/libtv-skills)
- [TikHub hybrid/video_data](https://docs.tikhub.io/api-184257345)
- [Adobe Premiere Generative Media Tool](https://helpx.adobe.com/premiere/desktop/edit-projects/edit-with-generative-ai/generate-media-with-generative-media-tool.html)
- [Runway Aleph 2.0 Prompting Guide](https://help.runwayml.com/hc/en-us/articles/52150503729171-Aleph-2.0-Prompting-Guide)
- [Kling Video O1 User Guide](https://kling.ai/quickstart/klingai-video-o1-user-guide)
- [KIE Seedance 2.5](https://docs.kie.ai/market/bytedance/seedance-2-5)
- [Gemini Video Understanding](https://ai.google.dev/gemini-api/docs/video-understanding)
- [Gemini Structured Output](https://ai.google.dev/gemini-api/docs/structured-output)
- [FireRed OpenStoryline](https://github.com/FireRedTeam/FireRed-OpenStoryline)
- [HyperFrames Video Agent Skills](https://github.com/saranambiar/hyperframes-video-agent-skills)
- [Remotion](https://github.com/remotion-dev/remotion)
- [LosslessCut](https://github.com/mifi/lossless-cut)
- [PySceneDetect](https://github.com/Breakthrough/PySceneDetect)
- [cobalt](https://github.com/imputnet/cobalt)
- [HyperFrames](https://github.com/heygen-com/hyperframes)

二手体验证据只用于补充 LibTV 登录后交互，不作为 API/能力承诺：

- [品玩：LibTV 实测](https://www.pingwest.com/a/316336)
- [白鲸实验室：LibTV 实测](https://zhuanlan.zhihu.com/p/2069807137602155975)
