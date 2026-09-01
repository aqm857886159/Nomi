import type { HttpOperation, ProfileKind } from "./types";
import { registerRequestTransform, type RequestTransformContext } from "../tasks/requestTransforms";
import { desktopT } from "../i18n";

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

  // The current shared ratio defaults are intentionally friendly strings;
  // map them to the official discriminator enums at the transport boundary.
  const ratio = String(input.ratio || "").trim();
  const ratioFamilies: Record<string, readonly string[]> = {
    seedance: ["992:432", "864:496", "752:560", "640:640", "560:752", "496:864", "1470:630", "1280:720", "1112:834", "960:960", "834:1112", "720:1280", "2206:946", "1920:1080", "1664:1248", "1440:1440", "1248:1664", "1080:1920", "3840:1646", "3840:2160", "3840:2880", "3840:3840", "2880:3840", "2160:3840"],
    wan: ["832:480", "640:480", "480:480", "480:640", "480:832", "1280:720", "960:720", "720:720", "720:960", "720:1280", "1920:1080", "1440:1080", "1080:1080", "1080:1440", "1080:1920", "auto_480p", "auto_720p", "auto_1080p"],
    hailuo: ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    grok: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
    veo: ["1280:720", "720:1280", "1080:1920", "1920:1080"],
    happyhorse: ["1280:720", "720:1280", "960:960", "1108:832", "832:1108", "1920:1080", "1080:1920", "1440:1440", "1662:1248", "1248:1662"],
    gemini: ["1280:720", "720:1280"],
  };
  const family = model.startsWith("seedance2") ? "seedance"
    : model === "wan3" ? "wan"
      : model === "hailuo3" ? "hailuo"
        : model === "grok_imagine_1_5" ? "grok"
          : model.startsWith("veo3.1") ? "veo"
            : model === "happyhorse_1_0" ? "happyhorse"
              : model === "gemini_omni_flash" ? "gemini"
                : null;
  if (family && ratio && !ratioFamilies[family].includes(ratio)) {
    const normalized = ratio === "16:9" || (ratio === "1280:720" && (family === "hailuo" || family === "grok"))
      ? (family === "hailuo" || family === "grok" ? "16:9" : "1280:720")
      : ratio === "9:16" || (ratio === "720:1280" && (family === "hailuo" || family === "grok"))
        ? (family === "hailuo" || family === "grok" ? "9:16" : "720:1280")
        : undefined;
    if (normalized) input.ratio = normalized;
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

/**
 * Runway 的 `/v1/text_to_image` 是**按模型判别的 union**：每个 image 模型有各自的 `ratio` 枚举，
 * 共享 archetype 的比例列表（1024:1024 / 1280:720 / …）**只是其中一部分模型的合法值**。
 * 依据 = Runway 官方 OpenAPI 规范（一手、机读，2026-09-01 照
 *   https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json 对账；`/v1/text_to_image` 为 10-变体
 *   `oneOf`，discriminator=`model`，各变体 `properties.ratio.enum` 逐一列出）：
 *     muse_image  → ["2352:1008","2016:1152","1920:1280","1792:1344","1600:1600","1344:1792","1280:1920","1152:2016","auto"]（**无 1024:1024**）
 *     gpt_image_2 → ["2048:880","1920:1088",…,"1920:1920",…,"2560:1440",…,"1440:2560",…,"auto"]（**无 1024:1024**，2048 系起）
 *     seedream5_lite → ["2048:2048","2304:1728","1728:2304","2848:1600","1600:2848","2496:1664","1664:2496",…]（**无 1024:1024**，全 ≥ 400 万像素）
 *   （反例：seedream5_pro / grok_imagine_image_2 / gen4_image 的 enum **含** 1024:1024 → 不 remap，原样透传。）
 * 2026-09-01 真发 t2i 实测复核（提交即 DELETE，见 /tmp/runway-ratio-probe.mjs）：这三个模型发共享默认 `1024:1024`
 * 全 400 `Validation of body failed`；发下方各自映射值全 ACCEPTED（含 seedream5_pro/grok/gen4 发 1024:1024 仍 ACCEPTED，
 * 证明只该动这三个）。视频侧同类问题早已由 normalizeRunwayVideoContract 的 ratioFamilies 解，图像侧一直漏了。
 * 这里按**朝向**把共享比例映射到各模型 enum 里的合法值（视频侧 ratioFamilies 的图像对偶）。
 *
 * 注·seedream5_lite「freeform」：OpenAPI 把它的 ratio 标成**严格 enum**（上列），但 2026-09-01 实测该模型
 *   **也接受 enum 外的自由 `<w>:<h>`**（如 `2720:1530` 亦 ACCEPTED，只要满足 ~3.68M–16.7M 像素窗）——即活网关比
 *   spec 宽松。**此处仍取 spec 列出的 `2848:1600`/`1600:2848`**（既在 enum、又实测通过），对未来收严 fail-safe，
 *   不押注未文档化的宽松行为。
 */
const RUNWAY_IMAGE_RATIO_REMAP: Record<string, { square: string; landscape: string; portrait: string }> = {
  // muse_image enum：方=1600:1600、横=2016:1152、竖=1152:2016（均 spec 列出 + 实测 ACCEPTED）。
  muse_image: { square: "1600:1600", landscape: "2016:1152", portrait: "1152:2016" },
  // gpt_image_2 enum（2048 系起）：方=1920:1920、横=2560:1440、竖=1440:2560（均 spec 列出 + 实测 ACCEPTED）。
  gpt_image_2: { square: "1920:1920", landscape: "2560:1440", portrait: "1440:2560" },
  // seedream5_lite enum（全 ≥3.68M px）：方=2048:2048、横=2848:1600、竖=1600:2848（均 spec 列出 + 实测 ACCEPTED）。
  seedream5_lite: { square: "2048:2048", landscape: "2848:1600", portrait: "1600:2848" },
};

/** 从共享 ratio（"1024:1024" / "1280:720" / "auto_1k"…）判朝向。auto_* 视为方形。 */
function runwayRatioOrientation(ratio: string): "square" | "landscape" | "portrait" {
  const m = ratio.match(/^(\d+)\s*[:x]\s*(\d+)$/);
  if (!m) return "square"; // auto_1k / auto_2k / 未知 → 方
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h || w === h) return "square";
  return w > h ? "landscape" : "portrait";
}

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

