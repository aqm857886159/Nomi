fa-step2-verify：通过

- 验收线：fa-step2-verify
- 实现线：fa-step2-impl
- 验收 HEAD：5289daa0879640b91ce423a77aac5fc9e6d5268e
- 关联任务：协作看板 #1586 · F-A 第二刀（`RW-1` + `RW-2` + `RW-3`）+ `U-2 ①`

## 1. 拍板要求逐项核对（`#1586`）

1. **RW-1 + U-2 ①（删画布付费自动重跑与旧策略文件）**：
   - `src/workbench/generationCanvas/runner/generationRetryPolicy.ts` 已同提交删除；
   - `src/workbench/generationCanvas/runner/generationRunController.ts` 已彻底移除 `for (let attempt = 1; attempt <= maxAttempts; attempt++)` 重试循环与 `options.retry`，每次点击按独立 `run.id` 执行一次，主进程 `submissionOutbox` 拥有唯一派发与重连权威；
   - `src/workbench/generationCanvas/runner/multiResultLanding.test.ts` 已覆盖「首次失败只发 1 次 + 用户明确再点一次 → 只发 1 次且使用新 `runRecordId`」（覆盖 `TypeError: Failed to fetch` / 超时 / 无类别异常）。
2. **RW-2（删 3 道猜测前置拦截 + Range 403 / 过期 S3 403 成对收口）**：
   - 30 天连接拒收记忆（`electron/catalog/referenceLinkRefusals.ts`、`referenceLinkRefusals.test.ts`、`catalog.reference-link-refusal.json`）、48h 本地文件年龄盲切、估算租约否决已全部删除；
   - `electron/assets/providerMediaFetch.ts` 新增第四态 `"denied"`：404/410 或 4xx XML/JSON 错误文档（如过期预签名 S3 `AccessDenied`）判 `"dead"`，纯 4xx Range 拒绝判 `"denied"`；
   - 成对测试均在独立实跑中通过：① 过期预签名 S3 `403` + 有私有上传口 → 走私有上传，私有上传回 500 时模型端 `0` 次 `/v1/generate`（`referenceLinkDispatchLedger.test.ts` 6/6）；② Range 被拒普通 GET 可读 + 无私有上传口 + `anonymousAssetHosting=deny` → 6 扇入口全部放行 0 误拦；真 404 + 无授权匿名通道仍 6/6 拦下且 0 匿名上传（`referenceLinkDelivery.matrix.test.ts` 67/67、`assetLocalization.test.ts` 100/100）。
3. **RW-3（`generationTelemetry.ts` 投影结构化派发原因）**：
   - `src/workbench/api/generationTelemetry.ts` 在 `statusFromStructured` 的 `default` 分支消费既有 `structured.code === 'submission_not_sent'`：`never_reached_network -> 'not-sent'`、`connect_failed -> 'network'`，未知 `reason` 仍保留 `'unknown'`，`vendor-failure-one-home` 冻结数零增长。
4. **桌面回放报告与 8 张中英截图亲眼目视核验**：
   - 核读真实桌面回放报告（`mode: "free-walk"`，`result: "passed"`，`paidVerdict.status: "passed"`，`networkBlocked: []`）：zh-CN 与 en 双轨均验证 ① 失效链接触发 1 次上传、1 次模型创建并落图（`sentTheDeadLink: false, allFromUpload: true`）；② 活链首次被拒后在错误卡显式点击「重试 / Retry」，2 次创建均走原链、上传 `0` 次、第二次成功落图。
   - 已亲眼 `read_file` 核验中英 4 格回放拼图（归档于本目录 `zh-CN-replay.jpg`、`en-replay.jpg`）及全分辨率错误卡截图：中文卡展示「模型取不到参考图 / 模型读取参考图链接时失败了。点『重试』会再提交一次…」+「重试」，英文卡展示「The model could not fetch a reference image / Select Retry to submit again…」+「Retry」，中英双轨零串味、零重叠截断。
   - **路径隐私核查**：全量 diff 及本目录归档文档/图片含 **0 处**本机绝对路径或工作树路径泄露。

