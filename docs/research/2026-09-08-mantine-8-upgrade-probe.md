# Mantine 7.17.8 → 8 升级探针（变动四步协议 ①）

> 状态：📋 方案待拍板 —— **零生产代码改动**，本篇只出决策，不改 `package.json`、不在本仓装 Mantine 8。
> 日期：2026-09-08 · 基线 `09a05ac04`（worktree `design-system-optimization-b44d66`）· 平台 darwin 25.5.0
> 服务对象：[`docs/plan/2026-09-06-stack-upgrade-react19-aisdk-tailwind4.md`](../plan/2026-09-06-stack-upgrade-react19-aisdk-tailwind4.md) §2.3(a) 与 §6 步骤②
> 实跑现场：`/private/tmp/claude-501/…/scratchpad/mantine-probe/`（`v7/` = 7.17.8、`v8/` = 8.3.18 两套隔离 npm 安装 + Playwright 渲染对照）
> 引用格式：仓库内相对仓库根；两套 npm 树用 `v7/` / `v8/` 前缀；外部一律给 URL。

---

## 0. 结论速览

| 问题 | 结论 | 一句话 |
|---|---|---|
| ① `cssVariablesResolver` 在 8 里还在吗 | **在，签名一字未改** | 本轮状态色收口**不会**因升级失效 |
| ② 破坏项命中我们哪些 | **风险在像素不在 API**；命中 8 个文件 | 唯一真 API 行为变更是 `Portal` 默认值翻转 |
| ③ `DesignPagination` 无选中态是 Mantine bug 吗 | **不是，8 也没修——根因在我们这边，已定位并证明** | `src/devlab/designLab.tsx:25` 重复 import `UnstyledButton.css` 把 Pagination 的样式盖掉了 |
| ④ 会碰坏状态色收口吗 | **不会**，但新增一族 `--mantine-color-disabled*` 需要一次判断 | 我们的四语义映射不碰 gray/dark，新 token 恰好落在 gray/dark 上 |
| ⑤ modals / notifications | **无破坏项** | 版本随 core 走 8.3.18；notifications CSS 零 diff |

**判断：该升，但不是为了修 ③。** 升级的收益是「脱离一个不再收修复的大版本 + 拿到 React 19 的中间可回滚点」，不是任何用户可见修复；③ 那条缺陷和 Mantine 版本完全无关，应该**在升级之前先单独修掉**（一行删除），否则它会混进升级的视觉基线红里，逼你重新二分一次。

---

## 1. 五问的实跑答案

### Q1 · `cssVariablesResolver` 在 8.x 还在不在、签名有没有变？

**在，且逐字相同。** 两棵树的 `.d.ts` 直接对读：

| | 7.17.8 | 8.3.18 |
|---|---|---|
| 类型定义 | `v7/node_modules/@mantine/core/lib/core/MantineProvider/MantineCssVariables/default-css-variables-resolver.d.ts:3`<br>`export type CSSVariablesResolver = (theme: MantineTheme) => ConvertCSSVariablesInput;` | `v8/…/default-css-variables-resolver.d.ts:3` —— **同一行、同一字** |
| 导出路径 | `@mantine/core` → `MantineProvider/index.d.ts:19` | 同 |
| Provider prop | `MantineProvider.d.ts:28 cssVariablesResolver?: CSSVariablesResolver` | `MantineProvider.d.ts:30`，同 |
| `ConvertCSSVariablesInput` | `{ variables; dark; light }` 三键 | 同（`interface` 三键一字不差） |

`convertCssVariables()` 的第二参从必填 `selector: string` 变成可选 `selectorOverride?: string`——那是 Mantine 内部函数，我们不调用，不影响。

**关键前提也仍然成立**（这才是 `src/theme/nomiTheme.ts:52-61` 注释里那两条根据）：

