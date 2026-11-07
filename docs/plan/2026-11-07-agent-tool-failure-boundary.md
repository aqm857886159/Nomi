# Agent 工具失败走一个边界——说清哪错该填什么、同错三次就停、失败带码

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 设计卡（9 格全填：碰花钱——参数错会导致重付一次；长跑 / 可打断——一回合几十次工具调用）。
> 来源：用户 11-07「经常出现什么参数不对 重试等问题」「用户给我反馈是他经常遇到参数不合法什么的 然后重试什么的」；
> Agent 质量调研（失败分类第 1 / 2 / 4 类、修法选项、`draft_shots` 25 种错写探针）；工具参数修复路线的第 ① ③ 步（第 ② 步「条件依赖事前编译」不在这一刀）。
> 协调已拍板的修法：类 1 选 A（一个格式器）、类 2 选 A（立即失败进同一个计数）、类 4 先证等价再选 B（删渲染层第二道校验）。
> 不做：类 1 选项 B（宿主把错键静默改成对的键）。

### 功能分类
- [ ] 新界面 / 改交互
- [x] 花钱
- [x] 长跑 / 可打断
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [ ] 新增功能 / 性能

## ★0 先查别人

| 出处 | 它怎么做 | 对我们哪个决定的影响 |
|---|---|---|
| Anthropic「Handle tool calls」https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls （2026-11-07 读） | 工具失败回 `is_error:true`，官方要求「写出错在哪、下一步该试什么」，不要只写 failed；模型对缺参数通常会自己改 2–3 次再向用户道歉 | **确认了**「同错 3 次就停」这个数（与现有 `LANE_REPEATED_FAILURE_BLOCK=3` 一致）；**改了**形状层报错的写法：每条 issue 必须点名字段 + 合法值 / 近似键 + 一个对的例子 |
| MCP SEP-1303「输入校验错误作为工具执行错误」https://modelcontextprotocol.io/seps/1303-input-validation-errors-as-tool-execution-errors.md | 入参校验失败不当协议错误，而是作为工具执行错误回到模型上下文，让模型「带着修正的参数重试」 | **确认了**拒收照旧作为工具结果回给模型（不改成协议错或直接终止回合）；**改了**这份结果的内容：不再回显整份入参（pi 默认 `Received arguments` 12 镜一次 4–5k 字符），只回出错字段 |
| Vercel AI SDK `repairToolCall` / `InvalidToolInputError` https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling | 入参不合 schema 抛结构化错误（带 toolName / input / cause），修复回调由应用自写；框架不会自动替你修 | **确认了**修复点放在我们自己的 `prepareArguments` 边界，不指望 pi 替我们改文本；**确认了**不做静默纠正（任务书禁止类 1 选项 B） |
| Claude Code 工具报错（社区 issue 36518 / 5219，非官方） | 形状层报 `InputValidationError: required parameter x is missing / unexpected parameter y`，逐个点名字段 | **改了**未知键那一类：给近似键（`duration`→`durationSec`）和这一层允许的字段名；Nomi 现状只回 `unrecognized_keys` 裸 JSON |
| LangGraph `GRAPH_RECURSION_LIMIT` https://docs.langchain.com/oss/python/langgraph/errors/GRAPH_RECURSION_LIMIT.md | 通行做法只有全局步数上限，「同一错误重复」框架不管；路由回工具节点而状态不变就会一直重复同一错误 | **确认了**熔断按「工具 + 失败码 + 字段」认墙（现有设计）而不是加全局步数；**改了**覆盖面：pi 立即失败必须进同一个计数 |

出口：Anthropic「Handle tool calls」https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls · 同错重试 2–3 次后转向用户说明 · 确认了我们「撞满 3 次 → 拦下并转 `ask_user` 问一个问题、用户再说一句话就清零」这条出口；本次把它扩到形状层，挡人保护的释放条件（用户下一句话）不变。

## ★1 用户怎么用

