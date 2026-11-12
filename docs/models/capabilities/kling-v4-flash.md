# 可灵 4.0 Flash · APIMart 能力表

- archetype: kling-v4-flash
- vendor: apimart
- 文档：https://docs.apimart.ai/en/api-reference/videos/kling-v4-flash/generation.md（2026-11-12 取）
- 格式说明见 [README](./README.md)；合同测试 `electron/shared/modelArchetypes/capabilityTables.contract.test.ts` 双向读这张表。

| 项 | 文档原文 | 去处 | 落点 / 原因 |
| - | - | - | - |
| 方式：文生视频 | `Text-to-video: No image, video, or audio assets` | 露出 | `mode:t2v` `prompt:t2v=required` |
| 方式：图生视频 | `Image-to-video: Exactly one first frame via first_frame_image, first_frame in image_with_roles, or the sole image in image_urls` | 露出 | `mode:i2v` `prompt:i2v=optional` |
| 图生：首帧 1 张 | `Image-to-video accepts exactly one first frame; two images return HTTP 400.` | 露出 | `slot:i2v/first_frame:1:first_frame_image` |
| 方式：全能参考 | `Reference-based generation: Supply video_urls or reference_image in image_with_roles; alternatively set omni_reference_task_type: "reference" explicitly` | 露出 | `mode:ref` `fixed:ref/omni_reference_task_type=reference` `prompt:ref=required` |
| 参考：参考图 ≤10 | `In reference generation and editing, these are reference images, up to 10.` | 露出 | `slot:ref/image_ref:10:image_urls` |
| 参考：参考视频 ≤5 | `Up to 5 reference videos, no longer than 20 seconds in total.` | 露出 | `slot:ref/video_ref:5:video_urls` |
| 参考：图 + 视频合计 ≤15 | `Up to 10 reference images and 5 reference videos, at most 15 assets combined.` | 露出 | `total:ref=15` |
| 方式：视频编辑 | `Video editing: Set omni_reference_task_type: "edit" and supply an input video` | 露出 | `mode:edit` `fixed:edit/omni_reference_task_type=edit` `prompt:edit=required` |
| 编辑：源视频 1 段 | `For editing or extension, exactly 1 entry may replace video_url, with the corresponding task type explicitly set.` | 露出 | `slot:edit/video_ref:1:video_urls` |
| 编辑：参考图 ≤10 | `In reference generation and editing, these are reference images, up to 10.` | 露出 | `slot:edit/image_ref:10:image_urls` |
| 方式：视频续写 | `Video extension: Set omni_reference_task_type: "extend" and supply an input video` | 露出 | `mode:extend` `fixed:extend/omni_reference_task_type=extend` `slot:extend/video_ref:1:video_urls` `prompt:extend=required` |
| 续写：不收图 | `Extension does not accept images, a target last frame, aspect_ratio, or audio_setting; the original ratio is preserved.` | 不露出 | `absent:extend/image_urls` `absent:extend/aspect_ratio` `absent:extend/audio_setting` `reason:模型无效` |
| 时长 3–20 | `Integer seconds from 3 to 20, normally defaulting to 5.` | 露出 | `param:t2v+i2v+ref+extend/duration=3..20@5` |
| 编辑时长：不给 = 跟随源视频 | `For editing, omission follows the input duration rounded up.` | 露出 | `param:edit/duration=3..20` |
| 比例：文生 | `Text-to-video, reference generation, and editing support 16:9, 9:16, 1:1, and 21:9` / `Text-to-video default: 16:9` | 露出 | `param:t2v/aspect_ratio=16:9,9:16,1:1,21:9@16:9` |
| 比例：参考 / 编辑（auto = 不发） | `only reference generation accepts auto` / `without aspect_ratio, it follows the input ratio` | 露出 | `param:ref/aspect_ratio=auto,16:9,9:16,1:1,21:9@auto` `param:edit/aspect_ratio=auto,16:9,9:16,1:1,21:9@auto` |
| 图生不收比例 | `Image-to-video does not accept aspect_ratio or size: nonempty values return HTTP 400` | 不露出 | `absent:i2v/aspect_ratio` `reason:模型无效` |
| 声音：参考方式 origin / auto | `origin preserves the first reference video's audio; auto generates new audio and is the default.` | 露出 | `param:ref/audio_setting=auto,origin@auto` |
| 声音：编辑 / 续写不收 | `Editing generates new audio and does not preserve the source audio; omit this parameter in editing requests. Extension does not accept it.` | 不露出 | `absent:edit/audio_setting` `reason:模型无效` |
| 清晰度只有 720p | `Only 720p, the default when omitted. 1080p returns HTTP 400.` | 不露出 | `absent:resolution` `reason:模型无效`（文档明写只有 720p，1080p 返回 400，只有一个合法值） |
| 子任务类型 auto | `auto: selects text-to-video, image-to-video, or reference-based generation from the assets; equivalent to omitting the field.` | 不露出 | `reason:同一件事`（等于不发；文生 / 图生本来就不发） |
| 别名 seconds | `seconds: Alias for duration, with the same rules.` | 不露出 | `absent:seconds` `reason:同一件事` |
| 别名 aspect_ratio / size | `Image-to-video does not accept aspect_ratio or size` | 不露出 | `absent:size` `reason:同一件事` |
| 单段视频 video_url | `video_url: Input video URL for editing or extension.` | 不露出 | `absent:video_url` `reason:同一件事`（等同 video_urls 一项） |
| 角色数组 image_with_roles | `Each item has url and role. Image-to-video accepts exactly one first_frame; reference generation and editing use reference_image.` | 不露出 | `absent:image_with_roles` `reason:同一件事`（等同 first_frame_image / image_urls） |
| 首帧字段别名（image_urls 首张） | `It can also be supplied as first_frame in image_with_roles, or as the first image in image_urls.` | 不露出 | `reason:同一件事` |
| 文档明说不支持的字段 | `last_frame_image, role: "last_frame", role: "keyframe"; audio_urls, audio_url; mode, negative_prompt, watermark: true, audio: false` | 不露出 | `absent:last_frame_image` `absent:audio_urls` `absent:mode` `absent:negative_prompt` `absent:watermark` `absent:audio` `reason:模型无效` |
| 文档明说不支持的多镜头 / 运镜字段 | `multi_shot, multi_prompt, element_list, video_list; camera_control, voice_list` | 不露出 | `absent:multi_shot` `absent:camera_control` `reason:模型无效` |
| model | `Must be kling-v4-flash.` | 不露出 | `reason:管道` |
