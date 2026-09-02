import { describe, expect, it } from "vitest";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import { applyBuiltinSeeds } from "./seedBuiltins";

const fixtureValue = (key: string): unknown => {
  if (key === "model") return "fixture-model";
  if (key === "file") return "fixture.wav";
  if (key === "image_with_roles") return [{ url: "https://fixture.invalid/ref.png", role: "reference_image" }];
  if (key.endsWith("_urls") || key === "image_urls") return ["https://fixture.invalid/ref.png"];
  if (["generate_audio", "audio", "sound", "instrumental", "customMode", "defaultParamFlag", "return_last_frame", "watermark"].includes(key)) return false;
  if (["duration", "continueAt", "speed", "bpm", "length", "seed"].includes(key)) return 5;
  if (key === "resolution") return "720p";
  if (key === "aspect_ratio" || key === "size") return "16:9";
  if (key === "output_format") return "mp4";
  return `fixture-${key}`;
};

function templateKeys(value: unknown): string[] {
  if (typeof value === "string") {
    return Array.from(value.matchAll(/\{\{request\.params\.([^}]+)\}\}/g), (match) => match[1]);
  }
  if (Array.isArray(value)) return value.flatMap(templateKeys);
  if (value && typeof value === "object") return Object.values(value).flatMap(templateKeys);
  return [];
}

describe("official vendor-doc audit wire construction", () => {
  it("dry-runs every KIE and APIMart mapping, including reference-bearing modes", () => {
    const { state } = applyBuiltinSeeds({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, "2026-09-02T00:00:00.000Z");
    const mappings = state.mappings.filter((mapping) => mapping.vendorKey === "kie" || mapping.vendorKey === "apimart");
    expect(mappings.filter((mapping) => mapping.vendorKey === "kie")).toHaveLength(32);
    expect(mappings.filter((mapping) => mapping.vendorKey === "apimart")).toHaveLength(49);

    for (const mapping of mappings) {
      const operation = mapping.create;
      const params = Object.fromEntries(templateKeys(operation.body ?? operation.multipart).map((key) => [key, fixtureValue(key)]));
      const request = { kind: mapping.taskKind, prompt: "fixture prompt", extras: params };
      const context = buildTemplateContext({
        request,
        params,
        model: { modelKey: mapping.modelKey || "fixture-model" },
        modelKey: mapping.modelKey || "fixture-model",
        apiKey: "test-secret",
      });
      const built = buildHttpRequest({
        baseUrl: mapping.vendorKey === "kie" ? "https://api.kie.ai" : "https://api.apimart.ai",
        authType: "bearer",
        apiKey: "test-secret",
        context,
        operation,
      });
      const serialized = JSON.stringify({ url: built.url, query: built.query, body: built.body });
      expect(serialized, `${mapping.vendorKey}/${mapping.id} left a template placeholder`).not.toMatch(/\{\{[^}]+\}\}/);
      expect(built.url).toMatch(mapping.vendorKey === "kie" ? /api\.kie\.ai\/api\/v1/ : /api\.apimart\.ai\/v1/);
    }
  });
});
