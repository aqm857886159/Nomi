有条件通过（第 2 轮复验闭环）：同一把已确认有限零额度的 Key 在窗口回前台复查遇到 `keyQuota: null`（如 503）且 `accountBalance > 0` 时严格保持 `keyQuota` 停页、450ms 后不广播 `APIMART_CONNECTED_EVENT` 且不调用 `onSaved()` 关页；同一把 Key 复查明确恢复正额度（`remainCredits > 0`）或改为不限额（`unlimited: true`）后正常解锁进入 `passed` 并完成连接；复查明确返回 `accountBalance === 0` 仍优先进入 `topup`，切换为另一把不同的新 Key（即便尾号相同）按 SHA-256 指纹独立判定不串锁；中英真窗截图继续按派活单留交协调审查补截确认。

- 验收线：v-fg3-1-r2
- 验收 HEAD：ecb6880676c5989867f7e8fdb9a6e559bda698ce
- 阻断：无

## 1. 范围与禁区核查（对照 `origin/main`）

基线 `origin/main`（`1fad1ce47`）至 `ecb6880676c5989867f7e8fdb9a6e559bda698ce` 共变更 9 个文件（`+435 / -25`），第 2 轮先测后修新增 2 笔提交：`f3187ac3d`（测试锁定）与 `ecb688067`（生产修复与根因合同更新）：

- 生产代码：`src/ui/onboarding/useApimartVerification.ts`、`src/ui/onboarding/ApimartConnectPage.tsx`、`src/ui/onboarding/ApimartCheckCard.tsx`
- 测试与走查：`src/ui/onboarding/ApimartConnectPage.test.tsx`、`tests/ux/t5-onboarding-s6.walk.mjs`
- 工程门禁与证据：`docs/engineering/concept-owners/ui.apimart-verification.json`、`docs/fixes/2026-11-27-apimart-key-quota-verification.root-cause.json`、`scripts/vocabularies-baseline.json`（仅增 `keyQuota` 1 项）、`docs/evidence/2026-11-27-fg3-1-apimart-key-quota/acceptance.md`

禁区与拍板边界核对：

- `#1665` 禁区文件（`ModelAccountCard.tsx`、`ModelSettingsHome.tsx`、`ModelEntryRow.tsx`、`AiAssistedOnboarding*`）：**零改动**。
- 拍板图（`docs/design/boards/**`）与 i18n 文案（`src/i18n/**`）：**零改动**，未新增未经拍板的文案或按钮。
- 真付费边界：**零真付费调用**，所有验证均在本地单测与 mock IPC 桥完成。
- 入口唯一性：`node ./scripts/door-map.mjs useApimartVerification` 扫描 `src,electron` 共 3214 个文件，仅 1 扇写入口 `src/ui/onboarding/ApimartConnectPage.tsx:106`，0 读入口；`upsertVendorApiKey` 与 `recheckApimartBalance` 均汇入同一 `receivedStage()` 判定。

## 2. 第 2 轮独立核查表（对应第 1 轮审查 [P1] 与 ★9 验收项）

| 核查项 | 代码路径与行为核对 | 结论 |
| --- | --- | --- |
| 零额度 Key 复查遇 `keyQuota: null`（如 503）+ `accountBalance > 0` 保锁 | `useApimartVerification.ts` 以 `crypto.subtle.digest('SHA-256', ...)` 计算 `keyId` 并在页面级 `exhaustedQuotas` Map 按 `keyId` 缓存已确认耗尽的 `VendorReportedBalance`（不存明文 Key）；回前台走 `recheckApimartBalance()` 使用 `savedKeyId.current`，当 `result.keyQuota === null` 时既不覆盖也不删除锁，`verified.keyQuota` 沿用缓存零额度，`receivedStage(verified)` 保持 `'keyQuota'`；`ApimartCheckCard.tsx` 继续亮 `text-nomi-warning-ink` 告警并隐藏 `afterPaste`；`stage !== 'passed'` 不启动 450ms 定时器，500ms 内不派发 `APIMART_CONNECTED_EVENT`、不调 `onSaved()`。 | 通过 |
| 同一把 Key 恢复正额度（`remainCredits > 0`）解锁 | `useApimartVerification.ts` 判定 `(quota?.remainCredits ?? 0) > 0` 时执行 `exhaustedQuotas.current.delete(keyId)`，`verified.keyQuota` 切回新快照，`receivedStage(verified)` 返回 `'passed'`；第 449ms 尚未触发，第 450ms 准时广播 `APIMART_CONNECTED_EVENT` 并调用 `onSaved()`，且全程仅保存 1 次（`upsertVendorApiKey` 调用 1 次）。 | 通过 |
| 同一把 Key 改为不限额（`unlimited: true`）解锁 | `useApimartVerification.ts` 判定 `quota?.unlimited` 为真时执行 `exhaustedQuotas.current.delete(keyId)`，`isExhaustedBalance` 返回 `false`，进入 `'passed'` 并在 450ms 准时广播事件与关页。 | 通过 |
| 复查明确返回 `accountBalance === 0` 仍优先 `topup` | `receivedStage(verified)` 先判 `isExhaustedBalance(result.accountBalance)` 再判 `isExhaustedBalance(result.keyQuota)`；`accountBalance === 0` 与 `keyQuota: null` 同时返回时进入 `'topup'`，且保留该 Key 的零额度锁；后续账户恢复正余额但 Key 额度仍缺有效正额（如仅返未明单位 `reportedBalance: 2` 且 `remainCredits: null`）时回退 `'keyQuota'` 不误放行。 | 通过 |
| 换另一把不同新 Key（即使尾号相同）独立判定不串锁 | `sk-original-1234` 与 `sk-replacement-1234` 虽然末 4 位相同，但 SHA-256 `keyId` 不同；重贴原 Key `sk-original-1234` 遇 `keyQuota: null` 仍保锁 `'keyQuota'`，换贴新 Key `sk-replacement-1234` 遇 `keyQuota: null` 时 `exhaustedQuotas.current.get(newKeyId)` 为空，独立进入 `'passed'` 并在 450ms 后正常完成连接。 | 通过 |
| 首次校验方案 B 其余组合与无告警不限额反例 | 首次账户 52.3 + 有限 Key 0 停页 `'keyQuota'`、隐藏 `afterPaste`、挂 `focus` / `visibilitychange` 自动重查；账户 0 + Key 0/不限额优先 `'topup'`；Key/账户 `unlimited: true`（含 `remainCredits: 0` 或 `null`）直接 `'passed'` 且无 `text-nomi-warning-ink`。 | 通过 |

