# D2 新付费卡：指向元素 P1 + 一张卡一颗「生成」Q1 · 设计卡 + 功能全表

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

日期：2026-10-23。线：I-d2（实现）。基线：`origin/main` @ `021cef0b9`。
拍板：用户 10-23 在 Claude Design 画布「指向元素与付费确认卡 D2 样张」第二版上选 **P1 镜像小卡 + Q1 一张卡一颗「生成」**，P2 行内标签作 P1 的窄屏 / 行内形态（同一个零件两种密度）。P3、Q2、Q3 不做。连带四题（§三）10-23 已定：Q1 去掉一镜 = 指向元素上的「不生成 ×」（可撤回）；Q2 钱照 10-08「界面不谈钱」；Q3 一台发动机（点「生成」逐节点走画布单节点提交）；Q4 / Q5 / Q8 按推荐。
规则依据：`docs/design/nomi-design-system.md` §1.0「一个东西一个家 / Agent 只指路」（10-22 用户拍板），`docs/design/2026-10-08-approved-designs.md` §⑪。
拍板清单：[`docs/design/boards/2026-10-23/NodePointer.board.json`](../design/boards/2026-10-23/NodePointer.board.json)（指向元素）、[`docs/design/boards/2026-10-23/SpendCardQ1.board.json`](../design/boards/2026-10-23/SpendCardQ1.board.json)（付费卡）。

分三步、三个 PR：

| 步 | 内容 | 前置 |
|---|---|---|
| ① | 本文（设计卡 + 现有付费卡功能全表）+ 两张拍板清单（docs only） | 无 |
| ② | 指向元素做成所有聊天卡共用的生产组件（P1，含 P2 窄 / 行内形态），设计实验室搭全状态；**不接进聊天** | ① 合入 |
| ③ | 新付费卡接进聊天：卡 = 指向元素 + 一句话 + 「生成」；确认只按节点当前参数花钱；删卡账本、删重绑定、价格读节点；同一 PR 删旧实现 | ② 合入 + **#1269 合入** + §3 待拍板项有答案 |

## 开工三问

1. **近 14 天修过几次**（`node scripts/fix-churn.mjs`）：第 ① 步只碰 `docs/design/boards/2026-10-23/`、本文，未命中。第 ②、③ 步会碰的 `src/workbench/ai/v4/`（目录近 14 天 6 个 fix）、`useAgentPanelSpendConfirm.ts`（文件 2 个 fix）、`ProjectAgentResidentShell.tsx`（文件 2 个 fix）、`src/workbench/capability/multiShotCanvasLanding.ts`（目录 11 个 fix）都命中。第 ②、③ 步是「换 / 删」不是补：换掉旧卡体，删卡账本和重绑定，不加分支。按规矩写方向检查交协调代批，见 §3 Q6。
2. **是不是我们独有的领域**：是。指向元素画的是画布节点的脸（镜号、空节点、排队、生成中、结果图），付费卡管的是按镜头花钱，都在 `docs/engineering/self-written.json` 的领域目录里。通用的部分都接现成的：对焦复用 #1277 的 `resolveCanvasFocusViewport`，按钮用 `WorkbenchButton`，文案走 i18next，板抽取用已有的 `board-extract`（Playwright）。
3. **补 / 换 / 删**：① 补（只加文档）；② 补（加一个新零件；旧卡体在 ③ 才换，同 PR 删）；③ **换**：新卡替掉旧卡体（整件生成框 + 翻页 + 卡账本），旧实现在同一提交删掉，不留并行版。

---

## 一、设计卡（花钱 + 新界面：9 格全填；新增功能：★7）

