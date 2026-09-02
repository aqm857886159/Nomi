# Agent 界面 v3.1 · 设计一致性验收断言清单（conformance testspec）

> 日期：2026-09-02 · 状态：✅ 测试规格定稿（随样张 v3.1 @4fe8f1cb 生效）
> 上游（真相源，本文只翻译不新裁）：`2026-09-02-agent-ui-v3-walkthrough.md`（逐屏定稿）· `2026-09-01-agent-ui-final-redesign.md`（21 形态）· `2026-09-01-agent-ui-redesign-decisions.md`（D1-D5）· `docs/design/mockups/2026-09-01-agent-ui-final-redesign.html`（交互参照，屏内可点行为以它为准）
> 断言框架：`tests/ux/_assert.mjs`（expectVisible / proveProbe+expectAbsent / waitForTurnIdle / applyColorSchemeForShot / readComputedColorChannels / screenshotSettled）· 方法论：`docs/qa/2026-09-01-agent-m0-red-lights.md`（**先红后绿**）

## 本 spec 是什么（实施班必读）

1. **这是验收合同**。实施 Agent 界面 v3.1 的每个 PR，必须把本文断言表逐条勾对账（勾 = 该断言已落进 walk/测试且跑绿）；P0 全绿是第一片实现的完成线，P1/P2 按分级节奏跟上（§5）。实现偏离样张 = 对应断言红 = 不许合。
2. **选择器是约定，不是猜**。§0 的 `data-agent-*` 属性是实施班**必须提供**的挂点（沿用现役先例 `AgentPlanCard.tsx:295` 的 `data-agent-plan-card`）。改名可以，但要同步改断言并在 PR 里说明——断言表和实现共享这份契约，谁也不许单方漂移。
3. **先红后绿**（红灯方法论）。每条 expectAbsent 断言必须先证明「这把尺子对旧世界会报红」，才配说「新世界没有」。红证两条路，缺一不可的是 ①：
   - ① **每次运行的阳性对照**：`proveProbe` 同屏对照物（`_assert.mjs` 强制 provenBy，防 [expect-absent-passes-too-early] 一族假绿——计数本来就是 0 时首采样即过）。
   - ② **一次性红夹具**：v2 样张 `git show c5777617:docs/design/mockups/2026-09-01-agent-ui-final-redesign.html` 里**确认含有**全部被删形态与全部禁用词（2026-09-02 实测：当前现场×2 / 结果卡区×9 / 过闸×1 / 校验分×1 / 阈值×1 / 看日志×1 / M 线×1 / 取证据×2 / 有对照×2 / tokens×4 / 本会话不再提示×1 / 队列×4 / 上下文架×3 / 「按 编剧」×2）。把反断言探针对它跑一遍、每条命中 ≥1 = 探针活着的存档证据（做成 node 测试常驻，扫描范围=样张 `.asst`/`.app` 子树，与生产扫描同构）。结构性旧物（过渡版真机）另有 `pr223-finish@46066ed0`（worktree `~/Desktop/Nomi-shell-mockup`）可做一次性红跑，红证按红灯清单格式记进 walk 文件头注释。
4. **夹具驱动，不烧真模型**。流式中/忙时/排队态断言必须由确定性夹具运行时驱动（现役先例 `tests/ux/agent-runtime-fixture.mjs` 一族）；真模型只用于 R16 体验走查，不进 conformance lane。
5. **词汇/几何扫描范围 = Agent 面板子树**（`[data-agent-panel]`），不是 document.body——用户自己打的字（气泡、@ 引用名、素材名）包在 `[data-user-content]` 整棵豁免（`_assert.mjs` scopedText 教训：全页文本会把 seed 数据算进去）。
6. **暗色单独验**。所有计算色断言用 `applyColorSchemeForShot`（生产路径四属性）翻主题、`waitForVisualQuiescence` 等 140ms transition 收尾后再读，比解析后的数值通道不比字面串（[walkthrough-computed-color-asserts] 两坑）。

---

## §0 选择器契约（实施必须提供的挂点）