当我在 Agent 面板里说「把这三镜改成 16:9、每镜 5 秒」，我想 Agent 要么一次写对，要么写错一两次后自己改对，实在改不对就停下来问我一个我答得上来的问题，以便我不用盯着一串红叉、也不会因为它乱试而多付一次钱。

1. 用户发一句话；Agent 调 `draft_shots` 等工具。
2. 参数写错（多一个键、取值不在表里、类型不对、缺字段）。
3. 模型收到：工具名 + 码 `tool_arguments_invalid` + 每个出错字段一行（路径、收到的短值、合法值或「你是不是想写 X」、这一层可填的字段）+ 一个对的例子 + 下一步。
4. 面板上这一步写「它这次的参数不对，这一步没有执行」，展开是「shots.0.taskKind：要填 text_to_image、image_edit、text_to_video、image_to_video 之一」这种字段级中文（英文界面英文）。
5. 同一工具同一类错第 3 次：模型收到「别再发了，换条路或用 ask_user 问用户」，面板上是一张提问卡（带「试了 3 次」那句宿主话）。
6. 用户回答 → 计数清零，Agent 继续。

不做什么：不改任何工具的参数 schema（那是修复路线第 ② 步）；不静默把错键改成对的键；不做条件依赖（锚 kind / carrier）的事前编译；不改供应商侧拒收（类 8）与目录错因（类 6）。
已知坑：pi 的 `prepareArguments` 只拿得到参数、拿不到 toolCallId，也设不了 `terminate`——形状层的「第 5 次直接结束回合」做不到（见 ★3）；`Received arguments` 里的用户正文不再回给模型（隐私边界照旧：只回短的标量值）。

真实任务：
- 用户反馈那一轮的形状（21 次工具调用、14 次重试，`draft_shots` 连撞）——用 dev 构建 + 隔离资料 + 假模型端点按同样的错写序列回放，修前修后各一次（★9 真实场景复现）。
- 质量调研探针里的 25 种 `draft_shots` 错写，逐条过真 lane（含 pi 的 TypeBox 层），而不是探针那样绕过 pi。
- 10-29 反馈包 `stage_shot` 7 次调用 4 次失败、失败码全空——同形状的错误在修后必须带码。

指标（目标 → 信号 → 指标）：
- 主指标：形状层拒收里「点名字段 + 合法值 / 近似键 / 期望类型」的比例。基线：§3.2 Zod 层 10 条里 0 条给近似键、pi 层 0 条给合法值；目标 100%。量具：`electron/agentLane/laneToolInputBoundary.test.ts`（25 条错写逐条断言）。
- 质量指标：同一错误连发 6 次时第几次被拦。基线：形状层永不拦（调研里的两条复现）；目标第 3 次起拦。量具：`electron/agentLane/laneToolInputBoundary.test.ts`（真 lane：真 pi 循环 + 本机 HTTP 假模型，25 条错写与「同错 ×6」在同一个文件；原计划的 `tests/agent-runtime/lane-tool-input-boundary.test.mts` 不另建）。
- 护栏指标：失败码为空的工具失败比例。基线：10-29 包 16/16 为空；目标 0。量具：同上测试断言面板投影 `failure.code` 非空；线上量具：新增匿名事件 `agent.tool.failed`（`electron/telemetry/telemetryEvents.ts`）。
- 真模型被拒后一次改对率 / 平均重试数：未验证：本线不花钱，由协调的测试集跑器跑（命令写在报告里）。

### ★1b 连带界面
- Agent 面板工具行（`useAgentPanelV4Data` → `laneToolFailureSummary`）：标题按码查词条；展开按 issue 类型逐行说「哪个字段 · 该填什么」。没有词条的码**不露码**，说「这一步没做成，Agent 会看情况换个办法」。
- 撞满 3 次后的提问卡（`ask_user` 的 `askReason: retry_exhausted`）：沿用现有词条，不新增文案。
- 主进程日志 `lane-tool-failed`：照旧只记工具名、首行、连续次数；首行现在稳定为 `Validation failed for tool "X" (tool_arguments_invalid)…`。
- 匿名事件：新增 `agent.tool.failed`（工具名闭合表、失败码、第几次、是否熔断、模型种类 `modelClass`：builtin / local / custom），不带任何用户文字。

