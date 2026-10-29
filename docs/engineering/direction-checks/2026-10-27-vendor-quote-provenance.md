# 方向检查：失败卡的服务商原话出处（A）

用户 10-27 拍板：三件都照推荐修（A：只认有来源的原话，删 raw 回退）

本线只做类根因复盘和现状特征测试，不改产品实现；结构性结论交用户拍板。

## 0. 一句话根因

错误分类把“这是网络类”误当成“这句话来自服务商”：当上游原话缺失时，`reportFor` 从本机 raw 抠首行填进 `providerMessage`，失败详情的共享三件套只能照显示，因而把 `ECONNRESET` / `fetch failed` 栽赃成服务商原话。

## 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 10-22 `22eeb5760` | 新增取回阶段错误码和对应人话，仍沿用分类器的 providerMessage 生成方式 | 错误类别与错误出处没有分离 |
| 10-24 `c2709c75d` | 收口 IPC 错误类名的读取，保证日志不泄漏类名；没有约束网络错误的来源证明 | 同上 |
| 本次 #6 | `classifyGenerationError('fetch failed'/'ECONNRESET')` 归 network 后，`reportFor` 用 `extractReadableErrorLine(raw)` 产生 `providerMessage`；`NodeErrorReport` 与 `NodeRecoverableReport` 的共享 `ProviderMessageNote` 直接显示 | 同上 |

## 2. 为什么会一直出现

门表：`providerMessage` 有 4 个读面（`src/workbench/ai/lane/laneCommandFailure.ts`、`src/workbench/generationCanvas/nodes/NodeErrorReport.tsx`、`src/workbench/generationCanvas/nodes/NodeRecoverableReport.tsx`、`src/workbench/observability/classifyError.ts`）；`ProviderMessageNote` 有 2 个 UI 读者（NodeErrorReport / NodeRecoverableReport）。分类器的共享出口在 `classifyError.ts:547`，其中 `vendorOriginatedText` 其实已经能区分结构化 `upstreamMsg` / 异步任务原话与本机 raw，但 `reportFor` 在 `upstream` 为空时又回读 raw。

因此“服务商原话”字段的语义是猜出来的，不是带来源的值。网络类别的 `vendorSide: true` 只说明失败类别通常发生在供应商侧，不能证明 `fetch failed` 这四个字由供应商说出。用户点开失败详情期待核对供应商证据，实际看到的是本机网络异常，违反 ⑫「点了=以为的」；⑩/⑪ 不适用，因为本问题不涉及意图参数或模型清单。

## 3. 不改结构的可验证预测

| 预测 | 验证 |
|---|---|
| 其他本机错误（`ENOTFOUND`、`Failed to fetch`、代理失败中文兜底）也会进入 providerMessage | 对 `classifyGenerationError` 做同类输入矩阵；当前只读纯函数，不发网络 |
| 可找回面板和失败卡会同时显示误标，因为共用 `ProviderMessageNote` | `NodeErrorReport` / `NodeRecoverableReport` 的现有渲染测试各喂 network report |
| 带结构化 `upstreamMsg` 的真实供应商失败仍应显示原话 | 现有 `classifyGenerationError.test.ts` 的 structured providerMessage 用例；修复不能一刀切掉这类证据 |

## 4. 靶子独立性检查

现状测试直接调用分类器，oracle 只核对 `kind` 与 `providerMessage` 的两个事实，不复用 `reportFor` 内部判断。已有 structured 原话测试证明“真上游原话要保留”是正确靶子；本次只钉本机网络错误被误标这一支。

## 5. P0：自写与现成方案

“原话是否来自供应商”是错误事实边界，必须由 Nomi 的结构化错误合同承载；通用 JSON/IPC 解析可以复用现有 `VendorErrorStructuredLite`、`parseVendorErrorFromMessage` 和 `vendorOriginatedText`。不应为 `ECONNRESET`、供应商或平台再加字符串分支。当前自写部分的领域理由是要把用户可见证据和本机事实分开，未来可替换条件是所有生产错误都带来源字段并通过统一合同解析。

## 6. 接入 / 补 / 重写 / 删对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 让 `reportFor` 的 providerMessage 只接受 `vendorOriginatedText` / `parseTaskFailureMessage` 的有来源值，沿用现有结构化错误合同 | 改分类器一个共享边界，需回归 4 个读者 | 需检查旧持久化错误的显示收据 | **推荐** |
| 补 | 在 network 分支里特判 `ECONNRESET`、`fetch failed` 等并清空 providerMessage | 低改动 | 新平台/代理错误继续漏；第三个特例分支 | 不推荐 |
| 重写（限一个模块） | 重写失败详情 UI，让 UI 自己判断 network 不显示 | 触及两个读者和可找回面板 | 出处判断散到 UI，其他读面仍会错 | 不推荐 |
| 删 | 删除“服务商原话”三件套或所有 providerMessage | 立即没有误标 | 真正有价值的上游原话也丢失，破坏诊断 | 禁止 |

**推荐**：在 `classifyError.ts` 的共享投影边界删掉“`upstream` 为空就从 raw 抠 providerMessage”的回退。只有有来源证据的 `upstreamMsg` / task failure upstream 才能进入 `providerMessage`；unknown 类仍按现有规则让 reason 承担原始可读文本，结构化供应商原话仍保留。

## 7. 用户要权衡的核心

要不要把“可读”让位给“可证明”：删掉无来源的那句会少一行诊断字，但能保证失败卡永远不把本机故障说成供应商原话。

## 特征测试

- `src/workbench/generationCanvas/runner/classifyGenerationError.test.ts`：`现状：本机网络错误 %s 进失败详情时仍被标成服务商原话`（`ECONNRESET`、`fetch failed`），绿；当前两者均 `kind=network` 且 `providerMessage` 等于本机错误串。
