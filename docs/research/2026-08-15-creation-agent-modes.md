# Nomi 创作区 Agent 模式调研与改造方案

> 日期：2026-08-15  
> 范围：创作区右侧 Agent，不含生成区 Agent  
> 状态：方案与交互样张，未进入实现

## 0. 结论

创作区应该增加模式，但不应恢复此前的七项内部模式下拉，也不应把小说、剧本、续写、审校、分镜、素材规划混在同一级。

首版只放三个常驻模式：

| UI 短标签 | 内部语义 | 用户来这里要完成的事 |
|---|---|---|
| **通用** | `general`，通用写作 profile | 构思、问答、整理、改写，不预设作品格式 |
| **小说** | `novel`，小说 profile | 基于当前载入内容做章节续写、结构分析、局部影视化改编 |
| **剧本** | `script`，剧本 profile | 按场次、动作、对白组织文字，检查局部可拍性，再进入拆镜头 |

模式回答的是“后续对话默认按什么作品语法理解和输出”；技能回答“用什么专业方法做”；续写、审校、拆镜头回答“现在做哪一步”。三层必须分开。

推荐 UI 是把模式放进输入框底部的发送配置行：`附件 -> 模型 -> 模式 -> 发送`。模式用紧凑选择器显示当前值 `通用 / 小说 / 剧本`，与模型选择保持同一种交互语言；`Agent` 是助手身份，不能与两种体裁并列。现有“自动 / 素材规划 / 品牌宣传片 / 自定义技能”移到独立技能按钮，不能继续与模式共用一个入口。

不建议首发第四个模式。尤其不加“分镜”：Nomi 历史上已经出现过“分镜文字稿模式”和“拆镜头落画布”名实冲突，用户会再次不知道它到底是在文稿里写文字，还是进入结构化分镜。

## 1. 这次调研纠正了什么

最初检查误把仓库中的旧模式实现当作当前界面。随后以正在运行的 `Nomi-branch-audit-integration-20260814` 构建和 `origin/main` 为准重新核对：

- 当前创作区右侧顶部只有“通用助手”技能入口。
- 展开后是“自动 / 素材规划 / playbook / 让 AI 帮我写技能”，没有用户可见的小说、剧本模式。
- 当前底部 composer 只有附件、模型和发送，不存在模式选择。
- `creationAiModes.ts` 仍保留 `general/story/script/assets/storyboard/seedance/review` 七个内部 id，但当前 UI 只把 `assets` 作为一个特殊工作方式露出。

这不是“现有模式不够”，而是“界面没有清晰的作品语境选择，内部兼容状态和技能入口又混在一起”。

相关现状：

- `src/workbench/creation/CreationAiPanel.tsx:495`：顶部只渲染 `ActiveSkillChip`。
- `src/workbench/creation/CreationAiPanel.tsx:718`：composer 注释明确写着内部模式不再占下拉。
- `src/workbench/ai/ActiveSkillChip.tsx:95`：同一 popover 混合自动、素材规划、系统提示词、playbook 和技能作者。
- `docs/superpowers/specs/2026-08-13-ux-clarity-and-discoverability-design.md:13`：上一次删除七项下拉的根因，是把系统提示词和任务伪装成模式。

因此这次不能简单把旧下拉加回来。要重新定义“什么才配叫模式”。

## 2. 用户真正的摩擦

Nomi 的目标用户不是纯文字写作用户，而是已有小说、剧本或 IP，最终要做成可编辑视频初稿的个人创作者和小团队。

他们在创作区右栏的高频摩擦是：

1. 每轮都要重新解释“这是小说原文”还是“这是剧本”。
2. AI 不知道当前文本该遵守章节叙事，还是场次、动作、对白格式。
3. 小说、剧本、素材规划、拆镜头被塞进同类入口后，用户不知道切换会改变什么。
4. “分镜”既可能指文字稿，也可能指落到画布的结构化镜头，名称相同但结果完全不同。
5. 模式若只换一句 system prompt，而空态、上下文范围、动作和输出都不变，用户不会建立可预测性。

底层需求不是“多几个 prompt 预设”，而是让用户一眼知道：**Agent 现在按什么结构理解我的稿子，下一步会产出什么。**

