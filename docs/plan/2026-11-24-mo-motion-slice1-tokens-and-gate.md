# MO-motion Phase 2 · Slice 1

依据 #1586 的 Phase 1 普查及协调裁决 #issuecomment-7126073004。

## GPT 交叉评审补充

- **★1 结果**：采集后仍把素材送到目标，退出淡出按 morph 入场时长推导；CSS 每个退出变量与运行时公式逐项一致。`motion.test.ts`、`BrowserCaptureFlyouts.test.tsx` 和 `check:tokens` 验收。文字按钮等待时宽度和名字保持稳定，辅助技术有独立的本地化状态；`actions.test.tsx` 在 Chromium 核对。
- **★2 所有者**：时长仍归 `src/design/motion.ts`；两种浏览器宿主继续共用 `BrowserCaptureFlyouts`。生产 CSS 和 JSX 的动效写法归 token 门岗；Mantine 按钮的忙态语义归 `DesignButton`。`door-map.mjs` 核对 CSS/JS 时长消费者、两条采集入口和门岗调用。
- **★3 原因与选择**：保留现有入口并补齐共享边界。分别在两个浏览器宿主改落点动画会重复规则，去掉淡出、门岗或忙态会让对应用户结果丢失。Mantine 的加载图标属于视觉层，独立的 `status` 区在文案写入前已存在。[WAI ARIA22](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA22) · [Motion 退出过渡](https://motion.dev/docs/react-animate-presence)
- **★4 旧数据**：无存储迁移。保留已有动画的目标、Mantine 的 loader 定位和按钮占位。扫描只认调用处的动效对象；React Flow 手动视口命令仍由原所有者处理。
- **★9 反例与量具**：CSS 退出值漂移、原始 shorthand、字面量或局部引用的 Motion 时长、未授权的按压缩放都应该失败；合规 token、瞬时过渡和合法按钮要通过。原 550 ms 退出、吞掉 `status`、删掉采集移动或改变按钮名和宽度均应失败。记录在根因合同，2026-12-01 复查同类问题是否再次绕过门岗或共享组件。

评审改动：浏览器采集沿用 550 ms 进入，退出为公式推导的 370 ms；token 门岗逐条检查 CSS 镜像，重复声明、原始 shorthand、内联或局部引用的 Motion 对象和越权 press scale 均有反例覆盖。旧画布加载循环改用共享变量，周期保持 1250 ms。`DesignButton` 在 Mantine 隐藏的加载图标外维护本地化状态，实测标签和宽度保持稳定。复核走定向 Vitest 与指定门岗；本轮未做新构建的桌面采集或屏幕阅读器语音复验。[根因合同](../fixes/2026-11-24-motion-cross-review.root-cause.json)

## ★0 先查别人

- Apple HIG 的减弱动态要求关键状态可静态辨识，确认保留忙态标签、对比度及禁用语义。[Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- Material 把进退方向、时长分开，确认浮层和面板的退出时长按进入的 2/3 取整。[Easing and duration](https://m3.material.io/styles/motion/easing-and-duration)
- Motion 的用户偏好配置负责 React 变换，命令式视口仍需在每次请求时读取系统偏好。[Accessibility](https://motion.dev/docs/react-accessibility)
- 出口：不涉及：此切片改变视觉反馈，已有操作可立即继续。

## ★1 用户怎么用

创作者打开项目 → 在外壳切创作、生成、预览 → 选中画布节点 → 查看工具条和生成框 → 按住发送再移出释放 → 展开 Agent 面板。第二条任务在系统减弱动态时重复并检查相同落点。录像量文字钮按下比例、图标工具栏稳定和三个工作面的可达性；DOM 量默认过渡时长、系统偏好和忙态。CSS 与 JS 的一致性用 token gate 和 Vitest 量。
通知、任务中心、采集飞图和两条时间轴消费同一套时长。已有项目、模型和设置无持久化字段变动，升级及回退可原样打开。

## ★2 谁说了算

ui.motion-scale 由 src/design/motion.ts 拥有。Tailwind、Mantine、Motion 与 WAAPI 读取同一组值。静态 CSS 镜像与运行时导出的变量逐项核对。下表按符号汇总 door-map 的去重文件门数。

| 符号 | 读入口 | 写入口 |
|---|---:|---:|
| `ActionCard` | 3 | 0 |
| `ActionCardProps` | 1 | 0 |
| `DesignButton` | 28 | 0 |
| `DesignButtonProps` | 1 | 0 |
| `IconActionButton` | 13 | 0 |
| `IconActionButtonProps` | 1 | 0 |
| `NomiAppProviders` | 5 | 0 |
| `WorkbenchButton` | 66 | 0 |
| `WorkbenchButtonProps` | 1 | 0 |
| `WorkbenchIconButton` | 44 | 0 |
| `WorkbenchIconButtonProps` | 1 | 0 |
| `buildNomiTheme` | 0 | 2 |
| `nomiCssVariablesResolver` | 2 | 0 |
| `nomiDesignTokens` | 2 | 0 |

重跑：`node scripts/door-map.mjs src/design/actions.tsx src/theme/nomiTheme.ts src/NomiAppProviders.tsx`。

<details><summary>完整门表（按调用文件合并）</summary>

| 文件 | 读 | 写 |
|---|---|---|
| `src/NomiAppProviders.tsx` | nomiCssVariablesResolver | buildNomiTheme |
| `src/design/actions.tsx` | IconActionButton, IconActionButtonProps, DesignButton, DesignButtonProps, WorkbenchIconButton, WorkbenchIconButtonProps, ActionCard, ActionCardProps, WorkbenchButton, WorkbenchButtonProps |  |
| `src/design/decisionBar.tsx` | WorkbenchButton |  |
| `src/design/previewHost.tsx` | nomiCssVariablesResolver | buildNomiTheme |
| `src/devlab/designLab.tsx` | NomiAppProviders |  |
| `src/devlab/designLab/noAccentOutline/noAccentOutlineLabKit.tsx` | DesignButton |  |
| `src/devlab/designLab/primitivesActions/states/01-workbench.tsx` | WorkbenchButton, WorkbenchIconButton, ActionCard |  |
| `src/devlab/designLab/primitivesActions/states/02-mantine.tsx` | DesignButton, IconActionButton |  |
| `src/devlab/designLab/primitivesSurfaces/states/01-status.tsx` | WorkbenchButton |  |
| `src/devlab/designLab/primitivesSurfaces/states/02-overlays.tsx` | WorkbenchButton |  |
| `src/devlab/designLab/videoNodeNext/VideoEditStage.tsx` | WorkbenchIconButton, WorkbenchButton |  |
| `src/devlab/directorLab.tsx` | NomiAppProviders |  |
| `src/devlab/nodeTimelineInteraction.tsx` | NomiAppProviders |  |
| `src/devlab/skillLibrarySpecimen.tsx` | NomiAppProviders |  |
| `src/main.tsx` | NomiAppProviders |  |
| `src/theme/nomiTheme.ts` | nomiDesignTokens |  |
| `src/ui/app-shell/HotfixBanner.tsx` | WorkbenchButton, WorkbenchIconButton |  |
| `src/ui/app-shell/UpdateDialog.tsx` | WorkbenchButton |  |
| `src/ui/app-shell/UpdatedCard.tsx` | WorkbenchIconButton |  |
| `src/ui/app-shell/shell/ShellRail.tsx` | WorkbenchIconButton |  |
| `src/ui/app-shell/shell/ShellTopBar.tsx` | WorkbenchButton |  |
| `src/ui/browser/popover/BrowserAssetPopoverView.tsx` | DesignButton |  |
| `src/ui/community/FeedbackReportCard.tsx` | DesignButton |  |
| `src/ui/community/FeedbackShareContent.tsx` | DesignButton |  |
| `src/ui/onboarding/AdapterTaskWorkspace.tsx` | IconActionButton |  |
| `src/ui/onboarding/AdapterVerificationScreen.tsx` | DesignButton |  |
| `src/ui/onboarding/AntigravityConnectionCard.tsx` | DesignButton |  |
| `src/ui/onboarding/ApimartConnectPage.tsx` | WorkbenchButton, WorkbenchIconButton |  |
| `src/ui/onboarding/ApimartStatusNotice.tsx` | WorkbenchButton |  |
| `src/ui/onboarding/ApimartTopUpNotice.tsx` | WorkbenchButton |  |
| `src/ui/onboarding/ApimartWorksCollage.tsx` | WorkbenchIconButton |  |
| `src/ui/onboarding/CapabilityModeEditor.tsx` | IconActionButton, DesignButton |  |
| `src/ui/onboarding/CapabilityModeEditorParts.tsx` | IconActionButton |  |
| `src/ui/onboarding/CustomCallEditor.tsx` | DesignButton, IconActionButton |  |
| `src/ui/onboarding/DirectScriptDraftForm.tsx` | DesignButton |  |
| `src/ui/onboarding/IntegrationSelfCheckPanel.tsx` | DesignButton |  |
| `src/ui/onboarding/KnownVendorKeyConnectPage.tsx` | DesignButton |  |
| `src/ui/onboarding/ModelAdapterStatusSection.tsx` | DesignButton |  |
| `src/ui/onboarding/ModelCapabilityEditor.tsx` | DesignButton |  |
| `src/ui/onboarding/ModelCatalogNotices.tsx` | DesignButton |  |
| `src/ui/onboarding/ModelPickerScreen.tsx` | IconActionButton, DesignButton |  |
| `src/ui/onboarding/ModelSettingsDetailDialog.tsx` | IconActionButton |  |
| `src/ui/onboarding/ModelSettingsHome.tsx` | DesignButton |  |
| `src/ui/onboarding/ModelSettingsPageSurface.tsx` | IconActionButton |  |
| `src/ui/onboarding/ModelSettingsWorkspacePages.tsx` | IconActionButton, DesignButton |  |
| `src/ui/onboarding/OnboardingWizard.tsx` | DesignButton |  |
| `src/ui/onboarding/OnboardingWizardAdvancedFields.tsx` | DesignButton |  |
| `src/ui/onboarding/OnboardingWizardResult.tsx` | DesignButton |  |
| `src/ui/onboarding/useAntigravityModelWorkspace.tsx` | DesignButton |  |
| `src/workbench/ai/NoTextModelRecoveryCard.tsx` | WorkbenchButton |  |
| `src/workbench/ai/v4/AgentPanelV4AskCard.tsx` | WorkbenchButton |  |
| `src/workbench/ai/v4/AgentPanelV4Cards.tsx` | WorkbenchButton |  |
| `src/workbench/ai/v4/AgentPanelV4Panel.tsx` | WorkbenchIconButton |  |
| `src/workbench/ai/v4/AgentPanelV4SlotShell.tsx` | WorkbenchIconButton |  |
| `src/workbench/assistantWidthBounds.ts` | nomiDesignTokens |  |
| `src/workbench/creation/DocumentListSidebar.tsx` | WorkbenchIconButton |  |
| `src/workbench/creation/SelectionGeneratePopover.tsx` | WorkbenchIconButton |  |
| `src/workbench/creation/aiRewrite/AiRewriteBar.tsx` | WorkbenchIconButton |  |
| `src/workbench/creation/storyboard/StoryboardActionCard.tsx` | WorkbenchButton |  |
| `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx` | WorkbenchButton |  |
| `src/workbench/creation/storyboard/StoryboardWorkspace.tsx` | WorkbenchButton |  |
| `src/workbench/generation/list/GenerationListCard.tsx` | WorkbenchIconButton |  |
| `src/workbench/generation/list/GenerationListDetail.tsx` | WorkbenchIconButton, WorkbenchButton |  |
| `src/workbench/generation/list/GenerationListParts.tsx` | WorkbenchButton |  |
| `src/workbench/generation/list/GenerationListSectionHeader.tsx` | WorkbenchButton, WorkbenchIconButton |  |
| `src/workbench/generationCanvas/components/CanvasControlsHelpPopover.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/components/CanvasNavigationTooltipButton.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/components/GroupFrameHeader.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/components/ReconcileDeviationCard.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/ClipNode.tsx` | WorkbenchIconButton, WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/ClipNodeActionToolbar.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/ClipNodePreview.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/ClipNodeTimeline.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/DeferredNodeMedia.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/InlineParameterBar.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/NodeErrorReport.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/NodePromptOptimizer.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/NodePromptToolCluster.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/NodeRecoverableReport.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/NodeVideoControls.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/PanoramaViewer.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/TextNodeComposer.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/DirectorNode.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/context/ContextCard.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/dialogs/ActionSelectModal.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/dialogs/MobileConnectDialog.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/dialogs/SettingsDialog.tsx` | WorkbenchIconButton, WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/fields/ActionPickField.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/ActionClipInspector.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/BatchWaypointsCard.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/BoneKeyframeInspector.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/CloseupClipInspector.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/ContextInspector.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/LookAtClipInspector.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/SkeletonTab.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/TrajectoryClipInspector.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/inspector/WaypointCard.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/outputs/OutputsPopover.tsx` | WorkbenchIconButton, WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/shotStrip/DirectorShotStrip.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/side/AssetsDrawer.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/topbar/AddObjectMenu.tsx` | WorkbenchIconButton, WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/topbar/RefineTopBar.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/topbar/shellChrome.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/viewport/CameraPovHud.tsx` | WorkbenchIconButton, WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/panels/viewport/PipViewport.tsx` | WorkbenchIconButton, WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/director/timeline/TimelineHeader.tsx` | WorkbenchButton, WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/director/timeline/TrackList.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/nodes/render/AudioStripNode.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/shotTable/ShotTableComposer.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/nodes/shotTable/ShotTableGrid.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlowNodes.tsx` | WorkbenchIconButton |  |
| `src/workbench/generationCanvas/spend/AnchorCheckpointCard.tsx` | WorkbenchButton |  |
| `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx` | WorkbenchButton |  |
| `src/workbench/library/LibraryOnboardingHeroCard.tsx` | WorkbenchButton |  |
| `src/workbench/library/ProjectLibraryPage.tsx` | ActionCard |  |
| `src/workbench/preview/EditingLayoutMenu.tsx` | WorkbenchButton |  |
| `src/workbench/preview/PreviewControlBar.tsx` | WorkbenchIconButton, WorkbenchButton |  |
| `src/workbench/preview/inspector/ClipTransitionFields.tsx` | WorkbenchButton |  |
| `src/workbench/preview/inspector/PreviewInspector.tsx` | WorkbenchIconButton, WorkbenchButton |  |
| `src/workbench/preview/inspector/TextClipFields.tsx` | WorkbenchIconButton |  |
| `src/workbench/production/ProductionRunTaskCard.tsx` | WorkbenchButton |  |
| `src/workbench/promptLibrary/PromptLibraryPanel.tsx` | WorkbenchIconButton |  |
| `src/workbench/settings/AboutSection.tsx` | WorkbenchButton |  |
| `src/workbench/settings/AgentTraceSection.tsx` | DesignButton |  |
| `src/workbench/settings/AiModelsSection.tsx` | WorkbenchButton |  |
| `src/workbench/settings/AttentionSoundSection.tsx` | DesignButton |  |
| `src/workbench/settings/AutomationPermissionsSection.tsx` | IconActionButton |  |
| `src/workbench/settings/DiagnosticsBundleSection.tsx` | DesignButton |  |
| `src/workbench/settings/ModelBoxOrderSection.tsx` | IconActionButton |  |
| `src/workbench/settings/ProjectLocationSection.tsx` | DesignButton |  |
| `src/workbench/settings/TelemetrySection.tsx` | DesignButton |  |
| `src/workbench/settings/VendorPreferenceOrderSection.tsx` | IconActionButton |  |
| `src/workbench/skillLibrary/SkillLibraryPanel.tsx` | WorkbenchIconButton |  |
| `src/workbench/taskCenter/TaskCenterButton.tsx` | WorkbenchButton |  |
| `src/workbench/timeline/TimelinePanel.tsx` | WorkbenchIconButton |  |
| `src/workbench/timeline/TimelineSecondaryAddRow.tsx` | WorkbenchButton |  |

</details>

## ★3 一致与复用

逐调用点设数值会分裂 CSS 与 JS；删除所有动效则失去忙态和按压反馈。采用框架根配置，保留既有 fast/morph 缓动别名；删除私有关键帧与飞图、吸附的重复实现。

## ★4 全状态

空闲时保留现有标签。加载时保留可读名称和 busy 语义。完成、失败、部分完成仍分别显示原有结果、错误和逐项反馈；取消中继续显示任务状态。过期以现有任务状态为准。模型不可用仍走设置选择模型的既有入口。英文长标签依按钮自身内容定宽，角标与图标工具栏各自保留原有尺寸。

## 5 中途表

| 状态 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 指针按下 | 松开复位 | 卸载样式 | 本地反馈继续 | 初始姿态 | 每次按压重新响应 |
| 视口移动 | 手势接管 | 协调器释放 | 本地移动继续 | 读取已落盘视口 | 最新请求接管 |
| 任务加载 | 任务宿主处理取消 | 宿主管生命周期 | 宿主报告连接状态 | 读已有任务 | 遵守宿主原禁用与确认语义 |

各格视觉变化本身无费用；执行结果仍归原任务回执。

## 6 外部数据与失败

CSS 媒体查询与 matchMedia 提供系统偏好；无浏览器时纯函数仍可供主题构建。无动画时一次落到最终视口并调用原有结算回调。网络及供应商均不参与动效计算。

## ★7 性能

每个场景五次，比较每次帧间隔 p95 的中位数和 p95，另记 >50ms 长任务。预算单位 ms。

| 场景 | 负载 | 已登记中位 / p95 | 预算 |
|---|---|---|---:|
| canvas-drag-20-nodes | 150 节点中多选拖动 | 9.3 / 9.7 | 33 |
| chat-scroll-500 | 500 条混合消息 | 10.2 / 10.3 | 16.7 |
| timeline-scrub | 24 个视频片段 | 18.3 / 25.1 | 33 |
| window-narrow-drag | 96 节点跨窗口阈值六次 | 10.4 / 10.4 | 33 |

## 8 真实条件

隔离 Electron、后台窗口、零付费。中英各测亮暗色，另跑 1100×690 和系统减弱动态。Windows、真实供应商、纯键盘全程为 unverified。录像记录顶栏三阶段、画布工具条与输入框、Agent 面板及按压。

## ★9 验收与回滚

- 输出六档、三档派生退出值；CSS 镜像逐项核实。传入任意合法时长都按同一个公式舍入。
- 真实窗口中按压文字及发送钮可见微缩；普通图标、禁用钮和减弱动态下无微缩。忙态保持可识别。
- 减弱动态下 CSS 时长归零；Mantine 进退均尊重偏好，视口到达终点且正常结算。
- 业务代码新增数值 utility、任意缓动、曲线、transition-all、内联关键帧要红；已有合法语义 utility、动作 ID、注释要绿。在遗留文件内增加一个违规也要红。
- 执行四个登记场景、单测、tokens、board-parity、boundary-owners、self-written、lint:changed 和 merge judgement dry-run。对照 git diff 检查禁改路径。回滚本切片的实现提交即可；证据索引位于 docs/evidence/2026-11-24-mo-motion-slice1/。
