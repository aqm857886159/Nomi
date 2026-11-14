**入口 15 个（上一版 14 + 渲染层估价）· 推荐不变：B 的后半，并把「这个方式这次收不收这些输入」收进同一道发送前的步骤 · 主人仍是 `electron/shared/modelArchetypes/modeParams.ts`（定键，已由 #1493 落地），输入核对放进同一步、复用 `electron/shared/videoCapabilities/crossFieldConstraints.ts` 的 `validateModeConstraints` · 上一版 15 项要删的已删 6 项，今天还剩 13 项（原 9 + 新 4）· 还要 3 个 PR（PR1 花钱：发送前按方式核输入 + 并进来的 4 件 + 尺子修正 + 文档门岗 + 3 条真付费；PR2 标准：读口收口 + 删桥接表 + 协调两问；PR3 小：可灵编辑默认比例，等样张）· 尺子快照今天 584 样本：漏键 16 / 0、默认值带过来 3、空时长 15 / 0（全是量具假象），PR1 后预计 0 / 0、0、0 / 0 · 5 件：nsfw_check、只放音频、没视频选保留原声、Run 路编辑 / 续写没给视频 → PR1；可灵编辑默认比例 → PR3 · 三条真付费样片共 4 条视频，花费不知道（内置 APIMart 行没有价目，仓库里查不到公开价）· 要用户定的事 1 件（可灵编辑默认比例改成跟随原视频，要看样张），另有 3 处沿用现成样子的可见变化交协调判**

# 设计卡（第 2 版）：「这个方式这次发哪些参数、收哪些输入」收成一处——收尾

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

改动名：方式参数主人 · 收尾。线：D-params-keys-owner-r2（只读设计）。类别：[花钱]，9 格全填。
读的版本：origin/main @ 868172ee2（2026-11-14 09:12）。上一版卡：`/Users/aoqimin/Nomi-coord/tmp/D-params-keys-owner/design-card.md`（入库版 `docs/plan/2026-11-12-mode-params-owner.md`，含「PR1 实测」）。
**前提变化**：上一版的 PR1 已作为 #1493（545ae8758，11-13 06:04）合入；模型档案第一批 #1510（17e406f02）、模型菜单 #1517 也已合入。所以这一版只排「还剩什么」（协调 11-14 回话同意）。
Direction-Check：PR1 碰 `taskParams.ts`、`apimartGenerationProvider.ts`，提交带 `Direction-Check: docs/engineering/direction-checks/2026-11-12-taskparams.md`。

## 一句话

#1493 已经让「这个方式发哪些键」只有一个答案。剩下两类没收：①**这个方式收不收这些输入**（必须有源视频、音频不能单放、「保留原声」要有参考视频）今天只在渲染层判，Agent / Run 路一律不判，个别模型靠按名字挂的补丁（`apimart-minimax-h3`、`apimart-hailuo-23`）判；②**读口**还有 Agent 准入、模型说明、注册表、估价各读各的。PR1 把①收进主进程同一个发送前步骤（两个发送口共用），PR2 把②改读主人并删掉桥接表。

## 1. 对账（协调要求三列：上一版要做的 / #1493 做了的 / 还剩的）

### 1a 入口（door-map 实跑：`resolveModelParams` 读 6 · `applyHeadlessParamDefaults` 写 2 · `taskTemplateParams` 写 5 · `applyHumanModeChoice` 写 1 · `clampParamsToMode` 0）

