# Nomi 设计系统（v2）

日期：2026-06-21（v2 补全：真实色值 + Logo 解剖 + 调用点地图 + 漂移诚实标注）· 2026-09-07 重审（真相源统一 + §14.2 漂移清单重跑 + 动效 token 拆分）
覆盖代码版本：v0.21.0（上一次重审覆盖 v0.10.x，中间 11 个 minor 未重跑）
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
2. **要加/挪任何控件 → 先过 §1.5 控件层级规则（强制）**：判它是 L1 常驻还是 L2/L3/L4，
   查这个面的常驻预算还够不够，确认这个动作**在别处是不是已经有家了**（一功能一个家）。
   跳过这一步 = 又给某个面加一个平铺按钮。
3. 找你要做的东西：
   - 文字 / 颜色 / 间距 / 圆角 → §2 Tokens（绝不写 hex / 随意 px）
   - 按钮 / 表单 / 弹窗 / 标签 → §3 通用组件
   - 节点 / sidebar 行 / 组框 / Toast / 空状态 → §4 工作区专属
   - 视觉模式（节点头部 / 副本角标 / 占位态 …）→ §5 Patterns
4. 找不到 → §9 走新增协议

### 实施阶段（写代码前）

5. Tailwind 类名优先用 token 化的（`text-nomi-ink`、`bg-nomi-paper`、`rounded-nomi`），不写 `#22201b`、`bg-[#fff]`
6. 字体大小用 §2.3 表的 token，不写随意 `text-[13.7px]`
7. 间距用 4 的倍数（4/8/12/16/24），不写 7px 11px
8. 图标全部用 `@tabler/icons-react`，stroke 1.5，size 取 §6 规定

### Review 阶段（合 PR 前）

9. 自查：本 PR 是否引入新 hex / 随意尺寸 / 新 icon 来源？
10. **自查：本 PR 有没有给某个面新增常驻按钮？** 有的话说明它凭什么是 L1（§1.5），
    以及这个动作**在别处是不是已经有入口了**（一功能一个家）
11. 任何"是"都得在 PR description 解释为什么不能用现有 token，并在本文档新增 §entry

---

## 0.5 真相源全景 + 「这东西去哪个文件」速查（先看这张）

> 做任何视觉前，先用这张表定位：**值（色/字/间距/圆角）从哪来、组件从哪 import、新文件放哪、照谁抄。**

### 值的真相源（真源 + 镜像 + 遗留）

> **一句话：改 token = 改 `tailwind.config.ts`，然后把同一个值同步进 `src/theme/nomi-tokens.css`。两处同改，缺一处有测试会红。**

| 角色 | 文件 | 前缀 | 你该怎么用 |
|---|---|---|---|
| **① 运行时真源** | `tailwind.config.ts` 的 `workbenchBasePlugin` addBase（光块 `:root` + 暗块 `:root[data-mantine-color-scheme="dark"]`）| `--nomi-*` / `--workbench-*` | ✅ **新增/修改 token 先改这里。** `index.html` 只 `<link>` `public/tailwind.generated.css`，而它由这段 addBase 编译而来——不改这里 = 运行时看不到 |
| **② 规范镜像（同步义务，不是死文件）** | `src/theme/nomi-tokens.css` | `--nomi-*` | ✅ **改完 ① 必须同步这里。** 它不被任何 import，但有两个真实职责：(a) 喂 `scripts/inject-mockup-tokens.mjs`——样张 HTML 直接 `<link>` 它取真实色值，不同步 = 样张与真机失真；(b) `scripts/colorMixHue.test.mjs:106-125` 逐 token 比对两处定义，漂了当场红 |
| ③ 遗留并行命名 ⚠️ | `tailwind.config.ts` 里的 legacy 块（原 `src/styles/globals.css` 已删）| `--tc-*` / `--handle-color-*` | ❌ **不要用、不要加。** 早期暗色主题残留，全仓 0 个 `var()` 消费点，清理见 §14.1 |

**铁律：加 token = 两处同改（`tailwind.config.ts` → `nomi-tokens.css`）。** ① 决定用户看到什么，② 决定样张和门岗看到什么；只改一处的两种失败模式都栽过——「改了没生效」（只改 ②）和「样张/测试各说各话」（只改 ①）。
> 语义色 `--workbench-*` 的定义必须留在 `:root`——写进类作用域，portal / 库页浮层就解析不到（`check:tokens` 第 6 类当场拦）。

### 组件去哪 import / 新文件放哪

| 你要做的东西 | import 自 / 抄哪 | 新文件放哪 |
|---|---|---|
| 通用按钮/表单/弹窗/徽章/卡片 | `../../design`（`src/design/index.ts`）| `src/design/` |
| 画布节点 / 节点内组件 | `src/workbench/generationCanvas/nodes/` 现有 | 同目录 |
| 画布上的浮层/组框/工具栏 | `src/workbench/generationCanvas/components/` | 同目录 |
| Sidebar 行 / 分类 | `src/workbench/sidebar/` | 同目录 |
| 助手 composer（输入框/附件）| `src/workbench/ai/composer/` | 同目录 |
| **agent 对话流里的任何东西**（工具条/计划卡/付费卡/进度/失败/反问/等待指示器…）| 规格看 **[nomi-agent-interaction.md](nomi-agent-interaction.md)**（Agent 专章：17 种形态 + 统一状态词表 + 动效 + 控件尺寸/等宽规则）| 同文档 §11 拆迁清单指定 |
| Logo / 字标 / 加载标 / 步骤器 | `../../design`（全部出自 `src/design/identity.tsx`，§3.9）| **不新增**，复用 |
| 图标 | `@tabler/icons-react`（§6）| 不自带 svg；**例外**：agent「工序指示器」是受管动效资产，见 agent 专章 §5.1 |

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

## 行布局：附属信息跟随内容流

一行里的耗时、状态、展开箭头和次级动作紧跟说明文字，用 `gap-1.5` 小间距排列；只有主动作（确认/发送）和危险动作允许贴右边缘。Agent 面板统一复用 `V4Row`，不在消费者另写 `ml-auto` / `justify-between` 或给标签加伸展来推远附属。用户气泡的整体靠右不属于附属行，使用 `self-end` 保持对话布局。`check:tokens` 对 AI 目录行尾类硬零，其余生产路径按文件登记存量只减不增。

## 1.5 控件层级规则（强制 · 画图前必过）

> **这份文档过去只管「长什么样」，不管「住哪一层」。** 2026-08-02 全 App 控件盘点（10 个界面、约 620 个可点位）发现：十个界面各自发明了十套摆法——画布左缘 8 个平铺竖条、剪辑页一条 toolbar 横铺 15 个跨 4 类心智、3D 四面包围、节点四面包围再叠 hover 浮条。
> **根因就是这一节缺失。** 补上它，新功能进来才不会又长回去。梳理全文见 `docs/plan/2026-08-02-control-hierarchy-audit.md`。

### 1.5.1 一个判定问题

> **「用户在这个面上，10 次里有几次会用它？」**

| 层 | 频次 | 住哪 | 预算 |
|---|---|---|---|
| **L1 主干** | ≥7/10 | **常驻**，视觉最重 | 每个面 **≤5 个功能簇** |
| **L2 情境** | 3–7/10 | **选中 / hover 才出**，贴目标就近浮现 | 不限，但不许挤进常驻条 |
| **L3 收纳** | 1–3/10 | **一次点击可达的二级**：▾ 菜单 / 参数面板 / 抽屉 | 不限 |
| **L4 溢出** | <1/10 | **⋯ 菜单 / 设置 / 仅快捷键** | 不限 |
| **L0 删** | 0 | 死码、占位、重复入口的第 2..N 个 | — |

**「≤5」按功能簇算，不按按钮个数算。** 播放 / 上一帧 / 下一帧 / 时间读数 / 音量 是一个「播放器簇」，算 1 不算 5。**它是观察指标，不是硬门**——为了凑数把中频控件收起来，是净负收益（见 §1.5.4 反例）。

### 1.5.2 三条硬规则

1. **一功能一个家** —— 同一动作只保留 **1 个规范入口**，其余全删。**快捷键和手势不算入口，算加速器**（可以多，因为不占视觉预算）。
2. **常驻位有预算** —— 要加第 6 个功能簇，必须先降级一个。
3. **情境控件不许挤常驻条** —— 选中才出的东西不能塞进常驻 toolbar，否则布局会抖（剪辑页时间轴头部栽过这个）。

### 1.5.3 手法有优先级：先分组 → 再去重 → 再归位 → 最后才收纳

**「杂」的主因是没秩序，不是数量。** 按代价从低到高选手法，**收纳永远是最后一招**：

| 手法 | 做什么 | 可达性代价 |
|---|---|---|
| **分组** | 控件一个不少，只是有了边界和名字 | 0 |
| **去重** | 同功能的多个入口收成一个 | 0（减的是真冗余）|
| **归位** | 放错地方的搬回它该在的地方 | 0 |
| **就近** | 情境控件搬到它作用的那个对象旁边 | 0（且常驻条不再抖）|
| **收纳** | 收进 ▾ / ⋯ | **+1 次点击** |

