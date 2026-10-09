# 花钱文案走查证据

本目录保存本轮无界面 Electron 走查实际读过的截图。

| 位置 | zh | en | 状态 |
|---|---|---|---|
| 付费卡 / 价格未知 | [after-unknown-price-card-zh.png](after-unknown-price-card-zh.png) | [after-unknown-price-card-en.png](after-unknown-price-card-en.png) | 已跑；卡面显示未知价格，不出现零额 |
| 付费卡 / 确认后 | [after-unknown-price-confirmed-zh.png](after-unknown-price-confirmed-zh.png) | — | 已跑；确认后仍保留真实生成路径 |
| 任务中心 | — | — | unverified：本轮走查在任务中心截图前挂起，未把旧图当证据 |
| 制作详情 | — | — | unverified：本轮未能在同一条真实任务闭环中截到该面板 |

截图来自 `tests/ux/agent-spend-unknown-price.walk.mjs`，报告中的 `paidCalls: 0`、`result: passed` 与截图一并保存。没有真实截到的页面明确标为 `unverified`。

## 第 8 轮：供应商卡片跟随界面语言

截图来自 `tests/ux/vendor-card-locale.walk.mjs`（真 Electron、隔离资料目录、窗口在屏幕外、主进程装测试网闸，凭证是夹具串）。每家两张：卡片上半（凭证说明 / 占位）与滚到底的推广文字和按钮。英文轨断言卡片与页头无一个汉字；两轨都断言合同语义在卡上。

| 供应商 | zh | en |
|---|---|---|
| Replicate | [上](zh-replicate.png) · [推广](zh-replicate-promo.png) | [上](en-replicate.png) · [推广](en-replicate-promo.png) |
| Runway | [上](zh-runway.png) · [推广](zh-runway-promo.png) | [上](en-runway.png) · [推广](en-runway-promo.png) |
| RunningHub | [上](zh-runninghub.png) · [推广](zh-runninghub-promo.png) | [上](en-runninghub.png) · [推广](en-runninghub-promo.png) |
| 豆包语音 | [上](zh-volcengine-speech.png) · [推广](zh-volcengine-speech-promo.png) | [上](en-volcengine-speech.png) · [推广](en-volcengine-speech-promo.png) |

Replicate 卡上的「连不上」是测试网闸拦下了面板健康检查（没有出网），不是本次改动的结果。402 / 额度 / 429 三类报错以字符串测试为证据（`classifyGenerationError.test.ts`），本目录不放截图。
