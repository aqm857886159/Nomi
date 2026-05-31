# 统一请求构建管线（Plan B：根治"测试通过、生产失败"）

> 状态：待用户预读/拍板 → 实施 → 回填
> 触发：用户明确要求"把底层问题解好，要不然之后不通用"。
> 已出图验证：kie text_to_image 现在创建+轮询全通（commit `ddd3908`）。

## 1. 问题（底层根因）

接入一个模型时，请求会被**两套独立、各写各的代码**构建：

| 关注点 | Onboarding 测试管线 (`electron/ai/onboarding/tools.ts`) | 生产管线 (`electron/runtime.ts`) |
|---|---|---|
| 模板引擎 | `renderTemplate` / `renderTemplateValue` (`tools.ts:590/604`) | `renderTemplateString` / `renderTemplateValue` (`runtime.ts:2056/2066`) |
| 模板上下文 | `{request:{prompt,params}, model:{modelKey,model_key}, user_api_key, providerMeta}` (`tools.ts:422`) | `templateContext`：另加 `account.{api_key,account_key}`、`model.model_alias`、参数走 `taskTemplateParams` 归一化 (`runtime.ts:2018`) |
| 参数归一化 | 原样 `{...params}` | `taskTemplateParams`（width/height/cfg_scale/duration/image_url… 映射） |
| 鉴权头 | 内联 `Bearer ${userApiKey}` / x-api-key (`tools.ts:447`) | `authHeaders(vendor,apiKey)`：bearer/x-api-key/query/none (`runtime.ts:1856`) |
| 取任务号 | `seedFromBody` 探测 `data.taskId/task_id/id/jobId` (`tools.ts:405`) | `extractTaskId`（**今天才补上 `data.taskId`**，`runtime.ts:1924`） |
| 逻辑错误信封 | `looksLikeLogicalError` | `requestJson` 内联 `code 4xx` 检测 (`runtime.ts:2132`) |

**后果**：向导里"测试通过"走的是左列；用户真正生成走的是右列。两列任何一处不一致 → "测了能过、用就报错"。

**已发生的三次实证（同一根因）**：
1. 参数对不上（填 body 的方式不同）
2. 401 — `{{user_api_key}}` 生产上下文里没有（已修，`9914008`）
3. 422 recordInfo is null — `extractTaskId` 不认 `data.taskId`（已修，`ddd3908`）

每次都是 case-by-case 打补丁。只要两套并存，就还有第四次。这也直接违反 **规则 1（加新必删旧 / 禁止并行版本）**。

## 2. 方案对比（规则 3）

| 方案 | 用户看到什么 | 代价 |
|---|---|---|
| A. 维持两套，继续逐个对齐 | 短期内还会再撞"测过用错" | 0 立即成本，但 bug 无限延续；违反规则 1 |
| **B. 抽出一套共享的、无 electron 依赖的请求管线，两端共用，删掉私有副本** | 向导测过 = 生产能跑，从此同一类 bug 绝迹 | 一次性重构 + 回归测试；需仔细迁移 |

采用 **B**。

## 3. 范围

新建 `electron/ai/requestPipeline.ts`（纯函数、**不 import electron**），导出：

- `buildTemplateContext({request, model, apiKey, providerMeta})` — 唯一上下文构建器（含 `taskTemplateParams` 归一化 + `user_api_key` + `account.*` 向后兼容 + `model.{modelKey,model_key,model_alias}`）
- `renderTemplateString` / `renderTemplateValue` — 唯一模板引擎
- `authHeaders(authType, apiKey, headerName?)` — 唯一鉴权头（按 authType，不依赖 Vendor 类型）
- `buildHttpRequest({...})` — 唯一 method/url/headers/query/body 构建
- `extractTaskId(response, explicitPath?)` — 唯一取任务号（含 `data.*` 信封探测）
- `looksLikeLogicalError(body)` — 唯一逻辑错误信封检测

然后：
- `runtime.ts` 删除自己的 `templateContext`/`renderTemplateString`/`renderTemplateValue`/`authHeaders`/`buildProfileHttpRequest`/`extractTaskId` 私有实现，改 import 共享模块（`Vendor` → authType 适配在 runtime 侧做薄封装）。
- `tools.ts` `execute_test_curl` 删除自己的 `renderTemplate`/`renderTemplateValue`/内联鉴权/`seedFromBody`，改用共享模块。
- 加 `electron/ai/requestPipeline.test.ts`（vitest，离线，无 electron）：覆盖 kie 信封（`data.taskId`）、`{{user_api_key}}` 鉴权、query 占位、逻辑错误信封、各 authType。

## 4. 不动什么

- 不动 `runTask`/`fetchTaskResult` 的轮询/缓存编排逻辑（只换它们调用的底层构建函数）。
- 不动 catalog schema、mapping 存储格式、UI。
- 不动 onboarding agent 的 LLM 解析（`resolveOnboardingAgentFromCatalog`）。
- 不改任何模板占位符名称（`{{user_api_key}}`、`{{request.params.*}}`、`{{providerMeta.task_id}}` 全保留）。

## 5. 回滚策略

- 单 PR、单 commit 完成抽取+删除+测试；若回归，`git revert` 一把回到 `ddd3908`。
- 实施前在本地 onboard kie text_to_image + text_to_video 各跑一次真实生成做基线。

## 6. 验收门

1. `pnpm exec tsc --noEmit`（electron/ 0 错，src/ 维持既有 pre-existing 错误数不增）。
2. `pnpm test` 全绿，含新增 `requestPipeline.test.ts`。
3. `grep` 确认 `runtime.ts` / `tools.ts` 里**不再有**重复的 templateContext/renderTemplate/authHeaders/extractTaskId 定义（规则 1：私有副本物理删除）。
4. 真实端到端：kie text_to_image 出图、text_to_video 出视频，各成功一次。
5. 向导内 `execute_test_curl` 测试结果与生产实际请求**逐字节一致**（同一 `buildHttpRequest` 产物）。

## 7. 结果（实施后回填）

_待实施。_
