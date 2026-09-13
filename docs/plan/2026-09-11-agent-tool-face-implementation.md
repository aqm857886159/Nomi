# Agent 工具面重做 · 实施方案（两刀）

> 状态：🚧 **PR A 已实现，PR B 进行中**（2026-09-11）
> 分支：PR A `feat/agent-tool-face-single-owner-20260911`（本刀）· PR B `feat/agent-tool-face-20-verbs-20260911`（建在 A 之上）
> 用户 09-11 18:40 拍板（不再问）：① Run 10 个工具从模型面拿掉（Goal 模式宿主编排另起）② `generate` 独立动词 ③ `write_script` 三合一、`look_at_media` 五合一 ④ `delete_from_canvas` 可撤性由证据裁 ⑤ 对外 MCP 面允许「无头宿主」这一种额外差异。
> 两条铁律：**不留任何安全阀门**（错动词只能 `wrong_verb` 拒绝并点名正确动词）；**加新必删旧**（三个注册表最后只剩一个）。

---

## 0. 一页读懂（D6）

**真实摩擦**：用户说「生成一张开场图」，模型面前有四扇能把节点放上画布的门，只有一扇会弹报价卡；而那扇正门的说明书写着 `This host cannot preview or start paid generation`。模型选错门是理性的，用户只看到「AI 坏了」。

**为什么先收 owner 再改动词**：今天同一个工具名的描述在仓库里有三份（注册表 `modelFacingToolRegistry.ts` / harness 清单 `modelToolSurfaceManifest.ts` 的 `intent` / 契约上的 `projections.{pi,mcp}.description`），两份互相否定，没有任何东西会因此报错。先把 owner 收成**一份声明**并让「一份」这件事可被机器证明（PR A），再在这份声明上做 20 动词（PR B）——否则 20 动词写完，下一个按代码层加的契约还会长出第五扇门。

**PR A 要权衡的那一个东西**：本刀**不改动词语义**（名字、schema 保持现状），只收 owner。代价是 PR A 之后模型面暂时仍是 36 个旧名字；收益是 PR A 的 diff 可核（每一处删除都能对应到审计里的一行）。

---

## 先查别人

> R5 / R6 / R29 / R31。本方案不重新调研，**引用三份定稿输入**；每条带出处。

1. **设计正本** [`docs/design/2026-09-11-agent-tool-face-first-principles.md`](../design/2026-09-11-agent-tool-face-first-principles.md)（分支 `design/agent-tool-face-first-principles-20260911`）——20 动词（§5）、一份声明三处派生（§6.1）、`nextAction`+`userSees` 返回信封（§6.2）、逐动词描述原文（§6.3）、58 名→20 动词对照表（§7）、验收（§8）、交付顺序（§8.3）。它的「先查别人」§2 逐条抄了 Anthropic define-tools / writing-tools-for-agents、Claude Code `sdk-tools.d.ts`、pi SDK 0.85.1、Codex `codex-rs`、Cline、Cursor、Gemini CLI `tools.ts:1104`、MCP 规范 2025-06-18。
2. **审计** [`docs/audit/2026-09-11-model-tool-face.md`](../audit/2026-09-11-model-tool-face.md)（分支 `audit/model-tool-face-20260911`）——三个注册表的 file:line（§6.1）、`promptSnippet` 当 `description` 的 20 条（§4.4：`extendedModelTools.ts:22`、`productionModelTools.ts:20`）、24 个幽灵别名（§4.2 末）、`check:tool-face` 九条规则（§6.2）、四条装配期 throw 的落点建议（§8 第 7 条）。题库 `tests/fixtures/tool-selection/2026-09-11-tool-selection-bank.json`（30 条）。
3. **先例** [`docs/research/2026-09-11-agent-tool-face-prior-art/README.md`](../research/2026-09-11-agent-tool-face-prior-art/README.md)（分支 `research/agent-tool-face-prior-art-20260911`）——GitHub MCP `issue_write` 弹表单时返回 `IsError=true` + "STOP — do not call any other tools… do not claim the operation succeeded"（`github.md`），`generate` 照抄；15 条可迁移结论里本刀直接用的是 ⑥（写操作返回值按住模型）、⑫（描述里写「什么时候不要用我」）、⑮（改工具名同时发 `list_changed`）。
4. **关门方案** [`docs/plan/2026-09-11-close-agent-doors.md`](./2026-09-11-close-agent-doors.md) 与 [`.doors.json`](./2026-09-11-close-agent-doors.doors.json)（分支 `plan/close-agent-doors-20260911`）——本刀只用它的门表；画布门 B 是第三刀不动；它的「甲案：错动词静默转正门」被设计正本 §9 推翻（原则 7）。
5. **仓库里已有的**：`electron/shared/agentCapabilities/modelFacingToolRegistry.ts:40`（`collectSpecs` 已有两条装配期不变量，四条新 throw 加在同一位置）；`electron/shared/agentCapabilities/paidBoundary.ts:63`（`projectsToInternalProfile` 是静默过滤，PR A 改成断言）；`scripts/check-model-schema.ts`（身份式棘轮的现成形状，`check:tool-face` 照它写）；`tests/agent-runtime/lane-tool-accuracy.test.mts`（R30 两个数的现役量具，带阳性对照臂）。
6. **依赖里已有的**：pi `ToolDefinition` 三通道 `description / promptSnippet / promptGuidelines`（`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:344-377`）——我们的 `ModelFacingToolSpec` 字段名逐字相同，本刀不另写通道，只把 `promptSnippet` 从「= description」改成「= `describe.does`」。

