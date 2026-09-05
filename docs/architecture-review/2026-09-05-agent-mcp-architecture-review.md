# Agent 与 MCP 架构评审 · 五个质疑的证据与改法

> 状态：📋 方案待拍板 · docs-only，本文不改任何生产代码
> 日期：2026-09-05 · 基线 `origin/main = ea54dcea7`（Merge PR #486）
> 用户授权：从底层质疑现有设计。本文对每条质疑只做一件事——**用 `file:line` 证实或推翻**，然后给改法、迁移路径、验收，最后 6 角色评审 + R3 决策对比表。
> 相关：[docs/plan/2026-09-05-nomi-convergence-handoff.md](../plan/2026-09-05-nomi-convergence-handoff.md)（M0–M5 收敛主轴）、[docs/design/nomi-agent-interaction.md](../design/nomi-agent-interaction.md)（交互设计合同）、[docs/ARCHITECTURE-NOW.md](../ARCHITECTURE-NOW.md)

---

## §0 一句话结论

**Nomi 的 Agent 层不缺机制，缺的是「同一件事只有一个说法」。** 同一个能力现在有三套名字（pi / mcp / ui）、两套 schema 语言、两套工具面，而「要不要弹确认」这件事的真相源既不是能力契约也不是用户拍板过的设计，而是一条**按工具名匹配的正则**——它的词表已经跟工具改名脱节了。

**五条质疑不是五个问题，是同一个根因的五种长相。**过去 10 天 177 份根因合同里，凡是碰供应商层的 57 条中有 42 条（74%）的 `class_root` 明写「缺一道统一边界 / 同一不变量有两个作者」——这就是 §1–§5 全部的共同形状。所以**排期应该按「哪一处的第二份真相源最便宜拆掉、拆掉后用户马上有感」排，而不是按「哪一桶 bug 多」排**。

### 五条裁定表

| # | 质疑 | 裁定 | 改法 | 删掉什么 | 风险 | 建议顺序 |
|---|---|---|---|---|---|---|
| 1 | 内部 Agent 与 MCP 是**两张嘴** | **证实（且比假设更重）**：33 vs 24 个工具，名字/粒度/schema 语言三重分叉 | 契约层加 `surface` 单一投影器；两面从同一 descriptor derive | `editingPiDescriptors.ts`、`agentToolCatalog` 的手工分组、`mcpCapabilityProjection` 里手抄的第二份 JSON Schema（约 500 行） | 中：MCP 面是对外契约，改名即破坏已发布客户端 | **③** |
| 2 | 审批机器**过度通用** | **证实，但根因不是「过度通用」而是「分级判据接错了线」**：契约里已声明的 `approval` 字段**零消费者**，真正决定权在一条正则 | `projectAgentExecutionRisk` 改为从 `contract.effect + contract.approval` derive；确认步退掉，**提议事务与撤销保留**（设计文档 §11 列为护城河） | `projectAgentExecutionPolicy.ts:31-36` 的两条正则（6 行，但影响面全局）；`creationTurnController` 那套第二条确认路径 | **低**：设计 §14.2 已拍板同一分级；是让代码追上设计 | **①** |
| 3 | MCP 工具面**按内部机制命名** | **部分证实**：24 个里 9 个动词藏在 `args.operation`/`args.action`/`args.phase`；但 `resources` 通道已开、模板已有一条 | 读侧迁 `resources` + `resourceTemplates`；写侧收成领域动词；补 `outputSchema` / `idempotentHint` | `nomi_read` 的 10 个 target 里至少 6 个（→ resource URI） | 中：同上，对外契约 | **④** |
| 4 | 内部 Agent **每轮失忆** | **部分推翻**：不是失忆，是**有损转述**——Host 把历史拼成中文字符串，只留 user/assistant 文本，工具调用与结果全丢，且无截断 | 让 Host 传结构化 thread（复用 `AgentContextScope.persistent`），保留 tool call/result | `executionPrompt` 的字符串拼装（`projectAgentExecutionHelpers.ts:52-70`） | 低：`persistent` 通道已存在且有测试 | **②** |
| 5 | 接模型主路径顺序（先读文档 vs 先协议探测） | **改法方向证实、改法工作量假设推翻**：探测已建（`modelListProbe.ts`，已解 SPA-200 陷阱），连 MCP 侧的接线函数都写好了——`discoverHttpModels` **全仓零调用点**。读文档也已在 onboarding 侧「下线」，但 certification 侧仍活着（P1 并行版） | 把 `discoverHttpModels` 接进 `nomi_integration`；`unknown_kind` 用人话回问；清掉读文档的并行版 | `providerAdapter/{docsDiscovery,compiler}` 在 onboarding 路径上的残留 | 中：改动小，但它是新用户第一印象 | **⑤（B 线并行，见 §7）** |

### 证据分母：过去 10 天的根因合同

`docs/fixes/` 现有 177 份 schema-v3 合同，最早 `2026-08-27`、最新 `2026-09-05`（R21 落地后 10 天全量）。按 `scope_paths` 归桶：

| 桶（按 `scope_paths` 归） | 命中 | 占 177 |
|---|---:|---:|
| H1 工具目录/能力契约/投影 · H2 Host 审批机器 · H3 MCP 协议面 · H4 常驻壳/上下文 | 13 / 13 / 12 / 12 | 各 7% |
| **H1∪H2∪H3∪H4（Agent/MCP 一族，去重）** | **38** | **21%** |
| H5 模型接入（`ai/onboarding/`、`electron/catalog/`、`providerAdapter/`） | **54** | **31%** |
| 五条合计（去重） | 90 | 51% |

> 读法：一半以上的根因合同落在这五条上。**H5 是单条最大的 bug 源**，但 H1–H4 合起来（38 条）是同一个结构问题的四个切面——修一次能同时压住四桶。
>
> **更重要的一层**（§5.4 逐条读 `class_root` 得出）：H5 那 54 条里落在 `electron/catalog/` + `electron/providerAdapter/` 的 57 条中，只有 **4 条（7%）**真的是「某一家供应商变了、我们没跟上」，**42 条（74%）**的 `class_root` 明写「我们缺一道统一归一化/canonical 边界」「同一不变量有两个作者」。**换句话说：五条质疑背后是同一个根因——「同一件事有第二份真相源」。§1 的两张嘴、§2 的死正则、§3 的双读路径、§4 的两个 threadId、§5 的 71 个 vendor 文件，是它的五种长相。**

---

## §1 两张嘴：内部 Agent 目录 vs MCP 目录

### 1.1 这解决哪个真实摩擦

**大白话**：现在 Nomi 里有两个「工具菜单」。用户在 Nomi 界面里跟 Agent 说话，Agent 看到的是菜单 A；用户在 Codex 里通过 MCP 使唤 Nomi，Codex 看到的是菜单 B。两份菜单**菜名不一样、分量不一样、点菜单子的格式也不一样**——但后厨是同一个。

**具体例子**：用户想让 Agent「读一下画布上有什么」。
- 在 Nomi 里：Agent 调 `nomi_canvas_read`。
- 在 Codex 里：**没有 `nomi_canvas_read` 这个工具**，得调 `nomi_read` 并且传 `target: "canvas"`，还得先有一个 `leaseHandle`。

同一件事，两个名字、两套必填参数。结果是：任何一次能力改动都要改两处；改漏一处，一边好用一边坏——而且坏的那一边**没有编译错误**。

### 1.2 现状（file:line）

两个目录入口：

| 面 | 入口 | 工具数 | schema 语言 | 项目身份 |
|---|---|---:|---|---|
| 内部 Agent（pi） | `electron/harness/tools/agentToolCatalog.ts:36-43` | **33**（`modelToolSurfaceManifest.test.ts:19` 硬断言 `toHaveLength(33)`） | Zod | Host 持有 binding，工具入参**无** `projectId`/`leaseHandle` |
| 外部 MCP | `electron/capabilityCore/mcpToolCatalog.ts:291-305` | **24** | 手写 JSON Schema | 24 个里 14 个必填 `leaseHandle`，先经 `nomi_session_open` |

两面的分叉逐域对照（实测导出，非人工抄写）：