配套两条：
- **动作不许压在内容上。** 半透明浮层按钮盖在图 / 视频 / 画布上 = 永久遮挡用户要看的东西。动作归浮条（浮在卡片*上方*）、归工具栏，别归内容角落。
- **分段要有名字。** 一条 toolbar 里塞了多类心智时，光加 `w-px` 分隔线不够（实测真机上淡到看不见）——要有底色或标签，让人知道每段管什么。尤其**作用域不同的控件**（改整片 vs 改当前这一段）必须视觉可分。

### 1.5.4 反例（真实踩过，别重来）

| 反例 | 为什么错 |
|---|---|
| 为了把常驻位压到 5，把「抠图 / 优化提示词 / ×N 变体」收进 ▾ | 这些是中频操作。**「≤5」是观察指标不是硬门**，凑数凑出来的清爽是假的 |
| 把已经是二级菜单的 `切图▾` / `变换▾` 再包进一个 `编辑▾` | **为了少一个按钮让用户多点一次 = 净负收益。** 已经在 L3 的东西不要再降级 |
| 想把「下载」加进节点卡片右上角 | 那个角落的按钮是**半透明常驻压在图上**的。往内容上加动作，方向反了 |
| 想把节点底栏「模型 + 变体 + 参数」合并成一句话 | 模型是用户最看重的一等决策，合并等于把它埋了；**而且那是 2026-07-17 已拍板的形态** |

> **改任何 UI 前先 grep 该组件的注释找「用户拍板」记录。** 写着拍板的形态默认不动，要动必须先说清为什么它不再成立。

### 1.5.5 画**新面**时：上面整节自动失效，改走三件产物（2026-09-07 补）

§1.5.1 的判定问题（「10 次里有几次会用它」）和 §1.5.2 的预算规则，前提都是**这个面已经存在**（有既有常驻条可对照）。
**画一个全新面板时没有 before，整节失效**——而新功能恰恰全是新面。这是「规则写在这儿、界面还是越长越杂」的机械原因。

新面必出这三件，缺一件 = 样张不完整、不进拍板：

1. **任务卡**（开画前一行字）：「<谁> 在 <什么时刻>，做完 <哪一件事> 就走。」← 这行就是这张样张的验收标准，替代缺失的 before。一张卡只描述一个时刻。
2. **三版减法梯度**（不是风格梯度）：**v1 只有一件事**（刻意「少得让人不安」）／ v2 +1 ／ v3 全都要。**默认推荐 v1，让用户往上加**（2026-09-07 用户拍板）。
   > 底层逻辑：**把举证责任翻过来**——从「想删的人得说服我」变成「想加的人得说服我」。人对着满图做不了减法，因为每个按钮都有它的理由。
3. **删除清单**跟着样张走：`我没放上去的 / 为什么 / 用户要它时怎么找到`。样张只展示「放了什么」、看不见「没放什么」，这张表让不可见的决策变可见。
4. **卡点表**（2026-09-07 补）：前三件管**构图**（一屏上有多少东西），这件管**路径**（用户走一条路会卡在哪）。四问 —— ① 他怎么知道有这个功能？② 动手前知不知道要付出什么（配置/花钱/等待/不可逆）？③ 空了/错了他看到什么？④ 凭什么信结果是对的、错了怎么回头？
   底部必答：**这条路几步、能不能砍掉一步**（步骤数由结构决定，实现完就改不动了）。每行要有证据（`file:line` 或「没做，因为 X」），留空不算。
   > **减法本身会制造路径问题**：把选项收起来构图赢了，但用户想用时找不到入口。所以删除清单第三列的每一句承诺，都要在卡点①里被验证。

**详解与代价说明在 `docs/design/page-design-process.md` §2.5（真相源，本节是它的索引）。**

---

## 1.6 控件交互契约（强制 · 有门岗）

> §1.5 管「控件住哪一层」，这一节管「控件**说到做到**」。
> 起因：剪辑页那个「显示」下拉写成 `onChange={(v) => { if (framingClipId) setTimelineClipFraming(...) }}` 却没有 `disabled`，
> 播放头停在片段空隙时点它 → if 短路 → **完全没反应、界面也不解释**。
> 它活过了七道门岗、3634 个单测、多轮人眼走查——因为「语法对、语义错」：纯函数全对，
> 错的只有「界面承诺可点、实际什么都不做」这层契约。同类在本仓**至少第 5 次**
> （3D 空态启动器 / 连线参考图 / 死的 + 图标 / 确认落画布…）。

### C1 可点即有效，否则禁用并说明为什么 —— `pnpm run check:controls` 拦

任何控件，只要它的 handler 里有**目标守卫**（拿不到目标就不做事），就**必须**同时：
① 守卫为假时 `disabled`；② 用 `title` 说清「为什么现在点不了」。

**禁用的 `<button>` 自己不触发 `title`**（浏览器行为），要靠外层包一层：

```tsx
<span title={reason} style={{ display: 'contents' }}>
  <WorkbenchButton disabled={!canDo}>生成</WorkbenchButton>
</span>
```
（既有范式：`NodeGenerationComposer.tsx` 的主生成钮。）

门岗用 TypeScript AST 判，刻意收窄到**零误报**——它只抓「目标守卫」，不碰这四类：
事件判定（`event.target === event.currentTarget`）、鼠标键过滤（`event.button !== 0`）、
模式守卫（`if (splitMode) return`，另一个模式自有处理）、锁复检。
判据核心：**守卫的那个变量被当参数传给了动作**（`if (id) doSomething(id, …)`）。

### C2 作用域跟「选中」走，不跟播放头/hover 悄悄漂

对象级控件（片段属性、节点参数…）的作用对象**必须来自用户选中**。
查过 Final Cut Pro / Adobe Firefly / OpenCut 源码：三家一律 selection-driven，播放头只决定**渲染**哪些内容；
DaVinci Resolve 确实有「选中跟随播放头」，但它是 **opt-in 且默认关闭**的加速档。无条件跟播放头是反模式。

若产品确需跟播放头，**必须同步把那个对象真的选中并高亮**，不能偷偷改一个隐藏目标
（`TimelinePreview` 的舞台拖拽就是这么做的：拖谁就先选中谁）。

**结构保证**：把作用域抽成纯函数（如 `resolveFramingTarget(timeline, selectedClipIds)`），
签名里根本不出现 playhead —— 在类型层就堵死漂移，再配不变量测试。

### C3 不同作用域不混排

整体级与对象级控件不得在同一条无标签的行里长成同款。跨作用域**必须分组、每组带名字**，
对象级那组还要**写出当前对象名**（如「这一段 · 镜 3」）、没有对象时整组禁用。
参考 `PreviewControlBar.tsx`：传输 / 整片 / 这一段 / 叠加 四组。

> 真机实测教训：光加 `w-px` 分隔线不够——那 5 道线在真机上淡到基本看不见，等于没分。

### C4 禁用不做沟通死路

任何 `disabled` 的控件都要能让用户知道**为什么点不了**（`title` 或就近 hint）。
这条**没做成硬门**——全仓 100+ 处 `disabled={readOnly}` 语境自明，硬拦必成噪音；
它靠 R13 走查断言兜（禁用态必须可解析到原因文本）。

---

## 1.7 设置区信息架构（强制 · 往设置里加东西前必过）

> **§1.5 管「一个面里控件住哪一层」，这一节管「设置对话框里一个东西住哪个 tab」。** 两者是同一个「一功能一个家」原则的两个尺度。
> **根因（2026-09-01 用户真机反馈）**：TikHub 数据源接入卡被放进了「AI 策略」tab——它是**数据源接入**，不是 AI 策略。「系统级的词也不能这么放。」错配的家会让用户在错误的 tab 下翻找（正是「改 api url 翻半天找不到」那一类可发现性 bug 的根，见 `vendor-manage-is-a-discoverability-problem`）。
> 设置对话框外壳：`src/workbench/settings/SettingsDialog.tsx`（六 tab，左 tab 右内容）。

### 1.7.1 六个 tab 各收什么（判据 = 「这个设置服务于哪个名词」）

| tab | id | 收什么（判据） | 现役住户（真相以代码为准） |
|---|---|---|---|
| **文件与保存** | `file` | 「**文件落在哪、项目存在哪**」——本机磁盘/路径/自动另存这一类 I/O 设置 | 自动另存开关+目录、新项目默认位置 |
| **模型** | `models` | 「**接入了什么外部能力**」——BYO-key 供应商、本地运行时、会员通道、以及**数据源 connector**。凡是「填一把 key / 连一个地址 / 装一个本地服务，换来一种可调用能力或一路素材数据」的，家都在这里 | 模型供应商卡（apimart/kie/自定义…）、ComfyUI 实例、即梦会员、Codex 本地、Antigravity、**TikHub 数据源**、网络/代理（高级） |
| **AI 策略** | `ai` | 「**AI 怎么替我干活 + 花钱护栏**」——默认模型策略、数据上传边界、系统提示词、硬预算。**注意：是「策略/规则」，不是「接入」**——这里一个 key 都不填 | 新建卡片默认模型、数据上传通道与最小化、默认模型策略+硬预算、系统提示词 |
| **自动化与权限** | `automation` | 「**谁被允许替我做到什么程度**」——制作模式、支出/风险边界、MCP 连接与可信发起方、通知 | 默认制作模式、支出边界、MCP 连接、可信发起方、任务通知 |
| **通用** | `general` | 「**这台机器上的偏好**」——与业务无关的个人偏好项 | 语言、外观、全局截图热键、画布滚轮手势 |
| **关于** | `about` | 「**这个 app 本身**」——版本、致谢、重播开屏 | 版本信息、重播 splash |

