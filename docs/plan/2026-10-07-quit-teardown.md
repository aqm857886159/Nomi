# 设计卡：退出拆除与项目打开失败隔离

改动名：退出生命周期与 Agent lane 隔离  线/负责人：fix/quit-teardown-not-before-quit  类别：[可打断][长跑][新界面]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当用户安装更新、退出或打开项目时，我想让窗口关闭可以完成、项目仍能打开，以便画布和时间轴可用；不做自动更新签名改动；已知坑是 Agent 连接仍可能暂时不可用。真实任务：更新后取消关窗、重新打开项目、在 Agent 面板点击重连。主指标：项目可见；质量指标：退出后无残留占用；护栏：取消退出后 IPC 仍可调用。真实素材未接入，走查记 `unverified`。 | `tests/ux/deconstruction-interrupted-recovery.walk.mjs`；用户 Mac 日志 |
| ★2 谁说了算 | `host.quit-teardown` owner 为 `electron/quitTeardown.ts:installQuitTeardown`；`host.agent-lane-ipc` owner 为 `electron/agentLane/laneIpc.ts:registerAgentLaneIpc`；`workbench.project-hydration` owner 为 `src/workbench/NomiStudioApp.tsx:hydrateProject`。主进程持有退出状态；渲染层只消费码。每份事实一份。 | `node scripts/door-map.mjs registerAgentLaneIpc`; `node scripts/door-map.mjs hydrateProject` |
| ★3 一致与复用 | 复用 Electron 的 `before-quit` / `will-quit`，复用现有 `LaneCommandFailure`、`laneFailureText` 和 Agent 面板错误条；不新增通用退出框架。 | Electron 官方文档；`git grep` |
| ★4 全状态 | 空：项目画布照常显示；加载：显示既有 hydration loading；成功：Agent 面板正常；失败：面板显示本地化 lane 原因和「重新连接」；部分成功：项目可用、Agent 独立失败；取消中：退出标记后关窗确认不再拦；过期：lane 返回 stale 码；能力不可用：显示原因并提供重连。 | `check:i18n`；Agent 面板现有错误条 |
| 5 中途表 | 退出状态 × 关窗：`before-quit` 只标记，`will-quit` 收尾；网络断：项目不受影响，重连按钮可走；重启：新进程重新注册 handler；连点：lane open 串行化。花费不适用，回执在主进程日志和 lane 码。 | 生命周期测试；Electron 走查 |
| 6 外部数据与失败 | Electron 事件顺序按官方文档；lane 失败来自主进程工作区。未知失败收为 `agent_lane_execute_failed`，界面只显示本地化兜底，不展示诊断串。 | `electron/shared/agentLane/laneErrorCodes.ts`; 官方文档 |
| 7 性能预算 | 退出清理不增加首屏路径；lane 失败提示一次渲染；最大项目规模沿用现有画布预算。 | `pnpm run typecheck`；人工 |
| 8 真实条件 | Windows：未验证；英文：未验证；最小窗口：未验证；真规模：未验证；干净安装：仅依赖安装完成；真付费：不适用；键盘全程：未验证。 | 资源与无界面窗口限制 |
| ★9 验收与回滚 | 独立验收由协调会话另派线运行 lifecycle/lane 测试和无界面 Electron 走查；逐项核对 ⑫「点了项目仍能打开」。回滚：revert 本分支提交。 | PR `## 独立验收`；`tests/ux/deconstruction-interrupted-recovery.walk.mjs` |

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
