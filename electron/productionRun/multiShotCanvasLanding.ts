// P4 S5 — 多镜产物画布落地（主进程编排）。渲染层的落点在 src/workbench/capability/multiShotCanvasLanding.ts；
// 这里只负责：① 从 Run 的 generationPlan.shots 投影出 materialize-shots 载荷（含已完成镜的本地 result）；
// ② 经 requestRenderer 请求渲染层落节点/组；③ 把 shotId→nodeId 绑定经 plan.bind-shot-nodes 写回 Run。
//
// 两种用法（架构③「先落节点、再发请求」，2026-10-08 起）：
//   · 派发前的落地（`landCanvasForRunOrThrow`，经唯一准入点 shotLandingAdmission）：落不下来就抛，这一镜不派；
//   · 派发之后的投影（草稿投影 / Run 跟随 / 打开项目对账，`landCanvasForRun`）：只让画布跟上账本，失败只记 warn。
//
// 幂等（§3.4）：materializationOperationId = `canvas-landing:{runId}`（每 Run 一个稳定 op），跑两次不重复建节点/组。
import { generationShotKind, type GenerationShotKind } from "../shared/generationShotKind";
import { resolveOwnedArtifactFile, safeProjectRelativePath } from "./artifactProjection";
import { localAssetUrl } from "../assets/assetPaths";
import { canvasPreviewFieldsFromReceipt, type CanvasPreviewState } from "../shared/canvas/canvasMediaPreview";
import type { ProductionRun, ProductionGenerationShot } from "./productionRunTypes";
import type { PlanCandidate } from "../capabilityCore/executionContract";
import type { MaterializeShotCandidateWire } from "../shared/canvas/materializeShotCandidate";
import { logInfo, logWarn } from "../logging/logger";
import { deriveProductionShotState, productionRunRecordId } from "../shared/productionShotPhase";

/**
 * 这一镜此刻在节点上该是什么运行状态——**写进节点自己的运行记录**，与普通生成同一份状态、同一套画法
 * （NodeGeneratingOverlay / NodeErrorReport），不再由渲染层另轮询一份 Run 快照、另画一套「整卡模糊 + N 字标」。
 *
 * - running：已交给供应商、还没结论（节点显示普通生成那张等待画面）；
 * - failed：这一镜确定失败（节点显示普通生成那张失败卡，重试走返工链）；
 * - recoverable：已经生成、结果没能取回（节点挂「可找回」，出路只有免费的「重新取回」，不进任何批量生成）；
 * - ended：不在跑（排队 / 已停 / 这一镜的产物投不出来）——节点上若还挂着本制作的「生成中」记录，收掉它。
 * 已完成的镜不带它：带 `result`，回填本身就把那条记录记成成功。
 *
 * `runRecordId` = 节点运行记录的身份，取自这一镜那次任务的 jobId（同一任务反复投影幂等，返工 = 新任务 = 新记录）。
 */
export type MaterializeShotGenerationWire =
  | { state: "running"; runRecordId: string; startedAt: number }
  | { state: "failed"; runRecordId: string; startedAt: number; message?: string }
  | { state: "recoverable"; runRecordId: string; startedAt: number; message?: string }
  | { state: "ended" };

/** 一镜落到节点上的一份结果（跨 RPC 序列化形状）。 */
export type MaterializeShotResultWire = { id: string; type: "image" | "video"; url: string; createdAt: number; thumbnailUrl?: string; previewState?: CanvasPreviewState; providerUrl?: string; model?: string };

/** 渲染层 materialize-shots 载荷里的一镜（与渲染层 MaterializeShotInput 对齐，跨 RPC 序列化形状）。 */
export type MaterializeShotWire = {
  shotId: string;
  role?: "anchor" | "shot";
  kind?: "image" | "video";
  title?: string;
  prompt?: string;
  candidate?: MaterializeShotCandidateWire;
  /** 这一镜那笔作业账上的每一份产物（一次出几张就有几张，按落账顺序）。 */
  results?: MaterializeShotResultWire[];
  /** 带 results 时：这些结果归哪条节点运行记录（这笔作业的运行记录号）。每份都按这个号结账，和画布单镜同一条归属规则。 */
  runRecordId?: string;
  mediaDimensions?: { width: number; height: number };
  /** 没有 results 时，这一镜在节点上的运行状态（见 MaterializeShotGenerationWire）。 */
  generation?: MaterializeShotGenerationWire;
  /**
   * 这一镜在 Run 里记着 `canvasDetached`（有人上报过它的节点被拿走了）：**只许动画布上已有的节点**，绝不新建。
   * 节点真的不在 → 渲染层什么都不做（撤销事实优先，不复活）；节点还在（误报 / 删了又 ⌘Z 撤回）→ 它照常拿到
   * 真实状态 / 结果，并回报绑定，plan.bind-shot-nodes 据此把 detached 记录纠正回来。
   * 「节点在不在画布上」只有画布文档说了算，Run 里那条记录不是第二个 owner（S1-5，2026-10-03）。
   */
  existingOnly?: true;
  /**
   * Run 里这一镜绑着的节点（`plan.bind-shot-nodes` 写回的那个）。节点此刻不在画布上（删了、还没撤销）时，渲染层
   * 据它把这一镜到达的结局按 nodeId 暂存，撤销 / 放回时落上——与普通画布同一个语义（架构③ 合同 3）。
   */
  nodeId?: string;
};

