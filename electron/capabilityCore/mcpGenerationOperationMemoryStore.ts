import { generationShotEnvelopeOf } from "../shared/generationShotEnvelope";
import { applyPlanCandidatePatch } from "./executionContract";
import type { GenerationOperation, GenerationOperationStore } from "./mcpGenerationTools";

/**
 * 只给测试与夹具用的内存版草稿存储（从 mcpGenerationTools.ts 抽出，守 800 行门岗 R9）。
 *
 * 生产装配一律用 Run 拥有的那一份（`productionGenerationOperationStore.ts`）。这份住在这里而不是
 * 测试目录：它实现的是同一个 `GenerationOperationStore` 契约，契约变了它必须跟着红。
 */
function freeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return value;
}

/** Test/fixture store only. Production wiring must supply a Run-owned durable store. */
export function createInMemoryGenerationOperationStore(): GenerationOperationStore {
  const operations = new Map<string, GenerationOperation>();
  const keyFor = (projectId: string, operationId: string) => `${projectId}:${operationId}`;
  const read = (projectId: string, operationId: string) => operations.get(keyFor(projectId, operationId)) ?? null;
  return {
    create(input) {
      const key = keyFor(input.projectId, input.operationId);
      if (operations.has(key)) throw new Error(`Generation operation already exists: ${input.operationId}`);
      const operation = freeze({
        operationId: input.operationId,
        projectId: input.projectId,
        candidate: structuredClone(input.candidate),
        ...(input.origin?.sourceDocument ? {sourceDocumentId:input.origin.sourceDocument.documentId} : {}),
        state: "draft" as const,
        ...(input.cardHidden === true ? { cardHidden: true } : {}),
        // P4 S6.5: seed draft shots (candidate/role/included, no sub-contract). Single-shot omits shots.
        ...(input.shots && input.shots.length > 0
          ? { shots: input.shots.map((shot) => ({ ...generationShotEnvelopeOf(shot), candidate: structuredClone(shot.candidate) })) }
          : {}),
        updatedAt: input.now,
      });
      operations.set(key, operation);
      return operation;
    },
    read,
    patch(projectId, operationId, patch, now, shotId) {
      const current = read(projectId, operationId);
      if (!current) throw new Error(`Generation operation not found: ${operationId}`);
      if (current.state !== "draft") throw new Error("new_draft_required: edit a new generation draft");
      if (shotId) {
        if (!current.shots?.some((shot) => shot.shotId === shotId)) throw new Error(`Generation shot not found: ${shotId}`);
        const shots = current.shots.map((shot) => shot.shotId === shotId ? { ...shot, candidate: applyPlanCandidatePatch(shot.candidate, patch) } : shot);
        const next = freeze({ ...current, shots, updatedAt: now });
        operations.set(keyFor(projectId, operationId), next);
        return next;
      }
      const candidate = applyPlanCandidatePatch(current.candidate, patch);
      const next = freeze({ ...current, candidate, updatedAt: now });
      operations.set(keyFor(projectId, operationId), next);
      return next;
    },
    // 出价只有 Run 主人记得下（出价账 `generationPlan.presentations`）：摆哪几镜要读最近一张卡，这份内存版没有账，
    // 留着一份自己的「没点名 = 全部」就是第二份默认（2026-10-27）。要测 generate 请用 Run 拥有的那一份。
    present() {
      throw new Error("generation_present_unsupported: the in-memory store has no offer ledger; present through the Run-owned store");
    },
    seal(projectId, operationId, contract, now, multiShot, authorization) {
      const current = read(projectId, operationId);
      if (!current) throw new Error(`Generation operation not found: ${operationId}`);
      if (current.state === "sealed" && current.contract?.contractHash === contract.contractHash) return current;
      if (current.state !== "draft") throw new Error("Generation operation is not editable");
      const next = freeze({
        ...current,
        candidate: { ...current.candidate, sealedContractHash: contract.contractHash },
        contract,
        state: "sealed" as const,
        // P4 S6.5: freeze the multi-shot bundle (per-shot sub-contracts + plan hash) exactly as the durable
        // reducer does. The gate projection reads these; a single-shot seal omits them (unchanged).
        ...(multiShot ? { shots: multiShot.shots.map((shot) => ({ ...shot, candidate: { ...shot.candidate } })) } : {}),
        ...(authorization
          ? { authorization: { gateId: authorization.envelope.gateId, digest: authorization.authorizationDigest,
              envelope: structuredClone(authorization.envelope), status: "waiting" as const } }
          : {}),
        updatedAt: now,
      });
      operations.set(keyFor(projectId, operationId), next);
      return next;
    },
    withdraw(projectId, operationId, now) {
      const current = read(projectId, operationId);
      if (!current) throw new Error(`Generation operation not found: ${operationId}`);
      // 内存版没有门：sealed 即「已出价未决」。与 durable reducer 同一条边——回 draft、未 present。
      if (current.state !== "draft" && current.state !== "sealed") return current;
      if (current.state === "draft" && current.cardHidden === true) return current;
      const { contract: _contract, authorization: _authorization, ...draft } = current;
      const next = freeze({ ...draft, candidate: { ...current.candidate, sealedContractHash: undefined },
        state: "draft" as const, cardHidden: true, updatedAt: now });
      operations.set(keyFor(projectId, operationId), next);
      return next;
    },
    cancel(projectId, operationId, now) {
      const current = read(projectId, operationId);
      if (!current) throw new Error(`Generation operation not found: ${operationId}`);
      if (current.state === "submitted") throw new Error("Submitted generation cannot be cancelled as a draft");
      const next = freeze({ ...current, state: "cancelled" as const, updatedAt: now });
      operations.set(keyFor(projectId, operationId), next);
      return next;
    },
  };
}
