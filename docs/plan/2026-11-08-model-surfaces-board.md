# 模型账户、选择器与费用设计合同

## 短版设计卡

- ★1 创作者可以对照账户卡、画布选模型、费用提示、Agent 大脑和上线提示的设计原图。以十八张画布截图、源文件和可重复抽取的候选清单核对号码及状态。
- ★2 设计来源是 ModelSurfaces 画布。2026-11-07 确认 r5d 后，项目库背景的小人胶囊随板 1 的决定移除，设置顶栏同步目录计数。十八张图采用后续 r8 导出，板 2 与 r7 的 PNG 字节相同。
- ★3 复用仓库的 board-extract 和 check:board-parity，元素归属以画板上实际出现的文本、控件和图标为准。
- ★4 本次仅登记设计。画板上的余额、时间、单价与可选示例由后续各切片读取生产事实。更换 Key 留待下一轮设计。
- ★9 校验全部十八份画板源和图片与交付源一致，实际重抽和缺失、重复候选检查均通过。当前产品切片的元素保留 missing。引导板的 r8 最终确认单独跟踪。

## 实现归属

| 切片 | 范围 |
|---|---|
| S1、S1b | 账户卡、旧连接、用量详情 |
| S2、S2b | 画布模型选择器和参数 |
| S3 | 发送旁估价、余额不足、批量授权与实扣来源 |
| S4 | Agent 大脑、推理档位和策略 |
| S5 | 新模型上线提示 |
| D2-2 | 素材上传与高级中转设置 |

[模型板元素清单](../design/boards/2026-11-07-model-surfaces/ModelSurfaces.board.json) · [完整预览](../design/boards/2026-11-07-model-surfaces/preview/ModelSurfaces.html)

## 设计原图

- 账户。[Main](../design/boards/2026-11-07-model-surfaces/preview/Main.png) · [M1-dark](../design/boards/2026-11-07-model-surfaces/preview/M1-dark.png) · [M1-en](../design/boards/2026-11-07-model-surfaces/preview/M1-en.png) · [M1-narrow](../design/boards/2026-11-07-model-surfaces/preview/M1-narrow.png) · [M1-ladder](../design/boards/2026-11-07-model-surfaces/preview/M1-ladder.png) · [M1-old-user](../design/boards/2026-11-07-model-surfaces/preview/M1-old-user.png) · [M1-usage](../design/boards/2026-11-07-model-surfaces/preview/M1-usage.png)
- 画布模型。[M2-image](../design/boards/2026-11-07-model-surfaces/preview/M2-image.png) · [M2-video-dark](../design/boards/2026-11-07-model-surfaces/preview/M2-video-dark.png) · [M2-image-en](../design/boards/2026-11-07-model-surfaces/preview/M2-image-en.png) · [M2-old-node](../design/boards/2026-11-07-model-surfaces/preview/M2-old-node.png) · [M2-ladder](../design/boards/2026-11-07-model-surfaces/preview/M2-ladder.png)
- 报价、Agent、上线卡。[M4-cost](../design/boards/2026-11-07-model-surfaces/preview/M4-cost.png) · [M6-ai-policy](../design/boards/2026-11-07-model-surfaces/preview/M6-ai-policy.png) · [M5-brain](../design/boards/2026-11-07-model-surfaces/preview/M5-brain.png) · [M7-launch](../design/boards/2026-11-07-model-surfaces/preview/M7-launch.png) · [M7-launch-dark](../design/boards/2026-11-07-model-surfaces/preview/M7-launch-dark.png) · [M7-launch-en](../design/boards/2026-11-07-model-surfaces/preview/M7-launch-en.png)
