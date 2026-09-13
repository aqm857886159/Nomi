# Agent tool face 结构评审

`check:symptom-cluster` 把本任务所在的 Agent lane / capability 接线层标为近期第三份根因合同聚类。这里先做结构评审，再继续扩大修复范围；本报告不把未完成的真实页面验收写成通过。

## 共同结构信号

- `docs/fixes/2026-09-09-canvas-acceptance-red.root-cause.json`、`docs/fixes/2026-09-13-agent-verb-transport-approval.root-cause.json` 与本轮 `docs/fixes/2026-09-13-canonical-canvas-read-alias.root-cause.json` 都触及 Agent 工具进入真实画布/生成边界。
- 共同缺口是跨边界事实传递：模型看到的 canonical verb、Pi transport alias、真实 Surface，以及 `tests/ux` 的页面证据没有由同一条验收链绑定。
- 本轮真实轨迹已证明一个具体后果：`look_at_canvas` 曾因 caller 手写 MCP alias 而全部失败；没有真实 `tests/ux` 走查就会被“无工具回答”误判为成功。

## 结构决议

1. 共享 capability descriptor 继续作为 verb/transport identity 的唯一来源；lane caller 不再手写别名。
2. 单元测试只证明 adapter/lane 边界；用户可见完成必须由 `tests/ux` 真实 Electron 任务证明，包含空画布、多节点、冷启动和失败面。
3. `artifacts/real-target-branch/state-matrix.md`、`parsed-real-turns.json` 和页面截图作为同一矩阵的证据面；助手文本不能替代 tool call 或页面状态。
4. schema drift 与真实页面失败分别处理：不得抬高 model-schema 基线，也不得以 loopback 结果替代 provider canary。

## 同轮 scripts 门岗聚类

`check:symptom-cluster` 同时报告 `scripts` 模块在 2026-09-07 至 2026-09-13 聚集了多份合同。它是仓库门岗编排层的历史聚类，不是本次 Agent lane 运行时修复的理由；后续涉及 scripts 的合同应先归并门岗职责或新增共享分析模块，再继续添加逐文件补丁。

## 评审范围与验证限制

- 结构入口：`electron/agentLane/laneDesktopTools.ts`、`electron/shared/agentCapabilities/canvasRead.ts`。
- 真实走查入口：`tests/ux/storyboard-agent-canonical-patch.e2e.mjs` 与待完成的 Agent user-case matrix；它们必须启动真实 Electron 并保存截图。
- 当前验证：canonical patch 回归 26/26、lane 相关测试 22 通过/3 跳过；完整 gates 仍受 schema、Ponytail、历史结构债阻断。
- 当前限制：macOS 锁屏使 Computer Use 无法继续；U01–U24 和真实素材 canary 尚未完成，不能宣布交付。
