# 设计卡：「这个方式认哪些参数」收成一处，显示、发送、Agent 都问它

改动名：方式参数主人。设计：一条只读设计线；实现：PR1。类别：[花钱]（改的是花钱那条路上发出去的请求体），9 格全填。
读的版本：origin/main @ f8a351447（含尺子 #1488）；`feat/mode-bar` @ 033a106f3（按「它已在 main 上」设计）；`feat/archetype-docs-batch1` @ 7c1492a11 只读它对 `taskParams.ts` 的 diff。
Direction-Check：`taskParams.ts` 14 天 4 个 fix，PR1 提交须带 `Direction-Check: docs/engineering/direction-checks/2026-11-12-taskparams.md`（该复盘推荐「换一种做法」，本卡就是它）。

## 一句话

方式由 `modeForInputs` 现算（mode-bar），参数由一个函数按「档案 + 这次的方式 + 变体 + 节点上存的值」读出来：只留这个方式声明的键、默认值只取这个方式自己控件上的、固定参数用这个方式的；节点上存的东西一个不动。渲染层拼请求时调一次，主进程发送前再调一次（同一个纯函数，幂等），Agent 的准入表和模型说明也问它要「这个方式声明了哪些控件」。

## 1. 门表（入口 14 个）

door-map 实跑（origin/main）：`resolveModelParams` 读 6 扇；`applyHeadlessParamDefaults` 写 2 扇；`taskTemplateParams` 写 5 扇；`applyArchetypeModeSwitch` 写 14 扇 / 19 处（mode-bar 已把它删掉，换成 `applyHumanModeChoice`，只有方式菜单两扇门调）。按形状再找：「读 mode.params 判这个方式有哪些参数」的生产代码约 50 个文件，其中参与显示 / 发送 / Agent 判键的列在下表，其余是列清单 / 文案（不判键，不在本卡范围）。

| # | 入口 | 参数从哪来 | 谁决定方式 | 今天在哪一步过滤 | 这张卡之后 |
|---|---|---|---|---|---|
| 1 | 画布单发 | 节点 meta 整个铺进 extras（mode-bar `catalogTaskActions.ts:350-366`） | 渲染层 `sendArchetypeMode`（`catalogTaskActions.ts:329`），写进 `extras.archetype.modeId`（`:336`） | 渲染层只收窄下拉 `clampParamsToMode`（`:336`）；主进程 `runtime.ts:291` 删别的方式的 fixedParams、覆盖本方式 fixedParams（`taskParams.ts:157-177`）；别的方式的普通键不过滤 | `:336` 改调 `effectiveModeParams`；主进程 `:291` 再调一次 |
| 2 | 分镜批量 | 投影成画布节点（mode-bar `storyboardProjection.ts:23` `projectShotNode`，方式取 `:34` 行上的 modeId），再走 #1 同一个 `buildCatalogTaskRequest`（`catalogTaskActions.ts:590`） | 同 #1（落画布后按输入现算） | 同 #1 | 同 #1，不另写 |
| 3 | Run 里的画布传输 | 冻结渲染层拼好的请求（`canvasTransportProvider.ts:181` → `runTask`） | 同 #1（modeId 随冻结请求带过来） | 同 #1 主进程那段 | 渲染层已清过，主进程幂等再清；批的 = 发的 |
| 4 | Agent / MCP 无界面发送 | `input.parameters`（`apimartGenerationProvider.ts:273`） | `input.modeId`；没有时按任务类型取默认值表（不选方式） | `applyHeadlessParamDefaults` 同 #1 主进程那段 | 同一个函数；没有 modeId 时用 `modeWhenUnrecorded`（从生成脚本搬出的「主方式」规则） |
| 5 | Agent 准入（起草 / 预览 / 确认） | Agent 写的 parameters | `archetypeModeForCandidate`（`modelAdmissionSchema.ts:80-88`） | 按方式拒未知键（`executionContract.ts:260`，表来自 `modelAdmissionSchema.ts:118`、视频 `mcpGenerationVideoResolve.ts:254`） | 表改读 `declaredModeParams`；拒法不变 |
| 6 | Agent 读模型说明 | 档案 | 列出全部方式 | `modelSpecProjection.ts:117/125`、`mcpGenerationTools.ts:462` 各自 vendor→variant→mode 取 params | 改读 `declaredModeParams` |
| 7 | Agent 注册表兜底参数表 | `ARCHETYPE_WIRE_DEFAULTS` 按任务类型的键（`moduleCatalogBootstrap.ts:67`） | 不分方式 | 不过滤（任务类型并集） | 改成「这条 taskKind 下各方式 `declaredModeParams` 的并集」，删桥接表 |
| 8 | 试模型 try_model | `args.params` 原样（`tryModel.ts:157/216`） | 无（不带 archetype） | 不过滤 | 不变：供应商直测按原设计原样发 |
| 9 | 自建中转（无档案） | 节点 meta | 无 | 不过滤；duration 缺省发 `""` | 不变（主人只管认得档案的请求） |
| 10 | 声明卡中转（自写能力合同成档案） | 节点 meta | `resolveArchetypeForModel` 认出自写档案 + modeId | 同 #1 | 同 #1（声明卡的方式就是档案的方式） |
| 11 | 音频 | 经 `runtime.ts:291` 后进 `audioTaskRunner.ts:80/151` 的 `taskTemplateParams` | 存着的 modeId（声音方式是人选的任务，`modeForInputs` 照旧用偏好） | 同 #1 主进程那段 | 同 #1 |
| 12 | 自定义调用脚本 / 进程型 | `runtime.ts:301` 在 `:291` 之后；`customCallDispatch.ts:113`、`profileHttpRequest.ts:43` | 同 #1 | 同 #1 主进程那段 | 同 #1（已在 `:291` 之后，自动覆盖） |
| 13 | ComfyUI 候选测试 / 浏览器提示词提取 | `comfyCandidateTest.ts:130`、`browserPromptExtractionRun.ts:103` → `runTask` | 无档案方式 | 不过滤 | 不变 |
| 14 | 参数面板显示 | mode-bar `nodeModelArchetype.ts:96` `archetypeModeParams(mode)` | `effectiveArchetypeMode`（`:93`） | 只渲染这个方式的控件 | 控件表改读 `declaredModeParams`（结果相同，无可见变化） |

