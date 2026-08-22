import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  IntentLogIntegrityError,
  createProductionRunIntentLog,
} from "./productionRunIntentLog";

const tempDirs: string[] = [];

function makeLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-intent-log-"));
  tempDirs.push(dir);
  return {
    dir,
    log: createProductionRunIntentLog({
      filePath: path.join(dir, "intents.ndjson"),
      macKey: "test-app-owned-key",
      keyId: "test-key-v1",
      now: (() => {
        let tick = 0;
        return () => `2026-08-23T00:00:0${tick++}.000Z`;
      })(),
      randomId: (() => {
        let index = 0;
        return () => `intent-${++index}`;
      })(),
    }),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("ProductionRunIntentLog", () => {
  it("durably prepares and commits one intent, then replays it after a new instance", () => {
    const { dir, log } = makeLog();
    const prepared = log.prepare({
      runId: "run-1",
      kind: "generation.submit.intent",
      key: "run-1:job-1:attempt-1",
      payload: { contractHash: "contract-1", providerIdempotencyKey: "provider-key-1" },
      fencingEpoch: 4,
    });

    expect(prepared.status).toBe("prepared");
    expect(fs.readFileSync(path.join(dir, "intents.ndjson"), "utf8")).toContain('"status":"prepared"');

    const committed = log.commit(prepared.intentId);
    expect(committed).toMatchObject({
      intentId: prepared.intentId,
      status: "committed",
      fencingEpoch: 4,
      payloadHash: prepared.payloadHash,
    });

    const restarted = createProductionRunIntentLog({
      filePath: path.join(dir, "intents.ndjson"),
      macKey: "test-app-owned-key",
      keyId: "test-key-v1",
    });
    expect(restarted.list()).toEqual([committed]);
    expect(restarted.pending()).toEqual([]);
  });

  it("reuses an identical prepared key and rejects a conflicting payload", () => {
    const { log } = makeLog();
    const first = log.prepare({ runId: "run-1", kind: "provider.submit", key: "key-1", payload: { a: 1 } });
    expect(log.prepare({ runId: "run-1", kind: "provider.submit", key: "key-1", payload: { a: 1 } })).toEqual(first);
    expect(() => log.prepare({ runId: "run-1", kind: "provider.submit", key: "key-1", payload: { a: 2 } })).toThrow(/intent key conflict/);
  });

  it("rejects malformed, tampered, truncated, and broken-chain records without repairing the file", () => {
    const { dir, log } = makeLog();
    const prepared = log.prepare({ runId: "run-1", kind: "provider.submit", key: "key-1", payload: { a: 1 } });
    const filePath = path.join(dir, "intents.ndjson");
    const original = fs.readFileSync(filePath, "utf8");
    fs.appendFileSync(filePath, '{"seq":2');
    expect(() => log.list()).toThrowError(/migration_parse_error/);
    expect(fs.readFileSync(filePath, "utf8")).not.toBe(original);

    fs.writeFileSync(filePath, original.replace(prepared.mac, `${prepared.mac.slice(0, -1)}x`));
    expect(() => log.list()).toThrow(IntentLogIntegrityError);
    expect(fs.readFileSync(filePath, "utf8")).toContain(`${prepared.mac.slice(0, -1)}x`);
  });

  it("does not allow a stale writer epoch to commit or a second commit to append", () => {
    const { log } = makeLog();
    const prepared = log.prepare({ runId: "run-1", kind: "provider.submit", key: "key-1", payload: { a: 1 }, fencingEpoch: 7 });
    expect(() => log.commit(prepared.intentId, { fencingEpoch: 6 })).toThrow(/fencing epoch/);
    const committed = log.commit(prepared.intentId, { fencingEpoch: 7 });
    expect(log.commit(prepared.intentId, { fencingEpoch: 7 })).toEqual(committed);
    expect(log.list()).toHaveLength(1);
  });

  it("returns pending prepared intents for crash recovery without making a write", () => {
    const { dir, log } = makeLog();
    log.prepare({ runId: "run-1", kind: "provider.submit", key: "key-1", payload: { a: 1 } });
    const filePath = path.join(dir, "intents.ndjson");
    const before = fs.readFileSync(filePath, "utf8");
    expect(log.pending()).toHaveLength(1);
    expect(fs.readFileSync(filePath, "utf8")).toBe(before);
  });
});
