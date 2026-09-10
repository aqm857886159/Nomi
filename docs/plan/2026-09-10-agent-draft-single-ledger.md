# Agent 草稿单一账本（2026-09-10）

状态：🚧 进行中 · 分支 `fix/agent-draft-single-ledger-20260910`

## 背后逻辑（一句话）

Agent 说「草稿已建」，用户却在画布上什么都看不到——因为**草稿这份意图当时只写进了主进程的 Run，
没有落到用户唯一看得见的地方（画布）**。等项目重开时补齐钩子才把它补出来，而补出来的那份**不带模型身份**，
节点只好自己另选一个默认模型，于是「agent 说的」和「画布上的」对不上。

真正要权衡的那件事：**这份意图应该有几个账本？** 现在事实上有两个半——主进程 Run 的 candidate、
画布节点的 meta、以及渲染层自己那套「没模型就挑一个」的默认解析器。本方案把它收成一个：
**Run 的 candidate 是意图，画布节点是它的投影，落地链是唯一的 apply。**

## 用户可见症状（2026-09-10 真机）

1. agent 建草稿 → Tasks 面板只有一句「等待开始」，画布上没有节点。
2. 重开项目后节点冒出来，但节点卡 / 浮动 composer 里的模型、提示词和 agent 定的不一致。
3. agent 重试会堆出重复节点。

## 范围

1. **建草稿 / 改草稿即刻落画布**：`generation.create` / `generation.patch` 成功后立即走**现有**
   `landCanvasForRun`（同一个 `canvas-landing:{runId}` operationId，与「确认即落」「打开项目补齐」共用一条链）。
2. **落地报文带模型身份**：`MaterializeShotWire` 增加候选的 `candidateId / candidateRevision /
   vendor / modelKey / modeId / mode`（**绝不带** `transportModelId` 或任何密钥）；渲染层落地时喂给
   现有的 `buildPlannedNodeMeta` 写进 `meta.modelKey / meta.vendor / meta.archetype`。
3. **patch 重绑定已落节点**：节点上记 `productionCandidateRevision`；报文里的 revision 更新才同步
   prompt/标题/模型，否则一个字不动（保证「打开项目补齐」不会覆盖用户在画布上的手改）。
4. **`ProductionRunSummary` 投影草稿摘要**：模型、比例、提示词首行、镜数；Tasks 卡 draft 态显示
   「模型 · 比例 · 提示词摘要」，不再只有「等待开始」。文案 zh-CN + en 同步补。
5. **默认模型解析收敛到一个 owner**：候选带模型就用候选的；没带就读用户保存的默认
   （复用现成 `settings.generationModelDefaults` IPC，不复制主进程解析逻辑）；正则阶梯降为
   「用户一个默认都没配」时的兜底。删 `src/config/models.ts` 的 `getDefaultModel` 死代码。
   自愈 effect 遇到带候选戳的节点不再静默改写，改成出可见提示。
6. **`create_canvas_nodes` 幂等下沉**：去重判据搬进写边界，两个调用方各自那份手写去重删掉（P1）。

## 不动项

- `electron/productionRun/productionRunApprovalReceipt.ts`；`productionRunService.ts` 的 set_trust /
  decide 段；`electron/harness/context/agentContext.ts`（另一个工人在改）。
- 付费闸、授权信封、seal/approve 的任何**判据**——本方案只碰**草稿期**与**落地投影**，不碰钱。
  **2026-09-10 修正**：判据确实一个字没改，但「不碰钱」的假设错了——见下面「与 #722 的相互作用」。
- `landCanvasForRun` 的 best-effort 铁律：落地失败只记 warn，绝不阻断生成。
- 分镜方案（storyboard）那条落地路径的语义；它只跟着 ⑥ 的去重下沉走。

## 与 #722 的相互作用（2026-09-10 CI 的 C9 红，事后补记）

`#722` 让付费收据 **fail-closed**：收据只在它描述的那份项目文档还是当前版本时有效，判据就是
`project.revision`。而本方案的「建草稿即落画布」是 **fire-and-forget** 的项目文档写：
落地 → 渲染层建节点 → 700ms 防抖后落盘 → `project.revision` 前进。

于是这次前进可能落在「封授权信封」与「用户点确认」之间：**用户点了确认，却被告知「此确认已失效」**
（`receipt_invalid: projectRevision does not match the current scope`）。两个 PR 各自绿，合起来红。
这不是测试的问题——它是真实用户会撞上的形状：agent 建完草稿，用户点确认付费，被驳回。

根因不是判据太严，是 **Nomi 自己的投影写没有被排序**。两条闸，都在「写必须有序」这一族：

1. 落地真写了画布 → **当场落盘**（复用 `canonicalCanvasPlanPatch` 用的同一个
   `persistActiveWorkbenchProjectNow`，P1 一个 owner），不交给防抖；幂等空跑不落盘。
2. 封信封前 → **等自家在飞的落地落完**（`canvasLandingHost.settleCanvasLanding`）。

**用户自己**改项目照样作废收据——那正是 #722 要的语义，一个字没动。

## 回滚

单分支单 commit 族，回滚 = revert 分支。逐项独立可退：
② 退回不带模型的报文（回到今天的行为）；⑤ 退回正则阶梯；⑥ 退回两处手写去重。
数据面无迁移：`meta.productionCandidateId/Revision` 是新增的可选 meta 键，老项目读不到就走「首次落地」分支。

## 验收门

