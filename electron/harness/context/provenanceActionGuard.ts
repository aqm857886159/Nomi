import type { ProvenanceMark } from "./provenance";

export type ProvenanceAction = "read" | "spend" | "write" | "egress";

export type ProvenanceActionDecision = Readonly<{
  allowed: boolean;
  requiresConfirmation: boolean;
  action: ProvenanceAction;
  taintedSourceRefs: readonly string[];
  reasonCode?: "untrusted_source_requires_confirmation";
}>;

export function evaluateProvenanceAction(
  action: ProvenanceAction,
  provenance: readonly ProvenanceMark[],
): ProvenanceActionDecision {
  const taintedSourceRefs = Object.freeze([...new Set(provenance
    .filter((mark) => mark.tainted)
    .map((mark) => mark.sourceRef))]);
  const requiresConfirmation = action !== "read" && taintedSourceRefs.length > 0;
  return Object.freeze({
    allowed: !requiresConfirmation,
    requiresConfirmation,
    action,
    taintedSourceRefs,
    ...(requiresConfirmation ? { reasonCode: "untrusted_source_requires_confirmation" as const } : {}),
  });
}