```
改动名：D2 新付费卡（指向元素 P1 + Q1）   线：I-d2   类别：[花钱][新界面][可打断]
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★0 先查别人 | ① 联动高亮（brushing & linking，Becker & Cleveland 1987，https://en.wikipedia.org/wiki/Brushing_and_linking）：同一份数据的两个视图，一边选中，另一边同步高亮。**确认了**「悬停指向元素 ↔ 画布节点同亮」，也**改了**一条：它要求两个视图同时看得见，所以窄屏单独走「先露出目标再回到对话」（A4）。② 识别优于回忆（Nielsen 十条之六，https://www.nngroup.com/articles/ten-usability-heuristics/：把元素、动作做成看得见的，降低记忆负担）。**确认了**选 P1：认脸比认名字（P2）、认号（P3）都省力；P2 只当窄屏 / 行内形态。③ 人机 AI 交互准则「支持高效纠错」（Amershi 等，CHI 2019，https://doi.org/10.1145/3290605.3300233）。**确认了**「想改就点指向去节点里改」，纠错路径短且只有一条；**改了**旧 D2 的「卡里嵌整件生成框」。④ 现有仓库先例：`docs/plan/2026-09-30-paid-card-per-shot.md`（逐镜确认）、`docs/plan/2026-10-05-paid-card-in-conversation.md`（卡并进对话投影）、`R-d2-defaults`（五层默认值对账）。**确认了**按项控制、价格算不出就不印、卡没有倒计时；**改了**「卡上改的东西只在确认那一刻才写回画布」（09-11），现在节点就是唯一数据 | 链接；板清单 `priorArt` 同四条 |
| ★1 用户怎么用 | 当 Agent 说「已在画布上起草了 3 个镜头」时，我想**一眼认出**是哪三个节点、**决定**花不花，想改就**去节点里改**，改完回来点一下。步骤：① 看卡：三张小卡，脸和画布节点一样；② 悬停其中一张，画布那个节点同时亮；③ 点它，画布滑过去、节点闪一下（窄屏：对话收成小球，底部「回到对话」）；④ 在节点里改参数，卡上的摘要跟着变；⑤ 回来点「全部生成（3）」；或者直接在节点上点 ↑，卡变成「生成剩下 2 段」；⑥ 卡上看到「正在发出 2/3 段」，可点「取消」停下剩下的；⑦ 完成后卡里不再有确认钮，画布对应节点各亮一下。**不做**：聊天里不放参数编辑、不放完整预览、不放第二份参数；不加倒计时；不做「总是允许」。**已知坑**：R-d2 #1–#3（比例、变体、参考图没落到节点上）不补齐，「卡读节点」就不成立，靠 #1288、#1291、#1269 先合。**真实任务**：A 纸船三镜头（文生视频 3 段，参数默认）；B 9:16 竖版两段 + 一段横版，改其中一段时长后再生成；C 一段已在节点上点 ↑、剩两段在卡上「生成剩下 2 段」。**指标**：主指标「从看到卡到点下生成的点击数」（不改：1；改一段：3）；护栏「卡上摘要 ≠ 实际发出参数」为 0（量具：③ 的走查断言 + 对等矩阵加一维）；质量「点指向到节点可见 ≤100ms」（量具：perf 场景，见 ★7）。人设：新手只看脸点生成；老手点指向改节点再回来 | 走查（③ 写）；人工 |
| ★1b 连带界面 | Agent 回执（卡关后回合读逐镜结局，文案不变）；收起后的小球（今天不数付费卡，见 Q5）；toast（「发出了 K 段，剩下 N−K 段没发」保留）；画布节点占位小标（等你确认 / 排队中 / 已去掉，不生成——节点侧不改）；设计实验室 `07-spend-params` 那批状态换成新状态 | 截图（② ③ 交） |
| ★2 谁说了算 | 镜头的参数、提示词、参考图：**唯一 owner = 画布节点**（`generationCanvasStore` 里那一个节点，落盘在项目文件）。卡只读节点、不存副本。待决这件事（有没有一笔在等人点头、报价身份、授权）：owner 仍是主进程 Run 账本（`productionPendingSpend.awaitingSpendDecision`）。今天同一镜头存三份（候选、卡账本 `spendCardDraft`、节点），③ 之后：节点一份 + 确认那一刻冻住的执行合同（不可编辑，不算第二个家）。卡账本、`rebindLandedShots` 删掉。不靠「东西不见了」猜意图：节点被删 → 指向元素显示「已删除」、卡把它算作不生成，由显式的节点删除事件驱动 | `door-map` 门表见 §一·门表 |
| ★3 一致与复用 | 指向元素的脸**照真组件**：标题行 = `BaseGenerationNode` 的 `NodeShotLabel`（`src/workbench/generation/list/CanvasListLinks`）；空节点 = `nodes/render/NodeEmptyState.tsx`；排队 / 等你确认小标 = `nodes/ProductionShotPlaceholder.tsx`；生成中 = `nodes/GenerationWaitingSurface.tsx` + `nodes/GenerationStatusBar.tsx`（overlay 形态）；结果 = 节点结果缩略图。能直接复用的组件直接挂，不能挂的（尺寸 / 交互不同）抽出同一个纯函数读同一份节点状态，不另写一套状态判断。对焦复用 #1277 `resolveCanvasFocusViewport`（缩放封顶 100%）。确认路径复用画布单节点生成（见 Q3）。按钮 `WorkbenchButton`。不新造第二份「节点状态 → 文案」表 | `check:self-written`；`git grep` |
| ★4 全状态 | 指向元素：等你确认 / 排队中 / 生成中（已等 N 秒）/ 完成（只剩结果图）/ 失败（红点 + 原因）/ 已删除（不可点）/ 悬停 / 已定位 / 窄屏 / 竖版 9:16 / 组指向（3 个、混合、5 个折「还有 2 个」）/ 中英 / 光暗 / 长名字截断（全名靠悬停提示）。卡：单段确认前 / 多段确认前 / 逐镜不同（逐镜折叠）/ 价格算不出（整行不印）/ 正在发出 k/N + 取消 / 正在停下 / 完成 / 失败·没发出去（先不发了 · 再试一次）/ 失败·参数被拒（先不发了 · 去改镜 N）/ 节点上已点 ↑（生成剩下 N 段）/ 读不到（会说话的缺卡，沿用）/ 刹车说明（沿用）/ **能力不可用**：供应商没接好 / 核心还在起 → 卡上写原因 + 下一步（沿用 `SHOT_ACTION_FAILURE_COPY` 的那一套，一步可走的路）。文案全进 i18n，不写免费 / 不计费 / 预算 | 样张 Q1-states；`check:i18n` |
| 5 中途表 | 见 §一·中途表 | 走查（③） |
| 6 外部数据与失败 | 外部来源：供应商（经画布单节点生成路径的提交出口，不新开出站）；用户在节点上的改动；项目文件里的旧 Run（开着的出价，重启时被 `stalePresentationSweep` 收回）。失败时：没发出去 → 卡内写哪一段、为什么、下一步；结果未知（`generation_execution_failed`）→ 先去核对，不说没花钱；不把未知失败甩给用户的 key | `spendCardFailure.ts` 那套判序沿用 |
| ★7 性能 | ① 新增操作：悬停指向元素（画布节点同亮）、点击指向元素（画布对焦 + 闪一下）、节点改参数后卡摘要刷新、窄屏收起 / 回到对话。② 最坏规模：一张卡 12 个指向元素（组指向露 3 个 + 「还有 9 个」展开），画布 200 个节点。③ 预算：悬停 / 点击到可见反馈 ≤100ms（p95 ≤150ms）；节点改一个参数到卡摘要更新 ≤100ms；交互期间 >50ms 长任务 0 个；指向元素订阅只订自己那几个节点（不订整个 `nodes` 数组，避免 200 节点画布上每次拖动都重渲卡）。④ 量具：② 登记 `tests/perf/scenarios/` 新场景 `chat-node-pointer-hover-focus`（设计实验室取景，200 节点夹具），③ 登记 `spend-card-node-edit-refresh`；跑 `pnpm run perf:scenarios -- --id <id>` 出基线，PR 交数字 | ②③ 交 |
| 8 真实条件 | Windows / 中英 / 最小窗口（窄屏 A4）/ 键盘全程（Tab 到指向元素、Enter 定位、Esc 回到对话）/ 真规模（12 镜）在 ③ 逐项勾；真付费：③ 合并前按 `docs/engineering/delivery-and-review.md` 先算最小量，跑一次最小真付费（1 段最短最低档），由协调安排；本线不花钱，没跑的记 `unverified` | 截图（自己 Read 过） |
| 拍板图清单 | `docs/design/boards/2026-10-23/NodePointer.board.json`、`SpendCardQ1.board.json`；旧功能去处见本文 §二，清单 `functionCensus` 同步 | `pnpm run check:board-parity` |
| ★9 验收与回滚 | 见 §一·验收清单与反例。回滚：② 只加组件，revert 即可；③ revert 那一个 PR（同 PR 删旧、加新，revert 后旧卡完整回来；卡账本 localStorage 的键在 ③ 里只停读，不在 ③ 里清盘，revert 后旧草稿仍可恢复）。独立验收：③ 合并前另一条线按本格清单在真 App 里逐行点 | `## 独立验收` |

