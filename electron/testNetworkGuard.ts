import { URL } from "node:url";

export type TestNetworkRedirect = { from: string; to: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export class TestNetworkBlockedError extends Error {
  readonly hostname: string;

  constructor(hostname: string) {
    super(`Test network blocked: ${hostname}`);
    this.name = "TestNetworkBlockedError";
    this.hostname = hostname;
  }
}

export function testNetworkGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NOMI_TEST_NETWORK_GUARD === "1";
}

function parseOrigins(raw: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const value of String(raw || "").split(",").map((item) => item.trim()).filter(Boolean)) {
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") origins.add(url.origin);
    } catch {
      // Invalid fixture registration is ignored; the request still fails closed below.
    }
  }
  return origins;
}

function parseRedirects(raw: string | undefined): TestNetworkRedirect[] {
  try {
    const entries = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry): TestNetworkRedirect[] => {
      if (!entry || typeof entry.from !== "string" || typeof entry.to !== "string") return [];
      try {
        const from = new URL(entry.from);
        const to = new URL(entry.to);
        if (!/^https?:$/.test(from.protocol) || !/^https?:$/.test(to.protocol)) return [];
        return [{ from: from.origin, to: to.origin }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return LOOPBACK_HOSTS.has(host) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function redirectedUrl(url: URL, redirects: readonly TestNetworkRedirect[]): URL | null {
  const match = redirects.find((entry) => entry.from === url.origin);
  if (!match) return null;
  const target = new URL(match.to);
  target.pathname = `${target.pathname.replace(/\/$/, "")}${url.pathname || "/"}`;
  target.search = url.search;
  target.hash = url.hash;
  return target;
}

/** The test/UX boundary for every main-process HTTP entry. Production is opt-in free. */
export function guardTestNetworkUrl(rawUrl: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!testNetworkGuardEnabled(env)) return rawUrl;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TestNetworkBlockedError(rawUrl);
  }
  const redirected = redirectedUrl(url, parseRedirects(env.NOMI_TEST_NETWORK_REDIRECTS));
  if (redirected) url = redirected;
  const registered = parseOrigins(env.NOMI_TEST_NETWORK_FIXTURE_ORIGINS);
  if (isLoopback(url.hostname) || registered.has(url.origin)) return redirected ? url.toString() : rawUrl;
  throw new TestNetworkBlockedError(url.hostname);
}
