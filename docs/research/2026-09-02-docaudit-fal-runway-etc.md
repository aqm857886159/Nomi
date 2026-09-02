# DOCAUDIT-B：非 KIE/APIMart 官方合同对账

> 日期：2026-09-02 · 分支：`audit/vendor-docs-fal-runway-etc-20260902` · 范围：`electron/catalog/` 与 `electron/shared/videoCapabilities/` 中的 fal、Runway、MiniMax、ElevenLabs、Agnes、火山及其托管的 Wan/Veo/Gemini/HappyHorse/Suno 入口。KIE/APIMart 文件和模型不在本次修改范围。
>
> 方法：对每个现存 mapping 的 method/path、鉴权、创建体字段、模式/参考输入、状态/结果投影逐项对照官方现役文档；文档页面用 `curl -L` 抓取，关键 schema 以官方 OpenAPI/source 为准。HTTP 200 只说明页面可达，不等于 wire 合同已验证。

## 1. 现役官方来源收据

| Vendor | 官方来源 | 2026-09-02 抓取结果 | 结论 |
|---|---|---:|---|
| fal | [Queue/Async](https://docs.fal.ai/model-endpoints/queue) | 429（站点限流） | 采用已存 09-01 真网关三端点实测；与页面示例冲突处双源标注 |
| Runway | [OpenAPI](https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json)、[Using the API](https://docs.dev.runwayml.com/guides/using-the-api/)、[Models](https://docs.dev.runwayml.com/guides/models/) | 200 / 200 / 200 | OpenAPI `info.version=2024-11-06` 为字段和 union 真源 |
| MiniMax | [Video generation guide](https://platform.minimaxi.com/docs/guides/video-generation)、[Speech HTTP API](https://platform.minimaxi.com/docs/api-reference/speech-t2a-http) | 200 / 200 | 旧 `api-reference/video-generation-v2` 与 `speech-t2a-v2` 已 404，不能继续引用 |
| ElevenLabs | [Sound effects](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)、[TTS](https://elevenlabs.io/docs/api-reference/text-to-speech)、[Music](https://elevenlabs.io/docs/api-reference/music/compose)、[STT](https://elevenlabs.io/docs/api-reference/speech-to-text) | 全 200 | v2 SFX `duration_seconds` 上限 30，已保留 B2 修正 |
| Agnes | [V2.0 video](https://agnes-ai.com/zh-Hans/docs/agnes-video-v20)、[2.5](https://agnes-ai.com/zh-Hans/docs/agnes-video-25)、[2.5 Flash](https://agnes-ai.com/zh-Hans/docs/agnes-video-25-flash) | 全 200 | 现有 source 覆盖当前已声明字段；未发布的参考数量不自行编造 |
| 火山方舟 | [Seedance 2.0](https://docs.volcengine.com/docs/82379/1520757)、[2.5](https://docs.volcengine.com/docs/82379/2607688)、[参数总表](https://docs.volcengine.com/docs/82379/1521309) | 全 200 | 当前 `/api/v3/contents/generations/tasks` + `model/content` 契约与档案一致 |

## 2. fal.ai（17 mappings）

### 2.1 端点与队列生命周期

- 创建统一为 `POST https://queue.fal.run/{owner/app[/subpath]}`，鉴权是 `Authorization: Key <key>`；创建返回 `request_id`。
- 官方 Queue 页面示例仍把 `status_url`/`response_url` 印成完整模型路径（例如 `fal-ai/flux/schnell/requests/{id}`）。但 09-01 真 key 对 Seedance 2.5、Kling V3 Pro、Flux Schnell 的 202 创建响应和后续 GET 证明：现役网关的 status/result 只认 owner/app 根；完整深路径 status 恒 405，裸根 result 在未完成时返 400（不是 405）。因此代码使用 `falAppRoot(endpoint)`；这是已存 [live matrix 根因合同](../fixes/2026-09-01-vendor-wire-drift-live-matrix.root-cause.json) 明示的文档-网关冲突，不把 200/202 误写成产物成功。
- 状态归一：`IN_QUEUE→queued`、`IN_PROGRESS→running`、`COMPLETED→succeeded`、`FAILED/CANCELED→failed`；结果投影按模型 `images[*]`、`video.url`、`audio.url`、`model_mesh.url`。

### 2.2 创建 mapping 字段对账

| 模型 / mode | 创建 path | 关键请求字段 | 参考/特殊处理 | 结果 |
|---|---|---|---|---|
| `fal-ai/nano-banana-2` / t2i | `/fal-ai/nano-banana-2` | `prompt,num_images,seed,aspect_ratio,resolution,output_format` | 无参考；`edit` 改走 `/edit`，加 `image_urls` | `images[*]` |
| `openai/gpt-image-2` / t2i, edit | `/openai/gpt-image-2[/edit]` | `prompt,image_size,background,quality,num_images,output_format`；edit 加 `image_urls,mask_url` | `aspect_ratio+resolution → image_size`，不再发 `1024x1024` 自造字符串 | `images[*]` |
| `bytedance/seedream/v5/pro` / t2i, edit | `/bytedance/seedream/v5/pro/{text-to-image|edit}` | `prompt,image_size,num_images,output_format,enable_safety_checker`；edit 加 `image_urls` | 删除未接线的 `size/resolution` | `images[*]` |
| `minimax/h3-max` / t2v, i2v | `/minimax/h3-max/{text-to-video|image-to-video}` | prompt、duration、resolution、seed；t2v `aspect_ratio`，i2v `image_url/end_image_url`、安全/扩词 | 参考/首尾帧分模式 | `video.url` |
| `bytedance/seedance-2.5` / t2v, i2v | `/bytedance/seedance-2.5/{text-to-video|image-to-video}` | prompt、resolution、duration、aspect_ratio、generate_audio、bitrate_mode、end_user_id；i2v 加 image/end_image | `return_last_frame` 当前不发，避免死控件 | `video.url` |
| `fal-ai/kling-video/v3/pro` / t2v, i2v | `/fal-ai/kling-video/v3/pro/{text-to-video|image-to-video}` | prompt、duration、generate_audio、shot_type、aspect_ratio、negative_prompt、cfg_scale；i2v `image_urls` | transform 首两图为 `start_image_url/end_image_url`；丢 `mode/sound` | `video.url` |
| `google/gemini-omni-flash/v1.1` / t2v, reference | `/google/gemini-omni-flash/v1.1/{text-to-video|reference-to-video}` | prompt、aspect_ratio、resolution、duration；reference 加 `image_urls/reference_video_urls` | fal 自己的 `reference-to-video` 合同，不能套 Runway 的 text-to-video reference union | `video.url` |
| `minimax/music-3` / music | `/minimax/music-3` | prompt、lyrics、duration、seed、num_inference_steps、guidance_scale | 无参考 | `audio.url` |
| `fal-ai/elevenlabs/sound-effects/v2` / sfx | `/fal-ai/elevenlabs/sound-effects/v2` | text、duration_seconds、prompt_influence、output_format、loop | fal 托管入口；独立 ElevenLabs 入口见 §4 | `audio.url` |
| `hitem3d/hi3d/v3.0` / image | `/hitem3d/hi3d/v3.0/image-to-3d` | image_url、model、resolution、enable_texture、enable_pbr、face_count、export_format、shading | image→3D；`requestType/face` 不发 | `model_mesh.url` |

**零额度结果：** `FAL_OFFICIAL_ENDPOINT_COUNT=17` 与静态 mapping manifest 一致；Queue 根路径、GPT image 尺寸、Kling 首尾图 transform 已由合同/loopback/fault matrix 锁定。未取得新的 fal live 额度证明前，不把 H3-Max、Gemini Omni、Kling、Hi3D 标为本轮付费封印。

## 3. Runway Dev（视频 / 图像 / 音频）

### 3.1 公共 wire

- Base URL `https://api.dev.runwayml.com`；创建和查询均带 `Authorization: Bearer <key>`，创建/查询带 `X-Runway-Version: 2024-11-06`；异步创建返回 `id`，统一 `GET /v1/tasks/{id}`，终态 `SUCCEEDED/FAILED/CANCELLED`，产物从 `output` 投影。
- `/v1/text_to_video` 和 `/v1/image_to_video` 是按模型判别的 oneOf union。**reference 模式的参考数组在可支持的 text-to-video variant 上，不是 promptImage。**本轮已把 generated reference mapping 统一到 text-to-video；Veo 3.1/fast 和 Gemini Omni Flash 的官方 union 没有 reference fields，因此只发布 t2v/i2v，静态 manifest 同步删除三条虚假 reference identity。

### 3.2 视频 union 逐模型

| 模型 | t2v | i2v | reference | 关键字段/归一化 |
|---|---|---|---|---|
| `gen4.5` | ✅ | ✅ | — | promptText；i2v `promptImage`；ratio 1280:720/720:1280；duration 2–10 |
| `gen4_turbo` | — | ✅ | — | i2v `promptImage`；官方图生 union |
| `seedance2` / `seedance2_fast` / `seedance2_mini` | ✅ | ✅ | ✅ | ratio 为各自像素枚举；fast/mini 是 12 值子集；reference 走 text-to-video `references/referenceVideos/referenceAudio` |
| `seedance2_5` | ✅ | ✅（first/firstlast） | ✅（omni） | 4–30 秒；2.5 合法值含 `854:480/480:854`；omni 是 text-to-video typed refs，经 `runway-seedance2-5` transform |
| `wan3` | ✅ | ✅ | ✅ | `ratio` 像素/`auto_480p|auto_720p|auto_1080p` 枚举；reference 可有 images/videos/audio |
| `grok_imagine_1_5` | ✅ | ✅ | ✅ | t2v/reference 可发 ratio（1:1、16:9、9:16、4:3、3:4、3:2、2:3）；i2v 不发 ratio；不发 generate_audio |
| `hailuo3` | ✅ | ✅ | ✅ | ratio `adaptive,21:9,16:9,4:3,1:1,3:4,9:16`；duration/resolution；reference 三类 typed channel |
| `veo3.1` / `veo3.1_fast` | ✅ | ✅ | — | ratio 四个像素值；duration 4/6/8；audio；无 reference union |
| `happyhorse_1_0` | ✅ | ✅ | — | t2v ratio 十值；i2v 仅 promptImage、resolution、duration，不发 ratio/audio |
| `gemini_omni_flash` | ✅ | ✅ | — | ratio 1280:720/720:1280；duration；无 reference union |

**参考边界根因修复：** 之前布尔 `withImage` 推断把任意参考图都送到 `/v1/image_to_video` 并写入 `promptImage`；现在 `runwayVideoCreate(spec, modeId)` 单点派生 endpoint、taskKind、promptImage 和参考数组。`c16b5760` 的回归测试覆盖所有 generated reference、Seedance 2.5 omni、Veo/Gemini 禁发 reference。

### 3.3 图像 / 音频 mapping

- 图像全部创建 `POST /v1/text_to_image`，`i2i` 是同一 endpoint 的 image edit variant：Muse、Grok Imagine Image 2、Seedream 5 Pro/Lite、Gen-4 Image、Gen-4 Image Turbo、Gemini Image 3 Pro/3.1 Flash、GPT Image 2、Gemini 2.5 Flash。比例按各 model union 归一：GPT Image 2 不接受 1024:1024；Muse 的合法集独立；Seedream 5 Lite 使用 `2048:2048`、`2848:1600` 等像素集。`gen4_image_turbo` 要求 reference，`gen4_image` 不伪造 reference。
- `seed_audio`：`/v1/sound_effect` 与 `/v1/text_to_speech`；Runway Eleven Sound Effects v2：`/v1/sound_effect`；Runway Eleven multilingual v2/v3：`/v1/text_to_speech`。都用 `/v1/tasks/{id}` 轮询，结果为 `output`。官方 OpenAPI 目前未给这些音频 mapping 一个新的本地直连旁路。

**零额度结果：** 4 个合同文件共 47 项聚焦测试全绿；`check:model-certification-coverage` 报 66 entries，Runway reference identity 与实际生成集合一致。Runway live 只在未封印模型且预算记录齐全时执行，不能用 schema 通过替代产物检查。

## 4. MiniMax 官方直连（H3 / Speech / M3）

### 4.1 H3 视频

- 当前 host 是 `https://api.minimaxi.com`，`Authorization: Bearer <key>`；旧 `api.minimax.io` 只作为历史 fallback 保留，不能作为当前合同真源。创建 `POST /v2/video_generation`，查询 `GET /v2/query/video_generation/{task_id}`。
- `MiniMax-H3` t2v 使用 `prompt`、`resolution`、`duration`、`ratio`；图生/首尾帧与多模态参考共用创建端点但不是同一模式：首尾帧由 `first_frame_url/last_frame_url` 归一为 content roles，参考图/视频/音频归一为 `content` 中对应 `image_url/video_url/audio_url` + role。首尾帧和参考素材同时出现必须在本地拒绝。
- 现有档案声明 H3-Max 为 480P/768P、5–15 秒，t2v 的 ratio 为 `16:9/9:16/1:1/4:3/3:4`；i2v 不伪造 ratio。映射体保留 `model=MiniMax-H3`，不能把 `MiniMax-M3`（chat）误当成异步视频模型。
- 状态 `queued/running/succeeded/failed/cancelled/canceled` 统一到任务生命周期，成功取 `task.content.url`，失败取 `task.error.message`。全量字段干跑覆盖 t2v、首帧、首尾帧、图/视频/音频参考和冲突拒绝；本轮没有为直连 H3 增加新的付费调用。
- 旧来源 `https://platform.minimaxi.com/docs/api-reference/video-generation-v2` 本次返回 404，已改为现行 [Video generation guide](https://platform.minimaxi.com/docs/guides/video-generation)，并由 `minimaxOfficial.test.ts` 钉住。

### 4.2 Speech 与 M3

- Speech 2.8 HD/Turbo 共用 `POST /v1/t2a_v2`，body 是 `model,text,stream=false,voice_setting{voice_id,speed,vol,pitch},audio_setting{sample_rate,bitrate,format,channel},language_boost,output_format=hex`；hex 结果解码为 mp3。官方当前 [Speech HTTP API](https://platform.minimaxi.com/docs/api-reference/speech-t2a-http) 可达；旧 `speech-t2a-v2` 路径 404。
- `MiniMax-M3` 是 OpenAI-compatible chat brain，不能生成媒体 mapping；它维持无 async mapping 的 catalog 形状，避免把对话模型伪装成视频任务。

## 5. ElevenLabs 官方直连（4 mappings）

| mapping | endpoint | 字段逐项对账 | 证据/限制 |
|---|---|---|---|
| `eleven_v3` / TTS | `POST /v1/text-to-speech/{voice_id}` | text、model_id=`eleven_v3`、language_code、voice_settings stability/similarity_boost/style/speed/use_speaker_boost；query `output_format=mp3_44100_128` | [TTS reference](https://elevenlabs.io/docs/api-reference/text-to-speech)；结果 binary mp3 |
| `music_v2` / music | `POST /v1/music` | prompt、model_id=`music_v2`、music_length_ms、force_instrumental；query `mp3_48000_192` | [Music compose](https://elevenlabs.io/docs/api-reference/music/compose)；`music_length_ms` 3000–600000，秒数在 mapping boundary 转毫秒 |
| `eleven_text_to_sound_v2` / sfx | `POST /v1/sound-generation` | text、model_id、loop、duration_seconds、prompt_influence；query `mp3_44100_128` | [Sound effects](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)；`duration_seconds` 0.5–30，30 正常，31 本地拒绝 |
| `scribe_v2` / transcribe | `POST /v1/speech-to-text` multipart | model_id、language_code、diarize、tag_audio_events、timestamps_granularity、file | [Speech-to-text](https://elevenlabs.io/docs/api-reference/speech-to-text)；本地 audio reference 作为 file，不伪造异步 query |

鉴权统一为 `xi-api-key`，host `https://api.elevenlabs.io`。B2 遗产保留了 22→30 秒修正，新增 v3 合同和 9 项测试；本轮 key 仅用于后续明确列入“未封印”台账的最小探针，绝不写入源码或报告。

**MiniMax/ElevenLabs 零额度结果：** MiniMax 9 项官方合同测试全绿；ElevenLabs 4 mapping 的静态 identity、参数转换和 SFX 上下界测试全绿。页面抓取只证明文档可达，账号资格与产物仍需单独探针/封印记录。

## 6. Agnes AI（6 video mappings）

- 公共 host 为 `https://apihub.agnes-ai.com`，Bearer 鉴权；V2.0 与 2.5 都创建 `POST /v1/videos`，返回 `video_id`，通过 `GET /agnesapi?video_id=...` 查询。2.5 查询额外带 `model_name`；状态归一覆盖 `queued/pending/submitted`、`in_progress/processing/running`、`completed/succeeded/success`、`failed/error/cancelled`。
- V2.0 t2v body：`model,prompt,width,height,num_frames,frame_rate,negative_prompt,seed,num_inference_steps`；i2v 追加 `image` 与 `extra_body.image/mode`，关键帧另走 `extra_body.keyframe_images`。共享 UI 的 aspect_ratio/resolution 只在 `agnesVideoWidth/Height` transform 处转换，duration/frame_rate 只在 `agnesVideoNumFrames` 处转换，避免把推荐值误称为原始 API 字段。
- V2.5/2.5 Flash 的 t2v、keyframe、reference 共用 `model,prompt,mode,seconds,size,aspect_ratio,seed,n=1`；首尾帧字段为 `first_frame/last_frame`，参考通道为 `images/audios`，完整 2.5 增加 `videos/video_start_seconds/video_require_audio`。Flash 按官方页面只开放 720P、最多 5 张图片且不声明 videos；普通 2.5 保留 720P/960P/2K 与视频参考。文档未发布的数量上限不写入档案。
- **模式干跑：** V2.0 t2v/i2v/keyframes、2.5 text/keyframe/reference、Flash text/keyframe/reference 均能在本地展开到正确 endpoint/body；错误的参考通道不静默丢弃。未配置 Agnes key，故无付费封印；不把 HTTP 结构干跑升级为 live。

## 7. 火山方舟 Seedance（4 mappings）

- host 由连接配置提供；官方创建 `POST /api/v3/contents/generations/tasks`，查询 `GET /api/v3/contents/generations/tasks/{id}`，Bearer 鉴权。mapping 使用 `pathFrom: host-root`，防止把 host 已带 `/api/v3` 时拼成 `/api/v3/api/v3/...`。
- 2.0 标准/fast/mini 与 2.5 共有 `model,content,resolution,ratio,duration,generate_audio,watermark=false`；content 以 `type` + `role` 表达 text、首帧/尾帧、参考图/视频/音频。2.0 是 4–15 秒、标准可 4K、参考上限 9/3/3 且纯音频不允许；fast/mini 只 480p/720p。2.5 是 4–30 秒、480p/720p/1080p、参考上限 30/10/10、可纯音频，并额外发送 `output_format=mp4|mov`。
- 首帧/首尾帧的 `ratio` 在 2.5 档案收窄为 `adaptive`；2.5 的 edit/extend 仍未接入，因为官方约束是 duration=-1 且 ratio=adaptive，需要独立样张和验收，不在本轮假装覆盖。2.0 的 `seed/camera_fixed` 已删除：官方参数表只把它们列给 1.5/1.0 系列。
- 状态 `queued/running/cancelled/succeeded/failed/expired`；成功取 `content.video_url`，错误取 `error.code/message`。4 个 mapping 的 t2v/i2v、首尾帧、全模态参考 body 均通过静态 contract/loopback 展开；未配置火山 key，未付费。

## 8. 托管模型交叉索引（避免重复接入）

| 用户看到的模型族 | 本辖区现役入口 | 参考输入结论 |
|---|---|---|
| Wan 3 | Runway `wan3` | t2v/i2v/reference 均在 Runway text/video union；reference 不是 `promptImage` |
| Veo 3.1 / Fast | Runway `veo3.1` / `veo3.1_fast` | 只 t2v/i2v；OpenAPI 无 reference union，不能显示/发送多图 reference |
| Gemini Omni Flash | fal `google/gemini-omni-flash/v1.1` 与 Runway `gemini_omni_flash` | fal 是独立 `reference-to-video`；Runway 只 t2v/i2v，两个 provider 合同不混用 |
| HappyHorse 1.0 | Runway `happyhorse_1_0` | t2v/i2v；i2v 不发 ratio/audio |
| Suno / Music | 本辖区无 Suno mapping；ElevenLabs `music_v2` 与 fal MiniMax Music 3 是不同模型 | 不把 KIE/APIMart Suno 入口复制到本班 |

这张交叉索引是“模型族→provider adapter”的单一归属说明，不新增第二套模型 UI。能力是否可用由当前 provider mapping 决定；缺少官方 union 的模式保持 fail-closed。

## 9. DOCAUDIT-B 付费封印台账

> 只执行 acceptance matrix 中未标 ✅ 的入口；历史 matrix 的 ¥20.29 不计入本轮。哈希是当前 mapping JSON 的 SHA-256，不含 key。路径均在 `/tmp/docaudit-b/`，不进仓库。

| 模型 × 封印模式 | mapping SHA-256 | 日期 | 产物 / 亲验 | 花销 |
|---|---|---|---|---:|
| `fal minimax/h3-max` × i2v（参考图） | `9344a55b8c788e708cfaa046edfb30fc342cc5d6ac347af1141bc5131afd7998` | 2026-09-02 | [fal_minimax_h3_max_reference_lime_20260902.mp4](/tmp/docaudit-b/artifacts/fal_minimax_h3_max_reference_lime_20260902.mp4)；抽帧同时看到 red robot、blue hat、lime square，ffprobe 5.184s/H.264/AAC | fal API 未返回单请求 cost |
| `Eleven v3` × TTS | `34fcce7f970c941294fa2588e5b12947736c25d9985b793f294050316569c2ac` | 2026-09-02 | [elevenlabs_eleven_v3_20260902.mp3](/tmp/docaudit-b/artifacts/elevenlabs_eleven_v3_20260902.mp3)；ffprobe 1.840s/mp3 | ElevenLabs API 未返回单请求 cost |
| `Eleven Sound Effects v2` × SFX | `10f1bd7e97c3b6685612f91be40e1efbf12e0c0ffe2d9ee59ded6dd04b54ddc6` | 2026-09-02 | [elevenlabs_eleven_text_to_sound_v2_20260902.mp3](/tmp/docaudit-b/artifacts/elevenlabs_eleven_text_to_sound_v2_20260902.mp3)；0.480s/mp3，duration_seconds=0.5 合同通过 | ElevenLabs API 未返回单请求 cost |
| `Eleven Music v2` × music | `e27b5365ef1e1826de0852d73a258f37d3b34b05c61a566a70dc75693dd532f7` | 2026-09-02 | [elevenlabs_music_v2_20260902.mp3](/tmp/docaudit-b/artifacts/elevenlabs_music_v2_20260902.mp3)；3.024s/mp3，music_length_ms=3000 | ElevenLabs API 未返回单请求 cost |
| `Scribe v2` × transcribe | `85f280b9a63b764fb38f28aea1cb4693eee570304b907865671c0fdc8f7c4f` | 2026-09-02 | [elevenlabs_scribe_v2_20260902.json](/tmp/docaudit-b/artifacts/elevenlabs_scribe_v2_20260902.json)；新产出的 Eleven v3 音频识别为 `这是红色机器人。` | ElevenLabs API 未返回单请求 cost |

### 9.1 额度阻断与探针事故收据

- Runway `seedance2_5`、`seedance2`、`seedance2_fast`、`veo3.1` 的最小 t2v 请求（4–5 秒、最小 ratio、audio=false）均 HTTP 400：`You do not have enough credits to run this task.` 服务端仅返回错误和官方 API 文档 URL，**没有 current/required credits，因此精确差额不可得**；无 task id、无产物、无封印。
- 2026-09-02 续跑验证：`seedance2_fast` 参考图模式（4 秒、1280:720、audio=false）仍为 ⛔ 余额不足；`veo3.1_fast` 先以 4 秒 t2v/audio=false 返回 task `estimatedCost=40 credits`，立即 DELETE，未留计费产物；再用官方 `/v1/uploads`（init 200、multipart 204）得到 `runway://` 参考 URI，图生请求通过 wire 校验但同样 HTTP 400 余额不足。Runway OpenAPI 只有 `estimatedCost`/usage，没有余额端点或短缺值，故 ⛔ 的**精确差额不可观测**，不伪造金额。
- fal 前置空体探针的三个 request id 都进入 `COMPLETED`，结果分别 HTTP 422 缺少 `prompt`（H3 另含 duration 超上限），无产物；取消已来不及，fal API 未返回 cost/charge 字段，故台账将它们标为“探针失败、非封印”，不编造金额。
- ElevenLabs `GET /v1/user` 返回 `payg` 且账户可用；四个 mapping 的最小请求均 HTTP 200。该 API 只回账户计数/限制，不回本次美元或人民币扣费；本轮账面花销按**供应商未披露**记录，不能声称一个未经账单确认的精确人民币总额。已停止继续付费，预算上限为 ¥35，待 provider billing 明细才能把“未披露”换成精确数。

## 10. 本轮验证边界

- 本地 dry-run 展开 91 个现存 non-KIE/non-APIMart mappings（fal 17、Runway 56、MiniMax 4、ElevenLabs 4、Agnes 6、Volcengine 4），每个都有 POST/path；参考/首尾帧槽均参与了模式清单检查。
- `check:model-certification-coverage`、`check:root-cause-contracts`、相关 contract/loopback 共 47 项已绿；官方页面、静态 contract、网关探针、真实产物四种证据分开记录。未把“页面 200”“队列 202”“账户可达”升级成“产物封印”。