- `-light` / `-light-hover` / `-light-color` 一族仍然只定义在 scheme 作用域里：`v8/…/styles/default-css-variables.css:392` `:root[data-mantine-color-scheme='light'], :host([data-mantine-color-scheme='light'])`（v8 新增了 `:host(...)` 分支给 shadow DOM，`:root[...]` 那条原样保留）；`--mantine-color-red-light` 在 v7:289/420 与 v8:297/429 两处分别定义，结构一致。
- 属性名 `data-mantine-color-scheme` **没变** → `tailwind.config.ts:657` 的 `darkMode: ['selector', '[data-mantine-color-scheme="dark"]']` 安全。（注：立项书 §2.3(a) 写的是 `tailwind.config.ts:601`，现已漂到 657。）

结论：**`src/theme/nomiTheme.ts` 的 `nomiCssVariablesResolver` 升级后原样可用，一行不用改。**

---

### Q2 · 8.0 的破坏项命中我们哪些？

先把「我们真正 import 的东西」钉死（`grep -rn "from '@mantine/core'" src/`，非测试、非 devlab）：

| Mantine 组件 | 我们的文件 | 备注 |
|---|---|---|
| `ActionIcon` `Button` | `src/design/actions.tsx:1` | |
| `Alert` `Badge` `Progress` | `src/design/status.tsx:1` | |
| `Checkbox` `FileInput` `NumberInput` `SegmentedControl` `Switch` `TextInput` `Textarea` | `src/design/forms.tsx:1-16` | |
| `Modal` `Drawer` | `src/design/overlays.tsx:1` | |
| `Table` | `src/design/tables.tsx:1` | |
| `Pagination` | `src/design/navigation.tsx:1` | |
| `Combobox` `useCombobox` | `src/design/NomiSelect.tsx:3` | 24 个消费方，是 Select 的实际实现 |
| `ScrollArea` | `src/ui/browser/popover/BrowserAssetPopoverView.tsx:3` | |
| `Popover` | `src/workbench/generationCanvas/nodes/NodeCameraMoveControl.tsx:3` | |
| `Slider` | `src/workbench/generationCanvas/nodes/InlineParameterBar.tsx:4` | |
| `FocusTrap` | `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx:2` | |
| `Portal` | `SettingsDialog.tsx:3` `PromptPreviewOverlay.tsx:3` `HandbookPanel.tsx:8` `TaskCenterPanel.tsx:7` `ComfyuiWorkflowSettingsPage.tsx:17` | 5 处 |
| `MantineProvider` | `src/NomiAppProviders.tsx:2` `src/design/previewHost.tsx:18` | |

**没有** `Tabs` / `AppShell` / `Tooltip` / `Select` / `MultiSelect` / `Menu` 的直接 import——它们只在 `nomiTheme.ts` 里配了 `defaultProps`，零消费（`Menu` 的情况任务书已知；`Tabs`/`AppShell`/`Tooltip`/`Select` 同理）。**这四个的 8.0 破坏项对我们全部不成立。**

官方 8.0 破坏项清单（https://mantine.dev/changelog/8-0-0/ 实读）逐条对本仓：

