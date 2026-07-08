# Nomi 设计系统（v2）

日期：2026-06-21（v2 补全：真实色值 + Logo 解剖 + 调用点地图 + 漂移诚实标注）
覆盖代码版本：v0.10.x
维护责任：任何新视觉元素都先来这里查；找不到再走 §9 新增协议。

> 这份文档是 Nomi 视觉与组件的**单一真相源**。任何新设计（组件、卡片、图标、动效、空状态、toast 等）都必须先查这里——能复用就复用，不能复用走 §9 流程登记后再做。
>
> 目标：避免"东西完全分割，什么都不一致"。AI 读完这份文档，对「该长什么样、该用哪个 token、该 import 哪个组件、该放进哪个文件」要**有确定答案，不靠猜**。
>
> **这份文档要回答三个「确定性」问题（v2 起每节都对齐这三问）：**
> 1. **它长什么样？** — 不只给 token 名，给**真实色值 + 一句话视觉描述**（§2）。
> 2. **从哪 import / 在哪定义？** — 每个组件给文件路径（§3、§4）。
> 3. **谁在用它 / 我该照谁抄？** — 给**调用点地图**（§0.5 全景 + §3.9 logo 逐个调用点）。新做一个东西先去看现有调用点照着抄，别另起一套。

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

## 0.5 真相源全景 + 「这东西去哪个文件」速查（先看这张）

> 做任何视觉前，先用这张表定位：**值（色/字/间距/圆角）从哪来、组件从哪 import、新文件放哪、照谁抄。**

### 值的真相源（三层，按优先级）

| 层 | 文件 | 前缀 | 你该不该直接用 |
|---|---|---|---|
| ① 规范底层（**唯一该新增的地方**）| `src/theme/nomi-tokens.css` | `--nomi-*` | ✅ 优先。新颜色/圆角/阴影只在这里加 |
| ② 工作区语义映射 | `src/workbench/workbench.css` | `--workbench-*` | ✅ 工作区内语义色（success/danger/video/hover…）用这层；它们 alias 到 ①，少数语义色是 hex 落在这里（§2.1.4）|
| ③ 遗留并行命名 ⚠️ | `src/styles/globals.css` | `--tc-*` / `--handle-color-*` | ❌ **不要再用、不要再加**。这是早期暗色主题残留，绝大多数已死，详见 §14 漂移 |

**铁律：新增 token 只进 ①（`nomi-tokens.css`）。** 看到 `--tc-*` 当它是历史包袱，别扩散。

### 组件去哪 import / 新文件放哪

| 你要做的东西 | import 自 / 抄哪 | 新文件放哪 |
|---|---|---|
| 通用按钮/表单/弹窗/徽章/卡片 | `../../design`（`src/design/index.ts`）| `src/design/` |
| 画布节点 / 节点内组件 | `src/workbench/generationCanvas/nodes/` 现有 | 同目录 |
| 画布上的浮层/组框/工具栏 | `src/workbench/generationCanvas/components/` | 同目录 |
| Sidebar 行 / 分类 | `src/workbench/sidebar/` | 同目录 |
| 助手 composer（输入框/附件）| `src/workbench/ai/composer/` | 同目录 |
| Logo / 字标 / 加载标 / 步骤器 | `../../design`（全部出自 `src/design/identity.tsx`，§3.9）| **不新增**，复用 |
| 图标 | `@tabler/icons-react`（§6）| 不自带 svg |

### 字号/间距/圆角 token 真相源

几何与排版数值由 `src/theme/nomiTheme.ts` 的 `nomiDesignTokens` 定义，Tailwind config 引用后暴露成类（`text-body`/`rounded-nomi`/`p-3`…）。详见 §2.2–2.5。

---

## 1. 设计原则（继承自根 `Design.md`）

Nomi 是密集型 AI 视频工作台。视觉必须服务于创作流程：

```
Script → Generate → Edit → Preview → Export
```

锁定原则：

