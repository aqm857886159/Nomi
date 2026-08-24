# Video Agent 通用架构调研与 Nomi 方案建议

- 日期：2026-08-24
- 状态：研究结论，尚未进入实现计划
- 研究问题：
  1. “小说导入 → 逐步生产 → 最终成片”的产品是否适合用通用 Video Agent 架构承载？
  2. Nomi 现有的创作区、生成画布、时间轴/预览能否成为通用交互层？
  3. 应该先做一个垂直工作流，还是先做一个完全通用的 Agent/Workflow 平台？
- 研究边界：只读调研；没有调用真实 provider，没有消耗生成额度，没有修改飞书文档。

## 1. 结论先说

你的思路在底层逻辑上是对的，但“通用”不能理解成“先做一个什么任务都能自动完成的万能 Agent”。

推荐方案是：

> **通用执行底座 + 通用交互原语 + 垂直 Workflow Pack。**

具体来说：

- 通用底座负责项目上下文、实体记忆、能力目录、工具调用、权限/确认、可恢复 Run、幂等、资产和 Artifact。
- 通用交互原语负责对话、节点、候选、比较、预览、确认、写回、撤销、时间线和任务状态。
- 垂直 Workflow Pack 负责“小说到成片”“广告到成片”“口播到成片”等任务的步骤、默认顺序、检查点和用户语言。
- 第一条真正落地的 Workflow Pack 应该先做“小说/剧本 → 单集/镜头 → 成片”的窄闭环，用它证明底座和交互是否真的可复用。
- 不应该先做一个开放式 workflow builder，让用户自己搭任意 Agent 图；那会把工程复杂度和用户认知负担同时推给我们。

所以不是二选一：

| 方案 | 判断 |
|---|---|
| 只做一个专用小说产品 | 用户路径清楚，但底层容易再造一套状态和工具，未来扩展成本高 |
| 先做完全通用 Agent 平台 | 底层很漂亮，但用户不知道从哪里开始，且很难证明真实价值 |
| **通用底座 + 小说到成片 Workflow Pack** | **推荐**：用真实任务验证通用性，保留未来组合其它工作流的能力 |

关键取舍只有一句话：

> **我们要通用的是“怎么安全地组织、执行、检查和回滚创作”，不是把所有创作任务强行变成同一种流程。**

## 2. 飞书文档里的 DramaClaw 给出的真实证据

