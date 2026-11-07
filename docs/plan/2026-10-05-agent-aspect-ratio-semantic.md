# Agent 说的画幅进不了请求 · 设计卡 + 方向检查

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

```
改动名：draft_shots 加语义字段 aspectRatio，宿主按所选模式的比例控件翻成真实键
线/负责人：L-aspect（Opus）        类别：[花钱]（不新增界面）
诊断来源：D-agent3（origin/main 144d87ebe）
```

## 0. 一句话

用户在 Agent 对话里说「16:9」，付费卡上 Z-Image Turbo 显示 1:1、说「1:1」Nano Banana 2 显示「自动」——两个都是出厂默认，说明比例从没进过请求。模型面上「比例」没有自己的位置，只能猜各家的键（`size` / `aspect_ratio` / `ratio` / `aspectRatio`）写进 `parameters`；而它最常猜的驼峰 `aspectRatio` 恰好被宿主当成「Nomi 选型意图键」放行、编合同时 `continue` 掉，不报错也不上线缆。这一刀给比例一个语义位置（同时长 `durationSec` 的先例），由宿主在**看得见所选模式参数表的那一处**翻成真实键，翻不了就当场拒并列出合法值。

## 1. 现状实查（以 144d87ebe 为准，本线复核过）

| # | 位置 | 事实 |
|---|---|---|
| ① | `electron/shared/agentCapabilities/verbs/writeVerbs.ts` `draftShotSchema` | 一镜没有比例字段，只有通用 `parameters`（`z.record`）。 |
| ② | `electron/capabilityCore/generationPlanningParameters.ts` `GENERATION_PLANNING_HINTS.aspectRatio` | 驼峰 `aspectRatio` 被登记成「Nomi 自己消费、永不上线缆」的意图键。 |
| ③ | `electron/capabilityCore/executionContract.ts` `compileParameters` | 命中意图键 → 类型对就 `continue`，不进合同。**假接受陷阱**。 |
| ④ | `electron/capabilityCore/generationPlanPatch.ts` `normalizeStoredDraft` → `stripParametersNotAccepted` | 下一次读草稿时把 `aspectRatio` 当「残留」清掉。卡上看到的是档案默认。 |
| ⑤ | `src/workbench/generationCanvas/agent/plannedNodeMeta.ts` `buildPlannedNodeMeta` | 落画布只认和控件同名的键，`aspectRatio` 被丢，节点也是默认。 |
| ⑥ | 全目录普查（数法见 §1.1，可复跑：`electron/shared/aspectRatioValue.census.test.ts`） | 336 个组合；按共享判据 `optionsAreAspectRatios` 有比例控件的 231 个（与验收线 V-1023 一致），**每个恰好一个**；宿主翻译另认 13 个带「自动 + 分辨率档」的（共 244 个可翻）；没有比例选择的 92 个（图生视频为主，比例跟着输入图）。其中选项是像素串的 56 个（§1.2）。 |
| ⑦ | `electron/capabilityCore/mcpGenerateParams.ts` `buildGenerateParams` | 对外 `nomi_generate` 的「把比例同时铺进三个别名」——**全仓零调用方**（2026-09-01 起），死代码。 |
| ⑧ | `electron/shared/agentCapabilities/canvasModelShapes.ts` `STORYBOARD_MODEL_GUIDELINES` | 诊断点名的那条旧指引所在的常量**全仓零引用**，不进任何模型面。 |

### 1.1 怎么数的（第一版数错了，已改）

第一版写的 376 / 263 / 113 是本线临时脚本数的，有两处和验收线不一样，都是我数多了：
① 档案有变体时，我既数了每个变体，又额外数了一份「未特化的基础档案」——它就是默认变体，重复了（多 40 个）；
② 供应商分层我按「每个模式各自的 vendorParams」数，验收线按「整份档案按某个供应商特化后，每个模式算一个」数（差 3 个，出在只有部分模式声明了 vendorParams 的档案）。
另外 263 用的是脚本里自己写的一份比例判断，不是共享判据。

现在的口径 = 验收线的口径：档案有变体只数变体、没变体数档案本身 × 供应商分层（通用层 + 任一模式声明过 vendorParams 的每个供应商，整份特化）× 模式。判据用共享的 `optionsAreAspectRatios`。结果 336 / 231，与验收线一致；这几个数写进了普查测试，目录变了测试会红。

### 1.2 像素档（验收补的第 1 项）

