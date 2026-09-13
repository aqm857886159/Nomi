# 整片默认 → 逐镜生成参数：全类普查与单一 owner

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实施（2026-09-12）
> 根因合同：`docs/fixes/2026-09-12-storyboard-plan-defaults-passthrough.root-cause.json`
> 机器门岗：`pnpm run check:storyboard-owner`（普查表的第 ②③ 列是它在跑，不是这份文档在记）

## 0. 一句话

用户在分镜「全部镜头」批量条上把整片画幅设成 9:16，表里每一格也画成竖的，**出片仍是横的**。
根因不是"漏合并了一个键"，而是 **界面显示的和请求体携带的是两份真相**：`plan.aspectRatio` 只有
分镜表 UI 在读，落画布那一层直接铺 `shot.params`，于是"继承整片默认"的行（95% 的行）
落到画布上根本不带画幅，静默回落成模型档案默认（`auto` / `16:9`）。

用户的要求是**不修那一个点，找出整类**。这份文档就是那次普查。

---

## 先查别人

> 报告全文：[docs/research/2026-09-12-storyboard-plan-defaults-passthrough/prior-art.md](../research/2026-09-12-storyboard-plan-defaults-passthrough/prior-art.md)
> （四问：依赖 / 仓库 / 生态 / TikHub 自媒体；自媒体原文 30 条落在同目录 `tikhub/tikhub-search.md`）
>
> 一句话结论：**两段作用域这个模型仓库里早有、生态里也早有，缺的是它的第二个读者——给请求体用的 resolver。**
> 所以本轮不新造「默认值合并器」（并行版，P1），只给现役 owner 补导出口。

| 来源 | 它已经说了什么 | 本轮怎么用它 |
|---|---|---|
| `origin/research/skill-trigger-mechanism-20260912` 的 `docs/research/2026-09-12-skill-trigger-mechanism/prior-art.md` §2.6 / 差距表 G8 | 定位到同一个 bug 的三段（`plan.aspectRatio` 只被 UI 读 / `storyboardPlan.ts` 落画布不合并它 / `storyboardAspectScope` 主动清"继承行"的冗余值），并明确指出 `storyboardPlanSchema` 没有 `aspectRatio` 键、规划师写的整片画幅在 `parseStoryboardPlan` 处被静默丢弃。该文只定位不给方案 | 本轮的起点。**结论沿用、修法不同**：那份研究顺手把"主动清掉继承行的冗余值"也列进了病灶，本轮实查后判定那一条是**对的设计**（继承是读时算的，抄一遍就造出第二份真相）——真正缺的是这一层没有导出给请求体用的 resolver。见 §4 |
| `docs/plan/2026-09-06-storyboard-v6-feedback-rework.md` §2.4.1（2026-09-05 用户拍板「画幅项目级 + 行覆盖」） | 定下两段作用域：整片默认住 plan、行级覆盖住 shot，读写唯一 owner 是 `storyboardAspectScope.ts` | 这一条合同**本身没错，只落实了一半**：owner 只服务了 UI 那一端。本轮把它推广成"整片级设置作用域"并补上请求体那一端 |
| `docs/plan/2026-09-09-storyboard-single-truth-*`（分镜/画布单一真相，方案 B：方案正本 + 逐字段覆写） | 确立 `overriddenFields` 那条"画布上手改过的字段归画布"的规则，`storyboardOverrides.ts` 是它的 owner | 本轮不动它：行覆盖 / 画布覆写是**第三段**作用域，resolver 产出的是前两段的合并值，`projectShotNode` 末尾照旧让画布覆写最后落笔 |
| `src/config/modelArchetypes/gptImage2.ts:11-13` 的铁律注释 | 档案层声明**中性 canonical 参数**，各站线缆字段名/值格式的差异由 codec 的 `paramMap` 翻译 | 解释了为什么 canonical 键是 `aspect_ratio`，也解释了 §6 那条遗留：一部分档案的画幅能力天生长成 `size`（像素档），不是命名漂移 |
| `src/workbench/generationCanvas/nodes/aspectRatio.ts:12` `ASPECT_RATIO_KEYS` / `controls/parameterControlModel.ts:113` `ASPECT_RATIO_ALIASES` | 仓库里早有"哪个键表示画幅"的 owner | §6 遗留项的落点就在这两处之一，本轮不新造第三份 |
| `node_modules/@xyflow/react/dist/esm/index.js:1874-1876` / `types/component-props.d.ts:40-49`（React Flow `defaultEdgeOptions`） | 框架的默认值是**创建时盖章**：`onConnect` 那一刻把默认展开进新 edge，之后与默认再无关系；只有 `:1538` 的 `selectable ?? true` 是读时问默认 | **刻意不抄盖章那一半**——整片画幅是会被用户随时改的，盖章等于把同一个值抄进 95% 的行（v6 §2.4.1 拆掉的正是它）。盖章语义只留给第三段（画布覆写） |
| `node_modules/zod/v3/types.js:1984` / `:2053`（`unknownKeys: "strip"` 是 `z.object` 的默认） | 未声明的键**按契约被静默剥掉**——这不是 bug | 定性了 §2.1 第 1 条：修法是把 `planKey` 逐个声明进 schema（并由门岗判据 1 保证），**不是**给 schema 加 `.passthrough()` |
| CSS 层叠与继承（<https://www.w3.org/TR/css-cascade/>） | 继承值不抄进每个元素，而是在**计算值**阶段沿树求出来；元素自己写了声明才叫覆盖 | 本轮优先级链就是一条 cascade；「键缺席」≡「没有这条声明」，而不是「显式 auto」。也是 §4.1「清冗余值是对的」的理论依据 |
| TikHub 自媒体 30 条（`docs/research/2026-09-12-storyboard-plan-defaults-passthrough/tikhub/tikhub-search.md`）：抖音「AI视频比例翻车」<https://www.douyin.com/video/7646282377853772392>、小红书把画幅写进提示词 <https://www.xiaohongshu.com/explore/6a922cb4000000002501d6f6> | 「设了比例、出来不是那个比例」是这群人的通用体验；真实绕行是**不信任那个参数、改用提示词去求** | 支持 §6 的诚实交付：接不住的模型要在界面**说出来**，而不是默默替用户把值塞进 prompt |

