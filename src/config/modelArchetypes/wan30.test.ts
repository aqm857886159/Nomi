import { describe, expect, it } from "vitest";
import { getArchetypeById, resolveArchetypeForModel } from "./index";
import type { ModelArchetype } from "./types";

// ---------------------------------------------------------------------------
// Wan 3.0 契约锁（kie + apimart）。每个数字都出自 2026-08-26/27 实抓官方文档：
//   kie      docs.kie.ai/market/wan/3-0-video.md · .../3-0-video-prime.md
//   apimart  docs.apimart.ai/cn/api-reference/videos/wan3.0-video/generation
// 改这里的数字前先回文档对账，别照直觉调。
// ---------------------------------------------------------------------------

const KIE = () => getArchetypeById("wan-3.0")!;
const APIMART = () => getArchetypeById("wan-3.0-apimart")!;

const modeOf = (arch: ModelArchetype, id: string) => arch.modes.find((m) => m.id === id)!;
const paramOf = (arch: ModelArchetype, modeId: string, key: string) =>
  modeOf(arch, modeId).params.find((p) => p.key === key);
const slotMaxByKind = (arch: ModelArchetype, modeId: string) =>
  Object.fromEntries(modeOf(arch, modeId).slots.map((s) => [s.kind, s.max]));

describe("Wan 3.0 身份解析", () => {
  it("kie 的两个 model id 都命中 wan-3.0（高速版是变体，不是另一个档案）", () => {
    expect(resolveArchetypeForModel({ modelKey: "wan/3-0-video", vendorKey: "kie" })?.id).toBe("wan-3.0");
    expect(resolveArchetypeForModel({ modelKey: "wan/3-0-video-prime", vendorKey: "kie" })?.id).toBe("wan-3.0");
  });

  it("apimart 的单 id 命中 wan-3.0-apimart（两家契约不同，各自成档案）", () => {
    expect(resolveArchetypeForModel({ modelKey: "wan3.0-video", vendorKey: "apimart" })?.id).toBe("wan-3.0-apimart");
  });

  it("不会误吃 Wan 2.7（前缀相近，匹配必须是整串级别）", () => {
    expect(resolveArchetypeForModel({ modelKey: "wan2.7", vendorKey: "apimart" })?.id).toBe("wan-2.7");
    expect(resolveArchetypeForModel({ modelKey: "wan2.7-r2v", vendorKey: "apimart" })?.id).toBe("wan-2.7");
  });
});

describe("Wan 3.0 kie：变体与模式", () => {
  it("两个变体各自钉到正确的 model id；catalog 行是标准版", () => {
    const arch = KIE();
    expect(arch.variants?.map((v) => [v.id, v.modelKey])).toEqual([
      ["standard", "wan/3-0-video"],
      ["prime", "wan/3-0-video-prime"],
    ]);
    expect(arch.defaultVariantId).toBe("standard");
    // catalog 只种 1 行；下拉里选到 prime 时靠 params.model 发高速 id。
    expect(arch.catalogModelKey).toBe("wan/3-0-video");
  });

  it("高速变体不收窄任何参数（官方字段表与标准版逐项相同）", () => {
    // 若将来官方给 prime 单独收窄了某项，这条会红——提醒回文档重对账，而不是默默不一致。
    expect(KIE().variants?.find((v) => v.id === "prime")?.paramOverrides).toBeUndefined();
  });

  it("四模式齐备", () => {
    expect(KIE().modes.map((m) => m.id)).toEqual(["t2v", "first", "firstlast", "ref"]);
  });

  it("全能参考上限 10 图 / 5 视频 / 5 音频，且用 kie 的字段名", () => {
    expect(slotMaxByKind(KIE(), "ref")).toEqual({ image_ref: 10, video_ref: 5, audio_ref: 5 });
    const keys = Object.fromEntries(modeOf(KIE(), "ref").slots.map((s) => [s.kind, s.inputKey]));
    expect(keys).toEqual({
      image_ref: "reference_image_urls",
      video_ref: "reference_video_urls",
      audio_ref: "reference_audio_urls",
    });
  });

  it("首/尾帧走裸字符串 URL 字段（不是数组，故不设 asArray）", () => {
    const first = modeOf(KIE(), "first").slots[0];
    expect([first.kind, first.inputKey, first.max]).toEqual(["first_frame", "first_frame_url", 1]);
    expect(first.asArray).toBeUndefined();
    const fl = modeOf(KIE(), "firstlast").slots.map((s) => [s.kind, s.inputKey]);
    expect(fl).toEqual([["first_frame", "first_frame_url"], ["last_frame", "last_frame_url"]]);
  });

  it("标量参数域：resolution/aspect_ratio/duration/audio 与官方一致", () => {
    const arch = KIE();
    expect(paramOf(arch, "t2v", "resolution")!.options.map((o) => o.value)).toEqual(["480P", "720P", "1080P"]);
    expect(paramOf(arch, "t2v", "resolution")!.defaultValue).toBe("1080P");
    expect(paramOf(arch, "t2v", "aspect_ratio")!.options.map((o) => o.value)).toEqual([
      "adaptive", "16:9", "4:3", "1:1", "3:4", "9:16",
    ]);
    expect(paramOf(arch, "t2v", "aspect_ratio")!.defaultValue).toBe("adaptive");
    const duration = paramOf(arch, "t2v", "duration")!;
    expect([duration.min, duration.max, duration.defaultValue]).toEqual([2, 30, 5]);
    expect(paramOf(arch, "t2v", "audio")!.defaultValue).toBe(true);
  });

  it("首/尾帧模式不声明比例控件（比例由参考帧决定，交给官方默认 adaptive）", () => {
    for (const modeId of ["first", "firstlast"]) {
      expect(paramOf(KIE(), modeId, "aspect_ratio"), modeId).toBeUndefined();
    }
    // 文生与全能参考仍然给比例控件。
    expect(paramOf(KIE(), "t2v", "aspect_ratio")).toBeDefined();
    expect(paramOf(KIE(), "ref", "aspect_ratio")).toBeDefined();
  });
});

