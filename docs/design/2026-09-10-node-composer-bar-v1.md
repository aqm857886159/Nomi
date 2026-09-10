# 节点生成浮框底栏 v1.1 + B · 三类归位 · 逐参数下拉

> 状态：**已接线**（2026-09-11 用户「都按默认」拍板 v1.1；同日 02:10 拍板 B「逐参数下拉」，均已实施）。
> **先读 §B**：它推翻了 v1.1 的「参数 chip 只报两个值」，下面 v1.1 各节里凡写「参数 chip / 摘要 pill」的都以 §B 为准。
> 屏：设计实验室 `node-composer-bar`（5 格，`pnpm run design-lab:walk:node-composer-bar`），
> 接线后**每一格都是现役 `NodeGenerationComposer` 本体**（`coverage: shell`）——样张阶段那两格
> `before` 与六格 `component-only` 已同 commit 删除：形态一上线，「现状」就是 v1.1 本身，
> 再留一格顶着「现状 · 9 件挤一行」的名字去渲染新底栏，那是一句会骗人的图注（P1 加新必删旧）。
> 基线：本屏仍挂在 `tests/ux/design-lab/calibration.json` 的 `pendingApprovalScreens` 里，
> **等用户看过真机截图再录**（没被看过的图录成基线 = 把「今天碰巧长这样」钉成「应该长这样」）。
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

## v1.1 · 用户 09-10 21:20 反馈

用户看完 v1 六格后的判断（原话大意）：

> 「B 簇放提示词行尾，感觉提示词要写到它下面去了。把它缩小、放到底栏：模型和参数在前两个，
> 然后是运镜/更多/优化，缩小版纯 icon，缩在一行里。」

### 他说中的是什么（为什么 v1 那个位置是错的）

v1 把 B 簇做成**贴在提示词框右上角、带描边和阴影的一小块浮层**。我当时的理由是「就近 > 收纳」——
这三件事服务的对象是提示词框，摆在它旁边可达性代价是 0（§1.5.3）。理由本身没错，**位置的语义**错了：

一个带边框、带底色、压在输入区左右满宽顶端的小块，在版式上读起来是**这个框的表头**，
不是「一组和它并列的工具」。表头在下、内容跟着往下走——所以用户读出来的是
「提示词要写到它下面去」。这不是他看错，是这个形状本来就在说这句话。
§1.5.3 那条「动作不许压在内容上」我只按字面过了（浮的是输入区不是生成结果），
没过它真正要防的东西：**浮层会改写它所压那块内容的阅读顺序**。

### v1.1 改了什么

底栏从「A 类一条」变成**一条三段**：

```
[模型 ▾] [参数 ▾]  │  [🎥] [✦] [✨]  │  [×1 ▾] ……… [↑]
   决定出什么/花多少      帮我写提示词         出几张 / 走
```

| 变化 | 具体 | 理由 |
|---|---|---|
| B 簇下到底栏中段 | 不再有绝对定位、不再有描边容器与阴影 | 它不再压在任何内容上，也就不会改写谁的阅读顺序；同时提示词区回到「里面只有提示词」 |
| 缩小一号 | `WorkbenchIconButton size="sm"`（28px，设计系统里已有的小号档，比默认 md 的 32px 小一号）。**没有新造尺寸** | 一行里同时站着「决策位」和「工具位」，尺寸差就是这两类的分界；靠尺寸分层比再加一根框线便宜 |
| 顺序固定为 模型 → 参数 → 运镜 → 效果 → 优化 → ×N → 生成 | 用户原话的排法 | 从左到右是「出什么 → 怎么写 → 出几张 → 走」，与人在这一刻的决策顺序同向 |
| 两段之间用现役 `ToolbarDivider` 分开 | 不新画分隔线 | §1.5.3「分段要有名字」在一条带子上只能靠分隔与组名交代；分隔线在本仓已经有一个 owner |
| 提示词区右端**不放任何控件** | 走查里写成硬断言（见下） | 这是这一版要证的那句话，不能只靠看图 |