---

## 2. 普查表：一条整片级设置要活过五段

每条设置都得连过五段才算"设了就算数"。任何一段掉队，用户看到的都是同一个症状：**设了没用，且没人告诉他**。

- **UI**：用户能不能在整片作用域上设它
- **Plan**：方案 schema 留不留得住（渲染层 `parseStoryboardPlan` 是 zod 默认丢未知键；主进程 `propose_storyboard_plan` envelope 是 `.strict()` 直接拒收）
- **Row**：行级怎么表达"这一镜不一样"，以及"继承"在数据上长什么样
- **Materialize**：落画布建节点 / 写回节点 / 策略引擎输入，三条路读不读得到
- **Provider**：模型档案接不接得住；接不住时界面说不说实话

| # | 参数 | UI（整片） | Plan schema | Row（覆盖 / 继承） | Materialize | Provider |
|---|---|---|---|---|---|---|
| 1 | **画幅 aspect_ratio** | ✔️ `StoryboardBulkBar.tsx:169` 批量条第四枚胶囊 → `setPlanDefaultAspect` | ✖️→✔️ **本轮修**：`storyboardPlanSchema.ts:84` 补 `aspectRatio`；`canvasWrite.ts:176-180` 补进 `.strict()` envelope | ✔️ `shot.params.aspect_ratio`；**继承 = 键缺席**（`storyboardShotScope.ts:185-195` 清冗余值，正确） | ✖️→✔️ **本轮修**：三条路统一走 `resolveShotParams`（`storyboardPlan.ts:557`、`storyboardProjection.ts:34`、`storyboardStrategy.ts:50`），首帧图走 `resolveKeyframeParams`（`storyboardPlan.ts:532`） | ⚠️ 部分：8 个档案声明 canonical `aspect_ratio`（接得住，`plannedNodeMeta.ts:163` 校验通过）；13 个只声明像素 `size`、2 个 `ratio`、2 个 `aspectRatio`（接不住 → 诚实丢弃）。**本轮修**：批量条用 `unsupportedFilmDefaultKeys` 把"N 镜的模型不吃整片画幅"说出来。键的翻译见 §6 遗留 |
| 2 | **类型 shotKind（图/视频/图片+视频）** | ✔️ `StoryboardBulkBar.tsx:136` → `applyShotKindToAll` | n/a（逐镜字段，无整片段） | ✔️ 逐镜 `shotKind` + `keyframe.enabled`；**批量 = 写进每一行**，无"继承"概念 | ✔️ `buildShotRowNodes` 按 `shot.shotKind` 分建 image/video 节点 | n/a（决定的是节点种类，不是请求参数） |
| 3 | **模型 modelKey + modelVendor** | ✔️ `StoryboardBulkBar.tsx:145` `BulkModelPicker`（一行 = 模型 × 具体哪一家） | n/a（逐镜字段） | ✔️ 逐镜 `modelKey`/`modelVendor` | ✖️→✔️ **本轮修**：`applyModelToAll` 以前只写 `modelKey`，把 picker 回调的 vendor 丢了 → 落地按 key 反查目录首家 =「选 A 家发去 B 家」。现在成对写 | n/a |
| 4 | **时长 durationSec** | ✔️ `StoryboardBulkBar.tsx:159`（仅非图片档）→ `applyDurationToAll` | n/a（逐镜字段） | ✔️ 逐镜 `durationSec`；图片镜的停留时长不被批量改（`applyDurationToAll` 跳过 image） | ✔️ `storyboardPlan.ts:558` 写 `params.duration`（仅视频镜） | ✔️ 档案 mode 的时长范围钳值（`planResolver.ts:181` `modeDurationRange`） |
| 5 | **片种/模板 profileKey · storyboardProfile** | ✔️ 规划师按 `storyboardLauncher.ts:76` 的指令产出；模板声明含 `aspect`（短剧 9:16 / 自由 16:9） | ✔️ `storyboardPlanSchema.ts:85-86` | n/a（整片级，无行覆盖） | ✖️→✔️ **本轮修**：`profile.aspect` 此前**零消费者**（模板那句"9:16"从来不算数）。现在它进 `planDefaultAspect` 的回退链：`plan.aspectRatio ?? (全镜共同值 ‖ 片种声明)`。**刻意不给没选片种的方案兜底**——`storyboardProfileForKey(undefined)` 会回落 free-form 的 16:9，拿它当默认等于替每份方案硬定横屏 | 同 #1 |
| 6 | **清晰度 / 分辨率 resolution** | ✖️ 无整片入口（逐镜胶囊 `ShotComposerBar.tsx:193` 按档案 `mode.params` derive） | n/a | ✔️ 逐镜 `shot.params.resolution` | ✔️ 随 `resolveShotParams` 的 base 走 | ✔️ 档案声明即出控件、不声明即无 |
| 7 | **风格 style** | ✔️ 风格锚（`carrier:'text'`, `scope:'all'`）= 整片级，每镜常驻 | ✔️ `anchors[]` | ✔️ 逐镜 `anchorIds` 选择性引用 | ✔️ `buildShotPrompt` 拼进 prompt（不是生成参数，是提示词） | n/a |
| 8 | **参考 / 锚定 anchors** | ✔️ 锚本身是整片级资产（定妆卡跨镜复用） | ✔️ `anchors[]` + 逐镜 `anchorIds` / `referenceBindings` | ✔️ 逐镜引用哪几个锚 | ✔️ `buildShotRowNodes` 连参考边；`shotReferenceMetaPatch` 写按槽绑定 | ✔️ 按档案 `mode.slots` 声明渲染/投递；吃不进参考的模式 `omitAnchorReferenceEdges` 诚实跳过 |
| 9 | **首帧模式 keyframe** | ✔️ 批量条「图片+视频」档（#2 的一档）→ `shotKindPatch` | n/a（逐镜 `keyframe.enabled`） | ✔️ 逐镜 | ✔️ 双节点：首帧 image + `first_frame` 边喂视频 | ✔️ 首帧图模型自己的档案；**本轮修**：首帧图此前不带整片画幅 → 首帧与视频画幅可以不一致（首帧被裁/被拉，运动落点从第一帧就偏）。现在走 `resolveKeyframeParams` |
| 10 | **场 scenes** | ✔️ 表内增删改名 | ✔️ `storyboardPlanSchema.ts:81` | ✔️ 逐镜 `sceneId` | n/a（分组语义，不进生成参数） | n/a |
| 11 | **标题 / 剧本来源** | ✔️ | ✔️ `sourceScript*` | n/a | ✔️ 写进 `node.metadata` 溯源 | n/a |

