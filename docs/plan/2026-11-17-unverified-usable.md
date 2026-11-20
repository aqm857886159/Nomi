# 设计卡：删掉「验证」这一步——有 key、有请求格式、没手动关，就是「可使用」

状态：动手前写的（第二轮，按用户 2026-11-17 23:50 拍板「验证这一步整段删掉」D-1117-delete-verification 改写；取代本卡第一轮的「未验证 + 绿点」方案）。一个 PR。
类别：四类（花钱——删掉验证后，没有任何预检，第一次真实生成就是第一次碰供应商）。修复：用户 2026-11-13 定过「没验过的 key 也能用」，一直没落地；2026-11-16 两位创作者在群里撞到；11-17 用户进一步拍板：验证不准、不好用，整段删掉。
已复现（主分支和已发的 0.24.1，真窗口）：保存一个自接中转、不点验证，或验证失败 → 它的模型在「新建卡片默认模型」下拉和画布模型框里都不出现；同一个模型后来验证成功了，旧的失败提示仍并排挂着；列表写一个词、详情写另一个词。

## ★0 先查别人

以下三条是调研线亲自打开原文记的，协调没亲眼看：
- Open WebUI 接兼容端点（https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/starting-with-openai-compatible/ ）· 保存不验证；拉模型列表报错时仍可手填模型名并使用 · **确认了**：保存即可用，探测失败不等于不能用。
- Cherry Studio 模型服务设置（https://docs.cherry-studio-ai.com/pre-basic/settings/providers ）· 加了模型、启用了服务商就进选择器；「检查」是可选的独立动作，文档还提醒检查用的模型可能不支持 · **对删的决定的影响**：业界唯一保留的「检查」也不决定能不能用，而且承认会误判——我们连这个可选动作也不留，状态只写真发生过的事。
- LibreChat 自定义端点（https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/custom_endpoint ）· 模型清单可以直接声明，抓取失败回到声明的清单 · **确认了**：拉模型列表是取数据（留），不是判 key 行不行。
- 出口：Cherry Studio 同页 · 服务商和模型都能手动关 · **确认了**我们的出口：每个连接、每个模型都能手动停用；密钥能换能删；真发出去被上游拒绝时，错误卡照现有分类指回模型设置。

## ★1 用户怎么用

当我填好一个中转或自己的 key、勾上要用的模型，我想马上在模型框里选到它们并发出去，不用再过一道「验证」；设置里每个地方对同一个模型说同一个词、同一个颜色，而且只说真发生过的事。

步骤：①设置 → 模型，填 key 保存（供应商明确回 401 / 403 → 不存、旧 key 照用、说「密钥被拒绝」；404、网页、断网照样存）→ ②自动拉模型列表，勾选 → ③点「添加 N 个」：已有请求格式的模型立刻「可使用」；要现编请求格式的（中转视频等）后台编，编的时候「配置中」，编好「可使用」，编不出「待设置」并写缺什么 → ④默认模型下拉、画布模型框、助手选模型里出现全部「可使用」的模型 → ⑤发出去：成了就成了；被上游拒了，节点上照今天的错误卡说明并指回设置 → ⑥「完成」回到晋级后的那条连接，不回到旧的那条。

不做：不加任何新元素（生成失败后在模型旁写真实原因 + 去哪改，要先出图，另排）；不改发送键和花费；不改接入页的结构和布局（只改出口读的数据和字）；没有请求格式的模型照旧不能选；不改 `resolveModelParams.ts` / `taskParams.ts` / `catalogTaskResolve.ts`（只读）和 `InlineParameterBar.tsx` / `composerBarYield.ts` / `generationShotScope.ts`。
已知坑：以前「没验证 = 停用」是为了不出现「设置里说 28 个可用、实际一个都发不出去」（2026-09-01 的事故）。现在保住那条底线的办法：能不能用只看本机确定的三件事——有 key（且解得开）、有请求格式、没被手动关；这三件里任何一件不成立，所有出口都显示不可用、选不到、发不出去。另一个代价明着标：填错地址（不是错 key）的连接，删掉健康检查后列表照样写「可使用」，第一次生成才在节点上报错——这是拍板里「上次检查连不上」一并删掉的直接后果。

真实任务（全部本机回环假服务，零付费）：
1. 自接一个兼容中转（模型列表正常），保存、勾一个图片模型：列表行、连接详情徽标、模型详情标题都写「可使用」绿点；它出现在默认模型下拉、画布模型框、助手选模型；选它生成，请求直达假服务（之前没有任何预检请求），出图。
2. 同上，但假服务对 `/models` 回 401：新 key 不保存，旧 key（如有）照用，页面说密钥被拒绝；回 404 / 网页 / 断网：照样保存，可使用。
3. 一个没有请求格式的视频模型：所有出口写「待设置」警示色，不出现在选择器；模型详情写缺什么、去哪配。
4. 一个老资料：凭据带旧的「待验证」标记、模型带旧的「已验证 / 失败」记录：升级后一律按三件事判，带格式的写「可使用」，看不到任何验证字样。
5. 内置供应商（填了 key，从没验证）：照样可选可发，和今天一致或更宽，不更严。
6. 一个要现编格式的中转视频模型：添加后「配置中」，编好「可使用」，点「完成」回到晋级后的连接页。

