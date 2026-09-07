# 设计系统从「值的字典」升级为「组件的权威」（2026-09-07）

> 状态：📋 方案待拍板

> 起因：[2026-09-07 设计系统优化](2026-09-07-design-system-optimization.md) 的 **D 档**（该文只写「出方案、不动码」）。
> 本文只出方案。**一行生产代码都没动。**

---

## 先查别人

> R27 必交物。完整报告：[`docs/research/2026-09-07-design-system-component-authority/prior-art.md`](../research/2026-09-07-design-system-component-authority/prior-art.md)（含 TikHub 两轮 96 条实抓附件与诚实记分）。
> 下面每条都带出处；**转引与实查分开标**——标「转引」的本节没有复跑。

**依赖里已有？**

- **实装的 Mantine 是 7.17.8，不是本文 §2 抬头写的 7.13.1**（`^7.13.1` 是范围，实物看锁文件）：[`pnpm-lock.yaml:1567`](../../pnpm-lock.yaml:1567) · [`node_modules/@mantine/core/package.json:3`](../../node_modules/@mantine/core/package.json:3)。
- **submenu 的代码在 7.17 的包里，但没有出口**：[`node_modules/@mantine/core/lib/components/Menu/MenuSub/MenuSub.d.ts:20`](../../node_modules/@mantine/core/lib/components/Menu/MenuSub/MenuSub.d.ts:20) 有 `export declare function MenuSub`，而 [`node_modules/@mantine/core/lib/components/Menu/index.d.ts:1`](../../node_modules/@mantine/core/lib/components/Menu/index.d.ts:1) 起的六行导出里没有任何 `Sub`；运行时实测 `Menu.Sub === undefined`（`Object.keys(Menu)` = `extend,withProps,classes,displayName,Item,Label,Dropdown,Target,Divider`）。⇒ **§3.1 理由 1 与 §5.5 的结论成立，但机制要更正**：不是「8.0 才加的」，是**7.17 已随包发了、只是没接出口**。它意味着「等一个 7.x 补丁版把 `Sub` 导出来」是一条成本远低于大版本升级的旁路，应当当作已知观察项挂着，不该当成不存在。
- **加 Radix 菜单等于零新内核，这在依赖图上可验证**：已装的 tooltip 已经把菜单要用的件全拉进来了——[`node_modules/@radix-ui/react-tooltip/package.json:17`](../../node_modules/@radix-ui/react-tooltip/package.json:17) `react-dismissable-layer@1.1.14`、[`:19`](../../node_modules/@radix-ui/react-tooltip/package.json:19) `react-popper@1.3.2`，另有 `react-portal` / `react-presence` / `react-slot`。⇒ §3.1 那句不是修辞。
- Mantine `Menu` 的 defaultProps 早就配好了、消费者零个：[`src/theme/nomiTheme.ts:221`](../../src/theme/nomiTheme.ts:221)。

**仓库里已有？**

- **22 个文件写了 `role="menu"`，其中 0 个出现 `ArrowDown`**（`for f in $(grep -rl 'role="menu"' src); do grep -q ArrowDown "$f" && echo "$f"; done` → 零输出）。方向键遍历是 WAI-ARIA menu 模式的必答项，**22 份里 0 份答了**——这比「77 处重复」更能说明它不是风格问题，是「靠人记得必漏」。
- **「买行为、不买结构」在仓库里已经跑着，两刀都是延长线不是新起炉灶**：[`src/design/tooltip.tsx:2`](../../src/design/tooltip.tsx:2) 与 [`src/ui/switch.tsx:2`](../../src/ui/switch.tsx:2) 是 Radix 行为 + Nomi token className 的现役先例；[`src/design/useOverlayEscape.ts:18`](../../src/design/useOverlayEscape.ts:18) 已有 4 个消费者（`UpdaterDialog` / `ProvenancePanel` / `SpendConfirmDialog` / `TimelineShortcutsDialog`），刀 3 的 `useDialogShell` 是给它补齐剩下三件事。
- 自称「全站唯一」的 [`src/design/AnchoredPopover.tsx:7`](../../src/design/AnchoredPopover.tsx:7) 生产消费者只有 2 个，而 `getBoundingClientRect` 散在 **67 个文件**里。
- `StatusBadge` 的 tone 映射实读确认全是 Mantine 原生色板 key、一个 Nomi token 都没有：[`src/design/status.tsx:7`](../../src/design/status.tsx:7)。

**生态里已有？**

- Radix `DropdownMenu` / `ContextMenu`：`Sub*` 与 `textValue`（typeahead）是一等公民，零默认 CSS——<https://www.radix-ui.com/primitives/docs/components/dropdown-menu> · <https://www.radix-ui.com/primitives/docs/components/context-menu>。
- **连「带样式的组件库」自己也是买的**：Mantine `Menu` = `Popover`(Floating UI) + 键盘 hook——<https://mantine.dev/core/menu>。没人认为菜单值得自研。
- **§3.1 的「薄壳」形状不是我们发明的**：shadcn/ui 的配方就是「Radix 行为 + Tailwind 样式 + 代码进自己仓库」——<https://ui.shadcn.com/docs>。
- **对话框「行为买、结构自持」是三家共识**：Radix Dialog 的 `onEscapeKeyDown`/`onPointerDownOutside`/`onInteractOutside`/`onCloseAutoFocus` 全是行为钩子（<https://www.radix-ui.com/primitives/docs/components/dialog>），Mantine `Modal.Root` 同形（<https://mantine.dev/core/modal>）。⇒ §3.2 与 §5.1 成立。
- Mantine `color` 接受任意 CSS 颜色（非 theme key 原样透传）——<https://mantine.dev/styles/color-functions>。**文档层成立，我们这套 CSS 加载路径下未实测**，归 §7 的 P0。
- **转引未复跑**：§3.1.1 那张五候选对比表（Base UI 1.8.0 / Headless UI / Ark UI / React Aria 的版本号与发布日期）来自 npm registry 与 GitHub commits 实查，报告只核对了它的仓库侧前提。

**TikHub 自媒体里怎么说？**（两轮 96 条实抓，附件见报告 §④）

