import { describe, expect, it, vi } from "vitest";
import type { CatalogState } from "../catalog/types";
import { createGenerationDefaultModelResolver } from "./generationDefaultModelResolver";

const readyApimartKey = {
  vendorKey: "apimart",
  apiKey: Buffer.from("synthetic-ready-key").toString("base64"),
  enc: "safeStorage" as const,
  enabled: true,
  createdAt: "",
  updatedAt: "",
};

const state = (
  models: CatalogState["models"],
  apiKeysByVendor: CatalogState["apiKeysByVendor"] = { apimart: readyApimartKey },
): CatalogState => ({
  version: 11,
  vendors: [
    { key: "apimart", name: "APIMart", enabled: true, authType: "bearer", createdAt: "", updatedAt: "" },
    // A no-auth vendor proves that local providers do not need a fabricated
    // credential merely to resolve a saved default.
    { key: "other", name: "Other", enabled: true, authType: "none", createdAt: "", updatedAt: "" },
  ],
  models,
  mappings: models.flatMap((model) => [
    {
      id: `${model.vendorKey}-${model.modelKey}-image`, vendorKey: model.vendorKey, modelKey: model.modelKey,
      taskKind: model.kind === "image" ? "text_to_image" : "text_to_video", name: "mapping", enabled: true,
      create: { method: "POST", path: "/generate", body: {} }, createdAt: "", updatedAt: "",
    },
    ...(model.kind === "video" ? [{
      id: `${model.vendorKey}-${model.modelKey}-i2v`, vendorKey: model.vendorKey, modelKey: model.modelKey,
      taskKind: "image_to_video" as const, name: "i2v", enabled: true,
      create: { method: "POST", path: "/video", body: {} }, createdAt: "", updatedAt: "",
    }] : []),
  ]),
  apiKeysByVendor,
});

const model = (vendorKey: string, modelKey: string, kind: "image" | "video") => ({
  vendorKey, modelKey, labelZh: modelKey, kind, enabled: true, meta: {}, createdAt: "", updatedAt: "",
});

describe("generation storyboard default model resolver", () => {
  it("uses the saved vendor+model identity instead of the first catalog row", () => {
    const resolve = createGenerationDefaultModelResolver(
      state([model("apimart", "first-image", "image"), model("other", "saved-image", "image")]),
      { schemaVersion: 1, byTaskKind: { text_to_image: { vendorKey: "other", modelKey: "saved-image" } } },
    );
    expect(resolve("text_to_image")).toEqual({ moduleId: "generation.single-shot", providerId: "other", modelId: "saved-image", mode: "text_to_image" });
  });

  it("blocks when the saved model is missing instead of silently choosing row zero", () => {
    const catalog = state([model("apimart", "healthy-image", "image")]);
    const resolve = createGenerationDefaultModelResolver(catalog, {
      schemaVersion: 1,
      byTaskKind: { text_to_image: { vendorKey: "missing", modelKey: "gone" } },
    });
    expect(resolve("text_to_image")).toBeUndefined();
  });

  it("does not select a disabled saved model", () => {
    const disabled = { ...model("apimart", "disabled-image", "image"), enabled: false };
    const resolve = createGenerationDefaultModelResolver(
      state([disabled]),
      { schemaVersion: 1, byTaskKind: { text_to_image: { vendorKey: "apimart", modelKey: "disabled-image" } } },
    );
    expect(resolve("text_to_image")).toBeUndefined();
  });

  it("keeps image-to-video as the declared mode for a saved video default", () => {
    const resolve = createGenerationDefaultModelResolver(
      state([model("apimart", "video", "video")]),
      { schemaVersion: 1, byTaskKind: { image_to_video: { vendorKey: "apimart", modelKey: "video" } } },
    );
    expect(resolve("image_to_video")).toMatchObject({ modelId: "video", mode: "image_to_video" });
  });

  it("does not select a model for a task kind that is not published", () => {
    const resolve = createGenerationDefaultModelResolver(
      state([model("apimart", "image-only", "image")]),
      { schemaVersion: 1, byTaskKind: { image_edit: { vendorKey: "apimart", modelKey: "image-only" } } },
    );

    // The catalog row is published for text_to_image only.  A saved image_edit
    // preference must not make the semantic planner emit an unsupported mode.
    expect(resolve("image_edit")).toBeUndefined();
  });

  it("does not treat a saved preference as executable when the credential record is missing", () => {
    const catalog = state([model("apimart", "image", "image")], {});
    const resolve = createGenerationDefaultModelResolver(catalog, {
      schemaVersion: 1,
      byTaskKind: { text_to_image: { vendorKey: "apimart", modelKey: "image" } },
    });

    expect(resolve("text_to_image")).toBeUndefined();
  });

  it("does not decrypt or execute a credential that has been disabled", () => {
    const probe = vi.fn(() => "ok" as const);
    const catalog = state([model("apimart", "image", "image")], {
      apimart: { ...readyApimartKey, enabled: false },
    });
    const resolve = createGenerationDefaultModelResolver(
      catalog,
      { schemaVersion: 1, byTaskKind: { text_to_image: { vendorKey: "apimart", modelKey: "image" } } },
      { keyStatusProbe: probe },
    );

    expect(resolve("text_to_image")).toBeUndefined();
    expect(probe).not.toHaveBeenCalled();
  });

  it("blocks a credential whose safeStorage status is locked", () => {
    const catalog = state([model("apimart", "image", "image")], {
      apimart: { ...readyApimartKey, apiKey: "synthetic-locked-ciphertext" },
    });
    const resolve = createGenerationDefaultModelResolver(
      catalog,
      { schemaVersion: 1, byTaskKind: { text_to_image: { vendorKey: "apimart", modelKey: "image" } } },
      { keyStatusProbe: () => "locked" },
    );

    expect(resolve("text_to_image")).toBeUndefined();
  });

  it("blocks a saved-but-unverified plaintext credential (needs_resave)", () => {
    const catalog = state([model("apimart", "image", "image")], {
      apimart: { ...readyApimartKey, apiKey: "legacy-fixture", enc: "plain" },
    });
    const resolve = createGenerationDefaultModelResolver(catalog, {
      schemaVersion: 1,
      byTaskKind: { text_to_image: { vendorKey: "apimart", modelKey: "image" } },
    });

    expect(resolve("text_to_image")).toBeUndefined();
  });

  it("probes one credential once when several task kinds share a vendor", () => {
    const probe = vi.fn(() => "ok" as const);
    const catalog = state([model("apimart", "image", "image"), model("apimart", "video", "video")]);
    const resolve = createGenerationDefaultModelResolver(
      catalog,
      {
        schemaVersion: 1,
        byTaskKind: {
          text_to_image: { vendorKey: "apimart", modelKey: "image" },
          text_to_video: { vendorKey: "apimart", modelKey: "video" },
        },
      },
      { keyStatusProbe: probe },
    );

    expect(resolve("text_to_image")).toMatchObject({ modelId: "image" });
    expect(resolve("text_to_video")).toMatchObject({ modelId: "video" });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
