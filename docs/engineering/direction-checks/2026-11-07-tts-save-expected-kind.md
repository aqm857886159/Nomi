# 方向检查：生成产物落盘关口与「付费前拒」——配音扣了钱存不进项目（2026-11-07）

> 复盘线 D-check-tts-save，独立写（没参与修复）。第 0–6 节只依据：任务书原话、协调真付费复现、反例日志 A / A2 / BC、`origin/main`（71e9280ae）代码与 git 史。写这几节之前读到的修复线材料只有 `staged.stat` 与 `commit-msg.txt`（看统计时顺带打开，见第 7 节「独立性声明」）；设计卡、根因合同、diff 正文、修复线报告都是写完第 0–6 节之后才读。
> 触发：`node scripts/fix-churn.mjs` 对四个文件本身命中——`localFileImport.ts` 第 3 个、`assetsIpc.ts` 第 4 个、`tryModel.ts` 第 6 个、`runtime.ts` 第 10 个（另有三个概念单位命中，见第 1 节）。

## 0. 一句话根因

主进程里「这是生成产物」只是 meta 包里的一个字符串（`kind: "generated"`），「该是哪一类」是另一个可空字段，两者必须成对这件事只在落盘关口运行时才查；而配音借了收 `unknown` 的用户文件入口，类型系统看不到这对字段。钱那一面同样缺一层：「结果只能是项目里的文件」没写进任务形状，只能花完钱才发现。缺的是**按载荷形状分开的门**，外加一个**付费前的结果去向判据**。

## 1. 归类表：bug → 直接原因 → 类

窗口：`origin/main` 近 14 天、非合并、标题 `fix|hotfix`（与 `fix-churn.mjs` 同口径；脚本不列提交号，我用同口径 `git log` 取的）。四个文件共 17 个不同提交（`dae9e0fc0`、`7a3202d79` 同时碰两个素材文件）。

| 提交（日期） | 碰的文件 | 直接原因 | 类 |
|---|---|---|---|
| `dae9e0fc0`（10-27） | localFileImport、assetsIpc | 导入视频转码进程无界、取消不了 | A 导入转码进程归属（复盘 `docs/engineering/direction-checks/2026-10-27-ffmpeg-process-owner.md`） |
| `7a3202d79`（10-27） | localFileImport、assetsIpc | 同上第 2 轮：输出量杀进程、退出不等转码 | A |
| `f66decf47`（10-27） | assetsIpc | 点「取消拆解」后照发付费调用；请求登记挪成中立模块 | B 在途请求停止（`ipc.inflight-request-stop`） |
| `5e4761865` `c797ee2fd` `9b1810951`（10-30） | tryModel | 试跑「到底提交了没有」跨调用不持久、收据与校验合同不齐 | C 试跑已提交算不算（概念单位命中 5 次） |
| `bccd5d789`（10-31） | tryModel | 读不了的试跑记录永久锁死连接 + 模型 | C |
| `995f57cac`（10-31） | tryModel | 两个 PR 合并错位导致类型红 | C′ 合并错位（复盘 `docs/engineering/direction-checks/2026-10-31-try-model-record-merge-skew.md`） |
| `e0c085b79`（10-25） | runtime | 参考容量没按模型声明 | D 参考投影与容量 |
| `9cd343ebe`（10-27） | runtime | 下架调不通的模型；第一闸拿不到完整模型身份 | D / 目录 |
| `d1d7ab8ad`（10-30） | runtime | 中转视频声明协议丢失、带鉴权结果流；**同提交加了一句只给视频的「没项目号就别提交」** | **F 结果去向：只能是项目文件的任务（本题同类，第一个特例）** |
| `c07844ba8` `98b633f43`（10-30） | runtime | 文件流结果的出处与取回阶段码 | F 的配套（文件流结果取回） |
| `483057c9a` `0df4b046c`（10-31） | runtime | 发请求前被拒的模型，错误卡没指去模型接入 | G 发请求前拒绝的错误卡归类 |
| `2b8d87975` `f253df634`（11-01） | runtime | 参考素材的临时链接失效 / 被拒 | H 参考素材投递 |
| **本题**（11-07，未提交） | 四个文件 | 配音经 `importLocalFile` 落生成产物、没带期望类型，落盘关口必抛；没项目号时也是先花钱后失败 | **I（= 10-17 落盘关口没数到的门）+ F（钱那一面）** |

