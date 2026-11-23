u2-verify：通过

- 验收线：u2-verify
- 实现线：u2-receipt-impl
- 验收 HEAD：20d384f894ad325012c1082042414cbba86a42ab
- 关联任务：协作看板 #1586 · U-2 ②–⑥（`D4-16 扣了钱能找回` + `NF-1104-0001`）
- 基线分支：`origin/fix/fa-step2-rw1-rw2-rw3`（叠在 PR #1638 之上）

## 1. 拍板要求逐项核对（U-2 ②–⑥ 与 `docs/plan/2026-11-24-u2-paid-submission-recovery.md` ★9）

1. **② 最早共享受理落盘**：
   - 核查 `electron/productionRun/paidSubmissionReceipt.ts`（`withPaidReceiptWriter` + `checkpointPaidResponse` + `checkpointProfileCreate`）与 `electron/productionRun/submissionOutbox.ts:374-399`：上游返回 `task_id`、ComfyUI `prompt_id` 或自定义脚本远端句柄后，在轮询、下载、响应变换或 IPC 返回前即经 `deps.persistAcceptance(receipt, dispatchInput)` 同步持久化到 Run outbox / `runtimeEnvelope` 并记 `recordAcceptance(durableId)`；即使后续 `afterDispatch` 或下载中断，也不会把已受理提交抹成 `submission_unknown`。
2. **③ 同步出图 / 直接媒体回执可重放**：
   - 核查 `electron/tasks/acceptedTaskResult.ts`（`recoverAcceptedTask`）与 `electron/audioTaskRunner.ts`：同步图片/音频响应先持久化原始媒体回执（`rawAcceptance`），下载中断或重启恢复时从已保存回执落盘，上游生成 `POST` 严格 `= 1`。
3. **④ 冻结模型身份恢复 & 无响应诚实 `结果未知`**：
   - 核查 `paidSubmissionReceipt.ts#vendorForReceipt`（`:74-90`）：恢复时严格绑定首次受理冻结的 `receipt.baseUrl` 与 `receipt.authType`（origin 不匹配且有鉴权时拒绝外发新连接凭据）；切默认模型/换供应商地址后仍只查原地址与原任务号（`0` 重复 POST）；
   - 套接字已写出但未收到上游响应（无 `providerTaskId`）时诚实落盘为 `submission_unknown`（`结果未知 / Outcome unknown`，`0` 自动重发）；本机确认未出网返回 `never_reached_network`（`0` POST）。
4. **⑤ 人工重按 vs 机器恢复严格区分**：
   - 机器恢复沿用原 `runRecordId` 并登记原 Run 观察者（`0` 新增 POST）；人工显式再点产生新 `runRecordId`（`1` 新增 POST，总计 `1 + 0 + 1 = 2`）。
5. **⑥ 本地 ComfyUI 与自定义脚本 `customCall` 同一边界覆盖 + `NF-1104-0001`**：
   - `paidSubmissionRecovery.integration.test.ts` 覆盖真实 `comfyui-local`（`prompt_id` → 原 `history` → `view`）、声明 `query` 映射的脚本与无 `query` 映射的独立脚本（均 `1 / 0`）；
   - `spendConfirm.ts` 与 `handOverPrecheck.ts` 收口画布/单镜/批量/分镜/Agent 统一读取 `generationNodeLedger`，真实 `comfyui-local` 不再与纯文本混流；
   - `NF-1104-0001` 经核查在基线及可达 `docs/` / `tests/` 历史中无原始工单正文，对应两条脚本/目录回执路径已在 `customCallDispatch.ts`、`runtime.ts` 与 `acceptedTaskResult.ts` 完整收口。
6. **路径隐私核查**：相对基线全量 diff 及本报告均含 **0 处**本机绝对路径或工作树路径泄露。

## 2. 独立实跑命令与结果（均在 `20d384f894ad325012c1082042414cbba86a42ab` 实跑）

### 2.1 十四套核心单测全绿（243/243）
- **批次 1（`npx vitest run --maxWorkers=2`）**：**6 passed / 68 passed**
  - `electron/capabilityCore/paidSubmissionRecovery.integration.test.ts`：9/9（全部 9 个磁盘重启故障注入场景：异步 `task_id`、同步图下载中断、ComfyUI `prompt_id`、有/无 query 自定义脚本、journal 缺口补齐、切换连接地址仍查原端、套接字无响应 `unknown` + 人工再点新单、本机模型不存在 `never_reached_network`）
  - `electron/productionRun/productionGenerationSubmission.test.ts`：17/17
  - `electron/productionRun/productionRunRuntimeEnvelope.test.ts`：6/6
  - `electron/productionRun/productionRunLock.test.ts`：13/13
  - `electron/productionRun/submissionNotDispatched.test.ts`：11/11
  - `electron/audioTaskRunner.test.ts`：12/12