| 挂点 | 属性（约定名） | 备注 |
|---|---|---|
| 面板根 | `data-agent-panel` | 所有扫描的作用域根 |
| 头部行 | `data-agent-header` | 唯一头部容器 |
| 用量胶囊 / 明细浮层 | `data-agent-usage-pill` / `data-agent-usage-popover` | popover 悬停才挂 |
| 历史 / 收起 | `data-agent-history` / `data-agent-collapse` | |
| 会话流 | `data-agent-flow`（role=log） | |
| 压缩线 / 展开链 | `data-agent-compaction-line` / `-expand` | |
| 阶段线 | `data-agent-stage-line` | |
| 用户气泡 | `data-agent-user-bubble` + 内容子树 `data-user-content` | |
| 技能载入事件行 | `data-agent-skill-event` | |
| 思考条 | `data-agent-thinking-line` + `data-state="running\|settled"` | |
| 正文回复 / 流式光标 | `data-agent-reply` / `data-agent-stream-cursor` | |
| 工具行 / 明细体 | `data-agent-tool-line` + `data-state="queued\|running\|done"` / `data-agent-tool-detail` | 同一行原地变态：`data-state` 变、节点不换 |
| 写入回执 / 撤销图标 | `data-agent-proposal-receipt`（沿用 #223 现名）/ `data-agent-receipt-undo` | |
| lost-edits 确认卡 | `data-agent-lost-edits-card` | |
| 落点胶囊 | `data-agent-landing-chip` | |
| 排队行 / 撤回 × | `data-agent-queue-row` / `data-agent-queue-remove` | 行，不是卡 |
| composer / 输入 | `data-agent-composer` / `data-agent-input` | |
| @ 选择器 / 句中 token | `data-agent-at-picker` / `data-agent-at-token` + `data-stale="true"`（变黄态） | |
| 底排五钮 | `data-agent-composer-attach\|-mode\|-model\|-prompt\|-send` | |
| 模型未选红点 | `data-agent-model-alert` | 挂在 `-model` 钮内 |
| 六张卡 | `data-agent-plan-card`（现役）/ `-spend-card` / `-deviation-card` / `-question-card` / `-candidates-card` / `-artifact-card` / `-failure-card` | |
| 固定结果卡 | `data-agent-pinned-card` + `data-open="true\|false"`；头 `-pinned-head`、摘要 `-pinned-summary`、体 `-pinned-body` | 屏 D |
| 顶栏 Agent 角标 / 新动静点 | `data-agent-topbar-badge` / `data-agent-badge-dot` | 屏 C |
| 节点浮条 / 节点角标 | `data-decon-node-stub` / `data-decon-node-badge` | 屏 C |
| tooltip 载体 | 统一挂 `data-agent-tip`（或可访问名 aria-label 同值） | 断言读它，不读 CSS ::after |

几何容差（全文通用，除非单条另标）：长度/坐标 **±2px**；行高类 **±4px**；「贴上沿」类间距 **≤8px**；旋转 **±5°**；计算色通道：oklch L ±0.03 · C ±0.02 · H ±6（其余色空间各通道 ±5%）。

---

## §1 逐元素断言表（主体 · 按走读文档屏序）

> 列义：**断言** = 怎么量（选择器/几何/计数/态变化）；**时机** = 静态（夹具 seed 后首屏）/ 悬停后 / 点击后 / 流式中 / 忙时 / 空闲 / 翻主题后。反断言（不该有的东西）集中在 §2，此表只写「该有的」。

### 屏 A · 主对话流