### 门表（`node scripts/door-map.mjs`，2026-10-23 在 `021cef0b9` 上跑）

| 符号 | 门 | 说明 |
|---|---|---|
| `useAgentPanelSpendConfirm` | 写 1：`src/workbench/ai/ProjectAgentResidentShell.tsx` | 付费卡在渲染层**只有这一个宿主**：内嵌 Agent 面板。面板收起时同一棵树挂在看不见的容器里（不换树） |
| `projectSpendCard` | 写 2：`useAgentPanelSpendConfirm.ts`、设计实验室 `src/devlab/designLab/v4/states/07-spend-params.tsx` | ③ 两处一起换 |
| `confirmSpendRemaining` | 写 2：`useAgentPanelSpendConfirm.ts`、`src/workbench/production/productionRunApi.ts` | 「生成剩下 N」→ 主进程 `confirmRemainingSpendShots` |
| `rebindLandedShots` | 写 1：`src/workbench/capability/multiShotCanvasLanding.ts` | ③ 删（候选 revision 变新时用「档案默认 ⊕ 候选」盖节点，R-d2 #4） |
| `spendCardDraft`（模块） | `useAgentPanelSpendConfirm.ts` 一处 import（door-map 按符号数为 0，按 import 数 1） | ③ 删 |

宿主逐个核过：

| 宿主 | 今天有没有这张卡 | 依据 | ③ 后 |
|---|---|---|---|
| 内嵌 Agent（面板展开 / 收起） | 有，唯一宿主 | `ProjectAgentResidentShell.tsx` → `AgentPanelV4Panel` 的 `slot`；收起时同一棵树（文件内 return 处注释） | 新卡 |
| 外部 Agent / MCP（Claude Desktop、Codex…） | **没有**。投影只认 `origin.host === "nomi"` | `electron/productionRun/productionPendingSpend.ts` 文件头 + `awaitingSpendDecision`；外部宿主走 elicitation + 倒计时 | 不变（不在本线） |
| 制作 Run（创作区文稿 → Agent 按分镜方案出图） | 有，同一张卡（Agent 起的 Run，`origin.host = "nomi"`，带 `sourceDocument`） | `electron/capabilityCore/generationTransportAdapters.ts` 的 `plan()` 盖 `host: "nomi"` | 新卡 |
| 分镜表整批 / 画布「生成全部」/ 框选生成 | 不是这张卡，是画布批量确认弹窗 `SpendConfirmDialog` | `src/workbench/creation/storyboard/exec/storyboardRowActions.ts`、`generationCanvas/spend/spendConfirm.ts`、`consentCanvasShots` | 不在本线（不在聊天里），记 Q7 |
| 重试 / 重跑 | Agent 重起草 → 新一次出价 → 同一张卡；画布节点 ↑ 重试走画布单节点路径，不出卡 | `appIntegrationCanvasShot.ts` 文件头 | 新卡；卡内「再试一次」只重发失败那一镜 |
| 旧项目里已有的卡 | 重启后上一个进程摆出的出价被收回，不出卡；卡账本 localStorage 键 `nomi:spend-draft:*` 留在旧资料里 | `electron/productionRun/stalePresentationSweep.ts`；`spendCardDraft.ts#spendDraftKey` | 出价收回行为不变；旧键停读（Q8） |

