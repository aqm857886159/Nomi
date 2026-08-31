export class BoundedResponseError extends Error {
  readonly code: "response_too_large" | "response_cancelled" | "response_timeout" | "response_read_failed";

  constructor(code: BoundedResponseError["code"], cause?: unknown) {
    super(`Bounded response read failed (${code})`);
    this.name = "BoundedResponseError";
    this.code = code;
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause;
  }
}

export async function readBoundedResponseBytes(
  response: Response,
  options: { maxBytes: number; signal?: AbortSignal },
): Promise<Buffer> {
  if (!Number.isFinite(options.maxBytes) || options.maxBytes < 1) throw new BoundedResponseError("response_read_failed");
  const abortedCode = () => options.signal?.reason instanceof Error && options.signal.reason.name === "TimeoutError"
    ? "response_timeout" as const
    : "response_cancelled" as const;
  if (options.signal?.aborted) throw new BoundedResponseError(abortedCode());
  const declared = Number(response.headers.get("content-length") || "0");
  if (!response.body) throw new BoundedResponseError("response_read_failed");
  const reader = response.body.getReader();
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    try { await reader.cancel(); } catch { /* preserve stable size error */ }
    throw new BoundedResponseError("response_too_large");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (options.signal?.aborted) throw new BoundedResponseError(abortedCode());
      const { value, done } = await reader.read();
      if (done) {
        if (options.signal?.aborted) throw new BoundedResponseError(abortedCode());
        break;
      }
      if (!value) continue;
      total += value.byteLength;
      if (total > options.maxBytes) {
        try { await reader.cancel(); } catch { /* preserve stable size error */ }
        throw new BoundedResponseError("response_too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BoundedResponseError) throw error;
    throw new BoundedResponseError(options.signal?.aborted ? abortedCode() : "response_read_failed", error);
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)), total);
}

export async function readBoundedResponseText(
  response: Response,
  options: { maxBytes: number; signal?: AbortSignal },
): Promise<string> {
  return (await readBoundedResponseBytes(response, options)).toString("utf8");
}
