# 设计卡：Agent 只写「哪个模型 + 想要什么」，参数由产品替它落

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 协调会话 2026-11-15 起草；用户 2026-11-15「按推荐」定了方向。分刀实现，本文件是第 1 刀（单句柄）的实现合同，后几刀开工前在这里续写。
> 依据：Agent 上下文架构调研（方案丙）+ 代码事实核查（主干 556bc3388）。
> **两处还等用户定**（见「等用户定」），不挡第 1 刀和第 2 刀前半。

```
改动名：Agent 意图落参      线/负责人：协调设计，实现线分刀      类别：[花钱][新界面（卡上一行，待定）][其他：Agent 行为、数据格式]
```

## ★0 先查别人

| 出处 | 它怎么做 | 对我们哪个决定的影响 | 怎么查的 |
|---|---|---|---|
| LibTV 画布助手的全局设置 | 默认每次生成都先确认；开关「自动生成图片/视频/音频/剧本——开启后无需逐次确认」；「积分累计消耗达到 N 时提醒我」 | **确认了**：钱前确认是默认、全自动是显式授权。它的确认面要发消息才看得到，没看 | 协调会话自己打开看，截图在仓库外 |
| [OpenAI function calling 指南](https://platform.openai.com/docs/guides/function-calling) | 模型不知道的参数不要让它填；用结构防非法状态；工具表一回合内不换 | **改了**：参数键和合法值不再让模型写，由宿主落；第 3 刀不每回合换工具表 | 调研线读全文页（经摘要工具） |
| [Anthropic《Writing effective tools for AI agents》](https://www.anthropic.com/engineering/writing-tools-for-agents) | 一件事合成一个工具；用人看得懂的标识；报错说下一步 | **改了**：模型句柄用列表里那一串可读名字；落地结果和拒收都带下一步 | 调研线读全文 |
| Anthropic《Advanced tool use》 | 延迟加载工具、入参示例 | **确认了不采用**：只在它的原生协议里有，我们按通用协议写（用户 10-29） | 调研线读全文 |
| pi SDK 0.85.1 源码 | 有 before_tool / after_tool / prepareArguments，没有 repairToolCall | **确认了**：落参放在宿主执行里就行，不等 SDK 新能力 | 调研线读 d.ts |
| 仓库 10-05 铁律「说的=摆的」（`docs/plan/2026-10-05-experience-iron-laws-batch1.md`） | Agent 说的、草稿、节点、付费卡四处同一个值；不回落、不钳值 | **卡住了一个决定**：值落不成原样时不能悄悄换，见「等用户定」 | 协调读原文和两处代码头注释 |
| 仓库内调研：每回合按模型换 schema | 已证伪 | **确认了**：不做「表从档案生成」那条路 | 引用，未重开 |

出口：这次不新增会挡住人的保护；值落不成原样那一处今天就是拒收，改法只会减少拒收或保持不变。

## ★1 用户怎么用

当我对 Agent 说「把文稿拆成 4 个竖屏镜头，每个 8 秒」，我想它一次就把镜头起草对，以便我看一眼确认卡就能生成，不用看它来回试。

1. 创作者说一句要什么。
2. Agent 读文稿、（需要时）读模型列表，每个镜头只写：模型那一串名字、比例、秒数、清晰度档、要不要声音、用哪几个参考、谁是锚。
3. 产品按参考推出方式（面板同一个函数），按档案把意图摆成真参数键和值。
4. 摆的时候只是把键放对了、值没变：不说。值摆不成原样：见「等用户定」。
5. 做不到的（这个模型做不了这类事、素材找不到、锚卡用了视频模型）：拒一次，告诉 Agent 下一步。
6. 确认卡照旧：一组指向 + 一行只读摘要 + 决定栏。

不做：不让聊天里长出编辑器；不为单个供应商写特例；不每回合换工具表；不改面板、节点、付费卡的结构；不动技能索引。
已知坑：模型会自己编一个没人说过的值（比如 8 秒），产品分不清是创作者说的还是它编的——所以文案写「原本要」不写「你说的」；首帧类方式画幅跟图走，「竖屏」靠锚图按 9:16 起草来满足，不算偏差。

真实任务（评测题库 `tests/ux/agent-param-eval.cases.json` 里的真题）：P06（文稿拆竖屏镜头，11-07 拒 9 次）、P26（锚卡 + 视频模型，拒 8 次）、P33（分镜子对象，拒 8 次）。

指标（目标 → 信号 → 指标，都点名量具）：
- 主指标｜一次写对：第一次起草调用就被接收的比例。量具 `tests/ux/agent-param-eval-real-model.walk.mjs`（39 题，真文字模型）。基线：主干 11-09 是 43.2%，每刀动手前在当时的主干重跑一次当基线。目标：第 1 刀后身份类拒收 ≤2 次 / 轮（11-15 那轮前 22 题是 13/24）；第 2 刀后一次写对 ≥80%。
- 质量指标｜整题通过率不降。判据用主干那一版；已关分支上放松过的两处（「选对工具」改看结果、重试次数不再判过不过）不带过来，要带单独评。
- 护栏｜面板这条路的请求体逐字节零差异；铁律「说的=摆的」宿主矩阵 `tests/experience-laws/intentShownEqualsDrafted` 保持绿；每次请求固定带的字数不增（`scripts/model-face-baseline.json` + `scripts/check-tool-face.ts`）。
- 缺量具：缓存命中率（评测没记 cached tokens）——未验证：缺量具，第 3 刀再补。

### ★1b 连带界面

- Agent 起草工具的回执（模型看的，中英）：摆对了什么、哪些值摆不成原样及合法值——这是合同的一部分，和工具表一起评审。
- 拒收文案：每条带下一步能做什么。
- 模型列表行：一串可原样抄回的名字。
- 付费确认卡 / 回执卡的那一行：等用户定。
- 节点、分镜行：显示的就是摆好的真参数，不加东西。

### ★1c 老用户

- 旧草稿 / 分镜计划里的 `{providerId, modelId}`、`modeId`、`taskKind`：第 1 刀**不动落盘形状**（名字只是模型面的东西，宿主查表后照旧写 `{providerId, modelId}`），所以没有迁移；用 `tests/fixtures/old-user-data/` 全部版本回放证明照常读。第 2 刀若改形状再按「读入时一次换成新形状、旧形状继续能读」做。
- 旧节点上的 `archetype{id,modeId,variantId}` + `modelKey` + `modelVendor`：不动。节点是面板的家，这次不迁。
- **对话历史里的旧工具调用会原样回放给模型（第 1 刀核过）**：lane 的 `toProviderMessages`（`electron/agentLane/laneHost.mts`）只改写用户输入那一种消息，助手消息（含工具调用入参）和工具结果原样交给 `convertToLlm`，从上次压缩点往后全部进上下文。所以旧会话里模型会看到旧的 `modelId` / `candidate` 入参和旧列表行。影响：不会让旧会话读不懂（历史调用不按当前表重新校验，回放照常）；最坏情况是模型照旧写法再写一次 `modelId`——当前表是 strict，会拒一次，拒收正文点名 `model` 字段（近似键提示 + 「放错位置的字段」对照表把 `modelId` / `vendor` / `providerId` 指向 `model`），下一次即对。不改写回放内容（改写历史 = 让模型看到自己没说过的话）。
- 外部 MCP 客户端：走手写传输，不看 `draft_shots` 的表；它的生成工具 `nomi_operation_plan` 的 `vendor` / `modelKey` 写着「取自 `nomi_read(target=models)`」，所以对外模型行**保留 `modelId` + `vendor`**、逐字节不变（协调 11-15 拍板，见下「第 1 刀」）。
- 退回上一版：落盘没变，退回能打开。

## ★2 谁说了算

| 事实 | 今天几处 | 改后唯一主人 |
|---|---|---|
| 这个模型这个方式认哪些参数、默认什么 | 2 套（面板 `resolveRenderedControls` / Agent `videoCompileOptions`、`archetypeCompileOptions`），共用档案 | 档案入口 `resolveModelArchetype` + `declaredModeParams` / `effectiveModeParams` |
| 连了什么输入用哪种方式 | 2 个（面板 `modeForInputs`，Agent `videoModeForPlan`） | `modeForInputs`；`videoModeForPlan` 删 |
| 镜头用哪个模型 | 3 处（`modelId`、`candidate.{providerId,modelId}`、分镜子对象里的 `modelKey/modelVendor`） | 一个句柄，列表行原样那一串（第 1 刀） |
| 意图 → 真参数 | 3 层（主进程语义层拒收、编合同、渲染层 `plannedNodeMeta` 静默换默认） | 主进程一处落地函数；渲染层那层删 |
| 落的时候改了什么 | 0 处 | 落地函数的返回；带到草稿镜头上（草稿镜头 → 待付费镜头 → 卡的说明行） |

没有靠「东西不见了 / 状态变了」猜意图：意图是工具入参里的显式字段。

## ★3 一致与复用

- 以前定过、还算数：10-05 铁律「说的=摆的」；10-29 模型可见的表按通用协议写、不为供应商写特例；7-17「视频默认 16:9，已连输入全竖才 9:16」；10-22「只有连线、选模型、新卡这几个手势铺默认」；11-15 档案解析收成一个入口（#1533、#1536、#1538 已合）。
- 三条路：沿原路修（列表行带事实 + 拒收说全，#1535 试过，真模型一次写对 41.5%，没到 60% 的目标，已关）；**换做法（选这条，用户 11-15 点头）**；删（不让 Agent 起草镜头——是核心能力，不可行）。
- 「用户按任务声明的默认模型」这个概念近 14 天已有 2 个 fix；这一刀不是再补一刀，是独立调研线做完类根因复盘、用户点头后的换做法。碰到它的提交带 `Direction-Check: docs/plan/2026-11-15-agent-intent-landing.md`。
- 复用：面板的 `modeForInputs`、`declaredModeParams`、`effectiveModeParams`、`resolveModelArchetype` 都是纯函数、主进程已能直接调。`preferredVideoAspect`、`videoAspectDefaultPatch` 等 4 个绑着画布节点类型，Agent 路不直接调，改成共用它们下面的纯规则（第 2 刀定具体切法）。
- 实测提醒：两张图不一定是首尾帧——取决于边上的槽角色（`[first_frame, image_ref]` → 全能参考）。意图里要有「谁是首帧、谁是尾帧、谁是参考」，不能只数张数。

## ★4 全状态

- 起草成功、值都是原样：卡和今天一模一样。
- 起草成功、只是键放对了：不说。
- 值摆不成原样：等用户定（甲：卡上一行；乙：拒收退给 Agent）。
- 模型做不了这类事 / 锚卡用了视频模型 / 素材找不到 / 没配默认模型：拒一次，带下一步（换哪类模型、去哪加素材、去设置里选默认）。
- 取消中 / 已发出 / 失败 / 部分成功：付费卡现有行为，不改。
- 过期（起草后模型被删或换了档案）：确认前再落一次，落不成按上面同一套。
- 能力不可用（模型没配钥匙）：现有路径，不改。
- 会被数据撑开的地方：说明行最多 4 行（比例、时长、清晰度、声音），镜号写区间。

## 5 中途表

起草不花钱，钱只在确认卡之后。起草中 / 卡开着 / 已发出 × 停 / 关窗 / 断网 / 重启 / 连点：全部沿用现有行为，这次不改；实现线按现有走查（`agent-spend-card*.walk.mjs`）逐格核一遍、写进报告，有一格和现有不一样就停。

## 6 外部数据与失败

- 文字模型写的工具入参：当外部数据。键写错层、供应商写在镜头层、方式和参考对不上 → 产品摆对；不认识的键 → 拒并说该放哪。
- 供应商的合法值：只从档案来（档案对着供应商文档核过，#1510、#1531）。
- 未知失败不甩给创作者的钥匙。

## ★7 性能

①新增操作：无新的用户操作；每次起草多一次落地计算（第 1 刀只多一次按名字查表，O(目录行数)）。②最坏规模：一次起草 50 个镜头。③预算：落地全部 ≤100 ms。④场景：登记 `agent-draft-landing`（`tests/perf/scenarios/`），第 2 刀交基线数。

## 8 真实条件

真文字模型评测：要（每刀前后各一轮，只花文字费，协调会话跑）。英文界面：卡上那一行中英两轨。最小窗口 / 窄面板 320。Windows：`unverified`。真付费生成：不需要（面板路请求体零差异即可免，Agent 路走假上游走查）。

## 拍板图清单

等用户定。选甲：付费卡板加一个元素（说明行，中性），清单随样张拍板生成。选乙：没有界面变化，写「不适用」。第 1 刀没有界面变化。

## ★9 验收与回滚（动手前写全）

验收清单：
1. 39 题真模型：一次写对、整题通过、平均重试三个数，对照刀前基线。
2. 11-07 与 11-15 轨迹里写错身份的写法逐条回放（不出网单测）：0 次拒收，或一次拒收且给出对的名字。
3. 面板路请求体全目录逐字节比对：差 0。
4. 铁律「说的=摆的」宿主矩阵绿（选甲时判据要改，改法随用户的决定走）。
5. 老数据全部版本回放通过，旧形状能读、不改写旧文件。
6. 模型可见字数基线不增；三道门岗 `check:model-schema`、`check:mcp-tool-refs`、`check:walkthrough-tool-args` 绿。
7. 付费卡走查全过。

反例（改坏 → 红）：Agent 路另算一份参数表不走档案入口；镜头层再加回供应商字段；渲染层再静默换默认；落地改了值却没带记录；旧形状读不进来；同一个 id 两家都有时不带供应商也放行。第 1 刀另加：名字在两处各生成一份（不走名字模块）；名字查不到却不给下一步；列表行又分开印 id 和供应商；对外 MCP 的模型行或生成工具表变了一个字节。

回滚：每刀一个 PR，revert 即可（第 1 刀不动落盘，revert 无数据后果）。

## 分几刀

| 刀 | 做什么 | 等不等用户 |
|---|---|---|
| 1 单句柄 | 镜头上模型只有一个名字；删掉三处重复和只有半个名字的索引 | 不等 |
| 2a 连线类落地 | 方式由参考推（调面板同一个函数）、参数键由产品摆、删 `modeId` / `taskKind` 二选一和渲染层静默换默认；值不变 | 不等 |
| 2b 值摆不成原样 | 甲或乙 | 等 |
| 3 上下文减肥 | 删重复的工具首句、语言规则尾份、过时指引；记忆挪到稳定段后 | 不等，排最后 |

并进来的：分镜子对象（3700 字、26 个叶字段、11-07 写错 4 次）怎么简化——第 2a 刀开工前单查读者。回合止损那个开着的 PR 和这件事几乎不重叠，独立走。

## 等用户定

1. 要的值这个模型没有时（比如要 8 秒，只有 5 秒和 10 秒）：甲 替他取最近的（一样近取便宜的），付钱前在卡上写明——铁律要改一句；乙 铁律一字不改，照旧拒收退给 Agent，由它问或改。协调推荐甲。
2. 选甲时，开着全自动：有这一行的那一批退回确认卡一次（推荐），还是照发、在回执里说。

---

## 第 1 刀：单句柄（实现合同）

### 名字怎么写：`模型id@供应商`

- 数据（内置目录 211 行、17 个供应商，脚本跑 `applyBuiltinSeeds`）：供应商 id 只含小写字母、数字、`-`（自定义连接的 key 由 `slugifyConnectionName` 收成同一字符集）；模型 id 含 `/ - . _`，其中 36 个含 `/`（如 `bytedance/seedance-2`、`seedream/5-pro-text-to-image`）；`@` 和 `:` 在两边都 0 次。
- 选 `@`：`供应商/模型` 会写出 `kie/bytedance/seedance-2` 这种看不出边界的串；`:` 在自定义中转常见（`llama3:8b`、`xxx:free`）。`模型id@供应商` 把人认得的模型放前面、家放后面，211 行生成 211 个互不相同的名字，没有一个和任何模型 id 撞。
- **不解析这串字**：宿主从 `(vendor, modelId)` 生成名字，查的时候按整串在当前目录里比。万一自定义模型 id 里真有 `@` 撞出两行同名，查表得到两行 → 当歧义拒，不靠字符集保证正确。
- 一处生成、一处查：`electron/shared/agentCapabilities/modelHandle.ts`。列表行、系统提示词索引、默认段、`draft_shots` 准入、拒收里「最像的几个」全走它；结构测试拦「别处自己拼 `${modelId}@${vendor}`」。

### 宽容与拒收（模型写的 `model` 怎么落）

| 写的是 | 结果 |
|---|---|
| 完整名字，目录里有 | 放行 |
| 只写模型 id（大小写不敏感，或模型别名），目录里只有一家有 | 放行，回执里告诉 Agent 落成了哪个完整名字 |
| 只写模型 id，多家都有 | 拒一次，列出那几个完整名字 |
| 近似写法（档案身份识别 `archetypeIdForModel` 认出同一个档案，如 `seedance-2` ↔ `bytedance/seedance-2`） | 只有一行 → 放行并告知；多行 → 拒一次列出 |
| 都对不上 | 拒一次，给最像的 ≤3 个完整名字（同档案优先，再按近似键）；一个都不像就指向 `list_models` |
| 模型做不了这类任务 | 宿主照旧拒（`mode_not_in_model`） |

名字查表在 lane 这一侧做（模型看到的就是这条消息带上来的同一份可用模型清单），查到后宿主收到的仍是 `{providerId, modelId}`——宿主契约、对外 MCP、落盘一个字段都不变。

### 对外 MCP（协调 11-15 拍板，方案 A）

`modelSpecRow` 拆成「共享事实」（label / kind / modeIds / variantIds / accepts / 可用性，只此一处生成）+ 身份头；应用内 `list_models` 的头是 `{model}`，对外 `nomi_read(target=models)` 的头是原来的 `{modelId, vendor}`，对外行逐字节不变。差异只在这一个投影函数里，理由走现成的 `profileReason: mcpHandwrittenTransport`。对外改用完整名字留到「外部生成面收编」那一刀。

### 逐字段对照表（模型可见）

| # | 位置 | 改前 | 改后 | 动作 | 理由 |
|---|---|---|---|---|---|
| 1 | `draft_shots` 每镜 | `modelId` | — | 删 | 半个名字，和 2 抢同一个落点 |
| 2 | `draft_shots` 每镜 | `candidate{providerId,modelId}` | — | 删 | 第二个家；11-15 轮 13/24 拒收是这里配错家 |
| 3 | `draft_shots` 顶层 | `candidate{providerId,modelId}`（缺省） | — | 删 | 和每镜重复的第三处 |
| 4 | `draft_shots` 每镜 | — | `model`（完整名字，从 `list_models` 原样抄；不填 = 用户默认） | 新增 | 唯一的模型身份 |
| 5 | `draft_shots` 每镜 `storyboard.keyframe` | `modelKey` + `modelVendor` | `model` | 改名合并 | 分镜子对象里的第三处身份；宿主那侧照旧收 `modelKey/modelVendor` |
| 6 | `draft_shots` 每镜 `taskKind` 说明 | 「Omit when modelId or modeId decides it」 | 「Omit when model or modeId decides it」 | 改字 | 跟字段名 |
| 7 | `draft_shots` 说明 `params` | 「A top-level candidate or taskKind is the default…; model values come from list_models」 | 「A top-level taskKind is the default…; model is copied from list_models」 | 改字 | 顶层 candidate 删了 |
| 8 | `draft_shots` 例子 | `candidate:{providerId:"apimart",modelId:"image-1"}` | `model:"image-1@apimart"` | 改 | 例子跟表 |
| 9 | `draft_shots` 空修订提示 | 「prompt, modelId/candidate, modeId…」 | 「prompt, model, modeId…」 | 改字 | 跟字段名 |
| 10 | `draft_shots` 准入 | 「两处写了不同模型」拒收 | — | 删 | 只剩一个家，这种矛盾写不出来 |
| 11 | `list_models` 行 | `modelId` + `vendor` | `model`（第一个字段） | 改 | 一串可原样抄回的名字 |
| 12 | `list_models` 入参 | `modelId` + `vendor` | `model` | 改 | 查详情也用同一个名字 |
| 13 | `list_models` 拒收 | `vendorsForModelId` + 「Retry with vendor…」 | `models`（完整名字）+ 「Retry with one of these model values」 | 改 | 下一步可直接抄 |
| 14 | 系统提示词索引行 | `modelId（显示名）: 模式` | `完整名字（显示名）: 模式` | 改 | 索引不再只印半个名字 |
| 15 | 索引表头 | 「modelId: modeId[resolution]」 | 「model: modeId[resolution]」 | 改字 | 跟行 |
| 16 | 默认段每行 | 「（modelId: X，vendor: Y——仅供工具参数）」 | 「（model: X@Y——仅供工具参数）」 | 改 | 默认段用同一种名字 |
| 17 | 默认段规则句 | 「起草时不填 modelId…必须在 modelId 里点名」 | 「起草时不填 model…必须在 model 里点名」 | 改字 | 跟字段名 |
| 18 | 默认段 / 索引尾句 | 「不要念 modelId 或 vendor」 | 「不要念 model 那串名字」 | 改字 | 同上 |
| 19 | 索引尾句 | 「nomi_request_tools group=models 后 list_models（可用 modelId 缩小）」 | 「list_models（可用 model 缩小）」 | 删过时指引 | 工具组已常驻，这句是旧的 |
| 20 | 目录变化段 | 「新增/更新 kind modelId」「失效 kind vendor/modelId」 | 完整名字 | 改 | 同一种名字 |
| 21 | 锚点指引（与分镜规划器共用） | 「modelId/modeId 不能留空」 | 「模型和模式不能留空」 | 改字 | 两个读者都对 |
| 22 | 放错位置字段对照表 | `model`/`modelid`/`modelname` → `modelId` | → `model`；加 `vendor`/`provider`/`providerid` → `model` | 改 | 模型把这些写进 parameters 时指向唯一的家 |

不动（理由）：宿主契约 `generation.plan` 的 `providerId/modelId/candidate`（对外 MCP 的表由它推出，落盘也是它）；对外 MCP 的模型行与生成工具表；宿主拒收文案里的 `provider/model` 写法（对外那条路保持今天的说法，应用内的「查不到 / 歧义」在 lane 这一侧先拒、用完整名字）；`stage_shot`；方式和参数的校验；`modeId` / `taskKind`（第 2 刀）。
