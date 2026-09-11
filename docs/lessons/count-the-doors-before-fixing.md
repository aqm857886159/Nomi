# 修之前先数门：这份状态到底有几个入口

> 📎 教训 · 首次记录 2026-09-11 · 状态：✅ 已固化（`check:root-cause-contracts` 的 `doors` 字段 + `check:door-map`）
> **触发场景**：同一个模块这周又来了一份根因合同；或者你正准备派/接一个「这里坏了，修这里」的 bug 任务书；或者修完之后心里冒出「应该没别的地方了吧」。

**结论**：动生产代码之前，先跑 `node scripts/door-map.mjs <mutator 符号或文件>`，把这份状态的**全部写入口与读入口**摆在桌面上，
再决定修在哪一层。门表进根因合同的 `doors`，减了几扇写进 `door_reduction`。**手写的门表和一句「我扫过了」是同一种东西。**

**为什么会踩**：2026-09-11 一天里连着三簇 bug，收敛到同一句话——**不变量只在一扇门上实现了，另一个入口绕过去**：

- **画布写入**：`applyCanvasToolCall` 有 6 个直接写入口——`src/workbench/capability/capabilityApplyHandler.ts:625`、
  `src/workbench/capability/multiShotCanvasLanding.ts:230`、`src/workbench/creation/storyboard/exec/storyboardRowActions.ts:97`、
  `src/workbench/generationCanvas/agent/proposalTxn.ts:256`、`src/workbench/onboarding/journeyTourStore.ts:99` 与 `:132`。
  事务门 `executeCanvasWriteTarget`（`src/workbench/generationCanvas/agent/canvasWriteTarget.ts:266`/`:448`）还隔了一跳。
  校验加在事务门上，直发那几条绕过去。
- **付费收据**：签发方只有一个（`electron/productionRun/productionRunService.ts:120` 的 `createGateApprovalOwner`），
  核验回调却有两个生产装配点（`electron/capabilityCore/runOwnedGenerationGateAuthority.ts:74`、
  `electron/capabilityCore/productionTrustGrantChallenge.ts:46`）。两处都没接，分开看都不像 bug。
- **技能事实**：`SkillRecord` 有 8 个 store 之外的消费者模块各自决定投影带哪些字段
  （`electron/agentLane/laneDesktopRuntime.ts:149`、`electron/skills/skillIpc.ts:35`/`:71`、`electron/promptLibrary/curatedPrompts.ts:6` 等，
  清单见 `docs/audit/2026-09-11-skill-fact-projections-structure.md`）。5 份合同 = 5 个消费者各被单独修了一次。

三次都被当成一处独立的 bug 修了一遍。**根因不在修的人身上，在派工上**：任务书写的是「这里坏了，修这里」，
执行体被框在一个文件里——他看得见症状那扇门，看不见另外几扇，而且扫出第七扇门只会让他的任务变大。
合同里的 `same_class_entry_points` 本来该答这一问，但它是**叙述**：作者说他扫过了，门岗只能核对格式。

**怎么用**：

- 接到 bug 任务、判为 `recurring` 时，第一个命令是 `node scripts/door-map.mjs <符号>`，不是打开症状那个文件。
- 派 `recurring` 类修复时**拆两段**：先派数门出门表，再把门表当硬约束写进修复任务书（playbook §17）。
- 门表只数**直接**调用点。隔一跳的门要再数一跳（画布那条要数 `applyProposalBatch` 才看得见 `executeCanvasWriteTarget`）。
- 改动的生产文件必须 ⊆ 门表。多出来一个文件 = 门没数全，门岗会当场报出来。
- **允许不减门，不允许无声地不减**：`door_reduction.before ≥ 2` 而一扇没减时必须写 `why_not`。

**出处**：`docs/plan/2026-09-11-door-map-rule.md`（含先查别人：Single Writer Principle / Rust 借用规则 / narrow waist / Google LSC 的调用者枚举，
以及「Claude Code 与 Codex 仓库都没有这条纪律」的负面结论）；规则条文 `docs/engineering-rules.md` R21.3；
派工侧 `docs/engineering/agent-orchestration-playbook.md` §17。
