import { stableAuthorizationJson } from "./productionGenerationAuthorization";
import type { ProductionGenerationPlan, ProductionGenerationShot, ProductionRun, RunCommand } from "./productionRunTypes";
import { checkSealAffordability, type ShotPrice } from "./shotPricing";
import { deriveSealedGenerationAuthorizationState } from "./productionGenerationAuthorizationState";
import { waitingAuthorizationGates } from "../shared/productionSpendAuthority";
import { shotApprovedInCurrentPresentation } from "../shared/productionGenerationPresentation";
import { resolveNamedGenerationShots } from "../shared/agentCapabilities/generationShotScope";
import type { ProductionCommandEffect } from "./productionRunReducer";

export class SealBudgetExceededError extends Error {
  readonly code = "seal_budget_exceeded" as const;

  constructor(
    readonly maxAffordableShots: number,
    readonly knownSubtotal: number,
    readonly maxSpend: number,
  ) {
    super(`seal_budget_exceeded: hard spend ceiling ${maxSpend} covers only the first ${maxAffordableShots} shot(s)`);
    this.name = "SealBudgetExceededError";
  }
}

export function generationSealShotPrices(raw: unknown): Map<string, ShotPrice> | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error("Generation seal shotPrices must be an array");
  const prices = new Map<string, ShotPrice>();
  for (const [index, value] of raw.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid seal shot price at ${index}`);
    const entry = value as { shotId?: unknown; price?: unknown };
    const shotId = typeof entry.shotId === "string" ? entry.shotId.trim() : "";
    if (!shotId) throw new Error(`Invalid seal shot price id at ${index}`);
    const price = entry.price as ShotPrice | undefined;
    if (!price || typeof price !== "object" || typeof (price as { known?: unknown }).known !== "boolean") {
      throw new Error(`Invalid seal shot price value at ${index}`);
    }
    if (price.known && !(Number.isFinite(price.amount) && price.amount >= 0)) {
      throw new Error(`Invalid seal shot price amount at ${index}`);
    }
    prices.set(shotId, price.known ? { known: true, amount: price.amount } : { known: false });
  }
  return prices;
}

export type GenerationSealCostCertainty = ProductionGenerationPlan["costCertainty"];

/** A shot is included in the sealed contract unless it was explicitly unchecked (试拍/分批). */
export function isShotIncluded(shot: Pick<ProductionGenerationShot, "included">): boolean {
  return shot.included !== false;
}

/**
 * P4 S1 seal helper: validate + freeze the shots[] payload. Returns undefined for a single-shot seal
 * (no shots[] payload → today's byte-identical path). For a multi-shot seal, every INCLUDED shot must
 * carry a matching sealed sub-contract; excluded shots must not; shot ids must be unique and non-empty.
 */
export function sealGenerationShots(plan: ProductionGenerationPlan, raw: unknown, scope?: ReadonlySet<string>): ProductionGenerationShot[] | undefined {
  if (raw === undefined) {
    if (plan.shots?.length) throw new Error("Multi-shot seal must include the complete current shot list");
    return undefined;
  }
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("Multi-shot generation seal requires a non-empty shots list");
  if (plan.shots && raw.length !== plan.shots.length) throw new Error("Generation seal shot set does not match the current plan");
  const seen = new Set<string>();
  // 封存前这一镜已有的画布绑定。seal 冻的是**合同与候选**；`nodeId` / `canvasDetached` 是画布落地
  // owner 写的「shot ↔ 画布节点」单一真相（productionRunTypes.ts 该字段的注释），不归 seal 管。
  const priorByShotId = new Map((plan.shots ?? []).map((shot) => [shot.shotId, shot] as const));
  const sealed = raw.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid generation shot ${index}`);
    const shot = value as ProductionGenerationShot;
    const shotId = typeof shot.shotId === "string" ? shot.shotId.trim() : "";
    if (!shotId || seen.has(shotId)) throw new Error(`Invalid generation shot id at ${index}`);
    seen.add(shotId);
    const included = isShotIncluded(shot);
    // 这一次封印只盖点到的那几镜（`scope`）；范围外的镜原样留着——没决定的没有合同，批过的留着它那一份。
    const sealsNow = included && (!scope || scope.has(shotId));
    if (sealsNow) {
      if (!shot.contract || typeof shot.contract.contractHash !== "string" || !shot.contract.contractHash.trim()) {
        throw new Error(`Included generation shot ${shotId} needs a sealed sub-contract`);
      }
      if (shot.candidate?.sealedContractHash !== shot.contract.contractHash) {
        throw new Error(`Generation shot ${shotId} sub-contract does not match its sealed candidate`);
      }
    } else if (!included && shot.contract) {
      throw new Error(`Excluded generation shot ${shotId} must not carry a sealed sub-contract`);
    }
    // 调用方（capabilityCore 的 sealMultiShotFor）**逐字段重建**每一镜，只带 shotId/role/included/
    // candidate/contract——照单全收就等于把已经落地的 nodeId 抹掉。抹掉的代价不是「下次补上」：
    //   ① seal 当场就按 shot.nodeId 铸 job（productionGenerationAuthorizationState.authorizationUnits），
    //      抹掉 = 这批 job 永远没有 nodeId → semanticGenerationReadiness 判「生成镜头缺少画布节点」，
    //      整个 Run 停在 needs_attention；
    //   ② 确认即落那次重落地算出的绑定与草稿那次**逐字节相同**，故 bind 命令的 commandId
    //      （canvas-landing:{runId}:bind:{shotId}={nodeId}…）也相同，被仓储按幂等重放吞掉 → 补不回来。
    // 所以这里必须把绑定带过封存线。用户自己删占位留下的 canvasDetached 同理（撤销事实优先）。
    const prior = priorByShotId.get(shotId);
    if (!prior) {
      if (plan.shots) throw new Error(`Unknown generation shot: ${shotId}`);
      throw new Error("Generation seal cannot introduce shots outside the draft plan");
    }
    const { sealedContractHash: _hash, ...candidate } = shot.candidate;
    const { sealedContractHash: _priorHash, ...priorCandidate } = prior.candidate;
    if (plan.shots?.[index].shotId !== shotId || isShotIncluded(prior) !== included
      || prior.role !== shot.role || stableAuthorizationJson(candidate) !== stableAuthorizationJson(priorCandidate)) {
      throw new Error(`Generation seal does not match current shot: ${shotId}`);
    }
    if (!sealsNow) {
      if (included && shot.contract && stableAuthorizationJson(shot.contract) !== stableAuthorizationJson(prior.contract)) {
        throw new Error(`Generation seal cannot change shot ${shotId} outside its scope`);
      }
      return prior;
    }
    // The draft owner retains node binding, metadata, title and attempt lineage. Seal only freezes execution.
    return { ...prior, candidate: shot.candidate, ...(shot.contract ? { contract: shot.contract } : {}) };
  });
  return sealed;
}

