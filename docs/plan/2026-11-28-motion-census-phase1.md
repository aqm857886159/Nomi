# MO-motion 第一段只读普查报告 · 全项目动效现状量化盘点与五维收口路线图

> 状态：📋 方案待拍板
> 对应协作看板：`#1586` · `MO-motion`（第一段单文件只读普查）
> 实查基线：`origin/main` @ `e0ad90bff`（2026-11-28；扫描 `src/` 下生产 UI 源文件 1,685 个、独立验证 `src/devlab/` 实验台文件 185 个及根配置 `tailwind.config.ts` / `index.html`）
> 分寸护栏：守 `#1709` 小桌面应用极简定位——动效只服务于创作者主干链路（**项目库 → 创作与分镜 → 生成画布与节点浮层 → 时间轴预览与导出 → 常驻 Agent 协作 → 模型接入与设置**）的空间方位感、跟手反馈与可访问性，不为装饰加戏，不造重型动画框架。

---

## 先查别人

- https://emilkowal.ski/ui/great-animations 与 https://animations.dev/ · Emil Kowalski（Sonner / Vaul 作者）UI 动效工程原则：每日高频触发数十至数百次的生产力控件（右键菜单、工作面切换、键盘导航）应保持瞬时响应（`0ms`）或极短微过渡，绝不加慢速进退场或卸载延迟锁死点击；确需进退场的浮层只动 `opacity + transform`（起始缩放 `≥0.95`，禁从 `0` 起跳），退场快于进场，且必须全程可打断（CSS `transition` 原生支持半途反向插值，优于 `setTimeout` 硬锁卸载） · **确认了/改了**本文两项核心决定：① 确认顶栏 `NomiStepper` 工作面切换、高频右键菜单 `WorkbenchContextMenu` 与 `Tooltip` 维持 `0ms` 瞬切不强加进退场动画（归入「明确不做」）；② 改了 `src/workbench/promptLibrary/PromptPreviewOverlay.tsx:88,102`（点击「放上画布」后 `950ms + 240ms = 1190ms` `setTimeout` 锁死全局模态输入层且退场期吞点击）与 `src/workbench/generation/GenerationWorkspace.tsx:126`（拖动手柄期间未旁路弹簧导致跟手滞后）的优先级，定为 A 类首批修复。
- https://developer.apple.com/design/human-interface-guidelines/motion · Apple Human Interface Guidelines（Motion）：动效仅用于解释界面空间关系与操作结果；开启「减弱动态效果（Reduce Motion）」时必须停止自动位移、缩放、旋转与持续闪烁，同时保留静态帧下清晰可辨的忙碌、进度与完成对比度 · **改了**本文维度 ④（`prefers-reduced-motion`）的根部修复方案——实查发现 `tailwind.config.ts:669-672` 在减弱动态下对 `.animate-spin` 统一强加 `opacity: 0.65`，导致 `12px–14px` 按钮内加载图标对比度劣化；同时 `src/workbench/ai/v4/AgentPanelV4Row.tsx:30`（`V4Shimmer`）停转后停留在 `200%` 宽渐变左半段造成文字左淡右深，据此拆出根部无障碍修复单 `MO-A2`。
- https://m3.material.io/styles/motion/easing-and-duration/tokens-specs · Material Design 3（Motion Easing & Duration Tokens）：用「有限时长档位 × 非对称进退曲线（进场减速 ease-out、退场加速 ease-in 且退场时长约为进场的 2/3）」构建唯一 Token 真源，业务组件只认语义槽位不写裸毫秒数，且不在无手势初速度的面板网格上滥用弹簧 · **确认了/改了**本文维度 ②（一套 Token 语言）的收口边界——确认沿用 `src/design/motion.ts:2-28` 已建成的六档时长 + `exitDurationMs`（2/3 取整 10ms）单一真源，**不新增第七档时长或全局弹簧 Token**；同时清理 `docs/design/nomi-agent-interaction.md:232-237` 残留的 `--nomi-motion-*` 死规范表（全仓 `0` 消费），并将仅存 4 个 `<motion.*>` 实例的 `framer-motion` 移出主工作台冷启动首屏包。
- https://motion.dev/docs/react-accessibility 与 https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html · Motion 官方无障碍文档（`MotionConfig reducedMotion="user"`）与 WCAG 2.1 SC 2.3.3：`<MotionConfig reducedMotion="user">` 仅自动抑制 `motion.*` 组件上的 `transform` / `layout` 位移（保留 `opacity`），**管不到** CSS `@keyframes`、Web Animations API（`element.animate`）、`scrollIntoView({ behavior: 'smooth' })` 以及写死毫秒数的 Tailwind `duration-100/150/200` 工具类 · **确认了**为什么单靠 `src/NomiAppProviders.tsx:31` 的 `<MotionConfig>` 无法完成全局兜底——必须同步清空 `scripts/motion-token-baseline.json` 中残留的 6 处硬编码数值 `duration-*`，并在根部 CSS 补齐自定义关键帧与 `scroll-behavior: auto` 规则。
- https://web.dev/articles/animations-guide · Google Chrome Web.dev（How to create high-performance CSS animations）：仅 `transform` 与 `opacity`（及现代 Chromium 独立 `scale` / `translate`）可稳定在合成器线程运行；对 `width`、`height`、`top`、`left`、`grid-template-columns`、`background-position` 逐帧插值会每帧触发主线程 Layout 或 Paint 重算 · **改了**本文维度 ⑤（性能预算与合成层纪律）的整改切口——实查证实全仓 `transition-all` 已清零（`0` 处），但挖出 `src/workbench/generation/GenerationWorkspace.tsx:105,125`（弹簧逐帧插值 CSS Grid 列宽驱动整张画布重排）、`src/workbench/ai/v4/AgentPanelV4Row.tsx:21`（`2400ms` 无限循环重绘 `backgroundPosition`）与 3 处进度条 `transition-[width]` 三类非合成层热点，逐一定出合成层替代方案。
- 出口：不涉及：本报告为 MO-motion 第一段只读普查文档，不改动任何生产代码，也不新增、扩大或挪动任何拒绝、加锁或等待类挡人保护。

---

## 短版设计卡

- **★1 用户怎么用（目标与可证伪指标）**：当创作者在 Nomi 主路径（项目库 → 创作/分镜 → 画布生成 → 时间轴预览/导出 → 常驻 Agent → 模型设置）连续高频操作时，界面状态切换应当方位清晰、拖拽与连击 100% 跟手可打断、开启系统「减弱动态效果」零眩晕且忙态清晰、50–200 节点画布下零非合成层动画掉帧；量化指标与量具：① 生产源码硬编码时长/曲线存量由 `scripts/motion-token-baseline.json` 的 **8 个文件 / 9 条豁免降至 `0`**（量具：`pnpm run check:tokens` + `eslint` `nomi-motion/tokens`）；② 生成页拖宽/收起常驻 Agent 面板期间主线程 Grid 重排帧数由 **~28 帧/次降至 `0` 帧插值**，且画布手势场景 `canvas-drag-20-nodes` / `canvas-pan-while-agent-streaming` / `window-narrow-drag` 帧间隔 `frameGapP95 ≤ 33ms`、`longTasks = 0`（量具：`pnpm run perf:scenarios`）；③ 提示词详情弹层点「放上画布」后模态锁死时长由 **`1190ms` 降至 `0ms` 阻塞**；★1b 连带界面：不适用（只读普查文档）；★1c 老用户：不适用（第一段零运行时与持久化改动，后续子单均不碰存档结构）。
- **★2 谁说了算（唯一 Owner 与门表边界）**：工作台动效刻度概念 `ui.motion-scale`（`docs/engineering/concept-owners/ui.motion-scale.json`）唯一真源为 `src/design/motion.ts:2-40`（`NOMI_DURATION_MS`、`exitDurationMs`、`NOMI_EASE`、`readBrowserMotion`、`shouldReduceMotion`、`TEXT_BUTTON_PRESS`），派生镜像为 `tailwind.config.ts:191-192,667-674,945-952`、`src/theme/nomi-tokens.css:80-95` 与 `src/theme/nomiTheme.ts:118-125,285-316`，画布命令式视口唯一协调入口为 `src/workbench/generationCanvas/reactFlow/useReactFlowViewportAnimation.ts:27`；门岗执法由 `scripts/lib/motionTokenScan.mjs`（同时接入 `scripts/check-design-tokens.mjs:86-110` 与 `eslint.config.mjs:1133-1156`）及 `src/design/motion.test.ts` 双重守卫。
- **★3 一致与复用（前序工作核对与三条路选择）**：核对前序提交 `72b04f98b` 与 `bddd78917`（2026-11-24 `MO-motion` Slice 1，`docs/plan/2026-11-24-mo-motion-slice1-tokens-and-gate.md`）：仓库**已建成**六档时长 Token、2/3 退场推导函数、`checkMotionMirror` 镜像校验、`scanMotionTokens` AST+PostCSS 扫描棘轮、`MantineProvider` `respectReducedMotion: true` 与根部 `<MotionConfig reducedMotion="user">`。故本次拒绝「推翻重造第二套 Token」或「全仓铺开 Framer Motion」，选择**沿既有 `src/design/motion.ts` 真源收口剩余盲区**：清零最后 9 条基线债务、拔除生成页孤立弹簧重排、补齐根部 `prefers-reduced-motion` 漏网项与门岗正则缺口。
- **★4 全状态与边界避让**：全状态视觉约定——空闲态零后台循环动画（`NomiAgentFace` 空闲改用 20s 低频定时器单次触发，见 `src/design/identity.tsx:208`）；加载/生成中在正常模式下保持低对比脉搏，在 `prefers-reduced-motion: reduce` 下停转但保留 `100%` 明度对比与 `role="status"` / `aria-busy` 语义；取消中与退场期间立即释放模态输入拦截（不吞后续点击）；能力不可用态保持静态可读提示；严格避让在途开放 PR `#1702`（62 个前端/脚本文件）、`#1703`（61 个前端/脚本文件）、`#1665`（38 个前端/脚本文件）、`#1692`（拍板清单对账）与 `#1715`（PR 行数门岗）。
- **★9 验收清单与反例**：正向检查——① 第 1 节全仓 AST + PostCSS 量化表精确到文件数与实例数（剔除 `src/i18n/` 英文单词 `"transition"` 等 76 处词典假阳性）；② 第 2 节完整覆盖五大维度且指明在途 PR 避让边界；③ 第 3 节 A 类立即可做子单与 `#1702` / `#1703` / `#1665` 在途修改文件交集实核为 **`0`**；④ 文档门岗 `evaluatePlan` / `evaluatePlans`、`documentStatus`（`📋`）、`check-no-secrets.mjs --all`、`check-pr-judgement.mjs`（`push` / `merge` 双档）全部 `0` 错；反例检查——① 检出任何本机绝对路径或禁用私有编号即判失败（实扫 `0` 命中）；② 改动除本文件外任何仓库文件即判失败（`git status` 仅新增本文件 1 项）；回滚方式：纯文档提交，如需撤回直接 `git revert` 该 commit。