### 2.1 坏掉的格子（本轮全部修掉）

1. **#1 Plan 两格**：`storyboardPlanSchema` 无 `aspectRatio` 键（zod 静默丢）；`storyboardPlanActionInputSchema` 是 `.strict()`（主进程直接拒收）。规划师能设整片画幅的路**结构上不存在**。
2. **#1 Materialize 三条路**：`buildShotRowNodes` / `projectShotNode` / `storyboardPlanToPlanShotInputs` 各自铺 `shot.params`。第三条最阴——策略引擎按"没有画幅"裁决，落画布却按整片默认发，**建议与请求是两份东西**。
3. **#1 Provider 那一格没人说话**：模型接不住时静默丢弃，界面继续把那一镜画成竖的。
4. **#3 Materialize**：批量选模型丢 vendor。
5. **#5 Materialize**：`profile.aspect` 零消费者——片种模板那句"9:16"从来没算过数。
6. **#9 Provider**：首帧图不带整片画幅。

### 2.2 「默认值」的并行读者（单一 owner 必须说清它们各管哪一段）

| 读者 | 它决定什么 | 与本条 owner 的关系 |
|---|---|---|
| `storyboardShotScope.planDefaultAspect` | **整片默认**（本轮 owner） | 第一段：方案层意图 |
| `shot.params.aspect_ratio`（经 `shotAspectOverride`） | **行覆盖** | 第二段：这一镜真的不一样 |
| `storyboardOverrides.overriddenShotFields` + `nodeShotField` | **画布覆写**（在画布上手改过的字段归画布） | 第三段：`projectShotNode` 末尾最后落笔，resolver 不与它争 |
| 档案 `mode.params[].defaultValue`（`plannedNodeMeta.ts:155`） | **模型自己的默认** | 兜底：整片默认为空时故意让键缺席，由它接管 —— 这就是 resolver 的第三段语义"诚实缺席" |
| `STORYBOARD_PROFILES[*].aspect` | **片种模板声明** | 本轮接进 `planDefaultAspect` 的回退链（只在显式选了片种时） |
| `commonShotAspect`（全镜共同值） | **旧 plan 的读时迁移** | 仅当 `plan.aspectRatio` 缺省时生效，优先于片种声明 |

