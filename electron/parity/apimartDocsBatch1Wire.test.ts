/**
 * APIMart 文档对齐第一批（2026-11-12）：带用户参数的真实出站请求体。
 *
 * 每条断言的值都是官方页里的字面量（字段名 + 取值），画布路（引擎 A）和 Run 路（引擎 B）都量：
 *   · Seedance 2.5：1080p；视频编辑钉 omni_reference_task_type=edit + size=adaptive 且不发 duration（节点上残留的时长也不发）；续写同理。
 *   · Seedream 5.0 Pro：1.5K；透明背景 + png；水印 / 内容审核开关。
 *   · 可灵 4.0 Flash：五种方式各一条；图生不发比例；「auto」不上线；没声明的清晰度（节点上残留 1080p）不发。
 *   · MiniMax H3-Max：1080P；首尾帧用 first_frame_image / last_frame_image；多模态参考三类素材各走各的字段；水印永不发。
 *   · Seedream 5.5：透明背景 + png；多图参考；不发 n / optimize_prompt_options。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "nomi-parity-docs-batch1-")));
});

vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => { throw new Error(`付费路径不该走带超时的桥: ${operation}`); },
}));

import { createGenerationNode } from "../../src/workbench/generationCanvas/model/graphOps";
import { buildCatalogTaskRequest } from "../../src/workbench/generationCanvas/runner/catalogTaskActions";
import { resolveGenerationReferences } from "../../src/workbench/generationCanvas/runner/generationReferenceResolver";
import { driveEngineA, driveEngineB, installFetchCapture, seedParityCatalog, type FetchCapture } from "./generationParityTestUtils";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";

const IMG_A = "https://assets.example.com/batch1/a.png";
const IMG_B = "https://assets.example.com/batch1/b.png";
const VID_A = "https://assets.example.com/batch1/a.mp4";
const AUD_A = "https://assets.example.com/batch1/a.mp3";

let capture: FetchCapture;
beforeAll(async () => {
  capture = installFetchCapture();
  await seedParityCatalog(["apimart"]);
}, 60_000);
afterAll(() => { capture?.restore(); });

type Body = Record<string, unknown>;
type Ref = { url: string; kind: "image" | "video" | "audio"; role: "first_frame" | "last_frame" | "reference" };
const image = (url: string, role: Ref["role"] = "reference"): Ref => ({ url, kind: "image", role });
const video = (url: string): Ref => ({ url, kind: "video", role: "reference" });
const audio = (url: string): Ref => ({ url, kind: "audio", role: "reference" });

/** 画布路：用户参数直接放在节点 meta（和参数面板写盘的位置一样），图片参考走节点的有序参考列表。 */
async function canvas(p: { modelKey: string; archetypeId: string; modeId: string; kind: "image" | "video"; params?: Body; images?: string[]; videos?: string[] }): Promise<Body> {
  capture.reset();
  const node = createGenerationNode({ id: "batch1-node", kind: p.kind, prompt: "一个镜头" });
  node.meta = {
    modelKey: p.modelKey, modelVendor: "apimart", vendor: "apimart",
    archetype: { id: p.archetypeId, modeId: p.modeId },
    ...(p.images?.length ? { referenceImageUrls: p.images } : {}),
    ...(p.videos?.length ? { referenceVideoUrls: p.videos } : {}),
    ...(p.params ?? {}),
  };
  const request = buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: [node], edges: [] }) }).request;
  const record = await driveEngineA(capture, { vendorKey: "apimart", kind: request.kind, prompt: request.prompt, extras: request.extras ?? {} });
  expect(record.request, JSON.stringify(record.failure)).toBeTruthy();
  return record.request!.body as Body;
}

/** Run 路（Agent / 生成门）：用户参数走 parameters，参考按种类 + 角色封存。 */
async function run(p: { modelId: string; modeId: string; mode: string; params?: Body; refs?: Ref[] }): Promise<Body> {
  capture.reset();
  const references = (p.refs ?? []).map((ref, index) => ({ assetId: ref.url, contentHash: `b1-${index}`, version: 1, kind: ref.kind, role: ref.role }));
  const record = await driveEngineB(capture, {
    vendorKey: "apimart", modelId: p.modelId, mode: p.mode, modeId: p.modeId, prompt: "一个镜头",
    parameters: p.params ?? {}, references: references as never,
    referenceUrls: Object.fromEntries(references.map((reference, index) => [spendReferenceKey(reference as never), p.refs![index]!.url])),
  });
  if (!record.request) throw new Error(`没有出站报文: ${JSON.stringify(record.failure)}`);
  return record.request.body as Body;
}