| # | 入口 | 上一版说的 | #1493 做了 | 今天（行号） | 还剩 / 为什么变 |
|---|---|---|---|---|---|
| 1 | 画布单发 | 改调主人 | ✔ | `catalogTaskActions.ts:330` 定方式、`:341` 主人 + `fixDropdownsBeforeSend` | 无；行号随 mode-bar 合入变 |
| 2 | 分镜批量 | 同 #1 | ✔ | 走同一个 `buildCatalogTaskRequest` | 无 |
| 3 | Run 画布传输 | 主进程再过一遍 | ✔ | `canvasTransportProvider.ts:181` → `runtime.ts:291` | 无 |
| 4 | Agent / MCP 无界面 | 主人 + `modeWhenUnrecorded` | ✔ | `apimartGenerationProvider.ts:273`（补传 variantId） | **输入不核**：显式 edit / extend 没给视频照发（C1），只放音频照发（问题 2）→ PR1 |
| 5 | Agent 准入 | 表改读 `declaredModeParams` | ✘ | `modelAdmissionSchema.ts:77-88` `archetypeModeForCandidate`、视频 `mcpGenerationVideoResolve.ts:185` `videoModeForPlan` | 选方式规则和发送不同：266 组（档案, 供应商, 任务类型）里 **32 组**不同（上一版报 29，第一批加了 3 组）→ PR2 |
| 6 | Agent 读模型说明 | 改读 `declaredModeParams` | ✘ | `electron/shared/agentCapabilities/modelSpecProjection.ts:117/125`（上一版写错目录）、`mcpGenerationTools.ts:462` | PR2 |
| 7 | 注册表兜底参数表 | 改并集、删桥接表 | ✘ | `moduleCatalogBootstrap.ts:62-67` | PR2 |
| 8 | 试模型 | 不变 | — | `tryModel.ts:157` 原样 | 无 |
| 9 | 自建中转（无档案） | 不变 | — | `v0.24.0-wizard/expected.json` 里 `"duration":""` 6 处仍在 | 无 |
| 10 | 声明卡中转 | 同 #1 | ✔ | 升级测试绿 | 无 |
| 11 | 音频 | 同 #1 | ✔ | `audioTaskRunner.ts:80/151` | 无 |
| 12 | 自定义脚本 / 进程型 | 同 #1 | ✔ | `customCallDispatch.ts:113`、`profileHttpRequest.ts:43`、`antigravityCreatePreflight.ts:18/27` | 无 |
| 13 | ComfyUI / 浏览器提取 | 不变 | — | 同上一版 | 无 |
| 14 | 参数面板 | 控件表改读 `declaredModeParams` | ✘ | `nodeModelArchetype.ts:93/96` `archetypeModeParams(mode)` | PR2（排在第 1 堆面板 PR 之后，见 §5） |
| 15 | **新** 渲染层估价 | 上一版 §9 ② 没核 | 两问 a 答了「读节点」 | `planCostEstimate.ts:54` `estimateNodePrice` 喂整个 `node.meta`；主进程扣费 `runtime.ts:303/327` 读主人过后的 extras | 两边口径不同 → PR2 改读主人输出 |

按形状数：生产代码里直接读 `mode.params` / `archetypeModeParams(` 的 27 个文件、40 处（`git grep -nE "mode\.params|mode\?\.params|archetypeModeParams\(" -- src electron`，去测试）。判键 / 发送相关的只有上表 #5 #6 #14 和 `recommendation.ts`、`plannedNodeMeta.ts`；其余是列清单 / 文案，不在本卡。

### 1b 要删的（上一版 15 项）

| # | 项 | 状态 | 归 |
|---|---|---|---|
| 1–4 | `taskParams.ts` 读桥接表两行、删别的方式 fixedParams 的循环、覆盖搬进主人、旧口径注释 | ✔ #1493 删了 | — |
| 5 | `clampParamsToMode` | ✔ 删了，管值那档改名 `fixDropdownsBeforeSend`（`archetypeMeta.ts:837`），概念登记禁用旧名 | — |
| 6 | batch1 的 `pruneParamsOfOtherModes` / `modeLeavesDurationUnset` | ✔ 没进主线，概念登记禁用 | — |
| 7 | `sizeDefaultIsRatioSemantic` 读 `ARCHETYPE_SIZE_RATIO_SEMANTIC`（`taskParams.ts:11/118`） | 剩 | PR2 |
| 8 | `moduleCatalogBootstrap.ts:54-70` `wireDefaultKeysFor` | 剩 | PR2 |
| 9 | 生成脚本 `buildWireDefaultsFor`（`gen-archetype-wire-defaults.ts:47/98`）与 size 语义段（`:276`） | 剩 | PR2 |
| 10 | 7 个 `archetypeWireDefaults*.generated.ts` + `archetypeWireDefaults.test.ts`（共 2112 行） | 剩 | PR2 |
| 11 | 生成脚本测试里主方式用例 → 测 `modeWhenUnrecorded` | 剩（#1493 已加全目录逐字相同测试，旧用例可直接删） | PR2 |
| 12 | `archetype-autosync.yml:68-69` + `archetype-autosync-workflow.node-test.mjs:45/48` | 剩 | PR2 |
| 13 | `check-model-certification-coverage.mjs:127-129` | 剩 | PR2 |
| 14 | 测试读者：`paramsKeysByMode.matrix.test.ts`、`referenceSentWithinInUse.property.test.ts`、`apimartMediaDocsAlign.test.ts`、`generateParamsE2E.test.ts:74`（**新**） | 剩 | PR2 |
| 15 | #5 #6 #14 各自的「供应商 → 变体 → mode.params」取法 | 剩 | PR2 |
| 16 **新** | `archetypeModeForCandidate` 自己的选方式规则（`modelAdmissionSchema.ts:77-88`）：无 modeId 时改问 `modeWhenUnrecorded` | 新 | PR2 |
| 17 **新** | 按名字挂的输入核对：`apimartMinimaxH3.ts:45`（参考合计）与 `:57-58` 只放音频分支、`apimartHailuo23.ts:8`：并进通用核对后同提交删（`minimaxH3.audioOnly` 词条一并删，改用通用文案） | 新 | PR1 |
| 18 **新** | 过期注释说「档案默认由 archetypeWireDefaults 桥接兜底」：`apimartAudios.ts:90`、`volcengineAudios.ts:21`、`volcengineImages.ts:21`、`catalogCommit.ts:493`、`tests/ux/_agentVideoPaid.mjs:4` | 新 | PR2 |
| 19 **新** | `kling4Flash.ts:9` 注释「nsfw 类字段不存在」（和文档不符） | 新 | PR1 |

