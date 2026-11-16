# 设计卡：说了模型名，到底用哪个、用哪种方式——名字只在一处认，方式只在一处选

```
改动名：模型名与方式各一个家      线/负责人：实现线（协调派）      类别：[其他：Agent 行为、生成入参准入]
```

状态：动手前写的（基线 `origin/main` 4832b523b）。不碰界面、不改落盘形状、不改外部助手的字段。四类之外，★ 五格写全。
方向（已定）：扩已有的共用主人，不新造总解析器。名字只在 `electron/shared/agentCapabilities/modelHandle.ts` 认；方式只在 `electron/shared/modelArchetypes/modeForInputs.ts` 选；语义合成只装配；内外助手、单镜、多镜、拟镜、改计划消费同一个结果。接 `docs/plan/2026-11-15-agent-intent-landing.md` 第 2a 刀里「方式由参考推、删 `videoModeForPlan`」那半句（:68、:136），外部字段逐字不变（:169–173）。

## 先查别人

- `electron/shared/agentCapabilities/modelHandle.ts:58-86`（仓库里已有的名字主人）· 完整名字整串 → id / 别名（不分大小写）→ 近似写法，每一档「恰好一行才收、多行拒并列出」· **确认了**：U1–U3 的裁定就是让另外两处照这一套，而不是再定一套。
- `electron/shared/agentCapabilities/modelSpecProjection.ts:181-211`（外部读详情的旧注释，2026-09-22 主管自查）· 旧实现没给供应商时「悄悄返回第一家」，被判定为「同名跨家在本仓是两个模型」· **确认了**：U1 不许取第一家；短创建那一处是同一个毛病漏网。
- `electron/shared/modelArchetypes/modeForInputs.ts:137-202` 与 `docs/plan/2026-11-12-mode-from-inputs.md`（方式按输入现算）· 存着的方式只是偏好，按这次真放进来的东西现算；没有哪种全收就诚实回状态 · **改了**：主进程的 `videoModeForPlan` 不再自己按桶 / 推荐 / 默认挑，改问它；**确认了**：调用方说明白的方式（`modeId`）只做查表，不重选（I2）。
- 同期「第三方托管只看设置开关」那张设计卡的 ★2 / ★9（协调给的样板，尚未进仓库）· 一个判断只留一处算；调用方传不进「允许」；加一条边界检查让第二处写不出来 · **确认了**：这里「默认那家」的平局规则只能在名字主人里、只在已匹配的几行里挑，调用方递不进一个匹配集合以外的身份（见 U1）。
- `electron/shared/videoCapabilities/modeTransport.ts:25-42`（桶的唯一主人）· 供应商特化 > 方式 > 档案 三级 · **改了**：U5 的根因就是 `videoModeForPlan` 只看了第二级；按桶收窄改用它。
- 出口：不涉及新增挡人的保护。U1 的「多家同名又没说哪家」今天应用内已经是拒并列出候选，这次只是让外部短创建也这样（或按用户默认落，见 U1），拒收自带可原样抄回的候选。

## ★1 用户怎么用

当我对助手说「用 Seedance 出这一镜」、或在外部助手里写了一个模型名、或者让助手按剧本拟镜、或者在画布上点了模型再点发送，我想 Nomi 在每一个入口认出的都是同一个模型、选出的都是同一种方式，以便「说了用哪个，出来就是哪个」，不会这边能用那边报错。

步骤：①说出模型名（完整名字、裸 id、大小写不同、别名都可能）→ ②名字主人认出目录里那一行（恰好一行收；多家同名按 U1 处理；认不出给最像的 ≤3 个）→ ③按认出的模型和这次真放进来的参考（谁是首帧、谁是尾帧、谁是参考）问方式主人 → ④说明白了方式（`modeId`）的只核它是这个模型的方式，不重选 → ⑤草稿 / 确认卡 / 发送都读这一个结果。