窗外但同一扇门（30 天）：落盘关口本身 10-16/17 两天 5 刀（`040aff21b` `cfef1a93c` `24db444b3` `9a24cecc2` V-1208；`42736b307` V-1213 / #1213），本题的关口就是最后这一刀加的。

**结论**：四个文件凑够数主要是碰巧。`runtime.ts` 是 `runTask` 唯一的总入口，什么任务都得过它；`tryModel.ts` 的 5 刀是一个和落盘无关的概念；两个素材文件的 3 刀是转码与取消。真正同类的只有两条线：
- **I**：#1213（10-17）把期望类型做成落盘关口必填 → 本题是它没数到的那扇门；
- **F**：`d1d7ab8ad`（10-30）给「文件流视频」写了一句付费前拒 → 本题要给「同步字节音频」再写一次。

所以「生成产物进项目的那扇门」确实被反复补，只是证据在落盘关口 30 天的史和 F 线里，不在这四个文件 14 天的计数里。

## 2. 为什么这一类会一直出现

**用户那一刻**：项目里点「生成配音」，看到扣费成功，接着报错，项目里没有音频；再点一次，再扣一次，再失败。v0.23.2（`7171ae332` 移植）、v0.24.0、v0.24.1 都是这样（`git tag --contains` 核过，`git show v0.24.1:electron/audioTaskRunner.ts` 两处都没有 `expectedKind`）。所有走 `runAudioTask` 同步路的音频都在内：`wantedKind === "audio" && !mapping.query`，即配音、音乐、音效，含豆包 NDJSON 那条。

**结构上四个洞，层层叠着**：

1. **门的身份是数据，不是类型。** `storeAssetBytes` / `copyAssetFile` 靠 `isGeneratedAssetMeta(meta)`（比较 `meta.kind === "generated"` 这个字符串）决定走不走关口；期望类型的签名是 `LocalizedAssetType | null`，`null` 合法、意思是「不是生成产物」。所以「生成产物 ⇒ 期望类型非空」这条配对，类型系统表达不了，只有 `generatedExpectation` 在运行时查。#1213 说的「由类型必填」，只对直接写死参数的调用者成立。
2. **无类型入口把类型要求洗掉。** `importLocalFile(payload: unknown)` 本来是给渲染层 IPC 和 MCP 本机路径用的用户文件门（概念 `asset.local-file-import` 原话：「本地文件进入项目素材的统一导入路由」）。它从 `raw.expectedKind` 现读，读不到就是 `null`，再交给 `storeAssetBytes`，类型检查照样全绿。配音 06-15（`a4e6b2f43`）起就借这扇门落生成产物，比关口和概念登记都早。
3. **数门只数一跳，生产者名单是手写的。** `door-map generatedExpectation` 只数出 1 扇门（`projectAssetStore` 自己）；配音隔着 `audioTaskRunner → importLocalFile → storeAssetBytes → generatedExpectation` 三跳。#1213 的提交信息靠手列「本机生产者（截图、抽帧、剪辑、深度、拼帧、Codex、Antigravity、即梦进程）」，配音不在名单上。
4. **测试替身正好盖住关口。** `electron/audioTaskRunner.test.ts` 第 14–16 行把 `./assets/localFileImport` 整个 mock 掉（注释：「避免触真 writeAsset 落盘」），断言只看 `contentType` 与 `fileName`。关口加上之后，配音的测试照样绿。main 上没有一条走查或付费抽检真生成一条配音落进项目；这次是 #1436 分支上的 `catalog-latest-real.paid.mjs` 抽到的。