## 3. 竞品怎么组织

### 3.1 事实对比

| 产品 | 官方产品组织方式 | 为什么有用 |
|---|---|---|
| Sudowrite | 右栏 Chat 的常驻切换是 `Chat only / Allow edits`；Write、Rewrite、Describe、Brainstorm、Feedback 是动作；Story Bible 独立维护 Genre、Synopsis、Characters、Worldbuilding、Outline | Agent 常驻开关适合表达稳定合同和权限，具体创作任务应就近出现 |
| Novelcrafter | 工作流按 Planning、Manuscript、Codex、AI、Chat、Review 组织；Chat 可选择 outline、scene、full novel 等上下文范围 | 上下文范围和作品知识层比堆很多模式更重要 |
| NovelAI | 真正的一级模式是 Storyteller 与 Text Adventure，因为二者改变输入语法和响应协议；Rewrite、Transform、Expand、Condense 是选区动作 | 只有会改变交互合同的差异才值得叫模式 |
| Squibler | 书籍、小说、剧本在项目或作品层区分；进入编辑器后再提供 outline、draft、revise、elements 等动作 | 小说和剧本可以成为稳定 profile，但续写、审校不应与它们同级 |
| LivingWriter | AI 按 Summarize、Rewrite、Analysis、Chat、Convert to Screenplay 等任务组织，并在调用时选择当前章或全稿 | 操作范围与结果去向是动作参数，不是永久模式 |
| Arc Studio | 专业剧本工作区按 Script、Plot Board、Outline、Collaborators 组织，人物、地点、故事线作为持续可见资料 | 结构、正文和故事资料联动，不需要把每种动作包装成 Agent 模式 |
| NolanAI / FinalBit | Co-Pilot、Script Doctor、Coverage、Breakdown、Storyboard、Shot List、Video 按制作任务和阶段拆分 | 审校、改写是动作，分镜是剧本之后的产物阶段 |
| LTX Studio | 从 script 到 scenes、shots、Elements、motion、video 的流水线；storyboard 是可审阅的阶段产物 | Nomi 的拆镜头必须继续走“先审方案、再落画布”，不能退化成聊天模式 |

### 3.2 跨产品共识

事实与推断分开后，共识很清楚：

- 作品形态稳定时，可以决定结构、上下文和格式。
- 续写、润色、审校、改编、拆镜头是任务动作。
- 人物、世界观、场景、前文摘要是横跨任务的知识层。
- 模型、文风、prompt、插件和技能属于高级控制或方法层。
- 一个入口同时混入以上四类，会短期显得丰富，长期必然失去可预测性。

## 4. 方案比较

| 方案 | 用户看到 | 优点 | 代价 | 判断 |
|---|---|---|---|---|
| A. composer 模式选择器 + 独立技能 | 底栏显示当前模式，点击选择 `通用 / 小说 / 剧本` | 与附件、模型形成统一的发送前配置，不增加面板高度 | 模式选项需要点击后才展开 | **推荐，用户已拍板** |
| B. 全部放进一个下拉 | 自动、小说、剧本、素材、审校、分镜、playbook | 改动最小 | 重演旧七项下拉，模式和技能再次混杂 | 不做 |
| C. 新建项目时一次选定 | 项目模板选择小说或剧本 | 状态稳定 | 用户过早决策，同项目小说原稿和改编剧本无法并存 | 等多文档体系后再做 |

真正的取舍不是“多一个按钮还是少一个按钮”，而是：**模式要足够可见，才能减少反复说明；但只能承载一个维度，否则可见性越高越乱。**

## 5. 推荐信息架构

```text
Nomi Agent 身份
  ├─ 写作模式：通用 / 小说 / 剧本
  ├─ 当前动作：构思 / 续写 / 改写 / 审校 / 改编 / 拆镜头
  ├─ 专业技能：素材规划 / 编剧方法 / 品牌宣传片 / 用户自定义
  └─ 本轮上下文：选区 / 当前载入内容 / 用户点名的设定与附件
```

### 5.1 模式不是文档类型

首版模式应定义为 `thread.activeMode`，即当前会话默认的写作与上下文 profile，不是把现有文档强制改造成另一种 schema，也不是所有协作者共享的项目结构。