describe("Seedance 2.5：清晰度 1080p / 水印 / 容器 / 内容审核，编辑与续写", () => {
  const K = { modelKey: "doubao-seedance-2.5", archetypeId: "seedance-2.5-apimart", kind: "video" as const };

  it("文生视频选 1080p：两条路都发 resolution=1080p、model=seedance-2.5，水印 / 容器 / 审核原样带出", async () => {
    const params = { resolution: "1080p", watermark: true, output_format: "mov", nsfw_check: true, duration: 8 };
    const a = await canvas({ ...K, modeId: "t2v", params });
    const b = await run({ modelId: K.modelKey, modeId: "t2v", mode: "text_to_video", params });
    for (const body of [a, b]) {
      expect(body).toMatchObject({ model: "seedance-2.5", resolution: "1080p", watermark: true, output_format: "mov", nsfw_check: true, duration: 8 });
    }
  });

  it("视频编辑：钉 omni_reference_task_type=edit + size=adaptive，源视频走 video_urls；节点上残留的时长不发（平台补 -1）", async () => {
    const body = await run({ modelId: K.modelKey, modeId: "edit", mode: "image_to_video", params: { resolution: "1080p" }, refs: [video(VID_A), image(IMG_A)] });
    expect(body).toMatchObject({ omni_reference_task_type: "edit", size: "adaptive", resolution: "1080p", video_urls: [VID_A], image_urls: [IMG_A] });
    expect(body).not.toHaveProperty("duration");
    // 画布路：节点上残留的时长 / 比例按方式裁掉
    const leftover = await canvas({ ...K, modeId: "edit", params: { duration: 12, size: "16:9", resolution: "1080p" }, images: [IMG_A], videos: [VID_A] });
    expect(leftover).toMatchObject({ omni_reference_task_type: "edit", size: "adaptive" });
    expect(leftover).not.toHaveProperty("duration");
  });

  it("视频续写：钉 omni_reference_task_type=extend + size=adaptive，时长照用户选的发", async () => {
    const body = await run({ modelId: K.modelKey, modeId: "extend", mode: "image_to_video", params: { duration: 8, size: "9:16" }, refs: [video(VID_A)] });
    expect(body).toMatchObject({ omni_reference_task_type: "extend", size: "adaptive", duration: 8, video_urls: [VID_A] });
  });

  it("全能参考不发 omni_reference_task_type（走默认 auto）", async () => {
    const body = await run({ modelId: K.modelKey, modeId: "omni", mode: "image_to_video", refs: [image(IMG_A), video(VID_A), audio(AUD_A)] });
    expect(body).not.toHaveProperty("omni_reference_task_type");
    expect(body).toMatchObject({ image_urls: [IMG_A], video_urls: [VID_A], audio_urls: [AUD_A] });
  });
});

describe("Seedream 5.0 Pro（APIMart）：1.5K、透明背景、水印、内容审核", () => {
  const K = { modelKey: "doubao-seedream-5-0-pro", archetypeId: "seedream-5-pro", kind: "image" as const };

  it("文生图选 1.5K + png + 水印 + 审核：字段名和取值就是文档里的", async () => {
    const params = { size: "2:1", resolution: "1.5K", output_format: "png", watermark: true, nsfw_check: true };
    const a = await canvas({ ...K, modeId: "t2i", params });
    const b = await run({ modelId: K.modelKey, modeId: "t2i", mode: "text_to_image", params });
    for (const body of [a, b]) expect(body).toMatchObject({ model: "seedream-5-0-pro", size: "2:1", resolution: "1.5K", output_format: "png", watermark: true, nsfw_check: true });
  });

  it("改图透明背景：background=transparent + output_format=png，image_urls 带图", async () => {
    const params = { resolution: "1.5K", background: "transparent", output_format: "png" };
    const a = await canvas({ ...K, modeId: "edit", params, images: [IMG_A] });
    const b = await run({ modelId: K.modelKey, modeId: "edit", mode: "image_edit", params, refs: [image(IMG_A)] });
    for (const body of [a, b]) expect(body).toMatchObject({ resolution: "1.5K", background: "transparent", output_format: "png", image_urls: [IMG_A] });
  });

  it("文生图不发 background（官方：透明只在改图）", async () => {
    const body = await canvas({ ...K, modeId: "t2i", params: { background: "transparent" } });
    expect(body).not.toHaveProperty("background");
  });
});