优先级（唯一一条，写在 `storyboardShotScope.ts` 里，不许有第二种读法）：

```
画布覆写 > 行覆盖 > plan.aspectRatio > 全镜共同值 > 片种声明 > 档案默认（键缺席）
```

---

## 3. 不属于这张表的东西（说清边界，免得下次有人往里塞）

`FILM_DEFAULTS` 登记表里今天**只有画幅一条**。类型 / 模型 / 时长的"整片"入口是**批量编辑**
（`apply*ToAll` 把值写进每一行），它们在数据上就是逐镜值、没有第二段作用域。把它们塞进登记表
等于再造一遍 v5 那个"抄进每一行"的老问题——那正是 v6 §2.4.1 要拆掉的东西。

判据：**这个设置在 plan 上有没有自己的字段？** 有 → 进表；没有 → 它就是逐镜值，批量只是一次性命令。

---

## 4. 修法：一个 owner，三条路只准调它

`storyboardAspectScope.ts` → **`storyboardShotScope.ts`**（改名是因为职责从"画幅作用域"变成
"整片级设置作用域"；文件内容仍是同一个 owner 的延续，不是新起一份）。

新增的是**给请求体用的 resolver**，语义只有一条：

```
resolveShotParams(plan, shot) = 行写了的 ?? 整片默认 ?? 什么都不带
```

第三段是关键：整片默认为空时**不编一个值**，参数键干脆缺席，由模型档案默认接管。

- `resolveKeyframeParams` 同语义，作用在首帧图节点上。
- `unsupportedFilmDefaultKeys(plan, shot, controls)`：该模型的 `mode.params` 里没有这个键时报出来，
  界面据此如实说明。判据与执行侧**完全一致**（`buildPlannedNodeMeta` 也按 `control.key` 匹配）。
- 加一条整片级设置 = 在 `FILM_DEFAULTS` 加一行 `{ paramKey, planKey, planValue, shotOverride }`，
  三条路自动跟上。

### 4.1 为什么"清掉继承行的冗余值"不是病灶

先查别人那份研究把 `setPlanDefaultAspect` / `setShotAspectOverride` 的"清值"列进了病灶。实查后判定它是**对的**：
继承是读时算出来的，把默认值抄进每一行就又造回了第二份真相——那正是 v5 的原病。
真正缺的是这一层没有导出请求体那一端的 resolver。**删掉清值 = 用第二份真相掩盖第一份真相缺失**，
症状会消失而根因加倍。

### 4.2 防线建在哪一层（R28）

`check:storyboard-owner` 从"退役投影名"扩成三条机器判据，全部从 `FILM_DEFAULTS` 登记表 derive：

1. 表里每个 `planKey` 都在 `storyboardPlanSchema.ts` **和** `canvasWrite.ts` 里有落脚点（少一个 = 规划师写的值被静默丢）
2. 除 owner / 纯编辑层 / 工具 patch / 逐镜参数 UI 之外，没有文件直接读 `shot.params`
3. 三条落地路径**确实**调到了 resolver（只禁裸铺不够：整段删掉也会"通过"）

