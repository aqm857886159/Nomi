# Model-listing parity fixture direction check

## 0. 一句话根因

测试通过进程级 `process.env` 共享状态传递 fixture 设置根；Vitest fork 复用使状态跨文件泄漏，局部 pin/restore 只是第二个生命周期补丁。

## 1. 归类表

| 症状 | 直接原因 | 类根因 |
|---|---|---|
| model-listing parity 偶发读到错误 catalog/preferences | 环境变量直接写删且没有统一恢复 | 测试基础设施没有共享的环境生命周期边界 |

## 2. 为什么会反复出现

每个测试自行管理 `process.env`，新增入口就能绕过现有夹具。局部 pin helper 只能覆盖 parity 一个调用者，无法阻止其他测试文件留下同类状态。

## 3. 不改结构的可验证预测

1. 继续增加直接 `process.env` 写删会重新引入跨文件污染。
2. 新增 parity helper 会继续扩大需要手工 restore 的边界。

验证：静态 lint 阻止直接写删；环境恢复 regression 在 `electron/testEnvironmentIsolation.test.ts` 中覆盖跨测试生命周期。

## 4. 独立性检查

静态门和 regression test 与 parity implementation 分离；两者均验证共享 Vitest 配置边界，而不是重复 parity 断言。

## 5. P0 / 现成方案

`vi.stubEnv` 与 Vitest `unstubEnvs` 是现成的测试环境生命周期能力，满足需求；不保留自写 parity pin helper。

## 6. 选项与推荐

| 选项 | 代价 | 风险 | 结论 |
|---|---|---|---|
| 保留每个 fixture 的 pin/restore | 继续维护调用点，容易漏 restore | 同类泄漏可从其他测试入口回来 | 不选 |
| 统一 `vi.stubEnv` + `unstubEnvs`，删除局部 helper | 需迁移既有测试写删 | lint 和 regression 共同守住边界 | 推荐 |
| 改产品设置根实现 | 触碰正式运行语义 | 改变用户数据路径 | 不选 |

## 7. 核心权衡

牺牲一次性迁移成本，换取所有测试入口共享同一生命周期边界；以后新增测试不能静默绕过它。
