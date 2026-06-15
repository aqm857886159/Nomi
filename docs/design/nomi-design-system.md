# Nomi 设计系统（v1）

日期：2026-05-25
覆盖代码版本：v0.6.1
维护责任：任何新视觉元素都先来这里查；找不到再走 §9 新增协议。

> 这份文档是 Nomi 视觉与组件的**单一真相源**。任何新设计（组件、卡片、图标、动效、空状态、toast 等）都必须先查这里——能复用就复用，不能复用走 §9 流程登记后再做。
>
> 目标：避免"东西完全分割，什么都不一致"。

---

## 0. 怎么用这份文档

### 设计阶段（开始画图前）

1. 通读 §1 设计原则、§2 Tokens、§3 组件库索引
2. 找你要做的东西：
   - 文字 / 颜色 / 间距 / 圆角 → §2 Tokens（绝不写 hex / 随意 px）
   - 按钮 / 表单 / 弹窗 / 标签 → §3 通用组件
   - 节点 / sidebar 行 / 组框 / Toast / 空状态 → §4 工作区专属
   - 视觉模式（节点头部 / 副本角标 / 占位态 …）→ §5 Patterns
3. 找不到 → §9 走新增协议

### 实施阶段（写代码前）

4. Tailwind 类名优先用 token 化的（`text-nomi-ink`、`bg-nomi-paper`、`rounded-nomi`），不写 `#22201b`、`bg-[#fff]`
5. 字体大小用 §2.3 表的 token，不写随意 `text-[13.7px]`
6. 间距用 4 的倍数（4/8/12/16/24），不写 7px 11px
7. 图标全部用 `@tabler/icons-react`，stroke 1.5，size 取 §6 规定

### Review 阶段（合 PR 前）

8. 自查：本 PR 是否引入新 hex / 随意尺寸 / 新 icon 来源？
9. 任何"是"都得在 PR description 解释为什么不能用现有 token，并在本文档新增 §entry

---

## 1. 设计原则（继承自根 `Design.md`）

Nomi 是密集型 AI 视频工作台。视觉必须服务于创作流程：

```
Script → Generate → Edit → Preview → Export
```

锁定原则：

- **Light-only**：当前只做浅色主题，不维护 dark theme（包体与一致性优先）
- **No fake progress**：禁止假进度条、占位 spinner 假装在工作
- **Density over decoration**：密集生产 surface > 营销式装饰
- **One visual hierarchy**：用 spacing + typography + 轻微 surface 对比建立层次，避免到处加 border
- **Creator control explicit**：AI 建议不能盖过用户决定，副本/派生关系永远要看得见
- **Local-first visibility**：本地项目 / 资产 / 进度对桌面用户始终可见

---

## 2. 设计 Tokens（单一真相源）

**所有数值都来自这里。** 三个源文件，按层级组合：

| 层级 | 文件 | 内容 | Tailwind 暴露 |
|---|---|---|---|
| 底层颜色（OKLCH）| `src/theme/nomi-tokens.css` | `--nomi-bg` / `--nomi-paper` / `--nomi-ink*` / `--nomi-line*` / `--nomi-accent*` / `--nomi-shadow-*` / `--nomi-radius-*` / `--nomi-font-*` | `nomi-*` 颜色类、`rounded-nomi` |
| 工作区映射 | `src/workbench/workbench.css` | `--workbench-*`（基于 nomi 但提供工作区语义命名）| `workbench-*` 颜色类 |
| 几何/排版（TS）| `src/theme/nomiTheme.ts` 中的 `nomiDesignTokens` | `radius` / `spacing` / `fontSize` / `lineHeight` / `shadow` | Tailwind config 引用 |

### 2.1 颜色 token 全表

#### 中性轴（ink 阶梯）

| Token | 用途 |
|---|---|
| `--nomi-bg` | 应用全局背景 |
| `--nomi-paper` | 卡片 / 浮层 / 面板表面（接近白）|
| `--nomi-ink` | 主文字、强调按钮底色 |
| `--nomi-ink-80` | 次级文字 |
| `--nomi-ink-60` | 辅助文字（hint / placeholder）|
| `--nomi-ink-40` | 灰字（"等待生成" 这种次次级）|
| `--nomi-ink-30` | 禁用文字 / 极弱辅助 |
| `--nomi-ink-20` | 弱边框 |
| `--nomi-ink-10` | 极浅背景（hover 态）|
| `--nomi-ink-05` | 最浅背景（占位斜条纹之一）|
| `--nomi-line` | 标准边框 |
| `--nomi-line-soft` | 弱边框（hover 才显的分隔）|