### 1.7.2 「接入」vs「策略」的分界线（这次错配的判据）

**这是最容易放错的一刀，务必分清：**
- **接入（→「模型」tab）**：填 key / 连地址 / 装服务，**换来一种新能力或一路数据**。判据自检：*「删掉它，是不是就少了一种能连的东西？」* 是 → 它是接入，家在「模型」。TikHub 就是这类（删掉它就不能把分享链接变素材了）。
- **策略（→「AI 策略」tab）**：**在已接入的能力之上**定「默认用哪个 / 花多少钱 / 上传什么」的规则。判据自检：*「它是不是在别处已经接好的东西上做选择/设限？」* 是 → 它是策略。
- **一句话记**：**接入决定「有没有」，策略决定「怎么用」。** 数据源/供应商/本地服务是「有没有」，归「模型」；默认值/预算/上传边界是「怎么用」，归「AI 策略」。

> ⚠️ 数据源 connector（如 TikHub）与模型供应商**都在「模型」tab**，但**分组要分开**（§1.5.3 先分组）：模型供应商产出「可调用模型」，数据源产出「素材数据」——把数据源混进模型家清单是 P4 错配。现役实现：`ModelSettingsHome` 里「数据源」独立成一个 `SectionHeading` 分组（`data-model-home-data-sources`），与模型家清单并列、不混排。

### 1.7.3 加设置前必答三问（对照 §1.5）

1. **它服务于哪个名词？**（文件 / 外部能力 / AI 行为 / 权限 / 机器偏好 / app 自身）→ 落到对应 tab。答不出唯一名词 = 还没想清楚，别急着放。
2. **这个 tab 里是不是已经有它的家？**（§1.5.2 一功能一个家）——先找现役分组能不能收，**别习惯性新开 tab / 新开入口**。手法优先级仍是**先分组 → 再去重 → 再归位 → 最后才收纳**。
3. **它在这个 tab 里该是常驻还是收进折叠？**（§1.5.1 L1/L3/L4）——高频看的平铺，低频/高级的（如 TikHub 的「线路」、模型的「网络/代理」）收进折叠行，只在相关时出现，别给未配置用户添噪。

> 深链纪律：从别处「去配置 X」跳设置，必须同时给对 `tab` 与 `section`（`nomi-open-settings` 事件的 `detail`）。搬家改 tab 时，**同步改所有深链的 tab 值**（这次把素材库「去配 TikHub」的深链从 `ai` 改到 `models`），否则跳到空 tab = 又一个可发现性 bug。

---

## 2. 设计 Tokens（单一真相源）

**所有数值都来自这里。** 三个源文件，按层级组合：

| 层级 | 文件 | 内容 | Tailwind 暴露 |
|---|---|---|---|
| 底层颜色（OKLCH）| `src/theme/nomi-tokens.css` | `--nomi-bg` / `--nomi-paper` / `--nomi-ink*` / `--nomi-line*` / `--nomi-accent*` / `--nomi-shadow-*` / `--nomi-radius-*` / `--nomi-font-*` | `nomi-*` 颜色类、`rounded-nomi` |
| 工作区映射 | `tailwind.config.ts` addBase `:root`（光/暗两块）| `--workbench-*`（基于 nomi 但提供工作区语义命名）| `workbench-*` 颜色类 |
| 几何/排版（TS）| `src/theme/nomiTheme.ts` 中的 `nomiDesignTokens` | `radius` / `spacing` / `fontSize` / `lineHeight` / `shadow` | Tailwind config 引用 |

### 2.0 浮层层级（z-index）—— 只有这一份刻度，禁止硬写数字

**工作区浮层必须可关闭**：任何浮在工作区上的元素都必须能关掉；关闭后完全消失，不留残余高度或占位。还原入口在常驻 chrome，关闭选择按用户记住；新消息或待确认不得擅自弹回。避让只是次选，不能代替关闭权。Agent 输入坞的还原是顶栏角标展开面板，之后再收起仍尊重关闭选择。

真相源 `src/design/overlayLayers.ts` 的 `NOMI_OVERLAY_Z_INDEX`，六档（低→高）：
`floatingPanel 4000` < `applicationModal 9000` < `dialog 9100` < `popover 9200` < `confirmation 9300` < `feedback`。

| 写在哪 | 怎么写 |
|---|---|
| TS / style 对象 | `style={{ zIndex: NOMI_OVERLAY_Z_INDEX.dialog }}` |
| className | `z-floating-panel` / `z-application-modal` / `z-dialog` / `z-popover` / `z-confirmation` / `z-feedback` |

className 那一列是 2026-09-07 补的**合法出口**：Tailwind 默认 `zIndex` 刻度只到 50，
在此之前 className 侧根本写不出 4000–9300，于是画布/素材库五处浮层只能硬写 `z-[9999]`/`z-[10000]`，
**全部压过花钱确认卡（`dialog` 9100）**——浮层开着时弹付费确认，钱要花出去了那张卡却看不见
（`AssetPreviewDialog` / `PanoramaViewer` 这两处 portal 到 `document.body`，已真机实测复现；
另三处 portal 到 `.workbench-generation__canvas`，被祖先的 `isolation: isolate` 圈住，属契约违反但当时未可达）。
CSS 变量（`--nomi-z-dialog` …）与 Tailwind 刻度都由那份 TS 常量在 `tailwind.config.ts` 里派生，
**数字只有一份**，不许两处各写一遍。走查：`tests/ux/overlay-z-order.walk.mjs`（带阳性对照）。

**判档口径**：接管整个工作区/整屏的查看器与任务层 → `applicationModal`；
承载一次决策的对话框（含花钱确认）→ `dialog`；菜单/下拉/气泡 → `popover`；
破坏性二次确认 → `confirmation`；toast 一类通知 → `feedback`。

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

##### 2.1.2b 状态色（四语义 × 四档，2026-09-07 用户拍板「候选 C」）

三条约束（抄 Primer / Geist / Linear 的克制）：

1. **base 亮度平台对齐 accent**（浅 `0.55` / 暗 `0.70–0.72`）——语义靠**色相**区分，不靠「谁更亮更艳」。
2. **彩度 ≤ accent 的 0.13**（warning/success 压到 `0.085–0.09`）——状态色不许抢 accent 的戏。
3. **`-soft` / `-edge` 是色阶上独立的一档，不是 base 的 alpha**。

> ⚠️ 第 3 条是 2026-09-07 修掉的一次**错规格**。初版写成 `color-mix(base 18%, transparent)`，把 L0.55 的暗 base 摊薄成浅底，实测落在 **L≈0.92** —— 比成熟系统的浅底档暗 4 个点，看上去发灰发土（警告条从奶油变米灰、错误条从淡粉变脏粉）。那是 GitHub 的**暗色 chip** 配方，套到浅色上不成立。
>
> 实测参照：Geist `red-200` `#FFEBEB` = `L0.960 C0.022`；Mantine 浅底 `L 0.959–0.977 / C 0.017–0.024`。都是独立一档，且**贴着 sRGB 色域天花板**——L≥0.955 时红/蓝色相的最大彩度只有 `0.020–0.023`，所以浅底不可能「又浅又艳」，只能取到天花板的九成。暗色底则走低亮度路线（`L≈0.29 / C≤0.05`），两套值必须分别写，不能靠 alpha 自动翻。

| Token | 浅色 | 暗色 | 用途 |
|---|---|---|---|
| `--nomi-danger` | `oklch(0.55 0.13 25)` | `oklch(0.72 0.13 25)` | 失败、破坏性操作 |
| `--nomi-danger-ink` | `oklch(0.45 0.13 25)` | `oklch(0.82 0.13 25)` | danger chip 上的小字 |
| `--nomi-danger-soft` | `oklch(0.955 0.021 25)` | `oklch(0.3 0.048 25)` | danger chip / 行底 |
| `--nomi-danger-edge` | `oklch(0.895 0.052 25)` | `oklch(0.4 0.07 25)` | danger chip 描边 |
| `--nomi-warning` | `oklch(0.55 0.085 72)` | `oklch(0.72 0.085 72)` | 需确认、能力缺口提示 |
| `--nomi-warning-ink` | `oklch(0.45 0.085 72)` | `oklch(0.82 0.085 72)` | warning 小字 |
| `--nomi-warning-soft` | `oklch(0.968 0.024 72)` | `oklch(0.295 0.04 72)` | warning 底 |
| `--nomi-warning-edge` | `oklch(0.905 0.07 72)` | `oklch(0.395 0.058 72)` | warning 描边 |
| `--nomi-success` | `oklch(0.55 0.09 145)` | `oklch(0.72 0.09 145)` | 完成、已导出 |
| `--nomi-success-ink` | `oklch(0.45 0.09 145)` | `oklch(0.82 0.09 145)` | success 小字 |
| `--nomi-success-soft` | `oklch(0.962 0.033 145)` | `oklch(0.295 0.042 145)` | success 底 |
| `--nomi-success-edge` | `oklch(0.905 0.07 145)` | `oklch(0.395 0.06 145)` | success 描边 |
| `--nomi-info` | `var(--nomi-accent)` | 同左（accent 自己翻） | 中性提示、排队中 |
| `--nomi-info-ink` | `oklch(0.45 0.13 250)` | `oklch(0.82 0.13 250)` | info 小字 |
| `--nomi-info-soft` | `oklch(0.957 0.021 250)` | `oklch(0.295 0.045 250)` | info 底 |
| `--nomi-info-edge` | `oklch(0.9 0.048 250)` | `oklch(0.395 0.065 250)` | info 描边 |