- 单测：create 后画布立刻有节点且 `meta.modelKey` == 候选；patch 后节点 prompt/模型同步；
  重试不重复；Summary 带候选摘要；自愈不覆盖候选模型；幂等下沉后两个调用方都不重复建节点。
- `pnpm run test:system:focused`
- `pnpm run gates` 全绿（含 `check:i18n` / `check:vocabularies` / `check:heavy-path` / `check:root-cause-contracts`）。
- 根因合同：`docs/fixes/2026-09-10-agent-draft-single-ledger.root-cause.json`（schema-v3，`invariant_owner_layer` 必答）。

## 没做：防复发门岗的设计与落点（本轮只出设计，不半做）

**要守的不变量**：agent 通过 MCP 写进 Run 的每一个 durable 字段，要么在渲染层有真实读者，
要么被显式登记成「内部中间态」。这条正是本次 bug 的**上游**——`generationPlan.candidate.modelId`
是 agent 写的 durable 字段，渲染层从来没有读者，于是节点只好自己另挑模型，而没有任何机器
能在合并前告诉我们「这个字段写了没人读」。

**落点**：`scripts/check-durable-field-readers.mjs` + 登记表
`docs/engineering/durable-field-readers.json`，挂进 `gates:contracts`（棘轮：存量只减不增）。

**判据形状**（刻意可机读，不判语义）：
1. 从 `electron/productionRun/productionRunTypes.ts` 与 `electron/capabilityCore/executionContract.ts`
   的类型声明里 AST 抽出 `ProductionGenerationPlan` / `ProductionGenerationShot` / `PlanCandidate`
   的**每个字段**（与 `check:framework-surface` 从 `.d.ts` 抽字段同一手法，升级/加字段即红）。
2. 对每个字段判一条裁决：`projected`（有跨 RPC 的投影者 + `src/` 里的读者，两端各给一个 file:line）、
   `internal`（只在主进程内部流转，须写明为什么渲染层不需要它 —— `transportModelId` 属于这格）、
   `debt`（带到期日与 owner）。
3. 新增字段没有裁决 = 红。裁决说 `projected` 但 `src/` 里搜不到那个投影字段名 = 红。

**为什么值得**：`check:vocabularies` 管的是「同一语义有几个 owner」，`check:framework-surface` 管的是
「框架公开的字段我们逐条判过没有」，这一条补的是第三块——**我们自己 durable 写下的字段，
有没有人在用户看得见的那一侧读它**。三者判据同形，可以共用抽字段与登记表的骨架。

**为什么这轮没做**：它要先把三个类型的既有字段全部裁决一遍（`ProductionRun` 一层就有 ~40 个字段），
存量裁决没做完就上门岗只会一片红然后被无视（`check:prior-art` 的日期阈值就是这个教训）。
半做比不做更糟，故本轮只留设计与落点。

## 先查别人

完整报告：[docs/research/2026-09-10-agent-draft-single-ledger/prior-art.md](../research/2026-09-10-agent-draft-single-ledger/prior-art.md)

- 仓库里已有（**用它**）：幂等落地链 `electron/productionRun/multiShotCanvasLanding.ts:147` `landCanvasForRun` + `electron/productionRun/multiShotCanvasLanding.ts:32` `canvasLandingOperationId`，渲染半 `src/workbench/capability/multiShotCanvasLanding.ts:59` `materializeShots`。建草稿即落复用同一条链和同一个 operationId，不新建第二条。
- 仓库里已有（**用它**）：`plan.bind-shot-nodes` 的 shotId→nodeId 账本 `electron/productionRun/productionRunCanvasLandingReducer.ts:11` —— 对 plan.state 无闸，draft 态可直接绑定，不为草稿期另立字段。
- 仓库里已有（**用它**）：用户保存的默认模型唯一 owner `electron/capabilityCore/generationDefaultModelResolver.ts:52`，其中 `electron/capabilityCore/generationDefaultModelResolver.ts:115` 的 `modelId: model.modelKey` 证明候选 modelId 与节点 `meta.modelKey` 是同一个串（不造转换层）；渲染层已有只读投影 `src/desktop/settingsBridge.ts:38` → `src/workbench/generationCanvas/model/generationModelDefaults.ts:38`。被降级为兜底的是 `src/workbench/generationCanvas/agent/availableModels.ts:107` 的正则阶梯。
- 仓库里已有（**用它**）：「计划模型 → 节点 meta」的唯一写边界 `src/workbench/generationCanvas/agent/plannedNodeMeta.ts:73` `buildPlannedNodeMeta`（身份唯一键 `(vendor, modelKey)`），落地路径直接喂它，不另写一套 meta 组装。
- 依赖里**没有**：React Flow 只渲染节点、不提供「外部意图 → 节点」的同步账本（`node_modules/.pnpm/@xyflow+system@0.0.81/node_modules/@xyflow/system/dist/esm/types/nodes.d.ts:19` 的 `NodeBase.data` 是纯应用数据）。故账本必须自研，但只许有一份，就是 `applyCanvasToolCall`。
- 生态里已有（**照做**）：幂等 key 归被调用方所有是 HTTP 生态的既成做法（`Idempotency-Key` 草案 https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/ ，2026-09-10 查）；单一真相源 + 幂等 apply 是 CRDT 生态的通行结构（https://automerge.org/docs/reference/documents/ ，2026-09-10 查）。故第 ⑥ 项把两处手写去重下沉到写边界 `src/workbench/generationCanvas/agent/applyCanvasToolCall.ts:326`。
- TikHub 自媒体一格本轮**没查成**：纯内部数据流问题，没有可引用的创作者一手经验，不假装查过。
