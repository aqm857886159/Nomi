# 设计卡：Seedance 2.5 样片模式（S-D）

- 线号：I-SD-sample-mode；分支 `feat/sd-sample-mode`；基线 `origin/main` `daa685c9a`。
- 拍板：用户 11-26，决策 D-1126-sdse-libtv。原话：「两个设计…你看一下，然后微调一下，然后就去做就好了」，以及「重点是参考它的交互…名称…Icon…具体的这些逻辑还要基于我们的中转站去做」。
- 画布：https://claude.ai/artifact/8whUqf2fPJsSNQQ1gr3x7F（第 12 版）。
- 拍板清单：[`docs/design/boards/2026-11-26-sample-mode/SampleMode.board.json`](../design/boards/2026-11-26-sample-mode/SampleMode.board.json)。
- 逐态对照表：出表线 M-SDSE-map（S-D-table），冲突裁定见 C-D1～C-D11。实现期间协调又补了四条裁定，见文末「实现期裁定」。

**目标**：创作者在模型菜单选「Seedance 2.5（样片模式）」，先花少量积分出一条 480p 样片，看动作和构图。
- 满意：点节点下方的「出高清」。请求只带样片号和目标清晰度，出 1080p，写进同一个节点的第 2 版。
- 不满意：改提示词，再出一版样片。
- 三种情况要说清：样片过期、同一样片第二次出高清、算不出价。
- 普通 Seedance 2.5 和老项目一律不变。

### 功能分类
- [x] 新界面 / 改交互
- [x] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能

## ★0 先查别人

| 出处 | 它怎么做 | 对我们哪个决定的影响 |
| - | - | - |
| LibTV 模型菜单 https://www.liblib.tv/ （同一屏真截图，sha256 记在 `docs/design/boards/2026-11-26-sample-mode/SampleMode.board.json:32` 的 priorArt，图不进仓库） | 菜单里单独一行「Seedance 2.5（样片模式）」，说明「480P 低成本试片，满意后直出高清版本」。选中后清晰度只剩 480P，价约为普通版的 70%。 | **确认了**：名字、位置（紧跟 Seedance 2.5）、图标与父模型相同。**改了**：「样片」做成目录里独立的一行（协调同意的 b 方案），不做变体轴。 |
| TapNow Draft mode https://docs.tapnow.ai/en/docs/canvas/generate-and-edit-video | 先出 480p 草稿，再点 Generate Final Video 出 1080p，草稿保留。 | **确认了**：出高清后样片留在版本栈里当第 1 版，高清版是第 2 版并成为主图。 |
| APIMart 文档 https://docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation（2026-11-26 取；能力表第 38–39 行） | `draft:true` 出 480p，样片 3 天有效。`draft_task_id` 出 1080p / 4k，「do not resend inherited fields」，「even identical values return 400」。同一样片可多次出成片，「Each is an independent task billed separately」；「Drafts are billed as normal 480p videos」，成片按所请求的清晰度计费。 | **改了**：出高清请求体只有 `model` / `draft_task_id` / `resolution`；同一样片第二次出高清先问；样片和高清都按父行（普通 2.5）对应清晰度约价。**确认了**：有效期写在档案里（72 小时），界面只读档案。 |
| 仓库先例 `electron/catalog/apimartVideos.ts:379`（MiniMax-H3-Regeneration 行，第二步请求体 `electron/catalog/apimartVideos.ts:80`） | 用 `source_task_id` 拿上一条成片的任务号做第二步，请求体不带提示词。 | **确认了**：第二步请求体照它的写法，只放任务号和目标清晰度，不经 `videoCreateOp`（那里固定塞 prompt）。 |

出口：`src/workbench/generationCanvas/spend/spendConfirm.ts:295 confirmGenerationResend` · 同一笔钱第二次花之前现成的「再发一次」确认框，取消即不发、Esc 回到原按钮 · **确认了**：第二次出高清只复用它、只换文案和带价主按钮（C-D11），不新加挡人的保护。过期样片不灰掉按钮，直接换成「重拍样片」，一步可走。