> ⚠️ **`-ink` 不是可选装饰**。base 压在自己的 soft 底上对比只有 **4.25–4.51**（真机 Chromium canvas 采样，非推算），够不到 WCAG AA 小字的 4.5。用 `-ink` 后实测 **6.48–6.90**（浅）/ **7.19–8.09**（暗），四语义 × 明暗八格全部 ≥4.5。写 chip 小字一律 `text-nomi-<语义>-ink`，不要直接用 base。
>
> ⚠️ **`info` 就是 `accent` 本身（别名，不是第二个蓝）**。2026-09-07 修：初版给 info 单写 `oklch(0.55 0.09 250)` —— 与 accent 同色相、同亮度、只差 `ΔC 0.04`，小 chip 上「提示」和「主操作」根本分不开，等于一份并行版（P1）。成熟系统本来就用品牌蓝当 info（Primer 的 accent 兼任 info、Geist 用 blue 表 info/production），故收成别名。`-ink` / `-soft` / `-edge` 三档按上面的规则从 accent 的色相彩度派生。

##### 2.1.2c Mantine 色板重映射（第三个出口）

Mantine 组件的 `color` prop 收的是**色板名**（`red` / `grape` / `teal`…），不是我们的语义 token。`tailwind.config.ts` 的 `mantineSemanticPalette()` 把 12 个色板名全部收进四个语义（`red|pink→danger`、`yellow|orange→warning`、`green|teal|lime→success`、`blue|cyan|indigo|violet|grape→info`），中性的 `gray`/`dark` 不动。

这层是**第二道防线**；根因防线在组件层：`StatusBadge` / `DesignBadge` 都只收封闭的 `tone` 词表（`neutral|info|success|warning|danger`），不透传裸 `color`。

#### 2.1.3 时间轴轨道色（媒体类型区分，定义在 `tailwind.config.ts` addBase，镜像在 `nomi-tokens.css`）

| Token | 实际值 | 视觉 | 用途 |
|---|---|---|---|
| `--nomi-track-text` | = `--nomi-accent` | 蓝紫 | 文字轨（与 accent 同源）|
| `--nomi-track-image` | `oklch(0.7 0.13 200)` | 青蓝 | 图片轨 |
| `--nomi-track-video` | `oklch(0.65 0.13 150)` | 绿 | 视频轨 |
| `--nomi-snap` | `oklch(0.72 0.18 30)` | 暖橙 | 时间轴吸附反馈（与 accent 蓝互补、对比最大；仅拖动中临时出现）|
| `--nomi-snap-tag` | `oklch(0.45 0.18 30)` | 深橙 | 吸附标签 |
| `--workbench-text` | `oklch(0.56 0.17 305)` | 紫 | 预览时间轴文字轨（字幕/标题卡），与图片轨蓝、视频轨青区分 |

#### 2.1.4 工作区语义色（定义在 tailwind.config.ts addBase `:root`，② 层）

> 注：**状态色三族（success / danger / warning）已在 2026-09-07 收口成 ① 层 `--nomi-*` 的别名**，不再各写一份 iOS hex。那份 hex 曾是与根层 oklch 并行的第二真相源：两边各自漂移，明暗切换只有一边跟着动。现在 `--workbench-danger: var(--nomi-danger)`，全仓 240 处消费点零改动跟着变；暗色块也不再重定义它们（`--nomi-*` 自己翻，工作区层自动跟）。
>
> 剩下的 hex/rgba（video / hover / pressed / backdrop 等）是**非状态语义**（轨道色、交互底），仍在 ② 层直写——它们不参与状态语义体系，本轮不动。消费方**只用类名**（`text-workbench-danger` 等），不要把值抄进组件。定义在 `:root` 而非 `.workbench-shell` 作用域——CSS 变量沿 DOM 继承，作用域定义会让 portal / 库页浮层静默退灰（2026-08-24 收口，docs/plan/2026-08-24-workbench-token-root-scope.md）。

| Token | 实际值 | 用途 |
|---|---|---|
| `--workbench-success` / `-soft` / `-ink` | `var(--nomi-success)` / `-soft` / `-ink` | 成功语义（① 层别名）|
| `--workbench-danger` / `-soft` / `-ink` | `var(--nomi-danger)` / `-soft` / `-ink` | 错误语义（① 层别名）|
| `--workbench-warning` / `-soft` / `-ink` | `var(--nomi-warning)` / `-soft` / `-ink` | 警示语义（① 层别名）|
| `--workbench-video` / `-soft` | `#00a886` / `rgba(0,168,134,.11)` | 视频轨青 |
| `--workbench-hover` | `rgba(60,60,67,.06)` | 通用 hover 底 |
| `--workbench-pressed` | `rgba(60,60,67,.09)` | 通用按下底 |
| `--workbench-backdrop` | `rgba(29,29,31,.16)` | 弹层遮罩 |

#### 2.1.5 连线句柄色（画布连接点，按媒体类型）⚠️ ③ 层遗留，别当真相源

> 这组 `--handle-color-*` 现住 `tailwind.config.ts` 的 legacy 块（原 `src/styles/globals.css` 已删）。⚠️ **全仓 0 个 `var(--handle-color-*)` 消费点**（2026-09-07 复核）——连线另有取色路径，新做连线 UI 前先核实实际取色路径，别假设这就是真相源。历史值留档备查：

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

**时长和缓动是两个 token，永远分开。**

| Token | 值 | Tailwind 类 | 用途 |
|---|---|---|---|
| `--nomi-duration-fast` | `140ms` | `duration-nomi-fast` | 所有交互过渡的默认时长 |
| `--nomi-ease-fast` | `cubic-bezier(.2, .7, .3, 1)` | `ease-nomi-fast` | 所有交互过渡的默认缓动 |

**标准写法**（三段齐全：property + duration + easing）：

```tsx
className="transition-[background,color] duration-nomi-fast ease-nomi-fast"
```

**❌ 禁止把时长和缓动打包成一个 token**（2026-09-07 修掉的真实 bug，见 §10 最后一条）：曾经只有一个
`--nomi-transition-fast: 140ms cubic-bezier(.2,.7,.3,1)`，写法是 `duration-[var(--nomi-transition-fast)]`。
`transition-duration` 只接受 `<time>`，拿到 `140ms cubic-bezier(...)` 这个复合值**整条声明作废**，
`getComputedStyle(el).transitionDuration` 实测 `0s`——不是回退到浏览器默认 150ms，是**完全没有过渡**。
全仓 77 处中招，且 77 处全都同时声明了 `transition-property`，即全部是「设计成要动、实际硬切」。

**❌ 也禁止：** 自己写 `transition-[opacity_300ms_ease-out]` 这种把三段塞进一个任意值的写法——绕过 token，各处节奏会漂。

---

## 3. 通用组件库（`src/design/`）

入口：`import { ... } from '../../design'`（即 `src/design/index.ts`）。**优先用这里现有的，能不写新组件就不写。**

### 3.1 表面 surfaces

**这一族现在是空的。** 2026-09-07 复核：`PanelCard` / `InlinePanel` / `surfaces.tsx` 全仓零命中——
这两行推销了两个**从来不存在**的组件（照着写 `import { PanelCard }` 直接编译失败）。
面板/卡片表面目前由各面自己用 token 类拼（`rounded-nomi border-nomi-line bg-nomi-paper`）。
要不要长一个真的表面原语，属于 D 档刀 1 之后的判断，不在这里假装已有。

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