| 8.0 破坏项 | 中不中 | 我们哪个文件 |
|---|---|---|
| 全局样式 import 拆成 `baseline` / `default-css-variables` / `global` 三份 | ❌ | `scripts/build-tailwind.mjs:21` 读整包 `@mantine/core/styles.css`。实测 v8 的整包**仍含全部三段**（`v8/…/styles.css` 前 25 行就是 reset）、且组件顺序不变（UnstyledButton `:799` 仍在 Pagination `:5172` 之前） |
| `@mantine/dates` 字符串日期 / `DatesProvider` 去 timezone | ❌ | 未装 |
| `Carousel` 需显式装 embla | ❌ | 未装 |
| `CodeHighlight` 改 adapter | ❌ | 未装 |
| `Menu.Item` 删 `data-hovered` | ❌ | 零 `Menu` 消费；仓里两处 `data-hovered` 是画布连线自己的（`generationCanvas.css:240/246`） |
| **`ScrollArea` 去掉 wrapper 的 `display: table`** | ❌ **立项书这条是错的** | 实读 `v8/…/styles/ScrollArea.css:61` **`display: table` 仍在**，与 v7:57 逐字相同。8.3.18 里真正的 ScrollArea 变化是新增 `[data-autosize] .m_b1336c6 { min-width: min-content }`——`BrowserAssetPopoverView.tsx:228` 没开 `autosize`，不命中 |
| **`SegmentedControl` 高度对齐 Input** | ✅ **中** | `v7→v8` padding 逐档下调：`--sc-padding-sm: 5px 10px → 3px 10px`（xs 3→2、md 7→4、lg 9→7、xl 12→10）。消费方 2 处：`OnboardingWizardAdvancedFields.tsx:137` 与另一处 |
| **Notification 默认间距变化** | ✅ **中（方向与立项书相反）** | v8 **删掉**了 `.m_a513464:where([data-with-icon]) { padding-inline-start: var(--mantine-spacing-xs) }`。我们的 toast 在 `nomiTheme.ts:Notification.styles.root` 里写死了 `padding: '10px 10px 10px 12px'`，**大概率被我们自己的 override 盖住**，但带 icon 的 toast 需要走查一眼 |
| `wrapperProps` 类型收紧（checkbox/radio/chip/input） | ⚠️ typecheck 待验 | `src/design/forms.tsx` 只透传 `...props`，未显式构造 `wrapperProps`；风险低 |

**立项书没写、但实测会咬的四条**（证据来自 `diff v7/node_modules/@mantine/core/styles/*.css v8/…`，34 个组件 CSS 有差异，下面只列命中我们的）：

| 新发现 | 变化 | 我们哪里 |
|---|---|---|
| **`Portal` 的 `reuseTargetNode` 默认 `false → true`** | `v8/…/esm/components/Portal/Portal.mjs:45-47` `const defaultProps = { reuseTargetNode: true }`（v7 是 `{}`）。5 个 Portal 从此**共用同一个 DOM 容器**，不再各建一个 | `SettingsDialog` / `PromptPreviewOverlay` / `HandbookPanel` / `TaskCenterPanel` / `ComfyuiWorkflowSettingsPage`。这是本次升级**唯一的真行为变更**（DOM 结构与兄弟顺序变了），走查里凡按 portal 容器定位的选择器都要复验 |
| **新增 `--mantine-color-disabled` / `-color` / `-border` 三个 token** | light = `gray-2` / `gray-5` / `gray-3`；dark = `dark-6` / `dark-3` / `dark-4`（`v8/…/default-css-variables.css:275-277,407-409`）。`Button` / `ActionIcon` / `Input` / `NumberInput` / `SegmentedControl` / `Slider` / `Menu` 的 disabled 态**全部改读这三个 token**，删掉了原来按 scheme 写死的 gray/dark | 所有 disabled 态像素会动一档：light 下 Button/ActionIcon 的 disabled 底色 `gray-1 → gray-2`（更深一档灰） |
| **`Switch` 结构改了** | 隐藏 input 从 `height:0;width:0` 改成 `height:100%;width:100%`（无障碍）；track 去掉 `border: 1px solid var(--switch-bd)`；light 未选中 track `gray-2 → gray-3`；`--switch-track-label-padding-*` 全档上调 | `DesignSwitch` **9 个消费方**（`CapabilityModeEditor.tsx` 4 处、`DirectScriptDraftForm.tsx:95`、`OnboardingWizard.tsx` 等）。⚠️ **立项书 §2.3(a) 写「不中，`src/ui/switch.tsx` 是 Radix」是错的**——`src/ui/switch.tsx` 确实是 Radix，但 `src/design/forms.tsx:1` import 的是 **Mantine 的 `Switch`**，两个都在用 |
| `Table` sticky header 重写 | v8 给 `[data-with-table-border] [data-sticky]` 加了 `position:sticky` + `::before` 分隔线 | `DesignTable` **全仓零调用**，只有实验室在陈列 → 只会红一张基线 |