**保留没动的**：运镜已选仍带激活点、hover 仍出名字（运镜报「推近 · 中」）；
图片节点没有运镜，簇里就只剩两颗；锁仍在节点浮条；参数 chip 仍只报两个值。

### 代价（诚实说清）

1. **B 簇离提示词框远了一步**（约 40px，从框的右上角挪到框正下方那一行）。这是这次拿「不误导阅读顺序」
   换来的，用户在读完 v1 之后自己做的取舍。
2. **底栏一行变长了**：视频节点多了三颗 28px 的 icon 加两根分隔线。卡宽仍由 `w-max` 算出来，
   不超过 `max-w-880`；单行不换行仍是硬断言（`assertSingleRow`）。
3. **纯 icon 的可读性风险从「提示词框旁」搬到了「底栏里」**——旁边就是带文字的模型芯片和参数 chip，
   对比之下三颗无字 icon 更需要 hover 才认得出。卡点表 ① 那条要盯的东西没变，只是位置变了。
4. **优化那颗是 Nomi 品牌标记（实心块），和两颗描边 icon 不同族。** 它是现役 `NodePromptOptimizer`
   触发器用的同一枚（`NomiLogoMark`），我没有替它换图标——那是另一次拍板的事。但在这一行里，
   它和右边的深色生成钮构成**两个黑块**，视觉重量高于左右两颗描边 icon（见
   `composer-bar-v1-video.png` 底栏）。**这一条也请在拍板时一并看**：接受、或换成描边款的 ✨。

### 走查新增的硬断言

| 断言 | 拦的是什么 |
|---|---|
| `assertSingleRow` 增查 `data-bar-segment` 顺序 = `model-params → prompt-tools → variants → generate` | 「模型和参数在前两个」被后来的改动打乱 |
| `assertClusterIsSmaller`：量 `getBoundingClientRect`，B 簇每颗 ≤ 28px 且**严格小于**底栏最高控件 | 「缩小一号」变成一句只在 class 名里成立的话（写着 sm 却被外层拉高，量得出来） |
| 簇内顺序 = `camera-move → effects → optimize`（图片节点 `effects → optimize`） | 顺序漂移 |
| `expectAbsent('[data-node-composer-prompt] [data-prompt-tool], … button')`，基线是「底栏里确实有簇」 | 「提示词区右端没有控件」在簇整个没渲染时也假绿 |

---

## B · 逐参数下拉（2026-09-11 02:10 用户拍板 · 同日实施）

> 这一节推翻的是 v1.1 的第 1 条实现细节（「参数 chip 只报两个值」），其余（B 簇 / 锁 / 三段）原样不动。

### 他说中的是什么

v1.1 的参数 chip 长这样：`[16:9 · 5s ▾]`。它**读得出**、但**够不着**——想把 5s 改成 8s，
要先点 chip 打开面板、再在面板里点一次。这一步是继承来的：2026-07-17 那版把「摘要 pill + 统一面板」
定成形态时，解决的是「参数多时内联下拉挤成一团」；一年下来参数被档案收敛成三五个，
挤的问题没了，多出来的那一步却留下了。付费卡（`layout="stacked"`）复用同一个组件，
所以那边也一样多一步。

用户 02:10 的原话大意：**每个常用参数自己一颗下拉 chip，一步到位**；长尾收进一颗 ⚙。

### 形态

```
[模型 ▾] [变体 ▾] [16:9 ▾] [5s ▾] [1080p ▾] [⚙]  │  [🎥][✦][✨]  │  [×1 ▾] ……… [↑]
   身份（不缩）        主参数：看得见 = 点得到        长尾    帮我写提示词      出几张 / 走
```

**露哪几颗由模型档案决定，不硬编码**（`nodes/primaryParameterChips.ts`）。判据三条，缺一不可：