| # | 级 | 元素 | 设计承诺（一句） | 真机断言 | 时机 |
|---|---|---|---|---|---|
| A-01 | P0 | 头部一行 | 整个头只剩一行：N 标+Nomi · 用量胶囊 · 历史 · 收起 | `data-agent-header` 恰 1 个；其内可交互元素**恰为** {usage-pill, history, collapse} 三件；header 高度 ≤ 40px（单行证明）；文本含「Nomi」 | 静态 |
| A-02 | P1 | 用量胶囊 | 常驻只说「还能聊 ~N 轮」，明细悬停才出 | 静态：pill 文本匹配 `/还能聊 ~\d+ 轮/` 且 `data-agent-usage-popover` expectAbsent（阳性对照：悬停后它出现）；悬停后：popover 可见，含「本轮」「累计」「花费」三行、数字 `tabular-nums`（computed font-variant-numeric 含 tabular-nums） | 静态+悬停后 |
| A-03 | P0 | 压缩分隔线 | 收纳发生时一条细线「前面 N 轮已折叠 · 展开」 | 夹具 seed 折叠态：`data-agent-compaction-line` 可见、文本匹配 `/前面 \d+ 轮已折叠/`；`-expand` 可点 | 静态 |
| A-04 | P1 | 压缩线·展开 | 点「展开」原地翻开，不跳走 | 点击后：折叠轮次在**原位置**插入（compaction-line 的 y 不突变超过一行高；flow scrollTop 不归零）；展开链消失或变「收起」 | 点击后 |
| A-05 | P0 | 阶段分隔线 | 「进入 · 生产段」带工序图示的居中线，静态不动 | `data-agent-stage-line` 可见、含 SVG 图示子元素；无 running 动画（getAnimations() 在该子树为空或非 infinite 运行零个）——「同屏只有正在干活那行在动」 | 静态 |
| A-06 | P0 | 用户气泡 | 右对齐黑底气泡 | `data-agent-user-bubble` 右缘距 flow 右缘 ≤12px 且左缘 > flow 中线；计算背景色 ≈ `--nomi-ink` | 静态 |
| A-07 | P0 | 技能载入行 | 对话流内一行灰字小事件，非卡片，全面板技能唯一呈现处 | `data-agent-skill-event` 在 `data-agent-flow` **内**、恰 1 个；计算色 ≈ `--nomi-ink-40`（灰）；无边框无卡片底（border-width=0 且背景与 flow 底色同/透明）；高度 ≤ 一条工具行（28px±4）。**技能名（如「编剧·Kasdan」）在面板内出现次数 = 1**（header/composer/排队区 0 次——反断言 R-01/R-02 具体化） | 静态 |
| A-08 | P1 | 思考条（落定态） | 想完落成一句结果留在原地，可展开回看 | `data-agent-thinking-line[data-state=settled]` 可见、文本匹配 `/想了 .+ 秒/`、行尾 chevron 存在；点击后推理明细展开（明细容器可见），再点收起 | 静态+点击后 |
| A-09 | P1 | 思考条（进行→落定） | 进行时带计时，结束**原位落定不消失** | 夹具驱动 planning→done：同一元素（保存 elementHandle 或 data-id 断同一性）`data-state` 从 running 变 settled，**期间 count 恒 =1**（没有消失再出现）；running 期文本含计时 | 流式中 |
| A-10 | P0 | 正文回复 | 纯文字；流式中末尾有光标闪 | `data-agent-reply` 可见；流式中 `data-agent-stream-cursor` 可见，`waitForTurnIdle` 落地后 expectAbsent（阳性对照=流式中它在） | 流式中+空闲 |
| A-11 | P0 | 工具总览行（完成态） | 一轮的活收成一行「N 步 · … ▾」，点开逐步明细 | `data-agent-tool-line[data-state=done]` 单行可见、文本匹配 `/^\d+ 步 · /`、行尾 ▾；`data-agent-tool-detail` 初始 expectAbsent/不可见（阳性对照=点开后可见）；明细每步含 ✓ 与耗时 | 静态+点击后 |
| A-12 | P0 | 进行中行 | 转圈+一句话+已用时间+▾，同一行原地变态 | 夹具驱动 queued→running→done：**同一节点** `data-state` 三变，`data-agent-tool-line` 总数恒 1（不刷出三行）；running 期含 `/\d+:\d{2}/` 计时；无 `<progress>`/进度条元素（无百分比不画条——面板内 expectAbsent progressbar role；红证走 proveProbe 用法②：同 walk 先在真会出现进度条的现场（如任务中心/导出夹具）证明 role=progressbar 探针找得到，v2 红夹具没有此形态） | 流式中 |
| A-13 | P0 | 写入回执 + ↩ | 绿色回执「已加 N 个节点」+ 行尾 ↩ 图标撤销 | `data-agent-proposal-receipt` 可见、文本匹配 `/已加 \d+ 个节点/`、计算色 ≈ `--workbench-success-ink`；`data-agent-receipt-undo` 是 icon 钮（无文本节点）、tooltip=「撤销这一笔」 | 静态 |
| A-14 | P1 | lost-edits 确认卡 | **仅**撤销撞上手改时出现，列明会丢什么，再问一次 | 夹具 A（批内无手改）：点 ↩ → `data-agent-lost-edits-card` expectAbsent 且撤销直接执行（回执消失/画布节点计数-N）；夹具 B（批内有手改）：点 ↩ → 卡出现、warning 色边、文本列出具体改动、含「再想想」「仍要撤销」两文字钮（决定类保留文字，整改⑦豁免面）；provenBy=夹具 B 的出现 | 点击后 |
| A-15 | P1 | 落点胶囊 | 「N 张…在「X」分类 · 去看」，点了跳过去 | `data-agent-landing-chip` 可见；点击后画布/分类视图切到目标分类（断言分类容器激活态），对话滚动位置保持 | 点击后 |
| A-16 | P0 | 排队行 | 忙时发的消息=浅色行**贴输入框上沿**，可撤回 | 忙时（夹具 running）发消息：`data-agent-queue-row` 出现，`row.bottom` 与 `data-agent-composer.top` 间距 ≤8px；行内 `qdot+文本+×` 结构；计算无边框无卡底（border-width=0）；点 `-queue-remove` 后行数 -1；空闲时 expectAbsent（provenBy=忙时出现过） | 忙时+点击后+空闲 |
| A-17 | P0 | 忙时不禁用 | Nomi 忙时输入框照常可打字、回车即排 | 夹具 running 态：`data-agent-input` non-disabled、可聚焦、type 后值在；Enter 后 queue-row +1 且输入清空（P0 不静默丢弃） | 忙时 |
| A-18 | P0 | @ 引用 token | @ 是唯一引用手势；选完=句中小色块；素材变过=token 变黄 | seed 两 token：`data-agent-at-token` ×2 内嵌在输入内容行内（token 的 boundingBox 含于 input 区域）；蓝 token 计算背景 ≈ accent-soft、黄 token `[data-stale=true]` 计算背景 ≈ warning-bg 且 tooltip 解释「按现在的版本」 | 静态 |
| A-19 | P0 | 底排五钮全 icon | 📎⚡🤖✏️↑ 五颗、零常驻文字、悬停出含义 | `data-agent-composer` 内 button 恰 5 个（attach/mode/model/prompt/send 各 1）；**每颗的可见 innerText 为空**（icon-only；含义只在 `data-agent-tip`/aria-label）；高度 28px±1；悬停 mode 钮 → tooltip 文本匹配 `/Agent · /`（当前档回显） | 静态+悬停后 |
| A-20 | P0 | 🤖 未配置红点 | 没选模型=右上角小红点，不是一句常驻文字 | 夹具未配模型：`data-agent-model-alert` 可见、直径 ≤8px、位于 model 钮右上象限（点心坐标在钮 boundingBox 右上 1/4）、计算色 ≈ danger；tooltip=「去选文本模型」；配好后 expectAbsent（provenBy=未配态出现）+ tooltip 变 `/文本模型 · /` | 静态×2 态 |
| A-21 | P1 | 常驻区白名单 | 常驻可点收敛（账面 19→10），删的都是重复入口 | 常驻区（header+排队区+composer，**不含随流滚走的 flow**）内可交互元素（button/a/input/[role=button]/[tabindex≥0] 且可见）**⊆ 白名单** {usage-pill, history, collapse, queue-×(忙时), input, attach, mode, model, prompt, send}；白名单外出现任何可交互件 = 红。总数忙时 ≤10。（防复发主断言是白名单穷尽，不是总数字——口径之争别打在数字上） | 静态+忙时 |

