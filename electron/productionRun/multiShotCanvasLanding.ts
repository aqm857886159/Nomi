// P4 S5 — 多镜产物画布落地（主进程编排）。渲染层的落点在 src/workbench/capability/multiShotCanvasLanding.ts；
// 这里只负责：① 从 Run 的 generationPlan.shots 投影出 materialize-shots 载荷（含已完成镜的本地 result）；
// ② 经 requestRenderer 请求渲染层落节点/组；③ 把 shotId→nodeId 绑定经 plan.bind-shot-nodes 写回 Run。
//
// 铁律（§1）：Job 只从封存合同派生，**画布落地是 best-effort**——项目没开 / 窗口不可用 / 渲染层抛错都只记 warn，
// 绝不阻断生成。故所有落点调用点都 try/catch 后继续。
//
// 幂等（§3.4）：materializationOperationId = `canvas-landing:{runId}`（每 Run 一个稳定 op），跑两次不重复建节点/组。
import { resolveOwnedArtifactFile, safeProjectRelativePath } from "./artifactProjection";
import { localAssetUrl } from "../assets/assetPaths";
import type { ProductionRun, ProductionGenerationShot } from "./productionRunTypes";
import { logWarn } from "../logging/logger";
import { deriveProductionShotState } from "../shared/productionShotPhase";

/**
 * 一镜候选的**模型身份**，随落地报文过 RPC。它是画布节点模型的唯一来源：带上它，渲染层就不再
 * 自己另挑一个默认模型（那正是「agent 说的模型」与「节点上的模型」对不上的直接原因）。
 *
 * 只带身份，**绝不带 transportModelId、密钥或任何供应商凭据**：transportModelId 是内部投影，
 * 渲染层不需要也不许知道；节点 `meta.modelKey` 与候选 `modelId` 本来就是同一个串
 * （generationDefaultModelResolver 的 `modelId: model.modelKey`），故不造转换层。
 *
 * `revision` = PlanCandidate.revision。渲染层据它判断「这镜的意图变了没有」：变了才重绑定
 * prompt/模型，没变一个字不动——这样 `generation.patch` 能同步下去，而「打开项目补齐」这条
 * 幂等重放不会覆盖用户之后在画布上的手改。
 */
export type MaterializeShotCandidateWire = {
  candidateId: string;
  revision: number;
  vendor: string;
  modelKey: string;
  modeId?: string;
  mode: string;
  /**
   * 候选**选中的那些参数**（画质 / 时长 / 尺寸 / 声效……）。
   *
   * 为什么必须过这条线：渲染层重绑定时走 `buildPlannedNodeMeta`，而它按模型档案铺的是**默认值**。
   * 不把候选真正选的参数带过来，每一次重绑定都会把用户（或 agent）挑过的值悄悄改回档案默认——
   * 2026-09-11 实测：付费卡上把尺寸从 1024x1024 改成 1536x1024，落地链下一拍就把它按回去，
   * 价格跟着弹回原价。这不是显示问题：**节点是候选的投影，投影漏掉了参数**。
   *
   * 只带标量（字符串/数字/布尔）：参数面上真正能选的就是这些，而这条线不该变成一个任意 JSON 通道。
   * 绝不含 transportModelId、密钥或供应商 URL。
   */
  parameters?: Record<string, string | number | boolean>;
};

/**
 * 这一镜此刻在节点上该是什么运行状态——**写进节点自己的运行记录**，与普通生成同一份状态、同一套画法
 * （NodeGeneratingOverlay / NodeErrorReport），不再由渲染层另轮询一份 Run 快照、另画一套「整卡模糊 + N 字标」。
 *
 * - running：已交给供应商、还没结论（节点显示普通生成那张等待画面）；
 * - failed：这一镜确定失败（节点显示普通生成那张失败卡，重试走返工链）；
 * - ended：不在跑（排队 / 已停 / 这一镜的产物投不出来）——节点上若还挂着本制作的「生成中」记录，收掉它。
 * 已完成的镜不带它：带 `result`，回填本身就把那条记录记成成功。
 *
 * `runRecordId` = 节点运行记录的身份，取自这一镜那次任务的 jobId（同一任务反复投影幂等，返工 = 新任务 = 新记录）。
 */
export type MaterializeShotGenerationWire =
  | { state: "running"; runRecordId: string; startedAt: number }
  | { state: "failed"; runRecordId: string; startedAt: number; message?: string }
  | { state: "ended" };

/** 节点运行记录的身份：这一镜那次任务。 */
function productionRunRecordId(jobId: string): string {
  return `production-${jobId}`;
}