### ★1c 老用户
- 老会话转录里 pi 默认文本的失败行（`Validation failed for tool "X":`，不带码）：升级后投影层按转录里的原参数重推同一份字段清单（`laneToolInputBoundary.failureOf` 认这个旧头），面板照样说「哪个字段 · 该填什么」；原参数不在（上一页历史）或重推不出来的只显示码对应的中文 / 英文，没有词条的码不露码。不再用正则翻英文（那条路删了）。不迁移、不改落盘格式。
- 老会话里有 `details.failure` 的失败：信封形状只加了可选字段（`kind` / `allowed` / `nearest` / `min` / `max`），老信封照读。
- 设置 / 项目 / 模型：不碰。遥测：用户已同意的告知范围 1 含「失败类别、Agent 工具轨迹」，新事件按范围 1 入队；没开遥测的人一条不发。
- 退回上一版：新信封多出的可选字段被老版 `laneToolFailureOf` 忽略；新事件名老版不认识，只是不再入队。

## ★2 谁说了算

- 概念「工具入参拒收」→ 唯一 owner：`electron/shared/agentLane/toolInputIssues.ts`（issue 清单的类型、三个来源的适配、近似键、渲染成模型文本与公开信封）。不新增概念目录；属于现有 `lane 工具失败` 概念（`laneToolContract.ts` 的 `renderLaneToolFailure` 仍是唯一的模型文本出口，它调本文件渲染 issue 行）。
- 形状层边界：`electron/agentLane/laneToolInputBoundary.mts`——在 `laneHost` 把**全部**交给 pi 的工具（lane 描述符 + 原生工具）包一层 `prepareArguments`，用 pi-ai 导出的 `validateToolArguments` 判过不过，不过就生成 issue、记熔断、抛我们的文本。pi 的默认文本再也到不了模型。
- 熔断计数：仍是 `laneRepeatedFailure.mts` 一份；形状层与执行层记进同一个 tracker。
- 门表（`node scripts/door-map.mjs`）：`argumentFailure` 写 2 扇（laneTools / laneExtendedDesktopPorts，本次合并成同一个构造器，旧函数删）；`renderLaneToolFailure` 1 扇；`laneFailureFromDecision` 2 扇；`humanizeToolFailure` 1 扇（删）；`laneToolFailureSummary` 2 扇；`createLaneTools` 1 扇；`applyCanvasToolCall` 5 扇（其中只有 `proposalTxn` 带 Agent 参数进 `stage_shot` / `patch_shots` 两支）。
- 同一份事实存几份：issue 清单 1 份（拒收那一刻算出）；面板对形状层失败的信封由主进程从转录里的原参数**重算**（同一个函数、同一个 schema），不另存一份。
- 不靠「东西不见了」猜意图：是。

## ★3 一致与复用

以前定过什么：
- 2026-09-22 `argumentFailure` 头注：「说法只留这一份」「只带类型名与字段名，绝不回传收到的值」——仍算数；本次放宽一条：数字 / 布尔 / 枚举字段上 ≤32 字的短串回给**模型**（模型自己刚发的，不是新泄露），公开信封和遥测仍不带值。
- 2026-09-22 熔断按「工具 + 码 + 字段」认墙、只有本工具成功才清墙、用户新消息清零——仍算数，原样复用。
- 2026-09-18 C5 信封走 `after_tool` 的 `details`——仍算数；形状层没有 `after_tool`，所以改由投影时按原参数重算（不发明第二条运送通道）。
- `laneHost.mts:274` 的「additional properties → 补一个示例」补丁：按文本匹配，本次删掉，例子并进格式器。
- 修复路线第 ①（一个格式器）③（熔断覆盖立即失败）步已批；第 ② 步不在本刀。