变异测试（R17：加规则必须先验它会红）：
- 把 `buildShotRowNodes` 改回 `...(shot.params || {})` → 红（判据 3）
- 从 `storyboardPlanSchema` 删掉 `aspectRatio` → 红（判据 1）

---

## 5. 技能声明结构化默认怎么接进来（不实施，只说插口）

先查别人那份研究的差距表 G7 指出：技能正文今天**管不了画幅，只能劝模型去填**——
全仓没有任何一处把 `SKILL.md` 的正文或 frontmatter 读进生成参数。要让技能真的管住，
插口就是本轮建好的这一层：技能在标准允许的扩展点 `metadata.nomi` 里声明结构化默认
（画幅/时长/片种），建 plan 时由技能层写进 `StoryboardPlan.aspectRatio`（经 `setPlanDefaultAspect`），
**不新增第二条通路**——写进 plan 之后，落画布、写回节点、策略引擎、表格显示四处自动跟上，
技能侧一行落地代码都不需要。这也是为什么本轮坚持把 resolver 做成登记表驱动：
技能将来要声明的"时长/片种"如果也升格成整片级字段，代价就是 `FILM_DEFAULTS` 加一行。

---

## 6. 本轮**没做**的一条，和为什么

**档案的画幅控件键不统一，整片意图只到得了 canonical 那一族。**

实测（`src/config/modelArchetypes/*.ts`）：8 个档案声明 `aspect_ratio`，13 个声明像素 `size`，
2 个 `ratio`，2 个 `aspectRatio`（camelCase，疑似命名漂移）。整片画幅写的是 canonical
`aspect_ratio`，所以在 `size` 那一族（Agnes / Imagen4 / Qwen…）上会被 `plannedNodeMeta.ts:163`
诚实丢弃——用户设了 9:16，那几镜按模型自己的尺寸档走。

不在本轮做，理由是**它需要一个跨进程可共用的 owner，而这一步的落点还没定**：

- 翻译逻辑的现役 owner 是 `nodes/controls/parameterControlModel.ts:571` `videoAspectDefaultPatch`
  （把目标 W:H 与控件选项按 `normalizeAspectRatioToWH` 对齐，对不上就返回 `{}`）——但它在**渲染层**。
- 需要它的第二个读者 `electron/shared/videoCapabilities/planResolver.ts:188` 在 **electron/shared**，
  按边界规则不能 import `src/`。硬接会长出第二份匹配器（正是本轮要消灭的那类）。
- 正确做法是把"什么算 W:H + 目标比例 → 控件取值"搬进中立契约层再让两端 import，
  那是一次独立的边界搬家，需要自己的合同与门岗。

本轮的诚实交付是：**界面如实说出来**（批量条「N 镜的模型不吃整片画幅，按它自己的尺寸或参考图走」），
并由 `storyboardPlanRequestParams.test.ts` 把这条行为钉死（Agnes 那一格断言 `aspect_ratio` 缺席、
`size` 仍是档案默认）——不假装修好，也不让它悄悄消失。

---

## 7. 验收

| 层 | 文件 | 钉住什么 |
|---|---|---|
| resolver 语义 | `src/workbench/generationCanvas/agent/storyboardShotScope.test.ts` | 三段语义、首帧同画幅、片种声明、`unsupportedFilmDefaultKeys`、登记表自洽 |
| 落画布 | `src/workbench/generationCanvas/agent/storyboardPlan.test.ts` | 整份/单行 materialize、图片+视频双节点、诚实缺席、片种、duration 不被挤掉、`parseStoryboardPlan` 留得住 |
| 写回节点 | `src/workbench/creation/storyboard/exec/storyboardProjection.test.ts` | 同一组语义在投影路径上成立 |
| 策略引擎输入 | `src/workbench/generationCanvas/agent/storyboardStrategy.test.ts` | 引擎读到的与发出去的一致 |
| 批量写 vendor | `src/workbench/generationCanvas/agent/storyboardPlanEdits.test.ts` | 模型与厂商成对写、回默认一并清 |
| **请求参数**（档案闸之后） | `src/workbench/generationCanvas/agent/storyboardPlanRequestParams.test.ts` | 接得住的模型真的带上；接不住的诚实丢弃 |
| 机器普查 | `scripts/check-storyboard-owner.mjs` | 登记表 ↔ 两处 schema ↔ 三条路径，变异测试已验会红 |
| 真机走查 | `tests/ux/storyboard-film-aspect-passthrough.walk.mjs` | 真人手势在批量条选 9:16 → 行内生成 → **loopback 出站报文 `aspect_ratio === '9:16'`** |
