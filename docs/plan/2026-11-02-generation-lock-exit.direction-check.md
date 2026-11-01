# 方向检查：批量出图不卡死

## 0. 一句话根因
本机拒绝与服务商失败混进 unknown，动作、刹车和模型健康因此失真；整方案比对把系统自动引用当成人改稿，队列与节点状态不同源，画布 Run 没接到已有的人工释放出口。

## 1. 归类表：bug → 直接原因 → 类
| bug | 直接原因 | 类 |
|---|---|---|
| 批量出资产后停住 | 09-20 的整方案比对早于 10-05 的自动引用，任意一镜变化拦整批 | 比对范围越过动作所有权 |
| 撞限后整表卡住 | quota 计入连续失败，单卡依赖整表 busy | 调度与交互状态混用 |
| 结果不明重启仍不能重发 | 0.24 的画布 Run 未接人工放行，nodeIdOfJob 不认 origin | 既有出口漏入口 |
| 排队被改或重复生成 | 队列不写 node.status，引用和单发看不到排队 | 多份状态来源 |

## 2. 为什么这一类会一直出现
不变量没有落在共享边界：编辑器和 Agent 各自比整份方案；同节点去重未在提交咽喉集中；错误 kind 无法表达本机拒绝；释放只认制作元数据。
落在体验铁律 ⑫（点了=以为的）：逐入口的实际观察和假服务商 POST 次数由设计卡 ★9 的 A1–D3 核对。逃逸账本仅在类检查和真实走查有证据后结账。

## 3. 不改结构会冒出什么
| 预测 | 验证 |
|---|---|
| 另一个镜头被自动补引用仍会阻止当前镜 | A4/A5/A10 |
| 换一个入口单发同一排队节点仍会重复派发 | B3 的分镜、画布入口 |
| 老的画布结果不明 Run 仍找不到重发节点 | C4/C6/C7 |

## 4. 靶子独立性检查
合同由协调会话提供，用户 11-02 已批准；实现线只按原文自验，不改合同凑绿。独立验收留给另一条线。实现测试和反例均由本线执行，不能替代独立验收。

## 5. P0：这些是我们独有的吗
分镜目标/节点绑定、一次批准的输入、按镜头花钱和人工核对是 Nomi 领域约束。复用现有 autoReferencePlan、cancelEntry、Run 账本、job.reconcile、NodeErrorReport 确认条与稳定 JSON；不引入库、不自写新的队列或状态机。
队列/重试通用能力的对照已在原设计卡 ★0（client-go、LiteLLM、AWS、Temporal、InvokeAI）；本刀不重做它们，因为只修领域边界接线。
自写登记：本次 fix-churn 未点名自写登记 id，故无被触发登记需要保留或替换。

## 6. 接入 / 补 / 重写 / 删对比
| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入框架 | 整体换运行与队列 | 越过合同 | 请求/状态机迁移 | 否 |
| 补 | 各调用方分别忽略自动引用/锁 | 小改但继续分叉 | 另一个入口复发 | 否 |
| 换 | 共享窄比对、kind 替换、提交口去重、已有出口接通 | 覆盖所有调用与反例 | 需确认保护仍在 | 是 |
| 删 | 删掉内容保护 | 最少代码 | 用户改稿仍按旧输入花钱 | 否 |

## 7. 用户要权衡的核心
让不相关镜头继续，同时仍挡住这一镜自己改过的旧批准；结果不明只允许人工核对后重发。
这是换和删，不再加特例。用户 11-02 已批准碰热点（包括 classifyError.ts、NodeErrorReport.tsx、taskApi.ts）。

## 特征测试清单
设计卡 ★9 的类级测试先红后改；原始输出与逐条反例放交货报告。尚未执行的项目不得写通过。

