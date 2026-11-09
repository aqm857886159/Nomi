# 一次出多张：全部进同一镜的版本历史

实现线写，2026-11-09。四类（花钱：用户选 4 张、付 4 张、只看到 1 张），9 格全填。方向由协调任务书定：多张都进这一镜的版本历史、每张挂这次的运行号（沿用 2026-11-07 镜头结果归属那一刀的形状）、当前显示最新那张；删掉「只取第一个」，主进程和渲染层的「结果怎么归属」收成一份。

**第二轮（同日，按结构）：** 类根因复盘（`docs/engineering/direction-checks/2026-11-09-multi-result-landing.md`）查出第一轮漏了最早那一层——供应商读结果：保存的结果映射写着下标（`images.0.url`、`output.0`、`data.0.url`、`choices.0.message.images.0.url`）时只读第一项，认形状的兜底也只回第一个地址。用户 11-09 拍板「按结构」。本轮补上这一层（D8、D9），并补齐复盘 §6 的测试矩阵和旧数据证明；第一轮的 D1–D7 不变。

## ★0 先查别人

1. OpenAI Images API `n`（https://platform.openai.com/docs/api-reference/images/create ）· 一次请求要几张就在 `n` 里写几张，回话 `data[]` 每项一张，全部是这次请求的产物，没有「主图」 · 确认了 D1：一次运行交回几份产物就落几份，不在任何一层挑第一张。
2. Replicate predictions（https://replicate.com/docs/reference/http#predictions.get ）· 多输出模型的 `output` 是一个地址数组，调用方按数组收 · 确认了 D2：主进程账本按「一笔作业 → 多份产物」记，不再要求「恰好一份」，多于一份不再判取回失败。
3. ComfyUI history（https://docs.comfy.org/development/comfyui-server/comms_routes ）· `/history/{prompt_id}` 的每个输出节点带 `images[]` 列表，客户端逐张取 · 确认了 D1、D2：同一任务的多张图共用任务号、各有自己的文件，这里给每张一个由任务号派生的独立结果号。
4. Midjourney（https://docs.midjourney.com/hc/en-us/articles/32023408776205-Upscalers ）· 一次出四宫格，挑选、放大是之后另一个动作 · 改了范围：本刀不做「挑一张」（另一条线做），所有张都进版本历史，当前显示最新那张，用现有的版本历史组件看其余的。
- 出口：不涉及：本次不新增、不扩大、不挪动任何挡人的保护（拒绝、加锁、等待都不碰）；结果落地只是从「一张」变成「每张」。

## ★1 用户怎么用

当我在画布上给一镜选了「张数 2」（newapi `n`、Higgsfield `batch_size`、Runway `output_count` 这类开着张数的模型）点生成，我想两张都能看到、都能拿去用，以便从里面挑——钱是两张的钱。

1. 点生成，下一单（供应商请求 1 次）。
2. 上游一次交回 2 张；主进程把 2 张都落进项目（今天就这样），并都记进这一次运行的账。
3. 这一镜的版本历史里多了 2 个版本，版本号连着；当前图是最新那张（版本号大的那张）。
4. 打开版本历史（现有的结果铺开组件）能看到两张，切换、拖进时间轴照旧。
5. 关掉项目、重启、交给主进程观察者后再收回：还是 2 张，不多不少。
6. Agent 制作的 Run 那条路一样：一镜 2 张都落到这一镜的版本历史；以前这条路直接判「取回失败」（钱花了一张都没有）。

**不做什么：** 不做四宫格挑一张、放大、变体（另一条线）；不加任何界面元素、不改文案；不改请求怎么拼（张数参数照旧原样发）；不改提交回执怎么落盘、防重复下单；不改花钱门、批准方式；时间轴 / 导出照旧只用当前那张。

**已知坑：** ① Agent 制作 Run 的时间轴组装、审片仍按「一镜一份产物」挑这笔作业的产物，多张时用账上第一份（不在这刀范围，记进已知限制）。② 同一次运行的几张图共用任务号，结果号 = 第一张沿用今天的形状、第 k 张加 `-k`，所以张数 = 1 时结果号和今天一字不差。