- **Light + Dark 双模式**（2026-06-24 重新引入）：token-only 翻转——`tailwind.config.ts` addBase 的 `:root[data-mantine-color-scheme="dark"]` 重定义全套 `--nomi-*`，组件零改动随之翻。默认按本地时间「天黑自动暗」（傍晚 18:00–清晨 7:00 用暗色，与 macOS 外观无关），用户手动切一次后记住选择（`localStorage['nomi-color-scheme']`）；App 开着跨过时间窗会自动切。窗口常量在 `theme/colorScheme.ts`（`NIGHT_START_HOUR`/`NIGHT_END_HOUR`）。新增颜色一律走语义 token，别在组件直写 hex/oklch，否则暗色翻不到。3D 渲染色（`--nomi-axis-*`、scene3d 场景物体/轴/网格）主题无关，明暗同色。开关：库页头 + 关于弹层「外观」行。
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

> **透明度修饰符（2026-07-08 起可用）**：token 色类支持 Tailwind `/` 透明度修饰符——`bg-nomi-ink/85`、`text-nomi-paper/80`、`ring-nomi-accent/[0.5]` 都会正确生成（映射层 `tokenColor()` 用 `color-mix` 注入 alpha，见 `tailwind.config.ts` 顶部）。**此前这些类会被 JIT 静默丢弃**（元素无背景/描边裸奔，Issue #32「图上文字看不清」根因，全仓 60+ 处中招）。新增 token 色映射必须走 `tokenColor()`，别写裸 `var()`。图上小标/遮罩仍优先用语义 token（`--nomi-overlay-chip` / `--nomi-scrim` / `--nomi-media-veil`），`/alpha` 用于语义 token 覆盖不到的一次性透明度。

> 值这里**给真实数值 + 一句话视觉**，AI 不用去翻 CSS 也能确定它长什么样。真相源仍是 `src/theme/nomi-tokens.css`（改值改那里，不改这表）。Nomi 是**暖中性**底（hue 80，微偏暖灰），强调色是**冷蓝紫**（hue 250）——冷暖对比是 Nomi 的色彩性格。

#### 2.1.1 中性轴（ink 阶梯，hue 80 暖灰）

| Token | 实际值（OKLCH）| 视觉 | 用途 |
|---|---|---|---|
| `--nomi-bg` | `0.985 0.003 90` | 几乎白、微暖 | 应用全局背景 |
| `--nomi-paper` | `1 0 0` | 纯白 | 卡片 / 浮层 / 面板表面 |
| `--nomi-ink` | `0.22 0.01 80` | 接近黑的暖深灰 | 主文字、强调按钮底色、logo 底 |
| `--nomi-ink-80` | `0.32 0.01 80` | 深灰 | 次级文字 |
| `--nomi-ink-60` | `0.50 0.01 80` | 中灰 | 辅助文字（hint / placeholder）|
| `--nomi-ink-40` | `0.68 0.01 80` | 浅灰 | 灰字（"等待生成" 这种次次级）|
| `--nomi-ink-30` | `0.78 0.01 80` | 更浅灰 | 禁用文字 / 极弱辅助 |
| `--nomi-ink-20` | `0.88 0.005 80` | 很浅灰 | 弱边框 |
| `--nomi-ink-10` | `0.94 0.003 80` | 极浅灰 | 极浅背景（hover 态）|
| `--nomi-ink-05` | `0.97 0.003 80` | 最浅灰 | 最浅背景（占位斜条纹之一）|
| `--nomi-line` | `0.91 0.004 80` | 浅灰线 | 标准边框 |
| `--nomi-line-soft` | `0.95 0.003 80` | 更浅线 | 弱边框（hover 才显的分隔）|

> ⚠️ ink 阶梯只有 **80/60/40/30/20/10/05**——**没有 ink-70/50/90**。写 `text-nomi-ink-70` 是个**不存在的类、静默失效**（文字会回退继承色），和驼峰 `text-bodySm` 同类陷阱。要中间值就近取档。

#### 2.1.2 强调色（冷蓝紫，hue 250）

| Token | 实际值 | 视觉 | 用途 |
|---|---|---|---|
| `--nomi-accent` | `oklch(0.55 0.13 250)` | 中等饱和的蓝紫 | 选中态描边、链接、主操作 hover、字标中间的 m、logo loading |
| `--nomi-accent-soft` | `color-mix(accent 12%, paper)` | 极浅蓝紫 | 选中态背景、accent 浅底 |

