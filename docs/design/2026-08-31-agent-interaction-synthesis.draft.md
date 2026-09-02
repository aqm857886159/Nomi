# Nomi Agent 交互对齐 epic — 设计素材汇编

> 用途：给「对着 #194 规范做交互对齐、画样张」的下一位 agent 读。只读汇编，未改仓库。
> 采编日期：2026-08-31。仓库：`/Users/aoqimin/Desktop/Nomi`。
> 背景：PR #223 的 Agent Dock 带**默认关闭的闸**即将合入 main；随后对着 #194 规范做交互对齐，已知 12 条不一致。
>
> **重要事实校正（先说，因为会误导后续所有取证）**：本机 `main` (`ae158ee2`) **落后于 `origin/main` (`b02fd3db`)**。`#194` 的规范文件 `docs/design/nomi-agent-interaction.md` 在本地工作树里**不存在**，但在 `origin/main` 里**存在且完整**（PR #194 merge `bd70c3ed` 已进 main）。本汇编所有 #194 引用都取自 `git show origin/main:...`，不是本地树。画样张的 agent 请务必 `git fetch` 后用 `origin/main` 版本，别在过期本地树上 grep（这正是 memory 里「main-repo-sits-on-stale-conflicted-branch」的坑，本次又踩到）。
>
> 关键文件（全绝对路径）：
> - #194 规范本体：`origin/main:docs/design/nomi-agent-interaction.md`（638 行）
> - #194 实现合同：`origin/main:docs/design/nomi-agent-interaction-implementation-contract.md`（200 行，网页/桌面端几何合同）
> - #194 样张：`origin/main:docs/design/mockups/2026-08-27-agent-conversation-vocabulary.html`（浏览器直接开，带标尺开关+自动播放）
> - 设计系统主文档：`/Users/aoqimin/Desktop/Nomi/docs/design/nomi-design-system.md`（§1.5 控件层级、§2.7 动效、§3.5 付费双宿主、§5.5 徽标、§6 图标）

---

## 节 1 · #194 规范本体：对样张最关键的硬规格

来源：`origin/main:docs/design/nomi-agent-interaction.md`。这份是「实现依据，不是现状描述」——即样张要落的目标态。抽出对画样张最 load-bearing 的 20 条（形态编号取自规范 §4 的 21 种词汇表）：

**S1（主张 · §1）** 一句话主张：**对话是任务的索引与回执，画布是产物的真相源**。聊天卡不能存与画布不同步的「第二个产物」。三条判对错原则：① 原位更新不追加（同一条 id 在变：「排队第3」→「进行中 3/5」→「完成·5镜」，不是刷三条）；② 一件事一行、展开才有细节（21 形态→视觉只有 3 层级）；③ 诚实优先于好看（价格标出来、失败标人话原因+是否计费、上下文压缩了要说）；④ 发出去的上下文必须看得见、冻得住（发送即快照 revision+locator）。

**S2（状态词表 · §2，先落这个）** **8 态 + 2 标志**，取代现在四套互不认识的说法：
- 8 态（互斥）：`drafting`（无字扫光中）/ `proposed`（等你确认）/ `declined`（你拒绝了）/ `queued`（排队中·前面还有N个）/ `running`（进行中）/ `done`（完成）/ `failed`（失败）/ `stopped`（已停止）。
- 2 标志（挂在态上，不是独立态）：`retryable` 挂 `failed`；`deviated` 挂 `done`（「做完了**且**和批准的不一样」，不是 done 的替代——现在 warn 与 done 互斥是错的）。
- **颜色只有 4 组**：中性在走(`drafting/queued/running`→`--nomi-ink-40`)｜要你动手(`proposed`·反问·付费→`--nomi-accent`)｜成了(`done`→`--workbench-success-ink`)｜出事了(`failed/stopped`→`--workbench-danger`)｜有偏差(`done+deviated`→`--nomi-warning`)。样张的所有状态色必须从这 5 组取，不许出现第 6 种。

**S3（三视觉层级 · §3）** 一行 / 可展开的一行 / 卡片。**只有两类升级成卡片：① 要你做决定的 ② 产物本身。** 新增形态先问「要不要你做决定、是不是产物」，都不是 → 只能是一行。

**S4（形态 4 思考条 · §4/§5）** 思考条 = **可展开的一行**：工序图示 + 片场话 + 计时；**结束时落定成结果**（「想了 4 秒 · 5 镜，2 镜要站位参考」），**不能就地消失**。这是 12 条不一致里「思考落定」缺 render 的直接目标态。

**S5（等待指示器 = 工序图示 · §5）** **不用品牌 N**（语义撞车：assistant 消息头已有 `NomiLogoMark`，N=身份≠状态）。改用「工序图示」：图标随当前工序变、图标本身即进度。阶段词表**沿用 Playbook 阶段**（`script|storyboard|build|generate|assemble`，单一真相源 = `skills/brand-promo/skill.json`），**不另造第四套**。五道工序各有图示+动作+时长（读剧本=一页纸3行1.9s／拆镜头=3横格2.1s／搭画布=取景框四角对焦2.4s／出片=场记板打板1.9s／上时间轴=3轨道左走2.0s）。工序图示 = 受管动效资产，只能由 `src/design/` 提供，通用图标仍只用 Tabler。

**S6（形态 2 压缩分隔线 · §4）** 一行：「前面 24 轮已折叠 · 展开」。不给这条，自动压缩发生时用户只会觉得 AI 突然失忆。缺 render，需样张体现。

**S7（形态 5 阶段分隔线 · §4）** 一行：「进入 · 生产段」。缺 render。

**S8（形态 1/21 上下文用量 + 常驻技能标记 · §4）** 面板顶同一行：上下文用量（用了多少/还能聊多久，`agentUsageStore` 已在累计但**全仓无人读**）+ 常驻技能标记（技能约束的是**后面所有输出**，不能只在载入那一刻闪一下）。缺 render + 技能标记未常驻，是两条不一致。

**S9（形态 14 多候选组 · §4/§17.2）** 卡片：并排挑、指定生效版本。**并排最多 3 版，多的折叠**。同一生成请求的多候选先进**暂存组**（`select/previous/next/accept/discard`），只有 `accept` 后才成正式画布版本。缺 render。

**S10（形态 16 有出入卡 · §4/§11 护城河）** 卡片：**批准 ≠ 执行**。**Nomi 独有，AI Elements 与所有竞品都没有**。缺 render。

**S11（形态 17 反问卡 · §4）** 卡片：选项 chips，**≤3 问合并**（TapNow 是 4，我们更克制）。缺 render。

**S12（形态 9 付费确认卡 · §4/§10）** 唯一重卡。明标**每项单价+合计** + 明标冻结项（「过闸后不能再改：镜头数、模型、时长、清晰度。提示词仍可改」）。两个宿主共用同一 `SpendConfirmRequest` 与同一份明细组件（对话流内富卡 / `SpendConfirmDialog` 居中弹窗）。

