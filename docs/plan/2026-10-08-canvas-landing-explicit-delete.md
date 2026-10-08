# Canvas landing：显式删除信号与主进程单写口

状态：已实现未推送（2026-10-08）

## 设计卡

| 格 | 问题与决定 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 用户在制作批次落地后删除、剪切、撤销或重做镜头；系统必须只在这些明确动作发生时告诉 Run “这一镜不再派”，生成结果仍要能回到被撤销的节点。后台项目的生成结果只通过主进程写回项目文件。 | `src/workbench/production/redoReattachesProductionShots.test.ts`；`src/workbench/generationCanvas/store/undoKeepsLandedResults.test.ts` |
| ★2 谁说了算 | 删除/重挂信号的 owner 是 `src/workbench/production/productionCanvasSignals.ts#emitProductionCanvasSignal`，消费方是 `ProductionCanvasLandingHost`；项目文件写口的 owner 是 `electron/projects/projectCanvasWrite.ts#serializeProjectCanvasWrite`，所有 main 写者都经它排队。 | `node scripts/door-map.mjs deleteNode deleteSelectedNodes cutSelectedNodes applyExternalGraph applyCanvasNodePatch serializeProjectCanvasWrite writeDiskSnapshot`；`docs/engineering/concept-owners/` |
| ★3 一致与复用 | 删除信号复用现有画布提交边界和生产 Run command；项目写回复用 `mergeExternalCanvasWrite`，只新增 main 进程队列与 node patch IPC，不复制项目文件格式。 | `electron/capabilityCore/gateway.ts`；`electron/shared/canvas/externalCanvasWrite.ts` |
| ★4 全状态 | 删除成功：显式 detach；撤销/重做恢复镜头：显式 reattach；装载、卸载、切项目、普通节点创建撤销：不发信号。主进程写口不可用或 binding 失配：失败并保持原文件。 | `src/workbench/generationCanvas/store/canvasDocumentCommit.ts`；`electron/projects/projectCanvasWrite.ts` |
| ★5 中途表 | 运行中改提示词后结果到达：提示词保留新值，结果落地；随后 undo/redo：只回退/恢复提示词，结果始终保留。主进程两个写者交错：每次在队列内重新读取当前项目，再合并/打补丁。 | `src/workbench/generationCanvas/store/undoKeepsLandedResults.test.ts`；`src/workbench/generationCanvas/runner/diskWriteInterleave.test.ts` |
| ★6 外部数据与失败 | 外部画布写入仍按 `base → next → current` 三方合并；生成结果 patch 只改节点事实字段，主进程按 nodeId 合入当前节点，因此外部 prompt 等编辑不会被旧快照覆盖。缺项目、节点或身份失配时 fail closed。 | `electron/shared/canvas/externalCanvasWrite.ts`；`electron/projects/projectCanvasWrite.ts` |
| ★7 性能预算 | 单项目写入串行，额外成本是一轮 main 内存队列和一次当前文件读取；无轮询与重试放大。常规编辑仍由已有画布持久化节奏负责。 | `serializeProjectCanvasWrite`；未建立独立性能工具，标记 `unverified` |
| ★8 真实条件 | 已在 Windows 工作区跑 focused Vitest 和 test-types；真实 Electron 打包、多窗口同时写和真实付费任务未跑，标记 `unverified`。 | `pnpm exec vitest run ...`；`pnpm run check:test-types` |
| ★9 验收与回滚 | 验收线待派：复现批次落地→undo→redo、运行中改 prompt、renderer/main 交错写；回滚按提交顺序反向 revert，不能恢复 `watchDeletedProductionNodes` 推断。删除旧 watcher、renderer `saveLocalProject` 路径是同 commit 的结构性删除。 | `## 独立验收`（待派）；提交 trailer `Direction-Check: docs/plan/2026-10-07-canvas-landing-direction-check.md` |

### 功能分类

- [ ] 新界面 / 交互改变
- [x] 花钱（删除停止后续派发，已落地结果不回收）
- [x] 长跑 / 可打断（后台生成与项目写入）
- [x] Agent 行为（Run 绑定与 detach/reattach）
- [x] 大数据量 / 画布 / 长列表
- [x] 生成结果
- [x] 数据格式（仅写入方式变化，格式不变）

## 先查别人

- Kubernetes 声明式对象管理把「用户明确提交的期望状态」与控制器观察到的差异分开：https://kubernetes.io/docs/concepts/overview/working-with-objects/object-management/ 。本任务采用同一原则：删除动作发显式 intent，装载 / 卸载造成的差异不再被解释成删除。
- SQLite 的锁模型同一时刻只允许一个写者（RESERVED / EXCLUSIVE 锁串行写入）：https://www.sqlite.org/lockingv3.html 。本任务把 renderer 的项目文件写回改为 main IPC，并让 gateway 与结果投递共用一个按项目串行的队列 `electron/projects/projectCanvasWrite.ts:11`（`serializeProjectCanvasWrite`）。
- Electron 官方 IPC 模式：渲染进程用 `ipcRenderer.invoke` 请求、主进程 `ipcMain.handle` 执行有副作用的操作：https://www.electronjs.org/docs/latest/tutorial/ipc 。节点补丁 `projects.applyCanvasNodePatch` 按此模式走主进程，不在渲染进程直写项目文件。
- 合并逻辑复用仓库已有的三方合并 `electron/shared/canvas/externalCanvasWrite.ts:59`（`mergeExternalCanvasWrite`），没有另写一份。
- 这些外部原则只决定边界形状；Run 命令格式、画布 node patch 和项目身份校验仍由仓库现有 owner 决定。