Runway 那一层的比例控件选项是像素串（`1280:720`），按 §1.1 的口径共 56 个组合：Seedance 2（3 个变体 × 4 模式）12、Wan 3.0（2 变体 × 4）8、Veo 3.1（3 变体 × 3）9、Gemini Omni 1.1 3、HappyHorse 1、Gen-4.5 2、Gen-4 Turbo 1、gen4 图像 2、gen4 图像 Turbo 1、Muse 图像 2、Grok Imagine 图像 2 3、Gemini 图像 3 Pro 2、Gemini 图像 3.1 Flash 2、gpt-image-2 2、Seedream 5 Lite 2、Nano Banana（runway 层）2、Seedream 5 Pro（runway 层）2。验收线数的是 43 个，差 13 个：我把「选项里出现像素串」的都算上了，含带 `auto_480p` 这类自动档的 Wan 3.0（8）、Seedream 5 Pro（2）与 Grok Imagine 图像（3）——正好 13 个；如果验收线只数「全是像素串」的控件，就是 43。普查测试里列了这 56 个，可以逐个对。

规则（判据在 `electron/shared/aspectRatioValue.ts` 一份里）：
- 先看有没有和要的比例**同一个串**的选项（普通比例控件走这一步，行为不变）；
- 再看像素档：比例相等的（容差 3%，吸收供应商取整：Gemini 的 16:9 档是 1344:768、gpt-image-2 的是 1920:1088；相邻常用比例至少差 6%）；
- 只有一档 → 它；好几档 → 取和**这一镜写着的那一档**（调用方在 parameters 里写了这个键时）或**控件默认那一档**同档的。「同档」= 短边相等（Wan 的 720p 档：1280:720 / 960:720 / 720:720），或面积差在 1.25 倍内（Seedance 的 720p 档：1280:720 / 960:960 等面积）；参照值本身就是候选之一时取它；同档里取比例最贴的；
- 判不出（没有参照、同档没有、同档里两项一样贴）→ 拒，`parameter_not_in_enum`，`allowedValues` 只列这几个同比例候选，不随便挑；
- 说 auto：控件有普通自动档就用它；只有 `auto_480p / auto_720p / auto_1080p` 这类的，按同一套同档规则挑。
- 为了「和默认同档」，宿主的参数字段带上档案声明的默认值（`ParameterField.default`，只有档案投影出来的字段有；准入本身不读它）。

结果：56 个像素档组合说 16:9 / 9:16 全部直接对上（普查测试断言）。改草稿时「这一镜写着的那一档」今天拿不到——改草稿整份替换 parameters（见 §5 已知坑），所以改比例按默认那一档挑；合并规则修好后自然会用上当前那一档。

## 2. 改成什么样

```
模型面 draft_shots.shots[].aspectRatio = "16:9" | "auto"         （比例只写这里；parameters.aspectRatio 当场拒）
  └─ 投影 semanticsOf：→ 宿主面 parameters.aspectRatio（语义载体键，常量 ASPECT_RATIO_SEMANTIC_KEY）
       └─ 宿主写入口（多镜 create / 单镜 create / 改草稿）统一过 normalizeAuthoredCandidate：
            normalizeVideoCandidate（定模式）→ projectSemanticAspectRatio（按这个模式的参数表）
              · 找「选项除自动档外全是比例」的那个控件（判据 = 搬到 electron/shared 的那一份，渲染层同用）
              · 值规范化后比对选项 → 落成真实键（Z-Image→size，Nano Banana 2 kie→aspect_ratio，Agnes→ratio）；像素档按比例对上、同比例多档挑同档（§1.2）
              · auto → 该控件自己的自动档值（auto / adaptive）
              · 没有比例控件 / 值不在选项里 / 和 parameters 里真实键写的不一样 → ContractCompilationError（带 allowedValues）
       └─ 落盘的候选里只有真实键 → 付费卡、画布落地、派发读到的是同一个值
```

同批删：`GENERATION_PLANNING_HINTS.aspectRatio`（再没翻译就到编译口的 `aspectRatio` 走「未知参数」拒绝）、死代码 `mcpGenerateParams.ts`、死常量 `STORYBOARD_MODEL_GUIDELINES`；比例判据从 `src/…/aspectRatio.ts` 与 `parameterOptionPresentation.ts` 搬进 `electron/shared/aspectRatioValue.ts`，两边都从那里读（不是第三份）。

