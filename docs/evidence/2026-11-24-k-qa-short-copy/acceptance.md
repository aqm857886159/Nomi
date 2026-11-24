k-qa-copy-verify：通过

- 验收线：k-qa-copy-verify
- 实现线：k-qa-copy-impl
- 验收 HEAD：0972f4f683b1db6c4b4847934648d749e5382481
- 对应设计卡：`docs/plan/2026-11-24-k-qa-short-copy.md`
- 验收结论：通过（无阻塞项，无遗留缺陷）

## 1. 范围与代码审查

对照 `origin/main...0972f4f683b1db6c4b4847934648d749e5382481` 全部改动：

- `src/workbench/generationCanvas/components/ReconcileDeviationCard.tsx`：移除纯未校验单镜行内按钮的 `isMultiUnverified` 文案与内边距特例分叉，单镜与多镜行内统一渲染 `generationCommon.reconcile.recheckShort` / `generationCommon.reconcile.acceptShort` 并采用 `shrink-0 px-2.5`；多镜底栏批量区（`data-reconcile-unverified-batch="true"`，`recheckAll` / `acceptAll`）保持 `isMultiUnverified`（`unverified.length > 1`）门控，单镜不出底栏批量按钮。
- `src/i18n/locales/generationCommon.ts`：按 P1「加新必删旧」同提交删除重复词条 `generationCommon.reconcile.recheckOne` 与 `acceptOne`（zh-CN / en 各 `-2` 键），全仓 `git grep -nE '\b(recheckOne|acceptOne)\b' src/ -- ':!*.test.ts'` 命中 0 处。
- `src/workbench/ai/resident/useShotVerifyFeedback.test.ts`：补齐单镜未校验态在 `zh-CN` / `en` 双语下对 `recheckShort` / `acceptShort` 短词条、`data-reconcile-unverified-batch` 缺席以及 `i18n.exists('generationCommon.reconcile.recheckOne') === false` / `acceptOne === false` 的锁死断言；不硬抄长句文案字面量。
- `src/devlab/designLab/primitivesActions/states/01-workbench.tsx`：同步 `ReconcileDeviationCard.tsx` 删减行数后的设计实验室 `mirrors` 行号锚点。
- 隐私与干净度核查：所有提交信息与文本 diff 均无本机路径或私有环境标识泄漏。

## 2. 视觉证据逐张核验（亲眼 Read 全部 5 张真 Electron 窗口截图）

1. `docs/evidence/2026-11-24-k-qa-short-copy/before-vs-after.png`：并排对比清晰显示单镜未校验行内按钮已由改前 `重新审片 / 照用此镜`（英文 `Re-check / Use shot`）收口为改后 `重审 / 照用`（英文 `Re-check / Use`），卡片骨架、间距与对齐无回归。
2. `docs/evidence/2026-11-24-k-qa-short-copy/after-zh-light.png` & `after-zh-dark.png`：中文亮/暗双模式均正确展示 `1 镜没审成，不代表已通过  查看原因`、镜头行与紧凑 `[重审]` `[照用]` 双按钮，无底栏批量区，明暗对比度清晰无截断。
3. `docs/evidence/2026-11-24-k-qa-short-copy/after-en-light.png` & `after-en-dark.png`：英文亮/暗双模式均正确展示 `1 shot not checked, not confirmed as passing  Why`、镜头行与紧凑 `[Re-check]` `[Use]` 双按钮，无底栏批量区，排版干净无溢出。

## 3. 独立复跑测试与门岗结果

全部在验收分支独立串行复跑，均退出码 `0`：

- Vitest 4 套相关单测（`useShotVerifyFeedback.test.ts`、`shotVerifyStore.test.ts`、`shotVerify.test.ts`、`ProductionRunTaskCard.test.ts`）：`4 passed (4)`，`56 passed (56)`。
- `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`：通过（0 错误）。
- `./node_modules/.bin/tsc -p electron/tsconfig.json --noEmit`：通过（0 错误）。
- `node scripts/check-test-copy-literals.mjs`：通过（存量 1172 处 / 340 文件，棘轮只减不增且有 1 文件减少）。
- `pnpm run check:i18n`：通过（22/22 规则单测、`check:i18n-no-cost-claims`、visible-text、`key-parity` 6652 键 zh-CN ↔ en 锁步、`key-refs` 1813 文件零悬空引用、`fragile-match`、`test-copy-literals` 全绿）。
- `pnpm run check:controls`：通过（0 违规）。
- `pnpm run check:tokens`：通过（0/0/0/0）。
- `node scripts/check-design-lab.mjs --mirrors-only`：通过。
- `pnpm run check:filesize`：通过。
- `NOMI_BASE_REF=origin/main node scripts/lint-changed.mjs`：通过（3 个改动文件，0 错误）。
- `CONCEPT_OWNERS_BASE_REF=origin/main node scripts/check-concept-owners.mjs`：通过（第二写口 0 新增）。

## 4. ★9 反例故障注入验证（红 → 复原 → 绿）

1. **反例 1（单镜误出底栏批量按钮）**：将 `ReconcileDeviationCard.tsx` 中 `isMultiUnverified` 临时篡改为 `unverified.length >= 1` → `useShotVerifyFeedback.test.ts` 立即变红（`EXIT=1`，断言 `not to contain 'data-reconcile-unverified-batch="true"'` 命中）；还原后恢复全绿。
2. **反例 2（行内按钮退回已删旧键 `recheckOne`）**：将 `ReconcileDeviationCard.tsx` 行内 `recheckShort` 临时篡改为 `recheckOne` → `useShotVerifyFeedback.test.ts`（`EXIT=1`，单镜短文案断言命中）与 `tsx ./scripts/check-i18n-key-refs.ts`（`EXIT=1`，报错 `ReconcileDeviationCard.tsx:275` 悬空引用 `"generationCommon.reconcile.recheckOne"`）双双变红；还原后恢复 11/11 全绿。

## 5. 结论

设计卡 ★9 全部正反例、双语四态真窗口视觉核验、删旧唯一性与门岗护栏全部实证通过，`k-qa-copy-verify` 验收签放。