| 组件 | 用途 | 采纳现状（2026-09-07 实测）|
|---|---|---|
| `DesignBadge` | 通用语义徽章，收**封闭 tone 词表**（neutral/info/success/warning/danger），不透传裸 `color` | ⚠️ **生产 0 调用**。保留待推广——画布侧另有 5 份手写徽章（`NodeQueuedBadge` / `NodeLockBadge` / `NodeDeconstructionBadge` / `TechnicalReviewBadge` / `ShotMountBadges`）|
| `StatusBadge` | 同一套 tone 词表，`radius='md'` + 字距，形态偏「状态胶囊」 | ⚠️ **生产 0 调用**（旧文写的「含 data-status 切换样式」不存在，它只有 `tone`）。与 `DesignBadge` 是近重复，合并归属刀 4 |
| `DesignProgress` | 进度条 | 4 个文件 |
| `DesignEmptyState` | 面板级空态（居中 icon + 标题 + 说明 + 可选行动）。`density='panel'`(py-20) / `'inline'`(py-12) | 9 个文件（库页/面板族）。⚠️ **画布节点族没收口**：`nodes/render/NodeEmptyState.tsx`（+ `CardCommon.tsx:55` 的 `EmptyStateLauncher`）、`NodeDeconstructionPanel.tsx:326`、`components/CanvasEmptyState.tsx` 三份并行——它们在 ~180px 卡片里排版且本身可点，是另一个形态，要合并得先定形态。仅用于面板级居中空态；列表行/popover 的 `text-micro` 一行内联提示不归它 |

> 2026-09-07 删除：`DesignAlert`（生产 0 调用，且透传裸 Mantine `color` 绕过 tone 词表）。

### 3.4 表单 forms

`DesignCheckbox` / `DesignTextInput` / `DesignTextarea` / `DesignNumberInput` / `DesignSegmentedControl` / `DesignSwitch`。Mantine-backed 一致风格。
**没有 `DesignSelect`**（旧文列过，它从不存在）——选择器用 `NomiSelect`（27 个文件在用）。
2026-09-07 删除 `DesignFileInput`：生产 0 调用，而全仓 13 处文件选择走的是「隐藏 `<input type="file">` + 自己的按钮」，与 Mantine 的可见文本框不是同一形态。

**`DesignSearchInput`**（`design/searchInput.tsx`）：搜索框（搜索图标 + pill 描边 + accent 聚焦光环），**7 个文件已收口**；另有 3 处更小的内嵌过滤框（`ModelEnableEditor.tsx:92` / `ComfyuiTemplateLibrary.tsx:144` / `AssetPicker.tsx:79`）尚未收口——它们比 `size='sm'` 还矮，要收得先加一档更紧凑的 size。`size='sm'`(h-[30px] 紧凑面板)/`'md'`(h-9 宽松页)；宽度经 className 给。（注：Mantine 的 `DesignTextInput` 没有搜索图标，不适合做搜索框——用这个。`tc-*` 残留钩子已于 2026-09-07 全数删除，只留走查锚点 `tc-action-card`。）

**画布上的紧凑表单**：直接用 `<textarea>` + `<input>` + Tailwind token 类，不用 Mantine——节点 composer 就是这么做的。

### 3.5 弹窗 overlays

`DesignModal`（8 个文件）。2026-09-07 删除 `DesignDrawer`：生产 0 调用，且全仓没有抽屉形态
（`OnboardingDrawer` 名字里带 Drawer，实际是设置对话框里的一页，不走 Mantine `Drawer`）。

**锚点浮层**：`AnchoredPopover`（2 个文件）。⚠️ 它**不是**「全站唯一的浮层定位机制」——
全仓实有四套（本组件 / Radix tooltip / Mantine Modal / **8 处手写 `getBoundingClientRect()+createPortal`**），
详见 `src/design/AnchoredPopover.tsx` 顶部注释里的逐处清单与收口方向。

**破坏性操作确认**：一律用 `confirmDialog / alertDialog / promptDialog`（promise 风格，`src/design/confirmDialog.tsx`，宿主 `ConfirmDialogHost` 已挂 App 根部）。**禁用原生 `window.confirm/alert/prompt`**——脱设计系统、E2E 驱动自动 dismiss 测不到、Electron/macOS 有焦点丢失史（2026-06-13 审计 A7）。危险动作传 `danger: true`。

**付费生成确认**：语义单一收口在 `SpendConfirmRequest`（`spend/spendConfirm.ts`），但**宿主按「用户此刻人在哪」分两个**（2026-08-27 用户裁定，解 master plan §4.4 与本节旧文「全仓唯一弹窗」的冲突）：

| 用户此刻在哪 | 确认长在哪 | 状态 |
|---|---|---|
| 正在跟内嵌 agent 对话 | **对话流内的付费富卡**，对话暂停等回答（不弹居中窗——弹窗会打断「对话主驾」心流） | 🚧 待建，随 B5 落；规格见 [nomi-agent-interaction.md](nomi-agent-interaction.md) |
| 画布上自己点生成（`light`） | `SpendConfirmDialog` 居中弹窗，金币图标 + 「本会话不再提示」 | ✅ 现役 |
| 人不在 Nomi，外部 MCP 驱动（`source: 'agent'`） | `SpendConfirmDialog` 居中弹窗 —— 这是唯一该「召唤注意力」的场景 | ✅ 现役 |

`SpendConfirmDialog`（`src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx`，挂一次于工作区根）= **非对话场景**的唯一付费确认 UI：
- 外部 MCP 驱动额外带：机器人图标（`IconRobot`）+ 副标「经 AI 助手（MCP）驱动」+ 明细行（节点/模型/产物）+ **60s 倒计时**（进度条 + 「N 秒后自动忽略」，到点按未确认返回——外部调用方那头在等，不死等）。
- 视觉：`w-[380px] rounded-nomi-lg border-nomi-line bg-nomi-paper shadow-nomi-md`；图标位 `w-8 h-8 rounded-nomi`（agent=`bg-nomi-ink text-nomi-paper`，user=`bg-nomi-accent-soft text-nomi-accent`）；明细行 `border-nomi-line-soft divide-y`；倒计时条 `bg-nomi-ink-05`，剩 ≤10s 转 `bg-nomi-accent`。
- 两个宿主**共用同一个 `SpendConfirmRequest` 与同一份明细内容组件**（一语义两投影，不是两套逻辑）。新增确认来源/字段只改 `spendConfirm.ts`，不在别处复制确认 UI。

### 3.6–3.8 导航 / 表格 / 布局 —— 2026-09-07 整族删除

`DesignPagination` / `DesignTable` / `DesignPageShell` 三件全部生产 0 调用，且都没有等待中的用户：
全仓没有任何分页界面；分镜表用自己的 `TableStage`（`devlab/designLab/storyboard/storyboardLabKit.tsx`）；
`DesignPageShell` 只是 4 个 Tailwind 类的一层 div。要分页/表格时按当时的真实需求重新包一层，
那时才有真实调用点来验它（`DesignPagination` 此前就是因为没人用，坏了整整一轮都没人发现——
实验室基线 `ps-13` 里 `value=1` 和 `value=4` 渲染完全一样）。

### 3.9 Logo & 品牌身份 identity（全部出自 `src/design/identity.tsx`）

> 这是 Nomi 的脸。**所有「Nomi」字样、logo、加载动画都必须用这里的组件**，禁止手画 svg、禁止手写 `No<span>m</span>i`、禁止用通用 logo/羽毛/火花图标冒充（违 P1 + 2026-06-20 用户已纠）。从 `../../design` import。

#### 3.9.0 Logo mark 解剖（设计不变量）

mark 是 **28×28 viewBox 的圆角方块**：深色底（`oklch(0.22 0.01 80)` = ink）+ 3 个白色图形（两条竖条 `x=5.5`/`x=18.5` + 一条对角 polygon）拼成抽象的「M/N」笔画。

- **圆角 `rx` 恒为 `7`（viewBox 单位 = 边长 25%），不随渲染尺寸变化。** 缩放由 viewBox 自动负责：渲染到 24px 时屏幕上约 6px 圆角，**但那是结果，不是要写回 `rx` 的值**。
  > ⚠️ 这句原先写作「圆角 `rx` 按尺寸等比（`size/28*7`，24 档约 6px）」——把「渲染后的像素半径」当成了属性值。`NomiBrand` 照此实现，造成**双重缩放**：`markSize` 一大，`rx` 就超过半边长 14，被 SVG 截断成**正圆**。开屏标版把 mark 钳在 56–96px（实测 75px → `rx=19`），于是它一直是个圆，而 README／favicon／系统图标都是圆角方——用户两次反馈「logo 圆、产品方」皆源于此。2026-09-02 修正，并由 `src/design/identityMarkGeometry.test.ts` 按多个尺寸钉死（只测默认尺寸会漏：26 档恰好算出 7）。
- 几何只有一份：`src/design/identity.tsx` 的 `NomiMarkShapes`，`NomiBrand` 与 `NomiLogoMark` 共用，并与 `public/nomi-logo.svg` 逐项比对。

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

### 4.1 节点框外标签行

用户 2026-09-09 02:05 / 02:20 / 22:45 裁决为准：镜头号、标题、参考与状态放在图片**左上角上方**，生成前后位置相同，不占媒体区。03:00 的媒体内左上状态、左下编号方案作废。

共同 owner：`src/workbench/generationCanvas/nodes/NodeLabelRow.tsx`。镜头编号与标题继承标签行的 `text-caption`（12px 可读下限），使用 `font-normal text-nomi-ink-60`，淡化靠次级墨色；单行高 28px，底边在节点上沿外 6px，长内容截断。标签随节点移动和缩放；缩放低于 40% 隐藏整行，20% 全景不逆向放大占邻图。

