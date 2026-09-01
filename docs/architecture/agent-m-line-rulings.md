# M 线维护者裁决（落仓真相源）

> 为什么单独成文：Codex 沙箱读不到 GitHub API，`gh pr view 272 --comments` 在有/无代理两种模式下都连不上，裁决正文一度只活在 PR #272 评论里、进不了工作树。冻结包（owner map / tool-mapping / legacy-paths / pr-slices）因此把每条裁决都记成 OPEN QUESTION，等网络可达再补。本文件把维护者对 M 线的**全部裁决**落进 git，成为 M0–M5 唯一可引用的裁决真相源；冻结包各处的 “裁决读不到” OPEN QUESTION 改为指向本文件。
>
> 出处：PR #272 维护者评论 [issuecomment-5484766923](https://github.com/aqm857886159/Nomi/pull/272#issuecomment-5484766923) 与 [issuecomment-5485265252](https://github.com/aqm857886159/Nomi/pull/272#issuecomment-5485265252)。本文件是这两条评论正文的落仓转录 + 归位说明，不是二次演绎；若日后评论与本文件冲突，以评论原文为准并同 commit 更新本文件。

关联件：
- [执行计划](../research/2026-09-01-agent-architecture-solution-and-execution-plan.md) §6.0（I-1）、§6、§8；
- [根因总稿](../research/2026-09-01-agent-architecture-root-cause-synthesis.md)；
- [M0 owner map](./agent-m0-owner-map.md)、[50 工具映射](./agent-m0-tool-mapping.md)、[旧路径清单](./agent-m0-legacy-paths.md)、[PR #223 切片](./agent-m0-pr-slices.md)、[M1 红灯清单](../qa/2026-09-01-agent-m0-red-lights.md)；
- 交互设计 [nomi-agent-interaction.md](../design/nomi-agent-interaction.md) §14（#194 §14，批准/工作方式两轴词表）。

---

## 裁决一览

| # | 裁决主题 | 一句话结论 | 落在哪个里程碑 |
|---:|---|---|---|
| R-M-1 | 评审 I-1/I-2/I-3 定位 | 两个实测病 + `deviated` 收编 = **M1 硬前置**（附 I-3 L1 written-not-wired），M1 前不得宣称通过 | M1 |
| R-M-2 | M2 首个纵切 | 语义工具面的第一刀切 **generation 链**，同 commit 删旧 model projection | M2 |
| R-M-3 | 编排教训入自查 | ClawArena / OrchBench 三条编排教训进 M 计划自查清单 | M1–M5 每层 |
| R-M-4 | 审批/生成闸门 | 闸门 = **用户可配权限档位**；全自动档 Agent 可端到端含生成过闸；预算独立护栏 | M1 落机制 |
| R-M-5 | 工具计数口径 | 模型工具 catalog 可枚举 = **50**；`nomi_decide_generation_gate` 是 Host-only wire 契约，**不计入** | M2 |
| R-M-6 | 出处与真相源 | 裁决出自 PR #272 两条评论；落仓后冻结包 OPEN QUESTION 指向本文件 | M0 |

---

## R-M-1 — 评审 I-1 / I-2（附 I-3）是 M1 硬前置

**裁决**：执行计划 §6.0 记录的两个已复现病点，加上 `deviated` 恒 false 的收编，是进入 M1 之后**必须先闭合**的硬前置，不是“待补测试”的软欠账。M1 在这三件全部有持久化 + 类级测试 + 零副作用证据之前，不得宣称通过。

三件逐条：

1. **I-1｜productionRun 门编排破坏**（`budget-approval → shot-gates-never-open`，18 测受影响，实测 `pr223-finish@46066ed0`）。收编到 [RC-06 settlement barrier](../fixes/2026-09-01-rc-06-settlement-barrier.root-cause.json) 的 `same_class_entry_points` 与 `class_regression_tests`；门状态必须持久化、approval/receipt/预算无副作用重复，18 测恢复后再扩类级并发/重启测试。
2. **I-2｜canvasRead 挂死**（`canvasReadCapturedSnapshotFlow.test.ts:467` 挂起）。定位等待/快照 release 生命周期的共享根因，禁止用延长超时掩盖；`pending` 在 release 后必 settle，切 project B 不污染 sealed A。
3. **`deviated` 收编**（coordinator + helpers 共 9 处硬编码 `false`，只读不置真——维护者交叉验证实测 `pr223-finish@46066ed0` 上 `projectAgentExecutionCoordinator.ts` 6 处 + `projectAgentExecutionHelpers.ts` 3 处 = 正好 9 处，且全仓无任何置 `true` 的写入点，`projectAgentContracts.ts:256/267` 甚至把类型钉成字面量 `false`）。由 reducer/ledger 取得唯一 owner；报告案例与另一同类入口都能置真、重启恢复、UI projection 一致。收编到 [RC-01 durable owner](../fixes/2026-09-01-rc-01-durable-owner.root-cause.json) 的偏差写入边界。

**附 I-3（维护者评审补条）**：L1 回放测试在 PR 描述如实标 **written-not-wired**、并补 wiring；不得把“已写测试”当“已接线跑通”。维护者交叉验证实测本机 `test:agent-system:l1` = 3/3、`test:agent-system:m0-m1` = 8/8（NodeNext 编译岛 `tests/agent-system/tsconfig.json` 生效）。

**为什么是硬前置**：这三件都属“缺共享生命周期/状态 owner”，本地小场景看不出、跨轮/重启/并发才炸。当场看不出毛病的一族只能靠机器每次拦，不能靠“下轮补”。红灯记录见 [M1 红灯清单](../qa/2026-09-01-agent-m0-red-lights.md)。

---

## R-M-2 — M2 首个纵切 = generation 链

**裁决**：语义工具面（M2）的第一刀不铺全 15 个语义工具，而是先切 **generation 链**这一条纵切：`generation_plan`（context / create / patch / preview）+ `generation_status`（read / cancel / reconcile）+ 相关 Host-only 闸门（`nomi_request_generation_gate` / `nomi_start_generation` / `nomi_decide_generation_gate`）。同一提交删除旧 generation `create / submit / start / gate` 的 model descriptors，无并行 model projection、无 fallback。

**为什么选 generation**：它一条链就同时压到 M2 的三种边界——alias 合并（`nomi_operation_*` / `nomi_submit_generation_plan` / `nomi_preview_execution` 收进两个语义工具）、Host-only transition（付费/批准动作移出模型面）、按阶段投影（plan→status），是验证 `modelToolSurfaceManifest` 契约最省的一刀。对照执行计划 §8 第 4 条（“M1 通过后实现一个 semantic generation slice，并在同一提交删除旧 model projection”）与 §4 RC-02。映射细节见 [50 工具映射](./agent-m0-tool-mapping.md) 第 42–50 行与 [旧路径清单](./agent-m0-legacy-paths.md) M2 行。

---

## R-M-3 — 三条编排教训进 M 计划自查

**裁决**：把两篇编排基准的三条教训固化为 M 计划**每层自查清单**的一部分（M1–M5 每个里程碑收尾前逐条过），不是读完就忘的背景资料。

出处：ClawArena（arXiv:2606.31174）、OrchBench（arXiv:2607.25656）。三条教训：

1. **多模态回合不坍缩**：一个动作产出多个产物（图/视频/多候选）时，回合结构不能塌成单条文本；每个产物保持可寻址（threadId + seq + itemId），投影层不得把多产物压平成一段 modelText。对应 [RC-05 typed output projection](../fixes/2026-09-01-rc-05-typed-output-projection.root-cause.json)。
2. **阶段更新后旧信念复查**：script→storyboard→generate→review 阶段边界推进后，必须复查上一阶段写下的信念/摘要是否仍成立，不能把过期 summary 当现状；handoff 校验 ID/hash/budget 后才递增 contextRevision。对应执行计划 §4 RC-04（SummaryV1 + HandoffArtifact）。
3. **保关键信息优于堆并行度**：宁可少并行、也要保住关键 ID / receipt / 预算态 100% 不丢；并行度是手段不是目标，长任务里“信息完整”优先于“同时跑更多”。对应 [RC-06 settlement barrier](../fixes/2026-09-01-rc-06-settlement-barrier.root-cause.json) 的 unknown→reconcile 与 receipt 持久化。

**自查落法**：每层 PR body 的验收段新增一行“ClawArena/OrchBench 三条编排自查：多模态不坍缩 / 旧信念复查 / 保关键信息”，逐条给证据或标 N/A 并说明为何本层不涉及。

---

## R-M-4 — 审批/生成闸门 = 用户可配权限档位

**裁决**：审批与生成闸门不是写死的“永远停一次”，而是**用户可配的权限档位**；机制在 M1 落地（settlement barrier + Host policy + proposal receipt store 已是 owner）。档位词表**对齐 #194 §14**（[nomi-agent-interaction.md](../design/nomi-agent-interaction.md) §14 的“工作方式”与“批准策略”两根轴），不另造一套词。

四条规则：

1. **全自动档**（对齐 §14.2 `完全允许（本项目）`）：在当前项目沙箱内，Agent 可**端到端执行含生成过闸**——生成动作经 **Host policy 预授权放行**（非模型面按钮触发），模型不伪造真人批准；仍受硬闸拦截（花钱超预算见第 4 条、发布、删除、账号、验证码、外部写入）。“端到端含生成”指的是 Host 侧预授权，不是把 `nomi_start_generation` 投给模型。
2. **确认档**（对齐 §14.2 `自动批准安全动作`）：自动读/搜/建可撤销草稿；生成、发布、删除等高风险动作在写入或外部动作前**停点确认**（确认卡 + 点击才扣，明标价 + 明标冻结项，见 §9/§10）。
3. **手动档**（对齐 §14.2 `逐步确认`）：每个项目写入或外部动作前全人工确认，全部硬闸。
4. **预算是独立护栏**：预算与档位**正交**——即使全自动档，**超预算仍问**；预算护栏不被任一档位关掉。对应执行计划“把‘能不能做’与‘要不要花钱’分开”。

两轴不串（§14 硬规则）：改变**工作方式**（Ask / 编辑选中 / Agent）**不隐式扩大批准策略**；批准策略也不扩大 workspace / 项目沙箱。切到 Agent ≠ 全权。owner 归属见 [owner map](./agent-m0-owner-map.md) 的 “approval / proposal receipt / ProjectLease 绑定” 行（Host policy + proposal receipt store）。

---

## R-M-5 — 工具计数口径：50 可枚举，wire gate 不计入

**裁决**：模型工具 catalog 的**可枚举 descriptor 数 = 50**（`agentToolCatalog`：document 6 + canvas 10 + timeline 14 + production 10 + skill 1 + generation 9）。`nomi_decide_generation_gate` 是 generation dispatcher / 规格里的 **wire-level 入口**，Pi catalog 注释明确“不投影”，因此**单列为 Host-only wire 契约、不计入这 50**。

> 口径归属：两条被引评论未逐字讨论工具计数，这条是**冻结包自身的核账口径**（映射表逐行 1–50 已列、第 50 行口径说明），落在维护者“带条件采纳、修正落进本 PR 后即可合入”的放行范围内；此处把它从 tool-mapping 的 OPEN QUESTION 提升为定论，作为 M2 的计数基准。若 M2 实现时发现 catalog 实际可枚举数与 50 不符，以代码实数为准并同 commit 更新本条与映射表。

这条收口了 [50 工具映射](./agent-m0-tool-mapping.md) 第 60–66 行与执行计划 §6/RC-02 之间“50 vs 49+1”的表述差：
- catalog 可枚举对象实数 = **50**（映射表逐行 1–50 已列）；
- 额外的 `nomi_decide_generation_gate` **不在**那 50 里，作为 Host-only wire contract 单列；
- 不得为凑数把 `nomi_session_open` 或旧 alias 填成不存在的 descriptor。

**M2 落法**：50 个可枚举 descriptor 按映射表 `keep/merge/host-only/delete` 收敛为 12–15 个语义工具；`nomi_decide_generation_gate` 保持 Host-only wire，不进 `modelToolSurfaceManifest` 的模型可见集。

---

## R-M-6 — 出处与真相源纪律

**裁决**：以上 R-M-1..R-M-5 的出处是 PR #272 的两条维护者评论（[issuecomment-5484766923](https://github.com/aqm857886159/Nomi/pull/272#issuecomment-5484766923)、[issuecomment-5485265252](https://github.com/aqm857886159/Nomi/pull/272#issuecomment-5485265252)）。落仓后，冻结包各处原先的 “维护者裁决不可达 / 读不到” OPEN QUESTION 全部改为指向本文件，不再各自留悬空问号。真相源单一：裁决住在本文件，冻结包各件只引用不复制。

已归位的 OPEN QUESTION：
- [owner map](./agent-m0-owner-map.md) §“三种状态不可越权”末尾的裁决 OPEN QUESTION → 见本文件 R-M-1/R-M-4；
- [50 工具映射](./agent-m0-tool-mapping.md) 第 50 行口径 OPEN QUESTION → 见本文件 R-M-5。

（[旧路径清单](./agent-m0-legacy-paths.md) 与 [PR #223 切片](./agent-m0-pr-slices.md) 末尾仍各自保留“若评论要求不同顺序则以原文覆盖”的说明；本文件确认这两处的方案顺序与 R-M-2/R-M-3 一致，未被评论推翻。）
