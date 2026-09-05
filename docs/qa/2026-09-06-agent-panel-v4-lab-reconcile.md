# Agent 面板 v4 · 逐板对账（2026-09-06 · 返工版）

对账对象：定稿 `docs/design/2026-09-06-agent-panel-v4.md` 的 12 板画布
（源在 `docs/design/mockups/2026-09-06-agent-panel-v4/src/*.body.html`，尺寸/间距/颜色的真相源是同目录 `_agent.css`）。

**并排图**：`artifacts/design-lab/agent-panel-v4/reconcile/<板>.png`（12 张，`artifacts/` 不进 git）。
左半是**从画布源现渲再按选择器裁**的那一格（同一份 `_agent.css` + 真 `src/theme/nomi-tokens.css`），
右半是设计实验室里对应状态的实现截图。每一对我都自己打开看过，出入逐条列在下面。

**接触表**：`artifacts/design-lab/agent-panel-v4/contact-sheet.png`（57 态平铺，1778×5353）；
逐态原图在 `tests/ux/shots/design-lab-agent-panel-v4/`，重跑 `pnpm run design-lab:walk:v4`。

## 上一版为什么不作数

上一版这份文档写「有出入：0」。它不成立，原因是**取景框错了**：44 个状态全部渲染整块面板
（`AgentPanelV4Panel` 按 view 枚举加几处 `if`），于是 `v4-composer-idle` 那一格里 composer 只占底部 86px，
其余 534px 是与它无关的对话流——接触表三列近乎一样，任何积木的状态差别都看不出来。
在那种取景框下比对，只能比出「面板还在」，比不出「这个状态对不对」。

本轮按画布的**板**重新分组：Vocabulary / Composer 两板画的是单个积木的状态阵列 → 实验室只渲那一件（`Piece` 取景框）；
Flow 三板 + Rendering + Dark + Collapsed 画的是整块面板 → 才渲整块。

## 逐板对账

图例：**一致** = 并排看过、逐件对上；**出入** = 不一致，后面写处置。

### Vocabulary 板（8 积木）→ `reconcile/Vocabulary.png`

| 画布件 | 实现状态 id | 结果 | 处理 |
|---|---|---|---|
| ① 用户气泡 · 纯文本 | `v4-user-plain` | 一致 | — |
| ① 用户气泡 · 附件 chip 在气泡内 | `v4-user-attachment` | 一致 | chip 在气泡 div 内，单测钉住位置 |
| ② 助手文本 · 流式 | `v4-assistant-streaming` | **出入 1** | 光标原来是块级兄弟节点，被 `<p>` 挤到下一行；改成最后一段的 `::after` 画，贴在行尾 |
| ② 助手文本 · 完成（hover 出复制/重来） | `v4-assistant-complete` | 一致 | 默认 `opacity-0`，`group-hover` 才显（画布批注要求）|
| ② 助手文本 · 已中断 | `v4-assistant-interrupted` | 一致 | — |
| ③ 收据 · 进行中 / 完成 / 展开 | `v4-tool-input-streaming` / `-output-available` / `v4-tool-expanded` | **出入 2** | 展开体标签原来是硬编码英文 `input` / `output`（同时违反 R15）；改走 i18n，渲成「输入 / 输出」，与画布 Process 板一致 |
| ③ 收据 · 载入技能 / 读取附件 / 布局改动 | `v4-tool-skill` / `-attachment` / `v4-tool-layout-undo` | 一致 | icon 逐个对着 `_tabler.json` 的 path 反查（见下节）|
| ③ 收据 · 失败 | `v4-tool-output-error` | **出入 3（保留差异）** | 画布 Vocabulary 格用 `×`、Process 板同一件用 `⚠`——画布自己两种画法。取定稿 §8「状态只用 spinner ✓ ⚠」，统一 `⚠` |
| ③ 收据 · AI Elements 七态其余三态 | `v4-tool-input-available` / `-approval-requested` / `-approval-responded` | 一致 | 画布没单独画，按协议词表补齐（`aiElementsContract.ts`）|
| ④ 任务卡 · 排队 / 生成中 / 完成 / 失败 / 已停止 | `v4-task-queued` / `-running` / `-complete` / `-failed` / `-stopped` | **出入 4** | 「采用」缩略图原来是整格填 accent 底（缩略图本身被盖住）；改成 accent 描边 + 左上角标，角标文字由数据给（画布 Vocabulary 板是「采用」、FlowGeneration 板是「2 ✓」）|
| ⑤ 介入槽 · 不可逆 / 可撤销 / 拒绝原因 / 付费 | `v4-intervention-irreversible` / `-reversible` / `-reject-reason` / `-spend` | 一致 | 「不再问 →」只在可撤销那张出现，单测钉住 |
| ⑤ 介入槽 · 反问 / 计划 / 缺凭证 / 有出入 | `v4-intervention-question` / `-plan` / `-credential` / `-deviation` | **出入 5** | 计划槽原来带「不再问 →」和「不要」；画布画的是「主动作 · 改一下 …… 收起 ▴」。按画布改（计划是清单，不勾就是不做），单测跟着改 |
| ⑥ 队列行 · 进行中/排队/插队删 · 完成划掉/立即中断 | `v4-queue-mixed` / `v4-queue-interrupt` | 一致 | 空队列不渲染，单测钉住 |
| ⑦ 收起坞 rail | `v4-dock-rail` | 一致 | 32px，带运行状态点 |
| ⑧ Context 环 · 收起 / 展开 | `v4-context-ring` / `v4-context-expanded` | **出入 6** | 展开卡的 token 数原来是 `62,400 / 200,000`；画布是 `62.4K / 200K`（230px 宽装不下千分位）。改成 K 缩写 |