### 屏 B · 六张决定卡（都在对话流里、决定完随流滚走）

| # | 级 | 元素 | 设计承诺 | 真机断言 | 时机 |
|---|---|---|---|---|---|
| B-01 | P0 | 计划卡 | 批级两颗参数药丸 + 每镜一行（勾选+名+描述）；改过的行标「已改 · 还原」；按钮说实话「生成已选（N 镜）」 | `data-agent-plan-card`：参数 pill 恰 2 颗且**文案无重复**（所有 pill 文本两两不同——v2「竖版」双现的防复发）；每行 = checkbox+序号+标题+描述；夹具改第 2 行 → 该行出现「已改」+「还原」；主按钮文本 `/生成已选（\d+ 镜）/` 且 N === 勾选 checkbox 数（勾/去勾后重读，N 跟着变） | 静态+交互后 |
| B-02 | P0 | 付费确认卡 | 单价逐项列清、合计加粗、冻结项明说、按钮带金额；agent 档**无**「不再提示」**无**倒计时 | `data-agent-spend-card`：每项行含 `/¥\d+\.\d{2}/`；合计行 font-weight ≥600 且金额 = 各项之和（脚本自算比对）；冻结句含「付费后就不能再改」与「提示词仍可改」；确认钮文本 `/确认并生成 ¥/` 且金额 === 合计；**expectAbsent**：卡内 checkbox 数 = 0、无 `/不再提示/` 文本、无倒计时元素（provenBy=红夹具 v2 卡含勾选框；D4 反选时删此两条并回补样张） | 静态 |
| B-03 | P0 | 有出入卡 | 只在结果跑偏时出现的黄边卡；每条出入=哪里→哪里+人话；三个出路 | 夹具 deviated：`data-agent-deviation-card` 可见、边框计算色 ≈ `--nomi-warning`；每条含 where（`X → Y`）+ 字段标签 + 人话句（无裸 id——§2 词汇闸兜）；按钮恰 3：「让 AI 修」「撤销这一步」「知道了」。夹具一致：expectAbsent（provenBy=deviated 夹具出现）——**全对上时永不出现** | 静态×2 态 |
| B-04 | P1 | 反问卡 | 一次一问、选项竖排带序号、可键盘 1/2/3、角标「1 / N」、可跳过 | `data-agent-question-card`：可见问题文本恰 1 个（多问不同时摊开）；选项为竖排 button（各选项 boundingBox x 相同、y 递增）且带序号；分页文本 `/1 \/ \d/`；「跳过」存在；按键 `2` → 第 2 项进选中态；选完点下一问 → 分页变 `/2 \/ \d/` 且问题文本变 | 静态+交互后 |
| B-05 | P1 | 多候选卡 | 几版并排、点缩略图即选、无翻页钮、「采用 X 版」才动画布 | `data-agent-candidates-card`：候选 ≥2 并排（y 相同）；**expectAbsent**「上一个/下一个」按钮（provenBy=红夹具 v2）；点第 2 张缩略图 → 其选中态类/勾标出现、第 1 张褪掉；主按钮文本随选中变（「采用 B 版」）；采用前画布节点数不变（夹具读画布 store），点采用后 +1 | 静态+交互后 |
| B-06 | P0 | 产物卡 | 标题行=名+尺寸+「第 N 版」+动作（✏⟳ icon + 去画布文字钮）；**任何按钮不压图** | `data-agent-artifact-card`：头行含 `/\d+×\d+/` 与 `/第 \d 版/`；动作区 2 icon 钮（无文本）+1 文字钮「去画布」；**几何**：每个动作钮的 boundingBox 与缩略图 boundingBox 交集面积 = 0 | 静态 |
| B-07 | P0 | 失败卡 | 红边、人话原因、绿字明说「这次没扣钱」（或已扣多少）、三条出路 | `data-agent-failure-card`：边框计算色 ≈ `--workbench-danger`；含 `/这次没扣钱|已扣 ¥/` 且该句计算色 ≈ success（没扣钱时）；按钮恰 3：「换模型重试」「改提示词」「看详情」（「看日志」在 §2 词汇闸里禁） | 静态 |
| B-08 | P2 | 卡内零注释 | 设计注释全部挪出卡外，卡里只剩用户用得上的 | 六卡子树内 expectAbsent 设计注释类文本（探针=红夹具 v2 卡内注释 5 处）；每卡可见操作数对账：plan 2 / spend 2 / deviation 3 / question ≤5 / candidates 1 / artifact 3 / failure 3（超出=红） | 静态 |

