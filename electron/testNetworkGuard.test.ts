import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

import { guardTestNetworkUrl, TestNetworkBlockedError } from "./testNetworkGuard";

// 放行判定的唯一正本（走查闸四层与产品闸共用）。
const shared = createRequire(import.meta.url)("./shared/walkAllowlist.cjs") as {
  parseAllowlist: (raw: string) => unknown;
  allowsUrl: (list: unknown, url: URL) => boolean;
  allowsHostPort: (list: unknown, host: string, port: number) => boolean;
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const base = { NOMI_TEST_NETWORK_GUARD: "1" } as NodeJS.ProcessEnv;

describe("test network guard: paid-walk allowlist (NOMI_WALK_ALLOW_ORIGINS)", () => {
  const env = { ...base, NOMI_WALK_ALLOW_ORIGINS: "https://api.vendor.invalid,*.cdn.invalid" } as NodeJS.ProcessEnv;

  it("lets the exact origin and the wildcard domain with its subdomains through", () => {
    expect(guardTestNetworkUrl("https://api.vendor.invalid/v1/x", env)).toBe("https://api.vendor.invalid/v1/x");
    expect(guardTestNetworkUrl("https://img.cdn.invalid/a.png", env)).toBe("https://img.cdn.invalid/a.png");
    expect(guardTestNetworkUrl("https://cdn.invalid/a.png", env)).toBe("https://cdn.invalid/a.png");
  });

  it("blocks look-alike domains and other origins", () => {
    expect(() => guardTestNetworkUrl("https://cdn.invalid.evil.test/a", env)).toThrow(TestNetworkBlockedError);
    expect(() => guardTestNetworkUrl("https://evilcdn.invalid/a", env)).toThrow(TestNetworkBlockedError);
    expect(() => guardTestNetworkUrl("https://other.vendor.invalid/a", env)).toThrow(TestNetworkBlockedError);
  });

  it("ignores the list under CI", () => {
    expect(() => guardTestNetworkUrl("https://api.vendor.invalid/v1/x", { ...env, CI: "true" })).toThrow(TestNetworkBlockedError);
  });

  it("writes a blocked line (via product-guard) to the walk ledger", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-tng-"));
    dirs.push(dir);
    const log = path.join(dir, "net.jsonl");
    expect(() => guardTestNetworkUrl("https://x.invalid/p?secret=1", { ...base, NOMI_WALK_NET_LOG: log })).toThrow(TestNetworkBlockedError);
    const entry = JSON.parse(fs.readFileSync(log, "utf8").trim());
    expect(entry).toMatchObject({ kind: "blocked", via: "product-guard", host: "x.invalid", url: "https://x.invalid/p" });
  });
});

describe("allowlist: one source of truth for the walk guard and the product guard", () => {
  it("both guards reference the same module and neither keeps its own copy of the matching rules", () => {
    const root = path.resolve(__dirname, "..");
    const walkGuard = fs.readFileSync(path.join(root, "scripts", "walkthrough-network-guard.cjs"), "utf8");
    const productGuard = fs.readFileSync(path.join(root, "electron", "testNetworkGuard.ts"), "utf8");
    expect(walkGuard).toContain("../electron/shared/walkAllowlist.cjs");
    expect(productGuard).toContain("./shared/walkAllowlist.cjs");
    for (const source of [walkGuard, productGuard]) expect(source).not.toMatch(/DEFAULT_PORTS|effectivePort|WILDCARD_PORTS|ALLOWED_SUFFIXES/);
  });

  // [名单, 请求, 放不放行]：对共享模块直接判，也经产品闸端到端走一遍
  const cases: Array<[string, string, boolean]> = [
    ["https://api.v.invalid", "https://api.v.invalid/x", true],
    ["https://api.v.invalid", "https://api.v.invalid:443/x", true],
    ["https://api.v.invalid", "https://api.v.invalid:9999/x", false],
    ["https://api.v.invalid:8443", "https://api.v.invalid:8443/x", true],
    ["https://api.v.invalid:8443", "https://api.v.invalid/x", false],
    ["https://api.v.invalid:8443", "https://api.v.invalid:9999/x", false],
    ["https://api.v.invalid", "http://api.v.invalid/x", false],
    ["https://api.v.invalid", "https://sub.api.v.invalid/x", false],
    ["*.cdn.invalid", "https://cdn.invalid/a", true],
    ["*.cdn.invalid", "https://img.cdn.invalid/a", true],
    ["*.cdn.invalid", "http://img.cdn.invalid/a", true],
    ["*.cdn.invalid", "https://img.cdn.invalid:443/a", true],
    ["*.cdn.invalid", "https://img.cdn.invalid:8443/a", false],
    ["*.cdn.invalid", "https://cdn.invalid.evil.test/a", false],
    ["*.cdn.invalid", "https://evilcdn.invalid/a", false],
  ];

  it.each(cases)("%s  ←  %s  =>  %s", (raw, target, expected) => {
    const url = new URL(target);
    const list = shared.parseAllowlist(raw);
    expect(shared.allowsUrl(list, url)).toBe(expected);
    let productAllows = true;
    try { guardTestNetworkUrl(target, { ...base, NOMI_WALK_ALLOW_ORIGINS: raw }); } catch { productAllows = false; }
    expect(productAllows).toBe(expected);
    // 连接层（只有主机 + 端口）在协议对得上的用例里必须同一个答案。
    if (url.protocol === "https:") {
      const port = Number(url.port || 443);
      expect(shared.allowsHostPort(list, url.hostname, port)).toBe(expected);
    }
  });

  it("an empty list under CI allows nothing in either implementation", () => {
    expect(shared.allowsUrl(shared.parseAllowlist(""), new URL("https://a.invalid/"))).toBe(false);
    expect(() => guardTestNetworkUrl("https://a.invalid/", { ...base, NOMI_WALK_ALLOW_ORIGINS: "https://a.invalid", CI: "1" })).toThrow(TestNetworkBlockedError);
  });
});
