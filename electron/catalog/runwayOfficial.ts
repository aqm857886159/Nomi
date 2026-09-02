import type { HttpOperation, ProfileKind } from "./types";
import { registerRequestTransform, type RequestTransformContext } from "../tasks/requestTransforms";
import { desktopT } from "../i18n";
import { normalizeRunwayVideoRatio, RUNWAY_IMAGE_RATIO_REMAP, runwayRatioOrientation } from "./runwayRatio";

/** Runway Dev official API (OpenAPI v2024-11-06, checked 2026-08-30). */
export const RUNWAY_VENDOR_SEED = {
  key: "runway",
  name: "Runway Dev",
  baseUrl: "https://api.dev.runwayml.com",
  authType: "bearer" as const,
  authHeader: "Authorization",
  // Runway's own two-step ephemeral upload (POST /v1/uploads → signed
  // multipart upload → runway:// URI). This is the preferred path for local
  // references; data URIs remain an official small-image fallback inside the
  // shared transport resolver, never an anonymous third-party host.
  assetIngestion: {
    strategy: "upload-presigned" as const,
    endpoint: "https://api.dev.runwayml.com/v1/uploads",
    initHeaders: { "X-Runway-Version": "2024-11-06" },
    uploadUrlPath: "uploadUrl",
    uriPath: "runwayUri",
    fieldsPath: "fields",
    initFields: { type: "ephemeral" },
    filenameField: "filename",
    typeField: "type",
    uploadFileField: "file",
    accepts: ["image" as const, "video" as const, "audio" as const],
    visibility: "provider-private" as const,
    ttlSeconds: 24 * 60 * 60,
  },
};

const HEADERS = {
  Authorization: "Bearer {{user_api_key}}",
  "X-Runway-Version": "2024-11-06",
  "Content-Type": "application/json",
};
const POLL_HEADERS = { Authorization: "Bearer {{user_api_key}}", "X-Runway-Version": "2024-11-06" };
const STATUS: Record<string, string[]> = {
  queued: ["PENDING", "THROTTLED"],
  running: ["RUNNING"],
  succeeded: ["SUCCEEDED"],
  failed: ["FAILED", "CANCELLED", "CANCELED"],
};

const create = (path: string, model: string, withImage: boolean): HttpOperation => ({
  method: "POST",
  path,
  headers: HEADERS,
  body: {
    promptText: "{{request.prompt}}",
    ...(withImage ? { promptImage: "{{request.params.image_url}}" } : {}),
    model,
    ratio: "{{request.params.aspect_ratio}}",
    duration: "{{request.params.duration}}",
    seed: "{{request.params.seed}}",
  },
  response_mapping: { task_id: "id" },
  provider_meta_mapping: { task_id: "id" },
});

/**
 * Runway's Seedance 2.5 wire contract uses typed reference objects while the
 * shared archetype deliberately exposes plain URL arrays. Keep that provider
 * spelling at the mapping boundary; the runtime and model identity stay
 * vendor-neutral. Empty optional arrays are removed so a mode cannot become a
 * mixed reference request by accident.
 */
function uriArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function typedReferences(value: unknown, type?: "video" | "audio"): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [{ ...(type ? { type } : {}), uri: item.trim() }];
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>).uri === "string") {
      const uri = String((item as Record<string, unknown>).uri).trim();
      return uri ? [{ ...(type ? { type } : {}), uri }] : [];
    }
    return [];
  });
}
function normalizeRunwaySeedance25Body(body: unknown, _context?: RequestTransformContext): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(desktopT("runway.seedanceBody"));
  }
  const input = body as Record<string, unknown>;
  // Seedance 2.5 的 ratio 枚举是纯像素值（无 adaptive/友好串）；把共享默认（adaptive/16:9…）收敛到合法像素比例。
  if (typeof input.ratio === "string") {
    const mapped = normalizeRunwayVideoRatio("seedance2_5", input.ratio);
    if (mapped) input.ratio = mapped; else delete input.ratio;
  }
  const images = uriArray(input.reference_image_urls);
  const videos = uriArray(input.reference_video_urls);
  const audios = uriArray(input.reference_audio_urls);
  if (images.length > 30) throw new Error(desktopT("runway.seedanceMaxImages", { count: 30 }));
  if (videos.length > 10) throw new Error(desktopT("runway.seedanceMaxVideos", { count: 10 }));
  if (audios.length > 10) throw new Error(desktopT("runway.seedanceMaxAudios", { count: 10 }));

  delete input.reference_image_urls;
  delete input.reference_video_urls;
  delete input.reference_audio_urls;
  if (images.length) input.references = images.map((uri) => ({ uri }));
  if (videos.length) input.referenceVideos = videos.map((uri) => ({ type: "video", uri }));
  if (audios.length) input.referenceAudio = audios.map((uri) => ({ type: "audio", uri }));
  if (!images.length && Array.isArray(input.references)) input.references = typedReferences(input.references);
  if (!videos.length && Array.isArray(input.referenceVideos)) input.referenceVideos = typedReferences(input.referenceVideos, "video");
  if (!audios.length && Array.isArray(input.referenceAudio)) input.referenceAudio = typedReferences(input.referenceAudio, "audio");

  if (Array.isArray(input.promptImage)) {
    const promptImages = input.promptImage.flatMap((item) => {
      if (typeof item === "string" && item.trim()) return [{ uri: item.trim() }];
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).uri === "string") {
        const value = item as Record<string, unknown>;
        const uri = String(value.uri).trim();
        return uri ? [{ uri, ...(value.position ? { position: value.position } : {}) }] : [];
      }
      return [];
    });
    if (!promptImages.length) throw new Error(desktopT("runway.seedanceEmptyImage"));
    const keyframes = promptImages.some((item) => item.position === "first" || item.position === "last");
    if (keyframes && (promptImages.length !== 2 || promptImages.some((item) => item.position !== "first" && item.position !== "last"))) {
      throw new Error(desktopT("runway.seedanceKeyframes"));
    }
    input.promptImage = promptImages;
  } else if (typeof input.promptImage === "string") {
    input.promptImage = input.promptImage.trim() || undefined;
    if (!input.promptImage) delete input.promptImage;
  }
  return input;
}