---

## 明确不做

1. **第一段绝不改动任何生产代码、CSS、Token、测试或门岗基线**：本分支仅交付 `docs/plan/2026-11-28-motion-census-phase1.md` 单文件只读报告，待协调会话裁定后再按第 3 节拆分子单执行。
2. **绝不触碰在途开放 PR 正在施工的局部文件（硬性避让边界）**：
   - 避让 `#1702`（Seedance 2.5 样片模式）：不碰 `src/workbench/generationCanvas/nodes/{BaseGenerationNode,ComposerSendButton,NodeGeneratingOverlay,NodeLabelRow,composerAnchor,composerCanvasPlacement}.tsx`、`src/workbench/generationCanvas/nodes/sampleRow/NodeSampleRow.tsx`、`src/workbench/generationCanvas/nodes/versionCards/NodeVersionCards.tsx`、`src/workbench/generationCanvas/reactFlow/{GenerationCanvasReactFlow.tsx,selectionComposerViewport.ts}`、`src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx`、`src/workbench/observability/useGenerationFeedback.ts`、`src/workbench/taskCenter/TaskCenterPanel.tsx`；
   - 避让 `#1703`（图层分离与画板）：不碰 `src/workbench/generationCanvas/nodes/{InlineParameterBar,NodeGenerationComposer,NodeParameterControls}.tsx`、`src/workbench/generationCanvas/nodes/render/CardCommon.tsx`、`src/workbench/generationCanvas/nodes/whiteboard/{WhiteboardDrawingTool,WhiteboardLeaferCanvas}.tsx`、`src/workbench/generationCanvas/quickActions/ImageQuickActionsToolbar.tsx` 及 `docs/design/nomi-design-system.md`；
   - 避让 `#1665`（模型设置页重构）：不碰 `src/workbench/settings/{SettingsDialog,AiModelsSection,DefaultGenerationModelsSection,ModelBoxOrderSection}.tsx` 与 `src/ui/onboarding/{ModelSettingsHome,ModelSettingsWorkspacePages,OnboardingDrawer,AiAssistedOnboardingCard,ModelAccountCard,ModelEntryRow}.tsx`；
   - 避让 `#1692`（拍板清单对账）：A 类子单绝不增删任何 `docs/design/boards/**/*.board.json` 锚点。
3. **不为高频工作面切换、右键菜单、画布视口缩放加装饰性过渡**：
   - 不给顶栏 `NomiStepper`（创作 / 生成 / 预览）或生成页「画布 ⇄ 列表」切换加页面淡入淡出或左右滑屏（设计系统 §2.7 明确工作面切换属 `instant: 0ms`，加过渡只会拖慢每秒切换手感并拉高 `workbench-switch-stages` 响应耗时）；
   - 不给画布节点拖拽、框选、滚轮缩放或磁吸连线位置加平滑缓动（`src/workbench/generationCanvas/reactFlow/generationCanvasReactFlow.css:208` 已验证：跟手坐标加缓动 =「鼠标到了反馈才来」的粘滞感）；
   - 不在画布视口 `.react-flow__viewport` 上加 `will-change: transform`（2026-10-31 已实证会导致 Chromium 按高倍率锁死瓦片并撑爆 512MB 显存预算，见 `generationCanvasReactFlow.css:72-74`）。
4. **不新立第二套动效 Token、不引入新动画库、不搞全局页面级 FLIP 共享元素框架**：`src/design/motion.ts` 六档刻度已足够覆盖小桌面应用全部场景，只做减法收口。

---

## 一、全仓动效现状量化盘点（AST + PostCSS 实测）

### 1.0 前序基础核对（P5：先核对以前做过什么）

2026-11-24 合入的前序切片（提交 `72b04f98b` 与 `bddd78917`，见 `docs/plan/2026-11-24-mo-motion-slice1-tokens-and-gate.md`）已完成底层基建：
- 建立了唯一刻度真源 `src/design/motion.ts:2-40`：六档基础时长（`instant: 0ms`、`micro: 110ms`、`fast: 150ms`、`normal: 220ms`、`spatial: 360ms`、`morph: 550ms`）、1 个媒体加载周期（`media-loading-cycle: 1250ms`）、`exitDurationMs()` 2/3 退场时长公式（`fast-exit: 100ms`、`normal-exit: 150ms`、`spatial-exit: 240ms`）与四条三次贝塞尔曲线（`out`、`in`、`spatial`、`in-out` 及别名 `fast`、`morph`）；
- 接入了 `scripts/lib/motionTokenScan.mjs`（同时挂入 `scripts/check-design-tokens.mjs:86-110` 与 `eslint.config.mjs:1133-1156` `nomi-motion/tokens` 规则），将全仓 `transition-all`、裸 `cubic-bezier(...)`、JSX 内联 `@keyframes` 及新增数值 `duration-*` / `ease-*` 锁进棘轮；
- 挂上了 `src/NomiAppProviders.tsx:31` 的 `<MotionConfig reducedMotion="user">` 与 `src/theme/nomiTheme.ts:124` 的 `respectReducedMotion: true`。

本报告在此真实基线上，用 TypeScript AST（剥离注释、类型字面量与 `src/i18n/` 自然语言句子中含英文单词 `"transition"` 的 76 处词典假阳性）与 PostCSS 对全仓 **1,685 个生产前端文件**（`src/**/*.{ts,tsx,css}`，排除测试、`*.d.ts`、`src/devlab/` 185 个文件、`src/vendor/`）及根配置做全量盘点。

### 1.1 全仓动效技术栈分布总表

