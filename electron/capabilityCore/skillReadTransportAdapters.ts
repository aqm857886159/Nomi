import type { RuntimeToolCall, RuntimeToolDecision } from "../harness/runtime/runtimePort";
import {
  SKILL_READ_CAPABILITY,
  skillReadInputForAlias,
  skillReadResultSchema,
  type SkillReadInput,
} from "../shared/agentCapabilities/skillRead";
import { SKILL_PACKAGE_VERSION } from "../skills/skillPackage";
import {
  readSkillContent,
  readSkillRecords,
  type SkillContent,
  type SkillRecord,
} from "../skills/skillStore";

export type PiSkillReadTransportAdapter = Readonly<{
  tryExecute(call: RuntimeToolCall, signal: AbortSignal): Promise<RuntimeToolDecision | null>;
  dispose(): void;
}>;

type SkillReadDependencies = Readonly<{
  readRecords?: () => SkillRecord[];
  readContent?: (
    key: string,
    audience: "internal",
    records: SkillRecord[],
    expected?: Readonly<{ packageVersion: string; contentHash: string }>,
  ) => SkillContent | null;
}>;

function failure(code: string, message = code): Extract<RuntimeToolDecision, { ok: false }> {
  return { ok: false, code, message };
}

function readInput(call: RuntimeToolCall): SkillReadInput | null {
  try {
    return skillReadInputForAlias(call.toolName, call.args) ?? null;
  } catch {
    return null;
  }
}

/**
 * Main-process read transport for `load_skill`.
 *
 * There is deliberately no approval or renderer callback here.  The adapter
 * reads the authoritative Skill catalog, checks the caller's content hash, and
 * returns only the bounded public record (never a filesystem path or raw
 * package files).  A stale snapshot is a failure, not a best-effort load.
 */
export function createPiSkillReadTransportAdapter(
  dependencies: SkillReadDependencies = {},
): PiSkillReadTransportAdapter {
  const readRecords = dependencies.readRecords ?? readSkillRecords;
  const readContent = dependencies.readContent ?? readSkillContent;
  let disposed = false;

  return Object.freeze({
    async tryExecute(call, signal) {
      if (call.toolName !== SKILL_READ_CAPABILITY.aliases.pi) return null;
      if (disposed) return failure("capability_surface_unavailable");
      if (signal.aborted) return failure("capability_cancelled");
      const input = readInput(call);
      if (!input) return failure("capability_input_invalid", "Invalid Skill name or content hash");
      try {
        const records = readRecords();
        const content = readContent(
          input.name,
          "internal",
          records,
          input.expectedContentHash
            ? { packageVersion: SKILL_PACKAGE_VERSION, contentHash: input.expectedContentHash }
            : undefined,
        );
        if (!content) {
          return failure(
            input.expectedContentHash ? "skill_changed_before_load" : "skill_not_found",
            input.expectedContentHash ? "Skill changed before load" : `Skill not found: ${input.name}`,
          );
        }
        if (signal.aborted) return failure("capability_cancelled");
        const result = skillReadResultSchema.parse({
          loaded: true,
          name: content.name,
          directoryName: content.directoryName,
          description: content.description,
          body: content.body,
          origin: content.origin,
          packageVersion: content.packageVersion,
          contentHash: content.contentHash,
        });
        return { ok: true, result, silent: true };
      } catch (error) {
        const code = error && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : "capability_execution_failed";
        return failure(code);
      }
    },
    dispose() {
      disposed = true;
    },
  });
}