| 域 | 内部 Agent（33） | 外部 MCP（24） | 分叉性质 |
|---|---|---|---|
| document | `nomi_document_read` / `_edit` | 同名 2 个 | **同名不同形**：内部 `documentReadSemanticInputSchema` = `{scope}`（`documentRead.ts:6-10`）；MCP 必填 `[leaseHandle, scope]` |
| canvas | `nomi_canvas_read` / `_plan` / `_edit` / `_maintenance` | `_plan` / `_edit` / `_maintenance` + **读并入 `nomi_read target=canvas`** | **一个能力两个名**（`mcpToolCatalog.ts:26-30`） |
| timeline / media / export | **14 个动词工具**（`read_timeline`、`inspect_timeline_range`、`propose_edit_plan`、`apply_edit_plan`、`undo_timeline_edit`、`get_media`、`inspect_media`、`search_media`、`inspect_source_range`、`read_waveform`、`inspect_export_job`、`verify_render`、`export_timeline`、`cancel_export_job`） | **4 个对象工具**（`nomi_timeline_read` / `_edit` / `nomi_export_job` / `nomi_media_query`） | **14 vs 4 粒度分叉**；内部还多出 `export_timeline` / `cancel_export_job` 两个写，而 MCP 侧明写 "starting and cancelling exports remain Host-only"（`modelToolSurfaceManifest.ts:162`） |
| production run | 10 个动词工具（`get_production_run` … `materialize_production_storyboard`） | 5 个（`nomi_read`×4 target + `nomi_run_start` / `_control` / `nomi_artifact_review` / `nomi_run_gate`） | 粒度分叉；**底层 method 完全一致**（`production.get` / `production.start` / …） |
| generation | **2 个**：`nomi_generation_plan` / `_status`（`modelToolSurfaceManifest.ts:104-123`） | **5 个**：`nomi_operation_plan` / `_preview` / `_gate` / `_execute` / `_control`（`mcpGenerationToolCatalog.ts:68-175`） | **最重的一处**：名字、粒度、schema 语言全不同，两份 schema 各自手写 |
| integration（模型接入） · skills · asset import | 无 · `load_skill` · 无 | `nomi_integration` + `_manage` · 无（走 `resources`/`prompts`） · `nomi_asset_import` | **三处能力缺口互不重叠**：内部 Agent 接不了模型也导不了素材，MCP 客户端载不了技能 |

**为什么会分叉**：能力契约类型里把「面」写死成了三个（`capabilityContract.ts:8`）：

```ts
export type CapabilityProjectionSurface = "pi" | "mcp" | "ui";
```

每个契约给每个面配一个 `aliases[surface]` 和一段 `projections[surface].description`。这一步是对的（一个能力多个投影）。**出问题的是下一步：两个面各自去手写 schema，而不是从同一个 descriptor derive。**最露骨的证据在 `mcpCapabilityProjection.ts:118-136`，注释自己说明了为什么会有第二份：

> Keep the broadcast schema in the small validator subset. The Zod schemas above remain the execution boundary; this projection intentionally avoids `anyOf`/`exclusiveMinimum`, which the shared MCP validator does not implement.

也就是说：**因为 MCP 侧的参数校验器只实现了 JSON Schema 的一个子集**，所以广播出去的 schema 必须手抄一份精简版。这不是设计取舍，是工具链能力不足的代偿——而代偿的代价是一份永远可能漂移的副本。

### 1.3 这类问题为什么反复出现

13 份合同落在这一族。三份代表：`2026-09-02-m2-canvas-document-semantic-surface`（语义面收敛，同 commit 删薄路由；`mcpToolCatalog.ts:32-39` 的注释记录了那次并线相撞）、`2026-09-02-mcp-editing-reachability`（编辑能力在 MCP 面够不着）、`2026-09-05-canonical-storyboard-proposal-transition`（同一操作在两个面上 target 归属不同，见 §2.3）。

共同形状：**改了一边，另一边没跟上，且不会编译失败**。`agentToolCatalog.test.ts` 的 `toHaveLength(33)` 是唯一护栏——它挡得住「数量变了」，挡不住「两边第 7 个工具形状不同了」。

### 1.4 改法

**不建议**「内部 Agent 改吃 MCP 工具面、删掉 harness 目录」——那是把 33 个工具硬塞进 24 个 lease-based 形状，会引入两个新问题：(a) 内部 Agent 被迫为每次调用领租约（Host 本来就持有 binding，纯仪式）；(b) 内部独有的 `load_skill` / `export_timeline` 无处安放。

**建议：单一 descriptor + 双投影器。**`shared/agentCapabilities/<cap>.ts` 保持唯一 Zod schema（已有），新增唯一投影器 `surfaceProjector(descriptor, surface)`：`pi` → Zod 直投（不加 lease）；`mcp` → `zodToJsonSchema` + lease 字段注入 + 校验器子集断言。关键动作：
1. **把 MCP 校验器补齐到能吃 `zodToJsonSchema` 的输出**（`mcpArgValidation.ts` 的 `findUnsupportedSchemaFeatures` 现在是「遇到不支持就抛」，改成「补上实现」）。这一步做完，`mcpCapabilityProjection.ts:121-136` 那 4 段手抄 transport schema 就能删。
2. **timeline/media/export 的 pi 面收成 4 个对象工具**，与 MCP 面同名同形。14→4 是纯删除，且内部 Agent 的 prompt 会显著变短。
3. **generation 面二选一**。两边名字必须统一（`nomi_generation_*` vs `nomi_operation_*` 只能活一个）。推荐留 MCP 的 5 个（粒度对应真实相位：plan / preview / gate / execute / control，付费两相在形状上分家是安全设计，见 `mcpGenerationToolCatalog.ts:136-137` 注释「与 T7 分家（形状约束3）」），内部 2 个塌成的粗粒度反而让模型看不见 gate。
4. **`nomi_canvas_read` 与 `nomi_read target=canvas` 二选一**（与 §3 联动：读侧统一迁 resources 后，两个都退休）。

**删除量估算**：`electron/harness/tools/` 非测试代码 1,059 行，其中 `editingPiDescriptors.ts`(44) 全删、`canvasDescriptors.ts`(471) 与 `documentDescriptors.ts`(86) 的 legacy 分支大部分可删、`agentToolCatalog.ts`(76) 的手工分组塌成一行。`mcpCapabilityProjection.ts` 的手抄 schema 约 120 行可删。**保守估计净删 400–600 行，且删掉的全是「第二份真相」。**

### 1.5 迁移路径与验收

1. **先加门岗，后动代码**（R28）：写一条契约测试断言「同一 capability id 在 pi 面与 mcp 面的必填字段集合，除 `leaseHandle`/`projectId` 外必须相等」。**先验它现在会红**（R17）——按 §1.2 的表它至少在 document/generation 两处红。
2. 补 MCP 校验器 → 删手抄 schema（此步无面变化，零对外风险）。
3. timeline/media/export pi 面收敛（只动内部面，MCP 面不变，零对外风险）。
4. generation 统一命名（**唯一破坏对外契约的一步**，需按 `mcpToolCatalogChanges.ts` 的 `listChanged` 通知走，并在 `docs/integrate-with-your-agent.md` 标改名）。
5. canvas read 二选一（与 §3 同批做）。

**验收**：上述契约测试转绿且 baseline 只减不增；`agentToolCatalog.test.ts:19` 的 33 与 `MCP_TOOL_RESOLVER.list().length` **由同一常量 derive**；R13 真机走查 Nomi 内 Agent 与 Codex MCP 各跑一遍「读画布 → 改第三镜提示词 → 撤销」，对照同一 `projectId` 的 receipt/revision。

---

## §2 审批机器：不是过度通用，是分级判据接错了线

### 2.1 这解决哪个真实摩擦

**大白话**：用户在 Nomi 里跟 Agent 说「把这段文案改顺一点」。这是一个**本地的、点一下 Cmd+Z 就能撤销的、不花一分钱**的编辑。但现在 Agent 每次都要先弹一张确认卡，用户点「批准」，才写进去。

**更离谱的例子**（实测，见 2.2 表）：用户说「撤销刚才那次删除」——**撤销本身也要弹确认**。而 `apply_edit_plan`（真正把剪辑改动落到时间轴上）反而**不弹**。

用户拍板过的设计（`docs/design/nomi-agent-interaction.md:508-516`）写得清清楚楚：`自动批准安全动作` = 「自动读项目、搜索、**创建可撤销草稿**；高风险暂停」，硬闸只有「花钱、发布、删除、账号、外部写入」；`完全允许（本项目）` = 「沙箱内**自动执行可撤销动作**」；`:516`「**完全允许只减少本地、可撤销动作的停顿，不得绕过硬闸**」。连「改完显示什么」都定死了（`:121`：「10 | 写入回执 | **一行** | 「已加 5 个节点 · 撤销」」）。**代码没有做到这个。**

**一处必须先纠正的措辞（诚实边界）**：设计文档的分级轴是「**本地 / 可撤销**」vs「花钱、发布、删除、账号、验证码、外部写入」，**不是「便宜 / 贵」**。全文没有任何一处说「金额小就免确认」——相反 `:39` 把「不显示价格」斥为半诚实反例，`:405` 要求付费卡必须每项单价 + 合计。**所以本节主张的是「本地可撤销的编辑不该弹确认」，不是「便宜的动作不该弹确认」。**任何按金额减免确认的提议都与已拍板设计冲突，本文不提。

**另一处缺口（本文发现）**：`:510` 表头写「默认行为」，但**全文没有一处说明三档策略中哪一档是出厂默认**——拍板时的遗漏，需用户补一句（见 §7）。