| 动效承载方式 | 细分原语 / 类族 | 生产文件数 | 实例数 | 主要分布位置与代表落点（`file:line`） |
|---|---|---:|---:|---|
| **① Framer Motion**（`framer-motion@^12.39.0`） | `import ... from 'framer-motion'` | **5** | **5** | `src/NomiAppProviders.tsx:1`、`src/dev/optimizeDepsEntry.ts:34`、`src/ui/browser/BrowserCaptureFlyouts.tsx:1`、`src/ui/browser/popover/BrowserAssetPopoverView.tsx:6`、`src/workbench/generation/GenerationWorkspace.tsx:8`（另实验台 `src/devlab/designLab.tsx:26` 1 处） |
| | `<motion.*>` 渲染节点 | **3** | **4** | `src/ui/browser/BrowserCaptureFlyouts.tsx:21,73`（采集飞入缩略图 + 强调闪光）、`src/ui/browser/popover/BrowserAssetPopoverView.tsx:85`（采集收件箱浮窗）、`src/workbench/generation/GenerationWorkspace.tsx:116`（生成页根网格） |
| | `<AnimatePresence>` / `<MotionConfig>` / `useReducedMotion` | **3** | **4** | `BrowserCaptureFlyouts.tsx:17,19`、`NomiAppProviders.tsx:31`、`GenerationWorkspace.tsx:69`；全仓 `layout` / `layoutId` = **`0`** |
| **② Tailwind `transition*`**（合计 **129 文件 / 214 处**） | `transition-colors` | **80** | **109** | 侧栏、列表行、小图标钮、分段器 `src/design/NomiSegmented.tsx:80`、左栏 `src/ui/app-shell/shell/ShellRail.tsx:276` |
| | `transition-[...]`（显式属性列表） | **37** | **63** | 通用按钮 `src/design/actions.tsx:27,96,156,212,312`、顶栏步进器 `src/design/identity.tsx:362`、进度条 `src/workbench/preview/TimelinePreview.tsx:587` |
| | `transition-opacity` | **16** | **16** | 消息悬停动作条 `src/workbench/ai/v4/AgentPanelV4Message.tsx:163`、时间轴裁剪把手 `src/workbench/timeline/TimelineClip.tsx:297` |
| | `transition-transform` | **14** | **16** | 折叠箭头旋转 `src/workbench/ai/v4/AgentPanelV4Message.tsx:232`、卡片叠放 `src/workbench/generationCanvas/components/CardStackPeeks.tsx:50` |
| | `transition-shadow` / `transition-none` / 裸 `transition` | **7** | **10** | `transition-shadow` 4 文件 6 处；`motion-reduce:transition-none` 2 文件 3 处；裸 `[&>button]:transition` 1 文件 1 处（`src/workbench/generationCanvas/nodes/whiteboard/WhiteboardLeaferCanvas.tsx:753`） |
| | `transition-all` | **0** | **0** | 生产 `src/` 与 `src/devlab/` 均为 **`0` 处**（已由 `scripts/lib/motionTokenScan.mjs:6` 锁死） |
| **③ Tailwind `duration-*` / `ease-*`** | `duration-nomi-*`（合规 Token 类） | **58** | **99** | `duration-nomi-fast` 50 文件 **79** 处、`duration-nomi-micro` 9 文件 **19** 处、`duration-nomi-morph` 1 文件 **1** 处（`src/design/identity.tsx:248`）；另有 **74 文件 / 107 处** `transition-*` 省略时长，直接继承 `tailwind.config.ts:946` 默认值 `micro (110ms)` |
| | 硬编码数值 `duration-*`（存量豁免债） | **6** | **6** | `duration-150` **4** 处、`duration-200` **1** 处、`duration-100` **1** 处（全部登记于 `scripts/motion-token-baseline.json`，见 §1.2） |
| | `ease-nomi-*`（合规曲线类） / 裸 `ease-*` | **48** | **78** | `ease-nomi-fast` 44 文件 **69** 处、`ease-nomi-out` 4 文件 **8** 处、`ease-nomi-morph` 1 文件 **1** 处；裸 `ease-in/out/in-out/linear` 与 `delay-*` 均为 **`0` 处** |
| **④ Tailwind `animate-*`**（合计 **29 文件 / 53 处**） | `animate-spin` | **17** | **21** | 规范组件 `NomiLoadingMark` 仅占 1 处（`src/design/identity.tsx:308`），其余 **16 文件 / 20 处**为业务侧散写 `IconLoader2` / `IconRefresh` / 边框圆环旋转 |
| | `animate-pulse` | **7** | **11** | 骨架占位与状态点：`src/design/status.tsx:97`、`src/workbench/generationCanvas/nodes/artifact/ArtifactBody.tsx:51,82,157,249,303`、`InlineParameterBar.tsx:520` 等 |
| | `animate-nomi-*` / `animate-remove-bg-*` | **6** | **10** | `tailwind.config.ts:933-942` 定义 9 条受管动画，消费于 `src/design/identity.tsx:258,278,279,293`、`ShellAgentHost.tsx:291`、`PromptPreviewOverlay.tsx:114`、`TaskCenterPanel.tsx:201`、`BaseGenerationNode.tsx:312,361`、`WhiteboardLeaferCanvas.tsx:695` |
| | `motion-reduce:animate-none` | **7** | **11** | 显式挂在组件类名上的减弱动态停转修饰符；`animate-bounce` / `animate-ping` / `animate-[...]` 全仓均为 **`0` 处** |
| **⑤ 原生 CSS / 行内样式 / 命令式动画** | `.css` 文件 `transition` / `animation` / `@keyframes` | **2** | **11** | `src/workbench/generationCanvas/reactFlow/generationCanvasReactFlow.css:156,209,223`（3 处 `transition`）、`src/workbench/generationCanvas/styles/generationCanvas.css:74,80,83,115,136,141,199,208`（3 处 `transition` + 3 处 `animation` + 2 个 `@keyframes`）；另有 `index.html:54,57` 启动加载圈与 `electron/capabilityCore/mcpAppWidget.ts:287,290` MCP 小组件状态点 |
| | JSX 行内 / DOM `style.transition` | **2** | **4** | `src/workbench/ai/v4/AgentPanelV4AskCard.tsx:112,315`（反问卡滑块与卡高过渡）、`src/workbench/promptLibrary/PromptPreviewOverlay.tsx:71,85`（提示词卡片 FLIP 进退场） |
| | Web Animations API（`element.animate`） | **3** | **3** | `src/workbench/ai/v4/AgentPanelV4Row.tsx:21`（`V4Shimmer` 2400ms 扫光）、`src/workbench/generationCanvas/nodes/GenerationStatusBar.tsx:15`（状态点 1600ms 呼吸）、`src/workbench/timeline/pulseSnap.ts:5`（时间轴吸附 `110ms` 微脉冲） |
| | 平滑滚动与画布视口动画 | **4** | **4** | `scrollIntoView` / `scrollBy` `behavior: 'smooth'` 3 处（`InlineParameterBar.tsx:183`、`ModelCapabilityEditor.tsx:92`、`ModelSettingsHome.tsx:307`）；画布视口逐帧协调器 1 处（`useReactFlowViewportAnimation.ts:47,85`，封装 5 文件 8 处 `setViewport(..., { duration: 0 })`） |
| **⑥ Mantine / Radix / 自研浮层原语过渡** | Mantine 内置 `Transition` 族 | **4 原语** | **63 调用** | `DesignModal`（`normal` 220ms/150ms，18 文件 18 处）、`ShellRail` `Drawer`（`slide-right` 220ms/150ms，1 处）、`NomiSelect` `Combobox`（`fast` 150ms/100ms，24 文件 43 处）、`Notifications`（`fast` 150ms，全局 1 宿主）、裸 `Collapse`（默认 200ms，1 处 `OnboardingWizardAdvancedFields.tsx:117`） |
| | Radix 无头浮层 + `AnchoredPopover` | **4 原语** | **59 调用** | `WorkbenchMenu`（14 文件 14 处）、`WorkbenchContextMenu`（3 文件 4 处）、`Tooltip`（21 文件 26 处）、`HoverCard`（2 文件 2 处）、`AnchoredPopover`（13 文件 13 处）——当前全部为 **`0ms` 瞬时挂载/卸载**，未挂进退场 CSS 动画 |

### 1.2 绕过设计系统硬编码时长 / 缓动 / 弹簧的真实存量盘点

对照 `src/design/motion.ts` 真源，全仓现存 **5 类共 19 处**绕过统一动效 Token 体系的硬编码点位（其中前两类共 9 条在 `scripts/motion-token-baseline.json` 冻结，后三类共 10 处为当前门岗未覆盖盲区）：

