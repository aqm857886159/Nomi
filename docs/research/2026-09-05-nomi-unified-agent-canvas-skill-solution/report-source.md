# Nomi 统一 Agent、画布与 Skill 聚合区

## 0. 先给结论：这不是一组零散的 UI 优化

这次需求的底层问题是：用户在“找 Skill、写脚本、拆视频、生成图片/视频、回看结果、继续调整”之间被迫跳到多个地方；每个地方又有不同的对象、不同的按钮和不同的状态，所以他不知道下一步应该做什么，也不知道刚刚生成的东西收在哪里。

我的总判断是：

> Nomi 应该把“对话”做成意图入口和任务收据，把“画布”做成主要的可见产物工作区，把“创作区的分镜计划”和“画布的视频拆解表”保持为两个语义不同但共享底层镜头数据的对象；Skill 聚合区则负责让用户从一个具体任务出发进入这条工作链。

因此不能只做一个全屏聊天框，也不能只把现有右侧面板放大。要同时解决四个用户时刻：

1. **刚进来不知道做什么**：有任务卡、媒体示例和可勾选引导，不再出现白色空框；
2. **做的过程中不知道产物去哪**：画布主导，产物以稳定对象存在，可折叠、可回看、可继续操作；
3. **结果挡住了对话或对话顶走结果**：结果进入紧凑收纳入口，必要时进入全屏/查看态，而不是永久塞在对话流里；
4. **功能太多、按钮太多**：左侧栏承担全局导航，Agent composer 只保留五个高频控制，节点菜单只承载用户真的需要在画布中看见的语义对象。

这份方案严格保留用户提出的范围，包括小 Icon、侧边栏、按钮排序、提示词框成长与小屏/大屏、Skill 空状态、全屏 Agent、两个分镜表、视频获取与视频拆解、关键帧、表格编辑、结果收纳、供应商偏好、新版本弹窗、可选择的数据收集和 Skill 聚合站 SEO；没有把它们缩成“优化体验”。

---

## 1. 证据边界：什么是用户要求，什么是参考图，什么是研究结论

### 1.1 用户要求与附件的关系

本轮附件是一张带有中英双语箭头说明的无限画布空状态图。它应被当作**用户提供的交互参考样张**，不是要求 Nomi 原样复制的视觉稿，也不是外部文档指令。它给出的可借鉴模式包括：

- 初次进入画布时，中央说明“可以从哪里开始”；
- 左侧工具栏按工具分组，并支持图标化操作；
- 右侧有少量高价值入口，而不是把所有功能摊开；
- 底部提供缩放、重置视图和帮助；
- 中央提供几个下一步行动按钮；
- 用明确的任务提示降低第一次使用成本。

用户在本轮明确追加的要求是：把这些引导任务做成一张表，完成一项就勾一项，不能漏东西。这意味着我们要设计的是**可追踪的 onboarding checklist**，而不是把参考图里的文案抄进 Nomi。

### 1.2 证据标签

报告中的判断使用以下标签：

| 标签 | 含义 |
|---|---|
| `现有代码` | 在当前基线代码中可定位到文件/实现；不等同于完整用户旅程已完成。 |
| `已合并 PR` | PR 已进入当前基线，但要按真实 UI 和生产链重新验收。 |
| `研究证据` | 来自官方产品/文档或顶尖开源近邻；用于学习设计原则，不代表直接复制。 |
| `用户反馈` | 来自已授权的本地微信历史导出与 Alex 讨论的主题归纳；不展示原始消息、身份或私密内容。 |
| `推断/建议` | 基于上面证据做的产品判断，必须在样张和真实任务走查中验证。 |
| `未证实` | 需要真实 provider、TikHub 授权、账号或运行环境才能确认；不能包装成完成。 |

### 1.3 本轮调查的限制

- TikHub 当前没有在本任务中可直接调用的 live 搜索凭据；现有 PR #463 的 E2E 是 loopback fixture，并非 TikHub 线上端到端证据。
- 当前 worktree 没有 `node_modules`，模型雷达命令因 `tsx: command not found` 未完成；这只能说明“今天没查成”，不能推断没有新模型。
- “Agent DMD”没有在仓库中找到可核实的同名文档或原则。暂时按仓库可核实的 Agent 交互原则、设计系统、D1-D6 用户决策逻辑执行；如果 DMD 是一个具体内部文档、设计方法或 PR，需补充准确名称/链接后再对齐。
- 本报告没有把第三方网站的 prompt、Skill 正文或媒体直接复制进 Nomi；来源搜集阶段只建立候选来源、授权和证据边界。

---

## 2. 当前 Nomi 状态：已有什么，缺什么，哪些不能重复做

### 2.1 当前架构事实

当前设计原则是“对话是任务索引/收据，画布是产物真相”；Pi runtime 负责 Agent 执行能力，Nomi 负责 provider、权限、生产能力、持久化和 UI。React Flow 是画布交互内核，Zustand 是业务与持久化真相源。关键依据：

- [当前架构](../../ARCHITECTURE-NOW.md)
- [Agent 交互原则](../../design/nomi-agent-interaction.md)
- [设计系统](../../design/nomi-design-system.md)

### 2.2 现有实现与差距

| 能力 | 当前实现 | 结论 |
|---|---|---|
| Agent shell / session / queue / approval / Skill / model / prompt | `ProjectAgentResidentShell` 已有成熟基础；composer 已有自动增长和内部滚动；Agent dock target 已覆盖主要工作区 | 复用同一个 shell/Host/Thread，不另造第二套 Agent。 |
| Agent 全屏 | 当前有停留式 Agent 和设计/测试研究，但没有完整的 fullscreen state 和真实生产闭环 | 新增状态，不新增 Host；必须由样张和真实任务验收。 |
| Agent 媒体/表格结果 | 现有主要是卡片和打开任务/产物导航，没有统一的脚本、表格、图、视频查看器 | 做紧凑结果入口 + 复用画布/媒体查看能力；拆解表主家在画布。 |
| 创作区分镜 | `StoryboardPlanEditor` / `StoryboardShotTable` 已有编辑、选择、生成和节点落地 | 这是“分镜计划”，不重做，不改成视频分析表。 |
| 视频拆解 | `deconstructVideo` 已能做切点、关键帧、VLM、音频/转写和结构化结果 | 数据基础已有；当前右侧 Portal 和“提取多图片节点”造成体验问题。 |
| 视频拆解 UI | `NodeDeconstructionPanel` 把结果放到右侧 Portal；`extractDeconstructionShotsToNodes` 会批量制造图片节点 | 根因修复：画布内单一“视频拆解表”节点，关键帧嵌入行；明确操作后才生成节点。 |
| 视频获取节点 | 当前有本地导入/播放/视频处理链，但没有完成“URL 输入 → 素材库 → 画布视频获取节点 → 拆解表”的完整用户入口 | 补两类语义节点和持久化链，TikHub 是输入适配器，不是画布之外的主操作。 |
| 工作区数量 | 运行时枚举仍是 `creation / storyboard / generation / preview` 四个 mode；产品讨论希望用户理解为剧本创作、电影感图文视频创作、剪辑三个主界面 | 不把 storyboard 变成第四个用户心智模型：它作为创作区内的分镜计划子视图，preview 作为剪辑/检查子视图；实现前需用样张确认信息架构。 |
| Canvas / Agent 同步 | 有 canonical storyboard patch bridge 和持久化研究，仍需统一共享对象和重启证据 | 以 `projectId + artifactId + revision` 为共享句柄，Agent 读写同一对象。 |
| Skill 本地库 | 有本地 Skill discovery/import/export/delete/use；有 Skill Pack v2 | 这是应用内库，不是面向官网的公共聚合站，也没有作者网址、媒体预览、收藏、版权状态和 SEO 投影。 |
| Provider | 有 provider/model 选择基础 | 需要新增全局供应商优先级，并与默认模型、运行时 snapshot、自动 fallback 区分。 |
| 新版本引导/清单 | 已有 `OnboardingChecklist` 4 步被动进度、`JourneyTour` 和首页 30 秒体验设计；不是空白起步 | 在现有状态机上扩展画布/Skill/视频拆解任务，不另造平行 checklist。 |
| 遥测 | 尚未完成 | 作为发现层和 opt-in 隐私机制，不混入核心生成路径。 |

