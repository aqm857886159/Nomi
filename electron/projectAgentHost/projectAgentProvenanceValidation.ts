import { PROVENANCE_SOURCES } from "../harness/context/provenance";
import { ProjectAgentStateError } from "./projectAgentStateError";
import {
  asRecord,
  assertAllowedKeys,
  assertNonEmpty,
} from "./projectAgentStateValidationPrimitives";

const PROVENANCE_SOURCE_SET = new Set<string>(PROVENANCE_SOURCES);
const PROVENANCE_TRUST_SET = new Set(["trusted", "user", "untrusted"]);

/** Validate the hash-free provenance projection carried by a durable tool item. */
export function assertProjectAgentProvenance(value: unknown): void {
  if (!Array.isArray(value)) throw new ProjectAgentStateError("invalid_state");
  for (const markValue of value) {
    const mark = asRecord(markValue);
    assertAllowedKeys(mark, ["source", "sourceRef", "trust", "tainted", "assetEvidenceRef"]);
    if (!PROVENANCE_SOURCE_SET.has(String(mark.source))) {
      throw new ProjectAgentStateError("invalid_state");
    }
    assertNonEmpty(mark.sourceRef);
    if (!PROVENANCE_TRUST_SET.has(String(mark.trust))) {
      throw new ProjectAgentStateError("invalid_state");
    }
    if (typeof mark.tainted !== "boolean") {
      throw new ProjectAgentStateError("invalid_state");
    }
    if (mark.assetEvidenceRef !== undefined) assertNonEmpty(mark.assetEvidenceRef);
  }
}