## ★1 用户怎么用

当我拿不准一条 30 秒镜头的动作和构图时，我想先花少量积分看一条 480p 样片，满意再出 1080p，不把整价花在试错上。

1. 打开视频节点的模型菜单，在「Seedance 2.5」下面看到「Seedance 2.5（样片模式）」，说明写「480p 低成本试片 · 满意后出 1080p · 最长 30 秒」。
2. 选它。生成框模型格写全名。参数面板里清晰度只有 480p 一个选项，其余参数和普通 2.5 一样。
3. 写提示词，点发送（发送键带样片价；算不出价时不印数），等样片出来。
4. 节点下方出现一行：左边「样片 · 剩 2 天」（72 小时有效期，刚出完还差几秒满 72 小时，按 C-D3 向下取整；拍板稿同样画「剩 2 天」），右边「出高清 + 价」。
5. 不满意：改提示词，再发一次，又是一条样片（版本栈 +1）。
6. 满意：点「出高清」，不弹框。样片照常能播，下方一行写「高清生成中」。
7. 高清版落进同一节点第 2 版，成为主图，角标 2，铺开后第 2 张卡写「高清版」。切回第 1 版，下方那一行回来。
8. 同一条样片再点一次「出高清」：先弹确认框，写清这条样片已经出过高清版、再出一次会再扣一次。取消就不发。

**不做什么**：
- 不做 4k（文档要求样片的通道支持 4K，我们查不到，能力表记「待定」）。
- 不做分镜行里的出高清按钮：分镜菜单里有样片这一行，结果落在画布节点上，出高清在节点下面点。
- 不做样片的批量出高清。
- 不改普通 2.5 的约价（另一条线修白名单）。

**已知坑**：
- 有效期按「样片任务开始那一刻 + 档案小时数」算。找不到这次运行的开始时间时，退到结果落地时间，最多晚报一次生成的时长；剩不到 2 小时会变提醒色。
- 结果是缓存复用来的时，样片号仍是原任务号（缓存只抹 `vendorRequestId`，`result.taskId` 原样）。

**真实任务**（替身扮 APIMart 两步，真付费由协调之后跑一次）：
- 「海边清晨，回头望灯塔」文生样片 → 出高清。
- 同一节点改提示词再出一条样片 → 对第 2 条出高清 → 再对它出第二次高清（走确认框）。
- 28 字镜头名「雨后清晨的海边栈道上少女缓缓转身回望远处灯塔慢推近景特写」，放在 240 宽节点上。

**指标**（目标 → 信号 → 指标 → 量具）：

| 指标 | 目标 → 信号 | 量具 |
| - | - | - |
| 主指标 | 能先试后出 → 出高清只发样片号 → 出高清请求里不含继承字段的比例 = 100% | `tests/ux/sample-mode.walk.mjs`：替身日志逐条断言 |
| 质量指标 | 时间说得对 → 剩余时间按档案算 → C-D3 各分档边界全对 | `src/workbench/generationCanvas/nodes/sample/sampleRow.test.ts` |
| 护栏 1 | 不重复扣钱 → 第二次出高清没确认就发的次数 = 0 | 走查 ★9-4 |
| 护栏 2 | 不印假价 → 算不出价时按钮上印数字的次数 = 0 | 走查 ★9-6 + 单测 |
| 护栏 3 | 老节点不变 → 普通 2.5 / 老项目节点出现样片行的次数 = 0 | 走查 ★9-5 + 旧版夹具 |
| 线上采用率 | 创作者真的在用 | 未验证：缺量具（使用遥测没有按模型行拆的事件） |

基线：今天 0（没有这一行）。目标：上面五条全绿。

新界面 brief：节点下方一行常驻小字 + 一个次按钮，不压画面。
- 新手：只需要看懂「样片」「剩几天」「出高清」三个词。
- 老手：要能直接看出这条样片还能不能出高清、出过没有。
- 记录方式：走查每步截图 + `commands.jsonl` 里的「预期 → 实际」。

