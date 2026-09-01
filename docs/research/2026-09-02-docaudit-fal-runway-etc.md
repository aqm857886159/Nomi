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
