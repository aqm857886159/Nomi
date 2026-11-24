// 「直接生成」档的两个刹车 + 带 Run 的付费代答入口（2026-10-12 用户拍板）。
//
// 用户原话：「不设固定次数，只在同一镜头连续失败重试超过 2 次、或超出它说好的计划时才停。」
// 所以这里**没有任何次数 / 张数 / 金额上限**，只有两个会让这一次决定退回「请求批准」确认路径的事实：
//   ① retry-limit  —— 同一镜连续失败满 3 次（失败 1、2 次后各自动重试一次，第 3 次失败后、第 3 次重试之前停）。
//   ② out-of-plan  —— 这个 Run 里已经有镜被批过了（= 说好的计划），而这一次要代答的是计划外的新镜。
// 外加不属于刹车、但同一处判的：③ stopped —— 用户点了停止（Run 停着），不替用户续跑。
//
// ── 为什么它是纯函数、而且不存任何状态 ──
//
//   · 「说好的计划」不另存第二份：它就是 Run 上**曾经**有过 job 的那些镜（`jobsForShot`，概念 production.shot-jobs）——
//     历史事实，去掉的镜（included=false）也算（独立验收 V-1203 F1）。用户点「继续」放行计划外那一镜 → 走正常确认卡 →
//     这一镜有了 job → 自然进了计划（拍板 5），没有要维护的基线。
//   · 「连续失败数」每次从 job 派生：只数可能已到过供应商的失败（`jobMayHaveReachedProvider`，既有判据；提交前断网这类
//     没写出去的不计、也不重置），遇到成功就清零，数到一次**人批**的尝试就停（含它）。「人批」也是事实：批这次尝试的
//     付费门属于哪一次出价、那次出价是不是由人在卡上点的（`attemptApprovedByHuman`）。不靠失败数取模去猜人点过没有。
//
// ── 刹车放在哪 ──
//
// 只放在**策略代批那一个点**（`spendDecisionByPolicy`）：刹车成立 = 这一次决定退回「请求批准」的正常路径
// （报价卡照旧摆出来等人点，收据由真人手势铸）。**不**在派发闸上加第二道兜底（P1：无并行版）。三个入口
// （`generationTransportAdapters` 两处、`generationDispatcher` 一处）都问这个函数，不各判各的。
import type { ProductionJob, ProductionRun } from "../../productionRun/productionRunTypes";
import { jobMayHaveReachedProvider, jobsForShot } from "../productionShotJobs";
import { productionJobPhase } from "../productionShotPhase";
import { isStoppedRunStatus } from "../productionRunStop";
import { currentPresentation } from "../productionGenerationPresentation";
import { spendAuthorizationGates } from "../productionSpendAuthority";
import { spendDecidedByPolicy, type ProjectAgentApprovalMode, type ProjectAgentApprovalPolicy } from "./capabilityApprovalPolicy";

/** 同一镜连续失败这么多次，第 N 次重试之前停（用户拍板：重试超过 2 次 = 第 3 次失败后停）。 */
const DIRECT_GENERATION_RETRY_LIMIT = 3;

type DirectGenerationBrakeReason = "stopped" | "retry-limit" | "out-of-plan";

type DirectGenerationBrakeInput = Readonly<{
  tier: ProjectAgentApprovalMode;
  /** 已经说好的计划里有哪些镜。空 = 还没有计划（第一次代批），不存在计划外。 */
  plannedShotIds: readonly string[];
  stopped: boolean;
  shotId: string;
  /** 这一镜从上一次**人批**之后连续失败了几次（`consecutiveFailedAttempts`，从事实数，不取模）。 */
  consecutiveFailures: number;
}>;

type DirectGenerationBrakeResult = Readonly<{ allow: true } | { allow: false; reason: DirectGenerationBrakeReason }>;

/**
 * 单镜判定。停止键与挡位无关（两档都生效）；两个刹车只在 `direct` 档生效——
 * `request` 档每次本来就问，不重复打断。
 */
export function directGenerationBrake(input: DirectGenerationBrakeInput): DirectGenerationBrakeResult {
  if (input.stopped) return { allow: false, reason: "stopped" };
  if (input.tier !== "direct") return { allow: true };
  if (input.plannedShotIds.length > 0 && !input.plannedShotIds.includes(input.shotId)) {
    return { allow: false, reason: "out-of-plan" };
  }
  if (input.consecutiveFailures >= DIRECT_GENERATION_RETRY_LIMIT) {
    return { allow: false, reason: "retry-limit" };
  }
  return { allow: true };
}

/**
 * 交给画布的那几镜在画布单镜 Run 里的尝试（D2 第③步：一台发动机）。卡 / 策略交出去的镜，制作 Run 自己没有 job——
 * 它的尝试住在画布那一个单镜 Run 里。`byHuman` = 那一笔交接是人点的（卡上的「生成」/「再试一次」）。
 * 键 = shotId。由 `withHandedOverAttempts` 按交接记录读出来，不另存。
 */
