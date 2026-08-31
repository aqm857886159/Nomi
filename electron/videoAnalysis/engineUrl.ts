const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export class VideoAnalysisEngineUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoAnalysisEngineUrlError";
  }
}

export function normalizeLoopbackEngineUrl(value: unknown): string {
  const input = typeof value === "string" ? value.trim() : "";
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new VideoAnalysisEngineUrlError("Invalid local analysis engine URL");
  }
  if (parsed.protocol !== "http:") {
    throw new VideoAnalysisEngineUrlError("Local analysis engine must use HTTP");
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new VideoAnalysisEngineUrlError("Local analysis engine must use an explicit loopback host");
  }
  if (parsed.username || parsed.password) {
    throw new VideoAnalysisEngineUrlError("Local analysis engine origin cannot contain credentials");
  }
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new VideoAnalysisEngineUrlError("Local analysis engine URL must be an origin without path, query, or fragment");
  }
  return parsed.origin;
}