### 中途表（③ 实现后的目标行为；「今天」不同处标出）

| 状态 \ 打断 | 停（点取消） | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 确认前 | 收回这一次出价，节点与参数都留着，画布占位回「还没生成」· 不扣 · 回执：Agent 回合读到「没生成」 | 回合没了的那条路自己收回出价 · 不扣 · 重开无卡 | 卡照旧（不联网也能看节点）；点生成 → 没发出去，卡内写原因 · 不扣 | 清扫收回出价 · 不扣 · 重开无卡、节点在 | 「生成」按下即置灰，第二下不进（`busy`）· 只花一次 |
| 正在发出 k/N | 已发出的照常生成，剩下的不发；toast「发出了 K 段，剩下 N−K 段没发」· 已发出的扣 · 回执同上 | 已交出的由主进程观察者接手；没交的不交 · 已交出的扣 | 正在交的那一镜：结果未知 → 卡内「先去核对」，不说没花钱；后面的停 | 已交出的由观察者接手，没交的出价收回 | 「取消」不排队，立即送到宿主（沿用 10-02 修法） |
| 完成 | 卡里没有确认钮了，无可停 | 无影响 | 无影响 | 无影响 | 无影响 |
| 失败（某一镜） | 「先不发了」= 收回剩下的出价 · 失败那镜按事实（没发出 = 不扣；结果未知 = 去核对） | 同上 | 同上 | 同上 | 「再试一次」按下即置灰 |

### 验收清单与反例（★9，动手前写全；③ 的验收线只核这份）

**第 ② 步（指向元素组件，设计实验室）**

| # | 检查 | 反例（这一类会从哪回来） |
|---|---|---|
| 2.1 | 一张脸照真组件：标题行 / 镜号、空节点、排队、生成中等待面、失败、结果缩略图，与同一节点在画布上的样子逐项对得上（实验室里同屏摆真节点与指向元素对照截图） | 另写一套状态文案表 → 节点改文案、指向元素没跟 |
| 2.2 | 「已删除」只在指向元素上出现，不可点、读屏念出「已删除」 | 节点被删时指向元素抛错 / 空白 |
| 2.3 | 悬停双向联动用中性样式（深色细线 + 阴影抬一级，「闪一下」= ink 淡光晕），**全仓 grep 新组件无 accent / 蓝色描边类** | 用 `border-nomi-accent` / `ring-blue-*` |
| 2.4 | 点击定位走 #1277 的对焦（缩放不超 100%，节点 + 生成框都在可见区） | 自写 `setViewport` |
| 2.5 | 组指向：3 个、混合状态、5 个折「还有 2 个」点开展开；横竖混排时缩略图槽固定高、竖版按真比例居中不裁 | 竖版被裁成横版 |
| 2.6 | 窄屏（面板 ≤320px）：只留镜号 + 缩略图，名字靠悬停；点了对话收成小球、露出目标、底部「回到对话」，回来后那一项标「已定位」 | 窄屏点了没反应 / 回不去 |
| 2.7 | 键盘：Tab 到每个指向元素、Enter / Space 定位、窄屏 Esc 回到对话；有可读名（镜号 + 名字 + 状态） | 只能鼠标 |
| 2.8 | 中英、光暗各一张实验室截图，自己 Read 过；英文长名截断有提示 | 英文溢出 |
| 2.9 | 指向元素只订自己那几个节点（不随整个画布重渲），perf 场景出基线 | 订整个 `nodes` |
| 2.10 | 组件放在聊天卡共用的位置，`check:boundaries`、`check:self-written`、`check:concept-owners`、`check:i18n` 全绿 | 渲染层 import electron 非 shared |

**第 ③ 步（新付费卡接线）**

