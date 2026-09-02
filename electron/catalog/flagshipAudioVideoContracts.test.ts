import { describe, expect, it } from "vitest";
import { applyParamMap } from "./paramTranslate";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { normalizeMinimaxH3OfficialBody } from "./minimaxOfficial";
import { FAL_OFFICIAL_ENDPOINT_COUNT, FAL_OFFICIAL_MODELS } from "./falOfficial";
import { KIE_SUNO_MUSIC_MAPPINGS, KIE_SUNO_UPLOAD_COVER_CREATE_OP, KIE_SUNO_UPLOAD_EXTEND_CREATE_OP } from "./kieSunoAudio";
import { RUNWAY_OFFICIAL_BLOCKERS, RUNWAY_OFFICIAL_ENDPOINTS, RUNWAY_VENDOR_SEED } from "./runwayOfficial";
import { applyRequestTransform } from "../tasks/requestTransforms";
import { selectTaskMapping, type CatalogState } from "./types";

function emptyCatalog(): CatalogState {
  return { version: 11, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
}

describe("2026-08 flagship media contracts", () => {
  it("seeds the exact MiniMax M3 text flagship without inventing a media mapping", () => {
    const state = applyBuiltinSeeds(emptyCatalog(), "2026-08-30T00:00:00.000Z").state;
    expect(state.models.find((item) => item.vendorKey === "minimax" && item.modelKey === "MiniMax-M3"))
      .toMatchObject({
        labelZh: "MiniMax M3",
        kind: "text",
        meta: { supportsImageInput: true, catalogLifecycle: "flagship" },
      });
    expect(state.mappings.some((item) => item.vendorKey === "minimax" && item.modelKey === "MiniMax-M3"))
      .toBe(false);
  });

  it("normalizes MiniMax H3 media roles and rejects frame/reference contract conflicts before spend", () => {
    expect(normalizeMinimaxH3OfficialBody({
      model: "MiniMax-H3",
      prompt: "A product turntable",
      first_frame_url: "https://assets.example/first.png",
      last_frame_url: "https://assets.example/last.png",
      duration: 6,
      ratio: "16:9",
    })).toEqual({
      model: "MiniMax-H3",
      duration: 6,
      ratio: "adaptive",
      content: [
        { type: "text", text: "A product turntable" },
        { type: "image_url", image_url: { url: "https://assets.example/first.png" }, role: "first_frame" },
        { type: "image_url", image_url: { url: "https://assets.example/last.png" }, role: "last_frame" },
      ],
    });
    expect(normalizeMinimaxH3OfficialBody({
      model: "MiniMax-H3",
      prompt: "Match the references",
      reference_image_urls: ["https://assets.example/look.png"],
      reference_video_urls: ["https://assets.example/motion.mp4"],
      reference_audio_urls: ["https://assets.example/beat.wav"],
    })).toMatchObject({
      content: [
        { type: "text", text: "Match the references" },
        { type: "image_url", role: "reference_image" },
        { type: "video_url", role: "reference_video" },
        { type: "audio_url", role: "reference_audio" },
      ],
    });
    expect(() => normalizeMinimaxH3OfficialBody({
      prompt: "invalid mixed roles",
      first_frame_url: "https://assets.example/first.png",
      reference_image_urls: ["https://assets.example/look.png"],
    })).toThrow(/不能同时使用/);
  });

  it("seeds Gemini Omni 1.1 as its own KIE identity and never aliases Preview", () => {
    const state = applyBuiltinSeeds(emptyCatalog(), "2026-08-30T00:00:00.000Z").state;
    const model = state.models.find((item) => item.vendorKey === "kie" && item.modelKey === "google/gemini-omni-flash-1-1");
    expect(model).toMatchObject({ kind: "video", meta: { archetypeId: "gemini-omni-1.1", catalogLifecycle: "flagship" } });

    const mappings = state.mappings.filter((item) => item.vendorKey === "kie" && item.modelKey === model?.modelKey);
    expect(mappings.map((item) => item.taskKind).sort()).toEqual(["image_to_video", "text_to_video"]);
    expect(mappings.every((item) => (item.create.body as { model: string }).model === "google/gemini-omni-flash-1-1")).toBe(true);
    expect(JSON.stringify(mappings)).not.toContain("gemini-omni-flash-preview");
  });

  it("seeds APIMart Suno V5.5, Suno Sounds and Lyria with the shared async lifecycle", () => {
    const state = applyBuiltinSeeds(emptyCatalog(), "2026-08-30T00:00:00.000Z").state;
    const keys = ["suno-v5.5", "suno-sounds-v5.5", "flowmusic-lyria-3.5"];
    for (const modelKey of keys) {
      expect(state.models.find((item) => item.vendorKey === "apimart" && item.modelKey === modelKey))
        .toMatchObject({ kind: "audio", meta: { catalogLifecycle: "flagship" } });
      const mapping = state.mappings.find((item) => item.vendorKey === "apimart" && item.modelKey === modelKey);
      expect(mapping?.create.response_mapping).toMatchObject({ task_id: "data.0.task_id" });
      expect(mapping?.query).toMatchObject({ method: "GET", path: "/v1/music/tasks/{{providerMeta.task_id}}" });
      expect(mapping?.query?.response_mapping).toMatchObject({
        status: "data.status",
        audio_url: "data.result.music.0.audio_url",
      });
    }
  });

  it("seeds KIE Suno Sounds without inventing a callback URL", () => {
    const state = applyBuiltinSeeds(emptyCatalog(), "2026-08-30T00:00:00.000Z").state;
    const mapping = state.mappings.find((item) => item.id === "seed-kie-suno-sounds-v5-5-text_to_audio");
    expect(mapping?.create.path).toBe("/api/v1/generate/sounds");
    expect(mapping?.query?.path).toBe("/api/v1/generate/record-info");
    expect(JSON.stringify(mapping?.create.body)).not.toContain("callBackUrl");

    const translated = applyParamMap(mapping?.create.paramMap, { sound_type: "loop" });
    expect(translated.sound_loop).toBe(true);
    expect(applyParamMap(mapping?.create.paramMap, { sound_type: "one-shot" }).sound_loop).toBe(false);
  });

  it("routes Suno music, upload-extend and upload-cover by the generic mode discriminator", () => {
    const state = applyBuiltinSeeds(emptyCatalog(), "2026-08-30T00:00:00.000Z").state;
    const music = selectTaskMapping(state.mappings, "kie", "text_to_audio", "suno-v5.5", "music");
    const extend = selectTaskMapping(state.mappings, "kie", "text_to_audio", "suno-v5.5", "extend");
    const cover = selectTaskMapping(state.mappings, "kie", "text_to_audio", "suno-v5.5", "cover");
    expect(music?.id).toBe("seed-kie-suno-v5-5-music");
    expect(extend?.create).toBe(KIE_SUNO_UPLOAD_EXTEND_CREATE_OP);
    expect(cover?.create).toBe(KIE_SUNO_UPLOAD_COVER_CREATE_OP);
    expect(selectTaskMapping(state.mappings, "kie", "text_to_audio", "suno-v5.5")).toBeNull();
    expect(KIE_SUNO_MUSIC_MAPPINGS).toHaveLength(3);
  });

  // 17 → 20：Seedance 2.5 的 first/firstlast/omni 与 Gemini Omni 1.1 的 firstlast 从「借用
  // 兄弟模式的线缆」改为各自持有 mapping（+4），同时删掉被借用的那条 seedance `i2v`（-1）。
  // 端点仍只有两个（image-to-video / reference-to-video），多出来的是**模式绑定**不是新端点。
  it("seeds fal's 10 logical models and 20 create/status/result endpoint mappings", () => {
    const state = applyBuiltinSeeds(emptyCatalog(), "2026-08-30T00:00:00.000Z").state;
    const falModels = state.models.filter((item) => item.vendorKey === "fal");
    const falMappings = state.mappings.filter((item) => item.vendorKey === "fal");
    expect(falModels).toHaveLength(10);
    expect(falMappings).toHaveLength(FAL_OFFICIAL_ENDPOINT_COUNT);
    expect(FAL_OFFICIAL_ENDPOINT_COUNT).toBe(20);
    expect(FAL_OFFICIAL_MODELS.flatMap((item) => item.mappings)).toHaveLength(20);
    for (const mapping of falMappings) {
      expect(mapping.create.method).toBe("POST");
      expect(mapping.query?.path).toContain("/requests/{{providerMeta.task_id}}/status");
      expect(mapping.result?.path).toContain("/requests/{{providerMeta.task_id}}");
      expect(mapping.result?.response_mapping?.assets).toBeTruthy();
    }
  });

  it("seeds Runway's current flagship video/image catalog with the official task lifecycle", () => {
    const state = applyBuiltinSeeds(emptyCatalog(), "2026-08-30T00:00:00.000Z").state;
    const runwayModels = state.models.filter((item) => item.vendorKey === "runway");
    const runwayMappings = state.mappings.filter((item) => item.vendorKey === "runway");
    expect(runwayModels.map((item) => item.modelKey)).toEqual(expect.arrayContaining([
      "gen4.5", "gen4_turbo", "seedance2_5", "seedance2", "seedance2_fast", "seedance2_mini",
      "wan3", "grok_imagine_1_5", "hailuo3", "veo3.1", "veo3.1_fast", "happyhorse_1_0", "gemini_omni_flash",
      "muse_image", "grok_imagine_image_2", "seedream5_pro", "seedream5_lite", "gen4_image", "gen4_image_turbo",
      "gemini_image3_pro", "gemini_image3.1_flash", "gpt_image_2", "gemini_2.5_flash",
      "seed_audio", "eleven_text_to_sound_v2", "eleven_multilingual_v2", "eleven_v3",
    ]));
    expect(runwayMappings.length).toBeGreaterThanOrEqual(3);
    expect(RUNWAY_OFFICIAL_ENDPOINTS).toEqual([
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
    ]);

    const t2v = selectTaskMapping(state.mappings, "runway", "text_to_video", "gen4.5", "t2v");
    const i2v = selectTaskMapping(state.mappings, "runway", "image_to_video", "gen4.5", "i2v");
    const turbo = selectTaskMapping(state.mappings, "runway", "image_to_video", "gen4_turbo", "i2v");
    const imageTurbo = state.models.find((item) => item.vendorKey === "runway" && item.modelKey === "gen4_image_turbo");
    const imageTurboMapping = selectTaskMapping(state.mappings, "runway", "image_edit", "gen4_image_turbo", "i2i");
    expect(imageTurbo).toMatchObject({ meta: { archetypeId: "runway-image-reference" } });
    expect(imageTurboMapping?.create.body).toMatchObject({ model: "gen4_image_turbo", reference_image_urls: "{{request.params.reference_image_urls}}" });
    expect(selectTaskMapping(state.mappings, "runway", "text_to_image", "gen4_image_turbo", "t2i")).toBeNull();
    expect(t2v?.create).toMatchObject({ method: "POST", path: "/v1/text_to_video", body: { model: "gen4.5" } });
    expect(i2v?.create).toMatchObject({ method: "POST", path: "/v1/image_to_video", body: { model: "gen4.5", promptImage: "{{request.params.image_url}}" } });
    expect(turbo?.create).toMatchObject({ method: "POST", path: "/v1/image_to_video", body: { model: "gen4_turbo", promptImage: "{{request.params.image_url}}" } });
    for (const mapping of [t2v, i2v, turbo]) {
      expect(mapping?.create.headers).toMatchObject({ "X-Runway-Version": "2024-11-06" });
      expect(mapping?.query?.path).toBe("/v1/tasks/{{providerMeta.task_id}}");
      expect(mapping?.result?.response_mapping?.assets).toBe("output");
    }
    // The same model has one mapping per task kind, so omitting mode is safe for
    // Runway i2v; Suno's same-kind multi-mode rows above remain fail-closed.
    expect(selectTaskMapping(state.mappings, "runway", "image_to_video", "gen4.5")?.id).toBe("seed-runway-gen4-5-i2v");
    const seedance = state.mappings.filter((item) => item.vendorKey === "runway" && item.modelKey === "seedance2_5");
    expect(seedance.map((item) => item.modeId).sort()).toEqual(["first", "firstlast", "omni", "t2v"]);
    expect(seedance.find((item) => item.modeId === "omni")?.create.request_transform).toBe("runway-seedance2-5");
    const audio = state.mappings.filter((item) => item.vendorKey === "runway" && ["seed_audio", "eleven_text_to_sound_v2", "eleven_multilingual_v2", "eleven_v3"].includes(item.modelKey || ""));
    expect(audio.map((item) => item.modeId).sort()).toEqual(["sfx", "sfx", "speech", "speech", "speech"]);
    expect(audio.every((item) => item.query?.path === "/v1/tasks/{{providerMeta.task_id}}" && item.result?.response_mapping?.assets === "output")).toBe(true);
    expect(selectTaskMapping(state.mappings, "runway", "text_to_audio", "seed_audio")).toBeNull();
    expect(selectTaskMapping(state.mappings, "runway", "text_to_audio", "seed_audio", "sfx")?.id).toBe("seed-runway-seed-audio-sfx");
    expect(RUNWAY_OFFICIAL_BLOCKERS).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelKey: "aleph2" }),
      expect.objectContaining({ modelKey: "act_two" }),
      expect.objectContaining({ modelKey: "gwm1_avatars" }),
      expect.objectContaining({ modelKey: "magnific_precision_upscaler_v2" }),
      expect.objectContaining({ modelKey: "magnific_video_upscaler_creative" }),
      expect.objectContaining({ modelKey: "ruby" }),
      expect.objectContaining({ modelKey: "eleven_voice_isolation" }),
      expect.objectContaining({ modelKey: "eleven_voice_dubbing" }),
      expect.objectContaining({ modelKey: "eleven_multilingual_sts_v2" }),
    ]));
  });

  it.each([
    ["minimax", "seed-minimax-h3-text_to_video", "/v2/video_generation"],
    ["elevenlabs", "seed-elevenlabs-music-v2", "/v1/music"],
    ["meshy", "seed-meshy-7-image-to-3d", "/openapi/v1/image-to-3d"],
  ])("reconciles a stale %s flagship mapping back to its declared production request", (_vendorKey, mappingId, expectedPath) => {
    const seeded = applyBuiltinSeeds(emptyCatalog(), "2026-08-30T00:00:00.000Z").state;
    const index = seeded.mappings.findIndex((item) => item.id === mappingId);
    expect(index).toBeGreaterThanOrEqual(0);
    seeded.mappings[index] = {
      ...seeded.mappings[index],
      name: "User label is preserved",
      create: { method: "POST", path: "/stale-contract", body: {} },
    };

    const reconciled = applyBuiltinSeeds(seeded, "2026-08-31T00:00:00.000Z");
    expect(reconciled.changed).toBe(true);
    expect(reconciled.state.mappings.find((item) => item.id === mappingId)).toMatchObject({
      name: "User label is preserved",
      create: { path: expectedPath },
    });
  });

  it("keeps Runway reference uploads provider-native and shapes typed image objects at the mapping boundary", async () => {
    const state = applyBuiltinSeeds(emptyCatalog(), "2026-08-30T00:00:00.000Z").state;
    const runwayReference = state.mappings.find((item) => item.id === "seed-runway-seedance2-refs");
    expect(runwayReference).toBeTruthy();
    const transformed = await applyRequestTransform(runwayReference?.create.request_transform, {
      model: "seedance2",
      promptText: "keep the character consistent",
      promptImage: ["runway://character", "runway://set"],
      reference_image_urls: ["runway://character", "runway://set"],
    }, { baseUrl: "https://api.dev.runwayml.com" });
    expect(transformed).toMatchObject({
      model: "seedance2",
      promptImage: ["runway://character", "runway://set"],
      references: [{ uri: "runway://character" }, { uri: "runway://set" }],
    });
    expect(transformed).not.toHaveProperty("reference_image_urls");
    expect(RUNWAY_VENDOR_SEED.assetIngestion).toMatchObject({
      strategy: "upload-presigned",
      endpoint: "https://api.dev.runwayml.com/v1/uploads",
      initHeaders: { "X-Runway-Version": "2024-11-06" },
      uploadUrlPath: "uploadUrl",
      uriPath: "runwayUri",
      visibility: "provider-private",
    });
  });

  it("normalizes shared Runway controls to each official discriminator before spend", async () => {
    const state = applyBuiltinSeeds(emptyCatalog(), "2026-08-30T00:00:00.000Z").state;
    const runway = state.mappings.filter((item) => item.vendorKey === "runway");
    const grok = runway.find((item) => item.id === "seed-runway-grok_imagine_1_5-t2v");
    const veo = runway.find((item) => item.id === "seed-runway-veo3-1-t2v");
    const happyhorse = runway.find((item) => item.id === "seed-runway-happyhorse_1_0-t2v");
    expect(grok?.create.request_transform).toBe("runway-video-contract");
    expect(await applyRequestTransform(grok?.create.request_transform, {
      model: "grok_imagine_1_5", promptText: "test", ratio: "1280:720", duration: 5,
      reference_image_urls: ["runway://ref"], reference_video_urls: ["runway://unsupported"],
    }, { baseUrl: RUNWAY_VENDOR_SEED.baseUrl })).toMatchObject({
      model: "grok_imagine_1_5", ratio: "16:9", references: [{ uri: "runway://ref" }],
    });
    const veoBody = await applyRequestTransform(veo?.create.request_transform, {
      model: "veo3.1", promptText: "test", ratio: "16:9", duration: 5,
    }, { baseUrl: RUNWAY_VENDOR_SEED.baseUrl });
    expect(veoBody).toMatchObject({ ratio: "1280:720", duration: 4 });
    expect(happyhorse?.create.request_transform).toBe("runway-video-contract");
    const hhBody = await applyRequestTransform(happyhorse?.create.request_transform, {
      model: "happyhorse_1_0", promptText: "test", ratio: "16:9", duration: 5,
    }, { baseUrl: RUNWAY_VENDOR_SEED.baseUrl });
    expect(hhBody).toMatchObject({ model: "happyhorse_1_0", ratio: "1280:720" });
    const happyhorseI2v = runway.find((item) => item.id === "seed-runway-happyhorse_1_0-image");
    expect(happyhorseI2v?.create.body).toMatchObject({ model: "happyhorse_1_0", promptImage: "{{request.params.image_url}}" });
    expect(happyhorseI2v?.create.paramMap?.drops).toEqual(expect.arrayContaining(["generate_audio", "aspect_ratio"]));
    const hhI2vBody = await applyRequestTransform(happyhorseI2v?.create.request_transform, {
      model: "happyhorse_1_0", promptImage: "runway://image", ratio: "16:9", duration: 5,
    }, { baseUrl: RUNWAY_VENDOR_SEED.baseUrl });
    expect(hhI2vBody).not.toHaveProperty("ratio");
  });
});
