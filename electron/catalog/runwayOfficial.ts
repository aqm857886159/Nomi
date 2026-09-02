import type { HttpOperation, ProfileKind } from "./types";
import { registerRequestTransform, type RequestTransformContext } from "../tasks/requestTransforms";
import { desktopT } from "../i18n";
// Runway union 的线缆事实（比例枚举 / 时长约束 / 哪些族发布 reference 数组）住 shared，
// 由**能力面（各档案 vendorParams.runway）与本文件的传输归一器共用**。catalog → shared 是允许
// 的依赖方向（shared 永不反向 import catalog）。在这里重抄一份就是第二个作者，正是本轮修的病。
import {
  RUNWAY_FAMILIES_WITHOUT_IMAGE_RATIO,
  RUNWAY_FAMILIES_WITH_IMAGE_REFS,
  RUNWAY_FAMILIES_WITH_VIDEO_REFS,
  RUNWAY_VEO_FALLBACK_DURATION,
  RUNWAY_VIDEO_DURATION_ENUMS,
  runwayVideoFamilyForModel,
} from "../shared/videoCapabilities/runwayWireFacts";
// 图像侧的比例几何（与视频侧无重叠）继续住 catalog/runwayRatio.ts；`normalizeRunwayVideoRatio`
// 也在那里，但它现在从上面这张 shared 表 derive 枚举与判别（不再自持副本）。
import { normalizeRunwayVideoRatio } from "./runwayRatio";
// Runway 目录共享底座（拆图像目录时依赖反转出来，见该文件头注释）。
import { POLL_HEADERS, RUNWAY_HEADERS, runwayMapping, runwayUriArray, STATUS, type RunwayModel } from "./runwayShared";
// 图像目录（10 行 + 归一器）已拆出（R9 巨壳门岗）；本 import 同时完成
// `runway-image-references` 请求变换的注册，故必须在建表前发生。
import { RUNWAY_IMAGE_SPECS, runwayImageModel } from "./runwayImage";

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