指标与量具：
- 「有 key + 有请求格式 + 没手动关」却在任一出口不显示「可使用」或选不到的模型数 = 0 · 量具：同一份回环目录跑出口对照测试（列表、内置详情、自接详情、填钥页、模型详情、画布模型框、默认模型下拉、助手选模型、自检完成接续），逐模型核。
- 「显示可使用」却取不到可执行模型（本机就拦下）的模型数 = 0 · 量具：同一测试对每个「可使用」的模型调一次可执行模型解析。
- 首次发送前发给供应商的预检请求数 = 0 · 量具：生成、文本、目录服务三个入口各一条行为测试，回环假服务记请求，只许看到那一次真实调用。
- 模型连接这几处（连接状态、填钥页、格式任务屏、接入说明）的验证字样数 = 0（中英）· 量具：`onboardingProviders.*` / `modelSetup.*` 词条扫描 + 走查截图读回。

### ★1b 连带界面

- 设置 → 模型：连接行状态字、连接详情卡头徽标、模型详情标题——三处同一个展示投影出词出色。
- 内置填钥页（含 APIMart）：「保存验证」改「保存」；删「继续验证」按钮；保存后的说明不再提验证。
- 中转接入：模型挑选页底部说明不再说「通过后才出现」，主按钮「自检 N 个」改「添加 N 个」；后台编格式那一屏保留（结构不动），每个模型只说「请求格式已就绪 / 还缺请求格式」，不说通过 / 没通过；「停止验证」改「停止」，「重新验证」改「重试」。
- 删健康检查（Q5 已批）：列表行的红点「连不上」、详情页「上次检查连不上 · 重新检查」那条提示整条删。
- 画布模型框：行尾「未试跑」标签删（Q6 改，用户 11-18 追认：没有验证这回事，就没有「没试跑」这一档）；给 Agent 的模型说明里「未试跑 / Not generation-tested」同删；「最近多次失败」「暂未列出」保留（一个来自真实生成，一个来自拉列表）。
- 中转接入表单：「测试连接」按钮和它下面那句说明整个删（Q7 改，协调 11-18）。只有媒体模型的中转它只探「地址通不通」就报「已连接」，视频照样可能发不出——和验证同一种假通过；有文本模型时第一句真对话就能告诉创作者。保存时明确 401 / 403 不存（F1）照旧。
- 模型设置任务条（「需要继续处理」）：只显示正在跑的格式任务，不再挂失败卡。
- 生成失败的错误卡：沿用现有分类，不新增。
- 拍板图清单：B-ModelSurfaces / ModelConnectionStatus 板上的验证按钮、验证状态词、「未试跑」标签几个元素标删除并写拍板编号 D-1117-delete-verification；合并前交修前修后中英真截图，协调拿给用户看过才合。

### ★1c 老用户

- 旧资料里的「待验证」标记、「已验证 / 失败 / 部分」记录：升级后不再显示，也不再影响能不能选（读它们的代码删掉，只有一次性修正读一次）。
- 只做一次：停用着、带验证失败记录、而且有请求格式的模型 → 启用，显示「可使用」（D-1117-unverified-legacy-enable-once）。
- 停用着、**没有**验证失败记录的模型（自己关掉的）：保持关着。
- 边角（协调 11-18 批）：手动关了一个本来就缺请求格式的模型，显示「待设置」而不是「已关闭」——缺的不补，打开也用不了；这样说是真的。
- 明着写的限制：旧记录里「验证没过所以一直没启用」和「验证没过、自己手动开过又关掉」落成一模一样的一行，分不开，按启用处理——错开一个，下拉里多一项、能再关；错关一个，接上的模型继续选不到，就是群里那条反馈。这一次之后再手动关掉的，重启不会被再打开。
- 「只做一次」不升目录版本号：版本一升，0.24.1 读到新文件会进只读。做没做过记在目录顶层一个只增不改的标记里（0.24.1 实测读写都保留它），沿用迁移前留底，首次修正前保存原始字节。
- 退回 0.24.1：照常打开、能改模型设置；它按自己的旧规则把没验证的重新算成停用。再升回来时修正可能再做一遍——明着接受。
- 验证用已发的 0.24.1 真实写出的资料目录：「保存没验证」「验证失败」「验证成功后手动停用」各一份。

## ★2 谁说了算

**两个主人。**

1. 「能不能用」的家（不变）：`electron/shared/modelAvailability.ts::deriveModelAvailability`，由 `electron/catalog/catalogModelAvailability.ts::createCatalogAvailability` 喂目录事实。`catalogStore.ts` 出目录投影（每行带 `availability`）、`executableModel.ts` 装配执行上下文，都调它。判据只剩本机事实：连接在且开着 → 能力声明齐 → **就算打开也有请求格式** → 模型开着 → 不需要 key 或 key 解得开。任何验证状态不进来。
   - 唯一改动：「缺格式」提到「模型被关」前面判（`derivePublishedExecution({...model, enabled: true})`，纯计算，不存任何新标记）。原因：`enabled:false` 今天有三个写口是系统写的、不是创作者关的——没格式时强制关（`rendererCatalogMutation.ts:73`）、非文本模型登记时先关（`serviceCatalog.ts:220`）、格式任务没编出来时保持关（`serviceCatalog.ts:452`）。不调序，缺格式的模型会被说成「已关闭」，对照表 B07 / C07 就错；今天 `CustomVendorCard` 靠任务状态 `failed` 才说出「N 个待设置」，那正是要收走的原料。
   - 调序的读者：`modelCatalogListing.ts:59/65`（给 Agent / MCP 的原因句：关着且缺格式的模型从「已停用」改说「未配置请求格式」，更真）、`textBrainResolver.ts:129`（原样转出）、`modelSettingsHomeState.ts:26`（本次删）。`executableModel.ts` 不受影响（`selectExecutableModel` 先按 enabled 过滤）。被手动关、又缺格式的模型说「待设置」——缺的东西不补，打开也用不了，这样说是真的。
