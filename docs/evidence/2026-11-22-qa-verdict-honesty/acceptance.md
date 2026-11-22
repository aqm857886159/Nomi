k-qa-verify：通过

- 验收线：k-qa-verify
- 实现分支：fix/qa-verdict-three-states
- 验收 HEAD：990c53ae64804d06455efb09c766714d5a38daa6
- 验收日期：2026-11-22

## 验收过程与闭环记录

1. **首轮复核拦截（HEAD `7d0726619c37bd8179e67c2cb4159ef8fa450ff8`）**：逐张核对真窗口截图与新增文案时，发现 `docs/evidence/2026-11-22-qa-verdict-honesty/after-details-en.png` 渲染出 `QA incomplete: 1 shots not verified (Could not parse verification result)`，对应 `src/i18n/locales/generationCommon.ts` 中 `production.qa.allPassed` 与 `allUnverified` 未使用仓库既有 `_one`/`_other` + `count` 复数规范；退回实现线修复。
2. **第二轮复验（HEAD `8b85d9540a1e64e6731d35460a9b997db6d98410`）**：实现线已将 `allPassed` / `allUnverified` 拆为 `_one`/`_other`（参数 `count`），补齐 `count=1` 与 `count=3` 英文单复数单测并刷新真窗口截图 `after-details-en.png`（确认显示 `1 shot not verified`）。
3. **最终复验关闭（HEAD `990c53ae64804d06455efb09c766714d5a38daa6`）**：实现线抽出 `buildQaStagePatch`（`productionQaVerdict.ts`）与 `mapShotVerifyReportToProductionVerdicts`（`shotVerify.ts`）使 `productionRunDriverOps.ts`（1124 ≤ 1130）与 `capabilityApplyHandler.ts`（749 ≤ 800）满足 `check:filesize`；独立复跑全部通过。

## 独立核验结果（全部 0 报错通过）

### 1. 核心测试套件（7 files / 69 passed）
- `src/workbench/generationCanvas/agent/shotVerifyRunner.test.ts`：10/10 passed
- `src/workbench/generationCanvas/agent/shotVerifyJudge.test.ts`：3/3 passed
- `src/workbench/capability/capabilityApplyHandler.qaVerdict.test.ts`：3/3 passed
- `electron/productionRun/productionQaVerify.test.ts`：8/8 passed
- `src/workbench/production/ProductionRunTaskCard.test.ts`：5/5 passed（含英文 `count=1` 单数 vs `count=3` 复数断言）
- `src/workbench/ai/resident/useShotVerifyFeedback.test.ts`：10/10 passed
- `electron/ai/textBrainResolver.test.ts`：30/30 passed

### 2. 独立删线 / 反向变异实测（均必红并已还原）
- **IM-1（假视觉放行）**：临时将 `src/workbench/generationCanvas/agent/shotVerifyJudge.ts` 中 `return resolved.imageInput !== 'unsupported'` 改回 `return true` → `shotVerifyJudge.test.ts` **FAIL**（1/3，`returns false when textBrain reports imageInput: unsupported` 报 `expected true to be false`）。
- **IM-2（静默假通过映射）**：临时将 `unverified` 映射改回 `status: 'passed', passed: true` → `capabilityApplyHandler.qaVerdict.test.ts` **FAIL**（1/3，断言 `status: 'unverified', passed: false` 失败）。

### 3. 门岗核验
- `pnpm run check:filesize`：通过（`productionRunDriverOps.ts` 1124 ≤ 1130、`capabilityApplyHandler.ts` 749 ≤ 800）。
- `pnpm run check:i18n`：全部 7 项子门岗通过（6641 键 `zh-CN ↔ en` 同步、1815 文件键引用全解析、0 测试抄文案新增）。
- `node scripts/check-vocabularies.mjs`：通过（244 个 owner 全部登记，含 `QaShotVerdictStatus`）。
- `node scripts/check-root-cause-contracts.mjs`：通过（5 个高风险生产文件均有合同和变化中的回归测试）。
- `node scripts/lint-changed.mjs`：通过（26 个改动文件，0 error，0 新增 warning）。

### 4. 真窗口改前 / 改后中英 8 张截图逐张亲眼核对
- `before-zh.png`、`before-en.png`、`before-details-zh.png`、`before-details-en.png`：修前静默吞错，画布右侧 Agent 面板 0 卡，任务中心审片行仅显示「已完成 / Complete」无未校验提示。
- `after-zh.png`、`after-en.png`：画布 Agent 面板明确展示未校验卡片（`镜头 1 · 未校验 / 审片结果无法解析` 与 `Shot 1 · Not verified / Could not parse verification result`），纯未校验正确隐藏「AI 修复 / AI Fix」按钮，仅保留「确认 / Got it」。
- `after-details-zh.png`、`after-details-en.png`：任务中心制作详情审片行明确展示本地化三态结论（`审片未完成：1 镜未校验（审片结果无法解析）` 与刷新后的 `QA incomplete: 1 shot not verified (Could not parse verification result)`），零截断、零混语、英文单复数准确。
