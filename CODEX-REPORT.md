Agent 面板 v4 设计实验室阶段一已完成（不接线）。
分支：feat/agent-panel-v4-lab-20260906；当前 push SHA：e9e5b976a9a9。
计划：[docs/plan/2026-09-06-agent-panel-v4-lab.md](docs/plan/2026-09-06-agent-panel-v4-lab.md)。
设计真相源：[docs/design/2026-09-06-agent-panel-v4.md](docs/design/2026-09-06-agent-panel-v4.md) 与 12 板 mockups 已拷入。
AI Elements 解剖：[docs/research/2026-09-06-ai-elements-anatomy.md](docs/research/2026-09-06-ai-elements-anatomy.md)；适配件在 `src/workbench/ai/v4/vendor/`。
真实组件：Message/Response/Actions、Tool 7 态、Task 5 态、Confirmation/Plan、Queue、PromptInput、ModelSelector、Attachments、Context。
设计实验室新增 `screen=agent-panel-v4`，注册 44 个状态；旧 `screen=agent-panel` 保留。
对账：[docs/qa/2026-09-06-agent-panel-v4-lab-reconcile.md](docs/qa/2026-09-06-agent-panel-v4-lab-reconcile.md)；出入 0 处。
验证：v4 逐状态截图 44/44、页面错误 0；`pnpm run gates` 60/60 contracts 通过、全量 unit 通过、build 通过。
截图目录：`artifacts/design-lab/agent-panel-v4/`（未更新基线）。
