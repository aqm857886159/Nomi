# 节点生成浮框底栏 v1 · 三类归位

> 状态：**待用户拍板**（2026-09-10）。只出样张、不接线——本分支不改任何生产组件的行为。
> 屏：设计实验室 `node-composer-bar`（8 格，`pnpm run design-lab:walk:node-composer-bar`）。
> 基线：本屏在 `tests/ux/design-lab/calibration.json` 的 `pendingApprovalScreens` 里挂着，
> **拍板前不录基线**（没被看过的图录成基线 = 把「今天碰巧长这样」钉成「应该长这样」）。
> 依据：`docs/design/nomi-design-system.md` §1.5（控件层级）· §1.5.5（新面三件产物）· §2（token）· §6（图标）。

---

## 一句话

节点下方那个生成浮框的底栏，现在挤成一行 9 件（视频：锁 / 更多▾ / 模型 / 变体 / 参数 / 运镜 / 优化 / ×N / 生成；图片 7 件），
卡片被撑到 768px 宽、参数 chip 挤到 `1080p · 16:…` 截断、「运镜 · 推近 中」这句长文字白占一格。
v1 按 §1.5.3「先分组 → 去重 → **归位** → 最后才收纳」把它拆成三类：
**决定出什么、花多少** 的留底栏；**帮我写提示词** 的收成提示词框右上角一簇纯 icon；**锁** 回节点浮条。

**要权衡的那一个东西**：参数 chip 从「所有参数当前值串接」改成「只报最影响结果和价格的两个值」。
省下的宽度让底栏一行装得下且不截断；代价是清晰度、生成音频这类值要点开 chip 才看得到——
它们仍在同一块面板里，**一次点击可达**，只是不再常驻。

---

## 现状（before）· 先看真实样子

两格 before 渲染的是**现役 `NodeGenerationComposer` 本体**（经 `BaseGenerationNode` 挂载），
不是照着它画的——「挤不挤、截没截断」必须来自真身。

| 图 | 说明 |
|---|---|
| `tests/ux/shots/design-lab-node-composer-bar/composer-bar-before-video.png` | 视频节点：卡宽 768px；底栏 `锁 / 更多▾ / Seedance 2 / 变体 标准 / 1080p · 16:…（截断）/ 运镜 · 推近 中 / 优化 / 1 张 / ↑` |
| `tests/ux/shots/design-lab-node-composer-bar/composer-bar-before-image.png` | 图片节点：底栏少了运镜和变体，仍是 7 件 |

读过的现役实现（全文，不是片段）：
`NodeGenerationComposer.tsx`（底栏 404-470）·`NodeParameterControls.tsx`·`InlineParameterBar.tsx`·
`NodeCameraMoveControl.tsx`·`NodePromptOptimizer.tsx`·`NodeFloatingToolbar.tsx`·`NodeEffectChips.tsx`。

---

## 任务卡（这张样张的验收标准）

> **用户** 在 **点开一个节点、准备按下生成的那一刻**，一眼看到 **要出什么、花多少**，一步点生成就走。

一张卡只描述这一个时刻。写提示词、挑效果、配运镜都是**之前**的事，参数微调是**偶尔**的事——
它们不该和「出什么 / 花多少 / 生成」抢同一条常驻带。

---

## v1（只这一件）

底栏只剩一条：**`[模型 ▾] [⚙ 16:9 · 5s ▾] [×1 ▾] ………… [↑]`**，单行、不换行。

| 类 | 是什么 | 归到哪 | 样张证据 |
|---|---|---|---|
| **A · 决定出什么、花多少** | 模型芯片、参数 chip（两个值）、×N、生成 | **留底栏**，单行 | `composer-bar-v1-video.png` |
| **B · 帮我写提示词** | ✦效果（原「更多▾」）、🎥运镜、✨优化 | **提示词框右上角一簇纯 icon**，hover 出名字 | `composer-bar-v1-video-camera.png` / `composer-bar-v1-cluster-hover.png` |
| **C · 锁** | 锁 / 解锁 | **回节点右上浮条**，和「复制变体 / 生成记录」同一条 | 每一格 v1 的顶部浮条 |

三条实现细节：

