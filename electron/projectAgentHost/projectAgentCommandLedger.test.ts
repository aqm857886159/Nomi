import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createProjectAgentCommandLedger, emptyProjectAgentCommandLedgerPointer } from "./projectAgentCommandLedger";
import { getDurabilityMode, setDurabilityMode } from "../durability";

const binding = {
  projectId: "ledger-project",
  immutableProjectUuid: "1c48e848-68d3-46d1-9608-a080eaca6a9f",
  projectGeneration: 1,
} as const;

let root = "";
let ledgerPath = "";
let previousDurability = getDurabilityMode();

beforeEach(() => {
  previousDurability = getDurabilityMode();
  setDurabilityMode("ephemeral");
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-ledger-"));
  ledgerPath = path.join(root, "commands-v1.jsonl");
});

afterEach(() => {
  setDurabilityMode(previousDurability);
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function ledger() {
  return createProjectAgentCommandLedger({
    fsyncDirectory: vi.fn(),
    integrityError: (message) => new Error(message),
  });
}

function receipt(revision: number, commandId = `command-${revision}`) {
  return {
    commandId,
    mutationHash: revision.toString(16).padStart(64, "0"),
    appliedRevision: revision,
  };
}

describe("ProjectAgentCommandLedger", () => {
  it("reuses the exact cached view and advances a 1,000-command index in O(1) per append", () => {
    const store = ledger();
    let view = store.validate(ledgerPath, binding, emptyProjectAgentCommandLedgerPointer());
    const readSpy = vi.spyOn(fs, "readFileSync");

    for (let revision = 1; revision <= 1_000; revision += 1) {
      store.reconcilePreparedTail(ledgerPath, binding, view);
      const prepared = store.prepareAppend({
        ledgerPath,
        directoryPath: root,
        binding,
        view,
        receipt: receipt(revision),
      });
      view = store.markCommitted(prepared);
      expect(store.validate(ledgerPath, binding, view.pointer)).toBe(view);
    }

    expect(readSpy).not.toHaveBeenCalled();
    expect(store.lookup(ledgerPath, view, "command-1")).toEqual(receipt(1));
    expect(store.lookup(ledgerPath, view, "command-1000")).toEqual(receipt(1_000));
  });

  it("ignores an uncommitted UTF-8 tail and replaces its revision at the exact byte offset", () => {
    const store = ledger();
    const empty = emptyProjectAgentCommandLedgerPointer();
    const initial = store.validate(ledgerPath, binding, empty);
    store.reconcilePreparedTail(ledgerPath, binding, initial);
    store.prepareAppend({
      ledgerPath,
      directoryPath: root,
      binding,
      view: initial,
      receipt: receipt(1, "未提交命令"),
    });

    const recovered = store.validate(ledgerPath, binding, empty);
    expect(store.lookup(ledgerPath, recovered, "未提交命令")).toBeNull();
    store.reconcilePreparedTail(ledgerPath, binding, recovered);
    const replacement = store.prepareAppend({
      ledgerPath,
      directoryPath: root,
      binding,
      view: recovered,
      receipt: receipt(1, "替换命令"),
    });
    const committed = store.markCommitted(replacement);
    const bytes = fs.readFileSync(ledgerPath);

    expect(committed.pointer.byteOffset).toBe(bytes.byteLength);
    expect(bytes.toString("utf8")).toContain("替换命令");
    expect(bytes.toString("utf8")).not.toContain("未提交命令");
    fs.appendFileSync(ledgerPath, Buffer.from([0xff, 0xfe]));
    const recoveredPartialTail = store.validate(ledgerPath, binding, committed.pointer);
    expect(store.lookup(ledgerPath, recoveredPartialTail, "替换命令")).toEqual(receipt(1, "替换命令"));
    store.reconcilePreparedTail(ledgerPath, binding, recoveredPartialTail);
    expect(fs.statSync(ledgerPath).size).toBe(committed.pointer.byteOffset);
    expect(
      createProjectAgentCommandLedger({
        fsyncDirectory: vi.fn(),
        integrityError: (message) => new Error(message),
      }).validate(ledgerPath, binding, committed.pointer),
    ).toMatchObject({ pointer: committed.pointer });
  });

  it("does not advance the committed cache when prepared file fsync fails", () => {
    setDurabilityMode("durable");
    const store = ledger();
    const empty = emptyProjectAgentCommandLedgerPointer();
    const initial = store.validate(ledgerPath, binding, empty);
    store.reconcilePreparedTail(ledgerPath, binding, initial);
    const realOpen = fs.openSync.bind(fs);
    const realFsync = fs.fsyncSync.bind(fs);
    const ledgerFds = new Set<number>();
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      const fd = realOpen(filePath, flags, mode);
      if (String(filePath) === ledgerPath) ledgerFds.add(fd);
      return fd;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (ledgerFds.has(fd)) {
        const error = new Error("simulated ledger fsync EIO") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return realFsync(fd);
    });

    expect(() =>
      store.prepareAppend({
        ledgerPath,
        directoryPath: root,
        binding,
        view: initial,
        receipt: receipt(1, "failed-fsync"),
      }),
    ).toThrow(/ledger fsync EIO/);

    vi.restoreAllMocks();
    setDurabilityMode("ephemeral");
    const recovered = store.validate(ledgerPath, binding, empty);
    expect(store.lookup(ledgerPath, recovered, "failed-fsync")).toBeNull();
    store.reconcilePreparedTail(ledgerPath, binding, recovered);
    const replacement = store.prepareAppend({
      ledgerPath,
      directoryPath: root,
      binding,
      view: recovered,
      receipt: receipt(1, "replacement"),
    });
    const committed = store.markCommitted(replacement);
    expect(store.lookup(ledgerPath, committed, "replacement")).toEqual(receipt(1, "replacement"));
  });

  it("creates a private regular file and rejects a symlink ledger", () => {
    const store = ledger();
    const initial = store.validate(ledgerPath, binding, emptyProjectAgentCommandLedgerPointer());
    store.reconcilePreparedTail(ledgerPath, binding, initial);
    store.prepareAppend({
      ledgerPath,
      directoryPath: root,
      binding,
      view: initial,
      receipt: receipt(1),
    });

    const stat = fs.lstatSync(ledgerPath);
    expect(stat.isFile()).toBe(true);
    if (process.platform !== "win32") expect(stat.mode & 0o777).toBe(0o600);

    const target = path.join(root, "target.jsonl");
    fs.writeFileSync(target, "", { mode: 0o600 });
    fs.rmSync(ledgerPath);
    fs.symlinkSync(target, ledgerPath);
    expect(() => store.validate(ledgerPath, binding, emptyProjectAgentCommandLedgerPointer())).toThrow(/regular file/);
  });

  it("rejects a hard-linked ledger instead of accepting a shared inode", () => {
    const store = ledger();
    let view = store.validate(ledgerPath, binding, emptyProjectAgentCommandLedgerPointer());
    store.reconcilePreparedTail(ledgerPath, binding, view);
    view = store.markCommitted(
      store.prepareAppend({
        ledgerPath,
        directoryPath: root,
        binding,
        view,
        receipt: receipt(1),
      }),
    );
    const hardLink = path.join(root, "commands-hard-link.jsonl");
    fs.linkSync(ledgerPath, hardLink);
    expect(() => store.validate(ledgerPath, binding, view.pointer)).toThrow(/hard links/);
  });

  it("fails closed if the ledger inode is replaced after append preflight", () => {
    const store = ledger();
    let view = store.validate(ledgerPath, binding, emptyProjectAgentCommandLedgerPointer());
    store.reconcilePreparedTail(ledgerPath, binding, view);
    view = store.markCommitted(
      store.prepareAppend({
        ledgerPath,
        directoryPath: root,
        binding,
        view,
        receipt: receipt(1),
      }),
    );

    const replacement = path.join(root, "replacement-ledger.jsonl");
    const realOpenSync = fs.openSync.bind(fs);
    let swapped = false;
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      if (
        !swapped &&
        String(filePath) === ledgerPath &&
        flags ===
          (fs.constants.O_APPEND |
            fs.constants.O_CREAT |
            fs.constants.O_WRONLY |
            (typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0))
      ) {
        swapped = true;
        fs.copyFileSync(ledgerPath, replacement);
        fs.rmSync(ledgerPath);
        fs.renameSync(replacement, ledgerPath);
      }
      return realOpenSync(filePath, flags, mode);
    });

    expect(() =>
      store.prepareAppend({
        ledgerPath,
        directoryPath: root,
        binding,
        view,
        receipt: receipt(2),
      }),
    ).toThrow(/changed during append/);
  });

  it("does not advance the committed view if the ledger changes after append", () => {
    const store = ledger();
    const initial = store.validate(ledgerPath, binding, emptyProjectAgentCommandLedgerPointer());
    store.reconcilePreparedTail(ledgerPath, binding, initial);
    const prepared = store.prepareAppend({
      ledgerPath,
      directoryPath: root,
      binding,
      view: initial,
      receipt: receipt(1, "post-append-change"),
    });

    fs.appendFileSync(ledgerPath, Buffer.from("uncommitted-change"));

    expect(() => store.markCommitted(prepared)).toThrow(/changed after append/);
    expect(store.lookup(ledgerPath, initial, "post-append-change")).toBeNull();
  });
});
