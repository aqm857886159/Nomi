import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROVIDER_ADAPTER_STORE_LOCK_LEASE_MS } from "./store";
import {
  TERMINAL_WRITE_BACKOFF_MS,
  TerminalReaper,
  TerminalWriteGuarantee,
  assertTerminalWriteOutlastsLease,
  readTerminalWriteFailures,
  terminalWriteBudgetMs,
} from "./terminalGuarantee";
import type { ProviderAdapterRun } from "./types";

const roots: string[] = [];
function tempJournal(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-terminal-guarantee-"));
  roots.push(root);
  return path.join(root, "provider-adapters.json.errors.jsonl");
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function run(stage: ProviderAdapterRun["stage"], deadlineAt?: string): ProviderAdapterRun {
  return {
    id: "run-1",
    vendorKey: "acme",
    stage,
    selectedModelKeys: ["m1"],
    models: [],
    completedCount: 0,
    totalCount: 1,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
    connectionFingerprint: "fp",
    ...(deadlineAt ? { deadlineAt } : {}),
  } as unknown as ProviderAdapterRun;
}

/** 立即触发的假定时器：把退避链压缩成同步推进，测的是逻辑不是墙钟。 */
function instantTimers() {
  return { setTimer: (callback: () => void) => { callback(); return 0; }, clearTimer: () => {} };
}

describe("terminal write invariant", () => {
  it("退避总预算必须长过锁租约 TTL —— 这是那次死锁的直接原因", () => {
    expect(terminalWriteBudgetMs(TERMINAL_WRITE_BACKOFF_MS)).toBeGreaterThan(PROVIDER_ADAPTER_STORE_LOCK_LEASE_MS);
    expect(() => assertTerminalWriteOutlastsLease()).not.toThrow();
    // 旧行为（3s 自旋对 30s 租约）必须被这条不变量当场拦下。
    expect(() => assertTerminalWriteOutlastsLease([3_000])).toThrow(/must outlast the store lock lease/);
  });

  it("构造一个预算不够的 guarantee 直接炸，而不是等到线上才停在中间态", () => {
    expect(() => new TerminalWriteGuarantee({
      write: () => {}, read: () => undefined, journalPath: tempJournal(), backoffMs: [1_000],
    })).toThrow(/must outlast the store lock lease/);
  });
});

describe("TerminalWriteGuarantee", () => {
  it("锁一直占着也照样在预算内把 run 写成终态（退避到第 N 次成功）", async () => {
    const journalPath = tempJournal();
    let stage: ProviderAdapterRun["stage"] = "testing";
    let attempts = 0;
    const guarantee = new TerminalWriteGuarantee({
      write: () => {
        attempts += 1;
        // 前三次模拟「文件租约锁被陈旧租约占着」，第四次租约过期后成功。
        if (attempts < 4) throw new Error("Provider adapter store lock timed out");
        stage = "failed";
      },
      read: () => run(stage),
      journalPath,
      ...instantTimers(),
    });
    await guarantee.settle("run-1", "failed", "model hung");
    expect(stage).toBe("failed");
    expect(readTerminalWriteFailures(journalPath)).toHaveLength(0);
  });

  it("写盘一直抛错 → 落 errors.jsonl，且重启补偿能把它终态化", async () => {
    const journalPath = tempJournal();
    let stage: ProviderAdapterRun["stage"] = "testing";
    let diskBroken = true;
    const abandoned: string[] = [];
    const guarantee = new TerminalWriteGuarantee({
      write: () => {
        if (diskBroken) throw new Error("EROFS: read-only file system");
        stage = "failed";
      },
      read: () => run(stage),
      journalPath,
      onGiveUp: (entry) => abandoned.push(entry.runId),
      ...instantTimers(),
    });
    await guarantee.settle("run-1", "failed", "model hung");

    // 「响」而不是静默兜底：旁路里留了一条，并且 onGiveUp 被叫到了。
    const journal = readTerminalWriteFailures(journalPath);
    expect(journal.map((entry) => entry.runId)).toEqual(["run-1"]);
    expect(journal[0]?.stage).toBe("failed");
    expect(journal[0]?.writeError).toContain("EROFS");
    expect(abandoned).toEqual(["run-1"]);
    expect(stage).toBe("testing");

    // 重启后盘好了：补偿扫描把它终态化，并把旁路条目划掉。
    diskBroken = false;
    expect(guarantee.compensate()).toEqual({ repaired: ["run-1"], stillFailing: [] });
    expect(stage).toBe("failed");
    expect(readTerminalWriteFailures(journalPath)).toHaveLength(0);
  });

  it("别人（reaper / cancel）已经写成终态时，重试链认账收工，不重复写", async () => {
    const journalPath = tempJournal();
    let stage: ProviderAdapterRun["stage"] = "testing";
    let writes = 0;
    const guarantee = new TerminalWriteGuarantee({
      write: () => { writes += 1; throw new Error("Provider adapter store lock timed out"); },
      read: () => {
        if (writes >= 1) stage = "cancelled";
        return run(stage);
      },
      journalPath,
      ...instantTimers(),
    });
    await guarantee.settle("run-1", "failed", "model hung");
    expect(writes).toBe(1);
    expect(readTerminalWriteFailures(journalPath)).toHaveLength(0);
  });

  it("终态一落定就掐掉还在飞的那一步", async () => {
    const aborted: string[] = [];
    const guarantee = new TerminalWriteGuarantee({
      write: () => {}, read: () => run("failed"), journalPath: tempJournal(),
      abort: (runId) => aborted.push(runId), ...instantTimers(),
    });
    await guarantee.settle("run-1", "failed", "model hung");
    expect(aborted).toEqual(["run-1"]);
  });
});

describe("TerminalReaper", () => {
  it("deadline 过了还非终态的 run 被强制 timed_out", () => {
    const reaped: string[] = [];
    const reaper = new TerminalReaper({
      activeRuns: () => [
        run("testing", "2026-09-12T00:01:00.000Z"),
        { ...run("testing", "2026-09-12T09:00:00.000Z"), id: "run-2" },
      ],
      forceTimeout: (runId) => reaped.push(runId),
      now: () => "2026-09-12T00:05:00.000Z",
    });
    expect(reaper.sweep()).toEqual(["run-1"]);
    expect(reaped).toEqual(["run-1"]);
  });

  it("没有 deadline 的 run 不动它（没根据就不判死）", () => {
    const reaper = new TerminalReaper({
      activeRuns: () => [run("queued")],
      forceTimeout: () => { throw new Error("must not reap a run without a deadline"); },
      now: () => "2030-01-01T00:00:00.000Z",
    });
    expect(reaper.sweep()).toEqual([]);
  });
});