今天还剩 13 项（7–19）。不能删：`applyWireDefaults`、size 别名闸本身（改读档案，不删闸）、`taskTemplateParams` 的 `""` 缺省、`resolveModelParams` 各政策、`modeForInputs`、试模型原样透传、`scripts/fixtures/process-tiering-replay.json` 里的旧文件名（历史回放数据）。

### 1c 尺子快照（`electron/parity/paramsKeysByMode.snapshot.json` 的 summary，2026-11-13 `55b28401f` 录）

| 项 | 上一版（改前） | #1493 合入时 | 今天 | 为什么变 |
|---|---|---|---|---|
| 样本 | 534 | 534 | 584 | 第一批新增方式（可灵 5 个、Seedance 2.5 编辑等） |
| 漏键 canvas / run | 34 / 25 | 6 / 0 | **16 / 0**（3 个档案：happyhorse、kling-v4-flash、seedance-2.5-apimart） | 全部是「→ edit / → extend」样本：尺子画布路不放视频，画布按输入现算成文生 / 图生，量到的是那个方式自己的键（#1493 已证明是量具假象，`modeParamsSendPorts.test.ts`）；新方式把假象从 6 放大到 16 |
| 默认值带过来 | 2 | 1 | **3** | 同上 |
| 空时长 canvas / run | 9（3 + 6） | 6 / 0 | **15 / 0** | 同上 |
| `noModeRecord` | 2 | 2 | 2 | 不变 |
| `pathsDiffer` | 141 | 144 | 156 | 同上 + 新方式 |

补截图线留下的 `seedModelIdentity.patch`（给 H3-Max 补身份行）：**已在主线，补丁作废**——`electron/shared/modelCanonicalIds.ts:120-121` 有 `"MiniMax-H3-Max": "minimax h3-max"`，旗舰集合 `electron/catalog/seedModelIdentity.ts:103` 有 `"MiniMax-H3-Max"`。

尺子还漏了一件事：Run 路的「→ edit」样本（可灵 4、Seedance 2.5 5、happyhorse 6、rh-qwen 1）状态都是 `sent`——它给了 1 张图、没给视频，请求照发。这就是 C1 在尺子上的样子，只是尺子不判对错。

## 2. 并进来的 5 件

| 件 | 创作者那一幕 | 今天的直接原因 | 收成一处后为什么不再发生 | 会红的测试（PR1 新写） |
|---|---|---|---|---|
| 问题 1 可灵 4.0 Flash、H3-Max（APIMart）没有 `nsfw_check` | 面板里找不到「提交前内容审核」，Seedance 有、这两个没有；不发 = 上游默认 false，不花冤枉钱 | 档案和能力表都漏了这一行；合同测试只比「表 ↔ 档案」，不比「文档 ↔ 表」 | **不属于定键这一类**，是档案漏行。归 PR1 顺手补（两个档案各加一个控件 + 表一行），类问题由 §6 的「文档字段 ↔ 表」门岗兜 | 门岗：`vendor-official/apimart/<模型>.json` 新增 `requestFields`，表里每个文档字段都要有一行；删掉其中一行 → 红 |
| 问题 2 H3-Max（APIMart）只放参考音频 | 画布上能点生成，付费确认后上游拒（不扣费但白等一轮）；Agent 路同样照发 | 档案音频槽没写 `requiresAnyOf`；主线 MiniMax-H3（APIMart）靠按名字挂的补丁 `apimart-minimax-h3` 拦，H3-Max 是另一个模型名，补丁没挂上；主进程通用发送步骤不看 `requiresAnyOf` | 档案声明 `requiresAnyOf: ['image_ref','video_ref']`（H3-Max 和 H3 两份），画布用现成判定置灰；主进程发送前同一步按档案核，按名字挂的分支删掉（删除项 17） | Run 路只放音频 → 拒，零请求；画布节点只连音频 → `canRunGenerationNode` false |
| 问题 3 可灵全能参考：没放参考视频也能选「保留原声」 | 只放图、选「保留原声」点生成 → 上游拒 | 现有约束只能写「参数 ↔ 参数」（`optionConstraints.when.key`），写不了「参数 ↔ 参考槽」 | 约束加一种形状 `when: { slotEmpty: 'video_ref' }`（只这一种，复用同一函数）：面板选项按它收窄（和 Seedream「透明背景只剩 png」同一个样子），主进程同一步按它拒 | 只放图 + origin → 主进程拒、面板选项里没有「保留原声」 |
| C1 Run 路显式 edit / extend 没给视频 | Agent 起草「编辑这段」但素材没带上 → 请求照发、上游 400（不扣费，白等） | 主进程只有按任务类型判「图生要有图」（`imageEditGuardError`），不看这个方式的槽下限；画布不会出事是因为 `modeForInputs` 会换方式 | 同一步：这次的方式里 `min ≥ 1` 的槽没满足 → 发送前拒，说出缺哪个槽（槽名从档案来） | 尺子 Run 路「→ edit / → extend」从 `sent` 变 `refused:mode_input_missing`；快照里看得见 |
| C3 可灵编辑默认比例 | 选可灵编辑，面板显示 16:9，发出去 16:9 → 原视频不是 16:9 时会被改画幅 | 产品默认比例 `videoAspectSeed`（07-17 拍板「首选 16:9」）在选模型时一次性写进节点，盖过档案编辑方式的「auto = 不发 = 跟随原视频」 | **不属于定键这一类**，是「机器写的默认值 vs 这个方式的默认值」。归 PR3（见 §7 看得见的变化） | PR3：未明确选过比例的编辑方式节点，请求体没有 `aspect_ratio` |