`FloatingToolbarShell` 的底边在节点上沿外 40px，严格位于标签行上方；菜单向上展开，不跨标签行或媒体。动作选中时出现，常驻信息不得另在媒体内设置定位。自动化证据：`tests/ux/node-label-outside.e2e.mjs`（空、图、视频、选择、缩放、放大预览）。

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

- 普通态只有一套共享视觉契约：`components/groupVisualContract.ts`
- 展开组框：`border-nomi-line` + 半透明 `bg-nomi-paper`；label 同样使用 `nomi-line / nomi-paper / nomi-ink`
- 折叠卡、后层卡片、标签圆点、空态图标与侧栏组标识共用同一组暖中性 token，不用 `nomi-accent` 或项目自定义色标识编组
- `NodeGroup.color` 仅为旧项目兼容保留，不再进入渲染层；侧栏不再提供无效的“改颜色”入口
- 强调色只允许出现在共享的瞬时交互反馈（键盘焦点、连接握把），不能成为编组常驻底色或描边
- 可拖动整组

### 4.5 通知：原地 → 状态 → toast → 必须决定

文件：`src/ui/notificationPolicy.ts`、`src/ui/toast.tsx`、`src/utils/showUndoToast.ts`。依据与全量清单：[通知策略](../plan/2026-09-09-notification-policy.md)。

**先问有没有行动价值，再问用户正在看哪里。**

- 当前对象发生的事在对象上说：节点卡、任务行、按钮旁的原地文字。已有结果/状态时不重复播报。失败保留原因与下一步，用户重试时清旧错误；不要让自动消失的 toast 成为错误唯一记录。
- 成功默认不弹；状态徽标、列表变化、复制按钮回声承担反馈。纯进度不占 toast；持续影响当前工作面的障碍用当前面 banner。不能把“已保存”换成需要点“知道了”的模态。
- toast 用于视线之外且需要知道的变化，提供一个真实动作（去看对象/重试/恢复）。撤销有时限的真实行动，即使结果在眼前也可保留；不能为了凑动作加“知道了”。
- **通知/确认模态**只用于必须暂停决定的风险（花费、不可撤回、只读/信任边界），继续 09-08 已批审批档。用户主动打开的设置、编辑器、预览属于工作面，不受“只准风险模态”误删。
- DC23：调用方提供稳定对象身份及原因码。同身份保留最新内容和最新动作；同原因显示累计次数，新原因重置次数；关闭后再次发生从 1 开始。可见和排队项都去重；独立撤销操作不得合并。

`notify` 接受 `identity/reason/message` 和明确上下文：`inline` 必填真实 `present` 落点；`status` 由现有对象状态承担；`background` 必填动作；`decision` 复用既有确认宿主。禁止全局入口猜 DOM、给错误补虚假动作、或删通知却没接原地失败状态。冻结的旧标量入口经同一容器去重，不得在本任务擅改其领域触发逻辑。

视觉：沿用唯一 Mantine 容器，右上顶栏下 12px、宽 344px、最多同时 2 条、间距 8px，语义色只作用于图标，整卡不铺色。有动作默认 8 秒；warning 5 秒/error 6 秒，关闭由 Mantine 管。动作右侧按钮，整张不可点击；动作最多占行宽 40%，长标签截断但 title/可访问名称完整。重复次数在正文旁显示 `×N`；同 id 更新内容不承诺重置上游倒计时。

```typescript
notify({ identity: `task:${taskId}`, reason: 'download-failed',
  message, type: 'error', level: 'inline', present: setError })
showUndoToast({ message, onUndo, isUndoable, watchUndoable })
```

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

文案模板：`已 {动词} 到 {目标}` + 右侧显式「撤销」按钮

- 颜色：中性表面 + 语义图标
- 持续：5 秒
- 行为：点「撤销」按钮 = 撤销 + 立即消失；通知其余区域无操作
- 实现：`showUndoToast()` helper

### 5.5 视觉状态约定

| 状态 | 视觉信号 |
|---|---|
| 默认 | 边框 `--nomi-line`、阴影 `shadow-nomi-sm` |
| Hover | 背景 `--workbench-hover` 或 `--nomi-ink-05` |
| Pressed | 背景 `--workbench-pressed` |
| Selected | 描边 `--nomi-accent` 1.5px + 阴影提升一级 |
| Enabled / Available | `--nomi-accent` 文字或图标 + `--nomi-accent-soft` 背景 |
| Disabled | 文字 `--nomi-ink-30`、cursor not-allowed、opacity 不动 |
| Error | 字 `--workbench-danger`、背景 `--workbench-danger-soft` |
| Verified Success | 中性表面 + 小号 `--workbench-success` 圆点或勾；完整成功页可用 success soft 背景 |

### 5.6 密集生产型表格行（分镜表 v6）

文件：`src/workbench/creation/storyboard/`（实现待排期）。

视觉：一行一个生产单元（镜头/锚）的密集表格行——固定几何列（画面格列、参考列）+ 一个占满剩余宽度的提示词块，模型/模式/参数收进提示词块内部的底栏，不做成表格列。

规格与完整规则见合同文档，不在此复制细节：**`docs/design/2026-09-05-storyboard-table-v6-design-contract.md` §2/§6**（行 grid `14px 136px 200px minmax(0,1fr)`、画面格列固定宽+媒体框按比例缩放、动作条在图下方不压图）。

何时用 / 何时不用：
- 用：需要"批量冗余观察 + 逐条精细编辑"两件事共存的密集列表（分镜表是目前唯一实例）。
- 不用：非密集场景改用 §3.7 提到的 `DesignTable`（管理后台类）；单条编辑不需要批量观察的场景改用普通表单。

### 5.7 参考槽叠放格（手抓扑克扇形）

文件：`src/workbench/creation/storyboard/`（实现待排期）。

视觉：一个槽（不是一张素材）在参考列/列表里的固定占位——单张素材是普通 tile；≥2 张素材时叠成"手抓扑克"扇形（首张正放最上，其余以左下角为轴逐张多转 13°，露出右上角）+ 右下角 `已用/上限` 计数角标，点开出浮层网格增删排序。

规格与完整规则见合同文档，不在此复制细节：**`docs/design/2026-09-05-storyboard-table-v6-design-contract.md` §4/§6**（槽 vs 素材的语义区分、`characterIndexed` 编号规则、`max` 缺省时的角标画法）。

何时用 / 何时不用：
- 用：一个数据槽可能装多个素材、且槽本身需要在密集列表里占**固定**视觉预算的场景。
- 不用：单素材场景直接用普通 tile（§4.6 的 `AttachmentChip` 或 `2026-06-06-reference-v4-implementation-spec.md` 的 `AssetTile`），不要为只装一张的槽套叠放格外壳。

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

### 语义图标登记（同一语义全仓复用同一图标，不漂移）· **有门岗 `check:icon-semantics`**

> **2026-09-07 起这条不再靠自觉。** 用户长期反馈「icon 和用户心智不一致」——根因是这一节过去
> 只管**形制**（唯一库 / size / stroke），语义那一半只有下面三行登记 + 一句「跨场景复用同一个图标」。
> 自觉记不住，于是同一个动作在不同界面长出不同图标，用户每换一个面就得重新学一遍。
>
> **门岗判据**：把「动作」定义为 i18n key（`aria-label={t('assetLibrary.pasteLink.button')}` 里那个 key），
> 把「图标」定义为该**控件**子树里渲染的 Tabler 组件。同一个 key 被配了 ≥2 个不同图标 = 红。
> 存量 3 条在 `scripts/icon-semantics-baseline.json`，棘轮只减不增。
>
> **它刻意不查的三类**（不是漏，是防假红）：容器 `<div role="dialog" aria-label>` 上的标签不算动作身份 ·
> 同一三元里的两个图标是状态切换（`busy ? Loader : Download`）· Chevron/Caret/Selector/Loader 是结构示能不是语义。
>
> **它查不到、只能靠人的那一条 —— 盲测**：遮住旁边的文字，这个图标说得出是干嘛的吗？
> 说不出 → 配文字标签，或换图标。（现状：素材库 toolbar 上 `IconLink`/`IconFilter`/`IconFolderPlus`
> 三个纯图标按钮无文字，全靠 `title` 悬停解释。）
>
> **待清的存量 3 条**（都是同一动作两个入口配了不同图标，改法要先看真实 3D 工具栏再定）：
> `scene3d.character.exitCameraControl` → IconVideo/IconX ·
> `scene3d.character.exitControl` → IconManFilled/IconX ·
> `scene3d.fullscreen.openEditor` → IconCube/IconMaximize

