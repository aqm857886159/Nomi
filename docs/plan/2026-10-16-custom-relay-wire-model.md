# 自定义中转出图「没有可用通道」：线上模型名只由连接契约决定（2026-10-16；2026-10-24 判据合一）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 线：F-relay（2026-10-16，P0，花钱路径）→ I-relay-1207（2026-10-24，救 #1207 + 判据合一）。
> 根因合同：发送层 [2026-10-16-custom-relay-wire-model.root-cause.json](../fixes/2026-10-16-custom-relay-wire-model.root-cause.json)；目录行层 [2026-10-23-vendor-scoped-model-id.root-cause.json](../fixes/2026-10-23-vendor-scoped-model-id.root-cause.json)（判据按 10-24 合一重写）。
> 方向检查：[direction-checks/2026-10-24-custom-relay-wire-model.md](../engineering/direction-checks/2026-10-24-custom-relay-wire-model.md)（取代 [10-16 那份](../engineering/direction-check-2026-10-16-custom-relay-wire-model.md)，那份早于 #1297）。

## 用户那一刻卡在哪

两位用户（0.23.1，mac + win）用自己接的 OpenAI 兼容中转出图，服务商回「No available channel for model
gpt-image-2-…-text-to-image under group …」。用户原话：「我这个 api 是可以用的，总是这样」「几个 api 都不行」。
他们在中转上配的是 `gpt-image-2` / `gpt-image-2.5-sunburst`，发出去的却是 kie 把文生图 / 改图拆成两个 id 时用的线上名。
认证那一下发的是用户的名字（所以认证过了），真生成时发的是档案名——用户无从排查。

2026-10-24 在 main（#1297 已合、#1207 未合）上用真 App 复测，仍然发错：自建中转配 `gpt-image-2`，文生图出站
`gpt-image-2-text-to-image`、改图 `gpt-image-2-image-to-image`；配 `seedance-2`，节点上摆着「变体 标准 / 快速 / Mini」，点「快速」出站
`bytedance/seedance-2-fast`。

## 根因（复核结论）

链路与 C-intake R1 一致，逐跳复核过：

1. 档案 `mode.modelEnum`（`gptImage2.ts` / `gptImage25.ts` 等）与 `variant.modelKey` 是**内置目录契约**才认的线上名；
2. 渲染层 `archetypeMeta.buildArchetypeInputParams` 末尾无条件把它写进 `archetypeInput.model`；
3. 主进程 `archetypeInput.referenceInputParams` 整包 `Object.assign`，`taskParams.taskTemplateParams` 的 `...refInput` 又盖掉了
   连接名（`extras.model || selected.wireModelKey`）；
4. 2026-09-03 `b463b0b11` 为了让中转的「变体栏」活起来，把中转六个 op 的 model 从 `{{model.modelKey}}` 改成 `{{request.params.model}}`——
   从此每个自建中转都收档案名。0.23.x 带出了这一版。
5. 2026-10-23 #1297 在目录层另立了一份判据「映射模板文本里读 `request.params.model` = 这家接受档案型号名」：第 4 条之后每个自建中转 op
   都读它，于是自建中转的每一行都被判成接受，档案的变体轴、方式型号名原样摆给变体栏、Agent 能力清单和宿主视频候选。

同一个值还从另外四处进来：headless 缺参兜底（`ARCHETYPE_WIRE_DEFAULTS[…].model`）、引擎 B（Agent 付款卡 / 全自动 Run）的
`transportModelId` 与兜底、Agent 参数表里被当成普通参数暴露的 `model`、自定义脚本拿到的 `params.model`。

**类根因**：档案把渠道线上名当成和供应商无关的参数；「发哪个 model 串」与「这一行摆不摆档案型号名」是同一个问题的两个粒度，却各有一份判据
（发送层认 op 声明、目录层扫模板文本），两份对内置家碰巧同答、对自建中转相反；认证与实际报文也不是同一份身份验收。

## 做法