registerRequestTransform("runway-seedance2-5", normalizeRunwaySeedance25Body, (body) => {
  normalizeRunwaySeedance25Body(body);
});
// The same typed-reference wire shape is shared by Runway's Wan/Hailuo/Grok
// families; keep a generic declaration name for those mappings while retaining
// the Seedance-specific name for its audited contract.
registerRequestTransform("runway-video-references", normalizeRunwaySeedance25Body, (body) => {
  normalizeRunwaySeedance25Body(body);
});

/**
 * The Runway endpoint is a discriminated union, not one loose "video" body.
 * Keep the shared archetype controls, but translate the small set of values
 * that are not legal for a particular discriminator before the request can
 * reach a billable create call.  This is deliberately model-generic: no UI
 * branch or provider-specific mode is introduced.
 */
function normalizeRunwayVideoContract(body: unknown, _context?: RequestTransformContext): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(desktopT("runway.videoBody"));
  const input = body as Record<string, unknown>;
  const model = String(input.model || "");
  const hasPromptImage = Object.prototype.hasOwnProperty.call(input, "promptImage");

  // The shared archetype ratio defaults (friendly strings, or high-res pixel values not in every
  // variant's enum) are collapsed to each model's official discriminator enum via the single
  // per-model normalizer. This closes two live drifts (2026-09-02): seedance2_fast/mini reject the
  // high-res 1920:1080/1080:1920 that the shared control exposes (only in seedance2's full enum),
  // and every family's friendly default is mapped to a member of its own spec enum by orientation.
  const ratio = String(input.ratio || "").trim();
  const family = model.startsWith("seedance2") ? "seedance"
    : model === "wan3" ? "wan"
      : model === "hailuo3" ? "hailuo"
        : model === "grok_imagine_1_5" ? "grok"
          : model.startsWith("veo3.1") ? "veo"
            : model === "happyhorse_1_0" ? "happyhorse"
              : model === "gemini_omni_flash" ? "gemini"
                : null;
  if (family && ratio) {
    const mapped = normalizeRunwayVideoRatio(model, ratio);
    if (mapped) input.ratio = mapped;
    else delete input.ratio;
  }

  // Veo only accepts 4/6/8 seconds; choose the cheapest valid duration for
  // the shared control's default instead of sending a guaranteed 400.
  if (family === "veo" && input.duration !== undefined) {
    const duration = Number(input.duration);
    input.duration = [4, 6, 8].includes(duration) ? duration : 4;
  }
  // HappyHorse image-to-video has no ratio property in the official schema.
  if (family === "happyhorse" && hasPromptImage) delete input.ratio;

  // Reference arrays are supported only by the discriminators that publish
  // them.  The UI supplies URL arrays; translate them into Runway's typed
  // reference objects without allowing unsupported video/audio fields to
  // leak into a different model variant.
  const imageRefs = uriArray(input.reference_image_urls);
  const videoRefs = uriArray(input.reference_video_urls);
  const audioRefs = uriArray(input.reference_audio_urls);
  delete input.reference_image_urls;
  delete input.reference_video_urls;
  delete input.reference_audio_urls;
  const allowsImage = family === "seedance" || family === "wan" || family === "hailuo" || family === "grok";
  const allowsVideo = family === "seedance" || family === "wan" || family === "hailuo";
  const allowsAudio = allowsImage;
  if (allowsImage && imageRefs.length) input.references = imageRefs.map((uri) => ({ uri }));
  if (allowsVideo && videoRefs.length) input.referenceVideos = videoRefs.map((uri) => ({ type: "video", uri }));
  if (allowsAudio && audioRefs.length) input.referenceAudio = audioRefs.map((uri) => ({ type: "audio", uri }));
  if (!allowsImage) delete input.references;
  if (!allowsVideo) delete input.referenceVideos;
  if (!allowsAudio) delete input.referenceAudio;
  return input;
}

