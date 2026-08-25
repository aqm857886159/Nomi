# L6 Workflow Pack 合同格式与模式选择器分期实施计划（2026-08-26）

> 状态：实施合同；本轮只写计划，不写产品实现。
>
> 基线：本分支 `claude/stage-p5-e2`；执行每期前重新核对 `origin/main`、本文件引用的行号和当前注册表。规模是工程估算，不是承诺；**超过上限必须停下复盘，不得靠继续加代码掩盖范围漂移**。

## 0. 目标、边界与已确认事实

L6 要把第一条 Pack「小说/剧本→一集」从主方案的一行，变成可校验、可版本化、可交给 Run 执行的声明。Pack 不是新的 agent runtime，也不是第二个编辑器：它声明“这次工作由哪些步骤组成、每一步能做什么、什么时候必须问人”，Run 仍是唯一执行和持久事实源。

主方案已定的合同字段必须原样落入计划：**强度档**（重管线 / 对话主驾 / 单发直出）、目标输入、可用工具与 module IDs、步骤/分支、capability、每步 `propose|paid|project_write`、确认点位置与闸门冻结项（确认框、花费预估、过闸后不可再改什么）、失败/重启下一步、产物投影位置、版本迁移。

现状不是空白，必须先承认两套已有机制的事实：

- `electron/skills/skillManifestSchema.ts:58-79,81-109` 已有 Skill manifest、可选 `stages`、每段 tools/dependsOn/pause/skillRefs/modelPrefs；`electron/skills/playbookOrchestrator.ts:1-50,98-170` 是纯逻辑 DAG 编排器，负责阶段排序和游标，不拥有付费或项目写权限。
- `electron/productionRun/productionPlaybooks.ts:1-10,14-27,62-79` 是已实现制作 playbook 注册表；`productionRunRepository.ts:219-284` 在落盘前校验 playbook、种下 stages/gates/artifacts，`productionRunDriverOps.ts:257-333` 由 driver 继续提出方向/剧本并写入 ProductionRun。`generation.single-shot` 在 `productionRunRepository.ts:287-337` 明确绕过 legacy playbook driver。
- `electron/capabilityCore/mcpToolCatalog.ts:120-165` 的 `nomi_start_playbook` 只创建可审阅草稿，不批准预算、不调用付费模型；工具 enum 从生产注册表派生（`productionPlaybooks.ts:64-79`）。

### Pack / Skill / Run 边界（必须写成可审计不变量）

| 层 | 负责什么 | 明确不负责什么 |
|---|---|---|
| Skill / `SKILL.md` | 方法论、示例、渐进披露的知识；可被某个 Pack stage 引用 | 不铸造 capability、预算、receipt，不直接写项目或调用 provider |
| Pack | 受约束声明：强度档、输入、module/tool 组合、顺序/分支、门与投影、迁移 | 不保存游标、不执行副作用、不另建画布、不取代 Run ledger |
| Run / `ProductionRun` | 按已封存 Pack 执行；持有 stage、gate、job、预算、receipt、重启/暂停/幂等事实 | 不反向改写 Pack 历史；不把 Skill 文本当权限来源 |

### 与现有 playbook 的关系：事实与待拍板分开

当前事实是**并存**：Skill 层有 `PlaybookRun`（纯内存方法编排），Production 层有 `ProductionPlaybookDefinition` + durable `ProductionRun` driver；两者不是同一个对象，也不是互相替代。计划默认的低风险落法是“**Pack 作为声明层收编，现有生产 playbook registry 作为执行 adapter；Skill PlaybookRun 保持方法层并存**”。这样第一条 Pack 可以复用既有 `brand.promo` 阶段与 Run，不把 durable 账本搬到 Skill 层。

**待 owner 拍板的不可逆岔路 L6-DEC-1：**是否最终把 `productionPlaybooks.ts` 改名/迁移为 Pack registry（物理收编），还是长期保留 Pack registry→production playbook adapter（逻辑收编、文件并存）。本计划只实现可验证的 adapter seam，不替 owner 做物理替换；`generation.single-shot` 的 legacy bypass 也不在本计划自行解除。