不做：不改界面、确认卡、节点；不改外部助手 `nomi_operation_plan` / `nomi_read` 的任何字段；不改模型能不能用（另一条线）、清单长什么样、报价、设置存储；不动画布方式菜单与偏好遗忘；不删 `modeId` 字段（第 2a 刀的事）。
已知坑：两张图不等于首尾帧，按参考的角色算（`[first_frame, image_ref]` 落全能参考）；拟镜规划器只产提示词和时长，身份和方式全靠继承和补默认——这一处以前单独补，是 U4 的来源。

真实任务（每条都同一个模型名 + 同一组输入，结果写成「认出的 provider/model · 选出的 modeId」）：
1. Nomi 里的助手：`draft_shots` 一镜写 `model:"bytedance/seedance-2@kie"`，带两张参考、角色首帧 / 尾帧 → `kie / bytedance/seedance-2 · firstlast`（今天：`firstlast`，因为 lane 侧不经旧桶分支的情形另说，见 U5 的复现）。
2. 外部助手：`nomi_operation_plan` 写 `vendor:"kie", modelKey:"bytedance/seedance-2"`、`taskKind:"image_to_video"`，同两张图 → 今天拒 `mode_not_in_model`（U5），改后 `firstlast`。
3. 短创建：外部写 `modelKey:"minimax-h3"` 不写 vendor，用户接了 kie 和 apimart、视频默认是 apimart 的 MiniMax H3 → 今天悄悄取遍历到的第一家（U1），改后见 U1 裁定。
4. 拟镜：`scriptText` 长片，顶层点名 KIE Seedance、只给一张首帧参考，视频默认是 APIMart Seedance 图生（默认解析器带 `modeId:"i2v"`）→ 今天每镜被补上 `i2v`，KIE 档案没有这个方式，后面拒（U4），改后每镜按输入由方式主人选。
5. 画布发送：节点模型 KIE Seedance，连首帧边、尾帧边各一张 → `firstlast`（今天就是，作为对拍的参照）。
6. 改计划：把一镜的模型改成 `Clip-X` 的小写写法 `clip-x`（自接模型，id 带大写）→ 今天 `unknown_model`（U2），改后认出原行。

指标（目标 → 信号 → 指标；全部是不出网、不花钱的测试）：
- 主：一致率 = 五入口 × 名字写法 × 输入组合中「认出的模型与选出的方式逐字段相同」的格数 / 总格数，目标 100%（今天 U1–U5 各至少一格不同）。量具：新对拍测试 `electron/capabilityCore/modelNameModeParity.test.ts`（五个真实入口：lane `draft_shots` 投影 + 宿主、外部 `nomi_operation_plan` 别名表 + 宿主、宿主短创建、宿主 `scriptText`、宿主改计划；画布发送用渲染层 `sendArchetypeMode` 包装做方式的参照）。
- 质量：全目录性质测试——每个内置视频档案 × 输入组合，主进程归一选出的方式 = `modeForInputs` 的答案，差 0 格。量具：同一个测试文件里的全目录段。
- 护栏：外部助手模型行与生成工具表逐字节不变（量具：现有 `scripts/model-face-baseline.json` + `pnpm run check:model-schema` / `check:mcp-tool-refs`）；画布方式的现有穷举测试 `modeForInputs.exhaustive.test.ts` 不改一行仍绿；`tests/fixtures/old-user-data/` 全部版本回放绿。
- 门数：判名字的函数 3 → 1，选方式的地方 4 → 1（见 ★2）。量具：`node scripts/door-map.mjs` 前后两份 + 结构测试。

### ★1b 连带界面

- 助手（应用内）回执：名字是裸 id / 近似写法 / 按默认平局落的，回执照旧列「写的 → 落成的完整名字」（`draftShotsProjection` 现有 `resolved` → `modelNamesResolved`）；按默认落的那一条多一句英文说明（给助手读，不上界面）。
- 宿主起草回执（外部助手的 `create` 也读它）：新增可选键 `modelNamesResolved`，形状与 lane 相同；只有名字不是一字不差落下时才出现。入参字段不变。
- 外部助手拒收：多家同名时沿用现有的入参拒收形状（`generation_input_invalid` + `field: providerId` + `allowed` 列出那几家），不加新码，所以面板、模型正文、遥测码表都不动。认不出仍是 `unknown_model`，`nearest` 改由名字主人给（I8）。
- 外部读详情 `nomi_read(target=model)`：成功、`ambiguous_model_vendor`、`unknown_model_identity` 三种回包字段与码不变。
- 确认卡、节点、分镜行：不变。