### ★1b 连带界面

| 界面 | 要说什么 |
| - | - |
| 生成中遮罩 | 出高清那次运行，请求里带 `draft_task_id`，写进同一节点新一版：不画等待面，样片照常能播。其余运行照旧。 |
| 失败提示 | 出高清失败走通用失败词条（`generationCommon.observability.error` 一族），不写「没扣费」断言（check:i18n 门岗）。样片和按钮都还在，再点即重试。 |
| 版本卡 / 列表详情 | 第 2 版的卡写「高清版 / HD version」，列表详情的版本行用同一个词。 |
| 任务中心 | 出高清是一个普通 Run，取消走任务中心。节点上不放取消（未认领，C-D7）。 |
| Agent 面板 | 只指路：文字加节点引用条，不放清晰度开关、不放「出高清」按钮（§1.0）。本 PR 不改 Agent 技能文案，只用断言守「不放开关」。 |
| 远景轻量节点 | 不画这一行（C-D8）。 |

### ★1c 老用户

- **老项目**：普通 Seedance 2.5 出的节点，`provenance.params.extras.archetype.id` 是 `seedance-2.5-apimart`，没有样片规格，下方不出现这一行，不迁移。走查用真窗口里普通 2.5 选 480p 真出一条验；`tests/fixtures/old-user-data/curated/v0.24.1-apimart/` 只有目录、没有项目，只验老目录；0.24.1 真实存盘的画布夹具（`tests/fixtures/old-user-data/canvas/v0.24.1-mode-nodes/`，25 个节点）按今天的打开路径打开后没有一个节点读出样片、存回不多出样片号（`src/workbench/generationCanvas/model/sampleFacts.oldUser.test.ts`）。**unverified：没有带视频结果的真实旧版项目夹具**（`projects/` 与 `canvas/v0.24.1-mode-nodes` 里的视频节点都没出过结果），没来历的视频结果由单测钉住，不手造「老节点」顶替。
- **老目录**：升级后对账插入新行 `doubao-seedance-2.5-sample`，父行的两条映射字节不变（旧版目录夹具单测）。
- **模型框**：
  - 已整理过模型框的人：新行按现有规则排在末尾、默认显示，不加特例（协调裁定）。
  - 没整理过的人：新行紧跟 Seedance 2.5。
- **退回上一版**：
  - 新行在旧版本里没有档案，按「未知模型」处理。
  - 节点上的样片结果是普通视频，照常能看；旧版不认 `attempt.draftTaskId`（只是多一个可选字段），打开不报错。

## ★2 谁说了算

| 概念 | 唯一 owner | 允许的消费者 |
| - | - | - |
| 样片规格（有效期小时、样片清晰度、成片可选清晰度） | 父档案 `SEEDANCE_2_5_APIMART_ARCHETYPE.sampleMode`（`electron/shared/videoCapabilities/seedance25Apimart.ts`） | 派生档案、能力表合同、界面那一行 |
| 样片档案 | `deriveSampleArchetype(parent)`（`electron/shared/videoCapabilities/sampleMode.ts`）从父档案推出：只收窄清晰度、加样片规格和出高清方式。不复制档案。 | 目录行、档案解析 |
| 样片按哪一行、哪一档约价 | 派生档案旁边的声明 `sampleOf.billedAs` 和函数 `sampleBillingRequest`（同一文件） | 发送键、出高清按钮、确认框三处都从这里取（协调裁定） |
| 样片号 / 是不是高清版 | 节点结果的来历：`provenance.params.extras.archetype`（`{id, modeId}`）、`result.taskId`、`provenance.params.extras.draft_task_id`。主进程 `buildTaskProvenance` 给每条落地路径都写。 | 界面派生函数 `sampleInfo(result)`，只读不写 |
| 这次运行在出高清 | 运行记录 `attempt.draftTaskId`：提交那一刻从这次请求的 `draft_task_id` 同一个值记下。不另加布尔标记。 | 生成中遮罩、节点下方那一行 |
| 出高清请求 | `buildCatalogTaskRequest(node, { sampleFinal })` | 画布单镜 Run 路 |
| 映射选择 | `selectTaskMapping`（`electron/catalog/types.ts`） | 8 扇门（见调用方表） |