## 2. 一个主人

- 文件：`electron/shared/modelArchetypes/modeParams.ts`（与 `modeForInputs.ts` 同目录：一个答「这次按哪种方式」，一个答「这个方式这次发哪些参数」；渲染层、主进程都能 import，纯函数、同步、不认供应商名）。
- `declaredModeParams(archetype, { variantId, modeId }) → { controls, fixedParams }`：档案（已由 `resolveArchetypeForModel` 按供应商特化）再按变体特化后，这个方式声明的控件和固定参数。今天这串「vendor → variant → mode.params」在 #5 #6 #14 和 `clampParamsToMode` 各写一遍，主进程 `taskParams.ts:153-156` 还漏了变体特化。
- `effectiveModeParams({ archetype, variantId, modeId, stored }) → { params, dropped }`，四步，顺序固定：
  1. **管辖的键** = 这个档案所有方式声明过的控件键 ∪ 所有方式的 fixedParams 键（都按供应商 + 变体特化后）。不在管辖内的键（`archetype`、`modelKey`、`nodeId`、参考地址、`archetypeInput`、幂等键……）原样留——extras 是混装袋，不能像 zod 默认那样剥光所有未知键（见 ★0 Ajv 条）。
  2. 管辖内、这个方式没声明的键：不进结果（记进 `dropped`，不写回节点）。
  3. 这个方式声明了、存值缺的：填它自己控件上的 `defaultValue`；控件没有默认值（例：编辑跟随源视频时长）就不填，键不存在。
  4. 最后铺这个方式的 fixedParams（11-08 那次「选中方式的固定参数覆盖旧键」并进来；`archetypeInput` 子袋里同样覆盖，保留 `taskParams.ts:176` 的语义）。
  - 主人只定键、补缺省，**已给的值一个字节不动**。「不在选项里的下拉值修成默认」（政策「只修下拉不管数值」，即旧 `clampParamsToMode` 那一档）单独是 `archetypeMeta.ts` 的 `fixDropdownsBeforeSend`，只在渲染层发送前、紧跟主人之后调（一个调用点）；主进程不调。（PR1 实测改：主人第 4 步原先也修下拉，主进程跟着修，无界面直调的 `768p` 被换成默认 `2K`、升档多花钱——单测分片红出来后协调 11-12 拍板拆开。）
- 和 `resolveModelParams` 的关系：**它前面的一步**，不是它的一档。`resolveModelParams` 的政策按「谁写的」分（人手 / Agent / 发送复查），是写入时规整值；本函数是读出时定键，跟谁写的无关，不写回。所以不塞进 `ModelParamsPolicy`；本函数不调 `resolveModelParams`；渲染层发送前的 `fixDropdownsBeforeSend` 调它管下拉值。参数规整第 3 步「发送同函数复查」以后的输入就是本函数的输出。
- 和 `modeForInputs` 怎么接：渲染层（有画布、有边）算方式，`buildCatalogTaskRequest` 把方式写进 `extras.archetype.modeId`（mode-bar 已这样做，`catalogTaskActions.ts:336`），同处调本函数。主进程**不重算方式**（它没有画布和边），只读 `extras.archetype.modeId / variantId`，对同一份输入调同一个纯函数——渲染层已清过的 extras 再过一遍结果不变（幂等），所以两边不会不一致；唯一会不一致的是两边认出的档案不同，验收里有一条专门比。没有 modeId 的（只有 #4 无界面发送）用 `modeWhenUnrecorded(archetype, taskKind, vendorKey)`：从 `scripts/gen-archetype-wire-defaults.ts` 把「defaultModeId 落在这个 taskKind 就用它，否则取这个 taskKind 首个声明的方式」原样搬进 shared，所以默认值逐字节不变。

## 3. 三件事各怎么消失

| 事 | 删什么 | 以后谁来读 | 尺子快照会变的样本 |
|---|---|---|---|
| 别的方式的键 | 无需新增分支；batch1 的 `pruneParamsOfOtherModes` 不合入 | `effectiveModeParams` 第 2 步 | `samplesWithLeaks` 34 → 0（8 个档案：happyhorse、happyhorse-1.1、minimax-h3、viduq4-preview、wan-2.7、wan-3.0、wan-3.0-apimart、wan-3.0-prime-apimart；canvas 31、run 25 都清） |
| 默认值按任务类型整组桥接 | `taskParams.ts:151-152` 读 `ARCHETYPE_WIRE_DEFAULTS`；`:157-165` 删别的方式 fixedParams 的循环；第 2 个 PR 删桥接表与生成段 | 第 3 步只读本方式控件默认值 | `archetypesWithDefaultCarried` 2 → 0（happyhorse@kie 的 aspect_ratio / duration；minimax-h3@kie/minimax 的 aspect_ratio / resolution，共 16 个样本-路） |
| 空时长 | `taskTemplateParams` 的缺省 `""` 只留给**不归档案管**的请求：extras 带 `archetype.modeId`（=已过主人）时缺 duration → `undefined` 整键丢；batch1 的 `modeLeavesDurationUnset` 不合入 | 主人第 3 步决定 duration 在不在；模板层只看「过没过主人」一个条件 | `emptyDuration` canvas 3 + run 6 → 0（全是 happyhorse 编辑，值 5 来自桥接默认值；删桥接后编辑方式没有时长控件，键消失） |