| 绕过类别 | 精确位置（`file:line`） | 硬编码现状 | 门岗状态 | 对应合规改法 |
|---|---|---|---|---|
| **1. Tailwind 数值时长类**（6 文件 6 处） | `src/ui/onboarding/ApimartConnectedHint.tsx:25` | `transition-opacity duration-200`（且 `21-22` 行写死 `3800ms/4000ms` 200ms 差值卸载） | 已锁 `motion-token-baseline.json` | 改 `duration-nomi-normal`（`220ms`）或退场 `duration-nomi-normal-exit`（`150ms`），卸载延时直接读 `NOMI_DURATION_MS` |
| | `src/ui/onboarding/FoldableModelCard.tsx:133` | `transition-transform duration-150` | 已锁基线 | 改 `duration-nomi-fast ease-nomi-fast` |
| | `src/ui/onboarding/ModelPickerScreen.tsx:343` | `transition-colors duration-100` | 已锁基线 | 删 `duration-100`（默认即 `micro: 110ms` + `ease-out`） |
| | `src/ui/onboarding/NetworkSection.tsx:163` | `transition-transform duration-150` | 已锁基线 | 改 `duration-nomi-fast ease-nomi-fast` |
| | `src/ui/onboarding/OnboardingWizardAdvancedFields.tsx:47` | `transition-[background,color,border-color] duration-150` | 已锁基线 | 改 `transition-colors duration-nomi-fast ease-nomi-fast` |
| | `src/workbench/settings/TikhubConnectorCard.tsx:100` | `transition-transform duration-150` | 已锁基线 | 改 `duration-nomi-fast ease-nomi-fast` |
| **2. 手写 `matchMedia` 重复查询**（2 文件 3 处） | `src/ui/onboarding/ApimartConnectPage.tsx:74` · `src/ui/onboarding/ApimartWorksCollage.tsx:12,17` | 绕过 `src/design/motion.ts` 的 `shouldReduceMotion()` / `reducedMotionQuery()` 直写 `window.matchMedia('(prefers-reduced-motion: reduce)')` | 已锁基线 | 统一改调 `shouldReduceMotion()` 与 `reducedMotionQuery()` |
| **3. 私有 Framer Motion 弹簧常量**（2 文件 2 处） | `src/workbench/generation/GenerationWorkspace.tsx:44-49` · `src/ui/browser/popover/BrowserAssetPopoverView.tsx:102` | `stiffness: 320, damping: 34, mass: 0.9` 与 `stiffness: 420, damping: 30, mass: 0.8`（`motion.ts` 无弹簧定义） | **门岗盲区**（`scanMotionTokens` 只拦数值 `duration` 与数组 `ease`，不拦 `type: 'spring'`） | 生成页停靠栏删弹簧对齐其余三页 CSS Grid；浏览器收件箱改 `NOMI_DURATION_MS.fast` + `NOMI_EASE.out` |
| **4. WAAPI / Mantine 未接线循环与折叠时长**（3 文件 3 处） | `src/workbench/ai/v4/AgentPanelV4Row.tsx:23`（`duration: 2400`） · `src/workbench/generationCanvas/nodes/GenerationStatusBar.tsx:15`（`duration: 1600`） · `src/ui/onboarding/OnboardingWizardAdvancedFields.tsx:117`（`<Collapse>` 默认 `200ms ease`） | WAAPI 对象直接传毫秒数字未被 AST 视作 JSX `transition` 属性；`nomiTheme.ts` 未给 `Collapse` 配默认 `transitionProps` | **门岗盲区** | 周期常量收归 `motion.ts` 语义常量（与 `media-loading-cycle: 1250` 同构）；`nomiTheme.ts` 为 `Collapse` 补 `NOMI_DURATION_MS.fast`（或改原生 `<details>`） |
| **5. 根外独立 HTML / 内联模板动画与延迟参数**（5 文件 5 处） | `index.html:54`（`680ms linear`） · `electron/capabilityCore/mcpAppWidget.ts:287`（`1.1s ease-in-out`） · Tooltip 延迟三处各写各数（`nomiTheme.ts:335` `140ms`、`ShellRail.tsx:263` `180ms`、`ShellAgentHost.tsx:78` `250ms`） | `isMotionSource()` 仅扫 `src/**/*.{ts,tsx,css}`；Tooltip 延迟未收敛为共享常量 | **门岗盲区** | `index.html` 与 `mcpAppWidget.ts` 补 `prefers-reduced-motion`；`TooltipProvider` 默认 `delayDuration` 在 `src/design/tooltip.tsx` 收口为统一 `180ms` |

---

## 二、五大核心维度逐项审计（创作者主路径视角）

### 维度 ①：按状态变化找（有意义的连续性 vs 突兀生灭 / 噪音动效）

沿创作者六大主界面逐项核查关键状态跃迁（已严格排除 `#1702`、`#1703`、`#1665` 正在施工的节点样片行、图层分离画板与模型设置页）：

1. **常驻 Agent 停靠栏开合跨页割裂（生成页弹簧缓动 vs 其余三页硬切）**：
   - **代码实证**：按下快捷键 `Mod+\` 或点击顶栏右上角 Nomi 入口切换常驻 Agent 停靠栏时，`src/workbench/generation/GenerationWorkspace.tsx:105,116-126` 使用 `<motion.section>` + `ASSISTANT_LAYOUT_SPRING` 对 `--generation-assistant-width` 做约 `350ms` 弹簧伸缩；而 `src/workbench/creation/CreationWorkspace.tsx:30`、`src/workbench/creation/storyboard/StoryboardWorkspace.tsx:43,57` 与 `src/workbench/preview/PreviewWorkspace.tsx:210` 直接切换静态 `assistantDockColumns(width)`（`0ms` 瞬切）。仅在窗口跨过 `1060px` 窄窗阈值展回时，`src/ui/app-shell/shell/ShellAgentHost.tsx:291` 播一次 `animate-nomi-agent-dock-in`（`220ms` `translateX(24px)`）。
   - **创作者体感**：在创作页和预览页开关 Agent 干脆利落，切到生成页开关同一个面板却突然变成整张画布网格跟着弹簧挤压重排，同一外壳控件在四个工作区手感分裂。
2. **同排浮层「一半有过渡、一半硬生灭」**：
   - **代码实证**：Mantine 承载的 `NomiSelect`（`src/design/NomiSelect.tsx:258` → `nomiTheme.ts:300`，`150ms` 进 / `100ms` 退）、`DesignModal`（`220ms` / `150ms`）、左栏 `Drawer`（`ShellRail.tsx:301`，`slide-right` `220ms` / `150ms`）与右上 `Notifications`（`150ms`）均有平滑过渡；但紧挨着 `NomiSelect` 摆放的 `WorkbenchMenu`（`src/design/menu.tsx:236`，14 个文件调用）、`HoverCard`（`src/design/hoverCard.tsx:24`）与 `AnchoredPopover`（`src/design/AnchoredPopover.tsx:238`）全部为 `0ms` 硬生灭（其中 `TaskCenterPanel.tsx:201` 单独手写了 `animate-nomi-panel-pop` 进场、退场仍硬切）。
   - **取舍判断**：`AnchoredPopover` 的 `opacity: placement ? 1 : 0` 是为了两段式测量防首帧跳闪，右键菜单与 `Tooltip` 需保持极致跟手；但按钮下拉菜单 `WorkbenchMenu` 与预览卡 `HoverCard` 是否补齐无卸载延迟的轻量 `nomi-panel-pop`（`150ms` `translateY(-4px) scale(0.985)` 进场），值得作为 **B 类候选（`MO-B1`）** 在设计实验室对比拍板。
3. **提示词库详情弹层「放上画布」后的拖泥带水噪音等待**：
   - **代码实证**：`src/workbench/promptLibrary/PromptPreviewOverlay.tsx:99-103` 在用户点击主按钮「放上画布」后，明明 `onAddToCanvas(prompt)` 已同步落入画布，弹层却在原地强留 **`950ms`** 才调 `close()`，随后再播 **`240ms`** 缩小退场动画（合计 **`1190ms`** 才真正关闭弹窗），拖慢连续挑提示词入画布的节奏。
4. **Agent 对话流折叠与流式状态反馈**：
   - **代码实证**：思考块（`src/workbench/ai/v4/AgentPanelV4Message.tsx:238` `<details>`）与工具组收据（`src/workbench/ai/v4/AgentPanelV4Receipt.tsx:72,177`）仅给右侧小箭头加了 `110ms` `rotate-90` 过渡，内容展开本身 `0ms` 直出、配合 `use-stick-to-bottom`（`AgentPanelV4Panel.tsx:19`）保持阅读锚点不乱跳——这是**正确的克制设计**。唯二瑕疵是：① 任务卡进度条 `src/workbench/ai/v4/AgentPanelV4Cards.tsx:133` 与生成等待条 `src/workbench/generationCanvas/nodes/GenerationWaitingSurface.tsx:40` 宽度突变无平滑过渡；② 散落 16 个文件的 20 处 `IconLoader2` / `IconRefresh` `animate-spin` 偏离了设计系统 §3.9.1「`NomiLoadingMark` 为全仓唯一加载动画」的书面规定（归入 **B 类 `MO-B2`** 定分寸）。
5. **生成中 → 出片落版瞬间（避让 `#1702` / `#1703`）**：
   - **代码实证**：`src/workbench/generationCanvas/nodes/NodeGeneratingOverlay.tsx:21-35` 与 `GenerationWaitingSurface.tsx:22-25` 在 `completed` 变真时立即 `onComplete()` 卸载等待层（`0ms` 硬切到底层异步解码的 `DeferredNodeImage`），而画布顶部过程胶囊 `GenerationStatusBar` 完成态保留后淡出。因 `NodeGeneratingOverlay.tsx` 与 `BaseGenerationNode.tsx` 正处于 `#1702` / `#1703` 核心施工面，本轮列为 **B 类远期项（`MO-B4`）** 严禁抢改。

---

### 维度 ②：一套 Token 语言（单源收敛、清理死规范与门岗锁死）

