# 收官 A · 剪辑面真实用户走查与修复

> 状态：✅ 已完成 · 日期：2026-09-06 · 基线：`origin/main` @ 747adf59（含 #508 / #510 / #511 / #513 / #514 / #515）
> 走查脚本：[`tests/ux/editing-real-user-pass.walk.mjs`](../../tests/ux/editing-real-user-pass.walk.mjs) · 命令：`pnpm run build && node tests/ux/editing-real-user-pass.walk.mjs`
> 截图：`tests/ux/shots/editing-real-user-pass/`（13 张，01→13 按旅程顺序）
> 合同：[`docs/design/2026-09-05-editing-panel-design-contract.md`](../design/2026-09-05-editing-panel-design-contract.md)（分支 `claude/gpt-discussion-review-06eb91`）

## 这一轮在回答哪个问题

用户 2026-09-05 的原话是「防止用户拿到手不能用」。所以这轮不是补测试覆盖率，而是**带着一个真人
的任务从头走一遍剪辑面**，把「点了没反应 / 找不到 / 读不懂 / 跳一下 / 名实不符」全部当 bug 处理。

人物设定：一个想做一支 15 秒短片的人。素材是本机 ffmpeg 现造的三段纯色片（各 5 秒）+ 一段
15 秒正弦音当配乐；画布上三个镜头按「已出片」预置。全程零额度、隔离 profile。

旅程：打开项目 → AI 拼片 → 接缝加转场并改成淡入淡出 12 帧 → 选中第 2 镜改音量 / 淡出 / 画面 →
看输入框 chip → 快捷键面板并逐个实按 → 右键分割 / 涟漪删除 / ⌘Z → 空轨右键进素材页 →
加配乐 / 轨道头静音 / 配乐音量 → 加字幕改字体并对齐到所在镜头 → 导出 720p 与 1080p →
`ffprobe` 验尺寸、时长、音轨，`ffmpeg` 抽接缝帧验转场真的渲染进去了。

**结果：35 条判据全绿。**共抓到 **19 个问题，修掉 19 个**；另有 2 项记为待办并写清原因。

## ① 情绪摩擦日志（走查逐步记录，脚本会原样打印）

| 步骤 | 当时的感受 |
|---|---|
| 第一眼 | 时间轴是空的，四条轨都在，空轨收成窄条不占地方——但「先干什么」全靠自己猜，没有一句引导 |
| AI 拼片 | 一下就铺满了，收据 toast 带撤销，心里有底；但按钮只有一个魔杖图标，第一次真不知道它会做什么 → **已修**（tooltip 改成「AI 拼片：把生成区已出片的镜头按镜序排进时间轴」） |
| 加转场 | 悬停接缝才冒出「+」，第一次容易找不到（合同 §2.4 就是这么定的，保留）；落下之后标记上写着「12f」，改起来直观 |
| 改属性 | 选中就出对应的组，不用去别处找；淡入淡出用秒不用帧，读得懂 |
| 属性面板转场 | 两颗按钮上直接写着现在是什么转场，不用再回时间轴上找那个小标记（**本轮从死按钮改成真入口**） |
| 跟 Nomi 说话 | chip 一眼能认出指的是哪一段（**本轮从 `clip-b videoTrack 120-240 a7d63bff` 改成「推门近景 · 0:05–0:10」**） |
| 快捷键 | 面板上写的键位现在按下去都真的是那件事了；之前 ⌘\ 会同时翻吸附和收面板，完全不知道自己干了什么 |
| 右键 | 八项全是动词，读得懂；⇧⌫ 终于和菜单上写的一致了 |
| 配乐 | 「+ 配乐」选一首就成了一条轨；空轨时静音钮是灰的并写明原因，不用怀疑自己点错了 |
| 字幕 | 加完直接选中并跳到属性面板的文字组；「对齐到所在镜头」省掉手动拖两条边 |
| 导出 | 导出按钮固定在顶栏右上找得到；参数在属性面板里，改完再导就生效 |

## ② 抓到并修掉的问题（19）