#### 2.1.3 时间轴轨道色（媒体类型区分，定义在 nomi-tokens.css）

| Token | 实际值 | 视觉 | 用途 |
|---|---|---|---|
| `--nomi-track-text` | = `--nomi-accent` | 蓝紫 | 文字轨（与 accent 同源）|
| `--nomi-track-image` | `oklch(0.7 0.13 200)` | 青蓝 | 图片轨 |
| `--nomi-track-video` | `oklch(0.65 0.13 150)` | 绿 | 视频轨 |
| `--nomi-snap` | `oklch(0.72 0.18 30)` | 暖橙 | 时间轴吸附反馈（与 accent 蓝互补、对比最大；仅拖动中临时出现）|
| `--nomi-snap-tag` | `oklch(0.45 0.18 30)` | 深橙 | 吸附标签 |
| `--workbench-text` | `oklch(0.56 0.17 305)` | 紫 | 预览时间轴文字轨（字幕/标题卡），与图片轨蓝、视频轨青区分 |

#### 2.1.4 工作区语义色（定义在 workbench.css，⚠️ 这几个是 hex/rgba 落在 ② 层）

> 注：这层语义色在 `workbench.css` 里是 **hex/rgba 直写**（历史原因），不是 oklch token。消费方**只用类名**（`text-workbench-danger` 等），不要把这些 hex 抄进组件。理想态应回收进 ① 层 oklch，见 §14 漂移。

| Token | 实际值 | 用途 |
|---|---|---|
| `--workbench-success` / `-soft` | `#34c759` / `rgba(52,199,89,.12)` | 成功语义 |
| `--workbench-success-ink` | `#248a3d` | 成功态深字 |
| `--workbench-danger` / `-soft` | `#ff3b30` / `rgba(255,59,48,.1)` | 错误语义 |
| `--workbench-video` / `-soft` | `#00a886` / `rgba(0,168,134,.11)` | 视频轨青 |
| `--workbench-hover` | `rgba(60,60,67,.06)` | 通用 hover 底 |
| `--workbench-pressed` | `rgba(60,60,67,.09)` | 通用按下底 |
| `--workbench-backdrop` | `rgba(29,29,31,.16)` | 弹层遮罩 |

#### 2.1.5 连线句柄色（画布连接点，按媒体类型）⚠️ 定义在 globals.css（③ 层）

> 这组 `--handle-color-*` 在 `globals.css` 里有**暗色默认 + 光模式覆盖**两套（光模式才是现役）。⚠️ **当前 src 内 0 个 `var(--handle-color-*)` 消费点**——疑似已死或经其它机制上色，新做连线 UI 前先核实实际取色路径，别假设这就是真相源。光模式值留档备查：

| 类型 | 光模式 hex | 视觉 |
|---|---|---|
| image | `#2563eb` | 蓝 |
| audio | `#0d9488` | 青绿 |
| subtitle | `#ca8a04` | 琥珀 |
| video | `#7c3aed` | 紫 |
| character | `#db2777` | 玫红 |
| any | `#475569` | 灰 |

#### 2.1.6 不允许的颜色

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

| Token | Tailwind 类 | 实际字体栈 | 用途 |
|---|---|---|---|
| `--nomi-font-sans` | `font-nomi-sans`（默认）| `"Inter Variable", Inter, -apple-system, …, system-ui, sans-serif` | 正文、UI 全局 |
| `--nomi-font-display` | **`font-nomi-display`** | `"Fraunces Variable", Fraunces, "Inter Variable", Inter, serif` | 品牌字标「Nomi」、大型显示标题、有"数字/编辑感"的标题 |
| `--nomi-font-mono` | `font-nomi-mono` | `ui-monospace, SFMono-Regular, "SF Mono", Menlo, …` | 代码块、等宽数字 |

**用法铁律：要显示字体永远用类名 `font-nomi-display` / `font-nomi-sans`，不要内联写 `font-[Fraunces,Inter,serif]` 或 `font-[var(--nomi-font-display)]`**——那是绕过 token、各处字栈会漂的写法。