不变：`noModeRecord` 两条（中转图片照发 n / size，视频被拒）。`pathsDiffer` 预期不变，实测 139 → 144，原因见文末「PR1 实测」。

> PR1 实测（尺子重录）：漏键 canvas 34 → 6、run 25 → 0；默认值带过来 2 → 1；空时长 canvas 6 → 6、run 6 → 0。剩下的 6 个样本全是 happyhorse 的「X → 视频编辑」，是**量具假象**，不是发出去的键：尺子在画布路换方式后没跳过「换了方式」那一步，读到的是换方式之前存的 t2v / i2v / ref 值。实跑同一份请求（主人 + 发送口）发出去的方式是 t2v，请求体只有 t2v 声明的键（见文末）。尺子补「画布换了方式就跳过」另案做，做完预期 6 → 0 / 1 → 0 / 6 → 0、`pathsDiffer` 回落 5。

## 4. 没有方式记录的请求

| 类 | 今天 | 之后 | 老用户 |
|---|---|---|---|
| 自建中转（无档案）、ComfyUI、试模型、浏览器提取 | 原样发；视频 duration 缺省发 `""` | 不变 | 不变。证据：`tests/fixtures/old-user-data/catalogs/v0.24.0-wizard/expected.json:114/146`（veo3.1-fast、seedance-2 的报文就是 `"duration":""`），`upgradeKeepsWorkingModels` 逐字钉住；不确定改成不发是不是对，按「拿不准保持原样」 |
| 跨升级、已批准未发完的 Run（Agent 多镜 / 分镜批量） | 批准时存了请求体指纹，派发前按现算的请求体重算比对 | 请求体变了的镜头（ref 方式多发本方式的比例默认值、首帧等方式剥掉别的方式的键）指纹对不上，派发被拦 | **要重新批一次**：出路是取消这次制作后单镜重生成；见 ★1c。画布单镜不受影响 |
| 认得档案、节点上存着旧方式参数的老节点 | mode-bar 之后发送时现算方式并写 modeId；别的方式的键照发 | 别的方式的键不再发 | **变，是对的**：这些键在这个方式的参数面板上根本没有（看不见、改不了），上游要么忽略要么 400（Flash 图生带比例 400 是实测出处，见方向复盘 §2）。用真实旧数据验：`tests/fixtures/old-user-data/canvas/v0.24.1-mode-nodes`（0.24.1 用真 `applyArchetypeModeSwitch` 切过方式的节点）逐节点比修前修后的请求体，消失的键必须都在「管辖内且本方式没声明」里 |
| Agent / MCP 无界面、不带 modeId | 按任务类型桥接表补默认值 | 按 `modeWhenUnrecorded` 选主方式，取它自己的默认值 | 无界面路：键按方式收、缺的补默认；已给的值一个字节不动（不在选项里的也不换，`modeParamsSendPorts.test.ts` 钉 `768p` / `1024x1024` 两例）。默认值设计上逐字节不变（同一条主方式规则）；`electron/parity/officialWire.matrix.test.ts` 来证（实测 474 份逐字节不变、24 份只多一个键，见文末），`v0.24.0-native-wire` 的档案行同证 |
| 存着 variantId 的节点 | 主进程默认值不按变体特化 | 按变体特化 | 可能变（变体收窄了某个默认值时）；未验证，验收第 9 条专测；有差异先停下报协调 |
| 退回上一版 | — | 本卡不改存储格式、不写回节点 | 旧版本照读 |

## 5. 删除清单（15 项，同提交删）

