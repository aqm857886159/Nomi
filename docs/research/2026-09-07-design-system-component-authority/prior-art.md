# 「先查别人」报告：组件权威方案的四个「要不要自己造」（2026-09-07）

> 状态：📎 长期参考（R27 §16 必交物，随对应方案结案）
> 对应方案：[`docs/plan/2026-09-07-design-system-component-authority.md`](../../plan/2026-09-07-design-system-component-authority.md)
> 分支 `claude/design-system-optimization-b44d66`。本报告只回答「别人做过没有」，不替方案做实施决定。
> 依赖侧一律读 `node_modules` 实物（版本从 `pnpm-lock.yaml` 读，不读 `package.json` 的 `^` 范围）；仓库侧一律 `grep` 实扫。
> 查不到的明写「查不到」——它和「别人没做过」是两件事。

## 要回答的四个问题

1. **菜单原语该买还是自研，买谁**（方案 §3.1 / 刀 1-2）——77 处手写 `role="menu"`，依赖里真的没有能用的吗？
2. **对话框该买壳还是只抽行为**（方案 §3.2 / 刀 3）——32 个手写 `role="dialog"`，生态的拆法是什么？
3. **零调用 `Design*` 件该删还是该修**（方案 §3.4 / 刀 0）。
4. **「一堆手写菜单要不要收成组件」真实开发者怎么谈**（TikHub 一层）。

---

## ① 菜单：依赖里「有一半」，生态里买是共识，结论是买 Radix

### 依赖里已有？——**这一格方案写错了，但结论不变（重要更正）**

- 实际装着的是 **`@mantine/core` 7.17.8**，不是方案 §2 抬头写的 7.13.1（`^7.13.1` 是范围，实物看锁文件）：[`pnpm-lock.yaml:1567`](../../../pnpm-lock.yaml:1567) `'@mantine/core@7.17.8'`、[`node_modules/@mantine/core/package.json:3`](../../../node_modules/@mantine/core/package.json:3) `"version": "7.17.8"`。
- **7.17.8 的 `node_modules` 里 submenu 的代码是在的**：`MenuSub` / `MenuSubTarget` / `MenuSubDropdown` / `MenuSubItem` 四个目录都在，[`node_modules/@mantine/core/lib/components/Menu/MenuSub/MenuSub.d.ts:20`](../../../node_modules/@mantine/core/lib/components/Menu/MenuSub/MenuSub.d.ts:20) 有 `export declare function MenuSub(...)`。
- **但它没有出口**：[`node_modules/@mantine/core/lib/components/Menu/index.d.ts:1`](../../../node_modules/@mantine/core/lib/components/Menu/index.d.ts:1) 起的 6 行导出里没有任何 `Sub`，包顶层也搜不到 `MenuSub`。运行时实测（`node -e "const m=require('@mantine/core')"`）：`m.MenuSub === undefined`，`m.Menu.Sub === undefined`，`Object.keys(m.Menu)` = `extend,withProps,classes,displayName,Item,Label,Dropdown,Target,Divider`。
- ⇒ **方案 §3.1 理由 1「7.x 没有 submenu」的结论成立，但机制说错了**：不是「8.0 才加的」，是**代码在 7.17 里就随包发了、只是没接出口**。这个区别有实际后果——它意味着「等一个 7.x 补丁版把 Sub 导出来」是有可能的（成本远低于大版本升级），方案 §5.5「不升 Mantine 大版本」的论证应当把这条列为一个已知的、要观察的旁路，而不是当成不存在。**本报告不替方案改判断，只把事实摆正。**
- Mantine `Menu` 已经在主题里配好了 defaultProps（`radius`/`shadow`/`zIndex`）：[`src/theme/nomiTheme.ts:221`](../../../src/theme/nomiTheme.ts:221)。
- Radix 侧：装着 `@radix-ui/react-switch@1.2.6` 与 `@radix-ui/react-tooltip@1.2.11`，**没有** dropdown-menu / context-menu / dialog（`ls node_modules/@radix-ui/` 只有这两个）。但 tooltip 已经把菜单要用的内核全拉进来了：[`node_modules/@radix-ui/react-tooltip/package.json:17`](../../../node_modules/@radix-ui/react-tooltip/package.json:17) `@radix-ui/react-dismissable-layer@1.1.14`、[`:19`](../../../node_modules/@radix-ui/react-tooltip/package.json:19) `@radix-ui/react-popper@1.3.2`，另有 `react-portal`/`react-presence`/`react-slot`。⇒ 方案 §3.1「加菜单等于零新内核」这句**在依赖图上是可验证的事实**，不是修辞。