> ✅ **已自托管（2026-06-21）：Inter + Fraunces 变量字体经 `@fontsource-variable/{inter,fraunces}` 打包**，在 `main.tsx` import `wght.css`。族名是 **`"Inter Variable"` / `"Fraunces Variable"`**（变量字体的族名带 Variable 后缀，已置于字栈首位），不再依赖系统是否装了字体——品牌字标 Fraunces 在任意机器/离线都一致渲染。bare `Inter`/`Fraunces` 留作兜底。

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
| `DesignEmptyState` | **全仓统一空态**（居中 icon + 标题 + 说明 + 可选行动）。`density='panel'`(py-20 独立面板) / `'inline'`(py-12 过滤空态)。收口项目库/提示词库/素材库各手写的重复空态 + 「还没有/暂无/没有匹配」措辞不一。⚠️ 仅用于**面板级居中空态**；列表行/popover 里的 `text-micro` 一行内联提示不归它（那是更小的内联 hint，别硬套）。|

### 3.4 表单 forms

`DesignCheckbox` / `DesignTextInput` / `DesignTextarea` / `DesignSelect` / `DesignNumberInput` / `DesignSegmentedControl` / `DesignSwitch` / `DesignFileInput`。Mantine-backed 一致风格。

**`DesignSearchInput`**（`design/searchInput.tsx`）：**全仓统一搜索框**（搜索图标 + pill 描边 + accent 聚焦光环）。收口项目库/提示词库/素材库各手写的搜索框（高度/圆角/占位曾不一）。`size='sm'`(h-[30px] 紧凑面板)/`'md'`(h-9 宽松页)；宽度经 className 给。（注：Mantine 的 `DesignTextInput` 带 `tc-` 残留命名且无图标，不适合做搜索框——用这个。）

**画布上的紧凑表单**：直接用 `<textarea>` + `<input>` + Tailwind token 类，不用 Mantine——节点 composer 就是这么做的。

### 3.5 弹窗 overlays

`DesignModal` / `DesignDrawer`。

**破坏性操作确认**：一律用 `confirmDialog / alertDialog / promptDialog`（promise 风格，`src/design/confirmDialog.tsx`，宿主 `ConfirmDialogHost` 已挂 App 根部）。**禁用原生 `window.confirm/alert/prompt`**——脱设计系统、E2E 驱动自动 dismiss 测不到、Electron/macOS 有焦点丢失史（2026-06-13 审计 A7）。危险动作传 `danger: true`。

**付费生成确认 `SpendConfirmDialog`**（`src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx`，挂一次于工作区根）：全仓**唯一**的付费确认 UI，三种来源共用这一个对话框（不另造并行卡，P1）：
- **用户直发**（`light`）：金币图标（`IconCoin`），多一个「本会话不再提示」。
- **agent 受理**：金币图标，每次必确认（不可 light 抑制）。
- **外部 AI 助手（MCP）驱动**（`source: 'agent'`）：机器人图标（`IconRobot`）+ 副标「经 AI 助手（MCP）驱动」+ 明细行（节点/模型/产物）+ **60s 倒计时**（进度条 + 「N 秒后自动忽略」，到点自动按未确认返回——外部调用方那头在等，不死等）。
- 视觉：`w-[380px] rounded-nomi-lg border-nomi-line bg-nomi-paper shadow-nomi-md`；图标位 `w-8 h-8 rounded-nomi`（agent=`bg-nomi-ink text-nomi-paper`，user=`bg-nomi-accent-soft text-nomi-accent`）；明细行 `border-nomi-line-soft divide-y`；倒计时条 `bg-nomi-ink-05`，剩 ≤10s 转 `bg-nomi-accent`。
- 新增确认来源/字段走 `SpendConfirmRequest`（`spend/spendConfirm.ts`，单一收口），不在别处复制确认弹窗。

### 3.6 导航 navigation

`DesignPagination`。

### 3.7 表格 tables

`DesignTable`。

### 3.8 布局 layout

`DesignPageShell`。

### 3.9 Logo & 品牌身份 identity（全部出自 `src/design/identity.tsx`）