| # | 文件 · 符号 | PR |
|---|---|---|
| 1 | `electron/catalog/taskParams.ts:151-152` `perKind / primaryDefaults` 读桥接表 | 1 |
| 2 | 同文件 `:157-165` 删别的方式 fixedParams 的循环（6337dc012 前半） | 1 |
| 3 | 同文件 `:173-177` 选中方式 fixedParams 覆盖（6337dc012 后半）：搬进主人第 4 步，原处删 | 1 |
| 4 | 同文件 `:126-139` 注释里「按 archetypeId+taskKind 桥接自 src/config」旧口径 | 1 |
| 5 | mode-bar `archetypeMeta.ts:545` `clampParamsToMode`：并入主人，调用方 `catalogTaskActions.ts:336` 改调主人 | 1 |
| 6 | `feat/archetype-docs-batch1` 的 `pruneParamsOfOtherModes`、`modeLeavesDurationUnset`、默认值删键循环：第三轮从分支上撤掉，不合入 | batch1 |
| 7 | `taskParams.ts:116` `sizeDefaultIsRatioSemantic` 读 `ARCHETYPE_SIZE_RATIO_SEMANTIC`：改读本方式 size 控件选项（档案查不到才回退旧正则那段保留） | 2 |
| 8 | `moduleCatalogBootstrap.ts:54-70` `wireDefaultKeysFor` 与注释 ③ | 2 |
| 9 | `scripts/gen-archetype-wire-defaults.ts` 里 `buildWireDefaultsFor` 与 size 语义两段生成（**保留** identifiers / modes 两份生成物，autosync 还要它们） | 2 |
| 10 | `electron/catalog/archetypeWireDefaults{,.image,.image2,.video,.video2,.audio,.model3d}.generated.ts` 7 个文件 + `archetypeWireDefaults.test.ts` | 2 |
| 11 | `scripts/gen-archetype-wire-defaults.test.ts` 里主方式用例：搬去测 `modeWhenUnrecorded` | 2 |
| 12 | `.github/workflows/archetype-autosync.yml:68-69` 两行路径 + `scripts/archetype-autosync-workflow.node-test.mjs:45/48` 对 wire-defaults 文件名的断言 | 2 |
| 13 | `scripts/check-model-certification-coverage.mjs:127-129` 三行路径 | 2 |
| 14 | 测试里的读者：`paramsKeysByMode.matrix.test.ts` 的候选键改读档案全部方式；`referenceSentWithinInUse.property.test.ts:53/244`；`apimartMediaDocsAlign.test.ts` | 2 |
| 15 | #5 #6 #14 三处各自的「vendor → variant → mode.params」取法（`modelAdmissionSchema.ts:111-118`、`mcpGenerationVideoResolve.ts:254-257`、`modelSpecProjection.ts:113-125`、`nodeModelArchetype.ts:90-96`）改调 `declaredModeParams` | 2 |

不能删：`applyWireDefaults`（mapping 级 defaultParams，给无档案的兜底）；size 别名闸本身（像素语义目标还要它）；`taskTemplateParams` 的 `""` 缺省（老中转被钉住，见 §4）；`resolveModelParams` 各政策（写入规整，参数规整第 2 步的地盘）；`modeForInputs`；试模型原样透传。桥接表头注释给的存在理由「electron/tsconfig rootDir 隔离、runtime 不能 import 档案」已经不成立：档案在 `electron/shared/modelArchetypes/`，`taskParams.ts:9` 已在 import 它。

## 6. 三条路

| 路 | 做什么 | 改动面 | 风险 | PR | 快照能清 |
|---|---|---|---|---|---|
| A 一步到位并进参数规整第 2 步 | 主人 + 全部读口 + 删桥接表 + 品牌类型（第 4 步）一次做 | ~35 文件 | 和第 2 步的写入规整、界面样张绑在一起；第 2 步要出样张，批 1 新模型要等最久；热点文件一刀改太多，第 3 轮概率高 | 1 大 | 34→0 |
| **B 先收键、再收读口（推荐）** | PR1：主人 + 两个发送口 + 空时长；PR2：读口改调 `declaredModeParams` + 删桥接表 + 概念登记 | PR1 ~10 文件；PR2 ~25 文件（多为删） | PR1 碰花钱路，要严档 + 一次真付费；PR2 基本是机械删除 | 2 | PR1 后 34→0、默认值 2→0、空时长 9→0（实测 6 / 1 / 6，剩下的是量具假象，见文末） |
| C 只删默认值桥接 | 只做第 3 节第二行 | ~15 文件 | 别的方式的键照发，批 1 新模型照样 400；下一刀必来 | 1 | 漏键 34→34，默认值 2→0，空时长 9→0 |

推荐 B：PR1 就把快照三项清到 0，批 1 新模型可以紧跟着合；PR2 不改任何发出去的字节，可以和批 1 第三轮并行。A 把「定键」和「改值 + 界面」绑死，C 不解决主因。

## 7. 设计卡 9 格

### ★0 先查别人（2026-11-12 实开）

