import { describe, expect, it } from "vitest";
import { migrateCatalogMediaContracts } from "./catalogMediaContractMigration";
import type { CatalogState, Mapping, Model } from "./types";

const graph = {
  "1": { class_type: "LoadImage", inputs: { image: "author.png" } },
  "2": { class_type: "KSampler", inputs: { positive: ["1", 0], seed: 1 } },
  "5": { class_type: "VHS_VideoCombine", inputs: { images: ["2", 0], frame_rate: 24 } },
};

function staleCatalog(script?: string): CatalogState {
  const staleBinding = {
    images: [{ nodeId: "5", inputKey: "frame_rate", paramKey: "first_frame_url", label: "首帧", mediaKind: "image" }],
    outputNodeId: "5",
    outputKind: "video",
    params: [],
  };
  const model: Model = {
    modelKey: "minimax-h3",
    vendorKey: "comfyui-local",
    labelZh: "MiniMax H3",
    kind: "video",
    enabled: true,
    meta: {
      parameters: [{ key: "first_frame_url", label: "首帧", type: "image-url", mediaKind: "image", default: "" }],
      comfyWorkflowImport: { text: JSON.stringify(graph), binding: staleBinding },
    },
    ...(script ? { customCall: { script, updatedAt: "2026-08-01T00:00:00.000Z" } } : {}),
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  const mapping: Mapping = {
    id: "mapping-stale",
    vendorKey: model.vendorKey,
    modelKey: model.modelKey,
    taskKind: "image_to_video",
    name: model.labelZh,
    enabled: true,
    create: {
      method: "POST",
      path: "/prompt",
      request_transform: "comfyui-prompt",
      body: {
        prompt: {
          ...structuredClone(graph),
          "5": {
            ...graph["5"],
            inputs: { ...graph["5"].inputs, frame_rate: "{{request.params.first_frame_url}}" },
            _meta: { nomi_bound_media_input: "frame_rate" },
          },
        },
      },
      defaultParams: { first_frame_url: "" },
    },
    query: { method: "GET", path: "/history/{{providerMeta.task_id}}", response_mapping: { video_url: "video_url" } },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
  return { version: 10, vendors: [], models: [model], mappings: [mapping], apiKeysByVendor: {} };
}

describe("catalog v10 -> v11 media contract migration", () => {
  it("atomically rebuilds a stored ComfyUI binding/mapping so image data cannot remain in frame_rate", () => {
    const migration = migrateCatalogMediaContracts(staleCatalog());
    const result = migration.state;
    expect(migration.unresolved).toBe(false);
    const model = result.models[0];
    const draft = (model.meta as {
      parameters: Array<{ key: string }>;
      comfyWorkflowImport: { binding: { images: Array<{ nodeId: string; inputKey: string; paramKey: string }> } };
    });
    const prompt = (result.mappings[0].create?.body as { prompt: typeof graph }).prompt;

    expect(draft.comfyWorkflowImport.binding.images).toEqual([
      expect.objectContaining({ nodeId: "1", inputKey: "image", paramKey: "first_frame_url" }),
    ]);
    expect(draft.parameters.map((item) => item.key)).toEqual(["first_frame_url"]);
    expect(prompt["1"].inputs.image).toBe("{{request.params.first_frame_url}}");
    expect(prompt["5"].inputs.frame_rate).toBe(24);
    expect(result.mappings[0]).toMatchObject({ id: "mapping-stale", taskKind: "image_to_video", enabled: true });
  });

  it("does not rewrite a custom mapping unless its stored prompt proves the stale numeric media placeholder", () => {
    const state = staleCatalog();
    (state.mappings[0].create!.body as { prompt: Record<string, unknown> }).prompt = { custom: true };
    const result = migrateCatalogMediaContracts(structuredClone(state));
    expect(result.state.mappings).toEqual(state.mappings);
  });

  it("is idempotent", () => {
    const once = migrateCatalogMediaContracts(staleCatalog()).state;
    expect(migrateCatalogMediaContracts(once)).toEqual({ state: once, unresolved: false });
  });

  it("migrates legacy firstFrameNodeId fields and preserves unrelated prompt edits", () => {
    const state = staleCatalog();
    const draft = (state.models[0].meta as { comfyWorkflowImport: { binding: Record<string, unknown> } }).comfyWorkflowImport;
    draft.binding = {
      firstFrameNodeId: "5",
      firstFrameInputKey: "frame_rate",
      outputNodeId: "5",
      outputKind: "video",
      params: [],
    };
    const prompt = (state.mappings[0].create!.body as { prompt: Record<string, { inputs: Record<string, unknown> }> }).prompt;
    prompt["2"].inputs.seed = 999;

    const result = migrateCatalogMediaContracts(state);
    expect(result.unresolved).toBe(false);
    expect((result.state.mappings[0].create!.body as { prompt: typeof prompt }).prompt["2"].inputs.seed).toBe(999);
    expect((result.state.mappings[0].create!.body as { prompt: typeof prompt }).prompt["5"].inputs.frame_rate).toBe(24);
    expect((result.state.models[0].meta as { comfyWorkflowImport: { binding: { images: unknown[] } } }).comfyWorkflowImport.binding.images).toHaveLength(1);
  });

  it("does not guess or delete a media slot when replacement is ambiguous", () => {
    const state = staleCatalog();
    const draft = (state.models[0].meta as { comfyWorkflowImport: { text: string; binding: { images: Array<Record<string, unknown>> } } }).comfyWorkflowImport;
    draft.text = JSON.stringify({ ...graph, "3": { class_type: "LoadImage", inputs: { image: "second.png" } } });
    draft.binding.images[0].paramKey = "legacy_image";
    const prompt = (state.mappings[0].create!.body as { prompt: Record<string, { inputs: Record<string, unknown> }> }).prompt;
    prompt["5"].inputs.frame_rate = "{{request.params.legacy_image}}";
    const before = structuredClone(state);

    expect(migrateCatalogMediaContracts(state)).toEqual({ state: before, unresolved: true });
  });

  it.each([
    ["sourceVideoNodeId", "sourceVideoInputKey", "source_video_url", "video", { "1": { class_type: "LoadImage", inputs: { image: "only.png" } } }],
    ["firstFrameNodeId", "firstFrameInputKey", "first_frame_url", "image", { "4": { class_type: "LoadVideo", inputs: { file: "only.mp4" } } }],
  ] as const)("does not migrate a legacy %s role into the sole opposite-media slot", (nodeField, inputField, paramKey, mediaKind, candidate) => {
    const state = staleCatalog();
    const wrongGraph = { ...candidate, "5": graph["5"] };
    const draft = (state.models[0].meta as { comfyWorkflowImport: { text: string; binding: Record<string, unknown> } }).comfyWorkflowImport;
    draft.text = JSON.stringify(wrongGraph);
    draft.binding = { [nodeField]: "5", [inputField]: "frame_rate", outputNodeId: "5", outputKind: "video", params: [] };
    const prompt = (state.mappings[0].create!.body as { prompt: Record<string, { inputs: Record<string, unknown> }> }).prompt;
    prompt["5"].inputs.frame_rate = `{{request.params.${paramKey}}}`;
    (state.models[0].meta as { parameters: unknown[] }).parameters = [{ key: paramKey, type: "image-url", mediaKind }];
    const before = structuredClone(state);

    expect(migrateCatalogMediaContracts(state)).toEqual({ state: before, unresolved: true });
  });
});