**S13（控件规格 · §8，用户两次点名「按钮一大一小」）** **所有可点的东西统一 28px 高**（`h-7`·`px-3`·12px 字·**圆角 7px**）。选择器/chip=药丸；按钮=7px 方角，两者不能互串。同排动作按钮**等宽均分**（`flex:1`），主次**只用颜色**分（深底=主、描边=次），**层级不靠尺寸**；一排最多 3 个，再多→主按钮+「更多」；**文字链不与按钮同排**（此前把次要动作降成文字链恰恰制造了「一大两小」）；单动作最小宽 72px。⚠️ 样张里此前出现过设计系统里**不存在**的尺寸（自造 `xs`=24px/padding 9px）——严禁再犯。

**S14（动效 token · §7，1 条→6 条）** `--nomi-motion-tap`140ms(=现有transition-fast改名) / `-enter`260ms / `-settle`420ms(描边勾·数字落定) / `-breathe`1.8s(在想) / `-sweep`2.2s(在跑) / `-develop`900ms(图在出)。**等待类慢+低对比（1.8–2.4s，用户盯几小时），状态跃迁才快+明显**。三条硬纪律：`prefers-reduced-motion` 一次性全关；**同屏最多 1 处扫光**（多任务并行只当前活跃那条动，其余降级静态百分比）；暗色单独验。做：扫光=还活着／呼吸=在想／数字滚动=值刚变／滑入=这是新的／描边勾=成了／模糊转清晰=图在出。不做：渐变流光/粒子/发光边框/彩虹色。

**S15（参数条复用 · §9，铁律）** **不在对话卡里另造参数 UI**。计划卡/付费卡里的参数条 = **同一个 `InlineParameterBar`**，控件全由**模型档案声明**（`DynamicModelControl`+`useDedupedModelSelect`）——换模型控件自动变。分两层：批级（卡顶「这批用」完整参数条）+ 单镜（每行右侧默认「同上」，改过显「已改10s」+可还原，点行展开）。**摘要 pill 对话卡里要 150px**（不是节点上的 110px——110px 会把「16:9·5s·720p」截成「…72…」看着像坏了）。

**S16（生成提案卡骨架 · §9.3）** 复用画布图片节点的卡片骨架：**上半永远是 Prompt**（完整可读、可编辑、长则换行/滚动，不用截断文本冒充已确认内容）；下半是参数区（挂 `InlineParameterBar`）。Agent 卡可换宿主外壳颜色/状态徽标/确认文案，但**不能改 Prompt 在上、参数在下的阅读顺序**，不能手写 provider 专属控件。

**S17（框选批量卡 · §9.4）** 框选后**不铺 N 张卡**：一张批量卡 + **横向三页堆叠**（可视层最多露 3 张：当前+后两张错位，后卡只露右侧角/页签；`当前项/总数` 明示，键盘左右键+可访问上一/下一按钮，绝不只靠没文字的角落猜）。公共批量控制固定在堆叠下方（沿用 `CanvasBulkModelSelect`/`BulkModelPicker`）。**批量卡翻的是多个输入镜头；多候选卡翻的是同一请求的多个结果**——两者都最多三层，但状态源/确认语义/去画布目标必须分开。

**S18（输入合同 · §13）** **不设「引用模式」**。画布选中自动进 composer 上方**上下文架**（chip）；`@` 补充非当前对象/时间段/3D视角/网页选区/Skill。`ContextHandle` 带 `intentRole`（`subject|style|structure|motion|audio|source|target`），**必须可见且可改**（三张图只显文件名→模型不知谁是主体谁是风格；chip 要说「主体·角色定妆」「风格·低饱和胶片」）。**发送即冻结** `ContextSnapshot`（targetId+revision+locator）；历史 chip 显示「引用后已变化」，可「改用最新版」但旧消息不改写；对象删了保留 poster+标「原对象已删除」。crop/timeRange/cameraPose 都要在 chip 副标题可读，不能只藏 JSON。

**S19（执行/模型两根轴 · §14/§15）** **工作方式**（`Ask`/`编辑选中`/`Agent`）与**批准策略**（`逐步确认`/`自动批准安全动作`/`完全允许(本项目)`）是两根**正交**的轴；改工作方式**不能**隐式扩大批准策略。⚠️ 12 条不一致里「工作方式词表私造 4 档」——规范只认这 3 档工作方式，样张不许出现第 4 档。composer **只选 Agent 文本模型**（底栏）；图片/视频/音频/3D 制作模型在计划卡或节点参数里选（分层，S15）。

**S20（忙时队列 · §4.1/§16，P0 真 bug）** 现在 `busy` 时回车**静默丢弃**（`CanvasAssistantPanel` 的 `if (…||busy) return`），用户打字回车屏幕什么都不发生——这是「这软件坏了」级的洞。队列项不是字符串是完整 `TurnDraft`（text+attachments+context快照+workMode+approvalPolicy+agentModelId）；可编辑/删除/上移/下移/暂停；折叠时仍显数量+是否暂停。形态 18「指令队列」在输入框上方。「纠正当前任务」(steer) 与「下一条完整请求」(nextTurn) 分开。

> 另附 §11「留着别碰（护城河）」：**提议事务+整批撤销**（`proposalTxn`/`proposalUndo`=写入回执·撤销）、**对账偏差**（`reconcile`，AI Elements 与所有竞品都没有）、**镜级画面校验**（`shotVerify`）、**额度闸**（`gate`）。§11 组件来源判断：AI Elements 48 组件里 14 个写码 agent 专用与我们无关、7 个画布类我们自研更强（它 `canvas.tsx` 仅 26 行=包了层 ReactFlow）、11 个我们已有，真正可借鉴是那 27 个对话类；「词汇表复用、组件按需拷入重皮、协议对齐形状」，**不引入 AI Elements 运行时依赖、不保留第二套视觉基础设施**（换 `src/design` + Tabler + Nomi token）。

---

## 节 2 · 竞品交互文档：我们发现的细节清单

**「用户说的后来补的竞品交互文档」= 2026-08-24 的三份 survey**（最像用户所指的那份是 **`2026-08-24-agent-conversation-vocabulary-survey.md`**——它被 #194 规范 §1/§4 **直接引用为行业依据**：「进度/中止：对话内原位进度无人做」「花钱确认：没有一家卡上显示价格」。另两份 `agent-product-interaction-survey.md`、`xiaoyunque-mode-interaction-study.md` 同批、互补，都该读）。这三份是 #244 今天捞回的一批里的（`ae158ee2` merge 含 `2026-08-15-creation-agent-modes.md`、`2026-08-18-infinite-canvas-competitive-analysis.md`、`2026-08-20-libtv-*.md` 等）；`2026-08-19-conversational-creation-ux.md` 是第四份 meaty 的。全绝对路径在 `/Users/aoqimin/Desktop/Nomi/docs/research/`。