### A. 点了没反应（死控件 / 名实不符）——7 个

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| A1 | 整片属性的「配乐音量」滑杆拖得动、什么都不改 | `<input type="range">` 只有 `defaultValue`，**没有 `onChange`** | 写进音频轨每段的 `clip.audio.gainDb`；音频轨为空时禁用并写明「先用时间轴上的『+ 配乐』加一段」 |
| A2 | 属性面板「转场 · 入 / 出」两颗按钮点了没反应，tooltip 还写着「转场选择器将在下一阶段打开」 | `onClick={() => undefined}`，是上线的占位 | 新建 `ClipTransitionFields`：没有相邻片段就禁用并说明；没转场点一下落默认叠化；已有转场按钮上直接显示类型+时长，点开时间轴上那一个选择器（不造第二份 picker） |
| A3 | 字幕右键「对齐到所在镜头」点了只是把菜单关掉 | `onClick: onClose` | 找到字幕中点所在的那一镜，把起止对齐过去；底下没画面时给一句 toast |
| A4 | 转场右键「套用到所有接缝」点了没反应 | `onClick: onClose` | 用同一把「接缝能不能放」的尺子枚举全部可放接缝，**整批一次 set、一次 ⌘Z 全撤** |
| A5 | 空轨右键「AI 拼片」「从素材库添加…」点了没反应 | 两项都是 `onClick: onClose` | 前者接到工具条那一颗；后者把左栏切到素材页（顺带展开左栏） |
| A6 | 片段右键「静音」把**整条轨**都静了 | 调的是 `setTimelineTrackMuted(track.id, …)` | 改成 `setTimelineClipAudio(clip.id, { muted })`；整轨静音在轨道头本来就有自己的按钮 |
| A7 | 空轨的轨道头静音钮可点、点了没反应 | `setTimelineTrackMuted` 对 0 个 clip 原样返回 | 空轨时 `disabled` + title 说明 |

### B. 说的和做的不一样（假键位 / 抢键）——4 个

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| B1 | 右键菜单与快捷键面板都写「涟漪删除 ⇧⌫」，按下去只是普通删除（留个洞） | 涟漪绑在**没人写出来的 ⇧Z** 上，⇧⌫ 落到 `remove-selection` | ⇧⌫ / ⇧Delete = 涟漪删除，删掉 ⇧Z 这个影子键位 |
| B2 | ⌘\ 按一次**同时**翻吸附和收 Nomi | 时间轴把 ⌘\ 绑给吸附，`PreviewWorkspace` 把 ⌘\ 绑给 Nomi，两边都监听 window | 吸附改 N；⌘\ 只归 Nomi；快捷键面板补上这两行 |
| B3 | 工具条 tooltip 写着缩放「（−）（＋）（0）」，三个键全都没绑 | `resolveTimelineShortcut` 里根本没有这三个分支 | 真绑上 `-` / `=` / `0`（缩小 / 放大 / 适配） |
| B4 | 按 N 翻吸附，屏幕上的吸附钮纹丝不动 | `snapEnabled` 是 `TimelinePanel` 的局部 state，而预览面与生成画布两个 TimelinePanel 因 keep-alive **同时挂载**，键盘事件翻的可能是看不见的那一个 | 吸附状态收进 store，一个开关一份真相 |

### C. 读不懂 / 挤 / 假占位——4 个

| # | 现象 | 修法 |
|---|---|---|
| C1 | 输入框 chip 写「时间线区间 clip-b videoTrack 120-240 a7d63bff」 | 改成「推门近景 · 0:05–0:10」；clipId / 轨道 id / 帧号 / revision 全部搬进 tooltip 与 `data-*`（排查不丢证据） |
| C2 | 选中一段之后，在**别处**改任何东西都会把这条 chip 标成「已变更，请重新选择」 | 陈旧判据从「整条时间轴的 revision」收窄成「我指的这一段还在不在原位」；用户自己调这一段的音量也不再误报 |
| C3 | 介入槽卡的摘要一行**就是**「查看细节」四个字，下面折叠区的按钮也叫「查看细节」——一句没说要动什么 | 认不出的工具兜底改成「它要做哪件事 · 动的是谁」；三处把折叠区按钮文案当摘要用的地方一并改掉 |
| C4 | 收起 Nomi 后有**两个**入口：右侧图标条写「展开 Nomi」，画面右上角又浮一颗「叫回 Nomi」胶囊 | 删掉胶囊，只留图标条，并给它加运行状态点（跑着 / 等你确认 / 空闲）；走查改成**计数**断言「叫回入口只能有 1 个」 |