另有 `Badge` / `ScrollArea` / `Combobox` / `Progress` / `Checkbox` / `Input` 的 diff 属于格式化、新增功能（vertical progress、submenu、`:has()` clear-section padding）或不命中的分支，不构成回归面。

---

### Q3 · `DesignPagination` 当前页没有选中态——是 Mantine 7 的 bug 吗，8 修了吗？

**都不是。8 一个字都没改，而根因在我们这边——已定位并用最小复现证明。**

三层证据，逐层排除：

**(a) 组件 CSS 逐字相同。** `diff v7/node_modules/@mantine/core/styles/Pagination.css v8/…` → **IDENTICAL**。`.m_326d024a:where([data-active]) { background-color: var(--pagination-active-bg); … }` 两版都在。

**(b) 渲染出来的 DOM 相同且正确。** `renderToStaticMarkup` 两版对照，`value=1` 与 `value=4` 都在正确的按钮上给出 `data-active="true" aria-current="page"`：

```
v7 value=4: …<button class="… m_326d024a …" data-active="true" … aria-current="page">4</button>…
v8 value=4: …（同）
```

所以「受控 value 没传」早就排除对了，`data-active` 一直是对的。

**(c) 带上仓库真实 CSS + 真实主题渲染，两版都是对的。** 用 `public/tailwind.generated.css` + 复刻 `nomiTheme`（`primaryColor:'dark'` / `primaryShade:{light:6}` / `nomiCssVariablesResolver`）起 Playwright 量计算样式：

| 版本 | 页码 1（active） | 页码 2（非 active） |
|---|---|---|
| 7.17.8 | `bg rgb(46,46,46)` `color rgb(255,255,255)` `border rgb(46,46,46) 1px` | `bg rgb(255,255,255)` `color rgb(0,0,0)` `border rgb(206,212,218) 1px` |
| 8.3.18 | **完全相同** | **完全相同** |

**深色实心 + 白字，选中态清清楚楚。所以库没问题、CSS 没问题、主题没问题。**

**(d) 根因：设计实验室自己把样式盖掉了。** 差别只剩实验室这一层。`src/devlab/designLab.tsx:25-28`：

```tsx
import '@mantine/core/styles/UnstyledButton.css'
import '@mantine/core/styles/CloseButton.css'
import '@mantine/core/styles/Notification.css'
import '@mantine/notifications/styles.css'
```

前三行是**冗余的**——`design-lab.html` 已经 `<link rel="stylesheet" href="/tailwind.generated.css">`，而那份产物里整包 Mantine CSS 已经含了这三个组件，且顺序正确（UnstyledButton `:773` 在 Pagination `:5028` 之前）。Vite 把这三个 import 注入成 `<style>` 挂到 `<head>` **末尾**，于是：

- `.m_87cf2631`（UnstyledButton）`{ background-color: transparent; border: 0; padding: 0; color: inherit }`
- `.m_326d024a`（Pagination control）`{ border: 1px solid; height/min-width: 32px; … }` 以及 `:where([data-active])` 那条

**两者特指度都是 (0,1,0)，同级比来源顺序——重复注入的 UnstyledButton 排在后面，赢。** Pagination 的边框、底色、选中底色全部被抹平，只剩纯文本，`value=1` 与 `value=4` 因此逐像素相同。

**最小复现（阳性对照）**：把这三份 CSS 原样追加到上面那张 v7 页面的 `</head>` 前，重量一次：

```
[{"t":"1","active":true, "bg":"rgba(0,0,0,0)","border":"0px","color":"rgb(0,0,0)"},
 {"t":"2","active":false,"bg":"rgba(0,0,0,0)","border":"0px","color":"rgb(0,0,0)"}, …]
```

