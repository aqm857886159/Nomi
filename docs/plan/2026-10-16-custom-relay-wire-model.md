# 自定义中转出图「没有可用通道」：线上模型名只由连接契约决定（2026-10-16）

> 线：F-relay（P0，花钱路径）。根因合同：[2026-10-16-custom-relay-wire-model.root-cause.json](../fixes/2026-10-16-custom-relay-wire-model.root-cause.json)
> 方向检查：[direction-check-2026-10-16-custom-relay-wire-model.md](../engineering/direction-check-2026-10-16-custom-relay-wire-model.md)

## 用户那一刻卡在哪

两位用户（0.23.1，mac + win）用自己接的 OpenAI 兼容中转出图，服务商回「No available channel for model
gpt-image-2-…-text-to-image under group …」。用户原话：「我这个 api 是可以用的，总是这样」「几个 api 都不行」。
他们在中转上配的是 `gpt-image-2` / `gpt-image-2.5-sunburst`，发出去的却是 kie 把文生图 / 改图拆成两个 id 时用的线上名。
认证那一下发的是用户的名字（所以认证过了），真生成时发的是档案名——用户无从排查。

## 根因（复核结论）

链路与 C-intake R1 一致，逐跳复核过：

1. 档案 `mode.modelEnum`（`gptImage2.ts` / `gptImage25.ts` 等）与 `variant.modelKey` 是**内置目录契约**才认的线上名；
2. 渲染层 `archetypeMeta.buildArchetypeInputParams` 末尾无条件把它写进 `archetypeInput.model`；
3. 主进程 `archetypeInput.referenceInputParams` 整包 `Object.assign`，`taskParams.taskTemplateParams` 的 `...refInput` 又盖掉了
   连接名（`extras.model || selected.wireModelKey`）；
4. 2026-09-03 `b463b0b11` 为了让中转的「变体栏」活起来，把中转六个 op 的 model 从 `{{model.modelKey}}` 改成 `{{request.params.model}}`——
   从此每个自建中转都收档案名。0.23.x 带出了这一版。

同一个值还从另外四处进来：headless 缺参兜底（`ARCHETYPE_WIRE_DEFAULTS[…].model`）、引擎 B（Agent 付款卡 / 全自动 Run）的
`transportModelId` 与兜底、Agent 参数表里被当成普通参数暴露的 `model`、自定义脚本拿到的 `params.model`。

**类根因**：档案把渠道线上名当成和供应商无关的参数；「发哪个 model 串」没有一个知道连接契约的 owner，认证与实际报文也不是同一份身份验收。

## 做法

1. **唯一 owner** `electron/shared/modelArchetypes/wireModelIdentity.ts` · `resolveWireModel`：
   - create op 声明了 `wireModel: "archetype-selection"` → 变体 > 模式 modelEnum > 连接名；
   - 否则一律连接名（`modelAlias || modelKey`，与 `{{model.modelKey}}` 同一个表达式）。
   - 声明只写在内置目录契约 op 的定义处（普查测试锁住：内置 op 服务带模式名 / 变体的档案且引用 params.model 就必须声明，非内置一律没有）；借给中转的火山原生报文去掉声明；自建中转、认证生成的映射、手写映射都没有。
2. `taskTemplateParams` 把 owner 的结果**最后**写进 `params.model`：`extras.model`、`archetypeInput.model`、headless 默认、Agent 参数都盖不掉（结构上做不出来）。
3. 删旧：渲染层不再往 `archetypeInput` 写 model；headless 默认表不再带 model；引擎 B 不再自己补 model、执行合同删掉 `transportModelId`；
   Agent 参数表不再把 `model` 当参数暴露。
4. 渲染层「变体栏活不活」改问同一个谓词（op 声明 + 模板引用 params.model），自建中转上不再摆一个按了没用的变体栏。
5. 旧数据：见下「旧数据」。

## 旧数据

- 自建中转里 09-03 之后自动生成的参数化映射（`{{request.params.model}}`）：**不改盘**，owner 在发送时给连接名，等于重新派生。
- 内置家的 curated 映射：启动对账（`reconcileMappings`）按代码版本覆盖，自动带上声明。
- 内置家的兄弟连接（`kie--x` 这种）里与 curated 报文逐字相同的映射：启动时补上声明（能识别为自动生成，重新派生）。
- 用户手写、写死了别的模型名的映射：**不猜不改**，照它写的发——这类映射本次链路不受影响（模型名是字面量）。
  分不清来源又确实发错的，用户会在失败卡上看到上游原话；本次不新增界面文案（见「需要协调拍板」）。
- 不把任何用户的模型名迁成别家的名字。

## 设计卡