1. **参数 chip 只报两个值** —— 视频 = 比例 + 时长，图 = 比例 + 清晰度。走 `InlineParameterBar`
   **已有的** `summaryOverride` 缝（ComfyUI 工作流那一支在用同一个入口），不新造第二条摘要通路；
   点开仍是同一块全参数面板，一个参数都没少。样张里这两个值是从档案 derive 的（`resolveRenderedControls`
   给出控件、`controlInitialValue` 给出当前值），换个模型照样说得对，不是写死的一句文案。
2. **B 簇不合成一个菜单**（用户 2026-09-10 定：分组到簇就停）。合成 `⋯` 会给三个中频动作各加一次点击，
   正是 §1.5.4 记着的那条反例。
3. **运镜已选时 icon 带一个激活点**，tooltip 写「推近 · 中」——长文字从行里退到 hover，
   状态本身没丢。tooltip 文案与现役芯片 `chipSummary` 同一口径（运镜 · 速度）。

**卡宽是算出来的，不是挑的**：v1 卡沿用现役 composer 卡的 `w-max / min-w-360 / max-w-880` 边界，
底栏变短之后卡自然从 768px 收到 **520px**（视频）/ **445px**（图片）。

### 三版减法梯度

| 版 | 内容 | 判断 |
|---|---|---|
| **v1（推荐）** | 只做上面三类归位 | 默认推这版 |
| v2 | v1 + 参数 chip 支持「钉住第三个值」（比如常调清晰度的人把它钉上去） | 等有人真的抱怨再加 |
| v3 | v1 + B 簇支持自定义顺序 / 增删 | 不做：给一个三颗按钮的簇加配置面板，是拿复杂度换零收益 |

---

## 删除清单（我**没**放上去的）

| 没放 | 为什么 | 用户要它时怎么找到 |
|---|---|---|
| **锁** 不放底栏 | 锁的作用对象是**节点**，不是这一次生成。它 2026-08 搬进底栏是为了「就近可达」，但就近的对象搞错了——节点的动作家族在节点浮条上（复制变体 / 生成记录）。一个动作只能有一个家（§1.5.2）。 | 选中节点 → 正上方浮条最左一颗 |
| **「运镜 · 推近 中」** 不放底栏 | 它是**已选值的回显**，不是决策位。回显占一整格常驻宽度，而底栏的常驻预算要留给「出什么 / 花多少」。 | 提示词框右上角 🎥；已选时 icon 带激活点，hover 报「推近 · 中」 |
| **「优化」** 不放底栏 | 它服务的对象是**提示词框**，不是生成。就近 > 收纳（§1.5.3）：搬到它作用的那个框旁边，可达性代价是 0。 | 提示词框右上角 ✨ |
| **「更多▾」（效果 / 提示词库）** 不放底栏 | 同上，它往提示词里塞内容。而且它顶着「更多」这个名字，谁也猜不到里面是效果库。 | 提示词框右上角 ✦；hover 写「效果与提示词库」 |
| **清晰度 / 生成音频 / 变体** 不进 chip 文案 | 它们影响结果但**不是用户每次都要确认**的那两个；串进 chip 就是今天这个 `1080p · 16:…`。 | 点 `⚙` chip → 同一块全参数面板，一个不少 |
| **参数 chip 不合并模型芯片** | §1.5.4 白纸黑字：「模型是用户最看重的一等决策，合并等于把它埋了」，且是 2026-07-17 已拍板的形态。 | 模型仍在底栏左起第一位 |

---

## 卡点表（这条路会卡在哪）

| # | 问题 | 答 | 证据 |
|---|---|---|---|
| ① | 他怎么知道 B 簇在那？ | 三颗 icon **常驻**在提示词框右上角（不是 hover 才出），位置就在他打字的地方；hover 出名字。风险是纯 icon 的可读性——§6「盲测」那条：✨（Nomi 标记）与 🎥 现役已在用同一语义，✦ `IconSparkles` 是新配的，**这一颗是拍板时要盯的**。 | `composer-bar-v1-cluster-hover.png`；`nodeComposerBarLabKit.tsx` 的 `PromptToolCluster` |
| ② | 动手前知不知道要付出什么？ | 知道：底栏那一行就是「什么模型 · 什么规格 · 出几张」，`16:9 · 5s` 和 `×1` 是价格的两个主要乘数。真正的钱闸仍是提交时的报价确认（2026-09-09 拍板），底栏只负责让他**提交前**就看见。 | `composer-bar-v1-video.png` 底栏 |
| ③ | 参数没配 / 配错了看到什么？ | 目录没有可跑的模型时，参数 chip 整颗退化成「配置模型 →」按钮（现役 `InlineParameterBar` 第一段就是这条，v1 不动它）；缺参考等不可生成的原因仍写在生成钮的 title 上。 | `InlineParameterBar.tsx:272-299`；`NodeGenerationComposer.tsx:437-455` |
| ④ | 生成后怎么回头？ | 节点浮条上的「生成记录」是唯一入口（v1 把锁放回它旁边，正是让这一族聚在一起）；重新生成仍是同一颗 ↑。 | `NodeFloatingToolbar.tsx` `ToolbarProvenanceButton` |

