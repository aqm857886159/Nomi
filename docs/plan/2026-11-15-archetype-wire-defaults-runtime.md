# 设计卡：档案派生表改成发送时现算 · 删 13 份生成文件、生成脚本、自动同步工作流

> 2026-11-15。前置：#1533（档案单入口 `resolveModelArchetype` / `everyBuiltInArchetype`，`electron/shared/modelArchetypes/entry.ts`）。
> 四类：碰**花钱**（无界面 / Agent / MCP 发起生成时 Run 路的合法参数表、size 比例闸都在发送路上），9 格全填。
> 分三段提交，每段各自是绿的、能单独留下：①默认值表 ②身份表 ③方式表。

## ★0 先查别人（「生成出来再提交的派生表」vs「运行时 / 构建时从源头现算」）

- Go 官方博客《Generating code》（https://go.dev/blog/generate）· `go generate` 是作者手动跑、不在 `go build` 里；生成文件要提交，是因为**拿包的人跑不了生成器** · **确认了**：提交派生文件只在「消费方够不到源头」时才成立。我们当初生成这张表的理由正是「主进程 import 不到档案」——档案搬进 `electron/shared` 之后这个前提没了，提交派生副本就只剩代价（靠机器人 PR 同步，合不进去就漂）。
- Prisma《Generating Prisma Client》（https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client）· 建议在 `postinstall` 或生产构建前跑 `prisma generate`，理由原话「so deployments always use a current client」 · **确认了**：派生物要么在用之前现生成，要么就会和源头不同步；它也没有给出「提交生成物再靠流程同步」这条路。
- Bazel `genrule`（https://bazel.build/reference/be/general）· 生成文件是构建期从源头算出来的输出，不进仓库 · **改了**：我们连构建期都不需要——档案本身就是 TypeScript 数据，主进程和渲染层都直接 import 得到，所以选「发送时现算、按档案对象记住结果」，不另加构建步骤。
- 仓库内先例：`electron/shared/modelArchetypes/modeParams.ts` 的 `modeWhenUnrecorded` 已经把生成脚本的「主模式判据」搬成运行时函数（11-12）；`effectiveModeParams` 早就在发送时从档案现填默认值 · **确认了**：同一份逻辑已经在运行时跑着，生成表是剩下的第二份。

## ★1 用户怎么用

当我让 Agent 或外部工具（MCP）替我发一条 MiniMax H3 Max / 可灵 V4 Flash 视频时，我想它发出去的参数和我自己在画布上选同一个模型点生成的一样，以便同一个模型不会因为谁按的按钮而表现不同。

这一刀创作者**没有可见变化**：模型菜单、方式菜单、参数行、Agent / MCP 工具说明一字不改。唯一的行为变化是主干上已经落后于档案的 4 格（见下表），现在和档案一致。

不做什么：不改档案声明、界面、文案、布局、工具说明；不加门、拦截、提示；不做档 × 方式（下一刀）。

主干已经漂了的格（对照脚本：主干提交着的生成表 vs 今天的档案用原生成脚本新鲜生成，逐格比）：

| 表 | 档案 | 任务种类 | 供应商桶 | 键 | 主干旧值 | 档案值（改后） |
| --- | --- | --- | --- | --- | --- | --- |
| 默认值 | minimax-h3-max | text_to_video | apimart | nsfw_check | （无） | false |
| 默认值 | minimax-h3-max | image_to_video | apimart | nsfw_check | （无） | false |
| 默认值 | kling-v4-flash | text_to_video | * | nsfw_check | （无） | false |
| 默认值 | kling-v4-flash | image_to_video | * | nsfw_check | （无） | false |
| size 比例语义 | — | — | — | — | 0 格差 | — |
| 身份表 | — | — | — | — | 0 格差 | — |
| 方式表 | — | — | — | — | 0 格差 | — |

4 格都是 `nsfw_check`（内容审核开关），不改时长、清晰度、数量、档位，不改花多少钱。

指标：
- 主：档案派生、又提交进仓库当运行时数据读的文件 13 → 0。量具：新结构测试 `electron/shared/modelArchetypes/noCommittedDerivedTables.structure.test.ts`（扫生产代码 import `*.generated` 的读方）。
- 质量：现算 vs 新鲜生成 全目录逐格 0 差（默认值 701 格、比例语义 55 格、身份 132 格、方式 406 格）。量具：一次性对照脚本（不进仓库），留在仓库的是对档案声明的性质断言 + 代表档案手写期望。
- 护栏：请求体快照 `electron/parity/officialWire.bodies.snapshot.json`、`paramsKeysByMode` 矩阵除上表 4 格外 0 行改动。
- 护栏：渲染层首屏不因方式表现算变慢。量具：`pnpm run perf:scenarios -- --measure-only` 模型菜单 / 方式菜单场景前后各 2 次。