透明底、0 边框、黑字，active 与非 active 完全一致——**和 `tests/ux/design-lab/__baselines__/primitives-surfaces/ps-13-pagination.png` 逐项吻合**（那张图里按钮**也没有任何边框**，这正是「不是 active 规则丢了，而是整个 control 样式被盖了」的指纹）。

**修法（不属于本步骤）**：删 `src/devlab/designLab.tsx:25-27` 三行冗余 import（整包已含）。⚠️ 第 28 行 `@mantine/notifications/styles.css` **不能删**——那是另一个包，不在整包里。`src/main.tsx:12-15` 有同样的四行，但生产入口 `index.html` 的 CSS 装配方式需另行核实后再动，**不要顺手一起改**。

**影响面比 Pagination 大**：这条盖的是所有 `UnstyledButton` 基类组件在实验室里的外观。凡是「实验室里看着比真机淡/没边框」的样张都要顺带复验。

**对「该不该升」的影响**：升级在这条上**收益为零**。而且顺序很重要——**先修这条、重录受影响基线，再升 Mantine**；反过来做，这条造成的基线红会和 Mantine 的像素红混在一起，等于自己毁掉步骤②的归因能力。

---

### Q4 · 升级会不会碰坏刚做的状态色收口？

**不会。** 三条都实测过：

1. **机制还在**（见 Q1）：`cssVariablesResolver` 签名不变、`-light` 家族仍在 scheme 作用域、`MantineProvider` 仍在运行时注入 `<style>`。`nomiCssVariablesResolver` 覆盖的 9 个变量名（`-light` / `-light-hover` / `-light-color` / `-filled` / `-filled-hover` / `-outline` / `-outline-hover` / `-6` / `-4`）在 v8 的 `default-css-variables.css` 里**全部仍然存在、名字未变**。
2. **色板语义没变**：12 个色名（red/pink/yellow/orange/green/teal/lime/blue/cyan/indigo/violet/grape）在 v8 全在，`variantColorResolver` 的契约未列入 8.0 破坏项，`theme.colors` 形状未变。
3. **不会产生第二条路径**：v8 新增的 `--mantine-color-disabled` / `-color` / `-border` 只从 `gray-*` / `dark-*` 取值——而我们的映射表**刻意不映射 gray/dark**（`nomiTheme.ts:18` 注释写明「中性的 gray/dark 不映射，且 `primaryColor:'dark'` 依赖它」）。所以新 token 落在我们没接管的中性区，不会变成「第二种红」。

**唯一需要一次判断（不是阻断项）**：disabled 态从此有了一族独立 token。要不要把它们也收进 Nomi 语义（比如指向 `--nomi-ink-40` / `--nomi-line`），是升级之后可以单独做的一件小事——**不要塞进步骤②的 diff**（P1：别把无关改进混进版本升级）。

---

### Q5 · `@mantine/modals` 与 `@mantine/notifications`

版本号与 core 强绑定（peer 是精确版本 `"@mantine/core": "8.3.18"`），所以三个包必须同步升到同一个数字。

| 包 | 目标版本 | peer | 破坏项对我们 |
|---|---|---|---|
| `@mantine/core` | **8.3.18**（8.x 最新，`npm view @mantine/core@8 version`） | `react: ^18.x \|\| ^19.x` / `react-dom: ^18.x \|\| ^19.x` / `@mantine/hooks: 8.3.18` | 见 Q2 |
| `@mantine/notifications` | 8.3.18 | 同 + `@mantine/core: 8.3.18` | **零**。`styles.css` 逐字相同（diff 空）；`.d.ts` 只有注释改写和 `portalProps?: Omit<PortalProps,'children'> → BasePortalProps`（等价类型重命名）。我们只用 `<Notifications/>`（`NomiAppProviders.tsx:4`）与 `notifications.show`（`src/ui/toast.tsx:3`），都不受影响 |
| `@mantine/modals` | 8.3.18 | 同 | **零**。`.d.ts` 变化是类型放宽（`Record<\`data-${string}\`, string> → any`、`openConfirmModal` 参数并入 `Partial<OpenConfirmModal>`）。我们只用 `<ModalsProvider/>`（`NomiAppProviders.tsx:3`），零 `modals.*` 调用 |
| `@mantine/hooks` | 8.3.18 | `react: ^18.x \|\| ^19.x` | 不是我们的直接依赖（pnpm 按 peer 自动装：`node_modules/.pnpm/@mantine+hooks@7.17.8_react@18.3.1`），升 core 时 pnpm 会自己跟上 |