## 3. 第 2 轮实跑定向单测与门禁脚本结果（HEAD `ecb6880676c5989867f7e8fdb9a6e559bda698ce`）

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 核心定向单测（接入页 + 主进程余额解析） | `VITEST_MAX_WORKERS=2 npx vitest run src/ui/onboarding/ApimartConnectPage.test.tsx electron/ai/onboarding/vendorAccountBalance.test.ts` | 通过（exit 0；2 个文件，49/49 全绿：23 + 26） |
| 关联 Onboarding 定向单测全集 | `VITEST_MAX_WORKERS=2 npx vitest run src/ui/onboarding/ApimartConnectPage.test.tsx src/ui/onboarding/onboardingS7aEntries.test.tsx src/ui/onboarding/manualCertificationBoundary.test.ts src/ui/onboarding/saveFirstOnboardingContract.test.ts electron/ai/onboarding/vendorAccountBalance.test.ts` | 通过（exit 0；5 个文件，67/67 全绿：23 + 6 + 2 + 10 + 26） |
| 概念 Owner 门岗 | `node ./scripts/check-concept-owners.mjs` | 通过（exit 0；430 个概念，第二写口 0 新增，parity_test 196/430；棘轮参照 `1fad1ce47`） |
| 根因合同门禁 | `node ./scripts/check-root-cause-contracts.mjs` | 通过（exit 0） |
| 语义词表门岗 | `node ./scripts/check-vocabularies.mjs` | 通过（exit 0；245 个 owner 全部已登记） |
| 唯一写入口数门核查 | `node ./scripts/door-map.mjs useApimartVerification` | 通过（exit 0；扫 3214 个文件，仅 1 扇写入口 `src/ui/onboarding/ApimartConnectPage.tsx:106`） |

## 4. 第 2 轮破坏必红反例实测（不移动 HEAD，测后已完整还原）

- **反例 C（检出第 2 轮仅测试提交 `f3187ac3d` 的 `src/ui/onboarding/useApimartVerification.ts`）**：
  - 命令：`git checkout f3187ac3d -- src/ui/onboarding/useApimartVerification.ts && VITEST_MAX_WORKERS=2 npx vitest run src/ui/onboarding/ApimartConnectPage.test.tsx`
  - 结果：**真实变红（exit 1；3 failed / 20 passed，共 23 用例，12 处断言失败）**：
    - `keeps a saved zero-quota Key on the page through a partial recheck until positive credits are confirmed`：`keyQuota: null` 后 `stage` 误转 `'passed'`、告警消失、500ms 内误广播 `nomi-apimart-connected` 1 次并误调 `onSaved` 1 次，且后续 `visibilitychange` 未触发第 2 次重查。
    - `keeps a saved zero-quota Key on the page through a partial recheck until unlimited quota are confirmed`：同上失败。
    - `prioritizes topup while retaining the zero quota for the same Key only`：自 `topup` 返回未明单位额度以及重贴同 Key `sk-original-1234` 遇 `keyQuota: null` 时 `stage` 均误转 `'passed'` 而非 `'keyQuota'`。
  - 还原确认：已立即执行 `git checkout HEAD -- src/ui/onboarding/useApimartVerification.ts`，工作树恢复干净。

## 5. 留交协调审查项

- 中英真窗截图（`o4a-zero-token` / `o4a-unknown-account` 等）继续按派活单约定留交协调审查补截确认；第 2 轮无代码、测试或门禁阻断。