**钱那一面**：`runTask` 的音频分支直接 `spendGate → runAudioTask`，「结果要落哪里、需要什么」在付费前一项不查。同类的前提检查只有 `d1d7ab8ad` 那一句视频专用英文（`mapping.result?.mediaResponse && !projectId`）。还有一个结构事实：**`tryModel` 调 `runTask` 时 `extras` 里永远没有 `projectId`**（`tryModel.ts:199-201`），所以 Agent 试跑任何配音模型都是先付费、再在 `importLocalFile` 第一行报 `projectId is required`，这个洞比 #1213 还早。

#### 三条体验铁律

| 铁律 | 本题 | 证据 |
|---|---|---|
| ⑩ 说的=摆的 | 不适用：模型和参数没摆错，错在结果落盘 | — |
| ⑪ 能选到 | 不适用：配音模型能选到，也能发出去 | — |
| ⑫ 点了=以为的 | **命中**。点「生成配音」以为得到项目里的音频；实际扣了钱、报错、项目里什么都没有 | `tests/ux/full-walk/catalog.mjs` 里没有配音生成这一格的 `userExpectation` / `actualObservation`；本题逃逸条目应挂 ⑫ |

同一个用户结果之前也出现过：V-1213（`USER-20261016-video-result-not-retrieved`）是「钱扣了，片取不回」。修它的那道关口，从一扇没数到的门又造出了「钱扣了，配音存不进」。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| ① 下一个「同步出字节」的执行器（新的音乐 / 音效 / 3D 供应商）照抄 `audioTaskRunner` 的写法，用 `JsonRecord` 拼载荷调 `importLocalFile` 或 `storeAssetBytes`、带 `kind: "generated"`：类型检查照过，花完钱在落盘关口抛。只要「是不是生成产物」还靠 meta 字符串分流，换个文件名照样冒 | `grep -rnE "kind: *[\"']generated[\"']" electron --include='*.ts'`，逐个看所在调用的入口签名：入参是 `unknown` / `JsonRecord`，或期望类型可为 `null` 的，都是候选；再给它写一条走真关口、不 mock 落盘的单测，看红不红 |
| ② 自定义调用脚本的 `saveFile`（`customCallDispatch.ts:111-118`）走的是不过关口的 `writeAsset`，记 `kind: wantedKind`。所以：(a) 脚本把 PNG 字节当视频交回来，会当视频落盘，V-1213 那类从这里回来；(b) 没项目号时 `spendGate` 先放行，`uniqueAssetPath` 才报 `Project not found`，又是先花钱后失败。0.23.x 移植提交信息写过「自定义调用按 wantedKind 记 kind，不进关口」，是有意豁免，但 main 上没登记 | 用 `electron/runtime.customCall.test.ts` 的夹具：脚本在 `text_to_video` 任务里 `saveFile(PNG 字节)` → 断言落成 video 资产（预测为真）；`projectId` 置空 → 断言 `spendGate` 被调过、结果抛 `Project not found`（预测为真） |
| ③ 「付费前拒」继续按任务类型一句一句地加：视频（`d1d7ab8ad`）、音频（本题），下一个是自定义调用或进程类（即梦下载目录，`processOperation.ts:153` 没项目号就静默不导入本地文件）。同时 try_model 永远不带项目号，加了付费前拒以后，Agent 就**永远试跑不了**这类模型，接入路走到 try_model 这一步会死胡同 | `grep -nE "require a project\|projectId" electron/runtime.ts electron/catalog/customCallDispatch.ts electron/catalog/processOperation.ts`，数「没项目号就拒」各写了几处；用 `tryModelSubmitBudget.test.ts` 的夹具对一个 `text_to_audio` 模型调 try_model，看能不能有任何一条路拿到「成功」 |

## 4. 靶子独立性检查

