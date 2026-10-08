# 付费卡底栏尺寸 chip

- `paid-card-bottom-zh.png`：中文界面，付费卡底栏在模型 chip 旁边单独显示像素尺寸「1536×1024」，点了能改，花钱前能逐项核对。
- `paid-card-bottom-en.png`：英文界面，同一位置显示「1024×1024」。

来源：`tests/ux/agent-spend-card.walk.mjs` 本地真跑（回环夹具，零真实花费）的截图，裁到底栏。价格是夹具报价，不是真实价格。

## 报价 chip 换行（2026-10-08，F-spendwalks6）

- `paid-card-seedance-390-zh.png` / `paid-card-seedance-390-en.png`：Seedance 2.0（带变体 chip）在生产面板宽 390 下，模型 / 变体 / 比例一行放不下，时长、清晰度整颗换到第二行；没有相压、没有横向滚动、报价参数一颗都没进 ⚙。
- `paid-card-seedance-300-zh.png` / `paid-card-seedance-300-en.png`：面板压窄到 300，同一张卡换成两到三行，每颗 chip 都整颗在卡里。

来源：设计实验室 `v4-panel-spend-seedance*` 四格（生产组件 + 生产投影 `projectSpendCard`），`tests/ux/design-lab-ask-card-in-panel.walk.mjs` 无头 Chromium 截图，裁到卡。英文 300 那张底部主按钮贴右缘被裁，是动作行的事，不在参数行这次改动内。
