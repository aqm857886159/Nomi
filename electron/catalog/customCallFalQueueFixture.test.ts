/**
 * Real-platform fixture, production-generic implementation:
 * fal.ai official queue OpenAPI, fetched 2026-08-15 from
 * https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/wan/v2.2-a14b/image-to-video
 *
 * Platform names and endpoint paths deliberately live only in this test. The runner only provides
 * generic request + poll helpers; no provider branch is allowed in production code.
 */
import { describe, expect, it, vi } from "vitest";

const { requestBinary } = vi.hoisted(() => ({ requestBinary: vi.fn() }));

vi.mock("electron", () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

vi.mock("../vendor/vendorHttp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../vendor/vendorHttp")>();
  return {
    ...actual,
    requestBinary,
  };
});

import { runCustomCallScript } from "./customCallRunner";
import type { Model, Vendor } from "./types";

const vendor = {
  key: "fixture-platform",
  name: "Fixture platform",
  baseUrlHint: "https://queue.fal.run",
  enabled: true,
  authType: "none",
} as Vendor;

const model = {
  vendorKey: vendor.key,
  modelKey: "fal-ai/wan/v2.2-a14b/image-to-video",
  labelZh: "WAN 2.2 A14B",
  kind: "video",
  enabled: true,
  createdAt: "",
  updatedAt: "",
} as Model;

describe("generic custom call runner × real fal.ai queue fixture", () => {
  it("covers submit -> status queue/progress/completed -> result, including first/last frame and Key auth", async () => {
    const statusValues = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
    const jsonBinary = (payload: unknown) => ({
      bytes: Buffer.from(JSON.stringify(payload), "utf8"),
      contentType: "application/json",
    });
    requestBinary.mockImplementation(async (_vendor, _apiKey, method: string, url: string) => {
      if (method === "POST") return jsonBinary({ request_id: "req-123", status: "IN_QUEUE" });
      if (url.endsWith("/status")) return jsonBinary({ request_id: "req-123", status: statusValues.shift() });
      return jsonBinary({ video: { url: "https://cdn.example.test/final.mp4" }, seed: 42 });
    });

    const script = `const endpoint = '/fal-ai/wan/v2.2-a14b/image-to-video'
const headers = { Authorization: 'Key ' + apiKey }
const task = await request({
  method: 'POST', url: endpoint, headers,
  body: { prompt, image_url: references.firstFrame, end_image_url: references.lastFrame },
})
await poll(
  () => request({ method: 'GET', url: endpoint + '/requests/' + task.request_id + '/status', headers }),
  (state) => state.status === 'COMPLETED' ? true : null,
  { intervalMs: 500, timeoutMs: 5000 },
)
const result = await request({ method: 'GET', url: endpoint + '/requests/' + task.request_id, headers })
return result.video.url`;

    const result = await runCustomCallScript({
      vendor,
      model,
      apiKey: "fixture-secret",
      script,
      prompt: "camera pushes in",
      params: {
        first_frame_url: "https://assets.example.test/first.png",
        last_frame_url: "https://assets.example.test/last.png",
      },
      taskKind: "image_to_video",
      modeId: "firstlast",
      timeoutMs: 6000,
    });

    expect(result.assets).toEqual(["https://cdn.example.test/final.mp4"]);
    expect(requestBinary).toHaveBeenCalledTimes(5);
    const submit = requestBinary.mock.calls[0];
    expect(submit[2]).toBe("POST");
    expect(submit[4]).toEqual({ Authorization: "Key fixture-secret" });
    expect(submit[6]).toMatchObject({
      prompt: "camera pushes in",
      image_url: "https://assets.example.test/first.png",
      end_image_url: "https://assets.example.test/last.png",
    });
  });
});
