# UX-simple 第一段只读普查报告 · 「复杂留给系统」8 条原则全项目走查

> 状态：📋 方案待拍板
> 对应协作看板：`#1586` · `UX-simple`（`#1586#issuecomment-7125128356`、`#1586#issuecomment-7222597464`）
> 审计基线：`origin/main` @ `c173a0e82`（含起始 `8ac788921` 及刚合入的 `#1712`/`#1716`，2026-11-28） · 纯只读普查（不改动生产代码与测试）
> 分寸护栏：守 `#1709` 小桌面应用极简定位——只围绕创作者高频主干链路（**建项目 → 写创作/拆镜 → 接入/选模型 → 画布出图/出视频/音频 → 时间轴预览 → 导出 MP4** 及右侧常驻 Agent 协作）削减认知负担，不为低频边角造重型机制。

---

## ★0 先查别人

- https://developer.apple.com/design/human-interface-guidelines/modality 与 https://developer.apple.com/design/human-interface-guidelines/designing-for-macos · Apple HIG（macOS Modality & Controls）：临时浮层与状态反馈不得遮挡相邻工作区顶栏，所有临时展开面板须响应 `Escape` 收回，破坏性操作须与高频打开/创建热区拉开物理距离 · **改了/确认了**：将「右上 Toast 直接盖住常驻 Agent 坞顶栏（`U-16`）」「画布节点高级参数展开后按 `Esc` 不收回且底边被工具栏截断（`U-10`）」「项目卡缩略图右上角悬停红垃圾桶易误触（`U-02`）」全部排入 A 类高优修复。
- https://linear.app/method/introduction · Linear Method（Opinionated Software & Defaults）：主干工作流由系统给出有主见的默认值，不把系统自己能算出的配置项摆成必选下拉，当前状态无意义的筛选器不提前占位 · **改了/确认了**：确认 APIMart 已就绪时 Agent 底栏不应显示 `选择模型 ▾` 制造「未配模型」错觉（`U-17`），未挂载外部目录（`文件夹 0`）时隐藏库页三段来源胶囊（`U-01`），新建空白节点不悬停单按钮「复制为变体」浮条（`U-11`）。
- https://www.nngroup.com/articles/recognition-and-recall-in-ux/ 与 https://www.nngroup.com/articles/ten-usability-heuristics/ · Nielsen Norman Group（Recognition Rather Than Recall & User Control/Freedom）：相邻高频入口禁止用语义重叠的抽象图标让用户靠悬停猜谜，长耗时或误触跳页必须可预知、可立即撤回或取消 · **改了/确认了**：将「Agent 输入栏在非画布面常驻 `↖` 图标、与相邻 `+` 同名『加参考』且误点即强制切走当前页面（`U-15` + `U-09`）」定为全项目 Top 1 卡点，并将「导出 MP4 进行中缺取消出口（`U-21`）」纳入 B 类拍板清单。
- https://screen.studio/ 与 https://www.descript.com/ · Screen Studio / Descript 轻量桌面视频创作实践：把多轨专业剪辑复杂度留在后台，主界面只突出镜头顺序、画幅与一键导出规格，侧边检查器收起轨保持统一方向与直白母语术语 · **改了/确认了**：确认预览页不加复杂多轨剪辑器，只修右侧 `Inspector` 英文竖排轨头、`画面分段` 误译与裸 `<input>`（`U-20`），并在导出主钮旁轻量外显当前分辨率规格（`U-21`）。
- `docs/design/nomi-design-system.md:27` 与 `docs/design/nomi-design-system.md:260` · Nomi 设计系统 §1.0「一个东西一个家、Agent 只指路」、§1.5.3「动作不许压在内容上」、§1.9.1「取消只叫『取消』」 · **改了/确认了**：据此核出项目卡封面右上删除钮（`U-02`）与 Agent 花钱弹窗取消钮叫 `忽略`（`U-19`）两处既有规范偏离，分别归入 A 类与 B 类。
- 出口：不涉及：本文件为 UX-simple 第一段只读普查报告，不改动任何生产代码、花钱确认管线或长跑任务实现。

---

## 一、已解决与在途排除基线（防重复报旧账）

### 1.1 2026-11-24 以来已合入 `origin/main` 的交互精简（核验已生效，本报告严禁重报）

| 合入 PR | 对应领域 | 已解决的交互问题（`8ac788921` 核验落点） |
|---|---|---|
| `#1668`（PR-UX1） | 画布与选区入画布 | 创作划词入画布限制 `maxZoom: 1` 不再 `188%` 放大截断底栏；上游图片已有结果时下游视频不再假锁 `等上游首帧`（`src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:173`）；右 `+` 派生视频自动平移进视口；图片悬浮条直出 `生成视频` 文字按钮（`src/workbench/generationCanvas/nodes/quickActions/ImageQuickActionsToolbar.tsx:169`）；首帧派生视频自动对齐图片比例。 |
| `#1670`（PR-UX3） | 时间轴预览与导出 | 首段入轨自动对齐预览画幅；空时间轴禁用 `导出 MP4` 并收口为单层 `BarTooltip`（`src/ui/app-shell/shell/ShellTopBar.tsx:311`）；导出完成弹带 `打开文件夹` 的成功 Toast（`src/workbench/preview/TimelinePreview.tsx:268`）；空轨引导改为「点左侧镜头加入时间轴，或直接拖入轨道」（`src/i18n/locales/timelinePreview.ts:4`）；片库收起轨横排 `片库 / Clips`（`src/workbench/preview/PreviewSourcePanel.tsx:158`）。 |
| `#1667`（PR-UX4） | 分镜表编辑 | `0` 参考锚点时隐藏无效 `全部展开` 并给行内 `+ 添加参考`；`+ 添加镜头` 钉在表底常驻（`src/workbench/creation/storyboard/StoryboardPlanEditor.tsx:108`）；增删镜头稳定保留 `shot-N` 身份。 |
| `#1672`（PR-UX6） | 创作、项目库、Agent 环 | 创作空态占位符去双句号（`src/i18n/locales/creationAi.ts:30`）；划词浮条砍重复 `B/I/H1/H2` 并补齐 `拆成镜头 / 生成图片 / 生成视频` 文字标签（`src/workbench/creation/SelectionGeneratePopover.tsx:128`）；编辑栏 `代码/分割线/表格` 收进 `⋯`（`src/workbench/creation/WorkbenchEditor.tsx:47`）并补 `拆成镜头` 按钮（`WorkbenchEditor.tsx:98`）；Context 环 `0` 用量隐藏（`src/workbench/ai/v4/AgentPanelV4Context.tsx:53`）；项目卡单击标题直接打开项目、改名拆成独立悬停铅笔钮（`src/workbench/library/ProjectLibraryPage.tsx:643`）。 |
| `#1548` · `#1697` | Agent 介入槽与花钱卡 | 问答与花钱确认拆成独立卡；空输入框按 `Enter` 直接确认花钱、有草稿字时 `Enter` 发补充消息；生成前状态静默标 `待确认`（去假加载旋转）；裸 `/` 输入守卫。 |
| `#1624` · `#1687` | 发送钮计价与余额 | 画布/分镜发送钮支持积分 / `¥` / `$` 单位菜单切换、余额不足显示 `去充值`、Seedance 2.5 计价补齐。 |
| `#1650` · `#1653` · `#1660` · `#1700` | APIMart 接入引导 | 项目库未接模型展示 APIMart 英雄引导卡、全窗四步连接页、粘贴即验活与有限额度 `0` 余额拦截。 |
| `#1628` · `#1651` · `#1654` · `#1685` · `#1694` · `#1696` · `#1712` · `#1713` | 全局菜单、撤销、弹窗、错误、花钱恢复 | 3 处手写右键菜单统一迁 `WorkbenchMenu`；时间轴与画布统一 `⌘Z` 撤销栈；画布底栏 `+` 迁 `AnchoredPopover`；供应商异常剥除 HTML/堆栈；窄弹窗标题防竖折；花钱结果落盘恢复与派生单复用（`PR0-recovery`）；只读打开项目零写盘。 |

