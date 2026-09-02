# KIE 官方文档对账（DOCAUDIT-A）

checkedAt: `2026-09-02`（Asia/Shanghai）。官方原文入口：<https://docs.kie.ai/llms.txt>；本次使用 `curl` 抓取 `.md` 页面。表中“wire”是渲染后请求的字段名；`MATCH*` 表示字段/模式与文档一致，但 KIE 的结果/回链/有效期存在下方双源冲突。

## 共用传输合同

| 项目 | 官方页面 | 当前 mapping | 对账 |
|---|---|---|---|
| 创建 | 各 model 页面；统一 `POST /api/v1/jobs/createTask` | 所有 24 条异步 mapping | MATCH |
| 查询 | <https://docs.kie.ai/market/common/get-task-detail.md> | `GET /api/v1/jobs/recordInfo?taskId=`，读取 `data.taskId/state/resultJson/failMsg` | DOC↔LIVE：见冲突表 |
| 认证 | 各页面 Authentication | `Authorization: Bearer {{user_api_key}}` | MATCH |
| KIE 结果 | Seedance/Kling/Wan/GPT Image 等页面 | `data.resultJson.resultUrls.0` | DOC↔LIVE：官方示例把 `resultJson` 当对象，线上 accepted wire 是 JSON 字符串，先 parse 后取 `resultUrls[0]` |

## 逐 mapping 对账（32 条）

| mapping | 模式 | 官方页面 | wire 字段（除 model/input 外） | 结论 |
|---|---|---|---|---|
| `seed-kie-seedance2-image_to_video` | i2v | <https://docs.kie.ai/market/bytedance/seedance-2.md> | `prompt,first_frame_url,last_frame_url,reference_image_urls,reference_video_urls ,reference_audio_urls,resolution,aspect_ratio,duration,generate_audio` | MATCH* |
| `seed-kie-seedance2-text_to_video` | t2v | 同上 | `prompt,resolution,aspect_ratio,duration,generate_audio`（空参考键丢弃） | MATCH* |
| `seed-kie-happyhorse-text_to_video` | t2v | <https://docs.kie.ai/market/happyhorse/text-to-video.md> | `prompt,image_urls ,reference_image ,video_url,resolution,aspect_ratio,duration,seed,audio_setting` | MATCH* |
| `seed-kie-gpt-image-2-text_to_image` | t2i | <https://docs.kie.ai/market/gpt/gpt-image-2-text-to-image.md> | `prompt,aspect_ratio,resolution` | MATCH* |
| `seed-kie-gpt-image-2-image_edit` | edit | <https://docs.kie.ai/market/gpt/gpt-image-2-image-to-image.md> | `prompt,input_urls,aspect_ratio,resolution` | MATCH* |
| `seed-kie-seedream-text_to_image` | t2i | <https://docs.kie.ai/market/seedream/4-5-text-to-image.md> | `prompt,aspect_ratio,quality` | MATCH* |
| `seed-kie-seedream-image_edit` | edit | <https://docs.kie.ai/market/seedream/4-5-edit.md> | `prompt,image_urls,aspect_ratio,quality` | MATCH* |
| `seed-kie-nano-banana-text_to_image` | t2i | <https://docs.kie.ai/market/google/nano-banana.md> | `prompt,aspect_ratio,output_format` | MATCH* |
| `seed-kie-nano-banana-image_edit` | edit | 同上 | `prompt,image_urls,aspect_ratio,output_format` | MATCH* |
| `seed-kie-kling-3-text_to_video` | t2v | <https://docs.kie.ai/market/kling/v3-omni-text-to-video.md> | `prompt,duration,resolution,aspect_ratio,audio,customize_multi_shots,prefer_multi_shots`；model=`kling-3.0-omni/text-to-video` | DRIFT→fixed |
| `seed-kie-kling-3-image_to_video` | i2v | <https://docs.kie.ai/market/kling/v3-omni-image-to-video.md> | `prompt,image_urls,duration,resolution,aspect_ratio,audio,customize_multi_shots,prefer_multi_shots`；model=`kling-3.0-omni/image-to-video` | DRIFT→fixed |
| `seed-kie-minimax-h3-text_to_video` | t2v | <https://docs.kie.ai/market/minimax-h3/text-to-video.md> | `prompt,image_url,end_image_url,reference_image_urls,reference_video_urls,reference_audio_urls,aspect_ratio,duration,resolution` | MATCH* |
| `seed-kie-seedance2-5-text_to_video` | t2v | <https://docs.kie.ai/market/bytedance/seedance-2-5.md> | `prompt,first_frame_url,last_frame_url,reference_image_urls,reference_video_urls,reference_audio_urls,resolution,aspect_ratio,duration,generate_audio,return_last_frame` | MATCH* |
| `seed-kie-seedance2-5-image_to_video` | i2v | 同上 | 同上，模式投影只保留当前参考族 | MATCH* |
| `seed-kie-wan3-0-text_to_video` | t2v | <https://docs.kie.ai/market/wan/3-0-video.md> | `prompt,first_frame_url,last_frame_url,reference_image_urls,reference_video_urls,reference_audio_urls,resolution,aspect_ratio,duration,audio,seed` | MATCH* |
| `seed-kie-wan3-0-image_to_video` | i2v | 同上 | 同上，模式投影负责帧/参考互斥 | MATCH* |
| `seed-kie-nano-banana-2-text_to_image` | t2i | <https://docs.kie.ai/market/google/nanobanana2.md> | `prompt,aspect_ratio,resolution,output_format` | MATCH* |
| `seed-kie-nano-banana-2-image_edit` | edit | 同上 | `prompt,image_input,aspect_ratio,resolution,output_format` | MATCH* |
| `seed-kie-nano-banana-2-lite-text_to_image` | t2i | <https://docs.kie.ai/market/google/nano-banana-2-lite.md> | `prompt,aspect_ratio` | MATCH* |
| `seed-kie-nano-banana-2-lite-image_edit` | edit | 同上 | `prompt,image_urls,aspect_ratio` | MATCH* |
| `seed-kie-seedream-5-pro-text_to_image` | t2i | <https://docs.kie.ai/market/seedream/5-pro-text-to-image.md> | `prompt,aspect_ratio,quality,output_format` | MATCH* |
| `seed-kie-seedream-5-pro-image_edit` | edit | <https://docs.kie.ai/market/seedream/5-pro-image-to-image.md> | `prompt,image_urls,aspect_ratio,quality,output_format` | MATCH* |
| `seed-kie-seedream-5-lite-text_to_image` | t2i | <https://docs.kie.ai/market/seedream/5-lite-text-to-image.md> | `prompt,aspect_ratio,quality,output_format` | MATCH* |
| `seed-kie-seedream-5-lite-image_edit` | edit | <https://docs.kie.ai/market/seedream/5-lite-image-to-image.md> | `prompt,image_urls,aspect_ratio,quality,output_format` | MATCH* |
| `seed-kie-flux-2-pro-text_to_image` | t2i | <https://docs.kie.ai/market/flux2/pro-text-to-image.md> | `prompt,aspect_ratio,resolution` | MATCH* |
| `seed-kie-flux-2-pro-image_edit` | edit | <https://docs.kie.ai/market/flux2/pro-image-to-image.md> | `prompt,input_urls,aspect_ratio,resolution` | MATCH* |
| `seed-kie-gemini-omni-1-1-text_to_video` | t2v | <https://docs.kie.ai/market/google/gemini-omni-flash-1-1.md> | `prompt,image_urls,audio_ids,video_list,character_ids,first_frame_url,last_frame_url,duration,aspect_ratio,resolution,seed` | MATCH* |
| `seed-kie-gemini-omni-1-1-image_to_video` | i2v | 同上 | 同上；`duration` paramMap 转 string | MATCH* |
| `seed-kie-suno-v5-5-music` | music | <https://docs.kie.ai/suno-api/generate-music.md> | `prompt,customMode,instrumental,model,style,title,duration,callBackUrl` | MATCH* |
| `seed-kie-suno-v5-5-extend` | extend | <https://docs.kie.ai/suno-api/upload-and-extend-audio.md> | `uploadUrl,defaultParamFlag,instrumental,prompt,style,title,continueAt,model,callBackUrl` | MATCH* |
| `seed-kie-suno-v5-5-cover` | cover | <https://docs.kie.ai/suno-api/upload-and-cover-audio.md> | `uploadUrl,prompt,customMode,instrumental,style,title,model,callBackUrl` | MATCH* |
| `seed-kie-suno-sounds-v5-5-text_to_audio` | sounds | <https://docs.kie.ai/suno-api/generate-sounds.md> | `prompt,model,soundLoop,soundTempo,soundKey`；`sound_type→sound_loop` | MATCH* |