### 2.3 明确不重复建设

以下项目已有能力或本轮已做出范围决定，不另造一套：

- 不新增第二个 Agent runtime、第二个 Thread store 或第二个画布内核；
- 不重做创作区的分镜计划表；
- 不把字幕提取、通用转写、视频工具拆成单独画布节点；它们作为 Agent Skill/工具；
- 不在图片/视频节点里做细粒度编辑器；对话可以调整提示和生成参数，节点微调仍走现有工具；
- HyperFrames/Remotion 动效节点不进入本轮主线，保留为后续 Agent Skill/独立任务；
- 不让视频拆解默认生成一堆图片节点；只有用户选中镜头并点击生成时才落节点。

### 2.4 代码/PR 审计的根因证据

当前真实链路是：

```text
TikHub 分享链接
  → 项目视频素材
  → 用户拖入生成画布
  → video asset node
  → 视频节点拆解
  → ffmpeg 切镜/抽帧 + VLM + Whisper
  → source video node.meta.videoDeconstruction
  → 右侧拆解表
```

当前还没有做到“TikHub/素材库选中后直接在画布创建视频获取节点”，也没有做到“拆解表直接进入 Agent Host 的结果收纳”。审计定位到的差距：

| 位置 | 现状 | 对本方案的影响 |
|---|---|---|
| `src/workbench/creation/storyboard/StoryboardShotTable.tsx` / `workbenchDocumentSlice.ts` | 创作区表围绕 `storyboardDesignsByDocumentId`，`storyboardPlans` 是兼容/可见投影；表编辑和生成链已存在 | 保留为 `分镜计划` 的 owner，不重做。 |
| `electron/video/deconstructVideo.ts` | 已有切点、多帧、VLM、音频/转写和结构化字段 | 保留算法基础；补 runtime schema/字段消费和 UI 映射。 |
| `src/workbench/generationCanvas/nodes/NodeDeconstructionPanel.tsx` | 结果写回源视频 node meta；右侧 Portal；当前主要是展示和选择 | 把宿主从右槽竞争者改为画布表节点/Agent 辅助投影。 |
| `src/workbench/generationCanvas/nodes/extractDeconstructionShotsToNodes.ts` | 每个选中镜头抽中点帧，创建 `kind: image` 节点并自动成组 | 取消默认全选铺图；保留为明确的“抽帧作为参考”动作，并加幂等绑定。 |
| `src/workbench/ai/ProjectAgentResidentShell.tsx` | 有 history、附件、mode、model、prompt、Skill picker、发送时 snapshot | 复用 shell；只补 fullscreen、result strip、视频/表格 artifact viewer 和拆解行 context。 |
| `src/workbench/workbenchStore.ts` / `WorkbenchShell.tsx` | 有 Agent dock collapse/width 和四个 runtime mode，没有真正 Agent fullscreen | 增加状态投影；产品层仍呈现三个主工作区。 |
| `src/workbench/onboarding/OnboardingChecklist.tsx` | 已有真实行为驱动的 `model/storyboard/generated/exported` 四步、默认收起、关闭/TTL | 扩展，不复制；新的画布/Skill 任务从同一状态源派生。 |

代码审计链接：

- [视频拆解引擎](../../electron/video/deconstructVideo.ts)
- [拆解结果面板](../../src/workbench/generationCanvas/nodes/NodeDeconstructionPanel.tsx)
- [拆解镜头落图节点](../../src/workbench/generationCanvas/nodes/extractDeconstructionShotsToNodes.ts)
- [Agent shell](../../src/workbench/ai/ProjectAgentResidentShell.tsx)
- [工作区状态](../../src/workbench/workbenchStore.ts)
- [现有引导清单](../../src/workbench/onboarding/OnboardingChecklist.tsx)

所以要修的是“结果 owner 和投影没有合流”的类根因，而不是单独把右侧面板挪个位置：

1. 建立唯一的 `source video node + DeconstructionResult.shots → 新建来源关联的 StoryboardDesign/VideoDeconstructionTable` 转换边界；
2. 每行带 `sourceVideoNodeId`、`sourceShotIndex`、时间范围、源帧版本和 provenance；
3. `Node badge`、画布表节点、Agent 结果条读取同一个 durable result；
4. Agent 不复制 shots 数组；若需要跨重启保存选中行，选中状态也要有明确 owner；
5. 把“转为分镜计划/进入生成”和“抽帧作为参考”拆成两个显式动作。

---

## 3. 两个“分镜表”必须分开

这是本方案最重要的语义边界。

### 3.1 创作区：`分镜计划`

**回答的问题**：我想拍什么？

来源可以是剧本、小说、对话或用户的创作意图。它是计划和生成编排对象，重点是：

- 场次/镜头编号；
- 画面意图、角色和动作；
- 景别、机位、风格、时长；
- 对白、旁白、音效；
- 图片 Prompt、视频 Prompt；
- 选中镜头生成图片/视频；
- 继续编辑后批量生成或落到画布。

它保留当前创作区已有格式和能力，推荐用户可见名称为“分镜计划”，避免和视频分析混淆。

### 3.2 画布：`视频拆解表`

**回答的问题**：这个已有视频实际上是什么？

输入是一个真实视频，输出是观察/分析结果，重点是：

- 时间段、镜头边界和时长；
- 行内关键帧；
- 景别、机位、镜头运动；
- 画面动作、角色和构图；
- 字幕、对白、花字/屏幕文字；
- 情绪、节奏、转场；
- 音频、音乐/音效（若可识别）；
- 可用于后续生成的 image prompt / video prompt。

它不是创作区计划表的复制版，而是“源视频 → 结构化事实 → 生成提示”的桥。

### 3.3 共享底层但不共享语义

两者都可以落到同一个 `ShotGenerationSpec` 低层结构，但必须携带来源和用途：

```text
StoryboardPlan
  source = authored_plan
  intent = plan_and_generate

VideoDeconstructionTable
  source = observed_video
  intent = analyze_then_generate

ShotGenerationSpec
  projectId / artifactId / revision
  shotId / start / end / keyframe
  visual / dialogue / onScreenText / mood
  imagePrompt / videoPrompt
  provenance: sourceArtifactId + sourceVideoId + sourceRowId
```

这样可以共享 Prompt Compiler、批量生成、节点落地和 Agent 工具，但不会让用户以为“视频拆解结果就是新的剧本”。

---

## 4. 端到端主流程：画布是视频拆解的主操作面

### 4.1 用户主路径

```text
TikHub / 本地视频 / 素材库
          ↓
       视频获取节点
     输入 URL / 选素材
          ↓
     视频已落画布并可播放
          ↓ 连接到右侧大加号
     视频拆解节点
          ↓
      视频拆解表
  关键帧嵌在每一行，不铺图
          ↓ 用户选行 / 选列 / 生成
    图片节点或视频节点
          ↓
  Agent 继续解释、改 Prompt、重生成
```

### 4.2 视频获取节点状态

| 状态 | 用户看到什么 | 可操作什么 |
|---|---|---|
| 空 | 视频图标、示例“粘贴视频链接或从素材库选择” | 打开输入框、选择本地/素材库 |
| 解析中 | URL、进度、取消；不假装已经拿到视频 | 取消、重试 |
| 已就绪 | 视频缩略图、时长、来源、播放按钮 | 播放、替换、连接拆解 |
| 失败 | 失败原因和下一步；区分链接无效、权限、网络、供应商限制 | 修改 URL、重新选择、交给 Agent Skill 处理 |
| 已替换 | 新旧来源清晰；不悄悄覆盖下游结果 | 保留或重新拆解，按用户确认执行 |

URL 不是“自动神奇变视频”的黑箱：视频获取的结果必须写入素材库，并携带原始 URL、来源平台、作者/发布者（若公开可得）、抓取时间、授权状态和本地 asset id。视频能否获取与能否二次使用是两个问题。

### 4.3 视频拆解表节点

表节点本身是画布中的稳定对象，可以缩小成摘要卡/图标，也可以在画布内展开为聚焦视图。它不再把每个关键帧自动变成独立图片节点。