2. 「怎么说」的家（新）：`electron/shared/modelStatusPresentation.ts`，纯函数，不碰 i18n 运行时，只回「档位 + 词条键 + 点色」。
   - `presentModelStatus({availability, formatInProgress})`：能用就是「可使用」绿（哪怕后台还有格式任务在跑——能选就是绿）；不能用且格式任务在跑 →「配置中」；其余按主人的原因：credential_missing →「待接入」灰；model_disabled / vendor_disabled →「已关闭」灰；capability_incomplete / model_unpublished / credential_locked / credential_needs_resave →「待设置」警示。
   - `presentConnectionStatus(rows)`：连接级折叠，规则见下面「批复 Q2」。
   - 渲染只走一个组件（现有 StatusBadge 包一层），列表、内置详情、自接详情、填钥页、模型详情标题都只拿这个组件；出口里不再出现状态词条键（ESLint 规则拦）。
   - 为什么放 `electron/shared/`：主进程也要同一张对照（给 Agent / MCP 的模型列表原因 `modelCatalogListing.ts::statusReasonFor` 改读它），渲染层要连接级折叠；放共享层两边同一份，不会再长出第二份。为什么不放渲染层组件里：那正是今天 13 个出口各写各的来源。
   - 「能不能选」不在这里另给一个布尔：选择器照旧只认 `availability.usable` / `rowServesMode`。

**收走原料。** 给界面和执行端的数据形状里不再有：`credentialVerificationPending`（连接 DTO、模型行、ChipModel 全删）、`meta.adapter.state`（渲染层拿到的 meta 里剥掉；`rendererCatalogMutation.ts::preserveCertificationMeta` 写回时本来就以主进程那份 adapter 为准，剥掉不丢数据——已读码确认）。界面只拿得到 `availability` + `formatInProgress`（主进程从格式任务生命周期算出的一个布尔）+ 展示投影。主进程里允许读 `adapter.state` 的只剩格式任务生命周期的主人（白名单，扫描守）。

**删了什么 / 为什么能删 / 老用户怎么过**（判据：唯一产出是「这把 key / 这个模型行不行」→ 删；产出发请求要用的数据 → 留、改说法）：

| 删的东西 | 位置 | 为什么能删 | 老用户怎么过 |
|---|---|---|---|
| 首次使用前再验一次 key | `validateCandidateCredential.ts::revalidatePendingCredential` + `runtime.ts` / `textTaskRunner.ts` / `serviceCatalog.ts` 三处等待 | 唯一产出是判断；真发本身就是最好的检查 | 带旧「待验证」标记的直接发，不再先探 |
| 保存 key 时产出「待验证」 | `rendererCatalogMutation.ts` 写 `verificationPending`；`validateCandidateCredential` 返回值 | 只喂给「未验证」档位，档位没了 | 旧标记留在文件里没人读 |
| 付费探测前的确认卡 | `credentialProbePolicy.ts` 的 paid 分支、`directKeyCredential.ts` 的同意路径 | 保存时不再为「验证」花钱；声明了要付费的探测直接不发（照「首次使用」处理） | 今天两个种子（APIMart 余额、Higgsfield 报价）都是免费的，行为不变 |
| 接入任务里的凭据步 | `providerAdapter/verifier.ts` 的凭据探测、`selfCheck.ts::probeAdapterCredential`、`service.ts` 的 `probeCredential` 依赖、`submitDeclaration.ts` 的凭据探测和「credential_accepted / endpoint_reachable」未验证项 | 唯一产出是判断；格式完整性检查（零网络）保留 | 任务里不再出现「凭据」那一步，结果只说格式 |
| 健康检查 | `useVendorHealth`、主进程 `nomi:onboarding:vendor-health` 和缓存、`vendorConnectionView.ts::vendorConnectionPill`、`VendorConnectionNotice.tsx`、`vendorHealthProbePolicy.ts`、`data-model-home-unreachable` | 唯一产出是「连不上」这个判断；拍板点名删「上次检查连不上」 | 列表、详情不再出现红点和「重新检查」 |
| 真发成功后记「已验证」 | `modelExecutionVerification.ts::recordModelExecutionResult` 和三个入口的调用 | 只为清「未验证」，档位没了 | 无 |
| 各出口自己选词、自己兜底 | `modelSettingsHomeState.ts::unverifiedUsableStatus`、`adapterVerificationViewModel.ts::adapterProviderState`、`credentialPresentation.ts::resolveCredentialCopy` 的验证分支、`ModelAdapterStatusSection.tsx` 标题覆盖、`ModelSettingsWorkspacePages.tsx` 的 `readyForCanvas` 覆盖、`FoldableModelCard.tsx:115` 兜底、`ModelSettingsHome.tsx` / `CustomVendorCard.tsx` / `VendorOnboardCard.tsx` / `KnownVendorKeyConnectPage.tsx` 里的选词 | 改由展示投影一处出 | 词色统一到四档 + 配置中 |
| 挂着的失败卡 | `adapterTaskVisibility.ts::adapterFailureIsObsolete` 及失败卡显示 | 任务条只表达正在跑的格式任务 | 旧失败卡不再显示 |
| 「继续验证」按钮、「保存验证」字样 | `KnownVendorKeyConnectPage.tsx`（含 APIMart）、`OnboardingDrawer.tsx:461` | 拍板点名删验证按钮；内置连接要加模型仍有连接页的「添加模型」（`OnboardingDrawer.tsx:521`，`canAddModelsToConnection` 对有 key 的内置成立） | 保存即可用 |
| 「测试连接」按钮 | `useOnboardingConnectionTest.ts`、`OnboardingWizard.tsx` 的按钮和说明、IPC `nomi:onboarding:test-connection`（`onboardingIpc.ts`、`preload.ts`、`onboardingBridgeTypes.ts`）、`modelSetup.testConnection / testAndSaveHint / connected* / connectionFailed*` 等只给它用的词条 | 产出只有「通 / 不通」这个判断；它唯一的协议推断是「地址里带 anthropic/claude 就当 Anthropic」，预设本来就锁了协议，自定义中转仍可手动改协议 | 无存储，按钮消失 |
| 「未试跑」标签 | `useDedupedModelSelect.ts::untriedByModel`、`generationCommon.parameters.untried`、`agentModelEntriesFromCatalog.ts` 的「未试跑」说明、`promotionMeta.ts` 写的 `evidence:'self-check'` | 没有验证就没有「没试跑」这一档（Q6 改） | 旧目录里的 `evidence` 字段留着没人读 |
| 死分支 | `modelCatalogListing.ts::statusReasonFor` 的「还没走完接入认证」、`modelSetup.addedHint`「自检通过后它会出现」、`onboardingProviders` 里「通过后出现」那句 | 说的是已删的门 | 无 |
| 验证字样词条（中英） | 只在模型连接这几处：`onboardingProviders.*`、`modelSetup.*`、`runtime.*` 的付费探测确认卡（`credentialProbe*`） | 拍板点名删 | 见下「改说法」 |

