// 生成计划的**候选补丁**与**撤未点头的授权**（`generation.patch` / `generation.revise` /
// `generation.trial_narrow` 三条命令共用的那一段写法）。
//
// 为什么单独一层：这三条命令改的是同一份候选、撤的是同一道门，差别只在「进来之前允不允许它还封着」
// 和「改了什么」。各写各的代价不是重复，而是**三份会漂**——`revise` 少 clone 一次 parameters，
// 就会出现「卡上改了时长、封的还是旧值」这种只在钱上看得见的错。
//
// 抽出来的第二个理由是体积：reducer 是这个域的调度中心，每条命令都往里挤会把它撑成一个谁都不敢改的
// 巨壳（R9/R12）。命令的**判据**留在 reducer（那是它的活），命令的**手法**住这里。
import type {
  ProductionGate,
  ProductionGenerationPlan,
  ProductionGenerationShot,
  ProductionJob,
  ProductionRun,
  RunCommand,
} from "./productionRunTypes";

/** Update one shot inside a plan by id; throws if the plan has no such shot. */
export function replaceShot(
  plan: ProductionGenerationPlan,
  shotId: string,
  update: (shot: ProductionGenerationShot) => ProductionGenerationShot,
): ProductionGenerationShot[] {
  const shots = plan.shots ?? [];
  let found = false;
  const next = shots.map((shot) => {
    if (shot.shotId !== shotId) return shot;
    found = true;
    return update(shot);
  });
  if (!found) throw new Error(`Generation shot not found: ${shotId}`);
  return next;
}

function record(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${key}`);
  return value as Record<string, unknown>;
}

/**
 * 把一次候选补丁落到计划上（`generation.patch` 与 `generation.revise` 共用的**同一段**写法）。
 *
 * 为什么抽出来：两条命令改的是同一份候选，差别只在「进来之前允不允许它还封着」。
 * 各写一份的代价不是重复，而是**两份会漂**——`revise` 少 clone 一次 parameters，
 * 就会出现「卡上改了时长、封的还是旧值」这种只在钱上看得见的错。
 */
/**
 * 撤掉一份**还没被人点头**的付费授权，把计划退回可编辑的 draft。
 *
 * `generation.trial_narrow`（试拍首镜）与 `generation.revise`（卡上改参数）改的都是
 * 「供应商真正会收到的那份载荷」，因此都必须走同一条路：撤授权 → 回 draft →
 * 重新 prepare/seal/gate 生成**新的** digest。差别只在改了什么，不在怎么撤。
 *
 * 不变量：**收据 = 实际执行**。旧 digest 上的 job 一律丢弃，旧 gate 置 `revoked`；
 * 任何一个 job 越过 `authorization_required` 就说明这份授权已经开始执行，此时改载荷
 * 会让「用户点头的那张单」和「真正跑的那一次」分叉，所以直接拒绝。
 */
export function revokeWaitingGenerationAuthorization(
  current: ProductionRun,
  plan: ProductionGenerationPlan,
  now: string,
  what: string,
): Readonly<{ gates: ProductionGate[]; jobs: ProductionJob[]; planVersion: number }> {
  if (!plan.authorizationDigest || !plan.authorizationGateId) {
    throw new Error(`${what} requires an authorized generation plan`);
  }
  const authorizationGate = current.gates.find((gate) => gate.gateId === plan.authorizationGateId);
  if (!authorizationGate || authorizationGate.status !== "waiting") {
    throw new Error(`${what} is available only before the spend gate is decided`);
  }
  const abandonedJobs = current.jobs.filter((job) => job.authorizationDigest === plan.authorizationDigest);
  if (abandonedJobs.some((job) => job.status !== "authorization_required")) {
    throw new Error(`${what} cannot replace an authorization that has begun execution`);
  }
  return {
    gates: current.gates.map((gate) => gate.gateId === authorizationGate.gateId
      ? { ...gate, status: "revoked" as const, decidedAt: now }
      : gate),
    jobs: current.jobs.filter((job) => job.authorizationDigest !== plan.authorizationDigest),
    planVersion: current.planVersion + 1,
  };
}

/** 计划上所有「封印/授权」字段的清零点。加字段时只有这一处要跟着改。 */
export function unsealedGenerationPlanFields(plan: ProductionGenerationPlan, now: string): ProductionGenerationPlan {
  return {
    ...plan,
    state: "draft",
    candidate: { ...plan.candidate, sealedContractHash: undefined },
    contract: undefined,
    planHash: undefined,
    authorizationEnvelope: undefined,
    authorizationDigest: undefined,
    authorizationGateId: undefined,
    approvedReceiptId: undefined,
    approvedAt: undefined,
    approvedAttempt: undefined,
    costCertainty: undefined,
    updatedAt: now,
  };
}

export function applyGenerationCandidatePatch(
  plan: ProductionGenerationPlan,
  command: RunCommand,
  now: string,
): ProductionGenerationPlan {
  const patch = record(command.payload, "patch") as Partial<ProductionGenerationShot["candidate"]>;
  const rawShotId = typeof command.payload.shotId === "string" ? command.payload.shotId.trim() : "";
  const shotId = rawShotId || undefined;
  if (shotId) {
    const hasIncluded = typeof command.payload.included === "boolean";
    const shots = replaceShot(plan, shotId, (shot) => ({
      ...shot,
      candidate: {
        ...shot.candidate,
        ...patch,
        revision: shot.candidate.revision + 1,
        parameters: patch.parameters ? structuredClone(patch.parameters) : structuredClone(shot.candidate.parameters),
        references: patch.references ? structuredClone(patch.references) : structuredClone(shot.candidate.references),
      },
      ...(hasIncluded ? { included: command.payload.included as boolean } : {}),
      updatedAt: now,
    }));
    return { ...plan, shots, updatedAt: now };
  }
  const candidate = {
    ...plan.candidate,
    ...patch,
    revision: plan.candidate.revision + 1,
    parameters: patch.parameters ? structuredClone(patch.parameters) : structuredClone(plan.candidate.parameters),
    references: patch.references ? structuredClone(patch.references) : structuredClone(plan.candidate.references),
  };
  return { ...plan, candidate, updatedAt: now };
}