可灵编辑默认值的依据：`docs/models/capabilities/kling-v4-flash.md` 原文「without aspect_ratio, it follows the input ratio」「For editing, omission follows the input duration」，档案也把编辑方式的比例默认值写成 `auto`（经 omitAuto 不发）。推荐「跟随原视频」：编辑是改一段已有的视频，换画幅不是创作者要的；只对「没明确选过比例」（`aspect_ratio_user_set` 不是 true）的节点生效，明确选过 16:9 的照发 16:9。参考类方式（可灵 / H3-Max / Seedance 全能参考）保持 16:9，那是 07-17 拍板的产品默认，不在这刀动。

## 3. 三条路（按今天的事实重判）

| 路 | 做什么 | 依据 / 代价 |
|---|---|---|
| 沿原方向补 | 给 H3-Max 再挂一个按名字的补丁、给可灵挂一个、Run 路加一个 edit 特例 | 每个新模型再补一刀；这一类已过三轮（`taskParams.ts` 14 天 4 个 fix），P1 停点。否 |
| **收成一处（推荐，不变）** | 定键已收（#1493）；输入核对收进同一发送步骤，读口改读主人 | 今天的依据：①#1493 合入后 Run 路漏键 25 → 0、官方矩阵 474 / 24 都按设计，一处主人站住了；②并进来的 5 件里 3 件（问题 2、3、C1）是「这个方式收不收这些输入」，主进程恰好在同一步已经知道方式（`applyHeadlessParamDefaults` 里 `mode`），加在这里不用新入口；③按名字挂的补丁（删除项 17）证明不收的代价 |
| 删 | 删掉主进程的方式核对，全靠画布 | Agent / MCP 路没有画布，删了就没人管。否 |

主人不变的理由：输入核对复用 `crossFieldConstraints.validateModeConstraints`（今天已被两个按名字的补丁调用，是现成的共享函数），扩三样：槽下限、`requiresAnyOf`、`slotEmpty` 约束；调用点只有一个——`applyHeadlessParamDefaults` 定下 `mode` 之后（两个发送口都经它）。

## 4. 协调两问（今天主线重核）

- **a 估价读什么**：渲染层（画布批量确认条、Agent 付费卡逐镜价）`estimateNodePrice` 读整个 `node.meta`；主进程授权 / 扣费读主人过后的 extras。两边会不一样的情形：节点上留着别的方式的规格键（例：文生存了 1080p、现在方式不收清晰度），用户自己配了规格价时，卡上按 1080p 报、实际按不带清晰度扣。**以主人为准**：PR2 让 `estimateNodePrice` 先按现算方式过一遍 `effectiveModeParams`。看得见：只在用户自配规格价、且节点上有别的方式残留键时，卡上的数会变（变成和扣费一致）；内置 APIMart 行没有价目，显示「算不出」不变。
- **b Agent 准入以谁为准**：**以发送为准**——准入判的必须是真会发的那个方式。实跑（`tmp/D-params-keys-owner-r2/admission-vs-send.mts`）：266 组里 32 组不同，全是 `image_to_video` 不带 modeId 时准入按文生（t2v）的参数表判、发送按首帧 / 图生补。后果：Agent 写了 `aspect_ratio`，准入放行，发送时主人按图生方式把它剥掉，Agent 以为设了比例。PR2：`archetypeModeForCandidate` 无 modeId 时改问 `modeWhenUnrecorded`（删除项 16）；视频候选的 `videoModeForPlan` 已把选中的方式封进合同（带 modeId），不受影响。看得见：这 32 组下 Agent 会在准入处被拒「这个方式没有这个参数」，说法变了（以前是悄悄丢）。

