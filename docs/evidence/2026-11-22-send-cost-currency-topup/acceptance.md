t1-verify：通过

- 验收线：t1-verify
- 验收 HEAD：`cd61aafccf10bfb15752a49183e24acb4fd19024`
- 拍板图对账：`docs/design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json`
- 证据目录：`docs/evidence/2026-11-22-send-cost-currency-topup/`

## 1. 拍板图、单源鉴权与组件复用核验
- `git diff origin/main...HEAD -- docs/design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json` 确认仅推进 `cost.low-balance` 为 `implemented`（绑定走查断言 `board:ModelSurfaces/cost.low-balance`），未改动其余 43 项。
- 核对增量提交 `0880fec64..e224e4129`：`electron/ai/onboarding/vendorAccountBalance.ts:92` 已去掉手写 `Authorization` 字面量，改走全仓唯一鉴权头构造入口 `authHeaders(vendorAuthSpec(vendor), apiKey)`。
- 核读 `src/workbench/generationCanvas/spend/SendCostUnitMenuButton.tsx` 与 `src/workbench/generationCanvas/nodes/ComposerSendButton.tsx`：单位切换菜单复用全站唯一 `WorkbenchMenu`（Radix Portal / 单选 `radio` / 底部汇率出处与日期说明），余额不足去充值按钮复用 `WorkbenchButton`（`variant="primary"`、`size="sm"`、`rounded-pill`），悬停提示复用 `Tooltip` / `TooltipContent`，零自建弹层/按钮轮子。

## 2. 独立单测与门岗核验（全绿）
- 核心 7 套 Vitest 单测（`vendorAuthSpecReadPaths.test.ts` 4 + `vendorAccountBalance.test.ts` 7 + `onboardingIpc.test.ts` 15 + `sendCostFormat.test.ts` 11 + `sendCostLowBalance.test.ts` 3 + `useVendorBalance.test.tsx` 2 + `ComposerSendButton.test.tsx` 16）：全部通过。
- 8 项门岗全部 0 错误通过：
  - `pnpm run check:board-parity`：103/103 单测 + 全仓 55 张板通过
  - `pnpm run check:i18n`：22/22 门岗单测 + 6637 键中英齐平 + 0 未解析引用
  - `pnpm run check:tokens`：通过
  - `pnpm run check:controls`：通过
  - `pnpm run check:self-written`：通过
  - `pnpm run check:filesize`：通过
  - `node scripts/check-outbound-policy.mjs`：通过（`isPrivateHost importers 4, env escape hatches 0, error laundering points 0`）
  - `node scripts/lint-changed.mjs`：错误 0，警告不比 `origin/main` 多

## 3. 独立反例 / 删线变异实证（4/4 必红 → 还原后全绿）
| 编号 | 注入变异 | 目标测试 | 实测结果 |
|---|---|---|---|
| V1 | `src/workbench/generationCanvas/spend/sendCostLowBalance.ts:31` 恒返回 `null`（什么都不做） | `sendCostLowBalance.test.ts` | **FAIL**（2 failed / 1 passed：中英余额不足缺额断言均红） |
| V2 | `src/workbench/generationCanvas/spend/sendCostLowBalance.ts:27` 去掉 `balance.unlimited` 守卫 | `sendCostLowBalance.test.ts` | **FAIL**（1 failed / 2 passed：无限额度误判缺额 10 积分当场红） |
| V3 | `electron/ai/onboarding/vendorAccountBalance.ts:85` 跳过 `allowedOrigins` 官方域名白名单校验 | `vendorAccountBalance.test.ts` | **FAIL**（1 failed / 6 passed：自定义中转外发凭据拦截断言必红） |
| V4 | `src/workbench/generationCanvas/spend/sendCostFormat.ts:76` 去掉 `approx` 前缀直接返回数值 | `sendCostFormat.test.ts` | **FAIL**（3 failed / 7 passed：中英三单位与兜底 `≈` 约字断言全红） |

全部变异经 `git checkout` 还原干净后复跑全部核心单测全绿。

## 4. 真窗口截图与性能收据亲眼核验
- 逐张 `read_file` 亲眼核对 `docs/evidence/2026-11-22-send-cost-currency-topup/` 全部截图（2026-11-23 重拍后共 13 张，含 11 张真窗口截图 + 2 张中英板实现对照图，详见第 5 节与 [board-vs-impl.md](board-vs-impl.md)）：
  - 中文截图（`zh-CN-credits.png`、`zh-CN-unit-menu.png`、`zh-CN-cny-hover.png`、`zh-CN-usd.png`、`zh-CN-low-balance.png`、`zh-CN-low-balance-dark.png`）：胶囊印 `约 1.95` / `约 ¥1.31` / `约 $0.195`，菜单含三项实时约数与 `人民银行中间价（2026-11-23）：$1 ≈ ¥6.712`，悬停两行按句折行无截断，低余额浅/暗双模式均在同一行清晰呈现警示色 `还差 7.6 积分` + 主色药丸 `去充值 ↗`，无重叠溢出。
  - 英文截图（`en-credits.png`、`en-unit-menu.png`、`en-cny-hover.png`、`en-usd.png`、`en-low-balance.png`）：胶囊印 `~1.95` / `~¥1.31` / `~$0.195`，菜单印 `Credits` / `CNY` / `USD` 与 `PBOC midpoint (2026-11-23): $1 ≈ ¥6.712`，低余额印 `Short 7.6 credits` + `Top up ↗`，全屏零中文串味、无截断重叠。