- **默认状态归主进程**：钱、请求、记录都归主进程。界面只算剩余时间和要不要弹确认。
- **「1」靠什么保持**：
  - 样片档案拿不到自己的一份清晰度表，只能由函数从父档案推。单测验证父档案改了样片档案跟着变。
  - 约价三处只调同一个函数；组件里找不到约价用的 modelKey 字面量（单测 grep）。
- **不靠「东西不见了」猜意图**：出高清是显式点击，第二次出高清靠版本栈里的事实判断。

**door-map 门表**（11-26 在本分支重跑）：

| 符号 / 文件 | 门数 | 位置 |
| - | - | - |
| `selectTaskMapping` | 8 | `vendorPriceRequest.ts:26`、`apimartGenerationProvider.ts:237`、`modelOnboarding/tryModel.ts:151`、`comfyuiWorkflowOutputMigration.ts:72`、`modelNameSource.ts:29`、`runtime.ts:175`、`modelCapabilityProjection.ts:127`、`useChannelCreateBody.ts:89` |
| `buildCatalogTaskRequest` | 4 | 2 写（`catalogTaskActions.ts:596`、`useNodePricePreview.ts:24`），2 读（imageActions / videoActions） |
| `applyHeadlessParamDefaults` | 3 | `vendorPriceRequest:31`、`apimartGenerationProvider:274`、`runtime:298` |
| `assertModeAcceptsInputs` | 1 | `taskParams:175` |
| `specializedMode` | 1 | `modeParams.ts` 内 |
| `confirmGenerationResend` | 2 | `generationRunController.ts:436`、`useProductionStatus.ts:191` |
| `spendConfirm.ts` 模块 | 45 门 / 17 文件 | — |
| `nodeResultLifecycle.ts` 模块 | 35 门 / 20 文件 | — |
| `NodeGeneratingOverlay` | 1 | `BaseGenerationNode.tsx` |
| `normalizeCatalogTaskResults` | 2 | `catalogTaskActions.ts`、`recoverTaskActions.ts` |
| `menuRowDescription` | 1 | `useDedupedModelSelect.ts` |
| `dispatchedAttempt` | 1 | `generationRunController.ts` |
| `NodeLabelRow` | 2 | `BaseGenerationNode.tsx`、`LightweightGenerationNode.tsx` |

### 调用方后果表

