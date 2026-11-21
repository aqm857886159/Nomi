可用性有 1 处共享裁决和 5 组旁路，状态说法有 13 组出口 · 五条发现归为 2 类根因 · 推荐换一种做法、统一事实与展示；只读未实测，旧版安装包兼容性仍待验。
基线固定 `bd819e18c6`，目标 `2de3aac6d`；2026-11-17 只读复盘。未改仓库；统计只覆盖 API 密钥连接（内置/自接），本地运行时和账号登录不是本题。
**这一处的全图在哪**：表外，属于接模型边界；下文是用全仓 `git grep` 和调用链追踪出的门图，不填创作图格子。文件行号均指目标提交，历史门岗行号指基线。
**0. 一句话根因**：A 类是“配置能执行、检查有无通过、当前是哪条连接”分散在可写的字段和消费端里，口头唯一主人挡不住第二个答案；B 类是验收只覆盖部分消费口和源码升级，缺少能证伪这些承诺的真实闭环。
**1. 归类表（目录命中不等于验证同案；“别处带坏”仅指其它能力链的修复命中这些目录，不声称由本分支引起）**

|范围 / 提交|修什么 / 直接原因|归类|
|---|---|---|
|主线 `c83694a96`|公共临时托管改读设置|别处带坏：素材托管链，非验证回归|
|主线 `bdc666a19`|声明编译、收件校验统一入口|同一个毛病再修：接入三路各判|
|主线 `0c24a30e5`|Veo 比例与 GPT 自动尺寸再对齐|同一个毛病再修：界面与请求两份事实|
|主线 `15454378d`|五类档案参数与供应商协议纠偏|新功能收尾：目录声明纠偏|
|主线 `fcd1c4c52`|拒收提示必须点名真实可发方式|同一个毛病再修：拒发建议失真|
|主线 `43bc5eb11`|未知输入不误拒、缺槽另报|新功能收尾：发前输入判定|
|主线 `5e7ac998f`|DNS 测试与网络错误文字纠偏|新功能收尾：出网层删除后的整理|
|主线 `3c0e2022c`|删除目的地址拦截层|别处带坏：网络基础层误拒请求|
|主线 `5eb4868c5`|弹窗滚动与决定栏裁切|别处带坏：通用弹窗外壳|
|主线 `e63324597`|只收共享主人产出的参数结果|别处带坏：生成参数信任边界|
|主线 `a2ade3651`|工作流画布接管平移手势|新功能收尾：工作流编辑|
|主线 `02bc0316e`|读取全部供应商生成结果|别处带坏：产物读取链|
|主线 `187fc6ac2`|本机与脚本产物无项目先拒|别处带坏：产物落盘条件|
|主线 `4dcc49990`|移除上游不可用的文本型号|同一个毛病再修：清单与真实可用性不符|
|主线 `47471b1fe`|保留自动大脑、后备与独立读图清单|新功能收尾：文本型号更新|
|主线 `6337dc012`|参考请求遵守供应商限制与所选模式|同一个毛病再修：声明与发送失配|
|主线 `94e59b73b`|两发送口保留已选参考槽|别处带坏：参考传递链|
|主线 `da261bfea`|配音产物入项目、无项目先拒|别处带坏：音频落盘链|
|主线 `9adf9e7f0`|图片视频四处依官方文档纠偏|新功能收尾：型号目录更新|
|主线 `155cb9c9b`|文本声明、价目与付费抽检对齐|新功能收尾：文本目录更新|
|主线 `9207ad9ee`|两家 Muse Image 统一身份与档位|新功能收尾：跨家型号登记|
|主线 `199b99ae5`|付费抽检携项目号并支持续跑|别处带坏：抽检产物落盘|
|主线 `8fdf615cb`|付费抽检拆回复外层取任务号|新功能收尾：抽检脚本|
|目标 `12de5a880`|保存即用、解除诊断下架、一次性修旧数据|同一个毛病再修|
|目标 `9528a1dab`|半批成功后手动停用不再复活旧失败、改文案|同一个毛病再修|
|目标 `0201ec195`|合入当时主线，无独立修复|新功能收尾：同步|
|目标 `f786cd699`|三份旧版真实格式夹具与升级测试|新功能收尾：兼容证据|
|目标 `256b04b06`|加入验证不作可用门槛的文案扫描|同一个毛病再修|
|目标 `d4ecbe9a2`|夹具移目录、旧期望更新、压文件体积|新功能收尾：门岗收尾|
|目标 `bb9028122`|离线存钥走查改按启用与未验证语义|同一个毛病再修|
|目标 `4fc15b187`|离线列表改说验证没通过仍可使用|同一个毛病再修|
|目标 `713003904`|补一轮模型菜单性能原始结果|新功能收尾：证据|
|目标 `eb41bc393`|结构测试不再钉已删关闭别名|新功能收尾：测试同步|
|目标 `5ca5c87aa`|离线走查改走连接工作区与填钥卡|同一个毛病再修|
|目标 `841310abc`|删无基线的不出现断言|同一个毛病再修：验收靶子|
|目标 `0bfda9da7`|合入当时主线，无独立修复|新功能收尾：同步|
|目标 `153e4269f`|恢复明确拒收新钥、保留旧钥|回滚：恢复被首轮放宽的 401/403 拒收|
|目标 `fa51176b4`|离线走查定位正确同名返回按钮|同一个毛病再修：走查定位|
|目标 `504fb0157`|自接连接两徽标共取未验证绿点|同一个毛病再修|
|目标 `59c5916be`|合入当时主线，无独立修复|新功能收尾：同步|
|目标 `8209e02d2`|四张获批状态图登记清单|新功能收尾：设计证据|
|目标 `2de3aac6d`|逃逸账本改为已修|新功能收尾：结账；独立验收不支持完成结论|