**注意：不要升 9。** 立项书 §0.3 的理由仍然成立且已复核——`@mantine/core@9` 要求 React 19.2+，会把 Mantine 和 React 焊成一步，失去中间回滚点。8.x 是唯一同时兼容 React 18 和 19 的档。

---

## 2. 命中清单：8.0 破坏项 × 我们的文件

按「谁会红」排序，供步骤②当验收清单用。

| # | 变更 | 我们的文件（file:line） | 会以什么形式暴露 |
|---|---|---|---|
| 1 | `Portal.reuseTargetNode` 默认 `false → true` | `src/workbench/settings/SettingsDialog.tsx:3`<br>`src/workbench/promptLibrary/PromptPreviewOverlay.tsx:3`<br>`src/workbench/onboarding/HandbookPanel.tsx:8`<br>`src/workbench/taskCenter/TaskCenterPanel.tsx:7`<br>`src/ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx:17` | **DOM 结构变**（5 个 portal 合并进一个容器）。编译全绿；只有真机走查 / 按 portal 定位的选择器会暴露。**本条是唯一非像素风险，必须走查** |
| 2 | `Switch` 去 track 边框、隐藏 input 改 100%、light track `gray-2→gray-3`、label padding 全档上调 | `src/design/forms.tsx:1`（`DesignSwitch`）→ 9 个消费方 | 视觉基线 `pf-03-switch-checkbox.png` 必红；`CapabilityModeEditor` / `OnboardingWizard` 走查 |
| 3 | `SegmentedControl` padding 全档下调（xs 3→2 / sm 5→3 / md 7→4 / lg 9→7 / xl 12→10） | `src/design/forms.tsx:1` → `OnboardingWizardAdvancedFields.tsx:137` 等 2 处 | 视觉基线 `pf-06-segmented-controls.png` 必红（高度变矮 2–4px） |
| 4 | disabled 态改读 `--mantine-color-disabled*`（light 底色 `gray-1→gray-2`） | `src/design/actions.tsx:1`（Button/ActionIcon）、`src/design/forms.tsx`（Input/NumberInput/SegmentedControl）、`InlineParameterBar.tsx:4`（Slider） | 凡陈列 disabled 态的基线都会动一档灰：`primitives-actions/*`、`primitives-forms/pf-01`、`pf-02` |
| 5 | Notification 删 `[data-with-icon]` 的 `padding-inline-start` | `src/ui/toast.tsx` + `src/theme/nomiTheme.ts:Notification.styles.root`（我们写死了 padding） | 多半被我们的 override 吃掉；带 icon 的 toast 走查一眼即可 |
| 6 | `Table` sticky header 加 `position:sticky` + `::before` 分隔线 | `src/design/tables.tsx:1`（`DesignTable` **全仓零调用**） | 只红实验室 `primitives-surfaces/ps-12-table.png` |
| 7 | `Combobox` `word-break → overflow-wrap`、新增 chevron 尺寸类 | `src/design/NomiSelect.tsx:3` → 24 个消费方 | `pf-07/08/09` 三张 select 基线可能微动；换行行为在极端长文案下会变 |
| 8 | `wrapperProps` 类型收紧 | `src/design/forms.tsx`（只透传 `...props`） | typecheck；风险低 |
| — | `ScrollArea` 去 `display: table` | **不成立**（8.3.18 里 `display: table` 仍在） | 立项书 §2.3(a) 该条作废 |
| — | 全局样式拆三份 / dates / Carousel / CodeHighlight / `Menu.Item` `data-hovered` / Tabs / AppShell / Tooltip / Select | 不中 | — |

