# APIMart 官方文档对账（DOCAUDIT-A）

checkedAt: `2026-09-02`（Asia/Shanghai）。官方索引：<https://docs.apimart.ai/llms.txt>；英文 API manual：<https://docs.apimart.ai/_llms/en/api-manual.md>。代码基线 `a9112cda`，本表覆盖当前 curated catalog 的 49 条 mapping。`MATCH` 是字段/模式/端点一致；`ID-DRIFT` 是内部兼容标识仍能被服务接受，但不等于官方当前 canonical model ID。

## 共用合同

| 族 | 官方创建/查询 | 当前实现 | 对账 |
|---|---|---|---|
| 图片/视频异步 | `POST /v1/images/generations` 或 `POST /v1/videos/generations`；`GET /v1/tasks/{task_id}` | create `data.0.task_id`；视频结果 `data.result.videos.0.url.0`，图片结果按 image query | MATCH（线上结果 URL 的数组形状以既有验收为准） |
| 音乐异步 | `POST /v1/music/generations[(/sounds)]`；`GET /v1/music/tasks/{id}` | `data.0.task_id`；`data.result.music.0.audio_url` | MATCH |
| OpenAI-compatible audio | <https://docs.apimart.ai/en/api-reference/audios/tts.md>、`whisper-1.md` | `/v1/audio/speech` 二进制 wav；`/v1/audio/transcriptions` multipart | MATCH |
| 认证/余额 | <https://docs.apimart.ai/en/api-reference/account/token-balance.md> | Bearer；本次免费查询 `/v1/balance` 返回 `unlimited_quota:true` | MATCH |

## 逐 mapping 对账（49 条）

### 图片（15 条）

| mapping | 模式 | 官方页面 | wire 字段 | 结论 |
|---|---|---|---|---|
| `seed-apimart-seedream-5-pro-text_to_image` | t2i | <https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md> | `prompt,size,resolution` | ID-DRIFT：官方 `seedream-5-0-pro`，当前 `doubao-seedream-5-0-pro` |
| `seed-apimart-seedream-5-pro-image_edit` | edit | 同上 | `prompt,size,resolution,image_urls` | ID-DRIFT |
| `seed-apimart-seedream-text_to_image` | t2i | <https://docs.apimart.ai/en/api-reference/images/seedream-4.5/generation.md> | `prompt,size,resolution` | ID-DRIFT：官方 `seedream-4.5`，当前 `doubao-seedream-4.5` |
| `seed-apimart-seedream-image_edit` | edit | 同上 | `prompt,size,resolution,image_urls` | ID-DRIFT |
| `seed-apimart-nano-banana-text_to_image` | t2i | <https://docs.apimart.ai/en/api-reference/images/gemini-2.5-flash/generation.md> | `prompt,size` | MATCH |
| `seed-apimart-nano-banana-image_edit` | edit | 同上 | `prompt,size,image_urls` | MATCH |
| `seed-apimart-nano-banana-2-text_to_image` | t2i | <https://docs.apimart.ai/en/api-reference/images/gemini-3.1-flash/generation.md> | `prompt,size,resolution` | MATCH |
| `seed-apimart-nano-banana-2-image_edit` | edit | 同上 | `prompt,size,resolution,image_urls` | MATCH |
| `seed-apimart-gpt-image-2-text_to_image` | t2i | <https://docs.apimart.ai/en/api-reference/images/gpt-image-2/generation.md> | `prompt,size,resolution`；canonical `aspect_ratio→size`、resolution lowercase | MATCH |
| `seed-apimart-gpt-image-2-image_edit` | edit | 同上 | `prompt,size,resolution,image_urls`；同 paramMap | MATCH |
| `seed-apimart-qwen-image-text_to_image` | t2i | <https://docs.apimart.ai/en/api-reference/images/qwen-image/generation.md> | `prompt,size,resolution,negative_prompt` | MATCH |
| `seed-apimart-qwen-image-image_edit` | edit | 同上 | `prompt,size,resolution,image_urls,negative_prompt` | MATCH |
| `seed-apimart-qwen-image-3-text_to_image` | t2i | <https://docs.apimart.ai/en/api-reference/images/qwen-image-3.0/generation.md> | `prompt,size,resolution,negative_prompt` | MATCH |
| `seed-apimart-qwen-image-3-image_edit` | edit | 同上 | `prompt,size,resolution,image_urls,negative_prompt` | MATCH |
| `seed-apimart-z-image-turbo-text_to_image` | t2i | <https://docs.apimart.ai/en/api-reference/images/z-image-turbo/generation.md> | `prompt,size,resolution` | MATCH |

### 视频（30 条）