export type MaterializeShotsWirePayload = {
  projectId: string;
  runId: string;
  materializationOperationId: string;
  /**
   * 计划名本体。渲染层用它拼分镜组名（`分镜组·<计划名>`）和分镜表标题，**两处都走 i18n**。
   * 主进程不再合成任何面向用户的文案：以前这里发的是硬编码的 `分镜组·多镜计划`，它会盖过渲染层
   * 带 zh/en 的兜底，英文用户看到的是中文（与「镜头 N」那处同一个病）。没有计划名就不带。
   */
  planName?: string;
  shots: MaterializeShotWire[];
  /**
   * 只动画布上**已经在**的节点：不建节点、不建组、不重绑定候选。文稿来源的计划恒为 true；
   * Run 跟随者（Run 变了 → 节点跟上）也用它——它的职责是「让已有节点跟上真实状态」，
   * 不是「把用户删掉的节点再建回来」（节点刚删、detach 记账还没落盘的那一拍里，全量落地会把它复活）。
   */
  existingOnly?: boolean;
};

/** 没有 result 的一镜，在节点上该挂什么运行状态（判定只有一份：`deriveProductionShotState`）。 */
function shotGeneration(run: ProductionRun, shotId: string): MaterializeShotGenerationWire {
  const state = deriveProductionShotState(run, shotId);
  const job = state?.job;
  if (state?.phase === "generating" && job) {
    return { state: "running", runRecordId: productionRunRecordId(job.jobId), startedAt: Date.parse(job.createdAt) || Date.now() };
  }
  if ((state?.phase === "failed" || state?.phase === "unretrieved") && job) {
    return {
      state: state.phase === "unretrieved" ? "recoverable" : "failed", runRecordId: productionRunRecordId(job.jobId), startedAt: Date.parse(job.createdAt) || Date.now(),
      ...(state.failureMessage ? { message: state.failureMessage } : {}),
    };
  }
  // 排队 / 已停 / 已完成但产物投不出来（文件缺失）：都不是「生成中」。
  return { state: "ended" };
}

/**
 * 一次投影的指纹：每一镜「绑到哪、结果是哪个、运行态是什么」。**不含 URL**——预览链接每次投影都会重签，
 * 拿它比会让每次轮询都算成「变了」。指纹不变 = 画布上该有的样子没变，跟随者不必再去打扰渲染层。
 */
export function materializeShotsSignature(payload: MaterializeShotsWirePayload): string {
  return JSON.stringify(payload.shots.map((shot) => [
    shot.shotId,
    shot.results?.map((result) => result.id) ?? null,
    shot.mediaDimensions ? [shot.mediaDimensions.width, shot.mediaDimensions.height] : null,
    shot.generation ? [shot.generation.state, "runRecordId" in shot.generation ? shot.generation.runRecordId : null] : null,
    shot.candidate?.revision ?? null,
    shot.existingOnly ?? false,
  ]));
}

/**
 * 这个 Run 落过画布没有：有节点绑定，或者记过 detached（落过、后来有人上报节点被拿走）。
 * 跟随者 / 打开项目对账只跟落过画布的 Run；记过 detached 的也算——那条记录可能是错的或过时的，
 * 只有画布文档能纠正它（投影对这些镜只动已有节点，见 MaterializeShotWire.existingOnly）。
 */
export function runHasBeenOnCanvas(run: ProductionRun): boolean {
  const plan = run.generationPlan;
  if (!plan) return false;
  return Boolean(plan.nodeId) || plan.canvasDetached === true
    || Boolean(plan.shots?.some((shot) => Boolean(shot.nodeId) || shot.canvasDetached === true));
}

