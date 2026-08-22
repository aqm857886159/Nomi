import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ProductionRunLockBusyError,
  ProductionRunLockLostError,
  createProductionRunLock,
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
