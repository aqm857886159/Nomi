import { createHash } from "node:crypto";

import type { RuntimeToolCall, RuntimeToolDecision } from "../harness/runtime/runtimePort";
import {
  SKILL_WRITE_CAPABILITY,
  skillWriteInputForAlias,
  skillWriteResultSchema,
  type SkillWriteInput,
  type SkillWriteResult,
} from "../shared/agentCapabilities/skillWrite";
import type { PreconditionSet, TargetRef } from "../shared/capabilityTargeting";
import type { ProjectBinding } from "../shared/projectBinding";
import {
  buildSkillPackage,
  computeSkillContentHash,
  importSkillPackageToUserDir,
  SKILL_PACKAGE_VERSION,
  validateSkillPackage,
  type ImportSkillResult,
  type SkillPackage,
} from "../skills/skillPackage";
import { readSkillRecords, type SkillRecord } from "../skills/skillStore";

/** The immutable metadata captured before a user approves a Skill write. */
export type PreparedSkillWrite = Readonly<{
  call: RuntimeToolCall;
  args: SkillWriteInput;
  pkg: SkillPackage;
  invocation: Readonly<{
    target: TargetRef;
    preconditions: PreconditionSet;
    policyRevision: number;
    inputHash: string;
    actionHash: string;
  }>;
}>;

export type SkillWriteApprovalAuthority = Readonly<{
  receiptProposalId: string;
  approvalId: string;
  actionHash: string;
}>;

export type PiSkillWriteTransportAdapter = Readonly<{
  prepare(
    call: RuntimeToolCall,
    context: Readonly<{ target: TargetRef; preconditions: PreconditionSet }>,
    signal: AbortSignal,
  ): Promise<PreparedSkillWrite | null>;
  execute(
    prepared: PreparedSkillWrite,
    approval: SkillWriteApprovalAuthority,
    signal: AbortSignal,
  ): Promise<RuntimeToolDecision>;
  dispose(): void;
}>;

type SkillWriteDependencies = Readonly<{
  binding?: ProjectBinding;
  readRecords?: () => SkillRecord[];
  importPackage?: (pkg: SkillPackage) => ImportSkillResult;
  now?: () => number;
}>;

const PUBLIC_FAILURE_CODES = new Set([
  "capability_authority_invalid",
  "capability_input_invalid",
  "capability_cancelled",
  "capability_execution_failed",
  "capability_surface_unavailable",
]);

function failure(code: string): Extract<RuntimeToolDecision, { ok: false }> {
  const publicCode = PUBLIC_FAILURE_CODES.has(code) ? code : "capability_execution_failed";
  return { ok: false, code: publicCode, message: publicCode };
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
  throw new Error("capability_input_invalid");
}

function digest(domain: string, value: unknown): string {
  return createHash("sha256")
    .update(`nomi-skill-write:${domain}:v1\0${stableJson(value)}`)
    .digest("hex");
}

function recordForHash(records: readonly SkillRecord[], contentHash: string): SkillRecord | undefined {
  return records.find((record) => record.origin === "user" && record.contentHash === contentHash);
}

function resultFor(
  record: Pick<SkillRecord, "directoryName" | "name" | "contentHash">,
  created: boolean,
): SkillWriteResult {
  return skillWriteResultSchema.parse({
    applied: true,
    dirName: record.directoryName,
    skillName: record.name,
    packageVersion: SKILL_PACKAGE_VERSION,
    contentHash: record.contentHash,
    created,
  });
}

function resultFromImport(
  imported: Extract<ImportSkillResult, { ok: true }>,
  pkg: SkillPackage,
  readRecords: () => SkillRecord[],
): SkillWriteResult {
  const contentHash = computeSkillContentHash(pkg.files);
  const persisted = readRecords().find(
    (record) => record.origin === "user" && record.directoryName === imported.dirName && record.contentHash === contentHash,
  );
  if (!persisted) throw new Error("capability_execution_failed");
  return resultFor(persisted, true);
}

/**
 * Main-process Skill owner.  The adapter deliberately talks only to the
 * validated package importer and then re-reads the catalog, so an optimistic
 * "saved" response can never be emitted when the library did not change.
 */
export function createPiSkillWriteTransportAdapter(
  dependencies: SkillWriteDependencies = {},
): PiSkillWriteTransportAdapter {
  const readRecords = dependencies.readRecords ?? readSkillRecords;
  const importPackage = dependencies.importPackage ?? importSkillPackageToUserDir;
  const now = dependencies.now ?? Date.now;
  let disposed = false;

  return Object.freeze({
    async prepare(call, context, signal) {
      if (call.toolName !== SKILL_WRITE_CAPABILITY.aliases.pi) return null;
      if (disposed) throw Object.assign(new Error("capability_surface_unavailable"), { code: "capability_surface_unavailable" });
      if (signal.aborted) throw Object.assign(new Error("capability_cancelled"), { code: "capability_cancelled" });

      let args: SkillWriteInput;
      try {
        args = skillWriteInputForAlias(call.toolName, call.args) as SkillWriteInput;
      } catch {
        throw Object.assign(new Error("capability_input_invalid"), { code: "capability_input_invalid" });
      }

      // A skill is one file: SKILL.md, whose frontmatter is the whole manifest.
      const pkg = buildSkillPackage(args.dirName, { "SKILL.md": args.skillMarkdown }, now());
      const validated = validateSkillPackage(pkg);
      if (!validated.ok) {
        throw Object.assign(new Error("capability_input_invalid"), { code: "capability_input_invalid" });
      }
      const inputHash = digest("input", { operation: args.operation, dirName: args.dirName, files: pkg.files });
      const actionHash = digest("action", {
        capability: { id: SKILL_WRITE_CAPABILITY.id, version: SKILL_WRITE_CAPABILITY.version },
        ...(dependencies.binding ? { projectBinding: dependencies.binding } : {}),
        inputHash,
        target: context.target,
        preconditions: context.preconditions,
      });
      return Object.freeze({
        call,
        args,
        pkg: validated.pkg,
        invocation: Object.freeze({
          target: context.target,
          preconditions: context.preconditions,
          policyRevision: 1,
          inputHash,
          actionHash,
        }),
      });
    },

    async execute(prepared, approval, signal) {
      if (disposed) return failure("capability_surface_unavailable");
      if (signal.aborted) return failure("capability_cancelled");
      if (
        !approval.receiptProposalId.trim() ||
        !approval.approvalId.trim() ||
        approval.actionHash !== prepared.invocation.actionHash
      ) return failure("capability_authority_invalid");
      try {
        const contentHash = computeSkillContentHash(prepared.pkg.files);
        const existing = recordForHash(readRecords(), contentHash);
        if (existing) {
          return {
            ok: true,
            result: resultFor(existing, false),
            proposalId: approval.receiptProposalId,
            silent: true,
          };
        }
        const imported = importPackage(prepared.pkg);
        if (!imported.ok) return failure("capability_execution_failed");
        const result = resultFromImport(imported, prepared.pkg, readRecords);
        return { ok: true, result, proposalId: approval.receiptProposalId, silent: true };
      } catch (error) {
        return failure(error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : "capability_execution_failed");
      }
    },

    dispose() {
      disposed = true;
    },
  });
}
