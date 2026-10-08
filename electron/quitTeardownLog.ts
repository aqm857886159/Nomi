import { logError, logInfo, logWarn, type LogFields } from "./logging/logger";
import type { QuitTeardownDependencies } from "./quitTeardown";

function asFields(payload: unknown): LogFields | undefined {
  if (!payload || typeof payload !== "object") return payload === undefined ? undefined : { detail: String(payload) };
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, typeof value === "number" || typeof value === "boolean" ? value : String(value)]));
}

/** Where the quit owner's failures and receipts go (tests/ux/quit-teardown-real.e2e.mjs reads the receipts). */
export const quitTeardownLogSinks: Pick<QuitTeardownDependencies, "onError" | "onReceipt"> = {
  onError: (stage, error) => {
    if (error instanceof Error) logError("main", `quit-${stage}`, error);
    else if (stage === "exports-aborted") logInfo("export", "aborted-on-quit", asFields(error));
    // Timeouts arrive as plain fields; log them as fields, not as "[object Object]".
    else logWarn("main", `quit-${stage}`, asFields(error));
  },
  onReceipt: (event, fields) => logInfo("main", event, fields),
};
