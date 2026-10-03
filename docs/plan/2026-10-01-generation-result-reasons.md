# 生成结果上报：失败原因 + 自动化标记

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 范围：`generation.completed` 事件加两个字段，雷达跟着改。不改失败分类本身，不改接收端。

## 为什么

用量数据现在不能用：事件里没有「这是测试 / 自动化」的标记，本机大量故意失败的走查混在真实用户里；失败事件也不带原因，看不出用户败在哪。实查还发现第三个问题：异步任务（视频几乎都是）提交时状态是排队 / 运行中，被记成「取消」，最终成败从不上报。

## 先查别人

- 成熟产品怎么把测试 / 内部流量和真实用户分开：PostHog 在项目设置里定义「内部与测试用户」的过滤条件，分析时用一个开关默认排除，https://posthog.com/docs/data/test-accounts ——结论：**事件带标记，统计端默认排除**，不在源头丢事件。
- Sentry 用 `environment` 标签区分 development / staging / production，事件照收，视图按环境过滤，https://docs.sentry.io/concepts/key-terms/environments/ ——同一个思路：标记随事件走。
- VS Code 遥测有 `isInternalTelemetry()`，判据是「内部域名或显式的 internalTesting 开关」，即**以启动配置这一事实为准**，`src/vs/platform/telemetry/common/telemetryUtils.ts:398`；PII 清理另有 `cleanData()`，`src/vs/platform/telemetry/common/telemetryUtils.ts:461`，https://github.com/microsoft/vscode/blob/main/src/vs/platform/telemetry/common/telemetryUtils.ts ——对应我们的 `NOMI_E2E=1`（唯一启动器钉死）。
- 怎么上报失败类别而不泄露内容：OpenTelemetry 语义约定 `error.type` 是「错误的类别」，要求低基数，明确不建议把消息放进指标，https://opentelemetry.io/docs/specs/semconv/registry/attributes/error/ ——结论：**只发分类码，不发原文**。
- 仓库里已有：失败分类的唯一目录 `src/workbench/observability/classifyError.ts:548`（`classifyGenerationError`）与它的取值表 `src/workbench/observability/narrate.ts:89`（`GenerationErrorKind`）；上报点 `src/workbench/api/taskApi.ts:189`；事件白名单 `electron/telemetry/telemetryEvents.ts`；接收端原样存 JSON、不挑字段 `infra/feedback-worker/src/worker.mjs:111`。
- 结论：用已有——分类用 #938 的唯一目录，白名单与同意合同沿用现有；字段名对齐通行做法：失败类别叫 `errorType`（OTel `error.type`），自动化标记是布尔值，只在为真时出现（VS Code `isInternal` 的形状）。没做：不引第三方 SDK，不在源头丢自动化事件。

## 做法

1. `errorType`：只在 `result='failure'` 出现，取值是 `GenerationErrorKind`，主进程门口只认形状（短 kebab-case，`TELEMETRY_ERROR_TYPE_PATTERN`），装不下句子、路径、URL。原文、提示词、文件名、供应商返回体一个字都不出渲染层的 `failureTypeOf`。
2. `systemProps.automated`：主进程 `buildTelemetryEnvelope` 按 `NOMI_E2E === '1'` 打标（`tests/ux/_launchApp.mjs` 是走查唯一启动器，钉死该变量，真实资料副本的付费测试也走它）。真实用户的事件里没有这一格。
3. 异步任务：提交时只记下任务 id，轮询到终态（`fetchWorkbenchTaskResultByVendor`）报一次。提交时不再把「还在跑」记成取消。
4. 雷达：自动化事件默认排除并单独列条数；失败按原因排行；老版本没带原因的单独成一类。

## 不动项

失败分类本身、接收端、同意卡文案、Agent 轨迹。

## 回滚

`git revert`；字段都是可选，老版本事件与新版本事件在同一份数据里共存。

## 验收门

- 单测：失败事件带对原因、成功不带、自动化标记来自启动事实、雷达在夹具上排除自动化并按原因排行。
- 一条真 App 走查（`tests/ux/telemetry-failure-reason.walk.mjs`）：故意失败一次，抓出站字节，确认带类别码与自动化标记，且没有提示词、路径、端口、供应商返回体。