## 5. 分 PR 与先后

| PR | 档 | 碰的文件（约） | 内容 | 先后 |
|---|---|---|---|---|
| PR1 发送前按方式核输入 | 严档 · 花钱 | ~14：`crossFieldConstraints.ts`(+test)、`taskParams.ts`、`videoCapabilities/types.ts`、`minimaxH3Max.ts`、`minimaxH3Apimart.ts`、`kling4Flash.ts`、`apimartMinimaxH3.ts`、`apimartHailuo23.ts`、`desktopStrings.ts` + i18n、两张能力表、`vendor-official/apimart/*.json`、合同测试、尺子 + 快照、新付费脚本 | 问题 1–3、C1、删除项 17 / 19、尺子修正、文档门岗、3 条真付费 | **第 1 堆面板 PR（`I-composer-params-a`）先合**：它要在同一批档案文件上加「面板 / 高级设置」归属，PR1 在它之后整合主线 |
| PR2 读口收口 + 删桥接表 | 标准档 | ~25（多为删）：删除项 7–16、18，`estimateNodePrice` 改读主人 | 协调两问 a、b；不改发出去的字节（官方矩阵零差异为证） | PR1 之后；`nodeModelArchetype.ts` 也在面板 PR 里，排面板 PR 之后 |
| PR3 可灵编辑默认比例 | 标准档 · 看得见 | ~4：`videoAspectSeed` 或发送前一处 + 面板显示 + 测试 + 走查 | C3 | 用户看过样张后；PR1 的真付费样片 A 已经同时跑了「不发比例」和「16:9」两种，PR3 不用再花钱 |

PR1 量估：一条线 2 轮（Claude Opus，碰花钱路 + 新约束形状要判断）；PR2 Codex 1–2 轮；PR3 1 轮。都在三轮内，不再切。

## 6. 系统哪里没拦住（第一批为什么带着 3 个发请求问题走到验收）

- 缺的检查：能力表合同（`capabilityTables.contract.test.ts`）只比「表 ↔ 档案」，表里漏写的文档字段、表里写了「露出」但约束没落地的行，都没东西比。问题 1 是「文档有、表漏行」；问题 2、3 是表那一行的去处只写了槽（`slot:ref/audio_ref:3:audio_urls`），引文里的「audio alone is not supported」「requires a reference video」没有对应的落点记号。
- 补在哪（强到弱）：
  1. **做不出来**：约束和槽下限只在档案里声明一次，主进程同一个函数核；按名字挂的补丁删掉（删除项 17），以后新模型不可能「漏挂补丁」。
  2. **门岗**：表的落点记号加两种：`requires:<方式>/<槽>=<槽|槽>`、`when:<方式>/<参数>=<值>:slotEmpty:<槽>`，合同测试双向比档案的 `requiresAnyOf` / 约束；`vendor-official/apimart/<模型>.json` 加 `requestFields`（接模型时从文档抄字段名 + 引文），合同测试要求每个字段在表里都有一行（露出 / 不露出 + 原因）。
  3. 尺子 Run 路量到「方式要的输入没给却 sent」就进快照，以后新方式一进来就看得见。

## 7. 看得见的变化（单列，要样张的另走 §1.5）

| 变化 | 哪个 PR | 现成的样子 | 建议 |
|---|---|---|---|
| 可灵编辑面板比例默认显示「自动」（跟随原视频），不再是 16:9 | PR3 | 可灵全能参考的「auto」档就是这个控件的现有选项 | **交用户看样张**（改了一个默认值，07-17 的「首选 16:9」在编辑方式上让路） |
| H3-Max / H3（APIMart）只放音频时生成按钮置灰、说缺图或视频 | PR1 | Seedance 2.0 同一条置灰和文案 | 协调判：沿用现成，不出新样张 |
| 可灵全能参考没放视频时，「声音」下拉里没有「保留原声」 | PR1 | Seedream「透明背景只剩 png」同一个收窄 | 协调判：沿用现成 |
| 可灵 4.0 Flash、H3-Max（APIMart）多一个「提交前内容审核」开关 | PR1 | Seedance 2.5 同一控件；放面板还是高级设置按第 1 堆拍板清单 | 协调判：照面板 PR 的归属规则 |
| Agent 说的话：缺源视频时被拒（C1）、32 组准入被拒（两问 b） | PR1 / PR2 | 现有拒收回执 | 协调判 |
| 估价数字（只在自配规格价 + 残留键时） | PR2 | 现有价格行 | 协调判 |