- **尺子是谁写的**：新矩阵 `electron/tasks/syncBytesResultLandsInProject.test.ts`、老用户回放 `oldUserDubbingLandsAfterUpgrade.test.ts`、零额度演练、付费走查脚本，全是修复线自己写的。本题的根就是「修复线自己写的尺子」：#1213 的关口矩阵（`generatedOutputKindGate.test.ts`「三扇入口」、`retrievalKindGate.test.ts`「两台引擎」）只量了它自己点过名的门；配音单测的替身又把关口整个绕开。所以这里的独立性不是走形式。
- **从反例日志能确认的**（不依赖修复线的说法）：
  - A2 撤掉修复后，10 格（apimart/nomi-audio、minimax ×2、elevenlabs ×3 含音乐与音效、relay-tts、bare-tts 缺省映射、火山豆包）红在**真的** `generated_output_expected_kind_required`，调用栈经过真 `importLocalFile → storeAssetBytes → generatedExpectation`，没有替身。
  - BC 撤掉付费前拒后，三个入口（tasks:run 令牌路、画布单镜、Agent try_model）× 10 格共 29 条红。
  - 这两组说明尺子量到了真关口、真入口。
- **尺子没量到的形状**（第 3 节的三条都在矩阵外，日志里看不到）：
  - 自定义调用 `saveFile` 字节；
  - 进程类本地文件；
  - try_model **成功**那一面：日志只有「拒」，没有「Agent 能试跑配音模型」；
  - 渲染层 `nomi:assets:import-file` 带 `kind: "generated"` 进来；
  - Windows。
- **独立的靶子在哪**：只有协调的真付费复现（真 IPC `nomi:tasks:run`、真 APIMart、真扣费）不是修复线写的。合并前应由协调用修复线的付费走查跑一次，同时核对脚本断言的是「项目里多了一个能播的音频文件」，不是「没抛错」。
- **「修对了反而掉分」的先例**：这里没有评测分数。同形状的先例是测试替身：替身让测试绿着，真代码坏着。验收要核：矩阵里有没有任何一格 mock 了 `localFileImport` / `projectAssetStore`。
- **靶子本身有没有错**：关口（#1213 期望类型必填）没错，不该为了让配音过而放宽它；错的是门的形状。

## 5. P0：这些是我们独有的吗？现成方案有哪些

- **独有的**：「生成产物该是哪一类、字节对不上不落盘、付了钱的结果必须进项目」是素材 / 按镜头花钱的领域语义，自写合理。关口本身（`generatedAssetStaging` + `generatedMediaDecode`）已在概念登记 `asset.generated-media-decode` 里。
- **不是独有的**：「两种载荷不能从同一扇门混进来」「不可信的 IPC 入参在边界解析成有类型的值」，这两件是通用能力，仓库里已有现成做法，不该自写第三种：
  - **TypeScript 判别联合**：渲染层已经这么写了。`src/workbench/api/assetUploadApi.ts:46-54`：`{ kind?: 'upload'; expectedKind?: never } | { kind: 'generated'; expectedKind: AssetKind }`，生成产物不带期望类型就编不过。主进程这侧没有对应的形状，一过 IPC 就退回 `unknown` + `localizedAssetTypeOf(raw.expectedKind)`。
  - **zod（`^3.25.76`，已在 dependencies）**：主进程 65 个非测试文件在用，`z.discriminatedUnion` 已有先例（`electron/agentLane/laneReceiptCommands.ts:10`、`electron/shared/agentCapabilities/canvasWrite.ts:339`）；IPC 处理器里 `safeParse` 解析入参也有先例（`electron/feedback/feedbackIpc.ts`、`electron/browser/core/browserViews.ts`）。另有 typebox 1.3.7、ajv 8.20.0（dev）。不需要引新库。
  - 做法出处：
    - zod 判别联合 <https://zod.dev/api#discriminated-unions>；
    - TypeScript 判别联合收窄 <https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions>。
    - Electron 安全清单第 17 条（<https://www.electronjs.org/docs/latest/tutorial/security>）只要求校验 IPC 的 sender（仓库里已有 `assertTrustedSender`），**不管入参形状**（我实查过原文）。入参在边界解析成有类型的值，靠的是上面的 zod。
