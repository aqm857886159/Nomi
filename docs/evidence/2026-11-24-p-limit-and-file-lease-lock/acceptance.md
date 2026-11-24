t8-r4-verify：通过

- 验收线：t8-r4-verify
- 实现线：t8-r4-impl
- 验收 HEAD：41660361cb2381e73ef6f6ed2ede3483eb401053
- 关联任务：协作看板 #1586 · 7 大替换第 ④ 刀（`refactor/p-limit-and-file-lease-lock`，基于 `origin/main` `1f4d15189`）
- 设计卡：`docs/plan/2026-11-24-concurrency-and-file-lease-lock.md`

## 1. 提交序列、同提交删旧与零重叠核查

1. **先特征测试再迁移删旧**：
   - `6b13ed751`：前置特征测试提交，锁定工作区目录锁、暂存事务 FIFO、画布写串行、浏览器下载串行与视频拆解并发上限；
   - `41660361c`：提取唯一共享文件租约模块 `electron/shared/fileLeaseLock.ts`（格式化代码行 `< 650`，未触发黄牌），同步收口 `electron/workspace/workspaceManifestLock.ts`（净删 **478 行**，diff `481` 行），将 4 处手写并发队列迁入既有 `p-limit@3.1.0`（`deconstructVideo.ts`、`workspaceManifestTransaction.ts`、`projectCanvasWrite.ts`、`browserViewMedia.ts`）；
   - `eslint-suppressions.json` 中 `electron/workspace/workspaceManifestLock.ts` 的 `hot-path-sync-fs/no-restricted-syntax` 存量精确由 **`18 → 3`**。
2. **零重叠与路径隐私核查**：
   - 核实 `electron/productionRun/productionRunLock.ts` **0 改动**（与停泊中的 `#1642` 严格零重叠）；
   - 全量 diff、提交日志与本验收报告均含 **0 处**本机绝对路径或临时目录泄露。

## 2. 独立实跑单测、变异反例与全套门岗

### 2.1 九套核心 Vitest 套件全绿（`--maxWorkers=2`，**9 passed · 83 passed | 1 skipped（仅 Windows 用例）**）
- `tests/world/world.locks.test.mjs`
- `electron/shared/fileLeaseLock.characterization.test.ts`
- `electron/shared/fileLeaseLock.test.ts`
- `electron/workspace/workspaceManifestLock.test.ts`
- `electron/workspace/workspaceManifestLock.transientRelease.test.ts`
- `electron/workspace/workspaceSaveLock.test.ts`
- `electron/browser/media/browserViewMedia.test.ts`
- `electron/projects/projectCanvasWrite.test.ts`
- `electron/video/deconstructVisionLeg.test.ts`

### 2.2 三项独立反例变异测试（3/3 必红 → `git checkout -- .` 还原 100% 复绿）
1. **M1（破坏画布同键串行 FIFO：`electron/projects/projectCanvasWrite.ts` 将 `pLimit(1)` 改为 `pLimit(2)`）**：运行 `electron/projects/projectCanvasWrite.test.ts` → **1 failed (1)**（同项目第 2/3 个写任务提前并发越序，`exit=1`）。
2. **M2（跳过锁释放前 owner 校验：`electron/shared/fileLeaseLock.ts#release` 注释 `assertOwned(expected)`）**：运行 `electron/shared/fileLeaseLock.test.ts` → **1 failed / 4 passed (5)**（旧持有者释放新租约未抛 `Lost`，`exit=1`）。
3. **M3（禁用过期租约接管：`electron/shared/fileLeaseLock.ts#reclaim` 改为始终抛 `errors.busy()`）**：运行 `electron/shared/fileLeaseLock.test.ts` → **1 failed / 4 passed (5)**（租约过期后新持有者无法接管、误报 `Busy`，`exit=1`）。
4. **还原复绿**：`git checkout -- .` 恢复干净后复跑 `projectCanvasWrite.test.ts` + `fileLeaseLock.test.ts` → **2 passed / 6 passed (`exit=0`)**。

### 2.3 全套串行静态与治理门岗（9/9 全绿 `EXIT=0`）
- `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`：✅ 0 错
- `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit`：✅ 0 错
- `node scripts/check-test-types.mjs`：✅ `src/` 0 错（存量 10 个只减不增）
- `NOMI_BASE_REF=origin/main node scripts/check-self-written.mjs`：✅ 177 领域目录 · 65 登记 · 新增 4 文件 0 未认领
- `NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs`：✅ 11 改动文件 · 0 错误 · 0 新增警告
- `pnpm run check:boundary-owners`：✅ 通过（残留锁恢复边界锚点平滑迁移）
- `pnpm run check:concept-owners`：✅ 通过（0 新增第二写口）
- `node scripts/check-file-sizes.mjs`：✅ 0 红牌超限，且 `electron/shared/fileLeaseLock.ts` 格式化代码行 `< 650`（零黄牌告警）
- `pnpm run check:i18n`：✅ 22/22 单测 + 6623 keys 全绿

## 3. 未验证范围说明
- 真实 Windows `FileShare.Read` 共享锁冲突（本机为 macOS，EPERM/EACCES 释放退避已由故障注入单测覆盖）、桌面用户走查与真实账号付费均诚实记为 `unverified`；`productionRunLock.ts` 接入留待 `#1642` 合入后跟进。