## 8. 三条真付费样片（挂 PR1，协调跑；`openPaidWalk` + `NOMI_SPEND_OK=1`，免费演练先过）

入口：照 `tests/ux/mode-params-first-frame.paid.mjs`（11-13 刚跑通过，`_paidRun.mjs` 的 `openPaidWalk` / `paidRunRefusal` / `assertPaidBuildReady`、`_agentVideoPaid.mjs` 的 `probeLandedMedia` 今天都在）新写 `tests/ux/archetype-batch1-samples.paid.mjs` + 同名 `.walk.mjs`；`buildMarkers` 用 PR1 新拒收文案里会原样进产物的一句；`hostedUploads: true`（源视频要上传）。只读确认：脚本读过，未跑。

| 样片 | 最小参数 | 要证明的 | 预计花费 |
|---|---|---|---|
| A 可灵 4.0 Flash · 视频编辑 | ffmpeg 造 4 秒 1:1 源视频 · 720p（唯一档）· 不带时长 · 两发：不发比例 / 16:9 | 编辑不带时长上游收；不发比例时成片跟随源视频 1:1、16:9 时是否改画幅（PR3 的依据） | 不知道（2 条） |
| B Seedance 2.5 · 全能参考 | 1 张图 · 1080p · 5 秒 · output_format=mov · watermark=false | 新 1080p 档与三个新键上游收、回来确实是 mov | 不知道（三条里最贵） |
| C MiniMax H3-Max（APIMart）· 多模态参考 | 1 张图 · aspect_ratio=adaptive · 768P · 5 秒 | 新通道行跑通、adaptive 被接受 | 不知道 |

免费反例同脚本先跑（零请求）：H3-Max 只放音频、可灵参考只放图 + 保留原声、Run 路编辑不给视频，三条都在发送前拒、网络账本 0 次。价目：内置 APIMart 行 `pricing` 为 null，仓库里没有这三个模型的价，跑前协调看 APIMart 价目页再定。

## 9. 设计卡 9 格

**★0 先查别人**：沿用上一版四条（LiteLLM drop_params、Ajv removeAdditional + discriminator、zod object、JSON Schema additionalProperties，2026-11-12 实开）。输入核对这一半对应 JSON Schema 的 `dependentRequired` / `if-then`（「有 A 才准 B」声明在 schema 里、由一个校验器统一判）——本卡的 `requiresAnyOf` / `slotEmpty` 就是这个思路，未重新实开网页（只读线，不出网），记「沿用上一版，未重开」。出口：新增两种挡（缺必需输入、单放音频 / 无视频选原声）都是「上游必拒的请求」，属「确定白等」，不是安全挡；画布有置灰和原因、Run 路有拒收原话，出路是补上素材或换方式。

**★1 用户怎么用**：当创作者让 Agent「把这段视频改成夜景」但素材没带上，我想在花钱前就被告知缺源视频，而不是等上游 400。步骤：Agent 起草 → 预览 → 确认 → 发送前拒，原话点名缺「源视频」。真实任务：①H3-Max 只连一段音频；②可灵参考只连图选保留原声；③Run 路显式编辑不带视频。主指标：方式要的输入没给却发出的请求数 → 0，量具：尺子 Run 路「→ edit / → extend」状态（今天 16 条 `sent`）。质量：尺子漏键 / 默认值 / 空时长 → 0 / 0 / 0（今天 16 / 3 / 15，量具同上）。护栏：官方请求体矩阵 498 份除两个模型多 `nsfw_check: false` 外逐字节不变（`officialWire.matrix.test.ts`）；`upgradeKeepsWorkingModels` 绿；文档字段 ↔ 表门岗：未验证（缺量具，PR1 新建）。

**★1b 连带界面**：参数面板（多一种约束收窄选项）、生成按钮置灰原因（复用）、Agent 拒收回执（新文案一句，按槽名拼）；付费确认卡不变。

**★1c 老用户**：项目、节点、存的值一个不动；请求只少不多（唯一多的是两个模型带上文档默认值 `nsfw_check: false`，和不发等价）。升级后：已经存着「只放音频」的 H3-Max 节点、存着 origin 但没视频的可灵参考节点，以前点了发出去被上游拒，现在点之前置灰 / 发前拒——结果都是「没出片」，只是更早、不白等。验证：`tests/fixtures/old-user-data/canvas/v0.24.1-mode-nodes` 逐节点请求体与 PR1 前相同（`canvasModeOldUser.requestBody.test.ts`）；`approvedBeforeUpgrade.test.ts`：跨升级已批准、现在发前被拒的镜头，表现是拒收原话而不是卡「排队中」。