### 屏 C · 右栏换班（过渡期形态——拆解 v1 与双区外壳落地节奏见决策 D2）

| # | 级 | 元素 | 设计承诺 | 真机断言 | 时机 |
|---|---|---|---|---|---|
| C-01 | P0 | 互斥 | 同一时刻右栏只住一个 | Agent 面板与拆解面板可见性异或：两者同时可见 = 红（store 同事务互翻；轮询采样 10 次无「双开」中间帧） | 交互后 |
| C-02 | P0 | 拆解让位 | 收成源节点浮条「拆解结果 · N 镜」+ 节点角标「✓ 已拆解 · N 镜」；点浮条表回来 | Agent 进驻后：`data-decon-node-stub` 与 `-node-badge` 可见、文本匹配 `/拆解结果 · \d+ 镜/`；点浮条 → 拆解表可见、Agent 收起 | 交互后 |
| C-03 | P0 | Agent 让位 | 收成顶栏角标「● 进行中」，新动静冒蓝点；点角标对话回来 | 拆解进驻后：`data-agent-topbar-badge` 在顶栏右簇可见；夹具触发新回复 → `data-agent-badge-dot` 出现、计算色 ≈ accent；点角标 → Agent 面板可见、badge 消失 | 交互后 |
| C-04 | P0 | 收起≠清空 | 勾选、滚动位置、进行中任务，换班回来原样都在 | 换班前记录：拆解表勾选集合 S、scrollTop=y、running 任务 id；切走再切回：勾选集合 === S、|scrollTop−y| ≤2px、running 任务仍在跑（状态非重置） | 交互后 |
| C-05 | P2 | 换班动效 | 260ms 滑入滑出，不闪跳 | 切换期测面板 transform/opacity transition-duration ≈ 260ms（读 computed transition）；`waitForVisualQuiescence` 300ms 级收尾（不做逐帧断言，帧级观感走 R13 人眼） | 交互后 |

### 屏 D · 终局：细条固定在上、对话在下

| # | 级 | 元素 | 设计承诺 | 真机断言 | 时机 |
|---|---|---|---|---|---|
| D-01 | P0 | 头部 | 与屏 A 完全一样 | 复用 A-01/A-02 同一断言函数跑一遍（不是复制粘贴两份口径） | 静态 |
| D-02 | P0 | 细条（默认收起） | 「📌 拆解结果 · N 镜 · 已选 N ▾」一行常驻、不随聊天滚走、高≈一条工具行 | `data-agent-pinned-card[data-open=false]` 默认；头部行高 28px±4 且与 `data-agent-tool-line` 行高差 ≤6px；含 pin 图示 + `/拆解结果 · \d+ 镜 · 已选 \d+/`；**固定性**：flow 滚到顶/底，细条 boundingBox.y 不变（±2px） | 静态+滚动后 |
| D-03 | P0 | 摘要实时 | 「几镜/已选几」常驻可见、勾选变了跟着变 | 展开勾/去勾一行 → `data-agent-pinned-summary` 的「已选 N」±1；**收起后**摘要仍显新值 | 交互后 |
| D-04 | P0 | 展开⇄收起 | 点细条全表展开（封顶≈45% 视口、表内滚）；再点收回；收起只是收起 | 点头 → `data-open=true`、`-pinned-body` 可见；**几何**：卡总高 ≤ 面板高 × 0.50（45%+容差）；表格容器 scrollHeight > clientHeight 时可滚（overflow-y 生效）；再点 → body 不可见；**状态保持**：展开态勾选集合与表内 scrollTop 在收起→再展开后不变（collapse≠unmount 的可观测面） | 点击后 |
| D-05 | P0 | 展开表内容 | 每镜=勾选+缩略图+名+时间+描述+字幕；坏镜红字「这镜没读出来 · 可单独重试」；脚=起稿/已选 N/加入画布 (N) | 行结构逐项断言；坏镜行含该文案、计算色 ≈ danger、有单独重试可点；脚部三件齐且「加入画布 (N)」的 N === 勾选数 | 静态 |
| D-06 | P0 | 同一张卡 | 节点浮条与对话工具行指向**同一张**固定卡，绝不各开一张 | 从浮条进入与从工具行「看结果」进入：`data-agent-pinned-card` 总数恒 =1；两路操作后的勾选状态互通（在 A 路勾、B 路看得到） | 交互后 |
| D-07 | P0 | 下方对话与 composer | 工具行同款一行式；占位「输入 @ 可以引素材或技能」；🤖 已配置=无红点 | 工具行断言复用 A-11；`data-agent-input` placeholder 含「@」提示；`data-agent-model-alert` expectAbsent（provenBy=屏 A 未配态） | 静态 |

---

## §2 九条整改的反断言（防复发面 · 每条 = expectAbsent + 红证）