**不在这一刀（同样带「验证 / 试跑」字样，但不是「模型连接的 key 行不行」，保留，见 Q9）**：Antigravity CLI 自己的试跑（`antigravity.ts`）、TikHub 数据源的 key 检查（`settings.ts` 的 tikhub 段）、生成结果的内容自检提醒（`generationCommon.ts:692`）、导出结果检查（`generationCommon.ts:1105`）、ComfyUI 候选工作流试跑（`comfyuiCandidateLifecycle.ts`）、外部助手认证会话（`integrationSession.ts`，只读 `testing` 判是否在跑）。

**留下的（不是验证）**：拉模型列表；格式任务（找文档 → 编请求格式 → 零网络的格式完整性检查 → 晋级），结果只说「请求格式已就绪 / 还缺请求格式」；保存 key 时的拒收闸——自接走免费 `GET /models`、内置走种子声明的免费探测，只认明确的 401 / 403（种子探测的 invalid-key），拒收就不存新 key、旧 key 照用（F1，把主分支丢掉的那条 auth 拒收补回来），404 / 网页 / 断网 / 超时一律照存；一次性修正 `repairUnverifiedUsable`（删掉它给待验证连接写诊断状态那半段）和留底；`invalidateVendorValidation`（主进程内部清格式任务状态，界面不读）。

**改说法**（Q8 批，尽量复用已有词，英文同义照改）：任务阶段「全部验证完成」→「自动适配完成」，「自检没有通过」→「自动适配没有完成」，「部分自检通过」→「部分调用方式可用」，「正在自检…」→「正在检查请求格式…」，「验证已停止」→「已停止」，「验证超时」→「超时」；每个模型「自检通过」→「请求格式已就绪」，「未通过」→「还缺请求格式」；按钮「重新验证」→「重试」、「停止验证」→「停止」、「自检 N 个」→「添加 N 个」、「保存验证」→「保存」。状态词只剩五个：可使用 / 配置中 / 待设置 / 已关闭 / 待接入（Ready to use / Configuring / Needs setup / Disabled / Not connected），连接级带数（Q1）。

**执行端。** `findExecutableModel` 不再自己读连接开关和 key 状态再判一遍：身份错误（退役 / 类型不符 / 未启用）照旧在这里；其余按主人的结论翻成今天的错误原话——

| 主人的结论 | 抛的错（原话不变，错误卡分类靠它） |
|---|---|
| vendor_missing / vendor_disabled | `Vendor is not enabled: <vendor>` |
| model_unpublished | `Model is not configured: <model> (not published: no executable request format)` |
| credential_missing / credential_needs_resave / credential_locked（经 `createCatalogAvailability().credentialStatusFor`） | `API key missing: <vendor>（…）` 三种原话 |
| capability_incomplete | 不在这里抛（今天也不抛；`taskParams.ts` 的 `assertDeclaredCapabilityForTask` 照旧拦，零行为变化） |
| usable | 解出明文 key，照旧返回 |

