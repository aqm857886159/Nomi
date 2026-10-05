# 卡4：测试类型债务收口（2026-10-05）

## 结果

本分支只修测试代码和脚本测试入口的类型漂移，不改产品运行时代码。`tsconfig.test.json` 的实际类型错误从 **60 条降到 10 条**，清掉 50 条，27 个文件从基线中移除。基线已经按实际结果收紧为 6 个文件 / 10 条错误。

## 设计卡

- 问题：测试夹具、mock 调用和脚本测试类型随生产接口漂移，生产 `typecheck` 不覆盖这些文件。
- 边界：只改 `electron/**/*.test.ts`、`evals/**/*.test.ts`、`scripts/**/*.ts` 测试相关类型；不改产品模块。
- 方案：在最靠近测试夹具的边界补窄类型、补齐真实接口必填字段、为 `vi.fn`/`fetch` 调用声明测试所需的参数形状；不使用 `@ts-ignore` 或放宽门禁。
- 验收：`check:test-types` 通过且基线只下降；所有改动的 Vitest 文件逐个运行。
- 残余：禁区 `electron/productionRun/` 的 3 条保留；已删除的 `electron/ai/onboarding/*` 模块导致脚本 7 条导入错误保留，见下文。

## 已修复范围

修复了 MCP elicitation / generation planning / production artifact 测试夹具、catalog 测试状态形状、ComfyUI 与 provider adapter mock、runtime fetch 调用元组、vendor 错误结构、journey 合同，以及若干 scripts 类型缩窄。所有改动均为测试侧或脚本类型侧。

## 验证

- `pnpm run check:test-types`：通过；agent-runtime 0 条，测试类型基线 60 → 10。
- `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit --pretty false`：仅剩下列 10 条已知残余。
- 改动测试文件逐个 `pnpm exec vitest run`：21 个文件全部通过，共 328 个测试通过。

## 残余清单（未隐藏）

### 保护区：productionRun（3 条）

- `electron/productionRun/productionGenerationSubmission.test.ts:189`：测试注入已删除的 `registry` 依赖字段。
- `electron/productionRun/productionRunRepository.test.ts:70`：`PlanCandidate.references` 的只读夹具与生产可变数组类型不一致。
- `electron/productionRun/productionTrustLevel.test.ts:115`：测试读取生产 `ProductionRun` 类型中不存在的 `trustLevel` 字段。

这些文件属于当前任务卡声明的保护区，本分支不改。

### 已删除模块：scripts（7 条）

- `scripts/lab-analyze.ts:21,22`：`electron/ai/onboarding/systemPrompt`、`types` 已不存在。
- `scripts/lab-onboard.ts:24,25,26`：`electron/ai/onboarding/agent`、`reporter`、`types` 已不存在。
- `scripts/probe-extract-matrix.ts:9,10`：`electron/ai/onboarding/specExtractors`、`docExtractors` 已不存在。

这些不是测试夹具可局部修复的类型错误；恢复或重建已删除产品模块属于产品架构决策，留给后续专门任务。