### 1.2 当前在途开放 PR 与任务池已单列项（严格避让，不重复建卡）

| 在途载体 | 认领范围与改动文件 | 本报告处理口径 |
|---|---|---|
| Open PR `#1665`（`T-6a`） | `SettingsDialog.tsx`、`ModelSettingsHome.tsx`、`AiAssistedOnboardingCard.tsx`、`AiModelsSection.tsx`、`DefaultGenerationModelsSection.tsx` 等（折叠「用 AI 帮我接入」为单行、补 APIMart 余额/用量/价格子页、收起旧连接、弹窗高自适应 `360–560px`） | 模型设置页上述结构问题**全部排除不报**；涉及 `SettingsDialog.tsx` 通用页排序的 `U-07` 明确标注「等 `#1665` 合入后再开」。 |
| Open PR `#1692`（`C-0`） | `docs/design/boards/**/*.board.json` 与拍板锚点对账量具 | 所有涉及拍板清单锚点增删的建议一律归入 **B 类**，绝不在 A 类暗改拍板元素。 |
| Open PR `#1702`（`S-D`）· `#1703`（`S-E`） | Seedance 2.5 样片档（`480p`→`1080p`）、Seedream 5.5/5.0 Pro 拆层进画板 | 模型参数档与拆层交互不重复列入；画板工具条双行折叠（`U-14`）避开 `#1703` 改动文件。 |
| Open PR `#1715`（`Q-pr-weight`） | `scripts/check-pr-judgement.mjs` PR 行数门岗（注：`#1712` `PR0-recovery` 与 `#1716` `Q-smell` 已刚合入 `origin/main`） | 工程门岗无界面冲突；后续 UX 小 PR 严格控体量（单 PR 远低于门岗红线）。 |
| 任务池已立项单（`#1586#issuecomment-7222597464` / `0.25-cut-checklist.md`） | `S-G`（节点参数栏「自动」露出具体模型名）、`T-6`（Agent 思考档位 `NomiSegmented`）、`F-C`（Agent 流式中断提示）、`F-E-2/3`（报错技术详情折叠）、`Q-provenance-portal`（溯源浮层被节点 `transform` 裁切）、`Q-canvas-fit-label` / `Q-status-pill-en` / `Q-canvas-2` / `Q-canvas-3` / `Q-whiteboard-i18n` | 已在池中单列的缺陷**不重占 Top 15 名额**，仅在同域协同处（如 Agent 模型回显 `U-17` 与 `S-G`）注明对齐口径。 |

---

## 二、主干链路基线打分卡（数字判据可证伪）

沿创作者最常走的完整主干任务（**已接通 APIMart 日常态：建项目 → 写一段脚本拆成镜头 → 确认/理解模型 → 单镜出图并派生视频 → 送进时间轴预览 → 导出 MP4**，附首次接模型支线），在 `origin/main`（`8ac788921`）实测代码路径中的**最少点击数**与**需要创作者做的决定 / 理解的概念数**：