唯一的行为差：连接被关 **且** 模型已退役的双重故障，报错顺序可能变成先报身份错——两种都归「去模型接入」，不影响能不能发。调用方（`git grep findExecutableModel` 数出 6 门 11 处）：`browserPromptExtractionRun.ts:86`、`catalogCommit.ts:582`（ForTask）、`runtime.ts:293`、`taskResultQuery.ts:137/182`、`textTaskRunner.ts:151`（ForTask）、`deconstructVideo.ts:403/409/508`、`deconstructVisionLeg.ts:35`——全部只读返回值或照抛，不需要改。执行上下文类型里没有 pending。

**「完成」接续。** 自检那一屏的「完成」今天调 `onBack`，晋级后回到已被停用的旧连接。改成：任务到终态且已晋级 → 用 `modelSettingsNavigation.ts` 的替换导航把当前栈顶换成 `run.vendorKey` 的连接页（单模型任务直接到那个模型）；没晋级 → 照旧返回。

**换 key。** 不再有「已验证」可沿用，所以「新 key 不继承旧成功」自然成立；写口已有的 `invalidateVendorValidation`（key 变了 / 连接地址等五项变了）照旧清任务状态，过期任务守卫照旧。

**机器门数**（`node scripts/door-map.mjs <符号>`，门 = 不同调用文件）：

| 符号 | 前 | 后（目标） |
|---|---|---|
| deriveModelAvailability | 1 | 1 |
| createCatalogAvailability | 11 | 11 |
| revalidatePendingCredential | 3 | 0 |
| resolveCredentialCopy | 1 | 0 |
| statusReasonFor | 1 | 1 |
| validateCandidateCredential | 2 | 2（只剩拒收闸） |
| probeAdapterCredential | 3 | 0 |
| probeDirectKeyCredential | 1 | 1（只剩拒收闸） |
| useVendorHealth | 4 | 0 |
| vendorConnectionPill | 3 | 0 |
| VendorConnectionNotice | 2 | 0 |
| unverifiedUsableStatus | 2 | 0 |
| adapterProviderState | 1 | 0 |
| adapterFailureIsObsolete | 1 | 0 |
| recordModelExecutionResult | 3 | 0 |
| verificationPending | 10 | 1（只有一次性修正读旧数据） |
| credentialVerificationPending | 9 | 0 |
| adapterState（渲染层 ChipModel） | 7 | 0 |
| resolveModelAdapterDetailState | 1 | 1 |
| invalidateVendorValidation | 1 | 1 |
| repairUnverifiedUsable | 1 | 1 |
| 小计 | **68** | **20** |
| 新增：presentModelStatus / presentConnectionStatus / 状态徽标组件 | — | ≤ 4 |
| 合计 | **68** | **≤ 24** |

**协调 2026-11-18 批复（原待定九条，已定）**：
- Q1 计数形式（算 T2 A 的落法）：连接级（列表行、连接详情徽标）用同一个带数的串，中文「N 个可使用 / N 个待设置 / N 个已关闭 / N 个配置中」，英文 `readyCount` 改成「{{count}} ready to use」，其余「{{count}} need setup / disabled / configuring」与模型级「Needs setup / Disabled」同词只差单复数；「待接入 / Not connected」和模型级不带数。断言按「含这个词」核。
- Q2 连接级折叠，按这个顺序：没 key →「待接入」灰；全部模型都是「已关闭」→「N 个已关闭」灰；有可使用的 →「N 个可使用」绿（哪怕同连接里还有在编格式的、缺格式的——创作者刚接中转时文本模型已能用，列表不该写「配置中」让他以为要等）；没有可使用、有在编的 →「N 个配置中」；否则 →「N 个待设置」警示。
- Q3 格式任务屏和后台任务留，只删凭据探测，结果只说「请求格式已就绪 / 还缺请求格式」；停止 / 超时 / 找不到文档时文本模型全程可使用、非文本没编完是「待设置」；不加新存标记；「已知格式直接登记」不做。
- 判断顺序（缺格式提到「模型被关」前面）批了。边角明着接受：创作者手动关了一个本来就缺格式的模型，显示「待设置」而不是「已关闭」——★1c、★9 各钉一条。
- Q4 APIMart 余额探测只当保存时 401 / 403 拒收闸，不产出任何状态。
- Q5 健康检查整套删。错地址那行写「可使用」、首次生成才在节点报错，是用户接受的代价（坏配置等第一次真生成才发现）。走查底线①按新口径改写，并在 PR 正文「行为变化」里点名；②③不动。
- Q6（11-18 改）画布模型框「未试跑」标签这一刀一起删；板 picker.row-flags 该元素标删除、写 D-1117-delete-verification、注明用户 11-18 追认；修前修后截图拍到模型框。
- Q7（11-18 改）「测试连接」按钮整个删（hook、IPC、只给它用的词条），删前数调用方；保存时 401 / 403 不存（F1）照旧。
- Q8 说法表照用；修前修后真截图（中英）拍到每一处改了说法的位置。
- Q9 范围外的验证 / 试跑都不动，词条扫描只管 `onboardingProviders.*` 和 `modelSetup.*`。

## ★3 一致与复用

