有条件通过：第 2 轮 4 项审查问题（`keyCode 229` 选字回车拦截、按出价身份消费单次回车及 500ms 换卡审阅保护、带芯片裸斜杠 Esc 后拦截、真实 Pi `before_tool` 宿主 `heldToolCallIds` 投影）与 ★9 验收项及回退必红反例全部独立实测通过；禁区零改动、零真付费调用；中英真窗截图按派活单留交协调审查补截确认。

- 验收线：v-fg3-2-r3
- 验收 HEAD：b11c696601e7c785fcbebbca77328ef4580123d5
- 阻断：无
- 上一轮盲验 HEAD：1e1a6b7a34fe24899c17cd32ca8e2e87d1308049（v-fg3-2-r2）；首轮盲验 HEAD：042cfec75cf607fa32ca32e83708d2b58920e1f3（v-fg3-2）
- 第 2 轮测试提交：7505ee8ce
- 第 2 轮实现提交：cd456aad4
- 首轮基线与仅测试提交：a05ca5219 / fd6a60bac
- 验证方式：盲验独立源码审计（`git diff origin/main..b11c696601e7c785fcbebbca77328ef4580123d5`、`7505ee8ce`、`cd456aad4`）+ 门禁脚本 + 轻量定向 Vitest 与 `agent-runtime` 宿主 `node --test` + 第 2 轮回退必红反例（未读取任何实现线自报材料，未触发真付费调用）

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

## 6. 视觉基线同步复验（`1e1a6b7a3` · `v-fg3-2-r2`）

- **HEAD 与增量核查**：确认当前 `HEAD` 为 `1e1a6b7a34fe24899c17cd32ca8e2e87d1308049`。核对 `git diff --stat 042cfec75cf607fa32ca32e83708d2b58920e1f3..1e1a6b7a34fe24899c17cd32ca8e2e87d1308049`（共 2 个提交：`62f8232a8`、`1e1a6b7a3`），仅改动 5 个文件——本验收报告 `acceptance.md` 与 `tests/ux/design-lab/__baselines__/creation-columns/` 下 4 张 PNG，**生产代码与测试代码零改动**。
- **4 张新视觉基线与 4 张 `-diff.png` 亲眼核验**（逐张读取 `tests/ux/design-lab/__baselines__/creation-columns/{columns-current,columns-specimen,columns-specimen-dark,columns-storyboard-tree}.png` 及 `docs/evidence/2026-11-27-fg3-2-agent-spend-bar/design-lab-diff/` 对应 `-diff.png`）：
  - `columns-current.png`、`columns-specimen.png`、`columns-specimen-dark.png`：像素差异**仅限于**右下角停靠 Agent 输入框占位词末尾移去 `@ 引用素材或技能`（从 `继续告诉 Nomi 要改什么... @ 引用素材或技能` 收紧为 `继续告诉 Nomi 要改什么...`，符合 `LibraryPointers` 拍板），明暗两套界面均无破版、裁切或遮挡。
  - `columns-storyboard-tree.png`：右下角 Agent 输入框占位词同样仅移去 `@ 引用素材或技能`；另见右上角 `Nomi` 标题右侧原空态上下文胶囊 `— ⌄`（`V4ContextRing`）在旧基线 `6484cf76f` 时尚存在、现已隐藏——核查归因系主线已合入提交 `4e8ed701b`（空用量时隐藏 `V4ContextRing`）所致，与本分支无关且与其余 3 张 `creation-columns` 顶栏一致，无任何破版或遮挡。
- **定向回归复跑**：在 `1e1a6b7a34fe24899c17cd32ca8e2e87d1308049` 上复跑 `VITEST_MAX_WORKERS=2 pnpm exec vitest run src/workbench/ai/v4/agentPanelV4SpendEnter.test.tsx`，**21 / 21 全部通过**（1 test file passed, 58ms）。

## 7. 第 2 轮修复独立盲验（`b11c696601e7c785fcbebbca77328ef4580123d5` · `v-fg3-2-r3`）

### 7.1 全分支范围与禁区复核（`origin/main..b11c696601e7c785fcbebbca77328ef4580123d5`）

核对 `git diff --stat origin/main..b11c696601e7c785fcbebbca77328ef4580123d5`（共 35 个文件，+972/-62 行）：

