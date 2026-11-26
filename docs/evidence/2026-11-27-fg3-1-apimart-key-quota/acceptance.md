有条件通过（第 3 轮复验闭环）：主进程 `electron/ai/onboarding/vendorAccountBalance.ts` 对本次实际用于查余额的已裁剪 Key 在内存中计算非明文 SHA-256 指纹 `checkedKeyId` 并随结果返回（绝不回传明文 Key、不落盘、不写日志）；渲染层 `src/ui/onboarding/useApimartVerification.ts` 统一按主进程返回的实际受检 `checkedKeyId` 隔离零额度状态，同一把 Key 遇 503 `keyQuota: null` 且 `accountBalance > 0` 继续保锁 `keyQuota` 不误关页，而在设置中换钥（含未在本页输入过 Key 直接复查已保存 Key 的场景）后遇新 Key 额度 503 + 账户余额为正则按新指纹独立判定正常放行；中英真窗截图继续按派活单留交协调审查补截确认。

- 验收线：v-fg3-1-r3
- 验收 HEAD：00da4bce96bf995951fa5605eb749ebc239f320d
- 阻断：无

## 1. 范围与禁区核查（对照 `origin/main`）

基线 `origin/main`（`1fad1ce47`）至 `00da4bce96bf995951fa5605eb749ebc239f320d` 共变更 13 个文件（`+584 / -38`），第 3 轮先测后修新增 2 笔提交：`a512ca760`（测试覆盖设置换钥与直接复查已存 Key 的零额度隔离）与 `00da4bce9`（主进程 `checkedKeyId`、共享契约、渲染层消费切换、概念 Owner 与根因合同更新）：

- 生产代码：`electron/ai/onboarding/vendorAccountBalance.ts`、`electron/shared/contracts/vendorAccountBalance.ts`、`src/ui/onboarding/useApimartVerification.ts`、`src/ui/onboarding/ApimartConnectPage.tsx`、`src/ui/onboarding/ApimartCheckCard.tsx`
- 测试与走查：`electron/ai/onboarding/vendorAccountBalance.test.ts`、`src/ui/onboarding/ApimartConnectPage.test.tsx`、`tests/ux/t5-onboarding-s6.walk.mjs`
- 工程门禁与证据：`docs/engineering/concept-owners/catalog.vendor-account-balance.json`、`docs/engineering/concept-owners/ui.apimart-verification.json`、`docs/fixes/2026-11-27-apimart-key-quota-verification.root-cause.json`、`scripts/vocabularies-baseline.json`（仅增 `keyQuota` 1 项）、`docs/evidence/2026-11-27-fg3-1-apimart-key-quota/acceptance.md`

禁区与拍板边界核对：

- `#1665` 禁区文件（`ModelAccountCard.tsx`、`ModelSettingsHome.tsx`、`ModelEntryRow.tsx`、`AiAssistedOnboarding*`）：**零改动**。
- 拍板图（`docs/design/boards/**`）与 i18n 文案（`src/i18n/**`）：**零改动**，未新增未经拍板的文案或按钮。
- 真付费边界：**零真付费调用**，所有验证均在本地单测与 mock IPC / fetch 边界完成。
- 密钥与指纹安全边界：全仓检索 `checkedKeyId` 确认仅存于主进程单次 `checkVendorAccountBalance` 返回值与渲染层 `exhaustedQuotas` 内存 `Map` 键值，不回传明文 Key、不写盘（无 `localStorage` / catalog 持久化）、不写日志。
- 入口唯一性：`door-map` 扫描 `src,electron` 共 3214 个文件，`useApimartVerification` 仅 1 扇写入口（`src/ui/onboarding/ApimartConnectPage.tsx:106`），`checkVendorAccountBalance` 仅 2 扇写入口（`electron/catalog/rendererCatalogMutation.ts:152` 候选 Key 保存与 `electron/ai/onboarding/onboardingIpc.ts:53` 已保存 Key 复查），均经 preload 桥原样透传 `checkedKeyId` 至同一渲染层 `receivedStage()` 判定。

