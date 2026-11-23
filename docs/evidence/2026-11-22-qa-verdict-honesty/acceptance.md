k-qa-verify：通过

- 验收线：k-qa-verify
- 实现分支：fix/qa-verdict-three-states
- 验收 HEAD：54bbe10e708dcf75c1130c260102f551cdd405d7
- 验收日期：2026-11-24

## 验收过程与闭环记录

1. **首轮复核拦截（HEAD `7d0726619c37bd8179e67c2cb4159ef8fa450ff8`）**：逐张核对真窗口截图与新增文案时，发现 `docs/evidence/2026-11-22-qa-verdict-honesty/after-details-en.png` 渲染出 `QA incomplete: 1 shots not verified (Could not parse verification result)`，对应 `src/i18n/locales/generationCommon.ts` 中 `production.qa.allPassed` 与 `allUnverified` 未使用仓库既有 `_one`/`_other` + `count` 复数规范；退回实现线修复。
2. **第二轮复验（HEAD `8b85d9540a1e64e6731d35460a9b997db6d98410`）**：实现线已将 `allPassed` / `allUnverified` 拆为 `_one`/`_other`（参数 `count`），补齐 `count=1` 与 `count=3` 英文单复数单测并刷新真窗口截图 `after-details-en.png`（确认显示 `1 shot not verified`）。
3. **第三轮复验（HEAD `990c53ae64804d06455efb09c766714d5a38daa6`）**：实现线抽出 `buildQaStagePatch`（`productionQaVerdict.ts`）与 `mapShotVerifyReportToProductionVerdicts`（`shotVerify.ts`）使 `productionRunDriverOps.ts`（1124 ≤ 1130）与 `capabilityApplyHandler.ts`（749 ≤ 800）满足 `check:filesize`。
4. **第四轮复验（HEAD `1f674abc56af58d750a6788e486328ed732137f4`）**：补齐概念登记 `docs/engineering/concept-owners/production.qa-verdict.json` 通过 `check-concept-owners.mjs`。
5. **第五轮复验（HEAD `61f6a57ef990e59a84206cd5a2839193fd124e25`）**：将跨进程共享三态类型迁入中立契约层 `electron/shared/productionQaVerdict.ts` 并同步更新概念登记、词表基线与 3 处渲染层 import，独立复跑 `check-boundaries.mjs`（68/68，0 新增越界）与 `check-concept-owners.mjs`（400 概念、0 错）均通过。
6. **第六轮界面精修复验关闭（HEAD `b5a0775092433531e3515e8cad85599c4374e770`）**：
   - 核对两处界面精修：`ProductionDetails.tsx` + `productionRunView.ts` 将全未校验/跳过的 `qa` 阶段右侧状态改为 `未校验 / Not verified`（部分校验为 `部分校验 / Partial`），且不计入 `completedStages`（顶部摘要与阶段进度一致显示 `6 / 9 个阶段已完成` / `6 / 9 stages done`，粗剪保持 `已完成 / Complete` 不阻塞）；`ReconcileDeviationCard.tsx` 在纯未校验态（`!showAiFix && !showUndo`）精炼标题为 `画面未校验 · 不代表已通过` / `Visual check not run · not confirmed as passing`，紧凑 `确认 / Got it` 按钮收进顶栏同行右侧，省掉空底栏与嵌套灰框，列表项按 V4 内容流单行呈现。
   - 独立复跑 3 套目标 Vitest（`productionRunView.test.ts` 20/20、`ProductionRunTaskCard.test.ts` 5/5、`useShotVerifyFeedback.test.ts` 10/10，共 **35/35 passed**）、`pnpm run check:i18n`（6643 键 `zh-CN ↔ en` 同步、22/22 子单测全绿）、`tsc -p tsconfig.app.json --noEmit`（0 错）、`NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs`（28 文件 0 错）与 `NOMI_BASE_REF=origin/main node scripts/check-self-written.mjs`（0 未认领），全部通过，0 本机路径泄露。