### 仓库里已有？

- 手写菜单实扫（`grep -rl 'role="menu"' src`）：**22 个文件**（方案写 20，我这把尺子更宽——把只有 `role="menu"` 容器、没有 `menuitem` 的也数进来了；量级一致）。
- **决定性的一条**：这 22 个文件里，**没有任何一个**出现 `ArrowDown`（`for f in $(grep -rl 'role="menu"' src); do grep -q ArrowDown "$f" && echo "$f"; done` → 零输出）。方案 §0 那张表里「20 份里没有一份做了方向键遍历」这句，本报告独立复扫确认。**这是 WAI-ARIA menu 模式的必答项，我们 22 份里 0 份答了**——它比「77 处重复」更能说明这不是风格问题。
- 已有的「买行为、不买结构」先例有两条，方案的两刀都是**扩它们**而不是新造：
  - [`src/design/tooltip.tsx:2`](../../../src/design/tooltip.tsx:2) `import * as TooltipPrimitive from '@radix-ui/react-tooltip'`、[`src/ui/switch.tsx:2`](../../../src/ui/switch.tsx:2) `import * as SwitchPrimitive from '@radix-ui/react-switch'`——**Radix 行为 + Nomi token className** 的模式在仓库里已经跑着。
  - [`src/design/useOverlayEscape.ts:18`](../../../src/design/useOverlayEscape.ts:18) 已有 **4 个消费者**（`UpdaterDialog.tsx` / `ProvenancePanel.tsx` / `SpendConfirmDialog.tsx` / `TimelineShortcutsDialog.tsx`）——方案 §3.2 的 `useDialogShell` 是这条路的延长线，不是第一次尝试。
- 浮层定位的现状：[`src/design/AnchoredPopover.tsx:7`](../../../src/design/AnchoredPopover.tsx:7) 自称「全站唯一一套浮层定位机制」，实际生产消费者 **2 个**（`AssetPickerPopover.tsx:11`、`TimelineTransitionPicker.tsx:41`，第三处是实验室屏），而 `getBoundingClientRect` 散在 **67 个文件**里。

### 生态里已有？

- **Radix Primitives DropdownMenu / ContextMenu**：`Sub/SubTrigger/SubContent` 是一等公民，`Item` 有 `textValue` 供 typeahead，定位走 `side/align/collisionPadding/avoidCollisions` 并暴露 `--radix-*` CSS 变量，零默认 CSS——<https://www.radix-ui.com/primitives/docs/components/dropdown-menu>、<https://www.radix-ui.com/primitives/docs/components/context-menu>。
- **Mantine `Menu` 自己也不手写**：它是 `Popover`(Floating UI) + 一套键盘 hook 的组合——<https://mantine.dev/core/menu>。⇒ 连「带样式的组件库」这一派也把菜单当买来的东西，没人认为它值得自研。
- **shadcn/ui 的构成本身就是答案**：它不是一个组件库，是「Radix 行为 + Tailwind 样式 + 代码进你自己的仓库」这一套配方的分发形式——<https://ui.shadcn.com/docs>。方案 §3.1 的「薄壳 40 行」正是这个配方，**不是我们发明的形状**。
- 方案 §3.1.1 另实查过 Base UI 1.8.0 / Headless UI / Ark UI / React Aria 的 submenu+typeahead 支持面与版本日期（[`docs/plan/2026-09-07-design-system-component-authority.md`](../../plan/2026-09-07-design-system-component-authority.md) §3.1.1，附 npm / GitHub / shadcn changelog 四条 URL）。**本报告没有复跑 npm registry**，只核对了它的仓库侧前提（Radix 两个包确实在用、确实共内核），那一格算「转引」不算「实查」。

