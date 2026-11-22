# 模型能力一处声明（第 1 刀）：Agent 文本请求的协议 / 推理 / 输入从 `model.meta` 读

```
改动名：模型能力一处声明 · 第 1 刀        线/负责人：实现线（Mac）        类别：[其他]（不碰花钱 / 长跑 / 可打断 / 新界面）
```

决策：D-1122-model-meta-declaration（路径乙：声明放 `model.meta`，一处读取；这是四刀里的第 1 刀）。后面三刀（GPT-6 改走 Responses、推理档位、原生音视频）都站在这一刀上，本刀创作者看不出任何变化。

## 先查别人（★0）

- [OpenAI 迁移指南](https://developers.openai.com/api/docs/guides/migrate-to-responses) · Chat Completions 仍受支持，新项目推荐 Responses；从 GPT-5.4 起 Chat 上带工具时 `reasoning_effort` 只能是 `none`；GPT-6 Astra / 6.1 Sol 的工具调用必须走 Responses；推理条目要原样回放（`encrypted_content`） · **确认了**「协议按模型行声明、不按供应商一刀切」：`textProtocol` 落在行上，缺省回落 `vendor.providerKind`；本刀不改任何内置行的协议（GPT-6 两行改协议是第 2 刀）。
- pi-ai 0.85.1 `dist/types.d.ts:722`（`reasoning: boolean`）、`types.d.ts:727`（`thinkingLevelMap`，null = 这一档不支持）、`types.d.ts:728`（`input` 只有 `text | image`）、`types.d.ts:736`（`compat` 按 api 分型） · 推理能力就是 Model 上这三格，档位表由 pi 自己按 `thinkingLevelMap` 过滤 · **确认了**声明直接用 pi 的字段形状，不自写档位表；**改了**「输入」的形状：pi 的 `input` 不收 pdf / audio / video，所以 `inputModalities` 只能是我们自己的字段，图片仍走 `supportsImageInput`。
- pi-ai 0.85.1 `dist/api/openai-responses.js:253`、`dist/api/openai-completions.js:731`、`dist/api/openai-responses-shared.js:92` · 模型 `reasoning: true` 时，**没选档也会改请求**：Responses 发 `reasoning: { effort: off ?? "none" }`，Chat（`supportsReasoningEffort`）发 `reasoning_effort = thinkingLevelMap.off`，系统提示的角色变成 `developer` · **改了**「没选档」的落点：必须在发请求那一步把推理关掉（移植 53f50094e 那一段到 provider 的两个流入口），描述层仍按声明原样给 pi；否则一行声明了推理的模型一上来请求体就变。
- pi-agent-core 0.85.1 `dist/harness/harness.js:286`、`dist/harness/execution/assistant.js:14` · `thinkingLevel` 缺省 `off`，`off` 时不往 provider 传 `reasoning` 选项 · **确认了** Nomi 今天没有选档入口，lane 和单发的 `options.reasoning` 恒为空 → 剥掉推理后请求与今天逐字节一样。
- [APIMart Responses 文档](https://docs.apimart.ai/en/api-reference/texts/openai/responses.md) · 同一个中转同时开 Chat 与 `POST /v1/responses`（Bearer，支持 function calling），文档没写 reasoning 参数 · **确认了**同一中转按模型走不同协议是常态 → 协议必须是行级；推理参数经中转透不透传未验证 → 本刀不给任何内置行加 `reasoning` / `thinkingLevelMap` / `compat`。
- [APIMart 模型列表文档](https://docs.apimart.ai/en/api-reference/texts/models/list.md) · `supported_endpoint_types`、`expand=category` 给出 `capability_tags`（Text / Vision / Audio / Omni…），没有 pdf、没有推理标签，要 Key · **确认了**它以后可作声明初值的免费来源，但本刀不连真供应商；PDF 初值只能从现有名字表转出来。
- [#1370](https://github.com/aqm857886159/Nomi/pull/1370)（已关） · 按模型记协议（协议挂在模型行上，供应商的协议只当默认） · **确认了** `textProtocol` 放在行上、`vendor.providerKind` 与高级区手选协议不动，只当没声明行的默认。
- 仓库现成的一次性数据修正 `electron/catalog/unverifiedUsableMigration.ts`、接线 `electron/catalog/catalogMigrations.ts:144`、备份判据 `electron/catalog/catalogFileAccess.ts:85` · 目录上一枚收据 + 迁移尾巴上跑一次、不升目录版本 · **确认了**已有行的初值修正照抄这个入口，不另写一套。
- 仓库现成的概念登记 `docs/engineering/concept-owners/catalog.model-image-input.json`（`forbidden_derivations` 禁第二份 `VISION_MODEL_RE`）· 由 `scripts/check-concept-owners.mjs` 在 `gates:contracts` 里扫 · **确认了**「运行时不许再读名字表」用同一个登记机制写，不新写扫描器。
- 出口：不涉及：本刀不新增、扩大或挪动任何会挡住人的保护（不拒绝、不加锁、不等待）；没声明的行照今天走。

## ★1 用户怎么用

**当**以后接一个新模型或新中转（内置种子、AI 交的声明卡、创作者自己加模型三个写入口），**我想**只写一份声明，Agent 文本请求走哪条协议、能想多深、能收哪些输入全从这一处读，**以便**后面三刀各改一处声明，不再到运行时按模型名猜。

1. 写入一行文本模型（种子对账 / 声明卡登记 / 接入向导 / 设置页加模型 / 导入包）→ 写入口算一次初值进 `meta`（只补缺的键）；
2. 升级到这一版的老用户：读目录时跑一次数据修正，把同一个初值函数算出来的值写进已有行（目录版本不变）；
3. Agent 对话选模型 → `nomiModelConfigFor` 按行读声明：协议（缺省 = 连接的协议）、推理三格、请求体白名单覆盖；
4. 造 pi 模型 → 声明原样递给 pi；laneHost 算出的可选档 = 声明；
5. 发请求 → 没选档（本刀恒为没选）就把推理关掉再交给 pi 的协议实现，请求里不出现任何推理参数；
6. 带 PDF 附件 → 读 `inputModalities` 判能不能原样发 PDF（openai-compatible 那条协议照旧不发）。

**不做什么**：不改任何内置行的协议、不开推理参数（内置行请求体零差异）；不改 Agent 工具、系统提示、界面；不改图片判断（`supportsImageInput`）和音视频跳过逻辑；不给内置行加 `compat` / `reasoning` / `thinkingLevelMap`；声明卡的卡面上本刀不加声明字段（卡走同一个写入口拿初值，卡自带声明留给后面）。

**已知坑**：①pi 在 `reasoning: true` 时没选档也改请求（★0 第 3 条），所以剥离必须在请求那一步；②`requestBodyOverrides` 在每次写入时按当时的名字重算，别名后改会跟着变；`inputModalities` / `textProtocol` 只补缺，已写过的不重算；③退回旧版后在旧版里新加的行，如果旧版保留了收据，再升级时不会补初值（与 `unverifiedUsableRecovered` 同一个已知边界）——这时那一行走「没声明」= 连接的协议、没有温度覆盖。

**真实任务**：
- A：Agent 对话用内置 APIMart 的文本行（34 行内置文本行全量）带工具聊两轮 → 出网请求与今天逐字节一样；
- B：v0.24.0 / v0.24.1 用户在自建中转上接过 `o1-mini`、`o3-mini`、`kimi-k2-0905-preview`、`moonshot-v1-8k`、`kimi-latest`、`gpt-4o`、`claude-3-5-sonnet`、`gemini-2.5-pro` 等 → 升级后拆镜头单发、流式文本、Agent 对话三条路的请求与升级前一样；
- C：第 2 刀把一行声明成 `textProtocol: 'openai-responses'` → 只改那一行的声明，请求就走 `/responses`。

| 目标 | 信号 | 指标（比例） | 量具 | 基线 → 目标 |
|---|---|---|---|---|
| 内置行创作者无感 | 出网请求逐字节对拍 | 零差异的（调用方 × 行）/ 全部 | `electron/agentLane/modelRequestParity.test.ts` + 金样 `tests/fixtures/model-request-parity/` | 主线录 → 100% |
| 老用户怪癖不丢 | 旧版数据修正后对拍 | 零差异的怪癖行 / 全部怪癖行 | 同上「旧版数据」一组 | 主线录 → 100% |
| 声明真的生效 | 声明行的请求层 + 描述层断言 | 通过的断言 / 全部 | `electron/agentLane/laneModelDeclaration.test.ts` | 主线红 → 本分支绿 |
| 只有一处读法（护栏） | 运行时引用名字表的文件 | 文件数 | `pnpm run check:concept-owners`（`catalog.model-text-declaration`） | 3 → 0 |

### ★1b 连带界面

不适用：本刀不改回执、通知、错误卡、任务列表、Agent 工具与系统提示的任何文字；laneHost 投影里的可选档只对声明了推理的行变化，今天没有一行声明，渲染层也不读这一格。

### ★1c 老用户

- **模型行**：升级读目录时跑一次数据修正（`modelDeclarationDefaultsApplied` 收据，不升目录版本）：用写入口同一个初值函数给每行文本模型补 `inputModalities` / `requestBodyOverrides`（名字表里有就补，没有就什么都不写）；之后三条调用路的请求与升级前一样（证据：`tests/fixtures/old-user-data/text-quirks/` 的 v0.24.0、v0.24.1 两份真实旧版目录，对拍 + 修正测试）。修正抛错 → 不写收据，下次读再跑；修正前留一份带版本号的备份（同 `unverifiedUsableRecovered`）。
- **没声明的行**：协议 = 连接的协议、不推理、不发 PDF、没有覆盖 = 今天对没有怪癖的行的行为。
- **设置**：高级区手选协议（Responses）不变，只当这个连接下没声明行的默认。
- **退回上一版**：新键全可选，旧版读 `meta` 不认识就忽略，仍用它自己的名字表，行为不变；收据是目录顶层的可选键，旧版忽略。
- **删掉的旧东西**：`modelProfiles` 名字表（运行时读法）、`PDF_INPUT_MODEL_RE` 运行时读法、`laneModelConfig` 的遗留注释；名字表里 4 个没人读的字段（`agentSuitability` / `agentNote` / `unreliableToolJson` / `requiresReasoningContentRoundtrip`）随表删，其中回传那条的知识记在下面「留给后面」。

## ★2 谁说了算

- **概念** `catalog.model-text-declaration`（新登记，`docs/engineering/concept-owners/catalog.model-text-declaration.json`）：
  - 唯一读法 `readModelDeclaration`（`electron/catalog/modelDeclaration.ts`）：只认合法形状，坏值当没声明；
  - 唯一写初值 `withModelDeclarationDefaults`（`electron/catalog/modelDeclarationDefaults.ts`）：名字表和 PDF 正则模块私有，只有写入口调用——`applyModelUpsert`（设置页加 / 改、导入包、接入向导、声明卡登记、AI 接入、模型改类型、Antigravity 同步全走它）、`seedBuiltins` 种子对账、一次性数据修正；
  - 允许的读者：`nomiModelConfigFor`（协议、推理三格、覆盖）、`laneDesktopInput`（PDF）。
- **写入方普查**（生产代码里写目录 `models` 的每一处）：建行、改名字的只有两条路——`applyModelUpsert` 漏斗（11 个调用文件：设置页 / 渲染层改动、导入包、接入向导 `serviceCatalog`、声明卡登记、AI 接入 `dispatch`、模型列表对账、改类型、Antigravity 同步、ComfyUI 导入、自定义脚本草稿、冒烟提交）和 `seedBuiltins` 对账；其余直接写的 7 处（`builtinOwnedFields` 摘卡字段、`relayLegacyMigrations` / `relayImageEditMigration` 只碰图片行、`vendorLineageLifecycle` 恢复发布、`vendorValidationInvalidation` 改验证态、`seedBuiltins` 标 legacy、两处删除）都展开原 `meta` 只改别的格子，声明原样留着。Antigravity 同步本刀不改：它照旧写 `supportsPdfInput: false`，经漏斗的初值变成 `inputModalities: []`（退回旧版时旧版还认这一格）。
- **图片分界（有意保留）**：图片 = `supportsImageInput`（主线上非测试代码 8 个文件 19 处读它，含渲染层与 `feedbackCatalog`，另有走查与旧版夹具），其余输入 = `inputModalities`（只收 `pdf` / `audio` / `video`，`text` 恒有不写），两者不重叠；并成一处另开一刀（要迁全部消费方和旧数据）。
- **`requestBodyOverrides`**：类型只收白名单键（今天只有 `temperature: number`、`enable_thinking: boolean`），读法把白名单外的键丢掉，不是任意 JSON 的口子；只有写入时的初值函数写它（每次写入按名字重算），运行时只读。**`enable_thinking` 本质是推理开关，第 3 刀开档位时要把它并进推理声明，不留两个家。**
- **「1」靠什么保持**：别处拿不到原料（名字表与 PDF 正则在初值模块里不导出）+ 使用结果的那一步只认主人给的（`nomiModelConfigFor` 只经 `readModelDeclaration` 读）；登记里把 `PDF_INPUT_MODEL_RE`、`modelSupportsPdfInput`、`getModelProfile`、`applyProfileToRequestBody` 记为禁止再定义，`withModelDeclarationDefaults` 只许写入口引用（`check:concept-owners`）。
- **门表**（`node scripts/door-map.mjs`）：`nomiModelConfigFor` 3 扇（`laneDesktopRuntime`、`serviceLanguageModels`、`textTaskRunner`）；`vendorModelConnection` 2 扇（`textStreamIpc` 预热、自身）；`createNomiModelDescriptor` 2 扇（`laneModelProvider`、`laneLegacyImportLane` 固定配置）；`modelSupportsPdfInput` 1 扇（`laneDesktopInput`）；`getModelProfile` 1 扇（`laneModelProvider`）。
- **不靠「东西不见了」猜意图**：是，没有。

## ★3 一致与复用

- **以前定过**：D-1122-model-meta-declaration（照做）；D-1031-old-users（新字段可选、手选协议不改，照做）；D-1117-data-fix-no-version-bump（照做）；D-1117-principles-level / D-1116-unwritable-first（靠删掉旧读法 + 结构检查证明一处读，照做）；#1370 的「按模型记协议」形状（照做）；#1140 的「没选档 = 不发推理参数」那一段（本刀只取这一段）。
- **三条路**：沿原方向修（再加名字表条目 / 正则）——每接一个模型就改运行时，否；**换做法（声明一处读，名字表降为写入初值）——选**；直接删名字表——老用户 o1 / o3 / kimi-k2 的温度与 `enable_thinking` 会丢、破零差异，否。
- **方向检查（热点命中）**：`scripts/fix-churn.mjs` 的 `findHotspots` 对这一刀改到的文件报 9 处——`electron/agentLane/`（近 14 天 5 个 fix，3 个文件算同一概念）、`electron/ai/`（6 个 fix，2 个文件）、`catalogStore.ts` 与 `types.ts`（各 2 个 fix）、两个概念（Agent 输入媒体引用的原身份、凭据「存了」与「可用」的分层）。这一刀不是再补一刀：它走的是上面「三条路」里的换做法，同提交删掉 `electron/ai/modelProfiles.ts`（连同测试）和运行时对 `PDF_INPUT_MODEL_RE` 的直接读取，不新增分支或特例；`catalogStore.ts` 只把文本行的 meta 过一遍初值函数，`types.ts` 只加一张一次性修正的收据；两个概念各只因一个文件命中——`agentUserContent.ts` 只改了「能不能原样发 PDF」从哪读（名字正则 → 声明），媒体引用的认领没动；`catalogStore.ts` 只在写模型行时过一遍初值函数，凭据分层没动。`catalogStore.ts`、`types.ts` 是文件本身命中，不在「只因目录 / 概念口径命中」的代批例外里，交协调定。提交类型照任务书是 `refactor`，提交说明仍带 `Direction-Check:`，指向方向检查 `docs/engineering/direction-checks/2026-11-22-model-meta-declaration.md`（归类表：命中计数里的 fix 都是别的类）。
- **复用**：pi 的 `reasoning` / `thinkingLevelMap` / `compat` 原样形状；数据修正照 `repairUnverifiedUsable`；结构检查用 `check:concept-owners`；对拍用现有的本机假上游（`tests/fixtures/textTasks/textUpstream.ts`、`tests/agent-runtime/httpFixture.mts`，只加录原始字节一格）和文本任务调用方夹具。
- **名字表每条去处**：

| 名字表条目 | 今天在请求里的效果 | 去处 |
|---|---|---|
| `^(o1\|o3)(-\|$)` 温度只收 1 | 有：`temperature: 1` | 初值 `requestBodyOverrides.temperature = 1` |
| `^kimi-k2` 温度 1 + `enable_thinking: false` | 有：两个键 | 初值 `requestBodyOverrides` 两个键 |
| `^kimi-k2` 要回传 `reasoning_content` | 无（没人读） | 删；知识记进「留给后面」 |
| `^(moonshot-v1\|kimi-latest\|kimi-thinking)` 工具 JSON 不可靠 | 无（没人读） | 删 |
| `agentSuitability` / `agentNote`（gpt-4o/5、claude、gemini、兜底） | 无（没人读） | 删 |
| `PDF_INPUT_MODEL_RE`（claude-3-5 / 3-7 / opus-4 / sonnet-4 / haiku-4、gpt-4o、gpt-4.1、o1、o3、o4-mini、gemini）与显式 `supportsPdfInput` | 有：非 openai-compatible 协议下原样发 PDF | 初值 `inputModalities: ['pdf']`（显式 `false` → `[]`） |

## ★4 全状态

- 空（没声明）：协议 = 连接的协议，不推理，不发 PDF，没有覆盖——与今天对没有怪癖的行一样；
- 成功：照声明组请求；
- 失败（`meta` 里某格形状不对）：读法当那一格没声明，其余照常；
- 加载 / 部分成功 / 取消中 / 过期：不适用：本刀不碰请求的生命周期，取消链不变；
- 能力不可用：不适用：不新增要外部资源才做得了的动作。

## ★9 验收与回滚

**判据（两种没做成的版本都红，保险全绿才算成立）**：
- 声明测试（`electron/agentLane/laneModelDeclaration.test.ts`）：一行挂在 openai-compatible 连接下的模型，`meta` 声明 `textProtocol: 'openai-responses'`、`reasoning: true` + `thinkingLevelMap`、`compat: { sessionAffinityFormat: 'openai-nosession' }`、`inputModalities: ['pdf']`，名字故意撞不上任何名字表；
  - 请求层：发出去的网址是 `…/v1/responses`、鉴权头是 `Bearer <key>`、pi 的 `api` 是 `openai-responses`、PDF 文件块在请求里、compat 管的会话头（有 `x-client-request-id`、没有 `session_id`）；请求里没有 `reasoning` / `reasoning_effort` / `thinking` / `enable_thinking` / `include`，系统提示角色不是 `developer`（Agent lane 一轮 + 单发各断一次）；另两条协议各一次单发：Chat（`compat.supportsReasoningEffort`）与 Anthropic 声明了推理、没选档 → 请求里同样没有推理参数、系统提示还是 system；
  - 描述层：`createNomiModelDescriptor` 造出的 pi 模型 `reasoning: true`、`thinkingLevelMap` 与 `compat` 原样；laneHost 投影的可选档 = pi 对声明算出的那组；
  - 「什么都不做」（主线）跑红、「全部拦下」（运行时一律忽略 `meta`）跑红，日志进报告。主线上 Chat 那一条单发是绿的（主线不读声明 = 不推理），它管的是反例 4。
- 保险（`electron/agentLane/modelRequestParity.test.ts`）：抓在出网那一层（本机假上游收到的原始请求：网址、方法、头里除机器相关的几格之外全部、请求体字节），金样在主线上录（`recordedFrom` 写主线提交）；三个调用方：Agent lane（带工具定义 + 前面一轮助手调用工具的历史）、拆镜头等单发（`textTaskRunner`，真实最全输入的形状：一条用户消息 = 文字 + 读图 3 帧，带温度、上限、不重试；拆镜头真实值是温度 0.2、上限 4000，金样用 0.2 / 1200，形状一样）、`textStreamIpc` 流式（画布文本节点连几张图就发几张，代码里没有张数上限；金样用 3 张代表，每多一张只是多一个同形的图片块）——这两条路都只有一条用户消息，没有工具定义也没有历史，「带工具 + 历史」那组输入只有 Agent lane 走得到；行：82 行 = 全部 34 行内置文本行 + v0.24.0、v0.24.1 真实旧版目录里的 48 行中转文本行（`tests/fixtures/old-user-data/text-quirks/<版本>/{chat,anthropic,responses}`，名字表每一条怪癖、PDF 名单每一族、对照行，跑过数据修正之后；Antigravity 行不经 HTTP，不在这里），PDF 附件另对拍一组；逐行软断言，一次报出所有变了的行。
  - 内置行这一半量不到声明：34 行里没有一行的请求依赖声明（3 行 gemini 撞 PDF 名单，但挂在 openai-compatible 连接下不发 PDF；没有 o1 / o3 / kimi-k2）。「全部拦下」时红的全是旧版数据那一半（58 个调用方 × 行），内置行一行不红——它证的是「内置零差异」，不是「声明生效」。
- 修正测试（`electron/catalog/modelDeclarationOldUser.test.ts`）：两份旧版目录读完后每行的声明值、收据、目录版本不变、别的格子一字不差。
- 读法 / 初值 / 漏斗单测（`electron/catalog/modelDeclaration.test.ts`、`electron/catalog/modelDeclarationFunnel.test.ts`）：白名单丢别的键、键序固定、坏一格只丢那一格；初值按别名算覆盖、显式布尔优先、已声明的 PDF 不重算、改名后覆盖跟着变；修正有收据不跑、幂等；经 `upsertModelCatalogModel` 写的新行带初值。

**反例（改坏 → 红、还原 → 绿；实现线附「反例 → 结果 → 证据」表）**：
1. 读取处忽略 `textProtocol` → 声明测试请求层红；
2. 写死回 `reasoning: false` → 描述层红；
3. PDF 改回名字正则 → 声明测试 PDF 断言红（对拍不红：正则和初值对旧行给的答案一样；`check:concept-owners` 也不红：新起名的内联正则它认不出，这一类靠声明测试拦）；
4. 没选档也发推理参数（删掉剥离）→ 先照字面跑内置行对拍（预期不红：内置行没有一行声明推理，日志留档，说明这条反例在内置行上量不到），再在声明行的请求层断言上红（Responses、Chat、Anthropic 三条都红）；
5. 数据修正漏写一类旧行：a 跳过 `kimi-k2` → 修正测试红、对拍红；b 跳过显式 `supportsPdfInput` → 只有修正测试红（这一类只在 Antigravity 行上，Antigravity 不在对拍里）；c 漏斗不调初值 → 漏斗单测红；
6. 运行时再读一次名字表：a 运行时文件里重新定义 `getModelProfile`、b 运行时调 `withModelDeclarationDefaults` → `check:concept-owners` 红（a 报第二个写口、b 报禁止引用）；限度：换个名字重写一张表它认不出，靠声明测试和对拍兜。

**同类会从哪里回来**：新写入口不调初值 → 写入方普查表 + 初值在 `applyModelUpsert` 漏斗里（所有 upsert 共用）；新的运行时按名字猜 → 结构检查；新协议值 → `readModelDeclaration` 只认三种；旧版数据 → 修正测试；退回再升级 → 收据（已知边界见 ★1 已知坑③）。

**回滚**：revert 本提交；数据修正写进 `meta` 的键旧版忽略，回滚后不用清。

**独立验收**：本刀不属于四类，不强制；验收线编号由协调指派，不与实现线相同。

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [ ] 新增功能 / 性能

## 留给后面（第 2、3 刀）

- `requiresReasoningContentRoundtrip`：名字表里只挂在 `^kimi-k2` 上。第 3 刀开 DeepSeek 推理时，多轮工具要回传 `reasoning_content`，这份知识不能丢。今天这一格没有任何读者，随名字表删掉，记在这里。
- `enable_thinking: false`（`^kimi-k2`）：本刀进 `requestBodyOverrides` 保持请求不变；第 3 刀开档位时并进推理声明（`reasoning` / `thinkingLevelMap` / `compat.thinkingFormat`），不留两个家。
- 内置 DeepSeek / Qwen 等的 `compat` 与档位表：第 3 刀补（本刀没人读、经 APIMart 透不透传未验证，pi 的 compat 没选档时也可能改请求体）。
- 声明卡卡面自带声明字段：本刀卡只经同一个写入口拿初值，卡自带 `textProtocol` / 推理声明留给后面。
- 漏斗里 `meta: raw.meta ?? existing?.meta` 是整份替换：一次 upsert 带着新的 `meta` 进来，行上原有的声明（比如第 2 刀写的 `textProtocol`）会被冲掉，只剩初值函数补回来的那两格。第 2 刀给行写协议前先决定：声明键在漏斗里按键合并，还是要求写入方带全。