/**
 * 这一次封印盖哪几镜（2026-09-30 付费卡逐镜：每点一次封一份，只盖那一次点到的镜）。
 *
 * 多镜计划的封印必须点名范围（`scope`，2026-10-27）：不点名的范围只有一条规则，由付费门（`resolveGateScope` →
 * `resolveUndecidedGenerationShotScope`）按出价账算好再传进来，reducer 里不留第二份缺省。点名的必须都是勾进这一批、
 * 这一次出价里还没批过的镜（重复 / 空 / 不在里面一律原子拒）。单镜旧形态没有范围（它只封一次）。
 */
export function sealScopeOf(run: Pick<ProductionRun, "gates">, plan: ProductionGenerationPlan, raw: unknown): ReadonlySet<string> | undefined {
  if (!plan.shots?.length) {
    if (raw !== undefined) throw new Error("A single-shot generation seal has no shot scope");
    return undefined;
  }
  if (raw === undefined) throw new Error("A multi-shot generation seal must name its shot scope");
  // 「还没批」按这一次出价算：之前几轮批过的镜，在新的一轮里照样可以再批一次（新的尝试）；没有出价时就是从没批过的。
  const open = plan.shots
    .filter((shot) => isShotIncluded(shot) && !shotApprovedInCurrentPresentation({ gates: run.gates, generationPlan: plan }, shot.shotId))
    .map((shot) => shot.shotId);
  return new Set(resolveNamedGenerationShots(open, raw));
}

function contractFrom(payload: Record<string, unknown>): NonNullable<ProductionGenerationPlan["contract"]> {
  const contract = payload.contract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)
    || typeof (contract as { contractHash?: unknown }).contractHash !== "string"
    || !(contract as { contractHash: string }).contractHash.trim()) {
    throw new Error("Invalid generation contract");
  }
  return contract as NonNullable<ProductionGenerationPlan["contract"]>;
}