三条路：
1. 沿原方向修（在显示层再补几条正则、在 `toProviderMessages` 再补几条文本匹配）：不选，那正是现在两套话、熔断看不见的来历。
2. 换做法：在 pi 的官方钩子 `prepareArguments` 上收口，先用 pi 自己导出的校验判过不过，再由我们的格式器写话——**选这条**。不改依赖源码、不改工具 schema。
3. 删：把 schema 校验整个交给 Zod、模型可见 schema 放松——不选，那会改模型可见 schema（修复路线第 ② 步的范围），且所有调用都变松。

复用：`validateToolArguments`（pi-ai 导出）、`typebox/compile` 的 `Compile().Errors()`（pi 自己用的同一个校验器，结构化错误带 `keyword / instancePath / params`）、`closestParameterKey` 的编辑距离（从 `executionContract.ts` 挪到共享层，一份）、`laneRepeatedFailure` tracker、`renderLaneToolFailure`、`laneToolFailureOf`、`recordTelemetryEvent`。第二份定义：无。

渲染层第二道校验（`applyCanvasToolCall.ts` 两处）：选 B（删）。等价证明：
- 带 Agent 参数进 `stage_shot` / `patch_shots` 两支的调用者只有 `applyProposalBatch`，它的唯一生产调用者是 `canvasWriteTarget.ts`；
- `executeCanvasWriteTarget` 在同一进程、同一调用栈里先用**同一个 schema 对象**（`directorWriteSemanticInputSchema` / `canvasWriteSemanticInputSchema`）parse 过，传下去的是 `parsed.data`；
- 两个 schema 对自己的输出幂等（`parse(parse(x)) ≡ parse(x)`），测试逐个夹具断言；
- 所以第二次 parse 对这条路恒成功，失败分支不可达；删掉后由测试钉住「只有一个生产调用者」和幂等。

pi 框架限制（如实写）：`prepareArguments` 抛错只能变成 `terminate:false` 的立即结果，所以形状层撞满后**拦得住、说得清、转得了提问**，但结束不了回合。实现时把执行层原有的「第 5 次直接结束回合」也删了：墙现在判在入参边界（第 4 次起在执行之前就拦下），执行层根本走不到第 5 次，那条分支不可达；两层同一个停法。兜底是：第 3 次正文末尾带「停」那句，第 4 次起每一次都是拦截话术（`tool_retry_stopped`，不再给新的修改指引），并上报 `breakerTripped`。

残余风险（2026-11-07 协调定 A）：模型无视拦截、一直调同一个工具时，被拦的调用不执行、不花生成的钱，但每次多一次模型请求；宿主的回合请求上限（`maxModelRequests`，默认不设）只在 `before_tool` 判，立即结果绕过它，截不断这个循环。本 PR 用 `it.fails` 钉住这个缺口；「连续不听就像用户点停止一样中止这一轮」作为后续一刀，由协调按真模型测试集里「同错连续 ≥3 次」还剩多少定优先级。

## ★4 全状态

- 空：没有失败——面板不变。
- 加载：工具在跑——不变。
- 成功：不变。
- 失败（形状层 / Zod / 准入层）：一行「它这次的参数不对，这一步没有执行。」+ 展开逐字段「字段 · 该填什么」；模型侧见 ★1 第 3 步。
- 部分成功：批量起草里一镜错——准入层原本就整批拒，面板说出错的那一镜字段（`shots.2.durationSec：要在 4～15 之间`）。
- 取消中：用户点停——pi 合成「Tool execution was cancelled」，不进计数、不发事件。
- 过期：老会话里旧失败——见 ★1c。
- 能力不可用：本次不新增此态；不认识的失败码 → 「这一步没做成，Agent 会看情况换个办法。」（不露码），下一步由 Agent 自己说。
- 撞满 3 次：模型收到拦截话术；面板是 `ask_user` 提问卡（已有）。
- 文案走 i18n（zh / en），不写免费 / 不计费类断言。

## 5 中途表

