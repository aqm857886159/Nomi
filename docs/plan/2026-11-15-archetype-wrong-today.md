# 设计卡：模型档案「今天就是错的」五处——露了不该露的，档案声明改对

改动名：档案今天就是错的（五处 + 拆分）。类别：[花钱]（改的是发送路上的请求体和发送前的拦法），9 格全填。
读的版本：origin/main @ 34f77fe32（含 #1526 发送前核输入）。出处：核文档第二批汇总第一节「今天就是错的」（2026-11-14，三份核对报告的结论），每处动手前重新打开了供应商文档页核原句（2026-11-15）。
Direction-Check：`electron/catalog/taskParams.ts` 是热点，提交带 `Direction-Check: docs/engineering/direction-checks/2026-11-12-taskparams.md`。该复盘推荐「换一种做法」：参数归方式、由档案声明。本卡五处都改在档案声明上，不在发送时补丁，和它一致。
范围裁决（协调 2026-11-15）：这一刀只做「五处 + 拆分」。变体 × 方式门控（Veo 3.1 Quality 的参考图方式、Hailuo 2.3 Fast 的文生方式、Veo 3.1 Lite 的图模式）不做门控字段、不动 `specializeArchetypeForVariant`，移交下一刀「解析档案一个口 + 变体 × 方式门控」。

## 一句话

五个地方，档案上露着供应商文档写明不该露的控件或限制，或者露着却发不出去。这一刀把它们在档案声明和目录映射里改对。面板、Agent 说明、发送三处读的是同一份声明，所以一起跟上，不在发送时另丢。

| # | 现象（创作者今天遇到什么） | 改在哪 | 供应商原话（2026-11-15 重新打开核） |
|---|---|---|---|
| 1 | MiniMax H3（APIMart）有 webhook 文本框，填了也收不到任何东西（Nomi 自己轮询） | 档案 `minimaxH3Apimart.ts` 四个方式删掉控件；目录 `apimartVideos.ts` 两条 body 删掉 `webhook`，`paramMap.drops` 收下老节点存的值；`apimartMinimaxH3.ts` 删掉「空 webhook 就删键」的补丁；能力表新建 `docs/models/capabilities/minimax-h3-apimart.md`，记作 `absent:webhook reason:管道` | 文档列了 `webhook`（任务完成回调地址），见 docs.apimart.ai/cn/api-reference/videos/minimax-h3/generation |
| 2 | 可灵 3.0（APIMart）图生方式露着比例，选了也没用：发送时被目录的 `i2vDrops` 丢掉 | `kling.ts` 的 i2v 只给 APIMart 去掉比例（fal / kie 不动，fal 图生 body 仍发） | Kling：「In image-to-video mode, aspect_ratio may be overridden by the actual image ratio」（kling-v3/generation） |
| 2b | Veo 3.1（APIMart）参考图 / 首尾帧：比例露着、发送时却被 `i2vDrops` 丢掉（独立验收查出：第一版把它藏掉，方向反了） | `veo31.ts` 两个图模式改回和文生同一组参数（比例 16:9 / 9:16 + 清晰度）；`apimartVideos.ts` 图生 body 引用 `aspect_ratio`、删掉 `i2vDrops` | veo3/generation：`aspect_ratio` 只列 16:9 / 9:16、不分方式；页上的请求示例就是带 `image_urls` 的图生请求，同时写 `"aspect_ratio": "16:9"`。以前不发是 2026-06-07 首版照抄 Sora 图生 body 形状，git 历史里没有文档或上游报错依据。上游图模式认不认比例：`unverified`，待一发付费核 |
| 3 | Seedream 4.5（APIMart）文生图的比例有「auto」，文档写 auto 需要参考图 | `seedream.ts` 拆成文生 / 改图两组比例，文生不列 auto | 「auto - Auto-match reference image aspect ratio (requires image_urls)」 |
| 4 | GPT Image 2 / 2.5 / 2.6（APIMart）改图时选比例「自动」，我们把 `size: "auto"` 发出去。文档说不发才跟随原图比例（GPT Image 2 是独立验收查出的同类漏网） | `apimartImages.ts` 改图 body 读 `size_wire`，paramMap 用现成的 `omitAuto`：auto → 不发，具体比例照发；文生不变 | 2.5 / 2.6：「For image-to-image requests, omit size to let the service calculate … first input image's aspect ratio」；GPT Image 2：「Without `size`, output resolution = input image resolution」「When `size` is set to `auto`, the default ratio is `1:1`」。同类再扫：其余改图模型的文档都写「不传或 auto 都跟参考图」，0 个 |
| 5 | Seedance 2.0 / Wan 3.0 / Wan 3.0 Prime（APIMart）放了素材的方式仍要求必填提示词，被我们自己拦住发不出去 | `seedanceApimart.ts` 的 i2v / omni / firstlast 和 `wan30Apimart.ts` 的 first / firstlast / ref 都改成 `promptRequired: false`（文生仍必填） | Seedance：「Required for text-to-video; optional for image-to-video or video-reference-to-video」；Wan：「Required unless media fields are provided (at least one of prompt or media)」 |

