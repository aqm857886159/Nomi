# 设计系统全面对齐扫除 (2026-06-22)

6 个 subagent 全量审计用户可见面，得 ~156 finding（去重 ~110），按批根因修、每批过六门、真机抽验、推 main。
已修不重复：token 接线(--tc-*)、悬空 var、WorkbenchIconButton/WorkbenchButton 基础 icon 14/1.6、助手渲染(remark-gfm)+创作 composer。

## 批次（每批 gate + commit）

- [ ] **B1 P0/correctness**：PanoramaViewer foreign-token(`border-subtle`/`text-tertiary`/`surface-inline`)→nomi 类 + 删 tailwind.config 4 个过渡色键；Scene3DEditor `text-nomi-ink-55`→ink-60；进度条→DesignProgress(OnboardingChecklist:226 / AboutNomiPopover:138 / TimelinePreview 导出条)；StoryboardPlanCard 状态 pill→StatusBadge；TimelinePreview 导出 `bg-white/15`+`text-white/70`(亮底不可见)→token。
- [ ] **B2 图标 stroke →§6**：所有 `stroke={2}`/`1.9`/`2.4`/`1.65` → 1.6/1.8(按 §6 档)；AppBar 图标 15/1.7→18/1.6。(ImageCropGridOverlay×2, Scene3DEditor×2, NodePromptOptimizer, StoryboardShotCard, OnboardingSpotlight, TrajectoryPointControls, AudioStripNode×5, PanoramaViewer, AppBar×5)
- [ ] **B3 off-token 颜色**：`bg-white`/`rgba`/`bg-black`/`oklch` 内联 → token(PanoramaViewer, ImageCropGridOverlay×4, GenerationCanvas popover, CanvasToolbar, GroupItem `bg-white/35`+rgba fallback, ProjectLibraryPage overlay×4+oklch scrim, CanvasEdgeLayer rgba shadow, OverlaySelectionBox oklch shadow, NomiSelect SURFACE_SHADOW)；scene3d rgba 阴影→shadow-workbench-pop/nomi(Scene3DFullscreen×3, TrajectoryMenus×3, TrajectoryPointControls)；scene3d 轴色 `text-red/green/blue-300`→`--nomi-axis-x/y/z`(已存)；scene3d `bg-white/25`/白边→token。
- [ ] **B4 手写按钮→WorkbenchButton**：NodePromptOptimizer×4, NomiAppBar×6(className 覆写 variant)+breadcrumb×2, OnboardingChecklist「带我去」(hover 反向), StoryboardPlanEditor×3, AudioStripNode×2, NodeErrorReport, ProvenancePanel×2。
- [ ] **B5 表单**：NomiSelect borderRadius 12/8→token + caret `▾`/check `✓`→IconChevronDown/IconCheck；TrajectoryPanel 原生 `<select>`×3→NomiSelect；删死的 DesignSelect。
- [ ] **B6 任意 px/字号/圆角**：`text-xs`→text-caption, `text-lg`→text-title, `font-[650/750]`→font-semibold, `gap-[5px]/[3px]`/`p-[5px]`/`py-[7px]`→4-scale, `h-[30px]`→h-8, `rounded`/`rounded-md`/`rounded-sm`→rounded-nomi-sm, `--workbench-control-radius`(7px)→rounded-nomi-sm。
- [ ] **B7 CSS 清理**：workbench-ai.css 孤儿规则(`__send`/`__input`/`__message-action`/`__tool-name`/`__context-pill`/`__header-action`/`__title-icon` 0 消费者) + 死 tc-ai-chat 块(与活规则交织，拆选择器后删)。
- [ ] **B8 任意 var()→token 类**(P2 机械)：`text-[var(--nomi-ink-XX)]`→`text-nomi-ink-XX`、`bg-[var(--nomi-...)]`→token 类，全仓 sweep。

## 遗留(单独，需 store 改)
- 画布助手 stop 无「已停止」标(需 canvas chat store 加 cancel 态)。
- 缺 on-arbitrary-color 对比 token(TrajectoryTimeline 白字在用户色轨道上)。
