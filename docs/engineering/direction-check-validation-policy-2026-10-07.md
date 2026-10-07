# validation-policy 方向检查

## 0. 一句话根因

画布显示 owner 的分类规则仍靠路径枚举维护；概念登记新增 `production.run-lifecycle-settle` 的 `productionRunState.ts` 写口后，枚举没有同步，导致该写口只得到 Electron 档而没有 Canvas Acceptance。

## 1. 归类表

| 提交 / bug | 直接原因 | 类根因 |
|---|---|---|
| #1078 | `CANVAS_DISPLAY_OWNER_PATTERNS` 漏掉 `productionRunState` | 分类表与概念登记不是同一份可执行数据 |

## 2. 为什么会反复出现

owner 分散在主进程、渲染层和 generationCanvas 子树；新增写口只会改变登记表，分类器不会自动发现它。现有概念核对测试能把漏项变成红灯，但修复前分类器仍会漏选档。

## 3. 预测

1. 同一概念的另一个新写口若不进入分类模式，概念核对测试会再次红。
2. 仅改 `productionRunState.ts` 的 PR 会缺 Canvas Acceptance，直到合并前测试发现。

## 4. 靶子独立性检查

失败测试和修复均位于 validation-policy 这条交付线；没有独立评测 oracle 可替代。`scripts/validation-policy.node-test.mjs:494` 直接从概念登记读取 owner / write_api，并断言 `canvas === 'full'`，是该规则的最小特征测试。

## 5. P0：现成方案

此处的路径到 lane 判定是 Nomi 的交付领域约束，现成通用库不能读取本仓库概念登记并表达 `critical` / `full` 的单调分档；保留现有共享分类函数。后续可在概念登记门岗生成该模式，替代手写正则。

## 6. 接入 / 补 / 重写 / 删

| 选项 | 代价与风险 | 结论 |
|---|---|---|
| 接入现成方案 | 没有能表达本仓库 owner 语义的通用方案 | 不适用 |
| 补现有边界 | 增加 `productionRunState` 模式，保留共享分类入口和现有测试 | 推荐，本次采用 |
| 重写分类器 | 范围大，可能改变既有 lane 判定 | 不采用 |
| 删除分类 | 会丢失 Canvas Acceptance 保护 | 不采用 |

## 7. 用户要权衡的核心

现在用一条明确模式立即封住漏项，换取未来仍需把概念登记接入分类数据生成的维护成本。


## 放行

- 2026-10-07 协调会话放行：本提交只补登记数据（`productionRunState` 进画布显示 owner 模式表），解锁 #1078。结构性收口——画布显示分类直接从 `docs/engineering/concept-owners/` 派生、不再手维护第二份路径枚举——排进门岗换底层线（`docs/plan/2026-10-07-gate-family-direction-check.md` 的后续步骤），不在本 PR 做。