/** 该 Run 的画布落地稳定 op id（每 Run 一个 → 崩溃/重开补齐都对同一章去重）。 */
export function canvasLandingOperationId(runId: string): string {
  return `canvas-landing:${runId}`;
}

/**
 * 这一镜落到画布上的标签。
 *
 * 优先用**模型自己拟的标题**（`draft_shots` 的 `title`，如「日落前的一分钟」）。以前这里读不到它：
 * 动词收下了，翻译层扔了，草稿信封没有装它的口袋，于是主进程只能自己编一个「镜头 N」。
 *
 * 编不出来时**返回空**，让渲染层用它那份带 zh/en 的 i18n 兜底
 * （`generationCommon.production.canvasLanding.shotFallbackTitle`）。主进程再合成一份就是第二份兜底，
 * 而且是硬编码中文——它会盖过 i18n 那份，英文用户因此在画布上看到「镜头 1」（R15）。
 * 只保留「图片镜/锚用提示词前缀」这一条派生：它随输入 derive，不是写死的语言。
 */
function shotLabel(shot: ProductionGenerationShot): string {
  const authored = shot.title?.trim() ?? "";
  if (authored) return authored;
  const isStill = shot.role === "anchor" || /image/i.test(shot.candidate?.mode ?? "");
  return isStill ? (shot.candidate?.prompt?.trim().slice(0, 24) ?? "") : "";
}

/** 候选参数里能过线的那一半：标量。非标量（引用、嵌套对象）由参考槽那条路自己走。 */
function scalarParameters(parameters: Record<string, unknown> | undefined): Record<string, string | number | boolean> | undefined {
  if (!parameters) return undefined;
  const scalars: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") scalars[key] = value;
  }
  return Object.keys(scalars).length > 0 ? scalars : undefined;
}

/** 这个键不过线，以及为什么（写给下一个想把它加上线的人）。 */
type StaysInHost = { readonly staysInHost: string };

/**
 * 候选里钉住的一条参考 → 本项目素材库里的地址。解析不出（素材被删 / 版本变了）返回 undefined：那一条不过线。
 * 宿主装配给的是卡预览同一个解析口（`pendingSpendReferences.resolveIndexedReferencePreview`）；不给 = 参考一条都不过线。
 */
export type ResolveLandingReferenceUrl = (projectId: string, reference: PlanCandidate["references"][number]) => string | undefined;

/** 投影一份候选时手里的事实：参考要按哪个项目解析地址。 */
type CandidateLandingContext = { readonly projectId: string; readonly resolveReferenceUrl?: ResolveLandingReferenceUrl };

/** 候选的参考 → 线上的参考（只带地址 / 种类 / 用途）。一条解析不出就只丢那一条，记一笔。 */
function referencesWire(candidate: PlanCandidate, context: CandidateLandingContext): Partial<MaterializeShotCandidateWire> {
  if (!candidate.references?.length || !context.resolveReferenceUrl) return {};
  const references: NonNullable<MaterializeShotCandidateWire["references"]> = [];
  for (const reference of candidate.references) {
    let url: string | undefined;
    try {
      url = context.resolveReferenceUrl(context.projectId, reference);
    } catch {
      url = undefined;
    }
    if (!url) {
      logWarn("production-run", "canvas-landing-reference-unresolved", { assetId: reference.assetId });
      continue;
    }
    references.push({ url, kind: reference.kind ?? "image", ...(reference.role ? { role: reference.role } : {}) });
  }
  return references.length > 0 ? { references } : {};
}

/**
 * 候选的**每一个键**过不过落地这条线——穷举表，`PlanCandidate` 新增一个键而这里没归类，typecheck 就红。
 *
 * 为什么是表、不是 spread 也不是手写对象字面量：spread 会把 `sealedContractHash` 这类内部凭据顺着 RPC 漏给渲染层；
 * 手写字面量里「故意不传」和「忘了传」长得一样（都是没出现），变体就是这样漏的（R-d2-defaults #2，2026-10-22）。
 * 表把「不传」变成一句必须写出来的理由。
 */