## 2. 独立实跑命令与结果（均在 `5289daa0879640b91ce423a77aac5fc9e6d5268e` 实跑）

### 2.1 九套核心单测全绿（311/311）
- 批次 A（`npx vitest run --maxWorkers=2`）：**4 passed / 127 passed**
  - `src/workbench/generationCanvas/runner/failedAttemptIdentity.test.ts`：10/10
  - `src/workbench/generationCanvas/runner/multiResultLanding.test.ts`：35/35
  - `src/workbench/api/generationTelemetry.test.ts`：41/41
  - `electron/assets/providerMediaFetch.probe.test.ts`：41/41
- 批次 B（`npx vitest run --maxWorkers=2`）：**5 passed / 184 passed**
  - `electron/catalog/assetLocalization.test.ts`：100/100
  - `electron/catalog/assetTransportPolicy.test.ts`：1/1
  - `electron/catalog/referenceLinkDelivery.matrix.test.ts`：67/67
  - `electron/productionRun/referenceLinkDispatchLedger.test.ts`：6/6
  - `electron/productionRun/productionGenerationSubmission.referenceRefusal.test.ts`：10/10

### 2.2 独立三层变异反例测试（覆盖 RW-1 / RW-2 / RW-3，全部必红复绿）
1. **M1（RW-1：在 `generationRunController.ts` 重新加入 `TypeError` 自动重试 1 次）**：运行 `multiResultLanding.test.ts` + `failedAttemptIdentity.test.ts` → **4 failed / 41 passed**（`one paid click fails once` 从 `[1, 1]` 变成 `[2, 1]` + 3 条重放用例变红，`exit=1`）。
2. **M2（RW-2：将 `providerMediaFetch.ts` 的 `return "denied"` 退回 `return "dead"`）**：运行 `providerMediaFetch.probe.test.ts` → **2 failed / 39 passed**（`/range-denied` 与匿名探测诊断断言变红，`exit=1`）。
3. **M3（RW-3：删除 `generationTelemetry.ts` 对 `submission_not_sent` 的 `never_reached_network` / `connect_failed` 投影）**：运行 `generationTelemetry.test.ts` → **4 failed / 37 passed**（2 条 IPC 投影 + Workbench/Canvas 双轨事件断言全部退回 `unknown` 变红，`exit=1`）。
4. **恢复复绿**：`git checkout -- .` 还原干净后复跑全部对应单测 → **100% 全绿（`exit=0`）**。

### 2.3 全部 8 道仓库门岗实跑（全部 `EXIT=0`）
- `node ./scripts/check-boundaries.mjs`：✅ 通过（3233 模块 · 68 处基线冻结 · 0 新增越界/硬环）
- `node ./scripts/check-boundary-owners.mjs`：✅ 通过（声明 2127 条 · 退役 86 · 0 错）
- `node ./scripts/check-concept-owners.mjs`：✅ 通过（398 概念 · 写接口 1050 个 · 第二写口 0 新增 · 0 错）
- `pnpm run check:root-cause-contracts`：✅ 通过（55/55 单测 + 变更合同全过）
- `pnpm run check:escape-ledger`：✅ 通过（19/19 单测 + 171 条真实账本绿）
- `pnpm run check:self-written`：✅ 通过（20/20 单测 · 0 未认领）
- `pnpm run check:filesize`：✅ 通过（`generationRunController.ts` 降至 716 行，0 超限）
- `node scripts/fix-churn.mjs --range origin/main..HEAD`：✅ 通过（3 个热点 fix 全部带有效 `Direction-Check`）

## 3. 未验证范围说明
- Windows 真机、真实付费线上大盘指标回落（2026-11-30 按补丁版本复查雷达）与真实第三方付费供应商扣费对账按 `unverified` 记账（本次桌面回放为本机 HTTP 夹具 `free-walk`，真实供应商消费为 0）。