| # | 检查 | 反例 |
|---|---|---|
| 3.1 | 卡上摘要 = 节点当前参数（模型、变体、比例、时长、清晰度）；在节点上改一个参数，卡摘要 100ms 内跟着变 | 卡读候选、节点改了卡没变 |
| 3.2 | 点「生成」/「全部生成（N）」发出的参数 = 节点当前参数（假上游抓真请求体，13 模型 × 默认 / 改过两种，复用 R-d2 的探针做成对等矩阵一维） | 比例被改成 16:9、变体掉回 Fast、参考图丢 |
| 3.3 | 节点上点 ↑ 后，卡认出这一镜已发，变「生成剩下 N 段」，合计只算剩下的；一镜都不剩时卡关 | 同一镜被卡再发一次（双扣） |
| 3.4 | 去掉 / 不生成：多段卡每个指向元素悬停 / 聚焦露「不生成 ×」，点了 N 减一、节点显示「已去掉，不生成」，再点一次恢复；去掉的不花、没点的不悄悄生成；全部去掉时主按钮置灰、卡留着（还能恢复），要关卡点「取消」 | 「全部生成」把去掉的也发了 |
| 3.5 | 价格读节点：算得出照现行规则印（Q2），算不出整行不印，不写 0 | 写 ¥0 / 写预算 |
| 3.6 | 正在发出 k/N：「取消」立即生效，已发出的照常生成，toast 照实说发了几段 | 取消排在队后 |
| 3.7 | 失败两种：没发出去（先不发了 · 再试一次）、参数被拒（先不发了 · 去改镜 N → 点了就定位到那个节点）；结果未知不说没花钱 | 说「没扣费」 |
| 3.8 | 删旧：`spendCardDraft.ts`、`spendCardEstimate.ts`、`spendCardReferences.ts`、卡体 `NodeGenerationComposer host="panel"` 挂载、翻页、`rebindLandedShots` 同 PR 删；`git grep` 无残留引用；对应测试改写或删 | 留一个 fallback |
| 3.9 | 宿主：内嵌 Agent 展开 / 收起都出卡（收起时小球的待确认计数也数付费卡，Q5）；制作 Run（文稿出图）出同一张卡；外部 MCP 不出卡 | 收起时卡丢了 |
| 3.10 | 策略档：「请求批准」逐次出卡；「直接生成」不出卡，刹车 / 失败时回同一张卡并带刹车说明 | 全自动档仍弹卡 |
| 3.11 | 重启：上一个进程摆出的出价收回，不出卡；旧资料里的 `nomi:spend-draft:*` 不再被读，也不报错 | 旧草稿被套到新卡上 |
| 3.12 | 节点被删：指向元素「已删除」，卡把它算作不生成，N 跟着变 | 卡对着不存在的节点发钱 |
| 3.13 | Agent 回合：卡关后回合读到逐镜结局，回执文案不变 | 回合一直挂着 |
| 3.14 | 走查：`tests/ux/agent-spend-*.walk.mjs`、`core-smoke-spend-confirm.walk.mjs`、`p4-s6p5-multishot-paid.e2e.mjs`、`_agentSpendScopeJourney.mjs`、`_permissionTiersPaidSteps.mjs`、`design-lab-agent-panel-v4.walk.mjs` 按新卡改写，本机跑过；`board:SpendCardQ1/*` 断言进走查 | 只跑单测 |
| 3.15 | 真付费最小抽检 1 次（协调安排）；其余 `unverified` 照实写 | mock 绿灯顶替 |

---

## 二、现有付费确认卡功能全表（只读，`origin/main` @ `021cef0b9`）

底稿：协调调研 R-spendcard（10-18，28 行）逐行按当前代码重核，补了 14 行。出处写「文件 # 符号」，不写行号。去处三种写法：**指向元素**（点了去节点里改）、**卡上保留**、**删掉：理由**。⚠ = 起草时没有去处或和规矩冲突的行，已列进 §三，10-23 全部有了答案。清单 SpendCardQ1 的 functionCensus 是这张表的机读版（SC-01…SC-43）。

