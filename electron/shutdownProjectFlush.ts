import { randomUUID } from "node:crypto";
import { registerQuitDrain } from "./quitTeardown";

export const SHUTDOWN_FLUSH_REQUEST_CHANNEL = "nomi:project:shutdown-flush-request";
export const SHUTDOWN_FLUSH_RESPONSE_CHANNEL = "nomi:project:shutdown-flush-response";
/** Own cap inside the 500ms unattended-exit budget; the Agent lane close runs beside it and keeps its time. */
export const SHUTDOWN_FLUSH_TIMEOUT_MS = 400;

export type ShutdownFlushWindow = { send(channel: string, payload: { requestId: string }): void };

export interface ShutdownProjectFlushDependencies {
  /** Live windows only (not destroyed, renderer not crashed). */
  windows(): ShutdownFlushWindow[];
  /** Subscribes to renderer receipts; payload is whatever the renderer sent. */
  onResponse(listener: (payload: unknown) => void): void;
  onError(stage: string, error: unknown): void;
  newRequestId?: () => string;
}

function parseResponse(payload: unknown): { requestId: string; ok: boolean } | null {
  if (!payload || typeof payload !== "object") return null;
  const requestId = String((payload as { requestId?: unknown }).requestId || "").trim();
  if (!requestId) return null;
  return { requestId, ok: (payload as { ok?: unknown }).ok === true };
}

/**
 * Registers the one drain that makes the renderer write its pending project changes before the OS
 * session ends. The write itself stays the renderer's existing save path (single writer in main);
 * this only asks for it and waits for the receipt. No receipt in time: the owner's timeout logs it
 * and the shutdown goes on (the owner ends the process, never this module).
 */
export function installShutdownProjectFlush(deps: ShutdownProjectFlushDependencies): void {
  const pending = new Map<string, (ok: boolean) => void>();
  deps.onResponse((payload) => {
    const response = parseResponse(payload);
    if (response) pending.get(response.requestId)?.(response.ok);
  });
  registerQuitDrain("renderer-project-flush", async () => {
    const receipts = deps.windows().map((window) => new Promise<boolean>((resolve) => {
      const requestId = (deps.newRequestId ?? randomUUID)();
      pending.set(requestId, resolve);
      try {
        window.send(SHUTDOWN_FLUSH_REQUEST_CHANNEL, { requestId });
      } catch (error) {
        deps.onError("renderer-project-flush-send-failed", error);
        resolve(false);
      }
    }));
    const results = await Promise.all(receipts);
    const failed = results.filter((ok) => !ok).length;
    if (failed > 0) deps.onError("renderer-project-flush-failed", { windows: results.length, failed });
  }, { required: true, critical: true, timeoutMs: SHUTDOWN_FLUSH_TIMEOUT_MS });
}
