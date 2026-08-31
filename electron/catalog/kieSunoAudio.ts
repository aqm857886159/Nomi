import type { HttpOperation } from "./types";

export const KIE_SUNO_SFX_MODEL_SEED = {
  modelKey: "suno-sounds-v5-5",
  labelZh: "Suno Sounds V5.5",
  kind: "audio" as const,
};

export const KIE_SUNO_MUSIC_MODEL_SEED = {
  modelKey: "suno-v5.5",
  labelZh: "Suno V5.5",
  kind: "audio" as const,
};

export const KIE_SUNO_STATUS_MAPPING: Record<string, string[]> = {
  queued: ["PENDING", "TEXT_SUCCESS", "pending", "queued"],
  running: ["FIRST_SUCCESS", "processing", "running"],
  succeeded: ["SUCCESS", "success", "completed"],
  failed: [
    "CREATE_TASK_FAILED",
    "GENERATE_AUDIO_FAILED",
    "CALLBACK_EXCEPTION",
    "SENSITIVE_WORD_ERROR",
    "failed",
    "cancelled",
    "canceled",
  ],
};

export const KIE_SUNO_QUERY_OP: HttpOperation = {
  method: "GET",
  path: "/api/v1/generate/record-info",
  headers: { Authorization: "Bearer {{user_api_key}}" },
  query: { taskId: "{{providerMeta.task_id}}" },
  response_mapping: {
    task_id: "data.taskId",
    status: "data.status",
    audio_url: "data.response.sunoData.0.audioUrl",
    error_message: "data.errorMessage",
  },
};

export const KIE_SUNO_SFX_CREATE_OP: HttpOperation = {
  method: "POST",
  path: "/api/v1/generate/sounds",
  headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
  body: {
    prompt: "{{request.prompt}}",
    model: "V5_5",
    soundLoop: "{{request.params.sound_loop}}",
    soundTempo: "{{request.params.sound_tempo}}",
    soundKey: "{{request.params.sound_key}}",
  },
  paramMap: {
    rules: [{ wire: "sound_loop", fromMany: ["sound_type"], transform: "soundTypeToLoop" }],
  },
  response_mapping: { task_id: "data.taskId" },
  provider_meta_mapping: { task_id: "data.taskId" },
};

// KIE requires callBackUrl for all three music routes even though record-info
// polling is officially supported. The URL is a stateless ACK worker: it must
// be deployed before live certification; until then these mappings remain
// documented/simulated and the certification ledger marks them blocked.
const KIE_SUNO_ACK_URL = "https://nomiaqm.com/api/vendor-callbacks/kie/suno/ack";
const KIE_SUNO_MUSIC_HEADERS = { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" };
const kieSunoMusicCreate = (path: string, body: Record<string, unknown>): HttpOperation => ({
  method: "POST",
  path,
  headers: KIE_SUNO_MUSIC_HEADERS,
  body,
  response_mapping: { task_id: "data.taskId" },
  provider_meta_mapping: { task_id: "data.taskId" },
});

export const KIE_SUNO_MUSIC_CREATE_OP = kieSunoMusicCreate("/api/v1/generate", {
  prompt: "{{request.prompt}}",
  customMode: "{{request.params.customMode}}",
  instrumental: "{{request.params.instrumental}}",
  model: "V5_5",
  style: "{{request.params.style}}",
  title: "{{request.params.title}}",
  duration: "{{request.params.duration}}",
  callBackUrl: KIE_SUNO_ACK_URL,
});

export const KIE_SUNO_UPLOAD_EXTEND_CREATE_OP = kieSunoMusicCreate("/api/v1/generate/upload-extend", {
  uploadUrl: "{{request.params.uploadUrl}}",
  defaultParamFlag: "{{request.params.defaultParamFlag}}",
  instrumental: "{{request.params.instrumental}}",
  prompt: "{{request.prompt}}",
  style: "{{request.params.style}}",
  title: "{{request.params.title}}",
  continueAt: "{{request.params.continueAt}}",
  model: "V5_5",
  callBackUrl: KIE_SUNO_ACK_URL,
});

export const KIE_SUNO_UPLOAD_COVER_CREATE_OP = kieSunoMusicCreate("/api/v1/generate/upload-cover", {
  uploadUrl: "{{request.params.uploadUrl}}",
  prompt: "{{request.prompt}}",
  customMode: "{{request.params.customMode}}",
  instrumental: "{{request.params.instrumental}}",
  style: "{{request.params.style}}",
  title: "{{request.params.title}}",
  model: "V5_5",
  callBackUrl: KIE_SUNO_ACK_URL,
});

export const KIE_SUNO_SFX_MAPPING = {
  id: "seed-kie-suno-sounds-v5-5-text_to_audio",
  modeId: "sfx",
  taskKind: "text_to_audio" as const,
  modelKey: KIE_SUNO_SFX_MODEL_SEED.modelKey,
  name: "Suno Sounds V5.5 · 音效生成",
  create: KIE_SUNO_SFX_CREATE_OP,
  query: KIE_SUNO_QUERY_OP,
  statusMapping: KIE_SUNO_STATUS_MAPPING,
};

export const KIE_SUNO_MUSIC_MAPPINGS = [
  { id: "seed-kie-suno-v5-5-music", modeId: "music", taskKind: "text_to_audio" as const, modelKey: KIE_SUNO_MUSIC_MODEL_SEED.modelKey, name: "Suno V5.5 · 音乐生成", create: KIE_SUNO_MUSIC_CREATE_OP, query: KIE_SUNO_QUERY_OP, statusMapping: KIE_SUNO_STATUS_MAPPING },
  { id: "seed-kie-suno-v5-5-extend", modeId: "extend", taskKind: "text_to_audio" as const, modelKey: KIE_SUNO_MUSIC_MODEL_SEED.modelKey, name: "Suno V5.5 · 上传续写", create: KIE_SUNO_UPLOAD_EXTEND_CREATE_OP, query: KIE_SUNO_QUERY_OP, statusMapping: KIE_SUNO_STATUS_MAPPING },
  { id: "seed-kie-suno-v5-5-cover", modeId: "cover", taskKind: "text_to_audio" as const, modelKey: KIE_SUNO_MUSIC_MODEL_SEED.modelKey, name: "Suno V5.5 · 上传翻唱", create: KIE_SUNO_UPLOAD_COVER_CREATE_OP, query: KIE_SUNO_QUERY_OP, statusMapping: KIE_SUNO_STATUS_MAPPING },
] as const;
