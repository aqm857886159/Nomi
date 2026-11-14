/**
 * 发送前的通用输入判定（2026-11-14，设计卡 docs/plan/2026-11-14-mode-input-check.md）。
 *
 * 一处判、两条发送口（画布 runtime 与 Run 路的生成门）都过它：
 *   · 槽位下限：方式要求的素材（编辑的源视频等）请求里一件都没有 → 不发，零请求；
 *   · requiresAnyOf：H3-Max 多模态参考只放音频 → 不发；
 *   · 选项依赖槽位（`when: { slotEmpty }`）：可灵 4.0 Flash 全能参考选「保留原声」却没参考视频 → 不发。
 * 拒收文案由槽位名拼成、在 desktopStrings 里中英各一份；断言一律经 desktopT 取，不手抄句子。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "nomi-parity-mode-input-")));
});

vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => { throw new Error(`付费路径不该走带超时的桥: ${operation}`); },
}));

import { createGenerationNode } from "../../src/workbench/generationCanvas/model/graphOps";
import { buildCatalogTaskRequest } from "../../src/workbench/generationCanvas/runner/catalogTaskActions";
import { resolveGenerationReferences } from "../../src/workbench/generationCanvas/runner/generationReferenceResolver";
import { desktopT } from "../desktopStrings";
import { driveEngineA, driveEngineB, installFetchCapture, seedParityCatalog, type FetchCapture } from "./generationParityTestUtils";
import type { OutboundRecord } from "./outboundRecord";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import type { ArchetypeReferenceSlotKind } from "../shared/modelArchetypes/types";
import { KLING_4_FLASH_ARCHETYPE } from "../shared/videoCapabilities/kling4Flash";
import { MINIMAX_H3_APIMART_ARCHETYPE } from "../shared/videoCapabilities/minimaxH3Apimart";
import { PIXVERSE_V6_ARCHETYPE } from "../shared/videoCapabilities/pixverse6";
import type { ModelArchetype } from "../shared/modelArchetypes/types";

const IMG_A = "https://assets.example.com/mode-input/a.png";
const VID_A = "https://assets.example.com/mode-input/a.mp4";
const AUD_A = "https://assets.example.com/mode-input/a.mp3";

let capture: FetchCapture;
beforeAll(async () => {
  capture = installFetchCapture();
  await seedParityCatalog(["apimart"]);
}, 60_000);
afterAll(() => { capture?.restore(); });

type Body = Record<string, unknown>;
type Ref = { url: string; kind: "image" | "video" | "audio"; role: "first_frame" | "last_frame" | "reference" };
const image = (url: string): Ref => ({ url, kind: "image", role: "reference" });
const video = (url: string): Ref => ({ url, kind: "video", role: "reference" });
const audio = (url: string): Ref => ({ url, kind: "audio", role: "reference" });

async function canvas(p: { modelKey: string; archetypeId: string; modeId: string; params?: Body; images?: string[]; videos?: string[]; audios?: string[] }): Promise<OutboundRecord> {
  const node = createGenerationNode({ id: "mode-input-node", kind: "video", prompt: "一个镜头" });
  node.meta = {
    modelKey: p.modelKey, modelVendor: "apimart", vendor: "apimart",
    archetype: { id: p.archetypeId, modeId: p.modeId },
    ...(p.images?.length ? { referenceImageUrls: p.images } : {}),
    ...(p.videos?.length ? { referenceVideoUrls: p.videos } : {}),
    ...(p.audios?.length ? { referenceAudioUrls: p.audios } : {}),
    ...(p.params ?? {}),
  };
  const request = buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: [node], edges: [] }) }).request;
  return driveEngineA(capture, { vendorKey: "apimart", kind: request.kind, prompt: request.prompt, extras: request.extras ?? {} });
}

async function run(p: { modelId: string; modeId: string; mode: string; params?: Body; refs?: Ref[] }): Promise<OutboundRecord> {
  const references = (p.refs ?? []).map((ref, index) => ({ assetId: ref.url, contentHash: `mi-${index}`, version: 1, kind: ref.kind, role: ref.role }));
  return driveEngineB(capture, {
    vendorKey: "apimart", modelId: p.modelId, mode: p.mode, modeId: p.modeId, prompt: "一个镜头",
    parameters: p.params ?? {}, references: references as never,
    referenceUrls: Object.fromEntries(references.map((reference, index) => [spendReferenceKey(reference as never), p.refs![index]!.url])),
  });
}

/** 拒收：零请求、机读码 mode_input_missing、文案就是 desktopStrings 那句。 */
function expectRefused(record: OutboundRecord, message: () => string) {
  expect(capture.calls, JSON.stringify(record.request?.body)).toHaveLength(0);
  expect(record.failure?.code).toBe("mode_input_missing");
  expect(record.failure?.message).toContain(message());
}