- **最对口的一条是「两派之争」**：「用了 10 年 AntD 之后，聊聊 UI 库的下一个十年」（抖音 · AnnatarHe，2026-05-15，<https://www.douyin.com/video/7640088811422141748>）——「AntD 派回答的是『怎么更快交付』」，「ShadCN 派回答的是『怎么做对的事情』——把 UI 库从 dependency 变成你自己的代码」，选择依据是「品牌一致、性能可控、演进自由」。**独立于本文四列表，收敛到同一条分界**；Nomi 的处境（token-only + 密度优先 + 画布里 14 个高密度菜单）正落在后半边。
- 「Radix + Tailwind 做下拉」在中文圈是熟路，有现成教程：B站 · Cali卡利卡索，<https://www.bilibili.com/video/BV1Zh4y1o7Ew>。
- 「shadcn/ui 建立在 Tailwind CSS 和 Radix UI」已是公共常识（小红书 · 博文视点Broadview，<https://www.xiaohongshu.com/explore/67580255000000000402811a?xsec_token=YBEWPx_gCtrK91wjC3o8AiOUePGJJoWn5NDi8SUrxuXhk%3D&xsec_source=pc_search>）。
- 「右键菜单组件的封装」确实是被单独讲的题（抖音 · 渡一前端必修课，<https://www.douyin.com/video/7634467698935696667>）——**但这条只有标题，拿不到论证内容**，只能证明「这是公认要封装的东西」，不能当技术判断的依据。
- **查不到的（如实记账）**：96 条里**没有任何一条**讨论「Mantine vs Radix 该选哪个」「Mantine 7 的 Menu 有没有 submenu」「一个仓库里 77 处手写菜单怎么迁」，也没有一条讲对话框的焦点管理或 Esc 语义。关键词命中率约 4%。⇒ 中文自媒体讲「怎么选型」很多，讲「已有的一堆手写实现怎么收口」几乎不讲——**存量治理这一族拿不到公开经验，只能靠自己的实扫和门岗**。这条反过来支持刀 2 的 `role="menu"` 棘轮。

**结论：买 + 抽，不自研。** 菜单买 Radix（依赖图零新内核 · 22/22 份手写菜单 0 份实现方向键 · 连 Mantine 自己都是买的）；对话框只抽行为不做壳（三家框架形状一致，且 `useOverlayEscape` 已走了第一步）；零调用件删不修（P1 直接推论）。**要更正的只有一条**：Mantine 7.17 的 submenu 是「有代码没出口」，不是「没有」。

---

### 上游更正（本节落笔时 C 档已被调研推翻两条，本文受影响处随之更正）

上游 [`docs/plan/2026-09-07-design-system-optimization.md`](2026-09-07-design-system-optimization.md) 的 C 档在 2026-09-07 被 [`prior-art.md`](../research/2026-09-07-design-system-optimization/prior-art.md) 改了两条，与本文 **刀 3** 咬合：

- **C2 的阈值从 `N≥20` 改成 `N≥50`**：实扫 197 处 `z-[N]` 里 163 处是 `z-[1..20]` 的组件内局部序（生态共识里这类**就该**用小数字或 DOM order 解决），只有 34 处 ≥50 才与分层契约打架，其中 5 处压过 `confirmation=9300`——正是刀 3 要迁的那五个文件。
- **C2 必须先补出口再上棘轮**：先把 `NOMI_OVERLAY_Z_INDEX` 镜像成 CSS 变量并接进 `tailwind.config.ts` 的 `theme.extend.zIndex`（Tailwind 默认 `zIndex` 只到 50，这一格是真缺口），让 `z-overlay-dialog` 这类说法在 className 侧存在，**然后**才加棘轮。不补出口的棘轮是给根因打补丁（P2）。
- ⇒ **对刀 3 的影响**：刀 3 迁那 5 个 `z-[9999]`/`z-[10000]` 时，**归位的落点是 C2 补出的 `theme.extend.zIndex` 类名**（或 `useDialogShell` 内部接 `NOMI_OVERLAY_Z_INDEX`），不是再挑一个新数字；`SpendConfirmDialog` 的 `z-[3500]` 同理。**刀 3 与 C2 的先后**：C2 的「镜像 + 出口」那一步是刀 3 的前置，棘轮那一步可以在刀 3 之后。
- **C1 的更正与本文无关**：`nomiDesignTokens.spacing` 那 8 个值与 Tailwind 默认栅格逐值相同，整体接 `theme.extend.spacing` 是凭空造第二真相源，只补默认表没有的半档键（3/5/7/9/18/22px）。**本文五刀没有任何一刀碰间距 token**，无需更正，此处只作留痕。

---

## 0. 一句话：这份方案在解决什么摩擦

体检的结论是一句挺反直觉的话：

> **颜色、字号、圆角这三样已经满分，界面还是不像一个东西——因为不一致不住在「值」里，住在「零件」里。**

打个比方。我们现在有一本非常严谨的**颜料色号表**：每种灰是几号灰，写死了，谁调错当场报警（`check:tokens` 四类棘轮全 `0/0/0/0`）。
但我们**没有一套统一的零件**。于是每次要装个「右键菜单」，二十个地方各自用同一批颜料，各手工削了一个出来。颜色是对的——所以截图上看不出问题；而**手感**全不一样：

| 用户真实会遇到的事 | 现状 |
|---|---|
| 在画布上右键，按 `Esc` 想关掉菜单 | 有的关，有的不关（20 个文件各写各的 keydown） |
| 菜单打开后想用 ↑↓ 选 | 基本都不行——20 份里没有一份做了方向键遍历 |
| 菜单被面板边缘裁掉半截 | 只有 2 处走了会翻转避让的 `AnchoredPopover`，另外 45 个文件自己 `getBoundingClientRect` 算 |
| 从「删除」确认框到「花钱」确认框，键盘行为不一样 | 32 个文件各写一个 `role="dialog"`；本轮 B3 之前，**花钱**的那个连 `Esc` 都没有 |

这不是「代码不够漂亮」的问题，是**用户每天摸得到的手感不一致**。而且门岗一个都拦不住：机器只会数颜色，不会数「这个菜单支不支持键盘」。

**所以本方案要办的事只有一件：把「界面像不像一个东西」这件事，从「每个人写的时候记不记得」，变成「不用这个零件就写不出来」。**

---

## 1. 现状核实（本轮逐条复核，行号为核实时刻）

> 上游体检给的数字有漂移，下面是**重新数过**的。

### 1.1 缺失原语

| 缺什么 | 现状 | 证据 |
|---|---|---|
| **Menu** | 手写 `role="menu"/"menuitem"` **77 处 / 20 文件**，设计系统里**没有这个原语** | 最重的三处：`src/workbench/generationCanvas/nodes/scene3d/scene3dToolbar.tsx`(16)、`src/workbench/sidebar/CategoryTree.tsx`(11)、`src/ui/browser/dialog/NomiBrowserDialogView.tsx`(8) |
| **Dialog（原生壳）** | 手写 `role="dialog"` **32 文件**；`DesignModal`（Mantine）**只有 5 个调用点** | `src/design/overlays.tsx:8` 定义；调用点：`FeedbackShareDialog.tsx:29`、`CustomCallEditor.tsx:780`、`ModelSettingsDetailDialog.tsx:100`、`OnboardingWizard.tsx:746`、`WorkflowLibraryContent.tsx:192`（第 6 处是 `src/design/confirmDialog.tsx:70` 自己） |
| **Spinner** | `animate-spin` **15 处三套写法**：CSS 边框环（`BrowserAssetPopoverParts.tsx:114,187`）、`IconLoader2`（5 处）、`IconRefresh` 就地转（5 处）、品牌件 `NomiLoadingMark`（`src/design/identity.tsx:113`） | — |
| **Skeleton** | `NomiSkeleton` 本轮 B2 首次被采纳（`src/workbench/library/ProjectLibraryPage.tsx:454`），此前**零调用**；全仓仍有 12 处手写 `animate-pulse` | — |