## 2. 第 3 轮独立核查表（主进程指纹隔离与换钥放行 + 回归项）

| 核查项 | 代码路径与行为核对 | 结论 |
| --- | --- | --- |
| 主进程对实际受检 Key 计算非明文 SHA-256 指纹 | `electron/ai/onboarding/vendorAccountBalance.ts` 中 `balanceReader` 先对 `options.candidateKey ?? resolveApiKey(...)` 执行 `.trim()` 得到唯一 `apiKey`，同时用于构造两个请求（`/v1/user/balance`、`/v1/balance`）的 `Authorization: Bearer` 请求头与惰性 getter `checkedKeyId`（`createHash("sha256").update(apiKey).digest("hex")`）；候选 Key 与带首尾空白的已保存同 Key 产出一致指纹；`received` / `invalid` / `offline` 均携带 `checkedKeyId`，`unavailable` 不含凭据，发送侧 `readVendorAccountBalance` 不暴露 `checkedKeyId`。 | 通过 |
| 不回传明文 Key、不落盘、不写日志 | `VendorBalanceCheck`（`electron/shared/contracts/vendorAccountBalance.ts`）仅暴露 64 位十六进制 SHA-256 摘要 `checkedKeyId`；`vendorAccountBalance.ts`、`rendererCatalogMutation.ts`、`onboardingIpc.ts`、`modelOnboardingBridge.ts`、`useApimartVerification.ts` 全链路无明文 Key 回传、无落盘、无日志打印。 | 通过 |
| 渲染层彻底移除旧前端指纹与 `savedKeyId`，统一按 `checkedKeyId` 隔离 | `src/ui/onboarding/useApimartVerification.ts` 已同提交删除旧 `keyFingerprint`（`crypto.subtle.digest`）与 `savedKeyId` ref；`upsertVendorApiKey` 与 `recheckApimartBalance` 统一解构主进程回包 `{ checkedKeyId, keyQuota: quota }` 读写 `exhaustedQuotas` 内存 `Map`，无并行双轨。 | 通过 |
| 同一把 Key 遇 503 `keyQuota: null` + `accountBalance > 0` 继续保锁 | 无论首次是在本页粘贴还是直接复查已保存 Key，首次确认有限零额度后以 `checkedKeyId` 入锁；回前台复查同一把 Key 遇到 `keyQuota: null`（如 503）且账户余额为正时，命中同一 `checkedKeyId` 沿用缓存零额度，保持 `stage === 'keyQuota'`、继续展示警告态且 500ms 内不广播 `APIMART_CONNECTED_EVENT`、不调 `onSaved()`。 | 通过 |
| 设置中换钥（含未在本页输入过 Key 直接复查已保存 Key）后遇 503 + 账户余额为正正常放行 | 保持当前接入页挂载不变，在设置中更换已保存 Key 后触发回前台复查，`recheckApimartBalance()` 由主进程读取新保存 Key 并返回新 `checkedKeyId`；即使新 Key 额度端点返回 503（`keyQuota: null`）且账户余额为正，`exhaustedQuotas.current.get(newCheckedKeyId)` 未命中，`verified.keyQuota` 为 `null`，正常进入 `'passed'` 并在 450ms 后广播 `APIMART_CONNECTED_EVENT`、调用 `onSaved()` 完成放行。 | 通过 |
| 既有方案 B 与第 2 轮回归项全保持 | 同一把 Key 恢复正额度（`remainCredits > 0`）或改为不限额（`unlimited: true`）均删除对应 `checkedKeyId` 解锁放行；`accountBalance === 0` 仍优先 `'topup'` 且保留该 Key 零额度锁（后续账户恢复但 Key 仅返无单位 `reportedBalance` 仍回退 `'keyQuota'`）；同尾号不同 Key（`sk-original-1234` vs `sk-replacement-1234`）按指纹独立判定；不限额无误告警。 | 通过 |