## 3. 九格

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在 Agent 对话里说「来一张 16:9 的海边日出」，我想付费卡上、画布节点上、供应商收到的比例都是 16:9，以便这笔钱换来我要的画幅。步骤：①说出比例 ②Agent 调 `draft_shots`，一镜带 `aspectRatio` ③宿主按所选模型翻成它的键 ④卡上显示这个比例 ⑤点生成，请求体带这个比例。模型做不到（Z-Image 要 21:9；图生视频模式没有比例选择）→ 当场拒、附合法值，Agent 换值或问用户，**不会**悄悄按默认出片。**不做**：清晰度（同形，见 §6 后续）、分镜编辑器整片画幅（另一个 owner，见 §5）、对外 MCP 加字段。**已知坑**：改草稿只带 `aspectRatio` 会整份替换 `parameters`（宿主 patch 语义，`durationSec` 今天也是这样）。真实任务：(a) Z-Image「16:9 海边日出」一张；(b) Nano Banana 2「1:1 三镜分镜」；(c)「把第 2 镜改成 9:16」。 | 真任务需真 App + 真付费，本线 `unverified`，交协调会话跑 |
| ★2 谁说了算 | 「这一镜的比例落在哪个参数键」唯一 owner = `electron/capabilityCore/semanticAspectRatio.ts` `projectSemanticAspectRatio`；「这个控件是不是比例控件 / 一个值是不是比例」唯一 owner = `electron/shared/aspectRatioValue.ts`（从渲染层搬来）；「这个候选此刻接受哪些参数」唯一 owner = `mcpGenerationVideoResolve.acceptedParameterSchema`（从 `stripParametersNotAccepted` 抽出，清残留与翻译共用）。写入口三扇（多镜 create、单镜 create、改草稿）都经 `normalizeAuthoredCandidate`。 | `node scripts/door-map.mjs normalizeVideoCandidate`（5 扇，见根因合同 doors） |
| ★3 一致与复用 | 照抄时长先例（`durationSec` → `parameters.duration`，描述「只写这里」）；拒绝复用 `ContractCompilationError` + `parameter_not_in_enum` / `unknown_parameter` 现成码（zh/en 文案与恢复动作已在 `mcpToolErrorResults.ts`），不新增错误码；比例判据搬家不复制。名字与格式照 Vercel AI SDK 的 `aspectRatio: "{w}:{h}"`。 | `git grep -n "optionsAreAspectRatios\|normalizeAspectRatioToWH"` 只剩一处定义 |
| ★4 全状态 | 不新增界面、不改文案。卡上：要的比例 / 「自动」。被拒：Agent 拿到结构化错误（`details.allowedValues`），不出卡、不扣费。旧草稿里残留的 `aspectRatio`：读时照旧清掉并在 `clearedParameters` 里报给 Agent（既有的残留策略）。 | `check:i18n`（无新文案） |
| 5 中途表 | 见 §4 | 单测 |
| 6 外部数据与失败 | 外部来源两个：①模型写的比例字符串——认 `16:9` / `16：9` / `16 : 9` / 具名桶（`landscape_16_9`）/ 自动档词；认不出（「竖屏」「wide」）→ 拒并列合法值；②目录档案的控件选项——只有一个比例控件时才翻；两个以上（今天 0 个）→ 拒「有歧义」；认不出档案又没有 registry 参数表 → 拒，告诉 Agent 用 `list_models` 里该模型自己的键写进 `parameters`。像素档（`1280:720` 这类，Runway 那一层 56 个组合）按 §1.2 对上：比例相等就翻成那一档，同比例多档按「当前那一档 / 默认那一档」挑同档，判不出就拒并只列那几个候选——挑分辨率就是挑价钱，不替用户随便挑。 | 本卡 §1 ⑥ 扫描 |
| 7 性能预算 | 每镜一次参数表查找 + 一次遍历选项（≤ 30 项），可忽略。 | 不测 |
| 8 真实条件 | Windows ✓（本机单测与门岗）；真 App / 英文界面 / 真付费 = `unverified`（本线不起真 App、不花钱）。 | 交协调会话：零额度夹具之外的真付费验收 |
| ★9 验收与回滚 | 验收：另一条线对着本卡核 §2 链路 + 三条真实任务看卡上与请求体比例。回滚：revert 本 PR 的提交（数据无迁移；模型面基线随提交回滚）。 | PR `## 独立验收` |

## 4. 中途表

翻译发生在「建草稿 / 改草稿」那一次同步调用里，早于任何出价与派发。

