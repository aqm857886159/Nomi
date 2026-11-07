# APIMart 图片 / 视频新型号：真窗口零花费演练（2026-11-07）

- 走查：`tests/ux/catalog-media-rest-real.paid.mjs`，带 `NOMI_MEDIA_REST_FREE_ONLY=1`，在点「生成」之前停下，不发生成请求。
- 构建：本分支开发构建，HEAD `dcffccd4a`。
- 隔离：
  - 用户资料的隔离副本；
  - 只授权 Agent 大脑和这次要测的那一个型号，其余型号全部关掉（图片那次关了 167 个，视频那次关了 168 个）；
  - 出网只放行 APIMart。
- 路径：新建项目 → 生成画布 → 加图片 / 视频节点 → 打开型号菜单 → 选型号 → 写一句提示词 → 停在生成前。

| 型号 | 节点 | 菜单里显示 | 默认参数 | 结果 | 付费次数 |
|---|---|---|---|---|---|
| `gpt-image-2.6-flare` | 图片 | GPT Image 2.6 Flare · APIMart | 自动 · 1K | passed | 0 |
| `pixverse-v6` | 视频 | PixVerse V6 | 16:9 · 540p · 5s | passed | 0 |

截图在 `free-rehearsal/`，协调亲眼看过：
- `image-gpt-image-2.6-flare-01-model-menu.png`、`image-gpt-image-2.6-flare-02-before-generate.png`；
- `video-pixverse-v6-01-model-menu.png`、`video-pixverse-v6-02-before-generate.png`。

## 演练里修的走查问题（只改走查，不改生产代码）

1. 授权名单原来只放 Agent 大脑，隔离副本里样本型号被关掉，下拉里选不到 → 名单加上要测的那个型号（`f232c0042`）。
2. 内置型号在下拉里显示的是显示名（「GPT Image 2.6 Flare」），走查按内部编号精确找 → 改成编号或显示名任一完全一致（`dcffccd4a`）。

## 没验证的

- 真付费：由协调先跑最便宜的一条看实际花费，再定其余。
- Windows、打包版没跑。
