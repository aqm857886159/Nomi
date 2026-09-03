# 分镜参考区：2026-09-03 模型模式清单

状态：样张验收快照。读取时间：2026-09-03。

这份清单不是新的模型真相源。它是从 `src/config/modelArchetypes/index.ts` 的 `MODEL_ARCHETYPES` 以及 `electron/shared/videoCapabilities/registry.ts` 的 source-backed video registry 读取后，供样张/走查对账的快照。当前共 89 个 archetype、188 个 mode；生产渲染仍只认档案的 `ArchetypeMode.slots`，并由 `referenceZoneView()` 派生。

记法：`∅` = `slots.length === 0`；`kind[min..max]` = 槽声明的数量；`kind[min..∞]` = `max` 缺省，供应商未公布上限。具名帧槽是 `first_frame` / `last_frame` / `source_video`；其余槽进入同一个数组参考 `@` 入口。`character*` 标出 `characterIndexed: true`。

## 参考形状取样

| 分组 | 仓内真实模式 | `referenceZoneView()` 输出 | 样张切换项 |
|---|---|---|---|
| 零槽 | `seedance-2 / t2v` | `none-accepted`，显示“不吃参考” | Seedance 2.0 · 文生视频 |
| 单槽 | `seedance-2 / first` | 1 个 `first_frame` 具名格 | Seedance 2.0 · 首帧 |
| 单槽数组输入 | `happyhorse / i2v` | 1 个 `first_frame` 具名格；`asArray: true` 只影响请求序列化，不另造一格 | HappyHorse 1.0 · 图生视频 |
| 多具名槽 | `seedance-2 / firstlast` | `first_frame` + `last_frame` 两格 | Seedance 2.0 · 首尾帧 |
| 数组参考 | `seedance-2 / omni` | 一个 `@` 通用入口；声明 `image_ref`、`video_ref`、`audio_ref` | Seedance 2.0 · 全能参考 |
| 源视频 + 数组 | `happyhorse / edit` | `source_video` 具名格 + `image_ref` 的 `@` 入口 | HappyHorse 1.0 · 视频编辑 |
| 未公布上限 | `agnes-video / keyframes` | 一个 `@` 入口；不渲染伪造的 max | Agnes Video V2.0 · 关键帧动画 |
| 无档案默认 | 无 registry 条目（故意模拟未知模型） | 最宽形态：已引用视觉锚 + `@` 占位 | 未识别模型 · 无档案默认 |

取样覆盖了六种 `ArchetypeReferenceSlotKind`：`first_frame`、`last_frame`、`image_ref`、`video_ref`、`audio_ref`、`source_video`。样张的参考区不是分别画这七张 fixture，而是对每个选中项先跑同一份 derive，再从返回的 `kind / namedSlots / hasArrayIntake / referencedAnchors` 渲染。

## 全量注册的 archetype / mode

