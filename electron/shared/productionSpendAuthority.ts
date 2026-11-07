// 「这一笔由哪一份授权盖着」的唯一问法（2026-09-30，付费卡逐镜）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 一个 Run 以前只有**一份**授权（计划上那份信封），派发时每个 job 都拿它来核。于是：
//   · 「只批这一镜」只能靠把别的镜从这一批里删掉来实现——卡上第 2 镜悄悄消失（用户实见 U01）；
//   · 第 1 镜批了还在排队时再批第 2 镜，新的一份会替掉旧的，排在前面的镜就失去了授权
//     （所以重做以前得等「之前批过的都已发出」）。
//
// 现在每点一次封一份只盖那一次点到的镜头的授权，**信封存在它自己那道门上**。派发、决门、重做沿用参考图，
// 都经这里按 job 上记的授权摘要找到「批它的那道门」，不再问计划要一份。
import type { ProductionGenerationAuthorizationEnvelopeV1 } from "../productionRun/productionGenerationAuthorization";
import type { ProductionGate, ProductionJob, ProductionRun } from "../productionRun/productionRunTypes";

export type SpendAuthorizationGate = ProductionGate & Readonly<{
  authorizationDigest: string;
  authorizationEnvelope: ProductionGenerationAuthorizationEnvelopeV1;
}>;

/** 上一版把授权挂在计划上的那几格（2026-09-30 起不再写）。只在读旧 Run 时出现。 */
const LEGACY_PLAN_AUTHORIZATION_FIELDS = [
  "authorizationEnvelope", "authorizationDigest", "authorizationGateId",
  "approvedReceiptId", "approvedAt", "approvedAttempt", "planHash",
] as const;

/**
 * 旧 Run（计划上挂着一份信封）→ 现在的形状（信封住在它自己那道门上）。**唯一归一点**：仓库读快照、
 * 历史按事件快照找冻住的合同，都先过这里。纯函数，不改入参；已经是新形状就原样返回同一个对象。
 *
 * 旧版每次重做 / 续额度都会替掉计划上那一份，所以更早几轮的门在旧快照里没有信封——那几轮的 job 当时就要求
 * 「都已发出」才肯替，派发用不到它们；按事件快照找历史合同时，每一张旧快照各自归一，各自那一轮的门拿得到。
 */
export function normalizeLegacySpendAuthority<T extends Pick<ProductionRun, "gates" | "generationPlan">>(run: T): T {
  const plan = run.generationPlan as (Record<string, unknown> & NonNullable<ProductionRun["generationPlan"]>) | undefined;
  if (!plan || !LEGACY_PLAN_AUTHORIZATION_FIELDS.some((field) => field in plan)) return run;
  const envelope = plan.authorizationEnvelope as ProductionGenerationAuthorizationEnvelopeV1 | undefined;
  const gateId = typeof plan.authorizationGateId === "string" ? plan.authorizationGateId : undefined;
  const gates = envelope && gateId
    ? run.gates.map((gate) => gate.gateId === gateId && !gate.authorizationEnvelope ? { ...gate, authorizationEnvelope: envelope } : gate)
    : run.gates;
  const cleaned: Record<string, unknown> = { ...plan };
  for (const field of LEGACY_PLAN_AUTHORIZATION_FIELDS) delete cleaned[field];
  return { ...run, gates, generationPlan: cleaned as unknown as ProductionRun["generationPlan"] };
}

/** 付费生成门：`budget_envelope` 且带着冻住的信封。别的门（形象检查点、导出、方向）都不算。 */
export function isSpendAuthorizationGate(gate: ProductionGate): gate is SpendAuthorizationGate {
  return gate.scope === "budget_envelope"
    && typeof gate.authorizationDigest === "string"
    && gate.authorizationDigest.length > 0
    && Boolean(gate.authorizationEnvelope);
}

/** 这个 Run 上所有付费生成门（按建门先后）。 */
export function spendAuthorizationGates(run: Pick<ProductionRun, "gates">): SpendAuthorizationGate[] {
  // 渲染层与测试里的投影可能是一份不带门的局部 Run：没有门 = 没有任何一份授权。
  return (run.gates ?? []).filter(isSpendAuthorizationGate);
}

/**
 * 最近一份授权的摘要（按建门先后的最后一道）。只用来给调度器的幂等命令号分轮次：续额度会用同一批 jobId
 * 再授权一次，命令号不随授权换一轮，就会被当成上一轮的重放吞掉。不是判据——判据永远是「批这个 job 的那道门」。
 */
export function latestSpendAuthorizationDigest(run: Pick<ProductionRun, "gates">): string | undefined {
  return spendAuthorizationGates(run).at(-1)?.authorizationDigest;
}

/** 批这个 job 的那道门：job 上记的授权摘要就是那道门的摘要。找不到 = 这个 job 没有被任何一份授权盖着。 */
export function authorizationGateForJob(
  run: Pick<ProductionRun, "gates">,
  job: Pick<ProductionJob, "authorizationDigest">,
): SpendAuthorizationGate | undefined {
  if (!job.authorizationDigest) return undefined;
  return spendAuthorizationGates(run).find((gate) => gate.authorizationDigest === job.authorizationDigest);
}

/** 还在等人决定的付费门。可能不止一道：卡上这一次点的、重做那一镜的、外部宿主那一整份，各自一道。 */
export function waitingAuthorizationGates(run: Pick<ProductionRun, "gates">): SpendAuthorizationGate[] {
  return spendAuthorizationGates(run).filter((gate) => gate.status === "waiting");
}

/** 盖着这一镜、还在等人决定的那道门（没有 = 这一镜此刻没有待决的授权）。 */
export function waitingAuthorizationGateForShot(run: Pick<ProductionRun, "gates">, shotId: string): SpendAuthorizationGate | undefined {
  return waitingAuthorizationGates(run).find((gate) => gate.authorizationEnvelope.jobs.some((job) => job.shotId === shotId));
}

/**
 * 这份合同上一次被批准时冻住的参考图 URL。重做**默认**沿用它：同一份合同、同一批参考，不因为「又一份授权」
 * 去重新上传一遍。
 *
 * 但这是默认，不是必须：重做是又一份自带信封的授权，线上报文哈希按**这一份授权自己的**链接算、派发时也按它自己的核，
 * 重新换过的链接不会被「报文对不上」拒发（`prepareProductionGenerationReauthorization` 的 `referenceUrls`，
 * 由 `reworkReferenceUrls` 在「这条连接拒绝过」或「冻住的链接明确失效」时给）；重做校验只钉 `references`，不钉链接。
 */
export function authorizedReferenceUrls(
  run: Pick<ProductionRun, "gates">,
  contractHash: string,
): Readonly<Record<string, string>> | undefined {
  const gates = spendAuthorizationGates(run);
  for (let index = gates.length - 1; index >= 0; index -= 1) {
    const job = gates[index].authorizationEnvelope.jobs.find((candidate) => candidate.contractHash === contractHash);
    if (job?.referenceUrls) return job.referenceUrls;
  }
  return undefined;
}