### 2A. 对话词汇表 survey（`2026-08-24-agent-conversation-vocabulary-survey.md`）— 最贴用户所指
逐家啃官方一手资料（DramaClaw 飞书手册/TapNow docs/LibTV 指南/小云雀教程/可灵/MiniMax/星流官方页）。**竞品怎么做 → 我们该学什么**：
- **DramaClaw（虾导/虾条）**：运行态词汇最完整的一家——投递中/队列中/等待中/启动中/运行中/已完成/失败/已取消 8 态 + 取消/删除/清除 + **断点续跑**；「展开任务查日志/错误/结果」「跳转按钮回到对应页」。**反面教材**：自造黑话「虾条/虾导」增加认知负担（用户原话吐槽）。→ **学**：8 态启发了 #194 的 8 态词表；**避**：命名一律大白话自解释，不造要背的品牌黑话。
- **TapNow（与 Nomi 草案最同构）**：任务生命周期六段声明；**合并提问 ≤4**（问题集中显示在输入框上方，下一题/提交）；**自动/手动双生成模式**随时切换（手动=先出确认卡：模型/比例/时长/数量/参考 +「生成」按钮才调）；产物写画布，对话用 +/@ 引用。**半诚实反例**：卡片**不显示价格**（原话「手动确认只是让消耗发生在点击之后，不会免除消耗」）。→ **学**：双模式+可编辑参数确认卡+合并提问；**Nomi 反着做**：确认卡**明标价格**（直击行业积分黑箱骂点）。
- **LibTV**：**错误修正闭环是标杆**——读报错→查节点态→判因（参数/引用/模型/素材/审核/临时）→改后重试，「不要重做整张画布，先定位失败节点」；脚本表格**第一列勾选批量重跑**；「先搭好完整画布，等我确认无误再生成」。→ **学**：失败条给「哪步败+人话原因+下一步」；级联勾选重跑。
- **小云雀**：向导式流水线，双确认关卡（人景逐一查验+分镜审核）；逐镜**悬停重做图标**；10-20min 美术准备期无过程可见性（「等待片刻」）=**黑箱等待反例**。→ **学**：产物行内「改这条/重跑」；**避**：黑箱等待，思考条要默认折叠可展开（卡在小云雀黑箱与 MiniMax 过重之间）。
- **可灵灵动画布**：指令→画布直接生成任务节点，「每一步在画布实时查看」，**并行开跑多任务**；产物「添加到对话框」回填作参考。
- **星流/Lovart**：**单击产物→Tab 编辑栏→自然语言指令**局部重绘（摩擦最低的定向修改）；画布是产物主舞台。
- **跨产品对照（行业答案，直接塑形了 #194）**：思考/规划两极（黑箱 vs 重思维链，中间点空缺）；花钱确认「确认卡+点击才扣是主流，**没有一家卡上显示价格**」；进度/中止「独立任务中心或画布节点，**对话内原位进度无人做**」；产物全行业共识落画布、对话只留入口/缩略。
- **草案缺的五个状态（已采纳补入 #194）**：① 任务前后态（排队中第几位/等待中/已取消）；② 产物行内动作「改这条/重跑」；③ 失败条；④ 多候选并排组件；⑤ 写入回执「已加7个节点·撤销」。

### 2B. 产品侧 Agent 交互 survey（`2026-08-24-agent-product-interaction-survey.md`）
MiniMax/海螺、小云雀、TapNow、LibTV、可灵、星流/Lovart。跨产品收敛（行业答案）：① **对话是方向盘，画布/结构化视图是路面**（6家里5家收敛到「聊天框贴画布、产物落节点、聊天只留过程」，纯聊天流+外链已被淘汰）；② 便宜步骤自动跑、贵步骤设闸，闸=**一张可编辑参数卡**（不是 yes/no 弹窗）；③ 双视图成标配（同一份状态给「看进度」和「改细节」两个镜头）；④ 局部返工=改上游+勾选重跑范围（没有一家让用户整篇重生成还活得好）；⑤ 模式切换普遍存在但都做得浅。Nomi 差异化：预算前置确认卡（TapNow 有参数没总价、可灵有单价没总账）、prompt 三层可观测（用户写的/Agent改写的/实发的）、失败归因+是否计费明示（自己 API 额度→把「无补贴」劣势变信任优势）。

### 2C. 小云雀模式精读（`2026-08-24-xiaoyunque-mode-interaction-study.md`）
一手飞书手册。**三档模式强度并存**：重管线（短剧Agent/重制转绘，固定步骤+显式确认闸门+分集状态机，对话几乎不参与）/ 对话主驾（Agent模式/剧本助手，多轮对话唯一入口，画布可开可不开）/ 单发直出（沉浸式短片/图片/一镜到底/爆款复刻，零中间态）。**不可逆闸门三件套**：确认框+花费预估+**明说过闸后冻结什么**（Nomi 确认卡补第三件 = #194 S12）。**抽卡记录：同提示词结果折叠为一组、可指定生效版本**（= #194 多候选组 S9）。分集状态机（未解析→解析中→完成/失败标红），「重新解析」一键重试所有失败集不影响已成集（= 失败局部重试）。**它的坑：两套画布并行版**（短剧资产画布 vs 通用创作画布，双维护双心智）——Nomi 一套画布+模式档案声明可用节点/工具集（P1 正面反着看）。

### 2D. Infinite-Canvas 全量调研（`2026-08-18-infinite-canvas-competitive-analysis.md`）
B站 UP「wuli大雄oO」开源项目（2815★）。**他做对的交互**：① protocol 一等抽象（填Token→验证→拉模型→**勾选想用的**→保存，直击「接了模型改不了URL」）；② **素材库全局化+`@`引用**（`smart-canvas.js:14496` `if(/@$/.test(before)) showMentionPicker()`，不连线也能喂参考图）；③ 循环节点（批量最小心智：一个基础提示词+一列变化项，拖到目标附近自动吸附连接）；④ 导入工作流后**内置测试区**「保存前先跑一次」（Nomi 没有）。**他踩的坑**：硬编码模型清单每出新模型发一版；模型类型靠关键词猜（`MiniMax-H3` 不含关键词→落 chat_models 显示为 LLM）；ComfyUI 只吃 API 格式。**N6 命名实体绑定**（最有战略价值，赞6）：用户要「图片命名孙权/刘备/曹操，提示词写名字自动匹配」= 多参考图张冠李戴的用户语言版。

