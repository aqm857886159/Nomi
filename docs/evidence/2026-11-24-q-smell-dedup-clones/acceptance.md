v-1609-accept：通过

## 验收元信息

- 任务：Q-smell 第二段 PR-1（味道 ② 生产代码真克隆清零 `refactor/q-smell-dedup-clones`）
- 验收线：v-1609-accept
- 实现线：issues-1629-and-drafts
- 验收 HEAD：61f40669652d9b06a4da805723c4dbaa7e2f98db
- 验收分支：`verify/q-smell-dedup-clones`（仅追加本验收报告，未修改任何实现或测试代码）

## 1. 四处生产代码真克隆等价性与删旧核查

- **① `src/ui/browser/dialog/browserUrl.ts` 整文件双胞胎删除**：确认 `src/ui/browser/dialog/browserUrl.ts` 与 `src/ui/browser/dialog/browserUrl.test.ts` 已彻底删除，`NomiBrowserDialog.tsx` 与 `useBrowserDialogActions.ts` 均已指向唯一主人 `src/ui/browser/browserUrl.ts`；全仓 `git grep dialog/browserUrl src/ electron/` 为 **0 残留**。
- **② `electron/export/ffmpegRunner.ts`（`runFfmpegMp4Export`）**：逐行核查 `transcodeWebmFileToMp4` 与 `renderFiltergraphToMp4` 共同委派给 `runFfmpegMp4Export`，完整保留前后 `signal?.aborted` 与 `ExportCancelledError` 取消语义、流式进度回调、stderr 截断与日志落盘、`retryOnSharingViolationAsync` 长退避表（`SHARING_RETRY_LONG_DELAYS_MS`）以及 `finally` 清理 `.partial.mp4`；同步缩紧 `eslint-suppressions.json`（`generic-raw-rename` 2→1、`hot-path-sync-fs` 16→12）。
- **③ `src/workbench/assets/AssetLibraryPanel.tsx`（`renderAssetCell`）**：compact 与虚拟化网格双分支 `<AssetGridCell>` 全部收口为单一 `renderAssetCell(asset, isCompact)`，props 逐项等价无漂移；`scripts/file-size-baseline.json` 冻结上限由 `862` 收紧至 **`838`**。
- **④ `electron/providerAdapter/serviceCatalog.ts`（`upsertStagedVendor`）**：`register` 与 `stage` 共用 `upsertStagedVendor`，完整保留头清洗、隔离候选 `vendorEnabled` 判定、旧候选清理、`siblingConnectionLineageMeta` 与 `candidateLineageMeta` 语义。
- **路径隐私**：`git diff origin/main...HEAD` 与本报告本机绝对路径扫描 **0 泄露**。

## 2. 独立实跑单测与全部门岗结果（`4da295286942` 实跑）

- **8 套 Vitest（`--maxWorkers=2`，8/8 套 71/71 passed，0 failed）**：
  - `src/ui/browser/browserUrl.test.ts`（4）、`electron/export/ffmpegRunner.test.ts`（23）、`src/workbench/assets/AssetLibraryPanel.classify.test.ts`（6）、`src/workbench/assets/AssetLibraryPanelParts.test.ts`（4）、`electron/providerAdapter/serviceCatalogLifecycle.integration.test.ts`（9）、`electron/providerAdapter/serviceCatalogOwnership.test.ts`（9）、`electron/providerAdapter/registrationCatalog.test.ts`（7）、`electron/providerAdapter/registrationSameHostSecondConnection.test.ts`（9）。
- **6 项仓库门岗全绿（0 错）**：
  - `node scripts/lint-changed.mjs`：**通过**（5 个改动文件，0 错误）
  - `node scripts/check-boundaries.mjs`：**通过**（68/68，0 新增越界/硬环）
  - `node scripts/check-boundary-owners.mjs`：**通过**（2,121 条在位）
  - `node scripts/check-concept-owners.mjs`：**通过**（399 个概念 0 新增）
  - `node scripts/check-file-sizes.mjs`：**通过**（`AssetLibraryPanel.tsx` 862→838 锁定）
  - `node scripts/fix-churn.mjs --range origin/main..HEAD`：**通过**（0 热点 fix）

## 3. 独立变异反例核验（3 项全红，恢复后 100% 复绿）

| 变异反例 | 注入改动 | 目标单测结果 | 恢复后复绿 |
|---|---|---|---|
| M1 · 破坏导出共享冲突重试 | 将 `runFfmpegMp4Export` 的 `retryOnSharingViolationAsync` 替换为单次裸 `fs.promises.rename` | **红（退出码 1）**：`ffmpegRunner.test.ts` 2 条用例失败（300ms 占用与长退避 9 次尝试断言均红） | 23/23 绿 |
| M2 · 破坏 `.partial.mp4` 清理 | 移除 `runFfmpegMp4Export` `finally` 中的 `fs.rmSync(partialOutputPath, { force: true })` | **红（退出码 1）**：`ffmpegRunner.test.ts` 4 条用例失败（`transcodeWebmToMp4` 失败/日志/取消与 `renderFiltergraphToMp4` 失败清理均红） | 23/23 绿 |
| M3 · 破坏隔离候选启停保护 | 将 `upsertStagedVendor` 中 `vendorEnabled` 改为恒 `true` | **红（退出码 1）**：`registrationCatalog.test.ts` 2 条用例失败（无模型保存与隔离候选供应商未误启用保护均红） | 16/16 绿 |

## 4. 并入最新 `origin/main`（含 `#1637` `renameWithRetry`）后复验（`61f40669652d9b06a4da805723c4dbaa7e2f98db`）

- 核对合并结果：`runFfmpegMp4Export` 已改调 `#1637` 统一入口 `renameWithRetry`，`eslint-suppressions.json` 仅保留 `hot-path-sync-fs: 16 → 12`（零 `generic-raw-rename` 抑制），无本机路径泄露；
- 独立复跑 `./node_modules/.bin/vitest run electron/export/ffmpegRunner.test.ts --maxWorkers=2`：**1 passed (1) · 23 passed (23)**（`EXIT=0`）。

## 结论

`61f40669652d9b06a4da805723c4dbaa7e2f98db` 四处生产代码真克隆等价收敛干净彻底，并入 `#1637` 后 `ffmpegRunner.test.ts`（23/23）与全部门岗/变异反例全绿，零本机路径泄露，签发 **通过**。
