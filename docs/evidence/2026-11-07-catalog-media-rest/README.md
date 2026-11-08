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

## 真付费抽检（2026-11-08，第二轮「按官方文档对齐」之后）

- 构建：本分支开发构建，HEAD `3b9589aa5`；产物带修复标记（Ext `(Scenario 3`、Grok `Do not add this header while continuing`），没有就拒跑。
- 隔离同上；每条先跑零花费演练（`NOMI_MEDIA_REST_FREE_ONLY=1`，付费 0 次），过了再真跑一次，不重试。
- 路径：画布真窗口，和真人顺序一样，先放参考再挑型号、点生成、等落地。

| 型号 | 方式 | 参数 | 结果 | 付费次数 | 预计花费（APIMart 公开价） |
|---|---|---|---|---|---|
| `gemini-omni-1.2-flash-ext` | 首尾帧（首帧、尾帧两格都放上） | 16:9 · 720p · 10s | passed：任务 `task_01M6VH6TD7N7SJZN0C201E1Y2J` 成功，10.03 秒成片落进项目和素材库 | 1 | ≈ $0.24 |
| `grok-imagine-image-2.0` | 文生图 | 自动 · 1K | passed：任务 `task_01M6VHCWWVJR37HPSZYBSMR5AW` 成功；不带 `X-APIMart-Response-Version` 头提交被接受，按 `data[0].task_id` 取到任务号，图落进项目 | 1 | ≈ $0.048 |

- 供应商没回实际扣费（`providerCost: null`），花费按公开价估，以 APIMart 账单为准。
- 截图在 `paid-20261108/`，协调亲眼看过：`ext-firstlast-references-before-generate.png`（点生成前两格都在）、`ext-firstlast-landed.png`、`grok-image-landed.png`。
- `viduq4-preview` 参考生没跑：请求体双键（`image_urls` 和 `image_with_roles` 同时在），当时真付费拒跑。11-08 已修，画布与 Agent 的 Mac 真窗回环走查各见一次角色数组且无第二个参考键。付费抽检已恢复可执行，真实供应商样本另计。

## 没验证的

- Vidu Q4 单图参考的真付费（双键，见上）。
- Windows、打包版没跑。