| 改动 | 调用方 | 改后会怎样 |
| - | - | - |
| `selectTaskMapping`：桶里恰有一条不带方式的映射时，它服务所有没被带方式映射认领的方式（含不传方式）。 | 8 扇门 | 只有同一模型同一桶里「一条不带方式 + 若干带方式」时结果才变；今天内置、旧版、升级目录里这种混合桶数 = 0（单测钉住）。样片行：文生桶 = 样片映射（不带方式）+ 出高清映射（`sample-final`）。不传方式的门（`apimartGenerationProvider`、`tryModel`、`modelCapabilityProjection`、`comfyuiWorkflowOutputMigration`）拿到样片映射，就是这一行的常规用法；带方式的门（`runtime`、`vendorPriceRequest`、`useChannelCreateBody`、`modelNameSource`）按方式精确取。 |
| `findArchetypeMode(archetype, modeId)`：`modes` 之外还认样片档案的出高清方式。 | `taskParams.ts` `applyHeadlessParamDefaults` / `assertModeAcceptsInputs`，`modeParams.ts` `specializedMode` | 只对样片档案的 `sample-final` 多认一个方式；其它档案结果逐字不变。界面里枚举 `modes` 的 55 处看不到出高清方式，不会出现在方式菜单里。 |
| `buildCatalogTaskRequest` 加 `sampleFinal` 选项 | 画布单镜 Run（`catalogTaskActions.ts:596`）；约价（`useNodePricePreview.ts:24`） | 不带选项时逐字不变。带选项时方式 = 出高清，参数只放 `draft_task_id` / `resolution`，提示词为空，`forceRerun` 照节点有结果时的老规则带上。 |
| `runGenerationNode` 加 `sampleFinal` 选项、`dispatchedAttempt` 记 `draftTaskId` | `generationRunController` 内两处入口 | 不带选项时运行记录逐字不变。 |
| `confirmGenerationResend` 加「同一样片再出高清」文案和带价主按钮 | `generationRunController.ts:436`（节点重发）、`useProductionStatus.ts:191`（制作重发） | 两处原有调用不传新参数，文案和按钮不变（单测各钉一条「不触发」）。 |
| `nodeResultLifecycle.ts`（`appendNodeResultVersion`） | 20 个文件 | 不改。高清版按今天「一次运行落一版」的规则写进第 2 版。 |
| 版本卡标签（`NodeVersionCards.tsx`、`nodeVersionEntries.ts`、`GenerationListDetail.tsx`） | 节点版本栈、列表详情 | 只有来历是样片档案出高清方式的那一版，标签写「高清版」，其余仍是「第 N 版」。 |
| `NodeGeneratingOverlay` | `BaseGenerationNode.tsx` | 只多一个条件：运行中这次的 `attempt.draftTaskId` 有值时不画等待面。其余运行逐字不变（协调裁定：只开这一个口子）。 |
| `useDedupedModelSelect.ts` 的 `menuRowDescription` | 画布模型菜单、分镜行菜单、设置「模型顺序」 | 样片档案那一行的说明由样片规格拼出；其余行不变。分镜行菜单出现样片行（协调默认 1）。 |
| `DEFAULT_ORDER`（`src/config/modelBoxDefaults.ts`） | 菜单、设置页 | 没整理过的人：新行排在 2.5 后面。整理过的人：不生效。 |

## ★3 一致与复用

- **以前定过的**：
  - D-1126-sdse-libtv（拍板稿）：算数。
  - ModelSurfaces 板 `picker.draft-row`（「Seedance 2.5 · 草稿」加胶囊）：被这版取代，标 `dropped` + `supersededBy`。
  - 协调 11-26 裁定 C-D1～C-D11 与实现期四条（文末）。
  - 「界面不谈钱，可以印带标的估算」（11-15）：算数，所以价只印在按钮上，确认框正文不写数字和积分。
- **三条路**：
  - 沿原方向（变体轴 `variants`，草稿板的做法）：变体只换 model 字符串，样片要换请求体（加 `draft`）和第二步，装不下。
  - 换一种做法（目录独立行 + 派生档案）：**选它**。照 `grok-imagine-1.5-video-apimart` 的独立行先例和 MiniMax-H3-Regeneration 的第二步先例。
  - 删掉：不适用，这是新功能。
- **复用**：
  - 确认框复用 `confirmGenerationResend`。
  - 价的写法复用 `ComposerSendButton` 的金币加数字。
  - 版本写入复用 `appendNodeResultVersion`。
  - 失败复用通用失败词条。
  - 运行复用 `runGenerationNode` 单镜 Run 路。
  - 节点下方那一行是新容器，样式对齐 `NodeLabelRow`（h-7、caption、<40% 缩放隐藏）。

## ★4 全状态