const slot = (label: string, kind: ArchetypeReferenceSlotKind) => desktopT("modeInput.slotName", { label, kind: desktopT(`modeInput.slotKind.${kind}`) });

/** 拒收句后面的出路：现有输入能整份收下的那个方式（按输入现算方式那一个函数算出来的）。 */
const fits = (archetype: ModelArchetype, modeId: string) =>
  desktopT("modeInput.fitsMode", { mode: archetype.modes.find((m) => m.id === modeId)!.vendorTerm, modeId });

const KLING = { modelKey: "kling-v4-flash", archetypeId: "kling-v4-flash" };
const H3 = { modelKey: "MiniMax-H3-Max", archetypeId: "minimax-h3-max" };

describe("槽位下限：可灵 4.0 Flash 视频编辑没给源视频", () => {
  const missing = () => desktopT("modeInput.slotMissing", { slot: slot("源视频", "video_ref") });

  it("Run 路（生成门）：显式 modeId=edit、只给 1 张图 → 不发，并点名现有输入能用的方式（全能参考）", async () => {
    const record = await run({ modelId: KLING.modelKey, modeId: "edit", mode: "image_to_video", refs: [image(IMG_A)] });
    expectRefused(record, missing);
    expect(record.failure?.message).toBe(`${missing()}${fits(KLING_4_FLASH_ARCHETYPE, "ref")}`);
  });

  it("续写一件输入都没有 → 只说前半句（没有哪个方式能收下「什么都没有」以外的东西，不点名）", async () => {
    const record = await run({ modelId: KLING.modelKey, modeId: "extend", mode: "image_to_video" });
    expectRefused(record, missing);
    expect(record.failure?.message).toBe(missing());
  });

  it("画布路（runtime）：请求里钉着编辑方式、源视频却不在了（如批准后源视频被删）→ 不发", async () => {
    const node = createGenerationNode({ id: "mode-input-node", kind: "video", prompt: "一个镜头" });
    node.meta = { modelKey: KLING.modelKey, modelVendor: "apimart", vendor: "apimart", archetype: { id: KLING.archetypeId, modeId: "edit" }, referenceImageUrls: [IMG_A], referenceVideoUrls: [VID_A] };
    const request = buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: [node], edges: [] }) }).request;
    const extras = structuredClone(request.extras ?? {}) as Body & { archetypeInput?: Body };
    expect(extras.archetypeInput?.omni_reference_task_type).toBe("edit");
    delete extras.referenceVideoUrls;
    delete extras.archetypeInput?.video_urls;
    expectRefused(await driveEngineA(capture, { vendorKey: "apimart", kind: request.kind, prompt: request.prompt, extras }), missing);
  });

  it("画布上编辑方式只连了图：画布按现有输入改走全能参考，照发（不是拒收）", async () => {
    const record = await canvas({ ...KLING, modeId: "edit", images: [IMG_A] });
    expect(record.request?.body).toMatchObject({ omni_reference_task_type: "reference", image_urls: [IMG_A] });
  });

  it("给了源视频照发（反例：判定不误伤全输入）", async () => {
    const record = await run({ modelId: KLING.modelKey, modeId: "edit", mode: "image_to_video", refs: [video(VID_A), image(IMG_A)] });
    expect(record.request?.body).toMatchObject({ omni_reference_task_type: "edit", video_urls: [VID_A] });
  });
});