---

## 1. 现状（PR A 之前，对 `origin/main` af3652e1c 核实）

| 门 | 文件 | 描述字段 | 副作用词表 | 消费者 |
|---|---|---|---|---|
| 1 注册表（36 internal / 16→6 mcp） | `modelFacingToolRegistry.ts` + `document/canvas/timeline/asset/extended/productionModelTools.ts` + 契约文件上的 `*PiDescriptionForAlias` 表 | `description` / `promptSnippet` / `promptGuidelines` | `{mutates,billable,reversal}`（`modelEffectsForCapability` 从契约 `effect/effectClass` 翻译） | lane 目录、MCP 派生适配器、`check:model-schema` |
| 2 契约投影 | 23 个契约的 `projections.{pi,mcp}.description` | `description` | — | `mcpToolDescription`（MCP 描述头）、`isMcpExposable`、`editingPiDescriptors.ts`（死）、`layoutPiDescriptionForAlias`（死） |
| 3 harness 清单（12 个） | `electron/harness/tools/modelToolSurfaceManifest.ts` → `agentToolCatalog.ts` | `intent` | `{sideEffect,risk}` 手写 | `agentChatPolicy.ts`（**#646 后零生产调用者**）、`skillCapability.restrictToolsToSkillCapabilities`（只被 `agentChatPolicy` 调）、`check:model-schema` 的 `internal` profile、4 个测试 |

注册表外的第四个模型可见工具：`electron/agentLane/laneModelRead.mts` 的 `nomi_read`（手写 TypeBox schema，`laneNativeAssembly.mts:103` 装配）。

幽灵别名 24 个（契约声明了 `aliases.pi` / `additionalAliases.pi`，没有任何工具面发布它）：`read_canvas_state`、`set_node_prompt` + 7 个画布 operation、`layout_read/write`、`load_skill`、`author_skill`、生成家族 11 个方法名（`nomi_get_generation_context`、`nomi_operation_create`、`nomi_submit_generation_plan`、`nomi_preview_execution`、`nomi_resolve_generation_plan`、`nomi_request_generation_gate`、`nomi_start_generation`、`nomi_decide_generation_gate`、`nomi_operation_read`、`nomi_cancel_generation`、`nomi_reconcile_generation`）。核实结论：**生成家族 11 个不是幽灵，是 dispatcher 的方法词表错放在 `pi` surface 上**（`generationDispatcher.ts:18-28` 路由表、`paidBoundary.ts` 从 `pi` surface 派生付费边界、`assertPaidBoundaryExternalSurface` 靠它核对外工具）。删掉它们会让付费边界断言退化成恒真——所以处置不是删，是**搬到新 surface `method`**（宿主/dispatcher 方法名，模型永远看不见），`pi` surface 从此只放模型可见的名字。

---

## 2. PR A · 单一 owner（本刀）

### 2.1 范围