| 状态 | 用户看到什么 |
| - | - |
| 空 | 样片还没出：没有下方那一行（`[data-sample-row]` 数 0）。 |
| 加载（样片生成中） | 今天的等待面和状态条，下方没有那一行。 |
| 成功（样片就绪） | 下方一行：「样片 · 剩 N 天」+「出高清 + 价」。 |
| 剩不到 2 小时 | 小标变提醒色（warning 的 soft / edge / ink 三档）。 |
| 过期 | 小标「样片 · 已过期」（置灰）；右边换成「重拍样片 + 样片价」；悬停说明为什么、下一步怎么做。 |
| 出高清中 | 样片照常能播；右边写「高清生成中」，没有进度条和按钮。 |
| 出高清失败 | 通用失败词条一行；样片还在，「出高清」还在，再点即重试。 |
| 部分成功 | 不适用：一次出高清只出一条。 |
| 取消中 | 走任务中心的取消，节点上不放取消（未认领）。 |
| 已出高清 | 第 2 版「高清版」当主图，角标 2，下方没有那一行。切回第 1 版，那一行回来。 |
| 第二次出高清 | 确认框（取消 / 再出高清 · 价）。 |
| 算不出价 | 按钮只写「出高清」，不印数字、不印 0；悬停「暂时估不出这次用量」。 |
| 能力不可用（模型下线 / 没连 APIMart） | 菜单里这一行跟随父模型的不可用规则灰掉并写原因，下一步是去连接页（今天的 `picker.disabled-row`）。 |
| 最长文字 | 28 字镜头名放在 240 宽节点上：标签行省略，下方一行折两行不省略。英文最长「Draft · 21 h left」+「Make HD」放在 240 宽节点上也折两行。 |

- **C-D3 剩余时间分档**：
  - 剩 ≥24 小时：剩 N 天（向下取整）。
  - 剩 1–24 小时：剩 N 小时（向下取整）。
  - 剩 <1 小时：剩 N 分钟（向上取整，不出 0）。
  - 过期：已过期。
  - 英文对应 N d / N h / N min left / Expired。
- 文案全走 i18n，zh / en 两轨。

## 5 中途表

| 状态 \ 打断 | 停（取消） | 关窗 | 断网 | 重启 | 连点 |
| - | - | - | - | - | - |
| 样片生成中 | 任务中心取消；上游按现成规则处理，回执在任务中心 | 主进程观察者收完，结果照样进项目；扣不扣费听上游 | 轮询失败走现成找回 | #1642 / main 现成找回路径 | 发送键在运行中已禁用 |
| 样片就绪 | 不适用 | 结果已落盘 | 不影响 | 重开后那一行照来历重算 | 「出高清」第一次点后立刻变「高清生成中」，第二次点不到 |
| 出高清中 | 任务中心取消；失败全退（文档「Failed tasks are fully refunded」） | 主进程观察者收完，高清版照样进第 2 版 | 同上 | 运行记录带 `attempt.draftTaskId`，重启后仍不盖等待面、仍写「高清生成中」 | 按钮不在，点不到 |
| 确认框打开 | Esc / 取消：不发、不扣 | 框随窗关，不发 | 不发 | 不发 | Enter 只确认一次 |
| 过期 | 不适用 | 不适用 | 不适用 | 重开后仍是过期 | 「重拍样片」走普通发送，运行中禁用 |

## 6 外部数据与失败

| 外部来源 | 规范 | 我们的偏差 | 失败时用户看到什么 |
| - | - | - | - |
| APIMart 样片创建 | 文档 `draft: true`，`resolution` 必须 480p | 样片档案把清晰度收窄成 480p，请求体固定带 `draft: true` | 通用失败词条 |
| APIMart 出高清 | `draft_task_id` + `resolution`；继承字段一个都不能发（相同值也 400） | 请求体只有 `model`、`draft_task_id`、`resolution` | 通用失败词条，样片和按钮还在 |
| 样片过期 | 「an expired draft returns 400」 | 按档案提前换成「重拍样片」。时钟误差、或有效期按落地时间算时，仍可能撞 400 | 通用失败词条 |
| 4k | 要原样片的通道支持 4K | 不做，能力表「待定」 | 不出现 |
| 价目 | 样片按 480p、成片按所请求清晰度计费 | 按父行约价。父行今天三个键不在白名单，约不出价 → 不印数 | 不印数，悬停「暂时估不出这次用量」 |

未知失败不怪用户的钥匙：走现成失败分类。

## ★7 性能

1. **新增的用户操作**：
   - 菜单多一行。
   - 视频节点下方多一行（常驻）。
   - 点「出高清」（同一个运行入口）。