**真实任务与量具：**

| 目标 → 信号 → 指标 | 量具 |
|---|---|
| 付了几张就有几张 → 版本条数 = 张数 → 比例 100%（矩阵每格） | `src/workbench/generationCanvas/runner/multiResultLanding.test.ts`（画布路 1 / 2 / 4 张） |
| 每张挂这次的运行号 → 每张结果的任务号 = 这次运行记录的任务号、这次运行记录落成成功且指向当前那张 → 比例 100% | 同上 |
| 不重复落盘、不重复下单 → 落盘文件数 = 张数、供应商请求数 = 1 → 比例 100% | 主进程 `electron/capabilityCore/canvasShotMultiOutput.test.ts`（画布单镜 Run 1 / 2 / 4 张）、`electron/productionRun/productionGenerationMultiOutput.test.ts`（Agent 制作 Run 1 / 2 / 4 张） |
| Run 那条路一镜 N 张都落到节点 | `src/workbench/capability/multiShotCanvasLanding.multiResult.test.ts`、主进程投影 `electron/productionRun/multiShotCanvasLanding.test.ts` |
| 重新取回 N 张都落 | `src/workbench/generationCanvas/runner/recoverTaskActions.projectIdentity.test.ts`（1 / 2 / 4） |
| 同一运行记录号重放：回 N 份、供应商请求 0 | `multiResultLanding.test.ts` 重放格、`canvasShotMultiOutput.test.ts` 同步格 |
| 张数 = 1 和今天一模一样 | 上面几个文件的 1 张格 + 现有 `shotResultOwnership.test.ts` 22 格不改断言照绿 |
| 上游给几份、读出几份（逐供应商、逐阶段）→ 读出数 = 4 → 比例 100% | `electron/catalog/multiOutputMapping.test.ts`：内置目录里每条写了下标的产物映射 × create / query / result，外加 `tests/fixtures/old-user-data` 下每份旧目录，造四份假响应，引擎 A、引擎 B 都读出四份（修前 685 格红 462） |
| 老用户自己接的目录升级后出四张 → 落盘文件数 = 4、请求数 = 1 | `electron/catalog/oldUserMultiImageAfterUpgrade.test.ts`（v0.24.1 向导目录真实夹具，走真 runTask 和真落盘） |
| 查询 + 结果两跳的通道不重复下载 → 每个地址只下 1 次；第 2 张下载失败 → 可找回、再取回四张都落、提交 0 次 | `electron/tasks/multiOutputQueryResultHop.test.ts` |
| 张数 0 / 1 / 2 / 4 × 图 / 视频 / 音频 × 画布 / 批量；两次运行同一组地址不被并掉 | `src/workbench/generationCanvas/runner/multiResultLanding.test.ts` |
| 两次运行倒序到达，当前选中和时间轴不被旧运行抢；旧版真实节点收四份 | `src/workbench/generationCanvas/runner/multiResultOwnership.test.ts` |
| 两次取清单之间链接换了签名，按序号认身份、不重落 | `electron/productionRun/productionGenerationMultiOutput.test.ts` |
| 真付费 n=2 | 未验证：协调跑一次（见报告） |

真实任务：① 画布上一镜张数 2 文生图；② 同一镜先后两次运行（各 2 张），两次的结果各归各的；③ Agent 制作 Run 一镜张数 2。

### ★1b 连带界面

节点当前图（显示最新那张）；结果铺开 / 版本历史（多出 N−1 个版本，现有组件）；生成列表小卡、任务中心（一次运行一条，不变）；Agent 回执（读 Run 账，账上多了几份产物，回执文字不变）；时间轴（只在当前图换了才对账，用的是当前那张）。都不新增文字。

### ★1c 老用户

**没有迁移步骤，靠编号兼容 + 真实旧数据升级测试守住。** 守它的测试：`electron/catalog/oldUserMultiImageAfterUpgrade.test.ts`（v0.24.1 向导目录）、`electron/catalog/multiOutputMapping.test.ts` 的旧目录段（`tests/fixtures/old-user-data/{catalogs,curated}` 下每一份）、`src/workbench/generationCanvas/runner/multiResultOwnership.test.ts` 的 v0.24.0 真实节点段。

