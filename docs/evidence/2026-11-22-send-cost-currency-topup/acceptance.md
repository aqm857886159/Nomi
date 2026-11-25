v-1612-accept：通过

- 验收线：v-1612-accept
- 实现线：design-menu-1624
- 验收 HEAD：ecbcaf16c3ec94137f24566bf88a172c93f2eb2b
- 拍板图对账：`docs/design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json`（`M4-cost.png`）
- 证据目录：`docs/evidence/2026-11-22-send-cost-currency-topup/`

## 1. 本轮重做独立验收（`ecbcaf16c3ec94137f24566bf88a172c93f2eb2b`）

本验收线未参与 PR #1624 与 PR #1628 任何代码编写。对整合 `#1628`（`WorkbenchMenu` 真触发器双入口与 Vite 预打包登记）后的设计系统重做提交 `ecbcaf16c` 逐项核验如下：

### 1.1 四条根因与三层收口代码核查
1. **第 1 层（全站 `src/design/menu.tsx` 右侧 14px 蓝勾 + `trailing` 字段收口）**：
   - 删掉左侧 16px 打勾死白槽，最右固定 `w-3.5`（14px）槽位渲染 `<IconCheck size={14} stroke={1.6} />`（启用态 `--nomi-accent` 蓝勾，禁用态退回 `text-nomi-ink-30`），选中行主文案 `font-semibold text-nomi-ink`，与未选中行/动作行左缘逐像素对齐；新增 `trailing?: string` 与 `shortcut` 语义分离；鼠标选一项关菜单不强拉程序焦点，消除按钮残留伪 `:focus-visible` 框。
   - 同步收口 `SendCostUnitMenuButton.tsx`（迁真触发器 `WorkbenchMenu trigger` + `data-[state=open]:bg-nomi-ink-20`，删 `min-w-[216px]` 与底部空分组汇率长句）、`LibraryCategoryNav.tsx`（计数迁 `trailing` 删 `min-w-[200px]`）、`CreationDocumentSwitcher.tsx`（删 `min-w-[220px]`）。
2. **第 2 层（#1624 胶囊、紧凑单位菜单、3 短句悬停与缺额对比度）**：
   - 积分发送胶囊恢复 M4 原稿 `🪙 1.95 ↑`（仅 `output-estimate` 带 `≈`），人民币/美元采用紧凑 `≈¥1.31` / `≈$0.195`；
   - 单位菜单组标题统一写一次 `预计` / `Estimated`，三行纯数值 `1.95` / `¥1.31` / `$0.195`，宽度收紧至 `130.6px`（中）/ `129.2px`（英）；
   - 人民币悬停提示去掉括号内重复「约 / `~`」并拆为 3 短句（`410px` 中 / `498.5px` 英），不再出现 700px+ 横幅；
   - `ComposerSendButton.tsx` 缺额小字改用 `text-nomi-warning-ink`（浅暗双模式达 WCAG AA 对比度）。
3. **第 3 层（单源鉴权、汇率单点归属与门岗锁定）**：
   - 人民银行中间价 `BUILTIN_USD_TO_CNY_RATE = 6.712`（`2026-11-23`）仍由 `sendCostFormat.ts` 单点持有，全仓扫描守卫；余额查询沿用 `authHeaders(vendorAuthSpec(vendor), apiKey)` 与官方域名白名单；全量 diff 本机路径泄露 **0 处**。

### 1.2 真窗口截图与拼图亲眼目视核验（`read_file` 逐张核查）
已逐张亲眼 `read_file` 核验 `docs/evidence/2026-11-22-send-cost-currency-topup/` 下的 4 张主对照拼图及全套浅/暗双模式真窗口截图（1280×933，中浅 / 英浅 / 中深 / 英深四轨，0 非 GET 请求）：
- **`before-vs-after-zh.png` & `before-vs-after-en.png`**：清晰对比改前 244px/228px 左侧死白宽盒 + 重复 `约`/`~` + 空分组注脚与改后 130.6px/129.2px 右侧 14px 蓝勾紧凑菜单；人民币悬停从 ~620px/~745px 压回 410px/498.5px 三短句且无残留伪焦点框；缺额小字浅/暗清晰可读。
- **`board-vs-impl-zh.png` & `board-vs-impl-en.png` + `board-vs-impl.md`**：与 `M4-cost.png` 原板逐项对账一致——积分胶囊硬币 + `1.95 ↑` 不挤缩左侧「文生视频」芯片，悬停说明、紧凑单位菜单、美元胶囊 `≈$0.195`、低余额 `还差 7.6 积分 / 去充值 ↗` / `Short 7.6 credits / Top up ↗` 均中英齐平、零文案串味。
- **全套浅暗单图核查**：`zh-CN-unit-menu.png`、`en-unit-menu.png`、`zh-CN-unit-menu-dark.png`、`en-unit-menu-dark.png`、`zh-CN-cny-hover-dark.png`、`en-cny-hover-dark.png`、`zh-CN-low-balance-dark.png`、`en-low-balance-dark.png`、`zh-CN-credits-dark.png`、`en-credits-dark.png`、`zh-CN-usd-dark.png`、`en-usd-dark.png` 均无截断、无溢出、无双语串味、无伪焦点框。
- **性能收据核查**：`perf-send-cost-param-update.json`：`runs: 5`、中位数 `142.9ms`、p95 `145.1ms` ≤ 预算 `200ms`，`verdict.status: "ok"`。

### 1.3 独立实跑轻量门岗与单测（均在 `ecbcaf16c3ec94137f24566bf88a172c93f2eb2b` 实跑通过）
- `node ./scripts/check-concept-owners.mjs`：✅ 通过（398 概念 · 1042 写接口 · 第二写口 0 新增 · 0 错）
- `pnpm run check:filesize`：✅ 通过（0 超限）
- `pnpm run check:self-written`：✅ 通过（20/20 单测，0 未认领）
- `pnpm run check:tokens`：✅ 通过（4 类棘轮 0/0/0/0）
- `pnpm run check:i18n`：✅ 通过（含 `check:i18n-no-cost-claims OK`）
- `pnpm run check:board-parity`：✅ 通过（111/111 单测 + 55 张板）
- `node scripts/fix-churn.mjs --range origin/main..HEAD`：✅ 通过（2 个热点 fix 均带有效 `Direction-Check`）
- `npx vitest run --maxWorkers=1` 4 套核心单测：**4 passed / 37 passed (37)**（`menu.structure.test.ts` 7/7、`sendCostFormat.test.ts` 11/11、`ComposerSendButton.test.tsx` 16/16、`sendCostLowBalance.test.ts` 3/3）。

## 2. 既有反例与历史验收留档（前序基线）
- 前序独立验收已验证余额不足/无限额度/官方域名白名单/约号前缀 4 项变异反例（V1–V4）及汇率单点 4 项源码扫描反例（CE1–CE4）全部必红复绿；本次 `ecbcaf16c` 保留全部底层保护并新增右侧蓝勾与 `trailing` 结构单测锁定。

## 3. 未验证项说明
- Windows 真机与真实 APIMart 付费账号未在本验收线运行，记为 `unverified`。
