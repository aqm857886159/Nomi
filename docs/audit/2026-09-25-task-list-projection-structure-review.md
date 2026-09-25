# 任务列表投影的结构评审（症状簇触发，2026-09-25）

> 状态：已完成（2026-09-25）· 触发：`check:symptom-cluster` 在 `2026-09-25-task-center-state-owner` 加入后报了两个模块——
> `electron/productionRun`（2026-09-19 到 09-25，17 份根因合同）与 `src/workbench`（同窗口 59 份）。
> 对应合同：`docs/fixes/2026-09-25-task-center-state-owner.root-cause.json`、`docs/fixes/2026-09-25-agent-code-block-skin.root-cause.json`。
> R21 的要求：同一层 7 天里第三份合同出现后，先回答「这一层的结构有没有问题」，再继续修。

## electron/productionRun：十七份合同放在一起看

按各合同的 `class_root` 归类（`docs/fixes/2026-09-19` … `2026-09-25` 里 scope 碰到这一层的全部十七份，读的是 class_root 与 scope，没有逐份复核其修复）：

| 归类 | 合同 | 共同的缺口 |
|---|---|---|
| 花钱授权的边界（范围、快照、预算、未知价、信任档） | `generation-scope-and-dismissal`、`production-reference-snapshot`、`run-budget-precision`、`unknown-price-blocks-generation`、`external-trust-level-gate-bypass`、`permission-tier-single-owner` | 一笔钱「批了什么、能花多少、谁有权批」没有在最早的共享边界上一次判定，各入口各判 |
| 「等用户」这件事的 owner | `waiting-for-user-one-owner`、`generate-waits-in-preflight`、`present-drifts-the-idempotency-key` | 等待、出价、幂等键挂在会被旁路改写的状态上，第二个地方替第一个地方判 |
| 身份与记账 | `core-task-identity`、`task-absence-domain`、`draft-receipt-facts`、`agent-plan-one-home` | 任务身份、缺席、回执事实在不同出口各写一份 |
| 读路径的性能 / 夹具 | `run-journal-validation-work`、`fixture-budget-pin-blocked-priced-walkthroughs`、`composer-lifecycle` | 读日志重复校验、夹具路径没对齐真实路径、渲染层临时状态的寿命 |
| **列表投影**（本次） | `task-center-state-owner` | 列表 IPC 返回的形状和它声明的类型不一致 |

**结论：这一层的结构问题是真的，而且只有一个形状——同一个事实被多个出口各自投影。** 按各合同自己的声明，前四类在过去一周
已各自收口到单一 owner（授权信封、审批闸、Run 账本、`electron/shared/contracts/*`）；从 class_root 看，没有哪一类在收口之后
又以同一个根因回来——后来的合同都是同一形状的**新出口**。

本次暴露的是同一形状的**读侧**：`registerProductionRunIpc` 在服务模式下 `list` 走的是 `service.listFull`（完整 Run），
而桥类型 `DesktopProductionRunBridge.list` 声明的是 `ProductionRunSummary[]`。于是只在投影里派生的字段
（`draft` 摘要、计划的在场）永远到不了渲染层，而渲染层拿到的完整 Run 又让它「能用」——类型说谎、行为碰巧能跑。
本 PR 已做：列表在两种模式下都走唯一的投影 `summarize`（带计划的在场两格），删掉 `listFull`。

**给这一层的判据（留给后来的人）**：一个 IPC 返回值，渲染层的类型如果比主进程实际给的**窄**，就是在说谎——
要么主进程收窄到类型（本次做法），要么类型放宽到真实形状，**不许**两边各说各的。
顺带发现：`service.listProjections`（`electron/productionRun/productionRunService.ts`）在全仓零调用方，是存量死代码
（第三份「列表」出口，虽然没人用）；本 PR 已一并删掉，列表只剩 repository 的 `list` 一个出口。

**是否需要先做结构改造再继续修**：不需要。四类已收口，本次这一类已在本 PR 收口；这一层的密度来自 P4 多镜 + 花钱确认这一周集中落地，
不是同一个 bug 反复回来。

## src/workbench：这一簇里本次碰到的两个子层

`src/workbench` 这个模块键是整个渲染层工作台（两级目录），59 份合同覆盖画布、Agent 面板、创作、任务中心等所有面，
同一周已有 `docs/audit/2026-09-24-v022-feedback-structure-review.md`（「入口统一之后，没人回头扫一遍这个入口承诺的事还有谁在判」）。
本评审只回答本次两份合同碰到的两个子层：

| 子层 | 本次的缺陷是否在这一层 | 结构判断 |
|---|---|---|
| `src/workbench/common/NomiMarkdown.tsx` | 是：唯一的 Markdown owner 只给上游代码块换了颜色，没有拥有它的形（双层框、横滚、一律等宽） | 结构本身是对的（一个 owner，所有面经它渲染），缺的是 owner 没把上游默认外观当成自己要管的东西。已在 owner 内收口，所有读者同时受益 |
| `src/workbench/taskCenter` + `src/workbench/production` | 是：分组、汇总、状态签文案、标签表在按钮、面板、卡片、store 里各自现算 | 与 09-24 那份评审同一个形状：`docs/plan/2026-08-02-task-center-queue.md` 原本规定「分组/排序/可取消性全在纯函数，组件只画」，后来加制作 Run、导出任务时逻辑长回了组件。已收回 `TASK_CENTER_GROUPS` / `summarizeTaskCenterRows` / `isProductionRunTask` / `productionRunLabels`，并登记概念 owner |

**给这一层的判据**：往任务面板加一种新任务时，只允许加一个「该任务状态 → `TaskCenterGroup`」的映射函数；
在 `TaskCenterPanel` / `TaskCenterButton` 里写 `row.group === …` 之外的状态判断，就是第二个 owner。

**是否需要先做结构改造再继续修**：不需要。两个子层的 owner 都已存在，本次是把跑出去的判断收回 owner。

## 结论

- `electron/productionRun`：结构问题（同一事实多出口投影）真实存在，已按类逐个收口；本次收掉读侧的列表投影。可以继续。
- `src/workbench`：本次两个子层的缺陷都在 owner 内收口，且与 09-24 评审同形状；可以继续。