describe("requiresAnyOf：H3-Max（APIMart）多模态参考只放音频", () => {
  const companion = () => desktopT("modeInput.companionMissing", {
    slot: slot("参考音频", "audio_ref"),
    companions: [slot("参考图", "image_ref"), slot("参考视频", "video_ref")].join(desktopT("modeInput.or")),
  });

  it("Run 路：只有音频 → 不发", async () => {
    expectRefused(await run({ modelId: H3.modelKey, modeId: "ref", mode: "image_to_video", params: { resolution: "768P" }, refs: [audio(AUD_A)] }), companion);
  });

  it("画布路：只有音频 → 不发", async () => {
    expectRefused(await canvas({ ...H3, modeId: "ref", params: { resolution: "768P" }, audios: [AUD_A] }), companion);
  });

  it("音频 + 图照发", async () => {
    const record = await run({ modelId: H3.modelKey, modeId: "ref", mode: "image_to_video", params: { resolution: "768P" }, refs: [image(IMG_A), audio(AUD_A)] });
    expect(record.request?.body).toMatchObject({ image_urls: [IMG_A], audio_urls: [AUD_A] });
  });
});

describe("选项依赖槽位：可灵 4.0 Flash 全能参考「保留原声」要参考视频", () => {
  const needs = () => desktopT("modeInput.optionNeedsSlot", { parameter: "audio_setting", parameterLabel: "声音", value: "origin", valueLabel: "保留原声", slot: slot("参考视频", "video_ref") });

  it("Run 路：只放图 + audio_setting=origin → 不发", async () => {
    expectRefused(await run({ modelId: KLING.modelKey, modeId: "ref", mode: "image_to_video", params: { audio_setting: "origin" }, refs: [image(IMG_A)] }), needs);
  });

  it("画布路：只放图 + origin → 不发", async () => {
    expectRefused(await canvas({ ...KLING, modeId: "ref", params: { audio_setting: "origin" }, images: [IMG_A] }), needs);
  });

  it("只放图 + auto 照发；放了视频 + origin 照发", async () => {
    const auto = await run({ modelId: KLING.modelKey, modeId: "ref", mode: "image_to_video", params: { audio_setting: "auto" }, refs: [image(IMG_A)] });
    expect(auto.request?.body).toMatchObject({ omni_reference_task_type: "reference", audio_setting: "auto" });
    const origin = await run({ modelId: KLING.modelKey, modeId: "ref", mode: "image_to_video", params: { audio_setting: "origin" }, refs: [image(IMG_A), video(VID_A)] });
    expect(origin.request?.body).toMatchObject({ audio_setting: "origin", video_urls: [VID_A] });
  });
});

describe("槽位下限：Run 路显式首尾帧只给 1 张图（协调 2026-11-14 拍板：照拒，带出路）", () => {
  const lastMissing = () => desktopT("modeInput.slotMissing", { slot: slot("尾帧", "last_frame") });
  const first = (url: string): Ref => ({ url, kind: "image", role: "first_frame" });

  it.each([
    ["MiniMax-H3", MINIMAX_H3_APIMART_ARCHETYPE, "first"],
    ["pixverse-v6", PIXVERSE_V6_ARCHETYPE, "i2v"],
  ] as const)("%s firstlast + 1 张首帧 → 不发，点名能收下这张图的方式", async (modelId, archetype, fitting) => {
    const record = await run({ modelId, modeId: "firstlast", mode: "image_to_video", refs: [first(IMG_A)] });
    expectRefused(record, lastMissing);
    expect(record.failure?.message).toBe(`${lastMissing()}${fits(archetype, fitting)}`);
  });

  it("首帧 + 尾帧都给照发（反例）", async () => {
    const record = await run({ modelId: "MiniMax-H3", modeId: "firstlast", mode: "image_to_video", refs: [first(IMG_A), { url: `${IMG_A}?last`, kind: "image", role: "last_frame" }] });
    expect(record.request?.body).toMatchObject({ first_frame_image: IMG_A, last_frame_image: `${IMG_A}?last` });
  });
});