### Composer 板 → `reconcile/Composer.png`

| 画布件 | 实现状态 id | 结果 | 处理 |
|---|---|---|---|
| 底栏 `[+] [模型名 ▾] ｜ [Skill] …… [权限 ▾] [↑]` | `v4-composer-idle` | **出入 7（本轮最大一处）** | 原来是：回形针图标当「+」、没有 Skill 钮、发送用纸飞机 `IconSend2`。改成：`IconPlus`（一个加号收任意文件）、模型名纯文字无 icon、竖分隔、`IconPackage` + 「Skill」（选中带 accent 小点）、右侧权限文字胶囊、圆形 `IconArrowUp` 发送 |
| 运行中（■ 停止 + 排队占位） | `v4-composer-running` | 一致 | 占位改「可继续输入，将排队发送…」|
| 带引用（附件 / 技能 / 片段三种 chip） | `v4-composer-reference` | **出入 8** | ① 高度原来是**定值**，三个 chip 一换行就把 textarea 挤掉半行 → 改成 `minHeight = 规则算的自然高 / maxHeight = 面板 derive 的上限`；② 片段 chip 色块原来用 accent，画布用 `--nomi-track-video` → 改用 `bg-nomi-track-video` |
| 模型弹层（对话 + 三类默认 + **预计单价**） | `v4-composer-model-popover` | 一致 | 四行一层，每行带单价 |
| Skill 弹层（搜索 + 分类 + 列表 + hover 预览位） | `v4-composer-skill-popover` | 一致 | 图标 `IconPackage`，底部「新建 · 管理」退成小链接 |
| 权限三档 segmented | `v4-composer-permission-popover` | 一致 | 默认「自动改」|
| 权限三档落到合同 | `v4-composer-permission-step` / `-safe-auto` / `-project` | **出入 9** | 三档原来是中文字面量 union（`'每步问' | '自动改' | '全自动'`）——既违反 R15，又是第二份要跟合同对齐的词表。改成 `PermissionTier = ProjectAgentApprovalPolicy['mode']`，文案走 i18n；`data-approval-mode` / `data-spend-policy` 单测钉死 step→confirm、safe-auto→confirm、project→within-budget |
| 高度① 初始一行 | `v4-composer-height-one-line` | 一致 | 86px（按 `_agent.css` 的 `.txt{min-height:44}` + `.bar` 40 + 边框 2 精确算；画布正文标注「≈84px」是约数）|
| 高度② 逐行长 | `v4-composer-height-grow` | 一致 | 工具条贴底不动 |
| 高度③ 封顶滚动 | `v4-composer-height-capped` | **出入 10（保留差异）** | 画布用渐隐遮罩 + 一根装饰滚动条示意；实现是真 textarea 的真滚动条（还加了 `overscroll-contain` 防滚轮外泄）。行为对，观感差一层渐隐——不补假遮罩 |
| 上限随面板高度 derive | `v4-composer-height-tall-panel` | 一致 | 三档 40% / 30% / 6 行 + 收起坞 6 行，全在 `agentPanelV4Logic.ts` 单测里 |
| 收起坞里的 composer | `v4-composer-dock` | 一致 | 上限 6 行 |

### Process 板（7 时刻）→ `reconcile/Process.png`

