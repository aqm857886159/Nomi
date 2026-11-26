有条件通过：空框回车唯一确认付费条、输入有字与组字防误花钱、工具行静态「待确认」不转圈、裸斜杠不误发及回退必红反例全部实测通过；中英真窗截图按派活单由协调审查补截确认。

- 验收线：v-fg3-2
- 验收 HEAD：042cfec75cf607fa32ca32e83708d2b58920e1f3
- 阻断：无
- 基线提交：a05ca5219
- 仅测试提交：fd6a60bac
- 验证方式：盲验独立源码审计 + 门禁脚本 + 定向单测 + 破坏必红反例（未读取任何实现线自报/交付材料，未触发真付费调用）

## 1. 范围与禁区核查

核对 `git diff a05ca5219..042cfec75cf607fa32ca32e83708d2b58920e1f3`（共 18 个文件，+548/-17 行）：

| 禁区项 | 核查结果 | 依据 |
|---|---|---|
| `SpendConfirmDialog.tsx` | 未触碰（通过） | 变更清单零命中 |
| `src/workbench/generationCanvas/` | 未触碰（通过） | 变更清单零命中 |
| 任何拍板图文件（`docs/design/boards/`） | 未触碰（通过） | 变更清单零命中 |
| 除两个占位词条键以外的 i18n 文案 | 未触碰（通过） | 仅修改 `src/i18n/locales/agentPanelV4.ts` 第 33 行（`zhAgentPanelV4.placeholder`）与第 606 行（`enAgentPanelV4.placeholder`） |
| 付费调用 / 密钥逻辑 | 未触碰（通过） | 变更清单仅涉及面板渲染、回车分流、工具行投影与根因/概念登记文件 |

备注：`src/devlab/designLab/primitivesSurfaces/states/04-dialogs.tsx:295` 仅同步 `mirrors` 行号指向 `src/workbench/ai/ProjectAgentResidentShell.tsx:622`（对应 `DesignModal` 实际行号），属合理维护。

## 2. 三项功能要求与设计规范对账

### 2.1 回车确认付费条与防误花钱

- **设计依据**：`docs/design/nomi-design-system.md` §1.8.1（「取消在左、主按钮在最右，回车按的是它」）、`AgentPanelV4AskCard.tsx:257-262`（`event.nativeEvent.isComposing` 守卫）。
- **门数核查**（`node scripts/door-map.mjs`）：
  - `V4SpendBar`：读入口 1 扇（`src/workbench/ai/v4/AgentPanelV4Cards.tsx:279`）；
  - `V4Intervention`：生产入口 1 扇（`src/workbench/ai/v4/AgentPanelV4Panel.tsx:474`，其余 4 扇为 `src/devlab/designLab/` 样张）；
  - `AgentPanelV4Panel`：生产入口 1 扇（`src/workbench/ai/ProjectAgentResidentShell.tsx:528`，侧栏、停靠与浮窗由 `src/ui/app-shell/shell/ShellAgentHost.tsx` 共用同一 `ProjectAgentResidentShell`）；
  - `AgentPanelV4Composer`：生产入口 1 扇（`src/workbench/ai/v4/AgentPanelV4Panel.tsx:485`，其余 2 扇为设计实验室）。
  - 回车分流逻辑唯一收口在 `src/workbench/ai/v4/AgentPanelV4Composer.tsx:259-272`，并通过 `AgentPanelV4Panel.tsx:398,474,488` → `AgentPanelV4Cards.tsx:279` → `AgentPanelV4SpendBar.tsx:106` 将空框普通回车委托给已挂载且处于等待态的真实主按钮 `WorkbenchButton`（`src/design/actions.tsx:293,324` 透传 `forwardRef` 到原生 `<button>`）。
