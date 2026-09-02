# Agent UI 功能一致性测试规格（功能层合同）

> 日期：2026-09-02 · 状态：随定稿走读文档（`2026-09-02-agent-ui-v3-walkthrough.md` @4fe8f1cb）生效
>
> **这是验收系统的第二层**。同一套 Agent UI 验收系统分两层：
> - **设计层**：`docs/design/2026-09-02-agent-ui-conformance-testspec.md`（并行班产出）——管「长得对不对」（DOM/视觉/交互）；
> - **功能层（本文件）**——管「背后是不是真的」：每个 UI 元素的行为承诺怎么被测试系统证明。
>
> **勾账制**：实施 PR 的 body 必须逐条引用本文合同编号（F-xx）打勾并附证据命令输出；没勾完的合同 = 该片未完成。两层各自勾账，互不抵扣。
>
> **代码事实基线**：Agent Host 代码不在本分支工作树（#223 带闸入库，`agentHostEnabled` 默认 false）；本文所有代码引用钉在 `pr223-finish@46066ed0`（`origin/codex/project-agent-host-phase1-20260827`）。实施落在别的 ref 时以实码为准、同 commit 更新本文引用。
>
> **本文防的五类前科**（每条合同至少压住一类）：
> ①装饰性 UI（元素在、功能无——`deviated` 恒 false 是本科）②投影撒谎（UI 所示 ≠ 账本事实）③断言假绿（expectAbsent 采样早/死选择器/harness catch 洗白）④档位不生效（设置切了、行为没变）⑤数字漂移（金额/用量与计价、计量脱钩）。

---

## 0. 事实源与读法（投影断言的地基）

投影一致层（下文各合同的 (b)）全部按「三点一线」写：**从事实源读事实 → 从真实 DOM 读所示 → 同一比较器深比对**。事实与所示不许在测试里各自换算后再比（换算函数本身要被测）。

| 事实域 | 唯一事实源（读法） | 禁止的替代读法 |
|---|---|---|
| 对话账本（Thread/Turn/Item/Checkpoint） | Host snapshot + patch 流：`nomi:projectAgent:snapshot` / `nomi:projectAgent:patch` / `nomi:projectAgent:event`（`projectAgentIpc.ts:38-47`），走查里经 preload bridge 取（`app.evaluate` 内不可 `require`/动态 `import`，见 docs/qa 走查记录） | 从 renderer store 读（那已是投影）；从 UI 文案反解析 |
| 执行状态（Operation/Attempt/queue/receipt） | execution coordinator 状态 + proposal receipt store 读通道 `nomi:projectAgent:proposalReceipt:read`（`projectAgentIpc.ts:42`） | 模型侧自述；UI 侧计数 |
| 生成 run / artifact | `ProductionRun` domain（`productionRunState.ts`、`artifactProjection.ts`）；MCP 侧 `nomi_get_run` 必读 `structuredContent.nomiRunData`，**text 是人话不是 JSON**（已烧过一轮额度的坑） | 解析 text 字段；解析 UI 卡片 |
| 金额 | `deriveShotPrice`（`electron/productionRun/shotPricing.ts:92`）+ `catalogPricingResolver.ts` | UI 层第二套算价；测试里手写期望价 |
| 画布节点/边 | Canvas Zustand store（capability adapter 唯一写入口，owner map） | 从 DOM 数节点 |
| UI 所示 | Playwright 真窗口 DOM（`tests/ux/_assert.mjs` 断言族 + `_agentProbe.mjs`），vite build 后的真实 renderer——**验证物=用户所见物**，不是 storybook/隔离组件 | 截图 OCR；源码里读 props |

**比较器纪律**：每个合同一个具名比较函数（如 `assertToolRowMatchesLedger(snapshot, dom)`），单测和走查复用同一个；比较器自己有阳性对照测试（见 §4）。

---

## 1. 逐元素功能合同表

列说明：**承诺** = 从走读文档「这是什么/什么时候碰」+ Host 架构推导出的一句行为合同；**(a) 契约层** = coordinator/policy/budget 级测试（真状态机、零 mock 外部 effect 之外的东西）；**(b) 投影层** = UI 所示 === 账本事实；**(c) 走查层** = 真实任务里走到它的步骤（R13 手法，截图人眼判断）。