默认显示列建议为：

| 必须显示 | 说明 |
|---|---|
| 镜头号 | 稳定 row id，不因排序改变原始编号。 |
| 时间 | 起止时间和时长。 |
| 关键帧 | 行内缩略图，可点开预览。 |
| 画面/动作 | 发生了什么，角色和空间关系。 |
| 景别/机位 | 近景、中景、全景、视角等。 |
| 镜头运动 | 推拉摇移、跟拍、固定等；不确定时标记未知。 |
| 字幕/对白 | 说了什么、字幕对应哪一段。 |
| 花字/屏幕文字 | 与对白分开，避免丢失短视频信息层。 |
| 情绪/节奏 | 情绪、强弱、节奏变化。 |
| 转场/声音 | 转场、音乐、音效或可识别的音频信息。 |
| 图片 Prompt | 用于静帧/参考图生成。 |
| 视频 Prompt | 用于运动生成。 |
| 生成状态 | 未生成、排队、生成中、完成、失败。 |

默认不把所有分析列一次性铺满。用户可以隐藏、显示、拖动顺序；镜头号、时间、关键帧为冻结的识别列，其他列可收起。宽屏/全屏时才展开更多列。

### 4.4 表格操作范围

V1 采用“够用的表格”而不是通用 Excel：

- 行内编辑；
- 新增、删除、复制、移动行；
- 新增、删除、重命名、移动列；
- 单元格复制/粘贴；
- 撤销/重做；
- 按镜头号、情绪、状态筛选；
- 导出 CSV；
- 选择行生成图片、视频，或复制 Prompt；
- 选择多行批量生成，生成结果关联回原行；
- 首列和关键帧列固定；
- 行高/缩略图尺寸切换。

不在 V1 做公式、宏、复杂协作权限或完整 Excel 兼容。Airtable 的 grid view 给出的密度、缩略图、字段隐藏、字段重排、行展开是值得学习的交互边界；StudioBinder 的 shot list 给出了面向影视制作的镜头列和导出思路。

### 4.5 Prompt 编译

视频拆解表不是“分析完就结束”。每一行必须可以把结构化字段编译成生成请求：

```text
固定来源：时段 + 关键帧 + 画面事实
用户控制：风格 / 角色一致性 / 目标画幅 / 模型 / 生成类型
分析字段：景别 + 机位 + 运动 + 情绪 + 对白 + 花字
输出：imagePrompt 或 videoPrompt
```

默认是**每行一个 Prompt**，避免把十几个镜头拼成一条无法修正的大 Prompt。表中修改某列后，Agent 可以只重编译受影响行；用户点击“生成选中镜头”才创建下游节点。

---

## 5. Agent 全屏与结果收纳

### 5.1 全屏不是第二个产品

Agent 状态建议为：

```text
docked → collapsed → fullscreen → result-focus
```

- `docked`：当前右侧停留 Agent；
- `collapsed`：只保留图标/未读/进行中状态，不占对话空间；
- `fullscreen`：占用主要工作区，仍复用原 Host、Thread、上下文和权限；
- `result-focus`：临时聚焦某个脚本、分镜计划、拆解表、图片或视频，返回后仍在同一任务。

推荐 fullscreen 保留 Nomi 的全局左侧栏和最小窗口/项目上下文，不做浏览器式无边框全屏；这样用户仍知道自己在哪个项目、可以切换工作区，也不会制造第二套导航。这个取舍的核心是“阅读和调整产物需要空间”与“不能失去项目位置感”之间的平衡。

### 5.2 Agent 中可以看的东西

| 产物 | Agent 中的呈现 | 主操作家 |
|---|---|---|
| 剧本 | 可读、可编辑的文本卡/文档视图 | 创作区；fullscreen 可专注编辑 |
| 分镜计划 | 可编辑表格/计划视图 | 创作区；Agent 可读写同一对象 |
| 视频拆解表 | 轻量预览和“在画布查看”入口 | **画布**；Agent 是辅助查看/操作 |
| 图片 | 结果缩略图/查看器，支持放大、下载、落画布 | 画布/素材库；Agent 结果入口不长期占屏 |
| 视频 | 缩略图、时长、原生播放/全屏播放 | 画布/素材库；Agent 可打开查看 |
| 生成过程 | 状态条和可取消操作 | Agent shell / 任务收据 |

关键原则：Agent 里的结果不是永久堆在对话流下方。完成后只留下一个紧凑的“结果条/收件箱”入口，显示数量、最近结果缩略图和状态；点击才打开结果面板或进入画布聚焦。对话继续产生新消息时，结果入口可以固定在 composer 上方或 header 的结果图标中，不会被消息顶走，也不会挡住输入。

### 5.3 结果条与查看器

结果条只负责提醒“有东西完成了”，不承担完整编辑：

- 图像/视频：缩略图、类型、成功/失败、打开、下载、落画布；视频用原生播放控件和全屏；
- 脚本/表格：名称、更新时间、未保存修改提示、打开编辑；
- 批量结果：数量 + 失败数量，不把几十张图全部铺开；
- 关闭/收起结果条不会删除产物；
- 对话引用结果时使用 `@产物` 或上下文 token，不复制整张表到 prompt。

---

## 6. Agent composer：五个按钮、上下文和提示词框

### 6.1 五个按钮的固定信息层级

按用户给出的布局，建议从左到右：

```text
[＋ 资料/参考] [模型] [Skill/上下文]          [模式] [发送/生成]
```

具体含义：

1. **最左“＋”**：上传资料、参考图、参考视频、文件、从素材库选择；
2. **模型**：选择模型，不在这里重复供应商排序设置；
3. **Skill/上下文**：选择 Skill、已加载资料和产物句柄；
4. **模式**：创作/分析/修改等工作模式；
5. **发送/生成**：发送、生成中显示停止；右侧保持动作一致。

中间留白是刻意的视觉分隔，不再把提示词模板、参考图、Skill、模型、模式各做一个常驻按钮。提示词模板放进 Skill/上下文弹层或 `@` 菜单，避免六七个并列 icon。

### 6.2 提示词框行为

- 初始高度短，保证对话界面轻；
- 输入增长到约 6–8 行后，内部滚动，不继续把 Agent 推出屏幕；
- 长文本时显示小的“展开/收起” icon，展开成编辑态；
- 收起不会丢 draft、光标和上下文 token；
- Skill 加载后显示可移除的 context token；发送时冻结本次 prompt、Skill、资料和模型 snapshot；
- hover、focus、按下、生成中、失败、成功均有轻量反馈，并遵守 reduced motion；
- 发送按钮必须是有效动作，禁用时解释原因，不做无反馈的点击。

现有 `AutoGrowTextarea` 已经有“增长到上限后内部滚动”的基础，方案是把它补成用户能理解的“大/小屏”状态，不另造一套输入框。

### 6.3 Icon 规范

使用项目既有 `@tabler/icons-react` 和 design tokens：

- 常驻 IconButton 28×28，图标 16px、stroke 2；
- 默认/hover/pressed/selected/disabled 明确区分；
- tooltip 只解释不常见图标，不给每个文字按钮加冗余气泡；
- tooltip 不能替代可见的初次引导；
- icon 只代表一个动作，避免“素材库+Skill+上传”共用一个不确定图标；
- hover 动效不改变布局，不依赖颜色唯一传达状态；
- `prefers-reduced-motion` 下关闭位移和连续动画。

---

## 7. 固定左侧栏：收纳全局，不制造第四个工作区

### 7.1 三个工作界面

保留用户指定的三类主界面：

1. **剧本创作**：文本、分镜计划、生成；
2. **电影感图文视频创作**：生成画布、素材、节点；
3. **剪辑**：时间轴、预览、剪辑相关工具。

全局左侧栏固定存在，承载“新项目”和库/工作区入口；它不把“新建分镜内容”单独变成第四个页面。

### 7.2 左侧栏分组

建议顺序：

```text
[新项目 +]
────────
[项目/最近]
[素材库]
[Skill 库]
────────
[剧本创作]
[图文视频]
[剪辑]
────────
[设置]
```

