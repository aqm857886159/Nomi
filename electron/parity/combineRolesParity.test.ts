/**
 * 类测试：每个声明了**角色数组合并**（combineSlotsInto，非 flat）的 APIMart 内置模式，
 * 画布路（`buildArchetypeInputParams`）与 Run 路（引擎 B，MCP / ProductionRun 走的那条）发出去的
 * 角色数组逐项相同（url、role、顺序），没并进去的参考视频也落在同一个扁平键上。
 *
 * 为什么有它（2026-11-07）：Run 路把合同角色词直接当线上角色发——Wan 2.7 角色参考经 MCP / ProductionRun
 * 发出 role "reference"，官方要 "reference_image"；角色表只在渲染层有一份。首尾帧两边刚好同名，所以
 * Seedance 首尾帧一直没露馅。另一处同类分裂：画布路把 Wan 2.7 的参考视频也并进了 image_with_roles
 * （role reference_video），官方只收 video_urls 裸数组（Run 路是对的）。
 * 新接一个声明角色数组的模型自动进来。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "nomi-parity-combine-roles-")));
});

vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => { throw new Error(`付费路径不该走带超时的桥: ${operation}`); },
}));

import { driveEngineB, installFetchCapture, seedParityCatalog, type FetchCapture } from "./generationParityTestUtils";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import { buildArchetypeInputParams } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { getArchetypeById } from "../shared/modelArchetypes";
import { APIMART_VIDEO_MODELS } from "../catalog/apimartVideos";
import { APIMART_IMAGE_MODELS } from "../catalog/apimartImages";
import type { ArchetypeMode } from "../shared/modelArchetypes";
import { classifyGenerationError } from "../../src/workbench/observability/classifyError";

const FIRST = "https://assets.example.com/combine/first.png";
const LAST = "https://assets.example.com/combine/last.png";
const IMG_A = "https://assets.example.com/combine/ref-a.png";
const IMG_B = "https://assets.example.com/combine/ref-b.png";
const VIDEO = "https://assets.example.com/combine/motion.mp4";

type Case = { modelKey: string; archetypeId: string; mode: ArchetypeMode };

const CASES: Case[] = [...APIMART_VIDEO_MODELS, ...APIMART_IMAGE_MODELS].flatMap((model) => {
  const archetype = model.archetypeId ? getArchetypeById(model.archetypeId) : undefined;
  if (!archetype) return [];
  return archetype.modes
    .filter((mode) => mode.combineSlotsInto && mode.combineSlotsInto.flat !== true)
    .map((mode) => ({ modelKey: model.modelKey, archetypeId: archetype.id, mode }));
});

let capture: FetchCapture;

beforeAll(async () => {
  capture = installFetchCapture();
  await seedParityCatalog(["apimart"]);
}, 60_000);

afterAll(() => { capture?.restore(); });

/** 按这一档模式的槽，给每个槽喂素材：首帧 / 尾帧各 1 张，图片参考 2 张，参考视频 1 段。 */
function materialsFor(mode: ArchetypeMode) {
  const kinds = new Set(mode.slots.map((slot) => slot.kind));
  return {
    firstFrameUrl: kinds.has("first_frame") ? FIRST : null,
    lastFrameUrl: kinds.has("last_frame") ? LAST : null,
    referenceImages: kinds.has("image_ref") ? [IMG_A, IMG_B] : [],
    referenceVideos: kinds.has("video_ref") ? [VIDEO] : [],
  };
}