改动名：自定义中转线上模型名收口　　线 / 负责人：F-relay　　类别：[花钱]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在自建中转上配好 `gpt-image-2`，在画布 / Agent / MCP 点生成，我想要中转收到的就是 `gpt-image-2`，以便我配的通道真的被用上。步骤：设置里接中转 → 填模型名 → 认证 → 画布选该模型 → 文生图 / 改图 / 视频 → 中转按该名路由。不做：不新增「按模式映射模型名」的配置界面；不改内置家的模式 / 变体线上名。已知坑：自建中转上「变体栏」随之隐藏（09-03 那次接活的是一条没认证过的路）。真实任务：①自建中转 gpt-image-2 文生图；②同一中转改图（chat / multipart 两种协议）；③自建中转 Seedance 视频。主指标：中转收到的 model = 连接名（报文级断言 100%）；护栏：内置 kie / apimart / 火山 / 即梦 的模式与变体线上名逐字不变 | `electron/catalog/customRelayWireModel.test.ts`；逃逸账本 `FB-20261012-custom-relay-wire-model` |
| ★1b 连带界面 | 画布节点变体栏：自建中转上不再出现（原来出现但切了只会发错名）；失败卡 / Agent 回执文案不变 | `channelModeReach.test.ts` |
| ★2 谁说了算 | 概念「这一次请求发到线上的 model 串」→ owner `electron/shared/modelArchetypes/wireModelIdentity.ts#resolveWireModel`，判据谓词 `operationSelectsArchetypeWireModel`；允许消费：`taskParams.taskTemplateParams`（主进程唯一写 `params.model` 处）、渲染层变体栏。同一事实 1 份；不靠「东西不见了」猜意图 | `node scripts/door-map.mjs taskTemplateParams`（5 扇门全部经 owner）；`docs/engineering/concept-owners/generation.wire-model-identity.json` |
| ★3 一致与复用 | 变体判定复用 `resolveArchetypeVariant`，档案解析复用 `resolveArchetypeForModel`，模式桶复用 `modeTransportFor`；不另写第二份 | `git grep resolveWireModel` |
| ★4 全状态 | 无界面新增。能力不可用（自建中转无按模式映射）：变体栏不出现，模式栏照旧（模式决定 taskKind 桶，仍有效）；失败：上游原话透传（不变） | 不适用：无新文案 |
| 5 中途表 | 见下表 | 人工 + 单测 |
| 6 外部数据与失败 | 外部来源：用户中转（OpenAI 兼容）。规范：`doc.newapi.pro` 图像 / 视频端点按 `model` 字段路由渠道；我们的偏差（已修）：发了别家的线上名；失败时用户看到上游原话「No available channel…」，本修复后不再由我们制造这条 | `electron/catalog/newapiTransport.ts` 头注释 |
| ★7 性能 | 不适用：根因明确的花钱路径小修，不新增交互；owner 每次请求一次档案查找（与原 `resolveTaskArchetype` 同量级） | — |
| 8 真实条件 | Windows ✔（单测在 Windows 跑）；英文界面 不适用；真规模 不适用；**真付费：unverified（没有真实中转资源，待协调按下方最小量方案验收）** | `customRelayWireModel.test.ts`（loopback / 纯渲染） |
| 拍板图清单 | 不适用：不新增、不改布局，只是让一个本不该出现的变体栏不出现 | — |
| ★9 验收与回滚 | 验收：另一条线按「最小量真付费验收」跑一遍并核本卡；硬门 ⑩（说的=摆的：用户配的模型名 = 出站 model）由类测试守。回滚：revert 本分支的提交（无数据迁移落盘，只多了 curated 映射上的声明字段，回滚后被对账覆盖回去） | `## 独立验收`：待验收线 |

### 功能分类
- [x] 花钱
- [ ] 新界面 / 改交互
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式
- [ ] 新增功能 / 性能

### 中途表（状态 × 打断）

本修复只改「请求发出前 model 串怎么取」，不改提交、轮询、取消与扣费流程；每格与修复前相同，只是发出去的名字对了。

| 状态 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 组装请求（未发） | 看到已停止 · 不扣 · 无回执 | 不扣 · 无回执 | 不扣 · 发送前失败卡 | 不扣 · 节点回空闲 | 幂等键去重 · 只算一次 |
| 已提交、等结果 | 按既有取消语义 · 视上游 · 任务卡 | 后台续等 · 视上游 · 任务卡 | 轮询重试 · 视上游 · 任务卡 | 恢复轮询 · 视上游 · 任务卡 | 幂等键去重 · 只算一次 |
| 上游拒绝（原「无可用通道」） | — | — | — | — | 修复后连接名正确，不再因我们发错名被拒；其他拒绝原话透传 · 不扣（上游拒收） |

## 最小量真付费验收（待协调）

1. 准备一条真实 OpenAI 兼容中转（用户自有或协调提供），上面挂 `gpt-image-2`；在设置里按普通自建中转接入、认证。
2. 画布新建图片节点，选该模型，文生图 1 张（最低清晰度）：核中转后台 / 日志里收到的 `model` = `gpt-image-2`。
3. 连一张参考图改图 1 张：同样核 `model`。
4. 合计 2 次最低档图片调用；视频不跑（报文已由 loopback 单测锁住，视频真付费单价高，不值）。
5. 记 `docs/evidence/2026-10-16-custom-relay-wire-model/`，截图自己 Read 过再写进 PR。

## 需要协调拍板

见报告 `F-relay.md`「需要协调拍板」一节（自建中转的变体栏去留、按模式映射模型名要不要做成用户可配）。
