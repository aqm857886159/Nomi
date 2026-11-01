# Agent 读分镜表：行 / 列 / 勾选进 canvas.read（设计卡）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 线：agent-read-shot-table（实现线，非协调会话）。类别：[其他]（Agent 行为 · 模型可见契约 · 新增功能）。
> 起因：用户 2026-10-18 拍板——分镜表节点不再自带「生成选中镜头」按钮（按钮背后藏着模型与提示词的选择），
> 改成让 Agent 读表、用户对 Agent 说「照这几镜复刻」。按钮的删除在 `feat/shot-table-node` 上；本卡只管**读**那一半。

## 一、现状（动手前查的）

- `electron/shared/agentCapabilities/canvasRead.ts` 的 `projectNode` 只投文本节点正文（`textNodeBody`）与 3D-BOX 摘要；
  `shot_table` 节点只剩 `id / kind / title / prompt("") / status`。Agent 看不到任何一行，「镜 3」对它不存在。
- 读面只有一条：渲染层 `readCanvasReadSource()`（画布快照 + 分镜编号源）→ 主进程 `capabilityExecutorRegistry` 里的
  `projectCanvasRead`（canonical）→ ① MCP `nomi_read{target:"canvas"}` 原样回 JSON（`buildCanonicalMcpToolResult`）；
  ② 应用内 Agent `look_at_canvas` 回 `formatCanvasForAgent(result)` 紧凑文本（≤ 12 000 字，测试钉死）；
  ③ 生产规划器（`runStoryboardPlanner`）同一份紧凑文本。三者共用 `projectCanvasRead`，所以只在投影里加一处即可，不新开读路。
- 分镜表文档的 owner：`electron/shared/canvas/shotTable.ts` 的 `readShotTable`（zod，跨进程）。行 = `rows[]`（`rowId / order /
  start / end / duration / cells{columnId→text} / imagePrompt / motionPrompt / visionFailed / failureReason / keyframeRef`），
  列 = `columns[]`（内置 6 列 + 用户自加的 custom 列，`labelKey` 是用户起的名字，`visible`），勾选 = `view.selectedRowIds`。
  界面上的镜号 = `order`（`ShotTableGrid` 显示 `String(row.index).padStart(2,'0')`，index = order）。

