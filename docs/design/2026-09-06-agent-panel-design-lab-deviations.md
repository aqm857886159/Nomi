# Agent 面板 · 现役 ↔ 设计文档不一致清单（第一批）

> 日期：2026-09-06 · 状态：📋 **只列不改**（改是下一刀，等用户看过接触表再定优先级）
> 取证方式：设计实验室 `design-lab.html?screen=agent-panel`，45 个状态逐格用真实 React 组件 + 固定夹具渲染，人眼逐格比对设计文档。
> 接触表（拍板用 · 本轮快照已入库）：`docs/design/2026-09-06-agent-panel-contact-sheet.png`
> 走查现产（每次跑都会重生成，`tests/ux/shots/` 不入库）：`tests/ux/shots/design-lab-agent-panel/_contact-sheet.png`
> 逐格 PNG：`tests/ux/shots/design-lab-agent-panel/<state-id>.png`
> 视觉基线：`tests/ux/design-lab/__baselines__/agent-panel/<state-id>.png`（`pnpm run check:design-lab` 逐像素守）
> 对照的设计真相源：`2026-09-01-agent-ui-final-redesign.md` §4（21 形态）·
> `2026-09-03-agent-ui-p0-exception-states-walkthrough.md`（17 件 P0 异常态）·
> `2026-09-02-agent-ui-conformance-testspec.md`（A-/B-/R- 断言编号）

## 先看一个数

45 个状态里，**只有 13 个**是「现役面板整条通」（Host 数据 → 面板真的渲染出这个形态）；
**29 个是「只有组件」**——组件写好了，但 `ProjectAgentResidentShell` 里没有任何一条数据路径会让它出现在面板上；
2 个「设计要求而现役一行代码都没有」；1 个「设计已取消，基线用来钉死它确实不在」。

这个 13 : 29 就是本轮最大的结论：**Agent 界面的问题不是「组件没做」，是「做好的组件接不进对话流」。**
六张决定卡（计划/付费/有出入/反问/多候选/产物）全在 `ResidentExceptionStates.tsx` 里活着，
面板一张也渲染不出来。下一刀该先修这条接线，而不是继续画新组件。

---

## A 类 · 缺整件（设计要求，现役没有）

| # | 形态 | 差在哪 | 依据 | 实验室状态 |
|---|---|---|---|---|
| A1 | 形态 4 · 思考条（进行中） | turn 在 running 时面板**不出思考条**：没有工序图示、没有片场话、没有「已等 0:04」计时。只多出一条「进行中 / 排队 / 插队 / 立即中断」控制行。现役 `ResidentThinkingState` 只挂在 `planningTurn` 上，普通 running turn 走不到 | §4 形态 4 | `form-04-thinking-running` |
| A2 | 形态 4b · 思考条（落定态） | planning 结束即消失，未原位落定成「想了 4 秒 · 拆成 5 镜，2 镜要站位参考 ▸」。这是 #194 C6 点名的落定纪律 | §4 形态 4 + C6 | `form-04b-thinking-settled` |
| A3 | 形态 5 · 阶段分隔线 | 「进入 · 生产段」带工序图示的居中线，现役一行代码都没有 | §4 形态 5 + C5 | `form-05-stage-line` |
| A4 | 形态 9 · 付费确认卡**正常态** | `ResidentSpendCard` 只实现了「价格算不出」那一态：边框恒为 `border-workbench-danger`，按钮恒为「重新获取价格 / 仍要生成」。B-02 要的逐项单价、加粗合计、冻结句「付费后就不能再改」、「确认并生成 ¥12.50」按钮，一样都没有 | B-02 · §4 形态 9 | `form-09-spend-card` |
| A5 | 形态 13 · 产物缩略卡**正常态** | `ResidentArtifactCard` 只有 `loading` 与「非 loading = 失败」两条分支：`state="ready"` 渲染出来是红框 + 「生成失败」。正常缩略卡不存在 | B-06 · §4 形态 13 | `form-13-artifact-card` |
| A6 | 形态 2 · 压缩分隔线 | 现役 `staleConversationDivider` 只有一句「以上对话 AI 已不再记得」，没有「前面 N 轮已折叠」的轮数，也没有「展开」链 | A-03 / A-04 | `form-02-compaction` |

## B 类 · 有但对不上（形状、文案或数字错）

