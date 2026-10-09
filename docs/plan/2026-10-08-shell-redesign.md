# 2026-10-08 外壳重设计（40px 合一顶栏 + 60px 左栏抽屉 + Agent 三形态）· 设计卡（实现版）

```
改动名：外壳重设计落生产（I-shell）      线：feat/shell-redesign（实现线）      类别：[新界面][Agent 摆位]（不碰花钱判据）
```

- 拍板稿：协调交接文件夹 `design-approved-1008/`（preview/*.html 光 + -dark，source/*.dc.html）。本线负责 Main、CanvasAgent、CreationDoc、Library、LibraryEmpty、Chrome（外壳部分）。
  不归本线：列表卡片 / 大详情 / 方案视图（列表线）；空节点 / 添加节点条长相 / 连线（拉环线）。
- 功能全表与归宿：`R-shell-parity-report.md`（59 行）+ 协调裁决 `R-shell-parity-resolution.md`。总原则：**外壳只搬容器，不拆内容**。
- 走查：`tests/ux/shell-redesign.walk.mjs`（真 Electron、窗口在屏外、隔离 profile、生产构建、零额度）。截图：`docs/evidence/2026-10-08-shell-redesign/`。
- 样张期（design/shell-space）的开关、`SHELL_SPACE_SPECIMEN` 分支、样张走查都没有带进生产：新外壳是唯一形态。

### 功能分类
- [x] 新界面 / 改交互　- [ ] 花钱　- [ ] 长跑 / 可打断　- [x] Agent 行为（只改面板摆在哪）　- [x] 画布　- [ ] 生成效果　- [ ] 数据格式

## 九格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 进项目 → 画布全宽，右下一颗 Nomi 球；点球 / Ctrl(⌘)+J → 384×500 浮窗，拖到哪放哪；头部三选一切小球 / 浮窗 / 停靠，Ctrl(⌘)+\ 停靠↔小球；左栏点「素材」等 → 抽屉浮在内容上、右缘可拖宽；创作页工具条最左「文稿名 ▾」；项目库页签 项目 · Skill · 提示词。真实任务：雨夜便利店 6 镜，在画布、创作、剪辑三页来回；剪辑页从「目录」抽屉点镜头追加到时间轴。主指标：画布可用面积 1280×800 下 1212×716（改前 798×712）。 | 走查 measures；截图 |
| ★2 谁说了算 | Agent 形态 / 位置 / 大小：唯一 owner `src/ui/app-shell/shell/agentFormStore.ts`（概念 `shell.recall-entry`）；`projectAgentDockCollapsed`（Agent layout.read/write 契约字段）只由形态**单向**写（小球 ⇔ 收起），反向「别处叫回面板」走订阅转成这一页的展开形态。外壳几何：`shellGeometry.ts` + `windowChrome.ts`（全屏浮层顶偏移唯一来源 = 40）。左栏收起 / 抽屉宽：`shellLayoutStore.ts`。小球四态：读现役 `residentActivity` 角标投影，不另算。 | `node scripts/check-concept-owners.mjs`（本概念绿）；`check-store-lifetime` 绿 |
| ★3 一致与复用 | 骨架 Mantine AppShell（static，Header 40 / Navbar 60）；抽屉 Mantine Drawer（无遮罩）+ `@mantine/hooks` useClickOutside；浮窗 / 小球 react-rnd 10.5.3；窗口按钮 Electron 原生 titleBarOverlay / hiddenInset；菜单 WorkbenchMenu；图标 Tabler 白名单；Agent 面板、素材库、Skill / 提示词 / 流程库、分组树、文稿树、剪辑页镜头格全部原件搬进抽屉。**自写**：浮窗 / 小球窗口缩小后夹回可见区（`clampRect` / `clampBall`，react-rnd 的 bounds 只在拖动中生效）；抽屉右缘拖宽把手（沿用旧探索栏 pointer-capture 写法，搬过来）。 | 本卡；`git grep '<svg' src/ui/app-shell/shell` = 0 |
| ★4 全状态 | 见下「补齐的状态」。文案全走 i18n（`src/i18n/locales/appShell.ts`），zh / en 两轨截图。 | 截图 |
| 5 中途表 | 只摆位置。浮窗拖到一半关窗：react-rnd 松手才写；重启：形态 / 位置 / 抽屉宽随 persist 回来；窗口缩小：渲染时夹回、不回写。小球 ↔ 面板切换时面板子树重挂（草稿在 store，不丢）。 | 单测 agentFormStore.test.ts |
| 6 外部数据与失败 | Electron 窗口能力：Windows `titleBarOverlay`（颜色由渲染层经受信 IPC `nomi:window:set-titlebar-overlay` 设，只收 hex）、macOS `hiddenInset` + `trafficLightPosition {14,14}`。 | `check-ipc-sender-binding` 绿 |
| 7 性能预算 | 小球 / 浮窗不订阅画布逐帧数据；角标投影 store 有同值短路。 | 代码 |
| 8 真实条件 | Windows 屏外真 Electron ✅（zh/en × 光/暗 × 1280，另 1000 / 1440）；**Win11 Snap（悬停最大化钮分屏菜单、Win+Z、拖到顶部、最小宽度下按钮不压内容）unverified**；**macOS 红绿灯位 unverified**（没有真机）；原生窗口按钮不进页面截图（截图右上是留出的空位）。小球「处理中 / 出错 / 等你确认 N」三张是显示态注入（E2E 桥写角标投影），不是真 Agent 跑出来的。 | 截图（已逐张 Read） |
| ★9 验收与回滚 | 独立验收：协调会话指定的 Codex 线在屏外真 App 按下面 59 行逐行点。回滚：revert 本 PR。 | 本卡 |

## 拍板（协调会话 10-08，写死）

| # | 冲突 | 裁决 | 落地 |
|---|---|---|---|
| C1 C2 C3 C5 C7 | 旧拍板（列表只换画布块 / 点卡右侧检查器 / 点方案筛列表 / 左栏 212 展开态 / 预览面 Agent 默认不开） | 本次重设计取代 | 按新板 |
| C4 | AppShell.Aside 停靠 vs 时间轴横贯 Agent 下方 | 停靠留在各工作区自己的网格里；剪辑页时间轴横贯 Agent 下方 | AppShell 只管 Header + Navbar |
| C6 | 9px 两字标签 | 用 text-micro 11px | 左栏短名 11px，长名在 tooltip / aria-label |
| C8 | 大详情生成钮 | 走 nodeComposerGenerate（列表线） | 不归本线 |
| C9 | 运镜 / 对白字段 | 不加 | — |
| C10 | 分区头「生成整组」 | 同一个执行口（列表线） | 不归本线 |
| C11 | 「新版本」胶囊 | 只认更新器真状态，样张占位不进生产 | `UpdaterPill` 只在 available / downloading / downloaded / error 出；窄于 1100 收成带点图标 |
| 更新提醒分工 | I-update 出 UpdatePill / UpdateDialog / HotfixBanner / UpdatedCard，不改布局文件 | 本线留两个接线点 | 顶栏：`ShellTopBar` 里 `<UpdaterPill/>` 那一格（现接现役 `useUpdater` + `UpdaterDialog`）；项目库：`ProjectLibraryPage` 的 `notices` 属性（页顶 `data-library-notices`，没有就不占位） |

## 拍板稿对账（每块板：一致 / 有意不同）

| 板 | 截图 | 一致 | 有意不同（为什么） |
|---|---|---|---|
| Main | main-*-1280、main-zh-light-1000 / 1440 | 40px 合一顶栏（项目名 ▾ / 创作·生成 5/6·预览 / 任务·浏览器·设置点）；60px 左栏 文稿·目录·素材·流程 \| Skill·提示词 + 底部收起；圆角工作面 + 外壳底色包边 8px；底边时间轴窄条（段数 · 时长 · ^）；右下 44px 小球 | ①顶栏没有「画布 \| 列表」：列表视图未合入 main，`viewSwitcher` 留位由列表线填；②没有「新版本」胶囊：无真更新状态（C11）；③画布上的添加节点条在左侧竖排、左下是画布设置条：画布内部归拉环线 / 画布现役，外壳不动；④空节点长相归拉环线；⑤窄条没有缩略图：种子项目时间轴为空（有片段时最多 12 张） |
| CanvasAgent | canvas-agent-*-1280、-1000、-1440 | 浮窗 384×500 贴右下、圆角 16、头部 Nomi + 模型 ▾ + 历史 + 小球·浮窗·停靠三选一（浮窗高亮）、顶部抓手点；不出界 | 面板内容是现役 v4 空态（征询卡「帮 Nomi 变好」是隐私征询首启卡，非本线）；板上的付费确认卡是示意，零额度不造 |
| CreationDoc | creation-doc-*-1280 | 文稿抽屉浮在编辑器上（280 宽、圆角、+ 新建文稿）；编辑器工具条最左「文稿名 ▾」（被抽屉盖住，关掉抽屉可见）；Agent 停靠右侧、头部三选一停靠高亮 | 抽屉里文稿树是现役 DocumentListSidebar（文稿下挂方案、「新建方案」），板上的「2 份方案 / 7 镜 / 草稿」计数是示意 |
| Library | library-*-1280 | 无左栏；页签 项目 · Skill · 提示词；同一行筛选 · 搜索；右上「打开文件夹」「新建项目」；模型提示条；卡片 248 宽 | ①多一颗「重看一遍引导」文字钮：现役导览入口，不删（外壳只搬容器）；②卡片下面是「刚刚 · 已就绪」同步徽标而不是「7 镜 · 0:30」：卡片内容是现役 ProjectCard（47–48 行裁决：项目卡原样）；③没有任务时不显示任务钮（现役可见性规则） |
| LibraryEmpty | library-empty-*-1280 | 「开始一个项目」+ 说明 + 三张动作卡 + 模型提示条 | 第三张卡标题随导览看过与否在「看一遍怎么做 / 重看一遍引导」间切（现役文案）；英文说明改两行不截断（ActionCard 原语 line-clamp-2） |
| Chrome（外壳部分） | chrome-assets-*、chrome-rail-collapsed-*、chrome-ball-running/failed/pending-*、main-zh-light-1000 | 素材抽屉浮在内容上不挤画布；左栏收起 = 整条让出、顶栏 logo 后一颗「展开左栏」；小球四态：空闲 / 处理中（accent 环 + 转弧）/ 出错（右上 danger 点）/ 等你确认 N（warning 胶囊，右缘不动往左长），都不自己弹开 | ①窗口按钮是原生的，截图里只看到右端留空（Snap 与颜色 unverified）；②macOS 顶栏没拍（无真机）；③素材抽屉内容是现役 AssetLibraryContent（全部 / 项目素材 + 上传 + 筛选），板上的「全部 / 图片 / 视频 / 声音」是示意（15 行裁决：不动） |

## 补齐的状态（拍板稿没画、本线补的）

| 状态 | 怎么补的 | 证据 |
|---|---|---|
| 暗色 | 全部用 token；`--nomi-chrome` 光 oklch(0.97 0.003 80) / 暗 oklch(0.155 0.006 80)；Windows 原生按钮底色 / 符号色随光暗切（ShellFrame） | *-dark-1280 |
| 英文 / 长文本 | 左栏短名一行放不下就省略、全名在 tooltip；项目名 ▾ 截断；动作卡说明两行 | *-en-*、library-empty-en-* |
| 窄窗口 1000 | 「新版本」胶囊 < 1100 收成带点图标；浮窗按内容区收小、clamp 兜底；左栏不变 | main / canvas-agent / chrome-assets-zh-light-1000 |
| 宽窗口 1440 | 工作面随宽，小球 / 浮窗贴右下 | *-zh-light-1440 |
| hover / focus | 顶栏、左栏、三选一、小球都有 hover 底色与 focus-visible accent 描边；抽屉把手 hover 显色、键盘 ←/→ 改宽 | 代码 |
| disabled / loading | 抽屉内容懒加载（Suspense，加载中不画占位）；更新胶囊下载中显示进度 | 代码 |
| 空 | 剪辑页「目录」抽屉没有已出片镜头时显示现役空态；项目库空 = LibraryEmpty | 代码 / library-empty-* |
| 错误 | 小球出错点；更新出错胶囊 = 重试 | chrome-ball-failed-* |
| 浮窗窄 | 宽 < 340 头部按钮收进「⋯」（历史会话 + 三形态） | check-float-compact-zh-light-1280 |
| 减弱动效 | 小球转弧在 prefers-reduced-motion 下不转，只留静态环 | 代码 |

## 功能全表 59 行（R-shell-parity-report.md）→ 新位置

| # | 功能 | 新位置可用（截图 / 走查名） |
|---:|---|---|
| 1 | 窗口最小化 / 最大化 / 关闭 / 双击最大化 | Windows 原生 titleBarOverlay 三钮 + 整条顶栏是拖拽区（window-drag.e2e）；**Snap 真机 unverified** |
| 2 | 打开浏览器 | 顶栏 `[data-shell-browser]`（main-*） |
| 3 | 回项目库 / 项目下拉 / 重命名 | 顶栏「项目名 ▾」菜单：最近项目、回项目库、新建、重命名；双击改名（main-*） |
| 4 | 切换创作 / 生成 / 预览 | 顶栏步骤器（main-*、creation-doc-*、preview-catalog-*） |
| 5 | 预览布局、任务定位 | 剪辑页顶栏布局菜单 + 任务钮（preview-catalog-*；task-center.walk） |
| 6 | 上手清单与未完成态 | 设置钮上的点 + 设置「通用」最上面一块（main-* 设置点；onboarding-checkmark-honesty.walk） |
| 7 | 设置、模型接入、导出 MP4 | 顶栏设置；设置 › 模型；剪辑页顶栏「导出 MP4」（preview-catalog-*） |
| 8 | 旧「去出片」 | 删（设计卡归位表；canvas-control-clarity.walk 断言不在） |
| 9 | 收起后状态 / 未读 / 出错 + 叫回 | 右下小球四态（chrome-ball-*；agent-v4-short-film.walk） |
| 10 | 左栏各库页签 | 60px 左栏 + 抽屉，再点同一项收起（chrome-assets-*） |
| 11 | 拖宽 | 抽屉右缘拖宽，按项记忆（check-drawer-resize-zh-light-1280：440→520） |
| 12 | 分组新建 / 重命名 / 删除 | 「目录」抽屉 CategoryTree + 抽屉头「+ 新建分组」（preview-catalog-*） |
| 13 | 节点拖入分组、重排 | 同上，CategoryTree 原件（拖放代码未改） |
| 14 | 素材上传 / 链接 / 删除 / 搜索 / 预览 / 拖拽 | 「素材」抽屉 AssetLibraryContent 原件（chrome-assets-*；canvas-card-stack.walk） |
| 15 | 素材筛选 | 同上（筛选钮在搜索框右侧） |
| 16 | 素材文件夹 | 同上（原件） |
| 17 | 提示词筛选 / 新建 / 重载 | 「提示词」抽屉 + 项目库「提示词」页签，同一个 PromptLibraryContent |
| 18 | 提示词预览发给 Agent / 复制 | 同上（原件） |
| 19 | Skill 来源 / 导入 / 新建 | 「Skill」抽屉 + 项目库「Skill」页签，同一个 SkillLibraryContent |
| 20 | 流程搜索 / 收藏 / 编辑 / 删除 / 复制 | 「流程」抽屉 WorkflowLibraryContent 原件 |
| 21 | 文稿树开关、新建 / 切换文稿 | 「文稿」抽屉 + 头部「+ 新建文稿」+ 工具条「文稿名 ▾」（creation-doc-*；_creationResourceTree helper） |
| 22 | 文稿重命名 / 删除；新建 / 切换方案 | 「文稿」抽屉 DocumentListSidebar 原件（creation-doc-*） |
| 23 | 方案重命名 / 复制 / 删除 / 从文稿创建 | 同上 |
| 24 | 编辑器工具条 | 编辑器顶部那一行原样，「文稿名 ▾」在最左（creation-doc-*） |
| 25 | 分镜：返回创作、交 Agent、生成全部、放到画布 | StoryboardPlanEditor 原样（只删了旧资源树开关） |
| 26–30 | 分镜方案细项 | 归 I-planview；方案视图做好之前现役编辑器原样保留（本线未动这些功能） |
| 31 | 剪辑页素材 / 镜头切换、收起 | 剪辑页 PreviewSourcePanel 原样保留 + 左栏抽屉另有同一套（preview-catalog-*） |
| 32 | 拖镜头进时间轴 / 点击追加 | 剪辑页「目录」抽屉顶部镜头格可拖、点击追加；「素材」抽屉带音频（check-preview-append-zh-light-1280：时间轴 0→1 段） |
| 33 | 播放器控制 | 原样（preview-catalog-*） |
| 34 | 文本层编辑 | 原样 |
| 35 | 剪辑页布局菜单 | 剪辑页顶栏右侧（preview-catalog-*） |
| 36 | 检查器 | 原样（preview-catalog-*） |
| 37 | Cmd+\ / Cmd+Z | Ctrl(⌘)+\ 停靠↔小球、Ctrl(⌘)+J 打开并聚焦输入框（check-mod-j / check-mod-backslash-dock；editing-real-user-pass.walk）；布局撤销原样 |
| 38 | 画布 / 列表切换 | 顶栏「生成」旁 `viewSwitcher` 位（列表线填） |
| 39–42 | 画布添加节点 / 更多 / 流程模板 / 缩放 | 画布内部原样（main-*） |
| 43 | 时间轴开 / 收 | 底边窄条点 ^ 展开（main-*；layout-timeline-panel-span.walk） |
| 44–45 | 时间轴工具与交互 | 展开后就是现役 TimelinePanel，工具一个不少 |
| 46 | 新建 / 打开文件夹 / 筛选 / 搜索 / 打开项目 | 项目库（library-*） |
| 47–48 | 删除 / 改名 / 打开文件夹 / 同步徽标 / 重查 | 项目卡原样（library-* 卡上「已就绪」徽标） |
| 49 | 页签、重试、清空搜索、空态动作卡 | Library / LibraryEmpty（library-*、library-empty-*） |
| 50 | 全屏浮层让开顶栏 | `fullscreenOverlayTopOffset()` = 40（windowChrome.test；director-windowbar.walk） |
| 51 | 素材预览前后切换 / 下载 3D / Esc | 原样，只改顶偏移 |
| 52 | 小球状态 | chrome-ball-*（running / failed / pending）+ main-*（空闲） |
| 53 | 三形态切换、浮窗拖动改大小 | 头部三选一 + 小球右键菜单；react-rnd（canvas-agent-*、check-mod-backslash-dock） |
| 54 | 旧横向收起条 | 删（设计卡写了要删） |
| 55 | 发送 / 停止 / 附件 / 模型 / Skill / 权限 | composer 原样（canvas-agent-*） |
| 56 | 模型弹层打开模型库 | 原样（事件 nomi-open-model-catalog → 设置 › 模型） |
| 57 | 线程新建 / 切换 / 删除 / 历史 | 头部历史钮原样；浮窗窄时收进「⋯」（check-float-compact-zh-light-1280） |
| 58 | 待确认卡动作 | 卡在面板里原样；小球「等你确认 N」点开回到卡（agent-v4-short-film.walk §4） |
| 59 | 收起时角标 + Mod+J | 小球四态 + Ctrl(⌘)+J（chrome-ball-*、check-mod-j） |

**没有位置、需要协调知道的一处**：收起期间的「未读条数」（09-01 顶栏角标的数字）——小球四态（Chrome 板）没有未读这一档。本线没画第五种长相；`dockUnreadCount` 仍在算、仍随投影发出，但没人画它。要不要在小球上加未读，交协调会话。

## 删掉的东西（同 PR）

NomiAppBar、WindowControls、windowTitlebarDoubleClick、appBarActionGroups、AgentTopbarChip、agentTopbarChipBadge、CollapsedAiChip、AgentPanelV4Dock（横向收起坞）及其净空计算、agentDockHidden、ProjectExplorerSidebar、projectSidebarProjectTransition、CreationResourceTreeToggle / creationResourceTreeCollapse / useCreationResourceTreeCollapsed、timelineHandlePlacement、清单折叠态（readChecklistCollapsed / writeChecklistCollapsed）、主进程最小化 / 最大化 / 关闭三条 IPC、sidebar.* 里随探索栏退役的 8 个 i18n 键、tailwind.config 里沉睡的 `.mantine-AppShell-*` 全局样式、走查 agent-dock-dismiss / onboarding-overlap（前提随组件删除结构上不再成立）。

## unverified

- U1 Win11 Snap Layouts（titleBarOverlay）：悬停最大化钮出分屏菜单、Win+Z、拖到屏幕顶部、最小宽度下按钮不压内容。
- U2 macOS 真机红绿灯位（trafficLightPosition {14,14} 与 40px 栏中线对齐）。
- U3 原生窗口按钮在光 / 暗切换时的颜色（页面截图拍不到原生层）。
- U4 设计实验室 darwin 基线（creation-columns、agent-panel-v4、primitives）要在 mac 上重录。
- U5 小球处理中 / 出错 / 等你确认 N 由真 Agent 驱动的样子（截图是注入；真 Agent 那条由 agent-v4-short-film.walk 覆盖，本机没跑）。
