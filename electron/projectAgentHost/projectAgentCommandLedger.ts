import crypto from "node:crypto";
import fs from "node:fs";

import { fsyncIfDurable } from "../durability";
import type { ProjectAgentCompactCommandReceipt, ProjectBinding } from "../shared/projectAgentContracts";
import { assertProjectAgentBinding, sameProjectAgentBinding, stableProjectAgentJson } from "./projectAgentState";
const RECORD_KEYS = "appliedRevision|binding|checksum|commandId|mutationHash";
const EMPTY_HEAD = crypto.createHash("sha256").update("nomi-project-agent-command-ledger:v1\0empty").digest("hex");

// scan() 是账本唯一的 O(账本长度) 全量重扫路径；稳态必须命中 validate() 的缓存、一次都不走它。
// 这个计数器是**该语义的直接观测点**，和 projectAgentState.ts 的
// `__projectAgentFullValidationCountForTests` 同一套写法。
//
// 为什么需要它：此前 projectAgentHost.test.ts 用「fs.readFileSync 有没有以账本路径被调用过」
// 当探针，而重扫走 readRegular() → fs.readFileSync(fd)，第一个参数是 fd 数字不是路径，
// 那个过滤器**永远匹配不到**——实测强制一次冷缓存全量重扫 25KB 账本，它仍然数出 0 条。
// 招牌断言测不出它命名的那件事。计数器不经过 fs 间接层，因此不会再这样悄悄失效；
// projectAgentHost.test.ts 里另有一条阳性对照用例钉住「它真的会涨」。
let fullScanCount = 0;

export function __projectAgentCommandLedgerScanCountForTests(): number {
  return fullScanCount;
}

export type ProjectAgentCommandLedgerPointer = Readonly<{
  highWater: number;
  byteOffset: number;
  headChecksum: string;
}>;

export type ProjectAgentCommandLedgerView = Readonly<{
  pointer: ProjectAgentCommandLedgerPointer;
}>;

export type ProjectAgentPreparedCommand = Readonly<{
  pointer: ProjectAgentCommandLedgerPointer;
}>;

type Record = Readonly<
  ProjectAgentCompactCommandReceipt & {
    binding: ProjectBinding;
    checksum: string;
  }
>;

type Stamp = Readonly<{
  exists: boolean;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
  nlink: number;
}>;

type Index = {
  binding: ProjectBinding;
  pointer: ProjectAgentCommandLedgerPointer;
  byCommand: Map<string, Record>;
  observed: Stamp;
};

type PreparedInternal = Readonly<{
  ledgerPath: string;
  previousView: ProjectAgentCommandLedgerView;
  record: Record;
  observed: Stamp;
}>;

export type ProjectAgentCommandLedgerDeps = Readonly<{
  fsyncDirectory: (directoryPath: string) => void;
  integrityError: (message: string) => Error;
}>;

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(stableProjectAgentJson(value)).digest("hex");
}

function recordChecksum(record: Omit<Record, "checksum">, previousHead: string): string {
  return digest({
    domain: "nomi-project-agent-command-ledger:v1",
    previousHeadChecksum: previousHead,
    record,
  });
}

function noFollowFlag(): number {
  return typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
}

function sameStamp(left: Stamp, right: Stamp): boolean {
  return (
    left.exists === right.exists &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink
  );
}

function sameFileIdentity(stat: fs.Stats, stamp: Stamp): boolean {
  return (
    stamp.exists && stat.isFile() && stat.dev === stamp.dev && stat.ino === stamp.ino && stat.nlink === stamp.nlink
  );
}

function assertOpenFileIdentity(
  fd: number,
  expected: Stamp,
  message: string,
  makeError: (message: string) => Error = (value) => new Error(value),
): fs.Stats {
  const opened = fs.fstatSync(fd);
  if (!sameFileIdentity(opened, expected) || opened.nlink !== 1) {
    throw makeError(message);
  }
  return opened;
}

function samePointer(left: ProjectAgentCommandLedgerPointer, right: ProjectAgentCommandLedgerPointer): boolean {
  return (
    left.highWater === right.highWater &&
    left.byteOffset === right.byteOffset &&
    left.headChecksum === right.headChecksum
  );
}

