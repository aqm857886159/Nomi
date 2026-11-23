# F-A Step 1 失败归因与渲染器重试

独立复盘线 · fa-direction-audit（未参与此前三轮修补）

## 现场与根因

| 现场 | 最早漏拦的边界 | Step 1 修复与证据 |
|---|---|---|
| 已分类错误进入遥测后成为 unknown | 任务 IPC 只识别顶层供应商异常，原测试漏掉适配器外壳 | IPC 提取 `ApimartGenerationProviderError` 内的 `VendorRequestError.structured`。`taskIpcGuard.test.ts` 和 `generationTelemetry.test.ts` 同时覆盖包装形状与工作台、画布入口。 |
| 已分类的轮询终态在读盘后丢失类别 | Run 只保留参考图拒绝的特定文案，原测试预期其他失败统一使用一句话 | `polledFailureMessage` 通过现有磁盘安全字段投影保留已分类的终态。`productionGenerationSubmission.referenceRefusal.test.ts` 对两个运行引擎读盘验证配额和模型不可用。 |
| 同一意图产生三次执行或失败记录 | 渲染器重试判据优先匹配 timeout 等字面，主进程已经判定失败 | 重试判据优先识别机器分类。`failedAttemptIdentity.test.ts` 覆盖图片、视频、九笔独立意图和两镜批次，执行或事件数由 27 降至 9、由 6 降至 2。 |

IPC、Run 和画布以前各自消费失败文案，包装、读盘或追加诊断都能改变下游判定。该问题可从多个入口重复出现。继续补文案会受语言和外壳影响，全局重试上限会牵连其他镜头及新意图，移除全部重试会影响未分类的传输失败。Step 1 采用现有结构化格式保留证据，让分类终态结束本轮执行，媒体是否可安全重派仍由主进程提交账本判定。

## 预测与验收

已知类别在直接异常、适配器包装、工作台／画布遥测与 Run 读盘时应保留。源码中的传输诊断不进入遥测或 Run 的安全字段。缺少类别的输入保留 unknown。九笔独立意图产生九次失败事件，两镜批次产生两次执行。直接异常与连接已收单后断开的账本用例检查正常路径。2026-11-30 按补丁版本复查 unknown 和单安装集中度，复发则按入口重开。旧线上 557 条 unknown 和单安装 27 条记录没有完整的运行或点击身份，具体归因及真实付费生成仍为 unverified。

逃逸账本结账用 `src/workbench/api/generationTelemetry.test.ts` 的工作台与画布参数化矩阵。

## 5. 归属

这一整块：生成终态的分类与再次派发资格。

归谁：electron/shared/generationFailure.ts:328 决定类别，electron/productionRun/submissionOutbox.ts:368 持有派发证据。

我们哪里绕开了它：electron/tasks/taskIpcGuard.ts:8 和 electron/productionRun/productionGenerationSubmission.ts:497 丢弃分类证据，src/workbench/generationCanvas/runner/generationRetryPolicy.ts:16 曾从诊断文案重新推断可重试性。

## F-A Step 2 · RW-2 待 #1586 用户热点签字

`electron/productionRun/referenceLinkDispatchLedger.test.ts` 使用回环 HTTP 模拟过期 S3 预签名链接的 `403 AccessDenied`（`application/xml`）。探针把 403 改成 `unknown` 时，两个过期链接用例绕过供应商的私有 `uploadsTo`，把链接直接交给 `/v1/generate`。Step 1 恢复基线判定以保住私有重传。RW-2 在 `electron/catalog/assetLocalization.ts` 处理 `anonymousAssetHosting === "deny"` 时仅 Range 被拒的可用引用，同时保住过期签名 URL 的私有上传路径。验收需同时覆盖这两个 HTTP 形状。