| # | 形态 | 差在哪 | 依据 | 实验室状态 |
|---|---|---|---|---|
| B1 | 形态 6 · 工具条 | ≤20 步时总览行文案是**「工具调用 · 2」**（`toolCallsCount`），不是「2 步 · 读剧本 · 拆 5 镜 ▾」。>20 步时文案反而是对的（`toolCallsLong`）。且「工具调用」是内部术语，过不了 v3 整改⑥的词汇闸 | §4 形态 6（v3 整改⑤）+ A-11 | `form-06-tool-line` |
| B2 | 形态 10 · 写入回执 | 现役是灰蓝的「已批准 … 已完成 ↩」；A-13 要的是绿色「已加 N 个画面」。**没有数量、没有 success 色** | A-13 | `form-10-receipt` |
| B3 | 固定结果卡 · 两个「几镜」打架 | 同一行并排显示「拆解结果 · **5 镜**」和「共 **2 镜** · 已选 2」。前者来自 `record.summary`，后者来自 `summaryLabel(watchNodes.length, …)`——总数取错了源（应取 `stepLabels`/`categoryCounts`，`watchNodes` 只是抽样） | D-02 / D-03 | `form-10-receipt`、`live-03-pinned-result` |
| B4 | P0 件 7 · 有出入卡折叠尾 | 折叠行复用了 `moreLabel`，显示「还有 **7** 处」（总数）。设计要的是隐藏数「还有 **2** 处 ▾」。一个 prop 同时当标题和折叠尾用，两种语义撞在一起 | 2026-09-03 走读 族1 件 7 | `p0-07-deviation-many` |
| B5 | P0 件 11 · 价格行标签 | 合计行左侧印的是 `failureReason`（「暂时算不出价格」），右侧「暂时无法获取」——同一句话说了两遍，而「合计」这个标签没有地方放 | 2026-09-03 走读 族2 件 11 | `p0-11-price-failed`、`form-09-spend-card` |
| B6 | P0 件 10 · 计划失败卡 | 标题和正文都印同一句 `failureReason`；下面还留着一个空的 `bg-nomi-ink-05` 灰块（本该是镜头列表的位置） | 2026-09-03 走读 族2 件 10 | `p0-10-plan-failed` |
| B7 | P0 件 5 · 排队默认展开 | `queueExpanded` 初值是 `true`，5 条排队全摊开。设计要的是**默认只显示前 3 条** + 「还有 2 条排队」折叠行 | 2026-09-03 走读 族1 件 5 | `p0-05-queue-many` |

## C 类 · 多出来的（设计没有、认知负荷账上没算过）

| # | 位置 | 多了什么 | 依据 | 实验室状态 |
|---|---|---|---|---|
| C1 | 排队行 | 每行一个 `⋮` 菜单，展开是**编辑 / 上移 / 下移 / 暂停 / 删除**五颗 icon。R-04 明写「面板内『上移/下移/暂停』可交互元素计数 = 0」，A-21 白名单里也只有 `queue-×` | R-04 / A-21 | `form-11-queue-one`、`form-18-queue-list` |
| C2 | 排队区 | 多一条常驻控制行「进行中 · 排队 / 插队 / **立即中断**」。这是 v3 整改④删掉的「任务队列卡」的残留：设计的排队区只有「浅色行 + × 撤回」 | §4 形态 18（v3 整改④）· R-04 | `form-11-queue-one` |
| C3 | 头部 | 多一颗带 title 的 `BETA` 徽标。A-01 要求 header 内可交互元素**恰为** {usage-pill, history, collapse} 三件；这颗徽标可 hover 出 tooltip，设计文档一处都没画过它 | A-01 | `form-01-usage` |

## D 类 · 结构性（不是某一格的事）

| # | 问题 | 说明 | 实验室状态 |
|---|---|---|---|
| D1 | **事件不进对话流** | 技能载入行和工具条是整块渲染在 `items.map` **之前**、钉在流顶的；用户气泡永远排在它们下面。于是「这个技能是第几轮载入的」「这批工具跑在哪句话之后」在界面上读不出来。这直接违反 v3 总纲「一切事件进对话流」 | `form-06-tool-line`、`form-20-skill-event` |
| D2 | **折叠阈值按字符数，不按行数** | `ResidentFoldableText` 判「长」的条件是 `行数>3 或 字符数>360`。340px 面板里 262 个中文字约 13 行，却判成「不长」，于是被 `h-5 overflow-hidden` **裁成一行，且不给展开口**——内容彻底看不到、也没有任何提示。设计说的是「超过 3 行」。**本轮最严重的一条** | `live-07-fold-midlength`（46px 一行）对照 `p0-01-bubble-long`（106px 三行+展开链） |
| D3 | **六张决定卡接不进面板** | 计划 / 付费 / 有出入 / 反问 / 多候选 / 产物六卡的组件都在 `ResidentExceptionStates.tsx` 里，`ProjectAgentResidentShell` 没有任何一条 Host 数据路径会渲染它们。实验室只能以 `piece` 档单摆。接触表上 29 格「只有组件」就是这条的量化 | 全部 `component-only` 格 |
| D4 | **介入槽默认强调「本次会话」** | `live-01` 里深色主按钮是「本次会话」，「这一次」退成次要；拒绝理由输入框和「× 不要」还常驻展开着，不是渐进披露。批准范围的默认档与「认知负荷最低」原则都指向「这一次」为主 | `live-01-intervention-approval` |
| D5 | **现役有三件设计文档里没有的形态** | 介入槽（`InterventionSlot`，#511）、收起坞（`ResidentCollapsedDock`，#514）、空面板首启态。21 形态表里都没有它们的位置，需要补进设计文档，否则下次重做又会漏 | `live-01`/`live-02`、`live-06-empty-panel` |

---

## 怎么用这份清单

1. **先看接触表**（`_contact-sheet.png`），拍板哪几条先修、哪几条先放着。
2. 修的时候：改完跑 `pnpm run design-lab:walk` 看新截图 → 给用户看 → 拍板后 `pnpm run design-lab:update` 更新基线 → PR 里附前后对比。
3. 不修的条目留在这里，不要删——它是下一轮的输入，也是「我们知道它不对」的证据。