> 通则：每条运行时反断言必须带 `provenBy`（§0 头注 ③）；每条另有**静态词汇/结构闸**在源码层拦（见 §2.2）。红夹具 = v2 样张 @c5777617（已实测全部命中，见头注）。

### §2.1 结构反断言

| # | 级 | v2 被删物 | expectAbsent 断言（作用域=`data-agent-panel`） | 红证（provenBy） |
|---|---|---|---|---|
| R-01 | P0 | 常驻技能标记（header「按 编剧·Kasdan」pill，v2 形态 21） | header 子树内技能名文本计数 = 0；`data-agent-header` 内无 accent pill 类元素含技能名 | ①同屏 proveProbe：flow 事件行找得到技能名；②红夹具 v2 header 含「按 编剧」 |
| R-02 | P0 | composer 上方常驻技能 chip 区（v2 形态 19） | flow 末尾至 input 之间（排队区除外）无任何 chip/pill 元素；技能名在面板内总计数 = 1（只在 `data-agent-skill-event`） | 同 R-01；红夹具 v2 架上 chip |
| R-03 | P0 | 引用架（定妆槽/素材 chip/加号，对话外专用槽） | composer 子树内、input 行之外无引用 chip 容器；`[data-agent-reference]`（过渡版旧挂点，#223 `:727`）全面板计数 = 0 | ①proveProbe：input 内 `data-agent-at-token` 找得到（引用活在句中）；②pr223 红跑：旧壳该属性 >0 |
| R-04 | P0 | 任务队列卡（带编号+编辑/上移/下移/暂停管理钮） | 排队区无 card 容器（`data-agent-queue-row` 计算 border-width=0、无独立背景卡）；面板内「上移/下移/暂停」可交互元素计数 = 0；排队区可点只有 ×（A-21 白名单兜底） | ①proveProbe：queue-row 本体找得到；②红夹具 v2 队列卡 |
| R-05 | P0 | 工具面板区（带边框底色的 toolgroup 盒） | `data-agent-tool-line` 计算 border-width=0 且背景 ≈ flow 底色（非面板色块）；工具明细不在独立固定区（`-tool-detail` 是 flow 内 `-tool-line` 的兄弟/子节点，随流滚动） | ①proveProbe：tool-line 找得到；②红夹具 v2 toolgroup |
| R-06 | P0 | 界面内部术语 | 运行时词汇闸：面板子树可见文本（含 title/aria-label/placeholder）对 §2.2 禁用词表零命中（`[data-user-content]` 豁免）——做成 `expectNoForbiddenVocab(win, root)` 加进 `_assert.mjs`，与 `expectNoCjkInEnglishDom` 同构 | 红夹具 v2 `.asst` 子树逐词命中 ≥1（常驻 node 测试） |
| R-07 | P1 | 文字版撤销钮（回执行里的「撤销」文字） | `data-agent-proposal-receipt` 子树内可见文本无「撤销」（撤销只以 ↩ icon+tooltip 存在；lost-edits 卡的「仍要撤销」是决定钮、**不在**此作用域） | ①proveProbe：`-receipt-undo` icon 找得到；②pr223 红跑旧回执文字钮 |
| R-08 | P0 | chrome 废字（agent 头部项目名/「当前现场」/「结果卡区」标签） | seed 项目名「雨夜追逐」：顶部 app 栏找得到它（阳性对照），`data-agent-header` 子树内计数 = 0；「当前现场」「结果卡区」按 §2.2 词汇闸拦 | ①同屏双探针（app 栏有/header 无）；②红夹具 v2 两词均在 |
| R-09 | P1 | 认知负荷回胖 | A-21 白名单穷尽断言 + B-08 各卡操作数上限 + A-19 底排零文字 + D-02 细条默认收起——四条合起来就是⑨的防回胖闸；任何新常驻控件/新卡内按钮想进来，必须先改本 spec（= 过设计系统 §1.5 层级审判），否则当场红 | 各自条目的红证 |

### §2.2 UI 文案禁用词表（词汇闸 · 整改⑥全量）

> 双层执行：**运行时** R-06 扫面板 DOM；**静态** `scripts/check-agent-vocab.mjs`（新增门岗，agent 界面组件源 + locales agent 命名空间，基线 0、只准 0）。作用域=Agent 界面 UI 文案；代码标识符/注释/日志不在此列。`[data-user-content]` 豁免。

