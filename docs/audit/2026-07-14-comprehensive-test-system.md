# 2026-07-14 完整测试系统审计

## 结论

本轮把仓库原有的单测、门禁、Electron smoke 和 Agent 旅程收敛成统一测试系统，并对最新本地源码完成实跑。确定性门禁全绿；真实生成额度层完成；测试系统不再允许“选择到 0 个旅程仍显示通过”。

## 覆盖与结果

| 层 | 结果 | 证据 |
|---|---:|---|
| 能力矩阵 | 22 项能力、4 个验证维度 | `tests/system/capabilities.json`、`docs/testing/capability-matrix.md` |
| Vitest | 2612 通过、1 跳过（统一 CI 运行时） | `pnpm test:system:ci` |
| 覆盖率 | statements 65.24%、branches 55.27%、functions 64.07%、lines 67.60% | `pnpm test -- --coverage` |
| Electron smoke | 10/10 | `pnpm test:e2e` |
| IPC 分层 smoke | 6/6 | `node tests/ux/ipc-split-smoke.e2e.mjs` |
| 设计保真 | 52/52 | `node tests/ux/design-fidelity.e2e.mjs` |
| 冷启动 | 8/8 | `node tests/ux/cold-start.e2e.mjs` |
| 导出模块 | 32/32 | export job IPC + export UI 单测 |
| J2/J4 Agent 旅程 | 2/2 | 163,031 tokens |
| J3/J5 零额度旅程 | 2/2 | 当前产品真实 UI |
| J6 真实生成阶段 | 通过 | 94,576 tokens；运镜渲染、参考注入、真实生成判据全绿 |
| Push 门禁 | 全绿 | filesize、tokens、dangling tokens、archetype defaults、lint、typecheck、test、build |

## 发现并修复的问题

1. `test:journeys` 在选择器没有匹配任何旅程时会假绿。现在零选择直接非零退出，并有回归测试。
2. Electron 旅程受已安装旧版 Nomi 的单实例锁影响，可能测到错误版本或无法启动。现在每次使用隔离 userData、projects、settings，并允许测试实例共存。
3. J2/J4/J3/J5 旅程仍依赖旧 UI 文案和旧参数假设。已改为当前产品的图结构、模型能力和可执行终态断言。
4. 生成助手第一次点击会立即重新收起。根因是懒加载面板挂载 effect 把 store 状态重置为 `defaultCollapsed=true`；已删除该副作用，设计保真回归覆盖首次展开。
5. 冷启动测试硬编码“新安装必定零文本模型”，与最新版 5 个预置模型冲突。现在按目录真实状态验证常态入口与缺模型恢复入口互斥。
6. 设计保真测试命中 keep-alive 隐藏副本，并使用旧 token/布局期望。现在只定位可见实例，并对当前设计 token 做计算样式断言。
7. release 测试档案引用不存在的 `real-generation-export.e2e.mjs`。现在接到仓库权威的 `camera-move-render-e2e.mjs`，并显式开启真实评测环境；不再把跳过当通过。
8. J6 把行为层中“为取证而预期拒绝的写工具”计作旅程失败。现在由里程碑自行捕获并拒绝，框架只按行为断言判定。
9. `dolly_zoom` 已进入精确 3D enum，但三处 Agent 提示和旧评测仍称它为词表外。已统一能力描述，词表外回归改用真正未支持的 `whip-pan`，并在执行器强制 `move/customMove` 互斥，避免歧义请求静默走错 enum。

## 已知覆盖边界

能力矩阵仍诚实标出 23 个尚未形成独立自动化证据的细维度，主要集中在低频供应商异常、跨平台窗口行为、长时任务恢复与部分媒体边界。它们不会再被统计成已覆盖；后续新增能力必须同步矩阵，release 档案会继续把门禁、全旅程和真实生成串起来。

## 评测消耗

- J2/J4 成功复跑：163,031 tokens。
- J2/J4 首轮诊断：128,751 tokens。
- J6 真实生成：94,576 tokens。
- J6 行为层诊断复跑：60,263 tokens。
- 本轮已记录消耗合计：446,621 tokens。