### 屏 A · 主对话流

| # | 元素 | 承诺 | (a) 契约层 | (b) 投影层 | (c) 走查层 |
|---|---|---|---|---|---|
| F-A1 | 头部：用量胶囊「还能聊 ~40 轮」 | 余量估算与 hover 明细（本轮/累计/花费）来自真实计量累计，不是 UI 猜数 | usage 累计需要 Host 侧 owner（**今缺，NRL-2**）：每 turn 结束累加 token/花费；重启后累计不清零 | 胶囊数字 === usage 账本折算；hover 三项 === 账本三字段；金额 === 计价事实汇总 | 长对话任务中途 hover 截图，与 `nomi_get_run`/账本导出并排对账 |
| F-A2 | 「前面 24 轮已折叠 · 展开」 | 折叠数 === compaction 事实；展开 = replay 原文不是摘要重写；折叠不丢 receipt/关键 ID（R-M-3 教训 3） | compaction item 落账本（`projectAgentCompactReplay.ts`）；折叠前后 receipt/ID 集合相等的类级测试 | 「24」=== checkpoint 边界外的 turn 数（**今无此投影字段，NRL-7**）；展开后条目与账本原 items 同序同值 | 聊到触发折叠，点展开，比对最早一条消息原文 |
| F-A3 | 「进入 · 生产段」工序线 | 阶段推进由 handoff 事实驱动（contextRevision 递增），不是 UI 自行判断；推进后旧摘要被复查（R-M-3 教训 2，RC-04） | handoff 校验 ID/hash/budget 后才递增 contextRevision；不满足则不推进 | 工序线出现位置 === handoff item 在账本中的位置；阶段名 === handoff 记录的阶段 | 从聊剧本推进到生成，确认线出现在正确轮次之间 |
| F-A5 | 「⚙ 载入 编剧·Kasdan」灰字行 | 行出现 ⟺ 账本有 skill load item；载入的技能**真的进了后续上下文**；hash/visibility 校验失败必须显示失败而非已载入（tool #41 `load_skill`：只读、hash 校验、不授予 capability） | load_skill 成功/hash 不匹配/不可见三分支各有测试；载入后下一 turn 的出站上下文含技能内容（**防档位不生效变体：说载了没用上**） | 灰字行技能名 === 账本 item 的 skillRef；失败时无成功行 | 让 Nomi 按某技能写作，检查产出确实带技能方法特征 |
| F-A6 | 「想了 4 秒」思考小结 | 时长与展开内容来自账本 reasoning item（当时的思路原文），不是重新生成 | reasoning item 一次 terminal（owner map：每 item 一次 terminal）；时长 = item 起止差 | 「4 秒」=== item 时长；展开文本 === item 内容逐字 | 展开一条思考，重启 app 再展开，内容一字不差 |
| F-A8 | 「6 步 · … ▾」工具总览行 | 「6 步」计数与展开的每步名称/耗时/结果 === 账本 tool items 序列，同序同值；✓/✗ === item terminal 状态 | 每个 tool item 恰一次 terminal；乱序/截断 fail closed（owner map）；RL2 的 canvasRead 读路径闭合是前置 | **本文最核心投影断言**：展开明细列表 deep-equal 账本该 turn 的 tool items 投影（数量、顺序、名称、状态、耗时） | 让 Nomi 干一轮多工具活，点开总览逐行对 `nomi_get_run`/snapshot |
| F-A9 | 「✓ 已加 5 个节点」+ ↩ | 绿回执 ⟺ proposal receipt 已 applied 且画布真多 5 节点；↩ = 整批原子撤销、幂等；撤销后节点数回原值且 receipt 有 transition 记录 | receipt 状态机测试（applied→undone）；重复撤销无第二次 effect（重复 receipt 不重复 effect，owner map）；撤销可重启恢复 | 「5」=== receipt 的 operation 数 === canvas store 增量；撤销后三者同时归零 | 生成 5 节点→点 ↩→画布肉眼回原样→Cmd+Z 栈无残留 |
| F-A10 | 黄色撤销确认卡 | **只在**批内有用户手改时出现；列明的丢失项 === 真实手改 diff；「仍要撤销」连手改一起退，「再想想」零 effect | 需要「agent 写入后被用户改过」的脏跟踪事实（**今缺，NRL-8**）；无手改时撤销不弹卡直接执行 | 卡上列的改动（「暖光→冷调」式）=== store 里该字段的 agent 版 vs 当前版 diff | 手改一镜提示词→撤销→卡出现且列出该改动；不改→撤销→卡不出现（expectAbsent，采样时机见 §4） |
| F-A11 | 「2 张参考图在「参考」分类 · 去看」 | 数量与分类 === asset store 事实；点击跳转目标真实存在且选中它们 | 产物落库路径测试：artifact → asset 分类归位 | 「2」「参考」=== asset store 查询结果；跳转后选中集 === 这 2 张 | 生成参考图后点「去看」，人眼确认落点 |
| F-A12 | 「正在重画第 4 镜 0:12 ▾」进行中行 | 同一行原地经历 排队→进行中→完成（稳定寻址 threadId+seq+itemId，R-M-3 教训 1 / RC-05：多产物不坍缩成一段文本）；计时 === attempt 起始时间；无百分比事实就无进度条 | attempt 状态机：queued→running→terminal 各转换一次；`done/failed/cancelled/unknown` 分类，unknown 进 reconcile 不装完成 | 行的 itemId 在三态间不变（DOM 稳定性断言）；耗时 === now - attempt.startedAt（容差 ±2s）；进度条 expectAbsent | 发起一次真生成，盯这一行从头到尾不刷新成多行 |
| F-A13 | 输入框上沿排队行 | 忙时发的消息入 Host 队列（`queue-upserted`，`projectAgentState.ts:463`）；× = 队列项删除；轮到自动进对话执行；重启后队列仍在 | 队列 reducer 测试：入队/撤回/**自动晋升**（今无晋升路径，**NRL-5**）；队列项持久化 replay | 排队行数与文案 === Host 队列 items；× 后队列与 UI 同时少一条 | Nomi 干活时连发两条，看第一条自动开跑、第二条可 × 掉；重启后队列还在 |
| F-A14 | @ 引用（含变旧变黄） | 选择器数据源 = 真实素材/角色/技能列表；色块 = 声明式引用（AssetReference/slot 体系已拍板，不重造）；黄色 ⟺ 引用后素材 revision 变过；发送用当前版 | 引用带 revision/hash（owner map M1 验收）；stale 判定 = hash 比对（**今无比对器：46066ed0 的 stale 全是 lease/epoch 语义，NRL-6**） | 色块黄/蓝 === hash 比对结果；出站消息里引用解析到的 revision === 素材当前 revision | @一张图→在画布改它→色块变黄→发送→Nomi 拿到的是新版（从工具入参证据看） |
| F-A15 | 底排 ⚡ 档位 + 🤖 模型（红点） | ⚡ 切档写进 Host 且**下一动作立即按新档执行**；🤖 红点 ⟺ 文本模型未配置（`AgentChatErrorCode = 'text_model_credential_locked'`，`agentChatContracts.ts:26`）；选模型后下一轮真用所选模型 | 档位持久化 + 生效测试 = §2 矩阵全套（**workMode 存而不管是今态，NRL-1**）；模型未配时发消息走 credential_locked 错误分支而非静默降级 | 悬停文案的档位/模型名 === Host turn 的 approvalPolicy/workMode/model 字段；红点出现 ⟺ credential 缺失事实 | 切「步步问」后让它建节点必停；换模型后从请求证据（账本 turn 记录）确认 model id 变了 |

（F-A4 用户气泡、F-A7 正文流式为纯渲染，功能合同并入设计层与 F-A8 的账本序对账，不单列。）

### 屏 B · 决定卡六张

| # | 元素 | 承诺 | (a) 契约层 | (b) 投影层 | (c) 走查层 |
|---|---|---|---|---|---|
| F-B1 | 计划卡 | 卡上药丸/勾选/行内容 === plan 草稿事实；「生成已选 (N)」的 N 跟勾选联动；「已改·还原」= 行级 patch 且还原真还原；**提交的 plan === 所见的 plan**（防反向投影撒谎：UI 改了、提交旧版） | `generation_plan(create/patch/preview)` 链测试（R-M-2 首刀纵切）；patch 后 preview === patch 后事实 | 确认瞬间抓出站 plan payload，deep-equal 卡面所示（勾选集、模型、画幅、每行提示词） | 勾 2/5、改一行、还原一行、确认；对生成结果数量 |
| F-B2 | 付费确认卡 | 单价/合计 === `deriveShotPrice` 输出（**单源，NRL-3**）；确认按钮金额 === 合计；冻结项清单 === 付费后真不可改的字段集（镜头数/模型/时长/清晰度冻结、提示词可改）；确认 → Host-only `nomi_start_generation`（模型面无此工具，tool-mapping #46/47 host-only）；取消 = 零 effect 零扣费；**trigger=agent 时无「本会话不再提示」勾选框，trigger=手动点生成时才有**（v3 裁决的可测化） | RL1 编排闭合是前置（budget-approval 后 shot gates 必须开，18 测）；付费后改冻结字段被拒、改提示词成功的双向测试；模型伪造 start 被拒 | 卡上每行价 === deriveShotPrice(该行输入)；合计 === Σ；按钮金额 === 合计（三处一源）；勾选框 presence 按 trigger 分支断言 | 真花费走查（APIMart，默认授权）：确认→扣费额 === 卡示金额；取消→余额不动 |
| F-B3 | 有出入卡 | **deviated 置真通路存在**（RL3 本科）；出入明细 === 计划 vs 结果的对账差异；三动作真通路：让 AI 修（新 turn 携差异）/撤销这一步（走 F-A9 receipt）/知道了（ack 持久化，重启不再弹）；一切正常永不出现 | RL3 绿断言：reducer/ledger 唯一 owner 置真、重启恢复、两个同类入口都能置真；ack 持久化测试 | 卡出现 ⟺ 账本 item.deviated === true；明细条数 === 差异记录数 | 注入一次偏差（阳性对照，§4）看卡出现；正常跑一次断言 expectAbsent |
| F-B4 | 反问卡 | 一次一问、1/2/3 键盘、可跳过；**答案写回上下文且真的改变后续行为**；进度「1 / 2」=== 剩余问题事实 | 46066ed0 **无 question/elicitation item 语义**（grep 为空，**NRL-9**）：实施须先落 item kind + 状态机（asked→answered/skipped 各一次 terminal） | 卡上问题/选项 === 账本 question item；「1 / 2」=== 未答计数 | 给歧义指令→答第 1 问→后续产出体现该答案；跳过第 2 问→Nomi 按默认走 |
| F-B5 | 多候选卡 | 采用前候选**零画布写入**；「采用 A」→ 只 A 入画布；每候选独立可寻址（threadId+seq+itemId，RC-05 不坍缩） | 候选生成→采用→画布写入的链路测试；未采用候选的清理不影响已采用 | 候选数 === run artifacts 数；采用后画布新增 === A 的 artifactId | 一次要 3 版，采用 B，画布里只有 B；采用前画布节点数断言不变（expectAbsent 姿势，§4） |
| F-B6 | 产物卡 | 「第 2 版」=== artifact version 事实（版本化不覆盖，`artifactProjection.ts:13-35,203-255`）；✏ 改提示词 → revise 出新版不覆盖旧；⟳ 重生成 → 新 attempt；去画布 → materialize（host-only #40） | artifact 版本链测试：revise 后旧版仍可读；preview token 绑定 project/run/artifact（owner map） | 卡标题版本号/尺寸 === artifact metadata；缩略图 === preview ref 指向的内容 | 改提示词重生成一次，卡变「第 3 版」，旧版可回看 |
| F-B7 | 失败卡 | 红边原因 === run 失败分类事实（`failed`，且 **unknown 不许装 failed**——unknown 走 reconcile）；「这次没扣钱」=== 计费事实（**今无 no-charge 事实源，NRL-4**）；换模型重试真的换了模型 | 失败分类四态测试；failed-but-charged 场景必须显示不同文案（不许把「没扣钱」写死在文案里） | 卡文案分支 === settlement 记录（charged/not-charged）；重试请求的 model 字段 === 新选模型 | 用坏配置真跑一次失败，比对余额没动；再看 unknown 场景显示「核对中」而非失败 |

### 屏 C · 右栏换班（过渡态）

| # | 元素 | 承诺 | (a) 契约层 | (b) 投影层 | (c) 走查层 |
|---|---|---|---|---|---|
| F-C1 | 节点浮条「拆解结果 · 5 镜」+ 蓝标 | 浮条/蓝标计数 === 该视频拆解事实；点浮条回表、表 === 画布节点投影（拆解表=节点的表格表示，不是第二份事实） | 拆解结果落节点的归属测试（跨项目 binding 拒绝，owner map） | 「5 镜」=== 拆解记录镜数 === 表行数，三处一源 | 拆完切走再点浮条回来，勾选还在 |
| F-C2 | 顶栏角标「● 进行中」+ 蓝点 | 角标状态 === execution 真实状态；蓝点 ⟺ 收起期间账本**有新 item**（不是 UI 猜）；收起期间任务照跑（Host 拥有状态，renderer 只消费；remount 只 replay 一次） | 收起/重开 remount 的 replay-once 测试（重复 replay = 双份消息，owner map 验收） | 蓝点出现 ⟺ 收起时间戳之后账本新 item 数 > 0；点开后蓝点清除且已读位点持久化 | 收起 Nomi→让它跑长活→蓝点亮→点开消息一条不多不少 |
| F-C3 | 换班状态保持 | 「收起只是收起」：勾选/滚动位/进行中任务在换班往返后原样；同一时刻右栏只住一个（互斥） | 互斥状态机测试；执行状态不因 UI 卸载中断（走 F-C2 同底座） | 换班往返后勾选集 === 换班前快照 | 勾一半→换班→换回→逐项肉眼对 |

### 屏 D · 终局（固定细条 + 对话）

| # | 元素 | 承诺 | (a) 契约层 | (b) 投影层 | (c) 走查层 |
|---|---|---|---|---|---|
| F-D1 | 头部 | 同 F-A1 | 同 | 同 | 同 |
| F-D2 | 📌 细条「拆解结果 · 5 镜 · 已选 2 ▾」 | 细条两个数**常驻实时**（勾选变→数字变）；展开表 = 同一份拆解事实；「这镜没读出来」红字 === per-shot 失败事实、可单独重试；「加入画布 (2)」的 2 === 勾选集；收起不清状态 | per-shot 失败分类 + 单镜重试测试；勾选状态持久化 | 「5 镜/已选 2」=== 拆解事实 + 勾选事实；展开每行（缩略图/时间/描述/字幕）=== 拆解记录字段 | 勾一镜看细条数字跳；重试失败镜；加入画布后画布多 2 节点 |
| F-D3 | 三入口同源 | 节点浮条 / 对话工具行 / 固定细条指向**同一份**拆解事实——任一处操作，三处同步 | 单一事实源测试：不存在第二份表状态 | 三入口读数在勾选后同帧一致 | 从对话工具行点开改勾选，回细条看数字已变 |
| F-D4 | 输入框 | 同 F-A14/F-A15（🤖 已选态：无红点，悬停显模型名） | 同 | 同 | 同 |

**合同数**：屏 A 13 + 屏 B 7 + 屏 C 3 + 屏 D 4 = **27 条**，每条三层 = 81 个验证面。

---

## 2. 权限档位 × 行为矩阵

两根轴（词表对齐 `nomi-agent-interaction.md` §14 + R-M-4，不另造）：
- **工作方式**：只回答（ask）/ 只改选中（edit-selected）/ 全能动（agent）——管**能动什么**；
- **批准策略**：步步问（`step`）/ 安全自动（`safe-auto`）/ 全放行（`project`）——管**问多少**（代码字面量：`PROJECT_AGENT_APPROVAL_MODES = ["step","safe-auto","project"]`，`shared/projectAgentContracts.ts:43`）。

> ⚠️ 词表缺口（NRL-1）：46066ed0 的 `PROJECT_AGENT_WORK_MODES = ["ask","guided","balanced","auto"]`（`:26`，默认 `balanced`）**没有「只改选中」的表示**，且 `projectAgentExecutionPolicy.ts` 完全不消费 workMode。矩阵按定稿词表写，实施第一片必须先把词表咬合、给 workMode 一个执行层 owner。样张演示态是「Agent · 安全自动」；**默认档位是产品定稿项，功能层只测「所示档位 === 生效档位」，不钦定默认**。

五个动作类，每格三种裁决：**弹**（必须出确认卡）/ **不弹**（必须静默执行 + 落回执）/ **拒**（动作本身被 policy 拒绝，无 effect 无卡）。

**只回答（ask）行——批准策略不能扩大工作方式（两轴不串）：三档全同**

| 动作类 | 步步问 | 安全自动 | 全放行 |
|---|---|---|---|
| ① 只读（读/搜） | 不弹 | 不弹 | 不弹 |
| ② 可撤销写入（草稿/画布节点） | **拒** | **拒** | **拒** |
| ③ 付费生成 · 预算内 | **拒** | **拒** | **拒** |
| ④ 付费生成 · 超预算 | **拒** | **拒** | **拒** |
| ⑤ 硬闸（发布/删除/账号/验证码/外部写入） | **拒** | **拒** | **拒** |

**只改选中（edit-selected）行——超出选中范围的写入一律拒，范围内按批准策略**

| 动作类 | 步步问 | 安全自动 | 全放行 |
|---|---|---|---|
| ① 只读 | 不弹 | 不弹 | 不弹 |
| ② 范围内可撤销写入 | **弹** | 不弹（落回执） | 不弹（落回执） |
| ②′ 范围外写入 | **拒** | **拒** | **拒** |
| ③ 付费生成 · 预算内（仅作用于选中） | **弹** | **弹** | 不弹（Host 预授权回执） |
| ④ 付费生成 · 超预算 | **弹** | **弹** | **弹** |
| ⑤ 硬闸 | **弹** | **弹** | **弹** |

**全能动（agent）行**

| 动作类 | 步步问 | 安全自动 | 全放行 |
|---|---|---|---|
| ① 只读 | 不弹 | 不弹 | 不弹 |
| ② 可撤销写入 | **弹** | 不弹（落回执） | 不弹（落回执） |
| ③ 付费生成 · 预算内 | **弹** | **弹**（每次，且卡上**无**「本会话不再提示」勾选） | 不弹（**Host policy 预授权**放行，账本落 pre-auth 回执，非伪造用户批准——R-M-4 规则 1） |
| ④ 付费生成 · 超预算 | **弹** | **弹** | **弹**（预算护栏正交，任何档不可关——R-M-4 规则 4） |
| ⑤ 硬闸 | **弹/拒**（发布删除弹，账号验证码拒） | 同左 | 同左 |

> ③ 列的裁决对账：走读 B2「Nomi 自动干活时花钱每次都得问」描述的是**安全自动档**（样张演示态）+「不再提示」勾选只在用户亲手点生成时存在；R-M-4 的「全自动档端到端含生成过闸」是**全放行档**的 Host 预授权。两者不矛盾，分别落在 ③ 列的 safe-auto 格与 project 格。若产品最终裁决「agent 花钱任何档都弹」，改的是 project 格一格 + R-M-4 注记，矩阵结构不动。

**矩阵不变量（三条独立测试，任何格变更都不得破坏）**：
- **INV-1 两轴不串（方式→策略）**：切工作方式不改变批准策略字段值（ask→agent 后 approvalPolicy 不变）；
- **INV-2 两轴不串（策略→范围）**：切批准策略不扩大可写范围（project 档在 edit-selected 下仍拒范围外写入）；
- **INV-3 预算正交**：④ 行 9 格全弹，遍历所有组合的参数化测试，一格不弹即红。

**测试系统落法**：一个参数化矩阵扫描器 `projectAgentPolicyMatrix.test.ts`——共 **54 项**：表格 48 格（ask 行 15 + edit-selected 行 18 + agent 行 15）+ 不变量 3（INV-1..3）+ 付费卡「不再提示」勾选框 presence 分支 3（trigger=agent 三档皆无）。每格断言三件事：卡出现与否、effect 发生与否、回执/拒绝记录落账与否。**任何一格没有断言 = 扫描器结构性失败**（用 `PROJECT_AGENT_WORK_MODES × PROJECT_AGENT_APPROVAL_MODES` 枚举驱动，新增档位自动出现空格并报红）。

---

## 3. 红灯衔接

### 已有红灯覆盖（`docs/qa/2026-09-01-agent-m0-red-lights.md`，编号按表序 RL1-RL3）

| 红灯 | 覆盖本文哪些合同 |
|---|---|
| RL1 ProductionRun 门编排（budget-approval → shot-gates-never-open，18 测） | F-B2 付费闸时序底座；矩阵 ③/④ 列的门编排前置 |
| RL2 canvasRead snapshot 挂起 | F-A8/F-D3 的画布事实读路径（读挂了一切投影断言无从谈起） |
| RL3 `deviated` 恒 false（9 处硬编码，contracts `:256/267` 钉死字面量 false） | F-B3 有出入卡整条（装饰性 UI 本科案）|

R-M-1 附的 I-3（written-not-wired）教训收进 §4 假绿防御第 5 条。R-M-2 的 M2 generation 纵切是 F-B1/F-B2 契约层的实施载体（先红后绿在该切片 PR 里勾账）。

### 新增红灯（NRL，先红后绿；红证命令今日在 `/Users/aoqimin/Desktop/Nomi-design-r2` 实跑过，输出为空即红）

| # | 红灯 | 红证命令（当前红状态） | 绿断言 |
|---|---|---|---|
| NRL-1 | workMode 存而不管 + 词表不咬合（档位不生效族） | `git grep -n "workMode" 46066ed0 -- electron/projectAgentHost/projectAgentExecutionPolicy.ts` → 空（policy 不消费）；`git grep -n "PROJECT_AGENT_WORK_MODES" 46066ed0 -- electron/shared/projectAgentContracts.ts` → `["ask","guided","balanced","auto"]` 无「只改选中」 | §2 矩阵扫描器 54 格全绿；ask 行写工具被拒的类级测试；词表与定稿三值咬合 |
| NRL-2 | 用量胶囊无事实源（数字漂移族） | `git grep -ln "tokenUsage\|usageTotals\|contextWindow" 46066ed0 -- electron/projectAgentHost/` → 空 | usage 有唯一 Host owner；F-A1 (b) 三点一线断言绿；重启累计不清零 |
| NRL-3 | 付费卡金额无单源通路（数字漂移族） | 样张金额为硬编码演示值（¥1.26）；Agent UI → `deriveShotPrice`（`shotPricing.ts:92`）无调用通路（UI 未实施，缺失即红） | F-B2 (b)：行价/合计/按钮金额三处一源；阳性对照改价目表断言卡变 |
| NRL-4 | 失败卡「这次没扣钱」无计费事实（装饰性 UI 族） | `git grep -ln "refund\|noCharge\|charged" 46066ed0 -- electron/projectAgentHost/ electron/productionRun/` → 空 | no-charge 文案由 settlement 事实驱动；failed-but-charged 显示不同文案的分支测试 |
| NRL-5 | 队列自动晋升无 owner（装饰性 UI 族） | `git grep -n "promote\|dequeue" 46066ed0 -- electron/projectAgentHost/projectAgentQueueMutationReduction.ts` → 空 | turn 结束→队首自动开跑的 reducer 测试；F-A13 (c) 走查绿 |
| NRL-6 | @ 引用变旧无比对器（投影撒谎族） | `git grep -n "stale" 46066ed0 -- electron/projectAgentHost/projectAgentApprovalHelpers.ts` → 仅 `capability_target_stale`（lease/epoch 语义），无 composer 引用 revision/hash 比对 | 黄色态 === hash 比对结果；发送解析到当前 revision 的契约测试 |
| NRL-7 | 折叠计数无投影字段（投影撒谎族） | `git grep -n "foldedCount\|compactedTurns\|compactionCount" 46066ed0 -- electron/` → 空 | F-A2 (b)：「24」=== checkpoint 边界事实；展开 replay 逐字相等 |
| NRL-8 | 批内手改无脏跟踪（撤销黄卡无从判断） | `git grep -ln "manuallyEdited\|userModified\|batchUndo" 46066ed0 -- electron/ src/` → 空 | F-A10：有手改弹卡列明 diff、无手改不弹的双向测试 |
| NRL-9 | 反问卡无 item 语义（装饰性 UI 族） | `git grep -ln "elicit\|clarif\|question" 46066ed0 -- electron/projectAgentHost/` → 空 | question item kind + asked→answered/skipped 状态机；F-B4 (b) 绿 |

红灯纪律与 m0-red-lights 相同：失败分类是「缺事实 owner/缺执行通路」，不是改文案或 mock 一个假事实源把断言哄绿；每条 NRL 转绿时把本表红证替换为带 commit/命令/绿输出的记录。

---

## 4. 假绿防御（每条断言的资格线）

1. **阳性对照强制**：每条投影断言（各合同 (b)）必须带一个孪生对照测试——故意把事实侧或投影侧改错一位（如账本多注入一个 tool item / 篡改卡面金额），断言必须报红。**没有阳性对照的投影断言不算数**（前科：没有阳性对照的绿灯白等一轮）。落法：`*.conformance.test.ts` 旁必有 `*.positive-control.test.ts`，实施期可加 check 脚本棘轮。
2. **expectAbsent 采样时机全注明**：本文用到 expectAbsent 的合同（F-B3 出入卡不出现、F-B5 采用前零写入、F-A10 无手改不弹卡、F-A12 无进度条）一律「**先证前置态，再断不存在**」：先断言触发链已走完（如 run 已 terminal、撤销已执行完）再采样；计数本来就是 0 时首采即过 = 无效断言（前科在案）。单例 Modal 要等动画结束帧再断。
3. **死选择器双向排查**：每个锚点（data-testid）grep 全部用法；断言前先探针证明锚点在真实 DOM 里存在过（probe-first，防「报红那处逼你看、假绿那处骗很久」）。
4. **harness catch 不洗白**：走查脚本报失败时必须区分「断言红」与「harness 自己抛异常被 catch 兜住」；catch 分支一律 rethrow 加标记，不得折算成业务结论。
5. **written ≠ wired（I-3 教训）**：每条新测试文件必须出现在 CI 的执行清单里并有一次真实失败记录（阳性对照即可充当）；只写不接线的测试在勾账时按未完成计。
6. **现场自证**：断言前先证明处于所声称的状态（档位真是 X、trigger 真是 agent 而非手动）——注入的 meta 会被归一、后写的会盖前写的（前科在案）。
7. **验证物=用户所见物**：投影层与走查层都跑 vite build 后的真窗口；MCP/主进程侧改动必须重打包才可见（前科在案）。

---

## 5. 分级与落位

| 级 | 内容 | 落位 |
|---|---|---|
| **P0（实施第一片必须绿，缺一不得进第二片）** | RL1/RL2/RL3 闭合；NRL-1（矩阵扫描器骨架 + ask 行 + INV-1..3，54 格中至少 ask 行与 ④ 行全格）；NRL-3（金额单源）；F-B2 付费卡全合同；F-B3 出入卡阳性通路；F-A8 工具行账本对账（核心投影断言）；投影地基（snapshot/patch replay-once） | CI（vitest 契约层 + 无头走查投影层）|
| **P1（终局态验收前必须绿）** | 矩阵剩余格；NRL-2/4/5/6/7/8/9；F-A1/A2/A9/A10/A12/A13/A14/A15；F-B1/B4/B5/B6/B7；F-D2/D3 | CI 为主；F-D2/A9 配真机手跑走查 |
| **P2（体验完成线，R16 收口）** | 屏 C 全部（过渡态，终局落地即作废）；F-A3/A5/A6/A11；悬停提示/红点/动效的功能面；真实任务 J 线端到端（带情绪摩擦日志） | 真机手跑（Playwright 截图 + 人眼）|
| **真花费（默认授权，事后报数）** | F-B2 确认→扣费额对账、取消→余额不动；F-B7 失败→没扣钱对账；每次实施片收口跑一遍 | 真机 + APIMart（kie 余额为负不可用，在案）|

CI 归属：契约层进 `pnpm run test`（vitest）；投影层进走查断言基线（`tests/ux/_assert.mjs` 体系 + `check:walkthroughs` 门岗——注意该门岗是静态检查不执行走查，执行证据以截图 mtime 与断言输出为准，前科在案）；矩阵扫描器与阳性对照孪生进 gates 链后不得再出。

---

## 6. 与设计层的边界备忘

- 设计层断「细条高度一行、展开封顶半屏」；功能层断「细条数字 === 事实、收起不清状态」。同一元素两层各勾各账。
- 定稿走读文档若再改版（v3.2+），两层 spec 同 commit 跟改；合同编号只增不改义（作废标 deprecated，不复用编号）。
- 实施 PR 勾账格式：`- [x] F-B2(a) 证据：<命令+关键输出行>`，红灯转绿另附 NRL 表更新。