**5 : 32。** 这个比例本身就是结论——不是大家懒得用 `DesignModal`，是 `DesignModal`（Mantine `Modal`）**给不了工作区要的东西**。这条由本轮 B3 亲自验证过，见 §5.1。

### 1.2 词表分叉

同一根轴有四个名字，同一个 `sm` 在四处各硬编码一份：

| 轴 | 用到的词 | 例子 |
|---|---|---|
| 语义色/强调度 | `variant` / `tone` / `kind` / `color` / `intent` | `DesignButtonProps.variant`（Mantine 词表 `light\|filled\|outline…`）vs `StatusBadgeProps.tone`（`neutral\|info\|success\|warning\|danger`，`src/design/status.tsx:5`）vs `NomiSelectTone` vs `confirmDialogStore.ts:7` 的 `kind` |
| 尺寸/密度 | `size` / `density` / `compact` | 见下 |

四套互不兼容的 size scale：

| 出处 | 档位 | 实际像素 |
|---|---|---|
| Mantine theme（`src/theme/nomiTheme.ts`） | `xs sm md lg xl` | 由 Mantine 自己的 scale 决定 |
| `WorkbenchButton` / `WorkbenchIconButton`（`src/design/actions.tsx:90,209`） | `sm md` | 28 / 32 |
| `NomiSelect`（`src/design/NomiSelect.tsx:57,122`） | `xs sm` | 24 / 28 |
| `DesignSearchInput`（`src/design/searchInput.tsx:16,35`） | `sm md` | 30 / 36 |

外加两个只叫 `density` 的（`NomiSegmented.tsx:31` = `compact\|default` = 28/32；`emptyState.tsx:16` = `panel\|inline`）和 13 处 `compact?: boolean`。

**同一个字母 `sm`，在这四张表里分别是 32、28、24、30 px。** 谁想改「所有紧凑控件高一点」，得改四处、而且必须先知道有四处。

### 1.3 近重复

| 一对 | 采纳 | 判断 |
|---|---|---|
| `DesignSegmentedControl`(Mantine, `forms.tsx:77`) vs `NomiSegmented`(原生, `NomiSegmented.tsx:33`) | 2 vs 4 | 真重复，该合 |
| `DesignButton`(Mantine, `actions.tsx:48`) vs `WorkbenchButton`(原生, `actions.tsx:239`) | **63 vs 100** | 半途迁移卡在中间 |
| `DesignEmptyState`(`emptyState.tsx`) vs 各处自建空态 | 14 调用 vs **22 个文件**另有自己的空态实现 | 部分真重复（见 §5.3） |

### 1.4 本轮 primitive 实验室屏抓到的新证据（重要）

给 `src/design/` 的 33 个组件建了陈列屏之后，**第一次有人真的把这些零件渲染出来看**，当场抓到两件事：

**(a) `DesignPagination` 完全没有当前页选中态。**
基线 `tests/ux/design-lab/__baselines__/primitives-surfaces/ps-13-pagination.png`：`value=1` 那行和 `value=4` 那行**渲染完全一样**，而且所有页码控件连边框和 32px 定尺都没有——即 Mantine `Pagination.css` 的基础样式整个没生效。翻页控件事实上**不可读**。

> ⚠️ **根因未定，不许先改（P2）。** 已排除的：CSS 规则本身在产物里（`public/tailwind.generated.css` 有 `m_326d024a:where([data-active])` 与 `--pagination-active-bg`，产物比 `node_modules` 新）；不是「传了 `value` 没传 `onChange`」（实验室用 `Stateful` 传了）。剩下的候选是 CSS 层叠/加载路径（见 §1.5）。**实施第一步是 10 分钟浏览器里量一次 `getComputedStyle`，定了根因再动手。**

**(b) `DesignAlert` / `DesignBadge` 走 Mantine 原生色板，不走 Nomi token。**
基线 `ps-03-design-alert.png`：三色分别是 Mantine 的 `blue` / `yellow` / `red`，`filled` 变体是标准 Mantine 蓝——**和 Nomi 全站的 accent / 语义色不是一套**。

这两件都是**零调用组件**（`DesignPagination` / `DesignAlert` / `DesignBadge` / `DesignTable` / `DesignDrawer` 全仓 0 个调用点）。零调用是它们坏了这么久没被发现的原因，也是**它们的处置该是删而不是修**的原因（§4 刀 0）。

### 1.5 一条没人守的接缝：Mantine 的样式来源和 import 图是分家的

`src/main.tsx:12-15` **只 import 了 4 个 Mantine CSS 文件**（`UnstyledButton` / `CloseButton` / `Notification` / `notifications`）。
全量 `@mantine/core/styles.css` 是被 `scripts/build-tailwind.mjs:44` **拼接**进 `public/tailwind.generated.css` 的（Mantine 在前、Tailwind 在后），由 `index.html:7` / `design-lab.html:6` 用 `<link>` 引入；该产物在 `.gitignore:19` 里，不进 git。

也就是说：**一个 Mantine 组件长什么样，取决于一个构建脚本的拼接顺序，而不是取决于任何一行 import。** 没有任何门岗守这条。§1.4(a) 的根因很可能就在这里。

### 1.6 一套已经断掉的样式接缝

`src/design/` 里 17 个组件都挂了 `tc-*` 钩子类（`tc-design-button` / `tc-design-pagination` / `tc-status-badge` …）。
**全仓没有任何 CSS 定义这些类**——`origin/main` 的 `src/styles/vendor-overrides.css` 里只有 `.tc-panel-card` 一条，而本轮 A3 已把那个文件删掉（它压根没被 import）。这 17 个 class 是纯噪音。

### 1.7 文档主张与现实背离

| 文档说 | 现实 |
|---|---|
| `src/design/AnchoredPopover.tsx:7` 「全站唯一一套浮层定位机制」「P1：新增浮层一律用它」 | **2 个文件**在用（`TimelineTransitionPicker.tsx:41`、`AssetPickerPopover.tsx:11`）；另有 Radix、Mantine `Popover`（1 处）、45 个文件自己 `getBoundingClientRect` |
| `src/design/emptyState.tsx:5` 「收口此前各面板各手写一份」 | 14 处用它，**22 个文件**另有自己的空态 |
| `src/design/README.md:12-24` 推销 `PanelCard` / `InlinePanel` / `DesignSelect` | `README` 自己第 18 行写「there is no `DesignSelect`」——同一份文档自相矛盾；`PanelCard` / `InlinePanel` 全仓 0 命中，**这两个组件不存在** |

**这比「没有主张」更伤**：新人照 README 写，会写出第五套。

---

## 2. R29 四列表：Mantine 与 Radix 的边界画在哪

> 规则要求：接框架前先出「它提供 / 我们用了 / 我们另写了 / 我们拆散了」，每格给 file:line 或文档 URL。
> 版本从 `package.json` 读：`@mantine/core ^7.13.1`、`@mantine/modals ^7.13.1`、`@mantine/notifications ^7.13.1`、`@radix-ui/react-switch ^1.2.6`、`@radix-ui/react-tooltip ^1.2.11`、`tailwindcss 3`、`react 18.3.1`。
> Mantine 能力面经 Context7 查 7.x 官方文档核实（不是凭记忆）。