| 主干阶段 | 当前代码落点（`file:line`） | 最少点击数 | 键入/粘贴 | 需创作者做的决定 / 理解概念数 | 当前残留的核心摩擦点 |
|---|---|---:|---:|---:|---|
| **① 新建项目** | `src/workbench/library/ProjectLibraryPage.tsx:396` → `src/workbench/NomiStudioApp.tsx:447` | **1 击**（点 `+ 新建项目` 直落创作页） | 0 | **0 个阻断决定**（界面背景含 **1 个冗余概念**：`文件夹 0` 来源筛选 `ProjectLibraryPage.tsx:346`） | 建项目本身已 1 击直达；但回库页管项目时，封面右上悬停红垃圾桶（`ProjectLibraryPage.tsx:569`）易误碰。 |
| **② 写脚本 → 拆成镜头** | `src/workbench/creation/WorkbenchEditor.tsx:98,136` → `src/workbench/ai/ProjectAgentResidentShell.tsx:341` → `src/workbench/creation/CreationDocumentSwitcher.tsx:126` | **2 击**（点 `拆成镜头` + 点确认/切分镜表） | 1 次写想法 | **2 个概念/决定**（① 区分 `文稿` 与 `原稿` 混名；② 首次打开空面板先撞上 `帮 Nomi 变好` 遥测询问卡 `AgentPanelV4Empty.tsx:54`） | 首次进创作页还没写字就被遥测同意卡占去面板中区；若误点 Agent 底栏 `↖` 还会被直接踢去画布页（`ProjectAgentResidentShell.tsx:307`）。 |
| **③ 首次接入 / 日常选模型** | 首次：`src/workbench/library/LibraryOnboardingHeroCard.tsx:47` → `src/ui/onboarding/ApimartConnectPage.tsx:249,276`<br>日常：`src/workbench/ai/v4/useAgentPanelV4Data.ts:218` · `src/workbench/creation/storyboard/StoryboardFilmAspect.tsx:32` | 首次 **3 击**<br>日常 **0 击（物理）/ 1 击（心理核对）** | 首次 1 次粘贴<br>日常 0 | **2 个假决定**（① Agent 已就绪却显示 `选择模型 ▾` `AgentPanelV4Composer.tsx:313`；② 分镜全片画幅显示 `全片 模型默认` 不知横竖 `StoryboardFilmAspect.tsx:28`） | 系统明明已能自动选好助手模型和默认 `16:9` 画幅，界面文案却让创作者以为「我还没选模型 / 不知道会出横屏还是竖屏」。 |
| **④ 画布单卡出图 → 派生视频** | `src/ui/app-shell/shell/ShellTopBar.tsx:222` → `src/workbench/generationCanvas/components/CanvasEmptyState.tsx:52` / `CanvasToolbar.tsx:258` → `ComposerSendButton.tsx:297` → `ImageQuickActionsToolbar.tsx:169` → `deriveFromNode.ts:94` | **5 击**（切生成 → 建图卡 → 点发送 → 点悬浮 `生成视频` → 点视频卡发送） | 1~2 次提示词 | **3 个概念/决定**（① 第 2 张卡起底栏 7 枚纯图标盲认 `CanvasToolbar.tsx:258`；② 输入栏相邻 `+` 与 `↖` 同叫「加参考」`AssetReferenceButton.tsx:17`；③ 首帧派生视频卡全空不知是否要重抄画面词 `deriveFromNode.ts:94`） | 新建空卡头顶白飘单图标「复制为变体」（`NodeFloatingToolbar.tsx:319`）；点开高级设置按 `Esc` 关不掉且底边被遮（`InlineParameterBar.tsx:433`）。 |
| **⑤ 送进时间轴预览** | `src/workbench/generationCanvas/nodes/NodeFloatingToolbar.tsx:136` → `src/ui/app-shell/shell/ShellTopBar.tsx:222` → `src/workbench/preview/inspector/PreviewInspector.tsx:83,107` | **2 击**（节点悬浮条 `加到时间轴` → 顶栏切 `预览`） | 0 | **0 个必选决定**（若打开右侧属性栏调画面，多 **1 个误译理解成本**：`画面分段` `timelinePreview.ts:52`） | 入轨弹出的右上 Toast 在常驻 Agent 打开时直接盖住 Agent 顶栏（`NomiAppProviders.tsx:36`）；右侧 `Inspector` 英文竖排 90° 难认。 |
| **⑥ 导出 MP4** | `src/ui/app-shell/shell/ShellTopBar.tsx:311-326` → `src/workbench/preview/TimelinePreview.tsx:248-280` | **2 击**（点 `导出 MP4` → 系统保存框回车） | 0 | **1 个隐式盲猜**（不悬停或不展开右侧属性栏，点击前看不见正要导出 `1080p` 还是 `720p`） | 一旦点下长视频导出，按钮锁死、全界面无「取消导出」入口，误操作只能干等或强关应用。 |
| **日常主干合计（不含首次接 Key）** | 六段串行闭环（`8ac788921` 实测） | **14 击**（较 11-24 基线 `16 击` 已减 2 击） | **2~3 次输入** | **8 个感知决定/概念负担**（较 11-24 基线 `11 个` 已减 3 个） | 物理点击已接近极简下限，**剩余卡点集中在「假未配提示、双图标同名、误点跳页、浮层互遮、缺取消出口」**。 |

### 第二段执行后的可证伪数字判据（任何「什么都不改」都在此表判红）

1. **主干感知决定 / 概念负担数**：日常主干从 **8 个降至 ≤ 4 个**（消除 Agent `选择模型` 假未配态、消除 `+` 与 `↖` 同名「加参考」猜谜、消除首次空态遥测卡前置打断、消除导出前分辨率盲猜）。
2. **非画布面误触发跳页次数**：在 `creation` / `storyboard` / `preview` 任一页面点击 Agent 输入栏任意可见按钮，意外强制切走 `workspaceMode` 的次数从 **1 次降至 `0` 次**。
3. **全局浮层与键盘可撤回率**：右侧常驻 Agent 坞展开时右上 Toast 与 `[data-shell-agent-layer][data-agent-form="dock"]` 顶栏像素重叠面积 **`= 0 px²`**；画布节点展开 `AdvancedSettings` 后按 `Escape` 收起成功率从 **`0%` 升至 `100%`**。

---

## 三、逐屏对照 8 条原则的问题总表（六大界面域）

> **8 条原则速查**：`#1` 系统能判断的不留给用户 · `#2` 此刻没用的就不出现 · `#3` 能替人做的就直接做 · `#4` 同一件事处处一样 · `#5` 按下去有回应，再按能收回 · `#6` 不打断人手上的事 · `#7` 常用的好做，会丢东西的难误碰 · `#8` 界面自己说明自己。

### 3.1 项目库（Library）

| 编号 | 精确位置（`file:line`） | 违反原则 | 创作者那一刻具体卡在哪 | 建议改法（一句话写清改完少哪一步/哪个判断） | 红线与在途冲突判定 |
|---|---|---|---|---|---|
| **U-01** | `src/workbench/library/ProjectLibraryPage.tsx:346-366` | `#2` | 只要有 1 个本地项目，哪怕从未挂载外部目录（`sourceCounts.folder === 0`），工具栏也常驻 `全部 N \| 本地 N \| 文件夹 0` 三段胶囊，前两项结果一模一样、第三项恒为 `0`。 | 当 `sourceCounts.folder === 0` 且当前未筛 `folder` 时不渲染来源三段胶囊（挂载过外部文件夹后再自动现身），进库页少扫视 3 枚无用筛选器。 | **A 类免拍板**（不删「打开文件夹」入口，不撞 `Library.board.json` 卡片与新建主钮锚点，0 在途冲突）。 |
| **U-02** | `src/workbench/library/ProjectLibraryPage.tsx:569-585` | `#7` · `#4` | 悬停项目卡时，高危红色垃圾桶按钮直接压在封面缩略图右上角（`top-[9px] right-[9px]`），既违背设计系统 §1.5.3「动作不许压在内容上」，又紧邻右上角 `+ 新建项目` 鼠标动线易误触；而安全的「改名 / 打开文件夹」却在封面下方标题行（`675-705`）。 | 移除封面右上角悬停红垃圾桶浮钮，把「移到废纸篓」统一收进卡片右键菜单与标题行尾 `⋯` 更多菜单（保留现有二次确认框 `NomiStudioApp.tsx:488`），彻底移出点封面进项目的误触热区。 | **A 类免拍板**（保留删除功能与确认框，`Library.board.json` 无封面删除钮锚点，0 在途冲突）。 |
| **U-03** | `src/workbench/library/ProjectLibraryPage.tsx:286,390` · `src/i18n/locales/appShell.ts:12,48` · `src/i18n/locales/settings.ts:96,177` | `#4` | 同一套交互导览在库空态叫「1 分钟看懂怎么用 / 再看一遍引导」、库顶栏叫「新手引导 / Tour」、设置通用页叫「上手清单」、关于页叫「上手手册」，4 个名字像 4 个不同功能。 | 全应用统一命名为「上手引导 / Quick tour」（已读态叫「重看引导」），少记 3 套同义词。 | **A 类（已获批）**：用户在 `#1586#issuecomment-7126560423` 已拍板「都按推荐」；若碰 `SettingsDialog.tsx` 排在 `#1665` 合入后。 |

