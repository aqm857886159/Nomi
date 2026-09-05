# Agent 面板 v4 设计实验室实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在设计实验室增加 `screen=agent-panel-v4`，用 Nomi token 与 Tabler icon 的真实 React 组件复现 v4 设计 12 板，阶段一不接 Host/网络。

**Architecture:** 保留现有 `screen=agent-panel` 注册表与状态不动；新建 v4 专用组件层和夹具状态注册表，设计实验室按 screen 选择对应注册表。组件只消费本地 fixture，所有尺寸/颜色来自 `--nomi-*` 与现有 Tailwind token，便于后续接线阶段替换数据源。

**Tech Stack:** React 18.3、TypeScript、Tailwind 3、Mantine 7、Tabler Icons、Vitest、Playwright 设计实验室入口。

**Spec:** `docs/design/2026-09-06-agent-panel-v4.md` 与 `docs/design/mockups/2026-09-06-agent-panel-v4/`。

## Global Constraints

- 仅新增 `screen=agent-panel-v4`，旧 `screen=agent-panel` 状态保持可达。
- 不新增依赖；不保留 shadcn/Radix 类名或第二套样式；不接 Host、网络、模型调用。
- 组件按积木拆分，单文件不超过 800 行；可见文字走 `useTranslation`，默认 zh-CN 并提供 en。
- 权限映射固定为 `step/safe-auto/project` 与 `confirm/within-budget`；模型按钮只显示名称。
- `useComposerHeight(panelHeight, mode)` 负责高度推导与内部滚动边界；Enter/Shift+Enter/IME 行为可测试。
- 每个状态先截图再对账，基线不更新；最终跑 `pnpm run gates`。

## 文件拆分与任务

### Task 1：设计输入与计划（里程碑 ①）

- Create: `docs/plan/2026-09-06-agent-panel-v4-lab.md`
- Create: `docs/research/2026-09-06-ai-elements-anatomy.md`
- Copy: `docs/design/mockups/2026-09-06-agent-panel-v4/`
- Acceptance: 设计真相源、AI Elements 解剖和范围/回滚/验收门进入当前分支；提交并推送。

### Task 2：v4 基础契约与纯函数

- Create: `src/workbench/ai/v4/agentPanelV4Types.ts`
- Create: `src/workbench/ai/v4/agentPanelV4Logic.ts`
- Create: `src/workbench/ai/v4/agentPanelV4Logic.test.ts`
- Produces: `useComposerHeight`、`approvalPolicyForLabel`、8 种积木状态类型与稳定 fixture 数据。
- Acceptance: 高度边界、收起坞、三档权限映射测试通过。

### Task 3：真实 v4 积木组件

- Create: `src/workbench/ai/v4/AgentPanelV4Primitives.tsx`
- Create: `src/workbench/ai/v4/AgentPanelV4Composer.tsx`
- Create: `src/workbench/ai/v4/AgentPanelV4Context.tsx`
- Create: `src/workbench/ai/v4/AgentPanelV4Panel.tsx`
- Test: `src/workbench/ai/v4/AgentPanelV4Primitives.test.tsx`
- Acceptance: Message/Response/Actions、Tool 7 状态、Task、Confirmation+Plan、Queue、Collapsed Dock、Context 环与 Composer 的状态均由真实 React 组件渲染，使用 Tabler icon 和 Nomi token。

### Task 4：设计实验室注册

- Create: `src/devlab/designLab/agentPanelV4States.tsx`
- Modify: `src/devlab/designLab.tsx`（按 screen 选择 v4 注册表，旧表保持）
- Modify: `src/devlab/designLab/agentPanelStates.tsx`（仅导出共享类型/旧 registry，不删旧状态）
- Acceptance: Vocabulary、Composer、Process、Dark、Collapsed 与 Main/Feasible/Sources/Flow* 等 12 板对应状态全部可通过 `state=<id>` 访问，页面暴露 v4 状态 id。

### Task 5：i18n 与对账

- Create/Modify: `src/i18n/locales/agentPanelV4.ts`、`src/i18n/resources.ts`、类型声明
- Create: `docs/qa/2026-09-06-agent-panel-v4-lab-reconcile.md`
- Acceptance: 可见文案中英齐全；逐件记录尺寸、间距、字号、颜色、icon、文案差异及处理结果；截图存于 `artifacts/design-lab/agent-panel-v4/`。

### Task 6：集成验证与里程碑 ④

- Run: focused unit tests, `pnpm run check:design-lab`, `pnpm run typecheck`, `pnpm run lint:ci`, `pnpm run gates`。
- Run: `pnpm run dev:renderer` + Playwright 对每个 v4 状态截图并用图片查看核对。
- Commit/push: 合并最新 `origin/main` 后提交里程碑 ④并推送 `feat/agent-panel-v4-lab-20260906`；不创建 PR。
- Create: `CODEX-REPORT.md`（≤15 行，列出路径、状态数、差异数、gates、push SHA、截图目录）。

## 回滚与验收门

回滚只需删除 v4 组件、注册表、i18n、plan/qa/research/mockup 拷贝，旧 `screen=agent-panel` 不受影响。验收门为：组件状态单测、纯函数单测、设计实验室注册一致性、截图逐板对账、全量 gates 绿、分支已推送；任何一项缺失均标为未完成。