| # | 禁用词（正则） | 为什么禁 / 该说什么 |
|---|---|---|
| V-01 | `当前现场` | chrome 废字（整改⑧），删无替 |
| V-02 | `结果卡区` | 区域标签（整改⑧），📌 自说明，删无替 |
| V-03 | `过闸` | → 「付费后」 |
| V-04 | `校验分` | 删；直接说哪里不一样 |
| V-05 | `阈值` | 删；同上 |
| V-06 | `日志`（按钮/链接文案） | → 「看详情」 |
| V-07 | `原位` | 内部话，说人话描述位置 |
| V-08 | `M 线|（M 线后）|\(M 线后\)` | 内部里程碑名（屏 C v2 残留） |
| V-09 | `取证据|本地取证据|有对照` | 内部 QA 话（屏 C v2 chips） |
| V-10 | `\btokens?\b` | → 「字符量」（用量明细） |
| V-11 | `上下文`（用量胶囊/popover 文案） | → 「这轮对话还能聊多久」 |
| V-12 | `\bv\d+\b`（版本裸码，如 v2） | → 「第 N 版」（产物卡）。模型名里的数字（seedream 4.0 / K2）不命中该正则 |
| V-13 | 裸 id / `节点 №` / `№` / 机器 id 形态（`gen-v2-[\w-]+`、`op-[\w-]+` 等） | 有出入卡等处「不甩原始 id」，用标题称呼事物 |
| V-14 | `本会话不再提示`（agent 受理档付费卡内） | D4：agent 自动花钱每次必问；该开关只属用户直发档（作用域=`data-agent-spend-card`） |
| V-15 | `确认全部` | 计划卡按钮诚实化 → 「生成已选（N 镜）」 |

> 维护规矩：往表里加词 = 改本文件 + `check-agent-vocab.mjs` 的 RULES 同步（规则清单以脚本为准，别在文档里数条数——R17 同款纪律）；每加一词必须先在红夹具或旧 UI 上证明它命中过（先红后绿）。

---

## §3 交互行为断言（样张里「真的可以点」的每一处）

| # | 级 | 行为 | 断言 | 坑位提示 |
|---|---|---|---|---|
| X-01 | P1 | 工具行展开/收起 | 点 `data-agent-tool-line` → `-tool-detail` 可见、chevron 计算 transform 旋转 ≈180°（±5°）；再点 → detail 不可见、chevron 复位。展开不改变 flow 滚动锚定（底部锚定仍在最新一轮） | 读 computed transform matrix 判角度，别比 class 名 |
| X-02 | P0 | 细条⇄全表 | D-04 全套 + 展开动画收尾后再量高（`waitForVisualQuiescence`）；28px/45vh/勾选保持三件各自独立报错信息 | 高度封顶量的是**安定后**；动画中途量会假红 |
| X-03 | P1 | @ 选择器→句中 token | 输入 `@` → `data-agent-at-picker` 出现、含素材/技能分组；选一项 → picker 收、`data-agent-at-token` +1 且 token 在光标句内；删除 token（退格/点 ×）→ -1；素材/角色/片段/技能四类都从这一个手势出（picker 内四类都能找到） | picker 是弹层，注意单例 Modal 退场动画（[expect-absent] 属性先没、还在画）——收起断言用 expectAbsent 的保持窗口 |
| X-04 | P1 | token 变黄 | 夹具把已引用素材改一版 → 对应 token `data-stale=true`、计算背景从 accent-soft 变 warning-bg（比通道）；悬停 tooltip 说「发送时会用现在这一版」 | 比解析通道不比字面串 |
| X-05 | P0 | 🤖 红点两态 | A-20 全套：未配 → 红点+「去选文本模型」；点开选完 → 红点 expectAbsent + tooltip 变 `/文本模型 · /` | 红点消失用保持窗口（provenBy=未配态） |
| X-06 | P1 | tooltip 悬停 | 五颗底排钮逐颗：悬停前 tooltip 内容不可见（computed opacity ≤0.01 或不存在）、悬停后可见且文本与 §0 约定含义一致；移开后收 | 样张是 CSS ::after 实现，生产约定 `data-agent-tip`/aria-label——断言读属性值+可见性，不猜实现 |
| X-07 | P1 | 排队全链 | A-16/A-17 全套 + **到点自动进对话**：夹具让当前轮落地 → 队首行消失、flow 末尾出现同文本的用户气泡（自动执行）、queue 计数-1 | waitForTurnIdle 判落地，别用固定 sleep |
| X-08 | P1 | 撤销双确认 | A-14 两夹具 + 点「仍要撤销」→ 整批节点退掉（画布 store 节点数回落）+ 回执行进撤销完成态 | |
| X-09 | P1 | 反问卡键盘 | B-04 的按键路径：焦点在卡内时按 `1/2/3` 选中对应项；答完最后一问 → 卡进已答态、对话继续 | |
| X-10 | P1 | 光暗双模翻转 | `applyColorSchemeForShot('dark')` → `waitForVisualQuiescence`（140ms transition + settle）→ 抽查五组代表元素计算色 ≈ 暗色 token 表（§2 状态色表的暗列：受击 accent oklch(0.7 0.12 250)、success #7ee8aa、danger #ff6961、warning oklch(0.78 0.13 75)、中性 ink-40 oklch(0.62 0.012 85)）；翻回 light 再验一遍（两向都验，不许只验亮色） | [walkthrough-computed-color-asserts]：oklch/oklab 序列化 + 140ms 插值帧两坑；必须走生产四属性路径翻主题 |
| X-11 | P2 | 单点扫光 | 流式中面板内 running 的**有限**动画（排除 infinite 转圈）关联的扫光元素 ≤1（多任务并行只当前活跃条动） | waitForVisualQuiescence 的 isTransient 判据同款 |
| X-12 | P2 | 状态色只 5 组 | seed 全态转录（drafting/queued/running/done/failed/deviated/付费/反问）：收集所有状态指示元素计算色，聚类后每色 ∈ 5 组 token 集（出现第 6 种 = 红） | 审计型断言，允许离线跑（截图+脚本后分析） |
| X-13 | P1 | 屏 C 换班全链 | C-01…C-04 全套（互斥/浮条/角标/状态保持） | 依赖拆解 v1 真机面板；落地前此组 skip 并在 walk 里标 TODO+阻塞原因（不许静默绿） |
| X-14 | P2 | 回到最新 | flow 满屏后新消息到达：若用户已上滚，出现「回到最新」控件、点击滚到底；若本就在底，自动跟随 | 过渡版已实现（role=log），回归断言 |

