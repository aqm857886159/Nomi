t2-verify：通过

- 验收线：t2-verify
- 验收 HEAD：`c966b045036a512d0efa52d898ac7a0d26ca1570`（分支 `feat/agent-slash-skill-popover`，在原验基线 `c10f8729403c37531654296ff12a59d122a8bb3e` 之上仅作纯领域文件重命名 `useAgentSlashMenu.{ts,test.tsx}` → `agentSlashMenu.{ts,test.tsx}` 与两处 import 同步）
- 对照依据：`docs/design/boards/2026-10-24/LibraryPointers.board.json`（拍板图 15 格）与 `docs/plan/2026-10-23-skill-prompt-library-layout.md`

## 一、拍板图清单与结构核对

- `docs/design/boards/2026-10-24/LibraryPointers.board.json` 已推进至 `stage: "built"`：
  - 共 15 格，其中 14 格为 `status: "implemented"`，全部绑定 `owner: "I-libraries"` 与 `assertion: "board:LibraryPointers/<id>"`（在 `tests/ux/library-pointers.walk.mjs` 中逐项落有真实断言）；
  - 第 12 格 `pointers.message-badge` 按板清单原注「不在本板画面；只认技能的问题另修。」诚实保持 `status: "in-progress"`、`owner: "I-libraries"`。

## 二、自动化单测与门岗复验（独立全跑）

| 检查项 | 命令 | 结果 |
|---|---|---|
| 核心单测（5 文件） | `pnpm exec vitest run src/workbench/library/libraryGroups.test.ts src/workbench/library/LibraryPicker.test.ts src/workbench/ai/resident/agentSlashMenu.test.tsx src/workbench/ai/v4/agentPanelV4Blocks.test.ts src/workbench/ai/v4/agentPanelV4Logic.test.ts` | **5 passed / 100 passed**（`c966b0450` 复跑 `agentSlashMenu.test.tsx` 6/6） |
| 自写登记门岗 | `pnpm run check:self-written` | **通过**（20/20 单测 + 177 领域目录 · 64 登记 · 新增 2 文件 0 未认领） |
| 拍板图对账 | `pnpm run check:board-parity` | **103/103 通过**（12 张板 + 43 张其它日期板） |
| 控件契约 | `pnpm run check:controls` | **通过**（0 新增违规，0 例外） |
| 设计 token | `pnpm run check:tokens` | **通过**（0/0/0/0，0 色相漂移，0 非 `:root` 语义 token） |
| 增量 ESLint | `node scripts/lint-changed.mjs` | **通过**（17 个改动文件，0 error，警告不增） |
| 测试抄文案门岗 | `node scripts/check-test-copy-literals.mjs` | **通过**（棘轮只减不增） |

## 三、删线 / 反向变异实证（3 项全红 → 恢复全绿）

1. **变异 1（Q1 效果不进技能段）**：删除 `src/workbench/ai/resident/agentSlashMenu.ts:46` 的 `if (skill.curation?.kind === 'effect') return false` → 测试爆红（1 failed / 5 passed，`skill:effect-should-not-be-in-skills` 漏进技能段）。
2. **变异 2（`/` 选中后清掉斜杠草稿）**：删除 `src/workbench/ai/resident/agentSlashMenu.ts:197` 的 `input.clearSlashDraft()` → 测试爆红（1 failed / 5 passed，`expected '/分镜' to be ''`）。
3. **变异 3（提示词芯片与技能芯片双图标区分）**：将 `src/workbench/ai/v4/AgentPanelV4Composer.tsx:73` 提示词芯片的 `IconBulb`（`data-v4-chip-icon="prompt"`）改为 `IconBooks`（`data-v4-chip-icon="skill"`）→ 测试爆红（1 failed / 5 passed，`expected false to be true`）。
4. 恢复全部改动后复跑 **6/6 全绿**，`git status` 干净。

## 四、8 张真窗口截图逐张亲眼核对（`docs/evidence/2026-11-22-agent-slash-skill-popover/`）

- `slash-zh-light.png`：行首 `/` 弹出弹层，搜索占位「搜索技能和提示词」，3 分类「全部 / 技能 / 提示词」，分组头「技能 · 创作流程 · 10 项」「提示词 · 表情预设 · 25 项」折叠清晰，底栏「去 Skill 库」。
- `slash-filter-keyboard-zh-light.png`：`/分镜` 实时过滤并摊开匹配分组，键盘高亮落在「创作助手」，行内无内部 `/id`，56×35 缩略图清晰。
- `slash-zh-dark.png`：暗色模式 Q8 核实通过——「文稿编辑」「创作助手」「分镜规划」线稿插画已反相为暗纸底 + 浅线，真实照片封面「电影分镜」未反相保持原色。
- `slash-en-light.png` 与 `slash-en-dark.png`：英文光暗双轨核实通过——显示 `Search skills and prompts`、`All` / `Skills` / `Prompts`、`Prompts · Expressions · 25 items`、`Skill library`（2 词），弹层内零中文串味。
- `chip-skill-zh-light.png` 与 `chip-prompt-zh-light.png`：输入框双图标芯片核实通过——技能芯片「创作助手」带 `IconBooks`、提示词芯片「人物三视图」带 `IconBulb`，均带本地化标题与 `×` 移除钮，底栏 `Skill` 钮呈激活态。
- `node-picker-zh-light.png`：节点「提示词预设」弹层核实通过——4 分类「全部 / 我的 / 内置 / 公开库」、分组行缩略图与左侧大图悬停预览（「参考表情」）渲染完整无裁切。

## 五、结论

重命名后 `check:self-written`、单测、全部门岗、14 格拍板图落地项、3 项变异实证与 8 张中英光暗真窗口截图均已核验通过，无未解除阻断，同意放行。