### 2.1 Mantine 7.13

| 它提供 | 我们用了 | 我们另写了 | 我们拆散了 |
|---|---|---|---|
| **`Menu`**：`Menu.Target/Dropdown/Item/Label/Divider` 组合式 API；`trapFocus:true`、`closeOnItemClick:true`、`clickOutsideEvents:['mousedown','touchstart','keydown']`、`loop:true`、`trigger:'click'\|'hover'\|'click-hover'`；Escape / ↑↓ / Home / End 键盘遍历；自动挂 `role="menu"`/`role="menuitem"`/`aria-haspopup`/`aria-expanded`；Floating UI 定位（`position` 12 档 + `offset` + `flip`/`shift`/`size` middleware）；`withinPortal` + `zIndex`；Styles API（`classNames`/`styles`/`vars`/`unstyled`）。**没有 submenu**（`Menu.Sub` 是 Mantine 8.0 才加的）。**typeahead 只在 dropdown 内有 search input 时可用**，不是全局按字母跳。<br>https://mantine.dev/core/menu | **零处。** | **77 处 / 20 文件**手写 `role="menu"`。<br>`src/workbench/generationCanvas/components/NodeContextMenu.tsx`、`FrameContextMenu.tsx`、`src/workbench/timeline/TimelineContextMenu.tsx`、`src/workbench/preview/EditingLayoutMenu.tsx`、`src/workbench/sidebar/CategoryTree.tsx`… | **`src/theme/nomiTheme.ts:221` 已经给 `Menu` 配好了 `defaultProps`（radius/shadow/zIndex），而全仓零个消费者。**（四列表里最刺眼的一格：我们既配置了它、又从头手写了 77 份） |
| **`Modal`**：compound `Modal.Root/Overlay/Content/Header/Title/CloseButton/Body`——**Root 只提供行为（focus trap / scroll lock / esc / portal / transition），结构与宽度可完全自定义**；`size` 接受 `xs..xl` / `"auto"` / 任意 CSS 值；`trapFocus`/`returnFocus`/`closeOnEscape`/`closeOnClickOutside`/`lockScroll`/`removeScrollProps`/`scrollAreaComponent`。<br>https://mantine.dev/core/modal | `DesignModal`（`src/design/overlays.tsx:8`）**只用了扁平 `Modal`，没用 compound Root**；5 个调用点。 | **32 文件**手写 `role="dialog"` 壳。 | `DesignModal` 把 Mantine 最有价值的那半（`Modal.Root` compound）扔了，只包了扁平版；于是「宽度/滚动结构自定义」这件 Mantine **本来做得到**的事，在我们这儿变成了「Mantine 做不到」的共识。 |
| **`FocusTrap`**（独立可用，不绑 Modal）<br>https://mantine.dev/core/focus-trap | ✅ **用得很对**：`src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:2` 把它当 headless 件单独用在手写壳上（本轮 B3）。 | — | — |
| **`Portal`** | `SettingsDialog.tsx:3`、`TaskCenterPanel.tsx:7`、`HandbookPanel.tsx:8`、`PromptPreviewOverlay.tsx:3`、`ComfyuiWorkflowSettingsPage.tsx:17` | `src/design/portal.tsx` 的 `BodyPortal`（薄封装，合理） | — |
| **`Popover`**（Floating UI 定位、flip/shift、withinPortal） | **1 处**：`src/workbench/generationCanvas/nodes/NodeCameraMoveControl.tsx:3` | `src/design/AnchoredPopover.tsx` + `anchoredPopoverPlacement.ts`（自算 placement/翻转/夹视口） | `nomiTheme.ts:228` 也给 `Popover` 配了 defaultProps，服务 1 个调用点 |
| **`Button` / `ActionIcon`** | `DesignButton`（`actions.tsx:48`，63 调用）、`IconActionButton`（`actions.tsx:10`） | `WorkbenchButton`（`actions.tsx:239`，**100 调用**）、`WorkbenchIconButton`（`actions.tsx:98`） | **`DesignButton` 借壳不借尺寸系统**：`actions.tsx:59-63` 用 Tailwind 写死 `h-8 px-3 rounded-nomi-sm text-body-sm`，于是 Mantine 的 `size` prop 传了**不起作用**——类型上还在，行为上是死的 |
| **`Combobox`**（低层选择器搭件） | `src/design/NomiSelect.tsx:3`（拿 `Combobox`+`useCombobox` 自己搭 24/28px dense 选择器） | — | — |
| **`SegmentedControl`** | `DesignSegmentedControl`（`forms.tsx:77`，2 调用） | `NomiSegmented`（`NomiSegmented.tsx:33`，4 调用，原生 `role="radiogroup"`） | — |
| **`Pagination` / `Alert` / `Badge` / `Table` / `Progress` / `Drawer`** | 各包了一层 `Design*`（`navigation.tsx` / `status.tsx` / `tables.tsx` / `overlays.tsx`） | — | **全部零调用**（`DesignProgress` 4、`StatusBadge` 1 除外）；且 `Alert`/`Badge` 的 `color` 从没接 Nomi token（§1.4b） |
| **`createTheme` + CSS 变量** | `src/theme/nomiTheme.ts`（字体指向 `var(--nomi-font-sans)`、radius/spacing/fontSize 全接 `nomiDesignTokens`） | — | — |
| **Mantine 样式加载**：官方给 `styles.css`、按组件 `styles/<X>.css`、以及 **`styles.layer.css`（把全部 Mantine 样式包进 `@layer mantine`，专治与 Tailwind 的顺序冲突）**。<br>https://mantine.dev/styles/mantine-styles | `main.tsx:12-15` 只引 4 个组件 CSS | — | **全量 `styles.css` 走 `scripts/build-tailwind.mjs:44` 拼接进产物**，与 import 图分家、无门岗（§1.5）。**官方给的 `styles.layer.css` 我们没用**——这正是「Tailwind preflight 和 Mantine 谁赢」这类问题的官方解 |
| **`color` prop 接受任意 CSS 颜色**（不止 theme key）：`getThemeColor` 对非 theme key 原样透传，所以 `color="var(--nomi-accent)"` 是合法的<br>https://mantine.dev/styles/color-functions | 没用 | — | `StatusBadge`（`status.tsx:8-14`）把 tone 映射到 **Mantine 的 `gray/blue/green/yellow/red`**，而不是映射到 Nomi token——**这一格是「我们以为做不到、其实框架早就支持」** |
| **`virtualColor`**（随 light/dark 翻转的语义色）<br>https://mantine.dev/styles/virtual-color | 没用 | Nomi 自己的 token 翻转机制 | 两套翻转机制并存，Mantine 组件那半不跟 Nomi 的翻 |

### 2.2 Radix UI

