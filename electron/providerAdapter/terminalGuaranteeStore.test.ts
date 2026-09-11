import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROVIDER_ADAPTER_STORE_LOCK_LEASE_MS,
  ProviderAdapterStore,
  isTerminalAdapterStage,
} from "./store";
import {
  TERMINAL_WRITE_BACKOFF_MS,
  TerminalWriteGuarantee,
  readTerminalWriteFailures,
  terminalErrorJournalPath,
  writeAdapterTerminalFailure,
} from "./terminalGuarantee";
import { buildTerminalFailureRun } from "./serviceRunLifecycle";
import type { ProviderAdapterRun } from "./types";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createStore(): { store: ProviderAdapterStore; filePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-terminal-store-"));
  dirs.push(dir);
  const filePath = path.join(dir, "provider-adapters.json");
  return { store: new ProviderAdapterStore(filePath), filePath };
}

function certifyingRun(): ProviderAdapterRun {
  return {
    id: "run-1",
    vendorKey: "example-com",
    vendorName: "Example",
    connectionFingerprint: "fingerprint",
    selectedModelKeys: ["gpt-text"],
    stage: "testing",
    repairAttempt: 0,
    models: [],
    sourceUrls: [],
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
  };
}

/**
 * 人为延长持锁：直接在盘上放一张**还没到期**的租约，模拟「另一个进程正持有锁」/
 * 「被 kill 的进程留下租约」。这正是 2026-09-11 那次死锁的现场——旧代码 3s 自旋
 * 结构上熬不过 30s 的租约，每次终态写都必然 `lock timed out`。
 */
function plantLease(filePath: string, expiresInMs: number): void {
  fs.writeFileSync(`${filePath}.lock`, `${JSON.stringify({
    schemaVersion: 1,
    ownerId: "someone-else",
    pid: process.pid + 1,
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    fencingEpoch: 1,
    nonce: "planted",
  })}\n`, "utf8");
}

describe("failure path against a real store lock", () => {
  it("锁被别人占着时终态写会抛 —— 这是要兜住的那一下", () => {
    const { store, filePath } = createStore();
    store.upsertRun(certifyingRun());
    plantLease(filePath, PROVIDER_ADAPTER_STORE_LOCK_LEASE_MS);
    expect(() => store.upsertRun({ ...certifyingRun(), stage: "failed" }))
      .toThrow(/lock timed out/);
    // 读不走锁：run 仍然停在非终态，正是那次死锁看到的样子。
    expect(isTerminalAdapterStage(store.getRun("run-1")!.stage)).toBe(false);
  });

  it("持锁期覆盖不到整个退避预算时，finishWithError 仍在预算内把 run 终态化", async () => {
    const { store, filePath } = createStore();
    store.upsertRun(certifyingRun());
    // 租约只挡住前两次退避；到第三次它已过期，reclaimExpired 接管。
    plantLease(filePath, 50);

    const journalPath = terminalErrorJournalPath(filePath);
    const guarantee = new TerminalWriteGuarantee({
      write: (runId, stage, message) => {
        writeAdapterTerminalFailure({
          store, id: runId, stage, message,
          catalogFail: () => {},
          buildRun: (input) => buildTerminalFailureRun(input as Parameters<typeof buildTerminalFailureRun>[0]),
          redact: (value) => value,
          now: () => new Date().toISOString(),
        });
      },
      read: (runId) => store.getRun(runId),
      journalPath,
      // 真实档位是 3s/6s/12s/24s（合计 45s > 30s 租约）；这里按同样的形状压缩成毫秒跑，
      // 测的是「预算能熬过一次持锁」这条性质，不是墙钟。
      backoffMs: [40, 60, 120, 31_000],
      setTimer: (callback, ms) => setTimeout(callback, Math.min(ms, 120)),
    });

    await guarantee.settle("run-1", "failed", "One model never answered");

    const settled = store.getRun("run-1")!;
    expect(settled.stage).toBe("failed");
    expect(settled.error).toContain("One model never answered");
    expect(readTerminalWriteFailures(journalPath)).toHaveLength(0);
  });

  it("整个预算都拿不到锁 → errors.jsonl 留证，锁释放后补偿扫描收尾", async () => {
    const { store, filePath } = createStore();
    store.upsertRun(certifyingRun());
    plantLease(filePath, 60_000); // 整段退避都被挡住

    const journalPath = terminalErrorJournalPath(filePath);
    const write = (runId: string, stage: ProviderAdapterRun["stage"], message: string) => {
      writeAdapterTerminalFailure({
        store, id: runId, stage, message,
        catalogFail: () => {},
        buildRun: (input) => buildTerminalFailureRun(input as Parameters<typeof buildTerminalFailureRun>[0]),
        redact: (value) => value,
        now: () => new Date().toISOString(),
      });
    };
    const guarantee = new TerminalWriteGuarantee({
      write, read: (runId) => store.getRun(runId), journalPath,
      backoffMs: TERMINAL_WRITE_BACKOFF_MS,
      setTimer: (callback) => setTimeout(callback, 1),
    });

    await guarantee.settle("run-1", "failed", "One model never answered");
    const journal = readTerminalWriteFailures(journalPath);
    expect(journal.map((entry) => entry.runId)).toEqual(["run-1"]);
    expect(journal[0]?.writeError).toContain("lock timed out");
    expect(store.getRun("run-1")!.stage).toBe("testing");

    // 「重启」：锁没了，补偿扫描必须把它收成终态并清账。
    fs.rmSync(`${filePath}.lock`, { force: true });
    expect(guarantee.compensate().repaired).toEqual(["run-1"]);
    expect(store.getRun("run-1")!.stage).toBe("failed");
    expect(readTerminalWriteFailures(journalPath)).toHaveLength(0);
  });
});
