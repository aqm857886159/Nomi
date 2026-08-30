import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CertificationPersistenceError } from "./operationLedger";
import { PromotionJournal, type PromotionJournalWrite } from "./promotionJournal";

const roots: string[] = [];

function createJournal() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-promotion-journal-"));
  roots.push(root);
  const filePath = path.join(root, "promotion-journal.json");
  return { filePath, journal: new PromotionJournal(filePath) };
}

function preparedInput() {
  return {
    journalId: "promotion-run-1",
    runId: "run-1",
    lineageRootVendorKey: "api-example-com",
    leaseToken: "lease-1",
    expectedActiveRevision: "adapter-revision-old",
    proposedRevisionId: "adapter-revision-new",
    contractDigest: "a".repeat(64),
    verifiedModes: [{ modelKey: "paint-v2", taskKind: "text_to_image" as const }],
    childRunRef: { runId: "run-1", revisionDigest: "b".repeat(64) },
    now: "2026-08-28T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PromotionJournal", () => {
  it("replays prepared catalog promotion and run finalization exactly once", () => {
    const { journal, filePath } = createJournal();
    journal.prepare(preparedInput());
    const commitCatalog = vi.fn(() => ({ status: "committed" as const, committedModes: preparedInput().verifiedModes }));
    const finalizeRun = vi.fn();

    new PromotionJournal(filePath).replay({ commitCatalog, finalizeRun, now: () => "2026-08-28T00:00:01.000Z" });
    new PromotionJournal(filePath).replay({ commitCatalog, finalizeRun, now: () => "2026-08-28T00:00:02.000Z" });

    expect(commitCatalog).toHaveBeenCalledTimes(1);
    expect(finalizeRun).toHaveBeenCalledTimes(1);
    expect(new PromotionJournal(filePath).get("promotion-run-1")?.state).toBe("committed");
  });

  it("stops at every durable journal checkpoint and resumes from that checkpoint", () => {
    const { journal, filePath } = createJournal();
    journal.prepare(preparedInput());
    journal.markCatalogCommitted("promotion-run-1", {
      expectedRevision: 1,
      committedModes: preparedInput().verifiedModes,
      now: "2026-08-28T00:00:01.000Z",
    });
    expect(new PromotionJournal(filePath).get("promotion-run-1")?.state).toBe("catalog_committed");

    const commitCatalog = vi.fn();
    const finalizeRun = vi.fn();
    new PromotionJournal(filePath).replay({ commitCatalog, finalizeRun, now: () => "2026-08-28T00:00:02.000Z" });

    expect(commitCatalog).not.toHaveBeenCalled();
    expect(finalizeRun).toHaveBeenCalledTimes(1);
    expect(new PromotionJournal(filePath).get("promotion-run-1")?.state).toBe("committed");
  });

  it("fresh-process replay finalizes committed entries that crashed before runFinalizedAt", () => {
    const { journal, filePath } = createJournal();
    journal.prepare(preparedInput());
    const commitCatalog = vi.fn(() => ({ status: "committed" as const, committedModes: preparedInput().verifiedModes }));
    expect(() => journal.replay({
      commitCatalog,
      finalizeRun: () => { throw new Error("crash after committed checkpoint"); },
      now: () => "2026-08-28T00:00:01.000Z",
    })).toThrowError(/crash/);
    expect(new PromotionJournal(filePath).get("promotion-run-1")).toMatchObject({ state: "committed" });
    expect(new PromotionJournal(filePath).get("promotion-run-1")).not.toHaveProperty("runFinalizedAt");

    const finalizeRun = vi.fn();
    new PromotionJournal(filePath).replay({
      commitCatalog,
      finalizeRun,
      now: () => "2026-08-28T00:00:02.000Z",
    });
    new PromotionJournal(filePath).replay({
      commitCatalog,
      finalizeRun,
      now: () => "2026-08-28T00:00:03.000Z",
    });

    expect(commitCatalog).toHaveBeenCalledTimes(1);
    expect(finalizeRun).toHaveBeenCalledTimes(1);
    expect(new PromotionJournal(filePath).get("promotion-run-1")?.runFinalizedAt).toBeTruthy();
  });

  it("durably enters catalog-commit recovery before external promotion and survives post-catalog journal failure", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-promotion-post-catalog-fail-"));
    roots.push(root);
    const filePath = path.join(root, "journal.json");
    let writes = 0;
    const write: PromotionJournalWrite = (target, state) => {
      writes += 1;
      if (writes === 3) throw new Error("simulated post-catalog fsync failure");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(state));
    };
    const journal = new PromotionJournal(filePath, { write });
    journal.prepare(preparedInput());
    const commitCatalog = vi.fn(() => ({ status: "committed" as const, committedModes: preparedInput().verifiedModes }));

    expect(() => journal.replay({
      commitCatalog,
      finalizeRun: vi.fn(),
      now: () => "2026-08-28T00:00:01.000Z",
    })).toThrowError(/post-catalog/);
    expect(commitCatalog).toHaveBeenCalledTimes(1);
    expect(new PromotionJournal(filePath).get("promotion-run-1")?.state).toBe("catalog_committing");

    const finalizeRun = vi.fn();
    new PromotionJournal(filePath).replay({
      commitCatalog,
      finalizeRun,
      now: () => "2026-08-28T00:00:02.000Z",
    });
    expect(commitCatalog).toHaveBeenCalledTimes(2);
    expect(finalizeRun).toHaveBeenCalledTimes(1);
  });

  it("compacts finalized journal details while preserving a bounded permanent replay tombstone", () => {
    const { filePath } = createJournal();
    const journal = new PromotionJournal(filePath, { maxEntries: 3, maxInlineTombstones: 2 } as never);
    for (let index = 0; index < 8; index += 1) {
      const input = {
        ...preparedInput(),
        journalId: `promotion-run-${index}`,
        runId: `run-${index}`,
        proposedRevisionId: `adapter-revision-${index}`,
      };
      journal.prepare(input);
      journal.replay({
        commitCatalog: () => ({ status: "committed", committedModes: input.verifiedModes }),
        finalizeRun: () => {},
        now: () => "2026-08-28T00:00:01.000Z",
      });
    }
    expect(Buffer.byteLength(fs.readFileSync(filePath))).toBeLessThan(1_048_576);
    expect((new PromotionJournal(filePath) as unknown as { wasFinalized: (journalId: string) => boolean })
      .wasFinalized("promotion-run-0")).toBe(true);
    const state = JSON.parse(fs.readFileSync(filePath, "utf8")) as { archives: Array<{ fileName: string }> };
    const archivePath = path.join(`${filePath}.archive`, state.archives[0].fileName);
    const archive = JSON.parse(fs.readFileSync(archivePath, "utf8"));
    archive.version = 99;
    fs.writeFileSync(archivePath, JSON.stringify(archive));
    expect(() => new PromotionJournal(filePath).wasFinalized("promotion-run-0")).toThrowError(/version/i);
  });

  it("reopens after more than 1000 compactions with one bounded archive head and full replay history", () => {
    const { filePath } = createJournal();
    const fastWrite = (target: string, state: unknown) => {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(state));
    };
    const journal = new PromotionJournal(filePath, {
      maxEntries: 0,
      maxInlineTombstones: 0,
      write: fastWrite,
      writeArchive: fastWrite,
    } as never);
    for (let index = 0; index < 1_005; index += 1) {
      const input = {
        ...preparedInput(),
        journalId: `promotion-many-${index}`,
        runId: `run-many-${index}`,
        proposedRevisionId: `adapter-revision-many-${index}`,
      };
      journal.prepare(input);
      journal.replay({
        commitCatalog: () => ({ status: "committed", committedModes: input.verifiedModes }),
        finalizeRun: () => {},
        now: () => "2026-08-28T00:00:01.000Z",
      });
    }

    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8")) as { archives: unknown[] };
    expect(persisted.archives.length).toBeLessThanOrEqual(1);
    const reopened = new PromotionJournal(filePath);
    expect(reopened.wasFinalized("promotion-many-0")).toBe(true);
    expect(reopened.wasFinalized("promotion-many-1004")).toBe(true);
  }, 60_000);

  it("aborts on lease/CAS loss and preserves the previous active revision", () => {
    const { journal } = createJournal();
    journal.prepare(preparedInput());
    const finalizeRun = vi.fn();

    journal.replay({
      commitCatalog: () => ({ status: "no-lease" as const }),
      finalizeRun,
      now: () => "2026-08-28T00:00:01.000Z",
    });

    expect(finalizeRun).not.toHaveBeenCalled();
    expect(journal.get("promotion-run-1")).toMatchObject({
      state: "aborted",
      expectedActiveRevision: "adapter-revision-old",
      userAction: "review_newer_certification",
    });
  });

  it("fails closed instead of treating a corrupt or future journal as empty", () => {
    const { filePath } = createJournal();
    for (const payload of ["{", JSON.stringify({ version: 99, entries: [] })]) {
      fs.writeFileSync(filePath, payload, "utf8");
      expect(() => new PromotionJournal(filePath)).toThrowError(CertificationPersistenceError);
    }
  });

  it("rejects sensitive unknown fields and cleans only stale atomic temp files", () => {
    const { filePath } = createJournal();
    expect(() => new PromotionJournal(filePath).prepare({ ...preparedInput(), apiKey: "SENTINEL-SECRET" } as never))
      .toThrowError(/apiKey|field/i);
    expect(fs.existsSync(filePath)).toBe(false);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const stale = path.join(path.dirname(filePath), `.${path.basename(filePath)}.stale.tmp`);
    const active = path.join(path.dirname(filePath), `.${path.basename(filePath)}.active.tmp`);
    fs.writeFileSync(stale, "stale");
    fs.writeFileSync(active, "active");
    const old = new Date(Date.now() - 60 * 60_000);
    fs.utimesSync(stale, old, old);
    new PromotionJournal(filePath);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(active)).toBe(true);
  });

  it("keeps a prepared promotion invisible when its durable write fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-promotion-write-fail-"));
    roots.push(root);
    const write: PromotionJournalWrite = () => {
      throw new Error("simulated journal rename failure");
    };
    const journal = new PromotionJournal(path.join(root, "journal.json"), { write });

    expect(() => journal.prepare(preparedInput())).toThrowError(/rename/);
    expect(journal.get("promotion-run-1")).toBeUndefined();
  });
});