| 它提供 | 我们用了 | 我们另写了 | 我们拆散了 |
|---|---|---|---|
| `@radix-ui/react-switch`（unstyled） | `src/ui/switch.tsx:2` | — | — |
| `@radix-ui/react-tooltip`（unstyled） | `src/design/tooltip.tsx:2` | — | — |
| **`@radix-ui/react-dropdown-menu`（未安装）**：`Root/Trigger/Portal/Content/Item/Group/Label/Separator/CheckboxItem/RadioGroup/RadioItem/**Sub/SubTrigger/SubContent**/Arrow`；**typeahead 是一等公民**（每个 `Item` 有 `textValue` prop）；Floating UI（`side/align/sideOffset/collisionPadding/avoidCollisions`）+ 暴露 `--radix-*-available-width/-height/-trigger-width` CSS 变量；状态走 `data-state="open\|closed"` / `data-highlighted` / `data-disabled`；零默认 CSS；`asChild` 可把行为挂到任意自有元素。<br>https://www.radix-ui.com/primitives/docs/components/dropdown-menu | — | 见上：77 处手写 | — |
| **`@radix-ui/react-context-menu`（未安装）** | — | `NodeContextMenu` / `FrameContextMenu` / `TimelineContextMenu` | — |
| **`@radix-ui/react-dialog`（未安装）**：`onEscapeKeyDown` / `onPointerDownOutside` / `onInteractOutside` / `onCloseAutoFocus` 细粒度钩子 | — | 32 文件手写 | — |

> Radix 这一栏「我们拆散了」全空，不是巧合：Radix 的用法（unstyled 行为 + 我们的 token className）**天然贴合 token-only 纪律**，没有第二套样式系统要摆平。这条观察直接决定了 §3 的选型。

### 2.3 四列表读完的三条结论

1. **「我们另写了」那一栏，几乎全是 Mantine 已经提供的东西。** 最刺眼的是 Menu：主题里配好了、一次没用、另手写 77 份。
2. **「我们拆散了」那一栏，全是 Mantine 特有的**——因为 Mantine 是「带样式的组件库」，它的样式系统和我们的 token-only Tailwind 是两套，每接一个组件就要在接缝上打一个补丁（`tc-*` 钩子类、`DesignButton` 覆写高度、`build-tailwind.mjs` 拼 CSS）。这些补丁没有一个是被门岗守着的，所以它们**一个个都烂了**（§1.4 / §1.5 / §1.6）。
3. 所以边界该这么画：**Mantine 留在「已经在用、且带样式也无所谓」的地方**（表单、Notifications、theme、`FocusTrap`/`Portal` 这些 headless 件）；**新的交互原语走 Radix**（unstyled，接缝为零）。

---

## 3. R20 build-vs-buy 闸：每个原语过三问

> 三问：① 是通用问题吗？② 同类产品怎么做（实查）？③ 在护城河上吗？
> 不在护城河上又碰体验一致性的 → 用标准实现；在护城河上的 → 自研到底。

### 3.1 Menu —— **别自研。买 Radix `DropdownMenu` + 一层 40 行的换肤壳。**

任务书直接问了这个问题，我给真判断：

| 问 | 答 |
|---|---|
| ① 通用问题？ | **是，而且是教科书级通用。** 菜单的难点全在 WAI-ARIA menu 模式：roving tabindex、↑↓/Home/End/typeahead、Esc 逐层关、outside-click 的 pointerdown vs click 语义、Floating UI 的 flip/shift/避让、focus 归还。**没有一条和「AI 视频创作」有关。** |
| ② 同类产品怎么做？ | 全都是买。Radix DropdownMenu 是当前事实标准（有 submenu + typeahead）；Mantine 自己也不手写，它的 Menu 就是 Popover(Floating UI) + 一套键盘 hook。我们仓库自己的 `src/ui/switch.tsx` 和 `src/design/tooltip.tsx` **已经是这个模式**（Radix 行为 + 我们的 token className），跑得好好的。 |
| ③ 在护城河上？ | **完全不在。** 没有任何用户因为「Nomi 的下拉菜单是自研的」而选择 Nomi。 |

**判断：`WorkbenchMenu` 应该是一个薄壳，不是一个实现。**

- 行为 100% 买：`@radix-ui/react-dropdown-menu`（新增 1 个依赖，与仓库既有的 2 个 Radix 包同族，不是引入新流派）。
- 我们只写：`src/design/menu.tsx`，约 40 行——把 `DropdownMenu.Content/Item/Separator/Label` 各套一层，塞进 Nomi 的 token className（`bg-nomi-paper` / `rounded-nomi` / `text-body-sm` / `data-[highlighted]:bg-nomi-ink-05`），并把 `zIndex` 接到 `NOMI_OVERLAY_Z_INDEX.popover`（`src/design/overlayLayers.ts`）。
- 右键菜单（3 处 context menu）走 `@radix-ui/react-context-menu`，同一层壳复用样式。

**为什么不是 Mantine `Menu`（它已经在依赖里、零成本）——这是本方案里最难的一刀，理由三条：**
1. **它没有 submenu**（7.x 没有 `Menu.Sub`，8.0 才有）。`scene3dToolbar.tsx`（16 处 menuitem）和 `CategoryTree.tsx`（11 处）已经是多层结构。为它升 Mantine 大版本，得走「变动四步协议」，代价远大于加一个 Radix 包。
2. **20 个手写菜单里，14 个住在画布 / 时间轴 / 节点工具条**——全站视觉最密、token 最严的地方。往那儿塞一个自带 CSS 的组件库，等于把 §2.3 结论 2 的接缝问题再复制 14 份。Radix 零 CSS，没有接缝。
3. **Radix 的 `data-[state=open]` / `data-[highlighted]` 就是 Tailwind variant**，样式全部写在 className 里，`check:tokens` 直接管得到；Mantine 的样式在 hashed class 里，门岗看不见。

诚实的反面：如果只看那 6 个「一层、四五个选项、不在画布上」的简单菜单，Mantine `Menu` 确实能白嫖。但**两套菜单库并存 = 并行版（违反 P1）**，必须二选一，而只有 Radix 能覆盖全部 20 个。

#### 3.1.1 选 Radix 之前实查过的四个替代（R5，查于 2026-09-07）

| 候选 | 当前版本 / 日期 | submenu | typeahead | 判断 |
|---|---|---|---|---|
| **Radix Primitives** | `react-dropdown-menu` **2.1.24**（2026-07-24）、`react-context-menu` **2.3.7**（同日） | ✅ | ✅ | **选它** |
| **Base UI**（Radix / Floating UI / MUI 原班人马的接棒项目，已 GA） | `@base-ui/react` **1.8.0**（2026-09-04），月度节奏 | ✅ | ✅ | 更活跃，但见下 |
| Headless UI | `@headlessui/react` 2.2.10（2026-04-07，近乎停滞） | **❌ 没有** | ✅ | 出局 |
| Ark UI | `@ark-ui/react` 5.39.1（2026-08-28） | ✅ | ✅ | 可用，但是第三套内核 |
| React Aria Components | 1.21.1（2026-09-04） | ✅ | ✅ | 样式钩子是 render-prop/`data-*` 混合，Tailwind variant 写法啰嗦 |

