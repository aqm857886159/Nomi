import { registerRequestTransform, type RequestTransformContext } from "../tasks/requestTransforms";
import type { HttpOperation, ProfileKind } from "./types";

export const MINIMAX_VENDOR_SEED = {
  key: "minimax",
  name: "MiniMax",
  // The key supplied by the MiniMax Open Platform is scoped to the .com
  // endpoint. Keep the host in the seed aligned with the official Chinese
  // API contract; using api.minimax.io returns 401 for that same key.
  baseUrl: "https://api.minimaxi.com",
  legacyBaseUrls: ["https://api.minimax.io"],
  authType: "bearer" as const,
  authHeader: "Authorization",
  assetIngestion: { strategy: "inline-base64" as const, accepts: ["image" as const] },
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function urls(value: unknown): string[] {
  const input = Array.isArray(value) ? value : [value];
  return input.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function mediaContent(type: "image_url" | "video_url" | "audio_url", role: string, value: unknown): RecordValue[] {
  return urls(value).map((url) => ({ type, [type]: { url }, role }));
}

export function normalizeMinimaxH3OfficialBody(body: unknown, _context?: RequestTransformContext): unknown {
  if (!isRecord(body)) return body;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) throw new Error("MiniMax H3 需要非空视频提示词。");

  const frames = [
    ...mediaContent("image_url", "first_frame", body.first_frame_url),
    ...mediaContent("image_url", "last_frame", body.last_frame_url),
  ];
  const references = [
    ...mediaContent("image_url", "reference_image", body.reference_image_urls),
    ...mediaContent("video_url", "reference_video", body.reference_video_urls),
    ...mediaContent("audio_url", "reference_audio", body.reference_audio_urls),
  ];
  if (frames.length > 0 && references.length > 0) {
    throw new Error("MiniMax H3 请求参数冲突：首尾帧与多模态参考不能同时使用。");
  }

  const {
    prompt: _prompt,
    first_frame_url: _first,
    last_frame_url: _last,
    reference_image_urls: _images,
    reference_video_urls: _videos,
    reference_audio_urls: _audios,
    ...rest
  } = body;
  return {
    ...rest,
    ...(frames.length > 0 ? { ratio: "adaptive" } : {}),
    content: [{ type: "text", text: prompt }, ...frames, ...references],
  };
}

registerRequestTransform("minimax-h3-official-content", normalizeMinimaxH3OfficialBody, (body, context) => {
  normalizeMinimaxH3OfficialBody(body, context);
});

const JSON_HEADERS = { "Content-Type": "application/json" };

export const MINIMAX_H3_OFFICIAL_CREATE: HttpOperation = {
  method: "POST",
  path: "/v2/video_generation",
  headers: JSON_HEADERS,
  body: {
    model: "MiniMax-H3",
    prompt: "{{request.prompt}}",
    first_frame_url: "{{request.params.image_url}}",
    last_frame_url: "{{request.params.end_image_url}}",
    reference_image_urls: "{{request.params.reference_image_urls}}",
    reference_video_urls: "{{request.params.reference_video_urls}}",
    reference_audio_urls: "{{request.params.reference_audio_urls}}",
    resolution: "{{request.params.resolution}}",
    duration: "{{request.params.duration}}",
    ratio: "{{request.params.aspect_ratio}}",
  },
  request_transform: "minimax-h3-official-content",
  response_mapping: { task_id: "task_id" },
  provider_meta_mapping: { task_id: "task_id" },
};

export const MINIMAX_H3_OFFICIAL_QUERY: HttpOperation = {
  method: "GET",
  path: "/v2/query/video_generation/{{providerMeta.task_id}}",
  response_mapping: {
    task_id: "task.id",
    status: "task.status",
    video_url: "task.content.url",
    error_message: "task.error.message",
  },
};

export const MINIMAX_H3_OFFICIAL_STATUS: Record<string, string[]> = {
  queued: ["queued"],
  running: ["running"],
  succeeded: ["succeeded"],
  failed: ["failed", "cancelled", "canceled"],
};

const SPEECH_CREATE: HttpOperation = {
  method: "POST",
  path: "/v1/t2a_v2",
  headers: JSON_HEADERS,
  body: {
    model: "{{model.modelKey}}",
    text: "{{request.prompt}}",
    stream: false,
    voice_setting: {
      voice_id: "{{request.params.voice_id}}",
      speed: "{{request.params.speed}}",
      vol: "{{request.params.volume}}",
      pitch: "{{request.params.pitch}}",
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: "mp3",
      channel: 1,
    },
    language_boost: "{{request.params.language_boost}}",
    output_format: "hex",
  },
  audioResponse: {
    type: "json",
    dataPath: "data.audio",
    encoding: "hex",
    contentType: "audio/mpeg",
    extension: "mp3",
  },
};

export type MinimaxOfficialModel = {
  modelKey: string;
  labelZh: string;
  kind: "text" | "video" | "audio";
  archetypeId?: string;
  meta?: Record<string, unknown>;
  mappings: Array<{
    id: string;
    taskKind: ProfileKind;
    name: string;
    create: HttpOperation;
    query?: HttpOperation;
    statusMapping?: Record<string, string[]>;
  }>;
};

export const MINIMAX_OFFICIAL_MODELS: MinimaxOfficialModel[] = [
  {
    modelKey: "MiniMax-M3",
    labelZh: "MiniMax M3",
    kind: "text",
    meta: { supportsImageInput: true },
    mappings: [],
  },
  {
    modelKey: "MiniMax-H3",
    labelZh: "MiniMax H3",
    kind: "video",
    archetypeId: "minimax-h3",
    mappings: ["text_to_video", "image_to_video"].map((taskKind) => ({
      id: `seed-minimax-h3-${taskKind}`,
      taskKind: taskKind as ProfileKind,
      name: `MiniMax H3 · ${taskKind === "text_to_video" ? "文生视频" : "多模态视频"}`,
      create: MINIMAX_H3_OFFICIAL_CREATE,
      query: MINIMAX_H3_OFFICIAL_QUERY,
      statusMapping: MINIMAX_H3_OFFICIAL_STATUS,
    })),
  },
  ...["speech-2.8-hd", "speech-2.8-turbo"].map((modelKey) => ({
    modelKey,
    labelZh: modelKey.endsWith("hd") ? "MiniMax Speech 2.8 HD" : "MiniMax Speech 2.8 Turbo",
    kind: "audio" as const,
    archetypeId: "minimax-speech-2.8",
    mappings: [{
      id: `seed-minimax-${modelKey}-text_to_audio`,
      taskKind: "text_to_audio" as const,
      name: `${modelKey} · 配音生成`,
      create: SPEECH_CREATE,
    }],
  })),
];

/** Stable mapping identity manifest consumed by the zero-cost certification gate. */
export const MINIMAX_OFFICIAL_MAPPING_IDS = [
  "seed-minimax-h3-text_to_video",
  "seed-minimax-h3-image_to_video",
  "seed-minimax-speech-2.8-hd-text_to_audio",
  "seed-minimax-speech-2.8-turbo-text_to_audio",
] as const;

if (new Set(MINIMAX_OFFICIAL_MODELS.flatMap((model) => model.mappings.map((mapping) => mapping.id))).size !== MINIMAX_OFFICIAL_MAPPING_IDS.length) {
  throw new Error("MiniMax mapping identity manifest drift");
}