registerRequestTransform("runway-video-contract", normalizeRunwayVideoContract, (body) => {
  normalizeRunwayVideoContract(body);
});

function normalizeRunwayImageReferences(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(desktopT("runway.imageBody"));
  const input = body as Record<string, unknown>;
  const images = uriArray(input.reference_image_urls);
  if (input.model === "gen4_image_turbo" && images.length === 0) {
    throw new Error(desktopT("runway.gen4ReferenceRequired"));
  }
  if (images.length > 3) throw new Error(desktopT("runway.maxImageReferences", { count: 3 }));
  delete input.reference_image_urls;
  if (images.length) input.referenceImages = images.map((uri) => ({ uri }));

  // 按模型判别把共享比例映射到该模型合法的 ratio（只对枚举不含共享默认的模型动手）。
  const remap = RUNWAY_IMAGE_RATIO_REMAP[String(input.model || "")];
  const ratio = typeof input.ratio === "string" ? input.ratio.trim() : "";
  if (remap && ratio) input.ratio = remap[runwayRatioOrientation(ratio)];
  return input;
}

registerRequestTransform("runway-image-references", normalizeRunwayImageReferences, (body) => {
  normalizeRunwayImageReferences(body);
});

/** seed_audio accepts referenceAudios as plain provider URI strings (max 3). */
function normalizeRunwayAudioReferences(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(desktopT("runway.audioBody"));
  const input = body as Record<string, unknown>;
  const refs = uriArray(input.reference_audio_urls);
  if (refs.length > 3) throw new Error(desktopT("runway.maxAudioReferences", { count: 3 }));
  delete input.reference_audio_urls;
  if (refs.length) input.referenceAudios = refs;
  return input;
}

registerRequestTransform("runway-audio-references", normalizeRunwayAudioReferences, (body) => {
  normalizeRunwayAudioReferences(body);
});

const poll: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: POLL_HEADERS,
  response_mapping: { task_id: "id", status: "status", video_url: "output.0", error_message: "failure" },
};

// Keep an explicit result stage so ProductionRun can verify the final output
// after status observation. Runway uses the same task detail endpoint for both.
const result: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: POLL_HEADERS,
  response_mapping: { task_id: "id", status: "status", assets: "output", error_message: "failure" },
};
const imagePoll: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: POLL_HEADERS,
  response_mapping: { task_id: "id", status: "status", image_url: "output.0", error_message: "failure" },
};
const imageResult: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: POLL_HEADERS,
  response_mapping: { task_id: "id", status: "status", assets: "output", error_message: "failure" },
};

const audioPoll: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: POLL_HEADERS,
  response_mapping: { task_id: "id", status: "status", audio_url: "output.0", error_message: "failure" },
};
const audioResult: HttpOperation = {
  method: "GET",
  path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: POLL_HEADERS,
  response_mapping: { task_id: "id", status: "status", assets: "output", error_message: "failure" },
};

type RunwayModel = {
  modelKey: string;
  labelZh: string;
  kind: "video" | "image" | "audio";
  archetypeId: string;
  mappings: Array<{ id: string; modeId: string; taskKind: ProfileKind; name: string; create: HttpOperation; query: HttpOperation; result: HttpOperation; statusMapping: Record<string, string[]> }>;
};