- **自写登记**：本题碰到的单位都是概念登记（`asset.local-file-import`、试跑、参考投递），没有命中自写登记条目，不涉及「为什么现在换不了」。

## 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 沿原方向修 | `audioTaskRunner` 两处补 `expectedKind: "audio"`；音频分支照视频那句再加一句「没项目号就拒」 | 最小：约 4 行加一条单测 | 门的形状不变，预测 ① ② ③ 全都留着；「付费前拒」成第二个按类型写的特例，下一个就是第三个，触发 RW；try_model 仍然试不了配音 | ✗ |
| 换一种做法（接现成：TS 判别联合 + 已有 zod；由本线（修复线）在这个 PR 里做，单元是「生成产物入口」与「结果去向判据」两个） | ① **按形状分门**：主进程的生成产物只许走有类型的生成入口（`writeGeneratedAsset` / `writeGeneratedDeterministicAsset`，期望类型非空）；`importLocalFile` 的载荷改成只收用户文件（`kind` 的类型里没有 `generated`），IPC 边界把渲染层载荷解析成这个形状；渲染层生成产物本来就只走 `importRemoteUrl` 且带期望类型，不受影响。② **结果去向一处判**：一个函数从（声明 / 映射、任务种类）判出「结果只能是项目文件」，`runTask`、自定义调用、进程类、try_model 都在 `spendGate` 前问它；`d1d7ab8ad` 那句视频专用拒绝同提交删掉。③ **矩阵从目录生成**：内置目录里每一格同步出字节的模型 × 响应形状，走真关口、不 mock 落盘；再加一条结构扫描：生成产物的 meta 不许出现在 `importLocalFile` / `writeAsset` 的入参里 | 中：碰 4–6 个热点文件，`storeAssetBytes` 的字符串分流对主进程调用者收窄；自定义调用 `saveFile` 要改走生成入口，或者明确登记豁免 | 自定义调用脚本若交回与任务种类不同的字节，改后会被关口拒（这是对的，但行为会变）；try_model 拿不到项目号的问题这条路解决不了，只能把「先花钱后失败」变成「付费前诚实拒」，要另定 | ✅（①②③ 必做；自定义调用 `saveFile` 能同提交收就收，收不了写进残余风险并登记豁免） |
| 删掉 | (a) 删 #1213 的期望类型必填，回到按字节自称收：配音马上好，但 V-1213（付视频的钱落进一张参考图）回来；(b) 删「同步字节必须落项目」，给没项目的结果一个临时去处：try_model 能试配音，但要新造一个「临时产物」的生命周期（清理、引用、退出），不是真删，代价大于收益 | (a) 小；(b) 大 | (a) 重开已修好的付费逃逸；(b) 新概念，违背 P1 | ✗（但「删掉 `importLocalFile` 收生成产物的能力、删 `storeAssetBytes` 对主进程的字符串分流、删视频专用那句」这些删法，本来就是「换一种做法」的一部分） |

**老用户怎么过**：失败的配音在关口抛出、暂存之前就停了，盘上没有半成品，也没有缓存命中（同步音频路不写任务缓存）。升级后在原节点上重新点生成就能成功，不用迁移。已经扣掉的钱拿不回，那几次的字节也没存下来，这一点在发布说明里要明说。

**try_model 的问题**：换做法之后，Agent 对配音 / 文件流视频模型的试跑会诚实地回 needs_input，不再扣钱，但也永远成功不了。中转接入走的就是 AI 这条路（声明卡 → try_model），所以对「接一个配音模型」来说，这一步仍是死胡同。候选：
- try_model 带上当前打开项目的项目号，试跑结果落进那个项目；
- 认证路（`integrationCertification`）已经能对音频发一次请求并晋升模型，try_model 对同步字节类改指向它。

这是产品取舍，单独成题，见第 7 节。

## 7. 和原方案对照（写完第 0–6 节之后才读设计卡、根因合同、diff、修复线报告）

### 7.1 独立性声明