- **边界核实**：
  - 等确认、空输入框（`draft.getSnapshot() === ''`）、无芯片（`!chips?.length`）、无打开弹层（`!openPopover`）、非输入法组字（`!event.nativeEvent.isComposing`）、无修饰键（`!shiftKey && !altKey && !metaKey && !ctrlKey`）、非长按重复（`!event.repeat`）、非发送准入中（`!admitting`）、按钮未禁用且非发送进度/拒绝输入态时，触发 `onConfirm` 恰好一次。
  - 输入框有文字、有芯片、含空白字符（`' '` / `'\n'`）、组字中、按钮 `actionsDisabled`、发送中 `progress`、`slotWaiting: false` 或非 `spend` 介入卡时，**绝不触发 `onConfirm`**。

### 2.2 等确认不转圈与并行工具隔离

- **设计依据**：`docs/design/boards/2026-11-15-spend-ask-split/SpendAskSplit.board.json` 及 `preview/SpendAskSplit.html`（等确认态无转圈，仅「正在发出」态带 `.spin`）；复用现有 `agentPanelV4.toolStatus.approvalRequested`（中：`待确认` / 英：`Waiting`），未新增任何 i18n 词条。
- **实现核实**：
  - `src/workbench/ai/v4/useAgentPanelV4Data.ts:136-138` 复用单一 `useAgentPanelSpendCard(snapshot.spend)`，仅在 `spend.slot?.kind === 'spend' && !spend.slot.progress` 时导出 `waitingSpendOperationId`（同时 `ProjectAgentResidentShell.tsx:151` 直接读 `data.spend`，消除重复订阅）。
  - `src/workbench/ai/lane/laneViewModel.ts:421-425` 精确按 `part.running && part.toolName === 'generate' && part.args.operationId === waitingSpendOperationId`（或 `projection.pending?.effectClass === 'spend' && projection.pending.toolCallId === part.toolCallId`）标记为 `approval-requested`；`electron/shared/agentCapabilities/generationPlanSchemas.ts:201` 确认 `generate` 对应 `present` 必填 `operationId`；其他并行运行工具（不同 `operationId` 或非 `generate`）保持 `input-available`，互不干扰。
  - `src/workbench/ai/v4/AgentPanelV4Icons.tsx:83`：`ToolStatusIcon` 对 `approval-requested` 返回 `null`，消除 `animate-spin` 转圈图标。
  - `src/workbench/ai/v4/agentPanelV4Collapse.ts:9`：`isWorkItem` 不再将 `approval-requested` 收据折进 `process` 过程行，使其直接可见并显示静态「待确认」。

### 2.3 占位文字与裸「/」不误发

- **拍板板原文核对**：`docs/design/boards/2026-10-24/source/Pointers.dc.html:51,58`、`preview/LibraryPointers.html:64,71` 与 `LibraryPointers.candidates.json:316,383` 均为 `继续告诉 Nomi 要改什么…`。
- **中英改动核实**：`src/i18n/locales/agentPanelV4.ts`：
  - 中文（第 33 行）：`'继续告诉 Nomi 要改什么… @ 引用素材或技能'` → `'继续告诉 Nomi 要改什么…'`
  - 英文（第 606 行）：`'Tell Nomi what to change… @ to reference assets or skills'` → `'Tell Nomi what to change…'`
- **裸「/」不误发**：`src/workbench/ai/v4/AgentPanelV4Composer.tsx:208-209` 将 `canSend` 收敛为 `!admitting && Boolean(chips?.length || (text && text !== '/'))`，无论技能弹层处于打开未选中、已按 Esc 关闭或已选中项，只输入裸 `/` 按回车均不会将字面量 `/` 当消息发出，也不会误触发 `onConfirm`。

## 3. 门禁脚本与定向单测实跑结果

### 3.1 门禁脚本与类型检查

| 命令 | 退出码 | 实测结果 |
|---|---|---|
| `node ./scripts/check-concept-owners.mjs` | 0 | 通过：431 个概念（converged 427 / pending 4），第二写口 0 新增，未登记共享边界维持基线 31 |
| `node ./scripts/check-root-cause-contracts.mjs` | 0 | 通过：无高风险生产路径违规 |
| `pnpm run typecheck` | 0 | 通过：tsc app / electron / electron-pi / fixtures / check:test-types 共 5 项全绿（墙钟 43.4s） |