| # | 功能 | 现状（出处） | 新设计里的去处 |
|---|---|---|---|
| 1 | 卡的位置 | Agent 面板对话流下方、输入框上方那一格；换档卡 > 付费卡 > 工具审批卡（`ProjectAgentResidentShell.tsx#activeSlot`） | 卡上保留：位置与优先序不变 |
| 2 | 单段 / 单张 | 无翻页、无「生成剩下」；图还是视频读宿主 `kind`（`agentPanelSpendCard.ts#isVideoOrder`） | 卡上保留：Q1 ①，一个指向元素 + 「生成」；图 / 视频规则不变 |
| 3 | 标题一句问话「生成这 N 段视频？」/「张图片」，复数中英 | `agentPanelSpendCard.ts#orderWording`；词典 `spendParamsTitle*` | 卡上保留：Q1 ①② |
| 4 | 徽章「生成 · Nomi 选的」，用户换过模型后「Nomi 选的」消失 | `useAgentPanelSpendConfirm.ts#originalModelIds`、`agentPanelSpendCard.ts#projectSpendCard` | 卡上保留：判据改为「节点当前模型 ∈ Agent 起草时的模型」，在节点里换了模型就不再说「Nomi 选的」 |
| 5 | 多段翻页 ‹ 2/4 ›，卡聚焦时 ← → 翻页（输入框内不抢方向键） | `AgentPanelV4Cards.tsx#V4Intervention handleKeyDown`、`AgentPanelV4SlotShell.tsx#V4Pager` | 删掉：组指向把所有段同时摆出来，不再需要翻页；键盘改为 Tab 在指向元素间走、Enter 定位（第 ② 步 2.7） |
| 6 | 生成这张 / 这段（只生成当前一镜） | `useAgentPanelSpendConfirm.ts#confirm` → 主进程 `confirmPendingSpendConfirmation` | 指向元素：点它去节点，在节点上点 ↑；卡认出后变「生成剩下 N 段」（Q1-flow ④）。依赖 Q3 |
| 7 | 生成剩下 N 张 / 段（逐张各一份授权，上一张受理才交下一张） | `useAgentPanelSpendConfirm.ts#confirmRemaining` → `appIntegrationSpendConfirm.ts#confirmRemainingSpendShots` | 卡上保留：Q1 主按钮「全部生成（N）」；节点上已点 ↑ 后改为「生成剩下 N 段」；逐镜授权语义不变 |
| 8 | 去掉这张 / 这段（这一镜不生成，节点留着，其它照旧等） | `useAgentPanelSpendConfirm.ts#remove` → `appIntegrationSpendConfirm.ts#removePendingSpendShot` | 卡上保留并改形：多段卡每个指向元素悬停 / 聚焦露「不生成 ×」，可撤回（用户 10-23 选 Q1-A，对样张的已批差异）。今天「去掉」不可撤回，③ 要补「恢复这一镜」的宿主动作 |
| 9 | 取消（文字钮，旧 × 的语义）：收回这一次出价，节点与草稿都留着，可再出价 | `useAgentPanelSpendConfirm.ts#discard`；`AgentPanelV4Cards.tsx` 决定栏 `slot-dismiss` | 卡上保留：Q1「取消」；「草稿留着」改为「节点留着」（节点就是草稿） |
| 10 | 正在发出 k/N 段 + 「点取消停下剩下的」；正在停下…/已经发出的照常生成 | `agentPanelSpendCard.ts#projectSpendCard`（batch 分支）；词典 `spendBatch*` | 卡上保留：Q1 ③，并在每个指向元素上显示那一镜的状态（生成中 / 发出中 / 排队中） |
| 11 | 取消立即打断：批量途中、单镜在路上时「取消」都不排队 | `useAgentPanelSpendConfirm.ts#discard`（batchRef / stoppedDuringAction 分支） | 卡上保留：行为不变 |
| 12 | 停下后 8 秒 toast「发出了 K 段，剩下 N−K 段没发」 | `useAgentPanelSpendConfirm.ts#confirmRemaining sayStopped`；`spendBatchStoppedKey` | 卡上保留（toast 不变） |
| 13 | 卡体 = 整件画布生成框：提示词编辑（可 @ 引用） | `ProjectAgentResidentShell.tsx#spendComposer`（`NodeGenerationComposer host="panel"`） | 指向元素：去节点里改（节点生成框，#1269 之后的 B3 新排法） |
| 14 | 卡体：模型 / 变体切换 | 同上；`InlineParameterBar` | 指向元素：去节点里改 |
| 15 | 卡体：参数 chip（比例、时长、清晰度、声音…）可直接点改，长尾进齿轮 | 同上；`NodeParameterControls` | 指向元素：去节点里改；卡上只留**一行只读摘要**（模型 · 比例 · 时长 · 清晰度，竖版必须带比例） |
| 16 | 卡体：生成方式（多种方式才出方式栏） | 同上 | 指向元素：去节点里改 |
| 17 | 卡体：参考图 / 首尾帧，画布连线带来的参考投影到卡，卡上拿掉不断画布边 | `spendCardReferences.ts#placeSpendReferences`、`spendCardDraft.ts#keptReferenceUrls` | 指向元素：去节点里改（#1269 参考图唯一列表 + `placeUploadedImages`）；「卡上拿掉不断边」删掉：理由是一个东西一个家，参考只在节点上 |
| 18 | 卡体上传 / @ 选图的异步写口归属（翻页回来不复活旧回调） | `useAgentPanelSpendConfirm.ts#writeScope / writeAccess` | 删掉：卡不再有写口，写都在节点里（节点自己的写口不变） |
| 19 | 未确认的改动只进卡账本、不改画布；同一 operationId 换报价 / 收回 / 重开能恢复（localStorage） | `spendCardDraft.ts#spendDraftKey / restoreSpendDraft / retainSpendDraft` | 删掉：10-22 拍板「节点是唯一数据」，改动直接进节点，不需要第二本账；旧键见 Q8 |
| 20 | 确认时先把卡上改动逐镜 `generation.revise` 落进候选再封印 | `useAgentPanelSpendConfirm.ts#persistShown / persistEdits` | 删掉：确认只按节点当前参数发，见 Q3 |
| 21 | 候选 revision 变新 → 重绑定画布节点（会冲掉节点上用户改动，R-d2 #4） | `multiShotCanvasLanding.ts#rebindLandedShots` | 删掉：节点是 owner，候选不再往节点上盖 |
| 22 | 本地重算价格（改参数当场换价）；正式报价与本地不一致时留在原卡等再按 | `spendCardEstimate.ts#repricePendingSpend / priceDisagreements` | 删掉本地账本那一份；价格读节点（与画布批量估价同一函数），按下时节点又变了 → 「卡上的内容刚变了，看一眼再按」（沿用 `spendActionCardChanged`） |
| 23 | 已知价：主按钮与合计**不印金额**（「生成这段」「N 段 · 已选」），10-08 「界面不谈钱」 | `agentPanelSpendCard.ts#projectSpendCard`；词典 `spendTotalLead*`；门岗 `scripts/check-i18n-no-cost-claims.mjs` | 卡上保留：合计行只写「N 段」，不印合计金额（用户 10-23 定 Q2，照 10-08；样张上的 ¥ 是占位）|
| 24 | 逐镜不同：「N 镜 · 逐镜不同」+ 逐镜折叠口（展开印每镜金额） | `agentPanelSpendCard.ts`（`perItem`）、`AgentPanelV4Cards.tsx#V4PriceRow` | 卡上保留：Q1 ⑧「逐镜 · 3 镜」；金额照 Q2 |
| 25 | 价格算不出：整行不印、不写 0、生成照样能点 | `agentPanelSpendCard.ts`（`total === undefined` 分支） | 卡上保留：Q1 ⑦ |
| 26 | 刹车说明（连续失败 / 计划外 / 你点过停止） | `agentPanelSpendCard.ts#BRAKE_COPY` | 卡上保留：标题下一行（样张没画，沿用现行） |
| 27 | 动作在路上时动作行置灰，取消仍可点 | `useAgentPanelSpendConfirm.ts#slot`（`actionsDisabled`） | 卡上保留 |
| 28 | 动作失败 → toast，按事实分：结果未知 / 卡变了 / 这一镜已不在 / 项目没开 / 核心在起 / 参数被拒（点名哪个）/ 参考图不在项目 / 卡改不了 | `spendCardFailure.ts#spendActionFailureCopy` | 卡上保留并**改进**：失败留在卡里（Q1 ⑤⑥：哪一段、发没发、下一步 + 一颗对应按钮）；「在卡上改掉它 / 在卡上拿掉它」改为「去改镜 N」（点了定位到节点）；toast 不再重复 |
| 29 | 进行中取消失败的可见性（部分分支只记日志） | `useAgentPanelSpendConfirm.ts#discard` | 卡上保留并补齐：停下失败写在卡里（③ 顺手补，不新增分支） |
| 30 | 读不到 → 会说话的缺卡（`missingInterventionCard`）；有 announce 却没画卡在开发 / 测试里当场抛 | `useAgentPanelSpendConfirm.ts#slot`、`ProjectAgentResidentShell.tsx#assertAnnouncedCardRendered` | 卡上保留 |
| 31 | 画布占位小标：等你确认 / 已去掉，不生成 / 还没生成 / 排队 | `nodes/ProductionShotPlaceholder.tsx`；`electron/shared/productionShotPhase.ts` | 节点侧不变；指向元素照抄同一份状态（第 ② 步 2.1） |
| 32 | 报价 / 计划 / 出价身份一致性（presentationId / epoch / planVersion / quoteId，旧报价批不动新候选） | `useAgentPanelSpendConfirm.ts#cardIdentity`；`productionPendingSpend.ts#assertPendingSpendIdentity` | 卡上保留：身份核对不变；新增「节点版本」进核对（节点按下前被改 → 卡变了） |
| 33 | 等候无倒计时；用户另发一句话 → 收回这次出价，节点留着 | `productionPendingSpend.ts`；lane 回合 | 卡上保留 |
| 34 | 「直接生成」档：策略在决时不出卡；刹车 / 失败回同一张卡 | `productionPendingSpend.ts#awaitingSpendDecision`（`projectPolicyPending`） | 卡上保留（Q3 定的路径必须复刻这一档） |
| 35 | 重启后收回上一个进程摆出的出价 | `electron/productionRun/stalePresentationSweep.ts` | 卡上保留（宿主不变） |
| 36 | 回合等卡关，再读逐镜结局回给 Agent | `electron/agentLane/laneSpendCardClose.ts#watchSpendCardClose`、`laneDesktopSpend.ts#whenCardCloses` | 卡上保留（Q3 定的路径必须把逐镜结局接回回合） |
| 37 | 同一项目多笔待决只出一张（按更新时间取第一笔） | `productionPendingSpend.ts#listPendingSpendConfirms` | 卡上保留 |
| 38 | 落地准入：镜头先落上画布才派发 | `electron/productionRun/shotLandingAdmission.ts#admitShotsForDispatch` | 卡上保留（节点是 owner 后天然满足：没有节点就没有指向元素） |
| 39 | 待答态外框（accent 发丝线），答完回普通纸面 | `AgentPanelV4SlotShell.tsx#V4SlotShell waiting` | 卡上保留（卡外框不变；**指向元素**本身不用蓝色描边） |
| 40 | 主按钮最小宽、⏎ 提示、动作行放不下时折行、走查锚点 `data-v4-control` / `data-v4-price` | `AgentPanelV4Cards.tsx#V4Intervention` | 卡上保留；锚点按新卡改名并同步走查（3.14） |
| 41 | 收起后的小球：待确认计数**不数付费卡**（只数工具审批） | `ProjectAgentResidentShell.tsx#dockPendingCount` | ③ 补上：小球计数读同一份 `spend`（协调 10-23 定 Q5）|
| 42 | 英文：全套中英键（单复数、图 / 视频、进度、失败） | `src/i18n/locales/agentPanelV4.ts` | 卡上保留；新增指向元素文案中英成对 |

