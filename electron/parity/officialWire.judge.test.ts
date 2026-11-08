/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { judgeBody, judgePaths, reasonSignatures, type ModelFixture, type Violation } from "./officialWire.judge";

const modules = import.meta.glob<{ default: ModelFixture }>("../../tests/fixtures/vendor-official/apimart/*.json", { eager: true });
const fixtures = new Map(Object.values(modules).map((m) => [m.default.modelKey, m.default]));
const mode = (model: string, id: string) => fixtures.get(model)!.modes[id];
const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://assets.example.com/ref/img-${i + 1}.png`);
const tagged = (n: number, role: string) => urls(n).map((url) => ({ url, role }));

// Independent review's ten false negatives, one false positive and one positive control.
const cases = [
  { name: "Wan first: three frame images", model: "wan3.0-video", id: "first", body: { generation_type: "frame", image_urls: urls(3) }, n: 3, assertion: "countCap" },
  { name: "Wan firstlast: three first_frame roles", model: "wan3.0-video", id: "firstlast", body: { image_with_roles: tagged(3, "first_frame") }, n: 3, assertion: "countCap" },
  { name: "Wan reference intent sent as frame", model: "wan3.0-video", id: "ref", body: { generation_type: "frame", image_urls: urls(1) }, n: 1, assertion: "modeMeaning" },
  { name: "H3 mixes frame/reference roles inside one array", model: "MiniMax-H3", id: "first", body: { image_with_roles: [...tagged(1, "first_frame"), { url: urls(2)[1], role: "reference_image" }] }, n: 2, assertion: "exclusivePairs" },
  { name: "H3 ten reference roles", model: "MiniMax-H3", id: "ref", body: { image_with_roles: tagged(10, "reference_image") }, n: 10, assertion: "countCap" },
  { name: "Seedance 2.5 two first_frame roles", model: "doubao-seedance-2.5", id: "first", body: { image_with_roles: tagged(2, "first_frame") }, n: 2, assertion: "countCap" },
  { name: "Omni reference rejects two images", model: "Omni-Flash-Ext", id: "i2v", body: { generation_type: "reference", image_urls: urls(2) }, n: 2, assertion: "countCap" },
  { name: "Wan 2.7 combined three images and three videos", model: "wan2.7", id: "ref", body: { model: "wan2.7-r2v", image_with_roles: tagged(3, "reference_image"), video_urls: ["v1", "v2", "v3"] }, n: 3, assertion: "countCap" },
  { name: "GPT2 rejects scalar image_urls", model: "gpt-image-2", id: "i2i", body: { image_urls: urls(1)[0] }, n: 1, assertion: "shape" },
  { name: "Seedance 2.0 frame roles plus video", model: "doubao-seedance-2.0", id: "omni", body: { image_with_roles: [{ url: urls(2)[0], role: "first_frame" }, { url: urls(2)[1], role: "last_frame" }], video_urls: ["v1"] }, n: 2, assertion: "exclusivePairs" },
  { name: "GPT2.5 accepts legal mask", model: "gpt-image-2.5-flare", id: "i2i", body: { image_urls: urls(1), mask_url: "https://assets.example.com/mask.png" }, n: 1, assertion: null },
  { name: "GPT2 sixteen images positive control", model: "gpt-image-2", id: "i2i", body: { image_urls: urls(16) }, n: 16, assertion: "countCap" },
];

describe("official judge: independent review shapes", () => {
  for (const c of cases) it(c.name, () => {
    const got = judgeBody(c.body, mode(c.model, c.id), c.n);
    if (c.assertion) expect(got.map((v) => v.assertion)).toContain(c.assertion);
    else expect(got).toEqual([]);
  });
});