/** 渲染层 materialize-shots 载荷里的一镜（与渲染层 MaterializeShotInput 对齐，跨 RPC 序列化形状）。 */
export type MaterializeShotWire = {
  shotId: string;
  role?: "anchor" | "shot";
  kind?: "image" | "video";
  title?: string;
  prompt?: string;
  candidate?: MaterializeShotCandidateWire;
  result?: { id: string; type: "image" | "video"; url: string; createdAt: number; thumbnailUrl?: string; providerUrl?: string; model?: string };
  /** 没有 result 时，这一镜在节点上的运行状态（见 MaterializeShotGenerationWire）。 */
  generation?: MaterializeShotGenerationWire;
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
  if (state?.phase === "failed" && job) {
    return {
      state: "failed", runRecordId: productionRunRecordId(job.jobId), startedAt: Date.parse(job.createdAt) || Date.now(),
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
    shot.result?.id ?? null,
    shot.generation ? [shot.generation.state, "runRecordId" in shot.generation ? shot.generation.runRecordId : null] : null,
    shot.candidate?.revision ?? null,
  ]));
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

/**
 * 候选 → 落地报文里的模型身份。**逐字段列举**（不是 spread），这样 PlanCandidate 以后新增
 * transportModelId 之类的内部字段时，绝不会顺着这条 RPC 悄悄流到渲染层。
 */
/** 候选参数里能过线的那一半：标量。非标量（引用、嵌套对象）由参考槽那条路自己走。 */
function scalarParameters(parameters: Record<string, unknown> | undefined): Record<string, string | number | boolean> | undefined {
  if (!parameters) return undefined;
  const scalars: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") scalars[key] = value;
  }
  return Object.keys(scalars).length > 0 ? scalars : undefined;
}

function candidateWire(candidate: ProductionGenerationShot["candidate"]): MaterializeShotCandidateWire {
  return {
    candidateId: candidate.candidateId,
    revision: candidate.revision,
    vendor: candidate.providerId,
    modelKey: candidate.modelId,
    ...(candidate.modeId ? { modeId: candidate.modeId } : {}),
    mode: candidate.mode,
    ...(scalarParameters(candidate.parameters) ? { parameters: scalarParameters(candidate.parameters)! } : {}),
  };
}

/** 镜的执行模态 → 画布节点 kind（anchor 恒 image；镜按 transportTaskKind 猜，缺省 video）。 */
function shotKind(shot: ProductionGenerationShot): "image" | "video" {
  if (shot.role === "anchor") return "image";
  if (/image/i.test(shot.candidate?.mode ?? "")) return "image";
  return "video";
}

/**
 * 从 Run 投影出 materialize-shots 载荷。投影完整草稿；included 仅表示当前付费范围，不能删除未选镜头。
 * 已完成（ready/adopted）且有本地 artifact 的镜带上 result（打开项目补齐时一并回填；确认即落时通常还没有）。
 * 没有 result 的镜带上 `generation`（它在节点上此刻该挂的运行状态）。
 * planName = 计划名（渲染层据它拼分镜组名与分镜表标题）。projectRoot 用于核验产物文件真的在项目里。
 *
 * 用户删掉的占位（`canvasDetached`）不投影：撤销事实优先，补齐 / 跟随都不许把它复活
 * （单镜早就这样判；多镜以前漏了，重开项目会把删掉的镜头节点建回来）。
 */