## 3. 第 3 轮实跑定向单测与门禁脚本结果（HEAD `00da4bce96bf995951fa5605eb749ebc239f320d`）

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 核心定向单测（接入页 + 主进程余额诊断） | `VITEST_MAX_WORKERS=2 npx vitest run src/ui/onboarding/ApimartConnectPage.test.tsx electron/ai/onboarding/vendorAccountBalance.test.ts` | 通过（exit 0；2 个文件，52/52 全绿：25 + 27） |
| 关联 Onboarding 定向单测全集 | `VITEST_MAX_WORKERS=2 npx vitest run src/ui/onboarding/ApimartConnectPage.test.tsx src/ui/onboarding/onboardingS7aEntries.test.tsx src/ui/onboarding/manualCertificationBoundary.test.ts src/ui/onboarding/saveFirstOnboardingContract.test.ts electron/ai/onboarding/vendorAccountBalance.test.ts` | 通过（exit 0；5 个文件，70/70 全绿：25 + 6 + 2 + 10 + 27） |
| 概念 Owner 门岗 | `node ./scripts/check-concept-owners.mjs` | 通过（exit 0；430 个概念，converged 426 / pending 4，写接口 1113 个，第二写口 0 新增，parity_test 196/430；棘轮参照 `1fad1ce47`） |
| 根因合同门禁 | `node ./scripts/check-root-cause-contracts.mjs` | 通过（exit 0） |
| 自写登记门岗 | `pnpm run check:self-written` | 通过（exit 0；20/20 门岗自测通过，178 个领域目录 · 70 项登记 · 新增代码文件 0 个） |
| 语义词表门岗 | `node ./scripts/check-vocabularies.mjs` | 通过（exit 0；245 个 owner 全部已登记） |
| 入口数门核查 | `node ./scripts/door-map.mjs useApimartVerification && node ./scripts/door-map.mjs checkVendorAccountBalance` | 通过（exit 0；扫 3214 个文件，`useApimartVerification` 1 扇写入口，`checkVendorAccountBalance` 2 扇写入口） |

## 4. 第 3 轮破坏必红反例实测（不移动 HEAD，测后已完整还原）

- **反例 D（检出第 3 轮仅测试提交 `a512ca760` 对应的 3 个生产文件）**：
  - 命令：`git checkout a512ca760 -- electron/ai/onboarding/vendorAccountBalance.ts electron/shared/contracts/vendorAccountBalance.ts src/ui/onboarding/useApimartVerification.ts && VITEST_MAX_WORKERS=2 npx vitest run src/ui/onboarding/ApimartConnectPage.test.tsx electron/ai/onboarding/vendorAccountBalance.test.ts`
  - 结果：**真实变红（exit 1；2 个测试文件均失败，6 failed / 46 passed，共 52 用例）**：
    - `electron/ai/onboarding/vendorAccountBalance.test.ts`（4 处失败）：`identifies the checked Key used for both requests on candidate and saved-key checks`、`reports an explicit key refusal (HTTP 401)`、`reports an explicit key refusal (HTTP 403)`、`reports offline only if neither endpoint responds` 均因缺少 `checkedKeyId` 断言失败。
    - `src/ui/onboarding/ApimartConnectPage.test.tsx`（2 处失败）：`isolates a foreground recheck after settings replaces a Key (pasted here)` 与 `isolates a foreground recheck after settings replaces a Key (already saved)` 在设置换钥后遇 503 `keyQuota: null` 时均误保持 `stage === 'keyQuota'` 而非 `'passed'`。
  - 还原确认：已立即执行 `git checkout HEAD -- electron/ai/onboarding/vendorAccountBalance.ts electron/shared/contracts/vendorAccountBalance.ts src/ui/onboarding/useApimartVerification.ts`，还原后工作树干净。

## 5. 留交协调审查项

- 中英真窗截图（`o4a-zero-token` / `o4a-unknown-account` 等）继续按派活单约定留交协调审查补截确认；第 3 轮无代码、测试或门禁阻断。