describe("official judge: class boundaries", () => {
  const assertions = (model: string, id: string, body: Record<string, unknown>, n = 0) => judgeBody(body, mode(model, id), n).map((v) => v.assertion);
  it.each(["first_frame", "last_frame", "reference_image"])("H3 role/alias %s shares one cap", (role) => {
    const alias = { first_frame: "first", last_frame: "last", reference_image: "reference" }[role]!;
    const max = role === "reference_image" ? 9 : 1;
    const body = { image_with_roles: [...tagged(max, role), { url: "extra", role: alias }] };
    expect(assertions("MiniMax-H3", role === "reference_image" ? "ref" : "firstlast", body)).toContain("countCap");
  });
  it("H3 explicit frame field and frame alias share one cap", () => {
    expect(assertions("MiniMax-H3", "first", { first_frame_image: "a", image_with_roles: [{ url: "b", role: "first" }] })).toContain("countCap");
  });
  it("H3 aliases cannot mix frame and reference families", () => {
    expect(assertions("MiniMax-H3", "first", { image_with_roles: [{ url: "a", role: "first" }, { url: "b", role: "reference" }] })).toContain("exclusivePairs");
  });
  it("H3 frame alias conflicts with separate reference video", () => {
    expect(assertions("MiniMax-H3", "first", { image_with_roles: [{ url: "a", role: "first" }], video_urls: ["v"] })).toContain("exclusivePairs");
  });
  it("H3 first mode explicitly permits an optional last frame", () => {
    expect(assertions("MiniMax-H3", "first", { first_frame_image: "a", last_frame_image: "b" })).toEqual([]);
  });
  it.each(["video_urls", "audio_urls"])("Seedance 2.5 %s converts both frame roles before counting", (media) => {
    expect(assertions("doubao-seedance-2.5", "omni", { image_with_roles: [...tagged(2, "first_frame"), { url: "last", role: "last_frame" }], [media]: ["media"] })).toEqual([]);
  });
  it("Seedance 2.5 first-mode intent still rejects the converted reference semantics", () => {
    expect(assertions("doubao-seedance-2.5", "first", { image_with_roles: tagged(1, "first_frame"), video_urls: ["v"] })).toContain("modeMeaning");
  });
  it.each(["video_urls", "audio_urls"])("Seedance 2.0 reference roles may accompany %s", (media) => {
    expect(assertions("doubao-seedance-2.0", "omni", { image_with_roles: tagged(1, "reference_image"), [media]: ["media"] })).toEqual([]);
  });
  it.each(["first_frame", "last_frame"])("Seedance 2.0 %s conflicts with audio", (role) => {
    expect(assertions("doubao-seedance-2.0", "omni", { image_with_roles: tagged(1, role), audio_urls: ["a"] })).toContain("exclusivePairs");
  });
  it("Wan reference auto-classification precedes its default frame family", () => {
    expect(assertions("wan3.0-video", "ref", { image_urls: urls(3), audio_url: "a" }, 3)).toEqual([]);
    expect(assertions("wan3.0-video", "ref", { image_urls: urls(1) }, 1)).toContain("modeMeaning");
  });
  it("Wan explicit generation_type precedes reference-media auto-classification", () => {
    const got = assertions("wan3.0-video", "ref", { generation_type: "frame", image_urls: urls(3), video_urls: ["v"] }, 3);
    expect(got).toEqual(expect.arrayContaining(["countCap", "exclusivePairs", "modeMeaning"]));
  });
  it("Wan ten reference images are legal; eleven exceed the cap", () => {
    expect(assertions("wan3.0-video", "ref", { generation_type: "reference", image_urls: urls(10) }, 10)).toEqual([]);
    expect(assertions("wan3.0-video", "ref", { generation_type: "reference", image_urls: urls(11) }, 11)).toContain("countCap");
  });
  it.each(["first_frame_image", "image_urls"])("HappyHorse mode checks interpretation of %s", (key) => {
    const body = { [key]: key === "image_urls" ? urls(1) : urls(1)[0] };
    expect(assertions("happyhorse-1.1", key === "image_urls" ? "i2v" : "ref", body, 1)).toContain("modeMeaning");
  });
  it.each([1, 3])("Omni reference accepts %i images", (n) => {
    expect(assertions("Omni-Flash-Ext", "i2v", { generation_type: "reference", image_urls: urls(n) }, n)).toEqual([]);
  });
  it("Omni frame only accepts one image", () => {
    expect(assertions("Omni-Flash-Ext", "i2v", { generation_type: "frame", image_urls: urls(1) }, 1)).toEqual([]);
    expect(assertions("Omni-Flash-Ext", "i2v", { generation_type: "frame", image_urls: urls(3) }, 3)).toContain("countCap");
  });
  it("Veo uses discriminator and documented omitted-value counts", () => {
    expect(assertions("veo3.1-fast", "frame", { generation_type: "reference", image_urls: urls(1) }, 1)).toContain("modeMeaning");
    expect(assertions("veo3.1-fast", "reference", { image_urls: urls(3) }, 3)).toEqual([]);
    expect(assertions("veo3.1-fast", "reference", { image_urls: urls(2) }, 2)).toContain("modeMeaning");
  });
  it("Wan 2.7 joint five is legal and reference_voice is nested ancillary media", () => {
    expect(assertions("wan2.7", "ref", { model: "wan2.7-r2v", image_with_roles: [{ url: "a", role: "reference_image", reference_voice: "voice" }], video_urls: ["v1", "v2", "v3", "v4"] })).toEqual([]);
  });
  it("Kling nested subjects need a frame and 2–4 images each", () => {
    const element = (n: number) => ({ name: "dog", description: "golden dog", element_input_urls: urls(n) });
    const legal = { image_urls: ["frame"], element_list: [element(2)] };
    expect(assertions("kling-v3", "i2v", legal)).toEqual([]);
    expect(assertions("kling-v3", "i2v", { element_list: [element(2)] })).toContain("dependencies");
    for (const n of [1, 5]) expect(assertions("kling-v3", "i2v", { ...legal, element_list: [element(n)] })).toContain("countCap");
    expect(assertions("kling-v3", "i2v", { ...legal, element_list: [element(2), element(2), element(2), element(2)] })).toContain("countCap");
    expect(assertions("kling-v3", "i2v", { ...legal, element_list: [{ name: "dog", element_input_urls: urls(2)[0] }] })).toContain("shape");
    expect(assertions("kling-v3", "i2v", { ...legal, element_list: [{ ...element(2), name: 42 }] })).toContain("shape");
  });
  it.each(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"])("%s mask requires a reference and a scalar shape", (model) => {
    expect(assertions(model, "i2i", { mask_url: "mask" })).toContain("dependencies");
    expect(assertions(model, "i2i", { image_urls: urls(1), mask_url: ["mask"] }, 1)).toContain("shape");
    expect(assertions(model, "i2i", { image_urls: urls(1), mask_url: "mask" }, 1)).toEqual([]);
    expect(assertions(model, "i2i", { mask_url: urls(1)[0] }, 1)).toContain("officialKeys");
  });
  it.each(["n", "sequential_image_generation_options.max_images"])("Seedream joint cap with %s=2", (outputKey) => {
    const options = outputKey === "n" ? { n: 2 } : { sequential_image_generation: "auto", sequential_image_generation_options: { max_images: 2 } };
    expect(assertions("doubao-seedream-4.5", "edit", { ...options, image_urls: urls(13) }, 13)).toEqual([]);
    expect(assertions("doubao-seedream-4.5", "edit", { ...options, image_urls: urls(14) }, 14)).toContain("countCap");
  });
  it("disabled sequential generation ignores inactive max_images", () => {
    expect(assertions("doubao-seedream-4.5", "edit", { image_urls: urls(14), n: 1, sequential_image_generation: "disabled", sequential_image_generation_options: { max_images: 2 } }, 14)).toEqual([]);
  });
  it.each(["wan3.0-video", "Omni-Flash-Ext", "veo3.1-fast"])("%s rejects an undocumented discriminator value", (model) => {
    expect(assertions(model, model === "wan3.0-video" ? "ref" : model === "Omni-Flash-Ext" ? "i2v" : "frame", { generation_type: "unknown", image_urls: urls(1) }, 1)).toContain("modeMeaning");
  });
  it.each([null, 1, {}, [1], [{ url: "a" }]])("GPT2 rejects malformed input shape %j", (image_urls) => {
    expect(assertions("gpt-image-2", "i2i", { image_urls })).toContain("shape");
  });
  it("Omni reference video conflicts with duration", () => {
    expect(assertions("Omni-Flash-Ext", "i2v", { image_urls: urls(1), video_urls: ["v"], duration: 6 }, 1)).toContain("exclusivePairs");
  });
  it("all no-reference records distinguish intent evidence from endpoint rejection", () => {
    for (const fx of fixtures.values()) for (const m of Object.values(fx.modes)) if (m.noReference) {
      expect(["mode-definition", "text-only-example", "documentation-omission", "explicit-rejection"]).toContain(m.noReference.evidenceLevel);
      expect(m.noReference.interpretation).toBeTruthy();
    }
    expect(mode("z-image-turbo", "t2i").noReference?.evidenceLevel).toBe("documentation-omission");
    expect(mode("grok-imagine-2.0-ext", "i2i").noReference?.evidenceLevel).toBe("explicit-rejection");
  });
  it("Wan 2.7 documented role defaults are legal shapes", () => {
    expect(assertions("wan2.7", "i2v", { image_with_roles: [{ url: urls(1)[0] }] }, 1)).toEqual([]);
    expect(assertions("wan2.7", "ref", { model: "wan2.7-r2v", image_with_roles: [{ url: urls(1)[0] }] }, 1)).toEqual([]);
  });
  it("single-image meaning is checked against interpretation, beyond its key", () => {
    const f = mode("wan2.7", "i2v");
    const changed = { ...f, oneImage: { ...f.oneImage!, meaning: "reference_image" } };
    expect(judgeBody({ image_urls: urls(1) }, changed, 1).map((v) => v.assertion)).toContain("modeMeaning");
  });
  it("Qwen 2.0 has no published input cap: assert evidence status, not capacity", () => {
    const f = mode("qwen-image-2.0", "edit");
    expect(f.maxUnpublished).toBe(true);
    expect(f.referenceKeys.image_urls.max).toBeNull();
  });
  it("the GPT2 numeric limit agrees with its real quoted number", () => {
    const f = mode("gpt-image-2", "i2i").referenceKeys.image_urls;
    const numericClaim = /Up to (\d+) reference images/.exec(f.quote);
    expect(numericClaim).not.toBeNull();
    expect(f.max).toBe(Number(numericClaim![1]));
  });
});