### 3.2 创作文本与分镜表（Creation & Storyboard）

| 编号 | 精确位置（`file:line`） | 违反原则 | 创作者那一刻具体卡在哪 | 建议改法（一句话写清改完少哪一步/哪个判断） | 红线与在途冲突判定 |
|---|---|---|---|---|---|
| **U-04** | `src/i18n/locales/appShell.ts:24,63` · `src/i18n/locales/creationAi.ts:12-27` · `src/i18n/locales/storyboardEditor.ts:204` | `#4` | 同一份创作脚本文档，在顶栏文档切换器与侧栏叫「文稿 / Docs」，在创作列表弹窗叫「原稿 / Drafts」，在分镜空态按钮叫「返回原稿」，创作者切换时以为「原稿」和「文稿」是两份不同资产。 | 全链路统一中文为「文稿」（「新建文稿 / 返回文稿」）、英文统一为 `Docs`，少 1 个「原稿 vs 文稿」概念辨析。 | **A 类免拍板**（纯词典对齐，核对 `Creation.board.json` / `CreationDoc.board.json` 均锚定选择器属性而非「原稿」字面）。 |
| **U-05** | `src/workbench/creation/storyboard/StoryboardFilmAspect.tsx:28-33` · `electron/shared/storyboard/storyboardShotScope.ts` | `#1` · `#8` | 分镜表顶栏全片画幅在未手改时显示 `全片 模型默认`（`storyboardEditor.ts:199`），创作者点「整组生成」前根本看不出这批镜头会出 `16:9` 横屏还是 `9:16` 竖屏，直到出完图进预览才发现比例反了。 | 新建分镜方案时默认写入当前项目预览画幅（默认 `16:9`），顶栏直接显示 `全片 16:9 ▾`（存量空值方案读取兼容不变），整组出片前少 1 次比例盲猜与返工。 | **B 类需拍板**（改变新建分镜方案的默认画幅落值语义，需确认默认跟项目 `16:9` 还是保留各模型各自默认）。 |
| **U-06** | `src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx:86-119` · `src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx:120-195` | `#8` · `#7` | 分镜表收起态单镜行右侧只显示模型短名，看不出该镜当前设的是「出图片」还是「出视频（几秒）」，检查 10 镜片单时得逐行点开底栏核对。 | 在收起行右侧模型短名前加一枚只读微标（`图` 或 `视频 · 5s`），不展开单行即可一眼扫清全表出片类型，每镜少 1 次点开核对。 | **A 类免拍板**（行内只读微标，不改 `StoryboardOnlyWhatWorks.board.json` 既有控件锚点，0 在途冲突）。 |

### 3.3 模型接入与设置（Onboarding & Settings）

| 编号 | 精确位置（`file:line`） | 违反原则 | 创作者那一刻具体卡在哪 | 建议改法（一句话写清改完少哪一步/哪个判断） | 红线与在途冲突判定 |
|---|---|---|---|---|---|
| **U-07** | `src/workbench/settings/SettingsDialog.tsx:344-388` | `#2` · `#7` · `#4` | 打开「设置 → 通用」，首屏前四块全是低频/排障项（上手清单、Agent 日志目录、全局截图热键、画布滚轮），最常用的「语言」与「外观」被挤到 `358` 行折叠线下方；且「语言」用分段胶囊，紧邻的「外观」却是文字加单颗月亮图标（`ThemeToggleButton`，`386` 行）。 | 把「外观（浅色 / 深色分段胶囊）」与「语言」置顶到通用页第 1、2 行，将「诊断日志」下沉到底部，打开设置 0 滚动即切换主题与语言。 | **A 类免拍板（等 `#1665`）**：不撞 `ModelSurfaces.board.json`，但因 `#1665` 正在改 `SettingsDialog.tsx`，须排在 `#1665` 合入后执行。 |
| **U-08** | `src/ui/onboarding/ApimartConnectPage.tsx:249-279` | `#3` · `#5` | 全窗 APIMart 连接页粘入 API Key 时，用户从网页或聊天记录复制常连带首尾换行、空格或 `Bearer ` 前缀导致验活失败；且粘完合法 Key 后仍习惯去点下方按钮，缺少清晰的回车即连提示。 | 输入框变更与提交前自动剥除首尾空白及误带的 `Bearer ` 前缀（不后台偷读剪贴板，守桌面隐私），粘贴后可直接按 `Enter` 触发 `保存并开始`，少 1 次格式报错重粘。 | **A 类免拍板**（纯输入容错，不改鉴权与 `Onboarding.board.json` 结构，0 在途冲突）。 |

### 3.4 生成画布与节点参数栏（Canvas & Node Composer）