1. **现有六档刻度的实际消费分布严重偏斜，但不应缩减真源档位**：
   - 实测 Tailwind 类名层：`fast (150ms)` 占 **79 处**、默认隐式 `micro (110ms)` 占 **107 处**、显式 `micro` 占 **19 处**、`morph (550ms)` 占 **1 处**，而 `normal (220ms)` 与 `spatial (360ms)` 在 Tailwind 类名层为 `0` 处——但二者正通过 `NOMI_DURATION_MS` 与 `var(--nomi-duration-*)` 服务于 `DesignModal`、`Drawer`、新节点落点弹入（`generationCanvas.css:80`）、反问卡滑动（`AgentPanelV4AskCard.tsx:69`）与提示词 FLIP（`PromptPreviewOverlay.tsx:71`）。即：**微交互 `micro 110ms` / 浮层菜单 `fast 150ms` / 抽屉模态 `normal 220ms` / 跨位承接 `spatial 360ms` / 采集形变 `morph 550ms` 各有明确宿主**，无需另起新刻度。
2. **两份文档真相源冲突（必须清退死规范）**：
   - `docs/design/nomi-agent-interaction.md:216,232-237` 至今写着「主文档 §2.7 只有一条 token（`--nomi-duration-fast` 140ms）」，并定义了 `--nomi-motion-tap / -enter / -settle / -breathe / -sweep / -develop` 六个 CSS 变量——全仓 `git grep "--nomi-motion-"` 实测为 **`0` 定义、`0` 消费**。保留这段过时文字会误导后续 Agent 面板实现线手写不存在的变量（静默回退 `0s`），应在 `MO-A6` 直接改为引用 `src/design/motion.ts`。
3. **Framer Motion 在主包中的定位收口（P0 / P1）**：
   - `framer-motion` 当前在 `src/NomiAppProviders.tsx:1` 被顶层静态导入，导致每次主窗口冷启动都解析整包 `framer-motion`，而整个主窗口工作台只有 **`GenerationWorkspace.tsx:116` 1 个节点**在用它（其余 2 个文件 `BrowserCaptureFlyouts.tsx` 与 `BrowserAssetPopoverView.tsx` 属于内置浏览器采集子视图）。去掉 `GenerationWorkspace.tsx` 的孤立弹簧并将 `<MotionConfig reducedMotion="user">` 下沉到浏览器采集树根后，主工作台首屏即可零成本剥离 `framer-motion` 运行时开销。
4. **零成本锁死新增硬编码的门岗补强点（`scripts/lib/motionTokenScan.mjs`）**：
   - 现有 `eslint` `nomi-motion/tokens` + `check:tokens` 已能拦截 `duration-300`、`duration-[150ms]`、`ease-in-out`、`cubic-bezier(...)`、`transition-all`、内联 `@keyframes` 及 JSX `transition={{ duration: 0.2 }}`。
   - **实查发现 3 个零成本可补齐的漏检口**：
     1. `scripts/lib/motionTokenScan.mjs:6` 的 `utility` 正则写为 `ease-(?:in-out|out|in|\[[^\]\n]+\])`，**漏掉了 `ease-linear` 与 `delay-\d+` / `delay-[...]`**（补入正则仅需 1 行，当前全仓存量恰为 `0`，零误报直接锁死）；
     2. `inspectTransition`（`motionTokenScan.mjs:75-89`）只拦数值 `duration` 与数组 `ease`，**漏掉了 `{ type: 'spring', stiffness: ..., damping: ... }`**（补入后可防止业务组件私造未登记弹簧参数）；
     3. 清完 `scripts/motion-token-baseline.json` 现有的 8 个文件 9 条存量后，基线文件可锁死为空对象 `{}`，实现全仓 **`0` 例外硬门**。

---

### 维度 ③：跟手与可打断（Interruptibility）

逐一实查高频连击、拖拽与视口变换下的打断表现：

1. **生成页拖拽常驻 Agent 分隔线「弹簧追手」滞后（高优缺陷 · `MO-A1`）**：
   - **根因链路**：用户在生成页按住 `src/workbench/AssistantPane.tsx:44-45` 的分隔线左右拖动时，`onPointerMove` 每帧写入 `workbenchStore.editingPanelLayout.assistantWidth`；`src/workbench/generation/GenerationWorkspace.tsx:68,73,99,125-126` 订阅该宽度并喂给 `<motion.section animate={{ '--generation-assistant-width': assistantColumnWidth }} transition={reduceMotion ? { duration: 0 } : ASSISTANT_LAYOUT_SPRING}>`。
   - **反例对比**：同仓 `src/ui/browser/popover/BrowserAssetPopoverView.tsx:98` 专门写了 `isWindowInteracting ? { duration: 0 } : ...` 在拖拽窗口时旁路弹簧，而 `GenerationWorkspace.tsx` **完全没有判断 `dragging` 状态**！结果用户每次移动鼠标都在隔着一层 `stiffness: 320, damping: 34` 的弹簧拉扯网格列，松手后画布列宽还会继续惯性蠕动约 `250ms`，违背设计系统 §2.7「拖动期间位置跟手」铁律。
2. **提示词详情弹层 `PromptPreviewOverlay` 不可打断的 `1190ms` 卸载锁（高优缺陷 · `MO-A4`）**：
   - **根因链路**：`src/workbench/promptLibrary/PromptPreviewOverlay.tsx:36` 无条件挂载 `useModalInputLayer(true)`（向全局登记模态遮罩，拦截工作区快捷键、粘贴与手势）；第 `102` 行 `handleAdd` 点完主按钮后用裸 `window.setTimeout(close, 950)` 硬等近 1 秒，第 `88` 行 `close()` 再用 `window.setTimeout(onClose, EXIT_MS)` 等 `240ms` 退场，且退场期间第 `114` 行 `fixed inset-0` 遮罩**未设 `pointer-events-none`**，两处 `setTimeout` 也**未在组件卸载时清理**。
   - **后果**：创作者点完「放上画布」想立刻点下一张提示词卡或按快捷键操作画布时，整整 `1.19 秒` 内点击落空或被退场遮罩吞掉。
3. **已验证跟手良好的机制（正面核实，不乱改）**：
   - **分段器与顶栏步进器连续快切**：`src/design/NomiSegmented.tsx:80` 与 `src/design/identity.tsx:362`（`NomiStepper`）均采用纯 CSS 颜色/背景过渡且零卸载延迟，连续点击或键盘切换立即响应；
   - **Agent 反问卡单选自动翻页可打断**：`src/workbench/ai/v4/AgentPanelV4AskCard.tsx:227-244` 在 `ASK_AUTO_ADVANCE_MS`（`480ms`）定时器触发前，若用户改选、点跳过、翻页或按回车，均先 `clearTimeout(advanceTimer.current)` 干净接管；
   - **画布缩放平移中浮层跟随与视口打断**：`src/workbench/generationCanvas/reactFlow/useReactFlowViewportAnimation.ts:57` 在用户手势介入瞬间调 `takeOwnershipAndCancel()` 立即中断在飞视口动画；`AnchoredPopover.tsx:173-178` 用 `@floating-ui/dom` 的 `autoUpdate`（基于 `IntersectionObserver` + `ResizeObserver`，刻意不开空闲耗电的每帧 `animationFrame` 轮询）跟随锚点；画布拖拽期间 `NodeGenerationComposer.tsx:384` 用 `group-data-[dragging=true]/canvas:invisible` 隐身保住 TipTap 实例不重挂、`generationCanvasReactFlow.css:223` 强制 `transition: none !important` 防残影。

---

### 维度 ④：减少动态效果（`prefers-reduced-motion` 无障碍与防眩晕）

#### 4.1 全仓现有响应点位精确统计

| 响应层级 | 精确位置（`file:line`） | 覆盖文件数 | 实例数 | 当前实际效果 |
|---|---|---:|---:|---|
| **CSS 根变量与全局类重置** | `tailwind.config.ts:667-674` | **1**（全局生效） | **2 规则** | ① 将 `:root` 全部 `--nomi-duration-*` 置为 `0ms`；② 将 `.animate-spin, .animate-pulse, .animate-remove-bg-pulse, .animate-remove-bg-pulse-slow` 置为 `animation: none !important; opacity: 0.65` |
| **组件样式表 `@media`** | `src/workbench/generationCanvas/styles/generationCanvas.css:134-139` | **1** | **1** | 停止 `.generation-canvas-v2-node__media-loading[data-media-state='loading']::before` 的 `1250ms` 扫光 |
| **Mantine / Motion 框架根配置** | `src/theme/nomiTheme.ts:124` · `src/NomiAppProviders.tsx:31` | **2**（全局生效） | **2** | Mantine 浮层 `respectReducedMotion: true`；Framer Motion `<MotionConfig reducedMotion="user">` |
| **Tailwind `motion-reduce:` / `motion-safe:` 变体** | `src/design/{motion.ts:82,identity.tsx:248-308,status.tsx:97}`、`ShellAgentHost.tsx:291`、`PromptPreviewOverlay.tsx:114`、`TaskCenterPanel.tsx:201` 等 | **13** | **20** | `motion-reduce:` 9 文件 16 处（含按钮按压禁缩放 `TEXT_BUTTON_PRESS`）；`motion-safe:` 4 文件 4 处 |
| **JS 运行时偏好读取** | `src/design/motion.ts:51-79` 导出函数 → 9 个业务文件调用（+ 2 个文件 3 处裸 `matchMedia`） | **11** | **15** | 控制画布视口 `duration: 0`、状态点 `GenerationStatusBar` 停呼吸、`V4Shimmer` 停扫光、`PromptPreviewOverlay` 跳 FLIP、APIMart 演示视频 `SeedanceMotionTile` 停播只显海报帧 |