describe("known-red causes", () => {
  const cause: Violation = { assertion: "countCap", reason: { key: "image_urls", count: 16, max: 15 }, detail: "human-readable prose" };
  it("freezes keys, roles, counts, and multiplicity rather than assertion names", () => {
    for (const reason of [{ ...cause.reason, key: "image_with_roles" }, { ...cause.reason, count: 17 }, { ...cause.reason, role: "first_frame" }]) {
      expect(reasonSignatures([{ ...cause, reason }])).not.toEqual(reasonSignatures([cause]));
    }
    expect(reasonSignatures([cause, cause])).not.toEqual(reasonSignatures([cause]));
    expect(reasonSignatures([{ ...cause, detail: "translated prose" }])).toEqual(reasonSignatures([cause]));
  });
  it("same-name cause replacement cannot be hidden by another disappearing violation", () => {
    const other = { ...cause, reason: { key: "image_with_roles", role: "first_frame", count: 2, max: 1 } };
    expect(reasonSignatures([cause])).not.toEqual(reasonSignatures([other]));
  });
  it("freezes changed discriminator values under samePath", () => {
    const canvas = { model: "wan", generation_type: "reference" };
    expect(reasonSignatures(judgePaths(canvas, { ...canvas, generation_type: "frame" }))).not.toEqual(reasonSignatures(judgePaths(canvas, { ...canvas, generation_type: "unknown" })));
  });
  it("refusal reasons preserve role and capacity, with unknown reasons failing closed", () => {
    const sent = { model: "model" };
    const failure = (message: string) => ({ code: "provider_error", message });
    expect(reasonSignatures(judgePaths(sent, failure("unsupported reference role: first_frame")))).not.toEqual(reasonSignatures(judgePaths(sent, failure("unsupported reference role: last_frame"))));
    expect(reasonSignatures(judgePaths(sent, failure("这个模型最多收 1张图片参考。")))).not.toEqual(reasonSignatures(judgePaths(sent, failure("这个模型最多收 2张图片参考。"))));
    expect(() => judgePaths(sent, failure("different refusal"))).toThrow("Unclassified official-wire refusal");
  });
});