| archetype id · 名称 | 当前 modes 与槽声明 |
|---|---|
| `seedance-2` · Seedance 2.0 | `t2v: ∅` · `first: first_frame[1..1]` · `firstlast: first_frame[1..1] + last_frame[1..1]` · `omni: image_ref[0..9]* + video_ref[0..3] + audio_ref[0..3]` |
| `seedance-2.5` · Seedance 2.5 | `t2v: ∅` · `first: first_frame[1..1]` · `firstlast: first_frame[1..1] + last_frame[1..1]` · `omni: image_ref[0..30]* + video_ref[0..10] + audio_ref[0..10]` |
| `minimax-h3` · MiniMax H3 | `t2v: ∅` · `i2v: first_frame[1..1] + last_frame[0..1]` · `ref: image_ref[1..9]* + video_ref[0..3] + audio_ref[0..3]` |
| `minimax-h3-max` · MiniMax H3-Max | `t2v: ∅` · `i2v: first_frame[1..1] + last_frame[0..1]` |
| `happyhorse` · HappyHorse 1.0 | `t2v: ∅` · `i2v: first_frame[1..1]` · `ref: image_ref[1..9]*` · `edit: source_video[1..1] + image_ref[0..5]` |
| `vidu-q3` · Vidu Q3 | `ref: image_ref[1..7]` |
| `kling-3.0-turbo` · 可灵 3.0 Turbo | `t2v: ∅` · `i2v: first_frame[1..1]` |
| `happyhorse-1.1` · HappyHorse 1.1 | `t2v: ∅` · `i2v: first_frame[1..1]` · `ref: image_ref[1..9]` |
| `grok-imagine-1.5-video` · Grok Imagine 1.5 | `t2v: ∅` · `i2v: image_ref[1..7]` |
| `sora-2` · Sora 2 | `t2v: ∅` · `i2v: image_ref[1..1]` |
| `veo-3.1` · Veo 3.1 | `t2v: ∅` · `reference: image_ref[1..3]` · `frame: first_frame[1..1] + last_frame[0..1]` |
| `gemini-omni-1.1` · Gemini Omni 1.1 Flash | `t2v: ∅` · `firstlast: first_frame[1..1] + last_frame[0..1]` · `reference: image_ref[1..7]` |
| `runway-gen4.5` · Runway Gen-4.5 | `t2v: ∅` · `i2v: image_ref[1..1]` |
| `runway-gen4-turbo` · Runway Gen-4 Turbo | `i2v: image_ref[1..1]` |
| `kling-3.0` · 可灵 3.0 | `t2v: ∅` · `i2v: image_ref[1..2]` |
| `seedance-2-apimart` · Seedance 2.0 | `t2v: ∅` · `i2v: image_ref[1..9]` · `omni: image_ref[0..9]* + video_ref[0..3] + audio_ref[0..3]` · `firstlast: first_frame[1..1] + last_frame[0..1]` |
| `seedance-2.5-apimart` · Seedance 2.5 | `t2v: ∅` · `first: first_frame[1..1]` · `firstlast: first_frame[1..1] + last_frame[0..1]` · `omni: image_ref[0..30]* + video_ref[0..10] + audio_ref[0..10]` |
| `seedance-2.5-runway` · Seedance 2.5 | `t2v: ∅` · `first: first_frame[1..1]` · `firstlast: first_frame[1..1] + last_frame[1..1]` · `omni: image_ref[0..30]* + video_ref[0..10] + audio_ref[0..10]` |
| `minimax-h3-apimart` · MiniMax H3 | `t2v: ∅` · `first: first_frame[1..1] + last_frame[0..1]` · `firstlast: first_frame[1..1] + last_frame[1..1]` · `ref: image_ref[0..9]* + video_ref[0..3] + audio_ref[0..3]` |
| `wan-2.7` · Wan 2.7 | `t2v: ∅` · `i2v: image_ref[1..2]` · `ref: image_ref[0..5] + video_ref[0..5]` |
| `wan-3.0` · Wan 3.0 | `t2v: ∅` · `first: first_frame[1..1]` · `firstlast: first_frame[1..1] + last_frame[0..1]` · `ref: image_ref[0..10]* + video_ref[0..5] + audio_ref[0..5]` |
| `wan-3.0-apimart` · Wan 3.0 | `t2v: ∅` · `first: first_frame[1..1]` · `firstlast: first_frame[1..1] + last_frame[0..1]` · `ref: image_ref[0..10]* + video_ref[0..5] + audio_ref[0..5]` |
| `hailuo-2.3` · Hailuo 2.3 | `t2v: ∅` · `i2v: first_frame[1..1]` |
| `omni-flash-ext` · Omni-Flash-Ext | `t2v: ∅` · `i2v: image_ref[1..3]` |
| `minimax-h3-regeneration` · MiniMax H3 再生成 | `regenerate: ∅` |
| `volcengine-seedance-2` · Seedance 2.0 | `t2v: ∅` · `first: first_frame[1..1]` · `firstlast: first_frame[1..1] + last_frame[0..1]` · `omni: image_ref[0..9]* + video_ref[0..3] + audio_ref[0..3]` |
| `volcengine-seedance-2-5` · Seedance 2.5 | `t2v: ∅` · `first: first_frame[1..1]` · `firstlast: first_frame[1..1] + last_frame[0..1]` · `omni: image_ref[0..30]* + video_ref[0..10] + audio_ref[0..10]` |
| `dreamina-seedance-2` · 即梦 Seedance | `t2v: ∅` · `i2v: first_frame[1..1]` · `firstlast: first_frame[1..1] + last_frame[1..1]` · `multimodal: image_ref[0..9]* + video_ref[0..3] + audio_ref[0..3]` |
| `dreamina-multiframe` · 即梦多帧视频 | `multiframe: image_ref[2..20]` |
| `runninghub-seedance` · Seedance 2.0 (RunningHub) | `text: ∅` · `image: first_frame[1..1] + last_frame[0..1]` |
| `rh-veo-3.1` · Veo 3.1 (RunningHub) | `text: ∅` · `image: first_frame[1..1] + last_frame[0..1]` |
| `rh-kling-3.0` · 可灵 3.0 (RunningHub) | `text: ∅` · `image: first_frame[1..1] + last_frame[0..1]` |
| `rh-wan-2.7` · Wan 2.7 (RunningHub) | `text: ∅` · `image: first_frame[1..1] + last_frame[0..1]` |
| `rh-hailuo-2.3` · 海螺 2.3 (RunningHub) | `text: ∅` · `image: first_frame[1..1]` |
| `rh-sora-2` · Sora 2 (RunningHub) | `text: ∅` · `image: first_frame[1..1]` |
| `agnes-video` · Agnes Video V2.0 | `t2v: ∅` · `i2v: image_ref[1..1]` · `keyframes: image_ref[2..∞]` |
| `agnes-video-2.5` · Agnes Video 2.5 | `text: ∅` · `keyframe: first_frame[0..1] + last_frame[0..1]` · `reference: image_ref[0..∞] + audio_ref[0..∞] + video_ref[0..∞]` |
| `agnes-video-2.5-flash` · Agnes Video 2.5 Flash | `text: ∅` · `keyframe: first_frame[0..1] + last_frame[0..1]` · `reference: image_ref[0..5] + audio_ref[0..∞]` |
| `minimax-music-3` · MiniMax Music 3 | `music: ∅` |
| `minimax-speech-2.8` · MiniMax Speech 2.8 | `speech: ∅` |
| `eleven-v3` · Eleven v3 | `speech: ∅` |
| `eleven-multilingual-v2` · Eleven Multilingual v2 | `speech: ∅` |
| `eleven-music-v2` · Eleven Music v2 | `music: ∅` |
| `eleven-sfx-v2` · Eleven Sound Effects v2 | `sfx: ∅` |
| `eleven-scribe-v2` · Scribe v2 | `transcribe: audio_ref[1..1]` |
| `meshy-7` · Meshy 7 | `i2m: image_ref[1..1]` |
| `runway-gen4-image` · Runway Gen-4 Image | `t2i: ∅` · `i2i: image_ref[1..3]` |
| `runway-gen4-image-turbo` · Runway Gen-4 Image Turbo | `i2i: image_ref[1..3]` |
| `runway-muse-image` · Runway Muse Image | `t2i: ∅` · `i2i: image_ref[1..10]` |
| `grok-imagine-image-2` · Grok Imagine Image 2 | `t2i: ∅` · `i2i: image_ref[1..3]` |
| `gemini-image-3-pro` · Gemini Image 3 Pro | `t2i: ∅` · `i2i: image_ref[1..14]` |
| `gemini-image-3.1-flash` · Gemini Image 3.1 Flash | `t2i: ∅` · `i2i: image_ref[1..14]` |
| `runway-seed-audio` · Runway Seed Audio | `sfx: audio_ref[0..3]` · `speech: audio_ref[0..1]` |
| `gpt-image-2` · GPT Image 2 | `t2i: ∅` · `i2i: image_ref[1..16]` |
| `seedream` · Seedream 4.5 | `t2i: ∅` · `edit: image_ref[1..14]` |
| `kie-seedream-5-pro` · Seedream 5.0 Pro | `t2i: ∅` · `edit: image_ref[1..10]` |
| `kie-seedream-5-lite` · Seedream 5.0 Lite | `t2i: ∅` · `edit: image_ref[1..14]` |
| `nano-banana-2` · Nano Banana 2 | `t2i: ∅` · `edit: image_ref[1..14]` |
| `nano-banana-2-lite` · Nano Banana 2 Lite | `t2i: ∅` · `edit: image_ref[1..10]` |
| `nano-banana` · Nano Banana | `t2i: ∅` · `edit: image_ref[1..10]` |
| `flux-2-pro` · FLUX.2 Pro | `t2i: ∅` · `edit: image_ref[1..8]` |
| `qwen-image-3` · Qwen-Image 3.0 | `t2i: ∅` · `edit: image_ref[1..3]` |
| `qwen-image` · Qwen-Image 2.0 | `t2i: ∅` · `edit: image_ref[1..4]` |
| `imagen-4` · Imagen 4 | `t2i: ∅` |
| `z-image-turbo` · Z-Image Turbo | `t2i: ∅` |
| `seedream-5-pro` · Seedream 5.0 Pro | `t2i: ∅` · `edit: image_ref[1..10]` |
| `nomi-audio` · 声音 | `speech: ∅` · `transcribe: audio_ref[1..1]` |
| `suno-v5.5` · Suno V5.5 | `music: ∅` · `extend: audio_ref[1..1]` · `cover: audio_ref[1..1]` |
| `suno-sfx-v5.5` · Suno Sounds V5.5 | `sfx: ∅` |
| `lyria-3.5` · Lyria 3.5 | `music: ∅` |
| `volcengine-doubao-tts` · 豆包语音 2.0 | `speech: ∅` |
| `seed-tts` · Seed TTS 2.0（中转） | `speech: ∅` |
| `modelscope-image` · 魔搭图像 | `t2i: ∅` |
| `modelscope-image-edit` · 魔搭改图 | `edit: image_ref[1..4]` |
| `volcengine-seedream` · Seedream 5.0 | `t2i: ∅` · `edit: image_ref[1..14]` |
| `volcengine-seedream-5-pro` · Seedream 5.0 Pro | `t2i: ∅` · `edit: image_ref[1..10]` |
| `dreamina-image` · 即梦图片 | `t2i: ∅` · `i2i: image_ref[1..10]` |
| `dreamina-upscale` · 即梦图片超清 | `upscale: image_ref[1..1]` |
| `codex-imagegen` · Codex 生图 | `t2i: ∅` · `i2i: image_ref[1..10]` |
| `antigravity-image` · Antigravity · generate_image | `t2i: ∅` · `i2i: image_ref[1..4]` |
| `hunyuan3d` · 混元3D v3.1 | `text: ∅` · `image: first_frame[1..1]` |
| `hitem3d` · HiTem3D v21 | `image: first_frame[1..1]` |
| `meshy6` · Meshy 6 | `text: ∅` · `image: first_frame[1..1]` |
| `rh-seedream-4.5` · Seedream 4.5 (RunningHub) | `text: ∅` · `edit: image_ref[1..1]` |
| `rh-nano-banana` · Nano Banana (RunningHub) | `text: ∅` · `edit: image_ref[1..1]` |
| `rh-gpt-image-2` · GPT Image 2 (RunningHub) | `text: ∅` · `edit: image_ref[1..1]` |
| `rh-qwen-image-2.0` · Qwen-Image 2.0 (RunningHub) | `text: ∅` · `edit: image_ref[1..3]` |
| `agnes-image` · Agnes Image 2.0 | `t2i: ∅` · `edit: image_ref[1..∞]` |
| `agnes-image-2.1` · Agnes Image 2.1 | `t2i: ∅` · `edit: image_ref[1..∞]` |

## 对齐边界

- `modeId` 只改变参考槽的声明投影，不清空 flat meta 里按 slot key 保存的参考值；这沿用 `docs/ARCHITECTURE-NOW.md` 的现状结论。
- `InlineParameterBar.tsx` 的模型芯片 + 摘要 pill + 统一参数面板是参数条唯一复用方向；样张把它放在镜头行下沿，生成按钮仍留在画面格/行操作域，不把动作挤进参数胶囊。
- 独立 `StoryboardAnchorCard` 不退场：它是全局锚的管理/审阅投影（108×144）；行内 76×132 是一镜扫描投影。两者共享锚数据和状态 derive，不是两套同功能入口。