写第 0–6 节之前，我读过的修复线材料只有 `staged.stat` 和 `commit-msg.txt`。提交信息里已经写了改法概要：配音改走 `writeGeneratedAsset(…, "audio")`、用户文件的门不收生成产物、判据只放 `projectFileResult.ts` 一处、删掉视频那句。所以第 6 节「换一种做法」里的 ① ② 和原方案撞上，**不能算两边各自独立得出**。

能算独立的是：第 1 节归类、第 2 节四个结构洞（尤其洞 3「数门只数一跳」和洞 4「替身盖住关口」）、第 3 节三条预测、第 4 节没量到的形状，以及下面 7.4 的三处必改。

### 7.2 原方案走的是哪条路

走的是「换一种做法」，并且同提交删旧：

- 配音两处改走 `writeGeneratedAsset(…, "audio")`（包了一个 `saveGeneratedAudio`）。
- `importLocalFile` 的入参从 `unknown` 改成 `LocalFileImportPayload<K>`：`kind` 的类型里没有 `generated`，`expectedKind: never`；入口再加一道运行时拒 `local_file_import_refuses_generated_output`。它交给 `copyAssetFile` / `storeAssetBytes` 的期望类型改成写死 `null`。
- `RemoteAssetImportPayload` 改成判别联合：不写 kind 或写 `generated`，就必须给期望类型。
- 判据 `electron/tasks/projectFileResult.ts` 只此一处，`runTask` 和 `tryModel` 共用；视频那句英文同提交删掉。
- 矩阵从 `applyBuiltinSeeds` 的真种子枚举，落盘和暂存都不 mock；配音单测去掉整模块替身，改为断言期望类型是 `"audio"`。

对照第 2 节的四个洞：

| 洞 | 原方案 |
|---|---|
| 1 门的身份是数据不是类型 | **部分堵上**：`importLocalFile`、`importRemoteAsset` 的类型堵了；`copyAssetFile`、`storeAssetBytes` 没堵（必改 1） |
| 2 无类型入口洗掉类型要求 | 堵上（类型 + 运行时两道） |
| 3 数门只数一跳 | 没堵；工具缺口，不挡合并（7.5） |
| 4 测试替身盖住关口 | 堵上（配音单测 + 矩阵都走真关口） |
| 钱那面：付费前没有结果去向判据 | 堵上 `runTask`、`tryModel` 两个入口；自定义调用和进程类没接（必改 3） |

### 7.3 有没有新增分支或特例

- **`runTask` 那句是净替换**：删掉视频专用的一句，换成一句问判据。判据里的两条（同步回字节的音频、文件流视频）是同一类「结果没有地址可以先交回」的两种形状，从映射和任务种类推出来，不看供应商。不算 F 线的第二、第三个特例。
- **`tryModel` 的 `needs_input` 是同一判据的第二个消费者**，不是新分支。它的 `nextAction` 让用户去项目画布上试。我核过这条路是通的：`submit_declaration` 之后模型已经在选单里（`submitDeclaration.ts:269`：「marked "not tried yet"」），用户选得到，⑪ 没破。
- **没有按供应商的特例**：豆包 NDJSON、ElevenLabs、MiniMax 都在同一张矩阵里。
- **运行时那道拒不是并行版**：它拦的是渲染层经 IPC 送来、不过类型系统的载荷，是边界拒。

### 7.4 合并前要改的三处