- 不是内置的目录（用户自己接的、Agent / 向导存下的）升级时不会被改写（`seedBuiltins` 只对内置供应商对账）：v0.24.1 向导接的 `gpt-image-2`、`opaque-image-x` 都声明了张数 1–4，旧映射里写着 `data[*].url` 或 `choices.0.message.images.0.url`。不改它们：映射格式是我们定的，读的那一道把「数字下标落在列表上」读成整份列表（D8），所以升级后不动目录就能拿回四张；内置目录照旧在升级时由 `seedBuiltins` 对账成当前版本。
- 第一张的结果号、产物号和以前一字不差（`${节点}-${任务号}`、`asset-1` 那一类），所以旧数据读进来天然就是「只有一份的集合」；`node.result` 和运行记录的 `resultId` 就是当前选中，不另加字段。
- 项目文件格式不变：不加字段；多出来的只是版本历史里的条目，旧版本打开一样读得懂。
- 升级前已经落下的结果不动；升级前只落了一张的老运行不回填（已知限制：钱是当时花的，有的供应商另外几张根本没下载，下载了的文件在项目素材里，但账上只记了一份，没法可靠地认回另外几张是哪次的）。
- Run 账本格式不变：一笔作业多记几条产物，产物号由任务号派生；旧账（一笔一份）照读。
- 退回上一版本打开：版本历史照读；Run 账上一笔多份产物，旧版本只认第一份（和今天一样）。

## ★2 谁说了算

| 东西 | 正本 / 唯一写入口 | 谁读 |
|---|---|---|
| 上游这一笔交回了哪些产物地址 | 主进程 `tasks/taskResultReading.ts` 的 `readTaskResponse`（两台引擎唯一的读法：先合同映射、再通用规则，都过空集 / 媒体类型 / 回显三道筛） | 引擎 A：`runtime.ts` 的 `buildProfileTaskResult` 和无映射兜底、`taskResultQuery.ts` 的晚到路径；引擎 B：`apimartGenerationOutputs.ts` 的 `readMaterializationOutputs`（door-map 4 扇，全是读） |
| 一次任务交回了几份产物 | 主进程：运行时把全部产物落盘（`buildProfileTaskResult`），提交出口 `productionGenerationSubmission.materialize` 把每一份记成这笔作业的产物 | 画布单镜 Run 回话（`canvasShotResult`）、Agent 制作落画布投影（`buildMaterializeShotsPayload`）、对账（`driveReconciliation`） |
| 一份产物成为哪个节点结果 | 渲染层 `normalizeCatalogTaskResults`：每份媒体产物一个结果，没有挑选 | 画布运行控制器、找回 |
| 结果归哪次运行 | `nodeRunOutcome.ts` 的 `nodeRunOutcomePatch`（2026-11-07 那一刀的唯一合并规则）：每张都以这次的运行记录号投 | 活的画布、盘上副本、暂存重放、撤销叠回 |

**数门（第二轮，`node scripts/door-map.mjs readTaskResponse`）：** 4 扇，全是读（`taskResultReading.ts` 自身、`runtime.ts` 两处、`taskResultQuery.ts`、`apimartGenerationOutputs.ts`）；它们都拿 `assetUrls` 整份往下传，没有一扇再取 `[0]`。

**数门（第一轮，`node scripts/door-map.mjs normalizeCatalogTaskResult`，roots=src,electron，不含测试）：** 6 扇（写 4、读 2）：`catalogTaskActions.ts`（文本流、媒体两处）、`imageActions.ts`、`videoActions.ts`、`recoverTaskActions.ts`。主进程同口径「只取一份」的地方：`canvasTransportProvider.ts` materialize（「画布那台只取第一份产物」）、`productionGenerationSubmission.ts` materialize（「多于一份判取回失败」）、`canvasShotResult.ts` `readyArtifact` / `resultFromArtifact`、`multiShotCanvasLanding.ts`（主进程）`artifacts.find`、`productionRunDriverOps.ts` 对账 `assets?.[0]`。`mcpPreviewImage.ts` 只做预览缩略，不落地，不受影响。