function runwayVideoCreate(spec: RunwayVideoSpec, withImage: boolean, withReferences: boolean): HttpOperation {
  const body: Record<string, unknown> = {
    promptText: "{{request.prompt}}",
    ...(withImage ? { promptImage: withReferences ? "{{request.params.reference_image_urls}}" : "{{request.params.image_url}}" } : {}),
    model: spec.modelKey,
  };
  if (spec.fields === "seedance") Object.assign(body, { audio: "{{request.params.generate_audio}}", duration: "{{request.params.duration}}", ratio: "{{request.params.aspect_ratio}}" });
  if (spec.fields === "wan") Object.assign(body, { audio: "{{request.params.generate_audio}}", duration: "{{request.params.duration}}", ratio: "{{request.params.aspect_ratio}}" });
  if (spec.fields === "hailuo") Object.assign(body, { duration: "{{request.params.duration}}", resolution: "{{request.params.resolution}}", ratio: "{{request.params.aspect_ratio}}" });
  if (spec.fields === "grok") Object.assign(body, { duration: "{{request.params.duration}}", resolution: "{{request.params.resolution}}" });
  if (spec.fields === "veo") Object.assign(body, { audio: "{{request.params.generate_audio}}", duration: "{{request.params.duration}}", ratio: "{{request.params.aspect_ratio}}" });
  if (spec.fields === "happyhorse") Object.assign(body, { duration: "{{request.params.duration}}", ...(withImage ? {} : { ratio: "{{request.params.aspect_ratio}}" }) });
  if (spec.fields === "gemini") Object.assign(body, { ratio: "{{request.params.aspect_ratio}}", duration: "{{request.params.duration}}" });
  if (withReferences) {
    if (spec.fields === "seedance" || spec.fields === "wan" || spec.fields === "hailuo" || spec.fields === "grok") {
      Object.assign(body, {
        reference_image_urls: "{{request.params.reference_image_urls}}",
        ...(spec.fields === "seedance" || spec.fields === "wan" || spec.fields === "hailuo" ? { reference_video_urls: "{{request.params.reference_video_urls}}" } : {}),
        reference_audio_urls: "{{request.params.reference_audio_urls}}",
      });
    }
  }
  const drops = spec.fields === "grok"
    ? ["aspect_ratio", "generate_audio"]
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
      const taskKind: ProfileKind = modeId === "t2v" ? "text_to_video" : "image_to_video";
      const withReferences = modeId === "reference";
      const op = runwayVideoCreate(spec, taskKind === "image_to_video", withReferences);
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
    archetypeId: "seedance-2.5",
    mappings: [
      mapping(SEEDANCE25_T2V_ID, "t2v", "text_to_video", "Runway Seedance 2.5 · 文生视频", SEEDANCE25_T2V),
      mapping(SEEDANCE25_FIRST_ID, "first", "image_to_video", "Runway Seedance 2.5 · 首帧", SEEDANCE25_FIRST),
      mapping(SEEDANCE25_FIRSTLAST_ID, "firstlast", "image_to_video", "Runway Seedance 2.5 · 首尾帧", SEEDANCE25_FIRSTLAST),
      mapping(SEEDANCE25_OMNI_ID, "omni", "image_to_video", "Runway Seedance 2.5 · 全能参考", SEEDANCE25_OMNI),
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