| 条 | 判据 | 为什么 |
|---|---|---|
| ① | 档案声明了**比例 / 时长 / 清晰度**这三个语义角色之一 | 这三个是「值本身就读得懂」的那一批（`16:9`/`5s`/`1080p`），chip 上不写参数名也认得出。种子写成 `12345`、生成音频写成「开」，摆出来占的是宽度、给的是问号 |
| ② | 点开确实**选得出东西**：有候选项，或能从 `min/max/step` 切出有限档位 | 档案里 `duration` 常声明成 `number` + 区间（Seedance 2 是 4–15s），不 derive 档位就没得选；切不出档位的连续量（denoise 0–1 未声明步长）留在 ⚙ 里的输入框上 |
| ③ | 不是开关 | boolean 的 chip 只能显示「开/关」，读不出它管什么 |

角色表**不是新词表**：`aspect_ratio / size / ratio / durationSeconds / resolution …` 这些别名与
catalog 的 `binding` 早就是本仓「哪个键表示哪件事」的唯一出处（去重、写回多键、视频比例默认覆盖都读它），
这次只是把「读得出角色」显式命名并导出（`parameterControlRole`）。所以：

- 档案里没有清晰度 → 就没有那颗 chip（**不补默认值假装模型支持**）；
- 图片模型自然只剩比例 + 清晰度，视频才有时长——不在 UI 里按 kind 点名；
- 用户自接入的模型 / 导入的 ComfyUI 工作流（采样步数、帧率…）**一颗 chip 都不出**，全在 ⚙ 里。
  它们的参数名是工作流作者随手起的，摆成没有名字的值 chip 就是 `15 · 24` 那条老问题（群反馈 G2#433）。
  ⚙ 的名字带条数（「更多参数 · 4 项」），那句「勾过的功能到底在不在」由它回答。

**顺序固定为 比例 → 时长 → 清晰度**，不随档案声明顺序漂：底栏是每次生成前都要扫的同一行，
比例这颗今天第一位、换个模型跑到第三位，等于每换一次模型都要重新找一遍。

### 一行装不下时（不允许换行）

1. **先靠短标签**：chip 上只印当前值，不印参数名（参数名在 `aria-label` 与 hover 的 `title` 里）。
2. **仍装不下就退位**：按上面那个顺序**从尾巴退**（先退清晰度，再退时长），退下来的回到 ⚙ 里它在档案中的原位。
   一颗都装不下就全退，绝不换行、绝不缩成看不清的小字。
3. 「装不装得下」是**量出来的**（`useFittedChipCount`：行内容比行本身宽 = 装不下），
   不是按「每个字大约几像素」估的——卡宽是 `w-max` 算出来的、可用区还会被 Agent 面板真实挤窄，
   估错的那一次表现为**底栏被裁掉一半**（卡是 `overflow-hidden`）。
   为此身份两枚（模型 / 变体）在横排里**不缩**：否则宽度不够时先被榨没的是模型名，而它是这一行的一等决策。

### 代价（诚实说清）

1. **底栏更长了**：视频节点从「模型 + 变体 + 一颗 pill」变成「模型 + 变体 + 三颗 chip + ⚙」。
   卡宽仍由 `w-max` 算、封顶 880px，单行不换行是硬断言。
2. **比例的图形选项没了**：面板里那组分段每项带一个比例小图形（2026-07-17 拍板的细节），
   下拉列表只能给文字。常用序（16:9 / 9:16 领头）保留，走的还是同一把尺子 `commonRatioSortKey`。
3. **退位之后不会自动补回来**：卡从窄变宽时，只有宽度真的变了才重新摆满；否则要等换模型/换模式。
   宁可这样，也不要为了「随时补回来」引入一加一退的抖动。
4. **⚙ 用的是滑块 icon（`IconAdjustmentsHorizontal`）不是齿轮**：齿轮在本仓已经是「设置」的家
   （`NomiAppBar` / 供应商设置），参数不是设置。**这一颗请在拍板时一并看**：接受，或换成齿轮。

### 删了什么（P1 加新必删旧）