| 编号 | 精确位置（`file:line`） | 违反原则 | 创作者那一刻具体卡在哪 | 建议改法（一句话写清改完少哪一步/哪个判断） | 红线与在途冲突判定 |
|---|---|---|---|---|---|
| **U-09** | `src/workbench/assets/AssetReferenceButton.tsx:17-27` · `src/workbench/assets/AssetReference.tsx:170-182` · `src/i18n/locales/assetLibrary.ts:17,231` | `#4` · `#8` · `#2` | 节点输入栏与 Agent 输入栏左下角紧挨着 `[+]`（「添加参考：上传或从素材库选」）和 `[↖]`（「加参考」）：两颗相邻按钮中文同叫「加参考」，`↖` 指针图标看不出是「去画布点选已有节点当参考」；甚至画布上只有当前 1 张空卡、根本无其他媒体节点可引时 `↖` 也照常摆着。 | 将 `↖` 悬停与无障碍文案明确改为「从画布点选参考 / Pick from canvas」，且当画布无可引用媒体结果节点时自动隐藏 `↖`，少 1 次双按钮猜谜与空点。 | 文案澄清 + 无可引节点时隐藏归 **A 类免拍板**；若想把 `↖` 彻底并进 `+` 下拉菜单，因碰 `NodePointer.board.json` / `ReferenceEntry.board.json` 归 **B 类**。 |
| **U-10** | `src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:239,433-447` · `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx:321,396,405` | `#5` · `#6` | 节点参数栏的模型面板绑了全局 `Esc` 关闭，但同排的「高级设置」（随机种子/负向词等）漏绑 `Esc` 监听；且展开后卡片向下硬撑高并带 `overflow-hidden`，节点位于画布下半屏时展开的输入框直接藏到底部工具栏/时间轴条后面够不着。 | 为 `advancedOpen` 补齐 `Escape` 关闭监听，并在展开高级设置越过画布底部安全区时自动轻推画布视口（复用现有视口避让工具），按 `Esc` 即收、展开必可见。 | **A 类免拍板**（补齐键盘对称性与视口避让，不撞 `ComposerParams.board.json`，0 在途冲突）。 |
| **U-11** | `src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:221` · `src/workbench/generationCanvas/nodes/NodeFloatingToolbar.tsx:319-327` | `#2` | 刚建出一张完全空白的生成节点（无提示词、无参考图、无生成结果）时，卡顶就悬停一条只有单颗图标的 `EmptyNodeVariantToolbar`（「复制为变体」），复制空壳毫无创作者价值（真要复制已有 `⌘D`），白白遮挡上方连线。 | 当节点无结果、无提示词且无参考输入时不渲染顶部单按钮 `EmptyNodeVariantToolbar`（填入内容或产出结果后再出浮动条），清空新建空卡头顶 `40px` 噪音。 | **A 类免拍板**（`ContextualEmptyNodes.board.json` 未锁死空卡顶部变体条，不删 `⌘D`/右键复制能力）。 |
| **U-12** | `src/workbench/generationCanvas/nodes/ConvertShotToVideoButton.tsx:12` · `src/workbench/generationCanvas/nodes/NodeLabelRow.tsx:55` · `src/workbench/generationCanvas/nodes/deriveFromNode.ts:94` | `#4` · `#3` · `#8` | ① 图片节点作为下游视频首帧后，左上角已挂 `[首帧图]` 徽章，右侧可编辑标题仍显示默认类名 `图片`，拼成拗口的「`[首帧图] 图片`」；② 点「生成视频」派生出的视频卡提示词为空且占位符仍是泛泛的「描述你想生成的视频…」，创作者常犹豫要不要把上游图片的画面外观词再复制粘贴一遍。 | ① 节点标题未手改（仍为默认类名）且已有角色徽章时隐去重复默认名；② 首帧派生视频卡将空占位符改为「首帧已锁定画面，直接点生成或补充动作/运镜…」，少 1 次重抄提示词的犹豫。 | **A 类免拍板**（不改节点数据结构与模型调用，仅精简默认重名与优化首帧派生占位提示）。 |
| **U-13** | `src/workbench/generationCanvas/components/CanvasToolbar.tsx:258-265` | `#8` · `#4` | 空画布中央磁贴带文字标签（`图片 / 视频 / 声音 / 文字 / 剪辑`），但建出第 1 张卡后空态消失，底栏 `CanvasToolbar` 把 7 个入口全缩成纯图标（`<span className="hidden">`），其中「视频」与「剪辑（场记板图标）」及 `+`（「更多空间节点」）极易混淆。 | 在常规桌面宽度（`≥1100px`）下为底栏高频创建项露出 2 字短标，或将低频「剪辑 / 文字」收进 `+` 菜单、保留 `图片 / 视频 / 声音 / 导入 / +` 图文胶囊，建第 2 张卡起免悬停猜图标。 | **B 类需拍板**（改动画布常驻底栏胶囊外观与按钮编组，触碰 `Chrome.board.json` / `Main.board.json`）。 |
| **U-14** | `src/workbench/generationCanvas/nodes/ComposerSendButton.tsx:321` · `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardEditingToolbar.tsx:91-121` | `#4` · `#2` | ① 画布节点圆形发送钮在生成中仅显示静态文本 `'···'`，与分镜行和 Agent 花钱栏的旋转 `Spinner` 不一致，看起来像卡住；② 内联画板顶部工具条一次平铺 15+ 控件，`1280px` 窗口下 `[📷] 完成` 被挤折到第二行压住画布。 | ① 节点发送钮 `busy` 态统一换用旋转 `IconLoader2`；② 画板工具条收紧滑杆宽度并将低频对齐/图层操作收进次级入口，确保 `完成` 永远单行居右（避开 `#1703` 改动文件）。 | ① 发送钮动效属 **A 类免拍板**；② 画板工具条若只收间距保单行属 **A 类**，若折叠按钮进子菜单因碰 `InlineWhiteboard.board.json` 归 **B 类**。 |

### 3.5 Agent 聊天与花钱确认卡（Agent & Spend）