**新增**
- `electron/shared/agentCapabilities/verbDeclaration.ts` —— `VerbDeclaration` 类型、四值效果词表 `VerbEffect`、`CONSEQUENCE_BY[effect][nextAction]` 后果句表（全仓只此一份）、派生函数（描述五槽→`description`、`does`→`promptSnippet`、`effect`→`mutates/billable`、`effect`→MCP annotations）、**四条装配期 throw**。
- `electron/shared/agentCapabilities/verbs/{document,canvas,timeline,media,generation,production}Verbs.ts` —— 36+1 条声明（名字与 schema 与现状逐字相同；描述改写成五槽英文；示例 `when` 英文、示例值可保留中文）。
- `electron/shared/agentCapabilities/verbDeclarations.ts` —— **唯一装配入口** `VERB_DECLARATIONS`。
- `scripts/check-tool-face.ts` + `scripts/check-tool-face.node-test.mjs` + `scripts/tool-face-baseline.json` —— 门岗（规则清单以脚本 `RULES` 为准）。
- `electron/shared/agentCapabilities/verbDeclarations.test.ts` —— 四条 throw 的阳性对照（R17）。

**删除（P1）**
- 门 3 整族：`electron/harness/tools/{modelToolSurfaceManifest,agentToolCatalog,editingPiDescriptors,skillDescriptors}.ts` + 两个测试；`electron/harness/agentChatPolicy.ts` + 测试（#646 后死码）；`skillCapability.restrictToolsToSkillCapabilities`。
- 门 2：`CapabilityContract.projections` 字段与 `CapabilityProjectionMetadata` 类型；23 个契约上的 `projections` 块；`layoutPiDescriptionForAlias`。
- 门 1 的散装描述：6 个 `*ModelTools.ts`；契约文件上的 `timelineRead/timelineWrite/exportRead/exportWrite/assetRead/canvasDelete/canvasWrite` 七个 `*PiDescriptionForAlias`。
- `ModelFacingToolEffects` / `modelEffectsForCapability`（`{mutates,billable,reversal}` 词表）；`LANE_CODING_TOOL_EFFECTS` 改成 `Record<name, VerbEffect>`。
- `laneModelRead.mts` 的手写定义（`nomi_read` 进声明，执行那一半留在 `laneNativeAssembly.mts` 绑定）。
- 幽灵别名：`read_canvas_state`→`nomi_canvas_read`；canvas.write 的 `set_node_prompt` 主别名 + 7 个 operation 别名→`nomi_canvas_write` + `[nomi_storyboard_write, nomi_shot_reference_write]`；layout 两个 `pi` 别名删；skill 两个与生成家族 11 个搬到 `method` surface。
- `MCP_LEASE_PROPERTIES.leaseHandle.description` 与 `canvasModelShapes.ts` 五处中文说明改英文（示例值保留中文并标 e.g.）。

**改**
- `modelFacingToolRegistry.ts`：从 `VERB_DECLARATIONS` 派生；`projectsToInternalProfile` 由过滤改断言（内部 profile 见 `spend` 即抛）。
- `modelFacingTools.ts`：`ModelFacingToolSpec` = 声明 + 派生字段；`mcpToolDescription` 从声明派生（不再读 `projections`）。
- `capabilityContract.ts`：`CapabilityProjectionSurface` 加 `"method"`；`paidBoundary.ts` 的宿主独占转换从 `method` surface 派生。
- `laneTools.mts` / `laneDesktopTools.ts` / `laneNativeApproval.ts` / `laneCodingTools.mts` / `laneNativeAssembly.mts`：消费 `effect` 而不是 `effects.*`。
- `scripts/check-model-schema.ts`：去掉 `internal`（清单）profile，`lane` 改名 `internal`；基线只减。
- `package.json`：`check:tool-face` 进 `gates:contracts`。

### 2.2 四条装配期 throw（R28：编译器拦不住的，装配期拦）

| # | 判据 | 先验会红（R17 阳性对照，见 `verbDeclarations.test.ts`） |
|---|---|---|
| A1 一效果一工具 | `effect ∈ {read, reversible_local, spend, irreversible}`，声明上不存在 `operationEffects` 之类按参数分效果的字段；且与契约一致（`read`⟺契约 `effect:"read"`；`spend`⟺契约 `effect:"paid"`；`irreversible`⟹契约 `effectClass:"irreversible"`）；内部 profile 出现 `spend` → 抛 | 把 `nomi_generation_plan` 改成 `spend` → 抛；把 `read_timeline` 改成 `reversible_local` → 抛 |
| A2 描述五槽 | `does/useWhen/notWhen/params` 非空；`does` 一行 ≤120 字符无 `{`；`notWhen` 至少点名一个**别的**已声明动词；描述里出现的 `x_y` 形名字必须能解析（声明的动词名，或本工具 schema 的枚举值） | 删 `notWhen` → 抛；`notWhen` 点名 `nomi_make_video` → 抛 |
| A3 语言统一 | 五槽、`promptGuidelines`、`examples[].when`、schema 字段 `description` 不含 CJK；示例 `arguments` 的值豁免 | `when: "创建一个镜头："` → 抛 |
| A4 不与 paidBoundary 矛盾 | 五槽手写文本里不得出现 `cannot (preview|start|run)…(paid|generation)` / `never generates` 一族措辞（后果句由 `effect × nextAction` 表派生）；`spend` 动词必须在付费边界上，付费边界上的名字不得声明成非 `spend` | 把 `This host cannot preview or start paid generation` 放进 `does` → 抛 |

