> 2026-11-23 更新：参考汇率由无出处的 `$1 ≈ ¥7.25（2026-11-22）` 改为人民银行中间价 `$1 ≈ ¥6.712（2026-11-23）`，本目录 11 张截图已重拍（人民币约数 ¥1.41 → ¥1.31）；下文第 4 节里的旧汇率与旧约数以 [board-vs-impl.md](board-vs-impl.md) 为准。

t1-verify：通过

- 验收线：t1-verify
- 验收 HEAD：`e224e4129f8580e871d9c9c8596847fdb1f71ff1`
- 拍板图对账：`docs/design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json`
- 证据目录：`docs/evidence/2026-11-22-send-cost-currency-topup/`

## 1. 拍板图、单源鉴权与组件复用核验
- `git diff origin/main...HEAD -- docs/design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json` 确认仅推进 `cost.low-balance` 为 `implemented`（绑定走查断言 `board:ModelSurfaces/cost.low-balance`），未改动其余 43 项。
- 核对增量提交 `0880fec64..e224e4129`：`electron/ai/onboarding/vendorAccountBalance.ts:92` 已去掉手写 `Authorization` 字面量，改走全仓唯一鉴权头构造入口 `authHeaders(vendorAuthSpec(vendor), apiKey)`。
- 核读 `src/workbench/generationCanvas/spend/SendCostUnitMenuButton.tsx` 与 `src/workbench/generationCanvas/nodes/ComposerSendButton.tsx`：单位切换菜单复用全站唯一 `WorkbenchMenu`（Radix Portal / 单选 `radio` / 底部汇率日期说明），余额不足去充值按钮复用 `WorkbenchButton`（`variant="primary"`、`size="sm"`、`rounded-pill`），悬停提示复用 `Tooltip` / `TooltipContent`，零自建弹层/按钮轮子。

## 2. 独立单测与门岗核验（全绿）
- 核心 7 套 Vitest 单测（`vendorAuthSpecReadPaths.test.ts` 4 + `vendorAccountBalance.test.ts` 7 + `onboardingIpc.test.ts` 15 + `sendCostFormat.test.ts` 10 + `sendCostLowBalance.test.ts` 3 + `useVendorBalance.test.tsx` 2 + `ComposerSendButton.test.tsx` 16）：**7 passed (7) / 57 passed (57)**。
- 8 项门岗全部 0 错误通过：
  - `pnpm run check:board-parity`：103/103 单测 + 全仓 55 张板通过
  - `pnpm run check:i18n`：22/22 门岗单测 + 6637 键中英齐平 + 0 未解析引用
  - `pnpm run check:tokens`：通过
  - `pnpm run check:controls`：通过
  - `pnpm run check:self-written`：通过
  - `pnpm run check:filesize`：通过
  - `node scripts/check-outbound-policy.mjs`：通过（`isPrivateHost importers 4, env escape hatches 0, error laundering points 0`）
  - `node scripts/lint-changed.mjs`：29 个改动文件，错误 0，警告不比 `origin/main` 多

## 3. 独立反例 / 删线变异实证（4/4 必红 → 还原后全绿）
| 编号 | 注入变异 | 目标测试 | 实测结果 |
|---|---|---|---|
| V1 | `src/workbench/generationCanvas/spend/sendCostLowBalance.ts:31` 恒返回 `null`（什么都不做） | `sendCostLowBalance.test.ts` | **FAIL**（2 failed / 1 passed：中英余额不足缺额断言均红） |
| V2 | `src/workbench/generationCanvas/spend/sendCostLowBalance.ts:27` 去掉 `balance.unlimited` 守卫 | `sendCostLowBalance.test.ts` | **FAIL**（1 failed / 2 passed：无限额度误判缺额 10 积分当场红） |
| V3 | `electron/ai/onboarding/vendorAccountBalance.ts:85` 跳过 `allowedOrigins` 官方域名白名单校验 | `vendorAccountBalance.test.ts` | **FAIL**（1 failed / 6 passed：自定义中转外发凭据拦截断言必红） |
| V4 | `src/workbench/generationCanvas/spend/sendCostFormat.ts:76` 去掉 `approx` 前缀直接返回数值 | `sendCostFormat.test.ts` | **FAIL**（3 failed / 7 passed：中英三单位与兜底 `≈` 约字断言全红） |

全部变异经 `git checkout` 还原干净后复跑全部核心单测 **57/57 全绿**。

## 4. 真窗口截图与性能收据亲眼核验
- 逐张 `read_file` 亲眼核对 `docs/evidence/2026-11-22-send-cost-currency-topup/` 全部 **11 张**截图：
  - 中文 6 张（`zh-CN-credits.png`、`zh-CN-unit-menu.png`、`zh-CN-cny-hover.png`、`zh-CN-usd.png`、`zh-CN-low-balance.png`、`zh-CN-low-balance-dark.png`）：胶囊印 `约 1.95` / `约 ¥1.41` / `约 $0.195`，菜单含三项实时约数与 `内置汇率（2026-11-22）：$1 ≈ ¥7.25`，悬停两行按句折行无截断，低余额浅/暗双模式均在同一行清晰呈现警示色 `还差 7.6 积分` + 主色药丸 `去充值 ↗`，无重叠溢出。
  - 英文 5 张（`en-credits.png`、`en-unit-menu.png`、`en-cny-hover.png`、`en-usd.png`、`en-low-balance.png`）：胶囊印 `~1.95` / `~¥1.41` / `~$0.195`，菜单印 `Credits` / `CNY` / `USD` 与 `Built-in rate (2026-11-22): $1 ≈ ¥7.25`，低余额印 `Short 7.6 credits` + `Top up ↗`，全屏零中文串味、无截断重叠。
- 核查 `docs/evidence/2026-11-22-send-cost-currency-topup/perf-send-cost-param-update.json`：`runs: 5`、中位数 **`142.9ms`**、p95 **`145.1ms`**、预算 `200ms`（`≤200ms`）、`dirty: false`、`verdict.status: "ok"`。

## 5. 未验证项说明
- 与 PR 正文如实对齐：Windows 真机与真实 APIMart 付费账号未在本验收线运行，记为 `unverified`。