## 热点原始输出
```text
【方向检查 · RW】这一刀碰的地方已经被反复修，先别再补：
  · src/workbench/creation/storyboard/StoryboardPlanEditor.tsx：目录 src/workbench/creation/storyboard/ 近 14 天已有 5 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 6 个
  · src/workbench/creation/storyboard/exec/storyboardRowActions.ts：目录 src/workbench/creation/storyboard/exec/ 近 14 天已有 3 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/capability/storyboardPresent.ts：目录 src/workbench/capability/ 近 14 天已有 7 个 fix（只涉及 6 个文件，算同一概念），这一刀是第 8 个
  · src/workbench/generationCanvas/runner/generationRunController.ts：目录 src/workbench/generationCanvas/runner/ 近 14 天已有 18 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 19 个
  · src/workbench/generationCanvas/nodes/NodeErrorReport.tsx：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/api/taskApi.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/api/taskApi.ts：目录 src/workbench/api/ 近 14 天已有 8 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 9 个
  · src/workbench/observability/classifyError.ts：文件近 14 天已有 9 个 fix，这一刀是第 10 个
  · src/workbench/observability/classifyError.ts：目录 src/workbench/observability/ 近 14 天已有 11 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 12 个
  · src/workbench/observability/narrate.ts：文件近 14 天已有 7 个 fix，这一刀是第 8 个
  · src/workbench/observability/narrate.ts：目录 src/workbench/observability/ 近 14 天已有 11 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 12 个
  · 概念「画布付费生成（一镜一个单镜 Run）」：含 6 个文件，近 14 天已有 6 个 fix，这一刀是第 7 个
  · 概念「生成错误怎么说成人话（错误 → 人话与动作）」：含 4 个文件，近 14 天已有 11 个 fix，这一刀是第 12 个
动作：停止派 / 打修补，先做「类根因复盘」（模板 docs/engineering/direction-check-template.md，产出一页文档），结构性结论交用户拍板（例外：只因概念 / 目录 / 自写登记口径命中、文件本身没命中，且改法是换或删、不新增分支——由协调代批、事后报用户）；复盘前先写特征测试钉住现状。
提交 fix 时在信息里加一行 `Direction-Check: <复盘文档路径>`（git commit-msg 会校验）。
```

## D3 合同补正
协调确认：再次被拒的记录留在历史；主进程以 openCanvasRuns + blockingReason 的同一读法查询节点的结果不明 Run，出口在继续时读取原占用。渲染层不拼 Run id，不移动 canvasRunIdFor。停点只停止有事实冲突的那条，其余继续。本轮仍是第 1 轮。

### 11-02 同轮补正：三个生产页面

用户要求分镜方案、画布、生成列表逻辑一致且都测试。协调补正 D5、E1–E10、七条反例和四段真实场景；合同原文已重新覆盖。沿用本轮换与删的方向：分类后的下一步收在观测域纯函数，画布与列表详情共享失败/找回卡，分镜窄格共享动作；旧原文显示、旧 canRetry、只升不降的 retrying 同提交删除。生成队列仍是排队状态唯一来源，列表按节点布尔订阅；不改请求、Run 状态机或结果不明判定。付费入口最多十四张，仅协调执行。

### D5 和主进程接线的新增热点复核

```text
【方向检查 · RW】这一刀碰的地方已经被反复修，先别再补：
  · src/workbench/observability/generationFailureActions.ts：目录 src/workbench/observability/ 近 14 天已有 11 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 12 个
  · src/workbench/creation/storyboard/exec/StoryboardFailureActions.tsx：目录 src/workbench/creation/storyboard/exec/ 近 14 天已有 3 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 4 个
  · electron/capabilityCore/appIntegrationCanvasShot.ts：文件近 14 天已有 3 个 fix，这一刀是第 4 个
  · electron/preload/runtimeBridge.ts：目录 electron/preload/ 近 14 天已有 3 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 4 个
  · 概念「付费卡交给画布之后的停下（「取消」不排队；还没轮到的同意当场收回、在交的照常交完；停下后照实说交出去几镜、几镜没发）」：含 2 个文件，近 14 天已有 3 个 fix，这一刀是第 4 个
  · 概念「画布付费生成（一镜一个单镜 Run）」：含 6 个文件，近 14 天已有 6 个 fix，这一刀是第 7 个
动作：停止派 / 打修补，先做「类根因复盘」（模板 docs/engineering/direction-check-template.md，产出一页文档），结构性结论交用户拍板（例外：只因概念 / 目录 / 自写登记口径命中、文件本身没命中，且改法是换或删、不新增分支——由协调代批、事后报用户）；复盘前先写特征测试钉住现状。
提交 fix 时在信息里加一行 `Direction-Check: <复盘文档路径>`（git commit-msg 会校验）。
```

这次命中的登记是概念 `canvas.shot-run`、`agent-panel.spend-batch-stop`；自写登记 id 没有新增命中，失败话术已在 observability 领域目录。前者继续复用一镜一 Run，本轮不能换账本（范围禁止），以后传输/状态机收敛任务再评估；后者复用既有 cancelEntry/withdrawCanvasShots，不更换取消协议，后续连接调度方案落地时再评估。新判据和卡是换与删，非并行路径。新增文件被目录热点命中，按协调已批准的三页一致方向执行。

### 全部最终改动文件的热点输出