- 核查 `docs/evidence/2026-11-22-send-cost-currency-topup/perf-send-cost-param-update.json`：`runs: 5`、中位数 **`142.9ms`**、p95 **`145.1ms`**、预算 `200ms`（`≤200ms`）、`dirty: false`、`verdict.status: "ok"`。

## 5. 2026-11-23 增量独立复验（`e224e4129..cd61aafcc`）
- **跨池独立复验身份**：由未参与 PR #1624 任何代码编写的独立验收线执行，基线 `HEAD = cd61aafccf10bfb15752a49183e24acb4fd19024`（已合并最新 `origin/main`，涵盖增量提交 `963bd7325`、`08e55eaed`、`12c7c5bfb`）。
- **增量事实核对**：
  - 参考汇率已由无出处的 `7.25（2026-11-22）` 更新为中国外汇交易中心 / 中国人民银行授权公布的银行间外汇市场人民币汇率中间价 `BUILTIN_USD_TO_CNY_RATE = 6.712`、`BUILTIN_USD_TO_CNY_DATE = '2026-11-23'`（出处 URL `https://www.chinamoney.com.cn/chinese/bkccpr/` 登记在唯一主人 `src/workbench/generationCanvas/spend/sendCostFormat.ts`），所有换算值在界面统一标「约」/`~`；
  - `src/workbench/generationCanvas/spend/sendCostFormat.test.ts` 的全仓扫描已覆盖 `src/` 与 `electron/` 的 `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs` 产品代码，钉死汇率命名（含 `RMB`/`DOLLAR`/`YUAN`）、汇率字面量（含末尾补零 `6.7120`）、`formatMoney(..., 'CNY')` 及 `Intl.NumberFormat(..., { currency: 'CNY' })` 单点归属；
  - `docs/evidence/2026-11-22-send-cost-currency-topup/board-vs-impl.md` 与目录内全部 13 张 PNG（含 `board-vs-impl-zh.png`、`board-vs-impl-en.png` 及重拍的 11 张真窗口截图）均已核查存在且零本机绝对路径泄露；已亲眼 `read_file` 复核 `board-vs-impl-zh.png`、`board-vs-impl-en.png`、`zh-CN-unit-menu.png`、`en-unit-menu.png`、`zh-CN-cny-hover.png`、`en-cny-hover.png` 均准确呈现 `人民银行中间价（2026-11-23）：$1 ≈ ¥6.712` / `PBOC midpoint (2026-11-23): $1 ≈ ¥6.712` 与 `约 ¥1.31` / `~¥1.31`。
- **增量实跑测试与门岗（全绿）**：
  - `pnpm exec vitest run src/workbench/generationCanvas/spend/sendCostFormat.test.ts src/workbench/generationCanvas/nodes/ComposerSendButton.test.tsx src/workbench/generationCanvas/spend/sendCostLowBalance.test.ts` → **3 passed / 30 passed**（`sendCostFormat` 11 + `ComposerSendButton` 16 + `sendCostLowBalance` 3）；
  - `node scripts/check-i18n-no-cost-claims.mjs` → **`check:i18n-no-cost-claims OK`**；
  - `node scripts/check-board-parity.mjs` → **通过（12 张板 + 其它日期目录 43 张板，共 55 张板）**。
- **增量独立反例注入（4/4 必红 → 清理临时文件后全绿）**：
  | 编号 | 临时注入反例（测试后已删除） | 目标测试 | 实测结果 |
  |---|---|---|---|
  | CE1 | `electron/ai/onboarding/__tmp_fx_ce1__.mts` 写入 `export const DOLLAR_TO_RMB_RATE = 7.1` | `sendCostFormat.test.ts` | **FAIL**（`.mts` + `DOLLAR`/`RMB` 命名守卫必红） |
  | CE2 | `electron/ai/onboarding/__tmp_fx_ce2__.cts` 写入 `module.exports = { factor: 6.7120 }` | `sendCostFormat.test.ts` | **FAIL**（`.cts` + 末尾补零字面量守卫必红） |
  | CE3 | `src/workbench/generationCanvas/spend/__tmp_fx_ce3__.ts` 私调 `formatMoney('zh-CN', 'CNY', v)` | `sendCostFormat.test.ts` | **FAIL**（owner 外 `formatMoney` CNY 出口守卫必红） |
  | CE4 | `src/workbench/generationCanvas/spend/__tmp_fx_ce4__.ts` 私调 `new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' })` | `sendCostFormat.test.ts` | **FAIL**（`Intl.NumberFormat` CNY 出口守卫必红） |

## 6. 未验证项说明
- 与 PR 正文如实对齐：Windows 真机与真实 APIMart 付费账号未在本验收线运行，记为 `unverified`。
