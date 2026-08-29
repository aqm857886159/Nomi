import type { Session } from "electron";

type ContentSecurityPolicyOptions = Readonly<{
  isDev: boolean;
  lowMemoryMode: boolean;
  skipCrossOriginIsolation: boolean;
  skipCrossOriginIsolationForWindowsFrameless: boolean;
  disableCrossOriginIsolation: boolean;
}>;

function buildContentSecurityPolicy(isDev: boolean): string {
  const common = [
    "default-src 'self' nomi-local:",
    "img-src 'self' nomi-local: https: data: blob:",
    "media-src 'self' nomi-local: https: data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
  ];
  if (isDev) {
    return [
      ...common,
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: http://127.0.0.1:5273",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' nomi-local: https: ws://127.0.0.1:5273 http://127.0.0.1:5273 blob:",
    ].join("; ");
  }
  return [
    ...common,
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' nomi-local: https: blob:",
  ].join("; ");
}

export function installContentSecurityPolicy(targetSession: Session, options: ContentSecurityPolicyOptions): void {
  const csp = buildContentSecurityPolicy(options.isDev);
  const crossOriginIsolationDisabled =
    options.lowMemoryMode ||
    options.skipCrossOriginIsolation ||
    options.skipCrossOriginIsolationForWindowsFrameless ||
    options.disableCrossOriginIsolation;
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders: Record<string, string[]> = {
      ...details.responseHeaders,
      "Content-Security-Policy": [csp],
    };
    if (!crossOriginIsolationDisabled) {
      responseHeaders["Cross-Origin-Opener-Policy"] = ["same-origin"];
      responseHeaders["Cross-Origin-Embedder-Policy"] = ["require-corp"];
    }
    callback({ responseHeaders });
  });
}
