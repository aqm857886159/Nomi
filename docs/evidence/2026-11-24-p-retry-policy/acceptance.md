t8-r2-verify：通过

- 验收线：t8-r2-verify
- 实现线：t8-r2-retry-impl
- 验收 HEAD：02465c7f2885ff0e721db094a41afff6cc26c5ab
- 关联任务：协作看板 #1586 · 7 大替换第 ② 刀（`p-retry` → `electron/shared/retryPolicy.ts`，`generic-retry-loop` `3 → 0`）

## 1. 范围与抑制表清零核查

相对 `origin/main` 共变更 16 个文件：
- **依赖与共享适配层**：`package.json` / `pnpm-lock.yaml` 精确固定 `p-retry@4.6.2`（CommonJS 版）；新增 `electron/shared/retryPolicy.ts`（`exponentialBackoffMs` / `retryWithBackoff` / `pollWithBackoff`）并登记至 `docs/engineering/self-written.json`（`retry-policy-adapter`）。
- **5 处业务入口统一收口**：
  1. `electron/catalog/dreaminaCli.ts`：网络瞬断重试迁入 `retryWithBackoff`；
  2. `electron/productionRun/singleShotGenerationObserver.ts`：单镜轮询退避、生命周期 `AbortSignal` 取消与 `horizonMs` 剩余预算截断迁入 `pollWithBackoff`；
  3. `electron/telemetry/intakeQueue.ts`：离线反馈队列指数退避间隔迁入 `exponentialBackoffMs`，保留无引用定时器（`unref`）；
  4. `electron/productionRun/multiShotBatchScheduler.ts`：多镜调度等待间隔迁入 `exponentialBackoffMs`；
  5. `scripts/research/tikhub-search-lib.mjs`：TikHub 搜索瞬态重试迁入共享策略并保留 `Retry-After`。
- **`eslint-suppressions.json` 实查**：`generic-retry-loop/no-restricted-syntax` 存量严格由 **`3` 降至 `0`**（删净 `dreaminaCli.ts`、`singleShotGenerationObserver.ts`、`intakeQueue.ts` 三条抑制），且未新增任何其他规则抑制。
- **路径隐私核查**：全量 diff 及本报告均含 **0 处**本机绝对路径或工作树路径泄露。

## 2. 独立实跑命令与结果（均在 `02465c7f2885ff0e721db094a41afff6cc26c5ab` 实跑）

### 2.1 核心单测与升级/端到端任务链（全绿）
- **7 套核心 Vitest（`npx vitest run --maxWorkers=2`）：7 passed / 94 passed (94)，0 failed**
  - `electron/shared/retryPolicy.test.ts`：6/6（含 `AbortError` 短路、`horizonMs` 预算截断、边界最终读取）
  - `electron/catalog/dreaminaCli.test.ts`：10/10（瞬断重连、普通错误不重试、穷尽返回终态）
  - `electron/productionRun/singleShotGenerationObserver.test.ts`：9/9（翻倍封顶截断、取消即停、零重复提交）
  - `electron/telemetry/intakeQueue.test.ts`：25/25（指数间隔、无引用定时器、恢复清空复位）
  - `electron/productionRun/multiShotBatchScheduler.e2e.test.ts`：13/13（本地回环供应商 + 持久 Run 恢复，每镜恰一笔提交）
  - `electron/catalog/upgradeKeepsWorkingModels.test.ts`：10/10（`upgrade-path`：旧版本真实保存的目录夹具原地兼容，无需迁移）
  - `tests/world/world.locks.test.mjs`：21/21
- **TikHub 节点测试（`node --test scripts/research/tikhub-search.node-test.mjs`）**：**30/30 passed**（0 failed）。

### 2.2 三项独立变异反例测试（全部必红 → 恢复 100% 复绿）
1. **M1（`electron/shared/retryPolicy.ts:100` 去掉 `horizonMs` 剩余预算截断 `Math.min(delay, remaining)` → `delay`）**：运行 `retryPolicy.test.ts` + `singleShotGenerationObserver.test.ts` → **3 failed / 12 passed (15)**（等待序列 `[10, 15, 15, 9]` 退化为 `[10, 15, 15, 15]`，预算截断断言全红，`exit=1`）。
2. **M2（`electron/shared/retryPolicy.ts:91` 移除 `AbortError` 短路）**：运行 `retryPolicy.test.ts` → **1 failed / 5 passed (6)**（`stops on AbortError without delaying or repeating` 从 1 次膨胀为 4 次，`exit=1`）。
3. **M3（在 `electron/catalog/dreaminaCli.ts` 写回手写 `while` + `delay * 2` + `await sleep`）**：运行 `npx eslint electron/catalog/dreaminaCli.ts` → 当场拦截报错 **`generic-retry-loop/no-restricted-syntax`**（`exit=1`）。
4. **恢复复绿**：`git checkout --` 字节级还原后复跑上述 Vitest（**15/15 passed**）与 ESLint（**0 error**）全部复绿。

### 2.3 全部 7 项仓库门岗实跑（全部 `EXIT=0`）
- `node scripts/check-boundaries.mjs`：✅ 通过（0 新增越界/硬环）
- `node scripts/check-boundary-owners.mjs`：✅ 通过
- `node scripts/check-concept-owners.mjs`：✅ 通过
- `node scripts/check-self-written.mjs`：✅ 通过（`retry-policy-adapter` 已登记，0 未认领）
- `node scripts/check-file-sizes.mjs`：✅ 通过（0 超限）
- `node scripts/lint-changed.mjs`：✅ 通过（11 文件 0 错）
- `node scripts/fix-churn.mjs --range origin/main..HEAD`：✅ 通过（0 热点 fix）

## 3. ★9 与未验证范围核对
- `upgrade-path`：经 `electron/catalog/upgradeKeepsWorkingModels.test.ts`（10/10）实跑验证旧版真实目录夹具原地兼容；
- `run-e2e-chain`：经 `electron/productionRun/multiShotBatchScheduler.e2e.test.ts`（13/13）与 `singleShotGenerationObserver.test.ts`（9/9）实跑验证本地回环供应商 + 持久 Run 恢复每镜恰一笔提交；真桌面窗口关窗/物理重启与断网仍按 `unverified` 诚实记账；
- Windows 真机与真付费供应商：`unverified`（本次零付费调用）。
