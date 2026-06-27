# 提交幂等：堵住「提交瞬间丢回执 → 重试 → 二次下单」残留窗口

> 2026-06-27。承接当日 `fix(generation)` 轮询重发治理。轮询窗口（20min，主战场）已修；本 plan 堵剩下的**提交一瞬间**的窗口。

## 背景 / 根因

视频/图片生成 = `runTask`(付费提交) → 轮询查结果。前一修复已让「查结果失败」绝不重发。**残留窗口**：`runTask` 的 HTTP 请求已发出、服务端已建任务并开始计费，但**回执在网络上丢了** → 渲染层 `runWorkbenchTaskByVendor` 收到网络错 → 控制器重试循环再次调 `runTask` → **二次下单**。

控制器无法可靠区分「请求没发出去（可安全重试）」与「发出去了但回执丢了（重试=二次扣费）」，故不能靠收窄重试条件解决。

## 关键事实（调研确认）

- **指纹缓存挡不住进行中提交**：`fingerprintCache` 只缓存**已成功**结果（`rememberTaskResult` 仅 succeeded 才写），两次相同配置的提交若第一次还在跑，第二次必真发第二单。不能当幂等地基。
- **现有无任何幂等键**：`taskId` 每次 `runTask` 重新生成；`grantId` 是批次+多次尝试级（默认 3 attempts 共用），都不是「每次意图唯一 + 重试间稳定」。
- **天然键 = `run.id`**：`generationRunController.ts:111` `appendNodeRun` 返回，**在重试循环外**生成一次、循环内复用 → 对同一次 `runGenerationNode` 调用稳定，新生成 = 新 id。批量每节点各自 `runGenerationNode` → 各自独立 run.id。
- **唯一真相源 chokepoint = `electron/runtime.ts` `runTask`**：渲染层 agent / 批量 / 单节点三路都汇到这里；MCP/headless（`capabilityCore/core.ts`）也调 `runTaskFn`，但**绕过控制器和 buildCatalogTaskRequest**，需单独给键。

## 方案：electron 侧把「提交」按幂等键 memo 化（at-most-once）

核心 = **同一个幂等键，真正的 `runTask` 内核最多执行一次**；后续同键调用**重放第一次的 promise**（成功 or 失败都重放，不重新执行）：

- 进行中 → 等同一个 promise（拿到同一个 taskId，渲染层轮询同一个真任务）。
- 已成功 → 返回同一个 taskId（连「成功但回执丢了」也能找回真任务，无需供应商支持）。
- 已失败 → 重放同一个 rejection → **绝不二次下单**；控制器重试再多次也是同一个失败 → 退到 error/recoverable。

这是**与供应商无关的完整保证**：vendor 是否认 `Idempotency-Key` 不影响正确性，故本次**不碰 vendor 请求头**（memo 已阻止重发，头无额外价值）。

### 取舍（诚实标注）

- 代价：**自动重试「真失败的提交」会变成需用户手点重试**（用户重试 = 新 run.id = 新键 = 放行）。因为无法区分「没发出去」vs「回执丢了」，按钱安全默认一律不自动重发。常见的瞬态失败（20min 轮询）已由前一修复用「免费重查」自动扛住，提交本身是一次快请求、失败少见，代价小。
- memo 有 TTL（默认 5min，覆盖控制器 ~2s 重试 burst 后清理，bound 内存）；TTL 过后同键可再跑——但那时控制器早已用尽 maxAttempts，不影响。

## 改动清单

1. **新增 `electron/submissionLedger.ts`**（纯函数可裸测）：`dedupeSubmission(key, fn, { ttlMs, now })` —— 按键 memo promise，settle 后 TTL 清理。无键不介入。
2. **`electron/runtime.ts`**：抽出现有 `runTask` 体为内核，导出 `runTask` 改为薄包装：读 `request.extras.idempotencyKey`，有键 → 过 `dedupeSubmission`，无键 → 原样（向后兼容 + 不破 headless/测试）。
3. **穿透 run.id → extras.idempotencyKey**（照抄 grantId 路径）：控制器 `generationRunController.ts` executor context 加 `idempotencyKey: run.id`；`generationNodeExecutor.ts` context 类型 + 取出 + 传各 action；`catalogTaskResolve.ts` 选项类型；`catalogTaskActions.ts:164` 旁 extras 写入。text 分支不付费可不传。
4. **MCP/headless**：`capabilityCore/core.ts` extras 字面量加 `idempotencyKey: crypto.randomUUID()`（与 grantId 同处）。
5. **测试**：ledger 单测（同键 fn 只调一次、重放成功/失败、TTL 过期可重跑、无键不介入）；runtime 层「同键二次 runTask 不二次发 vendor」；控制器「同 run.id 重试不二次提交」。

## 不动项

- 不改 vendor 请求构造 / requestJson / 各 vendor seed（memo 是供应商无关的完整保证）。
- 不改指纹缓存语义（仍只缓存成功结果，与幂等 memo 正交）。
- 不改前一修复的轮询容忍逻辑。

## 验收门

- 五门全过。
- 新测试：同键提交内核只执行一次（成功/失败都重放）。
- 真机走查：触发一次真生成（评测额度默认授权），确认正常出片、无重复任务。

## 回滚

memo 仅在 `extras.idempotencyKey` 存在时介入；移除穿透（或键为空）即回到原行为，单点可关。