### 2E. 对话式创作 UX（`2026-08-19-conversational-creation-ux.md`）— 终端六通道视角
针对 Claude Code/Codex 终端宿主（到用户眼睛只有六通道：模型文字/行内进度帧/elicitation表单/`nomi://`深链/桌面通知/切窗）。**三段式收敛**：开场≤3问一轮问全 → 计划/中间产物落文本让人过目 → 长任务后台跑+状态帧。**「不问」的三种平替收敛器**：可编辑计划（Gemini）/ 渐进控制档（Suno Simple↔Custom）/ 直接出可改中间产物（LTX effect-first，一句话直接给分镜让「指着改」而非答问卷）。**三档闸门**（治「反复确认」）：Auto-approve（读/搜/定点小改，静默+一句回执）/ Notify（整体重生成/覆盖草稿，先斩后奏告知）/ Block（大额/不可逆/方向岔路，必须显式批准）；核心配比「agent 自主处理 95% 常规，只对 5% 高风险中断」。**编号镜头列表（story-order ID：#3 / 5A/5B）**是纯文本对话展示分镜的默认最优解，ID 直接充当「指着改」地址。**MCP `tasks` 规范** = 长任务节奏标准底座（`statusMessage`/`pollInterval`/`progressToken`/`input_required`）。

### 2F. LibTV/一句话初稿（`2026-08-20-libtv-*.md`）+ 创作模式（`2026-08-15-creation-agent-modes.md`）
- **LibTV/Infinite-Canvas/LTX/InVideo/Gamma/Canva 五件共识**：一句话只是入口不是内部数据结构（编译成 outline→assets→shotPlan→jobs）；首稿必须是「可编辑草稿」不是最终成片；**局部 patch > 整篇 regenerate**（Canva 用 transaction、InVideo 用单帧提取、LTX 用 Retake 保留周围）；参考图是**有职责的输入**（character_anchor/location_anchor/prop_anchor/last_frame，= #194 intentRole）；自动化必须有状态/预算/确认（InVideo 审批卡显示 prompt/model/duration/aspect 可改后再批准 / Canva commit transaction / Infinite Canvas 网页二次确认）。Canva MCP 验证闭环范式：`generate-design(候选)→create-from-candidate(用户选)→start-editing-transaction→perform-ops(草稿patch)→commit→export`，「不能自动替用户选候选、没commit不能声称已保存、编辑走patch不整份regenerate」。
- **创作区模式（`2026-08-15-creation-agent-modes.md`）**：首版只放**三个常驻模式**（通用/小说/剧本），**模式=改变一轮 Agent 执行合同**（不是标签、不是换 system prompt）；模式进 composer 发送配置行「附件→模型→模式→发送」，复用模型选择器的紧凑控件语言（不做三颗独立胶囊/pill soup）；模式≠文档类型（切换不修改现有稿/不清空对话/下一轮起生效/每轮冻结 mode+skill+context+prompt 版本）；「分镜」不做成永久模式（名实冲突：文字稿 vs 落画布）。竞品参照：Sudowrite `Chat only/Allow edits` 常驻开关、NovelAI 只有 Storyteller/Text Adventure 是一级模式（因为改变输入语法），Rewrite/Expand 是选区**动作**不是模式。

---

## 节 3 · 自家已有交互：值得被 Agent Dock 复用的成熟模式（一致性 > 新造）

盘点值得吸收的自家成熟交互（file:line，全绝对路径 `/Users/aoqimin/Desktop/Nomi/`）。**优先复用这些、别新造**——它们大多已过设计系统、i18n、暗色、诚实纪律。

### 3A. Composer 附件轨 — `src/workbench/ai/composer/AttachmentRail.tsx`（148 行）
**已实现 AI Elements Attachments 文档里*省略*的全部边界情况**：
- 图片 → **48px 缩略 tile**（`size-12`圆角+object-cover），文件 → **max-184px chip**（图标+文件名截断+「类型·大小」副行）。`FileGlyph` 按扩展名分表格/文档/通用图标（`AttachmentRail.tsx:12-17`）。
- **uploading 态**：图片上盖 `bg-nomi-paper/60` + `NomiLoadingMark`；文件左图标位换成 loading mark（`:78-82`,`:97-98`）。
- **error 态**：`border-workbench-danger` + `title` 显 error + 副行显「上传失败」（`:61,:92,:103`）。`data-attachment-status` 属性可供走查断言。
- **remove**：图片右上角 -1/-1 悬浮小圆钮（ink 底 paper 描边），文件行尾 X（`RemoveButton` `:19-41`）；`readOnly` 时全隐藏 remove。
→ **Agent Dock 上下文架/附件直接复用这套**，别照抄 AI Elements 的 Attachments（后者 uploading/failed/retry 态文档里根本没有，见节 4）。#194 §13.2「本地附件 = 48px 媒体 tile / 文件 chip」正是这个组件。

### 3B. 计划卡 — `src/workbench/generationCanvas/components/AgentPlanCard.tsx`（396 行）
**已实现 #194 §9「批级+单镜两层」+ S3「一件事一行、展开才有细节」**：
- **PlanNodeRow**（`:66-162`）：默认一行（编号圆点+标题+引用chip+prompt单行预览），**点行 `aria-expanded` 展开出 textarea 改单镜 prompt**（`:136-159`）。
- **PendingChip「待你看」**（`:50-63`）：AI 配的、用户没动过的参数用**蓝底 accent chip**跳出来（模型/比例/清晰度）。⚠️ 关键诚实纪律注释：「曾有假下拉 ▾ 暗示可点开改选项实则无交互，已删」——**样张严禁画有 ▾ 但无交互的假下拉**。
- **轨迹分组**（`:212-219`）：≥2 层时按 参考/关键帧/视频 分组；**尾帧接力边可勾选**（取消即从批准剔除该边，`:315-363`）。
- **一次「确认全部」原子批准**（`handleConfirmAll` `:239-267`，create+connect 共一 proposalId 事务）；按钮走设计系统 `variant=default/primary size=md`（=h-8，零尺寸变化，注释明说「不再手搓 className」，直接对齐 S13）。`React.memo` 流式期间零重渲染。

### 3C. 写入回执卡（护城河「已加N节点·撤销」）— `CommittedProposalCard.tsx`（137 行）
= #194 形态 10「写入回执」+ §11 护城河「提议事务+整批撤销」：
- commit 后存活到下一笔提议或本会话结束；✓ 摘要独占一行（可换行不挤按钮，`:52-62`）；`mismatch` 标记走 `--nomi-snap-tag`。
- **落点回报 chip**（`:63-82`）：本笔节点落进哪些分类，非当前分类给跳转 chip（跨分类产物如定妆卡对停在分镜视图的用户否则=凭空消失）。
- **「整笔撤销」双确认**（`handleUndo` `:33-41`）：先 `detectLostUserEdits` **列明将丢失的用户修改**再等第二次确认（= #194 §N13「用户改过提议节点时先列明再丢」）——样张的撤销要体现这个 lost-edits 中间态。
- 「查看步骤」展开最小轨迹视图（人话步骤序列，`:106-114`）。

