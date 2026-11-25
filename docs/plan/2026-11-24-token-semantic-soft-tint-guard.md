# 语义状态色透明摊薄淡底门岗（Q-semantic-tint）

实现线 `q-semantic-tint-impl`。纯设计 token 门岗加固（短档）。

## 短版设计卡

### ★0 先查别人
- `tailwind.config.ts:89` · 设计系统第 ③ 条约束早已定死「`soft/edge` 是色阶上独立的一档，不是 `base` 的 alpha；`color-mix(base 18%, transparent)` 会把 `L=0.55` 的深描边色摊薄成灰泥色」 · 直接作为本门岗判据根基：禁止对四语义状态主色（`warning` / `danger` / `success` / `info`）写 `/透明度` 或向 `transparent` 混合当背景。
- `scripts/lib/accentOutlineScan.mjs:14` 与 `scripts/accent-outline-baseline.json:1` · 强调色描边棘轮按「类名 + 任意值 + 样式声明」三类写法逐行计数，并用逐文件 `{ count, reason }` 白名单锁死历史存量、新文件零容忍 · 复用完全相同的扫描架构与白名单契约。
- `scripts/check-design-tokens.mjs:183` 与 `scripts/overlay-z-baseline.json:1` · `check:tokens` 统一汇总所有设计 token 棘轮（超上限红牌、低于上限黄牌提醒下调、缺 `reason` 红牌） · 直接并入 `scripts/check-design-tokens.mjs` 第 10 类，不另起独立门岗命令。

### ★1 用法与量具
研发在组件 `className` 或样式里写提醒 / 错误 / 成功 / 提示底色时，`pnpm run check:tokens` 在本机与 CI 自动检查。目标是彻底拦截把四语义主色（`warning` / `danger` / `success` / `info`）直接加 `/数字` 透明度当浅底而塌缩成无彩度灰泥色的回归（如 `#1660` 初版 O5 充值卡写成 `bg-nomi-warning/10` 导致卡片发灰）。量具：① `pnpm exec vitest run scripts/semanticSoftTintScan.test.mjs`（回放 `#1660` 真实走灰样本与三类写法拦截率 `100%`，独立 `-soft` 档、中性半透明与描边透明度误伤率 `0%`）；② `pnpm run check:tokens`（全仓存量锁死在 `7` 个文件 / `8` 处，其余全部文件上限为 `0`）。无用户界面改动与存量用户数据迁移。

### ★2 归属
`tailwind.config.ts` 拥有四语义四档状态色定义（`base` / `-soft` / `-edge` / `-ink`）；`scripts/lib/semanticSoftTintScan.mjs` 独占语义状态色向 `transparent` 摊薄底色的计数规则；`scripts/semantic-soft-tint-baseline.json` 独占历史存量逐文件上限与理由；`scripts/check-design-tokens.mjs` 独占门岗裁决出口。

### ★3 三条路
1. 从 `tailwind.config.ts` 去掉四语义主色的 `tokenColor()` 包装：会导致 `border-nomi-warning/40` 等存量描边类被 Tailwind JIT 静默丢弃（退回 Issue `#32` 无样式裸奔事故），不可取。
2. **选此路**：保留 `tokenColor()` 通道，在 `scripts/check-design-tokens.mjs` 增加语义状态色背景透明摊薄棘轮（覆盖 `bg-*-warning/10`、`bg-[color-mix(...transparent)]` 与行内 / CSS `background*: color-mix(...transparent)`），新增一律强制使用独立 `-soft` 档（配 `-edge` / `-ink`）；全仓 `7` 个历史存量文件（含 `#1548` 排队碰到的 `spend/` 2 处及 5 处待随各自面板走查对账迁出的旧卡片）逐文件锁进 `scripts/semantic-soft-tint-baseline.json` 只减不增。
3. 本单顺手改掉其余 5 个工作台 `.tsx` 存量文件：这些文件横跨分镜、3D 导演台与长跑任务卡，按 `docs/engineering/test-routing.json` 会把纯门岗单膨胀成四类严档多界面走查单并增加跨线冲突，不如先锁死零新增棘轮、随对应界面走查逐个清零。

### ★4 全状态
存量等于白名单且新增为 `0` 时绿牌通过；任一文件超出白名单或新文件出现 `1` 处即红牌阻断并打印 `-soft` 替换指引；存量清理低于白名单或文件已清零未删条目时打印黄牌提醒下调；白名单条目缺正整数 `count` 或非空 `reason` 时红牌阻断。

### ★9 验收与回滚
- 自验命令：`VITEST_MAX_WORKERS=2 pnpm exec vitest run scripts/semanticSoftTintScan.test.mjs` 与 `pnpm run check:tokens`。
- 反例与正例：`#1660` 真实错误样本 `bg-nomi-warning/10`、`hover:bg-workbench-danger/15`、`bg-nomi-info/[0.12]`、`bg-[color-mix(in_oklab,var(--nomi-warning)_10%,transparent)]`、`backgroundColor: 'color-mix(in oklab, var(--workbench-danger) 12%, transparent)'` 均必判命中；`bg-nomi-warning-soft`、`hover:bg-workbench-danger-soft/80`、`border-nomi-warning/40`、`bg-nomi-paper/80` 均必判 `0` 命中。
- 回滚：`git revert` 本提交。
- 复查日 `2026-12-24`：核查 `scripts/semantic-soft-tint-baseline.json` 条目数只减不增且无新增语义状态色透明摊薄走灰问题。
