// P4 S5 — 多镜产物画布落地（主进程编排）。渲染层的落点在 src/workbench/capability/multiShotCanvasLanding.ts；
// 这里只负责：① 从 Run 的 generationPlan.shots 投影出 materialize-shots 载荷（含已完成镜的本地 result）；
// ② 经 requestRenderer 请求渲染层落节点/组；③ 把 shotId→nodeId 绑定经 plan.bind-shot-nodes 写回 Run。
//
// 铁律（§1）：Job 只从封存合同派生，**画布落地是 best-effort**——项目没开 / 窗口不可用 / 渲染层抛错都只记 warn，
// 绝不阻断生成。故所有落点调用点都 try/catch 后继续。
//
// 幂等（§3.4）：materializationOperationId = `canvas-landing:{runId}`（每 Run 一个稳定 op），跑两次不重复建节点/组。
import { createArtifactProjection } from "./artifactProjection";
import type { ProductionRun, ProductionGenerationShot } from "./productionRunTypes";
import { logWarn } from "../logging/logger";

/** 渲染层 materialize-shots 载荷里的一镜（与渲染层 MaterializeShotInput 对齐，跨 RPC 序列化形状）。 */
export type MaterializeShotWire = {
  shotId: string;
  role?: "anchor" | "shot";
  kind?: "image" | "video";
  title?: string;
  prompt?: string;
  result?: { id: string; type: "image" | "video"; url: string; createdAt: number; thumbnailUrl?: string; providerUrl?: string; model?: string };
};

export type MaterializeShotsWirePayload = {
  projectId: string;
  runId: string;
  materializationOperationId: string;
  groupName: string;
  shots: MaterializeShotWire[];
};

/** 该 Run 的画布落地稳定 op id（每 Run 一个 → 崩溃/重开补齐都对同一章去重）。 */
export function canvasLandingOperationId(runId: string): string {
  return `canvas-landing:${runId}`;
}

/** 从镜的 candidate 推一个人话标题（有 index 用「镜头 N」；锚用其 prompt 前缀）。纯函数。 */
function shotTitle(shot: ProductionGenerationShot, index: number): string {
  if (shot.role === "anchor") {
    const p = shot.candidate?.prompt?.trim() ?? "";
    return p ? p.slice(0, 24) : `参考 ${index + 1}`;
  }
  return `镜头 ${index + 1}`;
}

/** 镜的执行模态 → 画布节点 kind（anchor 恒 image；镜按 transportTaskKind 猜，缺省 video）。 */
function shotKind(shot: ProductionGenerationShot): "image" | "video" {
  if (shot.role === "anchor") return "image";
  if (/image/i.test(shot.candidate?.mode ?? "")) return "image";
  return "video";
}

/**
 * 从 Run 投影出 materialize-shots 载荷。**只投影 included 的锚 + 镜**（试拍/分批只覆盖勾选镜，§3.1）。
 * 已完成（ready/adopted）且有本地 artifact 的镜带上 result（打开项目补齐时一并回填；确认即落时通常还没有）。
 * groupName = 计划名（分镜组·<计划名>）。previewSecret/projectRoot 用于把 artifact 投成 nomi-local:// url。
 */
export function buildMaterializeShotsPayload(
  run: ProductionRun,
  deps: { projectRoot: string | null; previewSecret: string; planName?: string; nowMs?: number },
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
    ? plan.shots
    : [{ shotId: plan.candidate.candidateId, candidate: plan.candidate, updatedAt: plan.updatedAt }]
  const included = sourceShots.filter((shot) => shot.included !== false);
  if (included.length === 0) return null;

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
      if (!artifact || !(artifact.projectRelativePath || artifact.thumbnailRelativePath)) continue;
      try {
        const projected = createArtifactProjection({ projectRoot: deps.projectRoot, run, artifact, secret: deps.previewSecret, nowMs: deps.nowMs });
        const url = projected.preview?.nomiUrl;
        if (!url) continue;
        resultByShot.set(shotId, {
          id: `production-${jobId}`,
          type: artifact.kind === "image" ? "image" : "video",
          url, // nomi-local:// —— 渲染层 attach 断言要求本地协议
          createdAt: deps.nowMs ?? Date.now(),
          ...(projected.preview?.nomiUrl && artifact.thumbnailRelativePath ? { thumbnailUrl: url } : {}),
        });
      } catch {
        // 文件缺失/越界 → 跳过这镜的 result（占位仍落，只是没回填），不阻断整批。
      }
    }
  }

  const shots: MaterializeShotWire[] = included.map((shot, index) => {
    const result = resultByShot.get(shot.shotId);
    return {
      shotId: shot.shotId,
      ...(shot.role ? { role: shot.role } : {}),
      kind: shotKind(shot),
      title: shot.role === undefined && /image/i.test(shot.candidate.mode)
        ? (shot.candidate.prompt.trim().slice(0, 24) || shotTitle(shot, index))
        : shotTitle(shot, index),
      prompt: shot.candidate?.prompt ?? "",
      ...(result ? { result } : {}),
    };
  });

  return {
    projectId: run.projectId,
    runId: run.runId,
    materializationOperationId: canvasLandingOperationId(run.runId),
    groupName: `分镜组·${(deps.planName || "").trim() || "多镜计划"}`,
    shots,
  };
}

export type CanvasLandingDeps = {
  requestRenderer: (op: string, payload: unknown, timeoutMs: number) => Promise<unknown>;
  /** 执行一条 Run 命令（bind-shot-nodes 写回 nodeId）。 */
  bindShotNodes: (projectId: string, runId: string, expectedRevision: number, bindings: Array<{ shotId: string; nodeId: string }>) => Promise<void>;
  projectRoot: string | null;
  previewSecret: string;
  planName?: string;
  nowMs?: number;
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
  const payload = buildMaterializeShotsPayload(run, { projectRoot: deps.projectRoot, previewSecret: deps.previewSecret, planName: deps.planName, nowMs: deps.nowMs });
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
