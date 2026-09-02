import type { HttpOperation, ProfileKind } from "./types";
import { registerRequestTransform, type RequestTransformContext } from "../tasks/requestTransforms";

// Official cap for eleven_text_to_sound_v2 is 0.5–30s (elevenlabs.io/docs/api-reference/
// text-to-sound-effects/convert, checked 2026-09-02: "Must be at least 0.5 and at most 30").
// The prior 22s ceiling was the v1 limit and rejected valid 22–30s v2 requests locally before
// they could reach the API. Enforce the real v2 bound so a legal request is never pre-empted.
function enforceElevenSfxDurationCap(body: unknown, _context?: RequestTransformContext): unknown {
  if (!body || typeof body !== "object") return body;
  const value = Number((body as Record<string, unknown>).duration_seconds);
  if (Number.isFinite(value) && value > 30) throw new Error("Eleven Sound Effects v2 单次时长上限为 30 秒。");
  return body;
}
registerRequestTransform("eleven-sfx-v2-duration-cap", enforceElevenSfxDurationCap, (body) => { enforceElevenSfxDurationCap(body); });

export const ELEVENLABS_VENDOR_SEED = {
  key: "elevenlabs",
  name: "ElevenLabs",
  baseUrl: "https://api.elevenlabs.io",
  authType: "x-api-key" as const,
  authHeader: "xi-api-key",
};

const JSON_HEADERS = { "Content-Type": "application/json" };
const MP3_RESPONSE = { type: "binary" as const, contentType: "audio/mpeg", extension: "mp3" };

const ELEVEN_V3_CREATE: HttpOperation = {
  method: "POST",
  path: "/v1/text-to-speech/{{request.params.voice_id}}",
  query: { output_format: "mp3_44100_128" },
  headers: JSON_HEADERS,
  body: {
    text: "{{request.prompt}}",
    model_id: "eleven_v3",
    language_code: "{{request.params.language_code}}",
    voice_settings: {
      stability: "{{request.params.stability}}",
      similarity_boost: "{{request.params.similarity_boost}}",
      style: "{{request.params.style}}",
      speed: "{{request.params.speed}}",
      use_speaker_boost: "{{request.params.use_speaker_boost}}",
    },
  },
  audioResponse: MP3_RESPONSE,
};

const MUSIC_V2_CREATE: HttpOperation = {
  method: "POST",
  path: "/v1/music",
  query: { output_format: "mp3_48000_192" },
  headers: JSON_HEADERS,
  body: {
    prompt: "{{request.prompt}}",
    music_length_ms: "{{request.params.music_length_ms}}",
    model_id: "music_v2",
    force_instrumental: "{{request.params.force_instrumental}}",
  },
  audioResponse: MP3_RESPONSE,
  paramMap: { rules: [{ wire: "music_length_ms", fromMany: ["duration_seconds"], transform: "secondsToMilliseconds" }] },
};

const SFX_V2_CREATE: HttpOperation = {
  method: "POST",
  path: "/v1/sound-generation",
  query: { output_format: "mp3_44100_128" },
  headers: JSON_HEADERS,
  body: {
    text: "{{request.prompt}}",
    loop: "{{request.params.loop}}",
    duration_seconds: "{{request.params.duration_seconds}}",
    prompt_influence: "{{request.params.prompt_influence}}",
    model_id: "eleven_text_to_sound_v2",
  },
  audioResponse: MP3_RESPONSE,
  request_transform: "eleven-sfx-v2-duration-cap",
};

const SCRIBE_V2_CREATE: HttpOperation = {
  method: "POST",
  path: "/v1/speech-to-text",
  multipart: {
    fields: {
      model_id: "scribe_v2",
      language_code: "{{request.params.language_code}}",
      diarize: "{{request.params.diarize}}",
      tag_audio_events: "{{request.params.tag_audio_events}}",
      timestamps_granularity: "{{request.params.timestamps_granularity}}",
    },
    fileField: "file",
    fileSource: "{{request.params.reference_audio_urls}}",
    fileKind: "audio",
    filename: "audio",
  },
  response_mapping: { text: "text" },
};

export type ElevenLabsModel = {
  modelKey: string;
  labelZh: string;
  kind: "audio";
  archetypeId: string;
  mappings: Array<{ id: string; taskKind: ProfileKind; name: string; create: HttpOperation }>;
};

export const ELEVENLABS_MODELS: ElevenLabsModel[] = [
  { modelKey: "eleven_v3", labelZh: "Eleven v3", kind: "audio", archetypeId: "eleven-v3", mappings: [{ id: "seed-elevenlabs-eleven-v3-tts", taskKind: "text_to_audio", name: "Eleven v3 · 配音", create: ELEVEN_V3_CREATE }] },
  { modelKey: "music_v2", labelZh: "Eleven Music v2", kind: "audio", archetypeId: "eleven-music-v2", mappings: [{ id: "seed-elevenlabs-music-v2", taskKind: "text_to_audio", name: "Eleven Music v2 · 音乐", create: MUSIC_V2_CREATE }] },
  { modelKey: "eleven_text_to_sound_v2", labelZh: "Eleven Sound Effects v2", kind: "audio", archetypeId: "eleven-sfx-v2", mappings: [{ id: "seed-elevenlabs-sfx-v2", taskKind: "text_to_audio", name: "Eleven Sound Effects v2 · 音效", create: SFX_V2_CREATE }] },
  { modelKey: "scribe_v2", labelZh: "Scribe v2", kind: "audio", archetypeId: "eleven-scribe-v2", mappings: [{ id: "seed-elevenlabs-scribe-v2", taskKind: "transcribe", name: "Scribe v2 · 转写", create: SCRIBE_V2_CREATE }] },
];

/** Stable mapping identity manifest consumed by the zero-cost certification gate. */
export const ELEVENLABS_MAPPING_IDS = [
  "seed-elevenlabs-eleven-v3-tts",
  "seed-elevenlabs-music-v2",
  "seed-elevenlabs-sfx-v2",
  "seed-elevenlabs-scribe-v2",
] as const;

if (new Set(ELEVENLABS_MODELS.flatMap((model) => model.mappings.map((mapping) => mapping.id))).size !== ELEVENLABS_MAPPING_IDS.length) {
  throw new Error("ElevenLabs mapping identity manifest drift");
}

export const ELEVENLABS_OPERATIONS = {
  elevenV3: ELEVEN_V3_CREATE,
  musicV2: MUSIC_V2_CREATE,
  soundEffectsV2: SFX_V2_CREATE,
  scribeV2: SCRIBE_V2_CREATE,
} as const;
