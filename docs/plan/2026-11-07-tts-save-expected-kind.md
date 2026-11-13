# 设计卡：配音扣了钱却存不进项目（2026-11-07）

实现线 I-tts-save-expected-kind，第 1 轮修补 I-tts-save-r2（按复盘 `docs/engineering/direction-checks/2026-11-07-tts-save-expected-kind.md` 第 7.4 节改三处） · 分支 `fix/tts-save-expected-kind-r2` · 根因合同 `docs/fixes/2026-11-07-tts-save-expected-kind.root-cause.json` · 逃逸账本 `tests/ux/full-walk/escapeLedger/PAID-20261107-tts-save-expected-kind.json`

这次碰了花钱路径（没项目时在付费闸之前拒），按四类填 9 格。

### 功能分类
- [ ] 新界面 / 改交互
- [x] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [x] 新增功能 / 性能

后三项都是按改动路径推出来的（`docs/engineering/test-routing.json` 的 pathRules）：
- 长跑 / 可打断：来自 `audioTaskRunner.ts`、`localFileImport.ts`。这次没有新增或改动取消、续跑的逻辑。
- 数据格式：来自文件名 `projectFileResult.ts`。这次不改任何落盘格式，按要求交老用户升级证据。
- 新增功能 / 性能：来自 `electron/assets/`。这次不新增交互，见 ★7。

## ★0 先查别人