来源：[DramaClaw 产品使用手册（飞书文档）](https://neo-flying.feishu.cn/docx/JGNTdsjJuo748TxJkxecoYs2nth)，读取版本：revision 88，读取日期：2026-08-24。

### 2.1 它并不是单一的“小说一键成片”

手册明确把产品拆成两条创作路径：

1. **主线流水线**：虾料 → 虾塘 → 虾镜 → 合成。
   - 虾料：导入小说/剧本。
   - 虾塘：角色、场景、道具、声线等可复用资产。
   - 虾镜：剧集、脚本、Beat、镜头、音频、视频和合成。
   - 合成：交付成片。
2. **无限画布精修**：虾画。
   - 可以自由组合文本、图片、视频、音频、360 全景、导演世界和技能节点。
   - 候选结果先留在画布中，不自动覆盖主线。
   - 用户明确点击“写回”并选择目标后，结果才进入角色、场景、道具、Beat 草图、首帧或视频等正式位置。
3. **AI 导演助理**：虾导。
   - 查询项目进度。
   - 检查缺失资产。
   - 建议下一步。
   - 在画布侧边栏中结合当前上下文工作。
4. **任务中心**：虾条。
   - 展示排队、运行、成功、失败、取消和日志。

这和 Nomi 现有设计的对应关系很清楚：

~~~text
DramaClaw 虾料/虾塘     ≈ Nomi 创作区 + 项目记忆/资产上下文
DramaClaw 虾镜           ≈ Nomi 生成计划 + 镜头/节点生产
DramaClaw 虾画           ≈ Nomi 生成画布
DramaClaw 虾导/虾条      ≈ Nomi Agent 助手 + ProductionRun 状态/恢复
DramaClaw 合成           ≈ Nomi 时间轴预览/导出
~~~

### 2.2 最重要的产品设计不是 Agent，而是“主线与自由创作的边界”

DramaClaw 手册里有三个重要原则：

- 普通镜头走主线，复杂镜头进入画布精修。
- 候选结果默认不覆盖正式项目。
- 全局资产和当前 Beat 的写回影响范围不同，写回前要明确目标槽位和影响范围。

这说明用户价值不是“Agent 替我操作越多越好”，而是：

1. 用户不用自己管理几十个工具和上下文。
2. 复杂工作仍然可自由探索。
3. 探索结果不会静默污染正式项目。
4. 用户知道什么时候是草稿、候选、正式资产和成片。

这四点比“多 Agent”本身更值得复用。

## 3. 商业产品调研

### 3.1 LTX Studio：从脚本到 storyboard，再到 timeline

官方产品页：[LTX Studio AI Movie Maker](https://ltx.io/studio/platform/ai-movie-maker)。

官方明确展示了：

- 上传脚本/想法，自动生成完整 storyboard、场景、相机和角色。
- 用 Elements 管理角色外观、风格和声音，保证跨场景连续。
- 可以调整 shot type、prompt、style 和 sound。
- 可以只对特定镜头 Retake，而不是整部影片全部重做。
- 最后进入 timeline 完成编辑。
- 同时提供实时协作、pitch deck 和可编辑视频导出。

对 Nomi 的启示：

- “小说到成片”真正需要的是**场景/镜头级可编辑中间结果**，不是一次性视频黑盒。
- 角色/场景/风格需要成为项目级上下文，而不是每次生成重新写 prompt。
- Agent 应能提出 storyboard，但用户必须能改某一个镜头并局部重做。
- 时间轴是交付和审片的最后一层，不应该由 Agent 直接偷偷写入。

### 3.2 InVideo：对话式 Agent 与 single-shot 两种体验

官方帮助页：[用自己的脚本生成视频](https://help.invideo.io/en/articles/9382180-how-can-i-create-a-video-using-my-script)。

它同时提供：

- 对话式 Agent：边构建视频边和用户交流。
- Autopilot/single-shot：用户确认 prompt 后直接生成，不进行多轮对话。

官方对 closed-loop filmmaking 的说明：[Closed-Loop AI Filmmaking Pipeline](https://invideo.io/faq/what-is-a-closed-loop-ai-filmmaking-pipeline-and-how/)。

其核心描述是：

- 一个持久的 Agent context 贯穿 script breakdown、asset locking、storyboard、shot generation、voice、music 和 edit review。
- 先锁定角色表、地点参考和风格帧，再渲染镜头。
- 结果回到同一个上下文中进行 critique 和 correction，而不是在多个工具之间重新搬运。

对 Nomi 的启示：

- 对话式和 single-shot 不是互相替代，而是两种用户节奏：
  - 用户想探索时，多轮对话。
  - 用户已经确定时，一次确认直接跑。
- Nomi 的 P1–P3 single-shot 交付正好是安全的“确定后执行”层；未来 Video Agent 可以在其上增加“探索/规划”层。
- 关键不是持续聊天，而是**持久项目上下文 + 明确资产锁定 + 可回到同一 Run 修改**。

### 3.3 Runway Workflows：通用图形工作流的边界

官方文档：[Runway Workflows](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)。

它提供：

- 节点和连线组成工作流。
- Text、Image、Audio、Video 类型有兼容性约束。
- Media model、LLM、media utility 三类能力可以组合。
- 支持模板、分支、替换模型、批量编辑参数和锁定节点输出。
- 适合可重复、自动化、需要多个模型/步骤串联的创作流程。

对 Nomi 的启示：

- Nomi 画布做 Video Agent 的“可视化执行面”是合理的。
- 但节点必须带输入/输出类型、能力声明和副作用等级，不是任意连线。
- “锁定节点”很重要：已经认可的角色图、首帧、音频或视频结果不应因为后续重跑而静默变化。
- Agent 可以生成/调整图，但应该把锁定、重跑、替换和分支都投影成用户可理解的动作。

## 4. 开源框架和基础设施调研

### 4.1 LangGraph：最值得借鉴的是 durable pause/resume

官方文档：

- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph/overview)
- [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [Human-in-the-loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)

官方能力包括：

- graph execution
- checkpoints
- human-in-the-loop interrupt
- time-travel/debug
- fault-tolerant resume
- approve / edit / reject

对 Nomi 的结论：

- 这些机制和我们已经实现的 ProductionRun、receipt、outbox、reconcile 的方向一致。
- **不建议现在把 ProductionRun 换成 LangGraph state。**
- LangGraph 的 checkpoint 可以作为未来 Agent orchestration 的参考或适配层，但花费、provider submit、Asset 和 Timeline owner 仍必须是 Nomi 主进程自己的 Run/contract。
- 如果未来接入，应该是“Agent graph -> PlanCandidate/EditProposal”，而不是“LangGraph 直接调用 provider/写 Canvas”。

### 4.2 AutoGen：适合研究多 Agent 协作和状态保存，不适合当 Nomi 事实源

官方文档：

- [AutoGen AgentChat Introduction](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/index.html)
- [Human-in-the-loop](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/human-in-the-loop.html)
- [Managing State](https://microsoft.github.io/autogen/dev/user-guide/agentchat-user-guide/tutorial/state.html)

官方展示：

- AgentChat agents 和 teams。
- RoundRobin 等团队编排。
- 运行中或下一轮接收用户反馈。
- 保存/加载 team state。

对 Nomi 的结论：

- 可以借鉴“planner、reviewer、specialist team”的职责划分。
- 不要把多 Agent 对话记录当作 ProductionRun 的业务状态。
- 多 Agent 在视频生产中更可能增加成本和不可控循环；第一版 Video Agent 应先使用一个可恢复 orchestrator + 明确角色，而不是默认 swarm。

### 4.3 OpenAI Agents SDK：工具、handoff、guardrail 的参考实现

官方文档：[Agents SDK Agents](https://openai.github.io/openai-agents-python/agents/)。

它把 Agent、Runner、tools、guardrails、handoffs 和 sessions 组合在一起，并支持模型/工具/隔离 workspace 等配置。

对 Nomi 的结论：

- 可以借鉴 tool allowlist、handoff 和 guardrail 的概念。
- 不能把任何外部 SDK 的 session 或 tool call 直接当作 Nomi lease/receipt。
- Nomi 的 provider-neutral adapter、能力目录和主进程权限边界必须继续独立存在。

### 4.4 ComfyUI、React Flow、Remotion、OpenTimelineIO：四个不同层次

- [ComfyUI 官方文档](https://docs.comfy.org/)：开源、节点式界面和推理引擎；适合借鉴模型/操作组合、workflow 保存和本地执行，但它偏低层生成工作台。
- [React Flow](https://reactflow.dev/)：可定制的 React 节点编辑器；适合 Nomi 现有画布的 UI 组件层，不是业务状态 owner。
- [Remotion](https://remotion-dev.github.io/remotion/)：用 React 和参数化渲染生成真实 MP4；适合未来确定性合成/模板渲染，不应成为 Agent 的任意代码执行口。
- [OpenTimelineIO](https://opentimelineio.readthedocs.io/en/latest/)：编辑决策信息的 API 和交换格式；适合 P5+ 的时间线互操作，不应提前替代 Nomi 当前 Timeline owner。

## 5. 研究论文给出的架构警告

### 5.1 不能把多镜头当成 N 个独立单镜头

- [EntityBench](https://arxiv.org/abs/2605.15199)：长距离跨镜实体一致性会显著下降；显式 entity memory 有帮助。
- [VideoMemory](https://arxiv.org/abs/2601.03655)：生成前检索实体，生成后更新记忆。
- [InfinityStory](https://arxiv.org/abs/2603.03646)：背景一致性、多主体出入场和镜间转场是独立难题。

因此，未来 Video Agent 必须在每个 shot 前后维护：

- 角色、道具、场景的引用版本。
- 该镜头使用了哪些视觉锚点。
- 该镜头改变了哪些状态。
- 下一镜头继承什么、拒绝什么。
- 结果是否可以更新全局实体记忆。

### 5.2 Planner 和 Executor 必须分开

- [TempAct](https://arxiv.org/abs/2606.28016) 的核心教训是 planner 和 executor 的反馈目标不同；单一长 prompt 或执行中随意切 prompt 会导致语义混合和错误传播。
- [TOC-Bench](https://arxiv.org/abs/2605.09904) 强调对象状态、遮挡后再出现、事件顺序等时间一致性问题。
- [TC-Bench](https://arxiv.org/abs/2406.08656) 可用来评估首态到终态的组合变化和动作顺序。

这直接支持 Nomi 已有的冻结合同原则：

~~~text
Planner：理解意图、读取上下文、提出候选计划、指出风险
Reviewer：检查参考素材、脚本/镜头/结果、提出修正建议
Executor：只执行已冻结的 ExecutionContract，不在 provider 已接受后改合同
Human gate：在花费、写回全局资产、写时间轴、导出前做最少但关键的确认
~~~

## 6. Nomi 应采用的 Video Agent 架构

### 6.1 不新增一个“万能 Agent 页面”

建议先不增加第四个大页面。Video Agent 应作为跨三个现有界面的连续控制面：

~~~text
创作区
  负责目标、故事、小说/剧本、风格和“我想得到什么”
  输出：可编辑的 Project/Story/Shot Plan

生成画布
  负责镜头级上下文、参考素材、候选、节点、模型/模式/参数
  输出：PlanCandidate、候选 Asset、EditProposal

时间轴/预览
  负责排列、审片、成片预览、写回/采纳、撤销和导出
  输出：Apply/Undo、最终 Artifact、Export
~~~

Agent 面板可以在三个地方出现，但身份和状态必须相同：

- 创作区：更像“制片人/编剧助手”。
- 生成画布：更像“镜头导演/生成执行助手”。
- 时间轴：更像“审片/剪辑助手”。

它们不是三个 Agent，也不是三个对话记忆。它们共享同一个 ProjectMemory、Operation/Run 和 context snapshot，只根据当前界面投影不同的下一步。

### 6.2 统一使用三种对象

1. **PlanCandidate**
   - 还没花费、还可编辑。
   - 允许换模型、换供应商、换模式、换参数、换参考素材。
2. **ExecutionContract**
   - 用户确认后冻结。
   - 包含具体 provider/model/variant/mode/parameters/references、contractHash 和 request fingerprint。
3. **EditProposal**
   - 生成结果如何进入 Canvas/Timeline/Asset 的建议。
   - 用户批准后 Apply，支持 Undo。
   - Agent 不能直接写全局资产或时间轴。

这样做的好处是：Agent 可以很自由地“想”和“提案”，但不能越过主进程安全边界。

### 6.3 Workflow/Skill 不是代码脚本，而是受约束的声明

未来一个 Workflow Pack 至少应声明：

- 用户目标和输入（小说、剧本、素材、项目、现有时间轴）。
- 可用工具和 module IDs。
- 允许的步骤/分支/并行。
- 需要的 capability（例如文本解析、视频生成、TTS、剪辑）。
- 每一步的输入/输出类型。
- 哪些步骤只是 propose，哪些步骤可能 paid，哪些步骤可能 project_write。
- 何时需要人确认。
- 失败、重启、取消、unknown 的下一步。
- 结果如何投影到创作区、画布或时间轴。
- 版本、content hash 和迁移策略。

“Skill”只描述方法、判断和提示词，不拥有权限；“Workflow”描述组合；Runtime/Run 负责真实执行。

## 7. 第一条垂直 Workflow Pack：小说/剧本到成片

建议的第一条用户旅程：

~~~text
导入小说/剧本
  → 识别章节/集/场景/角色/道具
  → 用户快速确认或修正故事结构
  → 建立角色/场景/道具/风格实体记忆
  → 生成一集的 shot plan
  → 用户在列表/画布中编辑镜头
  → 为每个镜头推荐真实可用的 mode/model/variant/parameters
  → 生成草图/首帧候选
  → 用户选择/锁定首帧
  → 生成视频/音频候选
  → 质量检查：剧情、角色、场景、动作、音画、时长
  → 对坏镜头局部重做
  → 形成 EditProposal
  → 用户批准写入时间轴
  → 预览、导出 MP4
~~~

这不是把 DramaClaw 的按钮照搬进 Nomi，而是把真实任务拆成 Nomi 的通用对象：

- 文本 → Project/Story context。
- 角色/场景/道具 → Entity/Asset memory。
- 镜头 → Shot/PlanCandidate。
- 生成 → ExecutionContract + ProductionRun。
- 质量 → Check module + reviewer proposal。
- 时间线 → EditProposal + Apply/Undo。
- 成片 → Artifact/Export。

## 8. 为什么现在不能直接做“完全通用 Workflow Builder”

### 用户侧风险

- 用户看到节点、分支、工具和参数，但不知道“我现在该做什么”。
- 小说、广告、口播、产品宣传的成功标准不同，通用图无法替用户决定检查点。
- 让普通用户自己搭 workflow，等于让用户学习我们内部的工程模型。

### 工程侧风险

- 任意 Agent 图容易绕过 provider capability、预算、lease、receipt 和 Run owner。
- 一旦允许任意远程代码或未注册插件，安全边界会回到 P0 的问题。
- 如果 Canvas、Timeline、Agent 各自保存状态，会再次产生第二真相。
- “通用相机控制”“统一 motion 参数”等抽象很容易把某个模型的能力错误推广给所有模型。

### 产品侧风险

- 没有第一条真实可交付的流程，就无法判断哪些节点真的需要用户看见。
- 先做平台会把“用户能否更快得到可编辑初稿”推迟到很后面。
- 过早抽象会导致 schema、UI、Agent prompt 和 provider adapter 同时漂移。

## 9. 用户交互建议

### 9.1 用户只需要看到四类决定

在默认界面中只露出：

1. 目标：我要做哪一集/哪一段/哪种成片。
2. 计划：系统准备拆成哪些镜头、用哪些实体和模式。
3. 关键差异：模型/variant/参考素材/成本/不支持项。
4. 结果动作：预览、重做此镜、采纳到时间轴、撤销、导出。

Agent 的内部思考、工具链、WAL、fencing、provider raw response 进入“详情/日志”，不占默认空间。

### 9.2 关键操作用“候选 + 一键确认”

- 先给 2–4 个候选，说明差异。
- “生成”只发生在用户确认后。
- “重做此镜”只重新执行该 Shot 的新合同，不重跑已经锁定的实体/镜头。
- “采纳到时间轴”显示目标轨道、覆盖范围和可撤销性。
- 用户说“换成另一个模型”时，直接更新同一个 PlanCandidate；不让用户重新填写整份表单。
- 用户说“换参考图”时，保留其它字段并重新做能力/预算预检。

### 9.3 三个界面如何连起来

| 位置 | Agent 表现 | 用户动作 | 不能做的事 |
|---|---|---|---|
| 创作区 | “把小说变成一集可编辑镜头计划” | 确认结构、改角色/场景/风格、进入镜头 | 直接花费、直接写时间轴 |
| 生成画布 | “这个镜头为什么不稳，给我 3 个可执行方案” | 换参考、换模式/模型、锁定候选、重做单镜 | 绕过 Contract/Run 直接 provider |
| 时间轴/预览 | “哪些镜头未就绪，成片节奏哪里有问题” | 预览、采纳、撤销、导出 | Agent 静默改用户时间轴 |

## 10. 验证 Video Agent 是否真的通用

不以“有一个很大的 Agent prompt”作为验收。至少做以下真实用户任务矩阵：

### J1：小说到一集可编辑初稿

- 输入短小说/剧本。
- Agent 生成章节/镜头计划。
- 用户改一个角色、一个场景和一个镜头描述。
- 结果进入画布，provider call 只发生在确认后。

### J2：自由换模型/variant/mode/参考素材

- 同一个镜头切换两个真实 catalog model。
- 一个模型换 variant。
- 从文生视频改为图生视频或首尾帧（仅当当前模型声明支持）。
- 替换、删除、重排参考图。
- 验证 context、参数约束、contract hash 和最终 runtime request 一致。

### J3：生成失败或结果不满意

- 只重做一个镜头。
- 已锁定的角色和首帧不被重跑。
- Agent 给出失败原因和唯一下一步，而不是重新生成整集。

### J4：跨镜一致性

- 角色在第 1、4、8 镜头再次出现。
- 验证实体版本、参考素材和状态变化可追踪。
- 评测角色/道具/场景一致性、事件顺序和镜间转场。

### J5：写回和撤销

- 画布中生成候选。
- 用户把候选写回角色/场景/Beat/时间轴。
- 确认影响范围。
- Apply 后真实预览变化，Undo 后回到原状态。

### J6：断线/重启/未知结果

- provider 接受后进程崩溃。
- Run 恢复并 query。
- 不能出现第二次 submit。
- 无 query 能力时进入 reconcile-only，并给用户可执行提示。

核心指标：

- 用户从目标到可编辑初稿的时间。
- 用户需要点击/确认的次数。
- 更换模型/参考素材后是否需要重新填写其它内容。
- preview 阶段 provider calls = 0。
- 一个 Run 的 provider submit count = 1。
- 失败后用户能否知道唯一下一步。
- 用户是否能解释当前候选、锁定结果和写回影响范围。
- 真实截图中是否出现重复卡片、隐藏状态、过多术语或无动作的错误。

## 11. 研究后的最终建议

现在不要在两个极端之间摇摆：

- 不是先做一个只服务小说的封闭产品。
- 也不是先做一个让用户自己搭任意 Agent 图的平台。

应先做：

1. **保留当前 ProductionRun/ExecutionContract/Asset/Artifact 安全底座。**
2. **在其上加 Video Agent orchestrator，但 Agent 只能提出 PlanCandidate、CheckResult、EditProposal。**
3. **第一条 Workflow Pack 选择“小说/剧本 → 一集 → 可编辑镜头 → 时间轴成片”。**
4. **把创作区、生成画布、时间轴视为同一个 Agent 的三个投影，不新增第四个大页面。**
5. **先验证 J1–J6，再决定是否开放用户自定义 Workflow/Skill。**
6. **只有当第二条不同类型 workflow（例如广告/产品宣传）能够复用同一底座、同一 Run、同一 Proposal/Apply、同一交互原语时，才宣布“通用架构已经被证明”。**

这条路线既保留你想要的“大底层架构”，也不会让用户为了使用它先学习一个 Agent 平台。

## 12. 现在需要的决策点

本轮研究不要求马上决定外部 Agent 框架。真正应该在下一阶段开始前确认的是：

1. **第一条 Workflow Pack 是否选“小说/剧本到一集成片”。**
   - 推荐：选它，因为有真实产品对照、用户目标明确、能覆盖文本/资产/镜头/音频/视频/剪辑全链路。
2. **Agent 面板是否作为三个现有界面的侧边/上下文面板，而不是新增第四页。**
   - 推荐：不新增第四页；同一 Agent 按当前界面切换职责和上下文。
3. **是否开放用户自定义 Workflow Builder。**
   - 推荐：暂缓。先支持内部受审核的 Workflow Pack 和 Skill manifest；等第二条 workflow 复用验证通过再开放。
4. **是否引入 LangGraph/AutoGen/OpenAI Agents SDK 作为 orchestration runtime。**
   - 推荐：暂不替换 Nomi Runtime。先借鉴它们的 checkpoint/HITL/guardrail 机制；如后续接入，只作为 Agent graph adapter，ProductionRun 仍是唯一执行事实源。
+

---

# 第二轮扩大调研：同类产品不止 DramaClaw

上一版已经能支持架构判断，但同类产品样本确实不够。本轮补充了三类产品：

1. **端到端叙事生产平台**：目标是从小说/剧本/创意走到短剧或成片。
2. **通用创意画布/工作流产品**：目标是把模型、素材和多个生成步骤串起来。
3. **Agent/工作流/渲染开源基础设施**：目标是提供持久执行、人工审批、节点编辑或确定性导出。

重要说明：以下“支持什么”以官方产品页/官方文档为依据；产品宣传页的质量、速度和商业效果属于厂商自述，不把它们当作 Nomi 已验证的能力。

## 13. 端到端叙事生产平台对比

| 产品 | 官方定位/入口 | 真实主线 | 用户能编辑什么 | 对 Nomi 的启示 |
|---|---|---|---|---|
| DramaClaw | [产品手册](https://neo-flying.feishu.cn/docx/JGNTdsjJuo748TxJkxecoYs2nth) | 文本 → 资产 → 脚本/Beat → 镜头 → 合成 | 角色、场景、道具、声线、画布候选、写回目标 | 主线 + 自由画布 + AI 助理是可复用结构 |
| LTX Studio | [AI Movie Maker](https://ltx.io/studio/platform/ai-movie-maker) | Script/Idea → Storyboard → Shot → Retake → Timeline | 场景、shot type、角色元素、prompt、声音、单镜头重做 | 计划和实体记忆必须在视频生成前出现 |
| InVideo AI | [Script to Video](https://help.invideo.io/en/articles/9382180-how-can-i-create-a-video-using-my-script) | Script → 对话式 Agent 或 Autopilot → 视频 | 脚本、媒体、音乐、字幕、语言和后续修改 | 探索模式和一次执行模式都要有 |
| PopShort.AI | [官方中文产品页](https://popshort.ai/zh) | Idea/小说/剧本 → AI Director → Story Bible/分集/资产/分镜 → 视频 | 生产资产、分集、模型、视频和 Editing Agent | “故事资产先于视频生成”已经是市场共识 |
| 文镜画师 | [官方产品页](https://wenjing.art/) | 剧本 → 角色/场景/分镜 → 图片/视频/配音/成片 | 影视画布、角色参考、多镜头一致性、模型和项目资产 | 入口应从内容任务开始，而不是模型列表 |
| OranTV | [官方产品页](https://www.orantv.com/) | 项目 → 剧本 → 资产 → 分镜 → 成片 | 项目资产、分镜、整集创作、用量 | 国内产品普遍采用项目/资产/分镜/成片主线 |
| SmartFrame | [官方产品页](https://www.smartframe.com.cn/) | 剧本 → 智能分镜 → 多角色配音 → 一键成片 → 分发 | 剧本、分镜、角色声音、成片和海报 | 垂直流程能快速交付，但可能把步骤固化成黑盒 |
| Zeshot | [官方产品页](https://www.zeshot.com/) | 系列短剧 → 多集成片 → 多语言/分发 | 作品、集数、模型组合、克隆剧和分发 | 系列化是 Nomi 从单镜走向多镜的真实方向 |
| Katalist | [官方产品页](https://www.katalist.ai/) | Script/Idea → 自动场景/镜头 → Story Canvas → Video | 脚本、场景、shot、角色 cast、故事画布 | 角色身份应是显式实体，不应藏在 prompt 里 |

### 13.1 共同结构

这些产品虽然面向不同市场，但都重复这一条依赖链：

~~~text
内容输入
  → 结构化故事/脚本
  → 角色/场景/道具/风格资产
  → 镜头或 storyboard
  → 图片/视频/音频生成
  → 局部修改
  → 合成/时间线/导出
~~~

原因很简单：

- 没有故事结构，就不知道要生成哪些镜头。
- 没有角色/场景/风格资产，跨镜一致性无法稳定。
- 没有 storyboard 或镜头计划，用户无法判断是否值得花钱。
- 没有候选和局部重做，用户只能整集返工。
- 没有时间线和交付层，生成素材不能变成成片。

### 13.2 三种产品取向

**工厂型**：PopShort、SmartFrame、OranTV、Zeshot。

- 入口直接，强调小说/剧本、集数、并发、配音、分发。
- 适合想快速批量产出的用户。
- 风险是中间步骤和决策容易被黑盒化。

**导演型**：LTX Studio、DramaClaw、Katalist、文镜画师。

- 强调 storyboard、角色 cast、画布和镜头级修改。
- 用户可以在中间阶段停下来审片和改动。
- 更适合精品镜头和协作。

**模型工作流型**：Runway、Higgsfield Canvas、ComfyUI。

- 强项是多个模型、素材和生成步骤的组合。
- 适合视觉实验、分支、批量和重复任务。
- 不会自动替用户决定故事结构和最终交付。

Nomi 应处在工厂型和导演型之间：从内容目标开始，但中间过程必须可编辑、可比较、可写回。

## 14. 通用创意画布和工作流产品

### 14.1 Runway Workflows

官方文档：[Introduction to Workflows](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)。

Runway 的关键机制：

- 节点有输入和输出。
- Text、Image、Audio、Video 类型必须兼容连接。
- Media model、LLM、media utility 可以组合。
- 有模板、分支、模型替换和批量编辑。
- 节点可以 lock，避免重跑时改变已经认可的结果。

可以迁移到 Nomi：

- ModuleManifest 的输入/输出必须类型化。
- 节点需要 locked、proposed、ready、failed 等状态。
- Agent 生成的是受约束的 graph proposal，而不是直接执行所有节点。
- 批量编辑只能暴露真正共同的字段。

不能直接照搬：

- Runway credit/执行系统不是 Nomi 的 ProductionRun。
- Nomi 必须保留 lease、receipt、budget、outbox、reconcile。
- provider 不支持某能力时，必须显示 unsupported、translated 或 unknown。

### 14.2 Higgsfield Canvas

官方产品页：[AI Canvas](https://higgsfield.ai/canvas-intro)。

官方描述：

- prompt、reference、generation 在一张无限画布上。
- prompt 生成 image，image 继续生成 video。
- style 可以分支成多个 variation。
- 多个模型共存于一条可视 pipeline。

可以迁移到 Nomi：

- 画布要展示“这个结果如何产生”，而不是孤立的素材卡。
- 换模型或参考图时保留上游上下文，并创建新候选分支。
- 模型组合由真实 catalog 驱动。

不能直接照搬：

- “任何模型都能连”不是安全抽象。
- 不同 provider 的参数和输入格式不能直接摊平。
- 生成节点仍须经过 ExecutionContract 和 ProductionRun。

### 14.3 Google Flow

官方资料：

- [产品介绍](https://blog.google/innovation-and-ai/products/google-flow-veo-ai-filmmaking-tool/)
- [帮助文档](https://support.google.com/flow/answer/16353334?hl=en)
- [更新说明](https://blog.google/innovation-and-ai/models-and-research/google-labs/flow-updates-february-2026/)

官方强调 scene image、camera controls、局部场景修改和 scene/story 组织。

对 Nomi 的启示：

- “场景”应成为比单个 prompt 更稳定的上下文容器。
- 修改场景中的一个主体时，不应重新生成无关内容。
- camera intent、subject motion、scene continuity 应保持不同语义。

不能照搬的地方：

- Flow 主要围绕 Google 自有模型栈设计。
- Nomi 是多 provider、多 model、多 mode，不能把 Flow 的 camera controls 当成所有模型通用字段。

### 14.4 Adobe Firefly Boards 与 Boords

官方资料：[Firefly Boards 教程](https://www.adobe.com/learn/firefly/web/create-commercial-storyboard-firefly-boards?src=helpx)、[Firefly Workspace](https://helpx.adobe.com/firefly/web/get-started/access-the-app/firefly-workspace-overview.html)、[Boords Storyboard](https://boords.com/docs/creating-storyboards)。

它们共同说明：

- storyboard/Board 是创作讨论空间，不是最终时间轴。
- script 可以转成结构化镜头板。
- 用户需要看到素材、风格、候选和关系。
- 视频生成可以后置，先交付一个可讨论的 storyboard 或 editable first cut。

## 15. 中国市场产品的共同信号

本轮额外查看了：

- [OranTV](https://www.orantv.com/)
- [SmartFrame](https://www.smartframe.com.cn/)
- [PopShort.AI](https://popshort.ai/zh)
- [文镜画师](https://wenjing.art/)
- [Zeshot](https://www.zeshot.com/)
- [知漫剧](https://www.zmj.net/)
- [漫映 AI](https://www.m-ying.com/)

公开页面反复出现：

- 小说/剧本到成片。
- 角色、场景、道具资产。
- 自动拆分镜。
- 多角色配音。
- 一站式工作空间。
- 系列化、批量化、多模型。

这说明市场需求已经不是“再做一个文生视频按钮”，而是：

> 用户希望把自己的内容交给一个项目空间，持续推进，过程中不丢角色、场景、镜头和成片上下文。

但公开资料很少说明：

- 合同冻结。
- provider 已接受后的未知处理。
- 重启恢复和重复提交防护。
- 写回全局资产的影响范围。
- 时间轴修改的撤销语义。

这正是 Nomi 可以建立差异的地方：不是只接更多模型，而是提供可编辑、可解释、可恢复的生产控制面。

## 16. Agent 和工作流开源基础设施

| 项目 | 解决的问题 | 可借鉴机制 | 不应成为 Nomi 的 owner |
|---|---|---|---|
| LangGraph | 长流程、checkpoint、HITL、恢复 | pause/resume、time travel、checkpoint | Project/Run/Asset/Timeline 事实 |
| AutoGen | 多 Agent team、反馈、状态保存 | agent role、team feedback、save/load | provider budget、receipt、项目写回 |
| CrewAI | Flows、state、router、持久化、HITL | 事件驱动 workflow、条件分支 | 生产合同和资产 identity |
| OpenAI Agents SDK | tools、handoff、guardrails、sessions | allowlist、handoff、tool guardrail | Nomi 的 provider-neutral 安全边界 |
| Temporal | crash-proof durable execution | 长时间运行、自动恢复、人工等待 | Nomi 的项目语义和用户可见对象 |
| n8n | 工具编排和工具级人工审批 | 某个工具调用前暂停 | 视频实体记忆、镜头语义、质量模型 |
| ComfyUI | 生成节点和推理工作流 | 可组合模型、可保存 graph | Nomi 的叙事规划和生产交付 |
| React Flow | 节点编辑器 UI | 节点、边、选择、工具栏 | 业务状态 |
| Remotion | 参数化确定性渲染 | React preview、server render、MP4 | Agent 任意代码执行 |
| OpenTimelineIO | 时间线交换和编辑数据 | EDL/Timeline interchange | Nomi 当前 Timeline owner |

官方参考：

- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [AutoGen HITL](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/human-in-the-loop.html)
- [CrewAI Flows](https://docs.crewai.com/index)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/agents/)
- [Temporal](https://docs.temporal.io/)
- [n8n HITL](https://github.com/n8n-io/n8n-docs/blob/main/docs/build/integrate-ai/ai-examples/human-in-the-loop-for-tools.md)
- [ComfyUI](https://docs.comfy.org/)
- [React Flow](https://reactflow.dev/)
- [Remotion](https://remotion-dev.github.io/remotion/)
- [OpenTimelineIO](https://opentimelineio.readthedocs.io/en/latest/)

### 16.1 不要因为看到 Agent 框架就替换 Nomi Runtime

这些框架解决：

- Agent 如何对话。
- Agent 如何分工。
- Agent 如何暂停/继续。
- Tool call 如何做 guard。

Nomi 已经有并且必须保留：

- ProductionRun。
- ExecutionContract。
- lease/receipt。
- budget。
- outbox。
- provider query/reconcile。
- Asset identity。
- Artifact。
- Timeline proposal/apply/undo。

未来如果引入外部 framework，正确关系是：

~~~text
外部 Agent/Graph
  → 读取 Nomi context
  → 产生 PlanCandidate / CheckResult / EditProposal
  → Nomi 主进程编译和校验
  → ProductionRun 执行
~~~

不是：

~~~text
外部 Agent
  → 直接调用 provider
  → 直接写 Nomi Canvas
  → 直接写 Timeline
  → 自己保存第二份任务状态
~~~

## 17. Nomi 的真正定位

Nomi 不应该只拼：

- 接入模型数量。
- 生成按钮数量。
- 一键生成宣传语。
- 单个镜头画质排名。
- 让用户看更多底层参数。

这些会把 Nomi 带向模型聚合器或低层工作流工具。

Nomi 应该拼：

1. **Connected context**：故事、角色、场景、道具、镜头、素材和时间轴不丢上下文。
2. **Editable plan**：用户能自由换模型、variant、mode、参数和参考素材。
3. **Capability-honest**：不同模型真实支持什么就显示什么，不把其它模型能力硬套过来。
4. **Recoverable production**：失败、断线、重启、provider unknown 都有可解释路径。
5. **Safe writeback**：候选不会静默污染正式资产或时间轴，用户知道影响范围且能撤销。
6. **MCP + GUI 一个控制面**：可以从 MCP 开始，也可以在 Nomi 内确认和修改，不重复确认、不丢上下文。

## 18. 一个真实用户例子

用户在创作区输入：

> “把这本悬疑小说先做成第一集 60 秒竖屏短剧，主角是林晚，保留雨夜车站和红色雨伞，先不要生成视频，给我看制作方案。”

Nomi 不应该立即生成，也不应该只回复一长段文字，而应展示可编辑计划：

~~~text
目标：第一集 / 60 秒 / 竖屏 / 悬疑
预估镜头：8 个
主要角色：林晚
核心场景：雨夜车站
关键道具：红色雨伞
建议风格：写实电影感
需要确认：角色参考图、场景参考图、视频模式
当前 provider calls：0
~~~

用户可以直接：

- 换林晚的参考图。
- 把 8 个镜头改成 6 个。
- 把一个镜头从文生视频改成图生视频。
- 选择另一个真实可用的 variant。
- 换掉红色雨伞参考素材。
- 修改一个镜头时长。
- 只生成首帧，不生成视频。

每次修改后都重新计算：

- 当前模型是否支持该 mode。
- variant 是否支持该参数。
- 参考素材是否满足输入约束。
- 预算和请求数量。
- 哪些镜头会受到全局资产修改影响。

用户确认后，才编译 ExecutionContract 并进入 ProductionRun。

用户感受到的是“我在导演一个项目”，而不是“我在填写供应商 API 表单”。

## 19. 真实 UI 自由度才是通用性的验收

不能用固定 fixture 证明 Video Agent 通用。真实用户会中途改变：

- 模型、供应商、variant、输入模式。
- 参考素材、画幅、时长。
- 角色形象、场景风格、镜头动作。
- 某一个镜头是否重做。

至少要覆盖：

### J1：小说到一集

导入短小说，生成结构和镜头计划，用户修改角色、场景和一个镜头，看到可编辑画布。

### J2：模型/模式/参数替换

切换到另一个真实 catalog model，切换 variant，文生视频改图生视频或首尾帧；不支持项必须在付费前阻止。

### J3：参考素材替换

删除、增加、重排和替换参考图；其它有效字段不能被偷偷清掉。

### J4：只重做坏镜头

第 3 个镜头失败时，只重做第 3 个镜头，已经锁定的镜头和实体不重新提交。

### J5：写回和撤销

画布候选写回角色、Beat 或时间轴；用户能看到影响范围，Apply 后预览变化，Undo 后恢复。

### J6：异常和恢复

覆盖 provider 超时、已接受但本地丢 task ID、进程重启、query 不支持、materialize 不支持；所有情况都不能盲重提或假装完成。

## 20. 修订后的路线

现在应该：

1. 保留 P1–P3 单镜 Runtime/Run/Contract/Asset。
2. 加 Video Agent orchestrator，但只允许提出 PlanCandidate、CheckResult、EditProposal。
3. 先做“小说/剧本 → 一集 → 可编辑镜头 → 时间轴”的 Workflow Pack。
4. Agent 作为三个现有界面的上下文面板，不增加第四个大页面。
5. 用真实 UI 变更矩阵验证通用性。
6. 等第二条不同类型 workflow 复用同一底座后，再考虑开放自定义 Workflow Builder。

现在不应该：

- 先做任意图形 Workflow Builder。
- 先引入多 Agent swarm。
- 把 LangGraph/AutoGen/CrewAI 作为 Nomi 业务事实源。
- 把 Seedance 的模式和参数抽成所有模型共有字段。
- 让 Agent 直接调用 provider 或写 Timeline。
- 因为宣传中的“一键成片”跳过中间计划和可撤销边界。

## 21. 后续决策点

1. 第一条 Workflow Pack 是否正式选“小说/剧本到一集成片”？
   - 推荐：选。
2. Agent 是否作为创作区、生成画布、时间轴三个界面的上下文面板？
   - 推荐：不新增第四页。
3. 是否现在开放用户自定义 Workflow Builder？
   - 推荐：暂缓，先做内部审核的 Workflow Pack。
4. 是否引入 LangGraph/AutoGen/CrewAI/Temporal 等外部 orchestration runtime？
   - 推荐：暂不替换 Nomi Runtime；先借鉴机制，未来只接 Agent graph adapter。

当前最重要的不是选哪一个 Agent 框架，而是证明：

> 用户可以带着真实变化，把故事从文本推进到可编辑初稿，再推进到可撤销的时间轴成片；过程中不丢上下文、不重复扣费、不被模型参数差异欺骗。