1. **唯一 owner** `electron/shared/modelArchetypes/wireModelIdentity.ts` · `resolveWireModel`：
   - create op 声明了 `wireModel: "archetype-selection"` → 变体 > 模式 modelEnum > 连接名；
   - 否则一律连接名（`modelAlias || modelKey`，与 `{{model.modelKey}}` 同一个表达式）。
   - 声明只写在内置目录契约 op 的定义处（普查测试锁住：内置 op 服务带模式名 / 变体的档案且引用 params.model 就必须声明，非内置一律没有）；借给中转的火山原生报文去掉声明；自建中转、认证生成的映射、手写映射都没有。
2. `taskTemplateParams` 把 owner 的结果**最后**写进 `params.model`：`extras.model`、`archetypeInput.model`、headless 默认、Agent 参数都盖不掉（结构上做不出来）。
3. 删旧：渲染层不再往 `archetypeInput` 写 model；headless 默认表不再带 model；引擎 B 不再自己补 model、执行合同删掉 `transportModelId`；
   Agent 参数表不再把 `model` 当参数暴露。
4. **判据合一（2026-10-24，用户拍板）**：目录层 `electron/catalog/modelNameSource.ts#deriveModelNameSource` 的判据换成发送 owner 的**同一个谓词**
   `operationSelectsArchetypeWireModel(selected.create)`。自建中转（含旧数据里读 `{{request.params.model}}` 的映射）判成 `row`，
   `scopeArchetypeModelNames` 在档案解析口就剥掉变体轴 / 方式型号名 / 基础行——变体栏、Agent 能力清单、宿主视频候选一起好。
   #1207 原先在渲染层变体栏另加的判据（`channelModeReach.ts` 的 `selectsArchetypeWireModel`、`useChannelCreateBody` 带出的字段）因此多余，同提交删掉（P1），
   变体栏回到 main 的三态 fail-open 语义。
5. **一个概念一个家**：#1207 的 `generation.wire-model-identity` 并入 #1297 的 `generation.model-name-source`（名字不变，owner 换成 `resolveWireModel`，
   写接口收齐谓词与目录行判据）；禁用派生：`videoTransportModelIdForPlan`（10-16 删）、`operationReadsArchetypeModel`（10-23 的文本扫描，10-24 删）。
   选「合成一份」不选「上下游各管一段」：两边问的是同一个事实（op 定义处的声明），分成两份正是这次两个答案的来路。
6. 旧数据：见下「旧数据」。

## 旧数据

- 自建中转里 09-03 之后自动生成的参数化映射（`{{request.params.model}}`）：**不改盘**，owner 在发送时给连接名，等于重新派生；
  目录层同一个谓词判它 `row`，界面不再摆档案的变体。今天新接的自建中转落库形状与它逐字相同（同样读 `{{request.params.model}}`、没有声明）。
- 内置家的 curated 映射：启动对账（`reconcileMappings`）按代码版本覆盖，自动带上声明。
- 内置家的兄弟连接（`kie--x` 这种）里与 curated 报文逐字相同的映射：启动时补上声明（能识别为自动生成，重新派生）。
- 用户手写、写死了别的模型名的映射：**不猜不改**，照它写的发——这类映射本次链路不受影响（模型名是字面量）。
  分不清来源又确实发错的，用户会在失败卡上看到上游原话；本次不新增界面文案。
- 不把任何用户的模型名迁成别家的名字。

## 设计卡

改动名：自定义中转线上模型名收口 + 判据合一　　线/负责人：I-relay-1207（接 F-relay 的 #1207）　　类别：[花钱]

