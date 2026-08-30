import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userDataRoot = "";
vi.mock("electron", () => ({
  app: { getPath: () => userDataRoot, getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}));

const workflow = (prompt: string) => JSON.stringify({
  "1": { class_type: "LoadImage", inputs: { image: "source.png" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: prompt } },
  "3": { class_type: "KSampler", inputs: { positive: ["2", 0] } },
  "4": { class_type: "VHS_VideoCombine", inputs: { images: ["3", 0], frame_rate: 24 } },
});

beforeEach(() => {
  userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-comfy-candidate-"));
  fs.writeFileSync(path.join(userDataRoot, "model-catalog.json"), JSON.stringify({ version: 5, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }));
  vi.resetModules();
});

afterEach(() => fs.rmSync(userDataRoot, { recursive: true, force: true }));

describe("ComfyUI staged certification lifecycle", () => {
  it("hides a new candidate from normal selection and resolves it only by exact revision", async () => {
    const { analyzeComfyWorkflowText, importComfyWorkflowToCatalog } = await import("./comfyuiWorkflowImportStore");
    const { resolveComfyStagedCandidate } = await import("./comfyuiCandidateLifecycle");
    const { listModelCatalogMappings } = await import("./catalogStore");
    const { selectTaskMapping } = await import("./types");
    const text = workflow("candidate");
    const binding = (analyzeComfyWorkflowText(text) as { analysis: { suggested: unknown } }).analysis.suggested;
    const staged = importComfyWorkflowToCatalog({ text, binding, labelZh: "Candidate" }, "new") as {
      ok: true; modelKey: string; vendorKey: string; revisionId: string; taskKind: "image_to_video";
    };

    expect(selectTaskMapping(listModelCatalogMappings(), staged.vendorKey, staged.taskKind, staged.modelKey)).toBeNull();
    expect(resolveComfyStagedCandidate(staged)).toMatchObject({
      revisionId: staged.revisionId,
      model: { modelKey: staged.modelKey, enabled: false },
      mapping: { enabled: false },
    });
    expect(() => resolveComfyStagedCandidate({ ...staged, revisionId: "wrong" })).toThrow(/not found/);
  });

  it("atomically promotes certified evidence and leaves the active revision unchanged when an edit fails", async () => {
    const { analyzeComfyWorkflowText, importComfyWorkflowToCatalog, updateComfyWorkflowInCatalog } = await import("./comfyuiWorkflowImportStore");
    const { materializeCertifiedComfyAssets, resolveComfyStagedCandidate } = await import("./comfyuiCandidateLifecycle");
    const { listModelCatalogMappings, listModelCatalogModels, listModelCatalogVendors } = await import("./catalogStore");
    const text = workflow("active");
    const binding = (analyzeComfyWorkflowText(text) as { analysis: { suggested: unknown } }).analysis.suggested;
    const first = importComfyWorkflowToCatalog({ text, binding, labelZh: "Active" }, "active") as {
      ok: true; modelKey: string; vendorKey: string; revisionId: string; taskKind: "image_to_video";
    };
    const evidence = [{
      kind: "video", contentType: "video/mp4", byteLength: 128, sha256: "a".repeat(64),
      metadata: { width: 16, height: 16, durationSeconds: 1, streamCount: 1 },
    }] as const;
    await materializeCertifiedComfyAssets({
      certification: { candidate: resolveComfyStagedCandidate(first), evidence: [...evidence] },
      status: "succeeded", urls: ["https://output.invalid/video.mp4"],
      materialize: async () => {
        expect(listModelCatalogModels({ vendorKey: first.vendorKey })).toContainEqual(expect.objectContaining({ enabled: false }));
        return "nomi-local://asset/video.mp4";
      },
    });
    expect(listModelCatalogModels({ vendorKey: first.vendorKey })).toContainEqual(expect.objectContaining({ modelKey: first.modelKey, enabled: true }));
    expect(listModelCatalogMappings({ vendorKey: first.vendorKey })).toContainEqual(expect.objectContaining({ modelKey: first.modelKey, enabled: true }));
    expect(JSON.stringify(listModelCatalogModels({ vendorKey: first.vendorKey }))).toContain('"sha256":"aaaaaaaa');

    const activeBefore = JSON.stringify({
      models: listModelCatalogModels({ vendorKey: first.vendorKey }),
      mappings: listModelCatalogMappings({ vendorKey: first.vendorKey }),
    });
    const editText = workflow("broken edit");
    const editBinding = (analyzeComfyWorkflowText(editText) as { analysis: { suggested: unknown } }).analysis.suggested;
    const edit = updateComfyWorkflowInCatalog({ vendorKey: first.vendorKey, modelKey: first.modelKey, text: editText, binding: editBinding, labelZh: "Edit" }) as {
      ok: true; modelKey: string; vendorKey: string; revisionId: string; taskKind: "image_to_video";
    };
    await expect(materializeCertifiedComfyAssets({
      certification: { candidate: resolveComfyStagedCandidate(edit), evidence: [...evidence] },
      status: "succeeded", urls: ["https://output.invalid/changed.mp4"],
      materialize: async () => { throw new Error("evidence_mismatch"); },
    })).rejects.toThrow("evidence_mismatch");

    expect(listModelCatalogVendors().some((vendor: { key: string }) => vendor.key === edit.vendorKey)).toBe(false);
    expect(JSON.stringify({
      models: listModelCatalogModels({ vendorKey: first.vendorKey }),
      mappings: listModelCatalogMappings({ vendorKey: first.vendorKey }),
    })).toBe(activeBefore);
  });
});
