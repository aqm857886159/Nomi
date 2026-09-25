# 保持已有镜头编辑时的画布视口

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

范围：`multiShotCanvasLanding.ts`、对应单测和根因合同。修复 Agent 改既有镜头提示词、同版本重放、结果回填时不必要的自动 fit；新增节点、组、表仍展示新内容。不改 Golden Path 的提示词断言，不改分镜表密度规则。

## 复现与根因

PR #827 的 Linux CI run `35497170584` 在 Golden Path 第 354 行失败：第 2 镜提示词已落盘且第 1/3 镜未变，但表行文本只剩 `02未生成`。提示词使用 span，不是 input。`ShotTableGrid.tsx` 在 compact 密度卸载时长、画面和参考列；`shotTableDensityForZoom` 以 0.8 为 full 阈值。

`materializeShots` 对仅 rebind 的调用也无条件 `requestCanvasFit`。`useCanvasFitSignal` 延迟 360ms 后自动适应全部节点，打断用户设好的 80% 阅读视口，导致表格降密度。节点派生与落盘链路正常，缺失不变量是“同步已有内容不产生导航副作用”。同版本重放与结果回填亦可触发。

## 先查别人

- `src/workbench/generationCanvas/agent/applyCanvasToolCall.ts:519`：仅真建多个节点才请求 fit，复用已有节点不导航；单个新节点走已有 focus 事件。
- `src/workbench/generationCanvas/components/useCanvasFitSignal.ts:12`：消费 nonce 后延迟执行 fit，本轮不改消费者或 React Flow。
- `src/workbench/generationCanvas/nodes/shotTable/ShotTableGrid.tsx:43`：提示词本就只在 full 展开；不更改密度设计来掩盖导航问题。
- `node scripts/door-map.mjs requestCanvasFit` 实扫 5 扇写门。资产导入在新节点存在时 fit；切图在产生多个切片后 fit；生产状态 open-stage 是用户明确导航。只有 materializeShots 把数据同步误作导航。

## 修复与验证计划

在共享 materializeShots 边界，仅本次新增节点/组/表时请求 fit。不能复用 changedCanvasStructure，它还包含仅重绑定，承担撤销与持久化的独立职责。

先新增红测：既有三镜只改第 2 镜，节点 ID/其他镜提示词/节点选择/表格选择/活动分类/fit nonce 保持；同版本重放与结果回填亦不导航。正向覆盖首次三镜落地、只补组、单镜增加为多镜建表仍 fit。随后改生产代码并跑对应与相邻单测、根因合同和 scoped lint。真实 Electron Golden Path 及 Linux CI 由父任务统一重跑；不把单测的 nonce 不变当作已验证浏览器 transform。

回滚：回退本次生产文件与测试变更。无数据迁移，无新增依赖。风险：用户显式“打开舞台”仍可导航，这是不同意图；已有节点尺寸因生成结果变化的视口策略仍归现有媒体/画布 owner。

## 本轮证据

- 先红：新增重绑定、幂等重放、结果回填 3 项均在旧生产代码失败，fit nonce 从 2 增至 3；其他 3 项新内容展示正向控制通过。日志 `/tmp/nomi-materialization-viewport-red.log`（调用 fair-share runner 实际选了 157 个文件，3 failed /1712 passed）。
- 修复后 4 个相关测试文件共 66 项通过：落地、Agent 单账本、create_canvas_nodes、生产分镜行派生。日志 `/tmp/nomi-materialization-viewport-green.log`。重绑定测试同时证明 ID、其他镜头提示词、节点选择、表格选择和活动分类保持。结果回填使用合成 nomi-local URL，只验证状态写入，不声称真实媒体或付费生成已验收。
- Scoped ESLint 通过；生产文件 391 行，测试 250 行，均低于 800 行。
- 父任务增强 Golden Path，在旧构建先确定性复现：matrix(0.8,0,0,0.8,-81.3092,-443.694) 被改成 matrix(0.589109,0,0,0.589109,-28.6931,19.7327)，从 80% 降为 58.9%。归档 `docs/audit/2026-09-20-waiting-grid-evidence/golden-viewport-before.json`；稳定窗口跨过 360ms delayed fit，排除抢在副作用前的假绿。修后重建/真实应用完整旅程与 Linux CI 由父任务执行。
- `pnpm run check:root-cause-contracts` 48 项脚本自测与合同检查通过；加入 Golden Path 回归路径后单独重跑 checker 通过。日志 `/tmp/nomi-materialization-viewport-contract.log`。
- `pnpm run check:door-map` 11 项脚本自测与本次 3 份受管合同门表通过；日志 `/tmp/nomi-materialization-viewport-doormap-check.log`。原始生成门表 `/tmp/nomi-materialization-viewport-doors.txt`，全部 5 门保持，无新增导航入口。PR 正文引用由父任务交付阶段处理。