| 格 | 结论 | 证据 |
|---|---|---|
| ★0 先查别人 | 不适用：纯 bug 修复（花钱路径上发错型号名），不引入通用能力、不新增自写登记；方向检查 §5 写了 P0 结论（领域映射，无现成库） | 方向检查 §5 |
| ★1 用户怎么用 | 当我在自建中转上配好 `gpt-image-2` / `seedance-2`，在画布 / Agent / MCP 点生成，我想要中转收到的就是我配的名字，以便我配的通道真的被用上。步骤：设置里接中转 → 填模型名 → 认证 → 画布选该模型 → 文生图 / 改图 / 视频 → 中转按该名路由。不做：不新增「按模式映射模型名」的配置界面；不改内置家的模式 / 变体线上名。已知坑：自建中转上「变体栏」随之消失（要快速档就在连接里再配一个 `…-fast`）。真实任务：①自建中转 gpt-image-2 文生图；②同一中转改图（multipart 带参考图）；③自建中转 seedance-2 视频。主指标「出站 model = 连接名」的比例：基线 0/3（main 真 App）→ 目标 3/3，量具 = 真 App 抓包走查（V-relay-wire §1.1 法，证据目录 `docs/evidence/2026-10-24-custom-relay-wire-model/`）+ `electron/catalog/customRelayWireModel.test.ts`（入口 × 形状逐条比报文）；质量指标「摆出来的选项都发得出去」（⑪）：自建中转行变体数 = 0 的比例，量具 = `electron/parity/vendorScopedModelId.matrix.test.ts` 档案解析口 / Agent 能力清单格 + 真 App 节点截图 + 真 MCP 进程读能力清单；护栏「内置 kie / apimart / 火山 / 即梦的模式与变体线上名逐字不变」：量具 = 同一矩阵的内置行格子 + `landingProjectionParity` / `variantResolutionParity` / `archetypeWireDefaults.test.ts` | 逃逸账本 `FB-20261012-custom-relay-wire-model`；样本来源：两位用户反馈的连接形状（OpenAI 兼容中转、内置说明卡落库） |
| ★1b 连带界面 | 画布节点变体栏：自建中转上不再出现（原来出现但切了只会发错名），模式栏照旧；Agent / MCP 能力清单：自建中转行不再列档案变体与别家型号名；失败卡 / Agent 回执文案不变 | 矩阵「Agent 能力清单」格；真 App 截图（中 / 英）；真 MCP `nomi_read models` 原文 |
| ★2 谁说了算 | 概念 `generation.model-name-source`「一行发给供应商的型号名从哪来」（10-24 并入 `generation.wire-model-identity`）→ owner `electron/shared/modelArchetypes/wireModelIdentity.ts#resolveWireModel`，判据只有一个谓词 `operationSelectsArchetypeWireModel`（发送 owner 与目录行判据 `deriveModelNameSource` 共用）；允许消费：`taskParams.taskTemplateParams`（主进程唯一写 `params.model` 处）、目录读出的 `modelNameSource`（渲染层 / Agent 只认结果）。同一事实 1 份（op 定义处的声明）；不靠「东西不见了」猜意图 | `node scripts/door-map.mjs resolveWireModel operationSelectsArchetypeWireModel …`（发送层 53 扇门）、`deriveModelNameSource …`（目录行 26 扇门），门表见两份根因合同；`docs/engineering/concept-owners/generation.model-name-source.json` |
| ★3 一致与复用 | 变体判定复用 `resolveArchetypeVariant`，档案解析复用 `resolveArchetypeForModel`，模式桶复用 `modeTransportFor`，映射选择复用 `selectTaskMapping`（与发送时同一个）；目录行判据不再自写文本扫描，直接调发送 owner 的谓词 | `git grep -n operationSelectsArchetypeWireModel` |
| ★4 全状态 | 无界面新增。能力不可用（自建中转无按模式映射）：变体栏不出现，模式栏照旧（模式决定 taskKind 桶，仍有效）；失败：上游原话透传（不变） | 不适用：无新文案 |
| 5 中途表 | 见下表 | 人工 + 单测 |
| 6 外部数据与失败 | 外部来源：用户中转（OpenAI 兼容）。规范：`doc.newapi.pro` 图像 / 视频端点按 `model` 字段路由渠道；我们的偏差（已修）：发了别家的线上名；失败时用户看到上游原话「No available channel…」，本修复后不再由我们制造这条。盘上旧映射（09-03 以后的参数化形状）不迁移，发送时重新派生 | `electron/catalog/newapiTransport.ts` 头注释；真 App 旧映射夹具 |
| ★7 性能 | 不适用：不新增交互；目录行判据从「整份 op 序列化后找子串」换成读一个字段，只会更便宜；owner 每次请求一次档案查找（与原 `resolveTaskArchetype` 同量级） | — |
| 8 真实条件 | macOS 真 App ✔（隔离资料目录、网络闸只放本机、loopback 假中转、窗口在屏幕外）；英文界面 ✔（中 / 英两轨截图）；Windows：unverified（本轮在 Mac；10-16 的单测在 Windows 跑过）；干净安装：隔离资料目录 ✔；真规模 不适用；**真付费：unverified（待协调用真资料跑最低一档文生图 / 改图各 1 张）** | `docs/evidence/2026-10-24-custom-relay-wire-model/` |
| 拍板图清单 | 不适用：纯 bug 修复——不改布局、元素、文案，只是让一个本不该出现的变体栏不出现 | — |
| ★9 验收与回滚 | 验收：另一条线（待协调指派）按下面「验收清单与反例」逐项核，加协调的最小量真付费抽检；硬门 ⑩（说的=摆的：用户配的模型名 = 出站 model）、⑪（能选到：摆出来的变体都发得出去）由类测试守。回滚：revert 本 PR 的合并提交（无数据迁移落盘，只多了 curated 映射上的声明字段，回滚后被对账覆盖回去） | `## 独立验收`：待协调指派 |