- 以前定过：2026-09-10「未验证先不发布」（为了说可用就真能用）；2026-11-13 用户「没验过的 key 也能用」；2026-11-17 第一轮「未验证 + 绿点」；2026-11-17 23:50 拍板整段删验证（本卡）。最后一条取代前三条；第一条要保的底线由 ★1 的第二个指标和执行端同读主人守住。
- 三条路：沿原方向修（保留验证、只提醒）——验证本身不准，留着就还得解释它；换做法（只给内置免验证）——解决不了自接中转；删掉（选这条，用户拍板）——丢的是「填错地址提前知道」，代价在 ★1 明着写。
- 复用：现有可用性判定、发布判定、错误分类、格式任务、StatusBadge、现有状态词。不引库，不加新状态机，不加第二份目录。

## ★4 全状态

- 空（没有任何连接）：不变。
- 加载（格式任务在跑）：「配置中」，那几个模型暂不可选；其余照常。
- 成功（有 key + 有格式 + 没手动关）：「可使用」绿点，所有出口一致。
- 失败（保存 key 被明确 401 / 403）：不存，旧 key 照用，当场说密钥被拒绝；格式编不出来：「待设置」警示，写缺什么。
- 部分成功（同一连接有的有格式、有的没有）：连接写「N 个可使用」，缺格式的模型在列表下方单独列「待设置」。
- 取消中（格式任务点了停止 / 超时 / 找不到文档）：停下；任务前就有格式的（文本模型登记即带聊天格式）照可用，靠这次任务编格式、没编完的「待设置」。
- 过期（换了 key / 改了地址）：仍按三件事判；进行中的格式任务按现有过期守卫作废。
- 能力不可用（没有请求格式 / key 解不开）：不可选，「待设置」，写缺什么、去哪配。
- 最大值：一个连接 200 个模型——设置列表不卡、计数正确；最长连接名用现有截断。

## 5 中途表

| 状态 | 停 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 格式任务进行中 | 已就绪的可用、其余待设置 · 不扣 | 同左 | 编不出的待设置 · 不扣 | 按现有任务恢复 / 过期 | 只跑一次 |
| 保存 key 中 | 不存 | 不存 | 照存（断网不算拒收） | 不存 | 只发一次 |
| 用模型生成中 | 现有取消行为 · 按现有计费规则 | 现有找回 | 现有错误卡 | 已发出的只查 | 现有防重 |

## 6 外部数据与失败

- 模型列表接口（`/models`、`/v1/models`）：各家形状不一、有的没有；只拿来列模型，失败照存、可手填模型名。
- 保存 key 时的 401 / 403：唯一会拒收的情况。
- 真实生成回 401 / 403 / 404 / 网络失败：节点上照今天的错误卡，不改设置里的状态字（那里只说本机事实）。

## ★7 性能

不新增交互。展示投影每行一次纯函数调用；最坏规模 200 个模型的连接，用现有模型设置性能场景跑主分支对比本分支，不许更慢（上一轮实测 25.7ms → 32.2ms 的差要查清再交）。

## 8 真实条件

Windows：unverified。英文界面：走查中英各一遍。最小窗口：状态字在最窄宽度下不撑破，截图核。真规模：200 个模型的连接一份。干净安装：隔离资料目录。真付费：实现线不跑；协调在验收后用真实连接跑一次最小生成。键盘全程：unverified。

拍板图清单：ModelConnectionStatus 板的 list.row-status / detail.badge 改成新四档，旧「未验证」状态标删除；ModelSurfaces 板 settings.other-ways.relay 的「接入验证」改「编请求格式」、settings.adapter-tasks 改成只挂进行中任务；都写 D-1117-delete-verification。ModelSurfaces 板 picker.row-flags 的「未试跑」标删除（Q6，用户 11-18 追认）；中转接入表单的「测试连接」若在板上有元素，同标删除。修前修后真截图（中英、最窄）合并前给用户看。

## ★9 验收与回滚

应该通过（断言只从可用性对照表抄，按改方向合并）：
1. 状态行 × 出口（列表行 = `[data-model-home-connection=<连接>]` 最后一个子元素；连接详情徽标 = `[data-model-settings-page=connection] [data-model-access-entry] > div > button` 里的 `span.inline-flex.shrink-0`；点色看 `.bg-workbench-success` / `.bg-workbench-danger`）：
   - 没有 key（B01 / C01）：没有连接徽标，有待接入行或空 key 表单；空页面不算过。
   - 有 key + 有格式 + 没手动关，不论有没有验证过、上次检查连没连上、换没换过 key、是不是刚晋级的新候选（B02 / B03 / B04 / B09 / B10，C 同）：含「可使用 / usable」（Q1 定形），绿点，无红点；在默认模型下拉、画布模型框、助手选模型里都选得到；三个发送入口都发得出去。
   - 保存时被明确 401 / 403（B05 / C05）：新 key 没存；状态按保留的旧配置走上面对应那一行。
   - 手动关（B06 / C06）：含「已关闭 / disabled」，灰，选不到。
   - 缺请求格式（B07 / C07）、key 解不开（B08 / C08）：含「待设置 / need setup」，警示色，选不到；B07 / C07 全部模型都缺格式时连接徽标写「N 个待设置」（T2 A）。
   - 任何状态行、任何出口：不出现「验证没通过，仍可使用 / Verification failed; still usable / 未通过 / Failed / 未验证 / Not verified / 上次检查连不上 / 上次自检未通过」。
