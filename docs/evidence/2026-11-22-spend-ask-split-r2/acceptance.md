h1548-verify：通过

- 验收线：h1548-verify
- 实现分支：feat/spend-ask-split
- 验收 HEAD：8b6e0ee32c59531fe85cdf0898255f2584f23371
- 验收日期：2026-11-23

## 独立核验结果（全部 0 报错通过）

### 1. 拍板图与组件映射核对（`SpendAskSplit.board.json`）
- 全部 12 个非 `dropped` 且非 `change=remove` 元素均已填写具体生产组件映射（`V4SpendBar`、`AgentPanelV4SpendCardBody`、`GenerationReceiptPointers`、`NodePointerGroup`、`NodePointer density="row"`、`WorkbenchButton size="md"`）；仅 `ask.title` / `ask.pointers`（`remove`）与 `chat.rows.horizontal`（`dropped` / `remove`）按规不填 `component`。
- `pnpm run check:board-parity`：103/103 单测通过 + 12 张板候选全部认领 + 其它日期目录 44 张板全部通过。

### 2. 核心单测套件（7 files / 206 passed）
- `src/workbench/ai/v4/AgentPanelV4SpendCardBody.test.tsx`：4/4 passed
- `src/workbench/ai/v4/agentPanelSpendCard.test.ts`：40/40 passed
- `src/workbench/ai/v4/agentPanelV4Blocks.test.ts`：75/75 passed
- `src/workbench/ai/v4/useAgentPanelSpendCard.test.ts`：38/38 passed
- `src/workbench/ai/pointer/NodePointer.test.tsx`：41/41 passed
- `src/workbench/ai/pointer/GenerationReceiptPointers.test.tsx`：4/4 passed
- `tests/ux/full-walk/spendButtonCount.test.mjs`：4/4 passed

### 3. 独立删线 / 反向变异实测（均必红并已还原干净）
- **IM-1（`V4SpendBar` 主按钮尺寸退回 `sm`）**：将 `src/workbench/ai/v4/AgentPanelV4SpendBar.tsx` 主按钮 `size="md"` 改回 `size="sm"` → `agentPanelV4Blocks.test.ts` **FAIL**（断言 `confirm` 含 `h-8` 失败，实际落为 `h-7`）。
- **IM-2（英文主按钮退回带名词 `videos`）**：将 `src/i18n/locales/agentPanelV4.ts` 的 `spendCard.generateAll` 改回 `'Generate {{count}} videos'` → `spendButtonCount.test.mjs` **FAIL**（`Expected "Generate 1" / Received "Generate 1 videos"`）。

### 4. 门岗核验
- `pnpm run check:board-parity`：✅ 103/103 + 全仓 56 板通过
- `pnpm run check:self-written`：✅ 20/20 + 178 领域目录 / 64 项登记 / 新增代码文件 4 个（0 未认领）
- `node scripts/check-test-copy-literals.mjs`：✅ 棘轮只减不增通过
- `node scripts/lint-changed.mjs`：✅ 51 个改动文件，0 error，0 新增 warning

### 5. 12 张改前 / 改后截图逐张亲眼核对（`docs/evidence/2026-11-22-spend-ask-split-r2/`）
- **停点付费工具审批卡（8 张）**：`{before,after}-tool-spend-{zh-light,en-dark}{,-card}.png` 清晰呈现 `V4SpendBar` 的 `sm → md` 按钮升级（中文浅色 `取消 / 确认 ⏎`、英文深色 `Cancel / Confirm ⏎`），无截断、无重叠、无混语。
- **批量起草确认条（4 张）**：`{before,after}-spend-batch-{zh-light,en-dark}.png` 清晰呈现 D2（`md` 按钮 + 主按钮加粗 + 无页脚横线 + 0 托管告知）、D3（行内 `镜 01` / `Shot 01` 胶囊高度收紧且保持 `rounded-nomi-sm`）、D4（英文主按钮 `Generate 3 videos ⏎` → `Generate 3 ⏎`），明暗与中英对比均符合获批板与协调四条拍板。
