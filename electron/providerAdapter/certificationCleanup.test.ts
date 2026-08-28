import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  completeCertificationCleanupLease,
  recordCertificationCleanupFailure,
  registerCertificationCleanupLease,
  retryCertificationCleanup,
} from "./certificationCleanup";

let root = "";
const run = (id: string) => path.join(root, `run-${id}`);

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-cleanup-lease-")); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("certification cleanup leases", () => {
  it("recovers a crash after lease registration and before run cleanup", async () => {
    fs.mkdirSync(run("crashed"));
    await registerCertificationCleanupLease(root, run("crashed"), 1_000);
    await expect(retryCertificationCleanup(root, undefined, { nowMs: 10_000, activeLeaseStaleMs: 1_000 })).resolves.toBe(0);
    expect(fs.existsSync(run("crashed"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".cleanup-manifest.json"))).toBe(false);
  });

  it("serializes concurrent manifest mutations without losing entries", async () => {
    fs.mkdirSync(run("one")); fs.mkdirSync(run("two"));
    await Promise.all([
      registerCertificationCleanupLease(root, run("one"), 1_000),
      registerCertificationCleanupLease(root, run("two"), 1_000),
    ]);
    await Promise.all([
      recordCertificationCleanupFailure(root, run("one")),
      recordCertificationCleanupFailure(root, run("two")),
    ]);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, ".cleanup-manifest.json"), "utf8"));
    expect(manifest.entries.map((entry: { id: string }) => entry.id).sort()).toEqual(["run-one", "run-two"]);
    expect(JSON.stringify(manifest)).not.toMatch(/https?:|provider|body|artifact/);
  });

  it("does not reclaim a live lease but reclaims it after restart staleness", async () => {
    fs.mkdirSync(run("active"));
    await registerCertificationCleanupLease(root, run("active"), 5_000);
    const cleanup = vi.fn(async (target: string) => fs.promises.rm(target, { recursive: true, force: true }));
    await expect(retryCertificationCleanup(root, cleanup, { nowMs: 5_500, activeLeaseStaleMs: 1_000 })).resolves.toBe(1);
    expect(cleanup).not.toHaveBeenCalled();
    await expect(retryCertificationCleanup(root, cleanup, { nowMs: 7_000, activeLeaseStaleMs: 1_000 })).resolves.toBe(0);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("atomically removes a successful cleanup lease", async () => {
    fs.mkdirSync(run("done"));
    await registerCertificationCleanupLease(root, run("done"));
    fs.rmSync(run("done"), { recursive: true, force: true });
    await completeCertificationCleanupLease(root, run("done"));
    expect(fs.existsSync(path.join(root, ".cleanup-manifest.json"))).toBe(false);
  });
});