| 禁区项 | 核查结果 | 依据 |
|---|---|---|
| `SpendConfirmDialog.tsx` | 未触碰（通过） | `git diff --name-only origin/main..b11c696601e7c785fcbebbca77328ef4580123d5` 零命中 |
| `src/workbench/generationCanvas/` | 未触碰（通过） | 变更文件清单零命中 |
| `docs/design/boards/` | 未触碰（通过） | 变更文件清单零命中 |
| 真实付费调用 / 密钥逻辑 | 未触碰（通过） | 仅涉及审批闸 `holds` 投影、面板回车消费与审阅保护、输入框分流及对应测试/治理文件 |

### 7.2 第 1 轮审查 4 项问题独立核查表

| 编号 | 审查问题 | 核查结果 | 源码与行为依据 |
|---|---|---|---|
| [P1-1] | 输入法选字回车（`key === 'Enter'`、`isComposing === false`、`keyCode === 229`）是否在发送/确认分流前统一拦下 | **通过** | `src/workbench/ai/v4/AgentPanelV4Composer.tsx:260` 在 `onKeyDownCapture` 第一行即拦截 `event.nativeEvent.isComposing \|\| event.nativeEvent.keyCode === 229`，早于 `onPopoverKeyDown`、`onSubmit` 与 `onEmptyEnter` 分流；空框（`""`）与带草稿（`"pin"`）均既不发送也不确认花钱（`agentPanelV4SpendEnter.test.tsx:101-106`）。 |
| [P1-2] | 第二下独立非 `repeat` 回车：按出价/审批身份消费一次、失败重试态不触发、换卡露出下一笔时有审阅保护窗口 | **通过** | `agentPanelSpendCard.ts:347` 仅在待决出价态挂 `spendConfirmationId: pending.quoteId`（`progress` 与 `attention`/重试态均不带该身份）；`useAgentPanelV4Data.ts:314-316` 对普通付费审批挂 `JSON.stringify([workspaceId, lane, primaryPending.toolCallId])`；`AgentPanelV4Panel.tsx:52,401-416` 用 `confirmedByEnter`（每笔身份仅消费一次）与 `useLayoutEffect` 在新 `confirmationId` 实际渲染起设 `SPEND_CARD_REVIEW_MS = 500` ms 审阅保护窗；覆盖同笔、重试、立刻换卡、延迟 2000ms 换卡（40ms 拦下、1000ms 后新卡放行而同笔/重试仍拦截，`agentPanelV4SpendEnter.test.tsx:108-125`）；且按钮直点不受限。 |
| [P2-1] | 挂有技能/素材芯片时输入裸 `/`，按 Esc 关掉斜杠菜单后按回车是否仍拦下不发送、不确认 | **通过** | `AgentPanelV4Composer.tsx:208-209` 将 `canSend` 收紧为 `!admitting && text !== '/' && Boolean(chips?.length \|\| text)`，优先否决裸 `/` 而不被芯片长度覆盖；按 Esc 关闭 `V4SkillPopover` 后按回车，`canSend` 为 `false` 且 `!chips?.length && draft.getSnapshot() === ''` 为 `false`，消息发送与付费确认均不触发（`agentPanelV4SpendEnter.test.tsx:127-142`）；表单 `onSubmit` 与发送按钮 `disabled` 共用同一 `canSend`。 |
| [P2-2] | 真实 Pi 宿主 `before_tool` 等待审批期间（`part.running === false`），宿主是否投影实际挂起的 `heldToolCallIds`，静态显示「待确认」不转圈不折叠，且不影响无关并行工具 | **通过** | `electron/agentLane/laneApprovalGate.ts:89,321,384,396,406,430` 在 `hold` 注册、释放、取消时通过 `onChange` 通知宿主并暴露 `heldToolCallIds()`；`laneHost.mts:367-373` 将非空 `heldToolCallIds` 投影进 `LaneProjection`（清空即省略）；`laneWorkspace.mts:103` 在关闭态清空 `heldToolCallIds: undefined`；`trimLaneProjectionForIpc` 原样透传该字段；`laneViewModel.ts:421-423` 移除旧的 `part.running && operationId` 推断，改为精确按 `projection.heldToolCallIds?.includes(part.toolCallId)`（或普通付费审批 `projection.pending.toolCallId`）标为 `approval-requested`；`AgentPanelV4Icons.tsx:83` 返回 `null` 无 `animate-spin`，`agentPanelV4Collapse.ts:9` 不折叠进过程行；`laneExtendedDesktopPorts.test.ts:345-393` 经真实 `openLane` + HTTP fixture 验证 `part.running === false` 且 `pending === undefined` 时 `held` 显示静态「待确认」且并行 `read_timeline` 不受影响，关卡后 `heldToolCallIds` 消失。 |