- 切换模式不修改现有稿件。
- 切换模式不清空对话和草稿。
- 切换从下一轮请求起持续生效，直到再次切换。
- 新会话默认“通用”；复制会话可以复制模式，切换项目不能沿用另一个项目的临时状态。
- 每轮发送时冻结当时的 mode、skill、context 和 prompt 版本。
- 未来支持多文档后，小说原稿与改编剧本应是两个带 `derivedFrom` 关系的 artifact，不能靠切 mode 改变同一份稿子的含义。

### 5.2 三个模式的真实差异

| | 通用 | 小说 | 剧本 |
|---|---|---|---|
| 输出合同 | 通用段落或结构化建议 | 章节叙事、人物视角、前文连续性 | 场次、动作、对白、OS/VO、字幕 |
| 默认上下文 | 选区优先，必要时读当前稿 | 当前载入章节、选区、明确加入的人物与设定 | 当前场次、相邻场次、人物与地点 |
| 空态动作 | 给我一个开头 / 梳理这个想法 / 拆成镜头 | 续写当前章 / 提炼当前章主线 / 把这段改成一场戏 | 从大纲写第一场 / 优化这场对白 / 检查这场能否落成画面 |
| 写入行为 | 用户明确要求后给确认卡 | 同一确认卡，不直接覆盖 | 同一确认卡，不直接覆盖 |
| 下游入口 | 需要时拆镜头 | 先局部改编为剧本，再拆镜头 | 剧本稳定后拆镜头 |

V1 的“小说”必须诚实收窄：只承诺当前已载入的章节、选区、摘要和设定。没有分块检索与实体状态时间线前，不写“整本阅读”“全书一致性”“一键改编整本”。

V1 的“剧本可拍性”也只能是规则化建议，不能冒充预算、场地、演员和制片可行性结论。

### 5.3 为什么其他候选不进模式

| 候选 | 正确位置 | 原因 |
|---|---|---|
| 分镜 | 剧本模式内的阶段 CTA | 它会生成可审阅方案并进入画布，是阶段跃迁，不是聊天语气 |
| 审校 | 当前选区/场次/章节动作 | 用户只在需要检查时调用，不会长期停留 |
| 素材规划 | 可叠加技能 | 小说和剧本都可能需要，不应互斥 |
| 品牌宣传片 | playbook / 技能 | 是垂直生产方法，不是通用作品语法 |
| 文案 | 技能，等数据再决定是否升级 | 当前目标用户不是通用营销文案市场 |
| 短视频 / 漫剧 | 先作为剧本子类型 | 只有数据证明其结构合同显著不同，才升为第四模式 |
| 提示词 | 生成节点动作 | 是模型输入产物，不是创作区的作品类型 |

### 5.4 模式不是标签：它改变一轮 Agent 的执行合同

点击模式只是选择默认合同，真正的发送流程仍由 Agent 自主判断本轮动作。三种模式共享同一条可确认 Agent loop：

```text
发送消息
  -> 冻结本轮合同：mode + skill + action + context + prompt 版本
  -> 按模式加载上下文：选区 / 当前章 / 当前场次 / 附件
  -> 判断动作：回答、续写、改写、审校、局部改编或拆镜头
  -> 生成草案或变更提案
  -> 不涉及写入：直接回答；涉及写入：显示确认卡
  -> 用户确认后执行文档工具或分镜规划器
  -> 回传工具结果，Agent 继续检查并给出最终结果
```

首版只需要 4 类能力，模式通过上下文、约束和工具门禁组合它们，不为每个模式造一套 Agent：

| 能力 | 作用 | 用户能看到的结果 |
|---|---|---|
| 读取上下文 | 读取选区、当前章/场、明确加入的设定和附件 | 本轮上下文清单，不静默假装读过整本 |
| 生成草案 | 根据动作和模式输出自然语言或结构化文本 | 可继续对话的结果 |
| 提议文档变更 | 生成插入、替换、追加的变更提案 | 先审阅再应用，不直接覆盖原稿 |
| 提议拆镜头 | 将已确认的故事/剧本交给分镜规划器 | 可编辑方案，确认后才落到画布 |

三种模式的执行合同具体如下：