对最终已改和新建文件统一运行 fix-churn，原始命中如下（同一轮批准的换与删；没有开下一轮）。

```text
【方向检查 · RW】这一刀碰的地方已经被反复修，先别再补：
  · electron/capabilityCore/appIntegration.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · electron/capabilityCore/appIntegrationCanvasShot.ts：文件近 14 天已有 3 个 fix，这一刀是第 4 个
  · electron/preload/runtimeBridge.ts：目录 electron/preload/ 近 14 天已有 3 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 4 个
  · src/desktop/bridge.ts：文件近 14 天已有 8 个 fix，这一刀是第 9 个
  · src/desktop/bridge.ts：目录 src/desktop/ 近 14 天已有 13 个 fix（只涉及 6 个文件，算同一概念），这一刀是第 14 个
  · src/i18n/locales/generationCommon.ts：generationCommon.ts#observability 近 14 天已有 9 个 fix，这一刀是第 10 个（词典按功能键计数）
  · src/i18n/locales/generationCommon.ts：generationCommon.ts#recoverable 近 14 天已有 2 个 fix，这一刀是第 3 个（词典按功能键计数）
  · src/i18n/locales/generationCommon.ts：generationCommon.ts#whiteboard 近 14 天已有 2 个 fix，这一刀是第 3 个（词典按功能键计数）
  · src/workbench/api/taskApi.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/api/taskApi.ts：目录 src/workbench/api/ 近 14 天已有 8 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 9 个
  · src/workbench/capability/storyboardPresent.ts：目录 src/workbench/capability/ 近 14 天已有 7 个 fix（只涉及 6 个文件，算同一概念），这一刀是第 8 个
  · src/workbench/creation/storyboard/StoryboardPlanEditor.tsx：目录 src/workbench/creation/storyboard/ 近 14 天已有 5 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 6 个
  · src/workbench/creation/storyboard/StoryboardShotTable.tsx：目录 src/workbench/creation/storyboard/ 近 14 天已有 5 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 6 个
  · src/workbench/creation/storyboard/exec/storyboardAutoReference.ts：目录 src/workbench/creation/storyboard/exec/ 近 14 天已有 3 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/creation/storyboard/exec/storyboardFailureCopy.ts：目录 src/workbench/creation/storyboard/exec/ 近 14 天已有 3 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/creation/storyboard/exec/storyboardRowActions.ts：目录 src/workbench/creation/storyboard/exec/ 近 14 天已有 3 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/creation/storyboard/exec/storyboardRowStatus.ts：目录 src/workbench/creation/storyboard/exec/ 近 14 天已有 3 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx：文件近 14 天已有 6 个 fix，这一刀是第 7 个
  · src/workbench/generationCanvas/nodes/NodeErrorReport.tsx：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/generationCanvas/runner/generationRunController.ts：目录 src/workbench/generationCanvas/runner/ 近 14 天已有 18 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 19 个
  · src/workbench/observability/classifyError.ts：文件近 14 天已有 9 个 fix，这一刀是第 10 个
  · src/workbench/observability/classifyError.ts：目录 src/workbench/observability/ 近 14 天已有 11 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 12 个
  · src/workbench/observability/narrate.ts：文件近 14 天已有 7 个 fix，这一刀是第 8 个
  · src/workbench/observability/narrate.ts：目录 src/workbench/observability/ 近 14 天已有 11 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 12 个
  · src/workbench/production/productionRunView.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/production/productionRunView.ts：目录 src/workbench/production/ 近 14 天已有 2 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 3 个
  · src/workbench/production/releaseUnknownSubmission.ts：目录 src/workbench/production/ 近 14 天已有 2 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 3 个
  · src/workbench/creation/storyboard/exec/StoryboardFailureActions.tsx：目录 src/workbench/creation/storyboard/exec/ 近 14 天已有 3 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/creation/storyboard/exec/storyboardActionGuard.ts：目录 src/workbench/creation/storyboard/exec/ 近 14 天已有 3 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/observability/generationFailureActions.ts：目录 src/workbench/observability/ 近 14 天已有 11 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 12 个
  · 概念「付费卡交给画布之后的停下（「取消」不排队；还没轮到的同意当场收回、在交的照常交完；停下后照实说交出去几镜、几镜没发）」：含 2 个文件，近 14 天已有 3 个 fix，这一刀是第 4 个
  · 概念「画布付费生成（一镜一个单镜 Run）」：含 6 个文件，近 14 天已有 6 个 fix，这一刀是第 7 个
  · 概念「生成错误怎么说成人话（错误 → 人话与动作）」：含 4 个文件，近 14 天已有 11 个 fix，这一刀是第 12 个
动作：停止派 / 打修补，先做「类根因复盘」（模板 docs/engineering/direction-check-template.md，产出一页文档），结构性结论交用户拍板（例外：只因概念 / 目录 / 自写登记口径命中、文件本身没命中，且改法是换或删、不新增分支——由协调代批、事后报用户）；复盘前先写特征测试钉住现状。
提交 fix 时在信息里加一行 `Direction-Check: <复盘文档路径>`（git commit-msg 会校验）。
```

