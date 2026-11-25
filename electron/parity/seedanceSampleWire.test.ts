/**
 * Seedance 2.5（样片模式）真发出去的报文（APIMart 2.5 页，2026-11-26 取）：
 *   · 出样片：和普通 2.5 同一份请求体，多一个 `draft: true`，清晰度只有 480p
 *     （「Set to true to generate a 480p draft」「resolution must be 480p … any other resolution, including 4k, returns HTTP 400」）；
 *   · 出高清：只带 model / draft_task_id / resolution
 *     （「do not resend inherited fields such as prompt, reference media, or duration」「even identical values return 400」）。
 * 节点身上留着的旧参数（时长、比例、音频、旧清晰度）一个都不许跟着出高清发出去；两条引擎（画布 / 画布 Run）逐字节相同。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "nomi-parity-seedance-sample-")));
});

vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => { throw new Error(`付费路径不该走带超时的桥: ${operation}`); },
}));

import { createGenerationNode } from "../../src/workbench/generationCanvas/model/graphOps";
import { buildCatalogTaskRequest } from "../../src/workbench/generationCanvas/runner/catalogTaskActions";
import { resolveGenerationReferences } from "../../src/workbench/generationCanvas/runner/generationReferenceResolver";
import { driveEngineA, driveEngineCanvasRun, installFetchCapture, type FetchCapture } from "./generationParityTestUtils";
import { SAMPLE_FINAL_MODE_ID } from "../shared/videoCapabilities/sampleMode";
import { makeApiKeyRecordFromPlain } from "../catalog/secrets";
import { buildWorld, type World } from "../../tests/world";

const SAMPLE_KEY = "doubao-seedance-2.5-sample";
const SAMPLE_ARCHETYPE = "seedance-2.5-apimart-sample";

let capture: FetchCapture;
let world: World;
let restoreWorld: () => void;

beforeAll(async () => {
  capture = installFetchCapture();
  // 内置目录 + APIMart 一把加密好的假钥匙，都经主人的造世界入口落盘（不手写目录）。
  const now = new Date().toISOString();
  world = buildWorld({ projects: [], encryptedApiKeys: { apimart: makeApiKeyRecordFromPlain("sk-parity-apimart", "apimart", true, now, now) } });
  restoreWorld = world.activate();
}, 60_000);

afterAll(() => {
  capture?.restore();
  restoreWorld?.();
  world?.cleanup();
});

function draftRequest(modelKey: string, archetypeId: string) {
  const node = createGenerationNode({ id: "parity-node", kind: "video", prompt: "人物转身看向窗外" });
  node.meta = { modelKey, modelVendor: "apimart", vendor: "apimart", archetype: { id: archetypeId, modeId: "t2v" }, duration: 5 };
  return buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: [node], edges: [] }) }).request;
}

/** 出高清那次的 extras：样片节点身上留着的旧参数原样带着（最坏情况），只换方式、加样片号和目标清晰度。 */
const FINAL_EXTRAS = {
  nodeId: "parity-node",
  modelKey: SAMPLE_KEY,
  modelVendor: "apimart",
  archetype: { id: SAMPLE_ARCHETYPE, modeId: SAMPLE_FINAL_MODE_ID },
  draft_task_id: "task_draft_parity_1",
  resolution: "1080p",
  duration: 10,
  ratio: "16:9",
  size: "16:9",
  generate_audio: true,
  watermark: false,
  output_format: "mp4",
};

async function body(drive: typeof driveEngineA, input: { kind: string; prompt: string; extras: Record<string, unknown> }) {
  const record = await drive(capture, { vendorKey: "apimart", ...input });
  expect(record.request, JSON.stringify(record.failure)).toBeTruthy();
  return record.request!.body as Record<string, unknown>;
}

