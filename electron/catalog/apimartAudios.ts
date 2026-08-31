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
  mappings: {
    id: string;
    taskKind: ProfileKind;
    name: string;
    create: HttpOperation;
    query?: HttpOperation;
    statusMapping?: Record<string, string[]>;
  }[];
};

const APIMART_MUSIC_STATUS: Record<string, string[]> = {
  queued: ["submitted", "pending", "queued"],
  running: ["processing", "running"],
  succeeded: ["completed", "succeeded"],
  failed: ["failed", "cancelled", "canceled", "error"],
};

const APIMART_MUSIC_QUERY: HttpOperation = {
  method: "GET",
  path: "/v1/music/tasks/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  response_mapping: {
    task_id: "data.id",
    status: "data.status",
    audio_url: "data.result.music.0.audio_url",
    error_message: "data.error.message",
  },
};

function asyncMusicCreate(path: string, body: Record<string, unknown>): HttpOperation {
  return {
    method: "POST",
    path,
    headers: CREATE_HEADERS,
    body,
    response_mapping: { task_id: "data.0.task_id", status: "data.0.status" },
    provider_meta_mapping: { task_id: "data.0.task_id" },
  };
}

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
  audioResponse: { type: "binary", contentType: "audio/wav", extension: "wav" },
  // model/voice/speed 等档案默认由 archetypeWireDefaults 桥接兜底（runtime.ts，单一真相源=档案 audioArchetype.ts）。
};

// 转写 Whisper：multipart（file + model + language + response_format）由 audioTaskRunner 组装；
// 这里 create 仅提供端点 + model enum 意图，runner 不当 JSON 发。verbose_json 拿 segments 供「生成字幕」。
const WHISPER_CREATE: HttpOperation = {
  method: "POST",
  path: "/v1/audio/transcriptions",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  multipart: {
    fields: {
      model: "{{request.params.model}}",
      language: "{{request.params.language}}",
      response_format: "verbose_json",
    },
    fileField: "file",
    fileSource: "{{request.params.file}}",
    fileKind: "audio",
    filename: "audio",
  },
  response_mapping: { text: "text" },
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
  {
    modelKey: "suno-v5.5",
    labelZh: "Suno V5.5",
    archetypeId: "suno-v5.5",
    kind: "audio",
    mappings: [
      {
        id: "seed-apimart-suno-v5-5-text_to_audio",
        taskKind: "text_to_audio",
        name: "Suno V5.5 · 音乐生成",
        create: asyncMusicCreate("/v1/music/generations", {
          model: "suno",
          version: "v5.5",
          custom: false,
          prompt: "{{request.prompt}}",
          instrumental: "{{request.params.instrumental}}",
        }),
        query: APIMART_MUSIC_QUERY,
        statusMapping: APIMART_MUSIC_STATUS,
      },
    ],
  },
  {
    modelKey: "suno-sounds-v5.5",
    labelZh: "Suno Sounds V5.5",
    archetypeId: "suno-sfx-v5.5",
    kind: "audio",
    mappings: [
      {
        id: "seed-apimart-suno-sounds-v5-5-text_to_audio",
        taskKind: "text_to_audio",
        name: "Suno Sounds V5.5 · 音效生成",
        create: asyncMusicCreate("/v1/music/generations/sounds", {
          model: "suno",
          version: "v5.5",
          prompt: "{{request.prompt}}",
          sound_type: "{{request.params.sound_type}}",
          sound_tempo: "{{request.params.sound_tempo}}",
          sound_key: "{{request.params.sound_key}}",
        }),
        query: APIMART_MUSIC_QUERY,
        statusMapping: APIMART_MUSIC_STATUS,
      },
    ],
  },
  {
    modelKey: "flowmusic-lyria-3.5",
    labelZh: "Lyria 3.5",
    archetypeId: "lyria-3.5",
    kind: "audio",
    mappings: [
      {
        id: "seed-apimart-lyria-3-5-text_to_audio",
        taskKind: "text_to_audio",
        name: "Lyria 3.5 · 音乐生成",
        create: asyncMusicCreate("/v1/music/generations", {
          model: "flowmusic",
          version: "lyria-3.5",
          sound_prompt: "{{request.prompt}}",
          title: "{{request.params.title}}",
          bpm: "{{request.params.bpm}}",
          length: "{{request.params.length}}",
        }),
        query: APIMART_MUSIC_QUERY,
        statusMapping: APIMART_MUSIC_STATUS,
      },
    ],
  },
];