### 收尾的删除

抽出的 useUnknownSubmissionRelease 文件触发通用 hook 登记。放行状态原本就在 NodeErrorReport 内，最终回到这个已有 owner，并导出同一动作和确认条供分镜共用；删除新 hook 文件，不新登记一项通用能力。没有改自写表、门岗或白名单。私有走查超时换为现有 stationTimeout 的安全上限，完成条件仍是 DOM、落盘状态或请求计数。

### 收尾判据与合同的差异

PR 判据把抽取复用的两个 tsx 文件当作新增界面，拒绝 pure-bugfix，另要求性能场景数字；合同却指定不新画卡、复用现有卡并以 pure-bugfix 交付。这里只停相应验收，不伪造拍板清单、性能数字或独立验收线编号，不修改门岗。列表恢复卡按 node.id 定义组件身份，避免切到另一节点继承上一节点的核对展开态；这是恢复状态的节点所有权，不新画界面。

### 快检检出的职责与体积收口

未放宽冻结体积上限。把编辑器的项目动作与按行 pending 收回已有 storyboardActionGuard；表 busy 从 pending 集合推导，删掉第二份 busy 状态。把表的类型契约从渲染器抽到领域类型文件。原样的 blockingReason 移到既有只读 canvasShotResult，准入和查询仍共用；不改 Run 规则。共享放行状态最终留在已有 releaseUnknownSubmission 动作 owner，NodeErrorReport 只导出确认界面，既无新 hook 文件，也无混合导出 lint 警告。

新增触达 owner 的热点：

```text
【方向检查 · RW】这一刀碰的地方已经被反复修，先别再补：
  · src/workbench/production/releaseUnknownSubmission.ts：目录 src/workbench/production/ 近 14 天已有 3 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 4 个
动作：停止派 / 打修补，先做「类根因复盘」（模板 docs/engineering/direction-check-template.md，产出一页文档），结构性结论交用户拍板（例外：只因概念 / 目录 / 自写登记口径命中、文件本身没命中，且改法是换或删、不新增分支——由协调代批、事后报用户）；复盘前先写特征测试钉住现状。
提交 fix 时在信息里加一行 `Direction-Check: <复盘文档路径>`（git commit-msg 会校验）。
```

### 同轮裁决：按节点批准、既有单张政策、完整复现

协调确认此前五个停点来自合同错误：批准输入只比 executingNodeId；单张仍不弹卡，未知结果的核对条就是确认；代理分段上限 2/1/1；三次前置失败不计业务停点，再给三次免费演练；出网 A5 在网络保护环境才红，推送快检不带该变量，测试不改。两个复用组件并入原 owner，删独立 tsx 文件；补现有及队列结算性能实测、四段加静置、中英最终截图，账本带类级检查转 fixed。方向沿用，补齐既有机制，不增加单张确认判据，不改门岗或基线。资产阶段改更贵模型只审计金额一致性，发现可能多花即单项停下报告。

### 最新同轮裁决后的全范围复核

协调授权沿用既有方向继续补齐：按执行节点保留全部输入保护；单用户生成沿用既定不弹卡策略；三页组件共置于原文件并删掉两个新文件。新性能场景只量数字，不改既有基线；资产阶段换贵模型的确认差异单列停止。以下是当前所有改动文件的 fix-churn 原始命中（包含原实施与本轮补齐），热点已由用户授权。