### 2.2 现状（file:line）

#### (a) 能力契约里已经声明了三档审批 —— 但**零消费者**

`capabilityContract.ts:4` 定义 `CapabilityApproval = "none" | "proposal" | "human_receipt"`，`:29` 声明 `readonly approval`。全仓 grep `CapabilityApproval|contract.approval|capability.approval` **只命中这两行**——类型定义和字段声明，**没有任何一处读它**。这是「登记在册但没接线」的词表（R14.1「同一语义有几份定义」的对偶）。

20 个契约的声明：

| effect | approval | 能力 |
|---|---|---|
| `read` | `none` | asset.read / canvas.read / document.read / timeline.read / export.read / skill.read / production.run.read / generation.context.read / generation.run.read（9 个） |
| `reversible_write` | **`none`** | **generation.plan**（`generation.ts:34,39`）— **先例：可撤销写已经可以不审批** |
| `reversible_write` | `proposal` | canvas.write / document.write / timeline.write / skill.write / production.run.write / production.artifact.write / generation.control（7 个） |
| `destructive` | `proposal` | canvas.delete / export.write（2 个） |
| **`paid`** | **`human_receipt`** | **generation.gate（1 个，全仓唯一）** |

**注意：全仓只有 1 个能力真的花钱。**其余 19 个要么是读，要么是本地可撤销写，要么是删除。

#### (b) 真正决定「弹不弹」的是一条正则

`electron/projectAgentHost/projectAgentExecutionPolicy.ts:22-37`：

```ts
export function projectAgentExecutionRisk(toolName: string, args?: unknown): ProjectAgentExecutionRisk {
  ...
  const hardGatePattern = /(delete|remove|destroy|export|publish|submit|start|cancel|reconcile|provider|external|production|payment|purchase|credential|account)/;
  if (hardGatePattern.test(normalized) || hardGatePattern.test(operation)) return "hard-gate";

  const safePattern = /(^|[._:-])(append_to_end|insert_at_cursor|replace_selection|document\.write|document_write|canvas\.write|create_canvas_nodes|set_node_prompt|patch_shots|timeline\.write|apply_edit_plan|undo_timeline_edit)([._:-]|$)/;
  if (safePattern.test(normalized) || safePattern.test(operation)) return "safe-reversible";
  return "hard-gate";   // ← 默认全部 hard-gate
}
```

它**不读 capability contract**，只匹配工具名字符串和 `args.operation` 字符串。

#### (c) 实测结果：同一个工具的不同 operation 分档不一致，且与「可撤销」无关

以下是在本 worktree 实跑 `projectAgentExecutionRisk` 的输出（临时探针，已删除）：

| 调用（全部同为 `reversible_write`、全部可撤销） | 实际分档 | 备注 |
|---|---|---|
| `nomi_canvas_edit` op=`create_canvas_nodes` / `set_node_prompt` | `safe-reversible` | ✅ |
| `nomi_canvas_edit` op=`connect_canvas_edges` / `tidy_canvas` | **`hard-gate`** | 同一工具同一 capability，**整理布局也要用户批准** |
| `nomi_canvas_plan` op=`patch_shots` | `safe-reversible` | ✅ |
| `nomi_canvas_plan` op=`propose_storyboard_plan` / `create_staging_reference` / `create_camera_move` / `arrange_storyboard_to_timeline` | **`hard-gate`** | 工具名就叫 plan（提案），却被硬闸 |
| `nomi_canvas_maintenance` op=`undo_canvas_delete` | **`hard-gate`** | **撤销要用户批准** |
| `nomi_document_edit` op=`insert` / `replace` / `append` | **全部 `hard-gate`** | 见下 |
| `propose_edit_plan`（纯预览） | **`hard-gate`** | ↓ 与下一行倒置 |
| `apply_edit_plan`（真写） | `safe-reversible` | **预览被闸、真写放行** |

**`nomi_document_edit` 全档硬闸的根因是死选择器漂移**：`safePattern` 的安全词表里写的是 `append_to_end` / `insert_at_cursor` / `replace_selection` / `document_write`——**那是 M2 语义面改名之前的旧 pi 别名**。改名后模型能看见的唯一文档写工具叫 `nomi_document_edit`，operation 是 `insert`/`replace`/`append`，**一个都对不上**。这正是教训库里那条「死选择器同时造假红和假绿」的第三次复发：报红那处（文档写永远要确认）逼着人看，假绿那处（`apply_edit_plan` 不用确认）能骗很久。

#### (d) 「自动批准安全动作」实际上不省第一次；「编辑选中」编辑不了文档

`projectAgentExecutionPolicy.ts:75-84` 的 `if (normalized.mode === "step" || !safeApprovalGranted) return false` 意味着**每个 turn 的第一次可撤销写永远要用户点一次**。设计 §14.2 说的是「自动读项目、搜索、创建可撤销草稿」——不是「第一次要点、后面才自动」。

同一条正则还被 `projectAgentWorkModeDecision`（:64）复用。实测：`edit-selection` 模式下 `nomi_document_edit` 三个 operation **全部 `allowed=false`**——一个名叫「编辑选中」的模式，无法编辑当前文档。

### 2.3 这类问题为什么反复出现

13 份合同落在 `projectAgentHost/`。最典型的是 `2026-09-05-canonical-storyboard-proposal-transition.root-cause.json`——symptom：批准 `nomi_canvas_plan` 的分镜提案后 Host 工具项停在 `proposal_transition_invalid`、`proposalApprovals` 为空、分镜没落盘；direct_cause：canvas-write 适配器准备的 proposal 带 canvas target，而排队的创作轮次锚在 document target，`proposal.put` 比对后在原子写入前拒绝。

翻译成人话：**用户在「创作」页面让 Agent 排分镜。分镜落在画布上（canvas），但这一轮对话从文档页面发起（document）。审批账本要求 target 一致，于是整件事被拒——用户点了批准，什么都没发生。**

这个 bug 的存在完全取决于「排一个分镜需要一次**用户确认**、并因此在 Host 队列账本里登记一条跨面 proposal」。如果分镜提案走的是「直写 + 撤销回执」，这个 target 一致性检查根本不会被触发。**确认门越通用，它能拒绝的合法路径就越多。**

**这个 bug 今天（2026-09-05）已经修了，而修法本身就是最好的度量。**`docs/plan/2026-09-05-proposal-transition-table.md`（✅ 已交付，已在 `origin/main`）把 (来源域 × 目标域 × 状态 × 动作) 做成显式数据表，reducer 只查表。域轴的规模是 **8×8 = 64 格**：8 格同名放行、**1 格 `document → canvas` 显式关闭**（`host_anchor_required`）、**其余 55 格「表中无」**（`cross_domain_admission_absent`）。

这个修法是对的（可诊断性 + 编译器拦新域），本文不主张回退。但它精确回答了「审批机器有多通用」：**一个 64 格的跨域准入矩阵，服务于 20 个 capability，而其中只有 1 个真的花钱。**§2.4 的改法与这张表不冲突——把可撤销写从「需要确认」降到「直写 + 回执」后，走进这张表的 turn 变少，表本身继续为付费门与 production 写服务。

**还有第二条确认路径。**设计文档 §11 拆迁清单 `:419`：「`creationTurnController` 那套单独确认路径 | 生成区是『提议事务 + 对账』、创作区是『简单确认』，**同一件事两套写法**」；§2.1 现状诊断 `:56`：「**审批** | **没有词表** —— 靠 `pendingToolCalls[]` + `committedProposal` + `deviationReport` + `contentDeviations` 四个独立 state 拼」。**「审批」这件事本身也是「两张嘴 + 四份状态」——与 §1 同形。**

### 2.4 改法：让代码追上已经拍板的设计

不是加新机制，是**把死掉的 `contract.approval` 接上线，把正则退休**。

```ts
function executionRisk(toolName: string): ExecutionRisk {          // 替换正则
  const c = resolveCapabilityAlias(toolName)?.contract
  if (!c) return "hard-gate"                                        // 未知能力仍 fail-closed
  if (c.effect === "read") return "read"
  if (c.effect === "paid" || c.effect === "destructive") return "hard-gate"
  return c.approval === "none" ? "auto" : "safe-reversible"          // reversible_write 按契约分档
}
```

配套四件：

1. **把 `canvas.write` / `document.write` / `timeline.write` 的 `approval` 从 `proposal` 改成 `none`**（三行 diff），并**同 commit 补写入回执**：这三个能力的每次写落一条 `undoToken`，对话流里显示设计文档 `:121` 已经定死的那一行「已加 5 个节点 · 撤销」。`canvas.delete` 已有 `undoToken` 机制（`nomi_canvas_maintenance` op=`undo_canvas_delete`），是现成模板。
2. **提议事务本身不动。**设计文档 §11 `:427-429` 把「**提议事务 + 整批撤销**（`proposalTxn` / `proposalUndo`）」和「对账偏差（`reconcile`）」列为**留着别碰的护城河**——「AI Elements 与所有竞品都没有」。本节要退的是**用户确认这一步**，不是事务与撤销这套机制。**没有事务就没有整批撤销，去掉事务等于毁护城河。**
3. **保留 `proposal` 确认档**给 `production.run.write` / `production.artifact.write` / `skill.write`——这些写会引出后续花费或改变技能定义，用户该看一眼。
4. **`generation.gate` 的 `human_receipt` 一行不碰**（MAC / fail-closed / 收据落账全部原地）；`creationTurnController` 那条第二确认路径同 commit 删（P1）。

