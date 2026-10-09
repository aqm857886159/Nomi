// 制作流程的「先落节点、再发请求」——唯一准入点（架构③，协调会话 2026-10-08；用户拍板「生成那一刻 = 落画布那一刻」）。
//
// 为什么有它：以前花钱口只看 Run 账本（认领、授权、同意窗口），从不要求这一镜在画布上有节点。确认那一下只做
// best-effort 预落地（落不下照派），单镜还是「先交、后落」，无界面 MCP 从来不落——钱花了，画布上没有这一镜。
//
// 这里只回答一件事：这几镜现在能不能派。能派的发一份「已落地」准入（`LandedShotAdmission`），提交出口
// `submission.start` 没有它就编译不过，拿到了还要按耐久 Run 复核（`assertShotAdmission`）。
// 没节点的镜先请调用方落一次画布（`land`，主进程 → 渲染层 materialize-shots，不再 best-effort）；落完还没节点的
// 就是落地失败——不派，停下原因只在这里写（`recordLandingFailure`，停下原因 `landing_failed`，可重试）。
//
// 调用者：多镜调度器每一趟派发前（开拍 / 继续 / 重做 / 重启恢复都经它）、单镜开拍口 `singleShotProductionStart`、
// 画布单节点生成（来源节点就是落地，`origin.nodeId`）。
import { logWarn } from "../logging/logger";
import { isStoppedRunStatus, runStopReason } from "../shared/productionRunStop";
import type { ProductionRun } from "./productionRunTypes";
import { isUnsubmittedJobStatus, jobMayHaveReachedProvider, latestJobForShot, shotIncluded } from "../shared/productionShotJobs";
import type { ProductionRunRepository } from "./productionRunRepository";

declare const landedShotAdmissionBrand: unique symbol;

/** 「这一镜此刻在画布上有节点」的准入。只有本模块造得出来（品牌类型）；提交出口按耐久 Run 再复核一次。 */
export type LandedShotAdmission = Readonly<{
  projectId: string;
  runId: string;
  /** 单镜 = 顶层候选 id（与落地报文同一个地址约定）。 */
  shotId: string;
  nodeId: string;
}> & { readonly [landedShotAdmissionBrand]: true };

/** 把这个 Run 没落的镜落到画布上；抛错 = 落不下来（项目没开 / 渲染层不在 / 超时）。 */
export type LandShotsOnCanvas = (projectId: string, runId: string) => Promise<void>;

type AdmissionRepository = Pick<ProductionRunRepository, "read" | "execute">;

/** Run 里这一镜的地址：多镜用 shotId；单镜省略时就是顶层候选 id。 */
export function shotAddress(run: Pick<ProductionRun, "generationPlan">, shotId: string | undefined): string | undefined {
  return shotId ?? run.generationPlan?.candidate?.candidateId;
}

/**
 * 这一镜此刻落在画布上的哪个节点（没落 / 节点被拿走 = undefined）。唯一判据，准入与提交出口复核共用。
 * - 画布节点发起的 Run：来源节点就是它（节点先存在，请求才发出）；
 * - 单镜制作 Run：顶层 `nodeId`（`plan.bind-shot-nodes` 写回），且没记 detached；
 * - 多镜：那一镜的 `nodeId`，且没记 detached。
 */
export function landedNodeOf(run: Pick<ProductionRun, "origin" | "generationPlan">, shotId: string | undefined): string | undefined {
  const plan = run.generationPlan;
  const address = shotAddress(run, shotId);
  if (!plan || !address) return undefined;
  if (run.origin.host === "canvas") {
    return address === plan.candidate.candidateId && run.origin.nodeId ? run.origin.nodeId : undefined;
  }
  if (!plan.shots || plan.shots.length === 0) {
    return address === plan.candidate.candidateId && plan.nodeId && plan.canvasDetached !== true ? plan.nodeId : undefined;
  }
  const shot = plan.shots.find((candidate) => candidate.shotId === address);
  return shot?.nodeId && shot.canvasDetached !== true ? shot.nodeId : undefined;
}

function admissionFor(run: ProductionRun, shotId: string, nodeId: string): LandedShotAdmission {
  return { projectId: run.projectId, runId: run.runId, shotId, nodeId } as LandedShotAdmission;
}

function notLanded(shotId: string | undefined): Error {
  return Object.assign(new Error(`shot_not_landed: ${shotId ?? "(single)"}`), { code: "shot_not_landed", reason: "shot_not_landed" });
}

/**
 * 提交出口的复核（第一笔耐久写之前调）：准入必须属于这个 Run、这一镜，而且耐久 Run 此刻仍把这一镜绑在同一个节点上。
 * 伪造、过期（节点后来被删、绑定换了）一律拒——不信调用方，只信账本。
 */