```text
【方向检查 · RW】这一刀碰的地方已经被反复修，先别再补：
  · electron/capabilityCore/appIntegration.ts：文件近 14 天已有 3 个 fix，这一刀是第 4 个
  · electron/capabilityCore/appIntegrationCanvasShot.ts：文件近 14 天已有 4 个 fix，这一刀是第 5 个
  · electron/feedback/feedbackCatalog.ts：文件近 14 天已有 3 个 fix，这一刀是第 4 个
  · electron/feedback/feedbackCatalog.ts：目录 electron/feedback/ 近 14 天已有 5 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 6 个
  · electron/feedback/feedbackIpc.ts：目录 electron/feedback/ 近 14 天已有 5 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 6 个
  · electron/feedback/feedbackReport.ts：文件近 14 天已有 4 个 fix，这一刀是第 5 个
  · electron/feedback/feedbackReport.ts：目录 electron/feedback/ 近 14 天已有 5 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 6 个
  · electron/preload/runtimeBridge.ts：目录 electron/preload/ 近 14 天已有 4 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 5 个
  · electron/tasks/taskIpcHandlers.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · electron/telemetry/intakeQueue.ts：目录 electron/telemetry/ 近 14 天已有 3 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 4 个
  · src/desktop/bridge.ts：文件近 14 天已有 9 个 fix，这一刀是第 10 个
  · src/desktop/bridge.ts：目录 src/desktop/ 近 14 天已有 14 个 fix（只涉及 6 个文件，算同一概念），这一刀是第 15 个
  · src/i18n/locales/feedbackReport.ts：feedbackReport.ts#manifestItem 近 14 天已有 4 个 fix，这一刀是第 5 个（词典按功能键计数）
  · src/i18n/locales/feedbackReport.ts：feedbackReport.ts#(根) 近 14 天已有 2 个 fix，这一刀是第 3 个（词典按功能键计数）
  · src/i18n/locales/generationCommon.ts：generationCommon.ts#observability 近 14 天已有 10 个 fix，这一刀是第 11 个（词典按功能键计数）
  · src/i18n/locales/generationCommon.ts：generationCommon.ts#production 近 14 天已有 2 个 fix，这一刀是第 3 个（词典按功能键计数）
  · src/i18n/locales/generationCommon.ts：generationCommon.ts#recoverable 近 14 天已有 2 个 fix，这一刀是第 3 个（词典按功能键计数）
  · src/i18n/locales/generationCommon.ts：generationCommon.ts#whiteboard 近 14 天已有 2 个 fix，这一刀是第 3 个（词典按功能键计数）
  · src/ui/community/FeedbackReportCard.tsx：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/ui/community/FeedbackReportCard.tsx：目录 src/ui/community/ 近 14 天已有 2 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 3 个
  · src/ui/community/FeedbackShareHost.tsx：目录 src/ui/community/ 近 14 天已有 2 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 3 个
  · src/workbench/api/taskApi.ts：文件近 14 天已有 3 个 fix，这一刀是第 4 个
  · src/workbench/api/taskApi.ts：目录 src/workbench/api/ 近 14 天已有 9 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 10 个
  · src/workbench/capability/storyboardPresent.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/capability/storyboardPresent.ts：目录 src/workbench/capability/ 近 14 天已有 8 个 fix（只涉及 6 个文件，算同一概念），这一刀是第 9 个
  · src/workbench/creation/storyboard/exec/storyboardFailureCopy.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/creation/storyboard/shotRow/StoryboardFrameActions.tsx：目录 src/workbench/creation/storyboard/shotRow/ 近 14 天已有 2 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 3 个
  · src/workbench/creation/storyboard/shotRow/StoryboardShotFrame.tsx：目录 src/workbench/creation/storyboard/shotRow/ 近 14 天已有 2 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 3 个
  · src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx：目录 src/workbench/creation/storyboard/shotRow/ 近 14 天已有 2 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 3 个
  · src/workbench/generation/list/GenerationListCard.tsx：目录 src/workbench/generation/list/ 近 14 天已有 3 个 fix（只涉及 4 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/generation/list/GenerationListDetail.tsx：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/generation/list/GenerationListDetail.tsx：目录 src/workbench/generation/list/ 近 14 天已有 3 个 fix（只涉及 4 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/generation/list/GenerationListParts.tsx：目录 src/workbench/generation/list/ 近 14 天已有 3 个 fix（只涉及 4 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx：文件近 14 天已有 7 个 fix，这一刀是第 8 个
  · src/workbench/generationCanvas/nodes/NodeErrorReport.tsx：文件近 14 天已有 3 个 fix，这一刀是第 4 个
  · src/workbench/generationCanvas/runner/generationRunController.ts：目录 src/workbench/generationCanvas/runner/ 近 14 天已有 19 个 fix（只涉及 6 个文件，算同一概念），这一刀是第 20 个
  · src/workbench/generationCanvas/runner/runProjectDelivery.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/generationCanvas/runner/runProjectDelivery.ts：目录 src/workbench/generationCanvas/runner/ 近 14 天已有 19 个 fix（只涉及 6 个文件，算同一概念），这一刀是第 20 个
  · src/workbench/observability/classifyError.ts：文件近 14 天已有 10 个 fix，这一刀是第 11 个
  · src/workbench/observability/classifyError.ts：目录 src/workbench/observability/ 近 14 天已有 12 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 13 个
  · src/workbench/observability/generationFailureActions.ts：目录 src/workbench/observability/ 近 14 天已有 12 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 13 个
  · src/workbench/observability/narrate.ts：文件近 14 天已有 8 个 fix，这一刀是第 9 个
  · src/workbench/observability/narrate.ts：目录 src/workbench/observability/ 近 14 天已有 12 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 13 个
  · src/workbench/production/ProductionCanvasLandingHost.tsx：目录 src/workbench/production/ 近 14 天已有 3 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/production/productionRunView.ts：文件近 14 天已有 3 个 fix，这一刀是第 4 个
  · src/workbench/production/productionRunView.ts：目录 src/workbench/production/ 近 14 天已有 3 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/production/releaseUnknownSubmission.ts：目录 src/workbench/production/ 近 14 天已有 3 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/production/useProductionStatus.ts：目录 src/workbench/production/ 近 14 天已有 3 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 4 个
  · 概念「付费卡交给画布之后的停下（「取消」不排队；还没轮到的同意当场收回、在交的照常交完；停下后照实说交出去几镜、几镜没发）」：含 2 个文件，近 14 天已有 4 个 fix，这一刀是第 5 个
  · 概念「生成结局投递到运行所属项目（节点不在时暂存）」：含 2 个文件，近 14 天已有 2 个 fix，这一刀是第 3 个
  · 概念「画布付费生成（一镜一个单镜 Run）」：含 6 个文件，近 14 天已有 7 个 fix，这一刀是第 8 个
  · 概念「生成错误怎么说成人话（错误 → 人话与动作）」：含 4 个文件，近 14 天已有 12 个 fix，这一刀是第 13 个
  · 概念「一键反馈带出机器的日志尾巴长什么样」：含 3 个文件，近 14 天已有 4 个 fix，这一刀是第 5 个
动作：停止派 / 打修补，先做「类根因复盘」（模板 docs/engineering/direction-check-template.md，产出一页文档），结构性结论交用户拍板（例外：只因概念 / 目录 / 自写登记口径命中、文件本身没命中，且改法是换或删、不新增分支——由协调代批、事后报用户）；复盘前先写特征测试钉住现状。
提交 fix 时在信息里加一行 `Direction-Check: <复盘文档路径>`（git commit-msg 会校验）。
```