### ★1c 老用户

- 设置里的图片 / 视频默认：只存 `(vendorKey, modelKey)` 两段（`electron/settings/generationModelDefaultsContract.ts`），不变。默认解析器不再附带它自己挑的 `modeId`（`generationDefaultModelResolver.ts:69-87`）：那个 `modeId` 从没落过盘，是每次现算的，删掉后方式由方式主人按输入算。
- 旧草稿 / 分镜计划里的候选 `{providerId, modelId, modeId?}`：形状不动。带 `modeId` 的照旧当说明白的方式用（`mcpGenerationVideoResolve.ts:187-195` 今天也是这样）。视频候选从 2026-09-01（`0b6441c69`，`modeId: mode.id`）起建草稿时就写入 `modeId`，所以缺 `modeId` 的只可能是更早的草稿或拟镜默认那条路的产物——这部分改由方式主人按候选里的参考现算，可能和旧的「推荐首项 / 档案默认」不同；已发安装包里有没有这种草稿：未查，动手时用 `tests/fixtures/old-user-data/` 全部版本回放核，回放出现差异就停下报。
- 已封印（已出确认卡）的多镜：合同里带封印时的哈希；改后重新归一若改了方式就会和哈希对不上——这条路径在回放里专门核：封印过的草稿重新预览 / 确认，方式与哈希不变。
- 画布节点（`archetype.{id, modeId}` + `modelKey/modelVendor`）：不经名字主人（下拉选的就是精确行），方式主人画布那条调用不加参数，行为逐字节不变。
- 外部助手客户端：字段不变；以前报 `unknown_model` 的大小写 / 别名写法现在能认；以前悄悄取第一家的多家同名按 U1 处理（行为变化，见 U1 的停点说明）。
- 退回上一版：没有落盘变化，照常打开。

## ★2 谁说了算（每个判断唯一的家）

| 判断 | 唯一的家 | 允许谁消费 | 今天还有谁在算（删 / 改成消费） |
|---|---|---|---|
| 写下的模型名 → 目录里哪一行 | `modelHandle.ts` 的 `resolveModelHandle`（完整名字串）+ 同文件新增 `resolveModelIdentity(rows, { modelId, vendor? }, { preferred? })`（结构化两段，外部和宿主用；内部先按说了的供应商收窄再走同一个阶梯） | lane `list_models` / `draft_shots`、宿主语义合成、外部读详情、改计划 | **删** `semanticGenerationCandidate.ts:401-430` `identityForNamedModel`（精确 id、首家优先、loose 首家）；**删** `modelSpecProjection.ts:197-227,230-232` `resolveModelEntry` / `findModelEntry` / `entriesWithId` / `vendorsCarrying`（外部读改直接问主人、按原码包装）；**改** `semanticGenerationCandidate.ts:288-298` `shotTaskKind` 先拿主人认出的行、再从这一行的模式定种类（今天拿原始写法精确查 `namedModelModes`，大小写不同就当「没有这个模型」）；**删** `semanticGenerationCandidate.ts:218-249` `nearestCatalogModel`，`unknown_model.nearest` 取主人的最像首项（I8） |
| 这次按哪种方式发 | `modeForInputs.ts` 的 `modeForInputs`；新增一个**事实参数** `task?: { kind, vendor }`（说明白的种类桶 + 供应商，主人自己用 `modeTransportFor` 收窄候选方式，调用方递不进谓词或方式对象）；同文件新增 `statedMode(archetype, modeId)`（说明白的方式只查表，大小写 / 连字符宽容，I9）和 `modeInputsForReferences(references)`（候选参考的角色 → 槽偏好，复用 `electron/shared/canvas/edgeAdmission.ts:86` `EDGE_MODE_SLOTS`） | 画布（`archetypeMeta` 两个包装，不变）、主进程拒收建议（不变）、主进程视频归一 / 编合同、改计划 | **删** `mcpGenerationVideoResolve.ts:178-222` `videoModeForPlan`（`normalizeVideoCandidate`、`videoCompileOptions` 改问主人）；**删** `generationDefaultModelResolver.ts:69-80` 默认解析器自己挑 `modeId`；**删** `mcpGenerationMultiShot.ts:307-318` `storyboardDefaults` 里取第一候选第一个同桶方式；**改** `generationPlanPatch.ts:32-43` 按 `modeId` 找方式用 `statedMode` |
| 语义合成 | `semanticCandidateFromParams` 只装配：身份 = 名字主人的答案（没点名才用默认解析器的答案），方式交给归一 | 单镜、多镜 `shots`、**拟镜**（新增：拟镜每镜改走它） | **删** `mcpGenerationMultiShot.ts:195-232` `draftShotFromStoryboard` 里逐字段补默认（含 `draft.modeId ?? fallback.modeId`）；删 `SemanticGenerationDefault.modeId/variantId`（默认不再带方式，「同一身份才继承」那段随之删掉，`semanticGenerationCandidate.ts:471-489`） |
| 用户默认（哪个模型） | `generationDefaultModelResolver.ts`（不改判据，只删它挑方式那段） | 同上 | — |