### 3D. 有出入卡（护城河「批准≠执行」，Nomi 独有）— `ReconcileDeviationCard.tsx`（233 行）
= #194 形态 16「有出入卡」+ S10。**正常对账一致时永不出现——它是诚实纪律的兜底面，不是常驻 UI**（`:159` 注释）。
- 每条偏差：`where`（源标题→目标标题）+ `fieldLabel` + `detailLine`（人话说「哪些没按计划生效、为什么」，不甩原始 id+黑话）。结构偏差 vs 内容偏差（画面校验）两套 caption。
- 动作按门类派生：`showAiFix`（结构边丢失=重连边／画面偏差=改prompt重生走确认闸，预算耗尽则隐藏，`:174`）、`showUndo`（只对结构偏差，verify 没改东西无可撤销，`:176`）。`exhausted` 时改显「已尽力」绝不无限回灌。
- **所有偏差词表 derive 自 `SHOT_VERIFY_DIMENSIONS`**（`:111-113`）不手抄第二份——样张文案也应 derive，别硬写。

### 3E. 付费确认双宿主 — `src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx`（474 行）
= #194 §10 + S12。**三种来源共用这一个对话框（不另造并行卡，P1）**：用户直发（light，多「本会话不再提示」）/ agent 受理（每次必确认）/ 外部 MCP（机器人图标+明细行+**倒计时**到点自动按未确认返回）。
- **倒计时 + 「交互即暂停」**（`:37-69`,`:110-117`）：多镜卡用户一旦点/移入/聚焦，倒计时停在原地、文案切「已暂停·你正在查看」（`countdownPaused`）——样张的付费卡要体现这个暂停态。
- **方向门候选单选**（`:27-29`,`directionCandidates`）。宽度按门类：合同 680px / 形象 560px / 普通 380px；flexShell（多镜/形象卡）= 滚动内容区+固定 footer。图标按门类派生（合同=FileText/plan=Movie/reference=Photo/anchor=User/agent=Robot/用户=Coin）。z-index `dialog(9100)` 高过任务中心(4000) 低过破坏性 confirmation(9300)。

### 3F. 任务中心面板 — `src/workbench/taskCenter/TaskCenterPanel.tsx`（422 行）
= #194 形态 11/12「排队/进度」的画布侧现役实现（**注意 #194 主张是把原位进度搬进对话，但任务中心的这些诚实纪律要继承**）：
- 右上浮卡 380px（不遮画布/不 dim/ESC+点外关，`:58-82`）；三段 running/queued/done（`SectionHeader` 带 count，queued 段标「可免费取消」）。
- **诚实纪律（样张必须继承的三条）**：① **没拿到百分比就不画进度条**（`:388-394` 注释：「画一条永远空的槽会被读成分隔线，走查实锤，也是在假装知道进度」——靠区段标题+已跑时长表达「在跑」）；② **云端提交后停不下来 → 显 `IconLock`「已提交·钱已花」而非假取消按钮**（`:395-401`，「给个假的取消按钮等于撒谎」）；③ 取消按钮文案按 `cancel==='free'` 分「取消」vs「中断」。
- **连续失败刹车**（`TaskCenterSummaryBar` `:298-312`）：不是普通汇总，说清「为什么停」再给两条路（继续/取消其余）。**失败重试只对失败的重建波次走轻确认铸新令牌不重付成功的**（`:134-144`）。已跑时长 1s 走字（`TICK_MS`，注释「别 rAF 白烧 CPU」）。

### 3G. 框选工具栏（批量卡的数据源）— `CanvasSelectionToolbar.tsx`（108 行）
= #194 §9.4 批量卡「公共控制沿用 `CanvasBulkModelSelect`」的源。药丸浮条（`max-w-760px` 溢出横滚），按 `executionGroups` 分别放图片组/视频组的批量模型选择（`CanvasBulkModelSelect` 每 group 一个，`:61-68`），+ 生成钮 + 并发选择 + 联系表(≥2张才出) + 编组/取消组 + 清除。图标钮统一 `size=sm`+`shrink-0`。样张的批量卡堆叠下方控制区应复用这套语义（图片/视频分组、不在每张卡重复放供应商选择器）。

### 3H. 浏览器对话框 — `src/ui/browser/dialog/`（`NomiBrowserDialog/Model/View.tsx` + `useBrowserDialogActions.ts`）
= #194 §18「先读、再选、后导入」的现役外壳。Model/View/Actions 三分（可单测）。样张涉及外部素材导入时对齐这个「取上下文→搜索候选→展示来源(预览/作者/来源URL/许可)→用户选择后导入并记 provenance」四段，登录/账号/验证码/购买/发布/删除始终停下。

### 3I. 其他相关现役件（备查）
- `src/workbench/ai/composer/useComposerAttachments.ts`（190）+ `AutoGrowTextarea.tsx`（37）+ `composerAttachmentTypes.ts`（48）：composer 附件状态机 + 自增高文本域。
- `src/workbench/ai/CreationPromptPicker.tsx` + `creationPromptPicker.structure.test.ts`：**prompt 选择器**（挪到发送键左边、和模型选择器并排，用户 2026-08-18 拍板）——即 12 条不一致里「prompt 选择器是规范外新增」的现有实现，样张要决定它进不进 #194 词表。
- `src/workbench/generationCanvas/components/BatchPlanOverlay.tsx` / `CanvasBatchGenerateDock.tsx` / `CardStackPeeks.tsx`：现役批量/卡片堆叠件（`CardStackPeeks` 正是横向三页堆叠的现役实现，S17 复用它）。
- `src/workbench/ai/AssistantMessageView.tsx`（`NomiLogoMark size={18}` 头）/ `staleConversationDivider.tsx`（现役「压缩/过期分隔线」的近邻，S6 参考）/ `AssistantErrorCard.tsx`（失败卡现役）/ `agentUsageStore.ts`（S8 上下文用量的数据源，已写无人读）。
- `src/workbench/generationCanvas/components/AssistantTimeline.tsx`：#194 §11 点名「15-prop 接口要删掉重做」；样张不要继承它的 prop 爆炸，改订阅 8 态 store。

---

## 节 4 · AI Elements 实查（elements.ai-sdk.dev）+ 双向对账