**删掉的旧东西（同提交）：** 渲染层「先视频、再图、再音频、取第一个」那段挑选；`imageActions` / `videoActions` 里没有调用方的 `normalize*GenerationResult` 包装；主进程 `canvasTransportProvider` 的「只取第一份」；提交出口「`outputs.length !== 1` 判取回失败」；`canvasShotResult` 的单份 `resultFromArtifact`。老用户怎么过：都是内存里的读法，不落盘。

### 决定

- **D1 每份媒体产物一个结果。** 渲染层把任务结果里每份带地址的媒体产物各变成一个节点结果（按上游给的顺序），不挑类型、不取第一个；文本任务仍是一个文本结果。结果号：第一份 `${节点}-${任务号}`（和今天一样），第 k 份 `${节点}-${任务号}-k`。
- **D2 账本一笔多份。** 提交出口对每份产物各落一条账（产物号按序号派生，重进时按号补齐缺的那几份，不重复落盘）；回话、落画布投影、对账都读这笔作业的全部产物。
- **D3 投递。** 同一次运行的每张都按这次的运行记录号经 `deliverRunOutcome` 投（复用唯一合并规则），按上游顺序；最后一张是最新版本、成为当前图。运行函数返回的是成为当前图的那张（时间轴据它对账）。
- **D4 自动另存。** 开着「自动另存」时每张都另存（以前只存第一张）。
- **D5 Agent 制作那条路也按号。** 落画布投影这一镜带上全部结果，外加这笔作业的运行记录号（`runRecordId`）；渲染层每张都带这个号落（和画布路同一条合并规则）。以前不带号，只结掉「在跑的制作记录」：第一张把记录结成成功、后面几张不再记到这条记录上，记录指向第一张、当前图却是最后一张。
- **D6 提交出口每次都取一遍产物清单、按序号补齐。** 账上已有 k 份、上游交回 N 份：只落第 k+1…N 份（产物号按序号派生，第一份和今天一字不差），崩在两份之间重进时只补缺的；上游清单读不出来时账上已有的照收。对账（`driveReconciliation`）上游报几份本机文件就收几份，有一份不是本机文件就整笔停成「需要处理」（和今天一样）。
- **D8 读结果读全集（第二轮）。** 合同映射里的数字段落在列表上时读整份列表（`images.0.url` = 每一项的 `url`），和通用规则早就在做的「同级列表一起读」是同一条规则；认形状的兜底（`url` / `data[]` / `images[]` / `result.*` / 聊天回话）回第一组非空的整组，聊天回话逐个 choice、逐张图读。每一项照旧过空集、媒体类型、回显、去重；不加「只取第一个」的分支或开关。删掉单值的 `extractAssetUrl` / `extractChatImageUrl` 和合同读法里的「取第 0 项」。没有改任何目录声明：内置目录、用户目录、旧版本存下的目录都靠这一条读法拿全。引擎 B 的产物号按序号派生、保证同一笔里不撞（一项里 `url` 是数组时各算一份）。
- **D9 两跳通道只在结果那一跳落盘（第二轮）。** 有 result 那一跳的通道（Runway：查询 `output.0`、结果 `output`，同一组地址），查询那一跳只读状态、不下载；否则读全集以后一笔四张会先下四张、再下四张。没有 result 那一跳的照旧在查询时落盘。
- **D7 重放只改读法。** 画布单镜 Run 的重放 / 再查（`appIntegrationCanvasShot` 的 replay / pollRun）和收尾铃从账上读「这笔作业的全部产物」而不是第一份；提交、重放的控制流、判据、分支一字不动（协调 11-09 批准，条件见 PR 正文）。这是「结果归谁」的读法，不是重放逻辑：同一个运行记录号重放时回的还是账上那几份，供应商请求数仍是 0。

## ★3 一致与复用

以前定过什么：2026-11-07 镜头结果归属（`docs/plan/2026-11-07-shot-result-ownership.md`）定了「结果按运行记录号收账、结果永远进这一镜、比它新的成功了只进版本历史」——还算数，这刀照它投。三条路：沿原方向修（每张都走同一个合并规则）——选它；换做法（结果结构里加「一组」、新组件显示）——要新界面，任务书禁止；删掉张数控件——用户付了钱选的能力，删了就没了，不选。复用：`nodeRunOutcomePatch`、`appendNodeResultVersion`、现有结果铺开组件；没有第二份定义。