门数（`node scripts/door-map.mjs`，基线 4832b523b）：
- 判名字的函数 3（`resolveModelHandle` 2 门、`identityForNamedModel` 1 门、`resolveModelEntry` 2 门）→ 1 个主人（`resolveModelHandle` / `resolveModelIdentity` 同文件），门：lane 读、`draft_shots`、宿主语义合成、外部读、改计划。
- 选方式的地方 4（`modeForInputs` 4 门、`videoModeForPlan` 1 门 2 处、默认解析器 1 处、拟镜默认 1 处）→ 1（`modeForInputs`），门：画布两个包装、主进程拒收建议、主进程视频归一。
- 另外发现、准备线没列的第 5 处选方式：`electron/capabilityCore/modelAdmissionSchema.ts:77-88` `archetypeModeForCandidate`（非视频候选按桶 / 单方式 / 默认挑参数表）。**不在本刀改**（见下「新发现」），在结构测试的名单里登记为已知待收，不许新增同类。

防第二处（复用现有三件 + 一个对拍）：
1. 结构测试：把 `modelHandle.structure.test.ts` 扩成「名字和方式各一个家」——`modelHandle.ts` 之外不许对模型 id / 别名做大小写折叠比较或别名比较（`modelId.toLowerCase() ===`、`modelAlias … ===` 这一类）；`modeForInputs.ts` / `modeTransport.ts` 之外不许按 `transportTaskKind` 在 `modes` 上 filter/find 后返回方式；带阳性对照（按写法形状认出旧判据）和阴性对照（按已认出的 `(provider, model)` 精确取目录行的纯投影不报）。名单只减不增，现有一处（`archetypeModeForCandidate`）带理由登记。
2. eslint 逐文件归属：`recommendVideoGeneration` 在 `electron/capabilityCore/` 只许预览那一处（`mcpGenerationTools.ts` 经注入）引用——「取推荐首项定方式」在执行路径上写不出来。
3. `check:concept-owners`：新登记概念「写下的模型名认哪一行」（owner `resolveModelHandle`），`forbidden_derivations` 列 `identityForNamedModel`、`resolveModelEntry`、`entriesWithId`；`canvas.send-mode` 的 `forbidden_derivations` 加 `videoModeForPlan`；`write_api` 删掉主进程的 `videoModeForCandidate`——写入口名单里的文件整体豁免禁止定义，留着它就等于允许在同一文件里把 `videoModeForPlan` 写回来（反例 7 实测：留着时概念登记不红）。
4. 五入口对拍 + 全目录性质测试（★1 的量具）：行为上的第二处（哪怕名字不同、写法不同）只要答案不同就红。
5. 外部生成工具表冻结：对拍里对 `MCP_GENERATION_TOOL_CATALOG` 的名字 / 标题 / 描述 / 入参 schema 取哈希。现有 model-face 门岗只管应用内 29 个动词，工具表改一个字节此前没有任何检查会红（反例 10 实测）。

