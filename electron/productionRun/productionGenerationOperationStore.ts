import type { GenerationOperation, GenerationOperationStore } from "../capabilityCore/mcpGenerationTools";
import type { ExecutionContractV1 } from "../capabilityCore/executionContract";
import type { ProductionRunService } from "./productionRunService";

type GenerationRunOwner = Pick<ProductionRunService, "createGenerationDraft" | "readFull" | "command">;

function operationFromRun(run: ReturnType<ProductionRunService["readFull"]>): GenerationOperation | null {
  const plan = run.generationPlan;
  if (!plan) return null;
  return {
    operationId: plan.operationId,
    projectId: run.projectId,
    candidate: structuredClone(plan.candidate),
    state: plan.state,
    ...(plan.contract ? { contract: structuredClone(plan.contract) } : {}),
    ...(plan.approvedReceiptId ? { approvedReceiptId: plan.approvedReceiptId } : {}),
    ...(plan.authorizationEnvelope ? { authorizationEnvelope: structuredClone(plan.authorizationEnvelope) } : {}),
    ...(plan.authorizationDigest ? { authorizationDigest: plan.authorizationDigest } : {}),
    ...(plan.authorizationGateId ? { authorizationGateId: plan.authorizationGateId } : {}),
    planVersion: run.planVersion,
    // P4 S4: project the multi-shot entries so the MCP gate can build the real display.shots. A
    // single-shot plan has no shots[] → this is omitted and the flat single-shot path is unchanged.
    ...(plan.shots && plan.shots.length > 0
      ? {
          shots: plan.shots.map((shot) => ({
            shotId: shot.shotId,
            ...(shot.role ? { role: shot.role } : {}),
            ...(shot.included !== undefined ? { included: shot.included } : {}),
            candidate: structuredClone(shot.candidate),
            ...(shot.contract ? { contract: structuredClone(shot.contract) } : {}),
          })),
          ...(plan.planHash ? { planHash: plan.planHash } : {}),
        }
      : {}),
    updatedAt: plan.updatedAt,
  };
}

/**
 * Draft-lifecycle observers. A generation draft is the user-visible intent ("the agent said it made
 * one"), so the moment it is created or edited the canvas projection must follow — otherwise the only
 * place the user can see it is a task row, and the nodes appear only on the next project reopen.
 *
 * The hook is fire-and-forget by contract: canvas landing is best-effort (§1 铁律) and must never
 * block or fail a durable draft command.
 */
export type ProductionGenerationOperationStoreHooks = {
  onPlanChanged?: (projectId: string, operationId: string) => void;
};