| 语义 | 图标 | 用在哪 |
|---|---|---|
| 付费 / 消耗额度（用户直发或 agent 受理）| `IconCoin` | `SpendConfirmDialog`（§3.5）|
| 外部 AI 助手 / MCP 驱动（agent 身份）| `IconRobot` | `SpendConfirmDialog` 的 `source: 'agent'` 头部（§3.5）|
| 主角形象确认（锚定妆照检查点·免费质量门）| `IconUser` | `SpendConfirmDialog` 的 `kind: 'anchorCheckpoint'` 头部（§3.5，与 cast 分类同图标）|
| 正在放量（广告花费档高，仅 TikTok 广告库有此数据）| `IconTrendingUp` | `FindReferencePanel` 参考卡的「放量」角标。**选趋势上升不选火苗**：隐喻要诚实——它表达的是「投放在加码」，不是「热门」|

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

焦点指示由 **`tailwind.config.ts` 的 `addBase` 单一基础边界**统一供给：
- `:root :focus { outline: none }` 接管浏览器默认 outline；不能把 `:focus-visible` 误解成“只有 Tab”——Chromium 鼠标点击文本编辑控件也会匹配它。
- **文本编辑类**：文本/数字 input、textarea、contenteditable（空值/true/plaintext-only）鼠标与键盘聚焦一致，不出外圈 outline。已有边框改为 `var(--nomi-accent)`，不加宽、不改布局；组合输入的直接容器、以及富文本编辑器最近的 `.border` 容器通过 `:has(文本控件:focus)` 同步高亮已有边框（嵌套编辑器只高亮最近一层），保留整体形状。无边框编辑器保留插入光标，不强行添加卡片外框。错误态（aria-invalid/data-error）保留错误边框；只读字段仍可聚焦复制。
- **非文本类**：button/link/select/summary、非文本 input 及自定义可聚焦元素的 `:focus-visible` 用 `2px solid var(--nomi-focus)` + `outline-offset:2px`；鼠标点击不画环。`--nomi-focus` 为 accent 派生 token（浅色 42%、深色 50%）。

**纪律**：不要在组件单独加 `focus:outline-none` 或另一份焦点环/外扩阴影；新增控件由基础边界接管。组合输入复用现有边框，不给内部 textarea 再造矩形。回归运行 `node tests/ux/focus-indication.e2e.mjs`；真实 Electron 另查鼠标/Tab 与四个主要页面截图。

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

**❌ 把两个 CSS 属性的值打包进一个 token：**
```css
--nomi-transition-fast: 140ms cubic-bezier(.2, .7, .3, 1);   /* 时长 + 缓动打包 */
```
```tsx
<div className="transition-[opacity] duration-[var(--nomi-transition-fast)]">
```
**为什么这是 bug 而不只是不优雅**：`transition-duration` 的语法只接受 `<time>`。喂给它一个复合值，
CSS 不会报错、不会回退到默认值，而是**静默作废整条声明**——computed 值是 `0s`，动效完全消失。
这一族最阴的地方是：token 名对、类名对、DOM 里在、截图看不出（静态帧本来就一样），只有真人觉得「怎么是硬切」。
2026-09-07 一次性中招 77 处，全仓所有交互过渡都没在动，存活了三个月。

应该：**一个 token 只对应一个 CSS 属性的值**，拆成 `--nomi-duration-fast` + `--nomi-ease-fast`，
用 `duration-nomi-fast ease-nomi-fast`（§2.7）。
自检：这个 token 能不能原样填进它要去的那个 CSS 属性？填不进去 = 打包了。

---

## 11. 下一步（占位）

- [ ] **4 个非分镜分类的卡片视觉**——基于本设计系统重新设计角色 / 场景 / 道具 / 声音节点的渲染样式，差异化它们与分镜的视觉
- [ ] **统一菜单 / 右键菜单组件**——目前 sidebar 右键菜单内联在 CategorySidebar 里，可抽出
- [ ] **Group color picker**——组框颜色当前是固定 `#d8c3a5`，UI 允许用户选色
- [x] **Toast 系统升级**——已统一 Nomi 样式、显式动作、稳定任务更新与可见数量；倒计时进度条无明确收益，暂不增加。

---

## 12. 相关文件 / 参考

| 类型 | 路径 |
|---|---|
| 高层原则 | `Design.md`（根目录） |
| 颜色 token | `src/theme/nomi-tokens.css` |
| 几何/排版 token | `src/theme/nomiTheme.ts` |
| 工作区 token | `tailwind.config.ts`（addBase `:root` ② 层，2026-08-24 从 workbench.css 收口）|
| 组件库入口 | `src/design/index.ts` |
| 组件库说明 | `src/design/README.md` |
| Tailwind 扩展 | `tailwind.config.*` |
| Mura 设计原稿 | 用户本地 `Mura - 画布设计.html`（Claude Artifacts）|
| Phase E.2 execution plan | `docs/plans/2026-05-25-phase-e2-completion-and-tech-uplift.md` |

---

## 14. 已知漂移 / 清理 backlog（v2 实测，诚实标注）

> 这节是「真实设计反推出来的现状」——文档不再假装代码 100% 合规。每条 = 现状 + 为什么是问题 + 修法。**机器门岗（`check:tokens`）已把 hex/px 这类粗漂移卡到 0**，所以下面是门岗抓不到的结构性 / 系统性漂移。

### 14.1 系统级（影响全局，需用户拍板再动）

> **2026-06-24 暗色重新引入（动手前必读）**：新暗色是**暖灰 oklch 主题**（`tailwind.config.ts` 的 `:root[data-mantine-color-scheme="dark"]` addBase 块），与下面 S1 删掉的那套**蓝黑 `--tc-*` 旧暗色无关**——别把两者搞混。开关默认浅色、首启跟随系统。
>
> **真相源已在 §0.5 统一，此处不再另说一遍**（旧版这里有一段与 §0.5 相反的「更正」，2026-09-07 随 §0.5 改写删除——两个真相源比一个错的真相源更伤）。当时顺带修的潜伏 bug 留档：`--nomi-scrim` / `--nomi-overlay-chip` / `--nomi-overlay-chip-strong` / `--nomi-media-veil` / `--nomi-axis-x/y/z` 此前只写在镜像文件里、运行时 undefined（提示词库/技能库/库页 scrim、引导旅途背景、scene3d 轴标全在用空颜色），已补进 `tailwind.config.ts` 真源（光+暗）。

| # | 现状 | 为什么是问题 | 修法 |
|---|---|---|---|
| ~~S1~~ ✅ 已清（2026-06-21）| 早期暗色 `--tc-*` 层（`globals.css` 默认 `:root` 全套暗色 hex + body 暗色渐变 + 光模式覆盖块）| 与 light-only 矛盾的休眠暗色主题 | 已删整段 `--tc-*`/`--handle-color-*` + 暗色 body + 暗色 `#root::before`；2 处外部消费（surface-inline→`var(--nomi-ink-05)`、sheen→`color-mix(nomi-ink 10%)`）已迁；body 改 `var(--nomi-bg)`/`var(--nomi-ink)`；保留 `--handle-hit-*` 几何 |
| ~~S2~~ ✅ 已清 | `color-scheme: light dark` | 与 light-only 矛盾 | 已改 `color-scheme: light` |
| ~~S3~~ ✅ 已清 | Inter / Fraunces 未打包 | 品牌字干净机器回退 | 已装 `@fontsource-variable/{inter,fraunces}` 自托管，字栈首位置 `"Inter Variable"`/`"Fraunces Variable"`（§2.6）|
| ~~S4~~ ✅ 已清 | `--handle-color-*` 0 消费点死 token | 死代码 | 已随 S1 删除（连线另有取色路径，确认 0 悬空引用）|

### 14.2 组件级（用户可见面 vs 文档不一致 · 2026-06-21 建表，**2026-09-07 逐条重跑**）

> 重跑口径：按**内容**去代码里找（行号会漂，别按行号找），三类处置——已修的从表里删、还在的更新到当前 `file:line`、变形/搬家的改描述。
> 2026-06-21 那批 17 条里 **13 条已修**；2026-09-07 新增的 3 条「文档主张与代码现实背离」（D1 浮层 / D2 空态 / D3 README）**已于同日 D 档刀 0 修完，按 §13 维护纪律从表里删除**——修法不是把主张变成现实，而是**把注释改成真话 + 写清该往哪收**（`src/design/AnchoredPopover.tsx` / `emptyState.tsx` / `README.md`）。同批还改真了另外两条同类的（`NomiSelect.tsx` 的「全仓统一…别散落原生 select」实有 6 处原生 `<select>`；`searchInput.tsx` 的「全仓统一搜索框」实有 3 处手写没收口）。

**当前最该收口的 1 件事：** 那 8 处手写 `getBoundingClientRect()+createPortal` 的浮层（清单在 `AnchoredPopover.tsx` 注释里），归属 D 档刀 1/刀 3。

**完整漂移清单**（2026-09-07 复核，刀 0 后）：

