# Nomi UX 冗余/复杂度 · 活路线图（backlog）

> **唯一活真相源**：所有「该简化的冗余/复杂度」项 + 状态 + 优先级 + 什么时候整，都在这。
> 由 `nomi-ux-audit` 技能（`.claude/skills/nomi-ux-audit/`）每轮体检更新；point-in-time 体检报告见 `docs/audit/<date>-app-wide-redundancy-audit.md`。
> 做完一项即把状态改 ✅ 并标 commit；体检复跑时把新发现并进来、回归项标 ⚠️。

## 攻坚原则（什么时候整）
- **A 卫生清理**：随手穿插做，低风险（删并行版/复用设计系统/删死码），五门+走查即上。
- **B 产品取舍**：每次迭代啃 **1-2 项**，先出多方案样张→用户拍板→实现→走查。按「影响大/改动小」排，最痛先治。
- **C 字段收纳**：穿插进相关 B 一起做。
- **D 大重构**：单独立项、专门拍板，别和小修混。
- **复跑节奏**：随 R14（≥25 commit 或发版前）跑 `nomi-ux-audit` 补新发现 + 查回归。

---

## A · 卫生清理（低风险，可直接做）

| 项 | 问题 | 状态 |
|---|---|---|
| **A8** | 【第2轮·死码批】`GenerationCanvas.tsx:499-566` 不可达旧「生成渠道」内联设置面板（无人 dispatch `nomi-open-generation-settings`）+ 误导文案（提已下线的 AI 读文档子系统）| ⬜ 本轮做 |
| **A9** | `ProjectLibraryStandaloneRoute.tsx`+`ProjectLibraryRoute.tsx` 整对死路径（无 importer）+ 内含 2 处违规 `window.confirm` + `templateId` 半残签名 → 删 | ⬜ 本轮做 |
| **A10** | 死码：`tryNowExamples.ts`(101行仅test引)、`projectTabsStore.ts`(全仓零引用)、`WorkbenchAiHeaderActions.onModelIntegration` dead prop(⚠️ A4/A5 漏网的相关入口) | ⬜ 本轮做 |
| **A11** | Wizard `inputMode` 恒真死分支 + 已删子系统残留注释（`OnboardingWizard.tsx:50,267,308`）| ⬜ 本轮做 |
| **A12** | 文字三件套文案名实不符：空态写「上方『字幕/标题卡』」但按钮实际叫「标题」→ 统一术语（`TimelinePreview.tsx:714/721`、`TimelineTextTrack.tsx:128/148`）| ⬜ 本轮做 |
| A1 | toast 三套+死 store/host → 收一套 | ✅ 3c041a8 |
| A4/A5 | 删死 intent + 死函数 openWorkbenchModelIntegration | ✅ 3c041a8 |
| A3 | 抽 DesignEmptyState → 3 库面板空态收口 | ✅ 7734f51 |
| A2 | 抽 DesignSearchInput → 3 搜索框收口 | ✅ 7734f51（真机走查已补：隔离实例验 DesignSearchInput + 过滤空态 DesignEmptyState 渲染正常）|
| A2-tab | 库面板筛选 tab | ⏸️ 刻意不抽（计数/tablist/pill 三语境差异大，硬合=过度抽象）|
| A6 | overlay 外壳点外关/ESC | ⏸️ **不强抽**：逐文件读后判定 close-logic 是**语境定制非冗余**（PromptLibrary 防 preview 开时误关 `!selected`；AssetLibrary 手测嵌套 Mantine 弹层避免误关）；唯一相同的 ESC 监听仅 5 行，硬抽统一 overlay 壳风险大于收益（别矫枉过正，同 A2-tab）|
| A7 | 文案统一 | ⏸️ **多数是产品/品牌判断非纯收敛**：slogan 两版是品牌决策（0.12.0 新定位可能已演进）；「去配置/模型接入」是语境合适的变体指向同一处，非令人困惑的冗余。留你拍/随品牌统一时一起做。|

## B · 产品取舍（出样张拍板，每迭代啃 1-2）

| 项 | 问题 | 优先级 | 状态 |
|---|---|---|---|
| **B1** | 「写分镜」模式 vs「拆镜头」规划师 **双路** | 🔴 最高 | ✅ 用户拍板**方案 B 分工讲清**：模式即路选择器——选「写分镜」模式=明确要文字稿→不再被劫持到规划师（`CreationAiPanel` send 跳过意图路由 when mode='storyboard'）；默认模式说「拆镜头」才走规划师；模式 desc 改成「文稿里起草文字分镜稿…要落画布说『拆镜头』」消歧。读真实代码确认 7 步流水线是刻意设计故不删（方案 A 否决）。|
| B2 | 导出双入口 + 零设置（分辨率/画质底层支持却不给选）| 高（主线终点）| ⬜ |
| B3 | 字幕 vs 标题卡 概念冗余（底层同一文字 clip）+ 文字内容/样式/时长拆 3 处 | 中 | ⬜ |
| B4 | 创作 composer 三选择器（模式/技能/模型）相邻打架 | 中-高 | ⬜ |
| B5 | 画布→时间轴 4 路径、落点语义三套（末尾/playhead/任意拖）| 高（核心桥）| ⬜ |
| B6 | onboarding 三套并行（开屏/上手清单/聚光）+ 重复 hint | 中（首启必经）| ⬜ |
| **B7** | 🔴**【第2轮·用户点名】模型选择弹窗零信息架构**：画布节点下拉全量平铺（数十条）、无搜索/分组/最近用/能力分类、文生图图生图混排不标能力；现成的 ModelChipGroups 分组 + AssistantModelPicker 智能排序没复用；且节点/镜卡/助手三处选模型心智不一（默认项/排序各不同）| 🔴 最高（高频必经，用户点名）| ⬜ **出样张拍板中** |
| 已做 | 模型接入页简化（A 分区+能力概览）| — | ✅ 71ff41c（P7）；第2轮复核**未回潮**，主流程已干净，「一大片」体感实为 A8/A11 死残留 |