| 删除 | 连带 |
|---|---|
| 摘要 pill（`summaryTrigger` / `summaryWidth` / 冻结文本 / 走查锚点 `data-parameter-summary`） | 「点开才够得着」这一步 |
| `summaryOverride` 这条缝 | 它只为「导入工作流报名字+条数」存在；⚙ 的名字带条数之后不需要第二条摘要通路 |
| `nodes/composerHeadlineSummary.ts`（v1.1 当天新加的两值摘要）与它的测试 | chip 化之后没有「摘要」这个东西了 |
| `isImportedComfyWorkflowModel()` 与 i18n `parameters.workflowParams` | 上一条的唯一调用者；ComfyUI 那支不再需要一条按供应商分叉的文案（P2 修根因不修症状） |

### 走查新增的硬断言（真机）

| 断言 | 拦的是什么 |
|---|---|
| 每颗 `[data-parameter-chip]` 都有 `button` 触发器、可命中、带当前值 | 「一步到位」退化成一段不可点的文字 |
| 像真人一样点第一颗 chip → 下拉里挑另一个值 → chip 的 `data-parameter-chip-value` 真的变了 | 只改了下拉自己的显示、没写进节点（store） |
| 打开 ⚙ 后：里面**有**长尾参数（基线），且**没有**任何一颗已经上底栏的参数 | 同一个值两个家；以及「点开是空白的齿轮」 |
| 改完参数底栏仍是单行 | 换行 / 撑爆卡宽 |

---

## 现状（before）· 改之前是什么样

样张阶段那两格 before 渲染的是接线前的**现役 `NodeGenerationComposer` 本体**，
钉住的是这两条实测事实（截图已随接线一起退役，事实留档在这里）：

| 节点 | 接线前的底栏 |
|---|---|
| 视频 | 9 件挤一行，卡宽 768px：`锁 / 更多▾ / Seedance 2 / 变体 标准 / 1080p · 16:…（截断）/ 运镜 · 推近 中 / 优化 / 1 张 / ↑` |
| 图片 | 7 件（少了运镜和变体） |

读过的现役实现（全文，不是片段）：
`NodeGenerationComposer.tsx`·`NodeParameterControls.tsx`·`InlineParameterBar.tsx`·
`NodeCameraMoveControl.tsx`·`NodePromptOptimizer.tsx`·`NodeFloatingToolbar.tsx`·`NodeEffectChips.tsx`。

---

## 任务卡（这张样张的验收标准）

> **用户** 在 **点开一个节点、准备按下生成的那一刻**，一眼看到 **要出什么、花多少**，一步点生成就走。

一张卡只描述这一个时刻。写提示词、挑效果、配运镜都是**之前**的事，参数微调是**偶尔**的事——
它们不该和「出什么 / 花多少 / 生成」抢同一条常驻带。

---

## v1.1（只这一件）

底栏一条三段：**`[模型 ▾] [⚙ 16:9 · 5s ▾] │ [🎥] [✦] [✨] │ [×1 ▾] ………… [↑]`**，单行、不换行。

| 类 | 是什么 | 归到哪 | 样张证据 |
|---|---|---|---|
| **A · 决定出什么、花多少** | 模型芯片、参数 chip（两个值）、×N、生成 | **底栏第一段与第三段** | `composer-bar-v1-video.png` |
| **B · 帮我写提示词** | 🎥运镜、✦效果（原「更多▾」）、✨优化 | **底栏中段一簇缩小一号的纯 icon**，hover 出名字 | `composer-bar-v1-video-camera.png` / `composer-bar-v1-cluster-hover.png` |
| **C · 锁** | 锁 / 解锁 | **回节点右上浮条**，和「复制变体 / 生成记录」同一条 | 每一格 v1.1 的顶部浮条 |

三条实现细节：

1. **参数 chip 只报两个值** —— 视频 = 比例 + 时长，图 = 比例 + 清晰度。走 `InlineParameterBar`
   **已有的** `summaryOverride` 缝（ComfyUI 工作流那一支在用同一个入口），不新造第二条摘要通路；
   点开仍是同一块全参数面板，一个参数都没少。样张里这两个值是从档案 derive 的（`resolveRenderedControls`
   给出控件、`controlInitialValue` 给出当前值），换个模型照样说得对，不是写死的一句文案。