#### 强调与语义

| Token | 用途 |
|---|---|
| `--nomi-accent` | 主强调（蓝紫 OKLCH 0.55 0.13 250），选中态、链接、主操作按钮 hover |
| `--nomi-accent-soft` | 强调的浅色变体（选中态背景）|
| `--workbench-success` / `--workbench-success-soft` | 成功语义 |
| `--workbench-danger` / `--workbench-danger-soft` | 错误语义 |
| `--workbench-video` / `--workbench-video-soft` | 视频轨道 |
| `--workbench-hover` / `--workbench-pressed` | 通用交互态 |

#### 不允许的颜色

- ❌ 任意 hex（`#22201b`、`#f4f1ec`）—— 必须用 token
- ❌ 任意 rgb/rgba（`rgba(255, 59, 48, 0.1)`）—— 用 `--workbench-danger-soft`
- ❌ Tailwind 默认色板（`text-red-500`、`bg-blue-100`）—— 用 `text-workbench-danger`、`bg-nomi-accent-soft`
- ❌ OKLCH 直写 —— 只能在 `nomi-tokens.css` 里写

例外：`color-mix(in oklch, var(--nomi-accent) 12%, var(--nomi-paper))` 这种基于 token 的派生**允许**，并应封装为新 token。

### 2.2 间距 token（4 的倍数）

来自 `nomiDesignTokens.spacing`：

| Token | 值 | 用途 |
|---|---|---|
| `1` | 4px | 紧凑（chip 内 padding）|
| `2` | 8px | 标准 element 间距 |
| `3` | 12px | 段落 / 卡片内 padding |
| `4` | 16px | 卡片 padding / 块间距 |
| `5` | 20px | 大段间距 |
| `6` | 24px | section 间距 |
| `8` | 32px | 区域间距 |
| `10` | 40px | 页面级间距 |

Tailwind 标准 spacing 已经是 4 的倍数（`p-1` = 4px、`gap-3` = 12px），可以直接用。**禁止 `gap-[7px]` 这种非标准值**。

### 2.3 字号 token

来自 `nomiDesignTokens.fontSize`：

| Token | Tailwind class | px | 用途 |
|---|---|---|---|
| `micro` | `text-micro` | 11 | 角标、徽标、零填充编号 |
| `caption` | `text-caption` | 12 | hint、占位副标题、列表 metadata |
| `bodySm` | **`text-body-sm`** | 13 | 表单输入、紧凑列表 |
| `body` | `text-body` | 14 | 正文 |
| `title` | `text-title` | 16 | 卡片标题、面板 header |
| `h2` | `text-h2` | 20 | 区域 heading |
| `h1` | `text-h1` | 24 | 页面 heading |
| `display` | `text-display` | 28 | 品牌 hero 大标题（配 `font-nomi-display`）|

行高对应 `nomiDesignTokens.lineHeight`，永远成对使用。

> ⚠️ **13px 这档类名是 `text-body-sm`（连字符），不是 `text-bodySm`（驼峰）。** Tailwind 配置里只有 `body-sm`；写成驼峰 `text-bodySm` 是个**不存在的类、静默回退 16px**（2026-06-15 抓出全仓 19 处此 bug，已修）。token 名是 `bodySm`，但**类名必须连字符**。

**不允许：** `text-[13.7px]`、`leading-[15px]`、`text-2xl`（除非映射到 token）；`text-bodySm`（驼峰，无效类 → 16px）。

### 2.4 圆角 token

来自 `nomiDesignTokens.radius`：

| Token | 值 | Tailwind | 用途 |
|---|---|---|---|
| `sharp` | 0 | (avoid) | 极少用 |
| `field` | 6px | `rounded-nomi-sm` | 表单输入、小标签 |
| `panel` | 10px | `rounded-nomi` | 节点卡、面板、标准容器 |
| `modal` | 14px | `rounded-nomi-lg` | 弹窗、抽屉 |
| `pill` | 999px | `rounded-full` | 按钮、chip、徽章 |