**「Radix 是不是已经不推荐了」——实查结论：没有任何 deprecation 信号。** `radix-ui/primitives` 近 60 天 93 个 commit（最后一次 2026-07-31），shadcn/ui 明确说明「Radix 未废弃，更新对 Radix 和 Base UI 同时发布」。<br>
https://www.npmjs.com/package/@radix-ui/react-dropdown-menu · https://github.com/radix-ui/primitives/commits · https://ui.shadcn.com/docs/changelog/2026-01-base-ui · https://base-ui.com/react/components/menu

**为什么不直接上更新的 Base UI**：我们已经在用 Radix 的 `switch` + `tooltip`，它们和 Radix menu **共用同一套 `Popper` / `DismissableLayer` / `FocusScope` / `Presence` 内核**——加菜单等于零新内核。换 Base UI 则是在同一个 Electron 渲染层里让两套 portal / focus / dismiss 逻辑并存，**浮层叠放与焦点抢夺正是这类混用最典型的坑**（而我们刚在 §1.1/§3.2 花力气收敛的就是这一族）。真要迁 Base UI，正确做法是 switch/tooltip/menu 一起整体迁，不是现在混着用。

**唯一要让用户知道的取舍**：Radix 的维护是**阵发式**的（2026 年 4–7 月单周最高 45 commit，之后 5 周为 0；open issue 201 / PR 148）。对 dropdown/context menu 这种 API 已冻结的成熟组件可以接受；**哪天要 Combobox / 多选，才是重新评估 Base UI 的时点**。

### 3.2 Dialog 壳 —— **别做一个 God 组件。把 B3 那套「行为钩子」抽出来。**

**先说 B3 的先例，本方案在它之上长，不推翻它。**
`SpendConfirmDialog.tsx:32-34` 的原话是：手写壳保留，因为「倒计时 / 三种宽度 / 滚动内容区 + 固定 footer 是 Mantine Modal 结构给不了的」；然后**只补齐模态该有的四件事**（Esc / 焦点陷阱 / 返回焦点 / `role`+`aria-modal`+`aria-labelledby`），并把 Esc 让位规则抽成共用原语 `src/design/useOverlayEscape.ts`。

这个判断**方向完全正确，并且已经证明可行**——它没有换掉结构，只换掉了「每个人各抄一遍 keydown」。

> 一处需要向用户说明的更正：Mantine 的 `Modal.Root` compound API **其实能**做到「完全自定义宽度和滚动结构、只借用 focus trap + portal + esc」（官方文档核实，见 §2.1）。所以 B3 注释里「Mantine Modal 结构给不了」这句，严格讲对扁平 `Modal` 成立、对 `Modal.Root` 不成立。
> **但结论不变**：走 `Modal.Root` 会把 Mantine 的 CSS 一起拖进来（§1.5 那条没人守的接缝），而 B3 现在的写法（Mantine `FocusTrap` 当 headless 件 + 我们自己的 `useOverlayEscape` + 我们的 `BodyPortal`）**接缝为零、且已经在跑**。所以：**照 B3 的路走，不改道。**

| 问 | 答 |
|---|---|
| ① 通用问题？ | 行为部分（focus trap / esc / 返回焦点 / 层级让位）是；**结构部分不是**——「倒计时 + 滚动内容区 + 固定 footer + 三种派生宽度」是 Nomi 的产品形态。 |
| ② 同类产品怎么做？ | 正是这种「行为买、结构自持」的拆法：Radix Dialog、Mantine `Modal.Root`、headlessui `Dialog` 都是把行为做成 Root、把结构交给调用方。 |
| ③ 在护城河上？ | 行为不在；结构在（花钱确认卡、合同卡是产品的核心交互）。 |

**判断：新建 `src/design/dialogShell.tsx`，只出行为，不出结构。**
```
useDialogShell({ ref, open, onClose })  →  返回要摊到壳上的 props（role/aria-modal/tabIndex）
                                           内部 = useOverlayEscape + FocusTrap + 返回焦点 + NOMI_OVERLAY_Z_INDEX
```
调用方继续自己写 `fixed inset-0` 和内容布局。**32 个手写 dialog 一个都不用改结构，只用把「四件事」换成一行 hook。**

### 3.3 Spinner —— **不做新东西，也不强行合并。**

| 问 | 答 |
|---|---|
| ① 通用问题？ | 是，但**我们已经有答案了**：`NomiLoadingMark`（`src/design/identity.tsx:113`）是品牌不变量，实验室 `primitivesActions/states/01-workbench.tsx:47` 已经写了断言守着它。 |
| ③ 在护城河上？ | 品牌标记算半个（转圈的是 Nomi 的 logo mark，不是通用 spinner）。 |

**判断：15 处 `animate-spin` 里，只有 7 处该收口。**
- 收：2 处手搓 CSS 边框环（`BrowserAssetPopoverParts.tsx:114,187`）+ 5 处 `IconLoader2` → 全部换 `NomiLoadingMark`。
- **不收**：5 处 `IconRefresh` 就地旋转（`ComfyuiLocalCard.tsx:395` / `LocalModelCard.tsx:249,288` / `ComfyuiPresetSection.tsx:206` / `NodeRecoverableReport.tsx:73` / `StoryboardFrameActions.tsx:212`）——这是「**这个按钮正在重试**」，语义是「刷新图标在转」，不是「页面在加载」。换成品牌 mark 反而丢信息。
- 1 处是 `NomiLoadingMark` 自己，1 处是确定性进度环（`CardCommon.tsx:200`），1 处是实验室断言。

这一条是**「看起来该收口、其实不该」的范例**，写进 §5。

### 3.4 零调用件（Pagination / Alert / Badge / Table / Drawer / PageShell）—— **删，不是修。**

| 问 | 答 |
|---|---|
| ① 通用问题？ | 是。② 同类产品怎么做？ | Mantine 自己就有，随时能再包一层。③ 在护城河上？ | 不在。 |

**判断：六个全仓零调用、且已被实验室证明是坏的（§1.4）。一个没人调用的坏组件不是债，是死码。**
按 P1（加新必删旧）和本轮 A2 的同一把尺子——删。哪天真要分页，30 分钟重新包一层（且那时会有真实调用点来验它）。

---

## 4. 分阶段路线：五刀，每刀独立可交付

> 不给 all-or-nothing。每刀单独有价值、单独可 revert、单独能停。

### 刀 0 · 说真话（半天，零风险，无依赖）

