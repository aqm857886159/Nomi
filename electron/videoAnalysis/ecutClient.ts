import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

import {
  ECUT_TASK_ID_PATTERN,
  parseEcutHealthResponse,
  parseEcutTaskResponse,
  type EcutHealth,
  type EcutTask,
} from "./contracts";
import { normalizeLoopbackEngineUrl } from "./engineUrl";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

export class EcutClientError extends Error {
  constructor(message: string, readonly statusCode: number | null = null) {
    super(message);
    this.name = "EcutClientError";
  }
}

type ClientOptions = {
  origin: string;
  token: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxUploadBytes?: number;
};

type RequestOptions = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  headers?: Record<string, string>;
  filePath?: string;
  expectedSourceSha256?: string;
};

type WireResult = { value: unknown; sourceSha256: string | null };

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EcutClientError(`Invalid e-cut ${label} response`);
  }
  return value as Record<string, unknown>;
}

function taskId(value: unknown): string {
  const id = typeof value === "string" ? value : "";
  if (!ECUT_TASK_ID_PATTERN.test(id)) throw new EcutClientError("Invalid e-cut task id response");
  return id;
}

function requestId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!REQUEST_ID_PATTERN.test(id)) throw new EcutClientError("Invalid e-cut request id");
  return id;
}

export function createEcutClient(options: ClientOptions) {
  const origin = normalizeLoopbackEngineUrl(options.origin);
  const token = String(options.token || "").trim();
  if (!token || token.length > 512 || /[\r\n]/.test(token)) throw new EcutClientError("A valid local e-cut API token is required");
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const maxResponseBytes = Math.max(256, Math.floor(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES));
  const maxUploadBytes = Math.max(1, Math.floor(options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES));

  async function prepareUpload(filePath: string, expectedSourceSha256?: string): Promise<{
    handle: fs.promises.FileHandle;
    size: number;
    sha256: string;
  }> {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | noFollow);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new EcutClientError("e-cut source is not a file");
      if (stat.size <= 0 || stat.size > maxUploadBytes) {
        throw new EcutClientError(`e-cut source size is outside the ${maxUploadBytes} byte limit`);
      }
      const hash = crypto.createHash("sha256");
      await new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(filePath, { fd: handle.fd, autoClose: false, start: 0 });
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", resolve);
      });
      const sha256 = hash.digest("hex");
      if (expectedSourceSha256 && sha256 !== expectedSourceSha256) {
        throw new EcutClientError("e-cut source changed after Nomi recorded its integrity hash");
      }
      return { handle, size: stat.size, sha256 };
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  async function requestJson(requestOptions: RequestOptions): Promise<WireResult> {
    const upload = requestOptions.filePath
      ? await prepareUpload(requestOptions.filePath, requestOptions.expectedSourceSha256)
      : null;
    return new Promise((resolve, reject) => {
      const target = new URL(requestOptions.path, `${origin}/`);
      if (target.origin !== origin) {
        if (upload) void upload.handle.close().catch(() => undefined);
        reject(new EcutClientError("e-cut request escaped the configured loopback origin"));
        return;
      }
      const fileSize = upload?.size ?? 0;
      const headers: Record<string, string | number> = {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...requestOptions.headers,
      };
      if (requestOptions.filePath) {
        headers["Content-Type"] = "application/octet-stream";
        headers["Content-Length"] = fileSize;
      }
      let sourceEnded = !requestOptions.filePath;
      let responseEnded = false;
      let responseValue: unknown;
      let settled = false;

      const finish = () => {
        if (settled || !sourceEnded || !responseEnded) return;
        settled = true;
        if (upload) void upload.handle.close().catch(() => undefined);
        resolve({ value: responseValue, sourceSha256: upload?.sha256 ?? null });
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        if (upload) void upload.handle.close().catch(() => undefined);
        reject(error instanceof Error ? error : new EcutClientError(String(error)));
      };

      const request = http.request(target, { method: requestOptions.method, headers }, (response) => {
        const status = response.statusCode ?? 0;
        const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
        if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
          response.destroy();
          fail(new EcutClientError(`Invalid e-cut response Content-Type: ${contentType || "missing"}`, status));
          return;
        }
        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
          response.destroy();
          fail(new EcutClientError(`e-cut response is too large (${declaredLength} bytes)`, status));
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxResponseBytes) {
            response.destroy();
            fail(new EcutClientError(`e-cut response exceeded ${maxResponseBytes} bytes`, status));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on("error", fail);
        response.on("end", () => {
          if (settled) return;
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            fail(new EcutClientError("Invalid JSON from e-cut", status));
            return;
          }
          if (status < 200 || status >= 300) {
            const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
            const detail = typeof record.error === "string" ? record.error.slice(0, 500) : "request failed";
            fail(new EcutClientError(`e-cut HTTP ${status}: ${detail}`, status));
            return;
          }
          responseValue = parsed;
          responseEnded = true;
          finish();
        });
      });
      const wallClock = setTimeout(
        () => request.destroy(new EcutClientError(`e-cut request timed out at its ${timeoutMs}ms wall-clock deadline`)),
        timeoutMs,
      );
      wallClock.unref?.();
      request.setTimeout(timeoutMs, () => request.destroy(new EcutClientError(`e-cut request timed out after ${timeoutMs}ms`)));
      request.on("close", () => clearTimeout(wallClock));
      request.on("error", fail);

      if (requestOptions.filePath && upload) {
        const stream = fs.createReadStream(requestOptions.filePath, { fd: upload.handle.fd, autoClose: false, start: 0 });
        stream.on("error", (error) => request.destroy(error));
        stream.on("end", () => {
          sourceEnded = true;
          finish();
        });
        stream.pipe(request);
      } else {
        sourceEnded = true;
        request.end();
      }
    });
  }

  async function health(): Promise<EcutHealth> {
    // Health intentionally remains unauthenticated in e-cut, but sending the token keeps one request path.
    return parseEcutHealthResponse((await requestJson({ method: "GET", path: "/api/health" })).value);
  }

  async function submit(input: { filePath: string; requestId: string; externalInference: boolean; sourceSha256?: string }) {
    const identity = requestId(input.requestId);
    const response = await requestJson({
      method: "POST",
      path: "/api/deconstruct",
      filePath: input.filePath,
      expectedSourceSha256: input.sourceSha256,
      headers: {
        "X-EcCut-Request-Id": identity,
        "X-EcCut-Analysis-Mode": input.externalInference ? "model" : "deterministic",
      },
    });
    const record = jsonObject(response.value, "submit");
    if (record.request_id !== identity) throw new EcutClientError("e-cut submit response changed the request identity");
    return {
      taskId: taskId(record.task_id),
      requestId: identity,
      sourceSha256: response.sourceSha256 ?? "",
      deduplicated: record.deduplicated === true,
    };
  }

  async function lookup(value: string): Promise<string | null> {
    const identity = requestId(value);
    try {
      const response = await requestJson({
        method: "GET",
        path: `/api/task-lookup?request_id=${encodeURIComponent(identity)}`,
      });
      const record = jsonObject(response.value, "lookup");
      if (record.request_id !== identity) throw new EcutClientError("e-cut lookup response changed the request identity");
      return taskId(record.task_id);
    } catch (error) {
      if (error instanceof EcutClientError && error.statusCode === 404) return null;
      throw error;
    }
  }

  async function poll(value: string): Promise<EcutTask> {
    const id = taskId(value);
    const response = parseEcutTaskResponse((await requestJson({ method: "GET", path: `/api/task/${id}` })).value);
    if (response.taskId !== id) throw new EcutClientError("e-cut poll response changed the task identity");
    return response;
  }

  async function cancel(value: string): Promise<{ accepted: boolean; state: string }> {
    const id = taskId(value);
    const record = jsonObject((await requestJson({ method: "DELETE", path: `/api/task/${id}` })).value, "cancel");
    if (record.task_id !== id || record.accepted !== true || typeof record.state !== "string") {
      throw new EcutClientError("Invalid e-cut cancel response");
    }
    return { accepted: true, state: record.state };
  }

  async function deleteSource(value: string): Promise<{ removed: boolean }> {
    const id = taskId(value);
    const record = jsonObject((await requestJson({ method: "DELETE", path: `/api/task/${id}/source` })).value, "source cleanup");
    if (record.task_id !== id || typeof record.removed !== "boolean") {
      throw new EcutClientError("Invalid e-cut source cleanup response");
    }
    return { removed: record.removed };
  }

  return { health, submit, lookup, poll, cancel, deleteSource, origin };
}

export type EcutClient = ReturnType<typeof createEcutClient>;