| 编号 | 精确位置（`file:line`） | 违反原则 | 创作者那一刻具体卡在哪 | 建议改法（一句话写清改完少哪一步/哪个判断） | 红线与在途冲突判定 |
|---|---|---|---|---|---|
| **U-15** | `src/workbench/ai/ProjectAgentResidentShell.tsx:302-308,607` · `src/workbench/ai/v4/AgentPanelV4Composer.tsx:295` | `#6` · `#2` · `#8` | Agent 输入栏在 `创作`、`分镜`、`预览` 三个非画布页面也常驻渲染 `[↖]`；创作者写文稿或看预览时点一下 `↖` 想加参考，`pickReferenceOnCanvas` 第 `307` 行**不经确认直接强制把工作区切去 `生成` 画布**（哪怕画布上 0 张图可挑！），瞬间打断手头写作/审片，还在窄栏里挤截右侧模型名。 | 仅当 `surface === 'generation'` 且画布存在至少 1 个可引用媒体结果节点时才在 Agent 输入栏显示 `↖`（非画布面引素材统一用旁边的 `+` 选素材库/上传），把误点跳页降为 `0` 并释放底栏 `32px` 宽度。 | **A 类免拍板**（不改 Agent 工具协议；`CanvasAgent.board.json` 仅锁有节点画布态，非画布面与空画布隐藏完全兼容）。 |
| **U-16** | `src/NomiAppProviders.tsx:36` | `#6` | 全局右上 Toast 仅对旧版右抽屉 `[data-nomi-right-panel=model\|tasks\|director]` 写了左移避让，漏了现役常驻 Agent 坞 `[data-shell-agent-layer][data-agent-form="dock"]`；只要右侧开着 Nomi，任何右上 Toast（如入轨撤销提示）都直接盖在 Agent 顶栏（`历史 / 收起`）正上方 3 秒点不到。 | 在 `NomiAppProviders.tsx:36` 补齐常驻 Agent 展开坞的选择器偏移，使右上 Toast 始终停在主工作区右上角、绝不遮挡 Agent 顶栏。 | **A 类免拍板**（纯全局叠层坐标修正，0 拍板冲突，0 在途冲突）。 |
| **U-17** | `src/workbench/ai/v4/useAgentPanelV4Data.ts:218-225` · `src/workbench/ai/v4/AgentPanelV4Composer.tsx:308-319` | `#1` · `#8` | 已接好 APIMart、文本模型随时可用时，只要用户未手动点过模型菜单，新对话底栏仍显示 `选择模型 ▾`（英文窄栏截断成 `Choose a mo...`），让创作者误以为「还没选模型发不了消息」，凭空多做 1 次点开菜单确认的判断。 | 当助手处于自动选模且已有可用文本模型时，底栏直接回显将自动使用的模型短名（与任务池 `S-G` 口径一致），仅在真无可用文本模型时显示 `未接模型`。 | **A 类免拍板**（只改未手选态展示文案，不改底层选模逻辑与 Agent 行为，0 在途冲突）。 |
| **U-18** | `src/workbench/ai/v4/AgentPanelV4Empty.tsx:54` · `src/workbench/ai/v4/AgentPanelV4Consent.tsx:38` · `src/i18n/locales/appShell.ts:32,54` · `src/i18n/locales/agentPanelV4.ts:65` | `#2` · `#6` · `#4` | ① 首次打开空白项目还没写一个字，Agent 空态正中就弹出大块「帮 Nomi 变好（✓ 匿名分享… [愿意] [不分享]）」遥测卡片，抢夺首屏注意力；② 中文界面里侧栏与菜单写英文 `Skill` / `去 Skill 库`，面板内分组标题又写中文 `技能`（`agentPanelV4.ts:168`），同概念中英分裂。 | ① 遥测同意卡延后至用户完成首次生成或首轮 Agent 对话后再出现；② 中文全量统一为「技能 / 技能库」（英文 `Skills`）。 | **A/B 交界（用户已预批）**：两项均已在 `#1586#issuecomment-7126560423`（`#18` 与 `#16`）获用户拍板「都按推荐」；改 `Skill` 文案时若命中 `Chrome.board.json` / `SkillLibrary.board.json` 字面需协调同提交确认拍板哈希。 |
| **U-19** | `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:263,348-384` · `src/i18n/locales/generationCommon.ts:754,2555` | `#4` · `#8` | Agent 发起的花钱确认弹窗取消钮叫 `忽略 / Ignore`（手动发起叫 `取消 / Cancel`），偏离设计系统 §1.9.1「取消只叫『取消』」且让人疑惑「忽略确认是不是直接开跑」；多镜确认卡底栏手写 4 钮横排（`返回修改 / 先试拍第 1 镜 / 忽略 / 确认生成 N 镜`），「返回修改」与「取消」语义重复。 | 将 `忽略` 统一改回 `取消 / Cancel`，多镜确认底栏合并重复的「返回修改」与「取消」为 3 钮标准层级（`取消` · `先试拍第 1 镜` · `确认生成 N 镜`），少 1 个重复取消出口。 | **B 类需拍板**（触碰花钱确认弹窗按钮结构与 `SpendCardQ1.board.json` / `DialogDecisionBar.board.json`）。 |

### 3.6 时间轴预览与导出（Preview, Timeline & Export）

| 编号 | 精确位置（`file:line`） | 违反原则 | 创作者那一刻具体卡在哪 | 建议改法（一句话写清改完少哪一步/哪个判断） | 红线与在途冲突判定 |
|---|---|---|---|---|---|
| **U-20** | `src/workbench/preview/inspector/PreviewInspector.tsx:83,107-109` · `src/i18n/locales/timelinePreview.ts:52` | `#4` · `#8` | ① 左侧片库收起轨已横排 `片库 / Clips`，右侧检查器收起轨漏传 `horizontalLabel` 导致英文 `"Inspector"` 竖排旋转 90° 塞在 `32px` 窄轨里；② 片段填充模式（Contain/Cover）中文被误译成不知所云的 `画面分段`；③ 片段音频静音与音量直接裸写原生 `<input type="checkbox">` 与 `<input type="number">`，脱离设计系统。 | ① `PreviewInspector` 补传横排短标；② `画面分段` 更正为直白的 `画面填充`；③ 静音与音量换用设计系统开关与数字/滑杆控件，一次清掉竖排英文、误译与裸控件。 | **A 类免拍板**（与 `PreviewNarrowPanels.board.json` 兼容，修左/右轨对称性与翻译错误，0 在途冲突）。 |
| **U-21** | `src/ui/app-shell/shell/ShellTopBar.tsx:311-326` · `src/workbench/preview/TimelinePreview.tsx:248-280` · `src/workbench/export/exportApi.ts:84` | `#5` · `#8` | ① 导出 MP4 运行期间顶栏按钮禁用锁死，界面无任何「取消导出」按钮，误点长片导出无法中途停下；② 点击 `导出 MP4` 前，当前分辨率与比例（`16:9 · 1080p`）藏在悬停提示与默认收起的右侧栏里，创作者点之前看不见导出规格。 | ① 导出进行中在顶栏进度状态旁露出 `取消` 按钮（调用主进程导出中断接口）；② 预览态在 `导出 MP4` 旁轻量外显 `1080p` 规格胶囊，少 2 次点开右侧栏核对规格。 | **B 类需拍板**（碰长跑可打断能力与顶栏 `Chrome.board.json` 常驻元素）。 |

---

