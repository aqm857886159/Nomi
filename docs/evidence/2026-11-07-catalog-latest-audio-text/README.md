# APIMart 音频新型号：真付费抽检（2026-11-07）

- 走查：`tests/ux/catalog-latest-real.paid.mjs`，样本表在 `tests/ux/catalogLatestSamples.ts`。
- 构建：本分支开发构建。
- 隔离：用户资料的隔离副本，只授权样本型号，出网只放行 APIMart。
- 规矩：每条样本只提交一次，失败就停，不自动重试。已在有记录的一轮里成功的样本，下一轮用 `NOMI_CATALOG_LATEST_FROM` 跳过，不重复付费。
- 判据：每条都走付费确认框 → 提交 → 按任务号查到 `succeeded` 才算过。

## 结果

| 样本 | 结果 | 说明 |
|---|---|---|
| Suno V6 Mini（`suno-v6-mini`） | 成功 | 共下单 3 次：第 1 次查结果时脚本读错回执、没取回（已修，`8fdf615cb`）；第 2、3 次成功 |
| Suno Sounds V6 Mini（`suno-sounds-v6-mini`） | 成功 | |
| Lyria 3.5（`flowmusic-lyria-3.5`） | 成功 | |
| Suno V5.5（`suno-v5.5`） | 上游拒单，没扣钱 | HTTP 400「Suno 旧版本 "v5.5" 已下线，请将 version 改为 v6、v6-wild 或 v6-mini。」本 PR 去掉这条样本，退役另开 PR |
| 配音（`nomi-audio`，speech） | 请求发出、扣了钱，存盘失败 | 第 1 次：脚本没带项目号（已修，`199b99ae5`）。第 2 次：落盘关口拒（`generated_output_expected_kind_required`），这是 main 自 10-17 起就有的问题，和本 PR 无关，单独修复后再验 |
| 10 个文字大脑 | 未验证 | 走任务通道第一条就被花钱授权拦下。创作者用文字模型走的是 Agent，不走这条通道，所以从本脚本删掉，改在 Agent 大脑选择那一片从真实 Agent 界面各发一句来验 |

截图在 `paid/`（三条成功样本各一张，都是那一刻的窗口）。

## 花了多少（按 APIMart 公开价估，以账单为准）

| 项 | 单价 | 次数 | 小计 |
|---|---|---|---|
| Suno V6 Mini 音乐 | $0.05 | 3 | $0.15 |
| Suno Sounds V6 Mini | $0.0096 | 1 | ≈ $0.01 |
| Lyria 3.5 生成 | $0.06 | 1 | $0.06 |
| 配音一句（gpt-4o-mini-tts 按 token） | 不到 $0.01 | 2 | < $0.01 |
| 合计 | | | **约 $0.23** |

价格来源：`GET https://api.apimart.ai/api/pricing/model?model=suno` / `flowmusic` / `gpt-4o-mini-tts` 的 `*_paid_prices`，2026-11-07 查。