| 模式 | 上下文装配 | Agent 默认判断 | 输出与写入 |
|---|---|---|---|
| **通用** | 选区优先；用户要求时再读当前文稿或附件 | 构思、问答、整理、自由改写 | 通用段落/列表；用户明确要求改稿时生成变更提案，不套小说或剧本格式 |
| **小说** | 当前载入章节 + 选区 + 明确加入的人物/设定；V1 不承诺整本 | 续写、保持视角、人物动机检查、局部改写、局部改编 | 章节叙事正文或审校结果；写入前给确认卡；“改成剧本”产出派生草案，不改原小说 |
| **剧本** | 当前场景/选区 + 可用的相邻场景、人物、地点；V1 不承诺全剧 | 生成场次、优化动作/对白、结构检查、局部可视化建议 | 标准剧本块（场次/动作/对白/OS/VO/字幕）；先确认文本变更，再允许“拆成镜头”进入规划器 |

例如用户在“小说”模式点“续写当前章”：系统先读取当前章和选区边界，保持叙事视角与人物状态，返回续写草案；只有用户点击“应用”，才调用插入/替换工具。用户随后切到“剧本”并要求“把这段改成一场戏”，这会建立一个新的剧本输出提案，原小说、上一轮合同和历史都不变。

模式与技能的关系也不是“后者覆盖前者”：技能只补充方法和风格。例如“素材规划”可以在小说模式中提取角色/场景卡，也可以在剧本模式中提取道具/地点卡；它不能把小说输出改成剧本，也不能自行获得写入或落画布权限。

## 6. 界面方案

### 6.1 Design thesis

- **受众与任务**：已有小说、剧本或故事素材，准备把它推进为可生成视频的个人创作者和小团队。
- **三秒认知**：创作助手当前按“通用、小说或剧本”理解我，切换不会动现有稿。
- **主行动**：继续输入或上传当前材料。
- **内容节奏**：Agent 标识与历史动作 -> 对话与情境动作 -> 上下文范围 -> 输入 -> 附件/模型/模式/发送。
- **视觉方向**：沿用 Nomi 暖中性、低装饰、密集工作台；模式复用模型选择器的紧凑控件语言，不另起导航栏，也不做三颗独立胶囊。
- **记忆点**：模式变化后，空态命令和输入提示立即变成对应创作语言。
- **反模式**：七项下拉、卡片拼贴、pill soup、暴露 system prompt、把“分镜”做成含义不明的永久模式。

### 6.2 布局

当前右栏最窄约 300px。模式不与 header 动作竞争空间，也不单独占一行，而是进入输入框底部已有的发送配置行：

```text
┌────────────────────────────┐
│ N  创作助手      技能  历史  放大  关闭 │
├────────────────────────────┤
│                            │
│         对话内容            │
│                            │
├────────────────────────────┤
│ 已加载：当前章 · 第三章      │
│ 输入…                       │
│ 附件  模型  小说       发送 │
└────────────────────────────┘
```

模式是 L1 发送状态，选择器始终显示当前值，顺序固定为“附件、模型、模式”。模式菜单向上展开，避免被窗口底部裁切。300px 下模型与模式使用短标签并各自截断，发送按钮始终保留。技能是 L3 二级入口，在 header 保留一个带 tooltip 的图标按钮；手动激活后用强调底色和状态区文字同时显示具体技能名，不能只靠颜色或一个不明亮点表达。

交互样张：`docs/design/mockups/2026-08-15-creation-agent-modes.html`

## 7. Interaction contract

