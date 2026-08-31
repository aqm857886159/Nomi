import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let server: http.Server;
let baseUrl = "";
const statusHits = new Map<string, number>();

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nomi-fal-loopback", getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
  webContents: { getAllWebContents: () => [] },
}));

import { executeProfileOperation, buildProfileTaskResult } from "../runtime";
import { FAL_OFFICIAL_MODELS } from "./falOfficial";
import type { Mapping, Model, Vendor } from "./types";

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://loopback");
    const contentType = "application/json";
    if (request.method === "POST") {
      response.writeHead(200, { "Content-Type": contentType });
      response.end(JSON.stringify({ request_id: "fal-loopback-request", status: "IN_QUEUE" }));
      return;
    }
    if (request.method === "GET" && url.pathname.endsWith("/status")) {
      const key = url.pathname;
      const hit = (statusHits.get(key) || 0) + 1;
      statusHits.set(key, hit);
      response.writeHead(200, { "Content-Type": contentType });
      response.end(JSON.stringify({ request_id: "fal-loopback-request", status: hit === 1 ? "IN_PROGRESS" : "COMPLETED" }));
      return;
    }
    if (request.method === "GET" && url.pathname.includes("/requests/fal-loopback-request")) {
      const asset = url.pathname.includes("image-to-3d")
        ? { model_mesh: { url: "https://cdn.example.test/asset.glb" } }
        : url.pathname.includes("music-3") || url.pathname.includes("sound-effects")
          ? { audio: { url: "https://cdn.example.test/asset.mp3" } }
          : url.pathname.includes("video")
            ? { video: { url: "https://cdn.example.test/asset.mp4" } }
            : { images: [{ url: "https://cdn.example.test/asset.png" }] };
      response.writeHead(200, { "Content-Type": contentType });
      response.end(JSON.stringify(asset));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server?.close());

const representatives = [
  ["image", "text_to_image", "fal-ai/nano-banana-2", "fal-ai/nano-banana-2"],
  ["video", "text_to_video", "minimax/h3-max", "minimax/h3-max/text-to-video"],
  ["audio", "text_to_audio", "minimax/music-3", "minimax/music-3"],
  ["model3d", "image_to_3d", "hitem3d/hi3d/v3.0", "hitem3d/hi3d/v3.0/image-to-3d"],
] as const;

describe("fal queue lifecycle loopback (zero provider spend)", () => {
  it.each(representatives)("runs %s create → queued/running/completed → result through production executor", async (_kind, taskKind, modelKey, endpoint) => {
    const raw = FAL_OFFICIAL_MODELS.find((model) => model.modelKey === modelKey)?.mappings.find((item) => item.taskKind === taskKind && item.create.path === `/${endpoint}`);
    expect(raw).toBeTruthy();
    const mapping = { ...raw!, enabled: true, createdAt: "", updatedAt: "" } as Mapping;
    const model: Model = { modelKey, vendorKey: "fal", labelZh: modelKey, kind: _kind, enabled: true, createdAt: "", updatedAt: "" };
    const vendor: Vendor = { key: "fal", name: "fal.ai", enabled: true, baseUrlHint: baseUrl, authType: "bearer", authHeader: "Authorization", createdAt: "", updatedAt: "" };
    const request = { kind: taskKind, prompt: "a loopback test", extras: { modelKey, params: { duration: 5, resolution: "768P" } } } as never;

    const created = await executeProfileOperation({ vendor, model, apiKey: "loopback-key", request, operation: mapping.create });
    const queued = await buildProfileTaskResult({ response: created.response, mapping, operation: mapping.create, request, taskIdFallback: "", wantedKind: _kind, vendor, model });
    expect(queued.result.status).toBe("queued");
    const providerMeta = { task_id: queued.result.id, query_id: queued.result.id };

    const runningResponse = await executeProfileOperation({ vendor, model, apiKey: "loopback-key", request, operation: mapping.query!, providerMeta });
    const running = await buildProfileTaskResult({ response: runningResponse.response, mapping, operation: mapping.query!, request, taskIdFallback: queued.result.id, wantedKind: _kind, vendor, model });
    expect(running.result.status).toBe("running");
    const completedResponse = await executeProfileOperation({ vendor, model, apiKey: "loopback-key", request, operation: mapping.query!, providerMeta });
    const completed = await buildProfileTaskResult({ response: completedResponse.response, mapping, operation: mapping.query!, request, taskIdFallback: queued.result.id, wantedKind: _kind, vendor, model });
    expect(completed.result.status).toBe("succeeded");

    const resultResponse = await executeProfileOperation({ vendor, model, apiKey: "loopback-key", request, operation: mapping.result!, providerMeta });
    const result = await buildProfileTaskResult({ response: resultResponse.response, mapping, operation: mapping.result!, request, taskIdFallback: queued.result.id, wantedKind: _kind, vendor, model });
    expect(result.result.status).toBe("succeeded");
    expect(result.result.assets[0]?.providerUrl).toMatch(/^https:\/\/cdn\.example\.test\/asset\./);
  });
});