**完成态（新）**：今天卡点完就从槽里消失，结果只在 Agent 回执和画布上。样张 Q1 ④ 画了「已生成 3 段 + 组指向」的完成态，聊天里不再有确认钮。默认做法：卡离开输入框上方那一格，对话流里留一条收据，收据带组指向（实时读节点状态），点了照样能定位。

---

## 三、连带问题与答复（10-23 已定）

答复：Q1 选 A，并且「可以撤回（再点一次恢复）」（用户 10-23「按推荐」，协调转述）；Q2 照 10-08，顺手把 `docs/design/nomi-agent-interaction.md` §10「每项单价 + 合计」改成一致（本 PR 已改）；Q3 一台发动机（用户 10-23「按推荐」）；Q4、Q5、Q8 协调 10-23 按推荐定；Q6 第③步提交前交方向检查一页；Q7 不在本线。以下保留起草时的原文。

**Q1 「去掉这段」在 Q1 里没去处（功能全表第 8 行）。** 用户 09-29 的规矩是「点了的生成，去掉的不生成，没点的不许悄悄生成」，而 Q1 只有「全部生成（N）」。
- A（推荐）：多段卡上每个指向元素右上角在悬停 / 聚焦时露出一颗小「不生成」（×），点了这一镜退出这次出价、节点留着并显示「已去掉，不生成」，N 跟着变；去掉最后一镜卡关。代价：样张上没有，是一处要用户点头的差异（「差异清单 + 两版并排截图」）。它仍属于这次请示（花哪几镜），不是改参数。
- B：不在卡上做，去掉 = 「取消」整张卡，再到节点上逐个点 ↑。代价：去掉一镜要多走好几步，花钱前按项控制变弱。
- C：去掉 = 在画布上删掉那个节点（卡显示「已删除」）。代价：为了不花钱要删掉作品，不推荐。