2. 出口一致：同一配置版本下，所有出口对每个模型的结论一致。出口表从代码数出、测试里列全，至少含：列表、内置详情、自接详情、填钥页、模型详情、画布模型框、默认模型下拉、助手选模型、分镜解构选模型、批量统一模型（后五个都经 `useModelOptions` → `rowServesMode` 一个门）、给 Agent / MCP 的模型清单原因句（`statusReasonFor`）、自检完成接续。
3. 三个发送入口（生成、文本、目录服务）：凭据带旧「待验证」标记、模型带旧「已验证 / 失败」记录时，回环假服务只看到那一次真实调用，之前零请求。
4. 三份 0.24.1 真实旧资料：「保存没验证」「验证失败」的变可用、写「可使用」；「验证成功后手动停用」的仍关。升级后把一个恢复的模型手动关掉、重启：仍关。升级后的资料交回 0.24.1：能打开、能改模型设置，不是只读。
5. 设置里「可使用」的计数等于三个选择器里能选到的数。
6. 自检完成后点「完成」回到 `run.vendorKey` 的连接页，不是旧连接。

做了等于没做必须红（对照表回环实拍过的格子，各标在哪个提交上跑）：
- 主分支：B04 / C04（有 key + 有格式、上次检查 503）列表红点「已保存 · 未验证」、自接详情红「连不上」，模型却仍可选 → 第 1 条红（期望可使用绿、无验证字样）。
- 主分支：B02 / C02（有 key + 有格式、没验证）列表「已保存 · 未验证」→ 第 1 条最后一项红；接入说明「通过后出现在画布」（B02-S12 / C02-S12）→ 词条扫描红。
- 主分支：C06 三个模型全手动关，列表仍「2 个待设置」；B06 已关的模型标题仍「配置完成，尚未自检」→ 第 1 条已关闭那一项红。
- 本分支第一轮验收的提交 2de3aac6d：B04 列表绿「未验证」、内置详情红「连不上」（同一连接两个答案）→ 第 2 条红；C10 自检成功后「完成」回到旧连接 → 第 6 条红。

全拦也必须红（把展示投影改成「没验证过就待设置」或可用性改成「没验证过就不可用」）：
- B02 / C02 / B09 / C09 那几格不再是「可使用」绿点、选不到、发不出 → 第 1、2、3 条红。

故意改坏必须报红（实现线交「反例 → 改坏后哪条检查红 → 还原后绿 → 日志」表；验收线只按这张表和上面六条核）：
- F1：自接换 key 遇 401 / 403 改成照存新 key → `/models` 401、403 两条拒收测试红；内置种子探测 invalid-key 改成照存 → 种子拒收测试红。404 / 网页 / 断网改成拒收 → 「照存」测试红。
- 漏检类①条件式首用变体：在任一发送入口加「带旧标记才先探一次」→ 第 3 条行为测试红（回环看到预检请求）+ 扫描红。
- 漏检类②已有词条变体：出口改用另一个本来就有、文字里带验证字样的词条 → 中英词条扫描红（`onboardingProviders.*`、`modelSetup.*` 两个命名空间的值里不许有验证字样，白名单为零；范围外几处见 ★2「不在这一刀」）。
- 漏检类③详情 / 列表各写各的：任一出口直接 `t()` 一个状态词条键，或自己挑色 → ESLint 规则红 + 出口一致测试红。
- 漏检类④生成和文本两个入口另判：任一入口自己读凭据标记或任务状态决定发不发 → 第 3 条对应入口红 + 扫描红。
- 任一选择器自己加一条按任务状态的过滤 → 第 2 条红。
- 把没有请求格式的模型放进选择器 → 第 1 条 B07 / C07 红。
- 界面或执行端的数据形状里重新出现 `credentialVerificationPending` / `adapterState` → 类型检查红（字段已删）+ 扫描红。
- 升级时把没有失败记录的停用模型也启用 / 每次启动都跑修正 / 升目录版本号 / 把没有格式的也启用 → 迁移测试四条各自红。
- 「完成」改回 `onBack` → 第 6 条红。
- 把「缺格式」挪回「模型被关」后面判（手动关了的缺格式模型变回「已关闭」，系统关掉的缺格式模型也说成「已关闭」）→ 主人单测「手动关 + 缺格式 = 待设置」红、第 1 条 B07 / C07 红。
- 加回「测试连接」入口（`nomi:onboarding:test-connection` 通道、`testConnection` 桥方法、`modelSetup.testConnection` 词条任一出现）→ 扫描红。
- 模型框行尾或给 Agent 的说明里加回「未试跑」（读 `adapter.evidence` 或 `parameters.untried`）→ 扫描红。
- 连接级折叠把「有可使用 + 有在编」说成「配置中」→ 折叠单测红。
- 设置里显示可用、但取不到可执行模型 → 第 1 条的执行解析核对红。

这一类还会从哪里回来：新加一个出口自己挑词（ESLint 规则 + 出口表测试拦）；新的「检查」又被接进可用性或发送前（扫描 + 发送入口行为测试拦）；新加的词条带验证字样（词条扫描拦）。扫描登记进推送前扫描清单。

真实场景复现：创作者接了一个中转没验证（或验证失败），到「新建卡片默认模型」里选不到它的模型，模型页一直挂着失败。复现办法：隔离的应用加本机回环的假中转，照同一条路走；修前判据——下拉里只有本地会员项（主分支和 0.24.1 都已看到）；修后判据——有请求格式的模型出现并能发出去，任何地方没有验证字样。和用户那次的差别：没有他们的真实地址、key 和具体模型；他们遇到的视频模型如果本来就没有请求格式，修后仍不可选，但会写明缺什么。