### 2.5 状态空间缩多少

现在每个可撤销写要穿过 `proposal → preview → gate → execute → receipt → revision CAS → reconcile`，并在 `proposal.put` 处经过 §2.3 那张 64 格的跨域准入表。`projectAgentHost/` 共 48 个非测试文件、22,318 行，其中 7 个文件（`ProposalReceiptStore` 465 行、`ProposalPersistence` 148、`ProposalReceiptCorrelation`、`ReceiptResolver`、`ProvenanceValidation`、`TrustedDeltaCoverage`、`TrustedStateValidation` 178）直接服务于 proposal/receipt 生命周期。

**保守估计：三个能力从「7 相」降到「事务 + 撤销」两相。**这不删任何文件——付费门与 production 写仍走全套，事务与撤销是护城河——但去掉的是**跨面确认这一相**：`persistApprovedProposal` 不再需要在 canvas target 与 document queue target 之间做一致性裁决，`2026-09-05-canonical-storyboard-proposal-transition` 那一类 bug 的触发面直接归零。

诚实标注：**我没有真实的 turn 类型分布数据**，说不出「多少百分比的 turn 会受益」。可量化的只有两条：(a) §2.2(c) 表里 10 处分档错误全部消失；(b) 依赖 `approvalPolicy` 与 `humanApproval` 的 Host 状态转移分支数会减少——这个数字要在动手时用 `projectAgentReducer.ts` 的分支覆盖率量，本文不预先编。

### 2.6 迁移路径与验收

1. **第一步只做「让正则不再撒谎」**：把 `executionRisk` 换成契约 derive，**但先保持所有 `approval` 字段不变**。结果：`nomi_document_edit` / `tidy_canvas` / `undo_canvas_delete` 从「硬闸」变成「safe-reversible」（仍走 proposal，但 `safe-auto` 策略下可复用批准）。这一步**只减少不一致，不减少确认**，风险最低。
2. **第二步做 undo barrier**：三个能力的写落 `undoToken` + 对话流行内撤销条。**先出样张、用户拍板**（R8，这是用户可见改动）。
3. **第三步才把 `approval` 改成 `none`**，并同 commit 删 `projectAgentMayReuseSafeApproval` 的 `!safeApprovalGranted` 短路（P1：不留并行版）。
4. 全程门岗：`check:vocabularies` 登记 `CapabilityApproval` 为语义 owner；加一条测试断言「`projectAgentExecutionRisk` 的结果必须能由 `contract` 单独推出」——**先验它现在会红**（按 §2.2(c) 至少 10 处红）。

**验收**：探针表（§2.2c）13 行全部转成「分档 == 契约推导值」；R13 走查 J2「改一段文案」从「弹卡 → 点批准 → 写入」变成「写入 → 行内撤销条」且 Cmd+Z 与撤销条同源；付费路径回归（`nomi_operation_gate` 两相、receipt MAC、replay 幂等）一条不少。

---

## §3 MCP 工具面按内部机制命名

### 3.1 这解决哪个真实摩擦

**大白话**：Codex 里的模型看到一个叫 `nomi_read` 的工具，描述是「按 target 读取只读投影」。它得先猜 target 该填 `canvas` 还是 `projects` 还是 `generation_context`，猜错了就报错重来。而 MCP 协议本来就有一个专门放「可读的东西」的地方叫 **resources**——那里的东西是列出来给宿主看的，宿主可以直接把它塞进上下文，模型根本不用「调用」。

**具体例子**：用户在 Codex 说「看看我这个项目的分镜」。现在的路径是：`nomi_session_open` 领租约 → `nomi_read{target:"canvas", leaseHandle}` → 拿到 JSON。理想路径是：宿主 `resources/list` 就已经列出了 `nomi://project/{id}/storyboard`，用户 @ 一下就带进去了，**零工具调用**。

### 3.2 现状：24 个工具的动词位置

| # | 工具 | 动词在哪 | 子操作枚举 | 只读标注 |
|---:|---|---|---|---|
| 1 | `nomi_session_open` | 名字里 | — | |
| 2 | `nomi_read` | **`args.target`** | canvas / projects / models / generation_context / operation / run / run_events / artifact / artifact_content / integration（**10**） | `readOnlyHint` |
| 3 | `nomi_canvas_edit` | **`args.operation`** | set_node_prompt / create_canvas_nodes / connect_canvas_edges / tidy_canvas / propose_storyboard_plan / patch_shots / arrange_storyboard_to_timeline / create_staging_reference / create_camera_move（**9**） | |
| 4 | `nomi_asset_import` | 名字里 | — | |
| 5–9 | `nomi_operation_plan` / `_preview` / `_gate` / `_execute` / `_control` | 名字里，但 #5 靠**有无 `operationId` 隐式分叉** create/patch；#7 靠 `args.phase`；#9 靠 `args.action` | phase: request/decide；action: cancel/reconcile | #6 `readOnlyHint` |
| 10 | `nomi_run_start` | 名字里 | — | |
| 11 | `nomi_run_control` | **`args.action`** | pause / resume / cancel / set_trust | |
| 12 | `nomi_artifact_review` | **`args.action`** | approve / request_changes / reject / revise | |
| 13 | `nomi_run_gate` | **`args.action`** | decide / materialize | |
| 14 | `nomi_integration` | **`args.action`** | begin / open_credentials / propose / confirm / start / cancel（**6**） | |
| 15 | `nomi_integration_manage` | **`args.action`** | update_vendor / delete_vendor / delete_model / set_proxy | |
| 16 | `nomi_project_create` | 名字里 | — | |
| 17 | `nomi_canvas_plan` | **`args.operation`** | 与 #3 **完全相同的 9 个** | |
| 18 | `nomi_canvas_maintenance` | **`args.operation`** | delete_canvas_nodes / undo_canvas_delete | `destructiveHint` |
| 19–20 | `nomi_document_read` / `_edit` | **`args.scope`** / **`args.operation`** | full/selection；insert/replace/append | |
| 21–22 | `nomi_timeline_read` / `_edit` | **`args.operation`** | read/range；preview/apply/undo | #21 `readOnlyHint` |
| 23–24 | `nomi_export_job` / `nomi_media_query` | **`args.operation`** | status/verify；list/get/inspect/search/source_range/waveform（**6**） | 均 `readOnlyHint` |

**统计**：24 个工具里 **15 个**的真实动词藏在参数里；`nomi_read` 一个工具背了 10 个读；`nomi_canvas_edit` 与 `nomi_canvas_plan` **共用完全相同的 9 个 operation 枚举**（同一份 `canvasWriteSemanticInputSchema`）、对应同一个 capability `canvas.write`——模型无法从名字判断该用哪个。三个「闸门」是 `nomi_operation_gate`（付费两相）/ `nomi_run_gate`（创意门 + materialize）/ `nomi_artifact_review`（版本审阅）；三个「画布写」是 `_edit` / `_plan` / `_maintenance`。

### 3.3 对照 MCP 规范（Context7 · spec 2025-11-25）

已实查 `modelcontextprotocol.io/specification/2025-11-25`：

| 规范提供的 | Nomi 现状 |
|---|---|
| `resources` capability，可带 `subscribe` / `listChanged` | `mcpProtocol.ts:361` 声明 `resources: {}` —— **两个可选项都没开** |
| `resources/templates/list` + URI 模板 + 参数自动补全 | `:668-678` **只有 1 条模板**：`nomi://project/{projectId}/run/{runId}/artifact/{artifactId}` |
| `resources/list` 列出可读实体 | `:652-666` 只列 **技能库 + 一个 widget HTML**，**不列任何项目状态** |
| ToolAnnotations 四个：`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint` | 只用了前两个。`nomi_operation_execute` 明确是 replay 幂等（`mcpGenerationToolCatalog.ts:140`）却**没有 `idempotentHint`** |
| Tool 支持 `outputSchema` | `:374` 只投 `{name, title, description, inputSchema, annotations, _meta}` —— **24 个工具零 outputSchema**，尽管 capability 契约里每个都有 Zod `outputSchema` |
| user interaction model：human-in-the-loop、明确用户确认 | ✅ Nomi 比规范要求更严（付费门带 MAC 收据） |