> 这是 Nomi 的脸。**所有「Nomi」字样、logo、加载动画都必须用这里的组件**，禁止手画 svg、禁止手写 `No<span>m</span>i`、禁止用通用 logo/羽毛/火花图标冒充（违 P1 + 2026-06-20 用户已纠）。从 `../../design` import。

#### 3.9.0 Logo mark 解剖（设计不变量）

mark 是 **28×28 viewBox 的圆角方块**：深色底（`oklch(0.22 0.01 80)` = ink）+ 3 个白色图形（两条竖条 `x=5.5`/`x=18.5` + 一条对角 polygon）拼成抽象的「M/N」笔画。圆角 `rx` 按尺寸等比（`size/28*7`，24 档约 6px）。

- **底色永远是 ink（深暖灰），笔画永远纯白。** 不要换底色、不要给 mark 加 accent。
- accent 蓝紫**只出现在字标的中间 m**（`NomiWordmark`），不在 mark 上——这是品牌的色彩分工。

#### 3.9.1 六个品牌组件（含默认尺寸 + 何时用）

| 组件 | 是什么 | 默认尺寸 | 何时用 |
|---|---|---|---|
| `NomiWordmark` | **字标「No·m·i」的唯一真相源**：中间 m = accent + Fraunces，No/i 颜色由 className 控制 | 继承父 font-size（或传 `fontSize`）| 任何要显示「Nomi」文字的地方 |
| `NomiLogoMark` | 纯 logo 方块（无字）| `size=24` | 只需要标记、不需要字标处（消息头像、按钮内、AI 入口）|
| `NomiBrand` | mark + 字标横排 | `markSize=26 wordSize=17` | 完整品牌签名（顶栏、开屏）|
| `NomiAILabel` | mark +「Nomi {suffix}」，suffix 灰字 | `markSize=22 wordSize=14`，`suffix='AI'` | 标注「这是 Nomi 的某个 AI 助手」，suffix 传 `生成`/`创作` |
| `NomiLoadingMark` | **全仓唯一的加载动画**：旋转的 logo mark | `size=18` | 一切 loading/spinner——别自己用 `IconLoader2`+`animate-spin`（§14 有 1 处违规）|
| `NomiStepper` | 创作/生成/预览 三段 pill 切换器 | — | 顶栏工作区切换，唯一处 |

#### 3.9.2 调用点地图（「logo 在哪里调用」——做新东西照这些抄）

| 组件 | 真实调用点（file:line）|
|---|---|
| `NomiBrand` | 顶栏 [NomiAppBar.tsx:81](src/ui/app-shell/NomiAppBar.tsx:81)、开屏标版 [SplashIntro.tsx:382](src/workbench/onboarding/SplashIntro.tsx:382) |
| `NomiLogoMark` | 关于弹层 [AboutNomiPopover.tsx:83](src/ui/app-shell/AboutNomiPopover.tsx:83)、项目库标题 [ProjectLibraryPage.tsx:85](src/workbench/library/ProjectLibraryPage.tsx:85)、助手发言头 [AssistantMessageView.tsx:20](src/workbench/ai/AssistantMessageView.tsx:20)、画布助手 [CanvasAssistantPanel.tsx:603](src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx:603)、创作 AI 面板 [CreationAiPanel.tsx:402](src/workbench/creation/CreationAiPanel.tsx:402)、提示词优化按钮 [NodePromptOptimizer.tsx:109](src/workbench/generationCanvas/nodes/NodePromptOptimizer.tsx:109) |
| `NomiWordmark` | 项目库标题、助手身份行、关于弹层、提示词库 [PromptLibraryPanel.tsx:100](src/workbench/promptLibrary/PromptLibraryPanel.tsx:100)（字标唯一真相源，已全仓收口）|
| `NomiAILabel` | 画布助手头 [CanvasAssistantPanel.tsx:558](src/workbench/generationCanvas/components/CanvasAssistantPanel.tsx:558)（suffix 生成）、创作区头 [CreationWorkspace.tsx:53](src/workbench/creation/CreationWorkspace.tsx:53)（suffix 创作）|
| `NomiLoadingMark` | 路由加载、画布/壳加载、节点生成中 [CardCommon.tsx:134](src/workbench/generationCanvas/nodes/render/CardCommon.tsx:134)、附件上传、导出忙、AssetPicker、按钮 loading 态（`actions.tsx` 内置）等 10+ 处 |
| `NomiStepper` | 顶栏 [NomiAppBar.tsx:173](src/ui/app-shell/NomiAppBar.tsx:173)（唯一处）|