### 2.5 阴影 token

| Token | Tailwind | 用途 |
|---|---|---|
| `--nomi-shadow-sm` | `shadow-nomi-sm` | 节点默认 |
| `--nomi-shadow-md` | `shadow-nomi-md` | 节点选中、浮层 |
| `--nomi-shadow-lg` | `shadow-nomi-lg` | Toast、Modal |
| `--workbench-shadow-pop` | `shadow-workbench-pop` | 强浮层（菜单）|

### 2.6 字体

| Token | 用途 |
|---|---|
| `--nomi-font-sans`（Inter + 系统）| 正文 |
| `--nomi-font-display`（Fraunces + 衬线）| 品牌 / 大型显示 / 数字感 |

### 2.7 动效

| Token | 值 | 用途 |
|---|---|---|
| `--nomi-transition-fast` | `140ms cubic-bezier(.2, .7, .3, 1)` | 所有交互过渡的默认 |

**禁止：** 自己写 `transition-[opacity_300ms_ease-out]`，应该用 `transition-[opacity] duration-[var(--nomi-transition-fast)]`。

---

## 3. 通用组件库（`src/design/`）

入口：`import { ... } from '../../design'`（即 `src/design/index.ts`）。**优先用这里现有的，能不写新组件就不写。**

### 3.1 表面 surfaces

| 组件 | 用途 | 文件 |
|---|---|---|
| `PanelCard` | 有边框、带 padding 的卡片表面 | surfaces.tsx |
| `InlinePanel` | 行内薄面板，无重边框 | surfaces.tsx |

### 3.2 操作 actions

| 组件 | 用途 |
|---|---|
| `DesignButton` | Mantine-backed 主按钮（含 loading / disabled），用于 admin / 设置面板 |
| `WorkbenchButton` | 工作区原生按钮（密集、紧凑），canvas / timeline / 节点上用 |
| `IconActionButton` | Mantine 图标按钮，遗留管理面 |
| `WorkbenchIconButton` | 工作区原生图标按钮 |
| `ActionCard` | 起始页主入口动作卡片（见下方规格） |

#### `ActionCard`（2026-06-12 增，起始页 O2 布局拍板）

文件：`src/design/actions.tsx`

视觉：280×88 大动作卡片，左圆形图标位 + 标题 + 一行用途说明；页面级主操作专用。

| 属性 | 值 |
|---|---|
| 尺寸 | `w-[280px] h-[88px] px-5`，图标位 `size-10 rounded-full` |
| 圆角/阴影 | `rounded-nomi shadow-nomi-sm`，hover 抬升 `-translate-y-0.5 shadow-nomi-md` |
| default | `bg-nomi-paper border-nomi-line text-nomi-ink`，图标位 `bg-nomi-ink-05 text-nomi-ink-80` |
| primary | `bg-nomi-ink text-nomi-paper`，hover `bg-nomi-accent`；图标位/说明用 paper 的 color-mix 派生 |
| 字号 | 标题 `text-body font-semibold`，说明 `text-caption` |
| 行为 | 原生 `<button>`，`data-variant` 暴露给断言 |

何时用 / 何时不用：
- 用：起始页/空状态的页面级主入口（一页至多一张 primary）
- 不用：工作区内/低频操作 → `WorkbenchButton`

**何时用 Design* vs Workbench***：
- 进入 stats / 设置 / 模型管理 → Design* （Mantine 一致）
- 进入 workbench / canvas / sidebar → Workbench*（密集，原生 React）

### 3.3 状态 status

| 组件 | 用途 |
|---|---|
| `DesignBadge` | 通用语义徽章（success / warning / error / info）|
| `StatusBadge` | 工作区状态徽章（生成中 / 完成 / 错误），含 data-status 切换样式 |
| `DesignAlert` | 横条提示 |
| `DesignProgress` | 进度条 |

### 3.4 表单 forms

`DesignCheckbox` / `DesignTextInput` / `DesignTextarea` / `DesignSelect` / `DesignNumberInput` / `DesignSegmentedControl` / `DesignSwitch` / `DesignFileInput`。Mantine-backed 一致风格。

**画布上的紧凑表单**：直接用 `<textarea>` + `<input>` + Tailwind token 类，不用 Mantine——节点 composer 就是这么做的。

