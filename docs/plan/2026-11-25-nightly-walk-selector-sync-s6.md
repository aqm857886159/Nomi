# #1121 第六批夜跑走查同步

## 短版设计卡

### ★0 先查别人

- `src/workbench/assets/referenceNames.ts:31` · 引用按资产名截取，编号用于发送语义 · 确认用固定 fixture 验候选的完整名称及 chip 的视觉和无障碍缩写，并独立验视频槽及参考边。
- `src/design/confirmDialog.tsx:89` · Mantine 的可见确认面在对话框内容层 · 确认用原稿删除建立模态阳性对照，取消落定后才测方案删除。
- `tests/ux/_creationResourceTree.mjs:30` · 文稿树提供统一的分镜入口并验证编辑器出现 · 确认 Agent 跨面板走查复用这个入口。
- `electron/agentLane/laneSession.mts:232` · 从会话元数据重建每条 lane 的轨迹及项目索引 · 确认按真实会话定位，逐回合核 JSONL，再验两个打开入口。

出口：`src/design/confirmDialog.tsx:143` · 原稿删除确认可取消 · 阳性对照必须点本弹窗的取消，等关闭后再检查方案删除。

- ★1 每晚依赖这些走查发现交互回归。量具为逐条 Electron 的退出码和业务判据，以及 `nightly-walk-tree-guard.mjs` 的源码树对账。项目、设置和证据使用测试隔离数据，无存量迁移。
- ★2 `door-map` 对照 `clipReferenceName`、`confirmDialog`、`showUndoToast`、`buildModelMenu`、`arrangeStoryboardToTimeline`、`openLaneTraceDirectory` 与 `appendTaskNote`。各生产边界提供实际输出，走查消费；失败由走查的退出码和日志报告。
- ★3 夜跑同批有多处现役锚点迁移落后，属复发型测试漂移。就地复用生产锚点、共同入口与临时目录分配器，删旧选择器；退役的业务入口或真产品故障留原走查报红。本批依赖维持现状。
- ★4 空态、运行中、成功、失败及撤销过期按各走查的实际状态验证。使用回环 Agent 夹具，额度为零；只同步测试观察点。
- ★9 按夜跑日志在 `8ac07cffb` 复现，对照角色、数据锚点、产物与源码，以真实隔离窗口逐条跑到退出 0，并逐条运行树守卫。反例：只有 chip 没有边或视频槽、无操作却通过删除或撤销、少一个回合或错误轨迹路径、模型变成 Lite 或只剩一家、跳过分镜或缺少任一流程状态，均应报红。回滚用 `git revert` 此测试提交。

| 走查（`tests/ux/`） | 隔离窗口通过数 | 业务检查 |
| --- | ---: | --- |
| `at-mention-edge.walk.mjs` | 1/1 | 6/6 断言，含视频边、首个视频槽和 chip |
| `creation-plan-delete-undo.walk.mjs` | 1/1 | 3/3 删除与撤销路径，1/1 原稿模态阳性对照 |
| `canvas-control-clarity.walk.mjs` | 1/1 | 68/68 记录断言，含 15 档比例、数量 1–4 和顶栏 |
| `agent-trace-log.walk.mjs` | 1/1 | 3/3 回合和工具，2/2 精确的轨迹文件打开请求 |
| `agent-panel-form.walk.mjs` | 1/1 | 4/4 工作面，3/3 流程状态，各 3 条收据，2/2 模型默认项 |

保留三个红灯。`arrange-draft-cta.walk.mjs` 的空态数量提示条已退役（`src/workbench/timeline/TimelinePanel.tsx:124`）。`agent-ui-exception-states-runtime.walk.mjs` 的旧 Host 写口已退役，回环生成实际发出后现役面板仍没有原走查需验证的任务卡。`agent-panel-mechanics.walk.mjs` 在 340 px 的实测中模型名仍被截断。
