# 「自动」到底用哪个模型

普查基线 `a05ca5219ec59bd42b143c6cc605394869f861bc`，查询日期 2026-11-27。新增报告文件近 14 天有 0 次修复，`fix-churn` 未命中热点。模型如何落实到一张要生成的卡是 Nomi 的领域决策，本次只补入口和先例证据，保留实现供协调出稿。截图由协调在设计阶段采集。[派活原文](https://github.com/aqm857886159/Nomi/issues/1586#issuecomment-7195105039) · [分工更新](https://github.com/aqm857886159/Nomi/issues/1586#issuecomment-7195614716)

**今天没有一个模型名可以填在所有「自动」后面。** 同一份空偏好，手建空卡从本次可用清单里挑，分镜建卡先匹配品牌名，Agent 和外部 MCP 的语义起草要求有可用的显式默认或由调用者点名。设置页与 Agent 菜单已经共用存储，分歧发生在读哪个键、如何解释缺省。目录有旗舰分档、文本自动优先级和读图首选标记，四种图像／视频生成任务缺少按功能指定推荐模型的声明。

## 1. 一张卡从哪里拿到模型

| 创作者的动作 | 没有为本次点名模型时，今天会发生什么 |
| --- | --- |
| 画布新建图片／视频卡 | 按卡的媒介和参考图找一条保存偏好；匹配不到，挑可用清单中优先级最高的一组里的第一项。选定后把名字和身份写入卡。 |
| Agent 起草一镜／多镜 | 已保存的双段身份在对应任务可用就采用。选「自动」意味着没有这一条，Agent 可自行点名一个可用模型，省略身份则可能在起草阶段被拒。 |
| 分镜表生成未生成的镜头 | 已点名的镜头保留自己的模型。新建节点走分镜的默认阶梯；已有画布卡成组运行时各用卡上的选择。 |
| 外部助手创建生成草稿 | MCP 将参数送到与 Agent 同一套规划代码。给完整候选、点名模型、仅给任务和提示词，是三种不同情况。预览和批准已有草稿沿用候选。 |

### 画布新卡

1. 生成框按节点类型和当前方式取选项，先用 `rowServesMode` 过滤，再按目录输入顺序投影，以供应商和模型两段去重。参数区把这份选项直接传给自动选择。屏幕上的模型框稍后另做合并、隐藏、排序，所以「按顺序挑」精确到这里是**候选顺序**；不能从最终屏幕的第一行反推新卡一定选谁。见 `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:157`、`src/config/modelCatalogCache.ts:187`、`src/config/modelOptionMappers.ts:35`、`src/config/modelOptionMappers.ts:40`、`src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:147`、`src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:246`。
2. 已选模型直接返回；Agent 候选有身份却不在可用清单时保留意图并提示。其余卡等偏好装好，按元数据里的参考图列表或首帧划分文生图、改图、文生视频、图生视频，四行外的节点拿不到这份偏好。匹配必须同时命中 vendor 和 model。见 `src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:142`、`src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:150`、`src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:167`、`src/workbench/generationCanvas/nodes/defaultNodeModelSelection.ts:34`、`src/workbench/generationCanvas/nodes/defaultNodeModelSelection.ts:72`、`src/workbench/generationCanvas/nodes/defaultNodeModelSelection.ts:76`、`src/workbench/generationCanvas/nodes/defaultNodeModelSelection.ts:65`。
3. 未设或失效才进入自动阶梯。先筛有档案且名称不匹配编辑／需参考正则的候选，取首个未被标为近期连败的；依次退到该组首项、有档案首项、全部首项。健康记忆按家和模型计数，末次失败在 24 小时内且累计连败至少两次才避让。没有候选就不写；有候选时写入 modelKey、modelVendor、modelLabel 等，卡上此后有具体身份。见 `src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:176`、`src/workbench/generationCanvas/nodes/nodeModelArchetype.ts:39`、`src/workbench/generationCanvas/nodes/nodeModelArchetype.ts:42`、`src/workbench/generationCanvas/nodes/nodeModelArchetype.ts:48`、`src/workbench/generationCanvas/runner/modelHealthMemory.ts:19`、`src/workbench/generationCanvas/runner/modelHealthMemory.ts:115`、`src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:177`、`src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:192`、`src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:220`。
4. **从已有图派生新卡另有规则。** 在可改图候选中先沿用源图自己的非放大模型，再找 `image_edit` 偏好，再找第一个非放大候选。点「放大」直接找第一项档案含 upscale 方式的模型。见 `src/workbench/generationCanvas/quickActions/deriveFromNode.ts:126`、`src/workbench/generationCanvas/quickActions/deriveFromNode.ts:135`、`src/workbench/generationCanvas/quickActions/deriveFromNode.ts:138`、`src/workbench/generationCanvas/quickActions/deriveFromNode.ts:139`、`src/workbench/generationCanvas/quickActions/deriveFromNode.ts:142`、`src/workbench/generationCanvas/quickActions/deriveFromNode.ts:155`。

### Agent 与 MCP 共用的判断，以及拒绝发生的条件

- **Agent 如何起草。** 运行时把四种任务中能解析出来的默认交给模型索引和工具。索引对空行明说「含自动选」，提示 Agent 从可用目录点名并告诉用户。调用 `draft_shots` 时，顶层参数折进每镜，逐镜优先；点名先解析身份，再投影到单镜 create、多镜 create 或已有草稿的 extend／patch。后续 `generate` 是 present。见 `electron/agentLane/laneDesktopRuntime.ts:167`、`electron/agentLane/laneDesktopRuntime.ts:206`、`electron/agentLane/laneDesktopModelDefaults.ts:16`、`electron/agentLane/laneHost.mts:404`、`electron/agentLane/laneModelContext.ts:39`、`electron/agentLane/laneModelContext.ts:44`、`electron/agentLane/laneVerbTransport.ts:105`、`electron/agentLane/laneVerbTransport.ts:107`、`electron/agentLane/laneVerbTransport.ts:114`、`electron/agentLane/laneVerbTransport.ts:125`、`electron/agentLane/laneVerbTransport.ts:134`、`electron/agentLane/laneVerbTransport.ts:138`、`electron/agentLane/laneVerbTransport.ts:143`。
- **外部助手的门。** 对外工具名是 `nomi_operation_plan`。创建时接受 `vendor/modelKey` 读侧别名，规范字段 `providerId/modelId` 优先；有 operationId 则进入编辑。stdio 装配同一个生成域，dispatcher 按 create 把带项目租约的参数交给 planning。单镜、逐镜 shots、剧本自动拟镜都调用 `semanticCandidateFromParams`。见 `electron/capabilityCore/mcpToolCatalog.ts:337`、`electron/capabilityCore/mcpGenerationToolCatalog.ts:68`、`electron/capabilityCore/mcpGenerationToolCatalog.ts:60`、`electron/capabilityCore/mcpGenerationToolCatalog.ts:75`、`electron/capabilityCore/mcpStdioServer.ts:251`、`electron/capabilityCore/generationDispatcher.ts:28`、`electron/capabilityCore/generationDispatcher.ts:371`、`electron/capabilityCore/generationDraftAdmission.ts:106`、`electron/capabilityCore/mcpGenerationMultiShot.ts:176`、`electron/capabilityCore/mcpGenerationMultiShot.ts:213`。
- **缺省解析。** 每次调用按该版目录和磁盘设置构造解析器。先筛媒介、可用性、该任务已发布，再找这条任务保存的精确双段身份；没设、已失效、该方式未发布都返回 undefined。完整 candidate 先按显式候选解析；点了名的按目录认名，同名多家且无法靠本任务默认消歧时要求给 providerId。草稿修改也复用认名。见 `electron/capabilityCore/liveGenerationRuntime.ts:125`、`electron/capabilityCore/generationDefaultModelResolver.ts:50`、`electron/capabilityCore/generationDefaultModelResolver.ts:53`、`electron/capabilityCore/generationDefaultModelResolver.ts:59`、`electron/capabilityCore/generationDefaultModelResolver.ts:64`、`electron/capabilityCore/semanticGenerationCandidate.ts:465`、`electron/capabilityCore/semanticGenerationCandidate.ts:297`、`electron/capabilityCore/semanticGenerationCandidate.ts:313`、`electron/capabilityCore/generationPlanPatch.ts:75`。
- **最小反例。** 有可用文生图模型，选「自动」，再起草一镜，只给有效 prompt 和 `taskKind=text_to_image`。宿主能确定任务，但该键已删除，`configured` 为空。按注册表首行兜底要显式设置 `allowRegistryFallback`，生产装配没有打开。拼不出 moduleId、providerId、modelId 就返回 `no_default_model`，下一步是从可用列表点名；现有测试还断言没有扣费。若 Agent 已点名可用模型，则「自动」本身不会触发这个拒绝。见 `electron/capabilityCore/semanticGenerationCandidate.ts:478`、`electron/capabilityCore/semanticGenerationCandidate.ts:482`、`electron/capabilityCore/semanticGenerationCandidate.ts:489`、`electron/capabilityCore/semanticGenerationCandidate.ts:495`、`electron/shared/generationProblem.ts:122`、`electron/capabilityCore/mcpGenerationTools.test.ts:205`。
- **不要混淆另外两种拒绝。** 明写错误模型名（包括把菜单文案当 modelId）走认名失败；任务种类也推不出时会更早拒绝。已选模型的实际方式随后按档案与输入归一。见 `electron/capabilityCore/semanticGenerationCandidate.ts:316`、`electron/capabilityCore/semanticGenerationCandidate.ts:359`、`electron/shared/generationShotKind.ts:76`、`electron/capabilityCore/semanticGenerationCandidate.ts:499`、`electron/capabilityCore/generationDraftAdmission.ts:122`。

### 分镜批量与已有画布卡

- **分镜表建卡。** 编辑器生成未生成镜头、Agent 展示分镜方案后执行，都能进 `runStoryboardBatch`。要补建镜头时取图片与视频默认。按媒介先试文生键，再试改图／图生视频键，逐个用 vendor + model 匹配可用清单。都没命中时，图片按 GPT Image → Nano Banana → 首个图片，视频按 Seedance → 首个视频；每级都是名称匹配，不区分同族谁最强。同 ID 多家再按供应商偏好落家。镜头手选身份优先，关键帧可单独指定；锚卡也先用自己的模型，再取图片默认。见 `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx:410`、`src/workbench/capability/storyboardPresent.ts:94`、`src/workbench/creation/storyboard/exec/storyboardRowActions.ts:611`、`src/workbench/creation/storyboard/exec/storyboardRowActions.ts:86`、`src/workbench/generationCanvas/agent/availableModels.ts:133`、`src/workbench/generationCanvas/agent/availableModels.ts:153`、`src/workbench/generationCanvas/agent/availableModels.ts:172`、`src/workbench/generationCanvas/agent/availableModels.ts:173`、`src/workbench/generationCanvas/agent/availableModels.ts:177`、`src/workbench/generationCanvas/agent/availableModels.ts:195`、`src/workbench/generationCanvas/agent/storyboardPlan.ts:266`、`src/workbench/generationCanvas/agent/storyboardPlan.ts:272`、`src/workbench/generationCanvas/agent/storyboardPlan.ts:278`、`src/workbench/generationCanvas/agent/storyboardPlan.ts:229`。
- **同一阶梯还有三个读者。** 能力调用把方案落画布时解析图片和视频默认；分镜行模型菜单已经把解析出的显示名放进「默认模型」说明；有角色参考且未启用独立关键帧的镜头，做锚点归一时若没点名，直接进品牌阶梯，绕过保存偏好。该归一有工具调用和分镜规划器两扇门。见 `src/workbench/capability/capabilityApplyHandler.ts:562`、`src/workbench/capability/capabilityApplyHandler.ts:563`、`src/workbench/creation/storyboard/shotRow/StoryboardComposerParams.tsx:51`、`src/workbench/creation/storyboard/shotRow/StoryboardComposerParams.tsx:145`、`src/workbench/generationCanvas/agent/storyboardAnchorPolicy.ts:68`、`src/workbench/generationCanvas/agent/storyboardAnchorPolicy.ts:70`、`src/workbench/generationCanvas/agent/storyboardAnchorPolicy.ts:81`、`src/workbench/generationCanvas/agent/applyCanvasToolCall.ts:326`、`src/workbench/generationCanvas/agent/runStoryboardPlanner.ts:56`。
- **画布「生成整组」。** 用已有节点构造计划，按确认的行跑波次。报价所用身份读各节点的 selectedVendor 和 selectedModelKey。节点既无模型也无家时，执行端保留空身份，下游提示先选模型。批量按钮没有再按全局偏好给整组重选。见 `src/workbench/generationCanvas/components/groupGenerate.ts:104`、`src/workbench/generationCanvas/components/groupGenerate.ts:109`、`src/workbench/generationCanvas/components/batchPlanPreview.ts:102`、`src/workbench/generationCanvas/components/batchPlanPreview.ts:259`、`src/workbench/generationCanvas/runner/catalogTaskResolve.ts:174`、`src/workbench/generationCanvas/runner/catalogTaskActions.ts:317`。

## 2. 四行默认存在哪里，谁能改变它

| 存储或入口 | 读写对象与证据 |
| --- | --- |
| 磁盘与合同 | 设置根优先取 `NOMI_SETTINGS_DIR`，否则取 Electron 的 userData，其下文件名为 `generation-model-defaults.json`。形状是 `{schemaVersion: 1, byTaskKind: {任务键: {vendorKey, modelKey}}}`。四键是 `text_to_image`、`image_edit`、`text_to_video`、`image_to_video`。空默认是空对象，清洗只收合法任务与完整双段身份。见 `electron/settings/settingsRoot.ts:5`、`electron/settings/settingsRoot.ts:20`、`electron/settings/generationModelDefaultsSettings.ts:11`、`electron/settings/generationModelDefaultsSettings.ts:23`、`electron/shared/contracts/generationModelDefaultsContract.ts:16`、`electron/shared/contracts/generationModelDefaultsContract.ts:29`、`electron/shared/contracts/generationModelDefaultsContract.ts:37`、`electron/shared/contracts/generationModelDefaultsContract.ts:42`、`electron/shared/contracts/generationModelDefaultsContract.ts:85`。 |
| 主进程与桥 | 从文件读后清洗；写前清洗并原子写入。get/set IPC 都校验调用方，分别调用 store.read 和 store.write；preload 对外提供这一对通道。见 `electron/settings/generationModelDefaultsSettings.ts:27`、`electron/settings/generationModelDefaultsSettings.ts:34`、`electron/settings/generationModelDefaultsIpc.ts:17`、`electron/settings/generationModelDefaultsIpc.ts:23`、`electron/settings/generationModelDefaultsIpc.ts:28`、`electron/settings/registerSettingsIpc.ts:23`、`electron/preload.ts:100`、`src/desktop/settingsBridge.ts:40`。 |
| 渲染进程快照 | 同一个模块保存快照、装载状态和订阅者。首次 get 读盘，读失败发出空快照；保存时先更新内存并通知，再发整份 set，写失败保留当前内存快照。因此两张界面可即时同步，写失败时宿主下次读盘仍可能看到旧值。见 `src/workbench/generationCanvas/model/generationModelDefaults.ts:29`、`src/workbench/generationCanvas/model/generationModelDefaults.ts:39`、`src/workbench/generationCanvas/model/generationModelDefaults.ts:51`、`src/workbench/generationCanvas/model/generationModelDefaults.ts:59`、`src/workbench/generationCanvas/model/generationModelDefaults.ts:82`、`src/workbench/generationCanvas/model/generationModelDefaults.ts:93`、`src/workbench/generationCanvas/model/generationModelDefaults.ts:97`、`src/workbench/generationCanvas/model/generationModelDefaults.ts:100`。 |
| 设置页（交互写口一） | 订阅同一 getter，打开时装载，编辑时保存。渲染四行，空串删除当行，保留另外三键。下拉首项写「自动选择 / Auto select」，失效的保存身份有不可用提示。见 `src/workbench/settings/AiModelsSection.tsx:98`、`src/workbench/settings/AiModelsSection.tsx:102`、`src/workbench/settings/AiModelsSection.tsx:105`、`src/workbench/settings/DefaultGenerationModelsSection.tsx:54`、`src/workbench/settings/DefaultGenerationModelsSection.tsx:71`、`src/workbench/settings/DefaultGenerationModelsSection.tsx:92`、`src/i18n/locales/settings.ts:26`、`src/i18n/locales/settings.ts:278`。 |
| Agent 菜单（交互写口二） | 同一 getter、load、save。图片行固定读写 `text_to_image`，视频行固定读写 `text_to_video`，选自动只删所选键；改图、图生视频两个隐藏键仍保留。例如在此清空「图片」，设置页的「图片编辑」仍可能指定某家。当前显示「自动选 / Auto」；对话行另写 assistantModelPref。见 `src/workbench/ai/v4/useAgentPanelV4Data.ts:150`、`src/workbench/ai/v4/useAgentPanelV4Data.ts:154`、`src/workbench/ai/v4/useAgentPanelV4Data.ts:324`、`src/workbench/ai/v4/useAgentPanelV4Data.ts:325`、`src/workbench/ai/v4/agentPanelV4ModelRows.ts:94`、`src/workbench/ai/v4/agentPanelV4ModelRows.ts:95`、`src/workbench/ai/v4/agentPanelV4ModelRows.ts:98`、`src/workbench/ai/v4/agentPanelV4ModelRows.ts:108`、`src/workbench/ai/v4/agentPanelV4ModelRows.ts:114`、`src/i18n/locales/agentPanelV4.ts:164`、`src/i18n/locales/agentPanelV4.ts:727`、`src/workbench/ai/v4/useAgentPanelV4Data.ts:337`。 |
| 两个界面的可选项 | 设置页取启用的目录行，Agent 菜单分别取启用的图／视频行。都调用 buildDefaultModelOptions，以 usable 和双段身份筛选，逐任务按媒介装项；自动行只给 label，手选行显示「模型 · 供应商」。此处没有逐 taskKind 核对 publishedModes，所以一行能选中，仍可能被主进程的模式校验拦下。见 `src/workbench/settings/AiModelsSection.tsx:87`、`src/workbench/ai/v4/useAgentPanelV4Data.ts:162`、`src/workbench/settings/DefaultGenerationModelsSection.tsx:45`、`src/workbench/ai/v4/agentPanelV4ModelRows.ts:68`、`src/workbench/settings/defaultGenerationModelOptions.ts:50`、`src/workbench/settings/defaultGenerationModelOptions.ts:61`、`src/workbench/settings/defaultGenerationModelOptions.ts:63`、`src/workbench/settings/defaultGenerationModelOptions.ts:70`、`electron/capabilityCore/generationDefaultModelResolver.ts:53`。 |
| 执行读者和升级旁路 | 除上述界面，画布预装、空卡、派生、分镜分别读取此快照；宿主的 Agent 模型索引和每次 planning 读同一磁盘文件，偏离已保存默认的回执也向它查询。并排安装首次从稳定版复制设置时，该文件在复制清单内，按原样复制，不转换字段。见 `src/workbench/generationCanvas/nodes/composerResidentData.ts:21`、`src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:175`、`src/workbench/generationCanvas/quickActions/deriveFromNode.ts:139`、`src/workbench/generationCanvas/agent/availableModels.ts:191`、`electron/capabilityCore/generationDefaultModelResolver.ts:78`、`electron/capabilityCore/liveGenerationRuntime.ts:125`、`electron/capabilityCore/mcpGenerationTools.ts:256`、`electron/capabilityCore/mcpGenerationTools.ts:302`、`electron/settings/sideBySideInstallSeed.ts:37`、`electron/settings/sideBySideInstallSeed.ts:122`。 |

**四行收两行的含义。** 现在已经有一份存储、两个设置入口，却有四个可独立设置的值。11-09 拍板允许旧四行不迁移，因此两行新值无需推断冲突的两个旧值，例如文生图选 A、改图选 B。设计稿可分别用「新装空设置」「带旧四键的升级安装」「已钉具体身份的历史镜头」核对结果。历史镜头自己的身份在生成时优先。见 `src/workbench/generationCanvas/agent/storyboardPlan.ts:266`、`src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:142`。

## 3. 目录能回答哪一种「推荐」

**四个任务的覆盖为 0/4。** 查了持久化 Model（含开放的 meta）、档案类型、图像和视频注册表、种子目录、渲染侧选择及宿主消费点。没有查到可对这四个任务返回「最强模型身份」的逐功能声明。现有概念登记把主进程列为已保存默认的解释者，并把渲染侧各自匹配列为待收口。这个登记描述的是现状和已有方向，实际执行结果见第 1 节。见 `electron/catalog/types.ts:304`、`electron/catalog/types.ts:313`、`electron/shared/modelArchetypes/types.ts:131`、`electron/shared/modelArchetypes/builtInCatalog.ts:63`、`docs/engineering/concept-owners/generation.declared-default-model.json:9`。

| 已有字段／算法 | 覆盖范围，以及它能回答的问题 |
| --- | --- |
| defaultModeId、defaultVariantId、catalogModelKey、transportTaskKind | 已确定某个模型后，分别取模型内的默认方式、变体、目录基础行和传输任务。例如 GPT Image 2.6 有文生图和改图方式，档案内默认 t2i。注册顺序也可能影响分镜名称阶梯命中的第一个成员。见 `electron/shared/modelArchetypes/types.ts:141`、`electron/shared/modelArchetypes/types.ts:149`、`electron/shared/modelArchetypes/types.ts:155`、`electron/shared/modelArchetypes/types.ts:162`、`electron/shared/modelArchetypes/gptImage26.ts:33`、`electron/shared/modelArchetypes/gptImage26.ts:37`、`electron/shared/modelArchetypes/gptImage26.ts:48`。 |
| catalogLifecycle | 种子表按型号列多个旗舰，curatedCatalogLifecycle 给出档位，seed 时写入 meta。界面的生命周期顺序是旗舰、性价比、陪跑、退役；同档可以有多项。见 `electron/catalog/seedModelIdentity.ts:20`、`electron/catalog/seedModelIdentity.ts:172`、`electron/catalog/seedBuiltins.ts:483`、`src/config/modelIdentity.ts:41`。 |
| 模型框默认行序和用户偏好 | 内置可见表的视频首项是 doubao-seedance-2.5，图片首项是 gpt-image-2.6-flare，另有默认收起表。用户的 modelOrder、hiddenModelIds、preferredVendorByModel 保存在模型框合同里，渲染时处理可见性、顺序和同一行的家。决定 4 要保住的就是这份名单与顺序；移动一行或收起一行不应重新定义某功能的推荐。见 `src/config/modelBoxDefaults.ts:22`、`src/config/modelBoxDefaults.ts:41`、`src/config/modelBoxDefaults.ts:55`、`electron/shared/contracts/modelBoxPreference.ts:25`、`electron/shared/contracts/modelBoxPreference.ts:35`、`electron/shared/contracts/modelBoxPreference.ts:41`、`src/workbench/common/useDedupedModelSelect.ts:280`、`src/workbench/common/useDedupedModelSelect.ts:283`、`src/workbench/common/useDedupedModelSelect.ts:289`。 |
| 全局「默认走哪家」与同模型识别 | 当前设置页仅从供应商健康列表排除 needs-key 和 disabled，把剩余的家传给排序组件；少于两家隐藏。两家各自只提供不同模型也能过这个条件。已有的同模型分组用 canonicalModelId，缺显式值时按归一化显示名等回退；组中留着 providers。比较供应商时用户顺序优先，再按官方／内置中转／自接分级。同一行还可记住用户手选的家。决定 3 的判据应是**同一个可执行模型**的可用家数；查验时用“两家仅各有一个不同模型”和“两家都能跑同一型号、同一功能”这对反例。见 `src/workbench/settings/AiModelsSection.tsx:162`、`src/workbench/settings/AiModelsSection.tsx:179`、`src/workbench/settings/VendorPreferenceOrderSection.tsx:46`、`src/config/modelIdentity.ts:95`、`src/config/modelIdentity.ts:152`、`src/config/modelBoxPreference.ts:64`、`electron/shared/contracts/vendorPreference.ts:5`、`electron/shared/contracts/vendorPreference.ts:67`。 |
| 已有逐用途标记 | APIMart 文本种子给 DeepSeek V4 Pro／Flash 的 meta.autoTextPriority 分别为 2／1，在同一家内部参与自动排序。Gemini 3.5 Flash 的 meta.autoImageReader 用于视频拆解读帧，在读图能力同档时优先。这是目录声明用途的真实先例，覆盖文本与读图。见 `electron/catalog/apimartTexts.ts:197`、`electron/catalog/apimartTexts.ts:258`、`electron/ai/textBrainResolver.ts:31`、`electron/catalog/apimartTexts.ts:264`、`electron/catalog/apimartTexts.ts:267`、`electron/ai/textBrainResolver.ts:189`。 |
| 视频 recommendation 和计划预演 | 视频推荐分数来自参考类型、意图、时长和可选家族加分。预览调用先限制到当前候选的供应商和型号，再对方式打分。另有无状态计划预演：纯函数试镜头点名 → 输入默认 → 首候选，规划入口只送镜头、视频候选和目标。两条都不能作为四种生成任务的目录首选。见 `electron/shared/videoCapabilities/recommendation.ts:168`、`electron/shared/videoCapabilities/recommendation.ts:250`、`electron/shared/videoCapabilities/recommendation.ts:265`、`electron/capabilityCore/mcpGenerationVideoResolve.ts:116`、`electron/capabilityCore/mcpGenerationVideoResolve.ts:128`、`electron/capabilityCore/mcpGenerationTools.ts:443`、`electron/shared/videoCapabilities/planResolver.ts:167`、`electron/capabilityCore/mcpGenerationTools.ts:202`。 |

对决定 1，设计稿里「自动（模型名）」指向的需要是**能执行这次功能**的具体身份。用户偏好可以只有图片／视频两项；同一图片模型能文生图，不推出它也能改图。目录中哪个型号是每项功能的首选，以及首选在本机不可用时展示什么，本基线没有给出答案。直接拿菜单首项、旗舰名或品牌阶梯填样张，会把不同规则写成同一个承诺。

## 4. 公开先例及对五项决定的影响

| 官方出处、查询日期 | 用户看到什么 | 对 Nomi 决定的影响（本次判断） |
| --- | --- | --- |
| Midjourney，2026-11-27。[Version](https://docs.midjourney.com/hc/en-us/articles/32199405667853-Version) · [Creation Settings in Discord](https://docs.midjourney.com/hc/en-us/articles/32868982949517-Creation-Settings-in-Discord) | 文档点名默认版本 V8.2。用户可以在版本下拉设后续出图的默认值，网站和 Discord 设置同步，单次提示也可显式指定版本。 | **1、2**：新卡与 Agent 可以直接写出同一默认身份；跨入口改一次生效，同时保留单镜点名的含义。 |
| Runway，2026-11-27。[Creating with Runway Agent](https://help.runwayml.com/hc/en-us/articles/51601639579667-Creating-with-Runway-Agent) | Agent 的生成偏好可选质量、速度、成本等；要求生成前确认时，计划逐步显示模型、提示词和估价。对话模型另有选择器。 | **1、2**：创作者在生成前就能确认实际用谁。图片和视频的默认值放在两行，对话模型保持自己的含义。Nomi 的质量选择依据是用户拍板的逐功能目录声明。 |
| Adobe Photoshop，2026-11-27。[Photoshop on desktop release notes](https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html) | 上下文任务栏可以浏览 Firefly 和合作模型并查看说明、能力与花费。官方还记录了升级安装意外保留旧默认 Firefly Image 3，预期应切到 Firefly Fill & Expand。 | **4、5**：手选列表可以容纳多个模型；更换系统默认无须重排列表。Nomi 已决定不迁移旧四键，升级用户第一次新建卡能看到什么是独立验收样本。Adobe 的案例证明升级路径值得单独核对。 |
| Hugging Face Inference Providers，2026-11-27。[Inference Providers](https://huggingface.co/docs/inference-providers/en/index) | 调用示例先写模型 ID，缺省在服务该模型的供应商中路由，也可追加策略或指定某一家。文档展示的是调用形式。 | **3**：先确定模型，再问它有几家可用；只有后一个问题有多种答案时显示选家。这是对 Nomi 显示条件的推论。 |

## 核验与完整数门记录

对同一基线运行现有的 settings 合同、画布默认匹配、宿主默认解析、MCP 规划四份测试，结果为 `Test Files 4 passed (4)`、`Tests 80 passed (80)`，退出 0。其中 MCP 用例覆盖漏点名被拒，随后点名仅建草稿。此次未做真机界面或实际供应商调用。

下面保留每条命令的完整标准错误（带行号的出现位置）和标准输出（JSON 门表）。默认扫描 src、electron，不含测试文件。工具按标识符和名称前缀计数，类型引用、设计实验和纯计算也可能入表，字符串 IPC、对象字面量定义另由上文代码行补证。例如 taskParamsGuard 内同名的 byTaskKind 属于任务参数；真正写偏好的两个界面和磁盘写口见第 2 节。同一文件、同一符号的多次出现只计一扇门。

<details>
<summary>画布和分镜</summary>

```sh
node scripts/door-map.mjs useNodeModelAutoSelect deriveGenerationDefaultTaskKind resolveDefaultModelOption chooseDefaultModelOption pickDerivedModel findUpscaleModelOption preferredDefaultModel pickSavedDefaultModel pickStoryboardDefaultModel resolveStoryboardImageDefault resolveStoryboardVideoDefault runStoryboardBatch confirmAndRunPlan normalizeStoryboardAnchorDefaults runGroupGenerate
```

```text
数门：chooseDefaultModelOption, confirmAndRunPlan, deriveGenerationDefaultTaskKind, findUpscaleModelOption, normalizeStoryboardAnchorDefaults, pickDerivedModel, pickSavedDefaultModel, pickStoryboardDefaultModel, preferredDefaultModel, resolveDefaultModelOption, resolveStoryboardImageDefault, resolveStoryboardVideoDefault, runGroupGenerate, runStoryboardBatch, useNodeModelAutoSelect
  扫了 3214 个文件（roots=src,electron，不含测试）
  写入口 18 扇 · 读入口 12 扇 · 共 30 扇（39 处出现——同一个文件里调多次仍算一扇门）
  [read] src/workbench/capability/capabilityApplyHandler.ts:562 resolveStoryboardImageDefault
  [read] src/workbench/capability/capabilityApplyHandler.ts:563 resolveStoryboardVideoDefault
  [read] src/workbench/creation/storyboard/exec/storyboardRowActions.ts:86 resolveStoryboardImageDefault
  [read] src/workbench/creation/storyboard/exec/storyboardRowActions.ts:87 resolveStoryboardVideoDefault
  [read] src/workbench/creation/storyboard/shotRow/StoryboardComposerParams.tsx:51 resolveStoryboardImageDefault
  [read] src/workbench/creation/storyboard/shotRow/StoryboardComposerParams.tsx:51 resolveStoryboardVideoDefault
  [read] src/workbench/generationCanvas/nodes/sameCapabilityAlternative.ts:15 findUpscaleModelOption
  [read] src/workbench/generationCanvas/nodes/sameCapabilityAlternative.ts:18 findUpscaleModelOption
  [read] src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:175 resolveDefaultModelOption
  [read] src/workbench/generationCanvas/quickActions/deriveFromNode.ts:135 findUpscaleModelOption
  [read] src/workbench/generationCanvas/quickActions/deriveFromNode.ts:138 findUpscaleModelOption
  [read] src/workbench/generationCanvas/quickActions/deriveFromNode.ts:142 findUpscaleModelOption
  [read] src/workbench/generationCanvas/quickActions/useQuickActionHost.ts:47 findUpscaleModelOption
  [read] src/workbench/production/ProductionCanvasLandingHost.tsx:89 confirmAndRunPlan
  [read] src/workbench/production/ProductionCanvasLandingHost.tsx:91 runGroupGenerate
  [write] src/workbench/capability/storyboardPresent.ts:94 runStoryboardBatch
  [write] src/workbench/creation/storyboard/exec/storyboardRowActions.ts:266 confirmAndRunPlan
  [write] src/workbench/creation/storyboard/exec/storyboardRowActions.ts:319 confirmAndRunPlan
  [write] src/workbench/creation/storyboard/exec/storyboardRowActions.ts:581 confirmAndRunPlan
  [write] src/workbench/creation/storyboard/exec/storyboardRowActions.ts:639 confirmAndRunPlan
  [write] src/workbench/creation/storyboard/StoryboardPlanEditor.tsx:399 runStoryboardBatch
  [write] src/workbench/creation/storyboard/StoryboardPlanEditor.tsx:410 runStoryboardBatch
  [write] src/workbench/generation/list/GenerationListSectionHeader.tsx:100 runGroupGenerate
  [write] src/workbench/generationCanvas/agent/applyCanvasToolCall.ts:326 normalizeStoryboardAnchorDefaults
  [write] src/workbench/generationCanvas/agent/availableModels.ts:195 pickSavedDefaultModel
  [write] src/workbench/generationCanvas/agent/availableModels.ts:195 pickStoryboardDefaultModel
  [write] src/workbench/generationCanvas/agent/availableModels.ts:217 preferredDefaultModel
  [write] src/workbench/generationCanvas/agent/availableModels.ts:244 preferredDefaultModel
  [write] src/workbench/generationCanvas/agent/runStoryboardPlanner.ts:56 normalizeStoryboardAnchorDefaults
  [write] src/workbench/generationCanvas/agent/storyboardAnchorPolicy.ts:81 pickStoryboardDefaultModel
  [write] src/workbench/generationCanvas/components/batchPlanPreview.ts:56 confirmAndRunPlan
  [write] src/workbench/generationCanvas/components/batchPlanPreview.ts:308 confirmAndRunPlan
  [write] src/workbench/generationCanvas/components/groupGenerate.ts:109 confirmAndRunPlan
  [write] src/workbench/generationCanvas/components/useCanvasFrameActions.ts:131 runGroupGenerate
  [write] src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:246 useNodeModelAutoSelect
  [write] src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:168 deriveGenerationDefaultTaskKind
  [write] src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:176 chooseDefaultModelOption
  [write] src/workbench/generationCanvas/quickActions/deriveFromNode.ts:155 pickDerivedModel
  [write] src/workbench/taskCenter/TaskCenterPanel.tsx:121 confirmAndRunPlan

把下面这段粘进 docs/fixes/<日期>-<题目>.root-cause.json 的 "doors"；
门 ≥2 扇而本次没合并它们，必须在 "door_reduction.why_not" 里写清为什么。
[
  {
    "kind": "read",
    "path": "src/workbench/capability/capabilityApplyHandler.ts",
    "symbol": "resolveStoryboardImageDefault"
  },
  {
    "kind": "read",
    "path": "src/workbench/capability/capabilityApplyHandler.ts",
    "symbol": "resolveStoryboardVideoDefault"
  },
  {
    "kind": "read",
    "path": "src/workbench/creation/storyboard/exec/storyboardRowActions.ts",
    "symbol": "resolveStoryboardImageDefault"
  },
  {
    "kind": "read",
    "path": "src/workbench/creation/storyboard/exec/storyboardRowActions.ts",
    "symbol": "resolveStoryboardVideoDefault"
  },
  {
    "kind": "read",
    "path": "src/workbench/creation/storyboard/shotRow/StoryboardComposerParams.tsx",
    "symbol": "resolveStoryboardImageDefault"
  },
  {
    "kind": "read",
    "path": "src/workbench/creation/storyboard/shotRow/StoryboardComposerParams.tsx",
    "symbol": "resolveStoryboardVideoDefault"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/nodes/sameCapabilityAlternative.ts",
    "symbol": "findUpscaleModelOption"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts",
    "symbol": "resolveDefaultModelOption"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/quickActions/deriveFromNode.ts",
    "symbol": "findUpscaleModelOption"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/quickActions/useQuickActionHost.ts",
    "symbol": "findUpscaleModelOption"
  },
  {
    "kind": "read",
    "path": "src/workbench/production/ProductionCanvasLandingHost.tsx",
    "symbol": "confirmAndRunPlan"
  },
  {
    "kind": "read",
    "path": "src/workbench/production/ProductionCanvasLandingHost.tsx",
    "symbol": "runGroupGenerate"
  },
  {
    "kind": "write",
    "path": "src/workbench/capability/storyboardPresent.ts",
    "symbol": "runStoryboardBatch"
  },
  {
    "kind": "write",
    "path": "src/workbench/creation/storyboard/exec/storyboardRowActions.ts",
    "symbol": "confirmAndRunPlan"
  },
  {
    "kind": "write",
    "path": "src/workbench/creation/storyboard/StoryboardPlanEditor.tsx",
    "symbol": "runStoryboardBatch"
  },
  {
    "kind": "write",
    "path": "src/workbench/generation/list/GenerationListSectionHeader.tsx",
    "symbol": "runGroupGenerate"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/agent/applyCanvasToolCall.ts",
    "symbol": "normalizeStoryboardAnchorDefaults"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/agent/availableModels.ts",
    "symbol": "pickSavedDefaultModel"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/agent/availableModels.ts",
    "symbol": "pickStoryboardDefaultModel"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/agent/availableModels.ts",
    "symbol": "preferredDefaultModel"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/agent/runStoryboardPlanner.ts",
    "symbol": "normalizeStoryboardAnchorDefaults"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/agent/storyboardAnchorPolicy.ts",
    "symbol": "pickStoryboardDefaultModel"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/components/batchPlanPreview.ts",
    "symbol": "confirmAndRunPlan"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/components/groupGenerate.ts",
    "symbol": "confirmAndRunPlan"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/components/useCanvasFrameActions.ts",
    "symbol": "runGroupGenerate"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/nodes/NodeParameterControls.tsx",
    "symbol": "useNodeModelAutoSelect"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts",
    "symbol": "deriveGenerationDefaultTaskKind"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts",
    "symbol": "chooseDefaultModelOption"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/quickActions/deriveFromNode.ts",
    "symbol": "pickDerivedModel"
  },
  {
    "kind": "write",
    "path": "src/workbench/taskCenter/TaskCenterPanel.tsx",
    "symbol": "confirmAndRunPlan"
  }
]
```

</details>

<details>
<summary>Agent 与 MCP</summary>

```sh
node scripts/door-map.mjs resolveDraftShotModels readLaneDeclaredDefaults formatLaneModelIndex readGenerationDefaultModelResolver createGenerationDefaultModelResolver defaultModelForTaskKind semanticCandidateFromParams draftShotFromPlan draftShotFromStoryboard resolvePatchedModel namedCatalogModel buildOperationCreateParams createDraftAdmission declaredDefaultDeviations createGenerationPlanningHandler
```

```text
数门：buildOperationCreateParams, createDraftAdmission, createGenerationDefaultModelResolver, createGenerationPlanningHandler, declaredDefaultDeviations, defaultModelForTaskKind, draftShotFromPlan, draftShotFromStoryboard, formatLaneModelIndex, namedCatalogModel, readGenerationDefaultModelResolver, readLaneDeclaredDefaults, resolveDraftShotModels, resolvePatchedModel, semanticCandidateFromParams
  扫了 3214 个文件（roots=src,electron，不含测试）
  写入口 17 扇 · 读入口 10 扇 · 共 27 扇（38 处出现——同一个文件里调多次仍算一扇门）
  [read] electron/agentLane/laneDesktopModelDefaults.ts:13 readGenerationDefaultModelResolver
  [read] electron/agentLane/laneDesktopRuntime.ts:167 readLaneDeclaredDefaults
  [read] electron/agentLane/laneDesktopRuntime.ts:206 readLaneDeclaredDefaults
  [read] electron/agentLane/laneVerbTransport.ts:107 resolveDraftShotModels
  [read] electron/capabilityCore/generationDraftAdmission.ts:110 defaultModelForTaskKind
  [read] electron/capabilityCore/generationPlanPatch.ts:75 defaultModelForTaskKind
  [read] electron/capabilityCore/generationPlanPatch.ts:75 resolvePatchedModel
  [read] electron/capabilityCore/mcpGenerationMultiShot.ts:181 defaultModelForTaskKind
  [read] electron/capabilityCore/mcpGenerationMultiShot.ts:238 defaultModelForTaskKind
  [read] electron/capabilityCore/mcpGenerationMultiShot.ts:322 defaultModelForTaskKind
  [read] electron/capabilityCore/mcpGenerationTools.ts:114 createDraftAdmission
  [read] electron/capabilityCore/mcpGenerationTools.ts:258 defaultModelForTaskKind
  [read] electron/capabilityCore/mcpGenerationTools.ts:302 defaultModelForTaskKind
  [read] electron/capabilityCore/mcpGenerationTools.ts:412 defaultModelForTaskKind
  [read] electron/capabilityCore/mcpGenerationTools.ts:608 defaultModelForTaskKind
  [read] electron/capabilityCore/mcpGenerationTools.ts:665 defaultModelForTaskKind
  [read] electron/capabilityCore/semanticGenerationCandidate.ts:296 defaultModelForTaskKind
  [write] electron/agentLane/laneContextBudget.mts:46 formatLaneModelIndex
  [write] electron/agentLane/laneHost.mts:404 formatLaneModelIndex
  [write] electron/agentLane/laneModelContext.ts:90 formatLaneModelIndex
  [write] electron/capabilityCore/agentPanelSpendConfirmTestUtils.ts:336 createGenerationPlanningHandler
  [write] electron/capabilityCore/externalAgentGateTestUtils.ts:112 createGenerationPlanningHandler
  [write] electron/capabilityCore/generationDefaultModelResolver.ts:78 createGenerationDefaultModelResolver
  [write] electron/capabilityCore/generationDomain.ts:138 createGenerationPlanningHandler
  [write] electron/capabilityCore/generationDraftAdmission.ts:106 semanticCandidateFromParams
  [write] electron/capabilityCore/liveGenerationRuntime.ts:125 createGenerationDefaultModelResolver
  [write] electron/capabilityCore/mcpGenerationMultiShot.ts:176 semanticCandidateFromParams
  [write] electron/capabilityCore/mcpGenerationMultiShot.ts:213 semanticCandidateFromParams
  [write] electron/capabilityCore/mcpGenerationMultiShot.ts:349 draftShotFromPlan
  [write] electron/capabilityCore/mcpGenerationMultiShot.ts:426 draftShotFromStoryboard
  [write] electron/capabilityCore/mcpGenerationToolCatalog.ts:79 buildOperationCreateParams
  [write] electron/capabilityCore/mcpGenerationTools.ts:256 declaredDefaultDeviations
  [write] electron/capabilityCore/mcpGenerationTools.ts:302 declaredDefaultDeviations
  [write] electron/capabilityCore/mcpGenerationTools.ts:613 createDraftAdmission
  [write] electron/capabilityCore/semanticGenerationCandidate.ts:337 namedCatalogModel
  [write] electron/capabilityCore/semanticGenerationCandidate.ts:350 namedCatalogModel
  [write] electron/capabilityCore/semanticGenerationCandidate.ts:475 namedCatalogModel
  [write] electron/capabilityCore/semanticGenerationCandidate.ts:478 defaultModelForTaskKind

把下面这段粘进 docs/fixes/<日期>-<题目>.root-cause.json 的 "doors"；
门 ≥2 扇而本次没合并它们，必须在 "door_reduction.why_not" 里写清为什么。
[
  {
    "kind": "read",
    "path": "electron/agentLane/laneDesktopModelDefaults.ts",
    "symbol": "readGenerationDefaultModelResolver"
  },
  {
    "kind": "read",
    "path": "electron/agentLane/laneDesktopRuntime.ts",
    "symbol": "readLaneDeclaredDefaults"
  },
  {
    "kind": "read",
    "path": "electron/agentLane/laneVerbTransport.ts",
    "symbol": "resolveDraftShotModels"
  },
  {
    "kind": "read",
    "path": "electron/capabilityCore/generationDraftAdmission.ts",
    "symbol": "defaultModelForTaskKind"
  },
  {
    "kind": "read",
    "path": "electron/capabilityCore/generationPlanPatch.ts",
    "symbol": "defaultModelForTaskKind"
  },
  {
    "kind": "read",
    "path": "electron/capabilityCore/generationPlanPatch.ts",
    "symbol": "resolvePatchedModel"
  },
  {
    "kind": "read",
    "path": "electron/capabilityCore/mcpGenerationMultiShot.ts",
    "symbol": "defaultModelForTaskKind"
  },
  {
    "kind": "read",
    "path": "electron/capabilityCore/mcpGenerationTools.ts",
    "symbol": "createDraftAdmission"
  },
  {
    "kind": "read",
    "path": "electron/capabilityCore/mcpGenerationTools.ts",
    "symbol": "defaultModelForTaskKind"
  },
  {
    "kind": "read",
    "path": "electron/capabilityCore/semanticGenerationCandidate.ts",
    "symbol": "defaultModelForTaskKind"
  },
  {
    "kind": "write",
    "path": "electron/agentLane/laneContextBudget.mts",
    "symbol": "formatLaneModelIndex"
  },
  {
    "kind": "write",
    "path": "electron/agentLane/laneHost.mts",
    "symbol": "formatLaneModelIndex"
  },
  {
    "kind": "write",
    "path": "electron/agentLane/laneModelContext.ts",
    "symbol": "formatLaneModelIndex"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/agentPanelSpendConfirmTestUtils.ts",
    "symbol": "createGenerationPlanningHandler"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/externalAgentGateTestUtils.ts",
    "symbol": "createGenerationPlanningHandler"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/generationDefaultModelResolver.ts",
    "symbol": "createGenerationDefaultModelResolver"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/generationDomain.ts",
    "symbol": "createGenerationPlanningHandler"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/generationDraftAdmission.ts",
    "symbol": "semanticCandidateFromParams"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/liveGenerationRuntime.ts",
    "symbol": "createGenerationDefaultModelResolver"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/mcpGenerationMultiShot.ts",
    "symbol": "semanticCandidateFromParams"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/mcpGenerationMultiShot.ts",
    "symbol": "draftShotFromPlan"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/mcpGenerationMultiShot.ts",
    "symbol": "draftShotFromStoryboard"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/mcpGenerationToolCatalog.ts",
    "symbol": "buildOperationCreateParams"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/mcpGenerationTools.ts",
    "symbol": "declaredDefaultDeviations"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/mcpGenerationTools.ts",
    "symbol": "createDraftAdmission"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/semanticGenerationCandidate.ts",
    "symbol": "namedCatalogModel"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/semanticGenerationCandidate.ts",
    "symbol": "defaultModelForTaskKind"
  }
]
```

</details>

<details>
<summary>四行偏好的全部读写</summary>

```sh
node scripts/door-map.mjs GENERATION_DEFAULT_TASK_KINDS byTaskKind normalizeGenerationModelDefaults generationModelDefaultsSettingsPath readGenerationModelDefaults writeGenerationModelDefaults registerGenerationModelDefaultsIpc getGenerationModelDefaults loadGenerationModelDefaults saveGenerationModelDefaults subscribeGenerationModelDefaults generationModelDefaultsLoaded generationModelDefaults buildDefaultModelOptions setGenerationDefault
```

```text
数门：GENERATION_DEFAULT_TASK_KINDS, buildDefaultModelOptions, byTaskKind, generationModelDefaults, generationModelDefaultsLoaded, generationModelDefaultsSettingsPath, getGenerationModelDefaults, loadGenerationModelDefaults, normalizeGenerationModelDefaults, readGenerationModelDefaults, registerGenerationModelDefaultsIpc, saveGenerationModelDefaults, setGenerationDefault, subscribeGenerationModelDefaults, writeGenerationModelDefaults
  扫了 3214 个文件（roots=src,electron，不含测试）
  写入口 8 扇 · 读入口 27 扇 · 共 35 扇（47 处出现——同一个文件里调多次仍算一扇门）
  [read] electron/agentLane/laneDesktopModelDefaults.ts:14 GENERATION_DEFAULT_TASK_KINDS
  [read] electron/capabilityCore/generationDefaultModelResolver.ts:59 byTaskKind
  [read] electron/capabilityCore/generationDefaultModelResolver.ts:78 readGenerationModelDefaults
  [read] electron/capabilityCore/liveGenerationRuntime.ts:125 readGenerationModelDefaults
  [read] electron/catalog/taskParamsGuard.ts:84 byTaskKind
  [read] electron/catalog/taskParamsGuard.ts:87 byTaskKind
  [read] electron/catalog/taskParamsGuard.ts:91 byTaskKind
  [read] electron/settings/generationModelDefaultsIpc.ts:17 readGenerationModelDefaults
  [read] electron/settings/generationModelDefaultsIpc.ts:18 writeGenerationModelDefaults
  [read] electron/shared/agentCapabilities/verbs/draftShotsProjection.ts:201 GENERATION_DEFAULT_TASK_KINDS
  [read] electron/shared/contracts/generationModelDefaultsContract.ts:23 GENERATION_DEFAULT_TASK_KINDS
  [read] electron/shared/contracts/generationModelDefaultsContract.ts:51 GENERATION_DEFAULT_TASK_KINDS
  [read] electron/shared/contracts/generationModelDefaultsContract.ts:76 byTaskKind
  [read] electron/shared/contracts/generationModelDefaultsContract.ts:85 byTaskKind
  [read] electron/shared/contracts/generationModelDefaultsContract.ts:87 byTaskKind
  [read] src/workbench/ai/v4/useAgentPanelV4Data.ts:149 subscribeGenerationModelDefaults
  [read] src/workbench/ai/v4/useAgentPanelV4Data.ts:150 getGenerationModelDefaults
  [read] src/workbench/ai/v4/useAgentPanelV4Data.ts:151 getGenerationModelDefaults
  [read] src/workbench/ai/v4/useAgentPanelV4Data.ts:154 loadGenerationModelDefaults
  [read] src/workbench/ai/v4/useAgentPanelV4Data.ts:322 getGenerationModelDefaults
  [read] src/workbench/generationCanvas/agent/availableModels.ts:191 loadGenerationModelDefaults
  [read] src/workbench/generationCanvas/model/generationModelDefaults.ts:66 byTaskKind
  [read] src/workbench/generationCanvas/model/generationModelDefaults.ts:77 generationModelDefaults
  [read] src/workbench/generationCanvas/model/generationModelDefaults.ts:94 generationModelDefaults
  [read] src/workbench/generationCanvas/nodes/composerResidentData.ts:21 loadGenerationModelDefaults
  [read] src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:132 subscribeGenerationModelDefaults
  [read] src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:133 generationModelDefaultsLoaded
  [read] src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:134 generationModelDefaultsLoaded
  [read] src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:137 loadGenerationModelDefaults
  [read] src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:175 getGenerationModelDefaults
  [read] src/workbench/generationCanvas/quickActions/deriveFromNode.ts:139 getGenerationModelDefaults
  [read] src/workbench/settings/AiModelsSection.tsx:97 subscribeGenerationModelDefaults
  [read] src/workbench/settings/AiModelsSection.tsx:98 getGenerationModelDefaults
  [read] src/workbench/settings/AiModelsSection.tsx:99 getGenerationModelDefaults
  [read] src/workbench/settings/AiModelsSection.tsx:102 loadGenerationModelDefaults
  [read] src/workbench/settings/defaultGenerationModelOptions.ts:59 GENERATION_DEFAULT_TASK_KINDS
  [read] src/workbench/settings/DefaultGenerationModelsSection.tsx:71 GENERATION_DEFAULT_TASK_KINDS
  [write] electron/settings/generationModelDefaultsSettings.ts:27 normalizeGenerationModelDefaults
  [write] electron/settings/generationModelDefaultsSettings.ts:28 generationModelDefaultsSettingsPath
  [write] electron/settings/generationModelDefaultsSettings.ts:33 normalizeGenerationModelDefaults
  [write] electron/settings/generationModelDefaultsSettings.ts:34 generationModelDefaultsSettingsPath
  [write] electron/settings/registerSettingsIpc.ts:23 registerGenerationModelDefaultsIpc
  [write] src/workbench/ai/v4/agentPanelV4ModelRows.ts:68 buildDefaultModelOptions
  [write] src/workbench/ai/v4/agentPanelV4ModelRows.ts:114 setGenerationDefault
  [write] src/workbench/ai/v4/useAgentPanelV4Data.ts:325 saveGenerationModelDefaults
  [write] src/workbench/settings/AiModelsSection.tsx:105 saveGenerationModelDefaults
  [write] src/workbench/settings/DefaultGenerationModelsSection.tsx:45 buildDefaultModelOptions

把下面这段粘进 docs/fixes/<日期>-<题目>.root-cause.json 的 "doors"；
门 ≥2 扇而本次没合并它们，必须在 "door_reduction.why_not" 里写清为什么。
[
  {
    "kind": "read",
    "path": "electron/agentLane/laneDesktopModelDefaults.ts",
    "symbol": "GENERATION_DEFAULT_TASK_KINDS"
  },
  {
    "kind": "read",
    "path": "electron/capabilityCore/generationDefaultModelResolver.ts",
    "symbol": "byTaskKind"
  },
  {
    "kind": "read",
    "path": "electron/capabilityCore/generationDefaultModelResolver.ts",
    "symbol": "readGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "electron/capabilityCore/liveGenerationRuntime.ts",
    "symbol": "readGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "electron/catalog/taskParamsGuard.ts",
    "symbol": "byTaskKind"
  },
  {
    "kind": "read",
    "path": "electron/settings/generationModelDefaultsIpc.ts",
    "symbol": "readGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "electron/settings/generationModelDefaultsIpc.ts",
    "symbol": "writeGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "electron/shared/agentCapabilities/verbs/draftShotsProjection.ts",
    "symbol": "GENERATION_DEFAULT_TASK_KINDS"
  },
  {
    "kind": "read",
    "path": "electron/shared/contracts/generationModelDefaultsContract.ts",
    "symbol": "GENERATION_DEFAULT_TASK_KINDS"
  },
  {
    "kind": "read",
    "path": "electron/shared/contracts/generationModelDefaultsContract.ts",
    "symbol": "byTaskKind"
  },
  {
    "kind": "read",
    "path": "src/workbench/ai/v4/useAgentPanelV4Data.ts",
    "symbol": "subscribeGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "src/workbench/ai/v4/useAgentPanelV4Data.ts",
    "symbol": "getGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "src/workbench/ai/v4/useAgentPanelV4Data.ts",
    "symbol": "loadGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/agent/availableModels.ts",
    "symbol": "loadGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/model/generationModelDefaults.ts",
    "symbol": "byTaskKind"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/model/generationModelDefaults.ts",
    "symbol": "generationModelDefaults"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/nodes/composerResidentData.ts",
    "symbol": "loadGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts",
    "symbol": "subscribeGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts",
    "symbol": "generationModelDefaultsLoaded"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts",
    "symbol": "loadGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts",
    "symbol": "getGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "src/workbench/generationCanvas/quickActions/deriveFromNode.ts",
    "symbol": "getGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "src/workbench/settings/AiModelsSection.tsx",
    "symbol": "subscribeGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "src/workbench/settings/AiModelsSection.tsx",
    "symbol": "getGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "src/workbench/settings/AiModelsSection.tsx",
    "symbol": "loadGenerationModelDefaults"
  },
  {
    "kind": "read",
    "path": "src/workbench/settings/defaultGenerationModelOptions.ts",
    "symbol": "GENERATION_DEFAULT_TASK_KINDS"
  },
  {
    "kind": "read",
    "path": "src/workbench/settings/DefaultGenerationModelsSection.tsx",
    "symbol": "GENERATION_DEFAULT_TASK_KINDS"
  },
  {
    "kind": "write",
    "path": "electron/settings/generationModelDefaultsSettings.ts",
    "symbol": "normalizeGenerationModelDefaults"
  },
  {
    "kind": "write",
    "path": "electron/settings/generationModelDefaultsSettings.ts",
    "symbol": "generationModelDefaultsSettingsPath"
  },
  {
    "kind": "write",
    "path": "electron/settings/registerSettingsIpc.ts",
    "symbol": "registerGenerationModelDefaultsIpc"
  },
  {
    "kind": "write",
    "path": "src/workbench/ai/v4/agentPanelV4ModelRows.ts",
    "symbol": "buildDefaultModelOptions"
  },
  {
    "kind": "write",
    "path": "src/workbench/ai/v4/agentPanelV4ModelRows.ts",
    "symbol": "setGenerationDefault"
  },
  {
    "kind": "write",
    "path": "src/workbench/ai/v4/useAgentPanelV4Data.ts",
    "symbol": "saveGenerationModelDefaults"
  },
  {
    "kind": "write",
    "path": "src/workbench/settings/AiModelsSection.tsx",
    "symbol": "saveGenerationModelDefaults"
  },
  {
    "kind": "write",
    "path": "src/workbench/settings/DefaultGenerationModelsSection.tsx",
    "symbol": "buildDefaultModelOptions"
  }
]
```

</details>

<details>
<summary>容易被当成推荐的排序和预演</summary>

```sh
node scripts/door-map.mjs curatedCatalogLifecycle partitionByModelBoxPreference applyModelBoxDefaults rememberedVendorFor pickImplicitVendorMatch recommendVideoGeneration resolveGenerationPlan autoTextPriority autoImageReader deriveCanonicalModelId compareVendorLanding
```

```text
数门：applyModelBoxDefaults, autoImageReader, autoTextPriority, compareVendorLanding, curatedCatalogLifecycle, deriveCanonicalModelId, partitionByModelBoxPreference, pickImplicitVendorMatch, recommendVideoGeneration, rememberedVendorFor, resolveGenerationPlan
  扫了 3214 个文件（roots=src,electron，不含测试）
  写入口 18 扇 · 读入口 5 扇 · 共 23 扇（25 处出现——同一个文件里调多次仍算一扇门）
  [read] electron/ai/textBrainResolver.ts:17 autoTextPriority
  [read] electron/ai/textBrainResolver.ts:45 autoImageReader
  [read] electron/capabilityCore/generationDomain.ts:147 recommendVideoGeneration
  [read] electron/capabilityCore/mcpGenerationTools.ts:202 resolveGenerationPlan
  [read] electron/capabilityCore/mcpGenerationTools.ts:442 recommendVideoGeneration
  [write] electron/ai/textBrainResolver.ts:31 autoTextPriority
  [write] electron/capabilityCore/mcpGenerationTools.ts:443 recommendVideoGeneration
  [write] electron/catalog/seedBuiltins.ts:483 curatedCatalogLifecycle
  [write] electron/shared/contracts/vendorPreference.ts:82 compareVendorLanding
  [write] src/config/modelIdentity.ts:152 deriveCanonicalModelId
  [write] src/config/modelIdentity.ts:207 compareVendorLanding
  [write] src/config/modelIdentity.ts:228 compareVendorLanding
  [write] src/config/modelOptionResolvers.ts:76 pickImplicitVendorMatch
  [write] src/devlab/designLab/catalogLiveness/states/01-listing.tsx:23 curatedCatalogLifecycle
  [write] src/workbench/common/useDedupedModelSelect.ts:280 partitionByModelBoxPreference
  [write] src/workbench/common/useDedupedModelSelect.ts:283 applyModelBoxDefaults
  [write] src/workbench/common/useDedupedModelSelect.ts:289 rememberedVendorFor
  [write] src/workbench/common/useDedupedModelSelect.ts:454 pickImplicitVendorMatch
  [write] src/workbench/common/useDedupedModelSelect.ts:504 rememberedVendorFor
  [write] src/workbench/generationCanvas/agent/availableModels.ts:177 pickImplicitVendorMatch
  [write] src/workbench/generationCanvas/agent/plannedNodeMeta.ts:65 pickImplicitVendorMatch
  [write] src/workbench/generationCanvas/agent/storyboardAnchorPolicy.ts:80 pickImplicitVendorMatch
  [write] src/workbench/settings/modelBoxOrder.ts:32 rememberedVendorFor
  [write] src/workbench/settings/modelBoxOrder.ts:43 partitionByModelBoxPreference
  [write] src/workbench/settings/modelBoxOrder.ts:45 applyModelBoxDefaults

把下面这段粘进 docs/fixes/<日期>-<题目>.root-cause.json 的 "doors"；
门 ≥2 扇而本次没合并它们，必须在 "door_reduction.why_not" 里写清为什么。
[
  {
    "kind": "read",
    "path": "electron/ai/textBrainResolver.ts",
    "symbol": "autoTextPriority"
  },
  {
    "kind": "read",
    "path": "electron/ai/textBrainResolver.ts",
    "symbol": "autoImageReader"
  },
  {
    "kind": "read",
    "path": "electron/capabilityCore/generationDomain.ts",
    "symbol": "recommendVideoGeneration"
  },
  {
    "kind": "read",
    "path": "electron/capabilityCore/mcpGenerationTools.ts",
    "symbol": "resolveGenerationPlan"
  },
  {
    "kind": "read",
    "path": "electron/capabilityCore/mcpGenerationTools.ts",
    "symbol": "recommendVideoGeneration"
  },
  {
    "kind": "write",
    "path": "electron/ai/textBrainResolver.ts",
    "symbol": "autoTextPriority"
  },
  {
    "kind": "write",
    "path": "electron/capabilityCore/mcpGenerationTools.ts",
    "symbol": "recommendVideoGeneration"
  },
  {
    "kind": "write",
    "path": "electron/catalog/seedBuiltins.ts",
    "symbol": "curatedCatalogLifecycle"
  },
  {
    "kind": "write",
    "path": "electron/shared/contracts/vendorPreference.ts",
    "symbol": "compareVendorLanding"
  },
  {
    "kind": "write",
    "path": "src/config/modelIdentity.ts",
    "symbol": "deriveCanonicalModelId"
  },
  {
    "kind": "write",
    "path": "src/config/modelIdentity.ts",
    "symbol": "compareVendorLanding"
  },
  {
    "kind": "write",
    "path": "src/config/modelOptionResolvers.ts",
    "symbol": "pickImplicitVendorMatch"
  },
  {
    "kind": "write",
    "path": "src/devlab/designLab/catalogLiveness/states/01-listing.tsx",
    "symbol": "curatedCatalogLifecycle"
  },
  {
    "kind": "write",
    "path": "src/workbench/common/useDedupedModelSelect.ts",
    "symbol": "partitionByModelBoxPreference"
  },
  {
    "kind": "write",
    "path": "src/workbench/common/useDedupedModelSelect.ts",
    "symbol": "applyModelBoxDefaults"
  },
  {
    "kind": "write",
    "path": "src/workbench/common/useDedupedModelSelect.ts",
    "symbol": "rememberedVendorFor"
  },
  {
    "kind": "write",
    "path": "src/workbench/common/useDedupedModelSelect.ts",
    "symbol": "pickImplicitVendorMatch"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/agent/availableModels.ts",
    "symbol": "pickImplicitVendorMatch"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/agent/plannedNodeMeta.ts",
    "symbol": "pickImplicitVendorMatch"
  },
  {
    "kind": "write",
    "path": "src/workbench/generationCanvas/agent/storyboardAnchorPolicy.ts",
    "symbol": "pickImplicitVendorMatch"
  },
  {
    "kind": "write",
    "path": "src/workbench/settings/modelBoxOrder.ts",
    "symbol": "rememberedVendorFor"
  },
  {
    "kind": "write",
    "path": "src/workbench/settings/modelBoxOrder.ts",
    "symbol": "partitionByModelBoxPreference"
  },
  {
    "kind": "write",
    "path": "src/workbench/settings/modelBoxOrder.ts",
    "symbol": "applyModelBoxDefaults"
  }
]
```

</details>
