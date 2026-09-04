import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { writeJsonFileAtomic } from "../jsonFile";
import { fsyncIfDurable } from "../durability";
import type { ProjectBinding } from "../shared/projectBinding";
import {
  parseProjectAgentCommittedProposal,
  type ProjectAgentCommittedProposalRecord,
  type ProjectAgentProposalReceiptClear,
  type ProjectAgentProposalReceiptLifecycle,
  type ProjectAgentProposalReceiptTransition,
  type ProjectAgentProposalReceiptView,
  type ProjectAgentProposalReceiptWrite,
  PROJECT_AGENT_PROPOSAL_RECEIPT_LIFECYCLES,
} from "../shared/projectAgentProposalReceipt";
import { assertProjectAgentBinding, sameProjectAgentBinding } from "./projectAgentIdentity";

type ReceiptOperation = Readonly<{
  operationId: string;
  requestHash: string;
  appliedRevision: number;
}>;

export type ProjectAgentProposalReceipt = Readonly<{
  schemaVersion: 2;
  binding: ProjectBinding;
  revision: number;
  lifecycle: ProjectAgentProposalReceiptLifecycle;
  proposalId: string;
  operationId: string;
  proposal: ProjectAgentCommittedProposalRecord;
  proposalHash: string;
  operations: readonly ReceiptOperation[];
  result?: unknown;
  updatedAt: string;
  journalHash: string;
}>;

export type ProjectAgentProposalReceiptService = Readonly<{
  binding: ProjectBinding;
  read(): ProjectAgentProposalReceiptView | null;
  write(input: ProjectAgentProposalReceiptWrite): ProjectAgentProposalReceiptView;
  transition(input: ProjectAgentProposalReceiptTransition): ProjectAgentProposalReceiptView;
  reconcileInDoubt?(): ProjectAgentProposalReceiptView | null;
  clear(input: ProjectAgentProposalReceiptClear): Readonly<{
    cleared: true;
    receipt: ProjectAgentProposalReceiptView;
  }>;
}>;

export class ProjectAgentProposalReceiptError extends Error {
  constructor(
    message: string,
    readonly code: "project_agent_receipt_invalid" | "revision_conflict" = "project_agent_receipt_invalid",
  ) {
    super(message);
    this.name = "ProjectAgentProposalReceiptError";
  }
}

const MAX_OPERATIONS = 64;

function receiptPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".nomi", "project-agent-proposal-receipt.json");
}