### 3.5 弹窗 overlays

`DesignModal` / `DesignDrawer`。

**破坏性操作确认**：一律用 `confirmDialog / alertDialog / promptDialog`（promise 风格，`src/design/confirmDialog.tsx`，宿主 `ConfirmDialogHost` 已挂 App 根部）。**禁用原生 `window.confirm/alert/prompt`**——脱设计系统、E2E 驱动自动 dismiss 测不到、Electron/macOS 有焦点丢失史（2026-06-13 审计 A7）。危险动作传 `danger: true`。

### 3.6 导航 navigation

`DesignPagination`。

### 3.7 表格 tables

`DesignTable`。

### 3.8 布局 layout

`DesignPageShell`。

### 3.9 身份 identity

`NomiBrand`（logo + 字标）、`NomiAILabel`、`NomiLoadingMark`、`NomiLogoMark`、`NomiStepper`（顶部 1→2→3 步骤指示）。

### 3.10 工具 utilities

`BodyPortal`（body-level 挂载，弹窗用）、`nomiDesignTokens`（直接读 token 值）、`buildNomiTheme`（构建 Mantine theme）。

---

## 4. 工作区专属组件（v0.6 增）

### 4.1 `TitlePill`（节点标题胶囊）

文件：`src/workbench/generationCanvas/nodes/TitlePill.tsx`

视觉：节点左上角浮动的深色圆角 pill。

规格：

| 属性 | 值 |
|---|---|
| 背景 | `bg-nomi-ink` |
| 文字 | `text-nomi-paper` |
| 字号 | 11px (`text-[11px]`) |
| 字重 | `font-medium` |
| Padding | `px-2 py-[3px]` |
| 圆角 | `rounded-md` |
| 行为 | `pointer-events-none select-none`，不阻挡节点拖动 |
| 内容算法 | shots + shotIndex → "分镜 NN" \| shots → "分镜" \| 其它 → 分类名 \| 无 → node.title |

### 4.2 `CategoryItem` 图标系统

文件：`src/workbench/sidebar/CategoryItem.tsx` + `categoryIcons.ts`

**规则：分类图标只用 `@tabler/icons-react`，stroke 1.5，size 16px。**

5 个分类锁定映射（不允许改）：

| 分类 ID | 名称 | Tabler 图标 |
|---|---|---|
| shots | 分镜 | `IconLayoutRows` |
| cast | 角色 | `IconUser` |
| scene | 场景 | `IconPhoto` |
| prop | 道具 | `IconBox` |
| audio | 声音 | `IconChartBar` |

新增图标参考 §6 图标使用规则。

### 4.3 独立副本角标

文件：`src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx`（嵌入式）+ CSS class `.generation-canvas-v2-node__derived-badge`

视觉：节点头部右上角的小型 chip。

规格：

| 属性 | 值 |
|---|---|
| 形态 | 圆角 pill (`rounded-full`) |
| 背景 | `rgba(255, 255, 255, 0.86)` + backdrop-blur |
| 文字 | `var(--nomi-accent)` |
| 字号 | 10.5px |
| 字重 | 650 |
| 图标 | `IconCopy` 13px stroke 1.8 |
| 文案 | 正文 "独立副本" \| tooltip "独立副本（来自 [分类]·[名]）" |
| 行为 | 点击跳转源节点（支持跨分类切换） |

### 4.4 `GroupFrame`（组框）

文件：`src/workbench/generationCanvas/components/GroupFrame.tsx`

视觉：包围一组节点的浅色半透明 frame，左上角带组名 label。

规格：

- 边框颜色：`box.group.color`（用户自定义，默认 `#d8c3a5`）
- 背景：基于 color 的 18% alpha（`getHexAlphaColor` 派生）
- Label 背景：原 color
- 可拖动整组

### 4.5 `showUndoToast`

文件：`src/workbench/feedback/showUndoToast.ts`

API：

```typescript
showUndoToast({
  message: '已复制到 角色',
  onUndo: () => deleteNode(copied.id),
  durationMs: 5000,  // optional, default 5s
})
```

视觉：基于 `@mantine/notifications`，整张 toast clickable = 撤销。5 秒后自动消失。