**是什么**：Vercel 官方的 **AI Elements** = 建在 **shadcn/ui** 之上的组件库 + 自定义 registry（"component library and custom registry built on top of shadcn/ui to help you build AI-native applications faster"）。与 AI SDK hooks（`useChat`）**深度集成**，处理流式响应/工具展示/markdown 渲染这些标准 React 组件不管的事。**安装**：AI Elements CLI (`npx`) 或标准 shadcn CLI（`https://elements.ai-sdk.dev/api/registry/all.json`）；组件落进你的 `@/components/ai-elements/`，**成为你代码库的一部分、可完全改**。**技术底座**：shadcn/ui（=Radix primitives + Tailwind + CVA + lucide 图标）；Chain of Thought 明写「collapsible…powered by Radix UI」。有 AI SDK v6 版文档（`v6.ai-sdk.dev/elements`）。

**完整组件清单**（比 #194 规范当时记的「48 个」更全，已扩到 5 类；**★ = #194 规范当时没有、现在新增的、直接对上 Nomi 缺失形态的**）：

**Chatbot 类（对话，最相关）**：Conversation（`role="log"`容器+空态+回到底部按钮）、Message（单条消息）、**Chain of Thought ★**（推理步骤可视化，见下）、**Plan ★**（任务拆解+排序）、**Confirmation ★**（执行前校验用户动作）、**Context ★**（AI 回复的背景信息展示）、**Model Selector ★**（选模型）、**Queue ★**（待处理请求）、**Attachments**（会话内文件分享，见下）、Prompt Input（输入框）、Reasoning（决策逻辑）、**Checkpoint ★**（会话存点）、Inline Citation（正文内溯源）、Sources（引用文档）、Suggestion（快捷 prompt 钮）、Task（单工作单元）、Tool（函数调用展示）、Shimmer（loading 动画）。
**Code 类（写码 agent 专用，与我们大多无关）**：Agent、Artifact、Code Block、Commit、Environment Variables、File Tree、JSX Preview、Package Info、Sandbox、Schema Display、Snippet、Stack Trace、Terminal。
**Voice 类（★ 整类新增，对 Nomi 配音/TTS 有用）**：Audio Player、Mic Selector、Persona、Speech Input、Voice Selector。
**Workflow 类（画布，我们自研更强）**：Canvas（26 行=包 ReactFlow）、Connection、Controls、Edge、Node、Panel、Toolbar。
**Utility**：Image、Open In Chat。

**关键组件细节**：
- **Chain of Thought**（对上 #194 S4「思考落定」）：composable——`ChainOfThought`(root collapsible) / `ChainOfThoughtHeader`(可点 trigger 显标题) / `ChainOfThoughtStep`(步骤带 icon+status) / `ChainOfThoughtContent`(展开容器) / `ChainOfThoughtSearchResults` / `ChainOfThoughtImage`。步骤三态 `complete/active/pending`；Radix 平滑折叠+键盘导航。**⚠️ 文档没说完成后是否落定成结果还是消失**——这正是 #194 S4 明确要求的「结束落定不消失」，**AI Elements 没保证，Nomi 要自己补**。
- **Attachments**（对上 #194 §13.2）：composable——`Attachments`(容器,变体 grid/inline/list) / `Attachment` / `AttachmentPreview`(缩略或 fallbackIcon) / `AttachmentInfo`(名+类型) / `AttachmentRemove`(hover 出+ARIA label) / `AttachmentHoverCard`(hover 预览) / `AttachmentEmpty`。`getMediaCategory()` 自动分 image/video/audio/document/source/unknown；吃 `FileUIPart & {id}` / `SourceDocumentUIPart & {id}`。**⚠️ 文档明确「不涉及 uploading / upload-in-progress / error / retry / 瞬态」——只覆盖最终 uploaded 态**（原文：「Upload progress tracking, failure handling, retry logic, and transient states are absent」）。

### 双向对账 a) AI Elements 有、而我们（#223 Dock + #194 规范）没有的交互能力
1. **`role="log"` + 只有用户仍在底部才随流式内容下跟 + 离底出现「回到最新」按钮**（Conversation）——#194 §11/§19 明确说要吸收这三点，但**当前 Nomi 对话面板没有**。样张必须体现「回到最新」浮钮 + 底部锚定跟随逻辑。
2. **Checkpoint（会话存点）**——#194 词表 21 种里**没有**「存点/回到某轮」形态；AI Elements 有。Nomi 有 `ConversationHistoryList` 但那是跨会话历史，不是同会话内的 checkpoint/branch。是否补进词表需样张决策（Nomi 侧已有 `docs/design/2026-08-25-anchor-checkpoint-card-mockup.html` 可参考）。
3. **Inline Citation（正文内可点溯源）**——#194 §17 网页素材有 provenance，但**没有把「行内引用」做进对话文本**（对上 `2026-08-19` survey 的 NotebookLM「指着看」）。外部素材/浏览器结果的对话投影可借。
4. **Voice 整类**（Audio Player / Voice Selector / Persona / Mic/Speech）——#194 §4 明说「音频播放器/音色选择随配音·TTS 补，现在只占位」。AI Elements 的 Voice 类是现成结构参照，配音段落做样张时直接对照。
5. **Suggestion（快捷 prompt 钮）**——空态/引导的快捷动作按钮，#194 空态没细化，可借。

### 双向对账 b) 我们有、但对方实现细节更讲究？→ **反过来，我们几乎全面更讲究（诚实纪律）**
1. **Attachments 上传态**：AI Elements 文档**根本没有** uploading/failed/retry；Nomi `AttachmentRail.tsx` 全都有（3A）。**我们更讲究**——采模式即可，不采它组件。
2. **进度诚实**：AI Elements 的 Task/Tool 无「没数就不画进度条」纪律；Nomi TaskCenter「没百分比不画槽/云端提交后显锁不给假取消」（3F）远更诚实。
3. **有出入卡（批准≠执行）**：AI Elements **完全没有**对应件（它有 Confirmation=执行前确认，但没有「执行后与批准对账」）；Nomi `ReconcileDeviationCard` 是独有护城河（3D，#194 §11 明写「AI Elements 与所有竞品都没有」）。
4. **付费明标价+冻结项+交互即暂停**：AI Elements Confirmation 是通用确认，无价格/冻结项/倒计时暂停语义；Nomi `SpendConfirmDialog` 有（3E）。
5. **计划卡诚实 chip**：AI Elements Plan 是通用任务拆解；Nomi AgentPlanCard 的「待你看」蓝 chip + 「删了假下拉」诚实纪律 + 档案声明参数（3B）更贴创作场景。

### 技术底座兼容性判断（token-only 设计系统）
- **判定：采「模式/结构/行为算法」，不采「组件/运行时依赖/视觉基础设施」。** 理由：AI Elements = shadcn/ui（Radix + **lucide 图标** + **CVA 类名** + **默认色板**），与 Nomi 的 **token-only（禁 hex/任意 px、Tabler 唯一图标库、`--nomi-*`/`--workbench-*` token）** 三处硬冲突。#194 §11/§19 已拍板：允许拷贝小组件的**结构与行为算法**，必须换成 `src/design` 组件 + Tabler 图标 + Nomi token，**不引入 AI Elements 运行时依赖、不保留第二套视觉基础设施**。
- **具体可采的算法/结构**（拷进来重皮）：Conversation 的「底部锚定+回到最新」滚动算法；Chain of Thought 的 collapsible step 结构（但补「落定不消失」）；Attachments 的 grid/inline/list 三变体分工 + `getMediaCategory` 分类思路；Queue 的 item/attachment/actions slot 拆分。**Radix 折叠可用其无障碍行为但样式全换 token**（Nomi 已在用 Mantine Portal/`@mantine/core`，无障碍原语不缺）。