export function assertShotAdmission(run: ProductionRun, shotId: string | undefined, admission: LandedShotAdmission | undefined): void {
  const address = shotAddress(run, shotId);
  const nodeId = landedNodeOf(run, shotId);
  if (!admission || !nodeId || !address
    || admission.projectId !== run.projectId || admission.runId !== run.runId
    || admission.shotId !== address || admission.nodeId !== nodeId) throw notLanded(address);
}

/**
 * 落地失败的唯一写口：Run 停在 needs_attention，原因 `landing_failed`（可重试：「继续」/ 重来一次 = 重落再派）。
 * 已经因为别的原因停着的不改写（那个原因更早、更具体）。单镜 Run 还在草稿时先走合法的 draft → running 再停。
 */
export function recordLandingFailure(repository: AdmissionRepository, projectId: string, runId: string, now: () => string): void {
  let run = repository.read(projectId, runId);
  if (!run || isStoppedRunStatus(run.status) || run.status === "completed") return;
  if (run.status !== "running") {
    run = repository.execute(projectId, runId, {
      commandId: `land-first:${runId}:running:${run.revision}`, expectedRevision: run.revision,
      type: "run.status", payload: { status: "running" }, issuedAt: now(),
    }).run;
  }
  repository.execute(projectId, runId, {
    commandId: `land-first:${runId}:landing-failed:${run.revision}`, expectedRevision: run.revision,
    type: "run.status", payload: { status: "needs_attention", reason: "landing_failed" }, issuedAt: now(),
  });
}

/** 这一趟要派的镜全落下了，而 Run 正因为落地失败停着：解除这次停下（重来一次 = 重落再派）。别的停下原因不碰。 */
export function liftLandingFailure(repository: AdmissionRepository, projectId: string, runId: string, now: () => string): void {
  const run = repository.read(projectId, runId);
  if (!run || runStopReason(run) !== "landing_failed") return;
  repository.execute(projectId, runId, {
    commandId: `land-first:${runId}:lift:${run.revision}`, expectedRevision: run.revision,
    type: "run.status", payload: { status: "running" }, issuedAt: now(),
  });
}

export type ShotAdmissionOutcome = Readonly<{
  /** shotId（单镜 = 候选 id）→ 准入。 */
  admitted: ReadonlyMap<string, LandedShotAdmission>;
  /** 落完仍没有节点的镜：这一次不派。 */
  unlanded: readonly string[];
  /** 落地器为什么没落下来（给回 Agent 的那句话用；项目没打开时带项目名）。 */
  landingFailure?: LandingFailure;
}>;

export type LandingFailure = Readonly<{ code: string; projectId: string; projectName?: string }>;

function landingFailureOf(error: unknown, projectId: string): LandingFailure {
  const value = (error && typeof error === "object" ? error : {}) as { code?: unknown; projectName?: unknown };
  return {
    code: typeof value.code === "string" && value.code ? value.code : "canvas_landing_failed",
    projectId,
    ...(typeof value.projectName === "string" && value.projectName ? { projectName: value.projectName } : {}),
  };
}

/**
 * 唯一准入：读 Run → 没节点的镜先落一次画布 → 重读 → 有节点的发准入，其余报回来（调用方据此不派、记落地失败）。
 * 已经全落下的不再打扰渲染层。落地失败不抛（如实报回），读不到 Run 才抛。
 */
export async function admitShotsForDispatch(input: Readonly<{
  repository: Pick<ProductionRunRepository, "read">;
  land: LandShotsOnCanvas;
  projectId: string;
  runId: string;
  /** 要派的镜；单镜传 `[undefined]`（地址 = 候选 id）。 */
  shotIds: readonly (string | undefined)[];
}>): Promise<ShotAdmissionOutcome> {
  const readRun = (): ProductionRun => {
    const run = input.repository.read(input.projectId, input.runId);
    if (!run) throw new Error(`Production run not found: ${input.runId}`);
    return run;
  };
  let run = readRun();
  const addresses = [...new Set(input.shotIds.map((shotId) => shotAddress(run, shotId)).filter((address): address is string => Boolean(address)))];
  let landingFailure: LandingFailure | undefined;
  // 这一次要落的镜。落地器抛了（包括写回绑定之后租约才失效的那一种），这几镜这一趟一律算没落下——
  // 哪怕绑定已经写进了 Run：落地没在租约之内完成，就不派（下一次「继续」认那个已绑的节点再派）。
  const needed = new Set(addresses.filter((address) => !landedNodeOf(run, address)));
  if (needed.size > 0) {
    try {
      await input.land(input.projectId, input.runId);
    } catch (error) {
      landingFailure = landingFailureOf(error, input.projectId);
      logWarn("production-run", "land-first-landing-failed", { runId: input.runId, code: landingFailure.code }, error);
    }
    run = readRun();
  }
  const admitted = new Map<string, LandedShotAdmission>();
  const unlanded: string[] = [];
  for (const address of addresses) {
    const nodeId = landingFailure && needed.has(address) ? undefined : landedNodeOf(run, address);
    if (nodeId) admitted.set(address, admissionFor(run, address, nodeId));
    else unlanded.push(address);
  }
  return { admitted, unlanded, ...(unlanded.length > 0 ? { landingFailure: landingFailure ?? { code: "canvas_landing_failed", projectId: input.projectId } } : {}) };
}