2. **最坏规模**：200 个视频节点，其中 50 个是样片，画布平移。
3. **预算**：平移帧间隔 p95 ≤ 33ms；交互期间 >50ms 的长任务 0 个；点「出高清」到「高清生成中」可见 ≤ 100ms。
4. **场景**：`tests/perf/scenarios/canvas-pan-sample-rows.json`（`canvas-scale-bench.mjs --scales V200S50 --scenarios pan`）。数字见 PR 正文 `perf-scenario` 一行；基线由协调或验收线写。剩余时间不开计时器：渲染时按当前时间算，每分钟由一个共享时钟刷新。

## 8 真实条件

| 条件 | 状态 |
| - | - |
| Windows | unverified |
| 英文界面 | 走查跑 en 一轨 |
| 最小窗口 1100×690 + 停靠 Agent | 走查跑 |
| 真规模 | 性能场景 200 节点 |
| 干净安装 | 走查用隔离 profile |
| 真付费 | unverified（协调之后跑一次） |
| 键盘全程 | 确认框 Enter / Esc 走查；菜单 ↑↓ 走查 |

## 拍板图清单

`docs/design/boards/2026-11-26-sample-mode/SampleMode.board.json`，`pnpm run check:board-parity` 守。
- 旧板 `2026-11-07-model-surfaces` 的 `picker.draft-row` 标 `dropped`。
- LibTV 裁图只记 sha256 和日期，图不进仓库。
- 「已实现」由验收线翻。

## ★9 验收与回滚

验收清单（实现线按它自验，验收线只核它）。断言名 `board:SampleMode/<元素>`，走查 `tests/ux/sample-mode.walk.mjs`：

1. **菜单行**：
   - 视频菜单里「Seedance 2.5」下一行就是「Seedance 2.5（样片模式）」，说明原文「480p 低成本试片 · 满意后出 1080p · 最长 30 秒」。
   - 两行图标 `<svg>` 的 outerHTML 相同。
   - 选中后生成框模型格文本 = 「Seedance 2.5（样片模式）」，不省略（`scrollWidth <= clientWidth`）；英文「Seedance 2.5 (Draft mode)」。
   - 参数面板清晰度恰 1 个选项 480p，`aria-pressed=true`。
   - **main 上红**：没有这一行。
2. **下方一行**：
   - 样片出完，节点下方一行左边「样片 · 剩 2 天」（按档案 72 小时算、C-D3 向下取整）。走查只拨渲染进程的钟（Playwright `clock`），按样片自己的时间戳取各档中间：剩 2 小时 30 分 → 「剩 2 小时」、非提醒色；剩 1 小时 30 分 → 「剩 1 小时」、提醒色；剩 47 分 30 秒 → 「剩 48 分钟」、提醒色；过 72 小时 → 「已过期」。
   - 该行顶边 ≥ 画面底边、≤ 生成框顶边，行高 28。
   - 过期后右边没有「出高清」，只有「重拍样片」。
   - 字号断言：每个带文字的元素按计算样式对 token 值（`getComputedStyle(...).fontSize` 等于 `--nomi-font-*` 的计算值），不写死 px（协调裁定 3）。
3. **出高清**：
   - 点「出高清」：不弹框；替身只收到 1 次 POST `/v1/videos/generations`。
   - 请求体键集合恰为 `{model, draft_task_id, resolution}`，`draft_task_id` = 样片的任务号，`resolution` = `1080p`；没有 `prompt`、`image_urls`、`image_with_roles`、`video_urls`、`audio_urls`、`duration`、`size`、`seed`、`generate_audio`。
   - 出高清中：样片 `<video>` 不被等待面覆盖，右边写「高清生成中」。
   - 结果进第 2 版：角标 `2`（aria「铺开 2 个版本」），铺开后第 2 张卡写「高清版」，第 1 版仍是样片；主图是高清版，下方无 `[data-sample-row]`。
   - 切回第 1 版，那一行回来。
   - **main 上红**：没有出高清，请求里没有 `draft_task_id`。
   - **全部拦下也红**：拦下就没有 POST；改发整段提示词，请求体键集合就不对。