/**
 * `generation.seal`：冻住这一次点到的那几镜的合同，并在同一次写入里开它们那一道付费门（信封住在门上）。
 *
 * 多镜计划每点一次封一份——已经在跑的计划也能再封还没决定的镜（第 2 页点「生成这张」时第 1 张可能正在生成）；
 * 单镜旧形态只封一次。前一次没点完留下的那份等人的授权必须先由调用方撤掉（`generation.authorization.abandon`）：
 * 这里不替它决定「那一次算不算数」。
 */
export function applyGenerationSeal(current: ProductionRun, command: RunCommand, now: string): ProductionCommandEffect {
  const currentPlan = current.generationPlan;
  if (!currentPlan || currentPlan.state === "cancelled") throw new Error("Generation plan is not editable");
  if (currentPlan.state !== "draft" && !currentPlan.shots?.length) throw new Error("Generation plan is not editable");
  if (waitingAuthorizationGates(current).length > 0) {
    throw new Error("Generation plan already has an authorization waiting for a decision");
  }
  const contract = contractFrom(command.payload);
  if (contract.candidateId !== currentPlan.candidate.candidateId || contract.candidateRevision !== currentPlan.candidate.revision) {
    throw new Error("Generation contract does not match the current draft");
  }
  const scope = sealScopeOf(current, currentPlan, command.payload.scope);
  // P4 S1 multi-shot seal: freeze per-shot sub-contracts (the shots in scope) + the plan-level hash.
  const sealedShots = sealGenerationShots(currentPlan, command.payload.shots, scope);
  // P4 S2 seal precheck: when the caller supplies per-shot prices (derived from the catalog), the
  // reducer enforces the hard spend ceiling at the single source of truth, over exactly what this seal covers.
  const shotPrices = generationSealShotPrices(command.payload.shotPrices);
  let costCertainty: ProductionGenerationPlan["costCertainty"];
  if (shotPrices) {
    const orderedShots = sealedShots
      ? sealedShots.filter((shot) => isShotIncluded(shot) && (!scope || scope.has(shot.shotId)))
        .map((shot) => ({ shotId: shot.shotId, price: shotPrices.get(shot.shotId) ?? { known: false as const } }))
      : [{ shotId: currentPlan.candidate.candidateId, price: shotPrices.get(currentPlan.candidate.candidateId) ?? { known: false as const } }];
    const affordability = checkSealAffordability({
      shots: orderedShots,
      maxSpend: current.policy.maxSpend,
      existingLiability: [current.budget.reserved, current.budget.actual, current.budget.unsettled],
    });
    if (!affordability.ok) throw new SealBudgetExceededError(affordability.maxAffordableShots, affordability.knownSubtotal, affordability.maxSpend);
    costCertainty = affordability.hasUnknownPrice ? "partial" : "known";
  }
  const authorization = command.payload.authorization === undefined
    ? undefined
    : deriveSealedGenerationAuthorizationState({
        run: current,
        plan: currentPlan,
        topLevelContract: contract,
        ...(sealedShots ? { sealedShots } : {}),
        ...(scope ? { scope } : {}),
        preparation: command.payload.authorization,
        now,
      });
  return {
    run: {
      ...current,
      ...(authorization ? { gates: [...current.gates, authorization.gate], jobs: [...current.jobs, ...authorization.jobs] } : {}),
      generationPlan: {
        ...currentPlan,
        candidate: { ...currentPlan.candidate, sealedContractHash: contract.contractHash },
        contract,
        // 「sealed」= 第一份授权正在等人决定；已经在跑的计划再封一份时保持原状态（批过的镜照样在跑）。
        state: currentPlan.state === "draft" ? "sealed" : currentPlan.state,
        // 这一份授权（信封）住在它自己那道门上（authorization.gate），计划上不再挂一份。
        ...(sealedShots ? { shots: sealedShots.map((shot) => {
          const job = authorization?.jobs.find((candidate) => candidate.metadata?.shotId === shot.shotId);
          return job ? { ...shot, attemptCount: job.attempt } : shot;
        }) } : {}),
        ...(costCertainty ? { costCertainty } : {}),
        updatedAt: now,
      },
      updatedAt: now,
    },
    eventType: "generation.plan.sealed",
    message: currentPlan.operationId,
  };
}