## U1–U5 裁定

- **U1 同名多家、没说哪家：统一——哪条路都不取第一家；协调 11-17 拍 A。** 名字主人在「多行都匹配」时只多看一个事实 `preferred`：
  - 条件 1：`preferred` 只能来自现有默认解析器对「这一种任务」的答案（不是四种任务的并集），只能在已匹配的那几行里挑。匹配行里没有它，或有两行都算默认，就拒并列出全部家。默认是别的模型时不许影响结果（反例 13）。
  - 条件 2：落到默认那家时，回执必须写明「同名有 N 家，按你的默认用了哪家」，助手和后面的花钱确认都看得到。不加新码、不动面板和码表——lane 走 `draft_shots` 现有回执 `modelNamesResolved` 的说明串；宿主起草（`create` / 补镜头）的回执加同名同形状的 `modelNamesResolved`（由同一个 `resolvedModelNameOf` 给，一字不差落下的不出现）。确认卡显示的就是落成的那家（候选里的身份），卡本身不改。
  - 条件 3：「此刻能用」只消费共用的可用性结果（宿主快照里的行本来就是可用性线筛过的），这里不再判一遍；对拍里给可用性打桩。
  - 条件 4：五入口对拍里 U1 分三格：默认在匹配里（落它）、默认不在匹配里（拒）、没设默认（拒），五个入口结果相同。
  - 为什么选 A：创作者同时接了两家、两家都有 `minimax-h3`，助手只说「用 minimax-h3」——今天能出片；一律拒会让它变成报错并逼助手多试一轮。默认就是他自己说过的话，不是我们替他挑；没设默认或默认是别的，仍拒。不同家价格不同，所以落到哪家必须在回执和花钱确认里看得见。
  - 证据：内置目录 211 行里同 id 多家的有 5 个：`minimax-h3` kie/apimart/minimax、`suno-v5.5` kie/apimart、`minimax-m3` apimart/minimax、`eleven_v3` / `eleven_text_to_sound_v2` elevenlabs/runway（用 `applyBuiltinSeeds` 扫内置种子）。
- **U2 id 大小写不同：统一——哪条路都认。** 内置目录 18 行 id 带大写，自接的更多；读详情和应用内已经认，只有短创建 / 改计划不认，没有找到理由。供应商 id 仍按原样比（全小写）。
- **U3 写别名：统一——哪条路都认。** 内置目录 0 行有别名（只影响自接模型），读侧认、写侧不认没有理由。宿主快照里没有别名，从装配期已装好的目录行查找（`modelAdmissionSchema` 的 `catalogRowFor`）补上，不另读盘。
- **U4 点名别家仍继承默认的方式：统一——方式只由点名的模型的档案 + 这次真实输入决定。** 根因是默认解析器自己挑了一个 `modeId` 带出来、拟镜又逐字段补默认；两处都删，拟镜每镜改走语义合成。
- **U5 首尾帧输入、没写 `modeId`：统一——由 `modeForInputs` 选，`videoModeForPlan` 删。** 说明白的种类（`image_to_video`）只作为桶，用 `modeTransportFor` 三级收窄候选方式（今天只看了 `mode.transportTaskKind` 一级，漏了档案级），桶里按输入挑。

铁律两条逐条过：说了 = 放上去的——说明白的 `modeId` 只查表不重选（I2）；说明白的种类当桶不越桶；模型名认成的那一行和写的不一字不差时（大小写、别名、近似、按默认平局）回执里照写「写的 → 落成的」，确认卡上就是那个模型。模型没有的值取最近合法值——这一组不落参数值，不涉及；方式主人回 `needsInput`（例如说了图生却没给图）时**不偷换**成别的模型，按今天的做法收下这个方式，缺的输入由发送前的现有检查拒（与画布同一状态）。