type HandedOverAttempt = Readonly<{ job: ProductionJob; byHuman: boolean }>;

type RunFacts = Pick<ProductionRun, "generationPlan" | "jobs"> & Partial<Pick<ProductionRun, "status" | "gates">> & Readonly<{
  handedOverAttempts?: ReadonlyMap<string, readonly HandedOverAttempt[]>;
}>;

/**
 * 刹车要看的事实：制作 Run 本身 + 它交给画布的那几镜在画布单镜 Run 里的尝试。读不到的画布 Run 跳过（只会让刹车少看一次失败，
 * 那一镜的交接记录本身仍在——它算进「说好的计划」）。
 */
export function withHandedOverAttempts<T extends RunFacts>(run: T, readCanvasRun: (runId: string) => Pick<ProductionRun, "jobs"> | null | undefined): T {
  const attempts = new Map<string, HandedOverAttempt[]>();
  for (const presentation of run.generationPlan?.presentations ?? []) {
    for (const handOver of presentation.handOvers ?? []) {
      if (!handOver.canvasRunId) continue;
      const canvas = readCanvasRun(handOver.canvasRunId);
      const list = attempts.get(handOver.shotId) ?? [];
      for (const job of canvas?.jobs ?? []) if (job.stageId === "generate") list.push({ job, byHuman: handOver.by === "gesture" });
      attempts.set(handOver.shotId, list);
    }
  }
  return attempts.size > 0 ? { ...run, handedOverAttempts: attempts } : run;
}

type Attempt = HandedOverAttempt;

/** 这一镜的全部尝试（制作 Run 的 job + 交给画布的那几次），从早到晚。没有交给画布过的镜与改动前逐字相同。 */
function attemptsOf(run: RunFacts, shotId: string): Attempt[] {
  const own = jobsForShot(run as ProductionRun, shotId)
    .slice()
    .sort((a, b) => (a.attempt - b.attempt) || (Date.parse(a.createdAt) - Date.parse(b.createdAt)))
    .map((job) => ({ job, byHuman: attemptApprovedByHuman(run, job) }));
  const handed = run.handedOverAttempts?.get(shotId) ?? [];
  if (handed.length === 0) return own;
  return [...own, ...handed].sort((a, b) => Date.parse(a.job.createdAt) - Date.parse(b.job.createdAt));
}

/** 这次尝试结束在失败上（含提交结果未知）——不管有没有到过供应商。 */
function endedInFailure(job: ProductionJob): boolean {
  return productionJobPhase(job.status) === "failed" || job.status === "submission_unknown";
}

function failedForBrake(job: ProductionJob): boolean {
  return endedInFailure(job) && jobMayHaveReachedProvider(job);
}

/**
 * 这次尝试是不是**真人在卡上批的**（事实，不是猜）。job → 批它的那道付费门（`authorizationDigest`）→ 那道门属于哪一次出价
 * （出价的 `fromGate`：在它之后、下一次出价之前建的门）→ 那一次出价是谁决定的：
 *   · 出价时档位不是「直接生成」→ 每次都是人点的；
 *   · 「直接生成」下代答失败或刹车退回（`policyDecisionState: "failed"`）→ 卡摆出来，是人点的；
 *   · 其余（档位代答）→ 不是人批的。
 * 认不出（旧数据没有门 / 没有出价记录）一律按「不是人批的」——只会让刹车多停一次，不会少停。
 */
function attemptApprovedByHuman(run: RunFacts, job: ProductionJob): boolean {
  if (!job.authorizationDigest) return false;
  const gateIndex = spendAuthorizationGates({ gates: run.gates ?? [] }).findIndex((gate) => gate.authorizationDigest === job.authorizationDigest);
  if (gateIndex < 0) return false;
  const presentation = (run.generationPlan?.presentations ?? []).filter((entry) => entry.fromGate <= gateIndex).at(-1);
  if (!presentation?.policySnapshot) return false;
  return presentation.policySnapshot.mode !== "direct" || presentation.policyDecisionState === "failed";
}

/**
 * 这一镜从上一次**人批**之后连续失败了几次。成功清零；没写出去的失败既不计也不重置；数到一次人批的尝试就停在它
 * （含它本身）——那就是用户拍板的「点继续之后从这次确认重新数」，读的是事实，不靠失败数取模去猜人点过没有。
 */
export function consecutiveFailedAttempts(run: RunFacts, shotId: string): number {
  const attempts = attemptsOf(run, shotId);
  let count = 0;
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const { job, byHuman } = attempts[index];
    // 没写出去的失败不计也不重置——但如果这次尝试是人批的，人批这件事本身就是计数的起点（V-1203 复验 R2）。
    if (endedInFailure(job) && !jobMayHaveReachedProvider(job)) {
      if (byHuman) break;
      continue;
    }
    if (!failedForBrake(job)) break;
    count += 1;
    if (byHuman) break;
  }
  return count;
}