**使用场景**：跨分类拖拽完成、跨分类 Cmd+V 粘贴等"用户可能误操作"的写入。

---

### 4.6 `AttachmentRail` / `AttachmentChip`（composer 附件）

文件：`src/workbench/ai/composer/AttachmentRail.tsx`（+ `composerAttachmentTypes.ts` / `useComposerAttachments.ts` / `AutoGrowTextarea.tsx`）

视觉：助手 composer 输入框上方的一行附件 chip——图片是 48×48 缩略图 tile，文档是横向 chip。

规格：

| 属性 | 值 |
|---|---|
| 图片 chip | `size-12`（48）`rounded-nomi-sm` `border-nomi-line` `overflow-hidden`；上传中盖 `NomiLoadingMark`；× 在角上 |
| 文件 chip | `h-12 max-w-[184px]` `rounded-nomi-sm` `border-nomi-line` `bg-nomi-ink-05`；左 `size-7` 中性 tile（`bg-nomi-ink-10` + `text-nomi-ink-60` 字形）+ 名(`text-bodySm`)/类型·大小(`text-micro text-nomi-ink-60`) + × |
| 文件类型色 | **中性**（不用语义 danger/accent），类型由「PDF · …」副标签承载（density-first，避免与错误态/发送按钮撞色）|
| 字形 | xls/csv→`IconTable`、pdf/doc/txt/md→`IconFileText`、其它→`IconFile`，size 16 stroke 1.5 |
| × 命中区 | `size-6`（24，a11y）；图片角标内圈 `size-4` 深圆 + `IconX` 10 |
| 错误态 | `border-workbench-danger` + 副标「上传失败」|
| 行为 | 三入口（点击 `openFilePicker` / 拖拽蒙层 / 粘贴图片）经 `useComposerAttachments`；上传走 `importWorkbenchLocalAssetFile`→`nomi-local://`；30MB 上限 |

何时用：助手类 composer（创作助手 / 画布助手）需要附文件时。
何时不用：生成节点的参考图槽 → 用画布既有的 asset-slot（`NodeParameterControls`），不复用本组件。

---

## 5. 视觉 Patterns（recur 模式）

### 5.1 节点卡片（NodeCard）

**结构（分镜节点 / shots 的范例，spec §6.1）：**

```
┌────────────────────────────────┐  ← article (380×360px, rounded-nomi)
│ ╭───────╮                       │  ← TitlePill (top-left, absolute z-2)
│ │分镜 01│                       │
│ ╰───────╯                  ╭──╮ │  ← 副本角标 (top-right, absolute)
│                            │📋│ │
│                            ╰──╯ │
│      [图像 / 占位条纹]           │  ← 图像区 (flex-1, min-h-0, rounded-nomi)
│      "分镜 01"                  │     占位态文案 (text-nomi-ink-60 / 40)
│      "等待生成"                  │
│                                 │
├─────────────────────────────────┤  ← Composer 分隔
│ [prompt textarea]               │  ← composer (flex-shrink-0, min-h-120)
│ [模型 chip] [比例 chip]  [生成] │
└─────────────────────────────────┘
```

**关键约束：**
- 卡片只用 `rounded-nomi` 圆角
- 边框只用 `var(--nomi-line)`
- 阴影 `shadow-nomi-md`（选中时 `shadow-nomi-lg` + 1.5px accent 描边）
- 标题 pill 固定在 absolute top-left，z-2
- 占位斜条纹背景：`bg-[repeating-linear-gradient(45deg,var(--nomi-ink-05)_0_10px,var(--nomi-ink-10)_10px_20px)]`
- 占位文字两层：第一行 13px ink-60 + 第二行 11px ink-40

### 5.2 Sidebar 行（CategoryItem）

```
[Icon 16px]  分类名(12px)  [count 11px right]
```

- 选中态：整行 `bg-nomi-accent-soft` + 字 `text-nomi-accent`
- Hover 态：`hover:bg-nomi-ink-05`
- 收起态宽度 60px，仅图标 + count badge（角标位）
- 展开态宽度 240px

### 5.3 空状态 CTA（empty state）

```
        这里还没有 {分类名}                ← strong 14px nomi-ink
   添加第一个节点开始创作，之后可以...   ← caption 12px ink-60
            [ + 新建{分类名} ]              ← WorkbenchButton 主操作 pill
```