### TikHub 自媒体里怎么说？

- **最对口的一条是「两派之争」**：「用了 10 年 AntD 之后，聊聊 UI 库的下一个十年」（抖音 · AnnatarHe / 异步聊技术，2026-05-15，<https://www.douyin.com/video/7640088811422141748>）。原文把选型拆成两个流派：「AntD 派回答的是『怎么更快交付』」，「ShadCN 派回答的是『怎么做对的事情』——把 UI 库从 dependency 变成你自己的代码」，并给出选择依据「品牌一致、性能可控、演进自由」。⇒ 这条**独立于我们的四列表，收敛到同一条分界**：带样式的库赢在交付速度，无头 + 自持代码赢在品牌一致与演进自由。Nomi 的处境（token-only 纪律 + 密度优先 + 画布里 14 个高密度菜单）正好落在后者那半边。
- **「Radix + Tailwind 做下拉」是有现成教程的**：「如何做好用又好看的下拉列表：Radix UI + Framer Motion + TailwindCSS」（B站 · Cali卡利卡索，2023-05-24，<https://www.bilibili.com/video/BV1Zh4y1o7Ew>）——方案 §3.1 那个「40 行换肤壳」在中文实践圈是熟路，不是我们要趟的新路。
- **shadcn = Tailwind + Radix 这条常识在中文圈已经普及**：「shadcn/ui 是 Vercel 的工程师推出的一款组件合集，建立在 Tailwind CSS 和 Radix UI」（小红书 · 博文视点Broadview，2024-12-10，<https://www.xiaohongshu.com/explore/67580255000000000402811a?xsec_token=YBEWPx_gCtrK91wjC3o8AiOUePGJJoWn5NDi8SUrxuXhk%3D&xsec_source=pc_search>）；「shadcn/ui 对 Vibe Coding 的核心价值在于降低审美落地的技术成本，保证设计一致性」（小红书 · Rico的设计漫想，2026-03-06，<https://www.xiaohongshu.com/explore/69aa358c000000001b01fc5e?xsec_token=YBKf-WG6kMtxKfcvUI7XPQzKblrSaD2f7NTIJrroF_uqs%3D&xsec_source=pc_search>）。
- **「右键菜单组件的封装」确实是个被单独讲的题**：抖音 · 渡一前端必修课，2026-05-05，<https://www.douyin.com/video/7634467698935696667>。**但这条只有标题**——TikHub 返回的正文与标题同串，拿不到它的论证内容。**如实记账：它证明「这是个公认要封装的东西」，不能拿来当任何技术判断的依据。**
- **没查到的**：48+48 条里**没有任何一条**讨论「Mantine vs Radix 该选哪个」、「Mantine 7 的 Menu 有没有 submenu」，也没有一条讲「一个仓库里 77 处手写菜单怎么迁」。⇒ 这两问在中文自媒体层是空的，如实记账，不假装引用别人。

### 结论 → **买（Radix），方案 §3.1 的判断成立**

三条独立证据指同一个方向：依赖图上加菜单是零新内核（tooltip 已拉进 popper + dismissable-layer）；仓库里 22/22 份手写菜单没有一份实现方向键，说明这条能力靠人写必漏；生态里连带样式的库自己都是买的。**唯一要更正的是理由 1 的机制**：Mantine 7.17 的 submenu 是「有代码没出口」而不是「没有」。

---

## ② 对话框：生态共识就是「行为买、结构自持」，方案 §3.2 是照抄不是发明

### 依赖里已有？

- Mantine `FocusTrap` 是独立可用的 headless 件，已在用：[`src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:2`](../../../src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:2) `import { FocusTrap } from '@mantine/core'`，挂在遮罩上（同文件 `:136`），配 `[data-autofocus]`。
- Radix `react-dialog` **未安装**（`node_modules/@radix-ui/` 只有 switch / tooltip 两个）。