describe("可灵 4.0 Flash：五种方式", () => {
  const K = { modelKey: "kling-v4-flash", archetypeId: "kling-v4-flash", kind: "video" as const };

  it("文生视频：aspect_ratio / duration 照发，清晰度永不发（节点上残留的 1080p 也不上线）", async () => {
    const a = await canvas({ ...K, modeId: "t2v", params: { aspect_ratio: "21:9", duration: 12, resolution: "1080p" } });
    const b = await run({ modelId: K.modelKey, modeId: "t2v", mode: "text_to_video", params: { aspect_ratio: "21:9", duration: 12 } });
    for (const body of [a, b]) {
      expect(body).toMatchObject({ model: "kling-v4-flash", aspect_ratio: "21:9", duration: 12 });
      expect(body).not.toHaveProperty("resolution");
    }
  });

  it("图生视频：first_frame_image 单张字符串，比例不发（官方：发了返回 400）", async () => {
    const a = await canvas({ ...K, modeId: "i2v", params: { aspect_ratio: "16:9", duration: 6 }, images: [IMG_A] });
    const b = await run({ modelId: K.modelKey, modeId: "i2v", mode: "image_to_video", params: { duration: 6 }, refs: [image(IMG_A, "first_frame")] });
    for (const body of [a, b]) {
      expect(body).toMatchObject({ first_frame_image: IMG_A, duration: 6 });
      expect(body).not.toHaveProperty("aspect_ratio");
      expect(body).not.toHaveProperty("image_urls");
    }
  });

  it("全能参考：omni_reference_task_type=reference + 图 + 视频，audio_setting=origin 原样发，比例选 auto 不发", async () => {
    const body = await run({
      modelId: K.modelKey, modeId: "ref", mode: "image_to_video",
      params: { aspect_ratio: "auto", audio_setting: "origin", duration: 10 },
      refs: [image(IMG_A), image(IMG_B), video(VID_A)],
    });
    expect(body).toMatchObject({ omni_reference_task_type: "reference", image_urls: [IMG_A, IMG_B], video_urls: [VID_A], audio_setting: "origin", duration: 10 });
    expect(body).not.toHaveProperty("aspect_ratio");
  });

  it("全能参考选了具体比例：发 aspect_ratio=9:16", async () => {
    const body = await run({ modelId: K.modelKey, modeId: "ref", mode: "image_to_video", params: { aspect_ratio: "9:16" }, refs: [image(IMG_A)] });
    expect(body).toMatchObject({ aspect_ratio: "9:16", omni_reference_task_type: "reference" });
  });

  it("视频编辑：omni_reference_task_type=edit，源视频 video_urls、参考图 image_urls；比例 auto 不发；残留的 audio_setting 不发（官方：编辑不要发）", async () => {
    const body = await run({
      modelId: K.modelKey, modeId: "edit", mode: "image_to_video",
      params: { aspect_ratio: "auto" }, refs: [video(VID_A), image(IMG_A)],
    });
    expect(body).toMatchObject({ omni_reference_task_type: "edit", video_urls: [VID_A], image_urls: [IMG_A] });
    expect(body).not.toHaveProperty("aspect_ratio");
    expect(body).not.toHaveProperty("duration");
    const leftover = await canvas({ ...K, modeId: "edit", params: { audio_setting: "origin", aspect_ratio: "auto" }, images: [IMG_A], videos: [VID_A] });
    expect(leftover).not.toHaveProperty("audio_setting");
  });

  it("视频续写：omni_reference_task_type=extend + 时长；残留的比例 / 声音 / 图都不发（官方：续写不收）", async () => {
    const body = await run({
      modelId: K.modelKey, modeId: "extend", mode: "image_to_video",
      params: { duration: 8 }, refs: [video(VID_A)],
    });
    expect(body).toMatchObject({ omni_reference_task_type: "extend", video_urls: [VID_A], duration: 8 });
    for (const key of ["aspect_ratio", "audio_setting", "image_urls", "first_frame_image"]) expect(body, key).not.toHaveProperty(key);
    const leftover = await canvas({ ...K, modeId: "extend", params: { duration: 8, aspect_ratio: "16:9", audio_setting: "origin" }, videos: [VID_A] });
    for (const key of ["aspect_ratio", "audio_setting"]) expect(leftover, key).not.toHaveProperty(key);
  });
});

