# C04 / C06 真实组件截图返工

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

范围：删除四张手写 SVG；增加真实策略面板和多镜花费确认 specimen、1440px 前后 PNG 与可复跑截图脚本；保存 gates 完整退出码及尾 30 行。冻结区和生产行为不改。回滚只撤回本次证据文件及实验室注册。验收：同输入真实 React 渲染、目视检查四张 PNG、完整 gates exit 0 后才 push。

根因：手画样张绕开真实组件与调用点；旧报告把 advisory 的子命令失败与整条 gates 的退出码混为一谈。两类均可复发，本次在截图采集脚本调用真实组件/投影，并将进程退出码与原日志一起保存；不修改生产路径或门岗。

## 先查别人

- 依赖里已有：React/i18n only provide rendering primitives; no aggregation or scheduler ETA helper in installed d.ts/README.
- 仓库里已有：`electron/capabilityCore/mcpGenerationTools.ts:63` owns cold-start ETA and `StoryboardPlanStrategyPanel.tsx:138` owns blocker rows; both are the shared boundaries changed here. `rg` found no existing issue-group projection.
- 仓库里的并发依据：`src/workbench/generationCanvas/runner/generationRunController.ts:434-487` already runs bounded workers, so the confirmation projection must use rounds rather than serial addition.
- 生态里已有：Promise pools conventionally estimate batches by `ceil(count / concurrency)` rounds; see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all.
- TikHub 自媒体里怎么说：本次没有使用 TikHub，因为这是本地投影数学与 UI 聚合，不涉及外部用户教程或市场方案。
- 结论：复用仓库既有 resolver、i18n 和 scheduler 边界，自研两个纯函数以保持现有契约，不引入新依赖。

## 截图来源与复跑

运行：`node tests/ux/design-lab/c04-capture.mjs`（在本 worktree 根目录）。脚本生成临时 `.c04-evidence.html`，复用 design-lab.html 的 HTML、样式与真实 Nomi providers；临时入口挂载 `tests/ux/design-lab/c04-evidence.tsx` 的两个 specimen。每张图使用独立 Chromium context，1440×1100、DPR 1、浅色、zh-CN；不拼图、不画替身、不调用供应商。

| PNG | specimen / 实际渲染 | 源码版本与数据 |
| --- | --- | --- |
| c04-before.png | c04 / StoryboardPlanStrategyPanel | origin/main；8 镜都指定目录外模型，真实 resolver 纠正为 MiniMax H3；显示 8 行 |
| c04-after.png | 同一 c04 | 当前任务代码、相同 plan/state；显示 1 行，保留 #1–#8 |
| c06-before.png | c06 / SpendConfirmDialog | origin/main 的 coldstartEtaForGate；8 个 video、并发输入 6；1920 秒，卡上约 32 分钟 |
| c06-after.png | 同一 c06 | 当前 coldstartEtaForGate、相同任务输入；480 秒，卡上约 8 分钟 |

真实调用点：C04 为 `src/workbench/creation/storyboard/StoryboardPlanEditor.tsx:487`，通过 `storyboardPlanToPlanShotInputs → resolveGenerationPlan → classifyResolveStrategy` 得到面板 view；C06 为 `src/workbench/capability/capabilityApplyHandler.ts:209`，同样经过 `buildMultiShotGateProjection → buildMultiShotContractView → requestConfirm`，包括真实标题、正文、确认按钮、倒计时、试拍与返回操作。固定价 ¥1/镜仅为可重复的目录定价夹具，不代表供应商报价。鼠标移入弹层让生产倒计时按真实交互暂停。

截图脚本用 `git show origin/main:<path>` 临时替换 `StoryboardPlanStrategyPanel.tsx` 和 `mcpGenerationTools.ts`，完成 before 后恢复读取到的任务版本并拍 after；finally 恢复两份源文件、关闭自有浏览器和服务器、移除入口。不动 index，不 stash，不另建 worktree。`capture-receipt.json` 记录准确的 baseline/head SHA、ETA 输出及从真实 DOM 读出的文案。

证据边界：这是实验室真实组件截图，不宣称整套 Electron 项目旅程；C04 沿用现有 TableStage 的 900px 舞台，C06 为真实 body portal 弹层。没有新增或更新任何已拍板视觉基线。任务指定 lesson 文件在 HEAD 和 origin/main 均不存在，已读取 `src/devlab/designLab/labScreen.ts` 中同一调用点镜像纪律并按其执行。

## gates 退出码纠正

旧 C04-LAST 的“3 条 advisory 导致总退出码 1”错误。旧会话日志中，失败轮明确是 `check:prior-art`（退出码 1），随后补齐计划出处的一轮为 73 通过、0 阻断、3 advisory，且末尾确有“五门戳已盖”。advisory 的子命令 exit 1 不会让 `run-gates-contracts.mjs` 返回 1；只有阻断失败会。

本次重新执行完整 `pnpm run gates`，进程退出码独立保存在 `artifacts/c04/gates-exit.json`，原始日志尾 30 行在 `artifacts/c04/gates-tail.log`。不修改任何门岗。只有拿到 exit 0 才推送。