| 画布件 | 实现状态 id | 结果 | 处理 |
|---|---|---|---|
| 时刻 1 发出 | `v4-user-plain` | 一致 | — |
| 时刻 2 思考中（shimmer + 秒数 + esc） | `v4-assistant-thinking` | **出入 11** | 上一版根本没有这一件（「思考行」被当成整块面板的一部分渲掉了）。新建 `V4Thinking`：brain icon 只在这一行、秒数在行尾、不用转圈 |
| 时刻 3 调工具中 | `v4-tool-input-streaming` | 一致 | — |
| 时刻 4 工具完成（展开输入/输出） | `v4-tool-expanded` | 一致 | 见出入 2 |
| 时刻 5 工具失败（原行变红 + 未扣费条） | `v4-tool-video-failed` | 一致 | 不弹窗不 toast |
| 时刻 6 回复流式 | `v4-assistant-streaming` | 一致 | 见出入 1 |
| 时刻 7 打断 / 排队 | `v4-tool-stopped` + `v4-queue-mixed` | **出入 12（保留差异）** | 画布「已停」行尾用 stop 方块；实现用 `×`（该行的协议状态是 `output-denied`）。定稿 §8 只允许 spinner / ✓ / ⚠ 表状态，不再引入第四个状态图形 |
| icon ↔ 动词表（含 5 个禁用项） | 无对应状态 | 一致（无界面件）| 这张表是**规则**不是界面。规则的唯一 owner 是 `AgentPanelV4Icons.tsx` 的 `ACTION_ICONS`，19 个家族逐个对着 `_tabler.json` 的 SVG path 反查得到；禁用的 robot / sparkles / cpu / hourglass / 纯 loader 一个都没进这张表 |

**顺带修掉的一处同语义两份定义**：`vendor/aiElementsContract.ts` 里另抄了一份 6 条的 icon 表，
其中 `timeline: 'IconTimelineEvent'`、`video: 'IconVideo'` 两条与画布反查出的 `IconTimeline` / `IconMovie` 对不上。
删掉那份抄件，只留指向唯一 owner 的注释。

### Flow 三板 → `reconcile/FlowCreation.png` / `FlowGeneration.png` / `FlowPreview.png`

| 画布件 | 实现状态 id | 结果 | 处理 |
|---|---|---|---|
| 头部 `N Nomi + Context 环 …… 历史 / 收起` | 三态共用 | **出入 13** | 原来标题是「Nomi Agent」、右侧只有一个 Context 环。改成：`N` 方形 logo + 「Nomi」+ Context 环紧跟其后 + 弹性空白 + `IconHistory` / `IconLayoutSidebarRightCollapse` 两个图标 |
| 创作流程整块 | `v4-flow-creation` | 一致 | 夹具对齐：载入的技能改成 `/shots`（原来错用了 Kasdan）、「起草分镜」行显示「进行中」|
| 生成流程整块 | `v4-flow-generation` | **出入 14** | ① 付费槽原来复用了通用夹具（¥1.20 / 4 段），画布是 ¥0.90 / 1 段 + 首帧说明 → 另立 `spendOneClip` 夹具；② 任务卡缺卡尾「已花 ¥0.24」→ 给 `TaskCardData` 加 `footnoteTrailing`；③ 缩略图角标改成画布的 `1 ✓ / 2 ✓ / 3 … / 4 排队` |
| 预览流程整块 | `v4-flow-preview` | **出入 15** | 任务卡的卡体整条不见了：开卡体的条件漏了 `footnote` / `undoable`，于是「2 处改动 · 同一个 ⌘Z + 撤销」那一行渲不出来。补进条件 |
| 任务卡状态词（画布逐卡写「已应用」「2 / 4」）| — | **出入 16（保留差异）** | 状态词按五态枚举出一个词（完成 / 生成中 …），不按卡改写；逐卡的信息走 `trailing`。理由：定稿①「状态只改行尾，位置与 icon 不动」，一态一词才好认 |

### Rendering 板 → `reconcile/Rendering.png`

| 画布件 | 实现状态 id | 结果 | 处理 |
|---|---|---|---|
| 整块面板 · 12 种 Markdown 格式 | `v4-rendering` | **出入 17** | ① 超长折叠原来写死 `max-h-60`（240px），定稿写的是「折到**面板高 60%**」——640 高的面板里一张三行表格就被腰斩。改成从 `panelHeight` derive，并把「还有 N 行」的 N 量出来（渲染后的行数 ≠ 源文本换行数）；② 标题原来仍按 compact 档放大，定稿要求 390 宽里**一律降成粗体行 13px/600**，正文同样落到 13px → 给 `NomiMarkdown` 的 `agent-v4` 档补上 |
| 代码块复制 / 外链 ↗ / 图片→chip / 任务清单 | 同上 | 一致 | 四个小改早已在 `NomiMarkdown` 的 `agent-v4` 档；本轮补了任务清单夹具才看得到 |

