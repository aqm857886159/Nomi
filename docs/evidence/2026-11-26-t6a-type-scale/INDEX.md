# 设置 › 模型：字号 / 间距并排图索引（#1665，D-1126-1665-type-scale）

并排图左边是拍板图预览，右边是真截图，两边都按 1 CSS 像素 = 1 像素原样放，不缩放。提交号都是本提交（本目录首次进入的那个提交，`git log -- docs/evidence/2026-11-26-t6a-type-scale`）。

| 元素 | 状态 | 文件 | 提交号 |
|---|---|---|---|
| 首页两行入口（同一套行结构、带描边图标块）、页头标题、副标题、账户卡名、Key 行、三格标签与数字、「接别家的模型」、AI 行与「其他接入方式」标题和副标题 | 中文浅色，已连接 | sbs-zh-light.png | 本提交 |
| 同上 | 英文暗色，已连接（板上没有英文暗色，左边用英文浅色 M1-en 对照；真截图用 fake-apimart 夹具，余额读不到所以显示 Unavailable，字号不受影响） | sbs-en-dark.png | 本提交 |
| 同上 | 中文暗色，已连接 | sbs-zh-dark.png | 本提交 |
| 「用 AI 帮我接入」展开态：分段控件、状态行、复制指引（板上没画展开态，没有左边） | 英文暗色，展开 | real-en-dark-expanded.png | 本提交 |
| 账户卡与 AI 行 | 英文浅色，已连接 | real-en-light.png | 本提交 |

量值断言在 `tests/ux/t6a-model-settings.walk.mjs`（`expectFontSizes`），展开态间距断言在同一文件的 `rhythm` 一段。