- 容器：`absolute top-[44%] left-1/2 grid gap-3 place-items-center -translate-x-1/2 -translate-y-1/2`
- 主按钮：`rounded-full bg-nomi-ink text-nomi-paper hover:enabled:bg-nomi-accent`
- 适用于：画布空状态、列表空状态、面板空状态

### 5.4 Undo Toast

文案模板：`已 {动词} 到 {目标}  ·  点击此处撤销`

- 颜色：gray
- 持续：5 秒
- 行为：整张可点 = 撤销 + 立即消失
- 实现：`showUndoToast()` helper

### 5.5 视觉状态约定

| 状态 | 视觉信号 |
|---|---|
| 默认 | 边框 `--nomi-line`、阴影 `shadow-nomi-sm` |
| Hover | 背景 `--workbench-hover` 或 `--nomi-ink-05` |
| Pressed | 背景 `--workbench-pressed` |
| Selected | 描边 `--nomi-accent` 1.5px + 阴影提升一级 |
| Disabled | 文字 `--nomi-ink-30`、cursor not-allowed、opacity 不动 |
| Error | 字 `--workbench-danger`、背景 `--workbench-danger-soft` |
| Success | 字 `--workbench-success-ink`、背景 `--workbench-success-soft` |

---

## 6. 图标使用规则（强制）

### 库

**唯一图标库：`@tabler/icons-react`**。`lucide-react` 已删除。其它图标库不允许新增。

### 尺寸规则

| 场景 | size | stroke |
|---|---|---|
| Sidebar 分类图标 | 16 | 1.5 |
| 节点角标内的小图标 | 13 | 1.8 |
| 工作区按钮内图标 | 14 | 1.6 |
| 大引导图标 | 24-32 | 1.5 |
| AppBar / 工具栏图标 | 18 | 1.5-1.6 |

**禁止：** size 13.5 / 17 这种非标准；stroke 2.0+（除非有强意图）；`strokeWidth` prop（Tabler 用 `stroke`）。

### 选图规则

- 隐喻清晰 > 视觉美感（用户能秒懂的图标优先）
- 与 Mura 设计 / 现有图标视觉风格一致（outline、统一 stroke）
- 5 个分类图标已锁定（§4.2）

新图标加入流程：

1. 在 https://tabler.io/icons 找到候选（grep 也行：`@tabler/icons-react` exports）
2. 在 §6 表格里登记尺寸与使用位置
3. 跨场景复用同一个图标（不能 sidebar 用 IconUser、节点头里用 IconUserCircle）

---

## 7. 已落地的 5 分类视觉

| 分类 | TitlePill 文案 | Icon | 当前节点渲染 |
|---|---|---|---|
| shots | "分镜 NN" | `IconLayoutRows` | BaseGenerationNode + 内嵌 composer + 自动编号 |
| cast | "角色" | `IconUser` | BaseGenerationNode（无 composer 永久态）|
| scene | "场景" | `IconPhoto` | BaseGenerationNode |
| prop | "道具" | `IconBox` | BaseGenerationNode |
| audio | "声音" | `IconChartBar` | BaseGenerationNode（占位，audio kind 待补）|

**遗留差距（v0.6.x 未做）**：
- 角色 / 场景 / 道具 / 声音 节点的**专属卡片样式**（spec 原本提出 5 个独立 render 组件，被识别为 over-engineering 简化合并到 BaseGenerationNode 同一渲染）
- 这 4 类节点目前视觉上跟分镜几乎一样
- → 这是下一个工作：基于本设计系统重做 4 个非分镜分类的卡片视觉

---

## 8. 模板：如何描述一个新组件

新加组件 / 模式时，按本模板写入 §3 或 §4：

```markdown
### X.X `ComponentName`

文件：`src/path/to/Component.tsx`

视觉：1 句话描述

规格：

| 属性 | 值 |
|---|---|
| 背景 | token |
| 文字 | token |
| 字号 | px (font-size token) |
| Padding | spacing token |
| 圆角 | token |
| 阴影 | token |
| 行为 | 关键交互 |

何时用 / 何时不用：
- 用：……
- 不用：…… 改用 [另一个组件]

可访问性：aria-label / 键盘行为 / focus ring
```

---