#### 3.9.3 App 图标 / favicon（打包层，非组件）

| 文件 | 用途 |
|---|---|
| [public/nomi-logo.svg](public/nomi-logo.svg) | 浏览器 favicon（[index.html:6](index.html:6) `<link rel="icon">`）+ 营销用。512×512，**fill `#2e2c2a` 是硬编码 hex**（≈ ink 但未对齐 token，§14 漂移）|
| `build/icon.png` / `build/icon.ico` / `release/.icon-icns/icon.icns` | Electron 打包后的应用图标（dock/任务栏/安装包）|

> 改 logo 视觉时这几个文件 + `identity.tsx` 的 mark 路径**必须一起改**，否则 app 图标和 in-app logo 会不一致。

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
| 背景 | `color-mix(in oklch, var(--nomi-paper) 88%, transparent)` + backdrop-blur（2026-06-16 token 化，原 rgba 硬编码已改） |
| 阴影 | `var(--nomi-shadow-md)`（原任意阴影已改） |
| 文字 | `var(--nomi-accent)` |
| 字号 | 11px（`text-micro` 档；原 10.5px 违 §2.3 已改） |
| 字重 | 600（semibold；原 650 已改） |
| 图标 | `IconCopy` 13px stroke 1.8（节点角标档 §6） |
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
| 工作区按钮内图标（`WorkbenchButton`/`WorkbenchIconButton` 的 `[&>svg]` 默认）| **16** | **2** |
| 节点浮动工具栏图标（NodeFloatingToolbar：图片编辑/视频抽帧/全景/下载）| 16 | 1.6 |
| 大引导图标 | 24-32 | 1.5 |
| AppBar / 工具栏图标 | 18 | 1.5-1.6 |
| 弹窗/卡片头部语义图标（付费确认等）| 18 | 默认 |

> ⚠️ **工作区按钮图标是 16 / stroke-2**（实心粗体，2026-06-22 用户拍板恢复）。这是 `WorkbenchButton`/`WorkbenchIconButton` 一直在用、被认可的视觉——曾被「对齐文档」误改成 14/1.6（更细更小）→ 撤销/工具栏图标变丑，已恢复。**文档=现实，别再按「§6 旧值 14/1.6」把它改细。**

**禁止：** size 13.5 / 17 这种非标准；`strokeWidth` prop（Tabler 用 `stroke`）。（stroke-2 仅工作区按钮图标的认可值，见上；其它场景仍按表，别滥用粗笔。）

### 语义图标登记（同一语义全仓复用同一图标，不漂移）

| 语义 | 图标 | 用在哪 |
|---|---|---|
| 付费 / 消耗额度（用户直发或 agent 受理）| `IconCoin` | `SpendConfirmDialog`（§3.5）|
| 外部 AI 助手 / MCP 驱动（agent 身份）| `IconRobot` | `SpendConfirmDialog` 的 `source: 'agent'` 头部（§3.5）|

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

### 焦点环（全局，别再 per-component 加）

所有交互控件的键盘焦点环由**一条全局规则**统一供给（`tailwind.config.ts` 的 `addBase`）：
- `:focus-visible { outline: none }` 先全局杀掉浏览器默认 `outline:auto`——它在 macOS 上**跟系统强调色**，用户设了橙/黄就冒橙环。
- `button / [role=button] / a / input / select / textarea / summary` 的 `:focus-visible` 统一给 `2px solid var(--nomi-focus)` + `outline-offset:2px`。`--nomi-focus` = accent 42%（`:root` 全局 token）。

**纪律**：新按钮**不要**再手写 `focus-visible:outline-*` className——全局规则已覆盖，手写=回到「漏一个就冒橙环」的症状层（2026-06-23 已根治，删了散在 6 文件的 13 处旧写法）。需要无焦点环的特例（如 contenteditable 编辑器）才显式 `outline:none` 覆盖。

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