#### 4.2 实查抓出的 5 处开启「减弱动态效果」仍强跑或显示异常的漏网点

1. **漏网点 1（忙态可读性退化）**：`tailwind.config.ts:669-672` 把 `.animate-spin` 与骨架屏 `.animate-pulse` 混在同一条规则里强加 `opacity: 0.65`！结果系统开启减弱动态后，全仓 17 个文件 21 处正在忙碌的加载图标（含 `NomiLoadingMark` 及按钮内 `12px` `IconLoader2`）不仅停转，还被整体压淡到 `65%` 不透明度，违背设计系统 §2.7「加载标保留 busy 状态、图案与明度差」。
2. **漏网点 2（6 处硬编码 Tailwind 时长绕过 `:root 0ms` 归零）**：`scripts/motion-token-baseline.json` 中的 6 处 `duration-100 / duration-150 / duration-200` 编译为字面量 `100ms / 150ms / 200ms`，不读 `--nomi-duration-*`，在减弱动态下照跑不误；同理 `OnboardingWizardAdvancedFields.tsx:117` 的 Mantine `<Collapse>`（未配 `transitionDuration`，且 Mantine `Collapse` 自身不读 `respectReducedMotion` 主题开关）仍在跑 `200ms` 高度折叠动画。
3. **漏网点 3（2 处平滑滚动强跑造成视口眩晕）**：`src/ui/onboarding/ModelCapabilityEditor.tsx:92` 与 `src/ui/onboarding/ModelSettingsHome.tsx:307` 硬写 `scrollIntoView({ behavior: 'smooth' })`，未像 `InlineParameterBar.tsx:183` 那样判断 `shouldReduceMotion()`，也无根部 CSS `scroll-behavior: auto !important` 兜底。
4. **漏网点 4（`V4Shimmer` 静态帧半截渐变失真）**：`src/workbench/ai/v4/AgentPanelV4Row.tsx:14-30` 在 `prefers-reduced-motion: reduce` 下虽然取消了 `animate()`，但保留了 `style={{ backgroundSize: '200% 100%' }}` 与 `bg-gradient-to-r from-nomi-ink-40 via-nomi-ink to-nomi-ink-40 bg-clip-text text-transparent`，导致思考行文字左半边发灰（`ink-40`）、右半边偏深（`ink`）。
5. **漏网点 5（根 CSS 之外的独立动画与自定义关键帧缺根部兜底）**：① 应用冷启动首屏 `index.html:54` 的 `#nomi-boot-spinner`（`animation: nomi-boot-spin 680ms linear infinite`）与 `electron/capabilityCore/mcpAppWidget.ts:287` 的 `.dot.running` 均无 `@media (prefers-reduced-motion: reduce)` 规则；② `tailwind.config.ts:938-941` 的 `animate-nomi-agent-{scan,hop,blink,spin}` 写死 `1.4s / 700ms / 600ms / 1.1s` 且未列入 `tailwind.config.ts:669` 根部停转选择器（目前仅靠 `identity.tsx` 调用处手写 `motion-reduce:animate-none`，一旦复用到第二处忘写即强跑）。

#### 4.3 根部一处统一兜底方案（不靠每个业务组件自觉）

在 `tailwind.config.ts:667-674` 的 `addBase` 单一入口收口：
- 保留 `:root` 全套 `--nomi-duration-*: 0ms`；
- 将 `.animate-spin` 与 `.animate-nomi-agent-{scan,hop,blink,spin}` 单独设为 `animation: none !important`（**不降 `opacity`**，保住 100% 忙态对比度），仅对 `.animate-pulse, .animate-remove-bg-pulse, .animate-remove-bg-pulse-slow` 保留 `animation: none !important; opacity: 0.65`；
- 新增 `html, body, *, *::before, *::after { scroll-behavior: auto !important }` 兜底 CSS 平滑滚动，辅以 JS 层 `scrollIntoView({ behavior: shouldReduceMotion() ? 'auto' : 'smooth' })` 拦截脚本参数。

---

### 维度 ⑤：性能预算与合成层纪律（`perf` 场景）

#### 5.1 全仓非合成层动画属性排查（`transition-all` = `0` 处，抓出 4 类真实非合成层过渡）

1. **`transition-all` 全仓清零核实**：全仓生产代码与 `src/devlab/` 中 `transition-all` 实例数均为 **`0`**（仅出现在门岗 `scripts/lib/motionTokenScan.mjs:6,12` 与其单测 `scripts/motionTokenScan.test.mjs:8,63` 中）。
2. **非合成层热点 P-1（最高危）：`GenerationWorkspace.tsx` 弹簧逐帧重排整张画布 CSS Grid**：
   - 位置：`src/workbench/generation/GenerationWorkspace.tsx:105,116-126`。
   - 机理：Framer Motion 在 JS 主线程每帧改写行内样式 `--generation-assistant-width`，直接驱动父级网格 `grid-template-columns: minmax(min(684px, 100%), 1fr) minmax(...)` 重算列宽。当生成画布挂有 50–200 个节点时，约 `350ms`（20–28 帧）内每一帧都触发画布容器布局重算及内部 `ResizeObserver`（如 `NodeFloatingToolbar.tsx:88`、`ShellAgentHost.tsx:59`）级联回调！而其余三个工作区本来就是 `0ms` 直接落位。
3. **非合成层热点 P-2（流式期持续 Paint）：`V4Shimmer` `2400ms` 无限重绘 `backgroundPosition`**：
   - 位置：`src/workbench/ai/v4/AgentPanelV4Row.tsx:21-24`。
   - 机理：`backgroundPosition` 属于非合成层 Paint 属性，配合 `bg-clip-text` 在 Agent 思考/运行期间以 60fps 持续触发文本图层光栅化重绘（与 `canvas-pan-while-agent-streaming` 场景并发抢占渲染帧预算）。改为伪元素 `transform: translateX(...)` 遮罩扫光或合成层 `opacity` 呼吸（同 `GenerationStatusBar.tsx:15` 的 `opacity: 0.5 → 1`），即可将主线程每帧重绘降为 `0`。
4. **非合成层热点 P-3（进度条 `transition-[width]` 触发布局计算，3 文件 3 处）**：
   - 位置：`src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx:364`、`src/workbench/preview/TimelinePreview.tsx:587`、`src/workbench/taskCenter/TaskCenterPanel.tsx:409`（注：另有 `AgentPanelV4Cards.tsx:133` 与 `GenerationWaitingSurface.tsx:40` 直接改 `width` 无 transition）。
   - 机理：高频进度百分比更新时对 `width` 做过渡会逐帧触发局部 Layout；改为 `w-full origin-left transition-transform` + `style={{ transform: 'scaleX(...)' }}` 即可 100% 跑在 GPU 合成层。
5. **非合成层点位 P-4（受控小范围，评估后保留/微调，2 文件 4 处）**：
   - ① `src/design/identity.tsx:264,276,286`（`NomiAgentFace` 顶栏 26×26px 图标内 5 个绝对定位 `<span>` 的 `left/right/top/width/height/border-radius` `550ms` 姿态形变）：因仅在状态切换瞬间触发一次、且局限在 26px `overflow-hidden` 绝对定位小盒内，但外框未加 `contain: layout paint`——补一行 `contain-strict`（或 `[contain:layout_paint]`）即可彻底隔离出顶栏布局树；
   - ② `src/workbench/ai/v4/AgentPanelV4AskCard.tsx:114,315`（反问卡 `AskGlideMenu` `top/height` 与题卡容器 `height`）：`AskGlideMenu` 可直接改为 `transform: translateY(...)`；题卡外高 `height` 仅在用户点击切换题目时触发一次，影响可控。

#### 5.2 对照 `docs/engineering/perf-scenarios.md` 的动效性能场景覆盖评估