**这条路几步？** 打开节点 → 看底栏一行 → 点 ↑ = **3 步**（其中前两步是「看」，只有一步是操作）。
**能不能砍一步？** 不能。看一眼「出什么、花多少」是这一刻的**目的本身**，砍掉它就是让人闭着眼睛花钱。
v1 已经把这一步从「读 9 件东西并找出哪两件要紧」压成「读一行三件」。

---

## 与 §1.5 逐条对账

| 条 | 对账 |
|---|---|
| §1.5.1 L1 常驻 ≤5 个功能簇 | 底栏从 9 件 → 3 簇（模型规格 / 数量 / 生成）。B 簇搬到提示词框，那是**另一个面**的 L1（它服务提示词），不是把中频控件收进 ▾ 凑数（§1.5.4 第一条反例） |
| §1.5.2 一功能一个家 | 锁只剩浮条一个入口（底栏那份删掉）；效果 / 运镜 / 优化各只剩簇里一颗 |
| §1.5.2 常驻位有预算 | 底栏没加任何新东西，只减 |
| §1.5.2 情境控件不许挤常驻条 | B 簇随提示词框走，底栏宽度不再随「运镜选了什么」变——今天选了长名字的运镜会把底栏撑宽，这就是布局抖 |
| §1.5.3 手法优先级 | 用的是**归位 + 就近 + 分组**（可达性代价 0），只有参数 chip 的次要值算「收纳」，而它本来就已经在弹层里 |
| §1.5.3 动作不许压在内容上 | B 簇浮在提示词**输入区**上，不是浮在生成结果的图/视频上；且给了 96px 净空，文字不从 icon 底下穿过 |
| §1.5.3 分段要有名字 | B 簇有独立描边容器 + `role="group"` + 组名「写提示词」，与底栏在视觉上分得开 |
| §1.5.4 别把模型合进一句话 | 没合，模型芯片原样留在底栏第一位 |
| §1.5.5 新面三件产物 | 任务卡 ✓ / 三版减法梯度 ✓ / 删除清单 ✓ / 卡点表 ✓ |
| §2 token-only | 全部走 token；无 hex、无任意 px 字号或圆角 |
| §6 图标 | 只用 `@tabler/icons-react` + `NomiLogoMark`；簇内统一 16 / stroke 2（`WorkbenchIconButton` 的既有值） |

---

## 反转「锁在底栏」那条决定的理由

`NodeGenerationComposer.tsx:407-409` 写着：

> 锁从节点卡片移到这里（编辑面板底栏）：卡片预览保持干净，锁定/解锁在选中编辑时就近可达。

这条**当时对、现在不对**，两件事变了：

1. **它当时要躲的地方已经空了。** 那次搬迁躲的是「半透明按钮常驻压在图上」（§1.5.3）。
   2026-08-04 之后节点浮条建起来了，「生成记录 / 复制变体」都住在**卡片上方**的浮条上，
   不压内容。锁回去不是回到当初那个坏位置，是回到一个当初还不存在的好位置。
2. **「就近」的近，近错了对象。** 锁的作用域是**这个节点**（锁住之后 AI 改不动它、参数也编不了），
   不是这一次生成。放在生成底栏，它和「出什么、花多少」并排，作用域不同却混排——
   §1.5.3 最后一条明确要求作用域不同的控件必须视觉可分。

代价说清楚：锁从「编辑时就在手边」变成「在节点上方浮条上」，位移约 250px。
换来的是底栏 100% 服务于「这一次生成」，以及锁与它同族的节点级动作聚在一起。

---

## 样张截图（绝对路径）

