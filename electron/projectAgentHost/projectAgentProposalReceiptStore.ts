import fs from "node:fs";
import path from "node:path";

import { writeJsonFileAtomic } from "../jsonFile";
import { fsyncIfDurable } from "../durability";
import type { ProjectBinding } from "../shared/projectBinding";
import { assertProjectAgentBinding } from "./projectAgentIdentity";

export type ProjectAgentProposalReceipt = Readonly<{
  schemaVersion: 1;
  binding: ProjectBinding;
  proposal: unknown;
  sourceHash: string;
  updatedAt: string;
}>;

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

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function parse(value: unknown): ProjectAgentProposalReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  try {
    assertProjectAgentBinding(raw.binding as ProjectBinding);
  } catch {
    return null;
  }
  if (raw.schemaVersion !== 1 || !validHash(raw.sourceHash) || typeof raw.updatedAt !== "string") return null;
  return Object.freeze({
    schemaVersion: 1,
    binding: Object.freeze({ ...(raw.binding as ProjectBinding) }),
    proposal: raw.proposal ?? null,
    sourceHash: raw.sourceHash,
    updatedAt: raw.updatedAt,
  });
}

/** Independent owner for committed proposal/Undo receipts. */
export function createProjectAgentProposalReceiptStore(projectRoot: string) {
  return Object.freeze({
    read(): ProjectAgentProposalReceipt | null {
      try {
        return parse(JSON.parse(fs.readFileSync(receiptPath(projectRoot), "utf8")) as unknown);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        return null;
      }
    },
    write(input: Readonly<{ binding: ProjectBinding; proposal: unknown; sourceHash: string; updatedAt?: string }>) {
      assertProjectAgentBinding(input.binding);
      if (!validHash(input.sourceHash)) throw new Error("Proposal receipt source hash is invalid");
      const receipt: ProjectAgentProposalReceipt = {
        schemaVersion: 1,
        binding: Object.freeze({ ...input.binding }),
        proposal: input.proposal ?? null,
        sourceHash: input.sourceHash,
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      };
      writeJsonFileAtomic(receiptPath(projectRoot), receipt, { mode: 0o600 });
      fsyncReceiptDirectory(projectRoot);
      return receipt;
    },
    clear(): void {
      const target = receiptPath(projectRoot);
      const existed = fs.existsSync(target);
      fs.rmSync(target, { force: true });
      if (existed) fsyncReceiptDirectory(projectRoot);
    },
  });
}

export function projectAgentProposalReceiptPath(projectRoot: string): string {
  return receiptPath(projectRoot);
}
