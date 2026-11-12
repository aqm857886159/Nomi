# Seedream 5.5 · APIMart 能力表

- archetype: seedream-5-5
- vendor: apimart
- 文档：https://docs.apimart.ai/en/api-reference/images/seedream-5-5/generation.md（2026-11-12 取）
- 格式说明见 [README](./README.md)。

| 项 | 文档原文 | 去处 | 落点 / 原因 |
| - | - | - | - |
| 方式：文生图 | `Required for text-to-image and image-to-image.` | 露出 | `mode:t2i` `prompt:t2i=required` |
| 方式：改图 / 参考融合 | `Up to 10 references for image generation; exactly 1 input for layer decomposition.` | 露出 | `mode:edit` `slot:edit/image_ref:10:image_urls` `prompt:edit=required` |
| 比例 | `Supported ratios: 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9, 2:1, 1:2.` | 露出 | `param:*/size=1:1,4:3,3:4,16:9,9:16,3:2,2:3,21:9,2:1,1:2@1:1` |
| 清晰度 1K / 1.5K / 2K | `For image generation, use 1K / 1.5K / 2K with an aspect-ratio size. 3K / 4K are unsupported.` / `An aspect-ratio size without resolution also uses 2K.` | 露出 | `param:*/resolution=1K,1.5K,2K@2K` |
| 背景 auto / transparent / opaque | `Image generation supports auto (default), transparent, or opaque. Both text-to-image and image-to-image can produce transparency.` | 露出 | `param:*/background=auto,transparent,opaque@auto` |
| 透明背景必须 png | `Transparent output requires PNG and cannot use output_format: "jpeg".` | 露出 | `constrain:*/output_format:background=transparent=>png` |
| 输出格式 png / jpeg | `output_format (default: png): png (default) or jpeg.` | 露出 | `param:*/output_format=png,jpeg@png` |
| 水印 | `watermark: Optional flag to add a watermark.` | 露出 | `param:*/watermark=bool@false` |
| 提交前内容审核 | `nsfw_check: Whether to run content moderation before submitting the image task.` | 露出 | `param:*/nsfw_check=bool@false` |
| 张数 n | `n: Must be 1. Image generation produces one image per request` | 不露出 | `absent:n` `reason:模型无效`（文档明写必须为 1，只有一个合法值） |
| 提示词优化 | `Only {"mode":"standard"} is supported ... prompt optimization cannot be disabled in Seedream 5.5.` | 不露出 | `absent:optimize_prompt_options` `reason:模型无效`（文档明写只支持 standard 且关不掉，只有一个合法值） |
| 档位关键词写进 size | `Tier: "size": "2K": 1K / 1.5K / 2K; image generation defaults to 2K` | 不露出 | `reason:同一件事`（resolution 控件） |
| model | `model (required)` | 不露出 | `reason:管道` |
| size: auto | `For image generation, size: "auto" means 2K.` | 待定 | `pending:官方说 auto 等于 2K，会和单独选的清晰度打架，文档没写两者同时出现时谁生效，不猜` |
| 精确像素 size | `Exact pixels: "size": "2048x1152": total pixels must be 921,600–4,624,220 and width/height must be 1/16–16.` | 待定 | `pending:要一个宽高输入控件，属于新控件` |
| 图层分解 layer_decomposition | `Set to true to separate the input into a base image and transparent layers. Requires exactly one input image and no background field.` | 待定 | `pending:结果不是单图（底图 + 最多 100 张透明图层），需要新的结果形状和展示` |
| 图层分解选项 max_images / text_recognition | `max_images: Integer 2–100, default 30. text_recognition: Optional boolean ... rich-text OCR for text layers.` | 待定 | `pending:只在图层分解里有意义，跟随图层分解` |