| 状态 \ 打断 | 停 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 形状层拒收（什么都没执行） | 回合停下；拒收行留在转录 · 不扣 · 回执在面板工具行 | 同停；重开后转录里的拒收行照显（面板按原参数重算出字段） · 不扣 · 同左 | 拒收是本机校验，与网络无关；下一次模型请求失败走现有网络错误 · 不扣 · 同左 | tracker 在内存，重启清零（与用户新消息清零同义）· 不扣 · 同左 | 用户连发：每条新消息清零计数 · 不扣 · 同左 |
| 执行层 / 准入层拒收（起草没提交） | 同上 · 不扣（准入在提交前）· 同上 | 同上 | 同上 | 同上 | 同上 |
| 撞满 3 次、等用户回答提问卡 | 卡被收回，计数照旧到下一句话 · 不扣 · 提问卡 | 重开后提问卡按现有等待恢复 · 不扣 · 同左 | 不影响 · 不扣 · 同左 | 同关窗 · 不扣 · 同左 | 回答一次即清零 · 不扣 · 同左 |
| 报价卡已出（参数早已通过） | 本次不改这条路 · 按现有报价卡规则 | 同左 | 同左 | 同左 | 同左 |

## 6 外部数据与失败

- pi 0.85.1 的工具校验（`@earendil-works/pi-ai` `validateToolArguments`，源码 `dist/utils/validation.js`）· 偏差：它的报错丢掉 `allowedValues` / 多余键名并回显整份入参；我们只把它当「过 / 不过」的判据，文本自己写 · 失败时：若我们算不出任何结构化 issue（不应发生），回一条 `(root)` issue + pi 首条错误行（去掉回显的入参），测试钉住。
- TypeBox 1.3.7 结构化错误（`typebox/compile` `Errors()`）· 偏差：`anyOf` 会给每个分支各一条，我们按路径 + 关键字去重并封顶 8 条。
- 模型发来的参数（用户输入经模型转述）· 偏差：可能含用户正文 · 模型文本只回短标量；公开信封与遥测不带值。
- 匿名事件上报· 偏差：无；字段闭合表，未知工具名记 `other`，模型家族闭合表，未知记 `other`。

## ★7 性能

不是新增功能，但这条边界每次工具调用都过一遍，按「最坏规模」量一次：
- ① 新增操作：无用户操作；新增的是每次工具调用的一次额外校验（pass 时）与拒收时的 issue 计算 + 投影重算。
- ② 最坏规模：一个回合 50 次工具调用，其中 20 次被拒（12 镜 `draft_shots` 的大参数）。
- ③ 预算：整轮边界额外开销 ≤20ms（相对一次模型往返的秒级可忽略；超过说明校验没有缓存）；单次投影重算（20 条拒收）≤5ms。
- ④ 场景 `agent-tool-input-boundary-50`（`tests/perf/scenarios/agent-tool-input-boundary-50.json`，量具 `tests/perf/agent-tool-input-boundary-bench.mjs`，跑法 `pnpm run perf:scenarios -- --id agent-tool-input-boundary-50`）。实现线本机 5 次（`--measure-only`，load 不吵）：`turnBoundaryMs` 中位 5.7ms / p95 7.4ms（预算 20），`projectionRecomputeMs` 中位 3.3ms / p95 3.8ms（预算 5）。登记为待测，基线由协调在安静窗口写入。

## 8 真实条件

- Windows：unverified（纯主进程逻辑，无平台分支）。
- 英文界面：截图 en 一张（面板字段行）。
- 最小窗口：unverified（不改布局）。
- 真规模：12 镜 `draft_shots` 参数进 perf 场景与回放。
- 干净安装：隔离资料目录 + 假 HOME 起 dev 构建。
- 真付费：不跑（本线不花钱）；真模型改对率由协调测试集跑器跑。
- 键盘全程：不适用（无新交互）。

拍板图清单：不适用——不新增 / 不改布局，只改既有工具行展开里的文字内容（同一位置、同一组件）。

## ★9 验收与回滚

验收清单（动手前写全；实现线按它自验，附「反例 → 结果 → 证据」表；验收线只核这份）：