## 参考模式与非法组合

模式投影已覆盖 i2v/first-last/omni：帧 URL 与 `reference_*_urls` 不并发；非当前模式空键在模板渲染时丢弃。Kling 3 官方现行合同要求单镜头显式发送 `customize_multi_shots=false`、`prefer_multi_shots=false`，i2v 的固定比例只在 custom multi-shot 开启时可用，因此当前 i2v 固定为 `aspect_ratio=auto`；旧 `mode`、`sound`、`multi_shots` 已从 KIE wire 删除。Seedance/Wan 官方页面要求 `last_frame` 依赖 `first_frame`，参考素材有数量/时长上限；合同测试继续锁这些组合，不以一次 HTTP 错误推导字段含义。

## 三处 KIE 文档与实测双源冲突

| 主题 | 官方页面文字 | 线上/代码证据 | 处理 |
|---|---|---|---|
| 响应字段类型 | 当前查询页将 `resultJson` schema 标为 `string`，并给出嵌套 JSON 示例（<https://docs.kie.ai/market/common/get-task-detail.md>） | 已接受的 KIE wire（`kieGptImage2.test.ts`、`kieWan30.test.ts`）返回 JSON 字符串；解析后再取 `resultUrls[0]`；其他模型文档示例仍把它展示成对象 | 保留现有 parse + path；不把文档示例当成稳定响应类型 |
| 回链域名 | callback 示例使用 `https://your-domain.com/...`，不是可投递域名 | Suno mapping 已使用本地 callback ack；真实产物来自 KIE 临时文件域名 | 回链/产物域名视为运行时事实，不把示例 hostname 当合同 |
| 有效期 | 页面给出的结果/资产有效期描述与实际返回不一致 | 既有验收产物和运行记录显示临时文件链接生命周期不同于页面宣称值 | 下载后立即落本地；报告不把页面期限标为 live-certified |

关键原文摘录（短引）：Kling t2v/i2v 页面列出 `customize_multi_shots`、`prefer_multi_shots`，并说明两者不能同时为 true；i2v 示例在单镜头时使用 `aspect_ratio: auto`；Seedance/Wan 页面将参考字段列为 optional 并用互斥约束区分帧与 reference；Suno 页面要求通过 task detail 查询结果。以上只作为文档依据，解析冲突按线上 wire 优先并标注为 `DOC↔LIVE`。
