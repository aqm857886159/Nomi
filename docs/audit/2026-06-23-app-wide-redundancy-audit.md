# Nomi 全 App 冗余/复杂度体检 · 第 2 轮（2026-06-23）

> 同一把 8 类尺子、五路并行 + 模型接入专项深扫（共 6 个只读 agent）。重点压在用户点名的两个高摩擦面：① 模型选择弹窗 ② 模型接入。
> 活真相源仍是 `redundancy-backlog.md`；本文件是 point-in-time 报告。

## 一句话 + 本轮最该先动

**模型选择弹窗（画布节点选模型）是本轮唯一的真 B 类痛点——完全平铺、零信息架构**；而用户感觉「模型接入一大片」的体感，深扫证实**主流程其实已经收拾干净（71ff41c），那片臃肿感来自残留的死面板 + 文案名实不符**，是 A 类清理不是重构。本轮最该先动：**① 给模型弹窗加信息架构（B7，需你拍设计方案）② 一把清掉本轮挖出的一堆死码（A 类，可直接做）**。

---

## ⭐ 焦点一：模型选择弹窗（B7 · 产品取舍）

**现状（证据）**：画布生成节点选模型 = 一个**完全平铺、零 IA 的下拉**。
- 数据流：catalog → `modelCatalogCache.ts:97` 只做「按启用 vendor 过滤 + 隐藏极少横竖屏变体」→ `modelOptionMappers` **不排序不分组** → `InlineParameterBar.tsx:131` 整列 `.map` 塞进 `NomiSelect` → `NomiSelect.tsx:139-161` **无搜索/无分组头/无最近用/无能力分类**，唯一上限 `max-h-[240px]` 滚动。
- 一个图像节点会看到「该 kind 下所有启用 vendor 的全部模型」（理论数十条），常用与长尾**完全平权靠肉眼滚**——这就是用户说的「一大堆模型铺开」。
- `resolveCatalogKind`（`modelCatalogStatus.ts:7-9`）把文生图/图生图合并进同一档，下拉里又**不标能力**，用户看不出哪个支持参考图。
- **现成能力闲置（名实不符）**：仓里已有 `ModelChipGroups.tsx`（按 kind 分组+计数）和 `AssistantModelPicker.tsx:11-17`（DEPRIORITIZE 智能排序），但**最该用的画布节点下拉一个都没复用**。
- **三处选模型心智不一**（pattern 1+2）：画布节点（无默认项/无排序）、分镜镜卡（有「默认模型」空值项 `StoryboardShotCard.tsx:51`）、AI 助手（有智能默认排序）——数据源还分叉（节点/镜卡走 `useModelOptions`，助手直连 `listWorkbenchModelCatalogModels`）。

**结论**：B 类，需出设计方案让用户拍板。详见 backlog B7 + 即将给出的样张。

---

## ⭐ 焦点二：模型接入子系统（深扫结论：主流程已干净，痛在死残留）

走一遍最短路：顶栏点开（**入口虽 5+ 处但全部同源** dispatch `nomi-open-model-catalog`，正确做法）→ 面板（能力概览 effect-first + 供应商行卡 + 「其他模型」折叠 + 合并入口「添加模型/中转站」+ 编程助手可选）→ Wizard（预设→地址→key→模型→[高级折叠]→测试→保存）。官方预设 3-4 步、中转 5-6 步，**属合理范围**。具名预设隐藏 BaseURL、长尾（接口协议/网关头）已收进高级折叠并带失败逃生口——**教科书式收纳，主流程不需重构**。