| 做什么 | 影响面 |
|---|---|
| 删 6 个零调用件（`DesignPagination`/`DesignAlert`/`DesignBadge`/`DesignTable`/`DesignDrawer`/`DesignPageShell`）+ 对应实验室屏格 | `src/design/navigation.tsx`(删)、`tables.tsx`(删)、`layout.tsx`(删)、`overlays.tsx`(删一半)、`status.tsx`(删两个)、`index.ts`、`src/devlab/designLab/primitivesSurfaces/states/01-status.tsx`+`03-structure.tsx` — **约 9 文件** |
| 删 17 个 `tc-*` 死钩子类（§1.6，全仓零 CSS） | `src/design/` 内 8 文件 |
| 改 `src/design/README.md`：删掉不存在的 `PanelCard`/`InlinePanel`，把「Current primitives」改成真实清单 | 1 文件 |
| 改 `AnchoredPopover.tsx:7` 和 `emptyState.tsx:5` 的注释：把「全站唯一」改成真话 + 指向路线 | 2 文件 |

**单独价值：新人照 README / 照注释写，不会再写出第五套。** 这是后面每一刀的前提——现在连「有几个零件」都数不准。
**验证**：`check:filesize` + 实验室基线重录（少几格）。零真机走查需求。

### 刀 1 · 菜单原语 + 三个最高频菜单（2-3 天）

| 做什么 | 影响面 |
|---|---|
| 装 `@radix-ui/react-dropdown-menu` + `@radix-ui/react-context-menu`；写 `src/design/menu.tsx`（约 40 行换肤壳）+ 实验室新增 `primitives-menu` 屏 | 新增 2 文件 + `index.ts` |
| 迁 3 个：`NodeContextMenu.tsx`、`TimelineContextMenu.tsx`、`CanvasToolbar.tsx` | 3 文件（**高风险面：画布 + 时间轴**） |

**单独价值（用户能说出来的）**：画布右键菜单和时间轴右键菜单从此**能按 Esc 关、能按 ↑↓ 选、不会被面板边缘裁掉**。这三处是全 App 右键频率最高的地方。
**依赖**：无（刀 0 不是硬前置，但先做刀 0 会省一次返工）。
**验证**：实验室基线兜外观；**画布/时间轴必须真机走查（R13）**——右键菜单的位置、避让、和 React Flow 的事件竞争（R23：画布只允许一个交互内核，菜单必须证明不抢 React Flow 的 pointer 事件）。

### 刀 2 · 菜单迁完 + 门岗（3-4 天）

| 做什么 | 影响面 |
|---|---|
| 剩余 17 文件迁到 `WorkbenchMenu` | **17 文件**；高风险：`scene3dToolbar.tsx`(16 处)、`CategoryTree.tsx`(11)、`NomiBrowserDialogView.tsx`(8)、`WhiteboardLeaferCanvas.tsx`(5) |
| `check:tokens` 加棘轮：className/JSX 里新增手写 `role="menu"`/`role="menuitem"` 当场红，基线随迁移递减到 0 | `scripts/` 1 文件 + baseline |

**单独价值**：菜单手感全站一致；且**这条不一致再也回不来了**（R28：防线建在最早能拦住的那层）。
**依赖**：刀 1。
**验证**：3D 导演台、白板、素材浏览器各走一条真机走查（这四个是重交互区，实验室基线兜不住）。门岗先验「会红」再落基线（R17）。

### 刀 3 · 对话框行为壳（2-3 天）

| 做什么 | 影响面 |
|---|---|
| 新建 `src/design/dialogShell.tsx`（`useDialogShell`，把 B3 的四件事收成一份） | 1 新文件 |
| 先迁 5 个「用 `z-[9999]` 绕过分层契约」的：`ScreenshotCropOverlay.tsx:97`、`NodeMediaPreviewDialog.tsx:57`、`NodeShotCutPanel.tsx:146`、`PanoramaViewer.tsx:574`、`AssetPreviewDialog.tsx:114`(`z-[10000]`) | **5 文件**（高风险：全在画布节点上） |
| `SpendConfirmDialog` 改成消费 `useDialogShell`（它是这套的原型，`z-[3500]` 常量也一并归位） | 1 文件 |

**单独价值**：这 5 个浮层现在**盖得住破坏性确认框**（`confirmation:9300`）——用户在预览大图时弹出「确认删除」，会被图盖住看不见。迁完这条消失。
**依赖**：刀 0（`overlayLayers` 常量整理）。
**验证**：必须真机走查「浮层叠浮层」——静态截图证明不了 z 序。

### 刀 4 · 词表统一（1-2 天，纯机械）

| 做什么 | 影响面 |
|---|---|
| 语义色轴统一叫 `tone`（值域 `neutral\|accent\|success\|warning\|danger`）；`StatusBadge` 的 tone 映射改成 Nomi token（Mantine `color` 接受 `var(--nomi-*)`，§2.1 已核实） | `src/design/` 约 6 文件 + 调用点 |
| 尺寸轴统一叫 `size`，值域收成 `xs\|sm\|md` = 24/28/32，四张表合成一张 `CONTROL_HEIGHT` 常量表 | `actions.tsx`/`NomiSelect.tsx`/`searchInput.tsx`/`NomiSegmented.tsx` + 调用点 |
| `DesignButton` 的死 `size` prop：要么接上、要么从类型里删（现在传了没用是在说谎） | `actions.tsx` |
| `check:vocabularies` 登记这两个词表（它已经是 AST 扫词表的门岗） | `scripts/` |

**单独价值**：「所有紧凑控件高一点」从改四处变成改一处。
**依赖**：刀 0（删完零调用件后词表小一半）。
**验证**：实验室基线（这刀是纯视觉，走查不是必需）。

### 明确不在路线里的（见 §5）

`DesignButton` vs `WorkbenchButton` 的 63:100 合并、`DesignEmptyState` 的 22 个"重复"、15 处 spinner 全收口——**都不做**，理由在下一节。

---

## 5. 明确写出「不做什么」

> 这一节和路线同等重要。**看起来该收口、但有正当理由保持现状的**，写清楚，免得下一轮又被当成债扫一遍。

### 5.1 不把 32 个手写 dialog 收进 `DesignModal`（B3 的判断是对的，本方案沿用）

`SpendConfirmDialog` 的结构（倒计时 + 三种派生宽度 + 滚动内容区 + 固定 footer）是产品形态，不是"没来得及用组件库"。**收口该收行为，不该收结构。** 刀 3 只给 hook，不给壳。

### 5.2 不合并 `DesignButton`(63) 与 `WorkbenchButton`(100)

这两个不是同一个东西的两份实现：
- `WorkbenchButton` 服务的是**画布/时间轴/预览**——密度优先、28/32px、纯 Tailwind token、无 Mantine 依赖。
- `DesignButton` 服务的是**设置/引导/分享**这些 Mantine 表单周边——需要 Mantine 的 `component` / 表单集成 / Modal 内联。

强行合并要么把 Mantine 依赖拖进画布（§2.3 结论 2 的接缝，14 个高密度文件），要么让设置页失去 Mantine 表单集成。**代价大于收益，先别动。**
不过 §4 刀 4 会修掉一条真问题：`DesignButton` 的 `size` prop 传了不起作用（`actions.tsx:59` 写死 `h-8`）——那是在说谎，要么接上要么删掉。

### 5.3 不把 22 个"并行空态"收进 `DesignEmptyState`

