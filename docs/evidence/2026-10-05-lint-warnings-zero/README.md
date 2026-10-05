# Lint warning cleanup (2026-10-05)

## 为什么

卡 3 的 lint 棘轮基线从 78 条警告降到 9 条；9 条全部在本任务卡明确的并行禁区内，未修改判据或使用 `eslint-disable`。

## 改了什么

清理了未使用变量/import、无效赋值、错误原因链、正则可读性、类型过宽、Fast Refresh 非组件导出和懒加载模块引用。Fast Refresh 的常量与纯函数移到独立模块，运行时行为不变。

## 设计卡

★5 格：只改 lint 债务和模块边界，不改产品行为，验证见下。

## 测试

- 改前：`pnpm run lint:ci` 输出 78 条警告（上限 79）。
- 改后：`pnpm run lint:ci` 输出 9 条警告（退出码 0，上限 9）。
- 残余（禁区，交协调会话处理）：
  - `electron/capabilityCore/mcpStdioDocumentReceipt.test.ts:13,14,15`：`@typescript-eslint/no-require-imports`；`electron/capabilityCore/mcp*` 禁区。
  - `electron/productionRun/productionPendingSpend.test.ts:150`：`no-useless-assignment`；`electron/productionRun/` 禁区。
  - `src/workbench/generationCanvas/runner/dependencyWaves.ts:96`：`no-useless-assignment`；runner 禁区。
  - `src/workbench/generationCanvas/runner/generationRunController.ts:37`：`@typescript-eslint/no-unused-vars`；runner 禁区。
  - `src/workbench/generationCanvas/runner/recoverTaskActions.ts:110`：`no-useless-assignment`；runner 禁区。
  - `src/workbench/generationCanvas/runner/relayFrameResolver.ts:35,40`：`no-useless-assignment`、`preserve-caught-error`；runner 禁区。