const RUNWAY_AUDIO_SFX_ID = "seed-runway-seed-audio-sfx";
const RUNWAY_AUDIO_TTS_ID = "seed-runway-seed-audio-tts";
const RUNWAY_AUDIO_SFX_CREATE: HttpOperation = {
  method: "POST",
  path: "/v1/sound_effect",
  headers: HEADERS,
  body: {
    model: "seed_audio",
    promptText: "{{request.prompt}}",
    reference_audio_urls: "{{request.params.reference_audio_urls}}",
    speechRate: "{{request.params.speech_rate}}",
    loudnessRate: "{{request.params.loudness_rate}}",
    pitchRate: "{{request.params.pitch_rate}}",
    sampleRate: "{{request.params.sample_rate}}",
    outputFormat: "{{request.params.output_format}}",
  },
  request_transform: "runway-audio-references",
  response_mapping: { task_id: "id" },
  provider_meta_mapping: { task_id: "id" },
};
const RUNWAY_AUDIO_TTS_CREATE: HttpOperation = {
  method: "POST",
  path: "/v1/text_to_speech",
  headers: HEADERS,
  body: {
    model: "seed_audio",
    promptText: "{{request.prompt}}",
    speechRate: "{{request.params.speech_rate}}",
    loudnessRate: "{{request.params.loudness_rate}}",
    pitchRate: "{{request.params.pitch_rate}}",
    sampleRate: "{{request.params.sample_rate}}",
    outputFormat: "{{request.params.output_format}}",
  },
  response_mapping: { task_id: "id" },
  provider_meta_mapping: { task_id: "id" },
};

const RUNWAY_ELEVEN_SFX_CREATE: HttpOperation = {
  method: "POST",
  path: "/v1/sound_effect",
  headers: HEADERS,
  body: {
    model: "eleven_text_to_sound_v2",
    promptText: "{{request.prompt}}",
    duration: "{{request.params.duration_seconds}}",
    loop: "{{request.params.loop}}",
  },
  response_mapping: { task_id: "id" },
  provider_meta_mapping: { task_id: "id" },
};

const RUNWAY_ELEVEN_TTS_CREATE = (model: "eleven_multilingual_v2" | "eleven_v3"): HttpOperation => ({
  method: "POST",
  path: "/v1/text_to_speech",
  headers: HEADERS,
  body: {
    model,
    promptText: "{{request.prompt}}",
    // Runway's public contract requires a voice object for these variants.
    // Maya is an official preset; the generic audio archetype keeps this
    // default stable until a voice-picker control is added to the shared UI.
    voice: { type: "runway-preset", presetId: "Maya" },
  },
  response_mapping: { task_id: "id" },
  provider_meta_mapping: { task_id: "id" },
});

const RUNWAY_AUDIO_MODEL: RunwayModel = {
  modelKey: "seed_audio",
  labelZh: "Runway Seed Audio",
  kind: "audio",
  archetypeId: "runway-audio",
  mappings: [
    { id: RUNWAY_AUDIO_SFX_ID, modeId: "sfx", taskKind: "text_to_audio", name: "Runway Seed Audio · 音效", create: RUNWAY_AUDIO_SFX_CREATE, query: audioPoll, result: audioResult, statusMapping: STATUS },
    { id: RUNWAY_AUDIO_TTS_ID, modeId: "speech", taskKind: "text_to_audio", name: "Runway Seed Audio · 配音", create: RUNWAY_AUDIO_TTS_CREATE, query: audioPoll, result: audioResult, statusMapping: STATUS },
  ],
};

const RUNWAY_ELEVEN_AUDIO_MODELS: RunwayModel[] = [
  {
    modelKey: "eleven_text_to_sound_v2",
    labelZh: "Runway Eleven Sound Effects v2",
    kind: "audio",
    archetypeId: "runway-audio",
    mappings: [{ id: "seed-runway-eleven_text_to_sound_v2-sfx", modeId: "sfx", taskKind: "text_to_audio", name: "Runway Eleven Sound Effects v2 · 音效", create: RUNWAY_ELEVEN_SFX_CREATE, query: audioPoll, result: audioResult, statusMapping: STATUS }],
  },
  ...(["eleven_multilingual_v2", "eleven_v3"] as const).map((modelKey) => ({
    modelKey,
    labelZh: `Runway ${modelKey}`,
    kind: "audio" as const,
    archetypeId: "runway-audio",
    mappings: [{ id: `seed-runway-${modelKey}-speech`, modeId: "speech", taskKind: "text_to_audio" as const, name: `Runway ${modelKey} · 配音`, create: RUNWAY_ELEVEN_TTS_CREATE(modelKey), query: audioPoll, result: audioResult, statusMapping: STATUS }],
  })),
];

const mapping = (id: string, modeId: string, taskKind: ProfileKind, name: string, createOp: HttpOperation) => ({
  id,
  modeId,
  taskKind,
  name,
  create: createOp,
  query: poll,
  result,
  statusMapping: STATUS,
});

const GEN45_T2V = create("/v1/text_to_video", "gen4.5", false);
const GEN45_I2V = create("/v1/image_to_video", "gen4.5", true);
const GEN4_TURBO_I2V = create("/v1/image_to_video", "gen4_turbo", true);
const GEN45_T2V_ID = "seed-runway-gen4-5-t2v";
const GEN45_I2V_ID = "seed-runway-gen4-5-i2v";
const GEN4_TURBO_I2V_ID = "seed-runway-gen4-turbo-i2v";
const SEEDANCE25_T2V_ID = "seed-runway-seedance2-5-t2v";
const SEEDANCE25_FIRST_ID = "seed-runway-seedance2-5-first";
const SEEDANCE25_FIRSTLAST_ID = "seed-runway-seedance2-5-firstlast";
const SEEDANCE25_OMNI_ID = "seed-runway-seedance2-5-omni";