function fsyncReceiptDirectory(projectRoot: string): void {
  if (process.platform === "win32") return;
  const directory = path.dirname(receiptPath(projectRoot));
  let fd: number | undefined;
  try {
    fd = fs.openSync(directory, fs.constants.O_RDONLY);
    fsyncIfDurable(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function digest(domain: string, value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(`${domain}\0${stableJson(value)}`)
    .digest("hex");
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && value === value.trim();
}

function sameHostCorrelation(
  left: ProjectAgentCommittedProposalRecord,
  right: ProjectAgentCommittedProposalRecord,
): boolean {
  return left.hostApprovalId === right.hostApprovalId && left.hostActionHash === right.hostActionHash;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function hashProjectAgentCommittedProposal(value: unknown): string {
  const proposal = parseProjectAgentCommittedProposal(value);
  if (!proposal) throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt is invalid");
  return digest("nomi-project-agent-proposal:v2", proposal);
}

function hashJournal(value: Omit<ProjectAgentProposalReceipt, "journalHash">): string {
  return digest("nomi-project-agent-proposal-journal:v2", value);
}

function operationHash(kind: "write" | "transition" | "clear", value: unknown): string {
  return digest(`nomi-project-agent-proposal-operation:${kind}:v2`, value);
}

function toView(receipt: ProjectAgentProposalReceipt): ProjectAgentProposalReceiptView {
  return Object.freeze({
    binding: receipt.binding,
    revision: receipt.revision,
    lifecycle: receipt.lifecycle,
    proposalId: receipt.proposalId,
    operationId: receipt.operationId,
    proposal: receipt.proposal,
    ...(receipt.result === undefined ? {} : { result: receipt.result }),
  });
}

function cloneReceiptResult(value: unknown): unknown | undefined {
  if (value === undefined) return undefined;
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > 8 * 1024 * 1024) return undefined;
    return Object.freeze(JSON.parse(encoded) as unknown);
  } catch {
    return undefined;
  }
}

function parseOperation(value: unknown): ReceiptOperation | null {
  const raw = asRecord(value);
  if (
    !raw ||
    !exactKeys(raw, ["operationId", "requestHash", "appliedRevision"]) ||
    !validId(raw.operationId) ||
    !validHash(raw.requestHash) ||
    !Number.isSafeInteger(raw.appliedRevision) ||
    (raw.appliedRevision as number) < 1
  ) {
    return null;
  }
  return Object.freeze({
    operationId: raw.operationId,
    requestHash: raw.requestHash,
    appliedRevision: raw.appliedRevision as number,
  });
}

function parseReceipt(value: unknown): ProjectAgentProposalReceipt | null {
  const raw = asRecord(value);
  if (
    !raw ||
    !(
      exactKeys(raw, [
      "schemaVersion",
      "binding",
      "revision",
      "lifecycle",
      "proposalId",
      "operationId",
      "proposal",
      "proposalHash",
      "operations",
      "result",
      "updatedAt",
      "journalHash",
      ]) || exactKeys(raw, [
        "schemaVersion",
        "binding",
        "revision",
        "lifecycle",
        "proposalId",
        "operationId",
        "proposal",
        "proposalHash",
        "operations",
        "updatedAt",
        "journalHash",
      ])
    ) ||
    raw.schemaVersion !== 2 ||
    !Number.isSafeInteger(raw.revision) ||
    (raw.revision as number) < 1 ||
    !(PROJECT_AGENT_PROPOSAL_RECEIPT_LIFECYCLES as readonly string[]).includes(String(raw.lifecycle)) ||
    !validId(raw.proposalId) ||
    !validId(raw.operationId) ||
    !validHash(raw.proposalHash) ||
    !validHash(raw.journalHash) ||
    typeof raw.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(raw.updatedAt)) ||
    !Array.isArray(raw.operations) ||
    raw.operations.length < 1 ||
    raw.operations.length > MAX_OPERATIONS
  ) {
    return null;
  }
  try {
    assertProjectAgentBinding(raw.binding as ProjectBinding);
  } catch {
    return null;
  }
  const proposal = parseProjectAgentCommittedProposal(raw.proposal);
  if (!proposal || proposal.proposalId !== raw.proposalId) return null;
  let proposalHash: string;
  try {
    proposalHash = hashProjectAgentCommittedProposal(proposal);
  } catch {
    return null;
  }
  if (proposalHash !== raw.proposalHash) return null;
  const operations = raw.operations.map(parseOperation);
  if (operations.some((operation) => operation === null)) return null;
  const parsedOperations = operations as ReceiptOperation[];
  if (
    new Set(parsedOperations.map((operation) => operation.operationId)).size !== parsedOperations.length ||
    parsedOperations.some((operation) => operation.appliedRevision > (raw.revision as number)) ||
    parsedOperations.at(-1)?.operationId !== raw.operationId
  ) {
    return null;
  }
  const parsedResult = raw.result === undefined ? undefined : cloneReceiptResult(raw.result);
  if (raw.result !== undefined && parsedResult === undefined) return null;
  const core: Omit<ProjectAgentProposalReceipt, "journalHash"> = {
    schemaVersion: 2,
    binding: Object.freeze({ ...(raw.binding as ProjectBinding) }),
    revision: raw.revision as number,
    lifecycle: raw.lifecycle as ProjectAgentProposalReceiptLifecycle,
    proposalId: raw.proposalId,
    operationId: raw.operationId,
    proposal,
    proposalHash,
    operations: Object.freeze(parsedOperations),
    ...(raw.result === undefined ? {} : { result: parsedResult }),
    updatedAt: raw.updatedAt,
  };
  if (hashJournal(core) !== raw.journalHash) return null;
  return Object.freeze({ ...core, journalHash: raw.journalHash });
}

/** Main-owned durable journal. All semantic mutation goes through the bound service below. */
export function createProjectAgentProposalReceiptStore(projectRoot: string) {
  const target = receiptPath(projectRoot);
  return Object.freeze({
    exists(): boolean {
      return fs.existsSync(target);
    },
    read(): ProjectAgentProposalReceipt | null {
      try {
        return parseReceipt(JSON.parse(fs.readFileSync(target, "utf8")) as unknown);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        return null;
      }
    },
    write(receipt: Omit<ProjectAgentProposalReceipt, "journalHash">): ProjectAgentProposalReceipt {
      const journal = Object.freeze({ ...receipt, journalHash: hashJournal(receipt) });
      writeJsonFileAtomic(target, journal, { mode: 0o600 });
      fsyncReceiptDirectory(projectRoot);
      return journal;
    },
  });
}

function makeReceipt(
  input: Readonly<{
    previous: ProjectAgentProposalReceipt | null;
    binding: ProjectBinding;
    lifecycle: ProjectAgentProposalReceiptLifecycle;
    proposalId: string;
    operationId: string;
    proposal: ProjectAgentCommittedProposalRecord;
    requestHash: string;
    result?: unknown;
    updatedAt?: string;
  }>,
): Omit<ProjectAgentProposalReceipt, "journalHash"> {
  const revision = (input.previous?.revision ?? 0) + 1;
  const operations = [
    ...(input.previous?.operations ?? []),
    Object.freeze({ operationId: input.operationId, requestHash: input.requestHash, appliedRevision: revision }),
  ].slice(-MAX_OPERATIONS);
  return Object.freeze({
    schemaVersion: 2,
    binding: input.binding,
    revision,
    lifecycle: input.lifecycle,
    proposalId: input.proposalId,
    operationId: input.operationId,
    proposal: input.proposal,
    proposalHash: hashProjectAgentCommittedProposal(input.proposal),
    operations: Object.freeze(operations),
    ...(input.result === undefined ? {} : { result: input.result }),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  });
}

/** Trusted live service: root, binding, hashes, and lifecycle transitions never cross ownership boundaries. */
export function createProjectAgentProposalReceiptService(
  input: Readonly<{
    projectRoot: string;
    binding: ProjectBinding;
  }>,
): ProjectAgentProposalReceiptService {
  assertProjectAgentBinding(input.binding);
  const trustedBinding = Object.freeze({ ...input.binding });
  const store = createProjectAgentProposalReceiptStore(input.projectRoot);

  const current = (): ProjectAgentProposalReceipt | null => {
    const receipt = store.read();
    if (!receipt) {
      if (store.exists()) throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt is invalid");
      return null;
    }
    if (!sameProjectAgentBinding(receipt.binding, trustedBinding)) {
      throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt binding mismatch");
    }
    return receipt;
  };
  const replay = (
    receipt: ProjectAgentProposalReceipt | null,
    operationId: string,
    requestHash: string,
  ): ProjectAgentProposalReceiptView | null => {
    const applied = receipt?.operations.find((operation) => operation.operationId === operationId);
    if (!applied) return null;
    if (applied.requestHash !== requestHash) {
      throw new ProjectAgentProposalReceiptError(
        "Project Agent proposal receipt operation conflicts with its first request",
      );
    }
    if (applied.appliedRevision !== receipt!.revision || receipt!.operationId !== operationId) {
      throw new ProjectAgentProposalReceiptError("revision_conflict", "revision_conflict");
    }
    return toView(receipt!);
  };
  const assertCas = (receipt: ProjectAgentProposalReceipt | null, expectedRevision: number): void => {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt expected revision is invalid");
    }
    if ((receipt?.revision ?? 0) !== expectedRevision) {
      throw new ProjectAgentProposalReceiptError("revision_conflict", "revision_conflict");
    }
  };

  return Object.freeze({
    binding: trustedBinding,
    read() {
      const receipt = current();
      return receipt ? toView(receipt) : null;
    },
    write(value) {
      if (!validId(value.proposalId) || !validId(value.operationId)) {
        throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt operation is invalid");
      }
      const proposal = parseProjectAgentCommittedProposal(value.proposal);
      if (!proposal || proposal.proposalId !== value.proposalId) {
        throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt is invalid");
      }
      if (value.lifecycle !== "preparing" && value.lifecycle !== "committed") {
        throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt lifecycle is invalid");
      }
      const requestHash = operationHash("write", { ...value, proposal });
      const receipt = current();
      const repeated = replay(receipt, value.operationId, requestHash);
      if (repeated) return repeated;
      assertCas(receipt, value.expectedRevision);
      if (value.lifecycle === "preparing") {
        if (receipt && !["committed", "undone"].includes(receipt.lifecycle)) {
          throw new ProjectAgentProposalReceiptError(
            "Project Agent proposal receipt already has an unfinished operation",
          );
        }
      } else {
        if (!receipt || receipt.lifecycle !== "preparing" || receipt.proposalId !== value.proposalId) {
          throw new ProjectAgentProposalReceiptError(
            "Project Agent proposal receipt cannot commit without its preparation",
          );
        }
        if (!sameHostCorrelation(receipt.proposal, proposal)) {
          throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt Host correlation is immutable");
        }
      }
      return toView(
        store.write(
          makeReceipt({
            previous: receipt,
            binding: trustedBinding,
            lifecycle: value.lifecycle,
            proposalId: value.proposalId,
            operationId: value.operationId,
            proposal,
            requestHash,
            ...(value.result === undefined ? {} : { result: value.result }),
          }),
        ),
      );
    },
    transition(value) {
      if (!validId(value.proposalId) || !validId(value.operationId)) {
        throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt operation is invalid");
      }
      if (
        value.lifecycle !== "undoing" &&
        value.lifecycle !== "undone" &&
        value.lifecycle !== "effect_unknown" &&
        value.lifecycle !== "partial" &&
        value.lifecycle !== "commit_failed"
      ) {
        throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt lifecycle is invalid");
      }
      const requestHash = operationHash("transition", value);
      const receipt = current();
      const repeated = replay(receipt, value.operationId, requestHash);
      if (repeated) return repeated;
      assertCas(receipt, value.expectedRevision);
      if (!receipt || receipt.proposalId !== value.proposalId) {
        throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt proposal mismatch");
      }
      const validTransition = value.lifecycle === "effect_unknown" || value.lifecycle === "partial" || value.lifecycle === "commit_failed"
        ? receipt.lifecycle === "preparing"
        : (value.lifecycle === "undoing" && receipt.lifecycle === "committed")
          || (value.lifecycle === "undone" && (receipt.lifecycle === "undoing" || receipt.lifecycle === "preparing"));
      if (!validTransition) {
        throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt lifecycle transition is invalid");
      }
      return toView(
        store.write(
          makeReceipt({
            previous: receipt,
            binding: trustedBinding,
            lifecycle: value.lifecycle,
            proposalId: receipt.proposalId,
            operationId: value.operationId,
            proposal: receipt.proposal,
            requestHash,
          }),
        ),
      );
    },
    reconcileInDoubt() {
      const receipt = current();
      if (!receipt || receipt.lifecycle !== "preparing") return receipt ? toView(receipt) : null;
      const operationId = `project-agent-reconcile:${receipt.proposalId}`;
      const requestHash = operationHash("transition", {
        expectedRevision: receipt.revision,
        proposalId: receipt.proposalId,
        operationId,
        lifecycle: "effect_unknown",
      });
      return toView(
        store.write(
          makeReceipt({
            previous: receipt,
            binding: trustedBinding,
            lifecycle: "effect_unknown",
            proposalId: receipt.proposalId,
            operationId,
            proposal: receipt.proposal,
            requestHash,
          }),
        ),
      );
    },
    clear(value) {
      if (!validId(value.proposalId) || !validId(value.operationId)) {
        throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt operation is invalid");
      }
      const requestHash = operationHash("clear", value);
      const receipt = current();
      const repeated = replay(receipt, value.operationId, requestHash);
      if (repeated) return Object.freeze({ cleared: true as const, receipt: repeated });
      assertCas(receipt, value.expectedRevision);
      if (!receipt || receipt.proposalId !== value.proposalId || receipt.lifecycle !== "undone") {
        throw new ProjectAgentProposalReceiptError(
          "Project Agent proposal receipt cannot clear live recovery evidence",
        );
      }
      const cleared = toView(
        store.write(
          makeReceipt({
            previous: receipt,
            binding: trustedBinding,
            lifecycle: "undone",
            proposalId: receipt.proposalId,
            operationId: value.operationId,
            proposal: receipt.proposal,
            requestHash,
          }),
        ),
      );
      return Object.freeze({ cleared: true as const, receipt: cleared });
    },
  });
}

export function projectAgentProposalReceiptPath(projectRoot: string): string {
  return receiptPath(projectRoot);
}