- [OpenAI createSpeech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create) · `/v1/audio/speech` 直接回音频文件内容（`application/octet-stream`），没有地址可以先交回 · **确认了**「同步配音的结果只能写成文件」：它和回地址的图片、视频任务不一样，没项目就没地方放，所以要在发请求之前拒，不能等落盘时再拒。
- [ElevenLabs text-to-speech convert](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) · 同样直接回音频文件（File download） · **确认了**这是同步配音的通用形状，不是某一家的特例。判据按「同步回字节的音频」写，不按供应商写。
- [Parse, don't validate（Alexis King）](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) · 在边界上检查一次，并用类型表达不变量，让非法状态写不出来 · **改了**修法：原来想在 audioTaskRunner 两处补上 `expectedKind`（沿原方向修）；改成让用户文件的门在类型上不收生成产物，远程取回的门在类型上要求生成产物带期望类型。下一个调用者漏写时编译就不过，不用等付费之后的运行时检查。
- `electron/runtime.ts`（修前）里给文件流视频写的拒绝：`if (mapping.result?.mediaResponse && !projectId) throw new Error("Video file results require a project…")` · 2026-10 已经给「结果只能是文件的视频」定过「没项目先拒」 · **确认了**方向。这次把它和同步配音并进同一个判据 `resultOnlyLandsAsProjectFile`，同提交删掉那句只给视频写的英文。

出口：electron/runtime.ts:311（修前，main 745b3c5b4）文件流视频「没项目先拒」· 别人怎么让人继续：先打开项目再生成，拒绝不留锁、不留半截单子，点一次重新生成就能继续 · **确认了**这次新增的两处拒绝走同样的出口：tasks:run / 画布报「请先打开一个项目再生成」；try_model 回 `needs_input`，`nextAction` 让宿主请用户到打开的项目画布上去试。两处都不开试用单、不铸令牌，没有要释放的东西。

## ★1 用户怎么用

当我在项目画布上给一个镜头配旁白、配乐或音效时，我点生成，等几秒，节点上要出现能播放的音频，素材库里也要多一个文件，这样我才能把它拖进时间轴。

1. 打开项目，在画布上建一个配音节点，选 APIMart「声音」、豆包、MiniMax、ElevenLabs 或自己接的配音模型。
2. 写一句台词，点生成，确认付费卡。
3. 主进程发一次请求，供应商同步回音频字节。
4. 字节经落盘关口（暂存 → 解码校验 → 原子发布）进入项目 `assets/`，记成生成产物，期望类型是音频。
5. 节点显示音频，可以播放、拖进时间轴。

**不做什么**
- 不改落盘关口本身的判定。
- 不按扩展名猜类型，也不加兜底。
- 不修 `customCallDispatch` 的 saveFile 和进程类 `processOperation` 的本地下载（同类、受影响、本次延后，见下面的已知坑）。
- try_model 在有项目时能当场落盘，单开做（协调已记 plan），不在本次。

**已知坑**
- Agent 的 `nomi_try_model` 暂时不能当场试听配音、音乐、音效和文件流视频。试用不在任何项目里，现在回 `needs_input`，让用户到项目画布上试。
- 同类、受影响、本次延后：`electron/catalog/customCallDispatch.ts` 的 saveFile 用同步 `writeAsset` 写供应商字节，不经解码校验；没项目时会在花钱之后才失败。
- 同类、受影响、本次延后：`electron/catalog/processOperation.ts`（进程类，如即梦 CLI）没项目时静默不导入本地下载的文件，进程照样跑完、钱照样花。
- 这两条的后续由协调登记进计划表（A4d 下）：付费前问 `resultOnlyLandsAsProjectFile`，saveFile 改走 `writeGeneratedAsset`。

**真实任务**
1. 协调 2026-11-07 那次真付费：经 `nomi:tasks:run` 跑 APIMart nomi-audio（speech / gpt-4o-mini-tts），带 `extras.projectId`。修前扣了费、落盘失败；修后用 `tests/ux/tts-save-expected-kind-real.paid.mjs` 回放一次。
2. 老用户：v0.24.0 用向导接的 OpenAI 兼容配音（tts-1 / opaque-tts），升级后在同一个失败节点上点重新生成（`tests/fixtures/old-user-data/catalogs/v0.24.0-wizard-audio` 真实落盘目录）。
3. Agent 没开项目时用 `nomi_try_model` 试一个配音模型：不发请求、不弹卡，并告诉它去项目里试。

**指标**
- 主指标：同步回字节的音频任务带项目号时，落成项目音频文件的比例。目标 100%（内置目录每一格 × 每种响应形状）。量具：`electron/tasks/syncBytesResultLandsInProject.test.ts`，修前 0/9，修后 9/9。
- 护栏指标：没项目时「发出请求 / 扣令牌 / 弹付费卡」的比例。目标 0%，覆盖三个入口 × 10 格。量具：同一矩阵的「没项目」组。
- 质量指标：真供应商字节过真关口的比例。量具：`tests/ux/tts-save-expected-kind-real.paid.mjs`（协调跑一次）。11-08 真供应商样本已通过，运行号与读回结果见本文「花钱走查」。

### ★1b 连带界面
- 画布节点、tasks:run 回执（没项目时）：zh「这个模型的结果只能存成项目里的文件，请先打开一个项目再生成。这次的请求没有发出。」en「This model's result can only be saved as a file in a project. Open a project first, then generate. This request was not sent.」（`electron/desktopStrings.ts` 的 `tasks.resultNeedsProject`）。只说请求没发出，不谈钱（界面不写扣没扣费的断言）。
- 这条拒绝替换了文件流视频原来那句英文「Video file results require a project before generation can be submitted.」，视频也改用这句中英文。
- Agent 的 try_model 回执：`needs_input`，message 说明结果只能存进项目、试用不在项目里、这次没发请求；`nextAction` 写「不要对这个模式重试 nomi_try_model，请用户在 Nomi 里打开项目，到该项目画布上的节点生成」。
- 成功时的回执、节点、素材库都不变：多出一个音频素材。

### ★1c 老用户
- 项目：升级前失败的配音节点上没有写进项目的东西，项目文件不用迁。升级后点「重新生成」，会再发一次并落盘（`electron/catalog/oldUserDubbingLandsAfterUpgrade.test.ts` 用 v0.24.0 真实目录回放：1 个请求、成功、项目里多一个 MP3）。
- 模型：目录一字不动，请求路径和请求体都和升级前相同（`upgradeKeepsWorkingModels.test.ts` 的 expected.json 照旧通过）。
- 已经付掉的那几次费用：应用里没有留下可以补存的字节，找不回来。如实写进发版说明。
- 退回上一版：没有新的落盘格式，旧版照常打开（旧版里配音仍然存不进去）。

## ★2 谁说了算

- 「生成产物落盘要说清类型」的 owner 是落盘关口：`electron/assets/projectAssetStore.ts` 的 `generatedExpectation`，以及 `writeGeneratedAsset` / `writeGeneratedDeterministicAsset` / `copyAssetFile` / `importRemoteAsset`。用户文件的门 `electron/assets/localFileImport.ts` 的 `importLocalFile` 不再收生成产物。
- 类型上写不出来的范围（复盘必改 ①）：
  - `copyAssetFile` 是配对重载：生成产物 kind 写死 `"generated"` 配非空期望类型；用户的东西 kind 必须写明（字面量，或 `checkedUserAssetKind` 在运行时核过的值）配 `null`。`generated + null`、`generated + 可能为 null`、`JsonRecord` 当 meta、随手一个 `string` 当 kind，都编不过。
  - `storeAssetBytes`（kind 是数据、期望类型可空）收回素材模块、不导出，`runtime.ts` 也不再转出。模块外的字节只有 `writeGeneratedAsset`（生成产物）和 `writeAsset`（用户的东西）。
  - 类型面定义在 `electron/assets/generatedAssetStaging.ts`：`NotGeneratedKind`（不收 generated，也不收随手一个 string）、`GeneratedAssetMeta`、`UserAssetMeta`、`CheckedUserAssetKind` 与 `checkedUserAssetKind`。
  - 只在运行时查的：素材模块内部 kind 来自数据的两处（跨项目复制读 sidecar、nomi-local 引用，走私有的 `copyAssetFileByMeta`）、`importLocalFile` 收到带索引签名的 `JsonRecord` 展开载荷、渲染层经 IPC 来的载荷。都在入口或落盘关口当场拒，不落盘。
- 「结果只能写成项目文件吗」的 owner 是 `electron/tasks/projectFileResult.ts` 的 `resultOnlyLandsAsProjectFile`，只有这一处定义。消费者有两个：`runtime.ts` 的 runTask（画布、tasks:run）和 `tryModel.ts`。
- 同一份事实只存一份：期望类型来自任务（音频任务就是 `"audio"`），不从扩展名或 content-type 推。
- 没有靠「东西不见了」去猜意图。
- 门表（`node scripts/door-map.mjs`）：
  - importLocalFile 3 扇（assetsIpc、localFileCopy、core.ts，全是用户文件）；
  - generatedExpectation 1 扇；
  - writeGeneratedAsset 8 扇（全带期望类型）；
  - importRemoteAsset 3 扇；
  - storeAssetBytes 只剩 projectAssetStore 自己（模块外 0 扇）；
  - copyAssetFile 模块外 2 扇（localFileImport 用户文件、generationOutputMaterializer 生成产物 + video），全过配对重载；
  - resultOnlyLandsAsProjectFile 2 扇（runtime.ts、tryModel.ts）。

## ★3 一致与复用

- 以前定过什么：
  - #1213（`42736b307`，0.23.x 移植 `7171ae332`，2026-10-17）定了「生成产物落盘按任务期望类型核字节，三扇写入口必须说清要哪一类」，现在仍然算数；配音的两处调用当时没跟上。
  - 2026-10 定过「文件流视频没项目先拒」，仍然算数，这次并进同一个判据。
- 三条路：
  - 沿原方向修：在 audioTaskRunner 两处补 `expectedKind`。能修好这次，但下一个调用者照样能漏，不选。
  - 换做法：生成产物改走 `writeGeneratedAsset`（它的期望类型是必填参数），用户文件的门在类型和运行时都不收生成产物，远程取回的门在类型上要求带期望类型，拷文件的门 meta 与期望类型成对写，「kind 不定」的字节入口不出素材模块；没地方放就在付费前拒。**选这条**：漏写在编译期就红，钱也不会花在注定放不下的结果上。
  - `copyAssetFile` 为什么做成配对重载、不拆成两个函数：现有调用全都已经成对写（用户文件传 null、生成产物传期望类型），重载不动任何调用点，只把错的写法变成编译错；拆成两个函数要改全部调用点，换来的保证一样。
  - 删掉：同步配音没有别的落点，删不掉。
- 复用：
  - `writeGeneratedAsset`：截图、抽帧、裁剪、合成已经在用，配音现在也走它。
  - 落盘关口、spendGrant、`desktopT`。
  - 没有第二份定义：`usesSynchronousAudioRunner` 从 runtime.ts 挪进 `projectFileResult.ts`，原处同提交删掉。

## ★4 全状态

- 空：没写台词照旧由档案校验拦下，不变。
- 加载：节点照旧显示生成中，不变。
- 成功：节点上出现可播放的音频，素材库多一个音频文件（修前这里是失败）。
- 失败：
  - 供应商失败照旧报供应商错误。
  - 回来的字节不是音频：落盘关口报 retrieval-download，可找回，不变。
  - 生成产物被送到用户文件的门：报 `local_file_import_refuses_generated_output`。这是程序错误，正常路径到不了。
- 部分成功：同步配音一次只出一个结果，没有部分成功。
- 取消中：沿用现有的取消，不变。
- 过期：不涉及。
- 能力不可用（没有打开项目）：
  - 画布、tasks:run 显示「这个模型的结果只能存成项目里的文件，请先打开一个项目再生成。这次的请求没有发出。」下一步：打开一个项目再生成。
  - try_model 回 `needs_input`，下一步：请用户在项目画布上试。
  - 文案走 i18n（zh / en 两轨）。

## 5 中途表

同步配音是一次请求、一次落盘。这次只在发请求之前多了一道判断，下表只列和这次有关的状态。

| 状态 | 停 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 没项目被拒 | 没东西可停 · 不扣 · 回执是拒绝原因 | 同左 | 同左（请求没发出） | 同左 | 每次都同样被拒，不扣，不弹卡 |
| 有项目、请求中 | 沿用现有取消 · 供应商可能已计费 · 节点失败回执 | 同左 | 请求失败 · 供应商结算 · 节点失败回执 | 同左 | 令牌一节点一次，第二次不放行（spendGrant，不变） |
| 有项目、落盘中 | 落盘关口暂存目录清掉，不留半截文件（不变） | 同左 | 不涉及（字节已在本地） | 暂存目录下次启动清理（不变） | 同上 |

## 6 外部数据与失败

- OpenAI 兼容 `/v1/audio/speech`（APIMart、向导接的中转）：直接回音频字节（[规范](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)）。我们的偏差：只认二进制，JSON hex / base64 按映射声明的 `audioResponse` 解。失败时：字节不是音频就由落盘关口报 retrieval-download。
- 豆包单向流式：NDJSON base64 分片，拼接后是 MP3。失败时同上。
- MiniMax：JSON hex（`dataPath`）。ElevenLabs：二进制 MP3（[规范](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)）。
- 未知失败不甩锅给用户的 key：落盘关口的错误码不提 key。

## ★7 性能

不适用：这次不新增用户操作。发请求之前多一次纯函数判断（读 mapping 两个字段），落盘走已有的 `writeGeneratedAsset`，和以前的 importLocalFile 是同一套暂存与解码。

## 8 真实条件

- 真付费：11-08 APIMart nomi-audio 一条成功，项目内音频通过解码。
- 英文界面：拒绝文案有 en 一轨，`check:i18n` 守。界面截图 unverified（这次没改界面布局）。
- Windows：unverified（不改路径拼接，落盘关口沿用现有实现）。
- 干净安装、老用户：老用户用真实 v0.24.0 目录回放（`oldUserDubbingLandsAfterUpgrade.test.ts`）。

## 拍板图清单

不适用：不新增、不改界面元素和布局。只有一句拒绝文案，替换文件流视频原来的英文拒绝。

## ★9 验收与回滚

**真实场景复现**
- 用户的流程：协调 2026-11-07 真付费，经 IPC `nomi:tasks:run` 跑 APIMart `nomi-audio`（`modeId: speech`，gpt-4o-mini-tts），`extras.projectId` 已设。结果：扣了费，落盘报 `generated_output_expected_kind_required`。
- 我走的：同一条主进程路径（runTask → 同步音频分支 → runTextToSpeech → 落盘关口）。本机假服务按内置目录每一格回真 WAV / MP3 字节，落盘关口是真的，不桩资产库。另加豆包 NDJSON、MiniMax hex、ElevenLabs、中转、没映射的缺省路由，以及 v0.24.0 真实老用户目录。
- 差别：供应商是本机假服务，字节是仓库里的真音频夹具，不是那次 APIMart 回的字节。真供应商那一段留给付费回放。
- 修前：矩阵 9 格同步配音全部红，栈是 `generatedExpectation ← storeAssetBytes ← importLocalFileToStore ← importLocalFile ← runTextToSpeech / runDoubaoUnidirectionalTts`；没项目的 10 格各发出 1 个请求；try_model 配音回 `submission_unknown`，视频回 `provider_failed`（都是先发了请求）。
- 修后：见下面的「反例 → 结果 → 证据」表。

**验收清单**（验收线只核这份）
1. `npx vitest run electron/tasks/syncBytesResultLandsInProject.test.ts`：全绿；「有项目」9 格各 1 个请求、成功、项目 `assets/` 多一个音频文件、`.meta` 的 kind 是 generated。
2. 同一文件的「没项目」10 格：tasks:run 令牌路、画布 Run 路各 0 个请求，令牌原样留着，不弹卡；try_model 回 `needs_input`（没映射的那格回 `not_found`），0 个请求、不开单、不铸令牌、不弹卡。
3. 矩阵确实枚举到 5 种响应形状（binary wav、binary mpeg、json hex、ndjson base64、undeclared）。
4. `npx vitest run electron/catalog/oldUserDubbingLandsAfterUpgrade.test.ts`：tts-1、opaque-tts 各 1 个请求、成功、项目里的 MP3 字节和服务回的一致。
5. `npx vitest run electron/catalog/upgradeKeepsWorkingModels.test.ts`：老目录请求逐字不变。
6. `npx vitest run electron/assets/generatedOutputKindGate.test.ts electron/audioTaskRunner.test.ts electron/runtime.asyncAudio.test.ts`：全绿。
7. `pnpm run typecheck`：通过。测试里的 `@ts-expect-error`（importLocalFile 收 generated、importRemoteAsset 的 generated 不带期望类型；copyAssetFile 的 generated + null、generated + 可能为 null、JsonRecord meta、变宽的 string kind、大小写变体；模块外读 storeAssetBytes、runtime 转出 storeAssetBytes）必须真的报错；删掉类型约束，这几行会变成「未使用的 @ts-expect-error」而红。
8. `pnpm run check:escape-ledger`、`node scripts/check-root-cause-contracts.mjs`：通过。
9. `node tests/ux/tts-save-expected-kind-real.rehearsal.walk.mjs`：零额度演练通过。

**反例**（这一类会从哪里回来）
- 入口：画布、tasks:run、try_model 三个入口都进了矩阵。新入口只要经 runTask 就自动被判据覆盖。
- 形状：五种响应形状都在。新的声明形状会因为「形状集合必须包含…」那条而被看见。
- 供应商：矩阵从真实内置目录枚举，新加的同步音频模型自动进矩阵。另有中转和没映射的缺省路由。
- 版本：老用户 v0.24.0 真实目录。
- 调用者：任何新代码把 kind generated 交给 importLocalFile，让 importRemoteAsset 的 generated 不带期望类型，给 copyAssetFile 写 generated + null / 可空期望类型 / JsonRecord meta，或在素材模块外调 storeAssetBytes，都编译不过；渲染层载荷在运行时拒。
- 反做：把 audioTaskRunner 改回 importLocalFile，矩阵和类型检查一起红；删掉 runtime.ts 的付费前判断，「没项目」组变红（每格 1 个请求）；把 copyAssetFile 改回「JsonRecord + 可空期望类型」或重新导出 storeAssetBytes，check:test-types 报未使用的 `@ts-expect-error` 而红。

**反例 → 结果 → 证据**：见报告 `/Users/aoqimin/Nomi-coord/Nomi-service/coord-handoff/reports/I-tts-save-expected-kind.md` 的「自检与反例」一节；第 1 轮修补（类型收紧）的反例见 `/Users/aoqimin/Nomi-coord/Nomi-service/coord-handoff/reports/I-tts-save-r2.md`。

**花钱走查**

2026-11-08 在 Mac 开发构建中新建隔离项目，用 `nomi-audio` 配音「海风轻拂。」。第一次走查在发请求前失败，Playwright 渲染进程读不到脚本里的模型常量，等待确认的代码吞掉了异常。免费 Electron 演练复现了相同失败。免费和付费现共用同一份跨进程参数、确认、落盘和解码步骤；若提交提前被拒，直接报告该错误。

- 免费回环：42 个矩阵/旧数据断言通过；真窗点确认后，本机服务恰收一次配音请求，项目文件 17,718 字节，解码时长 0.20 秒。
- 真实调用：经确认发出一条配音；任务 `task-4f9acd4f-435d-45e8-b934-6a47f2655a99` 成功，核实项目所有权和实际路径后读回 127,244 字节，解码时长 2.65 秒。原资料指纹一致，凭据副本已移除。这次没有实扣金额收据。
- 免费演练：`tests/ux/tts-save-expected-kind-real.rehearsal.walk.mjs`。
- 产物标记字面量：`local_file_import_refuses_generated_output`。
- 在专用工作树里跑（openPaidWalk 会核产物比源码新、带标记，否则拒跑）。

**回滚**：revert 本 PR 的提交即可，不改数据格式，没有开关。回滚后配音重新变成「扣费后存不进项目」。

**独立验收**：四类，合并前由另一条线按上面的清单核，并核复盘第 7.4 节的三处，报告链接在 PR 正文 `## 独立验收`（验收线编号不能是 I-tts-save-expected-kind 或 I-tts-save-r2）。