**关键发现**：`nomi://project/{projectId}/run/{runId}/artifact/{artifactId}` 这条 resource 模板与 `nomi_read{target:"artifact_content"}` **是同一份数据的两条路**。读侧的双路径已经存在——不是要新造，是要**收敛到一条**。

### 3.4 候选表：读改 resources、写收成领域动词

**读侧 → resources**（`nomi_read` 的 10 个 target 里 6 个可迁）：`projects` → `nomi://projects`；`models` → `nomi://models`；`canvas` → `nomi://project/{projectId}/canvas`；`run` → `nomi://project/{projectId}/run/{runId}`；`artifact`/`artifact_content` → `nomi://project/{projectId}/run/{runId}/artifact/{artifactId}`（**已存在**）；`integration` → `nomi://integration/{sessionId}`。

**留作工具的 4 个**：`generation_context` / `operation`（与租约态强绑定、是 plan 循环的一环）、`run_events`（长轮询 `waitMs` ≤25s 不适合 resource 语义，或改走 `resources` 的 `subscribe`）。

**写侧 → 领域动词**（把 `args.operation` 提到名字上）：

| 现状 | 候选 |
|---|---|
| `nomi_canvas_edit` + `nomi_canvas_plan`（9 个共享 operation，两个工具名） | 按用户任务分两组：画布编辑（`add_nodes`/`connect`/`set_prompt`/`tidy`）与分镜（`storyboard_propose`/`patch_shots`/`to_timeline`/`staging_reference`/`camera_move`）；**不是拆成 9 个**（见 §6 设计角色第 2 条） |
| `nomi_document_edit{operation}` / `nomi_timeline_edit{operation}` / `nomi_run_control{action}` | 各自把 operation 提到名字上（`_insert`/`_replace_selection`/`_append`；`_preview`/`_apply`/`_undo`；`_pause`/`_resume`/`_cancel`/`_set_trust`） |
| `nomi_operation_gate{phase}` · `nomi_integration{action}` | **不拆**：付费两相是刻意的相位约束（`mcpGenerationToolCatalog.ts:110-111`）、接入是有序状态机；拆开会诱导「只做一半」和乱序调用 |

**判据（不是「全拆」）**：`args.operation` 只在**枚举分支之间没有顺序依赖、且各自可独立成立**时才该提到名字上。付费两相与接入状态机是有序的，保持折叠是对的。

> **待补**：另一位 agent 正在以真实宿主身份实测这 24 个工具（结论将写在 `scratchpad/mcp-host-probe.md`）。截至本文完稿该文件尚未生成，**上表的「模型会不会用错」是从 schema 推的，不是实测的**。拿到实测后须回填「哪些工具真的被模型叫错了」。

### 3.5 改法、迁移与验收

1. **先补而不是先改**（零破坏）：把 `outputSchema` 从 capability 契约投出来；给 `nomi_operation_execute` 加 `idempotentHint`；把 `resources` 声明升级为 `{subscribe:true, listChanged:true}` 并把 6 条 resource 模板挂上。**这一步做完，读侧已经有两条路，旧路照常工作。**
2. 观察一个版本，看宿主是否转向 resources（`resources/read` 调用量 vs `nomi_read` 调用量）。
3. 再删 `nomi_read` 的 6 个 target（`listChanged` 通知 + 文档标注）。
4. 写侧改名放到最后，与 §1 的 generation 统一命名同批发。

**验收**：`resources/read` 的内容与 `nomi_read` 同 target 返回**逐字节相同**（同源断言）；`tools/list` 每个工具带 `outputSchema` 且与契约的 Zod 同源；真实 Codex host 跑通「@ 一个 resource → 让它改第三镜」，全程零 `nomi_read` 调用。

---

## §4 内部 Agent 每轮失忆

### 4.1 这解决哪个真实摩擦

**大白话**：用户跟 Agent 连着说三句：「排 5 个分镜」→「第三镜换成夜景」→「刚才那个改回去」。第三句的「刚才那个」是什么？Agent 得从上下文里知道。

**实际发生的**：Agent 能看到前两句用户说的话和自己回的话，**但看不到自己第二句时到底调了哪个工具、改了哪个字段、结果是成功还是失败**。所以「改回去」它只能猜。

### 4.2 现状（file:line）：不是失忆，是有损转述

**第一层**：`src/workbench/ai/ProjectAgentResidentShell.tsx:534` 发送时确实写死 `history: { kind: 'ephemeral' }`，prompt 是字符串拼接 `` `${surfaceContext}\n${contextDetail}${referencesText}\n\n${text}` ``。

**第二层（关键，推翻「拆闸就消失」）**：`electron/projectAgentHost/projectAgentTurnExecution.ts:161` —— Host 自己也写死 `history: { kind: "ephemeral" as const }`。**所以拆 `agentHostEnabled` 闸不会让这条消失**；Host 开着时传给 pi 运行时的 history 同样是 ephemeral。

**第三层：Host 确实承担记忆，但方式是把历史重新拼成一个中文字符串。**`projectAgentExecutionHelpers.ts:52-70`：

```ts
const prior = snapshot.items
  .filter((item) => item.threadId === snapshot.activeThreadId && item.turnId !== turnId)
  .flatMap((item) => {
    if (item.kind === "user") return [`用户：${item.text}`];
    if (item.kind === "assistant") return [`Nomi：${item.text}`];
    return [];                            // ← tool / proposal / receipt / error 全部丢弃
  }).join("\n");
return prior ? `此前同一项目线程：\n${prior}\n\n本轮请求：\n${request.prompt}` : request.prompt;
```

四个具体后果：

| 后果 | 证据 | 用户会看到什么 |
|---|---|---|
| **工具调用与结果全丢** | `return []` 覆盖 `kind === "tool"` 等所有非 user/assistant 项 | 「刚才那个改回去」Agent 不知道改了什么 |
| **角色结构塌成纯文本** | `用户：`/`Nomi：` 前缀拼接 | 模型的 role 分离失效；用户若在正文里写「Nomi：」可造成注入 |
| **无 KV-cache 复用** | 每轮 prompt 前缀都变（prior 变长） | 长对话逐轮变慢、变贵 |
| **无截断/预算** | 全文件无 `slice(-n)` / `truncate` / token budget | 长线程终将撑爆上下文窗口，**没有降级路径** |

设计文档已经把这两条的解药写好了，只是没人实现（`nomi-agent-interaction.md:112-113`）：

> | 1 | **上下文用量 ★** | 一行（面板顶） | 用了多少 / 还能聊多久。`agentUsageStore` **已在累计但全仓无人读**，是白记的 |
> | 2 | **压缩分隔线 ★** | 一行 | 「前面 24 轮已折叠 · 展开」。**不给这条，自动压缩发生时用户只会觉得 AI 突然失忆** |

**第二行是本节标题的出处**：设计文档预见到「AI 突然失忆」是压缩的可观察症状；现在的实现是**连压缩都没有**，直接无限增长——这比压缩了不说更糟，失败形态是「某天突然报错」而不是「渐渐忘事」。设计文档另对长期记忆有 opt-in 主张（`:484-486`：一次性附件「**不自动变项目长期知识**」、跨会话记忆「需显式加入，**不能因一次上传永久污染上下文**」），而字符串拼接是另一个极端：把结构化的东西压成散文后全部平等地灌进去。

**另有一处可疑（未定性，留问不留判）**：过滤用 `snapshot.activeThreadId`，本轮线程却是 `execution.turn.threadId`（`hostPromptLedgerForTurn` 同文件 :40 用的就是后者）——两处不同源，用户生成期间切线程会读到另一条线程的历史。**动手前先搞懂现有设计为什么这么写**（D3），不预先定性为 bug。

**结构化通道是现成的**：`electron/harness/context/contextBinding.ts:8-10` 已定义 `AgentContextScope = {kind:'persistent', binding} | {kind:'ephemeral'}`；`persistent` 有完整的 `contextService` 实现与测试，生产侧唯一使用者是 `generationCanvasAgentClient.ts:174`。**Host 路径主动选了 ephemeral。**

### 4.3 为什么会反复出问题

12 份合同落在这一族（`ResidentShell` / `executionHelpers` / `harness/context/`），形状集中在「上下文/投影丢了一半」：`single-shot-history-isolation`、`resident-composer-receipt-revision`、`canvas-snapshot-projection`。

值得注意：`executionPrompt:53-58` 的注释**明确解释了为什么 single-shot 必须 ephemeral**（方向规划与图像评审不能继承常驻线程的记录）——那是对的设计。问题是**这个「刻意 ephemeral」被推广到了整条常驻路径**，而多轮常驻的需求恰好相反。

### 4.4 改法

