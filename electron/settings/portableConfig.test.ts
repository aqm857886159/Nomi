import { describe, expect, it } from "vitest";
import { createPortableConfigBundle, parsePortableConfigBundle, portableConfigJson } from "./portableConfig";

describe("portable config bundle", () => {
  it("exports public catalog and removes credentials and device paths", () => {
    const bundle = createPortableConfigBundle({
      catalog: {
        vendors: [{ key: "openai", apiKey: "secret", meta: { baseUrl: "https://api.example.com" } }],
        models: [{ vendorKey: "openai", modelKey: "gpt" }],
        mappings: [{ vendorKey: "openai", request: { path: "/v1/chat" } }],
      },
      defaults: { image: "openai", cachePath: "/Users/alice/Library/Application Support/Nomi" },
      prompts: { system: "make a film" },
      preferences: { language: "zh-CN", theme: "dark" },
      exportedAt: "2026-09-02T00:00:00.000Z",
    });

    const serialized = portableConfigJson(bundle);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("/Users/alice");
    expect(bundle.redactions).toEqual({ apiKeys: "omitted", absolutePaths: "omitted", deviceState: "omitted" });
    expect(bundle.catalog.vendors[0]).toEqual({ key: "openai", meta: { baseUrl: "https://api.example.com" } });
  });

  it("rejects wrong version and missing redaction contract", () => {
    expect(() => parsePortableConfigBundle({ schemaVersion: 2 })).toThrow();
    expect(() => parsePortableConfigBundle({ schemaVersion: 1, app: { product: "Nomi" } })).toThrow();
  });

  it("round-trips a valid bundle", () => {
    const bundle = createPortableConfigBundle({ catalog: { vendors: [], models: [], mappings: [] }, defaults: {}, prompts: {} });
    expect(parsePortableConfigBundle(JSON.parse(portableConfigJson(bundle)))).toEqual(bundle);
  });
});
