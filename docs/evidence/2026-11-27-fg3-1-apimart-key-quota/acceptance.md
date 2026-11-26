有条件通过：有限 Key 额度为 0 时停在四行检查卡、隐藏自动关页提示、窗口回前台自动重查、不限额反例与回退必红反例全部实测通过；中英真窗截图按派活单由协调审查补截确认。

- 验收线：v-fg3-1
- 验收 HEAD：ec8bd3663ca287b57aff35d4942a89fded862d11
- 阻断：无

## 1. 范围与禁区核查

基线 `a05ca5219` 至目标提交 `ec8bd3663ca287b57aff35d4942a89fded862d11` 共 2 笔提交（先测后修：`0d9049f55`、`ec8bd3663`），变更 8 个文件（`+290 / -24`）：

- 生产代码：`src/ui/onboarding/useApimartVerification.ts`、`src/ui/onboarding/ApimartConnectPage.tsx`、`src/ui/onboarding/ApimartCheckCard.tsx`
- 测试与走查：`src/ui/onboarding/ApimartConnectPage.test.tsx`、`tests/ux/t5-onboarding-s6.walk.mjs`
- 工程门禁登记：`docs/engineering/concept-owners/ui.apimart-verification.json`、`docs/fixes/2026-11-27-apimart-key-quota-verification.root-cause.json`、`scripts/vocabularies-baseline.json`（仅增 `keyQuota` 1 项）

禁区与拍板边界核对：

- `#1665` 禁区文件（`ModelAccountCard.tsx`、`ModelSettingsHome.tsx`、`ModelEntryRow.tsx`、`AiAssistedOnboarding*`）：**未触碰**。
- 拍板图（`docs/design/boards/**`）与 i18n 文案（`src/i18n/**`）：**未触碰**，未新增未经拍板的文案或按钮。
- 入口唯一性：`node scripts/door-map.mjs useApimartVerification` 扫描 `src,electron` 共 3214 个文件，仅 1 扇写入口 `src/ui/onboarding/ApimartConnectPage.tsx:106`，0 读入口；`upsertVendorApiKey` 与 `recheckApimartBalance` 均汇入同一 `receivedStage()` 判定。

## 2. 方案 B 逻辑与余额组合代码路径核对

- 共享耗尽谓词：`useApimartVerification.ts` 导出 `isExhaustedBalance(snapshot) = snapshot?.remainCredits === 0 && !snapshot.unlimited`，`ApimartCheckCard.tsx` 同源复用，消除判定与红黄标条件分叉（主进程 `electron/ai/onboarding/vendorAccountBalance.ts` 在有限余额或限额归零时已归一 `remainCredits: 0, unlimited: false`）。
- 账户 52.3 + 有限 Key 额度 0：`receivedStage()` 返回 `'keyQuota'`；`ApimartConnectPage.tsx` 设 `showChecks = true` 保留四行检查卡，不渲染 `ApimartTopUpNotice`；`ApimartCheckCard.tsx` 第 3 行亮黄三角与告警文案并隐藏 `afterPaste`；`stage !== 'passed'` 不启动 450ms 定时器，不派发 `APIMART_CONNECTED_EVENT`，不调用 `onSaved()`；`useEffect` 在 `stage === 'topup' || stage === 'keyQuota'` 挂载 `window.focus` 与 `document.visibilitychange`（`visible`）自动 `retry()`，回前台走 `recheckApimartBalance` 不重复保存。
- 账户 0（有限）+ Key 任意值（含 Key 0 或不限额）：`receivedStage()` 先判账户余额，仍优先返回 `'topup'`，展示充值卡并隐藏 `afterPaste`。
- 账户 52.3 + Key 不限额（含 `remainCredits: 0, unlimited: true` 及 `remainCredits: null, unlimited: true`）以及账户不限额（`remainCredits: 0, unlimited: true`）+ Key 50：`isExhaustedBalance` 为 `false`，返回 `'passed'`，无告警样式、保留 `afterPaste`，450ms 后正常派发 `APIMART_CONNECTED_EVENT` 并调用 `onSaved()`。

## 3. 门禁脚本、定向单测与宿主守卫实跑结果

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 概念 Owner 门岗 | `node ./scripts/check-concept-owners.mjs` | 通过（exit 0；430 个概念，第二写口 0 新增，parity_test 196/430） |
| 根因合同门禁 | `node ./scripts/check-root-cause-contracts.mjs` | 通过（exit 0） |
| 语义词表门岗 | `node ./scripts/check-vocabularies.mjs` | 通过（exit 0；245 个 owner 全部已登记） |
| 全量类型检查 | `pnpm run typecheck` | 通过（exit 0；app / electron / electron-pi / fixtures / check:test-types 5 份并发全绿，墙钟 42.9s） |
| 定向单测 | `VITEST_MAX_WORKERS=2 pnpm exec vitest run src/ui/onboarding/ApimartConnectPage.test.tsx electron/ai/onboarding/vendorAccountBalance.test.ts` | 通过（exit 0；2 个文件，46/46 全绿：20 + 26） |
| 宿主启动器守卫 | `VITEST_MAX_WORKERS=2 pnpm exec vitest run tests/ux/_launchApp.test.mjs` | 通过（exit 0；59/59 全绿） |

## 4. 破坏必红反例实测（不移动 HEAD，测后已完整还原）

1. **反例 A（检出仅测试提交 `0d9049f55` 生产快照）**：
   - 检出 `0d9049f55` 版本的 `useApimartVerification.ts`、`ApimartConnectPage.tsx`、`ApimartCheckCard.tsx`，运行 `VITEST_MAX_WORKERS=2 pnpm exec vitest run src/ui/onboarding/ApimartConnectPage.test.tsx`。
   - 结果：**真实变红（exit 1；3 failed / 17 passed，共 20 用例）**：
     - `keeps the four checks open for zero Key quota until a foreground recheck succeeds`：5 处断言失败（`stage` 误为 `'passed'`、`afterPaste` 误显、450ms 后误发 `nomi-apimart-connected` 并误调 `onSaved`、`focus` 未触发重查）。
     - `honors unlimited Key with numeric zero when choosing whether to return` 与 `honors unlimited account with numeric zero when choosing whether to return`：旧检查卡未判 `!unlimited` 导致误亮 `text-nomi-warning-ink`。
2. **反例 B（保留 `HEAD` 测试与组件，仅把 `useApimartVerification.ts` 判定改回只看 `accountBalance`）**：
   - 将 `setStage(receivedStage(result))` 改回旧表达式 `result.accountBalance?.remainCredits === 0 && !result.accountBalance.unlimited ? 'topup' : 'passed'`，运行 `ApimartConnectPage.test.tsx`。
   - 结果：**真实变红（exit 1；1 failed / 19 passed，共 20 用例）**：
     - `keeps the four checks open for zero Key quota until a foreground recheck succeeds` 4 处断言失败（`stage` 为 `'passed'` 而非 `'keyQuota'`、450ms 后误派发 `nomi-apimart-connected` 1 次、误调 `onSaved` 1 次、`focus` 重查调用 0 次而非 1 次）。
3. 还原确认：反例实测完毕已执行 `git checkout HEAD -- .`，已跟踪文件 100% 干净，`HEAD` 保持 `ec8bd3663ca287b57aff35d4942a89fded862d11`。

## 5. 留交协调审查项

- 中英真窗截图（`o4a-zero-token` / `o4a-unknown-account` 等）按原始派活单约定，留交协调审查时补截确认；无代码与测试阻断。