- `idle`：模式触发器始终显示当前值，例如“小说”，并通过 `aria-label="写作模式：小说"` 暴露完整语义。
- `hover/focus`：触发器使用标准选择器语义；Enter/Space/ArrowDown 打开，方向键移动选项，Enter 选择，Esc 关闭并把焦点还给触发器。
- `sending`：UI 暂时禁切并说明“本轮完成后可切换”；这只是防误触，运行时仍以发送瞬间的快照为准。
- `switch`：不清空文稿、输入草稿、附件或历史；第一次切换提示“仅影响后续回复，当前稿件不会转换”，下一轮开始持续使用新 profile。
- `retry`：默认复用原轮次的 mode/skill/context 快照；“用当前模式重试”必须创建新轮次。
- `write proposal`：确认卡冻结生成时的 mode 和内容；用户切模式后再批准，也不能重新解释或重新调用模型。
- `context visibility`：输入区上方持续显示本轮实际纳入的范围，如“已加载：当前章”或“上下文：当前选区”；超限不得静默截断。
- `project swap`：新会话默认“通用”；会话模式需要持久化，重开后恢复，但不能把它当作文档 schema。
- `narrow width`：300px 保持三个短标签一行；英文为 `General / Novel / Script`，不截断。
- `long copy`：技能名称可截断并用 tooltip，模式名不可截断。
- `accessibility`：menu/listbox 语义、清晰焦点、键盘路径、勾选图标与文本双重选中信号、至少 28px 高；桌面鼠标主场，不新增 hover-only 关键动作。

## 8. 运行时组合合同

模式、动作、技能不能只靠字符串随意拼接。推荐固定层级：

```text
安全、权限与工具策略
> Action：由用户明确任务路由出的本轮目标、作用范围、目标输出 schema
> Mode：未被 Action 改写的默认作品语法、上下文策略、输出 schema
> Skill：与当前 Mode/Action 兼容的方法论与风格，不得提升工具权限
> User request：内容细节与偏好，不能绕过以上结构和权限合同
> Context：用户稿件、附件、设定，始终视为不可信数据
```

每轮至少冻结：

```text
modeId + modeVersion
skillKey + skillVersion
actionId + actionVersion
contextManifest + sourceRevision
toolPolicyHash
promptBundleHash
```

工具权限必须由代码计算。自定义 skill 只能在允许的工具集合内申请能力，不能通过 prompt 获得额外写入或画布权限。

## 9. 分期

### V1：先解决“AI 按什么理解我”

- 在 composer 的“附件、模型、发送”行中，增加 `通用 / 小说 / 剧本` 模式选择器，顺序为“附件、模型、模式、发送”。
- 从 `ActiveSkillChip` 拆出独立技能入口。
- 三种模式各自提供 system contract、空态命令、placeholder 和上下文范围。
- 小说仅支持当前载入内容/当前章；剧本仅支持当前场次/局部。
- 每轮冻结 mode/skill/context；切换不破坏当前稿和历史。
- 旧会话无 mode 时惰性回落 `general`，不批量回填；新客户端用字段级更新，避免旧客户端覆盖未知状态。

### V2：补真正的长篇能力

- 章节分块、摘要树、人物/地点/事件索引。
- 上下文清单显示本轮纳入与排除的资料，不静默截断。
- 小说原稿到改编剧本生成派生 artifact，保留来源关系。
- 人物和世界状态随章节/场景演进，不再只靠 1500 字项目记忆。

### V3：用数据决定第四模式

- 观察用户是否在剧本模式里高频要求竖屏、15 秒、旁白、口播或漫剧节奏。
- 只有结构约束、推荐动作和下游流程稳定不同，才增加“短视频”或“漫剧”。
- 否则继续作为技能或剧本子类型，避免广度失控。

## 10. 验收与指标

### 10.1 真实任务

1. 用户粘贴当前小说章节，切小说，要求续写并应用；结果保持人物与叙事视角，写入前有确认卡。
2. 用户把选中小说段落局部改成一场戏；原文不被模式切换直接改写，派生结果可确认。
3. 用户在剧本模式从大纲写第一场，输出有场次、动作和对白结构。
4. 用户优化一场对白后点击“拆成镜头”；先得到可编辑方案，确认后才落画布。
5. 用户生成中尝试切模式；UI 不误切，后台轮次仍使用发送时快照。
6. 用户切换模式后批准上一轮写入；写入内容保持上一轮合同，不被当前模式重解释。
7. 用户启用素材规划技能；mode 与 skill 同时可见，小说/剧本状态不丢。
8. 用户切换项目并重启应用；每个会话恢复自己的模式，生成中的请求和重试仍使用各自冻结的合同。

### 10.2 产品指标

- 模式选择后的人工纠正率。
- 模式对应推荐动作点击率。
- AI 建议确认/拒绝率。
- 小说局部改编 -> 剧本 -> 拆镜头 -> 落画布完成率。
- 分镜确认前的修改率，过低可能代表用户没有真正审阅。
- 上下文超限与截断率。
- 生成后立刻切回“通用”的比例，用于判断专业模式是否过度约束。