### 3.2 定向单测实跑（`VITEST_MAX_WORKERS=2`，HEAD `042cfec75cf607fa32ca32e83708d2b58920e1f3`）

| 测试文件 | 通过数 / 总数 | 状态 |
|---|---|---|
| `src/workbench/ai/v4/agentPanelV4SpendEnter.test.tsx` | 21 / 21 | 通过 |
| `src/workbench/ai/lane/laneViewModel.test.ts` | 46 / 46 | 通过 |
| `src/workbench/ai/v4/agentPanelV4Blocks.test.ts` | 76 / 76 | 通过 |
| `src/workbench/ai/resident/agentSlashMenu.test.tsx` | 6 / 6 | 通过 |
| `src/workbench/ai/v4/agentPanelV4Logic.test.ts` | 10 / 10 | 通过 |
| `src/workbench/ai/v4/agentPanelV4Collapse.test.ts` | 25 / 25 | 通过 |
| **合计（6 文件）** | **184 / 184** | **全部通过** |

## 4. 破坏必红反例实测（不移动 HEAD）

先验证 `git diff --stat fd6a60bac..HEAD -- '*.test.*'` 为空（提交 1 测试与 `HEAD` 测试一致），随后在不移动 `HEAD` 前提下依次实测并完整还原：

| 反例场景 | 操作方式 | 实跑结果（必须变红） |
|---|---|---|
| （A）仅测试提交 `fd6a60bac` 快照 | 检出 `fd6a60bac` 下 `src/` 并运行 3 份新增/改动测试 | **3/3 文件失败（7 failed / 136 passed，共 143）**：空框回车 `onConfirm` 0 次、IME 组字误透传弹层 2 项、裸 `/`（已关/未选）误调 `onSubmit('primary')` 2 项、工具行未标 `approval-requested` 1 项、工具行含 `animate-spin` 1 项 |
| （B1）仅回退回车确认接线 | `git restore --source=a05ca5219 --worktree` 仅还原 `AgentPanelV4Panel.tsx`、`AgentPanelV4Cards.tsx`、`AgentPanelV4SpendBar.tsx` | `agentPanelV4SpendEnter.test.tsx` **1 failed / 20 passed**：`confirms an empty draft once, including when the key is held` 失败（`onConfirm` 0 次） |
| （B2）仅回退输入分流与裸 `/` 守卫 | 仅还原 `AgentPanelV4Composer.tsx` 至 `a05ca5219` | `agentPanelV4SpendEnter.test.tsx` **5 failed / 16 passed**：空框回车确认、IME 组字（空框与 `"pin"`）、裸 `/`（`dismissed` 与 `no selection`）全部变红 |
| （B3）仅回退待确认状态投影 | 仅还原 `laneViewModel.ts` 至 `a05ca5219` | `laneViewModel.test.ts` **1 failed / 45 passed**：`marks only the generate call with the waiting spend offer as approval-requested` 失败（收到 `input-available` 而非 `approval-requested`） |
| （B4）仅回退静态无转圈图标 | 仅还原 `AgentPanelV4Icons.tsx` 至 `a05ca5219` | `agentPanelV4Blocks.test.ts` **1 failed / 75 passed**：第 165 行 `animate-spin` 断言失败（出现转圈） |
| （B5）仅回退等待态不折叠进过程行 | 仅还原 `agentPanelV4Collapse.ts` 至 `a05ca5219` | `agentPanelV4Blocks.test.ts` **1 failed / 75 passed**：第 166 行 `data-v4-block="process"` 断言失败（被折叠隐藏） |

还原核对：`git restore --source=HEAD --worktree -- src/` 后，`git status --short` 确认已跟踪文件零改动，`git rev-parse HEAD` 维持 `042cfec75cf607fa32ca32e83708d2b58920e1f3`。

## 5. 未在本次盲验执行项

- 中英文真窗截图（含付费确认条、静态「待确认」工具行、输入框新占位文字）：按派活单留交协调审查时补截确认。