1. **Host 传结构化 thread 而不是拼字符串**：`projectAgentTurnExecution.ts:161` 的 `history` 改为 `{ kind: 'persistent', binding: { sessionKey, threadId: execution.turn.threadId } }`，`single-shot` 保持 ephemeral（那条注释是对的，别动）。
2. **把 tool call / result 纳入 thread**：`executionPrompt` 退休，改由 `contextService` 按 pi 的消息结构装配（含 assistant tool_use + tool_result）。
3. **补 token 预算与降级**：超预算时保留「最近 N 轮完整 + 更早的摘要」，且**降级要在 UI 上诚实标出**（D4：缺口明着标）。
4. **线程身份统一**：`activeThreadId` vs `turn.threadId` 二选一，写进 `check:vocabularies` 登记。

### 4.5 迁移路径与验收

先加红测「同一线程连续三轮，第三轮的模型输入必须包含第二轮的 tool_use 名与 tool_result 摘要」（现在必红）→ 再改 Host 转绿 → R13 走查 J1「排分镜 → 改第三镜 → 撤销」全程不重述上下文 → 记录第 1/5/10 轮 prompt token 数，确认不再线性膨胀。

---

## §5 接模型的主路径顺序

### 5.1 这解决哪个真实摩擦

**大白话**：用户自己搭了个中转站（new-api 之类），手上只有两样东西：一个网址和一把 key。他想让 Nomi 用上面的模型。

**用户实际说过的话**（`docs/audit/2026-06-07-ux-walkthrough-actions.md:38`，一位剪映用户给 Nomi 打 4/10，列出三个「想关掉软件」的瞬间）：「① **被要求贴 API 文档 + key** ② 点『等待生成』格子没反应又无引导 ③ 满屏 `kie` 黑话」。

**第一个瞬间就是本节要修的东西。**现在的对外说法（`conversational-model-integration.md:5-7`）确实把读文档摆在第一位——「把这个 API 地址和**官方文档**里的模型接进 Nomi……助手会先**读取公开资料**并列出完整候选」——但用户的自建中转站**往往根本没有公开文档**，它就是一个 OpenAI 兼容端点。

### 5.2 真实摩擦清单（带出处）

| 日期 | 出处 | 用户原话 / 条目 |
|---|---|---|
| 2026-08-11 | `docs/plan/2026-08-11-model-kind-misguess.md:3,27` | 主诉「**接入了模型但用不了**」（issue #4/#8/#9/#19/#23/#42/#62 同源）；「模型明明接进来了、明明启用着，却不在列表里，**且没有一个字解释为什么**」 |
| 2026-08-11 | `electron/catalog/modelKindHeuristic.ts:28` / `:38-40`（代码注释） | 「MiniMax H3 **用户反馈想接但被分进文本桶**」；「**用户报『grok 接不进去、识别不出 image/video 类型』**」 |
| 2026-08-11 | `docs/plan/2026-08-11-vendor-connection-health.md:4,16` | 「显示『已保存 · 未测试』，用户会疑惑去哪里测试」；「**自定义中转家连状态都没有——恰是最容易填错 baseUrl 的那类**」 |
| 2026-07-24 | `docs/plan/2026-07-24-archetype-vendor-scoped-transport.md:5` | 「通用中转接 `gpt-image-2`，接入测试能出图、同 key 其他软件能出图，**唯独画布生成报『未开启生图功能』**」 |
| 2026-08-18 | `docs/plan/2026-08-18-vendor-connection-discoverability.md:4,5` | 「要改一下 api url，结果翻了半天没找到修改的地方」；「需要加一个单独的删除按钮」 |
| 2026-07-15 | `docs/plan/2026-07-15-comfyui-custom-workflow.md:3` | 「装了 WAN2.2+WanVideoWrapper+VHS 想接本地文生/图生视频**接不进来**」 |
| 2026-08-11 | `docs/plan/2026-08-11-issue-62-triage.md:3,8` | GitHub #62 "Does not work"；「报 bug 的唯一入口是商务合作表单 → 真实故障被挡在门外」 |
| 2026-08-26 / 2026-05-30 | `docs/lessons/group-says-broken-usually-means-undiscoverable.md:6`；`docs/plan/v0.8-handoff-2026-05-30.md:124` | 「已连续三次是『功能一直在，用户找不到入口』」；「我配的 gpt-5.5 看不到」 |

> **注**：`docs/feedback/` 目前**只有 `sources.example.json`，一份 digest 都没落过盘**。上表是从 plan/audit/lessons/代码注释里打捞的——**反馈本身没有单一真相源**，这本身是一条独立发现。

### 5.3 现状：确定性探测已经建好，但 MCP 侧的接线**没接**

**推翻「要新增协议探测」这个改法假设的证据**：`electron/ai/onboarding/modelListProbe.ts:149` 的 `fetchModelList()` 就是「base URL + key → GET `/models` | `/v1/models` → 解析出模型列表」，而且已经解掉了最坑的那个陷阱（:143-145）：

> 命中判据是「**解析得出模型列表**」而不是「HTTP 200」——很多 new-api 后台的裸地址会被 SPA 200 回一页 index.html，只看 200 会提前收工。

配套已有：候选路径推导（:117-118）、分页上限（:88-89）、`redirect:"manual"` 硬拒（:201，防鉴权头跟着跳走）、失败分级（:85-87）、空列表不掩盖真错（:249-251）。健康态四分类全由探测结果 derive，**没有「哪家支持探测」的白名单**（`vendorHealth.ts:9-16,102-114`）。

**触发方盘点——这是本节最关键的发现：**

| 触发方 | 入口 | 状态 |
|---|---|---|
| UI 向导「拉模型」 | `onboardingIpc.ts:182` → `:200` | ✅ 活 |
| UI 向导「测试连接」可达性档 | `onboardingIpc.ts:111` → `:131`（注释 :107-110：「**那是我们探错了，不是他接不通**」） | ✅ 活 |
| 供应商健康自检 | `onboardingIpc.ts:78` → `vendorHealth.ts:135` → `:120` | ✅ 活 |
| **MCP 侧** | `electron/integrationCertification/httpConnector.ts:127` `discoverModels()` → `:155` `fetchModelList`，经 `service.ts:151` `discoverHttpModels()` 暴露 | ❌ **`discoverHttpModels` 全仓零调用点** |

也就是说：**给 MCP 用的探测函数已经写完、测过、暴露出来了，但没有任何一处调用它。**

原因是刻意的设计选择（`electron/capabilityCore/mcpIntegrationTools.ts:3-4`）：

> T14 · 确定性接入缝：Nomi 只持有凭据、提案落库、付费确认/启动和取消。**发现候选、翻页、适配杂牌 API、构造 workflow、补未决字段属于情境活，由驱动 Agent 完成后一次 propose。**

`INTEGRATION_METHOD_BY_ACTION`（:10-17）里只有 `begin / open_credentials / propose / confirm / start / cancel`——**没有 discover**。

**这个划分线画错了。**「GET `/v1/models` 拿模型 id」是全世界最确定性的事：一个 HTTP GET、一个 JSON 数组、零歧义、零额度。把它划进「情境活」交给驱动 Agent，等于让 Codex 里的模型去猜该拼 `/models` 还是 `/v1/models`、猜 SPA 返回的 index.html 算不算成功——**而这些坑我们自己已经踩完并写在 `modelListProbe.ts` 的注释里了。**

### 5.4 探测治不了什么，以及一个必须纠正的判断

| 环节 | 探测能确定性拿到吗 | 现状 |
|---|---|---|
| 端点通不通、key 有没有效 | ✅ 零额度 GET | `vendorHealth.ts` |
| 有哪些模型 id | ✅ | `modelListProbe.ts` |
| **每个模型是图/视频/音频/文本** | ❌ `/v1/models` 只回 id 字符串 | `modelKindHeuristic.ts:63` **按关键词猜**，兜底 `text`；文件自认「**必然有猜错的**」（:4-5,61） |
| 参数面（分辨率/时长/首尾帧/比例枚举） | ❌ | 读文档 / 手写档案 |
| 请求响应的 wire 形状 | ❌ | 手写档案 |

`modelKindHeuristic.ts` 的关键词表本身就是 bug 台账化石：`grok-imagine`（:38-40）、`minimax-h3`（:29-30）、3D 族整桶（:12-16，原本必然落进 text 兜底桶被当聊天模型塞进 `/chat/completions`）。同一个 `guessModelKind` 被 MCP 侧的 `httpConnector.ts:148,160` 复用并在 :161 把 kind 硬映射成单一 mode。

#### 「读文档」这条路径的现状：已经半下线，且留了并行版

入口在 `electron/providerAdapter/`（不在 onboarding 下）：`docsDiscovery.ts:143` 爬站 → `compiler.ts:26` 用文本模型编译成声明式 adapter → `service.ts:310-392` 编排。它是**短路 → 分级 → 兜底**的串行链：**短路**（:311-325，自建/局域网端点直接跳过文档与 AI 编译，用内置 OpenAI 兼容契约；根因是 issue #62：`192.168.18.254` 被截成 `18.254` 拼出 `http://docs.18.254` → Invalid URL → **整个接入判死禁用**，用户表现为「换 Key、换模型名、换端口都没用」）→ **分级**（:326-333，**文本模型永不读文档**；注释：「旧行为全部无差别走完整流程，**两个 DeepSeek 文本模型烧掉 132 秒后判死**」）→ **兜底**（:334-352，文档发现失败/超时不抛，空 corpus 继续走）。