2. **B 簇不合成一个菜单**（用户 2026-09-10 定：分组到簇就停）。合成 `⋯` 会给三个中频动作各加一次点击，
   正是 §1.5.4 记着的那条反例。v1.1 把它并进底栏之后这条更要守住：一行里再塞一层 `⋯`，
   就是把「缩小一号」的省地换成了每次多一次点击。
3. **运镜已选时 icon 带一个激活点**，tooltip 写「推近 · 中」——长文字从行里退到 hover，
   状态本身没丢。tooltip 文案与现役芯片 `chipSummary` 同一口径（运镜 · 速度）。

**卡宽是算出来的，不是挑的**：v1.1 卡沿用现役 composer 卡的 `w-max / min-w-360 / max-w-880` 边界，
底栏内容变了之后卡宽由排布自己算出来（实测值以本次走查截图为准），不在样张里挑一个数。

### 三版减法梯度

| 版 | 内容 | 判断 |
|---|---|---|
| **v1.1（推荐）** | 三类归位 + B 簇缩小一号并进底栏中段 | 默认推这版（用户 09-10 21:20 反馈后的当前版） |
| v2 | v1.1 + 参数 chip 支持「钉住第三个值」（比如常调清晰度的人把它钉上去） | 等有人真的抱怨再加 |
| v3 | v1.1 + B 簇支持自定义顺序 / 增删 | 不做：给一个三颗按钮的簇加配置面板，是拿复杂度换零收益 |

---

## 删除清单（我**没**放上去的）

| 没放 | 为什么 | 用户要它时怎么找到 |
|---|---|---|
| **锁** 不放底栏 | 锁的作用对象是**节点**，不是这一次生成。它 2026-08 搬进底栏是为了「就近可达」，但就近的对象搞错了——节点的动作家族在节点浮条上（复制变体 / 生成记录）。一个动作只能有一个家（§1.5.2）。 | 选中节点 → 正上方浮条最左一颗 |
| **「运镜 · 推近 中」这句文字** 不留底栏 | 它是**已选值的回显**，不是决策位。回显占一整格常驻宽度，而底栏的常驻预算要留给「出什么 / 花多少」。控件本身留在底栏中段，只是把文字降级成 hover。 | 底栏中段 🎥；已选时 icon 带激活点，hover 报「推近 · 中」 |
| **「优化」的文字** 不留底栏 | 它是中频工具不是决策位，占一格带文字的常驻宽度太贵；v1.1 起控件留在底栏，只剩 icon。 | 底栏中段 ✨；hover 出「优化提示词」 |
| **「更多▾」这个名字** 不留 | 它往提示词里塞内容，却顶着「更多」这个名字，谁也猜不到里面是效果库。v1.1 换成 ✦ + hover「效果与提示词库」——名字在 hover 里说清，好过一个骗人的常驻名字。 | 底栏中段 ✦；hover 写「效果与提示词库」 |
| **清晰度 / 生成音频 / 变体** 不进 chip 文案 | 它们影响结果但**不是用户每次都要确认**的那两个；串进 chip 就是今天这个 `1080p · 16:…`。 | 点 `⚙` chip → 同一块全参数面板，一个不少 |
| **参数 chip 不合并模型芯片** | §1.5.4 白纸黑字：「模型是用户最看重的一等决策，合并等于把它埋了」，且是 2026-07-17 已拍板的形态。 | 模型仍在底栏左起第一位 |

---

## 卡点表（这条路会卡在哪）

