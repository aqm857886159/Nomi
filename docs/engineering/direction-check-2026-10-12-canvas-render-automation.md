# 方向检查：大画布显示异常与自动化节点不能出图

📋 诊断未完成，未修复。2026-10-12；源码基线 `0c1ed6a0c9421091f238413d682af97e9aa18d9d`。用户认为使用最新桌面版；具体平台、安装构建及出错项目尚未确认。本文先保存版本、入口和组件特征证据，不把猜测写成根因。

## 0. 一句话判断

**已证实最新公开发行版缺少多项后来合入的画布修复，但本次异常的直接原因尚未确定；自动化建成了哪种节点也必须先查清。** 两个症状先分开调查，不按“电脑慢”或“少加一个按钮”处理。

`node scripts/fix-churn.mjs src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx` 命中近 14 天 8 个 fix，继续改该文件将是第 9 次。按 P1，先复盘并将结构性修法交用户确认；本轮不再给这个组件叠补丁。[原始输出](../evidence/2026-10-12-canvas-render-automation-triage/fix-churn.txt)。

## 1. 归类：报告、机制、未知

| 报告 / 证据 | 已核实的机制 | 当前不能下的结论 |
|---|---|---|
| 大画布卡顿、部分卡片显示错误；重启仍在，换任务正常 | 用户截图有内容/浮层重叠。项目规模、媒体负载、缩放和交互状态可能相关，需要实际项目测量 | 未复现；不能认定 GPU、内存、ComfyUI、网络或某一布局函数是根因 |
| “应该就是最新桌面版” | GitHub 最新非预发布为 [v0.23.1](https://github.com/aqm857886159/Nomi/releases/tag/v0.23.1)，发布于 2026-10-08，tag commit `66d6eafed07ad6239acd765dd05c9eb0870cf849`。这不等于用户已安装的实际构建被验证 | 不把当前 origin/main 的源码行为当作发行版行为 |
| 大画布修复已有历史 | 高频状态写回、坐标移动不重渲、多选缩放把手、边校验成本、浮条更新循环、模型目录加载等 6 个已合入提交均不在 v0.23.1 祖先链 | 不等于这 6 项必然修复本次项目；未做版本 A/B 或用户平台验收 |
| WorkBuddy 落画布后不能选模型出图 | renderer 与 headless MCP 路均传递输入 kind；现役 `image/keyframe` 的 executionKind 是 image；`shot/output` 无 executionKind，参数控件会返回 null；`text` 是文字加工 | 尚不知道 WorkBuddy 实际创建的 kind，不能说它已建错，也不能把正常的说明卡强改成生成卡 |
| 长提示词可能挤掉底栏 | 已用主线 BaseGenerationNode/Composer 本体做单卡长文本组件探针：卡高400、滚动区321、scrollTop1159，底栏与生成钮在卡内 | 仅覆盖无参考图、单卡、合成目录；不覆盖用户大项目、已有图片、版本宫格、低缩放、真实模型选择或视频 |

固定提交对比见 [release-comparison.json](../evidence/2026-10-12-canvas-render-automation-triage/release-comparison.json)。组件探针及证据边界见 [main-long-prompt.json](../evidence/2026-10-12-canvas-render-automation-triage/main-long-prompt.json)，[复跑方法](../evidence/2026-10-12-canvas-render-automation-triage/reproduce.md)。本机第一次在 Tailwind 生成未完成时运行得到无样式布局，该次被判为无效测试；等待生成完成后重跑才记录此处结果，不将夹具缺样式冒充用户故障。

## 2. 为什么不能继续凭症状补

已有修复分别触及 React Flow 的交互几何、持久 store 写回、节点重渲、媒体解码、浮层定位和模型目录，说明“卡”不是一种统一机制。当前缺口首先是**同一受影响项目在已发行构建与候选构建上的可比证据**；这属于诊断/交付证据缺口，尚不是已查明的产品类根因。

生成入口同样要区分三件事：节点说明里写了出图意图、节点 kind 是否具有图片生成能力、当前模型是否可用。模型缺失应保留配置入口；错误类型应被工具说明/创建契约识别；布局遮挡则修布局。不能用根据标题猜 kind 的迁移，把用户手写文档静默变成图片任务。

| 铁律 | 本次需要补的证据 |
|---|---|
| ⑩ 说的=摆的 | 拿到 WorkBuddy 实际请求与最终节点 kind/model/meta/引用的对应；保留原提示词，不能只看创建成功回执 |
| ⑪ 能选到 | 正确 image/keyframe 节点在手工、renderer Agent、headless MCP、旧项目恢复四种入口下，选中后模型/参数/生成均可见可命中；空目录也有明确配置入口 |
| ⑫ 点了=以为的 | 大项目平移/缩放后点卡，不残留拖动态或遮挡；正确选择后执行落同一节点；单击选择不发生成请求 |

### 入口证据

- [NodeGenerationComposer 数门](../evidence/2026-10-12-canvas-render-automation-triage/composer-doors.txt)：直接读入口为 BaseGenerationNode、LazyNodeGenerationComposer、ProjectAgentResidentShell、设计实验室；需继续跟到列表详情的包装调用。
- [addProjectNodes 数门](../evidence/2026-10-12-canvas-render-automation-triage/creation-doors.txt)：直接调用在 dispatcher；下一跳为 canvasGraph.addNodes → 共用 buildCanvasNodes。renderer 则为 applyCanvasToolCall → generationCanvasTools.create_nodes → store.addNodes。
- 当前 `NodeGenerationComposer` 用 host 区分 canvas/panel/inline；panel 不带生成钮是确认卡既有设计，不能因此给所有宿主加钮。
- kind 定义：[registry](https://github.com/aqm857886159/Nomi/blob/0c1ed6a0c9421091f238413d682af97e9aa18d9d/src/workbench/generationCanvas/nodes/registry.ts)；模型控制分发：[NodeParameterControls](https://github.com/aqm857886159/Nomi/blob/0c1ed6a0c9421091f238413d682af97e9aa18d9d/src/workbench/generationCanvas/nodes/NodeParameterControls.tsx)；外部请求：[canvasWrite](https://github.com/aqm857886159/Nomi/blob/0c1ed6a0c9421091f238413d682af97e9aa18d9d/electron/shared/agentCapabilities/canvasWrite.ts)；两条创建入口：[dispatcher](https://github.com/aqm857886159/Nomi/blob/0c1ed6a0c9421091f238413d682af97e9aa18d9d/electron/capabilityCore/dispatcher.ts)、[applyCanvasToolCall](https://github.com/aqm857886159/Nomi/blob/0c1ed6a0c9421091f238413d682af97e9aa18d9d/src/workbench/generationCanvas/agent/applyCanvasToolCall.ts)。

## 3. 可证伪的调查顺序

| 假设 | 最小验证 | 如何决定修哪层 |
|---|---|---|
| 发行版到主线之间的既有修复已覆盖部分卡顿 | 受影响项目副本断开原登记，用同一媒体、窗口、缩放、动作跑 v0.23.1 与候选；记录帧间隔 P95、长任务、首反馈、节点/边重建与媒体加载 | 候选改善只作为该项目的 A/B 证据；仍坏的部分继续定位，不能再重做已合入的同一修法 |
| 非生成 kind 被当出图卡创建 | 只读实际节点或请求；对照 image/keyframe/shot/text 四类 | kind 错则修语义/创建契约与清晰回执；不加模型按钮假装说明卡会出图；旧节点需显式、可撤销地派生，不批量猜改 |
| 正确 image/keyframe 的控件被遮挡/藏起 | 保存 selected/readOnly、data-dragging、host、resultStackOpen、attachedPanel 状态和控件 DOM/计算样式/命中结果 | DOM 不挂、DOM 隐藏、出屏、被覆盖、目录失败分别归因；在实际共享边界修，不在 WorkBuddy 名称分支里修 |
| 大项目媒体或订阅放大 | 分开测初开、平移、低缩放、多选拖动、点卡、编辑；使用原媒体副本与既有 benchmark 规模矩阵 | 调度/订阅/投影/布局各保留一次失败证据；不能仅靠减少测试节点数过关 |

## 4. 尺子独立性

用户报告来自真实使用，组件探针由本线搭建，因此两者不是同一证据强度。当前 100 条既有单测通过，只证明共用工厂/图操作/渲染分发的已覆盖契约，不能推翻用户报告。没有真实受影响项目、平台和请求时，不闭合逃逸账本、不称已解决。后续生产修复需改前失败的报告病例 + 独立类级用例 + 真实窗口复查；四类修改仍按仓库要求独立验收。

## 5. P0 与依赖方向

继续用已安装的 React Flow、CSS flex/overflow、现有目录缓存与共用节点工厂。当前没有证据支持更换画布框架、重写渲染器或升级依赖即可解决；本轮不变依赖。若确认第三方行为，再按 root-cause-remediation 核官方版本/源码，给明确 upgrade-now 或 retain-with-exit 合同。暂不作依赖质量结论。

## 6. 接入 / 补 / 重写 / 删

| 选项 | 做什么 | 代价 / 风险 | 判断 |
|---|---|---|---|
| 接入现成能力 | 保持现有 React Flow 交互/虚拟化、CSS 约束和节点工厂；先复用已经合入的修复做相同项目 A/B | 需候选构建和实际项目，不保证所有问题已覆盖 | 推荐先做 |
| 在共享边界补不变量 | 证实错误后，按节点生成能力收口创建语义，或在实际失效的布局/拖动边界修；四种创建/恢复入口共测 | 需要病例红灯与 schema-v3 合同；具体改动范围尚待定 | 证实后推荐 |
| 重写画布/替换框架 | 重做整套交互和媒体渲染 | 当前没有根因证据支撑，范围与风险过大 | 不推荐 |
| 删掉说明卡或给全部卡挂生成面板 | 表面上减少类型分歧 | 破坏文字/镜头说明、素材等已有语义；不能解决项目负载 | 不推荐 |

## 7. 要权衡的核心与推进边界

**先用同一问题项目证明是未发布修复、类型错误还是仍存回归，再改最早共享边界；保持已有创作界面和数据语义。** 本轮建议不是改版或把所有卡改成生成卡。涉及该热点组件的生产修法，需要本复盘得到用户确认，并补具体设计卡/根因合同；当前没有生产修复提交。

阻塞准确修复的资料：实际安装版本/构建与平台、问题项目的只读快照（节点类型、规模、媒体尺寸、缩放/选择状态），或至少那张异常卡的类型和 WorkBuddy 工具请求。不要求公开聊天截图或凭据。

## 特征测试与当前结果

- 主线现役 BaseGenerationNode/Composer，单 image 节点 + 2520 字中文长提示词、生成完整 Tailwind：滚动及底栏垂直边界通过；合成目录退化为配置入口，未验证可用模型选择。无真实项目/媒体/模型请求。
- `canvasGraph.test.ts`、`canvasNodeFactory.test.ts`、`resolveRenderKind.test.ts`、`applyCanvasToolCall.test.ts`：4 文件100测试通过。
- 未完成：发行版同项目 A/B、大画布性能基线、WorkBuddy 实际落地回放、Windows/英文/真实生成。生成请求0次，费用0。
- 两条逃逸账本均为 candidate，completionCommits 为空。后续类别检查须覆盖规模/媒体/状态矩阵与四种创建入口；现在不以现有测试冒充已新增结构性预防。

## 本次诊断文档设计卡

| 格 | 合同 |
|---|---|
| ★1 用户怎么用 | 阅读已证实的发行差异、类型语义和下一步验证，判断推荐调查/修法范围；不需改项目或重启机器试运气 |
| ★2 谁说了算 | 发行tag与固定主线SHA分开，原报告记在两条candidate账本，实测结果记JSON；无运行时owner变更 |
| ★3 一致与复用 | 复用既有组件、设计实验室、工厂、门岗与逃逸账本；不建立新画布或自动化路径 |
| ★4 全状态 | 区分用户报告、源码证据、组件探针通过、未复现/未知；无样式夹具结果不算复现；不关账 |
| ★9 验收与回滚 | 核链接/JSON/门岗与固定commit对比；回滚本诊断提交即可，不触用户项目。产品修复另按完整合同验收 |