数出来的 22 个里，绝大多数不是"另写了一个居中 icon+标题+说明"，而是**形态本来就不同**：
- `CanvasEmptyState.tsx`：全画布的首次引导画面，带插画和多个入口，不是一个空态块。
- `NodeEmptyState.tsx`（`compact?: boolean`）：节点卡内 120px 见方的占位，`DesignEmptyState` 的 `py-20` 塞不进去。
- `AgentPanelV4Empty.tsx`：Agent 面板的开场建议卡片列表。

**真正该收的只有 3-4 个**（`PromptLibraryPanel` / `SkillLibraryPanel` / `WorkflowLibraryContent` 的过滤无结果态）。收益太小，不值得单开一刀；**顺手在刀 4 里带掉，或者干脆不做**。真正该做的是把 `emptyState.tsx:5` 那句"已收口"的注释改成真话（刀 0 已含）。

### 5.4 不统一 15 处 spinner

见 §3.3：5 处 `IconRefresh` 就地旋转表达的是"这个按钮正在重试"，和"内容正在加载"是两个语义。**收成一个反而丢信息。**

### 5.5 不升 Mantine 大版本换 `Menu.Sub`

7.13 → 8.x 是跨大版本，要走「变动四步协议」（探针 → 只升不改 → 薄片迁移 → 事后四列表），代价远大于加一个 Radix 包；而且升上去还是"带样式的菜单进画布"（§3.1 理由 2）。

### 5.6 不动 `AnchoredPopover` 的存在

它解决的是一个真问题（Portal 逃出 `overflow:hidden` 裁切，注释里那段"三样常用证据全都看不出来"是血的教训）。刀 1/刀 3 之后它的调用点会变少，但**不删**——`TimelineTransitionPicker` 那种"贴住轨道上一个像素级锚点"的场景，Radix 的 anchor 模型不如它直接。只改注释里"全站唯一"那句谎话。

### 5.7 不动 §1.5 那条 CSS 拼接接缝（本轮不改，但要登记）

`build-tailwind.mjs` 拼 Mantine CSS 这件事该修（官方给了 `styles.layer.css`），但它牵动整个构建产物和全部视觉基线，**不能塞进这条路线**。先按 §6 的 P0 定位清楚 `DesignPagination` 的根因；如果根因确实在这条接缝上，单开一刀，配全量视觉基线复核。

---

## 6. R3 决策对比表：三条路

**你在纠结的核心那一件事，一句话：**
> **要不要把「界面像不像一个东西」从「每个人写的时候记不记得」变成「不用这个零件就写不出来」——代价是 8-12 个工作日不出新功能，而且必须动画布右键菜单这种最高频的交互。**

| | **A · 全做（刀 0-4）** | **B · 不做** | **C · 只做一半（刀 0 + 刀 1 + 刀 3）** |
|---|---|---|---|
| 工期 | 8-12 天 | 0 | 4-6 天 |
| 触及文件 | 约 45 个（含 22 个高风险交互面） | 0 | 约 20 个 |
| **用户看到什么** | 全站菜单/弹层手感一致：Esc 都能关、↑↓ 都能选、浮层不再互相盖 | 现状：有的菜单能 Esc 有的不能，预览大图会盖住删除确认框——**每个都很小，加起来是"这软件有点糙"** | 最高频的画布/时间轴菜单 + 5 个越界浮层修好；剩下 17 个菜单仍不一致 |
| **代价** | 8-12 天不出新功能；两次真机走查密集期；画布/3D/白板各有回归风险 | 0 直接代价。**真代价是复利**：每新加一个面板就多一份手写菜单，现在 20 个，三个月后 30 个，迁移成本线性涨 | 中；但**留下一个半成品状态**——两套菜单并存直到刀 2 补上（临时违反 P1，须写进欠账登记并定到期日） |
| **防复发** | ✅ 刀 2 的 `role="menu"` 棘轮 + 刀 4 的 `check:vocabularies` 登记，**这条不一致再也回不来** | ❌ 门岗仍然只数颜色 | ⚠️ 没有门岗（棘轮在刀 2）——手写菜单还会继续长 |
| 回滚 | 每刀独立 commit，按刀 revert | — | 同左 |

**我的建议：C 起步，把刀 2 当成 C 的必选续集而不是可选项。**
理由是 D1（从用户摩擦出发）：刀 1 + 刀 3 覆盖的是**用户最常碰的那两处**（画布右键、浮层遮挡），4-6 天就能拿到八成的可感知收益。
但**必须现在就说清楚**：C 停在那里 = 两套菜单并存 = 并行版（违反 P1）。所以 C 不是"做一半就收工"，是"分两批做完，中间可以插别的活"。**真要收工在一半，那不如选 B**——留一个并行版比什么都不做更糟。

---

## 7. 影响面清单与验证策略汇总

| 刀 | 文件数 | 高风险面 | 实验室基线兜得住 | 必须真机走查（R13） |
|---|---|---|---|---|
| 0 | ~12 | 无 | ✅ 全部 | 否 |
| 1 | 5（新 2 + 改 3） | **画布 · 时间轴** | 外观可以 | ✅ 右键菜单位置/避让/不抢 React Flow pointer（R23） |
| 2 | 18 | **3D 导演台 · 白板 · 素材浏览器 · 侧栏树** | 外观可以 | ✅ 四处各一条 |
| 3 | 6 | **画布节点浮层** | ❌ 兜不住（z 序静态截图看不出） | ✅ 浮层叠浮层 + 破坏性确认框可见性 |
| 4 | ~10 | 无 | ✅ 全部 | 否 |

**共同门（每刀都要）**：`pnpm run gates` 全过（R11/R22）；新门岗先验「会红」再落基线（R17）；实验室基线由用户拍板才算数（UI 交付定义 = 设计实验室截图拍板 + 视觉基线绿）。

**实施前的 P0（不属于任何一刀，10 分钟）**：
在真实浏览器里量一次 `DesignPagination` 当前页的 `getComputedStyle(el).backgroundColor` 与 `.borderWidth`，定位 §1.4(a) 的根因——是 CSS 层叠（则 §5.7 那条接缝要提前）、还是别的。**根因没定之前不许改任何 CSS（P2）。** 顺带量 `DesignAlert` 的 `--alert-bg` 实际取值，验证 §2.1「`color` 接受 `var(--nomi-*)`」这条在我们这套 CSS 加载路径下是否成立。

---

## 8. 不动项

- 本文档只出方案。**任何生产代码、`tailwind.config.ts`、`src/design/`、`src/devlab/`、`docs/design/nomi-design-system.md` 本轮都不动。**
- 暗色视觉基线（独立一轮，见上游方案 §2）。
- §5 列的七条「不做什么」。
- Mantine 大版本升级（§5.5）。

## 9. 回滚

本文档若被采纳，实施按刀 0-4 各自独立 commit / 独立 PR；任一刀出问题按 commit 粒度 revert，互不牵连。刀 1 与刀 2 之间若停工，须在 `docs/DELIVERY-LEDGER.md` 登记「两套菜单并存」的临时并行版与到期日（P1 例外须有到期日，不许无限期挂账）。
