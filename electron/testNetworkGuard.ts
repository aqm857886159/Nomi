import { appendFileSync } from "node:fs";
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

/**
 * 付费真跑走查的放行名单（NOMI_WALK_ALLOW_ORIGINS，与 scripts/walkthrough-network-guard.cjs 同一个变量、同一套写法）：
 * 逗号分隔，每项是精确 origin，或 `*.域名`（该域名本身及其子域；`getapib.org.evil.test` 不算）。CI 里一律忽略。
 * 两道闸认同一份名单，由走查（tests/ux/_paidRun.mjs）按授权供应商算出来传下来，调用方不手配。
 */
function walkAllowlist(env: NodeJS.ProcessEnv): { origins: Set<string>; suffixes: string[] } {
  const origins = new Set<string>();
  const suffixes: string[] = [];
  if (env.CI) return { origins, suffixes };
  for (const value of String(env.NOMI_WALK_ALLOW_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean)) {
    if (value.startsWith("*.")) {
      const suffix = value.slice(2).toLowerCase();
      if (/^[a-z0-9.-]+$/.test(suffix)) suffixes.push(suffix);
      continue;
    }
    try { origins.add(new URL(value).origin); } catch { /* ignored: fails closed below */ }
  }
  return { origins, suffixes };
}

function walkAllows(url: URL, env: NodeJS.ProcessEnv): boolean {
  const { origins, suffixes } = walkAllowlist(env);
  const host = url.hostname.toLowerCase();
  return origins.has(url.origin) || suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/** 被挡记一笔到走查账本（同闸的 blocked 行格式），让走查能立刻说出「谁在哪一层被挡」。只在走查设了账本路径时写。 */
function noteBlocked(url: URL, env: NodeJS.ProcessEnv): void {
  const log = env.NOMI_WALK_NET_LOG;
  if (!log) return;
  try {
    appendFileSync(log, `${JSON.stringify({ kind: "blocked", via: "product-guard", url: `${url.origin}${url.pathname}`, host: url.hostname, pid: process.pid, at: new Date().toISOString() })}
`);
  } catch { /* 记账失败不影响被测 App */ }
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
  if (isLoopback(url.hostname) || registered.has(url.origin) || walkAllows(url, env)) return redirected ? url.toString() : rawUrl;
  noteBlocked(url, env);
  throw new TestNetworkBlockedError(url.hostname);
}