A. 一个格式器（类 1）
1. §3.2 的 25 条 `draft_shots` 错写**过真 lane 路径**（pi `prepareArguments` + `validateToolArguments` + `execute` 内 Zod + 准入层）：凡被拒的，模型文本都含出错字段路径，且含合法值 / 近似键 / 期望类型三者之一；3 条本应放行的仍放行。
2. 未知键：`shots.0.duration` 回「did you mean `durationSec`」；`shots.0.ratio` / 顶层 `aspect` 回这一层可填的字段名（近似键只在真的接近时给）。
3. 枚举：`taskKind: "video"` 回四个合法值 + 收到的 `"video"`。
4. 类型：`candidate: "doubao…"` 回期望 object，且附一个对的例子（工具 `examples[0]`）。
5. 模型文本里**不再出现** `Received arguments` 整份回显，也不出现以 `[` 开头的裸 issue JSON。
6. pi 原生工具（coding 工具等）形状错也走同一个格式器（同一个包装点覆盖全部工具）。
7. 执行层 `descriptor.execute` 抛出的 `ZodError`（动词 → 契约语义输入那一步）也走同一个格式器，不再变成裸 JSON。
8. 准入层的拒收（`unknown_parameter` 等）进同一份 issue 清单：公开信封带字段 + 合法值 / 近似键 / 范围，模型文本照旧有原中文句 + 同一格式的 issue 行。

B. 熔断覆盖立即失败（类 2）
9. 真 pi 循环里，同一形状错连发 6 次：第 1、2 次是 issue 文本；第 3 次起文本含「has failed the same way 3 times」那句拦截话术 + `ask_user` 指引；之后模型调 `ask_user` 时带 `askReason: retry_exhausted`。
10. 不同字段的错不合并成一堵墙；本工具成功一次清墙；用户新消息清零（复用现有测试，不能红）。
11. 执行层（`after_tool`）连败第 3 次时正文末尾当场带上同一句「停」，第 4 次起在入参边界拦下；原「第 5 次 terminate」删掉（墙先判，执行层走不到第 5 次）。`laneRepeatedFailure.test.ts` 全绿。
11a. 工具自己准备步骤里的拒收（`LaneDomainFailure`，如 `parameters.aspectRatio`、画布写的 `rejectGeneratingNodes`）走同一个出口：同一个正文、同一个计数器、信封带码（`wrong_verb` 等）。
11b. `before_tool` 里桌面端口准备步骤抛的领域拒收（`LaneDomainFailure`，如 `capability_authority_invalid`）同样记进熔断、第 3 次带「停」、发遥测；要换界面（`surface_authority_denied`）、没有权限（`toolAccessDenial`）、审批闸的用户拒绝 / 取消不计数（模型改不了 / 是用户的决定），面板信封不重推（异步、有状态）。

C. 失败带码、细节不吞（类 4）
12. 形状层失败在面板投影里有 `failure.code === "tool_arguments_invalid"` 和 issues（由主进程按原参数重算），失败码不再为空。
13. `applyCanvasToolCall.ts` 里两处第二次 safeParse 删除；等价证明测试：`applyProposalBatch` 只有 `canvasWriteTarget.ts` 一个生产调用者、两个 schema 对自身输出幂等。
14. `LANE_TOOL_OWN_FAILURE_CODE_LIST` 每个码在 `agentToolFailure` zh/en 都有词条（`check:error-surface` 规则④照旧绿）；面板遇到没有词条的码，标题与展开里都**不出现码本身**（`unknown` 词条去掉 `{{code}}`）。
15. `laneFailureFromDecision` 里 `generation_not_started` 的下一步不再指向不存在的「failure detail」。

D. 面板说出字段（item 4）
16. zh：`shots.0.taskKind：要填 text_to_image、image_edit、text_to_video、image_to_video 之一`；未知键：`shots.0.duration：没有这个字段，是不是要写 durationSec`；类型：`shots.0.candidate：要填对象`；缺：`shots.0.prompt：缺这一项`；范围：`…：要在 4～15 之间`。
17. en 同上英文。
18. `residentToolDisplay.ts` 的 `humanizeSchemaIssues` / `humanizeValidationProse` 与 `issueInvalidArgs`「参数不合法」兜底同批删除；全仓再 grep 不到「参数不合法」出现在 Agent 面板路径。

