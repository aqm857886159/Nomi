# 设计卡：Nomi 用户工作流性能专项

改动名：Nomi user workflow performance baseline and remediation  
线/负责人：Codex 性能线（独立验收线待协调会话指定）  
类别：[长跑][可打断][大数据量 / 画布 / 长列表][Agent 行为]

## ★1 用户怎么用

当创作者在同一项目里反复切换文稿、分镜方案和混合图片/视频画布，并让 Agent 流式输出或运行工具时，我想在每个动作后马上看到可操作反馈，以便继续编排而不用等待或猜测是否卡住。覆盖 P1–P2、D1–D2、B1–B2、C1–C3、A1–A4、R1–R2；不触发付费模型生成，不把网络/模型等待算成 UI 阻塞。主指标是 input→visible/interactive p95、frame p95/p99、掉帧、长任务、CPU 和内存趋势；功能护栏是取消/失败/恢复与重复开关正确；基线/目标和样本来源固定在 `scenario-matrix-and-budget.md`。

真实任务形态：短文稿多版本比较、分镜方案批量整理、混合素材引用与预览。当前环境只能提供脱敏仓库 fixture；私有素材/真实账号在 `limitations.md` 标记 `unverified`。

## ★1b 连带界面

Agent 面板的 idle/stream/tool-running/取消/失败/恢复状态、项目库打开反馈、文稿/方案切换反馈、画布媒体加载/错误状态都纳入走查。性能修复不新增可见文案；若发现状态文案缺失，单独记录为 blocker，不在本专项顺手改产品语义。

## ★2 谁说了算

性能事实归测试证据与现有渲染/主进程 owner：画布节点和媒体生命周期由现有 canvas store/React Flow 边界负责，项目与文稿/方案持久化由现有 workbench/project owner 负责，Agent 状态由现有 lane/agent contracts 负责；探针只读，不复制业务状态。执行 `node scripts/door-map.mjs <changed-symbol-or-file>` 记录所有入口。相同事实只在生产 owner 存一份，raw JSON 只保存观测结果。

## ★3 一致与复用

复用 `tests/ux/_launchApp.mjs`、`tests/ux/fixtures/canvas-performance-fixture.mjs`、`tests/ux/canvas-performance-benchmark.e2e.mjs` 的真实 Electron/Playwright 启动、媒体夹具和探针边界；复用现有项目打开分阶段 probe，不复制另一套启动器。新增测量只放在 `tests/ux/nomi-user-workflow-performance.e2e.mjs` 及其 fixture/分析脚本，避免把历史画布 gate 改成另一种口径。

## ★4 全状态

空/加载：显示已有骨架或明确等待状态并记录首次反馈；成功：目标文稿/方案/节点可交互；失败：现有错误卡和可恢复动作保持可见；部分成功：已完成项保持可用，失败项可重试；取消中：取消控件立即反映并最终回到可操作状态；过期：旧流/工具回执不覆盖新项目状态；能力不可用：本地 fixture/外部资源缺失时记录 blocker 与下一步，不伪造成功。中英文文案由生产 i18n owner 保持，本专项不新增硬编码文案。

## 5 中途表

| 状态 | 停止 | 关窗 | 断网/fixture 失败 | 重启 | 连点 |
|---|---|---|---|---|---|
| 打开/加载 | 回到库且无残留 spinner | 可重新打开 | 错误可见且可重试 | 项目数据可读 | 不重复创建窗口 |
| stream/tool-running | 取消回执收敛到终态 | 任务按现有恢复策略处理 | 失败与重试可区分 | 不出现旧回执覆盖 | 只接受一次取消 |
| 画布预览 | 停止播放/清理媒体 | 无活跃视频泄漏 | 媒体错误可恢复 | 重新加载稳定 | 不叠加播放器 |

## 6 外部数据与失败

本专项只使用本地生产 fixture 和 Electron/Playwright/CDP 观测接口；网络/模型调用不触发。真实素材、真实账号、GPU 驱动差异写入 `limitations.md`，不把未知失败归因于用户。

## 7 性能预算

预算和固定数据规模见 `scenario-matrix-and-budget.md`，先写后测，失败不能通过调高阈值解决。

## 8 真实条件

Linux/Xvfb、英文/中文界面、最小窗口、典型/重档、键盘与鼠标动作、冷/热缓存、重复开关会跑；Windows/macOS 真机、真实素材、真实账号和打包发布版若未具备均标 `unverified`。

## ★9 验收与回滚

验收：独立线按矩阵跑 `node tests/ux/nomi-user-workflow-performance.e2e.mjs --scale small,typical,heavy --runs 5 --warmup 1`，复验功能走查、取消/失败/恢复和 R1/R2 资源回收；对比 raw JSON 和 `analysis.md`。回滚：revert 本分支性能 commit；测量脚本/证据目录可独立保留。PR 必须链接场景矩阵、raw 数据、前后对比、限制和独立验收报告。

### 功能分类

- [ ] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [x] Agent 行为
- [x] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式