| 此刻 \ 打断 | 关窗 | 断网 | 重启 | 连点 | 按停 |
|---|---|---|---|---|---|
| A Agent 正在调 `draft_shots`（翻译中） | 调用随回合中止，没落草稿。不扣。 | 不走网。不扣。 | 没落盘。不扣。 | 模型侧重复调用 = 两份草稿（既有行为，与本刀无关）。不扣。 | 同关窗。不扣。 |
| B 翻译被拒（值不合法） | 无草稿。不扣。回执：Agent 那条工具结果。 | 同左。 | 同左。 | — | — |
| C 草稿已落、卡未出 | 草稿里是真实键；重开后卡照样读到。不扣。 | — | 同左。 | — | — |
| D 卡已出 | 与本刀无关（卡、门、派发一行没改）。 | — | — | — | — |

## 5. 同类入口与处置

| 入口 | 处置 | 理由 |
|---|---|---|
| `draft_shots` 多镜 create / 单镜 create / 改草稿 | 并进 `normalizeAuthoredCandidate` | 本刀主体 |
| 对外 MCP `nomi_generation_plan`（create / plan）带 `parameters.aspectRatio` | 同一个翻译（宿主载体键就是它） | 不加字段，tools/list 字节不变 |
| 剧本拟镜 `scriptText` → `draftShotFromStoryboard` | 同一个翻译（走同一个 create 写入口） | — |
| 文稿方案改一镜 `patchStoryboardAuthoring` | **不并** | 方案正本在渲染层，宿主手里那份候选可能已被用户在编辑器里换过模型，按它翻会翻错键；落画布时渲染层按控件同名过滤。后续与下一行一起做。 |
| 分镜编辑器 / `propose_storyboard_plan` 顶层 `aspectRatio`、`patch_shots.aspectRatio`、`FILM_DEFAULTS.paramKey = "aspect_ratio"` → `buildPlannedNodeMeta` | **不并（后续）** | 另一个 owner（`electron/shared/storyboard/storyboardShotScope.ts`，有 `check:storyboard-owner` 门岗）。同类缺陷已实查确认：整片 16:9 落到 Z-Image（键 `size`）会被 `buildPlannedNodeMeta` 按「控件不同名」丢掉，表上还标「不支持」。修法是让 `buildPlannedNodeMeta` / `unsupportedFilmDefaultKeys` 调本刀搬到 shared 的同一个判据。交协调会话排期。 |
| 对外 `nomi_generate` 别名 `buildGenerateParams` | 删 | 零调用方 |
| 清晰度（`resolution`，取值 `1K`/`2K`/`720p`/`1080P` 因档案而异） | 后续 | 同形问题，键名统一但取值格式不一；本刀不做。 |

## 6. 方向检查（RW）

`node scripts/fix-churn.mjs`（2026-10-05）：`mcpGenerationVideoResolve.ts` 近 14 天 8 个 fix、`mcpGenerationTools.ts` 15 个、`writeVerbs.ts` 7 个（所在 `verbs/` 目录 15 个）、`generationPlanPatch.ts` 3 个。

**0. 一句话根因**：模型面把「供应商参数表」原样摊给模型，凡是「同一件事各家键名 / 取值格式不同」的参数（时长、比例、清晰度），模型都只能猜，宿主又没有一处把语义翻成真实键——于是每猜错一种写法就冒一个 bug。

**1. 归类**：时长 `durationSec` 被改名成宿主没有的顶层字段（09-18）、`durationSec` 与 `parameters.duration` 打架（09-21）、本次比例被意图键吞掉——同一类：「语义参数没有自己的位置」。

**2. 为什么一直冒**：`parameters` 是 `z.record`，模型面不知道、也不该知道哪家叫什么；宿主只有「合法键表」，没有「语义 → 键」这一层。

**3. 不改结构会冒什么**：①清晰度：模型写 `resolution: "2k"`，Seedream 要 `2K`、Wan 要 `1080P` → 被拒或回落默认（验证：`list_models` 对比各档案 `resolution` 选项）；②文稿方案里说「竖屏」→ 整片画幅落到 `size` 键的模型上被丢（验证：§5 那一行）。

**4. 靶子独立性**：本刀测试断言的是「落盘候选里的真实键」与「付费卡投影」，不是本刀自己产出的中间值；变异（去掉翻译）必须红。

**5. P0**：「语义参数 → 供应商键」不是我们独有的——Vercel AI SDK 的 `generateImage({ aspectRatio })` 就是这一层；但我们的供应商走档案驱动的目录传输，不经 AI SDK 的图片模型，所以只能照它的约定（名字、`{w}:{h}` 格式），翻译那几十行按档案写。不支持时 AI SDK 发 warning，我们拒：warning 等于让用户按默认画幅付钱。

**6. 接入 / 补 / 重写 / 删**