收起时保留图标和选中态，展开时显示名称、未读/任务数和 tooltip；分组之间有明确分隔，不用一堆没有名字的图标让用户猜。

### 7.3 文本区保持三面布局

创作区仍是：

```text
[可折叠的分镜计划侧栏] [中央脚本/表格内容] [Agent]
```

左侧由“新建脚本/分镜”的加号产生的内容可以缩小为 icon/窄条，节省空间；它不是一个新的第四栏。展开时显示最近计划、草稿状态和数量，点击才进入详细表。

---

## 8. Skill 引导与 Skill 聚合站

### 8.1 Skill 的产品定位

Skill 不是一个白色的“待用户自己想办法填”的框。它是 Nomi 让用户从任务进入工作流的入口：看懂一个具体结果，点击使用，Skill 被加载进上下文，用户只需补充自己的素材/要求。

三类一级分类与三个工作界面对齐：

| 分类 | 示例任务 | 结果形态 |
|---|---|---|
| 剧本创作 | 剧本创作、小说改编、短剧节奏、角色/场次规划 | 文本、分镜计划 |
| 电影感图文视频 | 电影感画面、图生视频、镜头运动、角色一致性 | 图片、视频、Prompt |
| 剪辑 | 视频拆解、节奏分析、素材整理、字幕/对白分析 | 视频拆解表、剪辑建议 |

字幕提取等通用工具放在 Skill/Agent 工具层；只有当结果需要在画布上继续看、编辑、连接时，才提升为画布对象。

### 8.2 Skill 空状态

首次进入某工作区时，显示 3 张精选任务卡，而不是空白：

- “电影制作 Skill”：封面图/短视频、描述“从主题到镜头计划和视觉参考”；
- “剧本创作 Skill”：剧本/分镜示例、描述“从灵感生成可编辑剧本和分镜计划”；
- “视频拆解 Skill”：视频帧/表格示例、描述“把视频变成可编辑的拆解表，并选择镜头生成”。

每张卡显示标题、用途、输入、输出类型、作者/来源、版本/更新时间、使用按钮。点击使用：

- 将 Skill 加入当前 composer 上下文；
- 显示一个可移除 token；
- 不覆盖用户已有 draft；
- 提示下一步需要的素材或一句示例 prompt；
- 发送后在任务收据中记录 Skill 版本。

### 8.3 公共聚合站与应用内投影

公共站的核心不是“复制最多内容”，而是为 Nomi 官网建立有用、可追溯、能导入产品的内容层：

- `/skills`：分类、搜索、排序、精选、最近更新；
- `/skills/script/...`、`/skills/image-video/...`、`/skills/editing/...`：按真实任务落地页；
- `/authors/...`：作者信息和作者原站；
- `/guides/...`：围绕“如何用 Nomi 完成某任务”的原创教程；
- 每个详情页提供“在 Nomi 中使用”“下载 Nomi”“复制 Prompt/Skill Pack”“收藏”入口；
- 应用内展示使用同一 catalog projection，不维护另一份手工卡片数据。

### 8.4 Skill 记录的最小字段

现有 Skill Pack v2 的 `SKILL.md + skill.json` 是本地导入基础，但公共目录需要更严格字段：

```text
id / slug / title / summary / category / tags
resourceType: agent_skill | prompt_recipe | workflow | showcase
authorName / authorProfileUrl / originUrl / repositoryUrl
license / licenseUrl / licenseSnapshot / sourceCommit
textRights / mediaRights / previewSources
contentHash / version / reviewedAt / status
qualityScore / evidence / compatibility / requiredInputs
actionPolicy: copy | download | import | use | favorite
seoTitle / seoDescription / canonicalUrl / noindex
takedownContact / takedownStatus / blockedReason
```

`actionPolicy` 必须由授权与审核状态推导，不能让运营手动把一个没有下载权的资源标成“下载”。作者网址为必填；找不到作者或原始地址的内容只能进入待核验队列，不能公开推荐。

### 8.5 三条来源渠道

#### A. 网站搜索

寻找有原作者、可查看授权、具有公开示例的来源。候选研究入口包括：

