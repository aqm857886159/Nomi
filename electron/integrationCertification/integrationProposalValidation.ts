/**
 * 接入提案的入库前校验（HTTP 供应商那一半）。
 *
 * 单独成文件的理由：所有拒绝都发生在任何 CAS 写之前，而且必须给出带字段路径的可读原因——
 * 它是纯函数、与会话状态机无关，留在 integrationSession.ts 里只会把那个巨壳继续喂大（R9/R12）。
 */
import type { IntegrationCandidate } from "./integrationSession";
import { assertRecord, rejectWorkflowKeys } from "./integrationWorkflowBinding";

function clone<T>(value: T): T {
  return structuredClone(value);
}
function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new Error(`Invalid ${name}`);
  return value.trim();
}
function id(value: unknown, name: string): string {
  const normalized = text(value, name, 160);
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) throw new Error(`Invalid ${name}`);
  return normalized;
}

export const PROPOSAL_KINDS = new Set(["text", "image", "video", "audio", "model3d"]);
export function proposalRejected(field: string, reason: string, repair: string): never {
  throw new Error(`propose rejected: ${field} ${reason}. ${repair}`);
}
export function proposalCandidates(value: unknown): IntegrationCandidate[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    proposalRejected("proposal.candidates", "must contain 1 to 100 items", "send the complete candidate page set");
  return value.map((raw, index) => {
    assertRecord(raw);
    try {
      rejectWorkflowKeys(raw, ["modelKey", "kind"], `proposal.candidates[${index}]`);
      const modelKey = id(raw.modelKey, `proposal.candidates[${index}].modelKey`);
      if (typeof raw.kind !== "string" || !PROPOSAL_KINDS.has(raw.kind))
        proposalRejected(`proposal.candidates[${index}].kind`, "is not a supported capability kind", "use text, image, video, audio, or model3d");
      return { modelKey, kind: raw.kind };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("propose rejected:")) throw error;
      proposalRejected(`proposal.candidates[${index}]`, error instanceof Error ? error.message : "is invalid", "correct the candidate object and resubmit");
    }
  });
}
export function proposalSelections(value: unknown, candidates: IntegrationCandidate[]): IntegrationCandidate[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    proposalRejected("proposal.selections", "must contain 1 to 100 items", "select at least one candidate by modelKey");
  const allowed = new Map(candidates.map((candidate) => [candidate.modelKey, candidate]));
  return value.map((raw, index) => {
    assertRecord(raw);
    rejectWorkflowKeys(raw, ["modelKey"], `proposal.selections[${index}]`);
    const modelKey = id(raw.modelKey, `proposal.selections[${index}].modelKey`);
    const candidate = allowed.get(modelKey);
    if (!candidate) proposalRejected(`proposal.selections[${index}].modelKey`, "does not match proposal.candidates", "select only a candidate included in the same proposal");
    return clone(candidate);
  });
}