4. **第二次出高清**：
   - 切回样片再点「出高清」：`[role=dialog]` 出现，正文含「这条样片已经出过 1080p 高清版」「再出一次会按 1080p 全价再扣一次」，正文不含价格数字和「积分」。
   - 按钮依次「取消」「再出高清 ·」（价可印时带金币和数）。
   - 点取消：POST 数不变、版本数不变、焦点回到「出高清」。Esc 同样。
   - 点「再出高清」：POST +1，请求体同第 3 条。
5. **反例：普通 2.5 / 老节点**：
   - 普通 Seedance 2.5 选 480p 出的节点：`[data-sample-row]` 数 0，没有「出高清」。
   - 老项目：unverified（没有带视频结果的真实旧版项目夹具，见 ★1c）；没来历的视频结果由 `NodeSampleRow.test.tsx` 钉住。
6. **反例：算不出价**：
   - 替身价目约不出价时：发送键没有 `[data-send-cost]`，「出高清」按钮没有金币节点，全文不出现 `0` 和数字价；同时「出高清」与发送键的读屏说明都是「暂时估不出这次用量」——证明约价真跑过、不是没算。
   - 单测：可约价夹具（样片行真实请求体去掉三个键）下，三处约价请求都走父行：样片 480p；出高清 1080p，时长和音频取样片记录。
7. **对账**：中英、浅暗、1100×690 + 停靠 Agent，与拍板稿逐项对账；28 字镜头名和最长英文都过。并排图同一比例，附逐行索引。

**反例 → 结果 → 证据**：每条反例都把实现改坏一次跑红、还原后跑绿，日志进 PR 报告。改坏的具体做法：
- 去掉样片行。
- 出高清带上 prompt。
- 不检查第二次出高清。
- 普通 2.5 也算样片。
- 约价印 0。
- 遮罩不认 `draftTaskId`。

**同一类还会从哪里回来**：
- 别的入口：分镜落地、找回、主进程观察者落地。这几条都写 `provenance`，`sampleInfo` 只读来历，单测按这三种结果形状各钉一条。
- 别的形状：缓存复用（`vendorRequestId` 被抹）、i2v 样片、没有运行记录的结果。
- 别的版本：旧版目录夹具、旧版项目夹具。

**回滚**：revert 本 PR 的合并提交。
- 目录对账会把新行留在用户目录里，但没有档案的行按「未知模型」处理，不影响普通 2.5。
- 样片节点退回普通视频节点。

**花钱走查**：
- 只跑免费演练：替身扮两步，产物不付费。
- 真付费样本由协调在专用工作树里跑一次，产物标记字面量 `I-SD-sample-mode`。

## 实现期裁定（协调 11-26）

1. 目录独立行（b）。派生档案必须由代码从 2.5 档案推出，只收窄清晰度、加样片规格；加父改子跟的测试。已整理过模型框的人，新行排末尾。
2. 分镜菜单有样片行，分镜行不画出高清；只做 1080p，成片清晰度在档案里是列表，能力表记「4k 待定」；确认框正文只是不写价格数字和积分。
3. 约价（A）：不碰普通 2.5 的约价；样片按父行 480p、出高清按父行 1080p，时长和音频取样片记录。约价规则只有一个家，就是派生档案旁边的声明和函数，三处都从这里取。`vendorPriceRequest.ts` 不动。带价的两态记「未验证：2.5 无公开估价（三个非价格键不在 PRICE_FIELDS）」。
4. 生成中遮罩（A）：从这次运行本来就有的事实推（请求里带 `draft_task_id`，写进同一节点新一版），不加新布尔标记，遮罩只加这一个条件；取消记未认领。
5. 字号：板源字号先对 §2.3 字号表，不在表里的取最近一档写进清单 decisions（D-1126-1665-type-scale）；走查用计算样式断言字号；并排图同一比例；「已实现」由验收线翻。