## 四、按「创作者遇到的频率 × 卡多久」排序的 Top 15 执行清单

> 评分口径：`遇到频率（1–5）× 单次卡住/打断代价（1–5）`，满分 `25`。拆为 **A 类（免拍板，可直接按一处/一屏一小 PR 推进，共 10 项）** 与 **B 类（需协调攒一轮交用户拍板或同步拍板图，共 5 项）**。

### A 类 · 可直接按「一处/一屏一小 PR」推进的免拍板精简项（Top 10）

| 排名 | 条目与得分 | 建议小 PR 切分（一屏/一处一单） | 预计减少的点击 / 判断 | 涉及文件与排期依赖 |
|---:|---|---|---|---|
| **A1** | **U-15 + U-09（前半）** · Agent 非画布面隐藏 `↖`、空画布隐藏 `↖`、文案明确为「从画布点选参考」<br>**20 分**（频率 5 × 代价 4） | `PR-UX-A1`（Agent 与画布参考指针收口） | 非画布面误点跳页 **1 → 0 次**；消除 `+` vs `↖` 同名「加参考」猜谜 **-1 个概念判断**；窄 Agent 底栏净省 `32px` | `src/workbench/ai/ProjectAgentResidentShell.tsx`、`src/workbench/assets/AssetReferenceButton.tsx`、`src/i18n/locales/assetLibrary.ts` · **立即可做（0 冲突）** |
| **A2** | **U-17** · Agent 已接通文本模型时底栏不再显示 `选择模型 ▾`，直出自动选定模型短名<br>**16 分**（频率 4 × 代价 4） | `PR-UX-A2`（Agent 默认模型回显） | 新对话发消息前少 **1 次假未配菜单核对 / 点击**，消除英文 `Choose a mo...` 截断 | `src/workbench/ai/v4/useAgentPanelV4Data.ts`、`src/i18n/locales/agentPanelV4.ts` · **立即可做（与 `S-G` 口径对齐）** |
| **A3** | **U-16** · 全局右上 Toast 避让常驻 Agent 展开坞顶栏<br>**15 分**（频率 5 × 代价 3） | `PR-UX-A3`（Toast 右坞避让） | 右侧开着 Nomi 时入轨/复制后点顶栏免等待 **3 秒遮挡**（重叠面积 **→ `0 px²`**） | `src/NomiAppProviders.tsx` · **立即可做（单文件几行，0 冲突）** |
| **A4** | **U-18（前半）** · Agent 空态「帮 Nomi 变好」遥测卡延后到首次生成/首轮对话后出现（用户 `#1586` 已预批）<br>**15 分**（频率 3 × 代价 5） | `PR-UX-A4`（首屏遥测询问延后） | 首次新建项目进创作页少 **1 次首屏打断与二选一判断** | `src/workbench/ai/v4/AgentPanelV4Consent.tsx`、`src/workbench/ai/v4/AgentPanelV4Empty.tsx` · **立即可做（已获预批）** |
| **A5** | **U-10** · 画布节点「高级设置」补齐 `Escape` 收回 + 展开越界轻推视口<br>**12 分**（频率 3 × 代价 4） | `PR-UX-A5`（节点高级参数可撤回与视口避让） | 关闭高级设置少 **1 次精准找小按钮点击**（`Esc` 直收），消除下半屏节点展开被底栏截断 | `src/workbench/generationCanvas/nodes/InlineParameterBar.tsx`、`src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx` · **立即可做（0 冲突）** |
| **A6** | **U-20** · 预览右侧 `Inspector` 补横排短标、`画面分段` 正名为 `画面填充`、音频裸 `<input>` 换设计系统控件<br>**12 分**（频率 4 × 代价 3） | `PR-UX-A6`（预览检查器一致性与母语纠偏） | 展开右侧轨少 **1 次竖排英文辨认** 与 **1 个 `画面分段` 误译困惑** | `src/workbench/preview/inspector/PreviewInspector.tsx`、`src/i18n/locales/timelinePreview.ts` · **立即可做（0 冲突）** |
| **A7** | **U-11 + U-12 + U-14①** · 空白节点隐藏顶部单钮变体条、`[首帧图] 图片` 去重名、首帧派生视频动作占位提示、发送钮生成中换旋转 `Spinner`<br>**12 分**（频率 4 × 代价 3） | `PR-UX-A7`（画布节点微摩擦清扫） | 首帧转视频少 **1 次「要不要重抄画面词」判断**；清掉空卡头顶无用浮条与静态 `'···'` 卡死错觉 | `src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx`、`NodeLabelRow.tsx`、`deriveFromNode.ts`、`ComposerSendButton.tsx` · **立即可做（避开 `#1702/#1703`）** |
| **A8** | **U-01 + U-02** · 项目库 `文件夹 0` 时隐藏来源三段胶囊 + 移除封面右上悬停红垃圾桶（收进菜单）<br>**12 分**（频率 4 × 代价 3） | `PR-UX-A8`（项目库减噪与防误删） | 进库页少扫视 **3 枚无效筛选胶囊**；点封面进项目彻底消除右上角误删风险 | `src/workbench/library/ProjectLibraryPage.tsx` · **立即可做（0 冲突）** |
| **A9** | **U-04 + U-06 + U-08** · 「原稿/文稿」统一为「文稿」、分镜收起行补 `图 / 视频·Ns` 只读微标、APIMart 粘贴自动剥空白与 `Bearer `<br>**10 分**（频率 5 × 代价 2） | `PR-UX-A9`（创作/分镜/接入文案与容错收口） | 核对 10 镜类型少 **最多 10 次逐行点开**；消除「原稿 vs 文稿」混名与粘贴带空格报错 | `src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx`、`src/ui/onboarding/ApimartConnectPage.tsx`、`src/i18n/locales/creationAi.ts`、`storyboardEditor.ts` · **立即可做（0 冲突）** |
| **A10** | **U-07 + U-03** · 设置通用页置顶「外观（分段胶囊）+ 语言」+ 全应用统一「上手引导」命名<br>**9 分**（频率 3 × 代价 3） | `PR-UX-A10`（设置通用页高频置顶与引导同名） | 改语言/切深浅色少 **1 次弹窗内滚动查找**；全应用少记 **3 个引导别名** | `src/workbench/settings/SettingsDialog.tsx`、`src/i18n/locales/appShell.ts`、`settings.ts` · **等在途 `#1665` 合入后立即推进** |

---

