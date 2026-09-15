# 通知全量清单 · 2026-09-09

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：基线调查与策略裁决；本清单不是“所有项均已改完”的验收声明。

基线：`1d565961f`。表内行号来自该 Git 对象中 TypeScript AST 节点起始行，JSX 使用元素起始行（不是其 role 属性行）；后续实现会改变工作区行号。范围是 `src/`、`electron/` 的生产 TS/TSX 调用与语义容器，另补 `.mts` Agent 投影和原生对话框。排除测试、实验室、import、注释、CSS 类名和 ffmpeg `-hide_banner`。同文件同文案不同触发分支分别列一行；共享容器与业务生产者分开，因此本数不能当“会弹多少张”。

方法：AST 提取真实调用/JSX，按所属函数、消息语义、事件/effect 与可见宿主复核。对没有错误内联承载证据的项明确写“未见承载”，不把“对象可见”等同于“错误已可见”，不得删除失败消息后宣称已迁移。浏览器、模型设置、批次、项目恢复、更新与 Agent/系统通知另读共享宿主链路。冻结区只读；C50 只评通知归属，不改切换行为。

核心发现：不是 13 个 toast。基线有 469 个通知调用与 dialog/alert/status/Modal 语义容器。成功/复制/保存回声、原地操作失败的全局消息、自动更新模态、批次常驻进度，属于不同根因，不能用统一隐藏 success/error 的过滤器替代逐项迁移。撤销虽然是 success，仍有独立行动价值。主动打开的编辑器/素材预览虽有 dialog 角色，属于工作面，不是自动通知。已有安全/花费确认继续沿现有批准轨道。


## 先查别人

