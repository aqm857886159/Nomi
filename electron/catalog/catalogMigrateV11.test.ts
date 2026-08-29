import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root = "";
vi.mock("electron", () => ({
  app: { getPath: () => root, getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false },
}));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-catalog-v11-"));
  vi.resetModules();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("catalog v10 -> v11 wiring", () => {
  it("persists version 11 without rewriting an existing model's custom-call script", async () => {
    const file = path.join(root, "model-catalog.json");
    fs.writeFileSync(file, JSON.stringify({
      version: 10,
      vendors: [],
      mappings: [],
      apiKeysByVendor: {},
      models: [{
        modelKey: "kling-3-omni",
        vendorKey: "custom",
        labelZh: "Kling 3 Omni",
        kind: "video",
        enabled: true,
        customCall: {
          script: "const firstFrame = references.firstFrame || references.images?.[0];\nconst images = references.images.filter((url) => url !== firstFrame);\nreturn { firstFrame, images };",
          modes: {
            firstlast: {
              script: "const firstFrame = references.firstFrame || references.images?.[0];\nreturn firstFrame;",
              updatedAt: "2026-08-01T00:00:00.000Z",
            },
          },
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }],
    }), "utf8");

    const { readCatalog } = await import("./catalogStore");
    const { CURRENT_CATALOG_VERSION } = await import("./types");
    const state = readCatalog();

    expect(CURRENT_CATALOG_VERSION).toBe(11);
    expect(state.version).toBe(11);
    expect(state.models[0].customCall?.script).toBe("const firstFrame = references.firstFrame || references.images?.[0];\nconst images = references.images.filter((url) => url !== firstFrame);\nreturn { firstFrame, images };");
    expect(state.models[0].customCall?.modes?.firstlast?.script).toBe("const firstFrame = references.firstFrame || references.images?.[0];\nreturn firstFrame;");
    expect(JSON.parse(fs.readFileSync(file, "utf8")).version).toBe(11);
  });

  it("keeps v10 and preserves the stored prompt when a stale binding has no unique media target", async () => {
    const file = path.join(root, "model-catalog.json");
    const graph = {
      "1": { class_type: "LoadImage", inputs: { image: "a.png" } },
      "2": { class_type: "LoadImage", inputs: { image: "b.png" } },
      "5": { class_type: "VHS_VideoCombine", inputs: { images: ["1", 0], frame_rate: 24 } },
    };
    const prompt = structuredClone(graph) as Record<string, { inputs: Record<string, unknown>; class_type: string }>;
    prompt["5"].inputs.frame_rate = "{{request.params.legacy_image}}";
    fs.writeFileSync(file, JSON.stringify({
      version: 10,
      vendors: [],
      apiKeysByVendor: {},
      models: [{
        modelKey: "ambiguous", vendorKey: "comfyui-local", labelZh: "Ambiguous", kind: "video", enabled: true,
        meta: { comfyWorkflowImport: { text: JSON.stringify(graph), binding: {
          images: [{ nodeId: "5", inputKey: "frame_rate", paramKey: "legacy_image", label: "图", mediaKind: "image" }],
          outputNodeId: "5", outputKind: "video", params: [],
        } } },
        createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
      }],
      mappings: [{
        id: "ambiguous", vendorKey: "comfyui-local", modelKey: "ambiguous", taskKind: "image_to_video", name: "Ambiguous", enabled: true,
        create: { method: "POST", path: "/prompt", request_transform: "comfyui-prompt", body: { prompt } },
        query: { method: "GET", path: "/history" },
        createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
      }],
    }), "utf8");

    const before = fs.readFileSync(file, "utf8");
    const { readCatalog } = await import("./catalogStore");
    expect(readCatalog().version).toBe(10);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });
});
