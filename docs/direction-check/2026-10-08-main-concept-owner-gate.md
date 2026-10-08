# 方向检查：main concept-owner 门禁修复

## 0. 一句话根因

这次红灯不是单个判断漏写，而是共享边界随着生产路径演进没有在同一提交回收到概念 owner 登记，导致历史合同、实现和门岗账本分叉；重复测试 mock 还让第二写口被局部替身遮住。

## 1. 归类表

| finding | 直接原因 | 类根因 |
|---|---|---|
| 37 个 unregistered boundary | 根因合同声明了新的共享边界，但没有同步写入现有概念 `write_api` | 合同与 owner 登记不是同一提交的结构性约束 |
| 2 个 duplicate owner | bench/mock 和生产实现各自定义同名写口 | 测试替身可以绕过真实 owner 边界 |
| 1 个 trust mismatch | 测试门概念路径已落在主进程，登记仍写 `test` | trust_domain 没有由路径自动生成 |

## 2. 为什么会反复出现

新路径先满足局部功能，概念登记和合同在后续补；门岗只在提交时暴露分叉。测试 mock 又允许局部测试通过，直到 owner 棘轮扫描才发现第二写口。当前门岗已能冻结旧债，但还不能在合同创建时强制登记。

三条体验铁律：

- “说的=摆的”：本次合同声明的边界与登记表逐项对齐。
- “能选到”：概念 owner 表成为唯一共享边界清单，不能靠调用者自维护副本。
- “点了=以为的”：本次生产重放仍按原 arrival order 合并，相关 Vitest 83 项锁住现状。

## 3. 不改结构的预测

1. 下一个新增根因合同若不登记，`check:concept-owners` 会以新增而非冻结债红灯。
2. bench 再添加 renderer log mock，会被第二写口棘轮拦截。
3. 节点结果重放若绕过 `reapplyLandedOutcomes`，根因合同门禁会点名共享边界缺失。

验证：`pnpm run check:concept-owners`、`node scripts/check-root-cause-contracts.mjs`，以及 `node --test` 的四个 nodeRunOutcome/canvasDocumentCommit 相关文件。

## 4. 独立性检查

门岗测试和本次生产实现不在同一文件；门岗全量 21 个子测试通过，相关行为测试 4 个文件、83 项通过。没有发现 oracle 因本次改动而被放宽。

## 5. P0：自写边界与现成方案

概念 owner 登记是 Nomi 独有的领域治理数据；`nodeRunOutcome` 是画布结果落地语义，也属于 Nomi 领域。通用 JSON、Vitest、Electron 能力仍使用现成方案。本次没有新增通用基础设施。自写登记 `canvas-undo-journal-write-boundary` 仍处 under-review；它描述的是 Nomi 的撤销事实边界，短期不能替换为通用库，后续应在方向评审中单独决定是否收敛。自写登记 `gate-family` 也处 under-review；它把本仓库的门岗族谱、冻结基线和提交判据绑定在一起，现成 CI/Policy 库无法表达这套领域关系，短期继续保留；目标是在 2026-11-01 前完成一次替代方案评估，若能保留同等棘轮语义则迁移，否则继续由本登记承载。

## 6. 选项与推荐

| 选项 | 代价 | 风险 | 推荐 |
|---|---|---|---|
| 接入现成通用 owner registry | 没有能表达 Nomi 根因合同、冻结存量债和 trust 推导的现成标准；需迁移 175 个概念 | 丢失领域语义，短期阻塞发版 | 不推荐 |
| 保持概念账本，并把合同登记设为同提交约束 | 需要继续维护治理 JSON | 若漏登记会由门岗阻断 | **推荐，当前采用** |
| 只修本次 42 处文本缺口 | 最小改动 | 下一次合同会再次漂移 | 不采用 |

## 7. 用户要权衡的核心

现在用一次提交把生产边界和治理账本对齐，换取 Mac 发版恢复与后续新增边界的硬拦截；代价是以后新增共享边界必须同时登记，不能再靠事后补账。

## 特征测试清单

- `pnpm run check:concept-owners`
- `node scripts/check-root-cause-contracts.mjs`
- `src/workbench/generationCanvas/store/nodeRunOutcome.test.ts`
- `src/workbench/generationCanvas/store/deletedNodeArrivingOutcome.test.ts`
- `src/workbench/generationCanvas/store/undoKeepsLandedResults.test.ts`
- `src/workbench/generationCanvas/store/wholeWriteKeepsFacts.test.ts`