| # | 问题 | 答 | 证据 |
|---|---|---|---|
| ① | 他怎么知道 B 簇在那？ | 三颗 icon **常驻**在底栏中段（不是 hover 才出），就在他按生成前必然扫过的那一行；hover 出名字。风险是纯 icon 的可读性——§6「盲测」那条：✨（Nomi 标记）与 🎥 现役已在用同一语义，✦ `IconSparkles` 是新配的，**这一颗是拍板时要盯的**；v1.1 把它挪到带文字的模型芯片旁边，对比之下更需要 hover 才认得出。 | `composer-bar-v1-cluster-hover.png`；`nodeComposerBarLabKit.tsx` 的 `PromptToolCluster` |
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
| §1.5.1 L1 常驻 ≤5 个功能簇 | 底栏从 9 件散排 → **3 段**（决定出什么·花多少 / 帮我写提示词 / 出几张·走）。件数没少多少，但**要读的东西**从 9 件变成 3 段，且没有把任何中频控件收进 ▾ 凑数（§1.5.4 第一条反例） |
| §1.5.2 一功能一个家 | 锁只剩浮条一个入口（底栏那份删掉）；效果 / 运镜 / 优化各只剩簇里一颗 |
| §1.5.2 常驻位有预算 | 底栏没进任何新功能，进来的三颗是**从底栏别处搬来的同一批**（v1 一度搬出去，v1.1 搬回同一条带子并缩了一号） |
| §1.5.2 情境控件不许挤常驻条 | 「运镜 · 推近 中」那句长文字退到 hover——底栏宽度不再随「运镜选了什么」变（今天选了长名字的运镜会把底栏撑宽，那就是布局抖） |
| §1.5.3 手法优先级 | 用的是**归位 + 分组 + 降级（文字→icon）**，可达性代价 0；只有参数 chip 的次要值算「收纳」，而它本来就已经在弹层里 |
| §1.5.3 动作不许压在内容上 | **v1.1 才真过这条**：v1 让 B 簇浮在提示词输入区顶端，虽没压生成结果，却改写了那块内容的阅读顺序（用户读成「提示词要写到它下面」）。v1.1 没有任何浮层压在任何内容上 |
| §1.5.3 分段要有名字 | B 簇保留 `role="group"` + 组名「写提示词」，视觉上靠两根现役 `ToolbarDivider` 与左右两段分开；不再需要独立描边容器 |
| §1.5.3 作用域不同要可分 | 一行里「决策位」（带文字，28-30px）与「工具位」（无文字，28px 纯 icon）靠**文字有无 + 分隔线**区分；走查量 `getBoundingClientRect` 保证工具位严格小于最高决策位 |
| §1.5.4 别把模型合进一句话 | 没合，模型芯片原样留在底栏第一位 |
| §1.5.5 新面三件产物 | 任务卡 ✓ / 三版减法梯度 ✓ / 删除清单 ✓ / 卡点表 ✓ |
| §2 token-only | 全部走 token；无 hex、无任意 px 字号或圆角；B 簇尺寸取 `WorkbenchIconButton` 已有的 `sm` 档，**没造新尺寸** |
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

## 截图（接线后 · 相对仓库根）

设计实验室（5 格 + 接触表，`pnpm run design-lab:walk:node-composer-bar`）：

```
tests/ux/shots/design-lab-node-composer-bar/_contact-sheet.png
tests/ux/shots/design-lab-node-composer-bar/composer-bar-v1-video.png
tests/ux/shots/design-lab-node-composer-bar/composer-bar-v1-video-camera.png
tests/ux/shots/design-lab-node-composer-bar/composer-bar-v1-image.png
tests/ux/shots/design-lab-node-composer-bar/composer-bar-v1-video-dark.png
tests/ux/shots/design-lab-node-composer-bar/composer-bar-v1-image-dark.png
```

真机（打包 Electron 里点出来的，`node tests/ux/node-composer-placement.walk.mjs`）：