| 动效交互场景 | 现有登记场景（`tests/perf/scenarios/*.json`） | 默认预算 | 覆盖现状与缺口评估 |
|---|---|---|---|
| 画布多节点拖拽 / 组框拖拽 / 混排媒体平移缩放 | `canvas-drag-20-nodes`、`canvas-drag-group-frame`、`canvas-pan-mixed-media`、`canvas-wheel-zoom-mixed-media`、`canvas-far-dense-pan` | `frameGapP95 ≤ 33ms`，`longTasks = 0` | ✅ **已覆盖**（守住画布手势跟手与远看平移不掉帧） |
| 后台生成中 / Agent 流式输出时平移画布 | `canvas-pan-while-generating`、`canvas-pan-while-agent-streaming` | `frameGapP95 ≤ 33ms` | ✅ **已覆盖**（可直接检验 `MO-A2`/`MO-A5` 将 `V4Shimmer` 迁至合成层后的帧率收益） |
| 窗口缩窄跨过 `1060px` 阈值触发 Agent 自动收展 | `window-narrow-drag` | `frameGapP95 ≤ 33ms` | ✅ **已覆盖**（2026-11-24 基线 `10.4ms`） |
| 切换创作 / 生成 / 预览三阶段，及生成页画布 ⇄ 列表 | `workbench-switch-stages`、`workbench-switch-canvas-list` | `response ≤ 100ms`（`p95 ≤ 150ms`） | ✅ **已覆盖**（印证工作面切换必须维持 `instant: 0ms`） |
| 面板空闲开着不动时的后台动画泄漏监测 | `inline-whiteboard-idle-panel`、`generation-idle-60`、`generation-idle-100` | `idleBusyPct ≤ 1%`，`idleLayoutsPerSec ≈ 0` | ⚠️ **部分覆盖**：已覆盖画布 60/100 节点与内联画板空闲态，但**尚缺「常驻 Agent 面板处于 thinking/process 运行态开着不动时」的 `idleLayoutsPerSec` / Paint 开销探针** |
| **100+ 节点画布下开关常驻 Agent 停靠栏（`Mod+\`）或拖宽分隔线** | **暂无独立场景** | `response ≤ 100ms` / 拖动 `frameGapP95 ≤ 33ms` | ❌ **真实缺口**：`window-narrow-drag` 量的是窗口外框缩放跨阈值，未覆盖 150 节点画布下按 `Mod+\` 或拖 `AssistantPane` 把手时的网格重排卡顿（若 `MO-A1` 直接删除该弹簧改为同步 CSS Grid，则操作直接降为单帧落位，可复用 `canvas-scale-bench.mjs` 的 `workbenchScenarios.mjs` 补 1 个参数化场景验证） |

---

## 三、分流收口清单（A 类立即可做 vs B 类需看改前改后效果或拍板）

> **在途零冲突核验**：以下 **A 类前 5 单（`MO-A1` ~ `MO-A5`）** 所涉全部目标文件已逐一与在途开放 PR `#1702`、`#1703`、`#1665`、`#1692`、`#1715` 的完整文件列表做集合求交，交集文件数严格为 **`0`**，协调裁定后可立即并行或按序派工；`MO-A6` 明确标注等待 `#1665` / `#1703` 合入后收尾。

### 3.1 A 类：立即可机械 / 低风险收口子单（按创作者感知收益 × 性能收益排序）

| 子单编号 | 精确文件与行号 | 现状问题 | 目标改法 | 预估改动量 | 验证方式 |
|---|---|---|---|---|---|
| **`MO-A1`**<br>生成页停靠栏去弹簧重排 + 首屏剥离 `framer-motion` | · `src/workbench/generation/GenerationWorkspace.tsx:8,44-49,69,105,116-126`<br>· `src/workbench/assistantWidthBounds.ts:68-70`<br>· `src/NomiAppProviders.tsx:1,31,53`<br>· `src/ui/browser/BrowserCaptureFlyouts.tsx:19`<br>· `src/ui/browser/popover/BrowserAssetPopoverView.tsx:85-103` | ① 生成页拖 Agent 分隔线无 `dragging` 旁路导致弹簧滞后追手，`Mod+\` 开关逐帧插值 CSS Grid 触发 50–200 节点画布重排，且与创作/分镜/预览三页（`0ms`）手感分裂；② 顶层 `NomiAppProviders` 为全仓仅剩的 3 个组件把整包 `framer-motion` 拉进主窗口首屏（注：`NomiAppProviders.tsx` 若与 `UX-simple` 的 Toast 右移单同批推进可合并或错开）。 | ① `GenerationWorkspace` 改用与其余三页一致的静态 `assistantDockColumns(width)`，删除 `ASSISTANT_LAYOUT_SPRING` 与未再引用的 `assistantDockColumnsAnimated`；② 将 `<MotionConfig reducedMotion="user">` 从 `NomiAppProviders` 下沉至 `ui/browser` 宿主（并将 `BrowserAssetPopoverView.tsx:102` 私有弹簧收归 `NOMI_DURATION_MS.fast` + `NOMI_EASE.out`）。 | 5 文件，约 `-35 / +18` 行 | `vitest` 布局结构单测 + `pnpm run build` 核验主入口 chunk 不再静态打入 `framer-motion` + `window-narrow-drag` 性能场景验证。 |
| **`MO-A2`**<br>根部 `prefers-reduced-motion` 无障碍兜底与忙态对比度修复 | · `tailwind.config.ts:667-674`<br>· `src/workbench/ai/v4/AgentPanelV4Row.tsx:14-31`<br>· `src/ui/onboarding/ModelCapabilityEditor.tsx:92`<br>· `index.html:48-61`<br>· `electron/capabilityCore/mcpAppWidget.ts:287-290` | 开启系统减弱动态后：① `.animate-spin` 被强压 `opacity: 0.65` 导致忙态小图标发虚；② `V4Shimmer` 冻结在 `200%` 渐变左半段造成文字明暗不均；③ `animate-nomi-agent-*`、`index.html` 启动圈、`mcpAppWidget` 与平滑滚动漏根部兜底。 | ① `tailwind.config.ts:669` 将 `.animate-spin, .animate-nomi-agent-scan, .animate-nomi-agent-hop, .animate-nomi-agent-blink, .animate-nomi-agent-spin` 拆出仅设 `animation: none !important`（保留 `1` 不透明度），并加 `html, body, * { scroll-behavior: auto !important }`；② `V4Shimmer` 在 `prefers-reduced-motion` 下直接渲染纯色 `text-nomi-ink-60`；③ `ModelCapabilityEditor.tsx:92` 读 `shouldReduceMotion()`，`index.html` 与 `mcpAppWidget.ts` 补 `@media (prefers-reduced-motion: reduce)`。 | 5 文件，约 `+28 / -10` 行 | `src/design/motion.test.ts` + 浏览器模拟 `prefers-reduced-motion: reduce` 核验加载标 `opacity === '1'` 且 `animationName === 'none'`。 |
| **`MO-A3`**<br>清空 `motion-token-baseline.json` 全部存量债 + 补齐门岗盲区 | · `src/ui/onboarding/{ApimartConnectedHint.tsx:25,FoldableModelCard.tsx:133,ModelPickerScreen.tsx:343,NetworkSection.tsx:163,OnboardingWizardAdvancedFields.tsx:47,117,ApimartConnectPage.tsx:74,ApimartWorksCollage.tsx:9-25}`<br>· `src/workbench/settings/TikhubConnectorCard.tsx:100`<br>· `src/theme/nomiTheme.ts:300`<br>· `scripts/motion-token-baseline.json`<br>· `scripts/lib/motionTokenScan.mjs:6,82`<br>· `scripts/motionTokenScan.test.mjs` | ① `scripts/motion-token-baseline.json` 仍挂着 8 个文件 9 条硬编码 `duration-100/150/200` 与裸 `matchMedia` 债务（绕过 `:root 0ms` 归零）；② Mantine `<Collapse>` 未配主题默认时长；③ `motionTokenScan.mjs` 漏扫 `ease-linear`、`delay-\d+` 与内联 `type: 'spring'`。 | ① 将 6 处数值 `duration-*` 全部迁入 `duration-nomi-*`（`ApimartConnectedHint` 同步对齐定时器）、2 处裸 `matchMedia` 改调 `shouldReduceMotion()` / `reducedMotionQuery()`，将 `scripts/motion-token-baseline.json` 清空为 `{}`；② `nomiTheme.ts` 为 `Collapse` 配 `transitionDuration: NOMI_DURATION_MS.fast`；③ `motionTokenScan.mjs` 补齐 `ease-linear`、`delay-*` 与 `type: 'spring'` 拦截及正反单测。 | 12 文件，约 `+45 / -55` 行 | `node --test scripts/motionTokenScan.test.mjs` + `pnpm run check:tokens` + `pnpm run lint:ci` 全绿且基线归零。 |
| **`MO-A4`**<br>提示词预览弹层去 `1190ms` 卸载锁与退场点穿修复 | · `src/workbench/promptLibrary/PromptPreviewOverlay.tsx:28,36,64-103,114-118` | 点击「放上画布」后 `setTimeout(close, 950)` + `EXIT_MS (240ms)` 锁住 `useModalInputLayer` 达 `1.19s` 阻塞后续操作，退场期遮罩未设 `pointer-events-none` 吞点击，卸载未清定时器，且硬写 `zIndex: 4200`。 | ① 点击「放上画布」后立即触发 `close()`（消除 `950ms` 干等）；② `closing === true` 进入退场瞬间即释放 `useModalInputLayer(!closing)` 并给外层遮罩挂 `pointer-events-none`；③ 用 `ref` 托管并在卸载时清理定时器，`zIndex` 改引 `NOMI_OVERLAY_Z_INDEX.dialog`。 | 1 文件，约 `+16 / -12` 行 | 新增组件交互测试核验：点击「放上画布」后 `<50ms` 内底层可接收点击与键盘事件，组件中途卸载零悬空定时器。 |
| **`MO-A5`**<br>合成层收口：进度条 `scaleX`、流式 `V4Shimmer` 与顶栏形象 `contain` | · `src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx:364`<br>· `src/workbench/preview/TimelinePreview.tsx:587`<br>· `src/workbench/ai/v4/AgentPanelV4Cards.tsx:133`<br>· `src/workbench/ai/v4/AgentPanelV4Row.tsx:14-31`<br>· `src/design/identity.tsx:255` | ① 分镜锚点、预览导出与 Agent 任务卡进度条对 `width` 做过渡/高频改写触发 Layout；② `V4Shimmer` 每帧重绘 `backgroundPosition` 抢占流式期主线程 Paint；③ `NomiAgentFace` 内部 `left/top/width/height` 形变未加 CSS containment（注：`TaskCenterPanel.tsx:409` 因在 `#1702` 施工面内留待其合入后顺手收口）。 | ① 进度条内条统一改为 `w-full origin-left transition-transform duration-nomi-fast ease-nomi-out` + `transform: scaleX(ratio)`；② `V4Shimmer` 改为合成层 `opacity` 柔和呼吸或伪元素 `translateX` 遮罩；③ `NomiAgentFace` 舞台根补 `[contain:layout_paint]` 隔离重排边界。 | 5 文件，约 `+26 / -20` 行 | `pnpm run perf:scenarios -- --id canvas-pan-while-agent-streaming` + Vitest 快照/结构单测核验。 |
| **`MO-A6`**<br>文档死规范清理与 `#1665`/`#1703` 合入后尾项收口 | · `docs/design/nomi-agent-interaction.md:214-246`<br>· `src/ui/onboarding/ModelSettingsHome.tsx:307`（待 `#1665` 合入）<br>· `docs/design/nomi-design-system.md:887`（待 `#1703` 合入）<br>· `src/workbench/taskCenter/TaskCenterPanel.tsx:409`（待 `#1702` 合入） | ① `nomi-agent-interaction.md` 仍保留全仓 `0` 消费的 `--nomi-motion-*` 六变量表；② `nomi-design-system.md:887` 仍指向已删除的 `SplashIntro.tsx`；③ `#1665` / `#1702` 施工面内各有 1 处平滑滚动 / `transition-[width]` 待收尾。 | ① 将 `nomi-agent-interaction.md` §7 改为引用 `src/design/motion.ts` 真源（立即可做）；② 待 `#1665`、`#1703`、`#1702` 合入后分别补齐 `ModelSettingsHome.tsx:307` `shouldReduceMotion()`、清理 `SplashIntro.tsx` 死引用与 `TaskCenterPanel.tsx:409` `scaleX`。 | 4 文件，约 `+15 / -25` 行 | `pnpm run check:docs-index` + `pnpm run check:dangling-tokens` + `pnpm run check:tokens`。 |