### ★1b 连带界面

无。方式表 0 格漂移 = 方式菜单的方式个数、名字不变；身份表 0 格漂移 = 已存模型认出的档案不变。

### ★1c 老用户

这三张表都不进存档，只在发请求 / 认档案 / 校验方式的那一刻读。存着的项目、节点、参数、目录行一个字不变，不写迁移。证据：请求体逐格对照（快照除上表 4 格外不变）；身份、方式两张表现算与主干逐格相同。

## ★2 谁说了算

- 「无界面发送时这个档案 × 任务种类 × 供应商缺参该填什么」「size 键是不是比例语义」「modelKey 认成哪个内置档案」「这个内置档案有哪些方式、各走哪个任务种类」→ 唯一来源：档案声明，经入口目录 `electron/shared/modelArchetypes/` 读。纯推导函数在 `catalogFacts.ts`（只吃传入的档案对象，不碰档案表）；按 id / 身份查找在 `entry.ts`（档案表的唯一读者），按档案对象记住结果（WeakMap），整目录的身份清单首次用时惰性算一次。
- 删的第二份（同段提交）：`electron/catalog/archetypeWireDefaults{,.audio,.image,.image2,.model3d,.video,.video2}.generated.ts`、`archetypeIdentifiers.generated.ts`、`archetypeModes{,.audio,.image,.model3d,.video}.generated.ts`、`scripts/gen-archetype-wire-defaults.ts` + 测试、`.github/workflows/archetype-autosync.yml` + `scripts/archetype-autosync-workflow.node-test.mjs`、`package.json` 的 `gen:archetype-defaults`；`electron/catalog/archetypeIdentity.ts` 里和 `entry.ts` 「逐字对齐、改一处必改两处」的那份匹配规则一起删。

调用方（`git grep -n -E "ARCHETYPE_WIRE_DEFAULTS|ARCHETYPE_SIZE_RATIO_SEMANTIC|archetypeWireDefaults|ARCHETYPE_IDENTIFIER_PATTERNS|ARCHETYPE_MODE_MANIFEST|archetypeIdentifiers|archetypeModes" -- electron src scripts tests .github package.json`，生成文件本身除外）：

| 调用方 | 靠它什么 | 改后 |
| --- | --- | --- |
| `electron/capabilityCore/moduleCatalogBootstrap.ts` | Run 路合法参数表第 ③ 层：档案声明过默认值的键 | 问入口现算；上表 4 格多出 `nsfw_check` 这个合法键，其余逐格同 |
| `electron/catalog/taskParams.ts` | size 别名闸：这个档案这种任务的 size 是不是比例语义 | 问入口现算，逐格同 |
| `electron/catalog/archetypeIdentity.ts`（`customCallDraft.ts`、`capabilityModeManifest.ts` 经它） | modelKey → 内置档案 id | 删私有匹配规则，转问入口（与 `resolveModelArchetype` 同一份三趟匹配），逐格同 |
| `electron/shared/capabilityModeManifest.ts`（主进程 + 渲染层） | 内置档案的方式 id → 任务种类、默认方式 | 问入口现算（按档案对象记住），逐格同；不在模块加载时算全目录 |
| 注释：`apimartAudios.ts`、`volcengineAudios.ts`、`volcengineImages.ts`、`catalogCommit.ts`、`generateParamsE2E.test.ts`、`modeParams.ts`、`wireModelIdentity.ts` | 无 | 改成说现在的事实 |
| 测试 `archetypeWireDefaults.test.ts`、`apimartMediaDocsAlign.test.ts`、`paramsKeysByMode.matrix.test.ts`、`referenceSentWithinInUse.property.test.ts`、`modeParams.test.ts`、`tests/ux/mode-bar.walk.mjs`、`tests/ux/_agentVideoPaid.mjs` | 拿表当对照或夹具 | 改问现算函数（逐条留 / 改 / 删见 PR 正文） |
| 门岗 `check-model-certification-coverage.mjs`（生成文件存在性）、`check-root-cause-contracts.mjs`（注释）、`docs/engineering/concept-owners/catalog.archetype-identifier.json`、`docs/fixes/*` 里点名这些文件的根因合同 | 把生成文件当存在性条目 / 门表 / owner | 条目删；owner 与合同只改指向，不改结论 |

## ★3 一致与复用