export function buildMaterializeShotsPayload(
  run: ProductionRun,
  deps: { projectRoot: string | null; planName?: string; existingOnly?: boolean },
): MaterializeShotsWirePayload | null {
  const plan = run.generationPlan;
  if (!plan) return null;
  // A deleted single-shot placeholder is an explicit user decision. Keep the
  // durable artifact in the Run/asset owner, but do not recreate the canvas
  // node on every reconciliation pass.
  if ((!plan.shots || plan.shots.length === 0) && plan.canvasDetached) return null;
  // A single-shot semantic operation keeps its candidate at plan.candidate for
  // backwards compatibility (shots[] is intentionally absent). Project it
  // through the same materialize-shots owner so the resident flow gets one
  // real canvas node instead of an answer-only receipt.
  const sourceShots = plan.shots && plan.shots.length > 0
    ? plan.shots.filter((shot) => !shot.canvasDetached)
    : [{ shotId: plan.candidate.candidateId, candidate: plan.candidate, updatedAt: plan.updatedAt }]
  if (sourceShots.length === 0) return null;

  // shotId → 已完成镜的本地 result（从 artifacts 投影）。job 谱系：job.metadata.shotId → job → artifact.jobId。
  const jobByShot = new Map<string, string>();
  const singleShotId = !plan.shots || plan.shots.length === 0 ? plan.candidate.candidateId : undefined;
  for (const job of run.jobs) {
    const shotId = typeof job.metadata?.shotId === "string" ? job.metadata.shotId : undefined;
    const resolvedShotId = shotId || singleShotId;
    if (resolvedShotId && (job.status === "ready" || job.status === "adopted")) jobByShot.set(resolvedShotId, job.jobId);
  }
  const resultByShot = new Map<string, MaterializeShotWire["result"]>();
  if (deps.projectRoot) {
    for (const [shotId, jobId] of jobByShot.entries()) {
      const artifact = run.artifacts.find((candidate) => candidate.jobId === jobId && (candidate.kind === "image" || candidate.kind === "video") && (candidate.status === "ready" || candidate.status === "adopted"));
      const mediaPath = safeProjectRelativePath(artifact?.projectRelativePath);
      if (!artifact || !mediaPath) continue;
      try {
        // 文件真的在项目里（拒越界 / 符号链接 / 缺失）才投。
        resolveOwnedArtifactFile(deps.projectRoot, mediaPath);
        const posterPath = safeProjectRelativePath(artifact.thumbnailRelativePath);
        const createdAt = Date.parse(artifact.createdAt);
        resultByShot.set(shotId, {
          id: productionRunRecordId(jobId),
          type: artifact.kind === "image" ? "image" : "video",
          // 节点结果用素材库那条**永久**地址（与普通生成落地的 nomi-local://asset 同一种）。
          // 以前这里用的是 production-preview 签名链：5 分钟过期，而且优先指向缩略图——
          // 视频节点的 result.url 是一张封面图，过 5 分钟连封面也打不开。
          url: localAssetUrl(run.projectId, mediaPath),
          ...(posterPath ? { thumbnailUrl: localAssetUrl(run.projectId, posterPath) } : {}),
          // 用产物自己的时刻：同一份产物每次投影都是同一个结果（幂等），「已保存」回执也不会在重开项目时再冒一次。
          createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        });
      } catch {
        // 文件缺失/越界 → 跳过这镜的 result（占位仍落，只是没回填），不阻断整批。
      }
    }
  }

  const shots: MaterializeShotWire[] = sourceShots.map((shot) => {
    const result = resultByShot.get(shot.shotId);
    const generation = result ? undefined : shotGeneration(run, shot.shotId);
    return {
      shotId: shot.shotId,
      ...(shot.role ? { role: shot.role } : {}),
      kind: shotKind(shot),
      // 空标题**不发**：发空串会盖掉渲染层的 i18n 兜底，和发硬编码中文是同一个 bug。
      ...(shotLabel(shot) ? { title: shotLabel(shot) } : {}),
      prompt: shot.candidate?.prompt ?? "",
      ...(shot.candidate ? { candidate: candidateWire(shot.candidate) } : {}),
      ...(result ? { result } : {}),
      ...(generation ? { generation } : {}),
    };
  });

  const planName = (deps.planName || "").trim();
  return {
    projectId: run.projectId,
    runId: run.runId,
    materializationOperationId: canvasLandingOperationId(run.runId),
    ...(planName ? { planName } : {}),
    shots,
    ...(run.origin.sourceDocument || deps.existingOnly ? { existingOnly: true } : {}),
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
  /** Optional lifecycle guard for detached observers.  It is checked before
   * touching the renderer and again before the durable Run bind. */
  isCurrent?: () => boolean;
};

/**
 * 尽力把一个 Run 的镜落成画布占位 + 组 + 回填已完成 result，并把绑定写回 Run。**永不抛**（best-effort）：
 * 渲染层不可用 / 落地失败 → 返回 false（调用方继续生成）。确认即落与打开项目补齐共用它（P1 一个家）。
 */
export async function landCanvasForRun(run: ProductionRun, deps: CanvasLandingDeps): Promise<boolean> {
  if (deps.isCurrent && !deps.isCurrent()) return false;
  const payload = buildMaterializeShotsPayload(run, { projectRoot: deps.projectRoot, planName: deps.planName, ...(deps.existingOnly ? { existingOnly: true } : {}) });
  if (!payload) return false;
  try {
    if (deps.isCurrent && !deps.isCurrent()) return false;
    const rendered = (await deps.requestRenderer("production.materialize-shots", payload, 60_000)) as { bindings?: unknown } | null;
    const rawBindings = Array.isArray(rendered?.bindings) ? rendered!.bindings : [];
    const bindings = rawBindings
      .map((raw) => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}))
      .map((entry) => ({ shotId: typeof entry.shotId === "string" ? entry.shotId.trim() : "", nodeId: typeof entry.nodeId === "string" ? entry.nodeId.trim() : "" }))
      .filter((binding) => binding.shotId && binding.nodeId);
    if (bindings.length > 0) {
      if (deps.isCurrent && !deps.isCurrent()) return false;
      await deps.bindShotNodes(run.projectId, run.runId, run.revision, bindings);
    }
    return true;
  } catch (error) {
    // 渲染层不可用（项目没开 / 窗口关）或落地失败：只记 warn，生成照跑（§1 铁律）。
    logWarn("production-run", "canvas-landing-skipped", undefined, error);
    return false;
  }
}