## 二、设计卡

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我拆完一条参考片、表里有 N 镜，我想对 Agent 说「照第 2、3 镜复刻，给我出图」或先在表里勾几行再说「把我勾的复刻一下」，以便不用自己抄提示词、也不被一颗藏着模型选择的按钮替我做决定。步骤：①拆解参考片 → ②（可选）在表里勾行 → ③对 Agent 说要复刻哪几镜 → ④Agent `look_at_canvas` 读到行 → ⑤`draft_shots` 用那几行的 imagePrompt 起草 → ⑥付费卡上按项确认。**不做**：引用芯片（选中即引用，另一条设计线）、按镜号分页读（见三、产品问题）、改写分镜表本身、让 Agent 用关键帧当参考图。**已知坑**：表很大（> 预算）时没放下的镜要用户勾选才读得到；关键帧图片 Agent 看不到（只有文字）。真实任务：R1「照第 2、3 镜复刻，给我出图」（不勾选，按镜号）；R2 勾 4、5 后「把我在分镜表里勾的那几镜复刻成图片」；R3 英文「Remake shot 1 from the shot table as an image.」。主指标：回合成功率（读到表 + 抄对行）；质量：抄对行（草稿镜数 = 要的镜数，每镜提示词带该行独有主体词、不混别的行）；护栏：工具写对率（无被拒调用）、大脑调用数 ≤ 20。基线：main 上读面不含行（结构上 0）；目标 3/3。 | `tests/ux/agent-shot-table-remake-real.paid.mjs` + `tests/ux/_shotTableRemakeFixture.mjs` |
| ★1b 连带界面 | 模型可见面两处：①`look_at_canvas` 的 `does` / `useWhen`（中英只有英文一份，模型面）；②工具结果文本里新增的「分镜表」段（中文，模型读，不是界面文案）。用户可见界面**不变**：工具回执（`tool-display-label`）仍是「看了画布」，没有新的通知 / 错误卡 / 撤销提示。MCP 宿主看到 `nodes[].shotTable` 新字段（JSON）。 | `scripts/model-face-baseline.json` diff；`canvasReadShotTable.test.ts` |
| ★2 谁说了算 | 真相 = 分镜表文档（`shotTable.ts` · `readShotTable`），只有一份；本次新增的是它**给模型看的投影**，唯一 owner = `electron/shared/agentCapabilities/canvasReadShotTable.ts` 的 `projectShotTableForAgent`（canonical）与 `formatShotTableForAgent`（紧凑排版，只读 canonical 字段，不再读 meta）。登记 `docs/engineering/concept-owners/agent.canvas-read-shot-table.json`。消费者：`canvasRead.ts`、`canvasReadCompact.ts`。碰 1 个概念；不靠「状态变了」猜意图（勾选是用户显式写进 `view.selectedRowIds` 的）。结构断言：Agent 面三个目录（`shared/agentCapabilities`、`agentLane`、`capabilityCore`）里除 owner 外不许出现 `readShotTable` / `meta.shotTable`（变异验证过会红）。 | `canvasReadShotTable.test.ts`「投影只有一个出口」 |
| ★3 一致与复用 | 复用：`readShotTable`（不另 parse）、状态词表 `deconstructionShotTableSchema.shape.source.shape.status`（不另抄枚举）、canvas.read 的 canonical→紧凑两段式（同 3D-BOX `director` 摘要的做法）、紧凑文本的 12k 总预算与 writer。没有第二份定义。不复用 `selectShotTableRows`（渲染层视图，带缩略图地址且住在 src/，主进程不能依赖）。P0：投影是领域（分镜表 / 镜号 / 勾选），无现成库。 | `git grep readShotTable electron` |
| ★4 全状态 | 表的六种状态全投：还没拆（idle，0 行）/ 拆解中（running，带 `progress` 那句进度）/ 已拆完（ready）/ 拆解失败（failed，带 `notice` 原话）/ 中断（interrupted）/ 已取消（cancelled）；半成（ready + `notice` + 有行）；单镜没读出（`unread` + `failureReason` 原话）；读不出的表（坏数据 / 退役格式）→ 不出 `shotTable` 字段、节点照常（fail closed，与界面「表找不到」同判据）；太大 → `rowCount` 真数 + `truncated` + 紧凑文本明列「未列出 N 镜：镜 a–b（请用户勾选）」。「能力不可用」：不适用——读不需要模型或外部资源。i18n：不适用——没有新的用户可见文案（工具结果文本给模型读）。 | `canvasReadShotTable.test.ts` 的 `it.each` 六态 + 坏表 + 上限 |
| ★7 性能 | ①新增操作：无用户手势；新增的是 Agent 每次 `look_at_canvas` / MCP 读画布时的投影计算（后台、一次模型往返之前）。②最坏规模：200 节点画布 + 两张 200 行 × 16 列的表、每格都超上限。③预算：一次 canonical 投影 + 紧凑文本 ≤ 50ms p95（不在手势路径上，远低于 100ms 反馈线）。④量具：`electron/shared/agentCapabilities/canvasReadShotTable.perf.test.ts`（`NOMI_PERF=1`，与 `directGenerationBrakes.perf.test.ts` 同约定）。基线：中位数 2.0ms / p95 3.4ms（本机 darwin，2026-10-19）。不登记 `tests/perf/scenarios/`：那个登记表量的是页面交互（帧间隔 / 响应），这里没有页面交互。 | `NOMI_PERF=1 pnpm exec vitest run electron/shared/agentCapabilities/canvasReadShotTable.perf.test.ts --silent=false` |
| ★9 验收与回滚 | 见下「验收清单与反例」。回滚：revert 本 PR 的提交即可（读面字段是 optional 新增；MCP 消费者不认识新字段也能读旧字段；模型面基线随 revert 回去）。**需要独立验收**：新增模型可见契约（`look_at_canvas` 说明书 + `nodes[].shotTable`），验收线编号不得与实现线相同。 | `## 独立验收` |

### 上限与理由（canonical，MCP 原样拿到的那份）

| 上限 | 值 | 为什么 |
|---|---|---|
| 每格 / 每段提示词 | 400 字 | 读图腿要求「30–60 字画面描述」+「一段可直接喂图片模型的提示词」（`buildShotAnalysisPrompt`），实际 100–300 字；400 能把整段提示词原样带给 Agent（复刻要的就是它），又不让一格失控长文吃掉整张表 |
| 每表格子总字数 | 20 000 字 | ≈ 7k token，128k 上下文的 6% 以内；按每镜约 400 字能放下约 50 镜，15–60 秒广告片通常切 8–40 镜，一次读全 |
| 行 | 60 | 同量级的硬上限（切点上限 `MAX_CUTS`=120，最长表约 121 行）；空格子的行也有十几个字段名开销 |
| 列 | 16 | 内置 6 + 自定义；自定义列数不设上限时列名本身就能撑爆 |
| 勾选镜号 | 200 个 | 数字便宜但也要封顶（文档不限行数） |
| 紧凑文本每表 | ≤ 8 000 字，且 ≤ 画布文本剩余预算 / 剩余表数 | 整份 look_at_canvas 文本 ≤ 12 000（既有测试钉死）；整行放不下退「精简行」（镜号 + imagePrompt 前 200 字），精简行也放不下才停 |

放行顺序：**勾选的先**、其余按表序；输出永远按表序；`rowCount` 永远是真数。

### 验收清单与反例（动手前列全，实现线按它自验）

