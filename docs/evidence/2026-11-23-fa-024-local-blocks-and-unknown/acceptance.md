fa-step1-verify：通过

- 验收线：fa-step1-verify
- 实现线：fa-step1-impl
- 验收 HEAD：3a18ae6cf6464cd75fa74ae06b59041f32406d28
- 关联任务：协作看板 #1586 · PR #1635（F-A 第一刀：0.24 失败分类跨边界保留与渲染层终态停止重试）

## 1. 收窄后范围与变更核查

针对 `pre-push`（`electron/productionRun/referenceLinkDispatchLedger.test.ts` 抓出的 S3 过期预签名链接 `403 AccessDenied` 走私有 `uploadsTo` 场景），本分支已将 `electron/assets/providerMediaFetch.ts` 与 `docs/engineering/concept-owners/asset.reference-link-liveness.json` 干净还原至 `origin/main`（将 Range-403 + `anonymousAssetHosting=deny` 统一并入 `#1586` 已获批的第 2 刀 `RW-2 assetLocalization.ts`）。

相对 `origin/main` 共变更 15 个文件：
- **生产代码（4 个 · 3 项精准收口）**：
  1. `electron/tasks/taskIpcGuard.ts`：识别透明适配器外壳 `ApimartGenerationProviderError` 并取其 `cause` 内的既有 `VendorRequestError` 原样透传 `structured` 字段（保留外层 `SubmissionNotDispatchedError` 优先级，不在 IPC 边界二次归类，`vendor-failure-one-home` 零增长；实查 PR #1617 全部 19 个文件与本分支**零文件重叠**）。
  2. `electron/productionRun/productionGenerationMaterialization.ts` + `electron/productionRun/productionGenerationSubmission.ts`：新增 `polledFailureMessage`，在轮询终态失败时保留参考图拒绝原话优先级，并把已分类的 `category / httpStatus / upstreamCode / logicalCode` 经 `vendorFailureFacts` 落盘可读投影持久化（未分类失败仍沿用通用兜底句）。
  3. `src/workbench/generationCanvas/runner/generationRetryPolicy.ts`：已带机器可识别错误码（`matchNomiErrorCode`）或供应商结构化错误（`parseVendorErrorFromMessage`）的终态失败立刻终止渲染层自动重试，消除单镜 3 次、9 输入 27 次、2 镜批量 6 次的重复放大（`27 → 9`）。
- **治理与登记（7 个）**：`docs/fixes/2026-11-23-fa-local-blocks-and-unknown-telemetry.root-cause.json`、`docs/plan/2026-11-23-fa-generation.md`、`docs/engineering/direction-checks/2026-11-23-fa-generation.md`（开头已写明独立复盘线身份）、3 份概念登记（`canvas.generation-retry-policy.json`、`diagnostics.generation-error-copy.json`、`production.generation-observation-lifecycle.json`）、逃逸账本 `tests/ux/full-walk/escapeLedger/USER-20261123-fa-generation.json`（`status: "fixed"`、`fixedInPr: 1635`、`manualReview: "reviewed"`）。
- **回归测试（4 个）**：`electron/tasks/taskIpcGuard.test.ts`、`electron/productionRun/productionGenerationSubmission.referenceRefusal.test.ts`、`src/workbench/api/generationTelemetry.test.ts`、`src/workbench/generationCanvas/runner/failedAttemptIdentity.test.ts`。
- **路径隐私核查**：全量 diff 及本报告均含 **0 处**本机绝对路径或工作树路径泄露。

## 2. 独立实跑命令与结果（在 `3a18ae6cf6464cd75fa74ae06b59041f32406d28` 实跑）

### 2.1 核心变更单测与回归守卫（`npx vitest run --maxWorkers=2` / `--maxWorkers=1`）
- **4 套变更单测全绿（60/60）**：
  - `electron/tasks/taskIpcGuard.test.ts`：3/3 passed（直抛与 `ApimartGenerationProviderError` 包装均保留分类）
  - `electron/productionRun/productionGenerationSubmission.referenceRefusal.test.ts`：11/11 passed（Canvas Run / Catalog Run 落盘重读保留 `quota` / `model_not_found`）
  - `src/workbench/api/generationTelemetry.test.ts`：36/36 passed（Workbench / Canvas 经真实 IPC 编码记录非 `unknown` 类别）
  - `src/workbench/generationCanvas/runner/failedAttemptIdentity.test.ts`：10/10 passed（单镜图/视 1 次、9 输入 9 次、2 镜批量 2 次，`27 → 9`）
- **参考图探针与派发账本回归全绿（45/45）**：
  - `electron/productionRun/referenceLinkDispatchLedger.test.ts`：7/7 passed（S3 过期预签名链接 403 走私有上传等全部回归绿灯）
  - `electron/assets/providerMediaFetch.probe.test.ts`：38/38 passed

### 2.2 独立变异反例测试（验证「什么都不做 / 退回旧实现」必红）
1. **M1（移除 `generationRetryPolicy.ts` 的已分类错误拦停）**：运行 `failedAttemptIdentity.test.ts` → **4 failed / 6 passed**（单图/单视退回 3 次、9 输入退回 27 事件、2 镜批退回 6 次，`exit=1`）。
2. **M2（移除 `taskIpcGuard.ts` 的 `ApimartGenerationProviderError` 解包）**：运行 `taskIpcGuard.test.ts` → **1 failed / 2 passed**（`wrapped=true` 丢失类别变红，`exit=1`）。
3. **恢复复绿**：`git checkout -- .` 后重跑全部恢复全绿。

### 2.3 仓库门岗实跑（均在 `3a18ae6cf6464cd75fa74ae06b59041f32406d28` 实跑通过）
- `node ./scripts/check-concept-owners.mjs`：✅ 通过（400 概念 · 写接口 1049 个 · 第二写口 0 新增 · 未登记共享边界 0 新增）
- `node ./scripts/check-escape-ledger.mjs`：✅ 通过（171 条真实账本绿，`USER-20261123-fa-generation` 为 `fixed`、`fixedInPr: 1635`）
- `node ./scripts/check-root-cause-contracts.mjs`：✅ 通过（4 个高风险生产文件均有合同和变化中的回归测试）
- `node ./scripts/fix-churn.mjs --range origin/main..HEAD`：✅ 通过（2 个热点 fix 提交均带有效 `Direction-Check`）
- `check:filesize` / `check:self-written` / `check:boundaries` / `check:boundary-owners` / `eslint`：✅ 全绿

## 3. ★9 验收条款与未验证范围核对
- 已知失败类别经直抛 / `ApimartGenerationProviderError` 包装 / Run 落盘重读保持一致，真实未分类失败保留兜底：✅ 已核
- 机器已分类未派发失败不再因 `timeout` 字样在渲染层重跑 3 次（`27 → 9`），新显式意图照常执行：✅ 已核
- `referenceLinkDispatchLedger.test.ts` 7/7 全绿，S3 过期预签名链接 `403 AccessDenied` 走私有上传保护完整无回归；Range-403 + `anonymousAssetHosting=deny` 统一并入第 2 刀 `RW-2`：✅ 已核
- 真实付费 / 线上大盘回落验证：本轮零付费调用，线上大盘占比与单安装集中度回落按 `unverified` 记账，按合同于 `2026-11-30` 复查。
