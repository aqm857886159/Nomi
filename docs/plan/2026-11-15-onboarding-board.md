# APIMart 接入引导设计合同

## 短版设计卡

- ★1 创作者可以对照 27 张引导设计原图（项目库首屏主卡、整窗大页中 / 英 / 窄窗 / 暗色、等待、粘贴后检查、充值、六种出错、入口、老用户），核对每个元素的实现状态。量具：`pnpm run check:board-parity` 对 1367 个候选逐个核认领，27 张图的 sha256 记在清单 `artboardFiles`。
- ★2 设计来源是引导画布 r8（11-08 减字版）。用户 2026-11-07 说「没啥问题 我觉得可以 自己全部推进吧」，2026-11-15 看了 r8 的五张图后说「可以，照这版做」。
- ★3 复用仓库的 `board-extract` 和 `check:board-parity`，格式照 `2026-11-07-model-surfaces` 登记；元素归属以画板上实际出现的文本、控件和图标为准，探索对照图（O2-ladder、O2-copy、O2-copy-en、O2-motion）不是实现合同。
- ★4 本次只登记设计，产品代码一行不改；44 个元素状态都是 `missing`，由后续各切片翻状态。画板上的余额、花费、模型数、时间是示意数，实现时按清单 `constraints` 和 `unverified` 从真数据现算。
- ★9 验收：`check:board-parity` 和 `gates:contracts` 通过；清单里每张出图的 sha256 与文件一致；删掉清单里一张出图的登记、改错一个 sha256、清空 `approval`，各自按下面「反例」红。

## 实现归属

| 切片 | 范围 |
|---|---|
| E0 | 把「连接模型」收成一扇门（入口路由，`big.entry-routing`） |
| S7a | 入口指路：生成框、项目库提示条、形象胶囊、Agent 指路卡、选择器空态、统一说法 |
| S7b | 首屏主卡、删开屏、收尾卡、整窗大页（出发页）、老用户不出主卡的判定 |
| S6 | 回来与检查：Key 块（粘贴即存）、等待、四项检查、自动回原稿、充值、六种出错 |

[引导板元素清单](../design/boards/2026-11-07-onboarding/Onboarding.board.json) · [完整预览](../design/boards/2026-11-07-onboarding/preview/Onboarding.html)

## 设计原图

- 项目库首屏与老用户。[O0-library](../design/boards/2026-11-07-onboarding/preview/O0-library.png) · [O0-library-en](../design/boards/2026-11-07-onboarding/preview/O0-library-en.png) · [O0-library-dark](../design/boards/2026-11-07-onboarding/preview/O0-library-dark.png) · [O0-library-narrow](../design/boards/2026-11-07-onboarding/preview/O0-library-narrow.png) · [O0-old-user](../design/boards/2026-11-07-onboarding/preview/O0-old-user.png) · [O0-old-user-empty](../design/boards/2026-11-07-onboarding/preview/O0-old-user-empty.png) · [O0-finale](../design/boards/2026-11-07-onboarding/preview/O0-finale.png)
- 入口。[O1a-canvas](../design/boards/2026-11-07-onboarding/preview/O1a-canvas.png) · [O1b-library](../design/boards/2026-11-07-onboarding/preview/O1b-library.png) · [O1c-agent](../design/boards/2026-11-07-onboarding/preview/O1c-agent.png)
- 大页。[Main](../design/boards/2026-11-07-onboarding/preview/Main.png) · [O2-dark](../design/boards/2026-11-07-onboarding/preview/O2-dark.png) · [O2-en](../design/boards/2026-11-07-onboarding/preview/O2-en.png) · [O2-narrow](../design/boards/2026-11-07-onboarding/preview/O2-narrow.png)
- 等待、检查、回来、充值、出错。[O3-waiting](../design/boards/2026-11-07-onboarding/preview/O3-waiting.png) · [O4a-check](../design/boards/2026-11-07-onboarding/preview/O4a-check.png) · [O4a-dark](../design/boards/2026-11-07-onboarding/preview/O4a-dark.png) · [O4a-en](../design/boards/2026-11-07-onboarding/preview/O4a-en.png) · [O4b-back](../design/boards/2026-11-07-onboarding/preview/O4b-back.png) · [O5-topup](../design/boards/2026-11-07-onboarding/preview/O5-topup.png) · [O6-errors](../design/boards/2026-11-07-onboarding/preview/O6-errors.png) · [O6-errors-en](../design/boards/2026-11-07-onboarding/preview/O6-errors-en.png) · [O6-errors-dark](../design/boards/2026-11-07-onboarding/preview/O6-errors-dark.png)
- 探索对照（不是实现合同）。[O2-ladder](../design/boards/2026-11-07-onboarding/preview/O2-ladder.png) · [O2-copy](../design/boards/2026-11-07-onboarding/preview/O2-copy.png) · [O2-copy-en](../design/boards/2026-11-07-onboarding/preview/O2-copy-en.png) · [O2-motion](../design/boards/2026-11-07-onboarding/preview/O2-motion.png)