/** 一镜在「发出 / 没放上」那一句里怎么称呼：作者起的标题，或它在计划里的序号（第 N 镜）。 */
export type LandingShotRef = Readonly<{ shotId: string; index: number; title?: string }>;

export type ShotLandingFacts = Readonly<{
  /** 可能已经到过供应商的镜（唯一判据 jobMayHaveReachedProvider：没写出去 / 当场被拒 / 同意过期没发的都不算）。 */
  sent: readonly LandingShotRef[];
  /** 批过、还没交、画布上也没有节点的镜：这一批里「没放到画布上、没有发出」的那几镜（「继续」会重落再派）。 */
  notPlaced: readonly LandingShotRef[];
  /** 节点被用户从画布上删掉了（记着 detached）的没发的镜：这一批不再派它们，「继续」也不会（删除事实优先）。 */
  removed: readonly LandingShotRef[];
}>;

/**
 * 一批里哪几镜发出了、哪几镜没放到画布上（#1139 B1：按镜头算，不整批说）。只读耐久 Run，回执、Agent 读 Run、
 * 落地失败那一句都读它——「这次没有发出生成请求」只在一镜都没发出时才说。
 */
export function shotLandingFacts(run: ProductionRun): ShotLandingFacts {
  const plan = run.generationPlan;
  if (!plan) return { sent: [], notPlaced: [], removed: [] };
  const shots = plan.shots && plan.shots.length > 0
    ? plan.shots.filter(shotIncluded).map((shot, index) => ({ shotId: shot.shotId, index: index + 1, ...(shot.title?.trim() ? { title: shot.title.trim() } : {}) }))
    : [{ shotId: plan.candidate.candidateId, index: 1 }];
  const sent: LandingShotRef[] = [];
  const notPlaced: LandingShotRef[] = [];
  const removed: LandingShotRef[] = [];
  for (const shot of shots) {
    const job = latestJobForShot(run, shot.shotId) ?? (plan.shots?.length ? undefined : run.jobs[run.jobs.length - 1]);
    if (job && jobMayHaveReachedProvider(job)) sent.push(shot);
    else if (shotRemovedFromCanvas(run, shot.shotId)) removed.push(shot);
    else if (!landedNodeOf(run, shot.shotId)) notPlaced.push(shot);
  }
  return { sent, notPlaced, removed };
}

/** 这几镜在计划里的称呼（序号按勾进这一批的镜数，与 shotLandingFacts 同一套）。 */
export function landingShotRefs(run: ProductionRun, shotIds: readonly string[]): LandingShotRef[] {
  const plan = run.generationPlan;
  const included = plan?.shots && plan.shots.length > 0 ? plan.shots.filter(shotIncluded) : [];
  return shotIds.map((shotId) => {
    const at = included.findIndex((shot) => shot.shotId === shotId);
    const title = at >= 0 ? included[at].title?.trim() : undefined;
    return { shotId, index: at >= 0 ? at + 1 : 1, ...(title ? { title } : {}) };
  });
}

/** 用户把这一镜的节点从画布上删掉了（Run 记着 detached）：制作流程不再派它（认领判据 canvas_detached），也不会替他再落。 */
export function shotRemovedFromCanvas(run: Pick<ProductionRun, "generationPlan">, shotId: string): boolean {
  const plan = run.generationPlan;
  if (!plan) return false;
  if (!plan.shots || plan.shots.length === 0) return plan.canvasDetached === true && plan.candidate.candidateId === shotId;
  return plan.shots.some((shot) => shot.shotId === shotId && shot.canvasDetached === true);
}

/**
 * 这一批里批过、还没交、制作流程还会派的镜（有任务、最新一次还停在已授权之前、节点没被用户删掉）——
 * 开拍 / 继续那一刻要先落画布、随后要派的就是它们。
 */
export function shotsAwaitingDispatch(run: ProductionRun): string[] {
  const shots = run.generationPlan?.shots ?? [];
  return shots.filter(shotIncluded).map((shot) => shot.shotId).filter((shotId) => !shotRemovedFromCanvas(run, shotId)).filter((shotId) => {
    const job = latestJobForShot(run, shotId);
    return Boolean(job && isUnsubmittedJobStatus(job.status));
  });
}