以前定过什么：
1. 生成这张表的理由（脚本头注释）：「electron rootDir 隔离，runtime 不能直接 import 档案」——已不成立（档案在 `electron/shared`，#1533 收成单入口）。
2. 09-01「同一 taskKind 多模式的主模式收口」（`docs/fixes/2026-09-01-wire-defaults-mode-collapse.root-cause.json`）——算数，判据原样搬进 `catalogFacts.ts`，一条分支不丢（vendor 桶、defaultModeId 抢占、首个声明、空默认不落桶后回退 `*`）。
3. 原 `check:archetype-defaults` 门改成机器人自动重生成——机器人 PR 按今天的合并规矩合不进去，主干漂了 4 格；这一刀删掉整条同步链，不修它。
4. `docs/engineering/direction-checks/2026-11-12-taskparams.md`——这一刀碰 taskParams 只是换读法（换 / 删，不加分支），提交带 `Direction-Check:`。

三条路：
- 沿原方向修（让机器人 PR 能合进去）：同步链还在，下次改档案还是靠流程追，不选。
- 换做法（构建期生成、不提交）：多一个构建步骤，测试 / tsx 脚本 / vitest 都得先生成，代价大于收益，不选。
- **删掉（选）**：档案本来就 import 得到，发送时现算、按对象记住结果。

## ★4 全状态

不涉及新状态：现算同步、纯函数，无加载 / 失败态；认不出档案 → 与今天相同的回退（空默认、比例闸退回按默认值字面形状猜、身份 null、方式清单 null）。

## 5 中途表

只读推导，无副作用：停 / 关窗 / 断网 / 重启 / 连点都与今天相同。

## 6 外部数据与失败

不涉及外部数据，不调上游。档案声明一字不改。

## ★7 性能

不是新增功能，没有新的用户操作。风险：①无界面发送一次请求里把全目录重算一遍；②渲染层首屏因方式表现算变慢。要求：默认值 / 比例语义 / 方式清单按档案对象 WeakMap 记住，单次请求只算用到的那一个档案；身份清单首次用时惰性算一次（132 格，O(档案数)）；模块加载时不算。量具：`pnpm run perf:scenarios -- --measure-only` 模型菜单 / 方式菜单场景，前后各 2 次，不写基线。

## 8 真实条件

Windows：unverified（纯 TS 推导，无平台分支）；真规模：全目录对照；真付费：0 发——用假上游抓 MiniMax H3 Max 与 Seedance 2.5 的无界面请求体。

## 拍板图清单

不适用：无界面差异（方式表、身份表 0 格漂移为证）。

## ★9 验收与回滚

| # | 反例（改坏什么） | 应该红的测试 |
| --- | --- | --- |
| 1 | 现算函数漏掉某档案某个默认值（跳过一个控件） | `catalogFacts.test.ts` 全目录性质断言「声明了默认值的键一定出现」+ 代表档案手写期望 |
| 2 | 既有值被默认值盖掉（bootstrap / taskParams 兜底顺序反了） | `catalogFacts.test.ts` / 现有 `generateParamsE2E.test.ts` caller-wins 用例 |
| 3 | 供应商专属默认值串到别的供应商（vendorParams 当通用） | `catalogFacts.test.ts`「kling-3.0 apimart 与 kie 的 duration 类型不同」+ 全目录性质断言 |
| 4 | 加回一份 `*.generated.ts` 并在生产代码里读它 | 新结构测试 `noCommittedDerivedTables.structure.test.ts` |
| 5 | 现算函数绕过入口直接读 `builtInCatalog` | `archetypeSingleEntry.structure.test.ts`「入口目录里只有 entry.ts 读档案表」 |
| 6 | size 比例语义对某个档案判反 | `catalogFacts.test.ts` seedance-2.5-apimart / seedream 为真、volcengine-seedream / modelscope-image 无 |
| 7 | 身份匹配丢了变体 modelKey / 改成末段优先 | `archetypeIdentity.test.ts`（现有用例）+ `catalogFacts.test.ts` 变体 modelKey 用例 |
| 8 | 方式清单的任务种类判错 / 漏方式 | `capabilityModeManifest` 现有测试 + `catalogFacts.test.ts` 全目录性质断言 |
| 9 | 请求体在上表 4 格之外变了 | `officialWire.bodies.snapshot.json`、`paramsKeysByMode.matrix.test.ts` |

回滚：单 PR，`git revert <merge>` 即回（恢复生成文件与脚本）；无存量迁移。

## 已知限制 / 下一刀

- 新守卫拦的是「生产代码 import 名字带 `.generated` 的文件」；拦不住手写一份常量表抄档案（那一类由 `archetypeSingleEntry.structure.test.ts` 的「不碰档案表 / 私有副本」部分兜）。
- 档 × 方式的门（下一刀，用户看得见，先出图）。