## 1. 分期总览

| 期次 | 性质 | 目标 | 规模估算 | 独立回滚点 |
|---|---|---|---:|---|
| L6-0 | 盘点/契约冻结 | 锁合同字段、边界、版本与关系矩阵，不接 runtime | 新增约 180–280 行文档/fixture，代码 0 | 删除本期 contract 文档与 fixture |
| L6-1 | 声明 schema | 新建 Pack v1 schema、校验器、迁移/兼容规则；Skill/Pack 分离 | 新增约 300–500 行；删除 0 | 删除 Pack schema 目录，旧 Skill/生产 registry 不动 |
| L6-2 | 执行 adapter | 把第一条 Pack 映射到现有 production playbook + Run；只读/提案/付费/项目写权限逐步校验 | 新增约 420–700 行；删除约 80–160 行重复声明 | 关闭 adapter，回到既有 `production.start` / driver |
| L6-3 | 模式选择器投影 | 将强度档投影到现有一套画布/Agent 入口；只出行为契约和状态，不定视觉 | 新增约 260–460 行；删除约 100–180 行重复模式判断 | 停用选择器 adapter，保留默认档与 Run 历史 |
| L6-4 | 第一条 Pack 验收 | 跑「小说/剧本→一集」闭环、重启/失败/迁移与三宿主投影；形成 owner 样张输入 | 新增约 250–420 行测试/证据；删除 0 | 关闭 Pack feature exposure，历史 Run 仍可读 |

## 2. 执行卡

### L6-0 契约冻结期

- **目标**：把合同字段、三层边界、强度档含义、冻结项语义和 Pack↔playbook 关系写成无歧义 fixture；第一条 Pack 的路径固定为编剧/拆镜 → P4 生产 → P5/E1 采纳 → E2 剪辑 → 导出。
- **涉及文件**：新增 `docs/plan/` fixture/关系表（仅文档）；只读 `docs/superpowers/plans/2026-08-24-unified-agent-master-plan.md:138-158`、`electron/skills/skillManifestSchema.ts:58-109`、`electron/productionRun/productionPlaybooks.ts:14-95`、`electron/productionRun/productionRunRepository.ts:219-337`、`electron/productionRun/productionRunDriverOps.ts:257-333`。
- **验收门**：字段逐项对齐主方案；每个 stage 都标 `propose|paid|project_write`，并能指向 capability/module；明确过闸冻结的 plan hash、模型/供应商/资产版本、预算上限、目标项目/画布 revision、导出目标；fixture 证明 Skill 文本不能直接产生 side effect。
- **回滚方式**：删除本期文档/fixture；不改任何 registry、Run、Skill 文件。

### L6-1 Pack 声明 schema 期

- **目标**：建立 `WorkflowPackV1` 纯声明与校验，包含 `strengthTier` 第一字段、inputs/tool+module IDs、DAG 分支、capability 级别、gate/freeze、failure/restart、projection、migration；历史 Skill manifest 继续可读。
- **涉及文件**：建议新增 `electron/workflowPack/{packTypes,packSchema,packValidator,packMigration}.ts` 及测试；只读/适配 `electron/skills/skillManifestSchema.ts:81-109`、`electron/skills/skillStore.ts:58-92`、`electron/capabilityCore/mcpToolCatalog.ts:120-165`。不得把 `@ai-sdk/*`、provider client 或 UI 类型导入 contract。
- **验收门**：schema 拒绝未知 capability、缺冻结项、强度档缺失、module ID 不存在、DAG 环、paid 步骤无 cost estimate/confirmation、project_write 步骤无 target；迁移 fixture 覆盖 v1→v1.x、未知字段保留/拒绝策略、旧 `brand.promo` 读取；校验器纯函数 targeted Vitest 退出码 0。
- **回滚方式**：删除 Pack schema/validator；不改 `skill.json`、旧 playbook registry 和生产 Run 文件。历史 Pack 字节不回写。

