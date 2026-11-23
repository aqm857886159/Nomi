# PR #1624 批过的板 ↔ 实现（中 / 英）

- 批过的板：`docs/design/boards/2026-11-07-model-surfaces/preview/M4-cost.png`（清单 `ModelSurfaces.board.json`，2026-11-07 拍板；元素 `cost.send-pill` / `cost.hover` / `cost.low-balance`）
- 实现：本目录 11 张真 Electron 窗口截图（1280×933，隔离资料，本机回环假 APIMart，`NOMI_TEST_NETWORK_GUARD=1`，0 个非 GET 请求），2026-11-23 由 `tests/ux/send-cost-currency-topup.walk.mjs` 在汇率改动后重拍（中文浅色、英文浅色、中文深色三轮全过）
- 对照图：[board-vs-impl-zh.png](board-vs-impl-zh.png)、[board-vs-impl-en.png](board-vs-impl-en.png)（左边是板的裁切，右边是同一状态的实现裁切；板只有中文一版，英文图左栏同样用中文板）

## 逐项对账

| # | 板上元素 | 中文实现 | 英文实现 | 结论 |
|---|---|---|---|---|
| 1 | ① 发送键与花费并成一颗胶囊：硬币图标 + 积分数 + 黑色圆形 ↑ | `zh-CN-credits.png`：硬币 + `约 1.95` + ↑ | `en-credits.png`：硬币 + `~1.95` + ↑ | 胶囊形状、硬币、圆钮、位置**没差别**。数字前多了「约」/`~`：协调要求换算出来的数在界面上一律标「约」，积分也是按公开价估的，不是实扣（`sendCostPillText` 唯一出口，`sendCostFormat.test.ts` 守）。英文用 `~`，因为英文界面习惯用 `~` 表示「约」，`≈` 留给汇率换算对（`$1 ≈ ¥6.712`）。数字不同（0.35 对 1.95）只是型号不同：板用 GPT Image 2.6 Flare 生图，走查用 Seedance 2.0 Mini 5 秒 720p 生视频 |
| 2 | ① 悬停说明「这次约 N 积分（$x）。按 APIMart 公开价估，出完按 APIMart 实际扣费记。」 | 积分单位下逐字一致（词典 `sendCost.estimate`，`COST_LABEL_EXACT` 逐字钉住）；截图里是**人民币**单位那句：`这次约 ¥1.31（约 1.95 积分）。` / `按人民银行中间价（2026-11-23，$1 ≈ ¥6.712）与 APIMart 公开价估，出完按 APIMart 实际扣费记。` | `About ¥1.31 (~1.95 credits) this time.` / `Converted at PBOC midpoint (2026-11-23, $1 ≈ ¥6.712) from the APIMart public rate; …` | 积分那句文字**没差别**。三处差别都有理由：①提示框的几何（离按钮距离、边框、圆角）用共用 `Tooltip`，是用户 2026-11-17 定的「用统一样式」；②按句换行是用户 2026-11-22 定的「都照这样」，板上的折行位置不算合同；③人民币那句是本 PR 新加的单位：写明汇率出处（人民银行中间价）、日期和换算对，开头标「约」 |
| 3 | （板上没有）单位切换菜单 | `zh-CN-unit-menu.png`：积分 `约 1.95` / 人民币 `约 ¥1.31` / 美元 `约 $0.195`，底部 `人民银行中间价（2026-11-23）：$1 ≈ ¥6.712` | `en-unit-menu.png`：Credits `~1.95` / CNY `~¥1.31` / USD `~$0.195`，底部 `PBOC midpoint (2026-11-23): $1 ≈ ¥6.712` | **板上没有这个元素**：是本 PR 新加的界面，用的是全站唯一的菜单组件 `WorkbenchMenu`，没有自己画外观。M4 和清单里都找不到对应的板，需要协调交用户补拍板，或确认按现状通过（见文末「待定」） |
| 4 | （板上没有）美元 / 人民币单位的胶囊 | `zh-CN-usd.png`：`约 $0.195`，没有硬币；人民币 `约 ¥1.31` 见第 2 行 | `en-usd.png`：`~$0.195`；人民币 `~¥1.31` | 板上没有，原因同第 3 行。硬币图标只在积分单位下出现：硬币表示积分，换成货币单位后由 `¥` / `$` 符号代替 |
| 5 | ② 余额不够：发送键的位置换成警示色「还差 7.6 积分」+ 黑色药丸「去充值 ↗」 | `zh-CN-low-balance.png`：`还差 7.6 积分` + `去充值 ↗`（同一行，发送键被替换）；深色 `zh-CN-low-balance-dark.png` | `en-low-balance.png`：`Short 7.6 credits` + `Top up ↗` | 文字、颜色层级、外链图标、位置**没差别**。型号芯片不同（板是 Seedance 2.5 16:9·720p·5 秒，实现是 Seedance 2.0·15s）：走查要凑出余额不够，所以把价格调高到 14.63 积分、余额设成 7.03。英文那行的型号芯片缩成 `Seedance 2…`：这是参数条按既定顺序让位（`composerBarYield`，G2–G6 门岗守），型号名先缩，不是溢出 |
| 6 | 工具条图标：文档 / 翻译 / N | 一致，另外多一个「参数」滑杆图标 | 一致，同样多一个滑杆图标 | 滑杆图标是 main 上 `InlineParameterBar` 已有的参数入口，不是本 PR 加的。本 PR 对 `InlineParameterBar.tsx` 只改了 1 行：量让位宽度时，把发送区认成整个约价组（`[data-send-cost-group]`） |
| 7 | ③ 批量确认卡、④ 来源详情 | — | — | 不在本 PR 范围：`cost.batch-card` 是 `dropped`，`cost.provenance` 和 `node.error-card` 是 `missing`，归 S3 |

