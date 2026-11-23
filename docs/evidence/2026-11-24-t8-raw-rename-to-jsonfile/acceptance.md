v-1609-accept：通过

## 验收元信息

- 任务：7 大替换 · `generic-raw-rename`（主进程裸 `fs.renameSync` / `fsp.rename` 全量收回 `electron/jsonFile.ts`，`24 → 0`）
- 验收线：v-1609-accept
- 实现线：t8-rename-impl
- 验收 HEAD：df8dab8645b6e98daf0f9b5cb08983b3a41a0330
- 验收分支：`verify/t8-raw-rename-to-jsonfile`（仅追加本验收报告，未修改任何实现或测试代码）

## 1. 冻结抑制清零与边界唯一主人核验

- **`eslint-suppressions.json` 独立统计**：`generic-raw-rename/no-restricted-syntax` 从 `origin/main`（`640158cbd`）的 **`24`** 降至 **`0`**（17 个生产文件内的全部 24 处裸调用均已收回并同提交删除对应抑制条目）。
- **唯一主人与概念登记**：`docs/engineering/concept-owners/persistence.atomic-rename.json` 登记 `electron/jsonFile.ts` 为唯一原生 rename 边界（`write_api`：`renameSyncOnce`、`renameSyncWithRetry`、`renameWithRetry`、`writeJsonFileAtomic`），`parity_test: electron/jsonFile.test.ts`；`scripts/t8-structural-guards.mjs` 提示文案同步指向新入口且保持零豁免逃逸。
- **`door-map` 独立实测（全仓 3,177 文件，合计 56 扇门，与合同 `door_reduction.after: 56` 完全一致）**：
  - `renameSyncOnce`：10 扇写入口（12 处，保留调用方持锁事务/围栏重验单次尝试语义）
  - `renameSyncWithRetry`：12 扇写入口（19 处，复用 `sharingRetry.ts` 短退避）
  - `renameWithRetry`：7 扇写入口（8 处，复用 `retryOnSharingViolationAsync` 定时器退避）
  - `writeJsonFileAtomic`：27 扇写入口（42 处，含 `mcpDetectedClients.ts` 收回复用）
- **路径安全**：`git diff origin/main...HEAD` 严格扫描本机绝对路径与工作树前缀，结果 **0 泄露**。

## 2. 独立实跑测试与全部门岗结果（`df8dab8645b6` 实跑）

- **结构门岗单测（`node --test scripts/t8-structural-guards.node-test.mjs`）**：**9/9 passed**（验证非 `jsonFile.ts` 裸调 `fs.renameSync` / `fsp.rename` 必红、`jsonFile.ts` 豁免）。
- **3 套核心 Vitest（`--maxWorkers=2`，3/3 套 37/37 passed，0 failed）**：
  - `electron/jsonFile.test.ts`：**14 passed**（`EEXIST`/`ENOTEMPTY`/`ENOENT`/`EXDEV` 保留原错误不重试、共享冲突异步退避重试、`renameSyncOnce` 严格单次尝试）
  - `electron/productionRun/productionRunLock.test.ts`：**12 passed**
  - `electron/workspace/workspaceManifestLock.test.ts`：**11 passed**（含 `EPERM` 竞争单次尝试后立即返回 `WorkspaceManifestLockBusyError` 且不覆盖竞争方字节）
- **全部 10 项仓库门岗与静态检查全绿（0 错）**：
  - `node ./scripts/check-boundaries.mjs`：**通过**（68/68，0 新增越界/硬环）
  - `node ./scripts/check-boundary-owners.mjs`：**通过**（2,124 条声明在位）
  - `node ./scripts/check-concept-owners.mjs`：**通过**（400 个概念 · 写接口 1,050 个 · 第二写口 0 新增）
  - `node ./scripts/check-root-cause-contracts.mjs`：**通过**（7 个高风险生产文件均有合同与变化中的回归测试）
  - `node ./scripts/check-escape-ledger.mjs`：**通过**
  - `node ./scripts/check-self-written.mjs`：**通过**（0 未认领）
  - `pnpm run check:filesize`：**通过**
  - `node scripts/fix-churn.mjs --range origin/main..HEAD`：**通过**（0 热点）
  - `pnpm exec tsc -p electron/tsconfig.json --noEmit`：**通过**（0 类型错误）
  - `node scripts/lint-changed.mjs`：**通过**（21 个改动文件，0 错误）

## 3. 独立变异反例核验（3 项全红，恢复后 37/37 全绿）

| 变异反例 | 注入改动 | 目标 3 套测试结果 | 恢复后复绿 |
|---|---|---|---|
| M1 · 什么都不做 | 将 `renameWithRetry` 改为直接 `Promise.resolve()` 空实现 | **红（退出码 1）**：`jsonFile.test.ts` 5 条用例失败（非共享错误透传与异步共享冲突退避全红） | 3/3 套 37/37 绿 |
| M2 · 全部拦下 | 将 `renameSyncOnce` 改为无条件抛出 `EACCES` | **红（退出码 1）**：3 文件 30 条用例失败（`jsonFile`、`productionRunLock`、`workspaceManifestLock` 全线拦截） | 3/3 套 37/37 绿 |
| M3 · 破坏单次尝试契约 | 将 `renameSyncOnce` 改为包裹 `retryOnSharingViolation` 重试 | **红（退出码 1）**：2 文件 2 条用例失败（`jsonFile.test.ts` 与 `workspaceManifestLock.test.ts` 实测调用 6 次 ≠ 预期 1 次） | 3/3 套 37/37 绿 |

## 4. 诚实边界

- 本次在 macOS 上通过真实临时文件与单测矩阵验证成功发布、覆盖、失败原错透传与竞争单次尝试；Windows 真实句柄共享冲突与 Electron 全流程桌面回放记为 `unverified`。

## 结论

`df8dab8645b6e98daf0f9b5cb08983b3a41a0330` 已将 `generic-raw-rename/no-restricted-syntax` 从 `24` 彻底清零至 `0`，9/9 结构守卫、37/37 核心单测、3 项变异反例及 10 项仓库门岗全绿，零本机路径泄露，签发 **通过**。