### L6-2 Pack→ProductionRun adapter 期

- **目标**：第一条 Pack 只通过 adapter 绑定到现有 `ProductionPlaybookDefinition` 和 durable Run。封存前可改候选；封存后使用 Pack hash + base revision + target 生成 Proposal/合同，执行时仍由 Run/能力核决定。
- **涉及文件**：新增 `electron/workflowPack/packRegistry.ts`、`packProductionAdapter.ts`、`packCapabilityResolver.ts`、测试；接入点只调用 `electron/productionRun/productionPlaybooks.ts:62-95`、`productionRunRepository.ts:219-284`、`productionRunDriverOps.ts:257-333`、`electron/capabilityCore/mcpToolCatalog.ts:120-165`。若需扩展 `ProductionRun`，先停在 L6-DEC-1，默认用 sidecar/adapter metadata。
- **验收门**：`novel-to-episode` Pack 能产生 `brand.promo` 对应 Run 草稿，且 `nomi_start_playbook` 仍只建草稿；每个 `paid`/`project_write` 步骤先过既有 capability/receipt/Proposal 闸，`propose` 不写项目；Run 重启从 durable stage/gate 恢复；同 Pack+同 base revision 重复提交返回同 Proposal，不重复扣费；`generation.single-shot` 仍被明确拒绝走 legacy adapter。
- **回滚方式**：撤掉 Pack adapter 注册与工具暴露；既有 `production.start`、Run driver、ledger、artifact 文件原样保留。禁止只恢复某一 stage 形成半套并行实现。

### L6-3 模式选择器投影期（先契约，后样张）

- **目标**：把 `strengthTier` 投影到 Agent 主栏/项目入口/外部提示的同一模式档案：重管线（完整 Pack+门）、对话主驾（更多对话领路、仍保留关键门）、单发直出（单任务快路、仍受预算/能力核）。**这是用户可见面，必须 owner 样张拍板；本计划不设计视觉。**
- **涉及文件**：建议新增 `src/workbench/workflowPack/packModeProjection.ts`、`src/workbench/workflowPack/packModeTypes.ts`、测试；只读现有 `src/workbench/ai/CreationPromptPicker.tsx:183-210`、`src/workbench/ai/agentLoopMode.ts:15-63`、`src/workbench/production/ProductionRunTaskCard.tsx:31-80`。外部投影只经 MCP adapter，不复制 UI。
- **验收门**：同一 Pack 在 Nomi 内部、MCP tools/list/result、Run projection 显示同一 `strengthTier` 与冻结说明；模式只收窄可用 node/tool 集，不改变画布数据模型；自由挡不降级：每个自动 stage 有“返回画布/单镜手动”逃生口；任意 paid/project_write 仍走同一确认漏斗。视觉验收门标记为“需样张拍板”，没有样张不得进入实现完成。
- **回滚方式**：停用投影并回落到默认强度档；不修改 Run 的已封存 contract、画布、预算或历史 mode。

### L6-4 第一条 Pack 闭环期

- **目标**：用真实任务验证从一句小说/剧本输入到可编辑初稿、P4 生产、E1 采纳、E2 剪辑、导出；覆盖拒绝、重启、版本迁移、外部/内部宿主同语义投影。
- **涉及文件**：新增/维护 `tests/ux/workflow-pack-novel-episode.e2e.mjs`、`electron/workflowPack/*.test.ts`、`docs/audit/` 证据；E2 剪辑只复用既定 EditPlan/Proposal/Apply/Undo，不在本期另造轴。
- **验收门**：至少跑 J1（输入→方向门→Run 草稿）、J2（P4 结束→E1→E2 计划卡）、J3（中断→重启→同 Run 恢复），内部 Nomi 与 MCP 各一遍；检查 `check:walkthroughs` 只能算静态检查，必须另亲跑 Electron/Playwright 并记录 `exit=$?`、截图 mtime 与人眼判断。gates 绿不能替代走查。
- **回滚方式**：关闭 Pack 暴露/选择器入口；历史 Run 继续由旧 projection 读取，Pack sidecar 只读保留。