## I1–I9 保留成什么

| 号 | 保留成 | 落在哪 |
|---|---|---|
| I1 内部完整名 / 外部两字段 | 参数：主人两个入口——字符串 `resolveModelHandle`、结构化 `resolveModelIdentity`；外部字段不动 | `modelHandle.ts` 注释 + 对拍测试「外部字段逐字不变」 |
| I2 说明白的 `modeId` vs 画布偏好 | 参数：`statedMode` 只查表（说明白的不重选）；画布偏好仍走 `modeForInputs` 的 `preference`（放不下就不算数）。两者语义不同写进注释 | `modeForInputs.ts` 注释 + 现有 `mcpGenerationVideoResolve.test.ts:7-33` 空参考 + 显式 `modeId` 用例保留 |
| I3 粗任务 ≠ 档案方式 | 注释 + 测试：`resolveShotTaskKind` 只答四种之一；方式由主人答；`modeTransportFor` 答桶 | 对拍测试一格「两张图不同角色」 |
| I4 用户默认 vs 测试首行 | 测试：生产不取第一行；`allowRegistryFallback` 仍只给夹具，拟镜那份独立的第一候选逃生口删掉、统一用语义合成的那一个 | `semanticGenerationCandidate.test.ts` 现有反例保留 |
| I5 推荐范围 ≠ 换掉点名模型 | 注释 + eslint：推荐只在预览返回，执行路径不许引用 | eslint 块 + `candidatesForCurrentVideoModel` 注释保留 |
| I6 变体 / 供应商作用域 | 不动：`videoCandidateForPlan` / `resolveArchetypeVariant` 照旧 | 现有测试 |
| I7 认不出档案的旧 / 自接数据 | 不动：主进程认不出档案时候选原样过（今天 `normalizeVideoCandidate` 认不出就原样返回）；画布 `catalogTaskResolve` 不碰 | 注释 |
| I8 错误面与候选数量 | 参数：失败事实都来自主人（`unknown` 的 `nearest`、`ambiguous` 的行），三处包装格式各自保留（lane 完整名字 ≤3、宿主 `provider/model` 一个、外部读 `vendorsForModelId`） | 注释 + 对拍测试只比「认没认出 / 认成哪行」，不比文字 |
| I9 重复行与方式拼写宽容 | 测试 + 注释：主人对两行同串一律拒（外部读以前同家多行取首行，生产条目已去重，不可达）；`statedMode` 保留大小写 / 连字符宽容 | `modelHandle.test.ts` 加一条 |

## 新发现（请协调知悉，默认不在本刀做）

- **第 5 处选方式**：`modelAdmissionSchema.ts:77-88` `archetypeModeForCandidate`，非视频候选（图片改图 / 文生图等）按桶挑参数表。改它会让全部图片模型的准入参数表换判据，风险面和这刀不一样大。**协调 11-17 定：本刀不并**，登记进结构测试的「已知待收」名单，名单只许有这一项（多一项就红），注释写明原因；这刀合并后接着做。
- 应用内与外部的模型清单不是同一个生产者（`agentModelEntriesFromCatalog` 与渲染层 `availableModels`，准备线 S16），清单不同时两个入口不可能一致——对拍测试用同一份清单喂两边，这件归「清单长什么样」那组。

## ★3 一致与复用

- 以前定过、还算数：11-15「Agent 点名只用一个完整名字、查表一处」（第 1 刀，#1541 已合）；11-15 第 2a 刀「方式由参考推、删 `videoModeForPlan`」（`2026-11-15-agent-intent-landing.md:68,136`）；11-12「方式按输入现算」（`canvas.send-mode` 概念登记）；09-22「同名跨家是两个模型，不许取第一家」（`modelSpecProjection.ts:181-191`）；09-18「显式身份不借默认的 mode」（`semanticGenerationCandidate.ts:471-475`）；10-05 铁律。
- 三条路：沿原方向修（三处名字判据各补大小写 / 别名 / 歧义）——同一类会从第四个入口回来；**扩已有主人（选，协调已定）**；删掉自然语义入口、只收完整候选——恢复「id 配错家」旧病，不选。
- 复用：`resolveModelHandle`、`modeForInputs`、`modeTransportFor`、`EDGE_MODE_SLOTS`、`catalogRowFor`、默认解析器、现有拒收码与包装。不引库，不新增总解析器。