const seedance25Create = (path: string, promptImage?: unknown): HttpOperation => ({
  method: "POST",
  path,
  headers: HEADERS,
  body: {
    model: "seedance2_5",
    promptText: "{{request.prompt}}",
    ...(typeof promptImage !== "undefined" ? { promptImage } : {}),
    audio: "{{request.params.generate_audio}}",
    duration: "{{request.params.duration}}",
    ratio: "{{request.params.aspect_ratio}}",
    reference_image_urls: "{{request.params.reference_image_urls}}",
    reference_video_urls: "{{request.params.reference_video_urls}}",
    reference_audio_urls: "{{request.params.reference_audio_urls}}",
  },
  request_transform: "runway-seedance2-5",
  paramMap: { drops: ["resolution", "return_last_frame"], rules: [] },
  response_mapping: { task_id: "id" },
  provider_meta_mapping: { task_id: "id" },
});

const SEEDANCE25_T2V = seedance25Create("/v1/text_to_video");
const SEEDANCE25_FIRST = seedance25Create("/v1/image_to_video", "{{request.params.first_frame_url}}");
const SEEDANCE25_FIRSTLAST = seedance25Create("/v1/image_to_video", [
  { uri: "{{request.params.first_frame_url}}", position: "first" },
  { uri: "{{request.params.last_frame_url}}", position: "last" },
]);
const SEEDANCE25_OMNI = seedance25Create("/v1/text_to_video");

type RunwayVideoSpec = {
  modelKey: string;
  labelZh: string;
  archetypeId: string;
  /** The OpenAPI schema fields for this model family; never send fields absent from its variant. */
  fields: "seedance" | "wan" | "grok" | "hailuo" | "veo" | "happyhorse" | "gemini";
  modes?: Array<"t2v" | "i2v" | "reference">;
};

// Literal IDs are kept in source so the static ledger checker can prove every
// generated mapping has an auditable declaration (dynamic factory output alone
// is intentionally not trusted by the gate).
export const RUNWAY_VIDEO_MAPPING_IDS = [
  "seed-runway-seedance2-t2v", "seed-runway-seedance2-i2v", "seed-runway-seedance2-reference",
  "seed-runway-seedance2_fast-t2v", "seed-runway-seedance2_fast-i2v", "seed-runway-seedance2_fast-reference",
  "seed-runway-seedance2_mini-t2v", "seed-runway-seedance2_mini-i2v", "seed-runway-seedance2_mini-reference",
  "seed-runway-wan3-t2v", "seed-runway-wan3-i2v", "seed-runway-wan3-reference",
  "seed-runway-grok_imagine_1_5-t2v", "seed-runway-grok_imagine_1_5-i2v", "seed-runway-grok_imagine_1_5-reference",
  "seed-runway-hailuo3-t2v", "seed-runway-hailuo3-i2v", "seed-runway-hailuo3-reference",
  "seed-runway-veo3-1-t2v", "seed-runway-veo3-1-i2v", "seed-runway-veo3-1-reference",
  "seed-runway-veo3-1_fast-t2v", "seed-runway-veo3-1_fast-i2v", "seed-runway-veo3-1_fast-reference",
  "seed-runway-happyhorse_1_0-t2v", "seed-runway-gemini_omni_flash-t2v", "seed-runway-gemini_omni_flash-i2v", "seed-runway-gemini_omni_flash-reference",
] as const;

export const RUNWAY_IMAGE_MAPPING_IDS = [
  "seed-runway-muse_image-t2i", "seed-runway-muse_image-i2i",
  "seed-runway-grok_imagine_image_2-t2i", "seed-runway-grok_imagine_image_2-i2i",
  "seed-runway-seedream5_pro-t2i", "seed-runway-seedream5_pro-i2i",
  "seed-runway-seedream5_lite-t2i", "seed-runway-seedream5_lite-i2i",
  "seed-runway-gen4_image-t2i",
  "seed-runway-gen4_image_turbo-i2i",
  "seed-runway-gemini_image3_pro-t2i", "seed-runway-gemini_image3_pro-i2i",
  "seed-runway-gemini_image3-1_flash-t2i", "seed-runway-gemini_image3-1_flash-i2i",
  "seed-runway-gpt_image_2-t2i", "seed-runway-gpt_image_2-i2i",
  "seed-runway-gemini_2-5_flash-t2i", "seed-runway-gemini_2-5_flash-i2i",
] as const;