| # | 面 | 位置（已复核）| 现状 → 对齐 |
|---|---|---|---|
| C1 | canvas | 11 文件 21 处：`nodes/NodeDeconstructionBadge.tsx:52,70`、`nodes/DeconstructionShotRow.tsx`(`stroke={2.2}`)、`nodes/Scene3DEditor.tsx:376`、`nodes/whiteboard/{WhiteboardToolbarControls,WhiteboardDrawingTool,WhiteboardLibraryPanel}.tsx`、`components/{CollapsedGroupCard,SelectionPromptSaveController}.tsx`、`reactFlow/GenerationCanvasReactFlowNodes.tsx:372`、`spend/{ProductionContractSummary,SpendConfirmDialog}.tsx` | 图标 `stroke` 2 / 2.2 / 1.7 三个档外值 → 收敛到 §6 规定档（1.5 / 1.6 / 1.8）。白板工具栏那一族（`stroke={1.7}` ×9）是最集中的一块，可整片改 |

**2026-09-07 判定已修、从表里删除的 16 条**（凭据同步留档，免得下次重新怀疑）：

| 原条目 | 凭什么判定已修 |
|---|---|
| D1 `AnchoredPopover.tsx:7,20`「全站唯一」+「P1 一律用它」| 刀 0 改成诚实描述：列出实有的四套定位机制、逐处点名那 8 个手写文件、写明「② Radix 不收、③ Modal 不收、④ 收」的收口方向；那句管不住 8 个反例的 P1 已删 |
| D2 `emptyState.tsx:5-6`「已收口各面板手写空态」| 刀 0 改成「已收口库页/面板族 9 个消费者；画布节点族 3 份并行结构没收口」，并写清为什么（节点空态在 ~180px 卡片里、本身是可点投放区，形态不同）|
| D3 `README.md` 推销 `PanelCard`/`InlinePanel`/`DesignSelect` | 刀 0 整篇重写为「按 `index.ts` 真实导出 + 逐件采纳现状」；§3.1 也已注明这一族现在是空的 |
| `AboutNomiPopover.tsx:15-26` 自造 `PRIMARY_BTN`/`GHOST_BTN` | 该文件已不存在；继任者 `src/workbench/settings/AboutSection.tsx:4` 直接 `import { WorkbenchButton }`，5 处按钮全走它；全仓 grep `PRIMARY_BTN|GHOST_BTN` 零命中 |
| `AboutNomiPopover.tsx:151` 手拼进度条 | 同上文件已删；`AboutSection.tsx:187` 用 `<DesignProgress value={...} size="sm" />` |
| `OnboardingChecklist.tsx:226` 手拼进度条 | `src/workbench/onboarding/OnboardingChecklist.tsx:25` import、`:256` `<DesignProgress … size="xs" />` |
| `OnboardingChecklist.tsx:271` 手写主操作 pill | 该面板现在只剩 4 个 `<button>`（`:206` 触发器、`:243` 折叠、`:303`/`:317` 页脚文字链），全部是 token 化的 ghost 写法（`rounded-nomi-sm` + `text-nomi-*`），已无手写实心 pill |
| `ProjectLibraryPage.tsx:200` 手写 inline `<svg>` 放大镜 | `src/workbench/library/ProjectLibraryPage.tsx` 全文 grep `<svg` 零命中 |
| `ProjectLibraryPage.tsx:266,284` `hover:text-white`/`bg-white` | 同文件 grep `text-white|bg-white` 零命中 |
| sidebar `CategoryItem/NodeItem/GroupItem` 的 `rounded-md` + `text-nomi-ink-70` | **全仓** grep `rounded-md` = 0、`text-nomi-ink-70` = 0（不只 sidebar，整个 `src/` 都清干净了）|
| `CategoryTree.tsx:349` 右键菜单 `rounded-md`/`shadow-lg` | 现 `src/workbench/sidebar/CategoryTree.tsx:359`：`rounded-nomi-sm … shadow-workbench-pop`，已 token 化 |
| `StoryboardPlanCard.tsx:39` 手写状态徽章 | 该组件已不存在（`src/` 内只剩 `CreationWorkspace.structure.test.ts` 里的一个字符串引用）|
| `CreationAiPanel.tsx:467` `font-[Fraunces,Inter,serif]` | 该组件已不存在；且**全仓** grep `font-[Fraunces` 零命中 |
| `CreationAiPanel.tsx:568` `text-xs` | 同上，承载文件已删 |
| `AssistantTimeline.tsx:140` `font-[Fraunces,Inter,serif]` | 该文件已不存在，全仓零引用；`font-[Fraunces` 全仓零命中 |
| `SelectionGeneratePopover.tsx:146` `rounded-lg`(8px) | `src/workbench/creation/SelectionGeneratePopover.tsx:155` 现为 `rounded-nomi-lg`，全文无 `rounded-lg` |
| `NoTextModelRecoveryCard.tsx:93-119` 手写 pill ×2 + `:104` 自造 `IconLoader2` spinner | `src/workbench/ai/NoTextModelRecoveryCard.tsx:15` import `WorkbenchButton`，`:105`/`:117` 两颗按钮都走它；全文 grep `IconLoader2|animate-spin` 零命中 |
| `TimelinePreview.tsx:667` Mantine 默认蓝 `--mantine-color-blue-5` | **全仓** grep `mantine-color-blue` 零命中 |
| `TimelinePreview.tsx:557` 播放图标 `stroke={2}` | `src/workbench/preview/TimelinePreview.tsx` 全文 grep `stroke={2}` 零命中 |

---

## 13. 维护

- 本文档版本 **v2.3**（真实色值 + Logo 解剖/调用点地图 + §0.5 真相源全景 + §14 漂移诚实标注 + §3 逐件采纳现状），对应代码 **v0.21.0**
- **v2.2（2026-09-07）状态色收口**：四语义（danger/warning/success/info）× 四档（base/-ink/-soft/-edge）落地候选 C，见 §2.1.2b；`--workbench-success/danger/warning` 三族从 iOS hex 改为 ① 层别名（§14.1 S5 因此清掉）；新增 Mantine 色板重映射 + `DesignBadge` 封闭 tone 词表（§2.1.2c）。同日修两处规格错误：`-soft`/`-edge` 从「base 的 alpha」改为色阶上独立的一档（alpha 版浅底 L≈0.92 发灰），`info` 从近重复的独立蓝收成 `accent` 的别名
- **v2.3（2026-09-07）D 档刀 0「说真话」**：删 6 件生产零调用组件（`DesignPagination` / `DesignTable` / `DesignPageShell` / `DesignDrawer` / `DesignAlert` / `DesignFileInput`）及其实验室格与基线；删 20 个全仓零 CSS 定义的 `tc-*` 钩子类（只留走查锚点 `tc-action-card`）；§3.1/3.3/3.4/3.5 的组件索引改成真实清单 + 逐件采纳现状，§3.6–3.8 整族删除；§14.2 的 D1/D2/D3 三条随修完删表。`DesignBadge` / `StatusBadge` 零调用但**保留**（画布侧 5 份手写徽章待迁），保留理由写进源码
- **重审记录**：v0.10.x（2026-06-21 建表）→ **v0.21.0（2026-09-07 重审）**：统一 §0.5 真相源（删掉 §14.1 里那段与它相反的「更正」）、§14.2 漂移清单逐条重跑（17 条中 13 条判已修删除、1 条更新、新增 3 条文档主张与现实背离）、§2.7 动效拆成 duration + ease 两个 token。中间 11 个 minor 未重跑，是这次删掉 13 条的原因
- **下次重审的触发条件**：跨 ≥5 个 minor，或任一次 §14.2 条目数反向增长
- 每次新增 §4 / §5 entry 时 bump 一次小版本
- 重大重构（如颜色系统重设、清理 §14.1 暗色层）bump 主版本（v3）
- 文档过时时优先更新本文档，不依赖代码注释作为 source of truth
- §14 是活清单：每修掉一条，从表里删一条

### 过程反馈状态条（C1，2026-09-08）

`src/workbench/generationCanvas/nodes/GenerationStatusBar.tsx`：图、视频、音频共用纸白胶囊，6px 状态点、正文 token 人话、等宽真实数字。压媒体时使用 overlay-chip 底与固定白字 token。排队 ink-30、进行 accent、完成 success、软超时 warning、失败 danger。状态不参与节点几何布局；点 1.6s 呼吸，reduced-motion 常亮；完成停 2s 后 240ms 淡出，减弱动态时停 4s 直接消失。失败动作沿用节点现役错误卡，不复制操作入口。

重复 warning/error 第二次起转为可关闭持久提示，直到用户关闭或原地恢复回执撤回；不靠抖动 TTL 伪造续时，避免最新失败只剩上一次倒计时的几毫秒。普通单次通知仍沿用 Mantine 原生时长。

### 画布分镜表节点（B1，2026-09-10）

`src/workbench/generationCanvas/nodes/shotTable/ShotTableNode.tsx` 消费已拍板 TableNode 画板：纸面节点、40px 标题/底栏、32px 表行、24px 高关键帧、sticky 表头、内部横纵滚动。≥80% 全表，40–80% 镜号/关键帧/状态，<40% 摘要卡；尺寸仍由画布 NodeResizer 单源持久化。生产表只读，双击回 v6 全页；参考片自定义列操作复用 WorkbenchMenu/promptDialog。两套列集共用 token 与表壳，状态沿现役行执行 derive。详见 [三组设计合同](2026-09-08-left-sidebar-canvas-nodes-process-feedback.md)。
