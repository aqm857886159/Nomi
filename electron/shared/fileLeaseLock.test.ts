import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTestTemp, makeTempDir } from "../../scripts/_test-temp.mjs";
import { createExpiringFileLeaseLock } from "./fileLeaseLock";

type Owner = { nonce: string; expiresAt: number };
class Busy extends Error {}
class Lost extends Error {}

function parseOwner(value: unknown): Owner | null {
  const record = value as Partial<Owner> | null;
  if (!record || typeof record.nonce !== "string" || !Number.isFinite(record.expiresAt)) return null;
  return record as Owner;
}

let root: string;
let filePath: string;
let time: number;

beforeEach(() => {
  root = makeTempDir("file-lease");
  filePath = path.join(root, "test.lock");
  time = Date.now();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  cleanupTestTemp(root);
});

function open(nonce: string, extra: { heartbeatMs?: number; onAcquire?: (owner: Owner) => void } = {}) {
  return createExpiringFileLeaseLock({
    filePath,
    leaseMs: 100,
    nowMs: () => time,
    parse: parseOwner,
    create: (expiresAt) => ({ nonce, expiresAt }),
    extend: (record, expiresAt) => ({ ...record, expiresAt }),
    expiresAtMs: (record) => record.expiresAt,
    sameOwner: (current, expected) => current.nonce === expected.nonce,
    errors: { busy: (message) => new Busy(message), lost: (message) => new Lost(message) },
    ...extra,
  });
}

describe("expiring file lease", () => {
  it("uses exclusive publication and runs the fence before returning ownership", () => {
    const openSync = vi.spyOn(fs, "openSync");
    const contender = open("next");
    const onAcquire = vi.fn(() => {
      expect(() => contender.acquire()).toThrow(Busy);
      expect(JSON.parse(fs.readFileSync(filePath, "utf8")).nonce).toBe("first");
    });
    const lock = open("first", { onAcquire });
    const lease = lock.acquire();
    expect(openSync).toHaveBeenCalledWith(filePath, "wx");
    expect(onAcquire).toHaveBeenCalledWith(lease);
    expect(() => contender.acquire()).toThrow(Busy);
    lock.release(lease);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("reclaims an expired lease without letting the former owner release or overwrite its successor", () => {
    const oldLock = open("old");
    const old = oldLock.acquire();
    time += 100;
    const newLock = open("new");
    const current = newLock.acquire();
    expect(() => oldLock.release(old)).toThrow(Lost);
    expect(() => oldLock.renew(old)).toThrow(Lost);
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual(current);
    newLock.release(current);
  });

  it("renews while work is outstanding and releases the renewed record at completion", async () => {
    vi.useFakeTimers();
    const lock = open("heartbeat", { heartbeatMs: 30 });
    const contender = open("contender");
    const startedAt = time;
    const result = lock.withLock(async (lease) => {
      for (let beat = 0; beat < 4; beat += 1) {
        time += 30;
        await vi.advanceTimersByTimeAsync(30);
      }
      expect(time).toBeGreaterThan(lease.expiresAt);
      expect(JSON.parse(fs.readFileSync(filePath, "utf8")).expiresAt).toBe(startedAt + 220);
      expect(() => lock.assertOwned(lease)).not.toThrow();
      expect(() => contender.acquire()).toThrow(Busy);
      return "done";
    });
    await expect(result).resolves.toBe("done");
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("reclaims an interrupted publication only beyond the initialization window", () => {
    fs.writeFileSync(filePath, '{"nonce"');
    time = fs.statSync(filePath).mtimeMs;
    const lock = open("recovery");
    expect(() => lock.acquire()).toThrow(Busy);
    time += 100;
    lock.release(lock.acquire());
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("clears a failed fence publication so another owner can proceed", () => {
    const lock = open("failed", { onAcquire: () => { throw new Error("fence write failed"); } });
    expect(() => lock.acquire()).toThrow("fence write failed");
    const next = open("next");
    next.release(next.acquire());
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
