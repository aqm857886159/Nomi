import type { ExecutionContractV1, PlanCandidate } from "../capabilityCore/executionContract";
import type { GenerationProvider } from "../capabilityCore/generationRuntimeAdapter";
import type { GenerationSealMultiShot } from "../capabilityCore/mcpGenerationMultiShot";
import { prepareProductionGenerationAuthorization } from "./prepareProductionGenerationAuthorization";
import type { ProductionRunRepository } from "./productionRunRepository";
import type { ShotPrice } from "./shotPricing";

export function sealAndApproveProductionGeneration(input: Readonly<{
  repository: ProductionRunRepository;
  projectId: string;
  operationId: string;
  immutableProjectUuid: string;
  projectGeneration: number;
  projectRevision: number;
  candidate: PlanCandidate;
  contract: ExecutionContractV1;
  providers: readonly GenerationProvider[];
  multiShot?: GenerationSealMultiShot;
  resolveShotPrice?: (contract: ExecutionContractV1) => ShotPrice;
  maximumSpend?: number | null;
  receiptId?: string;
  now: string;
}>) {
  const current = input.repository.read(input.projectId, input.operationId);
  if (!current) throw new Error(`Production run not found: ${input.operationId}`);
  const authorization = prepareProductionGenerationAuthorization({
    lease: {
      projectId: input.projectId,
      immutableProjectUuid: input.immutableProjectUuid,
      projectGeneration: input.projectGeneration,
      revocationEpoch: 0,
    },
    projectRevision: input.projectRevision,
    operation: {
      operationId: input.operationId,
      projectId: input.projectId,
      candidate: input.candidate,
      planVersion: current.planVersion,
    },
    contract: input.contract,
    ...(input.multiShot ? { multiShot: input.multiShot } : {}),
    providers: input.providers,
    resolveShotPrice: input.resolveShotPrice ?? (() => ({ known: true, amount: 0 })),
    ...(input.maximumSpend !== undefined ? { maximumSpend: input.maximumSpend } : {}),
    now: input.now,
  });
  let run = input.repository.execute(input.projectId, input.operationId, {
    commandId: `test:generation.seal:${input.operationId}:v${current.planVersion}`,
    expectedRevision: current.revision,
    type: "generation.seal",
    payload: {
      contract: input.contract,
      ...(input.multiShot ?? {}),
      authorization,
    },
    issuedAt: input.now,
  }).run;
  const receiptId = input.receiptId ?? `receipt:${authorization.envelope.gateId}`;
  run = input.repository.execute(input.projectId, input.operationId, {
    commandId: `test:generation.gate.decide:${authorization.envelope.gateId}`,
    expectedRevision: run.revision,
    type: "gate.decide",
    payload: {
      gateId: authorization.envelope.gateId,
      status: "approved",
      receiptId,
      authorizationDigest: authorization.authorizationDigest,
    },
    issuedAt: input.now,
  }).run;
  return { authorization, run };
}
