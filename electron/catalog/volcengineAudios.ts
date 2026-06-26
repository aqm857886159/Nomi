// 火山豆包语音 2.0 配音传输配方（单源）。契约 100% 来自实查（见 volcengineVendor.ts 注释）。
//
// 与 apimart/OpenAI 兼容音频族**根本不同**：
//   端点 POST /api/v3/tts/unidirectional（绝对路径不需，base=openspeech.bytedance.com + 此相对 path）
//   鉴权 三头（X-Api-App-Id/X-Api-Access-Key/X-Api-Resource-Id）—— 由 audioTaskRunner 手搓
//   响应 NDJSON（逐行 {code,data}，base64 音频块）—— 故 create.audioResponse 声明 "ndjson-base64"
// body 不走模板：additions 的情感文本要安全 JSON 转义（裸插值会被引号注入破坏），
// 由 audioTaskRunner.runDoubaoUnidirectionalTts 手搓（先例：runTranscribe 也手搓 multipart）。
// 这里 create 仅承载 path + resource-id 声明 + audioResponse 路由标记。

import type { HttpOperation, ProfileKind } from "./types";

const DOUBAO_TTS_MODEL_KEY = "doubao-seed-tts-2.0";

// resource-id 钉死 seed-tts-2.0：本切片只发官方 2.0 音色（_uranus_bigtts），无克隆音色（S_→seed-icl-2.0）。
const TTS_CREATE: HttpOperation = {
  method: "POST",
  path: "/api/v3/tts/unidirectional",
  headers: { "X-Api-Resource-Id": "seed-tts-2.0" },
  audioResponse: "ndjson-base64",
};

export type VolcengineAudioModel = {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  kind: "audio";
  mappings: { id: string; taskKind: ProfileKind; name: string; create: HttpOperation }[];
};

export const VOLCENGINE_AUDIO_MODELS: VolcengineAudioModel[] = [
  {
    modelKey: DOUBAO_TTS_MODEL_KEY,
    labelZh: "豆包语音 2.0",
    archetypeId: "volcengine-doubao-tts",
    kind: "audio",
    mappings: [
      {
        id: "seed-volcengine-speech-doubao-tts-text_to_audio",
        taskKind: "text_to_audio",
        name: "豆包语音 · 配音生成",
        create: TTS_CREATE,
      },
    ],
  },
];