---

## §4 分级与执行车道

| 级 | 定义 | 完成线 | 车道 |
|---|---|---|---|
| **P0** | 形态存在性 + 全部反断言（R-01…R-06、R-08）+ 词汇闸 + 关键语义（忙时不丢消息 A-17、付费卡诚实面 B-02、同一张卡 D-06） | **实施第一片就得绿**——第一个实现 PR 的合并前提 | CI walkthrough lane（夹具驱动 Electron，零额度）；词汇闸另有静态门岗 `check:agent-vocab` 进 gates 链 |
| **P1** | 交互行为（展开/收起、@、红点、排队链、双确认、反问、换班、双模） | 对应交互落地的那个 PR 内同批绿 | 大部分 CI lane；X-13（屏 C）依赖拆解 v1 真机面板，落地前 skip+标注 |
| **P2** | 几何/动效细节（260ms、单点扫光、5 组色审计、卡内注释数、回到最新） | 开闸（agentHostEnabled 翻真）前全绿 | 混合：X-05/X-11/X-12 CI 可跑；C-05 动效观感、工序图示动画质感、tooltip 手感走**真 Electron 手跑 + R13 截图人眼**（断言只兜可量化面，好不好看机器判不了） |

**必须真机手跑（不进 CI）的清单**：C-05 换班动效观感；A-05 工序图示动画（受管动效资产的动作/时长质感）；X-06 tooltip 出现时机手感（500ms 延迟体感）；全屏光暗对账截图（`screenshotSettled` 产证据、人眼 Read）。其余全部 CI-able。

**walk 文件布局（实施班照建，全部走 `_assert.mjs`、过 `check:walkthroughs` 门岗）**：
- `tests/ux/agent-conformance-flow.walk.mjs` —— 屏 A（A-01…A-21 + R-01…R-08 + X-01/03/04/05/06/07/08）
- `tests/ux/agent-conformance-cards.walk.mjs` —— 屏 B（B-01…B-08 + X-09）
- `tests/ux/agent-conformance-pinned.walk.mjs` —— 屏 D（D-01…D-07 + X-02）
- `tests/ux/agent-conformance-handoff.walk.mjs` —— 屏 C（C-01…C-05 + X-13，拆解 v1 落地后启用）
- `tests/ux/agent-conformance-theme.walk.mjs` —— X-10/X-12（双模 + 色审计）
- `scripts/check-agent-vocab.mjs` + `tests/…/agent-vocab-redfixture.node-test.mjs` —— §2.2 静态闸 + v2 红夹具常驻证明
- 各 walk 头注释记红证（红灯清单格式：复现命令 + 红输出 + 绿判据）

---

## §5 实施对账用法（合同执行）

1. 实施 PR 描述里贴本文断言 ID 清单，逐条勾（绿 = 勾 + walk 文件名）；未勾的 P0 = PR 不收。
2. 选择器改名 / 断言口径要动 → **先改本文**（同 PR），评审看得见「合同改了哪条、为什么」；样张级形态变化仍走用户拍板（R8），本文只随拍板结果更新，不自立裁决。
3. 开闸（agentHostEnabled 默认翻真）前置条件（对齐 [agent-host-flag-gate-conditions]）：P0+P1+P2 全绿 + EN-DOM 网过（`expectNoCjkInEnglishDom`，agent 面板 en 局部走查）+ R16 真实任务闭环走查完成。
4. C9/D5 删旧对账：开闸 commit 里 `pr223` 过渡版的 4 档工作方式契约、互斥标志、`[data-agent-reference]` 引用架挂点必须同 commit 删净——R-03 的 pr223 红跑在删净后转为恒绿的存在性证明（旧挂点全仓 grep = 0）。

**实施最容易漂的三个点（评审重点盯）**：
1. **「同一行原地变态」偷懒成三行刷屏**（A-12/A-09）——React 里最省事的写法就是按事件各渲一行；断言钉的是节点同一性，不是文案。
2. **细条「收起只是收起」做成卸载重挂**（D-04/C-04）——勾选/滚动丢失当场红；collapse≠unmount 是可观测契约，不是实现建议。
3. **词汇/常驻件从缝里回渗**（R-06/A-21）——新功能顺手加一颗常驻钮、错误信息里甩一个内部词，都是白名单/词表当场红；想加，先过设计系统 §1.5 + 改本 spec。