## 9. 新增协议（开工前的规则）

任何"在本文档里找不到的新视觉元素"必须走以下流程：

### Step 1：是真的找不到吗？

90% 的情况你想做的东西已经存在。再读一遍 §3 §4 §5。

特别留意"我以为它不一样，其实只是文案不同"的陷阱——已有按钮 + 不同文案 ≠ 需要新按钮组件。

### Step 2：能用 token + 现有组件组合做出来吗？

例：要做 "右上角带 X 关闭的提示卡片" = `PanelCard` + `WorkbenchIconButton[IconX]` 组合即可，不是新组件。

如果是组合，不需要新增到本文档（已经被 §3 + §6 覆盖）。

### Step 3：确实是新东西

3a. **先写到本文档**（PR 同一 commit 内）：
- 加到 §4 或 §3 对应小节
- 用 §8 模板填规格
- 至少给一个使用场景

3b. **然后写代码**：
- 文件放对位置（通用 → `src/design/`、画布 → `src/workbench/generationCanvas/`、sidebar → `src/workbench/sidebar/`）
- export 加到对应 index
- commit message 含 `[DESIGN-XX]` 形式（参考 `[E.2C-XX]` 的 progress 强制机制可扩展到此）

3c. **禁止跳过**：
- 不允许"先写代码看效果再补文档"
- 不允许"小改动不用登记"
- 自动化检查：未来可加 grep 钩子检查是否有未登记的 className / 新 hex

---

## 10. 反例（不要这样做）

**❌ 自己写颜色：**
```tsx
<div className="bg-[#f4f1ec] text-[#22201b]">
```
应该：
```tsx
<div className="bg-nomi-paper text-nomi-ink">
```

**❌ 随意字号：**
```tsx
<span style={{ fontSize: 13.5 }}>
```
应该：取最接近的 token，要么 12 要么 14。

**❌ 直接引图标：**
```tsx
import IconX from '@/assets/some-svg.svg'
```
应该：先看 §6 是否能用 Tabler 替代；不能则走 §9 流程。

**❌ 抄一段相似 JSX：**
```tsx
<button className="px-4 py-2 rounded-full bg-black text-white ...">提交</button>
// 然后下个文件再抄一遍
<button className="px-4 py-2 rounded-full bg-black text-white ...">保存</button>
```
应该：用 `<WorkbenchButton>` 或新增组件并登记到 §3。

**❌ 双源数据：**
```tsx
// 一个地方写 padding 12，另一个地方写 padding 16，看起来都"差不多"
```
应该：选定 token 后跨文件一致。

---

## 11. 下一步（占位）

- [ ] **4 个非分镜分类的卡片视觉**——基于本设计系统重新设计角色 / 场景 / 道具 / 声音节点的渲染样式，差异化它们与分镜的视觉
- [ ] **统一菜单 / 右键菜单组件**——目前 sidebar 右键菜单内联在 CategorySidebar 里，可抽出
- [ ] **Group color picker**——组框颜色当前是固定 `#d8c3a5`，UI 允许用户选色
- [ ] **Toast 系统升级**——当前 toast 内点击撤销 OK 但未来想加倒计时进度条，需在 §4.5 重新登记

---

## 12. 相关文件 / 参考

| 类型 | 路径 |
|---|---|
| 高层原则 | `Design.md`（根目录） |
| 颜色 token | `src/theme/nomi-tokens.css` |
| 几何/排版 token | `src/theme/nomiTheme.ts` |
| 工作区 token | `src/workbench/workbench.css` |
| 组件库入口 | `src/design/index.ts` |
| 组件库说明 | `src/design/README.md` |
| Tailwind 扩展 | `tailwind.config.*` |
| Mura 设计原稿 | 用户本地 `Mura - 画布设计.html`（Claude Artifacts）|
| Phase E.2 execution plan | `docs/plans/2026-05-25-phase-e2-completion-and-tech-uplift.md` |

---

## 13. 维护

- 本文档版本 v1.1（+§4.6 AttachmentRail），对应代码 v0.9.x
- 每次新增 §4 / §5 entry 时 bump 一次小版本（v1.1、v1.2 ...）
- 重大重构（如颜色系统重设）bump 主版本（v2）
- 文档过时时优先更新本文档，不依赖代码注释作为 source of truth
