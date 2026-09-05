# 在途战线占道公告牌（active lanes）

> **谁读这份**：任何要动共享面（多条战线都会碰的目录 / store / 契约）的会话。这是把编排者记忆里的「占道公告牌」仓库化——会话会死，占道信息必须外化在盘上（同 `agent-orchestration-playbook.md` §5 的原则）。
>
> **维护规则（动共享面前必查必登）**：
> 1. **必查**：动任何共享面前先查本表——你要碰的文件面已被占道 → 避让，或找占道分支 / PR 协调；冲突落在占道文件上时按 playbook §9 解冲突三查，禁盲选边。
> 2. **必登**：自己开新战线要占共享面 → 先在本表加一行（分支 / 热点文件面 / 避让规则），随任务首个 PR 或单独 docs commit 落仓。
> 3. **必销**：战线合入或废弃后删掉那一行。本表只登**在途**，不留历史（历史去 PR / DELIVERY-LEDGER）。表空了也留着骨架。

## 在途车道（2026-09-02 登记）

| 车道 | 执行体 / 分支 | 热点文件面 | 状态与避让规则 |
|---|---|---|---|
| **M2 生成纵切** | Codex，分支前缀 `m2/*` | `electron/projectAgentHost/` + 生成域（生成管线 / 画布生成节点） | 在途。别的战线勿动 projectAgentHost 与生成域核心；要动先与 M2 协调 |
| **Agent 界面实施（交互 epic）** | **未开工**。设计已拍板：裁决包在分支 `docs/agent-ui-redesign-20260901`（`docs/design/2026-09-01-agent-ui-final-redesign.md` + `…-redesign-decisions.md`） | `src/workbench/ai/`（驻留壳）+ 画布右槽 | 验收合同 = 同分支**双层 conformance spec**：`2026-09-02-agent-ui-conformance-testspec.md`（界面层）+ `…-functional-conformance-testspec.md`（行为层）。开工前动这些面的改动都要能被该合同兼容 |
| **架构二期（archetype 归一）** | `arch/phase2-archetype-consolidation`（PR #310） | `src/config/modelArchetypes/`、`electron/shared/videoCapabilities/` | 收口中。**模型接入线避让**：新模型档案 / 能力面改动等它合入再动这两个面 |
| **旅程债返工** | `journeys/debt-rework-20260902` | 旅程走查（`tests/ux/`） | 在途 |
| **画布拖动性能战役（S3/S4）** | S3 `fix/canvas-drag-s3-offcanvas-20260901`；S4 Codex，`perf/canvas-drag-s4-kernel-20260902`（clone `nomi-codex-s4`） | `src/workbench/generationCanvas/reactFlow/` + 画布 store 拖动几何 | 在途。别的战线勿动拖动路径；perf 验收锚 = baseline md 固定复现命令，**不许移靶**（playbook §7） |

## 冻结接口（勿依赖 · 勿清理）

- **`generationAi*` composer 态 + 过渡版驻留壳 = C9 开闸删，新功能勿依赖**。指 `src/workbench/generationCanvas/store/canvasStoreTypes.ts` 的 `generationAiCollapsed` 与拆解槽互斥标志一族，及 `src/workbench/ai/ProjectAgentResidentShell.tsx`（前身 `CreationAiPanel` 已随 M1 round-3 `d270d34e` 删除）。C9 = Agent 界面 epic 开闸时删旧 composer 态 + 拆解 handoff 重接（定义见 `docs/design/2026-09-01-agent-ui-final-redesign.md` §5，分支 `docs/agent-ui-redesign-20260901`）。现在依赖它 = 给 C9 开闸添返工。
- **~~`agentHostEnabled=false` 不是死代码~~ → 2026-09-05 闸已拆除**。`src/utils/agentHostPreference.ts` 与 `src/workbench/settings/AgentHostSection.tsx` 已随开闸删除（不是把默认值翻真——那会留成逃生口，P1）；常驻 Agent 现在对所有用户无条件渲染，未完成处由面板 header 的 Beta 徽标明说。回归锚在 `src/workbench/ai/ProjectAgentResidentShell.structure.test.ts`，根因合同见 `docs/fixes/2026-09-05-agent-host-parallel-gate.root-cause.json`。**别再引入同类「默认关直到打磨完」的 UI 闸**：藏起来等于把这块 UI 移出唯一能修好它的反馈回路。
