import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { writeJsonFileAtomic } from "../jsonFile";
import { fsyncDirectoryIfDurable } from "../durability";
import type { ProjectBinding } from "../shared/projectBinding";
import {
  parseProjectAgentCommittedProposal,
  type ProjectAgentCommittedProposalRecord,
  type ProjectAgentProposalReceiptClear,
  type ProjectAgentProposalReceiptLifecycle,
  type ProjectAgentProposalReceiptTransition,
  type ProjectAgentProposalReceiptView,
  type ProjectAgentProposalReceiptWrite,
} from "../shared/projectAgentProposalReceipt";
import { assertProjectAgentBinding, sameProjectAgentBinding } from "../shared/projectBinding";
import { PROJECT_AGENT_PREPARING_DEADLINE_MS } from "../shared/projectAgentPreparingDeadline";
export { PROJECT_AGENT_PREPARING_DEADLINE_MS } from "../shared/projectAgentPreparingDeadline";

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
  updatedAt: string;
  journalHash: string;
}>;

export type ProjectAgentProposalReceiptService = Readonly<{
  binding: ProjectBinding;
  read(): ProjectAgentProposalReceiptView | null;
  write(input: ProjectAgentProposalReceiptWrite): ProjectAgentProposalReceiptView;
  transition(input: ProjectAgentProposalReceiptTransition): ProjectAgentProposalReceiptView;
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

/**
 * 「准备中」最长能停多久——**这份回执的主人定的时限**。一次写入从登记准备到提交/放弃，最长不过写工具自己的预算
 * （`MODEL_TOOL_WRITE_TIMEOUT_MS_VALUE`），再留一格收尾余量；过了这一点还停在 `preparing`，就说明那次写入已经死了
 * （工具超时、回执没拿到、进程被打断），没有人会再去收它。没有这条时限时，这样一次死掉的写入会把之后**每一次**
 * 写入都挡在「已有未完成操作」后面，直到用户手工清文件（pb04 走查 `agent-write-receipt-stuck`）。
 */
function receiptPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".nomi", "project-agent-proposal-receipt.json");
}

function fsyncReceiptDirectory(projectRoot: string): void {
  fsyncDirectoryIfDurable(path.dirname(receiptPath(projectRoot)));
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

function operationHash(kind: "write" | "transition" | "clear" | "expire", value: unknown): string {
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
  });
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
    !exactKeys(raw, [
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
    ]) ||
    raw.schemaVersion !== 2 ||
    !Number.isSafeInteger(raw.revision) ||
    (raw.revision as number) < 1 ||
    !["preparing", "committed", "undoing", "undone"].includes(String(raw.lifecycle)) ||
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
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  });
}

/** Trusted live service: root, binding, hashes, and lifecycle transitions never cross ownership boundaries. */
export function createProjectAgentProposalReceiptService(
  input: Readonly<{
    projectRoot: string;
    binding: ProjectBinding;
    /** 时钟只给测试注入；生产用系统时间。 */
    now?: () => number;
  }>,
): ProjectAgentProposalReceiptService {
  assertProjectAgentBinding(input.binding);
  const now = input.now ?? Date.now;
  /** 回执上的时间戳与「过没过时限」读同一个时钟（测试注入的也是它）。 */
  const make = (value: Parameters<typeof makeReceipt>[0]) => makeReceipt({ ...value, updatedAt: value.updatedAt ?? new Date(now()).toISOString() });
  const trustedBinding = Object.freeze({ ...input.binding });
  const store = createProjectAgentProposalReceiptStore(input.projectRoot);

  /**
   * 停在 `preparing` 超过主人时限的回执，在**任何一扇门第一次碰到它时**落到终态（`undone`，与写入被确定拒绝时
   * `abandonDocumentProposalReceipt` 收的是同一个终态）。为什么在这里而不是调用方：四扇门（read / write /
   * transition / clear）都先过 `current()`，放在这里就没有哪条入口能绕过去读到一份永远停着的「准备中」。
   * 这是**收场**不是重试：写入有没有真的落到文稿不在这里猜——之后的写入自带文稿前提（revision / 内容哈希），
   * 落没落会在它那一步被核出来。
   */
  const settleExpired = (receipt: ProjectAgentProposalReceipt): ProjectAgentProposalReceipt => {
    if (receipt.lifecycle !== "preparing" || now() - Date.parse(receipt.updatedAt) <= PROJECT_AGENT_PREPARING_DEADLINE_MS) return receipt;
    return store.write(
      make({
        previous: receipt,
        binding: trustedBinding,
        lifecycle: "undone",
        proposalId: receipt.proposalId,
        operationId: `preparing-expired:${receipt.operationId}`,
        proposal: receipt.proposal,
        requestHash: operationHash("expire", { operationId: receipt.operationId, revision: receipt.revision }),
        updatedAt: new Date(now()).toISOString(),
      }),
    );
  };

  const current = (): ProjectAgentProposalReceipt | null => {
    const receipt = store.read();
    if (!receipt) {
      if (store.exists()) throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt is invalid");
      return null;
    }
    if (!sameProjectAgentBinding(receipt.binding, trustedBinding)) {
      throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt binding mismatch");
    }
    return settleExpired(receipt);
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
        if (receipt && receipt.lifecycle !== "committed" && receipt.lifecycle !== "undone") {
          const settlesInMs = Math.max(0, PROJECT_AGENT_PREPARING_DEADLINE_MS - (now() - Date.parse(receipt.updatedAt)));
          throw new ProjectAgentProposalReceiptError(
            "Project Agent proposal receipt already has an unfinished operation: the previous write has not reported its result. "
              + `Its outcome is settled automatically in about ${Math.ceil(settlesInMs / 1000)}s. Read the script to see what landed, then write again after that.`,
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
          make({
            previous: receipt,
            binding: trustedBinding,
            lifecycle: value.lifecycle,
            proposalId: value.proposalId,
            operationId: value.operationId,
            proposal,
            requestHash,
          }),
        ),
      );
    },
    transition(value) {
      if (!validId(value.proposalId) || !validId(value.operationId)) {
        throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt operation is invalid");
      }
      if (value.lifecycle !== "undoing" && value.lifecycle !== "undone") {
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
      if (
        (value.lifecycle === "undoing" && receipt.lifecycle !== "committed") ||
        (value.lifecycle === "undone" && receipt.lifecycle !== "undoing" && receipt.lifecycle !== "preparing")
      ) {
        throw new ProjectAgentProposalReceiptError("Project Agent proposal receipt lifecycle transition is invalid");
      }
      return toView(
        store.write(
          make({
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
          make({
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