## C · 字段收纳（中风险，穿插）

| 项 | 问题 | 状态 |
|---|---|---|
| C1 | 节点 composer 参数全铺开无「高级」折叠（为不折叠付出横向夹取救火码）| ⬜（穿插进画布相关 B）|
| C2/C3 | 预览画幅 7 项平铺 + 控制条一行 12+ 控件四类心智 | ⬜（穿插进 B2 导出）|
| C4 | 节点选中态浮层叠罗汉（根因 BaseGenerationNode 907 巨壳）| ⬜（需先拆巨壳）|

## D · 大重构 / 名实不符（单独立项）

| 项 | 问题 | 状态 |
|---|---|---|
| D1 | 3D/站位/运镜 ~9000 行服务长尾 + 站位/运镜零手动入口（仅 Agent）+ 手动 3D 产不出对等 = 两套不通路径 | ⬜（量级大，专门立项拍板）|
| D2 | 素材库名实不符（能筛音频但传不了/删除拖出 v1.1 未做）| ⬜ |
| D3 | 无设置页 + 「关于」实为更新器占品牌位 | ⬜（待定是否要设置页）|
| D4 | 画布「添加节点」三处同源入口（共享数据源=良性）+ 单/批量生成两套编排 | ⬜（良性，低优先）|

---

## 对话返回面专项（第 3 轮 2026-06-23 · 用户点名「两个 agent 返回怎么返回」）

> 报告 `docs/audit/2026-06-23-agent-conversation-render-audit.md`。范围=两个 agent 对话「返回内容」渲染面。竖排按钮根因已治本（9d59383）。

| 档 | 项 | 问题 | 状态 |
|---|---|---|---|
| A | CR-A1+A3 | 错误/取消渲染改读 `status` 字段（不嗅 content 前缀）→ 生成侧错误终被识别 | ✅ 本轮 |
| A | CR-A2 | 删计划卡假下拉 `▾`（无 onClick 的伪交互）| ✅ 本轮 |
| A | CR-A4 | 计划卡确认条加 flex-wrap/shrink-0（几何安全网）| ✅ 本轮 |
| A | CR-A5 | `replyActionClassName` 死码 prop（CSS 零命中、无 hover）→ 删 | ✅ 删整条 prop 链（AiReplyActionButton/AssistantMessageView/两调用点），行为不变 |
| A | CR-A6 | 计划外单工具卡漏原始 id（n3→n5 黑话）→ 翻人话 | ✅ toolCallSummary 按 id 查节点标题（「镜1」），查不到省略不灌 id；单测改为验翻译 |
| A | CR-A7 | 计划卡确认/拒绝手搓 className 走 variant | ✅ AgentPlanCard 改 variant default/primary + size md（=h-8 零尺寸变化） |
| A | CR-A8 | 撤销文案统一 | ✅ committed 卡「整笔撤销」→「撤销这次改动」（与对账卡一致）；确认/拒绝 vs 确认全部/全部拒绝 是单/批量语义，保留 |
| A | CR-A9 | `pendingLabel` 与内置「处理中」撞车 | ✅ 核实=非 bug（NomiLoadingMark 的 label 仅 aria-label 不渲染可见文字，不双显） |
| 🔵B | **CR-B1** | 🔴**错误透传重设计**：红色语气 + 接 narrate 人话 + 创作侧双重展示去重 | ✅ 5175e58（方案A错误卡 AssistantErrorCard，两 agent 共用；plan 2026-06-23-error-transparency-redesign）|
| 🔵B | CR-B2 | token 统计行降噪 | ✅ 删每条消息的 token 行（作者自标过渡债 + D4「零行动价值」）；整条 turnStats/narrateTurnStats 链清净 |
| 🔵B | CR-B3 | `AssistantToolsFold` 占首屏（工具名=黑话）| ✅ 删 AssistantToolsFold（开发者黑话对创作者零价值）；MemoryFold（项目记忆透明）保留 |
| ⚫D | CR-D1 | 截断/空响应无专门态 | ✅ finishReason 透到渲染层（DTO 加字段）；两 agent 在 finishReason=length+有正文时附「可能被截断·说继续」（空文本+length 仍由 backend 弱模型空响应词表处理）|
| ⚫D | CR-D2 | `CanvasAssistantPanel`/`CreationAiPanel` 逼近 800 | ⬜ 评估：均在 800 门内（filesize 门把关），拆精密流式/事务闭包高风险低回报且非缺陷 → 监控不强拆 |

## 体检轮次
- **第 1 轮 2026-06-22**：基线体检，五路并行扫出上述全部项，建 backlog。报告 `docs/audit/2026-06-22-app-wide-redundancy-audit.md`。
- **第 2 轮 2026-06-23**：六路（五路 + 模型接入专项深扫），重点压用户点名的模型弹窗 + 模型接入。新增 **B7（模型弹窗 IA，真痛点）** + **A8-A12 死码/文案批**。回归看门狗：无并行版回潮；A4/A5 漏网的 `onModelIntegration` dead prop 补进 A10；模型接入主流程复核未回潮（71ff41c 保持）。报告 `docs/audit/2026-06-23-app-wide-redundancy-audit.md`。