## 14. 已知漂移 / 清理 backlog（v2 实测，诚实标注）

> 这节是「真实设计反推出来的现状」——文档不再假装代码 100% 合规。每条 = 现状 + 为什么是问题 + 修法。**机器门岗（`check:tokens`）已把 hex/px 这类粗漂移卡到 0**，所以下面是门岗抓不到的结构性 / 系统性漂移。

### 14.1 系统级（影响全局，需用户拍板再动）

> **2026-06-24 暗色重新引入 + 两处真相源校正（动手前必读）**：
> - **暗色回归**：新暗色是**暖灰 oklch 主题**（`tailwind.config.ts` 的 `:root[data-mantine-color-scheme="dark"]` addBase 块），与上面 S1 删掉的那套**蓝黑 `--tc-*` 旧暗色无关**——别把两者搞混。开关默认浅色、首启跟随系统。
> - **真相源校正（重要）**：`src/theme/nomi-tokens.css` / `globals.css` / `vendor-overrides.css` / `animations.css` **未被任何 import = 死参考文件**；`index.html` 只 `<link>` `public/tailwind.generated.css`，其内容由 **`tailwind.config.ts` 的 `workbenchBasePlugin` addBase 编译而来 = 运行时唯一真源**。§0.5 称 nomi-tokens.css 为「① 层真源」是历史说法，**实际改 token 必改 tailwind.config.ts**（nomi-tokens.css 同步只为参考 + 喂 `check-dangling-tokens`）。
> - **顺带修的潜伏 bug**：`--nomi-scrim`/`--nomi-overlay-chip`/`--nomi-overlay-chip-strong`/`--nomi-media-veil`/`--nomi-axis-x/y/z` 此前**只存在于死文件 nomi-tokens.css → 运行时 undefined**（提示词库/技能库/库页 scrim、引导旅途背景、scene3d 轴标全在用空颜色）；已补进 tailwind.config.ts 真源（光+暗）。

| # | 现状 | 为什么是问题 | 修法 |
|---|---|---|---|
| ~~S1~~ ✅ 已清（2026-06-21）| 早期暗色 `--tc-*` 层（`globals.css` 默认 `:root` 全套暗色 hex + body 暗色渐变 + 光模式覆盖块）| 与 light-only 矛盾的休眠暗色主题 | 已删整段 `--tc-*`/`--handle-color-*` + 暗色 body + 暗色 `#root::before`；2 处外部消费（surface-inline→`var(--nomi-ink-05)`、sheen→`color-mix(nomi-ink 10%)`）已迁；body 改 `var(--nomi-bg)`/`var(--nomi-ink)`；保留 `--handle-hit-*` 几何 |
| ~~S2~~ ✅ 已清 | `color-scheme: light dark` | 与 light-only 矛盾 | 已改 `color-scheme: light` |
| ~~S3~~ ✅ 已清 | Inter / Fraunces 未打包 | 品牌字干净机器回退 | 已装 `@fontsource-variable/{inter,fraunces}` 自托管，字栈首位置 `"Inter Variable"`/`"Fraunces Variable"`（§2.6）|
| ~~S4~~ ✅ 已清 | `--handle-color-*` 0 消费点死 token | 死代码 | 已随 S1 删除（连线另有取色路径，确认 0 悬空引用）|
| S5 | 语义色 `--workbench-success/danger/video` 等是 hex/rgba（workbench.css），非 oklch | 与「颜色只在 nomi-tokens.css 写 oklch」不齐（§2.1.4）| 回收进 `--nomi-*` oklch 体系（**未做**，留 backlog）|

### 14.2 组件级（用户可见面 vs 文档不一致，2026-06-21 审计）

> 整体结论：**一致性良好且在持续收口**——核心组件库（WorkbenchButton/NomiSelect/NomiWordmark/confirmDialog/NomiLoadingMark）在主力面已正确复用，品牌字标 + 原生弹窗两条红线**零违规**。问题集中在边缘卡片/浮层各自造按钮 + 侧栏行 off-token 类。