## ★4 全状态

| 状态 | 用户看到 |
|---|---|
| 空 | 不变（还没生成） |
| 加载 | 不变（生成中遮罩，一次运行一个） |
| 成功（N 张） | 当前图是最新那张；版本历史多 N 个版本 |
| 部分成功 | 上游说成功、交回 k 份能读的产物：落 k 张；一份都读不出：照旧落「可找回」（`retrieval-parse`） |
| 失败 | 不变（失败卡） |
| 取消中 | 不变；取消后晚到的那次照旧按号落进这一镜（N 张都落） |
| 过期 | 不变（可找回 → 重新取回，取回来是 N 张） |
| 能力不可用 | 不变（模型不可用照旧给已有出口） |

## 5 中途表

| 时刻 | 停（取消） | 关窗 / 重启 | 断网 | 连点 |
|---|---|---|---|---|
| 已交、生成中 | 渲染层不等了，交主进程观察者收尾；收到的 N 张都记进账，摇铃后按号落 N 张 · 扣了 N 张的钱 · 回执在这次 Run | 重开收敛成可找回；重新取回从账上读 N 张 · 不再扣 · 回执在 Run | 轮询失败到时限落可找回，不重发 · 不再扣 | 第二下被主进程拒（不变） |
| 上游已交回、正在记账 | 记账不受取消影响 · 已扣 | 记了 k 份就崩：下次查按号补齐缺的 · 不再扣、不重复落盘 | 记账是本机写，不受影响 | 同上 |
| 已落到节点 | 已结束 | 版本历史已存进项目 | 不影响 | 再点 = 新运行，新的 N 张 |
| 切走了项目 | 回去才能点 | N 张都写进原项目盘上副本 | 同上 | 同上 |

## 6 外部数据与失败

外部来源：供应商任务结果（OpenAI 兼容 `data[]`、各家 `output` 数组、ComfyUI `images[]`）——读法照旧只在主进程 `readTaskResponse` 一处，第二轮起读全集（D8）。RunningHub 3D 的 `results` 列表现在每个文件都收：要是里面混进没有扩展名的非模型文件，也会去下载，下载失败整笔照旧落可找回（没见过这种回话，记进已知限制）。同步 TTS 只回一个 base64 字段的，照旧解那一个字段（协议上一次就一段）。偏差：有的上游多回一份「回声」参考图，照旧由回声过滤去掉；某一份下载失败照旧按已有规则（整笔落可找回，不发明「部分落」新状态）。失败时用户看到的不变。

## ★7 性能

新增计算：一次运行的结果从 1 次合并变成 N 次（N ≤ 4，上游张数上限）。最坏规模：200 个节点、每个节点 20 条运行记录、一次批量每个节点 4 张。预算沿用 `canvas-run-outcome-projection-200x20`（≤16ms 一轮 200 节点各一个进度 + 一个结果）；4 张是 4 次同一合并，线性。本刀不新增用户操作，不新登记场景；数字未跑（未验证：本线时限内没跑 perf 场景，交协调）。

## 8 真实条件

- 免费：单元 / 主进程矩阵（真控制器、真 store、真合并规则、真提交出口和账本，执行器 / 供应商是假的、一次交回 N 张）。
- 真窗口截图（中英）：见 PR `## 真实场景复现`，没跑到的写 unverified。
- 真付费 n=2：未验证，协调跑一次。
- Windows：未验证（不碰平台差异代码）。

## 拍板图

不适用：不新增、不改任何界面元素、布局、文案；多张用的是现有版本历史 / 结果铺开组件（已拍板的样子）。

## ★9 验收与回滚

**验收清单（动手前写全，验收线只核这份）：**

