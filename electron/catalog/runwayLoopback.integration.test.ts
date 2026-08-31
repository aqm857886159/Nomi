import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let server: http.Server;
let baseUrl = "";
let requestBodies: Record<string, unknown>[] = [];
let pollCount = 0;

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nomi-runway-loopback", getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
  webContents: { getAllWebContents: () => [] },
}));

import { buildProfileTaskResult, executeProfileOperation } from "../runtime";
import { RUNWAY_OFFICIAL_MODELS } from "./runwayOfficial";
import type { Mapping, Model, Vendor } from "./types";

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://loopback");
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      request.on("end", () => {
        requestBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
        response.writeHead(200);
        response.end(JSON.stringify({ id: "runway-loopback-task" }));
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/v1/tasks/runway-loopback-task") {
      pollCount += 1;
      response.writeHead(200);
      response.end(JSON.stringify(pollCount === 1
        ? { id: "runway-loopback-task", status: "PENDING", createdAt: "2026-08-30T00:00:00.000Z" }
        : { id: "runway-loopback-task", status: "SUCCEEDED", output: ["https://cdn.example.test/runway.mp4"] }));
      return;
    }
    response.writeHead(404);
    response.end(JSON.stringify({ failure: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server?.close());

describe("Runway Dev create → status → result loopback (zero provider spend)", () => {
  it.each([
    ["gen4.5", "t2v", "text_to_video"],
    ["gen4.5", "i2v", "image_to_video"],
    ["gen4_turbo", "i2v", "image_to_video"],
  ] as const)("certifies the %s/%s mapping without a provider call", async (modelKey, modeId, taskKind) => {
    requestBodies = [];
    pollCount = 0;
    const raw = RUNWAY_OFFICIAL_MODELS.find((model) => model.modelKey === modelKey)?.mappings.find((item) => item.modeId === modeId);
    expect(raw).toBeTruthy();
    const mapping = { ...raw!, enabled: true, createdAt: "", updatedAt: "" } as Mapping;
    const model: Model = { modelKey, vendorKey: "runway", labelZh: modelKey, kind: "video", enabled: true, createdAt: "", updatedAt: "" };
    const vendor: Vendor = { key: "runway", name: "Runway Dev", enabled: true, baseUrlHint: baseUrl, authType: "bearer", authHeader: "Authorization", createdAt: "", updatedAt: "" };
    const request = { kind: taskKind, prompt: "a loopback camera move", extras: { modelKey, archetype: { modeId }, aspect_ratio: "1280:720", duration: 5, seed: 7, image_url: "https://assets.example.test/input.png" } } as never;

    const created = await executeProfileOperation({ vendor, model, apiKey: "loopback-key", request, operation: mapping.create });
    const queued = await buildProfileTaskResult({ response: created.response, mapping, operation: mapping.create, request, taskIdFallback: "", wantedKind: "video", vendor, model });
    expect(queued.result.status).toBe("queued");
    const providerMeta = { task_id: queued.result.id, query_id: queued.result.id };
    const pendingResponse = await executeProfileOperation({ vendor, model, apiKey: "loopback-key", request, operation: mapping.query!, providerMeta });
    const pending = await buildProfileTaskResult({ response: pendingResponse.response, mapping, operation: mapping.query!, request, taskIdFallback: queued.result.id, wantedKind: "video", vendor, model });
    expect(pending.result.status).toBe("queued");
    const completedResponse = await executeProfileOperation({ vendor, model, apiKey: "loopback-key", request, operation: mapping.query!, providerMeta });
    const completed = await buildProfileTaskResult({ response: completedResponse.response, mapping, operation: mapping.query!, request, taskIdFallback: queued.result.id, wantedKind: "video", vendor, model });
    expect(completed.result.status).toBe("succeeded");
    const resultResponse = await executeProfileOperation({ vendor, model, apiKey: "loopback-key", request, operation: mapping.result!, providerMeta });
    const result = await buildProfileTaskResult({ response: resultResponse.response, mapping, operation: mapping.result!, request, taskIdFallback: queued.result.id, wantedKind: "video", vendor, model });
    expect(result.result.status).toBe("succeeded");
    expect(result.result.assets[0]?.providerUrl).toBe("https://cdn.example.test/runway.mp4");
    expect(requestBodies[0]).toMatchObject({ model: modelKey, ratio: "1280:720", duration: 5, seed: 7 });
    if (modeId === "t2v") expect(requestBodies[0]).not.toHaveProperty("promptImage");
    else expect(requestBodies[0]).toHaveProperty("promptImage");
  });

  it.each([
    ["seedance2_5", "omni", "text_to_video", "video"],
    ["muse_image", "t2i", "text_to_image", "image"],
    ["seed_audio", "sfx", "text_to_audio", "audio"],
  ] as const)("covers the broad catalog %s/%s lifecycle without a provider call", async (modelKey, modeId, taskKind, wantedKind) => {
    requestBodies = [];
    pollCount = 0;
    const raw = RUNWAY_OFFICIAL_MODELS.find((model) => model.modelKey === modelKey)?.mappings.find((item) => item.modeId === modeId);
    expect(raw).toBeTruthy();
    const mapping = { ...raw!, enabled: true, createdAt: "", updatedAt: "" } as Mapping;
    const model: Model = { modelKey, vendorKey: "runway", labelZh: modelKey, kind: wantedKind, enabled: true, createdAt: "", updatedAt: "" };
    const vendor: Vendor = { key: "runway", name: "Runway Dev", enabled: true, baseUrlHint: baseUrl, authType: "bearer", authHeader: "Authorization", createdAt: "", updatedAt: "" };
    const request = { kind: taskKind, prompt: "a zero-cost broad catalog loopback", extras: { modelKey, archetype: { modeId }, aspect_ratio: "1280:720", duration: 5, output_count: 1, reference_audio_urls: ["runway://voice"], reference_image_urls: ["runway://ref"] } } as never;

    const created = await executeProfileOperation({ vendor, model, apiKey: "loopback-key", request, operation: mapping.create });
    const queued = await buildProfileTaskResult({ response: created.response, mapping, operation: mapping.create, request, taskIdFallback: "", wantedKind, vendor, model });
    expect(queued.result.status).toBe("queued");
    const providerMeta = { task_id: queued.result.id, query_id: queued.result.id };
    const pendingResponse = await executeProfileOperation({ vendor, model, apiKey: "loopback-key", request, operation: mapping.query!, providerMeta });
    expect((await buildProfileTaskResult({ response: pendingResponse.response, mapping, operation: mapping.query!, request, taskIdFallback: queued.result.id, wantedKind, vendor, model })).result.status).toBe("queued");
    const completedResponse = await executeProfileOperation({ vendor, model, apiKey: "loopback-key", request, operation: mapping.query!, providerMeta });
    expect((await buildProfileTaskResult({ response: completedResponse.response, mapping, operation: mapping.query!, request, taskIdFallback: queued.result.id, wantedKind, vendor, model })).result.status).toBe("succeeded");
    const resultResponse = await executeProfileOperation({ vendor, model, apiKey: "loopback-key", request, operation: mapping.result!, providerMeta });
    const result = await buildProfileTaskResult({ response: resultResponse.response, mapping, operation: mapping.result!, request, taskIdFallback: queued.result.id, wantedKind, vendor, model });
    expect(result.result.status).toBe("succeeded");
    expect(result.result.assets[0]?.providerUrl).toBe("https://cdn.example.test/runway.mp4");
    expect(requestBodies[0]?.model).toBe(modelKey);
  });
});
