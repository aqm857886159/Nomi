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


/**
 * 卡上换了模型之后，把**用户这一下亲手选中的**供应商/模型放进 Run 的白名单。
 *
 * 白名单原本为什么拦得住它：Run 的 policy 是**建草稿那一刻**从候选身份冻下来的
 * （`productionGenerationOperationStore.create`）。冻它是为了「后面再来的命令不能
 * 偷偷换掉 host/provider/model」——那道闸防的是 **agent**，而 agent 改候选走的是
 * `generation.patch`，本函数碰不到那条路。
 *
 * 但付费卡上那个模型下拉是**真人当场按下去的**：`generation.revise` 只有这一个入口
 * （`appIntegrationSpendConfirm` ← IPC `nomi:production-runs:revise-spend` ← 有窗口
 * 代表真人的渲染层）。用一道防 agent 的闸去拦真人自己的选择，用户看到的是一句
 * 「模型未加入白名单」，而他做的只是在卡上换了个模型（#748 已知缺口）。
 *
 * 放行的边界是**同一个任务类别**（`candidate.mode` = 目录任务种类，如 `text-to-image`）：
 * 卡上那个下拉本来就只列同类别的模型，而跨类别（图 → 视频）换掉的是整个花钱量级，
 * 那不叫「改一下」。所以类别一变就不放行——白名单照旧挡下，fail-closed；
 * 凭空多出来的镜同理（`before` 里找不到它，就不是「改」）。
 *
 * 放行的只是**判据里的身份**，不是那笔钱：`maxSpend`、收据、决门、封印一个都没动，
 * 换完模型仍要重新计价、重新出卡、重新由真人按一次（`generation.revise` 已撤旧授权）。
 */
export function policyAdmittingUserRevisedIdentity(
  policy: ProductionRun["policy"],
  before: ProductionGenerationPlan,
  after: ProductionGenerationPlan,
): ProductionRun["policy"] {
  const was = candidateIdentities(before);
  const providers = new Set(policy.allowedProviders);
  const models = new Set(policy.allowedModels);
  let widened = false;
  for (const [key, next] of candidateIdentities(after)) {
    const previous = was.get(key);
    if (!previous || previous.mode !== next.mode) continue;
    if (next.providerId && !providers.has(next.providerId)) { providers.add(next.providerId); widened = true; }
    if (next.modelId && !models.has(next.modelId)) { models.add(next.modelId); widened = true; }
  }
  if (!widened) return policy;
  return { ...policy, allowedProviders: [...providers], allowedModels: [...models] };
}

/** 计划里每一份候选的身份，按「镜」寻址（顶层那份用 `@plan`，它是单镜旧形态的默认镜）。 */
function candidateIdentities(
  plan: ProductionGenerationPlan,
): Map<string, Pick<ProductionGenerationShot["candidate"], "mode" | "providerId" | "modelId">> {
  const entries = new Map<string, Pick<ProductionGenerationShot["candidate"], "mode" | "providerId" | "modelId">>();
  const put = (key: string, candidate: ProductionGenerationShot["candidate"]): void => {
    entries.set(key, { mode: candidate.mode, providerId: candidate.providerId, modelId: candidate.modelId });
  };
  put("@plan", plan.candidate);
  for (const shot of plan.shots ?? []) put(shot.shotId, shot.candidate);
  return entries;
}