/** 这个 Run 里此刻纳入批次的单元（多镜 = 纳入的镜；单镜旧形状 = 候选 id）。只用来圈「这一次要决定哪几镜」。 */
function includedUnitsOf(run: RunFacts): string[] {
  const shots = run.generationPlan?.shots;
  if (shots?.length) return shots.filter((shot) => shot.included !== false).map((shot) => shot.shotId);
  const single = run.generationPlan?.candidate?.candidateId;
  return single ? [single] : [];
}

/** 计划里出现过的每一镜，不管此刻纳不纳入批次（去掉的镜也在）。 */
function everyUnitOf(run: RunFacts): string[] {
  const shots = run.generationPlan?.shots;
  if (shots?.length) return shots.map((shot) => shot.shotId);
  const single = run.generationPlan?.candidate?.candidateId;
  return single ? [single] : [];
}

/**
 * 「说好的计划」：这个 Run 里**曾经**有过 job（= 被批过）的那些镜——历史事实，不看此刻纳不纳入批次。
 * 用户在卡上去掉一镜、或候选补丁把它移出这一批（`included: false`），它批过的事实不会消失；
 * 否则「去掉旧镜 → 计划变空 → 同一 Run 里补的新镜被当成第一次代批放行」（独立验收 V-1203 F1）。
 */
export function plannedShotIdsFromJobs(run: RunFacts): string[] {
  return everyUnitOf(run).filter((shotId) => attemptsOf(run, shotId).length > 0);
}

/**
 * 这一次代答要决定的是哪几镜：就是这一次出价摆出来的那几镜（`currentPresentation().shotIds`，出价的唯一 owner）。
 * 没有出价记录（旧形状 / 夹具）时退回整份计划。不看出价范围的话，一个早就被晾在一边的失败镜会让之后每一次
 * 不相干的出价都停下来问——那是把刹车装在了别的镜头上。
 */
function unitsInDecision(run: RunFacts): string[] {
  const scope = currentPresentation(run.generationPlan)?.shotIds;
  if (!scope?.length) return includedUnitsOf(run);
  const units = new Set(includedUnitsOf(run));
  return scope.filter((shotId) => units.has(shotId));
}

export type DirectGenerationRunBrake = Readonly<{ reason: DirectGenerationBrakeReason; shotId?: string }>;

/** 对这一次出价判一次：摆出来的镜里任何一个触发刹车就停（返回触发的那个）。 */
export function directGenerationBrakeForRun(
  policy: ProjectAgentApprovalPolicy | undefined,
  run: RunFacts | undefined,
): DirectGenerationRunBrake | undefined {
  if (!run) return undefined;
  const tier: ProjectAgentApprovalMode = spendDecidedByPolicy(policy) ? "direct" : "request";
  const stopped = run.status !== undefined && isStoppedRunStatus(run.status);
  const planned = plannedShotIdsFromJobs(run);
  for (const shotId of unitsInDecision(run)) {
    // 只有「还没被批过的新镜」和「最近一次尝试失败了、等着重试的镜」需要这一次代答；在跑 / 已完成 / 已批待派的不需要。
    // 最近一次失败没到过供应商也算等着重试（V-1203：原来按「到过供应商的失败」判，这种镜被跳过，刹车失明）。
    const latest = attemptsOf(run, shotId).at(-1)?.job;
    if (latest && !endedInFailure(latest)) continue;
    const verdict = directGenerationBrake({
      tier, plannedShotIds: planned, stopped, shotId, consecutiveFailures: consecutiveFailedAttempts(run, shotId),
    });
    if (!verdict.allow) return { reason: verdict.reason, shotId };
  }
  return undefined;
}

export type SpendDecisionByPolicy = Readonly<{ decided: true } | { decided: false; brake?: DirectGenerationRunBrake }>;

/**
 * 「这一笔付费，档位代答还是退回确认卡？」——**带 Run 的入口只问这一个函数**。
 * `request` 档 → 未代答（无刹车说明）；`direct` 档 → 先问刹车，成立则未代答并带上原因，否则代答。
 * 读不到 Run（没有读口 / 草稿还没落盘）时只剩档位这一问——停止与计划无从判，按刹车不成立处理，
 * 与改动前的行为逐字相同。
 */
export function spendDecisionByPolicy(
  policy: ProjectAgentApprovalPolicy | undefined,
  /** 惰性：`request` 档不需要看 Run，也就不去读盘。 */
  run: RunFacts | undefined | (() => RunFacts | undefined),
): SpendDecisionByPolicy {
  if (!spendDecidedByPolicy(policy)) return { decided: false };
  const brake = directGenerationBrakeForRun(policy, typeof run === "function" ? run() : run);
  return brake ? { decided: false, brake } : { decided: true };
}
