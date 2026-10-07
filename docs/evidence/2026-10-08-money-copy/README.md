# 花钱文案走查证据

本目录保存本轮无界面 Electron 走查实际读过的截图。

| 位置 | zh | en | 状态 |
|---|---|---|---|
| 付费卡 / 价格未知 | [after-unknown-price-card-zh.png](after-unknown-price-card-zh.png) | [after-unknown-price-card-en.png](after-unknown-price-card-en.png) | 已跑；卡面显示未知价格，不出现零额 |
| 付费卡 / 确认后 | [after-unknown-price-confirmed-zh.png](after-unknown-price-confirmed-zh.png) | — | 已跑；确认后仍保留真实生成路径 |
| 任务中心 | — | — | unverified：本轮走查在任务中心截图前挂起，未把旧图当证据 |
| 制作详情 | — | — | unverified：本轮未能在同一条真实任务闭环中截到该面板 |

截图来自 `tests/ux/agent-spend-unknown-price.walk.mjs`，报告中的 `paidCalls: 0`、`result: passed` 与截图一并保存。没有真实截到的页面明确标为 `unverified`。
