# PR #1624 批过的板 ↔ 实现（中 / 英）

- 批过的板：`docs/design/boards/2026-11-07-model-surfaces/preview/M4-cost.png`（清单 `ModelSurfaces.board.json`，2026-11-07 拍板；元素 `cost.send-pill` / `cost.hover` / `cost.low-balance`）
- 实现：本目录真 Electron 窗口截图（1280×933，隔离资料，本机回环假 APIMart，`NOMI_TEST_NETWORK_GUARD=1`，0 个非 GET 请求），2026-11-23 由 `tests/ux/send-cost-currency-topup.walk.mjs` 在菜单右侧蓝勾与紧凑排版重做后重拍（中浅、英浅、中深、英深四轨全过）
- 对照图：
  - 批过的板 ↔ 改后实现：[board-vs-impl-zh.png](board-vs-impl-zh.png)、[board-vs-impl-en.png](board-vs-impl-en.png)
  - 改前（旧 #1624） ↔ 改后（重做后）：[before-vs-after-zh.png](before-vs-after-zh.png)、[before-vs-after-en.png](before-vs-after-en.png)

## 逐项对账

| # | 板上元素 | 中文实现 | 英文实现 | 结论 |
|---|---|---|---|---|
| 1 | ① 发送键与花费并成一颗胶囊：硬币图标 + 积分数 + 黑色圆形 ↑ | `zh-CN-credits.png`：硬币 + `1.95` + ↑ | `en-credits.png`：硬币 + `1.95` + ↑ | 与 `M4-cost.png` 原板 **100% 一致**（恢复纯数字 `1.95`，不加汉字 `约 ` / `~`，节省底栏宽度保证中文最长数 `14.63` 下左侧「文生视频」芯片不被挤缩；预估性质由悬停首句明确表达，仅 `output-estimate` 带 `≈`） |
| 2 | ① 悬停说明「这次约 N 积分（$x）。按 APIMart 公开价估，出完按 APIMart 实际扣费记。」 | 积分单位下逐字一致（`sendCost.estimate` 一字未动）；人民币单位为 3 短句紧凑排版（宽 `410px`）：`这次约 ¥1.31（1.95 积分）。` / `按 APIMart 公开价与人民银行中间价（2026-11-23，$1 ≈ ¥6.712）估。` / `出完按 APIMart 实际扣费记。` | 积分单位下逐字一致；人民币单位为 3 短句（宽 `498.5px`，较旧版 `~745px` 大幅收窄）：`About ¥1.31 (1.95 credits).` / `Converted at PBOC midpoint (2026-11-23, $1 ≈ ¥6.712) from the APIMart public rate.` / `Recorded at the actual APIMart charge once done.` | 积分那句**零改动**；人民币与美元去掉括号内重复的第二个「约 / `~`」并拆为短句，由共用 `Tooltip` 按句分行呈现，不再出现横跨窗口的 700px 横幅 |
| 3 | （新增）单位切换菜单 | `zh-CN-unit-menu.png`（宽 `130.6px`）：组标题写一次 `预计`，三行 `积分 1.95 ✓` / `人民币 ¥1.31` / `美元 $0.195`，右侧 14px `--nomi-accent` 蓝勾，零左侧死白 | `en-unit-menu.png`（宽 `129.2px`）：组标题 `Estimated`，三行 `Credits 1.95 ✓` / `CNY ¥1.31` / `USD $0.195`，右侧 14px 蓝勾 | 复用全站唯一 `WorkbenchMenu`（`trigger` 真触发器入口，触发钮叠 `data-[state=open]:bg-nomi-ink-20`）并对齐 `NomiSelect` 右侧 14px 蓝勾契约；删掉硬编码 `min-w-[216px]` 与底部空分组长句，落实 §1.5.2 第 5 条「对每一行都一样的信息，只说一次」 |
| 4 | （新增）人民币 / 美元胶囊 | `≈¥1.31` / `≈$0.195`（无硬币图标） | `≈¥1.31` / `≈$0.195`（无硬币图标） | 采用紧凑数学约号 `≈` 诚实标明换算/估算约数，同时保持紧凑数字胶囊形态 |
| 5 | ② 余额不够：发送键位置换成警示色「还差 7.6 积分」+ 黑色药丸「去充值 ↗」 | `zh-CN-low-balance.png` / `zh-CN-low-balance-dark.png`：`还差 7.6 积分`（`text-nomi-warning-ink`）+ `去充值 ↗` | `en-low-balance.png` / `en-low-balance-dark.png`：`Short 7.6 credits`（`text-nomi-warning-ink`）+ `Top up ↗` | 与 M4 原板一致，并将 12px 缺额小字从 `text-nomi-warning` 修正为 `text-nomi-warning-ink`（§2.1.2b，浅暗双模式均达 WCAG AA ≥4.5:1） |
| 6 | 工具条图标：文档 / 翻译 / N | 一致，另含 main 既有参数滑杆图标 | 一致 | 与 main 一致 |
| 7 | ③ 批量确认卡、④ 来源详情 | — | — | 不在本 PR 范围 |

## 汇率 $1 ≈ ¥6.712 单点归属

1. APIMart 公开价目 `GET /api/pricing/models/all` 与余额接口 `GET /v1/balance` 仅返回美元与积分，无人民币或汇率字段。
2. `src/workbench/generationCanvas/spend/sendCostFormat.ts` 单点持有中国人民银行授权中国外汇交易中心公布的 USD/CNY 中间价 `6.712`（`2026-11-23`，`https://www.chinamoney.com.cn/chinese/bkccpr/`），由 `sendCostFormat.test.ts` 全仓源码扫描守卫唯一性。
