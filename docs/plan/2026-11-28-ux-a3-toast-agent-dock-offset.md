# 设计卡 · `UX-A3` 全局右上 Toast 避让常驻 Agent 展开坞顶栏

改动名：全局右上 Toast 避让常驻 Agent 展开坞顶栏（`UX-A3` / `U-16`）　线/负责人：impl-ux-a3　类别：[新界面]

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能

## ★0 先查别人

- https://developer.apple.com/design/human-interface-guidelines/modality · Apple HIG（macOS Modality & Transient Feedback）：临时状态反馈浮层不得遮挡相邻常驻工作区或检查器顶栏，应锚定在主工作区可见区域内 · **确认了**右上 Toast 在常驻 Agent 停靠在右侧时必须左移到主工作区右上角、保持与 Agent 顶栏像素重叠面积为 `0 px²`。
- https://v8.mantine.dev/x/notifications/ · Mantine Notifications 官方文档：`Notifications` 容器支持统一通过根容器 `className` 与 CSS 自定义属性控制 `position="top-right"` 的定位，无需每个通知调用方单独适配 · **确认了**所有避让逻辑收口在单一容器 `src/NomiAppProviders.tsx` 内，不向业务调用方扩散偏移参数。
- `src/workbench/generationCanvas/nodes/director/panels/context/ContextCard.tsx:80` · 仓库既有做法：精修右侧属性卡出现时通过 `:root` CSS 变量（`--nomi-director-side-width`）把实际占用宽度传递给 `src/NomiAppProviders.tsx:36` 的全局 Toast 容器，避免写死魔法像素 · **改了**原本只靠固定像素类名的思路，改用同源默认常量（`EDITING_PANEL_DEFAULTS.assistantWidth + ASSISTANT_PANE_GUTTER + SHELL_GUTTER`）配合通知期实测 `--nomi-agent-dock-inset` 与 CSS `max()`，同时兼容拖拽调宽（`300–600px`）、`1100px` 下 CSS Grid 自适应让宽以及与任务中心并行打开的场景。
- `docs/fixes/2026-09-29-toast-identity-withdrawal-and-window-fit.root-cause.json:225` · 既有 Toast 根因合同的残余风险记录：明确记下右侧避让只覆盖了 `model / tasks / director`，未覆盖常驻 Agent 面板导致提示盖住其顶部 · **确认了**本次正是关闭该长期遗留的容器级定位缺口。
- 出口：不涉及：本改动仅修正全局右上 Toast 浮层的水平坐标偏移，不新增、扩大或挪动任何挡人保护、锁或确认拦截。

## 设计卡全表

