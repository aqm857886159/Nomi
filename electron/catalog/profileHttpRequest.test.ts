import { describe, expect, it } from "vitest";
import { buildProfileHttpRequest } from "./profileHttpRequest";
import type { HttpOperation, Model, Vendor } from "./types";

const vendor = { key: "apimart", baseUrlHint: "https://api.apimart.ai", authType: "bearer" } as Vendor;
const model = { vendorKey: "apimart", modelKey: "MiniMax-H3", kind: "video", labelZh: "MiniMax H3" } as Model;
const operation: HttpOperation = {
  method: "POST",
  path: "/v1/videos/generations",
  body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", image_urls: "{{request.params.image_urls}}" },
};

describe("buildProfileHttpRequest outbound references", () => {
  it("returns a serialized reference URL in the built MiniMax-H3 request body", () => {
    const built = buildProfileHttpRequest({
      vendor,
      model,
      apiKey: "test-key",
      request: { kind: "text_to_video", prompt: "move", extras: { image_urls: ["https://cdn.example.com/Windows ref.png"] } },
      operation,
    });
    expect((built.body as { image_urls: string[] }).image_urls[0]).toBe("https://cdn.example.com/Windows%20ref.png");
  });
});