### 7.3 第 2 轮亲手实跑命令与通过数（HEAD `b11c696601e7c785fcbebbca77328ef4580123d5`）

| 命令 | 退出码 | 实测结果 |
|---|---|---|
| `VITEST_MAX_WORKERS=2 npx vitest run src/workbench/ai/v4/agentPanelV4SpendEnter.test.tsx src/workbench/ai/lane/laneViewModel.test.ts src/workbench/ai/v4/agentPanelV4Blocks.test.ts src/workbench/ai/v4/agentPanelV4Collapse.test.ts src/workbench/ai/resident/agentSlashMenu.test.tsx electron/agentLane/laneExtendedDesktopPorts.test.ts` | 0 | **6 文件，234 / 234 全部通过**（`agentPanelV4SpendEnter` 28/28、`laneViewModel` 46/46、`agentPanelV4Blocks` 76/76、`agentPanelV4Collapse` 25/25、`agentSlashMenu` 6/6、`laneExtendedDesktopPorts` 53/53） |
| `VITEST_MAX_WORKERS=2 npx vitest run src/workbench/ai/v4/agentPanelSpendCard.test.ts src/workbench/ai/v4/agentPanelV4Logic.test.ts` | 0 | **2 文件，50 / 50 全部通过**（`agentPanelSpendCard` 40/40、`agentPanelV4Logic` 10/10） |
| `npx tsc -p tests/agent-runtime/tsconfig.json && node --test --test-concurrency=1 --test-timeout=60000 .tmp/agent-runtime-tests/tests/agent-runtime/lane-approval-gate.test.mjs .tmp/agent-runtime-tests/tests/agent-runtime/lane-native-approval.test.mjs .tmp/agent-runtime-tests/tests/agent-runtime/stage3-probe-p1-approval-wait.test.mjs .tmp/agent-runtime-tests/tests/agent-runtime/lane-workspace-lifecycle.test.mjs .tmp/agent-runtime-tests/tests/agent-runtime/lane-close-resources.test.mjs` | 0 | **5 套件，37 / 37 全部通过**（含 `before_tool` 预检等待、abort/crash、workspace 关闭与资源回收） |
| `node ./scripts/check-concept-owners.mjs` | 0 | 通过（431 个概念，converged 427 / pending 4，第二写口 0 新增，未登记共享边界维持基线 31） |
| `node ./scripts/check-root-cause-contracts.mjs` | 0 | 通过（无高风险生产路径违规） |

### 7.4 第 2 轮回退必红反例实测（不移动 HEAD）

在不移动 `HEAD` 前提下，将 `cd456aad4` 涉及的 10 个生产源码文件临时 `git restore --source=7505ee8ce --worktree` 后运行 3 份核心测试，随后完整还原至 `HEAD`：

- **回退结果**：**3 / 3 文件失败（9 failed / 118 passed，共 127）**：
  - `src/workbench/ai/v4/agentPanelV4SpendEnter.test.tsx`：7 failed（`keyCode 229` 空框与 `"pin"` 2 项、同笔/重试/立刻换卡/延迟换卡 4 项、带技能芯片裸 `/` Esc 后回车 1 项）；
  - `src/workbench/ai/lane/laneViewModel.test.ts`：1 failed（`heldToolCallIds` 未被投影为 `approval-requested`）；
  - `electron/agentLane/laneExtendedDesktopPorts.test.ts`：1 failed（真实 Pi `before_tool` 预检挂起未被投影为静态「待确认」）。
- **还原核对**：`git restore --source=HEAD --worktree -- electron/ src/` 后 `git status --short` 零改动，`git rev-parse HEAD` 维持 `b11c696601e7c785fcbebbca77328ef4580123d5`。
