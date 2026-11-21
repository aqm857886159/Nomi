# 方向检查：Agent 回执与画布落地（L-agentsay）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

### 0. 一句话根因
「画布上现在有什么」有一个主人（落地宿主 + Run 账本里的节点绑定），但 Agent 回执另写了一份静态说法；分镜表「每个 Run 一张」的判据则取在若干 await 之前，不在建表那一刻。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 本次 1：回执说「画布上还没有节点」 | `nextActionFor` 对 draft_shots 回写死的一句话 | 回执不从事实 owner 派生（与此前 `edit_timeline` 静态卡片句同一类，已有 `check:announced-card`） |
| 本次 2：同一 Run 两张分镜表 | `materializeShots` 开头判一次「已有表」，await 之后才建 | 幂等判据取早了（check 与 write 之间隔着 await） |
| `multiShotCanvasLanding.ts` 近 14 天另外 8 个 fix（幂等章、detached 纠正、项目切换、existingOnly、结果回填、undo 保留结果等） | 各自是落地链上不同时刻的缺口 | 同一文件多个相邻缺口，本次这一条是其中「check 与 write 之间的 await」这一格 |

### 2. 为什么这一类会一直出现
落地是 fire-and-forget 加渲染层异步写，调用方（回执、跟随者、补齐）都在不同时刻读它的结果；每个读者各自推断「落没落」，而不是读同一份结论。本次把回执改成读落地宿主的单一结论，并把建表判据挪到写点。落到铁律 ⑫「点了=以为的」：用户让 Agent 加节点，以为 Agent 说的就是画布上的。结账挂 `tests/ux/full-walk/escapeLedger.json` 的 `FB-20261007-agent-receipt-contradicts-canvas`，类检查是矩阵测试 `electron/agentLane/laneExtendedTools.test.ts`（五种落地情形）与 `electron/productionRun/agentDraftSingleLedger.test.ts`。

### 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 新增的 Agent 写动词（节点类）回执又写死一句话 | `pnpm run check:announced-card`；`rg "userSees: '" electron/agentLane/laneExtendedTools.ts` 数静态句 |
| 渲染层别的「先判后写」派生视图（组、表）再出现重叠落地重复 | `src/workbench/capability/multiShotCanvasLanding.test.ts` 重叠落地用例；对组的判据本来就在 await 之后重读，已核 |

### 4. 靶子独立性检查
测试替身是本线写的，但真实路径用例（`agentPanelSpendConfirm.e2e.test.ts`）走真传输、真草稿账本、真落地宿主，只替换渲染层的节点创建；变异（回执改回静态句、落地后不等 settle、建表前不再读）各自必红。没有评测分数参与。

### 5. P0
「落没落、落成哪几个节点」是我们领域（镜头与画布）的事实，不是通用能力；复用现有落地链与 Run 账本，不新增第二份状态，新增的只有一个只读的结果结构与它的措辞渲染点。

### 6. 对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无对应现成库 | - | - | 否 |
| 补 | 把静态句改成另一句 | 小 | 下一个动词再来一次 | 否 |
| 重写（限一个模块） | 重做落地链 | 大 | 大，且 8 个相邻 fix 的行为都要重钉 | 否 |
| 删 | 删静态句，回执改读落地宿主结论；建表判据挪到写点 | 小 | 低 | 是 |

### 7. 用户要权衡的核心
没有要拍板的产品权衡：只是让 Agent 对画布的陈述等于画布事实。需要用户知道的一点：`multiShotCanvasLanding.ts` 这个文件近 14 天已经被修了 9 次，值得单独排一次「落地链」的结构复盘（本线不做）。

## 特征测试清单
`src/workbench/capability/multiShotCanvasLanding.test.ts`（34 条现状全绿，另加重叠落地 1 条）、`electron/productionRun/agentDraftSingleLedger.test.ts`、`electron/capabilityCore/agentPanelSpendConfirm.e2e.test.ts`、`electron/agentLane/laneExtendedTools.test.ts`。