export const RUNWAY_AUDIO_MAPPING_IDS = [
  "seed-runway-seed-audio-sfx", "seed-runway-seed-audio-tts",
  "seed-runway-eleven_text_to_sound_v2-sfx",
  "seed-runway-eleven_multilingual_v2-speech", "seed-runway-eleven_v3-speech",
] as const;

const RUNWAY_VIDEO_SPECS: RunwayVideoSpec[] = [
  { modelKey: "seedance2", labelZh: "Runway Seedance 2", archetypeId: "runway-video", fields: "seedance" },
  { modelKey: "seedance2_fast", labelZh: "Runway Seedance 2 Fast", archetypeId: "runway-video", fields: "seedance" },
  { modelKey: "seedance2_mini", labelZh: "Runway Seedance 2 Mini", archetypeId: "runway-video", fields: "seedance" },
  { modelKey: "wan3", labelZh: "Runway Wan 3", archetypeId: "runway-video", fields: "wan" },
  { modelKey: "grok_imagine_1_5", labelZh: "Runway Grok Imagine 1.5", archetypeId: "runway-video", fields: "grok" },
  { modelKey: "hailuo3", labelZh: "Runway Hailuo 3", archetypeId: "runway-video", fields: "hailuo" },
  { modelKey: "veo3.1", labelZh: "Runway Veo 3.1", archetypeId: "runway-video", fields: "veo" },
  { modelKey: "veo3.1_fast", labelZh: "Runway Veo 3.1 Fast", archetypeId: "runway-video", fields: "veo" },
  { modelKey: "happyhorse_1_0", labelZh: "Runway HappyHorse 1.0", archetypeId: "runway-video", fields: "happyhorse", modes: ["t2v", "i2v"] },
  { modelKey: "gemini_omni_flash", labelZh: "Runway Gemini Omni Flash", archetypeId: "runway-video", fields: "gemini" },
];

type RunwayVideoMode = "t2v" | "i2v" | "reference";

function runwayVideoCreate(spec: RunwayVideoSpec, modeId: RunwayVideoMode): HttpOperation {
  const withImage = modeId === "i2v";
  const withReferences = modeId === "reference";
  const body: Record<string, unknown> = {
    promptText: "{{request.prompt}}",
    ...(withImage ? { promptImage: "{{request.params.image_url}}" } : {}),
    model: spec.modelKey,
  };
  if (spec.fields === "seedance") Object.assign(body, { audio: "{{request.params.generate_audio}}", duration: "{{request.params.duration}}", ratio: "{{request.params.aspect_ratio}}" });
  if (spec.fields === "wan") Object.assign(body, { audio: "{{request.params.generate_audio}}", duration: "{{request.params.duration}}", ratio: "{{request.params.aspect_ratio}}" });
  if (spec.fields === "hailuo") Object.assign(body, { duration: "{{request.params.duration}}", resolution: "{{request.params.resolution}}", ratio: "{{request.params.aspect_ratio}}" });
  if (spec.fields === "grok") Object.assign(body, { duration: "{{request.params.duration}}", resolution: "{{request.params.resolution}}", ...(!withImage ? { ratio: "{{request.params.aspect_ratio}}" } : {}) });
  if (spec.fields === "veo") Object.assign(body, { audio: "{{request.params.generate_audio}}", duration: "{{request.params.duration}}", ratio: "{{request.params.aspect_ratio}}" });
  if (spec.fields === "happyhorse") Object.assign(body, { duration: "{{request.params.duration}}", ...(withImage ? {} : { ratio: "{{request.params.aspect_ratio}}" }) });
  if (spec.fields === "gemini") Object.assign(body, { ratio: "{{request.params.aspect_ratio}}", duration: "{{request.params.duration}}" });
  if (withReferences) {
    // veo/gemini：OpenAPI 未印 reference 联合体，但 2026-09-02 实测（B 班）参考图上传 wire 校验通过
    // （文档与实测冲突以实测为准并注明日期）；仅开图参考键，视频/音频参考仍限文档确认过的族。
    if (spec.fields === "seedance" || spec.fields === "wan" || spec.fields === "hailuo" || spec.fields === "grok" || spec.fields === "veo" || spec.fields === "gemini") {
      Object.assign(body, {
        reference_image_urls: "{{request.params.reference_image_urls}}",
        ...(spec.fields === "seedance" || spec.fields === "wan" || spec.fields === "hailuo" ? { reference_video_urls: "{{request.params.reference_video_urls}}" } : {}),
        ...(spec.fields === "veo" || spec.fields === "gemini" ? {} : { reference_audio_urls: "{{request.params.reference_audio_urls}}" }),
      });
    }
  }
  const drops = spec.fields === "grok"
    ? [...(withImage ? ["aspect_ratio"] : []), "generate_audio"]
    : spec.fields === "happyhorse" && withImage
      ? ["generate_audio", "aspect_ratio"]
      : spec.fields === "hailuo" || spec.fields === "happyhorse" || spec.fields === "gemini"
      ? ["generate_audio"]
      : [];
  return {
    method: "POST",
    path: withImage ? "/v1/image_to_video" : "/v1/text_to_video",
    headers: HEADERS,
    body,
    request_transform: "runway-video-contract",
    ...(drops.length ? { paramMap: { drops, rules: [] } } : {}),
    response_mapping: { task_id: "id" },
    provider_meta_mapping: { task_id: "id" },
  };
}