## 11. 风险与反方意见

### 风险 1：模式只是 prompt 换皮

如果三种模式只换一句 system prompt，没有不同上下文策略、动作和输出合同，这个功能不值得做。V1 验收必须同时检查四者。

### 风险 2：小说模式承诺过头

当前没有完整长篇分块和实体状态系统。UI 必须说“当前载入内容”，不能暗示整本理解。真正长篇能力放到 V2。

### 风险 3：同项目跨文体

小说改编项目未来会同时包含原著、分集大纲、剧本和分镜。三模式不能成为单一项目 schema；它只是当前 Agent profile。多 artifact 模型必须另建。

### 风险 4：技能与模式冲突

技能需要声明兼容 mode、上下文需求、输出槽和工具请求。冲突必须在发送前阻止，不能让两个 prompt 在模型里自行打架。

### 风险 5：增加常驻控件

模式是 7/10 以上频次的发送状态，符合 L1，但不值得再占一整行；它与模型一样常驻显示当前值。技能选择低频，降为 L3。新增模式选择器的同时必须拆掉当前混合技能 chip 中“自动跟模式”的耦合，不能在两个入口重复表达模式。

## 12. 六角色评审摘要

- **CTO**：模式只做 thread-level profile；artifact 类型与每轮执行快照分开。不能把“项目结构合同”和“随时可切”同时成立。
- **设计**：模式进入 composer 配置行，顺序固定为“附件、模型、模式、发送”；使用一个紧凑选择器，避免 header 溢出和 pill soup。
- **PM**：首版只服务最强的三个语境，不为“看起来全”增加短视频、漫剧、审校和分镜。
- **前端**：复用或扩展 `NomiSelect` 实现 `CreationModeSelector`，与 `CreationSkillMenu` 解耦；旧七项 UI 不恢复，切换、发送、重试都基于同一 mode 快照类型。
- **后端**：Mode / Action / Skill 需要 manifest 与稳定优先级，工具授权由代码派生；确认卡绑定原轮次和文档 revision。
- **真实用户**：短标签要直白，切换不能丢稿；进入小说或剧本后，第一屏马上出现自己会说的话，而不是内部术语。

## 13. 一手来源

访问日期均为 2026-08-15。

- Sudowrite Chat: https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/chat/5vbuELXf6LZQnGfVzsEXCV
- Sudowrite Features: https://docs.sudowrite.com/getting-started/dQph1snuwbfMWG9wRjsNug/features/dq7YUMNy5ZMvKUJiRAisyT
- Sudowrite Story Bible: https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/what-is-story-bible/jmWepHcQdJetNrE991fjJC
- Novelcrafter Features: https://www.novelcrafter.com/features
- Novelcrafter Chat UI: https://www.novelcrafter.com/help/docs/chat/the-chat-interface
- NovelAI Editor: https://docs.novelai.net/en/text/editor
- NovelAI Text Adventure: https://docs.novelai.net/en/text/textadventure
- Squibler: https://www.squibler.io/
- Squibler Screenwriting: https://www.squibler.io/screenwriting-software/
- Squibler Release Notes: https://www.squibler.io/whats-new/
- LivingWriter AI Features: https://guides.livingwriter.com/desktop-app-+-web-version/ai-features
- LivingWriter Convert to Screenplay: https://guides.livingwriter.com/desktop-app-+-web-version/ai-features/ai-convert-to-screenplay
- Arc Studio Plot Board: https://help.arcstudiopro.com/guides/the-plot-board
- FinalBit Features: https://www.finalbitai.com/features
- FinalBit AI Co-Pilot: https://www.finalbitai.com/features/ai-copilot
- FinalBit Storyboard: https://www.finalbitai.com/features/ai-storyboard-generator
- LTX Studio Script to Video: https://ltx.io/studio/platform/script-to-video
- LTX Studio Storyboard: https://ltx.io/studio/platform/ai-storyboard-generator
- 笔灵 AI 小说 IDE，方向样本，当前 v0.1.0，不作为成熟度依据: https://www.biling.org.cn/