### B 类 · 需协调攒一轮交用户拍板或同步拍板图的冲突 / 取舍项（Top 5）

| 排名 | 条目与得分 | 为什么需要拍板 / 出板 | 推荐项（替创作者做判断） | 正反代价对比 |
|---:|---|---|---|---|
| **B1** | **U-21** · 预览顶栏导出进行中补「取消」按钮 + 导出前外显 `1080p` 规格<br>**16 分**（频率 4 × 代价 4） | ① 新增前端导出中断交互属四类「长跑 / 可打断」严档；② 顶栏右区常驻元素受 `docs/design/boards/2026-10-08/Chrome.board.json` 约束。 | **推荐**：导出运行中把锁死的 `导出 MP4` 胶囊切换为 `导出中 42% · 取消`（单胶囊原地翻面，不加第 2 颗常驻按钮）；空闲态在预览模式按钮文案显示 `导出 MP4 · 1080p`。 | **正**：0 额外顶栏占位，误点长片导出 1 击即停，点前一眼看清清晰度；<br>**反**：按钮宽度在预览态约增加 `44px`，需更新 `Chrome.board.json` 对应合同与补可打断测试证据。 |
| **B2** | **U-13** · 画布底部 `CanvasToolbar` 纯图标栏易混（「视频」vs「剪辑」vs `+`）<br>**15 分**（频率 5 × 代价 3） | 改动画布底部常驻工具栏布局或按钮取舍，直接触碰 `Chrome.board.json` 与 `Main.board.json`。 | **推荐方案 1（极简收口）**：底栏主层只留高频 `图片`、`视频`、`声音`、`导入`、`+ 更多` 5 项，在 `≥1100px` 露出 2 字短标，把低频「文字节点 / 剪辑节点」收进 `+` 弹层；<br>备选方案 2：保持 7 颗不减，仅在 `≥1280px` 露出短标。 | **方案 1 正**：最符合 `#1709` 小应用高频优先，彻底消灭「视频 vs 剪辑场记板」混淆，总宽不变；**反**：建文字/剪辑节点从 1 击变 2 击（空画布磁贴也可同步收敛）。<br>**方案 2 正**：不改点击数；**反**：底栏变宽约 `150px`。 |
| **B3** | **U-05** · 分镜表新建方案默认画幅从 `模型默认` 改为跟随项目画幅（`16:9`）<br>**12 分**（频率 3 × 代价 4） | 改变分镜方案创建时的默认参数语义（可能影响偏爱某模型原生 `1:1` 默认值的用法）。 | **推荐**：新建分镜方案默认绑定当前项目画幅（默认 `16:9`），顶栏直显 `全片 16:9 ▾`，下拉仍保留「按各模型默认」供手动切回；存量已建方案保持原值不迁移篡改。 | **正**：成片本来就要进同一个 `16:9`（或 `9:16`）时间轴，全片默认同画幅最符合视频制作直觉，省掉出完图才发现横竖不一的返工（省真钱）；<br>**反**：单镜若想用模型原生非标比例需点一下切回。 |
| **B4** | **U-19** · Agent 花钱确认弹窗 `忽略` 改回 `取消` + 多镜确认底栏 4 钮并 3 钮<br>**12 分**（频率 3 × 代价 4） | 触碰四类「花钱」确认弹窗组件 `SpendConfirmDialog.tsx` 及 `SpendCardQ1.board.json` / `DialogDecisionBar.board.json`。 | **推荐**：对齐设计系统 §1.9.1，取消统一叫 `取消 / Cancel`；多镜卡底栏删掉与「取消」重复的 `返回修改`，只留 `取消`（左）+ `先试拍第 1 镜`（次）+ `确认生成 N 镜`（主）。 | **正**：花钱关口零歧义，窄窗不再 4 钮挤行；<br>**反**：需走严档花钱弹窗回归与拍板图同步。 |
| **B5** | **U-09（后半） + U-18（后半）** · 将节点输入栏 `↖` 合进 `+` 菜单第 3 项 + 中文全量 `Skill` → `技能` 拍板图同步<br>**10 分**（频率 5 × 代价 2） | ① 若彻底移除独立 `↖` 图标会改动 `NodePointer.board.json` / `ReferenceEntry.board.json`；② `Skill` → `技能` 虽已在 `#1586#issuecomment-7126560423` 获用户拍板，但会触发 `Chrome.board.json` / `SkillLibrary.board.json` 文本合同变更，需协调同提交签发 board approval。 | **推荐**：① `Skill` → `技能 / 技能库` 直接按用户已批结论执行并由协调签发拍板确认；② 节点输入栏先观察 `A1`（改名 + 空画布隐藏）效果，若仍嫌双钮拥挤再出板把「从画布点选」合进 `+` 菜单。 | **正**：先用免拍板 `A1` 拿到 80% 收益，避免为次要合并重跑整套画布拍板；`Skill` 中文化一次根除中英混杂；<br>**反**：分两步走，`↖` 在多节点画布上短期仍保留独立按钮。 |

---

## 五、明确不做（小桌面应用极简边界 `#1709` 与刻意设计核验）

以下点位经源码逐一核查，确认为**合理的刻意设计**或**超出小桌面应用分寸的过度工程**，第二段严禁误改：

1. **不在「新建项目」时弹窗让用户填项目名、选模板或选画幅**（`src/workbench/NomiStudioApp.tsx:447-453`）：当前点 `+ 新建项目` 1 击直落创作页「从一段文字或想法开始」是刻意设计的零阻力入口，后续首段入轨会自动对齐预览画幅（`#1670`），绝不退回传统软件的新建配置向导。
2. **不在时间轴预览页堆叠专业非编（NLE）复杂控件**：不加多视频轨合成、关键帧曲线、转场特效面板或 J/K/L 变速剪辑。Nomi 预览页的核心使命是「把画布产出的镜头排好顺序、配上音轨、干净导出成片」。
3. **不在 APIMart 连接页自动静默读取系统剪贴板**：macOS 桌面应用未经用户按键直接读剪贴板会触发系统隐私粘贴提示或引发信任顾虑，`U-08` 只做用户粘贴后的空白/`Bearer ` 清洗与回车直提。
4. **不另起炉灶重做模型设置结构或节点「自动」模型名解析**：模型设置页折叠与余额页由在途 `#1665` 完整交付；节点参数栏 `自动` 透出具体模型名由任务池 `S-G` 交付，Agent 思考档位切换由 `T-6` 交付，各归其主、绝不并行造双份逻辑。