**对立项书 §2.3(a) 的三处更正**（下次改那份方案时一并订正）：
1. `ScrollArea` 的 `display: table` **没有**被去掉；
2. `Switch` **中**（`src/design/forms.tsx` 用的是 Mantine 的，`src/ui/switch.tsx` 的 Radix 是另一套，两套并存本身是另一个话题）；
3. `Portal` 默认值翻转**漏了**，而它是本次唯一的真行为变更。

---

## 3. 第 ② 步（只升不改）的具体验收门

**范围**：`package.json` 三行 `^7.13.1 → ^8.3.18` + `pnpm-lock.yaml`。**除此之外零改动**——`src/theme/nomiTheme.ts` 不动（Q1 已证不用改）、`tailwind.config.ts` 不动（Q1 已证 selector 未变）、`scripts/build-tailwind.mjs` 不动（Q2 已证整包结构未变）。React 仍是 18。

**前置（必须先做完再开这一步）**：修掉 Q3 那条（删 `src/devlab/designLab.tsx:25-27` 三行）并重录受影响基线。**这是独立的一个 commit / PR**，不与升级同批。

**跑什么**：

| 门 | 命令 | 预期 |
|---|---|---|
| 类型 | `pnpm run typecheck` | 绿。唯一可能红的是 `wrapperProps`（Q2 第 8 条），红了就是真 API 破坏，按提示改 |
| 构建 | `pnpm build` + 确认 `public/tailwind.generated.css` 重新生成且含 `m_326d024a` | 绿 |
| 单测 | `pnpm run test:system:focused`（改动只碰 `package.json`，分类器会 fail-closed 到全维度 → 实际等于 `test:system:full`） | 绿。`src/ui/toast.test.ts` 已 mock 掉 notifications，不受影响 |
| 契约 | `pnpm run gates`（含 `check:tokens` / `check:heavy-path` / `check:framework-boundary`） | 绿 |
| **视觉** | `pnpm run check:design-lab`（12 组 209 张基线，`threshold 0.2` / `maxDiffPixelRatio 0.002`，darwin 已校准） | **会红**，见下表 |
| 走查 | `design-lab:walk:primitives-forms` + `:primitives-actions` + `:primitives-surfaces` + 真机 J1–J5 光/暗各一遍 | 人眼判断 |

**预期哪些基线会红**（红了才正常；**全绿反而说明升级没生效，先查 lockfile**）：

| 基线 | 为什么 | 预期 diff 形态 |
|---|---|---|
| `primitives-forms/pf-03-switch-checkbox.png` | Switch 去边框 + track 变深 + padding 上调 | 开关轮廓消失、未选中态变深一档、拇指位置微移 |
| `primitives-forms/pf-06-segmented-controls.png` | padding 全档下调 | 控件整体**变矮 2–4px**，宽度不变 |
| `primitives-forms/pf-01`、`pf-02` | disabled 底色 `gray-1→gray-2` | disabled 格底色深一档灰，几何不变 |
| `primitives-actions/*`（7 张里含 disabled 态的） | 同上 | 同上 |
| `primitives-surfaces/ps-12-table.png` | Table sticky header 新增 `::before` 分隔线 | 表头多一条 1px 线 |
| `primitives-forms/pf-07/08/09` | Combobox chevron 尺寸类新增 | 箭头图标尺寸可能微变 |
| `primitives-surfaces/ps-13-pagination.png` | **不应该因升级而变**（Pagination.css 逐字相同）——若前置修复已做，它会因为那次修复而重录 | 升级这一步它应当**保持绿** |