| 格 | 内容 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当创作者在右侧展开停靠态常驻 Agent 面板（创作/分镜/生成/预览任一工作区），执行会触发右上 Toast 的操作（如批量删节点撤销提示、入轨提示、导出成功提示、失败切家提示）时，希望右上 Toast 落在主工作区右上角，以便立刻点击 Agent 顶栏的「历史 / 收起 / 浮窗 / 停靠」按钮，不再被 Toast 遮挡 3–8 秒。步骤：1. 打开项目并在右侧停靠 Nomi；2. 在主工作区触发右上通知；3. 观察通知落在主工作区右上角且 Agent 顶栏完全可点；4. 拖拽调宽 Agent 坞或缩窄窗口到 `1100×690`，通知随之贴合主工作区右沿；5. 将 Agent 收起或切为浮窗，通知回到窗口右上角 `12px`。**不做什么 + 已知坑**：不改变 Toast 文案、自动关闭时长、堆叠上限或 Agent 停靠宽度计算规则；窄窗（`<1060px`）下外壳自动收起停靠坞，不启用停靠偏移。**真实任务**：1）中文浅色 `1280×800` 画布停靠 Nomi 时批量删 2 节点触发真实撤销 Toast，重叠面积从 `17200 px²` 降至 `0 px²`，点击收起后 Toast 回到距右沿 `12px`；2）英文暗色 `1100×690` 停靠 Nomi（CSS Grid 自动让宽至 `340px`）触发真实撤销 Toast，重叠面积从 `16800 px²` 降至 `0 px²`；3）停靠 Nomi 与任务中心同时打开时，Toast 同时避让两者（重叠 `0 px²`）。**目标→信号→指标**：不遮挡常驻 Agent 顶栏 → `getBoundingClientRect()` 重叠面积 → 目标 `0 px²`（基线 `17200 px²` @ `1280×800`、`16800 px²` @ `1100×690`），量具：`tests/ux/failure-toast-layout.e2e.mjs` + `src/ui/app-shell/toastRightOffset.test.tsx` + 真 Electron 走查截图。 | `tests/ux/failure-toast-layout.e2e.mjs` / `src/ui/app-shell/toastRightOffset.test.tsx` |
| ★1b 连带界面 | 不改变任何既有文案、按钮或回执文字；所有复用全局右上 Toast 容器的通知（撤销提示、信息提示、失败切家提示、入轨与导出回执）自动继承主工作区右上角定位，不再压住 Agent 顶栏。 | `src/NomiAppProviders.tsx` / 真窗口双轨截图 |
| ★1c 老用户 | 不适用：纯运行时渲染层坐标避让，不读写项目文件、模型配置或用户持久化数据；老用户升级后既有项目与面板宽度偏好原样工作，回退版本无任何兼容风险。 | `git diff` 仅触及 `src/NomiAppProviders.tsx` 与 `src/ui/app-shell/toastRightOffset.ts` |
| ★2 谁说了算 | 概念 `feedback.toast-identity` 唯一容器边界：`src/NomiAppProviders.tsx`（`NomiAppProviders`），配套纯几何测量辅助 `src/ui/app-shell/toastRightOffset.ts`（`useDockedAgentRightInset` / `syncDockedAgentRightInset`）。全仓所有通知均经 `@mantine/notifications` 单一容器渲染，同一避让规则只此 1 处（靠单一容器挂载点保证，任何业务模块拿不到第二份定位控制权）。门表（`node scripts/door-map.mjs NomiAppProviders useDockedAgentRightInset syncDockedAgentRightInset`）：读入口 5 扇（`src/main.tsx` 及 4 个 `src/devlab/*` 预览壳），写入口 2 扇（`src/NomiAppProviders.tsx` 与 `src/ui/app-shell/toastRightOffset.ts` 组成单一写入链）。不靠猜测推断意图：显式读取外壳权威属性 `[data-shell-agent-layer][data-agent-form=dock]` 与当前可见停靠栏 `[data-assistant-pane="true"]` 实测几何；通知清空即断开全部观察器并清除 CSS 变量，无残留态。 | `node scripts/door-map.mjs NomiAppProviders useDockedAgentRightInset syncDockedAgentRightInset` / `pnpm run check:concept-owners` |
| ★3 一致与复用 | 以前定过：`docs/fixes/2026-09-29-toast-identity-withdrawal-and-window-fit.root-cause.json:225` 明确记录了 Toast 容器只避让了 `model/tasks/director` 而未避让 Agent 面板。三条路对比：沿原方向把固定像素硬编码进 `NomiAppProviders` 会在用户拖宽 Agent 坞（`300–600px`）或 `1100px` 窗口让宽时继续重叠或偏移过度；删掉避让会恢复遮挡；因此选用「沿单一容器边界升级为动态 CSS `max()` + 通知期单元素 `ResizeObserver` 实测」：复用既有 `EDITING_PANEL_DEFAULTS.assistantWidth`、`ASSISTANT_PANE_GUTTER`、`SHELL_GUTTER` 单一真源常量和 `notificationsStore`，不自造第二套宽度表或通知宿主。 | `pnpm run check:self-written` / `git grep data-nomi-right-panel src/` |
| ★4 全状态 | 空（无通知）：零常驻 `ResizeObserver` / `MutationObserver` / `resize` 监听，不写 `--nomi-agent-dock-inset`；加载/成功/失败/部分成功/取消中/过期通知：全部经同一容器按当前停靠态与右侧面板状态即时避让，整条通知与 `×` 留在视口内且不与停靠坞重叠；能力不可用：不适用（纯本地几何避让，无外部能力依赖）；极端文字/双条堆叠：延续既有 `grid-cols-[minmax(0,1fr)]` 与 `TOAST_MAX_HEIGHT` 约束，并通过 `min(..., max(12px, calc(100vw - 356px)))` 防止 `700px` 窄窗下向左伸出视口；无新增文案。 | `node tests/ux/failure-toast-layout.e2e.mjs` / `pnpm run check:i18n` |
| 5 中途表 | 无通知 × 停/关窗/断网/重启/连点：无监听无副作用，不花钱；通知显示中 × 停/收起 Agent/切浮窗：`MutationObserver`（仅单节点 `data-agent-form` 属性）即时清变量并平滑回贴右沿 `12px`，不花钱；通知显示中 × 关窗/卸载：`useEffect` cleanup 退订 `notificationsStore` 并断开全部观察器、移除 CSS 变量，不花钱；通知显示中 × 断网/重启：纯前端布局计算，重启后按真实 DOM 几何重算，不花钱；通知显示中 × 连点触发多条或连续拖拽调宽：`ResizeObserver` 实时更新 `--nomi-agent-dock-inset`，`limit=2` 照常生效，不花钱。 | `src/ui/app-shell/toastRightOffset.test.tsx` |
| 6 外部数据与失败 | 不适用：不消费任何供应商 API、文件或外部用户输入，仅读取本应用自产 DOM 几何与 `notificationsStore` 状态；当 DOM 无有效可见停靠栏（如夹具仅挂形态属性或 `rect.width === 0`）时安全回退到同源默认常量 `406px`（`390 + 8 + 8`）。 | `src/ui/app-shell/toastRightOffset.ts` |
| ★7 性能 | 不适用：非新增重型交互功能；且刻意设计为「按需订阅」——仅在 `notificationsStore` 存在活跃通知时才绑定单个停靠栏 `ResizeObserver` 与单节点属性观察器，通知关闭瞬间全部断开，对画布平移/缩放/拖拽及日常编辑零帧预算开销。 | `src/ui/app-shell/toastRightOffset.ts` / `src/ui/app-shell/toastRightOffset.test.tsx` |
| 8 真实条件 | 英文界面：已验证（`en` 暗色 `1100×690` 真 Electron 窗口 + Chromium e2e）；最小/紧凑窗：已验证（`1100×690` 真 Electron 停靠态 + `700×720` Chromium 非停靠与任务中心态）；中文浅色常规窗：已验证（`zh-CN` 浅色 `1280×800` 真 Electron 窗口，含停靠与收起切换）；干净安装（空库隔离资料）：已验证；键盘全程（`⌘D` / `⌘A` / `Backspace` 触发撤销 Toast）：已验证；Windows：`unverified`（macOS 开发机，样式与 `ResizeObserver` 为跨平台标准 Chromium API）；真规模/真付费：不适用（不涉及节点规模算法或付费调用）。 | `ux-a3-screenshots/before-zh-light.png`、`after-zh-light.png`、`before-en-dark.png`、`after-en-dark.png`（均已亲眼 Read 核验） |
| 拍板图清单：不适用：修复全局右上 Toast 遮挡右侧常驻 Agent 坞顶栏的坐标偏移缺陷，未新增或改动拍板元素结构 | 不修改任何 `.board.json` | `pnpm run check:board-parity` |
| ★9 验收与回滚 | **验收清单与反例**：1. 反例「什么都不做」（旧 `NomiAppProviders.tsx`）→ `node tests/ux/failure-toast-layout.e2e.mjs` 在 `1280×800` 中英双轨必红（实测报 `Agent 停靠 390px 时右上 Toast 与 Agent 顶栏存在重叠`），真 Electron 重叠 `17200 px²`（`zh 1280×800`）与 `16800 px²`（`en 1100×690`）；2. 反例「始终左移（不区分形态）」→ `collapsed` / `float` 断言 `rightGap ∈ [10, 16]px` 必红；3. 反例「写死固定像素 `418px`」→ 拖宽至 `480px` 时 `overlapWith('#project-agent-resident') === 0` 必红；4. 反例「Agent 规则覆盖 `tasks` 规则」→ `dockWidth=300` + `tasks` 组合时 `overlapWith('[data-nomi-right-panel="tasks"]') === 0` 必红；5. 反例「隐藏工作区残留 `[data-assistant-pane]` 干扰测量」→ `toastRightOffset.test.tsx` 同级隐藏 `0×0` 停靠栏用例必红。**实现线自验表**：全部 5 条反例在修复后均转绿（`vitest` 27/27 绿 + `failure-toast-layout.e2e.mjs` 3 尺寸 × 2 语言全绿 + 真 Electron 改后重叠 `0 px²`）。**独立验收**：待协调派独立盲验线在真窗口与反例变异上核验并回填。**回滚**：单提交 `git revert <merge-sha>` 即可无副作用回退。 | `pnpm exec vitest run src/ui/app-shell/toastRightOffset.test.tsx` / `node tests/ux/failure-toast-layout.e2e.mjs` |