**Q2 合计要不要印金额（全表第 23、24 行）。** 样张印「3 段 · 合计 ¥2.10」；现行规矩（10-08「界面不谈钱」，门岗 `check-i18n-no-cost-claims`）主按钮与合计都不印金额，只有逐镜不同时折叠口里印每镜金额。推荐：**照现行规矩**，合计行写「3 段」不带金额，逐镜折叠口照旧；样张上的 ¥ 数字本来就是占位。另：仓库里的拍板图预览原样保留样张（含占位 ¥ 数字，板首页已注明是占位），实现以现行规矩为准，清单里把「合计金额」标成按规矩不印。

**Q3 确认走哪条路（架构岔路，R-d2 第四节已提）。** 任务书写「复用画布单节点生成路径」。要先定三件事，否则会出现「全自动档仍弹卡」或「Agent 回合拿不到结果」：
- 3a Agent 那一次出价（Run、付费门、策略档、刹车、重启清扫、回合等卡关）怎么关：推荐「卡上点生成 = 对每个节点走画布单节点那一条提交（同一个主进程手势收据），同时把 Agent 那一次出价按『已交给画布』收口，逐镜结局从画布那几个单镜 Run 读回给回合」。
- 3b 「直接生成」档：Agent 起草后由策略直接走同一条画布提交，不出卡；刹车时出卡。
- 3c 节点上直接点 ↑：已经是画布单节点那一条，卡只需订阅节点状态就能认出「这一镜已发」。不双扣靠两道现有准入：同节点在途、绑定了制作镜头的节点先经 `decideShotClaim` 认领那一镜（`appIntegrationCanvasShot.ts` 文件头）；③ 要用测试钉住「卡上的出价与节点 ↑ 争同一镜只成一次」。
- 备选：保留 Agent 那条付费门，确认那一刻把节点当前参数整份冻成这一镜的执行合同再批。少改宿主，但「Agent 路」「画布路」两台发动机继续并存，R-d2 #5 那类「两条路缺省不同」的问题还在。不推荐。
- 第 ③ 步动手前要这一题的答复；第 ①② 步不依赖它。

**Q4 完成态放哪。** 推荐：卡离开输入框上方那一格，对话流里留一条带组指向的收据（见上「完成态」）。我按这个做，除非协调另定。

**Q5 收起后的小球不数付费卡（全表第 41 行，今天就有的缺口）。** 推荐在第 ③ 步顺手做：小球的待确认计数读同一份 `spend`（两行改动，读同一份投影，不新开真相）。会改变用户看到的样子（收起时多一个「等你」点），要不要做请协调定。

**Q6 热点方向检查。** 第 ②、③ 步碰的目录 / 文件 fix-churn 命中（见开工三问 1）。改法是换 / 删、不加分支，按规矩由协调代批；第 ③ 步提交前我写 `docs/engineering/direction-check-*.md` 一页交你。

**Q7 画布批量确认弹窗 `SpendConfirmDialog`（分镜整批 / 生成全部 / 框选）** 不在聊天里，不在本线。它也列了一叠镜头，以后要不要也换成组指向，另立题。

**Q8 旧资料里的卡账本键 `nomi:spend-draft:*`。** 推荐第 ③ 步只停读、不清盘（revert 后旧草稿还能恢复），下一个版本再删键。

## 功能分类

- [x] 新界面 / 改交互
- [x] 花钱
- [x] 长跑 / 可打断
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能