**红了怎么判断是「Mantine 的预期像素变化」还是「真回归」**——三条判据，按顺序走：

1. **对得上表**：红的基线在上表里，且 diff 形态与「为什么」一栏描述一致 → 预期变化，重录基线。**上表之外的任何一张红，默认当真回归**，不许顺手 `--update-baseline`。
2. **能回溯到具体 CSS diff**：把嫌疑元素的计算样式在 v7/v8 两棵隔离树里各量一遍（本篇的 Playwright 手法，脚本在 scratchpad），能指到 `diff v7/…/styles/X.css v8/…/styles/X.css` 的具体某一行 → 预期变化。**指不到 → 真回归**（多半是我们自己的 override 与 v8 新增规则打架，而不是 Mantine 改了默认值）。
3. **几何 vs 语义**：只有尺寸/间距/灰度深浅动、语义色（红黄绿蓝四语义）与明暗翻转行为不变 → 预期。**任何一处语义色跑掉 = 真回归**（说明 Q4 的结论在某个组件上不成立），立刻停，回来查 `cssVariablesResolver` 的覆盖是否被该组件的新 token 绕过。

**另加两条不在基线里的必查**（因为它们编译绿、基线也绿，只有走查看得见）：

- **Portal 合并**：打开 `SettingsDialog`、`TaskCenterPanel`、`HandbookPanel`、`PromptPreviewOverlay` 四个 portal 组件，**同时开两个**，确认层叠顺序与关闭行为不变（`NOMI_OVERLAY_Z_INDEX` 仍生效）。
- **暗色整片**：`data-mantine-color-scheme="dark"` 是 Tailwind darkMode 的挂钩点（`tailwind.config.ts:657`）。Q1 已证属性名未变，但仍须**肉眼确认暗色没有整片失效**——这类失效的特征就是「编译全绿、基线可能也绿（若基线只录了亮色），只有人眼看得出」。

---

## 4. 风险与回滚

**风险**：本次升级唯一的非像素风险是 `Portal.reuseTargetNode` 默认翻转（5 个文件的 DOM 结构变），其余全是可枚举的默认尺寸/灰度变化；回滚就是 `git revert` 那一个只动 `package.json` + `pnpm-lock.yaml` 的 commit 再 `pnpm install`，因为这一步刻意不碰任何生产代码，所以回滚是干净的一步、不留半迁移状态。

---

## 5. 附：本篇的实跑现场

| 证据 | 怎么拿的 |
|---|---|
| 版本 / peer | `npm view @mantine/{core,modals,notifications,hooks}@8 version peerDependencies --json` |
| 类型签名 | 两棵隔离 npm 树（`npm i @mantine/core@7.17.8` / `@8.3.18`）直接读 `lib/**/*.d.ts` 并 `diff` |
| CSS 破坏面 | 逐文件 `diff v7/node_modules/@mantine/core/styles/*.css v8/…`（86 个文件，34 个有差异） |
| DOM 对照 | `renderToStaticMarkup(<MantineProvider theme={复刻 nomiTheme}><Pagination value={1\|4} …/></MantineProvider>)`，两版各跑 |
| 计算样式 | Playwright（用仓库自带的 `node_modules/playwright`）加载 `file://` 页面 + 仓库真实 `public/tailwind.generated.css`，`getComputedStyle` 量 bg/color/border/height |
| 阳性对照 | 同一张页面追加 `UnstyledButton.css` + `CloseButton.css` + `Notification.css` 后重量，复现出与基线 PNG 一致的「全透明无边框」 |
| 官方清单 | https://mantine.dev/changelog/8-0-0/ |

**未能实跑、留作步骤②验证的**：`wrapperProps` 类型收紧对 `src/design/forms.tsx` 的实际影响（需要在本仓装 8 才能跑 `tsc`，本步骤禁止）。