### D. 交互跳一下 / 渲染错——2 个

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| D1 | 在转场选择器里换一个类型，选择器**当场消失**，想接着改时长得再点开一次 | 标记的 React `key` 里含转场类型 → 换类型 = 换 key → 卸载重挂，而选择器的开合状态住在标记身上 | key 只认接缝身份 `from:to`，类型是它的值不是它的身份 |
| D2 | 「淡入淡出」导出后在接缝上闪**一帧亮绿**（实测 rgb(0,138,0)），不是淡到黑 | `blend=all_expr` 的淡入淡出表达式把「0 = 黑」写死，而它跑在 **YUV** 上：`A*(1-2p)` 把 U/V 拉向 0 而不是 128 的中性值 | blend 两路输入先 `format=gbrp`，让「0 = 黑」这条前提真正成立；单测钉死这两个 `format=gbrp`，走查加一条「接缝中间必须压到暗」的亮度判据 |

### E. 走查/工具侧的假红与死码——2 个

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| E1 | `tests/ux/agent-runtime-editing.walk.mjs` 在 main 上红，报「面板没渲染」 | 两层：① 审批卡的选择器还是后代写法 `A B`，而介入槽收口后两个属性落在**同一个** `<aside>` 上；② 更根本的是**出厂审批档是 `safe-auto`**，`document.write` / `canvas.write` 都是 `reversible_local` → 自动落、根本不弹卡。走查还在等 step 档的行为 | 选择器收成一份 `APPROVAL_CARD` 常量（复合写法）；走查改成验产品真正的承诺：可逆本地写自动落 + 证据链仍然完整；「被停止的请求不许晚写」从「审批卡没冒出来」（恒真）改成直接查文稿与盘上内容 |
| E2 | `enableAgentHostThroughSettings` / `chooseCreationMode` 两个走查 helper 引用的开关与控件**在 src 里已不存在**，它们只是打开设置再关上 / 静默 return | 常驻 Agent 的发布闸与 composer 的提示词选择器都已删，helper 与 7 处调用没跟着删（P1） | 两个 helper 连同全部调用点删除；`golden-path` 里那一步「走设置打开常驻 Agent」（注释里本来就写了「闸删掉后此步删除」）一并删掉；`agent-vertical-spine` 合同 JSON 里的对应描述改成事实 |

## ③ 合同 §④ 11 条验收门逐条对账

| # | 验收门 | 结论 | 证据 |
|---|---|---|---|
| 1 | 加 / 改转场：空接缝点「+」落叠化 15f 并出现在导出混合帧；改 12f 后预览与导出一致 | ✅ | 本走查 03 / 12；`ffprobe` + 抽帧：接缝附近 `5.20s=rgb(7,7,6)` 真的压到黑（修 D2 前是 `rgb(0,138,0)`） |
| 2 | 属性面板四种选中对象各出对应组，组序不变；无选中显示整片 | ✅ | `editing-panel-system.walk.mjs` 全绿；本走查另验整片态 ↔ 片段态 ↔ 字幕态来回切 |
| 3 | 右键菜单 片段 8 / 字幕 4 / 转场 3 / 空轨 2，全是动词，无数值项 | ✅ | 本走查 08；A3–A6 把 4 个死项接上 |
| 4 | 片段音量 / 静音 / 淡入淡出写入 `clip.audio`，预览与导出同一 dB 换算 | ✅ | 本走查 04：`{gainDb:-6, fadeOutFrames:15, fit:'cover'}` 落盘 |
| 5 | 删左 / 删右 / 涟漪走内核，一步 ⌘Z 还原 | ✅ | 本走查 08：涟漪后 `0-150 150-300` 首尾相接，一次 ⌘Z 回到三段 |
| 6 | 轨道头静音进导出 | ✅ | 本走查 10：静音写进 `clip.audio.muted`；导出带 aac 音轨 |
| 7 | 720p / 1080p 可选，ffprobe 验尺寸 | ✅ | 本走查 12 / 13：`1280x720` 与 `1920x1080` |
| 8 | 每个工具条钮 tooltip 含键位；? 面板列全 | ✅ | 本走查 06 + B1–B4：面板里写的键位现在**逐个实按验证** |
| 9 | 面板系统五块可拖可收、重启保持、四预设、Agent `layout.write` 一行收据可撤销 | ⚠️ 部分 | 面板几何 / 收起 / 预设 / 恢复默认由 `editing-panel-system.walk.mjs` 全绿覆盖；**Agent `layout.write` 的收据与撤销本轮没有复验**（不在剪辑面手工旅程上），见 §⑤ |
| 10 | 打开即可用：四轨默认全可见、空轨窄条 | ✅ | 本走查 01 + `editing-panel-system` 的默认高度 260 |
| 11 | Agent 三类 op（transition / text / audio）走同一条 apply / undo | ✅ | `agent-timeline-ops.walk.mjs` 全绿（本轮重跑） |

## ④ 合同 §2.8「图标与认知负荷」逐项真机复核