describe("Seedance 2.5（样片模式）出站报文", () => {
  it("出样片 = 普通 2.5 的同一份请求体 + draft: true，清晰度 480p", async () => {
    const plain = draftRequest("doubao-seedance-2.5", "seedance-2.5-apimart");
    const sample = draftRequest(SAMPLE_KEY, SAMPLE_ARCHETYPE);
    const plainBody = await body(driveEngineA, { kind: plain.kind, prompt: plain.prompt, extras: plain.extras ?? {} });
    const sampleBody = await body(driveEngineA, { kind: sample.kind, prompt: sample.prompt, extras: sample.extras ?? {} });
    expect(sampleBody.draft).toBe(true);
    expect(sampleBody.resolution).toBe("480p");
    expect(sampleBody.model).toBe("seedance-2.5");
    const { draft: _draft, resolution: _r1, ...sampleRest } = sampleBody;
    const { resolution: _r2, ...plainRest } = plainBody;
    expect(sampleRest).toEqual(plainRest);
    expect("draft" in plainBody, "普通 2.5 不带 draft").toBe(false);
  });

  it("出高清只发 model / draft_task_id / resolution，不重发提示词和任何继承字段（两条引擎逐字节相同）", async () => {
    const input = { kind: "text_to_video", prompt: "", extras: FINAL_EXTRAS };
    const viaCanvas = await body(driveEngineA, input);
    expect(Object.keys(viaCanvas).sort()).toEqual(["draft_task_id", "model", "resolution"]);
    expect(viaCanvas).toEqual({ model: "seedance-2.5", draft_task_id: "task_draft_parity_1", resolution: "1080p" });
    const viaRun = await body(driveEngineCanvasRun, input);
    expect(viaRun).toEqual(viaCanvas);
  });

  it("出高清没写清晰度时补档案的默认 1080p（官方「defaulting to 1080p when omitted」）", async () => {
    // 不在选项里的值修成默认归渲染层 fixDropdownsBeforeSend（modeParams.ts 的约定），出高清按钮只取档案的成片清晰度，不在这里重复一份。
    const { resolution: _drop, ...noResolution } = FINAL_EXTRAS;
    expect(await body(driveEngineA, { kind: "text_to_video", prompt: "", extras: noResolution })).toEqual({ model: "seedance-2.5", draft_task_id: "task_draft_parity_1", resolution: "1080p" });
  });

  it("反例：普通 2.5 的行不认出高清方式（不会把样片号发给普通 2.5）", async () => {
    const record = await driveEngineA(capture, {
      vendorKey: "apimart", kind: "text_to_video", prompt: "",
      extras: { ...FINAL_EXTRAS, modelKey: "doubao-seedance-2.5", archetype: { id: "seedance-2.5-apimart", modeId: SAMPLE_FINAL_MODE_ID } },
    });
    expect(record.request && "draft_task_id" in (record.request.body as Record<string, unknown>)).toBeFalsy();
  });

  // 2026-11-26 探出来的：出高清请求落进图生桶（i2v 样片的节点还连着首帧图、清晰度残留 480p），
  // 图生桶那条不带方式的样片映射会接下它——发出去的是 prompt + 图 + draft: true + 480p，一次全新的付费样片。
  // 出高清方式只归它自己那条映射；落错桶一律拒发，带不带参考图都一样。
  it.each([
    ["image_to_video", "1080p"],
    ["image_to_video", "480p"],
  ])("反例：出高清落进 %s 桶（%s、带着节点的参考图）→ 拒发，不会变成一次新样片", async (kind, resolution) => {
    const extras = { ...FINAL_EXTRAS, resolution, image_urls: ["https://example.com/first.png"], referenceImages: ["https://example.com/first.png"] };
    for (const drive of [driveEngineA, driveEngineCanvasRun]) {
      const record = await drive(capture, { vendorKey: "apimart", kind, prompt: "人物转身", extras });
      expect(record.request, JSON.stringify(record.request?.body)).toBeFalsy();
      expect(record.failure).toBeTruthy();
    }
  });
});