/** Durable adapter: the semantic MCP handler talks to ProductionRun, never to a second draft store. */
export function createProductionGenerationOperationStore(
  owner: GenerationRunOwner,
  hooks: ProductionGenerationOperationStoreHooks = {},
): GenerationOperationStore {
  // Never let a landing observer's throw surface as a draft-command failure.
  const notifyPlanChanged = (projectId: string, operationId: string): void => {
    if (!hooks.onPlanChanged) return;
    try {
      hooks.onPlanChanged(projectId, operationId);
    } catch {
      // best-effort projection; the durable plan is already committed.
    }
  };
  const read = (projectId: string, operationId: string): GenerationOperation => {
    const operation = operationFromRun(owner.readFull(projectId, operationId));
    if (!operation) throw new Error(`Generation operation not found: ${operationId}`);
    return operation;
  };
  return {
    create(input) {
      // P4 S6.5: a multi-shot draft scopes its policy to the UNION of every shot's provider/model (anchor
      // image model + video shot models differ). Without this the Run policy would reject the video shot's
      // model at submit (它不在白名单). A single-shot draft's union is just the one candidate (unchanged).
      const providers = new Set<string>([input.candidate.providerId]);
      const models = new Set<string>([input.candidate.modelId]);
      for (const shot of input.shots ?? []) { providers.add(shot.candidate.providerId); models.add(shot.candidate.modelId); }
      const run = owner.createGenerationDraft({
        operationId: input.operationId,
        projectId: input.projectId,
        origin: input.origin ?? { host: "semantic-mcp" },
        // A semantic draft is scoped to the verified transport and the exact
        // candidate the user approved.  This is not a provider bypass: the
        // receipt gate still authorizes the single submit, while the Run's
        // policy prevents a later command from changing host/provider/model.
        policy: {
          trustedHosts: [input.origin?.host ?? "semantic-mcp"],
          allowedProviders: [...providers],
          allowedModels: [...models],
        },
        candidate: input.candidate,
        ...(input.shots && input.shots.length > 0 ? { shots: input.shots } : {}),
      });
      const operation = operationFromRun(run);
      if (!operation) throw new Error("Production Run did not persist a generation plan");
      // 建草稿即刻落画布（与「确认即落」「打开项目补齐」共用同一条幂等落地链）。
      notifyPlanChanged(operation.projectId, operation.operationId);
      return operation;
    },
    read,
    async patch(projectId, operationId, patch, now) {
      const current = read(projectId, operationId);
      const result = await owner.command(projectId, operationId, {
        commandId: `generation.patch:${operationId}:${current.candidate.revision}`,
        expectedRevision: owner.readFull(projectId, operationId).revision,
        type: "generation.patch",
        payload: { patch },
        issuedAt: now,
      });
      const operation = operationFromRun(result.run);
      if (!operation) throw new Error("Production Run lost its generation plan");
      // 改草稿同样立刻投影：已落的节点按候选 revision 重绑定 prompt/模型（不新建第二条落地链）。
      notifyPlanChanged(operation.projectId, operation.operationId);
      return operation;
    },
    async seal(projectId, operationId, contract: ExecutionContractV1, now, multiShot, authorization) {
      read(projectId, operationId);
      const result = await owner.command(projectId, operationId, {
        // P4 S6.5: a multi-shot seal keys its commandId on the plan hash (covers the whole batch); a
        // single-shot seal keeps the contract-hash key (unchanged). This keeps re-seal idempotent per scope.
        commandId: `generation.seal:${operationId}:${multiShot?.planHash ?? contract.contractHash}`,
        expectedRevision: owner.readFull(projectId, operationId).revision,
        type: "generation.seal",
        // P4 S6.5: forward the per-shot sub-contracts + planHash + derived shotPrices so the reducer
        // freezes the batch and enforces the seal-time hard cap (reducer generation.seal already consumes
        // shots/planHash/shotPrices). Single-shot seal sends only { contract } (byte-identical to today).
        payload: {
          contract,
          ...(multiShot ? { shots: multiShot.shots, planHash: multiShot.planHash, ...(multiShot.shotPrices ? { shotPrices: multiShot.shotPrices } : {}) } : {}),
          ...(authorization ? { authorization } : {}),
        },
        issuedAt: now,
      });
      const operation = operationFromRun(result.run);
      if (!operation) throw new Error("Production Run lost its generation plan");
      return operation;
    },
    async cancel(projectId, operationId, now) {
      const current = read(projectId, operationId);
      const result = await owner.command(projectId, operationId, {
        commandId: `generation.cancel:${operationId}:${current.state}`,
        expectedRevision: owner.readFull(projectId, operationId).revision,
        type: "generation.cancel",
        payload: {},
        issuedAt: now,
      });
      const operation = operationFromRun(result.run);
      if (!operation) throw new Error("Production Run lost its generation plan");
      return operation;
    },
    /**
     * 2026-09-11 付费卡上改参数。`commandId` 带 `planVersion`：改参数是**可重放的用户动作**
     * （用户可能连点两下），幂等键只用 operationId 会把第二次改动吃掉；带上 planVersion 之后，
     * 每一次真的把计划推进一版的改动都有自己的键，而同一版上的重发仍然幂等（同 trial_narrow）。
     */
    async revise(projectId, operationId, input, now) {
      const current = read(projectId, operationId);
      const result = await owner.command(projectId, operationId, {
        commandId: `generation.revise:${operationId}:v${current.planVersion}:${current.candidate.revision}:${input.shotId ?? "plan"}`,
        expectedRevision: owner.readFull(projectId, operationId).revision,
        type: "generation.revise",
        payload: {
          patch: input.patch,
          ...(input.shotId ? { shotId: input.shotId } : {}),
          ...(input.shotId && typeof input.included === "boolean" ? { included: input.included } : {}),
        },
        issuedAt: now,
      });
      const operation = operationFromRun(result.run);
      if (!operation) throw new Error("Production Run lost its generation plan");
      // 改草稿立刻投影回画布：卡上改的提示词/模型必须同步到那份已经落地的草稿节点，
      // 否则「卡上说的」和「画布上的」又分叉成两个账本（同 patch 那条链，不新建第二条）。
      notifyPlanChanged(operation.projectId, operation.operationId);
      return operation;
    },
    async trialNarrow(projectId, operationId, now) {
      const current = read(projectId, operationId);
      const result = await owner.command(projectId, operationId, {
        commandId: `generation.trial_narrow:${operationId}:v${current.planVersion}`,
        expectedRevision: owner.readFull(projectId, operationId).revision,
        type: "generation.trial_narrow",
        payload: {},
        issuedAt: now,
      });
      const operation = operationFromRun(result.run);
      if (!operation) throw new Error("Production Run lost its generation plan");
      return operation;
    },
  };
}

export type ProductionGenerationOperationStore = ReturnType<typeof createProductionGenerationOperationStore>;