1. **「类型上写不出来」的说法比实际宽。** 根因合同的 invariants 写的是：「生成产物只能经 writeGeneratedAsset / writeGeneratedDeterministicAsset / copyAssetFile / importRemoteAsset 并带上期望类型落盘……主进程里写不出来（类型）」。可是改完以后，`copyAssetFile` 和 `storeAssetBytes` 的签名仍是 `rawMeta: JsonRecord, expectedKind: LocalizedAssetType | null`，仍按 meta 字符串分流，而且两个都从 `runtime.ts:42` 再导出。主进程里新写一句 `copyAssetFile(pid, path, name, type, { kind: "generated" }, null)` 照样编得过，要到运行时才在 `generatedExpectation` 抛。对付费执行器来说，这就是花完钱再抛，正是第 3 节预测 ①。二选一：
   - **(a) 推荐，收紧类型**：
     - 改完后，素材模块外调 `storeAssetBytes` 的只剩 `localFileImport` 一处，而且只传用户文件。让它直接调 `writeAsset`，`storeAssetBytes` 收回素材模块内部、不再导出，`runtime.ts:42` 的再导出同提交删掉。
     - 模块外调 `copyAssetFile` 的只剩两处：`localFileImport` 传用户文件，`generationOutputMaterializer` 传 `generated` + `"video"`。把 `(rawMeta, expectedKind)` 做成和 `RemoteAssetImportPayload` 一样的配对类型，或者拆出生成产物专用的签名。
     - 在 `generatedOutputKindGate.test.ts` 已有的 `@ts-expect-error` 反例旁边，各加一条。
   - **(b) 最低限度，改说法**：合同和设计卡如实缩小为「`importLocalFile` / `importRemoteAsset` / `writeGeneratedAsset` 写不出来；`copyAssetFile` / `storeAssetBytes` 仍只在运行时查」，并把这两个函数列进 `residual_risks`。
2. **逃逸条目的 `ironLaws: []` 要填 `["⑫"]`。** 用户点「生成配音」，以为会得到项目里的音频；实际是扣了钱、报了错、项目里什么都没有。这就是 ⑫「点了=以为的」，账本里已有 68 条这样挂。挂上之后，⑫ 的覆盖账才数得到这一条。
3. **自定义调用 `saveFile` 要写成「同类、受影响、本次延后」，并登记进计划表。**
   - 合同里它标的是 `not-affected`，evidence 却写着「没项目号时会在花钱之后失败——这是另一处缺口」。它和本题是同一类：结果只能是项目文件，没项目号就先花钱后失败（第 3 节预测 ②）。所以它不是「不受影响」。
   - 修复线只能填 `not-affected`，是因为校验器只认 `enforced` / `not-affected` 两档（`scripts/root-cause-contracts.mjs:14`），这是校验器的口子，见 7.5。
   - 这次可以不修，但要做三件事：
     - evidence 改成「同类、受影响、本次延后」，写明理由和计划表行号；
     - 进程类那扇门（`processOperation.ts:153`，没项目号就静默不导入本地文件）也补进 `residual_risks`，合同里现在没提它；
     - 计划表加一行，建议挂在 A4d 下面：自定义调用 `saveFile` 改走生成入口，并在付费前问 `projectFileResult`；进程类同理。
   - `projectFileResult.ts` 的头注释写着「所有入口（tasks:run、画布单镜、Agent 的 try_model）都只问这一处」，补半句「自定义调用与进程类还没接，见残余风险」，免得下一个读的人以为已经全覆盖。

这三处都不改方向、不加分支。改完不需要再走一轮方向检查，验收线核这三处就行。

### 7.5 不挡合并的系统改进（交协调排）

- **`door-map` 加传递数门**（按调用链往上数几跳）：这是洞 3 的工具缺口。#1213 那次 `door-map generatedExpectation` 只数到 1 扇门，配音隔着三跳没数到。
- **根因合同校验器加第三档 `deferred`**，要求必须带计划表行号。这样「同类但这次延后」就不用被迫写成 `not-affected`。
- **IPC 边界换成 zod 解析**（第 5 节）：`assetsIpc.ts` 里的 `payload as LocalFileImportPayload` 是断言，不是解析；现在真正起保证作用的，是入口那行运行时拒。只有一个字段时两者等价，这扇门下次加字段时再换成 zod。
- **逃逸条目的 category**：`parameter-contract` 说得通（期望类型没传到）。如果按用户结果归，`claims-and-outcomes`（账本里有 32 条）更贴「扣了钱、结果没有」，由协调定。
- 第 6 节 ③ 后半提的结构扫描（生成产物的 meta 不许进 `importLocalFile` / `writeAsset`），原方案已经做到了：`importLocalFile` 那半靠类型 + 运行时；`writeAsset` 本来就在运行时拒（`assertNotUnverifiedGenerated`）。不用另加扫描。