---

## 节 5 · beautifului.dev 实查

**抓成了。是什么**：**Beautiful UI**（beautifului.dev），由**产品设计工作室 Turbo** 打造，**MIT 许可**（footer + `/license` 页确认），GitHub `slev12397/beautiful-ui`（可 clone）。定位 = **「为 AI-native 界面打造的 copy-paste UI 原语（crafted primitives for AI-native interfaces）」**——不是模板市场、不是 AI 生成器，是**设计师做的成品组件集**。**规模：17 个 polished pattern**（Meng To 转述 + 官方一致）。**技术形态**：**每个 primitive 一个自包含组件、建在一个小的 design-token 层上**，用 **shadcn add 命令**从 registry 拉取。**与 AI SDK 关系**：官方页**未提** Vercel AI SDK（不绑 SDK，纯 UI 层，比 AI Elements 更中立）。

**它有什么（组件类别，抓landing页得）**：
- **Agent 工作流类**：thinking/reasoning 状态、streaming 文本输出、**approval cards（human-in-the-loop 决策）**、**tool chips + task row 状态指示**。
- **数据/内容类**：带 tabbed 面板的 chat composer、records 表（CRM 式关系网格）、**diff tables（提议变更）**、filter tables（实时重组）、code blocks。
- **交互类**：command 过滤搜索、sidebar、**带 source references 的 prompt bar**、**选区改写动作（selection actions for text rewriting）**。
- **分析/洞察类**：带实时图表的 insight cards、flowchart 工作流构建器、**context cards（检索知识块）**、**recommendation cards 带 confidence 置信度计**。

**采用/只采模式判断**：
- **判定：只采模式、可比 AI Elements 更多地采（因为它建在 design-token 层上，与 Nomi token-only 天然更近），但仍不直接引组件。** 理由：① 它 MIT + 一 primitive 一自包含组件 + design-token 层 → 结构上最容易「读源码学做法」；② 但它是设计工作室审美（Turbo 自己的 token/视觉），直接引会带进第二套视觉；③ 它不绑 AI SDK，反而说明它的价值在**交互模式**不在数据管道。
- **具体最该看的模式**（与 #194 缺失形态直接对上）：**approval card**（对 S12 付费卡/S10 有出入卡的视觉手法）、**tool chip + task row**（对 S2 状态词表的一行形态）、**diff table**（对 S10 有出入卡「批准 vs 实际」的表达）、**context card**（对 S18 上下文架 chip）、**recommendation card 带 confidence 计**（Nomi 目前没有「置信度」表达，可考虑用于 Agent 自动选模型时「为什么选它」）、**prompt bar with source references**（对 S18 上下文架+composer）。
- **一句话**：AI Elements 学「AI SDK 集成 + 对话组件行为算法」，Beautiful UI 学「AI-native 视觉手法 + token 层组织方式」——两者都不进依赖，都换 Nomi token + Tabler。

**来源**：https://www.beautifului.dev/ · https://www.beautifului.dev/license · https://github.com/slev12397/beautiful-ui · Meng To on X (2082479500944904432，"17 polished patterns…thinking and streaming states to tool calls, approval cards, and diffs")。

---

## 节 6 · 样张指导原则（这次样张必须体现的具体决定）

每条给出处。画样张的 agent 照这些落，别脑补。

1. **状态色只有 5 组，从 §2.3 取**（S2）。样张里任何状态徽标/边框/文字色必须落进 中性在走/要你动手/成了/出事了/有偏差 之一，出现第 6 种色 = 错。出处：#194 §2.3。

2. **composer 7 常驻簇要收簇——手法优先级「先分组→再去重→再归位→最后才收纳」（设计系统 §1.5）**。候选方案：把发送前配置行收成「附件｜模型｜工作方式(3档)｜模式(创作区:通用/小说/剧本)｜发送」一排，prompt 选择器和模型选择器并排在发送键左边（现役已如此，`CreationPromptPicker`）；上下文架/技能标记/上下文用量**不占工具栏入口**（#194 §13.2「上下文架是 L1 输入反馈，不另占入口」），改为 composer 上方独立带/面板顶行。**先给「常驻预算还剩几个」的账再决定谁进 ▾**，别一上来往 ▾ 塞。出处：设计系统 §1.5 控件层级 + #194 §13.2 + `2026-08-15-creation-agent-modes.md` §6.2。

3. **8 个缺 render 的形态各给一张**（多候选组 S9 / 思考落定 S4 / 压缩分隔线 S6 / 阶段分隔线 S7 / 反问卡 S11 / 有出入卡 S10 + 上下文用量 S8 + 常驻技能标记 S8）。呈现方式硬约束：思考条=可展开一行+**结束落定成结果句不消失**（S4，AI Elements 没保证这条，节 4）；压缩/阶段分隔线=一行文字链式「展开」（S3「过程性→只能一行」）；反问卡=选项 chips **≤3 问合并**（S11）；多候选组=**并排最多 3 版、多的折叠**+指定生效版本（S9）；有出入卡=`where·field` + 人话「哪些没按计划生效为什么」+ 按门类给「让AI修/撤销/知道了」（S10，复用 `ReconcileDeviationCard` 视觉，节 3D）。

4. **有出入卡必须画进样张（批准≠执行，Nomi 独有护城河）**，用 `ReconcileDeviationCard.tsx` 的既有布局（caption + 偏差列表逐条 `bg-nomi-ink-05` + flex-wrap 按钮组）。文案 derive 自 `SHOT_VERIFY_DIMENSIONS` 别硬写。出处：#194 §11 + 节 3D。

5. **控件统一 28px 高、同排等宽均分、主次只用颜色、文字链不与按钮同排、绝不出现自造 xs(24px)**（S13）。样张里同一排若出现一大一小/一长一短 = 直接判错。按钮走 `WorkbenchButton variant=default/primary size=md`（=h-8）或 `size=sm`（=h-7=28px），选择器/chip 用药丸、按钮用 7px 方角。出处：#194 §8 + 节 3B（AgentPlanCard 已示范）。

6. **参数 chip 不画假下拉 ▾**（无交互的 ▾ 是撒谎，已删过一次）。AI 配的待看参数用蓝底 accent「待你看」chip 如实展示，改值去节点/画布。出处：`AgentPlanCard.tsx:59` 注释 + 节 3B。