`fix-churn.mjs`（合入 #1015 之后）另按概念数：「参数准入」第 5 个 fix、「一份补丁怎么并进这一镜的候选」第 9 个。下面对这两个概念同样成立——它们反复出 bug 的原因正是 §0 那一句。

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 走 Vercel AI SDK 4.3.19 `generateImage({ aspectRatio })`（`node_modules/ai/dist/index.d.ts:3178`），由各 provider 自己翻键 | 要把档案驱动的目录传输（kie / apimart / RunningHub / 火山 / Runway 的 HTTP 模板）整体换成 AI SDK image provider；视频没有对应接口 | 领域约束挡住：我们的模型能力（模式、参考槽、比例选项）住在自己的档案里，AI SDK 的 provider 不认这些中转站；且它对不支持的比例只发 warning，花钱路上等于按默认出片 | 否——**名字与 `{w}:{h}` 格式照它**，翻译按档案写 |
| 补 | 在描述里教模型每家键名 | 每接一个模型改一次描述 | 弱模型照样猜错 | 否 |
| **重写（限这一层）** | 语义字段 + 宿主一处翻译，删意图键陷阱 | 本 PR | 改草稿整份替换 parameters 的既有语义不变 | **是（本刀）** |
| 删 | 不让模型设比例，只在卡上改 | 用户说了等于没说 | 体验倒退 | 否 |

**7. 用户要权衡的核心**：是否把「语义参数」做成一层（比例先做，清晰度、文稿方案画幅随后），而不是每个参数出 bug 时各补一次。推荐：是，按 §5 的后续顺序排。

**特征测试**：`electron/capabilityCore/semanticAspectRatio.test.ts`（三家键名、越界、auto、冲突、无比例控件）、`electron/agentLane/agentAspectRatio.e2e.test.ts`（`draft_shots` → 建草稿 → 付费卡投影）、`writeVerbs` 的 `parameters.aspectRatio` 拒绝。

## 模型面与预算（CI 两道预算门岗，上限一个没动）

模型看到的变化只有两处：`shots[].aspectRatio`（说明「Frame ratio: 16:9 or auto.」，不设长度限制，空串到宿主按类型不对拒）；`parameters` 的说明改成「Profile values except length and ratio; the host clamps and reports each clamp.」——原来那句只点了时长，现在把时长、比例两个「另有家」的并成一句，顺手压短。工具描述里的字段列表不加 aspectRatio。

| 预算（pi 自己的估算器） | 上限 | main（无本字段） | 第一版 | 现在 |
|---|---|---|---|---|
| P5 · draft_shots core | 785 | 767 | 810 | 777 |
| P5 · draft_shots 全量 | 1706 | 1695 | 1739 | 1705 |
| lane 全部组常驻（3D-BOX 开关开） | 10000 | 9982 | 10025 | 9992 |
| lane 全部组常驻（开关关） | 10000 | — | 7745 | 7712 |

「parameters.aspectRatio 当场拒」那条拒绝住在 `prepareArguments`（运行时），不占 schema 预算，原样保留。

## 先查别人

- 依赖里：Vercel AI SDK 4.3.19 `generateImage` 的 `aspectRatio?: \`${number}:${number}\``（`node_modules/ai/dist/index.d.ts:3178`），供应商自己翻成本家参数，翻不了发 `unsupported-setting` warning（`node_modules/@ai-sdk/openai/dist/index.mjs:1590`）。我们照它的名字与格式。
- 生态里：AI SDK 文档 https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-image （`size` 与 `aspectRatio` 两个语义参数，按供应商支持取其一）。
- 仓库里（先例）：时长语义字段 `durationSec` → `parameters.duration`（`electron/shared/agentCapabilities/verbs/draftShotsProjection.ts`「① 时长改的是嵌套层级」那段）；比例判据原在渲染层 `resolveParameterOptionPurpose` 与 `normalizeAspectRatioToWH`，本刀原样搬进 `electron/shared/aspectRatioValue.ts`（渲染层改从那里读），不另写。
- 仓库里（同类老闸）：`applyHeadlessParamDefaults` 的 size 比例闸与生成期 `ARCHETYPE_SIZE_RATIO_SEMANTIC`（`electron/catalog/taskParams.ts:96`）只管 `size` 一个键、按 (archetype, taskKind) 查，管不到 `ratio` / `aspect_ratio` 的选项校验，所以不拿它当判据。
- 结论：语义层照 AI SDK 的约定；翻译按档案控件写（领域约束：档案驱动的目录传输），判据复用仓里现成的那一份。