| mapping | 模式 | 官方页面 | wire 字段（除 model/prompt 外） | 结论 |
|---|---|---|---|---|
| `seed-apimart-vidu-q3-image_to_video` | i2v | <https://docs.apimart.ai/en/api-reference/videos/vidu-q3/generation.md> | `duration,resolution,aspect_ratio,image_urls,seed` | MATCH；官方要求参考图 |
| `seed-apimart-kling-3.0-turbo-text_to_video` | t2v | <https://docs.apimart.ai/en/api-reference/videos/kling-3.0-turbo/generation.md> | `aspect_ratio,resolution,duration` | MATCH |
| `seed-apimart-kling-3.0-turbo-image_to_video` | i2v | 同上 | `resolution,duration,first_frame_image` | MATCH |
| `seed-apimart-happyhorse-1.1-text_to_video` | t2v | <https://docs.apimart.ai/en/api-reference/videos/happyhorse-1.1/generation.md> | `resolution,size,duration,seed` | MATCH |
| `seed-apimart-happyhorse-1.1-image_to_video` | i2v | 同上 | `resolution,size,duration,seed,first_frame_image,image_urls` | MATCH |
| `seed-apimart-grok-imagine-1.5-video-text_to_video` | t2v | <https://docs.apimart.ai/en/api-reference/videos/grok-imagine/generation.md> | `size,quality,duration` | ID-DRIFT：官方 `grok-imagine-1.5-video-ext` |
| `seed-apimart-grok-imagine-1.5-video-image_to_video` | i2v | 同上 | `quality,duration,image_urls` | ID-DRIFT |
| `seed-apimart-sora-2-text_to_video` | t2v | <https://docs.apimart.ai/en/api-reference/videos/sora-2/generation.md> | `aspect_ratio,resolution,duration` | MATCH |
| `seed-apimart-sora-2-image_to_video` | i2v | 同上 | `resolution,duration,image_urls`；drop `aspect_ratio` | MATCH |
| `seed-apimart-veo-3.1-text_to_video` | t2v | <https://docs.apimart.ai/en/api-reference/videos/veo3/generation.md> | `aspect_ratio,resolution` | MATCH；duration 官方固定/默认 |
| `seed-apimart-veo-3.1-image_to_video` | i2v | 同上 | `resolution,image_urls,generation_type`；drop `aspect_ratio` | MATCH |
| `seed-apimart-kling-3.0-text_to_video` | t2v | <https://docs.apimart.ai/en/api-reference/videos/kling-v3/generation.md> | `mode,duration,aspect_ratio,audio,negative_prompt` | MATCH |
| `seed-apimart-kling-3.0-image_to_video` | i2v | 同上 | `mode,duration,image_urls,audio,negative_prompt`；drop比例 | MATCH |
| `seed-apimart-seedance-2-apimart-text_to_video` | t2v | <https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation.md> | `size,resolution,duration,seed,generate_audio` | ID-DRIFT：官方 `seedance-2.0`，内部旧 `doubao-*` |
| `seed-apimart-seedance-2-apimart-image_to_video` | i2v/ref | 同上 | `size,resolution,duration,image_urls,video_urls,audio_urls,image_with_roles,seed,generate_audio` | ID-DRIFT；参考互斥由模式投影锁定 |
| `seed-apimart-seedance-2.5-apimart-text_to_video` | t2v | <https://docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation.md> | `size,resolution,duration,seed,generate_audio,return_last_frame` | ID-DRIFT：官方 `seedance-2.5` |
| `seed-apimart-seedance-2.5-apimart-image_to_video` | i2v/ref | 同上 | `size,resolution,duration,image_urls,video_urls,audio_urls,image_with_roles,seed,generate_audio,return_last_frame` | ID-DRIFT；参考模式优先 |
| `seed-apimart-minimax-h3-apimart-text_to_video` | t2v | <https://docs.apimart.ai/en/api-reference/videos/minimax-h3/generation.md> | `duration,resolution,aspect_ratio,watermark,webhook` | MATCH；transform 丢空 webhook |
| `seed-apimart-minimax-h3-apimart-image_to_video` | i2v/ref | 同上 | 上述字段 + `first_frame_image,last_frame_image,image_urls,video_urls,audio_urls` | MATCH；transform 锁帧/参考互斥 |
| `seed-apimart-wan-2.7-text_to_video` | t2v | <https://docs.apimart.ai/en/api-reference/videos/wan2.7/generation.md> | `size,resolution,duration,negative_prompt` | MATCH |
| `seed-apimart-wan-2.7-image_to_video` | i2v/ref | 同上 | `size,resolution,duration,image_urls,image_with_roles,video_urls,negative_prompt,seed` | MATCH；官方说明 size 在 i2v 被忽略 |
| `seed-apimart-wan-3.0-apimart-text_to_video` | t2v | <https://docs.apimart.ai/en/api-reference/videos/wan3.0-video/generation.md> | `size,resolution,duration,audio,watermark,seed` | MATCH |
| `seed-apimart-wan-3.0-apimart-image_to_video` | i2v/ref | 同上 | 上述字段 + `generation_type,image_urls,image_with_roles,video_urls,audio_urls` | MATCH |
| `seed-apimart-hailuo-2.3-text_to_video` | t2v | <https://docs.apimart.ai/en/api-reference/videos/minimax-hailuo-2.3/generation.md> | `resolution,duration` | MATCH |
| `seed-apimart-hailuo-2.3-image_to_video` | i2v | 同上 | `resolution,duration,first_frame_image` | MATCH |
| `seed-apimart-omni-flash-ext-text_to_video` | t2v | <https://docs.apimart.ai/en/api-reference/videos/omni-flash-ext/generation.md> | `aspect_ratio`/兼容 `size`, `resolution,duration` | ID-DRIFT：官方 `gemini-omni-1.1-flash-ext` |
| `seed-apimart-omni-flash-ext-image_to_video` | i2v/ref | 同上 | `aspect_ratio`/兼容 `size`, `resolution,duration,image_urls,generation_type` | ID-DRIFT；1/3 图约束已进入档案 |
| `seed-apimart-minimax-h3-regeneration-text_to_video` | regenerate | <https://docs.apimart.ai/en/api-reference/videos/minimax-h3/regeneration.md> | `source_task_id` | MATCH |
| `seed-apimart-minimax-h3-context-ir-prompt_refine` | prompt_refine | <https://docs.apimart.ai/en/api-reference/videos/minimax-h3/context-ir.md> | `duration,aspect_ratio,first_frame_image,last_frame_image,image_urls,video_urls,audio_urls` | MATCH |