const create = (path: string, model: string, withImage: boolean): HttpOperation => ({
  method: "POST",
  path,
  headers: RUNWAY_HEADERS,
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
  const images = runwayUriArray(input.reference_image_urls);
  const videos = runwayUriArray(input.reference_video_urls);
  const audios = runwayUriArray(input.reference_audio_urls);
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
  //
  // **纵深防御，不是唯一防线**：UI 侧的 `vendorParams.runway` 已经只给得出合法值（与归一器同一张
  // `runwayWireFacts` 表 derive），所以正常走 UI 的请求到这里本就是合法的。这段留着是为**绕过 UI
  // 的调用方**（headless / MCP / 存量节点带着旧值复活）——它们同样发不出非法值。
  //
  // 判别只有一份：`runwayVideoFamilyForModel` 住 shared，归一器与能力面共用（此前这里另有一条
  // 内联 `startsWith` 链 = 第二个作者，正是本轮修的病）。
  const ratio = String(input.ratio || "").trim();
  const family = runwayVideoFamilyForModel(model);
  if (family && ratio) {
    const mapped = normalizeRunwayVideoRatio(model, ratio);
    if (mapped) input.ratio = mapped;
    else delete input.ratio;
  }

  // Veo only accepts 4/6/8 seconds; choose the cheapest valid duration for
  // the shared control's default instead of sending a guaranteed 400.
  const durations = family ? RUNWAY_VIDEO_DURATION_ENUMS[family] : undefined;
  if (durations && input.duration !== undefined) {
    const duration = Number(input.duration);
    input.duration = durations.includes(duration) ? duration : RUNWAY_VEO_FALLBACK_DURATION;
  }
  // HappyHorse image-to-video has no ratio property in the official schema.
  if (family && hasPromptImage && RUNWAY_FAMILIES_WITHOUT_IMAGE_RATIO.includes(family)) delete input.ratio;

  // Reference arrays are supported only by the discriminators that publish
  // them.  The UI supplies URL arrays; translate them into Runway's typed
  // reference objects without allowing unsupported video/audio fields to
  // leak into a different model variant.
  const imageRefs = runwayUriArray(input.reference_image_urls);
  const videoRefs = runwayUriArray(input.reference_video_urls);
  const audioRefs = runwayUriArray(input.reference_audio_urls);
  delete input.reference_image_urls;
  delete input.reference_video_urls;
  delete input.reference_audio_urls;
  const allowsImage = family !== null && RUNWAY_FAMILIES_WITH_IMAGE_REFS.includes(family);
  const allowsVideo = family !== null && RUNWAY_FAMILIES_WITH_VIDEO_REFS.includes(family);
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

/** seed_audio accepts referenceAudios as plain provider URI strings (max 3). */
function normalizeRunwayAudioReferences(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(desktopT("runway.audioBody"));
  const input = body as Record<string, unknown>;
  const refs = runwayUriArray(input.reference_audio_urls);
  if (refs.length > 3) throw new Error(desktopT("runway.maxAudioReferences", { count: 3 }));
  delete input.reference_audio_urls;
  if (refs.length) input.referenceAudios = refs;
  return input;
}

registerRequestTransform("runway-audio-references", normalizeRunwayAudioReferences, (body) => {
  normalizeRunwayAudioReferences(body);
});


// Keep an explicit result stage so ProductionRun can verify the final output
// after status observation. Runway uses the same task detail endpoint for both.

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


const RUNWAY_AUDIO_SFX_ID = "seed-runway-seed-audio-sfx";
const RUNWAY_AUDIO_TTS_ID = "seed-runway-seed-audio-tts";
const RUNWAY_AUDIO_SFX_CREATE: HttpOperation = {
  method: "POST",
  path: "/v1/sound_effect",
  headers: RUNWAY_HEADERS,
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
  headers: RUNWAY_HEADERS,
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
  headers: RUNWAY_HEADERS,
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
  headers: RUNWAY_HEADERS,
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
  headers: RUNWAY_HEADERS,
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

/**
 * Runway's three video wire roles. These describe **the request shape Runway accepts**, not a
 * UI mode name — the two used to be conflated because every row pointed at one platform-shaped
 * `runway-video` archetype whose mode ids happened to be spelled the same as the roles.
 *
 *  - `t2v`      → POST /v1/text_to_video, no image field.
 *  - `image`    → POST /v1/image_to_video with the single-image `promptImage` aggregate slot.
 *  - `refs`     → POST /v1/image_to_video with the multi-reference `reference_image_urls` body.
 */
type RunwayVideoWireRole = "t2v" | "image" | "refs";

type RunwayVideoSpec = {
  modelKey: string;
  labelZh: string;
  /** The **real model** archetype this Runway row is an instance of (one model, one archetype owner). */
  archetypeId: string;
  /** The OpenAPI schema fields for this model family; never send fields absent from its variant. */
  fields: "seedance" | "wan" | "grok" | "hailuo" | "veo" | "happyhorse" | "gemini";
  /**
   * Runway wire role → **the receiving archetype's own mode id**.
   *
   * Why this is a map and not a list: the mapping's `modeId` must equal a mode id that actually
   * exists on the archetype, otherwise `selectTaskMapping` hands the mode a cable that belongs to
   * a different mode (the "mode borrowing" defect class). The archetypes name the same concepts
   * differently — Seedance's single image mode is `first`, Veo's is `frame`, Gemini Omni's is
   * `firstlast`, minimax/happyhorse/grok call theirs `i2v`. Omitting a role means Runway's union
   * does not offer it for this model (e.g. veo/gemini have no reference field in the OpenAPI union).
   */
  modes: Partial<Record<RunwayVideoWireRole, string>>;
};

// Literal IDs are kept in source so the static ledger checker can prove every
// generated mapping has an auditable declaration (dynamic factory output alone
// is intentionally not trusted by the gate).
// Ids are keyed on the Runway **wire role** (`t2v` / `image` / `refs`), not on a UI mode name:
// the receiving archetypes spell the same role differently (`first` / `frame` / `firstlast` /
// `i2v`), and the id must stay stable when a mode is renamed. Roles a model's Runway union does
// not offer are simply absent — grok/veo/happyhorse/gemini have no reference field.
export const RUNWAY_VIDEO_MAPPING_IDS = [
  "seed-runway-seedance2-t2v", "seed-runway-seedance2-image", "seed-runway-seedance2-refs",
  "seed-runway-seedance2_fast-t2v", "seed-runway-seedance2_fast-image", "seed-runway-seedance2_fast-refs",
  "seed-runway-seedance2_mini-t2v", "seed-runway-seedance2_mini-image", "seed-runway-seedance2_mini-refs",
  "seed-runway-wan3-t2v", "seed-runway-wan3-image", "seed-runway-wan3-refs",
  "seed-runway-grok_imagine_1_5-t2v", "seed-runway-grok_imagine_1_5-image",
  "seed-runway-hailuo3-t2v", "seed-runway-hailuo3-image", "seed-runway-hailuo3-refs",
  "seed-runway-veo3-1-t2v", "seed-runway-veo3-1-image",
  "seed-runway-veo3-1_fast-t2v", "seed-runway-veo3-1_fast-image",
  "seed-runway-happyhorse_1_0-t2v", "seed-runway-happyhorse_1_0-image",
  "seed-runway-gemini_omni_flash-t2v", "seed-runway-gemini_omni_flash-image",
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

/**
 * **One model, one archetype owner.** Every row points at the archetype of the *real model*
 * Runway is reselling, not at a Runway-shaped platform archetype.
 *
 * The previous shape (`archetypeId: "runway-video"` on all ten rows) put a platform-shaped
 * capability face on ten different model identities while the `runwayVideoCreate` wire switch
 * right below already branched per model. Two authors for one fact drift by construction: the
 * capability face advertised Runway's generic `1280:720 / 1–30s / generate_audio` and a
 * multi-reference mode to models whose official unions have neither.
 */
const RUNWAY_VIDEO_SPECS: RunwayVideoSpec[] = [
  { modelKey: "seedance2", labelZh: "Runway Seedance 2", archetypeId: "seedance-2", fields: "seedance", modes: { t2v: "t2v", image: "first", refs: "omni" } },
  { modelKey: "seedance2_fast", labelZh: "Runway Seedance 2 Fast", archetypeId: "seedance-2", fields: "seedance", modes: { t2v: "t2v", image: "first", refs: "omni" } },
  { modelKey: "seedance2_mini", labelZh: "Runway Seedance 2 Mini", archetypeId: "seedance-2", fields: "seedance", modes: { t2v: "t2v", image: "first", refs: "omni" } },
  { modelKey: "wan3", labelZh: "Runway Wan 3", archetypeId: "wan-3.0", fields: "wan", modes: { t2v: "t2v", image: "first", refs: "ref" } },
  // grok-imagine-1.5-video declares only t2v + i2v — no reference mode exists to point at.
  { modelKey: "grok_imagine_1_5", labelZh: "Runway Grok Imagine 1.5", archetypeId: "grok-imagine-1.5-video", fields: "grok", modes: { t2v: "t2v", image: "i2v" } },
  { modelKey: "hailuo3", labelZh: "Runway Hailuo 3", archetypeId: "minimax-h3", fields: "hailuo", modes: { t2v: "t2v", image: "i2v", refs: "ref" } },
  // Runway's veo union carries promptImage only; it has no reference field, so no refs role.
  { modelKey: "veo3.1", labelZh: "Runway Veo 3.1", archetypeId: "veo-3.1", fields: "veo", modes: { t2v: "t2v", image: "frame" } },
  { modelKey: "veo3.1_fast", labelZh: "Runway Veo 3.1 Fast", archetypeId: "veo-3.1", fields: "veo", modes: { t2v: "t2v", image: "frame" } },
  { modelKey: "happyhorse_1_0", labelZh: "Runway HappyHorse 1.0", archetypeId: "happyhorse", fields: "happyhorse", modes: { t2v: "t2v", image: "i2v" } },
  // Same as veo: Runway's gemini union has no reference field.
  { modelKey: "gemini_omni_flash", labelZh: "Runway Gemini Omni Flash", archetypeId: "gemini-omni-1.1", fields: "gemini", modes: { t2v: "t2v", image: "firstlast" } },
];

/**
 * `withImage` 只对**单图**角色为真：多图参考角色走 `POST /v1/text_to_video`（PR #342 —— Runway 的
 * reference 联合体印在文生端点上，此前误发 image_to_video 且把参考数组塞进 `promptImage`）。
 * 故 `withImage` 与 `withReferences` 互斥，端点由前者决定。
 */
function runwayVideoCreate(spec: RunwayVideoSpec, role: RunwayVideoWireRole): HttpOperation {
  const withImage = role === "image";
  const withReferences = role === "refs";
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
    headers: RUNWAY_HEADERS,
    body,
    request_transform: "runway-video-contract",
    ...(drops.length ? { paramMap: { drops, rules: [] } } : {}),
    response_mapping: { task_id: "id" },
    provider_meta_mapping: { task_id: "id" },
  };
}

const RUNWAY_VIDEO_ROLE_ORDER: RunwayVideoWireRole[] = ["t2v", "image", "refs"];
const RUNWAY_VIDEO_ROLE_LABEL: Record<RunwayVideoWireRole, string> = {
  t2v: "文生视频",
  image: "图生视频",
  refs: "多图参考",
};

function runwayVideoModel(spec: RunwayVideoSpec): RunwayModel {
  return {
    modelKey: spec.modelKey,
    labelZh: spec.labelZh,
    kind: "video",
    archetypeId: spec.archetypeId,
    // Mapping id stays keyed on the **wire role** (stable across archetype renames, and it is
    // what RUNWAY_VIDEO_MAPPING_IDS / the static ledger checker declare); `modeId` carries the
    // receiving archetype's own mode id so no mode is ever handed another mode's cable.
    //
    // `taskKind` follows the **wire role's endpoint**, not "is there an image involved":
    // the multi-image reference role rides `POST /v1/text_to_video` (PR #342 — Runway's
    // reference union is declared on the text endpoint), so only the single-image `image`
    // role is an `image_to_video` task.
    mappings: RUNWAY_VIDEO_ROLE_ORDER.flatMap((role) => {
      const modeId = spec.modes[role];
      if (!modeId) return [];
      const taskKind: ProfileKind = role === "image" ? "image_to_video" : "text_to_video";
      const op = runwayVideoCreate(spec, role);
      return [runwayMapping(
        `seed-runway-${spec.modelKey.replace(/\./g, "-")}-${role}`,
        modeId,
        taskKind,
        `${spec.labelZh} · ${RUNWAY_VIDEO_ROLE_LABEL[role]}`,
        op,
      )];
    }),
  };
}

export const RUNWAY_OFFICIAL_MODELS: RunwayModel[] = [
  {
    modelKey: "gen4.5",
    labelZh: "Runway Gen-4.5",
    kind: "video",
    archetypeId: "runway-gen4.5",
    mappings: [
      runwayMapping(GEN45_T2V_ID, "t2v", "text_to_video", "Runway Gen-4.5 · 文生视频", GEN45_T2V),
      runwayMapping(GEN45_I2V_ID, "i2v", "image_to_video", "Runway Gen-4.5 · 图生视频", GEN45_I2V),
    ],
  },
  {
    modelKey: "gen4_turbo",
    labelZh: "Runway Gen-4 Turbo",
    kind: "video",
    archetypeId: "runway-gen4-turbo",
    mappings: [runwayMapping(GEN4_TURBO_I2V_ID, "i2v", "image_to_video", "Runway Gen-4 Turbo · 图生视频", GEN4_TURBO_I2V)],
  },
  {
    modelKey: "seedance2_5",
    labelZh: "Runway Seedance 2.5",
    kind: "video",
    archetypeId: "seedance-2.5-runway",
    mappings: [
      runwayMapping(SEEDANCE25_T2V_ID, "t2v", "text_to_video", "Runway Seedance 2.5 · 文生视频", SEEDANCE25_T2V),
      runwayMapping(SEEDANCE25_FIRST_ID, "first", "image_to_video", "Runway Seedance 2.5 · 首帧", SEEDANCE25_FIRST),
      runwayMapping(SEEDANCE25_FIRSTLAST_ID, "firstlast", "image_to_video", "Runway Seedance 2.5 · 首尾帧", SEEDANCE25_FIRSTLAST),
      runwayMapping(SEEDANCE25_OMNI_ID, "omni", "text_to_video", "Runway Seedance 2.5 · 全能参考", SEEDANCE25_OMNI),
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