**最该先收口的 3 件事：**
1. **手写 pill 按钮 → `WorkbenchButton` variant**（`variant: default|primary|accent`，`size: md|sm`，见 `actions.tsx:191` 真相源注释「ad-hoc className 各覆写一套 = 不像一个设计风格的根因」）。重灾：`AboutNomiPopover`、`NoTextModelRecoveryCard`、`StoryboardPlanCard`、`ProjectLibraryPage` 二级按钮。
2. **`NoTextModelRecoveryCard.tsx:104` 自造 `IconLoader2` spinner → `NomiLoadingMark`**（全仓唯一一处自造加载动画，破坏品牌加载标）。
3. **侧栏三件套 + 右键菜单 off-token 收口**：`rounded-md`→`rounded-nomi-sm`、`text-nomi-ink-70`→`ink-80`（§2.1.1 中性轴没有 ink-70，是静默失效废类）、右键菜单 `shadow-lg/rounded-md`→`shadow-workbench-pop/rounded-nomi`；library 搜索框手写 inline `<svg>`→`IconSearch`（违 §6）。

**完整漂移清单**（按面，P0/P1/P2）：

| 面 | 位置 | 现状 → 对齐 |
|---|---|---|
| app-shell | `AboutNomiPopover.tsx:15-26` | 自定义 `PRIMARY_BTN/GHOST_BTN` 常量 6 处复用 → `WorkbenchButton` |
| app-shell | `AboutNomiPopover.tsx:151` / `OnboardingChecklist.tsx:226` | 手拼进度条 → `DesignProgress` |
| library | `ProjectLibraryPage.tsx:200` | 手写 inline svg 放大镜 → `IconSearch size={14} stroke={1.6}` |
| library | `ProjectLibraryPage.tsx:266,284` | `hover:text-white`/`bg-white` 透明度类 → 改 `text-nomi-paper`/`bg-nomi-paper/NN`（2026-07-08 起 token 色已支持 /alpha 修饰符，见 §2.1 顶部）|
| sidebar | `CategoryItem/NodeItem/GroupItem` | `rounded-md`+`text-nomi-ink-70` → `rounded-nomi-sm`+`text-nomi-ink-80` |
| sidebar | `CategoryTree.tsx:349` | 右键菜单 `rounded-md/shadow-lg` → token |
| creation | `StoryboardPlanCard.tsx:39` | 手写状态徽章 → `StatusBadge` |
| creation | `CreationAiPanel.tsx:467` | `font-[Fraunces,Inter,serif]` → `font-nomi-display` |
| creation | `CreationAiPanel.tsx:568` | `text-xs` → `text-caption` |
| creation | `SelectionGeneratePopover.tsx:146` | `rounded-lg`(8px) → `rounded-nomi-lg`(16px，注意是视觉变化)|
| ai | `NoTextModelRecoveryCard.tsx:93-119` | 手写 pill ×2 → `WorkbenchButton` primary+default |
| canvas | `AssistantTimeline.tsx:140` | `font-[Fraunces,Inter,serif]` → `font-nomi-display` |
| canvas | 多处图标 stroke 2/1.7/2.2 | 收敛到 §6 档（1.5/1.6/1.8）|
| preview | `TimelinePreview.tsx:667` | `bg-[var(--mantine-color-blue-5,#339af0)]` 混入 Mantine 默认蓝 → nomi token |
| preview | `TimelinePreview.tsx:557` | 播放图标 `stroke={2}` → `1.6` |
| onboarding | `OnboardingChecklist.tsx:271` | 手写主操作 pill → `WorkbenchButton` |

---

## 13. 维护

- 本文档版本 **v2**（真实色值 + Logo 解剖/调用点地图 + §0.5 真相源全景 + §14 漂移诚实标注），对应代码 v0.10.x
- 每次新增 §4 / §5 entry 时 bump 一次小版本
- 重大重构（如颜色系统重设、清理 §14.1 暗色层）bump 主版本（v3）
- 文档过时时优先更新本文档，不依赖代码注释作为 source of truth
- §14 是活清单：每修掉一条，从表里删一条