### 音频（5 条）

| mapping | 模式 | 官方页面 | wire 字段 | 结论 |
|---|---|---|---|---|
| `seed-apimart-nomi-audio-text_to_audio` | tts | <https://docs.apimart.ai/en/api-reference/audios/tts.md> | JSON `model,input,voice,response_format=wav,speed` | MATCH |
| `seed-apimart-nomi-audio-transcribe` | transcribe | <https://docs.apimart.ai/en/api-reference/audios/whisper-1.md> | multipart `file,model,language,response_format=verbose_json` | MATCH |
| `seed-apimart-suno-v5-5-text_to_audio` | music | <https://docs.apimart.ai/en/api-reference/audios/suno/generation.md> | `model=suno,version=v5.5,custom=false,prompt,instrumental` | MATCH |
| `seed-apimart-suno-sounds-v5-5-text_to_audio` | sounds | <https://docs.apimart.ai/en/api-reference/audios/suno/sounds.md> | `model=suno,version=v5.5,prompt,sound_type,sound_tempo,sound_key` | MATCH |
| `seed-apimart-lyria-3-5-text_to_audio` | music | <https://docs.apimart.ai/en/api-reference/audios/flow-music/music-lyria-3-5.md> | `model=flowmusic,version=lyria-3.5,sound_prompt,title,bpm,length` | MATCH |

## 参考模式/非法组合

Seedance 2.0/2.5：`image_urls` 与 `image_with_roles` 互斥；帧角色不能与 video/audio reference 混用；2.5 首尾帧的 `size` 必须 `adaptive`，并允许 `return_last_frame`。Omni：`generation_type=frame` 只接受 1 图，`reference` 接受 1 或 3 图，2 图明确 400；视频参考与 duration 互斥。Sora/Veo/Kling 等 i2v 显式 drop 比例，避免把无效控件值发给上游。现有档案和 `dropParamMap` 已把这些组合表达为模式合同。

## 本次免费探针证据（2026-09-02）

- `/v1/balance`：带 key HTTP 200，`success:true, unlimited_quota:true, used_balance=176.813288`；不带 key HTTP 401（`API key is required`）。未写入 key。
- `/v1/models`：带 key HTTP 200，`object=list, success:true`，返回当前模型列表并包含本审计涉及的 Seedance 2.5、Vidu Q3、Kling v3、Omni、Wan、Hailuo 等 ID；未把列表中的兼容别名直接当 canonical 合同。
- 使用极端 duration 做非计费校验时，绝大多数入口返回 400/402/403；Veo 与旧/新 Omni 入口因服务端忽略该字段返回 200 并创建任务，属于本次探针的副作用，不作为付费封印证据。之后只使用文档明确的同步 400 校验或余额阻断探针。
- 余额阻断返回 APIMart `balance=18319038`、Kling/Vidu 需要数十亿 credits；精确余额来自服务响应，不据此推断模型契约。

本班最小付费封印：Seedance 2.5 i2v/reference，`480p/4s/1 image`，HTTP 200 → 下载 `/tmp/matrix/artifacts/docaudit-apimart-seedance25-ref.mp4`；余额 `used_balance` 从 `176.813288` 增至 `177.201588`，`credits_cost=3.883`，折算实际花销 `¥0.3883`。抽帧同时确认红色机器人参考特征与挥手提示词；完整台账追加在 <https://github.com/aqm857886159/Nomi/blob/audit/vendor-docs-kie-apimart-20260902/docs/research/2026-09-02-model-acceptance-matrix.md>（本地 acceptance matrix）。

## 关键原文摘录

Seedream 5 Pro 页面将 model 写为 `seedream-5-0-pro`；Grok 页面写为 `grok-imagine-1.5-video-ext`；Omni 页面写为 `gemini-omni-1.1-flash-ext`，且明确 `duration` 仅 4/6/8/10。Seedance 页面明确官方模型枚举与参考媒体互斥；Wan 2.7 页面明确统一入口及 `size`。这些是本报告标出 ID-DRIFT 与模式合同的直接依据。