### 真窗与类测试发现的同类遗漏

两张 Agent 资产分别确认时，第一张落地触发编辑器补引用，第二张的准入却仍拿整批镜头作目标：改为把这一张资产的目标交给同一个守卫，全局与全部参考卡字段保护不变；不改 Agent 确认政策。列表窄列把旧产物放在本次状态之前，改为直接展示现有行状态词表。新行为测试先红4项、后相关66项过；B2补了暂停中失败卡单发、恢复后不重发的行为测试。删除临时新增的两个测试桥，队列与单节点计划均复用原有测试入口。付费代理只丢已受理任务的回执，拒单原样转发，使用Node标准解压读取回执而不改字节；总预算为脚本13张加协调探价1张。

### 收尾登记核对

登记 `full-walk-monitor` 命中了本轮逃逸账本路径，未改监视器实现。现在不换：它保存 Nomi 的批准范围、派发范围与错误恢复不变量，执行仍用 Playwright；本轮只结账用户问题，换监视器会越过合同。替换时点沿用登记：Playwright matcher / reporter 能表达这些规则且不丢“违反不中断”的语义时。无新增自写能力或登记豁免。两个独立 TSX 已按裁决共置并删除，新界面文件的 pure-bugfix 阻断已解除；性能数字另交原始结果，不修改已有基线。

### 收尾完整文件清单的原始输出