- **批次 2（`npx vitest run --maxWorkers=2`）**：**8 passed / 175 passed**
  - `electron/capabilityCore/apimartGenerationProvider.test.ts`：65/65
  - `electron/capabilityCore/appIntegrationCanvasShot.test.ts`：48/48
  - `electron/capabilityCore/canvasTransportProvider.test.ts`：4/4
  - `src/workbench/generationCanvas/spend/spendConfirm.test.ts`：15/15
  - `src/workbench/production/handOverPrecheck.test.ts`：12/12
  - `src/workbench/generationCanvas/components/batchPlanPreview.test.ts`：21/21
  - `src/workbench/generationCanvas/components/batchPlanPreview.retryable.test.ts`：2/2
  - `src/workbench/generationCanvas/components/groupGenerate.itemized.test.ts`：8/8

### 2.2 三项独立变异反例测试（全部必红 → 恢复 100% 复绿）
1. **M1（破坏最早受理信封持久化：`paidSubmissionReceipt.ts#checkpointPaidResponse` 提前返回）**：运行 `paidSubmissionRecovery.integration.test.ts` → **7 failed / 2 passed (9)**（全部 7 条恢复场景均无法在重启后登记观察者或读回原图，`exit=1`）。
2. **M2（破坏 `submission_unknown` 零自动重发保护：`submissionOutbox.ts:387` 允许未收到响应的套接字错误自动重发）**：运行 `paidSubmissionRecovery.integration.test.ts` → **1 failed / 8 passed (9)**（`keeps an unanswered socket write unknown until a new human click` 抓获违规自动重发，`exit=1`）。
3. **M3（破坏冻结身份恢复：`paidSubmissionReceipt.ts#vendorForReceipt` 改读可变 `live.baseUrlHint`）**：运行 `paidSubmissionRecovery.integration.test.ts` → **1 failed / 8 passed (9)**（`polls the original endpoint after the saved connection changes` 误查新地址 `http://localhost:1/jobs/remote-13` 失败，`exit=1`）。
4. **恢复复绿**：`git checkout -- .` 还原干净后复跑 `paidSubmissionRecovery.integration.test.ts` → **9/9 passed (`exit=0`)**。

### 2.3 全部仓库门岗实跑（基于 PR 基线 `origin/fix/fa-step2-rw1-rw2-rw3` 全部 `EXIT=0`）
- `node scripts/check-boundaries.mjs`：✅ 通过（3236 模块 · 68 处基线冻结 · 0 新增越界/硬环）
- `node scripts/check-boundary-owners.mjs`：✅ 通过（声明 2132 条 · 在位 1871 · 改锚 79 · 退役 87 · 0 错）
- `CONCEPT_OWNERS_BASE_REF=origin/fix/fa-step2-rw1-rw2-rw3 node scripts/check-concept-owners.mjs`：✅ 通过（399 概念 · 1055 写接口 · 第二写口 0 新增 · 0 错；注：本 PR 叠在 #1638 之上，需以 `fix/fa-step2-rw1-rw2-rw3` 或合入 #1638 后的 `main` 为基线）
- `ROOT_CAUSE_BASE_REF=origin/fix/fa-step2-rw1-rw2-rw3 node --test scripts/check-root-cause-contracts.node-test.mjs`：✅ 50/50 通过
- `ROOT_CAUSE_BASE_REF=origin/fix/fa-step2-rw1-rw2-rw3 node scripts/check-root-cause-contracts.mjs`：✅ 通过
- `node scripts/check-escape-ledger.mjs`：✅ 通过（171 条真实账本绿；合同 `detected_by: "review"`）
- `node scripts/check-self-written.mjs`：✅ 通过（0 未认领）
- `node scripts/check-file-sizes.mjs`：✅ 通过（0 超限）
- `node scripts/lint-changed.mjs`：✅ 通过（94 文件 0 错）
- `node scripts/fix-churn.mjs --range origin/fix/fa-step2-rw1-rw2-rw3..HEAD`：✅ 通过（1 个热点 fix 带有效 `Direction-Check`）

## 3. 未验证范围说明
- 真实付费上游调用、Windows 真机、真实物理断电、真实远程 ComfyUI 实例与真桌面窗口中英文截图均按 `unverified` 诚实记账（本轮全部测试运行于本机回环 HTTP 与真实 Run 磁盘文件，真实付费花费为 0；待协调在周四真付费抽检窗口按付费专用树核验）。