| # | 检查项 / 反例 | 结果 | 证据 |
|---|---|---|---|
| A1 | 5 镜表：镜号 = 界面镜号、勾选镜号、可见列、自定义列名、imagePrompt 都在 canonical 与紧凑文本里 | 过 | `canvasReadShotTable.test.ts` |
| A2 | 反例：关键帧 `nomi-local://` 地址、`meta`、`url`、`keyframeRef` 出读面 | 不出 | 同上 + B6 传输测试 |
| A3 | 反例：隐藏列出现在读面（模型看到 ≠ 用户看到） | 不出 | 同上 |
| A4 | 勾选里有已不存在的行 id | 被滤掉（与界面同判据） | 同上 |
| A5 | 六种状态 + 半成 + 单镜没读出 + 坏表 | 各有一句、坏表不出字段不抛错 | `it.each` |
| A6 | 200 行 × 长格子：行 ≤ 60、每格 ≤ 400、总字数 ≤ 20 000、`rowCount=200`、`truncated`；第 150、199 镜勾选了也在 | 过 | 上限用例 |
| A7 | 反例：画布本身 200 个节点吃掉大半预算时，表只剩一句「未列出」 | 勾选的镜退精简行仍在；整份 ≤ 12 000 | 「画布本身很满」用例 |
| A8 | 40 个自定义列 | 只出 16 列 + `truncated` | 列上限用例 |
| A9 | 只有 kind=shot_table 读表（别的节点 meta 塞 shotTable 不出） | 过 | 同上 |
| A10 | MCP / 应用内 / 内部三条传输读到同一份 shotTable；MCP JSON 里的表 = canonical | 过 | `canvasReadB6TransportAcceptance.test.ts` |
| A11 | 反例：Agent 面再长出第二个读 `meta.shotTable` 的投影 | 结构断言红（变异验证过） | 「投影只有一个出口」 |
| A12 | 模型面变更被门岗看见并逐条说明 | `check:model-face-frozen` 基线更新，仅 `look_at_canvas` 一项 | `scripts/model-face-baseline.json` |
| A13 | MCP tools/list 字节棘轮 | 48 368 → 48 377（< 51 021 上限） | `check:mcp-payload` |
| A14 | 真模型：R1–R3 读表 / 抄对行 / 工具写对 / 回合成功，大脑调用 ≤ 20 | 2026-10-19 apimart/deepseek-v4-flash：读表 3/3 · 抄对行 3/3 · 工具写对 3/3 · 回合成功 3/3 · 付费卡出现 3/3（都关掉、没点生成）；大脑调用 15 次（`spendReceipt` 的 replies；报告里的 `modelCalls: 9` 是脚本按会话去重的键写错少记，已修）、媒体 0 次。三轮的提示词都是对应那一行的 imagePrompt 原文（模型只在尾巴上加了「电影感」之类的风格词）。零花费演练（`--rehearsal`）先跑通。 | `docs/evidence/2026-10-19-agent-read-shot-table/` |
| A15 | 这一类还会从哪回来：别的节点类型（3D-BOX 已有摘要；文本有正文；图片 / 视频只有 prompt）也有「内容在 meta 里、读面只给标题」的形状 | 记后续：本 PR 不扫全类型 | 三、 |

### 外部协议对账（R5.5）

MCP 对外面：`nomi_read{target:"canvas"}` 回 `structuredContent` + 一段同内容的 JSON 文本（`buildCanonicalMcpToolResult`，先 parse 再出两份，不会分叉）。
对照 MCP 规范 2025-06-18「Structured Content」（https://modelcontextprotocol.io/specification/2025-06-18/server/tools#structured-content ）：
返回结构化内容的工具「SHOULD also return the serialized JSON in a TextContent block」——已满足；工具没有声明 `outputSchema`（`tools/list` 里 `nomi_read` 只有 inputSchema），
所以宿主不会按旧 schema 校验而拒收新字段。偏差：无。本次只**新增可选字段** `nodes[].shotTable`，老宿主忽略它照样能读其余字段。

## 三、产品问题（交协调会话，带推荐默认）

1. **表大于预算时，Agent 怎么读到没列出的镜？** 选项：(a) 现状——没列出的镜号明列，让用户勾选后再读（勾选的永远先放）；(b) 给 `look_at_canvas` 加参数 `shots:[…]` 按镜号读；(c) 抬预算。**推荐 (a)**：真实拆解表 8–40 镜基本一次读全；(b) 会给常驻动词加参数（模型面 + 预算），等真遇到「表大到读不全」的投诉再做。代价：超大表时多一个来回（用户去勾）。
2. **复刻要不要把那一镜的关键帧当参考图？** 现在 Agent 只读到文字（关键帧地址是 `nomi-local://`，读面不放地址）。「复刻」在用户心里多半是「照着那一帧的构图出」。推荐：本 PR 不做，归到「选中即引用」那条设计线（关键帧作为可引用素材进芯片），那里决定引用的形态；读面届时只需多一个素材 id。