function runwayVideoModel(spec: RunwayVideoSpec): RunwayModel {
  const modes = spec.modes || ["t2v", "i2v", "reference"];
  return {
    modelKey: spec.modelKey,
    labelZh: spec.labelZh,
    kind: "video",
    archetypeId: spec.archetypeId,
    mappings: modes.map((modeId) => {
      const taskKind: ProfileKind = modeId === "i2v" ? "image_to_video" : "text_to_video";
      const op = runwayVideoCreate(spec, modeId);
      return mapping(`seed-runway-${spec.modelKey.replace(/\./g, "-")}-${modeId}`, modeId, taskKind, `${spec.labelZh} · ${modeId === "t2v" ? "文生视频" : modeId === "reference" ? "多图参考" : "图生视频"}`, op);
    }),
  };
}

type RunwayImageSpec = { modelKey: string; labelZh: string; allowReferences?: boolean; outputCount?: boolean; requiresReferences?: boolean };
const RUNWAY_IMAGE_SPECS: RunwayImageSpec[] = [
  { modelKey: "muse_image", labelZh: "Runway Muse Image", allowReferences: true, outputCount: true },
  { modelKey: "grok_imagine_image_2", labelZh: "Runway Grok Imagine Image 2", allowReferences: true, outputCount: true },
  { modelKey: "seedream5_pro", labelZh: "Runway Seedream 5 Pro", allowReferences: true, outputCount: true },
  { modelKey: "seedream5_lite", labelZh: "Runway Seedream 5 Lite", allowReferences: true, outputCount: true },
  { modelKey: "gen4_image", labelZh: "Runway Gen-4 Image", allowReferences: false },
  { modelKey: "gen4_image_turbo", labelZh: "Runway Gen-4 Image Turbo", allowReferences: true, requiresReferences: true },
  { modelKey: "gemini_image3_pro", labelZh: "Runway Gemini Image 3 Pro", allowReferences: true },
  { modelKey: "gemini_image3.1_flash", labelZh: "Runway Gemini Image 3.1 Flash", allowReferences: true },
  { modelKey: "gpt_image_2", labelZh: "Runway GPT Image 2", allowReferences: true },
  { modelKey: "gemini_2.5_flash", labelZh: "Runway Gemini 2.5 Flash Image", allowReferences: true },
];

function runwayImageModel(spec: RunwayImageSpec): RunwayModel {
  const operation = (withReferences: boolean): HttpOperation => ({
    method: "POST",
    path: "/v1/text_to_image",
    headers: HEADERS,
    body: {
      promptText: "{{request.prompt}}",
      ratio: "{{request.params.aspect_ratio}}",
      ...(spec.outputCount ? { outputCount: "{{request.params.output_count}}" } : {}),
      ...(withReferences || spec.requiresReferences ? { reference_image_urls: "{{request.params.reference_image_urls}}" } : {}),
      model: spec.modelKey,
    },
    // 始终挂 runway-image-references：它现在同时承载**按模型判别的 ratio 重映射**（muse/gpt/seedream5_lite
    // 的枚举不含共享默认比例 → 不映射就恒 400）。纯 t2i（无参考）过去不挂它，正是这三个模型文生图挂掉的原因。
    request_transform: "runway-image-references",
    ...(!spec.outputCount ? { paramMap: { drops: ["output_count"], rules: [] } } : {}),
    response_mapping: { task_id: "id" },
    provider_meta_mapping: { task_id: "id" },
  });
  const mappings: RunwayModel["mappings"] = [];
  if (!spec.requiresReferences) {
    const t2i = mapping(`seed-runway-${spec.modelKey.replace(/\./g, "-")}-t2i`, "t2i", "text_to_image", `${spec.labelZh} · 文生图`, operation(false));
    t2i.query = imagePoll;
    t2i.result = imageResult;
    mappings.push(t2i);
  }
  if (spec.allowReferences) {
    const i2i = mapping(`seed-runway-${spec.modelKey.replace(/\./g, "-")}-i2i`, "i2i", "image_edit", `${spec.labelZh} · 参考/改图`, operation(true));
    i2i.query = imagePoll;
    i2i.result = imageResult;
    mappings.push(i2i);
  }
  return { modelKey: spec.modelKey, labelZh: spec.labelZh, kind: "image", archetypeId: spec.requiresReferences ? "runway-image-reference" : "runway-image", mappings } as RunwayModel;
}

