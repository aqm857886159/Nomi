import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ProductionRunLockBusyError,
  ProductionRunLockLostError,
  createProductionRunLock,
  inspectProductionRunLockFile,
} from "./productionRunLock";

const tempDirs: string[] = [];

function makeLocks() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-run-lock-"));
  tempDirs.push(dir);
  let tick = 0;
  const now = () => `2026-08-23T00:00:${String(tick).padStart(2, "0")}.000Z`;
  const advance = (seconds: number) => { tick += seconds; };
  const first = createProductionRunLock({
    filePath: path.join(dir, "run.lock"),
    epochPath: path.join(dir, "run.lock.epoch"),
    ownerId: "owner-a",
    now,
    leaseMs: 10_000,
    randomId: () => "unused-a",
  });
  const second = createProductionRunLock({
    filePath: path.join(dir, "run.lock"),
    epochPath: path.join(dir, "run.lock.epoch"),
    ownerId: "owner-b",
    now,
    leaseMs: 10_000,
    randomId: () => "unused-b",
  });
  return { dir, first, second, advance };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("inspectProductionRunLockFile", () => {
  const LEASE_MS = 10_000;
  function aged(content: string, ageMs: number) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-run-lock-"));
    tempDirs.push(dir);
    const file = path.join(dir, "file.lock");
    fs.writeFileSync(file, content);
    const stamp = new Date(Date.now() - ageMs);
    fs.utimesSync(file, stamp, stamp);
    return file;
  }

  it("a live lease is held, an expired lease and no file are free: acquire can take those", () => {
    const { dir, first } = makeLocks();
    const lockFile = path.join(dir, "run.lock");
    expect(inspectProductionRunLockFile(lockFile, "lease")).toBe("free");
    const lease = first.acquire();
    const inside = Date.parse(lease.expiresAt) - 1;
    expect(inspectProductionRunLockFile(lockFile, "lease", 10_000, inside)).toBe("held");
    expect(inspectProductionRunLockFile(lockFile, "lease", 10_000, Date.parse(lease.expiresAt))).toBe("free");
    expect(inspectProductionRunLockFile(path.join(dir, "run.lock.epoch"), "epoch")).toBe("free");
  });

  it.each([["", "zero bytes, the state a crash between open and write leaves"], ["garbled", "not a lease"], ["{\"schemaVersion\":1}", "not a whole lease"]])(
    "an unparseable lease stays held while someone could still be writing it, and is dead after a whole lease: %s (%s)", (content) => {
      expect(inspectProductionRunLockFile(aged(content, 0), "lease", LEASE_MS)).toBe("held");
      expect(inspectProductionRunLockFile(aged(content, LEASE_MS + 1000), "lease", LEASE_MS)).toBe("dead");
    });

  it("an unparseable epoch follows the same rule", () => {
    expect(inspectProductionRunLockFile(aged("garbled", 0), "epoch", LEASE_MS)).toBe("held");
    expect(inspectProductionRunLockFile(aged("garbled", LEASE_MS + 1000), "epoch", LEASE_MS)).toBe("dead");
  });

  it("acquire itself stays closed on a dead file: only a caller that knows what the lock guards may replace it", () => {
    const file = aged("garbled", LEASE_MS + 1000);
    const lock = createProductionRunLock({ filePath: file, epochPath: `${file}.epoch` });
    expect(() => lock.acquire()).toThrow(ProductionRunLockBusyError);
    expect(fs.readFileSync(file, "utf8")).toBe("garbled");
  });
});

describe("ProductionRunLock", () => {
  it("serializes owners and advances the fencing epoch after release", () => {
    const { first, second } = makeLocks();
    const firstLease = first.acquire();
    expect(firstLease).toMatchObject({ ownerId: "owner-a", fencingEpoch: 1 });
    expect(() => second.acquire()).toThrow(ProductionRunLockBusyError);
    first.release(firstLease);

    const secondLease = second.acquire();
    expect(secondLease).toMatchObject({ ownerId: "owner-b", fencingEpoch: 2 });
    expect(() => first.assertOwned(firstLease)).toThrow(ProductionRunLockLostError);
    second.release(secondLease);
  });

  it("reclaims an expired lock atomically and fences the old owner", () => {
    const { first, second, advance } = makeLocks();
    const firstLease = first.acquire();
    advance(11);
    const secondLease = second.acquire();

    expect(secondLease.fencingEpoch).toBe(2);
    expect(() => first.renew(firstLease)).toThrow(ProductionRunLockLostError);
    second.release(secondLease);
  });

  it("renews only the current owner and keeps a live lock from being stolen", () => {
    const { first, second, advance } = makeLocks();
    const firstLease = first.acquire();
    advance(9);
    first.renew(firstLease);
    advance(9);
    expect(() => second.acquire()).toThrow(ProductionRunLockBusyError);
    first.release(firstLease);
  });

  it("runs a callback under the lease and releases it after success or failure", async () => {
    const { first, second } = makeLocks();
    await expect(first.withLock(async (lease) => {
      expect(lease.fencingEpoch).toBe(1);
      expect(() => second.acquire()).toThrow(ProductionRunLockBusyError);
      return "ok";
    })).resolves.toBe("ok");
    const secondLease = second.acquire();
    expect(secondLease.fencingEpoch).toBe(2);
    second.release(secondLease);

    await expect(first.withLock(async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(first.acquire().fencingEpoch).toBe(4);
  });
});
