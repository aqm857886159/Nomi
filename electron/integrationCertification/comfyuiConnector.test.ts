import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ComfyUiConnector } from "./comfyuiConnector";
import { CertificationMediaError } from "../providerAdapter/certificationMedia";

const apiWorkflow = JSON.stringify({
  "1": { class_type: "LoadImage", inputs: { image: "first.png" } },
  "2": { class_type: "LoadImage", inputs: { image: "second.png" } },
  "3": { class_type: "CLIPTextEncode", inputs: { text: "a prompt", clip: ["4", 0] } },
  "4": { class_type: "VHS_VideoCombine", inputs: { images: ["3", 0], frame_rate: 24 } },
});
const validPng = fs.readFileSync(path.join(__dirname, "../providerAdapter/__fixtures__/certification-media/valid.png"));

describe("ComfyUiConnector", () => {
  it("builds an API prompt from explicit multi-media bindings without widget-position mapping", () => {
    const connector = new ComfyUiConnector();
    const prepared = connector.prepareWorkflow({
      workflowText: apiWorkflow,
      binding: {
        images: [
          { nodeId: "1", inputKey: "image", paramKey: "comfy_reference_a", label: "A", mediaKind: "image" },
          { nodeId: "2", inputKey: "image", paramKey: "comfy_reference_b", label: "B", mediaKind: "image" },
        ],
        outputNodeId: "4",
        outputKind: "video",
        params: [
          {
            nodeId: "4",
            inputKey: "frame_rate",
            paramKey: "comfy_frame_rate",
            label: "FPS",
            type: "number",
            default: 24,
          },
        ],
      },
    });
    expect((prepared.mapping.create as { request_transform?: string }).request_transform).toBe("comfyui-prompt");
    const prompt = (prepared.mapping.create as { body?: { prompt?: unknown } }).body?.prompt as Record<
      string,
      { inputs: Record<string, unknown> }
    >;
    expect(prompt["1"]?.inputs.image).toBe("{{request.params.comfy_reference_a}}");
    expect(prompt["2"]?.inputs.image).toBe("{{request.params.comfy_reference_b}}");
    expect(prompt["4"]?.inputs.frame_rate).toBe("{{request.params.comfy_frame_rate}}");
    expect(prepared.parameters.find((p) => p.key === "comfy_frame_rate")?.type).toBe("number");
    expect(JSON.stringify(prepared)).not.toContain("widgets_values");

    const request = connector.buildProductionRequest(
      prepared,
      {
        comfy_reference_a: "slot-a.png",
        comfy_reference_b: "slot-b.png",
        comfy_frame_rate: 30,
      },
      { clientId: "nomi-test" },
    );
    expect(request.prompt["1"]).toMatchObject({ inputs: { image: "slot-a.png" } });
    expect(request.prompt["2"]).toMatchObject({ inputs: { image: "slot-b.png" } });
    expect((request.prompt["4"] as { inputs: Record<string, unknown> }).inputs.frame_rate).toBe(30);
    expect(typeof (request.prompt["4"] as { inputs: Record<string, unknown> }).inputs.frame_rate).toBe("number");
  });

  it("keeps UI workflow conversion behind the existing smart converter", async () => {
    const smart = vi.fn(async (..._args: unknown[]) => ({
      ok: true as const,
      analysis: { suggested: { images: [] } },
      convertedText: apiWorkflow,
      sourceWorkflowText: "ui",
    }));
    const connector = new ComfyUiConnector({ analyzeSmart: smart as never });
    const result = await connector.analyze("ui", "comfyui-local");
    expect(result.ok).toBe(true);
    expect(smart).toHaveBeenCalledWith("ui", "comfyui-local");
  });

  it("stages imports disabled and returns an explicit candidate handle", () => {
    const stage = vi.fn((..._args: unknown[]) => ({
      ok: true as const,
      modelKey: "comfy-demo",
      kind: "video",
      taskKind: "text_to_video",
      vendorKey: "comfy-stage",
      revisionId: "r1",
    }));
    const connector = new ComfyUiConnector({ importWorkflow: stage });
    const result = connector.stage({
      workflowText: apiWorkflow,
      binding: { outputNodeId: "4", outputKind: "video" },
      labelZh: "Demo",
      uniq: "x",
    });
    expect(result).toMatchObject({ revisionId: "r1", modelKey: "comfy-demo", vendorKey: "comfy-stage" });
    expect(stage.mock.calls[0]?.[0]).toMatchObject({ text: apiWorkflow, labelZh: "Demo" });
  });

  it("updates the existing model through the canonical update path without changing modelKey", () => {
    const update = vi.fn(() => ({
      ok: true as const,
      modelKey: "original-key",
      kind: "video",
      taskKind: "text_to_video",
      vendorKey: "comfy-stage",
      revisionId: "r2",
    }));
    const connector = new ComfyUiConnector({ updateWorkflow: update });
    const result = connector.update({
      modelKey: "original-key",
      workflowText: apiWorkflow,
      binding: { outputNodeId: "4", outputKind: "video" },
      labelZh: "Renamed",
    });
    expect(result.modelKey).toBe("original-key");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ modelKey: "original-key" }));
  });

  it("runs upload -> prompt -> history -> view -> bounded decode before promotion", async () => {
    const events: string[] = [];
    const connector = new ComfyUiConnector();
    const prepared = connector.prepareWorkflow({
      workflowText: apiWorkflow,
      binding: {
        images: [
          { nodeId: "1", inputKey: "image", paramKey: "comfy_a", label: "A", mediaKind: "image" },
          { nodeId: "2", inputKey: "image", paramKey: "comfy_b", label: "B", mediaKind: "image" },
        ],
        outputNodeId: "4",
        outputKind: "video",
      },
    });
    const promoted: unknown[] = [];
    const result = await connector.runProduction(prepared, {
      media: {
        comfy_a: { bytes: new Uint8Array([1]), contentType: "image/png" },
        comfy_b: { bytes: new Uint8Array([2]), contentType: "image/png" },
      },
      params: {},
      uploadMedia: async (slot) => {
        events.push(`upload:${slot.paramKey}`);
        return `${slot.paramKey}.png`;
      },
      submitPrompt: async (request) => {
        events.push("prompt");
        expect((request.prompt["4"] as { inputs: Record<string, unknown> }).inputs.frame_rate).toBe(24);
        return { promptId: "p1" };
      },
      readHistory: async () => {
        events.push("history");
        return { status: "succeeded", outputs: [{ url: "http://comfy/view/output.png", contentType: "image/png" }] };
      },
      readView: async () => {
        events.push("view");
        return { bytes: validPng, contentType: "image/png" };
      },
      decodeImage: async () => {
        events.push("decode");
        return { mimeType: "image/png", width: 1, height: 1 };
      },
      expectedKind: "image",
      promote: async (evidence) => {
        events.push("promote");
        promoted.push(evidence);
      },
    });
    expect(result.promptId).toBe("p1");
    expect(events).toEqual(["upload:comfy_a", "upload:comfy_b", "prompt", "history", "view", "decode", "promote"]);
    expect(promoted).toHaveLength(1);
  });

  it("does not promote when a viewed artifact fails bounded media validation", async () => {
    const connector = new ComfyUiConnector();
    const prepared = connector.prepareWorkflow({
      workflowText: apiWorkflow,
      binding: { outputNodeId: "4", outputKind: "video" },
    });
    const promote = vi.fn();
    await expect(
      connector.runProduction(prepared, {
        media: {},
        params: {},
        submitPrompt: async () => ({ promptId: "p2" }),
        readHistory: async () => ({
          status: "succeeded",
          outputs: [{ url: "http://comfy/view/bad", contentType: "text/html" }],
        }),
        readView: async () => ({ bytes: new Uint8Array([60, 104, 116, 109, 108, 62]), contentType: "text/html" }),
        promote,
      }),
    ).rejects.toBeInstanceOf(CertificationMediaError);
    expect(promote).not.toHaveBeenCalled();
  });

  it("reconciles an unknown submission by remote task id without issuing a second prompt", async () => {
    const connector = new ComfyUiConnector();
    const prepared = connector.prepareWorkflow({ workflowText: apiWorkflow, binding: { outputNodeId: "4", outputKind: "image" } });
    const readHistory = vi.fn(async (promptId: string) => {
      expect(promptId).toBe("remote-accepted-1");
      return { status: "succeeded" as const, outputs: [{ url: "http://comfy/view/reconciled.png", contentType: "image/png" }] };
    });
    const promote = vi.fn();
    const result = await connector.reconcileProduction(prepared, "remote-accepted-1", {
      media: {}, params: {},
      readHistory,
      readView: async () => ({ bytes: validPng, contentType: "image/png" }),
      decodeImage: async () => ({ mimeType: "image/png", width: 1, height: 1 }),
      expectedKind: "image",
      promote,
    });
    expect(result.promptId).toBe("remote-accepted-1");
    expect(readHistory).toHaveBeenCalledTimes(1);
    expect(promote).toHaveBeenCalledTimes(1);
  });
});