**⚠️ 一处 P1 违规**：`onboardingIpc.ts:22` 与 `:74` 两处注释都写着「**「AI 读文档」子系统已下线**（Issue #8：各家中转参数不一，**读文档抠参数不可靠**）」，但 `providerAdapter/{docsDiscovery,compiler,service}.ts` 全部还活着，`service.ts:339` 仍设 stage `"discovering_docs"`，i18n 里还留着 `onboardingProviders.ts:1895` `discovering_docs: 'Finding official API documentation…'`。**「已下线」只对 onboarding 那条路成立，certification 那条路仍在读文档——这是一个有并行版的半迁移。**

**关键结论**：主会话假设的「用协议探测做主路径、读文档做兜底」**已经是团队自己得出的结论并部分实施了**（Issue #8 的裁定原话就是「读文档抠参数不可靠」）。本节要做的不是改方向，是**把这次迁移做完**。

### 5.5 必须纠正的一个判断：per-vendor drift 不是主要 bug 源

我在起草时的直觉是「54 条里多数是 per-vendor wire drift，探测治不了」。**逐条读 `class_root` 后这个判断是错的。**

2026-08-23 之后、`scope_paths` 含 `electron/catalog/` 或 `electron/providerAdapter/` 的合同共 **57 条**：

| 类别 | 条数 | 占比 |
|---|---:|---:|
| **A. 某一家供应商的线上 wire 与我们的假设不符** | **4** | **7%** |
| **B. 我们自己缺一道统一归一化 / canonical 边界（同一不变量两个作者）** | **42** | **74%** |
| C. 其他（平台/工具链/测试基建/产品形态） | 11 | 19% |

A 类只有 4 条（`dreamina-cli-v1417-alignment` / `elevenlabs-sfx-duration-contract` / `kie-kling-omni-wire-contract` / `apimart-model-id-and-reference-contract`），**而且这 4 条的「正确形状」全部仍然是「建一道边界」**（`did not own` / `not enforced at the … operation boundary` / `no versioned matrix pinning + no contract test`）。

B 类里最露骨的三条，形状与 §1 的「两张嘴」完全一致：

- `relay-variant-axis-inert`：「内置模型早就用参数化 model 绕开了它，唯独通用中转这条最晚接入的线缆留着字面量，于是**内置与中转的体验从这里分家**」
- `orphan-mapping-cable`：「两侧各自都自洽、各自的既有测试都绿——**只有把两侧对起来才看得见那条线缆连不上**」
- `runway-model-identity`：「平台面**必然是 10 个模型能力的并集**，对每个具体模型都过宽」

`electron/catalog/` 下**非测试非生成的 126 个 `.ts` 里有 71 个（56%）是 vendor 专属**，最厚的分布：kie 12 个、comfyui 10 个、apimart 7 个、dreamina 7 个、agnes 5 个、antigravity 5 个、runway 5 个。`runwayOfficial.ts` 37.7 KB、`comfyuiWorkflowImport.ts` 39.9 KB——这不是薄适配层。

**所以真正的改法是**：71 个 vendor 文件带来的痛，绝大多数不是「每家不一样」（那是不可避免的），而是「**每家各写一遍，导致同一个不变量有 N 个作者**」。

### 5.6 改法：三条线，只有一条是「重排主路径」

**A 线（接线，最便宜，先做）**
1. **把 `discoverHttpModels` 接进 `nomi_integration`**：新增 `action:"discover"`（或让 `begin` 内部先跑一次探测）。把一个已写完、有测试、零调用点的函数接上——**代价接近零，收益是 Codex 里不再需要 Agent 去猜端点路径**。
2. **`unknown_kind` 出口**：探测结果分三堆返回（`confirmed` / `unknown_kind` / `unreachable`），`unknown_kind` **用人话回问一句**（D1：不让用户填表）：「这 3 个我认不出来：`xxx-v2`、`yyy-turbo`、`zzz`——是图片还是视频？」
3. **文案对齐**（`conversational-model-integration.md:5-7`）：从「先读文档」改成「先探测，认不出来的才去读文档」——文案追上 Issue #8 已有的裁定，不是新功能。

**B 线（清并行版，P1）**
4. 把 `providerAdapter/{docsDiscovery,compiler}` 在 onboarding 路径上的残留删净，或反过来撤销「已下线」注释——**二选一，不留「有时读有时不读」的并行世界**。现状是最坏的一种：注释说下线了、代码还在跑、i18n 还在显示 `discovering_docs`。

**C 线（治 74%，最贵但最值）**
5. `docs/plan/2026-09-03-self-hosted-relay-conformance-harness.md`（📋 已立项）方向对：CI 里起一个严格的假中转，把「用户接入」这条唯一没有反馈回路的路径接上回路。
6. **本文追加建议**：harness 只能抓 A 类（7%）。要压 B 类（74%）需**给 71 个 vendor 文件加一条「同一不变量只能有一个作者」的门岗**——把 vendor 层的 taskKind / mode / reference-role / model-identity 四个不变量登记进 `check:vocabularies`，是 R14.1 的机器化延伸。**加规则前先验它会红**（R17）——按 `orphan-mapping-cable` / `relay-variant-axis-inert` 的描述它必红。

### 5.7 覆盖比例（诚实标注：不编数字）

| 接入形态 | 探测能覆盖到哪 |
|---|---|
| OpenAI 兼容中转（new-api / one-api / 自建） | **端点 + key + 模型 id 全自动**；类型靠关键词猜，参数靠内置兼容默认（`builtinOpenAiCompatibleDraft.ts`） |
| 一手大厂（Anthropic / OpenAI / 火山方舟） | 端点 + 列表可探；参数面已有内置档案 |
| 聚合中转（fal / kie / APIMart / Replicate） | 列表可探；**参数与 wire 各家一套，必须手写档案** |
| ComfyUI / 本地 | 不走 `/models`，另一条路 |

> **我拿不出「探测能覆盖多大比例的接入」这个百分比。**需要的是真实接入量分布，而 `docs/feedback/` 下一份 digest 都没有（§5.2 注）。**这个数字先空着，不编。**要拿到它，先修「反馈没有单一真相源」这件事——`nomi-feedback-radar` 技能已存在，是没跑还是跑了没落盘，需要用户确认。

### 5.8 验收

新用户在 Codex 只给「网址 + key」，MCP 侧零额外提问完成端点验证 + 模型列表拉取，只在 `unknown_kind` 非空时问一句人话；`grep -rn discoverHttpModels` 有真实调用点且有 e2e 断言它在 `nomi_integration` 路径上被调用过；`discovering_docs` 这个 stage 要么真在用（撤销「已下线」注释）要么彻底删（连 i18n 条目）——不许两存；relay conformance harness 跑通四条拒绝规则。

---
## §6 六角色评审

### CTO
1. 全文最有价值的不是任何一条改法，是 §5.5 那张表：**57 条供应商层合同里只有 4 条是「别人变了」，42 条是「我们自己开了第二个真相源」**。这把话题从「供应商太多太乱」拉回到我们能控制的部分。
2. 五条里只有 §2 能一次性降低整个系统的触发面。但我**反对把它说成「删审批机器」**——设计文档 §11 把提议事务 + 整批撤销列为护城河。要退的是确认这一步，不是事务；这个区分说错一次，第一次误扣费就会被全部打回来。
3. §5 的 A 线（接 `discoverHttpModels`）性价比最高：**函数写完了、测过了、零调用点**。这不是架构改动，是接一根线。
4. **我反对现在动 §1/§3 里任何改名步骤。**M0–M5 还是 `BLOCKED_ENVIRONMENT`，动对外契约等于加一个验证不了的新面。先做不破坏任何东西的前三步。
5. §4 的「无截断」是**必然会发生的生产故障**，只是还没人跑过足够长的线程。按 bug 排，不按架构改动排。

### 后端
1. `CapabilityApproval` 零消费者是全文最硬的发现——一个**声明了但没接线的门**比没有这个字段更危险，因为读代码的人会以为分级已经生效。
2. `projectAgentExecutionRisk` 的安全词表里写的是 M2 改名前的旧 pi 别名。这不是「将来可能漂移」，实测已经在 `nomi_document_edit` 上漂了。
3. **我反对 §1 里「timeline 14 个 pi 工具收成 4 个」的优先级**——它不修任何已知 bug，只是让面变整齐。排在 §2 后面。
4. §3 的 `outputSchema` 缺失是纯净收益：capability 契约里 Zod 已经有了，投出去几十行。**这是全文第二便宜的一条**（第一是 §5 接线）。
5. 关于「进程内 MCP transport」：`dispatch(method, params, ctx)`（`dispatcher.ts:332`）本来就是纯函数，`mcpStdioServer` 只是它的一个 transport；`residentGenerationAdapterFactory.ts:55` 证明 Host 已经能给自己签发真租约。**§1 的「合面」在技术上比看起来容易——卡点只有 lease，而 lease 已经解过一次。**