### 仓库里已有？

- 手写 `role="dialog"` 实扫 **35 个文件**（`grep -rlE 'role="dialog"' src`；方案写 32，量级一致）。
- 行为已经被抽过一次：[`src/design/useOverlayEscape.ts:18`](../../../src/design/useOverlayEscape.ts:18)（4 个消费者，见 ①）。方案 §3.2 的 `useDialogShell` = 把「Esc + 焦点陷阱 + 返回焦点 + `role`/`aria-modal`」四件事收进同一个 hook，**是给已存在的东西补齐剩下三件**，不是新建一套。

### 生态里已有？

- **Radix Dialog** 的 API 形状就是「Root 只出行为、结构交给调用方」：`onEscapeKeyDown` / `onPointerDownOutside` / `onInteractOutside` / `onCloseAutoFocus` 全是行为钩子，`Content` 的内容完全由调用方写——<https://www.radix-ui.com/primitives/docs/components/dialog>。
- **Mantine `Modal.Root`** 是同一个拆法的另一种实现（`Modal.Root/Overlay/Content/Header/Body`，Root 提供 focus trap / scroll lock / esc / portal / transition）——<https://mantine.dev/core/modal>。⇒ 方案 §3.2 里那句「Mantine Modal 结构给不了」的自我更正是对的。
- ⇒ 三家（Radix / Mantine / Headless UI）**形状一致**：模态的可买部分是行为，不可买部分是结构。

### TikHub 自媒体里怎么说？

- **查不到。** 两轮共 96 条里没有一条讲对话框/模态的焦点管理或 Esc 语义。这一层在中文自媒体是空的，如实记账。

### 结论 → **用已有的拆法（行为买/抽、结构自持），不要 God 组件**

判断依据不是偏好，是三家框架**都只提供这一种落点**。方案 §3.2 与 §5.1 成立。

---

## ③ 零调用件：删是 P1 的直接推论，生态里没有反对意见

### 仓库里已有？

- `DesignPagination` / `DesignAlert` / `DesignBadge` / `DesignTable` / `DesignDrawer` / `DesignPageShell` 全仓零生产调用点（方案 §1.4 / §3.4 实扫）；`StatusBadge` 的语义色映射写死在 [`src/design/status.tsx:7`](../../../src/design/status.tsx:7) 的 `toneColorMap`：`neutral→'gray'`、`info→'blue'`、`success→'green'`、`warning→'yellow'`、`danger→'red'`——**全是 Mantine 原生色板 key，一个 Nomi token 都没有**（本报告实读，确认方案 §1.4b）。

### 依赖里已有？

- Mantine 的 `color` prop 接受任意 CSS 颜色（非 theme key 原样透传），所以 `color="var(--nomi-accent)"` 合法——<https://mantine.dev/styles/color-functions>。⇒ 方案 §4 刀 4 那句「我们以为做不到、框架早就支持」在文档层成立；**但它在我们这套 CSS 加载路径下成不成立没实测**，方案 §7 的 P0 已把它列进要量的两件事之一，本报告不越位。

### 生态里已有？

- 没有任何组件库/设计系统主张「保留零调用的破损组件」。这一问在生态层没有对立面可查，**不假装查到了**。

### 结论 → **删**（P1 加新必删旧的直接推论）。要分页时重新包一层，且那时会有真实调用点来验它。

---

## ④ 自媒体来源（TikHub）

两轮实抓，共 96 条，`scripts/research/tikhub-search.mjs`（key 只从 `TIKHUB_API_KEY` 读，未落盘、未进任何输出）：

