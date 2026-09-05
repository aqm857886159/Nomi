# Nomi 当前状态与设计链审计

基线：`origin/main@89dcd9131025cc8d5f74e5afe3432ea9eb142faf`
证据状态：`observed`（静态源码/已合入文档）；真实 Electron/provider 未在本轮伪装为完成。

## 设计链真实状态

| 项目 | 已合入内容 | 当前能证明什么 | 不能证明什么 |
|---|---|---|---|
| #315 | Agent v3.2 设计、mockup、正常态合同 | 视觉/交互意图与合同存在 | 运行时全屏 Agent 已完成 |
| #438 | 17 个 P0 异常态设计与意图合同 | 异常态覆盖有设计基线 | 每个异常态已由 durable receipt 驱动 |
| #445 | Resident normal state 生产 UI | 正常态组件已合入 | 跨工作面统一 Thread |
| #447 | 异常态实现、Host queue/persistence 接线 | 代码路径和局部运行时证据存在 | canvas/package/macOS/Windows 全部已证明；skipped 不算通过 |
| #471 | generated spec、computed contract、conformance walk | 机器合同可执行 | 人眼视觉 sign-off 和真实创作闭环 |
| #472 | M0-M5 收敛执行方案 | 里程碑与证据边界已固定 | M0-M5 已毕业 |
| #454 | OPEN；anchor row / parameter rail | 只有未合入分支内容 | 不能作为本任务视觉来源；其方向明确排除 |

## 真实入口与缺口

- Resident 唯一 UI owner：`src/workbench/ai/ProjectAgentResidentShell.tsx:56,327-389,597-659,767-786`。它被 Portal 投射到工作区；当前 `ResidentSurface` 没有真正的 `storyboard` 类型。
- Shell 投射：`src/workbench/WorkbenchShell.tsx:153-168,232-241,341-377`。Storyboard 被映射为 `creation`；打开 Skill library 会跳 generation；没有独立全屏 Agent/Skill aggregation surface。
- Skill picker：`ProjectAgentResidentShell.tsx:665-680` 当前 `filteredSkills = skills`，不能把它称为真实搜索；现有 `skill.json` 合同见 `electron/skills/skillManifestSchema.ts:91-126`。
- 文档写入：`src/workbench/creation/WorkbenchEditor.tsx:174-215` + `src/workbench/creation/documentWriteTarget.ts:61-148` 已有发送时冻结 anchor、revision/hash 校验和 stale rejection，可复用。
- 画布：`src/workbench/generationCanvas/reactFlow/generationCanvasReactFlowAdapter.ts:9-11,81-114` 与 `generationCanvasStore.ts:240-314` 表明 React Flow 是 renderer adapter，持久化 canvas model 才是真相源；不新增第二 renderer/store。
- 分镜：`src/workbench/creation/storyboard/StoryboardPlanEditor.tsx:45-95,389-415`、`StoryboardShotTable.tsx:172-220,300-345` 已有表格、选择和编辑入口；Agent canonical patch 以 `electron/shared/agentCapabilities/canvasWrite.ts:148-180` 的 `nomi_canvas_plan/patch_shots` 为准，旧 bare `patch_shots` 不能复活。
- 持久化/回放：`src/workbench/project/workbenchProjectSession.ts:10-84,191-245` 和 `projectPersistenceService.ts:149-202` 已有 project payload、event-tail replay、debounced persistence；新 Agent 不得复制正文/画布/时间线事实源。
- Receipt：`electron/shared/projectAgentProposalReceipt.ts:36-64` 与 `electron/projectAgentHost/projectAgentExecutionCoordinator.ts:371-465,550-601` 已有 proposal/approval/action hash/binding 结构，但必须由真实任务证明读回和不重放。
- 视频拆解：`tests/ux/video-deconstruct.e2e.mjs:42-125` 已有 gated Electron 旅程，覆盖导入、拆镜、关键帧、画面/景别、对白的部分字段；TikHub、ASR、字幕/OCR、导出和重启仍需按 evidence state 单独证明。

## 复用与禁止清单

复用：Resident 单一 UI owner、document write target、React Flow adapter、canonical tool catalog、proposal/receipt lifecycle、project event-tail recovery、computed UI contract。
禁止：#454 anchor/parameter rail、第二套 Agent composer、第二套 Skill store、第二套 canvas renderer、fixture/store 注入或按钮点击作为 effect 成功证明。