计数：主线 23 个 fix/revert 命中、目标 19 个独有提交（含 3 次 merge，不把它们当三轮修复）；主线无 revert，目标有 1 次行为回滚。命令：`git log bd819e18c6 --since=2026-11-03 --until=2026-11-18 --no-merges --format="%h %s" -E --grep="^fix|^修复|^Revert" -- electron/ai/onboarding electron/catalog electron/shared/modelAvailability.ts electron/shared/modelPublication.ts src/ui/onboarding`；目标用 `git log --reverse --format="%h %s" bd819e18c6..2de3aac6d`；各自接 `wc -l`。日期窗口无 11-03 当天提交，故边界不改变总数。
**2. 为什么这一类一直出现：谁在算、读什么**（按职责组计数，不把调用同一函数算成新规则；⑪能选到、⑫点了=以为的适用，⑩意图参数对齐不适用）。
A1 共享裁决：`electron/shared/modelAvailability.ts:87` → `electron/shared/modelPublication.ts:118`（请求格式/模式，不认诊断）及 `electron/catalog/catalogModelAvailability.ts:37`（凭据启用/可解密）；结果在 `electron/catalog/catalogStore.ts:223` 投影。A2 执行旁路：`electron/catalog/executableModel.ts:18`、`:42`、`:48` 自读启用/钥匙，只消费不可用原因中的未发布一档；A3 首用旁路：`electron/catalog/validateCandidateCredential.ts:65` 再探钥匙，生成 `electron/runtime.ts:291`、文本 `electron/textTaskRunner.ts:150`、接入 `electron/providerAdapter/serviceCatalog.ts:327` 都等待它，诊断可再抛错。
A4 设置旁路：`src/ui/onboarding/ModelSettingsWorkspacePages.tsx:232` 用能力+传输覆盖 availability（它控制显示开关，不是实际生成选择器）；A5 写入旁路组：`electron/catalog/rendererCatalogMutation.ts:43`、`:57`、`:77`、`:138` 分别决定连接/模型/映射能否启用、存钥即发布；A6 认证发布组：`electron/providerAdapter/serviceCatalog.ts:176`、`:255`、`:355`、`:399` 从旧发布资格/verified modes 算启用并切换前身。A5/A6 部分是必要配置准入，但它们可与 A1、诊断语义各漂一份，不能都称“只读主人”。
选择/发送读者（内置与自接共用）：`src/config/modelCatalogCache.ts:161`、`:201`（画布/分镜），`src/workbench/settings/defaultGenerationModelOptions.ts:50`（默认），`src/workbench/ai/assistantModelIdentity.ts:45`（助手），`electron/catalog/executableModel.ts:102`、`:136`（模式候选）；读 availability+publishedModes，再做类型/角色过滤，不把角色过滤当第二份可用性。
其余全仓读者：`electron/catalog/catalogHealth.ts:17`、`electron/catalog/modelCatalogListing.ts:184`、`electron/ai/textBrainResolver.ts:147`、`electron/capabilityCore/generationDefaultModelResolver.ts:52`、`electron/capabilityCore/moduleCatalogBootstrap.ts:134`、`electron/capabilityCore/usableVideoModelCandidates.ts:20`、`electron/providerAdapter/serviceLanguageModels.ts:25`、`src/workbench/generationCanvas/runner/usableVendorModel.ts:45`、`src/workbench/generationCanvas/runner/catalogTaskResolve.ts:199`、`src/ui/onboarding/modelSettingsCatalogProjection.ts:76`、`src/ui/onboarding/modelSettingsHomeState.ts:18`、`src/ui/onboarding/OnboardingDrawer.tsx:456`、`src/ui/onboarding/onboardingDrawerDerivations.ts:55`；读同一目录投影/主人。门岗既有 18 项 READERS 在 `scripts/check-model-availability.mjs:55`；Agent 对外清单再经 `electron/catalog/agentModelEntriesFromCatalog.ts:92` 转述。`electron/catalog/unverifiedUsableMigration.ts:6` 是启动时一次性修正写口（非实时裁决），`:21`、`:22` 按 pending/旧失败恢复连接与凭据；`src/ui/onboarding/adapterVerificationViewModel.ts:118` 只锁正在编辑的测试/脚本草稿，不计为生成可用判据。
S1 列表（内置/自接共用）：`src/ui/onboarding/ModelSettingsHome.tsx:241` 读模型汇总+健康探针+pending，借 `src/ui/onboarding/modelSettingsHomeState.ts:61` 的未验证词再自行兜底；S2 自接详情 `src/ui/onboarding/CustomVendorCard.tsx:90` 读 adapter 汇总+健康+pending，也会兜底；S3 内置详情 `src/ui/onboarding/VendorOnboardCard.tsx:173` 只读健康胶囊，不读 pending，数据接口没有这格；S4 内置填钥页 `src/ui/onboarding/KnownVendorKeyConnectPage.tsx:97` 读本地 pending/复验标记/可用数量，经 `src/ui/onboarding/credentialPresentation.ts:34` 选词。健康事实来自 `electron/ai/onboarding/vendorHealth.ts:113` 的拉清单结果，词色由 `src/ui/onboarding/vendorConnectionView.ts:29` 翻译，不等于生成能力。
S5 模型详情 `src/ui/onboarding/ModelAdapterStatusSection.tsx:115` 自写标题覆盖，正文/图标仍读 `src/ui/onboarding/modelAdapterDetailState.ts:51` 的 adapter failed；S6 自检结果 `src/ui/onboarding/AdapterVerificationScreen.tsx:102`、S7 任务列表 `src/ui/onboarding/AdapterTaskWorkspace.tsx:63` 读 run.stage/modes；旧失败的显隐另由 `src/ui/onboarding/adapterTaskVisibility.ts:51` 读当前可用行+同源任务时间判，当前事实和历史成功混用。
S8 接入会话自检 `src/ui/onboarding/IntegrationSelfCheckPanel.tsx:64` 读会话 stage/reason；S9 AI 接入进度 `src/ui/onboarding/AssistedIntegrationProgress.tsx:66` 读进度投影 outcome；S10 测连接提示 `src/ui/onboarding/useOnboardingConnectionTest.ts:61` 读 testConnection 的 ok/reachabilityOnly；S11 向导结果 `src/ui/onboarding/OnboardingWizardResult.tsx:23` 读 phase；S12 接入说明 `src/i18n/locales/onboardingProviders.ts:854` 自写“通过后出现”的规则；S13 对外目录 `electron/catalog/modelCatalogListing.ts:58` 读 availability+keyStatus，却仍把无格式说成未过认证。13 组指上述最终说法出口，帮助函数/同一出口中英词条不重复计。
计数复查：`git grep -n -E "deriveModelAvailability|modelHasPublishedExecution|revalidatePendingCredential|readyForCanvas|statusLabel|resolveCredentialCopy|adapterVerification|statusReasonFor|通过后它们" 2de3aac6d -- electron src`，排除测试/注释后按 A1–A6、S1–S13 调用链归并；这不是源码里名为 usable 的变量个数。
五条发现①自检成功返回旧失败模型：`electron/providerAdapter/serviceCatalog.ts:399` 停用前身；`src/ui/onboarding/AdapterTaskWorkspace.tsx:115` 完成只 onBack，`src/ui/onboarding/OnboardingDrawer.tsx:585` 只 goBack，不携新身份；`:201` 仍按旧 vendor/model 找行，详情依据旧 adapter。直接原因是晋级与导航没交接当前身份，属 A；原始中英 retry-verification 日志及 after-selfcheck-identities.json 支持，不把它说成自检失败。
五条发现②内置 503 列表未验证绿点、详情连不上红点而可生成：S1 与 S3 输入/优先级不同；`src/ui/onboarding/OnboardingDrawer.tsx:382` 的内置卡调用未传 pending；A1 不看健康探针，所以能发。属 A；已亲眼读原验收 builtin-{zh,en}-{list,detail}-status 四图（实际文件中文图后缀也为 en）。
五条发现③四类改坏仍绿：`scripts/check-model-availability.mjs:41` 查“还引用主人”，`:92` 只识别“凭据 && 发布/启用”形状；`src/workbench/ai/modelAvailabilityAgreement.test.ts:103` 测派生函数、不执行两个首用入口；`src/ui/onboarding/unverifiedUsableCopy.test.ts:7` 扫词而不渲染实际出口，已有词条可绕过。属 B，同时证明 A 的旁路写得出来；原始 mutation-summary.json 为 26 类中 22 拦住、4 漏，全部还原绿，条件式首用变体与已有词条变体仍漏。
五条发现④已发 0.24.1 安装包降级未验：这是证据缺口，不是已知数据损坏；`electron/catalog/catalogFileAccess.ts:83` 同版快照、`electron/catalog/unverifiedUsableMigration.ts:6` 一次性标记和旧夹具只证明部分升级，源码标签构建不证明安装包身份/加密/读写。属 B；没有可诚实指认的“导致降级失败”代码行，原因是验收没有这份收据。
五条发现⑤接入说明仍说通过后才出现：S12 的完整句不匹配文案测试 `src/ui/onboarding/unverifiedUsableCopy.test.ts:8` 中“后…才/再”等句型；语义变了而多处文字仍可自己描述门槛。直接原因在 locale 与正则形状，A（措辞多主人）+B（判据漏形状）；前四条与它不是单一代码根因，但产品 A、验证 B 足以解释，不归咎人没注意。
**3. 不改结构的预测**：换一把钥匙后又有页面沿用旧成功（步骤：存新钥→并行打开列表/内置详情→真发失败）；一次自检换候选连接后原详情还显示旧身份（步骤：旧失败→自检成功→完成→再次选模型）；只在生成入口加 pending 拒发或在页面换已有 failed 词条，门岗继续绿（按原验收四个漏检点改坏/还原验证）。这些是待实施时证伪的预测，本次不执行。
**4. 靶子独立性与系统哪里没拦住**：实现线自己写测试，独立验收已证明靶子不完整；未发现“正确修复因评测掉分被回滚”的可证先例，153e4269f 是明确拒收边界的行为恢复，不是评测倒逼。最早应在设计/派工的 `docs/engineering/design-card.md` ★9 把已有“内置可发”任务细化为内置×自接、未检×失败×换钥的词色对拍，并把“自检完成→当前身份”列成终点；三个首用入口虽已列入，反例未逐入口证伪。随后门岗只查引用/词形，兼容收据又缺已发安装包，不能按已有源码回放结账。
系统改法（提案，未实施）：复用 `scripts/check-model-availability.mjs` 的普查生成入口参数化用例；删除首用复验闸及 UI 原始诊断分支，收窄 DTO/执行参数，只准读主人的不可变可用结论和展示；用现有 ESLint AST 禁止非主人读取原始验证字段、拼 availability 或直用状态词，纯引用不能算过。补两个首用入口和实际内置/自接组件的改坏→红/还原→绿；以这次 503 差异、旧案 `electron/shared/modelAvailability.ts:3` 记录的三界面不同答案验证能拦，以 `src/workbench/ai/modelAvailabilityAgreement.test.ts:161` 的图片不进文本角色为不误伤对照。量具为新增旁路拒绝数、消费端一致性、身份接续、安装包升级/退回收据；预测四漏全部转红，结构改动首个候选完成后、最迟 2026-11-24 复查，未达则重开方向复盘。
**5. P0 先查别人（2026-11-17 亲自打开原文，文档所示流程不等于实机行为；没有声明的 UI 状态数记未知）**
[AI SDK OpenAI Compatible Providers](https://ai-sdk.dev/providers/openai-compatible-providers)，Provider Instance / Language Models / Example 段：提供 apiKey、baseURL 后直接创建模型并 generateText，示例独立预验证 0 步、未定义连接 UI 状态枚举（状态数未知），配置集中 provider 工厂；影响：传输配置≠一次请求成功，不应自写“验证后才可发”层。当前文档 v7，只取模式，不建议给 Nomi 加包或升级。
[OpenRouter Quickstart](https://openrouter.ai/docs/quickstart) 的 Using the OpenRouter API、[Errors and Debugging](https://openrouter.ai/docs/api_reference/errors-and-debugging) 的 Error codes：密钥随真实请求发送，快速开始独立预验证 0 步，错误集中请求响应（含鉴权、额度、限流、上游不可用）；文档未定义连接 UI 状态数，不能推断产品没有检查按钮；影响：保留失败原因和“缺配置”与“上次请求失败”的区别。旧 errors-and-debugging 路径 404，已打开迁移后的原文。
[VS Code AI language models](https://code.visualstudio.com/docs/agent-customization/language-models)，Add a model from a built in provider 第 4–6 步、Add a custom endpoint model 第 4–7 步：填钥匙/端点/协议、保存配置即可在 picker 选择；列出的独立验证步骤 0，模型可见性另受工具调用能力限制，连接状态枚举未公布（数量未知）；配置在 Language Models editor/chatLanguageModels.json，影响：准入在配置边界，角色过滤仍保留，不能把“可选”当成功承诺。
这些是通用配置/诊断问题；Nomi 独有的是跨图片视频模式、密钥加密、旧目录和候选替换身份。标准 SDK 不拥有这些事实，故推荐复用现有 `modelAvailability`/`modelPublication` 与现有 ESLint、TypeScript 模块边界，不另造供应商健康框架、不引依赖。
**6. 三条路对比与推荐**

|路|做什么与依据|代价、是否复发、第二处还能不能写、老用户|
|---|---|---|
|沿当前方向补|补完成后的目标身份、内置详情 pending、两入口/两组件反例、安装包收据、旧句；依据是五个具体缺口。|改动最小但多套状态与可空辅助函数保留，下一种状态组合仍会复发；第二处照样能写。保留现有迁移并验手动停用、待验证、旧失败和退回，不能直接清历史来掩盖冲突。|
|换一种做法（推荐）|由同一目录边界产出当前身份+可执行模式+可用结论；由一个展示投影产出连接/模型当前词色；列表、详情、选择器、发送、自检完成接续均只读；任务进度仅表达那次检查，不能覆盖当前模型状态。删现有旁路和重复状态选择，不留两版。|成本高于补点，按“目录/执行边界→展示→所有消费口”同一迁移单元交付，由后续实现负责人完成，独立验收后才合入。通过收窄 DTO、只导出已准入执行上下文、AST 导入/字段/词条限制，普通代码再算/再写会编译或门岗红；有意 any/逃生口仍能绕，必须用四个旧漏检反例证明硬门，未验不承诺“绝不再来”。旧用户：连接/模式/密文保留，pending 只作诊断；有明确手动停用证据的保持关闭；失败停用且格式完整的旧行仅一次恢复，分不清“自动停用”还是“失败后手动再关”的按已接受取舍也恢复，以后手动再关不复活；旧失败留作历史不压当前；成功、换钥按配置指纹失效，不升目录格式，保留升级前快照并验真实安装包退回。|
|删掉|最小单位删“验证决定能否用”的首用复验闸、自动 GET 清单健康当可用灯、强制继续验证、重复失败徽标和验证后出现提示；更激进方案再删主动凭据/模型验证按钮、testing/verified/failed 当前状态与失败自检恢复流程，仅在真发失败报告原因，保住格式编辑、模型发现和既定未验证绿点。|少一步操作、最少状态；仅删预验证也不自动解决身份和文案多主人，仍需收口，第二处仍写得出来。彻底删“验证”概念与既定未验证词冲突，不能作为推荐；删主动诊断会失去不花生成钱的提前诊断与坏钥保护，且“真发失败才提示”会改变已保留的明确拒收新钥行为，需另拍板；旧状态停止参与当前展示，历史留档，旧手动停用/密钥不丢，不能顺手删旧资料。|
推荐理由与门：创作者要能接着创作而非理解认证状态。保留“未验证 / Not verified”绿点和有格式+有密钥可用；唯一可用性门是现有 `electron/catalog/catalogModelAvailability.ts` → `electron/shared/modelAvailability.ts`，在 `electron/catalog/catalogStore.ts` 出目录投影、`electron/catalog/executableModel.ts` 装配执行上下文时调用同一判据；每次以当下配置版本在共享门准入，门内发送只收准入结果、不再复验；配置变更使上下文失效，不在每个消费口重新判断。外部助手声明仍过 `electron/providerAdapter/validator.ts` 的收件口，供应商回包仍在请求响应边界解析，不拿“门里信任”删安全边界；用户停用、凭据解不开与缺请求格式仍不放行，免鉴权本地家不强求密钥。
选错的信号：必须为某一家新增可用性特例；拿不到原始 adapter/pending 就无法渲染列表；同一配置版本各入口仍不同答案；为了做投影开始长期维护第二份目录或持久化状态机。任一出现就停止扩张、重评删除路线。创作者看得见的变化（提案，待拍板）：列表与详情同词同色；无需等验证即可选/发；自检“完成”回到晋级后的模型；换钥不沿用旧成功；旧失败不再把能用的模型说坏。
**7. 用户要权衡的核心**：愿不愿付出一次收掉各入口私自解释的改造成本，保留可选诊断，换取以后接入状态不再互相打架；保留诊断不等于保留验证门槛。
**特征测试清单与自验**：现有 `electron/catalog/unverifiedUsable.test.ts`、`electron/catalog/unverifiedUsableOldUser.test.ts`、`src/workbench/ai/modelAvailabilityAgreement.test.ts`、`src/ui/onboarding/adapterTaskVisibility.test.ts`、`src/ui/onboarding/unverifiedUsableCopy.test.ts` 仅静态阅读；四类消费端反例、完成后当前身份与已发安装包兼容未钉住。★9 反例改坏→红/还原→绿只读不适用，未执行；`pnpm run gates:contracts`、设计实验室、走查均按约束不跑，不起窗、不用 verify-nomi、不交窗口量具。
抽样 diff 重核 5 个：`git show 4dcc49990 -- electron/catalog/apimartTexts.ts electron/catalog/seedModelIdentity.ts` 确为移除不可用型号；`git show bdc666a19 -- electron/providerAdapter/validator.ts electron/providerAdapter/serviceCompilation.ts` 确为并回声明主人；`git show 9528a1dab -- src/ui/onboarding/adapterTaskVisibility.ts src/i18n/locales` 确为同案再修；`git show 153e4269f -- electron/catalog/validateCandidateCredential.ts` 确为恢复 invalid-key 拒收；`git show 504fb0157 -- src/ui/onboarding` 确为只收口列表/自接详情而漏内置详情，五个归类不变。
对照①（独立稿先成文，后读两文件）：`docs/plan/2026-11-17-unverified-usable.md` 与 `docs/engineering/direction-checks/2026-11-17-unverified-usable.md` 当时都推荐把验证降为诊断、复用现有可用性/发布主人、统一成功回执、一次性修复旧 pending/失败，不升目录版本。
对照②一致：保住有请求格式+有可用密钥即可选可发、未验证绿点、缺格式不放行、真实成功绑定凭据、旧失败按精确来源退役；沿用明确拒收新钥保留旧钥，以及旧失败后手动停用无法辨认时一次恢复的已接受限制。
对照③不同：原方案把“读同一函数/投影+既有矩阵”视为收口，本稿要求门内只拿准入结果、词色完整投影和 AST/消费端反例，删除可自行兜底的旧分支；原方案已识别候选来源但未覆盖完成后导航接续，且安装包降版收据仍缺，故不能凭已有绿灯宣布完成。

## 接手守门复核：gate-family

本次不再增加一套自写扫描框架。选用仓库已安装的 ESLint flat config 与 TypeScript Compiler API：同一个 scanAvailabilityBypasses 同时供 ESLint、完整源码门岗和变异反例调用，删去各出口的旧验证字段与词条后才拦它们重生。ESLint 提供现成执行与定位，TypeScript 提供现成语法树；通用部分已接入现成方案。Nomi 特有的“目录跨 IPC 不能交验证原料、保存拒收闸不能进发送入口、状态词必须读展示投影”无法用第三方通用规则直接表达，因此仅保留这段领域规则，当前无需换掉 ESLint 或再搭扫描器。2026-11-24 按四类真实漏检、合法邻居与新增重复规则数复查；出现第二份扫描实现或反例漏检即删除重复入口并重新评估规则实现。

200模型性能补验只扩现有实验室夹具与现有量具，不改变生成框生产交互；完成接续仍收回既有导航主人，未在页面增加补丁分支。这些是本复盘已批“换一种做法、收成一份”的补齐。

## 第三轮（11-21）

D-1121-availability-r3 已批：删除 modelCatalogCache 中按 Gemini/Imagen 名字藏候选的旧过滤及只服务它的快照缓存，不给 Lite 加特例、不改存储。git log -S 追到 27ab140a8（apps/web 原路径，首次公开工作区）与 c9fc18c34（桌面搬迁），两条提交说明未记录具体故障；不能把推测的去重动机当事实。既有 modelIdentity 按身份归并同模型，modelPublication 按请求模式过滤；真实原始ID/别名归并样本、只支持文生图的APIMart种子证明两项仍生效。

最早漏在设计卡★9：原一致性测试只数 keepUsableModelRows，中间层可用并不保证最终菜单可选；扫描已知词形被写成任意源码不可绕。改为删除多余判断并延伸 modelAvailabilityAgreement 到真实APIMart种子→缓存→身份归并→菜单（含更多），逐身份比设置、默认、助手、画布；中英真实列表/详情组件核词色。当前Lite缺失与旧P0-10三份准入作为同类失败样本，模式不支持/手动关闭/文本角色过滤作为合法邻居。扫描不补自造形状，只作已知绊线；共享投影+末端对账才是产品保证。预测候选差异0、关闭仍灰且不入候选；2026-11-24复查，非零重开。五屏CI新图按用户已看的新旧对照更新，不改变其他基线。

Canvas夹具不再靠旧验证记录发布，补文生图/改图两条真实mapping，改图body读取Nano Banana档案声明的image_urls参数；目标显式绑定ux-local，正向等待懒加载的参考槽后仍严格断言两张都落槽。不修改生产参考规则，也不放宽“两张都在用”的判据。