「一大片」的真实来源（A 类清理）：
- **P-1【死码·最严重】** `GenerationCanvas.tsx:499-566` 有一整套**不可达**的旧「生成渠道」内联设置面板（独立 key/baseUrl，写 `providerSettings` 的 chatfire 渠道），由 `nomi-open-generation-settings` 事件触发但**全仓无人 dispatch**（已 grep 确认）。文案还写「让 Agent 根据官方文档生成草案并确认写入」——指向 `onboardingIpc.ts:11` 明确标注**已下线**的 AI 读文档子系统。第二套并行心智 + 误导文案。
- **P-3** Wizard `inputMode` 单值恒真死分支（`OnboardingWizard.tsx:50,308`）+ 已删子系统残留注释。
- **P-5** 三处「填 API Key」控件不统一：`VendorOnboardCard.tsx:140` 裸 input / `OnboardingWizard.tsx:377` Mantine PasswordInput / `GenerationCanvas.tsx:528` 裸 input（死面板里）。
- 核实澄清：① 记忆里「manifest tools/requiredProviders 死码」属 **skills 子系统**非模型接入，勿混淆；② 「中转+AddModelCard 合并」**未回潮**（现只剩一个入口）；③ chip 列表已分组不平铺，当前量级**不缺搜索**。

---

## 其余五路要点（去重后）

**死码批（A 类，可直接清）**
- `ProjectLibraryStandaloneRoute.tsx` + `ProjectLibraryRoute.tsx` 整对**无 importer 死路径**，且死路径里残留 **两处原生 `window.confirm`**（违反 confirmDialog 铁律）+ `templateId` 半残签名。
- `tryNowExamples.ts`（101 行）仅 test 引用，无产品入口。
- `projectTabsStore.ts` 整套多项目 Tab 状态机**全仓零引用**（疑废弃/未完工）。
- `WorkbenchAiHeaderActions.onModelIntegration` dead prop——两个调用方都不传，分支永不渲染（⚠️ 2026-06-22 的 A4/A5 删的是 `openWorkbenchModelIntegration` 函数，这个**相关入口残留**未清）。
- `sendStoryboardToTimeline`（manual playhead 插入版）疑无生产调用方（关联 B5，待核实是否预留）。

**文案/控件不一致（A 类，轻）**
- 文字三件套：菜单叫「标题/字幕」，clip tooltip 叫「标题卡/字幕」，空态指引写「用上方『字幕/标题卡』」——**指向一个不存在的按钮名**，直接误导新用户（`TimelinePreview.tsx:714/721`、`TimelineTextTrack.tsx:128/148`）。
- 导出双入口两文案（AppBar「导出/前往预览导出」vs 控制条「导出 MP4」，经 `nomi-request-export` 桥到同一 `handleExport`）。

**导航过载（B 类，轻）**
- 顶栏右侧 4 常驻按钮（提示词库/素材库/模型接入/导出）+「上手」=5 项，低频库入口与高频「导出」平级常驻，主操作权重被稀释（`NomiAppBar.tsx:186-257`）。

**巨壳（>500 行，记录）**
`BaseGenerationNode.tsx` 907、`TimelinePreview.tsx` 791、`CanvasAssistantPanel.tsx` 764、`GenerationCanvas.tsx` 747（含死面板）、`CreationAiPanel.tsx` 746、`NomiStudioApp.tsx` 608、`OnboardingWizard.tsx` 604、`parameterControlModel.ts` 595。

---

## 与第 1 轮（2026-06-22）的 diff / P1 回归看门狗

- **新发现（本轮挖出）**：B7 模型弹窗 IA（焦点一）、P-1 死「生成渠道」面板、ProjectLibraryRoute 死对 + window.confirm、tryNowExamples 死码、projectTabsStore 未接线、onModelIntegration dead prop、文字三件套指错按钮名。
- **回归 ⚠️**：无新增并行版回潮；A4/A5 标「✅ 删死入口」但 `onModelIntegration` 这个相关 dead prop 漏网——补进 A 批。
- **已确认未回潮**：模型接入「中转+AddModelCard 合并」仍只一个入口（71ff41c 成果保持）。
- **已做项保持**：toast 收一套(A1)、DesignEmptyState/DesignSearchInput 收口(A2/A3)、B1 双路分镜拍板态保持。