describe("MiniMax H3-Max（APIMart）：1080P、首尾帧、多模态参考", () => {
  const K = { modelKey: "MiniMax-H3-Max", archetypeId: "minimax-h3-max", kind: "video" as const };

  it("文生视频选 1080P + 21:9 + 6 秒；水印永不发（官方：1080P 必须整键不发）", async () => {
    const a = await canvas({ ...K, modeId: "t2v", params: { resolution: "1080P", aspect_ratio: "21:9", duration: 6, watermark: true } });
    const b = await run({ modelId: K.modelKey, modeId: "t2v", mode: "text_to_video", params: { resolution: "1080P", aspect_ratio: "21:9", duration: 6 } });
    for (const body of [a, b]) {
      expect(body).toMatchObject({ model: "MiniMax-H3-Max", resolution: "1080P", aspect_ratio: "21:9", duration: 6 });
      expect(body).not.toHaveProperty("watermark");
      expect(body).not.toHaveProperty("aigc_watermark");
    }
  });

  it("首尾帧：first_frame_image + last_frame_image 各占一个字段，比例不发（由输入图决定）", async () => {
    const params = { resolution: "1080P", duration: 5, aspect_ratio: "16:9" };
    const run2 = await run({ modelId: K.modelKey, modeId: "i2v", mode: "image_to_video", params, refs: [image(IMG_A, "first_frame"), image(IMG_B, "last_frame")] });
    const canvasBody = await canvas({ ...K, modeId: "i2v", params, images: [IMG_A, IMG_B] });
    for (const body of [canvasBody, run2]) {
      expect(body).toMatchObject({ resolution: "1080P", duration: 5, first_frame_image: IMG_A, last_frame_image: IMG_B });
      for (const key of ["aspect_ratio", "image_urls", "video_urls", "audio_urls"]) expect(body, key).not.toHaveProperty(key);
    }
  });

  it("多模态参考：图 / 视频 / 音频各走 image_urls / video_urls / audio_urls，比例默认 adaptive，不带首尾帧字段", async () => {
    const body = await run({
      modelId: K.modelKey, modeId: "ref", mode: "image_to_video",
      params: { resolution: "480P", duration: 7, aspect_ratio: "adaptive" }, refs: [image(IMG_A), video(VID_A), audio(AUD_A)],
    });
    expect(body).toMatchObject({ resolution: "480P", duration: 7, aspect_ratio: "adaptive", image_urls: [IMG_A], video_urls: [VID_A], audio_urls: [AUD_A] });
    expect(body).not.toHaveProperty("first_frame_image");
    expect(body).not.toHaveProperty("last_frame_image");
  });

  it("画布路多模态参考：参考图只进 image_urls，不顺带塞首帧字段", async () => {
    const body = await canvas({ ...K, modeId: "ref", params: { resolution: "768P" }, images: [IMG_A, IMG_B] });
    expect(body.image_urls).toEqual([IMG_A, IMG_B]);
    expect(body).not.toHaveProperty("first_frame_image");
  });
});

describe("Seedream 5.5：透明背景、png、多图参考", () => {
  const K = { modelKey: "seedream-5-5", archetypeId: "seedream-5-5", kind: "image" as const };

  it("文生图透明背景 + png + 1.5K：两条路都发文档里的字段，不发 n / optimize_prompt_options", async () => {
    const params = { size: "16:9", resolution: "1.5K", background: "transparent", output_format: "png", watermark: true, nsfw_check: true };
    const a = await canvas({ ...K, modeId: "t2i", params });
    const b = await run({ modelId: K.modelKey, modeId: "t2i", mode: "text_to_image", params });
    for (const body of [a, b]) {
      expect(body).toMatchObject({ model: "seedream-5-5", size: "16:9", resolution: "1.5K", background: "transparent", output_format: "png", watermark: true, nsfw_check: true });
      expect(body).not.toHaveProperty("n");
      expect(body).not.toHaveProperty("optimize_prompt_options");
    }
  });

  it("改图两张参考：image_urls 数组", async () => {
    const params = { background: "opaque", output_format: "jpeg" };
    const a = await canvas({ ...K, modeId: "edit", params, images: [IMG_A, IMG_B] });
    const b = await run({ modelId: K.modelKey, modeId: "edit", mode: "image_edit", params, refs: [image(IMG_A), image(IMG_B)] });
    for (const body of [a, b]) expect(body).toMatchObject({ background: "opaque", output_format: "jpeg", image_urls: [IMG_A, IMG_B] });
  });

  it("身份路由：seedream-5-5 不被 5.0 Pro / 5 Lite 抢走，请求里 model 就是 seedream-5-5", async () => {
    const body = await run({ modelId: K.modelKey, modeId: "t2i", mode: "text_to_image" });
    expect(body.model).toBe("seedream-5-5");
  });
});

describe("身份路由：新模型不被同家族老档案抢走", () => {
  it("kling-v4-flash 不落到 kling-v4；两者请求里的 model 各是各的", async () => {
    const flash = await run({ modelId: "kling-v4-flash", modeId: "t2v", mode: "text_to_video" });
    const v4 = await run({ modelId: "kling-v4", modeId: "t2v", mode: "text_to_video" });
    expect(flash.model).toBe("kling-v4-flash");
    expect(v4.model).toBe("kling-v4");
    expect(v4).toHaveProperty("resolution");
    expect(flash).not.toHaveProperty("resolution");
  });
});
