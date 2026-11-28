# Seedream 5.5 · APIMart 能力表

- archetype: seedream-5-5
- vendor: apimart
- 文档：https://docs.apimart.ai/en/api-reference/images/seedream-5-5/generation.md（2026-11-12 取；图层分离几行 2026-11-26 取）
- 格式说明见 [README](./README.md)。

| 项 | 文档原文 | 去处 | 落点 / 原因 |
| - | - | - | - |
| 方式：文生图 | `Required for text-to-image and image-to-image.` | 露出 | `mode:t2i` `prompt:t2i=required` |
| 方式：改图 / 参考融合 | `Up to 10 references for image generation; exactly 1 input for layer decomposition.` | 露出 | `mode:edit` `slot:edit/image_ref:10:image_urls` `prompt:edit=required` |
| 比例 | `Supported ratios: 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9, 2:1, 1:2.` | 露出 | `param:t2i+edit/size=1:1,4:3,3:4,16:9,9:16,3:2,2:3,21:9,2:1,1:2@1:1` |
| 清晰度 1K / 1.5K / 2K | `For image generation, use 1K / 1.5K / 2K with an aspect-ratio size. 3K / 4K are unsupported.` / `An aspect-ratio size without resolution also uses 2K.` | 露出 | `param:t2i+edit/resolution=1K,1.5K,2K@2K` |
| 背景 auto / transparent / opaque | `Image generation supports auto (default), transparent, or opaque. Both text-to-image and image-to-image can produce transparency.` | 露出 | `param:t2i+edit/background=auto,transparent,opaque@auto` `absent:layers/background`（图层分离：`Omit this field entirely for layer decomposition, including auto.`） |
| 透明背景必须 png | `Transparent output requires PNG and cannot use output_format: "jpeg".` | 露出 | `constrain:t2i+edit/output_format:background=transparent=>png` |
| 输出格式 png / jpeg | `output_format (default: png): png (default) or jpeg.` | 露出 | `param:t2i+edit/output_format=png,jpeg@png` `absent:layers/output_format`（图层分离不发，走上游默认） |
| 水印 | `watermark: Optional flag to add a watermark.` | 露出 | `param:t2i+edit/watermark=bool@false` `absent:layers/watermark`（图层分离不发 = 文档默认不加） |
| 提交前内容审核 | `nsfw_check: Whether to run content moderation before submitting the image task. false or omitted: do not send a moderation request, adding no moderation cost or latency (default)` | 露出 | `param:t2i+edit/nsfw_check=bool@false` `absent:layers/nsfw_check`（图层分离不发 = 文档默认不审核） |
| 张数 n | `n: Must be 1. Image generation produces one image per request` | 不露出 | `absent:n` `reason:模型无效`（文档明写必须为 1，只有一个合法值） |
| 提示词优化 | `Only {"mode":"standard"} is supported ... prompt optimization cannot be disabled in Seedream 5.5.` | 不露出 | `absent:optimize_prompt_options` `reason:模型无效`（文档明写只支持 standard 且关不掉，只有一个合法值） |
| 档位关键词写进 size | `Tier: "size": "2K": 1K / 1.5K / 2K; image generation defaults to 2K` | 不露出 | `reason:同一件事`（resolution 控件） |
| model | `model (required)` | 不露出 | `reason:管道` |
| size: auto | `For image generation, size: "auto" means 2K.` | 待定 | `pending:官方说 auto 等于 2K，会和单独选的清晰度打架，文档没写两者同时出现时谁生效，不猜` |
| 精确像素 size | `Exact pixels: "size": "2048x1152": total pixels must be 921,600–4,624,220 and width/height must be 1/16–16.` | 待定 | `pending:要一个宽高输入控件，属于新控件` |
| 方式：图层分离 layer_decomposition | `Set to true to separate the input into a base image and transparent layers. Requires exactly one input image and no background field.` / `Optional for layer decomposition: the model identifies subjects, text, and backgrounds automatically` | 露出 | `mode:layers` `slot:layers/image_ref:1:image_urls` `prompt:layers=optional` `fixed:layers/layer_decomposition=true`（结果：url[0] 底图 + 与 layers[] 按下标平行的透明图层，落成画板里的一组层） |
| 拆成几层 layer_decomposition_options.max_images | `max_images: Integer 2–100, default 30.` / `The maximum total number of output images, including the base image, not a guaranteed output count.` | 露出 | `param:layers/layer_count=2..100@30`（含底图，是上限） |
| 识别文字 layer_decomposition_options.text_recognition | `Optional boolean. Set to true to request rich-text OCR for text layers.` | 露出 | `param:layers/text_recognition=bool@false` |
| 图层分离清晰度（size 档位） | `Layer decomposition defaults to auto and accepts only 1K / 1.5K / 2K / auto` / `With 1K / 1.5K / 2K, the base and every layer are output at the selected tier, each preserving its own aspect ratio.` | 露出 | `param:layers/layer_size=auto,1K,1.5K,2K@auto`（存在 layer_size，线缆写成 size；比例值不进分层请求） |