### 2.3 `check:tool-face` 门岗（规则以 `scripts/check-tool-face.ts` 的 `RULES` 为准）

| ruleId | 判据 | 档 |
|---|---|---|
| `single-description-owner` | `electron/agentLane/**`、`electron/shared/**`、`electron/harness/**` 里不得再出现 `projections:` / `intent:` / `*DescriptionForAlias` / 带 `description` 且带 `parameters|schema` 的工具形状对象（`verbs/` 目录除外） | 硬零 |
| `mcp-transport-catalog` | `electron/capabilityCore/mcp*Catalog*.ts`、`mcpIntegration*Tools.ts`、`mcpProjectSessionTool.ts` 手写的对外工具（PR B §7.2 收编） | 棘轮只减 |
| `mutual-tiebreak` | 同 `effectGroup` 的动词两两之间**双向**点名（D1/D2/D3/D4 四组） | 硬零 |
| `field-descriptions-complete` | 发布 schema 每个字段有 `description` | 棘轮只减（基线 146） |
| `name-convention-uniform` | internal profile 前缀约定唯一（PR B 归零）；mcp profile 必须全 `nomi_` | 棘轮只减 / 硬零 |
| `no-orphan-alias` | 契约 `pi` 别名必须是已声明动词名 | 硬零 |
| `no-tool-outside-declarations` | `electron/agentLane/**` 里 `{ name, description, parameters }` 形状的对象只允许 `nomi_request_tools`（pi tool-search 形状，登记豁免理由） | 硬零 |

每条先验会红：`scripts/check-tool-face.node-test.mjs` 喂假仓库/假声明。

### 2.4 不动项
- 契约层的 `effect` / `effectClass` / `operationEffectClasses` / `requiresPlanReview`（审批闸的判据，`capabilityApprovalPolicy.ts`）——动词的 `effect` 与它**对账**，不替换它。
- 所有 schema 形状、所有工具名（PR B 才改）。
- `laneExtendedDesktopPorts.ts` 的执行路由、`generationTransportAdapters.ts`、`productionPendingSpend.ts`、pi SDK。
- 对外 MCP 手写目录（`mcpToolCatalog.ts` / `mcpGenerationToolCatalog.ts` / `mcpIntegration*`）——PR B §7.2。
- 画布门 B（`applyCanvasToolCall.ts` / `capabilityApplyHandler.ts`）——第三刀。

### 2.5 回滚
单 PR 单 revert。无数据迁移（工具名、schema、契约 id 全部不变；`method` surface 只是别名分类，`resolveCapabilityAlias` 对全部 surface 查）。

### 2.6 验收门
1. `pnpm run gates` 全绿（含新门岗 `check:tool-face`）。
2. `check:tool-face` 先红后绿：在 PR A 首个 commit 之前对 `origin/main` 跑一次留证据（本文档 §4 记数字）。
3. 现有全部 agent/MCP 单测与 loopback 夹具不改语义地通过（`tests/agent-runtime/*`、`electron/capabilityCore/mcp*.test.ts`）。
4. `check:model-schema` 基线只减不增。

---

## 3. PR B · 20 动词（建在 A 之上）