function writeAll(fd: number, bytes: Buffer): void {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = fs.writeSync(fd, bytes, offset, bytes.byteLength - offset);
    if (written <= 0) throw new Error("Project Agent command ledger append made no progress");
    offset += written;
  }
}

export function emptyProjectAgentCommandLedgerPointer(): ProjectAgentCommandLedgerPointer {
  return Object.freeze({ highWater: 0, byteOffset: 0, headChecksum: EMPTY_HEAD });
}

export function createProjectAgentCommandLedger(deps: ProjectAgentCommandLedgerDeps) {
  const cache = new Map<string, ProjectAgentCommandLedgerView>();
  const indexes = new WeakMap<ProjectAgentCommandLedgerView, Index>();
  const prepared = new WeakMap<ProjectAgentPreparedCommand, PreparedInternal>();

  function stamp(filePath: string): Stamp {
    try {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw deps.integrityError(`Project Agent command ledger is not a regular file: ${filePath}`);
      }
      if (stat.nlink !== 1) {
        throw deps.integrityError(`Project Agent command ledger has unexpected hard links: ${filePath}`);
      }
      return Object.freeze({
        exists: true,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
        dev: stat.dev,
        ino: stat.ino,
        nlink: stat.nlink,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return Object.freeze({ exists: false, size: 0, mtimeMs: 0, ctimeMs: 0, dev: 0, ino: 0, nlink: 0 });
      }
      throw error;
    }
  }

  function makeView(index: Index): ProjectAgentCommandLedgerView {
    const view = Object.freeze({ pointer: index.pointer });
    indexes.set(view, index);
    return view;
  }

  function currentIndex(ledgerPath: string, view: ProjectAgentCommandLedgerView): Index {
    const index = indexes.get(view);
    if (!index || cache.get(ledgerPath) !== view || !samePointer(view.pointer, index.pointer)) {
      throw deps.integrityError("Project Agent command ledger view is stale");
    }
    return index;
  }

  function readRegular(filePath: string): Buffer {
    const expected = stamp(filePath);
    const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollowFlag());
    try {
      assertOpenFileIdentity(
        fd,
        expected,
        `Project Agent command ledger changed during read: ${filePath}`,
        deps.integrityError,
      );
      return fs.readFileSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  function scan(
    ledgerPath: string,
    binding: ProjectBinding,
    pointer: ProjectAgentCommandLedgerPointer,
  ): ProjectAgentCommandLedgerView {
    fullScanCount += 1;
    const initial = stamp(ledgerPath);
    if (!initial.exists && pointer.highWater > 0) {
      throw deps.integrityError("Project Agent command ledger is missing");
    }
    const bytes = initial.exists ? readRegular(ledgerPath) : Buffer.alloc(0);
    const byCommand = new Map<string, Record>();
    let offset = 0;
    let previousHead = EMPTY_HEAD;
    for (let revision = 1; revision <= pointer.highWater; revision += 1) {
      const newline = bytes.indexOf(0x0a, offset);
      if (newline < 0) throw deps.integrityError("Project Agent command ledger is truncated");
      const lineBytes = bytes.subarray(offset, newline);
      const line = lineBytes.toString("utf8");
      if (!Buffer.from(line, "utf8").equals(lineBytes)) {
        throw deps.integrityError("Project Agent command ledger is not UTF-8");
      }
      let raw: Record;
      try {
        raw = JSON.parse(line) as Record;
      } catch {
        throw deps.integrityError("Project Agent command ledger contains invalid JSON");
      }
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        Object.keys(raw).sort().join("|") !== RECORD_KEYS ||
        typeof raw.commandId !== "string" ||
        !raw.commandId.trim() ||
        raw.commandId !== raw.commandId.trim() ||
        typeof raw.mutationHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(raw.mutationHash) ||
        raw.appliedRevision !== revision ||
        typeof raw.checksum !== "string" ||
        !/^[a-f0-9]{64}$/.test(raw.checksum)
      ) {
        throw deps.integrityError("Project Agent command ledger record is invalid");
      }
      try {
        assertProjectAgentBinding(raw.binding);
      } catch {
        throw deps.integrityError("Project Agent command ledger binding is invalid");
      }
      if (!sameProjectAgentBinding(raw.binding, binding) || byCommand.has(raw.commandId)) {
        throw deps.integrityError("Project Agent command ledger identity is invalid");
      }
      const base = Object.freeze({
        commandId: raw.commandId,
        mutationHash: raw.mutationHash,
        appliedRevision: raw.appliedRevision,
        binding: Object.freeze({ ...raw.binding }),
      });
      if (raw.checksum !== recordChecksum(base, previousHead)) {
        throw deps.integrityError("Project Agent command ledger checksum mismatch");
      }
      const record = Object.freeze({ ...base, checksum: raw.checksum });
      byCommand.set(record.commandId, record);
      offset = newline + 1;
      previousHead = record.checksum;
    }
    if (offset !== pointer.byteOffset || previousHead !== pointer.headChecksum) {
      throw deps.integrityError("Project Agent command ledger pointer mismatch");
    }
    const observed = stamp(ledgerPath);
    if (!sameStamp(observed, { ...initial, size: bytes.byteLength })) {
      throw deps.integrityError("Project Agent command ledger changed during read");
    }
    const index: Index = { binding, pointer, byCommand, observed };
    const view = makeView(index);
    cache.set(ledgerPath, view);
    return view;
  }

  function validate(
    ledgerPath: string,
    binding: ProjectBinding,
    pointer: ProjectAgentCommandLedgerPointer,
  ): ProjectAgentCommandLedgerView {
    const cached = cache.get(ledgerPath);
    const index = cached && indexes.get(cached);
    const observed = stamp(ledgerPath);
    if (
      cached &&
      index &&
      sameProjectAgentBinding(index.binding, binding) &&
      samePointer(index.pointer, pointer) &&
      sameStamp(index.observed, observed) &&
      observed.size >= pointer.byteOffset
    ) {
      return cached;
    }
    return scan(ledgerPath, binding, pointer);
  }

  function reconcilePreparedTail(
    ledgerPath: string,
    binding: ProjectBinding,
    view: ProjectAgentCommandLedgerView,
  ): void {
    const index = currentIndex(ledgerPath, view);
    if (!sameProjectAgentBinding(index.binding, binding)) {
      throw deps.integrityError("Project Agent command ledger binding mismatch");
    }
    const before = stamp(ledgerPath);
    if (!before.exists) {
      if (view.pointer.byteOffset !== 0) {
        throw deps.integrityError("Project Agent command ledger is missing");
      }
      index.observed = before;
      return;
    }
    if (before.size < view.pointer.byteOffset) {
      throw deps.integrityError("Project Agent command ledger is shorter than snapshot");
    }
    if (before.size === view.pointer.byteOffset) {
      index.observed = before;
      return;
    }
    let openedAfter: fs.Stats | undefined;
    const fd = fs.openSync(ledgerPath, fs.constants.O_RDWR | noFollowFlag());
    try {
      assertOpenFileIdentity(
        fd,
        before,
        `Project Agent command ledger changed during truncate: ${ledgerPath}`,
        deps.integrityError,
      );
      fs.ftruncateSync(fd, view.pointer.byteOffset);
      fsyncIfDurable(fd);
      openedAfter = fs.fstatSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const observed = stamp(ledgerPath);
    if (
      observed.size !== view.pointer.byteOffset ||
      !openedAfter ||
      !sameFileIdentity(openedAfter, observed) ||
      openedAfter.nlink !== 1
    ) {
      throw deps.integrityError("Project Agent command ledger truncate failed");
    }
    index.observed = observed;
  }

  function prepareAppend(
    input: Readonly<{
      ledgerPath: string;
      directoryPath: string;
      binding: ProjectBinding;
      view: ProjectAgentCommandLedgerView;
      receipt: ProjectAgentCompactCommandReceipt;
    }>,
  ): ProjectAgentPreparedCommand {
    const index = currentIndex(input.ledgerPath, input.view);
    try {
      assertProjectAgentBinding(input.binding);
    } catch {
      throw deps.integrityError("Project Agent command ledger binding is invalid");
    }
    if (
      !sameProjectAgentBinding(index.binding, input.binding) ||
      typeof input.receipt.commandId !== "string" ||
      !input.receipt.commandId.trim() ||
      input.receipt.commandId !== input.receipt.commandId.trim() ||
      typeof input.receipt.mutationHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.receipt.mutationHash) ||
      input.receipt.appliedRevision !== index.pointer.highWater + 1 ||
      index.byCommand.has(input.receipt.commandId)
    ) {
      throw deps.integrityError("Project Agent command ledger append is invalid");
    }
    const base = Object.freeze({
      commandId: input.receipt.commandId,
      mutationHash: input.receipt.mutationHash,
      appliedRevision: input.receipt.appliedRevision,
      binding: Object.freeze({ ...input.binding }),
    });
    const record = Object.freeze({
      ...base,
      checksum: recordChecksum(base, index.pointer.headChecksum),
    });
    const bytes = Buffer.from(`${stableProjectAgentJson(record)}\n`, "utf8");
    const before = stamp(input.ledgerPath);
    if (before.size !== index.pointer.byteOffset) {
      throw deps.integrityError("Project Agent command ledger tail was not retired");
    }
    const fd = fs.openSync(
      input.ledgerPath,
      fs.constants.O_APPEND |
        fs.constants.O_CREAT |
        fs.constants.O_WRONLY |
        noFollowFlag() |
        (!before.exists && typeof fs.constants.O_EXCL === "number" ? fs.constants.O_EXCL : 0),
      0o600,
    );
    try {
      if (before.exists) {
        assertOpenFileIdentity(
          fd,
          before,
          `Project Agent command ledger changed during append: ${input.ledgerPath}`,
          deps.integrityError,
        );
      } else {
        const opened = fs.fstatSync(fd);
        if (!opened.isFile() || opened.nlink !== 1) {
          throw deps.integrityError(`Project Agent command ledger changed during append: ${input.ledgerPath}`);
        }
      }
      if (process.platform !== "win32") fs.fchmodSync(fd, 0o600);
      writeAll(fd, bytes);
      fsyncIfDurable(fd);
      const opened = fs.fstatSync(fd);
      const observed = stamp(input.ledgerPath);
      if (!sameFileIdentity(opened, observed) || opened.nlink !== 1) {
        throw deps.integrityError(`Project Agent command ledger changed during append: ${input.ledgerPath}`);
      }
    } finally {
      fs.closeSync(fd);
    }
    if (!before.exists) deps.fsyncDirectory(input.directoryPath);
    const observed = stamp(input.ledgerPath);
    const pointer = Object.freeze({
      highWater: record.appliedRevision,
      byteOffset: index.pointer.byteOffset + bytes.byteLength,
      headChecksum: record.checksum,
    });
    if (observed.size !== pointer.byteOffset) {
      throw deps.integrityError("Project Agent command ledger append length mismatch");
    }
    const result = Object.freeze({ pointer });
    prepared.set(result, {
      ledgerPath: input.ledgerPath,
      previousView: input.view,
      record,
      observed,
    });
    return result;
  }

  function markCommitted(value: ProjectAgentPreparedCommand): ProjectAgentCommandLedgerView {
    const pending = prepared.get(value);
    if (!pending || cache.get(pending.ledgerPath) !== pending.previousView) {
      throw deps.integrityError("Project Agent prepared command is stale");
    }
    if (!sameStamp(stamp(pending.ledgerPath), pending.observed)) {
      throw deps.integrityError("Project Agent command ledger changed after append");
    }
    const index = indexes.get(pending.previousView);
    if (
      !index ||
      !samePointer(value.pointer, {
        highWater: index.pointer.highWater + 1,
        byteOffset: index.pointer.byteOffset + Buffer.byteLength(`${stableProjectAgentJson(pending.record)}\n`, "utf8"),
        headChecksum: pending.record.checksum,
      })
    ) {
      throw deps.integrityError("Project Agent prepared command pointer is invalid");
    }
    index.byCommand.set(pending.record.commandId, pending.record);
    const nextIndex: Index = {
      ...index,
      pointer: value.pointer,
      observed: pending.observed,
    };
    const next = makeView(nextIndex);
    cache.set(pending.ledgerPath, next);
    prepared.delete(value);
    return next;
  }

  function lookup(
    ledgerPath: string,
    view: ProjectAgentCommandLedgerView,
    commandId: string,
  ): ProjectAgentCompactCommandReceipt | null {
    const record = currentIndex(ledgerPath, view).byCommand.get(commandId);
    if (!record) return null;
    return Object.freeze({
      commandId: record.commandId,
      mutationHash: record.mutationHash,
      appliedRevision: record.appliedRevision,
    });
  }

  return Object.freeze({ validate, reconcilePreparedTail, prepareAppend, markCommitted, lookup });
}
