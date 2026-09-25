# Agent 付费卡生成的节点「视频早出好了还在转」——状态只留一个 owner

> 状态：已实施（2026-09-25，分支 `claude/agent-run-landing-state`）· 根因合同：`docs/fixes/2026-09-25-agent-run-node-state-single-owner.root-cause.json` · 结构评审：`docs/audit/2026-09-25-agent-run-canvas-projection-structure-review.md`

## 用户摩擦

用户在 Agent 面板的付费卡上点了生成，镜头节点一直「整卡模糊 + N 字标」在转；供应商那边视频早就出好了。任务面板同时说「供应商长时间没有返回新状态」。普通「生成」是另一套等待画面——同一个「生成中」两套画法、两份真相。

## 范围

1. 供应商查询带上 Run 账本里冻结的任务身份（模型 / 模式），新建的供应商实例也查得到——观察窗到期的重踢、重开项目、重启都走这条。
2. 单镜观察窗到期后与多镜同一条规则接着问（只查不交）。
3. 一镜「在哪一段」只有一个判定（中立层），生成中 / 失败 / 结果写进节点自己的运行记录，由普通生成那一套画；Run 每次耐久变化后画布跟随。
4. 供应商产物取回一条线路策略；落回节点的结果地址用素材库永久地址（旧项目加载时改写）。

## 不动项

- 任务面板的文案与分组（`claude/agent-panel-tidy` 那条线）。
- APIMart 内置目录的 mapping / 查询 op 一个字节不动。
- 多镜调度器的派发 / 预算 / 检查点规则不动。

## 回滚

单 PR revert 即可：没有数据迁移写盘（旧结果地址只在加载时改写、保存时自然落成新地址；回滚后新地址仍是合法的 nomi-local://asset）。

## 验收门

- 旧代码上变红的单测：`productionGenerationSubmission.test.ts`（新实例查询带身份）、`multiShotCanvasLanding.test.ts`（投影带运行状态）、`appIntegrationRunObservation.test.ts`（单镜到期接着问）。
- 真实走查 `tests/ux/agent-spend-video-landing.walk.mjs`：付费卡 → 普通等待画面 → 观察窗过后仍在查询 → 出片后节点是结果、任务面板不再报 stale → 英文 + reload 片子还在；zh / en 截图人眼看过。

## 先查别人

- **仓库里已有（查询身份）**：普通生成的「重新拉取结果」本来就把 vendor / modelKey / taskKind 一起递给主进程，好让它「命中与首发同一个 query 桶」——`src/workbench/generationCanvas/runner/recoverTaskActions.ts:25`。制作这条路缺的正是这一步。
- **仓库里已有（供应商侧早就留了口子）**：`electron/capabilityCore/apimartGenerationProvider.ts:556` 的 `queryTargetFor` 写明「合法答案只有三个：① 调用方明说（Run 的账本里就记着 job.model / job.taskKind）……」——①从来没有调用方递过。结论：不自研新机制，把 `generationRuntimeAdapter.query` 的签名补上这个参数、由 `productionGenerationSubmission.poll` 从冻结合同递下去。
- **生态里已有（查询键里就含模型 / 应用）**：fal 的队列 API 查询状态与取结果都要 `application` + `request_id` 两个参数（https://github.com/fal-ai/fal/blob/main/projects/fal_client/src/fal_client/client.py `SyncClient.status(application, request_id)` / `result(application, request_id)`）——端点按应用分，调用方必须把应用身份与任务号一起持久化。反例是 Replicate：`predictions.get(id)` 只要任务号，因为只有一个查询端点（https://github.com/replicate/replicate-python/blob/main/replicate/prediction.py）。APIMart 图片与视频查询 op 不同，属于前者。
- **仓库里已有（一个节点在生成的画法）**：普通生成的等待层 `src/workbench/generationCanvas/nodes/NodeGeneratingOverlay.tsx:16`（读节点自己的运行状态）。结论：制作节点不再另画，把运行状态写进节点、复用它。
- **仓库里已有（Run 变化的广播）**：`electron/productionRun/productionRunRuntime.ts:19` 的 `subscribeProductionRunChanges`（仓库 `execute` 的事件旁路），`electron/agentLane/laneDesktopTasks.ts:35` 已经在用。结论：画布跟随挂在这里，不在每个状态转移点各补一次投递。
- **TikHub 自媒体**：不适用（这是内部运行时契约问题，不涉及用户侧工作流选择）。
- **结论**：全部用已有能力接线，没有新写一套轮询 / 恢复机制。