**★2 谁说了算**：定键 `generation.mode-params`（已登记）。输入核对的主人登记进同一概念的 write_api：`crossFieldConstraints.validateModeConstraints`；`forbidden_derivations` 加 `minimaxH3.audioOnly` 那类按模型名的输入核对（禁止 `registerRequestTransform` 里再判参考组合）。

**★3 一致与复用**：复用 `requiresAnyOf`（2.0 起就有）、`optionConstraints`、`constrainParameterControls`、`unmetReferenceDependencyForNode`；不引新库。和参数规整第 2–4 步不冲突（那边管值，这边管键和输入）。

**★4 全状态**：没有新界面元素；三种可见变化都复用现成状态（§7）。

**5 中途表**：发送前同步纯函数，停 / 关窗 / 重启 / 连点与今天一致；被拒不扣费、不建任务。

**6 外部数据与失败**：档案照文档声明；风险是把文档的「建议」写成硬约束误拒（例：Wan 3.0「音频不建议单独使用」就是建议，`wan30.ts:161` 已明确不拦）。拦法：每条约束在表里要有引文，引文是「not supported / requires / must」才准写成约束。

**★7 性能**：不适用：没有新增用户操作；发送前多一次 O(槽数 + 参数数) 的判断。

**8 真实条件**：§8 三条真付费 + 三条免费反例；Windows / 英文：Agent 拒收原话走 desktopStrings 两轨；干净安装 unverified。

**★9 验收清单、反例与回滚**（实现线自验附「反例 → 结果 → 证据」，验收线只核这份）
清单：
1. 尺子重录：漏键 0 / 0、默认值 0、空时长 0 / 0；Run 路「→ edit / → extend」全部 `refused:mode_input_missing`；`noModeRecord` 不变。
2. 官方矩阵 498 份：除可灵 4.0 Flash、H3-Max（APIMart）各格只多 `nsfw_check: false`（文档默认值，等价于不发）外逐字节不变，硬断言；变体快照不变；升级测试绿。
3. 主进程核对单测：槽下限、`requiresAnyOf`、`slotEmpty`、参考合计（原 H3 / Hailuo 用例迁过来全绿）。
4. 两个发送口一致：同一份缺输入的请求，runtime 路和 Run provider 路拒收原话相同、都零网络请求。
5. 画布：H3-Max 只连音频 → 不能点；可灵参考无视频 → 选项无 origin；已选 origin 后断开视频 → 值回 auto（现有 `normalizeConditionalParameters`）。
6. 能力表合同：新增两种落点记号双向比；`requestFields` 门岗覆盖第一批 5 个模型。
7. 删除项 17 / 19 同提交删；`git grep -n "minimaxH3.audioOnly"` 0 处。
8. 免费反例三条网络账本 0 次；真付费三条（4 发）按 §8 判据过。
9. typecheck、`check:concept-owners`、排锁快检、PR 正文预检。
反例（改坏 → 哪条红）：
- R1 去掉槽下限判断 → 第 1 条（Run 路 edit 回到 `sent`）+ 第 3 条。
- R2 H3-Max 档案删 `requiresAnyOf` → 第 5 条 + 第 6 条（表记号对不上）。
- R3 `slotEmpty` 判反 → 第 3、5 条。
- R4 只在 runtime 路调核对、provider 路不调 → 第 4 条。代码上写得出来，是测试会拦（独立验收改坏实测：89 条红），不是「结构上做不出来」。
- R5 恢复 `apimart-minimax-h3` 的只放音频分支 → 第 7 条 + `check:concept-owners`。
- R6 能力表删掉 `nsfw_check` 那一行 → 第 6 条（`requestFields` 门岗）。
- R7 把 Wan 3.0 的「建议」写成 `requiresAnyOf` → 第 2 条官方矩阵（wan3.0 ref 音频格被拒）。
- R8 尺子画布路不给视频 → 第 1 条漏键回 16。
- R9 核对放在主人定方式之前（用请求里的 taskKind 猜方式）→ 第 4 条 + 变体快照。代码上写得出来，是测试会拦（独立验收改坏实测：41 条红），不是「结构上做不出来」。
回滚：revert PR1 合并提交；不写存储，无数据影响。PR2、PR3 各自 revert。

## 9b. 计数口径（线上检查查出后补，2026-11-14）

起因：自己接的中转、用自定义脚本接管的图片模型，选「图片编辑」连了参考图——判定拿目录里留着的旧 mapping body（不读图）去数，数成 0，拒发。同一类错 9 月在旧的参考图护栏上出过一次（`runtime.customCall.test.ts` 守的就是它）。