### 功能分类
- [x] 花钱
- [ ] 新界面 / 改交互
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [x] 新增功能 / 性能

「长跑 / 可打断」「大数据量 / 画布 / 长列表」「新增功能 / 性能」是路径推出的下限（改到了 `taskParams.ts`、`productionRunTypes.ts`、`generationCanvas/nodes/controls/` 这些文件），照勾；
本修复不改提交、轮询、取消、扣费流程，不新增交互（见中途表与 ★7）。

### 中途表（状态 × 打断）

本修复只改「请求发出前 model 串怎么取」和「这一行摆不摆档案型号名」，不改提交、轮询、取消与扣费流程；每格与修复前相同，只是发出去的名字对了。

| 状态 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 组装请求（未发） | 看到已停止 · 不扣 · 无回执 | 不扣 · 无回执 | 不扣 · 发送前失败卡 | 不扣 · 节点回空闲 | 幂等键去重 · 只算一次 |
| 已提交、等结果 | 按既有取消语义 · 视上游 · 任务卡 | 后台续等 · 视上游 · 任务卡 | 轮询重试 · 视上游 · 任务卡 | 恢复轮询 · 视上游 · 任务卡 | 幂等键去重 · 只算一次 |
| 上游拒绝（原「无可用通道」） | — | — | — | — | 修复后连接名正确，不再因我们发错名被拒；其他拒绝原话透传 · 不扣（上游拒收） |

### 验收清单与反例（★9）

入口 / 形状 / 边界 / 版本与第一条反例（旧判据必须让矩阵红）在合一提交之前写进了方向检查 §3 与两份根因合同；下表「结果 / 证据」两列是实现线按它自验的结果，验收线只核这份清单。

这一类会从哪些入口、形状、边界、版本回来：

- **入口**：画布节点直发（`canvas-node`）、单镜 Run（`canvas-node-run`）、引擎 B（Agent 付款卡 / 全自动 Run）、headless / MCP、自定义脚本、
  无映射兜底（`noMappingWireModel`）；摆出来的一侧：目录读出（`listModelCatalogModels`）、档案解析口（`resolveArchetypeForModel` / `buildVideoModelCandidates`）、
  Agent 能力清单（`agentModelEntriesFromCatalog`，主进程与渲染层两份清单）。
