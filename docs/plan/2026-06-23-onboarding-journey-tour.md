# 新手引导旅途（预置回放）— 执行计划

日期：2026-06-23
状态：待用户拍板 → 实现
样张：已拍（pacing 对，见会话 `nomi_onboarding_journey_tour` widget）
关联：取代「顶栏四步清单 + 带我去 spotlight」的旧引导走查（P1 加新删旧）

---

## 0. 一句话

新人首页点一个按钮 →「60 秒看 Nomi 怎么把一句话变成片」→ 用**预置数据**把整条流水线（创作打字 → AI 拆分镜 → 落画布 → 画布工具 → 预览字幕 → 导出）**回放**一遍，零额度、秒开、永不崩；收尾把人接进真创作区。

## 1. 拍板的四个决策（不再动）

| # | 决策 | 选定 |
|---|---|---|
| 1 | 演示数据 | **预置回放**（不真调模型）|
| 2 | 节奏 | **半自动**（看的自动播，讲工具的停下等「下一步」，随时跳过）|
| 3 | 触发 | **首页一个按钮主动点**，不首启自动播 |
| 4 | 示例片主题 | **修好一个小机器人** |

## 2. 范围

**做**：
- 首页（项目库 `view==="library"`）新增 CTA 卡/按钮：「60 秒看 Nomi 怎么把一句话变成片」。
- 点击 → 创建/打开一个 seedKey 隔离的**示例项目**，进入 tour。
- 一个 **tour 编排器**：按 beat 序列驱动 `setWorkspaceMode` + 往真实创作区/画布/预览灌**预置数据**，半自动推进。
- **打字回放渲染器**：把示例剧本逐字敲进真实创作编辑器（不调模型）。
- **示例项目预置数据**：剧本 + 分镜方案 + 画布节点（含定妆/3D 站位/运镜节点）+ 打包图片资产。
- 复用并扩展 `OnboardingSpotlight`：从 `ChecklistStep` 枚举解耦成可配置 tour 步（多 mode、自定义目标选择器、自动 beat vs 等待 beat）。
- tour 状态机 + localStorage「看过」key + 首页「重看引导」入口。

**不做（本期）**：
- 「升图/upscale」——Nomi 当前无此功能，不进引导（要纳入先另立项做功能）。
- 不为站位/运镜/排时间轴新加 UI 按钮（它们现状只有 AI 对话入口）——引导用「预置好节点 + spotlight 讲解 + 指向对话框」覆盖。
- 不动底层生成/导出引擎（已全通，只调用不改）。

## 3. 不动项（明确不碰）

- `applyCanvasToolCall` 各工具语义、`setWorkspaceMode` 行为、导出/时间轴引擎——只当驱动总线调用，不改实现。
- 顶栏四步清单的**被动打勾进度**（model/storyboard/generated/exported）保留（它是进度指示，不是走查）；只删它身上的 `guideStep/goToStep/advanceGuide`「带我去」spotlight 走查。
- SplashIntro 开屏保留（它是理念片，和这条「操作演示」旅途不冲突；不并行成两套走查，因为 Splash 不带 spotlight）。

## 4. 复用 / 新建 / 删除

### 复用
- `src/workbench/onboarding/OnboardingSpotlight.tsx` — 不压暗高亮环 + rAF 跟随 + 气泡 + 跳过/下一步。**扩展**成接受任意 tour 步配置。
- seedKey 防 GC 机制（`projectRepository.ts`，`example:*` 幂等键）— 示例项目用它，和用户真项目隔离、玩坏不脏手。
- `src/workbench/library/tryNowExamples.ts` — 接管这套闲置预置剧本基建（当前无 UI 消费）；新增「修好一个小机器人」剧本进同一文件，删/降级用不到的。
- `applyCanvasToolCall(toolName, args)` — 灌分镜方案、建画布节点、排时间轴的统一入口。
- `onboardingState.ts` 的 try/catch localStorage 模式 — tour「看过」状态沿用。

### 新建
- `src/workbench/onboarding/journeyTour.ts` — tour 步定义（有序 beat 列表，每步：`{ mode, kind: 'cinematic'|'spotlight', target?, copy, driver?() }`）。
- `src/workbench/onboarding/JourneyTourController.tsx` — 编排器：跑 beat 序列、半自动推进、跳过、收尾 CTA。
- `src/workbench/onboarding/Typewriter.ts`（或渲染器）— 逐字回放预置文本进创作编辑器（驱动 onContent 等价路径，不调模型）。
- `src/workbench/onboarding/demoProject.ts` — 「修好一个小机器人」示例项目的预置数据装配（剧本 + storyboardPlan + 画布节点 + 节点↔资产映射）。
- 示例图片资产（见 §5）放 `src/workbench/onboarding/assets/`（或现有资产目录），随包打。
- 首页 CTA：复用 `src/design` 卡片组件，挂在 `ProjectLibraryPage`。

### 删除（P1）
- 清单 `OnboardingChecklist.tsx` 内 `guideStep/goToStep/advanceGuide` + 对 `OnboardingSpotlight` 的旧调用方式（被新 tour 取代）。
- `data-tour="storyboard-cta"` 锚点（`CreationAiPanel.tsx:674`）——复用进新 tour 或清理，二选一不留悬空。