const CANDIDATE_LANDING_FIELDS: { readonly [K in keyof Required<PlanCandidate>]: ((candidate: PlanCandidate, context: CandidateLandingContext) => Partial<MaterializeShotCandidateWire>) | StaysInHost } = {
  candidateId: (candidate) => ({ candidateId: candidate.candidateId }),
  revision: (candidate) => ({ revision: candidate.revision }),
  moduleId: { staysInHost: "宿主编排模块身份；节点不按它做任何事" },
  providerId: (candidate) => ({ vendor: candidate.providerId }),
  modelId: (candidate) => ({ modelKey: candidate.modelId }),
  variantId: (candidate) => (candidate.variantId ? { variantId: candidate.variantId } : {}),
  modeId: (candidate) => (candidate.modeId ? { modeId: candidate.modeId } : {}),
  mode: (candidate) => ({ mode: candidate.mode }),
  prompt: { staysInHost: "提示词随镜走（MaterializeShotWire.prompt），不属于候选身份" },
  parameters: (candidate) => {
    const scalars = scalarParameters(candidate.parameters);
    return scalars ? { parameters: scalars } : {};
  },
  // D2 第③步：发出读节点，参考必须落到节点上（2026-10-22 落地默认值核查）。地址由宿主按项目素材库解析，身份不过线。
  references: referencesWire,
  sealedContractHash: { staysInHost: "封印合同哈希是付费授权的内部凭据" },
};

/** 候选 → 落地报文里的候选身份（只此一处；逐键规则见上表）。 */
function candidateWire(candidate: PlanCandidate, context: CandidateLandingContext): MaterializeShotCandidateWire {
  const wire: Partial<MaterializeShotCandidateWire> = {};
  for (const rule of Object.values(CANDIDATE_LANDING_FIELDS)) {
    if (typeof rule === "function") Object.assign(wire, rule(candidate, context));
  }
  return wire as MaterializeShotCandidateWire;
}

/** 镜 → 画布节点 kind：和付费卡标题、卡体、派发读同一个答案（`generationShotKind`，第 9 条）。 */
function shotKind(shot: ProductionGenerationShot): GenerationShotKind {
  return generationShotKind(shot);
}

/**
 * 从 Run 投影出 materialize-shots 载荷。投影完整草稿；included 仅表示当前付费范围，不能删除未选镜头。
 * 已完成（ready/adopted）且有本地 artifact 的镜带上 results（这笔作业的每一份产物；打开项目补齐时一并回填；确认即落时通常还没有）。
 * 没有 results 的镜带上 `generation`（它在节点上此刻该挂的运行状态）。
 * planName = 计划名（渲染层据它拼分镜组名与分镜表标题）。projectRoot 用于核验产物文件真的在项目里。
 *
 * 记了 `canvasDetached` 的镜照样投影，但标 `existingOnly`：补齐 / 跟随都不许把删掉的节点复活（撤销事实优先），
 * 而节点其实还在的（切项目被误报成删除、删了又撤回）照样对上真实状态与结果（S1-5，2026-10-03）。
 * 以前这里直接把它们滤掉——Run 里那条记录一错，节点上的「生成中」就再也没人改，付了钱的图永远落不下来。
 */