- [skills.sh](https://www.skills.sh/)：Skill 安装/发现模式，需注意其自身 telemetry 与第三方 Skill 执行风险；
- [Agent Skills 规范](https://agentskills.io/specification)：用于校验结构、渐进披露和安全元数据；
- [YouMind prompts](https://youmind.com/zh-CN/prompts)、[PromptHero](https://prompthero.com/)、[OpenArt Discovery](https://openart.ai/discovery)、[Civitai Images](https://civitai.com/images)：作为图像 Prompt/展示形态研究和候选来源，不默认取得转载许可；
- [AICameraMovements](https://aicameramovements.com/)：作为镜头运动 Prompt 的研究入口；
- [PromptBase](https://promptbase.com/marketplace)、[AIPRM](https://www.aiprm.com/prompts/)、[FlowGPT](https://flowgpt.com/)：作为 Prompt 市场/社区的版权、作者和导入边界研究。

#### B. GitHub

优先检查有明确 LICENSE、作者、提交历史、README 和可运行样例的仓库；候选方向包括 drama/script skills、visual skills、image/video prompting、ComfyUI/WanVideo 工作流和 Agent Skills 标准实现。候选发现不能直接当成可收录内容，必须逐仓库记录：许可证、作者、原始 URL、提交 hash、文本/媒体分别的授权、依赖风险和是否允许再分发。

参考近邻：[Anthropic public skills](https://github.com/anthropics/skills)、[Pi coding agent](https://github.com/badlogic/pi-mono)、[ComfyUI frontend](https://github.com/Comfy-Org/ComfyUI_frontend)。像 GPL/AGPL、无 LICENSE、仅允许个人使用、包含第三方媒体或要求登录下载的仓库，默认进入受限或 blocked 队列，不因“内容质量高”绕过版权。

#### C. TikHub

TikHub 适合发现抖音、小红书、X 等平台上的“作者分享了什么、原帖在哪里、用户如何评价”，不适合当作自动转载授权。接入后每条候选至少保留：平台、搜索词、原帖 URL、作者 profile URL、发布时间、媒体 URL、抓取时间、内容 hash、互动证据、是否需要登录、平台返回的权限/错误状态。

遇到登录、401/403/429、robots/terms 限制、作者不明、原帖删除或无法确认授权，就标记 `blocked`，不再盲目重试，也不将搜索摘要当成正文授权。TikHub 结果可生成“引用/学习卡”，但默认不下载、不镜像、不把原视频塞进 Nomi 公共站。

### 8.6 内容质量和排序

排序不要按“抓到多少”做，而按用户能否完成任务做：

```text
可使用性 = 来源可信 × 权利清晰 × 任务成功证据 × 输入输出清晰 × Nomi 兼容
```

可实施的排序：精选质量 > Nomi 兼容 > 有示例/媒体 > 最近验证 > 收藏/使用反馈。点赞/收藏只影响个性化和候选排序，不替代版权审核。低质量、重复、失效、投诉中的内容自动降权或 noindex。

### 8.7 版权声明与下架

公共站显著放置：

> Nomi Skill 聚合区用于发现、学习和导入公开的 Skill/Prompt/工作流资源。页面尽量保留作者、原始网址、许可证与来源说明；Nomi 不主张第三方内容的著作权，也不默认拥有第三方文本或媒体的再分发权。若你是权利人或发现内容存在侵权、误署名、错误授权或不应公开的个人信息，请通过页面的下架入口联系我们，我们会核验并在确认后下架、隐藏或限制访问。

实现上需要：投诉入口、takedown 状态、审核记录、原始来源留存、软删除、缓存失效、站内 noindex、搜索下架、管理员审计日志。不要承诺“收到投诉自动认定侵权”，但要承诺可追踪处理。

### 8.8 SEO 原则

SEO 站的核心应是 Nomi 自己的原创方法和可执行教程，而不是薄薄的第三方资源镜像。Google 的 people-first 指南强调清晰标题、来源、作者经验、原创价值和避免批量薄页面；因此：

- 先上线 10–20 个真正有用的精选任务页，再扩展目录；
- 每页有作者/来源、适用输入、输出示例、Nomi 操作步骤和原创说明；
- Skill 内容只做摘要和结构化元数据，正文/媒体按授权显示；
- canonical、sitemap、JSON-LD、Open Graph、双语 hreflang 和失效页处理；
- 未核验、投诉中、重复/低质页面 noindex；
- “下载 Nomi”是自然下一步，但不能每页硬塞广告；
- 收藏、复制、导出是应用动作，SEO 页面不能要求登录才能读懂核心内容。

参考：[Google people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)。

---

## 9. 竞品与开源近邻：学习什么，不照搬什么

| 近邻 | 观察到的机制 | Nomi 借鉴 | 不直接照搬 |
|---|---|---|---|
| Pi coding agent / Agent Skills | 小核心 + extensions/skills/prompts/themes；Skill 渐进披露；执行前要审查 | Pi runtime 做执行能力，Nomi 做权限、UI、provider、持久化；Skill 只在需要时加载 | 不把插件加载器、权限和产品状态交给插件自行决定。 |
| Claude Code | 常驻项目说明与按需 Skill/MCP/subagent 分层；Skill 有目录和 frontmatter | 分离“常驻产品规则”和“按需方法”；Skill token/版本可追踪 | 不把 Nomi 变成纯终端命令产品。 |
| LTX Studio | 从脚本到场景/分镜/视觉参考/时间线；脚本与视觉产物连续 | 保持文字→分镜计划→图片/视频→预览的连续链 | 不把所有用户都强制送进复杂时间线。 |
| Runway Agent / Multi-Shot | Agent 表达意图并规划；多镜头连接；图片/视频模型统一 | Agent 负责规划和修改，产物进入可见画布；支持按镜头生成 | 不让 Agent 黑箱覆盖用户已有资产；不隐藏实际模型/供应商。 |
| Adobe Firefly Boards | Board 中混合图像/视频、参考和预览 | 画布中混合媒体，但节点语义清晰、结果可收纳 | 不将所有内容变成自由堆贴，保留 Nomi 的生成链。 |
| StudioBinder | 镜头表字段、剧本关联、镜头 tag、导出和制作协作 | 视频拆解表列设计、分镜计划字段、CSV/PDF 后续导出 | 不在本轮做完整制作管理系统。 |
| Airtable | 同一数据多视图；grid 的字段隐藏/排序/分组/行高和缩略图密度 | 拆解表可配置列和密度；底层数据不随视图复制 | 不引入重型通用数据库编辑器。 |
| ComfyUI | 节点库/筛选/队列/历史/拖放；节点连接表达生成图 | 加号菜单只放画布真正需要的语义节点；队列/历史清晰 | 不让节点数量无限膨胀；不把通用工具全部变节点。 |
| MiniMax Design / LaAT 及已有 PR 研究 | 多模态创作工作区、工具与媒介整合 | 学习“一个任务覆盖多个媒介、结果仍可继续用”的布局 | 以仓库最新 PR 和真实 UI 为准，不把网页宣传当作已实现功能。 |

外部研究证明“连续创作链”和“表格/画布混合”是成熟方向，但没有替代 Nomi 自己的用户反馈：Nomi 当前最痛的是结果堆叠、对象散落、入口不明和 Agent 与画布不共用状态。

本轮竞品线还建立了 13 张可复核证据卡，覆盖 Runway、Krea、InvokeAI、ComfyUI、TapNow、LibTV、Boords、Descript、TwelveLabs、Replit Agent、Cursor、Claude Artifacts、Frame.io。完整卡片逐项区分“官方明确事实、登录墙/空白页等未证实行为、推断和 Nomi 判断”；因此不会把点击登录、生成入口或宣传页标签当成产品已完成证据。重点官方入口：

- [Runway Agent](https://help.runwayml.com/hc/en-us/articles/51601639579667-Creating-with-Runway-Agent) / [Runway Workflows](https://help.runwayml.com/hc/en-us/articles/45763528999699-Introduction-to-Workflows)
- [Krea Annotations](https://www.krea.ai/blog/annotations) / [Realtime Edit](https://www.krea.ai/blog/realtime-edit)
- [InvokeAI Canvas workflow](https://invoke.ai/features/canvas/run-workflow/) / [Gallery](https://invoke.ai/features/gallery/)
- [TapNow Agent](https://docs.tapnow.ai/en/docs/agent/tapnow-agent) / [TapNow Canvas](https://docs.tapnow.ai/en/docs/canvas/explore-the-canvas)
- [Boords storyboard views](https://assets.boords.com/docs/storyboard-views) / [Boords frame notes](https://help.boords.com/en/articles/3430147-adding-notes-to-frames)
- [TwelveLabs analyze videos](https://docs.twelvelabs.io/docs/resources/playground/analyze-videos)
- [Descript product tour](https://www.descript.com/tour) / [scenes and layouts](https://help.descript.com/hc/en-us/articles/10119710379917-Working-with-scenes-and-layouts)
- [Cursor Agent](https://prod.cursor.com/help/ai-features/agent) / [Design Mode](https://prod.cursor.com/docs/agent/design-mode)
- [Frame.io comparison viewer](https://help.frame.io/en/articles/9952618-comparison-viewer)

---

## 10. 用户反馈归纳：为什么这套方案要这样做

已读取本地授权的两组 Nomi 微信历史导出，并对 Alex 讨论做了主题归纳；报告不展示原始消息、用户身份、消息 ID 或私密内容。集中主题包括：

- 参考图不匹配、4K 模糊、图生 Prompt 不顺；
- 剧本 Skill、小说改编、故事骨架和分镜格式有真实需求；
- 电影、短剧、短视频模式边界不清；
- Agent/model 选择不清、反馈太快或太少；
- API 校验错误不持久、Skill 导入被误解成只能 JSON；
- provider/vendor 偏好和全局层级缺失；
- 画布缩放、右键、节点到 Agent 的引用路径不稳定；
- 视频生成后找不到、播放和全屏查看不够直接；
- 多结果、重生成、提示词/设置保留不透明；
- 用户希望 `@` 画布节点或产物给 Agent；
- 需要通用生成节点，但不希望每个小工具都占一个画布节点。

这些反馈支持以下产品判断：

1. **用户要的是可继续工作的结果，不是一次性聊天答案。** 所以产物要有稳定 ID、来源和位置。
2. **用户要看见“下一步”，不是读一堆说明。** 所以 Skill 卡和 onboarding checklist 必须直接绑定动作。
3. **用户不想被大量控件教育。** 所以高频五按钮常驻，其余进入有名字的上下文/加号菜单。
4. **视频拆解必须是一张表。** 右侧 Portal + 左边图片堆叠与用户任务不匹配，表才是可编辑、可比较、可继续生成的中间产物。

---

## 11. 新用户引导：把“参考图空状态”变成可勾选任务表

### 11.0 先复用当前已有引导，不从零再造

仓库里已经有一套真实的引导基础，不能在实现时重复造第二套：

- `src/workbench/onboarding/OnboardingChecklist.tsx`：当前是顶栏紧凑的“上手 N/4”，真实行为驱动四步勾选：接入模型、出现分镜/画布节点、生成成功、导出成片；默认收起，展开面板会让开创作区，避免遮住“拆成镜头·落画布”；
- `src/workbench/onboarding/onboardingState.ts`：有跨会话 localStorage 状态、折叠态、用户关闭、两天 TTL 和真实可用模型判定；
- `src/workbench/onboarding/JourneyTourController.tsx` / `JourneyTour`：有首页进入示例项目后的三步工作台 tour；
- `docs/design/2026-06-12-start-page-onboarding-v3-spec.md`：已有“30 秒体验”、示例项目、模型接入衔接、真实按钮 spotlight 和失败/重试设计；
- `tests/ux/onboarding-checkmark-honesty.walk.mjs`：已经验证 locked key 不能错误打绿勾、清单必须真实渲染、错误必须人话化；
- `tests/ux/design-fidelity.e2e.mjs`：已有清单/spotlight 的真实几何走查入口。

所以本轮正确动作是：**把现有四步基础清单扩展为“首个成功闭环 + 继续探索”两层清单，并让它和新的 Skill/画布任务共享判定与入口**。不把已有 onboarding 误判成“没有做”，也不把新表格写成第二个互相打架的 onboarding store。

### 11.1 引导不是一次弹窗

用户进入新版本后，需要在现有顶栏 `上手 N/4` 和三步工作台 tour 之上，增加可关闭、可恢复的“继续探索”任务表；位置可以是画布中央空状态卡，也可以从现有右上入口展开。它的作用是让用户完成最短的第一条生产链，同时不让现有 checklist 的四步语义失效：

| # | 任务 | 完成判定 | 完成后反馈 |
|---:|---|---|---|
| 1 | 创建/打开一个项目 | `projectId` 已存在 | 勾选 + 显示项目名 |
| 2 | 选择创作区 | 三个工作区之一已进入 | 高亮当前工作区 |
| 3 | 试用一个 Skill | Skill context token 已加入 composer | 卡片变“已加入” |
| 4 | 输入一句创作意图 | 产生有效 draft | 显示“可以发送” |
| 5 | 生成一个剧本 | 创建 script artifact | 可打开脚本 |
| 6 | 生成/打开分镜计划 | 创建 storyboard plan | 显示镜头数量 |
| 7 | 让一个镜头生成图片或视频 | 有完成或失败收据 | 结果进入结果条/画布 |
| 8 | 查看结果 | 打开媒体查看器或画布节点 | 记录首次查看 |
| 9 | 体验画布 | 创建/打开画布并完成一次连接 | 显示下一步提示 |
| 10 | 导入一个视频并拆解 | 视频节点 + 拆解表成功 | 表格展开并解释字段 |
| 11 | 编辑一格拆解内容 | revision 增加且持久化 | 显示“已保存” |
| 12 | 选镜头生成结果 | 行关联下游资产 | 表中状态完成 |
| 13 | 找到 Skill/素材库 | 打开库并返回 | 侧边栏入口保持可见 |
| 14 | 了解全屏 Agent | 进入/退出 fullscreen | 保留任务状态 |
| 15 | 选择供应商偏好/隐私选项 | 设置有明确保存结果 | 显示当前策略 |

这张表同时承担：用户引导、产品自测、E2E 真实任务、版本发布验收。不是把所有复杂功能都塞给新用户；前 1–8 项是首个成功闭环，9–15 项可以按用户路径逐步解锁或放入“继续探索”。其中“模型/分镜/生成/导出”四项继续沿用当前已有的真实行为勾选和 TTL/关闭规则；新增项使用同一状态来源，不复制一套 localStorage key。

### 11.2 视觉形态

- 中央大卡只显示 3 个推荐任务，避免第一次就看到 15 行；顶栏继续只显示紧凑进度，不把完整表固定盖在工作区上；
- “查看全部”打开完整 checklist；
- 每一项有状态：未开始、进行中、已完成、失败待处理、跳过；
- 任务完成后用勾选、轻量 toast 和下一项高亮，不连续播放动画；
- 重新打开项目时显示进度，不重复打扰；用户开始编辑/输入时，清单自动收起让开动作区（沿用当前 F4 修复）；
- 新版本首次进入用一次弹窗说明“新增了什么”，按钮为“立即试用 / 稍后再看 / 不再提示”；弹窗不能替代页面内的可恢复引导。

这正是附件参考图最值得学习的地方：空状态不是空白，而是告诉用户哪里可以点、能得到什么；Nomi 还要进一步把它变成可追踪的完成状态。它不是替换现有“上手 N/4”，而是把现有引导从“4 个基础里程碑”扩展成“基础里程碑 + 画布/Skill 继续探索”，并且保持单一入口、单一状态真相。

---

## 12. 供应商偏好、fallback 和数据收集

### 12.1 全局供应商优先级

设置中增加“供应商偏好”，不是把它混成某个具体模型：

```text
全局供应商优先级：A > B > C
默认模型：供应商 A / 模型 X
不可用策略：允许自动切换（开）
本次任务实际使用：供应商 A / 模型 X
```

规则：

- 偏好排序是全局默认；项目和单次任务可以显式覆盖；
- 每次发送保存 provider/model snapshot，保持 `(vendorKey, modelKey)`；
- 只有选中供应商不可用、能力不支持或明确超时，才自动切换到下一个可用供应商；
- 切换前后显示原因和实际使用者；
- 已产生付费/不可逆副作用后不静默切换；
- 失败重试不能丢原模型、Prompt、Skill 和参考资料；
- 不能把“默认模型”误标成“默认供应商”。

Runway Model Router、OpenRouter routing 和 Claude Code model config 都表明了“偏好/排序/能力可用性/会话级覆盖”应是不同层级；Nomi 采用这个结构，但保留自己的 provider contract。

### 12.2 可选、最小、默认关闭的遥测

默认不收集；在设置中给出接受/不接受，文案说明“只收频率和性能，不收内容”。可收：

- 功能使用次数：打开 Skill/脚本/分镜/拆解表/全屏 Agent/查看结果；
- 成功/失败/取消计数；
- 耗时区间；
- fallback 次数及原因类别；
- 结果是否打开、是否导出（不上传结果）；
- 表格编辑/生成链是否完成（匿名聚合）。

不收：Prompt 原文、图片/视频、音频、源视频 URL、文件名、作者私信、微信内容、API key、模型响应全文、逐用户行为轨迹。敏感错误也要先分类/脱敏再发；本地离线队列可清除；退出同意后停止并删除待发数据。

---

## 13. 完整需求回勾表：逐条不遗漏

下面是从最初长消息、后续澄清和本轮附件反馈恢复出来的母表。`[ ]` 不是表示“没有做完的产品 bug”，而是方案阶段的验收勾选；实施时每行必须变成可验证的任务或明确标记为不做/暂缓。

| ID | 用户要求/原意 | 方案回应 | 当前判断 | 计划/验收 |
|---|---|---|---|---|
| M-01 | 每个问题先找同类产品，不要凭空解决 | 每个模块都有近邻和来源证据；先样张后代码 | 已建立研究基线 | 6 角色评审 + 来源链接 |
| M-02 | 参考 Pi Agent 插件、Claude Code、Hermes/类似 Agent | Pi/Claude/Agent Skills 已纳入；Hermes 如需具体版本再补来源 | 研究中 | 明确 runtime/Skill/权限边界 |
| M-03 | 参考 Skill 网站和顶尖网站 | skills.sh、Agent Skills、Prompt/图像/视频站点纳入 | 研究中 | 目录源台账和版权状态 |
| M-04 | 参考 MiniMax Design、LaAT 和已有 PR | 复核仓库已有 MiniMax/LaAT 研究与 PR，不重复实现 | 部分已有 | 对 PR 逐项核对，不把 docs 当生产完成 |
| M-05 | 搜网站收集剧本、图片、视频 Skill | 建候选源和 catalog pipeline | 未实现公共站 | 先 10–20 个高质量精选页 |
| M-06 | GitHub 尽可能多且优质 | 只纳入有作者/许可证/提交证据的候选 | 未实现公共站 | LICENSE/commit/rights 审核 |
| M-07 | TikHub 搜抖音、小红书、X | 作为发现适配器，保留原帖和阻断状态，不默认复制 | live 未证实 | 需要 connector/授权后做 bounded crawl |
| M-08 | 作者网址、版权声明、侵权下架 | author/origin/license/takedown/noindex 字段和流程 | 目录缺口 | 投诉入口、软删除、缓存失效 |
| M-09 | 官网内容服务其他产品并帮助 SEO | 原创教程 + Skill 详情 + “在 Nomi 使用/下载软件” | 未实现 | canonical/JSON-LD/sitemap/people-first |
| A-01 | 当前对话面板增加全屏 Agent | 同一个 shell/Host/Thread 增加 fullscreen state | 未实现 | 真任务：进入、生成、查看、退出、恢复 |
| A-02 | 全屏里直接显示脚本/分镜/图/视频 | 统一结果入口和专用查看器 | 部分已有 | 不把产物永久塞聊天流 |
| A-03 | 对话中调整基础生成结果 | Agent 操作共享 artifact/node；图片视频不做节点微调 | 部分已有 | 脚本/分镜可编辑，媒体用对话重生成 |
| A-04 | 五个按钮：左 3、右 2 | `+资料 / 模型 / Skill` — 空 — `模式 / 发送` | 现有顺序需调整 | 图标状态、hover、reduced motion |
| A-05 | 加号上传参考图和资料 | 加号打开资料/参考素材选择器 | 部分已有 | context token 可移除、发送 snapshot |
| A-06 | Skill 空框不能白 | 三张任务卡+媒体+标题+描述+使用按钮 | 未完成 | click 加入 composer，不覆盖 draft |
| A-07 | 三个界面：剧本、电影感图文视频、剪辑 | 左侧固定栏+三工作区 | 部分已有 | 不增加第四界面 |
| A-08 | Skill 按三界面分类 | script / image-video / editing | 未完成公共目录 | 同一 catalog projection |
| A-09 | Skill 要让用户理解用途 | 标题、描述、输入、输出、媒体示例、作者/来源 | 本地卡片不足 | 空态和详情页验收 |
| L-01 | 生成/创作/剪辑左侧固定栏 | 新项目、项目/素材/Skill 库、三工作区、设置 | 未实现统一栏 | collapsed/expanded/icon tooltip |
| L-02 | 上面功能收进左栏，分类隔开 | 分组、分隔、选中/未读/任务状态 | 部分已有 | 一功能一个家、最多 5 个视觉组 |
| L-03 | 文本区仍三栏 | 分镜计划侧栏 / 中央内容 / Agent | 现有基础 | 左侧计划可收窄成 icon |
| L-04 | 生成内容缩小成 icon | 保留草稿/数量/状态，点击展开 | 未完成 | 不变成第四工作区 |
| C-01 | 节点不能空白 | 每类节点有示例/下一步/输入状态/失败恢复 | 现有节点不一致 | 空/进行/成功/失败四态 |
| C-02 | 复用创作区文本和分镜格式 | 共享下层 spec 和 Agent bridge；创作计划仍独立 | 部分已有 | 版本/来源/重启恢复 |
| C-03 | 提示词放 Agent 下侧，文本框下不堆提示 | composer 承载 Skill/Prompt context | 未统一 | 文本区留给内容 |
| C-04 | 创作区与画布同步，Agent 都能操作 | 一个 artifact owner + context handles | 部分已有 | 真实双向编辑和冲突提示 |
| C-05 | 文本→分镜→最终生成保留 | 计划表和画布节点都支持；canvas 可编组/批量 | 部分已有 | 一条真实旅程闭环 |
| C-06 | 节点加号收纳节点 | 只保留用户明确提出的两个新增语义节点；不重复收纳所有工具 | 已澄清 | URL 视频节点 + 视频拆解表节点 |
| V-01 | TikHub→素材库→视频节点→拆解在画布完成 | 画布为主操作面，Agent 可辅助查看 | 当前不完整 | loopback 不算 live |
| V-02 | 视频获取节点输入 URL 并变成视频 | 输入/解析/视频/失败状态，写入素材库 | 部分基础已有 | 持久化 source/provenance |
| V-03 | 视频连线到视频理解/拆解 | 右侧大加号连接生成拆解表 | 当前右 Portal | 表节点成为主结果 |
| V-04 | 视频拆解表像 Excel，有关键帧 | 行内关键帧+文本列，固定首列 | 数据有、UI不对 | 不自动铺图片节点 |
| V-05 | 字幕/对白/花字/情绪等列 | 明确默认列并可隐藏重排 | 数据部分有 | 缺失内容标 unknown，不臆测 |
| V-06 | 表格加行/列/删/调换 | V1 基础 grid 操作+撤销/复制/CSV | 未完成 UI | 真实编辑持久化 |
| V-07 | 拆解字段拼成最终 Prompt | 每行编译 image/video Prompt | 数据有 prompt 字段 | 选行生成并关联来源 |
| V-08 | 字幕提取 | 作为 Agent Skill，不做画布字幕节点 | 已澄清 | 画布表仍显示字段 |
| H-01 | HyperFrames 动效节点 | 后置，不进入当前主线 | 暂缓 | 另立需求和合同 |
| P-01 | 新版本后推送弹窗 | 一次/版本、立即试用/稍后/不再提示 | 未实现 | 不中断已有工作 |
| S-01 | 全局供应商偏好 | provider priority 与默认 model 分开 | 基础已有 | snapshot + fallback 解释 |
| S-02 | 不可用自动切换 | 仅不可用/不支持/明确超时切换 | 未完成 | 显示实际供应商和原因 |
| T-01 | 数据收集可接受/拒绝 | 默认关闭、最小匿名频率数据 | 未实现 | opt-in/撤回/本地清除 |
| T-02 | 不能影响产品、保护隐私 | 不上传内容/URL/key/微信，队列可清 | 未实现 | 隐私测试和文案验收 |
| U-01 | 以用户体验为中心，结果不能挡对话 | 结果条收纳、可回看、主家在画布 | 当前结果偏 Portal | 任务走查必须验证 |
| U-02 | 小 Icon/侧栏/底部控制不能漏 | 纳入左栏、composer、canvas chrome、onboarding 清单 | 以前方案遗漏 | 单独验收，不合并为“UI polish” |
| U-03 | 做完一个就勾一个 | onboarding checklist 与任务测试共用完成判定 | 本轮新增确认 | 首屏/全部清单/恢复状态 |

---

## 14. 实施分期：先收敛关键体验，再扩展目录

### Phase 0：证据和样张闸门

交付：

- 本报告与执行计划；
- 当前 PR/代码差距矩阵；
- 三张真实布局样张：Agent docked/fullscreen、画布视频拆解表、首次进入 onboarding；
- Icon/状态/hover/motion 规格；
- 6 角色评审记录；
- 用户确认记录。

不改生产 UI。样张可以用 HTML/SVG/ImageMagick/生图生成参考素材，但必须以真实布局、真实中文文案、真实状态和 design token 为准，不能用只展示漂亮卡片的静态概念图冒充实现。

### Phase 1：统一 shell、左栏、composer 和 onboarding

范围：

- fullscreen/collapsed/result-focus 状态；
- 固定左栏和三工作区；
- 五个 composer controls；
- AutoGrowTextarea 的大/小屏；
- Skill 空状态任务卡；
- onboarding checklist、版本弹窗；
- 结果条骨架。

验收：新用户能从空状态完成脚本→分镜计划→媒体结果，并能从任何结果回到原任务。

### Phase 2：共享创作对象和 Agent bridge

范围：

- `分镜计划` 的现有 owner/版本/来源明确化；
- Agent 读写脚本和分镜计划；
- 统一 `ShotGenerationSpec` 和 Prompt Compiler；
- 画布落节点、批量生成、重启恢复；
- `@产物`/`@画布节点` context handle。

验收：创作区修改一行，Agent 和画布看见同一 revision；重启后仍可恢复，不能有第二份隐式状态。

### Phase 3：画布视频获取与视频拆解表

范围：

- 视频获取 URL/素材选择节点；
- asset/provenance 持久化；
- 视频播放和连接到拆解；
- 单一视频拆解表节点；
- 行内关键帧、默认列、列管理、基础编辑；
- 选行/批量生成图片视频；
- 删除现有自动铺图路径作为默认体验；
- Agent 作为辅助操作，同一表对象。

验收：真实用户用一个视频走完整链；没有右侧 Portal 长驻，也没有左侧图片堆；重新打开项目仍可编辑表并生成关联结果。

### Phase 4：Skill Hub 与 SEO

范围：

- catalog schema/validator/source ledger；
- 网站/GitHub/TikHub adapters；
- 版权/作者/来源/takedown/noindex；
- 10–20 个精选原创/获授权/可引用资源；
- 三类任务页、作者页、教程页、下载 Nomi CTA；
- 应用内 Skill projection、复制/下载/导出/收藏/使用；
- 质量排序和失效处理。

验收：一个资源从来源记录到公开页、应用内使用、版本追踪和下架都可追溯。

### Phase 5：供应商与可选遥测

范围：

- 全局 provider priority；
- 默认模型和任务 override；
- fallback reason/receipt；
- opt-in telemetry、撤回和本地清理。

验收：模拟供应商不可用时能按排序切换且用户知道；关闭数据收集后没有待发内容。

### 后置

- HyperFrames/Remotion 动效节点；
- 独立字幕节点；
- 完整 Excel 公式/协作；
- 大规模第三方内容镜像；
- 复杂 marketplace/付费分发；
- 图片/视频节点微调编辑器。

---

## 15. 工程落地约束

### 15.1 一份状态、一个语义 owner

建议以以下对象连接 Agent、创作区、画布和结果收纳：

```text
Project
  AgentThread
  Artifact(script | storyboardPlan | videoAsset | deconstructionTable | media)
  Node(videoSource | deconstructionTable | image | video | group)
  ContextHandle(skill | artifact | node | asset)
  GenerationReceipt(provider/model snapshot, status, provenance)
```

Agent 只通过 capability/tool contract 写入；渲染层通过 bridge；Zustand 只持有业务和持久化状态；不让 Pi extension 直接拥有权限或绕过 Nomi owner。

### 15.2 画布单内核

生成画布继续使用 React Flow 一个交互/变换内核，避免 Agent 全屏或表格弹层复制一套 canvas transform。表节点的“展开”是节点内容/聚焦视图，不是第二个画布。

### 15.3 UI 代码边界

- token-only，使用 `docs/design/nomi-design-system.md`；
- 所有用户可见文案走 i18n；
- 每层小于 800 行，Shell/Composer/Results/Sidebar/Table 分开；
- 新实现替代旧 Portal/自动铺图逻辑时同 commit 删除旧默认路径；
- 不写第二套 fallback UI；
- 媒体不进 Zustand base64，不同步编码；
- 所有异步状态必须可取消、可重试、可恢复；
- 产物要能从 UI 追溯到 provider/model/source/revision。

### 15.4 验证

至少建立以下真实用户任务：

1. 新用户从 Skill 空态完成脚本和分镜计划；
2. Agent 输入框增长、展开、收起、加载 Skill、发送并继续对话；
3. Agent 进入全屏，生成图片/视频，查看并退出，任务不丢；
4. 画布输入视频 URL，生成拆解表，编辑一格，选一行生成；
5. 结果收纳后继续对话，结果不挡 composer 也不丢；
6. supplier A 不可用，自动切换 supplier B 并展示原因；
7. 用户关闭遥测，重新启动后仍不发送数据；
8. 新版本弹窗只出现一次且可从引导入口再次打开。

每个用户任务都要做真实 Electron/Playwright 走查、截图人眼判断、持久化和重启验证。循环 fixture、直接注入 Zustand、只看 DOM 断言都不能单独证明功能完成。

---

## 16. 需要在样张确认前锁定的三个问题

我已经按当前对话给出推荐默认值，只有下面三项会实质影响样张或架构：

1. **命名**：推荐创作区叫“分镜计划”，画布叫“视频拆解表”。如果你希望创作区继续显示“分镜表”，内部仍需保留这两个不同的类型名。
2. **全屏边界**：推荐全屏 Agent 保留 Nomi 全局左侧栏和项目上下文，只隐藏工作区内的其他干扰面板；不做无边框浏览器式全屏。
3. **DMD**：仓库里没有找到“Agent DMD”的准确来源。若它是你们内部的一份设计方法/PR/聊天记录，请给出准确名称或链接；在没有它之前，我不会假装已经按 DMD 对齐，而是采用项目中可核实的 Agent 交互、设计系统和 D1-D6 原则。

除这三个边界外，按钮顺序、画布主操作、两张表、Skill 三分类、结果收纳、视频拆解字段、引导 checklist 和“暂缓 HyperFrames/独立字幕节点”都可以直接作为下一轮样张和任务拆分的基线。

---

## 17. 来源索引

### 仓库内来源

- `docs/ARCHITECTURE-NOW.md`
- `docs/design/nomi-agent-interaction.md`
- `docs/design/nomi-design-system.md`
- `src/workbench/ai/ProjectAgentResidentShell.tsx`
- `src/workbench/ai/composer/AutoGrowTextarea.tsx`
- `src/workbench/workbenchStore.ts`
- `src/workbench/WorkbenchShell.tsx`
- `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx`
- `src/workbench/creation/storyboard/StoryboardShotTable.tsx`
- `electron/video/deconstructVideo.ts`
- `src/workbench/generationCanvas/nodes/NodeDeconstructionPanel.tsx`
- `src/workbench/generationCanvas/nodes/extractDeconstructionShotsToNodes.ts`
- `src/workbench/generationCanvas/store/generationCanvasStore.ts`
- `tests/ux/tikhub-project-video-breakdown.e2e.mjs`
- `docs/qa/2026-09-04-epics-rebaseline-audit.md`
- `docs/research/2026-08-29-browser-assets-pi-ecosystem-research.md`
- `docs/plan/2026-08-13-video-deconstruction-storyboard-table.md`
- `docs/plan/2026-09-01-tikhub-connector-v1.md`
- `docs/plan/2026-08-26-hyperframes-canvas-motion-node.md`
- `docs/skill-pack-format.md`
- `src/workbench/skillLibrary/SkillLibraryPanel.tsx`
- `src/workbench/skillLibrary/SkillCard.tsx`

### PR/分支来源（按当前 baseline 复核，不将 docs-only 视为生产能力）

- [PR #463](https://github.com/aqm857886159/Nomi/pull/463)：TikHub connector 与受控 loopback E2E；不是 live TikHub 端到端。
- [PR #474](https://github.com/aqm857886159/Nomi/pull/474)：把 storyboard planner 暴露到 Agent Skill picker；不是公共 Skill Hub。
- [PR #462](https://github.com/aqm857886159/Nomi/pull/462)：canonical storyboard Agent patch/persistence。
- [PR #471](https://github.com/aqm857886159/Nomi/pull/471)：Agent UI design contract。
- [PR #472](https://github.com/aqm857886159/Nomi/pull/472)、[PR #475](https://github.com/aqm857886159/Nomi/pull/475)：Agent/文档收敛基线。
- `origin/docs/skill-hub-research-20260905@91ddb3f3`：Skill Hub 研究文档分支，未当作已发布功能。
- `origin/codex/nomi-skill-agent-workbench-plan-20260905@408cd9e2`：Skill catalog/workbench plan 文档分支，未当作已发布功能。

### 外部研究来源

- [Pi extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi skills](https://github.com/Hownz/Pi/blob/main/packages/coding-agent/docs/skills.md)
- [Claude Code features](https://code.claude.com/docs/en/features-overview)
- [Claude Code slash commands/skills](https://code.claude.com/docs/en/slash-commands)
- [Agent Skills specification](https://agentskills.io/specification)
- [Anthropic skills repository](https://github.com/anthropics/skills)
- [LTX Studio](https://website.ltx.studio/)
- [Runway product](https://runwayml.com/product?m=1)
- [Runway Agent](https://help.runwayml.com/hc/en-us/articles/51601639579667)
- [Runway multi-shot video](https://help.runwayml.com/hc/en-us/articles/51200254894483)
- [Adobe Firefly Boards storyboard](https://www.adobe.com/learn/firefly/web/create-commercial-storyboard-firefly-boards?src=helpx)
- [MiniMax Design](https://hub.minimax.io/tools/ai-design)
- [StudioBinder shot list/storyboard](https://www.studiobinder.com/shot-list-storyboard/)
- [StudioBinder shot tagger](https://support.studiobinder.com/en/articles/10330842-how-to-use-the-shot-tagger-feature-in-shot-lists)
- [Airtable grid view](https://support.airtable.com/articles/7905594155-airtable-grid-view)
- [Airtable views](https://support.airtable.com/articles/5189551686-getting-started-with-airtable-views)
- [ComfyUI frontend](https://github.com/Comfy-Org/ComfyUI_frontend)
- [Runway model routers](https://docs.dev.runwayml.com/model-routers/)
- [Runway custom generation preferences](https://help.runwayml.com/hc/en-us/articles/54338359132819)
- [OpenRouter model routing](https://openrouter.ai/blog/insights/model-routing/)
- [Claude Code model configuration](https://code.claude.com/docs/en/model-config)
- [Google people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
