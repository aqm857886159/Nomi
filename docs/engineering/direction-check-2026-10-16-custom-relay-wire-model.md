# 方向检查：自定义中转线上模型名被档案名覆盖（2026-10-16）

> 触发：`node scripts/fix-churn.mjs` 命中 `src/workbench/generationCanvas/nodes/controls/`（14 天第 4 个 fix，archetypeMeta / channelModeReach / useChannelCreateBody）
> 与 `electron/audioTaskRunner.ts`（14 天第 5 个 fix）。本刀在这几处**只删和改调用**，行为收口在新的共享 owner 里。
> 来源：应用内反馈两条（0.23.1，mac + win），逃逸账本 `FB-20261012-custom-relay-wire-model`。

### 0. 一句话根因

「发到线上的 model 串」没有一个知道连接契约的 owner：档案的模式 / 变体线上名被当成供应商无关的参数，
任何引用 `{{request.params.model}}` 的模板都会收到它。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 本次反馈（0.23.1 自建中转出图「No available channel」） | `...refInput` 用 `archetypeInput.model` 盖掉连接名 | 线上身份无 owner |
| `b463b0b11`（09-03）中转变体轴接活 | 中转 op 改读 `params.model`，把未认证的档案名引到所有自建中转 | 同上（这刀就是本次的直接成因） |
| 09-26 变体单 owner（`generation-variant-single-owner`） | 宿主与渲染层各自决定变体 | 同族：「发哪个」有多个答案 |
| controls/ 目录近 14 天的 3 个 fix | 模式 / 槽收窄与发送判据不一致 | 同族：UI 判据与发送判据各读各的 |

### 2. 为什么这一类会一直出现

档案层自称「与供应商无关」，却同时携带某一家的线上 id（kie 的拆分名、变体串）。只要这类值以「参数」的身份流动，
就会被任何读参数的模板、任何新入口（headless、Agent、脚本）原样接走；而认证只验「用户的名字能通」，从不验「真用时发的名字」。

铁律落点：⑩ 说的=摆的——用户配的模型名（说的）与出站 model（摆的）不是同一份事实。本次用类测试
`electron/catalog/customRelayWireModel.test.ts` 按入口逐一对比，任一入口不一致即红。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 新接一个带 modelEnum 的档案，自建中转用户立刻撞同一句「无可用通道」 | 在类测试里换任何带 modelEnum 的档案 id |
| Agent / MCP 那条路（引擎 B）即使 UI 修了也照发档案名 | 类测试「引擎 B」两条 |
| 自建中转上的变体栏切了只会发出一个中转不认的名字 | `channelModeReach.test.ts` 自建中转用例 |

### 4. 靶子独立性检查

- 尺子是最终报文（loopback / 纯渲染），不是档案自身的产出；与实现不是同一个函数。
- 09-03 那次的「变体轴」测试断言的是「中转收到变体串」，靶子本身错了（没有任何认证说中转认这个串）；本次改靶子：断言中转收到连接名。

### 5. P0：这是我们独有的吗

「连接契约 + 档案模式 / 变体 → 线上 id」是 Nomi 的领域映射（档案、渠道目录都是我们自己的数据），没有现成库能替代；
模板渲染、HTTP、OpenAI 兼容协议都沿用现有实现，不新写。

### 6. 对比 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无适用的现成方案（领域映射） | — | — | — |
| 补 | 在 `taskTemplateParams` 对中转 vendor 加特例 | 小 | 第 4 个特例；Agent / headless / 脚本照样漏 | 否 |
| 重写（限一个模块） | 新 owner `wireModelIdentity.resolveWireModel`：只有在定义处声明了的内置 op 收档案名，其余一律连接名；参数层最后写入，任何参数盖不掉 | 中（约 300 行生产代码，含删除） | 自建中转失去变体栏（本就没认证过） | **是** |
| 删 | 删掉档案里的线上名 | 内置家的模式 / 变体全坏 | 高 | 否 |

### 7. 用户要权衡的核心

自建中转上「切变体」这个按钮是留着让它去碰运气（可能发出中转不认的名字），还是在没有用户自己配好映射之前不摆出来——本刀按任务书选后者。

## 特征测试清单

- `electron/catalog/customRelayWireModel.test.ts`：修前 11 条红（UI 文生图 / 别名 / 改图三协议 / 视频变体、headless、脚本、引擎 B），内置 kie 正向对照修前修后都绿。
- 既有 `relayConformanceVideoAudio.integration.test.ts` 的「变体轴」组：靶子改为「中转收到连接名」。