export function buildMaterializeShotsPayload(
  run: ProductionRun,
  deps: { projectRoot: string | null; planName?: string; existingOnly?: boolean; placeDocumentPlan?: true; resolveReferenceUrl?: ResolveLandingReferenceUrl },
): MaterializeShotsWirePayload | null {
  const plan = run.generationPlan;
  if (!plan) return null;
  // A single-shot semantic operation keeps its candidate at plan.candidate for
  // backwards compatibility (shots[] is intentionally absent). Project it
  // through the same materialize-shots owner so the resident flow gets one
  // real canvas node instead of an answer-only receipt. A detached single
  // plan follows the same existing-only rule as a detached shot.
  const sourceShots: ProductionGenerationShot[] = plan.shots && plan.shots.length > 0
    ? plan.shots
    : [{ shotId: plan.candidate.candidateId, candidate: plan.candidate, updatedAt: plan.updatedAt, ...(plan.nodeId ? { nodeId: plan.nodeId } : {}), ...(plan.canvasDetached ? { canvasDetached: true } : {}) }]
  if (sourceShots.length === 0) return null;

  // shotId → 已完成镜的本地 result（从 artifacts 投影）。job 谱系：job.metadata.shotId → job → artifact.jobId。
  const jobByShot = new Map<string, string>();
  const singleShotId = !plan.shots || plan.shots.length === 0 ? plan.candidate.candidateId : undefined;
  for (const job of run.jobs) {
    const shotId = typeof job.metadata?.shotId === "string" ? job.metadata.shotId : undefined;
    const resolvedShotId = shotId || singleShotId;
    if (resolvedShotId && (job.status === "ready" || job.status === "adopted")) jobByShot.set(resolvedShotId, job.jobId);
  }
  const resultsByShot = new Map<string, MaterializeShotResultWire[]>();
  const dimensionsByShot = new Map<string, { width: number; height: number }>();
  if (deps.projectRoot) {
    for (const [shotId, jobId] of jobByShot.entries()) {
      // 这笔作业账上的每一份产物都投（一次出几张就几张，按落账顺序）；结果号由运行记录号派生，第 k 份加 `-k`。
      const artifacts = run.artifacts.filter((candidate) => candidate.jobId === jobId && (candidate.kind === "image" || candidate.kind === "video") && (candidate.status === "ready" || candidate.status === "adopted"));
      const results: MaterializeShotResultWire[] = [];
      for (const [index, artifact] of artifacts.entries()) {
        const mediaPath = safeProjectRelativePath(artifact.projectRelativePath);
        if (!mediaPath) continue;
        try {
          // 文件真的在项目里（拒越界 / 符号链接 / 缺失）才投。
          resolveOwnedArtifactFile(deps.projectRoot, mediaPath);
          const posterPath = safeProjectRelativePath(artifact.thumbnailRelativePath);
          const createdAt = Date.parse(artifact.createdAt);
          const type = artifact.kind === "image" ? "image" : "video";
          // 节点结果用素材库那条**永久**地址（与普通生成落地的 nomi-local://asset 同一种）。
          // 以前这里用的是 production-preview 签名链：5 分钟过期，而且优先指向缩略图——
          // 视频节点的 result.url 是一张封面图，过 5 分钟连封面也打不开。
          const url = localAssetUrl(run.projectId, mediaPath);
          // 预览两栏只走落盘回执的那一个投影：小图 + 事实；旧产物没有事实时只带独立小图（由打开后补预览补齐）。
          const preview = canvasPreviewFieldsFromReceipt(type, {
            thumbnailUrl: posterPath ? localAssetUrl(run.projectId, posterPath) : undefined,
            previewState: artifact.previewState,
          }, url);
          const recordId = productionRunRecordId(jobId);
          results.push({
            id: index === 0 ? recordId : `${recordId}-${index + 1}`,
            type,
            url,
            ...preview,
            // 用产物自己的时刻：同一份产物每次投影都是同一个结果（幂等），「已保存」回执也不会在重开项目时再冒一次。
            createdAt: Number.isFinite(createdAt) ? createdAt : 0,
          });
          if (artifact.width && artifact.height) dimensionsByShot.set(shotId, { width: artifact.width, height: artifact.height });
        } catch {
          // 文件缺失/越界 → 跳过这一份（占位仍落，其余照投），不阻断整批。
        }
      }
      if (results.length) resultsByShot.set(shotId, results);
    }
  }

  const shots: MaterializeShotWire[] = sourceShots.map((shot) => {
    const results = resultsByShot.get(shot.shotId);
    const generation = results ? undefined : shotGeneration(run, shot.shotId);
    return {
      shotId: shot.shotId,
      ...(shot.role ? { role: shot.role } : {}),
      kind: shotKind(shot),
      // 空标题**不发**：发空串会盖掉渲染层的 i18n 兜底，和发硬编码中文是同一个 bug。
      ...(shotLabel(shot) ? { title: shotLabel(shot) } : {}),
      prompt: shot.candidate?.prompt ?? "",
      ...(shot.candidate ? { candidate: candidateWire(shot.candidate, { projectId: run.projectId, ...(deps.resolveReferenceUrl ? { resolveReferenceUrl: deps.resolveReferenceUrl } : {}) }) } : {}),
      ...(results ? { results, runRecordId: productionRunRecordId(jobByShot.get(shot.shotId)!) } : {}),
      ...(results && dimensionsByShot.get(shot.shotId) ? { mediaDimensions: dimensionsByShot.get(shot.shotId) } : {}),
      ...(generation ? { generation } : {}),
      ...(shot.canvasDetached ? { existingOnly: true as const } : {}),
      ...(shot.nodeId ? { nodeId: shot.nodeId } : {}),
    };
  });

  const planName = (deps.planName || "").trim();
  return {
    projectId: run.projectId,
    runId: run.runId,
    materializationOperationId: canvasLandingOperationId(run.runId),
    ...(planName ? { planName } : {}),
    shots,
    // 文稿来源的计划平时只动已有节点（用户点「放到画布」才落）；确认付费那一下就是放到画布（10-08 拍板），由派发前落地带 placeDocumentPlan。
    ...((run.origin.sourceDocument && !deps.placeDocumentPlan) || deps.existingOnly ? { existingOnly: true } : {}),
  };
}