| 轮次 | 关键词 | 附件 |
|---|---|---|
| 1 | `Radix UI 无头组件库 shadcn 右键菜单 组件封装` | [`tikhub/tikhub-search.md`](tikhub/tikhub-search.md) · [`tikhub/tikhub-search.json`](tikhub/tikhub-search.json) |
| 2 | `Mantine 组件库选型 Headless UI 无障碍 键盘操作 弹层 Portal` | [`tikhub-mantine/tikhub-search.md`](tikhub-mantine/tikhub-search.md) · [`tikhub-mantine/tikhub-search.json`](tikhub-mantine/tikhub-search.json) |

有信号的四条已写在 ① 里（AntD派vs ShadCN派 / Cali 的 Radix+Tailwind 下拉教学 / shadcn=Tailwind+Radix 两条 / 渡一「右键菜单组件的封装」标题）。

**信噪比要如实说**：96 条里绝大多数是「十个顶级 UI 组件库」这类安利清单、Vibe Coding 选型、以及 Flutter/QML/PyQt 等完全不相干平台的组件库——**关键词命中率约 4%**。中文自媒体这一层对「组件库怎么选」讲得很多，对「已有的一堆手写实现怎么收口」几乎不讲：这是**存量治理**的题，不是选型的题，而自媒体的读者面是从零开始的人。这条观察本身是有用的——**它说明这一族问题在公开资料里拿不到经验，只能靠我们自己的实扫和门岗**（支持方案刀 2 的 `role="menu"` 棘轮：靠人记得必漏，且没有别人的教训可借）。

---

## 结论汇总

| 题目 | 判断 | 一句话理由 |
|---|---|---|
| ① 菜单原语 | **买 Radix + 40 行换肤壳**（方案 §3.1 成立） | 依赖图上零新内核（tooltip 已拉进 popper/dismissable-layer）；22/22 份手写菜单 0 份实现 ArrowDown；连 Mantine 自己也是买的 |
| ①附 | **更正方案 §2/§3.1 的两处事实** | 实装是 7.17.8 不是 7.13.1；`MenuSub` 代码在 7.17 的包里但**没导出**（`Menu.Sub === undefined`），不是「8.0 才加」 |
| ② 对话框 | **只抽行为，不做壳**（方案 §3.2 / §5.1 成立） | Radix Dialog / Mantine `Modal.Root` / Headless UI 三家形状一致：行为可买、结构自持；仓库里 `useOverlayEscape` 已是这条路的第一步 |
| ③ 零调用件 | **删** | P1 直接推论；`StatusBadge` 的 tone 映射实读确认全是 Mantine 色板 key |
| ④ 自媒体 | **两问有信号、两问空** | 「无头 vs 带样式」有直接对口的中文论述；「Mantine vs Radix」「77 处手写怎么迁」查不到——存量治理没有公开经验可借 |

## 诚实记分

- **真跑了的**：`node_modules` 逐文件实读（Mantine 7.17.8 的 `Menu/index.d.ts` 导出面、`MenuSub.d.ts`、Radix tooltip 的 dependencies）；`node -e require('@mantine/core')` 运行时确认 `Menu.Sub === undefined`；`grep` 实扫（22 个 `role="menu"` 文件、其中 0 个含 `ArrowDown`、35 个 `role="dialog"` 文件、67 个 `getBoundingClientRect` 文件、`useOverlayEscape` 4 个消费者、`AnchoredPopover` 2 个生产消费者）；TikHub 两轮 96 条实抓有附件。
- **只读没跑的**：Radix / Mantine / shadcn 的官方文档（读文档，没在本仓装 `react-dropdown-menu` 验证行为）；Mantine `color` 接受 `var(--nomi-*)`（读文档，**我们这套 CSS 加载路径下没实测**——归方案 §7 的 P0）。
- **转引没复跑的**：方案 §3.1.1 那张五候选对比表的版本号与发布日期（npm registry / GitHub commits），本报告只核对了它的仓库侧前提。
- **没覆盖到的**：`DesignPagination` 无选中态的根因（属方案 §7 的 P0，10 分钟浏览器实测，不在本报告范围）；Base UI 与 Radix 混跑的焦点/portal 冲突（方案 §3.1.1 的推断，**没有人实测过**，如果哪天真要迁 Base UI，那是一次独立的探针）。
