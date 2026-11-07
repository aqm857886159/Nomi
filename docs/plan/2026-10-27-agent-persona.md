# Agent 形象（设计卡）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：右下 Agent 小球换成形象（G · 去框：一块形加两只眼），聊天身份行换成它的静态脸
线/负责人：I-agent-persona（0.25 派出）；「长任务」一档跟 I-agent-closeout-a（Run 状态接进小球）
类别：[新界面]（用户每天看见的小球换脸、多两种长相；行为不变）
```

> 状态：**已拍板，0.25 再建**。本卡和拍板清单先入库，代码 0.25 再改。用户 2026-10-26 在方向 A–I 里选「去框的 G」，要了会动的小样并补了未读、长任务、不能干活、悬停；2026-10-27 拍板协调对过设计系统提的 7 处照默认改（原话「形象这 7 处照默认改，改完出实现清单，0.25 再建」，协调转述）。Claude Design 画布 https://claude.ai/artifact/WhWDGBd2cBgFG3wavibVKf（私有，只有仓库主人能开）第 15 版。
> 补还是换：**换**。小球和身份行里的 `NomiLogoMark` 换成新品牌组件 `NomiAgentFace`，这两处不留旧标；`NomiLogoMark` 组件本身照旧给别处用。
> 范围：`src/design/identity.tsx`（新组件）、`src/ui/app-shell/shell/AgentBallFace.tsx`、`ShellAgentHost.tsx`（只动 title 组句和眼睛跟随的监听）、`src/workbench/ai/NomiIdentityRow.tsx`、`src/theme/nomi-tokens.css` + `tailwind.config.ts` 的形变 token、`docs/design/nomi-design-system.md` §2.7 / §3.9、`src/workbench/ai/v4/agentPanelV4DockStatus.ts` 头注释（「五个词跟长相没有一一对应」那段要改）、设计实验室里画小球的状态屏、走查。
> 不做：App 图标、营销字标、全仓加载标 `NomiLoadingMark` 不换；小球行为（点开、拖动、右键、⌘J、不自己弹开）不改；不引入动画库或动画引擎；Run 状态接进小球（收尾 A）之前不出「长任务」这一档。

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能

### 拍板结论

| 题 | 结论 | 谁定的 |
|---|---|---|
| Q1 方向 | G 去框：一块形加两只眼，没有外圈 | 用户 10-26：「好，就按去框的 G 做会动的小样，带五态之间的过渡」 |
| Q2 补哪些长相 | 五个基本状态外补「有新消息」「长任务」「先连模型」三个变体，加悬停 | 用户 10-26：「把未读、长任务、不能干活、悬停这几处补进会动的小样」 |
| Q3 空闲 | 几乎不动：约 20 秒眨一下眼，不左右看 | 用户 10-27 照默认 |
| Q4 圆角 | 空闲时和 logo 同一比例（边长 25%），干活时变圆 | 同上 |
| Q5 形变 | 550ms、`cubic-bezier(.16,1,.3,1)`，设计系统 §2.7 新增「形变」一档，只给形象用；减弱动效直接切 | 同上 |
| Q6 长任务 | 只报「第几镜 / 共几镜」，不报预计时间 | 同上 |
| Q7 身份行 | 聊天身份行也换成形象的静态脸 | 同上 |
| Q8 尺寸 | 保持 44px（`BALL_SIZE`），胶囊 132px（`PILL_WIDTH`） | 同上 |
| Q9 跟鼠标 | 只在鼠标离小球约 160px 以内跟着看；减弱动效时不跟 | 同上 |
| Q10 边界 | App 图标、营销字标、加载标不换 | 画布共用规矩，用户选 G 时同屏 |
| Q11 时间 | 0.25 再建；五个基本状态和「有新消息」先做，「长任务」等收尾 A | 用户 10-27 |

### 九格

★0 先查别人：4 条先例，改了 2 个决定、确认了 3 个；画布调研画板和清单 `priorArt` 收同样的条目。证据：链接如下；`pnpm run check:board-parity`
- ① Office 助手回形针的来历（https://www.seattlemet.com/news-and-city-life/2022/08/origin-story-of-clippy-the-microsoft-office-assistant）· 被骂主要是因为不请自来地弹出打扰，不是长相；偏好研究里它反而最讨喜 · 确认了：形象只在原地变，「小球不会自己弹开」保留，新长相不加任何主动弹出。
- ② Susan Kare 谈 Mac 图标（https://qz.com/1666437/mac-icon-designer-susan-kare-explains-the-inspiration-for-her-designs）· 16×16 黑白像素里画开机笑脸，告诉用户「有事在发生」，把等待变友好 · 改了：最用力的是「在跑」「等你」两类（变圆转弧、长成胶囊）；44px 和 16px 各自单独画、单独看。
- ③ WALL·E 角色设计（https://en.wikipedia.org/wiki/WALL-E_(character)）· 没有嘴和鼻子，全靠一对眼睛演情绪，先当电器再加感情 · 确认了：只给眼睛不给嘴，「刚做完」的笑、「出错」的塌都由眼睛形状和身体姿态表达。
- ④ Duolingo 角色动画（https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life）· 用状态机实时混合动画，不逐个手做每种反应 · 改了：用 CSS 过渡在状态之间连续变形，时长进设计系统一档 token；不自写动画引擎，也不为这一处引入动画库。

★1 用户怎么用：当我收起 Agent 面板在画布上干活时，我想不打开面板就知道它在跑、在等我、做完了还是出错了，以便只在它需要我时才分心。证据：0.25 走查（见 ★9）
- ① 步骤：在 Agent 里说「把第 2 场拆成分镜」→ 收起面板回到画布 → 小球变圆转弧（在跑）→ 中途要花钱，长成「等你确认 2」胶囊 → 点小球打开面板逐项确认 → 收起，继续跑 → 轻跳眯眼（刚做完）→ 2.4 秒后挂上蓝点（有新消息）→ 点开看结果。
- ② 不做什么：小球不自己弹开、不抢焦点、不发声；不在小球上显示预计时间；不换 App 图标和加载标。
- ③ 已知坑：现在小球「在跑」只看回合（`useAgentPanelV4Data` 的 running），长的生成跑在 Run 里，收尾 A 之前小球看不见它，所以「长任务」先不出；英文胶囊更长，要按 `PILL_WIDTH` 核对；暗色身体按 token 实现后对比度要真机看。
- ④ 真实任务：T1 写一场分镜（短活：在跑 → 刚做完 → 有新消息）；T2 一段要花钱的生成中途停下等确认（胶囊）后再跑完；T3 新装、还没连文本模型，小球显示「先连一个模型」，点开去连。
- ⑤ 指标：主指标「小球进入『等你确认』到用户点开的中位时长」——未验证：缺量具（现有使用事件里没有小球状态与点开的配对，0.25 实现时确认，没有就记缺）；质量指标「八种样子在 44px 下互相分得开」——量具：走查逐态截图 + 人工眯眼对照；护栏指标「小球从不自己打开面板、空闲时没有持续动画帧」——量具：走查断言（只有点击 / ⌘J 打开面板）+ ★7 的性能场景。
- ⑥ brief：右下那个小东西就是 Nomi，它的样子告诉你它在干嘛。人设：新手（不知道右下是什么，悬停说明告诉他 ⌘J）/ 老手（不想被打扰，只扫一眼形状和颜色）。每步「预期 → 实际」记在走查报告的逐态截图对照里。

★1b 连带界面：悬停说明（title / aria-label）多两句新文案；设计实验室 v4 词表屏、流程屏（`src/devlab/designLab/v4/states/01-vocabulary.tsx`、`03-flow.tsx`）画小球的地方跟着换；身份行只在「还没连文本模型」恢复卡上；README / 官网截图里有旧小球的，0.25 发版换截图时一起换。证据：`git grep -n "AgentBallFace\|NomiIdentityRow" -- src`
- ① 新文案（zh / en 进 i18n）：「先连一个模型」/ 英文对应句；「生成视频 · 第 x/y 镜」/ 英文对应句。不写预计时间，不谈钱。
- ② 读屏：每个状态都有一句 aria-label，沿用现在 title 的组句（打开说明 · 状态 · 未读条数），长任务加镜头进度。

★2 谁说了算：形象是纯视图，只读不写、不存任何状态。证据：`node scripts/door-map.mjs AgentBallFace`
- ① 五个基本状态唯一 owner 是 `V4DockStatus`（`agentPanelV4DockStatus.ts` 的 `resolveDockStatus`，优先级：等你确认 > 失败 > 运行中 > 刚完成 > 空闲）；`done` 停 `V4_DOCK_DONE_HOLD_MS`（2400ms）。
- ② 有新消息 = `useResidentActivityStore` 的 `dockUnreadCount` 扣掉等你确认的条数（`ShellAgentHost` 现有算法）；先连模型 = `NomiStudioApp` 已有的 `useHasTextModel()`，与恢复卡同一个判定；长任务 = 收尾 A 接进来的 Run 状态，小球只读投影。
- ③ 眼睛跟随的鼠标位置只活在组件里（ref + CSS 变量），不进 store、不进 React 状态；同一份事实只存 1 份；不靠「东西不见了」猜意图。

★3 一致与复用：没有新依赖、没有第二份定义。证据：`pnpm run check:self-written`；`git grep -n "NomiLogoMark" -- src/ui/app-shell src/workbench/ai`
- ① 外形复用 logo mark 的底色 token `--nomi-logo-ground` 和圆角比例（§3.9.0）；颜色全用现有 token（accent、danger、warning-soft / -edge / -ink 及暗色值），未读点用外壳共用的 `DotMark`。
- ② `NomiAgentFace` 是这张脸唯一的定义，小球和身份行用同一个组件（身份行用静态用法），落在 `src/design/identity.tsx`，§3.9.1 改成七个品牌组件。
- ③ 动画用 CSS transition / keyframes；新 token 只有形变一档（`--nomi-duration-morph` 550ms、`--nomi-ease-morph`），其它过渡照旧 `--nomi-duration-fast`。

★4 全状态：八种样子各一句，全部在拍板清单 `AgentPersona` 里画出。证据：`docs/design/boards/2026-10-27-agent-persona/preview/AgentPersona.html`；`pnpm run check:i18n`
- ① 空闲：logo 形 + 两只眼，约 20 秒眨一下；在跑（加载）：变圆、accent 弧转圈、眼睛低头扫；等你确认：warning 胶囊带「等你确认 N」，右缘不动往左长；刚做完（成功）：轻跳、眯眼笑，2.4 秒；出错（失败）：歪 9°、眼睛塌成两条、右上 danger 点。
- ② 有新消息：空闲 + accent 点、眼睛往屏幕里看，挂到点开；长任务：底轨 + 按镜头数增长的弧、不转，眼睛半眯；先连模型（能力不可用）：同一个胶囊，字换成「先连一个模型」，下一步 = 点开面板，现有恢复卡给出去连模型的那一步。
- ③ 取消中：用户点停后，回合真正结束前仍是「在跑」，结束后落回空闲或有新消息；不另造「取消中」的长相，也不假装已经停了。部分成功 / 过期：不适用，小球只表达注意力状态，不表达单个任务的结果。
- ④ 减弱动效：所有过渡和动画关掉，状态直接切，「在跑」留一段静态弧；眼睛不跟鼠标。文案走 i18n，不谈钱。

5 中途表：形象只是状态的投影，打断由状态 owner 处理；小球自己不花钱、不存东西。证据：人工（0.25 走查）

| 状态 | 停 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 在跑 / 长任务 | 回合结束前照旧在跑，结束后空闲或有新消息 · 不扣 · 面板里 | 回合由主进程处理，重开后按真实状态画 · 照 Run 的规则 · 面板里 | 回合报错就是出错 · 照 Run 的规则 · 面板里 | 按重启后的真实状态画，不残留旧长相 · 不扣 · 面板里 | 只打开一次面板（现有 4px 判定） · 不扣 · 无 |
| 等你确认 / 先连模型 | 胶囊一直在，直到用户裁决 · 没确认的不花 · 面板里 | 同左 · 不花 · 面板里 | 同左 · 不花 · 面板里 | 待确认项照 owner 恢复后重画 · 不花 · 面板里 | 只打开一次面板 · 不花 · 无 |
| 空闲 / 刚做完 / 有新消息 / 出错 | 无变化 · 不扣 · 无 | 未读条数照 store 规则 · 不扣 · 无 | 无变化 · 不扣 · 无 | 按真实状态画 · 不扣 · 无 | 只打开一次面板 · 不扣 · 无 |

6 外部数据与失败：不适用：形象只读本机内部状态（回合、待确认、未读、文本模型、Run），不接任何外部数据。

★7 性能：证据：`pnpm run perf:scenarios -- --id agent-ball-eye-follow`（0.25 登记）
- ① 新增操作：鼠标在小球 160px 内移动（眼睛跟随）、状态之间形变、悬停冒说明。
- ② 最坏规模：画布 200 个节点、Agent 正在流式输出时，鼠标在小球附近持续移动。
- ③ 预算：眼睛跟随不触发 React 重渲染（rAF 合并后只写一个 CSS 变量），帧间隔 p95 ≤ 2 帧（33ms），交互期间 >50ms 长任务 0 个；空闲时没有持续动画帧（只有约 20 秒一次的眨眼）；形变只动 transform / 尺寸 / 圆角，不引起外壳重排。
- ④ 场景：新登记 `agent-ball-eye-follow`（照现有 `canvas-pan-while-agent-streaming` 的跑法加参数，不自写剖析器）；基线：未验证：实现前没有可量的东西，0.25 实现 PR 交数字，超预算不合并。

8 真实条件：全部 `unverified`，0.25 实现后逐项跑：Windows / 英文界面（胶囊更长）/ 最小窗口 / 暗色 / 减弱动效 / 键盘全程（Tab 到小球有焦点描边、回车打开、⌘J）/ 100% 缩放的普通屏上 44px 和 16px 是否清楚。

★9 验收与回滚：0.25 实现 PR 由另一条线独立验收（新界面类强制），验收线只核下面这份清单。证据：`## 独立验收` 一节；`pnpm run check:board-parity`
- ① 验收清单：拍板清单两块板的每个元素都是 implemented 且有走查断言（`board:AgentPersona/<元素>`、`board:AgentIdentityRow/<元素>`）；八种样子各一张真截图（浅色 / 暗色、中 / 英），和拍板拼页逐格对账；功能普查 A-1 到 A-12、I-1 到 I-2 逐行写「在新位置可用（走查名）」；`perf-scenario` 交数字。
- ② 反例（这一类会从哪回来）：小球自己打开了面板；眼睛跟随引起整个外壳重渲染（React Profiler 看提交次数）；减弱动效下还在动；拖动不到 4px 没算点击，或拖完被当成点击；右键菜单、⌘J 失效；胶囊没往左长、把右缘推出屏幕；英文胶囊字被截；暗色身体写死 hex 不走 token；`data-agent-ball` / `-dock-status` / `-dock-count` / `-dock-unread` / `-ball-progress` 少了一个（走查会全瞎）；面板开着时刚做完却挂上了未读点；出错时读屏不读；身份行的脸在动；`NomiLoadingMark` 或 App 图标被顺手换了。
- ③ 开工第一步：独立只读线按代码复核两块板的功能普查（现有功能全表，带代码出处），漏的先补进清单再动手。
- ④ 回滚：revert 0.25 的实现 PR（一个合并提交）；没有数据迁移，没有开关。

拍板图清单：`docs/design/boards/2026-10-27-agent-persona/AgentPersona.board.json`（小球，15 个元素）、`AgentIdentityRow.board.json`（身份行，3 个元素）；证据：`pnpm run check:board-parity`