export type CanvasLandingDeps = {
  requestRenderer: (op: string, payload: unknown, timeoutMs: number) => Promise<unknown>;
  /** 执行一条 Run 命令（bind-shot-nodes 写回 nodeId）。 */
  bindShotNodes: (projectId: string, runId: string, expectedRevision: number, bindings: Array<{ shotId: string; nodeId: string }>) => Promise<void>;
  projectRoot: string | null;
  planName?: string;
  /** 只让已有节点跟上状态（见 MaterializeShotsWirePayload.existingOnly）。 */
  existingOnly?: boolean;
  /** 打开项目的对账：画布上认不出是同一镜的（老资料、身份对不上）什么都不做，但记一条日志。 */
  reportUnmatched?: boolean;
  /** Optional lifecycle guard for detached observers.  It is checked before
   * touching the renderer and again before the durable Run bind. */
  isCurrent?: () => boolean;
  /** 派发前落地：文稿来源的计划也真建节点（确认 = 放到画布）。 */
  placeDocumentPlan?: true;
  /** 候选参考 → 项目素材地址（见 `ResolveLandingReferenceUrl`）。 */
  resolveReferenceUrl?: ResolveLandingReferenceUrl;
};

/**
 * 派发之后的投影（草稿投影 / Run 跟随 / 打开项目对账）：把一个 Run 的镜落成画布占位 + 组 + 回填已完成 result，
 * 并把绑定写回 Run。**永不抛**：渲染层不可用 / 落地失败 → 记 warn、返回 false。钱不经过这里（派发前的落地走
 * `landCanvasForRunOrThrow`，由唯一准入点判能不能派）。
 */
export async function landCanvasForRun(run: ProductionRun, deps: CanvasLandingDeps): Promise<boolean> {
  try {
    return await landCanvasForRunOrThrow(run, deps);
  } catch (error) {
    logWarn("production-run", "canvas-landing-skipped", undefined, error);
    return false;
  }
}

/**
 * 同一条落地链，失败如实抛（渲染层不可用 / 项目没开 / 落地报错）。派发前落地用它：抛了这一镜就不派。
 * 返回 false = 没有可落的（没有计划 / 已不是当前生命周期）。
 */
export async function landCanvasForRunOrThrow(run: ProductionRun, deps: CanvasLandingDeps): Promise<boolean> {
  if (deps.isCurrent && !deps.isCurrent()) return false;
  const payload = buildMaterializeShotsPayload(run, {
    projectRoot: deps.projectRoot, planName: deps.planName,
    ...(deps.existingOnly ? { existingOnly: true } : {}),
    ...(deps.placeDocumentPlan ? { placeDocumentPlan: true as const } : {}),
    ...(deps.resolveReferenceUrl ? { resolveReferenceUrl: deps.resolveReferenceUrl } : {}),
  });
  if (!payload) return false;
  if (deps.isCurrent && !deps.isCurrent()) return false;
  const rendered = (await deps.requestRenderer("production.materialize-shots", payload, 60_000)) as { bindings?: unknown } | null;
  const rawBindings = Array.isArray(rendered?.bindings) ? rendered!.bindings : [];
  const bindings = rawBindings
    .map((raw) => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}))
    .map((entry) => ({ shotId: typeof entry.shotId === "string" ? entry.shotId.trim() : "", nodeId: typeof entry.nodeId === "string" ? entry.nodeId.trim() : "" }))
    .filter((binding) => binding.shotId && binding.nodeId);
  if (deps.reportUnmatched) {
    const unmatched = payload.shots.filter((shot) => !bindings.some((binding) => binding.shotId === shot.shotId)).length;
    if (unmatched > 0) logInfo("production-run", "canvas-reconcile-unmatched-shots", { runId: run.runId, unmatched, shots: payload.shots.length });
  }
  if (bindings.length > 0) {
    if (deps.isCurrent && !deps.isCurrent()) return false;
    await deps.bindShotNodes(run.projectId, run.runId, run.revision, bindings);
    // bind 的 await 期间生命周期变了（派发前落地的项目租约失效）：如实回「没落好」，由调用方决定怎么处置。
    if (deps.isCurrent && !deps.isCurrent()) return false;
  }
  return true;
}