回滚：一个 PR，`git revert` 合并提交即可；不改数据格式、不升目录版本。
独立验收：另一条线按本格清单验，报告链接放 PR 正文。

## 实现的系统改进与一次性收据

最早应拦在验收的可用性一致性矩阵：旧矩阵把「没认证就不发布」当正确答案，只核投影一致，没有以保存后的请求格式和凭据事实核执行解析，也没有核「每个出口说同一个词」。现在同一真实目录逐模型走全部出口与可执行解析，词色只从展示投影出，出口里写不出第二份（ESLint + 类型）。预测：本机事实齐全而任何一门拒绝或说法不同的模型数为 0；复查日 2026-11-24，非零重开。

一次性修正：目录顶层记 `unverifiedUsableRecovered: true`，只增不改；不改目录版本；沿用迁移前留底，首次修正前保存原始字节，后续日常写入不覆盖。真实 0.24.1 编译模块的读写回放必须通过。降版仍可能按旧规则停用，旧版若丢标记再升级可能重做，此限制已接受。


## 先查别人

- `electron/catalog/catalogModelAvailability.ts:22` · 已有批量判据共享一次凭据解密缓存 · 可用性仍在目录边界算，不在列表或执行器重算。
- `scripts/ui-money-format.test.mjs:18` · 同一 AST 规则供 ESLint、真实路径反例和全仓普查使用 · 状态词门岗与 ESLint 复用 scanAvailabilityBypasses，不再各写正则。
- `src/ui/onboarding/modelSettingsNavigation.ts:60` · 按 vendor 身份返回连接并丢弃旧弹层 · 完成任务复用导航主人，不在任务页搜索旧模型。

接手补验：新增退役入口和原料 AST 检查（含 bracket/条件变体），真实 ESLint 路径反例；完成导航覆盖晋级、批量、失败、取消、未落目录与同身份。上游错误卡、参数值和生成底栏不改。

目录投影剥原料的纯函数搬入现有 catalogModelAvailability 边界绑定，electron/main.ts 跨 IPC 前只 map；未增加第二套投影或状态。完成导航的缺 run 返回也归导航主人，页面不再自写分支。

出口：src/ui/onboarding/ModelAdapterStatusSection.tsx:85 · 缺格式时沿用手动设置输入方式与请求方式的出口 · 删除验证不删除手动补齐配置的路径。

性能补验口径：原25.7ms登记场景实际为30张参考、约7行菜单，并非200模型。本轮另登记composer-open-model-menu-models-200（200条不同视频模型，复用现役组件、既有计时器与100ms预算），两版本均用相同夹具和5次采样；只量菜单首反馈，不能代替目录IPC或真实模型效果。

正式包兼容量具：常驻驱动的既有 --data 白名单加入仓库已有的三份v0.24.1目录夹具，--vendor fake-apimart 只把其中非秘密测试key重包并把回环端口指向本次夹具，其余业务字段原样保留；仍拒绝任意路径和已有/真实资料。用同一驱动冷启动正式包和本构建，避免另写窗口驱动或用函数绿灯替代兼容收据。

补齐内置详情的旧副标题：VendorOnboardCard唯一一处vendorCard.modelsAvailable把启用数叫可用数；沿用自接卡已有drawer.modelsEnabled描述启用配置数量，状态徽标仍只读connectionHomeStatus。沿原方向改可用计数会留下第二处结论；删副标题会改板结构；复用既有启用数量文案保留结构与事实，不新增状态或词。删除旧中英modelsAvailable词条并加入同一AST门岗，反例为把enabled数重新写成可用数；混合可用/缺格式仍由既有折叠测试判1个可使用。

接手实测（原始结果见 docs/evidence/2026-11-20-model-availability/）：主分支2b14af4e3仅加相同200目录量具（dirty=true，补丁在外部证据目录），200模型41.7/47.7ms；任务分支并入主分支后d9e7abb51干净树41.7/49.0ms，均5次、零长任务。原30参考图/约7行场景主分支32.2/32.5ms，本分支32.1/32.5ms；两版相对历史25.7ms基线均报regression，未改基线。新增场景的预算批准与写基线按docs/engineering/perf-scenarios.md交协调，本线只交数字。

受影响走查的真实路径修正：旧V验收已记vendor-validation被开屏挡住，本轮同样复现；原Promise.race拿遮罩背后可见的齿轮当可点击，现先等外壳再实际点开屏「跳过」，冷重启无开屏照常通过。relay-video在保存成功页未点「获取模型」就等待请求，现点真实按钮后仍核对拉列表和声明前零生成。国内线路旧断言硬等验证请求，现核密钥已存且启用、地址落盘、保存流量不走主域，并保留后续真实生成线路断言；没有放宽生成结果或不能用的反例。

错误持久化走查第二次到业务屏时显示待接入：旧夹具把明文base64冒充safeStorage密文，当前真实解密边界当然拒收。改用既有encryptFixtureKey生成同一隔离资料的假钥密文，不改产品解密规则；这样缺请求格式断言才只测格式，不混进坏密文。第三次为该走查最后一次复跑，仍红就按任务停点交回。