---

### 3.2 B 类：需看改前改后效果或用户 / 协调拍板的设计取舍项

| 编号 | 议题与涉及位置（`file:line`） | 为什么需要拍板 / 看效果 | 推荐方案（替创作者做判断） | 正反代价对比 |
|---|---|---|---|---|
| **`MO-B1`** | **下拉菜单 `WorkbenchMenu` 与预览卡 `HoverCard` 是否补齐 `150ms` 轻量进场过渡（对齐同排 `NomiSelect`）**<br>`src/design/menu.tsx:236` · `src/design/hoverCard.tsx:24` | 同排参数栏里 `NomiSelect`（Mantine `Combobox`）有 `150ms` 渐显，而紧邻的 `WorkbenchMenu` 与 `HoverCard` 为 `0ms` 硬切；但若给 Radix 菜单强加**退场**挂留（`forceMount`）可能影响全仓菜单走查点击时序。 | **推荐「只加 CSS 进场、不加退场卸载延迟」**：在 `menu.tsx`（仅按钮下拉 `DropdownMenu`，右键菜单 `ContextMenu` 与 `Tooltip` 保持 `0ms`）和 `HoverCardContent` 挂 `motion-safe:data-[state=open]:animate-nomi-panel-pop`（`150ms` `opacity 0→1 + translateY(-4px) scale(0.985)→none`），关闭时仍 `0ms` 立即卸载不挡下一击。 | **正**：消除同排下拉控件「一个柔和一个硬跳」的割裂感，零退场点击阻塞、零 JS 开销；<br>**反**：需在设计实验室跑一轮菜单走查确认截图时刻落在稳态帧。 |
| **`MO-B2`** | **16 文件 20 处散装 `IconLoader2` / `IconRefresh` `animate-spin` 与「唯一加载标 `NomiLoadingMark`」规范对齐**<br>`src/design/identity.tsx:302` · `src/workbench/ai/v4/AgentPanelV4Icons.tsx:78` · `src/workbench/generationCanvas/nodes/ComposerSendButton.tsx:140,162` 等 | 设计系统 §3.9.1 规定「一切 loading 用 `NomiLoadingMark`，禁 `IconLoader2+animate-spin`」，但业务侧实际长出了 20 处违例——原因是 `NomiLoadingMark` 是实心深色方块（`18px`），塞进 `12px` 状态行或深底主按钮（`bg-nomi-ink`）里视觉过重且反差不足。 | **推荐「实事求是定两档加载原语」**：① 页面/面板/白底按钮覆盖层继续用 `NomiLoadingMark`；② 在 `src/design/status.tsx` 正式收编 1 个 `NomiInlineSpinner`（单色描边圆弧，内置 `animate-spin motion-reduce:animate-none` 与 `aria-hidden`），把散落的 20 处手写 `IconLoader2` / `border-t` 圆环全部收归它（含 `#1702` 合入后的 `ComposerSendButton`），再由门岗锁死业务层裸写 `animate-spin`。 | **正**：承认 `12px` 行内场景的真实视觉约束，消灭 20 处各自不同的转速/线宽/无障碍写法；<br>**反**：需修改设计系统 §3.9.1 条文（从「唯一组件」改为「面板级 Mark + 行内级 Spinner 两件套」）。 |
| **`MO-B3`** | **分段选择器 `NomiSegmented` / 顶栏 `NomiStepper` 是否引入滑动胶囊指示器**<br>`src/design/NomiSegmented.tsx:55-90` · `src/design/identity.tsx:340-383` | 反问卡 `AskGlideMenu`（`AgentPanelV4AskCard.tsx:104`）有 `220ms` 滑动底块，而 `NomiSegmented` 与 `NomiStepper` 仅做 `110ms–150ms` 颜色/阴影原位切换。 | **推荐「维持原位颜色切换，不加滑动胶囊」**：`NomiSegmented` 支持多行 `auto-fit` 折行与 `column` 模式，加跨行滑动指示器必须引入 `ResizeObserver` + DOM 矩形测量，既违背小应用极简原则又易在窄窗折行时闪跳；顶栏 `NomiStepper` 切工作面本身就是 `0ms` 瞬切，按钮原位变亮最跟手。 | **正**：零 DOM 测量、零布局抖动、100% 跟手；<br>**反**：少一点消费级 App 式的滑块装饰感。 |
| **`MO-B4`** | **画布节点「生成中 → 出片落版」瞬间的视觉衔接（待 `#1702` 与 `#1703` 合入后评估）**<br>`src/workbench/generationCanvas/nodes/NodeGeneratingOverlay.tsx:21-38` · `GenerationWaitingSurface.tsx:22-25` | 当前 `completed` 变真瞬间等待层 `0ms` 直接卸载，若底层 `DeferredNodeImage` 缩略图尚在解码帧会有极短瞬切感；但多节点并发落版时若加复杂揭幕动画极易拖累帧率。 | **推荐（待 `#1702`/`#1703` 合入后出小样验证）**：仅在 `DeferredNodeImage` `onLoad` 解码就绪后，对上层 `GenerationWaitingSurface` 做一次纯合成层 `opacity 1→0`（`duration-nomi-fast-exit: 100ms`，`pointer-events-none`，`prefers-reduced-motion` 下 `0ms`），绝不加模糊缩放或 Canvas 粒子特效。 | **正**：遮住图片解码首帧白闪，出片落版像冲洗显影一样自然稳重，且纯 `opacity` 零重排；<br>**反**：触碰核心画布节点渲染链，必须等 `#1702`/`#1703` 落定并跑过 `gen-landing-8-concurrent` 性能场景后才能动。 |