1. 画布路矩阵：张数 1 / 2 / 4，每格断言版本条数 = 张数、版本号连续、当前图 = 最后一张（版本号最大）、每张任务号 = 这次运行记录任务号、运行记录成功且 `resultId` = 当前图、执行器调用次数 = 1。
2. 主进程画布单镜 Run：张数 1 / 2 / 4，账上这笔作业产物数 = 张数、落盘文件数 = 张数、供应商提交次数 = 1、回话 `assets` 数 = 张数；再查一次（重放 / 观察者收尾后查）还是 N、不新增文件。
3. Agent 制作 Run：张数 1 / 2 / 4，提交出口不再判取回失败，产物数 = 张数，落画布投影这一镜带 N 个结果，渲染层落到节点 = N 个版本。
4. 找回路：可找回后重新取回，N 张都落、挂同一运行号。
5. 反例（改坏必红）：把渲染层改回「取第一个」→ 画布矩阵 2 / 4 格红；把提交出口改回「恰好一份」→ 主进程 2 / 4 格红；投递不带运行号 → 画布格「运行号一致」红。
6. 反例：张数 = 1 时行为和今天一模一样（结果号、版本号、运行记录、当前图、时间轴对账），`shotResultOwnership.test.ts` 22 格不改断言照绿。
7. 反例：同一镜两次运行各 2 张，两次的结果各归各的运行记录（任务号不串），后一次的最新那张是当前图。
8. 这一类还会从哪回来：新的媒体落地入口（配音 / 音乐走同一个 `normalizeCatalogTaskResults`；批量出图走同一个控制器；Agent 走同一个提交出口）——矩阵覆盖画布、Run 两条，音频格单测一格。
9. `pnpm run typecheck`、相关单测全绿；推送前快检通过。
10. 重放格（协调 11-09 加）：同一个运行记录号重放（第一次的回话在路上丢了、渲染层按可重试再交）→ 回 N 份、版本历史 N 条、只有一条运行记录、重放时供应商请求数 0。渲染层 `multiResultLanding.test.ts` 1 / 2 / 4，主进程 `canvasShotMultiOutput.test.ts` 同步格的第二次交（`vendor.executes` 仍是 1）。

第二轮加（复盘 §6 的合同，判据一律是「同一笔上游给四份有效产物，四份都留下」）：

11. 读结果逐供应商、逐阶段：内置目录每条写了下标的产物映射 × create / query / result，和每份旧版本目录夹具，四份假响应都读出四份（引擎 A、引擎 B 各一遍，引擎 B 产物号不撞）；张数 1 的身份不变；空集、错类型、回显照旧筛掉；同一地址只算一份。修前跑出红、修后绿。
12. 老用户目录升级：v0.24.1 向导目录（不是内置、升级不改写）张数 4 → 一次请求、四个文件进项目；张数 1 照旧一个。
13. 两跳通道每个地址只下一次；第 2 张下载失败 → 可找回（不判生成失败）、再取回四张都落、提交 0 次。
14. 张数 0 / 1 / 2 / 4 × 图 / 视频 / 音频 × 画布 / 批量：给几份留几份，0 份不是成功、不指向任何结果。
15. 身份不靠地址：两次运行回同一组地址各留各的；两次取清单之间链接换了签名，经真实 `generationOutputMaterializer` 和确定性资产落盘按序号认、不重落；分别覆盖下载前中断、文件已落但回执未记的缺口，重进补齐四份且已落文件身份不变。把真实物化身份改成 URL 时，后一格必须红；还原后绿。
16. 两次运行倒序到达（含交给观察者那条）：当前选中和时间轴留在新运行，旧运行四份都进历史、记在自己的记录上；时间轴只按当前选中对账一次（四个候选不变成四个镜头）。v0.24.0 真实节点原样打开，观察者收尾四份按旧记录号落上。
17. 复盘三条预测都翻转：特征（主进程画布 / Agent 提交 / 重放各留四份）、身份（四份账本投出四份）、映射（逐供应商四份）。

**回滚：** revert 本 PR 的实现提交（第一轮落地那一笔、第二轮读结果那一笔，各自可单独 revert；第二轮单独 revert 会回到「有的供应商只读第一张」）。

**独立验收：** 合并前另派验收线（不是本线），报告链接写进 PR `## 独立验收`。