describe("Wan 3.0 apimart：单 id + generation_type 区分两族", () => {
  it("四模式齐备", () => {
    expect(APIMART().modes.map((m) => m.id)).toEqual(["t2v", "first", "firstlast", "ref"]);
  });

  it("帧族钉 generation_type=frame，参考族钉 reference", () => {
    // apimart 把 image_urls 在两族之间**重载**了（帧族最多 2、参考族最多 10），
    // 只有 generation_type 能告诉上游这批素材是哪一族。漏了它 = 上游猜，猜错就跑错模式。
    expect(modeOf(APIMART(), "first").fixedParams).toEqual({ generation_type: "frame" });
    expect(modeOf(APIMART(), "firstlast").fixedParams).toEqual({ generation_type: "frame" });
    expect(modeOf(APIMART(), "ref").fixedParams).toEqual({ generation_type: "reference" });
  });

  it("帧族合并进 image_with_roles，参考族走裸 image_urls", () => {
    expect(modeOf(APIMART(), "first").combineSlotsInto?.key).toBe("image_with_roles");
    expect(modeOf(APIMART(), "firstlast").combineSlotsInto?.key).toBe("image_with_roles");
    expect(modeOf(APIMART(), "ref").combineSlotsInto).toBeUndefined();
  });

  it("全能参考上限同为 10/5/5，但字段名是 apimart 那套", () => {
    expect(slotMaxByKind(APIMART(), "ref")).toEqual({ image_ref: 10, video_ref: 5, audio_ref: 5 });
    const keys = Object.fromEntries(modeOf(APIMART(), "ref").slots.map((s) => [s.kind, s.inputKey]));
    expect(keys).toEqual({ image_ref: "image_urls", video_ref: "video_urls", audio_ref: "audio_urls" });
  });

  it("比例字段名是 size（不是 kie 那份的 aspect_ratio）——同一模型两家不同名", () => {
    // 抄错名字的后果是静默丢比例：不报错，只是永远出 adaptive。
    expect(paramOf(APIMART(), "t2v", "size")).toBeDefined();
    expect(paramOf(APIMART(), "t2v", "aspect_ratio")).toBeUndefined();
    expect(paramOf(KIE(), "t2v", "aspect_ratio")).toBeDefined();
    expect(paramOf(KIE(), "t2v", "size")).toBeUndefined();
  });

  it("标量参数域与官方一致（含 apimart 独有的 watermark）", () => {
    const arch = APIMART();
    expect(paramOf(arch, "t2v", "resolution")!.options.map((o) => o.value)).toEqual(["480P", "720P", "1080P"]);
    expect(paramOf(arch, "t2v", "resolution")!.defaultValue).toBe("1080P");
    expect(paramOf(arch, "t2v", "size")!.defaultValue).toBe("adaptive");
    const duration = paramOf(arch, "t2v", "duration")!;
    expect([duration.min, duration.max, duration.defaultValue]).toEqual([2, 30, 5]);
    expect(paramOf(arch, "t2v", "audio")!.defaultValue).toBe(true);
    expect(paramOf(arch, "t2v", "watermark")!.defaultValue).toBe(false);
  });

  it("首/尾帧模式不声明比例控件", () => {
    for (const modeId of ["first", "firstlast"]) {
      expect(paramOf(APIMART(), modeId, "size"), modeId).toBeUndefined();
    }
  });
});

describe("Wan 3.0 官方硬互斥被编码成模式划分（两家同此结构）", () => {
  // 官方原文：first_frame_url / last_frame_url **不能**与 reference_*_urls 同时出现。
  // 我们不靠运行时校验挡，而是让「模式」本身就凑不出违法组合——用户选了模式就不可能违规。
  // 这条断言防的是将来有人图省事把两族槽塞进同一个模式（那时 UI 允许的组合上游会直接拒）。
  it("没有任何模式同时带 首/尾帧槽 与 参考图/视频/音频槽", () => {
    for (const arch of [KIE(), APIMART()]) {
      for (const mode of arch.modes) {
        const kinds = new Set(mode.slots.map((s) => s.kind));
        const hasFrame = kinds.has("first_frame") || kinds.has("last_frame");
        const hasRef = kinds.has("image_ref") || kinds.has("video_ref") || kinds.has("audio_ref");
        expect(hasFrame && hasRef, `${arch.id}/${mode.id} 同时带帧族与参考族槽`).toBe(false);
      }
    }
  });
});