| 位置 | 合同要求 | 真机 |
|---|---|---|
| 左栏 tab | 加 `IconMovie` / `IconPhoto` | ✅ 已有 |
| 叠加行 chip | 用 `IconMusic` / `IconSubtitles`，不用加号 | ❌→✅ 本轮改（原来两颗都是 `IconPlus`） |
| 属性 · 声音 | 显式「静音」一行 + 开关 | ✅ 已有 |
| 属性 · 时间 | 起点用时码、时长与淡入淡出用秒 | ❌→✅ 起点原来是自带的第三份手抄 `MM:SS`（`00:05`），与计划摘要读数不一致；本轮收敛到唯一的 `timelineTimecode` 模块，起点改 `0:05.00` |
| 属性 · 转场 | `IconTransitionLeft` / `IconTransitionRight`，类型只写字 | ✅ 保留（A2 重写后仍用这两个图标） |
| 组标题 | 保持纯文字 | ✅ |
| 右键菜单 | 每项带图标 + 键位 | ⚠️ 键位有、**图标没有**（合同写「保持」，但现役实现从来没有图标）。见 §⑤ |
| 所有图标 | 真实 Tabler 字形 | ✅ |

## ⑤ 没修的，以及为什么

1. **Agent `layout.write` 的收据与撤销（§④#9 的后半）**：它不在「一个人手工剪一支片子」的旅程上，
   要验它得另起一条 Agent 布局走查。本轮不硬塞进这条旅程里凑绿。
2. **右键菜单缺图标（§2.8）**：17 个菜单项加图标是纯装饰性打磨，不影响「拿到手能不能用」；
   本轮预算优先给了 19 个真会卡住用户的问题。
3. **`ResidentApprovalCard` 是死组件**：介入槽收口后没有任何地方渲染它，但
   `ProjectAgentResidentShell.structure.test.ts` 仍在按它的内部标记做一致性断言。删它要连带
   重新推导那几条断言当初想守的是什么，属于 Agent UI 轨的活，不在剪辑面这一刀里顺手做。
4. **分镜摘要卡那一族走查（`storyboard-*` / `draft-loop` / `creation-work-surfaces` 等 5 份）**：
   它们钉的是早已改掉的旧文案「打开分镜 / 再次编辑」与不存在的 `[data-creation-surface="storyboard"]`、
   `[data-storyboard-card="draft"]`。本轮只修了**每日门** `golden-path.e2e.mjs` 与
   `agent-runtime-production.walk.mjs` 这两份（它们因为 E2 的 helper 删除必须一起动），
   其余属于创作 / 分镜面的走查腐坏，另立一刀。
5. **`agent-runtime-production.walk.mjs` 仍红，但根因换了**：本轮把它两处过期选择器
   （`[data-storyboard-card="draft"]`、按钮文案「打开分镜」）都修到位、也走过了分镜那一段；
   现在停在更靠后的一条隔离断言 `Ephemeral image judging must not touch project or local working
   contexts`——那是「一次性图片评审不许写进项目上下文」的持久化问题，属于另一条在途分支
   （`fix/ephemeral-judge-persistence-20260905`）的活，不在剪辑面这一刀里。
   `golden-path.e2e.mjs`（每日门）本轮**已修到全绿**。

## ⑥ 门岗侧的加固（R28：防线建在最早能拦住的那层）

- `check:controls` 加**规则二：空 handler**。`onClick={() => undefined}` / `() => {}` / `() => null`
  一律红，且**不看 `disabled`**——「有时能点、点了永远不做事」的控件，`disabled` 也救不了它。
  按 R17 先做过阳性对照：带 `disabled` 与不带 `disabled` 两种写法都能让门岗报红，修完后归零。
  A2 那两颗按钮就是这条规则的由头。
- `ffmpegFiltergraph.test.ts` 钉死转场 blend 两路输入的 `format=gbrp`（D2 的根因防线）。
- `timelineShortcuts.test.ts` 钉死 ⇧⌫ / N / − ＋ 0 的新绑定，并断言 ⌘\ **不再**被时间轴接管。

## ⑦ 怎么复跑

```bash
pnpm run build
node tests/ux/editing-real-user-pass.walk.mjs   # 本条（零额度，约 3 分钟）
node tests/ux/editing-panel-system.walk.mjs     # 面板系统几何与四态
node tests/ux/agent-timeline-ops.walk.mjs       # 让 Nomi 改时间轴的闭环
node tests/ux/agent-runtime-editing.walk.mjs    # Agent 运行时证据链
```