### Collapsed 板 → `reconcile/Collapsed.png`

| 画布件 | 实现状态 id | 结果 | 处理 |
|---|---|---|---|
| 32px rail（带运行状态点） | `v4-dock-rail` | 一致 | — |
| 下沿 composer（压在画面上，上限 6 行） | `v4-composer-dock` | 一致 | — |
| 整幕（rail + 下沿 composer / 介入槽） | `v4-collapsed` | 一致 | 画布那一格还画了预览画面与时间轴——那是**壳**不是面板件，属接线阶段，不在本轮取景框内 |

### Dark 板 → `reconcile/Dark.png`

| 画布件 | 实现状态 id | 结果 | 处理 |
|---|---|---|---|
| 整块面板 · token 翻转 | `v4-dark` | **出入 18** | 首次并排看时右半是**浅色的**：暗色 token 只定义在 `:root[data-mantine-color-scheme="dark"]` 上，组件自己加 class 翻不动。给 `LabState` 加 `scheme?: 'light' \| 'dark'`，由 `designLab.tsx` 在挂载前钉死；`v4-dark` 声明 `scheme: 'dark'`。这是一张「暗色状态却渲成浅色」的假证据，靠肉眼并排才看出来 |
| 用户气泡在暗色下用 ink-10 底 | 同上 | 一致 | 纯 ink 底在 token 翻转后会变成浅色块 |

### Main / Feasible / Sources 板 → `reconcile/Main.png` / `Feasible.png` / `Sources.png`

**无界面件**：这三板分别是「一页读懂」的八张文字卡、可行性 file 级对照表、来源归属表。
它们没有可对账的控件，因此**不注册实验室状态**——不为凑数造一个「整块面板」state 顶上去。
三张图里存的是整板原样，供读文档时对照。

## 出入合计

**18 处**：12 处已改（1、2、4、5、6、7、8、9、11、13、14、15、17、18 —— 其中 7 / 9 / 11 / 13 / 17 / 18 是结构性的），
4 处**保留差异并写明理由**（3、10、12、16）。
上一版写的「0 处」是取景框错误下的产物，不是事实。

## 本轮的机器防线

- `src/workbench/ai/v4/agentPanelV4Logic.test.ts`：高度三档 + 收起坞档 + 逐行长 + 封顶 + chip 行；权限三档 ↔ 合同两字段（含与 `DEFAULT_PROJECT_AGENT_APPROVAL_POLICY` 的一致性）+ 「不再问」抬档；Enter / Shift+Enter / IME composition。
- `src/workbench/ai/v4/agentPanelV4Blocks.test.ts`：8 个积木**逐状态**渲染断言（Tool 七态、Task 五态、介入槽八 kind 各自 `data-*`；采用是描边不是填底；失败带原因与「未扣费」；空队列不渲染；composer 底栏四个控件齐全且无语音钮；高度写进 `data-height`）。共 56 条。
- `pnpm run design-lab:walk:v4`：57 态逐个渲染 + 非空断言 + 零 pageerror + 拼接触表。
- `check:design-lab`：结构道（注册表可解析、id 唯一、基线↔注册表一一对应、实验室代码类型检查）。
  视觉基线**未录**——`calibration.json` 的 `pendingApprovalScreens` 里登记了 `agent-panel-v4`：
  这一屏还没被用户看过，现在录基线只会把「今天碰巧长这样」钉成「应该长这样」。拍板后跑 `design-lab:update` 并删掉那条登记。

## 顺手修掉的两个走查坑

1. **端口被别的 worktree 占**：v4 走查首跑连到了 `Nomi-ui-shell-small` 起在 5199 上的 vite，
   截出来的是别人家的界面，而每一张看起来都很正常。注册表比对救了这一次，但报错是 30 秒后的
   `boundingBox timeout`，看不出真因。现在 `walkScreen.mjs` 在「活页面状态与本仓一个都不重叠」时当场停并打印
   `lsof` 命令 + 「别 kill 别人的 dev server，换端口」。本屏端口改 5241。
2. **32px 宽的件会被判成「没渲染出来」**：走查的非空判据是 `width < 40`，而收起坞 rail 本来就是 32px。
   把它放进同一个 `Piece` 取景框（左边留出它贴着的内容区），不动那条判据——判据在，别的空舞台才拦得住。
