# Seedance 2.5 · APIMart 能力表

- archetype: seedance-2.5-apimart
- vendor: apimart
- 文档：https://docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation.md（2026-11-12 取）
- 格式说明见 [README](./README.md)。

| 项 | 文档原文 | 去处 | 落点 / 原因 |
| - | - | - | - |
| 方式：文生视频 | `Text-to-video (30s)` / `Text-to-video / multimodal reference / edit / extend / first–last frame` | 露出 | `mode:t2v` `prompt:t2v=required` |
| 方式：首帧 | `First / first–last frame: image_with_roles uses first_frame / last_frame` | 露出 | `mode:first` `slot:first/first_frame:1` `combine:first=image_with_roles` `fixed:first/size=adaptive` |
| 方式：首尾帧 | `last_frame: last frame (1 image, usually with first frame)` | 露出 | `mode:firstlast` `slot:firstlast/first_frame:1` `slot:firstlast/last_frame:1` `combine:firstlast=image_with_roles` `fixed:firstlast/size=adaptive` |
| 方式：全能参考 | `Reference-to-video: References + normal descriptive prompt` | 露出 | `mode:omni` `prompt:omni=required` |
| 参考图 ≤30 | `Max 30 images` | 露出 | `slot:omni/image_ref:30:image_urls` |
| 参考视频 ≤10 | `Max 10; total duration ≤ 30s (each clip 2~30s).` | 露出 | `slot:omni/video_ref:10:video_urls` |
| 参考音频 ≤10（可只给音频） | `2.5 supports audio-only reference (no image/video required).` | 露出 | `slot:omni/audio_ref:10:audio_urls` |
| 方式：视频编辑 | `edit: Video edit: At least one item in video_urls; size must be adaptive (or omitted); duration must be -1 (or omitted)` | 露出 | `mode:edit` `fixed:edit/omni_reference_task_type=edit` `fixed:edit/size=adaptive` `slot:edit/video_ref:10:video_urls` `slot:edit/image_ref:30:image_urls` `slot:edit/audio_ref:10:audio_urls` `prompt:edit=required` |
| 方式：视频续写 | `extend: Video extend: At least one item in video_urls; size must be adaptive (or omitted)` | 露出 | `mode:extend` `fixed:extend/omni_reference_task_type=extend` `fixed:extend/size=adaptive` `slot:extend/video_ref:10:video_urls` `slot:extend/image_ref:30:image_urls` `slot:extend/audio_ref:10:audio_urls` `prompt:extend=required` |
| 比例（文生 / 全能参考可选） | `Values: 16:9, 4:3, 1:1, 3:4, 9:16, 21:9, adaptive (default)` | 露出 | `param:t2v+omni/size=adaptive,16:9,9:16,1:1,4:3,3:4,21:9@adaptive` |
| 清晰度 480p / 720p / 1080p | `Resolution — only: 480p, 720p (default), 1080p. Unsupported values like 2k / 4k return a sync 400.` | 露出 | `param:*/resolution=480p,720p,1080p@720p` |
| 时长 4–30 | `4 ~ 30` / `If omitted: generate and bill 5 seconds.` | 露出 | `param:t2v+first+firstlast+omni+extend/duration=4..30@5` |
| 编辑：时长不发（平台补 -1） | `If edit omits duration, the platform sets it to -1.` / `If edit sends duration explicitly, it must be -1` | 不露出 | `absent:edit/duration` `reason:模型无效`（文档明写编辑时 duration 只能是 -1，只有一个合法值，不发由平台补） |
| 生成音频 | `generate_audio: Whether to generate audio (alias field name: audio). true: with audio (default)` | 露出 | `param:*/generate_audio=bool@true` |
| 返回尾帧 | `return_last_frame: When true, the successful result also includes the last-frame image for chaining.` | 露出 | `param:*/return_last_frame=bool@false` |
| 种子 | `seed: Random seed. Different seeds usually yield different results for the same request` | 露出 | `param:*/seed` |
| 水印 | `watermark: Add an “AI generated” watermark. Default false.` | 露出 | `param:*/watermark=bool@false` |
| 输出容器 mp4 / mov | `Output container: mp4 (default); mov: higher color precision — recommended for edit / extend workflows` | 露出 | `param:*/output_format=mp4,mov@mp4` |
| 提交前内容审核 | `nsfw_check: Whether to run content moderation before submitting the video task. true: use omni-moderation-latest to review prompts and input images` | 露出 | `param:*/nsfw_check=bool@false` |
| 全能参考不声明子任务类型 | `Reference-to-video: References + normal descriptive prompt; no sub-task type needed. Avoid words like “edit / extend / continue / delete / replace” in the prompt to prevent misclassification` | 不露出 | `absent:omni/omni_reference_task_type` `reason:同一件事`（文档：全能参考不需要子任务类型，auto 等于不发） |
| 子任务类型 auto / reference | `Sub-task type hint: auto / reference / edit / extend.` | 不露出 | `reason:同一件事`（auto 等于不发；edit / extend 已由方式钉死；reference 与全能参考默认同一件事） |
| 别名 aspect_ratio | `Aspect ratio (field name aspect_ratio is also accepted).` | 不露出 | `absent:aspect_ratio` `reason:同一件事` |
| 别名 audio | `Whether to generate audio (alias field name: audio).` | 不露出 | `absent:audio` `reason:同一件事` |
| 角色数组 image_with_roles | `image_with_roles: Images with explicit roles.` | 露出 | `combine:first=image_with_roles`（首帧 / 尾帧槽就是它） |
| 4k | `(2.0’s 4k is not available on 2.5)` | 不露出 | `reason:模型无效` |
| model | `Fixed value: seedance-2.5` | 不露出 | `reason:管道` |
| 时长 -1（模型自选，按 30 秒预扣） | `-1: model picks duration (pre-charge at the 30s cap; settle to actual length after completion)` | 待定 | `pending:数字控件没有「自动」这一档，需要新的控件形状；其余方式不受影响` |
| 联网搜索 tools: web_search | `tools: Tool list for enhancements such as web search. "tools": [{"type": "web_search"}]` | 待定 | `pending:要把布尔开关翻成 tools 数组，参数翻译器只收字符串 / 数字、只产标量，需要先扩翻译器` |
| 样片模式 draft | `draft: Set to true to generate a 480p draft ... Drafts are valid for 3 days` | 待定 | `pending:两步流程（样片任务号回传、再发 1080p 成片），超出单次请求形状，需要新的任务流程` |
| 样片转成片 draft_task_id | `draft_task_id: Generate a 1080p final video from a completed draft.` | 待定 | `pending:同上，属于样片的第二步` |
| 私有素材库 asset:// | `Reference approved assets with asset:// in image_urls / image_with_roles / video_urls / audio_urls` | 不露出 | `reason:现在做不到` `condition:账号要先通过平台的素材上传与审核流程，拿到可引用的素材库条目；有了这个入口才能露出一个「选素材库素材」的槽` |
