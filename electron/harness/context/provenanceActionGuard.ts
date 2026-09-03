import type { ProvenanceMark } from "./provenance";

export type ProvenanceAction = "read" | "spend" | "write" | "egress";

export type ProvenanceActionDecision = Readonly<{
  allowed: boolean;
  requiresConfirmation: boolean;
  action: ProvenanceAction;
  taintedSourceRefs: readonly string[];
  reasonCode?: "untrusted_source_requires_confirmation";
}>;

/** Classify the stable Nomi action vocabulary before any tool adapter executes. */
export function classifyToolAction(toolName: string): ProvenanceAction {
  const name = toolName.toLowerCase();
  if (/(export|upload|share|send|egress)/u.test(name)) return "egress";
  if (/(generate|generation|submit|start)/u.test(name)) return "spend";
  if (/(write|edit|append|replace|delete|create|apply|undo)/u.test(name)) return "write";
  return "read";
}

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