## ★4 全状态

- 认出（一字不差）：照旧。
- 认出（大小写 / 别名 / 近似 / 按默认平局）：照旧落盘 `{providerId, modelId}`（目录原样），回执写「写的 → 落成的」。
- 多家同名：U1 A——这一种任务的默认恰好在匹配里就落它、回执写「同名有 N 家，按你的默认用了哪家」；否则拒，拒收带全部家。
- 认不出：`unknown_model`，带最像的。
- 方式：说明白的查表，不是这个模型的方式拒 `mode_not_in_model`；没说明白的按输入选；`needsInput` 收下等发送前检查；`inputsNotAccepted`（放了输入但没有方式收得下）拒，说哪几种方式、各收什么——不偷偷按文生发。
- 加载 / 取消中 / 过期：都是同步纯函数，没有这些状态；过期（起草后模型被删）走现有准入拒。
- 能力不可用（模型没配钥匙）：不归这组，消费可用性线的结果。
- 最长：候选列表最多 3 个完整名字（lane）/ 全部同名家（外部，内置最多 3 家）。

## ★9 验收与回滚（动手前写全）

验收清单（实现线自验并交「反例 → 结果 → 证据」表；验收线只核这份）：
1. **五入口对拍**（`modelNameModeParity.test.ts`，真实入口：lane `draft_shots` 投影 → 宿主 `create`；外部 `nomi_operation_plan` 的参数别名表 → 宿主 `create`；宿主短创建；宿主 `scriptText` 拟镜（规划器桩只产提示词 / 时长，和生产注入的形状一样）；宿主改计划；画布用 `sendArchetypeMode` 做方式参照）。名字写法 × 输入组合：完整名字 / 裸 id / 大小写不同 / 别名（自接行夹具）/ 多家同名 / 认不出 × 无输入 / 一张无角色图 / 首帧 + 尾帧 / 首帧 + 全能参考 / 一张人物参考。断言：每格五个入口「认出的 provider/model + 选出的 modeId（或同一种拒收）」逐字段相同。
2. U1（A）：多家同名三格——这一种任务的默认在匹配里 → 落默认且回执写「同名有 N 家，按你的默认用了哪家」；默认不在匹配里 → 拒并列全部家；没设默认 → 拒并列全部家。五入口同答；可用性打桩。
3. U2：`clip-x` 认成 `Clip-X`，五入口同答。
4. U3：别名认成原行，五入口同答。
5. U4：拟镜点名 KIE Seedance + 一张首帧、默认是 APIMart Seedance → 每镜方式是 KIE 档案按输入选的，不出现 `i2v`；短创建同一组输入同答。
6. U5：KIE Seedance、`image_to_video`、首帧 + 尾帧、无 `modeId` → `firstlast`，五入口同答（画布今天就是 `firstlast`）。
7. 全目录性质：每个内置视频档案 × 每家 × 上面五种输入，主进程归一的方式 = `modeForInputs`（带同一个桶）的方式，差 0。
8. 外部助手字段逐字不变：`nomi_operation_plan` 输入表、`nomi_read` 模型行与详情、三种读拒收的码和 `details` 键——现有 model-face 基线与 `check:model-schema` / `check:mcp-tool-refs` 绿，外加对拍里外部读详情成功回包对基线逐字节比。
9. 说明白的 `modeId` 不重选：显式 `modeId=firstlast` + 空参考 → 仍是 `firstlast`（I2，现有用例保留）。
10. 老数据：`tests/fixtures/old-user-data/` 全部版本回放绿；封印过的多镜重新预览方式和哈希不变。另查一种真实旧形状：旧项目里存的模型名大小写 / 别名和现在目录不一致——从已发版本代码确认有没有；没有就写「已查，无此形状」并带出处。
11. 画布不变：`modeForInputs.exhaustive.test.ts`、`archetypeMeta` 相关测试不改一行绿。
12. 门数：`door-map` 前后两份进证据目录，名字主人 1、方式主人 1。

