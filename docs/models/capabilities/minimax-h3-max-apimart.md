# MiniMax H3-Max · APIMart 能力表

- archetype: minimax-h3-max
- vendor: apimart
- 文档：https://docs.apimart.ai/en/api-reference/videos/minimax-h3/max.md（2026-11-12 取）
- 格式说明见 [README](./README.md)；这个档案与 fal 共用，表只对 APIMart 那一层（`vendorParams.apimart`）。

| 项 | 文档原文 | 去处 | 落点 / 原因 |
| - | - | - | - |
| 方式：文生视频 | `Text-to-video (T2V): Only prompt and common fields: Generates from text` | 露出 | `mode:t2v` `prompt:t2v=required` |
| 方式：首尾帧（图生） | `Image-to-video (I2V): first_frame_image / last_frame_image ...: Controls the first frame, last frame, or both` | 露出 | `mode:i2v` `prompt:i2v=required` |
| 首帧 | `first_frame_image: Public image URL used as the video's first frame.` | 露出 | `slot:i2v/first_frame:1:first_frame_image` |
| 尾帧（可单独用） | `last_frame_image: Public image URL used as the video's last frame. It can be used alone or together with first_frame_image.` | 露出 | `slot:i2v/last_frame:1:last_frame_image` |
| 方式：多模态参考 | `Multimodal references (R2V): image_urls / video_urls / audio_urls ...: Generates using reference images, videos, and audio; also supported at 1080P` | 露出 | `mode:ref` `prompt:ref=required` |
| 参考图 ≤9 | `Together with reference images in image_with_roles, at most 9 images.` | 露出 | `slot:ref/image_ref:9:image_urls` |
| 参考视频 ≤3（每段 2–15 秒，合计 ≤15 秒） | `At most 3 clips, each 2–15 seconds, with a combined reference-video duration of at most 15 seconds.` | 露出 | `slot:ref/video_ref:3:video_urls` |
| 参考音频 ≤3（须配图或视频） | `At most 3 clips, each 2–15 seconds ... Must accompany at least one reference image or video; audio alone is not supported.` | 露出 | `slot:ref/audio_ref:3:audio_urls` |
| 首尾帧与参考互斥 | `First/last-frame fields cannot be combined with reference media.` | 露出 | `mode:i2v` `mode:ref`（两个独立方式，槽互不相通） |
| 时长 5–15 | `Integer from 5 to 15; Default: 5; 4 seconds is not supported` | 露出 | `param:t2v+i2v+ref/duration=5..15@5` |
| 清晰度 480P / 768P / 1080P | `Output resolution: 480P, 768P (default), or 1080P.` | 露出 | `param:t2v+i2v+ref/resolution=480P,768P,1080P@768P` |
| 比例：文生 | `Text-to-video values: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16.` / `T2V without this field ... falls back to 16:9` | 露出 | `param:t2v/aspect_ratio=21:9,16:9,4:3,1:1,3:4,9:16@16:9` |
| 比例：多模态参考（默认 adaptive） | `Multimodal references: optional; defaults to adaptive, or specify an explicit ratio` | 露出 | `param:ref/aspect_ratio=adaptive,21:9,16:9,4:3,1:1,3:4,9:16@adaptive` |
| 图生比例由输入图决定 | `I2V: determined by the input image; this field is ignored` | 不露出 | `absent:i2v/aspect_ratio` `reason:模型无效` |
| 水印 | `watermark: Whether to add an AIGC watermark. Watermarks are only supported at 480P / 768P. At 1080P, omit both watermark and its alias aigc_watermark, even when the value is false.` | 待定 | `pending:水印只在 480P / 768P 有效、1080P 必须整键不发，需要「按清晰度显隐」的条件控件；目前档案只能选项约束，不能让整个参数随清晰度消失` |
| 中间帧 | `2K and middle frames are not supported` | 不露出 | `absent:middle_frame_image` `reason:模型无效` |
| 2K / 1440P / 2048P | `2K, 1440P, and 2048P are not supported. Invalid values return HTTP 400.` | 不露出 | `reason:模型无效` |
| 别名 aspect_ratio / size / ratio | `The aliases size and ratio are also accepted.` | 不露出 | `absent:size` `absent:ratio` `reason:同一件事` |
| 水印别名 aigc_watermark | `Alias: aigc_watermark.` | 不露出 | `absent:aigc_watermark` `reason:同一件事` |
| 角色数组 image_with_roles | `Role-based image array that can replace first_frame_image, last_frame_image, or image_urls.` | 不露出 | `absent:image_with_roles` `reason:同一件事` |
| 单段 video_url / audio_url | `a single video can also use video_url (string)` / `a single clip can also use audio_url (string)` | 不露出 | `absent:video_url` `absent:audio_url` `reason:同一件事` |
| webhook | `Receives a notification when the task reaches a successful or failed terminal state.` | 不露出 | `absent:webhook` `reason:管道` |
| model | `Fixed value: MiniMax-H3-Max` | 不露出 | `reason:管道` |