本清单引用主任务已经实读并区分事实/产品裁决的[官方对照表](2026-09-09-notification-policy.md#先查别人官方依据与边界)，不把目标裁决冒称外部产品的硬规则。

- Apple [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)：不只为告知而显示 alert；普通可撤销操作不应升级确认。本表区分必要决定与纯信息，并保留主动打开的工作面。
- Figma [notify API](https://developers.figma.com/docs/plugins/api/properties/figma-notify/)：短消息支持可选按钮和取消。本表判断是否有行动及消息是否失效；“toast必须有动作”是Nomi从严裁决，不冒称Figma硬要求。
- Notion [Updates and notifications](https://www.notion.com/help/updates-and-notifications)：按页面/评论线程聚合，通知直达发生处。本表单独记录对象、所在工作面与原地是否已有信息。
- Linear [Notifications](https://linear.app/docs/notifications)：按对象/状态变化分类，邮件依紧急程度和未读状态发送。本表不把成功回声一律当必须知道的事件。
- 近邻视频编辑器 [Shotcut mainwindow.cpp:2549](https://github.com/mltframework/shotcut/blob/master/src/mainwindow.cpp#L2549)：共享状态消息落播放器状态区，作为保留实际宿主、避免新建全局通知系统的实现参照。


## 逐调用点及语义容器

判定是目标策略。`保留原地状态` 与 `主动工作面` 用于避免把现有 inline 和用户显式打开的编辑器误删。离面 toast 必须补目标身份和“去看/重试”动作；当前面失败必须先有承载再删原调用。

| 文件:行（基线） | 触发时机/语义证据 | 用户当时所在面 | 信息是否已原地可见 | 行动价值 | 判定 |
|---|---|---|---|---|---|
| `electron/notificationIpc.ts:34`  | registerNotificationIpc → showDesktopNotification({ title, body: String(input.body ／／ ""), event: input.event === 'decision' ／／ input.event === 's | 窗口外/系统桌面 | 窗口失焦；前台抑制 | 点击返回窗口；制作通知可深链 run | 保留系统通知；身份/批次去重 |
| `electron/productionRun/productionNotificationsDesktop.ts:28`  | createProductionNotificationsListener → showDesktopNotification({ title: decided.title, body: decided.body, event: decided.soundEvent, onClick: () => focusAndDe | 窗口外/系统桌面 | 窗口失焦；前台抑制 | 点击返回窗口；制作通知可深链 run | 保留系统通知；身份/批次去重 |
| `src/design/confirmDialog.tsx:70`  | 共享决定请求队列打开 | 共享层；随调用对象 | 决定尚未作出 | 批准/取消/危险确认 | 保留决策模态（共享） |
| `src/design/identity.tsx:116`  | 状态派生；NomiLoadingMark → common.loading | 共享层；随调用对象 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/design/overlays.tsx:10`  | 主动打开；DesignModal → 编辑/预览容器 | 共享层；随调用对象 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/design/status.tsx:91`  | 状态派生；NomiSkeleton → common.loading | 共享层；随调用对象 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/app-shell/UpdaterDialog.tsx:42`  | 后台 available/downloaded 相变；当前无任务自动打开 | 任意工作面/更新后台 | 更新本可用角标显示 | 更新可推迟，不必停工 | 改状态徽标；用户点击才开现有面 |
| `src/ui/browser/dialog/NomiBrowserDialogView.tsx:123`  | 主动打开；NomiBrowserDialogView → browserAssets.browser | 素材浏览器 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/ui/browser/dialog/NomiBrowserDialogView.tsx:288`  | 主动打开；NomiBrowserDialogView → browserAssets.materialSiteList | 素材浏览器 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/ui/browser/dialog/useBrowserDialogActions.ts:251`  | useBrowserDialogActions → browserAssets.renameBookmark | 素材浏览器 | 用户正操作的名称/对象可见 | 输入名字 | 改内联（节点/书签原地改名） |
| `src/ui/browser/dialog/useBrowserDialogActions.ts:357`  | useBrowserDialogActions → browserAssets.savedToPromptLibraryToast | 素材浏览器 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/browser/dialog/useBrowserDialogActions.ts:358`  | useBrowserDialogActions → browserAssets.saveToPromptLibraryFailed | 素材浏览器 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/browser/popover/BrowserAssetPopoverParts.tsx:248`  | 主动打开；所属事件回调 → browserAssets.assetCategoryFilter | 素材浏览器 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/ui/browser/popover/BrowserAssetPopoverView.tsx:83`  | 主动打开；BrowserAssetPopoverView → browserAssets.assetBox | 素材浏览器 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/ui/browser/popover/BrowserAssetPopoverView.tsx:162`  | 状态派生；BrowserAssetPopoverView → 原地状态容器 | 素材浏览器 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/browser/popover/useBrowserAssetActions.ts:78`  | useBrowserAssetActions → browserAssets.onlyImagesAndVideos | 素材浏览器 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/browser/popover/useBrowserAssetActions.ts:180`  | useBrowserAssetActions → browserAssets.confirmDeleteCount / browserAssets.deleteToTrashHint / browserAssets.delete | 素材浏览器 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/browser/popover/useBrowserAssetActions.ts:193`  | useBrowserAssetActions → browserAssets.deleteUnsupported | 素材浏览器 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/browser/popover/useBrowserAssetActions.ts:197`  | useBrowserAssetActions → browserAssets.deleteCountFailed | 素材浏览器 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/browser/popover/useBrowserAssetActions.ts:207`  | useBrowserAssetActions → browserAssets.deleteFailedPermission | 素材浏览器 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/browser/prompt/BrowserPromptExtractionSettingsModal.tsx:121`  | 主动打开；BrowserPromptExtractionSettingsModal → browserAssets.extraction.settings | 素材浏览器 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/ui/browser/prompt/browserPromptExtractionRunner.ts:135`  | runBrowserPromptExtractionToLibrary → browserAssets.extractingPrompt | 素材浏览器 | 浏览器 popover 已有 promptExtractionFeedback 状态条 | 失败在原条重试；成功去提示词库可选 | 合并去重：保留原地状态 |
| `src/ui/browser/prompt/browserPromptExtractionRunner.ts:149`  | runBrowserPromptExtractionToLibrary → browserAssets.savedToPromptLibraryNamed | 素材浏览器 | 浏览器 popover 已有 promptExtractionFeedback 状态条 | 失败在原条重试；成功去提示词库可选 | 合并去重：保留原地状态 |
| `src/ui/browser/prompt/browserPromptExtractionRunner.ts:154`  | runBrowserPromptExtractionToLibrary → browserAssets.promptExtractionFailedToast | 素材浏览器 | 浏览器 popover 已有 promptExtractionFeedback 状态条 | 失败在原条重试；成功去提示词库可选 | 合并去重：保留原地状态 |
| `src/ui/chunkBoundary.tsx:145`  | 状态派生；所属事件回调 → 原地状态容器 | 共享层；随调用对象 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/community/FeedbackShareDialog.tsx:29`  | 主动打开；FeedbackShareDialog → community.title | 反馈分享工作面 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/ui/onboarding/AddComfyuiInstanceButton.tsx:46`  | submit → onboardingProviders.comfyInstance.added | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/AddComfyuiInstanceButton.tsx:51`  | submit → toast(e instanceof Error ? e.message : String(e), 'error') | 模型连接卡 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/onboarding/AntigravityConnectionCard.tsx:64`  | 状态派生；AntigravityConnectionCard → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/AntigravityConnectionCard.tsx:76`  | 状态派生；AntigravityConnectionCard → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/CapabilityModeEditorParts.tsx:11`  | 状态派生；ErrorText → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/CodexLocalImageCard.tsx:47`  | toggle → onboardingProviders.codexImage.enabledToast / onboardingProviders.codexImage.disabledToast | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/CodexLocalImageCard.tsx:51`  | toggle → onboardingProviders.drawer.operationFailed | 模型连接卡 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/onboarding/ComfyuiLocalCard.tsx:119`  | handleEnable → onboardingProviders.comfyWorkflow.awaitingVerification / onboardingProviders.comfyLocal.enabledWithoutConnection | 模型连接卡 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/onboarding/ComfyuiLocalCard.tsx:121`  | handleEnable → onboardingProviders.comfyLocal.enableFailed | 模型连接卡 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/onboarding/ComfyuiLocalCard.tsx:133`  | handleDisable → onboardingProviders.comfyLocal.disabled | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/ComfyuiLocalCard.tsx:135`  | handleDisable → onboardingProviders.comfyLocal.disableFailed | 模型连接卡 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/onboarding/ComfyuiLocalCard.tsx:147`  | handleSaveAddr → onboardingProviders.comfyLocal.addressUpdated | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/ComfyuiLocalCard.tsx:157`  | handleRemoveInstance → onboardingProviders.comfyInstance.removeTitle / onboardingProviders.comfyInstance.removeMessage / common.delete | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/ComfyuiLocalCard.tsx:169`  | handleRemoveInstance → onboardingProviders.comfyInstance.removed | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/ComfyuiLocalCard.tsx:171`  | handleRemoveInstance → onboardingProviders.drawer.deleteFailed | 模型连接卡 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/ui/onboarding/ComfyuiLocalCard.tsx:178`  | handleDeleteModel → onboardingProviders.comfyLocal.deleteWorkflowTitle / onboardingProviders.comfyLocal.deleteWorkflowMessage / common.delete | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/ComfyuiLocalCard.tsx:188`  | handleDeleteModel → onboardingProviders.comfyLocal.workflowDeleted | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/ComfyuiLocalCard.tsx:190`  | handleDeleteModel → onboardingProviders.drawer.deleteFailed | 模型连接卡 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/ui/onboarding/ComfyuiPresetSection.tsx:71`  | enable → onboardingProviders.comfyWorkflow.awaitingVerification | 模型连接卡 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/onboarding/ComfyuiPresetSection.tsx:75`  | enable → toast(error instanceof Error ? error.message : String(error), 'error') | 模型连接卡 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/onboarding/ComfyuiPresetSection.tsx:164`  | ComfyuiPresetSection → onboardingProviders.comfyPreset.copied | 模型连接卡 | 剪贴板不直接可见；按钮应短暂显示已复制 | 确认复制是否生效，无后续决策 | 改状态徽标（复制按钮反馈） |
| `src/ui/onboarding/ComfyuiTemplateLibrary.tsx:106`  | enable → onboardingProviders.comfyTemplates.analyzeFailed | 模型连接卡 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/onboarding/ComfyuiTemplateLibrary.tsx:109`  | enable → onboardingProviders.comfyWorkflow.awaitingVerification | 模型连接卡 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/onboarding/ComfyuiTemplateLibrary.tsx:113`  | enable → toast(error instanceof Error ? error.message : String(error), 'error') | 模型连接卡 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/ui/onboarding/ComfyuiWorkflowImportPanel.tsx:221`  | ComfyuiWorkflowImportPanel → onboardingProviders.comfyWorkflow.awaitingVerification | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/ConnectAssistantCard.tsx:152`  | handleInstall → useToastStore.getState().push({ id: CURSOR_CONNECTED_TOAST_ID, message, type: 'success' }) | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/ConnectAssistantCard.tsx:154`  | handleInstall → toast(message, 'success') | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/ConnectAssistantCard.tsx:170`  | handleUninstall → onboardingProviders.assistant.disconnectedToast | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/ConnectAssistantCard.tsx:181`  | handleCopy → onboardingProviders.assistant.copiedToast | 模型连接卡 | 剪贴板不直接可见；按钮应短暂显示已复制 | 确认复制是否生效，无后续决策 | 改状态徽标（复制按钮反馈） |
| `src/ui/onboarding/ConnectAssistantCard.tsx:189`  | handleCopyAdapterCommand → onboardingProviders.assistant.copiedToast | 模型连接卡 | 剪贴板不直接可见；按钮应短暂显示已复制 | 确认复制是否生效，无后续决策 | 改状态徽标（复制按钮反馈） |
| `src/ui/onboarding/CustomCallEditor.tsx:124`  | CustomCallEditor → onboardingProviders.customCall.scopeDiscardTitle / onboardingProviders.customCall.scopeDiscardMessage / onboardingProviders.customCall.scopeDiscardConfirm | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/CustomCallEditor.tsx:288`  | CustomCallEditor → onboardingProviders.customCall.removeConfirmTitle / onboardingProviders.customCall.removeScopeConfirmMessage / onboardingProviders.customCall.removeScope | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/CustomCallEditor.tsx:375`  | CustomCallEditor → settings.unsaved.title / settings.unsaved.message / settings.unsaved.discard | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/CustomCallEditor.tsx:413`  | 状态派生；CustomCallEditor → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/CustomCallEditor.tsx:530`  | 状态派生；CustomCallEditor → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/CustomCallEditor.tsx:780`  | 主动打开；CustomCallEditor → onboardingProviders.customCall.closeAria | 模型连接卡 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/ui/onboarding/CustomVendorManage.tsx:107`  | CustomVendorManage → onboardingProviders.vendorCard.disconnectTitle / onboardingProviders.vendorCard.disconnectMessage / onboardingProviders.vendorCard.disconnect | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/DirectScriptDraftForm.tsx:122`  | 状态派生；DirectScriptDraftForm → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/DreaminaMemberCard.tsx:50`  | handleInstall → onboardingProviders.dreamina.installComplete | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/DreaminaMemberCard.tsx:62`  | runPollLoop → onboardingProviders.dreamina.loginComplete | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/DreaminaMemberCard.tsx:79`  | handleLogin → onboardingProviders.dreamina.alreadyLoggedIn | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/DreaminaMemberCard.tsx:90`  | handleLogout → onboardingProviders.dreamina.loggedOut | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/DreaminaMemberCard.tsx:97`  | handleCopyLink → onboardingProviders.dreamina.linkCopied | 模型连接卡 | 剪贴板不直接可见；按钮应短暂显示已复制 | 确认复制是否生效，无后续决策 | 改状态徽标（复制按钮反馈） |
| `src/ui/onboarding/IntegrationConfirmationPanel.tsx:77`  | 用户配置连接后确认授权 | 模型连接卡 | 连接工作面已展示 | 确认接入范围/返回 | 主动工作面；保留授权决定 |
| `src/ui/onboarding/IntegrationConfirmationPanel.tsx:117`  | 状态派生；IntegrationConfirmationPanel → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/KnownVendorKeyConnectPage.tsx:162`  | 状态派生；KnownVendorKeyConnectPage → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/LocalModelCard.tsx:109`  | handleConnect → onboardingProviders.localModel.connectedAgent / onboardingProviders.localModel.connectedChatOnly / onboardingProviders.localModel.connectedUnknown | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/LocalModelCard.tsx:118`  | handleConnect → onboardingProviders.localModel.connectFailed | 模型连接卡 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/ui/onboarding/LocalModelCard.tsx:132`  | handleDisconnect → onboardingProviders.localModel.disconnected | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/LocalModelCard.tsx:134`  | handleDisconnect → onboardingProviders.localModel.disconnectFailed | 模型连接卡 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/ui/onboarding/ModelCapabilityEditor.tsx:144`  | ModelCapabilityEditor → onboardingProviders.workspace.capability.editor.discardTitle / onboardingProviders.workspace.capability.editor.discardMessage / onboardingProviders.workspace.capability.editor.discard | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/ModelCapabilityEditor.tsx:155`  | ModelCapabilityEditor → onboardingProviders.workspace.capability.editor.restoreTitle / onboardingProviders.workspace.capability.editor.restoreMessage / onboardingProviders.workspace.capability.editor.restore | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/ModelCapabilityEditor.tsx:296`  | 状态派生；ModelCapabilityEditor → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/ModelCapabilityEditor.tsx:301`  | 状态派生；ModelCapabilityEditor → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/ModelCapabilityEditor.tsx:306`  | 状态派生；ModelCapabilityEditor → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/ModelPickerScreen.tsx:240`  | 状态派生；ModelPickerScreen → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/ModelSettingsDetailDialog.tsx:36`  | ModelSettingsDetailDialog → settings.unsaved.title / settings.unsaved.message / settings.unsaved.discard | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/ModelSettingsDetailDialog.tsx:100`  | 主动打开；ModelSettingsDetailDialog → 编辑/预览容器 | 模型连接卡 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/ui/onboarding/ModelSettingsWorkspacePages.tsx:107`  | 状态派生；ConnectionWorkspacePage → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/ModelSettingsWorkspacePages.tsx:168`  | 状态派生；ModelWorkspaceRecovery → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/OnboardingDrawer.tsx:246`  | OnboardingDrawer → onboardingProviders.workspace.adapter.startFailedTitle / onboardingProviders.workspace.adapter.unavailable | 模型连接卡 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/ui/onboarding/OnboardingDrawer.tsx:252`  | OnboardingDrawer → onboardingProviders.workspace.adapter.consentTitle / onboardingProviders.workspace.adapter.consentMessage / onboardingProviders.workspace.adapter.consentConfirm | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/OnboardingDrawer.tsx:286`  | OnboardingDrawer → onboardingProviders.workspace.adapter.startFailedTitle / modelSetup.saveFailedHint | 模型连接卡 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/ui/onboarding/OnboardingDrawer.tsx:305`  | OnboardingDrawer → onboardingProviders.drawer.deleteModel / onboardingProviders.drawer.deleteModels / onboardingProviders.drawer.deleteSingleMessage | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/OnboardingDrawer.tsx:320`  | OnboardingDrawer → onboardingProviders.drawer.deleteFailed | 模型连接卡 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/ui/onboarding/OnboardingDrawer.tsx:339`  | OnboardingDrawer → onboardingProviders.drawer.operationFailed | 模型连接卡 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/ui/onboarding/OnboardingDrawer.tsx:357`  | OnboardingDrawer → onboardingProviders.drawer.operationFailed | 模型连接卡 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/ui/onboarding/OnboardingDrawer.tsx:606`  | OnboardingDrawer → onboardingProviders.drawer.operationFailed / modelSetup.saveFailedHint | 模型连接卡 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/ui/onboarding/OnboardingWizard.tsx:436`  | 状态派生；OnboardingWizard → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/OnboardingWizard.tsx:639`  | 状态派生；OnboardingWizard → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/OnboardingWizard.tsx:746`  | 主动打开；OnboardingWizard → modelSetup.addModel | 模型连接卡 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/ui/onboarding/VendorOnboardCard.tsx:153`  | VendorOnboardCard → onboardingProviders.vendorCard.disconnectTitle / onboardingProviders.vendorCard.disconnectMessage / onboardingProviders.vendorCard.disconnect | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/useAntigravityModelWorkspace.tsx:55`  | 状态派生；useAntigravityModelWorkspace → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/useAntigravityModelWorkspace.tsx:69`  | 状态派生；useAntigravityModelWorkspace → 原地状态容器 | 模型连接卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/ui/onboarding/vendorDeleteAction.ts:18`  | confirmAndDeleteVendor → onboardingProviders.drawer.deleteVendorDialog.title / onboardingProviders.drawer.deleteVendorDialog.message / onboardingProviders.drawer.deleteVendorDialog.confirm | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx:237`  | ComfyuiWorkflowSettingsPage → onboardingProviders.comfyWorkflow.awaitingVerification | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx:252`  | ComfyuiWorkflowSettingsPage → comfyuiWorkflowPage.header.deleteTitle / comfyuiWorkflowPage.header.deleteMessage / common.delete | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx:262`  | ComfyuiWorkflowSettingsPage → comfyuiWorkflowPage.header.deleted | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx:265`  | ComfyuiWorkflowSettingsPage → comfyuiWorkflowPage.errors.deleteFailed | 模型连接卡 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx:273`  | ComfyuiWorkflowSettingsPage → comfyuiWorkflowPage.backends.removeTitle / comfyuiWorkflowPage.backends.removeMessage / common.delete | 模型连接卡 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx:290`  | ComfyuiWorkflowSettingsPage → comfyuiWorkflowPage.backends.removed | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx:293`  | ComfyuiWorkflowSettingsPage → comfyuiWorkflowPage.backends.remove | 模型连接卡 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx:300`  | ComfyuiWorkflowSettingsPage → comfyuiWorkflowPage.backends.saved | 模型连接卡 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx:303`  | ComfyuiWorkflowSettingsPage → comfyuiWorkflowPage.backends.edit | 模型连接卡 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx:342`  | 主动打开；ComfyuiWorkflowSettingsPage → comfyuiWorkflowPage.aria | 模型连接卡 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/ui/toast.tsx:102`  | 所属事件回调 → notifications.update(notification) | 共享层；随调用对象 | 当前不区分对象是否在视线内 | 共享入口不能凭颜色猜行动 | 合并去重（身份 + 原因）；替换随机 ID |
| `src/ui/toast.tsx:104`  | 所属事件回调 → notifications.show(notification) | 共享层；随调用对象 | 当前不区分对象是否在视线内 | 共享入口不能凭颜色猜行动 | 合并去重（身份 + 原因）；替换随机 ID |
| `src/utils/showInfoToast.ts:5`  | showInfoToast → toast(message, 'info', id) | 共享层；随调用对象 | 当前不区分对象是否在视线内 | 共享入口不能凭颜色猜行动 | 合并去重（身份 + 原因）；替换随机 ID |
| `src/utils/showUndoToast.ts:58`  | showUndoToast → common.undo | 共享层；随调用对象 | 当前不区分对象是否在视线内 | 共享入口不能凭颜色猜行动 | 合并去重（身份 + 原因）；替换随机 ID |
| `src/workbench/NomiStudioApp.tsx:186`  | 用户请求关闭窗口；主进程已有关闭请求拦截 | 项目库/应用外壳 | 应用窗口；需主进程决定是否有未完成工作 | 决定是否退出 | 保留决策模态；不得扩大到每次无风险关闭 |
| `src/workbench/NomiStudioApp.tsx:362`  | NomiStudioApp → useSpendConfirmStore.getState().requestConfirm(pendingRequest as never) | 项目库/应用外壳 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/NomiStudioApp.tsx:455`  | NomiStudioApp → studio.migrationComplete | 项目库/应用外壳 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/NomiStudioApp.tsx:526`  | NomiStudioApp → studio.initializeTitle / studio.initializeMessage / common.initialize | 项目库/应用外壳 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/NomiStudioApp.tsx:531`  | NomiStudioApp → toast(message, tone ／／ 'error') | 项目库/应用外壳 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/NomiStudioApp.tsx:542`  | NomiStudioApp → studio.folderUnsupported | 项目库/应用外壳 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/NomiStudioApp.tsx:547`  | NomiStudioApp → toast(message, 'error') | 项目库/应用外壳 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/NomiStudioApp.tsx:573`  | NomiStudioApp → studio.newProjectFailed | 项目库/应用外壳 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/NomiStudioApp.tsx:594`  | NomiStudioApp → studio.demoProjectFailed | 项目库/应用外壳 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/NomiStudioApp.tsx:616`  | NomiStudioApp → studio.removeProjectTitle / studio.deleteProjectTitle / studio.removeProjectMessage | 项目库/应用外壳 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/NomiStudioApp.tsx:645`  | NomiStudioApp → studio.projectRemoved / studio.projectDeleted | 项目库/应用外壳 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/NomiStudioApp.tsx:649`  | NomiStudioApp → toast(message, 'error') | 项目库/应用外壳 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/NomiStudioApp.tsx:665`  | NomiStudioApp → studio.renameFailed | 项目库/应用外壳 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/NomiStudioApp.tsx:721`  | NomiStudioApp → studio.projectSaveFailed | 项目库/应用外壳 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/NomiStudioApp.tsx:796`  | NomiStudioApp → studio.renameFailed | 项目库/应用外壳 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/adoption/adoptionReceipt.ts:50`  | reportAdoptionOutcome → timelineEditor.adoption.alreadyOnTimeline | 素材采用入口/时间轴 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/adoption/adoptionReceipt.ts:53`  | 可撤销编辑完成；reportAdoptionOutcome → showUndoToast({ message: options.successMessage ／／ successMessageFor(outcome.proposal), // 撤销**绑定到这一次采纳**，不是无条件弹一层撤销栈。 / | 素材采用入口/时间轴 | 编辑结果可见；撤销入口非结果本身 | 撤销这笔编辑 | 保留 toast（撤销是行动价值例外）；按编辑身份去重 |
| `src/workbench/adoption/adoptionReceipt.ts:75`  | reportAdoptionOutcome → timelineEditor.adoption.stale | 素材采用入口/时间轴 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/adoption/adoptionReceipt.ts:78`  | reportAdoptionOutcome → timelineEditor.adoption.versionChanged | 素材采用入口/时间轴 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/adoption/adoptionReceipt.ts:81`  | reportAdoptionOutcome → timelineEditor.adoption.failedRecovered | 素材采用入口/时间轴 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/adoption/adoptionReceipt.ts:84`  | reportAdoptionOutcome → timelineEditor.adoption.needsRecovery | 素材采用入口/时间轴 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/adoption/adoptionReceipt.ts:87`  | reportAdoptionOutcome → generationCommon.node.generateFirst | 素材采用入口/时间轴 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/ai/ProjectAgentResidentShell.tsx:449`  | 状态派生；ProjectAgentResidentShell → 原地状态容器 | Agent 对话流 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/ai/resident/TimelineAgentReceiptEffect.tsx:40`  | 可撤销编辑完成；TimelineAgentReceiptEffect → agentResident.timelineAppliedReceipt | Agent 对话流 | 编辑结果可见；撤销入口非结果本身 | 撤销这笔编辑 | 保留 toast（撤销是行动价值例外）；按编辑身份去重 |
| `src/workbench/assets/AssetLibraryPanel.tsx:90`  | reportMediaImport → assetLibrary.importedAssets | 素材行/导入 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/assets/AssetLibraryPanel.tsx:96`  | reportMediaImport → assetLibrary.skippedSummary / assetLibrary.listSeparator | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:100`  | reportAudioImport → assetLibrary.importedAudio | 素材行/导入 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/assets/AssetLibraryPanel.tsx:105`  | reportAudioImport → assetLibrary.skippedSummary / assetLibrary.listSeparator | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:290`  | AssetLibraryContent → assetLibrary.importFailed | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:302`  | AssetLibraryContent → assetLibrary.audioImportFailed | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:306`  | AssetLibraryContent → assetLibrary.skippedUnsupported | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:480`  | AssetLibraryContent → assetLibrary.externalAssetHint | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:489`  | AssetLibraryContent → assetLibrary.deleteNoProject | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:493`  | AssetLibraryContent → assetLibrary.selectToDelete | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:496`  | AssetLibraryContent → assetLibrary.confirmDeleteTitle / assetLibrary.confirmDeleteMessage / assetLibrary.delete | 素材行/导入 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/assets/AssetLibraryPanel.tsx:513`  | AssetLibraryContent → assetLibrary.deletedProjectAssets | 素材行/导入 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/assets/AssetLibraryPanel.tsx:514`  | AssetLibraryContent → assetLibrary.deletedFiles | 素材行/导入 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/assets/AssetLibraryPanel.tsx:515`  | AssetLibraryContent → assetLibrary.cannotDeleteSelected | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:516`  | AssetLibraryContent → assetLibrary.failedFiles | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:519`  | AssetLibraryContent → assetLibrary.deleteFailed | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:525`  | AssetLibraryContent → assetLibrary.externalAssetHint | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:528`  | AssetLibraryContent → assetLibrary.confirmDeleteTitle / assetLibrary.confirmDeleteMessage / assetLibrary.delete | 素材行/导入 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/assets/AssetLibraryPanel.tsx:540`  | AssetLibraryContent → assetLibrary.failedFiles | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:541`  | AssetLibraryContent → assetLibrary.deletedProjectAssets | 素材行/导入 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/assets/AssetLibraryPanel.tsx:544`  | AssetLibraryContent → assetLibrary.deleteFailed | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetLibraryPanel.tsx:628`  | 状态派生；AssetLibraryContent → 原地状态容器 | 素材行/导入 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/assets/AssetLibraryPanel.tsx:654`  | 状态派生；AssetLibraryContent → 原地状态容器 | 素材行/导入 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/assets/AssetLibraryPanelParts.tsx:61`  | 主动打开；AssetKindFilterMenu → assetLibrary.kindFilter | 素材行/导入 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/assets/AssetPreviewDialog.tsx:55`  | AssetPreviewDialog → assetLibrary.downloadedModel3d | 素材行/导入 | 文件结果可能在磁盘/别的面 | 打开产物/所在文件夹才有行动价值 | 改状态徽标；离面且带打开动作才保留 toast |
| `src/workbench/assets/AssetPreviewDialog.tsx:56`  | AssetPreviewDialog → assetLibrary.downloadModel3dFailed | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetPreviewDialog.tsx:58`  | AssetPreviewDialog → assetLibrary.downloadModel3dFailed | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/AssetPreviewDialog.tsx:113`  | 主动打开；AssetPreviewDialog → assetLibrary.previewAria | 素材行/导入 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/assets/AssetReference.tsx:164`  | 状态派生；AssetReference → 原地状态容器 | 素材行/导入 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/assets/assetLibraryLocalImport.ts:53`  | reportImport → assetLibrary.importedAssets | 素材行/导入 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/assets/assetLibraryLocalImport.ts:56`  | reportImport → assetLibrary.skippedUnsupported | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/assetLibraryLocalImport.ts:59`  | reportImport → assetLibrary.localImportFailed | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/assetLibraryLocalImport.ts:84`  | useAssetLibraryLocalImport → assetLibrary.localImportNoImages | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/assetLibraryLocalImport.ts:94`  | useAssetLibraryLocalImport → assetLibrary.localImportFailed | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/assetLibraryLocalImport.ts:122`  | useAssetLibraryLocalImport → assetLibrary.localImportUnavailable | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/assetLibraryLocalImport.ts:129`  | useAssetLibraryLocalImport → assetLibrary.localImportFailed | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/pasteShareLinkImport.ts:52`  | runPasteShareLinkImport → assetLibrary.pasteLink.needProject | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/pasteShareLinkImport.ts:64`  | runPasteShareLinkImport → assetLibrary.pasteLink.errMissingKey | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/pasteShareLinkImport.ts:77`  | runPasteShareLinkImport → assetLibrary.pasteLink.resolving | 素材行/导入 | 节点/任务/按钮的就地状态可承担 | 进度/就绪本身不需打断 | 改状态徽标（删除 toast） |
| `src/workbench/assets/pasteShareLinkImport.ts:84`  | runPasteShareLinkImport → assetLibrary.pasteLink.done | 素材行/导入 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/assets/pasteShareLinkImport.ts:86`  | runPasteShareLinkImport → toast(describeShareLinkError(error, t), 'error') | 素材行/导入 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/assets/useAssetFolders.ts:163`  | useAssetFolderInteractions → assetLibrary.confirmDeleteFolderTitle / assetLibrary.confirmDeleteFolderMessage / assetLibrary.delete | 素材行/导入 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/capability/capabilityApplyHandler.ts:151`  | confirmSpendForAgent → runtime.capability.referenceTitle / runtime.capability.spendTitle / runtime.capability.spendMessageWithPrompt | Agent 操作涉及的项目 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/capability/capabilityApplyHandler.ts:209`  | confirmGenerationGateForAgent → runtime.capability.generationGateBatchTitle / generationCommon.production.batch.body / runtime.capability.generationGateProject | Agent 操作涉及的项目 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/capability/capabilityApplyHandler.ts:242`  | confirmGenerationGateForAgent → runtime.capability.generationGateTitle / runtime.capability.generationGateMessage / runtime.capability.confirmGenerate | Agent 操作涉及的项目 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/capability/capabilityApplyHandler.ts:274`  | confirmPlanForAgent → runtime.capability.planTitle / runtime.capability.planMessage / runtime.capability.planConfirm | Agent 操作涉及的项目 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/capability/mcpHostSurfaceOps.ts:19`  | 宿主配置自动修复完成 | Agent 操作涉及的项目 | 外部宿主受影响，应用当前面无操作可做 | 仅已修复事实，无下一步 | 删除（详细状态归连接卡） |
| `src/workbench/creation/DocumentListSidebar.tsx:86`  | DocumentListSidebar → creationAi.documentList.deleteTitle / creationAi.documentList.deleteMessage / creationAi.documentList.deleteConfirm | 创作文档 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/creation/DocumentListSidebar.tsx:96`  | DocumentListSidebar → storyboardEditor.discardTitle / storyboardEditor.planCard.discardMessage / creationAi.documentList.deleteConfirm | 创作文档 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx:230`  | onDiscard → storyboardEditor.discardTitle / storyboardEditor.discardMessage / storyboardEditor.discard | 分镜表当前行 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx:246`  | runAction → storyboardEditor.exec.actionFailed | 分镜表当前行 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx:272`  | guardMaterialize → toast(describeBlocker(t, blocker), 'error') | 分镜表当前行 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx:324`  | onAgentHandoff → storyboardEditor.agentHandoff.toast | 分镜表当前行 | 节点/任务/按钮的就地状态可承担 | 进度/就绪本身不需打断 | 改状态徽标（删除 toast） |
| `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx:409`  | onStartPlayback → storyboardEditor.playback.skipped | 分镜表当前行 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/creation/storyboard/StoryboardShotTable.tsx:204`  | deleteSelected → storyboardEditor.rowActions.deleteTitle / storyboardEditor.rowActions.deleteMessage / storyboardEditor.selection.delete | 分镜表当前行 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/creation/storyboard/StoryboardShotTable.tsx:391`  | StoryboardShotTable → storyboardEditor.rowActions.deleteTitle / storyboardEditor.rowActions.deleteMessage / storyboardEditor.row.delete | 分镜表当前行 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/creation/storyboard/shotRow/ShotReferenceZone.tsx:136`  | ShotReferenceZone → showInfoToast(t(WRONG_KIND_KEY[result.accept], { label: cell.label })) | 分镜表当前行 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/creation/storyboard/shotRow/ShotReferenceZone.tsx:140`  | ShotReferenceZone → storyboardEditor.row.slotFull | 分镜表当前行 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/creation/storyboard/shotRow/ShotReferenceZone.tsx:153`  | ShotReferenceZone → showInfoToast(t(WRONG_KIND_KEY[cell.assetSlot.accept], { label: cell.label })) | 分镜表当前行 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/creation/storyboard/shotRow/ShotReferenceZone.tsx:316`  | 状态派生；ShotReferenceZone → 原地状态容器 | 分镜表当前行 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/generationCanvas/adapters/clipboardImagePaste.ts:555`  | showClipboardMediaPasteNotes → toast(notes.join('；'), result.failedCount > 0 ? 'error' : 'info') | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/CanvasAddPreferenceActions.tsx:12`  | apply → canvas.menuPreference.saveFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/CanvasControlsHelpPopover.tsx:56`  | 主动打开；CanvasControlsHelpPopover → generationCommon.canvas.controlsHelp.aria | 画布节点/选区 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/generationCanvas/components/CommittedProposalCard.tsx:44`  | handleUndo → toast(error instanceof Error ? error.message : String(error), 'error') | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/MemoryFold.tsx:49`  | runMemoryCommand → generationCommon.memory.changeFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/ScreenshotCropOverlay.tsx:96`  | 主动打开；ScreenshotCropOverlay → generationCommon.screenshot.title | 画布节点/选区 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/generationCanvas/components/SelectionPromptSaveController.tsx:146`  | SelectionPromptSaveController → generationCommon.savePrompt.saved | 画布节点/选区 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/components/SelectionPromptSaveController.tsx:152`  | SelectionPromptSaveController → generationCommon.savePrompt.saveFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/batchPlanPreview.ts:40`  | 所属事件回调 → generationCommon.batchPlan.authorizationFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/batchPlanPreview.ts:194`  | runPlanWithToasts → generationCommon.batchPlan.unavailable / generationCommon.batchPlan.noRunnableNodes | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/batchPlanPreview.ts:214`  | 批次开始；依赖分波进度说明 | 画布节点/选区 | 节点与任务中心已有排队/执行状态 | 无额外动作 | 删除（进度归状态） |
| `src/workbench/generationCanvas/components/batchPlanPreview.ts:232`  | 批次结算；全部成功或有跳过项 | 画布节点/选区 | 成功结果已在节点；跳过原因有行动价值 | 纯成功无；有 notice 时查看阻塞 | 删除纯成功；跳过原因改内联 |
| `src/workbench/generationCanvas/components/batchPlanPreview.ts:246`  | 批次结算含失败节点 | 画布节点/选区 | 节点已有失败；批次重试是额外动作 | 只重试失败节点，仍走付费确认 | 合并去重；原面批次内联/离面保留 toast |
| `src/workbench/generationCanvas/components/batchPlanPreview.ts:271`  | runPlanWithToasts → generationCommon.batchPlan.exception | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/canvasStageDrop.ts:297`  | handleCanvasStageDrop → assetLibrary.externalAssetHint | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/canvasStageDrop.ts:302`  | handleCanvasStageDrop → generationCommon.canvas.audioToTimeline | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/canvasStageDrop.ts:340`  | handleCanvasStageDrop → generationCommon.canvas.audioToTimeline | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/canvasStageDrop.ts:399`  | importLocalFilesToGenerationCanvas → toast(notes.join('；'), result.failedCount > 0 ? 'error' : 'info') | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/useCanvasFrameActions.ts:100`  | useCanvasFrameActions → generationCommon.canvas.group.generateEmpty | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/useCanvasFrameActions.ts:113`  | useCanvasFrameActions → generationCommon.canvas.group.timelineEmpty | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/useCanvasFrameActions.ts:116`  | useCanvasFrameActions → generationCommon.canvas.group.timelineDoneWithSkips / generationCommon.canvas.group.timelineDone | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/useCanvasFrameTool.ts:130`  | useCanvasFrameTool → generationCommon.canvas.group.nestedNotSupported | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/useCanvasGroupActions.ts:45`  | useCanvasGroupActions → generationCommon.canvas.group.connectedWithSkips | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/useCanvasGroupActions.ts:53`  | useCanvasGroupActions → generationCommon.canvas.group.connectAllSkipped | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/useCanvasGroupActions.ts:55`  | useCanvasGroupActions → generationCommon.canvas.group.connectEmpty | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/useCanvasProductionActions.ts:64`  | useCanvasProductionActions → generationCommon.production.lockedModelChange | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/useCanvasProductionActions.ts:80`  | 可撤销编辑完成；useCanvasProductionActions → generationCommon.production.modelChanged | 画布节点/选区 | 编辑结果可见；撤销入口非结果本身 | 撤销这笔编辑 | 保留 toast（撤销是行动价值例外）；按编辑身份去重 |
| `src/workbench/generationCanvas/components/useCanvasScreenshotCapture.tsx:40`  | useCanvasScreenshotCapture → generationCommon.screenshot.denied | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/useCanvasScreenshotCapture.tsx:43`  | useCanvasScreenshotCapture → generationCommon.screenshot.noProject / generationCommon.screenshot.failed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/components/useCanvasShortcuts.ts:126`  | 可撤销编辑完成；handleKeyDown → generationCommon.canvas.deletedNodesUndo | 画布节点/选区 | 编辑结果可见；撤销入口非结果本身 | 撤销这笔编辑 | 保留 toast（撤销是行动价值例外）；按编辑身份去重 |
| `src/workbench/generationCanvas/components/useTidyCanvas.ts:28`  | useTidyCanvas → generationCommon.canvas.tidied | 画布节点/选区 | 节点/任务/按钮的就地状态可承担 | 进度/就绪本身不需打断 | 改状态徽标（删除 toast） |
| `src/workbench/generationCanvas/fixation/buildFixationNode.ts:81`  | applyFixationMakeup → generationCommon.derivative.fixationReady | 画布节点/选区 | 节点/任务/按钮的就地状态可承担 | 进度/就绪本身不需打断 | 改状态徽标（删除 toast） |
| `src/workbench/generationCanvas/nodes/ClipNode.tsx:394`  | handleExport → generationCommon.clipNode.exportCanvasComplete / generationCommon.clipNode.exportDownloadComplete | 画布节点/选区 | 文件结果可能在磁盘/别的面 | 打开产物/所在文件夹才有行动价值 | 改状态徽标；离面且带打开动作才保留 toast |
| `src/workbench/generationCanvas/nodes/ClipNode.tsx:398`  | handleExport → generationCommon.clipNode.exportFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/ClipNode.tsx:562`  | 主动打开；ClipNode → generationCommon.clipNode.exportOptions | 画布节点/选区 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/generationCanvas/nodes/ClipNode.tsx:615`  | 状态派生；ClipNode → 原地状态容器 | 画布节点/选区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/generationCanvas/nodes/DeferredNodeMedia.tsx:46`  | 状态派生；DeferredNodeMediaFailure → 原地状态容器 | 画布节点/选区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/generationCanvas/nodes/NodeCameraMoveControl.tsx:168`  | handleApply → generationCommon.cameraMove.created | 画布节点/选区 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/NodeDeconstructionPanel.tsx:148`  | NodeDeconstructionPanel → toast(error instanceof Error ? error.message : String(error), 'error') | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/NodeDeconstructionPanel.tsx:221`  | 主动打开；NodeDeconstructionPanel → generationCommon.node.deconstruct.title | 画布节点/选区 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/generationCanvas/nodes/NodeErrorReport.tsx:195`  | 状态派生；NodeErrorReport → generationCommon.error.failedAria | 画布节点/选区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:480`  | NodeGenerationComposer → generationCommon.composer.promptReferenceUnsupported | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/NodeMediaPreviewDialog.tsx:55`  | 主动打开；NodeMediaPreviewDialog → generationCommon.imagePreview.mediaAria | 画布节点/选区 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:336`  | handleArrayAdd → generationCommon.parameters.referenceTotal | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:345`  | handleArrayAdd → generationCommon.parameters.referenceFull | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:352`  | handleArrayAdd → generationCommon.parameters.maximum | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:773`  | 状态派生；NodeParameterControls → 原地状态容器 | 画布节点/选区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/generationCanvas/nodes/NodeRecoverableReport.tsx:44`  | 状态派生；NodeRecoverableReport → generationCommon.recoverable.aria | 画布节点/选区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/generationCanvas/nodes/NodeResultStack.tsx:291`  | remove → generationCommon.resultStack.deleteTitle / generationCommon.resultStack.deleteMessage / generationCommon.resultStack.delete | 画布节点/选区 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/generationCanvas/nodes/NodeResultStack.tsx:304`  | remove → generationCommon.resultStack.assetUnavailable | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/NodeResultStack.tsx:309`  | remove → generationCommon.resultStack.deleteFileFailed / generationCommon.resultStack.deleted | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/NodeResultStack.tsx:317`  | remove → generationCommon.resultStack.deleteFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/NodeShotCutPanel.tsx:145`  | 主动打开；NodeShotCutPanel → generationCommon.node.shotCuts.title | 画布节点/选区 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/generationCanvas/nodes/PanoramaViewer.tsx:374`  | PanoramaDialogControls → generationCommon.panorama.notReady | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/PanoramaViewer.tsx:384`  | PanoramaDialogControls → generationCommon.panorama.captureFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/PanoramaViewer.tsx:392`  | PanoramaDialogControls → generationCommon.panorama.captureFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/PanoramaViewer.tsx:402`  | 状态派生；PanoramaDialogControls → 原地状态容器 | 画布节点/选区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/generationCanvas/nodes/PanoramaViewer.tsx:584`  | 主动打开；PanoramaViewer → generationCommon.panorama.preview | 画布节点/选区 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/generationCanvas/nodes/ProductionShotPlaceholder.tsx:89`  | 状态派生；ProductionShotPlaceholder → 原地状态容器 | 画布节点/选区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/generationCanvas/nodes/ProductionShotPlaceholder.tsx:123`  | 状态派生；ProductionShotPlaceholder → 原地状态容器 | 画布节点/选区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/generationCanvas/nodes/ProvenancePanel.tsx:48`  | 主动打开；ProvenancePanel → generationCommon.provenance.dialogAria | 画布节点/选区 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/generationCanvas/nodes/Scene3DEditor.tsx:312`  | Scene3DEditor → scene3d.fullscreen.screenshotCreated | 3D 编辑器 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/Scene3DEditor.tsx:316`  | Scene3DEditor → scene3d.fullscreen.screenshotFailed | 3D 编辑器 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/artifact/ArtifactNodeToolbar.tsx:39`  | ArtifactNodeToolbar → generationCommon.resultDownload.saved | 画布节点/选区 | 文件结果可能在磁盘/别的面 | 打开产物/所在文件夹才有行动价值 | 改状态徽标；离面且带打开动作才保留 toast |
| `src/workbench/generationCanvas/nodes/artifact/ArtifactNodeToolbar.tsx:40`  | ArtifactNodeToolbar → generationCommon.resultDownload.failed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/artifact/ArtifactNodeToolbar.tsx:42`  | ArtifactNodeToolbar → generationCommon.resultDownload.failed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/artifact/ArtifactNodeToolbar.tsx:50`  | ArtifactNodeToolbar → runtime.nodeRegistry.agent-artifact.copied | 画布节点/选区 | 剪贴板不直接可见；按钮应短暂显示已复制 | 确认复制是否生效，无后续决策 | 改状态徽标（复制按钮反馈） |
| `src/workbench/generationCanvas/nodes/artifact/ArtifactNodeToolbar.tsx:51`  | ArtifactNodeToolbar → runtime.nodeRegistry.agent-artifact.copyFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/artifact/ArtifactNodeToolbar.tsx:59`  | ArtifactNodeToolbar → runtime.nodeRegistry.agent-artifact.referenceCreated | 画布节点/选区 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/artifact/ArtifactNodeToolbar.tsx:60`  | ArtifactNodeToolbar → runtime.nodeRegistry.agent-artifact.referenceFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/artifact/ArtifactNodeToolbar.tsx:62`  | ArtifactNodeToolbar → runtime.nodeRegistry.agent-artifact.referenceFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/buildContactSheetNode.ts:92`  | buildContactSheetNode → generationCommon.contactSheet.needTwo | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/buildContactSheetNode.ts:98`  | buildContactSheetNode → generationCommon.contactSheet.failed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/buildContactSheetNode.ts:124`  | buildContactSheetNode → generationCommon.contactSheet.someMissing | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/completeNodeConnection.ts:28`  | completeNodeConnection → generationCommon.canvas.group.connectedWithSkips / generationCommon.canvas.group.connectAllSkipped | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/completeNodeConnection.ts:36`  | completeNodeConnection → connection.sourceUnavailable | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/completeNodeConnection.ts:44`  | completeNodeConnection → connection.slotsFull / connection.unsupported | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/completeNodeConnection.ts:66`  | completeNodeConnection → connection.slotsFull / connection.referenceFull | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/decompose/useDecomposeLayers.ts:26`  | ensureReplicateConnectedOrGuide → generationCommon.decompose.connectTitle / generationCommon.decompose.connectMessage / generationCommon.decompose.connect | 画布节点/选区 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/generationCanvas/nodes/decompose/useDecomposeLayers.ts:62`  | useDecomposeLayers → generationCommon.decompose.working | 画布节点/选区 | 节点/任务/按钮的就地状态可承担 | 进度/就绪本身不需打断 | 改状态徽标（删除 toast） |
| `src/workbench/generationCanvas/nodes/decompose/useDecomposeLayers.ts:77`  | useDecomposeLayers → generationCommon.decompose.completed | 画布节点/选区 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/decompose/useDecomposeLayers.ts:79`  | useDecomposeLayers → generationCommon.decompose.failed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/extractDeconstructionShotsToNodes.ts:51`  | extractDeconstructionShotsToNodes → generationCommon.node.extractFrame.missingProject | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/extractDeconstructionShotsToNodes.ts:56`  | extractDeconstructionShotsToNodes → generationCommon.node.extractFrame.desktopOnly | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/extractDeconstructionShotsToNodes.ts:144`  | extractDeconstructionShotsToNodes → generationCommon.node.deconstruct.someFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/extractShotCutsToNodes.ts:30`  | extractShotCutsToNodes → generationCommon.node.extractFrame.missingProject | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/extractShotCutsToNodes.ts:35`  | extractShotCutsToNodes → generationCommon.node.extractFrame.desktopOnly | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/extractShotCutsToNodes.ts:85`  | extractShotCutsToNodes → generationCommon.node.shotCuts.someFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/extractVideoFrameToNode.ts:20`  | extractVideoFrameToNode → generationCommon.node.extractFrame.missingProject | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/extractVideoFrameToNode.ts:25`  | extractVideoFrameToNode → generationCommon.node.extractFrame.desktopOnly | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/extractVideoFrameToNode.ts:34`  | extractVideoFrameToNode → generationCommon.node.extractFrame.failed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/extractVideoFrameToNode.ts:44`  | extractVideoFrameToNode → generationCommon.node.extractFrame.empty | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/render/AudioStripNode.tsx:133`  | AudioStripNodeImpl → generationCommon.audio.uploadFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/render/AudioStripNode.tsx:178`  | AudioStripNodeImpl → generationCommon.audio.noSubtitleContent | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/render/AudioStripNode.tsx:183`  | AudioStripNodeImpl → generationCommon.audio.subtitleCopied | 画布节点/选区 | 剪贴板不直接可见；按钮应短暂显示已复制 | 确认复制是否生效，无后续决策 | 改状态徽标（复制按钮反馈） |
| `src/workbench/generationCanvas/nodes/render/CardCommon.tsx:235`  | 状态派生；RemoveBackgroundPendingStatus → generationCommon.card.removingBackground | 画布节点/选区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/generationCanvas/nodes/render/CardCommon.tsx:276`  | 状态派生；LocalImageOpPendingStatus → 原地状态容器 | 画布节点/选区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/generationCanvas/nodes/scene3d/CameraMoveCaptureHost.tsx:106`  | attachCameraMoveToTarget → toast(outcome.toast.message, outcome.toast.level) | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/Scene3DFullscreen.tsx:498`  | 主动打开；Scene3DFullscreen → scene3d.fullscreen.editorAria | 3D当前对象 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dEnvironmentPanel.tsx:120`  | Scene3DEnvironmentPanel → scene3d.environment.imageOnly | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dEnvironmentPanel.tsx:124`  | Scene3DEnvironmentPanel → scene3d.environment.fileTooLarge | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dEnvironmentPanel.tsx:138`  | Scene3DEnvironmentPanel → scene3d.environment.dimensionsUnreadable | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dEnvironmentPanel.tsx:145`  | Scene3DEnvironmentPanel → scene3d.environment.nonStandardImported | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dEnvironmentPanel.tsx:163`  | Scene3DEnvironmentPanel → scene3d.environment.imported | 3D当前对象 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dEnvironmentPanel.tsx:172`  | Scene3DEnvironmentPanel → scene3d.environment.importedTemporary | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dEnvironmentPanel.tsx:177`  | Scene3DEnvironmentPanel → scene3d.environment.importFailed | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dToolbar.tsx:490`  | 主动打开；SceneAddToolbar → scene3d.toolbar.addCrowdAria | 3D当前对象 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DCaptureExport.ts:38`  | useScene3DCaptureActions → scene3d.fullscreen.screenshotFailed | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DCaptureExport.ts:58`  | useScene3DCaptureActions → scene3d.fullscreen.cameraScreenshotFailed | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DCaptureExport.ts:97`  | useScene3DMoveFrameExport → scene3d.fullscreen.cameraHasNoMove | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DCaptureExport.ts:111`  | useScene3DMoveFrameExport → scene3d.fullscreen.frameExportFailed | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DCaptureExport.ts:127`  | useScene3DMoveFrameExport → scene3d.fullscreen.frameExported | 3D当前对象 | 文件结果可能在磁盘/别的面 | 打开产物/所在文件夹才有行动价值 | 改状态徽标；离面且带打开动作才保留 toast |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DCaptureExport.ts:135`  | useScene3DMoveFrameExport → scene3d.fullscreen.frameExportTimeout | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:55`  | toastPickCameraFirst → scene3d.fullscreen.selectCameraForScreenshot / scene3d.fullscreen.selectNamedCamera | 3D当前对象 | 当前对象存在；动作尚未在原地显示 | 有明确动作；应靠近被拦住的控件 | 改内联（保留现有动作） |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:62`  | toastPickCameraFirst → scene3d.fullscreen.addCameraForScreenshot | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:150`  | useScene3DClipboardActions → toast(objectLimitMessage(), 'warning') | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:283`  | useScene3DTrajectoryModeActions → scene3d.fullscreen.singleTrajectory | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:299`  | useScene3DTrajectoryModeActions → scene3d.trajectory.bindBeforePlay / scene3d.trajectory.goBindTarget | 3D当前对象 | 当前对象存在；动作尚未在原地显示 | 有明确动作；应靠近被拦住的控件 | 改内联（保留现有动作） |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:442`  | useScene3DAddActions → toast(objectLimitMessage(), 'warning') | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:456`  | useScene3DAddActions → toast(objectLimitMessage(), 'warning') | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:488`  | useScene3DAddActions → toast(objectLimitMessage(), 'warning') | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:504`  | useScene3DAddActions → scene3d.fullscreen.templateLimit | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:511`  | useScene3DAddActions → scene3d.fullscreen.templateApplied | 3D当前对象 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:583`  | useScene3DCameraMoveAction → scene3d.fullscreen.presetAppended | 3D当前对象 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:697`  | useScene3DExportActions → scene3d.export.moveReady | 3D当前对象 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:741`  | useScene3DExportActions → scene3d.export.referenceVideoUnsupported | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:752`  | useScene3DExportActions → scene3d.export.bindCameraFirst / scene3d.export.bindAndGenerate | 3D当前对象 | 当前对象存在；动作尚未在原地显示 | 有明确动作；应靠近被拦住的控件 | 改内联（保留现有动作） |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:764`  | useScene3DExportActions → scene3d.export.cameraMoveRequired | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DFullscreenActions.ts:778`  | useScene3DExportActions → scene3d.fullscreen.selectCameraFirst | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DTakeRecorder.ts:193`  | useScene3DTakeRecorder → scene3d.character.recordingStopped | 3D当前对象 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DTakeRecorder.ts:221`  | useScene3DTakeRecorder → scene3d.character.noCameraMove | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DTakeRecorder.ts:238`  | useScene3DTakeRecorder → scene3d.character.noCharacterMove | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DTaskFlow.ts:93`  | useScene3DTaskFlow → scene3d.taskFlow.addCharacterBeforeRecord | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/scene3d/useScene3DTaskFlow.ts:139`  | useScene3DTaskFlow → scene3d.taskFlow.addCameraForOutputView | 3D当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeAssetDrop.ts:36`  | reportOutcome → generationCommon.node.assetDrop.full | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeAssetDrop.ts:38`  | reportOutcome → generationCommon.node.assetDrop.noSlot | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeAssetDrop.ts:79`  | useNodeAssetDrop → generationCommon.node.assetDrop.noSlot | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeAssetDrop.ts:96`  | useNodeAssetDrop → generationCommon.node.assetDrop.unsupported | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeAssetDrop.ts:112`  | useNodeAssetDrop → generationCommon.node.assetDrop.uploadFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeDragResize.ts:331`  | handlePointerUp → generationCommon.node.generateBeforeTimeline | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeImageEditing.ts:357`  | useNodeImageEditing → generationCommon.imageToolbar.editFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeImageEditing.ts:411`  | useNodeImageEditing → generationCommon.imageToolbar.editFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeImageEditing.ts:485`  | useNodeImageEditing → generationCommon.whiteboard.removeBackgroundFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeMentionSource.ts:94`  | useNodeMentionSource → connection.sourceUnavailable / connection.unsupported | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeMentionSource.ts:107`  | useNodeMentionSource → connection.unsupported | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeMentionSource.ts:109`  | useNodeMentionSource → connection.slotsFull | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeMentionSource.ts:129`  | useNodeMentionSource → connection.referenceFull | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:242`  | 供应商断开后自动选择替代模型 effect | 画布节点/选区 | 节点模型选择器已显示目标；变更原因未内联 | 查看新模型/修改；不可隐瞒变更 | 改内联（仅通知归属；C50 切换逻辑冻结） |
| `src/workbench/generationCanvas/nodes/useNodePanoramaHandlers.ts:60`  | useNodePanoramaHandlers → generationCommon.panorama.captureFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useNodePanoramaHandlers.ts:94`  | useNodePanoramaHandlers → generationCommon.node.panoramaScreenshotCreated | 画布节点/选区 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/useResultDownload.ts:39`  | useResultDownload → generationCommon.resultDownload.saved | 画布节点/选区 | 文件结果可能在磁盘/别的面 | 打开产物/所在文件夹才有行动价值 | 改状态徽标；离面且带打开动作才保留 toast |
| `src/workbench/generationCanvas/nodes/useResultDownload.ts:40`  | useResultDownload → generationCommon.resultDownload.failed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/useResultDownload.ts:43`  | useResultDownload → generationCommon.resultDownload.failed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardDrawingTool.tsx:226`  | 所属事件回调 → generationCommon.whiteboard.selectImageFile | 白板当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardDrawingTool.tsx:235`  | 所属事件回调 → generationCommon.whiteboard.importFailed | 白板当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardDrawingTool.tsx:393`  | 所属事件回调 → generationCommon.whiteboard.deleteBlockedLocked | 白板当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardDrawingTool.tsx:394`  | 所属事件回调 → generationCommon.whiteboard.deleteBlockedBackground | 白板当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardDrawingTool.tsx:431`  | 所属事件回调 → generationCommon.whiteboard.backgroundRemoved | 白板当前对象 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardDrawingTool.tsx:433`  | 所属事件回调 → generationCommon.whiteboard.removeBackgroundFailed | 白板当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardDrawingTool.tsx:465`  | 状态派生；所属事件回调 → generationCommon.whiteboard.removingBackgroundAria | 白板当前对象 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardModal.tsx:198`  | WhiteboardModal → generationCommon.whiteboard.savedPrimary | 白板当前对象 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardModal.tsx:204`  | WhiteboardModal → generationCommon.whiteboard.saveFailed | 白板当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardModal.tsx:230`  | WhiteboardModal → generationCommon.whiteboard.savedPrimary | 白板当前对象 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardModal.tsx:285`  | WhiteboardModal → generationCommon.whiteboard.screenshotCreated | 白板当前对象 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardModal.tsx:287`  | WhiteboardModal → generationCommon.whiteboard.screenshotFailed | 白板当前对象 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardModal.tsx:308`  | 主动打开；WhiteboardModal → generationCommon.whiteboard.title | 白板当前对象 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx:141` 〔冻结，只读〕 | GenerationCanvasReactFlowInner → generationCommon.selection.workflowSaved | 画布节点/选区 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/reactFlow/canvasDragWriteback.ts:64` 〔冻结，只读〕 | commitCanvasNodeDragStop → generationCommon.node.generateBeforeTimeline | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowEffects.ts:59` 〔冻结，只读〕 | handleFocusNode → generationCommon.node.sourceNoLongerExists | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowEffects.ts:189` 〔冻结，只读〕 | useBrowserAssetImportEffects → generationCommon.canvas.noImportableAssets | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowEffects.ts:192` 〔冻结，只读〕 | useBrowserAssetImportEffects → generationCommon.canvas.importedOne / generationCommon.canvas.importedMany | 画布节点/选区 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/generationCanvas/runner/generationQueueStore.ts:157`  | 所属事件回调 → taskCenter.brake.toast | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/runner/generationRunController.ts:605`  | confirmAndRunNode → generationCommon.batchPlan.authorizationFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/runner/generationRunController.ts:651`  | confirmAndRunNodeVariants → generationCommon.batchPlan.authorizationFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/runner/generationRunController.ts:700`  | regenerateNodeInPlace → generationCommon.batchPlan.authorizationFailed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/runner/localTaskControl.ts:52`  | requestTaskCancel → generationCommon.comfyuiCancel.failed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/runner/localTaskControl.ts:60`  | requestTaskCancel → generationCommon.comfyuiCancel.failed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/runner/localTaskControl.ts:67`  | requestTaskCancel → generationCommon.comfyuiCancel.queueOnly | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/runner/localTaskControl.ts:68`  | requestTaskCancel → generationCommon.comfyuiCancel.failed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/runner/localTaskControl.ts:70`  | requestTaskCancel → generationCommon.comfyuiCancel.failed | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:145`  | 共享决定请求队列打开 | 画布节点/选区 | 决定尚未作出 | 批准/取消/危险确认 | 保留决策模态（共享） |
| `src/workbench/generationCanvas/spend/spendConfirm.ts:215`  | confirmGenerationSpend → useSpendConfirmStore.getState().requestConfirm({ title: opts.title, message: opts.message, ...(opts.confirmLabel ? { con | 画布节点/选区 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/generationCanvas/textEdit/buildTextEditNode.ts:80`  | applyTextEdit → generationCommon.derivative.textEditReady | 画布节点/选区 | 节点/任务/按钮的就地状态可承担 | 进度/就绪本身不需打断 | 改状态徽标（删除 toast） |
| `src/workbench/generationCanvas/videoDepth/startVideoDepthDerivation.ts:65`  | startVideoDepthDerivation → generationCommon.node.extractFrame.missingProject | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/generationCanvas/videoDepth/startVideoDepthDerivation.ts:70`  | startVideoDepthDerivation → videoDepth.action.desktopOnly | 画布节点/选区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/library/ProjectLibraryPage.tsx:638`  | 主动打开；ProjectLibraryPage → 编辑/预览容器 | 项目/工作流库当前卡 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/library/ProjectLibraryPage.tsx:670`  | 状态派生；ProjectLibraryPage → 原地状态容器 | 项目/工作流库当前卡 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/library/WorkflowLibraryContent.tsx:192`  | 主动打开；WorkflowEditDialog → libraries.workflow.editTitle | 项目/工作流库当前卡 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/library/WorkflowLibraryContent.tsx:255`  | WorkflowLibraryContent → libraries.workflow.unavailable | 项目/工作流库当前卡 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/library/WorkflowLibraryContent.tsx:265`  | WorkflowLibraryContent → libraries.workflow.assetCopyFailed / libraries.workflow.copied | 项目/工作流库当前卡 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/onboarding/HandbookPanel.tsx:101`  | 主动打开；HandbookPanel → onboardingProviders.handbook.aria | 用户进入的引导旅程 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/onboarding/JourneyTourController.tsx:30`  | 主动打开；JourneyTourController → onboardingProviders.journey.finaleAria | 用户进入的引导旅程 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/onboarding/JourneyTourController.tsx:96`  | 状态派生；JourneyTourController → 原地状态容器 | 用户进入的引导旅程 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/onboarding/OnboardingSpotlight.tsx:151`  | 主动打开；OnboardingSpotlight → 编辑/预览容器 | 用户进入的引导旅程 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/onboarding/SplashIntro.tsx:137`  | 主动打开；SplashIntro → onboardingProviders.splash.aria | 用户进入的引导旅程 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/preview/TimelinePreview.tsx:271`  | TimelinePreview → timelinePreview.exportComplete | 预览与导出面 | 文件结果可能在磁盘/别的面 | 打开产物/所在文件夹才有行动价值 | 改状态徽标；离面且带打开动作才保留 toast |
| `src/workbench/preview/TimelinePreview.tsx:279`  | TimelinePreview → toast(message, 'error') | 预览与导出面 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/preview/TimelinePreview.tsx:410`  | 状态派生；TimelinePreview → 原地状态容器 | 预览与导出面 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/production/ProductionCanvasLandingHost.tsx:110`  | 每 1.5s 轮询；完成镜数变化更新常驻条 | 制作任务/画布 | 是：占位节点/任务中心已有实时进度 | 无额外操作；不能关闭 | 删除（保留节点进度/轮询） |
| `src/workbench/production/productionShotActions.ts:34`  | 返工/续拍结构化结果 reworked/resumed/declined/failed | 制作任务/画布 | 节点已有重跑状态；拒绝就是用户刚做的决定 | 失败需原因/重试；成功/取消无需重复 | 删除成功/取消；失败改内联 |
| `src/workbench/production/useProductionStatus.ts:103`  | useProductionStatus → generationCommon.production.roughCut.title / generationCommon.production.roughCut.message / generationCommon.production.roughCut.accept | 制作任务/画布 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/production/useProductionStatus.ts:120`  | useProductionStatus → generationCommon.production.gate.failed | 制作任务/画布 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/workbench/production/useProductionStatus.ts:143`  | useProductionStatus → generationCommon.production.control.failed | 制作任务/画布 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/workbench/production/useProductionStatus.ts:152`  | useProductionStatus → generationCommon.production.reconcile.questionTitle / generationCommon.production.reconcile.message / generationCommon.production.reconcile.unknownProvider | 制作任务/画布 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/production/useProductionStatus.ts:163`  | useProductionStatus → generationCommon.production.reconcile.notFoundTitle / generationCommon.production.reconcile.notFoundMessage / generationCommon.production.reconcile.confirmNotFound | 制作任务/画布 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/production/useProductionStatus.ts:183`  | useProductionStatus → generationCommon.production.reconcile.failed | 制作任务/画布 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/workbench/production/useProductionStatus.ts:205`  | useProductionStatus → generationCommon.production.checkpoint.title | 制作任务/画布 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/production/useProductionStatus.ts:228`  | useProductionStatus → generationCommon.production.gate.failed | 制作任务/画布 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/workbench/production/useProductionStatus.ts:248`  | useProductionStatus → generationCommon.production.gate.failed | 制作任务/画布 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/workbench/production/useProductionStatus.ts:269`  | useProductionStatus → generationCommon.production.gate.failed | 制作任务/画布 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/workbench/production/useProductionStatus.ts:289`  | useProductionStatus → generationCommon.production.gate.sampleApprove / generationCommon.production.gate.shotApprove / generationCommon.production.gate.approve | 制作任务/画布 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/production/useProductionStatus.ts:338`  | useProductionStatus → generationCommon.production.gate.failed | 制作任务/画布 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/workbench/production/useProductionStatus.ts:356`  | 执行决定失败，询问去设置 | 制作任务/画布 | 任务卡存在；应显示失败原因 | 去对应配置解决原因 | 改内联（任务卡带设置动作） |
| `src/workbench/production/useProductionStatus.ts:392`  | useProductionStatus → generationCommon.production.control.cancelTitle / generationCommon.production.control.cancelMessage / generationCommon.production.control.cancelConfirm | 制作任务/画布 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/production/useProductionStatus.ts:410`  | useProductionStatus → generationCommon.production.control.failed | 制作任务/画布 | 对象可见；错误仅弹框 | 读原因；无需决定 | 改内联：原因+重试/修改 |
| `src/workbench/project/projectHydrationRecovery.ts:36`  | hydrateWorkbenchProjectWithRecovery → studio.projectRecoveryTitle / studio.projectRecoveryMessage / studio.projectRecoveryConfirm | 项目打开/恢复入口 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/project/projectHydrationRecovery.ts:49`  | hydrateWorkbenchProjectWithRecovery → studio.projectRecoveryComplete | 项目打开/恢复入口 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/project/projectHydrationRecovery.ts:52`  | 项目文件夹缺失 | 项目打开/恢复入口 | 后续紧接修复确认，同一失败说两次 | 定位/修复 | 合并去重（保留原地缺失状态和修复动作） |
| `src/workbench/project/projectHydrationRecovery.ts:54`  | 缺失项目文件夹后询问打开文件夹 | 项目打开/恢复入口 | 缺失对象在项目库已有状态 | 定位文件夹；无需强制停下决定 | 改内联（修复/打开文件夹动作） |
| `src/workbench/project/projectHydrationRecovery.ts:67`  | hydrateWorkbenchProjectWithRecovery → studio.projectNotFound | 项目打开/恢复入口 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/promptLibrary/PromptLibraryPanel.tsx:165`  | 可撤销编辑完成；PromptLibraryContent → libraries.prompt.sentToCanvas / libraries.prompt.category.video / libraries.prompt.storyboard | 提示词库当前条目 | 编辑结果可见；撤销入口非结果本身 | 撤销这笔编辑 | 保留 toast（撤销是行动价值例外）；按编辑身份去重 |
| `src/workbench/promptLibrary/PromptLibraryPanel.tsx:176`  | 可撤销编辑完成；PromptLibraryContent → libraries.prompt.removedFromMine | 提示词库当前条目 | 编辑结果可见；撤销入口非结果本身 | 撤销这笔编辑 | 保留 toast（撤销是行动价值例外）；按编辑身份去重 |
| `src/workbench/promptLibrary/PromptPreviewOverlay.tsx:97`  | 主动打开；PromptPreviewOverlay → 编辑/预览容器 | 提示词库当前条目 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/settings/AiModelsSection.tsx:331`  | 状态派生；AiModelsSection → 原地状态容器 | 设置当前分区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/settings/AttentionSoundSection.tsx:100`  | 状态派生；AttentionSoundSection → 原地状态容器 | 设置当前分区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/settings/AutomationPermissionsSection.tsx:146`  | 状态派生；AutomationPermissionsSection → 原地状态容器 | 设置当前分区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/settings/AutomationPermissionsSection.tsx:167`  | 状态派生；AutomationPermissionsSection → 原地状态容器 | 设置当前分区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/settings/ProjectLocationSection.tsx:46`  | ProjectLocationSection → settings.file.projectLocationErrorUnknown | 设置当前分区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/settings/ProjectLocationSection.tsx:61`  | run → toast(t(ERROR_KEY[result.error]), 'error') | 设置当前分区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/settings/ProjectLocationSection.tsx:64`  | run → settings.file.projectLocationErrorUnknown | 设置当前分区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/settings/ProjectLocationSection.tsx:83`  | checkDirectory → settings.file.projectLocationCheckSuccess | 设置当前分区 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/settings/ProjectLocationSection.tsx:86`  | checkDirectory → toast(t(ERROR_KEY[result.error]), 'error') | 设置当前分区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/settings/ProjectLocationSection.tsx:90`  | checkDirectory → settings.file.projectLocationErrorUnknown | 设置当前分区 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/settings/ProjectLocationSection.tsx:194`  | 状态派生；ProjectLocationSection → 原地状态容器 | 设置当前分区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/settings/SettingsDialog.tsx:102`  | SettingsDialog → settings.unsaved.title / settings.unsaved.message / settings.unsaved.discard | 设置当前分区 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/settings/SettingsDialog.tsx:245`  | 主动打开；SettingsDialog → settings.title | 设置当前分区 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/settings/SystemPromptSection.tsx:206`  | SystemPromptSection → settings.ai.systemPrompt.deleteTitle / settings.ai.systemPrompt.deleteMessage / settings.ai.systemPrompt.delete | 设置当前分区 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/settings/VendorPreferenceOrderSection.tsx:62`  | 状态派生；VendorPreferenceOrderSection → 原地状态容器 | 设置当前分区 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/sidebar/CategoryTree.tsx:204`  | 可撤销编辑完成；CategoryTree → libraries.sidebar.copiedTo | 侧栏当前分类/节点 | 编辑结果可见；撤销入口非结果本身 | 撤销这笔编辑 | 保留 toast（撤销是行动价值例外）；按编辑身份去重 |
| `src/workbench/sidebar/CategoryTree.tsx:225`  | 可撤销编辑完成；CategoryTree → libraries.sidebar.copiedToGroup | 侧栏当前分类/节点 | 编辑结果可见；撤销入口非结果本身 | 撤销这笔编辑 | 保留 toast（撤销是行动价值例外）；按编辑身份去重 |
| `src/workbench/sidebar/CategoryTree.tsx:284`  | CategoryTree → libraries.sidebar.deleteCategoryTitle / libraries.sidebar.deleteCategoryMessage / common.delete | 侧栏当前分类/节点 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/sidebar/CategoryTree.tsx:304`  | CategoryTree → libraries.sidebar.nodeName | 侧栏当前分类/节点 | 用户正操作的名称/对象可见 | 输入名字 | 改内联（节点/书签原地改名） |
| `src/workbench/sidebar/CategoryTree.tsx:320`  | CategoryTree → libraries.sidebar.deleteNodeTitle / libraries.sidebar.deleteNodeMessage / common.delete | 侧栏当前分类/节点 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/sidebar/CategoryTree.tsx:343`  | CategoryTree → libraries.sidebar.deleteGroupTitle / libraries.sidebar.deleteGroupMessage / common.delete | 侧栏当前分类/节点 | 待决定；未执行 | 确认/取消（破坏/费用/授权） | 保留决策模态 |
| `src/workbench/skillLibrary/SkillCard.tsx:52`  | 状态派生；SkillCard → 原地状态容器 | 技能库当前条目 | 是：原地信息 | 读原因/进度/状态 | 保留原地状态 |
| `src/workbench/skillLibrary/SkillLibraryPanel.tsx:107`  | SkillLibraryContent → libraries.skill.exportNotFound | 技能库当前条目 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/skillLibrary/SkillLibraryPanel.tsx:127`  | SkillLibraryContent → libraries.skill.deleteFailed | 技能库当前条目 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/skillLibrary/SkillLibraryPanel.tsx:130`  | 可撤销编辑完成；SkillLibraryContent → libraries.skill.deleted | 技能库当前条目 | 编辑结果可见；撤销入口非结果本身 | 撤销这笔编辑 | 保留 toast（撤销是行动价值例外）；按编辑身份去重 |
| `src/workbench/skillLibrary/SkillLibraryPanel.tsx:150`  | SkillLibraryContent → toast(t(libraries.skill.importReason.${parsed.reason}), 'error') | 技能库当前条目 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/skillLibrary/SkillLibraryPanel.tsx:155`  | SkillLibraryContent → libraries.skill.importFailed / libraries.skill.unknownError | 技能库当前条目 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/skillLibrary/SkillLibraryPanel.tsx:160`  | SkillLibraryContent → libraries.skill.importedWithSkips / libraries.skill.imported | 技能库当前条目 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/taskCenter/TaskCenterPanel.tsx:214`  | runAction → taskCenter.actionFailed | 任务中心当前任务 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/taskCenter/TaskCenterPanel.tsx:220`  | 主动打开；TaskCenterPanel → taskCenter.title | 任务中心当前任务 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/taskCenter/taskCenterSettings.ts:11`  | notifyBatchFinished → bridge.notifications.show({ title: input.title, body: input.body, event: input.event ?? 'completed' }) | 任务中心当前任务 | 窗口失焦；前台抑制 | 点击返回窗口；制作通知可深链 run | 保留系统通知；身份/批次去重 |
| `src/workbench/taskCenter/useBatchFinishNotifier.ts:24`  | useBatchFinishNotifier → settings.sound.brand / settings.sound.slow | 任务中心当前任务 | 窗口失焦；前台抑制 | 点击返回窗口；制作通知可深链 run | 保留系统通知；身份/批次去重 |
| `src/workbench/taskCenter/useBatchFinishNotifier.ts:35`  | useBatchFinishNotifier → taskCenter.notification.title / taskCenter.notification.bodyWithFailures / taskCenter.notification.body | 任务中心当前任务 | 窗口失焦；前台抑制 | 点击返回窗口；制作通知可深链 run | 保留系统通知；身份/批次去重 |
| `src/workbench/timeline/TimelineContextMenu.tsx:103`  | TimelineContextMenu → timelineEditor.context.alignToShotMissing | 时间轴轨道/片段 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/timeline/TimelineContextMenu.tsx:121`  | TimelineContextMenu → timelineEditor.context.applyTransitionAllNone | 时间轴轨道/片段 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/timeline/TimelineContextMenu.tsx:125`  | TimelineContextMenu → timelineEditor.context.applyTransitionAllDone | 时间轴轨道/片段 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |
| `src/workbench/timeline/TimelinePanel.tsx:115`  | TimelinePanel → timelineEditor.storyboardScopeRequired | 时间轴轨道/片段 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/timeline/TimelinePanel.tsx:119`  | TimelinePanel → timelineEditor.noShots | 时间轴轨道/片段 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/timeline/TimelineSecondaryAddRow.tsx:53`  | onDrop → assetLibrary.externalAssetHint | 时间轴轨道/片段 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/timeline/TimelineSecondaryAddRow.tsx:90`  | TimelineSecondaryAddRow → timelineEditor.adoption.failedRecovered | 时间轴轨道/片段 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/timeline/TimelineSecondaryAddRow.tsx:94`  | TimelineSecondaryAddRow → timelineEditor.adoption.failedRecovered | 时间轴轨道/片段 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/timeline/TimelineShortcutsDialog.tsx:21`  | 主动打开；TimelineShortcutsDialog → timelineEditor.shortcuts.title | 时间轴轨道/片段 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/timeline/TimelineTrack.tsx:133`  | TimelineTrack → assetLibrary.externalAssetHint | 时间轴轨道/片段 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/timeline/TimelineTrack.tsx:140`  | TimelineTrack → timelineEditor.track.wrongType | 时间轴轨道/片段 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/timeline/TimelineTrack.tsx:156`  | TimelineTrack → timelineEditor.track.unavailable | 时间轴轨道/片段 | 对象可见；未见错误承载 | 修改/重试（多无按钮） | 改内联：原因+行动 |
| `src/workbench/timeline/TimelineTransitionPicker.tsx:42`  | 主动打开；TimelineTransitionPicker → timelineEditor.transition.pickerTitle | 时间轴轨道/片段 | 任务工作面 | 编辑/选择/关闭 | 主动工作面 |
| `src/workbench/timeline/addAssetToTimeline.ts:107`  | addAssetToTimelineEnd → timelineEditor.addedToEnd | 时间轴轨道/片段 | 对象/列表已反映成功 | 无额外动作 | 删除：已有成功状态 |

## 非词面入口补查（不重复计入 469）

| 文件:行（基线） | 触发时机 | 用户所在面 | 是否已原地可见 | 行动 | 判定 |
|---|---|---|---|---|---|
| `src/NomiAppProviders.tsx:24` | Mantine 全局 Notifications 容器常驻 | 任意面 | 无对象归属 | 仅渲染 | 保留单容器；共享策略决定是否投递 |
| `src/ui/toast.tsx:96` | 无 id 时 Date.now + random 建身份 | 任意面 | 未检查 | 无 | 合并去重；身份与原因由领域提供，不能用时间/随机数 |
| `src/design/confirmDialogStore.ts:23` | 全局提交/挂载前排队 | 决策对象所在面 | 尚未决定 | 确认/取消 | 保留共享轨道；同一决定不叠队 |
| `src/workbench/library/ProjectLibraryPage.tsx:354` | 尚无可用模型时 model-banner | 项目库 | 是：库头部条幅 | 配置模型 | 保留 banner；真正阻止生成且有去配置动作 |
| `src/workbench/generationCanvas/nodes/scene3d/scene3dTrajectorySurfaces.tsx:42` | 轨迹状态给出可进入编辑的 banner | 当前 3D 轨迹 | 是 | 进入轨迹编辑 | 保留原地状态/动作 |
| `electron/desktopNotification.ts:20` | OS Notification 真正创建 | 窗口外 | 否；主进程先拦 focused | 聚焦窗口/生产 run 深链 | 保留；遵守用户开关/按事件音效 |
| `electron/main.ts:635` | 打开普通文件夹，需要初始化工作区 | 用户主动选的目录 | 尚未初始化 | 初始化/取消 | 保留决策模态；不能跳过授权 |
| `src/workbench/assets/pasteShareLinkImport.ts:69` | deps.prompt 注入链接输入框 | 素材库贴链接入口 | 链接尚未输入 | 提供链接/取消 | 主动工作面；可在原入口编辑，非错误通知 |
| `electron/agentLane/laneHost.mts:285`〔冻结〕 | 审批结果 appendCustomEntry | Agent 工具所在行 | 是；正式工具结果已有拒绝原因 | 展示拒绝状态 | 保留原地投影，不派生 toast |
| `electron/agentLane/laneHost.mts:355`〔冻结〕 | 追加审批领域记录 | Agent 工具所在行 | 是 | 同上 | 保留原地投影，不多长一行 |
| `electron/agentLane/laneHost.mts:371`〔冻结〕 | 追加任务领域记录 | Agent 流 | 任务卡从领域实时取事实 | 查看制作任务 | 保留任务卡，不当 toast |
| `electron/shared/agentLane/laneContracts.ts:311` | nomi.ui.* 前缀契约 | Agent 流 | 不是通知生产者 | UI-only 内容不进入模型上下文 | 保留契约，禁止误删为“通知噪声” |
| `electron/shared/agentLane/laneProjection.ts:210` | nomi.ui.task 投影为 task | Agent 流任务卡 | 是：与领域 join 实时事实 | 查看/处理任务 | 保留原地卡 |
| `src/workbench/ai/lane/laneViewModel.ts:244`〔冻结〕 | nomi.ui.approval 修正对应工具行状态 | Agent 流工具行 | 是：拒绝文案已经在工具结果 | 查看拒绝原因 | 保留原行，host-note 不占新行 |
| `src/workbench/generationCanvas/spend/spendConfirm.ts:178` | 付费通用包装器调用确认 | 当前生成对象 | 成本尚待决定 | 批准/取消 | 保留付费模态 |
| `src/workbench/generationCanvas/components/batchPlanPreview.ts:133` | 批次启动前费用/托管披露 | 批次选区 | 尚未授权 | 批准/取消 | 保留付费模态 |
| `src/workbench/generationCanvas/runner/generationRunController.ts:580` | 单节点生成前确认 | 当前节点 | 尚未授权 | 批准/取消 | 保留付费模态 |
| `src/workbench/generationCanvas/runner/generationRunController.ts:638` | 多变体生成前统一确认 | 当前节点 | 尚未授权 | 批准数量/取消 | 保留付费模态 |
| `src/workbench/generationCanvas/runner/generationRunController.ts:688` | 原地重新生成前确认 | 当前节点 | 尚未授权 | 批准/取消 | 保留付费模态 |

## 迁移验收边界

1. 每个“改内联”必须在对象宿主可见、可读、可以重试/修改后，才能移除原始错误通知。不能把这张目标裁决表当实施收据。
2. 同一身份同一原因 5 次只留一条最新内容并显示次数；不同项目、节点、批次、撤销事务必须隔离。批次不能继续共用一个全局 BATCH_RUN_TOAST_ID。
3. 复制类应在按钮短暂显示已复制；批量失败保留失败对象集合和重试动作；系统通知维持 focused 抑制。可撤销编辑的 toast 身份必须属于该笔编辑，不能仅按同文案合并导致动作失真。
4. 更新检测到新版本不是立即决策，应先角标；现有更新详情由用户点击打开。安装重启才是明确用户动作，不应因 phase 变化重开覆盖工作面。
5. 自选帮助/预览/3D/白板/设置工作面保留。aria role=dialog 并不意味着“自动弹窗”，不按角色名机械清理。
6. 本表为基线审查。实施范围、冻结项、真实前后截图与验证必须由主策略文档和交付收据逐项对账；没有真实走查证据不得写“全面优化完成”。

## 最终实施 AST 收据（2026-09-09）

快照：2026-09-09T17:44:37+08:00；基线仍为 `1d565961f`。以上469行基线主表及补查表完整保留，行号仍表示基线；下面单独记录当前工作区的实际调用数量。扫描限定基线已跟踪的生产 `.ts/.tsx`（排除测试/devlab），原生、`.mts`、动态协议等仍由上面补查表逐项说明。尚未交付的工作区快照不等于 gates/截图验收收据。

| 原入口 | 基线调用 | 当前原入口语法调用 | 已删除/替换为上下文入口 | 剩余性质 |
|---|---:|---:|---:|---|
| `toast` | 252 | 6 | 246 | 冻结 React Flow 5 + showInfoToast 共享包装 1 |
| `showInfoToast` | 32 | 1 | 31 | C50 模型切换调用 1，按禁令不改 |
| `alertDialog` | 21 | 0 | 21 | 纯告知模态入口全部移除；必要确认不变 |
| `useToastStore.getState().push` | 10 | 1 | 9 | 撤销共享包装 1，事务身份已加强；不是普通业务提示 |

**原315个 toast/info/alert/store 入口中，307个原语法调用已删除或改为有上下文的通知入口；剩余8个语法调用 = 冻结5 + C50调用1 + info包装1 + undo包装1。** 307是原调用差值，不是当前 `notify` 数量。另对全部原调用的文件/类别/归一化AST文本做多重集核对：7个完全未改，308个原调用删除或改写；这比307多的1个是仍保留 `.push` 语法但改了独立事务ID的undo包装器，不能重复算成“又清理了一个业务提示”。

业务口径单列：剔除原本就属于共享包装器的 info 与 undo 两层，313个原业务入口中307个已迁移/删除，余下6个均有明确不动约束（React Flow 5 + C50 1）。`CameraMoveCaptureHost` 的附着结果提示已改为有身份、有定位动作的上下文入口，未改 `computeAttachCameraMove` 或切换逻辑，不再冒称C50例外。

### 当前保留原入口逐条核对

| 当前文件:行 | 入口 | 保留原因 |
|---|---|---|
| `src/utils/showInfoToast.ts:5` | `toast` | info共享包装，服务保留的C50调用 |
| `src/utils/showUndoToast.ts:59` | `useToastStore.getState().push` | 撤销共享包装，保留用户可撤销操作；事务ID已独立 |
| `src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts:242` | `showInfoToast` | C50 模型供应商自动切换，按禁令不改 |
| `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx:141` | `toast` | 冻结 React Flow 宿主，按任务禁令不改 |
| `src/workbench/generationCanvas/reactFlow/canvasDragWriteback.ts:64` | `toast` | 冻结 React Flow 宿主，按任务禁令不改 |
| `src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowEffects.ts:59` | `toast` | 冻结 React Flow 宿主，按任务禁令不改 |
| `src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowEffects.ts:189` | `toast` | 冻结 React Flow 宿主，按任务禁令不改 |
| `src/workbench/generationCanvas/reactFlow/useGenerationCanvasReactFlowEffects.ts:192` | `toast` | 冻结 React Flow 宿主，按任务禁令不改 |

### 保留动作与验收限制

- 原业务 `confirmDialog` 41 → 41；付费 `requestConfirm` 8 → 8；`showUndoToast` 9 → 9。不能为了减少计数删确认、费用披露或撤销。
- 原静态 dialog 容器 32 → 32；Modal/DesignModal 7 → 7。保留用户主动打开的设置/编辑/预览工作面，数量不代表自动弹窗次数。
- `canvasFeedback` 中受冻结宿主约束的适配器走有动作的背景提示，是明确例外，**未声称这些适配器已有inline落点**；其身份/定位和限制以主策略文档为准。
- AST只证明入口确实改动，不证明每条用户任务已验收。真实截图、通知5次去重、跨项目导出/批次导航、完整gates和push身份仍以主任务最终收据为准。