### 前端
1. §2 落地后用户可见的变化最大。但**这次不用从零出样张**：设计文档 `:121` 已经把写入回执定死成「已加 5 个节点 · 撤销」一行，`:112-113` 把上下文用量与压缩分隔线也定死了。**需要拍板的只有「行内撤销条长在哪、活多久」。**
2. **我担心 §2 会让用户失去掌控感。**「Agent 悄悄改了我的文档」比「多点一次批准」更可怕。撤销条必须在改动发生的那一刻就在视线里，不能藏进历史。
3. §4 的压缩降级如果做，UI 必须诚实标出「前面 N 轮已折叠」——设计文档 `:113` 的原话是「不给这条，自动压缩发生时用户只会觉得 AI 突然失忆」。
4. §3 迁 resources 对 Nomi 自己的 UI 零影响，但会改变用户在 Codex 里的手感（从「让 AI 调工具」变成「我自己 @ 一个资源」）——这是变好，要在文档里说清楚。
5. §5 的「认不出来就问一句」必须是**对话里的一句话**，不是一张表。§5.2 那位打 4/10 的用户，第一个想关软件的瞬间就是「被要求贴文档 + key」。

### PM
1. §2 是**还债**不是**新做**——用户拍板过的设计和代码之间有一条明确的裂缝。排期按 bug 走。
2. §5 是唯一直接影响「新用户能不能用起来」的一条，§5.2 的 12 条摩擦里有 7 条是同一个主诉「**接入了模型但用不了**」。从获客角度它该排第一。
3. **但我反对把 §5 的验收排第一**：M0–M5 handoff 明写真实 Codex host runner 缺失（`BLOCKED_ENVIRONMENT`），§5 的完整验收现在做不了。**折中：A 线（接线 + 文案）现在做，验收留到 host 就位。**
4. §1/§3 的改名会让写过 Nomi MCP 集成的用户返工。**我们有多少这样的用户？这个数字必须在动改名之前查清楚**——如果是 0，现在改代价最小。
5. **§5.2 的注是一条独立的 P0**：`docs/feedback/` 一份 digest 都没有，用户反馈没有单一真相源。我们现在是靠翻 plan 文档和代码注释来还原用户说过什么——**这条比本文任何一条架构改动都更影响判断质量**。

### 设计
1. `nomi_canvas_edit` 与 `nomi_canvas_plan` 共用**完全相同的 9 个 operation 枚举**——设计上等于两个按钮做同一件事。§3 方向对。
2. 但**我反对把 9 个 operation 全拆成 9 个工具名**。`propose_storyboard_plan` 和 `patch_shots` 是同一件事的两个阶段（先排后改），拆开会让模型以为它们不相干。**按「用户任务」分组，不是按「操作原子」分组。**
3. §2 的撤销条不该开新组件。设计文档 §8.3「产物卡的动作归位」已经定了动作长在哪，撤销归到同一位置。
4. `nomi_read` 的 title 是「读 Nomi 的任意只读投影（画布/项目/模型/生成上下文/Run/产物/接入会话）」——**这是把内部对象清单当用户语言在说**。24 个工具的 description 全是工程语言，与设计文档 §6「片场话」纪律完全脱节。
5. **这是第六条质疑，本文没覆盖**：MCP 面的语言层。修 §3 的时候顺手修，比单独立项便宜。

### 真实用户（做短片的独立创作者）
1. 「我让它整理一下画布布局，它弹了个框问我同不同意」——第一次遇到我会以为软件坏了。
2. 「撤销要点两次」（一次撤销请求、一次批准撤销）——比不能撤销更烦。
3. 我不知道什么叫 `leaseHandle`、什么叫 `target`。我在 Codex 里只想说「看看我的分镜」。
4. **我最痛的是 §5。**我有一个自建中转站，我只想给它一个网址和 key。它要是认不出某个模型是图还是视频，**直接问我一句就行**——别让我去贴文档，也别静默把它当聊天模型（我报过 grok 那次）。
5. **我不在乎 33 还是 24 个工具。**我在乎的是我说「改回去」的时候它知道我在说哪一次。

---

## §7 决策对比表（R3）

### 主决策：先做哪一条

| 方案 | 用户会看到什么 | 代价 | 覆盖 |
|---|---|---|---|
| **A. 修审批分级（§2）** | 编辑文案、整理布局、撤销 不再弹确认；付费仍然弹 | 中：需拍板撤销条形态；改 `approval` 要配写入回执 | H2 13 条 + 消灭 `canonical-storyboard-proposal-transition` 那一类 |
| **B. 修记忆（§4）** | Agent 记得住「刚才那个」；长线程不再必然炸 | 低：`persistent` 通道已存在有测试 | H4 12 条 |
| C. 合工具面（§1） | 无可见变化 | 最大；改名步骤破坏对外契约 | H1 13 条 |
| D. 迁 resources（§3） | Codex 里能 @ 项目资源 | 中；前三步零破坏 | H3 12 条 |
| **E. 模型接入 A 线（§5.6）** | 「给个网址和 key 就行」真的成立 | **最低：接一个零调用点的函数 + 改文案** | H5 里的接入首程 |

**推荐顺序：① E(A 线) → ② B → ③ A → ④ C 前三步 → ⑤ D 前两步**，并**全程并行**推进 §5.6 的 C 线（conformance harness 已立项 📋 + vendor 不变量门岗）。

理由（按「最便宜的第二份真相源先拆」排，不按 bug 数排）：**E 先做**——`discoverHttpModels` 已写完、零调用点，接线成本接近零，命中 §5.2 最高频主诉，且是唯一能在 host runner 就位前就把用户首程改顺的一条；**B 第二**——代价最低、通道已存在，「无截断」更像必然故障；**A 第三**——还债、用户可见收益最大，且不依赖 §1；**C/D 的破坏性步骤压到最后**，等真实 host runner 能验证之后再动对外契约。

### 子决策：§2 的三种力度

| 方案 | 用户会看到什么 | 代价 |
|---|---|---|
| **A1. 只换判据，不改 `approval`** ★第一步 | 文档编辑/整理布局/撤销 从「每次都弹」变成「`safe-auto` 下第二次起不弹」 | 最小；无 UI 改动，无需样张 |
| A2. + 写入回执 + `approval="none"` | 可撤销编辑完全不弹，改完出「已改 · 撤销」一行 | 需拍板撤销条形态；Host 落 `undoToken` |
| A3. + 拆掉提议事务 | 同 A2 | **不推荐**：事务是护城河（设计 §11 `:427`），没有事务就没有整批撤销 |

### 子决策：§5 的三条线

| 方案 | 用户会看到什么 | 代价 |
|---|---|---|
| **B1. 接 `discoverHttpModels` + `unknown_kind` 人话回问** ★ | 「给网址和 key」在 Codex 里真的够用 | **最低**（接线 + 一句问话） |
| **B2. 清「读文档已下线」的并行版** ★ | 无直接可见；消除「有时读有时不读」 | 低；P1 要求 |
| B3. relay conformance harness（已立项） | 接中转站的失败率下降 | 中；只治 A 类那 7% |
| B4. vendor 不变量门岗（本文追加） | 无直接可见 | 高；但治的是 74% 那一堆 |

**推荐 B1 + B2 立刻做，B3 按已有立项推进，B4 作为 R14 周期审计的一个新维度立项。**

### 需要用户拍板的三件（本文不代决）

1. **三档批准策略哪一档是出厂默认？**设计文档 `:510` 写了「默认行为」这一列，但全文没说默认是哪档（§2.1）。
2. **改名的弃用期**：现在有多少外部用户写过 Nomi MCP 集成？（§1 第 4 步、§3 写侧改名的前提）
3. **反馈真相源**：`docs/feedback/` 一份 digest 都没有（§5.2 注）。`nomi-feedback-radar` 是没跑，还是跑了没落盘？

---

## 附：本文没有覆盖的

1. **MCP description 的语言层**（设计角色第 5 条）：24 个工具的描述全是工程语言，与设计文档 §6「片场话」纪律脱节。
2. **真实宿主实测**：`scratchpad/mcp-host-probe.md` 截至完稿未生成，§3 的「模型会不会用错」是从 schema 推的，不是实测的。
3. **接入量分布**：§5.7 的百分比没有数据支撑，留空未编。
4. **`activeThreadId` vs `turn.threadId`**（§4.2）：发现了不同源，**未定性**。动手前须先搞懂现有设计意图（D3），不预先叫它 bug。
5. **本文所有「删多少行」都是估算**，没有真跑过删除。