async function runPathBody(item: Case, materials: ReturnType<typeof materialsFor>): Promise<Record<string, unknown>> {
  capture.reset();
  const refs: Array<{ url: string; kind: "image" | "video"; role: "first_frame" | "last_frame" | "reference" }> = [
    ...(materials.firstFrameUrl ? [{ url: materials.firstFrameUrl, kind: "image" as const, role: "first_frame" as const }] : []),
    ...(materials.lastFrameUrl ? [{ url: materials.lastFrameUrl, kind: "image" as const, role: "last_frame" as const }] : []),
    ...materials.referenceImages.map((url) => ({ url, kind: "image" as const, role: "reference" as const })),
    ...materials.referenceVideos.map((url) => ({ url, kind: "video" as const, role: "reference" as const })),
  ];
  const references = refs.map((ref, index) => ({ assetId: ref.url, contentHash: `combine-${index}`, version: 1, kind: ref.kind, role: ref.role }));
  const referenceUrls = Object.fromEntries(references.map((reference, index) => [spendReferenceKey(reference), refs[index]!.url]));
  const record = await driveEngineB(capture, {
    vendorKey: "apimart",
    modelId: item.modelKey,
    mode: item.mode.transportTaskKind === "image_edit" ? "image_edit" : "image_to_video",
    modeId: item.mode.id,
    prompt: "人物从画面左侧走进来，镜头缓慢推近",
    parameters: {},
    references,
    referenceUrls,
  });
  if (!record.request) throw new Error(`${item.modelKey}/${item.mode.id} 没有出站报文: ${JSON.stringify(record.failure)}`);
  return record.request.body as Record<string, unknown>;
}

describe("角色数组合并：画布路与 Run 路发出的 image_with_roles 逐项相同", () => {
  it("覆盖面：至少包含 Wan 2.7 角色参考、Vidu Q4 参考生、Seedance 首尾帧", () => {
    const ids = CASES.map((item) => `${item.modelKey}/${item.mode.id}`);
    expect(ids).toEqual(expect.arrayContaining(["wan2.7/ref", "viduq4-preview/ref", "doubao-seedance-2.5/firstlast"]));
  });

  for (const item of CASES) {
    it(`${item.modelKey} · ${item.mode.id}`, async () => {
      await expectSameRoles(item, materialsFor(item.mode));
    });
  }
});

describe("合并里没有对应槽的参考：Run 路明着拒，错误卡认得出", () => {
  it("Wan 2.7 角色参考（槽只有参考图 / 参考视频）收到首帧：拒发、带 reference-not-in-use 码，不落进「未知错误 + 重试」", async () => {
    const item = CASES.find((entry) => entry.modelKey === "wan2.7" && entry.mode.id === "ref")!;
    let message = "";
    try {
      await runPathBody(item, { firstFrameUrl: FIRST, lastFrameUrl: null, referenceImages: [IMG_A], referenceVideos: [] });
    } catch (error) {
      message = String((error as Error).message);
    }
    expect(message, "没有出站报文").toMatch(/没有出站报文/);
    expect(message).toMatch(/NOMI_ERR::reference-not-in-use::/);
    expect(capture.calls, "一条请求都没发").toHaveLength(0);
    const failure = JSON.parse(message.slice(message.indexOf("{"))) as { message?: string };
    const report = classifyGenerationError(String(failure.message ?? message));
    expect(report.kind).toBe("reference-not-in-use");
    expect(report.kind).not.toBe("unknown");
  });
});

async function expectSameRoles(item: Case, materials: ReturnType<typeof materialsFor>) {
  const key = item.mode.combineSlotsInto!.key;
  const canvas = buildArchetypeInputParams({ archetype: { id: item.archetypeId, modeId: item.mode.id } }, item.mode, materials);
  const run = await runPathBody(item, materials);
  expect(canvas[key], `${item.modelKey}/${item.mode.id} 画布路有角色数组`).toBeTruthy();
  expect(run[key], `${item.modelKey}/${item.mode.id} Run 路 ${key}`).toEqual(canvas[key]);
  // 没并进角色数组的参考视频：两条路落在同一个扁平键上。
  if (materials.referenceVideos.length) {
    expect(canvas.video_urls, "画布路参考视频走 video_urls").toEqual([VIDEO]);
    expect(run.video_urls, "Run 路参考视频走 video_urls").toEqual([VIDEO]);
  }
  // 线上角色词只用供应商的词，合同角色词（reference / character）不许漏到线上。
  for (const entry of run[key] as Array<{ role: string }>) expect(["reference", "character"]).not.toContain(entry.role);
}