定法：**看得清才判，看不清不拒**，写在类型里（`crossFieldConstraints.ModeInputEvidence`），不靠每条路径记得兜底。
- 真实派发走哪条路只在发送口定一次（`taskParams.sendRouteFor`）：自定义脚本接管 → `script`；否则按 mapping body 发。发送前核输入和老护栏 `imageEditGuardError` 读同一个结果（`dispatchedCreateBody`）。
- 件数 = 调用方交进来的素材本身（标准输入键，在被各家键名改写之前）+ 方式 / body 绑定的键 + body 直接读的参考键，取大。
- `script`（看不清）：只带下限，判定只判参数组合；缺输入 / 依赖的槽 / 选项要的槽 / 参考合计都不判。
- `mapping-body`（看得清）：素材给了、但 body 根本没有这一族素材的位置 → 记进 `unrouted`，拒收说「当前这家上没有这个方式」（`mode_route_missing`，确定拒收）；素材真没给 → 照旧「请求里没有」（`mode_input_missing`）。两种都零请求。
- 没有档案 / 没有方式记录的模型（ComfyUI、自定义工作流）、没有 mapping body 的路（process / multipart / 无 mapping）：判定不跑，等于看不清。

量具：`electron/catalog/taskParams.modeInputRoutes.test.ts`——全目录 373 格（内置渠道 × 方式）给足下限：缺输入 0 格，「这家没有这个方式」只在 APIMart Suno V5.5 续写 / 翻唱 2 格；同一批格子换成脚本接管：确定拒收 0 格；逐类（声明式中转非标准字段名、脚本接管、ComfyUI / 自定义工作流、kie / fal / RunningHub / Runway、本机文件参考）各有「给全 → 发」「没给 → 拒或放行」断言。

## 9c. 出路句口径（独立验收查出后补，2026-11-14）

起因：Agent 让 Seedance 2.0 做首尾帧、只给了一张当尾帧的图。发送前拒收对，但原话后半句点名「全能参考」；Agent 照原样只换方式再发，又被拒（方式没有尾帧的位置），进了重试圈。Seedance 2.5、Wan 3.0 / Wan 3.0 Prime 同样（点名首帧，再发被拒：参考没被用上）。直接原因：出路句把每件输入的可落槽写成「它现在的槽 + 同种素材能落的所有别的槽」，可请求里那个键带着角色，换方式再发它还是尾帧。

- 口径：**点名即可用**——点了名，同一份请求只换成那个方式号再发，不被任何发送前检查拒；算不出这样的方式就不点名（前半句照旧，不加新句子）。尾帧只按尾帧槽算；首帧可落首帧槽或图片槽（单图方式的输入图，如 PixVerse 图生视频）；没有角色的参考素材照旧可落收同种素材的槽。
- 量具：`electron/catalog/taskParams.modeInputRoutes.test.ts`「点名即可用」——内置目录每个模型 × 每个方式 × 五种输入（少一件必需的、只给不相干的、首尾帧只给首帧、只给尾帧、参考图在标准参考键上），发送前入口和 Run 路各扫 917 格。改前 Run 路点名 23 格、可发 19 格；改后点名 8 格、可发 8 格。同一条测试断言英文轨全部拒收原话不含中日韩字符（英文出路句只说方式号，不塞档案的中文方式名）。
- 已知限制：「首尾帧只给尾帧」两个发送口判得不一样——显式指定方式从画布这一路发会照发（上游把它当首帧；验收线探针量到 Seedance 2.0 / 2.5、Wan 3.0 这样），Run 这一路拒。基线就有，这一刀不改，读侧收敛时处理。

## 10. 拿不准的

| 事 | 谁答 |
|---|---|
| 三条样片的价钱 | 协调跑前看 APIMart 价目页 |
| 可灵编辑「不发比例」上游是否真的跟随源视频 | 样片 A |
| 尺子给画布路放视频后，`pathsDiffer` 回落到多少 | **已答（PR1 实测）**：156 → 154；漏键 16 / 0 → 0 / 0、默认值带过来 3 → 0、空时长 15 / 0 → 0 / 0 |
| `apimartHailuo23.ts` 的核对搬走后，它的请求变换是否还剩别的职责（只读了前 12 行） | **已答（PR1 读全文）**：没有别的职责，整文件删除；老目录数据回放见 `electron/catalog/apimartHailuo23OldCatalog.test.ts` |
| 面板 PR 是否已给 Seedance 的 `nsfw_check` 定了归属（PR1 照抄） | **部分已答**：本分支上「提交前内容审核」开关先出现在参数面板里（照 Seedance 现成控件）；最终放面板还是高级设置由面板 PR #1525 定 |
