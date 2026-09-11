# 先查别人 — agent 草稿单一账本（2026-09-10）

任务：agent 建草稿后画布上没有节点，重开项目才冒出来，且节点模型/提示词与 agent 定的不一致。
问题形状是「一份意图（generationPlan.candidate）要有一个落地账本 + 一个模型身份 owner」。
下面四问的答案决定「自研 vs 复用」。

## ① 依赖里已有？

- React Flow（`@xyflow/react`）的节点数据模型本身**不提供**「外部意图 → 节点」的同步账本：
  `node.data` 是应用自己的对象，库只负责渲染与交互。
  见安装版类型 `node_modules/.pnpm/@xyflow+system@0.0.81/node_modules/@xyflow/system/dist/esm/types/nodes.d.ts:19`（`NodeBase.data: NodeData`，
  无任何 reconcile/patch 语义）。
  **结论：不能靠框架，账本必须住在我们自己的写边界**——但也因此**不许**再造第二个节点写入通道
  （R29「框架已提供的不重造 / 我们另写的要能指出理由」：这里属于「框架不提供，必须自研」的格子，
  自研的那一份就是 `applyCanvasToolCall`，不该有第二份）。

## ② 仓库里已有？（用已有，不新建）

- **落地链已经有一个幂等的家**：`electron/productionRun/multiShotCanvasLanding.ts:147`
  `landCanvasForRun` + `electron/productionRun/multiShotCanvasLanding.ts:32` `canvasLandingOperationId`
  （`canvas-landing:{runId}`，每 Run 一个稳定 op），渲染半在
  `src/workbench/capability/multiShotCanvasLanding.ts:59` `materializeShots`（op 章 + clientId 双章去重）。
  **结论：复用。** 建草稿即刻落画布**不新建第二条链**，直接复用同一个 `landCanvasForRun` 与同一个
  operationId——这样「确认即落」「打开项目补齐」「建草稿即落」三个时机天然互相幂等。
- **shotId→nodeId 的绑定账本已经有**：`electron/productionRun/productionRunCanvasLandingReducer.ts:11`
  `bindShotNodes`（`plan.bind-shot-nodes` 命令，单镜用 `candidateId` 当 shot 地址；绑定即清 `canvasDetached`）。
  它对 plan.state **没有**状态闸，draft 态即可绑定。**结论：复用**，不为「草稿期绑定」另立字段。
- **用户保存的默认模型已经有唯一 owner**：主进程 `electron/capabilityCore/generationDefaultModelResolver.ts:52`
  `createGenerationDefaultModelResolver`（enabled + 该 mode 已发布 + 凭据可解密，三条都过才算可用；
  `electron/capabilityCore/generationDefaultModelResolver.ts:115` 明确 `modelId: model.modelKey`，
  即候选的 modelId 与节点 `meta.modelKey` 是同一个字符串，不需要转换层）。
  渲染层已有它的只读投影：`src/desktop/settingsBridge.ts:38` `settings.generationModelDefaults.get`
  → `src/workbench/generationCanvas/model/generationModelDefaults.ts:38`（快照 + 订阅）。
  **结论：复用这条现成 IPC，不加新 IPC、不复制解析逻辑。**
  被替换掉的是 `src/workbench/generationCanvas/agent/availableModels.ts:107` `pickStoryboardDefaultModel`
  的正则阶梯（gpt image → nano banana → 第一个），它无视用户保存的默认，只能当「用户没配任何默认」的兜底。
- **「计划模型 → 节点 meta」的写边界已经有唯一 owner**：
  `src/workbench/generationCanvas/agent/plannedNodeMeta.ts:73` `buildPlannedNodeMeta`
  （身份唯一键 `(vendor, modelKey)`、档案参数铺默认 + 合法覆盖）。
  **结论：复用**，落地报文带上候选模型身份后直接喂它，不在落地路径里另写一套 meta 组装。

## ③ 生态里已有？（同类做法）

- CRDT / 单一真相源的通行做法是「一个 durable 意图 + 一个幂等 apply」，而不是「写两处再对账」。
  Automerge 文档把这条讲得最直白：变更只发生在文档上，视图是它的投影
  （https://automerge.org/docs/reference/documents/ ，2026-09-10 查）。
  我们的对应物：`run.generationPlan` 是意图，画布节点是投影，`landCanvasForRun` 是那个幂等 apply。
- 幂等写入用「客户端自带稳定 key」是 HTTP 生态的既成标准（`Idempotency-Key`，RFC 9110 生态的
  IETF 草案 https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/ ，2026-09-10 查）：
  **去重判据属于被调用方（写边界），不属于每个调用方各写一份**。
  **结论**：把两处手写去重（`src/workbench/capability/capabilityApplyHandler.ts:625` 与
  `src/workbench/capability/multiShotCanvasLanding.ts:66`）下沉到 `create_canvas_nodes` 这一个写边界
  （`src/workbench/generationCanvas/agent/applyCanvasToolCall.ts:326`），调用方只负责给稳定 key。

## ④ TikHub 自媒体里怎么说？

- 本轮**没查成**（TikHub 检索本轮未执行，key 只在 env、本任务是纯内部数据流修复，
  外部创作者讨论对「主进程 Run ↔ 渲染层画布的落地时机」没有可引用的一手经验）。
  诚实记一笔：这一格是空的，不假装查过。

## 结论

四条全部指向**复用**：落地链复用 `landCanvasForRun` / `canvasLandingOperationId`；绑定复用
`plan.bind-shot-nodes`；默认模型复用主进程 owner 的现成 IPC 投影；模型 meta 复用 `buildPlannedNodeMeta`；
去重按生态惯例下沉到写边界。**本任务不新建任何并行实现**，净新增的只有「候选模型身份进落地报文」
这一个字段族和 Summary 的草稿投影。