7. **进度诚实：没百分比不画进度条**（画空槽会被读成分隔线+假装知道进度），靠区段标题+已跑时长表达「在跑」；**云端提交后显锁「已提交·钱已花」不给假取消**。出处：`TaskCenterPanel.tsx:388-401` + 节 3F。

8. **原位更新不刷屏**：排队→进行中→完成是**同一条在变**（稳定 id + UI 订阅），样张要画「同一行三态」而不是三条消息。同屏**最多 1 处扫光**（多任务并行只当前活跃那条动画、其余静态百分比）。出处：#194 §1① + §7.3。

9. **从 AI Elements 学的 3 个对话行为细节（换 Nomi token/Tabler，不引依赖）**：① Conversation 的 `role="log"` + 底部锚定跟随 + **「回到最新」浮钮**（当前 Nomi 缺，样张要加）；② Chain of Thought 的 collapsible step 结构（但**补落定不消失**）；③ Attachments 的 grid/inline/list 三变体分工（Nomi 上下文架用 inline+hover 预览、消息内产物用 grid）。出处：#194 §11/§19 + 节 4。

10. **付费卡：明标每项单价+合计+冻结项清单+「本会话不再提示」（用户直发档）/倒计时（外部档）+ 交互即暂停**。对话内富卡与 `SpendConfirmDialog` 居中弹窗共用同一明细组件（一语义两投影），样张两个宿主都要画且明细一致。出处：#194 §10 + 节 3E。

11. **附件/上下文架复用 `AttachmentRail` 视觉**：图片 48px tile / 文件 max-184px chip / uploading 盖 loading mark / failed 红边+「上传失败」/ remove 悬浮小圆钮。上下文架 chip 额外带 `intentRole` 副标题（「主体·角色定妆」）+ crop/timeRange/cameraPose 可读 + 「引用后已变化」态。出处：节 3A + #194 §13.2/§13.3。

12. **框选批量：一张卡 + 横向三页堆叠（最多露 3）+ `当前项/总数` + 键盘左右 + 可访问上一/下一钮**，公共批量控制在堆叠下方复用 `CanvasBulkModelSelect`（图片/视频分组、不每卡重复放供应商选择器）。复用 `CardStackPeeks.tsx` 现役堆叠。**批量卡（多个输入镜头）≠多候选卡（同一请求多结果）**，视觉要能区分。出处：#194 §9.4 + 节 3G。

13. **工作方式只 3 档（Ask/编辑选中/Agent），别画第 4 档**（12 条不一致里「私造 4 档」）；工作方式与批准策略是两根正交轴，样张若把它们并成一个选择器 = 错。composer 只选 Agent 文本模型，制作模型在计划卡/节点选。出处：#194 §14/§15 + S19。

14. **忙时队列（P0）要画**：agent 忙时输入框**不禁用**、回车入队（不静默丢弃），队列项在输入框上方显完整 `TurnDraft`（附件/引用/模式/权限图标回显），可编辑/删除/重排/暂停；折叠时显数量+是否暂停。区分 steer（纠正当前）vs nextTurn（下一条）。出处：#194 §4.1/§16 + S20。

15. **写入回执撤销要画 lost-edits 中间态**：「整笔撤销」若检测到用户改过提议节点，先列明将丢失的修改再等第二次确认。落点回报 chip（本笔落进哪些分类、非当前分类可跳转）。出处：`CommittedProposalCard.tsx` + 节 3C。

16. **prompt 选择器（规范外新增）要在样张里给它一个明确归宿**：现役已挪到发送键左边和模型选择器并排（用户 2026-08-18 拍板）。样张要么把它纳入 #194 词表（作为 composer L1 配置），要么明确它属于「发送前配置行」而非对话形态。别让它悬空。出处：`CreationPromptPicker` + 节 3I + 12 条不一致清单。

17. **两套动效纪律上样张**：等待类慢+低对比（breathe 1.8s/sweep 2.2s），状态跃迁快+明显（settle 420ms 描边勾/数字落定）；`prefers-reduced-motion` 全退化静态；暗色单独出一版验（#194 §7.3「本轮样张只验了亮色」是已知缺口，这轮补）。出处：#194 §7。

18. **别继承 `AssistantTimeline` 的 15-prop 接口**（#194 §11 点名删掉重做）；样张的组件应订阅 8 态 store，不是把 15 个 props 往下灌。出处：#194 §11 + 节 3I。

---

## 附：来源索引（全绝对路径 / URL）

- #194 规范：`git show origin/main:docs/design/nomi-agent-interaction.md`（本地树缺，取自 origin/main）
- #194 实现合同：`git show origin/main:docs/design/nomi-agent-interaction-implementation-contract.md`
- #194 样张：`git show origin/main:docs/design/mockups/2026-08-27-agent-conversation-vocabulary.html`
- 竞品交互文档（`/Users/aoqimin/Desktop/Nomi/docs/research/`）：`2026-08-24-agent-conversation-vocabulary-survey.md`（最贴用户所指，#194 直接引用）、`2026-08-24-agent-product-interaction-survey.md`、`2026-08-24-xiaoyunque-mode-interaction-study.md`、`2026-08-18-infinite-canvas-competitive-analysis.md`、`2026-08-19-conversational-creation-ux.md`、`2026-08-20-libtv-infinite-canvas-first-draft-competitive-research.md`、`2026-08-15-creation-agent-modes.md`
- 自家代码（`/Users/aoqimin/Desktop/Nomi/`）：`src/workbench/ai/composer/AttachmentRail.tsx`、`src/workbench/generationCanvas/components/AgentPlanCard.tsx`、`.../CommittedProposalCard.tsx`、`.../ReconcileDeviationCard.tsx`、`.../CanvasSelectionToolbar.tsx`、`.../CardStackPeeks.tsx`、`src/workbench/generationCanvas/spend/SpendConfirmDialog.tsx`、`src/workbench/taskCenter/TaskCenterPanel.tsx`、`src/ui/browser/dialog/`、`src/workbench/ai/CreationPromptPicker.tsx`、`src/workbench/ai/agentUsageStore.ts`、`src/workbench/ai/AssistantMessageView.tsx`、`src/workbench/ai/staleConversationDivider.tsx`
- AI Elements：https://elements.ai-sdk.dev/ · https://elements.ai-sdk.dev/components/attachments · https://elements.ai-sdk.dev/components/chain-of-thought · https://github.com/vercel/ai-elements · https://v6.ai-sdk.dev/elements
- Beautiful UI：https://www.beautifului.dev/ · https://www.beautifului.dev/license · https://github.com/slev12397/beautiful-ui
- 设计系统：`/Users/aoqimin/Desktop/Nomi/docs/design/nomi-design-system.md`