故意改坏必须报红（改坏 → 哪条检查红 → 还原后绿）：
1. 在语义合成里恢复按 id 遍历快照取首家（原样恢复 `identityForNamedModel`）→ `check:concept-owners` + 结构测试（「供应商可省」的守卫后紧跟按 id 找模型，同段 12 行内）+ 对拍 U1。
2. 同上但**改名复制**成别的函数名 → 对拍 U1 + 结构测试（同一条形状规则，不看函数名）。第一轮验收时结构测试还认不出它（只拦大小写折叠），第二轮补了「供应商可省 + 按 id 找」这条形状后两项都红。
3. 名字主人多行时取 `rows[0]` → `modelHandle.test.ts` + 对拍 U1。
4. 语义合成里对 id 改回精确比较（不走主人）→ 对拍 U2。
5. 别名不再传给主人 → 对拍 U3。
6. 默认解析器恢复返回自己挑的 `modeId`，或拟镜恢复逐字段补默认 → 对拍 U4 + 结构测试（`transportTaskKind` 筛方式）。U4 对拍走生产的默认解析器（`createGenerationDefaultModelResolver`，只喂目录与设置数据，不桩它），并逐字段断言它的答案只有身份四件、没有方式——只恢复解析器那一半时，消费方已不读 `modeId`，行为不变，红在这条断言上。
7. 恢复 `videoModeForPlan`（原名或改名，按 `mode.transportTaskKind` 筛桶）→ `check:concept-owners` + 结构测试 + 对拍 U5 + 全目录性质。
8. 执行路径上取推荐首项定方式（`recommendVideoGeneration(...).recommendations[0]`）→ eslint 归属块。
9. 调用方递一个不在匹配集合里的 `preferred`、或给方式主人递已选好的方式对象 / 谓词想给自己放行 → `modelHandle.test.ts`（不在匹配集合的 preferred 不起作用）+ 类型检查（`task` 只收 `{kind, vendor}`）。
10. 外部模型行 / 生成工具表 / 读拒收改一个字节 → 对拍外部段（读详情逐字节、三种读拒收的码 / 正文 / `details` 逐字段、生成工具表哈希）。生成工具表那一格 model-face 基线 / `check:model-schema` / `check:mcp-tool-refs` 都不红，靠对拍的哈希。
11. 阴性对照：按已认出的 `(provider, model)` 精确取目录行（纯投影，例如 `catalogAvailabilityFor`）→ 结构测试**不报**（绿）。
12. `needsInput` 时偷换成文生或别的方式 → 对拍「说了图生、没给图」格 + 全目录性质。
13. 默认是别的模型（不在匹配里）时却影响了结果（例如退而按默认的供应商挑一家）→ `modelHandle.test.ts` + 对拍 U1「默认不在匹配里」格。
14. 结构测试的已知待收名单多加一项 → 结构测试红。

这一类还会从哪里回来：新加一个建镜头入口自己补默认（拟镜就是这样漏的）；新加一个读模型的口自己比 id；某个调用方为了让自己的请求过，把方式算好了塞进来。前两种由结构测试 + 对拍守，第三种由主人只收事实参数守。

已知限制：
- 结构扫描按写法形状认，换一种写法可能漏，行为上的漏网靠五入口对拍兜。
- 新 eslint 规则拦得住具名导入和命名空间导入（`import * as` 后取推荐首项，验收线实测会红），拦不住经 `deps` 注入后取首项的误用。
- 外部读详情没有任务种类，所以 U1 在那里永远是「拒并列出」，不会落默认。

回滚：一个提交，`git revert` 即可；不改落盘形状。
独立验收：另一条线按本格清单验。