```text
【方向检查 · RW】这一刀碰的地方已经被反复修，先别再补：
  · electron/capabilityCore/appIntegration.ts：文件近 14 天已有 3 个 fix，这一刀是第 4 个
  · electron/capabilityCore/appIntegrationCanvasShot.ts：文件近 14 天已有 4 个 fix，这一刀是第 5 个
  · electron/preload/runtimeBridge.ts：目录 electron/preload/ 近 14 天已有 4 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 5 个
  · electron/tasks/taskIpcHandlers.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/desktop/bridge.ts：文件近 14 天已有 9 个 fix，这一刀是第 10 个
  · src/desktop/bridge.ts：目录 src/desktop/ 近 14 天已有 14 个 fix（只涉及 6 个文件，算同一概念），这一刀是第 15 个
  · src/i18n/locales/generationCommon.ts：generationCommon.ts#observability 近 14 天已有 10 个 fix，这一刀是第 11 个（词典按功能键计数）
  · src/i18n/locales/generationCommon.ts：generationCommon.ts#production 近 14 天已有 2 个 fix，这一刀是第 3 个（词典按功能键计数）
  · src/i18n/locales/generationCommon.ts：generationCommon.ts#recoverable 近 14 天已有 2 个 fix，这一刀是第 3 个（词典按功能键计数）
  · src/i18n/locales/generationCommon.ts：generationCommon.ts#whiteboard 近 14 天已有 2 个 fix，这一刀是第 3 个（词典按功能键计数）
  · src/workbench/api/taskApi.ts：文件近 14 天已有 3 个 fix，这一刀是第 4 个
  · src/workbench/api/taskApi.ts：目录 src/workbench/api/ 近 14 天已有 9 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 10 个
  · src/workbench/capability/storyboardPresent.ts：文件近 14 天已有 3 个 fix，这一刀是第 4 个
  · src/workbench/capability/storyboardPresent.ts：目录 src/workbench/capability/ 近 14 天已有 9 个 fix（只涉及 6 个文件，算同一概念），这一刀是第 10 个
  · src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx：目录 src/workbench/creation/storyboard/anchorZone/ 近 14 天已有 2 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 3 个
  · src/workbench/creation/storyboard/anchorZone/StoryboardAnchorZone.tsx：目录 src/workbench/creation/storyboard/anchorZone/ 近 14 天已有 2 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 3 个
  · src/workbench/creation/storyboard/exec/storyboardActionGuard.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/creation/storyboard/exec/storyboardFailureCopy.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/creation/storyboard/shotRow/StoryboardFrameActions.tsx：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/creation/storyboard/shotRow/StoryboardFrameActions.tsx：目录 src/workbench/creation/storyboard/shotRow/ 近 14 天已有 3 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/creation/storyboard/shotRow/StoryboardShotFrame.tsx：目录 src/workbench/creation/storyboard/shotRow/ 近 14 天已有 3 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx：目录 src/workbench/creation/storyboard/shotRow/ 近 14 天已有 3 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 4 个
  · src/workbench/generation/list/GenerationListCard.tsx：目录 src/workbench/generation/list/ 近 14 天已有 5 个 fix（只涉及 4 个文件，算同一概念），这一刀是第 6 个
  · src/workbench/generation/list/GenerationListDetail.tsx：文件近 14 天已有 4 个 fix，这一刀是第 5 个
  · src/workbench/generation/list/GenerationListDetail.tsx：目录 src/workbench/generation/list/ 近 14 天已有 5 个 fix（只涉及 4 个文件，算同一概念），这一刀是第 6 个
  · src/workbench/generation/list/GenerationListParts.tsx：目录 src/workbench/generation/list/ 近 14 天已有 5 个 fix（只涉及 4 个文件，算同一概念），这一刀是第 6 个
  · src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx：文件近 14 天已有 8 个 fix，这一刀是第 9 个
  · src/workbench/generationCanvas/nodes/NodeErrorReport.tsx：文件近 14 天已有 4 个 fix，这一刀是第 5 个
  · src/workbench/generationCanvas/runner/generationRunController.ts：目录 src/workbench/generationCanvas/runner/ 近 14 天已有 21 个 fix（只涉及 6 个文件，算同一概念），这一刀是第 22 个
  · src/workbench/generationCanvas/runner/runProjectDelivery.ts：文件近 14 天已有 3 个 fix，这一刀是第 4 个
  · src/workbench/generationCanvas/runner/runProjectDelivery.ts：目录 src/workbench/generationCanvas/runner/ 近 14 天已有 21 个 fix（只涉及 6 个文件，算同一概念），这一刀是第 22 个
  · src/workbench/observability/classifyError.ts：文件近 14 天已有 10 个 fix，这一刀是第 11 个
  · src/workbench/observability/classifyError.ts：目录 src/workbench/observability/ 近 14 天已有 14 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 15 个
  · src/workbench/observability/generationFailureActions.ts：目录 src/workbench/observability/ 近 14 天已有 14 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 15 个
  · src/workbench/observability/narrate.ts：文件近 14 天已有 8 个 fix，这一刀是第 9 个
  · src/workbench/observability/narrate.ts：目录 src/workbench/observability/ 近 14 天已有 14 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 15 个
  · src/workbench/production/productionRunView.ts：文件近 14 天已有 3 个 fix，这一刀是第 4 个
  · src/workbench/production/productionRunView.ts：目录 src/workbench/production/ 近 14 天已有 5 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 6 个
  · src/workbench/production/releaseUnknownSubmission.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/production/releaseUnknownSubmission.ts：目录 src/workbench/production/ 近 14 天已有 5 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 6 个
  · src/workbench/production/useProductionStatus.ts：目录 src/workbench/production/ 近 14 天已有 5 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 6 个
  · 概念「付费卡交给画布之后的停下（「取消」不排队；还没轮到的同意当场收回、在交的照常交完；停下后照实说交出去几镜、几镜没发）」：含 2 个文件，近 14 天已有 4 个 fix，这一刀是第 5 个
  · 概念「生成结局投递到运行所属项目（节点不在时暂存）」：含 2 个文件，近 14 天已有 3 个 fix，这一刀是第 4 个
  · 概念「画布付费生成（一镜一个单镜 Run）」：含 6 个文件，近 14 天已有 7 个 fix，这一刀是第 8 个
  · 概念「生成错误怎么说成人话（错误 → 人话与动作）」：含 4 个文件，近 14 天已有 12 个 fix，这一刀是第 13 个
动作：停止派 / 打修补，先做「类根因复盘」（模板 docs/engineering/direction-check-template.md，产出一页文档），结构性结论交用户拍板（例外：只因概念 / 目录 / 自写登记口径命中、文件本身没命中，且改法是换或删、不新增分支——由协调代批、事后报用户）；复盘前先写特征测试钉住现状。
提交 fix 时在信息里加一行 `Direction-Check: <复盘文档路径>`（git commit-msg 会校验）。
```