export const RUNWAY_OFFICIAL_MODELS: RunwayModel[] = [
  {
    modelKey: "gen4.5",
    labelZh: "Runway Gen-4.5",
    kind: "video",
    archetypeId: "runway-gen4.5",
    mappings: [
      mapping(GEN45_T2V_ID, "t2v", "text_to_video", "Runway Gen-4.5 · 文生视频", GEN45_T2V),
      mapping(GEN45_I2V_ID, "i2v", "image_to_video", "Runway Gen-4.5 · 图生视频", GEN45_I2V),
    ],
  },
  {
    modelKey: "gen4_turbo",
    labelZh: "Runway Gen-4 Turbo",
    kind: "video",
    archetypeId: "runway-gen4-turbo",
    mappings: [mapping(GEN4_TURBO_I2V_ID, "i2v", "image_to_video", "Runway Gen-4 Turbo · 图生视频", GEN4_TURBO_I2V)],
  },
  {
    modelKey: "seedance2_5",
    labelZh: "Runway Seedance 2.5",
    kind: "video",
    archetypeId: "seedance-2.5-runway",
    mappings: [
      mapping(SEEDANCE25_T2V_ID, "t2v", "text_to_video", "Runway Seedance 2.5 · 文生视频", SEEDANCE25_T2V),
      mapping(SEEDANCE25_FIRST_ID, "first", "image_to_video", "Runway Seedance 2.5 · 首帧", SEEDANCE25_FIRST),
      mapping(SEEDANCE25_FIRSTLAST_ID, "firstlast", "image_to_video", "Runway Seedance 2.5 · 首尾帧", SEEDANCE25_FIRSTLAST),
      mapping(SEEDANCE25_OMNI_ID, "omni", "text_to_video", "Runway Seedance 2.5 · 全能参考", SEEDANCE25_OMNI),
    ],
  },
  RUNWAY_AUDIO_MODEL,
  ...RUNWAY_ELEVEN_AUDIO_MODELS,
  ...RUNWAY_VIDEO_SPECS.map(runwayVideoModel),
  ...RUNWAY_IMAGE_SPECS.map(runwayImageModel),
];

export const RUNWAY_OFFICIAL_ENDPOINTS = [
  "POST /v1/text_to_video",
  "POST /v1/image_to_video",
  "POST /v1/video_to_video",
  "POST /v1/text_to_image",
  "POST /v1/image_upscale",
  "POST /v1/video_upscale",
  "POST /v1/video_to_hdr",
  "POST /v1/avatar_videos",
  "POST /v1/character_performance",
  "POST /v1/sound_effect",
  "POST /v1/text_to_speech",
  "POST /v1/speech_to_speech",
  "POST /v1/voice_dubbing",
  "POST /v1/voice_isolation",
  "GET /v1/tasks/{id}",
  "POST /v1/uploads",
  "POST signed upload",
] as const;

/**
 * Official catalog entries that are intentionally not published as mappings.
 * Aleph 2 is video-to-video only and Act Two requires a character/reference
 * object with performance controls; neither has a faithful existing ProfileKind
 * or archetype slot. Keeping this declaration explicit prevents accidental
 * coercion into image_to_video and makes the gap visible in certification.
 */
export const RUNWAY_OFFICIAL_BLOCKERS = [
  { modelKey: "aleph2", reason: "video_to_video_only_profile_kind_missing" },
  { modelKey: "act_two", reason: "specialized_character_performance_schema_missing" },
  { modelKey: "gwm1_avatars", reason: "realtime_avatar_profile_kind_missing" },
  { modelKey: "magnific_precision_upscaler_v2", reason: "image_upscale_profile_kind_missing" },
  { modelKey: "magnific_video_upscaler_creative", reason: "video_upscale_profile_kind_missing" },
  { modelKey: "ruby", reason: "video_to_hdr_profile_kind_missing" },
  { modelKey: "eleven_voice_isolation", reason: "audio_to_audio_profile_kind_missing" },
  { modelKey: "eleven_voice_dubbing", reason: "audio_to_audio_profile_kind_missing" },
  { modelKey: "eleven_multilingual_sts_v2", reason: "audio_to_audio_profile_kind_missing" },
] as const;
