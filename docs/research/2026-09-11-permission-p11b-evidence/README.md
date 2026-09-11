# P1.1b 证据包（2026-09-11）

付费确认卡「改完参数之后的那四件事」这一轮的**原始证据**。方案与裁决理由在
[`docs/plan/2026-09-11-permission-p1-implementation.md` § P1.1b](../../plan/2026-09-11-permission-p1-implementation.md)，
这里只放跑出来的东西，方便下一个人不重跑就能对账。

## R13 走查 · 三个时刻（`tests/ux/agent-spend-reprice.walk.mjs`，零额度）

| 截图 | 钉的是哪一拍 |
|---|---|
| `reprice-01-before-edit.png` | 改之前：画布节点 `1024x1024`、卡上 `CNY 0.30` |
| `reprice-02-price-follows-the-chip.png` | 改之后：卡上 `CNY 0.50`（价格行与主按钮同一个数），**画布节点仍是 `1024x1024`** |
| `reprice-03-written-back-on-generate.png` | 按下「生成」之后：画布节点才变成 `1536x1024` |

02 和 03 肉眼看几乎一样，这是**对的**：本轮改的是「什么时候写回画布」，写回的是节点 meta 里的尺寸，
不是卡的样子。卡一个像素没动，只有数字在动。

## 设计实验室 · 付费卡格

`design-lab-v4-spend-params-repriced.png`（`pnpm run design-lab:walk:v4` 的
`v4-spend-params-repriced` 格）：底栏是逐参数 chip（`parameterLayout='chips'`），
改完这一镜的时长，价格算式退成「逐镜不同」、合计与钮上的数同步。

## R30 两组数字

- `r30-loopback-report.json` —— 零额度 loopback 夹具档（进 CI 的那一档）
- `r30-deepseek-report.json` —— DeepSeek Chat 真实模型，第二轮
- `r30-deepseek-report-run1.json` —— DeepSeek Chat 真实模型，第一轮。**它没有 `toolRoutes` / `landed` 两个键**：
  那两个字段是看完轮一才加上去的。保留它是因为两个率是独立的第二次测量（同为 2/22），
  删掉就只剩一次采样；但它**说不出**模型走了哪条工具路线，别从它身上引一个工具数字出来

每份报告里的 `r30.toolRoutes` 是模型**实际按了哪些工具**的普查，从宿主自己的转录里数。
两个率说「没写对」时，它分得出「模型没动手」和「模型动了手、但走的是另一条路」——
这两件事的处置完全相反。数字与读法见方案文档的「R30 两组数字」一节。
