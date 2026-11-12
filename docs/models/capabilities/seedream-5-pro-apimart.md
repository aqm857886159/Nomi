# Seedream 5.0 Pro · APIMart 能力表

- archetype: seedream-5-pro
- vendor: apimart
- 文档：https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md（2026-11-12 取）
- 格式说明见 [README](./README.md)；这个档案与 Runway 共用，表只对 APIMart 那一层（`vendorParams.apimart`）。

| 项 | 文档原文 | 去处 | 落点 / 原因 |
| - | - | - | - |
| 方式：文生图 | `Text-to-image (tier + ratio)` | 露出 | `mode:t2i` `prompt:t2i=required` |
| 方式：改图 / 多图参考 | `Reference image URL list for single / multi-reference image-to-image, up to 10` | 露出 | `mode:edit` `slot:edit/image_ref:10:image_urls` `prompt:edit=required` |
| 比例（含 2:1 / 1:2 / auto） | `Supported ratios: 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 2:1, 1:2, 21:9` / `auto (default): only the resolution tier is applied` | 露出 | `param:*/size=1:1,4:3,3:4,16:9,9:16,3:2,2:3,21:9,2:1,1:2,auto@1:1`（默认取 1:1：既有取舍，文档默认 auto） |
| 清晰度 1K / 1.5K / 2K | `1K (default); 1.5K (same price as 1K, better quality — prefer 1.5K unless you have a reason not to); 2K. Unsupported tiers such as 3K / 4K return 400.` | 露出 | `param:*/resolution=1K,1.5K,2K@2K`（默认取 2K：既有取舍，文档默认 1K、推荐 1.5K） |
| 输出格式 jpeg / png | `Output image format: jpeg (default), png` | 露出 | `param:*/output_format=jpeg,png@jpeg` |
| 背景 opaque / transparent（只在改图） | `opaque: solid background (default); transparent: transparent background. transparent is available only for image-to-image requests with exactly one input image that already has an alpha channel; output_format: "png" is also required.` | 露出 | `param:edit/background=opaque,transparent@opaque` `absent:t2i/background` |
| 透明背景必须 png | `output_format: "png" is also required.` | 露出 | `constrain:edit/output_format:background=transparent=>png` |
| 水印 | `watermark: Whether to add an "AI generated" watermark at the bottom-right` | 露出 | `param:*/watermark=bool@false` |
| 提交前内容审核 | `nsfw_check: Whether to run content moderation before submitting the image task.` | 露出 | `param:*/nsfw_check=bool@false` |
| 张数 n | `n: Number of images to generate. Only 1 is supported` | 不露出 | `absent:n` `reason:模型无效`（文档明写只支持 1，只有一个合法值） |
| 提示词优化 | `optimize_prompt_options: standard: standard mode with better quality (default)` | 不露出 | `absent:optimize_prompt_options` `reason:模型无效`（文档明写只有 standard 一档，只有一个合法值） |
| 档位关键词写进 size | `The tier can be placed directly in size, or supplied through the API Mart extension field resolution ... These forms are equivalent.` | 不露出 | `reason:同一件事`（resolution 控件） |
| 输出格式别名 response_format | `response_format is equivalent to output_format` | 不露出 | `absent:response_format` `reason:同一件事` |
| model | `seedream-5-0-pro (recommended); Also accepted: seedream-5.0-pro` | 不露出 | `reason:管道` |
| 精确像素 size | `Style ③: exact pixels: When size is widthxheight, pixels are used as-is and resolution does not apply.` | 待定 | `pending:要一个宽高输入控件（目前只有选项和单个数字），属于新控件；比例 + 清晰度已经覆盖常用档` |
| 图层分解 layer_decomposition | `layer_decomposition: When enabled, the model returns one base image and up to 16 PNG layers with alpha channels.` | 待定 | `pending:结果不是单图（底图 + 多张透明图层），需要新的结果形状和展示` |