拆分（单独一个提交，在前，行为零变化）：`taskParams.ts` 按职责拆成三份：发送参数、携带参考的读法、发前诚实护栏。全量单测 442 个文件 / 8407 条全绿；官方请求体矩阵和参数尺子快照 0 改动。拆的时候查了 `taskParams` 里有没有逐模型补丁：没有。

## ★0 先查别人

本线只许读供应商公开文档页，所以别家框架的条目引的是 11-12 设计卡已经实开过的那一条，其余都是供应商原文或仓库里的先例。

- [LiteLLM drop_params](https://docs.litellm.ai/docs/completion/drop_params)（11-12 方式参数主人设计卡实开，本线没有重开）· 支持表按「供应商 + 模型」维护；不支持的参数默认报错，开了 drop_params 才在发送时静默丢 · **改了**：我们以前就是在发送时静默丢（`i2vDrops`），控件却照样露着，等于告诉创作者「选了有用」。现在改成档案不声明，面板上就不出现。目录的 drop 只留作「旧节点、Agent / MCP 无界面请求还带着这个键」的容错，不再是比例不起作用的唯一原因。
- [GPT Image 2.6 生成接口（APIMart）](https://docs.apimart.ai/en/api-reference/images/gpt-image-2.6/generation.md)（2026-11-15 开）· 原话「omitting this field for still-image editing selects dimensions from the first input image's aspect ratio」，2.5 页同义 · **确认了**第 4 处的做法：「自动」= 不发这个键，而不是把字面 `auto` 发出去（发 auto 是让上游自己挑，不是跟随原图）。OpenAI 官方 API 参考页返回 403，没读成，不引。
- `electron/catalog/apimartImages.ts:73` `OPTIONAL_ASPECT_PARAM_MAP` · 仓库里早有「选『自动』就不发」的写法：`omitAuto` 不产出改名后的键，body 引用它就整键丢 · **确认了**复用这个现成写法，不在 `declaredModeParams` 上另加一种通用表达（任务书第 4 步的「看 #1493 之后有没有现成的」：有，就是它）。
- [Kling v3 生成接口（APIMart）](https://docs.apimart.ai/en/api-reference/videos/kling-v3/generation.md)（2026-11-15 开）· 「In image-to-video mode, aspect_ratio may be overridden by the actual image ratio」 · **确认了**第 2 处：图生方式下比例控件没有意义。也**改了**一处范围：fal / kie 的同名档案参数不动，因为 fal 的图生 body 仍然发比例，改了会让 fal 少发一个键（会变请求体，超出这一刀）。
- `docs/models/capabilities/minimax-h3-max.md:31` · 同家 H3-Max 已把 webhook 定成「不露出 · 管道」（Nomi 自己轮询拿结果，创作者没有地址可填） · **确认了**第 1 处 H3 跟它对齐，同一个 reason 词，能力表对账测试照同一口径认领。
- 出口：不涉及：这一刀不新增、不扩大、不挪动任何挡人的保护。第 5 处是**撤掉**一道挡人的保护（放了素材的方式不再拦空提示词），其余四处只是不再露出没用的控件。

## ★1 用户怎么用

当创作者在视频节点上放了一张首帧图，选了 Seedance 2.0，想直接让画面动起来、不写字，他会点生成。他要的是：请求能发出去，而不是被「请先写提示词」拦住。
同理：在可灵 3.0 图生方式下，他不该再看到一个选了也不起作用的「比例」；给 H3 发视频时，面板上不该有一个填了也收不到东西的 webhook 框；Seedream 4.5 文生图的比例里没有那个上游可能拒收的「auto」；GPT Image 改图选「自动」，成片就跟原图比例走。

步骤（以第 5 处为例）：选模型 Seedance 2.0 → 连一张首帧图（底栏方式变首帧 / 全能参考）→ 提示词留空 → 点生成（按钮前后都亮着，提示词必填不在按钮上拦）→ 不再被发送口的「请先写点提示词再生成。」拦下 → 付费确认 → 发出。去掉图回到文生 → 点生成仍被这句拦下。

不做：
- 变体 × 方式门控，移交下一刀。
- 不新增控件，不挪布局。
- 不动参数面板和底栏组件。
- 不改 fal / kie 的可灵参数。
- 不改可灵 4.0（那条要实测）。
- 不删目录的 `i2vDrops`：它是容错，删了 Agent / MCP 无界面请求会被严格 provider 拒成「unsupported」。

已知坑：kie 的可灵图生 body 写死了 `aspect_ratio: "auto"`，而 kie 档案的图生方式仍然露着比例。这一刀不动，记进已知限制。

真实任务：
1. Seedance 2.0 首帧图 + 空提示词，点生成。
2. GPT Image 2.5 改图选「自动」比例。
3. 老项目里存着 H3 webhook 值的节点，升级后发送。

指标（每条都点名量具）：
- 主指标：五处各一条「改前红 / 改后绿」。
  - 量具：`electron/catalog/apimartShownEqualsSent.test.ts`（APIMart 内置目录全扫：模型 × 变体 × 方式 × 露出的控件，554 格 / 66 个模型；今天红 13 格登记在 `apimartShownEqualsSent.known-red.json`）、`apimartMediaRestWire.test.ts`（GPT 改图）、`promptRequirement.test.ts`（Seedance / Wan）、`capabilityTables.contract.test.ts`（H3 能力表双向对账）。
  - 反例 10/10 红，见 ★9。
- 护栏 1：请求体矩阵只允许五处涉及的路变化。
  - 量具：`electron/parity/officialWire.matrix.test.ts` 的快照。
  - 实测 14 格变化（每格画布、Run 两路）：
    - GPT 2.5 / 2.6 改图 8 格：flare / sunburst × 两家 × n=1 / 16，`size` 从 `"auto"` 变为不发；
    - GPT Image 2 改图 2 格（n=1 / 15）：同上；
    - Veo 3.1 Fast 参考图（n=1 / 3）、首尾帧（n=1 / 2）4 格：多了 `aspect_ratio: "16:9"`。
  - 其余逐字节不变。可灵、H3、Seedream 文生的默认请求体不变：它们的 body 本来就不发这些键，或者默认值不是被删的那个。
- 护栏 2：方式 × 变体参数快照。
  - 量具：`modeParamsVariants.snapshot.json`。
  - 与主线逐字节一致（Veo 图模式的比例回来了，和主线一样）。
- 护栏 3：老用户回放。
  - 量具：`archetypeWrongTodayOldCatalog.test.ts`，v0.24.1 真实目录，7/7。
  - 再加 `archetypeMeta.test.ts`：老 Seedream 文生节点存着 auto。

## ★1b 连带界面

- 参数面板：三处少一个控件或选项：H3 没有 webhook 框；可灵 3.0 图生没有比例；Seedream 文生的比例少了 auto。Veo 3.1 两个图模式的比例照旧在（用的是文生已有的那一格），选了现在真的发出去。面板组件一行不改，读的是档案。
- 生成按钮和提示：Seedance / Wan 放了素材时，「请先写提示词」不再出现。
- Agent 模型说明 / 准入：同一份档案，不再列 H3 webhook、可灵图生比例。Agent 若仍写这些键，目录 drop 收下，不报错。
- 付费确认卡、错误卡：没有新文案。

## ★1c 老用户

用的是真实旧数据：`tests/fixtures/old-user-data/curated/v0.24.1-apimart/model-catalog.json`，0.24.1 落盘的目录。

- **H3 存着 webhook 值的节点**
  - 升级前：老映射的 body 引用 `{{request.params.webhook}}`，会把值发出去。
  - 升级后：`applyBuiltinSeeds` 换成主线映射，不再发。
  - 证据：回放测试两条（文生、图生）。
- **GPT Image 2 / 2.5 改图存着「auto」**
  - 升级前：发 `size: "auto"`。
  - 升级后：不发。存着 16:9 的照发。
- **可灵 3.0 图生存着比例**：升级前后都不发（老映射本来就丢），不回归。
- **Veo 3.1 图生存着比例**：升级前不发（老映射丢）；升级后发存着的值（例如 9:16）。这是有意的变化，上游认不认 `unverified`，待一发付费核。
- **Seedream 4.5 文生节点存着 auto**
  - 发送前，渲染层 `fixDropdownsBeforeSend` 把不在选项里的值修成默认 1:1；改图方式的 auto 照留。
  - 证据：`archetypeMeta.test.ts` 新用例。真实旧存档里找不到这种节点，用的是按 0.24.1 节点形状构造的 meta，所以这一条记「半真实」。
- **选中节点就纠正旧值（已有机制，不是本 PR 引入）**：存着不合规旧值的节点（例如 Seedream「文生 + auto」、H3 存着的旧清晰度）一被选中，就会被改成合规值并存盘。后果：这个 Seedream 节点之后连上图转成改图，发的是 1:1 而不是「自动」。这个机制本身移交另一刀（先查它当初为什么这么定）。
- **Seedance / Wan 空提示词的老节点**：以前被拦，现在能发。
- **退回上一版**：存储格式没变，照常打开。旧版本会重新露出那几个控件，不影响数据。

## ★2 谁说了算

- 「这个方式露哪些控件、提示词必不必填」只归档案（`electron/shared/modelArchetypes/` + `videoCapabilities/`）。面板、Agent 说明和发送都读同一份声明，`effectiveModeParams` 管键，`promptRequiredForNode` 管提示词。
- 「这个值上游收不收」归目录映射：`paramMap` 的 `omitAuto` 和 `drops`。
- 同一事实今天一处：
  - 图生比例：以前是目录 drop（发送时丢）+ 档案露控件，两处说法不一致。现在可灵 3.0 档案不声明、目录 drop 只做容错；Veo 3.1 档案声明、body 真发，drop 删掉。
  - webhook：以前档案、两条 body、`apimartMinimaxH3.ts` 的空值补丁，三处。现在只剩目录一条 drop（容错）。
- 不靠「东西不见了」猜意图。
- 证据：`git grep` 显示 `webhook` 在 H3 档案和 body 里 0 处；新测试 `apimartShownEqualsSent` 守着档案和 body 一致。

## ★3 一致与复用

- 以前定过的，都还算数：
  - 11-12「模型档案默认全露出，不露出要有理由」：webhook 用的理由「管道」在短名单里，H3-Max 已经这样定过。
  - 11-12 方式参数主人：参数归方式。
  - 11-14 汇总「今天就是错的」：协调定的这六条，门控那条移交下一刀。
- 三条路：
  - 沿原方向修：在发送时丢，那是今天的做法，控件照露，否决。
  - 换一种做法：档案声明改对。**选这条**：一处改、三处读方自然跟上。
  - 删掉：整模型下架。不对，模型本身能用。
- 复用：
  - `omitAuto`（已有 transform，`OPTIONAL_ASPECT_PARAM_MAP` 同款）。
  - `promptRequired` 本来就是按方式声明的字段（#1526 之后）。
  - 能力表双向对账测试（`capabilityTables.contract.test.ts`）收进 H3 这一张。
  - 不引新库、不加新字段。

## ★4 全状态

- 没有新状态，没有新文案。
- 空提示词：放了素材的方式可以发；文生方式仍然显示原来的「需要提示词」。
- 失败：上游真拒时沿用现有失败卡。
- 能力不可用：不涉及，没有新增需要外部资源的动作。
- 数据撑开：选项只会变少，不撑开。

## 5 中途表

都是发送前的同步声明，不新增状态。停、关窗、断网、重启、连点的表现，以及扣费，都和今天发送前一样。

## 6 外部数据与失败

- 外部来源：供应商文档原句，写进档案的 `sources.covers` 和能力表。
- 风险 1：Seedance / Wan 放素材时空提示词上游真的收不收。文档说收，没有付费实测，记 `unverified`。
  - 若上游拒：用户看到现有失败卡、带上游原话，不扣费（任务没受理）。
- 风险 2：GPT 改图不发 size 时上游按原图比例。文档原话如此，付费实测同样 `unverified`。
- 风险 3：Veo 3.1 图模式发 `aspect_ratio` 上游认不认。文档示例就是这样发的，付费实测 `unverified`。
  - 若上游拒：用户看到现有失败卡、带上游原话；回退办法是档案改回不露、body 改回 drop，并把上游原话写进能力表的「不露出」原因。

## ★7 性能

不适用：没有新增用户操作，也没有新增计算。
- 档案的控件数组变短或不变。
- `omitAuto` 是已有 paramMap 规则多跑一条，O(1)。
- `promptRequired` 读的仍是同一个布尔。
- 不进渲染热路径的变化：没有改任何组件或缓存。

## 8 真实条件

- Mac 本地：单测、官方请求体矩阵、v0.24.1 真实目录回放、真窗截图。截图用隔离资料目录、零花费、不点生成，中文浅色 + 英文暗色。
- 真付费：本线不跑，`unverified`。建议协调跑两发：
  - Veo 3.1 Fast 参考图方式，1 张竖图，比例 9:16、720p。判据：上游受理，成片竖屏。
  - GPT Image 2（或 2.5）改图选「自动」。判据：请求体没有 `size`，成片和原图同比例。
- Windows / 干净安装：`unverified`。

## ★9 验收清单、反例与回滚

清单（验收线只核这份）：

1. 五处各有一条改前红 / 改后绿的测试（见下面的反例表）。
2. 官方请求体矩阵：只有 14 格变化（GPT 2.5 / 2.6 改图 8 格、GPT Image 2 改图 2 格不发 `size`；Veo 3.1 Fast 参考图 / 首尾帧 4 格多 `aspect_ratio`）；重录后的 diff 只在这 14 格。
3. 方式 × 变体快照：与主线逐字节一致。
4. 老用户：v0.24.1 真实目录回放 7/7，再加 Seedream 老节点发送前修值。
5. 能力表：H3 能力表进双向对账，fixture `requestFields` 每项都有行认领。
6. 生成物 `archetypeWireDefaults.video.generated.ts` 只少一处 `aspect_ratio`：Kling apimart i2v（Veo i2v 保留）。
7a. 全扫：APIMart 内置目录 554 格 / 66 个模型；红格全部登记、登记全部还红、条数 ≤ 13。
7. `canvasConnectVideoAspect.test.ts`：连线铺比例那半换成图生仍有比例的 Veo 官方通道。可灵 3.0 APIMart 图生连竖图后不再写比例，和 Seedance 2.5 首帧同口径：比例跟图走、不写。
8. typecheck、eslint（改动文件）、全量单测、`gates:contracts`、`build`、真窗截图两轨。

反例（改坏 → 红；还原 → 绿；日志见证据目录 `counterexamples.txt`）：

| 反例 | 改坏后 | 还原 |
|---|---|---|
| 全扫改回只点名 6 个模型 | 结构断言（源头表每个模型都进扫描）红 2/17 | 绿 17/17 |
| 登记文件多加一条发得出去的格子 | 「每条登记今天还红」红 2/17 | 绿 17/17 |
| Veo 图模式露出比例、body 却不带 | 全扫 + 官方矩阵，红 6/298 | 绿 298/298 |
| GPT Image 2 改图「自动」又带上 size | 全扫用例 + 老目录回放 + 矩阵，红 4/305 | 绿 305/305 |
| Veo 3.1 图模式又藏掉比例 | 红 1/17 | 绿 17/17 |
| 把 webhook 控件加回 H3 档案 | 全扫 + 能力表对账，红 3/38 | 绿 38/38 |
| GPT Image 2.5 改图 body 改回 `size` | REST 请求体测试，红 1/37 | 绿 37/37 |
| Seedance 2.0 放了素材的方式又要求提示词 | 红 1/17 | 绿 17/17 |
| Seedream 4.5 文生比例又加回 auto | 红 1/17 | 绿 17/17 |
| 可灵 3.0 APIMart 图生又给比例 | 红 2/17 | 绿 17/17 |

任务书里和门控有关的两条反例（「把门控字段从 Veo 3.1 Quality 上拿掉」「菜单组件另写一份方式判断」）不适用，随门控移交下一刀。

这一类会从哪回来：
- 新档案露出一个发不出去的控件（或发送时被丢）：`apimartShownEqualsSent` 从目录源头三张表取全部 APIMart 模型，按变体 × 方式 × 控件逐格查去处；新增的红格不在登记里就红，登记条数只减不增（≤ 13）。只管 APIMart 内置目录，fal / kie 和中转不在这把尺子里。
- 能力表新漏一项：双向对账。
- 旧目录：升级重种映射，有回放测试。
- 其他供应商（fal / kie）：不在这一刀，列进已知限制。

回滚：revert 修复提交即可，不写存储，没有数据影响。拆分提交可以单独保留。

## 已知限制（移交）

- **Veo 3.1 Quality 的参考图方式**：文档「veo3.1-quality model does not support reference mode」。创作者今天仍能选它、放图、点生成，上游拒收。
- **Hailuo 2.3 Fast 的文生方式**：文档「first_frame_image is required」。今天仍能纯文字发出，上游拒收。
- **Veo 3.1 Lite 的图模式**：文档「veo3.1-lite model does not support this parameter」（generation_type / image_urls）。今天仍露参考图、首尾帧方式。
- 以上三处移交下一刀：解析档案一个口 + 变体 × 方式门控。
- kie 可灵图生 body 写死 `aspect_ratio: "auto"`；fal / kie 的可灵图生仍露比例。未核这两家文档，不在这一刀。
- 全扫登记的 13 格今天仍发不出去：Suno V5.5 自定义模式 / 续写 / 翻唱共 11 格（APIMart body 写死 `custom:false`，三个方式落在同一条映射上），Grok Imagine 2.0 Ext 改图 2 格（APIMart 只发布了文生图）。移交后面的刀，修一格删一条。
- 老的可灵 3.0 图生节点（存着 9:16）连方图后，占位仍画 9:16 竖条，而面板已没有比例可改；请求体确实不发，只是显示和真实产出不一致。移交另排的一刀：图生方式下占位按输入图比例画。
- 没放素材、提示词为空被发送口拦下时，卡片显示的是通用的「没能认出这次失败的原因」，而不是「请先写点提示词」。移交「错了说人话」那一刀。
- 选中节点即纠正旧值并存盘（见 ★1c）。移交另一刀，先查它当初为什么这么定。
