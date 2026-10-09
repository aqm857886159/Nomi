import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { guardTestNetworkUrl, TestNetworkBlockedError } from "./testNetworkGuard";

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