## 3. 不动项清单（具体保护路径）

- `electron/productionRun/productionRunRepository.ts`、`productionRunIntentLog.ts`、`productionRunService.ts`、`multiShotBatchScheduler.ts`：ProductionRun 账本、预算/收据/幂等、WAL/fencing、调度/恢复事实源，Pack 只能调用公开 API。
- `electron/productionRun/anchorCheckpoint.ts`：锚一致性和检查点 gate 永不被 Pack mode 反向放宽。
- `src/workbench/generationCanvas/agent/{proposalTxn,applyCanvasToolCall,proposalUndo}.ts` 及测试：Proposal/撤销/一步 Apply 是唯一项目写入口，Pack 不直接写 canvas。
- `electron/capabilityCore/{generationDispatcher,appIntegration,security,mcpVerify,approvalReceipt}.ts`：能力核、来源绑定、receipt 与 paid side effect 不由 Skill/Pack 声明绕过。
- `electron/events/` 与 Run 日志：两条事件日志不物理合并；Thread/Turn/Item 仍用 Nomi union；`package.json` 的 `ai@4` 不变。
- 画布：只有一套 Nomi canvas；模式档案只能声明可用节点/工具集，不得新增第二套画布或第二份资产真相。

## 4. 验收与回滚纪律

每期开始记录 `git branch --show-current`、`git rev-parse origin/main`、变更文件和 diff stat；每期独立 commit/revert。纯文档和实现都跑：

```bash
pnpm run gates > /tmp/gates-l6-pack.log 2>&1; echo exit=$?
```

`check:walkthroughs` 是静态检查，从不执行走查；体验期必须另跑真实 Electron/Playwright，保存 stdout/stderr、截图和退出码。任何 paid fixture 只使用零额度 stub，真实花费必须先走既有确认漏斗并把预估/冻结项写进证据。

## 5. 风险、未知与待 owner 拍板

1. **L6-DEC-1（最大未知）**：Pack 与 `productionPlaybooks.ts` 是物理替换还是长期 adapter 并存。现状已查明是两套机制并存；本计划默认逻辑收编，物理迁移不自行决定。
2. `SkillManifest` 的 `permissions` 是粗粒度 `read-only/create/delete/export`（`skillManifestSchema.ts:20-25,81-94`），能否无损映射到 Pack 的 `propose|paid|project_write` 尚无实现证据；若需要新 capability taxonomy，必须 owner 先定。
3. `brand.promo` 的现有阶段与第一条「小说/剧本→一集」阶段是否一一对应尚未逐段证明；adapter 期要逐 stage 给 file:line 和 fixture，不能凭名称绑定。
4. 强度档在 Agent 主栏、项目库入口和外部 MCP 结果如何呈现均属用户可见面，**需样张拍板**；本计划只规定同一字段/同一投影，不规定视觉。
5. Pack 版本迁移是否允许自动迁移已封存但未执行的 Run，或一律要求新 Pack+新 Proposal，属不可逆数据语义，**待 owner 拍板**；默认 fail-closed，不自动改写历史。
6. `generation.single-shot` 已明确绕过 legacy playbook driver；是否未来纳入 Pack 的“单发直出”档，属架构边界选择，**待 owner 拍板**，本期不解除 bypass。

## 6. 阶段完成判定

只有 schema/adapter 事实、自动化不变量、真实任务走查（涉及 UI 时含样张）、回滚演练和每条命令的真实退出码都具备，某期才可称完成。仅 `gates` 绿色不能证明 Pack 已执行、冻结项已被用户看懂，亦不能证明模式选择器体验正确。
