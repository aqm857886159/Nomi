// apimart 音频模型的 curated 传输配方（声音节点：配音 TTS + 转写 Whisper，合一个 catalog 条目）。
// 官方文档（R5 抓，.md 原文）：
//   TTS:     https://docs.apimart.ai/en/api-reference/audios/tts.md
//   Whisper: https://docs.apimart.ai/en/api-reference/audios/whisper-1.md
//
// 与图像/视频族**根本不同**：这两个端点是 **OpenAI 兼容同步**调用（响应即结果，无 task_id 轮询）：
//   TTS      POST /v1/audio/speech         JSON body  → **二进制音频字节**（response_format=wav）
//   Whisper  POST /v1/audio/transcriptions multipart  → 同步 JSON { text, segments }
// runtime 识别 audio 类 → 走第四路 audio 同步收口（electron/audioTaskRunner.ts），不进 admit/poll。
//
// 仿 HappyHorse：**1 个 catalog 基模型（nomi-audio）+ 2 个 taskKind mapping**，真实模型名由档案当前
// 模式的 modelEnum 注入 `request.params.model`（speech→gpt-4o-mini-tts，transcribe→whisper-1），
// 故 body 的 model 取 `{{request.params.model}}` 而非 catalog 行 modelKey。

import type { HttpOperation, ProfileKind } from "./types";

const AUDIO_BASE_MODEL_KEY = "nomi-audio";
const CREATE_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };

export type ApimartAudioModel = {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  kind: "audio";
  mappings: { id: string; taskKind: ProfileKind; name: string; create: HttpOperation }[];
};

// 配音 TTS：input=台词/旁白（prompt），voice/speed 取自档案参数，response_format 固定 wav
// （未压缩、Chromium <audio> 必能播；doc 默认值亦为 wav）。
const TTS_CREATE: HttpOperation = {
  method: "POST",
  path: "/v1/audio/speech",
  headers: CREATE_HEADERS,
  body: {
    model: "{{request.params.model}}",
    input: "{{request.prompt}}",
    voice: "{{request.params.voice}}",
    response_format: "wav",
    speed: "{{request.params.speed}}",
  },
  // headless/MCP 兜底：缺 model apimart 直接 HTTP 500「model is required」。值=档案当前模式默认
  // （speech→gpt-4o-mini-tts，voice→alloy，见 src/config/modelArchetypes/audioArchetype.ts）。UI 路已填故零影响。
  defaultParams: { model: "gpt-4o-mini-tts", voice: "alloy", speed: 1 },
};

// 转写 Whisper：multipart（file + model + language + response_format）由 audioTaskRunner 组装；
// 这里 create 仅提供端点 + model enum 意图，runner 不当 JSON 发。verbose_json 拿 segments 供「生成字幕」。
const WHISPER_CREATE: HttpOperation = {
  method: "POST",
  path: "/v1/audio/transcriptions",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  body: {
    model: "{{request.params.model}}",
    language: "{{request.params.language}}",
    response_format: "verbose_json",
  },
};

/** apimart 的声音基模型（单源，2 mapping）。 */
export const APIMART_AUDIO_MODELS: ApimartAudioModel[] = [
  {
    modelKey: AUDIO_BASE_MODEL_KEY,
    labelZh: "声音",
    archetypeId: "nomi-audio",
    kind: "audio",
    mappings: [
      { id: "seed-apimart-nomi-audio-text_to_audio", taskKind: "text_to_audio", name: "声音 · 配音生成", create: TTS_CREATE },
      { id: "seed-apimart-nomi-audio-transcribe", taskKind: "transcribe", name: "声音 · 转写音频", create: WHISPER_CREATE },
    ],
  },
];