### 7.6 try_model 与要不要用户拍板

A4f 已经单开，两条路写在计划表里。本题**不需要用户拍板**：

- 原方案把「先花钱后失败」变成了「付费前诚实地拒，并指去项目画布」，而用户在画布上选得到这个模型、能试。
- 剩下的代价，是外部 Agent 接配音中转时没法当场替用户试听。这是 A4f 的事，不挡本题合并。

### 7.7 结论

**原方案要改（改哪）**。方向支持：换一种做法，判据放一处、门按形状分。合并前改三处：

1. `copyAssetFile` / `storeAssetBytes` 的类型保证：推荐收紧，最低限度是如实缩小说法；
2. 逃逸条目 `ironLaws` 填 ⑫；
3. 自定义调用 `saveFile` 和进程类改写成「同类、延后」，并登记进计划表。

**用户要权衡的核心**：这次没有要用户权衡的。修法不涉及产品取舍；唯一的取舍是「外部 Agent 能不能当场试听配音」，已经在 A4f 单独成题。

## 特征测试清单

**已钉住**（修复线新增或改动，测试名取自 diff）：

| 文件 | 钉住什么 |
|---|---|
| `electron/tasks/syncBytesResultLandsInProject.test.ts` | 矩阵不是空的（至少有二进制 WAV、二进制 MP3、JSON hex、NDJSON base64 四种形状）；有项目时每格发一次请求，项目里能读回音频；没项目时每格在 tasks:run 令牌路、画布单镜、try_model 三个入口都是 0 请求、不扣费、不弹卡 |
| `electron/catalog/oldUserDubbingLandsAfterUpgrade.test.ts` | v0.24.0 向导接入的 `tts-1` / `opaque-tts` 升级后重新生成，配音能落进项目 |
| `electron/assets/generatedOutputKindGate.test.ts` | 用户文件的门不收生成产物：`@ts-expect-error` 编不过，运行时也拒 |
| `electron/audioTaskRunner.test.ts` | 替身只换 `writeGeneratedAsset`，断言期望类型是 `"audio"` |
| `electron/assets/remoteAssetContext.test.ts` | upload / generated 两种载荷，下载途中项目身份变了都拒绝发布 |
| `electron/runtime.asyncAudio.test.ts` | `usesSynchronousAudioRunner` 挪了地方，行为照旧 |
| 反例日志 `/Users/aoqimin/Nomi-coord/tmp/I-tts-save-expected-kind/counter-A.log` / `counter-A2.log` / `counter-BC.log`（协调机本地，不进仓库） | 撤掉修复后分别红 15 / 11 / 29 条，红在真关口、真入口 |
| `electron/catalog/upgradeKeepsWorkingModels.test.ts`（已有） | 本次要保持绿 |

**没钉住**（要补，或者已登记为残余风险）：

- `copyAssetFile` / `storeAssetBytes` 写 `generated` + `null` 编不过：必改 1 选 (a) 时加 `@ts-expect-error`。
- 自定义调用 `saveFile`：用 `electron/runtime.customCall.test.ts` 的夹具写两条现状测试，标「现状、待修」：在 `text_to_video` 任务里交回 PNG 字节，会落成 video 资产；没项目号时 `spendGate` 先被调过，然后才抛 `Project not found`。
- 进程类没项目号时静默不导入本地文件（`processOperation.ts:153`）。
- try_model 对同步回字节这类模型的「成功」那一面（A4f）。
- 真付费：协调跑一次 `tests/ux/tts-save-expected-kind-real.paid.mjs`，并核对它断言的是「项目里多了一个能播的音频」，不是「没抛错」。
- Windows；`tasks.resultNeedsProject` 的中英文案截图。
