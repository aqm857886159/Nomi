import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createEcutClient } from "./ecutClient";

const resources: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of resources.splice(0).reverse()) await cleanup();
});

async function fixture(
  handler: http.RequestListener,
): Promise<{ origin: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  resources.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  return { origin: `http://127.0.0.1:${address.port}` };
}

function sourceFile(contents = "video-bytes"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-ecut-client-"));
  resources.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, "reference.mp4");
  fs.writeFileSync(filePath, contents);
  return filePath;
}

describe("e-cut local client", () => {
  it("authenticates and streams a deterministic submission with stable identity", async () => {
    let received = "";
    const { origin } = await fixture((request, response) => {
      if (request.url === "/api/health") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          ok: true,
          engine: "eccut-local",
          version: "eccut-local-api-v2",
          pipeline_ready: true,
          analysis_modes: ["deterministic", "model"],
        }));
        return;
      }
      expect(request.headers.authorization).toBe("Bearer test-token");
      expect(request.headers["x-eccut-request-id"]).toBe("nomi-analysis-12345678");
      expect(request.headers["x-eccut-analysis-mode"]).toBe("deterministic");
      request.setEncoding("utf8");
      request.on("data", (chunk) => { received += chunk; });
      request.on("end", () => {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          protocol_version: "eccut-local-api-v2",
          request_id: "nomi-analysis-12345678",
          task_id: "task-0123456789abcdef0123456789abcdef",
          deduplicated: false,
        }));
      });
    });
    const client = createEcutClient({ origin, token: "test-token" });

    const health = await client.health();
    const submitted = await client.submit({
      filePath: sourceFile(),
      requestId: "nomi-analysis-12345678",
      externalInference: false,
    });

    expect(health.analysisModes).toEqual(["deterministic", "model"]);
    expect(received).toBe("video-bytes");
    expect(submitted.taskId).toBe("task-0123456789abcdef0123456789abcdef");
    expect(submitted.sourceSha256).toBe("79fd615a866fe7f9eb4da8d9c41ab57e3bd48056df42fd2c13e4d461a87afbe3");
  });

  it("looks up an unknown submission, polls it, requests cancellation, and cleans a completed source", async () => {
    const taskId = "task-0123456789abcdef0123456789abcdef";
    const calls: string[] = [];
    const { origin } = await fixture((request, response) => {
      calls.push(`${request.method} ${request.url}`);
      expect(request.headers.authorization).toBe("Bearer test-token");
      response.setHeader("Content-Type", "application/json");
      if (request.url?.startsWith("/api/task-lookup")) {
        response.end(JSON.stringify({ request_id: "nomi-analysis-12345678", task_id: taskId }));
      } else if (request.url?.endsWith("/source")) {
        response.end(JSON.stringify({ task_id: taskId, removed: true }));
      } else if (request.method === "DELETE") {
        response.statusCode = 202;
        response.end(JSON.stringify({ accepted: true, task_id: taskId, state: "cancel_requested" }));
      } else {
        response.end(JSON.stringify({
          task_id: taskId,
          done: false,
          stage: 3,
          stage_total: 6,
          stage_text: "OCR",
          logs: ["private path is intentionally dropped"],
        }));
      }
    });
    const client = createEcutClient({ origin, token: "test-token" });

    expect(await client.lookup("nomi-analysis-12345678")).toBe(taskId);
    expect((await client.poll(taskId)).stageText).toBe("OCR");
    await expect(client.cancel(taskId)).resolves.toEqual({ accepted: true, state: "cancel_requested" });
    await expect(client.deleteSource(taskId)).resolves.toEqual({ removed: true });
    expect(calls).toEqual([
      "GET /api/task-lookup?request_id=nomi-analysis-12345678",
      `GET /api/task/${taskId}`,
      `DELETE /api/task/${taskId}`,
      `DELETE /api/task/${taskId}/source`,
    ]);
  });

  it("fails closed on invalid JSON, oversized responses, timeouts, public origins, and missing tokens", async () => {
    const invalid = await fixture((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end("not-json");
    });
    await expect(createEcutClient({ origin: invalid.origin, token: "token" }).health()).rejects.toThrow(/JSON/i);

    const oversized = await fixture((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end("x".repeat(2048));
    });
    await expect(createEcutClient({ origin: oversized.origin, token: "token", maxResponseBytes: 1024 }).health())
      .rejects.toThrow(/large|size|bytes/i);

    const hanging = await fixture(() => undefined);
    await expect(createEcutClient({ origin: hanging.origin, token: "token", timeoutMs: 25 }).health())
      .rejects.toThrow(/timed out|timeout/i);

    expect(() => createEcutClient({ origin: "http://example.com:8931", token: "token" })).toThrow(/loopback/i);
    expect(() => createEcutClient({ origin: "http://127.0.0.1:8931", token: "" })).toThrow(/token/i);
  });

  it("rejects a poll response for a different task identity", async () => {
    const requested = "task-0123456789abcdef0123456789abcdef";
    const server = await fixture((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        task_id: "task-fedcba9876543210fedcba9876543210",
        done: false,
        stage: 1,
        stage_total: 6,
      }));
    });
    const client = createEcutClient({ origin: server.origin, token: "secret" });

    await expect(client.poll(requested)).rejects.toThrow(/identity/i);
  });

  it("rejects successful responses that are not declared as JSON", async () => {
    const html = await fixture((_request, response) => {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(JSON.stringify({ ok: true, engine: "spoofed", pipeline_ready: true }));
    });

    await expect(createEcutClient({ origin: html.origin, token: "token" }).health())
      .rejects.toThrow(/content-type|json/i);
  });
});