7. **第七轮创作者动作接线、原因折叠与极限排版复验关闭（拦截 `75fe845e9` → 复验通过 HEAD `54bbe10e708dcf75c1130c260102f551cdd405d7`）**：
   - **首轮拦截 `B1`**：独立实跑 `node scripts/check-test-types.mjs` 在 `75fe845e9` 抓到 `src/workbench/production/productionRunView.test.ts:443` 的 `unverifiedReasons: ['invalid_verdict_json']` 缺 `as const` 触发第 `447` 行 `TS2322`（基线 `0 → 1`）；实现线提交 `4aba29959` 补 `as const` 并无冲突合入最新 `origin/main`（`6c09b7510`）至 `54bbe10e708dcf75c1130c260102f551cdd405d7` 后独立复跑 `check-test-types.mjs`（`src/ 0 错`）、`productionRunView.test.ts`（20/20）、`lint-changed.mjs`（0 错）与 `check:filesize`（0 红牌）全绿。
   - **7 张新版中英真窗口截图逐张 `read_file` 目视通过**：`after-zh.png`（`1 镜没审成，不代表已通过  查看原因` + `镜头 1  重新审片 / 照用此镜`，默认不泄开发原因）、`after-expanded-zh.png`（展开 `收起原因` 显示白话 `审片模型的回答读不出来`）、`after-en.png`（`1 shot not checked, not confirmed as passing  Why` + `Re-check / Use shot`）、`extreme-12shots-5unverified-zh.png` / `extreme-12shots-5unverified-en.png`（12 镜 5 未审极限长标题单行省略号不截断，`重审 / 照用` 与底栏 `全部重审 / 照用这 5 镜` / `Re-check all / Use all 5` 对齐清晰）、`after-details-zh.png` / `after-details-en.png`（任务中心 `6 / 9 个阶段已完成`、`审片  部分校验`、`12 镜里 5 镜没审成，不代表已通过  查看原因` / `5 of 12 shots weren’t checked, not confirmed as passing  Why`）。
   - **6 套核心 Vitest 全绿（150/150）**：`shotVerify.test.ts`（24/24）、`shotVerifyStore.test.ts`（16/16）、`useShotVerifyFeedback.test.ts`（11/11）、`agentPanelV4Blocks.test.ts`（74/74）、`productionRunView.test.ts`（20/20）、`ProductionRunTaskCard.test.ts`（5/5）。
   - **新增 2 项独立反例变异实测（2/2 必红，还原后 27/27 复绿）**：
     - **IM-3（破坏单镜照用隔离）**：`shotVerifyStore.ts:178-180` 将 `acceptUnverifiedShots` 改为无条件清空全部 `unverified` → `shotVerifyStore.test.ts` **FAIL**（1/16，`acceptUnverifiedShots 支持单镜照用与全部照用` 报 `expected [] to deeply equal [{ shotNodeId: 'shot-2', ... }]`）。
     - **IM-4（破坏默认折叠原因）**：`ReconcileDeviationCard.tsx:184` 将 `reasonsOpen` 初始值改为 `true` → `useShotVerifyFeedback.test.ts` **FAIL**（2/11，默认收起态泄露原因文案）。
     - `git checkout -- .` 还原后复跑 `shotVerifyStore.test.ts` + `useShotVerifyFeedback.test.ts` **27/27 通过**。
   - **全套 10 项串行门岗全绿（`EXIT=0`）**：`tsc`（app + electron）、`check-test-types.mjs`、`check:controls`、`check-design-lab.mjs --mirrors-only`、`check:i18n`（6654 keys，22/22）、`check:filesize`、`check:root-cause-contracts`（55/55）、`check-self-written.mjs`（0 未认领）、`lint-changed.mjs`（0 错）。

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
- `node scripts/check-boundaries.mjs`：通过（3237 模块，68 处存量冻结，0 新增越界/硬环）。
- `node scripts/check-concept-owners.mjs`：通过（400 个概念、写接口 1049 个、0 错误，含 `production.qa-verdict.json`）。
- `node scripts/check-vocabularies.mjs`：通过（244 个 owner 全部登记，含 `QaShotVerdictStatus`）。
- `node scripts/check-root-cause-contracts.mjs`：通过（5 个高风险生产文件均有合同和变化中的回归测试）。
- `node scripts/lint-changed.mjs`：通过（26 个改动文件，0 error，0 新增 warning）。

### 4. 真窗口改前 / 改后中英 8 张截图逐张亲眼核对
- `before-zh.png`、`before-en.png`、`before-details-zh.png`、`before-details-en.png`：修前静默吞错，画布右侧 Agent 面板 0 卡，任务中心审片行仅显示「已完成 / Complete」无未校验提示。
- `after-zh.png`、`after-en.png`（第 6 轮重拍亲眼核对）：画布 Agent 面板紧凑两行展示未校验卡片——顶栏同行左侧为 `画面未校验 · 不代表已通过` / `Visual check not run · not confirmed as passing`、右侧为紧凑 `确认` / `Got it` 按钮（无空底栏、无「AI 修复」按钮），下方无嵌套灰框单行展示 `镜头 1  审片结果无法解析` / `Shot 1  Could not parse verification result`。
- `after-details-zh.png`、`after-details-en.png`（第 6 轮重拍亲眼核对）：任务中心顶部摘要与阶段进度一致显示 `6 / 9 个阶段已完成` / `6 / 9 stages done`，`审片 / Review` 行右侧诚实显示 `未校验 / Not verified`（消除原「已完成」自相矛盾），下方展示 `审片未完成：1 镜未校验（审片结果无法解析）` / `QA incomplete: 1 shot not verified (Could not parse verification result)`，`粗剪` 仍显示 `已完成`，零截断、零混语、英文单复数准确。
