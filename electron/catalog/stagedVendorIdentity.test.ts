import { describe, expect, it } from "vitest";
import type { CatalogState } from "./types";
import { planStagedVendorIdentity } from "./stagedVendorIdentity";

const now = "2026-09-05T00:00:00.000Z";

function state(vendorEnabled: boolean): CatalogState {
  return {
    version: 8,
    vendors: [{
      key: "apimart",
      name: "APIMart",
      enabled: vendorEnabled,
      hasApiKey: true,
      baseUrlHint: "https://api.apimart.ai/v1",
      authType: "bearer",
      providerKind: "openai-compatible",
      createdAt: now,
      updatedAt: now,
    }],
    models: [{
      vendorKey: "apimart",
      modelKey: "deepseek-v4-pro",
      labelZh: "DeepSeek V4 Pro",
      kind: "text",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }],
    mappings: [],
    apiKeysByVendor: {},
  } as CatalogState;
}

describe("staged vendor identity", () => {
  it("keeps a de-published known vendor as the promotion target", () => {
    const result = planStagedVendorIdentity({
      state: state(false),
      sourceVendorKey: "apimart",
      connection: { baseUrl: "https://api.apimart.ai/v1", models: ["deepseek-v4-pro"] },
      revisionId: "run-1",
      selectedModelKeys: ["deepseek-v4-pro"],
      reuseUnpublishedCandidate: true,
    });

    expect(result).toMatchObject({ vendorKey: "apimart", isolated: false, sourceVendorKey: "apimart" });
  });

  it("still isolates a replacement when the source vendor is actively published", () => {
    const result = planStagedVendorIdentity({
      state: state(true),
      sourceVendorKey: "apimart",
      connection: { baseUrl: "https://api.apimart.ai/v1", models: ["deepseek-v4-pro"] },
      revisionId: "run-2",
      selectedModelKeys: ["deepseek-v4-pro"],
      reuseUnpublishedCandidate: true,
    });

    expect(result.isolated).toBe(true);
    expect(result.vendorKey).toMatch(/^apimart--candidate-/);
  });

  it("keeps a new model on the stable vendor when only an unrelated sibling is published", () => {
    const source = state(true);
    source.models[0] = {
      ...source.models[0],
      enabled: false,
      meta: { adapter: { state: "unverified", modes: [] } },
    };
    source.models.push({
      vendorKey: "apimart",
      modelKey: "published-sibling",
      labelZh: "Published sibling",
      kind: "image",
      enabled: true,
      meta: {
        adapter: {
          state: "verified",
          activeRevision: "revision-sibling",
          modes: [{ taskKind: "text_to_image", state: "verified" }],
        },
      },
      createdAt: now,
      updatedAt: now,
    });

    const result = planStagedVendorIdentity({
      state: source,
      sourceVendorKey: "apimart",
      connection: { baseUrl: "https://api.apimart.ai/v1", models: ["deepseek-v4-pro"] },
      revisionId: "run-3",
      selectedModelKeys: ["deepseek-v4-pro"],
      reuseUnpublishedCandidate: true,
    });

    expect(result).toMatchObject({ vendorKey: "apimart", isolated: false, sourceVendorKey: "apimart" });
  });
});
