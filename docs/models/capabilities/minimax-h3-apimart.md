# MiniMax H3 · APIMart 能力表

- archetype: minimax-h3-apimart
- vendor: apimart
- 文档：https://docs.apimart.ai/en/api-reference/videos/minimax-h3/generation.md（2026-11-14 取，2026-11-15 复核 webhook 一行）
- 格式说明见 [README](./README.md)。MiniMax H3-Max 是另一个条目，另一张表（[minimax-h3-max-apimart.md](./minimax-h3-max-apimart.md)）。

| 项 | 文档原文 | 去处 | 落点 / 原因 |
| - | - | - | - |
| 方式：文生视频 | `Text-to-Video (T2V): Only prompt and common fields` | 露出 | `mode:t2v` `prompt:t2v=required` |
| 方式：首帧（可带尾帧） | `Image-to-Video (I2V): first_frame_image / last_frame_image ... First frame, last frame, first+last frame control` | 露出 | `mode:first` `prompt:first=required` `slot:first/first_frame:1:first_frame_image` `slot:first/last_frame:1:last_frame_image` |
| 方式：首尾帧（两张都要） | `Camera slowly transitions from morning light to sunset` | 露出 | `mode:firstlast` `prompt:firstlast=required` `slot:firstlast/first_frame:1:first_frame_image` `slot:firstlast/last_frame:1:last_frame_image` |
| 方式：只给尾帧 | `Supports text-to-video, image-to-video (first / last / first+last frame)` | 待定 | `pending:页上只有概述一句、没有例子，要先实测上游收不收「只放尾帧」，再定是否加一种槽组合` |
| 方式：多模态参考 | `Multimodal Reference (R2V): image_urls / video_urls / audio_urls, or reference_image in image_with_roles` | 露出 | `mode:ref` `prompt:ref=required` |
| 参考图 ≤9 | `Count: ≤ 9` | 露出 | `slot:ref/image_ref:9:image_urls` |
| 参考视频 ≤3（每段 2–15 秒，合计 ≤15 秒） | `Count: ≤ 3` / `Per clip 2 ~ 15 s; total duration ≤ 15 s` | 露出 | `slot:ref/video_ref:3:video_urls` |
| 参考音频 ≤3，不能单独给 | `Cannot be used alone; must be paired with a reference image or reference video` | 露出 | `slot:ref/audio_ref:3:audio_urls` `requires:ref/audio_ref=image_ref\|video_ref` |
| 参考合计上限 12（MiniMax 官方页） | `Mixed input is capped at 12 files in total` | 露出 | `total:ref=12`（出处 platform.minimax.io/docs/guides/video-generation；APIMart 页只写分开的上限） |
| 首尾帧和参考素材不能混用 | `Strict mutual exclusion: ... Mixing them returns 400.` | 露出 | `mode:first` `mode:ref`（不同方式，槽互不相通） |
| 角色数组 image_with_roles | `role: first_frame / last_frame / reference_image` | 不露出 | `absent:image_with_roles` `reason:同一件事` |
| 比例：文生（必须具体值） | `Allowed ratios: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16` | 露出 | `param:t2v/aspect_ratio=21:9,16:9,4:3,1:1,3:4,9:16@16:9` |
| 比例：多模态参考（可 adaptive） | `Multimodal reference: Optional, default adaptive; may also set an explicit ratio` | 露出 | `param:ref/aspect_ratio=adaptive,21:9,16:9,4:3,1:1,3:4,9:16@adaptive` |
| 比例：图生（忽略） | `Image-to-video (first / last frame): Determined by input image; any value is ignored (always adaptive)` | 不露出 | `absent:first/aspect_ratio` `absent:firstlast/aspect_ratio` `reason:模型无效` |
| 比例别名 size / ratio | `You may also pass size or ratio with the same effect.` | 不露出 | `absent:size` `absent:ratio` `reason:同一件事` |
| 清晰度 2K / 768P | `2K (default)` / `768P` | 露出 | `param:*/resolution=2K,768P@2K` |
| 时长 4–15 | `Range: integer from 4 to 15` / `Default: 5` | 露出 | `param:*/duration=4..15@5` |
| 水印 | `watermark boolean (default: false): Whether to add an AIGC watermark` | 露出 | `param:*/watermark=bool@false` |
| 水印别名 aigc_watermark | `Compatible alias: aigc_watermark` | 不露出 | `absent:aigc_watermark` `reason:同一件事` |
| 回调地址 webhook | `webhook string: URL that receives a push when the task reaches a terminal state (success / failure)` | 不露出 | `absent:webhook` `reason:管道`（Nomi 自己轮询取结果，创作者没有地址可填；2026-11-15 前档案露出过一个「可选」文本框，已删，和 H3-Max 表一致） |
| 回调地址 callback_url | `Use webhook. Do not pass the official callback_url.` | 不露出 | `absent:callback_url` `reason:管道` |
| 提交前内容审核 nsfw_check | `nsfw_check boolean (default: false): Whether to run content moderation before submitting the video task.` | 待定 | `pending:档案和发送体都还没有这个开关；参数补齐另排一刀（这一刀只改「今天就是错的」五处），H3-Max 表已露出同一开关` |
| 带声音输出 | `with audio track` | 不露出 | `absent:audio` `reason:模型无效`（只说输出带音轨，没有开关字段） |
| model | `Fixed value: MiniMax-H3` | 不露出 | `reason:管道` |