E. 线上可见（item 5）
19. 新事件 `agent.tool.failed` 登记进 `TELEMETRY_EVENT_NAMES` / `TELEMETRY_EVENT_MIN_SCOPE`（范围 1）/ `isTelemetryProps`；props 恰好五格：`toolName`（标识符形状，否则 `other`）、`failureCode`（标识符形状，否则 `unknown`）、`attempt`（1–5，封顶 5）、`breakerTripped`（布尔）、`modelClass`（builtin / local / custom，判据同出门的模型目录：判种子不判地址）；夹带任何其它键或用户文字的事件被 `isTelemetryProps` 拒。
20. 没开遥测时一条不入队（复用 `enqueueTelemetryEvent` 的门）。

F. 删旧（P1）
21. 同批删：`laneHost.mts` 的 `/additional properties/` 补丁；`argumentFailure` 旧构造器（两扇门合成一个）；`residentToolDisplay` 两个正则翻译器；`issueInvalidArgs` 兜底；`laneToolFailureText` 的露码兜底。
22. 走查脚本里认「参数被拒」的正则（`ARG_REJECTED`）仍认得新文本（新文本首行保留 `Validation failed for tool`）。

反例（这一类会从哪回来）：
- 另一个调用者：原生工具 / 延迟工具（`laneExtendedDesktopPorts`）/ 执行期 ZodError → 第 6、7 条。
- 另一个供应商：模型家族不同、发 `null` 当不设 → pi 的 `normalizeOptionalNulls` 先放行，我们不重复判。
- 另一个版本：老转录 → ★1c，面板不报错、不露码。
- 另一个形状：`anyOf` 多分支报错刷屏 → 去重封顶 8 条，测试钉住。
- 旧数据：信封老形状 → `laneToolFailureOf` 照读。
- 反例 · 不该拦的：缺 `taskKind`、`shots` 写成单个对象（容忍层包成数组）、`seed: null` 照旧放行（第 1 条里的放行项）。更正：动手前这里写过 `parameters.aspectRatio` 放行——错的，2026-10-05 起它一律拒（比例只有一个家：镜头上的 `aspectRatio`），拒在工具自己的准备步骤里，现在带码 `wrong_verb`（11a）。
- 反例 · 模型无视拦截连调同一工具：3 次错 + 7 次改对的调用 → 7 次全被拦、一镜都不起草（墙到用户下一句话才倒）；不设上限时 10 次调用 = 10 条结果、11 次模型请求；设了上限（5）也截不断立即结果的循环——`it.fails` 钉住，见 ★3 残余风险。
- 反例 · 另一个入口：工具准备步骤的拒收（11a）、`before_tool` 准备步骤的领域拒收（11b）、执行层第 3 次（11）。

真实场景复现：
- 用户的流程：用户反馈——Agent 起草批量分镜，一回合 21 次工具调用、14 次重试，面板一串红叉、「参数不合法」。
- 我走的：dev 构建 + 隔离资料目录 + 假 HOME + 本机假模型端点，按「同一形状错 × 6 + 改对一次」的序列回放（零额度，不连真模型、不生成）。
- 差别：真模型是自己决定怎么改，这里是脚本化的回复；只证明「宿主怎么回、面板怎么说、什么时候拦」，不证明真模型的改对率。
- 修前看到什么算复现：面板 6 行红叉、展开是英文 `Validation failed…`、第 6 次仍未被拦。
- 修后看到什么算好了：第 1–2 次面板写出字段与合法值（zh / en 两张截图），第 3 次起是拦截话术、模型转 `ask_user`。

回滚：revert 本 PR 的实现提交即可（无落盘格式变化、无迁移）；遥测事件撤掉后老版本不认识该事件名、只是不再入队。
独立验收：四类（花钱、长跑 / 可打断），合并前需另一条线按本清单验收。
