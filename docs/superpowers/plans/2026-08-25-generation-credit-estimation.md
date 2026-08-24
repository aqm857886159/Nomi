# 生成积分估算与实际记录实施计划

> 执行状态：用户已确认直接推进；实现完成后先测试与走查，等待用户确认，再决定是否推送/提 PR。

## 目标

在统一的 provider-neutral 成本契约上，完成 APIMart/KIE 实际积分提取、模型目录估算、单节点/批量条件交互，以及向后兼容的 provenance/event 传播。

## 实施步骤

### 1. 先写纯函数与测试（TDD）

文件：

- 新增 `electron/vendor/cost.ts` 与 `electron/vendor/cost.test.ts`。
- 新增 `src/workbench/generationCanvas/spend/generationCost.ts` 与同名测试。
- 修改 `src/config/modelOptionMappers.ts` 及测试。

任务：

1. 定义 `CostUnit = 'credits'`、`CostActual`、`CostEstimate` 的最小结构，数值只接受 finite/non-negative。
2. 覆盖 APIMart `data.credits_cost`（含 0 与小数）、KIE `data.creditsConsumed`、错误响应/字符串/缺失字段、未知 provider。
3. 估算 base + matching spec costs、裸值/`key:value`、变体相乘、批量任一 unknown 则 unknown。
4. 修改 mapper 不再 floor 小数，补 8.52、0.06 的回归测试。

验收：纯函数测试全绿，且不依赖 Electron/React/网络。

### 2. 接入任务终态与已有记录

文件：

- `electron/vendor/provenance.ts`
- `electron/runtime.ts`
- `electron/tasks/taskResultQuery.ts`
- `electron/events/vendorCallTrace.ts`
- `src/workbench/api/taskApi.ts`
- `src/workbench/generationCanvas/model/generationCanvasTypes.ts`
- `src/workbench/generationCanvas/model/generationCanvasSchema.ts`
- `src/workbench/generationCanvas/runner/catalogTaskResultParse.ts`

任务：

1. `buildProfileTaskResult` 以 vendor key + 原始响应提取 actual，成功/失败结果都保留 raw；只有有值时才写 provenance.cost。
2. 让 `traceVendorCompleted` 接收可选 cost，所有 profile/fallback/query 终态调用点传同一 actual。
3. 让 fallback 与无状态轮询路径也使用同一适配器，不产生重复或猜测。
4. renderer DTO/schema/parser 增加可选 actual cost，旧数据保持可读。

验收：APIMart/KIE fixture 测试能看到 actual；缓存命中和未知字段没有伪造费用。

### 3. 接入单节点 B 方案

文件：

- `src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx`
- `src/i18n/locales/generationCommon.ts`

任务：

1. 从已有 `selectedModelOption` 和 `node.meta` 计算估算，变体数变化时同步更新。
2. 有值时在原生成按钮位置显示 token-only 胶囊 `约 {{credits}} 积分 ↑`；无值时继续使用原 `GENERATE_BUTTON_CLASS` 圆形按钮。
3. 不改变 `handleGenerate`、依赖计划、spend confirm、variant runner 的调用链。
4. 补结构测试：有 pricing/无 pricing 两个 DOM 分支，按钮 aria-label 与 disabled 语义不变。

验收：无 pricing 模型截图中没有费用占位；有 pricing 模型按钮宽度和设计系统 token 正确。

### 4. 接入批量 B 方案

文件：

- `src/workbench/generationCanvas/components/useCanvasProductionActions.ts`
- `src/workbench/generationCanvas/components/CanvasBatchGenerateDock.tsx`
- `src/workbench/generationCanvas/components/CanvasSelectionToolbar.tsx`
- `src/workbench/generationCanvas/components/BatchPlanOverlay.tsx`
- 必要时 `src/workbench/generationCanvas/components/batchPlanPreview.ts`

任务：

1. 在 production actions 里按节点 execution kind 读取目录选项，使用同一个纯函数得到全批量 estimate。
2. 将可选 `costEstimate` 传入三种批量入口；全 known 才渲染汇总，unknown 则不渲染。
3. 复用现有主按钮与确认函数，避免第二套 submit/grant 流程。
4. 批量文案统一 i18n，显示格式最多保留两位小数且不把金额混进积分。

验收：混合一颗无 pricing 节点时批量栏不出现成本；全 known 时显示总积分且点击行为不变。

### 5. 设计系统与文档自检

任务：

1. 对照 `docs/design/nomi-design-system.md` 检查新 class 仅使用 token。
2. 对照已确认的 v3 mockup 逐项核对：单节点有/无、批量全知/未知、确认链路。
3. 更新必要的结构测试与 i18n 基线，不新增硬编码可见文字。

### 6. 全量验证与交付

按项目门禁运行：

```bash
pnpm run check:filesize
pnpm run check:tokens
pnpm run check:i18n
pnpm run lint:ci
pnpm run typecheck
pnpm run test
pnpm run build
```

另外运行真实用户任务走查：

1. 有 APIMart/KIE pricing 的图片/视频节点：切换参数、变体数，确认积分文案变化。
2. 没有 pricing 的普通模型：确认只有原圆形箭头。
3. 批量全 known：确认汇总出现；加入 unknown 节点：确认汇总完全消失。
4. 点击生成：确认仍经过原 spend confirmation，确认前无 vendor 请求。

截图和测试结果先交给用户确认；不推送、不提 PR，直到用户明确确认。

## 回滚

本分支所有改动可回滚为：删除成本适配器/估算模块，恢复 provenance/event 的可选字段和 mapper 原有 floor；不会修改现有任务执行、确认令牌或模型目录数据结构。