- [LiteLLM drop_params](https://docs.litellm.ai/docs/completion/drop_params) · 默认遇到模型不支持的参数就报错；`drop_params=True` 才静默丢；支持表按「供应商 + 模型」维护 · **确认了**：键的支持表跟着「模型 + 方式」走，不按任务类型并集；**改了**：我们丢的只是「同档案别的方式的键」（面板上看不见的），不是用户点名的未知键，所以是丢不是报错；Agent 点名的未知键照旧在准入处拒（#5 不变）。
- [Ajv 改数据](https://ajv.js.org/guide/modifying-data.html) · `removeAdditional` 配 `oneOf` 时，判一个分支会把另一个分支的键剥掉；官方解法是先用 `discriminator` 选定一个分支再剥 · **确认了**主人的顺序：先由 `modeForInputs` 选定方式（判别字段），再按这一个方式剥键；`useDefaults` 只补缺失 · **确认了**第 3 步「既有值优先、只补缺」。
- [zod 对象](https://zod.dev/api?id=objects) · `z.object` 默认剥未知键，`strictObject` 报错，`looseObject` 放行 · **改了**：extras 是混装袋（路由、参考、幂等键都在里面），整袋剥会剥坏，所以只在「档案管辖的键」范围内剥（第 1 步），其余放行；把参数和路由拆成两个袋留给参数规整第 4 步的品牌类型。
- [JSON Schema additionalProperties](https://json-schema.org/understanding-json-schema/reference/object#additionalproperties) · `additionalProperties` 只认同一子 schema 里声明的属性，组合（allOf）时会误拒，要用 `unevaluatedProperties` · **确认了**：方式的控件要先按供应商、变体特化成一份完整声明再判（主进程今天漏了变体特化），不能拿基础档案的方式去判。
- 出口：不涉及：本卡不新增、扩大或挪动任何挡人的保护（不拒发、不加锁、不等待）；只是不再发看不见的键，Agent 准入的拒法原样不动。

### ★1 用户怎么用

当创作者在视频节点上先用文生选了 16:9，再连一张首帧图（方式现算成首帧、首帧方式不收比例），我想点生成就出片，以便不因为一个看不见的比例收到 400、白等一轮。
步骤：选模型 → 文生调比例 → 连首帧图（底栏方式格变首帧，面板没有比例）→ 点生成 → 付费确认 → 出片；删掉首帧图回到文生，比例还是 16:9。
不做：不改面板、不改档案参数档位、不改存储、不清节点上的值、不做值的写入规整（参数规整第 2 步）、不改 Agent 拒未知键的口径。已知坑：别名键（`aspectRatio` / `durationSeconds` 等）不是控件键，不在管辖内，照旧留（`taskTemplateParams` 会从 `aspectRatio` 推 size）——尺子只放控件键，量不到这类，记「未验证：缺量具」。
真实任务：①wan-3.0-apimart 文生选尺寸后加首帧发送；②happyhorse@kie 文生后换成视频编辑发送；③minimax-h3 文生后连首帧发送。
主指标：发 B 时请求体里没有 A 独有的键 → 漏键样本比例 → 目标 0/534，量具 `electron/parity/paramsKeysByMode.matrix.test.ts` 快照 `samplesWithLeaks`（改前 34；PR1 实测 canvas 6、run 0，6 个全是量具假象，见文末）。
质量指标：默认值只来自本方式 → `archetypesWithDefaultCarried` 0（改前 2，PR1 实测 1），`emptyDuration` 0（改前 canvas 6 + run 6，PR1 实测 canvas 6 + run 0），同一量具。
护栏：没有用户参数的默认路径不变 → `electron/parity/officialWire.matrix.test.ts` 498 份请求体逐字节快照（实测 474 份不变、24 份只多一个本方式比例默认值，登记成硬断言）；老中转报文不变 → `electron/catalog/upgradeKeepsWorkingModels.test.ts` 全绿；切回原方式值还在 → 新单测 + `canvasModeOldUser.*` 特征测试；上游真收下 → 第 8 格那一次真付费。

### ★1b 连带界面

参数面板（只换取数函数，显示不变）；付费确认卡（批的请求就是清过的那份，不新增文字）；Agent 回执 / 模型说明（参数表来源换成主人，内容不变）；错误卡不变。没有新文案。

### ★1c 老用户

项目、节点、存的参数：一个不动（读出时算，不写回）。升级后：老中转逐字不变；认得档案的老节点不再发别的方式的键（§4，用 v0.24.1-mode-nodes 真实旧数据验）；无界面默认值实测 474 份逐字节不变、24 份只多一个键（6 个 ref 方式自己的比例默认值，见文末）；带变体的节点 130 格中 11 格有差异、由变体收窄引起的 0（见文末）。退回上一版：存储没变，照常打开。

跨升级、已批准未发完的 Run 里，这几类镜头要重新批一次；出路是取消这次制作后单镜重生成；类问题另案。（读代码推断，没有实跑界面。）Run 批量路批准时存的是 `provider.buildRequest` 输出的指纹（`productionGenerationAuthorization.ts:96-109`，键排序后算，对键顺序不敏感；`generationRuntimeAdapter.ts:233-251`），派发前重算比对、不一样就抛「wire payload no longer matches」（`productionGenerationSubmission.ts:288-294`）。本改动让两类镜头的请求体变了：ref 方式多发本方式的比例默认值、首帧等方式剥掉别的方式的键，这两类升级前批的指纹对不上；请求体没变的照发（`electron/parity/approvedBeforeUpgrade.test.ts` 三格钉住）。拦下后创作者看到的：调度器只把这一镜记进本趟失败、打一行日志（`multiShotBatchScheduler.ts:445-448`），任务停在已授权，节点一直显示「排队中 · 第 n/N」（`productionShotPhase.ts:85-99`、`:265-268`），没有报错；Run 不停（`multiShotBatchScheduler.ts:239-252` 看不到失败单元）；「继续」只续同意窗口、不重算指纹（`productionDispatchConsent.ts:22-42`）。唯一出路：任务面板「取消这次制作」→ 节点显示「这次制作已取消，这一镜没有开拍。选中它可以单独生成。」→ 单镜生成走新的批准。画布单镜不受影响：它的 provider 原样交回渲染层冻结的那份请求（`canvasTransportProvider.ts:11-12`、`:133`），主人在后面的 `runtime.ts:291` 才作用，批的和发的是同一份。「对不上时落成失败并给出路」不在这一刀里，另案（0.25 发版条件）。

### ★2 谁说了算

概念：新登记 `generation.mode-params`（「这个方式这次发哪些参数」），主人 `modeParams.ts:effectiveModeParams`，write_api 加 `declaredModeParams`、`modeWhenUnrecorded`；禁止在主人外按 `mode.params` 判键 / 拼默认值（concept-owners 的禁用写法守）。消费者：渲染层发送、主进程发送、Agent 准入 / 说明 / 注册表兜底、参数面板。同一规则今天 5 处（`clampParamsToMode`、`taskParams` 两段、桥接表、batch1 一份）→ 1 处。不靠「东西不见了」猜意图：方式由输入现算是 mode-bar 的显式规则。

### ★3 一致与复用

以前定过：11-09 参数规整卡 ★1「不做发送时悄悄修正」管的是**值**（看得见的值被悄悄改）；本卡丢的是这个方式面板上不存在的键，显示的 = 发的，不冲突。方向复盘 11-12 推荐「换一种做法」，用户 11-12「按推荐做」。和参数规整：本卡是第 1 步之后、第 2 步之前插的一步（键先定、值再规整）；第 3 步的发送复查以本函数输出为输入；第 4 步的品牌类型由本函数铸造。复用 `resolveModelParams`、`resolveArchetypeForModel`、`specializeArchetypeForVariant`、`modeForInputs`，不引新库（zod 不适合混装袋，理由见 ★0）。

### ★4 全状态

没有界面：不新增、不改任何元素、布局、文案；面板控件表数据源换成主人，结果与今天 `archetypeModeParams(mode)` 相同。能力不可用 / 失败等状态沿用现有发送失败卡。（看得见的变化单列见 §9。）

### 5 中途表

主人是发送前的同步纯函数，不新增状态；停 / 关窗 / 断网 / 重启 / 连点的表现、扣费、回执全部与今天发送前一致（未发出不扣费，回执在任务列表）。

### 6 外部数据与失败

外部来源：档案（照供应商文档写的方式声明）。风险：档案少声明了上游必需的参数 → 以前靠别的方式的键 / 桥接默认值碰巧带过去，以后不带 → 上游 400，用户看到现有失败卡。拦法：PR1 加普查测试「每个档案每个方式：主人输出的键 ⊆ 本方式声明 ∪ 管辖外」+ 官方夹具 `tests/fixtures/vendor-official/` 比对 + 一次真付费。不甩锅给 Key。

### ★7 性能

不适用：没有新增用户操作；发送前多一次 O(参数个数) 的纯函数，面板取控件结果不变、走同一缓存（`effectiveArchetypeMode` 的 WeakMap）。现有 `composer-*` 性能场景不需新基线。

### 8 真实条件

Mac 本地：尺子、官方请求体矩阵、升级测试、旧画布夹具。真付费一次（协调跑）：wan-3.0-apimart，节点文生存一个非默认 size → 连首帧图（现算成首帧）→ 发送；判据：请求体没有 size、上游受理并出片；产物带修复标记、专用工作树、免费演练先过。Windows / 英文界面 / 最小窗口：不适用（无界面）；干净安装：unverified。

### ★9 验收清单、反例与回滚

实现线自验并附「反例 → 结果 → 证据」表；验收线（另一条线，编号不同于实现线）只核这份。
清单：
1. 尺子快照：`samplesWithLeaks` 0、`archetypesWithDefaultCarried` 0、`emptyDuration` 0/0；`noModeRecord`、`pathsDiffer` 与今天逐字相同（`NOMI_UPDATE_PARAMS_KEYS_SNAPSHOT=1` 重录，PR 里看差异只出现在这三项）。PR1 实测：run 路三项全 0（硬验收）；画布路剩 6 个 happyhorse「X → 编辑」样本、`pathsDiffer` 139 → 144（+5 是同一批样本），是尺子没跳过「画布换了方式」造成的量具假象，另案补尺子。
2. `officialWire.matrix.test.ts` 498 份：474 份逐字节不变、24 份只多一个键（硬断言，见文末）；`upgradeKeepsWorkingModels.test.ts` 全绿，v0.24.0-wizard 的 `"duration":""` 仍在。
3. `canvasModeOldUser.{characterization,target,rollback}` 全绿；另加一条：v0.24.1-mode-nodes 每个节点修前修后请求体差异表，消失的键全部属于「管辖内且本方式未声明」。
4. 主人单测：幂等（过两遍 = 过一遍）；不写回（输入对象冻结也不抛）；管辖外键原样；无默认值控件不出键；fixedParams 覆盖顺序（含 `archetypeInput` 子袋）。
5. 一致性：同一节点，渲染层 `buildCatalogTaskRequest` 出的 extras 与主进程 `applyHeadlessParamDefaults` 出的 extras 在管辖键上相同（每个多方式档案各一例）。
6. 普查：全部档案 × 方式，主人输出键 ⊆ 本方式声明 ∪ 管辖外；新档案入库即受这条约束。
7. batch1 分支撤掉它的 taskParams diff 后，它自带的新模型请求体测试（报告称 21 条）在 PR1 之上全绿。
8. `modeWhenUnrecorded` 与生成脚本旧规则在全目录逐 (档案, 供应商, taskKind) 相同。
9. 变体：Seedance fast 等收窄变体的节点，主进程默认值按变体特化；与今天有差异的列表交协调（不自行放行）。
10. typecheck、`check:concept-owners`、排锁快检、PR 正文预检六项；真付费一次（第 8 格）。
反例（改坏 → 哪个检查红 → 还原 → 绿）：
- R1 主人第 2 步不剥 → 第 1 条快照 leaks 回 34。
- R2 第 1 步把管辖范围放成「所有未知键」→ 第 2 条官方矩阵差异 + 第 4 条管辖外键单测。
- R3 默认值改回按任务类型取 → 第 1 条 `defaultCarried`（happyhorse@kie 编辑）。
- R4 无档案请求的 duration 缺省改成 undefined → 第 2 条 v0.24.0-wizard veo3.1-fast 报文。
- R5 档案请求缺 duration 又回 `""` → 第 4 条单测 + 第 7 条 batch1 编辑方式用例。
- R6 主人把结果写回节点 → 第 4 条「不写回」+ 第 3 条「切回原方式值还在」。
- R7 主进程忽略 `extras.archetype.modeId` 自己取默认方式 → 第 5 条一致性。
- R8 主进程漏变体特化 → 第 9 条变体用例。
- R9 渲染层不调主人只靠主进程 → 第 5 条（冻结请求与发出体管辖键不同）。
- R10 新档案某方式少声明一个它模板里用的键 → 第 6 条普查。
- R11 调用方绕过主人自己读 `mode.params` 判键 → `check:concept-owners` 禁用写法。
- R12 `modeWhenUnrecorded` 换成「defaultModeId 优先、不看 taskKind」→ 第 8 条 + 第 2 条（minimax-h3 text_to_video）。
- R13 fixedParams 覆盖顺序反过来 → 第 4 条 + 6337dc012 原有 taskParams 用例。
- R14 try_model 请求被剥键 → `tryModel` 现有测试。
这一类会从哪回来：新入口直调 `runTask`（主进程那道兜住）；新档案（普查）；供应商特化 / 变体（第 5、9 条）；旧数据（第 3 条）；新的混装键（第 1 步只剥管辖内）。
回滚：revert PR1 的合并提交即可；不写存储，回滚无数据影响。PR2 单独 revert。

## 8. 拆 PR 与顺序

顺序：mode-bar 合入 → **PR1**（严档·花钱：新 `modeParams.ts` + 单测、`catalogTaskActions.ts` 改调、`taskParams.ts` 两段改写、`taskTemplateParams` 空时长、快照重录、普查测试、concept 登记草稿；约 10 文件，带 Direction-Check trailer、独立验收、真付费一次）→ 批 1 第三轮（撤掉自己的 taskParams diff，rebase 到 PR1 上，第 7 条验收）与 **PR2**（标准档：读口改调、删桥接表 7 文件与生成段、workflow / 门岗路径、测试读者；不改发出去的字节，官方矩阵零差异为证）可并行 → 参数规整第 2 步。
实现线与验收线编号不同；PR1 估 2 轮，PR2 估 1–2 轮。

## 9. 看得见的变化（单列，未展开）

按设计不应出现。两处我没核完，实现线发现任何一处显示会变就停下报协调、另走样张：①参数面板显示的下拉值是否已按 `clampParamsToMode` 收窄（mode-bar 注释说是，未读面板取值代码）；②付费确认卡的价格估算读的是节点 meta 还是清过的 extras（主进程扣费 `runtime.ts:303/327` 用的是 `:291` 之后的 extras；若渲染层估价读 meta，删掉桥接默认 duration 后编辑方式的估价可能变）。

## 10. 我不知道的

| 事 | 谁来答 |
|---|---|
| 渲染层估价读 meta 还是 extras（§9 ②） | 协调读代码能答 |
| Agent 准入的 `archetypeModeForCandidate` 与「主方式」规则不同（多方式共用 taskKind、默认方式不在其中时，一个回默认方式，一个取首个声明）——无 modeId 的 Agent 请求会不会出现「准入按 X 判、发送按 Y 补」 | 协调读代码能答；要统一就是 PR2 一行，但会改 Agent 拒收结果，先跑一次准入测试看差异 |
| 带变体节点的主进程默认值会不会变（§4） | 跑一次实验（PR1 第 9 条） |
| 别名键（aspectRatio / durationSeconds 等）残留会不会推出 size / duration 发出去 | 跑一次实验（给尺子加别名键样本）；会的话下一步按 `parameterEquivalentKeys` 把别名并进管辖范围 |
| 档案有没有少声明上游必需参数、靠桥接默认值碰巧发通的 | 跑一次实验（第 6 条普查 + 官方夹具）+ 真付费 |
| 声明卡中转的自写档案在 v0.24.0-declared-card 上的请求是否变 | 跑一次实验（升级测试已覆盖该目录，PR1 跑完即知） |

## 自验

- 门表行号：均来自本次 `git show`/`git grep` 原文（main @ f8a351447，mode-bar @ 033a106f3）。
- 抽 6 条重开代码核过：①`runtime.ts:281` 读 `extras.archetype.modeId`、`:291` 调 `applyHeadlessParamDefaults`；②`apimartGenerationProvider.ts:273` 同函数、modeId 取 `input.modeId`；③`taskParams.ts:151-177` 桥接表读取 + fixedParams 两段；④mode-bar `catalogTaskActions.ts:336` 写 modeId 并调 `clampParamsToMode`；⑤`v0.24.0-wizard/expected.json:114` 报文含 `"duration":""`；⑥生成脚本还产出 identifiers / modes 两份（`archetype-autosync-workflow.node-test.mjs:45`），所以脚本不能整删。
- ★0 四条都实开了网址（2026-11-12）。Replicate 的预测文档页没写输入校验规则，没采用。
- 反例改坏 → 红 → 还原 → 绿：不适用（只读线不改代码），反例已写进 ★9 供实现线跑。
- 中途事故：设计线读到一半 shell 被工作树隔离钩子拒绝，之后只用 Read 读文件；door-map 数字是被拒前跑出的，没能重跑第二遍。

## PR1 实测（2026-11-12）

### 动手前两问

- §9 ② / 两问 a：渲染层付费确认卡的估价读节点上存的值（`estimateNodePrice` 读节点参数），主人不写回节点，所以卡上的数不变；显示不变。主进程 Run 授权按清过的请求算，现在含本方式默认值（价目只按目录 `specCosts` 匹配，比例不进价目，见下面估价）。
- §10 第 2 行 / 两问 b：`archetypeModeForCandidate` 与 `modeWhenUnrecorded` 在全目录上有 29 个（档案, 供应商, 任务类型）选出的方式不同；这一刀不统一，留 PR2 先跑准入测试看差异。

### 尺子（`paramsKeysByMode`）

| 项 | 改前 | PR1 | 说明 |
|---|---|---|---|
| 漏键 canvas / run | 34 / 25 | 6 / 0 | run 路 0 是硬验收 |
| 默认值带过来（档案） | 2 | 1 | 同下 6 个样本 |
| 空时长 canvas / run | 6 / 6 | 6 / 0 | 同下 6 个样本 |
| `noModeRecord` | 2 | 2 | 不变 |
| `pathsDiffer` | 139 | 144 | +5 全是下面的 happyhorse 样本 |

剩下的 6 个样本（都只在画布路）：`happyhorse|kie|happyhorse|{t2v,i2v,ref}->edit`、`happyhorse|runway|happyhorse_1_0|{t2v,i2v,ref}->edit`。量具假象：尺子在画布路把方式记成 edit 后没跳过「画布按输入现算换了方式」，读到的是换方式前存的值；画布按输入现算，没有源视频时发的是文生。实跑同一份请求（`buildCatalogTaskRequest`）：

```
kie text_to_video {"id":"happyhorse","modeId":"t2v"} duration= 5 aspect_ratio= 16:9
runway text_to_video {"id":"happyhorse","modeId":"t2v"} duration= 5 aspect_ratio= 1280:720
```

`electron/parity/modeParamsSendPorts.test.ts` 正面断言这 6 个样本发出去的方式是 t2v、请求体 = 只存 t2v 键的节点发出的请求体、没有 `audio_setting`。尺子补「画布换了方式就跳过」另案，做完预期 6 → 0 / 1 → 0 / 6 → 0、`pathsDiffer` 回落 5。

### 官方请求体矩阵（`officialWire.matrix.test.ts`，498 份）

474 份逐字节不变，24 份只多一个键（`officialWire.bodies.snapshot.json` 的 `added`，硬断言：新增全部在 `|ref|` 格、且只多这一个键）。都是 ref 方式自己控件上的比例默认值，以前按任务类型取的是 i2v 主方式的默认值（i2v 不声明比例，所以不发）：

| 格（canvas、run 各一份） | 键 = 值 | 供应商文档：ref 不传时默认 | 一致 |
|---|---|---|---|
| happyhorse-1.1 ref n=1 / n=9 | size = 16:9 | 16:9（docs.apimart.ai happyhorse-1.1/generation，2026-11-12 开；没写跟随参考图） | 是，固定比例 |
| wan2.7 ref n=1 / n=5 | size = 16:9 | 16:9（wan2.7-r2v/generation，2026-11-12 开；只有首帧时跟随首帧） | 是，固定比例 |
| viduq4-preview ref n=1 / n=15 | aspect_ratio = 16:9 | 16:9（vidu-q4-preview/generation，2026-11-12 开；没写跟随参考图） | 是，固定比例 |
| MiniMax-H3 ref n=1 / n=9 | aspect_ratio = adaptive | — | 自适应 |
| wan3.0-video ref n=1 / n=10 | size = adaptive | — | 自适应 |
| wan3.0-video-prime ref n=1 / n=10 | size = adaptive | — | 自适应 |

### 变体（`modeParamsVariants.snapshot.json`，130 格）

11 格和改前不同，由变体收窄引起的 0 格（单独一条断言）。8 格多一个键、和上面同口径（本方式自己的比例默认值）：`wan-3.0@kie` 的 standard / prime 两个变体的 ref（aspect_ratio = adaptive），`dreamina-seedance-2` 六个变体（fast、standard、vip、fast_vip、mini、v2_5）的 multimodal（ratio = 16:9；仓库里的即梦 CLI 帮助记录 `docs/research/2026-09-01-dreamina-cli-v1417-matrix.md` 写 multimodal2video 省略 ratio 默认 16:9，一致）。另 3 格（run 路 veo-3.1 image_to_video、dreamina text_to_video / image_to_video）只是键顺序变了（固定参数最后铺），值相同。

### 跨升级已批准的 Run

`electron/parity/approvedBeforeUpgrade.test.ts`：用改前的 `taskParams` 算的指纹去比现在的请求体——wan2.7 ref（多了 size）拦下、wan3.0 首帧（剥了 size）拦下、wan2.7 文生（没变）照发。

### §10 实验答案

- 带变体节点的主进程默认值：见上「变体」，变体收窄引起的差异 0。
- 别名键残留：会。节点上存的是 `aspectRatio` 时（不是控件键、不在管辖内、照留），wan-3.0-apimart 首帧方式的请求模板从它推出 `size = 9:16`；存 `durationSeconds` / `videoDuration` 时 happyhorse 编辑方式推出 `duration = 8`。存控件键 `size` / `duration` 的同样场景都不发。这一刀只记事实，不修。
- 档案少声明上游必需参数：官方矩阵 498 份没有一份丢键，默认路径上没有「靠桥接默认值碰巧发通」的参数；上游真收下要等真付费（unverified）。
- 声明卡中转（v0.24.0-declared-card）：`upgradeKeepsWorkingModels.test.ts` 10/10 绿，请求不变。
