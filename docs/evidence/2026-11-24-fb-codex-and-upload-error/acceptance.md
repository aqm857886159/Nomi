v-1609-accept：通过

## 验收元信息

- 任务：F-B 生成素材与参数链路修复（PR #1636：`NF-1025-0001` Codex CLI 产图发现与报错透传 + `NF-1107-0002` 制作 Run 参考图上传 HTTP 413 摘要保真）
- 验收线：v-1609-accept
- 实现线：issues-1629-and-drafts
- 验收 HEAD：8e2a7f1624d7d7e47d16265b70e6191a3f16ff68
- 验收分支：`verify/fb-media-parameter-chain`（仅追加本验收报告，未修改任何实现或测试代码）

## 1. 代码与边界独立核查

- **零触碰隔离范围**：确认全程未触碰 `electron/catalog/assetLocalization.ts`（`NF-1031-0001` 剩余私有 S3 403 / Range-403 增量留给 F-A 第 2 刀 `RW-2`）。
- **`NF-1107-0002`（`electron/capabilityCore/productionReferenceUrls.ts`）**：核查已删除把 `localizeForSend` 抛出的 `asset-too-large`（HTTP 413）与 `asset-upload-failed` 覆写成 `desktopT('assetUpload.hostingDisabled')` 的 `.catch()`，导出 `localizeProductionReferenceUrls` 原样透传逐通道失败摘要、文件名、体积与 `AnonymousAssetConsentRequiredError`；概念主人 `production.reference-url-localization` 已登记。
- **`NF-1025-0001`（`electron/catalog/codexCli.ts`）**：
  - `resolveCodexGeneratedImage` 统一覆盖 JSONL `ImageGenerationItem.saved_path`、`$CODEX_HOME/generated_images/<threadId>`（含 2 层嵌套子目录且跳过符号链接）、`workDir` 新生成图（排除 `inputImagePaths` 参考图输入）与经 `contentTypeFromMagicBytes` 魔数校验的合法内联 base64 `result`；
  - 易失 `workDir` 与内联产物在 `child.on("close")` 清理 `workDir` 前经 `stagePersistentCodexOutput` 落盘至 `codexJobsDir()`，并在 `importCodexImageOnce` 成功导入项目后通过 `isPathInsideDir` 精准清理暂存副本；
  - `describeCodexFailure` 补齐 JSONL 顶层 `turn.failed`（含 `usage_limit_reached` 限流/额度归类）/ `error` / `image_generation failed`、非零 `stderr`（剥离 ANSI 并截断）与 `agent_message` 拒答说明，不吞真实上游错因；概念主人 `catalog.codex-image-bridge` 已登记。
- **逃逸账本与路径安全**：确认 `tests/ux/full-walk/escapeLedger/USER-20261124-fb-codex-and-upload-error.json` 已结账 `status: "fixed"`、`fixedInPr: 1636`、`completionCommits: ["973bd3dbe"]`；`git diff origin/main...HEAD` 本机绝对路径与工作树前缀扫描 **0 泄露**。

## 2. 独立实跑测试与全部门岗结果（`8e2a7f1624d7` 实跑）

- **核心回归与矩阵单测（2/2 套，39/39 passed，0 failed）**：
  - `electron/catalog/codexCli.test.ts`：**26 passed**
  - `electron/capabilityCore/productionReferenceUrls.test.ts`：**13 passed**
- **全部 9 项仓库门岗与静态检查全绿（0 错）**：
  - `node ./scripts/check-boundaries.mjs`：**通过**（68/68，0 新增越界/硬环）
  - `node ./scripts/check-concept-owners.mjs`：**通过**（401 个概念 · 写接口 1049 个 · 第二写口 0 新增）
  - `node ./scripts/check-escape-ledger.mjs`：**通过**（171 条账本 0 错，`USER-20261124-fb-codex-and-upload-error` 已结账 `fixedInPr: 1636`）
  - `node ./scripts/check-root-cause-contracts.mjs`：**通过**
  - `node ./scripts/check-self-written.mjs`：**通过**（0 未认领）
  - `pnpm run check:filesize`：**通过**（`codexCli.ts` 728 行 < 800 红线）
  - `node scripts/fix-churn.mjs --range origin/main..HEAD`：**通过**（0 热点）
  - `pnpm exec tsc -p electron/tsconfig.json --noEmit`：**通过**（0 类型错误）
  - `node scripts/lint-changed.mjs`：**通过**（4 文件，0 错误）

## 3. 独立变异反例核验（3 项全红，恢复后 39/39 全绿）

| 变异反例 | 注入改动 | 目标 2 套测试结果 | 恢复后复绿 |
|---|---|---|---|
| M1 · `NF-1107-0002` 恢复覆写 | 在 `productionReferenceUrls.ts` 给 `localizeForSend` 加 `.catch(() => { throw new Error("hostingDisabled"); })` | **红（退出码 1）**：`productionReferenceUrls.test.ts` 3/3 矩阵用例失败（413 / 503 / 未开托管保真断言全红） | 2/2 套 39/39 绿 |
| M2 · `NF-1025-0001` 禁用持久化 | 在 `codexCli.ts` 使 `stagePersistentCodexOutput` 直接返回易失 `workDir` 原路径/空串 | **红（退出码 1）**：`codexCli.test.ts` 3 条用例失败（`saved_path`、`workDir` 清理后丢失、内联 base64 为空） | 2/2 套 39/39 绿 |
| M3 · `NF-1025-0001` 吞掉结构化错因 | 在 `codexCli.ts` 的 `describeCodexFailure` 跳过 `turn.failed`/`error`/`stderr`/`agent_message` 直接返回笼统未产出 | **红（退出码 1）**：`codexCli.test.ts` 4 条用例失败（限流、`type=error`、`agent_message` 拒答、退出码+stderr 全红） | 2/2 套 39/39 绿 |

## 4. 诚实边界

- 未消耗付费 OpenAI 额度发起真实线上 Codex 生图；实机 `codex-cli 0.171.0` 契约与全路径产物发现/失败归因/HTTP 413 保真均已由参数化矩阵与变异测试闭环验证，真实付费 Codex 线上生图记为 `unverified`。

## 结论

`8e2a7f1624d7d7e47d16265b70e6191a3f16ff68`（PR #1636）代码实现、39/39 核心单测、3 项变异反例及 9 项仓库门岗全部通过，零本机路径泄露，签发 **通过**。