- **形状**：今天新接的自建中转映射；09-03 以后盘上的参数化映射（`{{request.params.model}}`、无声明）；读 `{{model.modelKey}}` 的映射；写死型号的映射；
  内置 curated 映射（带声明）；内置家的兄弟连接（`kie--x`）。
- **边界**：别名 vs modelKey；节点上残留着切连接前选的变体；模式切换（文生 ↔ 图生 / 改图）；`extras.model` / `archetypeInput.model` 想盖写。
- **版本**：0.23.x 存量连接（不迁移也要发对）。

| 反例（应当发生什么） | 结果 | 证据 |
|---|---|---|
| 把目录行判据换回文本扫描 → 矩阵必须红 | 6 红（531 条里；档案解析口 4 格、「不是内置家的连接一律不接受」1 格、Agent 能力清单 1 格），出站 model 格不红 | `npx vitest run electron/parity/vendorScopedModelId.matrix.test.ts`（旧判据副本跑）；合一后 508/508 |
| 渲染层再往 `archetypeInput` 塞 model / `extras.model` 想盖连接名 → 出站仍是连接名 | owner 最后写 `params.model`，盖不掉 | `electron/catalog/customRelayWireModel.test.ts` 22/22（#1207 修前 14 条里 12 红） |
| 给非内置 op 盖 `wireModel` 声明 / 内置 op 漏盖 | 普查测试红 | `customRelayWireModel.test.ts` 普查段 |
| 自建中转行在两侧能力清单里漏列（格子空转） | 新加的守卫格：两侧都列着 | 矩阵「自建中转的行在两侧清单里都列着」 |
| 盘上旧映射（`{{request.params.model}}`、无声明）不迁移 | 目录行判 `row`；真 App 文生图 / 改图 / 视频出站 = 连接名；跑完盘上映射原样 | 真 App 旧映射夹具（`docs/evidence/2026-10-24-custom-relay-wire-model/outbound.json`） |
| 自建中转节点上出现变体栏 | 不出现（中 / 英） | 真 App 截图（`docs/evidence/2026-10-24-custom-relay-wire-model/*.png`） |
| 自建中转行在 Agent 能力清单里带变体 | 不带 | 真 MCP 进程 `nomi_read`（`docs/evidence/2026-10-24-custom-relay-wire-model/mcp-agent-list.json`） |
| 内置家的模式 / 变体线上名被改动 | 不变 | 矩阵内置行格子、`landingProjectionParity`、`variantResolutionParity`、`archetypeWireDefaults.test.ts` |
| 内置家兄弟连接里用户改过的映射（与 curated 报文对不上、没有声明）和同一行其它模式带声明的映射混用（边角） | 该行仍判 `archetype`，变体栏可能出现一个切了不生效的选项（发连接名，不发错名、不花错钱）——记为残留风险，不在本 PR 修 | 发送层根因合同 `residual_risks` |

## 最小量真付费验收（待协调）

1. 准备一条真实 OpenAI 兼容中转（用户自有或协调提供），上面挂 `gpt-image-2`；在设置里按普通自建中转接入、认证。
2. 画布新建图片节点，选该模型，文生图 1 张（最低清晰度）：核中转后台 / 日志里收到的 `model` = `gpt-image-2`。
3. 连一张参考图改图 1 张：同样核 `model`。
4. 合计 2 次最低档图片调用；视频不跑（报文已由 loopback 单测与真 App 抓包锁住，视频真付费单价高，不值）。
5. 记 `docs/evidence/2026-10-24-custom-relay-wire-model/`，截图自己 Read 过再写进 PR；用户没有自建中转就记 unverified。

## 拍板记录

- 2026-10-24 用户拍板：救 #1207（方案 A，分支并 main，不在 main 上重做）+ 判据合一（目录层判据换成 op 声明谓词；改的是 10-23 方案 A 的判据，用户已同意）。
  F-relay 留下的「自建中转的变体栏去留」随之定为：不保留。
- 仍开着、不在本 PR：自建中转要不要支持「按模式映射模型名」做成用户可配（发送层根因合同 `residual_risks`）。