```
tests/ux/shots/node-composer-placement/01-video-node-composer.png
tests/ux/shots/node-composer-placement/05-image-node-composer.png
tests/ux/shots/node-composer-placement/06-video-chip-open.png   ← §B：点一颗 chip 直接弹下拉
tests/ux/shots/node-composer-placement/07-image-more-panel.png  ← §B：⚙ 里只剩长尾（视频那格的模型三个参数全上了 chip，没有 ⚙）
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
| `generationCommon.parameters.moreParameters`（§B 新增） | `更多参数 · {{count}} 项` | `More parameters · {{count}}` |
| ~~`generationCommon.parameters.workflowParams`~~ | §B 删除（它只服务已删掉的 `summaryOverride`） | — |
| `generationCommon.optimizer.aria`（复用） | 优化提示词 | — 现役 |
| `generationCommon.cameraMove.title`（复用） | 运镜 | — 现役 |
| `generationCommon.node.lock.lockHint`（复用） | 锁定提示 | — 现役 |

---

## 这份文档的证据强度（别读岔）

接线之后不再有「样张」这一档：设计实验室五格与真机走查截的都是**同一份生产代码**。

| 部分 | 是什么 |
|---|---|
| 实验室五格 | **现役 `BaseGenerationNode` + `NodeGenerationComposer` 本体**，`coverage: shell`。夹具只给了两件东西：一个只读模型目录桥（实验室没有 Electron 桥）和一个节点 meta，参数 chip 上那两个值仍由档案 derive |
| 真机两张 | 打包 Electron 里用真实鼠标建节点、选节点截的，不灌 store、不注入夹具 |
| 底栏三段 | 生产实现：第一段 `NodeParameterControls section="parameters"` → `InlineParameterBar`；中段 `NodePromptToolCluster` 包着现役的 `NodeCameraMoveControl` / `useNodeEffectChips().more` / `NodePromptOptimizer` 三个**触发器换了外观、弹层与逻辑一行没动**的控件；第三段 `NomiSelect` + `GENERATE_BUTTON_CLASS` |
| 锁 | `FloatingToolbarShell` 里的 `NodeLockBadge`，六条浮条共用同一份（`lockNodeId` 必填，让编译器逼每条浮条答一次） |

---

## 接线落点（2026-09-11 已做）

| 拍板那一条 | 落在哪 | 删了什么 |
|---|---|---|
| **（B · 02:10 覆盖下面那条）** 每个主参数一颗下拉 chip、长尾进 ⚙ | 新 `nodes/primaryParameterChips.ts`（判据从档案 derive）+ `nodes/useFittedChipCount.ts`（装不下就退位，量真实盒子）；角色表 `parameterControlRole` 挂在既有的别名/binding 唯一出处上 | 摘要 pill 整条路（`summaryTrigger`/`summaryWidth`/`summaryOverride`/`data-parameter-summary`）、`composerHeadlineSummary.ts`、`isImportedComfyWorkflowModel()` 与 `parameters.workflowParams` |
| ~~参数 chip 只报两个值~~（当天 02:10 被 §B 推翻） | 曾是 `nodes/composerHeadlineSummary.ts` → `summaryOverride` 缝 | 已随 §B 全部删除，无并行版 |
| B 簇 = 缩小一号的纯 icon | 新 `nodes/NodePromptToolCluster.tsx`（只放外观与分组：`WorkbenchIconButton size="sm"` + Radix `Tooltip` + 激活点），三个控件各自的触发器改用它 | `NodeCameraMoveControl` 带文字的芯片（连同 `cameraMove.hint` 词条）· `NodePromptOptimizer` 带文字的按钮与它的 `ml-auto`（连同 `optimizer.optimize`）· `NodeEffectChips` 的「更多 ▾」（连同 `libraries.gallery.more`） |
| 锁回节点浮条 | `FloatingToolbarShell` 里，`lockNodeId` 是**必填**参数：六条浮条每条都得答一次「你挂的是不是一个可锁的节点」，写成可选就是下一条浮条静默少一把锁（R28 让编译器拦） | `NodeGenerationComposer` 底栏那份 `NodeLockBadge` 与「锁移到底栏」那段注释；`NodeLockBadge` 的 `locked` / `selected` 两个 prop（锁态自己从 store 读，不把同一个事实抄两份） |
| 底栏一行三段 | `NodeGenerationComposer` 底栏：`data-bar-segment` 四段 + 两根现役 `ToolbarDivider`；一件工具都没有（锁住的节点）时整段连分隔线一起不渲染 | — |

还没做的一件：**录基线**。等用户看过真机截图点头，再删 `calibration.json` 里
`node-composer-bar` 的待拍板登记并跑 `pnpm run design-lab:update -- --screen node-composer-bar`。