## 5. 示例片定义：修好一个小机器人

无台词，~8 镜，暖系。锚点（跨镜一致项）：**角色「小孩」、角色「小机器人」、场景「黄昏暖调」**。

| 镜 | 内容 | 景别/运镜 | 演示露出 |
|---|---|---|---|
| 1 | 巷子角落，黄昏，坏掉的小机器人歪在墙边 | 远景 establishing | 画质/氛围 |
| 2 | 小孩蹲下发现它，好奇 | 中景 | 角色「小孩」首现 |
| 3 | 小孩抱着机器人回家 | 跟镜/背影 | 身份一致 |
| 4 | 台灯下用螺丝刀修理 | 近景特写手部 | 细节质感 |
| 5 | 机器人眼睛「叮」地亮起 | 特写 | 高光时刻 |
| 6 | 两个对视，机器人歪头 | 双人中景 | **身份锁**（两角色同框一致）|
| 7 | 屋顶并排坐着 | 中景 | **3D 站位**（谁站哪）|
| 8 | 夕阳下定格，推镜拉远 | 远景 + 推镜 | **运镜轨迹** |

**画布里要 spotlight 的预置节点**（半自动停下讲解）：
1. 「小孩 · 定妆」身份卡（character）→「同一个人每镜长一样，靠身份卡锁脸」
2. 「小机器人 · 定妆」身份卡（character）→ 同上（也可合并讲）
3. 「屋顶双人 · 3D 站位」节点（scene3d staging）→「谁站哪朝哪，用 3D 摆一下 AI 照着画」
4. 「屋顶 · 运镜轨迹」节点（scene3d trajectory）→「想推拉摇移，画条相机轨迹 AI 复刻」
5. 画布「全部生成」按钮 →「卡都备好了，点生成就出图出片（演示里不真跑）」
6. 预览「加字幕」→「排进时间轴加字幕/标题卡」
7. 预览「导出 MP4」→「成片拿走」

**预置资产**：~8 张镜头成图 + 2 张角色参考图 ≈ 10 张，一次性用 Nomi 自己生成（额度默认授权），裁切打包随安装包走。**这是 build-time 一次性资产，不是运行时生成。**

## 6. 分层（R9，单文件 ≤800 行）

- UI 层：`JourneyTourController.tsx`、扩展后的 `OnboardingSpotlight.tsx`、首页 CTA。
- 编排/状态层：`journeyTour.ts`（纯数据 beat 定义）、tour 进度状态（zustand 或本地 state）。
- 领域驱动：复用 `applyCanvasToolCall` + `setWorkspaceMode`，不新增领域逻辑。
- 数据层：`demoProject.ts`（预置数据装配，纯函数）、`tryNowExamples.ts`（剧本文本）。
- 持久化：`onboardingState.ts` 加 tour「看过」key（`nomi:journey-tour:v1`）。

## 7. 验收门（R8/P3/R13）

- 五门全过：`pnpm run gates`（filesize→tokens→lint→typecheck→test→build）。
- 和样张逐项对账：beat 顺序、停顿点、话术、收尾两出口一致。
- 真机走查（R13，截图人眼判断）：首页点 CTA → 完整跑一遍 tour（打字回放真出字、聚光环对准真实控件、跨 3 个 mode 切换位置跟随、跳过随时生效、收尾「用我的故事走一遍」进真创作区）。
- 隔离性核实：示例项目带 seedKey 不污染真项目库、不被 GC、二次进入幂等。
- P1 核实：旧 `guideStep` 走查确已删，无第二套走查并存。

## 8. 回滚

- tour 整体挂在首页 CTA 后；CTA 不渲染即对用户隐身（但代码按 P1 删旧后不保留旧走查作 fallback）。
- 预置资产缺失时 tour 优雅降级（占位 + 文案），不白屏。
- 单 commit 内「加新 tour + 删旧 guideStep」一起走，避免并行版。

## 9. 排期（切片，每片自验五门）

- **S1 地基**：扩展 `OnboardingSpotlight` 解耦成可配置 tour 步 + `journeyTour.ts` beat 定义骨架 + tour 状态机/持久化 key。删旧 `guideStep/goToStep/advanceGuide`。
- **S2 打字回放**：`Typewriter` 渲染器，逐字灌创作编辑器（mock 文本，不调模型），创作区 beat 跑通。
- **S3 示例项目预置数据**：`demoProject.ts` 装配剧本+storyboardPlan+画布节点（先用占位图）；落画布 beat + 画布 spotlight beats 跑通。
- **S4 资产**：用 Nomi 生成「修好一个小机器人」10 张成图/参考图，裁切打包，替换占位。
- **S5 预览/导出 beats + 收尾 CTA + 首页入口**：preview 段 spotlight、收尾两出口（进真创作区/关引导）、首页 CTA + 重看入口。
- **S6 验收**：和样张对账 + R13 真机走查 + 隔离性 + 五门，进 main。

## 10. 与「四步清单自动隐藏」的关系

本计划起点是用户问「四步清单做完能不能消失」——结论：**做完(allDone)会 return null 消失；没做完无时间逻辑会一直挂顶栏**。讨论中升级为整条旅途重做。四步清单的被动打勾保留（§3）；「没做完过几天自动隐藏」是独立小改，可在本计划外单独决定，不阻塞本计划。