### 同一轮协调续做：A11 与任务中心

协调已拍板：这是本刀放宽整方案守卫后产生的价格风险，补在既有 storyboardActionGuard / runStoryboardBatch；只在已选镜或全局花钱字段变化时撤销第二阶段跳过确认，系统自动引用先两边归一。普通单张判据和 Agent 分段确认不动。任务中心如摆必拒重试，改用现有 generationFailureActions 判据去掉，无新组件/文件。测试 helper 修好后各再给3次，不开下一轮。

本次热点原始输出：

```text
【方向检查 · RW】这一刀碰的地方已经被反复修，先别再补：
  · src/workbench/creation/storyboard/exec/storyboardActionGuard.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
动作：停止派 / 打修补，先做「类根因复盘」（模板 docs/engineering/direction-check-template.md，产出一页文档），结构性结论交用户拍板（例外：只因概念 / 目录 / 自写登记口径命中、文件本身没命中，且改法是换或删、不新增分支——由协调代批、事后报用户）；复盘前先写特征测试钉住现状。
提交 fix 时在信息里加一行 `Direction-Check: <复盘文档路径>`（git commit-msg 会校验）。
```

任务中心新增文件热点复核（协调明确批准读同一失败判据并去掉必拒按钮）：

```text
方向检查：未命中热点。
```

最终A11/任务中心补齐后的热点全量输出（仍为用户授权的同一轮）：

```text
【方向检查 · RW】这一刀碰的地方已经被反复修，先别再补：
  · src/workbench/creation/storyboard/exec/storyboardActionGuard.ts：文件近 14 天已有 3 个 fix，这一刀是第 4 个
  · src/workbench/creation/storyboard/exec/storyboardRowActions.ts：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/taskCenter/taskCenterEntries.ts：目录 src/workbench/taskCenter/ 近 14 天已有 2 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 3 个
  · src/workbench/taskCenter/TaskCenterPanel.tsx：文件近 14 天已有 2 个 fix，这一刀是第 3 个
  · src/workbench/taskCenter/TaskCenterPanel.tsx：目录 src/workbench/taskCenter/ 近 14 天已有 2 个 fix（只涉及 2 个文件，算同一概念），这一刀是第 3 个
  · 概念「分镜批量生成的确认缝（确认前不落画布、取消零节点零波次）」：含 3 个文件，近 14 天已有 2 个 fix，这一刀是第 3 个
动作：停止派 / 打修补，先做「类根因复盘」（模板 docs/engineering/direction-check-template.md，产出一页文档），结构性结论交用户拍板（例外：只因概念 / 目录 / 自写登记口径命中、文件本身没命中，且改法是换或删、不新增分支——由协调代批、事后报用户）；复盘前先写特征测试钉住现状。
提交 fix 时在信息里加一行 `Direction-Check: <复盘文档路径>`（git commit-msg 会校验）。
```