## 汇率 $1 ≈ ¥? 从哪来（协调要求：只在一处、带出处和日期、界面上标「约」、供应商能给就别写死）

1. **供应商给不给**：不给。APIMart 公开价目 `GET https://api.apimart.ai/api/pricing/models/all`（不用 Key，2026-11-23 实测）一共 502 个价，`unit` 全是美元：`usd_per_million_tokens` 283 / `usd_per_1000_queries` 97 / `usd_per_second` 60 / `usd_per_image` 48 / `usd_per_call` 7 / `usd_per_million_token_hours` 6 / `usd_per_minute` 1。顶层只有 `discount_ratio`、`membership`、`models`，全量里 `CNY` / `RMB` / `¥` / `currency` / `exchange` 都是 0 次。余额接口 `GET /v1/balance` 只回 `remain_balance`（美元）和 `remain_credits`（1 美元 = 10 积分），解析器见 `electron/ai/onboarding/vendorAccountBalance.ts` 的 `parseVendorAccountBalance`。所以人民币只能按参考汇率折算，没法从供应商直接拿。
2. **原来的 7.25 不对**：中国外汇交易中心公布的 USD/CNY 中间价，2026-11-20 是 6.7131，2026-11-23 是 6.7120（`chinamoney.com.cn` 的 `ccpr.json` 实测：`"price":"6.7120"`、`"lastDate":"2026-11-23 9:15"`）。7.25 比实际高了约 8%，人民币约价会系统性地估高。原来也没写出处，只写了日期 `2026-11-22`。
3. **现在**：`src/workbench/generationCanvas/spend/sendCostFormat.ts` 里 `BUILTIN_USD_TO_CNY_RATE = 6.712`、`BUILTIN_USD_TO_CNY_DATE = '2026-11-23'`，注释写了出处网址（`https://www.chinamoney.com.cn/chinese/bkccpr/`）和为什么只能写死。界面上：菜单底部是「人民银行中间价（日期）：$1 ≈ ¥6.712」/`PBOC midpoint (date): $1 ≈ ¥6.712`；人民币悬停句写「按人民银行中间价（日期，换算对）」；胶囊和菜单里的人民币数一律带「约」/`~`。
4. **只有一处，由门岗守**：`sendCostFormat.test.ts` 新增「参考汇率全仓产品代码只有一份」，扫 `src/` 和 `electron/` 的全部产品文件。汇率类命名（`BUILTIN_USD_TO_CNY_*` / `usdToCny` / `cnyPerUsd` / `exchangeRate` / `fxRate`）和汇率那个数的字面值都只许出现在 `sendCostFormat.ts`。反例实测：往 `useSendCost.ts` 加 `usd * 6.712`，红；往 `electron/preload.ts` 加 `USD_TO_CNY = 7`，红；还原后全绿。走查脚本也不再抄数，汇率和日期都从 `sendCostFormat.ts` 读出来。
5. **刻意不并进来的**：`tests/ux/g1/*`、`tests/ux/pd1-*` 里的 `CNY_PER_USD = 7`，以及 `scripts/covers/cover-budget.mjs` 里的 `CNY_PER_USD_CEILING = 8`，都是付费测试的**预算上限**，故意取比真实汇率大的保守值，好让预算只会算多不会算少。它们不上界面，和这里的「显示约价」是两件事；要是合成一份，显示汇率一更新，预算护栏就跟着变松。所以它们留在 `tests/` 和 `scripts/` 自己那一份，门岗不扫这两个目录。

## 其它观察（不算差别，记一笔）

- 英文人民币悬停句较长，提示框右边延伸到 x≈1271（窗口宽 1280），没有截断，也没有句中断行（走查 `badBreaks` 断言为空）。改动前用 7.25 时的旧截图也一样，不是本次改出来的。

## 待定（交协调）

- 单位切换菜单和货币胶囊（第 3、4 行）在 `ModelSurfaces.board.json` 里没有对应元素，也没有拍板图。按设计流水线，新界面要先在 Claude Design 画布出稿、拍板后进清单。推荐：用现在这两张真截图（`zh-CN-unit-menu.png`、`en-unit-menu.png`）请用户补拍板，然后在清单里补 `cost.unit-switch` 元素；另一个选项是先收起这个菜单，等补齐板再放出来，代价是人民币 / 美元显示这次不能上线。