按设计正本 §7 对照表做留/改/删/合并/新增；`draft_shots` 唯一造镜头节点；`generate` 唯一出卡（返回 `isError:true` + nextAction `user_sees_spend_card` + "STOP" 明文）；`arrange_canvas` 收到 `executionKind` 非空的 kind → `wrong_verb` 拒绝并点名 `draft_shots`（判据 `nodes/registry.ts:43`，搬到 `electron/shared/`）；Run 10 个工具下内部 profile（外部面同步，发布说明写 breaking）；`start_production_run` 随之消失；`undo`、`start_model_setup` 新增；描述按 §6.3 原文；`agentContext.ts:45-46` 两句删；外部面差异只允许 `paidBoundary` + `headlessHost` 两种登记在声明里；删除的名字不留别名、不留 deprecated 转发。R30 两条腿（42 句 + 30 句 loopback 进 CI；DeepSeek 便宜档真实跑一轮 ≥90%，数字进 PR B 正文）。根因合同 `docs/fixes/2026-09-11-agent-generation-second-door.root-cause.json`（`recurring`，门表进 `notes`）与代码同 commit。

---

## 4. 证据账本

### 4.1 PR A（2026-09-11）

- **R17 先验会红**：把 `check:tool-face` 的文本规则跑在 `origin/main`（`82d885e49`）的 `electron/{agentLane,shared/agentCapabilities,shared/agentLane,harness}` 树上：**79 处硬命中**（`single-description-owner` 43 / `no-tool-outside-declarations` 36）；声明级规则的阳性对照在 `scripts/check-tool-face.node-test.mjs`（9 条）与 `electron/shared/agentCapabilities/verbDeclarations.test.ts`（A1–A4 逐条先红）。
- **PR A HEAD**：硬规则 0 命中；棘轮初始基线 `field-descriptions-complete=156`、`mcp-transport-catalog=20`、`profile-reason-transitional=23`、`name-convention-uniform=7`（`scripts/tool-face-baseline.json`，PR B 归零对外面与前缀）。
- **`check:model-schema` 基线只减**：120 → 19（去掉的 101 条全是已删 harness 清单 profile 的身份；`profile-schema-drift` 0）。
- 现有 agent/MCP 单测：`electron/{shared/agentCapabilities,capabilityCore,agentLane,harness,skills}` 195 文件 1622 用例全绿；`tests/agent-runtime` node 套件全量 431 条：首轮 425 绿 / 6 红（5 条同一根因——`nomi_read` 进注册表后 `models` 组被 `laneHost` 与原生装配层各注册一次；1 条 `nomi_storyboard_write` 扁平 schema 1207 > 1200 token 预算，英文字段说明比原中文长），两条根因修掉（组名收进叶子模块 `electron/shared/agentLane/laneToolGroupNames.ts`、延迟目录不含原生组；三条字段说明收紧）后受影响的 8 个文件 102/102 绿。
- `pnpm run gates`：首轮 78 门 74 过 / 1 阻断（agent-runtime 测试类型，已修）/ 3 advisory 存量；后续增量各门单独复跑全绿（lint / filesize / boundaries / test-types / i18n / heavy-path / mjs-parse / vocabularies / model-schema / tool-face / mcp-payload / typecheck）。lane 常驻全组预算 9966 / 10000 token。

### 4.2 与 §2.1 的偏差（实施时发现，均记在代码注释里）

- `layout.read/write` 之前没有任何描述符（只有两个幽灵 `pi` 别名 + 契约 `projections`）。删掉 `projections` 后对外 `nomi_layout_*` 就没有描述 owner，所以补了 `verbs/layoutVerbs.ts`：`profiles: []`（不投内部＝无头宿主约束；对外传输今天仍是 `mcpCapabilityProjection.ts` 里手写的 `operation:"read"|"write"`，用过渡理由 `mcpHandwrittenTransport` 登记，PR B 收编成派生）。
- `delete_canvas_nodes` 保持 PR A 之前的 `profiles: ["internal"]`（对外 `nomi_canvas_maintenance` 多一个 `undo_canvas_delete` 分支，是手写传输）；声明成双 profile 会让 `profile-schema-drift` 当场红，那是 PR B 的活。
- `productionRunDescriptors.ts` 的十条 `description` 一并删了（没有任何消费者读它，是第三份文案）；schema 留在原处。
- MCP 描述对「传输手写」的契约（timeline.write / export.* / canvas.delete / layout.*）也从声明派生（`createMcpCapabilityResolver` 改读 `specsForCapability`，不看 profile）——描述的 owner 只有一个，与传输是否派生无关。
- `nomi_read`（模型目录读）进声明 `internalGroup:"models"`，`laneModelRead.mts` 只剩执行绑定；`check:model-schema` 不再单独手写它。

### 4.3 PR B
- R30 loopback / DeepSeek：PR B 正文。