```
/Users/aoqimin/Desktop/Nomi-node-bar-mockup/tests/ux/shots/design-lab-node-composer-bar/_contact-sheet.png
/Users/aoqimin/Desktop/Nomi-node-bar-mockup/tests/ux/shots/design-lab-node-composer-bar/composer-bar-before-video.png
/Users/aoqimin/Desktop/Nomi-node-bar-mockup/tests/ux/shots/design-lab-node-composer-bar/composer-bar-before-image.png
/Users/aoqimin/Desktop/Nomi-node-bar-mockup/tests/ux/shots/design-lab-node-composer-bar/composer-bar-v1-video.png
/Users/aoqimin/Desktop/Nomi-node-bar-mockup/tests/ux/shots/design-lab-node-composer-bar/composer-bar-v1-video-camera.png
/Users/aoqimin/Desktop/Nomi-node-bar-mockup/tests/ux/shots/design-lab-node-composer-bar/composer-bar-v1-image.png
/Users/aoqimin/Desktop/Nomi-node-bar-mockup/tests/ux/shots/design-lab-node-composer-bar/composer-bar-v1-video-dark.png
/Users/aoqimin/Desktop/Nomi-node-bar-mockup/tests/ux/shots/design-lab-node-composer-bar/composer-bar-v1-image-dark.png
/Users/aoqimin/Desktop/Nomi-node-bar-mockup/tests/ux/shots/design-lab-node-composer-bar/composer-bar-v1-cluster-hover.png
```

---

## 文案（i18n 键口径）

新增键在 `src/i18n/locales/generationCommon.ts` 的 `composerBarV1` 下；其余复用现役键，不另起一份。

| 键 | zh-CN | en |
|---|---|---|
| `generationCommon.composerBarV1.promptTools` | 写提示词 | Prompt helpers |
| `generationCommon.composerBarV1.effects` | 效果与提示词库 | Effects & prompt library |
| `generationCommon.composerBarV1.cameraPicked` | `{{move}} · {{speed}}` | `{{move}} · {{speed}}` |
| `generationCommon.composerBarV1.seconds` | `{{value}}s` | `{{value}}s` |
| `generationCommon.optimizer.aria`（复用） | 优化提示词 | — 现役 |
| `generationCommon.cameraMove.title`（复用） | 运镜 | — 现役 |
| `generationCommon.node.lock.lockHint`（复用） | 锁定提示 | — 现役 |

---

## 这份样张的证据强度（别读岔）

| 部分 | 是什么 |
|---|---|
| before 两格 | **现役组件本体**，`coverage: shell` |
| v1 的参考区 / 模型芯片 / 参数 chip / 全参数面板 / ×N / 生成钮 | **现役组件本体**（`NodeParameterControls`、`InlineParameterBar`、`NomiSelect`、`GENERATE_BUTTON_CLASS`），只是排布是新的 |
| v1 的锁与浮条 | **现役组件本体**（`FloatingToolbarShell` + `NodeLockBadge` + 现役两颗浮条按钮） |
| v1 的 B 簇三颗 icon | **现役原子 `WorkbenchIconButton` + 现役图标**，但它们此刻只是**触发器外观**：真实实现是把 `NodePromptOptimizer` / `NodeCameraMoveControl` / `useNodeEffectChips` 的触发器换成这个外观，**弹层与逻辑一行不动**。本分支不接线，所以没有把那三个组件摆上去——它们现在仍是带文字的老外观，摆上去等于给用户看一个假的 v1 |
| v1 里的节点卡 | **占位块**（同 canvas-frame 那一屏的手法）。节点内部形态另有它自己的屏，摆一张真卡只会把两件事混在一格里比 |

因此 v1 六格的 `coverage` 一律是 `component-only`：组件都在、现役界面走不到这个形态。

---

## 拍板后要做的事（不在本分支）

1. `InlineParameterBar` 的 `summaryOverride` 从 `NodeParameterControls` 透传一个「两个值」的来源。
2. `NodePromptOptimizer` / `NodeCameraMoveControl` / `useNodeEffectChips` 各加一档 icon-only 触发器外观（弹层不动），由 composer 组成 B 簇挂到提示词框右上。
3. `NodeGenerationComposer` 底栏删掉 `NodeLockBadge`；`BaseGenerationNode` 的节点浮条加上它。
4. 删掉 `calibration.json` 里 `node-composer-bar` 的待拍板登记，跑 `pnpm run design-lab:update -- --screen node-composer-bar` 录基线。
